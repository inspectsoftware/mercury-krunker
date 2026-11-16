// Mercury icons: our own SVGs for the kill counter, ammo, hitmarker, reticle and scope, all five with one switch.
// Krunker draws all five as <img> elements (#killsIcon, #ammoIcon, #hitmarker, #aimDot, #recticleImg), so CSS
// `content: url()` swaps the picture without touching the player's Krunker settings (customKills, customAmmo...),
// and switching the module off brings back whatever the player had.

import { liveCss } from "../lib/style.js";

const svg = (body, view, size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" width="${size}" height="${size}">${body}</svg>`;

// Each drawn at the size Krunker shows its own, so the HUD layout doesn't move.
const ICONS = {
  kills: {
    label: "Kill counter",
    selector: "#killsIcon",
    svg: svg(
      '<path fill="#fff" fill-rule="evenodd" d="M12 2.5c-4.7 0-8.5 3.3-8.5 7.6 0 2.4 1.1 4.3 2.8 5.5v2.9c0 .6.4 1 1 1h1.4v-1.9h1.6v1.9h3.4v-1.9h1.6v1.9h1.4c.6 0 1-.4 1-1v-2.9c1.7-1.2 2.8-3.1 2.8-5.5 0-4.3-3.8-7.6-8.5-7.6zM8.6 8.6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6.8 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 13.1l1.2 2.1h-2.4z"/>',
      24,
      24,
    ),
  },
  ammo: {
    label: "Ammo",
    selector: "#ammoIcon",
    svg: svg(
      '<g fill="#fff"><path d="M5 12c0-3.6 1.6-6.3 3-7.6 1.4 1.3 3 4 3 7.6z"/><rect x="5" y="13.2" width="6" height="14.3" rx=".6"/><path d="M13 12c0-3.6 1.6-6.3 3-7.6 1.4 1.3 3 4 3 7.6z"/><rect x="13" y="13.2" width="6" height="14.3" rx=".6"/><path d="M21 12c0-3.6 1.6-6.3 3-7.6 1.4 1.3 3 4 3 7.6z"/><rect x="21" y="13.2" width="6" height="14.3" rx=".6"/></g>',
      32,
      128,
    ),
  },
  hitmarker: {
    label: "Hitmarker",
    selector: "#hitmarker",
    svg: svg(
      '<g stroke-linecap="round" fill="none"><path d="M30 30l11 11M70 30L59 41M30 70l11-11M70 70L59 59" stroke="#000" stroke-opacity=".55" stroke-width="10"/><path d="M30 30l11 11M70 30L59 41M30 70l11-11M70 70L59 59" stroke="#fff" stroke-width="5"/></g>',
      100,
      150,
    ),
  },
  reticle: {
    label: "Reticle (aim dot)",
    selector: "#aimDot",
    svg: svg(
      '<circle cx="10" cy="10" r="6.5" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="3"/><circle cx="10" cy="10" r="6.5" fill="none" stroke="#6fe3ff" stroke-width="1.4"/><circle cx="10" cy="10" r="2" fill="#6fe3ff" stroke="#000" stroke-opacity=".45" stroke-width=".7"/>',
      20,
      20,
    ),
  },
  scope: {
    label: "Scope",
    selector: "#recticleImg",
    svg: svg(
      '<defs><radialGradient id="v"><stop offset=".86" stop-opacity="0"/><stop offset="1" stop-opacity=".75"/></radialGradient></defs>' +
        '<path fill="#000" fill-rule="evenodd" d="M0 0h200v200H0zM100 4a96 96 0 1 0 0 192a96 96 0 1 0 0-192z"/>' +
        '<circle cx="100" cy="100" r="96" fill="url(#v)"/>' +
        '<g stroke="#000" stroke-width=".7"><path d="M4 100h88M108 100h88M100 4v88M100 108v88"/></g>' +
        '<g stroke="#000" stroke-width="3.2"><path d="M4 100h52M144 100h52M100 144v52"/></g>' +
        '<g fill="#000"><circle cx="76" cy="100" r=".9"/><circle cx="124" cy="100" r=".9"/><circle cx="100" cy="124" r=".9"/><circle cx="100" cy="76" r=".9"/></g>' +
        '<circle cx="100" cy="100" r=".9" fill="#ff4545"/>',
      200,
      1024,
    ),
  },
};

const url = (markup) => `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;

const mod = {
  id: "icons",
  name: "Mercury icons",
  desc: "Our own kill counter, ammo, hitmarker, reticle and scope pictures. Your Krunker settings stay as they are.",
  category: "Look",
  defaultOn: false,
  live: true,
  init: () => apply(),
};

const apply = liveCss(mod, 40, () =>
  Object.values(ICONS)
    .map((icon) => `${icon.selector} { content: ${url(icon.svg)} !important; }`)
    .join("\n"),
);

export default mod;
