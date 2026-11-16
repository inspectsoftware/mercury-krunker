// Better chat: timestamps, clickable links, the unsent message kept when the chat closes, and a text size.
// Krunker's chat: #chatList holds one <div id="chatMsg_N"><div class="chatItem">Name: <span class="chatMsg">text</span>
// </div><br></div> per line; #chatInput is the box.

import { css, h, toast, waitFor } from "../core/dom.js";
import { call } from "../core/host.js";
import * as settings from "../core/settings.js";
import { clock, gameLink, splitLinks } from "../lib/chat.js";

const opt = (key) => settings.get(`betterChat.${key}`);

/** Lobby, map and mod links load in the game window; anything else opens in the default browser. */
export function openLink(url) {
  const game = gameLink(url);
  if (game) location.href = game;
  else call("shell.open", { url }).catch((e) => toast(`Could not open the link: ${e.message}`));
}

function linkify(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parts = splitLinks(node.data);
    if (!parts.some((p) => p.url)) continue;
    node.replaceWith(
      ...parts.map((p) =>
        p.url
          ? h("a", { class: "mc-link", title: p.url, onclick: (e) => (e.preventDefault(), e.stopPropagation(), openLink(p.url)) }, p.text)
          : p.text,
      ),
    );
  }
}

function onLine(line) {
  const item = line.querySelector?.(".chatItem");
  if (!item) return;
  // Krunker's chat is right-to-left with U+200E marks keeping each line in order; the mark keeps the time in front.
  if (opt("timestamps")) item.prepend(h("span", { class: "mc-ts" }, `‎${clock(Date.now())} `));
  if (opt("links")) for (const msg of item.querySelectorAll(".chatMsg")) linkify(msg);
}

async function keepDraft() {
  const input = await waitFor("#chatInput");
  let draft = "";
  input.addEventListener("input", () => (draft = input.value));
  input.addEventListener("keydown", (e) => e.key === "Enter" && (draft = ""));
  // Krunker empties the box when the chat closes; put the unsent text back when it opens again.
  input.addEventListener("focus", () => {
    if (!input.value && draft) input.value = draft;
  });
}

function applyCss() {
  const size = opt("fontSize");
  css(
    `#chatList .mc-ts { color: rgba(255, 255, 255, 0.45); font-size: 0.85em; }
     #chatList .mc-link { color: #8cc8ff; text-decoration: underline; cursor: pointer; pointer-events: auto; }
     ${size ? `#chatList .chatItem { font-size: ${size} !important; }` : ""}`,
    "mercury-better-chat",
  );
}

export default {
  id: "betterChat",
  name: "Better chat",
  desc: "Timestamps, clickable links and a kept draft in Krunker's chat.",
  category: "Chat",
  settings: [
    { key: "timestamps", label: "Timestamps", desc: "The time each line arrived, in front of it.", type: "bool", default: false },
    {
      key: "links",
      label: "Clickable links",
      desc: "Lobby, map and mod links open in the game; other links open in your browser.",
      type: "bool",
      default: true,
    },
    { key: "keepDraft", label: "Keep the unsent message", desc: "What you typed comes back when you open the chat again.", type: "bool", default: true },
    {
      key: "fontSize",
      label: "Text size",
      type: "select",
      default: "",
      options: [["", "Krunker's"], ["13px", "Small"], ["16px", "Medium"], ["18px", "Large"], ["21px", "Larger"]],
      onChange: applyCss,
    },
  ],
  async init() {
    applyCss();
    if (opt("keepDraft")) keepDraft();
    const list = await waitFor("#chatList");
    for (const line of list.children) onLine(line);
    new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(onLine))).observe(list, { childList: true });
  },
};
