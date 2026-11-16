//! Page → host calls. The page bundle sends `{cmd, token, ...}` through CEF's message router (`cefQuery`) and gets
//! JSON back.
//!
//! Trust: every frame gets a `cefQuery` function (ad iframes too, and CEF makes it non-deletable), so a query is
//! only served when it comes from the main frame on krunker.io and carries the per-launch secret. Only the page
//! bundle has the secret: it reads it from its prelude and deletes that global before any page script runs.

use crate::{browser, settings, VERSION};
use cef::{
    wrapper::message_router::{
        BrowserSideCallback, BrowserSideHandler, BrowserSideRouter, MessageRouterBrowserSide,
        MessageRouterBrowserSideHandlerCallbacks, MessageRouterConfig,
    },
    *,
};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};

/// 128 random bits per launch, handed to the page bundle in its prelude.
pub fn secret() -> &'static str {
    static SECRET: OnceLock<String> = OnceLock::new();
    SECRET.get_or_init(|| {
        use windows_sys::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
        let mut bytes = [0u8; 16];
        let status = unsafe {
            BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), bytes.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG)
        };
        assert_eq!(status, 0, "BCryptGenRandom failed");
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    })
}

thread_local! {
    // The router lives on the browser UI thread, where CEF calls every hook below.
    static ROUTER: Arc<BrowserSideRouter> = {
        let router = BrowserSideRouter::new(MessageRouterConfig::default());
        router.add_handler(Arc::new(Bridge), false);
        router
    };
}

pub fn on_process_message_received(
    browser: Option<Browser>,
    frame: Option<Frame>,
    source: ProcessId,
    message: Option<ProcessMessage>,
) -> bool {
    ROUTER.with(|r| r.on_process_message_received(browser, frame, source, message))
}

pub fn on_before_close(browser: Option<Browser>) {
    ROUTER.with(|r| r.on_before_close(browser));
}

pub fn on_before_browse(browser: Option<Browser>, frame: Option<Frame>) {
    ROUTER.with(|r| r.on_before_browse(browser, frame));
}

pub fn on_render_process_terminated(browser: Option<Browser>) {
    ROUTER.with(|r| r.on_render_process_terminated(browser));
}

type Callback = Arc<Mutex<dyn BrowserSideCallback>>;

fn reply(callback: &Callback, result: Result<Value, String>) {
    let callback = callback.lock().unwrap();
    match result {
        Ok(value) => callback.success_str(&value.to_string()),
        Err(error) => callback.failure(1, &error),
    }
}

struct Bridge;

impl BrowserSideHandler for Bridge {
    fn on_query_str(
        &self,
        browser: Option<Browser>,
        frame: Option<Frame>,
        _query_id: i64,
        request: &str,
        _persistent: bool,
        callback: Callback,
    ) -> bool {
        let trusted = frame.as_ref().is_some_and(|f| {
            f.is_main() != 0 && CefString::from(&f.url()).to_string().starts_with(browser::HOME)
        });
        let request: Value = serde_json::from_str(request).unwrap_or_default();
        if !trusted || request["token"].as_str() != Some(secret()) {
            callback.lock().unwrap().failure(403, "forbidden");
            return true;
        }
        let cmd = request["cmd"].as_str().unwrap_or_default().to_owned();
        match cmd.as_str() {
            // These touch the window or the shell: run them here on the UI thread.
            "window.attention" => reply(&callback, crate::attention::attention(&request)),
            "shell.open" => reply(&callback, open_url(&request)),
            // DevTools methods must be called on the UI thread; this one only queues a message.
            "perf.cpuThrottle" => reply(&callback, crate::perf::cpu_throttle(browser.as_ref(), &request)),
            "app.restart" => {
                reply(&callback, Ok(Value::Null));
                browser::restart(request["safe"].as_bool().unwrap_or(false));
            }
            "app.quit" => {
                reply(&callback, Ok(Value::Null));
                browser::with_main_window(|w| w.close());
            }
            "update.install" => reply(&callback, crate::update::install()),
            // Everything else may touch the disk: keep it off the UI thread, which forwards mouse input.
            _ => {
                std::thread::spawn(move || reply(&callback, command(&cmd, &request)));
            }
        }
        true
    }
}

/// Each feature area keeps its commands in its own file, under its own prefix ("files.list" → files.rs).
fn route(cmd: &str, request: &Value) -> Option<Result<Value, String>> {
    Some(match cmd.split_once('.')?.0 {
        "files" => crate::files::command(cmd, request),
        "discord" => crate::discord::command(cmd, request),
        "media" => crate::media::command(cmd, request),
        "mods" => crate::mods::command(cmd, request),
        "accounts" => crate::accounts::command(cmd, request),
        "net" => crate::net::command(cmd, request),
        "update" => crate::update::command(cmd, request),
        "diag" => crate::diag::command(cmd, request),
        "perf" => crate::perf::command(cmd, request),
        "system" => crate::system::command(cmd, request),
        _ => return None,
    })
}

fn command(cmd: &str, request: &Value) -> Result<Value, String> {
    if let Some(result) = route(cmd, request) {
        return result;
    }
    match cmd {
        "app.info" => Ok(json!({ "version": VERSION, "dataDir": crate::paths::data_dir() })),
        "settings.save" => {
            let Some(map) = request["settings"].as_object() else {
                return Err("settings must be an object".into());
            };
            settings::save(map.clone()).map_err(|e| e.to_string())?;
            crate::resources::reload_blocklist();
            Ok(Value::Null)
        }
        "blocklist.defaults" => Ok(json!(crate::resources::DEFAULT_BLOCKLIST)),
        "settings.export" => {
            // A bare file name the page picked; no separators, so it can only land in Downloads.
            let name = request["name"].as_str().unwrap_or_default();
            let valid = name.ends_with(".json") && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
            if !valid || !request["settings"].is_object() {
                return Err("bad export request".into());
            }
            let path = downloads_dir().ok_or("no Downloads folder")?.join(name);
            let json = serde_json::to_vec_pretty(&request["settings"]).map_err(|e| e.to_string())?;
            std::fs::write(&path, json).map_err(|e| e.to_string())?;
            Ok(json!(path))
        }
        _ => Err(format!("unknown command {cmd}")),
    }
}

pub(crate) fn downloads_dir() -> Option<std::path::PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::{
        System::Com::CoTaskMemFree,
        UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath},
    };
    let mut raw = std::ptr::null_mut();
    let hr = unsafe { SHGetKnownFolderPath(&FOLDERID_Downloads, 0, std::ptr::null_mut(), &mut raw) };
    let path = (hr == 0).then(|| {
        let len = (0..).take_while(|&i| unsafe { *raw.add(i) } != 0).count();
        std::path::PathBuf::from(std::ffi::OsString::from_wide(unsafe { std::slice::from_raw_parts(raw, len) }))
    });
    unsafe { CoTaskMemFree(raw as _) };
    path
}

/// Opens a web link in the default browser. Only http(s): the page must never launch files or other schemes.
fn open_url(request: &Value) -> Result<Value, String> {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let url = request["url"].as_str().unwrap_or_default();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) links".into());
    }
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (verb, target) = (wide("open"), wide(url));
    let result = unsafe {
        ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL)
    };
    // ShellExecuteW reports success with a value above 32.
    if result as usize > 32 { Ok(Value::Null) } else { Err("could not open the link".into()) }
}
