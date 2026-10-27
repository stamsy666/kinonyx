//! An optional second source of releases: a JacRed server (an aggregator of torrent trackers — the viewer's own or a
//! public one) at the address given in Settings. The search is `GET {base}/api/v1.0/torrents?search=…[&apikey=…]`;
//! the answer is a list of `{tracker, title, sizeName, sid, pir, magnet, url, quality, voices, …}`.

use std::time::Duration;

use serde_json::Value;

use crate::http::CLIENT;

#[tauri::command]
pub async fn jacred_search(base: String, key: Option<String>, query: String) -> Result<Value, String> {
    let base = base.trim().trim_end_matches('/').to_string();
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("Адрес JacRed должен начинаться с http:// или https://".into());
    }
    let mut url = format!("{base}/api/v1.0/torrents?search={}", urlencoding::encode(query.trim()));
    if let Some(k) = key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        url.push_str(&format!("&apikey={}", urlencoding::encode(k)));
    }
    let res = CLIENT.get(&url).timeout(Duration::from_secs(15)).send().await.map_err(|e| format!("JacRed не отвечает: {e}"))?;
    match res.status().as_u16() {
        200..=299 => {}
        401 | 403 => return Err("JacRed не принял запрос — проверьте ключ (apikey)".into()),
        s => return Err(format!("JacRed ответил {s}")),
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    // A server with a key answers a wrong one with plain text ("apikey"), not an error code.
    serde_json::from_str::<Value>(&text).map_err(|_| "JacRed ответил не списком раздач — проверьте адрес и ключ".to_string())
}
