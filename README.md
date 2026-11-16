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
cargo xtask bundle            # builds frontend/ and mercury.dll; add --release for an optimized build
target\bundle\mercury.exe
```

The first build downloads CEF 156 into `.cef/` and the page script's packages into `frontend/node_modules`.

- **Data:** settings, profile and swaps live in `%LOCALAPPDATA%\Mercury`. `MERCURY_DATA_DIR` points elsewhere (test
  runs, portable use).
- **Safe mode:** `mercury.exe --safe-mode` starts without the page script and custom flags.

## Installer and releases

- **Installer:** `cargo xtask installer` builds a release bundle and the installer at
  `target/installer/MercuryClient-Setup-<version>.exe` (Inno Setup 6, per user, no admin rights).
- **Releasing:** raise `version` in `Cargo.toml`, commit, then push a tag `v<version>`. GitHub Actions
  (`.github/workflows/release.yml`) builds the installer and publishes the release.
- **Release notes:** `docs/releases/v<version>.md`. The release shows them, and so does the client's "what's new"
  window after an update.
- **Updates:** clients offer the newest release, check its SHA-256 and update themselves.

## Credits

Mercury's code is its own. These projects gave us ideas, or are used as libraries:

- [NullDev/Kute](https://github.com/NullDev/Kute): the feature set we aim for, and the architecture idea of a Rust
  host on CEF with a present hook in the GPU process and an OBS shared-texture capture.
- [NullDev/krapio](https://github.com/NullDev/krapio) (MIT, used as a library): the Krunker API client.
- [slavcp/glorp](https://github.com/slavcp/glorp): the DXGI present hook and shared-texture OBS capture ideas.
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

Mercury Client is not affiliated with Krunker.io or FRVR.
