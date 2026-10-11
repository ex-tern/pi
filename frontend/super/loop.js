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
    let markN = load("orbit:mark:n");
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
      const nn = Math.min(N_MAX, Math.max(N_MIN, (scrollN.to || loopN()) * Math.exp(-dy * 0.002)));
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
    const CONTAIN = ".orbit-bubble, .orbit-title, .orbit-pi, .lv-palette, .live-tab, .live-dock.open .live-body, .lv-node";
    let loopG = { cx: 0, cy: 0, a: 1, b: 1, n: Math.PI }, loopKey = "";
    // r ↦ (u^n + v^n)^(1/n), safely for any n
    const seNorm = (u, v, n) => { const m = Math.max(u, v); return m ? m * Math.pow(Math.pow(u / m, n) + Math.pow(v / m, n), 1 / n) : 0; };
    // Everything stays inside the mark. When the mark, grown to the display, still cannot hold
    // the page (a small n, a star), the page shrinks toward the centre until it does.
    const FIT = ".orbit-bubbles, .orbit-title, .orbit-pi, .lv-palette, .live-dock";   // nodes scale themselves (super/nodes.js place), from a pivot that moves with them   // wire layers are drawn from what is on screen, so they are not scaled
    let pageFit = 1;
    // zooming inside the main loop scales everything in it (orbit:zoom); the fit above keeps it inside the loop
    // the superellipse look starts zoomed out: the site a small super in the middle of the main one
    let zoom = Math.max(0.25, Math.min(3, +load("orbit:zoom") || (document.documentElement.classList.contains("shape-se") ? 0.5 : 1))), zoomT;
    let zoomTo = null;
    function zoomPage(k) {
      const target = Math.max(0.25, Math.min(3, (zoomTo == null ? zoom : zoomTo) * k));
      zoomTo = target;
      clearTimeout(zoomT); zoomT = setTimeout(() => { store("orbit:zoom", +target.toFixed(3)); zoomTo = null; }, 400);
      if (window.SeMotion) { const s = { v: zoom }; window.SeMotion.glide("page:zoom", s, "v", target, 160, () => { zoom = s.v; loopKey = ""; drawLoop(); }); }
      else { zoom = target; loopKey = ""; drawLoop(); }
    }
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
        const k = (siteEl(el) || el.closest(".orbit-bubbles")) ? f : fitOther;
        for (const x of [r.left - 6, r.right + 6]) for (const y of [r.top - 6, r.bottom + 6])
          corners.push([px + (x - px) / k, py + (y - py) / k]);
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
    function needAt(n) {
      const Wv = window.innerWidth, A = LOOP_M * Wv / 2, B = LOOP_M * ctx.H() / 2, cx = Wv / 2, cy = ctx.top() + ctx.H() / 2;
      if (!corners.length || performance.now() - measuredAt > 400) measure();
      let need = 0;
      for (const [x, y] of corners) need = Math.max(need, seNorm(Math.abs(x - cx) / A, Math.abs(y - cy) / B, n));
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
      if (!merged() || pointerHeld || !loopG.a) return;
      const sb = siteBox(), f = sb.fit || 1, pad = 6;
      const cx = sb.px + (sb.cx - sb.px) * f, cy = sb.py + (sb.cy - sb.py) * f, a = sb.a * f, b = sb.b * f, n = sb.n;
      const fits = (l, t, w, h) => [l - pad, l + w + pad].every(x => [t - pad, t + h + pad].every(y => seNorm(Math.abs(x - cx) / a, Math.abs(y - cy) / b, n) <= 1));
      document.querySelectorAll(".orbit-panel").forEach(p => {
        if (p.classList.contains("gliding") || p.classList.contains("leaving")) return;
        const r = p.getBoundingClientRect();
        if (!r.width || (fits(r.left, r.top, r.width, r.height) && r.width <= a * 1.1 + 1 && r.height <= b * 1.3 + 1)) return;
        let w = r.width, h = r.height;
        const k = Math.min(1, a * 1.1 / w, b * 1.3 / h);                   // no more than about half the inner super: the bubbles keep their room
        if (k < 1) { w = Math.max(200, Math.floor(w * k)); h = Math.max(120, Math.floor(h * k)); p.style.width = w + "px"; p.style.height = h + "px"; }
        if (!fits(cx - w / 2, cy - h / 2, w, h)) {                          // too big even in the middle: smaller
          let lo = 0.2, hi = 1;
          for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (fits(cx - w * m / 2, cy - h * m / 2, w * m, h * m)) lo = m; else hi = m; }
          w = Math.max(200, Math.floor(w * lo)); h = Math.max(120, Math.floor(h * lo));
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
    // nothing overlaps: windows push each other apart along the shorter way, step away from the nodes
    // (a node is where you put it and stays), and when there is no room for all of them inside the
    // inner super they all get a little smaller together, as the pills do, until there is
    function separateWindows(fits) {
      const GAP = 10, MIN_W = 200, MIN_H = 120;
      const wins = [...document.querySelectorAll(".orbit-panel")].filter(p => !p.classList.contains("gliding") && !p.classList.contains("leaving"));
      if (!wins.length) return;
      const nodes = [...document.querySelectorAll(".lv-node")].filter(n => !n.classList.contains("is-dragging")).map(n => n.getBoundingClientRect())
        .map(r => ({ left: r.left, top: r.top, width: r.width, height: r.height }));
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
            for (const nd of nodes) if (overlap(rs[i], nd)) {                 // off a node, as far as the inner super allows
              const way = push(rs[i], nd).find(d => ok(moved(rs[i], d, 1)));
              if (way) { rs[i] = moved(rs[i], way, 1); any = true; }
            }
            for (let j = i + 1; j < rs.length; j++) if (overlap(rs[i], rs[j])) {
              const ways = push(rs[i], rs[j]);
              let done = false;
              for (const d of ways) {                                         // half each, or all of it on the one that can
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
        clean = !rs.some((r, i) => nodes.some(nd => overlap(r, nd)) || rs.some((q, j) => j > i && overlap(r, q)));
        if (!clean) {                                                         // no room: all of them a little smaller
          const next = rs.map(r => { const w = Math.max(MIN_W, Math.floor(r.width * 0.9)), h = Math.max(MIN_H, Math.floor(r.height * 0.9));
            return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h }; });
          if (next.every((r, i) => r.width === rs[i].width && r.height === rs[i].height)) break;
          rs = next;
        }
      }
      wins.forEach((p, i) => {
        const r = rs[i], cur = p.getBoundingClientRect();
        if (Math.abs(r.left - cur.left) < 1 && Math.abs(r.top - cur.top) < 1 && Math.abs(r.width - cur.width) < 1 && Math.abs(r.height - cur.height) < 1) return;
        p.style.left = Math.round(r.left) + "px"; p.style.top = Math.round(r.top) + "px";
        p.style.width = Math.round(r.width) + "px"; p.style.height = Math.round(r.height) + "px";
        if (p.item) ctx.saveWin(p.item, p);
      });
    }
    function drawLoop() {
      if (!pageLoop()) { setFit(1, 1); if (merged()) drawMini(); return; }
      const Wv = window.innerWidth, Hv = ctx.H(), n = loopN();
      const A = LOOP_M * Wv / 2, B = LOOP_M * Hv / 2, cx = Wv / 2, cy = ctx.top() + Hv / 2;
      const need = needAt(n);
      // no padding: the loop always reaches the display's edges (its a×b box is the screen, less its stroke)
      const cap = (1 - 4 / Math.min(Wv, Hv)) / LOOP_M;
      const sc = cap;
      const room = need > 0 ? cap / need * 0.985 : zoom;                 // the largest scale that still fits inside the loop
      fitTo(Math.max(0.005, Math.min(zoom, room)), Math.max(0.005, Math.min(1, room)), cx, cy);
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
        const off = ((((deg / 8) % 360) + 360) % 360 / 720 * 100).toFixed(1) + "%";
        if (off !== sweepPx.last) { sweepPx.last = off; tp.setAttribute("startOffset", off); }   // a tenth of a percent at a time: a few times a second, not every frame
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
    function seatEdges() {
      if (!merged()) return;
      const Wv = window.innerWidth, A = LOOP_M * Wv / 2, B = LOOP_M * ctx.H() / 2, cx = Wv / 2, cy = ctx.top() + ctx.H() / 2, root = document.documentElement.style;
      const fits = (l, t, r, b) => [l - 6, r + 6].every(x => [t - 6, b + 6].every(y => seNorm(Math.abs(x - cx) / A, Math.abs(y - cy) / B, Math.PI) <= 1));
      const title = $(".orbit-title");
      if (title && title.offsetWidth) {
        const tr = title.getBoundingClientRect(), h = tr.height;    // centred over the ctx.stage, not the screen
        for (let y = 8; y < ctx.H() / 3; y += 2) if (fits(tr.left, ctx.top() + y, tr.right, ctx.top() + y + h)) { root.setProperty("--se-title-top", y + "px"); break; }
      }
      const pal = $(".lv-palette");
      if (pal && pal.offsetWidth) {
        const w = pal.offsetWidth, h = pal.offsetHeight;
        for (let k = 0.01; k < 0.45; k += 0.004) {
          const l = k * Wv, bt = k * ctx.H();
          if (fits(l, ctx.top() + ctx.H() - bt - h, l + w, ctx.top() + ctx.H() - bt)) { root.setProperty("--se-pal-left", Math.round(l) + "px"); root.setProperty("--se-pal-bottom", Math.round(bt) + "px"); break; }
        }
      }
      const live = $(".live-dock.open .live-body");
      if (live && live.offsetWidth) {
        const w = live.offsetWidth, rr = Math.round(Wv * 0.06);
        for (let m = 0.02 * ctx.H(); m < ctx.H() / 3; m += 4) if (fits(Wv - rr - w, ctx.top() + m, Wv - rr, ctx.top() + ctx.H() - m)) { root.setProperty("--se-live-m", Math.round(m) + "px"); break; }
      }
    }
    // The site's super (super/site.js draws it): an inner superellipse the bubbles are laid out in, with the
    // same n as the main loop; the lattice lines from its ports run across the gap to the main loop.
    const SITE_MX = 0.86, SITE_MY = 0.8;
    let siteOff = load("orbit:site:offset") || { x: 0, y: 0 };
    if (typeof siteOff.x !== "number" || typeof siteOff.y !== "number") siteOff = { x: 0, y: 0 };
    // the inner super's n: the main loop's until shift + scroll inside it (on nothing) gives it one of its
    // own (super/scroll.js), kept as orbit:site:n; from then on the two change shape independently
    let siteN = +load("orbit:site:n") || 0;
    const siteNv = () => siteN || loopN();
    function scrollSiteN(e) {
      if (!merged()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const dy = e.deltaY || e.deltaX;
      const nn = Math.min(N_MAX, Math.max(N_MIN, (scrollSiteN.to || siteNv()) * Math.exp(-dy * 0.002)));
      scrollSiteN.to = nn;
      if (window.SeMotion) { const s = { v: siteNv() }; window.SeMotion.glide("site:n", s, "v", nn, 160, () => { siteN = s.v; }); }
      else siteN = nn;
      clearTimeout(scrollSiteN.t);
      scrollSiteN.t = setTimeout(() => { scrollSiteN.to = null; store("orbit:site:n", +siteN.toPrecision(5)); }, 900);
    }
    function siteBox() {
      const w = ctx.vw();
      return { cx: w / 2 + siteOff.x, cy: ctx.top() + ctx.H() / 2 + siteOff.y, a: SITE_MX * w / 2, b: SITE_MY * ctx.H() / 2, n: siteNv(), fit: pageFit, px: window.innerWidth / 2, py: ctx.top() + ctx.H() / 2, ox: siteOff.x, oy: siteOff.y };
    }
    // super/site.js: drag the inner super's ring and the bubbles (and so their wires) go with it
    function moveSite(x, y, commit) {
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
      const f = pageFit || 1, t = (siteOff.x * f).toFixed(2) + "px " + (siteOff.y * f).toFixed(2) + "px";
      if (bb.style.translate !== t) bb.style.translate = t;
    }
    // the room the layout may use: inside the site's super at its usual n (π), so the frame fits the page
    function insideLoop(r) {
      const s = siteBox(), cy = ctx.H() / 2, n = Math.PI;
      for (const x of [r.x - 6, r.x + r.w + 6]) for (const y of [r.y - 6, r.y + r.h + 6])
        if (seNorm(Math.abs(x - s.cx) / s.a, Math.abs(y - cy) / s.b, n) > 1) return false;
      return true;
    }
    return {
      merged, loopN, scrollN, pageLoop, drawMini, miniSweep, seNorm, zoomPage, measure, fitTo, setFit, needAt,
      keepWindowsIn, drawLoop, loopPoint, nearLoop, sweepPx, seatEdges, scrollSiteN, siteNv, siteBox, moveSite,
      placeBubblesLayer, insideLoop,
      pageFit: () => pageFit, loopG: () => loopG, loopD: () => loopD, siteOff: () => siteOff, zoom: () => zoom,
      pointerHeld: () => pointerHeld, siteN: () => siteN,
    };
  }
})();
