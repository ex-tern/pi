// super/zoombox.js: content that is zoomed, never scrolled (the superellipse look has no scroll bars).
//
// A zoom box is a clipping container and the content inside it. The content is laid out so that, scaled,
// it fills the box's width and fits its height: the whole of it is in view at once. A scroll or a pinch
// over it (super/scroll.js) zooms in or out about the pointer, the point under the pointer staying put,
// from that whole view (the least) to 2.2 × its natural size; zooming back out returns to the whole.
// When the content or the box changes size, the content is fitted again (kept zoomed, if it was).
//
//   SeZoomBox.attach(box, content, opts)   opts.max: the most zoom (2.2); returns the controller
//   box._zoom.zoomAt(x, y, dy)              a scroll step at screen point (x, y)
//   box._zoom.fit()                         the whole view again
(function () {
  "use strict";
  if (window.SeZoomBox) return;
  const MAX = 4;                                                  // up to four times its natural size (owner, 2026-10-12: readable in a big window)
  // everything always fully readable (owner, 2026-10-12): the content is never fitted smaller than this scale (its
  // type stays at or above super/legible.js's readable size); a window too small for that grows instead, as far
  // as the inner super lets (super/loop.js winCap)
  const readK = content => { const L = window.SeLegible; return L ? Math.min(1, L.MIN / L.minFont(content)) : 11 / 14; };

  function attach(box, content, opts) {
    if (!box || !content || box._zoom) return box && box._zoom;
    opts = opts || {};
    const z = { k: 1, fitK: 1, tx: 0, ty: 0, w: 0, user: false };
    box.classList.add("se-zoombox"); content.classList.add("se-zoomed");
    box.dataset.zoombox = "1";

    function apply() {
      const bw = box.clientWidth, bh = box.clientHeight, cw = z.w || content.offsetWidth, ch = content.offsetHeight;
      const sw = cw * z.k, sh = ch * z.k;
      z.tx = sw <= bw ? (bw - sw) / 2 : Math.min(0, Math.max(bw - sw, z.tx));      // never past its edges
      z.ty = sh <= bh ? 0 : Math.min(0, Math.max(bh - sh, z.ty));
      box.classList.toggle("is-overflowing", sw > bw + 1 || sh > bh + 1);                 // more below or beside: it moves by dragging
      content.style.transform = "translate(" + z.tx.toFixed(1) + "px," + z.ty.toFixed(1) + "px) scale(" + z.k.toFixed(4) + ")";
      box.classList.toggle("is-zoomed", z.k > z.fitK * 1.02);
    }
    // the whole of the content in view: laid out wider when it has to shrink, so that scaled it fills the
    // box's width instead of leaving bands at the sides (two passes: the height depends on the width)
    function fit(keep) {
      const bw = box.clientWidth, bh = box.clientHeight;
      if (!bw || !bh) return;
      let w = bw, k = 1;
      for (let pass = 0; pass < 3; pass++) {
        content.style.width = Math.round(w) + "px";
        const ch = content.offsetHeight || 1;
        const nk = Math.min(1, bh / ch);
        if (Math.abs(nk - k) < 0.01 && pass) { k = nk; break; }
        k = nk; w = bw / Math.max(0.35, k);                         // never laid out absurdly wide
      }
      z.w = Math.round(w); z.fitK = Math.min(1, bh / (content.offsetHeight || 1), bw / z.w);
      const rk = readK(content);
      if (z.fitK < rk) { grow(rk); z.fitK = rk; }                     // too small to read whole: the window grows (then this fits again); meanwhile the content stays readable and moves by dragging
      if (!keep || !z.user || z.k < z.fitK) { z.k = z.fitK; z.tx = 0; z.ty = 0; z.user = false; }
      apply();
      fitHeight();
    }
    // a window is no taller than its content (owner, 2026-10-12: "fix all ui": no empty half-window), up to the
    // uniform height it opened at; it glides there. A window you sized, or one grown to be readable, is left alone
    function fitHeight() {
      const p = box.closest(".orbit-panel");
      if (!p || p.seSized || p.seRead || p._seGrowing || p._seFitting || z.user || p.classList.contains("leaving")) return;
      if (window.innerWidth < 700) return;                              // a phone's window takes most of the inner super anyway (and the layout holds it there)
      if (p._seH0 == null) p._seH0 = p.offsetHeight;
      const bw = box.clientWidth, extraH = p.offsetHeight - box.clientHeight;
      const w0 = content.style.width; content.style.width = bw + "px"; const ch = content.offsetHeight; content.style.width = w0;
      // never below the least the layout keeps a window at (a phone keeps a window readable: super/loop.js keepWindowsIn), or the two would undo each other
      const sb = window.PiOrbit && window.PiOrbit.siteBox ? window.PiOrbit.siteBox() : null;
      const least = window.innerWidth < 700 && sb ? Math.floor(sb.b * (sb.fit || 1) * 0.6) + 2 : 170;
      const target = Math.round(Math.min(p._seH0, Math.max(least, ch + extraH + 4)));
      if (Math.abs(target - p.offsetHeight) < 16) return;
      const r = p.getBoundingClientRect(), cy = r.top + r.height / 2;
      const put = h => { p.style.height = Math.round(h) + "px"; p.style.top = Math.round(cy - h / 2) + "px"; };
      p._seFitting = true;
      const done = () => { p._seFitting = false; const O = window.PiOrbit; if (p.item && O && O.saveWin) O.saveWin(p.item, p); };
      if (window.SeMotion) { const s = { h: r.height }; window.SeMotion.tween(s, { h: target }, { duration: 300, easing: "easeOutCubic", update: () => put(s.h), complete: done }); }
      else { put(target); done(); }
    }
    // the window around the box grows until the content, laid out at its narrowest, fits at the readable scale
    function grow(kMin) {
      const p = box.closest(".orbit-panel"), O = window.PiOrbit;
      if (!p || !O || !O.winCap || p._seGrowing || p.seSized) return;   // a window you sized yourself stays the size you gave it (its content moves by dragging)
      const cap = O.winCap(Object.assign({}, p, { seRead: true })), bw = box.clientWidth, bh = box.clientHeight;
      const extraW = p.offsetWidth - bw, extraH = p.offsetHeight - bh;
      content.style.width = Math.round(bw / kMin) + "px";
      const needH = content.offsetHeight * kMin + extraH;
      const h = Math.min(cap.h, Math.ceil(needH)), w = Math.min(cap.w, p.offsetWidth); void extraW;   // laid out wider and scaled, it fills the width: only the height grows
      if (h <= p.offsetHeight + 1) return;
      p.seRead = true; p._seGrowing = true;
      const r = p.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      void cx; void w;                                                   // only its height changes: where it is stays the layout's (a glide may be moving it)
      const put = s => { p.style.height = Math.round(s.h) + "px"; p.style.top = Math.round(cy - s.h / 2) + "px"; };
      const done = () => { p._seGrowing = false; if (p.item && O.saveWin) O.saveWin(p.item, p); refit(); };
      if (window.SeMotion) { const s = { w: r.width, h: r.height }; window.SeMotion.tween(s, { w, h }, { duration: 260, easing: "easeOutCubic", update: () => put(s), complete: done }); }
      else { put({ w, h }); done(); }
    }
    function zoomAt(x, y, dy) {
      const r = box.getBoundingClientRect(), px = x - r.left, py = y - r.top;
      const k1 = Math.max(z.fitK, Math.min(opts.max || MAX, (z.kTo != null ? z.kTo : z.k) * Math.exp(-dy * 0.0015)));
      if (k1 === (z.kTo != null ? z.kTo : z.k)) return false;
      z.kTo = k1;
      const tx = px - (px - z.tx) * (k1 / z.k), ty = py - (py - z.ty) * (k1 / z.k);   // the point under the pointer stays put
      z.user = k1 > z.fitK * 1.001;
      // it glides there (owner, 2026-10-12: no sudden movement); scroll steps become one motion
      if (window.SeMotion) { const s = { k: z.k, tx: z.tx, ty: z.ty }; window.SeMotion.glide("zoombox:" + (box.id || box.dataset.zb || (box.dataset.zb = Math.random().toString(36).slice(2))), s, "k", k1, 160, () => { const t = (s.k - z.k) / ((k1 - z.k) || 1); z.tx += (tx - z.tx) * t; z.ty += (ty - z.ty) * t; z.k = s.k; if (Math.abs(z.k - k1) < 1e-6) z.kTo = null; apply(); }); }
      else { z.tx = tx; z.ty = ty; z.k = k1; apply(); }
      return true;
    }
    // bigger than the box (zoomed in, or at the readable floor), the content moves by dragging it: a press that
    // moves more than 6 px pans, a click is still a click (links, buttons)
    let pan = null;
    box.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const bw = box.clientWidth, bh = box.clientHeight, sw = (z.w || content.offsetWidth) * z.k, sh = content.offsetHeight * z.k;
      if (sw <= bw + 1 && sh <= bh + 1) return;
      if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable], canvas, iframe")) return;
      pan = { x: e.clientX, y: e.clientY, tx: z.tx, ty: z.ty, id: e.pointerId, on: false };
    }, true);
    box.addEventListener("pointermove", e => {
      if (!pan || e.pointerId !== pan.id) return;
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (!pan.on) { if (Math.hypot(dx, dy) < 6) return; pan.on = true; box.classList.add("is-panning"); try { box.setPointerCapture(pan.id); } catch (_) { /* fine */ } }
      z.tx = pan.tx + dx; z.ty = pan.ty + dy; z.user = true; apply(); e.preventDefault();
    }, true);
    const endPan = e => { if (pan && (!e || e.pointerId === pan.id)) { if (pan.on) { box.classList.remove("is-panning"); box._panned = performance.now(); } pan = null; } };
    box.addEventListener("pointerup", endPan, true); box.addEventListener("pointercancel", endPan, true);
    box.addEventListener("click", e => { if (box._panned && performance.now() - box._panned < 300) { e.stopPropagation(); e.preventDefault(); } }, true);
    let fitT = 0;
    const refit = () => { cancelAnimationFrame(fitT); fitT = requestAnimationFrame(() => fit(true)); };
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(refit);
      ro.observe(box);
      // the content's own changes (results arriving, a list growing), not the width this sets on it
      let lastH = 0;
      new ResizeObserver(() => { const h = content.scrollHeight; if (Math.abs(h - lastH) > 1) { lastH = h; refit(); } }).observe(content);
    }
    box._zoom = { zoomAt, fit: () => fit(false), refit, state: z };
    fit(false);
    return box._zoom;
  }
  window.SeZoomBox = { attach };
})();
