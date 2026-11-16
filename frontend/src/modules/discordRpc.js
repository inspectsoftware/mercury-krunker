// Discord Rich Presence from Krunker's own getGameActivity(). The host speaks Discord's local IPC (src/discord.rs);
// this module sends the activity every few seconds when it changes, as Mercury Client's own Discord application.

/** Mercury Client's Discord application: its name, icon and the "mercury" art asset. Public by design. */
const MERCURY_APP_ID = "1571970847302754484";

import { call } from "../core/host.js";
import * as settings from "../core/settings.js";
import { discordActivity } from "../lib/social.js";

const since = Date.now();
let last = null; // what Discord shows now, as JSON
let sentAt = 0;
let pausedUntil = 0;

async function tick() {
  if (!settings.get("discordRpc.enabled")) {
    if (last !== null) call("discord.clear").catch(() => {});
    last = null;
    return;
  }
  if (Date.now() < pausedUntil) return;
  let game = null;
  try {
    game = window.getGameActivity?.();
  } catch {}
  const activity = discordActivity(game, { since, join: settings.get("discordRpc.joinButton") });
  const key = JSON.stringify(activity);
  // Resend now and then too, in case Discord restarted.
  if (key === last && Date.now() - sentAt < 60000) return;
  try {
    await call("discord.activity", { clientId: MERCURY_APP_ID, activity });
    last = key;
    sentAt = Date.now();
  } catch (error) {
    if (error.message === "busy") return;
    // Discord closed or a wrong ID: try again later, quietly.
    console.info("[mercury] Discord presence:", error.message);
    last = null;
    pausedUntil = Date.now() + 30000;
  }
}

export default {
  id: "discordRpc",
  name: "Discord Rich Presence",
  desc: "Shows \"Playing Krunker.io\" with your mode, map and time left on your Discord profile, from Krunker's own activity data.",
  category: "Social",
  settings: [
    {
      key: "joinButton",
      label: "Join button",
      desc: "A button on your profile that opens your lobby. Anyone who sees your profile can join.",
      type: "bool",
      default: false,
      onChange: () => (last = null),
    },
  ],
  init() {
    tick();
    setInterval(tick, 5000);
  },
};
