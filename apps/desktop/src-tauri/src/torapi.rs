//! TorAPI client (github.com/Lifailon/TorAPI) — torrent search across
//! RuTracker/Kinozal/RuTor/NoNameClub. Base URL is configurable at runtime
//! (`config::set_torapi_base_url`) because it points at the user's own
//! deployment, which may move.
//!
//! Contract (from the project's `docs.md`, confirmed 2026-09-22):
//!   GET /api/search/title/<provider|all>?query=<title>&year=<year>&page=<n>
//!   GET /api/search/id/<provider>?query=<Id>
//! Field names vary slightly per tracker (Seeds vs seeds, Magnet vs magnet,
//! etc. — see docs.md's "Key Field Mappings" table) — returned as-is and
//! normalized on the TS side rather than duplicated here.

use crate::config::AppConfig;
use crate::http::CLIENT;
use serde_json::Value;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// The public deployment used when the bundled local TorAPI can't run. Also what older
/// versions saved as "the" address, so a saved value equal to it means "automatic".
const REMOTE_DEFAULT: &str = "https://ohnofreefilms.vercel.app";

/// TorAPI (MIT, github.com/Lifailon/TorAPI) bundled as `torapi/torapi.cjs` and run by a Node
/// sidecar on a random localhost port: searches then leave from the user's own connection
/// instead of a shared `*.vercel.app` host that Russian ISPs block.
pub struct LocalTorapi(pub Mutex<Option<CommandChild>>);

static LOCAL_PORT: AtomicU16 = AtomicU16::new(0);

fn script_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(d) = app.path().resource_dir() {
        dirs.push(d);
    }
    if let Some(d) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
        dirs.push(d);
    }
    dirs.push(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    dirs.into_iter().map(|d| d.join("torapi").join("torapi.cjs")).find(|p| p.is_file())
}

pub fn spawn(app: &tauri::AppHandle) {
    let Some(script) = script_path(app) else {
        eprintln!("[torapi] torapi.cjs not found, using the public deployment");
        return;
    };
    let Ok(listener) = std::net::TcpListener::bind("127.0.0.1:0") else { return };
    let Ok(addr) = listener.local_addr() else { return };
    drop(listener);
    let port = addr.port();
    // Node doesn't take the `\\?\` verbatim prefix some Windows paths come with.
    let script = script.to_string_lossy().trim_start_matches(r"\\?\").to_string();
    match app.shell().sidecar("node") {
        Ok(cmd) => match cmd.args([script.as_str(), "--port", &port.to_string()]).spawn() {
            Ok((_rx, child)) => {
                if let Some(state) = app.try_state::<LocalTorapi>() {
                    *state.0.lock().unwrap() = Some(child);
                }
                LOCAL_PORT.store(port, Ordering::SeqCst);
                println!("[torapi] local TorAPI on 127.0.0.1:{port}");
            }
            Err(e) => eprintln!("[torapi] failed to start: {e}"),
        },
        Err(e) => eprintln!("[torapi] node sidecar not found ({e})"),
    }
}

pub fn kill(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<LocalTorapi>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
    LOCAL_PORT.store(0, Ordering::SeqCst);
}

/// The local instance's address once it accepts connections (waits briefly right after launch).
async fn local_base() -> Option<String> {
    let port = LOCAL_PORT.load(Ordering::SeqCst);
    if port == 0 {
        return None;
    }
    for _ in 0..40 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return Some(format!("http://127.0.0.1:{port}"));
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    None
}

/// Addresses to try, best first: a custom one from Settings alone; otherwise the local
/// TorAPI, then the public one as a fallback.
async fn bases(config: &AppConfig) -> Vec<String> {
    let saved = config.torapi_base_url.lock().unwrap().trim_end_matches('/').to_string();
    if !saved.is_empty() && saved != REMOTE_DEFAULT {
        return vec![saved];
    }
    let mut list = Vec::new();
    if let Some(local) = local_base().await {
        list.push(local);
    }
    list.push(REMOTE_DEFAULT.to_string());
    list
}

/// The address a health check should look at (see diagnostics.rs).
pub async fn resolved_base(config: &AppConfig) -> String {
    bases(config).await.remove(0)
}

async fn get_json(url: String) -> Result<Value, String> {
    let res = CLIENT.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("TorAPI HTTP {} ({url})", res.status()));
    }
    res.json::<Value>().await.map_err(|e| e.to_string())
}

async fn get_any(config: &AppConfig, path: &str) -> Result<Value, String> {
    let mut last = String::from("нет адреса TorAPI");
    for base in bases(config).await {
        match get_json(format!("{base}{path}")).await {
            Ok(v) => return Ok(v),
            Err(e) => last = e,
        }
    }
    Err(last)
}

#[tauri::command]
pub async fn torapi_search_title(
    query: String,
    year: Option<i32>,
    page: Option<u32>,
    provider: Option<String>,
    config: tauri::State<'_, AppConfig>,
) -> Result<Value, String> {
    let provider = provider.unwrap_or_else(|| "all".into());
    let q = urlencoding::encode(&query);
    let mut url = format!("/api/search/title/{provider}?query={q}");
    if let Some(y) = year {
        url.push_str(&format!("&year={y}"));
    }
    if let Some(p) = page {
        url.push_str(&format!("&page={p}"));
    }
    get_any(&config, &url).await
}

#[tauri::command]
pub async fn torapi_search_id(
    provider: String,
    id: String,
    config: tauri::State<'_, AppConfig>,
) -> Result<Value, String> {
    let q = urlencoding::encode(&id);
    get_any(&config, &format!("/api/search/id/{provider}?query={q}")).await
}
