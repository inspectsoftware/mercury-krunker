//! Repo tasks:
//! - `cargo xtask bundle [--release]`: builds the page script (frontend/) and MercuryClient.dll, and lays out a runnable
//!   app in target/bundle.
//! - `cargo xtask installer`: a release bundle, then the Inno Setup installer in target/installer.

mod icon;

use std::{env, fs, path::Path, path::PathBuf, process::Command, process::exit};

const EXE: &str = "MercuryClient.exe";

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    exit(1);
}

/// Runs a command through cmd.exe (npm is a .cmd script) in `dir`.
fn run(dir: &str, command: &str) {
    let ok = Command::new("cmd").args(["/c", command]).current_dir(dir).status().is_ok_and(|s| s.success());
    if !ok {
        fail(&format!("`{command}` failed in {dir}"));
    }
}

fn bundle(release: bool) {
    if !Path::new("frontend/node_modules").exists() {
        run("frontend", "npm install");
    }
    run("frontend", "npm run build");

    let out = Path::new("target/bundle");
    cef::build_util::win::build_bundle(out, "mercury", release).unwrap_or_else(|e| fail(&format!("bundle failed: {e}")));
    // Ship as MercuryClient.exe: NVIDIA's driver database already gives a bare "mercury.exe" another game's profile.
    // The bootstrap exe loads the DLL named like itself, so both move together (the PDB keeps the name the DLL knows).
    for (from, to) in [("mercury.exe", EXE), ("mercury.dll", "MercuryClient.dll"), ("mercury.exe.manifest", "MercuryClient.exe.manifest")] {
        fs::rename(out.join(from), out.join(to)).unwrap_or_else(|e| fail(&format!("rename {from}: {e}")));
    }
    let exe = out.join(EXE);
    fs::copy("target/frontend.js", out.join("frontend.js")).unwrap_or_else(|e| fail(&format!("frontend.js: {e}")));
    icon::set(&exe, Path::new("assets/brand/mercury.ico")).unwrap_or_else(|e| fail(&format!("icon: {e}")));
    println!("Run {}", exe.display());
}

/// The version in the root Cargo.toml's [package].
fn package_version() -> String {
    let manifest = fs::read_to_string("Cargo.toml").unwrap_or_else(|e| fail(&format!("Cargo.toml: {e}")));
    manifest
        .lines()
        .find_map(|l| l.strip_prefix("version = \"")?.strip_suffix('"').map(String::from))
        .unwrap_or_else(|| fail("no version in Cargo.toml"))
}

/// ISCC.exe: $ISCC, the per-user Inno Setup install, then Program Files.
fn iscc() -> PathBuf {
    let candidates = [
        env::var_os("ISCC").map(PathBuf::from),
        env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(r"Programs\Inno Setup 6\ISCC.exe")),
        env::var_os("ProgramFiles(x86)").map(|d| PathBuf::from(d).join(r"Inno Setup 6\ISCC.exe")),
        env::var_os("ProgramFiles").map(|d| PathBuf::from(d).join(r"Inno Setup 6\ISCC.exe")),
    ];
    candidates.into_iter().flatten().find(|p| p.exists()).unwrap_or_else(|| fail("Inno Setup 6 not found (set ISCC to ISCC.exe)"))
}

fn installer() {
    bundle(true);
    let version = package_version();
    let ok = Command::new(iscc())
        .arg(format!("/DAppVersion={version}"))
        .arg("installer/mercury.iss")
        .status()
        .is_ok_and(|s| s.success());
    if !ok {
        fail("ISCC failed");
    }
    println!("Installer: target/installer/MercuryClient-Setup-{version}.exe");
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("bundle") => bundle(args.iter().any(|a| a == "--release")),
        Some("installer") => installer(),
        _ => {
            eprintln!("usage: cargo xtask bundle [--release] | cargo xtask installer");
            exit(2);
        }
    }
}
