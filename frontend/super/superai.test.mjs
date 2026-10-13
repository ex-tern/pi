// node frontend/super/superai.test.mjs: the SuperAI engine as the page runs it (super/superai.wasm, built
// from rust/superai by scripts/build_superai.py), against the functions the site writes in SuperAI.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const { instance } = await WebAssembly.instantiate(readFileSync(new URL("superai.wasm", here)), {});
const ex = instance.exports, enc = new TextEncoder(), dec = new TextDecoder();
function handle(req) {
  const b = enc.encode(JSON.stringify(req));
  ex.sa_reset(); const p = ex.sa_alloc(b.length);
  new Uint8Array(ex.memory.buffer, p, b.length).set(b);
  ex.sa_handle(p, b.length);
  return JSON.parse(dec.decode(new Uint8Array(ex.memory.buffer, ex.sa_out_ptr(), ex.sa_out_len())));
}
const ctx = { window: {} }; vm.createContext(ctx);
// the program is a generated region of app.js (scripts/tools.py build-program)
const app = readFileSync(new URL("../app.js", here), "utf8");
const region = app.slice(app.indexOf("// <pitechlab.super.js>"), app.indexOf("// </pitechlab.super.js>"));
vm.runInContext(region, ctx);
const program = ctx.window.SUPERAI_PROGRAM;
const call = (f, inputs) => handle({ op: "call", program, function: f, inputs }).outputs.out.text;

assert.deepEqual(handle({ op: "validate", program }).errors, []);
assert.equal(call("ago", { m: 0 }), "just now");
assert.equal(call("ago", { m: 45 }), "45 min ago");
assert.equal(call("ago", { m: 150 }), "3 h ago");
assert.equal(call("ago", { m: 2 * 1440 }), "2 d ago");
assert.equal(call("percent", { part: 1, whole: 4 }), "25");
assert.equal(call("percent", { part: 1, whole: 0 }), "");
assert.equal(call("add", { a: 2, b: 3 }), "5");
assert.equal(call("add", { a: "pi", b: "tech lab" }), "pi tech lab");
assert.equal(handle({ op: "engine", typed: "", ins: [3, 5], attached: "+" }).value.text, "8");
assert.equal(call("liveStatus", { enabled: false, working: false }), "Papers are assessed when people submit them.");
assert.equal(call("liveStatus", { enabled: true, working: true }), "Assessing a paper now, found on its own while the site is quiet.");
assert.match(call("liveStatus", { enabled: true, working: false }), /^Working while idle\./);
assert.equal(call("liveCounts", { today: 21, byself: 3, total: 26, enabled: true }), "21 assessed today (3 by itself) · 26 in total");
assert.equal(call("liveCounts", { today: 21, byself: 0, total: 26, enabled: false }), "21 assessed today · 26 in total");
for (let i = 0; i < 2000; i++) handle({ op: "engine", typed: "×", ins: [6, 7] });   // memory is reset per request
console.log("superai.wasm: all good");
