//! NVIDIA driver profile for MercuryClient.exe, through NVAPI's driver settings (DRS) API in nvapi64.dll (ships with the
//! driver). Function IDs, structs, status codes and setting IDs come from NVIDIA's MIT-licensed NVAPI SDK headers
//! (nvapi_interface.h, nvapi.h, nvapi_lite_common.h, NvApiDriverSettings.h).
//!
//! The profile lifts the driver's frame caps for Mercury and prefers maximum performance. Removing it deletes the whole
//! profile, which only ever holds Mercury's own entries.

use serde_json::{json, Value};
use std::ffi::c_void;

const PROFILE: &str = "Mercury Client";

/// (setting id, value, what it is).
const SETTINGS: [(u32, u32, &str); 3] = [
    // FRL_FPS_ID = FRL_FPS_DISABLED: no "Max Frame Rate" cap for Mercury, even with a global one.
    (0x10835002, 0, "Max Frame Rate: off"),
    // PREFERRED_PSTATE_ID = PREFERRED_PSTATE_PREFER_MAX.
    (0x1057EB71, 1, "Power management: prefer maximum performance"),
    // VSYNCMODE_ID = VSYNCMODE_PASSIVE: the application decides, even if vsync is forced on globally.
    (0x00A879CF, 0x60925292, "Vertical sync: use the application setting"),
];

const OK: i32 = 0;
const PROFILE_NOT_FOUND: i32 = -163;
const EXECUTABLE_ALREADY_IN_USE: i32 = -167;

// nvapi_interface.h
const INITIALIZE: u32 = 0x0150e828;
const UNLOAD: u32 = 0xd22bdd7e;
const DRS_CREATE_SESSION: u32 = 0x0694d52e;
const DRS_DESTROY_SESSION: u32 = 0xdad9cff8;
const DRS_LOAD_SETTINGS: u32 = 0x375dbd6b;
const DRS_SAVE_SETTINGS: u32 = 0xfcbc7e14;
const DRS_CREATE_PROFILE: u32 = 0xcc176068;
const DRS_DELETE_PROFILE: u32 = 0x17093206;
const DRS_GET_PROFILE_INFO: u32 = 0x61cd6fd6;
const DRS_FIND_PROFILE_BY_NAME: u32 = 0x7e4a9a0b;
const DRS_CREATE_APPLICATION: u32 = 0x4347a9de;
const DRS_FIND_APPLICATION_BY_NAME: u32 = 0xeee566b2;
const DRS_SET_SETTING: u32 = 0x577dd202;
const DRS_GET_SETTING: u32 = 0x73bf8338;

type UnicodeString = [u16; 2048];

/// NVDRS_PROFILE_V1.
#[repr(C)]
struct Profile {
    version: u32,
    name: UnicodeString,
    gpu_support: u32,
    is_predefined: u32,
    num_apps: u32,
    num_settings: u32,
}

/// NVDRS_APPLICATION_V4.
#[repr(C)]
struct Application {
    version: u32,
    is_predefined: u32,
    name: UnicodeString,
    friendly_name: UnicodeString,
    launcher: UnicodeString,
    file_in_folder: UnicodeString,
    bits: u32,
    command_line: UnicodeString,
}

/// NVDRS_SETTING_V1 (pack 4). The two unions are 4100 bytes (NVDRS_BINARY_SETTING); a DWORD sits at their start.
#[repr(C, packed(4))]
struct Setting {
    version: u32,
    name: UnicodeString,
    id: u32,
    setting_type: u32,
    location: u32,
    is_current_predefined: u32,
    is_predefined_valid: u32,
    predefined: [u8; 4100],
    current: [u8; 4100],
}

const _: () = assert!(size_of::<Profile>() == 4116 && size_of::<Application>() == 20492 && size_of::<Setting>() == 12320);

/// MAKE_NVAPI_VERSION.
const fn version<T>(v: u32) -> u32 {
    size_of::<T>() as u32 | (v << 16)
}

