//! Speech recognition requests to whisper-server (`POST /inference`, verbose_json).

use std::time::Duration;

use serde::Deserialize;

/// PCM rate of the audio decoder. 24 kHz rather than Whisper's native 16 kHz: the same audio
/// is the voice reference for voice-over, and OmniVoice's codec works at 24 kHz. whisper-server
/// resamples on its own (checked: identical text and timestamps).
pub const SAMPLE_RATE: u32 = 24_000;

#[derive(Deserialize, Debug, Clone)]
pub struct Segment {
    pub text: String,
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub avg_logprob: f64,
    #[serde(default)]
    pub no_speech_prob: f64,
}

#[derive(Deserialize, Debug)]
pub struct Response {
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub segments: Vec<Segment>,
}

pub struct Request<'a> {
    pub audio: &'a [f32],
    /// ISO code, or None for auto-detection.
    pub language: Option<&'a str>,
    pub prompt: Option<&'a str>,
}

fn wav(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    out
}

pub async fn transcribe(client: &reqwest::Client, port: u16, req: Request<'_>) -> Result<Response, String> {
    use reqwest::multipart::{Form, Part};
    let file = Part::bytes(wav(req.audio)).file_name("audio.wav").mime_str("audio/wav").map_err(|e| e.to_string())?;
    let mut form = Form::new()
        .part("file", file)
        .text("response_format", "verbose_json")
        .text("language", req.language.unwrap_or("auto").to_string())
        // Beam search for accuracy, but no temperature fallback: on a hard window it re-decodes
        // up to five times (measured live: a 19 s window took 12 s instead of ~0.5 s), which
        // eats the broadcast delay. The standalone translator had reached the same conclusion.
        .text("beam_size", "5")
        .text("temperature", "0.0")
        .text("temperature_inc", "0.0")
        .text("no_speech_thold", "0.6")
        .text("suppress_nst", "true")
        .text("no_language_probabilities", "true")
        // Silero VAD skips music/silence inside the window (where Whisper would otherwise
        // invent "Thank you for watching"), with timestamps mapped back to the real audio.
        .text("vad", "true")
        .text("vad_threshold", "0.45")
        .text("vad_min_speech_duration_ms", "200")
        .text("vad_min_silence_duration_ms", "300")
        .text("vad_speech_pad_ms", "120");
    if let Some(p) = req.prompt.filter(|p| !p.is_empty()) {
        form = form.text("prompt", p.to_string());
    }
    let resp = client
        .post(format!("http://127.0.0.1:{port}/inference"))
        .multipart(form)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("whisper-server: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("whisper-server ответил {}", resp.status()));
    }
    resp.json::<Response>().await.map_err(|e| format!("whisper-server: {e}"))
}

/// whisper reports the language by its full English name ("english"); the rest of the
/// pipeline wants ISO codes. Unknown names map to None (treated as "some foreign language").
pub fn lang_code(name: &str) -> Option<&'static str> {
    const TABLE: &[(&str, &str)] = &[
        ("english", "en"), ("russian", "ru"), ("ukrainian", "uk"), ("german", "de"), ("french", "fr"),
        ("spanish", "es"), ("italian", "it"), ("portuguese", "pt"), ("polish", "pl"), ("czech", "cs"),
        ("turkish", "tr"), ("arabic", "ar"), ("hebrew", "he"), ("chinese", "zh"), ("japanese", "ja"),
        ("korean", "ko"), ("dutch", "nl"), ("romanian", "ro"), ("hungarian", "hu"), ("greek", "el"),
        ("swedish", "sv"), ("finnish", "fi"), ("danish", "da"), ("norwegian", "no"), ("bulgarian", "bg"),
        ("serbian", "sr"), ("croatian", "hr"), ("slovak", "sk"), ("lithuanian", "lt"), ("latvian", "lv"),
        ("estonian", "et"), ("georgian", "ka"), ("armenian", "hy"), ("azerbaijani", "az"), ("kazakh", "kk"),
        ("uzbek", "uz"), ("belarusian", "be"), ("hindi", "hi"), ("thai", "th"), ("vietnamese", "vi"),
        ("indonesian", "id"), ("malay", "ms"), ("persian", "fa"),
    ];
    let lower = name.trim().to_ascii_lowercase();
    TABLE.iter().find(|(n, c)| *n == lower || *c == lower).map(|(_, c)| *c)
}

/// Russian judged from the text itself: a whisper locked onto "ru" can mislabel Ukrainian or
/// Serbian speech, and that must still be translated.
pub fn is_russian_text(text: &str) -> bool {
    const NON_RUSSIAN: &str = "іїєґўәғқңөұүһђјљњћџІЇЄҐЎӘҒҚҢӨҰҮҺЂЈЉЊЋЏ";
    let letters: Vec<char> = text.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.is_empty() || letters.iter().any(|c| NON_RUSSIAN.contains(*c)) {
        return false;
    }
    let cyr = letters.iter().filter(|c| ('\u{0400}'..='\u{04FF}').contains(*c)).count();
    cyr * 10 > letters.len() * 6
}

// Whisper was trained on YouTube captions and "fills" music or noise with their boilerplate.
const HALLUCINATIONS: &[&str] = &[
    "you", "thank you", "thank you for watching", "thanks for watching", "please subscribe",
    "subscribe to my channel", "like and subscribe", "see you in the next video",
    "subtitles by the amaraorg community", "спасибо за просмотр", "продолжение следует",
    "субтитры сделал dimatorzok", "субтитры создавал dimatorzok", "подписывайтесь на канал",
    "редактор субтитров асемкин корректор акулакова",
];

fn normalize(text: &str) -> String {
    text.to_lowercase().chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Why a recognized segment should be dropped, if it should.
pub fn reject_reason(seg: &Segment, prompt: Option<&str>) -> Option<&'static str> {
    let norm = normalize(&seg.text);
    if norm.is_empty() {
        return Some("empty");
    }
    if HALLUCINATIONS.contains(&norm.as_str()) {
        return Some("hallucination");
    }
    // A prompted decoder sometimes just echoes the prompt back over music.
    if let Some(p) = prompt {
        if norm.len() > 12 && normalize(p).contains(&norm) {
            return Some("prompt echo");
        }
    }
    if seg.no_speech_prob > 0.75 && seg.avg_logprob < -0.9 {
        return Some("no speech");
    }
    // Looping output ("the the the the …") — the classic failure on noise.
    let words: Vec<&str> = norm.split(' ').collect();
    if words.len() >= 8 {
        let unique: std::collections::HashSet<&&str> = words.iter().collect();
        if unique.len() * 4 < words.len() {
            return Some("repetitive");
        }
    }
    None
}
