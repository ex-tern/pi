// super/delete.js: a double click on any super deletes it, unless it is locked, after a confirmation (owner,
// 2026-10-12: "any super can be deleted by double click if it is not locked. ask for a confirmation before deleting
// by showing a square or sparkle supers"). Beside the super two small supers appear: a square that deletes it and a
// sparkle that keeps it (Escape, or a press anywhere else, keeps it too).
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
  function remove(el) {
    if (el.classList.contains("lv-node")) { if (window.LabView && window.LabView.close) window.LabView.close(el); }
    else if (el.classList.contains("orbit-bubble")) { el.classList.add("se-closing"); setTimeout(() => { el.classList.remove("se-closing"); if (O().gone) O().gone(el.dataset.key); }, 700); }
    else if (el.classList.contains("orbit-panel")) { const k = O().keyOf ? O().keyOf(el) : null; if (k && O().close) O().close(k); }
    else if (el.classList.contains("se-project")) { if (window.SeProject && window.SeProject.remove) window.SeProject.remove(); }
    const out = document.querySelector(".lv-out"); if (out) out.textContent = "Deleted " + nameOf(el);
  }
  let box = null, target = null;
  function close() { if (box) box.remove(); box = null; if (target) target.classList.remove("se-deleting"); target = null; }
  function ask(el, x, y) {
    close();
    target = el; el.classList.add("se-deleting");
    box = document.createElement("div");
    box.className = "se-confirm"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Delete " + nameOf(el) + "?");
    box.innerHTML = '<button type="button" class="se-cf se-cf-del" aria-label="Delete it"><span>delete</span></button>' +
                    '<button type="button" class="se-cf se-cf-keep" aria-label="Keep it"><span>keep</span></button>';
    document.body.appendChild(box);
    const W = window.innerWidth, H = window.innerHeight, w = box.offsetWidth || 150, h = box.offsetHeight || 70;
    box.style.left = Math.min(W - w - 8, Math.max(8, x + 12)) + "px";
    box.style.top = Math.min(H - h - 8, Math.max(8, y - h - 12)) + "px";
    box.querySelector(".se-cf-del").addEventListener("click", e => { e.stopPropagation(); const t = target; close(); if (t) remove(t); });
    box.querySelector(".se-cf-keep").addEventListener("click", e => { e.stopPropagation(); close(); });
    setTimeout(() => box && box.querySelector(".se-cf-keep").focus({ preventScroll: true }), 30);
  }
  document.addEventListener("dblclick", e => {
    if (!on() || e.button) return;
    const el = superAt(e.target); if (!el) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (window.SeLock && window.SeLock.isLocked(el)) { if (window.SeShape && window.SeShape.note) window.SeShape.note(e.clientX, e.clientY, "locked", "unlock it to delete it"); return; }
    ask(el, e.clientX, e.clientY);
  }, true);
  document.addEventListener("pointerdown", e => { if (box && !box.contains(e.target)) close(); }, true);
  document.addEventListener("keydown", e => { if (box && e.key === "Escape") { e.preventDefault(); close(); } }, true);
  window.SeDelete = { ask, close };
})();
