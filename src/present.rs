//! The browser ↔ GPU process link: one shared memory block per Mercury instance, `Local\MercuryPresent-<browser pid>`.
//! - The browser creates it before Chromium starts and writes the hook's settings into it.
//! - The GPU process opens it before its sandbox locks down (gpu_hook.rs), then reports its state and present times.
//! - The OBS plugin (crates/obs-mercury-capture, its own copy of `Capture`) opens it to find the capture texture.
//!
//! Three processes read and write it at once, so every field is an atomic. `Capture` comes first so the plugin's copy
//! of the layout never moves when the rest grows.

use std::sync::{
    atomic::{AtomicU32, AtomicU64, Ordering::*},
    OnceLock,
};
use windows_sys::Win32::{
    Foundation::INVALID_HANDLE_VALUE,
    Security::{
        Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1},
        SECURITY_ATTRIBUTES,
    },
    System::Memory::{CreateFileMappingW, MapViewOfFile, OpenFileMappingW, FILE_MAP_ALL_ACCESS, PAGE_READWRITE},
};

pub const MAGIC: u32 = u32::from_le_bytes(*b"MPR1");
/// Present-to-present times kept for the stats: about 2 s at 500 FPS.
pub const RING: usize = 1024;

/// The capture texture, as the OBS plugin sees it. Keep in step with crates/obs-mercury-capture/src/shared.rs.
#[repr(C)]
pub struct Capture {
    /// `GetTickCount64()` of the reader's last heartbeat; the hook copies frames while it is under 2 s old.
    pub reader_tick: AtomicU64,
    pub gpu_pid: AtomicU32,
    /// Bumps whenever the texture is recreated (resize, new swap chain).
    pub generation: AtomicU32,
    /// NT handle to the shared texture, valid in the GPU process (`gpu_pid`): the reader duplicates it.
    pub handle: AtomicU64,
    /// The adapter the texture lives on: a reader on another GPU can't open it.
    pub adapter_luid: AtomicU64,
    pub width: AtomicU32,
    pub height: AtomicU32,
    /// `DXGI_FORMAT`.
    pub format: AtomicU32,
    pub _reserved: AtomicU32,
    /// Frames copied so far; a reader that sees it move knows a new frame is in the texture.
    pub frames: AtomicU64,
}

#[repr(C)]
pub struct Shared {
    pub magic: u32,
    pub size: u32,
    pub capture: Capture,
    // Browser → GPU process.
    pub mode: AtomicU32,
    /// Live: 0 = uncapped.
    pub fps_limit: AtomicU32,
    // GPU process → browser. The hook never changes Chromium's swap chain; these record what Chromium did.
    pub state: AtomicU32,
    /// What failed (a step number), when `state` is `FAILED`.
    pub detail: AtomicU32,
    pub info: AtomicU32,
    /// Window-sized swap chains Chromium created.
    pub swapchains: AtomicU32,
    pub width: AtomicU32,
    pub height: AtomicU32,
    /// `DXGI_SWAP_CHAIN_FLAG`s of the window swap chain, at creation and at the last ResizeBuffers.
    pub swapchain_flags: AtomicU32,
    pub resize_flags: AtomicU32,
    /// The sync interval and `DXGI_PRESENT` flags of Chromium's last present.
    pub sync_interval: AtomicU32,
    pub present_flags: AtomicU32,
    pub gpu_starts: AtomicU32,
    pub presents: AtomicU64,
    pub ring_pos: AtomicU64,
    /// Present-to-present times of the window's swap chain, in µs.
    pub ring: [AtomicU32; RING],
}

/// `Shared::mode`.
pub mod mode {
    pub const OFF: u32 = 0;
    /// On, except where the window's display hangs off another GPU (hybrid laptops).
    pub const AUTO: u32 = 1;
    pub const FORCE: u32 = 2;
}

