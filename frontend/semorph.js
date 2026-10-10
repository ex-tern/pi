// semorph.js — in the superellipse look (html.shape-se), the shape's exponent n
// says what a thing is:
//
//   a button   a full superellipse whose n grows with use: never used, it is
//              a four-pointed star at n = γ (0.5772…, the Euler–Mascheroni
//              constant) beside its name; used, it widens into the shape at
//              n = π around the name. Hover shows it fully grown.
//   an object  (bubbles, buttons in windows, nodes, the central loop): a full
//              symmetric superellipse at n = π
//   a window   n = π (3.1415…): full, nearly square corners
//   a dot      the whole superellipse at n = γ: a sparkle (--se-sparkle)
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
    put("--se-sparkle", "polygon(" + starPts(gamma, 48).map(p => (50 + 50 * p[0]).toFixed(2) + "% " + (50 + 50 * p[1]).toFixed(2) + "%").join(", ") + ")");
  }
  // n grows with use: a button you never opened is γ; the more you open it,
  // the closer it comes to π, the shape of the window it opens.
  //   n(u) = γ + (π − γ) · u / (u + 8),  u = times opened
  const nOfUse = u => gamma + (pi - gamma) * u / (u + 8);
  function perButton() {
    if (!on() || !window.PiOrbit || !window.PiOrbit.info) return;
    // the pills are the buttons; bubbles are objects and keep n = π
    document.querySelectorAll(".ob-member[data-key]").forEach(el => {
      const i = window.PiOrbit.info(el.dataset.key);
      if (!i) return;
      const u = i.use || 0, n = nOfUse(u), k = K(n).toFixed(5);
      if (el.dataset.seK !== k) {
        el.dataset.seK = k; el.dataset.seN = n.toFixed(5);
        el.style.setProperty("--se-k", k);
        el.style.setProperty("--se-t", (u / (u + 8)).toFixed(4));   // 0: a star beside the name, 1: the shape around it
        el.title = el.title.replace(/ · n = [\d.]+$/, "") + " · n = " + n.toFixed(4);
      }
    });
  }
  let gammaFixed = false;
  function tick() {
    if (!gammaFixed) { gammaFixed = fromNumbers(); if (!gammaFixed && m < 2e7) stepGamma(m < 1000 ? 50 : 5000); }
    stepPi();
    publish();
    perButton();
  }
  tick();
  setInterval(tick, 250);

  // ---- the superellipse outline of a box ---------------------------------
  // Each corner is a quarter of |x/r|^n + |y/r|^n = 1 about the point r in
  // from the corner, the same geometry CSS uses for corner-shape.
  function boxPath(x, y, w, h, r, n, steps) {
    let rx = Array.isArray(r) ? r[0] : r, ry = Array.isArray(r) ? r[1] : r;
    rx = Math.max(0, Math.min(rx, w / 2)); ry = Math.max(0, Math.min(ry, h / 2));
    steps = steps || 18;
    const e = 2 / n, pts = [];
    const q = (cx, cy, sx, sy, up) => {
      for (let i = 0; i <= steps; i++) {
        const t = (up ? 1 - i / steps : i / steps) * Math.PI / 2;
        pts.push([cx + sx * rx * Math.pow(Math.abs(Math.cos(t)), e), cy + sy * ry * Math.pow(Math.abs(Math.sin(t)), e)]);
      }
    };
    // clockwise from the top edge: top-right, bottom-right, bottom-left, top-left
    q(x + w - rx, y + ry, 1, -1, true); q(x + w - rx, y + h - ry, 1, 1, false);
    q(x + rx, y + h - ry, -1, 1, true); q(x + rx, y + ry, -1, -1, false);
    return "M" + pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L") + "Z";
  }
  // a whole superellipse at n = γ: the four-pointed sparkle (dots, wire ends)
  function starPts(n, steps) {
    const e = 2 / n, pts = [];
    for (let i = 0; i < steps; i++) {
      const t = i / steps * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      pts.push([Math.sign(c) * Math.pow(Math.abs(c), e), Math.sign(s) * Math.pow(Math.abs(s), e)]);
    }
    return pts;
  }
  function star(cx, cy, a, b, n) {
    return "M" + starPts(n || gamma, 48).map(p => (cx + a * p[0]).toFixed(2) + "," + (cy + b * p[1]).toFixed(2)).join("L") + "Z";
  }

  // ---- the morph ---------------------------------------------------------
  const DUR = 460;
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  // the corner radii [rx, ry] in px ("1.2em / 50%" computes to "14px 50%")
  const radiusOf = el => {
    const v = getComputedStyle(el).borderTopLeftRadius.split(" "), r = el.getBoundingClientRect();
    const px = (t, size) => t && t.endsWith("%") ? parseFloat(t) / 100 * size : parseFloat(t) || 0;
    return [px(v[0], r.width), px(v[1] || v[0], r.height)];
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
      const r = [lerp(a.r[0], b.r[0], k), lerp(a.r[1], b.r[1], k)], n = lerp(a.n, b.n, k);
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
    const a = { rect: rectOf(from), r: radiusOf(from), n: +from.dataset.seN || gamma };
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
    const b = { rect: rectOf(to), r: radiusOf(to), n: +to.dataset.seN || gamma };
    run(a, b);
  }

  // a wire: straight runs with two superellipse corners (n = π), out of one side and into the other
  // (horizontal) or out of the bottom and into the top; nearly straight when the ends line up
  function wire(x1, y1, x2, y2, horizontal) {
    const f = v => v.toFixed(1);
    if (!horizontal) {                                            // the same, with the axes swapped
      const d = wire(y1, x1, y2, x2, true);
      return d.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, a, b) => b + "," + a);
    }
    const dx = x2 - x1, dy = y2 - y1, sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;
    const r = Math.min(Math.abs(dx) / 2, Math.abs(dy) / 2, 26);
    if (r < 1.5) return "M" + f(x1) + "," + f(y1) + "L" + f(x2) + "," + f(y2);
    const mx = (x1 + x2) / 2, e = 2 / pi, K = 10, pts = [];
    let cx = mx - r * sx, cy = y1 + r * sy;                       // first corner: from going along to going across
    for (let i = 0; i <= K; i++) { const t = i / K * Math.PI / 2; pts.push([cx + r * sx * Math.pow(Math.sin(t), e), cy - r * sy * Math.pow(Math.cos(t), e)]); }
    cx = mx + r * sx; cy = y2 - r * sy;                           // second corner: back to going along
    for (let i = 0; i <= K; i++) { const t = i / K * Math.PI / 2; pts.push([cx - r * sx * Math.pow(Math.cos(t), e), cy + r * sy * Math.pow(Math.sin(t), e)]); }
    return "M" + f(x1) + "," + f(y1) + pts.map(q => "L" + f(q[0]) + "," + f(q[1])).join("") + "L" + f(x2) + "," + f(y2);
  }
  window.SeMorph = { wire, open, close, path: boxPath, star, nOfUse, get gamma() { return gamma; }, get pi() { return pi; } };
})();
