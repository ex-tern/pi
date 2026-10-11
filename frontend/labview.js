// labview.js — a Functions palette and block diagram, like LabVIEW's.
//
// Five shapes, and each becomes what its first use makes it, then stays that:
//   ■ dropped on an open window becomes that window's stop button; on empty page
//     it is nothing yet; the first thing typed into a blank ■ or ● makes it a
//     text field (a letter) or an integer field (a digit); ● made bigger becomes
//     a loop that counts; dropped on something, it shows or passes that along.
// What each shape can mean:
//   +   add, join, up, open, more: numbers add, words join; alone on a button
//       it opens it (yes, ok), on an open window it brings it up
//   ■   stop, a blank box: it shows whatever is wired into it (text or a
//       number); press it to stop what it shows (the box freezes, engines and
//       π feeding it stop); press again to let go; dropped on a wire it
//       removes it, on an open window it closes it; unwired, press stops π
//   ◆   the smart AI: what is wired in becomes its prompt and every engine
//       answers (/api/super/ask); grows from n = 1.3 toward π while it thinks
//   ●   pause, a dot, a blank input: type a word or a number into it; wired,
//       it passes the value through like a dot on a wire; press it to pause
//       what it is wired to (π, an engine) and again to go on
//   ?   help, ask the AIs: type a question and the panel of AI jurors answers
//       (/api/super/panel); dropped on a button, window, word or node it says
//       what that is; on a wire it says what the wiring means; with a ◆ wired
//       in, the panel weighs the engine's question
//
// Wiring is the mouse's default (superlink.js): drag from any word or number
// to a node and it becomes one of its inputs; inputs can also be a pill,
// bubble or window (its name), the π mark (newest digit), the π counter
// (decimals so far) or another node (its output). Click a wire to disconnect
// it, double-click a node to unwire it, drop a node on the palette to delete
// it. The diagram is remembered in this browser (localStorage "lv:nodes").
(function () {
  "use strict";
  const sq = '<svg viewBox="0 0 20 20" aria-hidden="true">';
  // five line icons of one size and one stroke: the shape is the meaning, nothing filled
  const FNS = [
    { k: "add", svg: sq + '<path d="M10 3.5V16.5M3.5 10H16.5"/></svg>', name: "Plus", n: 9 },
    { k: "box", svg: sq + '<rect x="4" y="4" width="12" height="12" rx="1.5"/></svg>', name: "Square", n: 9 },
    { k: "super", svg: sq + '<path class="lv-star" d="M10 2.8L17.2 10L10 17.2L2.8 10Z" stroke-linejoin="round"/></svg>', name: "Super AI", n: 9 },
    { k: "dot", svg: sq + '<circle cx="10" cy="10" r="6.6"/></svg>', name: "Circle", n: 9 },
    { k: "ask", svg: sq + '<path d="M7.2 7.4a2.8 2.8 0 1 1 4.2 2.4c-.9.5-1.4 1.1-1.4 2.1v.6"/><path d="M10 15.4v.1" stroke-width="2.2"/></svg>', name: "Help: ask the AIs", n: 9 },
  ];
  const RENAMED = { show: "box", stop: "box", panel: "ask" };   // diagrams saved before the five shapes
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
      case "add": return a + " + " + b + " = " + (a + b) + "; drag it out: it adds, joins, or opens what it touches";
      case "box": run(still()); return (still() ? "π stopped" : "π running") + "; drag it out: onto a window for its stop button, onto something to show it, or type into it";
      case "super": return "drag it out and wire words, numbers, buttons or nodes into it: every engine answers";
      case "dot": run(still()); return (still() ? "π paused" : "π going on") + "; drag it out: type into it, drop it on something, or drag it bigger for a loop";
      case "ask": return "+ adds or opens · ■ shows and stops · ◆ asks every engine · ● is an input or a pause · ? explains: drop it on anything, or type a question";
      default: return "drag it onto something to wire it";
    }
  }


  // ---- the diagram -----------------------------------------------------
  let nodes = [];           // { id, fn, fx, fy, inputs: [ref], st: {go, t, sn, timer, ctrl}, text, changed, el }
  let canvas, wires, out, pal, dragging = null;
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
  // wires (superlink.js) that end on this node (and don't come from it), oldest first
  function linkIns(n) {
    const L = window.SuperLink && window.SuperLink.links ? window.SuperLink.links() : [], me = "node:" + n.id;
    const out = [];
    // a blank ■ shows: between it and another node the value flows into the ■, whichever end the wire began at
    const isSink = x => !!x && ((x.fn === "box" && !x.role) || (x.role === "text" && !!opOf(x.str)));
    const sink = h => isSink(h && h.startsWith("node:") && nodes.find(m => "node:" + m.id === h));
    const meSink = isSink(n);
    L.forEach(l => {
      const ah = l.a && l.a.h, bh = l.b && l.b.h;
      const other = ah === me ? bh : bh === me ? ah : null;
      if (other && other !== me && other.startsWith("node:") && meSink !== sink(other)) { if (meSink) out.push(ah === me ? l.b : l.a); return; }
      if (l.b && l.b.h === me && !(l.a && l.a.h === me)) out.push(l.a);
      else if (l.a && l.a.h === me && l.b && !(l.b.h && l.b.h.startsWith("node:"))) out.push(l.b);   // node → a number: the number still feeds it
    });
    return out;
  }
  const clip = t => t.length > 28 ? t.slice(0, 27) + "…" : t;
  const strOf = v => v.str != null && v.str !== "" ? v.str : v.text || (v === ZERO ? "" : String(v.num));
  const N = v => ({ num: v, isNum: true, bool: !!v && !Number.isNaN(v), text: Number.isNaN(v) ? "NaN" : Number.isInteger(v) ? String(v) : v.toFixed(3) });
  // a word typed into a ■ or ● that names an operation
  const OPS = { x: "*", "×": "*", "*": "*", "·": "*", "+": "+", "-": "-", "−": "-", "–": "-", "/": "/", "÷": "/", ":": "/", "^": "^", "%": "%" };
  const opOf = t => { const k = String(t || "").trim().toLowerCase(); return OPS[k] || null; };
  function applyOp(op, xs) {
    if (!xs.length) return 0;
    return xs.slice(1).reduce((a, b) => op === "*" ? a * b : op === "+" ? a + b : op === "-" ? a - b : op === "/" ? a / b : op === "^" ? Math.pow(a, b) : a % b, xs[0]);
  }
  // what sits inside a loop's ring, and which of it is the result: the node nothing else inside takes from
  function inside(loop) {
    const r = loop.el.getBoundingClientRect(), R = r.width / 2, cx = r.left + R, cy = r.top + r.height / 2;
    return nodes.filter(m => m !== loop && (() => { const b = m.el.getBoundingClientRect(); return Math.hypot(b.left + b.width / 2 - cx, b.top + b.height / 2 - cy) + Math.max(b.width, b.height) / 2 <= R + 4; })());
  }
  function bodyOut(loop) {
    const ins = inside(loop);
    if (!ins.length) return null;
    const feeds = new Set();
    ins.forEach(m => { m.inputs.forEach(ref => ref.node && feeds.add(ref.node)); linkIns(m).forEach(an => an.h && an.h.startsWith("node:") && feeds.add(an.h.slice(5))); });
    const outs = ins.filter(m => !feeds.has(m.id));
    return outs.find(m => m.role === "text" && opOf(m.str)) || outs.find(m => m.fn === "add" || m.fn === "box") || outs[outs.length - 1] || null;
  }
  function evalNode(n) {
    if (!n) return ZERO;
    if (memo[n.id]) return memo[n.id];
    if (visiting[n.id]) return { num: NaN, bool: false, text: "NaN" };
    visiting[n.id] = true;
    const ins = n.inputs.map(valueOf).concat(linkIns(n).map(valueOfAnchor)).slice(-BY[n.fn].n);
    const a = ins[0] || ZERO, nums = ins.map(v => v.num), none = { num: 0, bool: false, text: "" };
    const allNum = ins.every(v => v.isNum);   // a word, a button or a window is its name: + joins names into text
    let r;
    switch (n.fn) {
      case "add":
        if (!ins.length) r = none;
        else if (allNum) r = N(nums.reduce((x, y) => x + y, 0));
        else { const t = ins.map(strOf).filter(Boolean).join(" "); r = { num: t.length, bool: !!t, str: t, text: clip(t) }; }
        break;
      case "super": {
        n.prompt = ins.map(strOf).filter(Boolean).join(" ").trim();
        const t = n.answer || "";
        r = { num: t.length, bool: !!t, str: t, text: t || (n.st.go ? "thinking…" : n.prompt ? "press to ask" : "wire a prompt into it") };
        break;
      }
      case "box":                                      // ■ and ●: what their first use made them
      case "dot": {
        const v = ins[ins.length - 1];
        const body = n.role === "loop" ? bodyOut(n) : null;                // a loop gives what is inside it: its body's result
        if (body) { const v = evalNode(body); r = Object.assign({}, v, { bool: !n.paused }); }
        else if (n.role === "loop") r = { num: n.i || 0, isNum: true, bool: !n.paused, str: String(n.i || 0), text: String(n.i || 0) };
        else if (n.role === "int") { const x = parseInt(n.str, 10); r = Number.isNaN(x) ? { num: 0, isNum: true, bool: false, str: "", text: "" } : { num: x, isNum: true, bool: x !== 0, str: String(x), text: String(x) }; }
        else if (n.role === "text" && opOf(n.str) && ins.length) r = N(applyOp(opOf(n.str), ins.map(v => v.num)));   // "x", "+", "-", "/" typed in: it is that operation
        else if (n.role === "text") { const t = n.str || ""; r = { num: t.length, bool: !!t, str: t, text: t }; }
        else if (n.role === "stop") { const i = n.target && O().info ? O().info(n.target) : null; r = { num: i && i.open ? 1 : 0, bool: !!(i && i.open), str: i ? i.title : "", text: "" }; }
        else r = v ? { num: v.num, isNum: v.isNum, bool: v.bool, str: strOf(v), text: v.text != null && v.text !== "" ? v.text : clip(strOf(v)) } : { num: 0, bool: false, text: "" };
        break;
      }
      case "ask": {                                    // ? : what you typed, a wired ◆'s question, and whatever else is wired in
        const sup = n.inputs.map(ref => ref.node && nodes.find(x => x.id === ref.node)).find(x => x && x.fn === "super");
        const rest = ins.filter(v => !(sup && v === memo[sup.id]));
        n.prompt = [(n.str || "").trim(), sup ? sup.prompt || "" : "", rest.map(strOf).filter(Boolean).join(" ")].filter(Boolean).join(" ").trim();
        n.context = sup && sup.answer ? sup.answer : "";
        n.supAnswer = sup ? sup.answer || "" : "";
        const t = n.answer || "";
        r = { num: t.length, bool: !!t, str: t, text: t };
        break;
      }
      default: r = ZERO;
    }
    visiting[n.id] = false;
    memo[n.id] = r;
    return r;
  }

  // + alone on a button or window reads as a sign, not a sum: up, yes, ok.
  // A closed button opens; an open window comes up to the front.
  function signOn(n, ref, dropped) {
    const i = O().info && O().info(ref.key);
    if (!i || (dropped && dropped.matches(".orbit-bubble") && !dropped.matches(".ob-member"))) return;   // a whole bubble is a group, not one button
    if (O().openTitle && O().openTitle(i.title)) say("+: " + (i.open ? "brought " + i.title + " up" : "yes, opened " + i.title));
  }

  // what is under a point, past the node being dropped
  function under(n, x, y) { return document.elementsFromPoint(x, y).filter(e => e !== n.el && !n.el.contains(e)); }
  function wireUnder(n, x, y) {
    const w = under(n, x, y).find(e => e.matches && e.matches(".wire-hit"));
    if (!w) return null;
    if (w.closest(".sl-layer")) { const L = window.SuperLink ? window.SuperLink.links() : []; const l = L[+w.dataset.i]; return l ? { sl: +w.dataset.i, a: l.a, b: l.b } : null; }
    const tn = nodes.find(m => m.id === w.dataset.node); return tn ? { node: tn, i: +w.dataset.i } : null;
  }

  // ■ dropped on a wire removes it; on an open window closes it; anywhere else it is wired as a box that shows
  function boxGuess(n, x, y) {
    const done = msg => { remove(n); say("■: " + msg); return true; };
    const w = wireUnder(n, x, y);
    if (w) {
      if (w.sl != null && window.SuperLink.removeAt(w.sl)) return done("removed that wire");
      if (w.node) { w.node.inputs.splice(w.i, 1); return done("removed that wire"); }
    }
    if (under(n, x, y).some(e => e.closest && e.closest(".lv-node"))) return false;     // a node: show it
    const panel = under(n, x, y).map(e => e.closest && e.closest(".orbit-panel")).find(Boolean);
    if (panel && O().keyOf && !n.role) {                                    // on an open window: it is that window's stop button
      const k = O().keyOf(panel), title = (panel.querySelector(".op-title") || {}).textContent || "the window";
      if (k) {
        n.role = "stop"; n.target = k; n.targetTitle = title;
        const r = panel.getBoundingClientRect();
        n.fx = Math.max(4, Math.min(window.innerWidth - 60, r.right - 56)) / window.innerWidth; n.fy = Math.max(4, r.top - 44) / window.innerHeight; place(n); clear(n);
        say("■ is now the stop button for " + title + ": press it to close it");
        return true;
      }
    }
    return false;
  }

  // ? explains what it is dropped on: a wire (what the wiring means), a node (what it does),
  // a button, window or word (asks the engines what it is); on a ◆ it is wired to ask the panel
  const HELP = {
    add: "+ means add, join, up, open, more. Numbers wired in add up, words join; alone on a button it opens it, on an open window it brings it up.",
    box: "■ becomes what you first do with it. Dropped on an open window it is that window's stop button; type a letter into a blank one for a text field, a digit for an integer field; dropped on something it shows it, and pressing it stops what it shows. On a wire it removes the wire.",
    super: "◆ is the smart AI. Whatever is wired into it becomes its prompt and every engine in the project answers: siM, riB, piD and PiEn. Wire a ■ to it to read the answer.",
    dot: "● becomes what you first do with it. Type a letter for a text field, a digit for an integer field; drop it on something and it passes the value along, and pressing it pauses; drag it bigger and it becomes a loop that counts.",
    ask: "? means help or ask. Type a question and the panel of AI jurors answers; drop it on anything to hear what it is, or on a wire to hear what the wiring means.",
  };
  function describe(an) {
    if (!an) return "nothing";
    if (an.loop) return "the main loop (π)";
    if (an.h && an.h.startsWith("node:")) { const m = nodes.find(x => x.id === an.h.slice(5)); return m ? "the " + BY[m.fn].name + " node" : "a node"; }
    if (!an.el) return "“" + an.t + "”";
    return an.h ? an.h.replace(/^[a-z#]+:?/, "").replace(/^[a-z]+:/, "") : "something";
  }
  function askGuess(n, x, y, t) {
    const w = wireUnder(n, x, y);
    const put = text => { n.answer = text; n.st.local = true; n.fx = Math.min(window.innerWidth - 260, x + 24) / window.innerWidth; n.fy = Math.max(4, y - 16) / window.innerHeight; place(n); clear(n); say("?: " + text.split("\n")[0]); return true; };
    if (w) {
      if (w.sl != null) {
        const meant = window.SuperLink.intent ? window.SuperLink.intent([describe(w.a), describe(w.b)]) : null;
        const feeds = [w.a, w.b].find(e => e && e.h && e.h.startsWith("node:"));
        return put("This wire joins " + describe(w.a) + " and " + describe(w.b) + "." +
          (meant ? " Together their words name " + meant + ", so it means: open " + meant + "." : "") +
          (feeds ? " It feeds " + describe(feeds) + ", which takes the other end as an input." : ""));
      }
      if (w.node) return put("This wire feeds " + nameOf(w.node.inputs[w.i]) + " into the " + BY[w.node.fn].name + " node, as one of its inputs. " + HELP[w.node.fn]);
    }
    const nodeEl = under(n, x, y).map(e => e.closest && e.closest(".lv-node")).find(Boolean);
    const tn = nodeEl && nodes.find(m => m.el === nodeEl);
    if (tn && tn.fn === "super") return false;                                  // wire it: the panel weighs the engine's question
    if (tn) return put(HELP[tn.fn] + (tn.text ? " Right now it holds: " + clip(String(tn.text)) : ""));
    if (t && t.text) { askWhat(n, "What does “" + t.text.t + "” mean on ScholarPi?"); return put("Asking what “" + t.text.t + "” means…"); }
    if (t && t.el && !t.el.matches(".orbit-core")) {
      const ref = refOf(t.el), i = ref && ref.key && O().info ? O().info(ref.key) : null;
      const name = i ? i.title : ref && ref.pi ? "the π counter" : "this";
      askWhat(n, "What is " + name + " on ScholarPi?");
      return put("Asking what " + name + " is…");
    }
    return false;
  }

  // a pressed ■ (stopped) or ● (paused) holds what is wired into it: engines stop
  // thinking (a question on its way is cancelled), π stops, a ■ freezes
  let piHeld = false;
  function holds() {
    const held = new Set(); let pi = false;
    nodes.filter(x => (x.fn === "box" && x.stopped) || (x.fn === "dot" && x.paused)).forEach(h => {
      h.inputs.forEach(ref => { if (ref.node) held.add(ref.node); else if (ref.core || ref.pi) pi = true; });
      linkIns(h).forEach(an => {
        if (an.loop || an.h === "pi") pi = true;
        else if (an.h && an.h.startsWith("node:")) held.add(an.h.slice(5));
      });
    });
    if (pi && !piHeld) { piHeld = true; if (!still()) run(false); }
    else if (!pi && piHeld) { piHeld = false; run(true); }
    nodes.forEach(n => {
      const was = n.held; n.held = held.has(n.id);
      n.el.classList.toggle("is-held", n.held);
      if (n.held && !was && n.st.ctrl) n.st.ctrl.abort();
      if (n.held && n.st.timer) { clearTimeout(n.st.timer); n.st.timer = 0; }
    });
  }
  const wiredToPi = n => n.inputs.some(r => r.core || r.pi) || linkIns(n).some(an => an.loop || an.h === "pi");

  function tick() {
    memo = {}; visiting = {};
    holds();
    const now = performance.now();
    nodes.forEach(n => {
      const r = evalNode(n);
      const frozen = n.fn === "box" && (n.stopped || n.held);
      if (!frozen && n.text !== r.text) {
        n.text = r.text; n.changed = now;
        if ((n.fn === "box" || n.fn === "dot") && !n.field && n.role !== "stop") n.el.querySelector(".lv-glyph").textContent = n.role === "loop" ? "" : r.text;   // holds its value inside
        else if (n.fn === "ask") n.el.querySelector(".lv-ans").textContent = r.text;
        else if (n.fn !== "super") n.val.textContent = r.text;
      }
      if (n.fn === "super" || n.fn === "ask") {                          // its status, always current
        const st = n.held ? "stopped" : n.st.go ? "thinking…" : n.answer ? (n.fn === "ask" ? "" : "answered") : n.prompt ? "press to ask" : "";
        if (n.val.textContent !== st) n.val.textContent = st;
        const w = wiringOf(n) + (n.fn === "ask" ? "|" + (n.supAnswer || "") : "");   // ? also follows the engine's answers
        if (n.wiring !== undefined && w !== n.wiring && n.prompt && !n.held) { clearTimeout(n.st.timer); n.st.timer = setTimeout(() => (n.fn === "ask" ? askPanel(n) : askEngine(n)), n.fn === "ask" ? 1500 : 900); }
        n.wiring = w;
      }
      if (n.fn === "ask") n.el.classList.toggle("is-asking", !!(n.str || n.answer || r.text || n.st.go || n.el.contains(document.activeElement) && document.activeElement.tagName === "INPUT"));
      if (n.fn === "box" || n.fn === "ask") {
        const long = String(n.text || "").length > 28 || /\n/.test(n.text || "");
        n.el.classList.toggle("is-long", long);
        if (n.changed === now) clear(n);                                 // its text changed size: step out of the way
      }
      if (n.fn === "box" || n.fn === "dot") {
        const lab = n.role === "stop" ? "stop · " + (n.targetTitle || "window")
          : n.role === "loop" ? ""                                            // a loop is just its ring: no counter on the page
          : n.role === "text" || n.role === "int" ? ""                        // no "text" / "integer" under it
          : n.stopped ? "stopped" : n.paused ? "paused" : "";
        if (n.val.textContent !== lab) n.val.textContent = lab;
        n.el.classList.toggle("is-stopped", !!(n.stopped || n.paused));
        n.el.classList.toggle("is-loop", n.role === "loop");
        fitText(n);
        n.el.classList.toggle("has-val", !!n.text && !n.field && n.role !== "stop" && n.role !== "loop");
        n.el.classList.toggle("is-on", n.role === "stop" && r.bool);       // its window is open
      }
      n.el.setAttribute("aria-label", BY[n.fn].name + " node" + (n.inputs.length ? ", wired to " + n.inputs.map(nameOf).join(" and ") : ", not wired") + ". " + (r.text ? "Value " + clip(String(r.text)) + "." : ""));
      n.el.title = n.fn === "super" ? "Super AI" : BY[n.fn].name + (n.inputs.length ? " ← " + n.inputs.map(nameOf).join(", ") : "") + "\n" + HELP[n.fn];
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
        const d = se() && window.SeMorph.wire ? window.SeMorph.wire(sx, cy, tx, ty, true)
          : "M" + sx + "," + cy + "C" + (sx + sg * c) + "," + cy + " " + (tx - c) + "," + ty + " " + tx + "," + ty;
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
  function persist() { save("lv:nodes", nodes.map(n => ({ id: n.id, fn: n.fn, fx: n.fx, fy: n.fy, inputs: n.inputs, answer: (n.fn === "super" || n.fn === "ask") && n.answer ? n.answer.slice(0, 3000) : undefined, str: n.str || undefined, role: n.role || undefined, target: n.target, targetTitle: n.targetTitle, size: n.size }))); }
  function place(n) {
    const w = n.el.offsetWidth || 44, h = n.el.offsetHeight || 32;
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, n.fx * window.innerWidth));
    const y = Math.max(4, Math.min(window.innerHeight - h - 22, n.fy * window.innerHeight));
    n.el.style.left = x + "px"; n.el.style.top = y + "px";
  }
  function make(spec) {
    const f = BY[RENAMED[spec.fn] || spec.fn];
    if (!f) return null;
    const el = document.createElement("div");
    el.setAttribute("role", "button"); el.tabIndex = 0;
    el.className = "lv-node lv-fn lv-" + f.k;
    el.dataset.id = spec.id;
    const g = document.createElement("span"); g.className = "lv-glyph"; glyph(g, f);
    const val = document.createElement("span"); val.className = "lv-val"; val.setAttribute("aria-hidden", "true");
    el.append(g, val);
    const n = { id: spec.id, fn: f.k, fx: spec.fx, fy: spec.fy, inputs: (spec.inputs || []).slice(0, f.n), st: {}, el, val, text: "" };
    n.str = spec.str || "";
    const field = (cls, ph, label) => {
      const inp = document.createElement("input");
      inp.type = "text"; inp.className = cls; inp.placeholder = ph; inp.value = n.str; inp.spellcheck = false; inp.autocomplete = "off";
      inp.setAttribute("aria-label", label);
      inp.addEventListener("pointerdown", e => e.stopPropagation());
      inp.addEventListener("click", e => e.stopPropagation());
      inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter" && f.k === "ask") { n.st.local = false; askPanel(n, true); } });
      inp.addEventListener("input", () => {
        if (n.role === "int") { const c = inp.value.replace(/(?!^-)[^\d]/g, ""); if (c !== inp.value) inp.value = c; }   // an integer field takes digits only
        n.str = inp.value; persist(); tick();
      });
      return inp;
    };
    n.role = spec.role || null; n.target = spec.target; n.targetTitle = spec.targetTitle; n.size = spec.size; n.i = 0;
    if ((f.k === "box" || f.k === "dot") && (n.role === "text" || n.role === "int")) { n.field = field("lv-in", "", n.role === "int" ? "Integer" : "Text"); g.replaceWith(n.field); }
    if (f.k === "box" || f.k === "dot") { if (!n.field) g.textContent = ""; }   // blank: the shape alone
    if (f.k === "dot") {                                                  // a grip on its edge: drag it bigger for a loop
      const grip = document.createElement("span"); grip.className = "lv-grip"; grip.setAttribute("aria-hidden", "true");
      el.appendChild(grip);
      grip.addEventListener("pointerdown", e => grow2(e, n, grip));
    }
    if (f.k === "ask") {
      n.answer = spec.answer || "";
      const q = field("lv-q", "", "Ask a question, then press Enter");
      q.addEventListener("blur", () => setTimeout(() => tick(), 0));       // an empty question folds away again
      const ans = document.createElement("div"); ans.className = "lv-ans"; ans.textContent = n.answer;
      g.after(q); el.appendChild(ans);
    }
    if (f.k === "super") {
      g.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="lv-star" d=""/></svg>';
      n.st.sn = G(); n.st.t = 0; n.answer = spec.answer || "";
      if (n.answer) { n.st.t = 1; n.st.sn = P(); }
      requestAnimationFrame(() => drawSuper(n));
    }
    if (n.size) sizeDot(n, n.size);
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
    if (n.role === "loop") return;                                       // a loop holds things: nothing steps out of it
    for (let k = 0; k < 8; k++) {
      const a = n.el.getBoundingClientRect();
      const hit = nodes.find(o => o !== n && o.role !== "loop" && (() => { const b = o.el.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; })());
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
      if (ev.pointerId !== e.pointerId || (n && n.st.pinch)) return;     // a second finger zooms, it does not drag
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moved) {
        moved = true;
        if (spawn) { n = make({ id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), fn: spawn.k, fx: 0, fy: 0, inputs: [] }); dx = n.el.offsetWidth / 2; dy = n.el.offsetHeight / 2; }
        n.el.classList.add("is-dragging"); dragging = n;
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
      if (n && n.st.pinched) { n.st.pinched = false; n.el.classList.remove("is-dragging"); dragging = null; startEl.dataset.dragged = "1"; setTimeout(() => { delete startEl.dataset.dragged; }, 0); persist(); return; }
      if (!moved) return;
      startEl.dataset.dragged = "1"; setTimeout(() => { delete startEl.dataset.dragged; }, 0);
      n.el.classList.remove("is-dragging"); dragging = null;
      const t = ev.type === "pointerup" ? targetAt(ev.clientX, ev.clientY, n.el) : null;
      if (t && t.palette) { remove(n); say(BY[n.fn].name + " node removed"); return; }
      if (n.fn === "box" && ev.type === "pointerup" && boxGuess(n, ev.clientX, ev.clientY)) { persist(); tick(); return; }
      if (n.fn === "ask" && ev.type === "pointerup" && askGuess(n, ev.clientX, ev.clientY, t)) { persist(); tick(); return; }
      if (t && t.text && BY[n.fn].n && !((n.fn === "box" || n.fn === "dot") && n.role) && window.SuperLink && window.SuperLink.add) {
        window.SuperLink.add(t.text, { h: "node:" + n.id, el: 1 });
        const w = n.el.offsetWidth, h = n.el.offsetHeight;
        let x = t.rect.right + 28; if (x + w > window.innerWidth - 4) x = t.rect.left - w - 28;
        n.fx = Math.max(4, x) / window.innerWidth; n.fy = (t.rect.top + t.rect.height / 2 - h / 2) / window.innerHeight; place(n); clear(n);
        say(BY[n.fn].name + " wired to “" + t.text.t + "”"); persist(); tick(); return;
      }
      if (t && t.el && BY[n.fn].n) {
        const ref = refOf(t.el);
        if ((n.fn === "box" || n.fn === "dot") && n.role) { place(n); persist(); tick(); return; }   // it already is something: just moved
        attach(n, ref);
        if (n.fn === "add" && n.inputs.length === 1 && ref.key) setTimeout(() => signOn(n, ref, t.el), 0);
        if (n.inputs.some(r => same(r, ref))) { beside(n, t.el, ev.clientX, ev.clientY); say(BY[n.fn].name + " wired to " + nameOf(ref)); }
      } else if (spawn) {
        say(BY[n.fn].name + " placed" + (n.fn === "box" || n.fn === "dot" ? ": it is nothing yet; type a letter for text or a digit for an integer" : n.fn === "ask" ? ": type a question and press Enter" : ": drop it on something to wire it"));
        if (n.fn === "ask" || ((n.fn === "box" || n.fn === "dot") && !n.role)) setTimeout(() => n.el.focus({ preventScroll: true }), 60);
      }
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
      const wired = n.inputs.length + linkIns(n).length > 0;
      if (n.fn === "super") askEngine(n, true);
      else if (n.fn === "ask") { if (n.prompt && !n.st.local) askPanel(n, true); else { n.el.classList.add("is-asking"); const i = n.el.querySelector("input"); if (i) i.focus(); } }
      else if (n.fn === "box" || n.fn === "dot") {
        const sym = n.fn === "box" ? "■" : "●";
        if (n.role === "stop") { const i = O().info && O().info(n.target); if (i && i.open && O().close(n.target)) say("■: stopped " + i.title); else say("■: " + (n.targetTitle || "its window") + " is not open"); }
        else if (n.field) n.field.focus();
        else if (n.role === "loop") { n.paused = !n.paused; say("●: the loop " + (n.paused ? "is paused" : "goes on")); }
        else if (wired && n.fn === "box") { n.stopped = !n.stopped; if (!n.stopped) n.text = null; say("■: " + (n.stopped ? "stopped what it shows" : "let go")); }
        else if (wired) { n.paused = !n.paused; say("●: " + (n.paused ? "paused" : "going on")); }
        else say(sym + ": nothing yet; type a letter for text or a digit for an integer" + (n.fn === "dot" ? ", or drag its edge bigger for a loop" : ""));
      }
      else say(BY[n.fn].name + ": " + (n.text || "no inputs yet"));
      tick();
    });
    n.el.addEventListener("dblclick", e => {                              // a double click deletes it, wires and all
      if (e.target.closest && e.target.closest("input")) return;
      e.preventDefault(); e.stopPropagation(); remove(n); say(BY[n.fn].name + " deleted");
    });
    n.el.addEventListener("keydown", e => {
      // the first thing typed into a blank ■ or ● decides: a letter makes a text field, a digit an integer field
      if ((n.fn === "box" || n.fn === "dot") && !n.role && !n.field && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
        e.preventDefault();
        n.role = /[\d-]/.test(e.key) ? "int" : "text";
        n.str = e.key; n.inputs = [];
        const real = fieldFor(n);
        n.el.querySelector(".lv-glyph").replaceWith(real); n.field = real;
        real.focus(); real.setSelectionRange(real.value.length, real.value.length);
        say((n.fn === "box" ? "■" : "●") + " is now " + (n.role === "int" ? "an integer field" : "a text field"));
        persist(); tick(); return;
      }
      // typing at a blank ? opens its question field
      if (n.fn === "ask" && e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const q = n.el.querySelector(".lv-q");
        if (q) { e.preventDefault(); n.el.classList.add("is-asking"); q.focus(); q.value += e.key; q.dispatchEvent(new Event("input")); return; }
      }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(n); say(BY[n.fn].name + " node removed"); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); n.el.click(); }
    });
  }
  function say(t) { if (out) out.textContent = t; }
  // what a ■ or ● holds fits inside it: the type shrinks with the length (Geist Mono is ~0.62 em a character)
  function fitText(n) {
    const t = n.field ? n.field.value : n.el.classList.contains("is-long") ? "" : String(n.text || "");
    const target = n.field || n.el.querySelector(".lv-glyph");
    if (!target) return;
    if (!t || n.role === "loop") { target.style.fontSize = ""; return; }
    const size = n.size || 56, room = size * (n.fn === "dot" ? 0.74 : 0.82);
    const fs = Math.max(5, Math.min(size * 0.3, room / (Math.max(1, t.length) * 0.62)));
    target.style.fontSize = fs.toFixed(1) + "px";
  }
  // a text or integer field inside a ■ or ●, made by its first key
  function fieldFor(n) {
    const inp = document.createElement("input");
    inp.type = "text"; inp.className = "lv-in"; inp.value = n.str || ""; inp.spellcheck = false; inp.autocomplete = "off";
    if (n.role === "int") inp.inputMode = "numeric";
    inp.setAttribute("aria-label", n.role === "int" ? "Integer" : "Text");
    inp.addEventListener("pointerdown", e => e.stopPropagation());
    inp.addEventListener("click", e => e.stopPropagation());
    inp.addEventListener("keydown", e => e.stopPropagation());
    inp.addEventListener("input", () => {
      if (n.role === "int") { const c = inp.value.replace(/(?!^-)[^\d]/g, ""); if (c !== inp.value) inp.value = c; }   // an integer field takes digits only
      n.str = inp.value; persist(); tick();
    });
    return inp;
  }
  // ● dragged bigger by its grip: past twice its size it becomes a loop, a ring that counts
  const DOT = 52, DOT_BASE = 56, LOOP_AT = 104;
  // every node's size is one number (--lv-s); a value, a field or an answer still makes it grow around them
  function sizeDot(n, d) { n.size = d; n.el.style.setProperty("--lv-s", d + "px"); }
  // scrolling on a node sizes it, about its centre; a ● scrolled past twice its size becomes a loop
  let zoomed = null;
  function zoomNode(n, dy) {
    const r = n.el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cur = n.size || DOT_BASE, max = Math.min(window.innerWidth, window.innerHeight) - 20;
    const d = Math.round(Math.max(36, Math.min(n.fn === "dot" ? max : 240, cur * Math.exp(-dy * 0.0015))));
    if (d === cur) return;
    sizeDot(n, d);
    const b = n.el.getBoundingClientRect();
    n.fx = (cx - b.width / 2) / window.innerWidth; n.fy = (cy - b.height / 2) / window.innerHeight; place(n);
    if (n.fn === "dot" && d >= LOOP_AT && !n.role) { n.role = "loop"; n.i = 0; say("● is now a loop: it counts once a second (wire it to see the count); click its ring to pause"); }
    clearTimeout(n.st.zt); n.st.zt = setTimeout(persist, 300); tick();
  }
  function grow2(e, n, grip) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const r = n.el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    try { grip.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    const move = ev => {
      const d = Math.max(DOT, Math.min(Math.min(window.innerWidth, window.innerHeight) - 20, 2 * Math.hypot(ev.clientX - cx, ev.clientY - cy)));
      sizeDot(n, Math.round(d));
      n.el.style.left = (cx - d / 2) + "px"; n.el.style.top = (cy - d / 2) + "px";
      n.el.classList.toggle("is-growing", d >= LOOP_AT && n.role !== "loop");
    };
    const up = () => {
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
      n.el.dataset.dragged = "1"; setTimeout(() => { delete n.el.dataset.dragged; }, 0);   // the release is not a press
      n.el.classList.remove("is-growing");
      const b = n.el.getBoundingClientRect();
      n.fx = b.left / window.innerWidth; n.fy = b.top / window.innerHeight;
      if (n.size >= LOOP_AT && !n.role) { n.role = "loop"; n.i = 0; say("● is now a loop: it counts once a second (wire it to see the count); click its ring to pause"); }
      else if (n.role !== "loop" && n.size < LOOP_AT) sizeDot(n, n.size);
      persist(); tick();
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
  }
  // π, and everything that follows it, runs or stands still
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
    // an empty outline, like the other four; it widens toward π while the engines think
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
    if (n.held) { say("◆: stopped"); return; }
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
  // ? asking the engines what something is (one engine round, cheap)
  async function askWhat(n, question) {
    n.st.go = true; n.el.classList.add("is-thinking"); tick();
    try {
      n.st.ctrl = new AbortController();
      const res = await fetch("/api/super/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: question }), signal: n.st.ctrl.signal });
      const data = await res.json().catch(() => ({}));
      n.answer = res.ok ? (data.answer || "No engine knew.") : "?: " + (data.detail || "unavailable right now");
    } catch (e) { if (!(e && e.name === "AbortError")) n.answer = "?: could not reach the engines"; }
    n.st.ctrl = null; n.st.go = false; n.el.classList.remove("is-thinking"); n.st.local = true;
    persist(); tick();
  }
  async function askPanel(n, pressed) {
    const prompt = n.prompt || "";
    if (!prompt) { if (pressed) say("?: type a question, or drop it on something"); return; }
    if (n.st.go) return;
    if (n.held) { say("?: stopped"); return; }
    n.st.go = true; n.el.classList.add("is-thinking"); tick();
    say("?: the panel of AIs is answering “" + clip(prompt) + "”");
    try {
      n.st.ctrl = new AbortController();
      const res = await fetch("/api/super/panel", { method: "POST", headers: { "Content-Type": "application/json" }, signal: n.st.ctrl.signal,
        body: JSON.stringify({ prompt: prompt.slice(0, 4000), context: (n.context || "").slice(0, 4000) }) });
      const data = await res.json().catch(() => ({}));
      n.answer = res.ok ? (data.answer || "The panel had no answer.") : "?: " + (data.detail || "unavailable right now");
      if (res.ok) say("?: " + (data.answered || 0) + " of " + (data.asked || 0) + " answered" + (data.judge && data.judge.agreement ? ", agreement " + data.judge.agreement : ""));
    } catch (e) {
      if (e && e.name === "AbortError") say("?: stopped");
      else n.answer = "?: could not reach the panel";
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
    wires.addEventListener("dblclick", e => {
      const w = e.target.closest && e.target.closest(".wire-hit");
      const n = w && nodes.find(x => x.id === w.dataset.node);
      if (!n) return;
      e.stopPropagation();
      const ref = n.inputs.splice(+w.dataset.i, 1)[0];
      persist(); tick();
      say(BY[n.fn].name + " disconnected from " + (ref ? nameOf(ref) : "its input"));
    });
    document.body.appendChild(canvas);

    pal = document.createElement("aside");
    pal.className = "lv-palette";
    pal.setAttribute("aria-label", "Functions palette");
    // just the icons; what a press or a drop did is announced to screen readers
    pal.innerHTML = '<div class="lv-grid" role="group" aria-label="Functions"></div><output class="lv-out" aria-live="polite"></output>';
    pal.classList.add("is-open");
    const grid = pal.querySelector(".lv-grid");
    out = pal.querySelector(".lv-out");

    FNS.forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lv-fn lv-" + f.k;
      b.title = f.k === "super" ? "Super AI" : f.name + ": " + HELP[f.k];
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

    setTimeout(() => { if (window.PiOrbit && window.PiOrbit.layout) window.PiOrbit.layout(); }, 300);   // the pills make room for it
    let rt = 0;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { nodes.forEach(place); drawWires(); }, 200); });

    // the diagram you left last time
    (restore("lv:nodes") || []).forEach(make);
    setInterval(tick, 250);
    setInterval(() => { let k = 0; nodes.forEach(n => { if (n.role === "loop" && !n.paused && !n.held) { n.i = (n.i || 0) + 1; k++; } }); if (k) tick(); }, 1000);   // loops count
    // zooming on a node (a trackpad pinch, or ctrl + wheel; two fingers on a touch screen) sizes it;
    // scrolling stays what it is everywhere: the page's n
    document.addEventListener("wheel", e => {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      let n = zoomed && performance.now() - zoomed.t < 450 && nodes.includes(zoomed.n) ? zoomed.n : null;   // one scroll gesture stays on its node
      if (!n) n = hit && hit.closest && nodes.find(x => x.el === hit.closest(".lv-node"));
      if (!n) n = nodes.find(x => {
        if (x.role !== "loop") return false;
        const r = x.el.getBoundingClientRect(), d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        return Math.abs(d - r.width / 2) < 14;
      });
      if (e.ctrlKey && !n && html.classList.contains("shape-se")) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // a pinch elsewhere never zooms the page: the mark always fits the screen
      if (!n || (hit && hit.tagName === "INPUT" && n.el.contains(hit) && n.fn === "ask")) return;
      if (!e.ctrlKey) { zoomed = null; if (O().scrollN) O().scrollN(e); return; }   // scrolling is the page's n, as anywhere else
      e.preventDefault(); e.stopImmediatePropagation();
      zoomed = { n, t: performance.now() };
      zoomNode(n, (e.deltaY || e.deltaX) * 4);                        // pinch deltas are small
    }, { capture: true, passive: false });
    document.addEventListener("dblclick", e => {
      const n = nodes.find(x => { if (x.role !== "loop") return false; const r = x.el.getBoundingClientRect(), d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)); return Math.abs(d - r.width / 2) < 7; });
      if (!n) return;
      e.preventDefault(); e.stopPropagation(); remove(n); say("● loop deleted");
    }, true);
    // a click on a loop's ring pauses it (or lets it go on)
    document.addEventListener("click", e => {
      const n = nodes.find(x => {
        if (x.role !== "loop") return false;
        const r = x.el.getBoundingClientRect(), d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        return Math.abs(d - r.width / 2) < 7;
      });
      if (!n) return;
      e.preventDefault(); e.stopPropagation();
      n.paused = !n.paused; say("●: the loop " + (n.paused ? "is paused" : "goes on")); tick();
    }, true);
    // a sideways swipe on the bare page never navigates back: it is eaten unless something under it scrolls sideways
    document.addEventListener("wheel", e => {
      if (!html.classList.contains("shape-se") || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      for (let el = e.target; el && el !== document.body; el = el.parentElement)
        if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return;
      e.preventDefault();
    }, { passive: false });
    // Safari's pinch (gesture events) and touch pinches never zoom the page either
    ["gesturestart", "gesturechange"].forEach(t => document.addEventListener(t, e => { if (html.classList.contains("shape-se")) e.preventDefault(); }, { passive: false }));
    // two fingers on a node: their spread sizes it
    const touches = new Map();
    canvas.addEventListener("pointerdown", e => {
      if (e.pointerType !== "touch") return;
      const n = nodes.find(x => x.el === (e.target.closest && e.target.closest(".lv-node")));
      if (!n) return;
      touches.set(e.pointerId, { n, x: e.clientX, y: e.clientY });
      const same = [...touches.values()].filter(t => t.n === n);
      if (same.length === 2) n.st.pinch = { d0: Math.hypot(same[0].x - same[1].x, same[0].y - same[1].y) || 1, s0: n.size || DOT_BASE };
    }, true);
    document.addEventListener("pointermove", e => {
      const t = touches.get(e.pointerId); if (!t) return;
      t.x = e.clientX; t.y = e.clientY;
      const n = t.n; if (!n.st.pinch) return;
      const same = [...touches.values()].filter(x => x.n === n); if (same.length < 2) return;
      const d = Math.hypot(same[0].x - same[1].x, same[0].y - same[1].y);
      const want = n.st.pinch.s0 * d / n.st.pinch.d0, cur = n.size || DOT_BASE;
      if (Math.abs(want - cur) >= 1) zoomNode(n, -Math.log(want / cur) / 0.0015);
      n.st.pinched = true;
    }, true);
    const lift = e => { const t = touches.get(e.pointerId); if (!t) return; touches.delete(e.pointerId); if (t.n.st.pinch) { t.n.st.pinch = null; persist(); } };
    document.addEventListener("pointerup", lift, true); document.addEventListener("pointercancel", lift, true);
    tick();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  window.LabView = { nodes: () => nodes.map(n => ({ id: n.id, fn: n.fn, inputs: n.inputs, out: n.text })) };
})();
