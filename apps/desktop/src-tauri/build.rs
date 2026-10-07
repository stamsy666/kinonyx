use std::{env, fs, path::PathBuf};

fn main() {
    tauri_build::build();
    copy_native_libs();
}

/// tauri-plugin-libmpv looks for libmpv-wrapper.dll (and, next to it,
/// libmpv-2.dll) beside the running executable — which for `cargo build`/
/// `tauri dev` is `target/<profile>/`, not this crate's own `lib/` folder
/// (that one only ends up next to the exe via the `bundle.resources` config,
/// and only for a packaged build). Ported as-is from PortoTV, where a
/// missing copy step here caused playback to silently break after a
/// `cargo clean` or profile switch.
fn copy_native_libs() {
    println!("cargo:rerun-if-changed=lib");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let src_dir = manifest_dir.join("lib");
    let Ok(entries) = fs::read_dir(&src_dir) else {
        return;
    };

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    // OUT_DIR is target/<profile>/build/<crate>-<hash>/out — the exe itself
    // lives three levels up, at target/<profile>/.
    let Some(profile_dir) = out_dir.ancestors().nth(3) else {
        return;
    };

    for entry in entries.flatten() {
        let src = entry.path();
        if !src.is_file() {
            continue;
        }
        let Some(name) = src.file_name() else { continue };
        let dest = profile_dir.join(name);
        if let Err(e) = fs::copy(&src, &dest) {
            println!(
                "cargo:warning=Failed to copy {} to {}: {e}",
                src.display(),
                dest.display()
            );
        }
    }
}
