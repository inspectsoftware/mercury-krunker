// Krunker's read-only APIs through krapio (MIT): the game tier needs no login, the token tier uses the player's own
// FRVR token, which krapio only ever sends to Krunker's APIs as a bearer header. Everything read here stays in this
// page (memory, IndexedDB, localStorage) and is never sent anywhere else.

/*! krapio (https://github.com/NullDev/krapio), bundled here. MIT License. Copyright (c) 2026 NullDev
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { KrunkerGameApi, KrunkerTokenApi } from "krapio";

export const game = new KrunkerGameApi({ retries: 0 });
const tokenApi = new KrunkerTokenApi({ retries: 0 });

/** The token tier for the logged-in Krunker account; null for a guest (FRVR's anonymous login) or before FRVR loads. */
export async function account() {
  const auth = window.FRVR?.auth;
  if (!auth?.isLoggedIn?.() || auth.getCurrentPlatform?.() === "anonymous") return null;
  try {
    const session = tokenApi.as(await auth.getFreshAccessToken());
    return session.claims.extra?.platform === "anonymous" ? null : session;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lanes = new Map();
/** Runs API calls to one host ("gapi", "api") one at a time, at most four a second: gapi allows five a second per route. */
export function paced(fn, lane = "gapi") {
  const run = (lanes.get(lane) ?? Promise.resolve()).then(fn);
  lanes.set(lane, run.catch(() => {}).then(() => sleep(250)));
  return run;
}

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("mercury", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("cache");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idb(mode, fn) {
  const store = (await db()).transaction("cache", mode).objectStore("cache");
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** `load()` once per `ttl` ms, kept in IndexedDB; an old copy stands in when Krunker's API fails. */
export async function cached(key, ttl, load) {
  const hit = await idb("readonly", (s) => s.get(key)).catch(() => null);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const v = await load();
    await idb("readwrite", (s) => s.put({ t: Date.now(), v }, key)).catch(() => {});
    return v;
  } catch (error) {
    if (hit) return hit.v;
    throw error;
  }
}

/** When `key` was last loaded (ms since epoch), or 0. */
export const cachedAt = async (key) => (await idb("readonly", (s) => s.get(key)).catch(() => null))?.t ?? 0;

/** Resolves with the element once it exists, or null after `ms`. */
export function waitForEl(selector, ms = 5000) {
  return new Promise((resolve) => {
    const found = () => document.querySelector(selector);
    if (found()) return resolve(found());
    const observer = new MutationObserver(() => found() && done(found()));
    const timer = setTimeout(() => done(null), ms);
    function done(el) {
      observer.disconnect();
      clearTimeout(timer);
      resolve(el);
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  });
}

/** "3 min ago" */
export function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  return !t ? "never" : s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}
