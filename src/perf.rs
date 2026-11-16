//! `perf.*` bridge commands and the browser's half of the present hook (M2):
//! - the shared memory block the GPU process reads its settings from and reports into (present.rs, gpu_hook.rs);
//! - present stats for the page's FPS counter, and live FPS limit changes;
//! - HighQoS: keeps Windows' EcoQoS throttling off the game's processes;
//! - the CPU throttler (DevTools' CPU throttling of the page), and the system check.

use crate::{
    gpu_hook,
    present::{self, info, mode, state, Shared},
    settings, system,
};
use cef::*;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU32, Ordering::*};
use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::{
        Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
        SystemInformation::GetTickCount64,
        Threading::{
            GetProcessInformation, OpenProcess, ProcessPowerThrottling, SetProcessInformation, PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            PROCESS_POWER_THROTTLING_STATE, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION,
        },
    },
};

static GPU_LAUNCHES: AtomicU32 = AtomicU32::new(0);
/// HighQoS: processes set on the last pass, and how many of them had been throttled (by Chromium or anyone else).
static QOS_SET: AtomicU32 = AtomicU32::new(0);
static QOS_WAS_THROTTLED: AtomicU32 = AtomicU32::new(0);

/// Browser process, before Chromium starts: the shared block with the hook's settings.
pub fn create_shared(safe_mode: bool) {
    if let Some(shared) = present::create() {
        let hook = match settings::string("present.mode").as_str() {
            _ if safe_mode => mode::OFF,
            "off" => mode::OFF,
            "on" => mode::FORCE,
            _ => mode::AUTO,
        };
        shared.mode.store(hook, Relaxed);
        // The settings window stores select values as strings.
        set_fps_limit(shared, settings::string("present.fpsLimit").parse().unwrap_or(0));
        if hook == mode::OFF {
            shared.state.store(state::OFF, Relaxed);
        }
    }
}

/// Browser process, once Chromium runs (never in a second launch that hands off): HighQoS and Power Boost.
pub fn start(safe_mode: bool) {
    if settings::bool("perf.highQos", true) && !safe_mode {
        std::thread::spawn(|| loop {
            high_qos_pass();
            std::thread::sleep(std::time::Duration::from_secs(5));
        });
    }
    system::start();
}

/// Browser process, after shutdown.
pub fn stop() {
    system::stop();
}

fn set_fps_limit(shared: &Shared, fps: u64) {
    // 0 = uncapped; anything else between 10 and 1000.
    let fps = if fps == 0 { 0 } else { fps.clamp(10, 1000) as u32 };
    shared.fps_limit.store(fps, Relaxed);
}

/// Called before Chromium launches a child: the GPU process gets the switch that turns the hook on (gpu_hook.rs).
/// After two GPU process launches it stops: Chromium relaunches it after a crash, and the hook may be the cause.
pub fn on_child_launch(command_line: &mut CommandLine) {
    let process_type = CefString::from(&command_line.switch_value(Some(&CefString::from("type")))).to_string();
    let Some(shared) = present::get().filter(|_| process_type == "gpu-process") else { return };
    if shared.mode.load(Relaxed) == mode::OFF {
        return;
    }
    if GPU_LAUNCHES.fetch_add(1, Relaxed) >= 2 {
        shared.state.store(state::DISABLED_AFTER_CRASH, Relaxed);
        return;
    }
    let pid = std::process::id().to_string();
    command_line.append_switch_with_value(Some(&CefString::from(gpu_hook::SWITCH)), Some(&CefString::from(pid.as_str())));
}

pub fn command(cmd: &str, request: &Value) -> Result<Value, String> {
    match cmd {
        "perf.stats" => Ok(stats()),
        "perf.config" => {
            let shared = present::get().ok_or("no present block")?;
            set_fps_limit(shared, request["fpsLimit"].as_u64().ok_or("fpsLimit must be a number")?);
            Ok(Value::Null)
        }
        "perf.system" => Ok(system_check()),
        _ => Err(format!("unknown command {cmd}")),
    }
}

