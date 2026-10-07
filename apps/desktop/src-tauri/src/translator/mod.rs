//! Local live-TV translator: speech recognition (whisper.cpp) + translation (Hy-MT2 on
//! llama.cpp), fully on this machine, with the broadcast delayed so subtitles are ready
//! before the line is spoken. See session.rs for how the pieces fit together.

mod asr;
mod catalog;
mod downloads;
mod engines;
mod hls;
mod mpv;
mod mt;
mod pysetup;
mod relay;
mod session;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use catalog::Kind;
use downloads::Downloads;
use engines::Engines;
use session::{Options, Session};

/// Models stay loaded this long after the last session, so zapping between channels doesn't
/// reload them; after that the ~4 GB of video memory is given back.
const IDLE_UNLOAD_SECS: u64 = 300;

#[derive(Default)]
pub struct Translator {
    downloads: Arc<Downloads>,
    engines: Arc<Engines>,
    session: Mutex<Option<Session>>,
    next_id: AtomicU64,
    generation: Arc<AtomicU64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStatus {
    id: &'static str,
    kind: Kind,
    title: &'static str,
    note: &'static str,
    size: u64,
    installed: bool,
    downloading: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReply {
    root: String,
    items: Vec<ItemStatus>,
    /// whisper-server.exe ships with the app; false only in a broken/dev install.
    bundled: bool,
    /// Total video memory of the NVIDIA card, MiB (None if nvidia-smi isn't available).
    vram_mb: Option<u64>,
}

impl Translator {
    /// Ends any running session and kills the model servers — before an update, so the
    /// installer isn't blocked by their locked .exe files.
    pub async fn stop_for_update(&self) {
        if let Some(s) = self.session.lock().await.take() {
            s.shutdown();
        }
        self.engines.stop_all().await;
    }
}

/// Asked once per app run: video memory decides whether voice-over fits next to the models.
fn vram_mb() -> Option<u64> {
    use std::os::windows::process::CommandExt as _;
    static CACHE: std::sync::OnceLock<Option<u64>> = std::sync::OnceLock::new();
    *CACHE.get_or_init(|| {
        let out = std::process::Command::new("nvidia-smi")
            .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
            .creation_flags(0x0800_0000)
            .output()
            .ok()?;
        String::from_utf8_lossy(&out.stdout).lines().next()?.trim().parse().ok()
    })
}

#[tauri::command]
pub fn translator_status(app: AppHandle, state: State<'_, Translator>) -> StatusReply {
    StatusReply {
        root: catalog::root().to_string_lossy().into_owned(),
        items: catalog::ITEMS
            .iter()
            .map(|i| ItemStatus {
                id: i.id,
                kind: i.kind,
                title: i.title,
                note: i.note,
                size: catalog::total_size(i),
                installed: catalog::installed(i),
                downloading: state.downloads.is_active(i.id),
            })
            .collect(),
        bundled: engines::bundled(&app, "whisper-server.exe").is_some(),
        vram_mb: vram_mb(),
    }
}

#[tauri::command]
pub fn translator_download(app: AppHandle, state: State<'_, Translator>, id: String) -> Result<(), String> {
    let item = catalog::item(&id).ok_or("неизвестный компонент")?;
    state.downloads.start(app, item)
}

#[tauri::command]
pub fn translator_cancel_download(state: State<'_, Translator>, id: String) {
    state.downloads.cancel(&id);
}

#[tauri::command]
pub async fn translator_delete(state: State<'_, Translator>, id: String) -> Result<(), String> {
    let item = catalog::item(&id).ok_or("неизвестный компонент")?;
    // A loaded model file can't be deleted on Windows — unload first.
    if state.session.lock().await.is_some() {
        return Err("Сначала выключите перевод в плеере".into());
    }
    state.engines.stop_all().await;
    let path = catalog::item_path(item);
    let r = if catalog::is_dir_item(item) { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) };
    r.map_err(|e| format!("Не удалось удалить: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    session: u64,
    play_url: String,
}

#[tauri::command]
pub async fn translator_start(app: AppHandle, state: State<'_, Translator>, options: Options) -> Result<Started, String> {
    let mut slot = state.session.lock().await;
    if let Some(old) = slot.take() {
        old.shutdown();
    }
    state.generation.fetch_add(1, Ordering::SeqCst);
    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let s = Session::start(app, state.engines.clone(), id, options).await?;
    let reply = Started { session: s.id, play_url: s.play_url.clone() };
    *slot = Some(s);
    Ok(reply)
}

#[tauri::command]
pub async fn translator_stop(state: State<'_, Translator>, session: Option<u64>) -> Result<(), String> {
    let mut slot = state.session.lock().await;
    if slot.as_ref().is_some_and(|s| session.map_or(true, |id| s.id == id)) {
        slot.take().unwrap().shutdown();
        let gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (generation, engines) = (state.generation.clone(), state.engines.clone());
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(IDLE_UNLOAD_SECS)).await;
            if generation.load(Ordering::SeqCst) == gen {
                engines.stop_all().await;
            }
        });
    }
    Ok(())
}

/// Switching a feature OFF means no helper process stays behind (the models otherwise linger
/// a few minutes so zapping between channels doesn't reload them): `"voice"` kills only the
/// voice-over server, anything else ends the session and kills every engine right now.
#[tauri::command]
pub async fn translator_release(state: State<'_, Translator>, what: String) -> Result<(), String> {
    if what == "voice" {
        if let Some(s) = state.session.lock().await.as_ref() {
            s.drop_voice();
        }
        state.engines.stop_tts().await;
        return Ok(());
    }
    if let Some(s) = state.session.lock().await.take() {
        s.shutdown();
    }
    // Cancels an idle-unload timer that might still be pending.
    state.generation.fetch_add(1, Ordering::SeqCst);
    state.engines.stop_all().await;
    Ok(())
}

/// Voice-over on/off for the running session (the broadcast isn't restarted).
#[tauri::command]
pub async fn translator_voice(app: AppHandle, state: State<'_, Translator>, session: u64, on: bool) -> Result<(), String> {
    if let Some(s) = state.session.lock().await.as_ref().filter(|s| s.id == session) {
        s.set_voice(app, state.engines.clone(), on);
    }
    Ok(())
}

/// The visible player's current `time-pos` — lets the pipeline tell how much lookahead is
/// left and commit a phrase early rather than show it late.
#[tauri::command]
pub async fn translator_position(state: State<'_, Translator>, session: u64, position: f64) -> Result<(), String> {
    if let Some(s) = state.session.lock().await.as_ref().filter(|s| s.id == session) {
        s.visible_pos.store(position.to_bits(), Ordering::SeqCst);
    }
    Ok(())
}
