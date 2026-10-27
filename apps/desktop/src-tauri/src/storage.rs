//! «Хранилище»: what the program keeps on the disk and what of it can be cleared. The caches (pictures, answers of the metadata
//! sources, the TV guide, the logs) are only a convenience — they come back on their own; the rest (the viewer's data, the
//! translator's models, TorrServer's own files) is shown but left alone.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct StorageItem {
    pub key: String,
    pub label: String,
    pub hint: String,
    pub bytes: u64,
    pub clearable: bool,
}

fn dir_size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else { return 0 };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    fs::read_dir(path).map(|rd| rd.flatten().map(|e| dir_size(&e.path())).sum()).unwrap_or(0)
}

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

struct Place {
    key: &'static str,
    label: &'static str,
    hint: &'static str,
    path: PathBuf,
    clearable: bool,
}

fn places(app: &tauri::AppHandle) -> Vec<Place> {
    let cache = app.path().app_cache_dir().unwrap_or_default();
    let data = app.path().app_data_dir().unwrap_or_default();
    let home = home_dir().join(".kinonyx");
    vec![
        Place { key: "images", label: "Постеры и кадры", hint: "Скачаются снова, когда понадобятся.", path: cache.join("img"), clearable: true },
        Place { key: "kp", label: "Ответы Кинопоиска", hint: "Описания, кадры, актёры, подборки.", path: cache.join("kp"), clearable: true },
        Place { key: "tmdb", label: "Ответы TMDB", hint: "То же для источника TMDB.", path: cache.join("tmdb"), clearable: true },
        Place { key: "epg", label: "Программа передач", hint: "Скачается заново при следующем открытии каналов.", path: cache.join("epg"), clearable: true },
        Place { key: "logs", label: "Журналы", hint: "Записи для поиска ошибок.", path: home.join("logs"), clearable: true },
        Place { key: "userdata", label: "Копия ваших данных", hint: "Избранное, прогресс, настройки. Не очищается.", path: home.join("userdata"), clearable: false },
        Place { key: "translator", label: "Модели переводчика", hint: "Удаляются в настройках каналов.", path: home.join("translator"), clearable: false },
        Place { key: "torrserve", label: "TorrServer", hint: "Служебные файлы торрент-сервера.", path: data.join("torrserve"), clearable: false },
        Place { key: "webview", label: "Данные окна программы", hint: "Профиль встроенного браузера. Не очищается.", path: cache.join("EBWebView"), clearable: false },
    ]
}

#[tauri::command]
pub async fn storage_usage(app: tauri::AppHandle) -> Vec<StorageItem> {
    let list = places(&app);
    tauri::async_runtime::spawn_blocking(move || {
        list.into_iter()
            .map(|p| StorageItem { key: p.key.into(), label: p.label.into(), hint: p.hint.into(), bytes: dir_size(&p.path), clearable: p.clearable })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Empties one of the clearable places; returns how many bytes it freed.
#[tauri::command]
pub async fn storage_clear(app: tauri::AppHandle, key: String) -> Result<u64, String> {
    let place = places(&app).into_iter().find(|p| p.key == key && p.clearable).ok_or("Это место очищать нельзя")?;
    tauri::async_runtime::spawn_blocking(move || {
        let before = dir_size(&place.path);
        let Ok(rd) = fs::read_dir(&place.path) else { return Ok(0) };
        for entry in rd.flatten() {
            let p = entry.path();
            // The log being written right now is emptied rather than deleted.
            if place.key == "logs" && p.file_name().is_some_and(|n| n == "kinonyx.log") {
                let _ = fs::OpenOptions::new().write(true).truncate(true).open(&p);
                continue;
            }
            let _ = if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
        }
        Ok(before.saturating_sub(dir_size(&place.path)))
    })
    .await
    .map_err(|e: tauri::Error| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::dir_size;

    #[test]
    fn counts_files_in_nested_folders() {
        let root = std::env::temp_dir().join("kinonyx_storage_test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::write(root.join("x.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(root.join("a/b/y.bin"), vec![0u8; 250]).unwrap();
        assert_eq!(dir_size(&root), 350);
        assert_eq!(dir_size(&root.join("missing")), 0);
        let _ = std::fs::remove_dir_all(&root);
    }
}
