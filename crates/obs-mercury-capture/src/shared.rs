//! Finding a running Mercury Client and its capture texture. Mercury's browser process creates the shared memory block
//! `Local\MercuryPresent-<browser pid>`; its GPU process fills `Capture` while a reader's heartbeat is fresh. This is
//! this crate's own copy of the block's start (Mercury: src/present.rs).

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering::*};
use windows_sys::Win32::{
    Foundation::{CloseHandle, DuplicateHandle, DUPLICATE_SAME_ACCESS, HANDLE, WAIT_TIMEOUT},
    System::{
        Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
        Memory::{MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_ALL_ACCESS, MEMORY_MAPPED_VIEW_ADDRESS},
        SystemInformation::GetTickCount64,
        Threading::{GetCurrentProcess, OpenProcess, WaitForSingleObject, PROCESS_DUP_HANDLE, PROCESS_SYNCHRONIZE},
    },
};

pub const MAGIC: u32 = u32::from_le_bytes(*b"MPR1");

#[repr(C)]
pub struct Capture {
    pub reader_tick: AtomicU64,
    pub gpu_pid: AtomicU32,
    pub generation: AtomicU32,
    pub handle: AtomicU64,
    pub adapter_luid: AtomicU64,
    pub width: AtomicU32,
    pub height: AtomicU32,
    pub format: AtomicU32,
    pub _reserved: AtomicU32,
    pub frames: AtomicU64,
}

#[repr(C)]
struct Head {
    magic: u32,
    size: u32,
    capture: Capture,
}

/// A Mercury instance we read from: its mapped block and its browser process (to notice when it exits).
pub struct Mercury {
    view: *mut Head,
    mapping: HANDLE,
    process: HANDLE,
    pub browser_pid: u32,
}

// SAFETY: the view is shared memory of atomics; the handles are process-wide.
unsafe impl Send for Mercury {}

impl Mercury {
    /// The first running Mercury Client with a present block.
    pub fn find() -> Option<Mercury> {
        mercury_pids().into_iter().find_map(Mercury::open)
    }

    pub fn open(browser_pid: u32) -> Option<Mercury> {
        let name: Vec<u16> = format!("Local\\MercuryPresent-{browser_pid}\0").encode_utf16().collect();
        // SAFETY: we map only `Head`, which Mercury's block starts with, and check its magic.
        unsafe {
            let mapping = OpenFileMappingW(FILE_MAP_ALL_ACCESS, 0, name.as_ptr());
            if mapping.is_null() {
                return None;
            }
            let view = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, size_of::<Head>()).Value as *mut Head;
            let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, browser_pid);
            let mercury = Mercury { view, mapping, process, browser_pid };
            (!view.is_null() && (*view).magic == MAGIC && !process.is_null()).then_some(mercury)
        }
    }

    pub fn capture(&self) -> &Capture {
        // SAFETY: mapped for our lifetime.
        unsafe { &(*self.view).capture }
    }

    pub fn alive(&self) -> bool {
        // SAFETY: our process handle.
        unsafe { WaitForSingleObject(self.process, 0) == WAIT_TIMEOUT }
    }

    /// Tells the GPU process a reader wants frames; it stops copying 2 s after the last heartbeat.
    pub fn heartbeat(&self) {
        // SAFETY: plain call.
        self.capture().reader_tick.store(unsafe { GetTickCount64() }, Relaxed);
    }

    /// The texture's NT handle, duplicated into this process (the caller closes it). `None` while there is none.
    pub fn duplicate_texture_handle(&self) -> Option<HANDLE> {
        let c = self.capture();
        let (pid, handle) = (c.gpu_pid.load(Relaxed), c.handle.load(Relaxed));
        if handle == 0 {
            return None;
        }
        // SAFETY: handles we open and close; DuplicateHandle copies the texture handle into this process.
        unsafe {
            let gpu = OpenProcess(PROCESS_DUP_HANDLE, 0, pid);
            if gpu.is_null() {
                return None;
            }
            let mut out = std::ptr::null_mut();
            let ok = DuplicateHandle(gpu, handle as HANDLE, GetCurrentProcess(), &mut out, 0, 0, DUPLICATE_SAME_ACCESS);
            CloseHandle(gpu);
            (ok != 0).then_some(out)
        }
    }

    /// Generation of the texture now in the block (read before the other fields).
    pub fn generation(&self) -> u32 {
        self.capture().generation.load(Acquire)
    }
}

impl Drop for Mercury {
    fn drop(&mut self) {
        // SAFETY: our own view and handles.
        unsafe {
            UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: self.view.cast() });
            CloseHandle(self.mapping);
            CloseHandle(self.process);
        }
    }
}

/// Every running MercuryClient.exe (browser and child processes alike; only the browser has a block).
fn mercury_pids() -> Vec<u32> {
    let mut pids = Vec::new();
    // SAFETY: a snapshot we own and close.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot as isize == -1 {
            return pids;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..len]).eq_ignore_ascii_case("MercuryClient.exe") {
                pids.push(entry.th32ProcessID);
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    pids
}
