//! The DXGI present hook, in Chromium's GPU process (M2). `RunWinMain` calls `init` before `execute_process`, while the
//! process still has its initial token: the hook is in place before Chromium creates a swap chain, and nothing is
//! injected from outside.
//!
//! Chromium already does tearing and interval-0 presents (--disable-gpu-vsync) and waitable swap chains (its
//! DXGIWaitableSwapChain feature, an engine setting), so the hook never changes Chromium's swap chains or calls. It
//! only adds what Chromium can't do:
//! - `IDXGISwapChain1::Present1` on the window's swap chain: the FPS limiter, present times for the FPS counter, MMCSS
//!   for the presenting thread, and a copy of each frame for OBS while a reader is attached (M9);
//! - observers on `CreateSwapChainForComposition` / `ForHwnd` and `ResizeBuffers` that record what Chromium does
//!   (flags, size, sync interval) and pass every call through unchanged.
//!
//! Measured and left out (2026-11-16, CEF 156): waiting on the frame latency waitable object. Chromium creates it with
//! DXGIWaitableSwapChain but never asks for it (0 calls to GetFrameLatencyWaitableObject); waiting on it in Present1
//! only lowered the present rate (950 → 570-700 FPS) without better pacing, since the renderer produces frames on its
//! own clock anyway.
//!
//! The hooks patch dxgi.dll's vtables, found through a throwaway device, factory and 1x1 swap chain. A step that fails
//! leaves Chromium's calls alone: no hook rather than a black screen. The browser stops handing the GPU process the
//! hook after two GPU process launches (perf.rs), in case the hook is what crashes it.

use crate::present::{self, info, mode, state, Shared};
use std::{
    cell::{Cell, RefCell},
    ffi::{c_void, CStr},
    sync::atomic::{AtomicU32, AtomicUsize, Ordering::*},
};
use windows::{
    core::{Interface, GUID, HRESULT, PCWSTR},
    Win32::{
        Foundation::{CloseHandle, HANDLE, HWND, POINT},
        Graphics::{
            Direct3D11::*,
            Dxgi::{Common::*, *},
            Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY},
        },
    },
};
use windows_sys::Win32::System::{
    LibraryLoader::{GetProcAddress, LoadLibraryW},
    Memory::{VirtualProtect, PAGE_READWRITE},
    Performance::{QueryPerformanceCounter, QueryPerformanceFrequency},
    SystemInformation::GetTickCount64,
    Threading::{
        CreateWaitableTimerExW, GetCurrentProcessId, GetCurrentThreadId, SetWaitableTimer, WaitForSingleObject,
        CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, INFINITE, TIMER_ALL_ACCESS,
    },
};

/// The switch the browser adds to the GPU process's command line (perf.rs): `--mercury-present=<browser pid>`.
pub const SWITCH: &str = "mercury-present";

type CreateForCompositionFn =
    unsafe extern "system" fn(*mut c_void, *mut c_void, *const DXGI_SWAP_CHAIN_DESC1, *mut c_void, *mut *mut c_void) -> HRESULT;
type CreateForHwndFn = unsafe extern "system" fn(
    *mut c_void,
    *mut c_void,
    HWND,
    *const DXGI_SWAP_CHAIN_DESC1,
    *const DXGI_SWAP_CHAIN_FULLSCREEN_DESC,
    *mut c_void,
    *mut *mut c_void,
) -> HRESULT;
type Present1Fn = unsafe extern "system" fn(*mut c_void, u32, DXGI_PRESENT, *const DXGI_PRESENT_PARAMETERS) -> HRESULT;
type ResizeBuffersFn = unsafe extern "system" fn(*mut c_void, u32, u32, u32, DXGI_FORMAT, u32) -> HRESULT;
type D3D11CreateDeviceFn = unsafe extern "system" fn(
    *mut c_void,
    i32,
    *mut c_void,
    u32,
    *const i32,
    u32,
    u32,
    *mut *mut c_void,
    *mut i32,
    *mut *mut c_void,
) -> HRESULT;
type CreateDxgiFactory2Fn = unsafe extern "system" fn(u32, *const GUID, *mut *mut c_void) -> HRESULT;
type AvSetMmThreadCharacteristicsFn = unsafe extern "system" fn(*const u16, *mut u32) -> *mut c_void;

