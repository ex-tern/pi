// super/wall.js: a super's edge is a wall for what it holds (owner, 2026-10-13: "add resistance to the super if another
// super wants to go out of the super. So it's like hitting a wall, but if you push hard, you can pass").
//
// A drag of a super that lies inside another (a holder, a bubble, a window, the project; else the second super) stops at
// the host's inner edge: the pointer may go on past it, the super gives only a little (elastic), and once the pointer is
// PASS px beyond the wall the super breaks through and follows the pointer freely for the rest of the drag.
// Going in is the same (owner, 2026-10-13): the outer edge of a super it could go into resists it, and gives way
// once it is pushed PASS px through.
//   SeWall.begin(el, x, y)   at the start of a drag: the host and the room inside it
//   SeWall.adjust(el, x, y)  each move: the pointer as the dragged super should take it, [x, y]
//   SeWall.end(el)
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const PASS = 90, GIVE = 0.12;
  const drags = new WeakMap();
  function room(host) {
    if (host === "site") {
      const O = window.PiOrbit, sb = O && O.siteBox && O.siteBox(), F = O && O.fit && O.fit();
      if (!sb || !F) return null;
      const f = F.f || 1, sx = l => F.px + (l - F.px) * f, sy = l => F.py + (l - F.py) * f;
      return { l: sx(sb.cx - sb.a) + 2, t: sy(sb.cy - sb.b) + 2, r: sx(sb.cx + sb.a) - 2, b: sy(sb.cy + sb.b) - 2 };
    }
    const r = host.getBoundingClientRect(), k = Math.min(r.width, r.height) * 0.03;
    const top = host.classList.contains("is-holder") ? Math.max(k, Math.min(46, r.height * 0.065)) : k;
    return { l: r.left + k, t: r.top + top, r: r.right - k, b: r.bottom - k };
  }
  // the walls a super may run into from outside (owner, 2026-10-13: "the same way that exiting a super meets a wall
  // and restriction, entering the super should have the same effect"): every super that could hold it and that it
  // does not touch when the drag starts; its outer edge resists the same way, and gives way PASS px in
  function entries(el, b) {
    if (!window.SeHold || !window.SeHold.hosts) return [];
    return window.SeHold.hosts().map(e => ({ el: e, r: e.getBoundingClientRect() }))   // SeHold.hosts() gives elements, biggest first
      .filter(h => h.el !== el && !h.el.contains(el) && !el.contains(h.el))
      .filter(h => b.width < h.r.width && b.height < h.r.height)                       // only what it could go into
      .filter(h => b.right <= h.r.left || b.left >= h.r.right || b.bottom <= h.r.top || b.top >= h.r.bottom)
      .map(h => ({ el: h.el, R: { l: h.r.left, t: h.r.top, r: h.r.right, b: h.r.bottom }, passed: false }));
  }
  function begin(el, x, y) {
    if (!on() || !el) return;
    const host = (window.SeHold && window.SeHold.hostOf && window.SeHold.hostOf(el)) || "site";
    const b = el.getBoundingClientRect();
    const R = room(host);
    // only a super that starts inside the room meets its wall on the way out
    const inside = !!R && !(b.left < R.l - 1 || b.top < R.t - 1 || b.right > R.r + 1 || b.bottom > R.b + 1);
    drags.set(el, { x0: x, y0: y, b, R, free: !inside, host: inside ? host : null, walls: entries(el, b), hit: new Set() });
  }
  // one axis: the move d of an edge that may go from lo to hi
  function axis(d, lo, hi, st) {
    if (d < lo) { const o = lo - d; if (o > PASS) st.free = true; return st.free ? d : lo - o * GIVE; }
    if (d > hi) { const o = d - hi; if (o > PASS) st.free = true; return st.free ? d : hi + o * GIVE; }
    return d;
  }
  // a wall on the way in: the move [dx, dy] held back at the outer edge of W, from the side the super came from
  function inward(dx, dy, b, W) {
    const P = { l: b.left + dx, r: b.right + dx, t: b.top + dy, b: b.bottom + dy }, R = W.R;
    if (P.r <= R.l || P.l >= R.r || P.b <= R.t || P.t >= R.b) return null;              // not touching it
    const c = [];                                                                         // [depth, axis, sign] per side it came from
    if (b.right <= R.l) c.push([P.r - R.l, "x", -1]);
    if (b.left >= R.r) c.push([R.r - P.l, "x", 1]);
    if (b.bottom <= R.t) c.push([P.b - R.t, "y", -1]);
    if (b.top >= R.b) c.push([R.b - P.t, "y", 1]);
    if (!c.length) return null;
    const [o, ax, sg] = c.sort((p, q) => p[0] - q[0])[0];                               // the edge it is least far through
    if (o > PASS) { W.passed = true; return null; }                                      // pushed hard: it goes in
    const back = sg * o * (1 - GIVE);                                                     // gives only a little
    return ax === "x" ? [dx + back, dy] : [dx, dy + back];
  }
  function adjust(el, x, y) {
    const st = el && drags.get(el); if (!st) return [x, y];
    const b = st.b;
    let dx = x - st.x0, dy = y - st.y0, pushing = false;
    if (!st.free) {                                                                       // the way out
      const R = st.R;
      const ax = axis(dx, R.l - b.left, R.r - b.right, st), ay = st.free ? dy : axis(dy, R.t - b.top, R.b - b.bottom, st);
      if (!st.free) { pushing = ax !== dx || ay !== dy; dx = ax; dy = ay; }
    }
    if (st.host && st.host !== "site") st.host.classList.toggle("se-wall-hit", pushing);
    const hit = new Set();
    for (const W of st.walls) {                                                           // the ways in
      if (W.passed) continue;
      const m = inward(dx, dy, b, W);
      if (m) { dx = m[0]; dy = m[1]; pushing = true; hit.add(W.el); }
    }
    st.hit.forEach(h => { if (!hit.has(h)) h.classList.remove("se-wall-hit"); });
    hit.forEach(h => h.classList.add("se-wall-hit"));
    st.hit = hit;
    html.classList.toggle("se-wall", pushing);
    return [st.x0 + dx, st.y0 + dy];
  }
  function end(el) {
    const st = el && drags.get(el);
    if (st && st.host && st.host !== "site") st.host.classList.remove("se-wall-hit");
    if (st) st.hit.forEach(h => h.classList.remove("se-wall-hit"));
    html.classList.remove("se-wall");
    if (el) drags.delete(el);
  }
  window.SeWall = { begin, adjust, end, PASS };
})();
