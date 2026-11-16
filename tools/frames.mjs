// node frames.mjs <port> <seconds> [url part] → JSON: requestAnimationFrame rate and frame-time percentiles in the
// page whose URL contains [url part] (default krunker.io): the game loop's cadence, with uncapped FPS the game's FPS.
const [port = "9222", seconds = "20", match = "krunker.io"] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes(match));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
const expression = `new Promise((done) => {
  const times = []; let last = performance.now(); const end = last + ${Number(seconds) * 1000};
  const tick = (now) => { times.push(now - last); last = now; now < end ? requestAnimationFrame(tick) : done(times); };
  requestAnimationFrame(tick);
})`;
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
const msg = await new Promise((r) => ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m); }));
ws.close();
const times = msg.result.result.value.slice(1).sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))];
const total = times.reduce((a, b) => a + b, 0);
console.log(JSON.stringify({
  frames: times.length,
  fps: Math.round((times.length / total) * 1000),
  p50: +pct(50).toFixed(2),
  p99: +pct(99).toFixed(2),
  max: +times[times.length - 1].toFixed(2),
  low1: Math.round(1000 / pct(99)), // "1% low" FPS
}));