// Chromium's own functions, saved before patching.
static CREATE_FOR_COMPOSITION: AtomicUsize = AtomicUsize::new(0);
static CREATE_FOR_HWND: AtomicUsize = AtomicUsize::new(0);
static PRESENT1: AtomicUsize = AtomicUsize::new(0);
static RESIZE_BUFFERS: AtomicUsize = AtomicUsize::new(0);

/// The window's swap chain: the newest window-sized one. Other swap chains present untouched.
static MAIN: AtomicUsize = AtomicUsize::new(0);
static MAIN_THREAD: AtomicU32 = AtomicU32::new(0);
static TIMER: AtomicUsize = AtomicUsize::new(0);

const WAITABLE_FLAG: u32 = DXGI_SWAP_CHAIN_FLAG_FRAME_LATENCY_WAITABLE_OBJECT.0 as u32;
const TEARING_FLAG: u32 = DXGI_SWAP_CHAIN_FLAG_ALLOW_TEARING.0 as u32;

/// GPU process only, before `execute_process`: opens the browser's shared memory and installs the hook if asked to.
pub fn init() {
    let mut gpu = false;
    let mut browser_pid = None;
    for arg in std::env::args() {
        gpu |= arg == "--type=gpu-process";
        if let Some(pid) = arg.strip_prefix("--mercury-present=") {
            browser_pid = pid.parse::<u32>().ok();
        }
    }
    let (true, Some(pid)) = (gpu, browser_pid) else { return };
    let Some(shared) = present::open(pid) else { return };
    shared.gpu_starts.fetch_add(1, Relaxed);
    shared.info.store(0, Relaxed);
    let hook_mode = shared.mode.load(Relaxed);
    if hook_mode == mode::OFF {
        shared.state.store(state::OFF, Relaxed);
        return;
    }
    if cross_adapter() == Some(true) {
        shared.info.fetch_or(info::CROSS_ADAPTER, Relaxed);
        if hook_mode == mode::AUTO {
            shared.state.store(state::SKIPPED_HYBRID, Relaxed);
            return;
        }
    }
    // SAFETY: plain Win32 calls; the vtable patching inside `install` is checked step by step.
    unsafe {
        MAIN_THREAD.store(GetCurrentThreadId(), Relaxed);
        // Chromium presents from this thread (checked at the first present): register it now, while the token still
        // lets avrt.dll reach the MMCSS service.
        if register_mmcss() {
            shared.info.fetch_or(info::MMCSS, Relaxed);
        }
        let timer = CreateWaitableTimerExW(std::ptr::null(), std::ptr::null(), CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
        TIMER.store(timer as usize, Relaxed);
        match install() {
            Ok(()) => shared.state.store(state::INSTALLED, Relaxed),
            Err(step) => {
                shared.detail.store(step, Relaxed);
                shared.state.store(state::FAILED, Relaxed);
            }
        }
    }
}

/// An exported function from a system DLL, loaded on demand so MercuryClient.dll never imports d3d11/dxgi/avrt.
unsafe fn load(dll: &str, name: &CStr) -> Option<*const c_void> {
    let wide: Vec<u16> = dll.encode_utf16().chain([0]).collect();
    // SAFETY: a system DLL by name; it stays loaded.
    unsafe {
        let module = LoadLibraryW(wide.as_ptr());
        if module.is_null() {
            return None;
        }
        GetProcAddress(module, name.as_ptr().cast()).map(|f| f as *const c_void)
    }
}

pub fn create_factory<T: Interface>() -> Option<T> {
    // SAFETY: CreateDXGIFactory2's documented signature; the out pointer becomes an owned T.
    unsafe {
        let create: CreateDxgiFactory2Fn = std::mem::transmute(load("dxgi.dll", c"CreateDXGIFactory2")?);
        let mut out = std::ptr::null_mut();
        create(0, &T::IID, &mut out).ok().ok()?;
        Some(T::from_raw(out))
    }
}

/// Hybrid laptops: true when the high-performance GPU doesn't drive the primary display, so every frame Chromium
/// renders there is copied to the other GPU to be shown ("cross-adapter"). `None` when DXGI can't tell.
pub fn cross_adapter() -> Option<bool> {
    // SAFETY: DXGI enumeration on a factory we own.
    unsafe {
        let factory: IDXGIFactory6 = create_factory()?;
        let fast: IDXGIAdapter1 = factory.EnumAdapterByGpuPreference(0, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE).ok()?;
        let primary = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let drives_primary =
            (0..).map_while(|i| fast.EnumOutputs(i).ok()).any(|output| output.GetDesc().is_ok_and(|d| d.Monitor == primary));
        Some(!drives_primary)
    }
}

/// Every GPU DXGI lists, the high-performance one first: (name, outputs).
pub fn adapters() -> Vec<(String, u32)> {
    let Some(factory) = create_factory::<IDXGIFactory6>() else { return Vec::new() };
    // SAFETY: DXGI enumeration on a factory we own.
    unsafe {
        (0..)
            .map_while(|i| factory.EnumAdapterByGpuPreference::<IDXGIAdapter1>(i, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE).ok())
            .filter_map(|adapter| {
                let desc = adapter.GetDesc1().ok()?;
                if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                    return None;
                }
                let name = String::from_utf16_lossy(&desc.Description).trim_end_matches('\0').to_string();
                Some((name, (0..).map_while(|i| adapter.EnumOutputs(i).ok()).count() as u32))
            })
            .collect()
    }
}

