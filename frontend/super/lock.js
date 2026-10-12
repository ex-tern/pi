// super/lock.js: a lock on every super (owner, 2026-10-12).
//
// Every super (a Super AI super or a holder, a bubble, a window, the project super) carries a small lock at its
// lower right. A scroll in on it locks the super (a scroll out unlocks; nothing is clickable): what is inside it is grouped with it (a super dragged out of a
// locked holder comes back in; a locked holder's supers move with it, as they always do), and the locked super
// can never be grouped into another super (dropped on a holder, it stays beside it, super/nodes.js holderOf).
// The state is kept per browser as se:lock:<name>.
//
//   SeLock.isLocked(el)      true for a locked super (an element)
//   SeLock.set(el, locked)
//   SeLock.nameOf(el)        the super's name for the lock (node:<id>, bubble:<key>, win:<key>, project)
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {};
  const SUPERS = ".lv-node[data-id], .orbit-bubble.is-group[data-key], .orbit-panel, .se-project";

  function nameOf(el) {
    if (!el || !el.classList) return null;
    if (el.classList.contains("lv-node")) return el.dataset.id ? "node:" + el.dataset.id : null;
    if (el.classList.contains("orbit-bubble")) return el.dataset.key ? "bubble:" + el.dataset.key : null;
    if (el.classList.contains("orbit-panel")) { const k = O().keyOf ? O().keyOf(el) : null; return k ? "win:" + k : null; }
    if (el.classList.contains("se-project")) return "project";
    return null;
  }
  const load = name => { try { return localStorage.getItem("se:lock:" + name) === "1"; } catch (_) { return false; } };
  const save = (name, v) => { try { if (v) localStorage.setItem("se:lock:" + name, "1"); else localStorage.removeItem("se:lock:" + name); } catch (_) { /* private mode */ } };
  const isLocked = el => !!(el && el.classList && el.classList.contains("is-locked"));

  function set(el, locked) {
    const name = nameOf(el); if (!name) return;
    el.classList.toggle("is-locked", !!locked);
    save(name, !!locked);
    const b = el.querySelector(":scope > .se-lock");
    if (b) { b.setAttribute("aria-pressed", String(!!locked)); b.setAttribute("aria-label", locked ? "Locked: what is inside stays inside, and it goes into no other super. Scroll out on it to unlock" : "Unlocked. Scroll in on it to lock"); }
    const out = document.querySelector(".lv-out"); if (out) out.textContent = (locked ? "Locked " : "Unlocked ") + name.replace(/^(node|bubble|win):/, "");
    document.dispatchEvent(new CustomEvent("se:lock", { detail: { el, locked: !!locked } }));
  }
  // the lock: a small padlock drawn in the shape language (a superellipse body, a shackle)
  function badge(el) {
    if (el.querySelector(":scope > .se-lock")) return;
    const name = nameOf(el); if (!name) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "se-lock"; b.setAttribute("aria-pressed", "false");
    b.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path class="lk-shackle" d="M3.5,5.5 V4 a2.5,2.5 0 0 1 5,0 V5.5"/><rect class="lk-body" x="2" y="5.5" width="8" height="5.5" rx="1.6"/></svg>';
    // nothing is clickable, only zoomable (owner, 2026-10-12): a scroll in on the lock locks the super, a scroll out
    // unlocks it; a press on it does nothing (the keyboard still toggles it: Enter or Space)
    // a click toggles it too (owner, 2026-10-12: "lock doesnt work": a press on the lock is what everyone tries first)
    b.addEventListener("pointerdown", e => { e.stopPropagation(); e.preventDefault(); }, true);
    b.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); set(el, !isLocked(el)); });
    b.addEventListener("dblclick", e => { e.stopPropagation(); e.preventDefault(); });

    el.appendChild(b);
    if (load(name)) { el.classList.add("is-locked"); b.setAttribute("aria-pressed", "true"); }
    b.setAttribute("aria-label", isLocked(el) ? "Locked: what is inside stays inside, and it goes into no other super. Scroll out on it to unlock" : "Unlocked. Scroll in on it to lock");
  }
  // the scroll on a lock is taken before anything else (the page's zoom, a super's size): on the window, captured
  let acc = 0, accT = 0;
  window.addEventListener("wheel", e => {
    const b = e.target && e.target.closest && e.target.closest(".se-lock");
    if (!b || e.shiftKey || !on()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const el = b.parentElement;
    acc += e.deltaY || e.deltaX; clearTimeout(accT); accT = setTimeout(() => { acc = 0; }, 400);
    if (acc < -30 && !isLocked(el)) { acc = 0; set(el, true); }
    else if (acc > 30 && isLocked(el)) { acc = 0; set(el, false); }
  }, { capture: true, passive: false });
  function sweep() { if (on()) document.querySelectorAll(SUPERS).forEach(badge); }
  function start() {
    sweep();
    new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
  }
  window.SeLock = { isLocked, set, nameOf };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
