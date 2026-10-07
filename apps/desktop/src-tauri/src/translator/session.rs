//! One live-translation session: a channel played `delay` seconds behind the live edge while
//! its audio — taken at the live edge — is recognized and translated into timed subtitles.
//!
//!   provider ──► recorder mpv ──stream-record/tcp──► Relay ──http──► visible player (delayed)
//!                                                      └──http──► audio mpv ──pcm/pipe──► ASR ──► MT ──► cues
//!
//! The visible player and the audio decoder read the same relayed bytes with
//! `rebase-start-time=no`, so the decoder's `audio-pts` is directly the player's `time-pos`:
//! a cue's start/end need no conversion. "Reading mode": nothing is shown until a whole
//! sentence is recognized and translated — no flickering previews, no half-phrases.
//!
//! Voice-over (optional, switchable mid-session): each translated sentence is also spoken by
//! OmniVoice in the voice of whoever said it — the sentence's own source audio is the voice
//! reference — and sent to the player as a clip timed to the same `start`.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::net::windows::named_pipe::ServerOptions;
use tokio::sync::{mpsc, watch};

use super::asr::{self, SAMPLE_RATE};
use super::catalog;
use super::engines::Engines;
use super::hls;
use super::mpv::{self, Mpv};
use super::mt;
use super::relay::Relay;

const SR: f64 = SAMPLE_RATE as f64;
/// Whisper's native window. Longer context → better accuracy and punctuation.
const MAX_WINDOW_S: f64 = 28.0;
/// A segment ending closer than this to the newest audio may still be mid-sentence.
const TAIL_GUARD_S: f64 = 1.5;
/// Commit regardless of stability once a phrase is about to be on screen.
const URGENT_S: f64 = 4.0;
/// With voice-over on, lines are committed and translated this much earlier: speaking one
/// takes a second or two more than showing it.
const VOICE_EXTRA_LEAD_S: f64 = 5.0;
/// With voice-over on, an unfinished sentence is cut after this long (a run-on transcript
/// would otherwise start being spoken far behind its picture).
const VOICE_MAX_GROUP_S: f64 = 9.0;
/// Longest text spoken as one clip; longer translations are split at sentence ends.
const VOICE_MAX_CHARS: usize = 180;
/// Longest voice reference sent to OmniVoice.
const VOICE_MAX_REF_S: f64 = 15.0;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub url: String,
    pub asr_model: String,
    pub mt_model: String,
    /// ISO code of the broadcast language, or None to detect it.
    pub source_lang: Option<String>,
    /// Speak the translation in the original voices as well.
    #[serde(default)]
    pub voice: bool,
}

#[derive(Serialize, Clone)]
struct VoiceClip {
    session: u64,
    start: f64,
    end: f64,
    /// WAV (s16 mono), base64.
    audio: String,
}

struct VoiceJob {
    start: f64,
    end: f64,
    text: String,
    orig: String,
    audio: Vec<f32>,
}

#[derive(Serialize, Clone)]
struct Cue {
    session: u64,
    start: f64,
    end: f64,
    text: String,
    orig: String,
}

