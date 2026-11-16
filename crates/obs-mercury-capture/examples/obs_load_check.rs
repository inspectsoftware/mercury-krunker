//! Loads the plugin into the installed OBS's libobs, headless, and checks what libobs registered: the module loads,
//! and the source's name, output flags and create/size callbacks come back right (so the obs_source_info layout
//! matches). Nothing is written to OBS's folders: no config path, no video.
//!
//!     cargo build -p obs-mercury-capture --release
//!     cargo run -p obs-mercury-capture --release --example obs_load_check -- [obs bin dir] [plugin dll]

use std::ffi::{c_char, c_void, CStr, CString};
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryExW, LOAD_WITH_ALTERED_SEARCH_PATH};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let obs_dir = args.first().cloned().unwrap_or_else(|| r"C:\Program Files\obs-studio\bin\64bit".into());
    let plugin = args.get(1).cloned().unwrap_or_else(|| r"target\release\obs_mercury_capture.dll".into());
    let plugin = std::fs::canonicalize(&plugin).expect("plugin dll").to_string_lossy().trim_start_matches(r"\\?\").to_string();

    let path: Vec<u16> = format!(r"{obs_dir}\obs.dll").encode_utf16().chain([0]).collect();
    let obs = unsafe { LoadLibraryExW(path.as_ptr(), std::ptr::null_mut(), LOAD_WITH_ALTERED_SEARCH_PATH) };
    assert!(!obs.is_null(), "could not load obs.dll from {obs_dir}");
    macro_rules! f {
        ($name:literal, $ty:ty) => {
            unsafe { std::mem::transmute::<_, $ty>(GetProcAddress(obs, concat!($name, "\0").as_ptr()).expect($name)) }
        };
    }
    let version = f!("obs_get_version_string", unsafe extern "C" fn() -> *const c_char);
    let startup = f!("obs_startup", unsafe extern "C" fn(*const c_char, *const c_char, *mut c_void) -> bool);
    let open = f!("obs_open_module", unsafe extern "C" fn(*mut *mut c_void, *const c_char, *const c_char) -> i32);
    let init = f!("obs_init_module", unsafe extern "C" fn(*mut c_void) -> bool);
    let display_name = f!("obs_source_get_display_name", unsafe extern "C" fn(*const c_char) -> *const c_char);
    let flags = f!("obs_get_source_output_flags", unsafe extern "C" fn(*const c_char) -> u32);
    let create = f!("obs_source_create", unsafe extern "C" fn(*const c_char, *const c_char, *mut c_void, *mut c_void) -> *mut c_void);
    let width = f!("obs_source_get_width", unsafe extern "C" fn(*mut c_void) -> u32);
    let release = f!("obs_source_release", unsafe extern "C" fn(*mut c_void));
    let shutdown = f!("obs_shutdown", unsafe extern "C" fn());

    unsafe {
        println!("libobs {}", CStr::from_ptr(version()).to_string_lossy());
        assert!(startup(c"en-US".as_ptr(), std::ptr::null(), std::ptr::null_mut()), "obs_startup failed");
        let mut module = std::ptr::null_mut();
        let path = CString::new(plugin.clone()).unwrap();
        let status = open(&mut module, path.as_ptr(), c"".as_ptr());
        println!("obs_open_module({plugin}) = {status} (0 = success)");
        assert_eq!(status, 0);
        assert!(init(module), "obs_init_module: obs_module_load failed");
        let id = c"mercury_client_capture";
        let name = display_name(id.as_ptr());
        assert!(!name.is_null(), "source not registered");
        println!("source {:?}: name {:?}, output flags {:#x}", id, CStr::from_ptr(name), flags(id.as_ptr()));
        let source = create(id.as_ptr(), c"check".as_ptr(), std::ptr::null_mut(), std::ptr::null_mut());
        assert!(!source.is_null(), "obs_source_create failed");
        println!("created; width with no Mercury frame yet: {}", width(source));
        release(source);
        shutdown();
    }
    println!("ok");
}
