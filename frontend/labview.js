// labview.js — a Functions palette and block diagram, like LabVIEW's.
//
// Press a palette button to run it once on the two newest digits of π. Drag
// one out and it becomes a node; drop it on something and that thing becomes
// one of its inputs, and the node computes live. Inputs can be:
//
//   a number anywhere on the page   its value ("1,549" reads as 1549)
//   a pill, bubble or window        its name (and how often it was opened)
//   the π mark (main loop)          the newest digit of π (drop on the loop's edge)
//   the π counter                   decimals computed so far
//   another node                    its output
//   a wire dragged from any word or number (superlink.js) ending on the node
//
// The nodes:
//   + ×       over all inputs; + joins words ("Connect" + "Contact us"); + alone
//             on a button says yes (opens it), on a window brings it up
//   −         does what its inputs suggest: numbers above and below divide
//             (top ÷ bottom), side by side subtract, one number negates, words
//             take the later out of the first, a word and a number trims letters;
//             − alone on an open window puts it down (folds it away)
//   Run ▶     runs what is wired in: engines and "?" ask again, Show refreshes,
//             a button opens its window, the π mark starts π; unwired, starts π
//   Stop ■    stops π; holds what is wired in while the wire is there: engines
//             stop thinking (the request is aborted), Show freezes, π stops
//   Show      an empty box that shows the value wired into it
//   Super Neural Engine ◆   a superellipse diamond (n = 1.3); what is wired in
//             becomes its prompt, every engine answers (/api/super/ask: siM,
//             riB, piD, PiEn); opens a window its words name; grows toward
//             n = π while it thinks; asks again when its wiring changes
//   ?         asks the panel of AI jurors that judges manuscripts, with a wired
//             engine's question and answer, and the judge weighs them
//             (/api/super/panel); follows the engine's new answers
//
// Stop guesses what you mean from where you drop it: on a wire it removes the
// wire, on an open window it closes it, on something working (a thinking
// engine, a live Show, π) it stops it, on anything else it deletes it.
// Click a wire to disconnect it, double-click a node to unwire it, drop a node
// on the palette to delete it. The diagram
// is remembered in this browser (localStorage "lv:nodes").
(function () {
  "use strict";
  const sq = '<svg viewBox="0 0 20 20" aria-hidden="true">';
  const FNS = [
    { k: "add", g: "+", name: "Add", n: 9 },
    { k: "sub", g: "−", name: "Subtract", n: 9 },
    { k: "mul", g: "×", name: "Multiply", n: 9 },
    { k: "play", svg: sq + '<path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none"/></svg>', name: "Run", n: 9 },   // was Play; the key stays "play" so saved diagrams keep it
    { k: "stop", svg: sq + '<rect x="5" y="5" width="10" height="10" rx="1" fill="currentColor" stroke="none"/></svg>', name: "Stop", n: 9 },
    { k: "show", g: "", name: "Show", n: 1 },
    { k: "super", svg: sq + '<path class="lv-star" d="M16.80 10.00L16.75 10.19L16.60 10.55L16.35 11.01L16.02 11.55L15.60 12.14L15.12 12.75L14.58 13.38L13.99 13.99L13.38 14.58L12.75 15.12L12.14 15.60L11.55 16.02L11.01 16.35L10.55 16.60L10.19 16.75L10.00 16.80L9.81 16.75L9.45 16.60L8.99 16.35L8.45 16.02L7.86 15.60L7.25 15.12L6.62 14.58L6.01 13.99L5.42 13.38L4.88 12.75L4.40 12.14L3.98 11.55L3.65 11.01L3.40 10.55L3.25 10.19L3.20 10.00L3.25 9.81L3.40 9.45L3.65 8.99L3.98 8.45L4.40 7.86L4.88 7.25L5.42 6.62L6.01 6.01L6.62 5.42L7.25 4.88L7.86 4.40L8.45 3.98L8.99 3.65L9.45 3.40L9.81 3.25L10.00 3.20L10.19 3.25L10.55 3.40L11.01 3.65L11.55 3.98L12.14 4.40L12.75 4.88L13.38 5.42L13.99 6.01L14.58 6.62L15.12 7.25L15.60 7.86L16.02 8.45L16.35 8.99L16.60 9.45L16.75 9.81Z"/></svg>', name: "Super Neural Engine", n: 9 },   // a superellipse diamond, n = 1.3, that grows to n = π while it thinks
    { k: "panel", g: "?", name: "Ask the panel", n: 9 },
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
  function quick(f) {
    const d = piStr() || "31", a = +d[d.length - 2] || 3, b = +d[d.length - 1] || 1;
    switch (f.k) {
      case "add": return a + " + " + b + " = " + (a + b);
      case "sub": return a + " − " + b + " = " + (a - b) + "; it guesses from its inputs: above and below divides, words take words out";
      case "mul": return a + " × " + b + " = " + a * b;
      case "play": run(true); return "π running; drag it onto engines, a Show or π to run them";
      case "stop": run(false); return "π stopped";
      case "show": return "drag it out and drop it on anything to show its value";
      case "super": return "drag it out and wire words, numbers, buttons or nodes into it: every engine answers, and a Show wired to it shows the answer";
      case "panel": return "drag it out and wire the Super Neural Engine (or any text) into it: the panel of AIs that judges manuscripts answers, and the judge weighs them";
      default: return "drag it onto a button to give it an input";
    }
  }

  // ---- the diagram -----------------------------------------------------
  let nodes = [];           // { id, fn, fx, fy, inputs: [ref], st: {go, t, sn, timer, ctrl}, text, changed, el }
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
  // a number or word on the page, as a wire from it (superlink.js) remembers it
  const numOf = t => { const v = parseFloat(String(t).replace(/[,\s'’](?=\d{3}\b)/g, "").replace(",", ".")); return Number.isNaN(v) ? NaN : v; };
  function valueOfAnchor(an) {
    if (an.loop) return valueOf({ core: 1 });
    if (an.h && an.h.startsWith("node:")) return valueOf({ node: an.h.slice(5) });
    if (!an.el) { const v = numOf(an.t); return { num: Number.isNaN(v) ? 0 : v, isNum: !Number.isNaN(v), bool: !!an.t, str: an.t, text: an.t }; }
    if (an.h === "pi") return valueOf({ pi: 1 });
    if (an.h && an.h.startsWith("k:")) return valueOf({ key: an.h.slice(2) });
    const t = an.h ? an.h.replace(/^[a-z#]+:?/, "") : ""; return { num: 0, bool: !!t, str: t };
  }
  // the inputs above and below a node, by where their sources sit on the page: {top, bottom} numbers, or null
  function fraction(n) {
    const nr = n.el.getBoundingClientRect(), SL = window.SuperLink;
    const rectOfRef = ref => { const e = elOf(ref); return e && e.getClientRects().length ? e.getBoundingClientRect() : null; };
    const srcs = n.inputs.map(ref => ({ v: valueOf(ref), r: rectOfRef(ref) }))
      .concat(linkIns(n).map(an => ({ v: valueOfAnchor(an), r: an.h && an.h.startsWith("node:") ? rectOfRef({ node: an.h.slice(5) }) : SL && SL.rectOf ? SL.rectOf(an) : null })));
    const top = [], bottom = [];
    srcs.forEach(({ v, r }) => {
      if (!r || !v.isNum) return;
      const cy = r.top + r.height / 2;
      if (cy < nr.top) top.push(v.num); else if (cy > nr.bottom) bottom.push(v.num);
    });
    return top.length && bottom.length ? { top, bottom } : null;
  }
  // wires (superlink.js) that end on this node (and don't come from it), oldest first
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
      case "sub": {
        // − guesses from its inputs:
        //   numbers above and below it, like a fraction   divide, top ÷ bottom
        //   numbers side by side                          subtract, the first minus the rest
        //   one number                                    negate it
        //   words (or buttons, windows: their names)      take the later ones out of the first
        //   a word and a number                           trim that many letters off its end
        const fr = fraction(n);
        n.mode = fr ? "div" : "sub";
        if (!ins.length) r = none;
        else if (fr) { const top = fr.top.reduce((x, y) => x + y, 0), bot = fr.bottom.reduce((x, y) => x + y, 0); r = N(bot ? top / bot : NaN); }
        else if (allNum) r = N(ins.length === 1 ? -nums[0] : nums.slice(1).reduce((x, y) => x - y, nums[0]));
        else {
          const base = ins.findIndex(v => !v.isNum);
          let t = strOf(ins[base]);
          ins.forEach((v, i) => {
            if (i === base) return;
            if (v.isNum) t = t.slice(0, Math.max(0, t.length - Math.max(0, Math.round(v.num))));
            else { const w = strOf(v).trim(); if (w) t = t.split(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(" "); }
          });
          t = t.replace(/\s+/g, " ").trim();
          r = { num: t.length, bool: !!t, str: t, text: t ? clip(t) : "–" };
        }
        break;
      }
      case "mul": r = !allNum ? none : ins.length ? N(nums.reduce((x, y) => x * y, 1)) : none; break;
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

  // + and − on a single button or window read as signs, not sums:
  //   + (up, yes, ok)      a closed button opens; an open window comes up to the front
  //   − (down, lower)      an open window folds down into its button
  // With a second input they go back to adding and subtracting.
  function signOn(n, ref, dropped) {
    const i = O().info && O().info(ref.key);
    if (!i || (dropped && dropped.matches(".orbit-bubble") && !dropped.matches(".ob-member"))) return;   // a whole bubble is a group, not one button
    if (n.fn === "add" && O().openTitle && O().openTitle(i.title)) say("+: " + (i.open ? "brought " + i.title + " up" : "yes, opened " + i.title));
    else if (n.fn === "sub" && i.open && O().close && O().close(ref.key)) say("−: put " + i.title + " down");
  }

  // Stop guesses what you mean by what you drop it on:
  //   a wire                          remove the wire
  //   an open window                  close it
  //   something working (a thinking engine or "?", a Show following a live
  //   value, the π mark, counter or loop)            stop it: Stop holds it
  //   anything else (an idle node, a node Stop already holds, another Stop)
  //                                   delete it
  // Removing and closing use the Stop up; stopping leaves it wired as the hold.
  function stopGuess(n, x, y) {
    const under = document.elementsFromPoint(x, y).filter(e => e !== n.el && !n.el.contains(e));
    const done = msg => { remove(n); say("Stop: " + msg); return true; };
    const wire = under.find(e => e.matches && e.matches(".wire-hit"));
    if (wire) {
      if (wire.closest(".sl-layer")) { if (window.SuperLink && window.SuperLink.removeAt(+wire.dataset.i)) return done("removed that wire"); }
      const tn = nodes.find(m => m.id === wire.dataset.node);
      if (tn) { tn.inputs.splice(+wire.dataset.i, 1); return done("removed that wire"); }
    }
    const nodeEl = under.map(e => e.closest && e.closest(".lv-node")).find(Boolean);
    const tn = nodeEl && nodes.find(m => m.el === nodeEl);
    if (tn) {
      const working = (tn.fn === "super" || tn.fn === "panel") ? tn.st.go
        : tn.fn === "show" ? tn.inputs.length + linkIns(tn).length > 0 : false;
      if (working && !tn.held) return false;                              // wire it as usual: Stop holds it
      const name = BY[tn.fn].name;
      remove(tn);
      return done("deleted the " + name + " node");
    }
    const panel = under.map(e => e.closest && e.closest(".orbit-panel")).find(Boolean);
    if (panel && O().keyOf && O().close) {
      const k = O().keyOf(panel), title = (panel.querySelector(".op-title") || {}).textContent || "the window";
      if (k && O().close(k)) return done("closed " + title);
    }
    return false;                                                           // π, a button, empty space: as before
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
      if (n.fn === "sub") { const g = n.el.querySelector(".lv-glyph"), want = n.mode === "div" ? "÷" : "−"; if (g && g.textContent !== want) g.textContent = want; }
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
  function persist() { save("lv:nodes", nodes.map(n => ({ id: n.id, fn: n.fn, fx: n.fx, fy: n.fy, inputs: n.inputs, answer: (n.fn === "super" || n.fn === "panel") && n.answer ? n.answer.slice(0, 3000) : undefined }))); }
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
    const n = { id: spec.id, fn: f.k, fx: spec.fx, fy: spec.fy, inputs: (spec.inputs || []).slice(0, f.n), st: {}, el, val, text: "" };
    if (f.k === "panel") n.answer = spec.answer || "";
    if (f.k === "super") {
      g.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="lv-star" d=""/></svg>';
      n.st.sn = G(); n.st.t = 0; n.answer = spec.answer || "";
      if (n.answer) { n.st.t = 1; n.st.sn = P(); }
      requestAnimationFrame(() => drawSuper(n));
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
      if (n.fn === "stop" && ev.type === "pointerup" && stopGuess(n, ev.clientX, ev.clientY)) { persist(); tick(); return; }
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
        if ((n.fn === "add" || n.fn === "sub") && n.inputs.length === 1 && ref.key) setTimeout(() => signOn(n, ref, t.el), 0);
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
      if (n.fn === "super") askEngine(n, true);
      else if (n.fn === "panel") askPanel(n, true);
      else if (n.fn === "stop" && n.holds) say("Stop: holding " + n.holds + " (unwire it to let them go)");
      else if (n.fn === "play") runWired(n);
      else if (n.fn === "stop") { run(false); say("Stop: π stopped"); }
      else say(BY[n.fn].name + ": " + (n.text || "no inputs yet"));
      tick();
    });
    n.el.addEventListener("dblclick", () => { n.inputs = []; if (window.SuperLink && window.SuperLink.forget) window.SuperLink.forget("node:" + n.id); persist(); tick(); say(BY[n.fn].name + " unwired"); });
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
