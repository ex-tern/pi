// super/define.js: SuperAI as a graphical language, like LabVIEW (owner, 2026-10-13: "based on the controls and
// conditions and how supers behave, make this super language a graphical language like a LabVIEW that can be used to
// write new, functioning supers"; "just the front end").
//
// A new super is drawn, not written:
//   - a holder whose name is typed as "super NAME" (or "def NAME") is a definition: what is drawn inside it is the
//     new super's diagram, compiled to a SuperAI graph (the language's own { supers, wires }) as it changes
//   - inside it, a super typed "in" (or "in a", "in b" …, read top to bottom) is an input, and one typed "out" is the
//     output; without an "in", what is wired from the holder's input port is the input, and without an "out", what is
//     wired into its output port (else the super nothing inside takes from) is the result
//   - a condition wire inside holds a super while it is false, as everywhere on the page
//   - any super with NAME typed into it is that super: what is wired into it goes into the inputs, in the order the
//     wires were made, and it shows the result. Definitions can use one another and themselves (a condition ends a
//     recursion), so the language is Turing complete in pictures alone.
// New words a super understands (besides numbers, + − × ÷ ^ %, < > = ≤ ≥ min max round floor and or not &):
//   ≠            not equal
//   select       three inputs: a condition, then the value for true, then the value for false
//   repeat F     two inputs, x and n: F applied n times to x (a loop with memory: each pass takes the last result)
//   while F T    one input, x: F applied to x as long as T says true of it (at most 10 000 passes)
//   count        a counter: one more on every tick of what is wired into its sync, and every time it is run; a
//                condition that is false holds it
//   keep         memory: it keeps the last value wired into it, across reloads, until something new comes in
//   export       run it (Enter, or the open control): downloads every super you have defined as SuperAI text (.sasm)
//   supers       lists the supers you have defined
// Definitions are kept in this browser (superai:defs) like the rest of the page; the export is how one goes into the
// site's program (frontend/super/pitechlab.sasm, `python scripts/build_program.py`).
//
//   SeDefine.defs()  SeDefine.call(name, args)  SeDefine.page(n, ins, attached)  SeDefine.sasm(name?)  SeDefine.download()
(function () {
  "use strict";
  const KEY = "superai:defs";
  const MAX_DEPTH = 64, MAX_LOOP = 10000;
  let defs = {};
  try { defs = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (_) { defs = {}; }
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(defs)); } catch (_) { /* private mode */ } };
  const say = t => { const o = document.querySelector(".lv-out"); if (o) o.textContent = t; };

  // ---- words ---------------------------------------------------------------------------------------
  const DEF = /^\s*(?:super|def|define)\s+([A-Za-z_À-￿][\wÀ-￿-]*)\s*$/u;
  const IN = /^\s*in(?:put)?(?:\s+(\S+))?\s*$/i, OUT = /^\s*out(?:put)?\s*$/i;
  const defName = t => { const m = DEF.exec(String(t || "")); return m ? m[1] : null; };
  const isPort = t => IN.test(t || "") || OUT.test(t || "");
  const norm = t => String(t || "").trim().toLowerCase();
  const find = name => { const k = norm(name); return Object.keys(defs).find(d => d.toLowerCase() === k) || null; };

  // ---- values: null is "held" (nothing), as in the Rust engine -----------------------------------------
  const isNum = v => typeof v === "number" || (typeof v === "string" && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(v));
  const toNum = v => typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : isNum(v) ? +String(v).replace(",", ".") : NaN;
  const truthy = v => v != null && v !== false && v !== "" && v !== 0 && !(typeof v === "string" && /^(false|no|0)$/i.test(v.trim())) && !(Array.isArray(v) && !v.length);
  const text = v => v == null ? "" : typeof v === "boolean" ? (v ? "true" : "false") : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(6))) : Array.isArray(v) ? v.map(text).join(", ") : String(v);
  // a page value ({ num, isNum, bool, str, text }) to a plain one, and back
  const fromPage = v => { if (!v) return null; if (v.isNum) return v.num; const s = v.str != null && v.str !== "" ? v.str : v.text; return s == null || s === "" ? null : (isNum(s) ? toNum(s) : s); };
  const toPage = v => {
    if (v == null) return { num: 0, isNum: false, bool: false, str: "", text: "" };
    if (typeof v === "boolean") return { num: v ? 1 : 0, isNum: true, bool: v, str: text(v), text: text(v) };
    if (typeof v === "number") return { num: v, isNum: true, bool: !!v && !Number.isNaN(v), str: text(v), text: text(v) };
    const t = text(v); return { num: t.length, isNum: false, bool: !!t, str: t, text: t };
  };

  // ---- one super's computation: the language's own engine for what it knows, the new words here --------
  const OPS = {
    "≠": (xs) => xs.length > 1 && xs.slice(1).every(x => (isNum(x) && isNum(xs[0])) ? toNum(x) !== toNum(xs[0]) : text(x) !== text(xs[0])),
    "!=": null, "<>": null,
  };
  OPS["!="] = OPS["<>"] = OPS["≠"];
  function jsOp(t, xs) {                                                    // when the Rust engine has not loaded
    const k = norm(t), ns = xs.map(toNum), allN = ns.every(x => !Number.isNaN(x));
    const fold = f => ns.slice(1).reduce(f, ns[0]);
    switch (k) {
      case "+": return allN ? fold((a, b) => a + b) : xs.map(text).join(" ");
      case "-": case "−": return fold((a, b) => a - b);
      case "×": case "x": case "*": return fold((a, b) => a * b);
      case "/": case "÷": return fold((a, b) => a / b);
      case "^": return fold((a, b) => Math.pow(a, b));
      case "%": return fold((a, b) => a % b);
      case "<": return ns[0] < ns[1]; case ">": return ns[0] > ns[1];
      case "=": case "==": return allN ? ns[0] === ns[1] : text(xs[0]) === text(xs[1]);
      case "≤": case "<=": return ns[0] <= ns[1]; case "≥": case ">=": return ns[0] >= ns[1];
      case "min": return Math.min(...ns); case "max": return Math.max(...ns);
      case "round": return Math.round(ns[0]); case "floor": return Math.floor(ns[0]);
      case "and": return xs.every(truthy); case "or": return xs.some(truthy); case "not": return !truthy(xs[0]);
      case "&": case "join": return xs.map(text).join("");
      default: return undefined;
    }
  }
  const OPWORDS = /^(\+|-|−|–|×|x|\*|·|\/|÷|:|\^|%|<|>|=|==|≤|<=|≥|>=|min|max|round|floor|and|or|not|&|join)$/i;
  function engine(typed, xs, attached) {
    const RS = window.SuperAI && window.SuperAI.rs;
    if (RS && RS.ready && RS.engine) {
      const r = RS.engine(typed, xs.map(v => typeof v === "boolean" ? (v ? 1 : 0) : Array.isArray(v) ? text(v) : v), attached || null, "");
      if (r) {
        if (r.kind === "number") return r.value;
        if (r.kind === "bool") return !!r.value;
        if (r.kind === "list") return (r.value || []).map(x => x && typeof x === "object" ? x.value : x);
        if (r.kind === "text") return r.text;
        if (r.kind === "held") return null;
        return { ask: r.text || typed };                                      // a question for the AI engines
      }
    }
    if (OPWORDS.test(norm(typed)) && xs.length) return jsOp(typed, xs);
    if (attached && xs.length && OPWORDS.test(attached)) return jsOp(attached, xs);
    if (isNum(typed)) return toNum(typed);
    return typed ? typed : xs.length ? xs[0] : null;
  }

  // what a super with `typed` gives, from its inputs xs (null = held); depth guards recursion
  // shape: "box" for a square (■ ●  +), whose words are text, as in the Rust engine; else a prompt, whose words are a question
  function compute(typed, xs, attached, depth, state, shape) {
    const t = String(typed || "").trim(), k = norm(t), live = xs.filter(v => v != null);
    if (!t) return live.length ? live[0] : null;
    if (isNum(t)) return toNum(t);
    if (OPS[k]) return live.length ? OPS[k](live) : null;
    if (k === "select") { if (xs.length < 2) return null; return truthy(xs[0]) ? (xs[1] != null ? xs[1] : null) : (xs.length > 2 ? xs[2] : null); }
    let m;
    if ((m = /^repeat\s+(.+)$/i.exec(t))) {
      const f = find(m[1]); if (!f) return null;
      let x = xs[0], n = Math.max(0, Math.min(MAX_LOOP, Math.floor(toNum(xs[1] != null ? xs[1] : 1)) || 0));
      for (let i = 0; i < n; i++) { x = call(f, [x], depth + 1); if (x != null && typeof x === "object" && !Array.isArray(x)) return x; }
      return x;
    }
    if ((m = /^while\s+(\S+)\s+(\S+)$/i.exec(t))) {
      const f = find(m[1]), g = find(m[2]); if (!f || !g) return null;
      let x = xs[0];
      for (let i = 0; i < MAX_LOOP && truthy(call(g, [x], depth + 1)); i++) x = call(f, [x], depth + 1);
      return x;
    }
    if (k === "count") return state && state.count != null ? state.count : 0;
    if (k === "keep") return state && state.keep != null ? state.keep : (live.length ? live[0] : null);
    if (k === "supers") return Object.keys(defs).join(", ") || "no supers defined yet";
    if (k === "export") return Object.keys(defs).length ? "export " + Object.keys(defs).length + " supers: press Enter" : "nothing to export yet";
    if (IN.test(t) || OUT.test(t)) return live.length ? live[0] : null;
    const f = find(t);
    if (f) return call(f, xs, depth + 1);
    if (shape === "box" && !OPWORDS.test(k)) return t;                       // a square's words: that text
    return engine(t, live, attached);
  }

  // ---- running a definition: its graph, in dataflow order --------------------------------------------
  function call(name, args, depth) {
    depth = depth || 0;
    const d = defs[name]; if (!d) return null;
    if (depth > MAX_DEPTH) return null;                                    // too deep: held (a condition should end it)
    const g = d.graph, vals = {}, busy = {};
    const supersById = Object.fromEntries(g.supers.map(s => [s.id, s]));
    const into = (id, port) => g.wires.filter(w => w[1] === id + "." + port).map(w => w[0].split(".")[0]);
    function val(id) {
      if (id in vals) return vals[id];
      if (busy[id]) return null;                                            // a loop of wires inside: held
      busy[id] = true;
      const s = supersById[id]; let v = null;
      if (!s) v = null;
      else if (s.kind === "input") v = args[s.slot] != null ? args[s.slot] : null;
      else if (s.kind === "const") v = s.value;
      else {
        const cond = into(id, "condition").map(val);
        if (cond.length && !cond.every(truthy)) v = null;                    // a condition that is false holds it
        else {
          const xs = into(id, "input").map(val);
          v = s.kind === "output" ? (xs.find(x => x != null) ?? null) : compute(s.text, xs, s.attached || null, depth, null, s.shape);
        }
      }
      busy[id] = false; vals[id] = v; return v;
    }
    const out = g.supers.find(s => s.kind === "output");
    return out ? val(out.id) : null;
  }

  // ---- definitions, from the page's holders (super/nodes.js LabView.graphOf) ---------------------------
  let sig = "";
  function scan() {
    const LV = window.LabView; if (!LV || !LV.holders || !LV.graphOf) return;
    // until the page is first touched its start is laid out afresh on every load (super/pack.js): no definition is read
    // from a picture that is still moving
    try { if (!localStorage.getItem("se:touched")) return; } catch (_) { /* private mode: go on */ }
    const found = {};
    LV.holders().forEach(h => {
      const name = defName(h.str); if (!name) return;
      const g = LV.graphOf(h.el); if (g) found[name] = { graph: g, at: Date.now() };
    });
    let changed = false;
    // a drawing that lost every wire (a holder emptied by the layout, not by hand) never replaces a working definition
    Object.keys(found).forEach(n => { if (!found[n].graph.wires.length && defs[n] && defs[n].graph.wires.length) delete found[n]; });
    Object.keys(found).forEach(n => { const a = JSON.stringify(found[n].graph), b = defs[n] && JSON.stringify(defs[n].graph); if (a !== b) { defs[n] = found[n]; changed = true; if (!b) say("A new super: " + n + ". Type " + n + " into any super to use it"); } });
    const s = JSON.stringify(Object.keys(defs).sort());
    if (changed || s !== sig) { sig = s; store(); }
  }
  // read again only after the visitor changes something (a wire, a drag, typing, a scroll), never while the page loads
  // and lays itself out: a definition is what was drawn, not a picture caught half built
  const born = performance.now(); let dirty = false;
  const touch = () => { dirty = true; };
  ["pointerup", "keyup", "wheel"].forEach(t => window.addEventListener(t, touch, { capture: true, passive: true }));
  document.addEventListener("superlink:change", () => { if (performance.now() - born > 4000) touch(); });
  setInterval(() => { if (dirty && performance.now() - born > 4000) { dirty = false; scan(); } }, 600);

  // ---- on the page: a super's value from its typed words (super/nodes.js evalNode) -----------------------
  function page(n, ins, attached) {
    const t = String(n.str || "").trim(); if (!t) return null;
    const k = norm(t);
    const known = OPWORDS.test(k) || isNum(t) || OPS[k] || k === "select" || /^repeat\s+\S/i.test(t) || /^while\s+\S+\s+\S+$/i.test(t) || k === "count" || k === "keep" || k === "supers" || k === "export" || isPort(t) || !!find(t);
    if (defName(t)) return null;
    // a square's words are that text (the language: "other text: that text"), so a ■ with a sentence typed in shows it;
    // a prompt's words stay a question, and a Display (made to show what is wired in) keeps showing that
    if (!known) return (n.fn === "box" || n.fn === "dot") && n.role !== "engine" && n.role !== "stop" && !n.auto && !n.field ? toPage(t) : null;
    const xs = ins.map(fromPage);
    const st = n.mem || (n.mem = {});
    if (k === "keep") { const v = xs.find(x => x != null); if (v != null && !n.portHeld && v !== st.keep) { st.keep = v; if (window.LabView && window.LabView.persist) window.LabView.persist(); } }
    let v = compute(t, xs, attached, 0, st);
    if (v != null && typeof v === "object" && !Array.isArray(v)) v = "asks the AI engines: " + (v.ask || "");   // a question inside a defined super
    if (v == null && (IN.test(t) || OPWORDS.test(k) || OPS[k] || k === "select" || /^(repeat|while)\s/i.test(t) || find(t))) return Object.assign(toPage(null), { text: t, str: "" });   // nothing wired yet: it shows its word
    return toPage(v);
  }
  // a counter counts: on a tick of its sync and when it is run (Enter, the open control, the timer)
  function tickCount(n) {
    if (norm(n.str) !== "count" || n.portHeld || n.held) return false;
    const st = n.mem || (n.mem = {}); st.count = (st.count || 0) + 1;
    if (window.LabView && window.LabView.persist) window.LabView.persist();
    return true;
  }
  function onRun(n) {
    const k = norm(n.str);
    if (k === "count") return tickCount(n);
    if (k === "export") { download(); return true; }
    return false;
  }

  // ---- SuperAI assembly: the language's text form (rust/superai asm.rs) ---------------------------------
  const q = s => '"' + String(s).replace(/"/g, "'") + '"';
  function sasm(only) {
    const names = only ? [find(only)].filter(Boolean) : Object.keys(defs);
    const lines = ["; Supers drawn on pitechlab.com, exported " + new Date().toISOString().slice(0, 10) + ".",
      "; Each one was drawn as a holder named \"super NAME\". Words the Rust engine does not know yet (select, ≠, repeat,",
      "; while, count, keep, and calls of one defined super from another) run on the page (super/define.js).", ""];
    names.forEach(name => {
      const g = defs[name].graph, id = s => s.id.replace(/[^\w]/g, "_");
      lines.push("graph " + name);
      g.supers.forEach(s => {
        if (s.kind === "input") lines.push("  ⊙ " + id(s) + " input");
        else if (s.kind === "output") lines.push("  ⊙ " + id(s) + " output");
        else if (s.kind === "const") lines.push("  ■ " + id(s) + " " + q(text(s.value)));
        else lines.push("  ■ " + id(s) + (s.text ? " " + q(s.text) : "") + (s.shape === "prompt" ? " engine" : ""));   // a prompt computes, else asks
      });
      const P = { input: "◁", condition: "▽", sync: "△", output: "▷" };
      g.wires.forEach(([a, b]) => { const [ai] = a.split("."), [bi, bp] = b.split("."); lines.push("  ⟶ " + ai.replace(/[^\w]/g, "_") + "▷ " + bi.replace(/[^\w]/g, "_") + (P[bp] || "◁")); });
      lines.push("end", "");
    });
    return lines.join("\n");
  }
  function download() {
    if (!Object.keys(defs).length) { say("Nothing to export yet: name a holder \"super NAME\" and draw inside it"); return; }
    const blob = new Blob([sasm()], { type: "text/plain" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "my-supers.sasm"; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    say("Exported " + Object.keys(defs).length + " supers as my-supers.sasm");
  }
  function forget(name) { const f = find(name); if (f) { delete defs[f]; store(); return true; } return false; }

  window.SeDefine = { defs: () => JSON.parse(JSON.stringify(defs)), call: (name, args) => { const f = find(name); return f ? call(f, args || [], 0) : null; },
    page, tickCount, onRun, sasm, download, forget, defName, isPort, scan, touch };
})();
