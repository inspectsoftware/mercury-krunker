// HUD editor: drag, resize and hide Krunker's in-game HUD and Mercury's own HUD pieces (keystrokes, menu timer).
// Each element keeps Krunker's own position; the editor stores an offset and a scale (lib/hudLayout.js) as JSON in a
// hidden setting. Dragging snaps to the screen's edges and center lines and to the other elements; Alt places freely.

import { css, h, toast } from "../core/dom.js";
import { onHotkey } from "../core/hotkeys.js";
import * as registry from "../core/modules.js";
import * as settings from "../core/settings.js";
import * as ui from "../core/ui.js";
import { cleanLayout, layoutCss } from "../lib/hudLayout.js";
import { guides, snap } from "../lib/snap.js";
import { lateCss } from "../lib/style.js";

const LAYOUT = "hudEditor.layout";
// Krunker's HUD blocks (stable ids, none inside another) and ours.
const ELEMENTS = [
  ["#timerHolder", "Timer"],
  ["#matchInfo", "Match info"],
  ["#topLeftMap", "Minimap"],
  ["#topLeftData", "FPS and ping"],
  ["#topLeftBottom", "Votes and team scores"],
  ["#centerLeaderDisplay", "Top players"],
  ["#topMidHold", "Rounds and messages"],
  ["#leaderboardHolder", "Leaderboard"],
  ["#topRightCounters", "Kills, deaths, streak"],
  ["#killFeed", "Kill feed"],
  ["#chalDisplay", "Challenge"],
  ["#bottomLeftHolder", "Health"],
  ["#weapHolder", "Weapons"],
  ["#perkHolder", "Perks"],
  ["#bottomRight", "Ammo"],
  ["#interactMsg", "Interact prompt"],
  ["#reloadMsg", "Reload prompt"],
  ["#speedRunHolder", "Speedrun timer"],
  ["#chatHolder", "Chat"],
  ["#mc-keys", "Keystrokes"],
  ["#mc-menu-timer", "Menu timer"],
];
const SELECTORS = ELEMENTS.map(([sel]) => sel);

const EDIT_CSS = `
html.mc-hud-edit #inGameUI { display: block !important; }
html.mc-hud-edit #menuHolder, html.mc-hud-edit #instructionHolder, html.mc-hud-edit #aHolder, html.mc-hud-edit #infoHolder { visibility: hidden !important; }
.mc-hud-layer { position: fixed; inset: 0; z-index: 2147482000; font: 13px/1.4 "Segoe UI", system-ui, sans-serif; color: #e7e9ec; user-select: none; }
.mc-hud-layer, .mc-hud-layer * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif !important; }
.mc-hud-frame { position: fixed; border: 1px dashed rgba(154, 215, 255, 0.85); background: rgba(47, 134, 194, 0.12); cursor: move; }
.mc-hud-frame:hover, .mc-hud-frame.drag { border-style: solid; background: rgba(47, 134, 194, 0.24); }
.mc-hud-frame.hidden { border-color: rgba(255, 255, 255, 0.4); background: rgba(0, 0, 0, 0.3); }
.mc-hud-tag { position: absolute; left: -1px; bottom: 100%; display: flex; gap: 6px; align-items: center; padding: 1px 4px 1px 7px; font-size: 11px; white-space: nowrap; color: #08131d; background: #9ad7ff; border-radius: 4px 4px 0 0; }
.mc-hud-frame.hidden .mc-hud-tag { background: #c9ced6; }
.mc-hud-tag button { padding: 0 5px; font: inherit; color: inherit; background: rgba(0, 0, 0, 0.12); border: 0; border-radius: 3px; cursor: pointer; }
.mc-hud-size { position: absolute; right: -6px; bottom: -6px; width: 11px; height: 11px; background: #9ad7ff; border: 1px solid #08131d; border-radius: 2px; cursor: nwse-resize; }
.mc-hud-guide { position: fixed; display: none; background: #ff5fa2; pointer-events: none; }
.mc-hud-guide.v { top: 0; bottom: 0; width: 1px; }
.mc-hud-guide.h { left: 0; right: 0; height: 1px; }
.mc-hud-bar {
  position: fixed; top: 12px; left: 50%; translate: -50% 0; display: flex; gap: 8px; align-items: center; max-width: 96vw;
  padding: 8px 10px 8px 14px; background: #14161a; border: 1px solid #2a2e36; border-radius: 10px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.mc-hud-bar b { color: #9ad7ff; }
.mc-hud-list { position: fixed; top: 64px; left: 50%; translate: -50% 0; width: 340px; max-height: 70vh; overflow-y: auto; padding: 6px; background: #14161a; border: 1px solid #2a2e36; border-radius: 10px; }
.mc-hud-list label { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 6px; cursor: pointer; }
.mc-hud-list label:hover { background: #1d2026; }
.mc-hud-list small { margin-left: auto; color: #6f7783; }
`;

