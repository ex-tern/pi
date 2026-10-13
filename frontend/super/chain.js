// super/chain.js: chaining a super (set from the Chain control, super/controls.js; the per-super chain icon was
// removed, owner, 2026-10-12).
//
// Chained, a super and everything it holds (super/hold.js, all the way down) are one group: a drag on any of them
// moves the whole group, so nothing inside comes apart or is pulled out. Unchained, what it holds still follows it
// when it moves, and each of them can be dragged on its own (in or out), as before. Kept per browser as se:chain:<name>.
//
//   SeChain.isChained(el)    SeChain.set(el, on)    SeChain.groupOf(el)  the outermost chained super holding el, or null
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const SUPERS = ".lv-node[data-id], .orbit-bubble.is-group[data-key], .orbit-panel, .se-project, .orbit-title .se-titlesuper";
  const nameOf = el => (window.SeLock && window.SeLock.nameOf(el)) || null;
  const save = (n, v) => { try { if (v) localStorage.setItem("se:chain:" + n, "1"); else localStorage.removeItem("se:chain:" + n); } catch (_) { /* private mode */ } };
  const isChained = el => !!(el && el.classList && el.classList.contains("is-chained"));

  function set(el, v) {
    const name = nameOf(el); if (!name) return;
    el.classList.toggle("is-chained", !!v); save(name, !!v);
    const out = document.querySelector(".lv-out"); if (out) out.textContent = (v ? "Chained " : "Unchained ") + name.replace(/^(node|bubble|win):/, "");
    document.dispatchEvent(new CustomEvent("se:chain", { detail: { el, chained: !!v } }));
  }
  // the group: the outermost chained super holding el, and everything under it
  const H = () => window.SeHold;
  function groupOf(el) {
    if (!H()) return null;
    let top = null, h = H().hostOf(el), guard = 0;
    while (h && guard++ < 12) { if (isChained(h)) top = h; h = H().hostOf(h); }
    return top;
  }
  function members(host) {
    const out = [], seen = new Set([host]);
    (function walk(h) { H().heldBy(h).forEach(m => { if (!seen.has(m)) { seen.add(m); out.push(m); walk(m); } }); })(host);
    return out;
  }
  // a press on a member of a chained group drags the group (a press on the chained super itself is its own drag,
  // which carries what it holds already); a press that does not move selects the member, as before
  const SKIP = "input, textarea, select, [contenteditable], a, label, summary, .se-port, .se-lock, .wire-hit, .wire-handle, .lv-edge, .op-body";
  let drag = null;
  window.addEventListener("pointerdown", e => {
    if (!on() || e.button !== 0 || e.shiftKey || e.altKey) return;
    const t = e.target; if (!t || !t.closest || t.closest(SKIP)) return;
    const el = t.closest(SUPERS); if (!el) return;
    const host = groupOf(el); if (!host) return;
    const r = el.getBoundingClientRect(), d = Math.min(e.clientX - r.left, r.right - e.clientX, e.clientY - r.top, r.bottom - e.clientY);
    if (d <= 10) return;                                               // its edge starts a wire, as on any super
    e.stopImmediatePropagation();
    if (window.SeLock && window.SeLock.isLocked(host)) {
      /* a locked super simply does nothing: no note (owner, 2026-10-13) */
      drag = { el, host, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, locked: true };
      return;
    }
    drag = { el, host, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, group: [host, ...members(host)] };
  }, true);
  window.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id || drag.locked) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; html.classList.add("se-chain-dragging"); drag.group.forEach(g => g.classList.add("is-dragging")); }
    e.preventDefault(); e.stopImmediatePropagation();
    drag.x = e.clientX; drag.y = e.clientY;
    H().move(drag.group, dx, dy);
  }, true);
  const end = e => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    if (d.moved) {
      e.stopImmediatePropagation();
      html.classList.remove("se-chain-dragging"); d.group.forEach(g => g.classList.remove("is-dragging"));
      document.dispatchEvent(new CustomEvent("se:obstacle"));
      if (window.PiOrbit && window.PiOrbit.layout) window.PiOrbit.layout();
    } else if (window.SeSelect && window.SeSelect.select) {             // a click: the member is selected (and takes typing)
      window.SeSelect.select(d.el);
      if (d.el.classList.contains("lv-node")) d.el.focus({ preventScroll: true });
    }
  };
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);

  window.SeChain = { isChained, set, groupOf };
})();
