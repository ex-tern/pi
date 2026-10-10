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
// shows that value inside itself. Run (▶) runs what is wired into it: engines
// and "?" ask again, a Show refreshes, a button opens its window, the π mark
// starts π; unwired, it starts
// π. Stop stops it (the same as
// double-clicking the π mark); everything wired to π follows. Stop also holds
// whatever is wired into it, for as long as the wire is there: a Super Neural
// Engine or "?" stops thinking (a question on its way is cancelled), a Show
// freezes, and the π mark, counter or loop stops π. Unwire it to let go.
// The Super Neural Engine is a solid diamond (a superellipse at n = 1.3). It is
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
// changes, or when you press it; while it thinks the diamond grows toward a
// full superellipse (n climbing from 1.3 to π), fully grown once answered.
// Trash deletes: drop a node on it, drop it on a node, or press it twice to
// clear the whole diagram.
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
    { k: "play", svg: sq + '<path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none"/></svg>', name: "Run", n: 9 },   // was Play; the key stays "play" so saved diagrams keep it
    { k: "stop", svg: sq + '<rect x="5" y="5" width="10" height="10" rx="1" fill="currentColor" stroke="none"/></svg>', name: "Stop", n: 9 },
    { k: "show", g: "", name: "Show", n: 1 },
    { k: "super", svg: sq + '<path class="lv-star" d="M16.80 10.00L16.75 10.19L16.60 10.55L16.35 11.01L16.02 11.55L15.60 12.14L15.12 12.75L14.58 13.38L13.99 13.99L13.38 14.58L12.75 15.12L12.14 15.60L11.55 16.02L11.01 16.35L10.55 16.60L10.19 16.75L10.00 16.80L9.81 16.75L9.45 16.60L8.99 16.35L8.45 16.02L7.86 15.60L7.25 15.12L6.62 14.58L6.01 13.99L5.42 13.38L4.88 12.75L4.40 12.14L3.98 11.55L3.65 11.01L3.40 10.55L3.25 10.19L3.20 10.00L3.25 9.81L3.40 9.45L3.65 8.99L3.98 8.45L4.40 7.86L4.88 7.25L5.42 6.62L6.01 6.01L6.62 5.42L7.25 4.88L7.86 4.40L8.45 3.98L8.99 3.65L9.45 3.40L9.81 3.25L10.00 3.20L10.19 3.25L10.55 3.40L11.01 3.65L11.55 3.98L12.14 4.40L12.75 4.88L13.38 5.42L13.99 6.01L14.58 6.62L15.12 7.25L15.60 7.86L16.02 8.45L16.35 8.99L16.60 9.45L16.75 9.81Z"/></svg>', name: "Super Neural Engine", n: 9 },   // a superellipse diamond, n = 1.3, that grows to n = π while it thinks
    { k: "panel", g: "?", name: "Ask the panel", n: 9 },
    { k: "trash", svg: sq + '<path d="M4 5.5h12M8 5.5V4h4v1.5M5.5 5.5l.8 11h7.4l.8-11M8.5 8.5v5.5M11.5 8.5v5.5"/></svg>', name: "Trash", n: 0, act: true },
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
      case "play": run(true); return "π running; drag it onto engines, a Show or π to run them";
      case "stop": run(false); return "π stopped";
      case "show": return "drag it out and drop it on anything to show its value";
      case "super": return "drag it out and wire words, numbers, buttons or nodes into it: every engine answers, and a Show wired to it shows the answer";
      case "panel": return "drag it out and wire the Super Neural Engine (or any text) into it: the panel of AIs that judges manuscripts answers, and the judge weighs them";
      case "trash": return trashPress();
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
      // each says what it does or has done, not just π's state: lit when it is the one in effect
      case "play": { const k = n.inputs.length + linkIns(n).length; r = { num: k, bool: k ? !!n.ran : !still(), text: k ? (n.ran ? "ran " + n.ran + "×" : "press to run") : still() ? "press to run" : "π running" }; break; }
      case "stop": { const k = (n.holds || 0); r = { num: k, bool: k > 0 || still(), text: k ? "holding " + k : still() ? "π stopped" : "press to stop" }; break; }
      case "show": r = ins.length ? { num: a.num, bool: a.bool, str: strOf(a), text: a.text != null && a.text !== "" ? a.text : clip(strOf(a)) } : { num: 0, bool: false, text: "" }; break;
      default: r = ZERO;
    }
    visiting[n.id] = false;
    memo[n.id] = r;
    return r;
  }

  // Run runs whatever is wired into it: engines and "?" ask again, a Show refreshes,
  // the π mark, counter or loop starts π. Unwired, it starts π. What Stop holds stays held.
  function runWired(n) {
    const refs = n.inputs.map(ref => ref.node ? { node: ref.node } : ref)
      .concat(linkIns(n).map(an => an.loop || an.h === "pi" ? { pi: 1 } : an.h && an.h.startsWith("node:") ? { node: an.h.slice(5) } : null).filter(Boolean));
    if (!refs.length) { run(true); say("Run: π running"); return; }
    let ran = 0, held = 0;
    refs.forEach(ref => {
      if (ref.core || ref.pi) { run(true); ran++; return; }
      if (ref.key) { const i = O().info && O().info(ref.key); if (i && O().openTitle && O().openTitle(i.title)) ran++; return; }   // a button or window: open it
      const x = ref.node && nodes.find(y => y.id === ref.node);
      if (!x) return;
      if (x.held) { held++; return; }
      if (x.fn === "super") { askEngine(x, true); ran++; }
      else if (x.fn === "panel") { askPanel(x, true); ran++; }
      else if (x.fn === "show") { x.text = null; ran++; }
      else if (x.fn === "play" && x !== n) { runWired(x); ran++; }
      else ran++;                                                           // arithmetic simply recomputes
    });
    n.ran = (n.ran || 0) + 1;
    n.el.classList.remove("fired"); void n.el.offsetWidth; n.el.classList.add("fired");
    tick();
    say("Run: ran " + ran + (held ? ", " + held + " held by Stop" : ""));
  }

  // Stop holds whatever is wired into it, for as long as the wire is there
  let piHeld = false;
  function holds() {
    const held = new Set(); let pi = false;
    nodes.filter(x => x.fn === "stop").forEach(st => {
      let k = 0;
      st.inputs.forEach(ref => { if (ref.node) { held.add(ref.node); k++; } else if (ref.core || ref.pi) { pi = true; k++; } });
      linkIns(st).forEach(an => {
        if (an.loop || an.h === "pi") { pi = true; k++; }
        else if (an.h && an.h.startsWith("node:")) { held.add(an.h.slice(5)); k++; }
      });
      st.holds = k;
    });
    if (pi && !piHeld) { piHeld = true; if (!still()) run(false); }        // the π mark, counter or loop wired in: π stops
    else if (!pi && piHeld) { piHeld = false; run(true); }                // unwired: it goes on
    nodes.forEach(n => {
      const was = n.held; n.held = held.has(n.id);
      n.el.classList.toggle("is-held", n.held);
      if (n.held && !was && n.st.ctrl) n.st.ctrl.abort();                // a question on its way is cancelled
      if (n.held && n.st.timer) { clearTimeout(n.st.timer); n.st.timer = 0; }
      if (!n.held && was && n.fn === "show") n.text = null;             // released: show the current value again
    });
  }

  function tick() {
    memo = {}; visiting = {};
    holds();
    const now = performance.now();
    nodes.forEach(n => {
      const r = evalNode(n);
      if (n.held && n.fn === "show") return;                             // held by Stop: frozen as it is
      if (n.text !== r.text) {
        n.text = r.text; n.changed = now;
        if (n.fn === "show") n.el.querySelector(".lv-glyph").textContent = r.text;   // Show holds its value inside
        else if (n.fn !== "super" && n.fn !== "panel") n.val.textContent = r.text;
      }
      if (n.fn === "super" || n.fn === "panel") {                         // its status, always current
        const st = n.held ? "stopped" : n.st.go ? "thinking…" : n.answer ? "answered" : n.prompt ? "press to ask" : "wire a prompt";
        if (n.val.textContent !== st) n.val.textContent = st;
      }
      if (n.fn === "show") n.el.classList.toggle("is-long", r.text.length > 28 || /\n/.test(r.text));
      if (n.fn === "super" || n.fn === "panel") {
        const w = wiringOf(n) + (n.fn === "panel" ? "|" + (n.supAnswer || "") : "");   // the panel also follows the engine's answers
        if (n.wiring !== undefined && w !== n.wiring && n.prompt && !n.held) { clearTimeout(n.st.timer); n.st.timer = setTimeout(() => (n.fn === "panel" ? askPanel(n) : askEngine(n)), n.fn === "panel" ? 1500 : 900); }
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
  function persist() { save("lv:nodes", nodes.map(n => ({ id: n.id, fn: n.fn, fx: n.fx, fy: n.fy, inputs: n.inputs, img: n.img, w: n.w, h: n.h, answer: (n.fn === "super" || n.fn === "panel") && n.answer ? n.answer.slice(0, 3000) : undefined }))); }
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
    const n = { id: spec.id, fn: f.k, fx: spec.fx, fy: spec.fy, inputs: (spec.inputs || []).slice(0, f.n), st: { i: 0, paused: false }, el, val, text: "", img: spec.img, w: spec.w, h: spec.h };
    if (f.k === "panel") n.answer = spec.answer || "";
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
    clear(n);
  }
  // step down until it overlaps no other node (two nodes wired to the same thing would sit on each other)
  function clear(n) {
    for (let k = 0; k < 8; k++) {
      const a = n.el.getBoundingClientRect();
      const hit = nodes.find(o => o !== n && (() => { const b = o.el.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; })());
      if (!hit) return;
      const b = hit.el.getBoundingClientRect();
      n.fy = Math.min(window.innerHeight - a.height - 22, b.bottom + 18) / window.innerHeight; place(n);
      if (b.bottom + 18 + a.height > window.innerHeight - 22) return;
    }
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
      const tb = pal.querySelector(".lv-grid .lv-trash");                  // the trash lights up under a node about to go
      if (tb) { const r = tb.getBoundingClientRect(); tb.classList.toggle("is-over", !spawn && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom); }
      drawWires();
      ev.preventDefault();
    };
    const up = ev => {
      startEl.removeEventListener("pointermove", move);
      startEl.removeEventListener("pointerup", up);
      startEl.removeEventListener("pointercancel", up);
      document.querySelectorAll(".lv-hover").forEach(x => x.classList.remove("lv-hover"));
      pal.classList.remove("lv-bin");
      const tb0 = pal.querySelector(".lv-grid .lv-trash"); if (tb0) tb0.classList.remove("is-over");
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
        if (n.fn === "trash") {
          if (tn) { remove(tn); say(BY[tn.fn].name + " node deleted"); } else say("Trash: drop it on a node to delete it, or drop a node on it");
          return;
        }
        return;
      }
      if (t && t.text && BY[n.fn].n && window.SuperLink && window.SuperLink.add) {
        if (n.fn === "show") { window.SuperLink.forget("node:" + n.id, true); n.inputs = []; }   // Show shows one thing: the newest
        window.SuperLink.add(t.text, { h: "node:" + n.id, el: 1 });
        const w = n.el.offsetWidth, h = n.el.offsetHeight;
        let x = t.rect.right + 28; if (x + w > window.innerWidth - 4) x = t.rect.left - w - 28;
        n.fx = Math.max(4, x) / window.innerWidth; n.fy = (t.rect.top + t.rect.height / 2 - h / 2) / window.innerHeight; place(n); clear(n);
        say(BY[n.fn].name + " wired to “" + t.text.t + "”"); persist(); tick(); return;
      }
      if (t && t.el && BY[n.fn].n) {                // Play and Stop take no input: they are just placed
        const ref = refOf(t.el);
        if (n.fn === "show" && window.SuperLink && window.SuperLink.forget) window.SuperLink.forget("node:" + n.id, true);
        if (attach(n, ref) && n.fn === "play") setTimeout(() => runWired(n), 0);   // dropped on something: run it now
        if (n.inputs.some(r => same(r, ref))) { beside(n, t.el, ev.clientX, ev.clientY); say(BY[n.fn].name + " wired to " + nameOf(ref)); }
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
      else if (n.fn === "stop" && n.holds) say("Stop: holding " + n.holds + " (unwire it to let them go)");
      else if (n.fn === "play") runWired(n);
      else if (n.fn === "stop") { run(false); say("Stop: π stopped"); }
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
  const G = () => 1.3;   // the Super Neural Engine starts as a superellipse diamond, n = 1.3
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
    path.style.fillOpacity = (1 - k).toFixed(3);           // the solid diamond fades as it widens
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
    if (n.held) { say("Super Neural Engine: stopped (it is wired to Stop)"); return; }
    // what the wiring means: if its words name a window, open it, then ask the engines too
    const meant = window.SuperLink && window.SuperLink.intent ? window.SuperLink.intent([prompt]) : null;
    const opened = meant && O().openTitle && O().openTitle(meant) ? "Opened " + meant + ".\n" : "";
    n.st.go = true; n.st.asked = prompt; n.el.classList.add("is-thinking"); grow(n); tick();
    say("Super Neural Engine: asking every engine about “" + clip(prompt) + "”");
    try {
      n.st.ctrl = new AbortController();
      const res = await fetch("/api/super/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt.slice(0, 4000) }), signal: n.st.ctrl.signal });
      const data = await res.json().catch(() => ({}));
      n.answer = opened + (res.ok ? (data.answer || "No engine had an answer for that.") : "Super Neural Engine: " + (data.detail || "unavailable right now"));
      if (res.ok) say("Super Neural Engine: " + (data.parts || []).map(x => x.engine).join(", ") + " answered");
    } catch (e) {
      if (e && e.name === "AbortError") say("Super Neural Engine: stopped");
      else n.answer = opened + "Super Neural Engine: could not reach the engines";
    }
    n.st.ctrl = null;
    n.st.go = false; n.el.classList.remove("is-thinking"); grow(n);
    persist(); tick();
  }
  async function askPanel(n, pressed) {
    const prompt = n.prompt || "";
    if (!prompt) { if (pressed) say("Ask the panel: wire the Super Neural Engine (or some text) into it first"); return; }
    if (n.st.go) return;
    if (n.held) { say("Ask the panel: stopped (it is wired to Stop)"); return; }
    n.st.go = true; n.el.classList.add("is-thinking"); tick();
    say("Ask the panel: every juror is answering “" + clip(prompt) + "”");
    try {
      n.st.ctrl = new AbortController();
      const res = await fetch("/api/super/panel", { method: "POST", headers: { "Content-Type": "application/json" }, signal: n.st.ctrl.signal,
        body: JSON.stringify({ prompt: prompt.slice(0, 4000), context: (n.context || "").slice(0, 4000) }) });
      const data = await res.json().catch(() => ({}));
      n.answer = res.ok ? (data.answer || "The panel had no answer.") : "Ask the panel: " + (data.detail || "unavailable right now");
      if (res.ok) say("Ask the panel: " + (data.answered || 0) + " of " + (data.asked || 0) + " answered" + (data.judge && data.judge.agreement ? ", agreement " + data.judge.agreement : ""));
    } catch (e) {
      if (e && e.name === "AbortError") say("Ask the panel: stopped");
      else n.answer = "Ask the panel: could not reach the panel";
    }
    n.st.ctrl = null;
    n.st.go = false; n.el.classList.remove("is-thinking");
    persist(); tick();
  }
  // asks by itself when what is wired into it changes (not when a wired value merely ticks, like π)
  function wiringOf(n) { return JSON.stringify([n.inputs, linkIns(n)]); }

  // ---- Trash: press twice to clear the diagram --------------------------
  let trashArmed = 0;
  function trashPress() {
    if (!nodes.length) return "nothing to delete; drag a node onto the trash to delete it";
    const tb = pal && pal.querySelector(".lv-grid .lv-trash");
    if (Date.now() - trashArmed > 3000) {
      trashArmed = Date.now(); if (tb) tb.classList.add("is-armed");
      setTimeout(() => { if (Date.now() - trashArmed >= 3000 && tb) tb.classList.remove("is-armed"); }, 3050);
      return "press again within 3 s to delete " + (nodes.length === 1 ? "the 1 node" : "all " + nodes.length + " nodes");
    }
    trashArmed = 0; if (tb) tb.classList.remove("is-armed");
    const k = nodes.length;
    nodes.slice().forEach(remove);
    return "deleted " + k + " node" + (k === 1 ? "" : "s");
  }

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
      b.title = f.k === "trash" ? "Trash: drag it onto a node, or a node onto it, to delete; press twice to clear the diagram"
        : f.press ? f.name + ": press to capture pixels from the screen" : f.name + ": press to run on π, drag onto a button to wire it";
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
