//! XMLTV download + parse on the Rust side.
//!
//! Real-world guides are huge (the user's provider serves ~215 MB / 420k
//! programmes uncompressed). Pulling that through the webview — IPC transfer
//! of the raw body, a UTF-16 JS string twice that size, a structured-clone
//! copy into a worker, and 420k objects cloned back out — took the best part
//! of a minute. Here it's one gzip'd download, one streaming pass, and a
//! compact columnar payload with only the fields the UI ever reads.

use chrono::{LocalResult, TimeZone};
use quick_xml::escape::{resolve_predefined_entity, unescape};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize, Deserialize)]
pub struct EpgChannelOut {
    pub id: String,
    pub names: Vec<String>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct EpgProgrammesOut {
    pub start: Vec<f64>,
    pub stop: Vec<f64>,
    pub title: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct EpgPayload {
    pub channels: Vec<EpgChannelOut>,
    pub programmes: HashMap<String, EpgProgrammesOut>,
}

/// Disk cache so a guide already fetched today survives an app restart — without it,
/// the in-memory reuse in `loadPlaylistData` (store/tv.ts) only ever helped within the
/// same running session, and "Обновление программы передач: раз в день" still refetched
/// (215 MB provider, ~10 s) every single launch, which is what got reported.
#[tauri::command]
pub async fn fetch_epg(
    app: tauri::AppHandle,
    url: String,
    min_stop_ms: f64,
    max_start_ms: f64,
    max_age_ms: Option<f64>,
) -> Result<EpgPayload, String> {
    let cache_file = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join("epg").join(cache_key(&url)));

    if let Some(file) = cache_file.clone() {
        if max_age_ms.is_some_and(|max_age| max_age > 0.0) {
            if let Some(payload) = read_cache_if_fresh(file, max_age_ms.unwrap()).await {
                return Ok(payload);
            }
        }
    }

    let bytes = crate::http::CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let payload = tauri::async_runtime::spawn_blocking(move || {
        let text = String::from_utf8_lossy(&bytes);
        parse_xmltv(&text, min_stop_ms, max_start_ms)
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(file) = cache_file {
        write_cache(file, &payload).await;
    }

    Ok(payload)
}

async fn read_cache_if_fresh(file: PathBuf, max_age_ms: f64) -> Option<EpgPayload> {
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&file).ok()?;
        let age_ms = meta.modified().ok()?.elapsed().ok()?.as_millis() as f64;
        if age_ms >= max_age_ms {
            return None;
        }
        let bytes = std::fs::read(&file).ok()?;
        serde_json::from_slice(&bytes).ok()
    })
    .await
    .ok()
    .flatten()
}

async fn write_cache(file: PathBuf, payload: &EpgPayload) {
    // Best-effort: a failed cache write only means the next launch fetches again.
    let Ok(json) = serde_json::to_vec(payload) else { return };
    let _ = tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let tmp = file.with_extension("part");
        if std::fs::write(&tmp, &json).is_ok() {
            let _ = std::fs::rename(&tmp, &file);
        }
    })
    .await;
}

fn cache_key(url: &str) -> String {
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    format!("{:016x}.json", h.finish())
}

#[derive(PartialEq)]
enum TextTarget {
    None,
    DisplayName,
    Title,
}

struct ProgrammeInProgress {
    channel: String,
    start: f64,
    stop: f64,
    title: String,
    have_title: bool,
}

