//! Torrserve sidecar: turns a magnet link into a local HTTP stream URL that
//! the mpv adapter can just `loadfile`. Torrserve is a separate long-lived
//! process (unlike libmpv, which is a library linked into this binary) —
//! bundled as a Tauri `externalBin` sidecar (see `tauri.conf.json`
//! `bundle.externalBin` and `capabilities/default.json`'s `shell:allow-execute`
//! scope) and spawned/killed alongside the app window.
//!
//! HTTP contract, confirmed against a live TorrServer MatriX.141:
//!   GET  /echo                                   → version string (health check)
//!   POST /torrents {"action":"add","link":…}     → {"hash":…, "stat_string":"Torrent added"}
//!   POST /torrents {"action":"get","hash":…}     → {…, "file_stats":[{"id":1,"path":…,"length":…}]}
//!        (file_stats is absent until metadata arrives from peers; ids are 1-based)
//!   GET  /stream/<name>?link=<hash>&index=<id>&play=true → 206 byte ranges, so mpv can seek

use crate::config::AppConfig;
use crate::http::CLIENT;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub struct TorrserveProcess(pub Mutex<Option<CommandChild>>);

/// Spawns the Torrserve sidecar in the background. Best-effort: a missing
/// binary (not yet downloaded — see CLAUDE.md setup step) logs a warning
/// instead of failing app startup, so the rest of KINONYX (browsing/
/// metadata) still works without it.
pub fn spawn(app: &tauri::AppHandle) {
    // Without --path TorrServer keeps its DB/settings next to its own exe — for an
    // installed build that's Program Files, which isn't writable. The per-user app data
    // dir is.
    let data_dir = match app.path().app_data_dir() {
        Ok(dir) => dir.join("torrserve"),
        Err(e) => {
            eprintln!("[torrserve] no app data dir ({e}), not starting sidecar");
            return;
        }
    };
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        eprintln!("[torrserve] can't create {}: {e}", data_dir.display());
        return;
    }
    let port = state_port(app).to_string();
    let path = data_dir.to_string_lossy().into_owned();

    let shell = app.shell();
    match shell.sidecar("torrserve") {
        Ok(cmd) => match cmd.args(["--port", &port, "--path", &path]).spawn() {
            Ok((_rx, child)) => {
                if let Some(state) = app.try_state::<TorrserveProcess>() {
                    *state.0.lock().unwrap() = Some(child);
                }
                println!("[torrserve] sidecar started");
                let base = format!("http://127.0.0.1:{port}");
                tauri::async_runtime::spawn(async move {
                    match tune(&base).await {
                        Ok(()) => println!("[torrserve] streaming settings applied"),
                        Err(e) => eprintln!("[torrserve] couldn't apply streaming settings: {e}"),
                    }
                });
            }
            Err(e) => eprintln!("[torrserve] failed to start sidecar: {e}"),
        },
        Err(e) => eprintln!(
            "[torrserve] sidecar binary not found ({e}) — place it at src-tauri/binaries/torrserve-<target-triple>.exe, see CLAUDE.md"
        ),
    }
}

/// TorrServer's defaults are tuned for low-end TV boxes, not for streaming 1080p/4K on a
/// desktop. Measured on the official Ubuntu ISO torrent (a big legal swarm), 40 s of
/// player-style stream reads, fresh process per run:
///   defaults (25 connections, 64 MiB cache)  → 132 Mbit/s — stuck at exactly 25 active
///                                              peers out of ~470 known
///   512 MiB cache + 150 / 300 connections    → 229 / 329 Mbit/s average,
///                                              260–320 / 490–555 Mbit/s once ramped up
/// The cache also bounds how far ahead TorrServer downloads (ReaderReadAHead % of it), i.e.
/// how many pieces can be in flight across peers at once.
const STREAMING_SETTINGS: &[(&str, i64)] = &[
    ("CacheSize", 512 * 1024 * 1024),
    ("ConnectionsLimit", 250),
    ("ReaderReadAHead", 95),
    // Default 30 s: a short pause/seek gap dropped the torrent and all its peers,
    // and resuming meant finding them again from scratch.
    ("TorrentDisconnectTimeout", 90),
];

async fn tune(base: &str) -> Result<(), String> {
    // The process was just spawned — wait for its HTTP server.
    let mut up = false;
    for _ in 0..75 {
        if CLIENT
            .get(format!("{base}/echo"))
            .timeout(Duration::from_millis(500))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
        {
            up = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    if !up {
        return Err("TorrServer didn't come up".into());
    }

    // `set` replaces the whole settings object (missing fields become zero values), so
    // read-modify-write instead of sending only our keys.
    let mut sets: Value = CLIENT
        .post(format!("{base}/settings"))
        .json(&json!({ "action": "get" }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let obj = sets.as_object_mut().ok_or("settings is not an object")?;
    if STREAMING_SETTINGS.iter().all(|(k, v)| obj.get(*k).and_then(Value::as_i64) == Some(*v)) {
        return Ok(());
    }
    for (k, v) in STREAMING_SETTINGS {
        obj.insert((*k).to_string(), json!(v));
    }
    let res = CLIENT
        .post(format!("{base}/settings"))
        .json(&json!({ "action": "set", "sets": sets }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    Ok(())
}

pub fn kill(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<TorrserveProcess>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

fn state_port(app: &tauri::AppHandle) -> u16 {
    app.try_state::<AppConfig>().map(|c| c.torrserve_port).unwrap_or(8090)
}

fn base_url(config: &AppConfig) -> String {
    format!("http://127.0.0.1:{}", config.torrserve_port)
}

#[tauri::command]
pub async fn torrserve_health(config: tauri::State<'_, AppConfig>) -> Result<bool, String> {
    Ok(CLIENT
        .get(format!("{}/echo", base_url(&config)))
        .timeout(Duration::from_millis(800))
        .send()
        .await
        .is_ok_and(|r| r.status().is_success()))
}

async fn torrents_action(config: &AppConfig, body: Value) -> Result<Value, String> {
    let res = CLIENT
        .post(format!("{}/torrents", base_url(config)))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("TorrServer HTTP {}", res.status()));
    }
    res.json::<Value>().await.map_err(|e| e.to_string())
}

/// `link` may be a magnet, a bare info-hash, or an http(s) URL of a .torrent file —
/// TorrServer accepts all three.
#[tauri::command]
pub async fn ts_add_magnet(magnet: String, config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    torrents_action(&config, json!({ "action": "add", "link": magnet, "save_to_db": false })).await
}

#[tauri::command]
pub async fn ts_get_torrent(hash: String, config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    torrents_action(&config, json!({ "action": "get", "hash": hash })).await
}

/// Pure string builder, no network — the mpv adapter just gets handed this URL.
#[tauri::command]
pub fn ts_stream_url(
    hash: String,
    file_index: u32,
    file_name: Option<String>,
    config: tauri::State<'_, AppConfig>,
) -> String {
    let name = file_name.unwrap_or_else(|| "file.mkv".into());
    let encoded_name = urlencoding::encode(&name);
    format!(
        "{}/stream/{encoded_name}?link={hash}&index={file_index}&play=true",
        base_url(&config)
    )
}
