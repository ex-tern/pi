// super/loop.js — the main super: the loop the size of the page that holds everything, its n, the
// zoom and the fit that keep the page inside it, the windows kept inside the inner super, the inner
// super's box, offset and own n, and the π digits running round the loop. orbit.js creates it
// (SuperLoop.create(ctx)) with what it needs from the orbit layout: the stage, its height and top, its
// width without the Live dock, the store, and saveWin. Everything the loop exports is on the object
// returned; orbit.js aliases the functions and reads the live values (pageFit, loopG, siteOff, zoom)
// through their getters.
(function () {
  "use strict";
  window.SuperLoop = { create };
  function create(ctx) {
    const { $, store, load } = ctx;
    const merged = () => document.documentElement.classList.contains("shape-se");
    // n is π (computed live) until you scroll on the loop: then it is yours, kept in this browser
    // the first visit in the superellipse look: the main super nearly a box (n = 24) holding the site, itself a
    // near-box (n = 24), at full size; after that, whatever you scrolled them to
    let markN = load("orbit:mark:n") || (document.documentElement.classList.contains("shape-se") ? 24 : null);
    const loopN = () => markN || (window.SeMorph && window.SeMorph.pi) || Math.PI;
    let nShowT = 0;
    // In the superellipse look the loop is the page: |x/a|^n + |y/b|^n = 1 with a, b half the
    // ctx.stage, everything inside it. Scrolling ("zooming") moves n from 0 (it pinches to a
    // cross, then the centre) through 1 (a diamond) and 2 (an ellipse) to ∞ (the page's rectangle).
    const N_MIN = 0.01, N_MAX = 1000;
    const nLabel = n => n >= N_MAX * 0.999 ? "n → ∞" : n <= N_MIN * 1.001 ? "n → 0" : "n = " + (n < 10 ? n.toFixed(3) : n.toFixed(1));
    function scrollN(e) {
      if (!merged()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const dy = e.deltaY || e.deltaX;
      const S = window.SeShape;
      const nn = S ? S.step("main", loopN(), dy, N_MIN, N_MAX) : Math.min(N_MAX, Math.max(N_MIN, (scrollN.to || loopN()) * Math.exp(-dy * 0.002)));
      if (S) S.show(e.clientX, e.clientY, nn);
      scrollN.to = nn;                                                // n goes all the way to 0: the page shrinks toward the centre to stay inside
      if (window.SeMotion) { const s = { v: loopN() }; window.SeMotion.glide("page:n", s, "v", nn, 160, () => { markN = s.v; drawLoop(); }); }
      else { markN = nn; drawLoop(); }
      const t = $(".orbit-nread");
      if (t) { t.textContent = nLabel(markN); t.classList.add("show"); }
      clearTimeout(nShowT);
      nShowT = setTimeout(() => { if (t) t.classList.remove("show"); scrollN.to = null; store("orbit:mark:n", +markN.toPrecision(5)); }, 900);
    }
    // The loop holds everything: each time it is drawn it measures every object on the
    // page (bubbles, title, counter, palette, Live, nodes) and grows just enough that
    // all their corners are inside |x/a|^n + |y/b|^n = 1, but never past the display:
    // it always fits the screen completely. At n = π that is the page's own frame; for
    // small n its sides curve in.
    const LOOP_M = 0.94;                                  // half-axes at scale 1: 94% of half the screen
    // With a window open the loop gathers into a small mark above the windows (a click on it closes
    // them all, as in the plain look); with none open it is the page again.
    const pageLoop = () => merged();                                 // the main loop never goes away, windows open or not
    let miniKey = "";
    function drawMini() {
      const n = loopN(), key = n.toPrecision(6);
      if (key === miniKey) return;
      miniKey = key;
      const e = 2 / n, pts = [];
      for (let i = 0; i < 360; i++) {
        const t = i / 360 * 2 * Math.PI, c = Math.cos(t), sn = Math.sin(t);
        pts.push((200 + 150 * Math.sign(c) * Math.pow(Math.abs(c), e)).toFixed(2) + "," + (200 + 150 * Math.sign(sn) * Math.pow(Math.abs(sn), e)).toFixed(2));
      }
      const path = $(".om-loop");
      if (path) path.setAttribute("d", "M" + pts.join("L") + "Z");
    }
    function miniSweep(deg, sweep) {
      const th = deg * Math.PI / 180, len = Math.min(400, 150 / seNorm(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)), loopN()));
      const k = len.toFixed(1);
      if (k === sweep.dataset.len) return;
      sweep.dataset.len = k;
      const [l1, l2] = sweep.querySelectorAll("line");
      l1.setAttribute("x2", (200 + len).toFixed(1)); l2.setAttribute("x2", (200 - len).toFixed(1));
    }
    const CONTAIN = ".orbit-bubble, .orbit-title, .orbit-pi, .lv-palette, .lv-node";
    let loopG = { cx: 0, cy: 0, a: 1, b: 1, n: Math.PI }, loopKey = "";
    // r ↦ (u^n + v^n)^(1/n), safely for any n
    const seNorm = (u, v, n) => { const m = Math.max(u, v); return m ? m * Math.pow(Math.pow(u / m, n) + Math.pow(v / m, n), 1 / n) : 0; };
    // Everything stays inside the mark. When the mark, grown to the display, still cannot hold
    // the page (a small n, a star), the page shrinks toward the centre until it does.
    const FIT = ".orbit-bubbles, .orbit-title, .orbit-pi, .lv-palette";   // nodes scale themselves (super/nodes.js place), from a pivot that moves with them   // wire layers are drawn from what is on screen, so they are not scaled
    let pageFit = 1;
    // zooming inside the main loop scales everything in it (orbit:zoom); the fit above keeps it inside the loop
    // the superellipse look starts zoomed out: the site a small super in the middle of the main one
    // the superellipse look starts zoomed out, the inner super small in the middle of the main one (owner, 2026-10-12:
    // "make this the initial state"); a scroll out goes further, a scroll in comes up to 100 %
    const START_ZOOM = window.innerWidth < 700 ? 0.6 : 0.4;            // a phone a little closer: its screen is small
    let zoom = Math.max(0.25, Math.min(3, +load("orbit:zoom") || (document.documentElement.classList.contains("shape-se") ? START_ZOOM : 1))), zoomT;
    let zoomTo = null;
    // direct: set at once (a trackpad or a pinch, already smooth, coalesced per frame by super/scroll.js);
    // otherwise glide there (a mouse wheel's coarse steps)
    // the superellipse look locks the inner super in place (owner, 2026-10-12): no zoom, no offset; it is as big as
    // the main super lets (siteBox), so a scroll on bare space leaves it be
    const locked = () => document.documentElement.classList.contains("shape-se");
    const zoomV = () => locked() ? Math.min(1, zoom) : zoom;           // locked: it zooms out, never in (owner, 2026-10-12: "second super should be zoom outable")
    const offV = () => locked() ? { x: 0, y: 0 } : siteOff;
    function zoomPage(k, direct) {
      const target = Math.max(locked() ? 0.25 : 0.25, Math.min(locked() ? 1 : 3, (zoomTo == null ? zoom : zoomTo) * k));
      zoomTo = target;
      clearTimeout(zoomT); zoomT = setTimeout(() => { store("orbit:zoom", +target.toFixed(3)); zoomTo = null; }, 400);
      if (direct || !window.SeMotion) { if (window.SeMotion) window.SeMotion.glide("page:zoom", { v: target }, "v", target, 0, () => {}); zoom = target; loopKey = ""; drawLoop(); }
      else { const s = { v: zoom }; window.SeMotion.glide("page:zoom", s, "v", target, 160, () => { zoom = s.v; loopKey = ""; drawLoop(); }); }
    }
    // back to how a first visit sees it: zoom 1, both supers at n = 24, the inner super in the middle
    const VIEW_N = 24;
    function resetView() {
      zoomTo = null; scrollN.to = null; scrollSiteN.to = null;
      const from = { z: zoom, m: loopN(), s: siteNv(), x: siteOff.x, y: siteOff.y };
      const z0 = locked() ? START_ZOOM : 1, to = { z: z0, m: VIEW_N, s: VIEW_N, x: 0, y: 0 };
      const apply = v => { zoom = v.z; markN = v.m; siteN = v.s; siteOff = { x: v.x, y: v.y }; placeBubblesLayer(); loopKey = ""; drawLoop(); };
      const done = () => { apply(to); store("orbit:zoom", z0); store("orbit:mark:n", VIEW_N); store("orbit:site:n", VIEW_N); store("orbit:site:offset", { x: 0, y: 0 }); if (window.PiOrbit && window.PiOrbit.layout) window.PiOrbit.layout(); };
      if (window.SeMotion) window.SeMotion.tween(from, to, { duration: 380, easing: "easeOutCubic", update: () => apply(from), complete: done });
      else done();
    }
    // how far the view is from that (super/scroll.js shows the way back when it is not)
    const viewChanged = () => Math.abs((zoomTo == null ? zoomV() : Math.min(locked() ? 1 : 9, zoomTo)) - (locked() ? START_ZOOM : 1)) > 0.02 || Math.abs(loopN() - VIEW_N) > 0.5 || Math.abs(siteNv() - VIEW_N) > 0.5 || Math.hypot(offV().x, offV().y) > 4;
    // Smoothness: the page is measured (every element's box, and where each scaled element pivots) once per
    // layout tick, never inside an animation frame, so a frame that moves n or the zoom does arithmetic and
    // style writes only, with no layout forced in between.
    let fitEls = [], corners = [], measuredAt = 0;
    function measure() {
      const px = window.innerWidth / 2, py = ctx.top() + ctx.H() / 2, f = pageFit;
      fitEls = [...document.querySelectorAll(FIT)].map(el => {
        let lx = 0, ly = 0;
        for (let e = el; e; e = e.offsetParent) { lx += e.offsetLeft; ly += e.offsetTop; }
        return { el, origin: (px - lx).toFixed(1) + "px " + (py - ly).toFixed(1) + "px" };
      });
      corners = [];
      document.querySelectorAll(CONTAIN).forEach(el => {
        if (el.hidden || !el.getClientRects().length) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        // the corners at full size: what is on screen, unscaled about the pivot (by whichever factor scaled it)
        const site = !!(siteEl(el) || el.closest(".orbit-bubbles")), k = site ? f : fitOther;
        // the title is a rounded badge: the corners of its box are empty, so they are checked a little inside it
        const m = el.classList.contains("orbit-title") ? -0.3 * Math.min(r.width, r.height) : 6;
        for (const x of [r.left - m, r.right + m]) for (const y of [r.top - m, r.bottom + m])
          corners.push([px + (x - px) / k, py + (y - py) / k, site]);
      });
      measuredAt = performance.now();
    }
    // the fit never changes under a pressed pointer (a drag would jump), and glides to its new value after
    // Two factors: the zoom scales the site (the bubbles, and the nodes with them); the room factor, never
    // above 1, shrinks everything (the title, the counter, the palette, Live too) only when it would cross
    // the loop. So zooming out leaves the title and Live at full size, as on the sketch.
    let fitTarget = 1, pointerHeld = false, fitOther = 1;
    function fitTo(want, other, px, py) {
      if (pointerHeld) return;
      if (Math.abs(want - fitTarget) < 0.004 && Math.abs(other - fitOther) < 0.004) return;
      fitTarget = want;
      if (window.SeMotion && Math.abs(want - pageFit) > 0.02) {
        const st = { v: pageFit, o: fitOther };
        window.SeMotion.tween(st, { v: want, o: other }, { duration: 220, easing: "easeOutCubic", update: () => setFit(st.v, st.o, px, py) });
      } else setFit(want, other, px, py);
    }
    const siteEl = el => el.classList.contains("orbit-bubbles") || el.classList.contains("lv-node");
    function setFit(f, fo, px, py) {
      f = Math.round(f * 200) / 200; fo = Math.round((fo == null ? f : fo) * 200) / 200;
      if (f === pageFit && fo === fitOther && f === 1 && fo === 1) return;
      pageFit = f; fitOther = fo;
      document.documentElement.classList.toggle("orbit-fit", f < 1 || fo < 1);
      if (!fitEls.length || performance.now() - measuredAt > 400) measure();
      fitEls.forEach(({ el, origin }) => {
        const k = siteEl(el) ? f : fo;
        if (k === 1) { el.style.scale = ""; el.style.transformOrigin = ""; return; }
        if (el.style.transformOrigin !== origin) el.style.transformOrigin = origin;
        el.style.scale = String(k);
      });
      placeBubblesLayer();
    }
    // how big the loop must be (in units of its usual a, b) to hold the page at full size: from the cached corners
    // site: true counts only what the zoom scales (the bubbles, the nodes), false only the rest (the title,
    // the counter, the palette, Live), undefined everything
    function needAt(n, site) {
      const Wv = window.innerWidth, A = LOOP_M * Wv / 2, B = LOOP_M * ctx.H() / 2, cx = Wv / 2, cy = ctx.top() + ctx.H() / 2;
      if (!corners.length || performance.now() - measuredAt > 400) measure();
      let need = 0;
      for (const [x, y, s] of corners) if (site == null || s === site) need = Math.max(need, seNorm(Math.abs(x - cx) / A, Math.abs(y - cy) / B, n));
      return need;
    }
    // Windows stay inside the main loop: moved toward its centre, and made smaller only if even
    // centred they would cross it. Not while a pointer is down (a drag or a resize in progress).
    document.addEventListener("pointerdown", () => { pointerHeld = true; }, true);
    document.addEventListener("pointerup", () => { pointerHeld = false; setTimeout(() => { keepWindowsIn(); loopKey = ""; drawLoop(); }, 30); }, true);   // the fit it held back
    document.addEventListener("pointercancel", () => { pointerHeld = false; }, true);
    // Windows are shown inside the super they belong to: the inner super, where their bubbles are (on
    // screen: the site box scaled toward the page's centre as the page is), moved in and, only when even
    // centred they would cross it, made smaller
    function keepWindowsIn() {
      if (locked() && zoomV() < 0.98) return;                         // zoomed out (the start): a window opening brings the view back to 100 % first (super/scroll.js); sized then
      if (!merged() || pointerHeld || !loopG.a) return;
      const sb = siteBox(), f = sb.fit || 1, pad = 6;
      const cx = sb.px + (sb.cx - sb.px) * f, cy = sb.py + (sb.cy - sb.py) * f, a = sb.a * f, b = sb.b * f, n = sb.n;
      const fits = (l, t, w, h) => [l - pad, l + w + pad].every(x => [t - pad, t + h + pad].every(y => seNorm(Math.abs(x - cx) / a, Math.abs(y - cy) / b, n) <= 1));
      document.querySelectorAll(".orbit-panel").forEach(p => {
        if (p.classList.contains("gliding") || p.classList.contains("leaving") || p.matches(":hover")) return;   // the window under the pointer stays where it is
        if (window.SeLock && window.SeLock.isLocked(p)) return;            // and a locked one where it was put
        const r = p.getBoundingClientRect();
        // no more than about half the inner super, so the bubbles keep their room; on a phone there is no room
        // to share, so a window may take most of it (and never shrinks below a readable size)
        const sm = window.innerWidth < 700, cap = winCap(p), wCap = cap.w, hCap = cap.h, minW = p.seSized ? 24 : sm ? Math.floor(a * 1.5) : 200, minH = p.seSized ? 24 : sm ? Math.floor(b * 0.6) : 120;   // a window you sized may be any size
        if (!r.width || (fits(r.left, r.top, r.width, r.height) && r.width <= wCap + 1 && r.height <= hCap + 1)) return;
        let w = r.width, h = r.height;
        const k = Math.min(1, wCap / w, hCap / h);
        if (k < 1) { w = Math.max(minW, Math.floor(w * k)); h = Math.max(minH, Math.floor(h * k)); p.style.width = w + "px"; p.style.height = h + "px"; }
        if (!fits(cx - w / 2, cy - h / 2, w, h)) {                          // too big even in the middle: smaller
          let lo = 0.2, hi = 1;
          for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (fits(cx - w * m / 2, cy - h * m / 2, w * m, h * m)) lo = m; else hi = m; }
          w = Math.max(minW, Math.floor(w * lo)); h = Math.max(minH, Math.floor(h * lo));
          p.style.width = w + "px"; p.style.height = h + "px";
        }
        const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
        let lo = 0, hi = 1;                                                 // as little a move toward the centre as will do
        for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (fits(x0 + (cx - x0) * m - w / 2, y0 + (cy - y0) * m - h / 2, w, h)) hi = m; else lo = m; }
        p.style.left = Math.round(x0 + (cx - x0) * hi - w / 2) + "px"; p.style.top = Math.round(y0 + (cy - y0) * hi - h / 2) + "px";
        if (p.item) ctx.saveWin(p.item, p);
      });
      separateWindows(fits);
    }
    // the most a window may take of the inner super: about half, so the bubbles keep their room; on a phone there is no
    // room to share, and a window sized by you (super/site.js) or grown to keep its text readable (super/zoombox.js)
    // may take most of it
    function winCap(p) {
      const sb = siteBox(), f = sb.fit || 1, a = sb.a * f, b = sb.b * f, big = window.innerWidth < 700 || (p && (p.seSized || p.seRead));
      if (p && p.seSized) return { w: Math.floor(a * 2), h: Math.floor(b * 2) };   // sized by you: as big as the inner super
      return { w: Math.floor(big ? a * 1.84 : a * 1.1), h: Math.floor(big ? b * 1.7 : b * 1.3) };
    }
    // nothing overlaps: windows push each other apart along the shorter way, step away from the nodes,
    // the title and Live (those are where you put them and stay), and when there is no room for all of them inside the
    // inner super they all get a little smaller together, as the pills do, until there is
    function separateWindows(fits) {
      const sm = window.innerWidth < 700, sbm = siteBox(), fm = sbm.fit || 1;
      const GAP = 3, MIN_W = sm ? Math.floor(sbm.a * fm * 1.5) : 200, MIN_H = sm ? Math.floor(sbm.b * fm * 0.6) : 120;   // a phone's window stays readable
      const minOf = p => (p.seSized ? { w: Math.floor(p.offsetWidth), h: Math.floor(p.offsetHeight) } : { w: MIN_W, h: MIN_H });   // a window you sized keeps its size, small or big
      const lockedWin = p => !!(window.SeLock && window.SeLock.isLocked(p));
      const wins = [...document.querySelectorAll(".orbit-panel")].filter(p => !p.classList.contains("gliding") && !p.classList.contains("leaving"));
      if (!wins.length) return;
      const nodes = [...document.querySelectorAll(".lv-node, .orbit-title, .se-project:not(.is-open)")].filter(n => !n.classList.contains("is-dragging"))
        .filter(n => !(window.SeHold && window.SeHold.hostOf(n) && window.SeHold.hostOf(n).classList.contains("orbit-panel")))   // held by a window: it goes with it (super/hold.js)
        .map(n => n.getBoundingClientRect()).map(r => ({ left: r.left, top: r.top, width: r.width, height: r.height }));
      let rs = wins.map(p => { const r = p.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
      if (rs.some(r => !r.width)) return;
      const overlap = (a, b) => a.left < b.left + b.width + GAP && b.left < a.left + a.width + GAP && a.top < b.top + b.height + GAP && b.top < a.top + a.height + GAP;
      const ok = r => fits(r.left, r.top, r.width, r.height);
      // the shortest push that takes a off b
      const push = (a, b) => [
        { dx: b.left + b.width + GAP - a.left, dy: 0 }, { dx: b.left - GAP - (a.left + a.width), dy: 0 },
        { dx: 0, dy: b.top + b.height + GAP - a.top }, { dx: 0, dy: b.top - GAP - (a.top + a.height) },
      ].sort((u, v) => Math.hypot(u.dx, u.dy) - Math.hypot(v.dx, v.dy));
      const moved = (r, d, k) => ({ left: r.left + d.dx * k, top: r.top + d.dy * k, width: r.width, height: r.height });
      let clean = false;
      for (let pass = 0; pass < 4 && !clean; pass++) {
        for (let iter = 0; iter < 24; iter++) {
          let any = false;
          for (let i = 0; i < rs.length; i++) {
            const li = lockedWin(wins[i]);                                    // a locked window keeps its place (others step off it)
            if (!li) for (const nd of nodes) if (overlap(rs[i], nd)) {        // off a node, as far as the inner super allows
              const way = push(rs[i], nd).find(d => ok(moved(rs[i], d, 1)));
              if (way) { rs[i] = moved(rs[i], way, 1); any = true; }
            }
            for (let j = i + 1; j < rs.length; j++) if (overlap(rs[i], rs[j])) {
              const ways = push(rs[i], rs[j]);
              let done = false;
              for (const d of ways) {                                         // half each, or all of it on the one that can
                const lj = lockedWin(wins[j]);
                if (li && lj) break;
                if (lj) { const a1 = moved(rs[i], d, 1); if (ok(a1)) { rs[i] = a1; done = true; break; } continue; }
                if (li) { const b1 = moved(rs[j], d, -1); if (ok(b1)) { rs[j] = b1; done = true; break; } continue; }
                const a = moved(rs[i], d, 0.5), b = moved(rs[j], d, -0.5);
                if (ok(a) && ok(b)) { rs[i] = a; rs[j] = b; done = true; break; }
                const a1 = moved(rs[i], d, 1); if (ok(a1)) { rs[i] = a1; done = true; break; }
                const b1 = moved(rs[j], d, -1); if (ok(b1)) { rs[j] = b1; done = true; break; }
              }
              if (done) any = true;
            }
          }
          if (!any) break;
        }
        // only windows crowding each other make them smaller: a super a window cannot step off (the central super on a
        // phone) is covered rather than fought over, or the window would shrink and grow back for ever
        clean = !rs.some((r, i) => rs.some((q, j) => j > i && overlap(r, q)));
        if (!clean) {                                                         // no room: all of them a little smaller
          const next = rs.map((r, i) => { const m = minOf(wins[i]); const w = Math.max(m.w, Math.floor(r.width * 0.9)), h = Math.max(m.h, Math.floor(r.height * 0.9));
            return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h }; });
          if (next.every((r, i) => r.width === rs[i].width && r.height === rs[i].height)) break;
          rs = next;
        }
      }
      wins.forEach((p, i) => {
        if (p.matches(":hover")) return;                                // the window under the pointer stays; the others make room
        const r = rs[i], cur = p.getBoundingClientRect();
        if (Math.abs(r.left - cur.left) < 1 && Math.abs(r.top - cur.top) < 1 && Math.abs(r.width - cur.width) < 1 && Math.abs(r.height - cur.height) < 1) return;
        if (!p.classList.contains("gliding")) {                        // it glides there, moved or sized (supers never jump)
          p.classList.add("gliding"); clearTimeout(p._glideT); p._glideT = setTimeout(() => p.classList.remove("gliding"), 950);
        }
        p.style.left = Math.round(r.left) + "px"; p.style.top = Math.round(r.top) + "px";
        p.style.width = Math.round(r.width) + "px"; p.style.height = Math.round(r.height) + "px";
        if (p.item) ctx.saveWin(p.item, p);
      });
    }
    function drawLoop() {
      if (!pageLoop()) { setFit(1, 1); if (merged()) drawMini(); return; }
      const Wv = window.innerWidth, Hv = ctx.H(), n = loopN();
      const A = LOOP_M * Wv / 2, B = LOOP_M * Hv / 2, cx = Wv / 2, cy = ctx.top() + Hv / 2;
      // no padding: the loop always reaches the display's edges (its a×b box is the screen, less its stroke)
      const cap = (1 - 4 / Math.min(Wv, Hv)) / LOOP_M;
      const sc = cap;
      // the largest scale that still fits inside the loop, for the site (what the zoom scales) and for the rest
      // apart: the title and Live sit near the display's edge and are never zoomed, so counting them capped the
      // zoom at about 1 and the inner super could not grow (owner, 2026-10-11)
      const needS = needAt(n, true), needO = needAt(n, false);
      const roomS = needS > 0 ? cap / needS * 0.985 : zoomV(), roomO = needO > 0 ? cap / needO * 0.985 : 1;
      // locked (the superellipse look): no fit at all. The layout already keeps everything inside the inner super, and a
      // fit that follows the bubbles' size fed back into their layout (open bubbles, readable words) and the whole page
      // pulsed (owner, 2026-10-12: "the graphics jerks like this")
      if (locked()) fitTo(zoomV(), 1, cx, cy);                      // only the zoom: never a fit that follows the bubbles
      else fitTo(Math.max(0.005, Math.min(zoomV(), roomS)), Math.max(0.005, Math.min(1, roomO)), cx, cy);
      const a = sc * A, b = sc * B, key = [Wv, Hv, n.toPrecision(6), sc].join();
      loopG = { cx: Wv / 2, cy: Hv / 2, a, b, n };
      if (key === loopKey) return;
      loopKey = key;
      const X0 = Wv / 2, Y0 = Hv / 2, pts = [];
      if (sc < 3) {                                        // the whole curve, by angle
        const e = 2 / n, K = 360;
        for (let i = 0; i < K; i++) {
          const t = i / K * 2 * Math.PI, c = Math.cos(t), sn = Math.sin(t);
          pts.push([X0 + a * Math.sign(c) * Math.pow(Math.abs(c), e), Y0 + b * Math.sign(sn) * Math.pow(Math.abs(sn), e)]);
        }
      } else {                                             // a huge loop: only the part on screen, by x
        const X = Math.min(a, Wv / 2 + 40), K = 480, lim = Hv / 2 + 40;
        const yAt = x => { const u = Math.abs(x) / a, t = u > 0 ? Math.exp(n * Math.log(u)) : 0; return t >= 1 ? 0 : Math.min(lim, b * Math.exp(Math.log1p(-t) / n)); };
        for (let i = 0; i <= K; i++) { const x = -X + 2 * X * i / K; pts.push([X0 + x, Y0 - yAt(x)]); }
        for (let i = K; i >= 0; i--) { const x = -X + 2 * X * i / K; pts.push([X0 + x, Y0 + yAt(x)]); }
      }
      const svg = EL.page || (EL.page = $(".om-page")), path = EL.loop || (EL.loop = $(".om-page-loop"));
      if (svg) svg.setAttribute("viewBox", "0 0 " + Wv + " " + Hv);
      loopD = "M" + pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L") + "Z";
      if (path) path.setAttribute("d", loopD);
      // the π line's path (text on a path is costly to lay out): at most a few times a second while the loop
      // moves, and once more when it has settled
      const pp = EL.pipath || (EL.pipath = $(".om-page-pipath"));
      if (pp) {
        const now = performance.now();
        clearTimeout(piPathT);
        if (now - piPathAt > 150) { piPathAt = now; pp.setAttribute("d", loopD + loopD); }
        else piPathT = setTimeout(() => { piPathAt = performance.now(); pp.setAttribute("d", loopD + loopD); }, 160);
      }
    }
    let loopD = "";
    const EL = {};                      // the loop's elements, looked up once
    let piPathAt = 0, piPathT = 0;
    // The loop can be wired like a bubble. loopPoint gives the point on it facing (x, y), in
    // screen coordinates; nearLoop says whether (x, y) is on its edge (or on the mark, when small).
    function loopPoint(x, y) {
      if (pageLoop()) {
        const cx = loopG.cx, cy = ctx.top() + loopG.cy, th = Math.atan2(y - cy, x - cx), c = Math.cos(th), sn = Math.sin(th);
        const r = 1 / seNorm(Math.abs(c) / loopG.a, Math.abs(sn) / loopG.b, loopG.n);
        return [Math.max(6, Math.min(window.innerWidth - 6, cx + r * c)), Math.max(ctx.top() + 6, Math.min(window.innerHeight - 6, cy + r * sn))];
      }
      const k = $(".orbit-core").getBoundingClientRect(), cx = k.left + k.width / 2, cy = k.top + k.height / 2, R = k.width / 2 * 0.94;
      const th = Math.atan2(y - cy, x - cx);
      return [cx + R * Math.cos(th), cy + R * Math.sin(th)];
    }
    function nearLoop(x, y) {
      if (pageLoop()) {
        const cx = loopG.cx, cy = ctx.top() + loopG.cy, th = Math.atan2(y - cy, x - cx);
        const r = 1 / seNorm(Math.abs(Math.cos(th)) / loopG.a, Math.abs(Math.sin(th)) / loopG.b, loopG.n);
        return Math.abs(Math.hypot(x - cx, y - cy) - r) < 18;
      }
      const k = $(".orbit-core").getBoundingClientRect();
      return Math.hypot(x - (k.left + k.width / 2), y - (k.top + k.height / 2)) < k.width / 2 + 10;
    }
    // the diameter, reaching the loop at every angle
    function sweepPx(deg) {
      const tp = EL.tp || (EL.tp = $(".om-page-pi textPath"));
      if (tp) {                                                      // the π line creeps round the loop, slowly (an eighth of the sweep)
        // locked (the superellipse look), it stays centred on the right side, upright, never round a corner
        const off = locked() ? "50%" : ((((deg / 8) % 360) + 360) % 360 / 720 * 100).toFixed(1) + "%";
        if (off !== sweepPx.last) { sweepPx.last = off; tp.setAttribute("startOffset", off); tp.setAttribute("text-anchor", locked() ? "middle" : "start"); }   // a tenth of a percent at a time: a few times a second, not every frame
      }
      const line = EL.r || (EL.r = $(".om-page-r"));
      if (!line) return;
      const th = deg * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th), { cx, cy, a, b, n } = loopG;
      const r = Math.min(Math.hypot(cx, cy) * 2, 1 / seNorm(Math.abs(c) / a, Math.abs(sn) / b, n));
      line.setAttribute("x1", (cx - r * c).toFixed(1)); line.setAttribute("y1", (cy - r * sn).toFixed(1));
      line.setAttribute("x2", (cx + r * c).toFixed(1)); line.setAttribute("y2", (cy + r * sn).toFixed(1));
    }
    // The title, the Functions palette and the Live panel sit inside the loop too: each steps in from
    // its edge or corner until it fits inside the loop at its usual n (π, scale 1), on any screen.
    // the compact supers' side (bubbles, the project super: --se-compact): the largest square of which ten fit in
    // the inner super (owner, 2026-10-12), on a grid of 5 × 2, 4 × 3, 3 × 4 or 2 × 5, with room between them
    function compactSide() {
      const sb = siteBox(), f = locked() ? 1 : (sb.fit || 1), w = 2 * sb.a * f, h = 2 * sb.b * f;   // locked: never from the fit, which follows the bubbles (a loop)
      const best = [[5, 2], [4, 3], [3, 4], [2, 5]].reduce((m, [c, r]) => Math.max(m, Math.min(w / c, h / r)), 0);
      return Math.max(84, Math.min(280, Math.round(best * 0.82)));
    }
    function seatEdges() {
      if (!merged()) return;
      const Wv = window.innerWidth, A = LOOP_M * Wv / 2, B = LOOP_M * ctx.H() / 2, cx = Wv / 2, cy = ctx.top() + ctx.H() / 2, root = document.documentElement.style;
      const fits = (l, t, r, b, n, m = 6) => [l - m, r + m].every(x => [t - m, b + m].every(y => seNorm(Math.abs(x - cx) / A, Math.abs(y - cy) / B, n || Math.PI) <= 1));
      const title = $(".orbit-title");
      if (title && title.offsetWidth) {
        // the title sits in the corner of the main loop as it is now (not at π), so a near-box loop keeps it
        // high, in the gap above the inner super
        const tr = title.getBoundingClientRect(), h = tr.height, tn = Math.max(Math.PI, loopN()), TITLE_M = -0.3 * Math.min(tr.width, h);   // its box's corners are empty (see measure)
        // the title (a simple super) stays in the page's top-left corner whatever the loops' n (owner, 2026-10-11)
        void fits; void tn; void TITLE_M;
        root.setProperty("--se-title-top", "14px");
      }
      siteM = null;                                                    // the inner super's margins, measured again once the title is seated
      document.documentElement.style.setProperty("--se-compact", compactSide() + "px");
      const pal = $(".lv-palette");
      if (pal && pal.offsetWidth) {
        const w = pal.offsetWidth, h = pal.offsetHeight;
        for (let k = 0.01; k < 0.45; k += 0.004) {
          const l = k * Wv, bt = k * ctx.H();
          if (fits(l, ctx.top() + ctx.H() - bt - h, l + w, ctx.top() + ctx.H() - bt)) { root.setProperty("--se-pal-left", Math.round(l) + "px"); root.setProperty("--se-pal-bottom", Math.round(bt) + "px"); break; }
        }
      }
    }
    // The site's super (super/site.js draws it): an inner superellipse the bubbles are laid out in, with the
    // same n as the main loop; the lattice lines from its ports run across the gap to the main loop.
    const SITE_MX = 0.92, SITE_MY = 0.86;   // bigger, with less room between it and the main loop (owner, 2026-10-11)
    let siteOff = load("orbit:site:offset") || { x: 0, y: 0 };
    if (typeof siteOff.x !== "number" || typeof siteOff.y !== "number") siteOff = { x: 0, y: 0 };
    // the inner super's n: the main loop's until shift + scroll inside it (on nothing) gives it one of its
    // own (super/scroll.js), kept as orbit:site:n; from then on the two change shape independently
    let siteN = +load("orbit:site:n") || (document.documentElement.classList.contains("shape-se") ? 24 : 0);
    const siteNv = () => siteN || loopN();
    function scrollSiteN(e) {
      if (!merged()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const dy = e.deltaY || e.deltaX;
      const S = window.SeShape;
      const nn = S ? S.step("site", siteNv(), dy, N_MIN, N_MAX) : Math.min(N_MAX, Math.max(N_MIN, (scrollSiteN.to || siteNv()) * Math.exp(-dy * 0.002)));
      if (S) S.show(e.clientX, e.clientY, nn);
      scrollSiteN.to = nn;
      if (window.SeMotion) { const s = { v: siteNv() }; window.SeMotion.glide("site:n", s, "v", nn, 160, () => { siteN = s.v; }); }
      else siteN = nn;
      clearTimeout(scrollSiteN.t);
      scrollSiteN.t = setTimeout(() => { scrollSiteN.to = null; store("orbit:site:n", +siteN.toPrecision(5)); }, 900);
    }
    // locked (the superellipse look): as big as possible, its edge just inside the main super's ports at the sides and
    // just clear of the title super at the top (and as much at the bottom); seatEdges measures the title
    let siteM = null;
    function siteMargins() {
      const w = ctx.vw(), H = ctx.H(), m0 = w < 700 ? 12 : 34, title = $(".orbit-title"), n = siteNv();
      if (!title || !title.offsetWidth) return { mx: m0, my: Math.round(H * (1 - SITE_MY) / 2) };
      // the largest inner super (by area) whose edge keeps clear of the title super in the top-left corner
      const t = title.getBoundingClientRect(), cx = w / 2, cy = ctx.top() + H / 2;
      const pts = [[t.right + 6, t.bottom + 6], [t.left - 6, t.bottom + 6], [t.right + 6, t.top - 6], [(t.left + t.right) / 2, t.bottom + 6], [t.right + 6, (t.top + t.bottom) / 2]];
      const clear = (mx, my) => pts.every(([x, y]) => seNorm(Math.abs(x - cx) / (w / 2 - mx), Math.abs(y - cy) / (H / 2 - my), n) > 1);
      let best = { mx: m0, my: Math.round(H * 0.2), area: 0 };
      for (let mx = m0; mx < w * 0.2; mx += 2) for (let my = Math.min(40, m0 + 28); my < H * 0.2; my += 2) {
        if (!clear(mx, my)) continue;
        const area = (w / 2 - mx) * (H / 2 - my);
        if (area > best.area) best = { mx, my, area };
        break;                                                         // a larger my only shrinks it
      }
      return best;
    }
    function siteBox() {
      const w = ctx.vw(), o = offV();
      if (locked()) {
        const k = siteNv().toPrecision(3) + "," + w + "," + ctx.H(); if (!siteM || siteM.k !== k) { siteM = siteMargins(); siteM.k = k; } const m = siteM;
        return { cx: w / 2, cy: ctx.top() + ctx.H() / 2, a: w / 2 - m.mx, b: ctx.H() / 2 - m.my, n: siteNv(), fit: pageFit, px: window.innerWidth / 2, py: ctx.top() + ctx.H() / 2, ox: 0, oy: 0 };
      }
      return { cx: w / 2 + o.x, cy: ctx.top() + ctx.H() / 2 + o.y, a: SITE_MX * w / 2, b: SITE_MY * ctx.H() / 2, n: siteNv(), fit: pageFit, px: window.innerWidth / 2, py: ctx.top() + ctx.H() / 2, ox: o.x, oy: o.y };
    }
    // super/site.js: drag the inner super's ring and the bubbles (and so their wires) go with it
    function moveSite(x, y, commit) {
      if (locked()) return "";
      siteOff = { x: Math.round(x), y: Math.round(y) };
      const t = "translate(" + siteOff.x + "px," + siteOff.y + "px)";
      placeBubblesLayer();   // the wires are drawn from where the bubbles are on screen, so they follow by themselves
      if (commit) store("orbit:site:offset", siteOff);
      return t;
    }
    // the bubbles' layer sits where the inner super is: its offset scales with the page's zoom (the inner
    // super is inside the main super, zoomed about the page's centre), so bubbles and super stay together
    function placeBubblesLayer() {
      const bb = $(".orbit-bubbles", ctx.stage); if (!bb) return;
      const f = pageFit || 1, o = offV(), t = (o.x * f).toFixed(2) + "px " + (o.y * f).toFixed(2) + "px";
      if (bb.style.translate !== t) bb.style.translate = t;
    }
    // the room the layout may use: inside the site's super at its usual n (π), so the frame fits the page
    function insideLoop(r) {
      const s = siteBox(), cy = ctx.H() / 2, n = s.n || Math.PI;      // the inner super's own n: near-box corners hold supers near its edge (owner, 2026-10-12)
      for (const x of [r.x - 2, r.x + r.w + 2]) for (const y of [r.y - 2, r.y + r.h + 2])
        if (seNorm(Math.abs(x - s.cx) / s.a, Math.abs(y - cy) / s.b, n) > 1) return false;
      return true;
    }
    return {
      merged, loopN, scrollN, pageLoop, resetView, viewChanged, drawMini, miniSweep, seNorm, zoomPage, measure, fitTo, setFit, needAt,
      keepWindowsIn, drawLoop, loopPoint, nearLoop, sweepPx, seatEdges, scrollSiteN, siteNv, siteBox, moveSite, winCap,
      placeBubblesLayer, insideLoop, compactSide, siteMargins,
      pageFit: () => pageFit, loopG: () => loopG, loopD: () => loopD, siteOff: () => offV(), zoom: () => zoomV(),
      pointerHeld: () => pointerHeld, siteN: () => siteN,
    };
  }
})();
