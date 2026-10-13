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
  let sel = "";                                               // "loop", "site", or an element (a window, a bubble, a loop); set below
  const markSite = () => { if (sel === "site" && html.classList.contains("shape-se") && !html.classList.contains("se-sel-site")) html.classList.add("se-sel-site"); };
  markSite();
  new MutationObserver(markSite).observe(html, { attributes: true, attributeFilter: ["class"] });   // the look may be decided later (channel.js)

  const inSite = (x, y) => !!(S().inSite && S().inSite(x, y));
  const inLoop = (x, y) => !O().inLoop || O().inLoop(x, y);
  function loopHolding(x, y, except) {                        // the smallest loop whose ring holds the point
    let best = null;
    document.querySelectorAll(".lv-node.is-loop, .lv-node.is-holder").forEach(l => {
      if (l === except || (except && except.contains && l.contains(except))) return;
      const r = l.getBoundingClientRect(), R = r.width / 2;
      const ins = l.classList.contains("is-holder") ? (x > r.left + 6 && x < r.right - 6 && y > r.top + 6 && y < r.bottom - 6)   // a holder: its box
        : Math.hypot(x - (r.left + R), y - (r.top + r.height / 2)) < R - 4;                                                      // a loop: its ring
      if (ins && (!best || r.width < best.getBoundingClientRect().width)) best = l;
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
      if (el.closest(".orbit-title, .lv-palette")) return "loop";
      if (el.closest(".se-req")) return "site";
    }
    return loopHolding(x, y) || (inSite(x, y) ? "site" : "loop");
  }
  const ownCursor = el => !!(el && el.closest && el.closest(".se-port, .wire-hit, .wire-handle, .op-head button, .op-close, .se-ctlbar"));
  function elOf(s) { return s === "loop" ? null : s === "site" ? null : s; }
  function select(s) {
    if (s === sel) return;
    const old = elOf(sel); if (old) old.classList.remove("se-sel");
    sel = s;
    html.classList.toggle("se-sel-site", s === "site"); html.classList.toggle("se-sel-loop", s === "loop");
    const el = elOf(s); if (el) el.classList.add("se-sel");
    document.dispatchEvent(new CustomEvent("se:select", { detail: { selected: s } }));
  }
  const name = s => s === "loop" ? "the main super" : s === "site" ? "the site" : s.classList.contains("orbit-panel") ? "the window" : s.classList.contains("orbit-bubble") ? "the bubble" : s.classList.contains("ob-member") ? "the pill" : s.classList.contains("lv-node") ? "the node" : s.classList.contains("se-project") ? "the project" : "the card";

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
      if ((h = t.closest(".lv-node, .se-project"))) return { on: h };
      if ((h = t.closest(".se-req")) && !t.closest(".se-req-card")) return { on: h };   // privacy choices, a super like the others (super/requests.js)
      if ((h = t.closest(".orbit-title"))) return { on: h.querySelector(".se-titlesuper") || h };   // the title is a selectable super (owner, 2026-10-12)
      if (t.closest(".lv-palette")) return { inside: "loop" };
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
    // the press selects the super around it; its click presses nothing (eaten below), but the press itself
    // goes on, so a wire can start from a pill's words without pressing twice (super/wire.js)
    e.preventDefault();
    eatClick = performance.now() + 700;
    select(at.inside);
    const out = document.querySelector(".lv-out"); if (out) out.textContent = "Selected " + name(at.inside) + ": now its inside answers";
  }, true);
  let eatClick = 0;
  document.addEventListener("click", e => { if (eatClick && performance.now() < eatClick) { eatClick = 0; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  // a scroll is not about selection: the pointer's shape says what it does (super/scroll.js zoneAt)
  // a selection sticks: it changes only when another super is clicked (or the selected one goes away)
  // a selected super that goes away (a window closes, a loop is deleted): the main super again
  setInterval(() => { const el = elOf(sel); if (el && !el.isConnected) select("loop"); }, 500);
  document.addEventListener("dblclick", e => { if (on() && e.target.closest && e.target.closest(".wire-hit")) return; }, true);
  // nothing is selected at first: a calm start (owner, 2026-10-12: "make it look professional"); a click selects
  window.SeSelect = { selected: () => sel, select, containerOf, superAt, isSelected: s => s === sel };
  // a super that opens is selected (owner, 2026-10-13: "when a super is opened it is selected by default"): a window
  // as it appears, a bubble once it has grown open, the project once it is open
  const wasOpen = new WeakMap();
  const isOpen = el => el.classList.contains("orbit-panel") ? !el.classList.contains("leaving")
    : el.classList.contains("orbit-bubble") ? !el.classList.contains("is-compact") && !el.classList.contains("is-growing")
    : el.classList.contains("se-project") ? el.classList.contains("is-open") : false;
  function lookOpen() {
    if (!on()) return;
    document.querySelectorAll(".orbit-panel, .orbit-bubble.is-group, .se-project").forEach(el => {
      const now = isOpen(el), was = wasOpen.get(el);
      wasOpen.set(el, now);
      if (now && was === false && el.getClientRects().length) select(el);
      else if (now && was === undefined && el.classList.contains("orbit-panel") && performance.now() > 4000) select(el);   // a window that has just appeared
    });
  }
  new MutationObserver(() => { clearTimeout(lookOpen.t); lookOpen.t = setTimeout(lookOpen, 60); }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
})();
