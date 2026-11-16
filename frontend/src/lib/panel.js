// A Mercury window over the game for the managers (swapper, CSS manager). Esc or a click outside closes it; keys
// typed in it never reach Krunker. With `onDrop`, files dropped on it are handed over.

import { css, h } from "../core/dom.js";
import panelCss from "./panel.css";

export function panel({ title, actions = [], onDrop, onClose }) {
  css(panelCss, "mercury-panel");
  document.exitPointerLock?.();
  const body = h("div", { class: "mc-pbody" });
  const win = h(
    "div",
    { class: "mc-panel" },
    h("div", { class: "mc-head" }, h("div", { class: "mc-title" }, h("b", {}, "MERCURY"), ` ${title}`), h("div", { class: "mc-actions" }, ...actions), h("button", { class: "mc-x", title: "Close", onclick: () => close() }, "×")),
    body,
  );
  const overlay = h("div", { class: "mc-overlay", onmousedown: (e) => e.target === overlay && close() }, win);
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  function close() {
    window.removeEventListener("keydown", onKey, true);
    overlay.remove();
    onClose?.();
  }
  for (const type of ["keydown", "keyup", "keypress"]) overlay.addEventListener(type, (e) => e.stopPropagation());
  // A file dropped anywhere else would make the browser open it in place of the game.
  overlay.addEventListener("dragover", (e) => {
    e.preventDefault();
    win.classList.toggle("dragover", !!onDrop && win.contains(e.target));
  });
  overlay.addEventListener("dragleave", (e) => !overlay.contains(e.relatedTarget) && win.classList.remove("dragover"));
  overlay.addEventListener("drop", (e) => {
    e.preventDefault();
    win.classList.remove("dragover");
    if (onDrop && e.dataTransfer.files.length) onDrop([...e.dataTransfer.files]);
  });
  window.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  return { body, close };
}