fn unicode(s: &str) -> UnicodeString {
    let mut out = [0u16; 2048];
    for (slot, c) in out.iter_mut().zip(s.encode_utf16().take(2047)) {
        *slot = c;
    }
    out
}

/// Zeroed on the heap: these structs are up to 20 KB.
fn boxed<T>() -> Box<T> {
    // SAFETY: plain-old-data structs, valid when zeroed.
    unsafe { Box::new(std::mem::zeroed()) }
}

type Handle = *mut c_void;

/// An open DRS session; destroyed (and NVAPI unloaded) on drop.
struct Drs {
    query: unsafe extern "C" fn(u32) -> *mut c_void,
    session: Handle,
}

impl Drs {
    fn open() -> Result<Drs, String> {
        use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
        let dll: Vec<u16> = "nvapi64.dll\0".encode_utf16().collect();
        // SAFETY: the driver's DLL; nvapi_QueryInterface takes an id and returns a function pointer.
        unsafe {
            let module = LoadLibraryW(dll.as_ptr());
            if module.is_null() {
                return Err("no NVIDIA driver".into());
            }
            let query = GetProcAddress(module, c"nvapi_QueryInterface".as_ptr().cast()).ok_or("no NVAPI")?;
            let query = std::mem::transmute::<unsafe extern "system" fn() -> isize, unsafe extern "C" fn(u32) -> *mut c_void>(query);
            let mut drs = Drs { query, session: std::ptr::null_mut() };
            drs.check(drs.call0(INITIALIZE)?, "NvAPI_Initialize")?;
            let create: unsafe extern "C" fn(*mut Handle) -> i32 = drs.function(DRS_CREATE_SESSION)?;
            let mut session = std::ptr::null_mut();
            drs.check(create(&mut session), "create a session")?;
            drs.session = session;
            let load: unsafe extern "C" fn(Handle) -> i32 = drs.function(DRS_LOAD_SETTINGS)?;
            drs.check(load(session), "load the settings")?;
            Ok(drs)
        }
    }

    fn function<F: Copy>(&self, id: u32) -> Result<F, String> {
        // SAFETY: the id selects a function whose signature the caller names as F.
        let f = unsafe { (self.query)(id) };
        if f.is_null() {
            return Err(format!("NVAPI has no function {id:#x}"));
        }
        Ok(unsafe { std::mem::transmute_copy::<*mut c_void, F>(&f) })
    }

    unsafe fn call0(&self, id: u32) -> Result<i32, String> {
        let f: unsafe extern "C" fn() -> i32 = self.function(id)?;
        Ok(unsafe { f() })
    }

    fn check(&self, status: i32, what: &str) -> Result<(), String> {
        if status == OK { Ok(()) } else { Err(format!("NVAPI could not {what} ({status})")) }
    }

    fn find_profile(&self) -> Result<Option<Handle>, String> {
        let find: unsafe extern "C" fn(Handle, *const u16, *mut Handle) -> i32 = self.function(DRS_FIND_PROFILE_BY_NAME)?;
        let mut profile = std::ptr::null_mut();
        // SAFETY: a session we own, a NUL-terminated 2048-char name, an out handle.
        match unsafe { find(self.session, unicode(PROFILE).as_ptr(), &mut profile) } {
            OK => Ok(Some(profile)),
            PROFILE_NOT_FOUND => Ok(None),
            status => Err(format!("NVAPI could not look up the profile ({status})")),
        }
    }

    fn profile_name(&self, profile: Handle) -> String {
        let Ok(info) = self.function::<unsafe extern "C" fn(Handle, Handle, *mut Profile) -> i32>(DRS_GET_PROFILE_INFO) else {
            return "another profile".into();
        };
        let mut p = boxed::<Profile>();
        p.version = version::<Profile>(1);
        // SAFETY: a versioned out struct.
        if unsafe { info(self.session, profile, &mut *p) } != OK {
            return "another profile".into();
        }
        String::from_utf16_lossy(&p.name).trim_end_matches('\0').to_string()
    }

