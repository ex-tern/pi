// super/logo.js — the "Pi Tech Lab" title drawn from superellipses, in a
// superellipse badge, for the superellipse look (super/super.css, html.shape-se).
//
// A superellipse is |x/a|^n + |y/b|^n = 1 (n = 2 is an ellipse; higher n
// squares it off). Every bowl in the word (P, e, c, h, a, b) is a ring between
// two superellipses, the dot of the i is a small one, and the badge around the
// word is a superellipse too. Stems and bars are plain strokes of the same
// weight. All of it is generated here as one SVG, so the exponent is one number.
(function () {
  "use strict";
  const N = 4;                     // the exponent: 4 is the classic squircle
  const CAP = 100, X = 70, S = 13; // cap height, x-height, stroke (units)
  const BASE = CAP;                // baseline y

  // Points round a superellipse centred at (cx, cy) with half-axes a, b.
  // `reverse` winds it the other way, which makes it a hole (nonzero fill).
  function se(cx, cy, a, b, n, steps, reverse) {
    const pts = [];
    steps = steps || 96;
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      pts.push([cx + a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), cy + b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]);
    }
    if (reverse) pts.reverse();
    return "M" + pts.map(p => p[0].toFixed(2) + "," + p[1].toFixed(2)).join("L") + "Z";
  }
  const ring = (x, y, w, h) => se(x + w / 2, y + h / 2, w / 2, h / 2, N) + se(x + w / 2, y + h / 2, w / 2 - S, h / 2 - S, N, 96, true);
  const rect = (x, y, w, h) => "M" + x + "," + y + "h" + w + "v" + h + "h" + -w + "Z";

  let maskN = 0;
  // A glyph: filled paths, optionally with rectangles cut out of it.
  function glyph(x, w, parts, cuts) {
    let defs = "", attr = "";
    if (cuts && cuts.length) {
      const id = "selm" + (maskN++);
      defs = '<mask id="' + id + '" maskUnits="userSpaceOnUse"><rect x="' + (x - 5) + '" y="-20" width="' + (w + 10) + '" height="140" fill="#fff"/>' +
             cuts.map(c => '<path d="' + rect(...c) + '" fill="#000"/>').join("") + '</mask>';
      attr = ' mask="url(#' + id + ')"';
    }
    return { w, svg: defs + '<path class="sel-ink" fill-rule="nonzero"' + attr + ' d="' + parts.join("") + '"/>' };
  }
  const G = {
    P: x => glyph(x, 62, [rect(x, 0, S, CAP), ring(x, 0, 62, 60)]),
    i: x => ({ w: S, svg: '<path class="sel-ink" d="' + rect(x, BASE - X, S, X) + '"/>' +
                          '<path class="sel-dot" d="' + se(x + S / 2, BASE - X - 18, S / 2 + 5, S / 2 + 5, 0.5772156649) + '"/>' }),
    T: x => glyph(x, 64, [rect(x, 0, 64, S), rect(x + 32 - S / 2, 0, S, CAP)]),
    e: x => glyph(x, 60, [ring(x, BASE - X, 60, X), rect(x + S / 2, BASE - X / 2 - S / 2, 60 - S, S)],
                  [[x + 34, BASE - X / 2 + S / 2, 32, 17]]),
    c: x => glyph(x, 58, [ring(x, BASE - X, 58, X)], [[x + 34, BASE - X + 22, 30, X - 44]]),
    h: x => glyph(x, 60, [rect(x, 0, S, CAP), ring(x, BASE - X, 60, X), rect(x + 60 - S, BASE - X / 2, S, X / 2)],
                  [[x + S, BASE - X / 2, 60 - 2 * S, X / 2 + 5]]),
    L: x => glyph(x, 52, [rect(x, 0, S, CAP), rect(x, BASE - S, 52, S)]),
    a: x => glyph(x, 62, [ring(x, BASE - X, 62, X), rect(x + 62 - S, BASE - X / 2, S, X / 2)]),
    b: x => glyph(x, 62, [rect(x, 0, S, CAP), ring(x, BASE - X, 62, X)]),
  };
  const TRACK = 11, SPACE = 34;

  function build(word) {
    maskN = 0;
    let x = 0, body = "";
    for (const ch of word) {
      if (ch === " ") { x += SPACE; continue; }
      const g = G[ch](x);
      body += g.svg;
      x += g.w + TRACK;
    }
    const w = x - TRACK, padX = 90, padY = 26;   // snug all round (was 70 × 42); at n = 6 the ends are square enough for the letters
    const vb = [-padX, -padY, w + 2 * padX, CAP + 2 * padY];
    // the badge is a super, n = 6 (BADGE_N: a squarer badge, as in the owner's screenshot of 2026-10-11; the
    // letters keep n = 4), until shift + scroll on the title gives it an n of its own (super/scroll.js, SeLogo.setN)
    geo = { w, padX, padY };
    return '<svg class="se-logo" viewBox="' + vb.join(" ") + '" aria-hidden="true" focusable="false">' +
           '<path class="sel-badge" d="' + badgePath(badgeN || BADGE_N) + '"/>' + body + '</svg>';
  }
  let geo = null, badgeN = 0;
  const BADGE_N = 6;
  const badgePath = n => se(geo.w / 2, CAP / 2, geo.w / 2 + geo.padX - 3, CAP / 2 + geo.padY - 3, n, 160);
  function setN(n) {
    badgeN = n;
    const b = document.querySelector(".orbit-title .sel-badge");
    if (b && geo) b.setAttribute("d", badgePath(n));
    const sup = document.querySelector(".orbit-title .se-titlesuper");
    if (sup) sup.style.setProperty("--sts-k", Math.log2(Math.max(0.3, n)).toFixed(4));
  }

  // The title is a simple super, like every other: a ■ at n = π with its four ports, "pi tech lab" inside
  // in the diagram's mono type. (build() still draws the superellipse lettering, for anything that wants it.)
  const TITLE_N = Math.PI;
  function apply() {
    if (!document.documentElement.classList.contains("shape-se")) return false;
    const t = document.querySelector(".orbit-title");
    if (!t || t.querySelector(".se-titlesuper")) return !!t;
    t.insertAdjacentHTML("afterbegin", '<span class="se-titlesuper" aria-hidden="true"><span class="sts-text">pi tech lab</span>' +
      '<i class="sts-p sts-in"></i><i class="sts-p sts-out"></i><i class="sts-p sts-sync"></i><i class="sts-p sts-cond"></i></span>');
    t.title = "Pi Tech Lab";
    if (badgeN) setN(badgeN);
    if (window.PiOrbit && window.PiOrbit.layout) window.PiOrbit.layout();
    return true;
  }
  // the look is decided by channel.js, possibly after /api/build answers
  function start() {
    if (apply()) return;
    new MutationObserver((_, mo) => { if (apply()) mo.disconnect(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
  window.SeLogo = { build, setN, n: () => badgeN || TITLE_N };
})();
