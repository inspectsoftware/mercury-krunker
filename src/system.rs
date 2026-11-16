//! `system.*` bridge commands: the Windows settings Mercury may change, each opt-in and undone by Mercury.
//! - GPU preference: Windows' per-app "High performance" GPU for mercury.exe (until the player turns it off).
//! - Power Boost: Windows' Best performance power mode while Mercury runs on AC power (restored on exit).
//! - NVIDIA profile (nvidia.rs): a driver profile for mercury.exe (until the player turns it off).
//!
//! Before changing anything, the previous value goes into `<data>/system-restore.json`, so turning a setting off, a
//! normal exit, or the next start after a crash puts it back exactly.

use crate::{nvidia, paths, settings};
use serde_json::{json, Map, Value};
use std::sync::Mutex;
use windows_sys::{
    core::GUID,
    Win32::{
        Foundation::{LocalFree, ERROR_SUCCESS},
        System::{
            LibraryLoader::{GetProcAddress, LoadLibraryW},
            Power::{GetSystemPowerStatus, PowerGetActiveScheme, PowerReadFriendlyName, PowerSetActiveScheme, SYSTEM_POWER_STATUS},
            Registry::{
                RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_SZ, RRF_RT_REG_DWORD,
                RRF_RT_REG_SZ,
            },
        },
    },
};

static JOURNAL: Mutex<()> = Mutex::new(());

fn journal_file() -> Option<std::path::PathBuf> {
    paths::data_dir().map(|d| d.join("system-restore.json"))
}

/// Read-modify-write of the restore journal, one at a time.
fn edit_journal<R>(f: impl FnOnce(&mut Map<String, Value>) -> R) -> R {
    let _lock = JOURNAL.lock().unwrap_or_else(|e| e.into_inner());
    let file = journal_file();
    let mut map = file
        .as_ref()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let before = map.clone();
    let result = f(&mut map);
    if let Some(file) = file.filter(|_| map != before) {
        let _ = if map.is_empty() {
            std::fs::remove_file(&file)
        } else {
            let tmp = file.with_extension("json.tmp");
            std::fs::write(&tmp, serde_json::to_vec_pretty(&map).unwrap_or_default()).and_then(|_| std::fs::rename(&tmp, &file))
        };
    }
    result
}

pub fn command(cmd: &str, request: &Value) -> Result<Value, String> {
    let on = request["on"].as_bool().ok_or("on must be true or false")?;
    match cmd {
        "system.gpuPreference" => set_gpu_preference(on),
        "system.powerBoost" => {
            if on {
                apply_power_boost()
            } else {
                restore_power();
                Ok(power_status())
            }
        }
        "system.nvidiaProfile" => {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let result = if on { nvidia::apply(&exe) } else { nvidia::remove() };
            if result.is_ok() {
                edit_journal(|j| if on { j.insert("nvidiaProfile".into(), json!(true)) } else { j.remove("nvidiaProfile") });
            }
            result
        }
        _ => Err(format!("unknown command {cmd}")),
    }
}

/// Startup: undo what a crashed run left behind, then boost if the player wants it.
pub fn start() {
    std::thread::spawn(|| {
        restore_power();
        if settings::bool("perf.powerBoost", false) {
            let _ = apply_power_boost();
        }
    });
}

/// Exit: the power mode goes back.
pub fn stop() {
    restore_power();
}

// --- Registry ---

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain([0]).collect()
}

fn reg_string(root: HKEY, key: &str, name: &str) -> Option<String> {
    let (key, name) = (wide(key), wide(name));
    let mut buf = vec![0u16; 1024];
    let mut size = (buf.len() * 2) as u32;
    // SAFETY: `buf` holds `size` bytes.
    let status = unsafe {
        RegGetValueW(root, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size)
    };
    (status == ERROR_SUCCESS).then(|| String::from_utf16_lossy(&buf[..(size as usize / 2)]).trim_end_matches('\0').to_string())
}

