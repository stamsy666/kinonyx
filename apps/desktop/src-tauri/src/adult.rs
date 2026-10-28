//! "Клубничка" (18+) section of the Categories page: the public video lists of porno365 (the mirror
//! `4porno365.fun`, which `porno365.plus` redirects to), read from the site's own HTML pages — it has no API.
//! Its pages carry plain mp4 files (every quality up to 1080p) in the player's source list, so a picked video
//! needs nothing but one page request; no extractor and no special headers.
//!
//! The pages are UTF-8 (a page that is not is read as Windows-1251). The site pages with a "show more" link and
//! gives no page count, so `total_pages` is "the page asked for, plus one when there is a next".

use crate::http::CLIENT;
use crate::ytdlp::TrailerQuality;
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;
use std::time::Duration;

/// The mirror the lists and videos are read from (plain http: the site does not answer https).
const BASE: &str = "http://4porno365.fun";
const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdultVideo {
    /// The number in the video page's address (`/movie/51046`).
    pub key: String,
    pub title: String,
    pub thumb: String,
    pub duration: String,
    pub views: String,
}

/// One page of a list, and how many pages are known to exist (the one asked for, plus one when there is a next).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdultPage {
    pub videos: Vec<AdultVideo>,
    pub total_pages: u32,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdultCategory {
    /// The category's address part: `mamki` (`/mamki`, `/mamki/2`).
    pub slug: String,
    pub name: String,
    pub image: String,
}

/// A model (actress) of the site.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdultPerformer {
    /// The address of her page without the host: `models/eva-elfie` — what `adult_list` takes.
    pub path: String,
    pub name: String,
    /// The same name in latin letters ("Riley Reid"), as the site prints it under the Russian one.
    pub alt_name: String,
    pub image: String,
    /// How many videos she has, as the site prints it (empty when it does not).
    pub videos: String,
}

/// One page of the site's list of models, and whether there is a next.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdultModels {
    pub models: Vec<AdultPerformer>,
    pub has_next: bool,
}

static RE_MOVIE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"/movie/(\d+)"#).unwrap());
static RE_THUMB: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<img src="([^"]+)""#).unwrap());
static RE_TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<p>([^<]*)</p>").unwrap());
static RE_DURATION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<span class="duration">([^<]*)</span>"#).unwrap());
static RE_VIEWS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<span class="video_views">([^<]*)</span>"#).unwrap());
static RE_H1: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<h1>([^<]*)</h1>").unwrap());
static RE_CATEGORY: LazyLock<Regex> = LazyLock::new(|| {
    // The address part may be in Russian letters too (`/жесткое`).
    Regex::new(r#"(?s)<a href="/([^"/]+)" title="([^"]+)" class="categories-link"[^>]*>\s*<div class="categories-image">\s*<img src="([^"]+)""#).unwrap()
});
static RE_MODEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?s)<div class="item_model"><a href="(?:http://4porno365\.fun)?/(models/[^"]+)">(?:<span class="flag[^"]*"></span>)?<img[^>]*?src="([^"]+)"[^>]*><span class="cnt_span">(\d+)</span><span class="model_name"><span class="model_rus_name">([^<]*)</span><span class="model_eng_name">([^<]*)</span>"#,
    )
    .unwrap()
});
static RE_SOURCE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"file:\s*"([^"]+)",\s*label:\s*"(\d+)p"#).unwrap());

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .to_string()
}

/// Every video of a list page, in page order (a video that appears twice is listed once).
fn parse_list(html: &str) -> Vec<AdultVideo> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for chunk in html.split("<li id=\"").skip(1) {
        let item = chunk.split("</li>").next().unwrap_or(chunk);
        if !item.contains("video_block") {
            continue;
        }
        let Some(key) = RE_MOVIE.captures(item).map(|c| c[1].to_string()) else { continue };
        let Some(thumb) = RE_THUMB.captures(item).map(|c| unescape(&c[1])) else { continue };
        let title = RE_TITLE.captures(item).map(|c| unescape(&c[1])).unwrap_or_default();
        if title.is_empty() || !seen.insert(key.clone()) {
            continue;
        }
        let duration = RE_DURATION.captures(item).map(|c| c[1].trim().to_string()).unwrap_or_default();
        let views = RE_VIEWS.captures(item).map(|c| c[1].trim().to_string()).unwrap_or_default();
        out.push(AdultVideo { key, title, thumb, duration, views });
    }
    out
}

