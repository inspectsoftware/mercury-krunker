// Pure helpers (no DOM) for the social modules: clan colors, the per-account match end message, Discord activity,
// mod links, ranked tiers.

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "TAG #ff8800" per line (also "TAG=#f80" or "[TAG] #f80") → Map of upper-case tag → color. Bad lines are skipped. */
export function parseClanColors(text) {
  const colors = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const match = /^\s*\[?([^\s=\[\]]{1,8})\]?\s*[=:]?\s*(#[0-9a-f]+)\s*$/i.exec(line);
    if (match && COLOR.test(match[2])) colors.set(match[1].toUpperCase(), match[2]);
  }
  return colors;
}

/** Splits text around the clan tags in `colors`: [{text}, {text: "[TAG]", color}, ...]; null when there is none. */
export function splitClanTags(text, colors) {
  if (!colors.size || !text.includes("[")) return null;
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(/\[([^\s\[\]]{1,8})\]/g)) {
    const color = colors.get(match[1].toUpperCase());
    if (!color) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[0], color });
    last = match.index + match[0].length;
  }
  if (!parts.length) return null;
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * The match end message, one per account. `current` is what Krunker would send now, `owner` the account it belongs
 * to, `saved` every account's message. Returns the new saved map and owner, and `apply`: the message to put into
 * Krunker (null: leave it). An account without a saved message sends nothing ("").
 */
export function syncEndMessage({ sub, owner, current, saved }) {
  const next = { ...saved };
  const remember = (account) => {
    if (current) next[account] = current;
    else delete next[account];
  };
  if (!sub) return { saved: next, owner, apply: null };
  if (!owner || owner === sub) {
    remember(sub);
    return { saved: next, owner: sub, apply: null };
  }
  remember(owner);
  return { saved: next, owner: sub, apply: next[sub] ?? "" };
}

/**
 * Krunker's getGameActivity() → the fields the host turns into Discord's activity.
 * {id, time (seconds left), user, class: {name}, map, mode, custom} → {details, state, end | start, joinUrl?}.
 */
export function discordActivity(game, { now = Date.now(), since = now, join = false } = {}) {
  if (!game || typeof game !== "object" || !game.mode) return null;
  const activity = {
    details: game.map ? `${game.mode} on ${game.map}` : String(game.mode),
    state: game.class?.name ? `Playing ${game.class.name}${game.custom ? " (custom game)" : ""}` : "In the menu",
  };
  // Round to 10 s so a ticking timer does not count as a change.
  if (game.time > 0) activity.end = Math.round((now + game.time * 1000) / 10000) * 10000;
  else activity.start = since;
  if (join && game.id && /^[A-Z]{2,4}:[a-z0-9]+$/i.test(game.id)) activity.joinUrl = `https://krunker.io/?game=${game.id}`;
  return activity;
}

/** `loadUserMod("name","url","id","author",1)` (any quote style, HTML entities already decoded) → {name, url}. */
export function parseLoadUserMod(onclick) {
  const match = /loadUserMod\(\s*(["'`])(.*?)\1\s*,\s*(["'`])(.*?)\3/.exec(String(onclick ?? ""));
  return match ? { name: match[2], url: match[4] } : null;
}

/** Krunker hosts the zip itself (the host downloads only these). */
export const krunkerHosted = (url) => /^https:\/\/(?:[a-z0-9-]+\.)*krunker\.io\//i.test(url);

/** "Gold 1500" per line → tiers sorted by MMR: [{name, mmr}]. */
export function parseTiers(text) {
  const tiers = [];
  for (const line of String(text ?? "").split("\n")) {
    const match = /^\s*(.+?)\s+(-?\d+)\s*$/.exec(line);
    if (match) tiers.push({ name: match[1], mmr: Number(match[2]) });
  }
  return tiers.sort((a, b) => a.mmr - b.mmr);
}

/** Where `mmr` stands: the tier it is in, the next one, and how far along (0..1). */
export function tierProgress(mmr, tiers) {
  let i = -1;
  while (i + 1 < tiers.length && tiers[i + 1].mmr <= mmr) i++;
  const tier = tiers[i] ?? null;
  const next = tiers[i + 1] ?? null;
  if (!next) return { tier, next: null, progress: 1, toGo: 0 };
  const from = tier?.mmr ?? 0;
  return { tier, next, progress: Math.max(0, Math.min(1, (mmr - from) / (next.mmr - from))), toGo: next.mmr - mmr };
}

/** The season of the newest match in a player's history (the game API's match_history), or null. */
export const latestSeason = (history) =>
  (history ?? []).reduce((best, m) => (Number.isInteger(m?.season) && m.season > (best ?? 0) ? m.season : best), null);