unsafe fn register_mmcss() -> bool {
    // SAFETY: avrt.dll's documented signature.
    unsafe {
        let Some(f) = load("avrt.dll", c"AvSetMmThreadCharacteristicsW") else { return false };
        let set: AvSetMmThreadCharacteristicsFn = std::mem::transmute(f);
        let task: Vec<u16> = "Games\0".encode_utf16().collect();
        let mut index = 0;
        !set(task.as_ptr(), &mut index).is_null()
    }
}

/// Patches dxgi.dll's vtables. `Err` carries the step that failed.
unsafe fn install() -> Result<(), u32> {
    // SAFETY: COM calls on objects we create; slots are patched through `patch`.
    unsafe {
        let create_device: D3D11CreateDeviceFn = std::mem::transmute(load("d3d11.dll", c"D3D11CreateDevice").ok_or(1u32)?);
        let (mut device, mut context) = (std::ptr::null_mut(), std::ptr::null_mut());
        let flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT.0;
        let hr = create_device(std::ptr::null_mut(), 1, std::ptr::null_mut(), flags, std::ptr::null(), 0, D3D11_SDK_VERSION, &mut device, std::ptr::null_mut(), &mut context);
        hr.ok().map_err(|_| 2u32)?;
        let device = ID3D11Device::from_raw(device);
        drop(ID3D11DeviceContext::from_raw(context));
        let factory: IDXGIFactory2 = device.cast::<IDXGIDevice>().and_then(|d| d.GetAdapter()?.GetParent()).map_err(|_| 3u32)?;
        let desc = DXGI_SWAP_CHAIN_DESC1 {
            Width: 1,
            Height: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
            BufferCount: 2,
            Scaling: DXGI_SCALING_STRETCH,
            SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
            AlphaMode: DXGI_ALPHA_MODE_PREMULTIPLIED,
            ..Default::default()
        };
        let swapchain = factory.CreateSwapChainForComposition(&device, &desc, None).map_err(|_| 4u32)?;

        let f = factory.vtable();
        let s = swapchain.vtable();
        let ok = patch(&raw const f.CreateSwapChainForComposition as _, create_for_composition as *const () as usize, &CREATE_FOR_COMPOSITION)
            && patch(&raw const f.CreateSwapChainForHwnd as _, create_for_hwnd as *const () as usize, &CREATE_FOR_HWND)
            && patch(&raw const s.base__.ResizeBuffers as _, resize_buffers as *const () as usize, &RESIZE_BUFFERS)
            && patch(&raw const s.Present1 as _, present1 as *const () as usize, &PRESENT1);
        if ok { Ok(()) } else { Err(5) }
    }
}

