// Matchmaker: one key (F6) finds the best public lobby for the player's filters and offers to join it. "Best" is
// the lowest-ping region first (Mercury's real ping), then the fullest lobby. Full lobbies and the current one never
// count. The game list is read only when the key is pressed (cached 10 s), never in the background.

import { h, toast } from "../core/dom.js";
import { onHotkey } from "../core/hotkeys.js";
import * as registry from "../core/modules.js";
import * as settings from "../core/settings.js";
import { MODES, REGIONS, clock, modeName, parseLobby, rankLobbies, regionName, splitList } from "../lib/lobbies.js";
import { game } from "../lib/krunker.js";
import { panel, pingTag } from "../lib/floating.js";
import { regionPings } from "../lib/pings.js";

const id = "matchmaker";
const opt = (key) => settings.get(`${id}.${key}`);
const GAME_ID = /^[A-Z]{2,5}:[a-z0-9]{3,8}$/;
const LEARNED = "mercury:modeNames";
let listCache = { t: 0, list: null };
let busy = false;

const learned = () => {
  try {
    return JSON.parse(localStorage.getItem(LEARNED)) ?? {};
  } catch {
    return {};
  }
};

function filters() {
  return {
    regions: opt("regions") ?? [],
    modes: opt("modes") ?? [],
    maps: splitList(opt("maps")),
    minPlayers: opt("minPlayers"),
    maxPlayers: opt("maxPlayers"),
    minTimeLeft: opt("minTimeLeft") * 60,
    custom: opt("custom"),
  };
}

async function gameList() {
  if (Date.now() - listCache.t > 10000) listCache = { t: Date.now(), list: await game.matchmaker.gameList() };
  return listCache.list;
}

/** Krunker names the current lobby's mode; remember names for ids newer than Mercury's table. */
function learnMode(list, activity) {
  const entry = list.games.find((g) => g[0] === activity?.id);
  const mode = entry?.[4]?.g;
  if (mode == null || mode < MODES.length || !activity.mode) return;
  localStorage.setItem(LEARNED, JSON.stringify({ ...learned(), [mode]: activity.mode }));
}

async function run() {
  if (busy || !registry.enabled(mod)) return;
  busy = true;
  try {
    const [list, pings] = await Promise.all([
      gameList(),
      // Without the host's numbers, Krunker's own pick of the closest region is the next best thing.
      regionPings().catch(() => ({ [localStorage.getItem("pingRegion7")]: 0 })),
    ]);
    const activity = window.getGameActivity?.();
    learnMode(list, activity);
    const current = activity?.id ?? new URLSearchParams(location.search).get("game");
    const ranked = rankLobbies(list.games, filters(), pings, current);
    if (!ranked.length) return toast(`No lobby fits your matchmaker filters (${list.games.length} checked).`);
    if (opt("autoJoin")) return joinBest(ranked);
    offer(ranked, pings);
  } catch (error) {
    toast(`Matchmaker: ${error.message}`);
  } finally {
    busy = false;
  }
}

const describe = (lobby) => `${lobby.map} · ${modeName(lobby.mode, learned())} · ${regionName(lobby.region)}`;

/**
 * The fullest lobbies fill fast: ask Krunker about the pick right before joining, and take the next one if it filled
 * meanwhile. If Krunker can't be reached, join anyway.
 */
async function joinBest(ranked) {
  for (const lobby of ranked.slice(0, 4)) {
    if (!GAME_ID.test(lobby.id)) continue;
    try {
      const now = parseLobby(await game.matchmaker.gameInfo(lobby.id));
      if (now.players >= now.max) continue;
    } catch (error) {
      if (error.status) continue; // Krunker answered: the lobby is gone
    }
    toast(`Joining ${describe(lobby)}`);
    location.href = `${location.origin}/?game=${encodeURIComponent(lobby.id)}`;
    return;
  }
  toast("The matching lobbies just filled up. Press the key again.");
}

