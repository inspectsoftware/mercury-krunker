//! obs-mercury-capture: an OBS Studio 33 video source, "Mercury Client", that shows the game exactly as Mercury
//! presents it. Mercury's GPU process copies each presented frame into a shared D3D11 texture while this source asks
//! for frames (a heartbeat in shared memory); the source duplicates the texture's NT handle into OBS and draws it.
//! No window capture, no hooks in OBS, and nothing injected into the game.
//!
//! GPL-2.0-or-later: it links libobs. The libobs declarations below were written for this crate against the OBS 33.0.1
//! headers (libobs/obs-module.h, obs-source.h, obs.h, graphics/graphics.h).

pub mod shared;

use shared::Mercury;
use std::{
    ffi::{c_char, c_void},
    sync::atomic::{AtomicPtr, Ordering::*},
    time::{Duration, Instant},
};
use windows_sys::Win32::Foundation::CloseHandle;

// --- libobs (obs.dll), OBS 33.0.1 ---

/// LIBOBS_API_VER for 33.0.1: MAKE_SEMANTIC_VERSION(33, 0, 1).
const LIBOBS_API_VER: u32 = (33 << 24) | 1;
const OBS_SOURCE_TYPE_INPUT: u32 = 0;
const OBS_SOURCE_VIDEO: u32 = 1 << 0;
const OBS_SOURCE_CUSTOM_DRAW: u32 = 1 << 3;
/// enum obs_base_effect: OBS_EFFECT_OPAQUE draws RGB with alpha forced to 1.
const OBS_EFFECT_OPAQUE: u32 = 2;
const LOG_WARNING: i32 = 200;
const LOG_INFO: i32 = 300;

type Data = *mut c_void;

/// struct obs_source_info, up to `video_render`. libobs takes the size we register with and zero-fills the rest
/// (obs_register_source_s), so the prefix is all a video source needs.
#[repr(C)]
struct ObsSourceInfo {
    id: *const c_char,
    source_type: u32,
    output_flags: u32,
    get_name: Option<unsafe extern "C" fn(type_data: *mut c_void) -> *const c_char>,
    create: Option<unsafe extern "C" fn(settings: *mut c_void, source: *mut c_void) -> Data>,
    destroy: Option<unsafe extern "C" fn(data: Data)>,
    get_width: Option<unsafe extern "C" fn(data: Data) -> u32>,
    get_height: Option<unsafe extern "C" fn(data: Data) -> u32>,
    get_defaults: Option<unsafe extern "C" fn(settings: *mut c_void)>,
    get_properties: Option<unsafe extern "C" fn(data: Data) -> *mut c_void>,
    update: Option<unsafe extern "C" fn(data: Data, settings: *mut c_void)>,
    activate: Option<unsafe extern "C" fn(data: Data)>,
    deactivate: Option<unsafe extern "C" fn(data: Data)>,
    show: Option<unsafe extern "C" fn(data: Data)>,
    hide: Option<unsafe extern "C" fn(data: Data)>,
    video_tick: Option<unsafe extern "C" fn(data: Data, seconds: f32)>,
    video_render: Option<unsafe extern "C" fn(data: Data, effect: *mut c_void)>,
}

// SAFETY: the struct only holds pointers to statics and functions.
unsafe impl Sync for ObsSourceInfo {}

#[link(name = "obs", kind = "raw-dylib")]
unsafe extern "C" {
    fn obs_register_source_s(info: *const ObsSourceInfo, size: usize);
    fn obs_enter_graphics();
    fn obs_leave_graphics();
    fn obs_get_base_effect(effect: u32) -> *mut c_void;
    fn obs_source_draw(image: *mut c_void, x: i32, y: i32, cx: u32, cy: u32, flip: bool);
    fn gs_effect_loop(effect: *mut c_void, name: *const c_char) -> bool;
    fn gs_texture_open_nt_shared(handle: u32) -> *mut c_void;
    fn gs_texture_destroy(tex: *mut c_void);
    fn gs_texture_get_width(tex: *const c_void) -> u32;
    fn gs_texture_get_height(tex: *const c_void) -> u32;
    fn blog(level: i32, format: *const c_char, ...);
}

fn log(level: i32, message: &str) {
    let text = std::ffi::CString::new(format!("[mercury-capture] {message}")).unwrap_or_default();
    // SAFETY: a "%s" format with one C string.
    unsafe { blog(level, c"%s".as_ptr(), text.as_ptr()) };
}

// --- Module exports (OBS_DECLARE_MODULE) ---

static MODULE: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

#[unsafe(no_mangle)]
pub extern "C" fn obs_module_set_pointer(module: *mut c_void) {
    MODULE.store(module, Relaxed);
}

#[unsafe(no_mangle)]
pub extern "C" fn obs_current_module() -> *mut c_void {
    MODULE.load(Relaxed)
}