/// Points a vtable slot at `hook`, keeping the original in `original`. dxgi.dll's vtables are read-only data: unprotect
/// the slot for the write, then put the protection back.
unsafe fn patch(slot: *const usize, hook: usize, original: &AtomicUsize) -> bool {
    // SAFETY: `slot` is a vtable entry of a live dxgi.dll object; the store is one aligned pointer-sized write.
    unsafe {
        let current = *slot;
        if current == hook {
            return true;
        }
        original.store(current, SeqCst);
        let mut old = 0;
        if VirtualProtect(slot as *mut c_void, size_of::<usize>(), PAGE_READWRITE, &mut old) == 0 {
            return false;
        }
        (*(slot as *const AtomicUsize)).store(hook, SeqCst);
        VirtualProtect(slot as *mut c_void, size_of::<usize>(), old, &mut old);
        true
    }
}

/// The swap chain that shows the browser window: color, flip model, not tiny. Video overlays use YUV formats.
fn is_window_swapchain(desc: &DXGI_SWAP_CHAIN_DESC1) -> bool {
    let color = [DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_FORMAT_R10G10B10A2_UNORM, DXGI_FORMAT_R16G16B16A16_FLOAT].contains(&desc.Format);
    let flip = [DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL, DXGI_SWAP_EFFECT_FLIP_DISCARD].contains(&desc.SwapEffect);
    color && flip && desc.Width >= 256 && desc.Height >= 256
}

unsafe extern "system" fn create_for_composition(
    this: *mut c_void,
    device: *mut c_void,
    desc: *const DXGI_SWAP_CHAIN_DESC1,
    restrict: *mut c_void,
    out: *mut *mut c_void,
) -> HRESULT {
    // SAFETY: forwards Chromium's arguments unchanged to the saved original.
    unsafe {
        let original: CreateForCompositionFn = std::mem::transmute(CREATE_FOR_COMPOSITION.load(Relaxed));
        let hr = original(this, device, desc, restrict, out);
        created(hr, desc, out, info::COMPOSITION);
        hr
    }
}

unsafe extern "system" fn create_for_hwnd(
    this: *mut c_void,
    device: *mut c_void,
    hwnd: HWND,
    desc: *const DXGI_SWAP_CHAIN_DESC1,
    fullscreen: *const DXGI_SWAP_CHAIN_FULLSCREEN_DESC,
    restrict: *mut c_void,
    out: *mut *mut c_void,
) -> HRESULT {
    // SAFETY: forwards Chromium's arguments unchanged to the saved original.
    unsafe {
        let original: CreateForHwndFn = std::mem::transmute(CREATE_FOR_HWND.load(Relaxed));
        let hr = original(this, device, hwnd, desc, fullscreen, restrict, out);
        created(hr, desc, out, info::HWND);
        hr
    }
}