const saved = () => cleanLayout(settings.get(LAYOUT), SELECTORS);
const apply = (layout) => lateCss("mc-hud-layout", registry.enabled(mod) ? layoutCss(layout) : null, 50);

let editor = null; // while editing: {stop()}

function startEditing() {
  if (editor) return;
  ui.close();
  document.exitPointerLock?.();
  css(EDIT_CSS, "mc-hud-edit-css");
  document.documentElement.classList.add("mc-hud-edit");

  const draft = saved();
  const commit = () => {
    settings.set(LAYOUT, structuredClone(draft));
    apply(draft);
  };
  const entry = (sel) => (draft[sel] ??= { x: 0, y: 0, s: 1, hide: false });
  const guideV = h("div", { class: "mc-hud-guide v" });
  const guideH = h("div", { class: "mc-hud-guide h" });
  const showGuides = (gx, gy) => {
    guideV.style.display = gx == null ? "none" : "block";
    guideH.style.display = gy == null ? "none" : "block";
    if (gx != null) guideV.style.left = `${gx}px`;
    if (gy != null) guideH.style.top = `${gy}px`;
  };
  const rects = new Map(); // selector → its on-screen box this frame

  const frames = ELEMENTS.map(([sel, label]) => {
    const hide = h("button", { title: "Hide or show this element" });
    const frame = h("div", { class: "mc-hud-frame", title: "Drag to move, wheel to resize, double-click to reset" }, h("div", { class: "mc-hud-tag" }, label, hide), h("div", { class: "mc-hud-size", title: "Drag to resize" }));
    hide.onmousedown = (e) => e.stopPropagation();
    hide.onclick = () => {
      entry(sel).hide = !entry(sel).hide;
      commit();
    };
    frame.ondblclick = () => {
      delete draft[sel];
      commit();
    };
    frame.onwheel = (e) => {
      e.preventDefault();
      const p = entry(sel);
      p.s = Math.min(4, Math.max(0.25, Math.round(p.s * (e.deltaY < 0 ? 1.05 : 1 / 1.05) * 100) / 100));
      commit();
    };
    frame.onmousedown = (e) => {
      const el = document.querySelector(sel);
      if (e.button !== 0 || !el) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const p = entry(sel);
      const start = { ...p };
      // Screen pixels per CSS pixel of the element (Krunker scales #uiBase with its UI scale setting).
      const k = r.width / ((el.offsetWidth || r.width) * p.s) || 1;
      const resizing = e.target.classList.contains("mc-hud-size");
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const reach = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
      const lines = guides({ w: innerWidth, h: innerHeight }, [...rects].filter(([s]) => s !== sel).map(([, box]) => box));
      frame.classList.add("drag");
      const move = (ev) => {
        if (resizing) {
          p.s = Math.min(4, Math.max(0.25, Math.round(((start.s * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / reach) * 100) / 100));
        } else {
          let dx = ev.clientX - e.clientX;
          let dy = ev.clientY - e.clientY;
          const stick = ev.altKey ? { dx: 0, dy: 0, gx: null, gy: null } : snap({ x: r.x + dx, y: r.y + dy, w: r.width, h: r.height }, lines);
          dx += stick.dx;
          dy += stick.dy;
          showGuides(stick.gx, stick.gy);
          p.x = Math.round((start.x + dx / k) * 10) / 10;
          p.y = Math.round((start.y + dy / k) * 10) / 10;
        }
        apply(draft);
      };
      const up = () => {
        window.removeEventListener("mousemove", move, true);
        window.removeEventListener("mouseup", up, true);
        frame.classList.remove("drag");
        showGuides(null, null);
        commit();
      };
      window.addEventListener("mousemove", move, true);
      window.addEventListener("mouseup", up, true);
    };
    return { sel, frame, hide };
  });

  const list = h("div", { class: "mc-hud-list", style: { display: "none" } });
  const fillList = () =>
    list.replaceChildren(
      ...ELEMENTS.map(([sel, label]) => {
        const box = h("input", { type: "checkbox", checked: !draft[sel]?.hide });
        box.onchange = () => {
          entry(sel).hide = !box.checked;
          commit();
        };
        return h("label", {}, box, label, rects.has(sel) ? null : h("small", {}, "not on screen now"));
      }),
    );
  let armed = 0;
  const reset = h("button", { class: "mc-btn" }, "Reset all");
  reset.onclick = () => {
    if (!armed) {
      reset.textContent = "Click again to reset";
      armed = setTimeout(() => ((armed = 0), (reset.textContent = "Reset all")), 3000);
      return;
    }
    for (const sel of Object.keys(draft)) delete draft[sel];
    commit();
    toast("HUD layout reset.");
  };
  const bar = h(
    "div",
    { class: "mc-hud-bar" },
    h("span", {}, h("b", {}, "HUD editor"), " · drag to move · wheel or corner to resize · Alt: no snapping"),
    h("button", { class: "mc-btn", onclick: () => ((list.style.display = list.style.display ? "" : "none"), fillList()) }, "Elements"),
    reset,
    h("button", { class: "mc-btn primary", onclick: () => stopEditing() }, "Done"),
  );
  const layer = h("div", { class: "mc-hud-layer" }, ...frames.map((f) => f.frame), guideV, guideH, bar, list);
  for (const type of ["keydown", "keyup", "keypress"]) layer.addEventListener(type, (e) => e.stopPropagation());
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stopEditing();
  };
  window.addEventListener("keydown", onKey, true);
  document.body.append(layer);

  // Frames follow their elements every frame while the editor is open (about 20 rect reads per frame).
  let raf = 0;
  const follow = () => {
    rects.clear();
    for (const { sel, frame, hide } of frames) {
      const el = document.querySelector(sel);
      const r = el?.getBoundingClientRect();
      const on = r && r.width > 0 && r.height > 0;
      frame.style.display = on ? "" : "none";
      if (!on) continue;
      rects.set(sel, { x: r.x, y: r.y, w: r.width, h: r.height });
      Object.assign(frame.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
      frame.classList.toggle("hidden", !!draft[sel]?.hide);
      hide.textContent = draft[sel]?.hide ? "show" : "hide";
    }
    raf = requestAnimationFrame(follow);
  };
  follow();

  editor = {
    stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      layer.remove();
      document.documentElement.classList.remove("mc-hud-edit");
      commit();
    },
  };
}

function stopEditing() {
  editor?.stop();
  editor = null;
}

const mod = {
  id: "hudEditor",
  name: "HUD editor",
  desc: "Move, resize and hide every part of the in-game HUD, plus the menu timer and keystrokes.",
  category: "HUD",
  live: true,
  settings: [
    { key: "edit", label: "Edit the HUD", desc: "Works best in a match: press the hotkey while playing.", type: "action", button: "Edit HUD", primary: true, run: () => registry.enabled(mod) ? startEditing() : toast("Switch the HUD editor on first.") },
    { key: "key", label: "Editor hotkey", type: "key", default: "F7" },
    { key: "reset", label: "Reset the layout", desc: "Every HUD element back to Krunker's own place and size.", type: "action", button: "Reset", run: () => (settings.reset(LAYOUT), apply({}), toast("HUD layout reset.")) },
    { key: "layout", type: "hidden", default: {} },
  ],
  init: () => apply(saved()),
};

onHotkey("hudEditor.key", () => registry.enabled(mod) && (editor ? stopEditing() : startEditing()));
const reapply = () => document.readyState !== "loading" && apply(saved());
settings.onChange("hudEditor.enabled", reapply);
settings.onChange(registry.PERFORMANCE_ONLY, reapply);
export default mod;
