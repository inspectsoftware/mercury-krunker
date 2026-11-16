// Pure chat helpers (no DOM): parsing Krunker's chat lines, finding links, filtering the chat log.

/** Krunker wraps names and messages in direction marks (U+200E/U+200F); they break matching and copying. */
export const clean = (text) => String(text ?? "").replace(/[‎‏]/g, "").replace(/\s+/g, " ").trim();

/** "Name: message" → {name, text}; a line without a speaker (joins, leaves, unboxings) → {name: "", text}. */
export function parseLine(raw) {
  const line = clean(raw);
  const match = /^([^\s:]{1,40}(?: \[[^\]\s]{1,8}\])?): (.*)$/.exec(line);
  return match ? { name: match[1], text: match[2] } : { name: "", text: line };
}

const LINK = /(?:https?:\/\/|www\.)[^\s<>"'‎‏]+|\bkrunker\.io\/[^\s<>"'‎‏]*/gi;

/** Splits text into plain parts and links: [{text}, {text, url}, ...]. A link without a scheme gets https://. */
export function splitLinks(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    let found = match[0].replace(/[.,!?)\]]+$/, "");
    if (!found) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: found, url: /^https?:\/\//i.test(found) ? found : `https://${found}` });
    last = match.index + found.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The game-page link (lobby, map, mod) to load in this window, or null. Same rule as the host's mods::game_link. */
export function gameLink(url) {
  const match = /^https?:\/\/(?:www\.)?krunker\.io(\/?)([?#][^\s]*)?$/i.exec(url);
  return match ? `https://krunker.io/${match[2] ?? ""}` : null;
}

/** Appends `items` and keeps the newest `max`. */
export const capped = (list, items, max) => [...list, ...items].slice(-max);

/** Log lines matching a player (exact, case-insensitive; "" = everyone) and a search text (in name or message). */
export function filterLog(lines, { player = "", query = "" } = {}) {
  const p = player.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  return lines.filter(
    (l) => (!p || l.name.toLowerCase() === p || l.name.toLowerCase().startsWith(`${p} [`)) && (!q || `${l.name} ${l.text}`.toLowerCase().includes(q)),
  );
}

const pad = (n) => String(n).padStart(2, "0");

/** "2026-11-16 14:03:09 Name: text" (local time), one line for copying. */
export function formatLine(line) {
  const d = new Date(line.t);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${stamp} ${line.name ? `${line.name}: ` : ""}${line.text}`;
}

export const clock = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
