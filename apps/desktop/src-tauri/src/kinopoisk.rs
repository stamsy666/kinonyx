//! Kinopoisk Unofficial API client — runs on the Rust side so the API key never ships in
//! the webview JS bundle and the calls aren't subject to webview CORS.
//!
//! Responses are cached on disk with a per-endpoint lifetime. The free key allows 500
//! requests a day (checked via /api/v1/api_keys), and film data barely changes, so a
//! re-opened film costs nothing — and loads instantly — even after a restart.
//!
//! Response shapes are returned as-is (`serde_json::Value`); the frontend only reads a few
//! fields per endpoint, so narrowing lives on the TS side next to the components.

use crate::config::AppConfig;
use crate::http::CLIENT;
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const BASE: &str = "https://kinopoiskapiunofficial.tech";

const HOUR: Duration = Duration::from_secs(3600);
const DAY: Duration = Duration::from_secs(24 * 3600);
const WEEK: Duration = Duration::from_secs(7 * 24 * 3600);
const MONTH: Duration = Duration::from_secs(30 * 24 * 3600);

async fn get_json(config: &AppConfig, path: &str, ttl: Duration) -> Result<Value, String> {
    let cache_file = config.cache_dir.as_ref().map(|d| d.join("kp").join(cache_key(path)));
    if let Some(file) = &cache_file {
        if let Some(value) = read_fresh(file.clone(), ttl).await {
            return Ok(value);
        }
    }

    let key = config.kinopoisk_api_key.lock().unwrap().clone();
    if key.is_empty() {
        return Err("API-ключ Kinopoisk не задан — укажите его в настройках".into());
    }
    let res = CLIENT
        .get(format!("{BASE}{path}"))
        .header("X-API-KEY", key)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    match res.status().as_u16() {
        200..=299 => {}
        401 => return Err("Kinopoisk отклонил API-ключ — проверьте его в настройках".into()),
        402 => return Err("Дневной лимит Kinopoisk исчерпан (500 запросов в сутки на бесплатном ключе)".into()),
        429 => return Err("Слишком много запросов к Kinopoisk — подождите пару секунд".into()),
        s => return Err(format!("Kinopoisk HTTP {s}")),
    }
    let body = res.bytes().await.map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;

    if let Some(file) = cache_file {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let Some(parent) = file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(file, &body);
        })
        .await;
    }
    Ok(value)
}

async fn read_fresh(file: PathBuf, ttl: Duration) -> Option<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let age = SystemTime::now().duration_since(std::fs::metadata(&file).ok()?.modified().ok()?).ok()?;
        if age > ttl {
            return None;
        }
        serde_json::from_slice(&std::fs::read(&file).ok()?).ok()
    })
    .await
    .ok()
    .flatten()
}

fn cache_key(path: &str) -> String {
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    format!("{:016x}.json", h.finish())
}

/// True when Settings has "Источник метаданных" set to TMDB — every `kp_*` command below
/// checks this first and, if set, defers entirely to tmdb.rs instead of touching
/// kinopoiskapiunofficial. See tmdb.rs's module doc for why the response shapes still match.
fn uses_tmdb(config: &AppConfig) -> bool {
    config.metadata_source.lock().unwrap().as_str() == "tmdb"
}

#[tauri::command]
pub async fn kp_film(id: u32, config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return crate::tmdb::kp_film(id, &config).await;
    }
    get_json(&config, &format!("/api/v2.2/films/{id}"), WEEK).await
}

/// `kind` is a Kinopoisk collection type, e.g. `TOP_POPULAR_MOVIES`, `TOP_250_MOVIES`.
#[tauri::command]
pub async fn kp_collection(kind: String, page: u32, config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return crate::tmdb::kp_collection(&kind, page, &config).await;
    }
    get_json(&config, &format!("/api/v2.2/films/collections?type={kind}&page={page}"), 6 * HOUR).await
}

