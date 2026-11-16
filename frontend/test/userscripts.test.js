import { test } from "node:test";
import assert from "node:assert/strict";
import { comboFromKeybind, formatOf, keybindFromCombo, mapSettings, parseMeta, runOrder, scriptId } from "../src/lib/userscripts.js";

test("metadata block, run-at and priority", () => {
  const code = `// ==UserScript==
// @name  My Script
// @author Someone
// @version 1.2
// @desc Does things
// @run-at document-start
// @priority 5
// ==/UserScript==
"use strict";`;
  assert.deepEqual(parseMeta(code), { runAt: "document-start", priority: 5, name: "My Script", author: "Someone", version: "1.2", desc: "Does things" });
  assert.deepEqual(parseMeta("console.log(1)"), { runAt: "document-end", priority: 0 });
  assert.equal(parseMeta("// ==UserScript==\n// @run-at bogus\n// ==/UserScript==").runAt, "document-end");
});

test("format detection", () => {
  assert.equal(formatOf("module.exports = { run() {} };"), "idkr");
  assert.equal(formatOf("this.settings = {}; return this;"), "crankshaft");
});

test("run order: priority first, then file name", () => {
  const s = [{ file: "b.js", meta: { priority: 0 } }, { file: "a.js", meta: { priority: 0 } }, { file: "z.js", meta: { priority: 3 } }];
  assert.deepEqual(s.sort(runOrder).map((x) => x.file), ["z.js", "a.js", "b.js"]);
});

test("keybinds round-trip between Crankshaft objects and Mercury combos", () => {
  assert.equal(comboFromKeybind({ ctrl: true, alt: false, shift: true, key: "k" }), "Ctrl+Shift+K");
  assert.equal(comboFromKeybind({ key: "F6" }), "F6");
  assert.deepEqual(keybindFromCombo("Ctrl+Shift+K"), { ctrl: true, alt: false, shift: true, key: "k" });
  assert.deepEqual(keybindFromCombo(""), { ctrl: false, alt: false, shift: false, key: "" });
});

test("settings map to Mercury definitions for both formats", () => {
  const cs = mapSettings("crankshaft", {
    on: { title: "On", type: "bool", value: true },
    n: { title: "N", type: "num", value: 3, max: 10 },
    s: { title: "S", type: "sel", value: "b", opts: ["a", "b"] },
    k: { title: "K", type: "keybind", value: { key: "q", alt: true } },
    bad: { title: "?", type: "weird", value: 1 },
  });
  assert.deepEqual(cs.map((x) => [x.key, x.def.type, x.def.default]), [["on", "bool", true], ["n", "number", 3], ["s", "select", "b"], ["k", "key", "Alt+Q"]]);
  assert.equal(cs[1].def.min, 0);
  assert.deepEqual(cs[3].toScript("Alt+Q"), { ctrl: false, alt: true, shift: false, key: "q" });

  const idkr = mapSettings("idkr", {
    a: { name: "A", type: "checkbox", val: false },
    b: { name: "B", type: "slider", val: "2", min: 0, max: 5, step: 0.5 },
    c: { name: "C", type: "select", val: "x", options: { x: "Ex", y: "Why" } },
    d: { name: "D", type: "text", val: "hi", placeholder: "type" },
  });
  assert.deepEqual(idkr.map((x) => [x.key, x.def.type, x.def.default]), [["a", "bool", false], ["b", "number", 2], ["c", "select", "x"], ["d", "text", "hi"]]);
  assert.deepEqual(idkr[2].def.options, [["x", "Ex"], ["y", "Why"]]);
  assert.deepEqual(mapSettings("idkr", null), []);
});

test("script ids are safe inside setting ids", () => {
  assert.equal(scriptId("My Cool.Script.js"), "My_Cool_Script");
});
