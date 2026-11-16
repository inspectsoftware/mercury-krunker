//! `files.*` bridge commands: the page's managers (swapper, CSS, userscripts, sounds) read and write files in a few
//! fixed folders under the data directory, and nowhere else.

use crate::{paths, resources};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

/// The only folders the page may touch.
pub const DIRS: &[&str] = &["swap", "css", "scripts", "sounds", "images"];

pub fn dir(name: &str) -> Result<PathBuf, String> {
    if !DIRS.contains(&name) {
        return Err(format!("no such folder: {name}"));
    }
    let dir = paths::data_dir().ok_or("no data directory")?.join(name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// `folder` + a relative path from the page; refuses anything that could leave the folder.
fn resolve(request: &Value) -> Result<PathBuf, String> {
    let rel = request["path"].as_str().unwrap_or_default();
    let rel_path = Path::new(rel);
    if rel.is_empty() || !rel_path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("bad path: {rel}"));
    }
    Ok(dir(request["dir"].as_str().unwrap_or_default())?.join(rel_path))
}

/// Every file under `root`, as '/'-separated paths relative to it.
pub fn walk(root: &Path) -> Vec<(String, fs::Metadata)> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(path);
            } else if let Ok(rel) = path.strip_prefix(root) {
                out.push((rel.to_string_lossy().replace('\\', "/"), meta));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

pub fn command(cmd: &str, request: &Value) -> Result<Value, String> {
    let folder = request["dir"].as_str().unwrap_or_default();
    let result = match cmd {
        "files.list" => {
            let root = dir(folder)?;
            let list: Vec<Value> = walk(&root)
                .into_iter()
                .map(|(path, meta)| {
                    let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
                    json!({ "path": path, "size": meta.len(), "modified": modified })
                })
                .collect();
            return Ok(json!(list));
        }
        "files.read" => {
            let bytes = fs::read(resolve(request)?).map_err(|e| e.to_string())?;
            return Ok(match request["encoding"].as_str() {
                Some("base64") => json!(BASE64.encode(bytes)),
                _ => json!(String::from_utf8_lossy(&bytes)),
            });
        }
        "files.write" => {
            let path = resolve(request)?;
            let bytes = match (request["text"].as_str(), request["base64"].as_str()) {
                (Some(text), _) => text.as_bytes().to_vec(),
                (None, Some(b64)) => BASE64.decode(b64).map_err(|e| e.to_string())?,
                _ => return Err("nothing to write".into()),
            };
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(path, bytes).map_err(|e| e.to_string())
        }
        "files.delete" => fs::remove_file(resolve(request)?).map_err(|e| e.to_string()),
        "files.reveal" => {
            // Our own data folder, so handing it to Explorer is safe.
            std::process::Command::new("explorer").arg(dir(folder)?).spawn().map(drop).map_err(|e| e.to_string())
        }
        _ => return Err(format!("unknown command {cmd}")),
    };
    if folder == "swap" {
        resources::reload_swaps();
    }
    result.map(|_| Value::Null)
}
