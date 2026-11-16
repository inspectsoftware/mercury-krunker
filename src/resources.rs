//! Network requests, on CEF's IO thread (never the UI thread, which forwards input):
//! - the URL blocklist (ads, trackers, widgets), editable in settings;
//! - the resource swapper: a file in `<data>/swap/<path>` replaces `https://*.krunker.io/<path>`, and wins over the
//!   blocklist.

use crate::{files, settings};
use cef::*;
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, LazyLock, Mutex, RwLock},
};

/// What Krunker's menu loads besides the game itself, measured 2026-11-16, plus common ad exchanges. Krunker's own
/// hosts, FRVR, Cloudflare Turnstile, the consent tool and Google sign-in are deliberately not here.
pub const DEFAULT_BLOCKLIST: &[&str] = &[
    "doubleclick.net", "googlesyndication.com", "googleadservices.com", "googletagservices.com", "adservice.google.com",
    "adtrafficquality.google", "googletagmanager.com", "google-analytics.com", "analytics.google.com",
    "creativecdn.com", "adform.net", "adnxs.com", "rubiconproject.com", "pubmatic.com", "openx.net",
    "casalemedia.com", "indexww.com", "criteo.com", "criteo.net", "amazon-adsystem.com", "adsrvr.org",
    "smartadserver.com", "33across.com", "sharethrough.com", "teads.tv", "yieldmo.com", "3lift.com", "gumgum.com",
    "media.net", "lijit.com", "sovrn.com", "contextweb.com", "spotxchange.com", "springserve.com", "connatix.com",
    "primis.tech", "seedtag.com", "onetag-sys.com", "richaudience.com", "improvedigital.com", "adkernel.com",
    "smilewanted.com", "id5-sync.com", "rlcdn.com", "crwdcntrl.net", "bidswitch.net", "scorecardresearch.com",
    "quantserve.com", "clarity.ms", "platform.twitter.com", "syndication.twitter.com",
];

static BLOCKLIST: LazyLock<RwLock<Vec<String>>> = LazyLock::new(|| RwLock::new(blocklist_from_settings()));
static SWAPS: LazyLock<RwLock<HashSet<String>>> = LazyLock::new(|| RwLock::new(scan_swaps()));

fn blocklist_from_settings() -> Vec<String> {
    if !settings::bool("blocklist.enabled", true) {
        return Vec::new();
    }
    match settings::get("blocklist.entries").and_then(|v| v.as_str().map(String::from)) {
        Some(text) => text.split_whitespace().map(|e| e.to_ascii_lowercase()).collect(),
        None => DEFAULT_BLOCKLIST.iter().map(|e| e.to_string()).collect(),
    }
}

/// After settings change: the page edits the list live.
pub fn reload_blocklist() {
    *BLOCKLIST.write().unwrap() = blocklist_from_settings();
}

fn scan_swaps() -> HashSet<String> {
    files::dir("swap").map(|d| files::walk(&d).into_iter().map(|(p, _)| p).collect()).unwrap_or_default()
}

pub fn reload_swaps() {
    *SWAPS.write().unwrap() = scan_swaps();
}

/// "https://host:port/path?query" → ("host", "path"), lowercase host, no query.
fn split_url(url: &str) -> Option<(String, &str)> {
    let rest = url.split_once("://")?.1;
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = authority.rsplit('@').next()?.split(':').next()?.to_ascii_lowercase();
    Some((host, path.split(['?', '#']).next().unwrap_or("")))
}

/// An entry is a domain (blocks it and its subdomains) or, if it has a '/', a URL fragment to look for.
fn is_blocked(entries: &[String], url: &str) -> bool {
    let Some((host, _)) = split_url(url) else { return false };
    let lower = url.to_ascii_lowercase();
    entries.iter().any(|e| {
        if e.contains('/') {
            lower.contains(e.as_str())
        } else {
            host == *e || host.strip_suffix(e.as_str()).is_some_and(|rest| rest.ends_with('.'))
        }
    })
}

/// The swap file's relative path for a krunker.io URL, if the player has one.
fn swap_path(swaps: &HashSet<String>, url: &str) -> Option<String> {
    let (host, path) = split_url(url)?;
    let krunker = host == "krunker.io" || host.ends_with(".krunker.io");
    (krunker && swaps.contains(path)).then(|| path.to_string())
}

fn mime_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "json" => "application/json",
        "css" => "text/css",
        "js" => "text/javascript",
        "html" => "text/html",
        "obj" | "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