/// A new window-sized swap chain becomes the one the hook paces and records.
unsafe fn created(hr: HRESULT, desc: *const DXGI_SWAP_CHAIN_DESC1, out: *mut *mut c_void, kind: u32) {
    // SAFETY: `desc` and `out` come from Chromium's call; `out` is only read after a successful create.
    unsafe {
        let Some(shared) = present::get() else { return };
        if hr.is_err() || desc.is_null() || out.is_null() || (*out).is_null() || !is_window_swapchain(&*desc) {
            return;
        }
        let desc = &*desc;
        let mut bits = kind;
        if desc.Flags & WAITABLE_FLAG != 0 {
            bits |= info::WAITABLE;
        }
        if desc.Flags & TEARING_FLAG != 0 {
            bits |= info::TEARING;
        }
        MAIN.store(*out as usize, SeqCst);
        shared.info.fetch_or(bits, Relaxed);
        shared.swapchains.fetch_add(1, Relaxed);
        shared.width.store(desc.Width, Relaxed);
        shared.height.store(desc.Height, Relaxed);
        shared.swapchain_flags.store(desc.Flags, Relaxed);
    }
}

unsafe extern "system" fn resize_buffers(this: *mut c_void, count: u32, width: u32, height: u32, format: DXGI_FORMAT, flags: u32) -> HRESULT {
    // SAFETY: forwards Chromium's arguments unchanged to the saved original.
    unsafe {
        let original: ResizeBuffersFn = std::mem::transmute(RESIZE_BUFFERS.load(Relaxed));
        let hr = original(this, count, width, height, format, flags);
        if hr.is_ok()
            && this as usize == MAIN.load(Relaxed)
            && let Some(shared) = present::get()
        {
            // 0 keeps the current size (DXGI fills it in from the window).
            if width != 0 && height != 0 {
                shared.width.store(width, Relaxed);
                shared.height.store(height, Relaxed);
            }
            shared.resize_flags.store(flags, Relaxed);
        }
        hr
    }
}

thread_local! {
    /// QPC time of the window swap chain's previous present.
    static LAST_PRESENT: Cell<i64> = const { Cell::new(0) };
    static LIMITER: Cell<i64> = const { Cell::new(0) };
    static FIRST_PRESENT: Cell<bool> = const { Cell::new(true) };
    static CAPTURE: RefCell<Option<CaptureTexture>> = const { RefCell::new(None) };
}

unsafe extern "system" fn present1(this: *mut c_void, interval: u32, flags: DXGI_PRESENT, params: *const DXGI_PRESENT_PARAMETERS) -> HRESULT {
    // SAFETY: forwards Chromium's arguments unchanged to the saved original.
    unsafe {
        if this as usize == MAIN.load(Relaxed)
            && flags.0 & DXGI_PRESENT_TEST.0 == 0
            && let Some(shared) = present::get()
        {
            before_present(shared, this, interval, flags);
        }
        let original: Present1Fn = std::mem::transmute(PRESENT1.load(Relaxed));
        original(this, interval, flags, params)
    }
}

unsafe fn before_present(shared: &Shared, swapchain: *mut c_void, interval: u32, flags: DXGI_PRESENT) {
    // SAFETY: called from Present1 on Chromium's presenting thread with its live swap chain.
    unsafe {
        if FIRST_PRESENT.replace(false) {
            if GetCurrentThreadId() == MAIN_THREAD.load(Relaxed) {
                shared.info.fetch_or(info::MAIN_THREAD, Relaxed);
            } else if register_mmcss() {
                shared.info.fetch_or(info::MMCSS, Relaxed);
            }
            shared.state.store(state::HOOKED, Relaxed);
        }
        shared.sync_interval.store(interval, Relaxed);
        shared.present_flags.store(flags.0, Relaxed);
        limit(shared.fps_limit.load(Relaxed).min(1000));
        let now = qpc();
        let last = LAST_PRESENT.replace(now);
        if last != 0 {
            let micros = (now - last) * 1_000_000 / qpc_frequency();
            shared.push_frame_time(micros.clamp(0, u32::MAX as i64) as u32);
        }
        capture(shared, swapchain);
    }
}

fn qpc() -> i64 {
    let mut now = 0;
    // SAFETY: an out parameter.
    unsafe { QueryPerformanceCounter(&mut now) };
    now
}

