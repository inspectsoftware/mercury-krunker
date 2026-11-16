// "Krunker performance preset": Krunker's own Display settings that cost the most frames, switched off through its
// localStorage keys (kro_setngss_<name>, which Krunker reads with getSavedVal when a page loads). Undo puts back
// exactly what was there. Resolution, render distance and Low Spec are left alone: they change what the player sees.

import { toast } from "../core/dom.js";

const PRESET = { shadows: "false", particles: "false", mapDet: "false" };
const UNDO = "mercury:krunkerPresetUndo";
const key = (name) => `kro_setngss_${name}`;

function apply() {
  // Keep the first undo record: applying twice must not save the preset as "the previous values".
  if (localStorage.getItem(UNDO) === null) {
    const previous = Object.fromEntries(Object.keys(PRESET).map((name) => [name, localStorage.getItem(key(name))]));
    localStorage.setItem(UNDO, JSON.stringify(previous));
  }
  for (const [name, value] of Object.entries(PRESET)) localStorage.setItem(key(name), value);
  toast("Krunker preset set: shadows, particles and map details off. Applies on the next lobby (or press F5).", 6000);
}

function undo() {
  let previous;
  try {
    previous = JSON.parse(localStorage.getItem(UNDO));
  } catch {}
  if (!previous) return toast("Nothing to undo.");
  for (const [name, value] of Object.entries(previous)) {
    if (value === null) localStorage.removeItem(key(name));
    else localStorage.setItem(key(name), value);
  }
  localStorage.removeItem(UNDO);
  toast("Krunker's settings are back as they were. Applies on the next lobby (or press F5).", 6000);
}

export default {
  settings: [
    {
      key: "krunkerPreset",
      label: "Krunker performance preset",
      desc: "Turns off Krunker's shadows, particles and map details, the settings that cost the most frames.",
      type: "action",
      button: "Apply",
      run: apply,
    },
    { key: "krunkerPresetUndo", label: "Undo the Krunker preset", type: "action", button: "Undo", run: undo },
  ],
};
