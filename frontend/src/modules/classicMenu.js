// Classic menu: Krunker's side menu as a block of equal tiles along the bottom, between the chat (bottom left) and
// the play buttons (bottom right): six to a row, at most two rows, wrapping upward. The match info and class preview
// move up to sit above it. It only moves and restyles Krunker's own elements, so every button keeps working. CSS only.
//
// The arithmetic, in Krunker's UI units (it scales #uiBase to a ~1170px-tall layout, so a 16:9 screen is ~2080 wide):
// 6 tiles x 150px + 5 gaps x 6px = 930px, inside the 400px (chat) and 270px (play buttons) margins on 16:9 and 16:10.
// 150px holds 12 GameFont letters at 13px ("LEADERBOARDS"); longer labels take two lines. A tile is 74px: border 4 +
// padding 12 + icon 22 + gap 4 + two lines of 14.3 = 71. Two rows: 2 x 74 + 6 = 154px above a 20px foot, so the
// match info sits at 188px.

import { liveCss } from "../lib/style.js";

const CSS = `
#menuItemContainer {
  top: auto !important; bottom: 20px !important; left: 400px !important; right: 270px !important; width: auto !important;
  max-width: 930px; margin: 0 auto !important; translate: none;
  display: flex !important; flex-direction: row !important; flex-wrap: wrap !important; justify-content: center; align-content: flex-end;
  align-items: stretch !important; gap: 6px !important;
}
#menuItemContainer .sidebarDivider, #menuItemContainer .bpMeta { display: none !important; }
#menuItemContainer .bpInfo { display: contents !important; }
#updateAd:not([style*="none"]) { display: contents !important; }
#menuItemContainer .menuItem {
  flex: 0 0 150px; min-width: 0 !important; height: 74px; box-sizing: border-box; margin: 0 !important; padding: 6px !important;
  flex-direction: column !important; justify-content: center !important; align-items: center !important; gap: 4px !important; text-align: center;
  background: rgba(0, 0, 0, 0.55) !important; border: 2px solid rgba(255, 255, 255, 0.15); border-radius: 2px;
}
#menuItemContainer .menuItem:hover { border-color: #fff; transform: none !important; }
#menuItemContainer .menuItem:active { transform: translateY(1px) !important; }
#menuItemContainer .menuItemIcon, #menuItemContainer .guideIcon { font-size: 22px !important; width: 22px !important; height: 22px !important; margin: 0 !important; flex: none; }
#menuItemContainer .bpItem img { width: 22px !important; height: 22px !important; margin: 0 !important; flex: none; }
#menuItemContainer .menuItemTitle {
  font-size: 13px !important; letter-spacing: 0 !important; line-height: 1.1 !important; flex: none; white-space: normal !important; margin: 0 !important;
  display: -webkit-box !important; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 100%;
}
#matchInfoHolder { bottom: 188px !important; }
#menuClassContainer { bottom: 256px !important; }
#subLogoButtons { bottom: 230px !important; gap: 6px !important; }
#subLogoButtons .actionCard { width: 230px !important; height: 48px !important; }
`;

const mod = {
  id: "classicMenu",
  name: "Classic menu",
  desc: "Krunker's menu buttons as an even block of tiles along the bottom, clear of the chat and the play buttons. Every button still works.",
  category: "Look",
  defaultOn: false,
  live: true,
  init: () => apply(),
};
const apply = liveCss(mod, 20, () => CSS);
export default mod;
