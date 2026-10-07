//! Minimal libmpv binding for the translator's two headless helper instances (the network
//! recorder and the audio decoder). The visible player stays on tauri-plugin-libmpv; this
//! loads the same libmpv-2.dll a second time (Windows hands back the already-loaded module)
//! and drives separate mpv handles directly — mpv supports any number per process.

use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::OnceLock;

type Handle = *mut c_void;

#[repr(C)]
struct Event {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct LogMessage {
    prefix: *const c_char,
    level: *const c_char,
    text: *const c_char,
}

pub const EVENT_SHUTDOWN: i32 = 1;
const EVENT_LOG_MESSAGE: i32 = 2;
pub const EVENT_END_FILE: i32 = 7;
pub const EVENT_PLAYBACK_RESTART: i32 = 21;

struct Api {
    _lib: libloading::Library,
    create: unsafe extern "C" fn() -> Handle,
    initialize: unsafe extern "C" fn(Handle) -> c_int,
    set_option_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    get_property_string: unsafe extern "C" fn(Handle, *const c_char) -> *mut c_char,
    command: unsafe extern "C" fn(Handle, *mut *const c_char) -> c_int,
    free: unsafe extern "C" fn(*mut c_void),
    wait_event: unsafe extern "C" fn(Handle, c_double) -> *mut Event,
    wakeup: unsafe extern "C" fn(Handle),
    request_log_messages: unsafe extern "C" fn(Handle, *const c_char) -> c_int,
    terminate_destroy: unsafe extern "C" fn(Handle),
}

static API: OnceLock<Result<Api, String>> = OnceLock::new();

fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())) {
        out.push(dir.join("lib").join("libmpv-2.dll"));
        out.push(dir.join("libmpv-2.dll"));
    }
    out
}

fn api() -> Result<&'static Api, String> {
    API.get_or_init(|| {
        let path = candidates().into_iter().find(|p| p.exists()).ok_or("libmpv-2.dll не найден рядом с программой")?;
        unsafe {
            let lib = libloading::Library::new(&path).map_err(|e| format!("libmpv: {e}"))?;
            macro_rules! sym {
                ($name:literal) => {
                    *lib.get(concat!($name, "\0").as_bytes()).map_err(|e| format!("libmpv {}: {e}", $name))?
                };
            }
            Ok(Api {
                create: sym!("mpv_create"),
                initialize: sym!("mpv_initialize"),
                set_option_string: sym!("mpv_set_option_string"),
                set_property_string: sym!("mpv_set_property_string"),
                get_property_string: sym!("mpv_get_property_string"),
                command: sym!("mpv_command"),
                free: sym!("mpv_free"),
                wait_event: sym!("mpv_wait_event"),
                wakeup: sym!("mpv_wakeup"),
                request_log_messages: sym!("mpv_request_log_messages"),
                terminate_destroy: sym!("mpv_terminate_destroy"),
                _lib: lib,
            })
        }
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// One mpv core. The client API is thread-safe, so a handle may be shared across threads;
/// `wait_event` must only be called from one of them (the owner's event loop).
pub struct Mpv {
    h: Handle,
    name: &'static str,
}

unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

fn cstr(s: &str) -> CString {
    CString::new(s.replace('\0', "")).unwrap_or_default()
}

impl Mpv {
    pub fn new(name: &'static str, options: &[(&str, String)]) -> Result<Self, String> {
        let api = api()?;
        let h = unsafe { (api.create)() };
        if h.is_null() {
            return Err("mpv_create failed".into());
        }
        let mpv = Mpv { h, name };
        // Isolated from the user's own mpv setup: no config files, scripts or key bindings.
        let base = [("config", "no"), ("load-scripts", "no"), ("ytdl", "no"), ("input-default-bindings", "no"), ("osc", "no")];
        for (k, v) in base.iter().map(|(k, v)| (*k, v.to_string())).chain(options.iter().map(|(k, v)| (*k, v.clone()))) {
            let rc = unsafe { (api.set_option_string)(h, cstr(k).as_ptr(), cstr(&v).as_ptr()) };
            if rc < 0 {
                eprintln!("[translator/{name}] option {k}={v} rejected ({rc})");
            }
        }
        if unsafe { (api.initialize)(h) } < 0 {
            return Err("mpv_initialize failed".into());
        }
        // The recorder decodes only keyframes, and a broken stretch of broadcast audio makes
        // the decoder log every single frame — only fatal errors are worth a line.
        unsafe { (api.request_log_messages)(h, cstr("fatal").as_ptr()) };
        Ok(mpv)
    }

    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        let api = api()?;
        let owned: Vec<CString> = args.iter().map(|a| cstr(a)).collect();
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let rc = unsafe { (api.command)(self.h, ptrs.as_mut_ptr()) };
        if rc < 0 {
            Err(format!("mpv command {:?} failed ({rc})", args.first()))
        } else {
            Ok(())
        }
    }

    pub fn set(&self, prop: &str, value: &str) -> Result<(), String> {
        let api = api()?;
        let rc = unsafe { (api.set_property_string)(self.h, cstr(prop).as_ptr(), cstr(value).as_ptr()) };
        if rc < 0 {
            Err(format!("mpv set {prop} failed ({rc})"))
        } else {
            Ok(())
        }
    }

    pub fn get(&self, prop: &str) -> Option<String> {
        let api = api().ok()?;
        let p = unsafe { (api.get_property_string)(self.h, cstr(prop).as_ptr()) };
        if p.is_null() {
            return None;
        }
        let s = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { (api.free)(p as *mut c_void) };
        Some(s)
    }

    pub fn get_f64(&self, prop: &str) -> Option<f64> {
        self.get(prop)?.parse().ok()
    }

    /// Blocks up to `timeout` seconds; returns (event id, error code). Log messages are
    /// printed here rather than returned — they're diagnostics, not control flow.
    pub fn wait_event(&self, timeout: f64) -> (i32, i32) {
        let Ok(api) = api() else { return (EVENT_SHUTDOWN, 0) };
        let ev = unsafe { &*(api.wait_event)(self.h, timeout) };
        if ev.event_id == EVENT_LOG_MESSAGE && !ev.data.is_null() {
            let m = unsafe { &*(ev.data as *const LogMessage) };
            let text = |p: *const c_char| if p.is_null() { String::new() } else { unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned() };
            eprintln!("[translator/{} {}] {}", self.name, text(m.prefix), text(m.text).trim_end());
        }
        (ev.event_id, ev.error)
    }

    pub fn wakeup(&self) {
        if let Ok(api) = api() {
            unsafe { (api.wakeup)(self.h) };
        }
    }
}

impl Drop for Mpv {
    fn drop(&mut self) {
        if let Ok(api) = api() {
            // Blocks until the core has shut down — callers drop this off the async runtime.
            unsafe { (api.terminate_destroy)(self.h) };
        }
    }
}
