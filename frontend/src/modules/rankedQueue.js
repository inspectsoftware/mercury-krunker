// External ranked queue: a small Mercury window to queue for ranked through Krunker's own ranked menu and keep an eye
// on it from the menu or while tabbed out. When Krunker's own "Match found!" box shows, it plays the match-found
// sound: the built-in chime, or a file of the player's from <data>/sounds, at its own volume.
//
// Verified without an account: the panel, the sound and the match-found signal (Krunker's
// #matchmakingStatusEl .ranked-matchmaking-status gets "show"). Not verified: Krunker's ranked menu opens only for a
// logged-in account, so the queue button inside it is found by its text, which no one has seen working yet.

import { h, toast } from "../core/dom.js";
import { call } from "../core/host.js";
import { onHotkey } from "../core/hotkeys.js";
import * as registry from "../core/modules.js";
import * as settings from "../core/settings.js";
import { clock } from "../lib/lobbies.js";
import { account } from "../lib/krunker.js";
import { isOpen, panel } from "../lib/floating.js";
import { onRankedMatch } from "../lib/ranked.js";
import { playSound } from "../lib/sound.js";

const id = "rankedQueue";
const opt = (key) => settings.get(`${id}.${key}`);
// sessionStorage: Krunker reloads the page between lobbies, the queue in its ranked system carries on.
const QUEUED = "mercury:rankedQueuedAt";
const queuedAt = () => Number(sessionStorage.getItem(QUEUED)) || 0;
let state = { found: false, note: "" };
let view = null;

const playAlert = () => playSound(opt("sound"), opt("volume") / 100).catch((e) => toast(`Match sound: ${e.message}`));

/** Krunker's queue button in its ranked menu, by its text; null if none shows up within `ms`. */
function queueButton(ms = 4000) {
  const look = () =>
    [...document.querySelectorAll("#menuWindow button, #menuWindow [onclick], .popup-container button, [class*='ranked'] button")].find(
      (el) => el.offsetParent && !el.closest(".mc-float") && /\b(queue|find match|search)\b/i.test(el.textContent) && !/leave|cancel|stop/i.test(el.textContent),
    );
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => (look() ? resolve(look()) : Date.now() > deadline ? resolve(null) : setTimeout(tick, 200));
    tick();
  });
}

async function queue() {
  if (!(await account())) {
    state.note = "Log in to a Krunker account first: ranked needs one (Mercury settings → Accounts).";
    return render();
  }
  window.openRankedMenu?.();
  const button = await queueButton();
  if (button) {
    button.click();
    sessionStorage.setItem(QUEUED, Date.now());
    state = { found: false, note: "Queued through Krunker's ranked menu." };
  } else {
    state.note = "Krunker's ranked menu is open: pick your queue there. Mercury still plays the sound when a match is found.";
  }
  render();
}

function render() {
  if (!view) return;
  const since = queuedAt();
  const line = state.found ? "Match found!" : since ? `In queue · ${clock((Date.now() - since) / 1000)}` : "Not queued";
  view.body.replaceChildren(
    h("div", { class: `mc-big${state.found ? " mc-good" : ""}` }, line),
    h("p", { style: { marginTop: "8px" } }, state.note),
    h(
      "div",
      { class: "mc-float-actions" },
      since > 0 && h("button", { class: "mc-btn", title: "Forget the queue timer (leave the queue itself in Krunker's ranked menu)", onclick: () => (sessionStorage.removeItem(QUEUED), render()) }, "Clear"),
      h("button", { class: "mc-btn", onclick: () => window.openRankedMenu?.() }, "Ranked menu"),
      h("button", { class: "mc-btn primary", onclick: queue }, "Queue"),
    ),
  );
}

function showPanel() {
  view = panel({ id: "ranked-queue", title: "Ranked queue", width: 340, onClose: () => (clearInterval(timer), (view = null)) });
  const timer = setInterval(() => queuedAt() && !state.found && render(), 1000);
  render();
}

onHotkey(`${id}.key`, () => registry.enabled(mod) && (isOpen("ranked-queue") ? null : showPanel()));

const mod = {
  id,
  name: "Ranked queue",
  desc: "Queue for ranked from a small Mercury window, and hear a sound when Krunker finds your match, even while tabbed out.",
  category: "Ranked",
  settings: [
    { key: "show", label: "Ranked queue window", type: "action", button: "Show", run: showPanel },
    { key: "key", label: "Show the ranked queue", type: "key", default: "" },
    { key: "sound", label: "Match found sound", desc: "A file in the sounds folder (mp3, ogg, wav). Empty: Mercury's chime.", type: "text", default: "", placeholder: "match.mp3" },
    { key: "volume", label: "Sound volume", type: "number", min: 0, max: 100, step: 5, default: 70 },
    { key: "test", label: "Test the sound", type: "action", button: "Play", run: playAlert },
    { key: "folder", label: "Sounds folder", type: "action", button: "Open", run: () => call("files.reveal", { dir: "sounds" }) },
  ],
  init() {
    onRankedMatch((found) => {
      if (!registry.enabled(mod)) return;
      state = { found, note: found ? "Krunker found your ranked match." : "" };
      if (found) {
        sessionStorage.removeItem(QUEUED);
        playAlert();
        toast("Ranked match found!", 6000);
      }
      render();
    });
  },
};

export default mod;
