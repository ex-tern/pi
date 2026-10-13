// super/pack.js: lays out the start (owner, 2026-10-13: "set initial state of the app as this image"). The program's
// at.inSite places the supers roughly; once the second super has stopped moving this sets them exactly, in shares of
// the second super, so the start lands the same on every screen shape: Connect a square in its top-left corner, the
// third super beside it holding Tools, Explore, Lab and Library as four small squares, the project a wide box under
// them. On every load until you first press, scroll or wire on a super (se:touched); after that, wherever you move them.
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
  // the start (owner, 2026-10-13: "set initial state of the app as this image"), in shares of the second super (x of
  // its width, y of its height): Connect a square in its top-left corner, the third super beside it holding Tools,
  // Explore, Lab and Library as four small squares two by two, the project a wide box under them
  const START = { connect: [0, 0.064, 0.165],                         // left, top, side (a share of the width)
    hold: [0.168, 0.069, 0.387, 0.376],                                // left, top, right, bottom
    tiny: 0.0155, cols: [0.278, 0.346], rows: [0.155, 0.291],          // the four members: side, centres
    project: [0.099, 0.381, 0.406, 0.551] };
  function pack() {
    if (!html.classList.contains("shape-se") || done() || window.innerWidth < 700) return false;
    const sb = O().siteBox && O().siteBox(), F = O().fit ? O().fit() : null;
    const q = s => document.querySelector(s);
    const B = { connect: q('.orbit-bubble[data-key^="connect:"]'), tools: q('.orbit-bubble[data-key="assess:Tools group"]'), explore: q('.orbit-bubble[data-key^="explore:"]'),
      lib: q('.orbit-bubble[data-key^="lib:"]'), lab: q('.orbit-bubble[data-key^="lab:Lab"]') };
    const hold = q('.lv-node[data-id="hold"]'), proj = q(".se-project");
    if (!sb || !sb.a || !F || !hold || !proj || !window.LabView || !window.LabView.setRect || !O().placeBubble || !window.SeProject || Object.values(B).some(b => !b || !b.classList.contains("is-compact"))) return false;
    if (window.SeBind && window.SeBind.settle) window.SeBind.settle();
    // layout px from shares; the second super is 2a by 2b layout px about (cx, cy)
    const W2 = 2 * sb.a, H2 = 2 * sb.b, X = s => sb.cx - sb.a + s * W2, Y = s => sb.cy - sb.b + s * H2;
    const f = F.f || 1, sx = l => F.px + (l - F.px) * f, sy = l => F.py + (l - F.py) * f;   // layout to screen
    const size = (b, side) => {
      const v = Math.max(10, Math.round(side));
      b.style.width = v + "px"; b.style.height = v + "px"; b.classList.add("se-sized");
      try { localStorage.setItem("se:size:" + b.dataset.key, JSON.stringify({ w: v, h: v })); } catch (_) { /* private mode */ }
    };
    const h = START.hold;
    window.LabView.setRect(hold, X(h[0]), Y(h[1]), (h[2] - h[0]) * W2, (h[3] - h[1]) * H2);
    const c = START.connect, cs = c[2] * W2;
    size(B.connect, cs);
    const put = (b, lx, ly) => (O().placeBubbleAt || O().placeBubble)(b.dataset.key, sx(lx), sy(ly));
    put(B.connect, X(c[0]) + cs / 2, Y(c[1]) + cs / 2);
    const t = START.tiny * W2;
    [[B.tools, 0, 0], [B.explore, 1, 0], [B.lab, 0, 1], [B.lib, 1, 1]].forEach(([b, i, j]) => { size(b, t); put(b, X(START.cols[i]), Y(START.rows[j])); });
    const pj = START.project, pw = (pj[2] - pj[0]) * W2, ph = (pj[3] - pj[1]) * H2;
    if (window.SeProject.resize) window.SeProject.resize(pw, ph);
    const pr = proj.getBoundingClientRect();
    window.SeProject.moveBy(sx(X(pj[0])) - pr.left, sy(Y(pj[1])) - pr.top);
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
