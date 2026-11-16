// Motion blur: a slight blur on the game's 3D view while the camera turns, from the mouse movement of a locked
// pointer. Only Krunker's WebGL canvas is filtered; the HUD (the DOM and Krunker's 2D #game-overlay canvas) stays
// sharp. One GPU filter pass while turning, nothing at rest: the filter is removed once the view settles.

import { opt } from "../core/modules.js";

let canvas = null;
let moved = 0; // mouse travel since the last frame
let level = 0; // current blur, px
let shown = 0;
let frame = 0;

/** The game's 3D canvas: the <canvas> Krunker puts straight in <body>, next to its 2D overlay. */
const gameCanvas = () => [...document.querySelectorAll("body > canvas")].find((c) => c.id !== "game-overlay") ?? null;

function tick() {
  frame = 0;
  if (!canvas?.isConnected) canvas = gameCanvas();
  if (!canvas) return;
  const max = Number(opt(mod, "strength")) || 1;
  level = Math.max(max * Math.min(1, moved / 140), level * 0.7);
  moved = 0;
  if (level < 0.12 || !document.pointerLockElement) level = 0;
  const px = Math.round(level * 4) / 4; // quarter-pixel steps: fewer style changes
  if (px !== shown) {
    canvas.style.filter = px ? `blur(${px}px)` : "";
    shown = px;
  }
  if (level) frame = requestAnimationFrame(tick);
}

const mod = {
  id: "motionBlur",
  name: "Motion blur",
  desc: "A slight blur on the 3D view while you turn. The HUD stays sharp.",
  category: "Look",
  defaultOn: false,
  settings: [{ key: "strength", label: "Strength", desc: "The most blur, in pixels, at fast turns.", type: "number", min: 0.5, max: 3, step: 0.25, default: 1.25 }],
  init() {
    const wake = () => (frame ||= requestAnimationFrame(tick));
    window.addEventListener(
      "mousemove",
      (e) => {
        if (!document.pointerLockElement) return;
        moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        wake();
      },
      { capture: true, passive: true },
    );
    document.addEventListener("pointerlockchange", wake);
  },
};

export default mod;
