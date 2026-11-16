// Account manager: the player's Krunker accounts, encrypted by the host with Windows DPAPI (src/accounts.rs). Add,
// edit, remove and drag to reorder; Ctrl+Alt+1/2/3 log in the first three. Logging in uses Krunker's own login
// window like a player would: log out if needed, "Login or Register", fill the form, press Login. A password reaches
// the page only for the account being logged in, and only goes into that form.

import { h, toast } from "../core/dom.js";
import { call } from "../core/host.js";
import { onHotkey } from "../core/hotkeys.js";
import * as registry from "../core/modules.js";
import * as settings from "../core/settings.js";
import { waitForEl } from "../lib/krunker.js";
import { panel } from "../lib/floating.js";

const id = "accounts";
// Krunker may reload the page when logging out; the login carries on from here after the reload.
const PENDING = "mercury:pendingLogin";
let busy = false;

const loggedIn = () => {
  const auth = window.FRVR?.auth;
  return !!auth?.isLoggedIn?.() && auth.getCurrentPlatform?.() !== "anonymous";
};

/** Sets an input's value the way typing does, so Krunker's form (Svelte) sees it. */
function fill(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function login(index) {
  if (!registry.enabled(mod)) return;
  const entry = (await call("accounts.list"))[index];
  if (!entry) return toast(`No account ${index + 1} yet: add it in Mercury settings → Accounts.`);
  loginAs(entry);
}

async function loginAs(entry) {
  if (busy) return;
  busy = true;
  const name = entry.label || entry.username;
  try {
    if (loggedIn()) {
      toast(`Logging out to switch to ${name}…`);
      sessionStorage.setItem(PENDING, JSON.stringify({ id: entry.id, t: Date.now() }));
      window.logoutAcc?.();
      if (!(await waitForEl("#playerHeaderEl .ph-login-wrap", 10000))) throw new Error("Krunker did not log out");
    }
    sessionStorage.removeItem(PENDING);
    const loginButton = await waitForEl("#playerHeaderEl .ph-login-wrap", 10000);
    if (!loginButton) throw new Error("Krunker's Login or Register button is missing");
    loginButton.click();
    if (!(await waitForEl("#accPass", 5000))) throw new Error("Krunker's login window did not open");
    // Krunker's form asks for an email by default; a link switches it to a username.
    const email = entry.username.includes("@");
    const fieldId = email ? "accEmail" : "accName";
    if (!document.getElementById(fieldId)) {
      [...document.querySelectorAll(".auth-toggle-btn")].find((b) => (email ? /use email/i : /use username/i).test(b.textContent))?.click();
    }
    const user = await waitForEl(`#${fieldId}`, 3000);
    const pass = document.getElementById("accPass");
    if (!user || !pass) throw new Error("Krunker's login form changed");
    const { username, password } = await call("accounts.credentials", { id: entry.id });
    fill(user, username);
    fill(pass, password);
    const submit = (user.form ?? pass.closest("form"))?.querySelector("button[type=submit]");
    if (!submit) throw new Error("Krunker's Login button is missing");
    submit.click();
    toast(`Logging in as ${name}…`);
  } catch (error) {
    toast(`Login: ${error.message}`);
  } finally {
    busy = false;
  }
}

async function resumePending() {
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING));
  } catch {}
  sessionStorage.removeItem(PENDING);
  if (!pending || Date.now() - pending.t > 30000) return;
  const entry = (await call("accounts.list")).find((a) => a.id === pending.id);
  if (entry && (await waitForEl("#playerHeaderEl", 15000))) loginAs(entry);
}

