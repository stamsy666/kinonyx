//! First-run key check and the Diagnostics screen: one lightweight request per thing that
//! commonly breaks (keys, VPN-blocked hosts, missing sidecar files) with a hint a person
//! can act on, instead of a bare "error sending request".

use crate::config::AppConfig;
use crate::http::CLIENT;
use serde::Serialize;
use std::time::Duration;

const KP_BASE: &str = "https://kinopoiskapiunofficial.tech";
const TMDB_BASE: &str = "https://api.themoviedb.org/3";

fn net_error(host: &str, e: &reqwest::Error) -> String {
    if e.is_timeout() || e.is_connect() {
        format!("{host} не отвечает — возможно, нужен VPN или нет интернета")
    } else {
        format!("Сеть: {e}")
    }
}

/// Ok(()) when `key` is accepted by `source`; otherwise a ready-to-show Russian message.
async fn probe_key(source: &str, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Ключ пустой".into());
    }
    let (host, req) = match source {
        "kinopoisk" => (
            "kinopoiskapiunofficial.tech",
            CLIENT
                .get(format!("{KP_BASE}/api/v1/api_keys/{}", urlencoding::encode(key)))
                .header("X-API-KEY", key),
        ),
        "tmdb" => (
            "api.themoviedb.org",
            CLIENT.get(format!("{TMDB_BASE}/configuration?api_key={}", urlencoding::encode(key))),
        ),
        _ => return Err("Неизвестный источник".into()),
    };
    let res = req.timeout(Duration::from_secs(10)).send().await.map_err(|e| net_error(host, &e))?;
    match res.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err("Ключ не подошёл — проверьте, что скопировали его целиком".into()),
        404 if source == "kinopoisk" => Err("Такого ключа нет — проверьте, что скопировали его целиком".into()),
        429 => Err("Лимит запросов этого ключа на сегодня исчерпан".into()),
        code => Err(format!("{host} ответил HTTP {code}")),
    }
}

#[tauri::command]
pub async fn check_source_key(source: String, key: String) -> Result<(), String> {
    probe_key(&source, &key).await
}

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Warn,
    Fail,
}

#[derive(Serialize, Debug)]
pub struct Check {
    pub id: &'static str,
    pub label: &'static str,
    pub status: Status,
    pub detail: String,
    pub hint: Option<String>,
}

fn check(id: &'static str, label: &'static str, status: Status, detail: impl Into<String>, hint: Option<&str>) -> Check {
    Check { id, label, status, detail: detail.into(), hint: hint.map(str::to_string) }
}

/// Any HTTP answer (even 403/404) means the host is reachable — we only test the route.
async fn reachable(id: &'static str, label: &'static str, url: &str, hint: &str) -> Check {
    match CLIENT.get(url).timeout(Duration::from_secs(6)).send().await {
        Ok(r) => check(id, label, Status::Ok, format!("доступен (HTTP {})", r.status().as_u16()), None),
        Err(e) => check(id, label, Status::Fail, net_error(url.split('/').nth(2).unwrap_or(url), &e), Some(hint)),
    }
}

async fn key_check(id: &'static str, label: &'static str, source: &str, key: String, missing_hint: &str) -> Check {
    if key.trim().is_empty() {
        return check(id, label, Status::Warn, "ключ не задан", Some(missing_hint));
    }
    match probe_key(source, &key).await {
        Ok(()) => check(id, label, Status::Ok, "ключ принят", None),
        Err(e) => check(id, label, Status::Fail, e, Some("Введите ключ заново: Настройки → источник данных")),
    }
}

fn exe_dir() -> Option<std::path::PathBuf> {
    std::env::current_exe().ok()?.parent().map(|p| p.to_path_buf())
}

fn file_check(id: &'static str, label: &'static str, names: &[&str], hint: &str) -> Check {
    let Some(dir) = exe_dir() else {
        return check(id, label, Status::Warn, "не удалось определить папку программы", None);
    };
    let found = names.iter().any(|n| dir.join(n).exists() || dir.join("lib").join(n).exists());
    if found {
        check(id, label, Status::Ok, "найден", None)
    } else {
        check(id, label, Status::Fail, "файл не найден", Some(hint))
    }
}

