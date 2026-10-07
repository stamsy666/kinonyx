//! Rutube as a trailer source for when YouTube won't answer (blocked IP, no VPN) or the
//! metadata source (TMDB) listed no YouTube video at all. Rutube's public search API gives
//! page URLs; yt-dlp turns those into streams the same way it does for YouTube.

use crate::http::CLIENT;
use serde_json::Value;
use std::time::Duration;

/// Rutube's WAF answers 403 to unfamiliar user agents (checked: curl's and our own
/// "KINONYX/0.1" were refused, a browser one is not).
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/// Same idea as `normalizeTitle` in the frontend: case-, punctuation- and ё-insensitive.
fn norm(s: &str) -> String {
    s.to_lowercase().replace('ё', "е").chars().filter(|c| c.is_alphanumeric()).collect()
}

const TRAILER_WORDS: [&str; 3] = ["трейлер", "trailer", "тизер"];
/// Trailers are short; anything longer is a review, a "making of" or a full movie.
const MAX_TRAILER_SECS: u64 = 420;

/// Best-scoring result of a search response: the title must contain the film's name, and
/// it earns points for the year, a "трейлер"/"trailer" word and a trailer-like duration.
fn pick_trailer(response: &Value, names: &[String], year: Option<&str>) -> Option<String> {
    let names: Vec<String> = names.iter().map(|n| norm(n)).filter(|n| !n.is_empty()).collect();
    if names.is_empty() {
        return None;
    }
    let results = response["results"].as_array()?;
    let mut best: Option<(i32, &str)> = None;
    for r in results {
        if r["is_hidden"].as_bool().unwrap_or(false)
            || r["is_adult"].as_bool().unwrap_or(false)
            || r["is_livestream"].as_bool().unwrap_or(false)
        {
            continue;
        }
        let (Some(title), Some(url)) = (r["title"].as_str(), r["video_url"].as_str()) else { continue };
        let normalized = norm(title);
        if !names.iter().any(|n| normalized.contains(n.as_str())) {
            continue;
        }
        let lower = title.to_lowercase();
        let mut score = 0;
        if year.is_some_and(|y| !y.is_empty() && title.contains(y)) {
            score += 2;
        }
        if TRAILER_WORDS.iter().any(|w| lower.contains(w)) {
            score += 3;
        }
        match r["duration"].as_u64() {
            Some(d) if (20..=MAX_TRAILER_SECS).contains(&d) => score += 1,
            Some(_) => score -= 3,
            None => {}
        }
        // A trailer word is what separates a trailer from "the whole film on Rutube".
        if score >= 3 && best.is_none_or(|(s, _)| score > s) {
            best = Some((score, url));
        }
    }
    best.map(|(_, u)| u.to_string())
}

/// Rutube page URL of the most trailer-like result for this film, if any.
pub async fn find_trailer(name_ru: Option<&str>, name_original: Option<&str>, year: Option<&str>) -> Result<Option<String>, String> {
    let names: Vec<String> = [name_ru, name_original].into_iter().flatten().map(str::to_string).collect();
    let Some(first) = names.first() else { return Ok(None) };
    // Russian title first: Rutube is a Russian-language catalogue.
    let query = format!("{first} {} трейлер", year.unwrap_or("")).trim().replace("  ", " ");
    let res = CLIENT
        .get("https://rutube.ru/api/search/video/")
        .query(&[("query", query.as_str())])
        .header("User-Agent", UA)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Rutube не отвечает: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Rutube ответил HTTP {}", res.status().as_u16()));
    }
    let json: Value = res.json().await.map_err(|e| format!("Rutube вернул неразборчивый ответ: {e}"))?;
    Ok(pick_trailer(&json, &names, year))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(title: &str, url: &str, duration: u64) -> Value {
        json!({ "title": title, "video_url": url, "duration": duration, "is_hidden": false, "is_adult": false, "is_livestream": false })
    }

    fn names() -> Vec<String> {
        vec!["Дюна".into(), "Dune".into()]
    }

    #[test]
    fn prefers_the_short_trailer_with_the_right_year() {
        let r = json!({ "results": [
            item("Дюна (2021) Фильм целиком", "https://rutube.ru/video/full/", 9000),
            item("Дюна 3 — трейлер (2026)", "https://rutube.ru/video/other/", 326),
            item("Дюна / Dune (2021) Русский трейлер", "https://rutube.ru/video/ok/", 208),
        ]});
        assert_eq!(pick_trailer(&r, &names(), Some("2021")).as_deref(), Some("https://rutube.ru/video/ok/"));
    }

    #[test]
    fn rejects_unrelated_titles_hidden_and_adult_entries() {
        let mut hidden = item("Дюна трейлер", "https://rutube.ru/video/hidden/", 100);
        hidden["is_hidden"] = json!(true);
        let r = json!({ "results": [
            item("Совсем другой фильм — трейлер", "https://rutube.ru/video/x/", 100),
            hidden,
        ]});
        assert_eq!(pick_trailer(&r, &names(), Some("2021")), None);
    }

    #[test]
    fn a_long_result_without_a_trailer_word_is_not_a_trailer() {
        let r = json!({ "results": [item("Дюна (2021)", "https://rutube.ru/video/full/", 9300)] });
        assert_eq!(pick_trailer(&r, &names(), Some("2021")), None);
    }

    #[test]
    fn no_names_means_no_search() {
        assert_eq!(pick_trailer(&json!({ "results": [] }), &[], None), None);
    }
}
