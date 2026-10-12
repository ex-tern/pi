// super/squircle.js: superellipse corners in browsers that cannot draw them (owner, 2026-10-12: "make everything
// superellipses, not round corners").
//
// The superellipse look asks every rounded corner for `corner-shape: superellipse(…)` (super/super.css). Browsers that
// do not know corner-shape (Safari, Firefox in 2026) draw those corners round. Here, in those browsers only, every
// rounded element in the look gets its background and border painted as a superellipse rounded box instead: an SVG
// of its size (n = π, its own radius, its own colours) as its background, with its own background colour and border
// colour made transparent (its border keeps its width, so nothing moves). Elements are looked at again when their
// size or colours change. `?sq=1` turns it on in any browser (to test it).
(function () {
  "use strict";
  const html = document.documentElement;
  const native = !!(window.CSS && CSS.supports && CSS.supports("corner-shape", "superellipse(2)"));
  const force = /[?&]sq=1\b/.test(location.search);
  if (native && !force) return;
  html.classList.add("se-sq");
  const on = () => html.classList.contains("shape-se");
  const N = Math.PI;                                                 // the look's n
  const ROOT = ".orbit-panel, .orbit-bubble, .lv-node, .se-project, .orbit-title, .lv-palette, .live-dock";
  const seen = new WeakMap();                                        // element -> the key it was painted for

  // a superellipse rounded box: straight sides, corners |x/r|^n + |y/r|^n = 1
  function boxPath(x, y, w, h, rx, ry) {
    rx = Math.max(0, Math.min(rx, w / 2)); ry = Math.max(0, Math.min(ry, h / 2));
    const e = 2 / N, K = Math.max(8, Math.min(48, Math.round(Math.max(rx, ry) / 3))), pts = [], f = v => v.toFixed(2);
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= K; i++) {
        const t = a0 + (i / K) * Math.PI / 2, c = Math.cos(t), s = Math.sin(t);
        pts.push([cx + rx * Math.sign(c) * Math.pow(Math.abs(c), e), cy + ry * Math.sign(s) * Math.pow(Math.abs(s), e)]);
      }
    };
    corner(x + w - rx, y + h - ry, 0); corner(x + rx, y + h - ry, Math.PI / 2);
    corner(x + rx, y + ry, Math.PI); corner(x + w - rx, y + ry, 1.5 * Math.PI);
    return "M" + pts.map(p => f(p[0]) + "," + f(p[1])).join("L") + "Z";
  }
  // colours as SVG reads them (rgb/rgba), whatever the page computed them as (color(), color-mix results)
  const cv = document.createElement("canvas").getContext("2d");
  const norm = c => {
    const m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(String(c).trim());
    if (m) return "rgba(" + [m[1], m[2], m[3]].map(v => Math.round(+v * 255)).join(",") + "," + (m[4] == null ? 1 : +m[4]) + ")";
    try { cv.fillStyle = "#000"; cv.fillStyle = c; return cv.fillStyle; } catch (_) { return c; }
  };
  // the glass's own gradient (top to bottom, even stops) as an SVG gradient; anything else is left to the page
  function gradient(img) {
    const m = /^linear-gradient\((.*)\)$/.exec(String(img).trim()); if (!m) return null;
    const parts = []; let depth = 0, cur = "";
    for (const ch of m[1]) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { parts.push(cur.trim()); cur = ""; } else cur += ch; }
    parts.push(cur.trim());
    if (/^(180deg|to bottom)$/.test(parts[0])) parts.shift();
    if (parts.length < 2 || parts.some(p => /deg|turn|to |%|px/.test(p.replace(/\([^)]*\)/g, "")))) return null;
    return parts.map(norm);
  }
  const transparent = c => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  function radius(v, w, h) {
    const parts = String(v).split(" ");
    const one = (s, L) => s.endsWith("%") ? parseFloat(s) / 100 * L : parseFloat(s) || 0;
    let rx = one(parts[0], w), ry = one(parts[1] || parts[0], h);
    const f = Math.min(1, rx > 0 ? w / (2 * rx) : 1, ry > 0 ? h / (2 * ry) : 1);   // as CSS does: radii too big for the box shrink together
    return [rx * f, ry * f];
  }
  // read every element's own colours with our painting off (one style pass for all), then paint them again
  // paint the given elements: read each one's own colours with our painting off (its transitions off too, so the
  // colours read are its own, not halfway), then paint it again. Only elements that changed are touched: a class
  // change, a new element, a new size (owner, 2026-10-12: "graphics should be smoother": no sweeps of the whole page)
  function paint(list) {
    if (!on() || !list.length) return;
    const els = list.filter(el => el.isConnected && el.closest(ROOT) && !(el instanceof SVGElement));
    els.forEach(el => { el.classList.add("se-sq-read"); el.classList.remove("se-sq-on"); });
    const nat = els.map(el => {
      if (!el.getClientRects().length) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, img: cs.backgroundImage, bc: cs.borderTopColor, bw: parseFloat(cs.borderTopWidth) || 0, r: cs.borderTopLeftRadius, w: el.offsetWidth, h: el.offsetHeight };
    });
    els.forEach((el, i) => {
      const n = nat[i]; if (!n) return;
      const [rx, ry] = radius(n.r, n.w, n.h);
      const fill = !transparent(n.bg), stroke = n.bw > 0 && !transparent(n.bc);
      const grad = n.img && n.img !== "none" ? gradient(n.img) : null;
      if (!(rx > 0.5 && ry > 0.5) || !n.w || !n.h || (!fill && !stroke && !grad) || (n.img && n.img !== "none" && !grad)) { seen.delete(el); return; }
      const key = [n.w, n.h, rx.toFixed(1), ry.toFixed(1), n.bg, n.bc, n.bw, n.img].join("|");
      if (seen.get(el) !== key) {
        seen.set(el, key);
        const k = stroke ? n.bw / 2 : 0;
        const d = boxPath(k, k, n.w - 2 * k, n.h - 2 * k, Math.max(0, rx - k), Math.max(0, ry - k));
        const defs = grad ? "<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>" + grad.map((c, j) => "<stop offset='" + (j / (grad.length - 1)) + "' stop-color='" + c + "'/>").join("") + "</linearGradient></defs>" : "";
        const under = fill && grad ? "<path d='" + d + "' fill='" + norm(n.bg) + "'/>" : "";
        const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='" + n.w + "' height='" + n.h + "' viewBox='0 0 " + n.w + " " + n.h + "'>" + defs + under +
          "<path d='" + d + "' fill='" + (grad ? "url(#g)" : fill ? norm(n.bg) : "none") + "' stroke='" + (stroke ? norm(n.bc) : "none") + "' stroke-width='" + (stroke ? n.bw : 0) + "'/></svg>";
        el.style.setProperty("--se-sq", 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")');
        // its own corner, rounded less: the painted superellipse is drawn whole inside it; 0.6 of the radius keeps every
        // point of the n = π corner inside the clip
        el.style.setProperty("--se-sq-r", (rx * 0.6).toFixed(1) + "px " + (ry * 0.6).toFixed(1) + "px");
      }
      el.classList.add("se-sq-on");
      if (!el._sqRo && window.ResizeObserver) { el._sqRo = true; ro.observe(el); }
    });
    void document.body.offsetWidth;                                     // painted before transitions return
    els.forEach(el => el.classList.remove("se-sq-read"));
  }
  const dirty = new Set();
  let asked = false;
  const flush = () => { asked = false; const list = [...dirty]; dirty.clear(); paint(list); };
  const mark = el => { if (el && el.nodeType === 1) { dirty.add(el); if (!asked) { asked = true; requestAnimationFrame(flush); } } };
  const ro = window.ResizeObserver ? new ResizeObserver(es => es.forEach(e => mark(e.target))) : { observe() {} };
  function sweep() {                                                   // everything, once (the start, a new look)
    if (!on()) return;
    document.querySelectorAll(ROOT).forEach(r => { mark(r); r.querySelectorAll("*").forEach(mark); });
  }
  const OURS = new Set(["se-sq-on", "se-sq-read"]);
  new MutationObserver(ms => {
    if (!on()) return;
    for (const m of ms) {
      if (m.type === "childList") { m.addedNodes.forEach(n => { if (n.nodeType === 1 && n.closest && n.closest(ROOT)) { mark(n); n.querySelectorAll && n.querySelectorAll("*").forEach(mark); } }); continue; }
      const el = m.target; if (!el.closest || !el.closest(ROOT)) continue;
      const before = new Set(String(m.oldValue || "").split(/\s+/).filter(c => c && !OURS.has(c)));
      const now = [...el.classList].filter(c => !OURS.has(c));
      if (now.length !== before.size || now.some(c => !before.has(c))) mark(el);   // a real change of state, not our own painting
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
  const style = document.createElement("style");
  style.textContent =
    "html.se-sq.shape-se .se-sq-on { background-color: transparent !important; border-color: transparent !important;" +
    " background-image: var(--se-sq) !important; background-size: 100% 100% !important; background-repeat: no-repeat !important;" +
    " background-origin: border-box !important; background-clip: border-box !important; border-radius: var(--se-sq-r, 0) !important; }" +
    " html.se-sq.shape-se :is(.orbit-bubble.is-group, .orbit-panel, .se-project, .lv-node, .orbit-title .se-titlesuper).se-sq-on::before { display: none !important; }" +
    // a shadow that follows the painted superellipse (a box shadow would follow the clip, a rounded box)
    " .se-sq-read, .se-sq-read::before, .se-sq-read::after { transition: none !important; }" +
    " html.se-sq.shape-se .se-sq-on { box-shadow: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }" +
    " html.se-sq.shape-se :is(.orbit-bubble.is-group, .se-project, .lv-node, .orbit-title .se-titlesuper).se-sq-on { filter: drop-shadow(0 8px 14px rgba(70, 36, 12, 0.20)) !important; }";
  document.head.appendChild(style);
  let t = 0;
  const soon = () => { clearTimeout(t); t = setTimeout(sweep, 120); };
  window.addEventListener("resize", soon);
  let wasOn = on();
  new MutationObserver(() => { if (on() !== wasOn) { wasOn = on(); if (wasOn) soon(); } }).observe(html, { attributes: true, attributeFilter: ["class"] });   // the look turned on later
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", soon); else soon();
  window.SeSquircle = { sweep, boxPath };
})();
