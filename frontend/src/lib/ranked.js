// Krunker's own ranked match signal: its "Match found!" box (#matchmakingStatusEl .ranked-matchmaking-status) gets
// the class "show" when the ranked queue finds a match. Read from the DOM only, never from game code.

import { waitFor } from "../core/dom.js";

const listeners = new Set();
let watching = false;

/** Calls fn(found, text) whenever Krunker's ranked status box shows or hides. */
export function onRankedMatch(fn) {
  listeners.add(fn);
  if (watching) return;
  watching = true;
  waitFor("#matchmakingStatusEl").then((holder) => {
    let shown = false;
    const check = () => {
      const box = holder.querySelector(".ranked-matchmaking-status");
      const text = box?.textContent.trim() ?? "";
      const now = !!box?.classList.contains("show") && /found/i.test(text);
      if (now === shown) return;
      shown = now;
      for (const listener of listeners) listener(now, text);
    };
    new MutationObserver(check).observe(holder, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    check();
  });
}

/**
 * Rating progress from Krunker's ranked profile (token tier: {total_matches, conservative_rating}, milestones
 * [{matches, reward}]). `history` is what this returned last time: one snapshot per match count, newest last.
 * Returns {history, delta: rating change over the last counted matches or null, toReward: matches to the next
 * milestone or null}.
 */
export function rankedProgress(history, profile, milestones = []) {
  const snap = { matches: profile.total_matches, rating: Math.round(profile.conservative_rating) };
  const last = history.at(-1);
  // Same match count: the rating moved without a match (decay, a fix on Krunker's side); update it in place.
  const next = last?.matches === snap.matches ? [...history.slice(0, -1), snap] : [...history, snap].slice(-20);
  const [prev, cur] = next.slice(-2);
  const reward = milestones.filter((m) => m.matches > snap.matches).sort((a, b) => a.matches - b.matches)[0];
  return { history: next, delta: next.length > 1 ? cur.rating - prev.rating : null, toReward: reward ? reward.matches - snap.matches : null };
}
