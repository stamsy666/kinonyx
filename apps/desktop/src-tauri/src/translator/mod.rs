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
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use catalog::Kind;
use downloads::Downloads;
use engines::Engines;
use session::{FileOptions, FileSession, Options, Session};

/// Models stay loaded this long after the last session, so zapping between channels doesn't
/// reload them; after that the ~4 GB of video memory is given back.
const IDLE_UNLOAD_SECS: u64 = 300;

#[derive(Default)]
pub struct Translator {
    downloads: Arc<Downloads>,
    engines: Arc<Engines>,
    session: Mutex<Option<Session>>,
    /// A film being translated (the player plays it itself; this decodes its audio ahead).
    film: Mutex<Option<FileSession>>,
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
        if let Some(f) = self.film.lock().await.take() {
            f.shutdown();
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
    if state.session.lock().await.is_some() || state.film.lock().await.is_some() {
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

/// Starts translating the film at `options.url` from `options.start` (the player plays the film
/// itself). Returns the session id the cues and status events carry.
#[tauri::command]
pub async fn translator_film_start(app: AppHandle, state: State<'_, Translator>, options: FileOptions) -> Result<u64, String> {
    let mut slot = state.film.lock().await;
    if let Some(old) = slot.take() {
        old.shutdown();
    }
    state.generation.fetch_add(1, Ordering::SeqCst);
    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let s = FileSession::start(app, state.engines.clone(), id, options).await?;
    *slot = Some(s);
    Ok(id)
}

#[tauri::command]
pub async fn translator_stop(state: State<'_, Translator>, session: Option<u64>) -> Result<(), String> {
    let mut slot = state.session.lock().await;
    let mut film = state.film.lock().await;
    let live_stops = slot.as_ref().is_some_and(|s| session.map_or(true, |id| s.id == id));
    let film_stops = film.as_ref().is_some_and(|f| session.map_or(true, |id| f.id == id));
    if live_stops || film_stops {
        if live_stops {
            slot.take().unwrap().shutdown();
        }
        if film_stops {
            film.take().unwrap().shutdown();
        }
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
    if let Some(f) = state.film.lock().await.take() {
        f.shutdown();
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

/// Voice search: one recording, recognised with the same whisper-server the translator uses.
/// The body is raw little-endian f32 samples, mono at `asr::SAMPLE_RATE` (24 kHz), sent as the
/// IPC raw payload; the model id travels in the `x-model` header. Returns the recognised text
/// (empty when nothing intelligible was said).
///
/// The model server is started if needed and given back after a short idle — unless a
/// translation session is running, which owns it.
#[tauri::command]
pub async fn translator_transcribe(app: AppHandle, state: State<'_, Translator>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let model_id = request
        .headers()
        .get("x-model")
        .and_then(|v| v.to_str().ok())
        .ok_or("не указана модель распознавания")?
        .to_string();
    let item = catalog::item(&model_id).ok_or("неизвестная модель распознавания")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("ожидалась запись звука".into());
    };
    let samples: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    if samples.len() < (asr::SAMPLE_RATE as usize) / 4 {
        return Ok(String::new());
    }

    let port = state.engines.asr(&app, item).await?;
    let client = reqwest::Client::new();
    let reply = asr::transcribe(&client, port, asr::Request { audio: &samples, language: Some("ru"), prompt: None }).await;

    // Give the model back after a minute of quiet, unless a translation session is using it.
    let gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        let state = handle.state::<Translator>();
        if state.generation.load(Ordering::SeqCst) == gen && state.session.lock().await.is_none() && state.film.lock().await.is_none() {
            state.engines.stop_all().await;
        }
    });

    let text = reply?
        .segments
        .iter()
        .filter(|s| asr::reject_reason(s, None).is_none())
        .map(|s| s.text.trim())
        .collect::<Vec<_>>()
        .join(" ");
    Ok(text.trim().trim_end_matches(['.', '!', '?', '…']).trim().to_string())
}

/// The visible player's current `time-pos` — lets the pipeline tell how much lookahead is
/// left and commit a phrase early rather than show it late.
#[tauri::command]
pub async fn translator_position(state: State<'_, Translator>, session: u64, position: f64) -> Result<(), String> {
    if let Some(s) = state.session.lock().await.as_ref().filter(|s| s.id == session) {
        s.visible_pos.store(position.to_bits(), Ordering::SeqCst);
    }
    if let Some(f) = state.film.lock().await.as_ref().filter(|f| f.id == session) {
        f.on_position(position);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct AudioDevice {
    pub name: String,
    pub description: String,
}

/// The sound outputs mpv can play to (`audio-device`), for the choice in Settings → Звук. A throwaway core with
/// no video and no sound reads mpv's own list, so the names are exactly what `audio-device` accepts.
#[tauri::command]
pub async fn audio_devices() -> Result<Vec<AudioDevice>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mpv = mpv::Mpv::new("devices", &[("vo", "null".into()), ("ao", "null".into()), ("idle", "yes".into())])?;
        let raw = mpv.get("audio-device-list").ok_or("mpv gave no device list")?;
        let list: Vec<serde_json::Value> = serde_json::from_str(&raw).map_err(|e| format!("device list: {e}"))?;
        Ok(list
            .iter()
            .filter_map(|d| {
                let name = d.get("name")?.as_str()?.to_string();
                let description = d.get("description").and_then(|v| v.as_str()).unwrap_or(&name).to_string();
                Some(AudioDevice { name, description })
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[derive(Serialize)]
pub struct ProbeTrack {
    pub kind: String,
    pub lang: String,
    pub title: String,
    pub codec: String,
    /// "3840×2160" for the picture, "5.1" for the sound.
    pub detail: String,
    pub default: bool,
}

#[derive(Serialize)]
pub struct ProbeResult {
    pub duration: f64,
    pub tracks: Vec<ProbeTrack>,
}

/// What is inside a release before it is watched: the pictures, the sound tracks and the subtitles of the file. A throwaway
/// mpv core opens the stream paused (no picture, no sound), waits for the headers and reads its `track-list`.
#[tauri::command]
pub async fn probe_tracks(url: String) -> Result<ProbeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mpv = mpv::Mpv::new(
            "probe",
            &[
                ("vo", "null".into()),
                ("ao", "null".into()),
                ("idle", "yes".into()),
                ("pause", "yes".into()),
                ("audio-display", "no".into()),
                ("network-timeout", "20".into()),
                ("cache", "no".into()),
            ],
        )?;
        mpv.command(&["loadfile", &url, "replace"])?;
        let started = std::time::Instant::now();
        loop {
            let (event, error) = mpv.wait_event(0.5);
            if event == mpv::EVENT_FILE_LOADED {
                break;
            }
            if event == mpv::EVENT_END_FILE && error < 0 {
                return Err("Не удалось прочитать файл раздачи".to_string());
            }
            if event == mpv::EVENT_SHUTDOWN || started.elapsed() > std::time::Duration::from_secs(40) {
                return Err("Файл раздачи не открылся вовремя — возможно, у неё мало сидов".to_string());
            }
        }
        let count = mpv.get("track-list/count").and_then(|c| c.parse::<usize>().ok()).unwrap_or(0);
        let mut tracks = Vec::new();
        for i in 0..count {
            let p = |name: &str| mpv.get(&format!("track-list/{i}/{name}")).unwrap_or_default();
            let kind = p("type");
            let detail = match kind.as_str() {
                "video" => {
                    let (w, h) = (p("demux-w"), p("demux-h"));
                    if w.is_empty() || h.is_empty() { String::new() } else { format!("{w}×{h}") }
                }
                "audio" => match p("demux-channel-count").as_str() {
                    "" => String::new(),
                    "1" => "1.0".to_string(),
                    "2" => "2.0".to_string(),
                    "6" => "5.1".to_string(),
                    "8" => "7.1".to_string(),
                    n => format!("{n} кан."),
                },
                _ => String::new(),
            };
            if kind == "video" || kind == "audio" || kind == "sub" {
                tracks.push(ProbeTrack { kind, lang: p("lang"), title: p("title"), codec: p("codec"), detail, default: p("default") == "yes" });
            }
        }
        let duration = mpv.get_f64("duration").unwrap_or(0.0);
        Ok(ProbeResult { duration, tracks })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod probe_tests {
    /// Needs libmpv next to the test binary and a file: `KINONYX_PROBE_URL=<url or path> cargo test --lib probe -- --ignored`.
    #[test]
    #[ignore]
    fn probe_reads_the_tracks_of_a_file() {
        let url = std::env::var("KINONYX_PROBE_URL").expect("set KINONYX_PROBE_URL");
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let out = rt.block_on(super::probe_tracks(url)).expect("probe failed");
        for t in &out.tracks {
            println!("{} | {} | {} | {} | {}", t.kind, t.lang, t.title, t.codec, t.detail);
        }
        assert!(out.tracks.iter().any(|t| t.kind == "video"));
    }
}