fn reg_dword(root: HKEY, key: &str, name: &str) -> Option<u32> {
    let (key, name) = (wide(key), wide(name));
    let (mut value, mut size) = (0u32, 4u32);
    // SAFETY: a 4-byte out value.
    let status = unsafe {
        RegGetValueW(root, key.as_ptr(), name.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), (&raw mut value).cast(), &mut size)
    };
    (status == ERROR_SUCCESS).then_some(value)
}

fn reg_set_string(root: HKEY, key: &str, name: &str, value: &str) -> Result<(), String> {
    let (key, name, value) = (wide(key), wide(name), wide(value));
    // SAFETY: `value` is a NUL-terminated UTF-16 string of the given byte size.
    let status = unsafe { RegSetKeyValueW(root, key.as_ptr(), name.as_ptr(), REG_SZ, value.as_ptr().cast(), (value.len() * 2) as u32) };
    if status == ERROR_SUCCESS { Ok(()) } else { Err(format!("registry write failed ({status})")) }
}

fn reg_delete(root: HKEY, key: &str, name: &str) {
    let (key, name) = (wide(key), wide(name));
    // SAFETY: NUL-terminated strings.
    unsafe { RegDeleteKeyValueW(root, key.as_ptr(), name.as_ptr()) };
}

// --- GPU preference ---

const GPU_PREFERENCES: &str = r"Software\Microsoft\DirectX\UserGpuPreferences";

fn exe() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Windows keeps several `key=value;` pairs in one string ("GpuPreference=2;SwapEffectUpgradeEnable=1;"): set ours,
/// keep the rest.
fn with_gpu_preference(existing: Option<&str>, preference: u32) -> String {
    let others = existing.unwrap_or("").split(';').map(str::trim).filter(|p| !p.is_empty() && !p.starts_with("GpuPreference="));
    std::iter::once(format!("GpuPreference={preference}")).chain(others.map(String::from)).map(|p| p + ";").collect()
}

fn gpu_preference_of(value: &str) -> Option<u32> {
    value.split(';').find_map(|p| p.trim().strip_prefix("GpuPreference=")?.parse().ok())
}

pub fn gpu_preference() -> Value {
    let value = reg_string(HKEY_CURRENT_USER, GPU_PREFERENCES, &exe());
    let preference = value.as_deref().and_then(gpu_preference_of);
    json!({ "value": value, "highPerformance": preference == Some(2), "set": edit_journal(|j| j.contains_key("gpuPreference")) })
}

fn set_gpu_preference(on: bool) -> Result<Value, String> {
    set_gpu_preference_for(&exe(), on)?;
    Ok(gpu_preference())
}

fn set_gpu_preference_for(exe: &str, on: bool) -> Result<(), String> {
    let current = reg_string(HKEY_CURRENT_USER, GPU_PREFERENCES, exe);
    edit_journal(|journal| {
        if on {
            let wanted = with_gpu_preference(current.as_deref(), 2);
            if current.as_deref() == Some(wanted.as_str()) {
                return Ok(());
            }
            // Keep the first previous value: a second "on" must not overwrite it with ours.
            journal.entry("gpuPreference").or_insert(json!({ "exe": exe, "previous": current }));
            reg_set_string(HKEY_CURRENT_USER, GPU_PREFERENCES, exe, &wanted)
        } else {
            let Some(entry) = journal.remove("gpuPreference") else { return Ok(()) };
            let exe = entry["exe"].as_str().unwrap_or(exe);
            match entry["previous"].as_str() {
                Some(previous) => reg_set_string(HKEY_CURRENT_USER, GPU_PREFERENCES, exe, previous),
                None => {
                    reg_delete(HKEY_CURRENT_USER, GPU_PREFERENCES, exe);
                    Ok(())
                }
            }
        }
    })
}

// --- Power Boost ---

const fn guid(data1: u32, data2: u16, data3: u16, data4: [u8; 8]) -> GUID {
    GUID { data1, data2, data3, data4 }
}

