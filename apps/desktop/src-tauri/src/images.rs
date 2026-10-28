//! `kpimg` custom protocol: an image proxy with a persistent disk cache.
//!
//! Kinopoisk poster URLs are a redirect chain across three hosts —
//! kinopoiskapiunofficial.tech → st.kp.yandex.net → avatars.mds.yandex.net — measured at
//! 5–8 s for a single cold poster, and the last hop is only cacheable for 10 minutes, so
//! the webview kept paying for it. Here the chain runs over the shared pooled client
//! (~1 s once connections are warm) and the resulting bytes are kept on disk, so every
//! later view — including after a restart — is a local file read.
//!
//! The webview requests `http://kpimg.localhost/<encoded original url>` (what
//! `convertFileSrc(url, "kpimg")` produces on Windows). Only Kinopoisk image hosts are
//! proxied — this must not become a general-purpose fetcher.

use crate::http::CLIENT;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::http::{Request, Response};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

const ALLOWED_HOSTS: &[&str] =
    &["kinopoiskapiunofficial.tech", "st.kp.yandex.net", "avatars.mds.yandex.net", "image.tmdb.org"];

/// The picture host of the "Для взрослых" section (thumbnails and category pictures).
fn is_adult_cdn(host: &str) -> bool {
    host.ends_with(".vidb365.com")
}

/// A page of the section asks for dozens of pictures at once, and that CDN answers a burst with refusals and resets for some
/// of them (they showed as covers that never loaded). So: a few at a time, each tried again after a short wait.
static ADULT_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(6);
const ADULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async fn fetch_adult_image(parsed: &reqwest::Url) -> Result<Vec<u8>, String> {
    let _slot = ADULT_SLOTS.acquire().await.map_err(|e| e.to_string())?;
    let mut last = String::from("no attempt");
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(500 * attempt)).await;
        }
        let sent = CLIENT
            .get(parsed.clone())
            .header("User-Agent", ADULT_UA)
            .timeout(Duration::from_secs(15))
            .send()
            .await;
        match sent {
            Ok(res) if res.status().is_success() => match res.bytes().await {
                Ok(b) if !b.is_empty() => return Ok(b.to_vec()),
                Ok(_) => last = "empty".into(),
                Err(e) => last = e.to_string(),
            },
            // The picture itself is gone or not allowed: asking again won't change that.
            Ok(res) if matches!(res.status().as_u16(), 403 | 404 | 410) => return Err(format!("upstream HTTP {}", res.status())),
            Ok(res) => last = format!("upstream HTTP {}", res.status()),
            Err(e) => last = e.to_string(),
        }
    }
    Err(last)
}

/// Where TMDB posters can be had when `image.tmdb.org` itself is not reachable (it is blocked in some countries): the mirrors
/// Lampa uses — the same path on another host. A host that fails is left alone for a few minutes, and the order of the
/// rest stays as it is, so a working mirror is used for as long as it works.
const TMDB_IMAGE_MIRRORS: &[&str] = &["imagetmdb.com", "nl.imagetmdb.com", "de.imagetmdb.com", "pl.imagetmdb.com"];
const MIRROR_REST: Duration = Duration::from_secs(300);
static RESTING: Mutex<Vec<(String, Instant)>> = Mutex::new(Vec::new());

fn resting(host: &str) -> bool {
    let mut list = RESTING.lock().unwrap();
    list.retain(|(_, until)| *until > Instant::now());
    list.iter().any(|(h, _)| h == host)
}

fn rest(host: &str) {
    RESTING.lock().unwrap().push((host.to_string(), Instant::now() + MIRROR_REST));
}

