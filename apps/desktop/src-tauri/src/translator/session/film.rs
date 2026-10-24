//! Translating a film (a seekable file or torrent stream) instead of a live broadcast.
//!
//!   film URL ──► audio mpv ──pcm/pipe──► ASR ──► MT ──► cues (in the film's own timeline)
//!
//! The player plays the film as usual; a second, invisible mpv decodes only its audio, from
//! where the viewer is, **ahead** of them — decoding a file is much faster than playing it, so the
//! subtitles are ready long before their moment. How far ahead is capped (`AHEAD_S`): the film is a
//! torrent, and reading all of it at once would fight the player for the same pieces.
//!
//! Seeking: the decoder is pointed at a new place only when the viewer lands somewhere that is
//! not already translated and not about to be reached by the decoder going forward. The cues
//! themselves are kept by the front end (they are timed in the film's own timeline).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::AppHandle;
use tokio::net::windows::named_pipe::ServerOptions;
use tokio::sync::{mpsc, watch};

use super::super::asr::SAMPLE_RATE;
use super::super::catalog;
use super::super::engines::Engines;
use super::super::mpv::Mpv;
use super::{emit_status, read_pcm, recognize, spawn_event_loop, translate, Audio, Ports, Throttle, Voice};

/// How far ahead of the viewer the decoder may run, in seconds of film.
const AHEAD_S: f64 = 150.0;
/// The viewer needs at least this much already translated (or being translated) in front of them.
const NEED_S: f64 = 20.0;
/// After pointing the decoder somewhere, give it this long before judging that it did not arrive.
const SEEK_GRACE: Duration = Duration::from_secs(20);

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileOptions {
    pub url: String,
    pub asr_model: String,
    pub mt_model: String,
    /// ISO code of the film's language, or None to detect it.
    pub source_lang: Option<String>,
    /// Where the viewer is now, seconds.
    pub start: f64,
}

pub struct FileSession {
    pub id: u64,
    url: String,
    audio_mpv: Arc<Mpv>,
    stop: watch::Sender<bool>,
    visible_pos: Arc<AtomicU64>,
    /// `(origin, head)` of every stretch the decoder has worked through; the last is the current one.
    regions: Arc<Mutex<Vec<(f64, f64)>>>,
    /// Lets the pipe drain while the decoder is being moved (a held pipe would hang its shutdown).
    release: Arc<AtomicBool>,
    last_seek: Mutex<Option<(Instant, f64)>>,
}

/// Points the decoder at `t`: it starts paused, so the anchor is read before any sample is written.
fn point(m: &Mpv, url: &str, t: f64) -> Result<(), String> {
    m.command(&["loadfile", url, "replace", "-1", &format!("start={:.2},pause=yes", t.max(0.0))])
}

/// Decides whether the viewer at `p` needs the decoder moved, given what it has done so far.
fn needs_seek(regions: &[(f64, f64)], p: f64) -> bool {
    let covered = regions.iter().any(|(a, b)| *a <= p + 0.5 && *b >= p + NEED_S);
    let on_the_way = regions.last().is_some_and(|(a, b)| *a <= p + 0.5 && p <= *b + AHEAD_S + 10.0);
    !covered && !on_the_way
}

impl FileSession {
    pub async fn start(app: AppHandle, engines: Arc<Engines>, id: u64, opts: FileOptions) -> Result<FileSession, String> {
        let asr_item = catalog::item(&opts.asr_model).ok_or("неизвестная модель распознавания")?;
        let mt_item = catalog::item(&opts.mt_model).ok_or("неизвестная модель перевода")?;

        let (stop, _) = watch::channel(false);
        let audio = Arc::new(Mutex::new(Audio::default()));
        let visible_pos = Arc::new(AtomicU64::new(opts.start.to_bits()));
        let voice = Arc::new(Voice { on: AtomicBool::new(false), starting: AtomicBool::new(false), port: AtomicU64::new(0) });
        let regions: Arc<Mutex<Vec<(f64, f64)>>> = Arc::new(Mutex::new(Vec::new()));
        let release = Arc::new(AtomicBool::new(false));

        let pipe_name = format!(r"\\.\pipe\kinonyx-pcm-{}-{id}", std::process::id());
        let pipe = ServerOptions::new()
            .access_inbound(true)
            .access_outbound(false)
            .first_pipe_instance(true)
            .create(&pipe_name)
            .map_err(|e| format!("pipe: {e}"))?;
        let audio_mpv = Arc::new(Mpv::new(
            "film",
            &[
                ("vid", "no".into()),
                ("sid", "no".into()),
                ("ao", "pcm".into()),
                ("ao-pcm-file", pipe_name.clone()),
                ("ao-pcm-waveheader", "no".into()),
                ("audio-format", "s16".into()),
                ("audio-samplerate", SAMPLE_RATE.to_string()),
                ("audio-channels", "mono".into()),
                ("pause", "yes".into()),
                ("network-timeout", "60".into()),
                ("cache", "yes".into()),
                ("demuxer-max-bytes", "48MiB".into()),
                ("demuxer-readahead-secs", "30".into()),
            ],
        )?);
        spawn_event_loop(audio_mpv.clone(), Some(audio.clone()));
        point(&audio_mpv, &opts.url, opts.start - 2.0)?;

        let throttle = Throttle { visible_pos: visible_pos.clone(), ahead_s: AHEAD_S, release: release.clone() };
        tokio::spawn(read_pcm(pipe, pipe_name, audio.clone(), Some(throttle), stop.subscribe()));
        tokio::spawn(track_regions(audio.clone(), regions.clone(), release.clone(), stop.subscribe()));

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
        // No voice-over for films: the jobs channel has nobody on the other end.
        let (voice_tx, _voice_rx) = mpsc::unbounded_channel();
        tokio::spawn(translate(app.clone(), id, ports, seg_rx, voice_tx, voice, visible_pos.clone(), stop.subscribe()));

        Ok(FileSession {
            id,
            url: opts.url,
            audio_mpv,
            stop,
            visible_pos,
            regions,
            release,
            last_seek: Mutex::new(None),
        })
    }

