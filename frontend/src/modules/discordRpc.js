// Discord Rich Presence from Krunker's own getGameActivity(). The host speaks Discord's local IPC (src/discord.rs);
// this module sends the activity every few seconds when it changes. It runs as Mercury Client's own Discord
// application unless the player sets another ID (empty: off).

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
  const clientId = String(settings.get("discordRpc.clientId") ?? "").trim();
  if (!clientId) {
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
  const key = JSON.stringify([clientId, activity]);
  // Resend now and then too, in case Discord restarted.
  if (key === last && Date.now() - sentAt < 60000) return;
  try {
    await call("discord.activity", { clientId, activity });
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
  desc: "Shows your mode, map, class and time left on your Discord profile, from Krunker's own activity data.",
  category: "Social",
  live: true,
  settings: [
    {
      key: "clientId",
      label: "Discord application ID",
      desc: "Mercury Client's own by default. Use your own application's ID for another name or picture; empty turns it off.",
      type: "text",
      default: MERCURY_APP_ID,
      placeholder: "17 to 20 digits",
      onChange: () => ((last = null), (pausedUntil = 0)),
    },
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
