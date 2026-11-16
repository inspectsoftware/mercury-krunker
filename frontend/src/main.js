// Mercury Client's page script. The host runs it in krunker.io's main frame before any page script.
import "./core/host.js"; // first: captures the bridge before the page can see it
import * as registry from "./core/modules.js";
import modules from "./modules/index.js";
import uiCss from "./core/ui.css";
import { css } from "./core/dom.js";

for (const mod of modules) registry.register(mod);
css(uiCss, "mercury-ui");
registry.start("early");

const ready = () => registry.start("init");
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
else ready();
