// Clan colors: a local list of clan tag → color, painted on "[TAG]" wherever Krunker shows it (chat, the in-game
// leaderboard and scoreboard, menu windows such as the player list). It uses CSS highlights (::highlight) over text
// ranges, so Krunker's DOM is never changed: Svelte parts keep their text nodes and keep updating.

import { css, waitFor } from "../core/dom.js";
import * as settings from "../core/settings.js";
import { parseClanColors, splitClanTags } from "../lib/social.js";

// Where clan tags appear. Not the whole HUD: parts of it change every frame.
const ROOTS = ["#chatList", "#leaderboardHolder", "#centerLeaderDisplay", "#windowHolder", "#endUI", "#spectateUI"];
const roots = new Set();
let colors = new Map();
let queued = false;

function paint() {
  queued = false;
  const ranges = new Map(); // color → ranges
  for (const root of colors.size ? roots : []) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      let offset = 0;
      for (const part of splitClanTags(node.data, colors) ?? []) {
        if (part.color) {
          const range = new Range();
          range.setStart(node, offset);
          range.setEnd(node, offset + part.text.length);
          if (!ranges.has(part.color)) ranges.set(part.color, []);
          ranges.get(part.color).push(range);
        }
        offset += part.text.length;
      }
    }
  }
  const rules = [];
  for (const name of [...CSS.highlights.keys()]) if (name.startsWith("mc-clan-")) CSS.highlights.delete(name);
  [...ranges].forEach(([color, list], i) => {
    CSS.highlights.set(`mc-clan-${i}`, new Highlight(...list));
    rules.push(`::highlight(mc-clan-${i}) { color: ${color}; }`);
  });
  css(rules.join("\n"), "mercury-clan-colors");
}

// At most once per frame, however much Krunker re-renders.
const queue = () => queued || ((queued = true), requestAnimationFrame(paint));

async function watch(selector) {
  const root = await waitFor(selector);
  roots.add(root);
  queue();
  new MutationObserver(queue).observe(root, { childList: true, subtree: true, characterData: true });
}

export default {
  id: "clanColors",
  name: "Clan colors",
  desc: "Your own colors for clan tags in chat, the leaderboard and the player list. Only you see them.",
  category: "Social",
  live: true,
  settings: [
    {
      key: "colors",
      label: "Clan colors",
      desc: "One clan per line: the tag, then a color. Example: VAST #ff8800",
      type: "list",
      default: "",
      onChange: (text) => {
        colors = parseClanColors(text);
        queue();
      },
    },
  ],
  init() {
    colors = parseClanColors(settings.get("clanColors.colors"));
    if (!window.CSS?.highlights) return console.warn("[mercury] clan colors need CSS highlights");
    ROOTS.forEach(watch);
  },
};
