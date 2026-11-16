import { test } from "node:test";
import assert from "node:assert/strict";
import { activity, compareTrade, discover, inventoryValue, watchHit } from "../src/lib/market.js";

// Rows shaped like gapi /market/stats.
const ROWS = [
  { ski: 1, inC: 94458, onS: 46, high: 2000, low: 150 },
  { ski: 2, inC: 500, onS: 3, high: 900, low: 800 },
  { ski: 3, inC: 120, onS: 0 },
  { ski: 4, inC: 40, onS: 2, high: 5000, low: 90 },
  { ski: 5, inC: 10, onS: 32, high: 15000 }, // listed, but no low ask in the reply
];
const SKINS = { 1: ["Arctic Hunt", 0, 300], 2: ["Gold Fang", 3, 1000], 3: ["Old", 1, null], 4: ["Neon Fang", 2, 60], 5: ["Odd", 4, 9000] };
const info = (sold = {}) => (ski) => ({ name: SKINS[ski][0], rarity: SKINS[ski][1], value: SKINS[ski][2], sold: sold[ski] });
const ids = (rows) => rows.map((r) => r.ski);

test("discovery: budget, listed only, rarity, search, sort", () => {
  assert.deepEqual(ids(discover(ROWS, {}, info())), [4, 1, 2], "cheapest first; unlisted and ask-less rows out");
  assert.deepEqual(ids(discover(ROWS, { budget: 200 }, info())), [4, 1]);
  assert.deepEqual(ids(discover(ROWS, { minListed: 3 }, info())), [1, 2]);
  assert.deepEqual(ids(discover(ROWS, { minCirculation: 100 }, info())), [1, 2]);
  assert.deepEqual(ids(discover(ROWS, { rarity: "3" }, info())), [2]);
  assert.deepEqual(ids(discover(ROWS, { search: "fang" }, info())), [4, 2]);
  assert.deepEqual(ids(discover(ROWS, { sort: "listed" }, info())), [1, 2, 4]);
  // ask / kr value: 150/300 = 0.5, 800/1000 = 0.8, 90/60 = 1.5
  assert.deepEqual(ids(discover(ROWS, { sort: "deal" }, info())), [1, 2, 4]);
  // (high - low) / low: 4910/90, 1850/150, 100/800
  assert.deepEqual(ids(discover(ROWS, { sort: "spread" }, info())), [4, 1, 2]);
});

test("discovery: activity drops only rows known to be quiet", () => {
  const sold = { 1: 40, 2: 1 };
  assert.deepEqual(ids(discover(ROWS, { minSold: 5 }, info(sold))), [4, 1], "4 is not loaded yet, so it stays");
  assert.deepEqual(ids(discover(ROWS, { sort: "active" }, info(sold))), [1, 2, 4]);
});

test("activity sums daily sales", () => {
  assert.deepEqual(activity([{ f: 300, t: 2, d: "2026-11-15" }, { f: 150, t: 1, d: "2026-11-16" }]), { sold: 3, kr: 450 });
  assert.deepEqual(activity([]), { sold: 0, kr: 0 });
});

test("inventory value and coverage", () => {
  const stacks = [{ i: 1, cnt: 2, sid: 0, st: 0 }, { i: 1, cnt: 1, sid: 0, st: 0 }, { i: 3, cnt: 1 }, { i: 2, cnt: 1 }];
  const lows = { 1: 150, 2: 800 };
  const inv = inventoryValue(stacks, (ski) => SKINS[ski][2], (ski) => lows[ski] ?? null);
  assert.equal(inv.pieces, 5);
  assert.equal(inv.value, 3 * 300 + 1000);
  assert.equal(inv.lowValue, 3 * 150 + 800);
  assert.equal(inv.valued, 4 / 5);
  assert.equal(inv.listed, 4 / 5);
  assert.deepEqual(inv.items.map((i) => [i.ski, i.count]), [[2, 1], [1, 3], [3, 1]], "most valuable first, unknown last");
  assert.equal(inventoryValue([], () => 1, () => 1).valued, 0);
});

test("trade comparison", () => {
  const value = (ski) => SKINS[ski]?.[2] ?? null;
  const low = (ski) => ({ 1: 150, 2: 800 })[ski] ?? null;
  const t = compareTrade({ items: [{ ski: 2, count: 1 }], kr: 0 }, { items: [{ ski: 1, count: 2 }, { ski: 3, count: 1 }], kr: 500 }, value, low);
  assert.deepEqual(t.give, { value: 1000, low: 800, unknown: 0 });
  assert.deepEqual(t.get, { value: 1100, low: 800, unknown: 1 });
  assert.equal(t.gain, 100);
  assert.equal(t.gainLow, 0);
});

test("watchlist targets", () => {
  assert.equal(watchHit({ target: 200, when: "below" }, 150), true);
  assert.equal(watchHit({ target: 200, when: "below" }, 200), true);
  assert.equal(watchHit({ target: 200, when: "below" }, 201), false);
  assert.equal(watchHit({ target: 200, when: "above" }, 250), true);
  assert.equal(watchHit({ target: 200, when: "above" }, null), false, "nothing listed never fires");
  assert.equal(watchHit({ target: 0, when: "below" }, 5), false, "no target never fires");
});
