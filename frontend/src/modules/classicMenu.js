// Classic menu: a compact, classic-style layout. The side menu becomes a row of icon tiles along the bottom, the play
// cards get smaller, and the match info and class preview move up to make room. It only moves and restyles
// Krunker's own elements, so every button keeps working. CSS only.
// shortcut: built from memory of Krunker's older menus, not checked against Season 9 screenshots; adjust once we have them.

import { liveCss } from "../lib/style.js";

const CSS = `
#menuItemContainer {
  top: auto !important; left: 50% !important; bottom: 120px !important; translate: -50% 0;
  flex-direction: row !important; align-items: stretch !important; gap: 6px !important;
}
#menuItemContainer .sidebarDivider, #menuItemContainer .bpMeta { display: none !important; }
#menuItemContainer .bpInfo { display: contents !important; }
#menuItemContainer .menuItem {
  flex-direction: column !important; justify-content: center !important; gap: 6px !important;
  min-width: 96px; height: 84px; padding: 8px 12px !important; box-sizing: border-box; text-align: center;
  background: rgba(0, 0, 0, 0.55); border: 2px solid rgba(255, 255, 255, 0.15); border-radius: 4px;
}
#menuItemContainer .menuItem:hover { transform: translateY(-4px) !important; border-color: #fff; }
#menuItemContainer .menuItem:active { transform: translateY(-2px) scale(0.97) !important; }
#menuItemContainer .menuItemIcon, #menuItemContainer .guideIcon { font-size: 32px !important; width: 32px !important; height: 32px !important; margin: 0 !important; }
#menuItemContainer .menuItemTitle { font-size: 16px !important; letter-spacing: 1px !important; line-height: 1 !important; white-space: nowrap; }
#matchInfoHolder { bottom: 222px !important; }
#menuClassContainer { bottom: 290px !important; }
#subLogoButtons { bottom: 230px !important; gap: 6px !important; }
#subLogoButtons .actionCard { width: 230px !important; height: 48px !important; }
`;

const mod = {
  id: "classicMenu",
  name: "Classic menu",
  desc: "A compact, classic-style layout: menu buttons as a row of tiles along the bottom. Every button still works.",
  category: "Look",
  defaultOn: false,
  live: true,
  init: () => apply(),
};
const apply = liveCss(mod, 20, () => CSS);
export default mod;
