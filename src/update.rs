//! `update.*`: the auto-updater. Looks at the latest GitHub release, downloads its installer (only from GitHub,
//! checked against the SHA-256 digest GitHub publishes for the asset), and runs it silently; the installer restarts
//! Mercury. Downloads stream through WinHTTP so the page can show progress.

use crate::{browser, VERSION};
use cef::ImplWindow;
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    ptr::{null, null_mut},
    sync::Mutex,
};
use windows_sys::Win32::{
    Networking::WinHttp::*,
    Security::Cryptography::{
        BCryptCloseAlgorithmProvider, BCryptCreateHash, BCryptDestroyHash, BCryptFinishHash, BCryptHashData,
        BCryptOpenAlgorithmProvider, BCRYPT_SHA256_ALGORITHM,
    },
};

const REPO: &str = "inspectsoftware/mercury-krunker";

#[derive(Default)]
struct Status {
    state: &'static str, // idle | downloading | ready | error
    received: u64,
    total: u64,
    error: String,
    file: Option<PathBuf>,
}

static STATUS: Mutex<Status> = Mutex::new(Status { state: "idle", received: 0, total: 0, error: String::new(), file: None });

pub fn command(cmd: &str, request: &Value) -> Result<Value, String> {
    match cmd {
        "update.check" => check(),
        "update.notes" => {
            // Release notes of one version, for the "what's new" window after an update.
            let tag = request["version"].as_str().unwrap_or(VERSION);
            if !tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
                return Err("bad version".into());
            }
            let release = get_json(&format!("https://api.github.com/repos/{REPO}/releases/tags/v{tag}"))?;
            Ok(json!({ "version": tag, "notes": release["body"].as_str().unwrap_or("") }))
        }
        "update.download" => download(),
        "update.status" => {
            let s = STATUS.lock().unwrap();
            Ok(json!({ "state": s.state, "received": s.received, "total": s.total, "error": s.error }))
        }
        _ => Err(format!("unknown command {cmd}")),
    }
}

/// Runs on the UI thread: starts the downloaded installer, then closes Mercury so its files can be replaced.
pub fn install() -> Result<Value, String> {
    let file = {
        let s = STATUS.lock().unwrap();
        if s.state == "ready" { s.file.clone() } else { None }
    };
    let file = file.ok_or("no update downloaded")?;
    std::process::Command::new(&file)
        .args(["/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
        .spawn()
        .map_err(|e| e.to_string())?;
    browser::with_main_window(|w| w.close());
    Ok(Value::Null)
}

/// "1.2.10" > "1.2.9"; non-numeric parts count as 0.
fn newer(candidate: &str, current: &str) -> bool {
    let parse = |v: &str| v.trim_start_matches('v').split(['.', '-']).take(3).map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parse(candidate) > parse(current)
}

/// The installer asset of a release: an .exe served from GitHub.
fn installer_asset(release: &Value) -> Option<&Value> {
    release["assets"].as_array()?.iter().find(|a| {
        let name = a["name"].as_str().unwrap_or("");
        let url = a["browser_download_url"].as_str().unwrap_or("");
        name.ends_with(".exe") && url.starts_with(&format!("https://github.com/{REPO}/releases/download/"))
    })
}

fn check() -> Result<Value, String> {
    let release = match get_json(&format!("https://api.github.com/repos/{REPO}/releases/latest")) {
        Ok(r) => r,
        // A private repo or no releases yet answers 404: nothing to offer.
        Err(e) if e.contains("404") => return Ok(json!({ "available": false })),
        Err(e) => return Err(e),
    };
    let version = release["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    let asset = installer_asset(&release);
    Ok(json!({
        "available": newer(&version, VERSION) && asset.is_some(),
        "current": VERSION,
        "version": version,
        "notes": release["body"].as_str().unwrap_or(""),
        "size": asset.and_then(|a| a["size"].as_u64()).unwrap_or(0),
    }))
}

fn download() -> Result<Value, String> {
    let release = get_json(&format!("https://api.github.com/repos/{REPO}/releases/latest"))?;
    let asset = installer_asset(&release).ok_or("the latest release has no installer")?.clone();
    {
        let mut s = STATUS.lock().unwrap();
        if s.state == "downloading" {
            return Ok(Value::Null);
        }
        *s = Status { state: "downloading", total: asset["size"].as_u64().unwrap_or(0), ..Default::default() };
    }
    std::thread::spawn(move || {
        let result = (|| -> Result<PathBuf, String> {
            let name = asset["name"].as_str().unwrap_or("MercuryClient-Setup.exe");
            if !name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) {
                return Err("bad installer name".into());
            }
            let path = std::env::temp_dir().join(name);
            let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
            let mut hash = Sha256::new()?;
            let url = asset["browser_download_url"].as_str().unwrap_or_default();
            http_get(url, |chunk| {
                use std::io::Write;
                hash.update(chunk);
                STATUS.lock().unwrap().received += chunk.len() as u64;
                file.write_all(chunk).map_err(|e| e.to_string())
            })?;
            // GitHub publishes "sha256:<hex>" per asset; when it does, the file must match it.
            if let Some(expected) = asset["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")) {
                let actual = hash.finish()?;
                if !actual.eq_ignore_ascii_case(expected) {
                    let _ = std::fs::remove_file(&path);
                    return Err("the download does not match GitHub's checksum".into());
                }
            }
            Ok(path)
        })();
        let mut s = STATUS.lock().unwrap();
        match result {
            Ok(path) => {
                s.state = "ready";
                s.file = Some(path);
            }
            Err(e) => {
                s.state = "error";
                s.error = e;
            }
        }
    });
    Ok(Value::Null)
}

fn get_json(url: &str) -> Result<Value, String> {
    let mut body = Vec::new();
    http_get(url, |chunk| {
        body.extend_from_slice(chunk);
        Ok(())
    })?;
    serde_json::from_slice(&body).map_err(|e| e.to_string())
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// GET over HTTPS, following redirects; each chunk of the body goes to `on_chunk`. Errors include the status code.
fn http_get(url: &str, mut on_chunk: impl FnMut(&[u8]) -> Result<(), String>) -> Result<(), String> {
    let rest = url.strip_prefix("https://").ok_or("only https")?;
    let (host, path) = rest.split_once('/').map_or((rest, "/".to_string()), |(h, p)| (h, format!("/{p}")));
    struct Handle(*mut core::ffi::c_void);
    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { WinHttpCloseHandle(self.0) };
            }
        }
    }
    let check = |h: *mut core::ffi::c_void, what: &str| if h.is_null() { Err(format!("{what} failed")) } else { Ok(Handle(h)) };
    unsafe {
        let agent = wide(&format!("MercuryClient/{VERSION}"));
        let session = check(WinHttpOpen(agent.as_ptr(), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, null(), null(), 0), "WinHttpOpen")?;
        let connect = check(WinHttpConnect(session.0, wide(host).as_ptr(), INTERNET_DEFAULT_HTTPS_PORT, 0), "connect")?;
        let request = check(
            WinHttpOpenRequest(connect.0, wide("GET").as_ptr(), wide(&path).as_ptr(), null(), null(), null(), WINHTTP_FLAG_SECURE),
            "request",
        )?;
        let headers = wide("Accept: application/vnd.github+json, application/octet-stream\r\n");
        if WinHttpSendRequest(request.0, headers.as_ptr(), u32::MAX, null(), 0, 0, 0) == 0 || WinHttpReceiveResponse(request.0, null_mut()) == 0 {
            return Err(format!("{host}: no answer"));
        }
        let mut status = 0u32;
        let mut len = 4u32;
        WinHttpQueryHeaders(request.0, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, null(), (&mut status as *mut u32).cast(), &mut len, null_mut());
        if status != 200 {
            return Err(format!("{host} answered {status}"));
        }
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let mut read = 0u32;
            if WinHttpReadData(request.0, buf.as_mut_ptr().cast(), buf.len() as u32, &mut read) == 0 {
                return Err("download interrupted".into());
            }
            if read == 0 {
                return Ok(());
            }
            on_chunk(&buf[..read as usize])?;
        }
    }
}

