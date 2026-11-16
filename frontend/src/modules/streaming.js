// Streaming (M9): the status of the OBS capture plugin (crates/obs-mercury-capture), and how to get the game's audio
// alone. Game audio needs nothing from Mercury: Chromium plays it from its audio service, a child process of the
// Mercury window's process, and OBS's Application Audio Capture records the picked window's whole process tree
// (checked in obs-studio 33.0.1, plugins/win-wasapi). Moving the audio service into the window's process
// (--disable-features=AudioServiceOutOfProcess) crashes stock CEF 156 at startup, so Mercury doesn't.

import { h } from "../core/dom.js";
import { call } from "../core/host.js";

function captureStatus() {
  const box = h("div", { class: "mc-check" }, "…");
  call("perf.stats")
    .then((s) => {
      const c = s.capture;
      box.replaceChildren(
        h("div", { class: "mc-check-row" }, h("span", { class: `mc-dot ${s.active ? "ok" : "warn"}` }), h("b", {}, "Present hook"), h("span", {}, s.active ? "active" : `${s.stateName}: OBS capture needs it (Engine → Present hook)`)),
        h("div", { class: "mc-check-row" }, h("span", { class: `mc-dot ${c.reader ? "ok" : ""}` }), h("b", {}, "OBS"), h("span", {}, c.reader ? `capturing ${c.size[0]}×${c.size[1]} (${c.frames} frames)` : "no Mercury Client source in OBS right now")),
      );
    })
    .catch((e) => (box.textContent = e.message));
  return box;
}

export default {
  id: "streaming",
  name: "Streaming",
  category: "Streaming",
  toggle: false,
  settings: [
    {
      key: "audio",
      label: "Game audio only",
      desc: "In OBS: Sources → + → Application Audio Capture, then pick the window [MercuryClient.exe]: Mercury Client. It records the game's sound and nothing else (Windows 10 2004 or newer).",
      type: "custom",
      render: () => null, // text only
    },
    {
      key: "obs",
      label: "OBS capture",
      desc: "Add the \"Mercury Client\" source in OBS (plugin: see README → OBS capture). It shows the game exactly as presented, without window capture.",
      type: "custom",
      render: captureStatus,
    },
  ],
};
