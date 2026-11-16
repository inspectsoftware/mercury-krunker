//! Mercury Client: a Krunker client on CEF. See PLAN.md.
//!
//! `mercury.exe` is CEF's sandbox bootstrap; it loads this DLL and calls `RunWinMain` in every process:
//! the browser process (window, bridge, settings), renderers (page injection) and the GPU and utility processes.

mod accounts;
mod attention;
mod bridge;
mod browser;
mod diag;
mod discord;
mod files;
mod log;
mod media;
mod mods;
mod net;
mod paths;
mod renderer;
mod resources;
mod settings;
mod update;

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
        switches.push(("disable-frame-rate-limit".into(), None));
        switches.push(("disable-gpu-vsync".into(), None));
    }
    for (key, switch) in [("engine.angle", "use-angle"), ("engine.colorProfile", "force-color-profile")] {
        let value = settings::string(key);
        if !value.is_empty() {
            switches.push((switch.into(), Some(value)));
        }
    }
    // Custom flags come last so they win.
    switches.extend(parse_flags(&settings::string("engine.flags")));
    switches
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
