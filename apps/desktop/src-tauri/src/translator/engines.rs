//! whisper-server (speech recognition), llama-server (translation) and the voice-over server
//! (OmniVoice, bundled `tts_server.py` on the downloaded Python) child processes.
//!
//! Started on the first translation session and kept alive across channel switches — loading
//! the models takes several seconds, which would otherwise be paid on every zap. Both inherit
//! the app's kill-on-close job object (lib.rs), so they never outlive KINONYX.

use std::net::TcpStream;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use super::catalog::{self, Item};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct Server {
    child: Child,
    port: u16,
    model: &'static str,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct Engines {
    asr: Mutex<Option<Server>>,
    mt: Mutex<Option<Server>>,
    tts: Mutex<Option<Server>>,
}

fn free_port() -> Result<u16, String> {
    let l = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(l.local_addr().map_err(|e| e.to_string())?.port())
}

fn logs_dir() -> PathBuf {
    let dir = catalog::root().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// whisper-server.exe and the VAD model ship with the app (bundle resource `translator/`).
pub fn bundled(app: &AppHandle, file: &str) -> Option<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(r) = app.path().resource_dir() {
        dirs.push(r.join("translator"));
    }
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        dirs.push(exe_dir.join("translator"));
    }
    // `tauri dev` runs from target/debug without the bundle layout.
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("translator"));
    dirs.into_iter().map(|d| d.join(file)).find(|p| p.is_file())
}

fn spawn(exe: &Path, args: &[String], log_name: &str) -> Result<Child, String> {
    // CUDA runtime DLLs live in the engine folder; whisper-server needs them on its path too.
    let path = format!("{};{}", catalog::engine_dir().display(), std::env::var("PATH").unwrap_or_default());
    let mut cmd = Command::new(exe);
    cmd.env("PATH", path).current_dir(catalog::engine_dir());
    spawn_cmd(cmd, exe, args, log_name)
}

fn spawn_cmd(mut cmd: Command, exe: &Path, args: &[String], log_name: &str) -> Result<Child, String> {
    let log = std::fs::File::create(logs_dir().join(log_name)).map_err(|e| e.to_string())?;
    let log2 = log.try_clone().map_err(|e| e.to_string())?;
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(log2)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Не удалось запустить {}: {e}", exe.display()))
}

fn log_tail(log_name: &str) -> String {
    let text = std::fs::read_to_string(logs_dir().join(log_name)).unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(4)..].join(" | ")
}

async fn wait_ready(server: &mut Server, log_name: &str, health_path: Option<&str>) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(180);
    let client = reqwest::Client::new();
    while Instant::now() < deadline {
        if let Ok(Some(status)) = server.child.try_wait() {
            return Err(format!("процесс завершился ({status}): {}", log_tail(log_name)));
        }
        let up = match health_path {
            Some(path) => client
                .get(format!("http://127.0.0.1:{}{path}", server.port))
                .timeout(Duration::from_secs(2))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false),
            None => TcpStream::connect_timeout(&([127, 0, 0, 1], server.port).into(), Duration::from_millis(300)).is_ok(),
        };
        if up {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    Err(format!("не запустился за 3 минуты: {}", log_tail(log_name)))
}

fn require(item: &Item) -> Result<(), String> {
    if catalog::installed(item) {
        Ok(())
    } else {
        Err(format!("«{}» не установлен — скачайте в настройках", item.title))
    }
}

