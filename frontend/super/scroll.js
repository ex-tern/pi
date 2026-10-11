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
  //   ... on a node                      sizes that node
  //   ... in a window                    its content scrolls; a pinch sizes the window
  //   Alt + scroll on a thing            sizes that thing (a bubble, the title, the palette, Live)
  //   Shift + scroll                     changes the shape (n) of the super under the pointer
  // (A band round every super's edge used to turn a scroll into a change of n: it was easy to hit by
  // accident, so the shape now changes only with Shift.) The zoom is coalesced to one step per frame and
  // applied at once for a trackpad or a pinch, glided for a mouse wheel's coarse steps; it settles on 100 %
  // when it ends near it, and the Reset view button (or the 0 key) brings the first view back.
  // zoneAt is what super/hover.js shows: an arrow, a scroll zooms.
  function zoneAt(x, y, hit) {
    if (hit && hit.closest && hit.closest("input, textarea, select, [contenteditable], .se-port, .wire-hit")) return null;
    const over = hit && hit.closest ? hit.closest(THING) : null;
    if (over && (over.classList.contains("lv-node") || over.classList.contains("orbit-panel"))) return { kind: "arrow", target: over };
    const S = window.SeSite || {};
    return { kind: "arrow", target: S.inSite && S.inSite(x, y) ? "site" : "loop" };
  }

  const scrolls = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (/auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) return e; } return null; };

  // what the gesture acts on: "site" (the view), or an element (a node, a window, or with Alt a thing);
  // null: leave it to the browser (content that scrolls)
  function pick(hit, pinch, alt) {
    const t = hit && hit.closest ? hit : null;
    if (t && t.closest("input, textarea, select, [contenteditable]")) return pinch ? "site" : null;
    const node = t && t.closest(".lv-node");
    if (node) return node;
    const panel = t && t.closest(".orbit-panel");
    if (panel) return pinch ? panel : (scrolls(t) ? null : "nothing");
    if (alt && t) { const th = t.closest(".orbit-bubble, .orbit-title, .lv-palette, .live-dock"); if (th && nameOf(th)) return th; }
    return "site";
  }
  // one gesture stays on what it started on, so a thing that grows under the pointer keeps being sized
  let gesture = null;
  const pending = new Map();
  let frameAsked = false, settleT = 0;
  function queue(target, dy, direct) {
    const p = pending.get(target) || { dy: 0, direct: true };
    p.dy += dy; p.direct = p.direct && direct;
    pending.set(target, p);
    if (!frameAsked) { frameAsked = true; requestAnimationFrame(flush); }
  }
  function flush() {
    frameAsked = false;
    pending.forEach(({ dy, direct }, what) => {
      if (what === "nothing") return;
      if (what === "site") { if (O().zoomPage) O().zoomPage(Math.exp(-dy * 0.0015), direct); }
      else if (!what.isConnected) return;
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
    const target = fresh ? gesture.what : pick(hit, pinch, e.altKey);
    if (target === null) { gesture = null; return; }                         // content that scrolls keeps scrolling
    gesture = { what: target, t: now, pinch };
    e.preventDefault(); e.stopImmediatePropagation();
    const dy = e.deltaY * unit * (pinch ? 4 : 1);                           // a pinch reports small deltas
    // a trackpad's or a pinch's stream is already smooth: apply it at once; a wheel's steps glide
    const direct = pinch || (e.deltaMode === 0 && Math.abs(e.deltaY) < 50);
    queue(target, dy, direct);
  }, { capture: true, passive: false });
  // Safari's pinch comes as gesture events (no wheel): the same zoom, never the browser's
  let gs = null;
  document.addEventListener("gesturestart", e => {
    if (!on()) return; e.preventDefault();
    const hit = document.elementFromPoint(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2);
    gs = { last: 1, target: pick(hit, true, false) || "site" };
  }, { passive: false });
  document.addEventListener("gesturechange", e => {
    if (!on()) return; e.preventDefault();
    if (!gs || !(e.scale > 0)) return;
    const k = e.scale / gs.last; gs.last = e.scale;
    queue(gs.target, -Math.log(k) / 0.0015, true);
  }, { passive: false });
  document.addEventListener("gestureend", e => { if (on()) e.preventDefault(); gs = null; }, { passive: false });

  // ---- the way back: Reset view (and the 0 key) -----------------------------------------------------
  let resetBtn = null;
  function resetButton() {
    if (resetBtn || !document.body) return;
    resetBtn = document.createElement("button");
    resetBtn.type = "button"; resetBtn.className = "se-reset"; resetBtn.hidden = true; resetBtn.textContent = "Reset view";
    resetBtn.setAttribute("aria-label", "Reset view: back to 100 % zoom and the first shape");
    resetBtn.addEventListener("pointerdown", e => e.stopPropagation(), true);
    resetBtn.addEventListener("click", e => { e.stopPropagation(); if (O().resetView) O().resetView(); });
    document.body.appendChild(resetBtn);
  }
  setInterval(() => { if (!on()) return; resetButton(); if (resetBtn) resetBtn.hidden = !(O().viewChanged && O().viewChanged()); }, 400);
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
