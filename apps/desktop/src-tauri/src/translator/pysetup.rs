//! Sets up the voice runtime: the embeddable Python 3.10 from python.org (already unpacked into
//! `engines/voice`), pip, then PyTorch (CUDA 12.8 build — covers RTX 20xx through 50xx) and
//! OmniVoice from the official package indexes. Nothing is installed system-wide and the
//! user's own Python, if any, is never touched.
//!
//! pip itself has no machine-readable progress, so the download phase runs in two steps —
//! `pip download` into a folder (with TEMP pointed inside it) while we watch that folder
//! grow, then an offline `pip install` from it.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use super::catalog;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Exactly what was tested together. `torch`/`torchaudio` come from PyTorch's CUDA index.
const REQUIREMENTS: &[&str] = &[
    "torch==2.11.0",
    "torchaudio==2.11.0",
    "omnivoice==0.2.1",
    "transformers==5.17.0",
    "sherpa-onnx==1.13.8",
    "soundfile",
];
const TORCH_INDEX: &str = "https://download.pytorch.org/whl/cu128";
const PYPI: &str = "https://pypi.org/simple";

fn log_path() -> PathBuf {
    let dir = catalog::root().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("voice-setup.log")
}

fn log_tail() -> String {
    let text = std::fs::read_to_string(log_path()).unwrap_or_default();
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(3)..].join(" | ")
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// The embeddable distribution ignores site-packages until `import site` is enabled in its
/// `pythonXY._pth` — without it pip installs packages Python then can't import.
fn enable_site(dir: &Path) -> Result<(), String> {
    let pth = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|x| x == "_pth"))
        .ok_or("в архиве Python нет файла ._pth")?;
    let text = std::fs::read_to_string(&pth).map_err(|e| e.to_string())?;
    if !text.lines().any(|l| l.trim() == "import site") {
        let fixed = text.replace("#import site", "import site");
        let fixed = if fixed.contains("import site") { fixed } else { format!("{fixed}\nimport site\n") };
        std::fs::write(&pth, fixed).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Runs `python <args>` in `dir`, reporting `tick()` every half second, killing it on cancel.
async fn python(dir: &Path, args: &[&str], cancel: &AtomicBool, tick: impl Fn()) -> Result<(), String> {
    let log = std::fs::OpenOptions::new().create(true).append(true).open(log_path()).map_err(|e| e.to_string())?;
    let log2 = log.try_clone().map_err(|e| e.to_string())?;
    let tmp = dir.join("tmp");
    let _ = std::fs::create_dir_all(&tmp);
    let mut child = tokio::process::Command::new(dir.join("python.exe"))
        .args(args)
        .current_dir(dir)
        .env("TEMP", &tmp)
        .env("TMP", &tmp)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PIP_DISABLE_PIP_VERSION_CHECK", "1")
        .env_remove("PYTHONPATH")
        .env_remove("PYTHONHOME")
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(log2)
        .creation_flags(CREATE_NO_WINDOW)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Не удалось запустить Python: {e}"))?;
    loop {
        tokio::select! {
            status = child.wait() => {
                let status = status.map_err(|e| e.to_string())?;
                return if status.success() { Ok(()) } else { Err(format!("установка не удалась: {}", log_tail())) };
            }
            _ = tokio::time::sleep(Duration::from_millis(500)) => {
                if cancel.load(Ordering::SeqCst) {
                    let _ = child.kill().await;
                    return Err("cancelled".into());
                }
                tick();
            }
        }
    }
}

pub async fn run(dir: &Path, expected: u64, cancel: &AtomicBool, progress: impl Fn(u64, &'static str)) -> Result<(), String> {
    let _ = std::fs::write(log_path(), "");
    enable_site(dir)?;

    progress(0, "Устанавливаю pip…");
    python(dir, &["get-pip.py", "--no-warn-script-location"], cancel, || {}).await?;

    let wheels = dir.join("wheels");
    let base = dir_size(dir);
    let mut download: Vec<&str> = vec![
        "-m", "pip", "download", "--dest", "wheels", "--progress-bar", "off",
        "--index-url", TORCH_INDEX, "--extra-index-url", PYPI,
    ];
    download.extend_from_slice(REQUIREMENTS);
    let stage = "Скачиваю PyTorch и OmniVoice…";
    progress(0, stage);
    python(dir, &download, cancel, || {
        let grown = dir_size(dir).saturating_sub(base);
        progress(grown.min(expected * 97 / 100), stage);
    })
    .await?;

    let stage = "Устанавливаю…";
    progress(expected * 97 / 100, stage);
    let mut install: Vec<&str> = vec!["-m", "pip", "install", "--no-index", "--find-links", "wheels", "--no-warn-script-location"];
    install.extend_from_slice(REQUIREMENTS);
    python(dir, &install, cancel, || {}).await?;

    progress(expected * 99 / 100, "Проверяю…");
    python(dir, &["-c", "import torch, omnivoice, sherpa_onnx; assert torch.cuda.is_available(), 'CUDA недоступна'"], cancel, || {})
        .await
        .map_err(|e| format!("PyTorch не видит видеокарту NVIDIA: {e}"))?;

    let _ = std::fs::remove_dir_all(&wheels);
    let _ = std::fs::remove_dir_all(dir.join("tmp"));
    let _ = std::fs::remove_file(dir.join("get-pip.py"));
    std::fs::write(dir.join(".installed"), REQUIREMENTS.join("\n")).map_err(|e| e.to_string())?;
    Ok(())
}
