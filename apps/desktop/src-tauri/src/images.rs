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
use tauri::http::{Request, Response};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

const ALLOWED_HOSTS: &[&str] =
    &["kinopoiskapiunofficial.tech", "st.kp.yandex.net", "avatars.mds.yandex.net", "image.tmdb.org"];

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
    if parsed.scheme() != "https" || !parsed.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h)) {
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

    // reqwest follows the redirect chain itself (up to 10 hops).
    let res = CLIENT.get(parsed).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("upstream HTTP {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();

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
