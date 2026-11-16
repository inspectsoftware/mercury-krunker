//! `discord.*`: Discord Rich Presence over Discord's local IPC, the named pipe `\\.\pipe\discord-ipc-N`.
//! A frame is `opcode: u32 LE, length: u32 LE, JSON`. The handshake (op 0) carries the application's client ID, then
//! each SET_ACTIVITY is a command frame (op 1) that Discord answers. Closing the pipe clears the presence.
//! The page sends the activity's fields; the host checks them and builds the JSON itself.

use serde_json::{json, Map, Value};
use std::{
    fs::{File, OpenOptions},
    io::{self, Read, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

const HANDSHAKE: u32 = 0;
const FRAME: u32 = 1;
const CLOSE: u32 = 2;
const PING: u32 = 3;
const PONG: u32 = 4;

struct Connection {
    client_id: String,
    pipe: File,
}

static CONNECTION: Mutex<Option<Connection>> = Mutex::new(None);

pub fn command(cmd: &str, request: &Value) -> Result<Value, String> {
    match cmd {
        "discord.activity" => {
            let client_id = request["clientId"].as_str().unwrap_or_default();
            if !valid_client_id(client_id) {
                return Err("the Discord application ID must be its 17 to 20 digit number".into());
            }
            set_activity(client_id, activity(&request["activity"])?)
        }
        "discord.clear" => {
            // Discord drops the presence of a closed connection.
            if let Ok(mut connection) = CONNECTION.try_lock() {
                connection.take();
            }
            Ok(Value::Null)
        }
        _ => Err(format!("unknown command {cmd}")),
    }
}

fn valid_client_id(id: &str) -> bool {
    (17..=20).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit())
}

/// Discord's text fields take 2 to 128 characters; shorter ones are left out, longer ones cut.
fn text(value: &Value, max: usize) -> Option<String> {
    let text: String = value.as_str()?.trim().chars().take(max).collect();
    (text.chars().count() >= 2).then_some(text)
}

/// The page's activity fields → Discord's activity object. Only a Krunker link may be a button.
fn activity(page: &Value) -> Result<Value, String> {
    if page.is_null() {
        return Ok(Value::Null);
    }
    if !page.is_object() {
        return Err("activity must be an object".into());
    }
    let mut activity = Map::new();
    for key in ["details", "state"] {
        if let Some(t) = text(&page[key], 128) {
            activity.insert(key.into(), json!(t));
        }
    }
    let mut timestamps = Map::new();
    for key in ["start", "end"] {
        if let Some(ms) = page[key].as_u64().filter(|&ms| ms > 0) {
            timestamps.insert(key.into(), json!(ms));
        }
    }
    if !timestamps.is_empty() {
        activity.insert("timestamps".into(), Value::Object(timestamps));
    }
    if let Some(url) = page["joinUrl"].as_str() {
        if crate::mods::game_link(url).as_deref() != Some(url) {
            return Err("the join button only takes a krunker.io game link".into());
        }
        activity.insert("buttons".into(), json!([{ "label": "Join", "url": url }]));
    }
    // The Mercury icon: the Rich Presence art asset named "mercury" in the Discord application (assets/brand/icon-1024.png).
    activity.insert("assets".into(), json!({ "large_image": "mercury", "large_text": "Mercury Client" }));
    Ok(Value::Object(activity))
}

fn frame(op: u32, payload: &Value) -> Vec<u8> {
    let body = payload.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

fn read_frame(reader: &mut impl Read) -> io::Result<(u32, Value)> {
    let mut header = [0u8; 8];
    reader.read_exact(&mut header)?;
    let op = u32::from_le_bytes(header[..4].try_into().unwrap());
    let len = u32::from_le_bytes(header[4..].try_into().unwrap()) as usize;
    if len > 1 << 20 {
        return Err(io::Error::other("frame too large"));
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body)?;
    Ok((op, serde_json::from_slice(&body).unwrap_or_default()))
}

fn nonce() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!("mercury-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed))
}

/// Reads until the reply to `nonce` (or the READY event when `nonce` is None), answering pings on the way.
fn reply(pipe: &mut File, nonce: Option<&str>) -> Result<Value, String> {
    loop {
        let (op, body) = read_frame(pipe).map_err(|e| e.to_string())?;
        match op {
            PING => pipe.write_all(&frame(PONG, &body)).map_err(|e| e.to_string())?,
            CLOSE => return Err(body["message"].as_str().unwrap_or("Discord closed the connection").to_string()),
            FRAME if body["evt"] == "ERROR" => {
                return Err(body["data"]["message"].as_str().unwrap_or("Discord error").to_string());
            }
            FRAME if nonce.is_none_or(|n| body["nonce"] == n) => return Ok(body),
            _ => {}
        }
    }
}

fn connect(client_id: &str) -> Result<Connection, String> {
    let mut pipe = (0..10)
        .find_map(|i| OpenOptions::new().read(true).write(true).open(format!(r"\\.\pipe\discord-ipc-{i}")).ok())
        .ok_or("Discord is not running")?;
    pipe.write_all(&frame(HANDSHAKE, &json!({ "v": 1, "client_id": client_id }))).map_err(|e| e.to_string())?;
    reply(&mut pipe, None)?;
    Ok(Connection { client_id: client_id.into(), pipe })
}

fn set_activity(client_id: &str, activity: Value) -> Result<Value, String> {
    // The pipe blocks; a call that finds another one waiting on Discord gives up instead of queueing behind it.
    let Ok(mut connection) = CONNECTION.try_lock() else { return Err("busy".into()) };
    if connection.as_ref().is_some_and(|c| c.client_id != client_id) {
        connection.take();
    }
    let mut args = json!({ "pid": std::process::id() });
    if !activity.is_null() {
        args["activity"] = activity;
    }
    // A kept connection may be stale (Discord restarted): reconnect once.
    for attempt in 0..2 {
        if connection.is_none() {
            *connection = Some(connect(client_id)?);
        }
        let pipe = &mut connection.as_mut().unwrap().pipe;
        let nonce = nonce();
        let sent = pipe.write_all(&frame(FRAME, &json!({ "cmd": "SET_ACTIVITY", "args": args, "nonce": nonce })));
        match sent.map_err(|e| e.to_string()).and_then(|_| reply(pipe, Some(&nonce))) {
            Ok(_) => return Ok(Value::Null),
            Err(error) => {
                connection.take();
                if attempt == 1 {
                    return Err(error);
                }
            }
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_little_endian_op_length_json() {
        let bytes = frame(HANDSHAKE, &json!({ "v": 1 }));
        assert_eq!(&bytes[..8], &[0, 0, 0, 0, 7, 0, 0, 0]);
        assert_eq!(&bytes[8..], br#"{"v":1}"#);
        let (op, body) = read_frame(&mut &frame(FRAME, &json!({ "cmd": "X" }))[..]).unwrap();
        assert_eq!((op, body), (FRAME, json!({ "cmd": "X" })));
    }

    #[test]
    fn truncated_frames_fail() {
        let bytes = frame(FRAME, &json!({ "cmd": "X" }));
        assert!(read_frame(&mut &bytes[..bytes.len() - 1]).is_err());
        assert!(read_frame(&mut &bytes[..5]).is_err());
    }

    #[test]
    fn client_ids_are_snowflakes() {
        assert!(valid_client_id("1234567890123456789"));
        assert!(!valid_client_id(""));
        assert!(!valid_client_id("12345"));
        assert!(!valid_client_id("123456789012345678x"));
    }

    #[test]
    fn activity_keeps_only_checked_fields() {
        let page = json!({
            "details": "Free for All on Burg",
            "state": "x",
            "start": 1_700_000_000_000u64,
            "end": -5,
            "joinUrl": "https://krunker.io/?game=FRA:abc12",
            "evil": "field",
        });
        let built = activity(&page).unwrap();
        assert_eq!(
            built,
            json!({
                "details": "Free for All on Burg",
                "timestamps": { "start": 1_700_000_000_000u64 },
                "buttons": [{ "label": "Join", "url": "https://krunker.io/?game=FRA:abc12" }],
                "assets": { "large_image": "mercury", "large_text": "Mercury Client" },
            })
        );
        assert_eq!(activity(&json!({ "details": "é".repeat(200) })).unwrap()["details"].as_str().unwrap().chars().count(), 128);
        assert!(activity(&json!({ "joinUrl": "https://evil.example/?game=x" })).is_err());
        assert!(activity(&json!("text")).is_err());
        assert_eq!(activity(&Value::Null).unwrap(), Value::Null);
    }
}
