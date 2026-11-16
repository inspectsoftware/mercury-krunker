// node drive.mjs <port> <shot.png|-> <step>...  steps: "key:F8" | "click:<css selector>" | "wait:<ms>" | "eval:<js>"
// Drives the krunker.io page over CDP, then optionally saves a screenshot.
import { writeFileSync } from "node:fs";

const [port, shot, ...steps] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("krunker.io"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  pending.get(m.id)?.(m);
});
const send = (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const VK = { F1: 112, F5: 116, F6: 117, F8: 119, F11: 122, Escape: 27, Enter: 13 };

for (const step of steps) {
  const [kind, ...rest] = step.split(":");
  const arg = rest.join(":");
  if (kind === "key") {
    for (const type of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: arg, code: arg, windowsVirtualKeyCode: VK[arg] ?? arg.charCodeAt(0) });
  } else if (kind === "click") {
    const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(arg)})?.getBoundingClientRect(); return r && [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    if (!box) { console.log("not found:", arg); continue; }
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box[0], y: box[1], button: "left", clickCount: 1 });
  } else if (kind === "wait") {
    await new Promise((r) => setTimeout(r, Number(arg)));
  } else if (kind === "eval") {
    console.log(JSON.stringify(await evaluate(arg)));
  }
}
if (shot && shot !== "-") {
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(shot, Buffer.from(result.data, "base64"));
  console.log("screenshot:", shot);
}
ws.close();
