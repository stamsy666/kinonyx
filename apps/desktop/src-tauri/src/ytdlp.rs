//! Resolves a YouTube (or any yt-dlp-supported) page URL to a direct, playable stream
//! URL — used for trailers, which Kinopoisk only ever gives us as a page link, not a
//! stream. Done here in Rust (rather than leaning on mpv's own built-in ytdl_hook
//! script) because this plugin gives no visibility into that script's own log output,
//! making a silent failure impossible to diagnose; shelling out ourselves means real
//! stderr, in a UI-visible error, when it doesn't work.

use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

const RESOLVE_TIMEOUT_SECS: u64 = 25;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// A helper binary shipped with the app: next to the exe in dev (build.rs copies `lib/*`
/// there), under `<install dir>/lib/` in an installed build (`bundle.resources`).
pub fn tool_path(name: &str) -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    [dir.join(name), dir.join("lib").join(name)].into_iter().find(|p| p.exists())
}

fn ytdlp_path() -> Result<std::path::PathBuf, String> {
    let name = if cfg!(windows) { "youtube-dl.exe" } else { "youtube-dl" };
    tool_path(name).ok_or_else(|| format!("yt-dlp ({name}) не найден рядом с программой"))
}

fn is_youtube(url: &str) -> bool {
    let host = url.split('/').nth(2).unwrap_or("").trim_start_matches("www.");
    host == "youtube.com" || host == "m.youtube.com" || host == "youtu.be"
}

/// One selectable quality. YouTube serves anything above 360p as separate video and audio
/// streams, so a sharp quality is two URLs that mpv plays together; the old muxed 360p file
/// has no `audio_url`.
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrailerQuality {
    pub height: u32,
    pub url: String,
    pub audio_url: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTrailer {
    pub qualities: Vec<TrailerQuality>,
    /// Index into `qualities` to start with — the sharpest one up to `DEFAULT_MAX_HEIGHT`.
    pub default_index: usize,
}

const DEFAULT_MAX_HEIGHT: u32 = 1080;

/// `allow_hls`: Rutube serves only HLS (muxed, one playlist per height) — mpv plays those
/// directly. For YouTube they stay excluded: the progressive/split streams are better.
fn direct_url(f: &serde_json::Value, allow_hls: bool) -> Option<String> {
    let proto = f["protocol"].as_str().unwrap_or("");
    let ok = proto == "https" || proto == "http" || (allow_hls && proto.starts_with("m3u8"));
    f["url"].as_str().filter(|u| u.starts_with("http") && ok).map(str::to_string)
}

fn has_codec(f: &serde_json::Value, key: &str) -> bool {
    f[key].as_str().is_some_and(|c| c != "none")
}

/// Hardware decoders handle H.264 everywhere, VP9 mostly, AV1 rarely — prefer them in that order.
fn codec_rank(f: &serde_json::Value) -> u8 {
    match f["vcodec"].as_str().unwrap_or("") {
        c if c.starts_with("avc1") => 3,
        c if c.starts_with("vp09") || c.starts_with("vp9") => 2,
        _ => 1,
    }
}

/// From yt-dlp's `-J` dump: one entry per height (every one the video has), the best split video stream paired with the
/// best audio stream (or a muxed progressive file where no audio-only stream exists).
fn pick_qualities(info: &serde_json::Value, allow_hls: bool) -> Vec<TrailerQuality> {
    let formats: Vec<&serde_json::Value> =
        info["formats"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
    let audio = formats
        .iter()
        .filter(|f| has_codec(f, "acodec") && !has_codec(f, "vcodec"))
        .filter_map(|f| direct_url(f, allow_hls).map(|u| (f["abr"].as_f64().unwrap_or(0.0), u)))
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, u)| u);

    let mut by_height: std::collections::BTreeMap<u32, (u8, f64, TrailerQuality)> = Default::default();
    for f in &formats {
        let Some(height) = f["height"].as_u64() else { continue };
        let Some(url) = direct_url(f, allow_hls) else { continue };
        let (video, muxed) = (has_codec(f, "vcodec"), has_codec(f, "acodec"));
        if !video {
            continue;
        }
        // A split video stream needs an audio stream to go with it; a muxed one doesn't.
        let audio_url = if muxed { None } else { audio.clone() };
        if !muxed && audio_url.is_none() {
            continue;
        }
        let rank = (codec_rank(f), f["tbr"].as_f64().unwrap_or(0.0));
        let height = height as u32;
        let better = by_height.get(&height).is_none_or(|(r, t, q)| {
            // A split pair beats a muxed file at the same height (same picture, better audio).
            (audio_url.is_some(), rank.0, rank.1) > (q.audio_url.is_some(), *r, *t)
        });
        if better {
            by_height.insert(height, (rank.0, rank.1, TrailerQuality { height, url, audio_url }));
        }
    }
    by_height.into_values().map(|(_, _, q)| q).collect()
}