    /// The player's position, once a second. Moves the decoder when the viewer has jumped to a
    /// place that is neither translated nor on the decoder's way.
    pub fn on_position(&self, p: f64) {
        if !p.is_finite() {
            return;
        }
        self.visible_pos.store(p.to_bits(), Ordering::SeqCst);
        if !needs_seek(&self.regions.lock().unwrap(), p) {
            return;
        }
        let mut last = self.last_seek.lock().unwrap();
        if last.is_some_and(|(at, to)| at.elapsed() < SEEK_GRACE && (p - to).abs() < 40.0) {
            return; // already on its way there
        }
        eprintln!("[translator] film: decoder moves to {:.1}s", p - 3.0);
        *last = Some((Instant::now(), p - 3.0));
        self.release.store(true, Ordering::SeqCst);
        if let Err(e) = point(&self.audio_mpv, &self.url, p - 3.0) {
            eprintln!("[translator] film seek: {e}");
        }
    }

    pub fn shutdown(self) {
        let _ = self.stop.send(true);
        let m = self.audio_mpv;
        // `quit` makes the core emit SHUTDOWN; the event loop then drops the last reference, which is
        // where mpv_terminate_destroy (blocking) runs — off the async runtime.
        std::thread::spawn(move || {
            let _ = m.command(&["quit"]);
            m.wakeup();
            drop(m);
        });
    }
}

/// Keeps `regions` current: the newest decoded block's origin and how far it has got. Also lets go of
/// the pipe hold once the decoder has come up at its new place.
async fn track_regions(audio: Arc<Mutex<Audio>>, regions: Arc<Mutex<Vec<(f64, f64)>>>, release: Arc<AtomicBool>, mut stop: watch::Receiver<bool>) {
    let mut seen_origin: Option<f64> = None;
    loop {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(400)) => {}
            _ = stop.changed() => return,
        }
        let Some((origin, head)) = ({
            let a = audio.lock().unwrap();
            a.blocks.back().map(|b| (b.origin, b.start_pts + b.samples.len() as f64 / f64::from(SAMPLE_RATE)))
        }) else {
            continue;
        };
        if seen_origin.map_or(true, |o| (o - origin).abs() > 0.01) {
            // A new block: the decoder is at its new place.
            seen_origin = Some(origin);
            release.store(false, Ordering::SeqCst);
        }
        let mut r = regions.lock().unwrap();
        match r.iter().position(|(a, _)| (a - origin).abs() < 0.01) {
            Some(i) => {
                let mut entry = r.remove(i);
                entry.1 = entry.1.max(head);
                r.push(entry); // the current one is always last
            }
            None => r.push((origin, head)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::needs_seek;

    #[test]
    fn nothing_to_do_while_the_decoder_is_going_the_viewers_way() {
        // Decoded 100 s .. 400 s so far, viewer at 150 s: covered.
        assert!(!needs_seek(&[(100.0, 400.0)], 150.0));
        // Viewer reaches the head: the decoder is still coming along, no move.
        assert!(!needs_seek(&[(100.0, 400.0)], 395.0));
    }

    #[test]
    fn a_jump_forward_past_the_decoders_reach_moves_it() {
        assert!(needs_seek(&[(100.0, 400.0)], 1500.0));
    }

    #[test]
    fn a_jump_back_to_a_translated_stretch_does_not() {
        // An old stretch 0..300 and the current one 1000..1100; viewer back at 120 s.
        assert!(!needs_seek(&[(0.0, 300.0), (1000.0, 1100.0)], 120.0));
    }

    #[test]
    fn a_jump_back_before_everything_moves_it() {
        assert!(needs_seek(&[(1000.0, 1200.0)], 300.0));
    }
}
