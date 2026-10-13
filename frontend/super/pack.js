// super/pack.js: the start packs its supers close together (owner, 2026-10-13: "make the supers very close to each
// other"). The program's at.inSite places them for a usual screen; the bubbles' size follows the screen's shape, so on
// a first visit (or after a reset) this measures it and sets Connect, the third super with Tools, Explore and Library
// along its top and Lab and the project under them, GAP layout px apart, the third super wrapped close round its
// members, the whole group in the middle of the second super. Once; after that, wherever you move them.
(function () {
  "use strict";
  const html = document.documentElement;
  const GAP = 4, PAD = 5, KEY = "se:touched";
  const done = () => { try { return localStorage.getItem(KEY) === "1"; } catch (_) { return true; } };
  // the first press, scroll or wire on a super makes the arrangement yours
  const touch = e => { if (done() || !e.isTrusted) return; const t = e.target; if (t && t.closest && t.closest(".orbit-bubble, .lv-node, .se-project, .orbit-panel, .se-port, .wire-hit, .sl-layer, .orbit-title")) { try { localStorage.setItem(KEY, "1"); } catch (_) { /* private mode */ } } };
  document.addEventListener("pointerdown", touch, true);
  document.addEventListener("wheel", touch, { capture: true, passive: true });
  const O = () => window.PiOrbit || {};
  function pack() {
    if (!html.classList.contains("shape-se") || done() || window.innerWidth < 700) return false;
    const sb = O().siteBox && O().siteBox(), f = (O().fit && O().fit().f) || 1, F = O().fit ? O().fit() : null;
    const q = s => document.querySelector(s);
    const B = { connect: q('.orbit-bubble[data-key^="connect:"]'), tools: q('.orbit-bubble[data-key="assess:Tools group"]'), explore: q('.orbit-bubble[data-key^="explore:"]'),
      lib: q('.orbit-bubble[data-key^="lib:"]'), lab: q('.orbit-bubble[data-key^="lab:Lab"]') };
    const hold = q('.lv-node[data-id="hold"]'), proj = q(".se-project");
    if (!sb || !F || !hold || !proj || !window.LabView || !window.LabView.setRect || !O().placeBubble || !window.SeProject || Object.values(B).some(b => !b || !b.classList.contains("is-compact"))) return false;
    // every bubble at the one compact size (sizes super/bind.js gave members while the window changed are dropped),
    // and bind.js measures their places afresh once they have glided there
    if (window.SeBind && window.SeBind.settle) window.SeBind.settle();
    Object.values(B).forEach(b => { if (b.classList.contains("se-sized")) { b.style.width = ""; b.style.height = ""; b.classList.remove("se-sized"); } try { localStorage.removeItem("se:size:" + b.dataset.key); } catch (_) { /* private mode */ } });
    const S = parseFloat(getComputedStyle(html).getPropertyValue("--se-compact")) || B.connect.offsetWidth;   // a compact bubble's side, in layout px
    if (!(S > 20)) return false;
    // the third super's room is what super/bind.js keeps its members in (bind.js inner): a padding of 3.5 % of its
    // smaller side plus up to 4 px on screen, and a top strip for its lock and name of 6.5 % of its height, at most
    // 46 px; packed any closer, bind.js would squeeze the members together to keep them in
    let W = 3 * S + 2 * GAP + 2 * PAD, H = 2 * S + GAP + 2 * PAD, P = PAD, T = PAD;
    for (let it = 0; it < 8; it++) {
      P = 0.035 * Math.min(W, H) + Math.min(4 / f, 0.02 * W) + 1;
      T = Math.max(P, Math.min(46, 0.065 * H)) + 1;
      W = 3 * S + 2 * GAP + 2 * P; H = T + 2 * S + GAP + P;
    }
    const total = S + GAP + W;
    const x0 = sb.cx - total / 2, y0 = sb.cy - H / 2;                  // the group in the middle of the second super
    const hx = x0 + S + GAP;
    window.LabView.setRect(hold, hx, y0, W, H);
    // the rest from where the third super really is on screen now (a layout-to-screen mapping can be stale just after
    // the window changed size), in screen px
    const hr = hold.getBoundingClientRect(), k = hr.width / W, s = S * k, g = GAP * k, p = P * k, tt = T * k;
    const r1 = hr.top + tt + s / 2, r2 = r1 + s + g, c = i => hr.left + p + s / 2 + i * (s + g);
    const put = (b, x, y) => (O().placeBubbleAt || O().placeBubble)(b.dataset.key, x, y);
    put(B.connect, hr.left - g - s / 2, r1);
    put(B.tools, c(0), r1); put(B.explore, c(1), r1); put(B.lib, c(2), r1); put(B.lab, c(1), r2);
    if (window.SeProject.resize) window.SeProject.resize(S, S);         // the project at the bubbles' size too
    const pr = proj.getBoundingClientRect();
    window.SeProject.moveBy(c(2) - s / 2 - pr.left, r2 - s / 2 - pr.top);
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