/// A "show more" link: there is a page after this one.
fn has_next(html: &str) -> bool {
    html.contains("class=\"next_link\"")
}

/// The categories of the site's "all categories" page. "premium" is the paid catalogue, left out.
fn parse_categories(html: &str) -> Vec<AdultCategory> {
    let mut seen = std::collections::HashSet::new();
    RE_CATEGORY
        .captures_iter(html)
        .filter(|c| &c[1] != "premium" && seen.insert(c[1].to_string()))
        .map(|c| AdultCategory { slug: c[1].to_string(), name: unescape(&c[2]), image: unescape(&c[3]) })
        .collect()
}

/// The tiles of the site's list of models, in page order.
fn parse_models(html: &str) -> Vec<AdultPerformer> {
    let mut seen = std::collections::HashSet::new();
    RE_MODEL
        .captures_iter(html)
        .filter(|c| seen.insert(c[1].to_string()))
        .map(|c| AdultPerformer {
            path: c[1].to_string(),
            name: unescape(&c[4]),
            alt_name: unescape(&c[5]),
            image: unescape(&c[2]),
            videos: c[3].to_string(),
        })
        .collect()
}

/// `(height, url)` of every file in the player's source list, sharpest last.
fn parse_sources(html: &str) -> Vec<(u32, String)> {
    let mut out: Vec<(u32, String)> = RE_SOURCE
        .captures_iter(html)
        .filter_map(|c| Some((c[2].parse().ok()?, unescape(&c[1]))))
        .filter(|(_, url)| url.starts_with("http"))
        .collect();
    out.sort_by_key(|(h, _)| *h);
    out.dedup_by_key(|(h, _)| *h);
    out
}

fn is_slug(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

fn is_performer_path(path: &str) -> bool {
    path.strip_prefix("models/").is_some_and(is_slug)
}

/// The address of a list's page: `base` is `""` (everything), `/<category>`, `/models/<name>` or `/search/<q>/popular`;
/// the first page is the address itself, the next ones add `/<n>`.
fn page_url(base: &str, page: u32) -> String {
    match (base, page) {
        ("", 1) => format!("{BASE}/"),
        ("", n) => format!("{BASE}/{n}"),
        (b, 1) => format!("{BASE}{b}"),
        (b, n) => format!("{BASE}{b}/{n}"),
    }
}

/// Few page requests to the site at a time, so a screen of lists and a focused video never become a burst.
static SITE_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(3);

/// The page's text: UTF-8, or Windows-1251 for a page that is not valid UTF-8. Tries again — after a wait that grows — when the connection drops or the site answers a
/// server error, 403 or 429 ("too fast").
async fn get_html(url: &str) -> Result<String, String> {
    let mut last = String::new();
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(900 * attempt)).await;
        }
        let slot = SITE_SLOTS.acquire().await.map_err(|e| e.to_string())?;
        let sent = CLIENT.get(url).header("User-Agent", UA).timeout(Duration::from_secs(12)).send().await;
        drop(slot);
        match sent {
            Ok(res) if res.status().is_server_error() || matches!(res.status().as_u16(), 403 | 429) => {
                last = format!("Сайт ответил HTTP {}", res.status().as_u16())
            }
            Ok(res) if !res.status().is_success() => return Err(format!("Сайт ответил HTTP {}", res.status().as_u16())),
            Ok(res) => {
                let bytes = res.bytes().await.map_err(|e| e.to_string())?;
                return Ok(match std::str::from_utf8(&bytes) {
                    Ok(text) => text.to_string(),
                    Err(_) => encoding_rs::WINDOWS_1251.decode(&bytes).0.into_owned(),
                });
            }
            Err(e) => last = format!("Сайт не отвечает: {e}"),
        }
    }
    Err(last)
}

