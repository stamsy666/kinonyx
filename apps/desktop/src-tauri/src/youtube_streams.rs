//! Fast HLS playback adapted from Stream Tube Desktop (MIT), src/api/streams.rs.
//! See stream-tube-LICENSE.txt. YouTube's master playlist carries the audio renditions.

use super::{CLIENT, HOST};
use crate::ytdlp::{is_russian_language, ResolvedTrailer, TrailerQuality, DEFAULT_MAX_HEIGHT};
use reqwest::Url;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};

type Entry = Arc<Mutex<Option<(ResolvedTrailer, Instant)>>>;
static CACHE: std::sync::LazyLock<Mutex<HashMap<String, Entry>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
static RESOLVERS: Semaphore = Semaphore::const_new(3);
static VISITOR: Mutex<Option<String>> = Mutex::const_new(None);

pub(super) async fn clear() {
    CACHE.lock().await.clear();
}

pub(super) async fn resolve<F>(
    id: &str,
    fallback: impl FnOnce() -> F,
) -> Result<ResolvedTrailer, String>
where
    F: std::future::Future<Output = Result<ResolvedTrailer, String>>,
{
    let entry = {
        let mut entries = CACHE.lock().await;
        if entries.len() >= 36 && !entries.contains_key(id) {
            let oldest_idle = entries
                .iter()
                .filter_map(|(key, entry)| {
                    let guard = entry.try_lock().ok()?;
                    let timestamp = guard.as_ref().map(|(_, at)| *at);
                    Some((key.clone(), timestamp))
                })
                .min_by_key(|(_, at)| *at)
                .map(|(key, _)| key);
            if let Some(key) = oldest_idle {
                entries.remove(&key);
            }
        }
        entries.entry(id.into()).or_default().clone()
    };
    let mut cached = entry.lock().await;
    if let Some((ready, time)) = &*cached {
        let ttl = if ready.is_live {
            Duration::from_secs(12)
        } else {
            Duration::from_secs(600)
        };
        if time.elapsed() < ttl {
            return Ok(ready.clone());
        }
    }
    let _permit = RESOLVERS.acquire().await.map_err(|_| "Плеер недоступен.")?;
    let fast = fast_stream(id);
    let slow = async {
        tokio::time::sleep(Duration::from_millis(280)).await;
        fallback().await
    };
    tokio::pin!(fast);
    tokio::pin!(slow);
    let result = tokio::select! {
        fast_result = &mut fast => match fast_result {
            Some(ready) => Ok(ready),
            None => slow.await,
        },
        slow_result = &mut slow => match slow_result {
            Ok(ready) => Ok(ready),
            Err(error) => fast.await.ok_or(error),
        }
    }?;
    *cached = Some((result.clone(), Instant::now()));
    Ok(result)
}

struct ClientProfile {
    id: &'static str,
    name: &'static str,
    version: &'static str,
    ua: &'static str,
    model: &'static str,
    os: &'static str,
    os_version: &'static str,
}

const VISION: ClientProfile = ClientProfile {
    id: "101", name: "VISIONOS", version: "1.02",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    model: "RealityDevice17,1", os: "visionOS", os_version: "26.5.23O471",
};
const IOS: ClientProfile = ClientProfile {
    id: "5",
    name: "IOS",
    version: "20.10.4",
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    model: "iPhone16,2",
    os: "iOS",
    os_version: "18.3.2.22D82",
};

async fn visitor() -> Option<String> {
    let mut cached = VISITOR.lock().await;
    if cached.is_some() {
        return cached.clone();
    }
    let data: Value = CLIENT.post(format!("{HOST}/youtubei/v1/visitor_id?prettyPrint=false"))
        .timeout(Duration::from_secs(2))
        .json(&json!({ "context": { "client": { "clientName": "WEB", "clientVersion": "2.20251120.01.00", "hl": "ru" } } }))
        .send().await.ok()?.error_for_status().ok()?.json().await.ok()?;
    *cached = data
        .pointer("/responseContext/visitorData")
        .and_then(Value::as_str)
        .map(str::to_owned);
    cached.clone()
}

