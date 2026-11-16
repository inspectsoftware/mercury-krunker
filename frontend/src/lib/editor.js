// A code editor without a library: a transparent textarea over a highlighted copy of its text (lib/highlight.js).

import { h } from "../core/dom.js";
import { escapeHtml } from "./highlight.js";

/** {el, area, set(text)}; `onInput(text)` on every edit. `highlight` turns text into HTML (default: plain). */
export function codeEditor({ value = "", highlight = escapeHtml, onInput }) {
  const code = h("code");
  const pre = h("pre", { "aria-hidden": "true" }, code);
  const area = h("textarea", { value });
  area.spellcheck = false; // h() skips false props
  let frame = 0;
  const paint = () => {
    frame = 0;
    code.innerHTML = `${highlight(area.value)}\n`; // the newline keeps a trailing empty line visible
    pre.scrollTop = area.scrollTop;
    pre.scrollLeft = area.scrollLeft;
  };
  area.addEventListener("input", () => {
    frame ||= requestAnimationFrame(paint);
    onInput?.(area.value);
  });
  area.addEventListener("scroll", () => {
    pre.scrollTop = area.scrollTop;
    pre.scrollLeft = area.scrollLeft;
  });
  area.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    document.execCommand("insertText", false, "  "); // keeps the textarea's undo history
  });
  paint();
  return {
    el: h("div", { class: "mc-code" }, pre, area),
    area,
    set(text) {
      area.value = text;
      paint();
    },
  };
}