/// Windows 10/11 power mode slider ("overlay") on the Balanced plan.
const OVERLAYS: [(GUID, &str); 4] = [
    (guid(0x961cc777, 0x2547, 0x4f9d, [0x81, 0x74, 0x7d, 0x86, 0x18, 0x1b, 0x8a, 0x7a]), "Best power efficiency"),
    (guid(0, 0, 0, [0; 8]), "Balanced"),
    (guid(0x3af9b8d9, 0x7c97, 0x431d, [0xad, 0x78, 0x34, 0xa8, 0xbf, 0xea, 0x43, 0x9f]), "Better performance"),
    (guid(0xded574b5, 0x45a0, 0x4f42, [0x87, 0x37, 0x46, 0x34, 0x5c, 0x09, 0xc2, 0x38]), "Best performance"),
];
const BEST_PERFORMANCE: GUID = OVERLAYS[3].0;
const HIGH_PERFORMANCE_PLAN: GUID = guid(0x8c5e7fda, 0xe8bf, 0x4a96, [0x9a, 0x85, 0xa6, 0xe2, 0x3a, 0x8c, 0x63, 0x5c]);

fn guid_string(g: &GUID) -> String {
    let d = g.data4;
    format!(
        "{:08x}-{:04x}-{:04x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        g.data1, g.data2, g.data3, d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]
    )
}

fn parse_guid(s: &str) -> Option<GUID> {
    let hex: String = s.chars().filter(|c| *c != '-').collect();
    if hex.len() != 32 {
        return None;
    }
    let n = u128::from_str_radix(&hex, 16).ok()?;
    let mut data4 = [0u8; 8];
    data4.copy_from_slice(&n.to_be_bytes()[8..]);
    Some(guid((n >> 96) as u32, (n >> 80) as u16, (n >> 64) as u16, data4))
}

fn same(a: &GUID, b: &GUID) -> bool {
    guid_string(a) == guid_string(b)
}

fn on_ac() -> bool {
    // SAFETY: an out struct.
    let mut status: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    unsafe { GetSystemPowerStatus(&mut status) != 0 && status.ACLineStatus == 1 }
}

/// powrprof.dll's power mode functions: exported since Windows 10 1709 but not in the SDK headers. `Set` takes the GUID
/// by value, which the x64 ABI passes as a pointer.
type OverlayFn = unsafe extern "system" fn(*mut GUID) -> u32;

fn overlay_fn(name: &std::ffi::CStr) -> Option<OverlayFn> {
    // SAFETY: a system DLL; the functions have the signature above.
    unsafe {
        let module = LoadLibraryW(wide("powrprof.dll").as_ptr());
        if module.is_null() {
            return None;
        }
        GetProcAddress(module, name.as_ptr().cast()).map(|f| std::mem::transmute::<_, OverlayFn>(f))
    }
}

fn overlay() -> Option<GUID> {
    let get = overlay_fn(c"PowerGetActualOverlayScheme")?;
    let mut g = guid(0, 0, 0, [0; 8]);
    // SAFETY: an out GUID.
    (unsafe { get(&mut g) } == 0).then_some(g)
}

fn set_overlay(mut g: GUID) -> bool {
    // SAFETY: see OverlayFn.
    overlay_fn(c"PowerSetActiveOverlayScheme").is_some_and(|set| unsafe { set(&mut g) } == 0)
}

fn active_plan() -> Option<GUID> {
    let mut raw = std::ptr::null_mut();
    // SAFETY: Windows allocates the GUID; we copy it and free it.
    unsafe {
        if PowerGetActiveScheme(std::ptr::null_mut(), &mut raw) != 0 || raw.is_null() {
            return None;
        }
        let g = *raw;
        LocalFree(raw.cast());
        Some(g)
    }
}

