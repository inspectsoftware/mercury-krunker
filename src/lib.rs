//! Mercury Client: a Krunker client on CEF. See PLAN.md.
//!
//! `mercury.exe` is CEF's sandbox bootstrap; it loads this DLL and calls `RunWinMain` in every process:
//! the browser process (window, bridge, settings), renderers (page injection) and the GPU and utility processes.

mod bridge;
mod browser;
mod files;
mod gpu_hook;
mod nvidia;
mod paths;
mod perf;
mod present;
mod renderer;
mod resources;
mod settings;
mod system;

use cef::*;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

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
    // The GPU process's present hook goes in now, before Chromium starts and before its sandbox locks down.
    gpu_hook::init();

    // Renderer, GPU and utility processes run to completion here; the browser process gets -1.
    let code = execute_process(Some(args.as_main_args()), Some(&mut app), sandbox_info);
    if code >= 0 {
        return code;
    }
    browser::run(&args, &mut app, sandbox_info)
}

/// Engine switches, set on the browser process; Chromium hands them on to the GPU and renderer processes.
fn engine_switches() -> Vec<(String, Option<String>)> {
    let mut switches: Vec<(String, Option<String>)> = [
        // Keep full speed when the window is covered (overlays, OBS) or unfocused.
        "disable-background-timer-throttling",
        "disable-renderer-backgrounding",
        "disable-backgrounding-occluded-windows",
        // Hybrid laptops: render on the discrete GPU.
        "force-high-performance-gpu",
    ]
    .iter()
    .map(|s| (s.to_string(), None))
    .collect();

    if settings::bool("engine.uncapped", true) {
        // Stock Chromium starves WebSocket messages under held-click input when uncapped (Chromium issue
        // 415071737, the "aim freeze"); Krunker's own aim freeze fix setting (on by default in Mercury) covers it.
        // Without GPU vsync Chromium also creates its swap chains with tearing and presents with sync interval 0 and
        // ALLOW_TEARING (measured with the present hook), so the DXGISwapChainPresentInterval0 feature adds nothing.
        switches.push(("disable-frame-rate-limit".into(), None));
        switches.push(("disable-gpu-vsync".into(), None));
    }
    // Chromium's own waitable swap chain: DXGI's frame queue limited to N frames (ui/gl/swap_chain_presenter.cc).
    let queued = settings::string("engine.waitableSwapChain");
    if matches!(queued.as_str(), "1" | "2") {
        let feature = format!("DXGIWaitableSwapChain:DXGIWaitableSwapChainMaxQueuedFrames/{queued}");
        switches.push(("enable-features".into(), Some(feature)));
    }
    for (key, switch) in [("engine.angle", "use-angle"), ("engine.colorProfile", "force-color-profile")] {
        let value = settings::string(key);
        if !value.is_empty() {
            switches.push((switch.into(), Some(value)));
        }
    }
    // Custom flags come last so they win.
    switches.extend(parse_flags(&settings::string("engine.flags")));
    merge_features(switches)
}

/// Chromium reads only the last --enable-features and --disable-features: join every occurrence into one.
fn merge_features(switches: Vec<(String, Option<String>)>) -> Vec<(String, Option<String>)> {
    let mut out: Vec<(String, Option<String>)> = Vec::new();
    for (name, value) in switches {
        let list = name == "enable-features" || name == "disable-features";
        match out.iter_mut().find(|(n, _)| list && *n == name) {
            Some((_, Some(joined))) => {
                for feature in value.iter().flat_map(|v| v.split(',')).filter(|f| !f.is_empty()) {
                    if !joined.split(',').any(|f| f == feature) {
                        if !joined.is_empty() {
                            joined.push(',');
                        }
                        joined.push_str(feature);
                    }
                }
            }
            _ => out.push((name, value)),
        }
    }
    out
}

/// "--name --other=value" → [("name", None), ("other", Some("value"))].
fn parse_flags(flags: &str) -> Vec<(String, Option<String>)> {
    flags
        .split_whitespace()
        .map(|token| token.trim_start_matches('-'))
        .filter(|token| !token.is_empty() && !token.starts_with('='))
        .map(|token| match token.split_once('=') {
            Some((name, value)) => (name.into(), Some(value.into())),
            None => (token.into(), None),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn parse_flags() {
        let parsed = super::parse_flags("  --a   b=1 --use-angle=d3d11on12 -- --=x --c=  ");
        let expect = [("a", None), ("b", Some("1")), ("use-angle", Some("d3d11on12")), ("c", Some(""))];
        assert_eq!(parsed, expect.map(|(n, v)| (n.to_string(), v.map(String::from))));
    }

    #[test]
    fn merge_features_joins_lists_once() {
        let merged = super::merge_features(super::parse_flags(
            "--disable-features=A --x --enable-features=B --disable-features=C,A --disable-features=,D",
        ));
        let expect = [("disable-features", Some("A,C,D")), ("x", None), ("enable-features", Some("B"))];
        assert_eq!(merged, expect.map(|(n, v)| (n.to_string(), v.map(String::from))));
    }
}

wrap_app! {
    pub struct MercuryApp {}

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
            if browser::safe_mode(command_line) {
                return;
            }
            for (name, value) in engine_switches() {
                let name = CefString::from(name.as_str());
                match value {
                    Some(value) => command_line.append_switch_with_value(Some(&name), Some(&CefString::from(value.as_str()))),
                    None => command_line.append_switch(Some(&name)),
                }
            }
        }

        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(browser::MercuryBrowserProcess::new())
        }

        fn render_process_handler(&self) -> Option<RenderProcessHandler> {
            Some(renderer::MercuryRenderer::new())
        }
    }
}