/// The videos of one page of a list. `query` set = a search (it wins over the rest); otherwise the page of one
/// `performer` (`models/<name>`), of one `category` (its slug from `adult_categories`) or of everything, newest first.
#[tauri::command]
pub async fn adult_list(query: Option<String>, category: Option<String>, performer: Option<String>, page: u32) -> Result<AdultPage, String> {
    let query = query.map(|q| q.trim().to_string()).filter(|q| !q.is_empty());
    let page = page.max(1);
    let base = match (&query, category.as_deref(), performer.as_deref()) {
        (Some(q), _, _) => format!("/search/{}/popular", urlencoding::encode(q)),
        (None, _, Some(p)) if is_performer_path(p) => format!("/{p}"),
        (None, _, Some(_)) => return Err("Неверный адрес страницы актрисы".into()),
        (None, Some(c), None) if is_slug(c) => format!("/{c}"),
        (None, Some(_), None) => return Err("Неверная категория".into()),
        (None, None, None) => String::new(),
    };
    let url = page_url(&base, page);
    // A stripped answer with no videos in it is asked for again (a page really past the end stays empty).
    let mut result = AdultPage { videos: Vec::new(), total_pages: page };
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(700 * attempt)).await;
        }
        let html = get_html(&url).await?;
        result = AdultPage { videos: parse_list(&html), total_pages: page + u32::from(has_next(&html)) };
        if !result.videos.is_empty() {
            break;
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn adult_categories() -> Result<Vec<AdultCategory>, String> {
    Ok(parse_categories(&get_html(&format!("{BASE}/categories")).await?))
}

/// The address part a name would have on the site: `Eva Elfie` → `eva-elfie`. Empty when the name has no latin letters.
fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

/// The model whose page has the name's address (the site has no model search, only the list of every model, so the
/// address is guessed — with the endings it uses for some of them). At most one.
#[tauri::command]
pub async fn adult_performers(query: String) -> Result<Vec<AdultPerformer>, String> {
    let slug = slugify(&query);
    if slug.is_empty() || slug.len() > 60 {
        return Ok(Vec::new());
    }
    for candidate in [slug.clone(), format!("{slug}-porno"), format!("{slug}-porn")] {
        let path = format!("models/{candidate}");
        let Ok(html) = get_html(&format!("{BASE}/{path}")).await else { continue };
        let videos = parse_list(&html);
        let Some(first) = videos.first() else { continue };
        let name = RE_H1.captures(&html).map(|c| unescape(&c[1])).unwrap_or_else(|| candidate.replace('-', " "));
        return Ok(vec![AdultPerformer { path, name, alt_name: String::new(), image: first.thumb.clone(), videos: String::new() }]);
    }
    Ok(Vec::new())
}

/// One page of the site's list of models (about 30, the busiest first) — the actors picker reads them page by page.
#[tauri::command]
pub async fn adult_models(page: u32) -> Result<AdultModels, String> {
    let html = get_html(&page_url("/models", page.max(1))).await?;
    Ok(AdultModels { models: parse_models(&html), has_next: has_next(&html) })
}

/// What a video's page gave: its files (one per quality) and the index to start on.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdultStreams {
    pub qualities: Vec<TrailerQuality>,
    pub default_index: usize,
    pub cover: Option<String>,
}