/// Chain: the given YouTube link → Rutube search (when the film's name is known) → error,
/// which the UI turns into "open in browser". An empty `url` means the metadata source had
/// no video at all (TMDB often doesn't) and goes straight to Rutube.
#[tauri::command]
pub async fn resolve_trailer_url(
    url: String,
    name_ru: Option<String>,
    name_original: Option<String>,
    year: Option<String>,
    config: tauri::State<'_, crate::config::AppConfig>,
) -> Result<ResolvedTrailer, String> {
    let cookies_browser = config.youtube_cookies_browser.lock().unwrap().clone();
    let can_search = name_ru.as_deref().is_some_and(|n| !n.trim().is_empty())
        || name_original.as_deref().is_some_and(|n| !n.trim().is_empty());

    let mut first_error = None;
    if !url.is_empty() {
        match run_ytdlp(url.clone(), cookies_browser).await {
            Ok(r) => return Ok(r),
            // Only a YouTube failure is worth a second source; anything else is final.
            Err(e) if can_search && is_youtube(&url) => first_error = Some(e),
            Err(e) => return Err(e),
        }
    } else if !can_search {
        return Err("Нет данных для поиска трейлера".into());
    }

    let fallback = match crate::rutube::find_trailer(name_ru.as_deref(), name_original.as_deref(), year.as_deref()).await {
        Ok(Some(page)) => match run_ytdlp(page, String::new()).await {
            Ok(r) => return Ok(r),
            Err(e) => format!("Rutube: {e}"),
        },
        Ok(None) => "Rutube: подходящего трейлера не нашлось".to_string(),
        Err(e) => e,
    };
    Err(match first_error {
        Some(y) => format!("{y}\n\nЗапасной вариант не сработал — {fallback}"),
        None => fallback,
    })
}

