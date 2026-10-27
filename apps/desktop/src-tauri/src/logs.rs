//! The app's log: one text file in `%USERPROFILE%\.kinonyx\logs` (not AppData — easy to find, and the same
//! place the translator keeps its files), `kinonyx.log`, rotated at 2 MB (`kinonyx.1.log` … `kinonyx.3.log`).
//! Everything that used to go to stderr (`eprintln!`) goes here through `elog!` as well, the page writes its
//! errors with `log_write`, and a panic leaves its message and location here before the process dies.
//! Secrets never get written: `api_key=…`, `token=…`, `key=…` in anything that reaches the log are masked.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_BYTES: u64 = 2_000_000;
const KEEP: usize = 3;

struct Sink {
    dir: PathBuf,
    file: File,
    written: u64,
}

static SINK: Mutex<Option<Sink>> = Mutex::new(None);

pub fn dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    home.join(".kinonyx").join("logs")
}

fn open(dir: &PathBuf) -> Option<(File, u64)> {
    fs::create_dir_all(dir).ok()?;
    let path = dir.join("kinonyx.log");
    let written = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let file = OpenOptions::new().create(true).append(true).open(path).ok()?;
    Some((file, written))
}

fn rotate(dir: &PathBuf) {
    let name = |n: usize| if n == 0 { dir.join("kinonyx.log") } else { dir.join(format!("kinonyx.{n}.log")) };
    let _ = fs::remove_file(name(KEEP));
    for n in (0..KEEP).rev() {
        let _ = fs::rename(name(n), name(n + 1));
    }
}

/// Starts the log (once, at launch) and hooks panics.
pub fn init() {
    let dir = dir();
    if let Some((file, written)) = open(&dir) {
        *SINK.lock().unwrap() = Some(Sink { dir, file, written });
    }
    write("INFO", "app", &format!("KINONYX {} starting, {} {}", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH));
    std::panic::set_hook(Box::new(|info| {
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".into());
        write("PANIC", "rust", &format!("{msg} at {place}"));
    }));
}

/// Masks the value after `key=`-like markers so a request URL in an error text can't leak a key.
fn mask(text: &str) -> String {
    let mut out = text.to_string();
    for marker in ["api_key=", "apikey=", "token=", "key="] {
        let mut from = 0;
        while let Some(i) = out[from..].find(marker) {
            let start = from + i + marker.len();
            let end = out[start..].find(|c: char| matches!(c, '&' | ')' | '"' | '\'' | ' ' | '\n' | '>')).map(|e| start + e).unwrap_or(out.len());
            if end > start {
                out.replace_range(start..end, "***");
            }
            from = start;
        }
    }
    out
}

pub fn write(level: &str, scope: &str, message: &str) {
    let line = format!("{} [{level}] {scope}: {}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"), mask(message).trim_end());
    if let Ok(mut guard) = SINK.lock() {
        if let Some(sink) = guard.as_mut() {
            if sink.written + line.len() as u64 > MAX_BYTES {
                let dir = sink.dir.clone();
                // Close the file before renaming it (Windows won't rename an open one).
                drop(guard.take());
                rotate(&dir);
                if let Some((file, written)) = open(&dir) {
                    *guard = Some(Sink { dir, file, written });
                }
            }
            if let Some(sink) = guard.as_mut() {
                if sink.file.write_all(line.as_bytes()).is_ok() {
                    sink.written += line.len() as u64;
                }
            }
        }
    }
}

/// `eprintln!` that also writes to the log file.
#[macro_export]
macro_rules! elog {
    ($($arg:tt)*) => {{
        let text = format!($($arg)*);
        eprintln!("{text}");
        $crate::logs::write("INFO", "rust", &text);
    }};
}

/// For the page: errors, warnings and notable events.
#[tauri::command]
pub fn log_write(level: String, scope: String, message: String) {
    let level = match level.as_str() {
        "error" => "ERROR",
        "warn" => "WARN",
        _ => "INFO",
    };
    write(level, &scope.chars().take(40).collect::<String>(), &message.chars().take(4000).collect::<String>());
}

#[tauri::command]
pub fn log_dir() -> String {
    dir().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn log_open_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = dir();
    let _ = fs::create_dir_all(&dir);
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// The last `lines` lines (default 200), newest last, for «Копировать журнал».
#[tauri::command]
pub fn log_tail(lines: Option<usize>) -> String {
    let want = lines.unwrap_or(200).clamp(1, 2000);
    let dir = dir();
    let mut text = fs::read_to_string(dir.join("kinonyx.log")).unwrap_or_default();
    if text.lines().count() < want {
        if let Ok(older) = fs::read_to_string(dir.join("kinonyx.1.log")) {
            text = older + &text;
        }
    }
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(want)..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::mask;

    #[test]
    fn keys_are_masked() {
        assert_eq!(mask("error sending request for url (https://x/y?api_key=SECRET&language=ru)"), "error sending request for url (https://x/y?api_key=***&language=ru)");
        assert_eq!(mask("GET /a?token=abc123 failed"), "GET /a?token=*** failed");
        assert_eq!(mask("nothing here"), "nothing here");
    }
}
