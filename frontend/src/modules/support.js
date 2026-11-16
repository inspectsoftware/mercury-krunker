// Support: safe mode, the diagnostics report, the crash finder and the notice after an unclean exit.
//
// Crash finder: a binary search over the modules that are on. Each step switches half of the remaining
// candidates off for one page load (core/modules.js reads the HUNT state) and asks whether the problem is still
// there; "no" means it is in the switched-off half. One module left that makes the problem go away is the cause,
// and it is turned off. If none does, the problem is not a Mercury module.

import { h, toast, waitFor } from "../core/dom.js";
import { call, uncleanExit } from "../core/host.js";
import * as registry from "../core/modules.js";
import * as settings from "../core/settings.js";
import { advance, begin } from "../lib/hunt.js";

const RESULT = "mercury:hunt:result";

const readHunt = () => {
  try {
    return JSON.parse(localStorage.getItem(registry.HUNT));
  } catch {
    return null;
  }
};

function finish(message) {
  localStorage.removeItem(registry.HUNT);
  localStorage.setItem(RESULT, message);
  location.reload();
}

/** Applies a search state: the next step (reload with that half off), or the result. */
function apply(state) {
  if (state.none) return finish("The problem doesn't come from a Mercury module. Try General → Restart in safe mode: it also drops custom Chromium flags.");
  if (state.found) {
    const mod = registry.byId(state.found);
    settings.set(`${state.found}.enabled`, false);
    return finish(`Found it: "${mod?.name ?? state.found}". It is off now; turn it back on in its settings when you want to try it again.`);
  }
  localStorage.setItem(registry.HUNT, JSON.stringify(state));
  location.reload();
}

const answer = (stillThere) => apply(advance(readHunt(), stillThere));

function startHunt() {
  const candidates = registry.list().filter((m) => !m.core && m.toggle !== false && registry.enabled(m)).map((m) => m.id);
  if (!candidates.length) return toast("No optional modules are on, so none can be the cause.");
  if (!confirm(`The crash finder reloads the page a few times (about ${Math.ceil(Math.log2(candidates.length)) + 1}) and asks each time whether the problem is still there. Start?`)) return;
  apply(begin(candidates));
}

function huntBar(hunt) {
  const bar = h(
    "div",
    { class: "mc-huntbar" },
    h("span", {}, `Crash finder: ${hunt.off.length} of ${hunt.candidates.length} suspects are off. Is the problem still there?`),
    h("button", { class: "mc-btn", onclick: () => answer(true) }, "Yes, still there"),
    h("button", { class: "mc-btn primary", onclick: () => answer(false) }, "No, it's gone"),
    h("button", { class: "mc-btn", onclick: () => (localStorage.removeItem(registry.HUNT), location.reload()) }, "Stop"),
  );
  waitFor("body").then((body) => body.append(bar));
}

async function diagnostics() {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  const fps = await new Promise((done) => {
    let frames = 0;
    const end = performance.now() + 2000;
    const tick = (now) => (now < end ? (frames++, requestAnimationFrame(tick)) : done(Math.round(frames / 2)));
    requestAnimationFrame(tick);
  });
  // Krunker's own settings and binds only: never its login tokens.
  const krunker = Object.fromEntries(Object.keys(localStorage).filter((k) => /^(kro_setngss_|cont_)/.test(k)).map((k) => [k, localStorage.getItem(k)]));
  const page = {
    userAgent: navigator.userAgent,
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
    screen: `${screen.width}x${screen.height}, devicePixelRatio ${devicePixelRatio}`,
    pageFps: fps,
    modulesOn: registry.list().filter(registry.enabled).map((m) => m.id),
    krunkerSettings: krunker,
  };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  try {
    const path = await call("diag.report", { name: `mercury-diagnostics-${stamp}.txt`, page });
    toast(`Diagnostics saved to ${path}. It holds no passwords or login tokens.`, 8000);
  } catch (error) {
    toast(`Diagnostics failed: ${error.message}`);
  }
}

export default {
  id: "support",
  name: "Support",
  category: "General",
  core: true,
  toggle: false,
  settings: [
    { key: "diagnostics", label: "Diagnostics report", desc: "Saves system, GPU, FPS, settings and the log in one file in Downloads, for bug reports. No passwords or tokens.", type: "action", button: "Create", run: diagnostics },
    { key: "crashFinder", label: "Find a problem module", desc: "Something broke? Mercury switches modules off half at a time and asks you, until it finds the one.", type: "action", button: "Start", run: startHunt },
    { key: "safeMode", label: "Restart in safe mode", desc: "One start without any Mercury modules, scripts or custom Chromium flags.", type: "action", button: "Restart", run: () => call("app.restart", { safe: true }) },
  ],
  init() {
    const result = localStorage.getItem(RESULT);
    if (result) {
      localStorage.removeItem(RESULT);
      toast(result, 12000);
    }
    const hunt = readHunt();
    if (hunt?.off) huntBar(hunt);
    if (uncleanExit && !hunt) toast("Mercury didn't close properly last time. If it keeps happening: General → Find a problem module, or Restart in safe mode.", 10000);
  },
};
