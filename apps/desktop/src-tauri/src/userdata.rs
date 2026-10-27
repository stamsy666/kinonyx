//! A copy of what the viewer has built up in the app — favourites, what they are watching, progress, statistics,
//! playlists, settings — outside the WebView's own profile, which an update, a reinstall with "delete the app's data"
//! or a "cleaner" can take away. The page gathers its `kinonyx.*` keys into one JSON text and hands it over here; at
//! launch, if the profile came up empty, it asks for the text back (`data/userdata.ts`).
//!
//! `%USERPROFILE%\.kinonyx\userdata\userdata.json` is the latest; before it is replaced, the previous one is kept as
//! `userdata.1.json` … `userdata.3.json` (at most one new backup an hour).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const KEEP: usize = 3;
const BACKUP_EVERY: Duration = Duration::from_secs(3600);
const MAX_BYTES: usize = 30_000_000;

fn dir() -> PathBuf {
    // The tests point this at a temporary folder: they must never touch a real copy.
    if let Some(over) = std::env::var_os("KINONYX_USERDATA_DIR") {
        return PathBuf::from(over);
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    home.join(".kinonyx").join("userdata")
}

fn name(n: usize) -> String {
    if n == 0 {
        "userdata.json".into()
    } else {
        format!("userdata.{n}.json")
    }
}

/// Writes through a temporary file, so a power cut mid-write never leaves half a file in place of a good one.
fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path)
}

fn rotate(dir: &Path) {
    let current = dir.join(name(0));
    let age = fs::metadata(&current).and_then(|m| m.modified()).ok().and_then(|t| SystemTime::now().duration_since(t).ok());
    // The first backup is made when the latest copy is older than an hour — a day of use leaves a few of them, not a hundred.
    if age.is_some_and(|a| a >= BACKUP_EVERY) {
        let _ = fs::remove_file(dir.join(name(KEEP)));
        for n in (1..KEEP).rev() {
            let _ = fs::rename(dir.join(name(n)), dir.join(name(n + 1)));
        }
        let _ = fs::copy(&current, dir.join(name(1)));
    }
}

#[tauri::command]
pub fn userdata_save(json: String) -> Result<(), String> {
    if json.len() > MAX_BYTES {
        return Err("userdata too large".into());
    }
    // Only text that is JSON is kept: the page can't replace a good copy with garbage.
    if serde_json::from_str::<serde_json::Value>(&json).is_err() {
        return Err("userdata is not JSON".into());
    }
    let dir = dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    rotate(&dir);
    write_atomic(&dir.join(name(0)), &json).map_err(|e| e.to_string())
}

/// The latest copy that reads as JSON (the main file, else the newest backup).
#[tauri::command]
pub fn userdata_load() -> Option<String> {
    let dir = dir();
    (0..=KEEP).find_map(|n| {
        let text = fs::read_to_string(dir.join(name(n))).ok()?;
        serde_json::from_str::<serde_json::Value>(&text).ok()?;
        Some(text)
    })
}

#[tauri::command]
pub fn userdata_dir() -> String {
    dir().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn userdata_open_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = dir();
    let _ = fs::create_dir_all(&dir);
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// «Сохранить данные в файл»: the page's JSON to the file the viewer picked.
#[tauri::command]
pub fn userdata_export(path: String, json: String) -> Result<(), String> {
    fs::write(path, json).map_err(|e| e.to_string())
}

/// «Загрузить данные из файла»: the text of the picked file, if it is JSON of a sensible size.
#[tauri::command]
pub fn userdata_import(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() as usize > MAX_BYTES {
        return Err("Файл слишком большой для файла с данными KINONYX".into());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<serde_json::Value>(&text).map_err(|_| "Это не файл с данными KINONYX".to_string())?;
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_then_load_roundtrips_and_rejects_garbage() {
        let tmp = std::env::temp_dir().join("kinonyx_userdata_test");
        let _ = fs::remove_dir_all(&tmp);
        std::env::set_var("KINONYX_USERDATA_DIR", &tmp);
        let json = r#"{"version":1,"keys":{"kinonyx.favorites":"[1,2]"}}"#.to_string();
        assert!(userdata_save("not json".into()).is_err());
        userdata_save(json.clone()).unwrap();
        assert_eq!(userdata_load().as_deref(), Some(json.as_str()));
        let _ = fs::remove_dir_all(&tmp);
    }
}
