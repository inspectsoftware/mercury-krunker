// Every feature module, in settings-window order within each category.
import general from "./general.js";
import engine from "./engine.js";
import aimFreezeFix from "./aimFreezeFix.js";
import rawInput from "./rawInput.js";
import blocklist from "./blocklist.js";
import betterChat from "./betterChat.js";
import chatLogs from "./chatLogs.js";
import endMessage from "./endMessage.js";
import clanColors from "./clanColors.js";
import discordRpc from "./discordRpc.js";
import nowPlaying from "./nowPlaying.js";
import mods from "./mods.js";
import battlePass from "./battlePass.js";
import rankStats from "./rankStats.js";

export default [
  general, engine, aimFreezeFix, rawInput, blocklist,
  betterChat, chatLogs, endMessage,
  clanColors, discordRpc, nowPlaying, mods, battlePass, rankStats,
];
