// Ranked match alert: when Krunker finds a ranked match while Mercury is in the background, flash its taskbar
// button or bring the window to the front (the host's window.attention).

import { call } from "../core/host.js";
import * as registry from "../core/modules.js";
import * as settings from "../core/settings.js";
import { onRankedMatch } from "../lib/ranked.js";

const id = "rankedAlert";

const mod = {
  id,
  name: "Ranked match alert",
  desc: "When a ranked match is found while you are tabbed out, Mercury gets your attention.",
  category: "Ranked",
  settings: [
    {
      key: "mode",
      label: "How",
      type: "select",
      default: "front",
      options: [["front", "Bring the window to the front"], ["flash", "Flash the taskbar button"]],
    },
  ],
  init() {
    onRankedMatch((found) => {
      if (found && registry.enabled(mod) && !document.hasFocus()) call("window.attention", { mode: settings.get(`${id}.mode`) }).catch(() => {});
    });
  },
};

export default mod;
