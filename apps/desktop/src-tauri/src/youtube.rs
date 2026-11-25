use crate::config::AppConfig;
use crate::ytdlp::{cookies_file, export_browser_cookies, resolve_youtube_video, save_youtube_video, ResolvedTrailer,
    YoutubeDownloadEvent, YoutubeDownloadResult};
use reqwest::{
    header::{HeaderValue, ACCEPT_LANGUAGE, AUTHORIZATION, COOKIE, LOCATION, SET_COOKIE},
    Response, Url,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[path = "youtube_streams.rs"]
pub(crate) mod streams;

const HOST: &str = "https://www.youtube.com";
const MAX_COOKIE_FILE: usize = 128 * 1024;
const MAX_BROWSER_COOKIE_FILE: usize = 8 * 1024 * 1024;
const MAX_PAGE: usize = 8 * 1024 * 1024;
const MAX_PAGE_REDIRECTS: usize = 3;

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(16))
        .build()
        .expect("YouTube HTTP client")
});

#[derive(Default)]
pub struct YoutubeSession(tokio::sync::Mutex<()>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    id: String,
    title: String,
    channel: String,
    duration: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    details: Vec<String>,
    channel_id: Option<String>,
    avatar: Option<String>,
    is_live: bool,
}

#[derive(Serialize)]
pub struct Author {
    name: String,
    avatar: Option<String>,
}

#[derive(Serialize)]
pub struct Feed {
    connected: bool,
    expired: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<Author>,
    #[serde(flatten)]
    page: VideoPage,
}

impl Feed {
    fn empty(connected: bool, expired: bool, error: Option<String>) -> Self {
        Self {
            connected,
            expired,
            error,
            author: None,
            page: VideoPage { videos: Vec::new(), next: None },
        }
    }
}

#[derive(Serialize)]
pub struct VideoPage {
    videos: Vec<Video>,
    next: Option<Cursor>,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Source {
    WebHome,
    History,
    Search,
    PublicSearch,
    Channel,
}

#[derive(Serialize, Deserialize)]
pub struct Cursor {
    token: String,
    source: Source,
    context: Option<Value>,
}

struct HtmlPage {
    data: Value,
    context: Option<Value>,
    set_cookies: Vec<HeaderValue>,
}

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("youtube-session.dat"))
        .map_err(|_| "Папка профиля KINONYX недоступна.".into())
}

