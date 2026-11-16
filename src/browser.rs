//! The browser process: the window, popups, the page script handed to renderers, restart and safe mode.

use crate::{bridge, paths, settings, VERSION};
use cef::*;
use std::{
    cell::RefCell,
    fs,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};

pub const HOME: &str = "https://krunker.io/";

static OPEN_BROWSERS: AtomicUsize = AtomicUsize::new(0);
static RESTART: AtomicBool = AtomicBool::new(false);
static RESTART_SAFE: AtomicBool = AtomicBool::new(false);
/// The previous run never reached a clean shutdown (crash, killed, power loss).
static UNCLEAN_EXIT: AtomicBool = AtomicBool::new(false);

thread_local! {
    // UI thread only.
    static MAIN_WINDOW: RefCell<Option<Window>> = const { RefCell::new(None) };
}

pub fn run(args: &args::Args, app: &mut App, sandbox_info: *mut u8) -> i32 {
    crate::log::install_panic_hook();
    settings::load();
    let safe = std::env::args().any(|a| a == "--safe-mode");
    // Before initialize: Chromium may launch the GPU process during it.
    crate::perf::create_shared(safe);
    // Before Chromium reads any raw input (freeze_fix.rs explains why).
    if !safe && settings::bool("engine.freezeFix", true) {
        match crate::freeze_fix::install() {
            Ok(slots) => crate::log::line(&format!("aim freeze fix on ({slots} import slot)")),
            Err(e) => crate::log::line(&format!("aim freeze fix not installed: {e}")),
        }
    }
    // After a crash, Chrome's session restore reopens the last page in a window Mercury doesn't manage (no page
    // script, no blocklist). Mercury always opens its own window, so the saved sessions go before Chromium starts.
    if let Some(dir) = paths::profile_dir() {
        for name in ["Sessions", "Sessions_Encrypted"] {
            let _ = fs::remove_dir_all(dir.join("Default").join(name));
        }
    }
    let profile = paths::profile_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let settings = Settings {
        // An empty cache path makes CEF keep everything in memory, which is the right fallback.
        root_cache_path: CefString::from(profile.as_str()),
        cache_path: CefString::from(profile.as_str()),
        persist_session_cookies: 1,
        log_severity: LogSeverity::WARNING,
        ..Default::default()
    };
    if initialize(Some(args.as_main_args()), Some(&settings), Some(app), sandbox_info) != 1 {
        return 1; // also a second launch that handed off to the running instance
    }
    // A marker that only a clean shutdown removes: still there at the next start means the last run crashed.
    let marker = paths::data_dir().map(|d| d.join("running"));
    if let Some(marker) = &marker {
        if marker.exists() {
            UNCLEAN_EXIT.store(true, Ordering::Relaxed);
            crate::log::line("the previous run did not close cleanly");
        }
        let _ = fs::create_dir_all(marker.parent().unwrap_or(marker));
        let _ = fs::write(marker, "");
    }
    // Only now: a second launch hands off to the running instance inside initialize and returns above.
    crate::perf::start(safe);
    run_message_loop();
    shutdown();
    if let Some(marker) = &marker {
        let _ = fs::remove_file(marker);
    }
    crate::perf::stop();

    // Relaunch only after shutdown: until then the profile is locked and a new instance would hand off to us.
    if RESTART.load(Ordering::Relaxed)
        && let Ok(exe) = std::env::current_exe()
    {
        let mut args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).filter(|a| a != "--safe-mode").collect();
        if RESTART_SAFE.load(Ordering::Relaxed) {
            args.push("--safe-mode".into());
        }
        let _ = std::process::Command::new(exe).args(args).spawn();
    }
    0
}

/// `--safe-mode`: no page script, no custom engine flags. For when a setting or a script breaks the client.
pub fn safe_mode(command_line: &CommandLine) -> bool {
    command_line.has_switch(Some(&CefString::from("safe-mode"))) != 0
}

pub fn with_main_window<R>(f: impl FnOnce(&Window) -> R) -> Option<R> {
    MAIN_WINDOW.with(|w| w.borrow().as_ref().map(f))
}

/// Closes Mercury and starts it again, in safe mode if asked.
pub fn restart(safe: bool) {
    RESTART.store(true, Ordering::Relaxed);
    RESTART_SAFE.store(safe, Ordering::Relaxed);
    with_main_window(|w| w.close());
}

fn icon(png: &[u8]) -> Option<Image> {
    let image = image_create()?;
    (image.add_png(1.0, Some(png)) == 1).then_some(image)
}

