//! Lists the audio sessions on the default playback device: which process plays sound, and how loud right now.
//! Shows whether Mercury's audio comes from the browser process (the one owning the window) or from Chromium's audio
//! service process.
//!
//!     cargo run -p obs-mercury-capture --example audio_sessions

use windows::{
    core::Interface,
    Win32::{
        Media::Audio::{Endpoints::IAudioMeterInformation, *},
        System::Com::*,
    },
};

fn main() -> windows::core::Result<()> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let sessions = manager.GetSessionEnumerator()?;
        for i in 0..sessions.GetCount()? {
            let control = sessions.GetSession(i)?;
            let pid = control.cast::<IAudioSessionControl2>()?.GetProcessId().unwrap_or(0);
            let state = control.GetState()?;
            let state = if state == AudioSessionStateActive {
                "active"
            } else if state == AudioSessionStateInactive {
                "inactive"
            } else {
                "expired"
            };
            let peak = control.cast::<IAudioMeterInformation>().and_then(|m| m.GetPeakValue()).unwrap_or(0.0);
            println!("pid {pid:>6}  {state:<8}  peak {peak:.3}");
        }
    }
    Ok(())
}
