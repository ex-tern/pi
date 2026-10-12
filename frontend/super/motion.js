// super/motion.js — one way to animate, for the superellipse look: anime.js (MIT, loaded from cdnjs in
// index.html) drives every tween when it is there, and a small requestAnimationFrame tween stands in
// when it is not (offline, blocked CDN), so nothing depends on it. Used by super/shape.js (windows morphing
// out of their buttons), super/nodes.js (the ◆ growing while it thinks), super/scroll.js, super/site.js and orbit.js
// (sizes, zoom and n gliding to where a scroll takes them instead of stepping).
//
//   SeMotion.tween(obj, { x: 1, y: 2 }, { duration, easing, update, complete })  -> handle with .cancel()
//   SeMotion.glide(key, obj, prop, target, duration, update)   a tween that a newer target replaces
(function () {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const EASE = { easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
                 easeOutCubic: t => 1 - Math.pow(1 - t, 3), easeOutQuad: t => 1 - (1 - t) * (1 - t), linear: t => t };

  // ---- the frame: while anything moves, every wire is redrawn each animation frame --------------
  // Wires (orbit.js, super/nodes.js, super/wire.js) and the inner super's lattice (super/site.js) are drawn from
  // where their ends are on screen. Between gestures a redraw four times a second is plenty; while a
  // pointer is down, a tween runs or a scroll just happened they would lag what they join (the stutter),
  // so "se:frame" is dispatched on the document once per animation frame for as long as that lasts.
  let running = 0, pointer = 0, hot = 0, pumping = false;
  const SLOW = 2.2;
  const se = () => document.documentElement.classList.contains("shape-se");
  function frame(now) {
    document.dispatchEvent(new CustomEvent("se:frame:first"));   // what places things (super/site.js's ports) goes first
    document.dispatchEvent(new CustomEvent("se:frame"));
    if (running > 0 || pointer > 0 || now < hot) requestAnimationFrame(frame); else pumping = false;
  }
  function pump() { if (pumping || !se()) return; pumping = true; requestAnimationFrame(frame); }
  function mark() { hot = performance.now() + 300; pump(); }
  document.addEventListener("pointerdown", () => { pointer++; pump(); }, true);
  ["pointerup", "pointercancel"].forEach(t => document.addEventListener(t, () => { pointer = Math.max(0, pointer - 1); mark(); }, true));
  window.addEventListener("blur", () => { pointer = 0; });
  ["wheel", "touchmove", "keydown"].forEach(t => document.addEventListener(t, mark, { capture: true, passive: true }));
  // a CSS transition moving a window or a bubble: the wires follow it every frame instead of a few times a second
  document.addEventListener("transitionrun", e => {
    const t = e.target;
    if (!t || !t.closest || !t.closest(".orbit-panel, .orbit-bubble, .orbit-bubbles, .lv-node, .live-dock, .orbit-title")) return;
    hot = Math.max(hot, performance.now() + 1400); pump();
  }, true);
  window.addEventListener("resize", mark);

  function tween(obj, to, opt) {
    opt = opt || {};
    // everything moves slowly and steadily in the superellipse look (owner, 2026-10-12: "no sudden movement, everything
    // stable and slow motion"): every tween takes SLOW times as long
    const duration = reduce.matches ? 0 : (opt.duration == null ? 400 : opt.duration) * (se() ? SLOW : 1);
    const easing = opt.easing || "easeInOutCubic";
    let open = true;
    const done = () => { if (open) { open = false; running = Math.max(0, running - 1); mark(); } };
    running++; pump();
    if (window.anime && duration > 0) {
      const a = window.anime(Object.assign({ targets: obj, duration, easing, update: opt.update, complete: () => { done(); if (opt.complete) opt.complete(); } }, to));
      return { cancel: () => { a.pause(); done(); } };
    }
    const from = {}; Object.keys(to).forEach(k => { from[k] = obj[k]; });
    const t0 = performance.now(), f = EASE[easing] || EASE.easeInOutCubic;
    let stopped = false;
    const step = now => {
      if (stopped) return;
      const t = duration > 0 ? Math.max(0, Math.min(1, (now - t0) / duration)) : 1, k = f(t);
      Object.keys(to).forEach(key => { obj[key] = from[key] + (to[key] - from[key]) * k; });
      if (opt.update) opt.update();
      if (t < 1) requestAnimationFrame(step); else { done(); if (opt.complete) opt.complete(); }
    };
    requestAnimationFrame(step);
    return { cancel: () => { stopped = true; done(); } };
  }
  // a value that keeps gliding: each new target replaces the last tween (scroll steps become one motion)
  const live = {};
  function glide(key, obj, prop, target, duration, update) {
    if (live[key]) live[key].cancel();
    const to = {}; to[prop] = target;
    live[key] = tween(obj, to, { duration: duration == null ? 160 : duration, easing: "easeOutCubic", update, complete: () => { delete live[key]; } });
    return live[key];
  }
  window.SeMotion = { SLOW, tween, glide, has: () => !!window.anime, busy: () => running > 0 || pointer > 0 || performance.now() < hot, wake: mark };
})();
