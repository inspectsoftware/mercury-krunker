// Every feature module, in settings-window order within each category.
import general from "./general.js";
import engine from "./engine.js";
import aimFreezeFix from "./aimFreezeFix.js";
import rawInput from "./rawInput.js";
import blocklist from "./blocklist.js";
import presentHook from "./presentHook.js";
import perf from "./perf.js";
import audioFix from "./audioFix.js";
import streaming from "./streaming.js";
import streamerMode from "./streamerMode.js";

export default [general, engine, presentHook, perf, audioFix, aimFreezeFix, rawInput, blocklist, streaming, streamerMode];