#[derive(Serialize, Clone)]
struct Status {
    session: u64,
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn emit_status(app: &AppHandle, session: u64, state: &'static str, message: Option<String>) {
    let _ = app.emit("translator://status", Status { session, state, message });
}

struct Block {
    start_pts: f64,
    samples: Vec<f32>,
    closed: bool,
}

#[derive(Default)]
struct Audio {
    blocks: VecDeque<Block>,
    total: u64,
    last_rx: Option<Instant>,
    anchor: Option<(u64, f64)>,
}

impl Audio {
    fn start_block(&mut self, pts: f64) {
        if let Some(b) = self.blocks.back_mut() {
            b.closed = true;
        }
        self.blocks.push_back(Block { start_pts: pts, samples: Vec::new(), closed: false });
        self.anchor = Some((self.total, pts));
    }
}

pub struct Session {
    pub id: u64,
    pub play_url: String,
    relay: Arc<Relay>,
    recorder: Arc<Mutex<Option<Arc<Mpv>>>>,
    audio_mpv: Option<Arc<Mpv>>,
    stop: watch::Sender<bool>,
    pub visible_pos: Arc<AtomicU64>,
    voice: Arc<Voice>,
}

/// Voice-over state shared by the session's tasks. The server is started the first time
/// voice-over is switched on (it's a ~15–30 s model load) and kept for the session.
struct Voice {
    on: AtomicBool,
    starting: AtomicBool,
    port: AtomicU64,
}

/// Fallback upstream: mpv plays the channel headless and remuxes it into the relay via
/// `stream-record`. Video is recorded but only keyframes are decoded (enough to keep its
/// playback clock moving so its cache drains); audio goes nowhere.
fn start_recorder(relay: &Relay, url: &str) -> Result<Arc<Mpv>, String> {
    let m = Arc::new(Mpv::new(
        "rec",
        &[
            ("vo", "null".into()),
            ("ao", "null".into()),
            ("hwdec", "no".into()),
            ("vd-lavc-skipframe", "nonkey".into()),
            ("vd-lavc-skiploopfilter", "all".into()),
            ("stream-record", relay.record_url()),
            ("cache", "yes".into()),
            ("demuxer-max-bytes", "64MiB".into()),
            ("network-timeout", "60".into()),
        ],
    )?);
    spawn_event_loop(m.clone(), None);
    m.command(&["loadfile", url])?;
    Ok(m)
}

impl Session {
    pub async fn start(app: AppHandle, engines: Arc<Engines>, id: u64, opts: Options) -> Result<Session, String> {
        let asr_item = catalog::item(&opts.asr_model).ok_or("неизвестная модель распознавания")?;
        let mt_item = catalog::item(&opts.mt_model).ok_or("неизвестная модель перевода")?;

        let relay = Relay::start().await?;
        let (stop, _) = watch::channel(false);
        let audio = Arc::new(Mutex::new(Audio::default()));
        let visible_pos = Arc::new(AtomicU64::new(f64::NAN.to_bits()));
        let voice = Arc::new(Voice { on: AtomicBool::new(opts.voice), starting: AtomicBool::new(false), port: AtomicU64::new(0) });

        // The single connection to the provider: the built-in HLS client when the stream is
        // plain live HLS/TS (nearly all IPTV), otherwise an mpv recorder as a fallback.
        let recorder: Arc<Mutex<Option<Arc<Mpv>>>> = Arc::new(Mutex::new(None));
        tokio::spawn({
            let (app, relay, recorder, url, stop_rx) = (app.clone(), relay.clone(), recorder.clone(), opts.url.clone(), stop.subscribe());
            async move {
                match hls::run(url.clone(), relay.clone(), stop_rx.clone()).await {
                    hls::Outcome::Stopped => {}
                    hls::Outcome::Failed(e) => {
                        eprintln!("[translator] upstream: {e}");
                        emit_status(&app, id, "error", Some(e));
                    }
                    hls::Outcome::Unsupported => {
                        eprintln!("[translator] not plain live HLS — recording through mpv");
                        match start_recorder(&relay, &url) {
                            Ok(m) => {
                                *recorder.lock().unwrap() = Some(m);
                                watch_stall(app, id, relay, stop_rx).await;
                            }
                            Err(e) => emit_status(&app, id, "error", Some(e)),
                        }
                    }
                }
            }
        });

        // Audio decoder: reads the relay at the live edge and writes 24 kHz mono PCM into a
        // named pipe (nothing touches the disk). Starts paused so its first `audio-pts` can be
        // read before a single sample is written — that's the anchor for all timestamps.
        let pipe_name = format!(r"\\.\pipe\kinonyx-pcm-{}-{id}", std::process::id());
        let pipe = ServerOptions::new()
            .access_inbound(true)
            .access_outbound(false)
            .first_pipe_instance(true)
            .create(&pipe_name)
            .map_err(|e| format!("pipe: {e}"))?;
        let audio_mpv = Arc::new(Mpv::new(
            "aud",
            &[
                ("vid", "no".into()),
                ("sid", "no".into()),
                ("ao", "pcm".into()),
                ("ao-pcm-file", pipe_name.clone()),
                ("ao-pcm-waveheader", "no".into()),
                ("audio-format", "s16".into()),
                ("audio-samplerate", SAMPLE_RATE.to_string()),
                ("audio-channels", "mono".into()),
                ("rebase-start-time", "no".into()),
                ("pause", "yes".into()),
                ("network-timeout", "60".into()),
            ],
        )?);
        spawn_event_loop(audio_mpv.clone(), Some(audio.clone()));
        audio_mpv.command(&["loadfile", &relay.play_url()])?;

        tokio::spawn(read_pcm(pipe, pipe_name.clone(), audio.clone(), stop.subscribe()));
        tokio::spawn(watch_drift(audio_mpv.clone(), audio.clone(), stop.subscribe()));

        let (seg_tx, seg_rx) = mpsc::unbounded_channel();
        let ports = Arc::new(Ports::default());
        tokio::spawn({
            let (app, engines, ports, stop_rx) = (app.clone(), engines.clone(), ports.clone(), stop.subscribe());
            async move {
                emit_status(&app, id, "starting", None);
                let r = async {
                    let a = engines.asr(&app, asr_item).await?;
                    ports.asr.store(a as u64, Ordering::SeqCst);
                    let m = engines.mt(mt_item).await?;
                    ports.mt.store(m as u64, Ordering::SeqCst);
                    Ok::<_, String>(())
                }
                .await;
                if *stop_rx.borrow() {
                    return;
                }
                match r {
                    Ok(()) => emit_status(&app, id, "ready", None),
                    Err(e) => emit_status(&app, id, "error", Some(e)),
                }
            }
        });
        tokio::spawn(recognize(
            audio.clone(),
            ports.clone(),
            seg_tx,
            visible_pos.clone(),
            opts.source_lang.clone(),
            voice.clone(),
            stop.subscribe(),
        ));
        let (voice_tx, voice_rx) = mpsc::unbounded_channel();
        tokio::spawn(translate(app.clone(), id, ports, seg_rx, voice_tx, voice.clone(), visible_pos.clone(), stop.subscribe()));
        tokio::spawn(speak(app.clone(), id, voice_rx, voice.clone(), visible_pos.clone(), stop.subscribe()));

        let session = Session {
            id,
            play_url: relay.play_url(),
            relay,
            recorder,
            audio_mpv: Some(audio_mpv),
            stop,
            visible_pos,
            voice,
        };
        if opts.voice {
            session.start_voice(app, engines);
        }
        Ok(session)
    }

