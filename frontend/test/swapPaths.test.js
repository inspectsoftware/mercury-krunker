import { test } from "node:test";
import assert from "node:assert/strict";
import { guessPath, swapPath } from "../src/lib/swapPaths.js";

test("pasted URLs and Windows paths become swap paths", () => {
  assert.equal(swapPath("https://assets.krunker.io/textures/ammo_0.png?build=abc"), "textures/ammo_0.png");
  assert.equal(swapPath("  \\img\\skull_0.png "), "img/skull_0.png");
  assert.equal(swapPath("/css/main_custom.css#x"), "css/main_custom.css");
});

test("paths that could leave the folder, empty ones and Krunker's code are refused", () => {
  for (const bad of ["", "   ", "../x.png", "textures/../../x.png", "a//b.png", "./a.png", "pkg/core.dat-5fHFc.split-0", "static/index-rc6oMoyK.js", "pkg/loader-5fHFc.wasm", "index.html", "x.mjs"]) {
    assert.equal(swapPath(bad), null, bad);
  }
});

test("a dropped file goes where the game loaded a file of the same name", () => {
  const requested = ["textures/ammo_0.png", "img/skull_0.png", "textures/hitmarker_3.png", "a/dup.png", "b/dup.png"];
  assert.deepEqual(guessPath("Ammo_0.PNG", requested), { path: "textures/ammo_0.png", sure: true });
  assert.deepEqual(guessPath("dup.png", requested), { path: "a/dup.png", sure: false });
  assert.deepEqual(guessPath("new.mp3", requested), { path: "sound/new.mp3", sure: false });
  assert.deepEqual(guessPath("notes.xyz", requested), { path: "notes.xyz", sure: false });
});