    /// The name of the profile the driver applies to this exe (by full path), or "" if none.
    fn profile_for(&self, exe: &std::path::Path) -> Result<String, String> {
        let find: unsafe extern "C" fn(Handle, *const u16, *mut Handle, *mut Application) -> i32 = self.function(DRS_FIND_APPLICATION_BY_NAME)?;
        let mut app = boxed::<Application>();
        app.version = version::<Application>(4);
        let mut owner = std::ptr::null_mut();
        // SAFETY: a NUL-terminated path, a versioned out struct and an out handle.
        let found = unsafe { find(self.session, unicode(&exe.to_string_lossy()).as_ptr(), &mut owner, &mut *app) } == OK;
        Ok(if found { self.profile_name(owner) } else { String::new() })
    }

    fn save(&self) -> Result<(), String> {
        let save: unsafe extern "C" fn(Handle) -> i32 = self.function(DRS_SAVE_SETTINGS)?;
        // SAFETY: a session we own.
        self.check(unsafe { save(self.session) }, "save the driver settings")
    }
}

impl Drop for Drs {
    fn drop(&mut self) {
        // SAFETY: the session we created, then NVAPI's own unload.
        unsafe {
            if !self.session.is_null()
                && let Ok(destroy) = self.function::<unsafe extern "C" fn(Handle) -> i32>(DRS_DESTROY_SESSION)
            {
                destroy(self.session);
            }
            let _ = self.call0(UNLOAD);
        }
    }
}

/// For the system check: is there an NVIDIA driver, does Mercury's profile exist, and which profile does the driver
/// apply to `exe`?
pub fn status(exe: &std::path::Path) -> Value {
    let applied = Drs::open().and_then(|drs| drs.profile_for(exe));
    match (read(), applied) {
        (Ok(profile), Ok(applied)) => json!({ "available": true, "profile": profile.is_some(), "applied": applied }),
        _ => json!({ "available": false, "profile": false }),
    }
}

/// Creates (or recreates) the "Mercury Client" profile with MercuryClient.exe and SETTINGS, then checks that the driver
/// would apply it to `exe` (Mercury's own MercuryClient.exe).
pub fn apply(exe: &std::path::Path) -> Result<Value, String> {
    let drs = Drs::open()?;
    if let Some(old) = drs.find_profile()? {
        let delete: unsafe extern "C" fn(Handle, Handle) -> i32 = drs.function(DRS_DELETE_PROFILE)?;
        // SAFETY: the profile handle from this session. Nothing is kept unless `save` runs.
        drs.check(unsafe { delete(drs.session, old) }, "replace the old profile")?;
    }
    let create: unsafe extern "C" fn(Handle, *mut Profile, *mut Handle) -> i32 = drs.function(DRS_CREATE_PROFILE)?;
    let mut info = boxed::<Profile>();
    info.version = version::<Profile>(1);
    info.name = unicode(PROFILE);
    let mut profile = std::ptr::null_mut();
    // SAFETY: a versioned profile struct and an out handle.
    drs.check(unsafe { create(drs.session, &mut *info, &mut profile) }, "create the profile")?;

    // The driver keys applications by exe name. NVIDIA's predefined profiles already claim a bare "mercury.exe"
    // (Gotham Knights, in driver 621.01) and DRS refuses a second entry for it, which is why Mercury ships as
    // MercuryClient.exe. The conflict check below stays for any future clash.
    let name = exe.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("no exe name")?;
    let create_app: unsafe extern "C" fn(Handle, Handle, *mut Application) -> i32 = drs.function(DRS_CREATE_APPLICATION)?;
    let mut app = boxed::<Application>();
    app.version = version::<Application>(4);
    app.name = unicode(&name);
    app.friendly_name = unicode(PROFILE);
    // SAFETY: a versioned application struct.
    match unsafe { create_app(drs.session, profile, &mut *app) } {
        OK => {}
        EXECUTABLE_ALREADY_IN_USE => {
            let owner = drs.profile_for(exe)?;
            return Err(format!("NVIDIA's driver already has {name} in its \"{owner}\" profile, so Mercury can't have its own"));
        }
        status => return Err(format!("NVAPI could not add {name} ({status})")),
    }

    let set: unsafe extern "C" fn(Handle, Handle, *mut Setting) -> i32 = drs.function(DRS_SET_SETTING)?;
    for (id, value, what) in SETTINGS {
        let mut setting = boxed::<Setting>();
        setting.version = version::<Setting>(1);
        setting.id = id;
        setting.current[..4].copy_from_slice(&value.to_le_bytes());
        // SAFETY: a versioned DWORD setting (setting_type 0 = NVDRS_DWORD_TYPE).
        drs.check(unsafe { set(drs.session, profile, &mut *setting) }, &format!("set {what}"))?;
    }
    drs.save()?;
    // With a full path, FindApplicationByName returns the profile the driver will apply when that exe runs.
    let applied = drs.profile_for(exe)?;
    if applied != PROFILE {
        // Leave nothing behind that does nothing.
        drop(drs);
        remove()?;
        return Err(format!("the driver would still use the profile \"{applied}\" for {}", exe.display()));
    }
    Ok(json!({ "profile": PROFILE, "settings": SETTINGS.iter().map(|s| s.2).collect::<Vec<_>>() }))
}

