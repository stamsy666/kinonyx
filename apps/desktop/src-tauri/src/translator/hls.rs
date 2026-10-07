//! The relay's own upstream for the common IPTV case: an HLS live playlist of plain MPEG-TS
//! segments (or a raw TS stream over HTTP). Segments are fetched and concatenated byte for
//! byte, so everything the broadcast does — ad breaks that swap tracks, timestamp jumps,
//! several audio tracks — reaches the players untouched, exactly as a normal player sees it.
//! (mpv's stream-record, used before, stops recording for good the moment a new stream
//! appears, which ad-inserting channels do at every break.)
//!
//! Anything else (encrypted or fMP4 HLS, finished VOD playlists, other protocols) returns
//! `Unsupported`, and the session falls back to the mpv recorder.

use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::Url;
use tokio::sync::watch;

use super::relay::Relay;

pub enum Outcome {
    Unsupported,
    Stopped,
    /// The provider stopped answering for a long time.
    Failed(String),
}

// What mpv sends, so the provider sees the same client as for normal playback.
const USER_AGENT: &str = "libmpv";
/// How far behind the live edge to start — the same as mpv/ffmpeg's HLS default.
const START_SEGMENTS_BACK: usize = 3;
const GIVE_UP_AFTER: Duration = Duration::from_secs(120);

struct Media {
    target: f64,
    sequence: u64,
    segments: Vec<Url>,
    endlist: bool,
}

fn parse_media(base: &Url, text: &str) -> Result<Media, ()> {
    let mut m = Media { target: 6.0, sequence: 0, segments: Vec::new(), endlist: false };
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Some(v) = line.strip_prefix("#EXT-X-TARGETDURATION:") {
            m.target = v.trim().parse().unwrap_or(6.0);
        } else if let Some(v) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            m.sequence = v.trim().parse().unwrap_or(0);
        } else if line.starts_with("#EXT-X-ENDLIST") {
            m.endlist = true;
        } else if line.starts_with("#EXT-X-MAP") {
            return Err(()); // fMP4
        } else if let Some(attrs) = line.strip_prefix("#EXT-X-KEY:") {
            if !attrs.contains("METHOD=NONE") {
                return Err(()); // encrypted
            }
        } else if !line.starts_with('#') {
            m.segments.push(base.join(line).map_err(|_| ())?);
        }
    }
    Ok(m)
}

/// The highest-bandwidth variant of a master playlist (mpv's default choice too).
fn pick_variant(base: &Url, text: &str) -> Option<Url> {
    let mut best: Option<(u64, Url)> = None;
    let mut bandwidth: Option<u64> = None;
    for line in text.lines().map(str::trim) {
        if let Some(attrs) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            bandwidth = attrs
                .split(',')
                .find_map(|a| a.trim().strip_prefix("BANDWIDTH="))
                .and_then(|v| v.parse().ok())
                .or(Some(0));
        } else if let (Some(bw), false) = (bandwidth, line.is_empty() || line.starts_with('#')) {
            if let Ok(u) = base.join(line) {
                if best.as_ref().map_or(true, |(b, _)| bw > *b) {
                    best = Some((bw, u));
                }
            }
            bandwidth = None;
        }
    }
    best.map(|(_, u)| u)
}

async fn fetch_text(client: &reqwest::Client, url: &Url) -> Result<(Url, String), String> {
    let r = client.get(url.clone()).timeout(Duration::from_secs(15)).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status()));
    }
    let final_url = r.url().clone();
    Ok((final_url, r.text().await.map_err(|e| e.to_string())?))
}

