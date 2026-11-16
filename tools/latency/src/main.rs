//! Input-to-screen latency of a Mercury window, without a sensor.
//!
//! The window shows tools/latency/latency.html (black, white while the left button is down). The tool presses the
//! button with SendInput and watches the screen with DXGI Desktop Duplication until the pixel under the cursor turns
//! white; latency = the duplicated frame's present time - the moment of SendInput. This covers everything up to the
//! frame reaching the display pipeline; the panel's own response is not included (that needs a photodiode or LDAT).
//!
//! Usage: latency --pid <mercury browser pid> [--count 60]
//! Safety: it clicks only while the window under the cursor belongs to that process, and stops otherwise.

use std::{mem::size_of, thread::sleep, time::Duration};
use windows::{
    core::{Interface, Result},
    Win32::{
        Foundation::{HMODULE, HWND, LPARAM, POINT, RECT},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_UNKNOWN,
            Direct3D11::*,
            Dxgi::{Common::DXGI_SAMPLE_DESC, *},
        },
        System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency},
        UI::{
            Input::KeyboardAndMouse::*,
            WindowsAndMessaging::*,
        },
    },
};

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn qpc() -> i64 {
    let mut t = 0;
    unsafe { QueryPerformanceCounter(&mut t).unwrap() };
    t
}

fn mouse(flags: MOUSE_EVENT_FLAGS) {
    let input = INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dwFlags: flags, ..Default::default() } } };
    unsafe { SendInput(&[input], size_of::<INPUT>() as i32) };
}

/// The visible top-level window of `pid` with the largest area.
fn window_of(pid: u32) -> Option<HWND> {
    struct Search {
        pid: u32,
        best: Option<(HWND, i32)>,
    }
    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let search = unsafe { &mut *(lparam.0 as *mut Search) };
        let mut owner = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut owner)) };
        let mut rect = RECT::default();
        if owner == search.pid && unsafe { IsWindowVisible(hwnd) }.as_bool() && unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
            let area = (rect.right - rect.left) * (rect.bottom - rect.top);
            if search.best.is_none_or(|(_, a)| area > a) {
                search.best = Some((hwnd, area));
            }
        }
        true.into()
    }
    let mut search = Search { pid, best: None };
    let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut search as *mut _ as isize)) };
    search.best.map(|(h, _)| h)
}

/// True while the top-level window under `point` belongs to `pid`: we never click into anything else.
fn ours_at(point: POINT, pid: u32) -> bool {
    let hwnd = unsafe { GetAncestor(WindowFromPoint(point), GA_ROOT) };
    let mut owner = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut owner)) };
    owner == pid
}

/// The adapter and output that show `point` (on hybrid laptops the display usually hangs off the iGPU).
fn output_at(point: POINT) -> Result<(IDXGIAdapter1, IDXGIOutput, RECT)> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    for a in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(a) }) else { break };
        for o in 0.. {
            let Ok(output) = (unsafe { adapter.EnumOutputs(o) }) else { break };
            let r = unsafe { output.GetDesc()? }.DesktopCoordinates;
            if point.x >= r.left && point.x < r.right && point.y >= r.top && point.y < r.bottom {
                return Ok((adapter, output, r));
            }
        }
    }
    Err(windows::core::Error::new(windows::core::HRESULT(-1), "no display output at that point"))
}

struct Screen {
    context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    staging: ID3D11Texture2D,
    x: u32,
    y: u32,
}

