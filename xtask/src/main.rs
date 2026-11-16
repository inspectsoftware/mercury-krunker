//! `cargo xtask bundle [--release]`: builds the page script (frontend/) and mercury.dll, and lays out a runnable
//! app in target/bundle.

use std::{env, fs, path::Path, process::Command, process::exit};

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

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("bundle") {
        eprintln!("usage: cargo xtask bundle [--release]");
        exit(2);
    }
    let release = args.iter().any(|a| a == "--release");

    if !Path::new("frontend/node_modules").exists() {
        run("frontend", "npm install");
    }
    run("frontend", "npm run build");

    let out = Path::new("target/bundle");
    let exe = cef::build_util::win::build_bundle(out, "mercury", release).unwrap_or_else(|e| fail(&format!("bundle failed: {e}")));
    fs::copy("target/frontend.js", out.join("frontend.js")).unwrap_or_else(|e| fail(&format!("frontend.js: {e}")));
    println!("Run {}", exe.display());
}
