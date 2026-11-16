# Mercury Client: a map for agents

A Krunker client: stock CEF 156 behind a Rust host, plus a page script for everything in the game's page. The plan
and the reasons are in [PLAN.md](PLAN.md).

## Rules that bite

- **Clean-room.** Kute, KCC, Crankshaft, Glorp, idkr and the other clients are GPL. Read their READMEs for ideas;
  never copy their code, CSS or assets. MIT packages (krapio) are fine as dependencies. New ideas from a project go
  into README → Credits.
- **Legit only.** Nothing may read hidden game state for an advantage or play for the player (no ESP, aim help,
  macros, bots, VPN or proxy routing). Never drive real gameplay over CDP on live servers.
- **Never touch Krunker's game code** (it ships encrypted). Work with the DOM, Krunker's public globals
  (`showWindow`, `playTick`, `getGameActivity`...), its localStorage and its HTTP APIs.
- **Never accept Krunker's privacy consent dialog**, or anything else on the player's behalf, while testing.
- **Keep test runs away from real player data:** set `MERCURY_DATA_DIR` to a scratch folder (see Run below).
- **No Chromium build.** Stock CEF only; the `cef` crate stays pinned to `=156.6.0`.

## Layout

| Path | What |
|---|---|
| `src/lib.rs` | `RunWinMain` (every process), the engine switches from settings, `MercuryApp` |
| `src/browser.rs` | browser process: window, popups, page script handed to renderers, restart, safe mode |
| `src/renderer.rs` | renderer: evaluates the page script in krunker.io's main frame before Krunker's scripts |
| `src/bridge.rs` | `cefQuery` router: page → host commands. Secret-checked, main frame only. `route()` sends `area.*` to `src/<area>.rs` |
| `src/files.rs` | `files.*`: read/write in `<data>/{swap,css,scripts,sounds,images}` only |
| `src/resources.rs` | IO thread: URL blocklist and resource swapper |
| `src/discord.rs`, `src/media.rs`, `src/mods.rs` | `discord.*` (Rich Presence over Discord's IPC pipe), `media.current` (WinRT media session), `mods.download` and `game_link` (krunker.io game links open in the main window, `browser.rs` on_before_popup) |
| `src/settings.rs`, `src/paths.rs` | `settings.json`, data folders (`MERCURY_DATA_DIR` overrides `%LOCALAPPDATA%\Mercury`) |
| `frontend/src/core/` | `host.js` (bridge `call`), `settings.js`, `modules.js` (registry), `hotkeys.js`, `ui.js` (settings window), `dom.js` (`h`, `css`, `waitFor`, `toast`) |
| `frontend/src/modules/` | one file per feature module, listed in `modules/index.js` |
| `frontend/src/lib/` | helpers modules share: `panel.js` (manager window, file drops), `editor.js` + `highlight.js` (code editor), `style.js` (`lateCss`, `liveCss`: styles after Krunker's), snapping, HUD layout, swap paths |
| `frontend/test/` | `node --test` unit tests for the pure helpers in `lib/` |
| `tools/` | dev helpers: `cdp.mjs` (eval in the page), `drive.mjs` (keys/clicks/screenshot) |

## Adding a feature

- **Page feature:** a module file in `frontend/src/modules/` exporting
  `{id, name, desc, category, perf?, defaultOn?, live?, settings: [...], early?(), init?()}`.
  - Register it in `modules/index.js`.
  - Settings become `<id>.<key>`. Types: `bool`, `number` (min/max/step), `select` (options), `text`, `list`,
    `color`, `key` (use `hotkey()`, or `onHotkey()` for a module's own key setting), `action` (button + `run`),
    `hidden` (stored, never shown: JSON state such as the HUD layout).
  - CSS-only modules: `liveCss(mod, order, text)` from `lib/style.js` switches them on and off without a reload
    (declare `live: true`).
  - `perf: true` only for modules that help performance (they survive "Performance only").
  - Categories: General, Engine, Performance, Input, HUD, Look, Chat, Social, Matchmaking, Ranked, Accounts,
    Market, Streaming, Userscripts.
- **Host command:** put it in `src/<area>.rs` with `pub fn command(cmd, request) -> Result<Value, String>`, then add
  one arm to `bridge::route`. Commands run on a worker thread. Only window and shell commands belong on the UI
  thread (`on_query_str`).
- **Validate everything that comes from the page** at the host (paths, URLs, names).
- **Krunker DOM selectors break on updates.** Use stable ids (`#uiBase`, `#menuHolder`, `#chatList`...), wait with
  `waitFor`, and let a module fail alone. The registry catches its errors.

## Build, run, test

From a VS 2022 developer environment:

```powershell
cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul && cargo xtask bundle'
cargo clippy -p mercury --all-targets -- -D warnings    # must pass
cargo test -p mercury                                   # Rust unit tests
npm --prefix frontend test                              # page-script unit tests (node --test), if any
```

- **Page-script-only changes:** `npm --prefix frontend run build`, copy `target/frontend.js` to
  `target/bundle/frontend.js`, then restart the client. No Rust rebuild needed.
- **Run a test instance:** set `MERCURY_DATA_DIR` to a scratch folder and pick your own CDP port. Two instances
  can't share a data dir.

  ```powershell
  $env:MERCURY_DATA_DIR = "<scratch>\data"; Start-Process target\bundle\mercury.exe -ArgumentList '--remote-debugging-port=9301','--remote-allow-origins=*' -WorkingDirectory target\bundle
  node tools/cdp.mjs 9301 "document.title"
  node tools/drive.mjs 9301 shot.png key:F8 wait:400 "eval:document.querySelectorAll('.mc-row').length"
  ```

- **Close the instance when done:** `CloseMainWindow()` on the browser process, the one without `--type=` in its
  command line. An open CDP port lets any local program drive the session.
- **Worktrees:** point `CEF_PATH` at the main checkout's `.cef` folder to skip a 900 MB download, for example
  `$env:CEF_PATH = "C:\Users\iso\Desktop\mercury-krunker\.cef"`.
