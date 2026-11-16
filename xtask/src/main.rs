//! `cargo xtask bundle [--release]`: builds mercury.dll and lays out a runnable app in target/bundle.

use std::{env, path::Path, process::exit};

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("bundle") {
        eprintln!("usage: cargo xtask bundle [--release]");
        exit(2);
    }
    let release = args.iter().any(|a| a == "--release");
    match cef::build_util::win::build_bundle(Path::new("target/bundle"), "mercury", release) {
        Ok(exe) => println!("Run {}", exe.display()),
        Err(e) => {
            eprintln!("bundle failed: {e}");
            exit(1);
        }
    }
}
