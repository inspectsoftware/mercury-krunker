// Userscripts (M10): .js files in <data>/scripts, in Crankshaft or idkr format (lib/userscripts.js), each off until
// the player turns it on. Scripts run in the page with no access to Mercury's host bridge. Enabled scripts are
// copied into localStorage, so "document-start" scripts run before Krunker's own on the next load; the copy is
// refreshed from disk on every load.

import { call } from "../core/host.js";
import { css, h, toast } from "../core/dom.js";
import * as settings from "../core/settings.js";
import { panel } from "../lib/panel.js";
import { formatOf, mapSettings, parseMeta, runOrder, scriptId } from "../lib/userscripts.js";
import classRoulette from "../examples/classRoulette.userjs";

const id = "userscripts";
const ACTIVE = `${id}.active`;
const CACHE = "mercury:userscripts";
const EXAMPLES_FLAG = "mercury:userscripts:examples";
const EXAMPLES = { "classRoulette.js": classRoulette };
// Captured at document start: Krunker later disables most console methods.
const pristine = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
const running = new Map(); // file → { unload? }

const active = () => new Set(settings.get(ACTIVE) ?? []);
const readCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CACHE)) ?? {};
  } catch {
    return {};
  }
};
const writeCache = (cache) => {
  try {
    localStorage.setItem(CACHE, JSON.stringify(cache));
  } catch (error) {
    pristine.warn("[mercury] userscripts not cached:", error);
  }
};

/** Crankshaft's this._css(css, identifier, value): value true adds, false removes, "toggle" or nothing toggles. */
const scriptCss = (file) => (text, identifier, value) => {
  const styleId = `mc-us-${scriptId(file)}-${identifier}`;
  const on = value === undefined || value === "toggle" ? !document.getElementById(styleId) : !!value;
  if (on) css(text, styleId);
  else document.getElementById(styleId)?.remove();
};

/** Shows a script's own settings in the Userscripts folder of the Mercury tab and keeps the script told. */
function expose(file, name, format, scriptSettings, apply) {
  const ids = {};
  for (const { key, def, toScript } of mapSettings(format, scriptSettings)) {
    const settingId = `${id}.${scriptId(file)}.${key}`;
    ids[key] = settingId;
    settings.define({ ...def, id: settingId, label: `${name}: ${def.label}`, category: "Userscripts", module: id });
    const raw = scriptSettings[key];
    const current = settings.get(settingId);
    if (format === "idkr") apply(raw, toScript(current), true);
    else if (current !== def.default) apply(raw, toScript(current));
    settings.onChange(settingId, (value) => apply(raw, toScript(value), false));
  }
  return ids;
}

function run(file, code) {
  if (running.has(file)) return;
  const meta = parseMeta(code);
  const name = meta.name ?? file;
  const source = `${code}\n//# sourceURL=mercury-userscripts/${encodeURIComponent(file)}`;
  try {
    if (formatOf(code) === "idkr") {
      const module = { exports: {} };
      new Function("module", "exports", "require", source)(module, module.exports, () => ({}));
      const script = module.exports ?? {};
      const locations = script.locations ?? ["all"];
      if (!locations.includes("all") && !locations.includes("game")) return;
      const ids = expose(file, script.name ?? name, "idkr", script.settings, (s, value, init) => s?.set?.(value, init));
      script.run?.({ get: (key) => settings.get(ids[key] ?? key), set: (key, value) => settings.set(ids[key] ?? key, value) });
      running.set(file, {});
    } else {
      const self = { _console: pristine, _css: scriptCss(file) };
      const out = new Function(source).call(self) ?? self;
      expose(file, name, "crankshaft", out.settings, (s, value) => {
        s.value = value;
        s.changed?.(value);
      });
      running.set(file, { unload: out.unload });
    }
  } catch (error) {
    pristine.error(`[mercury] userscript ${file} failed`, error);
    toast(`Userscript "${name}" failed: ${error.message}`);
  }
}

async function listScripts() {
  const files = await call("files.list", { dir: "scripts" });
  return files.map((f) => f.path).filter((p) => /\.js$/i.test(p) && !p.includes("/"));
}

async function installExamples() {
  if (localStorage.getItem(EXAMPLES_FLAG)) return;
  const present = new Set(await listScripts());
  for (const [file, text] of Object.entries(EXAMPLES)) {
    if (!present.has(file)) await call("files.write", { dir: "scripts", path: file, text });
  }
  localStorage.setItem(EXAMPLES_FLAG, "1");
}

