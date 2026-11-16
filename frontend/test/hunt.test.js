import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, begin } from "../src/lib/hunt.js";

// The player's answer for one step: the problem is gone only while the culprit is switched off.
const run = (modules, culprit) => {
  let state = begin(modules);
  let steps = 0;
  while (!state.found && !state.none) {
    state = advance(state, !state.off.includes(culprit));
    steps++;
  }
  return { ...state, steps };
};

test("finds every possible culprit within log2(n) + 1 steps", () => {
  for (const n of [1, 2, 3, 7, 8, 31]) {
    const modules = Array.from({ length: n }, (_, i) => `m${i}`);
    for (const culprit of modules) {
      const result = run(modules, culprit);
      assert.equal(result.found, culprit, `n=${n}`);
      assert.ok(result.steps <= Math.ceil(Math.log2(n)) + 1, `n=${n} took ${result.steps}`);
    }
  }
});

test("reports no culprit when the problem never goes away", () => {
  const modules = ["a", "b", "c", "d", "e"];
  const result = run(modules, "not-a-module");
  assert.equal(result.none, true);
  assert.equal(result.found, undefined);
});

test("nothing to search", () => {
  assert.deepEqual(begin([]), { none: true });
});
