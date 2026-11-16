// Feature modules. A module is {id, name, category, desc, perf, defaultOn, settings, early(), init()}:
// - every module gets an on/off setting `<id>.enabled` (unless toggle: false) and its settings become `<id>.<key>`;
// - early() runs at document start, before Krunker's scripts; init() once the DOM is ready;
// - "Performance only" (general.performanceOnly) turns off every module without `perf: true`, without touching the
//   player's own choices, so switching it back restores them.

import * as settings from "./settings.js";

export const PERFORMANCE_ONLY = "general.performanceOnly";
const modules = [];

export function register(mod) {
  if (mod.toggle !== false) {
    settings.define({
      id: `${mod.id}.enabled`,
      label: mod.name,
      desc: mod.desc,
      type: "bool",
      default: mod.defaultOn ?? true,
      category: mod.category,
      module: mod.id,
      isToggle: true,
      restart: mod.restart,
    });
  }
  for (const s of mod.settings ?? []) {
    settings.define({ ...s, id: `${mod.id}.${s.key}`, category: s.category ?? mod.category, module: mod.id });
  }
  modules.push(mod);
}

export const list = () => modules;
export const byId = (id) => modules.find((m) => m.id === id);

/** Shown in the settings window: everything, or only performance modules while "Performance only" is on. */
export function visible(mod) {
  return !mod || mod.perf || mod.core || !settings.get(PERFORMANCE_ONLY);
}

export function enabled(mod) {
  if (!visible(mod)) return false;
  return mod.toggle === false || !!settings.get(`${mod.id}.enabled`);
}

/** The module's own setting `<id>.<key>`. */
export const opt = (mod, key) => settings.get(`${mod.id}.${key}`);

export function start(phase) {
  for (const mod of modules) {
    if (!mod[phase] || !enabled(mod)) continue;
    try {
      mod[phase]();
    } catch (error) {
      console.error(`[mercury] ${mod.id}.${phase} failed`, error);
    }
  }
}
