// super/shiftsize.js: Shift + drag sizes a super, its width and its height apart (owner, 2026-10-12: "pushing shift also
// can control width and height of the super"). Held Shift, a drag on a super moves its right edge with the pointer's
// x and its bottom edge with its y: a Super AI super or a holder (super/nodes.js LabView.resize), a window (it is then
// a window you sized yourself) and a compact bubble (kept as se:size:<key>). Shift + scroll still changes its n.
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {};
  const SEL = ".lv-node, .orbit-panel, .orbit-bubble.is-group, .se-project:not(.is-open), .orbit-title .se-titlesuper";   // every super, a bubble open or compact
  const BARE = ".orbit-stage, .orbit-bubbles, .om-page, .om-site, .lv-canvas, .se-gl-canvas, .orbit-rings";
  // the smallest holder under a point (a press on its bare space reaches the page, not the holder)
  const holderAt = (x, y) => [...document.querySelectorAll(".lv-node.is-holder")].map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(o => x >= o.r.left && x <= o.r.right && y >= o.r.top && y <= o.r.bottom).sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height).map(o => o.el)[0] || null;
  const fit = () => (O().fit ? O().fit().f : 1) || 1;
  const keyOf = el => el.dataset.key || "";
  function load(k) { try { return JSON.parse(localStorage.getItem("se:size:" + k) || "null"); } catch (_) { return null; } }
  function save(k, v) { try { localStorage.setItem("se:size:" + k, JSON.stringify(v)); } catch (_) { /* private mode */ } }
  function sizeBubble(b, w, h) {
    b.style.width = Math.round(w) + "px"; b.style.height = Math.round(h) + "px";
    b.classList.add("se-sized");
  }
  let drag = null;
  window.addEventListener("pointerdown", e => {
    if (!on() || !e.shiftKey || e.button !== 0) return;
    const t = e.target && e.target.closest ? e.target : null;
    if (!t || t.closest("input, textarea, select, [contenteditable], .se-port, .se-lock, .wire-hit")) return;
    const bare = t === document.body || t === document.documentElement || (t.matches && t.matches(BARE));
    const el = t.closest(SEL) || (bare ? holderAt(e.clientX, e.clientY) : null); if (!el) return;
    if (window.SeLock && window.SeLock.isLocked(el)) {                // locked: its size is kept
      e.preventDefault(); e.stopImmediatePropagation();
      /* a locked super simply does nothing: no note (owner, 2026-10-13) */
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    const f = el.classList.contains("orbit-panel") || el.classList.contains("se-titlesuper") ? 1 : fit();   // nodes, bubbles and the project are sized in layout px
    // the edge nearest the press follows the pointer, the opposite one stays where it is (owner, 2026-10-12: "shift+mouse
    // to resize doesnt work properly": it always grew to the right and down, whichever side you took)
    const r = el.getBoundingClientRect(), sx = e.clientX >= r.left + r.width / 2 ? 1 : -1, sy = e.clientY >= r.top + r.height / 2 ? 1 : -1;
    const node0 = el.classList.contains("lv-node") && window.LabView && window.LabView.rectOf ? window.LabView.rectOf(el) : null;
    const outs = window.SeHold && window.SeHold.outsiders ? window.SeHold.outsiders(el) : [];   // what it may not grow over
    drag = { outs, el, x0: e.clientX, y0: e.clientY, w0: node0 ? node0.w : el.offsetWidth, h0: node0 ? node0.h : el.offsetHeight, f, id: e.pointerId, sx, sy, node0, left0: el.offsetLeft, top0: el.offsetTop };
    drag.good = { x: node0 ? node0.x : 0, y: node0 ? node0.y : 0, w: drag.w0, h: drag.h0, sw: el.style.width, sh: el.style.height, sl: el.style.left, st: el.style.top };   // where it may go back to
    html.classList.add("se-shift-sizing");
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
  }, true);
  window.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault(); e.stopImmediatePropagation();
    // any size if unlocked (owner, 2026-10-12: "any super can get any size if its unlocked"): from 16 px to the whole
    // inner super, no more (the largest fills the second super)
    const sb = O().siteBox ? O().siteBox() : null, sf = sb && sb.a ? (sb.fit || 1) : 1;
    const capW = sb && sb.a ? 2 * sb.a * sf / drag.f : Infinity, capH = sb && sb.b ? 2 * sb.b * sf / drag.f : Infinity;
    drag.full = drag.w0 + drag.sx * (e.clientX - drag.x0) / drag.f >= capW - 1 && drag.h0 + drag.sy * (e.clientY - drag.y0) / drag.f >= capH - 1;
    const w = Math.min(capW, Math.max(10, drag.w0 + drag.sx * (e.clientX - drag.x0) / drag.f)), h = Math.min(capH, Math.max(10, drag.h0 + drag.sy * (e.clientY - drag.y0) / drag.f)), el = drag.el;
    if (el.classList.contains("lv-node")) {
      const n0 = drag.node0;
      // the far edge stays put, and the super stays within the inner super (as big as it, it fills it)
      let x = drag.sx < 0 ? (n0 ? n0.x + n0.w - w : 0) : (n0 ? n0.x : 0), y = drag.sy < 0 ? (n0 ? n0.y + n0.h - h : 0) : (n0 ? n0.y : 0);
      if (n0 && sb && sb.a) { x = Math.max(sb.cx - sb.a, Math.min(sb.cx + sb.a - w, x)); y = Math.max(sb.cy - sb.b, Math.min(sb.cy + sb.b - h, y)); }
      if (n0 && window.LabView.setRect) window.LabView.setRect(el, x, y, w, h);
      else if (window.LabView && window.LabView.resize) window.LabView.resize(el, w, h);
    }
    else if (el.classList.contains("orbit-panel")) {
      const W = Math.round(Math.max(24, w)), H = Math.round(Math.max(24, h));
      el.style.width = W + "px"; el.style.height = H + "px";
      if (drag.sx < 0) el.style.left = (drag.left0 + drag.w0 - W) + "px";
      if (drag.sy < 0) el.style.top = (drag.top0 + drag.h0 - H) + "px";
      el.userSized = true; el.seSized = true;
    } else if (el.classList.contains("se-project")) { if (window.SeProject && window.SeProject.resize) window.SeProject.resize(w, h); }
    else if (el.classList.contains("se-titlesuper")) { el.style.width = Math.round(w) + "px"; el.style.height = Math.round(h) + "px"; }
    else sizeBubble(el, w, h);
    // it never grows over a super outside it (owner, 2026-10-12): a step that would is taken back
    const nb = el.getBoundingClientRect();
    if (drag.outs.length && window.SeHold.wouldMeet({ left: nb.left, top: nb.top, right: nb.right, bottom: nb.bottom }, drag.outs) && drag.good) {
      const g = drag.good;
      if (el.classList.contains("lv-node") && window.LabView.setRect && drag.node0) window.LabView.setRect(el, g.x, g.y, g.w, g.h);
      else { el.style.width = g.sw; el.style.height = g.sh; el.style.left = g.sl; el.style.top = g.st; if (el.classList.contains("se-project") && window.SeProject && window.SeProject.resize) window.SeProject.resize(g.w, g.h); }
      if (window.SeShape && window.SeShape.note) window.SeShape.note(e.clientX, e.clientY, "stops here", "it grows over no super outside it");
      return;
    }
    drag.good = { x: window.LabView && window.LabView.rectOf && el.classList.contains("lv-node") ? window.LabView.rectOf(el).x : 0, y: window.LabView && window.LabView.rectOf && el.classList.contains("lv-node") ? window.LabView.rectOf(el).y : 0, w, h, sw: el.style.width, sh: el.style.height, sl: el.style.left, st: el.style.top };
    if (window.SeShape) window.SeShape.size && window.SeShape.size(e.clientX, e.clientY, Math.round(w), Math.round(h));
    document.dispatchEvent(new CustomEvent("se:frame"));
  }, true);
  const end = e => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const el = drag.el, d0 = drag; drag = null; html.classList.remove("se-shift-sizing");
    // dragged out to the whole inner super, a super fills it (super/maximize.js); a scroll out gives back its size before
    if (d0.full && window.SeMax && (el.classList.contains("lv-node") || el.classList.contains("orbit-panel"))) {
      const back = d0.node0 ? { x: d0.node0.x, y: d0.node0.y, w: d0.node0.w, h: d0.node0.h } : { x: d0.left0, y: d0.top0, w: d0.w0, h: d0.h0 };
      setTimeout(() => window.SeMax.maximize(el, back), 30);
    }
    if (el.classList.contains("orbit-bubble")) { const k = keyOf(el); if (k) save(k + (el.classList.contains("is-compact") ? "" : ":open"), { w: el.offsetWidth, h: el.offsetHeight }); }
    if (el.classList.contains("se-titlesuper")) save("title", { w: el.offsetWidth, h: el.offsetHeight });
    if (O().layout) O().layout();
    document.dispatchEvent(new CustomEvent("se:obstacle"));
  };
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
  // a bubble sized by hand keeps its size (compact only: open, it is as big as its pills)
  function restore() {
    if (!on()) return;
    const ts = document.querySelector(".orbit-title .se-titlesuper"), tv = load("title");
    if (ts && tv && !ts.style.width) { ts.style.width = tv.w + "px"; ts.style.height = tv.h + "px"; }
    document.querySelectorAll(".orbit-bubble.is-group[data-key]").forEach(b => {
      if (b.classList.contains("is-growing") || (drag && drag.el === b)) return;   // growing: its size is the growth's
      const compact = b.classList.contains("is-compact"), state = compact ? "c" : "o";
      if (b._sqState === state) return;                               // sized for this state already
      b._sqState = state;
      const v = load(keyOf(b) + (compact ? "" : ":open"));
      if (v) sizeBubble(b, v.w, v.h);
      else {
        if (b.classList.contains("se-sized")) { b.style.width = ""; b.style.height = ""; b.classList.remove("se-sized"); }
        // the program's start size for a compact bubble (bubbles: size { kw, kh }, shares of the compact square)
        const t = (b.querySelector(":scope > .ob-label") || {}).textContent, pb = compact && t && ((((window.SuperAI || {}).program || {}).bubbles) || []).find(x => x.title === t.trim());
        if (pb && pb.size && pb.size.kw && window.innerWidth >= 700) {
          // shares of the compact square, tied to it (--se-compact), so it follows the square's size as that settles
          b.style.width = "calc(var(--se-compact, 104px) * var(--pill-fit, 1) * " + (+pb.size.kw) + ")";
          b.style.height = "calc(var(--se-compact, 104px) * var(--pill-fit, 1) * " + (+(pb.size.kh || 1)) + ")";
          b.classList.add("se-sized");
        }
      }
    });
  }
  document.addEventListener("orbit:ready", () => { restore(); if (O().layout) O().layout(); });
  setInterval(restore, 700);
})();
