import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, fits, modeName, parseLobby, rankLobbies, splitList } from "../src/lib/lobbies.js";

// Entries shaped like matchmaker.krunker.io/game-list replies (2026-11-16).
const game = (id, region, players, max, mode, map, timeLeft, custom = 0) => [id, region, players, max, { g: mode, i: map, c: custom, v: "x" }, timeLeft];
const GAMES = [
  game("FRA:aaaaa", "de-fra", 5, 8, 0, "Burg", 200),
  game("FRA:bbbbb", "de-fra", 7, 8, 0, "Subzero", 100),
  game("FRA:fulll", "de-fra", 8, 8, 0, "Burg", 300),
  game("NY:ccccc", "us-nj", 7, 8, 1, "Burg", 250),
  game("SSS:ddddd", "sss", 6, 8, 0, "Kanji", 240),
  game("FRA:custm", "de-fra", 7, 8, 0, "MyMap", 400, 1),
];
const PINGS = { "de-fra": 45, "us-nj": 120, "sss": 46 };

test("best lobby: lowest-ping region, then fullest, never full or current", () => {
  const ids = (list) => list.map((l) => l.id);
  assert.deepEqual(ids(rankLobbies(GAMES, {}, PINGS)), ["FRA:bbbbb", "FRA:aaaaa", "SSS:ddddd", "NY:ccccc"]);
  assert.deepEqual(ids(rankLobbies(GAMES, {}, PINGS, "FRA:bbbbb")), ["FRA:aaaaa", "SSS:ddddd", "NY:ccccc"]);
});

test("regions without a ping come last, fullest first among them", () => {
  const ranked = rankLobbies(GAMES, {}, { "us-nj": 120 });
  assert.equal(ranked[0].id, "NY:ccccc");
  assert.deepEqual(ranked.slice(1).map((l) => l.players), [7, 6, 5]);
});

test("filters: regions, modes, maps, players, time left, custom games", () => {
  const pick = (filters) => rankLobbies(GAMES, filters, PINGS).map((l) => l.id);
  assert.deepEqual(pick({ regions: ["us-nj", "sss"] }), ["SSS:ddddd", "NY:ccccc"]);
  assert.deepEqual(pick({ modes: [1] }), ["NY:ccccc"]);
  assert.deepEqual(pick({ maps: ["burg"] }), ["FRA:aaaaa", "NY:ccccc"]);
  assert.deepEqual(pick({ minPlayers: 6, maxPlayers: 6 }), ["SSS:ddddd"]);
  assert.deepEqual(pick({ minTimeLeft: 230 }), ["SSS:ddddd", "NY:ccccc"]);
  // Same region, same players: more time left wins.
  assert.deepEqual(pick({ custom: true, regions: ["de-fra"] }), ["FRA:custm", "FRA:bbbbb", "FRA:aaaaa"]);
});

test("a lobby one short of full still fits; a full one never does", () => {
  const seven = parseLobby(game("X:aaaaa", "de-fra", 7, 8, 0, "Burg", 10));
  const full = parseLobby(game("X:bbbbb", "de-fra", 4, 4, 23, "Tortuga", 0));
  assert.equal(fits(seven, { maxPlayers: 7 }), true);
  assert.equal(fits(full, {}), false);
});

test("names and helpers", () => {
  assert.equal(modeName(0), "Free for All");
  assert.equal(modeName(29), "Deposit FFA");
  assert.equal(modeName(35), "Mode 35");
  assert.equal(modeName(35, { 35: "New Mode" }), "New Mode");
  assert.equal(clock(185), "3:05");
  assert.deepEqual(splitList(" Burg, ,Sub zero ,"), ["Burg", "Sub zero"]);
});
