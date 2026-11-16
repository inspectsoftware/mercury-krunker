// Streamer mode (M9): hides what viewers shouldn't see, with CSS only: player names in the HUD and menus, the lobby
// and invite links, and chat. A hotkey switches it on and off without opening the settings.

import { css } from "../core/dom.js";
import { hotkey } from "../core/hotkeys.js";
import * as settings from "../core/settings.js";

const ID = "streamerMode.enabled";

// Krunker's element ids, as found in its page on 2026-11-16. Names: the in-game and end-of-game leaderboards, the
// kill feed, spectator names and vote-kick names. Links: the lobby line (map, region, invite), the invite button,
// the server info and the custom game name. Chat: the chat box.
// shortcut: nametags above players are drawn in the game canvas, out of CSS's reach (Krunker's own "Nametag Display"
// setting hides them); the signed-in account name has no verified selector yet (it only exists after login).
const HIDE = {
  names: ["#leaderboardHolder", "#centerLeaderDisplay", "#killFeed", "#specNames", "#specNamesF", "#specNameTm0", "#specNameTm1", "#voteKickName", "#endTabbedView"],
  links: ["#matchInfoHolder", "#inviteButton", "#menuServerInfoContainer", "#gameNameHolder"],
  chat: ["#chatHolder"],
};

let style = null;

function apply() {
  const on = settings.get(ID);
  const selectors = on ? Object.keys(HIDE).filter((k) => settings.get(`streamerMode.${k}`)).flatMap((k) => HIDE[k]) : [];
  if (!selectors.length) {
    style?.remove();
    style = null;
    return;
  }
  style = css(`${selectors.join(",\n")} { visibility: hidden !important; }`, "mercury-streamer");
}

hotkey({
  id: "streamerMode.key",
  label: "Streamer mode on/off",
  key: "Ctrl+Shift+S",
  category: "Streaming",
  handler: () => settings.set(ID, !settings.get(ID)),
});

export default {
  id: "streamerMode",
  name: "Streamer mode",
  desc: "Hides player names, lobby and invite links, and chat from your stream.",
  category: "Streaming",
  defaultOn: false,
  live: true,
  settings: [
    { key: "names", label: "Hide player names", type: "bool", default: true, onChange: apply },
    { key: "links", label: "Hide lobby and invite links", type: "bool", default: true, onChange: apply },
    { key: "chat", label: "Hide chat", type: "bool", default: true, onChange: apply },
  ],
  init: apply,
};

// The switch and the hotkey work live in both directions (init only runs while the module is on).
settings.onChange(ID, apply);
