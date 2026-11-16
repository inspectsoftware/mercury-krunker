// CSS manager: the player's own stylesheets in <data>/css. The active ones apply after all of Krunker's styles
// (lib/style.js), in the order they were switched on. The editor previews while typing and saves by itself.

import { h, toast } from "../core/dom.js";
import { call } from "../core/host.js";
import * as registry from "../core/modules.js";
import * as settings from "../core/settings.js";
import * as ui from "../core/ui.js";
import { codeEditor } from "../lib/editor.js";
import { highlightCss } from "../lib/highlight.js";
import { panel } from "../lib/panel.js";
import { lateCss } from "../lib/style.js";

const ACTIVE = "cssManager.active";
const texts = new Map(); // path → text, for the files we have read
let previewing = null; // the file open in the editor: it applies while you edit it, active or not

const active = () => {
  const list = settings.get(ACTIVE);
  return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
};

/** Shows or removes one file's stylesheet. */
function apply(path) {
  const order = active().indexOf(path);
  const on = registry.enabled(mod) && (order >= 0 || previewing === path) && texts.has(path);
  lateCss(`mc-user-css:${path}`, on ? texts.get(path) : null, 100 + (order < 0 ? 99 : order));
}

async function load(path) {
  if (!texts.has(path)) texts.set(path, await call("files.read", { dir: "css", path }));
  return texts.get(path);
}

async function applyAll() {
  for (const el of document.querySelectorAll("style[id^='mc-user-css:']")) el.remove();
  for (const path of active()) {
    try {
      await load(path);
      apply(path);
    } catch (error) {
      console.warn(`[mercury] css/${path}:`, error.message);
    }
  }
  if (previewing) apply(previewing);
}

/** "My Theme!.css" → "My-Theme-.css"; always ends in .css. */
function cssName(name) {
  const base = name.trim().replace(/\.css$/i, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "");
  return base ? `${base}.css` : "";
}