async fn fast_stream(id: &str) -> Option<ResolvedTrailer> {
    tokio::time::timeout(Duration::from_secs(5), async {
        let vision = async { hls_player(id, &VISION, visitor().await.as_deref()).await };
        let ios = hls_player(id, &IOS, None);
        tokio::pin!(vision);
        tokio::pin!(ios);
        tokio::select! {
            ready = &mut vision => match ready { Some(info) => Some(info), None => ios.await },
            ready = &mut ios => match ready { Some(info) => Some(info), None => vision.await },
        }
    })
    .await
    .ok()
    .flatten()
}

async fn hls_player(
    id: &str,
    profile: &ClientProfile,
    visitor: Option<&str>,
) -> Option<ResolvedTrailer> {
    let mut client = json!({
        "clientName": profile.name, "clientVersion": profile.version, "deviceMake": "Apple",
        "deviceModel": profile.model, "osName": profile.os, "osVersion": profile.os_version,
        "userAgent": profile.ua, "hl": "ru",
    });
    let mut request = CLIENT
        .post(format!("{HOST}/youtubei/v1/player?prettyPrint=false"))
        .header("User-Agent", profile.ua)
        .header("X-YouTube-Client-Name", profile.id)
        .header("X-YouTube-Client-Version", profile.version)
        .header("Origin", HOST);
    if let Some(visitor) = visitor {
        client["visitorData"] = json!(visitor);
        request = request.header("X-Goog-Visitor-Id", visitor);
    }
    let data: Value = request
        .json(&json!({"videoId": id, "context": {"client": client}}))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    if data
        .pointer("/playabilityStatus/status")
        .and_then(Value::as_str)
        != Some("OK")
    {
        return None;
    }
    let manifest = data.pointer("/streamingData/hlsManifestUrl")?.as_str()?;
    let qualities = load_master(manifest, Some(profile.ua)).await?;
    let details = &data["videoDetails"];
    let read = |key: &str| {
        details[key]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    Some(ResolvedTrailer {
        default_index: qualities
            .iter()
            .rposition(|q| q.height <= DEFAULT_MAX_HEIGHT)
            .unwrap_or(0),
        qualities,
        title: read("title"),
        channel: read("author"),
        channel_id: read("channelId"),
        is_live: details["isLive"].as_bool().unwrap_or(false),
    })
}

pub(crate) async fn load_master(
    manifest: &str,
    user_agent: Option<&str>,
) -> Option<Vec<TrailerQuality>> {
    let url = Url::parse(manifest).ok()?;
    if !is_media_url(&url) {
        return None;
    }
    let response = CLIENT
        .get(url)
        .timeout(Duration::from_secs(5))
        .header("User-Agent", user_agent.unwrap_or("Mozilla/5.0"))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let base = response.url().clone();
    if !is_media_url(&base) {
        return None;
    }
    let master = response.text().await.ok()?;
    let qualities = manifest_qualities(&base, &master);
    if qualities.is_empty() {
        return None;
    }
    // YouTube can return a playable video and a 404 for its separate audio.
    // FFmpeg plays that video silently, so reject the master before caching it.
    let mut probes = tokio::task::JoinSet::new();
    for url in preferred_audio_playlists(&base, &master)? {
        let request = CLIENT
            .get(url)
            .timeout(Duration::from_secs(2))
            .header("User-Agent", user_agent.unwrap_or("Mozilla/5.0"));
        probes.spawn(async move { request.send().await.is_ok_and(|r| r.status().is_success()) });
    }
    while let Some(probe) = probes.join_next().await {
        if !matches!(probe, Ok(true)) {
            return None;
        }
    }
    Some(qualities)
}

fn is_media_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| host.ends_with(".googlevideo.com"))
}

fn hls_attr<'a>(line: &'a str, name: &str) -> Option<&'a str> {
    let (_, attrs) = line.split_once(':')?;
    let mut quoted = false;
    attrs.split(|c| {
        if c == '"' {
            quoted = !quoted;
        }
        c == ',' && !quoted
    })
    .filter_map(|entry| entry.trim().split_once('='))
    .find_map(|(key, value)| (key == name).then_some(value))
}

