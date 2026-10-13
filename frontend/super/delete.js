// super/delete.js: a double click on any super deletes it at once, unless it is locked or saved (owner, 2026-10-12:
// "any super can be deleted by double click if it is not locked"; the confirmation, a square "delete" and a sparkle
// "keep", gave way to the save icon beside the lock: "remove these instead add a save icon next to the lock").
//
// A Super AI super or a holder (with what it holds) fades away with its wires; a bubble or the project super is gone
// until the app is reset; a window closes. The central super, the title, the main and second supers are not deleted.
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {};
  const NOT = "input, textarea, select, [contenteditable], button, a, summary, label, .ob-member, .ob-chat, .se-port, .se-lock, .wire-hit, .lv-edge, .se-confirm";
  function superAt(t) {
    if (!t || !t.closest || t.closest(NOT)) return null;
    const node = t.closest(".lv-node");
    if (node) return node.dataset.id === "site-box" ? null : node;
    const bub = t.closest(".orbit-bubble.is-group"); if (bub) return bub;
    if (t.classList && t.classList.contains("orbit-panel")) return t;  // a window by its blank margin (its content stays native)
    const head = t.closest(".op-head"); if (head) return head.closest(".orbit-panel");
    const pj = t.closest(".se-project:not(.is-open)"); if (pj) return pj;
    return null;
  }
  const nameOf = el => el.classList.contains("lv-node") ? ((el.textContent || "").trim().slice(0, 24) || "the super")
    : el.classList.contains("orbit-bubble") ? ((el.querySelector(":scope > .ob-label") || {}).textContent || "the bubble").trim()
    : el.classList.contains("orbit-panel") ? ((el.querySelector(".op-title") || {}).textContent || "the window").trim()
    : "the project";
  // every super closes the same way (owner, 2026-10-12: "closing a super should animate like n goes to zero and
  // vanishes", "makes them uniform"): its n glides to 0.3 (a star), it shrinks into its centre and fades, then it goes
  function vanish(el, done) {
    if (el._vanishing) return; el._vanishing = true;
    const t0 = performance.now(), T = 700 * ((window.SeMotion && window.SeMotion.SLOW) || 1), n0 = Math.PI, n1 = 0.3;
    el.style.pointerEvents = "none"; el.style.transformOrigin = "50% 50%";
    const step = now => {
      const t = Math.min(1, (now - t0) / T), e = t * t * (3 - 2 * t), k = Math.log2(n0 + (n1 - n0) * e).toFixed(4);
      el.style.setProperty("--lv-k", k); el.style.setProperty("--se-k-window", k); el.style.setProperty("--se-k", k);
      el.style.scale = String(1 - 0.92 * e); el.style.opacity = String(1 - e);
      if (t < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  }
  function remove(el) { vanish(el, () => removeNow(el)); }
  function removeNow(el) {
    if (el.classList.contains("lv-node")) { if (window.LabView && window.LabView.close) window.LabView.close(el, true); }
    else if (el.classList.contains("orbit-bubble")) { if (O().gone) O().gone(el.dataset.key); }   // it has vanished already
    else if (el.classList.contains("orbit-panel")) { const k = O().keyOf ? O().keyOf(el) : null; if (k && O().close) O().close(k); }
    else if (el.classList.contains("se-project")) { if (window.SeProject && window.SeProject.remove) window.SeProject.remove(); }
    const out = document.querySelector(".lv-out"); if (out) out.textContent = "Deleted " + nameOf(el);
  }
  // no confirmation any more (owner, 2026-10-12: "remove these instead add a save icon next to the lock"): an unsaved,
  // unlocked super is deleted at once; a saved one (super/save.js) or a locked one stays, and says why
  function ask(el, x, y) {
    if (!el) return;
    if (window.SeLock && window.SeLock.isLocked(el)) { /* a locked super simply does nothing: no note (owner, 2026-10-13) */ return; }
    if (window.SeSave && window.SeSave.isSaved(el)) { if (window.SeShape && window.SeShape.note) window.SeShape.note(x, y, "saved", "unsave it to delete it"); return; }
    remove(el);
  }
  const close = () => {};
  let pressT = null;                                                   // where the press was (a holder captures presses on its bare space)
  document.addEventListener("pointerdown", e => { pressT = e.target; }, true);
  document.addEventListener("dblclick", e => {
    if (!on() || e.button) return;
    const t = (e.target.classList && e.target.classList.contains("is-holder") && pressT && pressT.closest && !pressT.closest(".lv-node")) ? pressT : e.target;
    const el = superAt(t); if (!el) return;
    e.preventDefault(); e.stopImmediatePropagation();
    ask(el, e.clientX, e.clientY);
  }, true);
  window.SeDelete = { ask, close };
})();
