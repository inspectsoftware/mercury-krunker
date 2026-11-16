// Rank progress and nuke counter, through Krunker's read-only APIs (krapio):
// - nukes: the career total from the player's public profile (game tier, no login needed beyond the name);
// - rank: this season's rating (MMR) and tier from the ranked profile (token tier, the player's own FRVR token). The
//   season is the one of the newest match in the public profile. Krunker does not publish its tier thresholds, so
//   progress toward the next tier uses the thresholds the player enters.
// Replies are cached for 10 minutes; logged out (Guest) or any API error just hides the panel.

import { KrunkerGameApi, KrunkerTokenApi } from "krapio";
import { css, h } from "../core/dom.js";
import * as settings from "../core/settings.js";
import { latestSeason, parseTiers, tierProgress } from "../lib/social.js";

const opt = (key) => settings.get(`rankStats.${key}`);
const CACHE = "mercury:rankStats";
const TTL = 10 * 60 * 1000;
const gameApi = new KrunkerGameApi();
const tokenApi = new KrunkerTokenApi();
let box = null;
let stats = null;

function cached() {
  try {
    return JSON.parse(localStorage.getItem(CACHE));
  } catch {
    return null;
  }
}

async function accessToken() {
  try {
    const fresh = await window.FRVR?.auth?.getFreshAccessToken?.();
    if (typeof fresh === "string") return fresh;
  } catch {}
  try {
    return JSON.parse(localStorage.getItem("__FRVR_auth_access_token"));
  } catch {
    return null;
  }
}

async function load(name) {
  const old = cached();
  if (old?.name === name && Date.now() - old.t < TTL) return old;
  const next = { name, t: Date.now(), season: old?.name === name ? old.season : null };
  try {
    const profile = await gameApi.players.get(name);
    next.nukes = profile.player_stats?.n ?? 0;
    next.season = latestSeason(profile.match_history) ?? next.season;
  } catch (e) {
    console.info("[mercury] profile:", e.message);
  }
  const token = next.season && (await accessToken());
  if (token) {
    try {
      const { profile } = await tokenApi.as(token).ranked.profile(next.season);
      Object.assign(next, { mmr: Math.round(profile.conservative_rating), tier: profile.rank, wins: profile.wins, losses: profile.losses });
    } catch (e) {
      console.info("[mercury] ranked profile:", e.message);
    }
  }
  localStorage.setItem(CACHE, JSON.stringify(next));
  return next;
}

const bar = (progress) => h("div", { class: "mc-stats-bar" }, h("div", { style: { width: `${Math.round(progress * 100)}%` } }));

function render() {
  if (!box) return; // settings edited while the module is off
  const inGame = !!document.pointerLockElement;
  const where = opt("show");
  const rows = [];
  if (stats && opt("nukes") && stats.nukes != null) {
    const goal = parseInt(opt("nukeGoal"), 10);
    rows.push(h("div", {}, h("b", {}, "Nukes "), goal > 0 ? `${stats.nukes.toLocaleString()} / ${goal.toLocaleString()}` : stats.nukes.toLocaleString()));
    if (goal > 0) rows.push(bar(Math.min(1, stats.nukes / goal)));
  }
  if (stats && opt("rank") && stats.mmr != null) {
    const tiers = parseTiers(opt("tiers"));
    const p = tiers.length ? tierProgress(stats.mmr, tiers) : null;
    rows.push(h("div", {}, h("b", {}, "Ranked "), `${stats.mmr} MMR`, p?.tier ? ` · ${p.tier.name}` : ` · tier ${stats.tier}`, ` · ${stats.wins}W ${stats.losses}L`));
    if (p?.next) rows.push(h("div", { class: "mc-stats-sub" }, `${p.toGo} to ${p.next.name}`), bar(p.progress));
  }
  box.className = `mc-stats ${opt("corner")}`;
  box.hidden = !rows.length || !(where === "both" || (where === "game") === inGame);
  box.replaceChildren(...rows);
}

async function refresh() {
  let name = null;
  try {
    name = window.getGameActivity?.()?.user;
  } catch {}
  if (!name || name === "Guest") stats = null;
  else stats = await load(name);
  render();
}

css(
  `.mc-stats { position: fixed; z-index: 2147482000; min-width: 170px; padding: 7px 11px; color: #fff; background: rgba(10, 12, 16, 0.55);
     border-radius: 8px; pointer-events: none; font: 13px/1.45 "Segoe UI", system-ui, sans-serif !important; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
   .mc-stats[hidden] { display: none; }
   .mc-stats * { font-family: inherit !important; }
   .mc-stats b { color: #9ad7ff; font-weight: 600; }
   .mc-stats.top-left { top: 12px; left: 12px; } .mc-stats.top-right { top: 12px; right: 12px; }
   .mc-stats.bottom-left { bottom: 12px; left: 12px; } .mc-stats.bottom-right { bottom: 12px; right: 12px; }
   .mc-stats-sub { color: rgba(255, 255, 255, 0.7); font-size: 12px; }
   .mc-stats-bar { height: 4px; margin: 3px 0 5px; background: rgba(255, 255, 255, 0.18); border-radius: 2px; overflow: hidden; }
   .mc-stats-bar > div { height: 100%; background: #2f86c2; }`,
  "mercury-rank-stats",
);

export default {
  id: "rankStats",
  name: "Rank progress and nukes",
  desc: "Your ranked rating this season and your career nukes, with an optional goal. Needs you to be logged in.",
  category: "Social",
  defaultOn: false,
  live: true,
  settings: [
    { key: "rank", label: "Ranked rating", type: "bool", default: true, onChange: () => render() },
    {
      key: "tiers",
      label: "Tier thresholds",
      desc: "Krunker does not publish them. One tier per line, its name and the MMR it starts at (Gold 1500), to see how far the next one is.",
      type: "list",
      default: "",
      onChange: () => render(),
    },
    { key: "nukes", label: "Nuke counter", type: "bool", default: true, onChange: () => render() },
    { key: "nukeGoal", label: "Nuke goal", desc: "Empty: no goal.", type: "text", default: "", placeholder: "500", onChange: () => render() },
    { key: "show", label: "Show", type: "select", default: "menu", options: [["menu", "In the menu"], ["game", "In game"], ["both", "In game and in the menu"]], onChange: () => render() },
    {
      key: "corner",
      label: "Corner",
      type: "select",
      default: "top-left",
      options: [["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]],
      onChange: () => render(),
    },
  ],
  init() {
    box = document.body.appendChild(h("div", { class: "mc-stats", hidden: true }));
    // getGameActivity knows the name once Krunker has loaded the account.
    setTimeout(refresh, 4000);
    setInterval(refresh, 60000);
    document.addEventListener("pointerlockchange", render);
  },
};