fn preferred_audio_playlists(base: &Url, master: &str) -> Option<HashSet<Url>> {
    let lines = || master.lines().map(str::trim);
    let groups: HashSet<_> = lines()
        .filter(|line| line.starts_with("#EXT-X-STREAM-INF:"))
        .filter_map(|line| hls_attr(line, "AUDIO"))
        .collect();
    let audio: Vec<_> = lines()
        .filter(|line| line.starts_with("#EXT-X-MEDIA:") && hls_attr(line, "TYPE") == Some("AUDIO"))
        .collect();
    let mut urls = HashSet::new();
    for group in groups {
        let in_group = || audio.iter().copied().filter(|line| hls_attr(line, "GROUP-ID") == Some(group));
        let selected = in_group().min_by_key(|line| (
            !hls_attr(line, "LANGUAGE").is_some_and(is_russian_language),
            hls_attr(line, "DEFAULT") != Some("YES"),
            hls_attr(line, "AUTOSELECT") != Some("YES"),
        ))?;
        if let Some(uri) = hls_attr(selected, "URI") {
            let url = base.join(uri.trim_matches('"')).ok().filter(is_media_url)?;
            urls.insert(url);
        }
    }
    Some(urls)
}

#[derive(Clone, Copy)]
struct Variant<'a> {
    info: &'a str,
    uri: Option<&'a str>,
    bitrate: u64,
}

// Like Stream Tube, give FFmpeg a master with only the chosen variant. FFmpeg
// opens all child playlists before mpv can apply hls-bitrate to a full master.
fn manifest_qualities(base: &Url, master: &str) -> Vec<TrailerQuality> {
    let mut variants: BTreeMap<u32, Variant<'_>> = BTreeMap::new();
    let mut media = Vec::new();
    let mut header = String::from("memory://#EXTM3U\n");
    let mut can_filter = true;
    let mut lines = master.lines().map(str::trim).peekable();
    while let Some(line) = lines.next() {
        if line.starts_with("#EXT-X-MEDIA:") {
            media.push(line);
        }
        if ["#EXT-X-SESSION-KEY:", "#EXT-X-DEFINE:", "#EXT-X-CONTENT-STEERING:"]
            .iter()
            .any(|tag| line.starts_with(tag))
        {
            can_filter = false;
        }
        if line == "#EXT-X-INDEPENDENT-SEGMENTS"
            || line.starts_with("#EXT-X-VERSION:")
            || line.starts_with("#EXT-X-START:")
        {
            header.push_str(line);
            header.push('\n');
        }
        if !line.starts_with("#EXT-X-STREAM-INF:") {
            continue;
        }
        let uri = lines.next_if(|line| !line.is_empty() && !line.starts_with('#'));
        let Some(height) = hls_attr(line, "RESOLUTION")
            .and_then(|value| value.split_once('x'))
            .and_then(|(_, height)| height.parse::<u32>().ok())
            .filter(|&height| height > 0)
        else {
            continue;
        };
        let Some(bitrate) = hls_attr(line, "BANDWIDTH")
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|&bitrate| bitrate > 0)
        else {
            continue;
        };
        let variant = Variant { info: line, uri, bitrate };
        let chosen = variants.entry(height).or_insert(variant);
        if bitrate > chosen.bitrate {
            *chosen = variant;
        }
    }
    variants
        .into_iter()
        .map(|(height, variant)| TrailerQuality {
            height,
            url: can_filter
                .then(|| single_variant(base, &header, &media, &variant))
                .flatten()
                .unwrap_or_else(|| base.to_string()),
            audio_url: None,
            hls_bitrate: Some(variant.bitrate),
        })
        .collect()
}

