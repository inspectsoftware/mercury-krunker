// Mercury look: an optional dark skin for Krunker's menu, windows, popups, chat and HUD (mercuryCss.css).

import { liveCss } from "../lib/style.js";
import text from "./mercuryCss.css";

const mod = {
  id: "mercuryCss",
  name: "Mercury look",
  desc: "A dark, quiet skin for Krunker's menu, windows, popups, chat and HUD.",
  category: "Look",
  defaultOn: false,
  live: true,
  init: () => apply(),
};
const apply = liveCss(mod, 10, () => text);
export default mod;