#[cfg(windows)]
fn protect(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let data = CRYPT_INTEGER_BLOB {
        cbData: input
            .len()
            .try_into()
            .map_err(|_| "Сессия слишком велика.")?,
        pbData: input.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    // DPAPI allocates the output. Windows releases it with LocalFree.
    unsafe {
        let result = if encrypt {
            CryptProtectData(
                &data,
                null(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &data,
                null_mut(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if result == 0 || output.pbData.is_null() {
            return Err("Windows не смогла открыть защищённую сессию YouTube.".into());
        }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(output.pbData.cast());
        Ok(bytes)
    }
}

#[cfg(not(windows))]
fn protect(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("Подключение аккаунта в этой сборке доступно только на Windows.".into())
}

fn read_limited(path: &Path, limit: usize) -> std::io::Result<Vec<u8>> {
    let file = std::fs::File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    Ok(bytes)
}

struct Cookies {
    netscape: String,
    header: Option<HeaderValue>,
}

fn valid_cookie_pair(name: &str, value: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
        && value
            .bytes()
            .all(|c| (0x21..=0x7e).contains(&c) && !matches!(c, b';' | b','))
}

fn parse_cookies(file: &str, now: u64) -> Cookies {
    let mut netscape = String::from("# Netscape HTTP Cookie File\n");
    let mut pairs = Vec::new();
    let mut auth = false;
    for line in file.lines() {
        let fields: Vec<_> = line.trim_start_matches("#HttpOnly_").split('\t').collect();
        let [domain, include_children, path, secure, expiry, name, value] = fields.as_slice()
        else {
            continue;
        };
        let host = domain.trim_start_matches('.');
        if !matches!(host, "youtube.com" | "www.youtube.com")
            || *path != "/"
            || !matches!(*include_children, "TRUE" | "FALSE")
            || !matches!(*secure, "TRUE" | "FALSE")
            || (host == "youtube.com" && *include_children == "FALSE")
            || !expiry.parse::<u64>().is_ok_and(|at| at == 0 || at > now)
            || !valid_cookie_pair(name, value)
        {
            continue;
        }
        auth |= matches!(*name, "SAPISID" | "__Secure-1PAPISID" | "__Secure-3PAPISID")
            && !value.is_empty();
        netscape.push_str(line);
        netscape.push('\n');
        pairs.push(format!("{name}={value}"));
    }
    let header = auth
        .then(|| HeaderValue::from_str(&pairs.join("; ")).ok())
        .flatten();
    Cookies { netscape, header }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn cookies(text: &str) -> Cookies {
    parse_cookies(text, unix_now())
}

fn browser_session_from_file(path: &Path) -> Result<Cookies, String> {
    // The browser export contains other sites. Apply the usual limit to the YouTube subset.
    let data = read_limited(path, MAX_BROWSER_COOKIE_FILE)
        .map_err(|_| "Не удалось прочитать cookies из браузера.")?;
    let session = cookies(std::str::from_utf8(&data).map_err(|_| "Некорректный формат cookies браузера.")?);
    if session.netscape.len() > MAX_COOKIE_FILE {
        return Err("В браузере слишком много cookies YouTube.".into());
    }
    Ok(session)
}

fn cookie_key(line: &str) -> Option<(&str, &str)> {
    let mut fields = line.split('\t');
    let domain = fields.next()?.trim_start_matches("#HttpOnly_").trim_start_matches('.');
    Some((domain, fields.nth(4)?))
}

// Successful authenticated HTML responses from www.youtube.com can rotate
// cookies. Save the updated values with the same scope as the imported jar.
fn refresh_page_cookies(session: &Cookies, headers: &[HeaderValue], now: u64) -> Option<Cookies> {
    let mut lines = session.netscape.lines().map(str::to_owned).collect::<Vec<_>>();
    for raw in headers {
        let Some(updated) = raw.to_str().ok().and_then(|header| cookie::Cookie::parse(header).ok()) else {
            continue;
        };
        let domain = updated.domain().unwrap_or("www.youtube.com").to_ascii_lowercase();
        let secure = updated.secure() == Some(true);
        if !matches!(domain.as_str(), "youtube.com" | "www.youtube.com")
            || updated.path().unwrap_or("/") != "/"
            || updated.partitioned() == Some(true)
            || !valid_cookie_pair(updated.name(), updated.value())
            || (updated.name().starts_with("__Secure-") && !secure)
            || (updated.name().starts_with("__Host-") && (!secure || updated.domain().is_some()))
        {
            continue;
        }
        let expiry = match updated.max_age() {
            Some(age) if age.whole_seconds() <= 0 => Some(now),
            Some(age) => Some(now.saturating_add(age.whole_seconds() as u64)),
            None => updated
                .expires_datetime()
                .map(|date| date.unix_timestamp().max(0) as u64),
        };
        let key = (domain.as_str(), updated.name());
        if expiry.is_some_and(|until| until <= now) {
            lines.retain(|line| cookie_key(line) != Some(key));
            continue;
        }
        let scope = if updated.domain().is_some() { "TRUE" } else { "FALSE" };
        let flag = if secure { "TRUE" } else { "FALSE" };
        let prefix = if updated.http_only() == Some(true) { "#HttpOnly_" } else { "" };
        let dot = if updated.domain().is_some() { "." } else { "" };
        let line = format!(
            "{prefix}{dot}{domain}\t{scope}\t/\t{flag}\t{}\t{}\t{}",
            expiry.unwrap_or(0),
            updated.name(),
            updated.value(),
        );
        if let Some(existing) = lines.iter_mut().find(|line| cookie_key(line) == Some(key)) {
            *existing = line;
        } else {
            lines.push(line);
        }
    }
    let refreshed = parse_cookies(&lines.join("\n"), now);
    (refreshed.netscape.len() <= MAX_COOKIE_FILE && refreshed.netscape != session.netscape)
        .then_some(refreshed)
}

fn load_session(app: &AppHandle) -> Result<Option<Cookies>, String> {
    match read_limited(&session_path(app)?, MAX_COOKIE_FILE + 4096) {
        Ok(bytes) => {
            let decrypted = protect(&bytes, false)?;
            let text = std::str::from_utf8(&decrypted).map_err(|_| "Сессия YouTube повреждена.")?;
            Ok(Some(cookies(text)))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Не удалось прочитать сессию YouTube.".into()),
    }
}

fn store_session(app: &AppHandle, session: &Cookies) -> Result<(), String> {
    persist_protected(&session_path(app)?, session.netscape.as_bytes())
}

async fn store_session_update(
    app: &AppHandle,
    state: &YoutubeSession,
    previous: &Cookies,
    updated: &Cookies,
) -> Result<(), String> {
    if updated.netscape == previous.netscape {
        return Ok(());
    }
    let _guard = state.0.lock().await;
    // An in-flight request must not overwrite a new import or restore a session
    // that the viewer has disconnected.
    if load_session(app)?.is_some_and(|current| current.netscape == previous.netscape) {
        store_session(app, updated)?;
    }
    Ok(())
}

fn persist_protected(file: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = file.parent().ok_or("Папка профиля KINONYX недоступна.")?;
    let data = protect(bytes, true)?;
    (|| -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let mut staging = tempfile::NamedTempFile::new_in(dir)?;
        staging.write_all(&data)?;
        staging.persist(file)?;
        Ok(())
    })()
    .map_err(|_| "Не удалось сохранить сессию YouTube.".into())
}

fn initial_data(html: &str) -> Result<Value, String> {
    static START: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r#"(?:\bvar\s+ytInitialData|window\["ytInitialData"\])\s*=\s*"#).unwrap()
    });
    let mark = START
        .find(html)
        .ok_or("YouTube не вернул ленту. Проверьте соединение или откройте YouTube в браузере.")?;
    serde_json::Deserializer::from_str(&html[mark.end()..])
        .into_iter::<Value>()
        .next()
        .and_then(Result::ok)
        .ok_or_else(|| "YouTube изменил формат ответа.".into())
}

fn next_page_url(previous: &Url, location: &HeaderValue) -> Option<Url> {
    let next = previous.join(location.to_str().ok()?).ok()?;
    // Cookie headers are supplied by the app. Keep them on the original HTTPS
    // origin and page even if the server replies with an external sign-in URL.
    (next.origin() == previous.origin()
        && next.path() == previous.path()
        && next.username().is_empty()
        && next.password().is_none()
        && next.query() != previous.query())
    .then_some(next)
}

async fn page_response(
    path: &str,
    query: &[(&str, &str)],
    mut auth: Option<HeaderValue>,
) -> Result<Option<Response>, String> {
    let mut url = Url::parse_with_params(&format!("{HOST}{path}"), query)
        .map_err(|_| "Некорректный адрес YouTube.")?;
    if let Some(header) = auth.as_mut() {
        header.set_sensitive(true);
    }
    for step in 0..=MAX_PAGE_REDIRECTS {
        let mut request = CLIENT
            .get(url.clone())
            .header(ACCEPT_LANGUAGE, "ru-RU,ru;q=0.9,en;q=0.7");
        if let Some(header) = &auth {
            request = request.header(COOKIE, header.clone());
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Нет соединения с YouTube.")?;
        let status = response.status();
        if status.is_success() {
            return Ok(Some(response));
        }
        if !status.is_redirection() {
            return Err(format!(
                "YouTube вернул HTTP {}. Проверьте доступ к сайту в браузере.",
                status.as_u16()
            ));
        }
        if step == MAX_PAGE_REDIRECTS {
            break;
        }
        let Some(next) = response
            .headers()
            .get(LOCATION)
            .and_then(|location| next_page_url(&url, location))
        else {
            break;
        };
        url = next;
    }
    Ok(None)
}

async fn page(
    path: &str,
    query: &[(&str, &str)],
    auth: Option<HeaderValue>,
) -> Result<HtmlPage, String> {
    let response = page_response(path, query, auth)
        .await?
        .ok_or("YouTube перенаправил запрос. Откройте YouTube в браузере и повторите попытку.")?;
    parse_page(response).await
}

async fn parse_page(mut response: Response) -> Result<HtmlPage, String> {
    let set_cookies = response.headers().get_all(SET_COOKIE).iter().cloned().collect();
    let mut html = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Не удалось прочитать ответ YouTube.")?
    {
        if html.len() + chunk.len() > MAX_PAGE {
            return Err("YouTube вернул слишком большой ответ.".into());
        }
        html.extend_from_slice(&chunk);
    }
    let html = String::from_utf8_lossy(&html);
    static CONTEXT: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r#""INNERTUBE_CONTEXT"\s*:\s*"#).unwrap());
    let context = CONTEXT.find(&html).and_then(|mark| {
        let value = &html[mark.end()..];
        serde_json::Deserializer::from_str(value)
            .into_iter::<Value>()
            .next()?
            .ok()
    });
    Ok(HtmlPage {
        data: initial_data(&html)?,
        context,
        set_cookies,
    })
}

fn logged_out(data: &Value) -> Option<bool> {
    data.pointer("/responseContext/mainAppWebResponseContext/loggedOut")
        .and_then(Value::as_bool)
}

fn refreshed_signed_in_cookies(
    session: &Cookies,
    data: &Value,
    headers: &[HeaderValue],
    now: u64,
) -> Option<Cookies> {
    if logged_out(data) != Some(false) {
        return None;
    }
    refresh_page_cookies(session, headers, now)
}

fn video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
}

fn text(node: &Value) -> String {
    if let Some(s) = node
        .as_str()
        .or_else(|| node["simpleText"].as_str())
        .or_else(|| node["content"].as_str())
    {
        return s.into();
    }
    node["runs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|run| run["text"].as_str())
        .collect()
}

fn channel_id(id: &str) -> bool {
    id.len() == 24
        && id.starts_with("UC")
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn find_fields<'a>(node: &'a Value, field: &str) -> Option<&'a Value> {
    if let Some(object) = node.as_object() {
        if let Some(value) = object.get(field) {
            return Some(value);
        }
        return object.values().find_map(|value| find_fields(value, field));
    }
    node.as_array()?
        .iter()
        .find_map(|value| find_fields(value, field))
}

fn avatar_url(value: &Value) -> Option<String> {
    let items = value
        .get("thumbnails")
        .or_else(|| value.get("sources"))?
        .as_array()?;
    items
        .iter()
        .rev()
        .filter_map(|item| item.get("url").and_then(Value::as_str))
        .find_map(|url| {
            let url = if url.starts_with("//") {
                format!("https:{url}")
            } else {
                url.to_owned()
            };
            let parsed = reqwest::Url::parse(&url).ok()?;
            (parsed.scheme() == "https"
                && matches!(
                    parsed.host_str(),
                    Some("yt3.ggpht.com" | "yt3.googleusercontent.com" | "yt4.ggpht.com")
                ))
            .then_some(url)
        })
}

fn card_author(node: &Value) -> (Option<String>, Option<String>) {
    let byline = node
        .get("ownerText")
        .or_else(|| node.get("shortBylineText"))
        .unwrap_or(node);
    let lockup = node.pointer("/metadata/lockupMetadataViewModel");
    let metadata = lockup
        .and_then(|value| value.get("metadata"))
        .unwrap_or(byline);
    let id = find_fields(metadata, "browseId")
        .or_else(|| find_fields(byline, "browseId"))
        .and_then(Value::as_str)
        .filter(|id| channel_id(id))
        .map(str::to_owned);
    let avatar = node
        .pointer("/channelThumbnailSupportedRenderers/channelThumbnailWithLinkRenderer/thumbnail")
        .and_then(avatar_url)
        .or_else(|| {
            lockup
                .and_then(|value| find_fields(&value["image"], "avatarViewModel"))
                .and_then(|value| avatar_url(&value["image"]))
        });
    (id, avatar)
}

fn card_is_live(node: &Value) -> bool {
    if find_fields(&node["contentImage"], "thumbnailBadgeViewModel")
        .and_then(|badge| badge["badgeStyle"].as_str())
        == Some("THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE")
    {
        return true;
    }
    ["thumbnailOverlays", "badges", "contentImage"]
        .into_iter()
        .any(|key| {
            find_fields(&node[key], "style")
                .and_then(Value::as_str)
                .is_some_and(|style| {
                    matches!(
                        style,
                        "LIVE" | "BADGE_STYLE_TYPE_LIVE_NOW" | "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE"
                    )
                })
        })
}

fn lockup_labels(metadata: &Value) -> (String, Vec<String>) {
    let mut channel = String::new();
    let mut details = Vec::new();
    for row in metadata
        .pointer("/metadata/contentMetadataViewModel/metadataRows")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for part in row["metadataParts"].as_array().into_iter().flatten() {
            let label = text(&part["text"]);
            if label.is_empty() {
                continue;
            }
            if find_fields(part, "browseId")
                .and_then(Value::as_str)
                .is_some_and(channel_id)
            {
                channel = label;
            } else {
                details.push(label);
            }
        }
    }
    (channel, details)
}

fn lockup_duration(renderer: &Value) -> String {
    find_fields(&renderer["contentImage"], "thumbnailBadgeViewModel")
        .and_then(|badge| badge["text"].as_str())
        .filter(|label| {
            label.contains(':')
                && label.bytes().all(|byte| byte.is_ascii_digit() || byte == b':')
        })
        .unwrap_or_default()
        .into()
}

fn collect_videos(data: &Value, limit: usize) -> Vec<Video> {
    fn visit(node: &Value, seen: &mut HashSet<String>, result: &mut Vec<Video>, limit: usize) {
        if result.len() >= limit {
            return;
        }
        if let Some(children) = node.as_array() {
            for child in children {
                visit(child, seen, result, limit);
            }
            return;
        }
        let Some(object) = node.as_object() else {
            return;
        };
        let video = object
            .get("videoRenderer")
            .or_else(|| object.get("gridVideoRenderer"))
            .or_else(|| object.get("compactVideoRenderer"));
        let lockup =
            node["lockupViewModel"]["contentType"].as_str() == Some("LOCKUP_CONTENT_TYPE_VIDEO");
        let card = if let Some(v) = video {
            let channel = v
                .get("ownerText")
                .or_else(|| v.get("shortBylineText"))
                .unwrap_or(&Value::Null);
            Some((
                v,
                &v["videoId"],
                text(&v["title"]),
                text(channel),
                text(&v["lengthText"]),
                [text(&v["shortViewCountText"]), text(&v["publishedTimeText"])]
                    .into_iter()
                    .filter(|label| !label.is_empty())
                    .collect(),
            ))
        } else if let Some(tile) = node.get("tileRenderer").filter(|v| {
            v["contentType"].as_str() == Some("TILE_CONTENT_TYPE_VIDEO")
                || v["contentType"].is_null()
        }) {
            // Stream Tube (MIT) maps TV-client tiles through tileMetadataRenderer.
            let metadata = &tile["metadata"]["tileMetadataRenderer"];
            let id = tile
                .get("contentId")
                .or_else(|| tile.pointer("/onSelectCommand/watchEndpoint/videoId"))
                .unwrap_or(&Value::Null);
            let channel = metadata
                .pointer("/lines/0/lineRenderer/items/0/lineItemRenderer/text")
                .map(text)
                .unwrap_or_default();
            Some((tile, id, text(&metadata["title"]), channel, String::new(), Vec::new()))
        } else if lockup {
            let v = &node["lockupViewModel"];
            let meta = &v["metadata"]["lockupMetadataViewModel"];
            let (channel, details) = lockup_labels(meta);
            Some((
                v,
                &v["contentId"],
                text(&meta["title"]),
                channel,
                lockup_duration(v),
                details,
            ))
        } else {
            None
        };
        if let Some((renderer, id, title, channel, duration, details)) = card {
            if let Some(id) = id.as_str().filter(|id| video_id(id)) {
                if !title.trim().is_empty() && seen.insert(id.to_string()) {
                    let (channel_id, avatar) = card_author(renderer);
                    result.push(Video {
                        id: id.into(),
                        title,
                        channel,
                        duration,
                        details,
                        channel_id,
                        avatar,
                        is_live: card_is_live(renderer),
                    });
                }
            }
            return;
        }
        for child in object.values() {
            visit(child, seen, result, limit);
        }
    }
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for section in content_sections(data) {
        visit(section, &mut seen, &mut result, limit);
    }
    result
}

fn content_sections(data: &Value) -> impl Iterator<Item = &Value> {
    [
        "contents",
        "continuationContents",
        "onResponseReceivedActions",
        "onResponseReceivedEndpoints",
        "onResponseReceivedCommands",
    ]
    .into_iter()
    .filter_map(|key| data.get(key))
}

// Stream Tube Desktop v0.7.2-alpha (MIT), src/api/innertube.rs. See stream-tube-LICENSE.txt.
fn continuation_token(renderer: &Value) -> Option<&str> {
    renderer
        .pointer("/continuationEndpoint/continuationCommand/token")
        .or_else(|| renderer.pointer("/button/buttonRenderer/command/continuationCommand/token"))
        .and_then(Value::as_str)
}

fn next_token(node: &Value) -> Option<&str> {
    if let Some(object) = node.as_object() {
        if let Some(token) = node
            .get("continuationItemRenderer")
            .and_then(continuation_token)
            .or_else(|| {
                node.pointer("/nextContinuationData/continuation")
                    .and_then(Value::as_str)
            })
        {
            return Some(token);
        }
        // Cards can carry their own menu and shelf continuation. The content list owns pagination.
        return object
            .iter()
            .filter(|(key, _)| {
                !matches!(
                    key.as_str(),
                    "menu"
                        | "videoRenderer"
                        | "gridVideoRenderer"
                        | "tileRenderer"
                        | "lockupViewModel"
                        | "reelShelfRenderer"
                )
            })
            .filter_map(|(_, value)| next_token(value))
            .last();
    }
    node.as_array()?.iter().rev().find_map(next_token)
}

fn video_page(
    data: &Value,
    source: Source,
    context: Option<Value>,
    previous: Option<&str>,
) -> VideoPage {
    let next = content_sections(data)
        .filter_map(next_token)
        .last()
        .filter(|token| !token.is_empty() && token.len() <= 64 * 1024 && Some(*token) != previous)
        .filter(|_| context.is_some())
        .map(|token| Cursor {
            token: token.into(),
            source,
            context,
        });
    VideoPage {
        videos: collect_videos(data, if source == Source::History { usize::MAX } else { 40 }),
        next,
    }
}

// Stream Tube Desktop v0.7.2-alpha (MIT), src/api/web.rs. See stream-tube-LICENSE.txt.
fn web_authorization(cookie: &HeaderValue, timestamp: u64) -> Option<HeaderValue> {
    let entries = cookie.to_str().ok()?;
    let find = |name: &str| {
        entries
            .split("; ")
            .filter_map(|entry| entry.split_once('='))
            .find_map(|(key, value)| (key == name && !value.is_empty()).then_some(value))
    };
    let parts: Vec<_> = [
        ("SAPISIDHASH", "SAPISID"),
        ("SAPISID1PHASH", "__Secure-1PAPISID"),
        ("SAPISID3PHASH", "__Secure-3PAPISID"),
    ]
    .into_iter()
    .filter_map(|(scheme, name)| {
        let value = find(name).or_else(|| {
            (name == "SAPISID")
                .then(|| find("__Secure-3PAPISID"))
                .flatten()
        })?;
        let input = format!("{timestamp} {value} {HOST}");
        let digest =
            ring::digest::digest(&ring::digest::SHA1_FOR_LEGACY_USE_ONLY, input.as_bytes());
        let hex: String = digest
            .as_ref()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        Some(format!("{scheme} {timestamp}_{hex}"))
    })
    .collect();
    if parts.is_empty() {
        return None;
    }
    let mut header = HeaderValue::from_str(&parts.join(" ")).ok()?;
    header.set_sensitive(true);
    Some(header)
}

async fn innertube(
    source: Source,
    context: Value,
    continuation: &str,
    cookie: Option<HeaderValue>,
) -> Result<(Value, Vec<HeaderValue>), String> {
    let endpoint = if matches!(source, Source::Search | Source::PublicSearch) {
        "search"
    } else {
        "browse"
    };
    let body = json!({ "context": context, "continuation": continuation });
    let mut request = CLIENT
        .post(format!("{HOST}/youtubei/v1/{endpoint}?prettyPrint=false"))
        .header("origin", HOST)
        .json(&body);
    if let Some(mut header) = cookie {
        let time = unix_now();
        if let Some(authorization) = web_authorization(&header, time) {
            request = request
                .header(AUTHORIZATION, authorization)
                .header("x-origin", HOST)
                .header("referer", format!("{HOST}/"))
                .header("x-goog-authuser", "0")
                .header("x-youtube-bootstrap-logged-in", "true")
                .header("x-youtube-client-name", "1");
            if let Some(version) = body
                .pointer("/context/client/clientVersion")
                .and_then(Value::as_str)
            {
                request = request.header("x-youtube-client-version", version);
            }
        }
        header.set_sensitive(true);
        request = request.header(COOKIE, header);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Нет соединения с YouTube.")?;
    if !response.status().is_success() {
        return Err("YouTube не принял запрос следующей страницы.".into());
    }
    let set_cookies = response.headers().get_all(SET_COOKIE).iter().cloned().collect();
    let data = response
        .json()
        .await
        .map_err(|_| "Не удалось прочитать ответ YouTube.".to_string())?;
    Ok((data, set_cookies))
}

#[tauri::command]
pub async fn youtube_feed(app: AppHandle, state: State<'_, YoutubeSession>) -> Result<Feed, String> {
    personal_feed(&app, &state, "/", Source::WebHome).await
}

#[tauri::command]
pub async fn youtube_history(app: AppHandle, state: State<'_, YoutubeSession>) -> Result<Feed, String> {
    personal_feed(&app, &state, "/feed/history", Source::History).await
}

async fn personal_feed(app: &AppHandle, state: &YoutubeSession, path: &str, source: Source) -> Result<Feed, String> {
    let Some(session) = load_session(app)? else {
        return Ok(Feed::empty(false, false, None));
    };
    let Some(auth) = session.header.clone() else {
        crate::elog!("[youtube] saved session has no unexpired authentication cookies");
        return Ok(Feed::empty(false, true, Some(
            "Сессия YouTube истекла. Подключите её заново в «Настройки → Источники».".into(),
        )));
    };
    let page = match page(path, &[("hl", "ru")], Some(auth)).await {
        Ok(page) => page,
        Err(error) => return Ok(Feed::empty(true, false, Some(error))),
    };
    match logged_out(&page.data) {
        Some(true) => {
            crate::elog!("[youtube] server returned the page as signed out");
            return Ok(Feed::empty(false, true, Some(
                "YouTube больше не принимает сохранённую сессию. Подключите её заново в «Настройки → Источники».".into(),
            )));
        }
        None => {
            return Ok(Feed::empty(
                true,
                false,
                Some("Не удалось проверить сессию YouTube. Повторите обновление.".into()),
            ));
        }
        Some(false) => {}
    }
    let mut error = None;
    if let Some(updated) = refresh_page_cookies(&session, &page.set_cookies, unix_now()) {
        error = store_session_update(app, state, &session, &updated).await.err();
    }
    Ok(Feed {
        connected: true,
        expired: false,
        error,
        author: None,
        page: video_page(&page.data, source, page.context, None),
    })
}

#[tauri::command]
pub async fn youtube_search(
    app: AppHandle,
    query: String,
    state: State<'_, YoutubeSession>,
) -> Result<VideoPage, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 160 {
        return Err("Введите запрос длиной до 160 символов.".into());
    }
    let query_params = [("search_query", query), ("hl", "ru")];
    let session = load_session(&app)
        .ok()
        .flatten()
        .filter(|session| session.header.is_some());
    if let Some(session) = session {
        if let Some(response) = page_response("/results", &query_params, session.header.clone()).await?
        {
            let results = parse_page(response).await?;
            if let Some(updated) = refreshed_signed_in_cookies(&session, &results.data, &results.set_cookies, unix_now()) {
                let _ = store_session_update(&app, &state, &session, &updated).await;
            }
            return Ok(video_page(
                &results.data,
                Source::Search,
                results.context,
                None,
            ));
        }
    }
    let results = page("/results", &query_params, None).await?;
    Ok(video_page(
        &results.data,
        Source::PublicSearch,
        results.context,
        None,
    ))
}

#[tauri::command]
pub async fn youtube_more(app: AppHandle, cursor: Cursor, state: State<'_, YoutubeSession>) -> Result<VideoPage, String> {
    if cursor.token.is_empty() || cursor.token.len() > 64 * 1024 {
        return Err("Некорректная страница YouTube.".into());
    }
    let context = cursor
        .context
        .clone()
        .filter(|value| {
            value.pointer("/client/clientName").and_then(Value::as_str) == Some("WEB")
                && value.to_string().len() <= 12 * 1024
        })
        .ok_or("YouTube изменил формат страницы. Обновите ленту.")?;
    let session = match cursor.source {
        Source::WebHome | Source::History | Source::Search => load_session(&app).ok().flatten(),
        Source::PublicSearch | Source::Channel => None,
    };
    let cookie = session.as_ref().and_then(|session| session.header.clone());
    if cursor.source == Source::History && cookie.is_none() {
        return Err("Подключите аккаунт YouTube в настройках, чтобы открыть историю.".into());
    }
    let signed_feed = matches!(cursor.source, Source::WebHome | Source::History) && cookie.is_some();
    let (data, set_cookies) = innertube(cursor.source, context, &cursor.token, cookie).await?;
    if signed_feed && logged_out(&data) == Some(true) {
        return Err(
            "YouTube не принял сессию для продолжения ленты. Подключите аккаунт заново.".into(),
        );
    }
    if let Some(session) = session.filter(|session| session.header.is_some()) {
        if let Some(updated) = refreshed_signed_in_cookies(&session, &data, &set_cookies, unix_now()) {
            let _ = store_session_update(&app, &state, &session, &updated).await;
        }
    }
    Ok(video_page(
        &data,
        cursor.source,
        cursor.context,
        Some(&cursor.token),
    ))
}

fn channel_metadata(data: &Value) -> Author {
    let metadata = &data["metadata"]["channelMetadataRenderer"];
    let header = &data["header"];
    let name = metadata["title"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| text(&header["c4TabbedHeaderRenderer"]["title"]));
    let avatar = avatar_url(&metadata["avatar"])
        .or_else(|| avatar_url(&header["c4TabbedHeaderRenderer"]["avatar"]))
        .or_else(|| {
            find_fields(header, "avatarViewModel").and_then(|value| avatar_url(&value["image"]))
        });
    Author { name, avatar }
}

#[tauri::command]
pub async fn youtube_channel(id: String) -> Result<Feed, String> {
    if !channel_id(&id) {
        return Err("Некорректный канал YouTube.".into());
    }
    let page = page(&format!("/channel/{id}/videos"), &[("hl", "ru")], None).await?;
    let author = channel_metadata(&page.data);
    Ok(Feed {
        connected: false,
        expired: false,
        error: None,
        author: Some(author),
        page: video_page(&page.data, Source::Channel, page.context, None),
    })
}

#[tauri::command]
pub async fn youtube_author(id: String) -> Result<Author, String> {
    if !channel_id(&id) {
        return Err("Некорректный канал YouTube.".into());
    }
    let page = page(&format!("/channel/{id}/videos"), &[("hl", "ru")], None).await?;
    Ok(channel_metadata(&page.data))
}

#[tauri::command]
pub async fn youtube_connect(
    app: AppHandle,
    state: State<'_, YoutubeSession>,
) -> Result<Option<Feed>, String> {
    let _guard = state
        .0
        .try_lock()
        .map_err(|_| "Подключение аккаунта уже выполняется.")?;
    let handle = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .file()
            .set_title("Выберите cookies.txt для YouTube")
            .add_filter("Сессия YouTube", &["txt"])
            .blocking_pick_file()
    })
    .await
    .map_err(|_| "Не удалось открыть выбор файла.")?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "Выберите локальный файл cookies.txt.")?;
    let data = read_limited(&path, MAX_COOKIE_FILE)
        .map_err(|_| "Не удалось прочитать cookies.txt (до 128 КБ).")?;
    let session =
        cookies(std::str::from_utf8(&data).map_err(|_| "Ожидается текстовый файл cookies.txt.")?);
    let feed = authenticated_home(&session).await?.ok_or(
        "YouTube не принял сессию из файла. Войдите в аккаунт в браузере и экспортируйте новый файл.",
    )?;
    finish_connect(&app, session, feed).await.map(Some)
}

