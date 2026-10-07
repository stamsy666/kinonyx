//! Translation via llama-server running Hy-MT2 (OpenAI-compatible chat completions).
//!
//! Prompts follow Hy-MT2's published templates: its "background information" form carries
//! the last few lines and their translations, which keeps names, gender and «ты»/«вы»
//! consistent across a conversation instead of each line being translated in isolation.

use std::time::Duration;

use serde_json::{json, Value};

const STYLE: &str = "natural spoken Russian, like professional TV and movie subtitles; keep names, numbers and \
terms exact; address a single person informally as «ты» unless the situation is clearly formal";

fn style_prompt(text: &str) -> String {
    format!("Please translate the following text into Russian. Note that the translation style must strictly conform to [{STYLE}]:\n\n{text}")
}

fn context_prompt(text: &str, context: &[(String, String)]) -> String {
    let mut bg = format!("This is a live TV broadcast being subtitled into Russian. Style: {STYLE}.\nThe preceding lines and their Russian subtitles:\n");
    for (src, ru) in context {
        bg.push_str(&format!("- {src}\n  → {ru}\n"));
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

pub async fn translate(client: &reqwest::Client, port: u16, text: &str, context: &[(String, String)]) -> Result<String, String> {
    let max_tokens = 64 + text.chars().count();
    let prompt = if context.is_empty() { style_prompt(text) } else { context_prompt(text, context) };
    let out = complete(client, port, prompt, max_tokens).await?;
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

    #[test]
    fn strips_translated_template_headers() {
        assert_eq!(strip_headers("[Источник текста]\nНет."), "Нет.");
        assert_eq!(strip_headers("[Предыдущий текст]  Сейчас? Ну"), "Сейчас? Ну");
        assert_eq!(strip_headers("Обычный текст [с пометкой]"), "Обычный текст [с пометкой]");
    }
}
