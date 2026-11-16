// Real ping: the player's round trip to every Krunker region, measured by the host with TCP connects to the same
// lobby servers Krunker's own Find Game pings (it fetches https://lobby-…/ping, which adds TLS and HTTP on top).
// Shown in a small panel and next to each region in Krunker's Find Game window, optionally fastest first.

import { h, waitFor } from "../core/dom.js";
import { onKey } from "../core/hotkeys.js";
import * as registry from "../core/modules.js";
import * as settings from "../core/settings.js";
import { REGIONS, regionName } from "../lib/lobbies.js";
import { ago } from "../lib/krunker.js";
import { isOpen, panel, pingTag } from "../lib/panel.js";
import { lastPings, regionPings } from "../lib/pings.js";

const id = "realPing";
const opt = (key) => settings.get(`${id}.${key}`);
const byName = Object.fromEntries(Object.entries(REGIONS).map(([key, name]) => [name, key]));

async function showPanel(fresh = false) {
  const p = panel({ id: "pings", title: "Ping", width: 300 });
  const render = () => {
    const { pings, t } = lastPings();
    const rows = Object.keys({ ...REGIONS, ...pings }).sort((a, b) => (pings[a] ?? 1e9) - (pings[b] ?? 1e9));
    p.setStatus(t ? `measured ${ago(t)}` : "");
    p.body.replaceChildren(
      ...rows.map((key) => h("div", { class: "mc-panel-row", style: { justifyContent: "space-between", margin: "0 0 4px" } }, regionName(key), pingTag(pings[key]))),
      h("div", { class: "mc-panel-actions" }, h("button", { class: "mc-btn", onclick: () => measure(0) }, "Measure again")),
    );
  };
  const measure = (maxAge) => {
    p.setStatus("measuring…");
    regionPings(maxAge).then(render, (e) => p.setStatus(`failed: ${e.message}`));
  };
  render();
  measure(fresh ? 0 : 30000);
}

/** Puts each region's ping in Krunker's Find Game list and, if asked, sorts the regions fastest first. */
function decorate(holder) {
  const { pings } = lastPings();
  const heads = [...holder.children].filter((el) => el.classList.contains("setHed"));
  for (const head of heads) {
    const key = byName[[...head.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())?.textContent.trim()];
    if (!key) continue;
    head.dataset.mcRegion = key;
    const fresh = pingTag(pings[key]);
    fresh.classList.add("mc-server-ping");
    const tag = head.querySelector(".mc-server-ping");
    // Our own changes wake the observer again: only touch what differs, or it would never settle.
    if (tag?.textContent === fresh.textContent) continue;
    tag ? tag.replaceWith(fresh) : head.querySelector(".plusOrMinus")?.nextSibling?.after(fresh);
  }
  if (!opt("sortRegions")) return;
  // Each region header is followed by its server rows while expanded; they move together. Krunker's own entries
  // (Official Customs, Custom Games) stay on top.
  const groups = [];
  for (const el of holder.children) {
    if (el.classList.contains("setHed") || !groups.length) groups.push([el]);
    else groups.at(-1).push(el);
  }
  const ping = (group) => (group[0].dataset.mcRegion ? pings[group[0].dataset.mcRegion] ?? 1e9 : -1);
  const sorted = groups.map((g, i) => [g, i]).sort((a, b) => ping(a[0]) - ping(b[0]) || a[1] - b[1]).map(([g]) => g);
  if (sorted.every((g, i) => g === groups[i])) return;
  holder.append(...sorted.flat());
}

function watchFindGame() {
  let measuredFor = null;
  const update = () => {
    const holder = document.getElementById("serverHolder");
    if (!holder || !registry.enabled(mod)) return;
    if (measuredFor !== holder) {
      measuredFor = holder;
      regionPings().then(() => decorate(holder), () => {});
    }
    decorate(holder);
  };
  waitFor("#menuWindow").then((menu) => new MutationObserver(update).observe(menu, { childList: true, subtree: true }));
}

onKey(`${id}.key`, () => registry.enabled(mod) && (isOpen("pings") ? null : showPanel()));

const mod = {
  id,
  name: "Real ping",
  desc: "Your real round trip to every Krunker region, measured with TCP connects to its lobby servers.",
  category: "Matchmaking",
  settings: [
    { key: "show", label: "Ping to every region", type: "action", button: "Show", run: () => showPanel(true) },
    { key: "key", label: "Show the ping panel", type: "key", default: "" },
    { key: "findGame", label: "Ping in Find Game", desc: "Each region in Krunker's Find Game window shows your ping.", type: "bool", default: true },
    { key: "sortRegions", label: "Fastest regions first in Find Game", type: "bool", default: true },
  ],
  init() {
    if (opt("findGame")) watchFindGame();
  },
};

export default mod;
