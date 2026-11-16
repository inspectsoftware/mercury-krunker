// Small DOM helpers shared by the modules.

/** h("div", {class: "x", onclick}, ...children): builds an element. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key in el && key !== "list") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** Runs fn once <html> exists (at document start it may not yet). */
function whenRoot(fn) {
  if (document.documentElement) return fn();
  const observer = new MutationObserver(() => {
    if (!document.documentElement) return;
    observer.disconnect();
    fn();
  });
  observer.observe(document, { childList: true });
}

/** Adds a stylesheet (works at document start); returns it so callers can update or remove it. */
export function css(text, id) {
  const style = (id && document.getElementById(id)) || h("style", { id });
  style.textContent = text;
  if (!style.isConnected) whenRoot(() => (document.head ?? document.documentElement).append(style));
  return style;
}

/** Resolves with the first element matching `selector`, waiting for it to appear. */
export function waitFor(selector, root = document) {
  const found = root.querySelector(selector);
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
  });
}

let toastHolder;
/** A short message in the corner. */
export function toast(text, ms = 3500) {
  toastHolder ??= document.body.appendChild(h("div", { class: "mc-toasts" }));
  const el = toastHolder.appendChild(h("div", { class: "mc-toast" }, text));
  setTimeout(() => el.remove(), ms);
}
