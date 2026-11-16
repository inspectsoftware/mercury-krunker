// node hosts.mjs <port> <seconds>: reloads the krunker page and counts request hosts (all frames, via the browser target).
const [port = "9222", seconds = "25"] = process.argv.slice(2);
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const send = (method, params = {}, sessionId) => ws.send(JSON.stringify({ id: ++id, method, params, sessionId }));
const hosts = new Map();
const types = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Target.attachedToTarget") {
    const sid = m.params.sessionId;
    send("Network.enable", {}, sid);
    send("Runtime.runIfWaitingForDebugger", {}, sid);
    send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid);
    if (m.params.targetInfo.type === "page" && !globalThis.reloaded) { globalThis.reloaded = true; send("Page.reload", {}, sid); }
  }
  if (m.method === "Network.requestWillBeSent") {
    const u = new URL(m.params.request.url);
    if (!u.protocol.startsWith("http") && !u.protocol.startsWith("ws")) return;
    hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1);
    types.set(u.host, new Set([...(types.get(u.host) ?? []), m.params.type]));
  }
});
send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
send("Target.attachToTarget", { targetId: page.id, flatten: true });
await new Promise((r) => setTimeout(r, Number(seconds) * 1000));
for (const [h, n] of [...hosts].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), h, [...types.get(h)].join(","));
ws.close();
