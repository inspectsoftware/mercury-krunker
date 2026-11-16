// Floating Mercury windows (matchmaker pick, pings, ranked queue, accounts, market): drag by the title bar, resize
// from the corner, close with × or Escape. Position, size and zoom are remembered per window.

import { css, h } from "../core/dom.js";
import floatingCss from "./floating.css";

css(floatingCss, "mercury-floating");

const open = new Map();
// Above the settings window (2147483000), which opens most panels from its buttons.
let top = 2147483100;
const raise = () => (top = Math.min(top + 1, 2147483600));

const load = (id) => {
  try {
    return JSON.parse(localStorage.getItem(`mercury:panel:${id}`)) ?? {};
  } catch {
    return {};
  }
};
const save = (id, state) => localStorage.setItem(`mercury:panel:${id}`, JSON.stringify(state));

export const isOpen = (id) => open.has(id);
export const closePanel = (id) => open.get(id)?.close();

/**
 * Opens (or reopens) window `id`. Returns {el, body, close, setStatus}.
 * zoomable: Ctrl+wheel and the −/+ buttons scale the content; tools: extra header elements.
 */
export function panel({ id, title, width = 420, height, zoomable = false, tools = [], onClose }) {
  open.get(id)?.close();
  document.exitPointerLock?.();
  const state = { x: null, y: null, w: width, h: height, zoom: 1, ...load(id) };
  const status = h("span", { class: "mc-float-status" });
  const body = h("div", { class: "mc-float-body" });
  const zoom = (by) => {
    state.zoom = Math.min(2, Math.max(0.6, Math.round((state.zoom + by) * 10) / 10));
    body.style.zoom = state.zoom;
    save(id, state);
  };
  const head = h(
    "div",
    { class: "mc-float-head" },
    h("b", {}, title),
    status,
    ...tools,
    zoomable && h("button", { class: "mc-float-tool", title: "Smaller", onclick: () => zoom(-0.1) }, "−"),
    zoomable && h("button", { class: "mc-float-tool", title: "Larger", onclick: () => zoom(0.1) }, "+"),
    h("button", { class: "mc-float-tool mc-float-x", title: "Close", onclick: () => close() }, "×"),
  );
  const el = h("div", { class: "mc-float", tabindex: -1 }, head, body);
  Object.assign(el.style, { width: `${state.w}px`, zIndex: raise() });
  if (state.h) el.style.height = `${state.h}px`;
  if (zoomable) body.style.zoom = state.zoom;

  // Keys typed in a panel belong to it, not to Krunker; Escape closes it.
  for (const type of ["keydown", "keyup", "keypress"]) el.addEventListener(type, (e) => e.stopPropagation());
  el.addEventListener("keydown", (e) => e.key === "Escape" && close());
  el.addEventListener("mousedown", () => (el.style.zIndex = raise()));
  if (zoomable) el.addEventListener("wheel", (e) => e.ctrlKey && (e.preventDefault(), zoom(e.deltaY < 0 ? 0.1 : -0.1)), { passive: false });

  head.addEventListener("mousedown", (down) => {
    if (down.target.closest("button, input, select")) return;
    const rect = el.getBoundingClientRect();
    const move = (e) => place(rect.left + e.clientX - down.clientX, rect.top + e.clientY - down.clientY);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      save(id, state);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  const place = (x, y) => {
    state.x = Math.max(0, Math.min(x, innerWidth - 80));
    state.y = Math.max(0, Math.min(y, innerHeight - 40));
    Object.assign(el.style, { left: `${state.x}px`, top: `${state.y}px` });
  };
  const resized = new ResizeObserver(() => {
    if (!el.isConnected) return;
    state.w = el.offsetWidth;
    state.h = el.offsetHeight;
    save(id, state);
  });

  function close() {
    if (open.get(id) !== api) return;
    open.delete(id);
    resized.disconnect();
    el.remove();
    onClose?.();
  }
  const api = { el, body, close, setStatus: (text) => (status.textContent = text) };
  open.set(id, api);
  document.body.append(el);
  if (state.x == null) place((innerWidth - el.offsetWidth) / 2, Math.max(20, (innerHeight - el.offsetHeight) / 3));
  else place(state.x, state.y);
  // Only once it is laid out, or the first callback would save the initial size over the remembered one.
  requestAnimationFrame(() => resized.observe(el));
  el.focus({ preventScroll: true });
  return api;
}

/** A simple table: headers and rows of cells (strings or elements). */
export function table(headers, rows, empty = "Nothing here.") {
  if (!rows.length) return h("div", { class: "mc-float-empty" }, empty);
  return h(
    "table",
    { class: "mc-table" },
    h("thead", {}, h("tr", {}, ...headers.map((t) => h("th", {}, t)))),
    h("tbody", {}, ...rows.map((cells) => h("tr", {}, ...cells.map((c) => h("td", {}, c ?? ""))))),
  );
}

/** Ping in ms with a color from good to bad. */
export function pingTag(ms) {
  const tone = ms == null ? "none" : ms < 60 ? "good" : ms < 120 ? "ok" : ms < 180 ? "meh" : "bad";
  return h("span", { class: `mc-ping ${tone}` }, ms == null ? "–" : `${Math.round(ms)} ms`);
}
