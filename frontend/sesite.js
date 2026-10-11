// sesite.js — the superellipse superlattice ("super"): the site itself is a super inside the
// main super. The bubbles sit inside an inner superellipse (the same n as the main loop, so
// scrolling morphs both), with four ports on its sides, LabVIEW style:
//
//   input      (left)    what is wired in is the site's question: every engine answers it
//   output     (right)   the site's answer (the Super Neural Engine's), a value for ■, +, ◆, ?
//   sync       (top)     the site's clock: how many digits of π it has, ticking
//   condition  (bottom)  wired true the site runs, wired false it pauses (π and the engines)
//
// A faint lattice line runs from each port out to the main loop: the inner super is a node of
// the outer one. Ports are wire ends like anything else (superlink.js: drag from a port, drop a
// node on it, draw a wire to it); labview.js reads them as values (SeSite.value) and feeds the
// input and condition ports from what is wired into them.
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
      el.className = "se-port se-port-" + side; el.dataset.port = p;
      el.innerHTML = '<span class="se-port-dot" aria-hidden="true"></span><span class="se-port-name">' + p + "</span>";
      el.title = { input: "input: wire a question in, every engine answers", output: "output: the site's answer", sync: "sync: the site's clock, π's digits", condition: "condition: wired false, the site pauses" }[p];
      document.body.appendChild(el); ports[p] = el;
    });
  }

  // the inner super: around every bubble, the same n as the main loop
  function layout() {
    if (!on()) { if (svg) svg.style.display = "none"; Object.values(ports).forEach(p => { p.style.display = "none"; }); return; }
    build(); if (!svg) return;
    svg.style.display = ""; Object.values(ports).forEach(p => { p.style.display = ""; });
    const k = [...document.querySelectorAll(".orbit-bubble")].filter(el => !el.hidden && el.getClientRects().length).length;
    const g = O().loop ? O().loop() : null, box = O().siteBox ? O().siteBox() : null;
    if (!k || !g || !g.a || !box) { svg.style.display = "none"; Object.values(ports).forEach(p => { p.style.display = "none"; }); return; }
    const n = g.n, f = box.fit || 1;
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
  function value(port) {
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
  // labview.js tells the ports what is wired into them
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
  function clipWindows() {
    if (!on() || hasCorner || !SM()) return;
    document.querySelectorAll(".orbit-panel").forEach(p => {
      const w = p.offsetWidth, h = p.offsetHeight, key = w + "x" + h;
      if (!w || p.dataset.seClip === key) return;
      p.dataset.seClip = key;
      const d = SM().path(0, 0, w, h, [w / 2, h / 2], SM().pi, 24);
      p.style.clipPath = "path('" + d + "')";
      let o = p.querySelector(":scope > .op-outline");
      if (!o) { o = document.createElementNS("http://www.w3.org/2000/svg", "svg"); o.setAttribute("class", "op-outline"); o.setAttribute("aria-hidden", "true"); o.innerHTML = "<path/>"; p.appendChild(o); }
      o.setAttribute("viewBox", "0 0 " + w + " " + h); o.querySelector("path").setAttribute("d", d);
    });
  }
  // sezoom.js: a scroll on a window sizes it (about its centre), unless its content scrolls
  function sizeWindow(p, dy) {
    const r = p.getBoundingClientRect(), k = Math.exp(-dy * 0.0015);
    const w = Math.max(260, Math.min(window.innerWidth - 16, r.width * k)), h = Math.max(140, Math.min(window.innerHeight - 16, r.height * k));
    p.style.width = w + "px"; p.style.height = h + "px";
    p.style.left = Math.round(r.left + r.width / 2 - w / 2) + "px"; p.style.top = Math.round(r.top + r.height / 2 - h / 2) + "px";
    if (p.item && O().saveWin) O().saveWin(p.item, p);
  }

  function tick() { layout(); clipWindows(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick); else tick();
  setInterval(tick, 250);
  window.addEventListener("resize", tick);
  window.SeSite = { value, setInput, setCondition, sizeWindow, site: () => site, ports: () => ports, portEl: p => ports[p] || null };
})();
