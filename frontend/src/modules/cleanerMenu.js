// Cleaner menu: hides Krunker's promos in the menu: the store ad and the ad slot beside it, the live streams panel,
// the "Popular Now" maps, the bottom ad bar, the app promo and the end screen's ad holders. The logo, every button
// and the match info stay. CSS only.

import { liveCss } from "../lib/style.js";

const CSS = `
#topLeftAdHolder, #adCon, #tlInfHold [class*="streams-overlay"],
#subLogoButtons [class*="popRail"],
#aContainer, #phonePop { display: none !important; }
#endAHolderL, #endAHolderR { visibility: hidden !important; }
`;

const mod = {
  id: "cleanerMenu",
  name: "Cleaner menu",
  desc: "Hides the store ad, ad slots, live streams, Popular Now and the app promo. Every button stays.",
  category: "Look",
  live: true,
  init: () => apply(),
};
const apply = liveCss(mod, 30, () => CSS);
export default mod;
