//! The phone as a remote control. A tiny web server on the local network serves one page (a
//! d-pad, OK, Back, play/pause, seek, a text box); what is pressed on the phone reaches the app as
//! `remote://key` / `remote://text` events, which the front end turns into the same key presses the
//! gamepad produces.
//!
//! The page and every request carry a secret token (the one in the QR code); anything without it
//! is refused, so only whoever scanned the code can press keys. The server runs only while the
//! remote is switched on in Settings.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

const PAGE: &str = include_str!("remote.html");
const LOGO: &[u8] = include_bytes!("../../src/assets/logo-mark.png");
const PREFERRED_PORT: u16 = 47_815;
/// Keys the phone may send: the d-pad, OK, Back, the menu (what the gamepad's PS/Xbox button does), and the player's own keys.
const KEYS: [&str; 13] = [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Enter",
    "Escape",
    "GamepadGuide",
    "p",
    "m",
    "MediaRewind",
    "MediaFastForward",
    "AudioVolumeUp",
    "AudioVolumeDown",
];
const MAX_TEXT_CHARS: usize = 200;

#[derive(Default)]
pub struct Remote {
    running: Mutex<Option<Running>>,
    /// The app's colours (CSS variables, as JSON), pushed by the front end whenever the theme changes.
    theme: Arc<Mutex<String>>,
}

struct Running {
    port: u16,
    token: String,
    stop: watch::Sender<bool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    /// Addresses the phone can open, the most likely one first.
    urls: Vec<String>,
    /// The first address as a QR code (SVG).
    qr: String,
}

/// Private IPv4 addresses of this PC, home networks (192.168.x.x) first: a VPN adapter usually
/// has a 10.x address, which the phone cannot reach.
fn lan_addresses() -> Vec<Ipv4Addr> {
    let mut found: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.ip() {
            IpAddr::V4(v4) if v4.is_private() && !v4.is_link_local() => Some(v4),
            _ => None,
        })
        .collect();
    found.sort_by_key(|ip| match ip.octets() {
        [192, 168, ..] => 0,
        [172, ..] => 1,
        _ => 2,
    });
    found.dedup();
    found
}

/// The QR code of `text` as a self-contained SVG (white square, black modules, the standard quiet zone).
fn qr_svg(text: &str) -> String {
    use qrcode::{Color, EcLevel, QrCode};
    let Ok(code) = QrCode::with_error_correction_level(text.as_bytes(), EcLevel::M) else { return String::new() };
    let n = code.width();
    let colors = code.to_colors();
    let quiet = 4;
    let size = n + quiet * 2;
    let mut path = String::new();
    for y in 0..n {
        let mut x = 0;
        while x < n {
            if colors[y * n + x] == Color::Dark {
                let start = x;
                while x < n && colors[y * n + x] == Color::Dark {
                    x += 1;
                }
                path.push_str(&format!("M{} {}h{}v1h-{}z", start + quiet, y + quiet, x - start, x - start));
            } else {
                x += 1;
            }
        }
    }
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {size} {size}\" shape-rendering=\"crispEdges\"><rect width=\"{size}\" height=\"{size}\" fill=\"#fff\"/><path d=\"{path}\" fill=\"#000\"/></svg>"
    )
}

fn info(port: u16, token: &str) -> RemoteInfo {
    let mut urls: Vec<String> = lan_addresses().into_iter().map(|ip| format!("http://{ip}:{port}/?t={token}")).collect();
    // The PC's own name too (`NAME.local`): it does not change when the router hands the PC a new address,
    // so a bookmark made with it keeps working. Most phones resolve it on a home network.
    if let Ok(name) = std::env::var("COMPUTERNAME") {
        let name = name.trim().to_ascii_lowercase();
        if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            urls.push(format!("http://{name}.local:{port}/?t={token}"));
        }
    }
    let qr = urls.first().map(|u| qr_svg(u)).unwrap_or_default();
    RemoteInfo { urls, qr }
}

/// Starts (or restarts) the remote with the given secret. Returns the addresses and the QR code.
#[tauri::command]
pub async fn remote_start(app: AppHandle, state: State<'_, Remote>, token: String) -> Result<RemoteInfo, String> {
    if token.len() < 8 || token.len() > 64 || !token.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Неверный код пульта".into());
    }
    remote_stop_inner(&state);
    let listener = match TcpListener::bind(("0.0.0.0", PREFERRED_PORT)).await {
        Ok(l) => l,
        Err(_) => TcpListener::bind(("0.0.0.0", 0)).await.map_err(|e| format!("Не удалось открыть порт пульта: {e}"))?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (stop, stop_rx) = watch::channel(false);
    let emit: Emit = Arc::new(move |name, payload| {
        let _ = app.emit(name, payload);
    });
    tokio::spawn(serve(listener, emit, token.clone(), state.theme.clone(), stop_rx));
    *state.running.lock().unwrap() = Some(Running { port, token: token.clone(), stop });
    Ok(info(port, &token))
}