    /// Switches voice-over on/off without restarting the session (the broadcast keeps playing).
    pub fn set_voice(&self, app: AppHandle, engines: Arc<Engines>, on: bool) {
        self.voice.on.store(on, Ordering::SeqCst);
        if on {
            self.start_voice(app, engines);
        }
    }

    fn start_voice(&self, app: AppHandle, engines: Arc<Engines>) {
        if self.voice.port.load(Ordering::SeqCst) != 0 || self.voice.starting.swap(true, Ordering::SeqCst) {
            return;
        }
        let (voice, id, stop) = (self.voice.clone(), self.id, self.stop.subscribe());
        tokio::spawn(async move {
            emit_status(&app, id, "voice-starting", None);
            let r = engines.tts(&app).await;
            voice.starting.store(false, Ordering::SeqCst);
            if *stop.borrow() {
                return;
            }
            match r {
                Ok(port) => {
                    // A new channel: forget the previous one's speakers.
                    let _ = reqwest::Client::new().post(format!("http://127.0.0.1:{port}/reset")).send().await;
                    voice.port.store(port as u64, Ordering::SeqCst);
                    emit_status(&app, id, "voice-ready", None);
                }
                Err(e) => {
                    voice.on.store(false, Ordering::SeqCst);
                    emit_status(&app, id, "voice-error", Some(e));
                }
            }
        });
    }

    pub fn shutdown(mut self) {
        let _ = self.stop.send(true);
        self.relay.shutdown();
        let handles = [self.recorder.lock().unwrap().take(), self.audio_mpv.take()];
        // `quit` makes each core emit SHUTDOWN; its event loop then drops the last reference,
        // which is where mpv_terminate_destroy (blocking) runs — off the async runtime.
        std::thread::spawn(move || {
            for m in handles.into_iter().flatten() {
                let _ = m.command(&["quit"]);
                m.wakeup();
                drop(m);
            }
        });
    }
}

#[derive(Default)]
struct Ports {
    asr: AtomicU64,
    mt: AtomicU64,
}

fn load_f64(a: &AtomicU64) -> f64 {
    f64::from_bits(a.load(Ordering::SeqCst))
}

/// Drains an mpv core's events on a plain thread until it shuts down. For the audio decoder
/// it also turns each playback (re)start into a timestamp anchor, then lets it run.
fn spawn_event_loop(m: Arc<Mpv>, audio: Option<Arc<Mutex<Audio>>>) {
    std::thread::spawn(move || loop {
        let (id, err) = m.wait_event(1.0);
        match id {
            mpv::EVENT_SHUTDOWN => break,
            mpv::EVENT_END_FILE if err < 0 => eprintln!("[translator] mpv end-file error {err}"),
            mpv::EVENT_PLAYBACK_RESTART => {
                if let Some(audio) = &audio {
                    if let Some(pts) = m.get_f64("audio-pts").or_else(|| m.get_f64("time-pos")) {
                        eprintln!("[translator] audio anchored at {pts:.2}");
                        audio.lock().unwrap().start_block(pts);
                    }
                    let _ = m.set("pause", "no");
                }
            }
            _ => {}
        }
    });
}

/// mpv re-creates its audio output — closing and reopening the "file" — whenever playback
/// resets (a timestamp jump, which HLS streams produce right at the start). So the pipe must
/// accept any number of successive connections: a fresh instance is created the moment one
/// connects, so the reopen always finds a listener.
async fn read_pcm(
    first: tokio::net::windows::named_pipe::NamedPipeServer,
    name: String,
    audio: Arc<Mutex<Audio>>,
    mut stop: watch::Receiver<bool>,
) {
    let mut next = Some(first);
    while let Some(pipe) = next.take() {
        tokio::select! {
            r = pipe.connect() => if r.is_err() { return },
            _ = stop.changed() => return,
        }
        next = ServerOptions::new().access_inbound(true).access_outbound(false).create(&name).ok();
        if !read_connection(pipe, &audio, &mut stop).await {
            return;
        }
        eprintln!("[translator] audio output reopened by mpv");
    }
}

/// Reads one connection until mpv closes it. False if the session is stopping.
async fn read_connection(
    mut pipe: tokio::net::windows::named_pipe::NamedPipeServer,
    audio: &Mutex<Audio>,
    stop: &mut watch::Receiver<bool>,
) -> bool {
    let mut buf = vec![0u8; 64 * 1024];
    let mut carry: Option<u8> = None;
    loop {
        let n = tokio::select! {
            r = pipe.read(&mut buf) => r.unwrap_or(0),
            _ = stop.changed() => return false,
        };
        if n == 0 {
            return !*stop.borrow();
        }
        let mut bytes: Vec<u8> = Vec::with_capacity(n + 1);
        if let Some(b) = carry.take() {
            bytes.push(b);
        }
        bytes.extend_from_slice(&buf[..n]);
        if bytes.len() % 2 == 1 {
            carry = bytes.pop();
        }
        let samples = bytes.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0);
        let mut a = audio.lock().unwrap();
        let count = bytes.len() as u64 / 2;
        if a.blocks.is_empty() {
            continue; // not anchored yet (shouldn't happen: the decoder starts paused)
        }
        a.blocks.back_mut().unwrap().samples.extend(samples);
        a.total += count;
        a.last_rx = Some(Instant::now());
    }
}

