// The auto-updater's window (host side: src/update.rs). Checks GitHub's latest release at most every 6 hours,
// offers it with its changelog, downloads with a progress bar and installs; after an update, shows what's new once.

import { h, toast } from "../core/dom.js";
import { call, version } from "../core/host.js";
import * as settings from "../core/settings.js";
import { panel } from "../lib/panel.js";

const LAST_CHECK = "mercury:update:lastCheck";
const LAST_VERSION = "mercury:update:lastVersion";
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

const notes = (text) => h("pre", { class: "mc-code", style: { whiteSpace: "pre-wrap", margin: "0", padding: "12px", maxHeight: "50vh", overflow: "auto" } }, text || "No notes for this release.");

function offer(info) {
  const bar = h("div", { style: { height: "8px", background: "#1d2026", borderRadius: "4px", overflow: "hidden", margin: "12px" } }, h("div", { style: { height: "100%", width: "0%", background: "#2f86c2" } }));
  const line = h("div", { class: "mc-hint", style: { padding: "0 12px" } }, `Mercury Client ${info.version} is ready to download (you have ${info.current}), ${mb(info.size)}.`);
  const button = h("button", { class: "mc-btn primary" }, "Download and install");
  const win = panel({ title: `Update to ${info.version}`, actions: [button] });
  win.body.append(line, bar, notes(info.notes));

  button.onclick = async () => {
    button.disabled = true;
    await call("update.download");
    const timer = setInterval(async () => {
      const s = await call("update.status");
      if (s.total) bar.firstChild.style.width = `${Math.min(100, (s.received / s.total) * 100).toFixed(1)}%`;
      line.textContent = `Downloading… ${mb(s.received)} of ${mb(s.total)}`;
      if (s.state === "ready") {
        clearInterval(timer);
        line.textContent = "Downloaded and checked. Mercury closes, installs the update and starts again.";
        button.textContent = "Install and restart";
        button.disabled = false;
        button.onclick = () => call("update.install").catch((e) => toast(`Install failed: ${e.message}`));
      } else if (s.state === "error") {
        clearInterval(timer);
        line.textContent = `Download failed: ${s.error}`;
        button.textContent = "Try again";
        button.disabled = false;
      }
    }, 300);
  };
}

async function check(manual) {
  try {
    localStorage.setItem(LAST_CHECK, String(Date.now()));
    const info = await call("update.check");
    if (info.available) offer(info);
    else if (manual) toast(`Mercury Client ${version} is the newest version.`);
  } catch (error) {
    if (manual) toast(`Could not check for updates: ${error.message}`);
  }
}

async function whatsNew() {
  const last = localStorage.getItem(LAST_VERSION);
  localStorage.setItem(LAST_VERSION, version);
  if (!last || last === version) return;
  try {
    const release = await call("update.notes", { version });
    panel({ title: `What's new in ${version}` }).body.append(notes(release.notes));
  } catch {
    // No notes for this version (a local build): nothing to show.
  }
}

export default {
  id: "updater",
  name: "Updates",
  desc: "Checks for a new Mercury Client version when the client starts (at most every 6 hours).",
  category: "General",
  core: true,
  settings: [{ key: "check", label: "Check for updates now", type: "action", button: "Check", run: () => check(true) }],
  init() {
    whatsNew();
    const last = Number(localStorage.getItem(LAST_CHECK) || 0);
    if (settings.get("updater.enabled") && Date.now() - last > 6 * 3600 * 1000) check(false);
  },
};
