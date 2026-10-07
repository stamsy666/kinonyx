//! TMDB client — alternate metadata backend, picked via `AppConfig::metadata_source`
//! ("kinopoisk" | "tmdb"). kinopoisk.rs's `kp_*` commands dispatch here when the setting is
//! "tmdb"; every response below is translated into the exact JSON shape
//! kinopoiskapiunofficial already returns, so the frontend (api.ts + every screen that
//! consumes `Kp*` types) never has to know which backend actually answered.
//!
//! TMDB splits movies and TV into separate id spaces and endpoints (Kinopoisk uses one id
//! for both) — every command here that takes a bare id tries `/movie/{id}` first, then
//! `/tv/{id}` on 404. Commands that already know the kind (`kp_films_filter`) route
//! directly. This costs one extra request only for a series' first (uncached) fetch.

use crate::config::AppConfig;
use crate::http::CLIENT;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const BASE: &str = "https://api.themoviedb.org/3";
const IMG: &str = "https://image.tmdb.org/t/p";

const HOUR: Duration = Duration::from_secs(3600);
const DAY: Duration = Duration::from_secs(24 * 3600);
const WEEK: Duration = Duration::from_secs(7 * 24 * 3600);
const MONTH: Duration = Duration::from_secs(30 * 24 * 3600);

// ---------- transport (mirrors kinopoisk.rs's get_json/read_fresh/cache_key) ----------

/// `Ok(None)` on a 404 (not a real error — lets the movie/tv fallback chains tell "try the
/// other endpoint" apart from an actual failure), same cache-key namespace concern as
/// kinopoisk.rs but under its own `tmdb/` subfolder so the two backends never shadow
/// each other's cached files for the same path.
async fn fetch(config: &AppConfig, path: &str, ttl: Duration) -> Result<Option<Value>, String> {
    let cache_file = config.cache_dir.as_ref().map(|d| d.join("tmdb").join(cache_key(path)));
    if let Some(file) = &cache_file {
        if let Some(value) = read_fresh(file.clone(), ttl).await {
            return Ok(Some(value));
        }
    }

    let key = config.tmdb_api_key.lock().unwrap().clone();
    if key.is_empty() {
        return Err("API-ключ TMDB не задан — укажите его в настройках".into());
    }
    let sep = if path.contains('?') { '&' } else { '?' };
    let url = format!("{BASE}{path}{sep}api_key={key}&language=ru-RU");
    // A film page fires several of these at once (staff/images/similar/genres), doubled by
    // React StrictMode in dev, plus a burst of poster/backdrop image-proxy fetches on the
    // same shared CLIENT (http.rs) — a lot of brand-new TLS connections to TMDB's two hosts
    // at once, and a plain `curl` for the exact same URL right after a failure succeeds in
    // well under a second, so this is connection-establishment flakiness under that burst,
    // not TMDB being unreachable or rate-limiting. Up to two retries with backoff; a real
    // outage or bad key still surfaces (every attempt fails the same way).
    let mut attempt: u64 = 0;
    let res = loop {
        match CLIENT.get(&url).send().await {
            Ok(r) => break r,
            Err(_) if attempt < 2 => {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(300 * attempt)).await;
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    match res.status().as_u16() {
        200..=299 => {}
        404 => return Ok(None),
        401 => return Err("TMDB отклонил API-ключ — проверьте его в настройках".into()),
        429 => return Err("Слишком много запросов к TMDB — подождите пару секунд".into()),
        s => return Err(format!("TMDB HTTP {s}")),
    }
    let body = res.bytes().await.map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;

    if let Some(file) = cache_file {
        let data = body.to_vec();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let Some(parent) = file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(file, &data);
        })
        .await;
    }
    Ok(Some(value))
}

async fn get_json(config: &AppConfig, path: &str, ttl: Duration) -> Result<Value, String> {
    fetch(config, path, ttl).await?.ok_or_else(|| "TMDB HTTP 404".to_string())
}

/// TMDB numbers movies and TV shows separately (a movie and a series can share an id), the
/// app has one id per title. Every TV id this module hands out is shifted up by this much,
/// so an id alone says which endpoint it belongs to. (u32 holds up to ~4.29e9; real TMDB ids
/// are far below the offset.)
const TV_OFFSET: u32 = 1_000_000_000;

