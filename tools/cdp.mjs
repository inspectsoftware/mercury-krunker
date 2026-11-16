// node cdp.mjs <port> <js expression | @file.js>  → prints the JSON result of evaluating it in the krunker.io page.
import { readFileSync } from "node:fs";

const [port = "9222", expr = "1"] = process.argv.slice(2);
const code = expr.startsWith("@") ? readFileSync(expr.slice(1), "utf8") : expr;
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("krunker.io"));
if (!page) throw new Error("no krunker page: " + targets.map((t) => t.url).join(", "));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: code, awaitPromise: true, returnByValue: true } }));
const msg = await new Promise((r) => ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m); }));
const res = msg.result;
if (res?.exceptionDetails) console.log("EXCEPTION:", JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text));
else console.log(typeof res?.result?.value === "string" ? res.result.value : JSON.stringify(res?.result?.value, null, 1));
ws.close();
