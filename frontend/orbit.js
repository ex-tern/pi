// orbit.js — the whole site as an orbit around the Pi Tech Lab mark.
//
// The mark sits in the middle of the screen on every page (drag it elsewhere;
// double-click brings it back). Every card of every section is a pill around
// it. Pills stay where they are put and never overlap: drag one and the others
// make room. Click one to expand it into a floating window that can be
// dragged, resized and maximised. The more a card is used, the larger its pill
// and the closer it sits to the mark. The mark's size follows what you do:
// large when nothing is open, stepping back as windows open, pulsing when one
// opens, spinning faster while the site is working.
//
// The cards are the app's own live elements, MOVED (never copied), so every
// listener, id and form in app.js, lab.js and the Lab keeps working. Opening a
// card also "opens" its section through the original (now hidden) tab button,
// because app.js and lab.js load data and start/stop the map and HAL-OS when a
// section opens.
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let onStore = () => {};                // set by the account sync below
  const store = (k, v) => {
    try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ }
    onStore();
  };
  const load = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (_) { return null; } };

  const SECTIONS = [
    { key: "assess", name: "Evaluate", panel: "tab-assess" },
    { key: "journal", name: "Explore", panel: "tab-journal" },
    { key: "analytics", name: "Envision", panel: "tab-analytics" },
    { key: "lab", name: "Lab", panel: "tab-lab" },
    { key: "diagram", name: "Architecture", panel: "tab-diagram" },
    { key: "account", name: "Account", panel: null },
  ];
  const FALLBACK_TITLES = {
    signInNotice: "Why sign in", profileCard: "Research profile", resultsSection: "Assessment results",
    historyCard: "Your assessments", ownerResetCard: "Reset platform", claimableCard: "piQ held for you",
  };

  // ------------------------------------------------------------ collect items
  const items = [];       // {key, section, title, nodes, content, bubble, panel, orbit}
  const shelf = document.createElement("div");
  shelf.id = "orbitShelf"; shelf.hidden = true;

  function cleanTitle(h) {
    if (!h) return "";
    const c = h.cloneNode(true);
    c.querySelectorAll(".help-btn, .pill, button, .count").forEach(x => x.remove());
    return c.textContent.replace(/\s+/g, " ").replace(/\?$/, "").trim();
  }
  function titleOf(nodes, fallbackKey) {
    for (const n of nodes) {
      if (n.id && FALLBACK_TITLES[n.id]) return FALLBACK_TITLES[n.id];
      const h = n.matches("h1,h2,h3,summary") ? n : n.querySelector("summary, h2, h3, .donate-title, .referral-title, .bug-title, h1");
      const t = cleanTitle(h);
      if (t) return t.length > 48 ? t.slice(0, 46) + "…" : t;
    }
    return fallbackKey;
  }
  function addItem(section, nodes, title) {
    if (!nodes.length) return;
    const content = document.createElement("div");
    content.className = "orbit-content";
    nodes.forEach(n => content.appendChild(n));
    const it = { section, nodes, content, title: title || titleOf(nodes, section.name) };
    it.key = section.key + ":" + it.title;   // stable across visits, for remembered positions
    shelf.appendChild(content);
    items.push(it);
    return it;
  }

  function collectSection(section) {
    const panel = document.getElementById(section.panel);
    if (!panel) return;
    let group = null;
    const flush = () => { if (group) { addItem(section, group.nodes, group.title); group = null; } };
    for (const el of [...panel.children]) {
      if (el.classList.contains("page-header") || el.classList.contains("lab-intro")) continue;
      if (el.classList.contains("buddy-float")) { addItem(section, [el], "ResBD"); continue; }
      if (el.classList.contains("section-heading")) { flush(); group = { title: cleanTitle(el), nodes: [el] }; continue; }
      if (group) {
        group.nodes.push(el);
        if (el.classList.contains("card") || el.id === "arcadeMessage") flush();
        continue;
      }
      if (el.classList.contains("two-col") || el.classList.contains("full-col")) {
        [...el.children].forEach(ch => addItem(section, [ch]));
        continue;
      }
      if (el.classList.contains("stats-bar")) { addItem(section, [el], "Key numbers"); continue; }
      addItem(section, [el], el.matches(".card:not(:has(h1,h2,h3))") && section.key === "diagram" ? "Overview" : undefined);
    }
    flush();
  }

  function collectAccount(section) {
    const side = $("#appSidebar");
    if (!side) return;
    const signIn = [];
    for (const el of [...side.children]) {
      if (el.classList.contains("brand") || el.tagName === "HR") continue;
      if (el.matches("details.sidebar-expander")) { el.open = true; addItem(section, [el]); continue; }
      if (el.matches(".bug-card")) { addItem(section, [el], "Contact us"); continue; }
      if (el.matches(".referral-card, .donate-card, .owner-danger")) { addItem(section, [el]); continue; }
      signIn.push(el);
    }
    addItem(section, signIn, "Your account");
    // the source link, as a pill like everything else
    const gh = $(".gh-fab");
    if (gh) items.push({ section: { key: "links", name: "Source" }, nodes: [], content: null, title: "GitHub", href: gh.href, key: "links:GitHub" });
  }

  // ------------------------------------------------------------ the stage
  const MARK_TRAIL = Array.from({ length: 30 }, (_, i) => {
    const k = i + 1;
    return '<g transform="rotate(' + (k * 1.25) + ' 200 200)" opacity="' + (0.30 * Math.pow(1 - k / 31, 1.8)).toFixed(3) + '">' +
      '<line class="om-r" x1="200" y1="200" x2="350" y2="200"/><line class="om-r" x1="200" y1="200" x2="50" y2="200"/></g>';
  }).join("");
  const stage = document.createElement("div");
  stage.className = "orbit-stage";
  stage.innerHTML =
    '<svg class="orbit-rings" aria-hidden="true"></svg>' +
    '<div class="orbit-center">' +
    '<h1 class="orbit-title" aria-label="Pi Tech Lab"><span class="ot-text" aria-hidden="true">Pi Tech Lab</span></h1>' +
    '<button type="button" class="orbit-core" aria-label="PiEn, the engine that learns how the site is used. Drag to move, scroll to resize, click to set windows aside">' +
    '<svg class="orbit-mark" viewBox="40 40 320 320" aria-hidden="true">' +
    '<circle class="om-circle" cx="200" cy="200" r="150"/>' +
    '<g class="om-sweep">' + MARK_TRAIL +
    '<line class="om-r om-main" x1="200" y1="200" x2="350" y2="200"/><line class="om-r om-main" x1="200" y1="200" x2="50" y2="200"/></g>' +
    '<text class="om-name" x="200" y="300" text-anchor="middle">PiEn</text></svg></button>' +
    '<div class="orbit-pi" aria-live="off" title="Drag to move; drag the corner to resize">' +
    '<span class="op-digits"></span><span class="op-count"></span><span class="op-grip" aria-hidden="true"></span></div></div>' +
    '<div class="orbit-bubbles" role="list" aria-label="Everything on Pi Tech Lab"></div>';

  // ------------------------------------------------------------ use: what you use grows
  // Each card keeps a score in this browser: opening it counts 1, moving it a
  // third. The score sets how prominent its pill is and how close to the mark
  // it sits.
  const useOf = it => load("orbit:use:" + it.key) || 0;
  function bumpUse(it, by) {
    it.use = Math.min(999, useOf(it) + by);
    store("orbit:use:" + it.key, Math.round(it.use * 100) / 100);
    // the pill grows on your next visit, so nothing shifts under your hand now
  }
  function setTier(it) {
    const u = it.use || 0;
    it.bubble.dataset.tier = u >= 8 ? 3 : u >= 3 ? 2 : u >= 1 ? 1 : 0;
    it.bubble.style.setProperty("--use", [1, 1.1, 1.22, 1.36][it.bubble.dataset.tier]);
  }

  // Every pill has its own look: a size, a typeface and a style, picked from
  // its name so it is the same on every visit (a pill that changed shape on
  // each reload would also change place).
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // Size says how much is behind a pill: the more complex the card (tools,
  // forms, the emulator, the map, tables, sheer content) the larger it is.
  // Measured from the card itself, remembered at its highest so a card whose
  // content loads later does not shrink back next time.
  function complexity(it) {
    if (it.href) return 0;
    let c = 0;
    for (const n of it.nodes) {
      if (!n.querySelectorAll) continue;
      c += n.querySelectorAll("iframe").length * 14;
      c += n.querySelectorAll("canvas, svg.arcade, #arcadeStage").length * 9;
      c += n.querySelectorAll("input:not([type=hidden]), select, textarea").length * 2;
      c += n.querySelectorAll("button").length * 0.8;
      c += n.querySelectorAll("table, .leaderboard, ul, ol").length * 1.5;
      c += (n.textContent || "").replace(/\s+/g, " ").length / 600;
    }
    if (it.nodes.some(n => n.id === "labHal" || n.id === "labQuvi")) c += 12;
    const best = Math.max(c, load("orbit:cx:" + it.key) || 0);
    store("orbit:cx:" + it.key, Math.round(best * 10) / 10);
    return best;
  }
  function setSizes() {
    // rank the cards by complexity; the size follows the rank, so the spread
    // is always the same however the numbers fall
    const ranked = items.map(it => [it, complexity(it)]).sort((a, b) => a[1] - b[1]);
    ranked.forEach(([it], i) => {
      const q = ranked.length > 1 ? i / (ranked.length - 1) : 0.5;
      it.q = q;
      it.bubble.style.setProperty("--pz", (0.84 + q * 0.5).toFixed(3));
    });
  }
  const FONTS = ["sans", "sans", "mono", "serif", "sans-light", "serif-italic"];
  const STYLES = ["outline", "ink", "soft", "dashed", "cobalt", "square", "underline", "outline"];
  function setLook(it) {
    const h = hash(it.key);
    const b = it.bubble;
    b.dataset.font = FONTS[(h >>> 4) % FONTS.length];
    b.dataset.look = STYLES[(h >>> 9) % STYLES.length];
  }

  // ------------------------------------------------------------ bubbles
  function makeBubbles() {
    const wrap = $(".orbit-bubbles", stage);
    items.forEach((it, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "orbit-bubble";
      b.dataset.section = it.section.key;
      b.dataset.key = it.key;
      b.setAttribute("role", "listitem");
      b.innerHTML = '<span class="ob-dot" aria-hidden="true"></span><span class="ob-label"></span>';
      b.querySelector(".ob-label").textContent = it.title;
      b.title = it.section.name + ": " + it.title;
      b.setAttribute("aria-label", it.section.name + ": " + it.title + ". Open");
      it.bubble = b;
      it.order = i;
      it.use = useOf(it);
      it.rank = it.use;                              // fixed for this visit
      setTier(it);
      setLook(it);
      if (it.href) { b.classList.add("is-link"); b.setAttribute("aria-label", it.title + " (opens in a new tab)"); }
      it.custom = load("orbit:at2:" + it.key);      // {fx, fy}: offset from the mark, as a share of the screen
      store("orbit:pos:" + it.key); store("orbit:at:" + it.key);   // older formats
      wireDrag(it);
      wrap.appendChild(b);
    });
  }

  function visible(it) {
    if (it.href) return true;
    return it.nodes.some(n => !(n.classList.contains("section-heading")) && !n.classList.contains("hidden") && !n.hidden);
  }

  // ------------------------------------------------------------ geometry
  // Nothing moves by itself. Pills get fixed places around the mark, chosen so
  // no two overlap and none covers the mark, its π line, the title or the
  // corner buttons. They only move when you move them, move the mark, or the
  // set of cards or the window size changes.
  let W = 0, H = 0, top = 0, R = 0, small = false;
  let lx = 0, ly = 0;                    // the mark's centre, in stage coordinates
  let logoAt = load("orbit:logo");       // {fx, fy}: where it was left, as a share of the screen
  let piBox = { w: 320, h: 48 };
  // sizes you choose: the logo and the π box each have their own
  let logoScale = load("orbit:logo:scale") || 1;
  let piScale = load("orbit:pi:scale") || 1;
  let piAt = load("orbit:pi:at");        // {fx, fy}: the π box's centre, once you have moved it
  const LOGO_MIN = 0.45, LOGO_MAX = 2.2, PI_MIN = 0.6, PI_MAX = 2.6;
  let draggingLogo = false;
  const GAP = () => (small ? 6 : 10);

  function idleR() {
    const base = Math.min(W, H);
    const r = Math.min(118, base * (small ? 0.15 : 0.16), H * 0.12) * logoScale;
    return Math.max(18, Math.min(r, base * 0.42));
  }
  function shownR() {
    const open = document.documentElement.classList.contains("orbit-open");
    if (!open) return R;
    // with a window open, the mark sizes to what is in front: small beside a
    // simple card, larger beside the emulator, the map or an assessment
    const front = items.filter(i => i.panel).sort((a, b) => b.panel.style.zIndex - a.panel.style.zIndex)[0];
    const q = front && front.q != null ? front.q : 0.5;
    return (small ? 16 + q * 26 : 20 + q * 50) * Math.min(1.4, logoScale);
  }

  // the title's band at the top, in stage coordinates
  function titleRect() {
    const t = $(".orbit-title");
    if (!t) return { x: 0, y: 0, w: 0, h: 0 };
    const b = t.getBoundingClientRect();
    const w = Math.max(b.width, titleBox.w), h = Math.max(b.height, titleBox.h);
    return { x: W / 2 - w / 2, y: b.top - top, w, h };
  }
  function clampLogo() {
    const m = R + 8, tr = titleRect();
    lx = Math.min(W - m, Math.max(m, lx));
    // below the title wherever the title is above it
    const clearTitle = lx + R > tr.x - 8 && lx - R < tr.x + tr.w + 8 ? tr.y + tr.h + 10 + R : m;
    ly = Math.min(H - m, Math.max(clearTitle, m, ly));
  }

  // The π box is its own thing: under the mark until you move it, then
  // wherever you left it. It never leaves the screen.
  function piCentre() {
    let x, y;
    if (piAt) { x = piAt.fx * W; y = piAt.fy * H; }
    else { x = lx; y = ly + R + 14 + piBox.h / 2; }
    x = Math.min(W - piBox.w / 2 - 4, Math.max(piBox.w / 2 + 4, x));
    y = Math.min(H - piBox.h / 2 - 4, Math.max(piBox.h / 2 + 4, y));
    // never on the mark or the title: the nearest spot clear of both
    const g = GAP();
    const fixed = [grow({ x: lx - R, y: ly - R, w: 2 * R, h: 2 * R }, g), grow(titleRect(), g)];
    const r0 = { x: x - piBox.w / 2, y: y - piBox.h / 2, w: piBox.w, h: piBox.h };
    if (!freeAt(r0, fixed)) {
      const r = nearestFree(x, y, piBox.w, piBox.h, fixed);
      if (r) { x = r.x + r.w / 2; y = r.y + r.h / 2; }
    }
    return [x, y];
  }
  function placeMark() {
    const r = shownR();
    const core = $(".orbit-core");
    core.style.width = core.style.height = r * 2 + "px";
    core.style.left = lx - r + "px";
    core.style.top = top + ly - r + "px";
    const pi = $(".orbit-pi");
    pi.style.setProperty("--pi-scale", piScale);
    const [px, py] = piCentre();
    pi.style.left = px + "px";
    pi.style.top = py + "px";            // the π box lives in the stage, under any windows
  }

  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const freeAt = (r, placed) => r.x >= 6 && r.y >= 6 && r.x + r.w <= W - 6 && r.y + r.h <= H - 6 && !placed.some(p => hit(r, p));
  function grow(r, g) { return { x: r.x - g, y: r.y - g, w: r.w + 2 * g, h: r.h + 2 * g }; }

  function obstacles() {
    const g = GAP();
    const out = [
      grow({ x: lx - R, y: ly - R, w: 2 * R, h: 2 * R }, g),
      grow((([x, y]) => ({ x: x - piBox.w / 2, y: y - piBox.h / 2, w: piBox.w, h: piBox.h }))(piCentre()), g),
    ];
    out.push(grow(titleRect(), g));
    document.querySelectorAll(".buddy-float").forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.width && b.height) out.push(grow({ x: b.left, y: b.top - top, w: b.width, h: b.height }, g));
    });
    return out;
  }

  // The nearest free spot to (x, y), searching outwards in a widening spiral.
  function nearestFree(x, y, w, h, placed) {
    for (let d = 0; d < Math.max(W, H); d += 6) {
      const steps = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 10));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const r = { x: x + d * Math.cos(a) - w / 2, y: y + d * Math.sin(a) - h / 2, w, h };
        if (freeAt(r, placed)) return r;
      }
    }
    return null;
  }

  let usedRings = [];
  let prio = load("orbit:prio") || [];   // most recently moved first
  let settlePushes = false;
  function keep(it) {
    it.custom = { fx: +((it.at.x + it.w / 2 - lx) / W).toFixed(4), fy: +((it.at.y + it.h / 2 - ly) / H).toFixed(4) };
    it.pushed = false;
    store("orbit:at2:" + it.key, it.custom);
  }
  // Re-place pills when something they avoid changes size: the experimental
  // banner fills in late (and may wrap), fonts arrive, the π line grows.
  const watched = new WeakSet();
  const ro = window.ResizeObserver ? new ResizeObserver(() => layoutSoon()) : null;
  function watch(el) { if (ro && el && !watched.has(el)) { watched.add(el); ro.observe(el); } }

  // Place every visible pill without overlap. Returns how many found no room.
  function placePills(vis, toKeep) {
    const g = GAP();
    const placed = obstacles();
    vis.forEach(it => { it.at = null; });
    // 1. Every pill that has a place keeps it. Only a pill whose place is taken
    //    (by one you just dropped, the mark, the π box, the screen edge) is
    //    pushed, to the nearest free spot. The last one you moved wins.
    const pri = it => { const i = prio.indexOf(it.key); return i < 0 ? 1e6 + it.order : i; };
    //    First every pill whose own spot is free settles there; then the ones
    //    that were sat on look for the nearest spot nobody is using.
    const settled = vis.filter(it => it.custom && it !== dragging).sort((a, b) => pri(a) - pri(b));
    const bumped = [];
    // the pill you just dropped gives way only to fixed things (mark, π box, title)
    if (settlePushes && settled.length && settled[0].key === prio[0]) {
      const it = settled.shift();
      const r = nearestFree(lx + it.custom.fx * W, ly + it.custom.fy * H, it.w, it.h, placed);
      it.at = r; if (r) { placed.push(grow(r, g / 2)); toKeep.add(it); }
    }
    settled.forEach(it => {
      const r = { x: lx + it.custom.fx * W - it.w / 2, y: ly + it.custom.fy * H - it.h / 2, w: it.w, h: it.h };
      if (freeAt(r, placed)) { it.at = r; it.pushed = false; placed.push(grow(r, g / 2)); }
      else bumped.push(it);
    });
    bumped.forEach(it => {
      const r = nearestFree(lx + it.custom.fx * W, ly + it.custom.fy * H, it.w, it.h, placed);
      it.at = r; it.pushed = !!r; if (r) placed.push(grow(r, g / 2));
    });
    // 2. the rest go round the mark on widening rings, most used first
    const auto = vis.filter(it => !it.custom && it !== dragging)
      .sort((a, b) => (b.rank || 0) - (a.rank || 0) || a.order - b.order);
    const ax = small ? 1.2 : 1.75;                 // pills are wide: rings are wider than tall
    const step = (small ? 26 : 36);
    const r0 = R + g + (small ? 14 : 20);
    let ang = -Math.PI / 2;
    usedRings = [];
    for (const it of auto) {
      it.at = null;
      for (let k = 0; k < 80 && !it.at; k++) {
        const ry = r0 + k * step, rx = ry * ax;
        const n = Math.max(12, Math.round((Math.PI * (rx + ry)) / 9));
        for (let j = 0; j < n; j++) {
          const a = ang + (j / n) * Math.PI * 2;
          const r = { x: lx + rx * Math.cos(a) - it.w / 2, y: ly + ry * Math.sin(a) - it.h / 2, w: it.w, h: it.h };
          if (freeAt(r, placed)) { it.at = r; ang = a; if (!usedRings.includes(k)) usedRings.push(k); break; }
        }
        if (it.at) { usedRings.ring = { r0, step, ax }; }
      }
      if (!it.at) it.at = nearestFree(lx, ly, it.w, it.h, placed);  // a very small screen: anywhere free
      if (it.at) { placed.push(grow(it.at, g / 2)); toKeep.add(it); }  // from now on this is its place
    }
    // a push from a pill you dropped is for keeps; one from the screen edge or a
    // passing mark is not, so the pill returns when there is room again
    if (settlePushes) vis.forEach(it => { if (it.pushed && it.at) toKeep.add(it); });
    return vis.filter(it => it !== dragging && !it.at).length;
  }

  function layout() {
    const bar = $(".channel-bar");
    watch(bar); watch($(".orbit-pi")); watch($(".orbit-title"));
    top = bar ? bar.offsetHeight : 0;
    stage.style.top = top + "px";
    document.documentElement.style.setProperty("--orbit-top", top + "px");
    W = window.innerWidth; H = window.innerHeight - top;
    small = W < 700;
    R = idleR();
    const pi = $(".orbit-pi");
    pi.style.setProperty("--pi-scale", piScale);
    if (pi.offsetWidth) piBox = { w: pi.offsetWidth, h: pi.offsetHeight };
    if (!draggingLogo) {
      if (logoAt) { lx = logoAt.fx * W; ly = logoAt.fy * H; }
      else { lx = W / 2; ly = H / 2 - (small ? 20 : 10); }
    }
    clampLogo();
    placeMark();

    items.forEach(it => { it.bubble.hidden = !visible(it); });
    const vis = items.filter(it => !it.bubble.hidden);
    vis.forEach(it => { it.w = it.bubble.offsetWidth || 120; it.h = it.bubble.offsetHeight || 32; });

    // Nothing may overlap, on any screen. If there is no room for every pill,
    // all pills shrink together a step at a time until they fit.
    let fitK = 1, missing = 0, toKeep;
    for (let tries = 0; tries < 9; tries++) {
      stage.style.setProperty("--pill-fit", fitK.toFixed(3));
      vis.forEach(it => { it.w = it.bubble.offsetWidth || 120; it.h = it.bubble.offsetHeight || 32; });
      toKeep = new Set();
      missing = placePills(vis, toKeep);
      if (!missing) break;
      fitK *= 0.88;
    }
    toKeep.forEach(it => keep(it));
    settlePushes = false;
    vis.forEach(it => {
      if (it === dragging) return;
      const r = it.at || { x: Math.min(W - it.w - 6, Math.max(6, lx - it.w / 2)), y: Math.min(H - it.h - 6, ly + R + piBox.h + 20), w: it.w, h: it.h };
      it.bubble.style.transform = "translate(" + r.x.toFixed(1) + "px," + r.y.toFixed(1) + "px)";
    });
    drawRings();
  }

  function drawRings() {
    const svg = $(".orbit-rings", stage);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    const ax = small ? 1.2 : 1.75, step = small ? 52 : 72, r0 = R + (small ? 26 : 34);
    svg.innerHTML = [0, 1, 2].map(k => {
      const ry = r0 + k * step;
      return '<ellipse cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" rx="' + (ry * ax).toFixed(1) + '" ry="' + ry.toFixed(1) + '"/>';
    }).join("");
  }

  let pendingLayout = false;
  function layoutSoon() {
    if (pendingLayout) return;
    pendingLayout = true;
    requestAnimationFrame(() => { pendingLayout = false; layout(); });
  }

  // ------------------------------------------------------------ drag + click
  let dragging = null;
  function wireDrag(it) {
    const b = it.bubble;
    let sx = 0, sy = 0, moved = false, ox = 0, oy = 0;
    b.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      sx = e.clientX; sy = e.clientY; moved = false;
      const r = b.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top;
      b.setPointerCapture(e.pointerId);
    });
    b.addEventListener("pointermove", e => {
      if (!b.hasPointerCapture(e.pointerId)) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
      moved = true; dragging = it; b.classList.add("dragging");
      const x = Math.min(W - it.w, Math.max(0, e.clientX - ox)), y = Math.min(H - it.h, Math.max(0, e.clientY - top - oy));
      b.style.transform = "translate(" + x + "px," + y + "px)";
    });
    const end = e => {
      if (!b.hasPointerCapture(e.pointerId)) return;
      b.releasePointerCapture(e.pointerId);
      b.classList.remove("dragging");
      if (!moved) return;                 // a click: handled by the click event
      const x = Math.min(W - it.w, Math.max(0, e.clientX - ox)) + it.w / 2;
      const y = Math.min(H - it.h, Math.max(0, e.clientY - top - oy)) + it.h / 2;
      it.custom = { fx: +((x - lx) / W).toFixed(4), fy: +((y - ly) / H).toFixed(4) };
      store("orbit:at2:" + it.key, it.custom);
      prio = [it.key, ...prio.filter(k => k !== it.key)];
      store("orbit:prio", prio);
      settlePushes = true;
      dragging = null;
      bumpUse(it, 1 / 3);
      layout();                            // it lands where dropped; only pills it lands on move aside
      b.dataset.justDragged = "1";
      setTimeout(() => delete b.dataset.justDragged, 0);
    };
    b.addEventListener("pointerup", end);
    b.addEventListener("pointercancel", end);
    b.addEventListener("click", () => { if (!b.dataset.justDragged) openItem(it); });
  }

  // The mark moves too; everything around it comes along.
  function wireLogo() {
    const core = $(".orbit-core");
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
    core.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      sx = e.clientX; sy = e.clientY; ox = e.clientX - lx; oy = e.clientY - top - ly; moved = false;
      core.setPointerCapture(e.pointerId);
      core.classList.add("pressed");
    });
    core.addEventListener("pointermove", e => {
      if (!core.hasPointerCapture(e.pointerId)) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
      if (!moved) { moved = true; draggingLogo = true; document.documentElement.classList.add("orbit-moving"); }
      lx = e.clientX - ox; ly = e.clientY - top - oy;
      clampLogo(); placeMark(); layoutSoon();
    });
    const end = e => {
      if (!core.hasPointerCapture(e.pointerId)) return;
      core.releasePointerCapture(e.pointerId);
      core.classList.remove("pressed");
      if (!moved) return;
      draggingLogo = false;
      document.documentElement.classList.remove("orbit-moving");
      logoAt = { fx: +(lx / W).toFixed(4), fy: +(ly / H).toFixed(4) };
      store("orbit:logo", logoAt);
      layout();
      core.dataset.justDragged = "1";
      setTimeout(() => delete core.dataset.justDragged, 0);
    };
    core.addEventListener("pointerup", end);
    core.addEventListener("pointercancel", end);
    // Windows never close. A click on the mark sets them all aside to show the
    // pills; another click (or opening any pill) brings them back.
    core.addEventListener("click", () => {
      if (core.dataset.justDragged) return;
      if (items.some(it => it.panel)) setAside(!document.documentElement.classList.contains("orbit-aside"));
      pulse();
    });
    // double-click: back to the middle, at the usual size
    core.addEventListener("dblclick", () => { logoAt = null; logoScale = 1; store("orbit:logo"); store("orbit:logo:scale"); layout(); });
    const setLogo = v => { logoScale = v; };
    wheelResize(core, () => logoScale, setLogo, LOGO_MIN, LOGO_MAX, "orbit:logo:scale");
  }

  // Resize by dragging a handle away from (or towards) the thing's centre,
  // or with the scroll wheel over it.
  function resizer(handle, centre, get, set, min, max, key) {
    let d0 = 0, s0 = 1;
    handle.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      const [x, y] = centre();
      d0 = Math.max(10, Math.hypot(e.clientX - x, e.clientY - top - y)); s0 = get();
      handle.setPointerCapture(e.pointerId);
      document.documentElement.classList.add("orbit-moving");
    });
    handle.addEventListener("pointermove", e => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      const [x, y] = centre();
      set(Math.min(max, Math.max(min, s0 * Math.hypot(e.clientX - x, e.clientY - top - y) / d0)));
      layoutSoon();
    });
    const end = e => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      handle.releasePointerCapture(e.pointerId);
      document.documentElement.classList.remove("orbit-moving");
      store(key, +get().toFixed(3)); layout();
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("keydown", e => {
      const k = { ArrowUp: 1.08, ArrowRight: 1.08, ArrowDown: 1 / 1.08, ArrowLeft: 1 / 1.08 }[e.key];
      if (!k) return;
      e.preventDefault(); set(Math.min(max, Math.max(min, get() * k))); store(key, +get().toFixed(3)); layout();
    });
  }
  function wheelResize(el, get, set, min, max, key) {
    let t;
    el.addEventListener("wheel", e => {
      e.preventDefault();
      set(Math.min(max, Math.max(min, get() * Math.exp(-e.deltaY * 0.0015))));
      layoutSoon();
      clearTimeout(t); t = setTimeout(() => store(key, +get().toFixed(3)), 300);
    }, { passive: false });
  }

  function wirePi() {
    const pi = $(".orbit-pi");
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
    pi.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest(".op-grip")) return;
      const [x, y] = piCentre();
      sx = e.clientX; sy = e.clientY; ox = e.clientX - x; oy = e.clientY - top - y; moved = false;
      pi.setPointerCapture(e.pointerId);
    });
    pi.addEventListener("pointermove", e => {
      if (!pi.hasPointerCapture(e.pointerId)) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
      if (!moved) { moved = true; pi.classList.add("dragging"); document.documentElement.classList.add("orbit-moving"); }
      piAt = { fx: (e.clientX - ox) / W, fy: (e.clientY - top - oy) / H };
      placeMark(); layoutSoon();
    });
    const end = e => {
      if (!pi.hasPointerCapture(e.pointerId)) return;
      pi.releasePointerCapture(e.pointerId);
      pi.classList.remove("dragging");
      document.documentElement.classList.remove("orbit-moving");
      if (!moved) return;
      const [x, y] = piCentre();
      piAt = { fx: +(x / W).toFixed(4), fy: +(y / H).toFixed(4) };
      store("orbit:pi:at", piAt); layout();
    };
    pi.addEventListener("pointerup", end);
    pi.addEventListener("pointercancel", end);
    // double-click: back under the mark, at the usual size
    pi.addEventListener("dblclick", () => { piAt = null; piScale = 1; store("orbit:pi:at"); store("orbit:pi:scale"); layout(); });
    resizer(pi.querySelector(".op-grip"), piCentre, () => piScale, v => { piScale = v; }, PI_MIN, PI_MAX, "orbit:pi:scale");
    wheelResize(pi, () => piScale, v => { piScale = v; }, PI_MIN, PI_MAX, "orbit:pi:scale");
  }

  function pulse() {
    const core = $(".orbit-core");
    core.classList.remove("pulse"); void core.offsetWidth; core.classList.add("pulse");
  }

  // ------------------------------------------------------------ windows
  let zTop = 300, openCount = 0;

  function activateSection(key) {
    if (key === "account") return;
    const btn = document.querySelector('.tab-btn[data-tab="' + key + '"]');
    if (btn && !btn.classList.contains("active")) btn.click();
    keepAlive();
  }
  // Opening one section's tab stops the others' live parts (the map, HAL-OS).
  // Anything still open on screen is started again.
  function keepAlive() {
    if (items.some(it => it.panel && it.nodes.some(n => n.id === "arcadeStage" || n.querySelector && n.querySelector("#arcadeStage"))) && window.ScholarPiArcade) {
      try { window.ScholarPiArcade.open(); } catch (_) { /* map unavailable */ }
    }
    const hal = items.find(it => it.panel && it.nodes.some(n => n.id === "labHal"));
    const frame = $("#halFrame");
    if (hal && frame && frame.contentWindow) frame.contentWindow.postMessage({ hal: "resume" }, location.origin);
  }

  function openItem(it) {
    if (!restoring) document.dispatchEvent(new CustomEvent("orbit:open", { detail: { key: it.key } }));
    if (it.href) { window.open(it.href, "_blank", "noopener"); bumpUse(it, 1); pulse(); return; }
    setAside(false);
    if (it.panel) { raise(it.panel, true); bumpUse(it, 1); pulse(); return; }
    activateSection(it.section.key);
    const p = document.createElement("section");
    p.className = "orbit-panel";
    p.setAttribute("role", "dialog");
    const hid = "op-" + Math.random().toString(36).slice(2);
    p.setAttribute("aria-labelledby", hid);
    p.innerHTML = '<header class="op-head"><span class="op-section"></span><h2 class="op-title"></h2></header><div class="op-body"></div>';
    p.querySelector(".op-section").textContent = it.section.name;
    const title = p.querySelector(".op-title"); title.id = hid; title.textContent = it.title;
    p.querySelector(".op-body").appendChild(it.content);
    document.body.appendChild(p);
    fit(it, p);
    centre(p);
    restoreWin(it, p);
    // content that loads later (lists, results) refits the window, until you resize it yourself
    if (window.ResizeObserver) {
      const ro2 = new ResizeObserver(() => {
        if (p.userSized || !p.isConnected) return;
        if (Math.abs(p.offsetWidth - p.fitW) > 2 || Math.abs(p.offsetHeight - p.fitH) > 2) { p.userSized = true; saveWinSoon(it, p); return; }
        const cx = p.offsetLeft + p.offsetWidth / 2, cy = p.offsetTop + p.offsetHeight / 2;
        fit(it, p);
        p.style.left = Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, cx - p.offsetWidth / 2)) + "px";
        p.style.top = Math.max(top + 8, Math.min(window.innerHeight - p.offsetHeight - 8, cy - p.offsetHeight / 2)) + "px";
      });
      ro2.observe(it.content);
      // a window you resize keeps that size
      new ResizeObserver(() => { if (p.userSized) saveWinSoon(it, p); }).observe(p);
    }
    it.panel = p; openCount++;
    document.documentElement.classList.add("orbit-open");
    it.bubble.classList.add("is-open");
    front(p);
    wirePanel(it, p);
    if (it.nodes.some(n => n.id === "labHal")) setTimeout(keepAlive, 300);
    if (!restoring) bumpUse(it, 1);
    pulse();
    placeMark();
    rememberOpen();
  }

  // A window is as big as what is in it: narrow for a few lines, wide for a
  // tool (the emulator, the map, tables), and only as tall as its content.
  function fit(it, p) {
    const sm = window.innerWidth < 700;
    const H0 = window.innerHeight - top;
    const wide = it.content.querySelector("iframe, canvas, #arcadeStage, table, .leaderboard");
    const q = it.q != null ? it.q : 0.5;
    const maxW = sm ? window.innerWidth - 20 : Math.min(window.innerWidth - 32, wide ? 960 : 440 + q * 380);
    const maxH = sm ? H0 * 0.86 : H0 - 48;
    p.style.height = "auto";
    p.style.width = "max-content";
    let w = Math.min(maxW, Math.max(sm ? 0 : 320, p.offsetWidth));
    if (wide || sm) w = maxW;
    p.style.width = w + "px";
    const body = p.querySelector(".op-body"), head = p.querySelector(".op-head");
    const h = Math.max(140, Math.min(maxH, head.offsetHeight + body.scrollHeight + 2));
    p.style.height = h + "px";
    p.fitW = p.offsetWidth; p.fitH = p.offsetHeight;
  }

  // Bring a window to the front and, when asked, glide it to the centre.
  function centre(p) {
    const w = p.offsetWidth, h = p.offsetHeight;
    p.style.left = Math.max(8, (window.innerWidth - w) / 2) + "px";
    p.style.top = Math.max(top + 8, top + (window.innerHeight - top - h) / 2) + "px";
  }
  function raise(p, toCentre) {
    front(p);
    if (toCentre) {
      p.classList.add("gliding");
      centre(p);
      clearTimeout(p.glide); p.glide = setTimeout(() => { p.classList.remove("gliding"); if (p.item) saveWin(p.item, p); }, 420);
    }
    rememberOpen();
  }
  function setAside(on) {
    document.documentElement.classList.toggle("orbit-aside", on && items.some(it => it.panel));
  }
  // Open windows are remembered, in their stacking order, and come back on the next visit.
  let restoring = false;
  function rememberOpen() {
    if (restoring) return;
    store("orbit:open", items.filter(i => i.panel).sort((a, b) => a.panel.style.zIndex - b.panel.style.zIndex).map(i => i.key));
  }

  function closeItem(it) {
    if (!it.panel) return;
    shelf.appendChild(it.content);
    it.panel.remove(); it.panel = null; openCount--;
    it.bubble.classList.remove("is-open");
    if (it.nodes.some(n => n.id === "labHal")) { const f = $("#halFrame"); if (f && f.contentWindow) f.contentWindow.postMessage({ hal: "pause" }, location.origin); }
    if (it.nodes.some(n => n.id === "arcadeStage" || (n.querySelector && n.querySelector("#arcadeStage"))) && window.ScholarPiArcade) {
      try { window.ScholarPiArcade.exit(); } catch (_) { /* fine */ }
    }
    if (!openCount) document.documentElement.classList.remove("orbit-open");
    placeMark();
    it.bubble.focus({ preventScroll: true });
  }

  // Windows stack between 300 and 900, always under the site's dialogs (1000).
  function front(p) {
    if (zTop >= 900) {
      const open = items.filter(i => i.panel).sort((a, b) => a.panel.style.zIndex - b.panel.style.zIndex);
      zTop = 300; open.forEach(i => { i.panel.style.zIndex = ++zTop; });
    }
    p.style.zIndex = ++zTop;
    placeMark();
  }

  // Each window's place and (once you have resized it) size are remembered.
  function saveWin(it, p) {
    if (!p.isConnected) return;
    store("orbit:win:" + it.key, {
      fx: +(p.offsetLeft / window.innerWidth).toFixed(4),
      fy: +((p.offsetTop - top) / Math.max(1, window.innerHeight - top)).toFixed(4),
      w: p.userSized ? p.offsetWidth : 0, h: p.userSized ? p.offsetHeight : 0,
    });
  }
  function saveWinSoon(it, p) { clearTimeout(p.saveT); p.saveT = setTimeout(() => saveWin(it, p), 500); }
  function restoreWin(it, p) {
    const ws = load("orbit:win:" + it.key);
    if (!ws) return;
    if (ws.w && ws.h) {
      p.style.width = Math.min(ws.w, window.innerWidth - 16) + "px";
      p.style.height = Math.min(ws.h, window.innerHeight - top - 16) + "px";
      p.userSized = true;
    }
    p.style.left = Math.max(8 - p.offsetWidth + 120, Math.min(window.innerWidth - 80, ws.fx * window.innerWidth)) + "px";
    p.style.top = Math.max(top, Math.min(window.innerHeight - 48, top + ws.fy * (window.innerHeight - top))) + "px";
  }

  function wirePanel(it, p) {
    p.item = it;
    const head = p.querySelector(".op-head");
    let sx, sy, px, py, drag = false;
    // a click on a window behind brings it to the front and the centre
    let wasTop = true, cx0 = 0, cy0 = 0;
    p.tabIndex = -1;
    p.addEventListener("pointerdown", e => {
      wasTop = +p.style.zIndex === zTop; cx0 = e.clientX; cy0 = e.clientY;
      front(p);
    });
    p.addEventListener("pointerup", e => {
      if (!wasTop && Math.hypot(e.clientX - cx0, e.clientY - cy0) < 6) raise(p, true);
    });
    head.addEventListener("pointerdown", e => {
      drag = true; sx = e.clientX; sy = e.clientY; px = p.offsetLeft; py = p.offsetTop;
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener("pointermove", e => {
      if (!drag) return;
      p.style.left = Math.min(window.innerWidth - 80, Math.max(-p.offsetWidth + 120, px + e.clientX - sx)) + "px";
      p.style.top = Math.min(window.innerHeight - 48, Math.max(top, py + e.clientY - sy)) + "px";
    });
    head.addEventListener("pointerup", () => { if (drag) saveWin(it, p); drag = false; });
  }

  // ------------------------------------------------------------ busy: the mark spins faster
  let inflight = 0;
  const rawFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    let slow = false;
    const timer = setTimeout(() => { slow = true; inflight++; document.documentElement.classList.add("orbit-busy"); }, 450);
    const done = () => {
      clearTimeout(timer);
      if (slow) { inflight--; if (inflight <= 0) { inflight = 0; document.documentElement.classList.remove("orbit-busy"); } }
    };
    return rawFetch(input, init).then(r => { done(); return r; }, e => { done(); throw e; });
  };

  // ------------------------------------------------------------ π, live
  // Digits arrive from a worker (pi-worker.js) for as long as the page is open.
  function startPi() {
    const out = $(".op-digits"), cnt = $(".op-count");
    let digits = "", pending = false;
    const show = () => {
      pending = false;
      const after = digits.slice(1);
      const tail = after.length <= 34 ? after : after.slice(-30);
      const lead = after.length <= 34 ? "" : after.slice(0, 5) + " … ";
      out.innerHTML = "";
      out.append("π = 3." + lead + tail.slice(0, -1));
      const b = document.createElement("b"); b.textContent = tail.slice(-1); out.append(b);
      cnt.textContent = (digits.length - 1).toLocaleString() + " decimals and counting";
    };
    try {
      const w = new Worker("pi-worker.js");
      w.onmessage = e => {
        digits += e.data.digit;
        if (!pending) { pending = true; requestAnimationFrame(show); }
      };
    } catch (_) {
      out.textContent = "π = 3.14159 26535 89793 23846";
    }
  }

  // ------------------------------------------------------------ the name, in many languages
  // "Pi Tech Lab" sits at the top in the middle and, every half minute to three
  // minutes, quietly turns into another language. The pills keep clear of the
  // widest of them, so a change of language never moves anything.
  const TITLES = [
    ["en", "Pi Tech Lab", "English"],
    ["it", "Laboratorio Tecnologico Pi", "Italiano"],
    ["es", "Laboratorio Tecnológico Pi", "Español"],
    ["fr", "Laboratoire technologique Pi", "Français"],
    ["de", "Pi Technologielabor", "Deutsch"],
    ["pt", "Laboratório de Tecnologia Pi", "Português"],
    ["nl", "Pi Technologielab", "Nederlands"],
    ["sv", "Pi Teknologilabb", "Svenska"],
    ["fi", "Pi-teknologialaboratorio", "Suomi"],
    ["pl", "Laboratorium Technologiczne Pi", "Polski"],
    ["cs", "Technologická laboratoř Pí", "Čeština"],
    ["hu", "Pi Technológiai Labor", "Magyar"],
    ["ro", "Laboratorul Tehnologic Pi", "Română"],
    ["el", "Τεχνολογικό Εργαστήριο Πι", "Ελληνικά"],
    ["ru", "Технологическая лаборатория Пи", "Русский"],
    ["uk", "Технологічна лабораторія Пі", "Українська"],
    ["tr", "Pi Teknoloji Laboratuvarı", "Türkçe"],
    ["az", "Pi Texnologiya Laboratoriyası", "Azərbaycanca"],
    ["fa", "آزمایشگاه فناوری پای", "فارسی", "rtl"],
    ["ar", "مختبر باي للتقنية", "العربية", "rtl"],
    ["he", "מעבדת הטכנולוגיה פאי", "עברית", "rtl"],
    ["hi", "पाई टेक लैब", "हिन्दी"],
    ["bn", "পাই প্রযুক্তি গবেষণাগার", "বাংলা"],
    ["th", "ห้องปฏิบัติการเทคโนโลยีพาย", "ไทย"],
    ["vi", "Phòng thí nghiệm Công nghệ Pi", "Tiếng Việt"],
    ["id", "Laboratorium Teknologi Pi", "Bahasa Indonesia"],
    ["sw", "Maabara ya Teknolojia ya Pi", "Kiswahili"],
    ["zh", "派科技实验室", "中文"],
    ["ja", "パイ・テック・ラボ", "日本語"],
    ["ko", "파이 테크 랩", "한국어"],
    ["eo", "Pi-Teknologia Laboratorio", "Esperanto"],
    ["la", "Officina Technologica Pi", "Latina"],
  ];
  let titleBox = { w: 0, h: 0 }, titleIdx = 0;
  // Each name gets the largest size up to the title's own that fits the screen.
  function fitTitleSize(text, lang) {
    const t = $(".orbit-title");
    const probe = document.createElement("span");
    probe.className = "ot-probe"; probe.lang = lang; probe.textContent = text;
    t.appendChild(probe);
    const w = probe.offsetWidth, h = probe.offsetHeight;
    probe.remove();
    const avail = Math.max(120, window.innerWidth - 32);
    return { scale: Math.min(1, avail / Math.max(1, w)), w: Math.min(w, avail), h };
  }
  function measureTitles() {
    let w = 0, h = 0;
    TITLES.forEach(([lang, text]) => { const m = fitTitleSize(text, lang); w = Math.max(w, m.w); h = Math.max(h, m.h * m.scale); });
    titleBox = { w, h };
  }
  function showTitle(i, animate) {
    titleIdx = i;
    const [lang, text, name, dir] = TITLES[i];
    const span = $(".ot-text");
    const apply = () => {
      const m = fitTitleSize(text, lang);
      span.lang = lang; span.dir = dir || "ltr"; span.textContent = text;
      span.style.fontSize = m.scale < 1 ? "calc(1em * " + m.scale.toFixed(3) + ")" : "";
      $(".orbit-title").title = name;
      span.classList.remove("ot-out");
    };
    if (!animate || reduceMotion.matches) { apply(); return; }
    span.classList.add("ot-out");
    setTimeout(apply, 450);
  }
  function nextTitleLater() {
    const ms = 30000 + Math.random() * 150000;          // half a minute to three minutes
    setTimeout(() => {
      let i;
      do { i = Math.floor(Math.random() * TITLES.length); } while (i === titleIdx);
      showTitle(i, true);
      nextTitleLater();
    }, ms);
  }

  // ------------------------------------------------------------ your account keeps your layout
  // Signed in, the whole layout (every "orbit:" key: pills, the mark, the π box,
  // open windows and their places and sizes, use) is saved to your account a
  // moment after each change, and loaded when you sign in on any device.
  // Signed out, it stays in this browser only.
  const token = () => { try { return localStorage.getItem("sp_token") || ""; } catch (_) { return ""; } };
  function snapshot() {
    const o = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("orbit:")) o[k] = localStorage.getItem(k);
      }
    } catch (_) { /* private mode */ }
    return o;
  }
  let syncedFor = "", applying = false, pulling = false, saveT = 0;
  function saveSoon() {
    if (applying || !token() || syncedFor !== token()) return;
    if (pulling) return;                  // never write before the account's layout has been read
    clearTimeout(saveT); saveT = setTimeout(saveNow, 1200);
  }
  function saveNow() {
    if (!token() || syncedFor !== token() || pulling) return;
    fetch("/api/me/layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: snapshot() }) })
      .catch(() => { /* offline: the next change tries again */ });
  }
  async function pull() {
    const t = token();
    if (!t) { syncedFor = ""; return; }
    if (syncedFor === t) return;
    syncedFor = t;
    pulling = true;
    try {
      const r = await fetch("/api/me/layout");
      if (!r.ok) { if (r.status !== 401) syncedFor = ""; return; }
      const d = await r.json();
      if (d.layout && Object.keys(d.layout).length) applyLayout(d.layout);
      else { pulling = false; saveNow(); }  // first time signed in: this browser's layout becomes the account's
    } catch (_) { syncedFor = ""; }
    finally { pulling = false; }
  }
  function applyLayout(lay) {
    applying = true;
    try {
      Object.keys(snapshot()).forEach(k => localStorage.removeItem(k));
      Object.entries(lay).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (_) { /* private mode */ }
    logoAt = load("orbit:logo");
    logoScale = load("orbit:logo:scale") || 1;
    piAt = load("orbit:pi:at");
    piScale = load("orbit:pi:scale") || 1;
    prio = load("orbit:prio") || [];
    items.forEach(it => { it.custom = load("orbit:at2:" + it.key); it.use = useOf(it); it.rank = it.use; setTier(it); });
    setSizes();
    layout();
    // windows: open what the account has open, in its order, at its places
    const want = (load("orbit:open") || []).map(k => items.find(x => x.key === k && visible(x))).filter(Boolean);
    restoring = true;
    want.forEach(it => {
      if (!it.panel) openItem(it);
      else { fit(it, it.panel); centre(it.panel); it.panel.userSized = false; restoreWin(it, it.panel); front(it.panel); }
    });
    restoring = false;
    applying = false;
    rememberOpen();
  }
  onStore = saveSoon;

  // ------------------------------------------------------------ start
  function start() {
    SECTIONS.forEach(s => (s.panel ? collectSection(s) : collectAccount(s)));
    document.body.appendChild(shelf);
    document.body.appendChild(stage);
    // The mark stays above every open window: always in view, always the way home.
    const center = $(".orbit-center", stage);
    document.body.appendChild(center);
    stage.center = center;
    stage.appendChild($(".orbit-pi", center));
    document.documentElement.classList.add("orbit-on");
    makeBubbles();
    setSizes();
    wireLogo();
    wirePi();
    // Cards appear and disappear as app.js decides (sign-in, owner panels,
    // results): keep the orbit in step.
    const mo = new MutationObserver(() => { clearTimeout(start.t); start.t = setTimeout(layout, 120); });
    items.forEach(it => it.nodes.forEach(n => mo.observe(n, { attributes: true, attributeFilter: ["class", "hidden"] })));
    window.addEventListener("resize", () => { clearTimeout(start.r); start.r = setTimeout(layout, 80); });
    new MutationObserver(() => { if ($(".channel-bar") && !watched.has($(".channel-bar"))) layoutSoon(); })
      .observe(document.body, { childList: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layoutSoon());
    // Deep links (/#lab, /#journal …) open that section's first card.
    const fromHash = () => {
      const key = (location.hash || "").slice(1);
      const it = items.find(x => x.section.key === key && visible(x));
      if (it) openItem(it);
    };
    window.addEventListener("hashchange", fromHash);
    layout();
    setTimeout(layout, 600);              // after fonts and app.js's first render
    setTimeout(layout, 2000);
    // windows open last time open again, in the same order
    const reopen = (load("orbit:open") || []).map(k => items.find(x => x.key === k && visible(x))).filter(Boolean);
    if (reopen.length) setTimeout(() => {
      restoring = true;
      reopen.forEach(it => { if (!it.panel) openItem(it); });
      restoring = false;
      rememberOpen();
      if (location.hash) fromHash();
    }, 350);
    else if (location.hash) setTimeout(fromHash, 300);
    requestAnimationFrame(() => document.documentElement.classList.add("orbit-ready"));
    startPi();
    document.dispatchEvent(new CustomEvent("orbit:ready"));
    measureTitles(); showTitle(0, false); nextTitleLater();
    window.addEventListener("resize", () => { measureTitles(); showTitle(titleIdx, false); layoutSoon(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measureTitles(); layoutSoon(); });
    // sign-in happens in app.js; notice it (and sign-out) without coupling to it
    setTimeout(pull, 500);
    setInterval(pull, 2500);
    window.addEventListener("storage", e => { if (e.key === "sp_token") pull(); });
    window.PiOrbit = { store, load, visibleKeys: () => items.filter(i => !i.bubble.hidden).map(i => i.key), title: i => showTitle(i, false), titles: TITLES.length, aside: setAside, open: key => { const it = items.find(x => x.section.key === key && visible(x)); if (it) openItem(it); }, layout };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
