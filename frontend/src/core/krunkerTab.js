// Mercury's settings as the last tab of Krunker's own settings window, the way Krunker clients usually do it.
//
// Krunker's settings window is `windows[0]`: it draws its tabs from `tabs[settingType]` ("basic" or "advanced",
// entries {name, categories}) and fills #settHolder with the HTML `getSettings()` returns. We add a "Mercury" tab to
// both lists and wrap getSettings: on our tab it returns a placeholder that we fill with Krunker-styled rows, and
// while the player searches Krunker's settings it appends our matching settings. If Krunker's window ever changes
// shape, Mercury's own settings window (ui.js) takes over.

import { h, toast } from "./dom.js";
import { comboOf } from "./hotkeys.js";
import * as registry from "./modules.js";
import * as settings from "./settings.js";
import * as ui from "./ui.js";

const TAB = { name: "Mercury", categories: [] };
const ORDER = ["General", "Engine", "Performance", "Input", "HUD", "Look", "Chat", "Social", "Matchmaking", "Ranked", "Accounts", "Market", "Streaming", "Userscripts"];
let krunker = null; // windows[0] once we are installed

/** Waits for Krunker's settings window object, then adds our tab. */
export function install() {
  const timer = setInterval(() => {
    const w = window.windows?.[0];
    if (!w?.tabs?.basic || typeof w.getSettings !== "function") return;
    clearInterval(timer);
    for (const list of Object.values(w.tabs)) if (Array.isArray(list) && !list.includes(TAB)) list.push(TAB);
    const original = w.getSettings;
    w.getSettings = function (...args) {
      if (this.tabs[this.settingType]?.[this.tabIndex] === TAB) {
        queueMicrotask(fill);
        return '<div id="mercurySettings"></div>';
      }
      const html = original.apply(this, args);
      if (!this.settingSearch) return html;
      queueMicrotask(() => fill(String(this.settingSearch)));
      return html + '<div id="mercurySettings"></div>';
    };
    krunker = w;
  }, 250);
  // Krunker's game script arrives after the page; give up quietly if its settings window never shows up.
  setTimeout(() => clearInterval(timer), 120_000);
}

const tabOpen = () => krunker && document.getElementById("windowHolder")?.style.display !== "none" && krunker.tabs[krunker.settingType]?.[krunker.tabIndex] === TAB;

export function open() {
  if (!krunker || typeof window.showWindow !== "function") return ui.open();
  document.exitPointerLock?.();
  window.showWindow(1);
  krunker.changeTab(krunker.tabs[krunker.settingType].indexOf(TAB));
}

export function toggle() {
  if (tabOpen() && typeof window.closWind === "function") window.closWind();
  else open();
}

/** Our settings as Krunker folders: every category on our tab, or only the matches for Krunker's search `query`. */
function fill(query = "") {
  const holder = document.getElementById("mercurySettings");
  if (!holder) return;
  const q = query.trim().toLowerCase();
  const defs = settings.definitions().filter((d) => {
    const mod = registry.byId(d.module);
    if (!d.type || d.type === "hidden" || !registry.visible(mod)) return false;
    return !q || [d.label, d.desc, d.category, mod?.name].some((t) => t?.toLowerCase().includes(q));
  });
  const categories = [...new Set(defs.map((d) => d.category))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const folders = categories.flatMap((cat) => {
    const id = `mercury_${cat.toLowerCase().replace(/\W+/g, "")}`;
    return [
      h("div", { class: "setHed", id: `setHed_${id}`, onclick: function () { krunker?.collapseFolder?.(this); } },
        h("span", { class: "material-icons plusOrMinus" }, "keyboard_arrow_down"), ` ${q ? "Mercury · " : ""}${cat}`),
      h("div", { class: "setBodH", id: `setBod_${id}` }, ...defs.filter((d) => d.category === cat).map(row)),
    ];
  });
  holder.replaceChildren(...folders);
}

function row(def) {
  const mod = registry.byId(def.module);
  const moduleOff = !def.isToggle && mod && mod.toggle !== false && !settings.get(`${mod.id}.enabled`);
  return h(
    "div",
    { class: `settName mc-krow${def.isToggle ? " mc-kmodule" : ""}${moduleOff ? " mc-koff" : ""}`, title: def.desc ?? "" },
    def.label,
    def.restart && h("span", { style: { color: "#eb5656" } }, " *"),
    " ",
    control(def),
  );
}

function changed(def, value) {
  settings.set(def.id, value);
  if (def.restart) toast("Restart the client to apply this (General → Restart client).");
  else if (def.isToggle && !registry.byId(def.module)?.live) toast("Applies on the next lobby (or press F5).");
  def.onChange?.(value);
  fill(krunker?.settingSearch ? String(krunker.settingSearch) : "");
}

/** Krunker's own control markup, so the tab looks like the rest of the window. */
function control(def) {
  const value = settings.get(def.id);
  switch (def.type) {
    case "bool":
      return h("label", { class: "switch", style: { marginLeft: "10px" } },
        h("input", { type: "checkbox", checked: !!value, onchange: (e) => changed(def, e.target.checked) }),
        h("span", { class: "slider" }, h("span", { class: "grooves" })));
    case "select":
      return h("select", { class: "inputGrey2", onchange: (e) => changed(def, e.target.value) },
        ...def.options.map((o) => {
          const [v, label] = Array.isArray(o) ? o : [o, o];
          return h("option", { value: v, selected: v === value }, label);
        }));
    case "number": {
      const range = h("input", { type: "range", class: "sliderM", min: def.min, max: def.max, step: def.step ?? 1, value });
      const box = h("input", { type: "number", class: "sliderVal", min: def.min, max: def.max, step: def.step ?? 1, value, style: { marginRight: "0px", borderWidth: "0px" } });
      range.oninput = () => (box.value = range.value);
      range.onchange = () => changed(def, Number(range.value));
      box.onchange = () => changed(def, Math.min(def.max, Math.max(def.min, Number(box.value))));
      return h("span", {}, box, h("div", { class: "slidecontainer", style: { marginTop: "-8px" } }, range));
    }
    case "text":
      return h("input", { type: "text", class: "inputGrey2 mc-ktext", value: value ?? "", placeholder: def.placeholder ?? "", onchange: (e) => changed(def, e.target.value) });
    case "list": {
      const area = h("textarea", { class: "inputGrey2 mc-klist", spellcheck: false, onchange: (e) => changed(def, e.target.value) });
      if (value != null) area.value = value;
      else Promise.resolve(def.loadDefault?.() ?? def.default ?? "").then((text) => (area.value = text));
      return area;
    }
    case "action":
      return h("div", { class: "settingsBtn", style: { width: "auto" }, onclick: () => def.run() }, def.button ?? "Run");
    case "key":
      return keyButton(def, value);
    default:
      // Control types without a Krunker look (color, and any added later) use Mercury's own.
      return ui.control(def);
  }
}

function keyButton(def, value) {
  const button = h("div", { class: "settingsBtn mc-kkey", style: { width: "auto" }, title: "Click, then press a key. Backspace clears." }, value || "None");
  button.onclick = () => {
    button.textContent = "Press a key…";
    const onKey = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") return finish(value);
      const clear = event.key === "Backspace" || event.key === "Delete";
      const combo = clear ? "" : comboOf(event);
      if (combo || clear) finish(combo);
    };
    const finish = (combo) => {
      window.removeEventListener("keydown", onKey, true);
      changed(def, combo);
    };
    window.addEventListener("keydown", onKey, true);
  };
  return button;
}
