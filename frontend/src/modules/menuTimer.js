// Menu timer: the match's time left, shown in the menu while you are in a lobby. Krunker keeps counting in its HUD
// timer (#timerVal) while the menu is open; this mirrors that text under the logo. Move it with the HUD editor.

import { css, h, waitFor } from "../core/dom.js";

const CSS = `
#mc-menu-timer {
  position: absolute; top: 212px; left: 50%; z-index: 11; translate: -50% 0; display: flex; align-items: center; gap: 8px;
  padding: 6px 16px; font-size: 30px; color: var(--mc-ink); background: var(--mc-plate); border-radius: var(--mc-radius); pointer-events: none;
  font-variant-numeric: tabular-nums;
}
#mc-menu-timer .material-icons { font-size: 28px; opacity: 0.8; }
#uiBase:not(.onMenu) #mc-menu-timer, #mc-menu-timer.empty { display: none; }
html.mc-hud-edit #mc-menu-timer { display: flex !important; }
`;

export default {
  id: "menuTimer",
  name: "Menu timer",
  desc: "The match's time left, under the logo while you are in the menu.",
  category: "HUD",
  async init() {
    css(CSS, "mc-menu-timer-css");
    const [timer, base] = await Promise.all([waitFor("#timerVal"), waitFor("#uiBase")]);
    const text = h("span", {}, "--:--");
    const el = h("div", { id: "mc-menu-timer", class: "empty" }, h("span", { class: "material-icons" }, "timer"), text);
    base.append(el);
    const update = () => {
      const value = timer.textContent.trim();
      el.classList.toggle("empty", !value);
      text.textContent = value || "--:--";
    };
    new MutationObserver(update).observe(timer, { childList: true, characterData: true, subtree: true });
    update();
  },
};