wrap_resource_request_handler! {
    pub struct MercuryResources {}

    impl ResourceRequestHandler {
        fn on_before_resource_load(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            _callback: Option<&mut Callback>,
        ) -> ReturnValue {
            let Some(request) = request else { return ReturnValue::CONTINUE };
            let url = CefString::from(&request.url()).to_string();
            if swap_path(&SWAPS.read().unwrap(), &url).is_none() && is_blocked(&BLOCKLIST.read().unwrap(), &url) {
                return ReturnValue::CANCEL;
            }
            ReturnValue::CONTINUE
        }

        fn resource_handler(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            request: Option<&mut Request>,
        ) -> Option<ResourceHandler> {
            let url = CefString::from(&request?.url()).to_string();
            let rel = swap_path(&SWAPS.read().unwrap(), &url)?;
            let file = files::dir("swap").ok()?.join(&rel);
            Some(SwapFile::new(file, mime_type(&rel), Arc::new(Mutex::new((Vec::new(), 0)))))
        }
    }
}

// Serves one swap file. CEF calls open() and read() on a worker thread, response_headers() on the IO thread.
// `data` holds the file and how much of it was sent.
wrap_resource_handler! {
    struct SwapFile {
        path: PathBuf,
        mime: &'static str,
        data: Arc<Mutex<(Vec<u8>, usize)>>,
    }

    impl ResourceHandler {
        fn open(&self, _request: Option<&mut Request>, handle_request: Option<&mut i32>, _callback: Option<&mut Callback>) -> i32 {
            if let Some(handle) = handle_request {
                *handle = 1;
            }
            match std::fs::read(&self.path) {
                Ok(bytes) => {
                    self.data.lock().unwrap().0 = bytes;
                    1
                }
                Err(_) => 0,
            }
        }

        fn response_headers(&self, response: Option<&mut Response>, response_length: Option<&mut i64>, _redirect_url: Option<&mut CefString>) {
            if let Some(response) = response {
                response.set_status(200);
                response.set_status_text(Some(&CefString::from("OK")));
                response.set_mime_type(Some(&CefString::from(self.mime)));
                // Krunker loads assets cross-origin (assets.krunker.io from krunker.io), WebGL textures included.
                for (name, value) in [("Access-Control-Allow-Origin", "*"), ("Cache-Control", "no-store")] {
                    response.set_header_by_name(Some(&CefString::from(name)), Some(&CefString::from(value)), 1);
                }
            }
            if let Some(length) = response_length {
                *length = self.data.lock().unwrap().0.len() as i64;
            }
        }

        #[allow(clippy::not_unsafe_ptr_arg_deref)]
        fn read(&self, data_out: *mut u8, bytes_to_read: i32, bytes_read: Option<&mut i32>, _callback: Option<&mut ResourceReadCallback>) -> i32 {
            let Some(bytes_read) = bytes_read else { return 0 };
            let mut data = self.data.lock().unwrap();
            let (bytes, sent) = &mut *data;
            let n = (bytes.len() - *sent).min(bytes_to_read.max(0) as usize);
            *bytes_read = n as i32;
            if n == 0 {
                return 0;
            }
            // SAFETY: CEF hands us a buffer of bytes_to_read bytes, and n <= bytes_to_read.
            unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr().add(*sent), data_out, n) };
            *sent += n;
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_domains_and_subdomains_only() {
        let list: Vec<String> = ["doubleclick.net", "example.com/ads/"].map(String::from).to_vec();
        assert!(is_blocked(&list, "https://doubleclick.net/x"));
        assert!(is_blocked(&list, "https://googleads.g.doubleclick.net:443/pagead?x=1"));
        assert!(!is_blocked(&list, "https://notdoubleclick.net/x"));
        assert!(!is_blocked(&list, "https://krunker.io/?ref=doubleclick.net"));
        assert!(is_blocked(&list, "https://cdn.example.com/ads/banner.js"));
        assert!(!is_blocked(&list, "https://cdn.example.com/game.js"));
    }

    #[test]
    fn swaps_match_krunker_paths_without_query() {
        let swaps: HashSet<String> = ["textures/weapons/skins/weapon_1.png".to_string()].into();
        let hit = "https://assets.krunker.io/textures/weapons/skins/weapon_1.png?build=5fHFc";
        assert_eq!(swap_path(&swaps, hit).as_deref(), Some("textures/weapons/skins/weapon_1.png"));
        assert_eq!(swap_path(&swaps, "https://evil.com/textures/weapons/skins/weapon_1.png"), None);
        assert_eq!(swap_path(&swaps, "https://krunker.io/textures/other.png"), None);
    }
}
