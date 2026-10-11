// super/site.js — the superellipse superlattice ("super"): the site itself is a super inside the
// main super. The bubbles sit inside an inner superellipse (the same n as the main loop, so
// scrolling morphs both), with four ports on its sides, LabVIEW style:
//
//   input      (left)    what is wired in is the site's question: every engine answers it
//   output     (right)   the site's answer (the Super Neural Engine's), a value for ■, +, ◆, ?
//   sync       (top)     the site's clock: how many digits of π it has, ticking
//   condition  (bottom)  wired true the site runs, wired false it pauses (π and the engines)
//
// A faint lattice line runs from each port out to the main loop: the inner super is a node of
// the outer one. Ports are wire ends like anything else (super/wire.js: drag from a port, drop a
// node on it, draw a wire to it); super/nodes.js reads them as values (SeSite.value) and feeds the
// input and condition ports from what is wired into them.
//
// Every super is a node of the lattice: windows and loops (a ● grown into a ring, super/nodes.js) get
// the same four ports on their sides (SePorts here: id "<owner>/<name>", the site's are just "<name>"),
// and the wires follow the sketch's rule by where the ports are: flow runs left to right (an output
// into the next super's input), sync comes down into the top, condition comes up into the bottom.
//   a window:  input   what is wired in is typed into its first field (a search, a question)
//              output  the window's title and what it says
//              sync    every tick of what is wired in refreshes it (its field is re-entered) and brings it up
//              condition  wired false the window is held: dimmed, taking no input
//   a loop (super/nodes.js reads its ports): input sets its count, sync steps it instead of the
//              clock, condition false pauses it; its output is what is inside it, or its count
//
// Windows are superellipses too (n = π over their whole box): CSS corner-shape where the browser
// has it, otherwise a clip-path polygon and an outline drawn here, so Safari sees the same shape.
// Zooming on a window (pinch, ctrl + wheel) sizes it, like a node.
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {};
  const SM = () => window.SeMorph;
  const PORTS = [["input", "left"], ["output", "right"], ["sync", "top"], ["condition", "bottom"]];
  let svg, path, lattice = {}, ports = {}, site = null;   // site: { cx, cy, a, b, n } of the inner super
  let inputText = "", answer = "", asking = false, askT = null, lastAsked = null;

  const seNorm = (u, v, n) => Math.pow(Math.pow(u, n) + Math.pow(v, n), 1 / n);
  function superPath(cx, cy, a, b, n) {
    const e = 2 / n, pts = [];
    for (let i = 0; i < 180; i++) {
      const t = i / 180 * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      pts.push((cx + a * Math.sign(c) * Math.pow(Math.abs(c), e)).toFixed(1) + "," + (cy + b * Math.sign(s) * Math.pow(Math.abs(s), e)).toFixed(1));
    }
    return "M" + pts.join("L") + "Z";
  }

  function build() {
    const core = document.querySelector(".orbit-core");
    if (!core || svg) return;
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "om-site"); svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<path class="om-site-loop" d=""/>' + PORTS.map(([p]) => '<path class="om-lattice" data-port="' + p + '" d=""/>').join("");
    core.appendChild(svg);
    path = svg.querySelector(".om-site-loop");
    PORTS.forEach(([p]) => { lattice[p] = svg.querySelector('.om-lattice[data-port="' + p + '"]'); });
    PORTS.forEach(([p, side]) => {
      const el = document.createElement("div");
      el.className = "se-port se-port-" + side; el.dataset.port = p; el.dataset.pid = p; el.dataset.owner = "site";
      el.innerHTML = '<span class="se-port-dot" aria-hidden="true"></span><span class="se-port-name">' + p + "</span>";
      el.title = { input: "input: wire a question in, every engine answers", output: "output: the site's answer", sync: "sync: the site's clock, π's digits", condition: "condition: wired false, the site pauses" }[p];
      document.body.appendChild(el); ports[p] = el;
    });
  }

  // ---- ports on every super ------------------------------------------------------------------
  // owner: "win:<key>" (a window, by its item key) or "node:<id>" (a loop); port ids are "<owner>/<name>"
  const owned = {};                                         // owner -> { input, output, sync, condition } elements
  const TITLES = { input: "input: what is wired in goes into it", output: "output: what it says", sync: "sync: each tick refreshes it", condition: "condition: wired false, it is held" };
  function ensurePorts(owner, what) {
    if (owned[owner]) return owned[owner];
    const set = {};
    PORTS.forEach(([p, side]) => {
      const el = document.createElement("div");
      el.className = "se-port se-port-" + side + " se-port-owned"; el.dataset.port = p; el.dataset.owner = owner; el.dataset.pid = owner + "/" + p;
      el.innerHTML = '<span class="se-port-dot" aria-hidden="true"></span><span class="se-port-name">' + p + "</span>";
      el.title = what + ": " + TITLES[p];
      document.body.appendChild(el); set[p] = el; ports[owner + "/" + p] = el;
    });
    owned[owner] = set;
    return set;
  }
  function dropPorts(owner) {
    const set = owned[owner]; if (!set) return;
    PORTS.forEach(([p]) => { set[p].remove(); delete ports[owner + "/" + p]; });
    delete owned[owner];
  }
  // the owners on the page now: open windows and loops; ports sit on the four extreme points of each
  function layoutOwned() {
    const seen = new Set();
    if (on()) {
      document.querySelectorAll(".orbit-panel").forEach(p => {
        const key = p.item && p.item.key; if (!key || p.classList.contains("leaving")) return;
        const r = p.getBoundingClientRect(); if (!r.width) return;
        const owner = "win:" + key; seen.add(owner);
        const set = ensurePorts(owner, p.item.title || key);
        placeAt(set, r.left + r.width / 2, r.top + r.height / 2, r.width / 2, r.height / 2);
        set.input.classList.toggle("is-held", p.classList.contains("se-held"));
      });
      document.querySelectorAll(".lv-node.is-loop[data-id]").forEach(nd => {
        const r = nd.getBoundingClientRect(); if (!r.width) return;
        const owner = "node:" + nd.dataset.id; seen.add(owner);
        const set = ensurePorts(owner, "the loop");
        placeAt(set, r.left + r.width / 2, r.top + r.height / 2, r.width / 2, r.height / 2);
      });
    }
    Object.keys(owned).forEach(o => { if (!seen.has(o)) dropPorts(o); });
  }
  function placeAt(set, cx, cy, a, b) {
    const pts = { input: [cx - a, cy], output: [cx + a, cy], sync: [cx, cy - b], condition: [cx, cy + b] };
    PORTS.forEach(([p]) => { const [x, y] = pts[p], el = set[p]; const l = x + "px", t = y + "px"; if (el.style.left !== l) el.style.left = l; if (el.style.top !== t) el.style.top = t; });
  }
  const ownerEl = owner => owner.startsWith("win:") ? (O().elOf ? O().elOf(owner.slice(4)) : null)
    : owner.startsWith("node:") ? document.querySelector('.lv-node[data-id="' + CSS.escape(owner.slice(5)) + '"]') : null;
  const ownerName = owner => { if (owner === "site") return "the site"; if (owner.startsWith("win:")) { const i = O().info && O().info(owner.slice(4)); return i ? i.title : "the window"; } return "the loop"; };
  const firstField = p => p && p.querySelector('input[type="search"], input[type="text"], input:not([type]), textarea');
  // what a window's ports hold (a loop's are read by super/nodes.js, which owns the loops)
  const winState = {};                                      // key -> { input, ticks, held }
  function winValue(key, port) {
    const p = O().elOf && O().elOf(key), st = winState[key] || {}, i = O().info && O().info(key);
    if (port === "output") { const t = (i ? i.title : key) + (p ? ": " + (p.querySelector(".op-body") || p).innerText.trim().replace(/\s+/g, " ").slice(0, 400) : ""); return { num: t.length, bool: !!p, str: t, text: t }; }
    if (port === "input") { const t = st.input || ""; return { num: t.length, bool: !!t, str: t, text: t }; }
    if (port === "sync") { const v = st.ticks || 0; return { num: v, isNum: true, bool: !st.held, str: String(v), text: String(v) }; }
    return { num: st.held ? 0 : 1, isNum: true, bool: !st.held, str: st.held ? "held" : "running", text: st.held ? "held" : "running" };
  }
  // super/nodes.js: what is wired into a window's ports now (values, or null for nothing wired)
  function setPortInput(owner, port, vals) {
    if (!owner.startsWith("win:")) return;
    const key = owner.slice(4), p = O().elOf && O().elOf(key); if (!p) return;
    const st = winState[key] || (winState[key] = { input: "", ticks: 0, held: false, sync: null });
    if (port === "input") {
      const text = (vals || []).map(v => v && (v.text != null ? v.text : v.str)).filter(Boolean).join(" ").trim();
      if (text === st.input) return;
      st.input = text;
      const f = firstField(p);
      if (f && text) { f.value = text; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true })); }
    } else if (port === "sync") {
      const v = vals && vals.length ? vals.map(x => x && x.str).join("|") : null;
      if (v === st.sync) return;
      const first = st.sync === null;
      st.sync = v;
      if (v === null || first) return;
      st.ticks++;                                              // a tick: the window is refreshed and brought up
      const f = firstField(p);
      if (f && f.value) f.dispatchEvent(new Event("input", { bubbles: true }));
      if (O().open && O().keyOf) p.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    } else if (port === "condition") {
      const held = vals && vals.length ? !vals.every(x => x && x.bool) : false;
      if (held === st.held) return;
      st.held = held;
      p.classList.toggle("se-held", held);
    }
  }

  // the inner super: around every bubble, the same n as the main loop
  function layout() {
    if (!on()) { if (svg) svg.style.display = "none"; Object.values(ports).forEach(p => { p.style.display = "none"; }); return; }
    build(); if (!svg) return;
    svg.style.display = ""; Object.values(ports).forEach(p => { p.style.display = ""; });
    const k = [...document.querySelectorAll(".orbit-bubble")].filter(el => !el.hidden && el.getClientRects().length).length;
    const g = O().loop ? O().loop() : null, box = O().siteBox ? O().siteBox() : null;
    if (!k || !g || !g.a || !box) { svg.style.display = "none"; Object.values(ports).forEach(p => { p.style.display = "none"; }); return; }
    const n = box.n, f = box.fit || 1;                                 // its own n (orbit.js siteN): the main loop's until scrolled apart
    // the box orbit.js lays the bubbles out in, scaled toward the page's centre as the page is (setFit)
    const cx = box.px + (box.cx - box.px) * f, cy = box.py + (box.cy - box.py) * f, a = box.a * f, bb = box.b * f;
    site = { cx, cy, a, b: bb, n };
    const sr = svg.getBoundingClientRect();
    svg.setAttribute("viewBox", "0 0 " + sr.width + " " + sr.height);
    path.setAttribute("d", superPath(cx - sr.left, cy - sr.top, a, bb, n));
    // ports on the four extreme points, and a lattice line from each out to the main loop
    const pts = { input: [cx - a, cy], output: [cx + a, cy], sync: [cx, cy - bb], condition: [cx, cy + bb] };
    PORTS.forEach(([p, side]) => {
      const [x, y] = pts[p], el = ports[p];
      el.style.left = x + "px"; el.style.top = y + "px";
      if (!O().loopPoint) return;
      const X = x - sr.left, Y = y - sr.top, f = v => v.toFixed(1);
      if (side === "left" || side === "right") {                   // input and output: straight out to the main loop
        const lp = O().loopPoint(x + (side === "left" ? -4000 : 4000), y);
        lattice[p].setAttribute("d", "M" + f(X) + "," + f(Y) + "L" + f(lp[0] - sr.left) + "," + f(lp[1] - sr.top));
      } else {                                                      // sync and condition: two curves, sweeping out to either side
        const up = side === "top" ? -1 : 1;
        const d = [-1, 1].map(sx => {
          const lp = O().loopPoint(x + sx * 3000, y + up * 2600), px = lp[0] - sr.left, py = lp[1] - sr.top;
          return "M" + f(X) + "," + f(Y) + "C" + f(X) + "," + f(Y + (py - Y) * 0.7) + " " + f(px - (px - X) * 0.55) + "," + f(py) + " " + f(px) + "," + f(py);
        }).join("");
        lattice[p].setAttribute("d", d);
      }
    });
  }

  // ---- the ports' values ---------------------------------------------------
  const still = () => !!(O().still && O().still());
  function value(pid) {
    if (pid.includes("/")) {                                 // a window's or a loop's port
      const [owner, port] = pid.split("/");
      if (owner.startsWith("win:")) return winValue(owner.slice(4), port);
      const LV = window.LabView; return LV && LV.loopPort ? LV.loopPort(owner.slice(5), port) : { num: 0, bool: false, str: "", text: "" };
    }
    const port = pid;
    if (port === "sync") { const d = O().piDigits ? O().piDigits() : ""; const v = Math.max(0, d.length - 1); return { num: v, isNum: true, bool: !still(), str: String(v), text: String(v) }; }
    if (port === "condition") return { num: still() ? 0 : 1, isNum: true, bool: !still(), str: still() ? "paused" : "running", text: still() ? "paused" : "running" };
    if (port === "output") { const t = answer || ""; return { num: t.length, bool: !!t, str: t, text: t || (asking ? "thinking…" : inputText ? "press ↵ to ask" : "wire a question into input") }; }
    const t = inputText || ""; return { num: t.length, bool: !!t, str: t, text: t };
  }
  async function ask() {
    const prompt = inputText.trim();
    if (!prompt || prompt === lastAsked || asking) return;
    asking = true; lastAsked = prompt; html.classList.add("se-site-thinking");
    try {
      const res = await fetch("/api/super/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt.slice(0, 4000) }) });
      const data = await res.json().catch(() => ({}));
      answer = res.ok ? (data.answer || "No engine had an answer.") : (data.detail || "unavailable right now");
    } catch (_) { answer = "could not reach the engines"; }
    asking = false; html.classList.remove("se-site-thinking");
    document.dispatchEvent(new CustomEvent("superlink:change"));
  }
  // super/nodes.js tells the ports what is wired into them
  function setInput(text) {
    text = String(text || "").trim();
    if (text === inputText) return;
    inputText = text;
    clearTimeout(askT);
    if (!text) { answer = ""; lastAsked = null; return; }
    askT = setTimeout(ask, 900);
  }
  let condWired = null;
  function setCondition(b) {                                  // null: nothing wired, the site is left alone
    if (b === condWired) return;
    condWired = b;
    if (b !== null && O().setStill) O().setStill(!b);
  }

  // ---- windows: superellipses in every browser; zooming sizes them --------------
  const hasCorner = typeof CSS !== "undefined" && CSS.supports && CSS.supports("corner-shape", "round");
  // everything is a super: the windows, the Functions palette, the Live panel and its tab, the cards in windows
  const SUPERS = ".orbit-panel, .lv-palette, .live-dock.open .live-body, .live-tab, .op-body .card, .rs-card, .perf-card, .perf-next, .buddy-corpus";
  function clipWindows() {
    if (!on() || hasCorner || !SM()) return;
    document.querySelectorAll(SUPERS).forEach(p => {
      const w = p.offsetWidth, h = p.offsetHeight, key = w + "x" + h + "@" + (p.dataset.seN || "");
      if (!w || p.dataset.seClip === key) return;
      p.dataset.seClip = key;
      const d = SM().path(0, 0, w, h, [w / 2, h / 2], +p.dataset.seN || SM().pi, 24);
      p.style.clipPath = "path('" + d + "')";
      let o = p.querySelector(":scope > .op-outline");
      if (!o) { o = document.createElementNS("http://www.w3.org/2000/svg", "svg"); o.setAttribute("class", "op-outline"); o.setAttribute("aria-hidden", "true"); o.innerHTML = "<path/>"; p.appendChild(o); }
      o.setAttribute("viewBox", "0 0 " + w + " " + h); o.querySelector("path").setAttribute("d", d);
    });
  }
  // ---- every super has a shape of its own ------------------------------------------------------
  // shift + scroll on a super (a window, a card in it, the Live panel or its tab, the palette, a bubble,
  // the title's badge) changes that one's n and nothing else's: --se-k-window (log₂ n) is set on the
  // element, so its corners (and, inside a window, the buttons and cards that inherit it) follow;
  // named supers keep their n per browser as se:n:<name>.
  const SHAPES = ".op-body .card, .rs-card, .perf-card, .perf-next, .buddy-corpus, .stat-card, .tr-tile, .orbit-panel, .live-body, .live-tab, .lv-palette, .orbit-bubble, .orbit-title";
  const nameOfSuper = el => el.classList.contains("orbit-title") ? "title" : el.classList.contains("live-body") ? "live"
    : el.classList.contains("live-tab") ? "live-tab" : el.classList.contains("lv-palette") ? "palette"
    : el.classList.contains("orbit-bubble") ? (el.dataset.key ? "bubble:" + el.dataset.key : null)
    : el.classList.contains("orbit-panel") ? (el.item && el.item.key ? "window:" + el.item.key : null) : null;
  const loadN = name => { try { return +localStorage.getItem("se:n:" + name) || 0; } catch (_) { return 0; } };
  const saveN = (name, n) => { try { localStorage.setItem("se:n:" + name, String(+n.toPrecision(5))); } catch (_) { /* private mode */ } };
  let shapeId = 0;
  function applyN(el, n) {
    el.dataset.seN = n.toFixed(4);
    el.style.setProperty("--se-k-window", Math.log2(n).toFixed(4));
    if (el.classList.contains("orbit-title") && window.SeLogo && window.SeLogo.setN) window.SeLogo.setN(n);
    if (!hasCorner) { delete el.dataset.seClip; clipWindows(); }
  }
  function shapeEl(el, dy) {
    const cur = el._seNTo || +el.dataset.seN || (SM() && SM().pi) || Math.PI;
    const nn = Math.min(40, Math.max(0.3, cur * Math.exp(-dy * 0.002)));
    el._seNTo = nn;
    if (!el._seShapeId) el._seShapeId = ++shapeId;
    const name = nameOfSuper(el);
    if (name) saveN(name, nn);
    if (window.SeMotion) { const s = { v: +el.dataset.seN || cur }; window.SeMotion.glide("shape:" + el._seShapeId, s, "v", nn, 160, () => applyN(el, s.v)); }
    else applyN(el, nn);
  }
  function restoreShapes() {                                 // a super that was given a shape keeps it
    if (!on()) return;
    document.querySelectorAll(SHAPES).forEach(el => {
      if (el.dataset.seNChecked) return;
      el.dataset.seNChecked = "1";
      const name = nameOfSuper(el), n = name && loadN(name);
      if (n) applyN(el, n);
    });
  }
  const inSite = (x, y) => !!site && seNorm(Math.abs(x - site.cx) / site.a, Math.abs(y - site.cy) / site.b, site.n) <= 1;

  // super/scroll.js: a scroll on a window sizes it (about its centre), unless its content scrolls
  function sizeWindow(p, dy) {
    const r = p.getBoundingClientRect(), k = Math.exp(-dy * 0.0015), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cur = p._seTo || { w: r.width, h: r.height };
    const to = { w: Math.max(260, Math.min(window.innerWidth - 16, cur.w * k)), h: Math.max(140, Math.min(window.innerHeight - 16, cur.h * k)) };
    p._seTo = to;
    const put = s => { p.style.width = s.w + "px"; p.style.height = s.h + "px"; p.style.left = Math.round(cx - s.w / 2) + "px"; p.style.top = Math.round(cy - s.h / 2) + "px"; };
    if (window.SeMotion) { const s = { w: r.width, h: r.height }; window.SeMotion.tween(s, to, { duration: 160, easing: "easeOutCubic", update: () => put(s), complete: () => { if (p.item && O().saveWin) O().saveWin(p.item, p); } }); }
    else { put(to); if (p.item && O().saveWin) O().saveWin(p.item, p); }
  }

  // the inner super is draggable by its ring: the bubbles and their wires move with it, and it stays inside the main loop
  const onRing = (x, y) => {
    if (!site) return false;
    const d = seNorm(Math.abs(x - site.cx) / site.a, Math.abs(y - site.cy) / site.b, site.n);
    return Math.abs(d - 1) * Math.min(site.a, site.b) < 11;
  };
  document.addEventListener("pointerdown", e => {
    if (!on() || e.button !== 0 || !O().moveSite || !O().siteBox) return;
    if (e.target.closest && e.target.closest(".se-port, .lv-node, .orbit-panel, .lv-palette, .orbit-title, .live-dock, .orbit-bubble, input, button, a")) return;
    if (!onRing(e.clientX, e.clientY)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const b0 = O().siteBox(), f = b0.fit || 1, x0 = e.clientX, y0 = e.clientY, start = { x: b0.ox || 0, y: b0.oy || 0 };
    let last = start, moved = false;
    const fits = (ox, oy) => {
      const b = O().siteBox(), cx = b.px + (b.cx - b.ox + ox - b.px) * f, cy = b.py + (b.cy - b.oy + oy - b.py) * f, a = b.a * f, bb = b.b * f;
      return [[cx - a, cy], [cx + a, cy], [cx, cy - bb], [cx, cy + bb]].every(([px, py]) => !O().inLoop || O().inLoop(px, py));
    };
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true; html.classList.add("se-moving");
      const want = { x: start.x + (ev.clientX - x0) / f, y: start.y + (ev.clientY - y0) / f };
      if (fits(want.x, want.y)) { last = want; O().moveSite(want.x, want.y, false); layout(); }
      ev.preventDefault();
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true);
      html.classList.remove("se-moving");
      if (moved) O().moveSite(last.x, last.y, true);
    };
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true);
  }, true);
  // the ring says it moves
  document.addEventListener("pointermove", e => {
    if (!on() || e.buttons) return;
    const ring = !(e.target.closest && e.target.closest(".se-port, .lv-node, .orbit-panel, .lv-palette, .orbit-title, .live-dock, .orbit-bubble")) && onRing(e.clientX, e.clientY);
    html.classList.toggle("se-ring", !!ring);
  }, true);
  function tick() { layout(); layoutOwned(); restoreShapes(); clipWindows(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick); else tick();
  setInterval(tick, 250);
  window.addEventListener("resize", tick);
  document.addEventListener("se:frame:first", () => { layout(); layoutOwned(); });   // super/motion.js: while something moves, every frame, before the wires
  window.SeSite = { value, setInput, setCondition, setPortInput, ownerName, ownerEl, sizeWindow, shapeEl, inSite, SHAPES, site: () => site, ports: () => ports, portIds: () => Object.keys(ports), portEl: p => ports[p] || null };
})();
