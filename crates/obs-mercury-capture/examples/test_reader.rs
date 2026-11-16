//! Checks Mercury's capture producer without OBS: attaches like the OBS source does, opens the shared texture on the
//! same GPU through D3D11, reads one frame back, counts frames for 3 s, then stops the heartbeat and checks the GPU
//! process lets the texture go.
//!
//!     cargo run -p obs-mercury-capture --example test_reader -- [browser pid|any] [out.bmp] [hold seconds]
//!
//! With `hold`, it stays attached that long first, printing frames per second and reopening the texture whenever the
//! GPU process recreates it (resize, fullscreen, a new swap chain), as the OBS source does.

use obs_mercury_capture::shared::Mercury;
use std::{
    sync::atomic::Ordering::Relaxed,
    thread::sleep,
    time::{Duration, Instant},
};
use windows::{
    core::Interface,
    Win32::{
        Foundation::{CloseHandle, HANDLE, LUID},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_UNKNOWN,
            Direct3D11::*,
            Dxgi::{Common::*, *},
        },
    },
};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mercury = match args.first().and_then(|p| p.parse().ok()) {
        Some(pid) => Mercury::open(pid),
        None => Mercury::find(),
    }
    .expect("no Mercury Client with a present block is running");
    let out = args.get(1).cloned().unwrap_or_else(|| "capture.bmp".into());
    let hold = args.get(2).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    println!("Mercury browser pid {}", mercury.browser_pid);
    if hold > 0 {
        hold_attached(&mercury, Duration::from_secs(hold));
    }

    // Attach: heartbeat until the GPU process publishes a texture and copies frames into it.
    let start = Instant::now();
    let c = mercury.capture();
    while c.handle.load(Relaxed) == 0 || c.frames.load(Relaxed) == 0 {
        mercury.heartbeat();
        assert!(start.elapsed() < Duration::from_secs(10), "no texture after 10 s (is the present hook active?)");
        sleep(Duration::from_millis(50));
    }
    println!("texture after {:?}: {}x{} format {} generation {}", start.elapsed(), c.width.load(Relaxed), c.height.load(Relaxed), c.format.load(Relaxed), mercury.generation());

    let handle = mercury.duplicate_texture_handle().expect("DuplicateHandle from the GPU process failed");
    let luid = c.adapter_luid.load(Relaxed);
    let pixels = read_back(HANDLE(handle), LUID { LowPart: luid as u32, HighPart: (luid >> 32) as i32 });
    unsafe { CloseHandle(HANDLE(handle)).ok() };
    let (w, h, bgra) = pixels.expect("could not read the texture");
    let mean = bgra.chunks(4).map(|p| (p[0] as u64 + p[1] as u64 + p[2] as u64) / 3).sum::<u64>() as f64 / (w * h) as f64;
    write_bmp(&out, w, h, &bgra);
    println!("frame read back: {w}x{h}, mean brightness {mean:.1}/255 -> {out}");

    // Frames signalled while attached.
    let (f0, t0) = (c.frames.load(Relaxed), Instant::now());
    while t0.elapsed() < Duration::from_secs(3) {
        mercury.heartbeat();
        sleep(Duration::from_millis(100));
    }
    let rate = (c.frames.load(Relaxed) - f0) as f64 / t0.elapsed().as_secs_f64();
    println!("frames copied while attached: {rate:.0}/s");

    // Detach: the GPU process must drop the texture about 2 s after the last heartbeat.
    let t1 = Instant::now();
    while c.handle.load(Relaxed) != 0 && t1.elapsed() < Duration::from_secs(6) {
        sleep(Duration::from_millis(100));
    }
    let f1 = c.frames.load(Relaxed);
    sleep(Duration::from_millis(500));
    println!(
        "after detach: texture released after {:?}: {}, frames still copied: {}",
        t1.elapsed(),
        c.handle.load(Relaxed) == 0,
        c.frames.load(Relaxed) - f1
    );
}