fn remote_stop_inner(state: &Remote) {
    if let Some(r) = state.running.lock().unwrap().take() {
        let _ = r.stop.send(true);
    }
}

#[tauri::command]
pub fn remote_stop(state: State<'_, Remote>) {
    remote_stop_inner(&state);
}

/// The addresses and QR code of the running remote (None when it is off). The network may have
/// changed since it was started, so the addresses are read again.
#[tauri::command]
pub fn remote_info(state: State<'_, Remote>) -> Option<RemoteInfo> {
    state.running.lock().unwrap().as_ref().map(|r| info(r.port, &r.token))
}

/// How a request reaches the app: `(event name, payload)`.
type Emit = Arc<dyn Fn(&'static str, String) + Send + Sync>;

async fn serve(listener: TcpListener, emit: Emit, token: String, theme: Arc<Mutex<String>>, mut stop: watch::Receiver<bool>) {
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((socket, _)) = accepted else { continue };
                let (emit, token, theme) = (emit.clone(), token.clone(), theme.clone());
                tokio::spawn(async move {
                    let _ = tokio::time::timeout(Duration::from_secs(10), handle(socket, emit, token, theme)).await;
                });
            }
            _ = stop.changed() => return,
        }
    }
}

/// Variables the page may take from the app, and what a value may be made of: colours, lengths,
/// filters. Anything else is dropped, so the page can never be given markup or a stray rule.
fn clean_theme(vars: HashMap<String, String>) -> HashMap<String, String> {
    vars.into_iter()
        .filter(|(k, v)| {
            k.len() <= 40
                && k.starts_with("--")
                && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !v.is_empty()
                && v.len() <= 200
                && v.chars().all(|c| c.is_ascii_alphanumeric() || " #%.,()-".contains(c))
        })
        .collect()
}

/// `:root{...}` declarations for the page from the stored theme JSON.
fn theme_css(json: &str) -> String {
    let vars: HashMap<String, String> = serde_json::from_str(json).unwrap_or_default();
    let mut names: Vec<_> = clean_theme(vars).into_iter().collect();
    names.sort();
    let body: String = names.into_iter().map(|(k, v)| format!("{k}:{v};")).collect();
    format!(":root{{{body}}}")
}

/// The front end tells the remote which colours the app is in (the theme chosen in Settings).
#[tauri::command]
pub fn remote_theme(state: State<'_, Remote>, vars: HashMap<String, String>) {
    *state.theme.lock().unwrap() = serde_json::to_string(&clean_theme(vars)).unwrap_or_default();
}

/// `%XX` and `+` decoding of one query value.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if bytes.len() >= i + 3 => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(b) => {
                        out.push(b);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_of<'a>(query: &'a str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == name).then(|| percent_decode(v))
    })
}

async fn respond(socket: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = socket.write_all(head.as_bytes()).await;
    let _ = socket.write_all(body).await;
    let _ = socket.shutdown().await;
}

