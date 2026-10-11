// super/livebox.js: the Live panel as a super (superellipse look only).
//
// The panel is the windows' kind of super: a superellipse at n = 8 unless shift + scroll gives it another n
// (super/site.js, kept as se:n:live). Its content sits in the rectangle the curve holds, whatever n is: the
// corner of a superellipse |x|^n + |y|^n = 1 on the diagonal is at 2^(-1/n), so the content is inset by
// (1 − 2^(-1/n)) / 2 of the panel's width and height on each side (4% at n = 8, 15% at n = 2). It is never
// scrolled: like a window's content it is fitted whole and zoomed about the pointer (super/zoombox.js).
(function () {
  "use strict";
  const html = document.documentElement;
  const DEFAULT_N = Math.PI;                                   // the windows' n (super/super.css: every super at π)
  const on = () => html.classList.contains("shape-se");

  function inset(body, scroll) {
    const n = +body.dataset.seN || DEFAULT_N;
    const f = (1 - Math.pow(2, -1 / Math.max(0.5, n))) / 2;
    const w = body.clientWidth, h = body.clientHeight;
    if (!w || !h) return;
    const ix = Math.round(f * w + 8), iy = Math.round(f * h + 10);
    const key = ix + "," + iy;
    if (scroll.dataset.inset === key) return;
    scroll.dataset.inset = key;
    scroll.style.margin = iy + "px " + ix + "px";
    if (scroll._zoom) scroll._zoom.refit();
  }

  function attach() {
    if (!on()) return;
    const dock = document.querySelector(".live-dock");
    const body = dock && dock.querySelector(".live-body"), scroll = body && body.querySelector(".live-scroll");
    if (!scroll || scroll._zoom || !window.SeZoomBox) return;
    const inner = document.createElement("div");
    inner.className = "live-inner";
    while (scroll.firstChild) inner.appendChild(scroll.firstChild);
    scroll.appendChild(inner);
    window.SeZoomBox.attach(scroll, inner, { max: 2.4 });
    const again = () => requestAnimationFrame(() => inset(body, scroll));
    if (window.ResizeObserver) new ResizeObserver(again).observe(body);
    new MutationObserver(again).observe(body, { attributes: true, attributeFilter: ["data-se-n", "style"] });
    new MutationObserver(() => { if (dock.classList.contains("open")) again(); }).observe(dock, { attributes: true, attributeFilter: ["class"] });
    again();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(attach, 0));
  else setTimeout(attach, 0);
  // the look can be switched on after load (?shape=se is read early, but be safe)
  setTimeout(attach, 1500);
})();
