# Mercury for Krunker: plan

Goal: the lowest-latency, steadiest Krunker client for competitive play, streaming and pubs. Windows first.

## Rules

- **Legit only.** Nothing that reads game state for an advantage or plays for the player: no ESP, aim help,
  triggerbots, macros, bots, or routing through a VPN or proxy. FRVR's punishment table bans cheating, botting,
  VPN/proxy use and account sharing permanently.
- **Never touch Krunker's game code.** It ships encrypted. Work at the engine, network-request and DOM levels.
- **No speed claim without a number** from `bench/`, measured on the same machine against Crankshaft 2.x and KCC.

## Why this stack

Research summary (2026-11-16):

- Krunker is JavaScript on WebGL. An Emscripten loader (`/pkg/loader-<build>.mjs` plus a `.wasm` with Crypto++
  and Brotli) decrypts the game and runs it with `new Function`. Every frame is V8, then Chromium's compositor,
  then ANGLE.
- **The aim freeze** is [Chromium issue 415071737](https://issues.chromium.org/issues/415071737). With
  `--disable-frame-rate-limit` and the mouse held down while moving, Blink's main-thread scheduler starves the
  WebSocket tasks that carry game state:
  - input runs at the highest priority;
  - the compositor is raised to highest during `kMainThreadCustomInputHandling`;
  - `BackToBackBeginFrameSource` keeps posting zero-delay frames.

  This regressed in Chromium 84 and can only be fixed inside Chromium. bigjakk's Electron-Websocket-Fix reports
  p99 message delay falling from 97 ms to 34 ms (max 308 ms to 38 ms) with the priorities capped.
- So: our own Chromium build, through CEF, behind a thin Rust host. Why not the alternatives:
  - **WebView2 / Tauri** can't carry the patch.
  - **Electron** runs its main-process JavaScript on the browser UI thread, the thread that forwards mouse input.
  - **A native rewrite** would have to defeat the loader and imitate the protocol, which looks like botting.

## Architecture

- `mercury.exe` is CEF's sandbox `bootstrap.exe`. For every process (browser, renderer, GPU, utility) it loads
  `mercury.dll` (this crate) and calls `RunWinMain`.
- **Browser process:** a Views window in Chrome runtime style, with the profile in `%LOCALAPPDATA%\Mercury\profile`.
  The switch set lives in `App::on_before_command_line_processing`.
- **Renderer:** `on_context_created` evaluates `src/inject.js` before the page's own scripts run.
- **IO thread (M3):** a resource request handler for the blocklist and the resource swapper. It runs off the UI
  thread, so it never delays input.
- **Engine:** stock CEF binaries for M0–M1, our patched CEF build from M2 on. Pinned to the `cef` crate version
  (`156.6.0+156.0.30`) so the API hash matches. `CEF_PATH` (`.cargo/config.toml`) picks the distribution.

## Milestones

### M0: shell (in progress)

- Opens krunker.io with the sandbox on.
- Login persists across restarts.
- Uncapped switch set (vsync off, no background throttling, high-performance GPU).
- Raw mouse input via `inject.js`.
- Popups open in their own windows.

**Done when** a full match plays and the login survives a restart. Also test Google, Discord and Krunker logins
in the popup.

Status (2026-11-16):

- **Verified over CDP:** krunker.io loads in the sandboxed shell and joins a lobby. WebGL runs on the RTX 4060
  (ANGLE D3D11). The menu runs at 384 FPS on a 144 Hz panel. The raw-input override is in place, and closing the
  window shuts down every process.
- **Not yet tested:** logins and a full match.
- **Noted for M3:** the menu loads 19 ad/social iframes (doubleclick, googlesyndication, creativecdn, adform,
  Twitter), each in its own renderer process.

### M1: measure (`bench/`)

1. **Held-click WebSocket delay.** A local WebSocket server sends timestamps at 128 Hz to a test page that renders
   WebGL uncapped. CDP drives held-click mouse movement. Report p50, p99, max, and the share of messages over 50 ms.
2. **Frame times** with PresentMon.
3. **Click-to-photon**, manually: a photodiode or a Reflex analyzer. Write down the protocol.

Baselines: stock CEF uncapped, stock CEF with vsync, Crankshaft 2.x, KCC.

**Done when** the numbers are committed in `bench/results/`.

### M2: patched engine (`patches/`)

Build CEF 156 from source with:

1. **Scheduler:** cap input and compositor priority at normal. Write our own patch: Electron-Websocket-Fix shows no
   license, and KCC is GPL-3.0.
2. **Pacing:** keep draw throttling under `--disable-frame-rate-limit`, allow at most one pending frame, and add an
   exact frame cap (deadline sleep, then spin).

This needs a build box. This laptop (16 GB RAM, 114 GB free) is too small: plan a VM with 32+ vCPUs, 64 GB RAM and a
250 GB SSD, or a self-hosted runner. The output is a CEF binary distribution zip in a private release, and
`CEF_PATH` points at it.

**Done when** held-click p99 is at or below KCC's and the max stays under 50 ms.

### M3: input and display path

Each change lands only with a bench win.

- **Raw input:** make `unadjustedMovement` the pointer-lock default inside Chromium and drop the JS override, which
  the page can see.
- **Present path:** DComp swap chain with `ALLOW_TEARING`, a frame-latency waitable, `SetMaximumFrameLatency(1)`,
  and MMCSS "Games" on the GPU main thread.
- **Process tuning:** renderer and GPU priority, opt-out of power throttling (EcoQoS), timer resolution.
- **ANGLE backend switch:** `d3d11` by default; benchmark `d3d11on12`, `vulkan` and `gl` per GPU.
- **Blocklist:** ads, trackers and third-party scripts (krunker.io loads gtag, Twitter widgets, Google
  `platform.js` and `web3@latest` from unpkg). Measure the main-thread time saved and check what each blocked
  script breaks.

**Done when** PresentMon latency and click-to-photon beat Crankshaft 2.x and KCC.

### M4: streaming

- **Capture:** while a reader is attached, the GPU process copies the back buffer into a named NT-handle shared
  texture. An OBS source plugin reads it, with no CPU readback.
- **Streamer mode:** hide names, lobby links and chat, in CSS.
- **Keystrokes overlay.**
- **Audio:** OBS Application Audio Capture (no code), or process loopback as in Glassview.

**Done when** OBS records 1080p60 from the shared texture while the game runs uncapped, with the frame-time cost
measured.

### M5: pubs

- **Matchmaker:** filters for region, mode, map, player count and time left; lobby scan; auto-join with a capacity
  check; requeue hotkey. Poll gently so it never looks like botting.
- **Ping:** numeric ping display, and the region picked by measured ping.

### M6: ship

- **In-page settings:** a Mercury settings tab, a resource swapper folder, and a userscripts folder that is off by
  default and limited to cosmetic scripts.
- **Release:** Inno Setup installer, code signing, and auto-update from GitHub releases.
- **Upkeep:** a watch for Krunker updates that break our hooks.

## Risks

- **Upstream fix:** Chromium may fix 415071737, and every client gets the fix. Our edge then lives in pacing, the
  present path and capture.
- **CEF bumps:** each one means rebasing `patches/`. Stay on one CEF branch for months and bump for security fixes.
- **Krunker UI changes** break DOM hooks; Season 10 broke other clients' menu timers. Keep hooks few, CSS first.
- **Anti-tamper:** the loader reads mouse movement, and JS overrides are visible to it. Prefer engine-level changes.
- **Google sign-in** may refuse embedded browsers. Test it in M0.
- **Build cost:** each Chromium build means hardware and hours.

## Open decisions (owner)

- The M2 build box: a cloud VM or a self-hosted runner.
- The product name. Keep "Krunker" out of it.
- A code-signing certificate.
