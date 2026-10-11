// super/select.js — a super has to be selected before anything inside it can be changed.
//
// The supers nest: the main loop holds the inner super, the title, Live, the nodes and the loops; the
// inner super holds the bubbles and the windows; a window holds its cards; a bubble holds its pills; a
// loop holds the nodes inside its ring. One super is selected at a time (the main loop at first) and
// shows a cobalt edge. A click on a super selects it (and goes on to it). A click, a scroll, a drag or
// a wire on something inside a super that is not selected does not reach it: the click selects that
// super instead, and a scroll there sizes the super as a whole. Once a super is selected, everything
// inside it answers as usual: a double click on its bare space makes a node, a scroll sizes a thing.
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
  const name = s => s === "loop" ? "the main super" : s === "site" ? "the site" : s.classList.contains("orbit-panel") ? "the window" : s.classList.contains("orbit-bubble") ? "the bubble" : s.classList.contains("ob-member") ? "the pill" : s.classList.contains("lv-node") ? "the node" : "the card";

  // what a point is on: a super itself (a bubble, a window, a node, a loop, the inner super's or the main
  // loop's bare space), or something inside one (a pill, a card, a button: {inside: its super})
  function superAt(t, x, y) {
    if (t && t.closest) {
      let h;
      // the supers inside a super can be selected too, once the super around them is: a card in a selected
      // window, a pill in a selected bubble
      if ((h = t.closest(INSIDE_PANEL))) { const w = h.closest(".orbit-panel"); return w === sel ? { on: h } : { inside: w || "site" }; }
      if ((h = t.closest(".op-body, .op-head"))) return { inside: h.closest(".orbit-panel") || "site" };
      if ((h = t.closest(".ob-member"))) { const bb = h.closest(".orbit-bubble"); return bb === sel ? { on: h } : { inside: bb || "site" }; }
      if ((h = t.closest(".ob-chat"))) return { inside: h.closest(".orbit-bubble") || "site" };
      if ((h = t.closest(".orbit-panel"))) return { on: h };
      if ((h = t.closest(".orbit-bubble"))) return { on: h };
      if ((h = t.closest(".lv-node"))) return { on: h };
      if (t.closest(".orbit-title, .live-dock, .lv-palette")) return { inside: "loop" };
    }
    return { on: loopHolding(x, y) || (inSite(x, y) ? "site" : "loop") };
  }
  // a click on a super selects it (and goes on to it: a drag, a press); a click on something inside a super
  // that is not selected selects that super instead and goes no further
  document.addEventListener("pointerdown", e => {
    if (!on() || e.button !== 0) return;
    const t = e.target, x = e.clientX, y = e.clientY;
    if (ownCursor(t)) return;                                  // ports and wires are the lattice's own, always live
    const at = superAt(t, x, y);
    if (at.on) { select(at.on); return; }
    if (at.inside === sel) return;
    e.preventDefault(); e.stopImmediatePropagation();
    select(at.inside);
    const out = document.querySelector(".lv-out"); if (out) out.textContent = "Selected " + name(at.inside) + ": now its inside answers";
  }, true);
  // a scroll on something inside an unselected super is a scroll on the super itself: its n
  document.addEventListener("wheel", e => {
    if (!on() || e.shiftKey) return;
    const t = e.target, x = e.clientX, y = e.clientY;
    if (ownCursor(t)) return;
    const Z = window.SeZoom;
    if (Z && Z.edgeSuper && Z.edgeSuper(x, y, t)) return;       // the band outside a super: its n, as always
    const at = superAt(t, x, y);
    if (at.on || at.inside === sel) return;
    const c = at.inside;
    e.preventDefault(); e.stopImmediatePropagation();
    const dy = (e.deltaY || e.deltaX) * (e.ctrlKey ? 4 : 1);
    if (c === "loop") { if (O().scrollN) O().scrollN(e); return; }
    if (c === "site") { if (O().scrollSiteN) O().scrollSiteN(e); return; }
    if (c.classList.contains("lv-node")) { if (window.LabView && window.LabView.shapeNode) window.LabView.shapeNode(c, dy); return; }
    if (S().shapeEl) S().shapeEl(c, dy);
  }, { capture: true, passive: false });
  // a selection sticks: it changes only when another super is clicked (or the selected one goes away)
  // a selected super that goes away (a window closes, a loop is deleted): the main super again
  setInterval(() => { const el = elOf(sel); if (el && !el.isConnected) select("loop"); }, 500);
  document.addEventListener("dblclick", e => { if (on() && e.target.closest && e.target.closest(".wire-hit")) return; }, true);
  select("loop");
  window.SeSelect = { selected: () => sel, select, containerOf, superAt, isSelected: s => s === sel };
})();
