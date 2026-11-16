// Core settings and the Mercury entry points: the settings window (button + hotkey), fullscreen, restart,
// "Performance only", settings export/import and the version tag.

import { h, toast, waitFor } from "../core/dom.js";
import { call, version } from "../core/host.js";
import { hotkey } from "../core/hotkeys.js";
import * as settings from "../core/settings.js";
import * as ui from "../core/ui.js";

const category = "General";

hotkey({ id: "general.menuKey", label: "Open Mercury settings", key: "F8", category, handler: () => ui.toggle() });
hotkey({ id: "general.fullscreenKey", label: "Fullscreen", key: "F11", category, handler: () => call("window.fullscreen") });

async function exportSettings() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  try {
    const path = await call("settings.export", { name: `mercury-settings-${stamp}.json`, settings: settings.all() });
    toast(`Settings saved to ${path}`, 6000);
  } catch (error) {
    toast(`Export failed: ${error.message}`);
  }
}

function importSettings() {
  const input = h("input", { type: "file", accept: ".json,application/json" });
  input.onchange = async () => {
    try {
      const parsed = JSON.parse(await input.files[0].text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a settings file");
      await settings.replaceAll(parsed);
      toast("Settings imported. Reloading…");
      setTimeout(() => location.reload(), 800);
    } catch (error) {
      toast(`Import failed: ${error.message}`);
    }
  };
  input.click();
}

/** "Mercury" next to Krunker's own Settings button in the menu header, built like Krunker's items (icon + label). */
async function addMenuButton() {
  const header = await waitFor("#playerHeaderEl");
  const krunkerSettings = [...header.querySelectorAll("[class*='nav-item']")].find((el) => el.textContent.trim().endsWith("Settings"));
  const icon = krunkerSettings?.querySelector("[class*='material-icons']");
  const label = krunkerSettings?.querySelector("[class*='nav-label']");
  const button = h(
    "div",
    { class: `${krunkerSettings?.className ?? ""} mc-menu-btn`, role: "button", tabindex: 0, onclick: () => ui.open() },
    h("span", { class: icon?.className ?? "material-icons" }, "tune"),
    " ",
    h("span", { class: label?.className ?? "" }, "Mercury"),
  );
  if (krunkerSettings) krunkerSettings.before(button);
  else header.append(button);
}

export default {
  id: "general",
  name: "General",
  category,
  core: true,
  toggle: false,
  settings: [
    {
      key: "performanceOnly",
      label: "Performance only",
      desc: "Turns off every cosmetic and extra feature and hides its settings. Switch it back and your choices return.",
      type: "bool",
      default: false,
      onChange: () => toast("Applies on the next lobby (or press F5)."),
    },
    { key: "versionTag", label: "Version tag in the menu", type: "bool", default: true },
    { key: "restart", label: "Restart client", desc: "Needed after changing Engine settings.", type: "action", button: "Restart", run: () => call("app.restart") },
    { key: "export", label: "Export settings", desc: "Saves every Mercury setting as one file in your Downloads folder.", type: "action", button: "Export", run: exportSettings },
    { key: "import", label: "Import settings", desc: "Loads a file made with Export. Replaces your current settings.", type: "action", button: "Import", run: importSettings },
  ],
  init() {
    addMenuButton();
    if (settings.get("general.versionTag")) waitFor("#menuHolder").then((menu) => menu.append(h("div", { class: "mc-version" }, `Mercury Client v${version}`)));
  },
};
