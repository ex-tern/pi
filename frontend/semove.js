// semove.js — in the superellipse look the title, the Functions palette and the Live panel can be
// moved: drag them from inside (their edge still wires, see superlink.js; a word inside still
// starts a wire, and their buttons and links keep their clicks). Each keeps its offset (the CSS
// `translate` property, on top of where orbit.js seats it) in localStorage as se:move:<name>,
// and a move that would take it out of the main loop stops at the loop's edge.
(function () {
  "use strict";
  const html = document.documentElement;
  const O = () => window.PiOrbit || {};
  const THINGS = { title: ".orbit-title", palette: ".lv-palette", live: ".live-dock" };
  const KEEP = "a, button, input, textarea, select, .lv-fn, .live-tab, [contenteditable]";
  const load = k => { try { return JSON.parse(localStorage.getItem("se:move:" + k) || "null"); } catch (_) { return null; } };
  const save = (k, v) => { try { localStorage.setItem("se:move:" + k, JSON.stringify(v)); } catch (_) { /* private mode */ } };
  const seNorm = (u, v, n) => Math.pow(Math.pow(u, n) + Math.pow(v, n), 1 / n);

  // is this box inside the main loop?
  function inside(r) {
    const g = O().loop ? O().loop() : null;
    if (!g || !g.a) return true;
    const st = document.querySelector(".orbit-stage"), top = st ? st.getBoundingClientRect().top : 0;
    const cx = g.cx, cy = top + g.cy;
    return [r.left - 4, r.right + 4].every(x => [r.top - 4, r.bottom + 4].every(y => seNorm(Math.abs(x - cx) / g.a, Math.abs(y - cy) / g.b, g.n) <= 1));
  }
  const apply = (el, v) => { el.style.translate = v && (v.x || v.y) ? v.x + "px " + v.y + "px" : ""; };

  function wire(name, el) {
    if (el.dataset.semove) return;
    el.dataset.semove = name;
    apply(el, load(name));
    el.addEventListener("pointerdown", e => {
      if (!html.classList.contains("shape-se") || e.button !== 0) return;
      if (e.target.closest && e.target.closest(KEEP)) return;
      if (window.SuperLink && window.SuperLink.unitAt && window.SuperLink.unitAt(e.clientX, e.clientY)) return;   // a word: that is a wire
      const v0 = load(name) || { x: 0, y: 0 }, x0 = e.clientX, y0 = e.clientY;
      let moved = false, last = { x: v0.x, y: v0.y };
      const move = ev => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        if (!moved) { moved = true; html.classList.add("se-moving"); }
        const v = { x: Math.round(v0.x + ev.clientX - x0), y: Math.round(v0.y + ev.clientY - y0) };
        apply(el, v);
        const box = name === "live" ? (el.querySelector(".live-body") && el.classList.contains("open") ? el.querySelector(".live-body") : el.querySelector(".live-tab")) || el : el;
        if (inside(box.getBoundingClientRect())) last = v; else apply(el, last);   // it stops at the loop (Live: its panel, not the whole dock)
        ev.preventDefault();
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
        html.classList.remove("se-moving");
        if (moved) save(name, last);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
    });
  }
  function scan() { Object.entries(THINGS).forEach(([k, sel]) => { const el = document.querySelector(sel); if (el) wire(k, el); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
  setInterval(scan, 1000);                 // the palette and Live are built after load
})();
