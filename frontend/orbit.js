// orbit.js — the whole site as an orbit around the Pi Tech Lab mark.
//
// The mark sits fixed in the centre of the screen on every page. Every card
// of every section orbits it on elliptical rings. A card can be dragged to a
// new orbit (remembered per browser) and clicked to expand into a floating
// window that can be dragged, resized and maximised. The mark's size follows
// what the site is doing: large when nothing is open, small while cards are
// open, spinning faster while the site is working.
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
    '<button type="button" class="orbit-core" aria-label="Pi Tech Lab, close all open cards">' +
    '<svg class="orbit-mark" viewBox="40 40 320 320" aria-hidden="true">' +
    '<circle class="om-circle" cx="200" cy="200" r="150"/>' +
    '<g class="om-sweep">' + MARK_TRAIL +
    '<line class="om-r om-main" x1="200" y1="200" x2="350" y2="200"/><line class="om-r om-main" x1="200" y1="200" x2="50" y2="200"/></g></svg></button>' +
    '<div class="orbit-caption"><h1>Pi Tech Lab</h1><p>Drag anything. Click to open.</p>' +
    '<div class="orbit-pi" aria-live="off"><span class="op-digits"></span><span class="op-count"></span></div></div></div>' +
    '<div class="orbit-bubbles" role="list" aria-label="Everything on Pi Tech Lab"></div>';

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
      it.custom = load("orbit:pos:" + it.key);
      wireDrag(it);
      wrap.appendChild(b);
    });
  }

  function visible(it) {
    return it.nodes.some(n => !(n.classList.contains("section-heading")) && !n.classList.contains("hidden") && !n.hidden);
  }

  // ------------------------------------------------------------ geometry
  let W = 0, H = 0, top = 0, cx = 0, cy = 0, coreR = 0, rings = [];
  let t = 0, paused = 0, dragging = null;
  const SPEED = 0.018;                       // radians per second, inner ring

  function layout() {
    const bar = $(".channel-bar");
    top = bar ? bar.offsetHeight : 0;
    stage.style.top = top + "px";
    document.documentElement.style.setProperty("--orbit-top", top + "px");
    W = window.innerWidth; H = window.innerHeight - top;
    cx = W / 2; cy = H / 2;
    const open = document.documentElement.classList.contains("orbit-open");
    const base = Math.min(W, H), small = W < 700;
    coreR = open ? Math.min(30, base * 0.07) : Math.min(118, base * (small ? 0.15 : 0.16), H * 0.12);
    const core = $(".orbit-core");
    core.style.width = core.style.height = coreR * 2 + "px";
    core.style.left = cx - coreR + "px";
    core.style.top = top + cy - coreR + "px";
    const cap = $(".orbit-caption");
    cap.style.top = top + cy + coreR + 10 + "px";
    const capH = open ? 40 : (cap.offsetHeight || 110);

    const vis = items.filter(it => visible(it));
    items.forEach(it => { it.bubble.hidden = !visible(it); });
    vis.forEach(it => { it.w = it.bubble.offsetWidth || 120; it.h = it.bubble.offsetHeight || 32; });

    // Rings: the innermost clears the mark and its caption; the outermost
    // stays inside the screen with room for a card's half-width.
    const widest = Math.max(80, ...vis.map(it => it.w));
    const capW = open ? 0 : Math.min(Math.max(...[...cap.children].map(c => c.offsetWidth || 0), 0), 420);
    const maxRx = W / 2 - Math.min(widest / 2 + 8, W * 0.2), maxRy = H / 2 - 22;
    // the inner ring clears the mark and the whole caption block beneath it
    const minRx = Math.min(maxRx, small ? coreR + 62 : Math.max(coreR, capW / 2) + widest / 2 + 24);
    const minRy = Math.min(maxRy, coreR + capH + (small ? 40 : 44));
    // as many rings as there is room for, at least ~44px apart
    const nRings = small ? 2 : Math.max(1, Math.min(3, Math.floor((maxRy - minRy) / 44) + 1));
    rings = Array.from({ length: nRings }, (_, k) => {
      const f = nRings === 1 ? 0.5 : k / (nRings - 1);
      // on phones every ring turns the same way, so cards never cross paths
      return { rx: minRx + (maxRx - minRx) * f, ry: minRy + (maxRy - minRy) * f, dir: small ? 1 : (k % 2 ? -1 : 1), items: [] };
    });
    const len = r => Math.PI * (3 * (r.rx + r.ry) - Math.sqrt((3 * r.rx + r.ry) * (r.rx + 3 * r.ry)));
    // Fill rings from the inside out by the room each one has, so cards do
    // not pile up; sections stay together in reading order.
    const placeable = vis.filter(it => !it.custom);
    const need = placeable.reduce((a, it) => a + it.w + 14, 0);
    const cap0 = rings.reduce((a, r) => a + len(r), 0);
    const fill = Math.min(1, need / cap0) + 0.02;
    let idx = 0;
    rings.forEach((r, k) => {
      let used = 0;
      const room = len(r) * fill;
      while (idx < placeable.length && (k === rings.length - 1 || used + placeable[idx].w + 14 <= room)) {
        r.items.push(placeable[idx]); used += placeable[idx].w + 14; idx++;
      }
      // spread by width so neighbours keep an even gap
      let acc = 0;
      const total = r.items.reduce((a, it) => a + it.w + 14, 0) || 1;
      r.items.forEach(it => { it.ring = k; it.phase = ((acc + (it.w + 14) / 2) / total) * Math.PI * 2 + k * 0.7; acc += it.w + 14; });
    });
    drawRings();
    place();
  }

  function drawRings() {
    const svg = $(".orbit-rings", stage);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = rings.map(r => '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + r.rx.toFixed(1) + '" ry="' + r.ry.toFixed(1) + '"/>').join("");
  }

  function posOf(it) {
    if (it.custom) {
      const r = rings[0] || { dir: 1 };
      const a = it.custom.a + t * SPEED * 0.8;
      const rx = it.custom.f * (W / 2 - it.w / 2 - 8), ry = it.custom.f * (H / 2 - 22);
      return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    }
    const r = rings[it.ring];
    if (!r) return [cx, cy];
    const a = it.phase + t * SPEED * r.dir * (W < 700 ? 1 : 1 - it.ring * 0.25);
    return [cx + r.rx * Math.cos(a), cy + r.ry * Math.sin(a)];
  }

  function place() {
    for (const it of items) {
      if (it.bubble.hidden || it === dragging) continue;
      let [x, y] = posOf(it);
      x = Math.min(W - it.w / 2 - 4, Math.max(it.w / 2 + 4, x));
      y = Math.min(H - it.h / 2 - 4, Math.max(it.h / 2 + 4, y));
      it.bubble.style.transform = "translate(" + (x - it.w / 2).toFixed(1) + "px," + (y - it.h / 2).toFixed(1) + "px)";
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!paused && !reduceMotion.matches) t += dt * (document.documentElement.classList.contains("orbit-busy") ? 3 : 1);
    place();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ drag + click
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
      b.style.transform = "translate(" + (e.clientX - ox) + "px," + (e.clientY - top - oy) + "px)";
    });
    b.addEventListener("pointerup", e => {
      if (!b.hasPointerCapture(e.pointerId)) return;
      b.releasePointerCapture(e.pointerId);
      b.classList.remove("dragging");
      if (!moved) return;                 // a click: handled by the click event
      // Adopt the orbit through the drop point: its angle and its relative distance.
      const x = e.clientX - ox + it.w / 2 - cx, y = e.clientY - top - oy + it.h / 2 - cy;
      const rx = W / 2 - it.w / 2 - 8, ry = H / 2 - 22;
      const f = Math.max(0.25, Math.min(1, Math.hypot(x / rx, y / ry)));
      it.custom = { f, a: Math.atan2(y / ry, x / rx) - t * SPEED * 0.8 };
      store("orbit:pos:" + it.key, it.custom);
      dragging = null;
      b.dataset.justDragged = "1";
      setTimeout(() => delete b.dataset.justDragged, 0);
    });
    b.addEventListener("click", () => { if (!b.dataset.justDragged) openItem(it); });
    b.addEventListener("pointerenter", () => { paused++; });
    b.addEventListener("pointerleave", () => { paused = Math.max(0, paused - 1); });
    b.addEventListener("focus", () => { paused++; });
    b.addEventListener("blur", () => { paused = Math.max(0, paused - 1); });
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
    layout();
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
    layout();
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
    $(".orbit-core").addEventListener("click", () => items.filter(it => it.panel).forEach(closeItem));
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
    requestAnimationFrame(frame);
    startPi();
    window.PiOrbit = { open: key => { const it = items.find(x => x.section.key === key && visible(x)); if (it) openItem(it); }, layout };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
