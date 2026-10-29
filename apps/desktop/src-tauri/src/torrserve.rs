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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
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
            crate::elog!("[torrserve] no app data dir ({e}), not starting sidecar");
            return;
        }
    };
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        crate::elog!("[torrserve] can't create {}: {e}", data_dir.display());
        return;
    }
    let path = data_dir.to_string_lossy().into_owned();
    let app = app.clone();
    tauri::async_runtime::spawn(async move { start(app, path).await });
}

/// Why TorrServer is not running, in words for the viewer ("" = nothing wrong).
static PROBLEM: Mutex<String> = Mutex::new(String::new());

fn set_problem(text: impl Into<String>) {
    *PROBLEM.lock().unwrap() = text.into();
}

pub fn problem() -> String {
    PROBLEM.lock().unwrap().clone()
}

#[tauri::command]
pub fn torrserve_problem() -> String {
    problem()
}

fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn free_port() -> Option<u16> {
    std::net::TcpListener::bind(("127.0.0.1", 0)).ok()?.local_addr().ok().map(|a| a.port())
}

async fn echo_ok(port: u16) -> bool {
    CLIENT
        .get(format!("http://127.0.0.1:{port}/echo"))
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .is_ok_and(|r| r.status().is_success())
}

/// Starts the sidecar and makes sure it answers. 8090 is a popular port — another program (or a TorrServer left
/// from an earlier run) may hold it, and then the player would talk to the wrong thing or to nothing: so a free port
/// is taken in that case, and if the process dies at once (port taken after all, blocked by an antivirus) it is tried
/// again on a fresh one. Whatever goes wrong is kept in `PROBLEM` for the error window and Diagnostics.
async fn start(app: tauri::AppHandle, path: String) {
    let config = app.state::<AppConfig>();
    let preferred = config.torrserve_port.load(Ordering::Relaxed);

    // A TorrServer already answers there (kept from before) — use it as it is.
    if echo_ok(preferred).await {
        println!("[torrserve] already running on {preferred}");
        set_problem("");
        let base = format!("http://127.0.0.1:{preferred}");
        if let Err(e) = tune(&base).await {
            crate::elog!("[torrserve] couldn't apply streaming settings: {e}");
        }
        return;
    }

    let mut port = if port_free(preferred) { preferred } else { free_port().unwrap_or(preferred) };
    if port != preferred {
        crate::elog!("[torrserve] port {preferred} is taken by another program, using {port}");
    }

    for attempt in 1..=3 {
        config.torrserve_port.store(port, Ordering::Relaxed);
        let cmd = match app.shell().sidecar("torrserve") {
            Ok(cmd) => cmd,
            Err(e) => {
                crate::elog!("[torrserve] sidecar binary not found ({e})");
                set_problem("torrserve.exe не найден рядом с программой — вероятно, его удалил антивирус; переустановите KINONYX и добавьте папку установки в исключения антивируса");
                return;
            }
        };
        let (mut rx, child) = match cmd.args(["--port", &port.to_string(), "--path", &path]).spawn() {
            Ok(pair) => pair,
            Err(e) => {
                crate::elog!("[torrserve] failed to start sidecar: {e}");
                set_problem(format!("не удалось запустить torrserve.exe: {e} — возможно, его блокирует антивирус"));
                return;
            }
        };
        if let Some(state) = app.try_state::<TorrserveProcess>() {
            *state.0.lock().unwrap() = Some(child);
        }

        // Everything the process says is kept in the log; its end is noted here.
        let exited = Arc::new(AtomicBool::new(false));
        let last_line = Arc::new(Mutex::new(String::new()));
        {
            let (exited, last_line) = (exited.clone(), last_line.clone());
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                            let text = String::from_utf8_lossy(&b).trim().to_string();
                            if !text.is_empty() {
                                println!("[torrserve] {text}");
                                *last_line.lock().unwrap() = text;
                            }
                        }
                        CommandEvent::Error(e) => crate::elog!("[torrserve] {e}"),
                        CommandEvent::Terminated(t) => {
                            crate::elog!("[torrserve] exited (code {:?})", t.code);
                            exited.store(true, Ordering::Relaxed);
                            set_problem(format!("TorrServer завершился (код {:?})", t.code));
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }

        let mut up = false;
        for _ in 0..75 {
            if exited.load(Ordering::Relaxed) {
                break;
            }
            if echo_ok(port).await {
                up = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        if up {
            println!("[torrserve] sidecar started on {port}");
            set_problem("");
            let base = format!("http://127.0.0.1:{port}");
            match tune(&base).await {
                Ok(()) => println!("[torrserve] streaming settings applied"),
                Err(e) => crate::elog!("[torrserve] couldn't apply streaming settings: {e}"),
            }
            return;
        }
        if exited.load(Ordering::Relaxed) && attempt < 3 {
            let said = last_line.lock().unwrap().clone();
            crate::elog!("[torrserve] attempt {attempt} on port {port} failed ({said}), trying another port");
            if let Some(p) = free_port() {
                port = p;
            }
            continue;
        }
        let said = last_line.lock().unwrap().clone();
        crate::elog!("[torrserve] didn't come up on {port} ({said})");
        let base = if said.is_empty() { String::new() } else { format!(": {said}") };
        set_problem(format!("TorrServer не запустился{base} — проверьте, не блокирует ли его антивирус или брандмауэр"));
        return;
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

fn base_url(config: &AppConfig) -> String {
    format!("http://127.0.0.1:{}", config.torrserve_port.load(Ordering::Relaxed))
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
