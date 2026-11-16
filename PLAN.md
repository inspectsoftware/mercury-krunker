# Mercury Client: plan

Goal: the lowest-latency, steadiest Krunker client, with everything a competitive player, a streamer and a pubstomper
wants. Windows first.

## Rules

- **Legit only.** Nothing that reads hidden game state for an advantage or plays for the player: no ESP, aim help,
  triggerbots, macros, bots, or routing through a VPN or proxy. FRVR permanently bans cheating, botting, VPN/proxy
  use and account sharing.
- **Never touch Krunker's game code.** It ships encrypted. Work at the engine, network-request and DOM levels.
- **Our own code, ideas only.** Kute, KCC, Crankshaft, Glorp and the other clients are GPL: we take ideas, never
  code or binaries (README → Credits). MIT libraries such as krapio may be used as dependencies, with their
  license notice.
- **No Chromium build.** Stock CEF only. A feature that needs a Chromium patch gets a no-build alternative or is
  listed under "Not doing".
- **Measure.** No speed claim without a number from the bench.

## Architecture

- **`mercury.exe`** is CEF's sandbox `bootstrap.exe`. For every process it loads `mercury.dll` (Rust, `src/`) and
  calls `RunWinMain`.
- **Browser process** (`browser.rs`):
  - a Views window, the profile in `%LOCALAPPDATA%\Mercury` (`MERCURY_DATA_DIR` overrides it);
  - the engine switches (`lib.rs`), restart, `--safe-mode`, single instance.
- **Page script** (`frontend/`, esbuild → `frontend.js` next to the exe):
  - the browser hands it to renderers through `extra_info`;
  - the renderer evaluates it in krunker.io's main frame before Krunker's scripts (`renderer.rs`);
  - features are modules in `frontend/src/modules/`;
  - settings are one flat map, kept in localStorage and in `settings.json`.
- **Bridge** (`bridge.rs`): the page calls the host with `cefQuery`. Calls are only served from krunker.io's main
  frame and only with the per-launch secret, which only the bundle holds. Disk and network work runs off the UI
  thread.
- **GPU process** (M2): the present hook is installed from `RunWinMain` before Chromium starts, so nothing is
  injected.

## Milestones

### M0: shell ✅

- Sandboxed CEF 156 window on krunker.io; persistent profile; maximized; popups; clean shutdown.

### M1: foundation ✅

- Page bundle at document start, and the secured page↔host bridge.
- Settings store and the Mercury settings window (F8 or the header button):
  - search;
  - every setting togglable;
  - restart tags.
- Rebindable hotkeys.
- **Performance only:** one switch turns off every cosmetic module and hides its settings; switching back restores
  the player's choices.
- Settings export and import; restart; `--safe-mode`; single instance; version tag; F11 fullscreen.
- **Aim freeze:** Krunker's own fix (`kro_setngss_aimFreezeFix`) is on by default.
- Raw input (`unadjustedMovement`).
- **Engine settings:** uncapped FPS, graphics backend (ANGLE: D3D11, D3D11on12, OpenGL, Vulkan), color profile,
  custom Chromium flags.

### M2: engine and performance

- **URL blocklist:** about 50 entries (ads, trackers, third-party scripts), editable. It runs on the IO thread, and
  resource swaps win over it.
- **Present path:** Chromium's own options first: uncapped already means tearing and interval-0 presents; the waitable
  swap chain (DXGIWaitableSwapChain) is an engine setting. A **DXGI present hook** in the GPU process adds only what
  Chromium can't do, and never changes Chromium's swap chains:
  - frame limiter (exact present pacing), plus a page-side cap on the game's frames, since uncapped Chromium floods a
    GPU-bound PC;
  - present FPS counter in the page;
  - the OBS shared texture (M9).
- **Hybrid laptops:** detected. The fast GPU is set once in Windows' graphics settings, and the hook stays off on
  laptops where the display is wired to the integrated GPU.
- **Laptop Power Boost:** Windows' Best performance mode while Mercury runs on AC power, then restored.
- **NVIDIA driver profile** for mercury.exe (driver frame caps lifted).
- **HighQoS** (no EcoQoS) for the game's renderer and GPU processes.
- **Fix audio stutters**, without a patch:
  - keep Krunker's Howler context from auto-suspending, which stops automation events from piling up;
  - throttle panner position writes.
