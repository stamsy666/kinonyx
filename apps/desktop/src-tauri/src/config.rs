//! Runtime configuration: Kinopoisk API key, TorAPI base URL, TorrServer port.
//!
//! Defaults come from `.env` (see `.env.example`); anything changed on the Settings
//! screen is saved to `settings.json` in the app config dir and wins over `.env` on the
//! next start. The Kinopoisk key is only ever sent to the webview masked — every request
//! that needs it goes through a Rust command (see `kinopoisk.rs`).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppConfig {
    pub kinopoisk_api_key: Mutex<String>,
    pub tmdb_api_key: Mutex<String>,
    /// "kinopoisk" (default) or "tmdb" — which backend `kp_*` commands hit (see kinopoisk.rs).
    pub metadata_source: Mutex<String>,
    /// "" (off) | "chrome" | "edge" | "firefox" — whose YouTube session yt-dlp borrows to
    /// get past "Sign in to confirm you're not a bot" (see ytdlp.rs).
    pub youtube_cookies_browser: Mutex<String>,
    pub torapi_base_url: Mutex<String>,
    /// First-run wizard finished (or skipped because keys already existed).
    pub setup_done: Mutex<bool>,
    /// Discord application id for Rich Presence (see discord.rs); empty = use the built-in one, if any.
    pub discord_app_id: Mutex<String>,
    pub torrserve_port: u16,
    pub cache_dir: Option<PathBuf>,
    settings_file: Option<PathBuf>,
}

#[derive(Serialize, Deserialize, Default)]
struct Saved {
    kinopoisk_api_key: Option<String>,
    tmdb_api_key: Option<String>,
    metadata_source: Option<String>,
    youtube_cookies_browser: Option<String>,
    torapi_base_url: Option<String>,
    setup_done: Option<bool>,
    discord_app_id: Option<String>,
}

impl AppConfig {
    pub fn load(config_dir: Option<PathBuf>, cache_dir: Option<PathBuf>) -> Self {
        // A missing .env is a valid (if limited) state, surfaced to the UI via
        // `config_status` rather than failing the whole app to start.
        let _ = dotenvy::dotenv();
        let settings_file = config_dir.map(|d| d.join("settings.json"));
        let saved: Saved = settings_file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        AppConfig {
            kinopoisk_api_key: Mutex::new(
                saved
                    .kinopoisk_api_key
                    .unwrap_or_else(|| std::env::var("KINOPOISK_API_KEY").unwrap_or_default()),
            ),
            // A key typed in Settings wins; then `.env`; then the one baked in at build time
            // (`KINONYX_DEFAULT_TMDB_KEY` set when building the installer) so TMDB works out
            // of the box without the key living in the source tree.
            tmdb_api_key: Mutex::new(
                saved
                    .tmdb_api_key
                    .filter(|k| !k.trim().is_empty())
                    .or_else(|| std::env::var("TMDB_API_KEY").ok().filter(|k| !k.trim().is_empty()))
                    .or_else(|| option_env!("KINONYX_DEFAULT_TMDB_KEY").map(str::to_string))
                    .unwrap_or_default(),
            ),
            metadata_source: Mutex::new(saved.metadata_source.unwrap_or_else(|| "kinopoisk".into())),
            youtube_cookies_browser: Mutex::new(saved.youtube_cookies_browser.unwrap_or_default()),
            torapi_base_url: Mutex::new(saved.torapi_base_url.unwrap_or_else(|| {
                std::env::var("TORAPI_BASE_URL").unwrap_or_else(|_| "https://ohnofreefilms.vercel.app".into())
            })),
            setup_done: Mutex::new(saved.setup_done.unwrap_or(false)),
            discord_app_id: Mutex::new(saved.discord_app_id.unwrap_or_default()),
            torrserve_port: std::env::var("TORRSERVE_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(8090),
            cache_dir,
            settings_file,
        }
    }

    fn persist(&self) -> Result<(), String> {
        let Some(file) = &self.settings_file else {
            return Err("нет папки настроек".into());
        };
        let saved = Saved {
            kinopoisk_api_key: Some(self.kinopoisk_api_key.lock().unwrap().clone()),
            tmdb_api_key: Some(self.tmdb_api_key.lock().unwrap().clone()),
            metadata_source: Some(self.metadata_source.lock().unwrap().clone()),
            youtube_cookies_browser: Some(self.youtube_cookies_browser.lock().unwrap().clone()),
            torapi_base_url: Some(self.torapi_base_url.lock().unwrap().clone()),
            setup_done: Some(*self.setup_done.lock().unwrap()),
            discord_app_id: Some(self.discord_app_id.lock().unwrap().clone()),
        };
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&saved).map_err(|e| e.to_string())?;
        std::fs::write(file, json).map_err(|e| e.to_string())
    }
}

