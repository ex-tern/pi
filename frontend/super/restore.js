// super/restore.js: saved states, and the reset control bringing them back (owner, 2026-10-13: "doing this resets the
// super to the saved, previous saved state. And previous saved state of the main loop, if connected to the condition
// or the condition of the logo").
//
// Saving a super (super/save.js) also takes a snapshot of it: everything this browser keeps about it (its place, size,
// n, lock, chain, open or compact, a Super AI super's text and answer) and the same for every super it holds. Saving
// the main loop (the save control on the main or second super) or the logo (the title super) takes a snapshot of the
// whole page. A reset brings a snapshot back: wired from the reset control to a super, that super (and what it held)
// goes back to how it was when last saved; wired to the main super's condition port or to the logo, the whole page
// does. Nothing saved yet: the page starts afresh, as on a first visit.
//
// The page reloads to apply a snapshot, so every module reads it fresh; the snapshot is handed over in sessionStorage
// and written into localStorage here, in <head>, before any module has read (or could overwrite) it.
//
//   SeRestore.snapshot(el)   SeRestore.has(el)   SeRestore.restore(el)
//   SeRestore.snapshotPage() SeRestore.hasPage() SeRestore.restorePage()
(function () {
  "use strict";
  const STATE = /^(lv:|orbit:|se:|superai:|labview)/;                  // what the page keeps (super/wire.js resetApp)
  const PAGE = "pisave:page", SUPER = "pisave:super:", PENDING = "pisave:pending";
  const keys = () => { try { return Object.keys(localStorage); } catch (_) { return []; } };
  const get = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* private mode or full */ } };

  // ---- on load, before anything reads the page's state: apply a snapshot handed over by a reset ----
  (function apply() {
    let p = null;
    try { p = JSON.parse(sessionStorage.getItem(PENDING) || "null"); sessionStorage.removeItem(PENDING); } catch (_) { p = null; }
    if (!p || typeof p !== "object") return;
    if (p.mode === "page" && p.data) {
      keys().filter(k => STATE.test(k)).forEach(k => put(k, null));
      Object.keys(p.data).forEach(k => { if (STATE.test(k)) put(k, p.data[k]); });
    } else if (p.mode === "super" && p.keys) {
      Object.keys(p.keys).forEach(k => { if (STATE.test(k)) put(k, p.keys[k]); });
      if (p.nodes && p.nodes.length) {
        let list = []; try { list = JSON.parse(get("lv:nodes") || "[]") || []; } catch (_) { list = []; }
        p.nodes.forEach(n => { const i = list.findIndex(x => x && x.id === n.id); if (i >= 0) list[i] = n; else list.push(n); });
        put("lv:nodes", JSON.stringify(list));
      }
    }
    window.SeRestoreNote = p.note || "";
  })();

  // ---- a super's own keys: the ones that end with its name or its raw key ----
  const nameOf = el => (window.SeLock && window.SeLock.nameOf && window.SeLock.nameOf(el)) || null;
  const rawOf = el => (el && el.dataset && (el.dataset.key || el.dataset.id)) || "";
  function family(el) {                                                  // it and every super it holds, all the way down
    const out = [el], seen = new Set([el]);
    for (let i = 0; i < out.length && i < 200; i++) {
      const H = window.SeHold; if (!H || !H.heldBy) break;
      (H.heldBy(out[i]) || []).forEach(x => { if (!seen.has(x)) { seen.add(x); out.push(x); } });
    }
    return out;
  }
  function ownKeys(el) {
    const n = nameOf(el), r = rawOf(el), ends = [n, r].filter(Boolean).map(s => ":" + s);
    if (!ends.length) return [];
    return keys().filter(k => STATE.test(k) && !/^se:save:/.test(k) && ends.some(e => k.endsWith(e)));
  }
  const nodeIds = els => els.filter(e => e.classList && e.classList.contains("lv-node") && e.dataset.id).map(e => e.dataset.id);

  function snapshot(el) {
    const n = nameOf(el); if (!n) return false;
    const els = family(el), data = {}, names = els.map(nameOf).filter(Boolean);
    els.forEach(e => ownKeys(e).forEach(k => { data[k] = get(k); }));
    let list = []; try { list = JSON.parse(get("lv:nodes") || "[]") || []; } catch (_) { list = []; }
    const ids = nodeIds(els), nodes = list.filter(x => x && ids.includes(x.id));
    put(SUPER + n, JSON.stringify({ at: Date.now(), names, raws: els.map(rawOf).filter(Boolean), data, nodes }));
    return true;
  }
  const has = el => { const n = nameOf(el); return !!(n && get(SUPER + n)); };
  const label = (el, n) => ((el.querySelector && el.querySelector(":scope > .ob-label")) || {}).textContent || (n === "title" ? "the logo" : n.replace(/^(node|bubble|win):/, ""));
  function restore(el) {
    const n = nameOf(el), s = n && get(SUPER + n); if (!s) return false;
    let snap; try { snap = JSON.parse(s); } catch (_) { return false; }
    const out = {};
    // what it (and what it held when saved) keeps now and did not then is forgotten; what it kept then comes back
    const ends = [].concat(snap.names || [], snap.raws || []).map(x => ":" + x);
    keys().filter(k => STATE.test(k) && !/^se:save:/.test(k) && ends.some(e => k.endsWith(e))).forEach(k => { out[k] = null; });
    Object.keys(snap.data || {}).forEach(k => { out[k] = snap.data[k]; });
    reloadWith({ mode: "super", keys: out, nodes: snap.nodes || [], note: "Reset " + label(el, n) + " to its saved state" });
    return true;
  }

  function snapshotPage() {
    const data = {}; keys().filter(k => STATE.test(k)).forEach(k => { data[k] = get(k); });
    put(PAGE, JSON.stringify({ at: Date.now(), data }));
    return true;
  }
  const hasPage = () => !!get(PAGE);
  function restorePage() {
    let snap = null; try { snap = JSON.parse(get(PAGE) || "null"); } catch (_) { snap = null; }
    if (!snap || !snap.data) return false;
    reloadWith({ mode: "page", data: snap.data, note: "Reset the page to its saved state" });
    return true;
  }
  function reloadWith(p) {
    try { sessionStorage.setItem(PENDING, JSON.stringify(p)); } catch (_) { return; }
    const o = document.querySelector(".lv-out"); if (o) o.textContent = p.note;
    setTimeout(() => location.reload(), 120);
  }

  // a super saved before snapshots existed (every super of the start begins saved) is snapshotted as it is first seen
  function catchUp() {
    if (!document.documentElement.classList.contains("shape-se")) return;
    document.querySelectorAll(".is-saved").forEach(el => { if (nameOf(el) && !has(el)) snapshot(el); });
  }
  setTimeout(catchUp, 5000);
  // after a reset, say what came back
  document.addEventListener("DOMContentLoaded", () => setTimeout(() => {
    const o = document.querySelector(".lv-out"); if (o && window.SeRestoreNote) o.textContent = window.SeRestoreNote;
  }, 1500));

  window.SeRestore = { snapshot, has, restore, snapshotPage, hasPage, restorePage };
})();
