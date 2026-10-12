// pi-worker.js: digits of π, forever, in the background. The digits are computed exactly in Rust
// (rust/numbers, Machin's formula, built to numbers.wasm; owner, 2026-10-13: "write the whole project in py and
// rust only"): 1 000 at first, and four times as many each time the page is about to run out, so it simply keeps
// going while the page stays open. This file only loads it and paces the digits out, so the number visibly grows
// instead of racing ahead.
//
// The pace follows what the site is processing ({pace: ms}, sent by orbit.js from /api/activity): slow while it
// is quiet, fast while papers are being assessed. The schedule corrects its own drift, and a {sync: true, delay}
// message restarts it. {pause: true} stops it where it is; {resume: true} carries on.
let digits = "", count = 0, ask = null, wanted = 1000, working = false;
let PACE_MS = 60;
let due = 0, timer = 0;

const enc = new TextEncoder(), dec = new TextDecoder();
function more() {                                   // the next batch, before the current one runs out
  if (!ask || working || wanted > 200000) return;
  working = true;
  const s = ask("pi " + wanted);
  digits = s.replace(".", "");                      // "31415…": the 3, then the decimals, as the spigot gave them
  wanted *= 4; working = false;
}
function tick() {
  if (count >= digits.length) { more(); if (count >= digits.length) { timer = setTimeout(tick, 200); return; } }
  const d = +digits[count];
  count++;
  postMessage({ digit: d, count });
  if (digits.length - count < 200) setTimeout(more, 0);
  due += PACE_MS;
  const now = performance.now();
  if (due < now - 4 * PACE_MS) due = now;          // fell far behind (tab asleep): skip, don't burst
  timer = setTimeout(tick, Math.max(0, due - now));
}

onmessage = e => {
  if (e.data && e.data.pace) {          // the site got busier or quieter: change speed, keep going
    const was = PACE_MS;
    PACE_MS = Math.max(20, Math.min(2000, +e.data.pace || 60));
    if (timer && PACE_MS < was) { clearTimeout(timer); due = performance.now(); timer = setTimeout(tick, 0); }
    return;
  }
  if (e.data && e.data.pause) { clearTimeout(timer); timer = 0; return; }
  if (e.data && e.data.resume) { clearTimeout(timer); due = performance.now(); timer = setTimeout(tick, 0); return; }
  if (e.data && e.data.sync) {
    clearTimeout(timer);
    due = performance.now() + (+e.data.delay || 0);
    timer = setTimeout(tick, Math.max(0, due - performance.now()));
  }
};

(async () => {
  const { instance } = await WebAssembly.instantiateStreaming(fetch("numbers.wasm?v=1"), {}).catch(async () =>
    WebAssembly.instantiate(await (await fetch("numbers.wasm?v=1")).arrayBuffer(), {}));
  const x = instance.exports;
  ask = req => {
    const b = enc.encode(req), p = x.nb_alloc(b.length);
    new Uint8Array(x.memory.buffer, p, b.length).set(b);
    x.nb_handle(p, b.length);
    const s = dec.decode(new Uint8Array(x.memory.buffer, x.nb_out_ptr(), x.nb_out_len()));
    x.nb_free_out(); x.nb_free(p, b.length);
    return s;
  };
  more();
  due = performance.now();
  tick();
})();
