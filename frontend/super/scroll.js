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
  // the title is sized by its own height (--se-title-k, super/super.css), not the CSS scale: the page's fit
  // (super/loop.js setFit) scales the title about the page's centre with that property, and the two writers
  // fought, so the title flew off the page and snapped back while it was sized
  const isTitle = el => el.classList.contains("orbit-title");
  const VAR = el => isBubble(el) ? "--se-scale" : isTitle(el) ? "--se-title-k" : null;
  const getScale = el => VAR(el) ? (parseFloat(el.style.getPropertyValue(VAR(el))) || 1) : (parseFloat(el.style.scale) || 1);
  const putScale = (el, v) => { if (VAR(el)) el.style.setProperty(VAR(el), v.toFixed(3)); else el.style.scale = v.toFixed(3); };
  function sizeThing(el, dy) {
    const name = nameOf(el); if (!name) return;
    const cur = el._seScaleTo || getScale(el) || load(name) || 1;
    let max = 3;
    if (isBubble(el) && O().siteBox) {                                          // a bubble stays well inside the inner super
      const sb = O().siteBox(), w0 = el.offsetWidth || 1, h0 = el.offsetHeight || 1;
      max = Math.max(0.3, Math.min(3, 1.2 * sb.a / w0, 1.2 * sb.b / h0));
    }
    const v = Math.max(0.3, Math.min(max, cur * Math.exp(-dy * 0.0015)));
    if (!VAR(el)) { const o = el.style.transformOrigin; if (!o || o === "50% 50% 0px") el.style.transformOrigin = "50% 50%"; }
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
      if (v && v !== 1) { if (!VAR(el)) el.style.transformOrigin = "50% 50%"; putScale(el, v); }
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

  // ---- what a scroll or a pinch does: one rule ------------------------------------------------------
  //   scroll or pinch anywhere           zooms the site (the view), and nothing else changes shape
  //   ... on a super (Super AI too)      sizes the super (and grows a ■ into a holder); Alt + scroll zooms
  //                                      into what it shows (an answer, anything long) about the pointer
  //   ... on a bubble                    opens it (a scroll in) or compacts it (a scroll out): super/bubble.js
  //   ... in a window                    zooms its content about the pointer (no scroll bars anywhere:
  //                                      super/zoombox.js); Alt + scroll sizes the window
  //   Alt + scroll on a thing            sizes that thing (a super, a window, a bubble, the title, Live)
  //   Shift + scroll                     changes the n of the super under the pointer, and nothing else does
  //                                      (the ring is no longer a control: RING_N)
  //   (was:) ... on a super's ring       changes that super's n (the pointer is a hand there): the inner
  //                                      super's ring, the main loop's, a window's, a node's, a bubble's
  //   Shift + scroll                     changes the shape (n) of the super under the pointer, anywhere
  // A gesture keeps doing what it started doing (400 ms), so a zoom never turns into an n by drifting. The zoom is coalesced to one step per frame and
  // applied at once for a trackpad or a pinch, glided for a mouse wheel's coarse steps; it settles on 100 %
  // when it ends near it, and the Reset view button (or the 0 key) brings the first view back.
  // zoneAt is what super/hover.js shows: a hand on a ring (n), an arrow elsewhere (zoom).
  // the ring: a band either side of a super's edge, where the pointer is a hand and a scroll changes that
  // super's n (the owner's n control); everywhere else an arrow, and a scroll zooms
  const RING_IN = 16, RING_OUT = 12;                        // the ring's band, inside and outside the edge
  const ringBand = (w, h) => { const k = Math.min(1, Math.min(w, h) / 64); return { in: Math.max(3, RING_IN * k), out: Math.max(3, RING_OUT * k) }; };
  const RING_N = false;                                                     // a scroll on a ring used to change its n; now only Shift + scroll does
  function zoneAt(x, y, hit) {
    if (hit && hit.closest && hit.closest("input, textarea, select, [contenteditable], .se-port, .wire-hit, .se-project")) return null;
    if (!RING_N) return { kind: "arrow" };                                    // no ring control: an arrow everywhere, a scroll zooms
    const over = hit && hit.closest ? hit.closest(THING) : null;
    let best = null;                                          // the nearest ring the point is on
    const S = window.SeSite || {}, sel = (S.SHAPES ? S.SHAPES + ", " : "") + ".lv-node";
    document.querySelectorAll(sel).forEach(el => {
      if (el.hidden || !el.getClientRects().length || el.classList.contains("se-port")) return;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      const ins = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      const d = ins ? -Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y)
        : Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      const b = ringBand(r.width, r.height);
      if (d < -b.in || d > b.out) return;
      if (over && over !== el && !over.classList.contains("is-holder") && !over.contains(el) && !el.contains(over)) return;    // the point is on something else (a holder is under what it holds)
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { target: el, d };
    });
    const site = S.site && S.site();
    if (site) {
      const d = (seNorm(Math.abs(x - site.cx) / site.a, Math.abs(y - site.cy) / site.b, site.n) - 1) * Math.min(site.a, site.b);
      if (d >= -RING_IN && d <= RING_OUT && (!best || Math.abs(d) < Math.abs(best.d)) && !over) best = { target: "site", d };
    }
    const g = O().loop ? O().loop() : null;
    if (g && g.a) {
      const off = (O().fit && O().fit().py != null) ? O().fit().py - g.cy : 0;
      const d = (seNorm(Math.abs(x - g.cx) / g.a, Math.abs(y - (g.cy + off)) / g.b, g.n) - 1) * Math.min(g.a, g.b);
      if (d >= -(RING_IN + 2) && d <= RING_OUT + 6 && (!best || Math.abs(d) < Math.abs(best.d))) best = { target: "loop", d };
    }
    if (best) return { kind: "hand", target: best.target };                        // on a ring: its n
    const loopRing = window.LabView && window.LabView.loopAt ? window.LabView.loopAt(x, y) : null;
    if (loopRing) return { kind: "hand", target: loopRing };
    if (over && (over.classList.contains("lv-node") || over.classList.contains("orbit-panel"))) return { kind: "arrow", target: over };
    return { kind: "arrow", target: S.inSite && S.inSite(x, y) ? "site" : "loop" };
  }
  // a ring's n, by a scroll (the hand)
  function shapeOf(what, e, dy) {
    if (what === "site") { if (O().scrollSiteN) O().scrollSiteN(e); }
    else if (what === "loop") { if (O().scrollN) O().scrollN(e); }
    else if (!what.isConnected) return;
    else if (what.classList.contains("lv-node")) { if (window.LabView && window.LabView.shapeNode) window.LabView.shapeNode(what, dy); }
    else if (window.SeSite && window.SeSite.shapeEl) window.SeSite.shapeEl(what, dy);
  }

  const scrolls = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (/auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) return e; } return null; };

  // what the gesture acts on: "site" (the view), or an element (a node, a window, or with Alt a thing);
  // null: leave it to the browser (content that scrolls)
  function pick(hit, pinch, alt) {
    const t = hit && hit.closest ? hit : null;
    if (t && t.closest("input, textarea, select, [contenteditable]") && !t.closest("[data-zoombox]")) return pinch ? "site" : null;
    const node = t && t.closest(".lv-node");
    if (node) {
      // a scroll on a super sizes it (owner, 2026-10-12); Alt + scroll zooms what it shows (an answer, anything long)
      const g = node.querySelector(":scope > .lv-glyph");
      if (alt && g && g._zoom && !node.classList.contains("is-holder") && (g.textContent || "").trim().length > 24) return g;
      return node;
    }
    const panel = t && t.closest(".orbit-panel");
    if (panel && alt) return panel;                                  // Alt: the window's size
    const zb = t && t.closest("[data-zoombox]");
    if (zb && zb._zoom) return zb;                                   // a window's content: zoomed, never scrolled
    if (panel) return pinch ? panel : "nothing";
    if (alt && t) { const th = t.closest(".orbit-bubble, .orbit-title, .lv-palette, .live-dock"); if (th && nameOf(th)) return th; }
    // a bubble is an expandable super (super/bubble.js): a scroll on it opens or compacts it
    const bubble = t && t.closest(".orbit-bubble.is-group");
    if (bubble && window.SeBubble && !pinch) return bubble;
    return "site";
  }
  // one gesture stays on what it started on, so a thing that grows under the pointer keeps being sized
  let gesture = null;
  const pending = new Map();
  let frameAsked = false, settleT = 0;
  function queue(target, dy, direct, x, y, alt) {
    const p = pending.get(target) || { dy: 0, direct: true };
    p.dy += dy; p.direct = p.direct && direct; p.x = x; p.y = y; p.alt = !!alt;
    pending.set(target, p);
    if (!frameAsked) { frameAsked = true; requestAnimationFrame(flush); }
  }
  function flush() {
    frameAsked = false;
    pending.forEach(({ dy, direct, x, y, alt }, what) => {
      if (what === "nothing") return;
      if (what === "site") { if (O().zoomPage) O().zoomPage(Math.exp(-dy * 0.0015), direct); }
      else if (!what.isConnected) return;
      else if (what.classList.contains("orbit-bubble") && !alt && window.SeBubble) window.SeBubble.zoom(what, dy);
      else if (what._zoom) what._zoom.zoomAt(x, y, dy);
      else if (what.classList.contains("lv-node")) { if (window.LabView) window.LabView.zoomNode(what, dy); }
      else if (what.classList.contains("orbit-panel")) { if (window.SeSite) window.SeSite.sizeWindow(what, dy); }
      else sizeThing(what, dy);
    });
    const touchedSite = pending.has("site");
    pending.clear();
    if (touchedSite) {
      clearTimeout(settleT);
      settleT = setTimeout(() => {                                   // the gesture is over: near 100 %, settle on it
        const z = O().zoom ? O().zoom() : 1;
        if (Math.abs(z - 1) < 0.06 && Math.abs(z - 1) > 0.0005 && O().zoomPage) O().zoomPage(1 / z, false);
      }, 260);
    }
  }
  document.addEventListener("wheel", e => {
    if (!on()) return;
    const x = e.clientX, y = e.clientY, hit = document.elementFromPoint(x, y), now = e.timeStamp || performance.now();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    // Shift + scroll: the shape (n) of the super under the pointer, and of nothing else: a node, a window,
    // a card, the Live panel or its tab, the palette, a bubble, the title; on bare space inside the inner
    // super, the inner super; anywhere else, the main super (browsers turn a shifted wheel into a sideways
    // delta, so it is read from either axis)
    if (e.shiftKey && !e.ctrlKey) {
      const dy = (e.deltaY || e.deltaX) * unit;
      e.preventDefault(); e.stopImmediatePropagation();
      const fresh = gesture && now - gesture.t < 500 ? gesture.what : null;
      const recentEl = fresh && fresh.classList && fresh.isConnected ? fresh : null;
      let node = recentEl && recentEl.classList.contains("lv-node") ? recentEl : recentEl ? null : (hit && hit.closest ? hit.closest(".lv-node") : null);
      if (!node && !recentEl && fresh && fresh.dataset && fresh.dataset.id)
        node = document.querySelector('.lv-node[data-id="' + fresh.dataset.id + '"]');   // the node was remade (it changed function): the same id
      if (node && window.LabView && window.LabView.shapeNode) { gesture = { what: node, t: now }; window.LabView.shapeNode(node, dy); return; }
      const S = window.SeSite || {};
      const sup = recentEl && !recentEl.classList.contains("lv-node") ? recentEl : (!fresh && hit && hit.closest && S.SHAPES ? hit.closest(S.SHAPES) : null);
      if (sup && S.shapeEl) { gesture = { what: sup, t: now }; S.shapeEl(sup, dy); return; }
      const what = fresh === "site" || fresh === "shape" ? fresh : (S.inSite && S.inSite(x, y) ? "site" : "shape");
      gesture = { what, t: now };
      if (what === "site") { if (O().scrollSiteN) O().scrollSiteN(e); }
      else if (O().scrollN) O().scrollN(e);
      return;
    }
    const pinch = e.ctrlKey;
    if (!pinch && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;          // sideways: super/nodes.js guards the swipe
    const fresh = gesture && now - gesture.t < 400 && gesture.pinch === pinch && gesture.what && (typeof gesture.what === "string" || gesture.what.isConnected);
    // on a ring (the hand) a scroll changes that super's n; a gesture keeps doing what it started doing,
    // so a zoom that drifts over a ring keeps zooming and an n that drifts inside keeps changing n
    // only Shift + scroll changes an n (owner, 2026-10-12): the ring is not a control any more
    if (RING_N && !pinch && !e.altKey && (fresh ? gesture.ring : true)) {
      const z = fresh ? { kind: "hand", target: gesture.what } : zoneAt(x, y, hit);
      if (z && z.kind === "hand") {
        e.preventDefault(); e.stopImmediatePropagation();
        gesture = { what: z.target, t: now, pinch, ring: true };
        shapeOf(z.target, e, (e.deltaY || e.deltaX) * unit);
        return;
      }
    }
    const target = fresh && !gesture.ring ? gesture.what : pick(hit, pinch, e.altKey);
    if (target === null) { gesture = null; return; }                         // content that scrolls keeps scrolling
    gesture = { what: target, t: now, pinch };
    e.preventDefault(); e.stopImmediatePropagation();
    const dy = e.deltaY * unit * (pinch ? 4 : 1);                           // a pinch reports small deltas
    // a trackpad's or a pinch's stream is already smooth: apply it at once; a wheel's steps glide
    const direct = pinch || (e.deltaMode === 0 && Math.abs(e.deltaY) < 50);
    queue(target, dy, direct, x, y, e.altKey);
  }, { capture: true, passive: false });
  // Safari's pinch comes as gesture events (no wheel): the same zoom, never the browser's
  let gs = null;
  document.addEventListener("gesturestart", e => {
    if (!on()) return; e.preventDefault();
    const hit = document.elementFromPoint(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2);
    gs = { last: 1, target: pick(hit, true, false) || "site", x: e.clientX || innerWidth / 2, y: e.clientY || innerHeight / 2 };
  }, { passive: false });
  document.addEventListener("gesturechange", e => {
    if (!on()) return; e.preventDefault();
    if (!gs || !(e.scale > 0)) return;
    const k = e.scale / gs.last; gs.last = e.scale;
    queue(gs.target, -Math.log(k) / 0.0015, true, gs.x, gs.y);
  }, { passive: false });
  document.addEventListener("gestureend", e => { if (on()) e.preventDefault(); gs = null; }, { passive: false });

  // ---- the way back: the title super is the Reset view button (and the 0 key) ------------------------
  // When the view has changed (PiOrbit.viewChanged), a click on the title super (not a drag) brings back the
  // first view (PiOrbit.resetView). Nothing is written on it (owner, 2026-10-11).
  let titleHooked = null, down = null;
  function hookTitle() {
    const t = document.querySelector(".orbit-title");
    const sup = t && t.querySelector(".se-titlesuper");
    if (!sup || titleHooked === sup) return sup;
    titleHooked = sup;
    // on the window, before anything else (selecting, wiring) can take the press
    window.addEventListener("pointerdown", e => { down = sup.contains(e.target) ? [e.clientX, e.clientY] : null; }, true);
    window.addEventListener("pointerup", e => {
      if (!down || !sup.contains(e.target) || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }   // a drag moved it: not a click
      down = null;
      if (!(O().viewChanged && O().viewChanged())) return;
      if (O().resetView) O().resetView();
    }, true);
    return sup;
  }
  setInterval(() => {
    if (!on()) return;
    const sup = hookTitle(), changed = !!(O().viewChanged && O().viewChanged());
    if (sup) sup.classList.toggle("is-changed", changed);
    const t = document.querySelector(".orbit-title");
    if (t) t.setAttribute("aria-label", changed ? "Pi Tech Lab. Press to reset the view" : "Pi Tech Lab");
  }, 400);
  document.addEventListener("keydown", e => {
    if (!on() || e.key !== "0" || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (a.matches("input, textarea, select, [contenteditable]") || a.closest(".lv-node"))) return;
    if (O().resetView) { e.preventDefault(); O().resetView(); }
  });
  setInterval(restore, 1000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restore); else restore();
  // super/hover.js shows the zone by the pointer's shape: the band where a scroll changes n, or a surface a scroll sizes
  window.SeZoom = { edgeSuper, zoneAt, sizeThing, THING, BAND };
})();
