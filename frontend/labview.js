// labview.js — a Functions palette and block diagram, like LabVIEW's.
//
// The palette (bottom-left) holds arithmetic, Boolean, comparison and
// structure nodes. Press one to run it once on the two newest digits of π.
// Drag one out and it becomes a node on the page; drop it onto any button,
// bubble, window, the π mark, the π counter or another node and it is wired
// to it: that thing becomes one of its inputs, and the node computes live.
//
//   a pill, bubble or window   number: how often you have opened it
//                              Boolean: whether its window is open
//   the π mark                 number: the newest digit of π; Boolean: π running
//   the π counter              number: decimals computed so far
//   another node               its output
//
// It is a small graphical language: the program is the wiring. Prompts are
// made the same way: a Text node is a string you type, a button wired in
// gives its name, Join puts two strings together, and Ask SciM sends what
// reaches it to the SciM Assistant when you press it, e.g.
//   [Text "Explain"] ─┐
//                     [Join] ── [Ask SciM]
//   (Whitepaper) ─────┘
//
// Click a wire to disconnect it. Drag a node onto the palette to remove it, double-click it to unwire it,
// press it to pause a loop. The diagram is remembered in this browser.
(function () {
  "use strict";
  const sq = '<svg viewBox="0 0 20 20" aria-hidden="true">';
  const FNS = [
    { k: "add", g: "+", name: "Add", n: 2 },
    { k: "sub", g: "−", name: "Subtract", n: 2 },
    { k: "mul", g: "×", name: "Multiply", n: 2 },
    { k: "div", g: "÷", name: "Divide", n: 2 },
    { k: "and", g: "AND", name: "And", n: 2 },
    { k: "or", g: "OR", name: "Or", n: 2 },
    { k: "xor", g: "XOR", name: "Exclusive Or", n: 2 },
    { k: "not", g: "NOT", name: "Not", n: 1 },
    { k: "gt", g: ">", name: "Greater?", n: 2 },
    { k: "eq", g: "=", name: "Equal?", n: 2 },
    { k: "for", svg: sq + '<rect x="2.5" y="2.5" width="15" height="15" rx="1"/><text x="4.5" y="9">N</text><text x="4.5" y="16">i</text></svg>', name: "For Loop", n: 1 },
    { k: "while", svg: sq + '<rect x="2.5" y="2.5" width="15" height="15" rx="1"/><path d="M13.5 13.5a4 4 0 1 1 0-5.5" fill="none"/><path d="M13.6 5.6v3h-3" fill="none"/></svg>', name: "While Loop", n: 1 },
    { k: "case", svg: sq + '<rect x="2.5" y="2.5" width="15" height="15" rx="1"/><path d="M5 6.5h10" /><text x="7.2" y="14.5">?</text></svg>', name: "Case Structure", n: 1 },
    { k: "text", g: "Abc", name: "Text", n: 0 },
    { k: "join", g: "a‿b", name: "Join", n: 2 },
    { k: "ask", svg: sq + '<path d="M3 4.5h14v8.5H9l-4 3v-3H3z" fill="none"/><text x="7.4" y="11.4">?</text></svg>', name: "Ask SciM", n: 1 },
  ];
  const BY = Object.fromEntries(FNS.map(f => [f.k, f]));
  const TARGETS = ".lv-node, .ob-member, .orbit-bubble, .orbit-core, .orbit-pi, .orbit-panel";
  const html = document.documentElement;
  const se = () => html.classList.contains("shape-se") && window.SeMorph;
  const O = () => window.PiOrbit || {};
  const piStr = () => (O().piDigits && O().piDigits()) || "";
  const still = () => !!(O().still && O().still());
  const glyph = (el, f) => { if (f.svg) el.innerHTML = f.svg; else el.textContent = f.g; };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* fine */ } };
  const restore = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };

  // ---- the quick run, from the palette ----------------------------------
  const bits = n => (n & 15).toString(2).padStart(4, "0");
  function quick(f) {
    const d = piStr() || "31", a = +d[d.length - 2] || 3, b = +d[d.length - 1] || 1;
    switch (f.k) {
      case "add": return a + " + " + b + " = " + (a + b);
      case "sub": return a + " − " + b + " = " + (a - b);
      case "mul": return a + " × " + b + " = " + a * b;
      case "div": return b ? a + " ÷ " + b + " = " + +(a / b).toFixed(4) : a + " ÷ 0 = NaN";
      case "and": return bits(a) + " AND " + bits(b) + " = " + bits(a & b);
      case "or": return bits(a) + " OR " + bits(b) + " = " + bits(a | b);
      case "xor": return bits(a) + " XOR " + bits(b) + " = " + bits(a ^ b);
      case "not": return "NOT " + bits(b) + " = " + bits(~b & 15);
      case "gt": return a + " > " + b + " → " + (a > b ? "T" : "F");
      case "eq": return a + " = " + b + " → " + (a === b ? "T" : "F");
      case "case": return "case " + (b % 2 ? "odd" : "even") + " (" + b + ")";
      case "text": return "drag it out and type a string; wire it into Join or Ask SciM";
      case "join": return "drag it out and wire two strings (Text nodes or buttons) into it";
      case "ask": return "drag it out, wire text into it, press it to send the prompt to SciM";
      default: return "drag it onto a button to give it an input";
    }
  }

  // ---- the diagram -----------------------------------------------------
  let nodes = [];           // { id, fn, fx, fy, inputs: [ref], st: {i, paused}, out, changed, el }
  let canvas, wires, out, pal, dragging = null, fold = () => {};
  const ZERO = { num: 0, bool: false, str: "" };

  function refOf(el) {
    if (!el) return null;
    if (el.matches(".lv-node")) return { node: el.dataset.id };
    if (el.matches(".orbit-core")) return { core: 1 };
    if (el.matches(".orbit-pi")) return { pi: 1 };
    if (el.matches(".orbit-panel")) { const k = O().keyOf && O().keyOf(el); return k ? { key: k } : null; }
    if (el.dataset.key) return { key: el.dataset.key };
    return null;
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function elOf(ref) {
    if (ref.node) { const n = nodes.find(x => x.id === ref.node); return n && n.el; }
    if (ref.core) return document.querySelector(".orbit-core");
    if (ref.pi) return document.querySelector(".orbit-pi");
    return O().elOf ? O().elOf(ref.key) : null;
  }
  function nameOf(ref) {
    if (ref.node) { const n = nodes.find(x => x.id === ref.node); return n ? BY[n.fn].name + " node" : "a node"; }
    if (ref.core) return "the π mark";
    if (ref.pi) return "the π counter";
    const i = O().info && O().info(ref.key);
    return i ? i.title : ref.key;
  }

  // values, recomputed every tick in dependency order (a loop in the wiring gives NaN)
  let memo = {}, visiting = {};
  function valueOf(ref) {
    if (!ref) return ZERO;
    if (ref.node) return evalNode(nodes.find(x => x.id === ref.node));
    if (ref.core) { const d = piStr(); return { num: +d[d.length - 1] || 0, bool: !still(), str: "π" }; }
    if (ref.pi) { const d = piStr(); return { num: Math.max(0, d.length - 1), bool: !still(), str: d ? d[0] + "." + d.slice(1) : "π" }; }
    const i = O().info && O().info(ref.key);
    return i ? { num: i.use, bool: i.open, str: i.title } : ZERO;
  }
  const clip = t => t.length > 28 ? t.slice(0, 27) + "…" : t;
  const strOf = v => v.str != null && v.str !== "" ? v.str : v.text || (v === ZERO ? "" : String(v.num));
  const B = v => ({ num: v ? 1 : 0, bool: !!v, text: v ? "T" : "F" });
  const N = v => ({ num: v, bool: !!v && !Number.isNaN(v), text: Number.isNaN(v) ? "NaN" : Number.isInteger(v) ? String(v) : v.toFixed(3) });
  function evalNode(n) {
    if (!n) return ZERO;
    if (memo[n.id]) return memo[n.id];
    if (visiting[n.id]) return { num: NaN, bool: false, text: "NaN" };
    visiting[n.id] = true;
    const a = valueOf(n.inputs[0]), b = valueOf(n.inputs[1]);
    let r;
    switch (n.fn) {
      case "add": r = N(a.num + b.num); break;
      case "sub": r = N(a.num - b.num); break;
      case "mul": r = N(a.num * b.num); break;
      case "div": r = N(b.num ? a.num / b.num : NaN); break;
      case "and": r = B(a.bool && b.bool); break;
      case "or": r = B(a.bool || b.bool); break;
      case "xor": r = B(a.bool !== b.bool); break;
      case "not": r = B(!a.bool); break;
      case "gt": r = B(a.num > b.num); break;
      case "eq": r = B(a.num === b.num); break;
      case "text": { const t = n.str || ""; r = { num: parseFloat(t) || 0, bool: !!t.trim(), str: t, text: "" }; break; }
      case "join": { const t = [strOf(a), strOf(b)].filter(Boolean).join(" "); r = { num: t.length, bool: !!t, str: t, text: t ? "“" + clip(t) + "”" : "–" }; break; }
      case "ask": { const t = strOf(a); r = { num: t.length, bool: !!t, str: t, text: n.sent ? "sent ✓" : t ? "press to ask" : "wire text in" }; break; }
      case "case": { const t = a.bool || (a.num !== 0 && !Number.isNaN(a.num)); r = { num: t ? 1 : 0, bool: t, text: t ? "True ▸" : "False ▸" }; break; }
      case "for": {
        const cnt = n.inputs[0] ? Math.max(0, Math.min(99, Math.round(a.num) || 0)) : 10;
        r = { num: n.st.i, bool: cnt > 0, text: cnt ? "i " + n.st.i + " / N " + cnt : "N 0" }; n.st.N = cnt; break;
      }
      case "while": {
        const go = n.inputs[0] ? a.bool : false;
        r = { num: n.st.i, bool: go && !n.st.paused, text: (go && !n.st.paused ? "↻ i " : "■ i ") + n.st.i }; n.st.go = go; break;
      }
      default: r = ZERO;
    }
    visiting[n.id] = false;
    memo[n.id] = r;
    return r;
  }

  function tick() {
    // the loops step first, then everything is computed once
    nodes.forEach(n => {
      if (n.st.paused) return;
      if (n.fn === "for" && n.st.N) n.st.i = (n.st.i + 1) % n.st.N;
      if (n.fn === "while" && n.st.go) n.st.i++;
    });
    memo = {}; visiting = {};
    const now = performance.now();
    nodes.forEach(n => {
      const r = evalNode(n);
      if (n.text !== r.text) { n.text = r.text; n.changed = now; n.val.textContent = r.text; }
      n.el.classList.toggle("is-true", r.bool === true && /^(and|or|xor|not|gt|eq|case)$/.test(n.fn));
      n.el.classList.toggle("is-running", (n.fn === "for" && !!n.st.N || n.fn === "while" && !!n.st.go) && !n.st.paused);
      n.el.setAttribute("aria-label", BY[n.fn].name + " node" + (n.inputs.length ? ", wired to " + n.inputs.map(nameOf).join(" and ") : ", not wired") + ". Output " + r.text + ".");
      n.el.title = BY[n.fn].name + (n.inputs.length ? " ← " + n.inputs.map(nameOf).join(", ") : "") + "\nDrop it on a button to wire it, on the palette to remove it; double-click to unwire";
    });
    drawWires();
  }

  // LabVIEW wires: horizontal, vertical, horizontal, into the node's input terminals
  function drawWires() {
    if (!wires) return;
    const now = performance.now(), sp = se();
    const term = (x, y, cls) => sp ? '<path class="' + cls + '" d="' + sp.star(x, y, 5, 5) + '"/>'
      : '<rect class="' + cls + '" x="' + (x - 3) + '" y="' + (y - 3) + '" width="6" height="6"/>';
    let s = "";
    nodes.forEach(n => {
      const nr = n.el.getBoundingClientRect(), arity = BY[n.fn].n;
      n.inputs.forEach((ref, idx) => {
        const src = elOf(ref);
        if (!src || !src.getClientRects().length) return;
        const r = src.getBoundingClientRect();
        if (!r.width) return;
        const tx = nr.left, ty = nr.top + nr.height * (idx + 1) / (arity + 1);
        const cy = r.top + r.height / 2;
        const right = r.left + r.width / 2 <= tx;
        const sx = right ? r.right : r.left;
        // a curve out of the source's side and into the node's input from the left
        const c = Math.max(30, Math.abs(tx - sx) * 0.5), sg = right ? 1 : -1;
        const d = "M" + sx + "," + cy + "C" + (sx + sg * c) + "," + cy + " " + (tx - c) + "," + ty + " " + tx + "," + ty;
        const src2 = ref.node && nodes.find(x => x.id === ref.node);
        const live = now - (n.changed || 0) < 1200 || (src2 && now - (src2.changed || 0) < 1200) || n.el.classList.contains("is-running");
        s += '<g class="wire' + (live ? " live" : "") + '"><path class="wire-bed" d="' + d + '"/><path class="wire-flow" d="' + d + '"/>' +
             term(sx, cy, "wire-term") + term(tx, ty, "wire-term") +
             '<path class="wire-hit" data-node="' + n.id + '" data-i="' + idx + '" d="' + d + '"><title>Click to disconnect</title></path></g>';
      });
    });
    if (s !== wires.dataset.last) { wires.dataset.last = s; wires.innerHTML = s; }   // unchanged wires stay, so a click lands
  }

  // ---- making, moving and removing nodes -------------------------------
  function persist() { save("lv:nodes", nodes.map(n => ({ id: n.id, fn: n.fn, fx: n.fx, fy: n.fy, inputs: n.inputs, str: n.fn === "text" ? n.str : undefined }))); }
  function place(n) {
    const w = n.el.offsetWidth || 44, h = n.el.offsetHeight || 32;
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, n.fx * window.innerWidth));
    const y = Math.max(4, Math.min(window.innerHeight - h - 22, n.fy * window.innerHeight));
    n.el.style.left = x + "px"; n.el.style.top = y + "px";
  }
  function make(spec) {
    const f = BY[spec.fn];
    if (!f) return null;
    const el = document.createElement("div");
    el.setAttribute("role", "button"); el.tabIndex = 0;
    el.className = "lv-node lv-fn lv-" + f.k;
    el.dataset.id = spec.id;
    const g = document.createElement("span"); g.className = "lv-glyph"; glyph(g, f);
    const val = document.createElement("span"); val.className = "lv-val"; val.setAttribute("aria-hidden", "true");
    el.append(g, val);
    const n = { id: spec.id, fn: f.k, fx: spec.fx, fy: spec.fy, inputs: (spec.inputs || []).slice(0, f.n), st: { i: 0, paused: false }, el, val, text: "", str: spec.str != null ? spec.str : "Explain" };
    if (f.k === "text") {
      const inp = document.createElement("input");
      inp.type = "text"; inp.className = "lv-text"; inp.value = n.str; inp.setAttribute("aria-label", "Text"); inp.spellcheck = false;
      inp.addEventListener("pointerdown", e => e.stopPropagation());
      inp.addEventListener("keydown", e => e.stopPropagation());
      inp.addEventListener("input", () => { n.str = inp.value; persist(); tick(); });
      g.replaceWith(inp);
    }
    canvas.appendChild(el);
    nodes.push(n);
    place(n);
    wireNode(n);
    return n;
  }
  function remove(n) {
    nodes = nodes.filter(x => x !== n);
    nodes.forEach(x => { x.inputs = x.inputs.filter(r => r.node !== n.id); });
    n.el.remove();
    persist(); tick();
  }
  function attach(n, ref) {
    if (!ref || (ref.node && ref.node === n.id)) return false;
    if (n.inputs.some(r => same(r, ref))) return true;
    n.inputs.push(ref);
    while (n.inputs.length > BY[n.fn].n) n.inputs.shift();   // a full node lets go of its oldest input
    return true;
  }
  function targetAt(x, y, self) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (self && (el === self || self.contains(el))) continue;
      if (el.closest(".lv-palette")) return { palette: true };
      const t = el.closest(TARGETS);
      if (t && t !== self) return { el: t };
    }
    return null;
  }
  // after a drop onto something, the node steps beside it rather than on top of it
  function beside(n, el) {
    const r = el.getBoundingClientRect(), w = n.el.offsetWidth, h = n.el.offsetHeight;
    let x = r.right + 28;
    if (x + w > window.innerWidth - 4) x = r.left - w - 28;
    if (el.matches(".orbit-panel")) x = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w - 16)), n.fy = (r.top + 8) / window.innerHeight;
    else n.fy = (r.top + r.height / 2 - h / 2) / window.innerHeight;
    n.fx = Math.max(4, x) / window.innerWidth;
    place(n);
  }

  // one drag, from the palette or of a node on the page
  function drag(e, startEl, spawn) {
    if (e.button !== undefined && e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let n = spawn ? null : nodes.find(x => x.el === startEl), moved = false, dx = 0, dy = 0;
    if (n) { const r = n.el.getBoundingClientRect(); dx = x0 - r.left; dy = y0 - r.top; }
    try { startEl.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moved) {
        moved = true;
        if (spawn) { n = make({ id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), fn: spawn.k, fx: 0, fy: 0, inputs: [] }); dx = n.el.offsetWidth / 2; dy = n.el.offsetHeight / 2; }
        n.el.classList.add("is-dragging"); dragging = n;
        if (window.innerWidth < 700) fold();      // on a phone the palette steps aside: its tab is still the bin
        html.classList.add("lv-dragging");
      }
      n.fx = (ev.clientX - dx) / window.innerWidth; n.fy = (ev.clientY - dy) / window.innerHeight;
      place(n);
      const t = targetAt(ev.clientX, ev.clientY, n.el);
      document.querySelectorAll(".lv-hover").forEach(x => x.classList.remove("lv-hover"));
      if (t && t.el) t.el.classList.add("lv-hover");
      pal.classList.toggle("lv-bin", !!(t && t.palette) && !spawn);
      drawWires();
      ev.preventDefault();
    };
    const up = ev => {
      startEl.removeEventListener("pointermove", move);
      startEl.removeEventListener("pointerup", up);
      startEl.removeEventListener("pointercancel", up);
      document.querySelectorAll(".lv-hover").forEach(x => x.classList.remove("lv-hover"));
      pal.classList.remove("lv-bin");
      html.classList.remove("lv-dragging");
      if (!moved) return;
      startEl.dataset.dragged = "1"; setTimeout(() => { delete startEl.dataset.dragged; }, 0);
      n.el.classList.remove("is-dragging"); dragging = null;
      const t = ev.type === "pointerup" ? targetAt(ev.clientX, ev.clientY, n.el) : null;
      if (t && t.palette) { remove(n); say(BY[n.fn].name + " node removed"); return; }
      if (t && t.el) {
        const ref = refOf(t.el);
        if (attach(n, ref)) { beside(n, t.el); say(BY[n.fn].name + " wired to " + nameOf(ref)); }
      } else if (spawn) say(BY[n.fn].name + " placed: drop it on a button to wire it");
      persist(); tick();
    };
    startEl.addEventListener("pointermove", move);
    startEl.addEventListener("pointerup", up);
    startEl.addEventListener("pointercancel", up);
  }
  function wireNode(n) {
    n.el.addEventListener("pointerdown", e => drag(e, n.el, null));
    n.el.addEventListener("click", () => {
      if (n.el.dataset.dragged) return;
      n.el.classList.remove("fired"); void n.el.offsetWidth; n.el.classList.add("fired");
      if (n.fn === "for" || n.fn === "while") { n.st.paused = !n.st.paused; say(BY[n.fn].name + (n.st.paused ? " paused" : " running")); }
      else if (n.fn === "ask") ask(n);
      else if (n.fn === "text") { const i = n.el.querySelector("input"); if (i) i.focus(); }
      else say(BY[n.fn].name + ": " + (n.text || "no inputs yet"));
      tick();
    });
    n.el.addEventListener("dblclick", () => { n.inputs = []; n.st.i = 0; persist(); tick(); say(BY[n.fn].name + " unwired"); });
    n.el.addEventListener("keydown", e => {
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(n); say(BY[n.fn].name + " node removed"); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); n.el.click(); }
    });
  }
  function say(t) { if (out) out.textContent = t; }
  // Ask SciM: the prompt that reaches the node goes to the SciM Assistant, only when pressed
  function ask(n) {
    memo = {}; visiting = {};
    const q = strOf(valueOf(n.inputs[0])).trim();
    if (!q) { say("Ask SciM: wire some text into it first"); return; }
    if (!(O().openTitle && O().openTitle("SciM Assistant"))) { say("SciM Assistant is not available here"); return; }
    setTimeout(() => {
      const inp = document.getElementById("scilemInput"), form = document.getElementById("scilemForm");
      if (!inp || !form) return;
      inp.value = q;
      if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event("submit", { cancelable: true }));
    }, 160);
    n.sent = true; setTimeout(() => { n.sent = false; }, 4000);
    say("Asked SciM: " + q);
  }

  // ---- the palette -----------------------------------------------------
  function build() {
    if (document.querySelector(".lv-palette")) return;
    canvas = document.createElement("div");
    canvas.className = "lv-canvas";
    canvas.innerHTML = '<svg class="lv-wires" aria-hidden="true"></svg>';
    wires = canvas.firstChild;
    // click a wire to disconnect that input
    wires.addEventListener("click", e => {
      const w = e.target.closest && e.target.closest(".wire-hit");
      const n = w && nodes.find(x => x.id === w.dataset.node);
      if (!n) return;
      const ref = n.inputs.splice(+w.dataset.i, 1)[0];
      persist(); tick();
      say(BY[n.fn].name + " disconnected from " + (ref ? nameOf(ref) : "its input"));
    });
    document.body.appendChild(canvas);

    pal = document.createElement("aside");
    pal.className = "lv-palette";
    pal.setAttribute("aria-label", "Functions palette");
    let open = false, chosen = false;
    try { const s = localStorage.getItem("lv:open"); if (s !== null) { open = s === "1"; chosen = true; } } catch (_) { /* fine */ }
    pal.innerHTML = '<button type="button" class="lv-head" aria-expanded="false"><span class="lv-title">Functions</span><span class="lv-caret" aria-hidden="true"></span></button>' +
      '<div class="lv-grid" role="group" aria-label="Functions"></div><output class="lv-out" aria-live="polite">Drag a node onto any button to wire it, or press it to run it on π</output>';
    const grid = pal.querySelector(".lv-grid"), head = pal.querySelector(".lv-head");
    out = pal.querySelector(".lv-out");
    const setOpen = v => { open = v; pal.classList.toggle("is-open", v); head.setAttribute("aria-expanded", String(v)); };
    fold = () => setOpen(false);
    head.addEventListener("click", () => { chosen = true; setOpen(!open); try { localStorage.setItem("lv:open", open ? "1" : "0"); } catch (_) { /* fine */ } });
    pal.classList.toggle("is-open", open); head.setAttribute("aria-expanded", String(open));

    FNS.forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lv-fn lv-" + f.k;
      b.title = f.name + ": press to run on π, drag onto a button to wire it";
      b.setAttribute("aria-label", f.name);
      glyph(b, f);
      b.addEventListener("pointerdown", e => drag(e, b, f));
      b.addEventListener("click", () => {
        if (b.dataset.dragged) return;
        b.classList.remove("fired"); void b.offsetWidth; b.classList.add("fired");
        say(f.name + ": " + quick(f));
      });
      grid.appendChild(b);
    });
    document.body.appendChild(pal);

    // unless you chose, it starts open only where it has room beside the diagram
    const roomy = () => {
      pal.classList.add("is-open");
      const r = pal.getBoundingClientRect();
      const hit = [...document.querySelectorAll(".orbit-bubble, .orbit-core, .orbit-pi")].some(b => {
        if (!b.offsetParent) return false;
        const q = b.getBoundingClientRect();
        return !(q.right <= r.left || r.right <= q.left || q.bottom <= r.top || r.bottom <= q.top);
      });
      pal.classList.toggle("is-open", open);
      return !hit;
    };
    const decide = () => { if (!chosen) setOpen(window.innerWidth >= 700 && roomy()); };
    setTimeout(decide, 1200);
    let rt = 0;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { decide(); nodes.forEach(place); drawWires(); }, 200); });

    // the diagram you left last time
    (restore("lv:nodes") || []).forEach(make);
    setInterval(tick, 250);
    tick();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  window.LabView = { nodes: () => nodes.map(n => ({ id: n.id, fn: n.fn, inputs: n.inputs, out: n.text, str: n.fn === "text" ? n.str : undefined })) };
})();
