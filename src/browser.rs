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

thread_local! {
    // UI thread only.
    static MAIN_WINDOW: RefCell<Option<Window>> = const { RefCell::new(None) };
}

pub fn run(args: &args::Args, app: &mut App, sandbox_info: *mut u8) -> i32 {
    settings::load();
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
        return 1;
    }
    run_message_loop();
    shutdown();

    // Relaunch only after shutdown: until then the profile is locked and a new instance would hand off to us.
    if RESTART.load(Ordering::Relaxed)
        && let Ok(exe) = std::env::current_exe()
    {
        let _ = std::process::Command::new(exe).args(std::env::args_os().skip(1)).spawn();
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

pub fn restart() {
    RESTART.store(true, Ordering::Relaxed);
    with_main_window(|w| w.close());
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

wrap_life_span_handler! {
    struct MercuryLifeSpan {}

    impl LifeSpanHandler {
        fn on_after_created(&self, _browser: Option<&mut Browser>) {
            OPEN_BROWSERS.fetch_add(1, Ordering::Relaxed);
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
            _status: TerminationStatus,
            _error_code: i32,
            _error_string: Option<&CefString>,
        ) {
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
            window.show();
            if self.main {
                window.set_title(Some(&CefString::from("Mercury Client")));
                // Chrome-style windows ignore initial_show_state, so maximize explicitly.
                window.maximize();
                MAIN_WINDOW.with(|w| *w.borrow_mut() = Some(window.clone()));
            }
        }

        fn on_window_destroyed(&self, _window: Option<&mut Window>) {
            self.browser_view.borrow_mut().take();
            if self.main {
                MAIN_WINDOW.with(|w| w.borrow_mut().take());
            }
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