fn qpc_frequency() -> i64 {
    static FREQUENCY: std::sync::OnceLock<i64> = std::sync::OnceLock::new();
    *FREQUENCY.get_or_init(|| {
        let mut f = 0;
        // SAFETY: an out parameter.
        unsafe { QueryPerformanceFrequency(&mut f) };
        f.max(1)
    })
}

/// The limiter's step: `target` is when this frame may present (0: no frame yet), `now` the time, `period` the frame
/// time. Returns when to wait until, if at all, and the next frame's target. A frame that is late by less than a period
/// keeps the cadence; a later one restarts it, so a stall is never followed by a burst.
fn schedule(target: i64, now: i64, period: i64) -> (Option<i64>, i64) {
    if target == 0 || now - target >= period {
        (None, now + period)
    } else if now < target {
        (Some(target), target + period)
    } else {
        (None, target + period)
    }
}

fn limit(fps: u32) {
    if fps == 0 {
        LIMITER.set(0);
        return;
    }
    let frequency = qpc_frequency();
    let (wait, next) = schedule(LIMITER.get(), qpc(), frequency / fps as i64);
    LIMITER.set(next);
    let Some(until) = wait else { return };
    // Sleep on the high-resolution timer to about 1 ms before the deadline, then spin: sleeps overshoot.
    let timer = TIMER.load(Relaxed) as *mut c_void;
    loop {
        let left = until - qpc();
        if left <= 0 {
            break;
        }
        let left_100ns = left * 10_000_000 / frequency;
        if !timer.is_null() && left_100ns > 15_000 {
            let due = -(left_100ns - 10_000);
            // SAFETY: our own timer handle; a relative due time.
            unsafe {
                SetWaitableTimer(timer, &due, 0, None, std::ptr::null(), 0);
                WaitForSingleObject(timer, INFINITE);
            }
        } else {
            std::hint::spin_loop();
        }
    }
}

/// The shared texture OBS reads (M9): a copy of each presented frame while a reader's heartbeat is fresh.
struct CaptureTexture {
    texture: ID3D11Texture2D,
    handle: HANDLE,
    width: u32,
    height: u32,
    format: DXGI_FORMAT,
}

impl Drop for CaptureTexture {
    fn drop(&mut self) {
        // SAFETY: the NT handle CreateSharedHandle gave us.
        let _ = unsafe { CloseHandle(self.handle) };
    }
}

const READER_TIMEOUT_MS: u64 = 2000;

unsafe fn capture(shared: &Shared, swapchain: *mut c_void) {
    let c = &shared.capture;
    // SAFETY: plain call.
    let fresh = unsafe { GetTickCount64() }.saturating_sub(c.reader_tick.load(Relaxed)) < READER_TIMEOUT_MS;
    CAPTURE.with(|slot| {
        let mut slot = slot.borrow_mut();
        if !fresh {
            if slot.take().is_some() {
                c.handle.store(0, Relaxed);
                c.generation.fetch_add(1, Release);
            }
            return;
        }
        // SAFETY: COM calls on Chromium's live swap chain and its device, on its presenting thread.
        unsafe {
            let Some(sc) = IDXGISwapChain1::from_raw_borrowed(&swapchain) else { return };
            let Ok(back) = sc.GetBuffer::<ID3D11Texture2D>(0) else { return };
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            back.GetDesc(&mut desc);
            let Ok(device) = back.GetDevice() else { return };
            let stale = slot.as_ref().is_none_or(|t| (t.width, t.height, t.format) != (desc.Width, desc.Height, desc.Format));
            if stale {
                *slot = None;
                *slot = create_capture_texture(&device, &desc);
                let Some(t) = slot.as_ref() else { return };
                let luid = device.cast::<IDXGIDevice>().and_then(|d| d.GetAdapter()?.GetDesc()).map(|d| d.AdapterLuid);
                let luid = luid.map_or(0, |l| ((l.HighPart as u32 as u64) << 32) | l.LowPart as u64);
                c.adapter_luid.store(luid, Relaxed);
                c.width.store(t.width, Relaxed);
                c.height.store(t.height, Relaxed);
                c.format.store(t.format.0 as u32, Relaxed);
                c.handle.store(t.handle.0 as u64, Relaxed);
                c.gpu_pid.store(GetCurrentProcessId(), Relaxed);
                c.generation.fetch_add(1, Release);
            }
            let (Some(t), Ok(context)) = (slot.as_ref(), device.GetImmediateContext()) else { return };
            context.CopyResource(&t.texture, &back);
            context.Flush();
            c.frames.fetch_add(1, Release);
        }
    });
}

