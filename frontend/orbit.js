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
  const store = (k, v) => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } };
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
      if (el.classList.contains("buddy-float")) { document.body.appendChild(el); continue; }
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
    '<h1 class="orbit-title">Pi Tech Lab</h1>' +
    '<button type="button" class="orbit-core" aria-label="Pi Tech Lab. Drag to move; click to close all open cards">' +
    '<svg class="orbit-mark" viewBox="40 40 320 320" aria-hidden="true">' +
    '<circle class="om-circle" cx="200" cy="200" r="150"/>' +
    '<g class="om-sweep">' + MARK_TRAIL +
    '<line class="om-r om-main" x1="200" y1="200" x2="350" y2="200"/><line class="om-r om-main" x1="200" y1="200" x2="50" y2="200"/></g></svg></button>' +
    '<div class="orbit-pi" aria-live="off"><span class="op-digits"></span><span class="op-count"></span></div></div>' +
    '<div class="orbit-bubbles" role="list" aria-label="Everything on Pi Tech Lab"></div>';

  // ------------------------------------------------------------ use: what you use grows
  // Each card keeps a score in this browser: opening it counts 1, moving it a
  // third. The score sets how prominent its pill is and how close to the mark
  // it sits.
  const useOf = it => load("orbit:use:" + it.key) || 0;
  function bumpUse(it, by) {
    it.use = Math.min(999, useOf(it) + by);
    store("orbit:use:" + it.key, Math.round(it.use * 100) / 100);
    setTier(it);
  }
  function setTier(it) {
    const u = it.use || 0;
    it.bubble.dataset.tier = u >= 8 ? 3 : u >= 3 ? 2 : u >= 1 ? 1 : 0;
  }

  // ------------------------------------------------------------ bubbles
  function makeBubbles() {
    const wrap = $(".orbit-bubbles", stage);
    items.forEach((it, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "orbit-bubble";
      b.dataset.section = it.section.key;
      b.setAttribute("role", "listitem");
      b.innerHTML = '<span class="ob-dot" aria-hidden="true"></span><span class="ob-label"></span>';
      b.querySelector(".ob-label").textContent = it.title;
      b.title = it.section.name + ": " + it.title;
      b.setAttribute("aria-label", it.section.name + ": " + it.title + ". Open");
      it.bubble = b;
      it.order = i;
      it.use = useOf(it);
      setTier(it);
      it.custom = load("orbit:at:" + it.key);       // {dx, dy} from the mark's centre
      store("orbit:pos:" + it.key);                  // the old moving-orbit format
      wireDrag(it);
      wrap.appendChild(b);
    });
  }

  function visible(it) {
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
  let piBox = { w: 320, h: 40 };
  let draggingLogo = false;
  const GAP = () => (small ? 6 : 10);

  function idleR() {
    const base = Math.min(W, H);
    return Math.min(118, base * (small ? 0.15 : 0.16), H * 0.12);
  }
  function shownR() {
    const open = document.documentElement.classList.contains("orbit-open");
    if (!open) return R;
    // the more windows are open, the further the mark steps back
    const n = items.filter(i => i.panel).length;
    return Math.max(20, Math.min(32, R * 0.3) - (n - 1) * 3);
  }

  function clampLogo() {
    const m = R + 8;
    lx = Math.min(W - m, Math.max(m, lx));
    ly = Math.min(H - R - piBox.h - 18, Math.max(m + (small ? 36 : 44), ly));
  }

  // the π line hangs under the mark but never leaves the screen
  const piX = () => Math.min(W - piBox.w / 2 - 4, Math.max(piBox.w / 2 + 4, lx));
  function placeMark() {
    const r = shownR();
    const core = $(".orbit-core");
    core.style.width = core.style.height = r * 2 + "px";
    core.style.left = lx - r + "px";
    core.style.top = top + ly - r + "px";
    const pi = $(".orbit-pi");
    pi.style.left = piX() + "px";
    pi.style.top = top + ly + r + 10 + "px";
  }

  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const freeAt = (r, placed) => r.x >= 6 && r.y >= 6 && r.x + r.w <= W - 6 && r.y + r.h <= H - 6 && !placed.some(p => hit(r, p));
  function grow(r, g) { return { x: r.x - g, y: r.y - g, w: r.w + 2 * g, h: r.h + 2 * g }; }

  function obstacles() {
    const g = GAP();
    const out = [
      grow({ x: lx - R, y: ly - R, w: 2 * R, h: 2 * R }, g),
      grow({ x: piX() - piBox.w / 2, y: ly + R + 8, w: piBox.w, h: piBox.h + 4 }, g),
    ];
    const t = $(".orbit-title");
    if (t) { const b = t.getBoundingClientRect(); out.push(grow({ x: b.left, y: b.top - top, w: b.width, h: b.height }, g)); }
    document.querySelectorAll(".gh-fab, .buddy-float").forEach(el => {
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
  function layout() {
    const bar = $(".channel-bar");
    top = bar ? bar.offsetHeight : 0;
    stage.style.top = top + "px";
    document.documentElement.style.setProperty("--orbit-top", top + "px");
    W = window.innerWidth; H = window.innerHeight - top;
    small = W < 700;
    R = idleR();
    const pi = $(".orbit-pi");
    if (!document.documentElement.classList.contains("orbit-open") && pi.offsetWidth) piBox = { w: pi.offsetWidth, h: pi.offsetHeight };
    if (!draggingLogo) {
      if (logoAt) { lx = logoAt.fx * W; ly = logoAt.fy * H; }
      else { lx = W / 2; ly = H / 2 - (small ? 20 : 10); }
    }
    clampLogo();
    placeMark();

    items.forEach(it => { it.bubble.hidden = !visible(it); });
    const vis = items.filter(it => !it.bubble.hidden);
    vis.forEach(it => { it.w = it.bubble.offsetWidth || 120; it.h = it.bubble.offsetHeight || 32; });

    const g = GAP();
    const placed = obstacles();
    // 1. pills you have put somewhere keep that spot (relative to the mark), or the nearest free one
    vis.filter(it => it.custom && it !== dragging).forEach(it => {
      const r = nearestFree(lx + it.custom.dx, ly + it.custom.dy, it.w, it.h, placed);
      it.at = r; if (r) placed.push(grow(r, g / 2));
    });
    // 2. the rest go round the mark on widening rings, most used first
    const auto = vis.filter(it => !it.custom && it !== dragging)
      .sort((a, b) => (b.use || 0) - (a.use || 0) || a.order - b.order);
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
      if (it.at) placed.push(grow(it.at, g / 2));
    }
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
    const p = usedRings.ring;
    if (!p) { svg.innerHTML = ""; return; }
    svg.innerHTML = usedRings.slice().sort((a, b) => a - b).filter((k, i) => i < 4).map(k => {
      const ry = p.r0 + k * p.step;
      return '<ellipse cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" rx="' + (ry * p.ax).toFixed(1) + '" ry="' + ry.toFixed(1) + '"/>';
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
      it.custom = { dx: Math.round(x - lx), dy: Math.round(y - ly) };
      store("orbit:at:" + it.key, it.custom);
      dragging = null;
      bumpUse(it, 1 / 3);
      layout();                            // it lands on the nearest free spot; the others make room
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
    core.addEventListener("click", () => {
      if (core.dataset.justDragged) return;
      items.filter(it => it.panel).forEach(closeItem);
    });
    // double-click: back to the middle
    core.addEventListener("dblclick", () => { logoAt = null; store("orbit:logo"); layout(); });
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
    if (it.panel) { front(it.panel); it.panel.querySelector(".op-close").focus(); return; }
    activateSection(it.section.key);
    const p = document.createElement("section");
    p.className = "orbit-panel";
    p.setAttribute("role", "dialog");
    const hid = "op-" + Math.random().toString(36).slice(2);
    p.setAttribute("aria-labelledby", hid);
    p.innerHTML = '<header class="op-head"><span class="op-section"></span><h2 class="op-title"></h2>' +
      '<button type="button" class="op-max" aria-label="Maximise">⤢</button>' +
      '<button type="button" class="op-close" aria-label="Close">×</button></header><div class="op-body"></div>';
    p.querySelector(".op-section").textContent = it.section.name;
    const title = p.querySelector(".op-title"); title.id = hid; title.textContent = it.title;
    p.querySelector(".op-body").appendChild(it.content);
    const n = openCount;
    const w = Math.min(820, window.innerWidth - 32), h = Math.min(window.innerHeight - top - 48, 760);
    p.style.width = w + "px"; p.style.height = h + "px";
    p.style.left = Math.max(16, (window.innerWidth - w) / 2 + (n % 5) * 28 - 56) + "px";
    p.style.top = Math.max(top + 16, top + (window.innerHeight - top - h) / 2 + (n % 5) * 24 - 48) + "px";
    document.body.appendChild(p);
    it.panel = p; openCount++;
    document.documentElement.classList.add("orbit-open");
    it.bubble.classList.add("is-open");
    front(p);
    wirePanel(it, p);
    if (it.nodes.some(n => n.id === "labHal")) setTimeout(keepAlive, 300);
    bumpUse(it, 1);
    pulse();
    placeMark();
    p.querySelector(".op-close").focus();
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
  }

  function wirePanel(it, p) {
    const head = p.querySelector(".op-head");
    let sx, sy, px, py, drag = false;
    p.addEventListener("pointerdown", () => front(p));
    head.addEventListener("pointerdown", e => {
      if (e.target.closest("button") || p.classList.contains("max")) return;
      drag = true; sx = e.clientX; sy = e.clientY; px = p.offsetLeft; py = p.offsetTop;
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener("pointermove", e => {
      if (!drag) return;
      p.style.left = Math.min(window.innerWidth - 80, Math.max(-p.offsetWidth + 120, px + e.clientX - sx)) + "px";
      p.style.top = Math.min(window.innerHeight - 48, Math.max(top, py + e.clientY - sy)) + "px";
    });
    head.addEventListener("pointerup", () => { drag = false; });
    p.querySelector(".op-close").addEventListener("click", () => closeItem(it));
    p.querySelector(".op-max").addEventListener("click", () => {
      p.classList.toggle("max");
      p.querySelector(".op-max").setAttribute("aria-label", p.classList.contains("max") ? "Restore" : "Maximise");
    });
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

  // ------------------------------------------------------------ start
  function start() {
    SECTIONS.forEach(s => (s.panel ? collectSection(s) : collectAccount(s)));
    document.body.appendChild(shelf);
    document.body.appendChild(stage);
    // The mark stays above every open window: always in view, always the way home.
    const center = $(".orbit-center", stage);
    document.body.appendChild(center);
    stage.center = center;
    document.documentElement.classList.add("orbit-on");
    makeBubbles();
    wireLogo();
    // Esc closes the window on top, wherever the keyboard focus happens to be
    // (the map and HAL-OS take focus for their own keys).
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const modal = document.getElementById("modalOverlay");
      if (modal && !modal.classList.contains("hidden")) return;
      const topIt = items.filter(i => i.panel).sort((a, b) => b.panel.style.zIndex - a.panel.style.zIndex)[0];
      if (topIt) { e.preventDefault(); closeItem(topIt); }
    });
    // Cards appear and disappear as app.js decides (sign-in, owner panels,
    // results): keep the orbit in step.
    const mo = new MutationObserver(() => { clearTimeout(start.t); start.t = setTimeout(layout, 120); });
    items.forEach(it => it.nodes.forEach(n => mo.observe(n, { attributes: true, attributeFilter: ["class", "hidden"] })));
    window.addEventListener("resize", () => { clearTimeout(start.r); start.r = setTimeout(layout, 80); });
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
    if (location.hash) setTimeout(fromHash, 300);
    requestAnimationFrame(() => document.documentElement.classList.add("orbit-ready"));
    startPi();
    window.PiOrbit = { open: key => { const it = items.find(x => x.section.key === key && visible(x)); if (it) openItem(it); }, layout };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