/// A provider that stops sending (seen live: the HTTPS connection stays open, no data) would
/// leave the recorder waiting forever and the player buffering forever. After a while with
/// no new bytes, tell the UI, which starts a fresh session (new connection, new relay).
async fn watch_stall(app: AppHandle, session: u64, relay: Arc<Relay>, mut stop: watch::Receiver<bool>) {
    let mut last = 0u64;
    let mut since = Instant::now();
    loop {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
            _ = stop.changed() => return,
        }
        let now = relay.bytes_received().await;
        if now != last {
            last = now;
            since = Instant::now();
            continue;
        }
        let limit = if last == 0 { 45 } else { 15 };
        if since.elapsed() > Duration::from_secs(limit) {
            eprintln!("[translator] broadcast stalled for {limit}s — reconnecting");
            emit_status(&app, session, "stalled", None);
            return;
        }
    }
}

/// Between bursts (HLS delivers whole segments) the decoder is idle and its `audio-pts` is
/// exactly the timestamp of the last written sample. If that disagrees with our sample count,
/// the stream's timestamps jumped (ad insertion, provider restart) — start a new block there.
async fn watch_drift(m: Arc<Mpv>, audio: Arc<Mutex<Audio>>, mut stop: watch::Receiver<bool>) {
    loop {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(300)) => {}
            _ = stop.changed() => return,
        }
        let quiet = audio.lock().unwrap().last_rx.map(|t| t.elapsed() > Duration::from_millis(250)).unwrap_or(false);
        if !quiet {
            continue;
        }
        let Some(pts) = m.get_f64("audio-pts") else { continue };
        let mut a = audio.lock().unwrap();
        let Some((at, anchor_pts)) = a.anchor else { continue };
        let expected = anchor_pts + (a.total - at) as f64 / SR;
        // ≤0.13 s of PCM can sit in mpv's stdio buffer, so small differences are normal.
        if (pts - expected).abs() > 0.4 {
            eprintln!("[translator] timestamp jump: expected {expected:.2}, audio-pts {pts:.2}");
            a.start_block(pts);
        }
    }
}

#[derive(Debug, Clone)]
struct Seg {
    start: f64,
    end: f64,
    text: String,
    /// ISO code if known.
    lang: Option<&'static str>,
    /// The segment's own audio — the voice reference — while voice-over is on.
    audio: Option<Vec<f32>>,
}

/// Pins the broadcast language once detection agrees on it (skipping per-window detection
/// avoids short or noisy windows being misread as another language); rechecks now and then
/// to follow a switch.
#[derive(Default)]
struct LangLock {
    locked: Option<&'static str>,
    last: Option<&'static str>,
    since_check: u32,
}

impl LangLock {
    fn hint(&mut self) -> Option<&'static str> {
        if self.locked.is_some() && self.since_check >= 8 {
            self.since_check = 0;
            return None;
        }
        self.since_check += 1;
        self.locked
    }

    fn observe(&mut self, detected: Option<&'static str>, was_hint: bool) {
        if was_hint {
            return;
        }
        match (self.last, detected) {
            (Some(a), Some(b)) if a == b => self.locked = Some(b),
            (_, Some(b)) if self.locked.is_some() && self.locked != Some(b) => self.locked = None,
            _ => {}
        }
        self.last = detected;
    }
}

