// semotion.js — one way to animate, for the superellipse look: anime.js (MIT, loaded from cdnjs in
// index.html) drives every tween when it is there, and a small requestAnimationFrame tween stands in
// when it is not (offline, blocked CDN), so nothing depends on it. Used by semorph.js (windows morphing
// out of their buttons), labview.js (the ◆ growing while it thinks), sezoom.js, sesite.js and orbit.js
// (sizes, zoom and n gliding to where a scroll takes them instead of stepping).
//
//   SeMotion.tween(obj, { x: 1, y: 2 }, { duration, easing, update, complete })  -> handle with .cancel()
//   SeMotion.glide(key, obj, prop, target, duration, update)   a tween that a newer target replaces
(function () {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const EASE = { easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
                 easeOutCubic: t => 1 - Math.pow(1 - t, 3), easeOutQuad: t => 1 - (1 - t) * (1 - t), linear: t => t };

  function tween(obj, to, opt) {
    opt = opt || {};
    const duration = reduce.matches ? 0 : (opt.duration == null ? 400 : opt.duration);
    const easing = opt.easing || "easeInOutCubic";
    if (window.anime && duration > 0) {
      const a = window.anime(Object.assign({ targets: obj, duration, easing, update: opt.update, complete: opt.complete }, to));
      return { cancel: () => { a.pause(); } };
    }
    const from = {}; Object.keys(to).forEach(k => { from[k] = obj[k]; });
    const t0 = performance.now(), f = EASE[easing] || EASE.easeInOutCubic;
    let stopped = false;
    const step = now => {
      if (stopped) return;
      const t = duration > 0 ? Math.max(0, Math.min(1, (now - t0) / duration)) : 1, k = f(t);
      Object.keys(to).forEach(key => { obj[key] = from[key] + (to[key] - from[key]) * k; });
      if (opt.update) opt.update();
      if (t < 1) requestAnimationFrame(step); else if (opt.complete) opt.complete();
    };
    requestAnimationFrame(step);
    return { cancel: () => { stopped = true; } };
  }
  // a value that keeps gliding: each new target replaces the last tween (scroll steps become one motion)
  const live = {};
  function glide(key, obj, prop, target, duration, update) {
    if (live[key]) live[key].cancel();
    const to = {}; to[prop] = target;
    live[key] = tween(obj, to, { duration: duration == null ? 160 : duration, easing: "easeOutCubic", update, complete: () => { delete live[key]; } });
    return live[key];
  }
  window.SeMotion = { tween, glide, has: () => !!window.anime };
})();
