//! `accounts.*` bridge commands: the account manager's list of {label, username, password}, kept in
//! `<data>/accounts.dat` and encrypted with Windows DPAPI for the current Windows user.
//!
//! The page sees ids, labels and usernames. A password leaves the host only through `accounts.credentials`, for the
//! one account being logged in, and the page only types it into Krunker's own login form.

use crate::paths;
use serde_json::{json, Map, Value};
use std::{fs, path::Path, sync::Mutex};
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
};

const MAX_ACCOUNTS: usize = 50;
const MAX_LABEL: usize = 64;
const MAX_USERNAME: usize = 128;
const MAX_PASSWORD: usize = 256;
/// Ties the blob to Mercury: another program running as the same user needs this too to decrypt it.
const ENTROPY: &[u8] = b"Mercury Client accounts v1";

/// Commands run on worker threads: one load-change-save at a time.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, PartialEq)]
struct Account {
    id: String,
    label: String,
    username: String,
    password: String,
}

pub fn command(cmd: &str, request: &Value) -> Result<Value, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let file = paths::data_dir().ok_or("no data directory")?.join("accounts.dat");
    match cmd {
        "accounts.list" => Ok(public(&load(&file)?)),
        "accounts.save" => {
            let next = merge(&load(&file)?, request)?;
            save(&file, &next)?;
            Ok(public(&next))
        }
        "accounts.credentials" => {
            let id = request["id"].as_str().unwrap_or_default();
            let account = load(&file)?.into_iter().find(|a| a.id == id).ok_or("no such account")?;
            Ok(json!({ "username": account.username, "password": account.password }))
        }
        _ => Err(format!("unknown command {cmd}")),
    }
}

/// What the page may see: everything but the passwords.
fn public(accounts: &[Account]) -> Value {
    json!(accounts.iter().map(|a| json!({ "id": a.id, "label": a.label, "username": a.username })).collect::<Vec<_>>())
}

/// The page sends the whole list in its new order: `{accounts: [{id?, label, username, password?}]}`. An entry
/// without an id is new and needs a password; an entry with an id keeps its stored password unless it brings one.
/// Accounts left out are removed.
fn merge(current: &[Account], request: &Value) -> Result<Vec<Account>, String> {
    let entries = request["accounts"].as_array().ok_or("accounts must be a list")?;
    if entries.len() > MAX_ACCOUNTS {
        return Err(format!("at most {MAX_ACCOUNTS} accounts"));
    }
    let mut out: Vec<Account> = Vec::with_capacity(entries.len());
    for entry in entries {
        let entry = entry.as_object().ok_or("each account must be an object")?;
        let username = text(entry, "username", MAX_USERNAME)?.ok_or("every account needs a username")?;
        let label = text(entry, "label", MAX_LABEL)?.unwrap_or_default();
        let password = match entry.get("password") {
            None | Some(Value::Null) => None,
            Some(Value::String(p)) if p.is_empty() => None,
            Some(Value::String(p)) if p.chars().count() > MAX_PASSWORD || p.chars().any(char::is_control) => {
                return Err("bad password".into());
            }
            Some(Value::String(p)) => Some(p.clone()),
            Some(_) => return Err("password must be text".into()),
        };
        let account = match entry.get("id").and_then(Value::as_str) {
            Some(id) => {
                if out.iter().any(|a| a.id == id) {
                    return Err("an account is listed twice".into());
                }
                let old = current.iter().find(|a| a.id == id).ok_or("no such account")?;
                Account { id: id.to_owned(), label, username, password: password.unwrap_or_else(|| old.password.clone()) }
            }
            None => Account { id: new_id(), label, username, password: password.ok_or("a new account needs a password")? },
        };
        out.push(account);
    }
    Ok(out)
}

/// A trimmed one-line text field of at most `max` characters; `None` when missing or empty.
fn text(entry: &Map<String, Value>, key: &str, max: usize) -> Result<Option<String>, String> {
    let Some(value) = entry.get(key).filter(|v| !v.is_null()) else { return Ok(None) };
    let value = value.as_str().ok_or(format!("{key} must be text"))?.trim();
    if value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(format!("bad {key}"));
    }
    Ok((!value.is_empty()).then(|| value.to_owned()))
}

fn new_id() -> String {
    use windows_sys::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
    let mut bytes = [0u8; 8];
    let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), bytes.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    assert_eq!(status, 0, "BCryptGenRandom failed");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn load(file: &Path) -> Result<Vec<Account>, String> {
    let blob = match fs::read(file) {
        Ok(blob) => blob,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let plain = unprotect(&blob)?;
    let list: Value = serde_json::from_slice(&plain).map_err(|_| "accounts.dat is damaged")?;
    let field = |a: &Value, k: &str| a[k].as_str().unwrap_or_default().to_owned();
    Ok(list
        .as_array()
        .ok_or("accounts.dat is damaged")?
        .iter()
        .map(|a| Account { id: field(a, "id"), label: field(a, "label"), username: field(a, "username"), password: field(a, "password") })
        .collect())
}

/// Encrypts the whole list and replaces the file (temp file, then rename: a crash never leaves half a file).
fn save(file: &Path, accounts: &[Account]) -> Result<(), String> {
    let list: Vec<Value> =
        accounts.iter().map(|a| json!({ "id": a.id, "label": a.label, "username": a.username, "password": a.password })).collect();
    let blob = protect(&serde_json::to_vec(&list).map_err(|e| e.to_string())?)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = file.with_extension("dat.tmp");
    fs::write(&tmp, blob).map_err(|e| e.to_string())?;
    fs::rename(&tmp, file).map_err(|e| e.to_string())
}

fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 }
}

