// Every feature module, in settings-window order within each category.
import general from "./general.js";
import engine from "./engine.js";
import aimFreezeFix from "./aimFreezeFix.js";
import rawInput from "./rawInput.js";
import blocklist from "./blocklist.js";
import hudEditor from "./hudEditor.js";
import keystrokes from "./keystrokes.js";
import menuTimer from "./menuTimer.js";
import cleanerMenu from "./cleanerMenu.js";
import mercuryCss from "./mercuryCss.js";
import classicMenu from "./classicMenu.js";
import icons from "./icons.js";
import motionBlur from "./motionBlur.js";
import cssManager from "./cssManager.js";
import swapper from "./swapper.js";
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
  hudEditor, keystrokes, menuTimer,
  cleanerMenu, mercuryCss, classicMenu, icons, motionBlur, cssManager, swapper,
  betterChat, chatLogs, endMessage,
  clanColors, discordRpc, nowPlaying, mods, battlePass, rankStats,
];