fn plan_name(plan: &GUID) -> String {
    let mut buf = [0u16; 256];
    let mut size = (buf.len() * 2) as u32;
    // SAFETY: `buf` holds `size` bytes.
    let status =
        unsafe { PowerReadFriendlyName(std::ptr::null_mut(), plan, std::ptr::null(), std::ptr::null(), buf.as_mut_ptr().cast(), &mut size) };
    if status != 0 {
        return guid_string(plan);
    }
    String::from_utf16_lossy(&buf[..(size as usize / 2)]).trim_end_matches('\0').to_string()
}

pub fn power_status() -> Value {
    let plan = active_plan();
    let mode = overlay();
    json!({
        "ac": on_ac(),
        "plan": plan.as_ref().map(plan_name),
        "highPerformancePlan": plan.as_ref().is_some_and(|p| same(p, &HIGH_PERFORMANCE_PLAN)),
        "mode": mode.as_ref().map(|m| OVERLAYS.iter().find(|(g, _)| same(g, m)).map_or_else(|| guid_string(m), |(_, n)| n.to_string())),
        "bestPerformance": mode.as_ref().is_some_and(|m| same(m, &BEST_PERFORMANCE)),
        "boosted": edit_journal(|j| j.contains_key("power")),
    })
}

/// Best performance power mode, or the High performance plan where there is no power mode slider. Only on AC power:
/// the mode Windows changes is the one for the current power source.
fn apply_power_boost() -> Result<Value, String> {
    if !on_ac() {
        return Err("Power Boost only works on AC power".into());
    }
    edit_journal(|journal| -> Result<(), String> {
        if journal.contains_key("power") {
            return Ok(());
        }
        if let Some(current) = overlay() {
            if same(&current, &BEST_PERFORMANCE) {
                return Ok(());
            }
            if set_overlay(BEST_PERFORMANCE) {
                journal.insert("power".into(), json!({ "mode": guid_string(&current) }));
                return Ok(());
            }
        }
        let plan = active_plan().ok_or("no power plan")?;
        if same(&plan, &HIGH_PERFORMANCE_PLAN) {
            return Ok(());
        }
        // SAFETY: a GUID pointer.
        if unsafe { PowerSetActiveScheme(std::ptr::null_mut(), &HIGH_PERFORMANCE_PLAN) } != 0 {
            return Err("Windows refused the High performance plan".into());
        }
        journal.insert("power".into(), json!({ "plan": guid_string(&plan) }));
        Ok(())
    })?;
    Ok(power_status())
}

/// Puts the power mode or plan back, unless the player changed it since. Waits for AC power: on battery, Windows would
/// apply the mode to the battery side instead.
fn restore_power() {
    if !on_ac() {
        return;
    }
    edit_journal(|journal| {
        let Some(entry) = journal.remove("power") else { return };
        if let Some(previous) = entry["mode"].as_str().and_then(parse_guid) {
            if overlay().is_some_and(|m| same(&m, &BEST_PERFORMANCE)) {
                set_overlay(previous);
            }
        } else if let Some(previous) = entry["plan"].as_str().and_then(parse_guid)
            && active_plan().is_some_and(|p| same(&p, &HIGH_PERFORMANCE_PLAN))
        {
            // SAFETY: a GUID pointer.
            unsafe { PowerSetActiveScheme(std::ptr::null_mut(), &previous) };
        }
    });
}

// --- Read-only checks ---

/// Game Mode: on unless the player turned it off (Windows' default is on).
pub fn game_mode() -> Value {
    let raw = reg_dword(HKEY_CURRENT_USER, r"Software\Microsoft\GameBar", "AutoGameModeEnabled");
    json!({ "on": raw != Some(0) })
}

