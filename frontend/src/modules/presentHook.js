// The present hook in Chromium's GPU process (src/gpu_hook.rs): settings, the present-FPS counter, and the FPS limit.
//
// The FPS limit works in two places. Uncapped, Chromium gives a page no back-pressure: on a GPU-bound PC the game's
// requestAnimationFrame loop runs at well over 1000 FPS while the screen gets a handful of frames (measured: rAF 1700
// FPS, 2-5 presented FPS). So the page holds the game's frames back to the limit, and the hook, when it runs, paces
// the presents exactly (measured: 144.0 FPS, p99 6.99 ms at a 144 limit).

import { h, css } from "../core/dom.js";
import { call } from "../core/host.js";
import * as settings from "../core/settings.js";

const LIMITS = [0, 30, 60, 75, 120, 144, 165, 180, 240, 280, 360, 480];

// --- Page limiter: a callback asked for before the next frame's due time waits on a timer, then gets a real
// animation frame. (Re-requesting frames to wait doesn't work: a frame with nothing drawn makes Chromium fall back
// to its idle ~16.7 ms cadence.) Every callback of one animation frame shares its time slot.
let pageFps = 0;
let due = 0;
let lastTick = -1;

/** The next due time after a frame at `time`: keeps the cadence after a slightly late frame, restarts after a stall
 * (the same rule as the hook's limiter, `schedule` in src/gpu_hook.rs, which has the tests). */
function nextDue(due, time, period) {
  return time - due > period ? time + period : Math.max(due, time) + period;
}

function installPageLimiter() {
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  const pending = new Map(); // our id → { timer } while waiting, { frame } once requested
  let seq = 0;
  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (!pageFps) return raf(callback);
    const id = --seq; // negative: never collides with Chromium's ids
    const run = (time) => {
      pending.delete(id);
      if (time !== lastTick) {
        lastTick = time;
        due = nextDue(due, time, 1000 / pageFps);
      }
      callback(time);
    };
    const request = () => pending.set(id, { frame: raf(run) });
    const wait = due - performance.now() - LEAD;
    if (wait > 0) pending.set(id, { timer: setTimeout(request, wait) });
    else request();
    return id;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    const p = pending.get(id);
    if (!p) return caf(id);
    if (p.timer != null) clearTimeout(p.timer);
    else caf(p.frame);
    pending.delete(id);
  };
}

// --- Present-FPS counter ---
let counter = null;
let timer = 0;

async function poll() {
  let stats;
  try {
    stats = await call("perf.stats");
  } catch {
    return;
  }
  if (!counter) return;
  counter.dataset.stats = JSON.stringify(stats);
  counter.textContent = stats.active && stats.fps
    ? `${Math.round(stats.fps)} FPS · ${stats.avgMs.toFixed(1)} ms · p99 ${stats.p99Ms.toFixed(1)} ms`
    : `present hook ${stats.stateName}`;
}

function showCounter(on) {
  clearInterval(timer);
  counter?.remove();
  counter = null;
  if (!on) return;
  css(".mc-fps{position:fixed;left:6px;top:4px;z-index:2147482000;padding:1px 6px;border-radius:4px;background:rgba(0,0,0,.45);color:#9ad7ff;font:600 12px/18px Consolas,monospace!important;pointer-events:none;white-space:nowrap}", "mercury-fps");
  counter = document.body.appendChild(h("div", { class: "mc-fps" }, "…"));
  poll();
  timer = setInterval(poll, 500);
}

// Measured on the bench scene: a page cap holds up to frame times of ~7 ms (144 FPS: 142-143 FPS); with longer gaps
// Chromium hands out the next animation frame late (a 60 cap gave 40-50 FPS, 60 ms spikes). So with the hook pacing
// presents exactly, the page cap stays at least 144: enough to stop the flood, short enough to stay on time.
// shortcut: without the hook, caps under ~120 FPS undershoot; a Chromium-side pacer would fix that.
const PAGE_FLOOR = 144;
const LEAD = 1;

function applyLimit(fps) {
  pageFps = fps;
  call("perf.config", { fpsLimit: fps }).catch(() => {});
  if (!fps || fps >= PAGE_FLOOR) return;
  // The hook reports once Chromium has presented a few frames.
  setTimeout(async () => {
    const stats = await call("perf.stats").catch(() => null);
    if (stats?.active && pageFps === fps) pageFps = PAGE_FLOOR;
  }, 2000);
}

export default {
  id: "present",
  name: "Present hook",
  category: "Engine",
  perf: true,
  toggle: false,
  settings: [
    {
      key: "mode",
      label: "Present hook",
      desc: "Mercury's frame limiter and low-latency swap chain, inside Chromium's GPU process. Auto turns it off on laptops whose screen is wired to the integrated GPU. If the screen ever stays black, set Off or start with --safe-mode.",
      type: "select",
      default: "auto",
      restart: true,
      options: [["auto", "Auto"], ["on", "On (also on hybrid laptops)"], ["off", "Off"]],
    },
    {
      key: "fpsLimit",
      label: "FPS limit",
      desc: "Caps the game's frames, so a GPU that can't keep up isn't flooded with work, and paces what reaches the screen evenly (with the present hook). Turning a limit on for the first time applies on the next lobby.",
      type: "select",
      default: "0",
      options: LIMITS.map((n) => [String(n), n ? `${n} FPS` : "Uncapped"]),
      onChange: (value) => applyLimit(Number(value)),
    },
    {
      key: "counter",
      label: "Present FPS counter",
      desc: "Frames the GPU process really presents, with average and 99th-percentile frame times. Top left.",
      type: "bool",
      default: false,
      onChange: (on) => showCounter(on),
    },
  ],
  early() {
    // Wraps requestAnimationFrame only when a limit is set (before Krunker's scripts keep a reference to it).
    pageFps = Number(settings.get("present.fpsLimit")) || 0;
    if (pageFps) installPageLimiter();
  },
  init() {
    const limit = Number(settings.get("present.fpsLimit"));
    if (limit) applyLimit(limit);
    if (settings.get("present.counter")) showCounter(true);
  },
};
