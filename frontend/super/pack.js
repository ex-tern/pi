// super/pack.js: the start packs its supers close together (owner, 2026-10-13: "make the supers very close to each
// other"). The program's at.inSite places them for a usual screen; the bubbles' size follows the screen's shape, so on
// a first visit (or after a reset) this measures it and sets Connect, the third super with Tools, Explore and Library
// along its top and Lab and the project under them, GAP layout px apart, the third super wrapped close round its
// members, the whole group in the middle of the second super. Once; after that, wherever you move them.
(function () {
  "use strict";
  const html = document.documentElement;
  const GAP = 4, PAD = 5, KEY = "se:packed";
  const done = () => { try { return localStorage.getItem(KEY) === "1"; } catch (_) { return true; } };
  const O = () => window.PiOrbit || {};
  function pack() {
    if (!html.classList.contains("shape-se") || done() || window.innerWidth < 700) return false;
    const sb = O().siteBox && O().siteBox(), f = (O().fit && O().fit().f) || 1, F = O().fit ? O().fit() : null;
    const q = s => document.querySelector(s);
    const B = { connect: q('.orbit-bubble[data-key^="connect:"]'), tools: q('.orbit-bubble[data-key="assess:Tools group"]'), explore: q('.orbit-bubble[data-key^="explore:"]'),
      lib: q('.orbit-bubble[data-key^="lib:"]'), lab: q('.orbit-bubble[data-key^="lab:Lab"]') };
    const hold = q('.lv-node[data-id="hold"]'), proj = q(".se-project");
    if (!sb || !F || !hold || !proj || !window.LabView || !window.LabView.setRect || !O().placeBubble || !window.SeProject || Object.values(B).some(b => !b || !b.classList.contains("is-compact"))) return false;
    const S = B.connect.offsetWidth;                                     // a compact bubble's side, in layout px
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
    const hx = x0 + S + GAP, row1 = y0 + T + S / 2, row2 = row1 + S + GAP;
    const col = i => hx + P + S / 2 + i * (S + GAP);
    const scr = (x, y) => [F.px + (x - F.px) * f, F.py + (y - F.py) * f];   // layout to screen
    window.LabView.setRect(hold, hx, y0, W, H);
    const put = (b, x, y) => { const [sx, sy] = scr(x, y); (O().placeBubbleAt || O().placeBubble)(b.dataset.key, sx, sy); };
    put(B.connect, x0 + S / 2, row1);
    put(B.tools, col(0), row1); put(B.explore, col(1), row1); put(B.lib, col(2), row1); put(B.lab, col(1), row2);
    const pr = proj.getBoundingClientRect(), [tx, ty] = scr(col(2) - S / 2, row2 - S / 2);
    window.SeProject.moveBy(tx - pr.left, ty - pr.top);
    try { localStorage.setItem(KEY, "1"); } catch (_) { /* private mode */ }
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
    if (!pack()) setTimeout(attempt, 120);
  }
  document.addEventListener("orbit:ready", () => setTimeout(attempt, 150));
  if (window.PiOrbit && window.PiOrbit.siteBox) setTimeout(attempt, 300);
  window.SePack = { pack: () => { try { localStorage.removeItem(KEY); } catch (_) {} return pack(); } };
})();
