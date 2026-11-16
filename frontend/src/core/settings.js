// Settings: one flat map `"module.key": value`, defaults from the definitions. Kept in localStorage so every
// krunker.io page load (Krunker reloads on each lobby) starts with the latest values without waiting for the host,
// and saved to the host's settings.json, which the host reads at startup (engine flags) and exports.

import { bootSettings, call } from "./host.js";

const KEY = "mercury:settings";
const defs = new Map();
const listeners = new Map();
let values = load();
let saveTimer = 0;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === "object") return saved;
  } catch {}
  return { ...bootSettings };
}

/** Registers a setting definition: {id, label, type, default, ...}. */
export function define(def) {
  defs.set(def.id, def);
  return def;
}

export const definitions = () => [...defs.values()];

export function get(id) {
  return id in values ? values[id] : defs.get(id)?.default;
}

export function set(id, value) {
  if (value === get(id)) return;
  values[id] = value;
  persist();
  for (const fn of listeners.get(id) ?? []) fn(value);
}

export function onChange(id, fn) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(fn);
}

export const all = () => ({ ...values });

/** Replaces every value (settings import) and saves right away. */
export async function replaceAll(next) {
  values = { ...next };
  localStorage.setItem(KEY, JSON.stringify(values));
  await call("settings.save", { settings: values });
}

function persist() {
  localStorage.setItem(KEY, JSON.stringify(values));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => call("settings.save", { settings: values }).catch((e) => console.warn("[mercury] settings not saved:", e)), 400);
}