/// Incremental SHA-256 through Windows' CNG.
struct Sha256 {
    alg: *mut core::ffi::c_void,
    hash: *mut core::ffi::c_void,
}

impl Sha256 {
    fn new() -> Result<Self, String> {
        let (mut alg, mut hash) = (null_mut(), null_mut());
        unsafe {
            if BCryptOpenAlgorithmProvider(&mut alg, BCRYPT_SHA256_ALGORITHM, null(), 0) != 0 {
                return Err("SHA-256 unavailable".into());
            }
            if BCryptCreateHash(alg, &mut hash, null_mut(), 0, null(), 0, 0) != 0 {
                BCryptCloseAlgorithmProvider(alg, 0);
                return Err("SHA-256 unavailable".into());
            }
        }
        Ok(Self { alg, hash })
    }

    fn update(&mut self, data: &[u8]) {
        unsafe { BCryptHashData(self.hash, data.as_ptr(), data.len() as u32, 0) };
    }

    fn finish(self) -> Result<String, String> {
        let mut out = [0u8; 32];
        if unsafe { BCryptFinishHash(self.hash, out.as_mut_ptr(), 32, 0) } != 0 {
            return Err("SHA-256 failed".into());
        }
        Ok(out.iter().map(|b| format!("{b:02x}")).collect())
    }
}

impl Drop for Sha256 {
    fn drop(&mut self) {
        unsafe {
            BCryptDestroyHash(self.hash);
            BCryptCloseAlgorithmProvider(self.alg, 0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_numerically() {
        assert!(newer("0.10.0", "0.9.9"));
        assert!(newer("v1.0.0", "0.99.0"));
        assert!(!newer("0.2.0", "0.2.0"));
        assert!(!newer("0.1.9", "0.2.0"));
    }

    #[test]
    fn only_github_exe_assets_install() {
        let release = json!({ "assets": [
            { "name": "notes.txt", "browser_download_url": format!("https://github.com/{REPO}/releases/download/v1/notes.txt") },
            { "name": "evil.exe", "browser_download_url": "https://evil.example/evil.exe" },
            { "name": "MercuryClient-Setup-1.0.0.exe", "browser_download_url": format!("https://github.com/{REPO}/releases/download/v1.0.0/MercuryClient-Setup-1.0.0.exe") },
        ]});
        assert_eq!(installer_asset(&release).unwrap()["name"], "MercuryClient-Setup-1.0.0.exe");
        assert!(installer_asset(&json!({ "assets": [] })).is_none());
    }

    #[test]
    fn sha256_matches_a_known_vector() {
        let mut h = Sha256::new().unwrap();
        h.update(b"abc");
        assert_eq!(h.finish().unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