fn which(tool: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|paths| {
        std::env::split_paths(&paths).any(|p| p.join(format!("{tool}.exe")).exists() || p.join(tool).exists())
    })
}

/// yt-dlp needs a JS runtime for YouTube; we ship QuickJS, but a system node/deno also works.
fn js_runtime_check() -> Check {
    let bundled = exe_dir().is_some_and(|d| d.join("qjs.exe").exists() || d.join("lib").join("qjs.exe").exists());
    if bundled {
        return check("js_runtime", "JS-движок для трейлеров", Status::Ok, "QuickJS из комплекта", None);
    }
    for tool in ["node", "deno"] {
        if which(tool) {
            return check("js_runtime", "JS-движок для трейлеров", Status::Ok, format!("найден {tool} в системе"), None);
        }
    }
    check(
        "js_runtime",
        "JS-движок для трейлеров",
        Status::Warn,
        "не найден",
        Some("Трейлеры с YouTube могут не открываться; переустановите KINONYX или поставьте Node.js"),
    )
}

#[tauri::command]
pub async fn run_diagnostics(config: tauri::State<'_, AppConfig>) -> Result<Vec<Check>, String> {
    let kp_key = config.kinopoisk_api_key.lock().unwrap().clone();
    let tmdb_key = config.tmdb_api_key.lock().unwrap().clone();
    let torapi = crate::torapi::resolved_base(&config).await;
    let ts_url = format!("http://127.0.0.1:{}/echo", config.torrserve_port);

    let ts = async {
        match CLIENT.get(&ts_url).timeout(Duration::from_millis(1500)).send().await {
            Ok(r) if r.status().is_success() => check("torrserve", "TorrServer", Status::Ok, "запущен", None),
            _ => check(
                "torrserve",
                "TorrServer",
                Status::Fail,
                "не отвечает",
                Some("Перезапустите KINONYX; если не помогло — антивирус мог заблокировать torrserve.exe"),
            ),
        }
    };

    let (ts, kp, tmdb, youtube, tmdb_host, torapi_c) = tokio::join!(
        ts,
        key_check("kp_key", "Ключ Кинопоиска", "kinopoisk", kp_key, "Получите бесплатный ключ на kinopoiskapiunofficial.tech"),
        key_check("tmdb_key", "Ключ TMDB", "tmdb", tmdb_key, "Получите ключ на themoviedb.org/settings/api (нужен только для источника TMDB)"),
        reachable("youtube", "YouTube (трейлеры)", "https://www.youtube.com", "Включите VPN — либо трейлер найдётся на Rutube сам"),
        reachable("tmdb_host", "TMDB (api.themoviedb.org)", "https://api.themoviedb.org", "TMDB блокируется у ряда провайдеров — включите VPN"),
        reachable("torapi", "TorAPI (поиск раздач)", &torapi, "Проверьте адрес TorAPI в Настройках или попробуйте позже"),
    );

    let mut list = vec![ts, kp, tmdb, youtube, tmdb_host, torapi_c];
    list.push(file_check("ytdlp", "yt-dlp (трейлеры)", &["youtube-dl.exe", "youtube-dl"], "Переустановите KINONYX"));
    list.push(file_check("libmpv", "libmpv (плеер)", &["libmpv-2.dll", "libmpv-wrapper.dll"], "Переустановите KINONYX"));
    list.push(js_runtime_check());
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn empty_and_unknown_are_rejected_without_network() {
        assert_eq!(probe_key("tmdb", "  ").await.unwrap_err(), "Ключ пустой");
        assert_eq!(probe_key("imdb", "x").await.unwrap_err(), "Неизвестный источник");
    }

    #[test]
    fn missing_key_is_a_warning_with_hint() {
        let c = check("k", "K", Status::Warn, "ключ не задан", Some("h"));
        assert_eq!(c.status, Status::Warn);
        assert_eq!(c.hint.as_deref(), Some("h"));
    }
}
