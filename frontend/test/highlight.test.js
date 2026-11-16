import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightCss } from "../src/lib/highlight.js";

const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const spans = (html, kind) => [...html.matchAll(new RegExp(`<span class="mc-hl-${kind}">([^<]*)</span>`, "g"))].map((m) => m[1].trim());

test("the highlighted text is exactly the source, so it lines up under the textarea", () => {
  const samples = [
    "",
    "a > b { content: \"}{;\"; color: #fff !important } /* x < y & z */",
    "@media (max-width: 600px) { .a:hover::after { margin: -1.5em 0 .5px } }\n@import url('x.css');",
    "/* unterminated { comment",
    "#id{top:0}}}  stray ; : / tokens",
  ];
  for (const sample of samples) assert.equal(text(highlightCss(sample)), sample);
});

test("properties, values, colors, numbers and !important get their own classes", () => {
  const html = highlightCss("a { color: #fff !important; margin: 10px 2.5em; }");
  assert.deepEqual(spans(html, "sel"), ["a"]);
  assert.deepEqual(spans(html, "prop"), ["color", "margin"]);
  assert.deepEqual(spans(html, "color"), ["#fff"]);
  assert.deepEqual(spans(html, "imp"), ["!important"]);
  assert.deepEqual(spans(html, "num"), ["10px", "2.5em"]);
});

test("rules inside @media are selectors again; strings and comments don't confuse the state", () => {
  const html = highlightCss('@media (min-width: 1px) { .b { content: "{"; top: 0 } } .c { left: 1px }');
  assert.deepEqual(spans(html, "at"), ["@media"]);
  assert.deepEqual(spans(html, "prop"), ["content", "top", "left"]);
  assert.ok(spans(html, "sel").includes(".b"));
  assert.ok(spans(html, "sel").includes(".c"));
});

test("digits inside names are not numbers", () => {
  const html = highlightCss("a { transform: translate3d(0, 0, 0); color: var(--x-2) }");
  assert.deepEqual(spans(html, "num"), ["0", "0", "0"]);
});