/// Copies DPAPI's output and frees it (DPAPI allocates it with LocalAlloc).
fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
    unsafe { LocalFree(out.pbData as _) };
    bytes
}

fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        CryptProtectData(&blob(plain), std::ptr::null(), &blob(ENTROPY), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
    };
    if ok == 0 {
        return Err("could not encrypt the accounts".into());
    }
    Ok(take(out))
}

fn unprotect(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        CryptUnprotectData(
            &blob(encrypted),
            std::ptr::null_mut(),
            &blob(ENTROPY),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        )
    };
    if ok == 0 {
        return Err("accounts.dat can't be decrypted (another Windows user, or damaged)".into());
    }
    Ok(take(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mercury-accounts-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("accounts.dat")
    }

    fn account(id: &str, password: &str) -> Account {
        Account { id: id.into(), label: format!("label {id}"), username: format!("user{id}"), password: password.into() }
    }

    #[test]
    fn dpapi_round_trip_and_tamper() {
        let secret = "hunter2 ünïcödé".as_bytes();
        let encrypted = protect(secret).unwrap();
        assert!(!encrypted.windows(7).any(|w| w == b"hunter2"), "the blob must not hold the plain text");
        assert_eq!(unprotect(&encrypted).unwrap(), secret);
        let mut tampered = encrypted.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x55;
        assert!(unprotect(&tampered).is_err());
    }

    #[test]
    fn file_round_trip_keeps_order_and_passwords() {
        let file = scratch("file");
        assert_eq!(load(&file).unwrap(), Vec::new(), "no file means no accounts");
        let list = vec![account("b", "pw-b"), account("a", "pw-a")];
        save(&file, &list).unwrap();
        let raw = fs::read(&file).unwrap();
        assert!(!raw.windows(4).any(|w| w == b"pw-a"), "the file must be encrypted");
        assert_eq!(load(&file).unwrap(), list);
        fs::write(&file, b"not dpapi").unwrap();
        assert!(load(&file).is_err());
        let _ = fs::remove_dir_all(file.parent().unwrap());
    }

    #[test]
    fn merge_adds_edits_reorders_and_removes() {
        let current = vec![account("a", "pw-a"), account("b", "pw-b"), account("c", "pw-c")];
        let request = json!({ "accounts": [
            { "id": "c", "label": " Main ", "username": "mainname" },
            { "id": "a", "label": "", "username": "usera", "password": "new-a" },
            { "label": "Alt", "username": "alt@example.com", "password": "pw-new" },
        ]});
        let next = merge(&current, &request).unwrap();
        assert_eq!(next.len(), 3, "b was left out, so it is gone");
        assert_eq!((next[0].id.as_str(), next[0].label.as_str(), next[0].password.as_str()), ("c", "Main", "pw-c"));
        assert_eq!((next[1].id.as_str(), next[1].password.as_str()), ("a", "new-a"));
        assert_eq!(next[2].username, "alt@example.com");
        assert_eq!(next[2].id.len(), 16);
        assert!(next[2].id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn merge_rejects_bad_input() {
        let current = vec![account("a", "pw-a")];
        let bad = [
            json!({}),
            json!({ "accounts": [{ "username": "new" }] }),
            json!({ "accounts": [{ "id": "zzz", "username": "x" }] }),
            json!({ "accounts": [{ "id": "a", "username": "x" }, { "id": "a", "username": "y" }] }),
            json!({ "accounts": [{ "id": "a", "username": "" }] }),
            json!({ "accounts": [{ "id": "a", "username": "bad\nname" }] }),
            json!({ "accounts": [{ "id": "a", "username": "x", "label": "l".repeat(MAX_LABEL + 1) }] }),
            json!({ "accounts": [{ "id": "a", "username": "x", "password": "p".repeat(MAX_PASSWORD + 1) }] }),
            json!({ "accounts": [{ "id": "a", "username": "x", "password": 5 }] }),
            json!({ "accounts": vec![json!({ "username": "x", "password": "p" }); MAX_ACCOUNTS + 1] }),
        ];
        for request in bad {
            assert!(merge(&current, &request).is_err(), "accepted {request}");
        }
    }

    #[test]
    fn page_never_sees_passwords() {
        let shown = public(&[account("a", "pw-a")]).to_string();
        assert!(shown.contains("usera") && !shown.contains("pw-a"));
    }
}