fn stats() -> Value {
    let Some(shared) = present::get() else { return json!({ "state": state::NONE, "stateName": state::name(state::NONE) }) };
    let s = shared.state.load(Relaxed);
    let bits = shared.info.load(Relaxed);
    let times = shared.frame_times();
    let summary = present::summarize(&times, 1_000_000);
    let c = &shared.capture;
    // SAFETY: plain call.
    let now = unsafe { GetTickCount64() };
    json!({
        "state": s,
        "stateName": state::name(s),
        "active": s == state::HOOKED,
        "crossAdapter": bits & info::CROSS_ADAPTER != 0,
        "tearing": bits & info::TEARING != 0,
        "waitable": bits & info::WAITABLE != 0,
        "mmcss": bits & info::MMCSS != 0,
        "mainThread": bits & info::MAIN_THREAD != 0,
        "composition": bits & info::COMPOSITION != 0,
        "detail": shared.detail.load(Relaxed),
        "swapchains": shared.swapchains.load(Relaxed),
        "size": [shared.width.load(Relaxed), shared.height.load(Relaxed)],
        "swapchainFlags": shared.swapchain_flags.load(Relaxed),
        "resizeFlags": shared.resize_flags.load(Relaxed),
        "syncInterval": shared.sync_interval.load(Relaxed),
        "presentFlags": shared.present_flags.load(Relaxed),
        "gpuStarts": shared.gpu_starts.load(Relaxed),
        "presents": shared.presents.load(Relaxed),
        "fpsLimit": shared.fps_limit.load(Relaxed),
        "fps": summary.as_ref().map(|s| s.fps),
        "avgMs": summary.as_ref().map(|s| s.avg_ms),
        "p50Ms": summary.as_ref().map(|s| s.p50_ms),
        "p99Ms": summary.as_ref().map(|s| s.p99_ms),
        "maxMs": summary.as_ref().map(|s| s.max_ms),
        "capture": {
            "reader": now.saturating_sub(c.reader_tick.load(Relaxed)) < 2000,
            "frames": c.frames.load(Relaxed),
            "size": [c.width.load(Relaxed), c.height.load(Relaxed)],
        },
        "qos": { "processes": QOS_SET.load(Relaxed), "wasThrottled": QOS_WAS_THROTTLED.load(Relaxed) },
    })
}

/// Our child processes (renderers, GPU, utilities), by parent pid.
fn child_pids(parent: u32) -> Vec<u32> {
    let mut pids = Vec::new();
    // SAFETY: a process snapshot we own and close.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot as isize == -1 {
            return pids;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            if entry.th32ParentProcessID == parent {
                pids.push(entry.th32ProcessID);
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    pids
}

/// HighQoS: tells Windows never to run our processes as EcoQoS (efficiency cores, low clocks). Chromium sets EcoQoS on
/// renderers it considers in the background; re-applied every few seconds in case it does.
fn high_qos_pass() {
    let me = std::process::id();
    let (mut set, mut throttled) = (0, 0);
    for pid in std::iter::once(me).chain(child_pids(me)) {
        // SAFETY: a process handle we own and close; the state struct is the documented one.
        unsafe {
            let process = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() {
                continue;
            }
            let size = size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32;
            let mut current = PROCESS_POWER_THROTTLING_STATE { Version: 1, ControlMask: 0, StateMask: 0 };
            if GetProcessInformation(process, ProcessPowerThrottling, (&raw mut current).cast(), size) != 0
                && current.StateMask & PROCESS_POWER_THROTTLING_EXECUTION_SPEED != 0
            {
                throttled += 1;
            }
            // Control the execution speed bit and leave it clear: HighQoS.
            let high = PROCESS_POWER_THROTTLING_STATE { Version: 1, ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED, StateMask: 0 };
            if SetProcessInformation(process, ProcessPowerThrottling, (&raw const high).cast(), size) != 0 {
                set += 1;
            }
            CloseHandle(process);
        }
    }
    QOS_SET.store(set, Relaxed);
    QOS_WAS_THROTTLED.fetch_max(throttled, Relaxed);
}

/// The CPU throttler: Chromium's DevTools CPU throttling slows the page's main thread by `rate` (1 = off). Runs on the
/// UI thread (DevTools methods must), from bridge.rs.
pub fn cpu_throttle(browser: Option<&Browser>, request: &Value) -> Result<Value, String> {
    let rate = request["rate"].as_f64().filter(|r| (1.0..=4.0).contains(r)).ok_or("rate must be 1 to 4")?;
    let host = browser.and_then(|b| b.host()).ok_or("no browser")?;
    let mut params = dictionary_value_create().ok_or("no dictionary")?;
    params.set_double(Some(&CefString::from("rate")), rate);
    let sent = host.execute_dev_tools_method(0, Some(&CefString::from("Emulation.setCPUThrottlingRate")), Some(&mut params));
    if sent == 0 { Err("DevTools call refused".into()) } else { Ok(json!(rate)) }
}

/// The system check panel: what Windows settings around the game look like.
fn system_check() -> Value {
    let adapters: Vec<Value> = gpu_hook::adapters().into_iter().map(|(name, outputs)| json!({ "name": name, "outputs": outputs })).collect();
    json!({
        "power": system::power_status(),
        "gameMode": system::game_mode(),
        "hags": system::hags(),
        "gpuPreference": system::gpu_preference(),
        "crossAdapter": gpu_hook::cross_adapter(),
        "adapters": adapters,
        "nvidia": std::env::current_exe().map(|exe| crate::nvidia::status(&exe)).unwrap_or_default(),
    })
}