/// Deletes the profile (and with it MercuryClient.exe's entry). Nothing to do if it isn't there.
pub fn remove() -> Result<Value, String> {
    let drs = Drs::open()?;
    if let Some(profile) = drs.find_profile()? {
        let delete: unsafe extern "C" fn(Handle, Handle) -> i32 = drs.function(DRS_DELETE_PROFILE)?;
        // SAFETY: the profile handle from this session.
        drs.check(unsafe { delete(drs.session, profile) }, "delete the profile")?;
        drs.save()?;
    }
    Ok(Value::Null)
}

/// The profile's DWORD values for SETTINGS, as the driver reports them; `None` without a profile.
pub fn read() -> Result<Option<Vec<(u32, u32)>>, String> {
    let drs = Drs::open()?;
    let Some(profile) = drs.find_profile()? else { return Ok(None) };
    let get: unsafe extern "C" fn(Handle, Handle, u32, *mut Setting) -> i32 = drs.function(DRS_GET_SETTING)?;
    let mut values = Vec::new();
    for (id, ..) in SETTINGS {
        let mut setting = boxed::<Setting>();
        setting.version = version::<Setting>(1);
        // SAFETY: a versioned out struct.
        drs.check(unsafe { get(drs.session, profile, id, &mut *setting) }, "read a setting")?;
        values.push((id, u32::from_le_bytes(setting.current[..4].try_into().unwrap_or_default())));
    }
    Ok(Some(values))
}

#[cfg(test)]
mod tests {
    /// On the real driver: creates the profile for a made-up exe (never the player's own MercuryClient.exe), checks the
    /// driver would apply it and reads it back, deletes it, and checks it's gone.
    #[test]
    #[ignore = "changes the NVIDIA driver settings (and undoes it); run by hand: cargo test -p mercury -- --ignored nvidia"]
    fn nvidia_profile_round_trip() {
        if super::remove().is_err() {
            return; // no NVIDIA driver
        }
        let exe = std::path::Path::new(r"C:\mercury-test\does-not-exist\mercury-nvapi-test.exe");
        let applied = super::apply(exe);
        let values = super::read();
        super::remove().unwrap();
        applied.unwrap();
        assert_eq!(values.unwrap().expect("profile exists"), super::SETTINGS.map(|(id, v, _)| (id, v)));
        assert_eq!(super::read().unwrap(), None);
    }
}