fn app_id(raw: &Value, kind: &str) -> Value {
    match (raw.as_u64(), kind) {
        (Some(id), "tv") => json!(id + TV_OFFSET as u64),
        _ => raw.clone(),
    }
}

/// Tries `/movie/{id}{suffix}` then `/tv/{id}{suffix}` — or goes straight to TV for a shifted
/// TV id. Returns which kind answered alongside the payload.
async fn fetch_media(config: &AppConfig, id: u32, suffix: &str, ttl: Duration) -> Result<(Value, &'static str), String> {
    if id >= TV_OFFSET {
        let real = id - TV_OFFSET;
        return match fetch(config, &format!("/tv/{real}{suffix}"), ttl).await? {
            Some(v) => Ok((v, "tv")),
            None => Err("Сериал не найден в TMDB".into()),
        };
    }
    if let Some(v) = fetch(config, &format!("/movie/{id}{suffix}"), ttl).await? {
        return Ok((v, "movie"));
    }
    if let Some(v) = fetch(config, &format!("/tv/{id}{suffix}"), ttl).await? {
        return Ok((v, "tv"));
    }
    Err("Не найдено ни в фильмах, ни в сериалах TMDB".into())
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

// ---------- small helpers ----------

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(str::to_string)
}
fn f(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}
fn image_url(size: &str, path: Option<&str>) -> Option<String> {
    path.map(|p| format!("{IMG}/{size}{p}"))
}
fn year_of(date: Option<&str>) -> Option<i64> {
    date.and_then(|d| d.get(0..4)).and_then(|y| y.parse().ok())
}

/// The title/original-title field is `title`/`original_title` on a movie record,
/// `name`/`original_name` on a TV one.
fn title_of(v: &Value, kind: &str) -> Option<String> {
    s(v, if kind == "tv" { "name" } else { "title" })
}
fn original_title_of(v: &Value, kind: &str) -> Option<String> {
    s(v, if kind == "tv" { "original_name" } else { "original_title" })
}
fn date_of(v: &Value, kind: &str) -> Option<String> {
    s(v, if kind == "tv" { "first_air_date" } else { "release_date" })
}

// ---------- genre id → name (movie table only — see CLAUDE.md for why) ----------

async fn genre_names(config: &AppConfig) -> Result<HashMap<i64, String>, String> {
    let v = get_json(config, "/genre/movie/list", MONTH).await?;
    let mut map = HashMap::new();
    for g in v["genres"].as_array().into_iter().flatten() {
        if let (Some(id), Some(name)) = (g["id"].as_i64(), s(g, "name")) {
            map.insert(id, name);
        }
    }
    Ok(map)
}

fn genres_of(v: &Value, names: &HashMap<i64, String>) -> Vec<Value> {
    // Full objects when present (a single film/show record), otherwise just ids (list/
    // discover/search rows) resolved through the movie genre table.
    if let Some(full) = v["genres"].as_array() {
        return full.iter().filter_map(|g| s(g, "name")).map(|name| json!({ "genre": name })).collect();
    }
    v["genre_ids"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|id| id.as_i64())
        .filter_map(|id| names.get(&id))
        .map(|name| json!({ "genre": name }))
        .collect()
}

// ---------- kp_film ----------

