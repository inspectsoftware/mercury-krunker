# Mercury for Krunker

A Krunker client built for competitive play, streaming and pubs: a patched Chromium (through CEF) behind a thin
Rust host. Private for now. The plan and the reasons behind it are in [PLAN.md](PLAN.md).

## Build and run (Windows)

You need Rust stable and Visual Studio 2022 Build Tools with the C++ workload, which includes CMake and Ninja.
From a **Developer PowerShell for VS 2022**:

```powershell
cargo xtask bundle            # add --release for an optimized build
target\bundle\mercury.exe
```

The first build downloads CEF 156 into `.cef/`. Extra Chromium switches can go on the command line, for example
`mercury.exe --use-angle=d3d11on12`.

The profile (login, cookies, cache) lives in `%LOCALAPPDATA%\Mercury\profile`.
