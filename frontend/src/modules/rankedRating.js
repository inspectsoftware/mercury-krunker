// Ranked rating: the logged-in player's ranked MMR (Krunker's conservative rating), rank, wins and losses, the
// change over the last match and the matches left to the next season reward, under the menu's Ranked button.
// From the token tier's ranked profile (api.krunker.io/player-profile/me/season/:season), read with the player's own
// token; snapshots stay in localStorage.

import { h, waitFor } from "../core/dom.js";
import * as settings from "../core/settings.js";
import { account, cached, paced } from "../lib/krunker.js";
import { rankedProgress } from "../lib/ranked.js";

const id = "rankedRating";
const opt = (key) => settings.get(`${id}.${key}`);
const SEASON = "mercury:rankedSeason";
// Krunker's APIs don't name the running ranked season: start from the last one that answered (15 in the API docs of
// 2026-10) and move on once the next season has matches.
const FIRST_GUESS = 15;

async function load(session) {
  const region = opt("region") === "" ? undefined : Number(opt("region"));
  const get = (season) =>
    cached(`ranked:${session.claims.sub}:${season}:${region}`, 60000, () => paced(() => session.ranked.profile(season, region), "api")).catch(() => null);
  let season = opt("season") || Number(localStorage.getItem(SEASON)) || FIRST_GUESS;
  let data = null;
  if (!opt("season")) {
    const next = await get(season + 1);
    if (next?.profile?.total_matches > 0) [season, data] = [season + 1, next];
  }
  data ??= await get(season);
  if (data?.profile && !opt("season")) localStorage.setItem(SEASON, season);
  return { season, data };
}

async function show() {
  // The menu's Ranked button renders after Krunker's scripts, FRVR's login included.
  const ranked = await waitFor("#menuBtnRanked");
  const session = await account();
  if (!session) return;
  const { season, data } = await load(session);
  if (!data?.profile) return;
  const p = data.profile;
  const key = `mercury:rankedHistory:${session.claims.sub}:${season}`;
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem(key)) ?? [];
  } catch {}
  const progress = rankedProgress(history, p, data.milestones);
  localStorage.setItem(key, JSON.stringify(progress.history));
  const sign = progress.delta > 0 ? "+" : "";
  const box = h(
    "div",
    { class: "mc-rank-box", id: "mc-rank-box" },
    h("b", {}, `${Math.round(p.conservative_rating)} MMR`),
    progress.delta != null && h("span", { class: progress.delta >= 0 ? "mc-good" : "mc-bad" }, ` ${sign}${progress.delta}`),
    p.rank ? ` · #${p.rank}` : "",
    h("br"),
    h("span", { class: "mc-muted" }, `Season ${season} · ${p.wins}W ${p.losses}L`, progress.toReward != null ? ` · ${progress.toReward} to the next reward` : ""),
  );
  document.getElementById("mc-rank-box")?.remove();
  if (getComputedStyle(ranked).position === "static") ranked.style.position = "relative";
  ranked.append(box);
}

export default {
  id,
  name: "Ranked rating",
  desc: "Your ranked MMR, rank, wins and losses and the change from your last match, under the Ranked button. Needs a logged-in Krunker account.",
  category: "Ranked",
  settings: [
    { key: "region", label: "Region", type: "select", default: "", options: [["", "All regions"], ["3", "Europe"], ["4", "North America"], ["2", "Asia"]] },
    { key: "season", label: "Season", desc: "0 finds the running season by itself.", type: "number", min: 0, max: 40, default: 0 },
  ],
  init() {
    show().catch((e) => console.warn("[mercury] ranked rating:", e));
  },
};