pub async fn run(url: String, relay: Arc<Relay>, mut stop: watch::Receiver<bool>) -> Outcome {
    let client = match reqwest::Client::builder().user_agent(USER_AGENT).connect_timeout(Duration::from_secs(15)).build() {
        Ok(c) => c,
        Err(_) => return Outcome::Unsupported,
    };
    let Ok(start) = Url::parse(&url) else { return Outcome::Unsupported };
    if !matches!(start.scheme(), "http" | "https") {
        return Outcome::Unsupported;
    }

    // Probe: a playlist, or a raw TS stream?
    let resp = match client.get(start.clone()).send().await {
        Ok(r) if r.status().is_success() => r,
        _ => return Outcome::Unsupported,
    };
    let base = resp.url().clone();
    let ctype = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    if ctype.contains("mp2t") || ctype.contains("octet-stream") && !base.path().ends_with(".m3u8") {
        return pipe_raw(resp, &relay, &mut stop).await;
    }
    let Ok(text) = resp.text().await else { return Outcome::Unsupported };
    if !text.trim_start().starts_with("#EXTM3U") {
        return Outcome::Unsupported;
    }
    let mut media_url = base.clone();
    let mut text = text;
    if text.contains("#EXT-X-STREAM-INF") {
        let Some(v) = pick_variant(&base, &text) else { return Outcome::Unsupported };
        match fetch_text(&client, &v).await {
            Ok((u, t)) => {
                media_url = u;
                text = t;
            }
            Err(_) => return Outcome::Unsupported,
        }
    }
    let Ok(first) = parse_media(&media_url, &text) else { return Outcome::Unsupported };
    if first.endlist || first.segments.is_empty() {
        return Outcome::Unsupported;
    }

    // Next media-sequence number to fetch.
    let mut next = first.sequence + first.segments.len().saturating_sub(START_SEGMENTS_BACK) as u64;
    let mut playlist = first;
    let mut last_ok = Instant::now();
    loop {
        let mut fetched_any = false;
        for (i, seg) in playlist.segments.iter().enumerate() {
            let seq = playlist.sequence + i as u64;
            if seq < next {
                continue;
            }
            match fetch_segment(&client, seg, &relay, &mut stop).await {
                Ok(true) => {}
                Ok(false) => return Outcome::Stopped,
                Err(e) => eprintln!("[translator] segment {seq}: {e}"),
            }
            next = seq + 1;
            fetched_any = true;
            last_ok = Instant::now();
        }
        let wait = if fetched_any { playlist.target / 2.0 } else { (playlist.target / 2.0).min(2.0) };
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs_f64(wait.clamp(0.5, 6.0))) => {}
            _ = stop.changed() => return Outcome::Stopped,
        }
        match fetch_text(&client, &media_url).await.map(|(_, t)| parse_media(&media_url, &t)) {
            Ok(Ok(p)) => {
                // The provider restarted its sequence numbering: resume at its live edge.
                if p.sequence + (p.segments.len() as u64) < next.saturating_sub(64) {
                    next = p.sequence + p.segments.len().saturating_sub(START_SEGMENTS_BACK) as u64;
                }
                if p.sequence + p.segments.len() as u64 > next {
                    last_ok = Instant::now();
                }
                playlist = p;
            }
            Ok(Err(())) => return Outcome::Unsupported,
            Err(e) => eprintln!("[translator] playlist: {e}"),
        }
        // A frozen playlist (seen on this provider: the same segments for minutes) is just
        // waited out, like any player would; only giving up if it never comes back.
        if last_ok.elapsed() > GIVE_UP_AFTER {
            return Outcome::Failed("провайдер перестал обновлять эфир этого канала".into());
        }
    }
}

/// Streams one segment into the relay. Ok(false) if the session is stopping.
async fn fetch_segment(client: &reqwest::Client, url: &Url, relay: &Relay, stop: &mut watch::Receiver<bool>) -> Result<bool, String> {
    let mut resp = client.get(url.clone()).timeout(Duration::from_secs(30)).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    loop {
        tokio::select! {
            c = resp.chunk() => match c.map_err(|e| e.to_string())? {
                Some(bytes) => relay.push(&bytes).await,
                None => return Ok(true),
            },
            _ = stop.changed() => return Ok(false),
        }
    }
}

async fn pipe_raw(mut resp: reqwest::Response, relay: &Relay, stop: &mut watch::Receiver<bool>) -> Outcome {
    loop {
        tokio::select! {
            c = resp.chunk() => match c {
                Ok(Some(bytes)) => relay.push(&bytes).await,
                Ok(None) => return Outcome::Failed("поток закончился".into()),
                Err(e) => return Outcome::Failed(e.to_string()),
            },
            _ = stop.changed() => return Outcome::Stopped,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_highest_bandwidth_variant() {
        let base = Url::parse("https://x.test/live/master.m3u8?t=1").unwrap();
        let m = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\nhi/index.m3u8?t=1\n";
        assert_eq!(pick_variant(&base, m).unwrap().as_str(), "https://x.test/live/hi/index.m3u8?t=1");
    }

    #[test]
    fn parses_live_media_playlist() {
        let base = Url::parse("https://11.hls.gd/ch499/mono.m3u8?token=a").unwrap();
        let p = "#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXT-X-MEDIA-SEQUENCE:1314448\n#EXTINF:8.0,\n1314448.ts\n#EXTINF:8.0,\n1314449.ts?token=a\n";
        let m = parse_media(&base, p).unwrap();
        assert_eq!(m.sequence, 1314448);
        assert_eq!(m.target, 8.0);
        assert_eq!(m.segments.len(), 2);
        assert_eq!(m.segments[1].as_str(), "https://11.hls.gd/ch499/1314449.ts?token=a");
        assert!(!m.endlist);
    }

    #[test]
    fn rejects_encrypted_and_fmp4() {
        let base = Url::parse("https://x.test/a.m3u8").unwrap();
        assert!(parse_media(&base, "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n#EXTINF:6,\na.ts\n").is_err());
        assert!(parse_media(&base, "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6,\na.m4s\n").is_err());
    }
}