/// Stays attached, once a second: frames copied, and a fresh read of the texture whenever its generation changes.
fn hold_attached(mercury: &Mercury, time: Duration) {
    let c = mercury.capture();
    let (start, mut generation, mut frames, mut tick) = (Instant::now(), 0, c.frames.load(Relaxed), Instant::now());
    while start.elapsed() < time {
        mercury.heartbeat();
        sleep(Duration::from_millis(50));
        if tick.elapsed() < Duration::from_secs(1) {
            continue;
        }
        let now = c.frames.load(Relaxed);
        let g = mercury.generation();
        let mut line = format!("t={:>3}s frames/s={:>4} gen={g}", start.elapsed().as_secs(), now - frames);
        if g != generation && c.handle.load(Relaxed) != 0 {
            generation = g;
            let read = mercury.duplicate_texture_handle().and_then(|h| {
                let luid = c.adapter_luid.load(Relaxed);
                let pixels = read_back(HANDLE(h), LUID { LowPart: luid as u32, HighPart: (luid >> 32) as i32 });
                unsafe { CloseHandle(HANDLE(h)).ok() };
                pixels
            });
            line += &match read {
                Some((w, h, bgra)) => {
                    let mean = bgra.chunks(4).map(|p| (p[0] as u64 + p[1] as u64 + p[2] as u64) / 3).sum::<u64>() as f64 / (w * h) as f64;
                    format!(" reopened {w}x{h} mean {mean:.1}")
                }
                None => " reopen FAILED".into(),
            };
        }
        println!("{line}");
        (frames, tick) = (now, Instant::now());
    }
}

/// Opens the shared texture on the adapter it lives on and copies it to the CPU.
fn read_back(handle: HANDLE, luid: LUID) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let factory: IDXGIFactory4 = CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS(0)).ok()?;
        let adapter: IDXGIAdapter = factory.EnumAdapterByLuid(luid).ok()?;
        let mut device = None;
        let mut context = None;
        D3D11CreateDevice(&adapter, D3D_DRIVER_TYPE_UNKNOWN, Default::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut context)).ok()?;
        let (device, context) = (device?.cast::<ID3D11Device1>().ok()?, context?);
        let texture: ID3D11Texture2D = device.OpenSharedResource1(handle).ok()?;
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        texture.GetDesc(&mut desc);
        let staging_desc = D3D11_TEXTURE2D_DESC {
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
            ..desc
        };
        let mut staging = None;
        device.CreateTexture2D(&staging_desc, None, Some(&mut staging)).ok()?;
        let staging = staging?;
        context.CopyResource(&staging, &texture);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).ok()?;
        assert_eq!(desc.Format, DXGI_FORMAT_B8G8R8A8_UNORM, "this reader only handles BGRA8");
        let mut bgra = Vec::with_capacity((desc.Width * desc.Height * 4) as usize);
        for y in 0..desc.Height {
            let row = std::slice::from_raw_parts((mapped.pData as *const u8).add((y * mapped.RowPitch) as usize), (desc.Width * 4) as usize);
            bgra.extend_from_slice(row);
        }
        context.Unmap(&staging, 0);
        Some((desc.Width, desc.Height, bgra))
    }
}

fn write_bmp(path: &str, w: u32, h: u32, bgra: &[u8]) {
    let size = 54 + bgra.len() as u32;
    let mut file = Vec::with_capacity(size as usize);
    file.extend_from_slice(b"BM");
    for v in [size, 0, 54, 40, w, (-(h as i32)) as u32] {
        file.extend_from_slice(&v.to_le_bytes());
    }
    file.extend_from_slice(&1u16.to_le_bytes());
    file.extend_from_slice(&32u16.to_le_bytes());
    for v in [0u32, bgra.len() as u32, 2835, 2835, 0, 0] {
        file.extend_from_slice(&v.to_le_bytes());
    }
    file.extend_from_slice(bgra);
    std::fs::write(path, file).expect("write bmp");
}