/// The files of a video, straight from its page (about a third of a second).
#[tauri::command]
pub async fn adult_streams(key: String) -> Result<AdultStreams, String> {
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_digit()) {
        return Err("Неверный идентификатор видео".into());
    }
    let html = get_html(&format!("{BASE}/movie/{key}")).await?;
    let files = parse_sources(&html);
    if files.is_empty() {
        return Err("На странице нет ссылок на видео".into());
    }
    let default_index = files.iter().rposition(|(h, _)| *h <= 1080).unwrap_or(0);
    let qualities = files.into_iter().map(|(height, url)| TrailerQuality { height, url, audio_url: None }).collect();
    Ok(AdultStreams { qualities, default_index, cover: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, title: &str) -> String {
        format!(
            r#"<li id="{id}" class="video_block trailer trz"> <a class="image" href="{BASE}/movie/{id}"><div class="tumba"><img src="https://pic.vidb365.com/{id}.jpg" width="450" height="265" alt="x" ></div> <p>{title}</p></a> <span class="duration">14:17</span> <span class="video_views">60,680</span><span class="video_comments">10</span></li>"#
        )
    }

    #[test]
    fn reads_a_video_card() {
        assert_eq!(
            parse_list(&item("51046", "Измена &amp; жена")),
            vec![AdultVideo {
                key: "51046".into(),
                title: "Измена & жена".into(),
                thumb: "https://pic.vidb365.com/51046.jpg".into(),
                duration: "14:17".into(),
                views: "60,680".into()
            }]
        );
    }

    #[test]
    fn a_repeated_video_is_listed_once() {
        let html = [item("1", "A"), item("2", "B"), item("1", "A again")].concat();
        assert_eq!(parse_list(&html).len(), 2);
    }

    #[test]
    fn knows_whether_there_is_a_next_page() {
        assert!(has_next(r#"<div class="navigation"><a class="next_link" href="x">more</a></div>"#));
        assert!(!has_next(r#"<div class="navigation"></div>"#));
    }

    #[test]
    fn reads_categories_and_skips_the_paid_one() {
        let html = r#"<a href="/mamki" title="Мамки" class="categories-link" itemprop="url"> <div class="categories-image"> <img src="https://pic/mamki.jpg" width="400"></div></a>
            <a href="/premium" title="Премиум" class="categories-link" itemprop="url"> <div class="categories-image"> <img src="https://pic/p.jpg"></div></a>"#;
        assert_eq!(parse_categories(html), vec![AdultCategory { slug: "mamki".into(), name: "Мамки".into(), image: "https://pic/mamki.jpg".into() }]);
    }

    #[test]
    fn reads_the_player_sources_sharpest_last() {
        let html = r#"sources: [{ file: "https://c/1080.mp4?x=1", label: "1080p FullHD", "default": false },{ file: "https://c/240.mp4", label: "240p LQ", "default": false },{ file: "https://c/720.mp4", label: "720p HD", "default": true }]"#;
        let got: Vec<u32> = parse_sources(html).into_iter().map(|(h, _)| h).collect();
        assert_eq!(got, vec![240, 720, 1080]);
    }

    #[test]
    fn reads_model_tiles() {
        let html = r#"<div class="item_model"><a href="http://4porno365.fun/models/abella-danger-porno"><img width="240" alt="Абелла" src="http://4porno365.fun/content/images/models/7/abella-danger.jpg" loading="lazy"><span class="cnt_span">211</span><span class="model_name"><span class="model_rus_name">Абелла Дейнджер</span><span class="model_eng_name">Abella Danger</span></span></a></div> <div class="item_model"><a href="http://4porno365.fun/models/лунастар"><span class="flag flag-cu"></span><img width="240" alt="x" src="http://4porno365.fun/content/images/models/1/luna-star.jpg" loading="lazy"><span class="cnt_span">180</span><span class="model_name"><span class="model_rus_name">Луна Стар</span><span class="model_eng_name">Luna Star</span></span></a></div>"#;
        let got = parse_models(html);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], AdultPerformer {
            path: "models/abella-danger-porno".into(),
            name: "Абелла Дейнджер".into(),
            alt_name: "Abella Danger".into(),
            image: "http://4porno365.fun/content/images/models/7/abella-danger.jpg".into(),
            videos: "211".into()
        });
        assert_eq!(got[1].path, "models/лунастар");
        assert!(is_performer_path(&got[1].path));
    }

    #[test]
    fn builds_page_addresses() {
        assert_eq!(page_url("", 1), format!("{BASE}/"));
        assert_eq!(page_url("", 3), format!("{BASE}/3"));
        assert_eq!(page_url("/anal", 1), format!("{BASE}/anal"));
        assert_eq!(page_url("/anal", 2), format!("{BASE}/anal/2"));
        assert_eq!(page_url("/search/a%20b/popular", 2), format!("{BASE}/search/a%20b/popular/2"));
    }

    #[test]
    fn slugs_and_paths() {
        assert_eq!(slugify("Eva  Elfie!"), "eva-elfie");
        assert_eq!(slugify("Ева"), "");
        assert!(is_performer_path("models/eva-elfie"));
        assert!(!is_performer_path("models/../x"));
        assert!(!is_performer_path("anal"));
    }
}
