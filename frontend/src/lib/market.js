// Market math for the Market window. Pure: the data comes from krapio's game and token tiers, this only filters,
// sums and compares it, so node --test can run it.
// Shapes: market stats rows {ski, inC, onS, high?, low?}; item prices: array by skin index, kr or null;
// inventory stacks {i, cnt}; daily sales {f: kr, t: count, d: "YYYY-MM-DD"}.

export const RARITIES = ["Uncommon", "Rare", "Epic", "Legendary", "Relic", "Contraband", "Unobtainable"];
export const rarityName = (r) => RARITIES[r] ?? `Rarity ${r}`;

export const SORTS = {
  cheap: ["Cheapest", (a, b) => a.low - b.low],
  listed: ["Most listed", (a, b) => b.onS - a.onS],
  deal: ["Best deal (ask under kr value)", (a, b) => ratio(a) - ratio(b)],
  spread: ["Widest spread", (a, b) => spread(b) - spread(a)],
  active: ["Most sold (7 days)", (a, b) => (b.sold ?? -1) - (a.sold ?? -1)],
};
const ratio = (row) => (row.value ? row.low / row.value : Infinity);
const spread = (row) => (row.high && row.low ? (row.high - row.low) / row.low : 0);

/**
 * Skins worth a look: listed now, with a lowest ask within the budget and the activity asked for.
 * filters: {budget, minListed, minCirculation, rarity ("" = any), search, minSold, sort};
 * info(ski) → {name, rarity, value, sold}: the skin's name, rarity, kr value and 7-day sales count (undefined until
 * loaded; minSold only drops rows whose count is known).
 */
export function discover(rows, filters, info) {
  const { budget = Infinity, minListed = 1, minCirculation = 0, rarity = "", search = "", minSold = 0, sort = "cheap" } = filters;
  const q = search.trim().toLowerCase();
  const out = [];
  for (const row of rows) {
    if (row.low == null || row.low > budget || row.onS < Math.max(1, minListed) || row.inC < minCirculation) continue;
    const meta = info(row.ski);
    if (rarity !== "" && meta.rarity !== Number(rarity)) continue;
    if (q && !meta.name.toLowerCase().includes(q)) continue;
    if (minSold > 0 && meta.sold != null && meta.sold < minSold) continue;
    out.push({ ...row, ...meta });
  }
  return out.sort((SORTS[sort] ?? SORTS.cheap)[1]);
}

/** Totals of a day-by-day sales list. */
export function activity(days = []) {
  return days.reduce((sum, day) => ({ sold: sum.sold + (day.t ?? 0), kr: sum.kr + (day.f ?? 0) }), { sold: 0, kr: 0 });
}

/**
 * What an inventory is worth. valueOf(ski): Krunker's kr value or null; lowOf(ski): the lowest ask on the market or
 * null. Coverage: the share of items (by count) that have a kr value, and that are listed on the market now.
 */
export function inventoryValue(stacks, valueOf, lowOf) {
  const counts = new Map();
  for (const { i, cnt } of stacks) counts.set(i, (counts.get(i) ?? 0) + (cnt ?? 1));
  const items = [...counts].map(([ski, count]) => {
    const value = valueOf(ski);
    const low = lowOf(ski);
    return { ski, count, value, low, total: value == null ? null : value * count, lowTotal: low == null ? null : low * count };
  });
  const pieces = items.reduce((n, item) => n + item.count, 0);
  const share = (pick) => (pieces ? items.filter(pick).reduce((n, item) => n + item.count, 0) / pieces : 0);
  return {
    items: items.sort((a, b) => (b.total ?? -1) - (a.total ?? -1)),
    pieces,
    value: items.reduce((n, item) => n + (item.total ?? 0), 0),
    lowValue: items.reduce((n, item) => n + (item.lowTotal ?? 0), 0),
    valued: share((item) => item.value != null),
    listed: share((item) => item.low != null),
  };
}

/** One side of a trade: [{ski, count}] plus kr; sums by kr value and by lowest ask. */
export function tradeSide(items, kr, valueOf, lowOf) {
  const sum = (of) => items.reduce((n, { ski, count }) => n + (of(ski) ?? 0) * count, 0) + (kr || 0);
  const unknown = items.filter(({ ski }) => valueOf(ski) == null).length;
  return { value: sum(valueOf), low: sum(lowOf), unknown };
}

/** Both sides of a trade; positive `gain` means you get more than you give. */
export function compareTrade(give, get, valueOf, lowOf) {
  const a = tradeSide(give.items, give.kr, valueOf, lowOf);
  const b = tradeSide(get.items, get.kr, valueOf, lowOf);
  return { give: a, get: b, gain: b.value - a.value, gainLow: b.low - a.low };
}

/** A watchlist entry fires when the lowest ask reaches its target: {target, when: "below" | "above"}. */
export function watchHit(entry, low) {
  if (low == null || !(entry.target > 0)) return false;
  return entry.when === "above" ? low >= entry.target : low <= entry.target;
}

/** "12,345 KR" */
export const kr = (n) => (n == null ? "–" : `${Math.round(n).toLocaleString("en-US")} KR`);
