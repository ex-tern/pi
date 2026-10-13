// super/wall.js: a super's edge is a wall for what it holds (owner, 2026-10-13: "add resistance to the super if another
// super wants to go out of the super. So it's like hitting a wall, but if you push hard, you can pass").
//
// A drag of a super that lies inside another (a holder, a bubble, a window, the project; else the second super) stops at
// the host's inner edge: the pointer may go on past it, the super gives only a little (elastic), and once the pointer is
// PASS px beyond the wall the super breaks through and follows the pointer freely for the rest of the drag.
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
  function begin(el, x, y) {
    if (!on() || !el) return;
    const host = (window.SeHold && window.SeHold.hostOf && window.SeHold.hostOf(el)) || "site";
    const R = room(host); if (!R) return;
    const b = el.getBoundingClientRect();
    // only a super that starts inside the room meets its wall
    if (b.left < R.l - 1 || b.top < R.t - 1 || b.right > R.r + 1 || b.bottom > R.b + 1) return;
    drags.set(el, { x0: x, y0: y, b, R, free: false, host });
  }
  // one axis: the move d of an edge that may go from lo to hi
  function axis(d, lo, hi, st) {
    if (d < lo) { const o = lo - d; if (o > PASS) st.free = true; return st.free ? d : lo - o * GIVE; }
    if (d > hi) { const o = d - hi; if (o > PASS) st.free = true; return st.free ? d : hi + o * GIVE; }
    return d;
  }
  function adjust(el, x, y) {
    const st = el && drags.get(el); if (!st || st.free) return [x, y];
    const dx = x - st.x0, dy = y - st.y0, b = st.b, R = st.R;
    const ax = axis(dx, R.l - b.left, R.r - b.right, st), ay = st.free ? dy : axis(dy, R.t - b.top, R.b - b.bottom, st);
    if (st.free) { html.classList.remove("se-wall"); return [x, y]; }        // through the wall: it follows the pointer
    const pushing = ax !== dx || ay !== dy;
    html.classList.toggle("se-wall", pushing);
    if (pushing && st.host && st.host !== "site") st.host.classList.add("se-wall-hit"); else if (st.host && st.host !== "site") st.host.classList.remove("se-wall-hit");
    return [st.x0 + ax, st.y0 + ay];
  }
  function end(el) {
    const st = el && drags.get(el);
    if (st && st.host && st.host !== "site") st.host.classList.remove("se-wall-hit");
    html.classList.remove("se-wall");
    if (el) drags.delete(el);
  }
  window.SeWall = { begin, adjust, end, PASS };
})();
