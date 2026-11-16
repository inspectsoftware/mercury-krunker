// Chat logs: every chat line, the last 2000 across lobbies (Krunker reloads the page per lobby, so they live in
// localStorage), and a window to filter by player, search and copy them.

import { css, h, toast, waitFor } from "../core/dom.js";
import { onHotkey } from "../core/hotkeys.js";
import { capped, filterLog, formatLine, parseLine } from "../lib/chat.js";

const KEY = "mercury:chatlog";
const MAX = 2000;
let log = load();
let pending = [];
let overlay = null;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(saved)) return saved;
  } catch {}
  return [];
}

function flush() {
  if (!pending.length) return;
  log = capped(load(), pending, MAX);
  pending = [];
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch (e) {
    console.warn("[mercury] chat log not saved:", e);
  }
}

const lobby = () => new URLSearchParams(location.search).get("game") ?? "";

function onLine(line) {
  const item = line.querySelector?.(".chatItem");
  if (!item) return;
  // Without the timestamps Better chat adds.
  const copy = item.cloneNode(true);
  copy.querySelectorAll(".mc-ts").forEach((e) => e.remove());
  const { name, text } = parseLine(copy.textContent);
  if (!text) return;
  pending.push({ t: Date.now(), lobby: lobby(), name, text });
  clearTimeout(onLine.timer);
  onLine.timer = setTimeout(flush, 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.body.appendChild(h("textarea", { style: { position: "fixed", opacity: "0" } }));
    area.value = text;
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function close() {
  overlay?.remove();
  overlay = null;
  window.removeEventListener("keydown", onEscape, true);
}

function onEscape(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  close();
}

function open() {
  if (overlay) return close();
  flush();
  document.exitPointerLock?.();
  const player = h("input", { class: "mc-input", placeholder: "Player", list: "mc-log-players", oninput: render });
  const search = h("input", { class: "mc-input", placeholder: "Search", oninput: render });
  const count = h("span", { class: "mc-log-count" });
  const list = h("div", { class: "mc-log-list" });
  const players = h("datalist", { id: "mc-log-players" }, [...new Set(log.map((l) => l.name).filter(Boolean))].sort().map((n) => h("option", { value: n })));
  let shown = [];
  function render() {
    shown = filterLog(log, { player: player.value, query: search.value });
    count.textContent = `${shown.length} of ${log.length}`;
    const rows = [];
    let lastLobby = null;
    for (const line of shown) {
      if (line.lobby !== lastLobby) rows.push(h("div", { class: "mc-log-lobby" }, line.lobby || "Lobby"));
      lastLobby = line.lobby;
      rows.push(
        h(
          "div",
          { class: "mc-log-line", title: "Click to copy", onclick: () => copyText(formatLine(line)).then(() => toast("Line copied.", 1500)) },
          h("span", { class: "mc-log-time" }, formatLine(line).slice(0, 19)),
          line.name && h("b", {}, `${line.name}: `),
          line.text,
        ),
      );
    }
    list.replaceChildren(...rows);
    list.scrollTop = list.scrollHeight;
  }
  const copyAll = () => copyText(shown.map(formatLine).join("\n")).then(() => toast(`${shown.length} lines copied.`));
  const clear = () => {
    if (!confirm("Delete the whole chat log?")) return;
    log = [];
    localStorage.removeItem(KEY);
    render();
  };
  overlay = h(
    "div",
    { class: "mc-overlay", onmousedown: (e) => e.target === overlay && close() },
    h(
      "div",
      { class: "mc-log-window" },
      h(
        "div",
        { class: "mc-log-head" },
        h("div", { class: "mc-title" }, h("b", {}, "CHAT"), " LOGS"),
        player,
        search,
        count,
        h("button", { class: "mc-btn primary", onclick: copyAll }, "Copy shown"),
        h("button", { class: "mc-btn", onclick: clear }, "Clear"),
        h("button", { class: "mc-x", title: "Close", onclick: close }, "×"),
        players,
      ),
      list,
    ),
  );
  for (const type of ["keydown", "keyup", "keypress"]) overlay.addEventListener(type, (e) => e.stopPropagation());
  window.addEventListener("keydown", onEscape, true);
  document.body.append(overlay);
  render();
  search.focus();
}

css(
  `.mc-log-window { width: min(1000px, 94vw); height: min(720px, 90vh); display: flex; flex-direction: column; background: var(--mc-window);
     border-radius: 6px; overflow: hidden; box-shadow: 2px 2px 8px rgba(0, 0, 0, 0.5); }
   .mc-log-head { display: flex; align-items: center; gap: 10px; padding: 8px 14px 8px 18px; background: var(--mc-head); border-top: 4px solid rgba(255, 255, 255, 0.3); }
   .mc-log-head .mc-title { margin-right: auto; }
   .mc-log-head .mc-input { min-width: 0; width: 170px; }
   .mc-log-count { color: var(--mc-muted); font-size: 15px; white-space: nowrap; font-variant-numeric: tabular-nums; }
   .mc-log-list { flex: 1; overflow-y: auto; padding: 6px 18px 14px; font-size: 16px; user-select: text; }
   .mc-log-line { padding: 3px 6px; border-radius: var(--mc-radius); cursor: copy; overflow-wrap: anywhere; }
   .mc-log-line:hover { background: rgba(0, 0, 0, 0.2); }
   .mc-log-line b { color: var(--mc-gold); font-weight: 400; }
   .mc-log-time { color: var(--mc-muted); margin-right: 8px; font-variant-numeric: tabular-nums; }
   .mc-log-lobby { margin: 14px 0 4px; font-size: 16px; color: var(--mc-muted); border-bottom: 1px solid var(--mc-line); }`,
  "mercury-chat-logs",
);

export default {
  id: "chatLogs",
  name: "Chat logs",
  desc: "Keeps the last 2000 chat lines across lobbies, with a window to filter by player, search and copy.",
  category: "Chat",
  live: true,
  settings: [{ key: "key", label: "Open chat logs", type: "key", default: "F1" }],
  async init() {
    onHotkey("chatLogs.key", open);
    addEventListener("pagehide", flush);
    const list = await waitFor("#chatList");
    for (const line of list.children) onLine(line);
    new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(onLine))).observe(list, { childList: true });
  },
};
