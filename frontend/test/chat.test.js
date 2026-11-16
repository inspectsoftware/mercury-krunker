import { test } from "node:test";
import assert from "node:assert/strict";
import { capped, filterLog, gameLink, parseLine, splitLinks } from "../src/lib/chat.js";

test("parses Krunker's chat lines, direction marks included", () => {
  // As #chatList renders them: names and messages wrapped in U+200E.
  assert.deepEqual(parseLine("‎Die_Rate‎: ‎GGs Check my cheap listings‎"), { name: "Die_Rate", text: "GGs Check my cheap listings" });
  assert.deepEqual(parseLine("‎Stonepilot left the game‎"), { name: "", text: "Stonepilot left the game" });
  assert.deepEqual(parseLine("Name [VAST]: hi: there"), { name: "Name [VAST]", text: "hi: there" });
});

test("finds links with and without a scheme, without trailing punctuation", () => {
  assert.deepEqual(splitLinks("join krunker.io/?game=FRA:n12t0 now"), [
    { text: "join " },
    { text: "krunker.io/?game=FRA:n12t0", url: "https://krunker.io/?game=FRA:n12t0" },
    { text: " now" },
  ]);
  assert.deepEqual(splitLinks("see https://example.com/x."), [{ text: "see " }, { text: "https://example.com/x", url: "https://example.com/x" }, { text: "." }]);
  assert.deepEqual(splitLinks("no links here"), [{ text: "no links here" }]);
  // Krunker's direction marks around a message are not part of the link.
  assert.equal(splitLinks("‎https://krunker.io/?game=X‎")[1].url, "https://krunker.io/?game=X");
});

test("only game-page links load in the game window", () => {
  assert.equal(gameLink("https://krunker.io/?game=FRA:n12t0"), "https://krunker.io/?game=FRA:n12t0");
  assert.equal(gameLink("http://www.krunker.io/?game=X"), "https://krunker.io/?game=X");
  assert.equal(gameLink("https://krunker.io/social.html?p=profile"), null);
  assert.equal(gameLink("https://krunker.io.evil.com/?game=X"), null);
});

test("the log keeps the newest lines", () => {
  assert.deepEqual(capped([1, 2, 3], [4, 5], 4), [2, 3, 4, 5]);
});

test("filters the log by player and text", () => {
  const lines = [
    { t: 1, name: "Die_Rate", text: "gg" },
    { t: 2, name: "Other [VAST]", text: "nice shot" },
    { t: 3, name: "", text: "Die_Rate left the game" },
  ];
  assert.deepEqual(filterLog(lines, { player: "die_rate" }).map((l) => l.t), [1]);
  assert.deepEqual(filterLog(lines, { player: "other" }).map((l) => l.t), [2]);
  assert.deepEqual(filterLog(lines, { query: "die_rate" }).map((l) => l.t), [1, 3]);
  assert.deepEqual(filterLog(lines, { query: "SHOT" }).map((l) => l.t), [2]);
  assert.equal(filterLog(lines).length, 3);
});
