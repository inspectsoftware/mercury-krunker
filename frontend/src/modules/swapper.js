// Resource swapper manager. The host (src/resources.rs) serves <data>/swap/<path> in place of
// https://*.krunker.io/<path>; this window lists those files, adds them by drag and drop, edits text ones and deletes
// them. CSS swaps apply at once (the page reloads that stylesheet); everything else on the next lobby.

import { h, toast } from "../core/dom.js";
import { call } from "../core/host.js";
import * as ui from "../core/ui.js";
import { codeEditor } from "../lib/editor.js";
import { highlightCss } from "../lib/highlight.js";
import { panel } from "../lib/panel.js";
import { guessPath, swapPath } from "../lib/swapPaths.js";

const TEXT = /\.(css|json|txt|obj|svg|glsl)$/i;
const isKrunker = (host) => host === "krunker.io" || host.endsWith(".krunker.io");

/** Files the game loaded from *.krunker.io since this page load, as swap paths. */
function requested() {
  const paths = new Set();
  for (const entry of performance.getEntriesByType("resource")) {
    try {
      const url = new URL(entry.name);
      const path = isKrunker(url.hostname) && swapPath(url.pathname);
      if (path && /\.\w{2,5}$/.test(path)) paths.add(path);
    } catch {}
  }
  return [...paths].sort();
}

/** Makes the page fetch a Krunker stylesheet again, so a new, edited or deleted swap shows right away. */
function reloadCss(path) {
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const url = new URL(link.href, location.href);
    if (!isKrunker(url.hostname) || url.pathname.slice(1) !== path) continue;
    url.searchParams.set("mercury", Date.now());
    const fresh = link.cloneNode();
    fresh.href = url.href;
    fresh.onload = fresh.onerror = () => link.remove();
    link.after(fresh);
  }
}