#[tauri::command]
pub async fn youtube_connect_from_browser(
    app: AppHandle,
    config: State<'_, AppConfig>,
    state: State<'_, YoutubeSession>,
) -> Result<Feed, String> {
    let _guard = state
        .0
        .try_lock()
        .map_err(|_| "Подключение аккаунта уже выполняется.")?;

    if let Ok(session) = browser_session_from_file(&cookies_file()) {
        if let Some(feed) = authenticated_home(&session).await? {
            return finish_connect(&app, session, feed).await;
        }
    }

    let browser = config.youtube_cookies_browser.lock().unwrap().clone();
    let session = {
        let scratch = tempfile::tempdir().map_err(|_| "Не удалось подготовить импорт сессии.")?;
        let path = scratch.path().join("cookies.txt");
        export_browser_cookies(&browser, &path).await?;
        browser_session_from_file(&path)?
    };
    let feed = authenticated_home(&session).await?.ok_or(
        "YouTube не принял сессию браузера. Проверьте, что вы вошли в аккаунт в выбранном браузере, или импортируйте cookies.txt.",
    )?;
    finish_connect(&app, session, feed).await
}

async fn authenticated_home(session: &Cookies) -> Result<Option<HtmlPage>, String> {
    let Some(auth) = session.header.clone() else {
        return Ok(None);
    };
    let Some(response) = page_response("/", &[("hl", "ru")], Some(auth)).await? else {
        return Ok(None);
    };
    let feed = parse_page(response).await?;
    Ok((logged_out(&feed.data) == Some(false)).then_some(feed))
}

