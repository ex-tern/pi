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
  const THING = ".lv-node, .orbit-panel, .orbit-bubble, .orbit-title, .lv-palette, .se-port";

  // a thing with a size of its own: scaled about its centre, remembered by name
  const nameOf = el => el.classList.contains("orbit-title") ? "title" : el.classList.contains("lv-palette") ? "palette"
    : el.dataset.key ? "bubble:" + el.dataset.key : null;
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
    document.querySelectorAll(".orbit-title, .lv-palette, .orbit-bubble[data-key]").forEach(el => {
      if (el.dataset.seSized) return;
      const name = nameOf(el), v = name && load(name);
      el.dataset.seSized = "1";
      if (v && v !== 1) { if (!VAR(el)) el.style.transformOrigin = "50% 50%"; putScale(el, v); }
    });
  }
  // what the pointer is on, for super/hover.js: an arrow everywhere a scroll does something (only Shift +
  // scroll changes an n; the ring is not a control); null where the thing keeps its own pointer
  function zoneAt(x, y, hit) {
    if (hit && hit.closest && hit.closest("input, textarea, select, [contenteditable], .se-port, .wire-hit, .se-project")) return null;
    const over = hit && hit.closest ? hit.closest(THING) : null;
    const S = window.SeSite || {};
    if (over && (over.classList.contains("lv-node") || over.classList.contains("orbit-panel"))) return { kind: "arrow", target: over };
    return { kind: "arrow", target: S.inSite && S.inSite(x, y) ? "site" : "loop" };
  }
  const seNorm = (u, v, n) => Math.pow(Math.pow(u, n) + Math.pow(v, n), 1 / n);

  // ---- what a scroll or a pinch does: one rule ------------------------------------------------------
  //   scroll or pinch on bare space      zooms the site (the view)
  //   ... on a super (Super AI too)      sizes the super (and grows a ■ into a holder); Alt + scroll zooms
  //                                      into what it shows (an answer, anything long) about the pointer
  //   ... on a bubble                    opens it (a scroll in) or compacts it (a scroll out): super/bubble.js
  //   ... on the project super           the same (super/project.js takes it)
  //   ... in a window                    zooms its content with every step and grows the window while there
  //                                      is room; back out: the content first, then the window; Alt + scroll
  //                                      zooms the content alone (no scroll bars anywhere: super/zoombox.js)
  //   Alt + scroll on a thing            sizes that thing (a bubble, the title, the palette)
  //   Shift + scroll                     changes the n of the super under the pointer, and nothing else does
  //                                      (SeSite.shapeEl; nodes: LabView.shapeNode; bare space: the inner
  //                                      super's n, elsewhere the main super's)
  // One gesture stays on what it started on for 400 ms. The zoom is coalesced to one step per animation
  // frame; a wheel's coarse steps glide, a trackpad's or a pinch's stream is applied at once; a gesture that
  // ends within 6 % of 100 % settles on 100 %. Safari's pinch (gesture events) zooms the same way.
  // The 0 key, or a click on the title super once the view has changed, brings back the first view.
  // pick: what the gesture acts on: "site" (the view), an element (a node, a window, a bubble, a zoom box,
  // or with Alt a thing); null leaves it to the browser (content that scrolls)
  const PRESS = "button, a[href], summary, [role=button], [role=tab], label:has(> input[type=checkbox]), label:has(> input[type=radio]), input[type=checkbox], input[type=radio], input[type=submit], input[type=button]";
  // a pinch (or Ctrl + scroll) does what a scroll does, on the same things (owner, 2026-10-12: "zooming and scrolling
  // does the same thing as scrolling"); only its deltas are scaled (they are small)
  // a locked super keeps its size and its n (owner, 2026-10-12: "locking a super also locks resizing and n value
  // change"): a scroll or Shift + scroll on it says so instead (its pills still open their windows, a window's content
  // still zooms)
  const locked = el => !!(window.SeLock && el && el.classList && (window.SeLock.isLocked(el) || (el.classList.contains("orbit-title") && window.SeLock.isLocked(el.querySelector(".se-titlesuper")))));
  const sizes = w => w && w.classList ? (w.classList.contains("lv-node") || w.classList.contains("orbit-bubble") ? w : null) : null;
  let noteAt = 0;
  function lockedNote(el, x, y) {
    const now = performance.now(); if (now - noteAt < 250) return; noteAt = now;
    if (window.SeShape && window.SeShape.note) window.SeShape.note(x, y, "locked", "unlock it to change its size or shape");
  }
  const holderAt = (x, y) => [...document.querySelectorAll(".lv-node.is-holder")].map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(o => x >= o.r.left && x <= o.r.right && y >= o.r.top && y <= o.r.bottom).sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height).map(o => o.el)[0] || null;
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
    // a scroll on a window sizes the window (owner, 2026-10-12: bigger, and its content refits, so more readable);
    // Alt + scroll zooms the content about the pointer
    const panel = t && t.closest(".orbit-panel");
    const zb = t && t.closest("[data-zoombox]");
    // a scroll in on a button opens it, anywhere in the app (owner, 2026-10-12: "scroll means opens a button"): buttons,
    // links, tabs and toggles inside windows press with a few steps in; a scroll out goes on to the window
    const btn = t && panel && !alt && t.closest(PRESS);
    if (btn && panel.contains(btn)) return btn;
    if (panel && alt && zb && zb._zoom) return zb;
    if (panel) return panel;
    if (alt && t) { const th = t.closest(".orbit-bubble, .orbit-title, .lv-palette"); if (th && nameOf(th)) return th; }
    // a pill in an open bubble expands into its window by a scroll in on it (every super scrolls to expand)
    const pill = t && t.closest(".ob-member");
    if (pill && pill.dataset.key && !alt) return pill;
    // a bubble is an expandable super (super/bubble.js): a scroll on it opens or compacts it, gradually
    const bubble = t && t.closest(".orbit-bubble.is-group");
    if (bubble && window.SeBubble) return bubble;
    // a super filling the inner super (super/maximize.js) takes the scroll on its bare space
    const pt = t && t.__pt;
    const big = [...document.querySelectorAll(".lv-node.se-max, .orbit-panel.se-max, .orbit-bubble.se-max")].find(el => { const r = el.getBoundingClientRect(); return pt && pt[0] >= r.left && pt[0] <= r.right && pt[1] >= r.top && pt[1] <= r.bottom; });
    if (big) return big;
    // bare space inside a holder (the third super) is the holder's (owner, 2026-10-12: "3rd super says its locked even
    // though its not": a scroll there went to the second super, which said so when locked)
    const hold = pt && holderAt(pt[0], pt[1]);
    if (hold) return hold;
    return "site";
  }
  // one gesture stays on what it started on, so a thing that grows under the pointer keeps being sized
  let gesture = null;
  // a scroll gesture under way (started under 400 ms ago, on anything): the lock, save and chain icons leave such a
  // wheel alone, so a bubble growing under the pointer is not locked by the icon that slid under it (super/lock.js)
  window.SeScroll = { gesturing: now => !!(gesture && (now || performance.now()) - gesture.t < 400) };
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
      // a scroll out over a button is the window's (it zooms out, or shrinks); only a scroll in presses the button
      // (only a window's own buttons: a super is role=button too, and a scroll on it sizes it)
      const press = w => w !== "site" && w.matches && w.matches(PRESS) && !w.classList.contains("ob-member") && !w.classList.contains("lv-node") && !!w.closest(".orbit-panel");
      if (press(what) && dy > 0) what = what.closest(".orbit-panel") || what;
      // a bubble filling the inner super: a scroll out anywhere on it (its pills too) gives it back its size
      const mxb = what !== "site" && what.closest && what.closest(".orbit-bubble.se-max");
      if (mxb && dy > 0 && window.SeMax) { window.SeMax.restore(mxb); return; }
      // the main super selected (owner, 2026-10-12): locked, a scroll zooms the second super; unlocked, the main super itself
      const mainSel = window.SeSelect && window.SeSelect.selected && window.SeSelect.selected() === "loop";
      const ml = window.SeLock && window.SeLock.loop ? window.SeLock.loop("main") : null;
      if (what === "site" && mainSel && ml && !locked(ml) && O().zoomMain) O().zoomMain(Math.exp(-dy * 0.0015), direct);
      else if (what === "site") { const sl = window.SeLock && window.SeLock.loop ? window.SeLock.loop("site") : null; if (sl && locked(sl)) lockedNote(sl, x, y); else if (O().zoomPage) O().zoomPage(Math.exp(-dy * 0.0015), direct); }   // the second super locked: its size (the zoom) is kept
      else if (!what.isConnected) return;
      else if (press(what)) {   // a button: a few steps in press it, once per gesture
        {
          what._acc = (what._acc || 0) + dy; clearTimeout(what._accT); what._accT = setTimeout(() => { what._acc = 0; what._pressed = false; }, 500);
          if (what._acc < -70 && !what._pressed) {
            what._pressed = true;
            what.classList.add("se-pressing"); setTimeout(() => what.classList.remove("se-pressing"), 420);
            what.click();
          }
        }
      }
      else if (what.classList.contains("ob-member") && dy > 0 && locked(what.closest(".orbit-bubble"))) lockedNote(what.closest(".orbit-bubble"), x, y);
      else if (what.classList.contains("ob-member") && dy > 0) {        // a scroll out on a pill shrinks its bubble, as anywhere on it
        const bub = what.closest(".orbit-bubble.is-group"); if (bub && window.SeBubble) window.SeBubble.zoom(bub, dy);
      }
      else if (what.classList.contains("ob-member")) {                  // a pill: a few steps in open its window
        what._acc = (what._acc || 0) + dy; clearTimeout(what._accT); what._accT = setTimeout(() => { what._acc = 0; }, 500);
        if (what._acc < -60) { what._acc = 0;
          if (window.SeInner && window.SeInner.isCut(what.dataset.key)) { if (window.SeShape && window.SeShape.note) window.SeShape.note(x, y, "cut", "wire its name's output into it to open it"); }   // its wire was cut (super/inner.js)
          else if (O().openKey) { O().openKey(what.dataset.key); gesture = { what: "nothing", t: (gesture ? gesture.t : performance.now()) + 700, pinch: !!(gesture && gesture.pinch) }; } }   // the window is open: the rest of this gesture does not go on to zoom its content
      }
      else if (sizes(what) && locked(sizes(what))) lockedNote(sizes(what), x, y);   // locked: its size is kept; a locked bubble does not grow either (owner, 2026-10-12: "connect super is locked but it still grows, this is a bug")
      else if (what.classList.contains("orbit-bubble") && !alt && window.SeBubble) window.SeBubble.zoom(what, dy);
      else if (what._zoom) what._zoom.zoomAt(x, y, dy);
      else if (what.classList.contains("lv-node")) { if (window.LabView) window.LabView.zoomNode(what, dy); }
      else if (what.classList.contains("orbit-panel")) {
        // the window grows (or shrinks) with the scroll; as big as the inner super lets, the scroll goes on into
        // its content (zoomed about the pointer), and scrolling back zooms the content out before the window shrinks
        const zb = what.querySelector("[data-zoombox]"), z = zb && zb._zoom, sb = O().siteBox ? O().siteBox() : null;
        if (locked(what)) { if (z) z.zoomAt(x, y, dy); else lockedNote(what, x, y); return; }   // locked: the window keeps its size, its content still zooms
        const maxW = sb ? 2 * sb.a * (sb.fit || 1) * 0.92 : window.innerWidth - 16, maxH = sb ? 2 * sb.b * (sb.fit || 1) * 0.85 : window.innerHeight - 16;
        // the content zooms with every step (bigger type, owner, 2026-10-12: "bigger, not just the window"), and the
        // window grows with it while the inner super has room; scrolling back zooms the content out, then shrinks
        const full = what.offsetWidth >= maxW * 0.97 || what.offsetHeight >= maxH * 0.97;
        // too small, it closes (owner, 2026-10-12): at its smallest, with its content all in view, a scroll on out closes it
        const kNow = z ? (z.state.kTo != null ? z.state.kTo : z.state.k) : 1, smallest = what.offsetWidth <= 264 || what.offsetHeight <= 144, whole = !(z && kNow > z.state.fitK * 1.001);
        if (dy > 0 && smallest && whole) {
          what._over = (what._over || 0) + dy; clearTimeout(what._overT); what._overT = setTimeout(() => { what._over = 0; }, 900);
          if (what._over > 160 && O().keyOf && O().close) { what._over = 0; if (window.SeDelete) window.SeDelete.ask(what, x, y); else O().close(O().keyOf(what)); }   // ask first (owner, 2026-10-12)
          return;
        }
        // as big as the layout lets, a few steps more fill the inner super (super/maximize.js); filling it, a scroll out
        // (its content all in view) gives it back its size
        const SM = window.SeMax;
        if (SM && SM.isMax(what)) { if (dy > 0 && !(z && kNow > z.state.fitK * 1.001)) { SM.restore(what); return; } if (z) z.zoomAt(x, y, dy); return; }
        if (SM && dy < 0) {                                           // full, or no longer growing for a while: fill the inner super
          const now = performance.now();
          if (!what._g || now - what._g.t > 700) what._g = { w: what.offsetWidth, h: what.offsetHeight, acc: 0 };
          what._g.t = now; what._g.acc -= dy;
          const stuck = what._g.acc > 600 && what.offsetWidth - what._g.w < 4 && what.offsetHeight - what._g.h < 4;
          if ((full && what._g.acc > 120) || stuck) { what._g = null; SM.maximize(what); return; }
          if (what._g.acc > 600) what._g = { w: what.offsetWidth, h: what.offsetHeight, acc: 0, t: now };   // still growing: look again
        }
        if (z) z.zoomAt(x, y, dy);
        if (window.SeSite && ((dy < 0 && !full) || (dy > 0 && !(z && kNow > z.state.fitK * 1.001)))) window.SeSite.sizeWindow(what, dy);
      }
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
      if (!node && !fresh && hit && hit.closest && !hit.closest(".orbit-bubble, .orbit-panel, .se-project, .orbit-title")) node = holderAt(x, y);   // bare space in a holder: the holder's n
      if (!node && !recentEl && fresh && fresh.dataset && fresh.dataset.id)
        node = document.querySelector('.lv-node[data-id="' + fresh.dataset.id + '"]');   // the node was remade (it changed function): the same id
      if (node && locked(node)) { gesture = { what: node, t: now }; lockedNote(node, x, y); return; }   // locked: its n is kept
      if (node && window.LabView && window.LabView.shapeNode) { gesture = { what: node, t: now }; window.LabView.shapeNode(node, dy); return; }
      const S = window.SeSite || {};
      const sup = recentEl && !recentEl.classList.contains("lv-node") ? recentEl : (!fresh && hit && hit.closest && S.SHAPES ? hit.closest(S.SHAPES) : null);
      if (sup && locked(sup)) { gesture = { what: sup, t: now }; lockedNote(sup, x, y); return; }
      if (sup && S.shapeEl) { gesture = { what: sup, t: now }; S.shapeEl(sup, dy); return; }
      const what = fresh === "site" || fresh === "shape" ? fresh : (S.inSite && S.inSite(x, y) ? "site" : "shape");
      gesture = { what, t: now };
      const loopLock = window.SeLock && window.SeLock.loop ? window.SeLock.loop(what === "site" ? "site" : "main") : null;
      if (loopLock && locked(loopLock)) { lockedNote(loopLock, x, y); return; }   // the main or second super locked: its n is kept
      if (what === "site") { if (O().scrollSiteN) O().scrollSiteN(e); }
      else if (O().scrollN) O().scrollN(e);
      return;
    }
    const pinch = e.ctrlKey;
    if (!pinch && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;          // sideways: super/nodes.js guards the swipe
    const fresh = gesture && now - gesture.t < 400 && gesture.pinch === pinch && gesture.what && (typeof gesture.what === "string" || gesture.what.isConnected);
    if (hit) hit.__pt = [x, y];
    let target = fresh ? gesture.what : pick(hit, pinch, e.altKey);
    if (target === null) { gesture = null; return; }                         // content that scrolls keeps scrolling
    // a super opens, grows or shrinks by a scroll only once it is selected (owner, 2026-10-13: "hovering and zooming
    // shouldn't open a super; selecting and zooming should"): on an unselected super the scroll is the page's, and a
    // note says to click it first (a window's own buttons and its content still take a scroll once the window is selected)
    if (!fresh && target !== "site" && target.closest && !target.closest(".se-sel")) {
      const sup = target.closest(".orbit-bubble, .orbit-panel, .lv-node, .se-project, .orbit-title, .ob-member, .ob-label") || target;
      if (!sup._seNoteT || now - sup._seNoteT > 1500) { sup._seNoteT = now; if (window.SeShape && window.SeShape.note) window.SeShape.note(x, y, "click it first", "select a super, then scroll to open or size it"); }
      target = "site";
    }
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
  let titleHooked = null;
  function hookTitle() {
    const t = document.querySelector(".orbit-title");
    const sup = t && t.querySelector(".se-titlesuper");
    if (!sup || titleHooked === sup) return sup;
    titleHooked = sup;
    // nothing is clickable, only zoomable (owner, 2026-10-12): a scroll on the title super, once the view has
    // changed, brings back the first view (before the page's own scroll handlers take it)
    window.addEventListener("wheel", e => {
      if (!on() || e.shiftKey || e.altKey || !sup.contains(e.target)) return;
      if (!(O().viewChanged && O().viewChanged())) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (O().resetView) O().resetView();
    }, { capture: true, passive: false });
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
  window.SeZoom = { zoneAt, sizeThing, THING };
})();
// a window opening while the view is zoomed out (the start is, owner 2026-10-12) brings the view back to 100 %,
// gliding, so the window is readable and its buttons can be pressed where they are drawn
(function () {
  let had = 0;
  document.addEventListener("se:windows", () => {
    const O = window.PiOrbit || {}, n = document.querySelectorAll(".orbit-panel:not(.leaving)").length;
    if (n > had && O.zoom && O.zoomPage) { const z = O.zoom(); if (z < 0.98) O.zoomPage(1 / z, false); }
    had = n;
  });
})();
