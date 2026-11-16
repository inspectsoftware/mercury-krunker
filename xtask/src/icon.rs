//! Puts Mercury's icon into mercury.exe (a copy of CEF's bootstrap.exe): every image of an .ico becomes an
//! RT_ICON resource, and the exe's first icon group (the one Explorer, shortcuts and the taskbar show) is replaced
//! by a group pointing at them.

use std::{ffi::c_void, path::Path, ptr::null};
use windows_sys::Win32::{
    Foundation::{FreeLibrary, HMODULE},
    System::LibraryLoader::{
        BeginUpdateResourceW, EndUpdateResourceW, EnumResourceLanguagesW, EnumResourceNamesW, LoadLibraryExW,
        UpdateResourceW, LOAD_LIBRARY_AS_DATAFILE,
    },
};

const RT_ICON: *const u16 = 3 as _;
const RT_GROUP_ICON: *const u16 = 14 as _;
/// Our RT_ICON ids start here, clear of the few CEF ships.
const FIRST_ID: u16 = 1000;

fn wide(s: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    s.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

/// One .ico image: its 16-byte directory entry and its bytes.
type Image<'a> = (&'a [u8], &'a [u8]);

fn images(ico: &[u8]) -> Result<Vec<Image<'_>>, String> {
    let u16_at = |i: usize| ico.get(i..i + 2).map(|b| u16::from_le_bytes([b[0], b[1]]));
    let u32_at = |i: usize| ico.get(i..i + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
    if u16_at(2) != Some(1) {
        return Err("not an .ico file".into());
    }
    let count = u16_at(4).ok_or("truncated .ico")? as usize;
    (0..count)
        .map(|i| {
            let entry = ico.get(6 + 16 * i..22 + 16 * i).ok_or("truncated .ico")?;
            let (size, offset) = (u32_at(14 + 16 * i).ok_or("bad entry")?, u32_at(18 + 16 * i).ok_or("bad entry")?);
            Ok((entry, ico.get(offset..offset + size).ok_or("image outside the file")?))
        })
        .collect()
}

/// The group-icon directory: the .ico directory with each image's file offset replaced by its resource id.
fn group(images: &[Image]) -> Vec<u8> {
    let mut out = vec![0, 0, 1, 0];
    out.extend_from_slice(&(images.len() as u16).to_le_bytes());
    for (i, (entry, _)) in images.iter().enumerate() {
        out.extend_from_slice(&entry[..12]);
        out.extend_from_slice(&(FIRST_ID + i as u16).to_le_bytes());
    }
    out
}

/// The name (an id or a string pointer, as Windows hands it over) and language of the exe's first icon group.
fn first_group(exe: &Path) -> Result<(usize, u16), String> {
    unsafe extern "system" fn name(_: HMODULE, _: *const u16, name: *const u16, out: isize) -> i32 {
        unsafe { *(out as *mut usize) = name as usize };
        0 // stop at the first
    }
    unsafe extern "system" fn lang(_: HMODULE, _: *const u16, _: *const u16, lang: u16, out: isize) -> i32 {
        unsafe { *(out as *mut u16) = lang };
        0
    }
    let module = unsafe { LoadLibraryExW(wide(exe).as_ptr(), null::<c_void>() as _, LOAD_LIBRARY_AS_DATAFILE) };
    if module.is_null() {
        return Err("could not open the exe".into());
    }
    let (mut group, mut language) = (0usize, 0u16);
    unsafe {
        EnumResourceNamesW(module, RT_GROUP_ICON, Some(name), &mut group as *mut usize as isize);
        if group != 0 {
            EnumResourceLanguagesW(module, RT_GROUP_ICON, group as *const u16, Some(lang), &mut language as *mut u16 as isize);
        }
        FreeLibrary(module);
    }
    // A string name points into the module we just freed: only numeric ids (CEF's case) are safe to keep.
    if group == 0 || group > 0xFFFF {
        return Err("the exe has no numeric icon group".into());
    }
    Ok((group, language))
}

pub fn set(exe: &Path, ico: &Path) -> Result<(), String> {
    let ico = std::fs::read(ico).map_err(|e| e.to_string())?;
    let images = images(&ico)?;
    let (group_name, language) = first_group(exe)?;
    let directory = group(&images);
    unsafe {
        let update = BeginUpdateResourceW(wide(exe).as_ptr(), 0);
        if update.is_null() {
            return Err("could not update the exe's resources".into());
        }
        let mut ok = true;
        for (i, (_, data)) in images.iter().enumerate() {
            let id = (FIRST_ID + i as u16) as usize as *const u16;
            ok &= UpdateResourceW(update, RT_ICON, id, language, data.as_ptr().cast(), data.len() as u32) != 0;
        }
        ok &= UpdateResourceW(update, RT_GROUP_ICON, group_name as *const u16, language, directory.as_ptr().cast(), directory.len() as u32) != 0;
        if EndUpdateResourceW(update, if ok { 0 } else { 1 }) == 0 || !ok {
            return Err("writing the icon failed".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ico_images_become_a_group_directory() {
        // A two-image .ico: 6-byte header, two 16-byte entries, then 3 + 2 bytes of image data.
        let mut ico = vec![0, 0, 1, 0, 2, 0];
        ico.extend_from_slice(&[16, 16, 0, 0, 1, 0, 32, 0, 3, 0, 0, 0, 38, 0, 0, 0]);
        ico.extend_from_slice(&[32, 32, 0, 0, 1, 0, 32, 0, 2, 0, 0, 0, 41, 0, 0, 0]);
        ico.extend_from_slice(&[1, 2, 3, 4, 5]);
        let found = images(&ico).unwrap();
        assert_eq!(found.iter().map(|(_, d)| d.to_vec()).collect::<Vec<_>>(), vec![vec![1, 2, 3], vec![4, 5]]);
        let dir = group(&found);
        assert_eq!(dir.len(), 6 + 14 * 2);
        assert_eq!(&dir[6 + 12..6 + 14], &FIRST_ID.to_le_bytes());
        assert_eq!(&dir[6 + 14 + 12..6 + 28], &(FIRST_ID + 1).to_le_bytes());
        assert!(images(&[0, 0, 2, 0, 0, 0]).is_err());
    }
}
