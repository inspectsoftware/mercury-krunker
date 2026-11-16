// The player's real ping to every Krunker region, measured by the host (net.ping: timed TCP connects to the lobby
// servers the matchmaker's ping list names). Measured on demand only, and kept a little while: Krunker reloads the
// page on every lobby change.

import { call } from "../core/host.js";
import { game } from "./krunker.js";

const KEY = "mercury:pings";
let measuring = null;

const saved = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
};

/** {regionKey: ms} from the last measurement, or {}; and when it was taken. */
export const lastPings = () => ({ pings: saved()?.pings ?? {}, t: saved()?.t ?? 0 });

/** {regionKey: ms}: the saved numbers if younger than maxAge ms, else a fresh measurement. */
export function regionPings(maxAge = 120000) {
  const last = saved();
  if (last && Date.now() - last.t < maxAge) return Promise.resolve(last.pings);
  measuring ??= measure().finally(() => (measuring = null));
  return measuring;
}

async function measure() {
  const list = await game.matchmaker.pingList(); // {region: "lobby-….frankfurt.krunker.io:3000"}
  const hosts = Object.fromEntries(Object.entries(list).map(([region, host]) => [region, String(host).split(":")[0]]));
  const result = await call("net.ping", { hosts: [...new Set(Object.values(hosts))] });
  const pings = {};
  for (const [region, host] of Object.entries(hosts)) if (result[host]) pings[region] = Math.round(result[host].min);
  localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), pings }));
  return pings;
}
