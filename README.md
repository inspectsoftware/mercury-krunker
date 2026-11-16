# Mercury Client

A Krunker client built for competitive play, streaming and pubs: Chromium (CEF) behind a thin Rust host, with a
page script for everything that lives in the game's page. What is planned and why is in [PLAN.md](PLAN.md). How
each feature stands against Krunker's rules is in [docs/rules.md](docs/rules.md).

## Get it

- **Install:** download `MercuryClient-Setup-<version>.exe` from [Releases](../../releases/latest) and run it. It
  installs for your user only (no admin rights) and updates itself.
- **Settings:** in Krunker's own settings window, last tab "Mercury". F8 opens it from anywhere.
- **Safety:** Mercury reads no hidden game state and plays nothing for you. Use cheats, VPNs or shared accounts
  with it and FRVR bans you anyway.

## Build and run (Windows)

You need:
- Rust stable;
- Node.js;
- Visual Studio 2022 Build Tools with the C++ workload (it includes CMake and Ninja).

From a **Developer PowerShell for VS 2022**:

```powershell
cargo xtask bundle            # builds frontend/ and MercuryClient.dll; add --release for an optimized build
target\bundle\MercuryClient.exe
```

The first build downloads CEF 156 into `.cef/` and the page script's packages into `frontend/node_modules`.

- **Data:** settings, profile and swaps live in `%LOCALAPPDATA%\Mercury`. `MERCURY_DATA_DIR` points elsewhere (test
  runs, portable use).
- **Safe mode:** `MercuryClient.exe --safe-mode` starts without the page script and custom flags.

## Installer and releases

- **Installer:** `cargo xtask installer` builds a release bundle and the installer at
  `target/installer/MercuryClient-Setup-<version>.exe` (Inno Setup 6, per user, no admin rights).
- **Releasing:** raise `version` in `Cargo.toml`, commit, then push a tag `v<version>`. GitHub Actions
  (`.github/workflows/release.yml`) builds the installer and publishes the release.
- **Release notes:** `docs/releases/v<version>.md`. The release shows them, and so does the client's "what's new"
  window after an update.
- **Updates:** clients offer the newest release, check its SHA-256 and update themselves.

## OBS capture

`crates/obs-mercury-capture` is an OBS Studio 33 plugin with a **Mercury Client** video source: it shows the game as
Mercury presents it, from a texture Mercury's GPU process shares, without window or game capture. It is GPL-2.0-or-later
(it links libobs) and separate from Mercury itself: the two only share a memory block and the texture.

```powershell
cargo build -p obs-mercury-capture --release
```

Install it (OBS closed; the folder and the file must both be named `obs-mercury-capture`):

```powershell
$root = "$env:ProgramData\obs-studio\plugins\obs-mercury-capture"
New-Item -ItemType Directory -Force "$root\bin\64bit", "$root\data"
Copy-Item target\release\obs_mercury_capture.dll "$root\bin\64bit\obs-mercury-capture.dll"
```

Then in OBS: Sources → + → Mercury Client. It needs Mercury's present hook (Engine → Present hook) and OBS running on the
same GPU as the game (Windows Settings → Display → Graphics). To uninstall, delete that `obs-mercury-capture` folder.
`cargo run -p obs-mercury-capture --example test_reader` checks Mercury's side without OBS.

For the game's sound alone, add OBS's Application Audio Capture and pick the window `[MercuryClient.exe]: Mercury Client`.
Chromium plays audio from its audio service, a child of that window's process, and OBS records the window's whole
process tree.

## Credits

Mercury's code is its own. These projects gave us ideas, or are used as libraries:

- [NullDev/Kute](https://github.com/NullDev/Kute): the feature set we aim for, and the architecture idea of a Rust
  host on CEF with a present hook in the GPU process and an OBS shared-texture capture; Laptop Power Boost, the NVIDIA
  driver profile, HighQoS, the CPU throttler and the audio stutter fix as features.
- [NullDev/krapio](https://github.com/NullDev/krapio) (MIT, used as a library): the Krunker API client.
- [slavcp/glorp](https://github.com/slavcp/glorp): the DXGI present hook (vtable patching through a throwaway swap
  chain, the frame limiter, MMCSS, stats in shared memory, skipping cross-adapter laptops) and shared-texture OBS
  capture ideas.
- [NVIDIA/nvapi](https://github.com/NVIDIA/nvapi) (MIT): the NVAPI SDK headers, for the driver settings function IDs,
  structs and setting IDs in `src/nvidia.rs`.
- [obsproject/obs-studio](https://github.com/obsproject/obs-studio) (GPL-2.0): the OBS 33 headers the capture plugin's
  libobs declarations were written against (plugin crate only).
- [6ct/client-pp](https://github.com/6ct/clientpp): Chromium flags.
- [KraXen72/crankshaft](https://github.com/KraXen72/crankshaft): the menu timer and matchmaker ideas, and Krunker's
  own aim freeze fix setting.
- [idkr-client/idkr](https://github.com/idkr-client/idkr): tweaks.
- [bigjakk/Electron-Websocket-Fix](https://github.com/bigjakk/Electron-Websocket-Fix): the root-cause analysis of
  the aim freeze (Chromium issue 415071737).
- [bigjakk/Krunker-Civilian-Client](https://github.com/bigjakk/Krunker-Civilian-Client): the matchmaker, nuke
  counter, custom sky and keystrokes ideas.
- [Alx8g/wok-client](https://github.com/Alx8g/wok-client): the motion blur idea.
- PC7 Client: ideas (badges, QoL).
- Water Client: ideas (direct mod downloads).
- [krunkerresourcehub/krh-client](https://github.com/krunkerresourcehub/krh-client): ideas (quick alt login, safe
  mode).

## License

MIT, see [LICENSE](LICENSE). The exception is the Mercury name, mark and icons in `assets/brand/`: they are not
covered by the MIT license, so forks need their own.

Third-party notices ship with every build:
- Chromium's and CEF's licenses in `CREDITS.html`;
- krapio's MIT notice inside `frontend.js`.

Mercury Client is not affiliated with Krunker.io or FRVR.
