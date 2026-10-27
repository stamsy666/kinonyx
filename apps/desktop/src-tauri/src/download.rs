//! Saving a film to disk. TorrServer only streams, so the file is copied from its stream URL (it answers `Range`
//! requests) into the folder the viewer chose: `<name>.part` while it runs, renamed when complete. Stopping keeps the
//! `.part`, and starting again asks the stream only for the rest — pause, resume and a restart of the app all work.
//!
//! Events for the page: `download://progress` {id, received, total, speed}, `download://done` {id, path},
//! `download://error` {id, message}.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

use crate::http::CLIENT;

#[derive(Default)]
pub struct Downloads(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Clone, Serialize)]
struct Progress {
    id: String,
    received: u64,
    total: u64,
    speed: f64,
}

/// A file name Windows accepts: no path parts, no reserved characters.
fn safe_name(name: &str) -> String {
    let reserved = "\\/:*?\"<>|";
    let cleaned: String = name.chars().map(|c| if reserved.contains(c) || c.is_control() { '_' } else { c }).collect();
    let cleaned = cleaned.trim().trim_end_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "video".into()
    } else {
        cleaned
    }
}

/// `name`, or `name (1)`, `name (2)` … when a file with that name is already there.
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.to_string(), String::new()),
    };
    (1..1000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

#[tauri::command]
pub async fn dl_start(app: AppHandle, state: State<'_, Downloads>, id: String, url: String, dir: String, file_name: String) -> Result<(), String> {
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut running = state.0.lock().unwrap();
        if running.contains_key(&id) {
            return Ok(());
        }
        running.insert(id.clone(), stop.clone());
    }
    let dir = PathBuf::from(dir);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        state.0.lock().unwrap().remove(&id);
        return Err(format!("Не удалось создать папку: {e}"));
    }
    let name = safe_name(&file_name);
    let part = dir.join(format!("{name}.part"));

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = run(&app2, &id, &url, &dir, &name, &part, &stop).await;
        if let Some(d) = app2.try_state::<Downloads>() {
            d.0.lock().unwrap().remove(&id);
        }
        match result {
            Ok(Some(path)) => {
                crate::elog!("[download] {id}: done {}", path.display());
                let _ = app2.emit("download://done", serde_json::json!({ "id": id, "path": path.to_string_lossy() }));
            }
            Ok(None) => crate::elog!("[download] {id}: stopped"),
            Err(message) => {
                crate::elog!("[download] {id}: {message}");
                let _ = app2.emit("download://error", serde_json::json!({ "id": id, "message": message }));
            }
        }
    });
    Ok(())
}

/// Ok(Some(path)) — finished; Ok(None) — stopped by the viewer.
async fn run(app: &AppHandle, id: &str, url: &str, dir: &Path, name: &str, part: &Path, stop: &AtomicBool) -> Result<Option<PathBuf>, String> {
    let have = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    let mut req = CLIENT.get(url);
    if have > 0 {
        req = req.header("Range", format!("bytes={have}-"));
    }
    // TorrServer waits for the swarm before answering — give it time, but not forever.
    let mut res = tokio::time::timeout(Duration::from_secs(90), req.send())
        .await
        .map_err(|_| "Раздача не отвечает (нет сидов?)".to_string())?
        .map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let mut file;
    let mut received;
    let total;
    match status {
        206 => {
            received = have;
            total = have + res.content_length().unwrap_or(0);
            file = tokio::fs::OpenOptions::new().create(true).append(true).open(part).await.map_err(|e| e.to_string())?;
        }
        200 => {
            // The server ignored the range: start over.
            received = 0;
            total = res.content_length().unwrap_or(0);
            file = tokio::fs::File::create(part).await.map_err(|e| e.to_string())?;
        }
        416 => {
            // Nothing left to ask for: the part is the whole file.
            let target = free_path(dir, name);
            tokio::fs::rename(part, &target).await.map_err(|e| e.to_string())?;
            return Ok(Some(target));
        }
        s => return Err(format!("TorrServer ответил {s}")),
    }

    let started = Instant::now();
    let base = received;
    let mut last_emit = Instant::now();
    loop {
        if stop.load(Ordering::SeqCst) {
            file.flush().await.ok();
            return Ok(None);
        }
        let chunk = tokio::time::timeout(Duration::from_secs(60), res.chunk())
            .await
            .map_err(|_| "Данные перестали приходить (нет сидов?) — нажмите «Продолжить»".to_string())?
            .map_err(|e| e.to_string())?;
        let Some(bytes) = chunk else { break };
        file.write_all(&bytes).await.map_err(|e| format!("Не удалось записать на диск: {e}"))?;
        received += bytes.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(500) {
            last_emit = Instant::now();
            let speed = (received - base) as f64 / started.elapsed().as_secs_f64().max(0.1);
            let _ = app.emit("download://progress", Progress { id: id.to_string(), received, total: total.max(received), speed });
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    if total > 0 && received < total {
        return Err("Соединение оборвалось до конца файла — нажмите «Продолжить»".into());
    }
    let target = free_path(dir, name);
    tokio::fs::rename(part, &target).await.map_err(|e| e.to_string())?;
    let _ = app.emit("download://progress", Progress { id: id.to_string(), received, total: received, speed: 0.0 });
    Ok(Some(target))
}

/// Pause: stops the transfer, keeps the `.part`.
#[tauri::command]
pub fn dl_stop(state: State<'_, Downloads>, id: String) {
    if let Some(flag) = state.0.lock().unwrap().get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
}

/// Removes an unfinished download's `.part` (and, if asked, a finished file).
#[tauri::command]
pub async fn dl_remove(dir: String, file_name: String, finished_path: Option<String>) -> Result<(), String> {
    let part = PathBuf::from(&dir).join(format!("{}.part", safe_name(&file_name)));
    let _ = tokio::fs::remove_file(part).await;
    if let Some(p) = finished_path {
        let _ = tokio::fs::remove_file(p).await;
    }
    Ok(())
}

/// Bytes already in the `.part` and whether the finished file is there — the page checks this when the list opens.
#[tauri::command]
pub async fn dl_inspect(dir: String, file_name: String, finished_path: Option<String>) -> (u64, bool) {
    let part = PathBuf::from(&dir).join(format!("{}.part", safe_name(&file_name)));
    let have = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    let done = match finished_path {
        Some(p) => tokio::fs::metadata(p).await.is_ok(),
        None => false,
    };
    (have, done)
}

#[cfg(test)]
mod tests {
    use super::{free_path, safe_name};

    #[test]
    fn names_are_made_safe() {
        assert_eq!(safe_name("a/b:c*d?.mkv"), "a_b_c_d_.mkv");
        assert_eq!(safe_name("  ... "), "video");
        assert_eq!(safe_name("Фильм (2021).mkv"), "Фильм (2021).mkv");
    }

    #[test]
    fn existing_file_gets_a_number() {
        let dir = std::env::temp_dir().join("kinonyx_dl_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("x.mkv"), b"1").unwrap();
        assert_eq!(free_path(&dir, "x.mkv"), dir.join("x (1).mkv"));
        assert_eq!(free_path(&dir, "y.mkv"), dir.join("y.mkv"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
