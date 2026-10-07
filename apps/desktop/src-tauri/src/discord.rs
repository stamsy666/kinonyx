//! Discord Rich Presence: "Watching KINONYX" with the film's title and the app's logo.
//!
//! Talks to the Discord *desktop client* over its local IPC pipe — nothing leaves the
//! computer except what Discord itself shows. Needs an application (client) id from
//! discord.com/developers (the app's name there is what appears after "Watching"); it is
//! entered in Settings, or baked in at build time via `KINONYX_DISCORD_APP_ID`. Without
//! Discord running every call is a quiet no-op, and it reconnects by itself later.

use crate::config::AppConfig;
use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use std::sync::{Arc, Mutex};

/// The logo shown next to the status. Discord fetches it itself, so it has to be a public URL.
const LOGO_URL: &str = "https://raw.githubusercontent.com/stamsy666/kinonyx/main/apps/desktop/src/assets/logo-mark.png";

#[derive(Default)]
pub struct Discord(Arc<Mutex<Option<(String, DiscordIpcClient)>>>);

pub fn effective_app_id(config: &AppConfig) -> String {
    let saved = config.discord_app_id.lock().unwrap().trim().to_string();
    if !saved.is_empty() {
        return saved;
    }
    option_env!("KINONYX_DISCORD_APP_ID").unwrap_or(DEFAULT_APP_ID).trim().to_string()
}

/// KINONYX's own Discord application (its name is what shows after "Watching"). An application
/// id is public — every Rich Presence client sends it — so it can ship in the source; the
/// Settings field only overrides it.
const DEFAULT_APP_ID: &str = "1557455261772419182";

fn with_client<R>(discord: &Mutex<Option<(String, DiscordIpcClient)>>, app_id: &str, f: impl FnOnce(&mut DiscordIpcClient) -> Result<R, String>) -> Option<R> {
    let mut slot = discord.lock().unwrap();
    if slot.as_ref().is_none_or(|(id, _)| id != app_id) {
        *slot = None;
        let mut client = DiscordIpcClient::new(app_id);
        // Discord not running (or not installed): nothing to do, try again on the next update.
        client.connect().ok()?;
        *slot = Some((app_id.to_string(), client));
    }
    let (_, client) = slot.as_mut().unwrap();
    match f(client) {
        Ok(r) => Some(r),
        Err(_) => {
            // The pipe broke (Discord restarted) — reconnect from scratch next time.
            *slot = None;
            None
        }
    }
}

/// `started_at`: unix seconds the viewing began (shows "elapsed" under the title); omit while paused.
#[tauri::command]
pub async fn discord_set(
    details: String,
    state: Option<String>,
    started_at: Option<i64>,
    config: tauri::State<'_, AppConfig>,
    discord: tauri::State<'_, Discord>,
) -> Result<(), String> {
    let app_id = effective_app_id(&config);
    if app_id.is_empty() {
        return Ok(());
    }
    let discord = discord.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_client(&discord, &app_id, |client| {
            let mut activity = Activity::new()
                .activity_type(ActivityType::Watching)
                .details(details.as_str())
                .assets(Assets::new().large_image(LOGO_URL).large_text("KINONYX"));
            if let Some(s) = state.as_deref().filter(|s| !s.is_empty()) {
                activity = activity.state(s);
            }
            if let Some(t) = started_at {
                activity = activity.timestamps(Timestamps::new().start(t * 1000));
            }
            client.set_activity(activity).map_err(|e| e.to_string())
        });
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn discord_clear(config: tauri::State<'_, AppConfig>, discord: tauri::State<'_, Discord>) -> Result<(), String> {
    let app_id = effective_app_id(&config);
    if app_id.is_empty() {
        return Ok(());
    }
    let discord = discord.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_client(&discord, &app_id, |client| client.clear_activity().map_err(|e| e.to_string()));
    })
    .await
    .map_err(|e| e.to_string())
}
