// super/save.js: a save icon beside every super's lock and chain (owner, 2026-10-12: "remove these instead add a save
// icon next to the lock"; saved = can't be deleted).
//
// Saved (.is-saved, kept per browser as se:save:<name>), a super is never deleted: a double click on it, a scroll on
// out at its smallest or a drop outside the inner super leaves it, and a note says it is saved (super/delete.js).
// Unsaved and unlocked, a double click deletes it at once. A click toggles it, a scroll in saves, a scroll out unsaves.
//
//   SeSave.isSaved(el)    SeSave.set(el, on)
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const SUPERS = ".lv-node[data-id], .orbit-bubble.is-group[data-key], .orbit-panel, .se-project, .orbit-title .se-titlesuper";
  const nameOf = el => (window.SeLock && window.SeLock.nameOf(el)) || null;
  // every super of the start begins saved (owner, 2026-10-12: "all supers in initial state should have active lock and
  // save on"): the title, the bubbles, the third super and the project; unsaved, "0" is kept
  const atStart = n => n === "title" || n === "project" || n === "node:hold" || /^bubble:/.test(n);
  const load = n => { try { const v = localStorage.getItem("se:save:" + n); return v == null ? atStart(n) : v === "1"; } catch (_) { return atStart(n); } };
  const store = (n, v) => { try { if (v) localStorage.setItem("se:save:" + n, "1"); else if (atStart(n)) localStorage.setItem("se:save:" + n, "0"); else localStorage.removeItem("se:save:" + n); } catch (_) { /* private mode */ } };
  const isSaved = el => !!(el && el.classList && el.classList.contains("is-saved"));
  const label = v => v ? "Saved: it cannot be deleted. Click to unsave" : "Not saved: a double click deletes it. Click to save";

  function set(el, v) {
    const name = nameOf(el); if (!name) return;
    el.classList.toggle("is-saved", !!v); store(name, !!v);
    const b = el.querySelector(":scope > .se-save");
    if (b) { b.setAttribute("aria-pressed", String(!!v)); b.setAttribute("aria-label", label(!!v)); }
    const out = document.querySelector(".lv-out"); if (out) out.textContent = (v ? "Saved " : "Unsaved ") + name.replace(/^(node|bubble|win):/, "");
  }
  // a floppy disk drawn with the padlock's pen; it carries .se-lock too, so every gesture leaves it alone as it does the
  // lock (no wiring, selecting, deleting or sizing from it)
  function badge(el) {
    if (el.querySelector(":scope > .se-save")) return;
    const name = nameOf(el); if (!name || el.classList.contains("se-lockhost")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "se-lock se-save";
    b.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path class="sv-body" d="M2,1.5 H8.6 L10.5,3.4 V10.5 H2 Z"/><path class="sv-label" d="M3.6,1.5 V4 H7.6 V1.5"/><rect class="sv-slot" x="3.6" y="6.6" width="5.3" height="3.9" rx="0.6"/></svg>';
    b.addEventListener("pointerdown", e => { e.stopPropagation(); e.preventDefault(); }, true);
    b.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); set(el, !isSaved(el)); });
    b.addEventListener("dblclick", e => { e.stopPropagation(); e.preventDefault(); });
    el.appendChild(b);
    if (load(name)) el.classList.add("is-saved");
    b.setAttribute("aria-pressed", String(isSaved(el))); b.setAttribute("aria-label", label(isSaved(el)));
  }
  let acc = 0, accT = 0;
  window.addEventListener("wheel", e => {
    const b = e.target && e.target.closest && e.target.closest(".se-save");
    if (!b || e.shiftKey || !on()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const el = b.parentElement;
    acc += e.deltaY || e.deltaX; clearTimeout(accT); accT = setTimeout(() => { acc = 0; }, 400);
    if (acc < -30 && !isSaved(el)) { acc = 0; set(el, true); } else if (acc > 30 && isSaved(el)) { acc = 0; set(el, false); }
  }, { capture: true, passive: false });

  function sweep() { if (on()) document.querySelectorAll(SUPERS).forEach(badge); }
  function start() { sweep(); new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true }); }
  window.SeSave = { isSaved, set };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