/// The bytes of a TMDB image from the first host that gives them.
async fn fetch_tmdb_image(parsed: &reqwest::Url) -> Result<Vec<u8>, String> {
    let hosts: Vec<&str> = std::iter::once("image.tmdb.org").chain(TMDB_IMAGE_MIRRORS.iter().copied()).collect();
    let mut tried_any = false;
    let mut last = String::from("no host");
    // Hosts at rest go last rather than nowhere: if all of them are resting, the picture is still asked for.
    let (fresh, tired): (Vec<&str>, Vec<&str>) = hosts.into_iter().partition(|h| !resting(h));
    for host in fresh.into_iter().chain(tired) {
        let mut url = parsed.clone();
        if url.set_host(Some(host)).is_err() {
            continue;
        }
        tried_any = true;
        match CLIENT.get(url).timeout(Duration::from_secs(12)).send().await {
            Ok(res) if res.status().is_success() => match res.bytes().await {
                Ok(b) if !b.is_empty() => return Ok(b.to_vec()),
                Ok(_) => last = format!("{host}: empty"),
                Err(e) => last = format!("{host}: {e}"),
            },
            // A 404 is the picture's own answer, not the host's failure.
            Ok(res) if res.status().as_u16() == 404 => return Err("upstream HTTP 404".into()),
            Ok(res) => {
                last = format!("{host}: HTTP {}", res.status());
                rest(host);
            }
            Err(e) => {
                last = format!("{host}: {e}");
                rest(host);
            }
        }
    }
    if tried_any {
        Err(last)
    } else {
        Err("no host".into())
    }
}

pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let cache_dir = ctx.app_handle().path().app_cache_dir().ok().map(|d| d.join("img"));
    let encoded = request.uri().path().trim_start_matches('/').to_string();
    tauri::async_runtime::spawn(async move {
        let response = match serve(&encoded, cache_dir).await {
            Ok((bytes, mime)) => Response::builder()
                .status(200)
                .header("Content-Type", mime)
                .header("Cache-Control", "max-age=31536000, immutable")
                .body(bytes),
            Err(e) => Response::builder().status(502).header("Content-Type", "text/plain").body(e.into_bytes()),
        };
        responder.respond(response.expect("static response parts are valid"));
    });
}

async fn serve(encoded: &str, cache_dir: Option<PathBuf>) -> Result<(Vec<u8>, &'static str), String> {
    let url = urlencoding::decode(encoded).map_err(|e| e.to_string())?.into_owned();
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" || !parsed.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h) || is_adult_cdn(h)) {
        return Err(format!("host not allowed: {url}"));
    }

    let cache_file = cache_dir.map(|dir| dir.join(cache_key(&url)));
    if let Some(file) = &cache_file {
        if let Ok(bytes) = tokio_fs_read(file).await {
            if !bytes.is_empty() {
                let mime = sniff(&bytes);
                return Ok((bytes, mime));
            }
        }
    }

    let bytes = if parsed.host_str() == Some("image.tmdb.org") {
        fetch_tmdb_image(&parsed).await?
    } else if parsed.host_str().is_some_and(is_adult_cdn) {
        fetch_adult_image(&parsed).await?
    } else {
        // reqwest follows the redirect chain itself (up to 10 hops).
        let res = CLIENT.get(parsed).send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("upstream HTTP {}", res.status()));
        }
        res.bytes().await.map_err(|e| e.to_string())?.to_vec()
    };

    if let Some(file) = cache_file {
        let data = bytes.clone();
        // Best-effort: a failed cache write only means the next view fetches again.
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let Some(parent) = file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let tmp = file.with_extension("part");
            if std::fs::write(&tmp, &data).is_ok() {
                let _ = std::fs::rename(&tmp, &file);
            }
        })
        .await;
    }
    let mime = sniff(&bytes);
    Ok((bytes, mime))
}

async fn tokio_fs_read(path: &PathBuf) -> std::io::Result<Vec<u8>> {
    let path = path.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(std::io::Error::other)?
}

fn cache_key(url: &str) -> String {
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn sniff(bytes: &[u8]) -> &'static str {
    match bytes {
        [0xFF, 0xD8, ..] => "image/jpeg",
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        [b'G', b'I', b'F', ..] => "image/gif",
        _ => "application/octet-stream",
    }
}
