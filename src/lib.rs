//! Mercury: a Krunker client on CEF. See PLAN.md.

use cef::*;
use std::{
    cell::RefCell,
    sync::atomic::{AtomicUsize, Ordering},
};

const URL: &str = "https://krunker.io/";
const INJECT: &str = include_str!("inject.js");

/// Set on the browser process, which hands them on to the GPU and renderer processes.
const SWITCHES: &[&str] = &[
    // Uncapped. On stock Chromium this triggers the aim freeze (Chromium issue 415071737); M2 patches it.
    "disable-frame-rate-limit",
    "disable-gpu-vsync",
    // Keep full speed when the window is covered (overlays, OBS) or unfocused.
    "disable-background-timer-throttling",
    "disable-renderer-backgrounding",
    "disable-backgrounding-occluded-windows",
    // Hybrid laptops: render on the discrete GPU.
    "force-high-performance-gpu",
];

static OPEN_BROWSERS: AtomicUsize = AtomicUsize::new(0);

/// Entry point for every process; `bootstrap.exe` (shipped as mercury.exe) calls it after setting up the sandbox.
#[unsafe(no_mangle)]
unsafe extern "C" fn RunWinMain(
    instance: sys::HINSTANCE,
    _command_line: *const u8,
    _command_show: i32,
    sandbox_info: *mut u8,
) -> i32 {
    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);
    let args = args::Args::from(MainArgs { instance });
    let mut app = MercuryApp::new();

    // Renderer, GPU and utility processes run to completion here; the browser process gets -1.
    let code = execute_process(Some(args.as_main_args()), Some(&mut app), sandbox_info);
    if code >= 0 {
        return code;
    }

    // An empty cache path makes CEF keep everything in memory, which is the right fallback.
    let profile = std::env::var("LOCALAPPDATA")
        .map(|base| format!(r"{base}\Mercury\profile"))
        .unwrap_or_default();
    let settings = Settings {
        root_cache_path: CefString::from(profile.as_str()),
        cache_path: CefString::from(profile.as_str()),
        persist_session_cookies: 1,
        ..Default::default()
    };
    if initialize(Some(args.as_main_args()), Some(&settings), Some(&mut app), sandbox_info) != 1 {
        return 1;
    }
    run_message_loop();
    shutdown();
    0
}

wrap_app! {
    struct MercuryApp {}

    impl App {
        fn on_before_command_line_processing(
            &self,
            process_type: Option<&CefString>,
            command_line: Option<&mut CommandLine>,
        ) {
            let is_browser = process_type.is_none_or(|t| t.to_string().is_empty());
            let (true, Some(command_line)) = (is_browser, command_line) else {
                return;
            };
            for switch in SWITCHES {
                command_line.append_switch(Some(&CefString::from(*switch)));
            }
        }

        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(MercuryBrowserProcess::new())
        }

        fn render_process_handler(&self) -> Option<RenderProcessHandler> {
            Some(MercuryRenderer::new())
        }
    }
}

wrap_browser_process_handler! {
    struct MercuryBrowserProcess {}

    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            let mut client = MercuryClient::new();
            let mut delegate = MercuryBrowserView::new();
            let browser_view = browser_view_create(
                Some(&mut client),
                Some(&CefString::from(URL)),
                Some(&BrowserSettings::default()),
                None,
                None,
                Some(&mut delegate),
            );
            let mut window = MercuryWindow::new(RefCell::new(browser_view), true);
            window_create_top_level(Some(&mut window));
        }
    }
}

wrap_render_process_handler! {
    struct MercuryRenderer {}

    impl RenderProcessHandler {
        // Runs before any page script, so inject.js sees pristine built-ins.
        fn on_context_created(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            context: Option<&mut V8Context>,
        ) {
            let Some(context) = context else { return };
            let (mut value, mut exception) = (None, None);
            context.eval(
                Some(&CefString::from(INJECT)),
                Some(&CefString::from("mercury://inject.js")),
                1,
                Some(&mut value),
                Some(&mut exception),
            );
        }
    }
}

wrap_client! {
    struct MercuryClient {}

    impl Client {
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(MercuryLifeSpan::new())
        }
    }
}

wrap_life_span_handler! {
    struct MercuryLifeSpan {}

    impl LifeSpanHandler {
        fn on_after_created(&self, _browser: Option<&mut Browser>) {
            OPEN_BROWSERS.fetch_add(1, Ordering::Relaxed);
        }

        fn on_before_close(&self, _browser: Option<&mut Browser>) {
            // Popups count too: quit when the last window of any kind closes.
            if OPEN_BROWSERS.fetch_sub(1, Ordering::Relaxed) == 1 {
                quit_message_loop();
            }
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
        maximized: bool,
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
            window.set_title(Some(&CefString::from("Mercury")));
            window.show();
            // Chrome-style windows ignore initial_show_state, so maximize explicitly.
            if self.maximized {
                window.maximize();
            }
        }

        fn on_window_destroyed(&self, _window: Option<&mut Window>) {
            self.browser_view.borrow_mut().take();
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
