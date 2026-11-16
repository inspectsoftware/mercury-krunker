//! `window.attention`: draws the player back when a ranked match is found while Mercury is in the background.
//! Runs on the UI thread (it touches the main window).

use crate::browser;
use cef::ImplWindow;
use serde_json::{json, Value};
use windows_sys::Win32::UI::WindowsAndMessaging::{FlashWindowEx, FLASHWINFO, FLASHW_ALL, FLASHW_TIMERNOFG};

/// `{mode: "flash" | "front"}`. "front" restores and activates the window; Windows may refuse to hand a background
/// program the focus, so it flashes the taskbar button as well. The flashing stops once the window is in front.
pub fn attention(request: &Value) -> Result<Value, String> {
    let mode = request["mode"].as_str().unwrap_or("flash");
    if !matches!(mode, "flash" | "front") {
        return Err("mode must be flash or front".into());
    }
    browser::with_main_window(|window| {
        if mode == "front" {
            if window.is_minimized() != 0 {
                window.restore();
            }
            window.activate();
        }
        let info = FLASHWINFO {
            cbSize: size_of::<FLASHWINFO>() as u32,
            hwnd: window.window_handle().0 as _,
            dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
            uCount: 0,
            dwTimeout: 0,
        };
        unsafe { FlashWindowEx(&info) };
        json!(mode)
    })
    .ok_or_else(|| "no window".into())
}
