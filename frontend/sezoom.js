// sezoom.js — what a scroll (or a pinch) does in the superellipse look depends on where it lands:
//
//   outside the main super   (the corners the superellipse leaves bare)   it changes the super's shape: n
//   shift + scroll            the shape of the super under the pointer alone: a node, a window, a card,
//                             the Live panel, the palette, a bubble, the title's badge, the inner super
//                             (bare space inside it) or the main super (anywhere else); each keeps its own n
//   inside it, on nothing    (bare space between the things)              it zooms: everything inside scales
//   on a thing               (a node, a bubble, a window, the title,      it sizes that thing
//                             the palette, the Live panel, a loop's ring)
//
// A window or a list whose content scrolls keeps scrolling while it can; the sizes of bubbles, the title,
// the palette and Live are kept per browser (se:size:<name>). Sideways swipes never navigate.
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {};
  const load = k => { try { return +localStorage.getItem("se:size:" + k) || 0; } catch (_) { return 0; } };
  const save = (k, v) => { try { localStorage.setItem("se:size:" + k, String(v)); } catch (_) { /* private mode */ } };
  const THING = ".lv-node, .orbit-panel, .orbit-bubble, .orbit-title, .lv-palette, .live-dock, .se-port";

  // a thing with a size of its own: scaled about its centre, remembered by name
  const nameOf = el => el.classList.contains("orbit-title") ? "title" : el.classList.contains("lv-palette") ? "palette"
    : el.classList.contains("live-dock") ? "live" : el.dataset.key ? "bubble:" + el.dataset.key : null;
  function sizeThing(el, dy) {
    const name = nameOf(el); if (!name) return;
    const cur = el._seScaleTo || parseFloat(el.style.scale) || load(name) || 1;
    const v = Math.max(0.3, Math.min(3, cur * Math.exp(-dy * 0.0015)));
    const o = el.style.transformOrigin;
    if (!o || o === "50% 50% 0px") el.style.transformOrigin = "50% 50%";
    el._seScaleTo = v; save(name, +v.toFixed(3));
    if (window.SeMotion) { const s = { v: parseFloat(el.style.scale) || 1 }; window.SeMotion.glide("size:" + name, s, "v", v, 160, () => { el.style.scale = s.v.toFixed(3); }); }
    else el.style.scale = v.toFixed(3);
  }
  function restore() {
    document.querySelectorAll(".orbit-title, .lv-palette, .live-dock, .orbit-bubble[data-key]").forEach(el => {
      if (el.dataset.seSized) return;
      const name = nameOf(el), v = name && load(name);
      el.dataset.seSized = "1";
      if (v && v !== 1) { el.style.transformOrigin = "50% 50%"; el.style.scale = String(v); }
    });
  }
  const scrolls = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (/auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) return e; } return null; };

  // one scroll gesture stays on what it started on: a thing that shrinks under the pointer, or grows past
  // it, keeps sizing instead of handing the rest of the gesture to the page (that was the glitch)
  let gesture = null;   // { el (or "page" / "shape"), t }
  const same = (what, t) => gesture && gesture.what === what && t - gesture.t < 500;
  document.addEventListener("wheel", e => {
    if (!on()) return;
    const dy = (e.deltaY || e.deltaX) * (e.ctrlKey ? 4 : 1);          // a pinch sends small deltas
    const x = e.clientX, y = e.clientY, hit = document.elementFromPoint(x, y), now = e.timeStamp || performance.now();
    // shift + scroll: the shape (n) of the super under the pointer, and of nothing else: a node, a window,
    // a card, the Live panel or its tab, the palette, a bubble, the title; on bare space inside the inner
    // super, the inner super; anywhere else, the main super (browsers turn a shifted wheel into a sideways
    // delta, so dy above already carries it)
    if (e.shiftKey && !e.ctrlKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      const fresh = gesture && now - gesture.t < 500 ? gesture.what : null;
      const recentEl = fresh && fresh.classList && fresh.isConnected ? fresh : null;
      let node = recentEl && recentEl.classList.contains("lv-node") ? recentEl : recentEl ? null : (hit && hit.closest ? hit.closest(".lv-node") : null);
      if (!node && !recentEl && fresh && fresh.dataset && fresh.dataset.id)
        node = document.querySelector('.lv-node[data-id="' + fresh.dataset.id + '"]');   // the node was remade (it changed function): the same id
      if (node && window.LabView && window.LabView.shapeNode) { gesture = { what: node, t: now }; window.LabView.shapeNode(node, dy); return; }   // a node: its own shape
      const S = window.SeSite || {};
      const sup = recentEl && !recentEl.classList.contains("lv-node") ? recentEl : (!fresh && hit && hit.closest && S.SHAPES ? hit.closest(S.SHAPES) : null);
      if (sup && S.shapeEl) { gesture = { what: sup, t: now }; S.shapeEl(sup, dy); return; }   // a super: its own shape
      const what = fresh === "site" || fresh === "shape" ? fresh : (S.inSite && S.inSite(x, y) ? "site" : "shape");
      gesture = { what, t: now };
      if (what === "site") { if (O().scrollSiteN) O().scrollSiteN(e); }           // the inner super
      else if (O().scrollN) O().scrollN(e);                                        // the main super
      return;
    }
    const recent = gesture && now - gesture.t < 500 ? gesture.what : null;
    gesture = { what: recent, t: now };
    // a thing under the pointer (or the one this gesture began on)
    let el = recent && recent !== "page" && recent !== "shape" && recent.isConnected ? recent : (hit && hit.closest ? hit.closest(THING) : null);
    const loop = !el && !recent && window.LabView && window.LabView.loopAt ? window.LabView.loopAt(x, y) : null;
    if (loop) el = loop;
    if (recent === "page" || recent === "shape" || recent === "site") el = null;
    if (el) {
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // sideways: labview.js guards the swipe
      const sc = !e.ctrlKey && scrolls(hit);                              // its content scrolls first
      if (sc && !(el.classList.contains("lv-node"))) return;
      e.preventDefault(); e.stopImmediatePropagation();
      gesture.what = el;
      if (el.classList.contains("lv-node")) window.LabView.zoomNode(el, dy);
      else if (el.classList.contains("orbit-panel")) { if (window.SeSite) window.SeSite.sizeWindow(el, dy); }
      else if (el.classList.contains("se-port")) { /* ports keep their size */ }
      else sizeThing(el, dy);
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    const outside = recent ? recent === "shape" : (O().inLoop && !O().inLoop(x, y));
    gesture.what = outside ? "shape" : "page";
    if (outside) { if (O().scrollN) O().scrollN(e); return; }                            // outside the super: its shape
    if (O().zoomPage) O().zoomPage(Math.exp(-dy * 0.0015));                            // inside, on nothing: zoom
  }, { capture: true, passive: false });
  // Safari's pinch comes as gesture events: never the browser's zoom
  ["gesturestart", "gesturechange"].forEach(t => document.addEventListener(t, e => { if (on()) e.preventDefault(); }, { passive: false }));
  setInterval(restore, 1000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restore); else restore();
})();
