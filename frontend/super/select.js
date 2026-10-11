// super/select.js — a super has to be selected before anything inside it can be changed.
//
// The supers nest: the main loop holds the inner super, the title, Live, the nodes and the loops; the
// inner super holds the bubbles and the windows; a window holds its cards; a bubble holds its pills; a
// loop holds the nodes inside its ring. One super is selected at a time (the main loop at first) and
// shows a cobalt edge. A click, a scroll, a drag or a wire on something inside a super that is not
// selected does not reach it: the first click selects that super instead, and a scroll there sizes
// the super as a whole (a finger on its surface). Once a super is selected, everything inside it
// answers as usual: a click on its bare space makes a node, a scroll sizes a thing, a drag wires it.
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {};
  const S = () => window.SeSite || {};
  const INSIDE_PANEL = ".op-body .card, .rs-card, .perf-card, .perf-next, .buddy-corpus, .stat-card, .tr-tile";
  let sel = "loop";                                           // "loop", "site", or an element (a window, a bubble, a loop)

  const inSite = (x, y) => !!(S().inSite && S().inSite(x, y));
  const inLoop = (x, y) => !O().inLoop || O().inLoop(x, y);
  function loopHolding(x, y, except) {                        // the smallest loop whose ring holds the point
    let best = null;
    document.querySelectorAll(".lv-node.is-loop").forEach(l => {
      if (l === except) return;
      const r = l.getBoundingClientRect(), R = r.width / 2;
      if (Math.hypot(x - (r.left + R), y - (r.top + r.height / 2)) < R - 4 && (!best || r.width < best.getBoundingClientRect().width)) best = l;
    });
    return best;
  }
  // the super that holds a thing (its container), or the super whose bare space a point is on
  function containerOf(el, x, y) {
    if (el) {
      let h;
      if ((h = el.closest(INSIDE_PANEL))) return h.closest(".orbit-panel") || "site";
      if ((h = el.closest(".ob-member, .ob-chat"))) return h.closest(".orbit-bubble") || "site";
      if ((h = el.closest(".orbit-panel"))) return "site";
      if ((h = el.closest(".orbit-bubble"))) return "site";
      if ((h = el.closest(".lv-node"))) { const r = h.getBoundingClientRect(); return loopHolding(r.left + r.width / 2, r.top + r.height / 2, h) || (inSite(r.left + r.width / 2, r.top + r.height / 2) ? "site" : "loop"); }
      if (el.closest(".orbit-title, .live-dock, .lv-palette")) return "loop";
    }
    return loopHolding(x, y) || (inSite(x, y) ? "site" : "loop");
  }
  const isThing = el => !!(el && el.closest && el.closest(".orbit-panel, .orbit-bubble, .lv-node, .orbit-title, .live-dock, .lv-palette"));
  const ownCursor = el => !!(el && el.closest && el.closest(".se-port, .wire-hit, .wire-handle, .op-head button, .op-close"));
  function elOf(s) { return s === "loop" ? null : s === "site" ? null : s; }
  function select(s) {
    if (s === sel) return;
    const old = elOf(sel); if (old) old.classList.remove("se-sel");
    sel = s;
    html.classList.toggle("se-sel-site", s === "site"); html.classList.toggle("se-sel-loop", s === "loop");
    const el = elOf(s); if (el) el.classList.add("se-sel");
    document.dispatchEvent(new CustomEvent("se:select", { detail: { selected: s } }));
  }
  const name = s => s === "loop" ? "the main super" : s === "site" ? "the site" : s.classList.contains("orbit-panel") ? "the window" : s.classList.contains("orbit-bubble") ? "the bubble" : "the loop";

  // a pointer on something inside an unselected super: the super is selected instead, nothing inside moves
  document.addEventListener("pointerdown", e => {
    if (!on() || e.button !== 0) return;
    const t = e.target, x = e.clientX, y = e.clientY;
    if (ownCursor(t)) return;                                  // ports and wires are the lattice's own, always live
    const c = containerOf(isThing(t) || (t.closest && t.closest(INSIDE_PANEL + ", .ob-member")) ? t : null, x, y);
    if (c === sel) return;
    e.preventDefault(); e.stopImmediatePropagation();
    select(c);
    const out = document.querySelector(".lv-out"); if (out) out.textContent = "Selected " + name(c) + ": now its inside answers";
  }, true);
  // a scroll inside an unselected super sizes the super as a whole
  document.addEventListener("wheel", e => {
    if (!on() || e.shiftKey) return;
    const t = e.target, x = e.clientX, y = e.clientY;
    if (ownCursor(t)) return;
    const Z = window.SeZoom;
    if (Z && Z.edgeSuper && Z.edgeSuper(x, y, t)) return;       // the band outside a super: its n, as always
    const c = containerOf(isThing(t) || (t.closest && t.closest(INSIDE_PANEL + ", .ob-member")) ? t : null, x, y);
    if (c === sel) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const dy = (e.deltaY || e.deltaX) * (e.ctrlKey ? 4 : 1);
    if (c === "loop") return;                                   // the main super is the display: nothing to size
    if (c === "site") { if (O().zoomPage) O().zoomPage(Math.exp(-dy * 0.0015)); return; }
    if (c.classList.contains("orbit-panel")) { if (S().sizeWindow) S().sizeWindow(c, dy); return; }
    if (c.classList.contains("lv-node")) { if (window.LabView && window.LabView.zoomNode) window.LabView.zoomNode(c, dy); return; }
    if (Z && Z.sizeThing) Z.sizeThing(c, dy);
  }, { capture: true, passive: false });
  // a selection lasts while the pointer is inside the super: leaving it hands the selection back to the
  // super around it (a click enters a super, moving out of it leaves it)
  const parentOf = s => s === "loop" ? "loop" : s === "site" ? "loop" : containerOf(s, 0, 0);
  let lastXY = null, leaveT = 0;
  document.addEventListener("pointermove", e => {
    if (!on() || e.pointerType === "touch" || e.buttons) return;
    lastXY = [e.clientX, e.clientY];
    if (leaveT) return;
    leaveT = setTimeout(() => {
      leaveT = 0;
      if (!lastXY || sel === "loop") return;
      const [x, y] = lastXY, M = 14;
      let inside;
      if (sel === "site") inside = inSite(x, y);
      else if (sel.classList.contains("lv-node")) { const r = sel.getBoundingClientRect(), R = r.width / 2; inside = Math.hypot(x - (r.left + R), y - (r.top + r.height / 2)) <= R + M; }
      else { const r = sel.getBoundingClientRect(); inside = x >= r.left - M && x <= r.right + M && y >= r.top - M && y <= r.bottom + M; }
      if (!inside) select(parentOf(sel));
    }, 120);
  }, { passive: true });
  // a selected super that goes away (a window closes, a loop is deleted): the main super again
  setInterval(() => { const el = elOf(sel); if (el && !el.isConnected) select("loop"); }, 500);
  document.addEventListener("dblclick", e => { if (on() && e.target.closest && e.target.closest(".wire-hit")) return; }, true);
  select("loop");
  window.SeSelect = { selected: () => sel, select, containerOf, isSelected: s => s === sel };
})();
