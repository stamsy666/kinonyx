//! A fresh list of public trackers for magnets. A hash from a tracker's search comes "bare" (peers only through DHT) and the
//! built-in list ages: trackers die and new ones appear. The list of `ngosang/trackerslist` ("best") is fetched at most once
//! in three days and kept on disk; without a network the last copy (or, if there is none, nothing — the page has its own
//! built-in list) is used.

use std::path::PathBuf;
use std::time::Duration;

use tauri::Manager;

use crate::http::CLIENT;

const SOURCE: &str = "https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt";
const MAX_AGE: Duration = Duration::from_secs(3 * 24 * 3600);
const KEEP: usize = 24;

/// Lines that are announce URLs, without duplicates, the first `KEEP` of them.
fn parse(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines().map(str::trim) {
        let ok = ["udp://", "http://", "https://", "wss://"].iter().any(|p| line.starts_with(p));
        if ok && !line.contains(' ') && !line.contains(".local") && !out.iter().any(|t| t == line) {
            out.push(line.to_string());
        }
        if out.len() >= KEEP {
            break;
        }
    }
    out
}

fn cache_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("trackers.txt"))
}

#[tauri::command]
pub async fn trackers_list(app: tauri::AppHandle) -> Vec<String> {
    let cache = cache_path(&app);
    let cached = cache.as_ref().and_then(|p| std::fs::read_to_string(p).ok());
    let fresh = cache
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age < MAX_AGE);
    if fresh {
        if let Some(text) = &cached {
            let list = parse(text);
            if !list.is_empty() {
                return list;
            }
        }
    }
    let fetched = async {
        let res = CLIENT.get(SOURCE).timeout(Duration::from_secs(10)).send().await.ok()?.error_for_status().ok()?;
        res.text().await.ok()
    }
    .await;
    if let Some(text) = fetched {
        let list = parse(&text);
        if list.len() >= 3 {
            if let Some(p) = &cache {
                if let Some(parent) = p.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(p, &text);
            }
            crate::elog!("[trackers] list refreshed: {} trackers", list.len());
            return list;
        }
    }
    cached.map(|t| parse(&t)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn keeps_announce_urls_only() {
        let text = "udp://a.example:1337/announce\n\nnot a tracker\nhttp://b.example/announce\nudp://a.example:1337/announce\nhttp://retracker.local/announce\n";
        assert_eq!(parse(text), vec!["udp://a.example:1337/announce", "http://b.example/announce"]);
    }
}