impl Engines {
    /// Port of a whisper-server running `model`, starting (or restarting) it if needed.
    pub async fn asr(&self, app: &AppHandle, model: &'static Item) -> Result<u16, String> {
        let mut slot = self.asr.lock().await;
        if let Some(s) = slot.as_mut() {
            if s.model == model.id && matches!(s.child.try_wait(), Ok(None)) {
                return Ok(s.port);
            }
        }
        *slot = None;
        require(catalog::item("engine-cuda").unwrap())?;
        require(model)?;
        let exe = bundled(app, "whisper-server.exe").ok_or("whisper-server.exe не найден в папке программы")?;
        let vad = bundled(app, "ggml-silero-v6.2.0.bin").ok_or("модель VAD не найдена в папке программы")?;
        let port = free_port()?;
        let args: Vec<String> = [
            "-m", &catalog::item_path(model).to_string_lossy(),
            "--host", "127.0.0.1",
            "--port", &port.to_string(),
            "-t", "4",
            "-vm", &vad.to_string_lossy(),
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let log = "whisper-server.log";
        let mut server = Server { child: spawn(&exe, &args, log)?, port, model: model.id };
        wait_ready(&mut server, log, None).await.map_err(|e| format!("Распознавание речи: {e}"))?;
        *slot = Some(server);
        Ok(port)
    }

    /// Port of a llama-server running `model`, starting (or restarting) it if needed.
    pub async fn mt(&self, model: &'static Item) -> Result<u16, String> {
        let mut slot = self.mt.lock().await;
        if let Some(s) = slot.as_mut() {
            if s.model == model.id && matches!(s.child.try_wait(), Ok(None)) {
                return Ok(s.port);
            }
        }
        *slot = None;
        require(catalog::item("engine-cuda").unwrap())?;
        require(model)?;
        let exe = catalog::engine_dir().join("llama-server.exe");
        let port = free_port()?;
        let args: Vec<String> = [
            "-m", &catalog::item_path(model).to_string_lossy(),
            "--host", "127.0.0.1",
            "--port", &port.to_string(),
            "-ngl", "99",
            "-c", "4096",
            "-np", "1",
            "-fa", "on",
            "--no-webui",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let log = "llama-server.log";
        let mut server = Server { child: spawn(&exe, &args, log)?, port, model: model.id };
        wait_ready(&mut server, log, Some("/health")).await.map_err(|e| format!("Переводчик: {e}"))?;
        *slot = Some(server);
        Ok(port)
    }

    /// Port of the voice-over server, starting it if needed. Loading OmniVoice and warming it
    /// up takes ~15–30 s, so it's only started once voice-over is actually switched on.
    pub async fn tts(&self, app: &AppHandle) -> Result<u16, String> {
        let mut slot = self.tts.lock().await;
        if let Some(s) = slot.as_mut() {
            if matches!(s.child.try_wait(), Ok(None)) {
                return Ok(s.port);
            }
        }
        *slot = None;
        let runtime = catalog::item("voice-runtime").unwrap();
        let model = catalog::item("voice-omnivoice").unwrap();
        require(runtime)?;
        require(model)?;
        let script = bundled(app, "tts_server.py").ok_or("tts_server.py не найден в папке программы")?;
        let model_dir = catalog::item_dir(model);
        let port = free_port()?;
        let args: Vec<String> = vec![
            "-u".into(),
            script.to_string_lossy().into_owned(),
            "--port".into(),
            port.to_string(),
            "--model".into(),
            model_dir.to_string_lossy().into_owned(),
            "--speaker-model".into(),
            model_dir.join(catalog::SPEAKER_MODEL).to_string_lossy().into_owned(),
        ];
        let exe = catalog::voice_dir().join("python.exe");
        let mut cmd = Command::new(&exe);
        cmd.current_dir(catalog::voice_dir())
            .env("PYTHONIOENCODING", "utf-8")
            .env("HF_HUB_OFFLINE", "1")
            .env("TRANSFORMERS_OFFLINE", "1")
            .env_remove("PYTHONPATH")
            .env_remove("PYTHONHOME");
        let log = "voice-server.log";
        let mut server = Server { child: spawn_cmd(cmd, &exe, &args, log)?, port, model: model.id };
        wait_ready(&mut server, log, Some("/health")).await.map_err(|e| format!("Озвучка: {e}"))?;
        *slot = Some(server);
        Ok(port)
    }

    /// Kills only the voice-over server (the biggest memory user), keeping recognition and
    /// translation loaded.
    pub async fn stop_tts(&self) {
        *self.tts.lock().await = None;
    }

    /// Frees the GPU memory the models hold (e.g. when translation isn't used for a while).
    pub async fn stop_all(&self) {
        *self.asr.lock().await = None;
        *self.mt.lock().await = None;
        *self.tts.lock().await = None;
    }
}
