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
      if (t) return t;
    }
    return fallbackKey;
  }
  function addItem(section, nodes, title) {
    if (!nodes.length) return;
    const content = document.createElement("div");
    content.className = "orbit-content";
    nodes.forEach(n => content.appendChild(n));
    let t0 = title || titleOf(nodes, section.name);
    t0 = RETITLE[section.key + ":" + t0] || t0;            // the owner's names for some cards
    const it = { section, nodes, content, title: t0 };
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
      if (el.classList.contains("buddy-float")) { addItem(section, [el], "RiBD"); continue; }
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
      if (el.classList.contains("stats-bar")) { addItem(section, [el], "Analytics"); continue; }
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
      // a card that is only a button: its pill presses the button instead of opening a window
      // Contact us is a window like any other (no dialog, no close button): the
      // form is drawn into the card itself (contactWindow below).
      if (el.matches(".bug-card")) { addItem(section, [el], "Contact us"); contactWindow(el); continue; }
      if (el.matches(".referral-card, .donate-card, .owner-danger")) { addItem(section, [el]); continue; }
      signIn.push(el);
    }
    addItem(section, signIn, "Your account");
    // the source link, as a pill like everything else
    const gh = $(".gh-fab");
    if (gh) items.push({ section: { key: "links", name: "Source" }, nodes: [], content: null, title: "GitHub", href: gh.href, key: "links:GitHub" });
  }

  // Cards that read better as one window, at the owner's request.
  const MERGES = [
    { section: "journal", title: "Leaderboards",
      parts: ["pi-Index (piX) Leaderboard [Top Papers]", "pi-Quotient (piQ) Leaderboard [Top Authors]"] },
    { section: "diagram", title: "Architecture",
      parts: ["Overview", "Scoring Pipeline in Detail", "Stage Reference", "CoARA Compliance & Core Pillars"] },
  ];
  function mergeItems() {
    MERGES.forEach(m => {
      const parts = m.parts.map(t => items.find(it => it.section.key === m.section && it.title === t)).filter(Boolean);
      if (parts.length < 2) return;
      const content = document.createElement("div");
      content.className = "orbit-content orbit-merged";
      parts.forEach(p => { while (p.content.firstChild) content.appendChild(p.content.firstChild); p.content.remove(); });
      const at = items.indexOf(parts[0]);
      const merged = { section: parts[0].section, title: m.title, nodes: parts.flatMap(p => p.nodes), content };
      merged.key = m.section + ":" + m.title;
      shelf.appendChild(content);
      parts.forEach(p => items.splice(items.indexOf(p), 1));
      items.splice(at, 0, merged);
    });
  }
  // Renamed pills keep what was remembered about them (place, size, use, window).
  const RENAMED = { "analytics:Key numbers": "analytics:Analytics", "analytics:Forecast": "analytics:Performance",
                    "account:SciLM (siM) Assistant": "account:SciM Assistant", "account:siM Assistant": "account:SciM Assistant",
                    "assess:ResBD": "assess:RiBD", "assess:Assess a Manuscript": "assess:Assess Manuscripts [Pi]",
                    "account:Support ScholarPi": "account:Support Pi", "lib:Lib group": "lib:Library group" };
  const RETITLE = { "assess:Assess a Manuscript": "Assess Manuscripts [Pi]", "analytics:Forecast": "Performance", "account:SciLM (siM) Assistant": "SciM Assistant" };
  // Pills that hold other pills: the group's bubble shows its members inside it.
  const GROUPS = [
    { section: "lab", title: "Lab" },
    { title: "Tools", members: ["Assess Manuscripts [Pi]"] },
    // RiBD and the Map of Science, plus what modules add (Neuro Frenzy, MD)
    { title: "Library", members: ["RiBD", "The Global Map of Science"], section: { key: "lib", name: "Library" } },
    // The page, super-simplified: everything else lives in three more bubbles,
    // so the stage holds six bubbles and two pills (Your account, SciM).
    { title: "Explore", members: ["The journal", "Leaderboards", "Proof-of-Research Ledger Explorer", "Recent assessments"],
      section: { key: "explore", name: "Explore" } },
    { title: "About", members: ["Architecture", "Whitepaper", "Capabilities", "Performance", "Analytics", "Minting Difficulty", "GitHub"],
      section: { key: "about", name: "About" } },
    { title: "Connect", members: ["Why sign in", "Invite a researcher", "Support Pi", "Contact us"],
      section: { key: "connect", name: "Connect" } },
  ];
  function migrateRenamed() {
    try {
      Object.entries(RENAMED).forEach(([from, to]) => {
        ["orbit:at2:", "orbit:use:", "orbit:cx:", "orbit:win:"].forEach(p => {
          const v = localStorage.getItem(p + from);
          if (v !== null && localStorage.getItem(p + to) === null) localStorage.setItem(p + to, v);
          localStorage.removeItem(p + from);
        });
        ["orbit:open", "orbit:prio"].forEach(k => {
          const list = load(k);
          if (Array.isArray(list) && list.includes(from)) localStorage.setItem(k, JSON.stringify(list.map(x => (x === from ? to : x))));
        });
      });
    } catch (_) { /* private mode */ }
  }

  // ------------------------------------------------------------ the stage
  // (the faded trail behind the sweep was removed: the mark is a single line)
  const stage = document.createElement("div");
  stage.className = "orbit-stage";
  stage.innerHTML =
    '<svg class="orbit-rings" aria-hidden="true"></svg>' +
    '<svg class="orbit-wires" aria-hidden="true"></svg>' +
    '<div class="orbit-center">' +
    '<h1 class="orbit-title" aria-label="Pi Tech Lab"><span class="ot-text" aria-hidden="true">Pi Tech Lab</span></h1>' +
    '<button type="button" class="orbit-core" aria-label="PiEN, the engine that learns how the site is used. Drag to move, scroll to resize (in the superellipse look: to change its n), click to close all windows, double-click to stop or restart π">' +
    '<svg class="orbit-mark" viewBox="40 40 320 320" aria-hidden="true">' +
    '<circle class="om-circle" cx="200" cy="200" r="150"/>' +
    '<path class="om-loop" d=""/>' +
    '<g class="om-sweep">' +
    '<line class="om-r om-main" x1="200" y1="200" x2="350" y2="200"/><line class="om-r om-main" x1="200" y1="200" x2="50" y2="200"/></g>' +
    '<text class="om-name" x="200" y="300" text-anchor="middle">PiEN</text>' +
    '<text class="om-n" x="200" y="128" text-anchor="middle"></text>' +
    '</svg></button>' +
    '<div class="orbit-pi" role="button" tabindex="0" aria-label="π, computed live. Open π and other constants" title="Click for π and friends · drag to move · drag the corner to resize">' +
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
    // a group is as weighty as everything in it
    if (it.group) return items.filter(m => m.groupOf === it).reduce((sum, m) => sum + complexity(m), 0);
    let c = 0;
    for (const n of (it.nodes.length ? it.nodes : it.content ? [it.content] : [])) {
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
    const ranked = items.filter(it => !it.virtual).map(it => [it, complexity(it)]).sort((a, b) => a[1] - b[1]);
    ranked.forEach(([it], i) => {
      const q = ranked.length > 1 ? i / (ranked.length - 1) : 0.5;
      it.q = q;
      // one size for every pill in the simple look; q still sizes the mark
      it.bubble.style.setProperty("--pz", SIMPLE ? "1" : (0.84 + q * 0.5).toFixed(3));
    });
  }
  // One calm look for every pill (the page is deliberately simple): the
  // varied typefaces and styles below are kept but no longer used.
  const SIMPLE = true;
  const FONTS = SIMPLE ? ["sans"] : ["sans", "sans", "mono", "serif", "sans-light", "serif-italic"];
  const STYLES = SIMPLE ? ["outline"] : ["outline", "ink", "soft", "dashed", "cobalt", "square", "underline", "outline"];
  function setLook(it) {
    const h = hash(it.key);
    const b = it.bubble;
    b.dataset.font = FONTS[(h >>> 4) % FONTS.length];
    b.dataset.look = STYLES[(h >>> 9) % STYLES.length];
  }

  // ------------------------------------------------------------ bubbles
  function makeBubbles() {
    items.forEach((it, i) => makeBubble(it, i));
  }
  function makeBubble(it, i) {
    const wrap = $(".orbit-bubbles", stage);
    {
      // A pill with things inside it (a chat box, or other pills) cannot be a
      // <button>: buttons may not contain interactive content.
      const rich = it.key === "account:SciM Assistant" || it.group;
      const b = document.createElement(rich ? "div" : "button");
      if (rich) { b.tabIndex = 0; b.setAttribute("role", "group"); } else b.type = "button";
      b.className = "orbit-bubble";
      b.dataset.section = it.section.key;
      b.dataset.key = it.key;
      b.setAttribute("role", "listitem");
      b.innerHTML = '<span class="ob-dot" aria-hidden="true"></span><span class="ob-label"></span>';
      b.querySelector(".ob-label").textContent = it.title;
      if (it.key === "account:SciM Assistant") {
        b.classList.add("is-chat");
        const f = document.createElement("form");
        f.className = "ob-chat";
        f.innerHTML = '<input type="text" placeholder="Ask SciM…" aria-label="Ask SciM a question" autocomplete="off"><button type="submit" aria-label="Ask">↵</button>';
        f.addEventListener("submit", e => {
          e.preventDefault();
          const q = f.querySelector("input").value.trim();
          openItem(it);
          const inp = $("#scilemInput"), form = $("#scilemForm");
          if (q && inp && form) { inp.value = q; (form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }))); }
          f.querySelector("input").value = "";
        });
        b.appendChild(f);
      }
      if (it.group) { b.classList.add("is-group"); const m = document.createElement("span"); m.className = "ob-members"; b.appendChild(m); }
      if (it.key === "account:Your account") b.classList.add("is-account");
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
      if (rich) b.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === b) { e.preventDefault(); openItem(it); } });
      wrap.appendChild(b);
    }
  }

  // A group's bubble lists its members as small pills, kept in step with who
  // can see what (owner-only members appear for the owner).
  function renderGroups() {
    items.filter(g => g.group).forEach(g => {
      const box = g.bubble && g.bubble.querySelector(".ob-members");
      if (!box) return;
      const members = items.filter(m => m.groupOf === g && visible(m));
      const sig = members.map(m => m.key).join("|");
      if (box.dataset.sig === sig) return;
      box.dataset.sig = sig;
      box.innerHTML = "";
      members.forEach(m => {
        const mb = document.createElement("button");
        mb.type = "button"; mb.className = "ob-member"; mb.textContent = m.title;
        mb.dataset.key = m.key;
        mb.addEventListener("click", e => { e.stopPropagation(); openItem(m); });
        box.appendChild(mb);
      });
    });
  }
  function makeGroups() {
    GROUPS.forEach(G => {
      const members = items.filter(it => (G.members ? G.members.includes(it.title) : it.section.key === G.section) && !it.groupOf);
      if (!members.length && !(G.section && typeof G.section === "object")) return;
      const sec = (G.section && typeof G.section === "object") ? G.section : members[0].section;
      const g = { section: sec, title: G.title, key: sec.key + ":" + G.title + " group",
                  nodes: [], content: document.createElement("div"), group: true, always: true,
                  action: () => { const first = items.find(m => m.groupOf === g && visible(m) && !isHal(m)); if (first) openItem(first); } };
      members.forEach(m => { m.groupOf = g; });
      shelf.appendChild(g.content);
      if (members.length) items.splice(items.indexOf(members[0]), 0, g); else items.push(g);
    });
  }

  // HAL-OS is an x86 emulator: its window opens only when its own pill is
  // pressed, never by itself (not from a link, not restored from last visit).
  const isHal = it => it.nodes.some(n => n.id === "labHal");
  function visible(it) {
    if (it.href || it.always) return true;
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
  // never below the minimum, even if an older, smaller size was saved
  let logoScale = Math.max(0.8, load("orbit:logo:scale") || 1);
  let piScale = load("orbit:pi:scale") || 1;
  let piAt = load("orbit:pi:at");        // {fx, fy}: the π box's centre, once you have moved it
  const LOGO_MIN = 0.8, LOGO_MAX = 2.2, PI_MIN = 0.6, PI_MAX = 2.6;
  let draggingLogo = false;
  const GAP = () => (small ? 6 : 10);

  function idleR() {
    const base = Math.min(W, H);
    const r = Math.min(140, base * (small ? 0.17 : 0.18), H * 0.14) * logoScale;
    return Math.max(18, Math.min(r, base * 0.42));
  }
  function shownR() {
    const open = document.documentElement.classList.contains("orbit-open");
    if (!open) return R;
    // with a window open, the mark sizes to what is in front: small beside a
    // simple card, larger beside the emulator, the map or an assessment
    const front = items.filter(i => i.panel).sort((a, b) => b.panel.style.zIndex - a.panel.style.zIndex)[0];
    const q = front && front.q != null ? front.q : 0.5;
    return (small ? 30 + q * 28 : 48 + q * 52) * Math.min(1.4, logoScale);
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
    if (merged()) return [lx, ly + shownR() * 0.38];      // inside the central loop
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
  // In the superellipse look the mark is the diagram's central loop: a
  // superellipse at n = π (the windows' n, computed live by semorph.js; scroll
  // on it to change n) with the π counter inside it, and the diameter reaching
  // the curve at every angle.
  const merged = () => document.documentElement.classList.contains("shape-se");
  // n is π (computed live) until you scroll on the loop: then it is yours, kept in this browser
  let markN = load("orbit:mark:n");
  const loopN = () => markN || (window.SeMorph && window.SeMorph.pi) || Math.PI;
  let nShowT = 0;
  function scrollN(e) {
    if (!merged()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    markN = Math.min(12, Math.max(0.3, loopN() * Math.exp(-e.deltaY * 0.0015)));
    drawLoop();
    const t = $(".om-n");
    if (t) { t.textContent = "n = " + markN.toFixed(3); t.classList.add("show"); }
    clearTimeout(nShowT);
    nShowT = setTimeout(() => { if (t) t.classList.remove("show"); store("orbit:mark:n", +markN.toFixed(4)); }, 900);
  }
  const loopR = th => { const n = loopN(); return 150 / Math.pow(Math.pow(Math.abs(Math.cos(th)), n) + Math.pow(Math.abs(Math.sin(th)), n), 1 / n); };
  let loopDrawn = 0;
  function drawLoop() {
    const n = loopN();
    if (Math.abs(n - loopDrawn) < 1e-6) return;
    loopDrawn = n;
    const e = 2 / n, pts = [];
    for (let i = 0; i < 160; i++) {
      const t = i / 160 * 2 * Math.PI, c = Math.cos(t), sn = Math.sin(t);
      pts.push((200 + 150 * Math.sign(c) * Math.pow(Math.abs(c), e)).toFixed(2) + "," + (200 + 150 * Math.sign(sn) * Math.pow(Math.abs(sn), e)).toFixed(2));
    }
    const path = $(".om-loop");
    if (path) path.setAttribute("d", "M" + pts.join("L") + "Z");
  }
  function placeMark() {
    const r = shownR();
    if (merged()) drawLoop();
    const core = $(".orbit-core");
    core.style.width = core.style.height = r * 2 + "px";
    core.style.left = lx - r + "px";
    core.style.top = top + ly - r + "px";
    const pi = $(".orbit-pi");
    pi.style.setProperty("--pi-scale", piScale);
    // merged into the loop: as wide as the loop allows at that height
    pi.style.setProperty("--in-loop-w", Math.round(r * 1.5) + "px");
    pi.style.setProperty("--in-loop-font", Math.max(8.5, Math.min(14, r * 0.09)).toFixed(1) + "px");
    const [px, py] = piCentre();
    // inside the loop it lives in the mark's layer (above windows, like the mark), elsewhere in the stage
    const home = merged() && stage.center ? stage.center : stage;
    if (stage.center && pi.parentElement !== home) home.appendChild(pi);
    pi.style.left = px + "px";
    pi.style.top = (home === stage ? py : top + py) + "px";            // the π box lives in the stage, under any windows
  }

  // the docked Live panel (live.js) and the room left beside it for windows
  function dockWidth() { const d = document.querySelector(".live-dock.docked .live-body"); return d ? d.offsetWidth : 0; }
  const vw = () => window.innerWidth - dockWidth();
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
    document.querySelectorAll(".buddy-float, .live-dock:not(.docked) .live-tab").forEach(el => {
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
    // the Live panel (live.js), when docked to the right, takes its width off the stage
    const dockW = dockWidth();
    stage.style.right = dockW + "px";
    W = window.innerWidth - dockW; H = window.innerHeight - top;
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

    renderGroups();
    items.forEach(it => { it.bubble.hidden = !visible(it) || !!it.groupOf; });
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
      if (e.target.closest(".ob-chat, .ob-member")) return;   // typing or a member pill, not a drag
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
    b.addEventListener("click", e => {
      if (b.dataset.justDragged || e.target.closest(".ob-chat, .ob-member")) return;
      openItem(it);
    });
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
    // A click on the mark closes every open window. It waits a moment so a
    // double-click (which pauses π) does not also close everything.
    let closeT = 0;
    core.addEventListener("click", e => {
      if (core.dataset.justDragged) return;
      clearTimeout(closeT);
      if (e.detail > 1) return;
      closeT = setTimeout(() => {
        setAside(false);
        items.filter(it => it.panel).forEach(closeItem);
        pulse();
      }, 280);
    });
    // double-click: the mark stops turning and π stops growing; again to carry on
    core.addEventListener("dblclick", () => { clearTimeout(closeT); setStill(!still); });
    const setLogo = v => { logoScale = v; };
    core.addEventListener("wheel", scrollN, { passive: false });     // superellipse look: scrolling changes the loop's n
    wheelResize(core, () => logoScale, setLogo, LOGO_MIN, LOGO_MAX, "orbit:logo:scale");
    // Scrolling on the page itself resizes the mark and opens a random window
    // (see wireScrollOpen).
    wireScrollOpen(setLogo);
  }

  // Scrolling on the page itself (not inside a window, a pill, the π box or
  // the logo), up or down, is a random window opener: each scroll gesture
  // opens one window chosen at random from those not open yet (or brings a
  // random open one to the front when everything is open). Meanwhile the wheel
  // resizes the mark, up bigger and down smaller. A trackpad's momentum keeps
  // sending wheel events for a second or more, so a new gesture only counts
  // after 600 ms of quiet. HAL-OS is never picked (it opens only from its own
  // pill), nor are links or bubbles. On touch screens a vertical swipe opens a
  // random window.
  function scrollPick() {
    const can = items.filter(i => !i.group && !i.href && !isHal(i) && (i.virtual || visible(i)) && i.title);
    const shut = can.filter(i => !i.panel);
    const pool = shut.length ? shut : can;
    if (!pool.length) return;
    const it = pool[Math.floor(Math.random() * pool.length)];
    setAside(false);
    if (it.panel) raise(it.panel, true); else openItem(it);
  }
  function wireScrollOpen(setLogo) {
    const off = t => t.closest && t.closest(".orbit-panel, .orbit-bubble, .orbit-pi, .orbit-core, input, textarea, select");
    let acc = 0, last = 0, fired = false, t;
    stage.addEventListener("wheel", e => {
      if (e.defaultPrevented || off(e.target)) return;
      e.preventDefault();
      setLogo(Math.min(LOGO_MAX, Math.max(LOGO_MIN, logoScale * Math.exp(-e.deltaY * 0.0015))));
      layoutSoon();
      clearTimeout(t); t = setTimeout(() => store("orbit:logo:scale", +logoScale.toFixed(3)), 300);
      const now = e.timeStamp || performance.now();          // when the input happened, even if the page was busy
      if (now - last > 600) { acc = 0; fired = false; }      // a new gesture
      last = now;
      if (fired) return;
      acc += Math.abs(e.deltaY);
      if (acc > 40) { fired = true; scrollPick(); }
    }, { passive: false });
    let ty = null, tx = 0;
    stage.addEventListener("touchstart", e => {
      ty = (e.touches.length === 1 && !off(e.target)) ? e.touches[0].clientY : null;
      if (ty !== null) tx = e.touches[0].clientX;
    }, { passive: true });
    stage.addEventListener("touchend", e => {
      if (ty === null || !e.changedTouches.length) return;
      const dy = e.changedTouches[0].clientY - ty, dx = e.changedTouches[0].clientX - tx;
      ty = null;
      if (Math.abs(dy) > 60 && Math.abs(dy) > 1.5 * Math.abs(dx)) scrollPick();
    }, { passive: true });
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
      if (e.defaultPrevented) return;      // already handled by something inside (the π box)
      e.preventDefault();
      set(Math.min(max, Math.max(min, get() * Math.exp(-e.deltaY * 0.0015))));
      layoutSoon();
      clearTimeout(t); t = setTimeout(() => store(key, +get().toFixed(3)), 300);
    }, { passive: false });
  }

  function contactWindow(card) {
    if (card.querySelector(".bug-host")) return;
    const host = document.createElement("div");
    host.className = "bug-host";
    card.appendChild(host);
    card.classList.add("is-window");
    const draw = () => { if (typeof openBugReport === "function") openBugReport(host); };
    if (document.readyState === "complete") draw(); else window.addEventListener("load", draw, { once: true });
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
      if (!pi.hasPointerCapture(e.pointerId) || merged()) return;   // inside the loop it stays put; a click still opens it
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
      if (!moved) { openNumbers(); return; }     // a click opens the numbers window
      const [x, y] = piCentre();
      piAt = { fx: +(x / W).toFixed(4), fy: +(y / H).toFixed(4) };
      store("orbit:pi:at", piAt); layout();
    };
    pi.addEventListener("pointerup", end);
    pi.addEventListener("pointercancel", end);
    pi.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNumbers(); } });
    // double-click: back under the mark, at the usual size
    pi.addEventListener("dblclick", () => { piAt = null; piScale = 1; store("orbit:pi:at"); store("orbit:pi:scale"); layout(); });
    resizer(pi.querySelector(".op-grip"), piCentre, () => piScale, v => { piScale = v; }, PI_MIN, PI_MAX, "orbit:pi:scale");
    pi.addEventListener("wheel", scrollN, { passive: false });       // inside the loop, the counter scrolls n too
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
    if (it.action) { it.action(); bumpUse(it, 1); pulse(); return; }
    setAside(false);
    if (it.panel) { raise(it.panel, true); bumpUse(it, 1); pulse(); return; }
    activateSection(it.section.key);
    const p = document.createElement("section");
    p.className = "orbit-panel";
    p.setAttribute("role", "region");          // windows stay open: a region, not a dialog
    const hid = "op-" + Math.random().toString(36).slice(2);
    p.setAttribute("aria-labelledby", hid);
    p.innerHTML = '<header class="op-head"><span class="op-section"></span><h2 class="op-title"></h2></header><div class="op-body"></div>';
    // the section's name, unless the title already says it
    // a pill inside a bubble is labelled with the bubble (Library, Tools, Lab)
    const where = it.groupOf ? it.groupOf.title : it.section.name;
    p.querySelector(".op-section").textContent = where === it.title ? "" : where;
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
        if (p.userMoved) return;           // a window you have placed stays where you put it
        p.style.left = Math.max(8, Math.min(vw() - p.offsetWidth - 8, cx - p.offsetWidth / 2)) + "px";
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
    if (!restoring && window.SeMorph) window.SeMorph.open(p, buttonOf(it));   // superellipse look: grows out of its button
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
    const wide = it.content.matches(".nb, .unigyro") || it.content.querySelector(".arch, iframe, canvas, #arcadeStage, table, .leaderboard");
    const q = it.q != null ? it.q : 0.5;
    const maxW = sm ? vw() - 20 : Math.min(vw() - 32, wide ? 960 : 440 + q * 380);
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
    p.style.left = Math.max(8, (vw() - w) / 2) + "px";
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

  // the button a window belongs to: its own pill, or its bubble when the pill is folded away
  function buttonOf(it) {
    const own = it.bubble;
    if (own && !own.hidden && own.getClientRects().length && own.getBoundingClientRect().width > 0) return own;
    return it.groupOf ? it.groupOf.bubble : own;
  }
  function closeItem(it) {
    if (!it.panel) return;
    if (window.SeMorph) window.SeMorph.close(it.panel, buttonOf(it));         // superellipse look: folds back into it
    shelf.appendChild(it.content);
    it.panel.remove(); it.panel = null; openCount--;
    it.bubble.classList.remove("is-open");
    if (it.nodes.some(n => n.id === "labHal")) { const f = $("#halFrame"); if (f && f.contentWindow) f.contentWindow.postMessage({ hal: "pause" }, location.origin); }
    if (it.nodes.some(n => n.id === "arcadeStage" || (n.querySelector && n.querySelector("#arcadeStage"))) && window.ScholarPiArcade) {
      try { window.ScholarPiArcade.exit(); } catch (_) { /* fine */ }
    }
    if (!openCount) document.documentElement.classList.remove("orbit-open");
    placeMark();
    rememberOpen();
    const b = it.groupOf ? it.groupOf.bubble : it.bubble;
    if (b && !b.hidden) b.focus({ preventScroll: true });
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
    p.userMoved = true;
    if (ws.w && ws.h) {
      p.style.width = Math.min(ws.w, vw() - 16) + "px";
      p.style.height = Math.min(ws.h, window.innerHeight - top - 16) + "px";
      p.userSized = true;
    }
    p.style.left = Math.max(8 - p.offsetWidth + 120, Math.min(vw() - 80, ws.fx * window.innerWidth)) + "px";
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
    // Pushed against an edge of the screen, a window closes: while it is far
    // enough out it fades, and letting go there closes it.
    const atEdge = e => {
      const r = p.getBoundingClientRect(), W0 = window.innerWidth, H0 = window.innerHeight;
      const shownW = Math.max(0, Math.min(r.right, W0) - Math.max(r.left, 0));
      return e.clientX <= 8 || e.clientX >= W0 - 8 || e.clientY >= H0 - 8 || shownW < r.width * 0.5;
    };
    head.addEventListener("pointermove", e => {
      if (!drag) return;
      p.style.left = Math.min(window.innerWidth - 60, Math.max(-p.offsetWidth + 60, px + e.clientX - sx)) + "px";
      p.style.top = Math.min(window.innerHeight - 40, Math.max(top, py + e.clientY - sy)) + "px";
      p.classList.toggle("leaving", atEdge(e));
    });
    head.addEventListener("pointerup", e => {
      if (drag && atEdge(e)) { drag = false; p.classList.remove("leaving"); store("orbit:win:" + it.key); closeItem(it); return; }
      if (drag) { p.userMoved = true; saveWin(it, p); }
      drag = false;
    });
    head.addEventListener("pointercancel", () => { drag = false; p.classList.remove("leaving"); });
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
  let digits = "", piDigits = "";
  // Windows with no pill of their own (the numbers window, opened from the π box)
  function addVirtual(v) {
    const it = Object.assign({ nodes: [], virtual: true, order: items.length, use: 0, rank: 0, q: 0.7 }, v);
    it.bubble = document.createElement("span");   // stands in for a pill; never shown
    shelf.appendChild(it.content);
    items.push(it);
    return it;
  }
  // A pill added by a module (capabilities.js): a card of its own, always shown.
  function addPill(v) {
    const it = Object.assign({ nodes: [], always: true }, v);
    shelf.appendChild(it.content);
    items.push(it);
    // a pill that lives inside a group's bubble (e.g. Tools)
    // a pill a module adds later still joins the bubble that lists it
    const listed = GROUPS.find(G => G.members && G.members.includes(v.title));
    const inGroup = v.inGroup || (listed && listed.title);
    if (inGroup) { const g = items.find(x => x.group && x.title === inGroup); if (g) it.groupOf = g; }
    makeBubble(it, items.length - 1);
    setSizes();
    layout();
    return it;
  }
  // Open a window by its pill's title (or the numbers window), as a pill click would.
  function openTitle(t) {
    if (t === "π and friends") return openNumbers();
    const it = items.find(i => i.title === t && (i.virtual || visible(i)));
    if (!it) return false;
    setAside(false);
    if (it.panel) raise(it.panel, true); else openItem(it);
    return true;
  }
  const titles = () => items.filter(i => !i.virtual && visible(i)).map(i => i.title);
  function openNumbers() {
    const it = items.find(i => i.key === "numbers:Numbers");
    if (it) openItem(it);
  }
  // ------------------------------------------------------------ wires
  // The bubbles are wired together like a LabVIEW block diagram: square
  // terminals and right-angled wires along the way data actually flows here.
  // Your account feeds Tools; an assessment flows from Tools into Explore
  // (journal, ledger); Explore feeds Library (RiBD, the map), About
  // (analytics, performance) and SciM; Connect feeds Your account; Lab feeds
  // Library. A wire is live (cobalt, data flowing along it) while a window at
  // either end is open, and the Tools to Explore wire also while the site is
  // assessing a paper; the flow runs faster the busier the site is
  // (data-activity, from /api/activity).
  const WIRES = [["Your account", "Tools"], ["Tools", "Explore"], ["Explore", "Library"], ["Explore", "About"],
                 ["Explore", "SciM Assistant"], ["Connect", "Your account"], ["Lab", "Library"]];
  function wireEnd(title) {
    const it = items.find(i => i.title === title && i.bubble && !i.groupOf);
    if (!it || it.bubble.hidden || !it.bubble.offsetParent) return null;
    return it;
  }
  const isLive = it => !!it.panel || items.some(m => m.groupOf === it && m.panel);
  function drawWires() {
    const svg = $(".orbit-wires", stage);
    if (!svg) return;
    const sr = stage.getBoundingClientRect();
    const box = it => { const r = it.bubble.getBoundingClientRect(); return { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height }; };
    let html = "";
    WIRES.forEach(([a, b]) => {
      const A = wireEnd(a), B = wireEnd(b);
      if (!A || !B) return;
      const p = box(A), q = box(B);
      const pc = [p.x + p.w / 2, p.y + p.h / 2], qc = [q.x + q.w / 2, q.y + q.h / 2];
      let d, t1, t2;
      const gapX = qc[0] > pc[0] ? q.x - (p.x + p.w) : p.x - (q.x + q.w);
      if (gapX > 16) {                         // side by side: out of one side, into the other
        const x1 = qc[0] > pc[0] ? p.x + p.w : p.x, x2 = qc[0] > pc[0] ? q.x : q.x + q.w;
        const xm = Math.round((x1 + x2) / 2);
        d = "M" + x1 + "," + pc[1] + "H" + xm + "V" + qc[1] + "H" + x2;
        t1 = [x1, pc[1]]; t2 = [x2, qc[1]];
      } else {                                 // stacked: out of the bottom, into the top
        const down = qc[1] > pc[1];
        const y1 = down ? p.y + p.h : p.y, y2 = down ? q.y : q.y + q.h;
        const ym = Math.round((y1 + y2) / 2);
        d = "M" + pc[0] + "," + y1 + "V" + ym + "H" + qc[0] + "V" + y2;
        t1 = [pc[0], y1]; t2 = [qc[0], y2];
      }
      const live = isLive(A) || isLive(B) || (a === "Tools" && b === "Explore" && actLevel !== "quiet");
      // in the superellipse look the terminals are sparkles (n = γ, semorph.js)
      const term = ([x, y]) => (window.SeMorph && document.documentElement.classList.contains("shape-se"))
        ? '<path class="wire-term" d="' + window.SeMorph.star(x, y, 5.5, 5.5) + '"/>'
        : '<rect class="wire-term" x="' + (x - 3.5) + '" y="' + (y - 3.5) + '" width="7" height="7"/>';
      html += '<g class="wire' + (live ? " live" : "") + '"><path class="wire-bed" d="' + d + '"/><path class="wire-flow" d="' + d + '"/>' +
              term(t1) + term(t2) + '</g>';
    });
    svg.innerHTML = html;
  }
  setInterval(() => { if (document.visibilityState === "visible") drawWires(); }, 250);

  // Stillness: a double-click on the mark stops it turning and π growing,
  // for this visit (π starts again from 3. on every load, so a remembered
  // pause would only show an empty π).
  let still = false, piWorker = null, showPi = null;
  function setStill(on) {
    still = on;
    document.documentElement.classList.toggle("orbit-still", on);
    if (piWorker) piWorker.postMessage(on ? { pause: true } : { resume: true });
    if (showPi) showPi();
    document.dispatchEvent(new CustomEvent("orbit:still", { detail: on }));   // numbers.js: e, φ and γ stop too
  }
  // ------------------------------------------------------------ what the site is doing
  // The mark's sweep and the π counter show what the site is processing: slow
  // and calm while it is quiet, faster while a paper is being assessed (by a
  // person, or by the site itself while idle), fastest with several at once.
  // The server's own count comes from /api/activity every few seconds; a
  // request this page is waiting on counts too (orbit-busy).
  const ACT = { quiet: { pace: 1000, spin: 18 }, working: { pace: 400, spin: 60 }, busy: { pace: 200, spin: 165 } };
  const ACT_WORDS = { quiet: ", the site is quiet", working: ", assessing a paper", busy: ", assessing several papers" };
  let serverAct = { level: "quiet" }, actLevel = "quiet";
  function applyActivity() {
    const mine = document.documentElement.classList.contains("orbit-busy");
    let lv = serverAct.level || "quiet";
    if (mine) lv = lv === "quiet" ? "working" : "busy";
    if (lv !== actLevel || !document.documentElement.dataset.activity) {
      actLevel = lv;
      document.documentElement.dataset.activity = lv;
      if (piWorker) piWorker.postMessage({ pace: ACT[lv].pace });
      if (showPi) showPi();
    }
  }
  function watchActivity() {
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try { const r = await fetch("/api/activity"); if (r.ok) serverAct = await r.json(); } catch (_) { /* keep the last */ }
      applyActivity();
    };
    poll();
    setInterval(poll, 5000);
    document.addEventListener("visibilitychange", poll);
    new MutationObserver(applyActivity).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    // the sweep turns at a speed that eases towards the current level, so a
    // change of pace never jumps the line to a new angle
    const sweep = $(".om-sweep");
    if (!sweep || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("orbit-js-spin");
    let angle = 0, speed = ACT.quiet.spin, last = performance.now();
    const frame = now => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const target = still ? 0 : ACT[actLevel].spin;
      speed += (target - speed) * Math.min(1, dt * 2.5);
      angle = (angle - speed * dt) % 360;
      sweep.style.transform = "rotate(" + angle.toFixed(2) + "deg)";
      if (merged()) {
        const len = loopR(angle * Math.PI / 180).toFixed(2);
        if (len !== sweep.dataset.len) {
          sweep.dataset.len = len;
          const [l1, l2] = sweep.querySelectorAll("line");
          l1.setAttribute("x2", 200 + +len); l2.setAttribute("x2", 200 - +len);
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function startPi() {
    const out = $(".op-digits"), cnt = $(".op-count");
    let pending = false;
    const show = () => {
      pending = false;
      const after = digits.slice(1);
      const tail = after.length <= 34 ? after : after.slice(-30);
      const lead = after.length <= 34 ? "" : after.slice(0, 5) + " … ";
      out.innerHTML = "";
      out.append("π = 3." + lead + tail.slice(0, -1));
      const b = document.createElement("b"); b.textContent = tail.slice(-1); out.append(b);
      cnt.textContent = (digits.length - 1).toLocaleString() + " decimals" + (still ? ", paused" : ACT_WORDS[actLevel]);
    };
    showPi = show;
    try {
      const w = new Worker("pi-worker.js?v=4");
      piWorker = w;
      watchActivity();
      w.onmessage = e => {
        digits += e.data.digit; piDigits = digits;
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
    const avail = Math.max(120, vw() - 32);
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
    logoScale = Math.max(LOGO_MIN, load("orbit:logo:scale") || 1);
    piAt = load("orbit:pi:at");
    piScale = load("orbit:pi:scale") || 1;
    prio = load("orbit:prio") || [];
    items.forEach(it => { it.custom = load("orbit:at2:" + it.key); it.use = useOf(it); it.rank = it.use; setTier(it); });
    setSizes();
    layout();
    // windows: open what the account has open, in its order, at its places
    const want = (load("orbit:open") || []).map(k => items.find(x => x.key === k && (x.virtual || visible(x)))).filter(it => it && !isHal(it));
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

  // ------------------------------------------------------------ the app's own jumps
  // app.js and lab.js were written for tabs: they scroll to a card, follow a
  // "go to" link, or reveal results. Here every card lives in a window, so each
  // of those opens (or brings forward) the window that holds the target first.
  function itemFor(el) {
    return items.find(it => it.content && it.content.contains(el));
  }
  function reveal(el) {
    const it = itemFor(el);
    if (!it || isHal(it)) return false;      // HAL-OS opens only from its own pill
    setAside(false);
    if (it.panel) raise(it.panel, true); else openItem(it);
    return true;
  }
  const nativeScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (opts) {
    reveal(this);
    // scroll inside its window, not the page
    const body = this.closest && this.closest(".op-body");
    if (body) {
      const top0 = this.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
      body.scrollTo({ top: Math.max(0, top0), behavior: reduceMotion.matches ? "auto" : "smooth" });
      return;
    }
    return nativeScroll.call(this, opts);
  };
  // "go to" links name a section; open its first card (after app.js has switched)
  document.addEventListener("click", e => {
    const link = e.target.closest && e.target.closest("[data-goto-tab]");
    if (!link) return;
    const MERGED = { arcade: "analytics", explorer: "journal" };
    const key = MERGED[link.dataset.gotoTab] || link.dataset.gotoTab;
    setTimeout(() => {
      if (link.dataset.gotoTab === "arcade") { const a = $("#arcadeStage"); if (a && reveal(a)) return; }
      const it = items.find(x => x.section.key === key && visible(x));
      if (it) reveal(it.nodes[0]);
    }, 0);
  });
  // A finished assessment opens its results, every time (app.js announces it).
  document.addEventListener("scholarpi:assessment-done", () => {
    setTimeout(() => { const el = document.getElementById("resultsSection"); if (el) reveal(el); }, 120);
  });
  // Results that appear after an action open their window by themselves.
  const AUTO_OPEN = ["resultsSection", "claimableCard"];
  function watchAutoOpen() {
    AUTO_OPEN.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      let was = !el.classList.contains("hidden") && !el.hidden;
      new MutationObserver(() => {
        const now = !el.classList.contains("hidden") && !el.hidden;
        if (now && !was) setTimeout(() => reveal(el), 50);
        was = now;
      }).observe(el, { attributes: true, attributeFilter: ["class", "hidden"] });
    });
  }

  // ------------------------------------------------------------ signed in?
  // The account pill shows it: a red dot when signed out, a green check when in.
  // The account pill's dot: red signed out, yellow with one sign-in (a wallet
  // or ORCID), green with both. Read from what app.js keeps in localStorage:
  // a session token plus the identities linked to it.
  function markSignedIn() {
    let token = "", wallet = "", orcid = "";
    try {
      token = localStorage.getItem("sp_token") || "";
      wallet = localStorage.getItem("sp_wallet") || "";
      orcid = localStorage.getItem("sp_orcid") || "";
    } catch (_) { /* private mode */ }
    const n = token ? (wallet ? 1 : 0) + (orcid ? 1 : 0) : 0;
    const state = n >= 2 ? "true" : n === 1 ? "partial" : "false";
    const words = { "true": "signed in with a wallet and ORCID",
                    partial: "signed in with " + (wallet ? "a wallet" : "ORCID") + " only; add " + (wallet ? "ORCID" : "a wallet") + " too",
                    "false": "not signed in" }[state];
    items.filter(i => i.key === "account:Your account").forEach(it => {
      if (it.bubble.dataset.signed === state) return;
      it.bubble.dataset.signed = state;
      it.bubble.setAttribute("aria-label", "Your account: " + words + ". Open");
      it.bubble.title = words.charAt(0).toUpperCase() + words.slice(1);
    });
  }

  // A short line of what is inside, shown in the pill itself (peeks.js).
  function setPeek(title, text) {
    const it = items.find(i => i.title === title);
    if (!it || !it.bubble) return;
    let p = it.bubble.querySelector(".ob-peek");
    if (!text) { if (p) { p.remove(); layoutSoon(); } return; }
    if (!p) {
      p = document.createElement("span"); p.className = "ob-peek";
      const wrap = document.createElement("span"); wrap.className = "ob-text";
      const label = it.bubble.querySelector(".ob-label");
      label.replaceWith(wrap); wrap.append(label, p);
    }
    if (p.textContent !== text) { p.textContent = text; layoutSoon(); }
  }

  // Replace a window's content (architecture.js draws a new Architecture).
  function setContent(title, node) {
    const it = items.find(i => i.title === title);
    if (!it) return false;
    const keep = document.createElement("div");
    keep.hidden = true;                    // the old cards stay in the page for app.js, out of sight
    while (it.content.firstChild) keep.appendChild(it.content.firstChild);
    shelf.appendChild(keep);
    it.content.appendChild(node);
    return true;
  }

  // ------------------------------------------------------------ start
  function start() {
    SECTIONS.forEach(s => (s.panel ? collectSection(s) : collectAccount(s)));
    mergeItems();
    makeGroups();
    migrateRenamed();
    document.body.appendChild(shelf);
    document.body.appendChild(stage);
    // The mark stays above every open window: always in view, always the way home.
    const center = $(".orbit-center", stage);
    document.body.appendChild(center);
    stage.center = center;
    stage.appendChild($(".orbit-pi", center));
    stage.appendChild($(".orbit-title", center));     // the name sits behind everything, too
    document.documentElement.classList.add("orbit-on");
    makeBubbles();
    setSizes();
    wireLogo();
    wirePi();
    watchAutoOpen();
    markSignedIn();
    setInterval(markSignedIn, 1500);
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
      const it = items.find(x => x.section.key === key && visible(x) && !isHal(x));
      if (it) openItem(it);
    };
    window.addEventListener("hashchange", fromHash);
    layout();
    setTimeout(layout, 600);              // after fonts and app.js's first render
    setTimeout(layout, 2000);
    // windows open last time open again, in the same order (looked up once
    // pien.js and numbers.js have added their windows)
    setTimeout(() => {
      const reopen = (load("orbit:open") || []).map(k => items.find(x => x.key === k && (x.virtual || visible(x)))).filter(it => it && !isHal(it));
      restoring = true;
      reopen.forEach(it => { if (!it.panel) openItem(it); });
      restoring = false;
      if (reopen.length) rememberOpen();
      if (location.hash) fromHash();
    }, 350);
    requestAnimationFrame(() => document.documentElement.classList.add("orbit-ready"));
    startPi();
    measureTitles(); showTitle(0, false); nextTitleLater();
    window.addEventListener("resize", () => { measureTitles(); showTitle(titleIdx, false); layoutSoon(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measureTitles(); layoutSoon(); });
    // sign-in happens in app.js; notice it (and sign-out) without coupling to it
    setTimeout(pull, 500);
    setInterval(pull, 2500);
    window.addEventListener("storage", e => { if (e.key === "sp_token") pull(); });
    window.PiOrbit = { still: () => still, setPeek, setContent, contentOf: t => { const it = items.find(i => i.title === t); return it ? it.content : null; }, addPill, openTitle, pillTitles: titles, addVirtual, piDigits: () => piDigits, store, load, visibleKeys: () => items.filter(i => !i.bubble.hidden).map(i => i.key), title: i => showTitle(i, false), titles: TITLES.length, aside: setAside, info: key => { const it = items.find(i => i.key === key); return it ? { title: it.title, use: Math.round(useOf(it)), open: !!it.panel } : null; }, elOf: key => { const it = items.find(i => i.key === key); return it ? (it.panel || buttonOf(it)) : null; }, keyOf: el => { const it = items.find(i => i.panel === el || i.bubble === el); return it ? it.key : null; }, open: key => { const it = items.find(x => x.section.key === key && visible(x)); if (it) openItem(it); }, layout };
    document.dispatchEvent(new CustomEvent("orbit:ready"));   // pien.js and numbers.js start here
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
