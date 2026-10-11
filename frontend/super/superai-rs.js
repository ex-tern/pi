// super/superai-rs.js: the SuperAI language engine, written in Rust (rust/superai) and run here as
// WebAssembly (super/superai.wasm, built by scripts/build_superai.py).
//
// The engine runs supers and wires as dataflow. The site calls it for:
//   SuperAI.call(name, inputs)     one of the program's functions (pitechlab.super.js: functions), the
//                                  output's text, or null until the engine is loaded (callers fall back)
//   SuperAI.rs.engine(typed, ins, attached, hint)   what one Super AI super gives (super/nodes.js)
//   SuperAI.rs.validate(program)   the engine's own check of a whole program (the Program editor)
//   SuperAI.rs.run(f, inputs, answers)              any supers and wires
//   SuperAI.rs.ready               true once loaded ("superai:ready" fires on the document)
(function () {
  "use strict";
  const S = window.SuperAI = window.SuperAI || {};
  const rs = S.rs = { ready: false };
  const enc = new TextEncoder(), dec = new TextDecoder();
  let ex = null;

  function handle(req) {
    if (!ex) return null;
    const bytes = enc.encode(JSON.stringify(req));
    ex.sa_reset();
    const p = ex.sa_alloc(bytes.length);
    new Uint8Array(ex.memory.buffer, p, bytes.length).set(bytes);
    ex.sa_handle(p, bytes.length);
    const out = new Uint8Array(ex.memory.buffer, ex.sa_out_ptr(), ex.sa_out_len());
    return JSON.parse(dec.decode(out));
  }
  // a page value as the engine reads it: numbers stay numbers, everything else is text
  const val = v => v == null ? null : typeof v === "number" ? v : typeof v === "object" && v.isNum ? v.num : String(v.str != null && v.str !== "" ? v.str : v.text != null ? v.text : v);

  rs.handle = handle;
  rs.engine = (typed, ins, attached, hint) => { const r = handle({ op: "engine", typed: typed || "", ins: (ins || []).map(val), attached: attached || null, hint: hint || "" }); return r && r.ok ? r.value : null; };
  rs.validate = p => { const r = handle({ op: "validate", program: p }); return r ? r.errors || [] : null; };
  rs.run = (f, inputs, answers) => handle({ op: "run", program: f, inputs: inputs || {}, answers: answers || {} });
  S.call = (name, inputs) => {
    if (!ex || !S.program || !S.program.functions || !S.program.functions[name]) return null;
    const r = handle({ op: "call", program: { functions: S.program.functions }, function: name, inputs: inputs || {} });
    if (!r || !r.ok) return null;
    const o = r.outputs && (r.outputs.out || Object.values(r.outputs)[0]);
    return o ? o.text : null;
  };

  const src = (document.currentScript && document.currentScript.src || "").replace(/superai-rs\.js.*$/, "superai.wasm?v=2") || "super/superai.wasm?v=2";
  fetch(src).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(b => WebAssembly.instantiate(b, {}))
    .then(({ instance }) => {
      ex = instance.exports; rs.ready = true;
      const v = handle({ op: "version" });
      rs.version = v && v.engine;
      document.dispatchEvent(new CustomEvent("superai:ready"));
    })
    .catch(e => console.warn("SuperAI: the Rust engine did not load; the page computes in JavaScript", e));
})();