/// `/api/v2.2/films` with filters — genre shelves on the catalog pages. `kind` is FILM,
/// TV_SERIES, MINI_SERIES, TV_SHOW or ALL; `order` NUM_VOTE, RATING or YEAR; genre ids
/// come from `/api/v2.2/films/filters` (e.g. 18 = мультфильм, 24 = аниме).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn kp_films_filter(
    kind: String,
    genre: Option<u32>,
    order: Option<String>,
    rating_from: Option<u32>,
    year_from: Option<u32>,
    language: Option<String>,
    page: Option<u32>,
    config: tauri::State<'_, AppConfig>,
) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return crate::tmdb::kp_films_filter(&kind, genre, order.as_deref(), rating_from, year_from, language.as_deref(), page.unwrap_or(1), &config).await;
    }
    let mut path = format!(
        "/api/v2.2/films?type={kind}&order={}&ratingFrom={}&ratingTo=10&yearFrom={}&yearTo=3000&page={}",
        order.as_deref().unwrap_or("NUM_VOTE"),
        rating_from.unwrap_or(0),
        year_from.unwrap_or(1000),
        page.unwrap_or(1),
    );
    if let Some(g) = genre {
        path.push_str(&format!("&genres={g}"));
    }
    get_json(&config, &path, DAY).await
}

/// `{ genres: [{id, genre}], countries: [...] }` — the canonical genre id↔name table,
/// same taxonomy the `genres` field on every film/collection record draws from. Static
/// for all practical purposes (a genre being added is a rare, deliberate KP change), so
/// it's cached for a month rather than re-fetched — lets genre chips on a film's page
/// resolve straight to a working `kp_films_filter` genre id instead of a hardcoded list.
#[tauri::command]
pub async fn kp_genres(config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return crate::tmdb::kp_genres(&config).await;
    }
    get_json(&config, "/api/v2.2/films/filters", MONTH).await
}

#[tauri::command]
pub async fn kp_search(keyword: String, config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return crate::tmdb::kp_search(&keyword, &config).await;
    }
    let q = urlencoding::encode(&keyword);
    get_json(&config, &format!("/api/v2.1/films/search-by-keyword?keyword={q}"), DAY).await
}

/// `image_type` — STILL (кадры), POSTER, FAN_ART, PROMO, WALLPAPER, COVER, SCREENSHOT, ...
#[tauri::command]
pub async fn kp_images(
    id: u32,
    image_type: String,
    page: u32,
    config: tauri::State<'_, AppConfig>,
) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return crate::tmdb::kp_images(id, &image_type, &config).await;
    }
    get_json(&config, &format!("/api/v2.2/films/{id}/images?type={image_type}&page={page}"), WEEK).await
}

/// `{ total, items: [{filmId, nameRu, posterUrl, posterUrlPreview, relationType, ...}] }` —
/// note `filmId`, not `kinopoiskId` (this endpoint's own naming, kept as-is per the
/// module doc; the frontend adapts it when building a card).
#[tauri::command]
pub async fn kp_similars(id: u32, config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return crate::tmdb::kp_similars(id, &config).await;
    }
    get_json(&config, &format!("/api/v2.2/films/{id}/similars"), WEEK).await
}

#[tauri::command]
pub async fn kp_staff(film_id: u32, config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return crate::tmdb::kp_staff(film_id, &config).await;
    }
    get_json(&config, &format!("/api/v1/staff?filmId={film_id}"), WEEK).await
}

/// A person's own profile — bio fields, facts and their filmography. Same `/api/v1/staff`
/// resource as `kp_staff` above, but keyed by person id instead of film id.
#[tauri::command]
pub async fn kp_person(id: u32, config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return crate::tmdb::kp_person(id, &config).await;
    }
    get_json(&config, &format!("/api/v1/staff/{id}"), WEEK).await
}

#[tauri::command]
pub async fn kp_videos(id: u32, config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return crate::tmdb::kp_videos(id, &config).await;
    }
    get_json(&config, &format!("/api/v2.2/films/{id}/videos"), WEEK).await
}

/// No TMDB equivalent — these are Kinopoisk's own links to legal CIS streaming
/// platforms. Under the TMDB source this always answers empty (unused by the frontend
/// today either way — see CLAUDE.md).
#[tauri::command]
pub async fn kp_external_sources(id: u32, config: tauri::State<'_, AppConfig>) -> Result<Value, String> {
    if uses_tmdb(&config) {
        return Ok(serde_json::json!({ "total": 0, "items": [] }));
    }
    get_json(&config, &format!("/api/v2.2/films/{id}/external_sources?page=1"), DAY).await
}