async fn recognize(
    audio: Arc<Mutex<Audio>>,
    ports: Arc<Ports>,
    out: mpsc::UnboundedSender<Seg>,
    visible_pos: Arc<AtomicU64>,
    source_lang: Option<String>,
    voice: Arc<Voice>,
    mut stop: watch::Receiver<bool>,
) {
    let client = reqwest::Client::new();
    let fixed_lang: Option<&'static str> = source_lang.as_deref().and_then(asr::lang_code);
    let mut lock = LangLock::default();
    let mut committed = 0usize; // sample offset into blocks[0]
    let mut last_run_len = 0usize;
    let mut last_text = String::new();

    loop {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(400)) => {}
            _ = stop.changed() => return,
        }
        let port = ports.asr.load(Ordering::SeqCst) as u16;
        if port == 0 {
            continue;
        }
        // Snapshot the window to recognize: blocks[0] from `committed`, capped at 28 s.
        let (block_start, window, block_closed, head_len) = {
            let mut a = audio.lock().unwrap();
            // A finished block that's been fully processed can go.
            while a.blocks.len() > 1 && a.blocks[0].closed && committed >= a.blocks[0].samples.len() {
                a.blocks.pop_front();
                committed = 0;
                last_run_len = 0;
            }
            let Some(b) = a.blocks.front() else { continue };
            let from = committed.min(b.samples.len());
            let to = b.samples.len().min(from + (MAX_WINDOW_S * SR) as usize);
            (b.start_pts + from as f64 / SR, b.samples[from..to].to_vec(), b.closed || a.blocks.len() > 1, b.samples.len())
        };
        let len_s = window.len() as f64 / SR;
        let grew = head_len.saturating_sub(last_run_len) as f64 / SR;
        // Only a timestamp discontinuity ends a block for good. A pause in *arrival* means
        // nothing: HLS delivers audio in multi-second bursts, and treating the gap between
        // two bursts as "the end" is exactly what used to cut sentences in half.
        let finalize = block_closed;
        if len_s < 1.0 && !(finalize && len_s > 0.3) {
            continue;
        }
        if grew < 1.5 && !finalize && len_s < MAX_WINDOW_S {
            continue;
        }
        last_run_len = head_len;
        let window_end = block_start + len_s;

        let hint = fixed_lang.or_else(|| lock.hint());
        let prompt = if hint.is_some() && !last_text.is_empty() {
            Some(last_text.chars().rev().take(200).collect::<Vec<_>>().into_iter().rev().collect::<String>())
        } else {
            None
        };
        let t0 = Instant::now();
        let resp = match asr::transcribe(&client, port, asr::Request { audio: &window, language: hint, prompt: prompt.as_deref() }).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[translator] asr: {e}");
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        let detected = asr::lang_code(&resp.language);
        if fixed_lang.is_none() {
            lock.observe(detected, hint.is_some());
        }
        let lang = hint.or(detected);
        let vis = load_f64(&visible_pos);
        let full_window = len_s >= MAX_WINDOW_S - 0.5;

        let segs = &resp.segments;
        let mut commit_to: Option<f64> = None;
        let mut committed_any = false;
        for (i, s) in segs.iter().enumerate() {
            let (start, end) = (block_start + s.start, block_start + s.end);
            let is_last = i + 1 == segs.len();
            let stable = end < window_end - TAIL_GUARD_S && (!is_last || window_end - end > 2.5);
            let extra = if voice.on.load(Ordering::SeqCst) { VOICE_EXTRA_LEAD_S } else { 0.0 };
            let urgent = vis.is_finite() && start - vis < URGENT_S + extra;
            let forced = finalize || (full_window && !is_last);
            if !(stable || urgent || forced || (full_window && segs.len() == 1)) {
                break;
            }
            commit_to = Some(end);
            if let Some(reason) = asr::reject_reason(s, prompt.as_deref()) {
                eprintln!("[translator] dropped ({reason}): {}", s.text.trim());
                continue;
            }
            last_text = s.text.trim().to_string();
            committed_any = true;
            // Raw text, leading space included: whisper sometimes splits segments inside a
            // word, and only that space tells a continuation ("avahee") from a new word.
            let audio = voice.on.load(Ordering::SeqCst).then(|| {
                let from = ((s.start * SR) as usize).min(window.len());
                let to = ((s.end * SR) as usize).clamp(from, window.len());
                window[from..to].to_vec()
            });
            let _ = out.send(Seg { start, end: end.max(start + 0.3), text: s.text.clone(), lang, audio });
        }
        if segs.is_empty() && (len_s >= 6.0 || finalize) {
            // Only music/silence here (VAD found no speech): let it go, keep a second so a
            // word starting right at the edge isn't cut.
            commit_to = Some(if finalize { window_end } else { window_end - 1.0 });
        }
        if let Some(t) = commit_to {
            let a = audio.lock().unwrap();
            if let Some(b) = a.blocks.front() {
                let offset = ((t - b.start_pts) * SR).round().max(0.0) as usize;
                committed = committed.max(offset.min(b.samples.len()));
                if finalize && block_closed {
                    committed = b.samples.len();
                }
            }
        }
        if committed_any {
            eprintln!(
                "[translator] asr {:.1}s window in {} ms, lang {:?}, lookahead {:.1}s",
                len_s,
                t0.elapsed().as_millis(),
                lang,
                if vis.is_finite() { window_end - vis } else { f64::NAN }
            );
        }
        // Trim what's committed so the buffer doesn't grow for the whole broadcast.
        let mut a = audio.lock().unwrap();
        if let Some(b) = a.blocks.front_mut() {
            if committed > (60.0 * SR) as usize {
                b.samples.drain(..committed);
                b.start_pts += committed as f64 / SR;
                committed = 0;
                last_run_len = 0;
            }
        }
    }
}

