// super/maximize.js: every super grows from its smallest (where it closes) to filling the second super, the inner
// super, fully (owner, 2026-10-12: "a super can grow to fill the second super fully from minimize to maximize").
// Scrolled in at its largest, a Super AI super, a holder or a window glides out to fill the inner super; scrolled
// out, it glides back to where and how big it was.
//
//   SeMax.isMax(el)      it fills the inner super now
//   SeMax.maximize(el)   it glides out to fill the inner super
//   SeMax.restore(el)    it glides back to its box before
(function () {
  "use strict";
  const O = () => window.PiOrbit || {};
  const INSET = 3;
  const saved = new WeakMap();
  const isMax = el => !!(el && el.classList && el.classList.contains("se-max"));
  // the inner super's box: in layout px (supers) and on screen (windows)
  function site(screen) {
    const sb = O().siteBox ? O().siteBox() : null; if (!sb || !sb.a) return null;
    if (!screen) return { x: sb.cx - sb.a + INSET, y: sb.cy - sb.b + INSET, w: 2 * sb.a - 2 * INSET, h: 2 * sb.b - 2 * INSET };
    const f = sb.fit || 1, cx = sb.px + (sb.cx - sb.px) * f, cy = sb.py + (sb.cy - sb.py) * f, a = sb.a * f, b = sb.b * f;
    return { x: cx - a + INSET, y: cy - b + INSET, w: 2 * a - 2 * INSET, h: 2 * b - 2 * INSET };
  }
  const isNode = el => el.classList.contains("lv-node"), isWin = el => el.classList.contains("orbit-panel"), isBub = el => el.classList.contains("orbit-bubble");
  function rectOf(el) {
    if (isNode(el)) return window.LabView && window.LabView.rectOf ? window.LabView.rectOf(el) : null;
    if (isWin(el)) return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, sized: !!el.seSized, user: !!el.userSized };
    if (isBub(el)) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, iw: el.style.width, ih: el.style.height }; }
    return null;
  }
  function apply(el, r) {
    if (isNode(el)) { if (window.LabView && window.LabView.setRect) window.LabView.setRect(el, r.x, r.y, r.w, r.h); }
    else if (isWin(el)) { el.style.left = r.x + "px"; el.style.top = r.y + "px"; el.style.width = r.w + "px"; el.style.height = r.h + "px"; }
    else if (isBub(el)) {                                              // a bubble: its size, and the layout carries it to the same centre
      const f = (O().fit ? O().fit().f : 1) || 1, cur = el.getBoundingClientRect();
      el.style.width = (r.w / f) + "px"; el.style.height = (r.h / f) + "px"; el.classList.add("se-sized");
      if (O().moveBubbles && el.dataset.key) O().moveBubbles([el.dataset.key], (r.x + r.w / 2) - (cur.left + cur.width / 2), (r.y + r.h / 2) - (cur.top + cur.height / 2));
    }
    document.dispatchEvent(new CustomEvent("se:frame"));
  }
  function glide(el, from, to, done) {
    const s = { k: 0 };
    const step = () => { const k = s.k; apply(el, { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: from.w + (to.w - from.w) * k, h: from.h + (to.h - from.h) * k }); };
    if (window.SeMotion) window.SeMotion.tween(s, { k: 1 }, { duration: 520, easing: "easeInOutCubic", update: step, complete: () => { s.k = 1; step(); if (done) done(); } });
    else { s.k = 1; step(); if (done) done(); }
  }
  function maximize(el, back) {                                      // back: the box to go back to (a Shift + drag's start)
    if (!el || isMax(el)) return;
    const r = rectOf(el), to = site(isWin(el) || isBub(el)); if (!r || !to) return;
    // filling the inner super would take in supers outside it: it does not (owner, 2026-10-12: "to encompass the connect
    // automatically should not happen")
    if (window.SeHold && window.SeHold.outsiders) {
      const outs = window.SeHold.outsiders(el), scr = site(true);
      if (scr && window.SeHold.wouldMeet({ left: scr.x, top: scr.y, right: scr.x + scr.w, bottom: scr.y + scr.h }, outs)) {
        if (window.SeShape && window.SeShape.note) { const b = el.getBoundingClientRect(); window.SeShape.note(b.left + b.width / 2, b.top + b.height / 2, "stops here", "filling would take in supers outside it"); }
        return;
      }
    }
    saved.set(el, back ? Object.assign({}, r, back) : r);
    el.classList.add("se-max");
    if (isWin(el)) { el.seSized = true; el.userSized = true; }       // the layout leaves a window you sized alone
    glide(el, r, to, () => { document.dispatchEvent(new CustomEvent("se:obstacle")); if (O().layout) O().layout(); });
    const out = document.querySelector(".lv-out"); if (out) out.textContent = "Filling the inner super: scroll out to give it back its size";
  }
  function restore(el) {
    if (!el || !isMax(el)) return;
    const back = saved.get(el), from = rectOf(el);
    el.classList.remove("se-max");
    if (!back || !from) return;
    glide(el, from, back, () => {
      if (isWin(el)) { el.seSized = back.sized; el.userSized = back.user; }
      if (isBub(el)) { el.style.width = back.iw || ""; el.style.height = back.ih || ""; if (!back.iw) el.classList.remove("se-sized"); }
      saved.delete(el); document.dispatchEvent(new CustomEvent("se:obstacle")); if (O().layout) O().layout();
    });
  }
  // the inner super changed size (the window, the zoom): what fills it fills it again
  let t = 0;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => document.querySelectorAll(".se-max").forEach(el => { const to = site(isWin(el) || isBub(el)); if (to) apply(el, to); }), 200); });
  window.SeMax = { isMax, maximize, restore };
})();
