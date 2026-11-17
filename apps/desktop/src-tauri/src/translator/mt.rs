//! Translation via llama-server running Hy-MT2 (OpenAI-compatible chat completions).
//!
//! Prompts follow Hy-MT2's published templates: its "background information" form carries
//! the last few lines and their translations, which keeps names, gender and «ты»/«вы»
//! consistent across a conversation instead of each line being translated in isolation.
//!
//! On top of that, `Hints` carries what the pipeline knows besides the words themselves:
//!   - whether this is a live broadcast or a film (and the film's title and synopsis),
//!   - a glossary (character names and their Russian spelling from Kinopoisk / TMDB),
//!     of which only the entries that occur in the line or its context are sent,
//!   - the film's characters as Kinopoisk spells them in Russian, so «Walter» comes out
//!     «Уолтер» every time and not «Вальтер» one line and «Уолтер» the next,
//!   - the speaker's likely gender (from the voice's pitch, see `pitch.rs`), which decides
//!     Russian past-tense and adjective endings («я пришёл» / «я пришла»).

use std::time::Duration;

use serde_json::{json, Value};

const STYLE: &str = "natural spoken Russian, like professional TV and movie subtitles; keep names, numbers and \
terms exact; address a single person informally as «ты» unless the situation is clearly formal";

/// With voice-over on, the line has to be *said* in the time the original took. Russian runs
/// ~15–25 % longer than English, and every extra syllable means a faster, less natural voice.
const VOICE_STYLE: &str = "concise spoken Russian for a voice-over dub: short, natural phrasing that can be said in \
the same time as the original, drop filler words and repetitions but keep the meaning; keep names exact; write \
numbers as words; address a single person informally as «ты» unless the situation is clearly formal";

/// Most glossary entries sent with one line. More only dilutes the prompt.
const MAX_TERMS: usize = 8;
/// Most character names given as background.
const MAX_CAST: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gender {
    Male,
    Female,
}

#[derive(Clone, Debug, Default)]
pub enum Scene {
    #[default]
    Broadcast,
    Film {
        title: String,
        /// One or two sentences; longer synopses are cut.
        synopsis: String,
    },
}

#[derive(Clone, Debug, Default)]
pub struct Hints {
    pub scene: Scene,
    /// (source term, Russian rendering), e.g. ("Walter White", "Уолтер Уайт").
    pub glossary: Vec<(String, String)>,
    /// Characters' names in their Russian spelling (Kinopoisk), e.g. «Уолтер Уайт».
    pub cast: Vec<String>,
    pub speaker: Option<Gender>,
    /// The translation will be spoken (voice-over), not only shown.
    pub voice: bool,
}

impl Hints {
    fn style(&self) -> &'static str {
        if self.voice {
            VOICE_STYLE
        } else {
            STYLE
        }
    }
}

fn style_prompt(text: &str, style: &str) -> String {
    format!("Please translate the following text into Russian. Note that the translation style must strictly conform to [{style}]:\n\n{text}")
}

/// Hy-MT2 "Terminology" template, used when there is no context yet but some names apply.
fn terminology_prompt(text: &str, terms: &[&(String, String)]) -> String {
    let mut p = String::from("Reference the following translations:\n");
    for (src, ru) in terms {
        p.push_str(&format!("{src} translates to {ru}\n"));
    }
    p.push_str(&format!(
        "\nTranslate the following text into Russian. Note that you must ONLY output the translated result without any additional explanation:\n\n{text}"
    ));
    p
}

fn first_sentences(s: &str, max_chars: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let cut: String = s.chars().take(max_chars).collect();
    match cut.rfind(['.', '!', '?']) {
        Some(i) if i > max_chars / 3 => cut[..=i].to_string(),
        _ => format!("{}…", cut.trim_end()),
    }
}

fn scene_line(scene: &Scene, style: &str, voice: bool) -> String {
    let what = if voice { "dubbed with a Russian voice-over" } else { "subtitled into Russian" };
    match scene {
        Scene::Broadcast => format!("This is a live TV broadcast being {what}. Style: {style}."),
        Scene::Film { title, synopsis } => {
            let mut s = format!("These are lines of dialogue from the film «{title}», being {what}. Style: {style}.");
            let syn = first_sentences(synopsis, 300);
            if !syn.is_empty() {
                s.push_str(&format!("\nWhat the film is about: {syn}"));
            }
            s
        }
    }
}

