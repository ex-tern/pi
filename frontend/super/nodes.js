// super/nodes.js — a Functions palette and block diagram, like LabVIEW's.
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
// Wiring is the mouse's default (super/wire.js): drag from any word or number
// to a node and it becomes one of its inputs; inputs can also be a pill,
// bubble or window (its name), the π mark (newest digit), the π counter
// (decimals so far) or another node (its output). Click a wire to disconnect
// it, double-click a node to unwire it, drop a node on the palette to delete
// it. The diagram is remembered in this browser (localStorage "lv:nodes").
(function () {
  "use strict";
  const ENGINE_BASE = 84;                                              // a Super AI super's size: run and prompt (owner, 2026-10-12: bigger)
  const sq = '<svg viewBox="0 0 20 20" aria-hidden="true">';
  // five line icons of one size and one stroke: the shape is the meaning, nothing filled
  const FNS = [
    { k: "add", svg: sq + '<path d="M10 3.5V16.5M3.5 10H16.5"/></svg>', name: "Plus", n: 9 },
    { k: "box", svg: sq + '<rect x="4" y="4" width="12" height="12" rx="1.5"/></svg>', name: "Square", n: 9 },
    { k: "super", svg: sq + '<path class="lv-star" d="M10 2.8L17.2 10L10 17.2L2.8 10Z" stroke-linejoin="round"/></svg>', name: "Super AI", n: 9 },
    { k: "dot", svg: sq + '<circle cx="10" cy="10" r="6.6"/></svg>', name: "Circle", n: 9 },
    { k: "ask", svg: sq + '<path d="M7.2 7.4a2.8 2.8 0 1 1 4.2 2.4c-.9.5-1.4 1.1-1.4 2.1v.6"/><path d="M10 15.4v.1" stroke-width="2.2"/></svg>', name: "Help", n: 9 },
  ];
  const RENAMED = { show: "box", stop: "box", panel: "ask" };   // diagrams saved before the five shapes
  // A node is a super: a superellipse whose exponent n says what it is. A click on bare page makes one
  // with a random n; shift + scroll on it changes n, and with it the function (kept as the node's n).
  //   n < 1          a star       +  (add, join, open)
  //   1 ≤ n < 1.7    a diamond    ◆  (the Super AI)
  //   1.7 ≤ n < 2.6  round        ●  (an input, a pause, a loop)
  //   2.6 ≤ n < 5    a squircle   ■  (shows, stops)
  //   n ≥ 5          a box        ?  (help: the panel of AIs)
  const fnOfN = n => n < 1 ? "add" : n < 1.7 ? "super" : n < 2.6 ? "dot" : n < 5 ? "box" : "ask";
  const nOfFn = { add: 0.6, super: 1.3, dot: 2, box: Math.PI, ask: 7 };
  const randomN = () => +Math.exp(Math.log(0.45) + Math.random() * (Math.log(9) - Math.log(0.45))).toFixed(3);
  const BY = Object.fromEntries(FNS.map(f => [f.k, f]));
  const TARGETS = ".lv-node, .ob-member, .orbit-bubble, .orbit-core, .orbit-pi, .orbit-panel, .se-port";
  const html = document.documentElement;
  let pickedWire = null;                                 // the node wire selected by a click (superellipse look)
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
    if (el.matches(".se-port")) return { port: el.dataset.pid || el.dataset.port };
    if (el.matches(".orbit-panel")) { const k = O().keyOf && O().keyOf(el); return k ? { key: k } : null; }
    if (el.dataset.key) return { key: el.dataset.key };
    return null;
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function elOf(ref) {
    if (ref.node) { const n = nodes.find(x => x.id === ref.node); return n && n.el; }
    if (ref.core) return document.querySelector(".orbit-core");
    if (ref.pi) return document.querySelector(".orbit-pi");
    if (ref.port) return window.SeSite ? window.SeSite.portEl(ref.port) : null;
    return O().elOf ? O().elOf(ref.key) : null;
  }
  function nameOf(ref) {
    if (ref.node) { const n = nodes.find(x => x.id === ref.node); return n ? BY[n.fn].name + " node" : "a node"; }
    if (ref.core) return "the π mark";
    if (ref.pi) return "the π counter";
    if (ref.port) { const S = window.SeSite, [o, nm] = ref.port.includes("/") ? ref.port.split("/") : ["site", ref.port]; return (S && S.ownerName ? S.ownerName(o) : "the site") + "'s " + nm + " port"; }
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
    if (ref.port) return window.SeSite ? window.SeSite.value(ref.port) : ZERO;
    const i = O().info && O().info(ref.key);
    return i ? { num: i.use, bool: i.open, str: i.title } : ZERO;
  }
  // a number or word on the page, as a wire from it (super/wire.js) remembers it
  const numOf = t => { const v = parseFloat(String(t).replace(/[,\s'’](?=\d{3}\b)/g, "").replace(",", ".")); return Number.isNaN(v) ? NaN : v; };
  function valueOfAnchor(an) {
    if (an.loop) return valueOf({ core: 1 });
    if (an.h && an.h.startsWith("node:")) return valueOf({ node: an.h.slice(5) });
    if (an.h && an.h.startsWith("port:")) return valueOf({ port: an.h.slice(5) });
    if (an.h === "title") { const t = "Pi Tech Lab"; return { num: t.length, bool: true, str: t, text: t }; }   // the site's name
    if (an.h === "live") return window.PiLive && window.PiLive.value ? window.PiLive.value() : ZERO;            // the Live panel: what the site is doing
    if (!an.el) { const v = numOf(an.t); return { num: Number.isNaN(v) ? 0 : v, isNum: !Number.isNaN(v), bool: !!an.t, str: an.t, text: an.t }; }
    if (an.h === "pi") return valueOf({ pi: 1 });
    if (an.h && an.h.startsWith("k:")) return valueOf({ key: an.h.slice(2) });
    const t = an.h ? an.h.replace(/^[a-z#]+:?/, "") : ""; return { num: 0, bool: !!t, str: t };
  }
  // wires (super/wire.js) that end on this node (and don't come from it), oldest first
  function linkIns(n) {
    const L = window.SuperLink && window.SuperLink.links ? window.SuperLink.links() : [], me = "node:" + n.id;
    const out = [];
    // a blank ■ shows: between it and another node the value flows into the ■, whichever end the wire began at
    const isSink = x => !!x && ((x.fn === "box" && !x.role) || (x.role === "text" && !!opOf(x.str)));
    const sink = h => isSink(h && h.startsWith("node:") && nodes.find(m => "node:" + m.id === h));
    const meSink = isSink(n);
    const inPort = "port:" + me + "/input";                      // the node's own input port (super/site.js): what is wired to it feeds the node
    // a Super AI super takes what is wired to any of its ports as an input (owner, 2026-10-12: which sparkle a
    // wire lands on is incidental when it is drawn by hand), except an operator super, which is its operation
    // (attachedOp), and the output of another Super AI super wired into *its* input (that flows the other way)
    const anyPort = n.role === "engine" ? "port:" + me + "/" : null;
    const otherPort = an => an && an.h && /^port:node:([^/]+)\/(\w+)$/.exec(an.h);
    const feeds = an => { const m = otherPort(an); if (!m) return true; const o = nodes.find(x => x.id === m[1]); return !(o && opOf((o.str || "").trim())) && m[2] !== "input"; };
    L.forEach(l => {
      if (l.a && l.a.h === inPort && l.b && !(l.b.h && l.b.h === me) && !sinkPort(l.b)) { out.push(l.b); return; }
      if (l.b && l.b.h === inPort && l.a && !(l.a.h && l.a.h === me) && !sinkPort(l.a)) { out.push(l.a); return; }
      if (anyPort) {
        // a wire from another super's sync or condition sparkle carries that super's result, as its output does
        const asOut = an => { const m = otherPort(an); return m && (m[2] === "sync" || m[2] === "condition") ? { h: "port:node:" + m[1] + "/output", el: 1 } : an; };
        // data flows from an output; between other sparkles, the way the wire was drawn (from its first end to its second)
        const mineA = l.a && l.a.h && l.a.h.startsWith(anyPort), src = mineA ? l.b : l.b && l.b.h && l.b.h.startsWith(anyPort) ? l.a : null;
        const fromOut = src && otherPort(src) && otherPort(src)[2] === "output";
        const lattice = src && src.h && src.h.startsWith("port:") && !src.h.startsWith("port:node:");   // the site's and the main super's ports: the lattice, not data (the central super's sync is π's clock)
        if (src && !lattice && (!mineA || fromOut) && !(src.h && (src.h === me || src.h.startsWith(anyPort))) && feeds(src)) { const o = asOut(src); if (!sinkPort(o)) { out.push(o); return; } }
      }
      const ah = l.a && l.a.h, bh = l.b && l.b.h;
      const other = ah === me ? bh : bh === me ? ah : null;
      if (other && other !== me && other.startsWith("node:") && meSink !== sink(other)) { if (meSink) out.push(ah === me ? l.b : l.a); return; }
      if (l.b && l.b.h === me && !(l.a && l.a.h === me)) out.push(l.a);
      else if (l.a && l.a.h === me && l.b && !(l.b.h && l.b.h.startsWith("node:"))) out.push(l.b);   // node → a number: the number still feeds it
    });
    return out;
  }
  const clip = t => t.length > 28 ? t.slice(0, 27) + "…" : t;
  const strOf = v => v.str != null && v.str !== "" ? v.str : v.text ? v.text : (v.isNum ? String(v.num) : "");   // an empty value is "", not "0"
  const N = v => ({ num: v, isNum: true, bool: !!v && !Number.isNaN(v), text: Number.isNaN(v) ? "NaN" : Number.isInteger(v) ? String(v) : v.toFixed(3) });
  // a word typed into a ■ or ● that names an operation
  const OPS = { x: "*", "×": "*", "*": "*", "·": "*", "+": "+", "-": "-", "−": "-", "–": "-", "/": "/", "÷": "/", ":": "/", "^": "^", "%": "%" };
  const opOf = t => { const k = String(t || "").trim().toLowerCase(); return OPS[k] || null; };
  function applyOp(op, xs) {
    if (!xs.length) return 0;
    return xs.slice(1).reduce((a, b) => op === "*" ? a * b : op === "+" ? a + b : op === "-" ? a - b : op === "/" ? a / b : op === "^" ? Math.pow(a, b) : a % b, xs[0]);
  }
  // what sits inside a loop's ring, and which of it is the result: the node nothing else inside takes from
  // a holder: a ■ grown past HOLD_AT is a super that holds supers, as a loop's ring does (super/nodes.css .is-holder)
  const HOLD_AT = 150;
  const isHolder = n => n && n.fn === "box" && !!n.hold && (n.size || 0) >= HOLD_AT && n.role !== "stop";   // sized up by you, not grown to show an answer
  function within(holder, m) {                                         // m sits inside the holder (clear of its curved corners)
    const r = holder.el.getBoundingClientRect(), b = m.el.getBoundingClientRect(), k = r.width * 0.06;
    return b.left >= r.left + k && b.right <= r.right - k && b.top >= r.top + k && b.bottom <= r.bottom - k;
  }
  function inside(loop) {
    if (isHolder(loop)) return nodes.filter(m => m !== loop && within(loop, m) && !(isHolder(m) && within(m, loop)));   // a locked super stays in the layer it is in: it moves with its holder
    const r = loop.el.getBoundingClientRect(), R = r.width / 2, cx = r.left + R, cy = r.top + r.height / 2;
    return nodes.filter(m => m !== loop && (() => { const b = m.el.getBoundingClientRect(); return Math.hypot(b.left + b.width / 2 - cx, b.top + b.height / 2 - cy) + Math.max(b.width, b.height) / 2 <= R + 4; })());
  }
  const locked = m => !!(window.SeLock && m && window.SeLock.isLocked(m.el));   // super/lock.js: a locked super is grouped into no other
  // the super holding m: a holder (a node), or any other super (a bubble, a window, the project; super/hold.js:
  // every super holds supers), as { el, dom: true }
  const holderOf = m => {
    if (locked(m)) return null;
    const h = nodes.filter(h => h !== m && isHolder(h) && within(h, m)).sort((a, b) => (a.size || 0) - (b.size || 0))[0];
    if (h) return h;
    const el = window.SeHold && window.SeHold.hostOf ? window.SeHold.hostOf(m.el) : null;
    return el && !el.classList.contains("lv-node") ? { el, dom: true } : null;
  };
  // a locked holder keeps what it holds: a super dragged out of it comes back inside
  function keepIn(h, m) {
    const r = h.el.getBoundingClientRect(), b = m.el.getBoundingClientRect(), k = r.width * 0.08;
    const x = Math.min(r.right - k - b.width, Math.max(r.left + k, b.left)), y = Math.min(r.bottom - k - b.height, Math.max(r.top + k, b.top));
    if (Math.abs(x - b.left) < 1 && Math.abs(y - b.top) < 1) return;
    const L = toLayout(x, y); m.fx = L.x / window.innerWidth; m.fy = L.y / window.innerHeight; place(m);
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
        if (n.role === "engine") {                     // the central super: the AI engines' answer to what is wired into its input
          const typed = (n.str || "").trim(), verb = VERBS[typed.toLowerCase()];   // a word typed into it: a verb acts on what is wired in, anything else is asked too
          const held = isHolder(n) ? bodyOut(n) : null;                    // a holder: what is inside it is part of its question
          const all = held ? ins.concat([evalNode(held)]) : ins;
          // what is computable is computed here, at once, and never sent to the engines:
          //   a number typed into it          it is that number
          //   an operator typed into it       that operation on the numbers wired in (2, 3 into + is 5)
          //   only numbers wired in, nothing typed: it says what they make ("2 + 3 = 5")
          const numOf = v => v.isNum ? v.num : (/^\s*-?\d+(?:[.,]\d+)?\s*$/.test(strOf(v)) ? +strOf(v).replace(",", ".") : NaN);
          const say1 = v => v.expr ? v.expr + " = " + strOf(v) : strOf(v);
          if (/^-?\d+(?:[.,]\d+)?$/.test(typed)) {
            const x = +typed.replace(",", "."); n.prompt = ""; n.answer = "";
            r = Object.assign(N(x), { str: typed, text: typed }); break;
          }
          // an operator super joined to this one, by a wire into it or by any of its ports (above, below,
          // beside): its operation works on this super's numbers (3 and 5 wired in, + attached: 8)
          const opIns = all.filter(v => opOf(strOf(v)) && !Number.isFinite(numOf(v)));
          let op = opOf(typed) || (opIns.length ? opOf(strOf(opIns[0])) : null) || attachedOp(n);   // an operator super attached at any port is its operation, whatever its label says
          const nums = all.filter(v => !opIns.includes(v));
          // the language's own engine (rust/superai, WebAssembly) decides what is computable and computes it;
          // the JavaScript below does the same until it has loaded
          const RS = window.SuperAI && window.SuperAI.rs;
          if (RS && RS.ready && !verb) {
            const out = RS.engine(typed, all.map(v => { const x = numOf(v); return Number.isFinite(x) ? x : strOf(v); }), attachedOp(n), "");
            if (out && out.kind === "bool") { n.prompt = ""; n.answer = ""; r = { num: out.value ? 1 : 0, isNum: true, bool: !!out.value, str: out.text, text: out.text }; break; }   // "<", "=", "and" …
            if (out && (out.kind === "number" || out.kind === "list")) {
              n.prompt = ""; n.answer = "";
              if (out.kind === "number") {
                const nv = N(out.value == null ? NaN : out.value), sym = op ? ({ "*": "×", "/": "÷" }[op] || op) : "";
                const parts = (opOf(typed) ? all : nums);
                r = Object.assign(nv, { str: nv.text, text: opOf(typed) ? typed : nv.text, expr: sym && parts.length > 1 ? parts.map(v => v.expr ? "(" + v.expr + ")" : strOf(v)).join(" " + sym + " ") : undefined });
              } else {
                const xs = (out.value || []).map(x => x && typeof x === "object" ? +x.value : +x);
                r = Object.assign(N(xs.reduce((a, b) => a + b, 0)), { str: out.text, text: out.text });
              }
              break;
            }
          }
          if (op && !opOf(typed) && nums.length && nums.every(v => Number.isFinite(numOf(v)))) {
            const sym = { "*": "×", "/": "÷" }[op] || op, val = applyOp(op, nums.map(numOf));
            n.prompt = ""; n.answer = "";
            r = Object.assign(N(val), { str: N(val).text, text: N(val).text, expr: nums.map(v => v.expr ? "(" + v.expr + ")" : strOf(v)).join(" " + sym + " ") }); break;
          }
          if (op && all.length && all.every(v => Number.isFinite(numOf(v)))) {
            const sym = { "*": "×", "/": "÷" }[op] || op, val = applyOp(op, all.map(numOf));
            n.prompt = ""; n.answer = "";
            r = Object.assign(N(val), { str: N(val).text, text: typed, expr: all.map(v => v.expr ? "(" + v.expr + ")" : strOf(v)).join(" " + sym + " ") }); break;
          }
          // only numbers wired in and nothing to compute: it shows them (a word typed into it is its label, not a
          // question, unless it ends with "?"; "math", "show result": the number)
          const label = !!typed && !verb && !/\?\s*$/.test(typed);
          if ((!typed || label) && !verb && all.length && all.every(v => Number.isFinite(numOf(v)))) {
            const text = all.map(v => N(numOf(v)).text).join(", "); n.prompt = ""; n.answer = "";   // simply the number (how it was made goes with questions)
            r = Object.assign(N(all.length === 1 ? numOf(all[0]) : all.reduce((a, v) => a + numOf(v), 0)), { str: text, text }); break;
          }
          // a question with things wired in: they go with it, numbers with how they were made
          const wired = all.map(say1).filter(Boolean);
          n.prompt = verb ? "" : (typed ? (wired.length ? typed + " (wired in: " + wired.join("; ") + ")" : typed) : wired.join(" ")).trim();
          if (!typed && VERBS[n.prompt.toLowerCase()]) n.prompt = "";       // a verb wired in (the "run" super) is an instruction, not a question
          const t = n.answer || "";
          const idle = n.held ? "held" : n.paused ? "paused" : (n.hint || (n.id === "site-box" ? "run" : "prompt"));   // the central super says run; a new Super AI super says prompt (owner, 2026-10-12)
          r = { num: t.length, bool: !n.held, str: t || typed || idle, text: t || (n.st.go ? "thinking…" : typed ? typed : n.prompt ? "thinking…" : idle) };
          // a Super AI super: the prompt is typed straight into it and the answer shows in it, wrapped (fitText)
          r.text = n.st.go ? "thinking…" : t || typed || idle;          // every engine super, the central one too
          if (n.id !== "site-box" && n.prompt && !t && !n.st.go && !connectedToRun(n)) r.text = typed || n.prompt;   // waits for a wire to run: it shows its question
          break;
        }
        const v = ins[ins.length - 1];
        const body = n.role === "loop" || (isHolder(n) && !n.field) ? bodyOut(n) : null;   // a loop or a holder gives what is inside it: its body's result
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
      const was = n.held; n.held = held.has(n.id) || !!n.portHeld;
      n.el.classList.toggle("is-held", n.held);
      if (n.held && !was && n.st.ctrl) n.st.ctrl.abort();
      if (n.held && n.st.timer) { clearTimeout(n.st.timer); n.st.timer = 0; }
    });
  }
  const wiredToPi = n => n.inputs.some(r => r.core || r.pi) || linkIns(n).some(an => an.loop || an.h === "pi");

  function tick() {
    const f = O().fit ? O().fit().f : 1;
    if (f !== lastFit) { lastFit = f; nodes.forEach(place); }           // the fit changed: every node to its scaled place
    memo = {}; visiting = {};
    holds();
    feedPorts();
    const now = performance.now();
    nodes.forEach(n => {
      const r = evalNode(n);
      const frozen = n.fn === "box" && (n.stopped || n.held);
      if (!frozen && n.text !== r.text) {
        n.text = r.text; n.changed = now;
        if ((n.fn === "box" || n.fn === "dot") && !n.field && n.role !== "stop") n.el.querySelector(".lv-glyph").textContent = n.role === "loop" ? "" : isHolder(n) && n.str ? n.str : r.text;   // a holder shows its own name   // holds its value inside
        else if (n.fn === "ask") n.el.querySelector(".lv-ans").textContent = r.text;
        else if (n.fn !== "super") n.val.textContent = r.text;
      }
      // a word typed into a super is what it does to what is wired into it: "open" (show) opens the window
      // or bubble wired in, "close" (hide) closes it, "pause" and "run" hold and release it, each time
      // the wiring changes (type "Open" into a ■, wire a bubble into it: its window opens)
      if ((n.fn === "box" || n.fn === "dot") && n.str && VERBS[n.str.trim().toLowerCase()]) {
        // every wire touching the node, its body or any of its ports, whichever way it was drawn: what is
        // at the other end (a bubble, a window, or one of their ports) is what the verb acts on
        const me = "node:" + n.id, mine = h => h === me || (h && h.startsWith("port:" + me + "/"));
        const touching = (window.SuperLink && window.SuperLink.links ? window.SuperLink.links() : []).map(l => mine(l.a && l.a.h) ? l.b : mine(l.b && l.b.h) ? l.a : null).filter(Boolean);
        const w = JSON.stringify([n.inputs, touching]);
        if (n.verbWiring !== undefined && w !== n.verbWiring && !n.held) {
          const verb = VERBS[n.str.trim().toLowerCase()];
          touching.concat(n.inputs).forEach(an => {
            const h = an.h || "";
            const key = an.key ? an.key : h.startsWith("k:") ? h.slice(2) : h.startsWith("w:") && O().keyOfTitle ? O().keyOfTitle(h.slice(2))
              : /^port:(bubble|win):/.test(h) ? h.replace(/^port:(bubble|win):/, "").replace(/\/\w+$/, "") : null;
            if (!key) return;
            const own = key.replace(/ group$/, "");
            if (verb === "open") { if (O().openKey && (O().openKey(own) || O().openKey(key))) say("Opened " + nameOf({ key: own })); }
            else if (verb === "close") { if (O().close && (O().close(own) || O().close(key))) say("Closed " + nameOf({ key: own })); }
            else if (verb === "pause" || verb === "run") { const el = O().elOf && O().elOf(own); if (el && el.classList.contains("orbit-panel")) el.classList.toggle("se-held", verb === "pause"); }
          });
        }
        n.verbWiring = w;
      }
      if (n.role === "engine") {                                         // the central super asks the engines whenever what is wired into it changes
        n.el.classList.toggle("is-thinking", !!n.st.go);
        const typing = n.id !== "site-box" && n.str && !n.st.commit;     // a Super AI super being typed into waits for Enter
        if (n.prompt && n.prompt !== n.st.asked && !n.st.go && !n.held && !n.st.timer && !typing) n.st.timer = setTimeout(() => { n.st.timer = 0; askEngine(n); }, 900);   // a new question: ask (once it has settled)
        // a Super AI super waiting for a wire to run: the moment it is connected, it asks; disconnected from run
        // again, what the wire did is undone: the run stops, the answer goes, its question shows (see unrun)
        if (n.st.unrun && !n.st.go && !n.st.timer && n.prompt && connectedToRun(n)) { n.st.unrun = false; n.st.timer = setTimeout(() => { n.st.timer = 0; askEngine(n); }, 300); }
        if (n.id !== "site-box" && (n.st.go || n.answer) && !n.st.unrun && n.st.asked && !connectedToRun(n)) unrunOne(n);
        if (!n.prompt && (n.answer || n.st.asked)) { n.answer = ""; n.st.asked = ""; persist(); }   // nothing wired in: back to its state
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
        const long = n.role !== "engine" && !isHolder(n) && (String(n.text || "").length > 28 || /\n/.test(n.text || ""));   // a holder keeps its shape: its text stays in its label strip
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
        n.el.classList.toggle("is-holder", isHolder(n));
        autoShape(n);
        fitText(n);
        n.el.classList.toggle("has-val", !!n.text && !n.field && n.role !== "stop" && n.role !== "loop");
        n.el.classList.toggle("is-on", n.role === "stop" && r.bool);       // its window is open
      }
      n.el.setAttribute("aria-label", BY[n.fn].name + " node" + (n.inputs.length ? ", wired to " + n.inputs.map(nameOf).join(" and ") : ", not wired") + ". " + (r.text ? "Value " + clip(String(r.text)) + "." : ""));
      if (!html.classList.contains("shape-se")) n.el.title = BY[n.fn].name;   // just its name; none in the superellipse look (a hover only lights)
    });
    drawWires();
  }

  // what is wired into the site's input and condition ports (super/site.js): any wire with the port at either end
  function feedPorts() {
    const S = window.SeSite, SL = window.SuperLink;
    if (!S || !SL || !SL.links) return;
    const into = pid => SL.links().map(l => (l.a && l.a.h === "port:" + pid) ? l.b : (l.b && l.b.h === "port:" + pid) ? l.a : null).filter(an => an && !sinkPort(an)).map(valueOfAnchor);
    const ins = into("input").concat(into("main/input"));                 // the main super's input is the page's question too
    S.setInput(ins.map(strOf).filter(Boolean).join(" "));
    const outs = into("output");                                          // the site's output: what is wired into it (the central engine)
    S.setOutput(outs.length ? outs.map(strOf).filter(Boolean).join(" ") : null);
    const cond = into("condition").concat(into("main/condition"));        // wired false, the main super's condition pauses the page
    S.setCondition(cond.length ? cond.every(v => v.bool) : null);
    // every other super's ports: windows (super/site.js takes them) and loops (here)
    (S.portIds ? S.portIds() : []).forEach(pid => {
      if (!pid.includes("/")) return;
      const [owner, port] = pid.split("/");
      if (port === "output" || owner === "main" && port !== "input") return;
      const vals = into(pid);
      if (owner.startsWith("node:")) feedNode(owner.slice(5), port, vals.length ? vals : null);
      else if (S.setPortInput) S.setPortInput(owner, port, vals.length ? vals : null);
    });
  }
  // a node's or a window's port that takes (input, sync, condition) never feeds the other end; the site's own
  // ports are its terminals both ways (from inside, its input and its clock are read, its output is fed)
  const sinkPort = an => !!(an && an.h && /^port:.+\/(input|sync|condition)$/.test(an.h));
  // a loop's ports: input sets its count, sync steps it on every change of what is wired in (the clock
  // then is that, not the second), condition false pauses it; its output is read by loopPort
  function feedNode(id, port, vals) {
    const n = nodes.find(x => x.id === id); if (!n) return;
    const st = n.ports || (n.ports = { input: null, sync: null, cond: null });
    if (n.role !== "loop") {                                       // any other node: input feeds it (linkIns), sync re-asks or refreshes it, condition holds it
      if (port === "sync") {
        const key = vals ? vals.map(x => x && x.str).join("|") : null;
        const was = st.sync; st.sync = key;
        if (key !== null && was !== null && key !== was && !n.held) {
          n.changed = performance.now();
          if ((n.fn === "super" || n.fn === "ask") && n.prompt) { clearTimeout(n.st.timer); n.st.timer = setTimeout(() => (n.fn === "ask" ? askPanel(n) : askEngine(n)), 300); }
        }
      } else if (port === "condition") {
        const held = vals ? !vals.every(x => x && x.bool) : null;
        if (held !== st.cond) { st.cond = held; n.portHeld = !!held; }
      }
      return;
    }
    if (port === "input") {
      const v = vals ? vals.find(x => x && x.isNum) : null, k = v ? v.num : null;
      if (k !== st.input) { st.input = k; if (k !== null) n.i = Math.round(k); }
    } else if (port === "sync") {
      const key = vals ? vals.map(x => x && x.str).join("|") : null;
      const was = st.sync; st.sync = key;
      n.clocked = key !== null;
      if (key !== null && was !== null && key !== was && !n.paused && !n.held) n.i = (n.i || 0) + 1;
    } else if (port === "condition") {
      const held = vals ? !vals.every(x => x && x.bool) : null;
      if (held !== st.cond) { st.cond = held; if (held !== null) n.paused = held; }
    }
  }
  function loopPort(id, port) {                                  // any node's port as a value
    const n = nodes.find(x => x.id === id); if (!n) return ZERO;
    if (port === "output") return evalNode(n);
    const st = n.ports || {};
    if (n.role !== "loop") {
      if (port === "input") { const v = linkIns(n).map(valueOfAnchor); const t = v.map(strOf).filter(Boolean).join(" "); return { num: v.length ? v[0].num : 0, isNum: !!(v[0] && v[0].isNum), bool: v.some(x => x.bool), str: t, text: t }; }
      if (port === "sync") { const v = n.changed ? 1 : 0; return { num: v, isNum: true, bool: !n.held, str: String(v), text: String(v) }; }
      return { num: n.held ? 0 : 1, isNum: true, bool: !n.held, str: n.held ? "held" : "running", text: n.held ? "held" : "running" };
    }
    if (port === "input") { const v = st.input; return v == null ? ZERO : { num: v, isNum: true, bool: true, str: String(v), text: String(v) }; }
    if (port === "sync") { const v = n.i || 0; return { num: v, isNum: true, bool: !n.paused, str: String(v), text: String(v) }; }
    return { num: n.paused ? 0 : 1, isNum: true, bool: !n.paused, str: n.paused ? "paused" : "running", text: n.paused ? "paused" : "running" };
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
        const d = se() && window.SeMorph.wire ? window.SeMorph.wire(sx, cy, tx, ty, Math.abs(ty - cy) <= 1.5 * Math.abs(tx - sx))   // from above or below: the curvy kind
          : "M" + sx + "," + cy + "C" + (sx + sg * c) + "," + cy + " " + (tx - c) + "," + ty + " " + tx + "," + ty;
        const src2 = ref.node && nodes.find(x => x.id === ref.node);
        const live = now - (n.changed || 0) < 1200 || (src2 && now - (src2.changed || 0) < 1200) || n.el.classList.contains("is-running");
        s += '<g class="wire' + (live ? " live" : "") + '"><path class="wire-bed" d="' + d + '"/><path class="wire-flow" d="' + d + '"/>' +
             term(sx, cy, "wire-term") + term(tx, ty, "wire-term") +
             '<path class="wire-hit" data-node="' + n.id + '" data-i="' + idx + '" d="' + d + '"><title>Click to disconnect</title></path></g>';
      });
    });
    if (html.classList.contains("shape-se")) s = s.replace(/<title>[\s\S]*?<\/title>/g, "");   // superellipse look: no tooltips on wires (a hover only lights)
    if (s !== wires.dataset.last) {                                     // unchanged wires stay, so a click lands
      wires.dataset.last = s; wires.innerHTML = s;
      if (pickedWire) wires.querySelectorAll(".wire-hit").forEach(h => h.parentElement.classList.toggle("is-sel", h.dataset.node + "/" + h.dataset.i === pickedWire));
    }
  }

  // ---- making, moving and removing nodes -------------------------------
  function persist() { save("lv:nodes", nodes.map(n => ({ id: n.id, fn: n.fn, fx: n.fx, fy: n.fy, inputs: n.inputs, answer: (n.fn === "super" || n.fn === "ask" || n.role === "engine") && n.answer ? n.answer.slice(0, 3000) : undefined, str: n.str || undefined, role: n.role || undefined, target: n.target, targetTitle: n.targetTitle, size: n.size, n: n.n, hint: n.hint || undefined, hold: n.hold || undefined, aspect: n.aspect || undefined, use: n.use || undefined, manual: n.manual || undefined }))); }
  // nodes are scaled about the page's centre by the fit (orbit.js setFit): a screen point, in layout units
  function toLayout(sx, sy) {
    const F = O().fit ? O().fit() : { f: 1, px: window.innerWidth / 2, py: window.innerHeight / 2 };
    const f = F.f || 1;
    return { x: F.px + (sx - F.px) / f, y: F.py + (sy - F.py) / f, f };
  }
  // a node sits at its layout point (fx, fy), scaled about the page's centre by the fit like everything
  // else; the scale is applied here, from the node's own corner, so moving it never moves its pivot
  let lastFit = 1;
  function place(n) {
    const w = n.el.offsetWidth || 44, h = n.el.offsetHeight || 32;
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, n.fx * window.innerWidth));
    const y = Math.max(4, Math.min(window.innerHeight - h - 22, (n._gy != null ? n._gy : n.fy) * window.innerHeight));
    const F = O().fit ? O().fit() : null, f = F ? F.f || 1 : 1;
    if (F && f !== 1) {
      n.el.style.left = (F.px + (x - F.px) * f).toFixed(1) + "px"; n.el.style.top = (F.py + (y - F.py) * f).toFixed(1) + "px";
      n.el.style.transformOrigin = "0 0"; n.el.style.scale = String(f);
    } else { n.el.style.left = x + "px"; n.el.style.top = y + "px"; n.el.style.scale = ""; n.el.style.transformOrigin = ""; }
  }
  function make(spec) {
    const f = BY[RENAMED[spec.fn] || spec.fn];
    if (!f) return null;
    const el = document.createElement("div");
    el.setAttribute("role", "button"); el.tabIndex = 0;
    el.className = "lv-node lv-fn lv-" + f.k;
    el.dataset.id = spec.id;
    const g = document.createElement("span"); g.className = "lv-glyph"; glyph(g, f);
    textZoom(el, g);
    const val = document.createElement("span"); val.className = "lv-val"; val.setAttribute("aria-hidden", "true");
    el.append(g, val);
    // four port sparkles drawn on the super itself, for the round look (in the superellipse look super/site.js places live ports)
    el.insertAdjacentHTML("beforeend", '<i class="lv-sp lv-sp-l" aria-hidden="true"></i><i class="lv-sp lv-sp-r" aria-hidden="true"></i><i class="lv-sp lv-sp-t" aria-hidden="true"></i><i class="lv-sp lv-sp-b" aria-hidden="true"></i>' +
      // a holder's grip: its edge (and its label), the only parts of it that take the pointer, so what it holds
      // (bubbles, the project, other supers) stays reachable through it (super/nodes.css .lv-edge)
      '<i class="lv-edge lv-edge-t" aria-hidden="true"></i><i class="lv-edge lv-edge-b" aria-hidden="true"></i><i class="lv-edge lv-edge-l" aria-hidden="true"></i><i class="lv-edge lv-edge-r" aria-hidden="true"></i>');
    const n = { id: spec.id, fn: f.k, fx: spec.fx, fy: spec.fy, inputs: (spec.inputs || []).slice(0, f.n), st: {}, el, val, text: "" };
    n.str = spec.str || "";
    n.n = +spec.n || nOfFn[f.k];
    shape(n);
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
    n.role = spec.role || null; n.target = spec.target; n.targetTitle = spec.targetTitle; n.size = spec.size; n.i = 0; n.hint = spec.hint || ""; n.hold = !!spec.hold; n.use = +spec.use || 0; n.manual = !!spec.manual; n.aspect = +spec.aspect || 0;   // aspect: height over width (a holder laid out as a box, not a square)
    if ((f.k === "box" || f.k === "dot") && (n.role === "text" || n.role === "int")) { n.field = field("lv-in", "", n.role === "int" ? "Integer" : "Text"); g.replaceWith(n.field); }
    if (f.k === "box" || f.k === "dot") { if (!n.field) g.textContent = ""; }   // blank: the shape alone
    if (f.k === "ask") {
      n.answer = spec.answer || "";
      const q = field("lv-q", "", "Ask a question, then press Enter");
      q.addEventListener("blur", () => setTimeout(() => tick(), 0));       // an empty question folds away again
      const ans = document.createElement("div"); ans.className = "lv-ans"; ans.textContent = n.answer;
      g.after(q); el.appendChild(ans);
    }
    if (f.k === "super") { g.textContent = ""; n.st.sn = G(); n.st.t = 0; n.answer = spec.answer || ""; }   // the shape itself is the diamond
    if (f.k === "add") g.textContent = "";
    if (!n.size && n.role === "engine") n.size = ENGINE_BASE;            // run and prompt: bigger than a number or an operator (owner, 2026-10-12)
    if (n.size) sizeDot(n, n.size);
    canvas.appendChild(el);
    nodes.push(n);
    place(n);
    wireNode(n);
    return n;
  }
  // the node's shape: a whole superellipse at its n (CSS corner-shape; a clipped polygon where that is missing)
  const hasCorner = typeof CSS !== "undefined" && CSS.supports && CSS.supports("corner-shape", "round");
  function shape(n) {
    n.el.style.setProperty("--lv-k", Math.log2(n.n).toFixed(4));
    n.el.dataset.n = n.n.toFixed(3);
    if (!hasCorner && window.SeMorph) { const s = n.size || DOT_BASE; n.el.style.clipPath = "path('" + window.SeMorph.star(s / 2, s / 2, s / 2, s / 2, n.n) + "')"; }
  }
  // A ■'s n follows its size and its use, inside the ■ band (2.6–5, so it stays what it is): small and new
  // it is soft (n ≈ 2.8), bigger it is boxier (a holder reaches ≈ 4), and each use firms it a little more
  // (up to +0.8). Changed by hand (Shift + scroll, or a scroll on its ring) it keeps the n you gave it.
  function autoN(n) {
    const s = Math.max(0, Math.min(1, ((n.size || DOT_BASE) - DOT_BASE) / 340));
    const u = 1 - Math.exp(-(n.use || 0) / 8);
    return Math.max(2.7, Math.min(4.9, 2.8 + 1.3 * s * (2 - s) + 0.8 * u));
  }
  function used(n, k) { n.use = (n.use || 0) + (k || 1); clearTimeout(n.st.ut); n.st.ut = setTimeout(persist, 800); }
  function autoShape(n) {
    if (n.fn !== "box" || n.manual || n.role === "stop") return;
    const want = autoN(n);
    if (Math.abs(want - n.n) < 0.02) return;
    n.n = n.n + (want - n.n) * 0.35;                                   // eases toward it over a few ticks
    if (Math.abs(want - n.n) < 0.02) n.n = want;
    shape(n);
  }
  // shift + scroll on a node: its n, and with it what it is (the same node, same id, same wires)
  function reshape(n, dy) {
    n.manual = true;                                                   // your n: it no longer follows size and use
    const S = window.SeShape;
    const nn = S ? S.step("node:" + n.id, n.n, dy, 0.3, 12) : Math.max(0.3, Math.min(12, (n.st.nTo || n.n) * Math.exp(-dy * 0.002)));
    n.st.nTo = nn;
    if (S) S.at(nn);
    const fn = fnOfN(nn);
    // a Super AI super or a holder keeps what it is (its role, hint, members, transparency): only its shape changes
    if (fn !== n.fn && n.role !== "engine" && !n.hold) {             // across a band: it becomes that function
      const spec = { id: n.id, fn, fx: n.fx, fy: n.fy, inputs: n.inputs, n: nn, size: n.size, str: n.str, answer: n.answer, use: n.use, manual: true };
      const i = nodes.indexOf(n); n.el.remove(); nodes.splice(i, 1);
      const m = make(spec); m.st.nTo = nn; say(BY[fn].name + " now"); persist(); tick(); return;
    }
    if (window.SeMotion) { const s = { v: n.n }; window.SeMotion.glide("shape:" + n.id, s, "v", nn, 160, () => { n.n = s.v; shape(n); }); }
    else { n.n = nn; shape(n); }
    clearTimeout(n.st.pt); n.st.pt = setTimeout(persist, 300);
  }
  // a click on bare page (no window open) makes a node there, in a random super shape
  function spawnAt(x, y, ai) {
    const nn = +Math.PI.toFixed(3), id = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);   // a click makes a super: a ■ at n = π, like everything else
    const L = toLayout(x, y);
    // ai: a Super AI super, the same as the central one (role "engine"), asking every engine, the lab's and outside
    const m = make({ id, fn: fnOfN(nn), role: ai ? "engine" : undefined, fx: (L.x - (ai ? ENGINE_BASE : DOT_BASE) / 2) / window.innerWidth, fy: (L.y - (ai ? ENGINE_BASE : DOT_BASE) / 2) / window.innerHeight, inputs: [], n: nn });
    if (!holderOf(m)) clear(m);                                        // made inside a super: it stays where it was made
    persist(); tick();
    say(ai ? "Super AI made: type a question and press Enter, and every engine answers; press it to see each answer"
           : BY[m.fn].name + " made: a super with four ports; hold shift + scroll to change its shape, type into it, wire it");
    if (ai && window.SeSelect && window.SeSelect.select) window.SeSelect.select(m.el);
    setTimeout(() => m.el.focus({ preventScroll: true }), 60);
    return m;
  }
  // ---- the program's diagram ---------------------------------------------------------------------
  // A first visit lays out SuperAI.program.diagram: each super where its "at" says, then its wires
  // ("super.port" to "super.port"; "site" is the inner super) as SuperLink port wires.
  // round: the round look (production's pitechlab.com), which has no inner super and no ports on the page:
  // only the supers marked everywhere (the first supers a visitor sees) and the wires between them
  function layoutProgram(round) {
    const all = window.SuperAI && window.SuperAI.program && window.SuperAI.program.diagram;
    if (!all) return;
    const keep = s => (!round || s.everywhere) && !(s.desktop && window.innerWidth < 700);
    const ids = new Set((all.supers || []).filter(keep).map(s => s.id));
    const who = e => String(e).slice(0, String(e).lastIndexOf("."));
    const known = e => ids.has(who(e)) || who(e) === "site" || (!round && (who(e) === "main" || who(e) === "title" || who(e).startsWith("bubble:")));   // the title and bubble wires: the superellipse look (supers there)
    const prog = { supers: (all.supers || []).filter(keep), wires: (all.wires || []).filter(w => w.every(known)) };
    if (!prog.supers.length) return;
    const Wv = window.innerWidth, Hv = window.innerHeight, done = {};
    const sb = O().siteBox ? O().siteBox() : null;
    const K = Wv < 700 ? 0.72 : 1;                                   // a phone: the first supers smaller and closer
    const portXY = name => {                                        // a port of the inner super, on screen
      if (!sb) return [Wv / 2, Hv / 2];
      return name === "input" ? [sb.cx - sb.a, sb.cy] : name === "output" ? [sb.cx + sb.a, sb.cy] : name === "sync" ? [sb.cx, sb.cy - sb.b] : [sb.cx, sb.cy + sb.b];
    };
    const where = s => {
      const size = s.size ? Math.round(s.size * K) : s.kind === "engine" ? ENGINE_BASE : DOT_BASE, at = s.at || {};
      if (at.inSite && sb) { const [x0, y0] = at.inSite; return [sb.cx - sb.a + x0 * 2 * sb.a, sb.cy - sb.b + y0 * 2 * sb.b]; }   // shares of the inner super, from its top-left
      if (at.center) return [(Wv - size) / 2, (Hv - size) / 2];
      if (at.from && done[at.from]) return [done[at.from][0] + (at.dx || 0) * K, done[at.from][1] + (at.dy || 0) * K];
      if (at.leftOf) { const p = portXY(String(at.leftOf).split(".")[1]); return [Math.max(4, p[0] - size - 10), p[1] + (at.dy || 0)]; }
      if (at.rightOf) { const p = portXY(String(at.rightOf).split(".")[1]); return [Math.min(Wv - size - 4, p[0] + 10), p[1] + (at.dy || 0)]; }
      return [(at.fx || 0) * Wv, (at.fy || 0) * Hv];
    };
    (prog.supers || []).forEach(s => {
      if (s.at && s.at.inSite && sb) {                                // sized as shares of the inner super: [x0, y0, x1, y1]
        const [x0, y0, x1, y1] = s.at.inSite, w = (x1 - x0) * 2 * sb.a, h = (y1 - y0) * 2 * sb.b;
        s = Object.assign({}, s, { size: Math.round(w / K), aspect: h / w });
      }
      const xy = where(s); done[s.id] = xy;
      if (nodes.some(x => x.id === s.id)) return;                     // already on the page (a diagram kept from the round look)
      if (s.locked) { try { if (localStorage.getItem("se:lock:node:" + s.id) == null) localStorage.setItem("se:lock:node:" + s.id, "1"); } catch (_) { /* private mode */ } }   // starts locked (super/lock.js reads it)
      make({ id: s.id, fn: s.kind === "engine" || s.kind === "box" || !s.kind ? "box" : s.kind, role: s.kind === "engine" ? "engine" : undefined,
             str: s.text || undefined, hint: s.hint || undefined, size: s.size ? Math.round(s.size * K) : undefined, hold: !!s.hold, aspect: s.aspect || undefined, manual: !!s.n, fx: xy[0] / Wv, fy: xy[1] / Hv, inputs: [], n: s.n || Math.PI });   // s.n: its own shape, kept
    });
    wireUp(prog.wires || []);
    save("lv:start-wired", 1); save("lv:side-wired", 1); save("lv:intro-gone", 1);   // today's start: nothing of the old intro to clear (else the hint super, id shift, went at the next load)
    persist();
  }
  // A program's wire end ("super.port") as a SuperLink anchor: "site.port" is the inner super's port, "main.port"
  // the main super's, "title.output" the title super's edge, "bubble:Title.port" a bubble's (its ports are
  // "bubble:<key>/<port>", super/site.js; found by its label), anything else a super's ("node:<id>/<port>").
  // null when the bubble is not on the page (yet).
  function anchorOf(e) {
    const s = String(e), i = s.lastIndexOf("."), w = s.slice(0, i), port = s.slice(i + 1);
    if (w === "site") return { h: "port:" + port, el: 1 };
    if (w === "main") return { h: "port:main/" + port, el: 1 };
    if (w === "title") return { h: "title", el: 1 };
    if (w.startsWith("bubble:")) {
      const b = [...document.querySelectorAll(".orbit-bubble.is-group[data-key]")].find(x => ((x.querySelector(":scope > .ob-label") || {}).textContent || "").trim() === w.slice(7));
      return b ? { h: "port:bubble:" + b.dataset.key + "/" + port, el: 1 } : null;
    }
    return nodes.some(x => x.id === w) ? { h: "port:node:" + w + "/" + port, el: 1 } : null;
  }
  // adds a program's wires once their ends are on the page (the bubbles may be built a little later)
  function wireUp(list, tries) {
    const SL = window.SuperLink; if (!SL || !SL.add) return setTimeout(() => wireUp(list, tries), 100);
    const left = list.filter(([a, b]) => { const A = anchorOf(a), B = anchorOf(b); if (A && B) { SL.add(A, B); return false; } return true; });
    if (left.length && (tries || 0) < 30) setTimeout(() => wireUp(left, (tries || 0) + 1), 200);
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
    let x = r.right + 28, y;
    if (x + w > window.innerWidth - 4) x = r.left - w - 28;
    if (el.matches(".orbit-panel")) { x = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w - 16)); y = r.top + 8; }
    else y = r.top + r.height / 2 - h / 2;
    const L = toLayout(Math.max(4, x), y);                              // screen → layout, since the node is scaled by the fit
    n.fx = L.x / window.innerWidth; n.fy = L.y / window.innerHeight;
    place(n);
    clear(n);
  }
  // step down until it overlaps no other node (two nodes wired to the same thing would sit on each other)
  function lockNote(e) { if (window.SeShape && window.SeShape.note) window.SeShape.note(e.clientX, e.clientY, "locked", "unlock it to move it"); }
  function clear(n) {
    if (locked(n)) return;                                               // locked: it keeps its place, nothing moves it off
    if (n.role === "loop" || isHolder(n) || holderOf(n)) return;         // a loop or a holder holds things, and what is inside stays
    if (n.id === "site-box") return;                                      // the central super is the diagram's centre: it stays (Live opens over it)
    n._gy = null; const fy0 = n.fy;
    stepOff(n);
    // it glides to where it steps off to, never jumps (owner, 2026-10-12: no sudden movement); its wires follow
    if (n.fy !== fy0 && window.SeMotion) {
      const s = { v: fy0 };                                             // n.fy is already where it goes (saved as such); only the drawing glides
      n._gy = fy0; place(n);
      window.SeMotion.tween(s, { v: n.fy }, { duration: 360, easing: "easeOutCubic", update: () => { n._gy = s.v; place(n); document.dispatchEvent(new CustomEvent("se:frame")); }, complete: () => { n._gy = null; place(n); document.dispatchEvent(new CustomEvent("se:frame")); } });
    }
  }
  function stepOff(n) {
    for (let k = 0; k < 8; k++) {
      const a = n.el.getBoundingClientRect();
      const over = b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const hit = nodes.find(o => o !== n && o.role !== "loop" && !(isHolder(o) && within(o, n)) && !(isHolder(n) && within(n, o)) && over(o.el.getBoundingClientRect()));
      // nothing overlaps unless it is inside a super: the project super, the title and Live are in the way too
      const fixed = !hit && [...document.querySelectorAll(".se-project:not(.is-open), .orbit-title, .live-tab, .live-dock.open .live-body")].find(el => el.getClientRects().length && over(el.getBoundingClientRect()));
      if (!hit && !fixed) return;
      const b = hit ? hit.el.getBoundingClientRect() : fixed.getBoundingClientRect();
      n.fy = Math.min(window.innerHeight - a.height - 22, b.bottom + 4) / window.innerHeight; place(n);   // just clear of it: supers almost touch
      if (b.bottom + 4 + a.height > window.innerHeight - 22) return;
    }
  }

  // one drag, from the palette or of a node on the page
  function drag(e, startEl, spawn) {
    if (e.button !== undefined && e.button !== 0) return;
    // a locked super keeps its place (owner, 2026-10-12: "locking a super also keeps it in place and in its layer"):
    // it is not dragged (its words still wire, its lock still unlocks)
    if (!spawn && startEl && window.SeLock && window.SeLock.isLocked(startEl)) { lockNote(e); return; }
    const x0 = e.clientX, y0 = e.clientY;
    let n = spawn ? null : nodes.find(x => x.el === startEl), moved = false, dx = 0, dy = 0;
    if (n) { const r = n.el.getBoundingClientRect(), f = toLayout(0, 0).f; dx = (x0 - r.left) / f; dy = (y0 - r.top) / f; }
    try { startEl.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    const move = ev => {
      if (ev.pointerId !== e.pointerId || (n && n.st.pinch)) return;     // a second finger zooms, it does not drag
      if (!moved && (html.classList.contains("sl-armed") || html.classList.contains("sl-dragging"))) return;   // held on its words: that drag is a wire
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moved) {
        moved = true;
        if (n) n.st.from = holderOf(n);                                     // the holder it came out of (a locked one takes it back)
        if (n && isHolder(n)) {
          n.st.crew = inside(n).map(m => ({ m, fx: m.fx, fy: m.fy }));   // what it holds moves with it
          if (window.SeHold) window.SeHold.begin(n.el, { nodes: false });   // the bubbles, windows and the project it holds too (super/hold.js)
        }
        if (spawn) { n = make({ id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), fn: spawn.k, fx: 0, fy: 0, inputs: [] }); dx = n.el.offsetWidth / 2; dy = n.el.offsetHeight / 2; }
        n.el.classList.add("is-dragging"); dragging = n;
        html.classList.add("lv-dragging");
      }
      const L = toLayout(ev.clientX, ev.clientY);
      const fx0 = n.fx, fy0 = n.fy;
      n.fx = (L.x - dx) / window.innerWidth; n.fy = (L.y - dy) / window.innerHeight;
      place(n);
      if (n.st.crew) n.st.crew.forEach(c => { c.m.fx += n.fx - fx0; c.m.fy += n.fy - fy0; place(c.m); });
      if (n.st.crew && window.SeHold) window.SeHold.follow(n.el);
      const t = targetAt(ev.clientX, ev.clientY, n.el);
      document.querySelectorAll(".lv-hover").forEach(x => x.classList.remove("lv-hover"));
      if (t && t.el) t.el.classList.add("lv-hover");
      if (pal) pal.classList.toggle("lv-bin", !!(t && t.palette) && !spawn);
      drawWires();
      ev.preventDefault();
    };
    const up = ev => {
      startEl.removeEventListener("pointermove", move);
      startEl.removeEventListener("pointerup", up);
      startEl.removeEventListener("pointercancel", up);
      document.querySelectorAll(".lv-hover").forEach(x => x.classList.remove("lv-hover"));
      if (pal) pal.classList.remove("lv-bin");
      html.classList.remove("lv-dragging");
      if (n && n.st.pinched) { n.st.pinched = false; n.el.classList.remove("is-dragging"); dragging = null; startEl.dataset.dragged = "1"; setTimeout(() => { delete startEl.dataset.dragged; }, 350); persist(); return; }
      if (!moved) return;
      startEl.dataset.dragged = "1"; setTimeout(() => { delete startEl.dataset.dragged; }, 350);
      n.el.classList.remove("is-dragging"); dragging = null;
      if (n.st.from && locked(n.st.from) && n.st.from.el.isConnected && !within(n.st.from, n)) { keepIn(n.st.from, n); n.st.from = null; persist(); tick(); say("It stays: its holder is locked"); return; }
      n.st.from = null;
      // dropped outside the inner super, the second super, it is deleted on purpose (owner, 2026-10-12), wires and
      // all; a holder takes what it holds with it (never the central super, which comes back inside)
      if (ev.type === "pointerup" && se() && window.SeSite && window.SeSite.inSite && !window.SeSite.inSite(ev.clientX, ev.clientY)) {
        if (n.id === "site-box") {                                      // the central super comes back to the middle
          n.st.crew = null; if (window.SeHold) window.SeHold.end(n.el);
          const sb = O().siteBox ? O().siteBox() : null, f = sb ? (sb.fit || 1) : 1;
          if (sb) { const cx = sb.px + (sb.cx - sb.px) * f, cy = sb.py + (sb.cy - sb.py) * f, L = toLayout(cx, cy), r = n.el.getBoundingClientRect(); n.fx = (L.x - r.width / 2) / window.innerWidth; n.fy = (L.y - r.height / 2) / window.innerHeight; place(n); }
          persist(); tick(); say("run stays inside the site"); return;
        }
        const crew = n.st.crew ? n.st.crew.map(c => c.m) : [];
        n.st.crew = null; if (window.SeHold) window.SeHold.end(n.el);
        crew.forEach(remove); remove(n);
        say((BY[n.fn].name) + " deleted: dropped outside the site" + (crew.length ? ", with what it held" : ""));
        return;
      }
      if (n.st.crew) { n.st.crew = null; if (window.SeHold) window.SeHold.end(n.el); persist(); tick(); return; }    // a holder moved with what it holds: nothing to wire
      // a locked super goes into no other super (super/lock.js): dropped on a holder, it sits beside it, unwired
      if (locked(n)) {
        const h = nodes.filter(x => x !== n && isHolder(x)).find(x => { const r = x.el.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; });
        if (h) {
          const r = h.el.getBoundingClientRect(), b = n.el.getBoundingClientRect();
          const left = ev.clientX - r.left, right = r.right - ev.clientX, top = ev.clientY - r.top, bottom = r.bottom - ev.clientY, m = Math.min(left, right, top, bottom);
          const x = m === left ? r.left - b.width - 12 : m === right ? r.right + 12 : b.left, y = m === top ? r.top - b.height - 12 : m === bottom ? r.bottom + 12 : b.top;
          const L = toLayout(x, y); n.fx = L.x / window.innerWidth; n.fy = L.y / window.innerHeight; place(n); clear(n);
          persist(); tick(); say("It is locked: it goes into no other super"); return;
        }
      }
      const t = ev.type === "pointerup" ? targetAt(ev.clientX, ev.clientY, n.el) : null;
      // a super dropped on another super (not a holder: that is where it goes in) wires its output into the
      // other's input and sits down beside it, wherever on it it lands (its words, its value, its body)
      if (ev.type === "pointerup" && n.role && window.SuperLink && window.SuperLink.add) {
        const ontoEl = under(n, ev.clientX, ev.clientY).map(e => e.closest && e.closest(".lv-node")).find(e => e && e !== n.el);
        const other = ontoEl && nodes.find(x => x.el === ontoEl);
        if (other && !isHolder(other)) {
          window.SuperLink.add({ h: "port:node:" + n.id + "/output", el: 1 }, { h: "port:node:" + other.id + "/input", el: 1 });
          used(n); used(other);
          const home = holderOf(other);                                 // wired inside a holder: it stays inside it
          beside(n, ontoEl, ev.clientX, ev.clientY);
          if (home && !within(home, n)) {
            const r = home.el.getBoundingClientRect(), k = r.width * 0.08, w = n.el.offsetWidth, h = n.el.offsetHeight, b = n.el.getBoundingClientRect();
            const x = Math.max(r.left + k, Math.min(r.right - k - w, b.left)), y = Math.max(r.top + k + r.height * 0.12, Math.min(r.bottom - k - h, b.top));
            const L = toLayout(x, y); n.fx = L.x / window.innerWidth; n.fy = L.y / window.innerHeight; place(n);
          }
          say((n.str || BY[n.fn].name) + " wired into " + (other.str || BY[other.fn].name)); persist(); tick(); return;
        }
      }
      // dropped into a holder, on nothing in it (no super, port or word to wire to): it just stays there
      const into = holderOf(n);
      if (into && ev.type === "pointerup" && (!t || (t.el && t.el === into.el))) { place(n); persist(); tick(); say(BY[n.fn].name + " is now inside a super"); return; }
      if (t && t.palette) { remove(n); say(BY[n.fn].name + " node removed"); return; }
      if (n.fn === "box" && !n.role && ev.type === "pointerup" && boxGuess(n, ev.clientX, ev.clientY)) { persist(); tick(); return; }   // a blank ■ only: a super is never used up as an eraser
      if (n.fn === "ask" && ev.type === "pointerup" && askGuess(n, ev.clientX, ev.clientY, t)) { persist(); tick(); return; }
      if (t && t.text && BY[n.fn].n && !((n.fn === "box" || n.fn === "dot") && n.role) && window.SuperLink && window.SuperLink.add) {
        window.SuperLink.add(t.text, { h: "node:" + n.id, el: 1 });
        const w = n.el.offsetWidth, h = n.el.offsetHeight;
        let x = t.rect.right + 28; if (x + w > window.innerWidth - 4) x = t.rect.left - w - 28;
        n.fx = Math.max(4, x) / window.innerWidth; n.fy = (t.rect.top + t.rect.height / 2 - h / 2) / window.innerHeight; place(n); clear(n);
        say(BY[n.fn].name + " wired to “" + t.text.t + "”"); persist(); tick(); return;
      }
      if (t && t.el && t.el.matches(".se-port") && window.SuperLink && window.SuperLink.add) {
        const port = t.el.dataset.port, pid = t.el.dataset.pid || port, owned = pid.includes("/");
        const sink = port === "input" || port === "condition" || (owned && port === "sync");   // the site's sync is its clock (a source); every other sync takes a clock
        const me = { h: "node:" + n.id, el: 1 }, pa = { h: "port:" + pid, el: 1 };
        window.SuperLink.add(sink ? me : pa, sink ? pa : me);
        beside(n, t.el, ev.clientX, ev.clientY); say(BY[n.fn].name + (sink ? " feeds " : " takes from ") + nameOf({ port: pid })); persist(); tick(); return;
      }
      if (t && t.el && BY[n.fn].n) {
        const ref = refOf(t.el);
        // a super dropped on another super wires its output into the other's input, and sits down beside it
        const onto = t.el.closest && t.el.closest(".lv-node");
        if (onto && onto !== n.el && n.role && window.SuperLink && window.SuperLink.add) {
          const other = nodes.find(x => x.el === onto);
          if (other) {
            window.SuperLink.add({ h: "port:node:" + n.id + "/output", el: 1 }, { h: "port:node:" + other.id + "/input", el: 1 });
            beside(n, onto, ev.clientX, ev.clientY);
            say(BY[n.fn].name + " wired into " + (other.str || BY[other.fn].name)); persist(); tick(); return;
          }
        }
        if ((n.fn === "box" || n.fn === "dot") && n.role) { place(n); clear(n); persist(); tick(); return; }   // it already is something: just moved
        attach(n, ref);
        if (n.fn === "add" && n.inputs.length === 1 && ref.key) setTimeout(() => signOn(n, ref, t.el), 0);
        if (n.inputs.some(r => same(r, ref))) { beside(n, t.el, ev.clientX, ev.clientY); say(BY[n.fn].name + " wired to " + nameOf(ref)); }
      } else if (spawn) {
        say(BY[n.fn].name + " placed" + (n.fn === "box" || n.fn === "dot" ? ": it is nothing yet; type a letter for text or a digit for an integer" : n.fn === "ask" ? ": type a question and press Enter" : ": drop it on something to wire it"));
        if (n.fn === "ask" || ((n.fn === "box" || n.fn === "dot") && !n.role)) setTimeout(() => n.el.focus({ preventScroll: true }), 60);
      }
      clear(n);                                                          // nothing overlaps unless it is inside a super
      persist(); tick();
    };
    startEl.addEventListener("pointermove", move);
    startEl.addEventListener("pointerup", up);
    startEl.addEventListener("pointercancel", up);
  }
  function wireNode(n) {
    // it takes the keyboard as soon as it is pressed: a click that moved a hair counts as a drag and never
    // reached the click handler, so a prompt typed after it went nowhere
    n.el.addEventListener("pointerdown", e => {
      if (!(e.target.closest && e.target.closest("input"))) n.el.focus({ preventScroll: true });
      // inside a holder it is like the page (owner, 2026-10-12: wiring inside a prompt super is the same as outside):
      // a press on its bare space moves nothing (a double click makes a super there, a hold on words wires); the
      // holder moves by its label strip at the top or its edge
      if (isHolder(n) && e.target === n.el) {
        const r = n.el.getBoundingClientRect(), d = Math.min(e.clientX - r.left, r.right - e.clientX, e.clientY - r.top, r.bottom - e.clientY);
        if (d > 12 && e.clientY - r.top > r.height * 0.22) return;
      }
      drag(e, n.el, null);
    });
    n.el.addEventListener("click", () => {
      if (n.el.dataset.dragged) return;
      // the superellipse look has no clickable objects, only zoomable ones (owner, 2026-10-12): a click selects the
      // super and lets you type into it; it presses nothing (stop, pause, ask go by wires and Enter)
      if (se()) { if (n.field) n.field.focus(); else n.el.focus({ preventScroll: true }); return; }
      used(n);
      n.el.classList.remove("fired"); void n.el.offsetWidth; n.el.classList.add("fired");
      const wired = n.inputs.length + linkIns(n).length > 0;
      if (n.fn === "super") askEngine(n, true);
      else if (n.role === "engine") { n.el.focus({ preventScroll: true }); say("Super AI: type a question into it and press Enter"); }
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
      if (isHolder(n)) {                                                  // a holder: inside, a new super; on its label strip at the top, removed
        const r = n.el.getBoundingClientRect();
        if (e.clientY - r.top > Math.max(34, r.height * 0.16)) { e.preventDefault(); e.stopPropagation(); const m = spawnAt(e.clientX, e.clientY, !e.shiftKey); if (m) say("A super made inside " + (n.str || "the super")); return; }
      }
      e.preventDefault(); e.stopPropagation(); remove(n); say(BY[n.fn].name + " deleted");
    });
    n.el.addEventListener("keydown", e => {
      // the engine super takes typing as it is: a word in it (Open, Close…) acts on what is wired in, a question is asked
      if (n.role === "engine" && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === "Backspace")) {
        e.preventDefault();
        n.str = e.key === "Backspace" ? (n.str || "").slice(0, -1) : (n.str || "") + e.key;
        n.answer = ""; n.st.asked = ""; n.st.commit = false; n.hint = "";
        persist(); tick(); return;
      }
      if (n.role === "engine" && e.key === "Enter" && n.str) {          // Enter asks what was typed
        e.preventDefault(); e.stopPropagation();
        n.st.commit = true; clearTimeout(n.st.timer); n.st.timer = 0; askEngine(n, true); return;   // asks (and ticks) at once: no settle timer to ask again
      }
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
  // The zoom rule, for supers as for windows: a scroll or a pinch on a super zooms into what it shows (its
  // prompt, its answer, its value) about the pointer, from the whole of it (1) to 4 ×; Alt + scroll sizes the
  // super itself (super/scroll.js). New text starts from the whole again.
  function textZoom(el, g) {
    const z = { k: 1, tx: 0, ty: 0, text: "" };
    const apply = () => {
      const w = g.offsetWidth, h = g.offsetHeight;
      z.tx = Math.min(0, Math.max(w - w * z.k, z.tx)); z.ty = Math.min(0, Math.max(h - h * z.k, z.ty));
      g.style.transformOrigin = "0 0";
      g.style.transform = z.k > 1.001 ? "translate(" + z.tx.toFixed(1) + "px," + z.ty.toFixed(1) + "px) scale(" + z.k.toFixed(3) + ")" : "";
      el.classList.toggle("is-tzoom", z.k > 1.001);
    };
    g._zoom = {
      zoomAt(x, y, dy) {
        const b = g.getBoundingClientRect(), ox = x - (b.left - z.tx), oy = y - (b.top - z.ty);   // the point, in the glyph's own box
        const k1 = Math.max(1, Math.min(4, z.k * Math.exp(-dy * 0.0015)));
        if (k1 === z.k) return false;
        z.tx = ox - (ox - z.tx) * (k1 / z.k); z.ty = oy - (oy - z.ty) * (k1 / z.k); z.k = k1;
        apply(); return true;
      },
      reset() { if (z.k !== 1) { z.k = 1; z.tx = z.ty = 0; apply(); } },
    };
  }
  // the operation of an operator super (+ − × ÷ ^ %) joined to n by any port or wire, other than one feeding n's input
  function attachedOp(n) {
    if (!window.SuperLink) return null;
    const me = "node:" + n.id;
    for (const l of window.SuperLink.links()) {
      const ends = [l.a, l.b].map(an => an && an.h || "");
      const mine = ends.findIndex(h => h === me || h.startsWith("port:" + me + "/"));
      if (mine < 0) continue;
      const other = ends[1 - mine], m = /^(?:port:)?node:([^/]+)/.exec(other);
      const o = m && nodes.find(x => x.id === m[1]);
      if (o && o !== n && opOf((o.str || "").trim())) return opOf(o.str.trim());
    }
    return null;
  }
  function fitText(n) {
    const g0 = n.el.querySelector(".lv-glyph");
    if (g0 && g0._zoom && g0.dataset.t !== String(n.text || "")) { g0.dataset.t = String(n.text || ""); g0._zoom.reset(); }   // new text: the whole of it
    const t = n.field ? n.field.value : n.el.classList.contains("is-long") ? "" : String(n.text || "");
    const target = n.field || n.el.querySelector(".lv-glyph");
    if (!target) return;
    if (!t || n.role === "loop") { target.style.fontSize = ""; return; }
    const size = n.size || 56, room = size * (n.fn === "dot" ? 0.74 : 0.82);
    let fs = Math.max(11, Math.min(size * 0.3, room / (Math.max(1, t.length) * 0.62)));   // never under readable (11 px): a long word is cut with an ellipsis instead
    const wrap = n.role === "engine";                                   // an engine super (the central one too) wraps its words inside its shape
    if (wrap) fs = Math.max(11, Math.min(Math.min(18, Math.max(13, size * 0.17)), Math.sqrt(room * room * 0.8 / (0.62 * 1.25 * Math.max(1, t.length)))));   // small mono type, as on the owner's screenshot
    n.el.classList.toggle("is-wrap", wrap);
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
  // ● zoomed past twice its size becomes a loop, a ring that counts
  const DOT_BASE = 56, LOOP_AT = 104;
  // every node's size is one number (--lv-s); a value, a field or an answer still makes it grow around them
  function sizeDot(n, d) { n.size = d; n.el.style.setProperty("--lv-s", d + "px"); if (n.aspect) n.el.style.setProperty("--lv-h", Math.round(d * n.aspect) + "px"); else n.el.style.removeProperty("--lv-h"); }
  // scrolling on a node sizes it, about its centre; a ● scrolled past twice its size becomes a loop
  let zoomed = null, suppressRing = false, moveT = 0;
  function closeNode(n) {
    n.st.closing = true;
    const crew = isHolder(n) ? inside(n) : [];
    [n, ...crew].forEach(m => m.el.classList.add("lv-closing"));
    setTimeout(() => { crew.forEach(remove); remove(n); say((BY[n.fn].name) + " closed: it got too small" + (crew.length ? ", with what it held" : "")); }, 700 * ((window.SeMotion && window.SeMotion.SLOW) || 1));
  }
  function zoomNode(n, dy, auto) {
    const r = n.el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const sbx = O().siteBox ? O().siteBox() : null;                 // as big as the inner super lets (then it fills it: super/maximize.js)
    const cur = n.st.sizeTo || n.size || DOT_BASE, max = sbx && sbx.a ? Math.min(2 * sbx.a, 2 * sbx.b / (n.aspect || 1)) - 8 : Math.min(window.innerWidth, window.innerHeight / (n.aspect || 1)) - 20;
    if (window.SeMax && window.SeMax.isMax(n.el)) { if (dy > 0) window.SeMax.restore(n.el); return; }   // filling the inner super: a scroll out gives it back its size
    if (dy < 0 && cur >= max - 1 && window.SeMax) { n.st.maxAcc = (n.st.maxAcc || 0) - dy; clearTimeout(n.st.maxT); n.st.maxT = setTimeout(() => { n.st.maxAcc = 0; }, 500); if (n.st.maxAcc > 120) { n.st.maxAcc = 0; window.SeMax.maximize(n.el); } return; }
    // too small, it closes (owner, 2026-10-12): scrolled on out at its smallest, it fades away, wires and all
    if (dy > 0 && !auto && cur <= 36 && n.id !== "site-box") {
      n.st.over = (n.st.over || 0) + dy; clearTimeout(n.st.overT); n.st.overT = setTimeout(() => { n.st.over = 0; }, 500);
      if (n.st.over > 160 && !n.st.closing) closeNode(n);
      return;
    }
    const d = Math.round(Math.max(36, Math.min(max, cur * Math.exp(-dy * 0.0015))));   // every super grows as far as any (owner, 2026-10-12)
    if (d === cur) return;
    n.st.sizeTo = d;
    const settle = () => { const L = toLayout(cx, cy), s = n.size || DOT_BASE; n.fx = (L.x - s / 2) / window.innerWidth; n.fy = (L.y - s * (n.aspect || 1) / 2) / window.innerHeight; place(n); };
    if (window.SeMotion) { const s = { v: n.size || DOT_BASE }; window.SeMotion.glide("node:" + n.id, s, "v", d, 160, () => { sizeDot(n, Math.round(s.v)); settle(); drawWires(); }); }
    else { sizeDot(n, d); settle(); }
    if (n.fn === "dot" && d >= LOOP_AT && !n.role) { n.role = "loop"; n.i = 0; say("● is now a loop: it counts once a second (wire it to see the count); click its ring to pause"); }
    if (n.fn === "box" && !auto && (cur < HOLD_AT) !== (d < HOLD_AT)) { n.hold = d >= HOLD_AT; say(d >= HOLD_AT ? "■ now holds supers: drop supers into it, or double-click inside it to make one" : "■ is small again: it holds nothing"); }
    clearTimeout(n.st.zt); n.st.zt = setTimeout(persist, 300); tick();
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
    const goal = n.st.go ? 0.9 : (n.answer ? 1 : 0);
    const draw = () => { if (!n.el.isConnected) return; const g = G(); n.st.sn = g + (P() - g) * ease(Math.max(0, Math.min(1, n.st.t))); drawSuper(n); };
    if (n.st.goal === goal) return;
    n.st.goal = goal;
    if (window.SeMotion) { window.SeMotion.glide("super:" + n.id, n.st, "t", goal, n.st.go ? 1800 : 300, draw); return; }
    if (n.st.anim) return;
    n.st.anim = true;
    let last = performance.now();
    const step = now => {
      if (!n.el.isConnected) { n.st.anim = false; return; }
      const dt = now - last; last = now;
      const g2 = n.st.goal;
      n.st.t += (g2 - n.st.t) * Math.min(1, dt / (n.st.go ? 1800 : 260));
      if (Math.abs(g2 - n.st.t) < 0.002) n.st.t = g2;
      draw();
      if (n.st.t !== g2) requestAnimationFrame(step); else n.st.anim = false;
    };
    requestAnimationFrame(step);
  }
  // a Super AI super (made by a double click): every engine, the lab's and the outside models, each answer
  // kept with it (n.st.run) for the box; its short answer (the verdict, else siM's) shows inside it
  function askEvery(n, prompt) {
    used(n, 2);
    if (n.st.run && !n.st.run.finished) n.st.run.stop();
    const r = window.SuperPrompt.run(prompt.slice(0, 4000));
    follow(n, r, prompt);
    say("Super AI: asking every engine about “" + clip(prompt) + "”");
    return r;
  }
  function follow(n, r, prompt) {
    n.st.run = r; n.st.go = true; n.st.asked = prompt; n.el.classList.add("is-thinking"); grow(n); tick();
    r.on(() => {
      if (n.st.run !== r) return;
      const t = window.SuperPrompt.summary(r);
      if (t) n.answer = t;
      if (r.finished) {
        n.st.go = false; n.el.classList.remove("is-thinking"); grow(n);
        const want = Math.min(240, Math.max(n.size || DOT_BASE, Math.round(70 + Math.sqrt((n.answer || "").length) * 9)));   // room to read the answer
        if (want > (n.size || DOT_BASE) + 4) zoomNode(n, -Math.log(want / (n.st.sizeTo || n.size || DOT_BASE)) / 0.0015, true);   // grown to read, not to hold
        const got = r.engines.filter(e => r.results[e.id] && r.results[e.id].state === "ok").length;
        say("Super AI: " + got + " of " + r.engines.length + " engines answered; press it to see each answer");
        persist();
      }
      tick();
    });
  }
  function openBox(n) {
    window.SuperPrompt.open(n.str || n.prompt || "", n.st.run || null, (q, r) => {
      n.str = q; n.st.commit = true; n.answer = "";
      follow(n, r, q); persist();
    });
  }
  // A Super AI super runs only when it is connected to run, the central super (owner, 2026-10-12): joined to it
  // by wires (through other supers too), or sitting inside it. Unconnected, it computes what is computable
  // (numbers) but asks no engine, and says so.
  function connectedToRun(n) {
    if (n.id === "site-box") return true;
    const run = nodes.find(x => x.id === "site-box");
    if (!run) return false;
    if (isHolder(run) && within(run, n)) return true;
    const SL = window.SuperLink, links = SL && SL.links ? SL.links() : [];
    const idOf = an => { const m = an && an.h && /^(?:port:)?node:([^/]+)/.exec(an.h); return m ? m[1] : null; };
    const near = new Map();
    const join = (a, b) => { if (!a || !b || a === b) return; (near.get(a) || near.set(a, new Set()).get(a)).add(b); (near.get(b) || near.set(b, new Set()).get(b)).add(a); };
    links.forEach(l => join(idOf(l.a), idOf(l.b)));
    nodes.forEach(m => m.inputs.forEach(ref => ref.node && join(m.id, ref.node)));
    const seen = new Set([n.id]), q = [n.id];
    while (q.length) { const id = q.shift(); if (id === "site-box") return true; (near.get(id) || []).forEach(o => { if (!seen.has(o)) { seen.add(o); q.push(o); } }); }
    return false;
  }
  function unrunOne(n) {
    if (n.st.run && !n.st.run.finished) n.st.run.stop();
    if (n.st.ctrl) { try { n.st.ctrl.abort(); } catch (_) { /* fine */ } }
    n.st.go = false; n.st.run = null; n.answer = ""; n.st.unrun = true; n.st.asked = n.prompt || "";
    n.el.classList.remove("is-thinking"); persist(); tick();
    say("Super AI: disconnected from run, it stops; its answer is gone until it is connected again");
  }
  function unrun() { nodes.forEach(n => { if (n.role === "engine" && n.id !== "site-box" && (n.st.go || n.answer) && !connectedToRun(n)) unrunOne(n); }); }
  async function askEngine(n, pressed) {
    const prompt = n.prompt || "";
    if (n.role === "engine" && n.id !== "site-box" && window.SuperPrompt && prompt) {
      if (n.held) { say("Super AI: stopped"); return; }
      if (!connectedToRun(n)) { n.st.unrun = true; n.st.asked = prompt; say("Super AI: connect it to run first (the super in the middle)"); tick(); return; }   // asked again when its wiring changes
      n.st.unrun = false;
      askEvery(n, prompt); return;
    }
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
  const VERBS = { open: "open", show: "open", close: "close", hide: "close", pause: "pause", hold: "pause", stop: "pause", run: "run", go: "run", resume: "run" };

  // ---- the palette -----------------------------------------------------
  function build() {
    if (document.querySelector(".lv-palette")) return;
    canvas = document.createElement("div");
    canvas.className = "lv-canvas";
    canvas.innerHTML = '<svg class="lv-wires" aria-hidden="true"></svg>';
    wires = canvas.firstChild;
    // a wire: a double click disconnects that input; a click selects it for Delete (one helper for every wire
    // layer: super/wire.js selectable; in the round look the double click alone)
    const cut = w => {
      const n = w && nodes.find(x => x.id === w.dataset.node);
      if (!n) return;
      const ref = n.inputs.splice(+w.dataset.i, 1)[0];
      pickedWire = null; persist(); tick();
      say(BY[n.fn].name + " disconnected from " + (ref ? nameOf(ref) : "its input"));
    };
    const hook = () => {
      if (html.classList.contains("shape-se") && window.SuperLink && window.SuperLink.selectable) {
        window.SuperLink.selectable(wires, cut, w => { const k = w.dataset.node + "/" + w.dataset.i; pickedWire = pickedWire === k ? null : k; return !!pickedWire; });
      } else wires.addEventListener("dblclick", e => { const w = e.target.closest && e.target.closest(".wire-hit"); if (!w) return; e.stopPropagation(); e.preventDefault(); cut(w); });
    };
    if (window.SuperLink) hook(); else setTimeout(hook, 300);
    document.body.appendChild(canvas);

    // no palette: a double click on bare page makes a Super AI super there (a ■ like the central one: type a
    // question, Enter, and every engine answers, superprompt.js); Shift + double click makes a plain node;
    // a single click selects the super (super/select.js); what happened is announced to screen readers
    out = document.createElement("output"); out.className = "lv-out"; out.setAttribute("aria-live", "polite");
    document.body.appendChild(out);
    let down = null; const held = new Set();
    document.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY, e.target]; }, true);
    document.addEventListener("dblclick", e => {
      if (!html.classList.contains("shape-se") || e.button) return;
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;             // a drag, not a click
      // a double click on bare space makes a prompt Super AI super, windows open or not (owner, 2026-10-12)
      const t = e.target;
      // inside a bubble, on a window's blank margin or on the compact project super it makes one there too (every
      // super holds supers, super/hold.js); never on a pill, a word, a control or a window's content
      const inHost = t.closest && (t.closest(".orbit-bubble.is-group") || (t.classList.contains("orbit-panel") ? t : null) || t.closest(".se-project:not(.is-open)"));
      if (inHost && !t.closest(".ob-member, .ob-chat, .ob-label, .se-port, .se-lock, input, button, a, select, textarea, .wire-hit")) {
        e.preventDefault(); e.stopPropagation();
        // wholly inside the host, so it is held by it: its centre kept clear of the host's edge by half a super
        const hr = inHost.getBoundingClientRect(), half = (e.shiftKey ? DOT_BASE : ENGINE_BASE) / 2 + 6, k = Math.min(hr.width, hr.height) * 0.03 + half;
        const cx = Math.max(hr.left + k, Math.min(hr.right - k, e.clientX)), cy = Math.max(hr.top + k, Math.min(hr.bottom - k, e.clientY));
        const m = spawnAt(cx, cy, !e.shiftKey);
        if (m) { held.add(m.id); say("A super made inside " + ((inHost.querySelector(":scope > .ob-label") || {}).textContent || "the super").trim()); }
        return;
      }
      if (t.closest && t.closest(".lv-node, .orbit-bubble, .orbit-panel, .orbit-title, .live-dock, .se-port, input, button, a, select, textarea, .wire-hit, .wire-handle")) return;
      if (window.LabView && window.LabView.loopAt && window.LabView.loopAt(e.clientX, e.clientY)) return;
      if (window.PiOrbit && window.PiOrbit.inLoop && !window.PiOrbit.inLoop(e.clientX, e.clientY)) return;   // outside the super: nothing
      spawnAt(e.clientX, e.clientY, !e.shiftKey);
    });

    setTimeout(() => { if (window.PiOrbit && window.PiOrbit.layout) window.PiOrbit.layout(); }, 300);   // the pills make room for it
    let rt = 0;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { nodes.forEach(place); drawWires(); }, 200); });

    // the diagram you left last time; on a first visit in the superellipse look, one ■ in the middle of the
    // inner super wired to its four ports (input and sync into it, out of it to output and condition),
    // so the page starts as a diagram that runs
    let saved = restore("lv:nodes");
    // the first supers of earlier visits (Connect wires to begin, use shift+scroll, open, close, run) are gone
    // from the start (owner, 2026-10-12): a kept diagram loses them too, unless something was typed into them
    if (saved && !restore("lv:intro-gone")) {
      const intro = { start: "", open: "open", close: "close", run: "run" };   // (shift is today's hint super: kept)
      saved = saved.filter(n => !(n && n.id in intro && ((n.str || "").trim() === intro[n.id] || !(n.str || "").trim())));
      save("lv:nodes", saved); save("lv:intro-gone", 1);
      if (window.SuperLink && window.SuperLink.forget) Object.keys(intro).forEach(id => window.SuperLink.forget("node:" + id));
    }
    (saved || []).forEach(make);
    // the central super is the AI engine: a ■ with the role "engine" shows the engines' answer to what is wired
    // into its input, "run" when nothing is (owner, 2026-10-12); its ports are the site's: input and sync in, output and condition
    const id = "site-box";
    const central = nodes.find(x => x.id === id);
    const fresh = (!saved || !central) && se();
    if (fresh) layoutProgram();                                     // a first visit (or a diagram kept from the round look, without the central super): the program's diagram (super/pitechlab.super.js)
    else if (!saved) layoutProgram(true);                           // a first visit in the round look: its first supers
    if (!fresh && central && !central.role) { central.role = "engine"; persist(); }   // a diagram from before the engine role
    if (se() && !fresh && nodes.find(x => x.id === id)) {
      // the older wiring to the central super's body is let go of (its ports are the wire ends now); a kept
      // diagram with no wires at all gets the start's wires once (lv:start-wired); what the visitor wired stays
      const wire = () => {
        const SL = window.SuperLink; if (!SL || !SL.add) return setTimeout(wire, 100);
        const me = "node:" + id;
        if (SL.links().some(l => (l.a && l.a.h === me) || (l.b && l.b.h === me))) SL.forget(me);
        if (!SL.links().length && !restore("lv:start-wired")) {
          save("lv:start-wired", 1);
          const prog = window.SuperAI && window.SuperAI.program && window.SuperAI.program.diagram;
          wireUp((prog && prog.wires) || []);
        }
      };
      wire();
    }
    // the side wires (owner, 2026-10-12: "side wires dont work"): the site's input and output to the main super's are
    // real wires now (selectable, deletable, flowing), not drawn lattice lines; a kept diagram gets them once
    if (se() && !restore("lv:side-wired")) { save("lv:side-wired", 1); wireUp([["main.input", "site.input"], ["site.output", "main.output"]]); }
    // the hint super went at a second load for a while (the old intro clean-up): it comes back once
    if (se() && window.innerWidth >= 700 && !nodes.find(x => x.id === "shift") && !restore("lv:shift-back")) {
      save("lv:shift-back", 1);
      const prog = window.SuperAI && window.SuperAI.program && window.SuperAI.program.diagram, sp = prog && (prog.supers || []).find(x => x.id === "shift"), c = nodes.find(x => x.id === "site-box");
      if (sp && c) {
        try { if (localStorage.getItem("se:lock:node:shift") == null) localStorage.setItem("se:lock:node:shift", "1"); } catch (_) { /* private mode */ }
        const m = make({ id: "shift", fn: "box", role: "engine", hint: sp.hint, fx: c.fx + 150 / window.innerWidth, fy: c.fy, inputs: [], n: Math.PI });
        if (m) { clear(m); persist(); }
      }
    } else if (!restore("lv:shift-back")) save("lv:shift-back", 1);
    // the program's hints are the program's (a kept diagram shows today's words: "hold shift + scroll")
    { const prog = window.SuperAI && window.SuperAI.program && window.SuperAI.program.diagram;
      ((prog && prog.supers) || []).forEach(sp => { const n = sp.hint && nodes.find(x => x.id === sp.id); if (n && n.hint !== sp.hint) { n.hint = sp.hint; persist(); } }); }
    setInterval(tick, 250);
    document.addEventListener("se:frame", () => {              // super/motion.js: while something moves, every frame
      const f = O().fit ? O().fit().f : 1;
      if (f !== lastFit) { lastFit = f; nodes.forEach(place); }
      drawWires();
    });
    setInterval(() => { let k = 0; nodes.forEach(n => { if (n.role === "loop" && !n.paused && !n.held && !n.clocked) { n.i = (n.i || 0) + 1; k++; } }); if (k) tick(); }, 1000);   // loops count (a loop with a sync wired in steps on that instead)
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
      if (html.classList.contains("shape-se")) return;              // the superellipse look: super/scroll.js decides what a scroll does
      if (!n || (hit && hit.tagName === "INPUT" && n.el.contains(hit) && n.fn === "ask")) return;
      if (!e.ctrlKey) { zoomed = null; return; }
      e.preventDefault(); e.stopImmediatePropagation();
      zoomed = { n, t: performance.now() };
      zoomNode(n, (e.deltaY || e.deltaX) * 4);                        // pinch deltas are small
    }, { capture: true, passive: false });
    // super/scroll.js: a scroll on a node sizes it
    window.LabView = { loopPort, unrun, inspect: id => { const n = nodes.find(x => x.id === id); return n ? { ins: linkIns(n).map(a => a.h || a.t), inputs: n.inputs, held: !!n.held, portHeld: !!n.portHeld, prompt: n.prompt, text: n.text, str: n.str } : null; }, zoomNode: (el, dy) => { const n = nodes.find(x => x.el === el); if (n) zoomNode(n, dy); return !!n; },
                       shapeNode: (el, dy) => { const n = nodes.find(x => x.el === el); if (n) reshape(n, dy); return !!n; },
                       // super/maximize.js: a super's whole box in layout px (it fills the inner super, and back)
                       rectOf: el => { const n = nodes.find(x => x.el === el); return n ? { x: n.fx * window.innerWidth, y: n.fy * window.innerHeight, w: n.size || DOT_BASE, h: (n.size || DOT_BASE) * (n.aspect || 1), aspect: n.aspect || 0 } : null; },
                       setRect: (el, x, y, w, h) => { const n = nodes.find(m => m.el === el); if (!n) return false; w = Math.max(36, w); h = Math.max(36, h); n.aspect = Math.abs(h / w - 1) < 0.01 ? 0 : h / w; n.st.sizeTo = null; sizeDot(n, Math.round(w)); n.fx = x / window.innerWidth; n.fy = y / window.innerHeight; place(n); clearTimeout(moveT); moveT = setTimeout(persist, 300); drawWires(); return true; },
                       // super/hold.js: supers held by another super move with it, by a screen offset
                       moveNodes: (ids, dx, dy) => { const a = toLayout(0, 0), b = toLayout(dx, dy), fx = (b.x - a.x) / window.innerWidth, fy = (b.y - a.y) / window.innerHeight; nodes.forEach(n => { if (ids.includes(n.id)) { n.fx += fx; n.fy += fy; place(n); } }); clearTimeout(moveT); moveT = setTimeout(persist, 300); drawWires(); },
                       // Shift + drag (super/shiftsize.js): its width and height, in layout px; a rectangle keeps its aspect
                       resize: (el, w, h) => { const n = nodes.find(x => x.el === el); if (!n) return false; w = Math.max(36, Math.round(w)); h = Math.max(36, Math.round(h)); n.aspect = Math.abs(h / w - 1) < 0.02 ? 0 : h / w; sizeDot(n, w); clearTimeout(n.st.zt); n.st.zt = setTimeout(persist, 300); tick(); drawWires(); return true; },
                       loopAt: (x, y) => { const n = nodes.find(m => { if (m.role !== "loop") return false; const r = m.el.getBoundingClientRect(); return Math.abs(Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) - r.width / 2) < 14; }); return n ? n.el : null; } };
    document.addEventListener("dblclick", e => {
      const n = nodes.find(x => { if (x.role !== "loop") return false; const r = x.el.getBoundingClientRect(), d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)); const k = d - r.width / 2; return k >= -10 && k <= 4; });
      if (!n) return;
      e.preventDefault(); e.stopPropagation(); remove(n); say("● loop deleted");
    }, true);
    // a wire added or deleted anywhere: values update at once
    document.addEventListener("superlink:change", () => tick());
    document.addEventListener("se:obstacle", () => { nodes.forEach(n => clear(n)); persist(); });   // something moved onto the nodes: they step off it
    // typing with nothing focused goes into the selected super (a prompt is written straight into it)
    document.addEventListener("keydown", e => {
      const a = document.activeElement;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !(e.key.length === 1 || e.key === "Backspace" || e.key === "Enter")) return;
      if (a && a !== document.body && a !== document.documentElement && !a.classList.contains("orbit-stage")) return;
      const sel = window.SeSelect && window.SeSelect.selected && window.SeSelect.selected();
      const n = sel && sel.classList && sel.classList.contains("lv-node") && nodes.find(x => x.el === sel);
      if (!n || !(n.role === "engine" || ((n.fn === "box" || n.fn === "dot") && !n.role))) return;
      e.preventDefault();
      n.el.focus({ preventScroll: true });
      n.el.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, shiftKey: e.shiftKey, bubbles: true, cancelable: true }));
    });
    // a loop is moved by its ring, and takes what is inside it along
    document.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const n = nodes.find(x => { if (x.role !== "loop") return false; const r = x.el.getBoundingClientRect(), d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) - r.width / 2; return d >= -10 && d <= 4; });
      if (!n) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const crew = [n].concat(inside(n)), x0 = e.clientX, y0 = e.clientY, start = crew.map(m => [m.fx, m.fy]);
      let moved = false;
      const move = ev => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        if (!moved) { moved = true; n.el.classList.add("is-dragging"); html.classList.add("lv-dragging"); }
        const f = toLayout(0, 0).f, dx = (ev.clientX - x0) / f / window.innerWidth, dy = (ev.clientY - y0) / f / window.innerHeight;
        crew.forEach((m, i) => { m.fx = start[i][0] + dx; m.fy = start[i][1] + dy; place(m); });
        drawWires();
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true);
        n.el.classList.remove("is-dragging"); html.classList.remove("lv-dragging");
        if (moved) { suppressRing = true; setTimeout(() => { suppressRing = false; }, 0); persist(); tick(); }
      };
      window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true);
    }, true);
    // a click on a loop's ring pauses it (or lets it go on)
    document.addEventListener("click", e => {
      const n = nodes.find(x => {
        if (x.role !== "loop") return false;
        const r = x.el.getBoundingClientRect(), d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        const k = d - r.width / 2; return k >= -10 && k <= 4;
      });
      if (!n) return;
      e.preventDefault(); e.stopPropagation();
      if (suppressRing) return;                                          // the end of a move, not a click
      n.paused = !n.paused; say("●: the loop " + (n.paused ? "is paused" : "goes on")); tick();
    }, true);
    // a sideways swipe on the bare page never navigates back: it is eaten unless something under it scrolls sideways
    document.addEventListener("wheel", e => {
      if (!html.classList.contains("shape-se") || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      for (let el = e.target; el && el !== document.body; el = el.parentElement)
        if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return;
      e.preventDefault();
    }, { passive: false });
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
