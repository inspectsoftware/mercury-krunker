// Krunker's public lobby list (matchmaker.krunker.io/game-list) and the matchmaker's choice. Pure: no DOM, no
// network, so node --test can run it.

/** Mode ids in the order of Krunker's Host Game window (read 2026-11-16); newer ids fall back to "Mode N". */
export const MODES = [
  "Free for All", "Team Deathmatch", "Hardpoint", "Capture the Flag", "Parkour", "Hide & Seek", "Infected", "Race",
  "Last Man Standing", "Simon Says", "Gun Game", "Prop Hunt", "Boss Hunt", "Classic FFA", "Deposit", "Stalker",
  "King of the Hill", "One in the Chamber", "Trade", "Kill Confirmed", "Defuse", "Sharp Shooter", "Traitor", "Raid",
  "Blitz", "Domination", "Squad Deathmatch", "Kranked FFA", "Team Defender", "Deposit FFA", "Chaos Snipers",
  "Bighead FFA",
];

/** Region keys of the game list, with the names Krunker's Find Game window shows. */
export const REGIONS = {
  "de-fra": "Frankfurt",
  "us-nj": "New York",
  "us-tx": "Dallas",
  "us-ca-sv": "Silicon Valley",
  "brz": "Brazil",
  "jb-hnd": "Tokyo",
  "sgp": "Singapore",
  "as-mb": "Mumbai",
  "me-bhn": "Middle East",
  "au-syd": "Sydney",
  "sss": "EU Super Secret Servers",
};

export const modeName = (id, learned = {}) => learned[id] ?? MODES[id] ?? `Mode ${id}`;
export const regionName = (key) => REGIONS[key] ?? key;

/** [id, region, players, max, {g: mode, i: map, c: custom}, secondsLeft] → a named lobby. */
export function parseLobby([id, region, players, max, options = {}, timeLeft]) {
  return { id, region, players, max, mode: options.g, map: options.i ?? "", custom: !!options.c, timeLeft: timeLeft ?? 0 };
}

/**
 * Whether a lobby fits the filters. Full lobbies and the current one never do.
 * filters: {regions: [key], modes: [id], maps: [name], minPlayers, maxPlayers, minTimeLeft (s), custom: bool};
 * an empty list means any.
 */
export function fits(lobby, filters, currentId) {
  const { regions = [], modes = [], maps = [], minPlayers = 0, maxPlayers = Infinity, minTimeLeft = 0, custom = false } = filters;
  if (lobby.id === currentId || lobby.players >= lobby.max) return false;
  if (lobby.custom && !custom) return false;
  if (regions.length && !regions.includes(lobby.region)) return false;
  if (modes.length && !modes.includes(lobby.mode)) return false;
  if (maps.length && !maps.some((m) => m.toLowerCase() === lobby.map.toLowerCase())) return false;
  return lobby.players >= minPlayers && lobby.players <= maxPlayers && lobby.timeLeft >= minTimeLeft;
}

/**
 * The lobbies that fit, best first: the lowest-ping region first (regions without a ping last), then the fullest
 * lobby, then the most time left.
 * pings: {regionKey: ms}.
 */
export function rankLobbies(games, filters, pings = {}, currentId = null) {
  const ping = (region) => pings[region] ?? Infinity;
  return games
    .map(parseLobby)
    .filter((lobby) => fits(lobby, filters, currentId))
    .sort((a, b) => ping(a.region) - ping(b.region) || b.players - a.players || b.timeLeft - a.timeLeft);
}

/** "3:05" */
export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** "Frankfurt, Burg" → ["Frankfurt", "Burg"]: the comma-separated lists of the settings. */
export const splitList = (text) => String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
