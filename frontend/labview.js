// labview.js — a Functions palette and block diagram, like LabVIEW's.
//
// The palette (bottom-left) holds + − × ÷, Play, Stop, Show and Scissors. Press one to
// run it once on the two newest digits of π. Drag one out and it becomes a
// node on the page; drop it onto any number on the page, a button, bubble,
// window, the π mark, the π counter or another node and it is wired to it:
// that thing becomes one of its inputs, and the node computes live.
//
//   a number anywhere on the page   its value ("3"; "1,549" is read as 1549)
//   a pill, bubble or window   number: how often you have opened it
//   the π mark (the main loop) number: the newest digit of π
//                              (in the superellipse look, drop on the loop's edge)
//   the π counter              number: decimals computed so far
//   another node               its output
//
// Wires drawn in Connect mode (superlink.js) count too: wire a number, word or
// node to a node and it becomes one of that node's inputs.
//
// + adds every input (and joins words: "Connect" + "Contact" shows
// "Connect Contact"; a button, bubble or window counts as its name), × multiplies them, − and ÷ take the first and subtract
// or divide by the rest. Show is an empty box: wire anything into it and it
// shows that value inside itself. Play runs π, Stop stops it (the same as
// double-clicking the π mark); everything wired to π follows.
// The Super Neural Engine is the pill star (a superellipse at n = γ). It is
// prompted by wiring: whatever reaches it (words, numbers, buttons, windows,
// other nodes) is joined into a prompt and sent to /api/super/ask, where every
// engine in the project answers (siM, riB, piD, PiEn; see backend/super_engine.py).
// If the prompt's words name a window ("assess manuscripts"), it opens it too.
// "?" asks the panel: wire the Super Neural Engine into it and the same AIs that
// judge manuscripts (Llama, Mistral, Qwen, Gemini, DeepSeek) answer its question
// independently, with the engines' answer as context; the judge weighs them and
// says how far they agree (/api/super/panel). It asks again when its wiring
// changes or the engine gives a new answer, or when pressed.
// Wire a Show to it to read the answer. It asks again whenever its wiring
// changes, or when you press it; while it thinks the star grows toward a
// superellipse (n climbing from γ to π), and it is fully grown once answered.
// Scissors captures pixels from the screen: press it, choose the screen, window
// or tab to share, drag a box over what you want, and the cut-out lands on the
// page as a Clip node (its value is its size, "120×80"). Click a clip to save
// it as a PNG, drag it onto the palette to remove it.
//   (3 on the page) ─┐
//                    [+] ── [Show 8]
//   (5 on the page) ─┘
//
// Click a wire to disconnect it. Drag a node onto the palette to remove it,
// double-click it to unwire it. The diagram is remembered in this browser.
(function () {
  "use strict";
  const sq = '<svg viewBox="0 0 20 20" aria-hidden="true">';
  const FNS = [
    { k: "add", g: "+", name: "Add", n: 9 },
    { k: "sub", g: "−", name: "Subtract", n: 9 },
    { k: "mul", g: "×", name: "Multiply", n: 9 },
    { k: "div", g: "÷", name: "Divide", n: 9 },
    { k: "play", svg: sq + '<path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none"/></svg>', name: "Play", n: 0 },
    { k: "flip", svg: sq + '<path d="M16.80 10.00L16.75 10.19L16.60 10.55L16.35 11.01L16.02 11.55L15.60 12.14L15.12 12.75L14.58 13.38L13.99 13.99L13.38 14.58L12.75 15.12L12.14 15.60L11.55 16.02L11.01 16.35L10.55 16.60L10.19 16.75L10.00 16.80L9.81 16.75L9.45 16.60L8.99 16.35L8.45 16.02L7.86 15.60L7.25 15.12L6.62 14.58L6.01 13.99L5.42 13.38L4.88 12.75L4.40 12.14L3.98 11.55L3.65 11.01L3.40 10.55L3.25 10.19L3.20 10.00L3.25 9.81L3.40 9.45L3.65 8.99L3.98 8.45L4.40 7.86L4.88 7.25L5.42 6.62L6.01 6.01L6.62 5.42L7.25 4.88L7.86 4.40L8.45 3.98L8.99 3.65L9.45 3.40L9.81 3.25L10.00 3.20L10.19 3.25L10.55 3.40L11.01 3.65L11.55 3.98L12.14 4.40L12.75 4.88L13.38 5.42L13.99 6.01L14.58 6.62L15.12 7.25L15.60 7.86L16.02 8.45L16.35 8.99L16.60 9.45L16.75 9.81Z" fill="currentColor" stroke="none"/></svg>', name: "Flip", n: 0, act: true },   // a superellipse diamond, n = 1.3: drop it on a node to swap its inputs
    { k: "stop", svg: sq + '<rect x="5" y="5" width="10" height="10" rx="1" fill="currentColor" stroke="none"/></svg>', name: "Stop", n: 0 },
    { k: "show", g: "", name: "Show", n: 1 },
    { k: "super", svg: sq + '<path class="lv-star" d="M18.20 10.00L17.96 10.01L17.27 10.08L16.23 10.29L14.98 10.74L13.68 11.47L12.47 12.47L11.47 13.68L10.74 14.98L10.29 16.23L10.08 17.27L10.01 17.96L10.00 18.20L9.99 17.96L9.92 17.27L9.71 16.23L9.26 14.98L8.53 13.68L7.53 12.47L6.32 11.47L5.02 10.74L3.77 10.29L2.73 10.08L2.04 10.01L1.80 10.00L2.04 9.99L2.73 9.92L3.77 9.71L5.02 9.26L6.32 8.53L7.53 7.53L8.53 6.32L9.26 5.02L9.71 3.77L9.92 2.73L9.99 2.04L10.00 1.80L10.01 2.04L10.08 2.73L10.29 3.77L10.74 5.02L11.47 6.32L12.47 7.53L13.68 8.53L14.98 9.26L16.23 9.71L17.27 9.92L17.96 9.99Z"/></svg>', name: "Super Neural Engine", n: 9 },   // the pill star, n = γ
    { k: "panel", g: "?", name: "Ask the panel", n: 9 },
    { k: "cut", svg: sq + '<circle cx="5.5" cy="14.5" r="2.6"/><circle cx="14.5" cy="14.5" r="2.6"/><path d="M7.3 12.6 15 3.5M12.7 12.6 5 3.5"/></svg>', name: "Scissors", n: 0, press: true },
    { k: "clip", g: "", name: "Clip", n: 0, hidden: true },
  ];
  const BY = Object.fromEntries(FNS.map(f => [f.k, f]));
  const TARGETS = ".lv-node, .ob-member, .orbit-bubble, .orbit-core, .orbit-pi, .orbit-panel";
  const html = document.documentElement;
  const se = () => html.classList.contains("shape-se") && window.SeMorph;
  const O = () => window.PiOrbit || {};
  const piStr = () => (O().piDigits && O().piDigits()) || "";
  const still = () => !!(O().still && O().still());
  const glyph = (el, f) => { if (f.svg) el.innerHTML = f.svg; else el.textContent = f.g; };
  const save = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (_) {   // full: keep the diagram, drop the clips' pixels
      try { localStorage.setItem(k, JSON.stringify(Array.isArray(v) ? v.filter(x => x.fn !== "clip") : v)); } catch (__) { /* fine */ }
    }
  };
  const restore = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };

  // ---- the quick run, from the palette ----------------------------------
  function quick(f) {
    const d = piStr() || "31", a = +d[d.length - 2] || 3, b = +d[d.length - 1] || 1;
    switch (f.k) {
      case "add": return a + " + " + b + " = " + (a + b);
      case "sub": return a + " − " + b + " = " + (a - b);
      case "mul": return a + " × " + b + " = " + a * b;
      case "div": return b ? a + " ÷ " + b + " = " + +(a / b).toFixed(4) : a + " ÷ 0 = NaN";
      case "play": run(true); return "π running";
      case "stop": run(false); return "π stopped";
      case "show": return "drag it out and drop it on anything to show its value";
      case "super": return "drag it out and wire words, numbers, buttons or nodes into it: every engine answers, and a Show wired to it shows the answer";
      case "flip": return "drag it onto a node to swap the order of its inputs";
      case "panel": return "drag it out and wire the Super Neural Engine (or any text) into it: the panel of AIs that judges manuscripts answers, and the judge weighs them";
      case "cut": cut(); return "choose what to share, then drag a box over the pixels you want";
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
    if (ref.core) { const d = piStr(), v = +d[d.length - 1] || 0; return { num: v, isNum: true, bool: !still(), str: String(v) }; }
    if (ref.pi) { const d = piStr(), v = Math.max(0, d.length - 1); return { num: v, isNum: true, bool: !still(), str: String(v) }; }
    const i = O().info && O().info(ref.key);
    return i ? { num: i.use, bool: i.open, str: i.title } : ZERO;
  }
  // a number or word on the page, as Connect mode (superlink.js) remembers it
  const numOf = t => { const v = parseFloat(String(t).replace(/[,\s'’](?=\d{3}\b)/g, "").replace(",", ".")); return Number.isNaN(v) ? NaN : v; };
  function valueOfAnchor(an) {
    if (an.loop) return valueOf({ core: 1 });
    if (an.h && an.h.startsWith("node:")) return valueOf({ node: an.h.slice(5) });
    if (!an.el) { const v = numOf(an.t); return { num: Number.isNaN(v) ? 0 : v, isNum: !Number.isNaN(v), bool: !!an.t, str: an.t, text: an.t }; }
    if (an.h === "pi") return valueOf({ pi: 1 });
    if (an.h && an.h.startsWith("k:")) return valueOf({ key: an.h.slice(2) });
    const t = an.h ? an.h.replace(/^[a-z#]+:?/, "") : ""; return { num: 0, bool: !!t, str: t };
  }
  // Connect-mode wires that end on this node (and don't come from it), oldest first
  function linkIns(n) {
    const L = window.SuperLink && window.SuperLink.links ? window.SuperLink.links() : [], me = "node:" + n.id;
    const out = [];
    L.forEach(l => {
      if (l.b && l.b.h === me && !(l.a && l.a.h === me)) out.push(l.a);
      else if (l.a && l.a.h === me && l.b && !(l.b.h && l.b.h.startsWith("node:"))) out.push(l.b);   // node → a number: the number still feeds it
    });
    return out;
  }
  const clip = t => t.length > 28 ? t.slice(0, 27) + "…" : t;
  const strOf = v => v.str != null && v.str !== "" ? v.str : v.text || (v === ZERO ? "" : String(v.num));
  const N = v => ({ num: v, isNum: true, bool: !!v && !Number.isNaN(v), text: Number.isNaN(v) ? "NaN" : Number.isInteger(v) ? String(v) : v.toFixed(3) });
  function evalNode(n) {
    if (!n) return ZERO;
    if (memo[n.id]) return memo[n.id];
    if (visiting[n.id]) return { num: NaN, bool: false, text: "NaN" };
    visiting[n.id] = true;
    const ins = n.inputs.map(valueOf).concat(linkIns(n).map(valueOfAnchor)).slice(-BY[n.fn].n);
    if (n.flip) ins.reverse();                    // Flip (◆) swapped the order
    const a = ins[0] || ZERO, nums = ins.map(v => v.num), none = { num: 0, bool: false, text: "–" };
    const allNum = ins.every(v => v.isNum);   // a word, a button or a window is its name: + joins names into text
    let r;
    switch (n.fn) {
      case "add":
        if (!ins.length) r = none;
        else if (allNum) r = N(nums.reduce((x, y) => x + y, 0));
        else { const t = ins.map(strOf).filter(Boolean).join(" "); r = { num: t.length, bool: !!t, str: t, text: clip(t) }; }
        break;
      case "sub": r = !allNum ? none : ins.length ? N(nums.slice(1).reduce((x, y) => x - y, nums[0])) : none; break;
      case "mul": r = !allNum ? none : ins.length ? N(nums.reduce((x, y) => x * y, 1)) : none; break;
      case "div": r = !allNum ? none : ins.length ? N(nums.slice(1).some(y => !y) ? NaN : nums.slice(1).reduce((x, y) => x / y, nums[0])) : none; break;
      case "super": {
        n.prompt = ins.map(strOf).filter(Boolean).join(" ").trim();
        const t = n.answer || "";
        r = { num: t.length, bool: !!t, str: t, text: t || (n.st.go ? "thinking…" : n.prompt ? "press to ask" : "wire a prompt into it") };
        break;
      }
      case "panel": {
        // a Super Neural Engine wired in gives its question, and its engines' answer as context
        const srcs = n.inputs.map(ref => ref.node && nodes.find(x => x.id === ref.node)).filter(Boolean);
        const sup = srcs.find(x => x.fn === "super");
        const rest = ins.filter(v => !(sup && v === memo[sup.id]));   // everything else wired in joins the question
        n.prompt = ((sup ? sup.prompt || "" : "") + " " + rest.map(strOf).filter(Boolean).join(" ")).trim();
        n.context = sup && sup.answer ? sup.answer : "";
        n.supAnswer = sup ? sup.answer || "" : "";
        const t = n.answer || "";
        r = { num: t.length, bool: !!t, str: t, text: t || (n.st.go ? "the panel is thinking…" : n.prompt ? "press to ask the panel" : "wire the Super Neural Engine into it") };
        break;
      }
      case "clip": r = { num: (n.w || 0) * (n.h || 0), bool: !!n.img, str: (n.w || 0) + "×" + (n.h || 0), text: (n.w || 0) + "×" + (n.h || 0) }; break;
      case "play": r = { num: still() ? 0 : 1, bool: !still(), text: still() ? "stopped" : "running" }; break;
      case "stop": r = { num: still() ? 1 : 0, bool: still(), text: still() ? "stopped" : "running" }; break;
      case "show": r = ins.length ? { num: a.num, bool: a.bool, str: strOf(a), text: a.text != null && a.text !== "" ? a.text : clip(strOf(a)) } : { num: 0, bool: false, text: "" }; break;
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
        else if (n.fn === "super" || n.fn === "panel") n.val.textContent = n.st.go ? "thinking…" : n.answer ? "answered" : n.prompt ? "press to ask" : "wire a prompt";
        else n.val.textContent = r.text;
      }
      if (n.fn === "show") n.el.classList.toggle("is-long", r.text.length > 28 || /\n/.test(r.text));
      if (n.fn === "super" || n.fn === "panel") {
        const w = wiringOf(n) + (n.fn === "panel" ? "|" + (n.supAnswer || "") : "");   // the panel also follows the engine's answers
        if (n.wiring !== undefined && w !== n.wiring && n.prompt) { clearTimeout(n.st.timer); n.st.timer = setTimeout(() => (n.fn === "panel" ? askPanel(n) : askEngine(n)), n.fn === "panel" ? 1500 : 900); }
        n.wiring = w;
      }
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
      const nr = n.el.getBoundingClientRect(), arity = Math.max(1, n.inputs.length);
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
  function persist() { save("lv:nodes", nodes.map(n => ({ id: n.id, fn: n.fn, fx: n.fx, fy: n.fy, inputs: n.inputs, img: n.img, w: n.w, h: n.h, flip: n.flip || undefined, answer: (n.fn === "super" || n.fn === "panel") && n.answer ? n.answer.slice(0, 3000) : undefined }))); }
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
    const n = { id: spec.id, fn: f.k, fx: spec.fx, fy: spec.fy, inputs: (spec.inputs || []).slice(0, f.n), st: { i: 0, paused: false }, el, val, text: "", img: spec.img, w: spec.w, h: spec.h, flip: !!spec.flip };
    if (f.k === "panel") n.answer = spec.answer || "";
    el.classList.toggle("is-flipped", n.flip);
    if (f.k === "super") {
      g.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="lv-star" d=""/></svg>';
      n.st.sn = G(); n.st.t = 0; n.answer = spec.answer || "";
      if (n.answer) { n.st.t = 1; n.st.sn = P(); }
      requestAnimationFrame(() => drawSuper(n));
    }
    if (f.k === "clip") {
      if (!n.img) return null;
      const im = document.createElement("img"); im.src = n.img; im.alt = "Clip, " + n.w + " by " + n.h + " pixels"; im.draggable = false;
      g.replaceWith(im);
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
    if (window.SuperLink && window.SuperLink.forget) window.SuperLink.forget("node:" + n.id);
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
    // a number anywhere on the page (not inside the node being dragged, nor the palette)
    const SL = window.SuperLink;
    let u = null;
    if (SL && SL.unitAt) {                          // look past the node being dragged
      const v = self ? self.style.visibility : ""; if (self) self.style.visibility = "hidden";
      try { u = SL.unitAt(x, y); } finally { if (self) self.style.visibility = v; }
    }
    const pe = u && u.node.parentElement;
    if (u && /\d/.test(u.anchor.t) && !Number.isNaN(numOf(u.anchor.t)) && !(self && pe && self.contains(pe)) && !(pe && pe.closest(".lv-palette"))) {
      const r = document.createRange(); r.setStart(u.node, u.a); r.setEnd(u.node, u.b);
      return { text: u.anchor, rect: r.getBoundingClientRect() };
    }
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
      if (BY[n.fn].act) {
        const hit = document.elementsFromPoint(ev.clientX, ev.clientY).map(e => e.closest(".lv-node")).find(e => e && e !== n.el);
        const tn = ev.type === "pointerup" && hit && nodes.find(x => x.el === hit);
        remove(n);
        if (tn) { tn.flip = !tn.flip; tn.el.classList.toggle("is-flipped", tn.flip); persist(); tick(); say(BY[tn.fn].name + ": inputs " + (tn.flip ? "flipped" : "back in order") + " → " + (tn.text || "")); }
        else say("Flip: drop it on a node to swap its inputs");
        return;
      }
      if (t && t.text && BY[n.fn].n && window.SuperLink && window.SuperLink.add) {
        if (n.fn === "show") { window.SuperLink.forget("node:" + n.id, true); n.inputs = []; }   // Show shows one thing: the newest
        window.SuperLink.add(t.text, { h: "node:" + n.id, el: 1 });
        const w = n.el.offsetWidth, h = n.el.offsetHeight;
        let x = t.rect.right + 28; if (x + w > window.innerWidth - 4) x = t.rect.left - w - 28;
        n.fx = Math.max(4, x) / window.innerWidth; n.fy = (t.rect.top + t.rect.height / 2 - h / 2) / window.innerHeight; place(n);
        say(BY[n.fn].name + " wired to “" + t.text.t + "”"); persist(); tick(); return;
      }
      if (t && t.el && BY[n.fn].n) {                // Play and Stop take no input: they are just placed
        const ref = refOf(t.el);
        if (n.fn === "show" && window.SuperLink && window.SuperLink.forget) window.SuperLink.forget("node:" + n.id, true);
        if (attach(n, ref)) { beside(n, t.el, ev.clientX, ev.clientY); say(BY[n.fn].name + " wired to " + nameOf(ref)); }
      } else if (spawn) say(BY[n.fn].name + (BY[n.fn].n ? " placed: drop it on a number or a button to wire it" : " placed"));
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
      if (n.fn === "clip") { const a = document.createElement("a"); a.href = n.img; a.download = "clip-" + n.w + "x" + n.h + ".png"; document.body.appendChild(a); a.click(); a.remove(); say("Clip saved as a PNG"); }
      else if (n.fn === "cut") cut();
      else if (n.fn === "super") askEngine(n, true);
      else if (n.fn === "panel") askPanel(n, true);
      else if (n.fn === "play" || n.fn === "stop") { run(n.fn === "play"); say(n.fn === "play" ? "Play: π running" : "Stop: π stopped"); }
      else say(BY[n.fn].name + ": " + (n.text || "no inputs yet"));
      tick();
    });
    n.el.addEventListener("dblclick", () => { n.inputs = []; n.st.i = 0; if (window.SuperLink && window.SuperLink.forget) window.SuperLink.forget("node:" + n.id); persist(); tick(); say(BY[n.fn].name + " unwired"); });
    n.el.addEventListener("keydown", e => {
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(n); say(BY[n.fn].name + " node removed"); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); n.el.click(); }
    });
  }
  function say(t) { if (out) out.textContent = t; }
  // Play and Stop: π, and everything that follows it, runs or stands still
  function run(on) { if (O().setStill) O().setStill(!on); }
  // ---- Super: a star that grows into a superellipse ---------------------
  const G = () => (window.SeMorph && window.SeMorph.gamma) || 0.5772156649;
  const P = () => (window.SeMorph && window.SeMorph.pi) || Math.PI;
  function superPath(nn, r) {
    const e = 2 / nn, pts = [];
    for (let i = 0; i < 72; i++) {
      const t = i / 72 * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      pts.push((50 + r * Math.sign(c) * Math.pow(Math.abs(c), e)).toFixed(2) + "," + (50 + r * Math.sign(s) * Math.pow(Math.abs(s), e)).toFixed(2));
    }
    return "M" + pts.join("L") + "Z";
  }
  function drawSuper(n) {
    const path = n.el.querySelector(".lv-star");
    if (!path) return;
    const g = G(), k = Math.max(0, Math.min(1, ((n.st.sn || g) - g) / (P() - g)));
    path.setAttribute("d", superPath(n.st.sn || g, 46));
    path.style.fillOpacity = (1 - k).toFixed(3);           // the grey star fades as it widens
    path.style.strokeOpacity = (0.3 + 0.7 * k).toFixed(3);   // and its outline firms up
    n.el.classList.toggle("is-grown", k >= 1);
  }
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  // the star grows while the engines think: toward 90% of the way to π, then all the way once answered
  function grow(n) {
    if (n.st.anim) return;
    n.st.anim = true;
    let last = performance.now();
    const step = now => {
      if (!n.el.isConnected) { n.st.anim = false; return; }
      const dt = now - last; last = now;
      const goal = n.st.go ? 0.9 : (n.answer ? 1 : 0);
      n.st.t += (goal - n.st.t) * Math.min(1, dt / (n.st.go ? 1800 : 260));
      if (Math.abs(goal - n.st.t) < 0.002) n.st.t = goal;
      const g = G(); n.st.sn = g + (P() - g) * ease(Math.max(0, Math.min(1, n.st.t)));
      drawSuper(n);
      if (n.st.go || n.st.t !== goal) requestAnimationFrame(step); else n.st.anim = false;
    };
    requestAnimationFrame(step);
  }
  async function askEngine(n, pressed) {
    const prompt = n.prompt || "";
    if (!prompt) { if (pressed) say("Super Neural Engine: wire something into it first"); return; }
    if (n.st.go) return;
    // what the wiring means: if its words name a window, open it, then ask the engines too
    const meant = window.SuperLink && window.SuperLink.intent ? window.SuperLink.intent([prompt]) : null;
    const opened = meant && O().openTitle && O().openTitle(meant) ? "Opened " + meant + ".\n" : "";
    n.st.go = true; n.st.asked = prompt; n.el.classList.add("is-thinking"); grow(n); tick();
    say("Super Neural Engine: asking every engine about “" + clip(prompt) + "”");
    try {
      const res = await fetch("/api/super/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt.slice(0, 4000) }) });
      const data = await res.json().catch(() => ({}));
      n.answer = opened + (res.ok ? (data.answer || "No engine had an answer for that.") : "Super Neural Engine: " + (data.detail || "unavailable right now"));
      if (res.ok) say("Super Neural Engine: " + (data.parts || []).map(x => x.engine).join(", ") + " answered");
    } catch (_) {
      n.answer = opened + "Super Neural Engine: could not reach the engines";
    }
    n.st.go = false; n.el.classList.remove("is-thinking"); grow(n);
    persist(); tick();
  }
  async function askPanel(n, pressed) {
    const prompt = n.prompt || "";
    if (!prompt) { if (pressed) say("Ask the panel: wire the Super Neural Engine (or some text) into it first"); return; }
    if (n.st.go) return;
    n.st.go = true; n.el.classList.add("is-thinking"); tick();
    say("Ask the panel: every juror is answering “" + clip(prompt) + "”");
    try {
      const res = await fetch("/api/super/panel", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.slice(0, 4000), context: (n.context || "").slice(0, 4000) }) });
      const data = await res.json().catch(() => ({}));
      n.answer = res.ok ? (data.answer || "The panel had no answer.") : "Ask the panel: " + (data.detail || "unavailable right now");
      if (res.ok) say("Ask the panel: " + (data.answered || 0) + " of " + (data.asked || 0) + " answered" + (data.judge && data.judge.agreement ? ", agreement " + data.judge.agreement : ""));
    } catch (_) { n.answer = "Ask the panel: could not reach the panel"; }
    n.st.go = false; n.el.classList.remove("is-thinking");
    persist(); tick();
  }
  // asks by itself when what is wired into it changes (not when a wired value merely ticks, like π)
  function wiringOf(n) { return JSON.stringify([n.inputs, linkIns(n), !!n.flip]); }

  // ---- Scissors: pixels from the screen --------------------------------
  // One frame of the shared screen, window or tab; drag a box over it; the box becomes a Clip.
  let cutting = false;
  async function cut() {
    if (cutting) return;
    const md = navigator.mediaDevices;
    if (!md || !md.getDisplayMedia) { say("Scissors: this browser can't capture the screen (try a desktop browser)"); return; }
    cutting = true;
    let stream;
    try {
      stream = await md.getDisplayMedia({ video: { cursor: "never" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" });
    } catch (_) { cutting = false; say("Scissors: nothing shared"); return; }
    let frame;
    try {
      const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.srcObject = stream;
      await v.play();
      await new Promise(r => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => r()) : setTimeout(r, 200)));
      frame = document.createElement("canvas"); frame.width = v.videoWidth; frame.height = v.videoHeight;
      frame.getContext("2d").drawImage(v, 0, 0);
    } finally { stream.getTracks().forEach(t => t.stop()); }
    if (!frame || !frame.width) { cutting = false; say("Scissors: no picture came through"); return; }
    select(frame);
  }
  function select(frame) {
    const ov = document.createElement("div"); ov.className = "lv-cutter";
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Drag a box over the pixels to cut out; Esc to cancel");
    const shot = frame; shot.className = "lv-cutter-shot"; ov.appendChild(shot);
    const box = document.createElement("div"); box.className = "lv-cutter-box"; ov.appendChild(box);
    const hint = document.createElement("div"); hint.className = "lv-cutter-hint"; hint.textContent = "Drag a box over what you want · Esc to cancel"; ov.appendChild(hint);
    document.body.appendChild(ov);
    const done = () => { ov.remove(); document.removeEventListener("keydown", key, true); cutting = false; };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); done(); say("Scissors: cancelled"); } };
    document.addEventListener("keydown", key, true);
    let p0 = null;
    const rect = (a, b) => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });
    ov.addEventListener("pointerdown", e => { p0 = [e.clientX, e.clientY]; try { ov.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } e.preventDefault(); });
    ov.addEventListener("pointermove", e => {
      if (!p0) return;
      const r = rect(p0, [e.clientX, e.clientY]);
      Object.assign(box.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px", display: "block" });
    });
    ov.addEventListener("pointerup", e => {
      if (!p0) return;
      const r = rect(p0, [e.clientX, e.clientY]); p0 = null;
      if (r.w < 4 || r.h < 4) { box.style.display = "none"; return; }
      // from the picture on screen back to the frame's own pixels
      const sr = shot.getBoundingClientRect(), k = frame.width / sr.width;
      const sx = Math.max(0, Math.round((r.x - sr.left) * k)), sy = Math.max(0, Math.round((r.y - sr.top) * k));
      const w = Math.min(frame.width - sx, Math.round(r.w * k)), h = Math.min(frame.height - sy, Math.round(r.h * k));
      done();
      if (w < 1 || h < 1) { say("Scissors: that box was outside the picture"); return; }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(frame, sx, sy, w, h, 0, 0, w, h);
      const img = c.toDataURL("image/png");
      const n = make({ id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), fn: "clip", fx: 0, fy: 0, inputs: [], img, w, h });
      if (!n) return;
      n.fx = Math.max(4, Math.min(window.innerWidth - n.el.offsetWidth - 4, r.x)) / window.innerWidth;
      n.fy = Math.max(4, Math.min(window.innerHeight - n.el.offsetHeight - 22, r.y)) / window.innerHeight;
      place(n);
      persist(); tick();
      say("Clip " + w + "×" + h + " px: click it to save, drag it onto the palette to remove it");
      if (navigator.clipboard && window.ClipboardItem) c.toBlob(b => { if (b) navigator.clipboard.write([new ClipboardItem({ "image/png": b })]).catch(() => { /* not allowed: fine */ }); });
    });
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
      '<div class="lv-grid" role="group" aria-label="Functions"></div><output class="lv-out" aria-live="polite">Drag a node onto any number or button to wire it, or press it to run it on π</output>';
    const grid = pal.querySelector(".lv-grid"), head = pal.querySelector(".lv-head");
    out = pal.querySelector(".lv-out");
    const setOpen = v => {
      open = v; pal.classList.toggle("is-open", v); head.setAttribute("aria-expanded", String(v));
      setTimeout(() => { if (window.PiOrbit && window.PiOrbit.layout) window.PiOrbit.layout(); }, 300);   // the pills make room for it
    };
    fold = () => setOpen(false);
    head.addEventListener("click", () => { chosen = true; setOpen(!open); try { localStorage.setItem("lv:open", open ? "1" : "0"); } catch (_) { /* fine */ } });
    pal.classList.toggle("is-open", open); head.setAttribute("aria-expanded", String(open));

    FNS.filter(f => !f.hidden).forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lv-fn lv-" + f.k;
      b.title = f.press ? f.name + ": press to capture pixels from the screen" : f.name + ": press to run on π, drag onto a button to wire it";
      b.setAttribute("aria-label", f.name);
      glyph(b, f);
      if (!f.press) b.addEventListener("pointerdown", e => drag(e, b, f));
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