fn ends_sentence(text: &str) -> bool {
    let t = text.trim_end_matches(|c: char| c == '"' || c == '»' || c == '\'' || c == ')' || c.is_whitespace());
    t.ends_with(['.', '!', '?', '…', '。', '！', '？'])
}

#[allow(clippy::too_many_arguments)]
async fn translate(
    app: AppHandle,
    session: u64,
    ports: Arc<Ports>,
    mut rx: mpsc::UnboundedReceiver<Seg>,
    voice_tx: mpsc::UnboundedSender<VoiceJob>,
    voice: Arc<Voice>,
    visible_pos: Arc<AtomicU64>,
    mut stop: watch::Receiver<bool>,
) {
    let client = reqwest::Client::new();
    let mut pending: Vec<Seg> = Vec::new();
    let mut last_arrival = Instant::now();
    let mut context: VecDeque<(String, String)> = VecDeque::new();

    loop {
        let next = tokio::select! {
            s = rx.recv() => match s { Some(s) => Some(s), None => return },
            _ = tokio::time::sleep(Duration::from_millis(300)) => None,
            _ = stop.changed() => return,
        };
        let mut flush = false;
        if let Some(seg) = next {
            // Don't glue lines across a long pause — they're separate utterances. (A shorter
            // pause is usually a speaker catching breath mid-sentence.)
            if pending.last().map(|p| seg.start - p.end > 2.5 || p.lang != seg.lang).unwrap_or(false) {
                emit_group(&app, session, &client, &ports, std::mem::take(&mut pending), &mut context, &voice_tx, &voice, &mut stop).await;
            }
            last_arrival = Instant::now();
            let ends = ends_sentence(&seg.text);
            pending.push(seg);
            let dur = pending.last().unwrap().end - pending[0].start;
            let chars: usize = pending.iter().map(|s| s.text.chars().count()).sum();
            // Long sentences stay whole for translation; split_cues breaks the result into
            // readable cards afterwards. The caps only guard against run-on transcripts.
            let max_dur = if voice.on.load(Ordering::SeqCst) { VOICE_MAX_GROUP_S } else { 15.0 };
            flush = ends || dur > max_dur || chars > 360;
        } else if !pending.is_empty() {
            // An unfinished sentence waits for its continuation (which may be a whole HLS
            // segment away) for as long as the broadcast delay allows — it's only sent off
            // on its own when it's about to be on screen. Without a player position to go
            // by, fall back to a generous wall-clock wait.
            let vis = load_f64(&visible_pos);
            flush = if vis.is_finite() {
                let extra = if voice.on.load(Ordering::SeqCst) { VOICE_EXTRA_LEAD_S } else { 0.0 };
                pending[0].start - vis < URGENT_S + 1.0 + extra
            } else {
                last_arrival.elapsed() > Duration::from_secs(10)
            };
        }
        if flush && !pending.is_empty() {
            emit_group(&app, session, &client, &ports, std::mem::take(&mut pending), &mut context, &voice_tx, &voice, &mut stop).await;
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn emit_group(
    app: &AppHandle,
    session: u64,
    client: &reqwest::Client,
    ports: &Ports,
    group: Vec<Seg>,
    context: &mut VecDeque<(String, String)>,
    voice_tx: &mpsc::UnboundedSender<VoiceJob>,
    voice: &Voice,
    stop: &mut watch::Receiver<bool>,
) {
    if group.is_empty() {
        return;
    }
    let orig = group.iter().map(|s| s.text.as_str()).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    let (start, end) = (group[0].start, group.last().unwrap().end);
    let russian = asr::is_russian_text(&orig) && group[0].lang.map_or(true, |l| l == "ru");
    let text = if russian {
        orig.clone()
    } else {
        // The translator may still be loading on the very first lines — wait for it rather
        // than drop them.
        let port = loop {
            let p = ports.mt.load(Ordering::SeqCst) as u16;
            if p != 0 {
                break p;
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(300)) => {}
                _ = stop.changed() => return,
            }
        };
        let ctx: Vec<(String, String)> = context.iter().cloned().collect();
        let t0 = Instant::now();
        match mt::translate(client, port, &orig, &ctx).await {
            Ok(t) if !t.is_empty() => {
                eprintln!("[translator] mt {} ms: {orig}\n    -> {t}", t0.elapsed().as_millis());
                t
            }
            Ok(_) => return,
            Err(e) => {
                eprintln!("[translator] mt: {e}");
                return;
            }
        }
    };
    context.push_back((orig.clone(), text.clone()));
    while context.len() > 3 {
        context.pop_front();
    }
    if voice.on.load(Ordering::SeqCst) && !russian && group.iter().all(|s| s.audio.is_some()) {
        for job in voice_jobs(&group, &text, start, end) {
            let _ = voice_tx.send(job);
        }
    }
    for (s, e, t) in split_cues(&text, start, end) {
        let _ = app.emit("translator://cue", Cue { session, start: s, end: e, text: t, orig: orig.clone() });
    }
}

/// Splits a translated group into clips of whole sentences (≤ VOICE_MAX_CHARS), each timed by
/// its share of the text, with its own voice reference: the source segments overlapping that
/// span (so each part is spoken by whoever says it there) and their exact text.
fn voice_jobs(group: &[Seg], text: &str, start: f64, end: f64) -> Vec<VoiceJob> {
    let mut chunks: Vec<String> = Vec::new();
    for sentence in split_keep(text, &['.', '!', '?', '…']) {
        match chunks.last_mut() {
            Some(last) if last.chars().count() + 1 + sentence.chars().count() <= VOICE_MAX_CHARS => {
                last.push(' ');
                last.push_str(&sentence);
            }
            _ => chunks.push(sentence),
        }
    }
    let total: usize = chunks.iter().map(|c| c.chars().count()).sum::<usize>().max(1);
    let span = (end - start).max(0.5);
    let mut t = start;
    let n = chunks.len();
    chunks
        .into_iter()
        .enumerate()
        .map(|(i, chunk)| {
            let cs = t;
            t = if i + 1 == n { end } else { t + span * chunk.chars().count() as f64 / total as f64 };
            let ce = t;
            // Segments overlapping the chunk; at least the nearest one.
            let mut refs: Vec<&Seg> = group.iter().filter(|s| s.end > cs && s.start < ce).collect();
            if refs.is_empty() {
                refs.push(group.iter().min_by(|a, b| (a.start - cs).abs().total_cmp(&(b.start - cs).abs())).unwrap());
            }
            let mut audio = Vec::new();
            let mut orig = String::new();
            for s in refs {
                if !audio.is_empty() && (audio.len() as f64 / SR) + (s.end - s.start) > VOICE_MAX_REF_S {
                    break;
                }
                audio.extend_from_slice(s.audio.as_deref().unwrap_or_default());
                orig.push_str(&s.text);
            }
            VoiceJob { start: cs, end: ce, text: chunk, orig: orig.split_whitespace().collect::<Vec<_>>().join(" "), audio }
        })
        .collect()
}

/// Time a spoken line may take: up to the next line's start (the pause in between included),
/// but at most this much past its own source phrase. Beyond the slot OmniVoice speaks faster.
const VOICE_MAX_OVERRUN_S: f64 = 3.0;
/// Slot overrun when the next line isn't translated yet.
const VOICE_DEFAULT_OVERRUN_S: f64 = 1.0;

/// Voice-over worker: one sentence at a time, in order. A sentence whose moment has already
/// passed on screen is skipped rather than spoken late.
async fn speak(
    app: AppHandle,
    session: u64,
    mut rx: mpsc::UnboundedReceiver<VoiceJob>,
    voice: Arc<Voice>,
    visible_pos: Arc<AtomicU64>,
    mut stop: watch::Receiver<bool>,
) {
    let client = reqwest::Client::new();
    let b64 = base64::engine::general_purpose::STANDARD;
    // Jobs already received but not spoken yet: the next one's start bounds this one's slot.
    let mut queue: VecDeque<VoiceJob> = VecDeque::new();
    loop {
        if queue.is_empty() {
            let job = tokio::select! {
                j = rx.recv() => match j { Some(j) => j, None => return },
                _ = stop.changed() => return,
            };
            queue.push_back(job);
        }
        while let Ok(j) = rx.try_recv() {
            queue.push_back(j);
        }
        let job = queue.pop_front().unwrap();
        let own = job.end - job.start;
        let slot = match queue.front() {
            Some(next) => (next.start - job.start - 0.1).clamp(own, own + VOICE_MAX_OVERRUN_S),
            None => own + VOICE_DEFAULT_OVERRUN_S,
        };
        // Lines that arrive while the server is still loading wait for it (the broadcast
        // delay leaves room); ones translated while voice-over was off are dropped.
        let port = loop {
            let p = voice.port.load(Ordering::SeqCst) as u16;
            if p != 0 || !voice.on.load(Ordering::SeqCst) {
                break p;
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(300)) => {}
                _ = stop.changed() => return,
            }
        };
        if port == 0 || !voice.on.load(Ordering::SeqCst) {
            continue;
        }
        let vis = load_f64(&visible_pos);
        let lead = if vis.is_finite() { job.start - vis } else { f64::NAN };
        if vis.is_finite() && job.start < vis - 0.5 {
            eprintln!("[translator] voice skipped (too late by {:.1}s): {}", vis - job.start, job.text);
            continue;
        }
        let pcm: Vec<u8> = job.audio.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
        let body = serde_json::json!({
            "text": job.text,
            "lang": "ru",
            "pcm": b64.encode(&pcm),
            "rate": SAMPLE_RATE,
            "ref_text": job.orig,
            "slot": slot,
            "lead": lead,
        });
        let t0 = Instant::now();
        let resp = client
            .post(format!("http://127.0.0.1:{port}/speak"))
            .json(&body)
            .timeout(Duration::from_secs(60))
            .send()
            .await;
        let wav = match resp {
            Ok(r) if r.status().is_success() => match r.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("[translator] voice: {e}");
                    continue;
                }
            },
            Ok(r) => {
                eprintln!("[translator] voice: server answered {}", r.status());
                continue;
            }
            Err(e) => {
                eprintln!("[translator] voice: {e}");
                continue;
            }
        };
        let vis = load_f64(&visible_pos);
        eprintln!(
            "[translator] voice {} ms, lead {:.1}s: {}",
            t0.elapsed().as_millis(),
            if vis.is_finite() { job.start - vis } else { f64::NAN },
            job.text
        );
        let _ = app.emit("translator://voice", VoiceClip { session, start: job.start, end: job.end, audio: b64.encode(&wav) });
    }
}


