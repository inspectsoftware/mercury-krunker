//! `diag.report`: one text file in Downloads with what support needs: Mercury and Windows versions, CPU and memory,
//! the engine switches in effect, settings, the page's own findings (GPU, FPS, Krunker settings) and the log tail.
//! Never includes accounts, passwords or login tokens.

use crate::{log, settings, VERSION};
use serde_json::Value;
use std::fmt::Write;
use windows_sys::Win32::System::{
    Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ},
    SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
};

pub fn command(cmd: &str, request: &Value) -> Result<Value, String> {
    match cmd {
        "diag.report" => {
            let name = request["name"].as_str().unwrap_or_default();
            if !name.ends_with(".txt") || !name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) {
                return Err("bad file name".into());
            }
            let path = crate::bridge::downloads_dir().ok_or("no Downloads folder")?.join(name);
            std::fs::write(&path, report(&request["page"])).map_err(|e| e.to_string())?;
            Ok(serde_json::json!(path))
        }
        _ => Err(format!("unknown command {cmd}")),
    }
}

fn reg_string(key: &str, value: &str) -> String {
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let mut buf = vec![0u16; 512];
    let mut len = (buf.len() * 2) as u32;
    let ok = unsafe {
        RegGetValueW(HKEY_LOCAL_MACHINE, wide(key).as_ptr(), wide(value).as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len)
    } == 0;
    if !ok {
        return "?".into();
    }
    String::from_utf16_lossy(&buf[..(len as usize / 2).saturating_sub(1)]).trim().to_string()
}

fn report(page: &Value) -> String {
    let mut out = String::new();
    let nt = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let mut memory = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..unsafe { std::mem::zeroed() } };
    unsafe { GlobalMemoryStatusEx(&mut memory) };
    let _ = writeln!(out, "Mercury Client diagnostics\n==========================\n");
    let _ = writeln!(out, "Mercury      {VERSION}");
    let _ = writeln!(out, "Windows      {} {} (build {})", reg_string(nt, "ProductName"), reg_string(nt, "DisplayVersion"), reg_string(nt, "CurrentBuild"));
    let _ = writeln!(out, "CPU          {}", reg_string(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString"));
    let _ = writeln!(out, "Memory       {} MB total, {} MB free", memory.ullTotalPhys >> 20, memory.ullAvailPhys >> 20);
    let switches: Vec<String> = crate::engine_switches()
        .into_iter()
        .map(|(n, v)| v.map_or(format!("--{n}"), |v| format!("--{n}={v}")))
        .collect();
    let _ = writeln!(out, "Switches     {}\n", switches.join(" "));
    let _ = writeln!(out, "Page\n----\n{}\n", serde_json::to_string_pretty(page).unwrap_or_default());
    let _ = writeln!(out, "Mercury settings\n----------------\n{}\n", serde_json::to_string_pretty(&settings::all()).unwrap_or_default());
    let log_tail = log::file()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .map(|text| text.lines().rev().take(200).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n"))
        .unwrap_or_else(|| "(empty)".into());
    let _ = writeln!(out, "Log (last 200 lines)\n--------------------\n{log_tail}");
    out
}
