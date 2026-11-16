// The Mercury settings window: categories on the left, the settings of the chosen one (or the search hits) on the
// right. Every control is generated from the setting definitions (core/settings.js, core/modules.js).

import { h, toast } from "./dom.js";
import { comboOf } from "./hotkeys.js";
import { version } from "./host.js";
import * as registry from "./modules.js";
import * as settings from "./settings.js";

const ORDER = ["General", "Engine", "Performance", "Input", "HUD", "Look", "Chat", "Social", "Matchmaking", "Ranked", "Accounts", "Market", "Streaming", "Userscripts", "About"];
let overlay = null;
let nav, body, search;
let category = "General";
let listening = null; // the key-capture button waiting for a key

export const isOpen = () => !!overlay;

export function toggle(cat) {
  overlay ? close() : open(cat);
}

export function open(cat) {
  if (overlay) return;
  if (cat) category = cat;
  document.exitPointerLock?.();
  search = h("input", { class: "mc-search", placeholder: "Search settings", oninput: render });
  nav = h("nav", { class: "mc-nav" });
  body = h("div", { class: "mc-body" });
  overlay = h(
    "div",
    { class: "mc-overlay", onmousedown: (e) => e.target === overlay && close() },
    h(
      "div",
      { class: "mc-window" },
      h("div", { class: "mc-head" }, h("div", { class: "mc-title" }, h("b", {}, "MERCURY"), " CLIENT", h("small", {}, `v${version}`)), search, h("button", { class: "mc-x", title: "Close", onclick: close }, "×")),
      nav,
      body,
    ),
  );
  // Keys typed in the window belong to it, not to Krunker.
  for (const type of ["keydown", "keyup", "keypress"]) overlay.addEventListener(type, (e) => e.stopPropagation());
  window.addEventListener("keydown", onEscape, true);
  document.body.append(overlay);
  render();
  search.focus();
}

export function close() {
  window.removeEventListener("keydown", onEscape, true);
  overlay?.remove();
  overlay = null;
  listening = null;
}

function onEscape(event) {
  if (event.key !== "Escape" || listening) return;
  event.stopImmediatePropagation();
  event.preventDefault();
  close();
}

/** Setting definitions the window shows, in module order: each module's on/off first, then its settings. */
function shownDefinitions() {
  const defs = settings.definitions().filter((d) => d.type && d.type !== "hidden" && registry.visible(registry.byId(d.module)));
  const q = search.value.trim().toLowerCase();
  if (!q) return defs.filter((d) => d.category === category);
  return defs.filter((d) => [d.label, d.desc, d.category, registry.byId(d.module)?.name].some((t) => t?.toLowerCase().includes(q)));
}

function render() {
  const categories = [...new Set(settings.definitions().filter((d) => registry.visible(registry.byId(d.module))).map((d) => d.category))].sort(
    (a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b),
  );
  if (!categories.includes(category)) category = categories[0];
  const searching = !!search.value.trim();
  nav.replaceChildren(
    ...categories.map((c) =>
      h("button", { class: !searching && c === category ? "on" : "", onclick: () => ((search.value = ""), (category = c), render()) }, c),
    ),
  );

  const defs = shownDefinitions();
  if (!defs.length) return body.replaceChildren(h("div", { class: "mc-empty" }, "Nothing matches."));
  const rows = [];
  let lastCategory = null;
  for (const def of defs) {
    if (searching && def.category !== lastCategory) rows.push(h("h3", {}, (lastCategory = def.category)));
    rows.push(row(def));
  }
  body.replaceChildren(...rows);
}

function row(def) {
  const mod = registry.byId(def.module);
  const moduleOn = !mod || mod.toggle === false || settings.get(`${mod.id}.enabled`);
  const classes = ["mc-row", def.isToggle && "module", !def.isToggle && mod && mod.toggle !== false && "sub", !def.isToggle && !moduleOn && "off"];
  return h(
    "div",
    { class: classes.filter(Boolean).join(" ") },
    h(
      "div",
      { class: "mc-label" },
      h("div", { class: "mc-name" }, def.label, def.restart && h("span", { class: "mc-tag" }, "restart")),
      def.desc && h("div", { class: "mc-desc" }, def.desc),
    ),
    control(def),
  );
}

function changed(def, value) {
  settings.set(def.id, value);
  if (def.restart) toast("Restart the client to apply this (General → Restart client).");
  else if (def.isToggle && !registry.byId(def.module)?.live) toast("Applies on the next lobby (or press F5).");
  def.onChange?.(value);
  render();
}

function control(def) {
  const value = settings.get(def.id);
  switch (def.type) {
    case "bool":
      return h("button", { class: `mc-switch${value ? " on" : ""}`, title: value ? "On" : "Off", onclick: () => changed(def, !value) });
    case "select":
      return h(
        "select",
        { class: "mc-select", onchange: (e) => changed(def, e.target.value) },
        ...def.options.map((o) => {
          const [v, label] = Array.isArray(o) ? o : [o, o];
          return h("option", { value: v, selected: v === value }, label);
        }),
      );
    case "number": {
      const out = h("output", {}, value);
      return h(
        "div",
        { class: "mc-range" },
        h("input", {
          type: "range", min: def.min, max: def.max, step: def.step ?? 1, value,
          oninput: (e) => (out.value = e.target.value),
          onchange: (e) => changed(def, Number(e.target.value)),
        }),
        out,
      );
    }
    case "text":
      return h("input", { class: `mc-input${def.wide ? " wide" : ""}`, value: value ?? "", placeholder: def.placeholder ?? "", onchange: (e) => changed(def, e.target.value) });
    case "list": {
      // One entry per line. Without a saved value it shows the defaults (def.loadDefault, possibly from the host).
      const area = h("textarea", { class: "mc-input mc-textarea", spellcheck: false, onchange: (e) => changed(def, e.target.value) });
      if (value != null) area.value = value;
      else Promise.resolve(def.loadDefault?.() ?? def.default ?? "").then((text) => (area.value = text));
      return area;
    }
    case "color":
      return h("input", { type: "color", class: "mc-input", style: { minWidth: "60px", padding: "2px" }, value, onchange: (e) => changed(def, e.target.value) });
    case "key":
      return keyButton(def, value);
    case "action":
      return h("button", { class: `mc-btn${def.primary ? " primary" : ""}`, onclick: () => def.run() }, def.button ?? "Run");
    case "custom": // the module builds the control (status panels)
      return def.render(def);
    default:
      return h("span", {}, String(value));
  }
}

function keyButton(def, value) {
  const button = h("button", { class: "mc-btn mc-key", title: "Click, then press a key. Backspace clears." }, value || "None");
  button.onclick = () => {
    listening = button;
    button.classList.add("listening");
    button.textContent = "Press a key…";
    const onKey = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") return finish(value);
      const combo = event.key === "Backspace" || event.key === "Delete" ? "" : comboOf(event);
      if (combo !== "" || event.key === "Backspace" || event.key === "Delete") finish(combo);
    };
    const finish = (combo) => {
      window.removeEventListener("keydown", onKey, true);
      listening = null;
      changed(def, combo);
    };
    window.addEventListener("keydown", onKey, true);
  };
  return button;
}