/// Hardware-accelerated GPU scheduling: HwSchMode 2 = on, 1 = off, missing = Windows' default (off on Windows 10).
pub fn hags() -> Value {
    let raw = reg_dword(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers", "HwSchMode");
    json!({ "on": raw == Some(2), "raw": raw })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpu_preference_value_keeps_other_pairs() {
        assert_eq!(with_gpu_preference(None, 2), "GpuPreference=2;");
        assert_eq!(with_gpu_preference(Some(""), 2), "GpuPreference=2;");
        assert_eq!(with_gpu_preference(Some("GpuPreference=1;SwapEffectUpgradeEnable=1;"), 2), "GpuPreference=2;SwapEffectUpgradeEnable=1;");
        assert_eq!(with_gpu_preference(Some("SwapEffectUpgradeEnable=0;"), 2), "GpuPreference=2;SwapEffectUpgradeEnable=0;");
        assert_eq!(gpu_preference_of("SwapEffectUpgradeEnable=1;GpuPreference=2;"), Some(2));
        assert_eq!(gpu_preference_of("SwapEffectUpgradeEnable=1;"), None);
    }

    #[test]
    fn guids_round_trip() {
        let s = "ded574b5-45a0-4f42-8737-46345c09c238";
        assert_eq!(guid_string(&parse_guid(s).unwrap()), s);
        assert!(same(&parse_guid(s).unwrap(), &BEST_PERFORMANCE));
        assert!(parse_guid("not a guid").is_none());
    }

    /// Power Boost on the real machine: from Balanced, boost gives Best performance and restore gives Balanced back.
    /// Puts the power mode the machine had back at the end. Needs AC power.
    #[test]
    #[ignore = "changes the power mode (and undoes it); run by hand: cargo test -p mercury -- --ignored power_boost_round_trip"]
    fn power_boost_round_trip() {
        let dir = std::env::temp_dir().join(format!("mercury-power-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        unsafe { std::env::set_var("MERCURY_DATA_DIR", &dir) };
        assert!(on_ac(), "needs AC power");
        let original = overlay().expect("no power mode slider");
        let balanced = OVERLAYS[1].0;
        assert!(set_overlay(balanced));
        apply_power_boost().unwrap();
        let boosted = overlay().unwrap();
        let journal = std::fs::read_to_string(dir.join("system-restore.json")).unwrap_or_default();
        restore_power();
        let restored = overlay().unwrap();
        let journal_left = dir.join("system-restore.json").exists();
        set_overlay(original);
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(same(&boosted, &BEST_PERFORMANCE), "boost: {}", guid_string(&boosted));
        assert!(journal.contains("00000000-0000-0000-0000-000000000000"), "journal: {journal}");
        assert!(same(&restored, &balanced), "restore: {}", guid_string(&restored));
        assert!(!journal_left);
        assert!(same(&overlay().unwrap(), &original));
    }

    /// Writes and restores a GPU preference for a made-up exe path in the real registry (HKCU), then checks it's gone.
    #[test]
    #[ignore = "touches HKCU; run by hand: cargo test -p mercury -- --ignored gpu_preference_round_trip"]
    fn gpu_preference_round_trip() {
        let dir = std::env::temp_dir().join(format!("mercury-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        unsafe { std::env::set_var("MERCURY_DATA_DIR", &dir) };
        let exe = r"C:\mercury-test\does-not-exist\mercury.exe";
        reg_set_string(HKEY_CURRENT_USER, GPU_PREFERENCES, exe, "GpuPreference=1;SwapEffectUpgradeEnable=1;").unwrap();
        set_gpu_preference_for(exe, true).unwrap();
        set_gpu_preference_for(exe, true).unwrap();
        assert_eq!(reg_string(HKEY_CURRENT_USER, GPU_PREFERENCES, exe).as_deref(), Some("GpuPreference=2;SwapEffectUpgradeEnable=1;"));
        set_gpu_preference_for(exe, false).unwrap();
        assert_eq!(reg_string(HKEY_CURRENT_USER, GPU_PREFERENCES, exe).as_deref(), Some("GpuPreference=1;SwapEffectUpgradeEnable=1;"));
        reg_delete(HKEY_CURRENT_USER, GPU_PREFERENCES, exe);
        set_gpu_preference_for(exe, true).unwrap();
        set_gpu_preference_for(exe, false).unwrap();
        assert_eq!(reg_string(HKEY_CURRENT_USER, GPU_PREFERENCES, exe), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