/// `Shared::state`.
pub mod state {
    /// No GPU process has opened the block (yet).
    pub const NONE: u32 = 0;
    pub const OFF: u32 = 1;
    /// Hybrid laptop: the fast GPU doesn't drive the primary display, so presents cross adapters.
    pub const SKIPPED_HYBRID: u32 = 2;
    /// The vtables are patched; no window swap chain yet.
    pub const INSTALLED: u32 = 3;
    /// The window's swap chain presents through the hook.
    pub const HOOKED: u32 = 4;
    pub const FAILED: u32 = 5;
    /// Chromium restarted the GPU process twice: from then on it runs without the hook.
    pub const DISABLED_AFTER_CRASH: u32 = 6;

    pub fn name(state: u32) -> &'static str {
        match state {
            OFF => "off",
            SKIPPED_HYBRID => "skipped (hybrid laptop)",
            INSTALLED => "installed",
            HOOKED => "active",
            FAILED => "failed",
            DISABLED_AFTER_CRASH => "off after GPU crashes",
            _ => "not running",
        }
    }
}

/// `Shared::info` bits.
pub mod info {
    pub const CROSS_ADAPTER: u32 = 1 << 0;
    /// Chromium created the window swap chain with ALLOW_TEARING.
    pub const TEARING: u32 = 1 << 1;
    /// Chromium created it with a frame latency waitable object (its DXGIWaitableSwapChain feature).
    pub const WAITABLE: u32 = 1 << 2;
    pub const MMCSS: u32 = 1 << 3;
    /// Chromium presents on the GPU process's main thread (where MMCSS was set before the sandbox).
    pub const MAIN_THREAD: u32 = 1 << 4;
    pub const COMPOSITION: u32 = 1 << 5;
    pub const HWND: u32 = 1 << 6;
}

impl Shared {
    pub fn push_frame_time(&self, micros: u32) {
        let pos = self.ring_pos.load(Relaxed);
        self.ring[pos as usize % RING].store(micros, Relaxed);
        self.ring_pos.store(pos + 1, Release);
        self.presents.fetch_add(1, Relaxed);
    }

    /// The newest frame times, newest last; skips the slot the writer may be filling.
    pub fn frame_times(&self) -> Vec<u32> {
        let pos = self.ring_pos.load(Acquire);
        let n = pos.min(RING as u64 - 1);
        (pos - n..pos).map(|i| self.ring[i as usize % RING].load(Relaxed)).collect()
    }
}

pub fn name(browser_pid: u32) -> Vec<u16> {
    format!("Local\\MercuryPresent-{browser_pid}\0").encode_utf16().collect()
}

static SHARED: OnceLock<&'static Shared> = OnceLock::new();

/// This process's block: the one it created (browser) or opened (GPU process).
pub fn get() -> Option<&'static Shared> {
    SHARED.get().copied()
}

/// Browser process: creates the block for this instance. The OS hands it over zeroed.
pub fn create() -> Option<&'static Shared> {
    let size = size_of::<Shared>() as u32;
    let name = name(std::process::id());
    // Chromium starts the GPU process at low integrity with a restricted token: a default section (medium label) would
    // refuse it write access. Low label, and access for restricted tokens too.
    let sddl: Vec<u16> = "D:(A;;GA;;;WD)(A;;GA;;;RC)S:(ML;;NW;;;LW)\0".encode_utf16().collect();
    let mut descriptor = std::ptr::null_mut();
    // SAFETY: a NUL-terminated SDDL string; Windows allocates the descriptor, which lives as long as the process.
    let ok = unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut descriptor, std::ptr::null_mut()) };
    let attributes = SECURITY_ATTRIBUTES { nLength: size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: descriptor, bInheritHandle: 0 };
    let attributes = if ok != 0 { &raw const attributes } else { std::ptr::null() };
    // SAFETY: a fresh page-file-backed mapping of `size` bytes, mapped once and never unmapped.
    let shared = unsafe {
        let mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, attributes, PAGE_READWRITE, 0, size, name.as_ptr());
        if mapping.is_null() {
            return None;
        }
        let view = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, size as usize);
        if view.Value.is_null() {
            return None;
        }
        let shared = &mut *(view.Value as *mut Shared);
        shared.magic = MAGIC;
        shared.size = size;
        &*shared
    };
    Some(*SHARED.get_or_init(|| shared))
}