async fn run_ytdlp(url: String, cookies_browser: String) -> Result<ResolvedTrailer, String> {
    let cookies_browser_used = cookies_browser.clone();
    let youtube = is_youtube(&url);
    let bin = ytdlp_path()?;

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&bin);
        // Connection resets make yt-dlp retry silently for minutes (measured: 90 s+) —
        // fail fast instead, the UI offers "open in browser".
        cmd.args(["--socket-timeout", "8", "--retries", "1", "--extractor-retries", "1"]);
        // YouTube's "web" player client now demands a PO token yt-dlp can't produce
        // without real browser cookies ("Sign in to confirm you're not a bot") — the
        // Android client's API doesn't have that requirement, at the cost of only offering
        // lower-bitrate progressive formats (confirmed live: still gets a working mp4 link,
        // just capped around 360p instead of whatever "best" would otherwise pick).
        // `-J`: the full format list as JSON, so the player can offer every quality instead
        // of one picked here (the single muxed file YouTube still serves tops out at 360p).
        cmd.args(["-J", "--no-playlist"]);
        // YouTube's web client hides formats behind a JavaScript challenge that yt-dlp can
        // only solve with an external runtime (it looks for deno by default). Allow Node
        // too — a runtime that isn't installed is simply skipped.
        cmd.args(["--js-runtimes", "deno", "--js-runtimes", "node"]);
        // The bundled QuickJS (lib/qjs.exe) covers PCs with neither installed.
        if let Some(qjs) = tool_path(if cfg!(windows) { "qjs.exe" } else { "qjs" }) {
            cmd.arg("--js-runtimes").arg(format!("quickjs:{}", qjs.display()));
        }
        if !youtube {
            // Other sites (Rutube) need neither the YouTube client trick nor cookies.
        } else if cookies_browser.is_empty() {
            cmd.args(["--extractor-args", "youtube:player_client=android"]);
        } else {
            // The user's own signed-in YouTube session (opt-in, Settings) — the Android
            // client ignores cookies, so it's left at yt-dlp's default client here.
            cmd.args(["--cookies-from-browser", &cookies_browser]);
        }
        cmd.arg(&url);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let child = cmd.spawn()?;
        // Hard cap on top of the socket timeouts: kill the process rather than leave the
        // spinner up forever.
        let pid = child.id();
        let done = Arc::new(AtomicBool::new(false));
        let timed_out = Arc::new(AtomicBool::new(false));
        let watchdog_done = done.clone();
        let watchdog_timed_out = timed_out.clone();
        std::thread::spawn(move || {
            for _ in 0..(RESOLVE_TIMEOUT_SECS * 10) {
                std::thread::sleep(Duration::from_millis(100));
                if watchdog_done.load(Ordering::Relaxed) {
                    return;
                }
            }
            watchdog_timed_out.store(true, Ordering::Relaxed);
            #[cfg(windows)]
            {
                let mut kill = Command::new("taskkill");
                kill.args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(CREATE_NO_WINDOW);
                let _ = kill.output();
            }
            #[cfg(not(windows))]
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        });
        let result = child.wait_with_output();
        done.store(true, Ordering::Relaxed);
        result.map(|o| (o, timed_out.load(Ordering::Relaxed)))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("не удалось запустить yt-dlp: {e}"))?;
    let (output, timed_out) = output;

    if timed_out {
        return Err(format!(
            "YouTube не ответил за {RESOLVE_TIMEOUT_SECS} с — соединение сбрасывается (часто из-за VPN или блокировки). \
             Откройте трейлер в браузере."
        ));
    }
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("Could not copy") && stderr.contains("cookie") {
            return Err("Не удалось прочитать cookies браузера — полностью закройте его (включая фон в трее) и попробуйте снова.".into());
        }
        // yt-dlp's own message (video unavailable, no network, etc.) is far more useful
        // than a bare exit code — the last non-empty line is normally the actual error.
        let reason = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("неизвестная ошибка").trim();
        // YouTube flags the *IP address* (typically a VPN/proxy/hosting range), not the
        // client — once flagged, every player client and even a plain embed in a real
        // browser asks to sign in. Nothing on our side gets past that; say so plainly.
        if reason.contains("not a bot") {
            return Err(if cookies_browser_used.is_empty() {
                "YouTube просит подтвердить, что вы не бот — так бывает, когда включён VPN или прокси. \
                 Выберите свой браузер в Настройках → «Cookies YouTube для трейлеров» (нужно быть в нём \
                 залогиненным в YouTube), либо отключите VPN, либо откройте трейлер в браузере."
                    .into()
            } else {
                "YouTube всё равно просит подтвердить, что вы не бот, даже с cookies браузера — проверьте, что \
                 вы залогинены в YouTube в этом браузере, или откройте трейлер в браузере."
                    .into()
            });
        }
        return Err(format!("yt-dlp: {reason}"));
    }

    let info: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("yt-dlp вернул неразборчивый ответ: {e}"))?;
    let qualities = pick_qualities(&info, !youtube);
    if qualities.is_empty() {
        return Err("yt-dlp не вернул ни одной ссылки на видео".into());
    }
    // Every quality is offered in the menu, but playback starts at the sharpest one up to
    // 1080p — a 4K/8K stream can stutter on a modest PC; the viewer opts into it.
    let default_index = qualities.iter().rposition(|q| q.height <= DEFAULT_MAX_HEIGHT).unwrap_or(0);
    Ok(ResolvedTrailer { qualities, default_index })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn video(height: u64, vcodec: &str, tbr: f64, url: &str) -> serde_json::Value {
        json!({ "protocol": "https", "url": url, "height": height, "vcodec": vcodec, "acodec": "none", "tbr": tbr })
    }

    #[test]
    fn pairs_split_video_with_best_audio_prefers_h264_and_keeps_every_height() {
        let info = json!({ "formats": [
            { "protocol": "https", "url": "https://a/low", "vcodec": "none", "acodec": "mp4a", "abr": 48.0 },
            { "protocol": "https", "url": "https://a/high", "vcodec": "none", "acodec": "opus", "abr": 130.0 },
            video(720, "vp09.00", 600.0, "https://v/720-vp9"),
            video(720, "avc1.4d401f", 750.0, "https://v/720-avc"),
            video(1080, "av01.0.08M", 1100.0, "https://v/1080-av1"),
            video(2160, "vp09.00", 9000.0, "https://v/4k"),
        ]});
        let q = pick_qualities(&info, false);
        assert_eq!(
            q,
            vec![
                TrailerQuality { height: 720, url: "https://v/720-avc".into(), audio_url: Some("https://a/high".into()) },
                TrailerQuality { height: 1080, url: "https://v/1080-av1".into(), audio_url: Some("https://a/high".into()) },
                TrailerQuality { height: 2160, url: "https://v/4k".into(), audio_url: Some("https://a/high".into()) },
            ]
        );
    }

    #[test]
    fn muxed_file_is_used_alone_and_manifests_are_ignored() {
        let info = json!({ "formats": [
            { "protocol": "https", "url": "https://m/360", "height": 360, "vcodec": "avc1", "acodec": "mp4a" },
            { "protocol": "m3u8_native", "url": "https://hls/720", "height": 720, "vcodec": "avc1", "acodec": "mp4a" },
        ]});
        assert_eq!(
            pick_qualities(&info, false),
            vec![TrailerQuality { height: 360, url: "https://m/360".into(), audio_url: None }]
        );
    }

    #[test]
    fn hls_is_used_only_when_allowed_and_picks_one_entry_per_height() {
        let hls = |h: u64, url: &str| json!({ "protocol": "m3u8_native", "url": url, "height": h, "vcodec": "avc1", "acodec": "mp4a", "tbr": 1000.0 });
        let info = json!({ "formats": [hls(480, "https://r/480a"), hls(480, "https://r/480b"), hls(1080, "https://r/1080")] });
        assert!(pick_qualities(&info, false).is_empty());
        let heights: Vec<u32> = pick_qualities(&info, true).iter().map(|q| q.height).collect();
        assert_eq!(heights, vec![480, 1080]);
    }

    #[test]
    fn youtube_hosts_are_recognised() {
        assert!(is_youtube("https://www.youtube.com/watch?v=x"));
        assert!(is_youtube("https://youtu.be/x"));
        assert!(!is_youtube("https://rutube.ru/video/x/"));
    }

    #[test]
    fn split_video_without_any_audio_is_dropped() {
        let info = json!({ "formats": [video(1080, "avc1", 2000.0, "https://v/1080")] });
        assert!(pick_qualities(&info, false).is_empty());
    }
}
