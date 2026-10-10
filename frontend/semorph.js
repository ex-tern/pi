// semorph.js — in the superellipse look (html.shape-se), the shape's exponent n
// says what a thing is:
//
//   a button   n = γ, the Euler–Mascheroni constant (0.5772…): concave corners
//   a window   n = π (3.1415…): full, nearly square corners
//
// Both are computed here, in the page, and keep improving while it is open:
//   γ = H_m − ln m − 1/(2m) + 1/(12m²) − 1/(120m⁴), with m growing each tick
//       (the digits from consts-worker.js take over once the Numbers window has them);
//   π from the live digits the mark is computing (orbit.js), until then from
//       Machin's formula summed term by term.
// The values go to CSS as corner-shape: superellipse(K), where n = 2^K.
//
// Opening a window grows it out of its button and n climbs from γ to π;
// closing it shrinks it back while n falls to γ. The moving outline is drawn
// here from the superellipse itself, so every browser sees the same morph,
// even those without CSS corner-shape.
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---- γ, by the harmonic series with its asymptotic correction ----------
  let m = 0, H = 0, gamma = 0.5;
  function stepGamma(k) {
    for (let i = 0; i < k; i++) { m++; H += 1 / m; }
    const m2 = m * m;
    gamma = H - Math.log(m) - 1 / (2 * m) + 1 / (12 * m2) - 1 / (120 * m2 * m2);
  }
  // ---- π, by Machin until the mark's digits arrive -----------------------
  let piTerm = 0, piSum = 0, pi = 3;
  function stepPi() {
    const live = window.PiOrbit && window.PiOrbit.piDigits && window.PiOrbit.piDigits();
    if (live && live.length > 16) { pi = parseFloat(live[0] + "." + live.slice(1, 17)); return; }
    // π/4 = 4 atan(1/5) − atan(1/239)
    const k = piTerm++, s = k % 2 ? -1 : 1, d = 2 * k + 1;
    piSum += s * (4 / (d * Math.pow(5, d)) - 1 / (d * Math.pow(239, d)));
    pi = 4 * piSum;
  }
  // the exact digits from the Numbers window, when they exist
  function fromNumbers() {
    const rows = document.querySelectorAll(".nb-row");
    for (const r of rows) {
      if (r.querySelector(".nb-sym") && r.querySelector(".nb-sym").textContent === "γ") {
        const t = (r.querySelector(".nb-digits") || {}).textContent || "";
        if (t.length > 18) { gamma = parseFloat(t.slice(0, 18)); return true; }
      }
    }
    return false;
  }

  const K = n => Math.log2(n);
  const last = {};
  const put = (name, v) => { if (last[name] !== v) { html.style.setProperty(name, v); last[name] = v; } };
  function publish() {
    put("--se-k-button", K(gamma).toFixed(6)); put("--se-n-button", gamma.toFixed(10));
    put("--se-k-window", K(pi).toFixed(6)); put("--se-n-window", pi.toFixed(10));
  }
  let gammaFixed = false;
  function tick() {
    if (!gammaFixed) { gammaFixed = fromNumbers(); if (!gammaFixed && m < 2e7) stepGamma(m < 1000 ? 50 : 5000); }
    stepPi();
    publish();
  }
  tick();
  setInterval(tick, 250);

  // ---- the superellipse outline of a box ---------------------------------
  // Each corner is a quarter of |x/r|^n + |y/r|^n = 1 about the point r in
  // from the corner, the same geometry CSS uses for corner-shape.
  function boxPath(x, y, w, h, r, n, steps) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    steps = steps || 18;
    const e = 2 / n, pts = [];
    // walking clockwise from the top edge: top-right, bottom-right, bottom-left, top-left
    const tr = (cx, cy) => { for (let i = 0; i <= steps; i++) { const t = (1 - i / steps) * Math.PI / 2; pts.push([cx + r * Math.pow(Math.abs(Math.cos(t)), e), cy - r * Math.pow(Math.abs(Math.sin(t)), e)]); } };
    const br = (cx, cy) => { for (let i = 0; i <= steps; i++) { const t = (i / steps) * Math.PI / 2; pts.push([cx + r * Math.pow(Math.abs(Math.cos(t)), e), cy + r * Math.pow(Math.abs(Math.sin(t)), e)]); } };
    const bl = (cx, cy) => { for (let i = 0; i <= steps; i++) { const t = (1 - i / steps) * Math.PI / 2; pts.push([cx - r * Math.pow(Math.abs(Math.cos(t)), e), cy + r * Math.pow(Math.abs(Math.sin(t)), e)]); } };
    const tl = (cx, cy) => { for (let i = 0; i <= steps; i++) { const t = (i / steps) * Math.PI / 2; pts.push([cx - r * Math.pow(Math.abs(Math.cos(t)), e), cy - r * Math.pow(Math.abs(Math.sin(t)), e)]); } };
    tr(x + w - r, y + r); br(x + w - r, y + h - r); bl(x + r, y + h - r); tl(x + r, y + r);
    return "M" + pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L") + "Z";
  }

  // ---- the morph ---------------------------------------------------------
  const DUR = 460;
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const radiusOf = el => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.borderTopLeftRadius) || 0;
  };
  const rectOf = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const usable = el => el && el.isConnected && el.getClientRects().length && rectOf(el).w > 0;

  function ghost() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "se-morph");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", window.innerWidth); svg.setAttribute("height", window.innerHeight);
    const path = document.createElementNS(NS, "path");
    svg.appendChild(path);
    document.body.appendChild(svg);
    return { svg, path };
  }
  // from {rect, r, n} to {rect, r, n}; done() at the end
  function run(a, b, done) {
    const g = ghost();
    const t0 = performance.now();
    const lerp = (p, q, t) => p + (q - p) * t;
    function frame(now) {
      const t = Math.max(0, Math.min(1, (now - t0) / DUR)), k = ease(t);
      const x = lerp(a.rect.x, b.rect.x, k), y = lerp(a.rect.y, b.rect.y, k);
      const w = lerp(a.rect.w, b.rect.w, k), h = lerp(a.rect.h, b.rect.h, k);
      const r = lerp(a.r, b.r, k), n = lerp(a.n, b.n, k);
      g.path.setAttribute("d", boxPath(x, y, w, h, r, n));
      g.svg.dataset.n = n.toFixed(4);
      if (t < 1) requestAnimationFrame(frame);
      else { g.svg.remove(); if (done) done(); }
    }
    requestAnimationFrame(frame);
    return g;
  }

  // a window opens: it grows out of the button that opened it
  function open(panel, from) {
    if (!on() || reduce.matches || !panel || !usable(from)) return;
    const a = { rect: rectOf(from), r: radiusOf(from), n: gamma };
    const b = { rect: rectOf(panel), r: radiusOf(panel), n: pi };
    panel.classList.add("se-arriving");
    run(a, b, () => {
      panel.classList.remove("se-arriving");
      panel.classList.add("se-arrived");
      setTimeout(() => panel.classList.remove("se-arrived"), 260);
    });
  }
  // a window closes: it folds back into its button (call before removing it)
  function close(panel, to) {
    if (!on() || reduce.matches || !panel || !panel.isConnected) return;
    const a = { rect: rectOf(panel), r: radiusOf(panel), n: pi };
    if (!usable(to)) return;
    const b = { rect: rectOf(to), r: radiusOf(to), n: gamma };
    run(a, b);
  }

  window.SeMorph = { open, close, path: boxPath, get gamma() { return gamma; }, get pi() { return pi; } };
})();