/// What every krunker.io page in the main window runs first: the bridge secret, the settings and the bundle.
fn page_script() -> String {
    let safe = command_line_get_global().is_some_and(|c| safe_mode(&c));
    let bundle = if safe {
        String::new()
    } else {
        fs::read_to_string(paths::app_dir().join("frontend.js")).unwrap_or_default()
    };
    let prelude = serde_json::json!({
        "version": VERSION,
        "token": bridge::secret(),
        "settings": settings::all(),
        "safeMode": safe,
        "uncleanExit": UNCLEAN_EXIT.load(Ordering::Relaxed),
    });
    format!("window.__MERCURY__ = {prelude};\n{bundle}")
}

wrap_browser_process_handler! {
    pub struct MercuryBrowserProcess {}

    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            let mut client = MercuryClient::new();
            let mut delegate = MercuryBrowserView::new();
            let mut extra_info = dictionary_value_create();
            if let Some(info) = extra_info.as_mut() {
                info.set_string(Some(&CefString::from("script")), Some(&CefString::from(page_script().as_str())));
            }
            let browser_view = browser_view_create(
                Some(&mut client),
                Some(&CefString::from(HOME)),
                Some(&BrowserSettings::default()),
                extra_info.as_mut(),
                None,
                Some(&mut delegate),
            );
            let mut window = MercuryWindow::new(RefCell::new(browser_view), true);
            window_create_top_level(Some(&mut window));
        }

        // Chromium only forwards an allowlist of the browser's switches: the GPU process gets the hook's here.
        fn on_before_child_process_launch(&self, command_line: Option<&mut CommandLine>) {
            if let Some(command_line) = command_line {
                crate::perf::on_child_launch(command_line);
            }
        }

        // A second launch hands off to this instance (the profile is locked): bring our window up instead.
        fn on_already_running_app_relaunch(
            &self,
            _command_line: Option<&mut CommandLine>,
            _current_directory: Option<&CefString>,
        ) -> i32 {
            with_main_window(|w| {
                w.restore();
                w.activate();
            });
            1
        }
    }
}

wrap_client! {
    pub struct MercuryClient {}

    impl Client {
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(MercuryLifeSpan::new())
        }

        fn request_handler(&self) -> Option<RequestHandler> {
            Some(MercuryRequests::new())
        }

        fn jsdialog_handler(&self) -> Option<JsdialogHandler> {
            Some(MercuryDialogs::new())
        }

        fn on_process_message_received(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            source_process: ProcessId,
            message: Option<&mut ProcessMessage>,
        ) -> i32 {
            bridge::on_process_message_received(browser.cloned(), frame.cloned(), source_process, message.cloned()) as i32
        }
    }
}

wrap_jsdialog_handler! {
    struct MercuryDialogs {}

    impl JsdialogHandler {
        // Krunker asks "Leave site?" on unload. Closing the game client or reloading it is deliberate: no prompt.
        fn on_before_unload_dialog(
            &self,
            _browser: Option<&mut Browser>,
            _message_text: Option<&CefString>,
            _is_reload: i32,
            callback: Option<&mut JsdialogCallback>,
        ) -> i32 {
            if let Some(callback) = callback {
                callback.cont(1, None);
            }
            1
        }
    }
}

wrap_life_span_handler! {
    struct MercuryLifeSpan {}

    impl LifeSpanHandler {
        fn on_after_created(&self, _browser: Option<&mut Browser>) {
            OPEN_BROWSERS.fetch_add(1, Ordering::Relaxed);
        }

        // Lobby, map and mod links (krunker.io/?game=...) load in the game window instead of a popup.
        #[allow(clippy::too_many_arguments)]
        fn on_before_popup(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _popup_id: i32,
            target_url: Option<&CefString>,
            _target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            _user_gesture: i32,
            _popup_features: Option<&PopupFeatures>,
            _window_info: Option<&mut WindowInfo>,
            _client: Option<&mut Option<Client>>,
            _settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut i32>,
        ) -> i32 {
            if !(settings::bool("mods.enabled", true) && settings::bool("mods.linksInGame", true)) {
                return 0;
            }
            let Some(link) = target_url.and_then(|u| crate::mods::game_link(&u.to_string())) else { return 0 };
            let loaded = with_main_window(|w| {
                let frame = w.child_view_at(0)?.as_browser_view()?.browser()?.main_frame()?;
                frame.load_url(Some(&CefString::from(link.as_str())));
                w.activate();
                Some(())
            });
            loaded.flatten().is_some() as i32
        }

        fn on_before_close(&self, browser: Option<&mut Browser>) {
            bridge::on_before_close(browser.cloned());
            // Popups count too: quit when the last window of any kind closes.
            if OPEN_BROWSERS.fetch_sub(1, Ordering::Relaxed) == 1 {
                quit_message_loop();
            }
        }
    }
}

