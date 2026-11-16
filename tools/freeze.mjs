// node freeze.mjs <port> [seconds]: the aim freeze test. On tools/freeze/freeze.html, holds the left button and moves
// the mouse continuously over CDP, then reports how late the page's 16 ms timer ran (gaps between its runs; the game's
// network messages wait in the same kind of queue). Healthy: max gap well under 50 ms.
const [port = "9222", seconds = "8"] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("freeze.html"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  pending.get(m.id)?.(m);
});
const send = (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;

await evaluate("window.gaps = []");
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
await mouse("mousePressed", 400, 300);
const end = Date.now() + Number(seconds) * 1000;
let x = 400;
let moves = 0;
while (Date.now() < end) {
  x = x === 400 ? 460 : 400;
  await mouse("mouseMoved", x, 300);
  moves++;
}
await mouse("mouseReleased", x, 300);
const gaps = (await evaluate("window.gaps")).slice(1).sort((a, b) => a - b);
const pct = (p) => gaps[Math.min(gaps.length - 1, Math.floor((p / 100) * gaps.length))];
console.log(JSON.stringify({
  moves,
  timerRuns: gaps.length,
  p50: +pct(50).toFixed(1),
  p99: +pct(99).toFixed(1),
  max: +gaps[gaps.length - 1].toFixed(1),
  over50ms: gaps.filter((g) => g > 50).length,
}));
ws.close();
