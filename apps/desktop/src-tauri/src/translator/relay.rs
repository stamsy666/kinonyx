//! Local relay: one upstream connection to the IPTV provider, fanned out to several readers.
//!
//! The recorder mpv (see session.rs) pulls the channel and remuxes it into MPEG-TS over
//! `stream-record=tcp://127.0.0.1:<in>/rec.ts`. Every HTTP client of `<out>/live.ts` gets
//! that same byte stream from the beginning — the visible player (which then plays it
//! `delay` seconds behind) and the audio decoder feeding speech recognition (which reads it
//! as it arrives). Identical bytes means identical timestamps, which is what lets a
//! subtitle computed from the decoder's audio land exactly on the player's picture.

use std::collections::VecDeque;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, Mutex, Notify};

/// Beyond this much buffered data the oldest is dropped (~50 s of a 20 Mbit/s 4K channel).
/// Both readers normally sit near the head, so this only bounds a stalled client.
const MAX_BUFFERED: u64 = 128 * 1024 * 1024;
const TS_PACKET: u64 = 188;

#[derive(Default)]
struct Buf {
    /// Absolute stream offset of `chunks[0]`'s first byte.
    base: u64,
    total: u64,
    chunks: VecDeque<Vec<u8>>,
    closed: bool,
}

pub struct Relay {
    buf: Mutex<Buf>,
    grew: Notify,
    pub in_port: u16,
    pub out_port: u16,
    stop: watch::Sender<bool>,
}

impl Relay {
    pub async fn start() -> Result<Arc<Relay>, String> {
        let input = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
        let output = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
        let (stop, _) = watch::channel(false);
        let relay = Arc::new(Relay {
            buf: Mutex::new(Buf::default()),
            grew: Notify::new(),
            in_port: input.local_addr().map_err(|e| e.to_string())?.port(),
            out_port: output.local_addr().map_err(|e| e.to_string())?.port(),
            stop,
        });
        tokio::spawn(Self::accept_recorder(relay.clone(), input));
        tokio::spawn(Self::accept_readers(relay.clone(), output));
        Ok(relay)
    }

    pub fn record_url(&self) -> String {
        format!("tcp://127.0.0.1:{}/rec.ts", self.in_port)
    }

    pub fn play_url(&self) -> String {
        format!("http://127.0.0.1:{}/live.ts", self.out_port)
    }

    pub async fn bytes_received(&self) -> u64 {
        self.buf.lock().await.total
    }

    pub fn shutdown(&self) {
        let _ = self.stop.send(true);
        self.grew.notify_waiters();
    }

    /// Appends upstream bytes (from the recorder's TCP output or the built-in HLS client).
    pub async fn push(&self, data: &[u8]) {
        let mut b = self.buf.lock().await;
        b.chunks.push_back(data.to_vec());
        b.total += data.len() as u64;
        while b.total - b.base > MAX_BUFFERED && b.chunks.len() > 1 {
            let first = b.chunks.pop_front().unwrap();
            b.base += first.len() as u64;
        }
        drop(b);
        self.grew.notify_waiters();
    }

    async fn accept_recorder(self: Arc<Self>, listener: TcpListener) {
        let mut stop = self.stop.subscribe();
        // mpv may reconnect if its output errors out (it doesn't today, but a fresh
        // connection simply continues the same stream).
        loop {
            let conn = tokio::select! {
                c = listener.accept() => c,
                _ = stop.changed() => break,
            };
            let Ok((mut sock, _)) = conn else { continue };
            let mut chunk = vec![0u8; 256 * 1024];
            loop {
                let n = tokio::select! {
                    r = sock.read(&mut chunk) => r.unwrap_or(0),
                    _ = stop.changed() => 0,
                };
                if n == 0 {
                    break;
                }
                self.push(&chunk[..n]).await;
            }
            if *stop.borrow() {
                break;
            }
        }
        self.buf.lock().await.closed = true;
        self.grew.notify_waiters();
    }

    async fn accept_readers(self: Arc<Self>, listener: TcpListener) {
        let mut stop = self.stop.subscribe();
        loop {
            let conn = tokio::select! {
                c = listener.accept() => c,
                _ = stop.changed() => break,
            };
            if let Ok((sock, _)) = conn {
                tokio::spawn(self.clone().serve(sock));
            }
        }
    }

    async fn serve(self: Arc<Self>, mut sock: TcpStream) {
        // The request itself doesn't matter — there is exactly one resource.
        let mut req = [0u8; 4096];
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), sock.read(&mut req)).await;
        let head = b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
        if sock.write_all(head).await.is_err() {
            return;
        }
        let _ = sock.set_nodelay(true);
        let mut stop = self.stop.subscribe();
        let mut pos: u64 = 0;
        loop {
            let notified = self.grew.notified();
            let (data, closed) = {
                let b = self.buf.lock().await;
                if pos < b.base {
                    // Fell behind the retained window: skip ahead, staying on a TS packet
                    // boundary so the demuxer resyncs immediately.
                    pos = b.base.div_ceil(TS_PACKET) * TS_PACKET;
                }
                let mut out = Vec::new();
                let mut off = b.base;
                for c in &b.chunks {
                    let end = off + c.len() as u64;
                    if end > pos {
                        let from = (pos.saturating_sub(off)) as usize;
                        out.extend_from_slice(&c[from..]);
                    }
                    off = end;
                    if out.len() > 4 * 1024 * 1024 {
                        break;
                    }
                }
                (out, b.closed)
            };
            if !data.is_empty() {
                if sock.write_all(&data).await.is_err() {
                    return;
                }
                pos += data.len() as u64;
                continue;
            }
            if closed || *stop.borrow() {
                return;
            }
            tokio::select! {
                _ = notified => {}
                _ = stop.changed() => return,
            }
        }
    }
}
