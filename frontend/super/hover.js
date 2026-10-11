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
  function update() {
    pending = false;
    if (!on() || !last) return;
    const [x, y] = last;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return set(null, "");
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
  document.addEventListener("se:frame", () => { if (last && !pending) { pending = true; requestAnimationFrame(update); } });
})();
