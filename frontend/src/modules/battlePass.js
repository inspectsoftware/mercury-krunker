// Battle pass claim-all: a button in Krunker's battle pass window (windows[5], opened by openBattlePass) that presses
// Krunker's own claim buttons (windows[5].claimItem) one after another. The free track's ad-gated claims
// (freeclaimItem, which plays an ad) are left alone.

import { css, h, toast, waitFor } from "../core/dom.js";

const CLAIM = "#menuWindow [onclick*='claimItem(']:not([onclick*='freeclaimItem'])";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;

async function until(check, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (check()) return true;
  return false;
}

async function claimAll() {
  if (busy) return;
  busy = true;
  let claimed = 0;
  try {
    for (let i = 0; i < 200; i++) {
      const button = document.querySelector(CLAIM);
      if (!button) break;
      button.click();
      // Krunker redraws the window once the claim went through, which takes this button away.
      if (!(await until(() => !button.isConnected, 8000))) {
        toast("A claim did not go through; stopped.");
        break;
      }
      claimed++;
      await sleep(250);
    }
  } finally {
    busy = false;
  }
  toast(claimed ? `Claimed ${claimed} reward${claimed === 1 ? "" : "s"}.` : "Nothing to claim.");
}

function addButton(menu) {
  const count = menu.querySelectorAll(CLAIM.replace("#menuWindow ", "")).length;
  const existing = menu.querySelector(".mc-bp-all");
  const label = `Claim all (${count})`;
  if (count < 2 || busy) return existing?.remove();
  // Only write on a change: our own writes come back through the observer.
  if (existing) return existing.textContent !== label && (existing.textContent = label);
  menu.prepend(h("div", { class: "mc-bp-all", onclick: claimAll, onmouseenter: () => window.playTick?.() }, label));
}

css(
  `.mc-bp-all { position: sticky; top: 0; float: right; z-index: 5; margin: 0 0 6px 8px; padding: 8px 18px; border-radius: 6px; cursor: pointer;
     font-size: 18px; color: #fff; background: #2f86c2; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4); }
   .mc-bp-all:hover { background: #3b97d6; }`,
  "mercury-battle-pass",
);

export default {
  id: "battlePass",
  name: "Battle pass: claim all",
  desc: "A Claim all button in the battle pass window. It presses Krunker's claim buttons for you, one by one; ad-gated rewards are skipped.",
  category: "Social",
  live: true,
  async init() {
    const menu = await waitFor("#menuWindow");
    let queued = false;
    new MutationObserver(() => queued || ((queued = true), requestAnimationFrame(() => ((queued = false), addButton(menu))))).observe(menu, {
      childList: true,
      subtree: true,
    });
  },
};