fn parse_xmltv(xml: &str, min_stop_ms: f64, max_start_ms: f64) -> Result<EpgPayload, String> {
    let mut reader = Reader::from_str(xml);
    let mut channels: Vec<EpgChannelOut> = Vec::new();
    let mut programmes: HashMap<String, EpgProgrammesOut> = HashMap::new();

    let mut cur_channel: Option<EpgChannelOut> = None;
    let mut cur_prog: Option<ProgrammeInProgress> = None;
    let mut target = TextTarget::None;
    let mut text_buf = String::new();

    loop {
        let event = reader.read_event().map_err(|e| e.to_string())?;
        match event {
            Event::Start(e) => match e.local_name().as_ref() {
                "channel" => {
                    let id = attr(&e, "id").unwrap_or_default();
                    cur_channel = Some(EpgChannelOut { id, names: Vec::new() });
                }
                "display-name" if cur_channel.is_some() => {
                    target = TextTarget::DisplayName;
                    text_buf.clear();
                }
                "programme" => {
                    let channel = attr(&e, "channel").unwrap_or_default();
                    let start = attr(&e, "start").map(|s| parse_xmltv_date(&s)).unwrap_or(f64::NAN);
                    let stop = attr(&e, "stop").map(|s| parse_xmltv_date(&s)).unwrap_or(f64::NAN);
                    cur_prog = Some(ProgrammeInProgress {
                        channel,
                        start,
                        stop,
                        title: String::new(),
                        have_title: false,
                    });
                }
                "title" => {
                    if let Some(p) = &cur_prog {
                        // Only the first <title> (there may be one per language), like the JS parser.
                        if !p.have_title {
                            target = TextTarget::Title;
                            text_buf.clear();
                        }
                    }
                }
                _ => {}
            },
            Event::Text(t) => {
                if target != TextTarget::None {
                    let raw = t.into_inner();
                    match unescape(&raw) {
                        Ok(s) => text_buf.push_str(&s),
                        Err(_) => text_buf.push_str(&raw),
                    }
                }
            }
            // Entity/char references (`&amp;`, `&#x41;`) arrive as their own events, split out
            // of the surrounding text.
            Event::GeneralRef(r) => {
                if target != TextTarget::None {
                    if let Ok(Some(ch)) = r.resolve_char_ref() {
                        text_buf.push(ch);
                    } else {
                        let name = r.into_inner();
                        match resolve_predefined_entity(&name) {
                            Some(s) => text_buf.push_str(s),
                            None => {
                                text_buf.push('&');
                                text_buf.push_str(&name);
                                text_buf.push(';');
                            }
                        }
                    }
                }
            }
            Event::CData(c) => {
                if target != TextTarget::None {
                    text_buf.push_str(&c.into_inner());
                }
            }
            Event::End(e) => match e.local_name().as_ref() {
                "display-name" => {
                    if target == TextTarget::DisplayName {
                        if let Some(ch) = &mut cur_channel {
                            let name = text_buf.trim();
                            if !name.is_empty() {
                                ch.names.push(name.to_string());
                            }
                        }
                        target = TextTarget::None;
                    }
                }
                "title" => {
                    if target == TextTarget::Title {
                        if let Some(p) = &mut cur_prog {
                            p.title = text_buf.trim().to_string();
                            p.have_title = true;
                        }
                        target = TextTarget::None;
                    }
                }
                "channel" => {
                    if let Some(ch) = cur_channel.take() {
                        if !ch.id.is_empty() {
                            channels.push(ch);
                        }
                    }
                }
                "programme" => {
                    if let Some(p) = cur_prog.take() {
                        let valid = !p.channel.is_empty() && !p.start.is_nan() && !p.stop.is_nan();
                        // Window filter: nothing older than the catch-up horizon, nothing far in
                        // the future — most of what a 7-day-both-ways guide contains is neither.
                        if valid && p.stop >= min_stop_ms && p.start <= max_start_ms {
                            let entry = programmes.entry(p.channel).or_default();
                            entry.start.push(p.start);
                            entry.stop.push(p.stop);
                            entry.title.push(p.title);
                        }
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }

    // Guides are usually already ordered, but the UI's binary search relies on it.
    for list in programmes.values_mut() {
        let n = list.start.len();
        let mut order: Vec<usize> = (0..n).collect();
        if order.windows(2).any(|w| list.start[w[0]] > list.start[w[1]]) {
            order.sort_by(|&a, &b| list.start[a].partial_cmp(&list.start[b]).unwrap_or(std::cmp::Ordering::Equal));
            let start = order.iter().map(|&i| list.start[i]).collect();
            let stop = order.iter().map(|&i| list.stop[i]).collect();
            let title = order.iter().map(|&i| std::mem::take(&mut list.title[i])).collect();
            list.start = start;
            list.stop = stop;
            list.title = title;
        }
    }

    Ok(EpgPayload { channels, programmes })
}

fn attr(e: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == key)
        .and_then(|a| a.normalized_value(quick_xml::XmlVersion::Explicit1_0).ok().map(|v| v.into_owned()))
}

/// XMLTV timestamps: `YYYYMMDDhhmmss ±HHMM`, with hh/mm/ss and the offset all optional.
/// A missing offset means local time, per the XMLTV DTD — same as the JS parser.
fn parse_xmltv_date(s: &str) -> f64 {
    let s = s.trim();
    let bytes = s.as_bytes();
    let digits_end = bytes.iter().position(|b| !b.is_ascii_digit()).unwrap_or(bytes.len());
    if digits_end < 8 {
        return f64::NAN;
    }
    let num = |from: usize, len: usize| -> u32 {
        if from + len <= digits_end {
            s[from..from + len].parse().unwrap_or(0)
        } else {
            0
        }
    };
    let y = num(0, 4) as i32;
    let mo = num(4, 2);
    let d = num(6, 2);
    let h = num(8, 2);
    let mi = num(10, 2);
    let sec = num(12, 2);

    let rest = s[digits_end..].trim();
    if let Some(sign) = rest.chars().next().filter(|c| *c == '+' || *c == '-') {
        let off = &rest[1..];
        if off.len() >= 4 {
            let oh: i64 = off[0..2].parse().unwrap_or(0);
            let om: i64 = off[2..4].parse().unwrap_or(0);
            let offset_min = (oh * 60 + om) * if sign == '-' { -1 } else { 1 };
            return match chrono::Utc.with_ymd_and_hms(y, mo, d, h, mi, sec) {
                LocalResult::Single(t) => (t.timestamp_millis() - offset_min * 60_000) as f64,
                _ => f64::NAN,
            };
        }
    }
    match chrono::Local.with_ymd_and_hms(y, mo, d, h, mi, sec) {
        LocalResult::Single(t) | LocalResult::Ambiguous(t, _) => t.timestamp_millis() as f64,
        LocalResult::None => f64::NAN,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dates_with_and_without_offset() {
        // 2026-09-21 20:30:00 +0300 == 17:30:00 UTC
        let ms = parse_xmltv_date("20260921203000 +0300");
        assert_eq!(ms, 1_790_011_800_000.0);
        assert!(parse_xmltv_date("garbage").is_nan());
        assert!(parse_xmltv_date("2026").is_nan());
    }

    #[test]
    fn parses_channels_and_programmes() {
        let xml = r#"<?xml version="1.0"?><tv>
<channel id="c1"><display-name>One HD</display-name><display-name lang="ru">Первый</display-name><icon src="x"/></channel>
<programme start="20260921200000 +0300" stop="20260921210000 +0300" channel="c1"><title lang="ru">A &amp; B</title><title lang="en">ignored</title><desc>d</desc></programme>
<programme start="20260921190000 +0300" stop="20260921200000 +0300" channel="c1"><title><![CDATA[Earlier]]></title></programme>
<programme start="20200101000000 +0300" stop="20200101010000 +0300" channel="c1"><title>Too old</title></programme>
</tv>"#;
        let out = parse_xmltv(xml, 1_700_000_000_000.0, 1_900_000_000_000.0).unwrap();
        assert_eq!(out.channels.len(), 1);
        assert_eq!(out.channels[0].names, vec!["One HD", "Первый"]);
        let p = &out.programmes["c1"];
        assert_eq!(p.title, vec!["Earlier", "A & B"]);
        assert!(p.start[0] < p.start[1]);
    }

    #[test]
    #[ignore]
    fn benchmark_real_guide() {
        let path = "C:/tmp/epg.xml";
        let Ok(bytes) = std::fs::read(path) else { return };
        let t0 = std::time::Instant::now();
        let text = String::from_utf8_lossy(&bytes);
        let out = parse_xmltv(&text, 0.0, f64::MAX).unwrap();
        let n: usize = out.programmes.values().map(|p| p.start.len()).sum();
        eprintln!("parsed {} channels / {} programmes in {:?}", out.channels.len(), n, t0.elapsed());
        let json = serde_json::to_string(&out).unwrap();
        eprintln!("json payload: {} MB", json.len() / 1_000_000);
    }
}