unsafe fn create_capture_texture(device: &ID3D11Device, back: &D3D11_TEXTURE2D_DESC) -> Option<CaptureTexture> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: back.Width,
        Height: back.Height,
        MipLevels: 1,
        ArraySize: 1,
        Format: back.Format,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
        CPUAccessFlags: 0,
        MiscFlags: (D3D11_RESOURCE_MISC_SHARED.0 | D3D11_RESOURCE_MISC_SHARED_NTHANDLE.0) as u32,
    };
    // SAFETY: COM calls on Chromium's device; the handle is ours to close (CaptureTexture::drop).
    unsafe {
        let mut texture = None;
        device.CreateTexture2D(&desc, None, Some(&mut texture)).ok()?;
        let texture = texture?;
        // No name: the sandboxed GPU process (low integrity) can't create named objects. Readers find the handle
        // through the shared memory block, which is keyed by the browser's pid, and duplicate it.
        let access = DXGI_SHARED_RESOURCE_READ.0 | DXGI_SHARED_RESOURCE_WRITE.0;
        let handle = texture.cast::<IDXGIResource1>().ok()?.CreateSharedHandle(None, access, PCWSTR::null()).ok()?;
        Some(CaptureTexture { texture, handle, width: desc.Width, height: desc.Height, format: desc.Format })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limiter_keeps_cadence_and_never_bursts() {
        let p = 1000;
        // First frame: no wait, the next is a period out.
        assert_eq!(schedule(0, 5000, p), (None, 6000));
        // Early: wait for the target.
        assert_eq!(schedule(6000, 5400, p), (Some(6000), 7000));
        // A little late: no wait, and the cadence holds (next stays on the grid).
        assert_eq!(schedule(7000, 7300, p), (None, 8000));
        // A stall of more than a period: restart from now instead of rushing frames out.
        assert_eq!(schedule(8000, 12_500, p), (None, 13_500));
    }

    #[test]
    fn limiter_holds_the_rate() {
        // Frames that take 300 ticks against a 1000-tick period present exactly once per period.
        let (p, mut now, mut target, mut presents) = (1000, 10_000, 0, Vec::new());
        for _ in 0..5 {
            let (wait, next) = schedule(target, now, p);
            now = wait.unwrap_or(now);
            presents.push(now);
            target = next;
            now += 300;
        }
        assert_eq!(presents, [10_000, 11_000, 12_000, 13_000, 14_000]);
    }

    #[test]
    fn only_window_sized_color_flip_swapchains() {
        let window = DXGI_SWAP_CHAIN_DESC1 {
            Width: 1920,
            Height: 1080,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
            ..Default::default()
        };
        assert!(is_window_swapchain(&window));
        assert!(!is_window_swapchain(&DXGI_SWAP_CHAIN_DESC1 { Format: DXGI_FORMAT_NV12, ..window }));
        assert!(!is_window_swapchain(&DXGI_SWAP_CHAIN_DESC1 { Width: 1, Height: 1, ..window }));
        assert!(!is_window_swapchain(&DXGI_SWAP_CHAIN_DESC1 { SwapEffect: DXGI_SWAP_EFFECT_DISCARD, ..window }));
    }
}
