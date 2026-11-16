// Performance: Windows-side changes (each opt-in and undone by Mercury, src/system.rs), HighQoS, the CPU throttler,
// a preset for Krunker's own performance settings, and the system check.

import { h, css, toast } from "../core/dom.js";
import { call } from "../core/host.js";
import * as settings from "../core/settings.js";
import krunkerPreset from "./krunkerPreset.js";

/** A switch that changes a Windows setting through the host; turns itself back off if the host refuses. */
function systemSwitch(key, cmd, label, desc) {
  return {
    key, label, desc, type: "bool", default: false,
    onChange: async (on) => {
      try {
        await call(cmd, { on });
        toast(`${label}: ${on ? "on" : "off (restored)"}.`);
      } catch (error) {
        toast(`${label}: ${error.message}`, 7000);
        if (on) settings.set(`perf.${key}`, false);
      }
    },
  };
}

function throttle(rate) {
  return call("perf.cpuThrottle", { rate: Number(rate) }).catch((e) => toast(`CPU throttler: ${e.message}`));
}

// --- System check ---
const good = (ok) => h("span", { class: `mc-dot ${ok ? "ok" : "warn"}` });
const line = (ok, name, value) => h("div", { class: "mc-check-row" }, ok == null ? h("span", { class: "mc-dot" }) : good(ok), h("b", {}, name), h("span", {}, value));

async function check(box) {
  const [sys, hook] = await Promise.all([call("perf.system"), call("perf.stats")]);
  const fast = sys.adapters[0];
  box.replaceChildren(
    line(sys.power.ac, "Power", sys.power.ac ? "plugged in" : "on battery (Windows lowers performance)"),
    line(sys.power.bestPerformance || sys.power.highPerformancePlan, "Power mode", `${sys.power.mode ?? "n/a"} · plan ${sys.power.plan ?? "n/a"}${sys.power.boosted ? " · boosted by Mercury" : ""}`),
    line(sys.gameMode.on, "Game Mode", sys.gameMode.on ? "on" : "off: turn it on in Windows Settings → Gaming"),
    line(null, "GPU scheduling", sys.hags.on ? "hardware-accelerated (on)" : "off (Windows default)"),
    line(null, "GPUs", sys.adapters.map((a) => `${a.name} (${a.outputs} display${a.outputs === 1 ? "" : "s"})`).join(" · ") || "none found"),
    line(!sys.crossAdapter, "Display", sys.crossAdapter ? `on the other GPU: frames cross from ${fast?.name ?? "the fast GPU"} (hybrid laptop)` : `driven by ${fast?.name ?? "the GPU"}`),
    line(sys.gpuPreference.highPerformance, "Windows GPU choice", sys.gpuPreference.highPerformance ? "High performance" : "Windows default (see High-performance GPU below)"),
    line(
      sys.nvidia?.available ? !sys.nvidia.applied || sys.nvidia.applied === "Mercury Client" : null,
      "NVIDIA",
      sys.nvidia?.available ? `driver profile in use: ${sys.nvidia.applied || "none (global settings)"}` : "no NVIDIA driver",
    ),
    line(hook.active, "Present hook", `${hook.stateName}${hook.active ? ` · ${hook.waitable ? "waitable" : "regular"} swap chain${hook.tearing ? ", tearing" : ""}` : ""}`),
  );
}

css(`.mc-check{display:grid;gap:4px;min-width:430px;max-width:470px;font-size:12.5px}
.mc-check-row{display:grid;grid-template-columns:12px 120px 1fr;gap:8px;align-items:baseline}
.mc-check-row b{font-weight:600;color:#c9ced6}.mc-check-row span:last-child{color:#a9b0ba}
.mc-dot{width:8px;height:8px;border-radius:50%;background:#4a505a;display:inline-block}.mc-dot.ok{background:#3fb37f}.mc-dot.warn{background:#d9a441}`, "mercury-perf");

export default {
  id: "perf",
  name: "Performance",
  category: "Performance",
  perf: true,
  toggle: false,
  settings: [
    {
      key: "check",
      label: "System check",
      desc: "How Windows is set up for the game. Green is good; yellow is worth a look.",
      type: "custom",
      render: () => {
        const box = h("div", { class: "mc-check" }, "Checking…");
        check(box).catch((e) => (box.textContent = `Check failed: ${e.message}`));
        return box;
      },
    },
    ...krunkerPreset.settings,
    systemSwitch("powerBoost", "system.powerBoost", "Laptop Power Boost", "While Mercury runs on AC power: Windows' Best performance power mode (or the High performance plan). Your setting comes back when Mercury closes."),
    systemSwitch("gpuPreference", "system.gpuPreference", "High-performance GPU", "Sets Windows' graphics preference for Mercury to High performance (Settings → Display → Graphics). Turning this off puts back what was there. Restart to apply."),
    systemSwitch("nvidiaProfile", "system.nvidiaProfile", "NVIDIA driver profile", "A driver profile for mercury.exe: no driver frame cap, vsync left to Mercury, maximum performance power mode. Turning this off deletes the profile."),
    {
      key: "highQos",
      label: "HighQoS",
      desc: "Keeps Windows from running the game's processes in efficiency mode (EcoQoS).",
      type: "bool",
      default: true,
      restart: true,
    },
    {
      key: "cpuThrottle",
      label: "CPU throttler",
      desc: "Last resort for PCs whose GPU can't keep up: slows the game's main thread (Chromium's own CPU throttling) so it queues fewer frames. Try an FPS limit first.",
      type: "select",
      default: "1",
      options: [["1", "Off"], ["1.25", "1.25× slower"], ["1.5", "1.5× slower"], ["2", "2× slower"], ["3", "3× slower"]],
      onChange: throttle,
    },
  ],
  init() {
    const rate = settings.get("perf.cpuThrottle");
    if (Number(rate) > 1) throttle(rate);
  },
};