wrap_request_handler! {
    struct MercuryRequests {}

    impl RequestHandler {
        fn on_before_browse(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _request: Option<&mut Request>,
            _user_gesture: i32,
            _is_redirect: i32,
        ) -> i32 {
            bridge::on_before_browse(browser.cloned(), frame.cloned());
            0
        }

        fn on_render_process_terminated(
            &self,
            browser: Option<&mut Browser>,
            status: TerminationStatus,
            error_code: i32,
            error_string: Option<&CefString>,
        ) {
            let why = error_string.map(CefString::to_string).unwrap_or_default();
            crate::log::line(&format!("renderer ended: status {:?}, code {error_code}, {why}", sys::cef_termination_status_t::from(status)));
            bridge::on_render_process_terminated(browser.cloned());
        }

        // Blocklist and resource swapper (resources.rs), on the IO thread.
        fn resource_request_handler(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _request: Option<&mut Request>,
            _is_navigation: i32,
            _is_download: i32,
            _request_initiator: Option<&CefString>,
            _disable_default_handling: Option<&mut i32>,
        ) -> Option<ResourceRequestHandler> {
            Some(crate::resources::MercuryResources::new())
        }
    }
}

wrap_browser_view_delegate! {
    struct MercuryBrowserView {}

    impl ViewDelegate {}

    impl BrowserViewDelegate {
        // Login and social popups get their own top-level window.
        fn on_popup_browser_view_created(
            &self,
            _browser_view: Option<&mut BrowserView>,
            popup_browser_view: Option<&mut BrowserView>,
            _is_devtools: i32,
        ) -> i32 {
            let mut window = MercuryWindow::new(RefCell::new(popup_browser_view.cloned()), false);
            window_create_top_level(Some(&mut window));
            1
        }
    }
}

wrap_window_delegate! {
    struct MercuryWindow {
        browser_view: RefCell<Option<BrowserView>>,
        main: bool,
    }

    impl ViewDelegate {}

    impl PanelDelegate {}

    impl WindowDelegate {
        fn on_window_created(&self, window: Option<&mut Window>) {
            let browser_view = self.browser_view.borrow();
            let (Some(window), Some(browser_view)) = (window, browser_view.as_ref()) else {
                return;
            };
            window.add_child_view(Some(&mut View::from(browser_view)));
            // Mercury's icon in the title bar and Alt-Tab (small), and on the taskbar (large).
            if let Some(mut small) = icon(include_bytes!("../assets/brand/icon-64.png")) {
                window.set_window_icon(Some(&mut small));
            }
            if let Some(mut large) = icon(include_bytes!("../assets/brand/icon-256.png")) {
                window.set_window_app_icon(Some(&mut large));
            }
            window.show();
            if self.main {
                window.set_title(Some(&CefString::from("Mercury Client")));
                match settings::string("general.windowMode").as_str() {
                    "borderless" => window.set_fullscreen(1),
                    "windowed" => window.center_window(Some(&Size { width: 1280, height: 720 })),
                    // Chrome-style windows ignore initial_show_state, so maximize explicitly.
                    _ => window.maximize(),
                }
                MAIN_WINDOW.with(|w| *w.borrow_mut() = Some(window.clone()));
            }
        }

        fn on_window_destroyed(&self, _window: Option<&mut Window>) {
            self.browser_view.borrow_mut().take();
            if self.main {
                MAIN_WINDOW.with(|w| w.borrow_mut().take());
            }
        }

        // CEF's own defaults are true, but cef-rs defaults every unimplemented method to 0: without these the window
        // has no minimize or maximize button, can't be resized, and ignores maximize().
        fn can_resize(&self, _window: Option<&mut Window>) -> i32 {
            1
        }

        fn can_maximize(&self, _window: Option<&mut Window>) -> i32 {
            1
        }

        fn can_minimize(&self, _window: Option<&mut Window>) -> i32 {
            1
        }

        fn can_close(&self, _window: Option<&mut Window>) -> i32 {
            let browser_view = self.browser_view.borrow();
            match browser_view.as_ref().and_then(|v| v.browser()).and_then(|b| b.host()) {
                Some(host) => host.try_close_browser(),
                None => 1,
            }
        }
    }
}
