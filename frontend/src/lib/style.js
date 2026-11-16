// Stylesheets that come after all of Krunker's: the last children of <html>, after <body>, so they win ties with
// Krunker's rules however late Krunker adds its own. `order` keeps ours in a fixed order among themselves.

import { h } from "../core/dom.js";
import * as registry from "../core/modules.js";
import * as settings from "../core/settings.js";

/** Sets (or, with null text, removes) the late stylesheet `id`. Call it once the DOM is ready. */
export function lateCss(id, text, order) {
  let style = document.getElementById(id);
  if (text == null) return style?.remove();
  style ??= h("style", { id, "data-mc-order": order });
  if (style.textContent !== text) style.textContent = text;
  if (!style.isConnected) {
    const root = document.documentElement;
    root.insertBefore(style, [...root.children].find((el) => Number(el.dataset?.mcOrder) > order) ?? null);
  }
  return style;
}

/**
 * For CSS-only modules (declare `live: true`): the stylesheet follows `<id>.enabled` and "Performance only" without a
 * reload. `text()` gives the CSS. Returns `apply`, for init() and the module's own setting changes.
 */
export function liveCss(mod, order, text) {
  const apply = () => lateCss(`mc-css-${mod.id}`, registry.enabled(mod) ? text() : null, order);
  const later = () => document.readyState !== "loading" && apply();
  settings.onChange(`${mod.id}.enabled`, later);
  settings.onChange(registry.PERFORMANCE_ONLY, later);
  return apply;
}
