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
