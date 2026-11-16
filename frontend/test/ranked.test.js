import { test } from "node:test";
import assert from "node:assert/strict";
import { rankedProgress } from "../src/lib/ranked.js";

const profile = (total_matches, conservative_rating) => ({ total_matches, conservative_rating });
const MILESTONES = [{ id: 2, matches: 20, reward: 50 }, { id: 1, matches: 10, reward: 25 }];

test("first look: no change yet, matches to the next reward", () => {
  const p = rankedProgress([], profile(7, 1503.6), MILESTONES);
  assert.deepEqual(p.history, [{ matches: 7, rating: 1504 }]);
  assert.equal(p.delta, null);
  assert.equal(p.toReward, 3);
});

test("a played match shows its rating change; a reload without a match keeps it", () => {
  const first = rankedProgress([], profile(7, 1504), MILESTONES);
  const won = rankedProgress(first.history, profile(8, 1522), MILESTONES);
  assert.equal(won.delta, 18);
  const reload = rankedProgress(won.history, profile(8, 1522), MILESTONES);
  assert.equal(reload.delta, 18);
  assert.equal(reload.history.length, 2);
  const lost = rankedProgress(reload.history, profile(9, 1510), MILESTONES);
  assert.equal(lost.delta, -12);
});

test("past the last milestone there is no next reward; history stays short", () => {
  let history = [];
  for (let m = 0; m < 30; m++) history = rankedProgress(history, profile(m, 1000 + m), MILESTONES).history;
  assert.equal(history.length, 20);
  assert.equal(rankedProgress(history, profile(30, 1030), MILESTONES).toReward, null);
});
