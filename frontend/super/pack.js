// super/pack.js: lays out the start (owner, 2026-10-13: "the initial state of app is this picture"). The program's
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
  // the start (owner, 2026-10-13: "the initial state of app is this picture"): every bubble and the project one square
  // size; Connect on the left; beside it the third super holding Tools, Explore and Library along its top and Lab and
  // the project under Explore and Library (the empty corner under Tools left free); all in proportion to the square's
  // side S, measured from the owner's picture: GAP between squares, PAD inside the third super, TOP its lock strip
  const GAP = 0.027, PAD = 0.125, TOP = 0.15;
  function pack() {
    if (!html.classList.contains("shape-se") || done() || window.innerWidth < 700) return false;
    const sb = O().siteBox && O().siteBox(), F = O().fit ? O().fit() : null;
    const q = s => document.querySelector(s);
    const B = { connect: q('.orbit-bubble[data-key^="connect:"]'), tools: q('.orbit-bubble[data-key="assess:Tools group"]'), explore: q('.orbit-bubble[data-key^="explore:"]'),
      lib: q('.orbit-bubble[data-key^="lib:"]'), lab: q('.orbit-bubble[data-key^="lab:Lab"]') };
    const hold = q('.lv-node[data-id="hold"]'), proj = q(".se-project");
    if (!sb || !sb.a || !F || !hold || !proj || !window.LabView || !window.LabView.setRect || !O().placeBubble || !window.SeProject || Object.values(B).some(b => !b || !b.classList.contains("is-compact"))) return false;
    if (window.SeBind && window.SeBind.settle) window.SeBind.settle();
    // every bubble at the one compact size (sizes set before are dropped)
    Object.values(B).forEach(b => { if (b.classList.contains("se-sized")) { b.style.width = ""; b.style.height = ""; b.classList.remove("se-sized"); } try { localStorage.removeItem("se:size:" + b.dataset.key); } catch (_) { /* private mode */ } });
    let S = parseFloat(getComputedStyle(html).getPropertyValue("--se-compact")) || B.connect.offsetWidth;   // a compact bubble's side, in layout px
    if (!(S > 20)) return false;
    // the whole group fits the second super with a margin
    const fitS = Math.min(1.9 * sb.a / (4 + 3 * GAP + 2 * PAD), 1.9 * sb.b / (2 + GAP + TOP + PAD));
    if (S > fitS) S = fitS;
    const g = GAP * S, P = PAD * S, T = TOP * S;
    const W = 3 * S + 2 * g + 2 * P, H = T + 2 * S + g + P, total = S + g + W;
    const x0 = sb.cx - total / 2, y0 = sb.cy - H / 2, hx = x0 + S + g;
    window.LabView.setRect(hold, hx, y0, W, H);
    const f = F.f || 1, sx = l => F.px + (l - F.px) * f, sy = l => F.py + (l - F.py) * f;   // layout to screen
    const size = b => { if (Math.abs(b.offsetWidth - S) > 1) { const v = Math.round(S); b.style.width = v + "px"; b.style.height = v + "px"; b.classList.add("se-sized"); try { localStorage.setItem("se:size:" + b.dataset.key, JSON.stringify({ w: v, h: v })); } catch (_) { /* private mode */ } } };
    const put = (b, lx, ly) => { size(b); (O().placeBubbleAt || O().placeBubble)(b.dataset.key, sx(lx + S / 2), sy(ly + S / 2)); };
    const r1 = y0 + T, r2 = r1 + S + g, c = i => hx + P + i * (S + g);
    put(B.connect, x0, r1);
    put(B.tools, c(0), r1); put(B.explore, c(1), r1); put(B.lib, c(2), r1); put(B.lab, c(1), r2);
    if (window.SeProject.resize) window.SeProject.resize(S, S);
    // moved until it lands (its move is measured, not assumed: the project super may scale a move by the page's zoom)
    const tx = sx(c(2)), ty = sy(r2);
    let kx = 1, ky = 1;
    for (let k = 0; k < 4; k++) {
      const pr = proj.getBoundingClientRect(), dx = tx - pr.left, dy = ty - pr.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
      window.SeProject.moveBy(dx * kx, dy * ky);
      const nr = proj.getBoundingClientRect(), mx = nr.left - pr.left, my = nr.top - pr.top;
      if (Math.abs(mx) > 0.5) kx *= dx / mx; if (Math.abs(my) > 0.5) ky *= dy / my;
    }
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