fn context_prompt(text: &str, context: &[(String, String)], hints: &Hints, terms: &[&(String, String)]) -> String {
    let mut bg = scene_line(&hints.scene, hints.style(), hints.voice);
    bg.push('\n');
    if !terms.is_empty() {
        bg.push_str("Names and terms, with the Russian spelling to use:\n");
        for (src, ru) in terms {
            bg.push_str(&format!("- {src} translates to {ru}\n"));
        }
    }
    if !hints.cast.is_empty() {
        let names: Vec<&str> = hints.cast.iter().map(String::as_str).filter(|n| !n.trim().is_empty()).take(MAX_CAST).collect();
        if !names.is_empty() {
            bg.push_str(&format!("Characters, with the Russian spelling of their names to use: {}.\n", names.join(", ")));
        }
    }
    if let Some(g) = hints.speaker {
        bg.push_str(match g {
            Gender::Male => "The person speaking now is a man.\n",
            Gender::Female => "The person speaking now is a woman.\n",
        });
    }
    if !context.is_empty() {
        bg.push_str("The preceding lines and their Russian subtitles:\n");
        for (src, ru) in context {
            bg.push_str(&format!("- {src}\n  → {ru}\n"));
        }
    }
    format!(
        "[Background Information]\n{bg}\nPlease translate the following text into Russian, taking the provided background information into consideration. Only output the translation of the source text.\n\n[Source Text]\n{text}"
    )
}

const PLAIN: &str = "Translate the following text into Russian. Note that you should only output the translated result without any additional explanation:\n\n";

// The small model sometimes echoes part of the instructions — including the template's
// section headers *translated* ("[Источник текста]", "[Предыдущий текст]"). Bracketed
// headers are stripped; anything else instruction-like triggers a retry with the plainest
// template.
const LEAK_MARKERS: &[&str] = &[
    "[Source Text]", "[Background", "Background Information", "Source Text", "стиль перевода", "субтитр", "→",
    "Источник текста", "Исходный текст", "Справочная информация", "Фоновая информация", "Предыдущий текст", "Предыдущие реплики",
    "translates to", "переводится как", "Говорящий —", "говорит мужчина", "говорит женщина",
];

/// Drops leading "[Header]" lines/prefixes the model sometimes emits before the translation.
fn strip_headers(out: &str) -> &str {
    let mut t = out.trim_start();
    while let Some(rest) = t.strip_prefix('[') {
        match rest.find(']') {
            Some(end) if end <= 40 => t = rest[end + 1..].trim_start(),
            _ => break,
        }
    }
    t
}

// An apostrophe is a boundary, so "Walt" is found in "Walt's".
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
}

/// Whole-word, case-insensitive: "Walt" must not match inside "Walter" or "Walton".
fn mentions(haystack: &str, term: &str) -> bool {
    let h = haystack.to_lowercase();
    let t = term.trim().to_lowercase();
    if t.is_empty() {
        return false;
    }
    let mut from = 0;
    while let Some(i) = h[from..].find(&t) {
        let at = from + i;
        let before = h[..at].chars().next_back();
        let after = h[at + t.len()..].chars().next();
        if !before.is_some_and(is_word_char) && !after.is_some_and(is_word_char) {
            return true;
        }
        from = at + t.len().max(1);
        while !h.is_char_boundary(from) {
            from += 1;
        }
    }
    false
}

/// Glossary entries that occur in the line (first) or in its context, at most `MAX_TERMS`.
/// A full name also brings in its parts' entries only if those parts occur on their own.
fn relevant_terms<'a>(glossary: &'a [(String, String)], text: &str, context: &[(String, String)]) -> Vec<&'a (String, String)> {
    let mut out: Vec<&(String, String)> = glossary.iter().filter(|(src, _)| mentions(text, src)).collect();
    for e in glossary {
        if out.len() >= MAX_TERMS {
            break;
        }
        if !out.contains(&e) && context.iter().any(|(src, _)| mentions(src, &e.0)) {
            out.push(e);
        }
    }
    out.truncate(MAX_TERMS);
    out
}

