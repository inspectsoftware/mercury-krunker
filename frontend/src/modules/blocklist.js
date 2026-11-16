// The URL blocklist lives in the host (src/resources.rs, on the IO thread); this module only edits it.
// Changes apply right away: the host reloads the list whenever settings are saved.

import { call } from "../core/host.js";
import * as settings from "../core/settings.js";
import { toast } from "../core/dom.js";

export default {
  id: "blocklist",
  name: "URL blocklist",
  desc: "Blocks ads, trackers and social widgets before they load: less work for the page, fewer processes. Your resource swaps always win.",
  category: "Performance",
  perf: true,
  live: true,
  settings: [
    {
      key: "entries",
      label: "Blocked",
      desc: "One per line. A domain blocks itself and its subdomains; an entry with a / blocks URLs that contain it.",
      type: "list",
      loadDefault: async () => (await call("blocklist.defaults")).join("\n"),
    },
    {
      key: "reset",
      label: "Reset the list",
      type: "action",
      button: "Reset",
      run: () => {
        settings.reset("blocklist.entries");
        toast("Blocklist reset to the defaults.");
      },
    },
  ],
};
