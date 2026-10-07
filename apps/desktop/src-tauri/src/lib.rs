mod config;
mod diagnostics;
mod epg;
mod http;
mod images;
mod kinopoisk;
mod rutube;
mod tmdb;
mod torapi;
mod torrserve;
mod translator;
mod tv;
mod ytdlp;

use config::AppConfig;
use tauri::Manager;
use torrserve::TorrserveProcess;

/// The job that kills every child when the app exits (see `tie_child_processes_to_this_one`).
#[cfg(windows)]
static CHILD_JOB: std::sync::OnceLock<win32job::Job> = std::sync::OnceLock::new();

/// Called right before the updater launches the installer. The installer is a child of this
/// process, so the kill-on-close job would take it down the moment the app exits — seen in
/// practice: the update downloaded, the app closed, nothing got installed. So: stop the
/// helper processes whose files the installer must replace (TorrServer, translator models)
/// and then lift the kill-on-close limit.
#[tauri::command]
async fn prepare_for_update(app: tauri::AppHandle, translator: tauri::State<'_, translator::Translator>) -> Result<(), String> {
    translator.stop_for_update().await;
    torrserve::kill(&app);
    #[cfg(windows)]
    if let Some(job) = CHILD_JOB.get() {
        job.set_extended_limit_info(&win32job::ExtendedLimitInfo::new()).map_err(|e| e.to_string())?;
    }
    // Let the killed processes release their files.
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    tie_child_processes_to_this_one();

    tauri::Builder::default()
        .plugin(tauri_plugin_libmpv::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("kpimg", |ctx, request, responder| {
            images::handle(ctx, request, responder)
        })
        .manage(TorrserveProcess(std::sync::Mutex::new(None)))
        .manage(translator::Translator::default())
        .setup(|app| {
            app.manage(AppConfig::load(app.path().app_config_dir().ok(), app.path().app_cache_dir().ok()));
            torrserve::spawn(app.handle());
            // The window starts hidden and the page shows it after its first paint
            // (main.tsx). Safety net so a broken page load can't leave it invisible forever.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ytdlp::resolve_trailer_url,
            prepare_for_update,
            config::config_status,
            config::set_torapi_base_url,
            config::set_kinopoisk_api_key,
            config::set_tmdb_api_key,
            config::set_metadata_source,
            config::set_setup_done,
            diagnostics::check_source_key,
            diagnostics::run_diagnostics,
            config::set_youtube_cookies_browser,
            kinopoisk::kp_film,
            kinopoisk::kp_collection,
            kinopoisk::kp_films_filter,
            kinopoisk::kp_genres,
            kinopoisk::kp_search,
            kinopoisk::kp_images,
            kinopoisk::kp_similars,
            kinopoisk::kp_staff,
            kinopoisk::kp_person,
            kinopoisk::kp_videos,
            kinopoisk::kp_external_sources,
            torapi::torapi_search_title,
            torapi::torapi_search_id,
            torrserve::torrserve_health,
            torrserve::ts_add_magnet,
            torrserve::ts_get_torrent,
            torrserve::ts_stream_url,
            epg::fetch_epg,
            tv::fetch_bytes,
            tv::read_playlist_file,
            translator::translator_status,
            translator::translator_download,
            translator::translator_cancel_download,
            translator::translator_delete,
            translator::translator_start,
            translator::translator_stop,
            translator::translator_position,
            translator::translator_voice,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                torrserve::kill(app_handle);
            }
        });
}

/// Puts this process in a Job Object that kills every member when its last handle closes.
/// Children (the TorrServer sidecar) inherit the job, so they die with the app however it
/// ends — including a crash or a killed dev process, where `RunEvent::Exit` never runs
/// (seen in practice: an orphaned torrserve.exe kept port 8090 after the window closed).
#[cfg(windows)]
fn tie_child_processes_to_this_one() {
    use win32job::Job;
    let job = (|| -> Result<Job, win32job::JobError> {
        let job = Job::create()?;
        let mut info = job.query_extended_limit_info()?;
        info.limit_kill_on_job_close();
        job.set_extended_limit_info(&mut info)?;
        job.assign_current_process()?;
        Ok(job)
    })();
    match job {
        // The handle must stay open for the whole process lifetime — closing it is what
        // kills the members, us included. A static is never dropped.
        Ok(job) => {
            let _ = CHILD_JOB.set(job);
        }
        Err(e) => eprintln!("[job] couldn't tie child processes to the app: {e}"),
    }
}