pub fn build_prompt(text: &str, context: &[(String, String)], hints: &Hints) -> String {
    let terms = relevant_terms(&hints.glossary, text, context);
    let has_background = !context.is_empty() || hints.speaker.is_some() || matches!(hints.scene, Scene::Film { .. });
    // The terminology template has no room for a style, so a voice-over line with names but no
    // context goes through the background template, which carries both.
    let has_background = has_background || (hints.voice && !terms.is_empty()) || !hints.cast.is_empty();
    if has_background {
        context_prompt(text, context, hints, &terms)
    } else if !terms.is_empty() {
        terminology_prompt(text, &terms)
    } else {
        style_prompt(text, hints.style())
    }
}

async fn complete(client: &reqwest::Client, port: u16, prompt: String, max_tokens: usize) -> Result<String, String> {
    let body = json!({
        "messages": [{ "role": "user", "content": prompt }],
        // Greedy decoding: the same line always translates the same way.
        "temperature": 0.0,
        "repeat_penalty": 1.05,
        "max_tokens": max_tokens,
        "cache_prompt": true,
    });
    let resp = client
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .json(&body)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("llama-server: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("llama-server ответил {}", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| format!("llama-server: {e}"))?;
    Ok(v["choices"][0]["message"]["content"].as_str().unwrap_or_default().to_string())
}

fn clean(out: &str) -> String {
    let t = out.trim().trim_matches(|c| matches!(c, '"' | '«' | '»' | '„' | '“' | '”')).trim();
    let mut chars = t.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn leaked(out: &str, source: &str) -> bool {
    LEAK_MARKERS.iter().any(|m| out.contains(m) && !source.contains(m)) || out.chars().count() > source.chars().count() * 3 + 60
}

pub async fn translate(client: &reqwest::Client, port: u16, text: &str, context: &[(String, String)], hints: &Hints) -> Result<String, String> {
    let max_tokens = 64 + text.chars().count();
    let out = complete(client, port, build_prompt(text, context, hints), max_tokens).await?;
    let out = strip_headers(&out);
    if !leaked(out, text) && !out.trim().is_empty() {
        return Ok(clean(out));
    }
    let out = complete(client, port, format!("{PLAIN}{text}"), max_tokens).await?;
    Ok(clean(strip_headers(&out)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }

    #[test]
    fn strips_translated_template_headers() {
        assert_eq!(strip_headers("[Источник текста]\nНет."), "Нет.");
        assert_eq!(strip_headers("[Предыдущий текст]  Сейчас? Ну"), "Сейчас? Ну");
        assert_eq!(strip_headers("Обычный текст [с пометкой]"), "Обычный текст [с пометкой]");
    }

    #[test]
    fn mentions_is_whole_word_and_case_insensitive() {
        assert!(mentions("Say my name, Heisenberg.", "heisenberg"));
        assert!(mentions("Walter White is here", "Walter White"));
        assert!(!mentions("Walton is here", "Walt"));
        assert!(!mentions("Walter is here", "Walt"));
        assert!(mentions("It's Walt's car", "Walt"));
        assert!(!mentions("anything", ""));
        assert!(mentions("Привет, Jesse!", "Jesse"));
    }

    #[test]
    fn only_relevant_terms_are_sent_line_first() {
        let gl = g(&[("Walter White", "Уолтер Уайт"), ("Jesse", "Джесси"), ("Skyler", "Скайлер"), ("Hank", "Хэнк")]);
        let ctx = g(&[("Hank called again.", "Хэнк снова звонил.")]);
        let t = relevant_terms(&gl, "Jesse, where is Walter White?", &ctx);
        let names: Vec<&str> = t.iter().map(|e| e.0.as_str()).collect();
        assert_eq!(names, vec!["Walter White", "Jesse", "Hank"]);
    }

    #[test]
    fn terms_are_capped() {
        let gl: Vec<(String, String)> = (0..20).map(|i| (format!("Name{i}"), format!("Имя{i}"))).collect();
        let text = (0..20).map(|i| format!("Name{i}")).collect::<Vec<_>>().join(" ");
        assert_eq!(relevant_terms(&gl, &text, &[]).len(), MAX_TERMS);
    }

    #[test]
    fn broadcast_without_anything_uses_style_template() {
        let p = build_prompt("Hello there.", &[], &Hints::default());
        assert!(p.starts_with("Please translate the following text into Russian. Note that the translation style"));
    }

    #[test]
    fn names_without_context_use_terminology_template() {
        let h = Hints { glossary: g(&[("Jesse", "Джесси")]), ..Default::default() };
        let p = build_prompt("Jesse, come here.", &[], &h);
        assert!(p.starts_with("Reference the following translations:\nJesse translates to Джесси\n"));
        assert!(p.ends_with("Jesse, come here."));
    }

    #[test]
    fn film_background_carries_title_names_gender_and_context() {
        let h = Hints {
            scene: Scene::Film { title: "Во все тяжкие".into(), synopsis: "A chemistry teacher turns to crime. He partners with a former student. More detail that is cut.".repeat(3) },
            glossary: g(&[("Jesse", "Джесси"), ("Skyler", "Скайлер")]),
            cast: vec!["Уолтер Уайт".into(), "Джесси Пинкман".into()],
            speaker: Some(Gender::Female),
            voice: false,
        };
        let ctx = g(&[("Where were you?", "Где ты был?")]);
        let p = build_prompt("Jesse called. I answered.", &ctx, &h);
        assert!(p.starts_with("[Background Information]\nThese are lines of dialogue from the film «Во все тяжкие»"));
        assert!(p.contains("- Jesse translates to Джесси\n"));
        assert!(!p.contains("Skyler"));
        assert!(p.contains("Characters, with the Russian spelling of their names to use: Уолтер Уайт, Джесси Пинкман.\n"));
        assert!(p.contains("The person speaking now is a woman.\n"));
        assert!(p.contains("- Where were you?\n  → Где ты был?\n"));
        assert!(p.ends_with("[Source Text]\nJesse called. I answered."));
        assert!(!p.contains("live TV broadcast"));
    }

    #[test]
    fn voice_over_asks_for_a_concise_dub() {
        let h = Hints { voice: true, ..Default::default() };
        let p = build_prompt("Well, you know, I think that we should probably go.", &[], &h);
        assert!(p.contains("concise spoken Russian for a voice-over dub"));
        assert!(!p.contains("TV and movie subtitles"));
        let film = Hints { voice: true, scene: Scene::Film { title: "X".into(), synopsis: String::new() }, ..Default::default() };
        assert!(build_prompt("Hi.", &[], &film).contains("being dubbed with a Russian voice-over. Style: concise"));
        let names = Hints { voice: true, glossary: g(&[("Jesse", "Джесси")]), ..Default::default() };
        let p = build_prompt("Jesse, come here.", &[], &names);
        assert!(p.starts_with("[Background Information]") && p.contains("Jesse translates to Джесси") && p.contains("concise"));
    }

    #[test]
    fn cast_is_capped_and_blank_names_skipped() {
        let mut cast: Vec<String> = (0..20).map(|i| format!("Имя{i}")).collect();
        cast.insert(0, "  ".into());
        let h = Hints { cast, ..Default::default() };
        let p = build_prompt("Hi.", &[], &h);
        assert!(p.starts_with("[Background Information]"));
        assert!(p.contains("Имя0, Имя1") && p.contains("Имя11.") && !p.contains("Имя12"));
    }

    #[test]
    fn synopsis_is_cut_at_a_sentence() {
        let s = first_sentences(&"One sentence here. ".repeat(40), 100);
        assert!(s.ends_with('.') && s.chars().count() <= 100);
    }

    #[test]
    fn glossary_echo_counts_as_leak() {
        assert!(leaked("Jesse translates to Джесси. Джесси, иди сюда.", "Jesse, come here."));
        assert!(!leaked("Джесси, иди сюда.", "Jesse, come here."));
    }
}