impl Screen {
    /// Waits up to `timeout_ms` for a new desktop frame; returns (present time, pixel is bright).
    fn next(&self, timeout_ms: u32) -> Option<(i64, bool)> {
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource = None;
        unsafe { self.duplication.AcquireNextFrame(timeout_ms, &mut info, &mut resource) }.ok()?;
        let result = (|| {
            if info.LastPresentTime == 0 {
                return None; // only the cursor moved
            }
            let texture: ID3D11Texture2D = resource.as_ref()?.cast().ok()?;
            let region = D3D11_BOX { left: self.x, top: self.y, front: 0, right: self.x + 1, bottom: self.y + 1, back: 1 };
            unsafe { self.context.CopySubresourceRegion(&self.staging, 0, 0, 0, 0, &texture, 0, Some(&region)) };
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            unsafe { self.context.Map(&self.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }.ok()?;
            let pixel = unsafe { std::slice::from_raw_parts(mapped.pData as *const u8, 4) }.to_vec();
            unsafe { self.context.Unmap(&self.staging, 0) };
            Some((info.LastPresentTime, pixel[..3].iter().all(|&c| c > 200)))
        })();
        let _ = unsafe { self.duplication.ReleaseFrame() };
        result
    }

    /// The next frame whose pixel is `bright`, within one second.
    fn wait_for(&self, bright: bool) -> Option<i64> {
        let deadline = qpc_ms() + 1000.0;
        while qpc_ms() < deadline {
            if let Some((time, b)) = self.next(50)
                && b == bright
            {
                return Some(time);
            }
        }
        None
    }
}

fn qpc_ms() -> f64 {
    let mut f = 0;
    unsafe { QueryPerformanceFrequency(&mut f).unwrap() };
    qpc() as f64 * 1000.0 / f as f64
}

fn main() -> Result<()> {
    let pid: u32 = arg("--pid").and_then(|p| p.parse().ok()).expect("usage: latency --pid <mercury browser pid> [--count 60]");
    let count: usize = arg("--count").and_then(|c| c.parse().ok()).unwrap_or(60);
    let hwnd = window_of(pid).expect("no visible window for that pid");

    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect)? };
    let point = POINT { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
    // An Alt tap lets a background process bring a window to the front.
    for flags in [KEYBD_EVENT_FLAGS(0), KEYEVENTF_KEYUP] {
        let input = INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_MENU, dwFlags: flags, ..Default::default() } } };
        unsafe { SendInput(&[input], size_of::<INPUT>() as i32) };
    }
    let _ = unsafe { SetForegroundWindow(hwnd) };
    sleep(Duration::from_millis(500));
    unsafe { SetCursorPos(point.x, point.y)? };
    if !ours_at(point, pid) {
        panic!("another window covers Mercury at {},{}; not clicking", point.x, point.y);
    }

    let (adapter, output, desktop) = output_at(point)?;
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(&adapter, D3D_DRIVER_TYPE_UNKNOWN, HMODULE::default(), D3D11_CREATE_DEVICE_FLAG(0), None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut context))?
    };
    let device = device.unwrap();
    let duplication = unsafe { output.cast::<IDXGIOutput1>()?.DuplicateOutput(&device)? };
    let desc = D3D11_TEXTURE2D_DESC {
        Width: 1,
        Height: 1,
        MipLevels: 1,
        ArraySize: 1,
        Format: unsafe { duplication.GetDesc() }.ModeDesc.Format,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_STAGING,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        ..Default::default()
    };
    let mut staging = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut staging))? };
    let screen = Screen {
        context: context.unwrap(),
        duplication,
        staging: staging.unwrap(),
        x: (point.x - desktop.left) as u32,
        y: (point.y - desktop.top) as u32,
    };

    let mut freq = 0;
    unsafe { QueryPerformanceFrequency(&mut freq)? };
    let mut samples = Vec::new();
    let mut seed = qpc() as u64;
    for _ in 0..count {
        // Random gaps so clicks don't lock onto the refresh cycle.
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        sleep(Duration::from_millis(250 + (seed >> 33) % 200));
        while screen.next(0).is_some() {} // drain old frames
        if !ours_at(point, pid) {
            eprintln!("Mercury is no longer under the cursor; stopping");
            break;
        }
        let pressed = qpc();
        mouse(MOUSEEVENTF_LEFTDOWN);
        let seen = screen.wait_for(true);
        mouse(MOUSEEVENTF_LEFTUP);
        if let Some(time) = seen {
            samples.push((time - pressed) as f64 * 1000.0 / freq as f64);
        }
        screen.wait_for(false);
    }

    samples.sort_by(f64::total_cmp);
    if samples.is_empty() {
        eprintln!("no samples: is tools/latency/latency.html open in the window?");
        std::process::exit(1);
    }
    let pct = |p: f64| samples[((p / 100.0) * (samples.len() - 1) as f64).round() as usize];
    println!(
        "{{\"samples\":{},\"min\":{:.2},\"p50\":{:.2},\"p90\":{:.2},\"p99\":{:.2},\"max\":{:.2}}}",
        samples.len(),
        samples[0],
        pct(50.0),
        pct(90.0),
        pct(99.0),
        samples[samples.len() - 1]
    );
    Ok(())
}
