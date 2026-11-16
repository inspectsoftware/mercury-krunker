// Death screen FPS: Krunker slides the death screen's bottom bar (and the chat) in by animating `bottom`, a layout
// property, for 1.5 s. Each frame re-lays out and repaints the bar over the uncapped game view, and Chromium presents
// almost nothing meanwhile. Measured on krunker.io with the present counter (a copy of the bar with Krunker's classes,
// three rounds in rotated order): 5-68 FPS with frames up to 268 ms while it slides in, 411-556 FPS without the
// slide; the bar's backdrop blur made no difference either way, so it stays.

import { liveCss } from "../lib/style.js";

const CSS = `.death-ui-bottom, .death-ui-bottom-empty, #uiBase.onDeathScrn #chatHolder { animation: none !important; }`;

const mod = {
  id: "deathScreenFix",
  name: "Fix death screen FPS",
  desc: "Krunker slides the death screen's bar and the chat in a way that makes Chromium redraw them every frame, and the FPS collapses for 1.5 s. Mercury shows them at once instead.",
  category: "Performance",
  perf: true,
  live: true,
  init: () => apply(),
};
const apply = liveCss(mod, 5, () => CSS);
export default mod;
