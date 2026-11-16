//! settings.json: one flat JSON object, `"module.key": value`. The page defines every setting and its
//! default (frontend/src); the host only reads the few it needs before the browser starts.

use crate::paths;
use serde_json::{Map, Value};
use std::{fs, io, sync::Mutex};

static SETTINGS: Mutex<Option<Map<String, Value>>> = Mutex::new(None);

/// Loads settings.json once; a missing or broken file means defaults.
pub fn load() {
    let map = paths::settings_file()
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| match v {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default();
    *SETTINGS.lock().unwrap() = Some(map);
}

pub fn all() -> Map<String, Value> {
    SETTINGS.lock().unwrap().clone().unwrap_or_default()
}

pub fn get(key: &str) -> Option<Value> {
    SETTINGS.lock().unwrap().as_ref()?.get(key).cloned()
}

pub fn bool(key: &str, default: bool) -> bool {
    get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

pub fn string(key: &str) -> String {
    get(key).and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
}

/// Replaces every setting and writes the file (write to a temp file, then rename, so a crash never leaves half a file).
pub fn save(map: Map<String, Value>) -> io::Result<()> {
    let file = paths::settings_file().ok_or_else(|| io::Error::other("no data directory"))?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(&Value::Object(map.clone()))?)?;
    fs::rename(&tmp, &file)?;
    *SETTINGS.lock().unwrap() = Some(map);
    Ok(())
}
