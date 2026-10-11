// super/scroll.js — what a scroll (or a pinch) does in the superellipse look depends on where it lands:
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
  // a bubble's size is a scale inside orbit.js's transform (translate, then scale about its centre), so sizing
  // keeps its centre and never fights the layout's translate; the others are scaled with the CSS scale property
  const isBubble = el => el.classList.contains("orbit-bubble");
  const getScale = el => isBubble(el) ? (parseFloat(el.style.getPropertyValue("--se-scale")) || 1) : (parseFloat(el.style.scale) || 1);
  const putScale = (el, v) => { if (isBubble(el)) el.style.setProperty("--se-scale", v.toFixed(3)); else el.style.scale = v.toFixed(3); };
  function sizeThing(el, dy) {
    const name = nameOf(el); if (!name) return;
    const cur = el._seScaleTo || getScale(el) || load(name) || 1;
    let max = 3;
    if (isBubble(el) && O().siteBox) {                                          // a bubble stays well inside the inner super
      const sb = O().siteBox(), w0 = el.offsetWidth || 1, h0 = el.offsetHeight || 1;
      max = Math.max(0.3, Math.min(3, 1.2 * sb.a / w0, 1.2 * sb.b / h0));
    }
    const v = Math.max(0.3, Math.min(max, cur * Math.exp(-dy * 0.0015)));
    if (!isBubble(el)) { const o = el.style.transformOrigin; if (!o || o === "50% 50% 0px") el.style.transformOrigin = "50% 50%"; }
    el._seScaleTo = v; save(name, +v.toFixed(3));
    // a sized bubble takes more (or less) room: the others are re-laid around it once the gesture has settled
    // (not while it glides: a relayout every few frames made the page jerk)
    if (isBubble(el) && el.dataset.key && O().prioritize) O().prioritize(el.dataset.key);
    const relay = () => { if (!isBubble(el) || !O().layout) return; clearTimeout(el._seRelay); el._seRelay = setTimeout(() => { el.classList.remove("se-sizing"); O().layout(); }, 260); };
    if (isBubble(el)) el.classList.add("se-sizing");                            // its transform transition off while it sizes: the glide is the motion
    if (window.SeMotion) { const s = { v: getScale(el) }; window.SeMotion.glide("size:" + name, s, "v", v, 160, () => { putScale(el, s.v); relay(); }); }
    else { putScale(el, v); relay(); }
  }
  function restore() {
    document.querySelectorAll(".orbit-title, .lv-palette, .live-dock, .orbit-bubble[data-key]").forEach(el => {
      if (el.dataset.seSized) return;
      const name = nameOf(el), v = name && load(name);
      el.dataset.seSized = "1";
      if (v && v !== 1) { if (!isBubble(el)) el.style.transformOrigin = "50% 50%"; putScale(el, v); }
    });
  }
  // the super whose edge a point is just outside of (within BAND px): the nearest one not covered by
  // something else; then the inner super's ring; nothing when the point is inside every super around it
  const BAND = 12;
  function edgeSuper(x, y, hit) {
    const S = window.SeSite, over = hit && hit.closest ? hit.closest(THING) : null;
    let best = null;
    const sel = (S && S.SHAPES ? S.SHAPES + ", " : "") + ".lv-node";
    document.querySelectorAll(sel).forEach(el => {
      if (el.hidden || !el.getClientRects().length) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return;          // inside it: not its edge
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (d > Math.max(3, BAND * Math.min(1, Math.min(r.width, r.height) / 56))) return;   // a small super has a small band
      if (over && over !== el && !over.contains(el) && !el.contains(over)) return;     // the point is on something else
      if (!best || d < best.d) best = { el, d };
    });
    if (best) return { shapeOf: best.el };
    const site = S && S.site && S.site();
    if (site && !over) {
      const d = seNorm(Math.abs(x - site.cx) / site.a, Math.abs(y - site.cy) / site.b, site.n);
      if (d > 1 && (d - 1) * Math.min(site.a, site.b) <= BAND) return { shapeOf: "site" };
    }
    return null;
  }
  const seNorm = (u, v, n) => Math.pow(Math.pow(u, n) + Math.pow(v, n), 1 / n);
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
    // the gesture memory holds only within one kind of zone: a hand (shape) or an arrow (size); when the
    // pointer's shape changes, the scroll changes with it, at once
    const freshEdge = !e.ctrlKey && !scrolls(hit) ? edgeSuper(x, y, hit) : null;
    const freshKind = freshEdge || (O().inLoop && !O().inLoop(x, y)) ? "size" : "shape";
    let recent = gesture && now - gesture.t < 500 && gesture.kind === freshKind ? gesture.what : null;
    gesture = { what: recent, t: now, kind: freshKind };
    // the one rule, for every super, by the pointer's shape: a hand on a super (its surface, or bare space
    // inside it) and a scroll changes its n; an arrow just outside its edge and a scroll sizes it (the
    // inner super: the site zooms; the main super, from the bare corners: the site zooms too)
    const size = what => {
      if (what === "site" || what === "loop") { if (O().zoomPage) O().zoomPage(Math.exp(-dy * 0.0015)); }
      else if (what.classList.contains("lv-node")) window.LabView.zoomNode(what, dy);
      else if (what.classList.contains("orbit-panel")) { if (window.SeSite) window.SeSite.sizeWindow(what, dy); }
      else if (what.classList.contains("se-port")) { /* ports keep their size */ }
      else sizeThing(what, dy);
    };
    const shape = what => {
      if (what === "site") { if (O().scrollSiteN) O().scrollSiteN(e); }
      else if (what === "loop") { if (O().scrollN) O().scrollN(e); }
      else if (what.classList.contains("lv-node")) { if (window.LabView && window.LabView.shapeNode) window.LabView.shapeNode(what, dy); }
      else if (what.classList.contains("se-port")) { /* ports keep their shape */ }
      else if (window.SeSite && window.SeSite.shapeEl) window.SeSite.shapeEl(what, dy);
    };
    const edge = recent ? (recent && recent.shapeOf ? recent : null) : freshEdge;
    if (edge && (edge.shapeOf === "site" || edge.shapeOf.isConnected)) {   // the arrow, just outside a super: it is sized
      e.preventDefault(); e.stopImmediatePropagation();
      gesture.what = edge;
      size(edge.shapeOf);
      return;
    }
    // a thing under the pointer (or the one this gesture began on): the hand, its shape
    let el = recent && recent !== "page" && recent !== "shape" && recent !== "site" && !recent.shapeOf && recent.isConnected ? recent : (hit && hit.closest ? hit.closest(THING) : null);
    const loop = !el && !recent && window.LabView && window.LabView.loopAt ? window.LabView.loopAt(x, y) : null;
    if (loop) el = loop;
    if (recent === "page" || recent === "shape" || recent === "site" || (recent && recent.shapeOf)) el = null;
    if (el) {
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // sideways: super/nodes.js guards the swipe
      const sc = !e.ctrlKey && scrolls(hit);                              // its content scrolls first
      if (sc && !(el.classList.contains("lv-node"))) return;
      e.preventDefault(); e.stopImmediatePropagation();
      gesture.what = el;
      shape(el);
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    const S = window.SeSite || {};
    const outside = recent ? recent === "shape" : (O().inLoop && !O().inLoop(x, y));
    const inSite = recent ? recent === "site" : !outside && !!(S.inSite && S.inSite(x, y));
    gesture.what = outside ? "shape" : inSite ? "site" : "page";
    if (outside) { size("loop"); return; }                                 // the bare corners, an arrow: the site zooms
    shape(inSite ? "site" : "loop");                                       // bare space inside, a hand: that super's n
  }, { capture: true, passive: false });
  // Safari's pinch comes as gesture events: never the browser's zoom
  ["gesturestart", "gesturechange"].forEach(t => document.addEventListener(t, e => { if (on()) e.preventDefault(); }, { passive: false }));
  setInterval(restore, 1000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restore); else restore();
  // super/hover.js shows the zone by the pointer's shape: the band where a scroll changes n, or a surface a scroll sizes
  window.SeZoom = { edgeSuper, sizeThing, THING, BAND };
})();