const MAX_CUE_CHARS: usize = 90;

/// Breaks a long translation into readable subtitle cards (≤ 2 lines each), splitting at
/// sentence ends first, then at commas/dashes, timing each card by its share of the text.
fn split_cues(text: &str, start: f64, end: f64) -> Vec<(f64, f64, String)> {
    let total = text.chars().count().max(1);
    if total <= MAX_CUE_CHARS {
        return vec![(start, end, text.to_string())];
    }
    let mut pieces: Vec<String> = Vec::new();
    for sentence in split_keep(text, &['.', '!', '?', '…']) {
        if sentence.chars().count() <= MAX_CUE_CHARS {
            pieces.push(sentence);
        } else {
            pieces.extend(split_keep(&sentence, &[',', ';', ':', '—']));
        }
    }
    // Greedily pack pieces into cards.
    let mut cards: Vec<String> = Vec::new();
    for p in pieces {
        match cards.last_mut() {
            Some(last) if last.chars().count() + 1 + p.chars().count() <= MAX_CUE_CHARS => {
                last.push(' ');
                last.push_str(&p);
            }
            _ => cards.push(p),
        }
    }
    let span = (end - start).max(0.5);
    let chars: usize = cards.iter().map(|c| c.chars().count()).sum::<usize>().max(1);
    let n = cards.len();
    let mut t = start;
    cards
        .into_iter()
        .enumerate()
        .map(|(i, c)| {
            let s = t;
            t = if i + 1 == n { start + span } else { t + span * c.chars().count() as f64 / chars as f64 };
            (s, t, c)
        })
        .collect()
}

