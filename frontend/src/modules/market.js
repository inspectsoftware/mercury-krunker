// Market: a read-only window on Krunker's market. Overview, discovery with budget and activity filters, a local
// watchlist with price targets (checked while Mercury runs), what your inventory is worth, and a side-by-side trade
// comparison. Data from krapio's game tier (no login) and token tier (your own token, for inventory and open
// trades); cached in IndexedDB, paced under gapi's limits, never sent anywhere. Nothing here buys, sells or trades.

import { h, toast } from "../core/dom.js";
import { onKey } from "../core/hotkeys.js";
import * as registry from "../core/modules.js";
import * as settings from "../core/settings.js";
import { account, ago, cached, cachedAt, game, paced } from "../lib/krunker.js";
import { RARITIES, SORTS, activity, compareTrade, discover, inventoryValue, kr, rarityName, watchHit } from "../lib/market.js";
import { isOpen, panel, table } from "../lib/panel.js";

const id = "market";
const opt = (key) => settings.get(`${id}.${key}`);
const MIN = 60000;
const HOUR = 60 * MIN;
const store = {
  get: (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(`mercury:${key}`)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (key, value) => localStorage.setItem(`mercury:${key}`, JSON.stringify(value)),
};

// ---- data -------------------------------------------------------------------------------------------------------

const data = { skins: [], prices: [], rows: [], byId: new Map(), statsAt: 0, sold: new Map() };

// [name, rarity, season, tradable, slot, thumbnail]: the 1.2 MB list trimmed to what the window shows.
const loadSkins = () =>
  cached("skins:v3", 24 * HOUR, async () =>
    (await paced(() => game.game.skins())).map((s) => [s?.name ?? "", s?.rarity ?? 0, s?.seas ?? 0, s?.tradable ? 1 : 0, s?.keyW ?? "", thumbPath(s?.thumbnail)]),
  );
// Thumbnails come from Krunker's asset host only; kept as a path to keep the cache small.
const ASSETS = "https://assets.krunker.io/";
const thumbPath = (url) => (typeof url === "string" && url.startsWith(ASSETS) ? url.slice(ASSETS.length) : "");
const thumb = (ski) => data.skins[ski]?.[5] && h("img", { class: "mc-thumb", src: ASSETS + data.skins[ski][5], loading: "lazy", alt: "" });
const loadPrices = () => cached("prices", HOUR, () => paced(() => game.legacy.itemPrices(), "api"));

/** Every page of /market/stats (about 80, 100 skins each), once per 15 minutes. */
const loadStats = (force, onProgress) =>
  cached("stats", force ? 0 : 15 * MIN, async () => {
    const rows = [];
    let cursor;
    for (let page = 0; page < 300; page++) {
      // The ask range comes only with sort=rarity, what Krunker's own market tab sends.
      const reply = await paced(() => game.market.stats({ cursor, limit: 100, sort: "rarity" }));
      rows.push(...reply.stats.map((r) => [r.ski, r.inC, r.onS, r.high ?? null, r.low ?? null]));
      onProgress?.(rows.length);
      if (!reply.has_more || reply.next_cursor == null) break;
      cursor = reply.next_cursor;
    }
    return rows;
  });

async function loadAll(force = false, onProgress) {
  const [skins, prices, stats] = await Promise.all([loadSkins(), loadPrices(), loadStats(force, onProgress)]);
  data.skins = skins;
  data.prices = prices;
  data.rows = stats.map(([ski, inC, onS, high, low]) => ({ ski, inC, onS, high, low }));
  data.byId = new Map(data.rows.map((r) => [r.ski, r]));
  data.statsAt = await cachedAt("stats");
}

const nameOf = (ski) => data.skins[ski]?.[0] || `#${ski}`;
const valueOf = (ski) => data.prices[ski] ?? null;
const lowOf = (ski) => data.byId.get(ski)?.low ?? null;
const info = (ski) => ({ name: nameOf(ski), rarity: data.skins[ski]?.[1], value: valueOf(ski), sold: data.sold.get(ski) });

/** The 7-day sales of a skin, kept for an hour. */
async function loadActivity(ski) {
  const days = await cached(`activity:${ski}`, HOUR, () => paced(() => game.market.itemSalesStatistics(ski, 7)));
  data.sold.set(ski, activity(days).sold);
}

// ---- watchlist --------------------------------------------------------------------------------------------------

const watchlist = () => store.get("watchlist", []);
const setWatchlist = (list) => store.set("watchlist", list);

function watch(ski) {
  const list = watchlist();
  if (list.some((w) => w.ski === ski)) return toast(`${nameOf(ski)} is already on your watchlist.`);
  // Starts 10% under today's lowest ask, so it doesn't fire right away; the player sets the real target.
  setWatchlist([...list, { ski, target: Math.floor((lowOf(ski) ?? 0) * 0.9), when: "below", hit: false }]);
  toast(`Watching ${nameOf(ski)}.`);
}

/** Asks the market for each watched skin's lowest ask; a target reached is announced once. */
async function checkWatchlist() {
  store.set("watchCheckedAt", Date.now());
  if (!data.skins.length) data.skins = await loadSkins().catch(() => []); // names for the alerts
  for (const entry of watchlist()) {
    const reply = await cached(`sales:${entry.ski}`, 2 * MIN, () => paced(() => game.market.itemSales(entry.ski))).catch(() => null);
    if (!reply) continue;
    const low = reply.low || null; // 0 means nothing listed
    const list = watchlist();
    const live = list.find((w) => w.ski === entry.ski);
    if (!live) continue;
    const hit = watchHit(live, low);
    if (hit && !live.hit) toast(`Market: ${nameOf(live.ski)} is listed at ${kr(low)} (your target: at or ${live.when === "above" ? "above" : "below"} ${kr(live.target)}).`, 10000);
    Object.assign(live, { hit, low, checked: Date.now() });
    setWatchlist(list);
  }
}

function scheduleWatch() {
  const every = Math.max(2, opt("watchMinutes")) * MIN;
  const run = async () => {
    if (registry.enabled(mod) && watchlist().length) await checkWatchlist().catch(() => {});
    setTimeout(run, every);
  };
  // Krunker reloads the page on every lobby: keep the rhythm instead of checking on each load.
  const due = store.get("watchCheckedAt", 0) + every - Date.now();
  setTimeout(run, Math.max(5000, due));
}

// ---- window -----------------------------------------------------------------------------------------------------

const TABS = ["Overview", "Discover", "Watchlist", "Inventory", "Trade"];
let view = null;
let tab = "Overview";

async function open() {
  view = panel({ id: "market", title: "Market", width: 900, height: 640, zoomable: true, onClose: () => (view = null) });
  view.body.replaceChildren(h("div", { class: "mc-panel-empty" }, "Loading the market…"));
  try {
    await loadAll(false, (n) => view?.setStatus(`loading the market: ${n} skins…`));
    render();
  } catch (error) {
    view?.body.replaceChildren(h("div", { class: "mc-panel-empty" }, `Krunker's market did not answer: ${error.message}`));
  }
}

async function refresh() {
  try {
    await loadAll(true, (n) => view?.setStatus(`loading the market: ${n} skins…`));
  } catch (error) {
    toast(`Market: ${error.message}`);
  }
  render();
}

function render() {
  if (!view) return;
  view.setStatus(`market data ${ago(data.statsAt)}`);
  const tabs = h("div", { class: "mc-tabs" }, ...TABS.map((t) => h("button", { class: t === tab ? "on" : "", onclick: () => ((tab = t), render()) }, t)));
  const refreshButton = h("button", { class: "mc-btn mc-small-btn", style: { marginLeft: "auto" }, onclick: refresh }, "Refresh");
  tabs.append(refreshButton);
  const content = h("div");
  view.body.replaceChildren(tabs, content);
  ({ Overview: overview, Discover: discoverTab, Watchlist: watchlistTab, Inventory: inventoryTab, Trade: tradeTab })[tab](content);
}

const skinCell = (ski) => h("span", { class: "mc-skin", title: `#${ski} · ${rarityName(data.skins[ski]?.[1])}` }, thumb(ski), nameOf(ski));
const watchButton = (ski) => h("button", { class: "mc-btn mc-small-btn", onclick: () => watch(ski) }, "Watch");
const card = (label, value) => h("div", { class: "mc-card" }, h("small", {}, label), h("b", {}, value));

function overview(el) {
  // Some rows count listings but carry no ask, and Krunker's item page shows none for them: not on sale.
  const listed = data.rows.filter((r) => r.onS > 0 && r.low != null);
  const top = (rows, sort, n = 10) => [...rows].sort(sort).slice(0, n);
  const deals = top(
    listed.filter((r) => valueOf(r.ski) && r.onS >= 3),
    (a, b) => a.low / valueOf(a.ski) - b.low / valueOf(b.ski),
  );
  const rowsOf = (list) => list.map((r) => [skinCell(r.ski), kr(r.low), r.onS, kr(valueOf(r.ski)), watchButton(r.ski)]);
  const headers = ["Skin", "Lowest ask", "Listed", "KR value", ""];
  el.append(
    h(
      "div",
      { class: "mc-cards" },
      card("Skins on sale", listed.length.toLocaleString("en-US")),
      card("Listings", listed.reduce((n, r) => n + r.onS, 0).toLocaleString("en-US")),
      card("Skins tracked", data.rows.length.toLocaleString("en-US")),
      card("Watchlist", String(watchlist().length)),
    ),
    h(
      "div",
      { class: "mc-cols" },
      h("div", {}, h("h4", {}, "Most listed"), table(headers, rowsOf(top(listed, (a, b) => b.onS - a.onS)))),
      h("div", {}, h("h4", {}, "Furthest under their KR value"), table(headers, rowsOf(deals))),
    ),
    h("h4", {}, "Highest asks"),
    table(headers, rowsOf(top(listed, (a, b) => b.low - a.low))),
  );
}

function discoverTab(el) {
  const f = { budget: "", minListed: 1, minCirculation: 0, rarity: "", search: "", minSold: 0, sort: "cheap", ...store.get("marketFilters", {}) };
  const results = h("div");
  const num = (key, label, width = 90) =>
    h("label", {}, label, h("input", { class: "mc-input", type: "number", min: 0, value: f[key], style: { width: `${width}px` }, oninput: (e) => update(key, e.target.value === "" ? "" : Number(e.target.value)) }));
  const update = (key, value) => {
    f[key] = value;
    store.set("marketFilters", f);
    show();
  };
  const show = () => {
    const rows = discover(data.rows, { ...f, budget: f.budget === "" ? Infinity : f.budget }, info);
    const shown = rows.slice(0, 150);
    results.replaceChildren(
      h("div", { class: "mc-muted", style: { margin: "6px 0" } }, `${rows.length.toLocaleString("en-US")} skins fit${rows.length > shown.length ? `, the first ${shown.length} shown` : ""}.`),
      table(
        ["Skin", "Rarity", "Lowest ask", "Highest ask", "Listed", "Circulation", "KR value", "Sold 7d", ""],
        shown.map((r) => [skinCell(r.ski), rarityName(r.rarity), kr(r.low), kr(r.high), r.onS, r.inC.toLocaleString("en-US"), kr(r.value), r.sold ?? "…", watchButton(r.ski)]),
        "No skin fits these filters.",
      ),
    );
    return shown;
  };
  const loadSales = async (button) => {
    button.disabled = true;
    const shown = show().slice(0, 25);
    for (const [i, row] of shown.entries()) {
      button.textContent = `Loading ${i + 1}/${shown.length}…`;
      await loadActivity(row.ski).catch(() => {});
    }
    button.textContent = "7-day sales for the first 25";
    button.disabled = false;
    show();
  };
  el.append(
    h(
      "div",
      { class: "mc-panel-row" },
      num("budget", "Budget", 110),
      num("minListed", "Listed ≥"),
      num("minCirculation", "Circulation ≥"),
      num("minSold", "Sold in 7 days ≥", 70),
    ),
    h(
      "div",
      { class: "mc-panel-row" },
      h("input", { class: "mc-input", placeholder: "Search", value: f.search, style: { width: "180px" }, oninput: (e) => update("search", e.target.value) }),
      h("select", { class: "mc-select", onchange: (e) => update("rarity", e.target.value) }, h("option", { value: "" }, "Any rarity"), ...RARITIES.map((r, i) => h("option", { value: i, selected: String(i) === String(f.rarity) }, r))),
      h("select", { class: "mc-select", onchange: (e) => update("sort", e.target.value) }, ...Object.entries(SORTS).map(([k, [label]]) => h("option", { value: k, selected: k === f.sort }, label))),
      h("button", { class: "mc-btn", title: "Activity: asks Krunker for the daily sales of the first 25 results", onclick: (e) => loadSales(e.currentTarget) }, "7-day sales for the first 25"),
    ),
    results,
  );
  show();
}

/** A search box that offers skins by name; picking one calls onPick(skinIndex). */
function skinPicker(onPick, placeholder = "Add a skin: type its name") {
  const picks = h("div", { class: "mc-picks" });
  const input = h("input", {
    class: "mc-input",
    placeholder,
    style: { width: "100%" },
    oninput: () => {
      const q = input.value.trim().toLowerCase();
      const found = [];
      for (let ski = 0; q.length >= 2 && ski < data.skins.length; ski++) {
        if (data.skins[ski]?.[0].toLowerCase().includes(q)) found.push(ski);
      }
      // Many skins share a name: exact names, then the ones on sale, then tradable ones first.
      const score = (ski) => (data.skins[ski][0].toLowerCase() === q ? 4 : 0) + (lowOf(ski) != null ? 2 : 0) + data.skins[ski][3];
      found.sort((a, b) => score(b) - score(a));
      picks.replaceChildren(
        ...found.slice(0, 8).map((ski) => {
          const [, rarity, season, , slot] = data.skins[ski];
          const detail = [rarityName(rarity), season && `S${season}`, slot, `value ${kr(valueOf(ski))}`, lowOf(ski) != null && `ask ${kr(lowOf(ski))}`];
          return h("button", { class: "mc-skin", onclick: () => ((input.value = ""), picks.replaceChildren(), onPick(ski)) }, thumb(ski), nameOf(ski), h("span", { class: "mc-muted" }, `  ${detail.filter(Boolean).join(" · ")}`));
        }),
      );
    },
  });
  return h("div", { style: { marginBottom: "10px" } }, input, picks);
}

function watchlistTab(el) {
  const list = watchlist();
  const update = (ski, change) => setWatchlist(watchlist().map((w) => (w.ski === ski ? { ...w, ...change, hit: false } : w)));
  el.append(
    h("p", {}, `Mercury checks each skin's lowest ask every ${opt("watchMinutes")} minutes while it runs and tells you when one reaches your target.`),
    skinPicker((ski) => (watch(ski), render())),
    table(
      ["Skin", "Lowest ask", "Alert when the ask is", "Target", "Checked", ""],
      list.map((w) => [
        skinCell(w.ski),
        h("span", { class: w.hit ? "mc-good" : "" }, kr(w.low ?? lowOf(w.ski))),
        h("select", { class: "mc-select", onchange: (e) => update(w.ski, { when: e.target.value }) }, h("option", { value: "below", selected: w.when !== "above" }, "at or below"), h("option", { value: "above", selected: w.when === "above" }, "at or above")),
        h("input", { class: "mc-input", type: "number", min: 0, value: w.target, style: { width: "110px" }, onchange: (e) => update(w.ski, { target: Number(e.target.value) }) }),
        w.checked ? ago(w.checked) : "not yet",
        h("button", { class: "mc-btn mc-small-btn", onclick: () => (setWatchlist(watchlist().filter((x) => x.ski !== w.ski)), render()) }, "Remove"),
      ]),
      "Nothing watched yet. Add skins here or with Watch in the other tabs.",
    ),
    h("div", { class: "mc-panel-actions" }, h("button", { class: "mc-btn", onclick: async (e) => ((e.currentTarget.disabled = true), await checkWatchlist(), render()) }, "Check now")),
  );
}

async function inventoryTab(el) {
  const session = await account();
  if (!session) return el.append(h("div", { class: "mc-panel-empty" }, "Log in to a Krunker account to see what your inventory is worth."));
  el.append(h("div", { class: "mc-panel-empty" }, "Loading your inventory…"));
  try {
    const stacks = await cached(`inventory:${session.claims.sub}`, 5 * MIN, () => paced(() => session.market.inventory()));
    const inv = inventoryValue(stacks, valueOf, lowOf);
    const pct = (share) => `${Math.round(share * 100)}%`;
    el.replaceChildren(
      h(
        "div",
        { class: "mc-cards" },
        card("Worth (KR value)", kr(inv.value)),
        card("At the lowest asks", kr(inv.lowValue)),
        card("Items", inv.pieces.toLocaleString("en-US")),
        card("Have a KR value", pct(inv.valued)),
        card("Listed on the market", pct(inv.listed)),
      ),
      table(
        ["Skin", "Count", "KR value", "Lowest ask", "Total", ""],
        inv.items.slice(0, 200).map((i) => [skinCell(i.ski), i.count, kr(i.value), kr(i.low), kr(i.total), watchButton(i.ski)]),
        "Your inventory is empty.",
      ),
    );
  } catch (error) {
    el.replaceChildren(h("div", { class: "mc-panel-empty" }, `Krunker did not send your inventory: ${error.message}`));
  }
}

const trade = { give: { items: [], kr: 0 }, get: { items: [], kr: 0 } };

function tradeTab(el) {
  const side = (key, title) => {
    const s = trade[key];
    return h(
      "div",
      {},
      h("h4", {}, title),
      skinPicker((ski) => {
        const item = s.items.find((i) => i.ski === ski);
        item ? item.count++ : s.items.push({ ski, count: 1 });
        render();
      }),
      table(
        ["Skin", "Count", "KR value", "Lowest ask", ""],
        s.items.map((item) => [
          skinCell(item.ski),
          h("input", { class: "mc-input", type: "number", min: 1, value: item.count, style: { width: "64px" }, onchange: (e) => ((item.count = Math.max(1, Number(e.target.value) || 1)), render()) }),
          kr(valueOf(item.ski)),
          kr(lowOf(item.ski)),
          h("button", { class: "mc-btn mc-small-btn", onclick: () => ((s.items = s.items.filter((i) => i !== item)), render()) }, "×"),
        ]),
        "No items.",
      ),
      h("div", { class: "mc-panel-row", style: { marginTop: "8px" } }, h("label", {}, "KR", h("input", { class: "mc-input", type: "number", min: 0, value: s.kr || "", style: { width: "120px" }, onchange: (e) => ((s.kr = Math.max(0, Number(e.target.value) || 0)), render()) }))),
    );
  };
  const t = compareTrade(trade.give, trade.get, valueOf, lowOf);
  const signed = (n) => `${n > 0 ? "+" : ""}${kr(n)}`;
  const totals = (s) => `${kr(s.value)} by KR value · ${kr(s.low)} at the lowest asks${s.unknown ? ` · ${s.unknown} without a KR value` : ""}`;
  el.append(
    h("div", { id: "mc-open-trades" }),
    h("div", { class: "mc-cols" }, side("give", "You give"), side("get", "You get")),
    h("div", { class: "mc-cols", style: { marginTop: "10px" } }, h("div", { class: "mc-muted" }, totals(t.give)), h("div", { class: "mc-muted" }, totals(t.get))),
    h(
      "p",
      { class: "mc-big", style: { marginTop: "14px" } },
      h("span", { class: t.gain >= 0 ? "mc-good" : "mc-bad" }, signed(t.gain)),
      " by KR value, ",
      h("span", { class: t.gainLow >= 0 ? "mc-good" : "mc-bad" }, signed(t.gainLow)),
      " at the lowest asks",
    ),
    h("div", { class: "mc-panel-actions" }, h("button", { class: "mc-btn", onclick: () => ((trade.give = { items: [], kr: 0 }), (trade.get = { items: [], kr: 0 }), render()) }, "Clear")),
  );
  openTrades(el.querySelector("#mc-open-trades"));
}

/** With a login: pick one of your open trades to compare it. */
async function openTrades(holder) {
  const session = await account();
  if (!session || !holder) return;
  try {
    const [history, wallet] = await Promise.all([
      cached(`trades:${session.claims.sub}`, 2 * MIN, () => paced(() => session.trades.history({ limit: 25 }))),
      cached(`wallet:${session.claims.sub}`, HOUR, () => paced(() => session.player.wallet())),
    ]);
    const krId = wallet.currencies?.find((c) => /^kr$/i.test(c.symbol) || /^kr$/i.test(c.name))?.id;
    const me = window.getGameActivity?.()?.user;
    if (!history.open?.length) return;
    const pick = (tr) => {
      const mine = tr.player === me; // the offer maker gives sksell and gets skbuy
      const items = (list) => (list ?? []).map((i) => ({ ski: i.ind, count: Number(i.cnt ?? i.c ?? 1) || 1 }));
      const money = (list) => (list ?? []).filter((c) => c.cid === krId).reduce((n, c) => n + c.amt, 0);
      trade.give = { items: items(mine ? tr.sksell : tr.skbuy), kr: money(mine ? tr.csell : tr.cbuy) };
      trade.get = { items: items(mine ? tr.skbuy : tr.sksell), kr: money(mine ? tr.cbuy : tr.csell) };
      render();
    };
    holder.append(
      h(
        "div",
        { class: "mc-panel-row" },
        "Compare an open trade:",
        h(
          "select",
          { class: "mc-select", onchange: (e) => e.target.value !== "" && pick(history.open[Number(e.target.value)]) },
          h("option", { value: "" }, "Choose…"),
          ...history.open.map((tr, i) => h("option", { value: i }, `${tr.player === me ? `To ${tr.buyer}` : `From ${tr.player}`} · ${tr.dte}`)),
        ),
      ),
    );
  } catch (error) {
    holder.append(h("div", { class: "mc-muted" }, `Open trades unavailable: ${error.message}`));
  }
}

onKey(`${id}.key`, () => registry.enabled(mod) && (isOpen("market") ? null : open()));

const mod = {
  id,
  name: "Market",
  desc: "A read-only market window: overview, discovery, a watchlist with price alerts, your inventory's worth and trade comparisons. Data stays on this PC.",
  category: "Market",
  settings: [
    { key: "open", label: "Market window", type: "action", button: "Open", run: open },
    { key: "key", label: "Open the market", type: "key", default: "" },
    { key: "watchMinutes", label: "Check the watchlist every (minutes)", type: "number", min: 2, max: 60, default: 5 },
  ],
  init() {
    scheduleWatch();
  },
};

export default mod;
