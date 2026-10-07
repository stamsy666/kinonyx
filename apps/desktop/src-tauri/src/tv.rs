//! Raw bytes for the TV section (IPTV playlists): a remote M3U or one picked from disk.
//! Returned as a binary IPC response rather than JSON — a playlist can be megabytes, and
//! the frontend decodes it itself (`decodeBody`: gzip + UTF-8), same as PortoTV.

use crate::http::CLIENT;
use tauri::ipc::Response;

#[tauri::command]
pub async fn fetch_bytes(url: String) -> Result<Response, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Поддерживаются только ссылки http(s)".into());
    }
    let res = CLIENT.get(parsed).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(Response::new(bytes.to_vec()))
}

/// Reads a playlist the viewer picked in the system file dialog. Limited to playlist
/// extensions so this can't be used to read arbitrary files.
#[tauri::command]
pub async fn read_playlist_file(path: String) -> Result<Response, String> {
    let lower = path.to_lowercase();
    if ![".m3u", ".m3u8", ".txt"].iter().any(|ext| lower.ends_with(ext)) {
        return Err("Нужен файл плейлиста (.m3u, .m3u8, .txt)".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}