- **CPU throttler**, as a last resort for GPU-bound PCs.
- **Game FPS limit** fallback when the hook is off.
- **Performance tweaks:** a curated flag set, a Krunker game settings preset, system checks (power plan, Game
  Mode, HAGS).

### M3: auto-detect, diagnostics, safety

- A bench scene (WebGL), plus the held-click WebSocket delay test from the research.
- **Auto-Detect Best Settings:** benchmarks the PC, picks engine and game settings, and can always be reverted.
- **Diagnostics report:** system, GPU, settings, frame stats and logs in one file.
- **Safe mode and crash finder:** bisects modules and flags to find the one that breaks the client.

### M4: input and HUD

- **Keystrokes:** bound movement keys and mouse, lit while pressed, plus a ring showing mouse direction.
- **HUD editor:** drag, resize and hide every in-game HUD element and the menu timer, with snapping.
- Menu timer.

### M5: look

- **Resource swapper with a manager:**
  - shows which game files the swaps replace;
  - drag and drop, and a built-in editor;
  - CSS swaps apply instantly.
- **CSS manager:** several CSS files (write, paste, import), switch between them, syntax-highlighted editor with
  live preview, always on top of Krunker's styles.
- **Mercury CSS:** an optional look for the whole client (menus, settings, windows, popups, social, HUD).
- **Classic menu:** the Season 9 layout with every Season 10 button.
- **Cleaner menu:** hides the store ad, live streams, featured maps, Popular Now and other promos.
- **Motion blur:** a slight blur on the game canvas while turning; the HUD stays sharp.
- **Custom sky:** a preset, your own gradient or image. Only if it works through a swap or CSS, without touching
  game code.
- **Mercury icons:** counter, ammo, hitmarker, reticle and scope, each optional.

### M6: chat and social

- Better chat.
- **Chat logs:** the last 2000 lines kept across lobbies; filter, search, copy (F1).
- Clan colors (a local list).
- **Match end message per account:** an alt never sends the main's message.
- **Discord Rich Presence**, from Krunker's own `getGameActivity`.
- **Now-playing overlay** (Spotify and others) through Windows' media session.
- **Mods:**
  - a download button on every mod;
  - mod, lobby and invite links open in the game window.
- Battle pass claim-all.
- **Rank progress** and **nuke counter** (career total, optional goal), through the APIs.
- **Hardpoint enemy counter:** only from what the HUD already shows; dropped if it would need hidden state.

### M7: matchmaking and ranked

- **Matchmaker:** F6 joins the lowest-ping lobby that fits the filters (region, mode, map, players, time left).
- **Real ping:**
  - to every region;
  - in Find Game, regions sorted fastest first.
- **External ranked queue:** queue without the game open; a match-found sound that can be swapped and has its own
  volume.
- **Ranked match alert:** the window comes to the front or flashes when a match is found while tabbed out.
- Ranked rating (ELO/MMR) display.

### M8: accounts and market

- **Encrypted account manager:** Windows DPAPI; drag to order; Ctrl+Alt+1/2/3 log in the first three
  (rebindable).
- **Market:** overview, discovery with budget and activity filters, a local watchlist with price targets,
  inventory coverage, side-by-side trade comparisons (krapio, local data only).

### M9: streaming

- **OBS capture plugin:** a shared texture from the GPU process, plus game-only audio.
- Streamer mode (hide names, links, chat).

### M10: userscripts

- Crankshaft and idkr formats, with an in-client manager. Off by default; cosmetic only. Example scripts.

### M11: ship

- Auto-updater with a download progress window and changelogs.
- Inno Setup installer; crash log.

### Not doing (for now)

- **Chromium patches** (no Chromium build, by decision). Each item, and what replaces it:
  - input priority: Krunker's aim freeze fix replaces it;
  - compositor frame pacing and FPS limiter: the present hook limiter replaces them;
  - Web Audio panner and AudioParam patches: the JS audio fix replaces them;
  - canvas buffer cache: nothing replaces it;
  - ThinLTO: nothing replaces it.
- **Medal.tv** official support: a partnership, not code.
- **Online features that need a server:** a Mercury badge, shared clan colors.
- **Code signing:** later.
- **Linux:** later.

## Risks

- **Krunker updates** break DOM hooks (Season 10 broke other clients' menu timers). Keep hooks few, CSS first, and
  let modules fail alone.
- **Unofficial APIs** (game and token tiers) can change any time.
- **The aim freeze** depends on Krunker keeping its own fix setting.
- **Anti-tamper:** the loader reads mouse movement. Keep page overrides minimal.
