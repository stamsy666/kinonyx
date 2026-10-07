//! Model/engine downloads with progress events, resume (HTTP Range on a `.part` file) and
//! cancellation. Emits `translator://download` { id, received, total, state, stage?, error? }.
//!
//! The voice runtime is special: after its downloads (embeddable Python + get-pip.py) pip
//! fetches PyTorch and OmniVoice from the official indexes into the same folder.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use super::catalog::{self, Item};

#[derive(Default)]
pub struct Downloads {
    active: Mutex<HashMap<&'static str, Arc<AtomicBool>>>,
}

#[derive(Serialize, Clone)]
struct Progress {
    id: &'static str,
    received: u64,
    total: u64,
    state: &'static str,
    /// What is happening right now, for multi-step installs ("Устанавливаю PyTorch…").
    #[serde(skip_serializing_if = "Option::is_none")]
    stage: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl Downloads {
    pub fn is_active(&self, id: &str) -> bool {
        self.active.lock().unwrap().contains_key(id)
    }

    pub fn cancel(&self, id: &str) {
        if let Some(flag) = self.active.lock().unwrap().get(id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    pub fn start(self: &Arc<Self>, app: AppHandle, item: &'static Item) -> Result<(), String> {
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut active = self.active.lock().unwrap();
            if active.contains_key(item.id) {
                return Ok(());
            }
            active.insert(item.id, cancel.clone());
        }
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let total = catalog::total_size(item);
            let emit = |received: u64, state: &'static str, stage: Option<&'static str>, error: Option<String>| {
                let _ = app.emit("translator://download", Progress { id: item.id, received, total, state, stage, error });
            };
            let result = run(item, &cancel, |received, stage| emit(received.min(total), "progress", stage, None)).await;
            this.active.lock().unwrap().remove(item.id);
            match result {
                Ok(()) => emit(total, "done", None, None),
                Err(_) if cancel.load(Ordering::SeqCst) => emit(0, "cancelled", None, None),
                Err(e) => emit(0, "error", None, Some(e)),
            }
        });
        Ok(())
    }
}

async fn run(item: &'static Item, cancel: &AtomicBool, progress: impl Fn(u64, Option<&'static str>)) -> Result<(), String> {
    let dir = catalog::item_dir(item);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| format!("Не удалось создать папку {}: {e}", dir.display()))?;
    let client = reqwest::Client::builder()
        .user_agent("KINONYX")
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let mut done_before = 0u64;
    for (i, dl) in item.downloads.iter().enumerate() {
        let target = if dl.unzip { dir.join(format!(".download-{i}.zip")) } else { dir.join(dl.name.unwrap_or(item.file)) };
        if target.is_file() {
            done_before += dl.size; // finished in an earlier, interrupted attempt
            continue;
        }
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
        let part = PathBuf::from(format!("{}.part", target.display()));
        let stage = if item.pip.is_some() { Some("Скачиваю Python…") } else { None };
        fetch(&client, dl.url, &part, cancel, |got| progress(done_before + got, stage)).await?;
        if dl.unzip {
            let (zip, into) = (part.clone(), dir.clone());
            tokio::task::spawn_blocking(move || unzip_flat(&zip, &into))
                .await
                .map_err(|e| e.to_string())??;
            let _ = tokio::fs::remove_file(&part).await;
        } else {
            tokio::fs::rename(&part, &target).await.map_err(|e| e.to_string())?;
        }
        done_before += dl.size;
    }
    if let Some(extra) = item.pip {
        super::pysetup::run(&dir, extra, cancel, |got, stage| progress(done_before + got, Some(stage))).await?;
    }
    if !catalog::installed(item) {
        return Err("Загрузка завершилась, но нужных файлов нет — архив изменился?".into());
    }
    Ok(())
}

async fn fetch(client: &reqwest::Client, url: &str, part: &Path, cancel: &AtomicBool, progress: impl Fn(u64)) -> Result<(), String> {
    let mut have = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    let mut req = client.get(url);
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut resp = req.send().await.map_err(|e| format!("Сеть: {e}"))?;
    if resp.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        return Ok(()); // the .part is already complete
    }
    if !resp.status().is_success() {
        return Err(format!("Сервер ответил {}", resp.status()));
    }
    if have > 0 && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        have = 0; // server ignored Range: start over
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(have > 0)
        .truncate(have == 0)
        .open(part)
        .await
        .map_err(|e| e.to_string())?;
    let mut got = have;
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Сеть: {e}"))? {
        if cancel.load(Ordering::SeqCst) {
            let _ = file.flush().await;
            return Err("cancelled".into());
        }
        file.write_all(&chunk).await.map_err(|e| {
            if e.raw_os_error() == Some(112) {
                "Недостаточно места на диске".to_string()
            } else {
                e.to_string()
            }
        })?;
        got += chunk.len() as u64;
        if last_emit.elapsed().as_millis() > 250 {
            last_emit = std::time::Instant::now();
            progress(got);
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    progress(got);
    Ok(())
}

/// Extracts every file into `into` directly, ignoring folders inside the archive.
fn unzip_flat(zip: &Path, into: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(f).map_err(|e| format!("Архив повреждён: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.enclosed_name().and_then(|p| p.file_name().map(|n| n.to_owned())) else { continue };
        let mut out = std::fs::File::create(into.join(name)).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}
