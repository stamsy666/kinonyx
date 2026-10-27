//! A test of the internet speed, to tell what quality of a film the connection will carry. It reads a test file from
//! Cloudflare's speed endpoint over a few connections at once for about eight seconds and reports the mean (megabits per
//! second). Nothing is saved on the way and nothing is sent: only the downloaded bytes are counted.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::http::CLIENT;

const SOURCE: &str = "https://speed.cloudflare.com/__down?bytes=50000000";
const STREAMS: usize = 4;
const DURATION: Duration = Duration::from_secs(8);

#[tauri::command]
pub async fn speedtest_run() -> Result<f64, String> {
    let total = Arc::new(AtomicU64::new(0));
    let started = Instant::now();
    let mut tasks = Vec::new();
    for _ in 0..STREAMS {
        let total = total.clone();
        tasks.push(tauri::async_runtime::spawn(async move {
            // Streams are re-opened until the time is up (a 50 MB file is gone in a second on a fast line).
            while started.elapsed() < DURATION {
                let Ok(mut res) = CLIENT.get(SOURCE).timeout(DURATION + Duration::from_secs(5)).send().await else { return false };
                if !res.status().is_success() {
                    return false;
                }
                loop {
                    if started.elapsed() >= DURATION {
                        return true;
                    }
                    match res.chunk().await {
                        Ok(Some(c)) => {
                            total.fetch_add(c.len() as u64, Ordering::Relaxed);
                        }
                        Ok(None) => break,
                        Err(_) => return false,
                    }
                }
            }
            true
        }));
    }
    let mut any_ok = false;
    for t in tasks {
        any_ok |= t.await.unwrap_or(false);
    }
    let bytes = total.load(Ordering::Relaxed);
    let secs = started.elapsed().as_secs_f64().max(0.5);
    if !any_ok && bytes == 0 {
        return Err("Не удалось измерить скорость: сервер проверки недоступен".into());
    }
    let mbit = bytes as f64 * 8.0 / secs / 1e6;
    crate::elog!("[speedtest] {mbit:.1} Mbit/s over {secs:.1}s");
    Ok(mbit)
}