async fn finish_connect(app: &AppHandle, session: Cookies, feed: HtmlPage) -> Result<Feed, String> {
    let session = refresh_page_cookies(&session, &feed.set_cookies, unix_now()).unwrap_or(session);
    store_session(app, &session)?;
    streams::clear().await;
    Ok(Feed {
        connected: true,
        expired: false,
        error: None,
        author: None,
        page: video_page(&feed.data, Source::WebHome, feed.context, None),
    })
}

#[tauri::command]
pub async fn youtube_disconnect(
    app: AppHandle,
    state: State<'_, YoutubeSession>,
) -> Result<(), String> {
    let _guard = state
        .0
        .try_lock()
        .map_err(|_| "Подключение аккаунта ещё выполняется.")?;
    streams::clear().await;
    let session = session_path(&app)?;
    remove_session_file(&session)?;
    remove_session_file(&session.with_file_name("youtube-oauth.dat"))
}

fn remove_session_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Не удалось удалить сохранённую сессию YouTube.".into()),
    }
}

#[tauri::command]
pub async fn youtube_play(
    app: AppHandle,
    id: String,
    state: State<'_, YoutubeSession>,
    prefetch: Option<bool>,
) -> Result<ResolvedTrailer, String> {
    if !video_id(&id) {
        return Err("Некорректная ссылка на видео YouTube.".into());
    }
    streams::resolve(&id, || async {
        if prefetch == Some(true) {
            return resolve_youtube_video(&id, None).await;
        }
        let Some(session) = load_session(&app)
            .ok()
            .flatten()
            .filter(|session| session.header.is_some())
        else {
            return resolve_youtube_video(&id, None).await;
        };
        let mut file = tempfile::NamedTempFile::new()
            .map_err(|_| "Не удалось открыть сессию для плеера.")?;
        file.write_all(session.netscape.as_bytes())
            .map_err(|_| "Не удалось открыть сессию для плеера.")?;
        let stream = resolve_youtube_video(&id, Some(file.path())).await?;
        // yt-dlp writes refreshed cookies back to the temporary Netscape file.
        // Keep only cookies that the same import validator accepts.
        if let Ok(bytes) = read_limited(file.path(), MAX_COOKIE_FILE) {
            if let Ok(text) = std::str::from_utf8(&bytes) {
                let updated = cookies(text);
                if updated.header.is_some() {
                    let _ = store_session_update(&app, &state, &session, &updated).await;
                }
            }
        }
        Ok(stream)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedVideo {
    file_name: String,
    height: Option<u32>,
    path: String,
    bytes: u64,
}

static DOWNLOAD_CANCEL: std::sync::Mutex<Option<(String, tokio::sync::oneshot::Sender<()>)>> = std::sync::Mutex::new(None);

#[tauri::command]
pub fn youtube_cancel_download(task_id: String) {
    let mut active = DOWNLOAD_CANCEL.lock().unwrap();
    if active.as_ref().is_some_and(|(id, _)| *id == task_id) {
        if let Some((_, cancel)) = active.take() {
            let _ = cancel.send(());
        }
    }
}

#[tauri::command]
pub async fn youtube_download(
    app: AppHandle,
    task_id: String,
    id: String,
    title: String,
    height: Option<u32>,
    progress: Channel<YoutubeDownloadEvent>,
) -> Result<Option<SavedVideo>, String> {
    if !video_id(&id) || task_id.len() > 80 || height.is_some_and(|height| !(16..=8192).contains(&height)) {
        return Err("Некорректное видео или качество YouTube.".into());
    }
    static DOWNLOAD: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
    let _permit = DOWNLOAD.try_acquire().map_err(|_| "Дождитесь окончания текущей загрузки YouTube.")?;

    let title: String = title.chars().take(100).collect();
    let suggested = format!("YouTube - {}.mkv", crate::download::safe_name(&title));
    let handle = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = handle.dialog().file().set_title("Скачать видео YouTube")
            .add_filter("Видео Matroska", &["mkv"]).set_file_name(suggested);
        if let Ok(downloads) = handle.path().download_dir() {
            dialog = dialog.set_directory(downloads);
        }
        dialog.blocking_save_file()
    }).await.map_err(|_| "Не удалось открыть окно сохранения.")?;
    let Some(selected) = selected else { return Ok(None) };
    let target = selected.into_path().map_err(|_| "Выберите локальный файл для сохранения.")?;
    if !target.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("mkv")) {
        return Err("Укажите имя файла с расширением .mkv.".into());
    }
    if target.try_exists().map_err(|_| "Не удалось проверить путь сохранения.")? {
        return Err("Файл с таким именем уже существует. Выберите другое имя.".into());
    }

    let dir = target.parent().ok_or("Выберите папку для сохранения видео.")?;
    let scratch = tempfile::Builder::new().prefix(".kinonyx-youtube-").tempdir_in(dir)
        .map_err(|_| "Не удалось создать временную папку в месте сохранения.")?;
    let session = load_session(&app).ok().flatten().filter(|session| session.header.is_some());
    let file_name = target.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let (cancel_sender, cancel_receiver) = tokio::sync::oneshot::channel();
    *DOWNLOAD_CANCEL.lock().unwrap() = Some((task_id, cancel_sender));
    let _ = progress.send(YoutubeDownloadEvent {
        stage: "started", file_name: Some(file_name.clone()), received: 0, total: 0, speed: 0.0,
    });
    let outcome = save_youtube_video(&id, height.unwrap_or(crate::ytdlp::DEFAULT_MAX_HEIGHT), scratch.path(),
        session.as_ref().map(|session| session.netscape.as_str()), &progress, cancel_receiver).await;
    DOWNLOAD_CANCEL.lock().unwrap().take();
    let YoutubeDownloadResult::Saved(height) = outcome? else { return Ok(None) };
    let output = scratch.path().join("video.mkv");
    let bytes = std::fs::metadata(&output).ok().filter(|info| info.is_file() && info.len() > 0)
        .ok_or("YouTube не предоставил готовый видеофайл. Для прямых эфиров дождитесь записи.")?.len();
    tempfile::TempPath::try_from_path(output).map_err(|_| "Не удалось открыть загруженное видео.")?
        .persist_noclobber(&target).map_err(|error| {
            if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                "Файл с таким именем уже существует. Выберите другое имя."
            } else {
                "Не удалось сохранить файл в выбранную папку."
            }
        })?;
    Ok(Some(SavedVideo {
        file_name,
        height,
        path: target.to_string_lossy().into_owned(),
        bytes,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn browser_import_keeps_only_youtube_session_cookies() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cookies.txt");
        let unrelated = ".example.org\tTRUE\t/\tTRUE\t0\tSID\tunrelated\n".repeat(4_000);
        assert!(unrelated.len() > MAX_COOKIE_FILE);
        let youtube = "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\ttest-session\n";
        std::fs::write(&path, format!("# Netscape HTTP Cookie File\n{unrelated}{youtube}")).unwrap();

        let session = browser_session_from_file(&path).unwrap();
        assert_eq!(session.netscape, format!("# Netscape HTTP Cookie File\n{youtube}"));
        assert_eq!(session.header.unwrap().to_str().unwrap(), "SAPISID=test-session");
    }

    #[cfg(windows)]
    #[test]
    fn updated_youtube_cookies_survive_loading_from_the_windows_profile() {
        let session = parse_cookies(
            concat!(
                "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\told\n",
                ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tobsolete\n",
            ),
            100,
        );
        let updated = refresh_page_cookies(
            &session,
            &[
                HeaderValue::from_static("SAPISID=renewed; Domain=.youtube.com; Path=/; HttpOnly; Secure; Max-Age=60"),
                HeaderValue::from_static("SID=; Domain=.youtube.com; Max-Age=0"),
                HeaderValue::from_static("SAPISID=foreign; Domain=example.org; Secure"),
                HeaderValue::from_static("SAPISID=wrong-path; Domain=.youtube.com; Path=/account; Secure"),
            ],
            100,
        )
        .unwrap();
        let profile = tempfile::tempdir().unwrap();
        let path = profile.path().join("youtube-session.dat");
        persist_protected(&path, updated.netscape.as_bytes()).unwrap();
        let saved = read_limited(&path, MAX_COOKIE_FILE + 4096).unwrap();
        let data = protect(&saved, false).unwrap();
        let restored = parse_cookies(std::str::from_utf8(&data).unwrap(), 101);
        assert_eq!(restored.header.unwrap(), "SAPISID=renewed");
        assert!(parse_cookies(std::str::from_utf8(&data).unwrap(), 160).header.is_none());
    }

    #[test]
    fn page_redirect_preserves_the_original_secure_origin_and_path() {
        let url = Url::parse("https://www.youtube.com/results?search_query=film").unwrap();
        let next = next_page_url(
            &url,
            &HeaderValue::from_static("/results?search_query=film&hl=ru"),
        )
        .unwrap();
        assert_eq!(next.as_str(), "https://www.youtube.com/results?search_query=film&hl=ru");

        for location in [
            "/results?search_query=film#fragment",
            "/signin",
            "//consent.youtube.com/results?search_query=film",
            "https://www.youtube.com.example.org/results?search_query=film",
            "http://www.youtube.com/results?search_query=film",
            "https://www.youtube.com:444/results?search_query=film",
            "https://name@www.youtube.com/results?search_query=film",
        ] {
            assert!(next_page_url(&url, &HeaderValue::from_static(location)).is_none());
        }
    }

    #[test]
    fn cookie_import_scopes_to_youtube_and_drops_expired_entries() {
        let result = parse_cookies(
            concat!(
                "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t200\tSAPISID\tfake\n",
                ".google.com\tTRUE\t/\tTRUE\t200\tSID\tother\n",
                ".youtube.com.example.org\tTRUE\t/\tTRUE\t200\tSID\twrong\n",
                ".youtube.com\tTRUE\t/\tTRUE\t10\tSID\told\n",
            ),
            100,
        );
        assert_eq!(result.header.unwrap(), "SAPISID=fake");
        assert_eq!(result.netscape.lines().count(), 2);
    }

    #[test]
    fn keeps_rotated_cookies_from_signed_in_continuations_only() {
        let session = parse_cookies(".youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\told\n", 100);
        let headers = [HeaderValue::from_static("SAPISID=renewed; Domain=.youtube.com; Secure; Max-Age=60")];
        let response = |logged_out| json!({
            "responseContext": {"mainAppWebResponseContext": {"loggedOut": logged_out}},
        });
        let updated = refreshed_signed_in_cookies(&session, &response(false), &headers, 100).unwrap();
        assert_eq!(updated.header.unwrap(), "SAPISID=renewed");
        assert!(refreshed_signed_in_cookies(&session, &response(true), &headers, 100).is_none());
        assert!(refreshed_signed_in_cookies(&session, &json!({}), &headers, 100).is_none());
    }

    #[test]
    fn reads_search_and_home_cards_in_order_without_duplicates() {
        let search_card = json!({"videoRenderer": {
            "videoId":"abcdefghijk", "title":{"runs":[{"text":"A"}]}, "ownerText":{"simpleText":"Channel"}
        }});
        let home_card = json!({"richItemRenderer": {"content": {"lockupViewModel": {
            "contentType": "LOCKUP_CONTENT_TYPE_VIDEO", "contentId":"bcdefghijkl",
            "contentImage": {"thumbnailViewModel": {"overlays": [{"thumbnailOverlayBadgeViewModel": {
                "thumbnailBadges": [{"thumbnailBadgeViewModel": {"text": "14:58", "badgeStyle": "THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT"}}]
            }}]}},
            "metadata": {"lockupMetadataViewModel":{
                "title":{"content":"B"},
                "metadata":{"contentMetadataViewModel":{"metadataRows":[
                    {"metadataParts":[{"text":{"content":"Creator","commandRuns":[{"onTap":{"innertubeCommand":{"browseEndpoint":{"browseId":"UCdnYXYR4vEwfSrZ5O-fYRtA"}}}}]}}]},
                    {"metadataParts":[{"text":{"content":"23k views"}},{"text":{"content":"5 hours ago"}}]}
                ]}}
            }}
        }}}});
        let data = json!({"contents": [search_card.clone(), home_card, search_card]});
        let parsed = initial_data(&format!(
            "<script>var ytInitialData = {data};window.more = true;</script>"
        ))
        .unwrap();
        let videos = collect_videos(&parsed, 40);
        assert_eq!(
            videos.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(),
            ["A", "B"]
        );
        assert_eq!(videos[0].channel, "Channel");
        assert_eq!(videos[1].channel, "Creator");
        assert_eq!(videos[1].duration, "14:58");
        assert_eq!(videos[1].details, ["23k views", "5 hours ago"]);
    }

    #[test]
    fn keeps_history_in_order_and_preserves_the_next_page() {
        let cards: Vec<_> = (0..45).map(|index| json!({"videoRenderer": {
            "videoId": format!("{index:011}"), "title": {"simpleText": format!("Video {index}")}
        }})).collect();
        let data = json!({"contents": {"sectionListRenderer": {"contents": [
            {"itemSectionRenderer": {"contents": cards}},
            {"continuationItemRenderer": {"continuationEndpoint": {"continuationCommand": {"token": "history-next"}}}}
        ]}}});
        let context = json!({"client": {"clientName": "WEB"}});
        let page = video_page(&data, Source::History, Some(context), None);
        assert_eq!(page.videos.len(), 45);
        assert_eq!(page.videos[0].title, "Video 0");
        assert_eq!(page.videos[44].title, "Video 44");
        let next = page.next.unwrap();
        assert!(next.source == Source::History);
        assert_eq!(next.token, "history-next");
    }

    #[test]
    fn reads_appended_videos_and_stops_on_a_repeated_cursor() {
        let data = json!({"onResponseReceivedActions": [{"appendContinuationItemsAction": {
            "continuationItems": [
                {"videoRenderer":{"videoId":"abcdefghijk","title":{"simpleText":"Next video"}}},
                {"continuationItemRenderer":{"continuationEndpoint":{"continuationCommand":{"token":"next"}}}}
            ]
        }}]});
        let context = json!({"client":{"clientName":"WEB"}});
        let page = video_page(&data, Source::Search, Some(context.clone()), Some("first"));
        assert_eq!(page.videos[0].title, "Next video");
        assert_eq!(page.next.unwrap().token, "next");
        assert!(
            video_page(&data, Source::Search, Some(context), Some("next"))
                .next
                .is_none()
        );
    }
}
