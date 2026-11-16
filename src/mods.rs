//! `mods.download`: saves a Krunker mod's zip in the player's Downloads folder. Only https URLs on krunker.io hosts,
//! only a sanitized file name. Also `game_link`, the rule for links that open in the game window, not a popup.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub fn command(cmd: &str, request: &Value) -> Result<Value, String> {
    match cmd {
        "mods.download" => {
            let url = request["url"].as_str().unwrap_or_default();
            if !krunker_https(url) {
                return Err("only https links on krunker.io can be downloaded".into());
            }
            let stem = file_stem(request["name"].as_str().unwrap_or_default()).ok_or("bad mod name")?;
            let dir = crate::bridge::downloads_dir().ok_or("no Downloads folder")?;
            let path = free_path(&dir, &stem);
            download(url, &path)?;
            Ok(json!(path))
        }
        _ => Err(format!("unknown command {cmd}")),
    }
}

/// "https://host[:443]/..." → the host, lowercase. None for anything else (other schemes, user info).
fn https_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.contains('@') || url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '\\') {
        return None;
    }
    let host = authority.strip_suffix(":443").unwrap_or(authority);
    (!host.is_empty() && !host.contains(':')).then(|| host.to_ascii_lowercase())
}

fn krunker_https(url: &str) -> bool {
    https_host(url).is_some_and(|h| h == "krunker.io" || h.ends_with(".krunker.io"))
}

/// A link to the game page itself (a lobby, map or mod: `krunker.io/?game=...`), normalized to the main window's
/// origin so the page script and the bridge run there. Other krunker.io pages (social, editor) stay popups.
pub fn game_link(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let rest = rest.strip_prefix("www.").unwrap_or(rest);
    let tail = rest.strip_prefix("krunker.io")?;
    let tail = tail.strip_prefix('/').unwrap_or(tail);
    let game_page = tail.is_empty() || tail.starts_with('?') || tail.starts_with('#');
    (game_page && !url.chars().any(|c| c.is_whitespace() || c.is_control())).then(|| format!("https://krunker.io/{tail}"))
}

const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
    "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A mod name → a safe file stem: letters, digits, '-' and '_' only, at most 64, never a Windows device name.
fn file_stem(name: &str) -> Option<String> {
    let stem: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(64)
        .collect();
    let stem = stem.trim_matches('_').to_string();
    if stem.is_empty() {
        return None;
    }
    Some(if RESERVED.contains(&stem.to_ascii_uppercase().as_str()) { format!("mod_{stem}") } else { stem })
}

/// `<stem>.zip`, or `<stem> (2).zip`... if that file exists.
fn free_path(dir: &Path, stem: &str) -> PathBuf {
    (1..)
        .map(|n| dir.join(if n == 1 { format!("{stem}.zip") } else { format!("{stem} ({n}).zip") }))
        .find(|p| !p.exists())
        .unwrap()
}

fn download(url: &str, path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Com::Urlmon::URLDownloadToFileW;
    let url: Vec<u16> = url.encode_utf16().chain([0]).collect();
    let file: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    let hr = unsafe { URLDownloadToFileW(std::ptr::null_mut(), url.as_ptr(), file.as_ptr(), 0, std::ptr::null_mut()) };
    if hr == 0 { Ok(()) } else { Err(format!("download failed (0x{:08x})", hr as u32)) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_krunker_hosts() {
        assert!(krunker_https("https://user-assets.krunker.io/md3466/mod.zip"));
        assert!(krunker_https("https://krunker.io:443/x.zip"));
        assert!(!krunker_https("http://user-assets.krunker.io/md3466/mod.zip"));
        assert!(!krunker_https("https://www.dropbox.com/s/x/mod.zip?dl=0"));
        assert!(!krunker_https("https://krunker.io.evil.com/mod.zip"));
        assert!(!krunker_https("https://evilkrunker.io/mod.zip"));
        assert!(!krunker_https("https://krunker.io@evil.com/mod.zip"));
        assert!(!krunker_https("https://krunker.io:8080/mod.zip"));
        assert!(!krunker_https("https://krunker.io\\@evil.com/"));
        assert!(!krunker_https("file:///C:/Windows/win.ini"));
    }

    #[test]
    fn safe_file_stems() {
        assert_eq!(file_stem("CRUCIAL").as_deref(), Some("CRUCIAL"));
        assert_eq!(file_stem("Minecraft!").as_deref(), Some("Minecraft"));
        assert_eq!(file_stem("../../evil").as_deref(), Some("evil"));
        assert_eq!(file_stem("a b/c").as_deref(), Some("a_b_c"));
        assert_eq!(file_stem("con").as_deref(), Some("mod_con"));
        assert_eq!(file_stem("..."), None);
        assert_eq!(file_stem(&"x".repeat(100)).map(|s| s.len()), Some(64));
    }

    #[test]
    fn free_path_skips_existing_files() {
        let dir = std::env::temp_dir().join(format!("mercury-mods-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(free_path(&dir, "m"), dir.join("m.zip"));
        std::fs::write(dir.join("m.zip"), b"").unwrap();
        assert_eq!(free_path(&dir, "m"), dir.join("m (2).zip"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn game_links_open_in_the_game_window() {
        let ok = |u: &str| game_link(u);
        assert_eq!(ok("https://krunker.io/?game=FRA:n12t0").as_deref(), Some("https://krunker.io/?game=FRA:n12t0"));
        assert_eq!(ok("http://www.krunker.io/?game=FRA:n12t0").as_deref(), Some("https://krunker.io/?game=FRA:n12t0"));
        assert_eq!(ok("https://krunker.io").as_deref(), Some("https://krunker.io/"));
        assert_eq!(ok("https://krunker.io/social.html?p=profile&q=x"), None);
        assert_eq!(ok("https://krunker.io.evil.com/?game=x"), None);
        assert_eq!(ok("https://krunker.iox/?game=x"), None);
        assert_eq!(ok("https://evil.com/?u=https://krunker.io/"), None);
    }
}
