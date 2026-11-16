//! The aim freeze fix, without a Chromium build.
//!
//! The freeze (Chromium issue 415071737): with uncapped FPS, Blink's main-thread scheduler treats mouse moves with the
//! LEFT button held as a gesture needing a smooth frame rate (`MainThreadSchedulerImpl::ShouldPrioritizeInputEvent`),
//! raises input and compositor work to the highest priority, and the back-to-back frames then starve the game's
//! network messages: other players freeze while you shoot.
//!
//! With raw input (pointer lock with unadjustedMovement, which Mercury requests), Chromium takes the button state of
//! a mouse move only from the raw packets it reads with `GetRawInputData` (`HWNDMessageHandler::OnInputEvent` and
//! `UpdateRawInputButtonState`). Button presses themselves still come from WM_LBUTTONDOWN/UP. So this module hands
//! Chromium those packets with the left button's down/up transitions removed: the game still gets its clicks, and
//! moves never say "left button held", so the scheduler never starts the gesture that starves the network.
//! libcef.dll delay-loads user32, so the hook replaces its delay-import slot for GetRawInputData.

use std::{
    ffi::c_void,
    sync::atomic::{AtomicUsize, Ordering},
};
use windows_sys::Win32::System::{
    LibraryLoader::{GetModuleHandleW, GetProcAddress},
    Memory::{VirtualProtect, PAGE_READWRITE},
};

type GetRawInputDataFn = unsafe extern "system" fn(*mut c_void, u32, *mut c_void, *mut u32, u32) -> u32;

const RID_INPUT: u32 = 0x1000_0003;
const RIM_TYPEMOUSE: u32 = 0;
/// RI_MOUSE_LEFT_BUTTON_DOWN | RI_MOUSE_LEFT_BUTTON_UP.
const LEFT_BUTTON_TRANSITIONS: u16 = 0x0001 | 0x0002;
/// RAWINPUT on x64: a 24-byte header (dwType, dwSize, hDevice, wParam), then RAWMOUSE (usFlags, 2 bytes of padding,
/// usButtonFlags, ...).
const BUTTON_FLAGS_OFFSET: usize = 24 + 4;

static REAL: AtomicUsize = AtomicUsize::new(0);

/// A raw mouse packet's button flags without the left button's transitions; wheel and other buttons stay.
pub fn without_left_transitions(flags: u16) -> u16 {
    flags & !LEFT_BUTTON_TRANSITIONS
}

unsafe extern "system" fn get_raw_input_data(input: *mut c_void, command: u32, data: *mut c_void, size: *mut u32, header: u32) -> u32 {
    // SAFETY: REAL holds user32's GetRawInputData, stored before the hook went in.
    let real: GetRawInputDataFn = unsafe { std::mem::transmute(REAL.load(Ordering::Relaxed)) };
    let written = unsafe { real(input, command, data, size, header) };
    let enough = written != u32::MAX && written as usize >= BUTTON_FLAGS_OFFSET + 2;
    if command == RID_INPUT && !data.is_null() && enough {
        // SAFETY: GetRawInputData just wrote `written` bytes of RAWINPUT at `data`.
        unsafe {
            if (data as *const u32).read_unaligned() == RIM_TYPEMOUSE {
                let flags = (data as *mut u8).add(BUTTON_FLAGS_OFFSET) as *mut u16;
                flags.write_unaligned(without_left_transitions(flags.read_unaligned()));
            }
        }
    }
    written
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Points libcef.dll's delay-import slot for user32!GetRawInputData at the filter. Returns how many slots changed.
pub fn install() -> Result<usize, String> {
    unsafe {
        let user32 = GetModuleHandleW(wide("user32.dll").as_ptr());
        let real = GetProcAddress(user32, c"GetRawInputData".as_ptr().cast()).ok_or("no GetRawInputData")?;
        REAL.store(real as usize, Ordering::Relaxed);
        let base = GetModuleHandleW(wide("libcef.dll").as_ptr()) as *const u8;
        if base.is_null() {
            return Err("libcef.dll is not loaded".into());
        }
        let u32_at = |offset: usize| (base.add(offset) as *const u32).read_unaligned() as usize;
        let nt = u32_at(0x3C);
        // PE32+: the data directories start 112 bytes into the optional header (after the 4-byte signature and the
        // 20-byte file header); entry 13 is the delay-import table.
        let delay_dir = nt + 24 + 112 + 13 * 8;
        let mut descriptor = u32_at(delay_dir);
        if descriptor == 0 {
            return Err("libcef.dll has no delay imports".into());
        }
        let mut patched = 0;
        // Each IMAGE_DELAYLOAD_DESCRIPTOR is 32 bytes: attributes, DLL name, module handle, IAT, name table, ...
        while u32_at(descriptor + 4) != 0 {
            let dll = std::ffi::CStr::from_ptr(base.add(u32_at(descriptor + 4)).cast());
            if dll.to_bytes().eq_ignore_ascii_case(b"user32.dll") {
                let (iat, names) = (u32_at(descriptor + 12), u32_at(descriptor + 16));
                for i in 0.. {
                    let entry = (base.add(names + i * 8) as *const u64).read_unaligned();
                    if entry == 0 {
                        break;
                    }
                    // By name (not by ordinal): IMAGE_IMPORT_BY_NAME, a 2-byte hint and the name.
                    if entry & (1 << 63) == 0 {
                        let name = std::ffi::CStr::from_ptr(base.add(entry as usize + 2).cast());
                        if name.to_bytes() == b"GetRawInputData" {
                            let slot = base.add(iat + i * 8) as *mut usize;
                            let mut old = 0;
                            if VirtualProtect(slot.cast(), 8, PAGE_READWRITE, &mut old) == 0 {
                                return Err("could not unprotect the import slot".into());
                            }
                            slot.write_unaligned(get_raw_input_data as GetRawInputDataFn as usize);
                            VirtualProtect(slot.cast(), 8, old, &mut old);
                            patched += 1;
                        }
                    }
                }
            }
            descriptor += 32;
        }
        Ok(patched)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_left_button_transitions_go() {
        assert_eq!(without_left_transitions(0x0001), 0); // left down
        assert_eq!(without_left_transitions(0x0002), 0); // left up
        assert_eq!(without_left_transitions(0x0004 | 0x0008), 0x0004 | 0x0008); // right down and up stay
        assert_eq!(without_left_transitions(0x0400 | 0x0001), 0x0400); // the wheel stays
    }
}
