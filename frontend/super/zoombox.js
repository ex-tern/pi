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
  const MAX = 2.2;

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
      if (!keep || !z.user || z.k < z.fitK) { z.k = z.fitK; z.tx = 0; z.ty = 0; z.user = false; }
      apply();
    }
    function zoomAt(x, y, dy) {
      const r = box.getBoundingClientRect(), px = x - r.left, py = y - r.top;
      const k1 = Math.max(z.fitK, Math.min(opts.max || MAX, z.k * Math.exp(-dy * 0.0015)));
      if (k1 === z.k) return false;
      z.tx = px - (px - z.tx) * (k1 / z.k);                          // the point under the pointer stays put
      z.ty = py - (py - z.ty) * (k1 / z.k);
      z.k = k1; z.user = k1 > z.fitK * 1.001;
      apply();
      return true;
    }
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
