// Match end message per account. Krunker keeps one "Match End Message" (setting endMessage, localStorage
// kro_setngss_endMessage) for whoever logs in. Mercury remembers it per FRVR account (the JWT's sub claim) and puts
// the right one in when the account changes, so an alt never sends the main's message. An account without one sends
// nothing.

import { decodeToken } from "krapio";
import { syncEndMessage } from "../lib/social.js";

const GAME_KEY = "kro_setngss_endMessage";
const SAVED = "mercury:endMessages";
const OWNER = "mercury:endMessageOwner";

/** The logged-in account's FRVR user id, or null (no token yet, or one that expired and FRVR has not refreshed). */
function account() {
  try {
    return decodeToken(JSON.parse(localStorage.getItem("__FRVR_auth_access_token"))).sub;
  } catch {
    return null;
  }
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED)) ?? {};
  } catch {
    return {};
  }
}

function sync() {
  const result = syncEndMessage({
    sub: account(),
    owner: localStorage.getItem(OWNER),
    current: localStorage.getItem(GAME_KEY) ?? "",
    saved: readSaved(),
  });
  localStorage.setItem(SAVED, JSON.stringify(result.saved));
  if (result.owner) localStorage.setItem(OWNER, result.owner);
  if (result.apply === null) return;
  // Krunker's own setter once it is loaded (it updates the live value too); before that, its storage.
  if (typeof window.setSetting === "function") window.setSetting("endMessage", result.apply);
  else localStorage.setItem(GAME_KEY, result.apply);
  const box = document.getElementById("slid_endMessage");
  if (box) box.value = result.apply;
}

export default {
  id: "endMessage",
  name: "Match end message per account",
  desc: "Remembers Krunker's Match End Message for each account and switches it with the account. An alt never sends your main's message; an account without one sends nothing.",
  category: "Chat",
  live: true,
  early() {
    // Before Krunker reads its settings: the stored token says who will be logged in.
    sync();
  },
  init() {
    setInterval(sync, 2000);
  },
};