async function setActive(file, on) {
  const next = active();
  if (on) next.add(file);
  else next.delete(file);
  settings.set(ACTIVE, [...next]);
  const cache = readCache();
  if (on) {
    const code = await call("files.read", { dir: "scripts", path: file });
    cache[file] = code;
    run(file, code);
    if (parseMeta(code).runAt === "document-start") toast("This script runs at page start: reload (F5) for it to apply fully.");
  } else {
    delete cache[file];
    const unload = running.get(file)?.unload;
    running.delete(file);
    if (typeof unload === "function") unload();
    else toast("The script has no unload: reload (F5) to remove it fully.");
  }
  writeCache(cache);
}

async function manage() {
  const win = panel({
    title: "Userscripts",
    actions: [
      h("button", { class: "mc-btn", onclick: () => call("files.reveal", { dir: "scripts" }) }, "Open folder"),
      h("button", { class: "mc-btn", onclick: () => location.reload() }, "Reload page"),
    ],
    onDrop: async (dropped) => {
      for (const file of dropped.filter((f) => /\.js$/i.test(f.name))) {
        await call("files.write", { dir: "scripts", path: file.name.replace(/[\\/]/g, "_"), text: await file.text() });
      }
      render();
    },
  });
  async function render() {
    const on = active();
    const files = await listScripts();
    const rows = await Promise.all(
      files.map(async (file) => {
        const code = await call("files.read", { dir: "scripts", path: file });
        const meta = parseMeta(code);
        const box = h("input", { type: "checkbox", checked: on.has(file), onchange: (e) => setActive(file, e.target.checked) });
        return h(
          "div",
          { class: "mc-list-row" },
          box,
          h(
            "div",
            { class: "mc-grow" },
            h("b", {}, meta.name ?? file),
            meta.version && ` ${meta.version}`,
            meta.author && h("span", { class: "mc-hint" }, ` by ${meta.author}`),
            h("span", { class: "mc-tag" }, formatOf(code)),
            meta.runAt === "document-start" && h("span", { class: "mc-tag" }, "page start"),
            meta.desc && h("div", { class: "mc-hint" }, meta.desc),
            h("div", { class: "mc-hint" }, file),
          ),
          h("button", {
            class: "mc-btn",
            onclick: async () => {
              if (!confirm(`Delete ${file}?`)) return;
              if (on.has(file)) await setActive(file, false);
              await call("files.delete", { dir: "scripts", path: file });
              render();
            },
          }, "Delete"),
        );
      }),
    );
    win.body.replaceChildren(
      h("div", { class: "mc-hint", style: { padding: "10px 12px" } },
        "Scripts run inside Krunker with full access to the page. Load only scripts you trust, and never ones that give an advantage: FRVR bans cheating. Drop .js files here to add them; new scripts start off."),
      ...(rows.length ? rows : [h("div", { class: "mc-hint", style: { padding: "12px" } }, "No scripts yet.")]),
    );
  }
  render();
}

export default {
  id,
  name: "Userscripts",
  desc: "Runs .js files from Mercury's scripts folder, in Crankshaft or idkr format. Each script starts off.",
  category: "Userscripts",
  settings: [
    { key: "manage", label: "Manage userscripts", desc: "Turn scripts on and off, add (drop .js files) or delete them.", type: "action", button: "Manage", run: manage },
    { key: "active", type: "hidden", default: [] },
  ],
  early() {
    const on = active();
    const scripts = Object.entries(readCache())
      .map(([file, code]) => ({ file, code, meta: parseMeta(code) }))
      .filter((s) => on.has(s.file) && s.meta.runAt === "document-start")
      .sort(runOrder);
    for (const s of scripts) run(s.file, s.code);
  },
  async init() {
    try {
      await installExamples();
      const on = active();
      const cache = {};
      const scripts = [];
      for (const file of await listScripts()) {
        if (!on.has(file)) continue;
        const code = await call("files.read", { dir: "scripts", path: file });
        cache[file] = code;
        scripts.push({ file, code, meta: parseMeta(code) });
      }
      writeCache(cache);
      // Document-start scripts already ran from the cache; one enabled since the last load runs now, late.
      for (const s of scripts.sort(runOrder)) run(s.file, s.code);
    } catch (error) {
      pristine.error("[mercury] userscripts could not load", error);
    }
  },
};
