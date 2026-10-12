// super/shiftsize.js: Shift + drag sizes a super, its width and its height apart (owner, 2026-10-12: "pushing shift also
// can control width and height of the super"). Held Shift, a drag on a super moves its right edge with the pointer's
// x and its bottom edge with its y: a Super AI super or a holder (super/nodes.js LabView.resize), a window (it is then
// a window you sized yourself) and a compact bubble (kept as se:size:<key>). Shift + scroll still changes its n.
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {};
  const SEL = ".lv-node, .orbit-panel, .orbit-bubble.is-group.is-compact, .se-project:not(.is-open), .orbit-title .se-titlesuper";   // every super
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
    const el = t.closest(SEL); if (!el) return;
    if (el.classList.contains("is-holder") && !t.closest(".lv-edge")) return;
    if (window.SeLock && window.SeLock.isLocked(el)) {                // locked: its size is kept
      e.preventDefault(); e.stopImmediatePropagation();
      if (window.SeShape && window.SeShape.note) window.SeShape.note(e.clientX, e.clientY, "locked", "unlock it to change its size or shape");
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    const f = el.classList.contains("orbit-panel") || el.classList.contains("se-titlesuper") ? 1 : fit();   // nodes, bubbles and the project are sized in layout px
    drag = { el, x0: e.clientX, y0: e.clientY, w0: el.offsetWidth, h0: el.offsetHeight, f, id: e.pointerId };
    html.classList.add("se-shift-sizing");
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
  }, true);
  window.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const w = Math.max(40, drag.w0 + (e.clientX - drag.x0) / drag.f), h = Math.max(40, drag.h0 + (e.clientY - drag.y0) / drag.f), el = drag.el;
    if (el.classList.contains("lv-node")) { if (window.LabView && window.LabView.resize) window.LabView.resize(el, w, h); }
    else if (el.classList.contains("orbit-panel")) {
      el.style.width = Math.round(Math.max(200, w)) + "px"; el.style.height = Math.round(Math.max(120, h)) + "px";
      el.userSized = true; el.seSized = true;
    } else if (el.classList.contains("se-project")) { if (window.SeProject && window.SeProject.resize) window.SeProject.resize(w, h); }
    else if (el.classList.contains("se-titlesuper")) { el.style.width = Math.round(w) + "px"; el.style.height = Math.round(h) + "px"; }
    else sizeBubble(el, w, h);
    if (window.SeShape) window.SeShape.size && window.SeShape.size(e.clientX, e.clientY, Math.round(w), Math.round(h));
    document.dispatchEvent(new CustomEvent("se:frame"));
  }, true);
  const end = e => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const el = drag.el; drag = null; html.classList.remove("se-shift-sizing");
    if (el.classList.contains("orbit-bubble")) { const k = keyOf(el); if (k) save(k, { w: el.offsetWidth, h: el.offsetHeight }); }
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
      const v = load(keyOf(b));
      const compact = b.classList.contains("is-compact");
      if (v && compact && !b.classList.contains("se-sized")) sizeBubble(b, v.w, v.h);
      if (!compact && b.classList.contains("se-sized")) { b.style.width = ""; b.style.height = ""; b.classList.remove("se-sized"); }
    });
  }
  document.addEventListener("orbit:ready", () => { restore(); if (O().layout) O().layout(); });
  setInterval(restore, 700);
})();