const base64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function openManager() {
  ui.close();
  const seen = requested();
  let swaps = [];
  const queue = []; // dropped files still waiting for a target path
  let replaceTarget = null; // a requested path chosen with "Replace…"
  let saveTimer = 0;
  let editing = null; // the text swap open in the editor

  const side = h("div", { class: "mc-scroll" });
  const main = h("div", { class: "mc-main" });
  const picker = h("input", { type: "file", multiple: true, onchange: () => add([...picker.files], replaceTarget) });
  const datalist = h("datalist", { id: "mc-swap-seen" }, ...seen.map((p) => h("option", { value: p })));

  async function refresh() {
    swaps = await call("files.list", { dir: "swap" }).catch(() => []);
    renderSide();
    if (!editing) renderMain();
  }

  async function write(path, file) {
    try {
      await call("files.write", { dir: "swap", path, base64: await base64(file) });
      if (path.endsWith(".css")) reloadCss(path);
      toast(path.endsWith(".css") ? `${path} swapped.` : `${path} swapped. It shows on the next lobby (F5).`);
    } catch (e) {
      toast(`Not saved: ${e.message}`);
    }
  }

  /** Dropped or picked files (`target`: the path picked with "Replace…"). Sure ones go straight in, the rest wait for an answer. */
  async function add(files, target) {
    replaceTarget = null;
    if (target && files.length === 1) await write(target, files[0]);
    else {
      for (const file of files) {
        const guess = guessPath(file.name, seen);
        if (guess.sure) await write(guess.path, file);
        else queue.push({ file, guess: guess.path });
      }
    }
    picker.value = "";
    editing = null;
    refresh();
  }

  function renderSide() {
    side.replaceChildren(
      h("div", { class: "mc-section" }, `Your swaps (${swaps.length})`),
      ...swaps.map(({ path, size: bytes }) => {
        let armed = 0;
        const del = h("button", { class: "mc-btn danger", title: "Delete this swap" }, "×");
        del.onclick = async () => {
          if (!armed) {
            del.textContent = "Delete?";
            armed = setTimeout(() => ((armed = 0), (del.textContent = "×")), 3000);
            return;
          }
          await call("files.delete", { dir: "swap", path }).catch((e) => toast(e.message));
          if (path.endsWith(".css")) reloadCss(path);
          if (editing === path) editing = null;
          refresh();
        };
        return h(
          "div",
          { class: `mc-list-row${editing === path ? " on" : ""}` },
          h(
            "div",
            { class: "mc-grow", title: TEXT.test(path) ? "Edit" : `Replaces https://*.krunker.io/${path}`, onclick: () => TEXT.test(path) && edit(path) },
            h("div", { class: "mc-path" }, path),
            h("div", { class: "mc-hint" }, size(bytes), TEXT.test(path) ? " · click to edit" : ""),
          ),
          del,
        );
      }),
    );
    if (!swaps.length) side.append(h("div", { class: "mc-hint", style: { padding: "0 12px" } }, "None yet. Drop files on this window."));
  }

  function renderMain() {
    const swapped = new Set(swaps.map((s) => s.path));
    const filter = h("input", { class: "mc-input", placeholder: "Filter, e.g. textures/ or .mp3", oninput: () => fill() });
    const rows = h("div", { class: "mc-scroll" });
    const fill = () => {
      const q = filter.value.trim().toLowerCase();
      rows.replaceChildren(
        ...seen
          .filter((p) => p.toLowerCase().includes(q))
          .map((path) =>
            h(
              "div",
              { class: "mc-list-row" },
              h("div", { class: "mc-grow mc-path" }, path),
              swapped.has(path) && h("span", { class: "mc-tag ok" }, "swapped"),
              h("button", { class: "mc-btn", onclick: () => ((replaceTarget = path), picker.click()) }, "Replace…"),
            ),
          ),
      );
    };
    fill();
    main.replaceChildren(
      ...queue.slice(0, 1).map(askCard),
      h("div", { class: "mc-hint" }, "Drop images, sounds, models or CSS on this window. A file named like one the game loaded replaces that one; otherwise Mercury asks where it goes. CSS swaps apply at once, the rest on the next lobby (F5)."),
      h("div", { class: "mc-section", style: { margin: "6px 0 0" } }, `Loaded from krunker.io this session (${seen.length})`),
      h("div", { class: "mc-bar" }, filter),
      rows,
    );
  }

  function askCard({ file, guess }) {
    const input = h("input", { class: "mc-input mc-path", value: guess, list: "mc-swap-seen" });
    const next = () => {
      queue.shift();
      renderMain();
    };
    const save = async () => {
      const path = swapPath(input.value);
      if (!path) return toast("That isn't a path Mercury can swap (Krunker's scripts are never swapped).");
      await write(path, file);
      next();
      refresh();
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && save());
    setTimeout(() => input.focus());
    return h(
      "div",
      { class: "mc-ask" },
      h("div", {}, "Which krunker.io file does ", h("b", {}, file.name), " replace?", queue.length > 1 ? h("span", { class: "mc-hint" }, ` (${queue.length - 1} more after this)`) : null),
      h("div", { class: "mc-bar" }, input, h("button", { class: "mc-btn primary", onclick: save }, "Swap"), h("button", { class: "mc-btn", onclick: next }, "Skip")),
    );
  }

  async function edit(path) {
    clearTimeout(saveTimer);
    let text;
    try {
      text = await call("files.read", { dir: "swap", path });
    } catch (e) {
      return toast(`Could not read ${path}: ${e.message}`);
    }
    editing = path;
    renderSide();
    const status = h("span", { class: "mc-hint" });
    const editor = codeEditor({
      value: text,
      highlight: path.endsWith(".css") ? highlightCss : undefined,
      onInput: (value) => {
        status.textContent = "Saving…";
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
          try {
            await call("files.write", { dir: "swap", path, text: value });
            if (path.endsWith(".css")) reloadCss(path);
            status.textContent = "Saved";
          } catch (e) {
            status.textContent = `Not saved: ${e.message}`;
          }
        }, 500);
      },
    });
    const back = () => {
      editing = null;
      renderSide();
      renderMain();
    };
    main.replaceChildren(h("div", { class: "mc-bar" }, h("div", { class: "mc-path", style: { flex: "1" } }, path), status, h("button", { class: "mc-btn", onclick: back }, "Back")), editor.el);
    editor.area.focus();
  }

  const win = panel({
    title: "Resource swapper",
    actions: [h("button", { class: "mc-btn primary", onclick: () => ((replaceTarget = null), picker.click()) }, "Add files"), h("button", { class: "mc-btn", onclick: () => call("files.reveal", { dir: "swap" }) }, "Open folder")],
    onDrop: (files) => add(files),
  });
  win.body.append(h("div", { class: "mc-side" }, side), main, datalist);
  refresh();
}

export default {
  id: "swapper",
  name: "Resource swapper",
  desc: "Files in Mercury's swap folder replace Krunker's own: textures, sounds, models and CSS.",
  category: "Look",
  toggle: false,
  settings: [{ key: "open", label: "Swapped files", desc: "Add by drag and drop, edit text files, see what the game loaded.", type: "action", button: "Open manager", primary: true, run: openManager }],
};
