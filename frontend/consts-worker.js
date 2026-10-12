// consts-worker.js: important constants, computed exactly, to more and more digits. The maths is Rust
// (rust/numbers, built to numbers.wasm by `python scripts/build_superai.py --crate numbers`; owner, 2026-10-13:
// "write the whole project in py and rust only"); this file only loads it and schedules the work.
//
// Each constant is computed at 100, 300, 1 000, 3 000, 10 000 and 30 000 digits (γ stops at 10 000: it is
// the slowest); the page reveals the digits at a steady pace. {pause: true} holds the work between steps.
const STEPS = [100, 300, 1000, 3000, 10000, 30000];
const JOBS = [["e"], ["phi"], ["gamma", 10000]];
let paused = false;
self.onmessage = e => { if (e.data && "pause" in e.data) paused = !!e.data.pause; };

const enc = new TextEncoder(), dec = new TextDecoder();
function asker(x) {
  return req => {
    const b = enc.encode(req), p = x.nb_alloc(b.length);
    new Uint8Array(x.memory.buffer, p, b.length).set(b);
    x.nb_handle(p, b.length);
    const s = dec.decode(new Uint8Array(x.memory.buffer, x.nb_out_ptr(), x.nb_out_len()));
    x.nb_free_out(); x.nb_free(p, b.length);
    return s;
  };
}
(async () => {
  const { instance } = await WebAssembly.instantiateStreaming(fetch("numbers.wasm?v=1"), {}).catch(async () =>
    WebAssembly.instantiate(await (await fetch("numbers.wasm?v=1")).arrayBuffer(), {}));
  const ask = asker(instance.exports);
  for (const D of STEPS) {
    for (const [key, cap] of JOBS) {
      if (cap && D > cap) continue;
      while (paused) await new Promise(r => setTimeout(r, 200));
      postMessage({ key, digits: ask(key + " " + D) });
      await new Promise(r => setTimeout(r, 0));    // stay responsive to the page
    }
  }
})();
