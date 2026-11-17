//! One HTTP client for the whole app. reqwest pools connections per client, so a
//! client-per-request (what this code did at first) paid a full TLS handshake on every
//! call — measured ~0.9 s of each ~1.1 s Kinopoisk request; over a reused connection the
//! same request takes ~0.25 s.

use std::sync::LazyLock;
use std::time::Duration;

pub static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("KINONYX/0.1")
        .pool_idle_timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .expect("failed to build HTTP client")
});

/// For the programs this app starts on the same computer (TorrServer, the translator's engines): never through a
/// proxy. `CLIENT` follows the system proxy like every reqwest client, and with a VPN or proxy switched on (the
/// system settings or `HTTP_PROXY`) it sent even `127.0.0.1` requests there — TorrServer was running ("Start http
/// server at :8090" in its output) yet the app took it for dead because the answers never came back.
static LOCAL: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .no_proxy()
        .user_agent("KINONYX/0.1")
        .connect_timeout(Duration::from_secs(5))
        .build()
        .expect("failed to build local HTTP client")
});

pub fn local() -> reqwest::Client {
    LOCAL.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A dead proxy in the environment (what a half-working VPN looks like to the app) must not touch loopback requests.
    #[tokio::test]
    async fn local_client_ignores_the_proxy() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = listener.accept().await {
                let mut buf = [0u8; 512];
                let _ = s.read(&mut buf).await;
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await;
            }
        });
        // Nothing listens on port 9: every request sent through this "proxy" fails.
        std::env::set_var("HTTP_PROXY", "http://127.0.0.1:9");
        let url = format!("http://127.0.0.1:{port}/echo");

        let through_proxy = reqwest::Client::new().get(&url).timeout(Duration::from_secs(3)).send().await;
        assert!(through_proxy.is_err(), "a default client should have gone to the dead proxy");

        let direct = local().get(&url).timeout(Duration::from_secs(3)).send().await.expect("the local client must reach the server");
        assert!(direct.status().is_success());
    }
}
