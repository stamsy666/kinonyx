//! Resolves a YouTube (or any yt-dlp-supported) page URL to a direct, playable stream
//! URL — used for trailers, which Kinopoisk only ever gives us as a page link, not a
//! stream. Done here in Rust (rather than leaning on mpv's own built-in ytdl_hook
//! script) because this plugin gives no visibility into that script's own log output,
//! making a silent failure impossible to diagnose; shelling out ourselves means real
//! stderr, in a UI-visible error, when it doesn't work.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};

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

fn configure_js_runtimes(command: &mut Command) {
    command.args(["--js-runtimes", "deno", "--js-runtimes", "node"]);
    if let Some(qjs) = tool_path(if cfg!(windows) { "qjs.exe" } else { "qjs" }) {
        command.arg("--js-runtimes").arg(format!("quickjs:{}", qjs.display()));
    }
}

pub(crate) async fn save_youtube_video(
    video_id: &str,
    height: u32,
    work_dir: &Path,
    account_cookies: Option<&str>,
    progress: &Channel<YoutubeDownloadEvent>,
    mut cancel: tokio::sync::oneshot::Receiver<()>,
) -> Result<YoutubeDownloadResult, String> {
    let ffmpeg = tool_path(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" })
        .ok_or("Для скачивания видео со звуком нужен FFmpeg из комплекта KINONYX.")?;
    let executable = ytdlp_path()?;
    let attempt = |folder: &Path| {
        let mut command = Command::new(&executable);
        configure_youtube_download(&mut command, folder, &ffmpeg, video_id, height);
        command
    };

    // A signed-in extractor can expose different formats than the public player.
    // Keep the session in memory until YouTube requires it, and isolate partial files for each attempt.
    let public = tempfile::tempdir_in(work_dir).map_err(|_| DownloadFailure::WriteDenied.message())?;
    let result = run_youtube_download(attempt(public.path()), progress, &mut cancel).await;
    match result {
        Ok(result) => finish_download_attempt(public.path(), work_dir, result).await,
        Err(error) => {
            record_download_failure(video_id, false, error);
            drop(public);
            let Some(cookies) = account_cookies.filter(|_| error.retry_with_session()) else {
                return Err(error.message().into());
            };
            let authorized = tempfile::tempdir_in(work_dir).map_err(|_| DownloadFailure::WriteDenied.message())?;
            // The output folder may be shared or synced. Write credentials only in the user's temporary folder.
            let mut session = tempfile::NamedTempFile::new().map_err(|_| "Не удалось подготовить сессию для загрузки.")?;
            session.write_all(cookies.as_bytes()).map_err(|_| "Не удалось подготовить сессию для загрузки.")?;
            let mut command = attempt(authorized.path());
            command.arg("--cookies").arg(session.path());
            let result = run_youtube_download(command, progress, &mut cancel).await.map_err(|error| {
                record_download_failure(video_id, true, error);
                error.message()
            })?;
            finish_download_attempt(authorized.path(), work_dir, result).await
        }
    }
}

async fn finish_download_attempt(attempt: &Path, destination: &Path, result: YoutubeDownloadResult) -> Result<YoutubeDownloadResult, String> {
    if matches!(result, YoutubeDownloadResult::Saved(_)) {
        let output = attempt.join("video.mkv");
        if !tokio::fs::metadata(&output).await.is_ok_and(|info| info.is_file() && info.len() > 0) {
            return Err("YouTube не предоставил готовый видеофайл. Для прямых эфиров дождитесь записи.".into());
        }
        tokio::fs::rename(output, destination.join("video.mkv")).await
            .map_err(|_| "Не удалось записать загруженное видео в выбранную папку.")?;
    }
    Ok(result)
}

fn configure_youtube_download(command: &mut Command, work_dir: &Path, ffmpeg: &Path, video_id: &str, height: u32) {
    command
        .current_dir(work_dir)
        .env("PYTHONIOENCODING", "utf-8")
        .args([
            "--ignore-config", "--no-plugin-dirs", "--no-update", "--no-playlist", "--no-simulate",
            "--socket-timeout", "15", "--retries", "2", "--fragment-retries", "2",
            "--match-filter", "!is_live & live_status != is_upcoming",
            "--merge-output-format", "mkv", "--remux-video", "mkv",
            "--newline", "--progress", "--progress-delta", "0.25",
            "--progress-template", "download:kinonyx-progress:%(info.vcodec)s|%(info.acodec)s|%(progress)j",
            "--progress-template", "postprocess:kinonyx-merging",
            "--print", "after_move:height=%(height)s", "--output", "video.%(ext)s",
        ])
        .arg("--ffmpeg-location").arg(ffmpeg)
        .arg("--format").arg(youtube_download_format(height))
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    configure_js_runtimes(command);
    command.arg(format!("https://www.youtube.com/watch?v={video_id}"));
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
}

async fn run_youtube_download(command: Command, progress: &Channel<YoutubeDownloadEvent>,
    cancel: &mut tokio::sync::oneshot::Receiver<()>) -> Result<YoutubeDownloadResult, DownloadFailure> {
    let mut child = tokio::process::Command::from(command).kill_on_drop(true).spawn()
        .map_err(|_| DownloadFailure::Launch)?;
    tokio::select! {
        result = read_youtube_download(&mut child, progress) => result,
        _ = cancel => {
            #[cfg(windows)]
            if let Some(pid) = child.id() {
                let _ = tokio::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output().await;
            }
            let _ = child.kill().await;
            Ok(YoutubeDownloadResult::Cancelled)
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeDownloadEvent {
    // Header and transfer events share the same channel as the save command.
    pub stage: &'static str,
    pub file_name: Option<String>,
    pub received: u64,
    pub total: u64,
    pub speed: f64,
}

pub(crate) enum YoutubeDownloadResult {
    Saved(Option<u32>),
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DownloadFailure {
    Launch,
    SignIn,
    Forbidden,
    Unavailable,
    Format,
    DiskFull,
    WriteDenied,
    Network,
    Merge,
    Unknown,
}

impl DownloadFailure {
    fn from_error(line: &str) -> Self {
        let line = line.to_ascii_lowercase();
        if line.contains("no space left") || line.contains("not enough space") || line.contains("winerror 112") {
            Self::DiskFull
        } else if line.contains("unable to open for writing") || line.contains("permission denied")
            || line.contains("access is denied") || line.contains("winerror 5") || line.contains("errno 13") {
            Self::WriteDenied
        } else if line.contains("sign in") || line.contains("not a bot") || line.contains("private video") || line.contains("cookies are no longer valid") {
            Self::SignIn
        } else if line.contains("http error 403") || line.contains("403 forbidden") {
            Self::Forbidden
        } else if line.contains("requested format is not available") || line.contains("no video formats found") {
            Self::Format
        } else if line.contains("video is unavailable") || line.contains("video unavailable") || line.contains("not available in your country") {
            Self::Unavailable
        } else if line.contains("timed out") || line.contains("unable to download webpage") || line.contains("unable to download api page")
            || line.contains("connection reset") || line.contains("ssl error") {
            Self::Network
        } else if line.contains("postprocessing") {
            Self::Merge
        } else {
            Self::Unknown
        }
    }

    fn retry_with_session(self) -> bool {
        matches!(self, Self::SignIn | Self::Forbidden | Self::Format | Self::Unavailable)
    }

    fn message(self) -> &'static str {
        match self {
            Self::Launch => "Не удалось запустить сохранение видео.",
            Self::SignIn => "YouTube запросил вход. Проверьте сессию в «Настройки → Источники».",
            Self::Forbidden => "YouTube отклонил запрос к видео или звуку (HTTP 403). Повторите загрузку или выберите другое качество.",
            Self::Unavailable => "YouTube не предоставил этот ролик для скачивания.",
            Self::Format => "В выбранном качестве YouTube не предоставил файл для скачивания.",
            Self::DiskFull => "На выбранном диске не хватило места для видео и звука.",
            Self::WriteDenied => "Не удалось записать файл в выбранную папку. Проверьте права на запись.",
            Self::Network => "Соединение с YouTube прервалось во время скачивания.",
            Self::Merge => "Скачивание завершилось, но не удалось объединить видео и звук.",
            Self::Unknown => "Загрузчик YouTube завершился с ошибкой.",
        }
    }
}

fn record_download_failure(video_id: &str, used_session: bool, failure: DownloadFailure) {
    crate::elog!("[youtube download] video={video_id} signed_in={used_session} failure={failure:?}");
}

async fn read_youtube_download(child: &mut tokio::process::Child, progress: &Channel<YoutubeDownloadEvent>)
    -> Result<YoutubeDownloadResult, DownloadFailure> {
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();
    let mut stderr = BufReader::new(child.stderr.take().expect("stderr is piped")).lines();
    let (mut stdout_closed, mut stderr_closed) = (false, false);
    let mut height = None;
    let mut error = None;
    while !stdout_closed || !stderr_closed {
        let line = tokio::select! {
            line = stdout.next_line(), if !stdout_closed => {
                stdout_closed = !matches!(line, Ok(Some(_)));
                line.ok().flatten()
            }
            line = stderr.next_line(), if !stderr_closed => {
                stderr_closed = !matches!(line, Ok(Some(_)));
                line.ok().flatten()
            }
        };
        let Some(line) = line else { continue };
        if let Some(update) = youtube_download_progress(&line) {
            let _ = progress.send(update);
        } else if let Some(value) = line.strip_prefix("height=") {
            height = value.parse().ok();
        } else if line.starts_with("ERROR:") {
            let reason = DownloadFailure::from_error(&line);
            if error.is_none() || reason != DownloadFailure::Unknown {
                error = Some(reason);
            }
        }
    }
    if child.wait().await.is_ok_and(|status| status.success()) {
        Ok(YoutubeDownloadResult::Saved(height))
    } else {
        Err(error.unwrap_or(DownloadFailure::Unknown))
    }
}

fn youtube_download_progress(line: &str) -> Option<YoutubeDownloadEvent> {
    if line == "kinonyx-merging" {
        return Some(YoutubeDownloadEvent { stage: "merging", file_name: None, received: 0, total: 0, speed: 0.0 });
    }
    let mut fields = line.strip_prefix("kinonyx-progress:")?.splitn(3, '|');
    let stage = match (fields.next()?, fields.next()?) {
        ("none", _) => "audio",
        (_, "none") => "video",
        _ => "file",
    };
    let data: serde_json::Value = serde_json::from_str(fields.next()?).ok()?;
    let received = data["downloaded_bytes"].as_u64().unwrap_or(0);
    let total = data["total_bytes"].as_u64().or_else(|| data["total_bytes_estimate"].as_u64()).unwrap_or(0);
    Some(YoutubeDownloadEvent { stage, file_name: None, received, total, speed: data["speed"].as_f64().unwrap_or(0.0) })
}

fn youtube_download_format(height: u32) -> String {
    format!("bv[height<={height}]+ba[language~='(?i)^ru(s)?(?:[-_]|$)']/bv[height<={height}]+ba/b[height<={height}]")
}

fn is_youtube(url: &str) -> bool {
    let host = url.split('/').nth(2).unwrap_or("").trim_start_matches("www.");
    host == "youtube.com" || host == "m.youtube.com" || host == "youtu.be"
}

/// One selectable quality. YouTube serves anything above 360p as separate video and audio
/// streams, so a sharp quality is two URLs that mpv plays together; the old muxed 360p file
/// has no `audio_url`.
#[derive(Clone, serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrailerQuality {
    pub height: u32,
    pub url: String,
    pub audio_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hls_bitrate: Option<u64>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTrailer {
    pub qualities: Vec<TrailerQuality>,
    /// Index into `qualities` to start with — the sharpest one up to `DEFAULT_MAX_HEIGHT`.
    pub default_index: usize,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub channel_id: Option<String>,
    pub is_live: bool,
}

pub(crate) const DEFAULT_MAX_HEIGHT: u32 = 1080;

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

pub(crate) fn is_russian_language(language: &str) -> bool {
    language.trim_matches('"').split(['-', '_']).next().is_some_and(|code| {
        code.eq_ignore_ascii_case("ru") || code.eq_ignore_ascii_case("rus")
    })
}

fn russian_audio(format: &serde_json::Value) -> bool {
    format["language"].as_str().is_some_and(is_russian_language)
}

fn best_audio<'a>(
    formats: impl Iterator<Item = &'a serde_json::Value>,
    allow_hls: bool,
    prefer_russian: bool,
) -> Option<(bool, String)> {
    formats
        .filter(|f| has_codec(f, "acodec") && !has_codec(f, "vcodec"))
        .filter_map(|f| {
            let preferred = prefer_russian && russian_audio(f);
            let language_rank = if prefer_russian { f["language_preference"].as_i64().unwrap_or(0) } else { 0 };
            let bitrate = f["abr"].as_f64().unwrap_or(0.0);
            direct_url(f, allow_hls).map(|url| ((preferred, language_rank, bitrate), url))
        })
        .max_by(|((ru_a, rank_a, bitrate_a), _), ((ru_b, rank_b, bitrate_b), _)| {
            (ru_a, rank_a).cmp(&(ru_b, rank_b)).then_with(|| bitrate_a.total_cmp(bitrate_b))
        })
        .map(|((preferred, _, _), url)| (preferred, url))
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
fn pick_qualities(info: &serde_json::Value, allow_hls: bool, prefer_russian: bool) -> Vec<TrailerQuality> {
    let formats = info["formats"].as_array().map(Vec::as_slice).unwrap_or_default();
    let audio = best_audio(formats.iter(), allow_hls, prefer_russian);

    let mut by_height = std::collections::BTreeMap::new();
    for f in formats {
        let Some(height) = f["height"].as_u64() else { continue };
        let Some(url) = direct_url(f, allow_hls) else { continue };
        // Some sites list plain mp4 files without saying which codecs: a file with a height and no
        // codec information at all is one muxed picture-and-sound file.
        let unlabelled = f["vcodec"].is_null() && f["acodec"].is_null();
        let (video, muxed) = if unlabelled { (true, true) } else { (has_codec(f, "vcodec"), has_codec(f, "acodec")) };
        if !video {
            continue;
        }
        // A split video stream needs an audio stream to go with it; a muxed one doesn't.
        let (preferred, audio_url) = if muxed {
            (prefer_russian && russian_audio(f), None)
        } else {
            let Some((preferred, url)) = &audio else { continue };
            (*preferred, Some(url.clone()))
        };
        // Prefer split streams when both choices have the same language priority.
        let rank = (preferred, audio_url.is_some(), codec_rank(f), f["tbr"].as_f64().unwrap_or(0.0));
        let height = height as u32;
        let better = by_height.get(&height).is_none_or(|(current, _)| rank > *current);
        if better {
            by_height.insert(height, (rank, TrailerQuality { height, url, audio_url, hls_bitrate: None }));
        }
    }
    by_height.into_values().map(|(_, q)| q).collect()
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

    if !url.is_empty() {
        // A trailer the viewer picked by name must not silently turn into a name search
        // on Rutube — every pick would then play the same video. The error is shown
        // instead (with "open in browser"); the Rutube list entry is the explicit way.
        if !is_youtube(&url) {
            return run_ytdlp(url, Auth::None, None).await;
        }
        return resolve_youtube(url, cookies_browser).await;
    } else if !can_search {
        return Err("Нет данных для поиска трейлера".into());
    }

    let fallback = match crate::rutube::find_trailer(name_ru.as_deref(), name_original.as_deref(), year.as_deref()).await {
        Ok(Some(page)) => match run_ytdlp(page, Auth::None, None).await {
            Ok(r) => return Ok(r),
            Err(e) => format!("Rutube: {e}"),
        },
        Ok(None) => "Rutube: подходящего трейлера не нашлось".to_string(),
        Err(e) => e,
    };
    Err(fallback)
}

/// Marks the error YouTube gives a flagged IP ("Sign in to confirm you're not a bot"), so the
/// chain below can tell it from the rest and try the next way.
const BOT: &str = "\u{1}bot";
const COOKIES_LOCKED: &str = "Не удалось прочитать cookies браузера";

/// The cookies kept between runs: `%USERPROFILE%\.kinonyx\youtube-cookies.txt`. Read once from the
/// browser (that is the only moment it has to be closed); yt-dlp writes the file back after every run,
/// so the session it holds stays fresh. A cookies.txt exported by hand (FAQ: private window +
/// "Get cookies.txt LOCALLY") can be put there too.
pub fn cookies_file() -> PathBuf {
    crate::logs::dir().parent().map(|p| p.join("youtube-cookies.txt")).unwrap_or_else(|| PathBuf::from("youtube-cookies.txt"))
}

pub(crate) async fn export_browser_cookies(browser: &str, path: &std::path::Path) -> Result<(), String> {
    if !matches!(browser, "chrome" | "edge" | "firefox") {
        return Err("Сначала выберите браузер в настройке cookies для трейлеров.".into());
    }
    let mut command = tokio::process::Command::new(ytdlp_path()?);
    // This local listing mode lets yt-dlp save its cookie jar without fetching a URL.
    command
        .args([
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-update",
            "--list-impersonate-targets",
            "--cookies-from-browser",
            browser,
            "--cookies",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = tokio::time::timeout(Duration::from_secs(RESOLVE_TIMEOUT_SECS), command.output())
        .await
        .map_err(|_| "Чтение сессии из браузера заняло слишком много времени.")?
        .map_err(|_| "Не удалось запустить yt-dlp для чтения сессии браузера.")?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("Could not copy") && stderr.contains("cookie") {
        return Err("Закройте выбранный браузер полностью, включая фоновые процессы, и попробуйте снова.".into());
    }
    Err("Браузер не предоставил cookies. Проверьте, что вы вошли в YouTube, или импортируйте cookies.txt.".into())
}

enum Auth {
    None,
    File(PathBuf),
    /// Read from the browser and saved into the file for the next time.
    Browser(String, PathBuf),
}

pub(crate) async fn resolve_youtube_video(
    video_id: &str,
    cookie_file: Option<&std::path::Path>,
) -> Result<ResolvedTrailer, String> {
    let url = format!("https://www.youtube.com/watch?v={video_id}");
    let result = run_ytdlp(
        url.clone(),
        cookie_file.map_or(Auth::None, |path| Auth::File(path.to_path_buf())),
        None,
    ).await;
    match result {
        Err(e) if e == BOT => Err("YouTube просит подтвердить вход. Переподключите аккаунт или откройте видео в браузере.".into()),
        Err(_) => Err("Не удалось получить видеопоток. Попробуйте ещё раз или откройте видео в браузере.".into()),
        Ok(stream) => Ok(stream),
    }
}

async fn live_qualities(info: &serde_json::Value) -> Vec<TrailerQuality> {
    let formats = info["formats"].as_array().map(Vec::as_slice).unwrap_or_default();
    let hls = |format: &&serde_json::Value| format["protocol"].as_str().is_some_and(|value| value.starts_with("m3u8"));
    let manifest = formats.iter().filter(hls).find_map(|format| format["manifest_url"].as_str());
    let user_agent = info.pointer("/http_headers/User-Agent").and_then(serde_json::Value::as_str);
    if let Some(manifest) = manifest {
        if let Some(qualities) = crate::youtube::streams::load_master(manifest, user_agent).await {
            return qualities;
        }
    }
    let audio = best_audio(formats.iter().filter(hls).filter(|f| f["height"].is_null()), true, true);
    let mut by_height = std::collections::BTreeMap::new();
    for format in formats.iter().filter(hls) {
        let Some(height) = format["height"].as_u64().and_then(|value| u32::try_from(value).ok()) else { continue };
        let Some(url) = direct_url(format, true) else { continue };
        if !has_codec(format, "vcodec") { continue; }
        let (preferred, audio_url) = if has_codec(format, "acodec") {
            (russian_audio(format), None)
        } else {
            let Some((preferred, url)) = &audio else { continue };
            (*preferred, Some(url.clone()))
        };
        if by_height.get(&height).is_none_or(|(current, _)| preferred >= *current) {
            by_height.insert(height, (preferred, TrailerQuality { height, url, audio_url, hls_bitrate: None }));
        }
    }
    if by_height.is_empty() {
        return pick_qualities(info, true, true);
    }
    by_height.into_values().map(|(_, quality)| quality).collect()
}

/// YouTube without making the viewer close the browser every time:
/// 1. the saved cookies file, if there is one, else no cookies at all — yt-dlp's own default clients
///    (the ones that need no PO token right now; measured: 1080p without cookies);
/// 2. YouTube says "not a bot" (it flags the IP, typically a VPN): clients that skip that check for
///    embeddable videos — trailers nearly always are;
/// 3. still flagged and a browser is chosen in Settings: read its cookies once into the file.
async fn resolve_youtube(url: String, browser: String) -> Result<ResolvedTrailer, String> {
    let file = cookies_file();
    let have_file = file.is_file();
    let first = run_ytdlp(url.clone(), if have_file { Auth::File(file.clone()) } else { Auth::None }, None).await;
    match &first {
        Err(e) if e == BOT => {}
        _ => return first,
    }
    if let ok @ Ok(_) = run_ytdlp(url.clone(), Auth::None, Some("web_embedded,android_vr,tv")).await {
        return ok;
    }
    if browser.is_empty() {
        return Err(bot_message(have_file, false));
    }
    let result = run_ytdlp(url, Auth::Browser(browser, file.clone()), None).await;
    keep_only_youtube(&file);
    match result {
        Err(e) if e == BOT => Err(bot_message(true, true)),
        other => other,
    }
}

/// yt-dlp saves the browser's whole cookie jar; only YouTube's and Google's (the sign-in) stay on disk.
fn keep_only_youtube(file: &std::path::Path) {
    let Ok(text) = std::fs::read_to_string(file) else { return };
    let kept: Vec<&str> = text
        .lines()
        .filter(|line| {
            // Netscape format: the domain is the first tab-separated field; "#HttpOnly_" prefixes some.
            if line.trim().is_empty() || (line.starts_with('#') && !line.starts_with("#HttpOnly_")) {
                return true;
            }
            let domain = line.trim_start_matches("#HttpOnly_").split('\t').next().unwrap_or("");
            let domain = domain.trim_start_matches('.');
            ["youtube.com", "google.com"].iter().any(|d| domain == *d || domain.ends_with(&format!(".{d}")))
        })
        .collect();
    let _ = std::fs::write(file, kept.join(if cfg!(windows) { "\r\n" } else { "\n" }) + if cfg!(windows) { "\r\n" } else { "\n" });
}

fn bot_message(had_cookies: bool, from_browser: bool) -> String {
    if from_browser {
        "YouTube всё равно просит подтвердить, что вы не бот, даже с cookies браузера — проверьте, что \
         вы залогинены в YouTube в этом браузере, или откройте трейлер в браузере."
            .into()
    } else if had_cookies {
        "YouTube просит подтвердить, что вы не бот: сохранённые cookies устарели. Выберите браузер в Настройках → \
         «Cookies YouTube для трейлеров» — они прочитаются из него один раз (браузер нужно закрыть только сейчас), \
         либо смените сервер VPN или откройте трейлер в браузере."
            .into()
    } else {
        "YouTube просит подтвердить, что вы не бот — так бывает, когда включён VPN или прокси. \
         Выберите свой браузер в Настройках → «Cookies YouTube для трейлеров» (нужно быть в нём \
         залогиненным в YouTube; закрыть его нужно один раз — cookies сохранятся), либо смените сервер VPN, \
         либо откройте трейлер в браузере."
            .into()
    }
}

async fn run_ytdlp(url: String, auth: Auth, clients: Option<&'static str>) -> Result<ResolvedTrailer, String> {
    let youtube = is_youtube(&url);
    if let Auth::Browser(_, file) = &auth {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
    }
    let bin = ytdlp_path()?;

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&bin);
        // Connection resets make yt-dlp retry silently for minutes (measured: 90 s+) —
        // fail fast instead, the UI offers "open in browser".
        cmd.args(["--socket-timeout", "8", "--retries", "1", "--extractor-retries", "1"]);
        // `-J`: the full format list as JSON, so the player can offer every quality instead
        // of one picked here (the single muxed file YouTube still serves tops out at 360p).
        cmd.args(["-J", "--no-playlist"]);
        // YouTube's web client hides formats behind a JavaScript challenge that yt-dlp can
        // only solve with an external runtime (it looks for deno by default). Allow Node
        // too — a runtime that isn't installed is simply skipped.
        configure_js_runtimes(&mut cmd);
        // Other sites (Rutube) need neither the YouTube clients nor cookies. The forced Android client
        // used here before now wants a PO token itself (yt-dlp PO Token Guide) — yt-dlp's default
        // client list already skips the ones that do.
        if youtube {
            if let Some(c) = clients {
                cmd.arg("--extractor-args").arg(format!("youtube:player_client={c}"));
            }
            match &auth {
                Auth::None => {}
                Auth::File(file) => {
                    cmd.arg("--cookies").arg(file);
                }
                Auth::Browser(browser, file) => {
                    cmd.args(["--cookies-from-browser", browser]).arg("--cookies").arg(file);
                }
            }
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
            return Err(format!(
                "{COOKIES_LOCKED} — закройте его полностью (включая фон в трее) и попробуйте снова. Это нужно один раз: \
                 дальше cookies берутся из сохранённого файла."
            ));
        }
        // yt-dlp's own message (video unavailable, no network, etc.) is far more useful
        // than a bare exit code — the last non-empty line is normally the actual error.
        let reason = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("неизвестная ошибка").trim();
        // YouTube flags the *IP address* (typically a VPN/proxy/hosting range); `resolve_youtube`
        // decides what to try next and what to tell the viewer.
        if reason.contains("not a bot") || reason.contains("Sign in to confirm") {
            return Err(BOT.into());
        }
        // Rutube drops the connection (TLS "EOF", timeouts) when it is reached through a foreign VPN/proxy exit.
        // The raw Python error says nothing about that, so say it.
        if reason.contains("[rutube]") && (reason.contains("EOF occurred") || reason.contains("timed out") || reason.contains("SSLError")) {
            return Err("Rutube не открывается: он обрывает соединения через VPN или прокси. Добавьте rutube.ru в правила прямого \
                        подключения (DIRECT) вашего VPN либо откройте трейлер в браузере."
                .into());
        }
        return Err(format!("yt-dlp: {reason}"));
    }

    let info: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("yt-dlp вернул неразборчивый ответ: {e}"))?;
    let live = info["is_live"].as_bool().unwrap_or(false);
    let hls = youtube && live;
    let qualities = if hls { live_qualities(&info).await } else { pick_qualities(&info, !youtube, youtube) };
    if qualities.is_empty() {
        return Err("yt-dlp не вернул ни одной ссылки на видео".into());
    }
    // Every quality is offered in the menu, but playback starts at the sharpest one up to
    // 1080p — a 4K/8K stream can stutter on a modest PC; the viewer opts into it.
    let default_index = qualities.iter().rposition(|q| q.height <= DEFAULT_MAX_HEIGHT).unwrap_or(0);
    let metadata = |key: &str| info[key].as_str().filter(|s| !s.trim().is_empty()).map(str::to_owned);
    Ok(ResolvedTrailer {
        qualities,
        default_index,
        title: metadata("title"),
        channel: metadata("channel").or_else(|| metadata("uploader")),
        channel_id: metadata("channel_id"),
        is_live: live,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn download_progress_distinguishes_video_audio_and_merging() {
        let video = youtube_download_progress(r#"kinonyx-progress:avc1|none|{"downloaded_bytes":440,"total_bytes_estimate":800,"speed":22.5}"#).unwrap();
        assert_eq!((video.stage, video.received, video.total, video.speed), ("video", 440, 800, 22.5));
        let audio = youtube_download_progress(r#"kinonyx-progress:none|opus|{"downloaded_bytes":131,"total_bytes":150}"#).unwrap();
        assert_eq!((audio.stage, audio.received, audio.total), ("audio", 131, 150));
        assert_eq!(youtube_download_progress("kinonyx-merging").unwrap().stage, "merging");
        assert!(youtube_download_progress("height=720").is_none());
    }

    #[test]
    fn download_errors_retry_only_youtube_access_failures_with_the_session() {
        let cases = [
            ("ERROR: unable to download video data: HTTP Error 403: Forbidden", DownloadFailure::Forbidden, true),
            ("ERROR: [youtube] Sign in to confirm your age", DownloadFailure::SignIn, true),
            ("ERROR: [youtube] Requested format is not available", DownloadFailure::Format, true),
            ("ERROR: unable to write data: [WinError 112] There is not enough space", DownloadFailure::DiskFull, false),
            ("ERROR: unable to open for writing: [Errno 13] Permission denied", DownloadFailure::WriteDenied, false),
            ("ERROR: Unable to download API page: The read operation timed out", DownloadFailure::Network, false),
            ("ERROR: Postprocessing: Error opening input files", DownloadFailure::Merge, false),
        ];
        for (line, expected, retry) in cases {
            let reason = DownloadFailure::from_error(line);
            assert_eq!(reason, expected);
            assert_eq!(reason.retry_with_session(), retry);
        }
    }

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
        let q = pick_qualities(&info, false, false);
        assert_eq!(
            q,
            vec![
                TrailerQuality { height: 720, url: "https://v/720-avc".into(), audio_url: Some("https://a/high".into()), hls_bitrate: None },
                TrailerQuality { height: 1080, url: "https://v/1080-av1".into(), audio_url: Some("https://a/high".into()), hls_bitrate: None },
                TrailerQuality { height: 2160, url: "https://v/4k".into(), audio_url: Some("https://a/high".into()), hls_bitrate: None },
            ]
        );
    }

    #[test]
    fn prefers_russian_audio_for_youtube_even_at_a_lower_bitrate() {
        let mut info = json!({ "formats": [
            video(1080, "avc1", 2000.0, "https://v/1080"),
            { "protocol": "https", "url": "https://a/en", "vcodec": "none", "acodec": "opus", "abr": 180, "language": "en", "language_preference": 10 },
            { "protocol": "https", "url": "https://a/ru", "vcodec": "none", "acodec": "aac", "abr": 90, "language": "ru-RU", "language_preference": -1 }
        ] });
        assert_eq!(pick_qualities(&info, false, true)[0].audio_url.as_deref(), Some("https://a/ru"));
        assert_eq!(pick_qualities(&info, false, false)[0].audio_url.as_deref(), Some("https://a/en"));
        info["formats"].as_array_mut().unwrap().pop();
        assert_eq!(pick_qualities(&info, false, true)[0].audio_url.as_deref(), Some("https://a/en"));
    }

    #[test]
    fn muxed_file_is_used_alone_and_manifests_are_ignored() {
        let info = json!({ "formats": [
            { "protocol": "https", "url": "https://m/360", "height": 360, "vcodec": "avc1", "acodec": "mp4a" },
            { "protocol": "m3u8_native", "url": "https://hls/720", "height": 720, "vcodec": "avc1", "acodec": "mp4a" },
        ]});
        assert_eq!(
            pick_qualities(&info, false, false),
            vec![TrailerQuality { height: 360, url: "https://m/360".into(), audio_url: None, hls_bitrate: None }]
        );
    }

    #[test]
    fn hls_is_used_only_when_allowed_and_picks_one_entry_per_height() {
        let hls = |h: u64, url: &str| json!({ "protocol": "m3u8_native", "url": url, "height": h, "vcodec": "avc1", "acodec": "mp4a", "tbr": 1000.0 });
        let info = json!({ "formats": [hls(480, "https://r/480a"), hls(480, "https://r/480b"), hls(1080, "https://r/1080")] });
        assert!(pick_qualities(&info, false, false).is_empty());
        let heights: Vec<u32> = pick_qualities(&info, true, false).iter().map(|q| q.height).collect();
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
        assert!(pick_qualities(&info, false, false).is_empty());
    }
}