async fn handle(mut socket: TcpStream, emit: Emit, token: String, theme: Arc<Mutex<String>>) {
    let mut buf = vec![0u8; 8192];
    let mut len = 0;
    // Read until the end of the headers.
    loop {
        match socket.read(&mut buf[len..]).await {
            Ok(0) | Err(_) => return,
            Ok(n) => len += n,
        }
        if buf[..len].windows(4).any(|w| w == b"\r\n\r\n") || len == buf.len() {
            break;
        }
    }
    let text = String::from_utf8_lossy(&buf[..len]).into_owned();
    let Some(line) = text.lines().next() else { return };
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    if method != "GET" {
        return respond(&mut socket, "405 Method Not Allowed", "text/plain", b"").await;
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if query_of(query, "t").as_deref() != Some(token.as_str()) {
        return respond(&mut socket, "403 Forbidden", "text/plain; charset=utf-8", "Откройте пульт по QR-коду из KINONYX".as_bytes()).await;
    }
    match path {
        "/" => {
            // The theme goes into the page itself, so it opens already in the app's colours.
            let css = theme_css(&theme.lock().unwrap());
            let page = PAGE.replace("/*THEME*/", &css);
            respond(&mut socket, "200 OK", "text/html; charset=utf-8", page.as_bytes()).await;
        }
        "/theme" => {
            let json = theme.lock().unwrap().clone();
            respond(&mut socket, "200 OK", "application/json; charset=utf-8", if json.is_empty() { b"{}" } else { json.as_bytes() }).await;
        }
        "/logo.png" => respond(&mut socket, "200 OK", "image/png", LOGO).await,
        // What a phone needs to keep the remote on its home screen as an app of its own: opened from the
        // icon it starts at the same address (the secret included) and has no browser bars.
        "/manifest.json" => {
            let start = format!("/?t={token}");
            let icon = format!("/logo.png?t={token}");
            let body = format!(
                "{{\"name\":\"KINONYX — пульт\",\"short_name\":\"Пульт\",\"start_url\":\"{start}\",\"scope\":\"/\",\"display\":\"standalone\",\"orientation\":\"portrait\",\"background_color\":\"#0a0708\",\"theme_color\":\"#0a0708\",\"icons\":[{{\"src\":\"{icon}\",\"sizes\":\"267x260\",\"type\":\"image/png\",\"purpose\":\"any\"}}]}}"
            );
            respond(&mut socket, "200 OK", "application/manifest+json; charset=utf-8", body.as_bytes()).await;
        }
        "/ping" => respond(&mut socket, "204 No Content", "text/plain", b"").await,
        "/k" => {
            match query_of(query, "k") {
                Some(k) if KEYS.contains(&k.as_str()) => {
                    emit("remote://key", k);
                    respond(&mut socket, "204 No Content", "text/plain", b"").await;
                }
                _ => respond(&mut socket, "400 Bad Request", "text/plain", b"").await,
            }
        }
        "/txt" => {
            let v: String = query_of(query, "v").unwrap_or_default().chars().take(MAX_TEXT_CHARS).collect();
            emit("remote://text", v);
            respond(&mut socket, "204 No Content", "text/plain", b"").await;
        }
        _ => respond(&mut socket, "404 Not Found", "text/plain", b"").await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_and_plus() {
        assert_eq!(percent_decode("a+b%20c"), "a b c");
        assert_eq!(percent_decode("%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82"), "привет");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn finds_query_values() {
        assert_eq!(query_of("t=abc&k=Enter", "k").as_deref(), Some("Enter"));
        assert_eq!(query_of("t=abc", "k"), None);
    }

    #[test]
    fn every_allowed_key_is_a_single_known_name() {
        assert!(KEYS.contains(&"Enter") && !KEYS.contains(&"Delete"));
    }

    /// One GET against a running server; returns the status line and the body.
    async fn get(port: u16, target: &str) -> (String, String) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(format!("GET {target} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()).await.unwrap();
        let mut out = Vec::new();
        s.read_to_end(&mut out).await.unwrap();
        let text = String::from_utf8_lossy(&out).into_owned();
        let status = text.lines().next().unwrap_or("").to_string();
        let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (status, body)
    }

    #[tokio::test]
    async fn the_server_serves_the_page_and_passes_only_known_keys_with_the_token() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let got: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = got.clone();
        let emit: Emit = Arc::new(move |name, payload| sink.lock().unwrap().push((name.to_string(), payload)));
        let theme = Arc::new(Mutex::new(String::new()));
        *theme.lock().unwrap() = r##"{"--accent":"#112233","--evil":"red;}</style>"}"##.to_string();
        let (stop, stop_rx) = watch::channel(false);
        tokio::spawn(serve(listener, emit, "secret12".into(), theme, stop_rx));

        let (status, body) = get(port, "/?t=secret12").await;
        assert!(status.contains("200") && body.contains("KINONYX"), "{status}");
        assert!(get(port, "/").await.0.contains("403"), "no token");
        assert!(get(port, "/?t=wrong").await.0.contains("403"), "wrong token");
        assert!(get(port, "/k?t=secret12&k=Enter").await.0.contains("204"));
        assert!(get(port, "/k?t=secret12&k=Delete").await.0.contains("400"), "unknown key refused");
        assert!(get(port, "/k?k=Enter").await.0.contains("403"), "key without token refused");
        assert!(get(port, "/txt?t=secret12&v=%D0%BF%D1%80+%D0%B8").await.0.contains("204"));
        assert!(get(port, "/nope?t=secret12").await.0.contains("404"));
        let (status, body) = get(port, "/?t=secret12").await;
        assert!(status.contains("200") && body.contains("--accent:#112233;"), "the page carries the app's colours");
        assert!(!body.contains("</style>red"), "nothing but safe values is let into the page");
        assert!(get(port, "/theme?t=secret12").await.1.contains("#112233"));
        let (status, _) = get(port, "/logo.png?t=secret12").await;
        assert!(status.contains("200"));
        assert!(get(port, "/logo.png").await.0.contains("403"));
        let (status, manifest) = get(port, "/manifest.json?t=secret12").await;
        assert!(status.contains("200") && manifest.contains("\"start_url\":\"/?t=secret12\"") && manifest.contains("standalone"), "{status} {manifest}");
        assert!(get(port, "/manifest.json").await.0.contains("403"), "the manifest carries the secret, so it needs it too");
        let _ = stop.send(true);

        let got = got.lock().unwrap().clone();
        assert_eq!(got, vec![("remote://key".to_string(), "Enter".to_string()), ("remote://text".to_string(), "пр и".to_string())]);
    }

    #[test]
    fn qr_is_drawn() {
        let svg = qr_svg("http://192.168.0.5:47815/?t=abcdefgh");
        assert!(svg.starts_with("<svg") && svg.contains("<path"));
    }
}
