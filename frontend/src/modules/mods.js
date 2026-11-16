// Mods: a Download button on every mod in Krunker's Mods window (the list, the featured mod and the mod page). The
// zip URL is the one Krunker's own Load button uses; the host saves it to Downloads (src/mods.rs, krunker.io only).
// A mod hosted elsewhere (Dropbox) opens in the browser instead. Lobby, map and mod links that would open a popup load
// in the game window (host: browser.rs on_before_popup, setting mods.linksInGame).

import { css, h, toast, waitFor } from "../core/dom.js";
import { call } from "../core/host.js";
import { krunkerHosted, parseLoadUserMod } from "../lib/social.js";

const known = new Map(); // mod name → zip URL, from the Load buttons seen so far

async function download({ name, url }) {
  if (!krunkerHosted(url)) {
    toast("This mod is hosted outside Krunker: it opens in your browser.");
    return call("shell.open", { url }).catch((e) => toast(`Could not open it: ${e.message}`));
  }
  toast(`Downloading ${name}…`);
  try {
    toast(`Saved to ${await call("mods.download", { url, name })}`, 6000);
  } catch (e) {
    toast(`Download failed: ${e.message}`);
  }
}

const onClick = (mod) => (e) => {
  e.preventDefault();
  e.stopPropagation();
  download(mod);
};

/** The list and the featured banner: next to each Load button. */
function addToList(root) {
  for (const load of root.querySelectorAll("[onclick*='loadUserMod']")) {
    const mod = parseLoadUserMod(load.getAttribute("onclick"));
    if (!mod) continue;
    known.set(mod.name, mod.url);
    if (load.nextElementSibling?.classList.contains("mc-mod-dl") || load.nextElementSibling?.nextElementSibling?.classList.contains("mc-mod-dl")) continue;
    if (load.classList.contains("mapActionB")) {
      const icon = h("span", { class: "material-icons", style: { fontSize: "70px", color: "#fff" } }, "download");
      load.after(h("div", { class: "mapActionSep" }), h("div", { class: "mapActionB mc-mod-dl", title: "Download", onclick: onClick(mod) }, icon));
    } else {
      const icon = h("span", { class: "material-icons" }, "download");
      load.after(h("div", { class: "mc-mod-dl mc-mod-dl-big", title: "Download the mod's zip", onclick: onClick(mod) }, "Download ", icon));
    }
  }
}

/** The mod page (a Svelte view): next to Use. */
function addToPage(root) {
  const page = root.querySelector(".mod-root");
  const actions = page?.querySelector(".mod-actions");
  if (!actions || actions.querySelector(".mc-mod-dl")) return;
  const name = page.querySelector(".mod-header-title")?.textContent.trim();
  // Uploaded mods live next to their thumbnail: user-assets.krunker.io/md<id>/{thumb.png,mod.zip}.
  const folder = /^https:\/\/user-assets\.krunker\.io\/md\d+\//.exec(page.querySelector(".mod-thumb")?.src ?? "")?.[0];
  const url = known.get(name) ?? (folder && `${folder}mod.zip`);
  if (!name || !url) return;
  const like = actions.querySelector(".mod-icon-btn");
  const icon = h("i", { class: like?.querySelector("i")?.className ?? "material-icons" }, "download");
  actions.append(h("button", { class: `${like?.className ?? ""} mc-mod-dl`, type: "button", title: "Download", onclick: onClick({ name, url }) }, icon));
}

async function watch(selector, add) {
  const root = await waitFor(selector);
  let queued = false;
  const run = () => ((queued = false), add(root));
  run();
  new MutationObserver(() => queued || ((queued = true), requestAnimationFrame(run))).observe(root, { childList: true, subtree: true });
}

css(
  // Above Krunker's "Load Mod" (right: 30px, bottom: 30px, 240 × 37 + padding), in the same shape.
  `.mc-mod-dl-big { position: absolute; right: 30px; bottom: 99px; width: 240px; height: 37px; padding: 10px 6px 6px; box-sizing: content-box;
     text-align: center; font-size: 21px; color: #fff; background: rgba(0, 0, 0, 0.6); border: 3px solid rgba(255, 255, 255, 0.6);
     border-radius: 6px; cursor: pointer; }
   .mc-mod-dl-big:hover { background: rgba(255, 255, 255, 0.15); }
   .mc-mod-dl-big .material-icons { font-size: 30px; vertical-align: top; margin-top: -3px; }`,
  "mercury-mods",
);

export default {
  id: "mods",
  name: "Mods",
  desc: "A Download button on every mod in the Mods window. Saves the mod's zip to your Downloads folder.",
  category: "Social",
  live: true,
  settings: [
    {
      key: "linksInGame",
      label: "Game links open in the game",
      desc: "Lobby, map and mod links that would open a new window load in the game window instead.",
      type: "bool",
      default: true,
    },
  ],
  init() {
    watch("#windowHolder", addToList);
    watch(".view-stack", addToPage);
  },
};