pub async fn kp_film(id: u32, config: &AppConfig) -> Result<Value, String> {
    let (v, kind) = fetch_media(config, id, "", WEEK).await?;
    let names = genre_names(config).await.unwrap_or_default();
    let runtime = if kind == "tv" {
        v["episode_run_time"].as_array().and_then(|a| a.first()).and_then(|x| x.as_i64())
    } else {
        v["runtime"].as_i64()
    };
    let countries: Vec<Value> = v["production_countries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| s(c, "name"))
        .map(|name| json!({ "country": name }))
        .collect();
    let date = date_of(&v, kind);
    Ok(json!({
        "kinopoiskId": id,
        "nameRu": title_of(&v, kind),
        "nameOriginal": original_title_of(&v, kind),
        "year": year_of(date.as_deref()),
        "filmLength": runtime,
        "description": s(&v, "overview"),
        "ratingKinopoisk": f(&v, "vote_average"),
        "posterUrl": image_url("original", v["poster_path"].as_str()),
        "posterUrlPreview": image_url("w300", v["poster_path"].as_str()),
        "coverUrl": image_url("original", v["backdrop_path"].as_str()),
        "genres": genres_of(&v, &names),
        "countries": countries,
        "type": if kind == "tv" { "TV_SERIES" } else { "FILM" },
        "premiereWorld": date,
    }))
}

// ---------- kp_collection ----------

pub async fn kp_collection(kind: &str, page: u32, config: &AppConfig) -> Result<Value, String> {
    // Kinopoisk's own collection names (Home and the Kinopoisk catalogs use them) plus the
    // TMDB-native ones the TMDB catalogs ask for.
    let (path, media) = match kind {
        "TOP_250_MOVIES" | "TMDB_MOVIE_TOP_RATED" => ("/movie/top_rated", "movie"),
        "TOP_AWAIT_FILMS" | "TMDB_MOVIE_UPCOMING" => ("/movie/upcoming", "movie"),
        "TMDB_MOVIE_NOW_PLAYING" => ("/movie/now_playing", "movie"),
        "TMDB_TRENDING_MOVIE" => ("/trending/movie/week", "movie"),
        "POPULAR_SERIES" | "TMDB_TV_POPULAR" => ("/tv/popular", "tv"),
        "TOP_250_TV_SHOWS" | "TMDB_TV_TOP_RATED" => ("/tv/top_rated", "tv"),
        "TMDB_TV_ON_THE_AIR" => ("/tv/on_the_air", "tv"),
        "TMDB_TRENDING_TV" => ("/trending/tv/week", "tv"),
        _ => ("/movie/popular", "movie"),
    };
    // TMDB's own "popular"/"on the air" TV lists are full of talk shows, news and soaps — not
    // what a series catalog is for. Ask discover for the same ranking without those genres.
    let path_query = match kind {
        "POPULAR_SERIES" | "TMDB_TV_POPULAR" => format!("/discover/tv?sort_by=popularity.desc&vote_count.gte=100&{TV_NOISE}&page={page}"),
        "TMDB_TV_ON_THE_AIR" => {
            let today = chrono::Utc::now().date_naive();
            let from = today - chrono::Duration::days(10);
            format!(
                "/discover/tv?sort_by=popularity.desc&vote_count.gte=30&air_date.gte={from}&air_date.lte={today}&{TV_NOISE}&page={page}"
            )
        }
        _ => format!("{path}?page={page}"),
    };
    let v = get_json(config, &path_query, 6 * HOUR).await?;
    map_list(&v, config, media).await
}

/// Talk shows (10767), news (10763), soaps (10766), reality (10764).
const TV_NOISE: &str = "without_genres=10767,10763,10766,10764";

// ---------- kp_films_filter ----------

#[allow(clippy::too_many_arguments)]
pub async fn kp_films_filter(
    kind: &str,
    genre: Option<u32>,
    order: Option<&str>,
    rating_from: Option<u32>,
    year_from: Option<u32>,
    language: Option<&str>,
    page: u32,
    config: &AppConfig,
) -> Result<Value, String> {
    let is_tv = kind == "TV_SERIES" || kind == "MINI_SERIES" || kind == "TV_SHOW";
    let media = if is_tv { "tv" } else { "movie" };
    let sort_by = match order.unwrap_or("NUM_VOTE") {
        "RATING" => "vote_average.desc",
        "YEAR" => {
            if is_tv {
                "first_air_date.desc"
            } else {
                "primary_release_date.desc"
            }
        }
        _ => "popularity.desc",
    };
    let date_key = if is_tv { "first_air_date.gte" } else { "primary_release_date.gte" };
    // vote_count floor keeps a handful of near-zero-vote titles from topping a
    // vote_average.desc sort — TMDB has no other way to filter that noise out.
    let mut path = format!(
        "/discover/{media}?sort_by={sort_by}&vote_average.gte={}&vote_count.gte=10&{date_key}={}-01-01&page={page}",
        rating_from.unwrap_or(0),
        year_from.unwrap_or(1000),
    );
    if let Some(g) = genre {
        path.push_str(&format!("&with_genres={g}"));
    }
    // TMDB has no "anime" genre — it's animation whose original language is Japanese.
    if let Some(l) = language.filter(|l| l.chars().all(|c| c.is_ascii_alphabetic()) && !l.is_empty()) {
        path.push_str(&format!("&with_original_language={l}"));
    }
    let v = get_json(config, &path, DAY).await?;
    map_list(&v, config, media).await
}

// ---------- kp_genres ----------

pub async fn kp_genres(config: &AppConfig) -> Result<Value, String> {
    let names = genre_names(config).await?;
    let genres: Vec<Value> = names.iter().map(|(id, name)| json!({ "id": id, "genre": name })).collect();
    Ok(json!({ "genres": genres }))
}

// ---------- kp_search ----------

pub async fn kp_search(keyword: &str, config: &AppConfig) -> Result<Value, String> {
    let q = urlencoding::encode(keyword);
    let v = get_json(config, &format!("/search/multi?query={q}"), DAY).await?;
    let names = genre_names(config).await.unwrap_or_default();
    let films: Vec<Value> = v["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| matches!(r["media_type"].as_str(), Some("movie") | Some("tv")))
        .map(|r| {
            let kind = r["media_type"].as_str().unwrap_or("movie");
            json!({
                "filmId": app_id(&r["id"], kind),
                "nameRu": title_of(r, kind),
                "nameEn": original_title_of(r, kind),
                "year": year_of(date_of(r, kind).as_deref()),
                "rating": f(r, "vote_average").map(|n| format!("{n:.1}")),
                "description": s(r, "overview"),
                "posterUrl": image_url("original", r["poster_path"].as_str()),
                "posterUrlPreview": image_url("w300", r["poster_path"].as_str()),
                "genres": genres_of(r, &names),
            })
        })
        .collect();
    Ok(json!({ "films": films }))
}

// ---------- kp_images ----------

pub async fn kp_images(id: u32, image_type: &str, config: &AppConfig) -> Result<Value, String> {
    let (v, _) = fetch_media(config, id, "/images", WEEK).await?;
    let key = if image_type == "POSTER" { "posters" } else { "backdrops" };
    let items: Vec<Value> = v[key]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|i| i["file_path"].as_str())
        .map(|p| {
            json!({
                "imageUrl": format!("{IMG}/original{p}"),
                "previewUrl": format!("{IMG}/w300{p}"),
            })
        })
        .collect();
    Ok(json!({ "total": items.len(), "items": items }))
}

// ---------- kp_similars ----------

pub async fn kp_similars(id: u32, config: &AppConfig) -> Result<Value, String> {
    let (v, kind) = fetch_media(config, id, "/similar", WEEK).await?;
    let items: Vec<Value> = v["results"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| {
            json!({
                "filmId": app_id(&r["id"], kind),
                "nameRu": title_of(r, kind),
                "nameOriginal": original_title_of(r, kind),
                "posterUrl": image_url("original", r["poster_path"].as_str()),
                "posterUrlPreview": image_url("w300", r["poster_path"].as_str()),
            })
        })
        .collect();
    Ok(json!({ "total": items.len(), "items": items }))
}

// ---------- kp_staff ----------

pub async fn kp_staff(film_id: u32, config: &AppConfig) -> Result<Value, String> {
    let (v, _) = fetch_media(config, film_id, "/credits", WEEK).await?;
    let items: Vec<Value> = v["cast"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| {
            json!({
                "staffId": c["id"],
                "nameEn": s(c, "name"),
                "posterUrl": image_url("w300", c["profile_path"].as_str()),
                "professionText": s(c, "character"),
                "professionKey": "ACTOR",
            })
        })
        .collect();
    Ok(json!(items))
}

// ---------- kp_person ----------

pub async fn kp_person(id: u32, config: &AppConfig) -> Result<Value, String> {
    let v = get_json(config, &format!("/person/{id}?append_to_response=movie_credits"), WEEK).await?;
    let birthday = s(&v, "birthday");
    let deathday = s(&v, "deathday");
    let age = age_of(birthday.as_deref(), deathday.as_deref());
    let facts: Vec<Value> = s(&v, "biography")
        .map(|b| b.split("\n\n").map(str::trim).filter(|p| !p.is_empty()).map(|p| json!(p)).collect())
        .unwrap_or_default();
    let films: Vec<Value> = v["movie_credits"]["cast"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| {
            json!({
                "filmId": c["id"],
                "nameRu": title_of(c, "movie"),
                "nameEn": original_title_of(c, "movie"),
                "year": year_of(date_of(c, "movie").as_deref()),
                "rating": f(c, "vote_average").map(|n| format!("{n:.1}")),
            })
        })
        .collect();
    Ok(json!({
        "personId": id,
        "nameEn": s(&v, "name"),
        "posterUrl": image_url("original", v["profile_path"].as_str()),
        "birthday": birthday,
        "death": deathday,
        "age": age,
        "birthplace": s(&v, "place_of_birth"),
        "profession": s(&v, "known_for_department"),
        "facts": facts,
        "films": films,
    }))
}

fn age_of(birthday: Option<&str>, deathday: Option<&str>) -> Option<i64> {
    let by = year_of(birthday)?;
    let dy = year_of(deathday).unwrap_or_else(|| {
        let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs();
        1970 + (now / (365 * 24 * 3600)) as i64
    });
    Some(dy - by)
}

// ---------- kp_videos ----------

pub async fn kp_videos(id: u32, config: &AppConfig) -> Result<Value, String> {
    let (v, _) = fetch_media(config, id, "/videos", WEEK).await?;
    let items: Vec<Value> = v["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["site"].as_str() == Some("YouTube"))
        .filter_map(|r| Some((s(r, "key")?, r)))
        .map(|(key, r)| {
            json!({
                "url": format!("https://www.youtube.com/watch?v={key}"),
                "name": s(r, "name"),
                "site": "YouTube",
            })
        })
        .collect();
    Ok(json!({ "total": items.len(), "items": items }))
}

// ---------- shared list mapper (collection + discover) ----------

async fn map_list(v: &Value, config: &AppConfig, kind: &str) -> Result<Value, String> {
    let names = genre_names(config).await.unwrap_or_default();
    let results = v["results"].as_array().cloned().unwrap_or_default();
    let items: Vec<Value> = results
        .iter()
        .map(|r| {
            json!({
                "kinopoiskId": app_id(&r["id"], kind),
                "nameRu": title_of(r, kind),
                "nameOriginal": original_title_of(r, kind),
                "year": year_of(date_of(r, kind).as_deref()),
                "posterUrl": image_url("original", r["poster_path"].as_str()),
                "posterUrlPreview": image_url("w300", r["poster_path"].as_str()),
                "coverUrl": image_url("original", r["backdrop_path"].as_str()),
                "description": s(r, "overview"),
                "ratingKinopoisk": f(r, "vote_average"),
                "genres": genres_of(r, &names),
            })
        })
        .collect();
    Ok(json!({
        "total": v["total_results"].as_i64().unwrap_or(items.len() as i64),
        "totalPages": v["total_pages"].as_i64().unwrap_or(1),
        "items": items,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_movie_and_tv_titles() {
        let movie = json!({ "title": "Дюна", "original_title": "Dune" });
        assert_eq!(title_of(&movie, "movie").as_deref(), Some("Дюна"));
        let tv = json!({ "name": "Офис", "original_name": "The Office" });
        assert_eq!(title_of(&tv, "tv").as_deref(), Some("Офис"));
        assert_eq!(original_title_of(&tv, "tv").as_deref(), Some("The Office"));
    }

    #[test]
    fn tv_ids_are_shifted_so_a_series_never_collides_with_a_movie() {
        assert_eq!(app_id(&json!(1396), "tv"), json!(1_000_001_396u64));
        assert_eq!(app_id(&json!(1396), "movie"), json!(1396));
        assert_eq!(app_id(&json!("x"), "tv"), json!("x"));
    }

    #[test]
    fn year_of_parses_leading_four_digits() {
        assert_eq!(year_of(Some("2024-03-15")), Some(2024));
        assert_eq!(year_of(None), None);
        assert_eq!(year_of(Some("")), None);
    }

    #[test]
    fn genres_of_prefers_full_objects_over_ids() {
        let mut names = HashMap::new();
        names.insert(28, "Боевик".to_string());
        let with_ids = json!({ "genre_ids": [28] });
        assert_eq!(genres_of(&with_ids, &names), vec![json!({ "genre": "Боевик" })]);
        let with_full = json!({ "genres": [{ "id": 28, "name": "Боевик" }] });
        assert_eq!(genres_of(&with_full, &names), vec![json!({ "genre": "Боевик" })]);
    }

    #[test]
    fn age_of_uses_deathday_when_present() {
        assert_eq!(age_of(Some("1956-07-09"), Some("2008-01-22")), Some(52));
        assert_eq!(age_of(None, None), None);
    }
}