/** The manager window: the list (drag to reorder), and a form to add or edit an account. */
async function manage() {
  const p = panel({ id: "accounts", title: "Accounts", width: 560, height: 520 });
  let list = [];
  let editing = null; // an account, {} for a new one, or null
  const save = async (next) => {
    try {
      list = await call("accounts.save", { accounts: next });
    } catch (error) {
      toast(`Accounts: ${error.message}`);
    }
    render();
  };
  const ids = () => list.map(({ id, label, username }) => ({ id, label, username }));

  const row = (account, index) => {
    const remove = h("button", { class: "mc-btn mc-small-btn" }, "Remove");
    remove.onclick = () => {
      if (remove.textContent !== "Sure?") {
        remove.textContent = "Sure?";
        return setTimeout(() => (remove.textContent = "Remove"), 3000);
      }
      save(ids().filter((a) => a.id !== account.id));
    };
    const el = h(
      "div",
      { class: "mc-float-row", draggable: true },
      h("span", { class: "mc-grip", title: "Drag to reorder" }, "⋮⋮"),
      h("span", { class: "mc-muted", style: { minWidth: "70px" } }, index < 3 ? settings.get(`${id}.login${index + 1}`) || "" : ""),
      h("span", { class: "mc-grow" }, h("b", {}, account.label || account.username), account.label ? h("span", { class: "mc-muted" }, `  ${account.username}`) : ""),
      h("button", { class: "mc-btn mc-small-btn", onclick: () => loginAs(account) }, "Log in"),
      h("button", { class: "mc-btn mc-small-btn", onclick: () => ((editing = account), render()) }, "Edit"),
      remove,
    );
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/mercury-account", String(index));
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("dragover", (e) => (e.preventDefault(), el.classList.add("over")));
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData("text/mercury-account"));
      if (Number.isNaN(from) || from === index) return render();
      const next = ids();
      next.splice(index, 0, next.splice(from, 1)[0]);
      save(next);
    });
    return el;
  };

  const form = () => {
    const isNew = !editing.id;
    const label = h("input", { class: "mc-input", value: editing.label ?? "", placeholder: "Label (Main, Alt…)", maxLength: 64 });
    const username = h("input", { class: "mc-input", value: editing.username ?? "", placeholder: "Username or email", maxLength: 128, autocomplete: "off" });
    const password = h("input", { class: "mc-input", type: "password", placeholder: isNew ? "Password" : "Password (unchanged)", maxLength: 256, autocomplete: "new-password" });
    const submit = () => {
      if (!username.value.trim()) return toast("The username is missing.");
      if (isNew && !password.value) return toast("The password is missing.");
      const entry = { label: label.value, username: username.value, password: password.value || null };
      const next = isNew ? [...ids(), entry] : ids().map((a) => (a.id === editing.id ? { ...entry, id: a.id } : a));
      editing = null;
      save(next);
    };
    password.addEventListener("keydown", (e) => e.key === "Enter" && submit());
    return h(
      "div",
      { style: { marginTop: "12px" } },
      h("h4", {}, isNew ? "Add an account" : `Edit ${editing.label || editing.username}`),
      h("div", { style: { display: "grid", gap: "8px" } }, label, username, password),
      h(
        "div",
        { class: "mc-float-actions" },
        h("button", { class: "mc-btn", onclick: () => ((editing = null), render()) }, "Cancel"),
        h("button", { class: "mc-btn primary", onclick: submit }, "Save"),
      ),
    );
  };

  function render() {
    p.body.replaceChildren(
      h("p", {}, "Passwords are encrypted for your Windows user (DPAPI) and only ever typed into Krunker's own login form."),
      ...(list.length ? list.map(row) : [h("div", { class: "mc-float-empty" }, "No accounts yet.")]),
      editing ? form() : h("div", { class: "mc-float-actions" }, h("button", { class: "mc-btn primary", onclick: () => ((editing = {}), render()) }, "Add account")),
    );
    if (editing) p.body.querySelector("input")?.focus();
  }
  try {
    list = await call("accounts.list");
  } catch (error) {
    toast(`Accounts: ${error.message}`);
  }
  render();
}

for (const n of [1, 2, 3]) onHotkey(`${id}.login${n}`, () => login(n - 1));

const mod = {
  id,
  name: "Account manager",
  desc: "Your Krunker accounts, encrypted with Windows. Log in with one key: Mercury logs out and fills Krunker's own login form.",
  category: "Accounts",
  live: true,
  settings: [
    { key: "manage", label: "Accounts", desc: "Add, edit, remove; drag to set the order.", type: "action", button: "Manage", run: manage },
    { key: "login1", label: "Log in account 1", type: "key", default: "Ctrl+Alt+1" },
    { key: "login2", label: "Log in account 2", type: "key", default: "Ctrl+Alt+2" },
    { key: "login3", label: "Log in account 3", type: "key", default: "Ctrl+Alt+3" },
  ],
  init() {
    resumePending();
  },
};

export default mod;