/// `a1b2c3d4-…-00000000d4e5` → `a1b2…d4e5`: enough to recognise which key is set.
fn mask(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "•".repeat(chars.len());
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

#[derive(Serialize)]
pub struct ConfigStatus {
    pub kinopoisk_key_masked: Option<String>,
    pub tmdb_key_masked: Option<String>,
    pub metadata_source: String,
    pub youtube_cookies_browser: String,
    pub torapi_base_url: String,
    pub setup_done: bool,
    /// Whether Discord status can work at all (an id was entered or built in).
    pub discord_ready: bool,
    pub discord_app_id: String,
    pub torrserve_port: u16,
}

#[tauri::command]
pub fn config_status(config: tauri::State<AppConfig>) -> ConfigStatus {
    let key = config.kinopoisk_api_key.lock().unwrap().clone();
    let tmdb_key = config.tmdb_api_key.lock().unwrap().clone();
    ConfigStatus {
        kinopoisk_key_masked: (!key.is_empty()).then(|| mask(&key)),
        tmdb_key_masked: (!tmdb_key.is_empty()).then(|| mask(&tmdb_key)),
        metadata_source: config.metadata_source.lock().unwrap().clone(),
        youtube_cookies_browser: config.youtube_cookies_browser.lock().unwrap().clone(),
        torapi_base_url: config.torapi_base_url.lock().unwrap().clone(),
        setup_done: *config.setup_done.lock().unwrap(),
        discord_ready: !crate::discord::effective_app_id(&config).is_empty(),
        discord_app_id: config.discord_app_id.lock().unwrap().clone(),
        torrserve_port: config.torrserve_port,
    }
}

#[tauri::command]
pub fn set_torapi_base_url(url: String, config: tauri::State<AppConfig>) -> Result<(), String> {
    let url = url.trim().trim_end_matches('/').to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Ссылка должна начинаться с http:// или https://".into());
    }
    *config.torapi_base_url.lock().unwrap() = url;
    config.persist()
}

#[tauri::command]
pub fn set_kinopoisk_api_key(key: String, config: tauri::State<AppConfig>) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Ключ пустой".into());
    }
    *config.kinopoisk_api_key.lock().unwrap() = key;
    config.persist()
}

#[tauri::command]
pub fn set_tmdb_api_key(key: String, config: tauri::State<AppConfig>) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Ключ пустой".into());
    }
    *config.tmdb_api_key.lock().unwrap() = key;
    config.persist()
}

#[tauri::command]
pub fn set_youtube_cookies_browser(browser: String, config: tauri::State<AppConfig>) -> Result<(), String> {
    if !["", "chrome", "edge", "firefox"].contains(&browser.as_str()) {
        return Err("Неизвестный браузер".into());
    }
    *config.youtube_cookies_browser.lock().unwrap() = browser;
    config.persist()
}

#[tauri::command]
pub fn set_discord_app_id(id: String, config: tauri::State<AppConfig>) -> Result<(), String> {
    let id = id.trim().to_string();
    // A Discord application id is a snowflake: 17–20 digits.
    if !id.is_empty() && !(id.chars().all(|c| c.is_ascii_digit()) && (17..=20).contains(&id.len())) {
        return Err("Application ID — это число из 17–20 цифр (Discord Developer Portal → ваше приложение → General Information)".into());
    }
    *config.discord_app_id.lock().unwrap() = id;
    config.persist()
}

#[tauri::command]
pub fn set_setup_done(done: bool, config: tauri::State<AppConfig>) -> Result<(), String> {
    *config.setup_done.lock().unwrap() = done;
    config.persist()
}

#[tauri::command]
pub fn set_metadata_source(source: String, config: tauri::State<AppConfig>) -> Result<(), String> {
    if source != "kinopoisk" && source != "tmdb" {
        return Err("Неизвестный источник".into());
    }
    *config.metadata_source.lock().unwrap() = source;
    config.persist()
}

#[cfg(test)]
mod tests {
    use super::mask;

    #[test]
    fn masks_keys() {
        assert_eq!(mask("a1b2c3d4-0000-4000-8000-00000000d4e5"), "a1b2…d4e5");
        assert_eq!(mask("short"), "•••••");
    }
}
