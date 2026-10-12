// super/chain.js: a chain beside every super's lock (owner, 2026-10-12: "add chain icon which groups a supers inside
// it for every super near the lock icon").
//
// Chained, a super and everything it holds (super/hold.js, all the way down) are one group: a drag on any of them
// moves the whole group, so nothing inside comes apart or is pulled out. Unchained, what it holds still follows it
// when it moves, and each of them can be dragged on its own (in or out), as before. A click toggles it, a scroll in
// on it chains, a scroll out unchains (as the lock does); kept per browser as se:chain:<name>.
//
//   SeChain.isChained(el)    SeChain.set(el, on)    SeChain.groupOf(el)  the outermost chained super holding el, or null
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const SUPERS = ".lv-node[data-id], .orbit-bubble.is-group[data-key], .orbit-panel, .se-project, .orbit-title .se-titlesuper";
  const nameOf = el => (window.SeLock && window.SeLock.nameOf(el)) || null;
  const load = n => { try { return localStorage.getItem("se:chain:" + n) === "1"; } catch (_) { return false; } };
  const save = (n, v) => { try { if (v) localStorage.setItem("se:chain:" + n, "1"); else localStorage.removeItem("se:chain:" + n); } catch (_) { /* private mode */ } };
  const isChained = el => !!(el && el.classList && el.classList.contains("is-chained"));
  const label = v => v ? "Chained: it and what it holds move as one. Click to unchain" : "Unchained: what it holds moves on its own. Click to chain";

  function set(el, v) {
    const name = nameOf(el); if (!name) return;
    el.classList.toggle("is-chained", !!v); save(name, !!v);
    const b = el.querySelector(":scope > .se-chain");
    if (b) { b.setAttribute("aria-pressed", String(!!v)); b.setAttribute("aria-label", label(!!v)); }
    const out = document.querySelector(".lv-out"); if (out) out.textContent = (v ? "Chained " : "Unchained ") + name.replace(/^(node|bubble|win):/, "");
    document.dispatchEvent(new CustomEvent("se:chain", { detail: { el, chained: !!v } }));
  }
  // two links, drawn with the same pen as the padlock; it carries .se-lock too, so every gesture leaves it alone as it
  // does the lock (no wiring, selecting, deleting or sizing from it)
  function badge(el) {
    if (el.querySelector(":scope > .se-chain")) return;
    const name = nameOf(el); if (!name || el.classList.contains("se-lockhost")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "se-lock se-chain";
    b.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect class="ch-link" x="0.8" y="4.2" width="5.8" height="3.6" rx="1.8"/><rect class="ch-link" x="5.4" y="4.2" width="5.8" height="3.6" rx="1.8"/></svg>';
    b.addEventListener("pointerdown", e => { e.stopPropagation(); e.preventDefault(); }, true);
    b.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); set(el, !isChained(el)); });
    b.addEventListener("dblclick", e => { e.stopPropagation(); e.preventDefault(); });
    el.appendChild(b);
    if (load(name)) el.classList.add("is-chained");
    b.setAttribute("aria-pressed", String(isChained(el))); b.setAttribute("aria-label", label(isChained(el)));
  }
  // a scroll on the chain: in chains, out unchains (taken before the lock's own handler, which skips the chain)
  let acc = 0, accT = 0;
  window.addEventListener("wheel", e => {
    const b = e.target && e.target.closest && e.target.closest(".se-chain");
    if (!b || e.shiftKey || !on()) return;
    if (window.SeScroll && window.SeScroll.gesturing(e.timeStamp)) return;   // a scroll gesture already sizing something goes on (super/scroll.js)
    e.preventDefault(); e.stopImmediatePropagation();
    const el = b.parentElement;
    acc += e.deltaY || e.deltaX; clearTimeout(accT); accT = setTimeout(() => { acc = 0; }, 400);
    if (acc < -30 && !isChained(el)) { acc = 0; set(el, true); } else if (acc > 30 && isChained(el)) { acc = 0; set(el, false); }
  }, { capture: true, passive: false });

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
  const SKIP = "input, textarea, select, [contenteditable], a, label, summary, .se-port, .se-lock, .wire-hit, .wire-handle, .lv-edge, .se-confirm, .op-body";
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
      if (window.SeShape && window.SeShape.note) window.SeShape.note(e.clientX, e.clientY, "locked", "the group it is chained into is locked");
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

  // no chain icon on any super any more (owner, 2026-10-12: "delete the chain icon from all supers"); a group made by
  // wiring (super/nodes.js regroup) is still chained, so its supers still move as one
  function sweep() { if (on()) document.querySelectorAll(".se-chain").forEach(b => b.remove()); void badge; }
  function start() { sweep(); new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true }); }
  window.SeChain = { isChained, set, groupOf };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