/** The pick, with Join (Enter) and Cancel (Escape). */
function offer(ranked, pings) {
  const best = ranked[0];
  const p = panel({ id: "matchmaker-pick", title: "Matchmaker", width: 360, onClose: () => window.removeEventListener("keydown", keys, true) });
  const accept = () => {
    p.close();
    joinBest(ranked);
  };
  // Works even while the game still has the keyboard (in a match, F6 then Enter).
  const keys = (e) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.key === "Enter" ? accept() : p.close();
  };
  window.addEventListener("keydown", keys, true);
  p.body.append(
    h("div", { class: "mc-big" }, `${best.map} · ${modeName(best.mode, learned())}`),
    h("p", {}, regionName(best.region), " · ", pingTag(pings[best.region]), ` · ${best.players}/${best.max} players · ${clock(best.timeLeft)} left`),
    h("div", { class: "mc-muted" }, `Best of ${ranked.length} matching ${ranked.length === 1 ? "lobby" : "lobbies"} · ${best.id}`),
    h(
      "div",
      { class: "mc-float-actions" },
      h("button", { class: "mc-btn", onclick: () => p.close() }, "Cancel (Esc)"),
      h("button", { class: "mc-btn primary", onclick: accept }, "Join (Enter)"),
    ),
  );
}

/** Regions and modes to pick from, as check boxes; none checked means any. */
async function chooseFilters() {
  const p = panel({ id: "matchmaker-filters", title: "Matchmaker filters", width: 640, height: 560 });
  const pings = await regionPings(300000).catch(() => ({}));
  const group = (key, entries) => {
    const chosen = new Set(opt(key) ?? []);
    return h(
      "div",
      { class: "mc-checks" },
      ...entries.map(([value, label, extra]) =>
        h(
          "label",
          {},
          h("input", {
            type: "checkbox",
            checked: chosen.has(value),
            onchange: (e) => {
              e.target.checked ? chosen.add(value) : chosen.delete(value);
              settings.set(`${id}.${key}`, [...chosen]);
            },
          }),
          label,
          extra,
        ),
      ),
    );
  };
  const regions = Object.keys(REGIONS).sort((a, b) => (pings[a] ?? 1e9) - (pings[b] ?? 1e9));
  const extraModes = Object.entries(learned()).map(([i, name]) => [Number(i), name]);
  p.body.append(
    h("p", {}, "Nothing checked means any. Maps, players and time left are in Mercury settings → Matchmaking."),
    h("h4", {}, "Regions"),
    group("regions", regions.map((key) => [key, regionName(key), h("span", { class: "mc-muted" }, pingTag(pings[key]))])),
    h("h4", {}, "Modes"),
    group("modes", [...MODES.map((name, i) => [i, name]), ...extraModes]),
    h(
      "div",
      { class: "mc-float-actions" },
      h("button", { class: "mc-btn", onclick: () => (settings.set(`${id}.regions`, []), settings.set(`${id}.modes`, []), chooseFilters()) }, "Any"),
      h("button", { class: "mc-btn primary", onclick: () => p.close() }, "Done"),
    ),
  );
}

onHotkey(`${id}.key`, run);

const mod = {
  id,
  name: "Matchmaker",
  desc: "A key finds the best public lobby for your filters: your fastest region first, then the fullest lobby. Never a full lobby or the one you are in.",
  category: "Matchmaking",
  live: true,
  settings: [
    { key: "key", label: "Find a lobby", type: "key", default: "F6" },
    { key: "filters", label: "Regions and modes", desc: "Pick the regions and game modes to look in.", type: "action", button: "Choose", run: chooseFilters },
    { key: "regions", type: "hidden", default: [] },
    { key: "modes", type: "hidden", default: [0, 1] },
    { key: "maps", label: "Maps", desc: "Separated by commas. Empty means any map.", type: "text", default: "", placeholder: "Burg, Sandstorm" },
    { key: "minPlayers", label: "Players at least", type: "number", min: 0, max: 7, default: 1 },
    { key: "maxPlayers", label: "Players at most", type: "number", min: 1, max: 7, default: 7 },
    { key: "minTimeLeft", label: "Minutes left at least", type: "number", min: 0, max: 8, step: 0.5, default: 2 },
    { key: "custom", label: "Include custom games", type: "bool", default: false },
    { key: "autoJoin", label: "Join without asking", desc: "Off: a small window shows the pick first, Enter joins.", type: "bool", default: false },
  ],
};

export default mod;
