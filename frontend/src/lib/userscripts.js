// Pure helpers for userscripts (no DOM): metadata, format detection, and turning a script's own settings into
// Mercury setting definitions. Two formats, from their public docs:
// - Crankshaft: a function body run with a custom `this`; `// ==UserScript==` metadata; `this.settings`
//   ({title, desc, type: bool|num|sel|color|keybind, value, min, max, step, opts, changed}); `this.unload`.
// - idkr: CommonJS, `module.exports = {name, version, Author, description, locations, settings, run(config)}`;
//   settings ({name, cat, type: checkbox|slider|select|text, val, min, max, step, options, placeholder, info, set}).

/** `// ==UserScript==` block → {name, author, version, desc, src, license, runAt, priority}. */
export function parseMeta(code) {
  const meta = { runAt: "document-end", priority: 0 };
  const block = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/.exec(code);
  if (!block) return meta;
  for (const line of block[1].split(/\r?\n/)) {
    const m = /^\s*\/\/\s*@([\w-]+)\s+(.*?)\s*$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "run-at" || key === "runAt") meta.runAt = value === "document-start" ? "document-start" : "document-end";
    else if (key === "priority") meta.priority = Number.parseInt(value, 10) || 0;
    else if (["name", "author", "version", "desc", "src", "license"].includes(key)) meta[key] = value;
  }
  return meta;
}

/** "idkr" for CommonJS scripts, otherwise "crankshaft" (which also runs plain scripts). */
export const formatOf = (code) => (/\bmodule\.exports\b/.test(code) ? "idkr" : "crankshaft");

/** Run order: higher priority first, then file name. */
export const runOrder = (a, b) => (b.meta.priority ?? 0) - (a.meta.priority ?? 0) || a.file.localeCompare(b.file);

/** Crankshaft keybind {shift, ctrl, alt, key} (event.key) ↔ Mercury combo "Ctrl+Alt+K" (event.code style). */
export function comboFromKeybind(bind) {
  if (!bind?.key) return "";
  const key = bind.key.length === 1 ? bind.key.toUpperCase() : bind.key;
  return [bind.ctrl && "Ctrl", bind.alt && "Alt", bind.shift && "Shift", key].filter(Boolean).join("+");
}

export function keybindFromCombo(combo) {
  const parts = (combo || "").split("+");
  const key = parts.pop() ?? "";
  return { ctrl: parts.includes("Ctrl"), alt: parts.includes("Alt"), shift: parts.includes("Shift"), key: key.length === 1 ? key.toLowerCase() : key };
}

/**
 * A script's settings as Mercury definitions: [{key, def, toScript, fromScript}], where def is a Mercury setting
 * definition without its id, and toScript converts a stored value to what the script expects.
 */
export function mapSettings(format, settings) {
  if (!settings || typeof settings !== "object") return [];
  return Object.entries(settings).flatMap(([key, s]) => {
    if (!s || typeof s !== "object") return [];
    const same = (v) => v;
    if (format === "crankshaft") {
      const base = { label: String(s.title ?? key), desc: s.desc };
      switch (s.type) {
        case "bool": return [{ key, def: { ...base, type: "bool", default: !!s.value }, toScript: same }];
        case "num": return [{ key, def: { ...base, type: "number", min: s.min ?? 0, max: s.max ?? 100, step: s.step ?? 1, default: Number(s.value) }, toScript: same }];
        case "sel": return [{ key, def: { ...base, type: "select", options: (s.opts ?? []).map(String), default: String(s.value) }, toScript: same }];
        case "color": return [{ key, def: { ...base, type: "color", default: String(s.value) }, toScript: same }];
        case "keybind": return [{ key, def: { ...base, type: "key", default: comboFromKeybind(s.value) }, toScript: keybindFromCombo }];
        default: return [];
      }
    }
    const base = { label: String(s.name ?? key), desc: s.info };
    switch (s.type) {
      case "checkbox": return [{ key, def: { ...base, type: "bool", default: !!s.val }, toScript: same }];
      case "slider": return [{ key, def: { ...base, type: "number", min: Number(s.min ?? 0), max: Number(s.max ?? 100), step: Number(s.step ?? 1), default: Number(s.val) }, toScript: same }];
      case "select": return [{ key, def: { ...base, type: "select", options: Object.entries(s.options ?? {}), default: String(s.val) }, toScript: same }];
      case "text": return [{ key, def: { ...base, type: "text", placeholder: s.placeholder, default: String(s.val ?? "") }, toScript: same }];
      default: return [];
    }
  });
}

/** A file name safe to use inside setting ids. */
export const scriptId = (file) => file.replace(/\.js$/i, "").replace(/[^\w-]/g, "_");
