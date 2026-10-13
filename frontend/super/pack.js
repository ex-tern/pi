// super/pack.js: lays out the start (owner, 2026-10-13: "this is the initial state of the app"). The program's
// at.inSite places the supers roughly; once the second super has stopped moving this sets them exactly, in shares of
// the second super's middle, so the start lands the same on every screen shape: Connect on the left, the third super
// beside it holding Tools, Explore and Library along its top and Lab and the project under Explore and Library, every
// one the same square. On every load until you first press, scroll or wire on a super (se:touched); after that, wherever you move them.
(function () {
  "use strict";
  const html = document.documentElement;
  const KEY = "se:touched";
  const done = () => { try { return localStorage.getItem(KEY) === "1"; } catch (_) { return true; } };
  // the first press, scroll or wire on a super makes the arrangement yours
  const touch = e => { if (done() || !e.isTrusted) return; const t = e.target; if (t && t.closest && t.closest(".orbit-bubble, .lv-node, .se-project, .orbit-panel, .se-port, .wire-hit, .sl-layer, .orbit-title")) { try { localStorage.setItem(KEY, "1"); } catch (_) { /* private mode */ } } };
  document.addEventListener("pointerdown", touch, true);
  document.addEventListener("wheel", touch, { capture: true, passive: true });
  const O = () => window.PiOrbit || {};
  // the start (owner, 2026-10-13: "this is the initial state of the app", a picture), in shares of the second super (x of
  // its width, y of its height): Connect open at its top left; the third super on the right holding Tools, Explore and
  // Library along the top, Lab and the project under them; a small square below Connect (the program's diagram). Compact squares are a side of
  // SQ (a share of the width); open bubbles a box [x0, y0, x1, y1]; squares by their centres
  // the start as the owner's picture of pitechlab.com (2026-10-13, "this is the initial state of the website"), in shares
  // of the second super's box: Connect open at its left; the third super in the middle with Tools, Explore and Library along
  // its top and Lab and the project under them, each a small square of its own side; the square under Connect feeds if.
  const START = {
    hold: [0.332, 0.119, 0.535, 0.445],
    open: { connect: [0.069, 0.103, 0.228, 0.401] },
    squares: { tools: [0.371, 0.209, 0.035], explore: [0.438, 0.214, 0.035], lib: [0.500, 0.214, 0.035], lab: [0.410, 0.363, 0.049] },
    project: [0.501, 0.363, 0.035],
  };
  function pack() {
    if (!html.classList.contains("shape-se") || done() || window.innerWidth < 700) return false;
    const sb = O().siteBox && O().siteBox(), F = O().fit ? O().fit() : null;
    const q = s => document.querySelector(s);
    const B = { connect: q('.orbit-bubble[data-key^="connect:"]'), tools: q('.orbit-bubble[data-key="assess:Tools group"]'), explore: q('.orbit-bubble[data-key^="explore:"]'),
      lib: q('.orbit-bubble[data-key^="lib:"]'), lab: q('.orbit-bubble[data-key^="lab:Lab"]') };
    const hold = q('.lv-node[data-id="hold"]'), proj = q(".se-project");
    if (!sb || !sb.a || !F || !hold || !proj || !window.LabView || !window.LabView.setRect || !O().placeBubble || !window.SeProject || !window.SeBubble || Object.values(B).some(b => !b)) return false;
    if (window.SeBind && window.SeBind.settle) window.SeBind.settle();
    const W2 = 2 * sb.a, H2 = 2 * sb.b, X = s => sb.cx - sb.a + s * W2, Y = s => sb.cy - sb.b + s * H2;
    const f = F.f || 1, sx = l => F.px + (l - F.px) * f, sy = l => F.py + (l - F.py) * f;   // layout to screen
    const h = START.hold;
    window.LabView.setRect(hold, X(h[0]), Y(h[1]), (h[2] - h[0]) * W2, (h[3] - h[1]) * H2);
    const sizeAs = (b, w, hh, open) => {
      const v = { w: Math.round(w), h: Math.round(hh) };
      if (Math.abs(b.offsetWidth - v.w) > 1 || Math.abs(b.offsetHeight - v.h) > 1) { b.style.width = v.w + "px"; b.style.height = v.h + "px"; b.classList.add("se-sized"); }
      try { localStorage.setItem("se:size:" + b.dataset.key + (open ? ":open" : ""), JSON.stringify(v)); } catch (_) { /* private mode */ }
    };
    const put = (b, lx, ly) => (O().placeBubbleAt || O().placeBubble)(b.dataset.key, sx(lx), sy(ly));
    Object.entries(START.squares).forEach(([k, c]) => {
      const b = B[k], q = c[2] * W2; if (!b.classList.contains("is-compact")) window.SeBubble.open(b, false);
      sizeAs(b, q, q, false); put(b, X(c[0]), Y(c[1]));
    });
    let settledOpen = true;
    Object.entries(START.open).forEach(([k, r]) => {
      const b = B[k];
      if (b.classList.contains("is-compact")) { window.SeBubble.open(b, true); settledOpen = false; }
      if (b.classList.contains("is-growing")) settledOpen = false;
      sizeAs(b, (r[2] - r[0]) * W2, (r[3] - r[1]) * H2, true);
      put(b, X((r[0] + r[2]) / 2), Y((r[1] + r[3]) / 2));
    });
    const PS = START.project[2] * W2;
    if (window.SeProject.resize) window.SeProject.resize(PS, PS);
    // moved until it lands (its move is measured, not assumed: the project super may scale a move by the page's zoom)
    const tx = sx(X(START.project[0]) - PS / 2), ty = sy(Y(START.project[1]) - PS / 2);
    let kx = 1, ky = 1;
    for (let k = 0; k < 4; k++) {
      const pr = proj.getBoundingClientRect(), dx = tx - pr.left, dy = ty - pr.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
      window.SeProject.moveBy(dx * kx, dy * ky);
      const nr = proj.getBoundingClientRect(), mx = nr.left - pr.left, my = nr.top - pr.top;
      if (Math.abs(mx) > 0.5) kx *= dx / mx; if (Math.abs(my) > 0.5) ky *= dy / my;
    }
    if (!settledOpen) setTimeout(() => { if (!done()) pack(); }, 1600);   // the open bubbles take their boxes once grown
    return true;
  }
  // as soon as the layout is there, before the page fades in (super/boot.js waits for it to settle)
  // once the second super has stopped moving (its margins settle as the title and fonts come in), else the packed group
  // and the bubbles laid out against the second super would part when it moves
  let tries = 0, lastSb = "";
  function attempt() {
    if (done() || tries++ > 60) return;
    const sb = O().siteBox && O().siteBox(), key = sb ? [sb.cx, sb.cy, sb.a, sb.b].map(v => Math.round(v)).join(",") : "";
    if (!key || key !== lastSb) { lastSb = key; setTimeout(attempt, 120); return; }
    if (!pack()) { setTimeout(attempt, 120); return; }
    // the third super can still glide a moment after it is set: a second pass places the rest against where it settled
    setTimeout(() => { if (!done()) pack(); }, 1400);
  }
  // the window changed size while the start is still untouched: the start is laid out again from scratch (a fresh
  // load always lands right; moving the laid-out supers live after a resize fought the layout and bind.js)
  let rT = 0, w0 = window.innerWidth, h0 = window.innerHeight;
  window.addEventListener("resize", () => {
    clearTimeout(rT);
    rT = setTimeout(() => {
      if (done() || !html.classList.contains("shape-se")) return;
      if (Math.abs(window.innerWidth - w0) < w0 * 0.03 && Math.abs(window.innerHeight - h0) < h0 * 0.03) return;   // a scrollbar or a toolbar, not a new window size
      try { Object.keys(localStorage).filter(k => /^(lv:|orbit:|se:)/.test(k) && k !== "se:start" && k !== KEY).forEach(k => localStorage.removeItem(k)); } catch (_) { /* private mode */ }
      location.reload();
    }, 600);
  });
  document.addEventListener("orbit:ready", () => setTimeout(attempt, 150));
  if (window.PiOrbit && window.PiOrbit.siteBox) setTimeout(attempt, 300);
  window.SePack = { pack: () => { try { localStorage.removeItem(KEY); } catch (_) { /* private mode */ } return pack(); } };
})();
