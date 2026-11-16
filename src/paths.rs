//! Where Mercury keeps its data. `MERCURY_DATA_DIR` overrides the location (test runs, portable use).

use std::{env, path::PathBuf};

/// `%LOCALAPPDATA%\Mercury`, or `MERCURY_DATA_DIR`. `None` when neither is set: CEF then keeps everything in memory.
pub fn data_dir() -> Option<PathBuf> {
    env::var_os("MERCURY_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("Mercury")))
}

pub fn profile_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join("profile"))
}

pub fn settings_file() -> Option<PathBuf> {
    data_dir().map(|d| d.join("settings.json"))
}

/// Files that ship next to mercury.exe (the page bundle).
pub fn app_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from))
        .unwrap_or_default()
}