/// GPU process: opens the browser's block. Must run before the sandbox drops the token's rights.
pub fn open(browser_pid: u32) -> Option<&'static Shared> {
    let name = name(browser_pid);
    // SAFETY: the mapping is at least `size_of::<Shared>()` (checked below through `size`) and lives as long as us.
    let shared = unsafe {
        let mapping = OpenFileMappingW(FILE_MAP_ALL_ACCESS, 0, name.as_ptr());
        if mapping.is_null() {
            return None;
        }
        let view = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, size_of::<Shared>());
        if view.Value.is_null() {
            return None;
        }
        &*(view.Value as *const Shared)
    };
    if shared.magic != MAGIC || shared.size as usize != size_of::<Shared>() {
        return None;
    }
    Some(*SHARED.get_or_init(|| shared))
}

/// What the page's present-FPS counter shows.
#[derive(Debug, PartialEq)]
pub struct Stats {
    pub fps: f64,
    pub avg_ms: f64,
    pub p50_ms: f64,
    pub p99_ms: f64,
    pub max_ms: f64,
}

/// Stats over the newest frames that fit in `window_us` (frame times in µs, newest last).
pub fn summarize(times: &[u32], window_us: u64) -> Option<Stats> {
    let mut total = 0u64;
    let mut recent: Vec<u32> = times
        .iter()
        .rev()
        .take_while(|&&t| {
            total += t as u64;
            total <= window_us
        })
        .copied()
        .collect();
    if recent.is_empty() {
        return None;
    }
    let sum: u64 = recent.iter().map(|&t| t as u64).sum();
    recent.sort_unstable();
    // Nearest-rank percentiles.
    let pct = |p: usize| recent[((recent.len() * p).div_ceil(100)).saturating_sub(1)] as u64;
    let ms = |us: u64| us as f64 / 1000.0;
    Some(Stats {
        fps: recent.len() as f64 * 1e6 / sum as f64,
        avg_ms: ms(sum) / recent.len() as f64,
        p50_ms: ms(pct(50)),
        p99_ms: ms(pct(99)),
        max_ms: ms(*recent.last().unwrap() as u64),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_takes_the_newest_window() {
        // 100 frames of 4 ms, then 10 of 10 ms (newest). A 100 ms window holds the 10 slow ones only.
        let mut times = vec![4000u32; 100];
        times.extend([10_000; 10]);
        let s = summarize(&times, 100_000).unwrap();
        assert_eq!((s.fps.round(), s.avg_ms, s.p99_ms), (100.0, 10.0, 10.0));
    }

    #[test]
    fn p99_is_nearest_rank() {
        // 1..=200 ms in µs: nearest-rank p99 of 200 values is the 198th.
        let times: Vec<u32> = (1..=200).map(|ms| ms * 1000).collect();
        let s = summarize(&times, u64::MAX).unwrap();
        assert_eq!((s.p50_ms, s.p99_ms, s.max_ms), (100.0, 198.0, 200.0));
        assert_eq!(summarize(&[], 1_000_000), None);
        assert_eq!(summarize(&[2_000_000], 1_000_000), None);
    }

    #[test]
    fn ring_keeps_the_newest() {
        let shared: Box<Shared> = unsafe { Box::new(std::mem::zeroed()) };
        for t in 0..(RING as u32 + 10) {
            shared.push_frame_time(t);
        }
        let times = shared.frame_times();
        assert_eq!(times.len(), RING - 1);
        assert_eq!((times[0], *times.last().unwrap()), (11, RING as u32 + 9));
    }
}