fn single_variant(base: &Url, header: &str, media: &[&str], variant: &Variant<'_>) -> Option<String> {
    let resolve = |uri| base.join(uri).ok().filter(is_media_url);
    let video = resolve(variant.uri?)?;
    let mut playlist = header.to_owned();
    for line in media {
        let Some(kind @ ("AUDIO" | "VIDEO" | "SUBTITLES" | "CLOSED-CAPTIONS")) = hls_attr(line, "TYPE") else {
            continue;
        };
        let Some(group) = hls_attr(variant.info, kind) else {
            continue;
        };
        if hls_attr(line, "GROUP-ID") != Some(group) {
            continue;
        }
        if let Some(uri) = hls_attr(line, "URI") {
            let absolute = resolve(uri.trim_matches('"'))?;
            playlist.push_str(&line.replacen(
                &format!("URI={uri}"),
                &format!("URI=\"{absolute}\""),
                1,
            ));
        } else {
            playlist.push_str(line);
        }
        playlist.push('\n');
    }
    playlist.push_str(variant.info);
    playlist.push('\n');
    playlist.push_str(video.as_str());
    playlist.push('\n');
    Some(playlist)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probes_russian_audio_first_then_default_audio() {
        let base = Url::parse("https://manifest.googlevideo.com/hls/master.m3u8").unwrap();
        let master = r#"#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="main",NAME="Dub",URI="dub.m3u8",AUTOSELECT=YES
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="main",NAME="Original",URI="original.m3u8",DEFAULT=YES
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="main",NAME="Russian dub",LANGUAGE="ru",URI="dub-ru.m3u8",DEFAULT=NO
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="secondary",NAME="Russian",URI="russian.m3u8",DEFAULT=NO,AUTOSELECT=YES
#EXT-X-STREAM-INF:BANDWIDTH=1200,RESOLUTION=1280x720,AUDIO="main"
720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3600,RESOLUTION=1920x1080,AUDIO="secondary"
1080.m3u8
"#;
        assert_eq!(preferred_audio_playlists(&base, master), Some(HashSet::from([
            base.join("dub-ru.m3u8").unwrap(), base.join("russian.m3u8").unwrap(),
        ])));
        assert!(preferred_audio_playlists(&base, &master.replace("LANGUAGE=\"ru\"", "LANGUAGE=\"de\""))
            .unwrap().contains(&base.join("original.m3u8").unwrap()));
        assert!(preferred_audio_playlists(&base, &master.replace("TYPE=AUDIO,GROUP-ID=\"secondary\"", "TYPE=VIDEO,GROUP-ID=\"secondary\"")).is_none());
    }

    #[test]
    fn builds_one_hls_variant_per_quality_with_its_renditions() {
        let base = Url::parse("https://manifest.googlevideo.com/hls/master.m3u8").unwrap();
        let master = r#"#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="main",NAME="Original, stereo",URI="audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="main",NAME="Dub",URI="dub.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="other",NAME="Other",URI="other.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1200,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1280x720,AUDIO="main"
720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000,RESOLUTION=1920x1080,AUDIO="other"
1080-low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3600,RESOLUTION=1920x1080,AUDIO="other"
1080.m3u8
"#;
        let qualities = manifest_qualities(&base, master);
        assert_eq!(
            qualities
                .iter()
                .map(|item| item.hls_bitrate)
                .collect::<Vec<_>>(),
            [Some(1200), Some(3600)]
        );
        assert_eq!(qualities[1].height, 1080);
        let low = &qualities[0].url;
        assert!(low.starts_with("memory://#EXTM3U\n#EXT-X-VERSION:6"));
        assert_eq!(low.matches("#EXT-X-STREAM-INF:").count(), 1);
        for file in ["720.m3u8", "audio.m3u8", "dub.m3u8"] {
            assert!(low.contains(base.join(file).unwrap().as_str()));
        }
        assert!(!low.contains("1080"));
        assert!(!low.contains("other.m3u8"));
        assert!(qualities[1].url.contains("/1080.m3u8"));
        assert!(!qualities[1].url.contains("1080-low.m3u8"));
    }

    #[test]
    fn keeps_the_original_master_if_it_cannot_be_filtered() {
        let base = Url::parse("https://manifest.googlevideo.com/master.m3u8").unwrap();
        let master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200,RESOLUTION=1280x720\nhttps://example.invalid/720.m3u8";
        let qualities = manifest_qualities(&base, master);
        assert_eq!(qualities[0].url, base.as_str());
        assert_eq!(qualities[0].hls_bitrate, Some(1200));
    }
}
