//! `media.current`: what Windows' media session is playing. Spotify, browsers and most players report to the system
//! media controls (the volume flyout), so this works with any of them. WinRT, read-only.

use serde_json::{json, Value};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};

pub fn command(cmd: &str, _request: &Value) -> Result<Value, String> {
    match cmd {
        "media.current" => current().map_err(|e| e.message()),
        _ => Err(format!("unknown command {cmd}")),
    }
}

/// `{title, artist, playing, app}`, or null when nothing reports a session.
fn current() -> windows::core::Result<Value> {
    let manager = Manager::RequestAsync()?.join()?;
    // No session is an error (a null result), not a failure.
    let Ok(session) = manager.GetCurrentSession() else { return Ok(Value::Null) };
    let props = session.TryGetMediaPropertiesAsync()?.join()?;
    let playing = session.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing;
    Ok(json!({
        "title": props.Title()?.to_string(),
        "artist": props.Artist()?.to_string(),
        "playing": playing,
        "app": session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default(),
    }))
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_the_session_without_error() {
        // Whatever plays (or nothing), the WinRT call itself must work from a plain worker thread.
        let value = super::current().expect("media session manager");
        assert!(value.is_null() || value["playing"].is_boolean(), "{value}");
    }
}
