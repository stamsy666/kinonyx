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

fn base_url(config: &AppConfig) -> String {
    config.torapi_base_url.lock().unwrap().trim_end_matches('/').to_string()
}

async fn get_json(url: String) -> Result<Value, String> {
    let res = CLIENT.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("TorAPI HTTP {} ({url})", res.status()));
    }
    res.json::<Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn torapi_search_title(
    query: String,
    year: Option<i32>,
    page: Option<u32>,
    provider: Option<String>,
    config: tauri::State<'_, AppConfig>,
) -> Result<Value, String> {
    let base = base_url(&config);
    let provider = provider.unwrap_or_else(|| "all".into());
    let q = urlencoding::encode(&query);
    let mut url = format!("{base}/api/search/title/{provider}?query={q}");
    if let Some(y) = year {
        url.push_str(&format!("&year={y}"));
    }
    if let Some(p) = page {
        url.push_str(&format!("&page={p}"));
    }
    get_json(url).await
}

#[tauri::command]
pub async fn torapi_search_id(
    provider: String,
    id: String,
    config: tauri::State<'_, AppConfig>,
) -> Result<Value, String> {
    let base = base_url(&config);
    let q = urlencoding::encode(&id);
    get_json(format!("{base}/api/search/id/{provider}?query={q}")).await
}
