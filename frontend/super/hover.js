// super/hover.js — the super under the pointer lights up cobalt, so you always see which super you are on.
//
// The innermost one: a node, a card in a window, a window, a bubble, the title's badge, the Live panel
// or its tab; on bare space inside the inner super, the inner super; inside the main loop on nothing,
// the main loop. Only its edge changes colour (the cobalt that means "here"), nothing glows, and a pill
// stays as it is (nothing on a pill looks pushable).
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {};
  const S = () => window.SeSite || {};
  const EL = ".lv-node, .op-body .card, .rs-card, .perf-card, .perf-next, .buddy-corpus, .stat-card, .tr-tile, .orbit-panel, .orbit-bubble, .orbit-title, .live-body, .live-tab, .lv-palette";
  let cur = null, curKind = "", pending = false, last = null;
  function set(el, kind) {
    if (el === cur && kind === curKind) return;
    if (cur) cur.classList.remove("se-on");
    html.classList.remove("se-on-site", "se-on-loop");
    cur = el; curKind = kind;
    if (el) el.classList.add("se-on");
    else if (kind) html.classList.add("se-on-" + kind);
  }
  // the pointer's shape says what a scroll does here: a hand on a super (its surface, bare space inside
  // it), where a scroll changes its n; an arrow in the band just outside it (and the bare corners), where
  // a scroll sizes it (the site zooms); on its very edge, a + for wiring
  function zone(x, y, hit) {                                          // the same zone a scroll acts on (super/scroll.js)
    const Z = window.SeZoom;
    if (!Z || !Z.zoneAt) return "";
    if (hit && hit.closest && hit.closest("button, a, .op-head")) return "";
    const z = Z.zoneAt(x, y, hit);
    return z ? z.kind : "";
  }
  function update() {
    pending = false;
    if (!on() || !last) return;
    const [x, y] = last;
    const hit = document.elementFromPoint(x, y);
    const z = zone(x, y, hit);
    html.classList.toggle("se-zone-hand", z === "hand"); html.classList.toggle("se-zone-arrow", z === "arrow");
    if (!hit) return set(null, "");
    // inside a super that is not selected (super/select.js) the super itself is what lights up
    const Sel = window.SeSelect;
    if (Sel && Sel.superAt) {
      const at = Sel.superAt(hit, x, y);
      if (at.inside && !Sel.isSelected(at.inside)) { const c = at.inside; if (c === "site") return set(null, "site"); if (c === "loop") return set(null, "loop"); return set(c, ""); }
    }
    const el = hit.closest && hit.closest(EL);
    if (el) return set(el, "");
    if (hit.closest && hit.closest(".se-port, .sl-layer, .lv-wires, .orbit-wires")) return;   // a port or a wire: leave it as it is
    if (S().inSite && S().inSite(x, y)) return set(null, "site");
    if (O().inLoop && O().inLoop(x, y)) return set(null, "loop");
    set(null, "");
  }
  document.addEventListener("pointermove", e => {
    if (e.pointerType === "touch") return;
    last = [e.clientX, e.clientY];
    if (!pending) { pending = true; requestAnimationFrame(update); }
  }, { passive: true });
  document.addEventListener("pointerleave", () => set(null, ""));
  // no tooltips: a hover lights the super and does nothing else. A title under the pointer becomes the
  // element's accessible name (aria-label) and stops being a tooltip; an SVG <title> (a wire's) is dropped
  document.addEventListener("pointerover", e => {
    if (!on()) return;
    for (let el = e.target; el && el !== document.documentElement; el = el.parentElement || el.parentNode) {
      if (el.nodeType !== 1) break;
      if (el.hasAttribute && el.hasAttribute("title")) {
        const t = el.getAttribute("title");
        if (t && !el.hasAttribute("aria-label")) el.setAttribute("aria-label", t);
        el.removeAttribute("title");
      }
      if (el.namespaceURI === "http://www.w3.org/2000/svg") { const st = el.querySelector && el.querySelector(":scope > title"); if (st) st.remove(); }
    }
  }, true);
  document.addEventListener("se:frame", () => { if (last && !pending) { pending = true; requestAnimationFrame(update); } });
})();
