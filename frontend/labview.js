// labview.js — a Functions palette and block diagram, like LabVIEW's.
//
// The palette (bottom-left) holds arithmetic, AND, Play, Stop, Show and
// Ask SciM. Press one to run it once on the two newest digits of π.
// Drag one out and it becomes a node on the page; drop it onto any button,
// bubble, window, the π mark, the π counter or another node and it is wired
// to it: that thing becomes one of its inputs, and the node computes live.
//
//   a pill, bubble or window   number: how often you have opened it
//                              Boolean: whether its window is open
//   the π mark (the main loop) number: the newest digit of π; Boolean: π running
//                              (in the superellipse look, drop on the loop's edge)
//   the π counter              number: decimals computed so far
//   another node               its output
//
// Play starts π (and everything that follows it), Stop stops it: the same as
// double-clicking the π mark. Show is an empty box: wire anything into it and
// it shows that thing's value inside itself. Ask SciM sends the name or text
// that reaches it to the SciM Assistant when you press it.
//
// Click a wire to disconnect it. Drag a node onto the palette to remove it,
// double-click it to unwire it. The diagram is remembered in this browser.
(function () {
  "use strict";
  const sq = '<svg viewBox="0 0 20 20" aria-hidden="true">';
  const FNS = [
    { k: "add", g: "+", name: "Add", n: 2 },
    { k: "sub", g: "−", name: "Subtract", n: 2 },
    { k: "mul", g: "×", name: "Multiply", n: 2 },
    { k: "div", g: "÷", name: "Divide", n: 2 },
    { k: "and", g: "AND", name: "And", n: 2 },
    { k: "play", svg: sq + '<path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none"/></svg>', name: "Play", n: 0 },
    { k: "stop", svg: sq + '<rect x="5" y="5" width="10" height="10" rx="1" fill="currentColor" stroke="none"/></svg>', name: "Stop", n: 0 },
    { k: "show", g: "", name: "Show", n: 1 },
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
      case "play": run(true); return "π running";
      case "stop": run(false); return "π stopped";
      case "show": return "drag it out and drop it on anything to show its value";
      case "ask": return "drag it out, wire a button into it, press it to ask SciM about that";
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
      case "play": r = { num: still() ? 0 : 1, bool: !still(), text: still() ? "stopped" : "running" }; break;
      case "stop": r = { num: still() ? 1 : 0, bool: still(), text: still() ? "stopped" : "running" }; break;
      case "show": r = n.inputs[0] ? { num: a.num, bool: a.bool, str: strOf(a), text: a.text != null && a.text !== "" ? a.text : clip(strOf(a)) } : { num: 0, bool: false, text: "" }; break;
      case "ask": { const t = strOf(a); r = { num: t.length, bool: !!t, str: t, text: n.sent ? "sent ✓" : t ? "press to ask" : "wire text in" }; break; }
      default: r = ZERO;
    }
    visiting[n.id] = false;
    memo[n.id] = r;
    return r;
  }

  function tick() {
    memo = {}; visiting = {};
    const now = performance.now();
    nodes.forEach(n => {
      const r = evalNode(n);
      if (n.text !== r.text) {
        n.text = r.text; n.changed = now;
        if (n.fn === "show") n.el.querySelector(".lv-glyph").textContent = r.text;   // Show holds its value inside
        else n.val.textContent = r.text;
      }
      n.el.classList.toggle("is-true", r.bool === true && n.fn === "and");
      n.el.classList.toggle("is-running", (n.fn === "play" && r.bool) || (n.fn === "stop" && r.bool));
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
        let cy = r.top + r.height / 2;
        let right = r.left + r.width / 2 <= tx;
        let sx = right ? r.right : r.left;
        if (ref.core && O().loopPoint) {                 // the main loop: the wire leaves it where it faces the node
          const lp = O().loopPoint(tx, ty); sx = lp[0]; cy = lp[1]; right = sx <= tx;
        }
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
  function persist() { save("lv:nodes", nodes.map(n => ({ id: n.id, fn: n.fn, fx: n.fx, fy: n.fy, inputs: n.inputs }))); }
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
    const n = { id: spec.id, fn: f.k, fx: spec.fx, fy: spec.fy, inputs: (spec.inputs || []).slice(0, f.n), st: { i: 0, paused: false }, el, val, text: "" };
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
      // the loop behind everything counts only on its edge, so a drop on empty space just places the node
      if (t && t.matches(".orbit-core") && O().nearLoop && !O().nearLoop(x, y)) continue;
      if (t && t !== self) return { el: t };
    }
    return null;
  }
  // after a drop onto something, the node steps beside it rather than on top of it
  function beside(n, el, px, py) {
    const r = el.getBoundingClientRect(), w = n.el.offsetWidth, h = n.el.offsetHeight;
    // a page-sized loop: settle just inside it, near where it was dropped
    if (el.matches(".orbit-core") && (r.width >= window.innerWidth * 0.8) && px != null) {
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2, d = Math.hypot(cx - px, cy - py) || 1;
      const k = Math.min(1, 90 / d), x = px + (cx - px) * k, y = py + (cy - py) * k;
      n.fx = Math.max(4, Math.min(window.innerWidth - w - 4, x - w / 2)) / window.innerWidth;
      n.fy = Math.max(4, Math.min(window.innerHeight - h - 22, y - h / 2)) / window.innerHeight;
      place(n); return;
    }
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
        if (attach(n, ref)) { beside(n, t.el, ev.clientX, ev.clientY); say(BY[n.fn].name + " wired to " + nameOf(ref)); }
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
      if (n.fn === "play" || n.fn === "stop") { run(n.fn === "play"); say(n.fn === "play" ? "Play: π running" : "Stop: π stopped"); }
      else if (n.fn === "ask") ask(n);
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
  // Play and Stop: π, and everything that follows it, runs or stands still
  function run(on) { if (O().setStill) O().setStill(!on); }
  // Ask SciM: the prompt that reaches the node goes to the SciM Assistant, only when pressed
  function ask(n) {
    memo = {}; visiting = {};
    const q = strOf(valueOf(n.inputs[0])).trim();
    if (!q) { say("Ask SciM: wire a button into it first"); return; }
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
    const setOpen = v => {
      open = v; pal.classList.toggle("is-open", v); head.setAttribute("aria-expanded", String(v));
      setTimeout(() => { if (window.PiOrbit && window.PiOrbit.layout) window.PiOrbit.layout(); }, 300);   // the pills make room for it
    };
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
  window.LabView = { nodes: () => nodes.map(n => ({ id: n.id, fn: n.fn, inputs: n.inputs, out: n.text })) };
})();
