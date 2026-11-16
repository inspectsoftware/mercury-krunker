import { test } from "node:test";
import assert from "node:assert/strict";
import { guides, snap } from "../src/lib/snap.js";

const view = { w: 1000, h: 600 };

test("a box near the screen's edge sticks to it", () => {
  const lines = guides(view, []);
  assert.deepEqual(snap({ x: 4, y: 310, w: 100, h: 50 }, lines), { dx: -4, dy: 0, gx: 0, gy: null });
  assert.deepEqual(snap({ x: 520, y: 547, w: 100, h: 50 }, lines), { dx: 0, dy: 3, gx: null, gy: 600 });
});

test("a box's center sticks to the screen's center lines", () => {
  const r = snap({ x: 447, y: 270, w: 100, h: 60 }, guides(view, []));
  assert.equal(r.dx, 3); // center 497 → 500
  assert.equal(r.dy, 0); // center already at 300
  assert.equal(r.gy, 300);
});

test("nothing snaps beyond the threshold", () => {
  assert.deepEqual(snap({ x: 200, y: 200, w: 100, h: 50 }, guides(view, []), 6), { dx: 0, dy: 0, gx: null, gy: null });
});

test("the nearest guide wins, and other boxes' edges are guides too", () => {
  const other = { x: 300, y: 100, w: 50, h: 50 };
  // left edge at 352: 2px from other's right edge (350); its center 377 is 2.5px from nothing nearer
  const r = snap({ x: 352, y: 210, w: 50, h: 20 }, guides(view, [other]));
  assert.equal(r.dx, -2);
  assert.equal(r.gx, 350);
});
