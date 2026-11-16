import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discordActivity,
  krunkerHosted,
  latestSeason,
  parseClanColors,
  parseLoadUserMod,
  parseTiers,
  splitClanTags,
  syncEndMessage,
  tierProgress,
} from "../src/lib/social.js";

test("clan colors: one tag and color per line, bad lines skipped", () => {
  const colors = parseClanColors("VAST #ff8800\n[ffa]=#0f0\nbad line\nX #12345\nlong #zzzzzz");
  assert.deepEqual([...colors], [["VAST", "#ff8800"], ["FFA", "#0f0"]]);
});

test("clan tags split out of text, case-insensitive", () => {
  const colors = parseClanColors("VAST #ff8800");
  assert.deepEqual(splitClanTags("Name [vast] 120", colors), [{ text: "Name " }, { text: "[vast]", color: "#ff8800" }, { text: " 120" }]);
  assert.equal(splitClanTags("Name [NOPE]", colors), null);
  assert.equal(splitClanTags("no tag", colors), null);
});

test("end message: an account's edits are kept, switching swaps them, a new account sends nothing", () => {
  // First run: the message in Krunker belongs to whoever is logged in.
  let s = syncEndMessage({ sub: "main", owner: undefined, current: "gg wp", saved: {} });
  assert.deepEqual(s, { saved: { main: "gg wp" }, owner: "main", apply: null });
  // An edit on the same account is remembered.
  s = syncEndMessage({ sub: "main", owner: s.owner, current: "ggs", saved: s.saved });
  assert.deepEqual(s.saved, { main: "ggs" });
  // The alt logs in: Krunker still holds the main's message, so the alt gets "" (nothing sent).
  s = syncEndMessage({ sub: "alt", owner: s.owner, current: "ggs", saved: s.saved });
  assert.deepEqual(s, { saved: { main: "ggs" }, owner: "alt", apply: "" });
  // The alt sets its own; back on the main, the main's returns.
  s = syncEndMessage({ sub: "alt", owner: s.owner, current: "alt gg", saved: s.saved });
  s = syncEndMessage({ sub: "main", owner: s.owner, current: "alt gg", saved: s.saved });
  assert.deepEqual(s, { saved: { main: "ggs", alt: "alt gg" }, owner: "main", apply: "ggs" });
  // Unknown account (token unreadable): nothing changes.
  assert.equal(syncEndMessage({ sub: null, owner: "main", current: "x", saved: s.saved }).apply, null);
});

test("Discord activity from getGameActivity()", () => {
  const game = { id: "FRA:n12t0", time: 138, user: "Guest", class: { name: "Triggerman", index: 0 }, map: "SkyTemple", mode: "Free for All", custom: false };
  const now = 1_700_000_000_000;
  assert.deepEqual(discordActivity(game, { now }), {
    details: "Playing Krunker.io",
    state: "Free for All on SkyTemple",
    end: 1_700_000_140_000,
  });
  assert.equal(discordActivity(game, { now, join: true }).joinUrl, "https://krunker.io/?game=FRA:n12t0");
  assert.equal(discordActivity({ ...game, time: 0 }, { now, since: 5 }).start, 5);
  assert.equal(discordActivity({ ...game, id: "x\"y" }, { join: true }).joinUrl, undefined);
  assert.equal(discordActivity({ ...game, custom: true }).state, "Free for All on SkyTemple (custom game)");
  assert.equal(discordActivity(undefined), null);
});

test("mod links from Krunker's Load buttons", () => {
  assert.deepEqual(parseLoadUserMod('loadUserMod("CRUCIAL","https://user-assets.krunker.io/md3466/mod.zip","3466","Crucial.",1)'), {
    name: "CRUCIAL",
    url: "https://user-assets.krunker.io/md3466/mod.zip",
  });
  assert.deepEqual(parseLoadUserMod("loadUserMod(`COD_weapons`,`https://user-assets.krunker.io/md11296/mod.zip`,`11296`,`x`,1)").name, "COD_weapons");
  assert.equal(parseLoadUserMod("voteMod(1)"), null);
  assert.ok(krunkerHosted("https://user-assets.krunker.io/md3466/mod.zip"));
  assert.ok(!krunkerHosted("https://www.dropbox.com/s/x/CSGO_S3.zip?dl=0"));
  assert.ok(!krunkerHosted("https://krunker.io.evil.com/mod.zip"));
});

test("ranked tier progress", () => {
  const tiers = parseTiers("Gold 1500\nBronze 0\nSilver 1000\nnot a tier");
  assert.deepEqual(tiers.map((t) => t.name), ["Bronze", "Silver", "Gold"]);
  assert.deepEqual(tierProgress(1250, tiers), { tier: tiers[1], next: tiers[2], progress: 0.5, toGo: 250 });
  assert.deepEqual(tierProgress(2000, tiers), { tier: tiers[2], next: null, progress: 1, toGo: 0 });
  assert.equal(tierProgress(1500, tiers).tier.name, "Gold");
});

test("the current season comes from the newest match", () => {
  assert.equal(latestSeason([{ season: 15 }, { season: 16 }, { season: "x" }]), 16);
  assert.equal(latestSeason([]), null);
});
