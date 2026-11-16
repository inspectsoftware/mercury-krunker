// Rebindable hotkeys. A binding is a string like "F6" or "Ctrl+Alt+1"; each hotkey is a setting of type "key".

import * as settings from "./settings.js";

const hotkeys = [];

/** "Ctrl+Alt+1" for a keydown event; "" for a bare modifier. */
export function comboOf(event) {
  if (["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(event.code)) return "";
  const key = event.code.replace(/^Key/, "").replace(/^Digit/, "");
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+");
}

/**
 * Registers a hotkey setting `id` (default binding `key`) that runs `handler`.
 * `when`: "any" (default), "menu" (not while the game has the mouse) or "game".
 */
export function hotkey({ id, label, key, handler, when = "any", category, desc }) {
  settings.define({ id, label, type: "key", default: key, category, desc });
  onKey(id, handler, when);
}

/** Runs `handler` for a key setting a module declares in its own settings (type "key"), so it sits with the module. */
export function onKey(id, handler, when = "any") {
  hotkeys.push({ id, handler, when });
}

function typing(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

window.addEventListener(
  "keydown",
  (event) => {
    const combo = comboOf(event);
    if (!combo || event.repeat) return;
    const inGame = !!document.pointerLockElement;
    for (const hk of hotkeys) {
      if (settings.get(hk.id) !== combo) continue;
      if ((hk.when === "menu" && inGame) || (hk.when === "game" && !inGame)) continue;
      // While typing (chat, search), only F-keys and Ctrl/Alt combos count; the rest is text.
      if (typing(event.target) && !/^F\d+$/.test(combo) && !/(Ctrl|Alt)\+/.test(combo)) continue;
      event.preventDefault();
      event.stopImmediatePropagation();
      hk.handler(event);
      return;
    }
  },
  true,
);