fn split_keep(text: &str, marks: &[char]) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = text.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        cur.push(c);
        let boundary = marks.contains(&c) && chars.get(i + 1).map(|n| n.is_whitespace()).unwrap_or(true);
        if boundary {
            let t = cur.trim().to_string();
            if !t.is_empty() {
                out.push(t);
            }
            cur.clear();
        }
    }
    let t = cur.trim().to_string();
    if !t.is_empty() {
        out.push(t);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_one_cue() {
        let c = split_cues("Привет, как дела?", 1.0, 3.0);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0], (1.0, 3.0, "Привет, как дела?".to_string()));
    }

    #[test]
    fn long_text_splits_at_sentences_and_covers_the_span() {
        let text = "Над Средиземноморьем в понедельник снова ожидаются ливни и грозы. Большая часть региона останется сухой, солнечной и тёплой, но на Пиренеях будет неспокойно.";
        let c = split_cues(text, 10.0, 20.0);
        assert!(c.len() >= 2, "{c:?}");
        assert!(c.iter().all(|(_, _, t)| t.chars().count() <= MAX_CUE_CHARS));
        assert_eq!(c[0].0, 10.0);
        assert!((c.last().unwrap().1 - 20.0).abs() < 1e-9);
        assert!(c[0].2.ends_with('.'));
    }

    #[test]
    fn voice_jobs_split_by_sentence_with_matching_references() {
        let seg = |start: f64, end: f64, text: &str| Seg {
            start,
            end,
            text: text.into(),
            lang: Some("en"),
            audio: Some(vec![0.0; ((end - start) * SR) as usize]),
        };
        let group = vec![seg(0.0, 6.0, " First part of it."), seg(6.0, 12.0, " Second part here.")];
        let ru = format!("{} {}", "А".repeat(120) + ".", "Б".repeat(120) + ".");
        let jobs = voice_jobs(&group, &ru, 0.0, 12.0);
        assert_eq!(jobs.len(), 2);
        assert_eq!((jobs[0].start, jobs[1].end), (0.0, 12.0));
        assert!((jobs[0].end - 6.0).abs() < 0.1, "{}", jobs[0].end);
        assert_eq!(jobs[0].orig, "First part of it.");
        assert_eq!(jobs[1].orig, "Second part here.");
        assert_eq!(jobs[1].audio.len(), (6.0 * SR) as usize);
    }

    #[test]
    fn sentence_end_detection() {
        assert!(ends_sentence("It is over."));
        assert!(ends_sentence("Really?\""));
        assert!(!ends_sentence("and then we"));
    }
}
