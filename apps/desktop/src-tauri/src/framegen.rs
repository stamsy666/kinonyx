use std::path::{Path, PathBuf};
use tauri::State;

pub struct FrameGeneration(Option<PathBuf>);

impl FrameGeneration {
    pub fn detect() -> Self {
        #[cfg(all(windows, target_arch = "x86_64"))]
        {
            let bundled = std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|dir| dir.join("framegen")));
            let development = cfg!(debug_assertions)
                .then(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("framegen"));
            for root in development.into_iter().chain(bundled) {
                let script = root.join("interpolate.vpy");
                let site = root.join("runtime/lib/site-packages/vapoursynth");
                let library = site.join("vsscript.dll");
                if script.is_file() && library.is_file() && root.join("runtime/kx-dlss.dll").is_file()
                    && root.join("runtime/nvngx_dlssg.dll").is_file() && root.join("runtime/python.exe").is_file()
                {
                    // Configure only this process before libmpv initialises. The library finds
                    // its private Python from the portable runtime layout, without a user install.
                    std::env::set_var("VSSCRIPT_PATH", library);
                    return Self(Some(script));
                }
            }
        }
        Self(None)
    }
}

#[tauri::command]
pub fn frame_generation_filter(multiplier: u8, state: State<'_, FrameGeneration>) -> Result<String, String> {
    if !matches!(multiplier, 2 | 3) {
        return Err("Выберите множитель ×2 или ×3.".into());
    }
    let Some(script) = state.0.as_deref().and_then(Path::to_str) else {
        return Err("Для DLSS Frame Generation нужен установленный пакет DLSS для KINONYX.".into());
    };
    // mpv's fixed-length quoting counts UTF-8 bytes and also accepts colons in Windows paths.
    Ok(format!(
        "@kinonyx-framegen:vapoursynth=file=%{}%{}:buffered-frames=6:concurrent-frames=1:user-data={multiplier}",
        script.len(), script,
    ))
}
