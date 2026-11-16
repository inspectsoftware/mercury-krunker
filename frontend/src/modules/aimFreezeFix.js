// Krunker ships its own workaround for the aim freeze (Chromium issue 415071737): the setting "Possible fix for
// jittery/freezing aiming", stored as kro_setngss_aimFreezeFix. Mercury runs stock Chromium uncapped, so it turns
// that setting on once, the first time; after that it is the player's to change in Krunker's settings.

const KEY = "kro_setngss_aimFreezeFix";

export default {
  id: "aimFreezeFix",
  name: "Aim freeze fix by default",
  desc: "Turns on Krunker's own \"Possible fix for jittery/freezing aiming\" the first time. It stops the aim freeze of uncapped FPS.",
  category: "Input",
  perf: true,
  early() {
    if (localStorage.getItem(KEY) === null) localStorage.setItem(KEY, "true");
  },
};
