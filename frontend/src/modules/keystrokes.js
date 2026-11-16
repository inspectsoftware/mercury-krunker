// Keystrokes: the player's own movement binds, lit while held, the mouse buttons, and a ring showing which way the
// mouse moves while the pointer is locked. It only watches input (passive listeners); it never blocks or sends any.
// Krunker keeps binds in localStorage as keyCodes: cont_0..3 (forward, back, left, right), cont_jumpKey,
// cont_crouchKey, each with a second bind in "<key>_alt"; -1 means unbound. Move it with the HUD editor.

import { css, h, waitFor } from "../core/dom.js";
import { opt } from "../core/modules.js";

const KEYS = [
  ["w", "cont_0", 87],
  ["a", "cont_2", 65],
  ["s", "cont_1", 83],
  ["d", "cont_3", 68],
  ["crouch", "cont_crouchKey", 16],
  ["jump", "cont_jumpKey", 32],
];
const NAMES = { 8: "Bksp", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt", 20: "Caps", 32: "Space", 37: "←", 38: "↑", 39: "→", 40: "↓", 186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\", 221: "]", 222: "'" };
const keyName = (code) => NAMES[code] ?? (code >= 96 && code <= 105 ? `Num${code - 96}` : code >= 112 && code <= 123 ? `F${code - 111}` : code > 0 ? String.fromCharCode(code) : "–");

const CSS = `
#mc-keys {
  position: absolute; left: 24px; top: 46%; z-index: 3; display: grid; grid-template-columns: repeat(3, 42px); gap: 4px; pointer-events: none;
  grid-template-areas: ". w ." "a s d" "crouch jump jump" "lmb ring rmb";
}
#mc-keys > span {
  display: flex; align-items: center; justify-content: center; height: 42px; border-radius: 6px; overflow: hidden;
  font-size: 15px; color: #fff; background: rgba(13, 15, 19, 0.55); border: 1px solid rgba(255, 255, 255, 0.16);
  transition: background 0.05s, color 0.05s;
}
#mc-keys .crouch, #mc-keys .lmb, #mc-keys .rmb { font-size: 11px; }
#mc-keys > span.on { background: rgba(255, 255, 255, 0.88); color: #111; }
#mc-keys .w { grid-area: w; } #mc-keys .a { grid-area: a; } #mc-keys .s { grid-area: s; } #mc-keys .d { grid-area: d; }
#mc-keys .crouch { grid-area: crouch; } #mc-keys .jump { grid-area: jump; }
#mc-keys .lmb { grid-area: lmb; } #mc-keys .ring { grid-area: ring; } #mc-keys .rmb { grid-area: rmb; }
#mc-keys .ring { position: relative; border-radius: 50%; }
#mc-keys .ring > i { position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; margin: -4px; border-radius: 50%; background: #fff; will-change: transform; }
`;

let el = null;
const pressed = new Set();
let codes = new Map(); // keyCode → key name

function readBinds() {
  codes = new Map();
  for (const [name, storageKey, fallback] of KEYS) {
    const primary = Number(localStorage.getItem(storageKey) ?? fallback);
    const alt = Number(localStorage.getItem(`${storageKey}_alt`) ?? -1);
    for (const code of [primary, alt]) if (code > 0 && !codes.has(code)) codes.set(code, name);
    el?.querySelector(`.${name}`)?.replaceChildren(keyName(primary));
  }
}

function light(name, on) {
  if (on ? pressed.has(name) : !pressed.has(name)) return;
  on ? pressed.add(name) : pressed.delete(name);
  el?.querySelector(`.${name}`)?.classList.toggle("on", on);
}

function clear() {
  for (const name of [...pressed]) light(name, false);
}

// The mouse ring: the dot leans the way the mouse moved this frame, eased so it reads at a glance.
let ax = 0;
let ay = 0;
let px = 0;
let py = 0;
let frame = 0;
function ring() {
  frame = 0;
  const m = Math.hypot(ax, ay);
  const k = m ? (Math.min(1, m / 30) * 13) / m : 0;
  px += (ax * k - px) * 0.5;
  py += (ay * k - py) * 0.5;
  ax = ay = 0;
  const still = Math.abs(px) + Math.abs(py) < 0.3;
  if (still) px = py = 0;
  const dot = el?.querySelector(".ring > i");
  if (dot) dot.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
  if (!still) frame = requestAnimationFrame(ring);
}

const mod = {
  id: "keystrokes",
  name: "Keystrokes",
  desc: "Your movement keys and mouse buttons on screen, lit while held, with a ring showing mouse direction. Move it with the HUD editor.",
  category: "HUD",
  defaultOn: false,
  settings: [{ key: "mouse", label: "Mouse buttons and direction ring", type: "bool", default: true }],
  // Listeners go in before Krunker's own, so nothing it does to key events can hide them from us.
  early() {
    const opts = { capture: true, passive: true };
    // Typing in chat is not movement.
    window.addEventListener("keydown", (e) => codes.has(e.keyCode) && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName) && light(codes.get(e.keyCode), true), opts);
    window.addEventListener("keyup", (e) => codes.has(e.keyCode) && light(codes.get(e.keyCode), false), opts);
    window.addEventListener("mousedown", (e) => e.button === 0 ? light("lmb", true) : e.button === 2 && light("rmb", true), opts);
    window.addEventListener("mouseup", (e) => e.button === 0 ? light("lmb", false) : e.button === 2 && light("rmb", false), opts);
    window.addEventListener(
      "mousemove",
      (e) => {
        if (!document.pointerLockElement || !el) return;
        ax += e.movementX;
        ay += e.movementY;
        frame ||= requestAnimationFrame(ring);
      },
      opts,
    );
    window.addEventListener("blur", clear);
    // Binds change in Krunker's settings, which the player can only reach with the pointer unlocked.
    document.addEventListener("pointerlockchange", () => (clear(), readBinds()));
    readBinds();
  },
  async init() {
    css(CSS, "mc-keys-css");
    const hud = await waitFor("#inGameUI");
    const mouse = opt(mod, "mouse");
    el = h(
      "div",
      { id: "mc-keys" },
      KEYS.map(([name]) => h("span", { class: name })),
      mouse && [h("span", { class: "lmb" }, "LMB"), h("span", { class: "ring" }, h("i")), h("span", { class: "rmb" }, "RMB")],
    );
    hud.append(el);
    readBinds();
  },
};

export default mod;
