// Now playing: a small overlay with the song Windows' media session reports (Spotify, browsers, any player that
// shows in the volume flyout). The host reads it (src/media.rs); the page asks every 2.5 s.

import { css, h } from "../core/dom.js";
import { call } from "../core/host.js";
import * as settings from "../core/settings.js";

const opt = (key) => settings.get(`nowPlaying.${key}`);
let box = null;

function wanted() {
  const inGame = !!document.pointerLockElement;
  const where = opt("show");
  return where === "both" || (where === "game") === inGame;
}

async function tick() {
  if (!wanted()) return (box.hidden = true);
  let media = null;
  try {
    media = await call("media.current");
  } catch {}
  const show = media?.title && (media.playing || !opt("hidePaused"));
  box.hidden = !show || !wanted();
  if (!show) return;
  box.className = `mc-now ${opt("corner")}${media.playing ? "" : " paused"}`;
  box.replaceChildren(
    h("span", { class: "mc-now-icon" }, media.playing ? "♪" : "❚❚"),
    h("span", { class: "mc-now-title" }, media.title),
    media.artist && h("span", { class: "mc-now-artist" }, media.artist),
  );
}

css(
  `.mc-now { position: fixed; z-index: 2147482000; max-width: 360px; display: flex; align-items: baseline; gap: 8px; padding: 6px 11px;
     font: 16px/1.25 var(--mc-font) !important; color: var(--mc-ink); background: var(--mc-plate); border-radius: var(--mc-radius);
     pointer-events: none; }
   .mc-now[hidden] { display: none; }
   .mc-now * { font-family: inherit !important; }
   .mc-now.top-left { top: 12px; left: 12px; } .mc-now.top-right { top: 12px; right: 12px; }
   .mc-now.bottom-left { bottom: 12px; left: 12px; } .mc-now.bottom-right { bottom: 12px; right: 12px; }
   .mc-now.paused { opacity: 0.6; }
   .mc-now-icon { color: var(--mc-gold); }
   .mc-now-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
   .mc-now-artist { color: var(--mc-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  "mercury-now-playing",
);

export default {
  id: "nowPlaying",
  name: "Now playing",
  desc: "The song you are listening to (Spotify or any player Windows knows about), in a corner of the screen.",
  category: "Social",
  defaultOn: false,
  live: true,
  settings: [
    { key: "show", label: "Show", type: "select", default: "both", options: [["both", "In game and in the menu"], ["game", "In game"], ["menu", "In the menu"]] },
    {
      key: "corner",
      label: "Corner",
      type: "select",
      default: "bottom-right",
      options: [["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]],
    },
    { key: "hidePaused", label: "Hide when paused", type: "bool", default: true },
  ],
  init() {
    box = document.body.appendChild(h("div", { class: "mc-now", hidden: true }));
    tick();
    setInterval(tick, 2500);
  },
};