#[unsafe(no_mangle)]
pub extern "C" fn obs_module_ver() -> u32 {
    LIBOBS_API_VER
}

#[unsafe(no_mangle)]
pub extern "C" fn obs_module_name() -> *const c_char {
    c"Mercury Client Capture".as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn obs_module_description() -> *const c_char {
    c"Shows Mercury Client's game frames from a shared texture.".as_ptr()
}

static SOURCE: ObsSourceInfo = ObsSourceInfo {
    id: c"mercury_client_capture".as_ptr(),
    source_type: OBS_SOURCE_TYPE_INPUT,
    output_flags: OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW,
    get_name: Some(get_name),
    create: Some(create),
    destroy: Some(destroy),
    get_width: Some(get_width),
    get_height: Some(get_height),
    get_defaults: None,
    get_properties: None,
    update: None,
    activate: None,
    deactivate: None,
    show: None,
    hide: None,
    video_tick: Some(video_tick),
    video_render: Some(video_render),
};

#[unsafe(no_mangle)]
pub extern "C" fn obs_module_load() -> bool {
    // SAFETY: a static source definition, registered with its own size.
    unsafe { obs_register_source_s(&SOURCE, size_of::<ObsSourceInfo>()) };
    true
}

// --- The source ---

struct Source {
    mercury: Option<Mercury>,
    last_search: Option<Instant>,
    /// gs_texture_t, only touched in the graphics context.
    texture: *mut c_void,
    generation: u32,
    size: (u32, u32),
}

unsafe extern "C" fn get_name(_: *mut c_void) -> *const c_char {
    c"Mercury Client".as_ptr()
}

unsafe extern "C" fn create(_settings: *mut c_void, _source: *mut c_void) -> Data {
    let source = Source { mercury: None, last_search: None, texture: std::ptr::null_mut(), generation: 0, size: (0, 0) };
    Box::into_raw(Box::new(source)).cast()
}

unsafe extern "C" fn destroy(data: Data) {
    // SAFETY: the Box from `create`; the texture is freed inside the graphics context.
    unsafe {
        let source = Box::from_raw(data as *mut Source);
        if !source.texture.is_null() {
            obs_enter_graphics();
            gs_texture_destroy(source.texture);
            obs_leave_graphics();
        }
    }
}

unsafe extern "C" fn get_width(data: Data) -> u32 {
    // SAFETY: our Source.
    unsafe { (*(data as *const Source)).size.0 }
}

unsafe extern "C" fn get_height(data: Data) -> u32 {
    // SAFETY: our Source.
    unsafe { (*(data as *const Source)).size.1 }
}

/// Finds Mercury (every 2 s until it runs), keeps its heartbeat fresh, and lets go when it exits.
unsafe extern "C" fn video_tick(data: Data, _seconds: f32) {
    // SAFETY: our Source; OBS calls tick and render on its video thread.
    let source = unsafe { &mut *(data as *mut Source) };
    if source.mercury.as_ref().is_some_and(|m| !m.alive()) {
        log(LOG_INFO, "Mercury Client closed");
        source.mercury = None;
    }
    if source.mercury.is_none() && source.last_search.is_none_or(|t| t.elapsed() > Duration::from_secs(2)) {
        source.last_search = Some(Instant::now());
        source.mercury = Mercury::find();
        if let Some(m) = &source.mercury {
            log(LOG_INFO, &format!("found Mercury Client (pid {})", m.browser_pid));
        }
    }
    if let Some(m) = &source.mercury {
        m.heartbeat();
    }
}

unsafe extern "C" fn video_render(data: Data, _effect: *mut c_void) {
    // SAFETY: our Source, in the graphics context OBS renders in.
    unsafe {
        let source = &mut *(data as *mut Source);
        let generation = source.mercury.as_ref().map(|m| m.generation());
        if generation != Some(source.generation) || source.mercury.is_none() {
            if !source.texture.is_null() {
                gs_texture_destroy(source.texture);
                source.texture = std::ptr::null_mut();
                source.size = (0, 0);
            }
            source.generation = generation.unwrap_or(0);
            if let Some(handle) = source.mercury.as_ref().and_then(|m| m.duplicate_texture_handle()) {
                // NT handles fit in 32 bits (the libobs API takes a uint32_t).
                source.texture = gs_texture_open_nt_shared(handle as usize as u32);
                CloseHandle(handle);
                if source.texture.is_null() {
                    log(LOG_WARNING, "could not open Mercury's texture: is OBS on the same GPU as the game? (Windows Settings → Display → Graphics)");
                } else {
                    source.size = (gs_texture_get_width(source.texture), gs_texture_get_height(source.texture));
                }
            }
        }
        if source.texture.is_null() {
            return;
        }
        let effect = obs_get_base_effect(OBS_EFFECT_OPAQUE);
        while gs_effect_loop(effect, c"Draw".as_ptr()) {
            obs_source_draw(source.texture, 0, 0, 0, 0, false);
        }
    }
}