function openManager() {
  ui.close();
  let files = [];
  let current = null;
  let saveTimer = 0;
  let pendingSave = null;

  const flush = () => {
    clearTimeout(saveTimer);
    if (!pendingSave) return;
    const { path, text } = pendingSave;
    pendingSave = null;
    call("files.write", { dir: "css", path, text })
      .then(() => current === path && (status.textContent = "Saved"))
      .catch((e) => toast(`Not saved: ${e.message}`));
  };

  const status = h("span", { class: "mc-hint" });
  const name = h("div", { class: "mc-path", style: { flex: "1" } });
  const editor = codeEditor({
    highlight: highlightCss,
    onInput: (text) => {
      texts.set(current, text);
      apply(current);
      pendingSave = { path: current, text };
      status.textContent = "Saving…";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 500);
    },
  });
  let armed = 0;
  const del = h("button", { class: "mc-btn danger" }, "Delete");
  del.onclick = async () => {
    if (!armed) {
      del.textContent = "Click again to delete";
      armed = setTimeout(() => ((armed = 0), (del.textContent = "Delete")), 3000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    del.textContent = "Delete";
    const path = current;
    clearTimeout(saveTimer);
    pendingSave = null;
    await call("files.delete", { dir: "css", path }).catch((e) => toast(e.message));
    settings.set(ACTIVE, active().filter((p) => p !== path));
    texts.delete(path);
    previewing = null;
    apply(path);
    select(null);
    refresh();
  };
  const empty = h("div", { class: "mc-hint", style: { margin: "auto", textAlign: "center", maxWidth: "380px" } }, "Pick a file on the left, or make one. Switched-on files apply after Krunker's own styles, in the order you switched them on. Drop .css files here to import them.");
  const bar = h("div", { class: "mc-bar" }, name, status, del);
  const list = h("div", { class: "mc-scroll" });
  const newName = h("input", { class: "mc-input", placeholder: "new-style.css" });

  async function select(path) {
    flush();
    const old = previewing;
    previewing = path;
    if (old && old !== path) apply(old);
    current = path;
    bar.style.display = editor.el.style.display = path ? "" : "none";
    empty.style.display = path ? "none" : "";
    if (path) {
      name.textContent = path;
      status.textContent = "";
      try {
        editor.set(await load(path));
      } catch (e) {
        editor.set("");
        toast(`Could not read ${path}: ${e.message}`);
      }
      apply(path);
      editor.area.focus();
    }
    render();
  }

  function render() {
    const on = active();
    list.replaceChildren(
      ...files.map(({ path }) =>
        h(
          "div",
          { class: `mc-list-row${path === current ? " on" : ""}` },
          h("button", {
            class: `mc-switch${on.includes(path) ? " on" : ""}`,
            title: on.includes(path) ? "On" : "Off",
            onclick: async () => {
              const now = active();
              settings.set(ACTIVE, now.includes(path) ? now.filter((p) => p !== path) : [...now, path]);
              await load(path).catch(() => {});
              applyAll();
              render();
            },
          }),
          h("div", { class: "mc-grow mc-path", onclick: () => select(path) }, path),
        ),
      ),
    );
    if (!files.length) list.append(h("div", { class: "mc-hint", style: { padding: "12px" } }, "No CSS files yet."));
  }

  async function refresh() {
    files = await call("files.list", { dir: "css" }).catch(() => []);
    files = files.filter((f) => /\.css$/i.test(f.path));
    render();
  }

  async function create(rawName, text) {
    let path = cssName(rawName);
    if (!path) return toast("Give the file a name.");
    for (let n = 2; files.some((f) => f.path === path); n++) path = cssName(`${rawName.replace(/\.css$/i, "")}-${n}`);
    try {
      await call("files.write", { dir: "css", path, text });
    } catch (e) {
      return toast(`Not created: ${e.message}`);
    }
    texts.set(path, text);
    await refresh();
    return path;
  }

  async function importFiles(list) {
    const css = list.filter((f) => /\.css$/i.test(f.name));
    if (css.length < list.length) toast("Only .css files go here. Images and sounds belong in the resource swapper.");
    let last;
    for (const file of css) last = await create(file.name, await file.text());
    if (last) select(last);
  }

  const picker = h("input", { type: "file", accept: ".css,text/css", multiple: true, onchange: () => importFiles([...picker.files]) });
  const side = h(
    "div",
    { class: "mc-side" },
    h(
      "div",
      { class: "mc-bar", style: { padding: "12px" } },
      newName,
      h(
        "button",
        {
          class: "mc-btn primary",
          onclick: async () => {
            const path = await create(newName.value || "style", "");
            if (!path) return;
            newName.value = "";
            select(path);
          },
        },
        "New",
      ),
    ),
    h(
      "div",
      { class: "mc-bar", style: { padding: "0 12px 10px" } },
      h(
        "button",
        {
          class: "mc-btn",
          title: "A new file from the text in your clipboard",
          onclick: async () => {
            const text = await navigator.clipboard.readText().catch(() => null);
            if (!text) return toast("Nothing to paste. Make a new file and paste into it instead.");
            const path = await create("pasted", text);
            if (path) select(path);
          },
        },
        "Paste",
      ),
      h("button", { class: "mc-btn", onclick: () => picker.click() }, "Import"),
    ),
    list,
  );

  const win = panel({
    title: "CSS manager",
    actions: [h("button", { class: "mc-btn", onclick: () => call("files.reveal", { dir: "css" }) }, "Open folder")],
    onDrop: importFiles,
    onClose: () => {
      flush();
      const was = previewing;
      previewing = null;
      if (was) apply(was);
    },
  });
  win.body.append(side, h("div", { class: "mc-main" }, empty, bar, editor.el));
  select(null);
  refresh();
}

const mod = {
  id: "cssManager",
  name: "CSS manager",
  desc: "Your own stylesheets, applied after Krunker's. Write, paste or import several and switch between them.",
  category: "Look",
  live: true,
  settings: [
    { key: "open", label: "Your stylesheets", desc: "Edit with live preview; files live in the css folder of Mercury's data.", type: "action", button: "Open manager", primary: true, run: openManager },
    { key: "active", type: "hidden", default: [] },
  ],
  init: applyAll,
};

const reapply = () => document.readyState !== "loading" && applyAll();
settings.onChange("cssManager.enabled", reapply);
settings.onChange(registry.PERFORMANCE_ONLY, reapply);
export default mod;
