import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanLayout, layoutCss } from "../src/lib/hudLayout.js";

const known = ["#ammo", "#chat", "#timer"];

test("a stored layout keeps only known elements, with sane numbers", () => {
  const raw = {
    "#ammo": { x: "12", y: -4.5, s: 9, hide: "yes" },
    "#chat": { x: null, y: "abc", s: 0.01, hide: true },
    "#timer": { x: 0, y: 0, s: 1, hide: false },
    "body{}#x": { x: 1 },
  };
  assert.deepEqual(cleanLayout(raw, known), {
    "#ammo": { x: 12, y: -4.5, s: 4, hide: false },
    "#chat": { x: 0, y: 0, s: 0.25, hide: true },
  });
  assert.deepEqual(cleanLayout(null, known), {});
  assert.deepEqual(cleanLayout("junk", known), {});
});

test("hidden elements stay editable: they show faintly in edit mode", () => {
  const text = layoutCss({ "#chat": { x: 5, y: 6, s: 1.5, hide: true } });
  assert.match(text, /#chat \{ translate: 5px 6px !important; scale: 1.5 !important; visibility: hidden !important; \}/);
  assert.match(text, /html\.mc-hud-edit #chat \{ visibility: visible !important; opacity: 0\.35 !important; \}/);
});
