//! `<data>/logs/mercury.log`: crashes and other things worth keeping (browser process only: the sandboxed
//! processes can't write files). Diagnostics reports include it.

use crate::paths;
use std::{fs, io::Write, path::PathBuf, time::SystemTime};

pub fn file() -> Option<PathBuf> {
    paths::data_dir().map(|d| d.join("logs").join("mercury.log"))
}

/// Appends one line, prefixed with the Unix time. Never fails loudly: logging must not take the client down.
pub fn line(message: &str) {
    let Some(path) = file() else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    // Keep the log small: start over past 1 MB.
    if fs::metadata(&path).is_ok_and(|m| m.len() > 1 << 20) {
        let _ = fs::remove_file(&path);
    }
    let secs = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{secs}] v{} {message}", crate::VERSION);
    }
}

/// Logs Rust panics in the browser process before the default handler runs.
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        line(&format!("panic: {info}"));
        default(info);
    }));
}
