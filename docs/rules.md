# Mercury and Krunker's rules

Checked 2026-11-16 against [Krunker's Terms of Service](https://frvr.com/legal/krunker) and FRVR's
[Krunker punishment table](https://frvr.freshdesk.com/support/solutions/articles/80001157223-krunker-punishment-table).
Re-check when either changes.

## What the rules say

- **No rule on third-party clients.** No published rule allows or bans them. Crankshaft, KCC, Kute, Glorp and
  others have been public for years, and Krunker's own page has hooks meant for clients (`closeClient`,
  `clientExitPopup`).
- **Banned (permanent):**
  - "Hacking or Cheating" and "Botting";
  - "Using VPNs or Proxies";
  - "Account Sharing";
  - "Distributing Harmful Software".
- **The Terms also forbid:**
  - developing or sharing "auto" and "macro" software and other "cheat utility" programs;
  - exploiting or spreading bugs that give "an unintended advantage";
  - modifying, framing or scraping the Service's materials beyond "viewing and using" the Services.
- **Ad blocking:** FRVR detects ad blockers through Admiral, to "estimate the potential revenue impact of
  ad-blocking". No punishment is tied to it.

## Mercury's features against them

| Feature | What it touches | Risk | Why |
|---|---|---|---|
| Engine switches, ANGLE backend, present hook (GPU process) | Chromium and how frames reach the screen | Low | Never sees game state. Presentation only. |
| URL blocklist | Ads, trackers, widgets | Low | No rule against it. Admiral may count it, and Krunker may show ad-block prompts. |
| Raw input (`unadjustedMovement`) | Pointer lock options | Low | The same mouse data, minus Windows acceleration. Page-visible override. |
| Krunker's aim freeze fix on by default | Krunker's own setting | None | It's Krunker's setting. |
| Mercury tab in Krunker's settings | Krunker's settings window object | Low | UI only. |
| Resource swapper, CSS manager, looks, icons, motion blur | Local copies of assets and styles | Low | Cosmetic and local only. Strictly it's a modification of Service materials; tolerated for years across clients. Game code can never be swapped (`resources.rs`). |
| HUD editor, keystrokes, menu timer | DOM the player already sees | Low | Cosmetic. |
| Matchmaker (F6) | Krunker's public game list, then a normal join | Low | Lobby choice, not gameplay. Polls only on demand (botting rule). |
| Battle pass claim-all | Krunker's claim buttons | Low | Account housekeeping, not gameplay. Runs once per click, never on a timer. |
| External ranked queue | Krunker's own ranked menu and queue button | Low | Presses the button a player would press, once per click. No private endpoints. |
| Account manager | Krunker's login form, local DPAPI storage | Medium | The player's own accounts, never shared. But Krunker's login sends mouse and keystroke timings plus a Cloudflare check, so a script-filled login may be scored as automated. Try Ctrl+Alt+1 on a throwaway account before relying on it. |
| Market | Krunker's read-only APIs | Low–medium | Read-only, cached, rate-limited: no bulk scraping. |
| Hardpoint enemy counter | Only what the HUD shows | Low | Dropped if it would need hidden state. |
| Userscripts | Whatever the player loads | Player's | Off by default. The manager tells players to load cosmetic scripts only. |

## Never

Anything that reads hidden game state or plays for the player (ESP, aim help, triggerbots, macros, bots), VPN or
proxy routing, account sharing, exploiting bugs, or touching Krunker's game code.
