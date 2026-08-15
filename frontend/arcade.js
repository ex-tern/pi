/* ===========================================================================
 * The Global Map of Science — one surface, two modes.
 *
 * EXPLORE is the graph: every bubble is a field of science, sized by how many
 * assessed papers it holds in this deployment's corpus. Pan, zoom, click a
 * field for its detail. Fields that contain real papers are drawn solid and
 * labelled with their counts; the rest of the taxonomy sits faint behind them,
 * so a fresh install still shows the shape of science rather than an empty box.
 *
 * PLAY drops a player bubble into that exact same field. Absorbing a field
 * selects it — so playing is a way of reading the map, not a detour from it.
 * The two modes share one dataset, one renderer and one camera; switching
 * between them never refetches or re-lays-out anything.
 *
 * The field is issued and signed by the server (/api/arcade/start) with the
 * corpus snapshot embedded, and every absorption is recorded with its elapsed
 * timestamp so the server can replay the run in arcade.py. Nothing here
 * decides the reward: this file renders and reports. Editing it to claim a win
 * produces a run the server's replay rejects.
 * ======================================================================== */
(function () {
  "use strict";

  const WORLD_W = 3400;
  const WORLD_H = 2200;

  // --- Player size -------------------------------------------------------
  // The player's DRAWN size is capped; its mass is not.
  //
  // These are two different quantities and conflating them was the bug. Mass
  // is the game rule — what you can eat, and what the server independently
  // recomputes when it verifies a run — so capping it would make honest runs
  // fail verification and could leave large bubbles permanently uneatable,
  // making the field unclearable. Radius is only how big the blob looks.
  //
  // Late in a run the radius grew past the point of usefulness: the body
  // filled the viewport, and since the centre was clamped a full radius away
  // from every wall, the corners of the world became literally unreachable.
  // Growth now saturates — a square-root curve, so early growth still reads
  // clearly and late growth flattens out instead of running away.
  // Ceiling for the drawn radius, expressed relative to the field rather than
  // as a fixed number: twice the largest bubble in play. A constant could be
  // far too large on an easy field and far too small on a stretched one, since
  // difficulty scales every bubble — tying it to the biggest thing on screen
  // keeps "π is at most twice the largest field" true at every level.
  const PLAYER_RADIUS_CAP_MULTIPLE = 2;
  const PLAYER_RADIUS_CAP_FALLBACK = 150;   // before a field is loaded
  const PLAYER_RADIUS_KNEE = 60;   // below this, radius tracks mass exactly

  /** Twice the heaviest bubble this run, recomputed when the field changes. */
  function playerRadiusCap() {
    const biggest = state.maxBubbleMass || 0;
    return biggest > 0
      ? Math.max(PLAYER_RADIUS_KNEE + 1, biggest * PLAYER_RADIUS_CAP_MULTIPLE)
      : PLAYER_RADIUS_CAP_FALLBACK;
  }

  // Minimum gap between two absorptions. MIRRORED FROM backend/arcade.py — the
  // server rejects any run that eats faster than this, so if you change one you
  // must change both or every honest run will fail verification.
  const MIN_EAT_INTERVAL_MS = 90;

  /** Drawn/collision radius for a given mass. Monotonic, and bounded. */
  function playerRadius(mass) {
    const m = Math.max(0, Number(mass) || 0);
    const cap = playerRadiusCap();
    if (m <= Math.min(PLAYER_RADIUS_KNEE, cap)) return Math.min(m, cap);
    // Above the knee, grow as a square root towards the cap: still always
    // increasing, so a bigger player is always visibly bigger, but the
    // increments shrink and never exceed PLAYER_RADIUS_CAP.
    const over = m - PLAYER_RADIUS_KNEE;
    const span = playerRadiusCap() - PLAYER_RADIUS_KNEE;
    return PLAYER_RADIUS_KNEE + span * (1 - 1 / Math.sqrt(1 + over / span));
  }

  // Colours are assigned by hashing the field name, not from a fixed table.
  //
  // The table this replaces listed fifteen named disciplines, which was the
  // client-side half of a taxonomy the server no longer invents — every field
  // now comes from the assessed corpus, so there is no fixed set to enumerate.
  // Hashing gives each real field a stable colour across loads without the
  // palette implying which fields are supposed to exist.
  const FIELD_COLORS = [
    "#6366f1", "#14b8a6", "#22c55e", "#ef4444", "#a855f7", "#3b82f6",
    "#f59e0b", "#0ea5e9", "#ec4899", "#84cc16", "#f97316", "#06b6d4",
  ];
  const UNASSIGNED_COLOR = "#94a3b8";   // deliberately grey: it names nothing

  function colorFor(domain) {
    if (!domain || domain === "Unassigned") return UNASSIGNED_COLOR;
    let h = 0;
    for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) >>> 0;
    return FIELD_COLORS[h % FIELD_COLORS.length];
  }

  /** A bubble's colour comes from its DISCIPLINE, its label from its field.
   *
   *  Colouring per field made a map of twenty fields a map of twenty unrelated
   *  colours, with nothing to read at a glance. Colouring by parent domain
   *  means every bubble in one discipline shares a hue, so the map shows the
   *  shape of the corpus — which areas the deployment works in, and how much
   *  of each — before anyone reads a single label. */
  function bubbleColor(b) {
    return colorFor((b && (b.parent || b.domain)) || "");
  }

  // -------------------------------------------------------------------
  // Theme
  // -------------------------------------------------------------------
  // The map follows the reader's own light/dark preference rather than being
  // permanently night. A hard-coded near-black canvas sitting inside an
  // otherwise light page is not a style choice, it is a hole in the page.
  const THEMES = {
    dark:  { top: "#070b1c", bottom: "#0d1430", stars: true,
             mesh: "rgba(148,163,184,0.10)", label: "rgba(255,255,255,0.95)",
             labelDim: "rgba(255,255,255,0.60)", sub: "rgba(255,255,255,0.75)",
             hud: "rgba(8,12,28,0.72)", hudText: "#e2e8f0", hudDim: "#94a3b8",
             playerText: "#083344", track: "rgba(255,255,255,0.14)" },
    light: { top: "#eef3fb", bottom: "#dbe6f6", stars: false,
             mesh: "rgba(51,65,85,0.14)", label: "rgba(15,23,42,0.92)",
             labelDim: "rgba(15,23,42,0.55)", sub: "rgba(15,23,42,0.70)",
             hud: "rgba(255,255,255,0.86)", hudText: "#0f172a", hudDim: "#475569",
             playerText: "#f8fafc", track: "rgba(15,23,42,0.12)" },
  };
  let themeQuery = null;
  let themeName = "dark";

  function detectTheme() {
    // An explicit app setting wins over the OS, because a user who has chosen
    // a theme in the product has expressed a stronger preference than their
    // system default.
    try {
      const forced = document.documentElement.getAttribute("data-theme")
                  || localStorage.getItem("sp_theme");
      if (forced === "light" || forced === "dark") return forced;
    } catch (_) { /* private mode */ }
    return (themeQuery && themeQuery.matches) ? "dark" : "light";
  }

  function theme() { return THEMES[themeName] || THEMES.dark; }

  function initTheme() {
    try {
      themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => { themeName = detectTheme(); };
      if (themeQuery.addEventListener) themeQuery.addEventListener("change", onChange);
      else if (themeQuery.addListener) themeQuery.addListener(onChange);
    } catch (_) { themeQuery = null; }
    themeName = detectTheme();
  }
  initTheme();

  const state = {
    mode: "idle",          // idle | explore | play
    loading: false,
    canvas: null, ctx: null, dpr: 1,
    rules: null, token: null, corpus: null,
    bubbles: [], absorbed: [], player: null,
    pointer: { x: 0, y: 0, active: false },
    keys: new Set(),
    camera: { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 0.34 },
    drag: null,
    selected: null,
    startedAt: 0, lastFrame: 0, raf: null,
    particles: [], stars: [],
    submitting: false, over: false,
    legend: [],
    authors: [],
    edges: [],
    grabbed: null,
    filters: { search: "", minPapers: 0, liveOnly: false, author: "" },
    look: { labels: true, mesh: true, scale: 1, gravity: false },
    // Power-ups on the field, and whichever one is currently running.
    powerups: [], power: null, powerUntil: 0, nextPowerAt: 0,
  };

  // ---------------------------------------------------------------------
  // Power-ups
  //
  // They change how π behaves for a few seconds — they never change what a
  // run is WORTH. Mass, absorptions and the win condition are all still the
  // same quantities the server replays when it verifies the run, so a
  // power-up cannot manufacture a score: it only makes the same absorptions
  // easier to reach. That is why they can be purely client-side without
  // opening a hole, and why none of them grants mass directly.
  // ---------------------------------------------------------------------
  const POWERS = {
    magnet: {
      label: "Magnet", glyph: "🧲", ms: 8000, color: "#f59e0b",
      hint: "Smaller fields drift toward you",
    },
    haste: {
      label: "Haste", glyph: "⚡", ms: 7000, color: "#38bdf8",
      hint: "Move faster for a few seconds",
    },
    shield: {
      label: "Shield", glyph: "🛡️", ms: 9000, color: "#34d399",
      hint: "Survive one collision with something bigger",
    },
    appetite: {
      label: "Appetite", glyph: "🍽️", ms: 8000, color: "#f472b6",
      hint: "Eat fields slightly larger than you",
    },
  };
  const POWER_KEYS = Object.keys(POWERS);
  const POWER_SPAWN_MIN_MS = 9000;
  const POWER_SPAWN_MAX_MS = 16000;
  const POWER_MAX_ON_FIELD = 3;

  // Filters DIM bubbles rather than removing them. Removal would change what
  // is physically present in the playfield, which the server's replay knows
  // nothing about — an honest player could then be rejected for eating a
  // bubble the server still has, or blocked by one they cannot see. Dimming
  // is purely a rendering concern and can never desynchronise a run.
  function applyFilters() {
    const f = state.filters;
    // Pull the current author tags from the shared control each time rather
    // than mirroring them into local state, so the two cannot drift.
    f.authors = (window.ScholarPi && window.ScholarPi.tags)
      ? window.ScholarPi.tags("mapAuthor") : (f.authors || []);
    const needle = f.search.trim().toLowerCase();
    // A list now, not a single name: collaborations span people, and filtering
    // to one author at a time could not show a shared body of work.
    const authors = (f.authors || []).map(a => a.trim().toLowerCase()).filter(Boolean);

    // Which fields the chosen authors actually publish in. Built from the
    // legend rather than the bubbles, because authorship is a property of the
    // corpus, not of an individual bubble — several bubbles share a domain.
    let authorFields = null;
    if (authors.length) {
      authorFields = new Set(
        state.legend
          .filter(r => (r.authors || []).some(
            a => authors.some(sel => a.toLowerCase().includes(sel))))
          .map(r => r.field)
      );
    }

    let shown = 0;
    for (const b of state.bubbles) {
      const matches =
        (!needle || b.domain.toLowerCase().includes(needle)) &&
        b.papers >= f.minPapers &&
        (!f.liveOnly || b.live) &&
        (!authorFields || authorFields.has(b.domain));
      b.dimmed = !matches;
      if (matches) shown++;
    }

    const summary = document.getElementById("arcadeFilterSummary");
    if (summary) {
      const total = state.bubbles.length;
      const active = [];
      if (needle) active.push(`"${f.search.trim()}"`);
      if (authors.length) active.push(authors.length === 1 ? f.authors[0]
                                       : `${authors.length} authors`);
      if (f.minPapers) active.push(`≥${f.minPapers} papers`);
      if (f.liveOnly) active.push("corpus only");
      summary.textContent = shown === total && !active.length
        ? "All fields"
        : `${shown} of ${total}${active.length ? " · " + active.join(", ") : ""}`;
    }
    renderLegend();
  }

  function renderAuthorOptions() {
    // A <select>, not a text input with a datalist. A datalist looks like a
    // free-text box, so it invites typing a name that is not in the corpus and
    // then silently returns nothing — the filter appears broken when it is
    // simply reporting an empty result. A select can only offer authors that
    // actually exist in the assessed corpus.
    const opts = document.getElementById("arcadeAuthorOptions");
    if (opts) {
      opts.innerHTML = state.authors
        .map(a => `<option value="${escapeHtml(a)}"></option>`).join("");
    }
    const wrap = document.getElementById("arcadeAuthorWrap");
    // Hiding the control when the corpus has no authors is more honest than
    // showing a filter that can only ever return nothing.
    if (wrap) wrap.classList.toggle("hidden", state.authors.length === 0);
  }

  function renderLegend() {
    const body = document.querySelector("#arcadeLegendTable tbody");
    if (!body) return;
    const visible = new Set(state.bubbles.filter(b => !b.dimmed).map(b => b.domain));
    let rows = state.legend.filter(r => visible.has(r.field));

    // Only list fields that actually hold papers. Listing the whole base
    // taxonomy at zero fills the table with rows that carry no information
    // and read as real data — the map already shows unexplored fields, faint,
    // where their emptiness is the point.
    const withPapers = rows.filter(r => r.papers > 0);
    if (withPapers.length) {
      rows = withPapers;
    } else {
      body.innerHTML = `<tr><td colspan="4" class="arcade-detail-empty">
        No assessed papers yet — nothing to tabulate. Assess a manuscript and its field
        appears here with its paper count and mean piX.</td></tr>`;
      return;
    }

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="4" class="arcade-detail-empty">No fields match.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r => `
      <tr data-field="${escapeHtml(r.field)}">
        <td><span class="arcade-swatch" style="background:${colorFor(r.field)}"></span></td>
        <td>${escapeHtml(r.field)}</td>
        <td class="num">${r.papers}</td>
        <td class="num">${r.avg_score === null || r.avg_score === undefined ? "—" : r.avg_score.toFixed(1)}</td>
      </tr>`).join("");
  }

  /** Centre the camera on a field and select it — the legend's focus action. */
  function focusField(name) {
    const target = state.bubbles
      .filter(b => !isGone(b) && b.domain === name)
      .sort((a, b) => b.mass - a.mass)[0];
    if (!target) return;
    state.camera.x = target.x;
    state.camera.y = target.y;
    if (state.mode === "explore") state.camera.zoom = Math.max(state.camera.zoom, 0.7);
    selectBubble(target);
  }

  let effectsQuality = 1;
  let slowFrames = 0;

  // ---------------------------------------------------------------------
  // Ambient depth
  // ---------------------------------------------------------------------
  function seedStars() {
    state.stars = [];
    for (let i = 0; i < 220; i++) {
      state.stars.push({
        x: Math.random() * WORLD_W, y: Math.random() * WORLD_H,
        r: 0.4 + Math.random() * 1.5, depth: 0.25 + Math.random() * 0.75,
        tw: Math.random() * Math.PI * 2,
      });
    }
  }

  /** One standard-normal sample (Box–Muller).
   *
   *  Brownian motion needs Gaussian increments, not uniform ones: a sum of
   *  uniform kicks has bounded steps and a visibly flat-topped step
   *  distribution, which reads as jitter. Gaussian kicks give the occasional
   *  large excursion that makes the walk look like real diffusion.
   */
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Hidden from the map: absorbed by the player, or fused into another field. */
  function isGone(b) { return b.eaten || b.fused; }

  function spawnBurst(x, y, color, n) {
    if (effectsQuality === 0) return;
    for (let i = 0; i < Math.round(n * effectsQuality); i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 180;
      state.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                             life: 1, decay: 0.9 + Math.random() * 1.4, color });
    }
    if (state.particles.length > 400) state.particles.splice(0, state.particles.length - 400);
  }

  // ---------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------
  function resize() {
    const c = state.canvas;
    if (!c) return;
    const rect = c.parentElement.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(320, Math.floor(rect.width * state.dpr));
    c.height = Math.max(240, Math.floor(rect.height * state.dpr));
    c.style.width = rect.width + "px";
    c.style.height = rect.height + "px";

    // Keep the map filling its container as the window changes shape — but
    // only while the user has not chosen a zoom of their own. Overriding a
    // deliberate zoom on every resize would fight the person using the map.
    if (state.mode === "explore" && !state.userZoomed) {
      state.camera.zoom = fitZoom();
    }
  }
  function viewW() { return state.canvas.width / state.dpr; }
  function viewH() { return state.canvas.height / state.dpr; }
  /** Zoom at which the whole world fits the canvas, with a small margin.
   *
   *  Replaces a hardcoded 0.34. That constant was chosen against one canvas
   *  size, so on any other viewport it was simply wrong: too far in and the
   *  map ran off the edges, too far out and the constellation sat in the
   *  middle of a large empty canvas with unused margins all round — which is
   *  what "the bubbles don't cover the whole map" describes. Deriving it from
   *  the actual canvas means the map fills the space it is given, whatever
   *  that space turns out to be.
   */
  function fitZoom() {
    const w = viewW(), h = viewH();
    if (!w || !h) return 0.34;                 // canvas not laid out yet
    // COVER, not contain — Math.max rather than Math.min.
    //
    // Contain guarantees every bubble is on screen, but the world is 1.55:1
    // and a desktop canvas is nearer 2:1, so containing it leaves a wide empty
    // band down both sides: the map does not fill the map. Cover fills the
    // canvas edge to edge and crops the world's short axis instead, which
    // panning immediately recovers. Filling the space is the better default
    // because the margins were the actual complaint, and nothing is lost —
    // only moved slightly out of frame, on a surface built for panning.
    const z = Math.max(w / WORLD_W, h / WORLD_H);
    return Math.max(0.18, Math.min(2.2, z));   // same bounds the wheel enforces
  }

  function worldToScreen(wx, wy) {
    const z = state.camera.zoom;
    return { x: (wx - state.camera.x) * z + viewW() / 2,
             y: (wy - state.camera.y) * z + viewH() / 2 };
  }
  function screenToWorld(sx, sy) {
    const z = state.camera.zoom;
    return { x: (sx - viewW() / 2) / z + state.camera.x,
             y: (sy - viewH() / 2) / z + state.camera.y };
  }
  function canvasPos(clientX, clientY) {
    const r = state.canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // ---------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------
  async function loadField() {
    if (state.loading) return false;
    state.loading = true;
    setMessage("Loading the map…", "info");
    let data;
    try {
      // Identity travels with the request so the server can key difficulty
      // (and the leaderboard) to a person rather than to an IP.
      const ident = (window.ScholarPi && window.ScholarPi.identity) ? window.ScholarPi.identity() : {};
      const qs = new URLSearchParams({ wallet: ident.wallet || "", orcid: ident.orcid || "" });
      const res = await fetch(`/api/arcade/start?${qs}`);
      if (!res.ok) throw new Error("server returned " + res.status);
      data = await res.json();
    } catch (err) {
      setMessage("Could not load the map: " + err.message +
                 ". The ScholarPi server must be running.", "bad");
      state.loading = false;
      return false;
    }

    state.token = data.token;
    state.rules = data.rules;
    state.corpus = data.corpus;
    state.absorbed = [];
    state.particles = [];
    state.pops = [];
    state.selected = null;
    state.over = false;
    state.submitting = false;
    state.bubbles = data.field.map(b => ({
      id: b.id, mass: b.mass, domain: b.domain,
      papers: b.papers || 0, live: !!b.live,
      x: b.x * WORLD_W, y: b.y * WORLD_H,
      vx: b.vx * WORLD_W, vy: b.vy * WORLD_H,
      eaten: false, dimmed: false, pulse: Math.random() * Math.PI * 2,
      // Fusion bookkeeping (EXPLORE only). `baseMass` is what the corpus says
      // this field weighs; `fusedFrom` holds the bubbles currently absorbed
      // into this one, so an explosion can put every one of them back exactly
      // as it was. `fused` hides a bubble WITHOUT using `eaten`, which carries
      // play-mode meaning — a run's win condition reads `eaten`, and a fused
      // bubble must never count as absorbed.
      baseMass: b.mass, fused: false, fusedFrom: [],
    }));
    // Drives the player's size ceiling — see playerRadiusCap().
    state.maxBubbleMass = state.bubbles.reduce((m, b) => Math.max(m, b.mass), 0);
    state.legend = data.legend || [];
    state.authors = data.authors || [];
    buildEdges();
    renderAuthorOptions();
    applyFilters();

    seedStars();
    renderWalletState(data.wallet_state, data.reward);
    renderDifficulty(data.progress, data.difficulty, data.rules);
    loadArcadeBoard();
    renderCorpusSummary(data.corpus);
    setMessage("", "");
    state.loading = false;
    return true;
  }

  function renderCorpusSummary(corpus) {
    const el = document.getElementById("arcadeCorpus");
    if (!el || !corpus) return;
    if (corpus.is_empty) {
      // No invented taxonomy to describe any more — the map shows unlabelled
      // bubbles until there is something real to name them after.
      el.innerHTML = `<strong>No papers assessed yet.</strong> The map has no fields to show, so
        the bubbles are unlabelled. Assess a manuscript and its field appears here.`;
    } else if (!corpus.classified_papers) {
      // Papers exist but none carry a usable field. Saying "no papers
      // assessed" here would be flatly untrue, and this state has a specific
      // cause worth naming: classification degrades when the juror panel is
      // unavailable, which is exactly when the operator needs to know their
      // papers did land.
      el.innerHTML = `<strong>${corpus.total_papers} paper${corpus.total_papers === 1 ? "" : "s"}
        assessed, but none could be classified into a field.</strong> They are in the ledger and
        the Envision tables, they just cannot be placed on the map yet. This usually means the
        model panel was unavailable during assessment — check the juror status, then re-assess.`;
    } else {
      const unclassified = corpus.unclassified_papers
        ? ` ${corpus.unclassified_papers} could not be classified and are not shown on the map.`
        : "";
      el.innerHTML = `<strong>${corpus.total_papers}</strong> assessed
        paper${corpus.total_papers === 1 ? "" : "s"}, ${corpus.classified_papers} placed across
        <strong>${corpus.fields_with_papers}</strong> live
        field${corpus.fields_with_papers === 1 ? "" : "s"}. Solid bubbles are our corpus;
        faint ones are unexplored territory. Select a field to list its papers.${unclassified}`;
    }
  }

  // ---------------------------------------------------------------------
  // Mode transitions
  // ---------------------------------------------------------------------
  async function enterExplore(force) {
    document.getElementById("arcadeStage").classList.remove("hidden");
    // Always refetch when the tab is opened. The corpus changes as papers are
    // assessed, and a cached field made the map disagree with Analytics about
    // how many papers exist — the two must be reading the same corpus.
    if (force || !state.bubbles.length || state.mode === "idle") {
      if (!await loadField()) return;
    }
    state.mode = "explore";
    state.player = null;
    state.userZoomed = false;
    state.camera.x = WORLD_W / 2;
    state.camera.y = WORLD_H / 2;
    syncModeUi();
    // resize() first: fitZoom() reads the canvas, so it has to be measured
    // before it is asked how much of the world will fit inside it.
    resize();
    state.camera.zoom = fitZoom();
    startLoop();
  }

  async function startRun() {
    // Always take a fresh field for a scored run: reusing the explore field
    // would let someone study the layout, then reuse the same signed token.
    if (!await loadField()) return;
    const spawn = findSafeSpawn();
    state.player = { x: spawn.x, y: spawn.y, mass: state.rules.start_mass };
    state.camera = { x: spawn.x, y: spawn.y, zoom: 1 };
    state.pointer = { x: spawn.x, y: spawn.y, active: false };
    state.mode = "play";
    state.startedAt = performance.now();
    state.lastFrame = state.startedAt;
    // Negative, so the very first absorption is never held back by the
    // interval — the run starts with the gap already elapsed. This mirrors
    // the server's `last_t = -MIN_EAT_INTERVAL_MS`.
    state.lastEatAt = -MIN_EAT_INTERVAL_MS;
    // Power-ups belong to a run, not to the session.
    state.powerups = []; state.power = null; state.powerUntil = 0; state.nextPowerAt = 0;
    document.getElementById("arcadeOverlay").classList.add("hidden");
    syncModeUi();
    resize();
    startLoop();
  }

  function findSafeSpawn() {
    let best = null;
    for (let i = 0; i < 40; i++) {
      const x = WORLD_W * (0.15 + Math.random() * 0.7);
      const y = WORLD_H * (0.15 + Math.random() * 0.7);
      let nearest = Infinity;
      for (const b of state.bubbles) {
        if (b.mass <= state.rules.start_mass) continue;
        const d = Math.hypot(b.x - x, b.y - y);
        if (d < nearest) nearest = d;
      }
      if (!best || nearest > best.d) best = { x, y, d: nearest };
    }
    return best || { x: WORLD_W / 2, y: WORLD_H / 2 };
  }

  function syncModeUi() {
    const playing = state.mode === "play";
    document.getElementById("arcadePlayBtn").classList.toggle("hidden", playing);
    document.getElementById("arcadeExitBtn").classList.toggle("hidden", !playing);
    // Sound belongs to the game, not to the map. Exploring the corpus makes no
    // sound at all, so offering the control there is a switch for nothing —
    // and it crowded a toolbar whose other buttons are about the map itself.
    const soundBtn = document.getElementById("arcadeSoundBtn");
    if (soundBtn) soundBtn.classList.toggle("hidden", !playing);
    document.getElementById("arcadeModeHint").textContent = playing
      ? "Absorb every field on the map to win. Bigger bubbles pull harder — and so do you. Esc exits."
      : "Drag to pan, scroll to zoom, click a field for detail.";
  }

  function stopLoop() {
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  }
  function startLoop() {
    stopLoop();
    state.lastFrame = performance.now();
    state.raf = requestAnimationFrame(loop);
  }

  /** Leave the arcade entirely (tab switch). Abandons any run silently. */
  function exit() {
    stopLoop();
    state.mode = "idle";
  }

  /** Leave PLAY, return to the graph. An abandoned run is never submitted.
   *
   *  The field must be reloaded, not merely re-entered: a run eats bubbles,
   *  and returning to explore without a refetch would leave the map
   *  permanently missing every field the player absorbed — the graph would
   *  silently stop representing the corpus. */
  function abandonRun() {
    if (state.mode !== "play") return;
    state.mode = "explore";
    state.player = null;
    setMessage("Run abandoned — nothing was recorded.", "info");
    enterExplore(true);
  }

  function endRun(won) {
    if (state.over) return;
    state.over = true;
    stopLoop();
    submitRun(won);
  }

  async function submitRun(won) {
    if (state.submitting) return;
    state.submitting = true;
    const duration = Math.round(performance.now() - state.startedAt);
    const ident2 = (window.ScholarPi && window.ScholarPi.identity) ? window.ScholarPi.identity() : {};
    setMessage(won ? "Verifying your run…" : "Recording your run…", "info");
    let data;
    try {
      const res = await fetch("/api/arcade/finish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: state.token, duration_ms: duration, absorbed: state.absorbed,
          wallet: ident2.wallet || "", orcid: ident2.orcid || "",
        }),
      });
      data = await res.json();
    } catch (err) {
      setMessage("Run finished but could not be submitted: " + err.message, "bad");
      showOverlay(won, null);
      return;
    }
    if (!data.valid) {
      setMessage("Run rejected: " + (data.reason || "verification failed") + ".", "bad");
    } else if (Number(data.piq_awarded) > 0) {
      // A win that credits something says so in full, including the new
      // balance. Previously the piQ was credited server-side and nothing on
      // screen was refreshed, so a real payout was indistinguishable from no
      // payout at all — the balance in the sidebar simply stayed where it was.
      setMessage(data.message, "good");
      const SP = window.ScholarPi || {};
      if (typeof SP.refreshTrialStatus === "function") SP.refreshTrialStatus();
      if (typeof SP.refreshPiqBalance === "function") SP.refreshPiqBalance();
    } else {
      setMessage(data.message || "Run recorded.", won ? "info" : "");
    }
    if (data && data.progress) renderDifficulty(data.progress, null, state.rules);
    loadArcadeBoard();
    showOverlay(won, data);
  }

  /** Difficulty panel.
   *
   *  Stated explicitly rather than left to be discovered through repeated
   *  failure. A player who cannot win and is not told why concludes the game
   *  is broken; a player told the level rose and how to reset it is being
   *  offered a trade.
   */
  function renderDifficulty(progress, difficulty, rules) {
    const el = document.getElementById("arcadeDifficulty");
    if (!el || !progress) return;
    const level = progress.difficulty_level || 0;
    const winnable = difficulty ? difficulty.winnable !== false : true;
    const target = rules && rules.win_mass ? rules.win_mass : null;

    let cls = "arcade-diff";
    if (!winnable) cls += " arcade-diff-blocked";
    else if (level >= 4) cls += " arcade-diff-hard";

    el.className = cls;
    el.innerHTML = `
      <div class="diff-row"><span>Difficulty</span><strong>Level ${level}</strong></div>
      <div class="diff-row"><span>Goal</span><strong>Absorb every field</strong></div>
      <div class="diff-row"><span>Wins</span><strong>${progress.wins || 0}</strong></div>
      ${progress.best_mass ? `<div class="diff-row"><span>Your best</span><strong>${Number(progress.best_mass).toFixed(0)}</strong></div>` : ""}
      <p class="diff-hint">${
        !winnable
          ? "This field cannot be won at your current level. Assess a manuscript to reset the difficulty to 0."
          : "Each win raises the difficulty. Assessing a manuscript resets it."
      }</p>`;
  }

  async function loadArcadeBoard() {
    const el = document.getElementById("arcadeBoard");
    if (!el) return;
    try {
      const res = await fetch("/api/arcade/leaderboard?limit=15");
      const data = await res.json();
      const rows = data.leaderboard || [];
      if (!rows.length) {
        el.innerHTML = `<p class="hint">No signed-in players have completed a run yet. Connect a
          wallet or link ORCID to appear here.</p>`;
        return;
      }
      el.innerHTML = `<table class="data-table"><thead><tr>
          <th>#</th><th>Player</th><th class="num">Best</th><th class="num">Wins</th><th class="num">Lvl</th>
        </tr></thead><tbody>` + rows.map(r => `
          <tr><td>${r.rank}</td><td>${escapeHtmlLocal(r.player)}</td>
            <td class="num">${r.best_mass.toFixed(0)}</td>
            <td class="num">${r.wins}</td><td class="num">${r.difficulty_level}</td></tr>`).join("")
        + `</tbody></table><p class="hint">${escapeHtmlLocal(data.note || "")}</p>`;
    } catch (e) {
      el.innerHTML = `<p class="hint">Leaderboard unavailable.</p>`;
    }
  }

  function escapeHtmlLocal(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function showOverlay(won, data) {
    const overlay = document.getElementById("arcadeOverlay");
    if (!overlay) return;
    document.getElementById("arcadeOverlayTitle").textContent = won ? "Field absorbed" : "Consumed";
    const mass = (data && data.final_mass) || Math.round(state.player ? state.player.mass : 0);
    const eatenLive = state.bubbles.filter(b => b.eaten && b.live).length;
    // One line about the run, not three saying the same thing.
    //
    // "Absorbed 90 of 90 fields." and "Absorbed 90 fields, 69 of them carrying
    // real papers." were the same sentence twice, with the second silently
    // dropping the denominator. Merged into one statement that carries both
    // numbers.
    const parts = [
      `Absorbed <strong>${state.absorbed.length}</strong> of ${state.bubbles.length} fields`
        + (eatenLive ? `, <strong>${eatenLive}</strong> of them carrying real papers.` : "."),
      `Final mass <strong>${mass}</strong>.`,
    ];
    // A win pays in piQ. The free-assessment grant is deliberately NOT
    // announced: piQ is what buys an assessment, so reporting both made one
    // reward look like two, in two different units, and left a player unable
    // to say what a win is actually worth.
    const piq = Number((data && data.piq_awarded) || 0);
    if (piq > 0) {
      parts.push(`<span class="arcade-reward">+${piq.toFixed(2)} piQ credited to your balance`
        + (data.piq_balance != null
            ? ` — you now hold <strong>${Number(data.piq_balance).toFixed(2)} piQ</strong>.`
            : ".")
        + `</span>`);
    }
    if (!(data && piq > 0) && won && data && data.message) {
      parts.push(data.message);
    } else if (!won) {
      parts.push("You ran into a larger field. Grow on the small ones first.");
    }
    document.getElementById("arcadeOverlayBody").innerHTML =
      parts.filter(Boolean).map(p => `<p>${p}</p>`).join("");
    overlay.classList.remove("hidden");
  }

  function setMessage(text, kind) {
    const el = document.getElementById("arcadeMessage");
    if (!el) return;
    el.textContent = text || "";
    el.className = "arcade-message" + (kind ? " arcade-" + kind : "");
    el.classList.toggle("hidden", !text);
  }

  function renderWalletState(wallet, reward) {
    const el = document.getElementById("arcadeWallet");
    if (!el || !wallet) return;
    // The bonus-assessment tally is gone. A win already credits piQ, and piQ
    // is what buys an assessment — so "Earned 0 / 9 bonus assessments. A win
    // is worth 3." was a second, parallel currency describing the same
    // reward, in different units, next to the one that actually applies. Two
    // counters for one thing is how a player ends up unable to say what a win
    // gets them.
    //
    // The cap still matters, because reaching it changes what a win does, so
    // that is the one state still reported.
    el.innerHTML = wallet.bonus_earned >= wallet.cap
      ? "Free-play cap reached — connect a wallet or ORCID to keep earning piQ from wins."
      : "";
    el.classList.toggle("hidden", !el.innerHTML);
  }

  /** List the assessed papers inside the selected field, below the map.
   *
   *  Requests are sequenced by field name rather than cancelled: clicking
   *  quickly across several bubbles fires several fetches, and without a guard
   *  the slowest reply wins and the panel ends up describing a field the user
   *  is no longer looking at.
   */
  let fieldPapersToken = 0;
  async function loadFieldPapers(b) {
    const box = document.getElementById("arcadeFieldPapers");
    if (!box) return;
    const name = b && b.domain && b.domain !== "Unassigned" ? b.domain : "";
    if (!name) { box.classList.add("hidden"); box.innerHTML = ""; return; }

    const token = ++fieldPapersToken;
    box.classList.remove("hidden");
    box.innerHTML = `<h3 class="arcade-papers-title">${escapeHtml(name)}</h3>
      <p class="hint">Loading papers…</p>`;
    try {
      const res = await fetch(`/api/arcade/field-papers?field=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (token !== fieldPapersToken) return;     // a newer selection won

      if (!data.papers || !data.papers.length) {
        box.innerHTML = `<h3 class="arcade-papers-title">${escapeHtml(name)}</h3>
          <p class="hint">No assessed papers in this field yet — it is unexplored territory on
          the map. Assess one and it becomes a solid bubble.</p>`;
        return;
      }
      box.innerHTML = `
        <h3 class="arcade-papers-title">${escapeHtml(name)}
          <span class="arcade-papers-count">${data.count} paper${data.count === 1 ? "" : "s"}</span>
        </h3>
        <div class="table-scroll"><table class="data-table"><thead><tr>
          <th>Paper</th><th class="num">piX</th><th class="num">piQ</th><th class="num">Date</th>
        </tr></thead><tbody>` + data.papers.map(p => `
          <tr class="clickable-row" data-hash="${escapeHtml(p.hash)}" title="Open the full assessment">
            <td><div class="hist-title">${escapeHtml(p.title)}</div>
                <div class="hist-meta">${escapeHtml(p.author || "—")}</div></td>
            <td class="num strong">${p.score.toFixed(1)}</td>
            <td class="num">${p.piq.toFixed(2)}</td>
            <td class="num cell-muted">${escapeHtml(p.date)}</td>
          </tr>`).join("") + `</tbody></table></div>`;

      // The dossier opener lives in app.js; reach it through the shared bridge
      // rather than duplicating the fetch here.
      box.querySelectorAll(".clickable-row").forEach(tr => {
        tr.addEventListener("click", () => {
          if (window.ScholarPi && window.ScholarPi.openDossier) {
            window.ScholarPi.openDossier(tr.dataset.hash);
          }
        });
      });
    } catch (_) {
      if (token !== fieldPapersToken) return;
      box.innerHTML = `<h3 class="arcade-papers-title">${escapeHtml(name)}</h3>
        <p class="hint">The papers in this field could not be loaded.</p>`;
    }
  }

  function selectBubble(b) {
    state.selected = b;
    // The papers in the selected field, listed below the map. A bubble whose
    // size encodes "how much work is here" and which cannot be opened to see
    // that work makes the number the whole answer.
    loadFieldPapers(b);
    const panel = document.getElementById("arcadeDetail");
    if (!panel) return;
    if (!b) { panel.innerHTML = `<p class="arcade-detail-empty">Select a field to inspect it.</p>`; return; }

    // An unlabelled bubble is what an empty corpus looks like. It gets no
    // paper count and no "field" framing, because there is no field — showing
    // "Assessed papers 0" under a made-up name was the thing that made the map
    // read as real data when it was not.
    const unnamed = !b.domain || b.domain === "Unassigned";
    panel.innerHTML = `
      <div class="arcade-detail-head">
        <span class="arcade-swatch" style="background:${bubbleColor(b)}"></span>
        <strong>${escapeHtml(unnamed ? "Unclaimed space" : b.domain)}</strong>
      </div>
      <dl class="arcade-detail-rows">
        ${unnamed ? "" : `<div><dt>Assessed papers</dt><dd>${b.papers}</dd></div>`}
        <div><dt>Map weight</dt><dd>${b.mass.toFixed(1)}</dd></div>
        <div><dt>Status</dt><dd>${
          unnamed ? "No field yet" : (b.live ? "In our corpus" : "Unexplored")}</dd></div>
      </dl>
      ${unnamed
        ? `<p class="arcade-detail-note">This bubble carries no field, because nothing has been
           assessed into one yet. Assess a manuscript and real fields replace it.</p>`
        : b.live
        ? `<p class="arcade-detail-note">This field is part of our assessed corpus. Its size on
           the map is driven by how many papers it holds.</p>`
        : `<p class="arcade-detail-note">No assessed papers in this field yet. Assess one and this
           bubble grows on the map.</p>`}`;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------
  /** Domain gravity: same-field bubbles attract, all bubbles repel on contact.
   *
   *  Random drift alone scatters related fields to opposite corners, which is
   *  the opposite of what a map of science should show. Attraction along the
   *  precomputed domain edges pulls each field into a visible cluster, while
   *  short-range repulsion stops those clusters collapsing into one unreadable
   *  pile. Forces are applied to velocity and damped, so the layout settles
   *  instead of oscillating. */
  function applyGravity(dt) {
    // In EXPLORE this is a layout spring that arranges the constellation.
    // In PLAY it is real gravity — see applyOrbitalGravity, called separately —
    // so the spring is skipped there rather than the whole mechanic.
    if (state.mode === "play") return;
    const ATTRACT = 0.9;
    const REST_SCALE = 2.6;      // preferred separation, in radii
    const REPEL = 26;
    // Damping is what decides whether this reads as fog or as a table of
    // billiard balls. At 0.86 a bubble loses 99% of its speed in half a
    // second, so every collision died on contact and nothing ever travelled
    // far enough to hit a third body. Near-elastic damping lets momentum carry
    // across the table; the spring still needs the heavier value, because an
    // undamped spring oscillates forever.
    const springOnPre = !!state.look.gravity;
    const DAMP = springOnPre ? 0.94 : 0.995;
    const MAX_SPEED_EXPLORE = 11;

    // The SPRING is optional; COLLISION is not.
    //
    // This function used to return early when the gravity toggle was off,
    // which took the overlap resolution out with it — so with the default
    // settings bubbles simply passed through one another and nothing on the
    // map behaved like an object. Attraction is a layout preference and
    // belongs behind a switch; two bodies not occupying the same space is not
    // a preference.
    const springOn = !!state.look.gravity;

    if (springOn) for (const e of state.edges) {
      const a = e.a, b = e.b;
      if (a.eaten || b.eaten) continue;
      if (state.grabbed && (state.grabbed.bubble === a || state.grabbed.bubble === b)) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const rest = (a.mass + b.mass) * REST_SCALE;
      // Hooke-style spring toward the rest length, normalised so distant
      // pairs don't get an enormous impulse on the first frame.
      //
      // CLAMPED, because an unbounded spring beats collision resolution. A
      // distant pair produced an impulse large enough to drive both bodies
      // straight through whatever lay between them, and the overlap solver
      // only gets one pass per frame — so with the spring enabled the layout
      // collapsed into a corner with bubbles 70% buried in each other. The cap
      // costs nothing at rest length and only bites where the spring was
      // behaving as a catapult rather than a spring.
      const force = ((d - rest) / d) * ATTRACT * dt;
      // Clamp the IMPULSE, not the coefficient.
      //
      // `force` is a per-unit-distance term: the actual impulse is force × dx,
      // and dx can be a thousand world units. Bounding `force` therefore
      // bounded nothing — a distant pair still received an impulse large
      // enough to punch through the overlap solver, which only runs one pass
      // per frame. Limiting the resulting vector is what actually stops the
      // spring from beating collision.
      const MAX_IMPULSE = 1.2;
      let ix = dx * force, iy = dy * force;
      const im = Math.hypot(ix, iy);
      if (im > MAX_IMPULSE) { ix = ix / im * MAX_IMPULSE; iy = iy / im * MAX_IMPULSE; }
      a.vx += ix; a.vy += iy;
      b.vx -= ix; b.vy -= iy;
    }

    // Overlap resolution. O(n^2) over ~90 bubbles is ~4k checks per frame,
    // which is negligible next to the render, and it is what keeps labels
    // legible.
    const list = state.bubbles;
    // Two solver passes when the spring is running.
    //
    // One pass resolves each pair in isolation, but a bubble squeezed between
    // two others is pushed out of one contact and straight into the next, and
    // the spring re-injects energy every frame — so a single pass never
    // converges and the layout settles with bodies visibly buried. A second
    // pass is cheap (90 bubbles is ~4k checks) and removes most of what one
    // pass leaves behind. With the spring off, one pass already reaches zero.
    const PASSES = springOn ? 2 : 1;
    for (let pass = 0; pass < PASSES; pass++)
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (isGone(a)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (isGone(b) || isGone(a)) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = (a.mass + b.mass) * 1.15;
        if (d >= min) continue;
        const nx = dx / d, ny = dy / d;

        // --- Same domain? Then this is a fusion, not a bounce --------------
        // Two bubbles of the same field that run into each other coalesce, and
        // a bubble that grows past its breaking point on such a hit blows
        // apart into everything it swallowed. Different fields only ever
        // bounce: a map where unrelated disciplines merge on contact would be
        // asserting a relationship that is not in the corpus.
        if (a.domain === b.domain && tryFuse(a, b, nx, ny)) continue;

        // --- Collision, not just repulsion ---------------------------------
        // The soft push alone let bubbles sink into one another and ooze back
        // out, which reads as fog rather than as objects. Two things are added:
        // a positional correction that actually separates the overlap, and an
        // impulse along the contact normal so they bounce off each other with
        // momentum conserved by mass.
        const overlap = min - d;

        // Mass-weighted separation: the heavier field barely moves, which is
        // what makes a big bubble feel heavy rather than merely large.
        const total = a.mass + b.mass || 1;
        const aShare = b.mass / total, bShare = a.mass / total;
        const CORRECT = 0.5;                 // fraction of overlap resolved per frame
        a.x -= nx * overlap * aShare * CORRECT;
        a.y -= ny * overlap * aShare * CORRECT;
        b.x += nx * overlap * bShare * CORRECT;
        b.y += ny * overlap * bShare * CORRECT;

        // Impulse only if they are actually approaching. Applying it to
        // separating bodies adds energy on every frame of contact and the pair
        // shakes itself apart.
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        const along = rvx * nx + rvy * ny;
        if (along < 0) {
          // Near-elastic. 0.45 absorbed more than half the energy of every
          // impact, so a hit ended the motion it was supposed to transfer —
          // the opposite of a billiard table, where the struck ball leaves
          // with most of what the cue ball brought. Kept under 1 so a
          // many-body pile-up still settles instead of ringing forever.
          const RESTITUTION = 0.92;
          const jImp = -(1 + RESTITUTION) * along / (1 / a.mass + 1 / b.mass);
          a.vx -= (jImp / a.mass) * nx; a.vy -= (jImp / a.mass) * ny;
          b.vx += (jImp / b.mass) * nx; b.vy += (jImp / b.mass) * ny;
        }

        // The original soft push is kept as a small residual, so a stack that
        // settles exactly on the contact distance still drifts apart instead
        // of locking together.
        const push = ((overlap) / d) * REPEL * dt * 0.35;
        a.vx -= dx * push; a.vy -= dy * push;
        b.vx += dx * push; b.vy += dy * push;
      }
    }

    // --- Brownian motion --------------------------------------------
    // Each bubble is kicked by an independent Gaussian impulse every frame:
    // a random walk in velocity, which is what suspended particles actually
    // do and what the paired sine waves this replaces only imitated. Those
    // waves were deterministic and periodic — over a long session the field
    // fell into a visible shared rhythm, and every bubble retraced the same
    // closed loop, so nothing ever wandered anywhere.
    //
    // The step is scaled by sqrt(dt), not dt. That is the defining property
    // of diffusion: variance accumulates linearly in time, so the walk looks
    // the same at 30fps as at 120fps. Scaling by dt would make the motion
    // frame-rate dependent and far too smooth.
    //
    // Heavier fields are kicked proportionally less, the same way a large
    // particle is jostled less by the same bombardment — a big discipline
    // should feel anchored, not restless.
    for (const b of list) {
      if (isGone(b)) continue;
      if (state.grabbed && state.grabbed.bubble === b) continue;
      const ease = 6 / (6 + b.mass);
      const KICK = 2.6 * ease * Math.sqrt(dt);
      b.vx += gauss() * KICK;
      b.vy += gauss() * KICK;
    }

    for (const b of list) {
      if (isGone(b)) continue;
      b.vx *= DAMP; b.vy *= DAMP;
      // Terminal velocity: without it the random walk keeps adding energy and
      // bubbles eventually shoot across the world.
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > MAX_SPEED_EXPLORE) {
        b.vx = (b.vx / sp) * MAX_SPEED_EXPLORE;
        b.vy = (b.vy / sp) * MAX_SPEED_EXPLORE;
      }

      // --- Use the whole map ------------------------------------------
      // Bubbles were seeded across the full world but drifted inward: the
      // domain springs pull clusters together and nothing ever pushed them
      // back out, so over a few minutes the map became a clump in the middle
      // with empty margins. Two forces fix that, and they are not the same
      // thing:
      //
      //  * A soft inward WALL, so a bubble that reaches the edge bounces
      //    rather than pressing against it or drifting past.
      //  * A gentle outward SPREAD in the empty margins, which counteracts the
      //    spring's net inward pull. Applied only near the centre and scaled
      //    by how central a bubble is, so it shapes the layout without ever
      //    overpowering the constellation the springs are trying to form.
      const pad = b.mass + 8;
      if (b.x < pad)             { b.x = pad;             b.vx = Math.abs(b.vx) * 0.6; }
      else if (b.x > WORLD_W - pad) { b.x = WORLD_W - pad; b.vx = -Math.abs(b.vx) * 0.6; }
      if (b.y < pad)             { b.y = pad;             b.vy = Math.abs(b.vy) * 0.6; }
      else if (b.y > WORLD_H - pad) { b.y = WORLD_H - pad; b.vy = -Math.abs(b.vy) * 0.6; }

      {
        // Applies whether or not the spring is on.
        //
        // Previously this was inside `if (springOn)`, on the reasoning that it
        // existed to counteract the spring's inward pull. But the springs are
        // not the only thing that concentrates the map: collision resolution
        // pushes bubbles apart symmetrically, so a random seeding's dense
        // regions push outward into its sparse ones and the whole distribution
        // creeps toward the middle regardless. With the default settings the
        // map therefore used its centre and left the margins empty — which is
        // exactly the case the spread was written for.
        //
        // Normalised offset from centre, -1 … 1 on each axis.
        const ox = (b.x - WORLD_W / 2) / (WORLD_W / 2);
        const oy = (b.y - WORLD_H / 2) / (WORLD_H / 2);
        const r = Math.hypot(ox, oy);
        if (r < 0.92) {
          // Strongest at dead centre, fading to nothing at the edge of the
          // inner region. A constant push would flatten the clusters against
          // the walls, which is the opposite failure.
          const push = (0.92 - r) * 0.9 * dt;
          const nx = r > 0.001 ? ox / r : (Math.random() - 0.5);
          const ny = r > 0.001 ? oy / r : (Math.random() - 0.5);
          b.vx += nx * push;
          b.vy += ny * push;
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Fusion and fission (EXPLORE only)
  // ---------------------------------------------------------------------
  //
  // Two bubbles of the SAME field that collide hard enough coalesce into one;
  // a bubble that grows past its breaking point on such a hit detonates and
  // gives every constituent back. Nothing is created or destroyed — the pieces
  // are stashed on the survivor and restored intact — so the map still totals
  // the corpus at every moment, and no fusion can quietly lose a field.
  //
  // Only same-domain pairs fuse. Merging two unrelated disciplines because
  // they happened to touch would draw a relationship the corpus does not
  // contain, which is the one thing a map of science must not do.

  /** Radius of a merged pair. Areas add, so two equal bubbles make one √2
   *  times as wide rather than twice — mass is conserved, not doubled. */
  function fusedMass(m1, m2) { return Math.sqrt(m1 * m1 + m2 * m2); }

  /** Breaking point: a bubble may reach ~2.4× the field's natural weight
   *  before the next same-domain hit blows it apart. Relative to the biggest
   *  bubble on the map so it scales with difficulty rather than pretending a
   *  fixed pixel count means the same thing on every field. */
  function burstMass() {
    return Math.max(28, (state.maxBubbleMass || 30) * 1.6);
  }

  /** Collide two same-domain bubbles. Returns true if the pair was consumed
   *  by a fusion or an explosion and needs no bounce. */
  function tryFuse(a, b, nx, ny) {
    if (state.mode !== "explore") return false;
    // A bubble being dragged is under the user's control; swallowing it (or
    // detonating out from under the cursor) would take the map away mid-grab.
    if (state.grabbed && (state.grabbed.bubble === a || state.grabbed.bubble === b)) return false;

    // Only a real impact fuses. Without a speed floor, two same-field bubbles
    // resting against each other would merge on the first frame of contact and
    // the whole domain would collapse the moment the map settled.
    const along = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (along > -1.1) return false;

    const big = a.mass >= b.mass ? a : b;
    const small = big === a ? b : a;

    // Already over the line? The hit that would have grown it further breaks
    // it instead.
    if (big.mass >= burstMass()) { explodeBubble(big, small); return true; }

    // Momentum is conserved across the merge, so a fused pair carries on along
    // the path the pair was already taking rather than stopping dead.
    const total = big.mass + small.mass || 1;
    big.vx = (big.mass * big.vx + small.mass * small.vx) / total;
    big.vy = (big.mass * big.vy + small.mass * small.vy) / total;
    big.mass = fusedMass(big.mass, small.mass);

    // The small one is stashed, not deleted — with everything IT had already
    // swallowed, flattened into one list so an explosion restores the whole
    // chain in a single step rather than leaving nested survivors hidden.
    small.fused = true;
    big.fusedFrom.push(small, ...small.fusedFrom);
    small.fusedFrom = [];

    popBubble(small.x, small.y, small.mass, colorFor(small.domain), 0.7);
    if (state.selected === small) selectBubble(big);
    return true;
  }

  /** Blow a bubble apart, returning every field it had swallowed.
   *
   *  `trigger` is the bubble whose impact caused it, and is pushed clear so it
   *  does not immediately re-fuse with a fragment on the next frame.
   */
  function explodeBubble(big, trigger) {
    const pieces = big.fusedFrom.slice();
    big.fusedFrom = [];
    big.mass = big.baseMass;

    // Fragments are placed on a ring around the parent and thrown outward.
    // The ring radius clears the parent's own body, so nothing spawns inside
    // it and gets squeezed out by the overlap solver on the next frame.
    const n = pieces.length;
    pieces.forEach((p, i) => {
      const ang = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.4;
      const r = big.mass + p.mass + 6;
      p.fused = false;
      p.x = Math.max(p.mass, Math.min(WORLD_W - p.mass, big.x + Math.cos(ang) * r));
      p.y = Math.max(p.mass, Math.min(WORLD_H - p.mass, big.y + Math.sin(ang) * r));
      const speed = 5 + Math.random() * 4;
      p.vx = Math.cos(ang) * speed;
      p.vy = Math.sin(ang) * speed;
    });

    if (trigger) {
      const dx = trigger.x - big.x, dy = trigger.y - big.y;
      const d = Math.hypot(dx, dy) || 1;
      trigger.vx += (dx / d) * 6;
      trigger.vy += (dy / d) * 6;
    }

    popBubble(big.x, big.y, big.mass + 6, colorFor(big.domain), 1.8);
    // Each returning fragment announces itself, so an explosion reads as one
    // bubble becoming many rather than as a single ring with debris.
    for (const p2 of pieces) popBubble(p2.x, p2.y, p2.mass, colorFor(p2.domain), 0.5);
    // Nothing to give back: a bubble at its natural weight cannot have been
    // over the line by fusing, so this only happens on an unusually heavy
    // field. Kick it instead of silently doing nothing, so the impact still
    // reads as an impact.
    if (!n) {
      big.vx -= (trigger ? (trigger.x - big.x) : 1) * 0.02;
      big.vy -= (trigger ? (trigger.y - big.y) : 1) * 0.02;
    }
  }

  /** Mass attracts mass — the play-mode mechanic.
   *
   *  Every bubble pulls every other, and the player pulls too. Force follows
   *  the inverse-square law with mass in the numerator, so a large field has a
   *  genuinely deeper well than a small one and the map behaves the way its
   *  sizes suggest it should.
   *
   *  Three departures from textbook gravity, each for a reason:
   *
   *   * Only the SMALLER body is moved by a pair. Mutual attraction would let a
   *     player drag the entire field along behind them, and makes the biggest
   *     bubbles wander off their own domain cluster. Being pulled toward
   *     something bigger than you is also the reading the mechanic wants: mass
   *     is a threat until you outgrow it.
   *   * A softening term in the denominator. True inverse-square goes infinite
   *     at contact, which at a 60 Hz step launches bubbles across the world.
   *   * A speed cap, for the same reason.
   *
   *  None of this touches verification. The server replays a run from the
   *  ordered list of absorptions and the field's masses; it never simulates
   *  positions, so how bubbles moved is a client-side concern.
   */
  function applyOrbitalGravity(dt) {
    const G = 480;            // tuned so a large field is felt, not fatal
    const SOFT = 900;         // softening, in world units squared
    const MAX_SPEED = 5.5;
    const list = state.bubbles;

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.eaten) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.eaten) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy + SOFT;
        const d = Math.sqrt(d2);
        // Heavier of the pair is the attractor; lighter one moves.
        const small = a.mass <= b.mass ? a : b;
        const big = small === a ? b : a;
        const pull = (G * big.mass) / d2 * dt;
        const sx = (big.x - small.x) / d, sy = (big.y - small.y) / d;
        small.vx += sx * pull;
        small.vy += sy * pull;
      }
    }

    // The player is a body too: as it grows it visibly draws the field in.
    const p = state.player;
    if (p) {
      // Gravity uses the drawn radius so the pull matches the body the player
      // can see. Uncapped mass here would have an apparently fixed-size blob
      // hoovering the entire field from across the world.
      const pGrav = playerRadius(p.mass) * (state.power === "magnet" ? 6 : 1);
      for (const b of list) {
        if (b.eaten || b.mass >= p.mass) continue;   // only smaller ones fall in
        const dx = p.x - b.x, dy = p.y - b.y;
        const d2 = dx * dx + dy * dy + SOFT;
        const d = Math.sqrt(d2);
        const pull = (G * pGrav) / d2 * dt;
        b.vx += (dx / d) * pull;
        b.vy += (dy / d) * pull;
      }
    }

    // Separation, so bubbles orbit rather than merge into one blob.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.eaten) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.eaten) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = (a.mass + b.mass) * 1.02;
        if (d >= min) continue;
        const push = ((min - d) / d) * 14 * dt;
        a.vx -= dx * push; a.vy -= dy * push;
        b.vx += dx * push; b.vy += dy * push;
      }
    }

    for (const b of list) {
      if (b.eaten) continue;
      b.vx *= 0.985; b.vy *= 0.985;        // light drag keeps orbits stable
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > MAX_SPEED) { b.vx = (b.vx / sp) * MAX_SPEED; b.vy = (b.vy / sp) * MAX_SPEED; }
    }
  }

  function drift(dt) {
    if (state.mode === "play") applyOrbitalGravity(dt);
    else applyGravity(dt);
    for (const b of state.bubbles) {
      if (isGone(b)) continue;
      if (state.grabbed && state.grabbed.bubble === b) continue;
      b.x += b.vx * dt * 60;
      b.y += b.vy * dt * 60;
      // Clamp and bounce at the world edge. Clamping as well as reversing
      // matters: a bubble pushed past the boundary by gravity would otherwise
      // sit outside and flip its velocity every frame, vibrating in place.
      if (b.x < b.mass) { b.x = b.mass; b.vx = Math.abs(b.vx); }
      else if (b.x > WORLD_W - b.mass) { b.x = WORLD_W - b.mass; b.vx = -Math.abs(b.vx); }
      if (b.y < b.mass) { b.y = b.mass; b.vy = Math.abs(b.vy); }
      else if (b.y > WORLD_H - b.mass) { b.y = WORLD_H - b.mass; b.vy = -Math.abs(b.vy); }
      b.pulse += dt * 1.6;
    }
  }

  function update(dt) {
    // Wall clock for anything that animates on its own — currently the
    // slow turn of the soap-film iridescence. Advanced here rather than
    // inside the physics so it keeps running in every mode.
    state.driftClock = (state.driftClock || 0) + dt;
    drift(dt);
    stepPops(dt);
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const q = state.particles[i];
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 0.94; q.vy *= 0.94;
      q.life -= q.decay * dt;
      if (q.life <= 0) state.particles.splice(i, 1);
    }
    if (state.mode !== "play" || !state.player) return;

    const p = state.player;

    // Growing should make you *heavier*, not parked.
    //
    // The old curve was 420 / (1 + mass/150): a hyperbola with no floor, so
    // speed fell towards zero as mass rose. Past a few absorptions the player
    // could barely cross the screen, and the reward for playing well was a
    // game that stopped responding — the cost of success was the ability to
    // act on it.
    //
    // A fractional power of the mass ratio slows you down noticeably but
    // gently, and the floor guarantees a large player still moves at a
    // playable fraction of the starting speed. Momentum is expressed as a
    // slower, weightier drift; it is never expressed as being stationary.
    const BASE_SPEED = 420;
    const MIN_SPEED_FRACTION = 0.42;   // a giant still moves at 42% of a newborn
    const startMass = (state.rules && state.rules.start_mass) || 40;
    const massRatio = Math.max(1, p.mass / startMass);
    let speed = Math.max(BASE_SPEED * MIN_SPEED_FRACTION,
                         BASE_SPEED / Math.pow(massRatio, 0.28));
    if (state.power === "haste") speed *= 1.7;

    let dx = 0, dy = 0;
    if (state.pointer.active) { dx = state.pointer.x - p.x; dy = state.pointer.y - p.y; }
    if (state.keys.has("ArrowLeft") || state.keys.has("a")) dx -= 100;
    if (state.keys.has("ArrowRight") || state.keys.has("d")) dx += 100;
    if (state.keys.has("ArrowUp") || state.keys.has("w")) dy -= 100;
    if (state.keys.has("ArrowDown") || state.keys.has("s")) dy += 100;

    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      // The ease-in zone scales with the player's own radius. At a fixed 60px
      // a large blob was already inside its own deadzone whenever the cursor
      // sat near its centre, which read as unresponsiveness on top of the
      // speed loss. Scaling it keeps the feel identical at every size.
      const easeRadius = Math.max(60, playerRadius(p.mass) * 0.8);
      const throttle = Math.min(1, dist / easeRadius);
      p.x += (dx / dist) * speed * throttle * dt;
      p.y += (dy / dist) * speed * throttle * dt;
    }
    // Corners must stay reachable.
    //
    // Clamping the centre a full radius from every wall meant a large player
    // could not put itself anywhere near a corner — the bigger you grew, the
    // more of the map was closed off, and bubbles that drifted into a corner
    // became uncatchable. The blob is now allowed to overhang the boundary by
    // most of its radius, so the centre can get close to the edge while the
    // body still reads as bounded by the world.
    const pr = playerRadius(p.mass);
    const margin = Math.min(pr * 0.25, 30);
    p.x = Math.max(margin, Math.min(WORLD_W - margin, p.x));
    p.y = Math.max(margin, Math.min(WORLD_H - margin, p.y));

    // At most one absorption per MIN_EAT_INTERVAL_MS, matching the server.
    //
    // The server rejects any run whose absorptions are closer together than
    // MIN_EAT_INTERVAL_MS, because a burst of them is what an automated player
    // looks like. But this loop walked every bubble each frame and could eat
    // several in the same millisecond — which a large blob overlapping a
    // cluster does routinely — so honest runs were failing with "Run absorbed
    // bubbles faster than is possible."
    //
    // The fix is to make the client obey the same rule rather than to relax
    // the server's: the constant is an anti-automation control, and widening
    // it to fit the client would weaken the check instead of correcting the
    // behaviour it was measuring. Uneaten bubbles stay in contact and are
    // taken on the next tick, so nothing is lost — absorption is just serial,
    // which is what the rule always assumed.
    const nowMs = performance.now() - state.startedAt;
    stepPowerups(nowMs, dt);
    let contact = null;

    for (const b of state.bubbles) {
      if (b.eaten) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      // Contact is judged against the drawn radius, so what looks like a touch
      // is a touch. Using raw mass here would have a capped-size blob eating
      // bubbles it visibly never reached.
      if (d < Math.max(b.mass, pr) * 0.86) {
        // Appetite widens what counts as edible; Shield absorbs one fatal
        // contact. Both are checked here, before the death branch, because
        // they change whether this contact IS fatal.
        const edibleLimit = state.power === "appetite" ? p.mass * 1.35 : p.mass;
        if (b.mass >= edibleLimit) {
          if (state.power === "shield") {
            // Spent on use, not on a timer: a shield that expires unused
            // while something is eating you is not a shield.
            state.power = null;
            spawnBurst(p.x, p.y, "#34d399", 34);
            playSound("shield");
            setMessage("🛡️ Shield absorbed the hit.", "good");
            // Nudge apart so the same contact does not resolve again next
            // frame and consume a shield the player no longer has.
            const away = Math.atan2(p.y - b.y, p.x - b.x);
            p.x += Math.cos(away) * (b.mass + pr) * 0.6;
            p.y += Math.sin(away) * (b.mass + pr) * 0.6;
            continue;
          }
          spawnBurst(p.x, p.y, "#ef4444", 40);
          playSound("death");
          endRun(false);
          return;
        }
        // Of everything in reach, take the largest edible bubble first: it is
        // the one the player was almost certainly aiming for, and it grows
        // them fastest, so the queue drains sensibly.
        if (!contact || b.mass > contact.mass) contact = b;
      }
    }

    if (contact && nowMs >= state.lastEatAt + MIN_EAT_INTERVAL_MS) {
      contact.eaten = true;
      p.mass += contact.mass * state.rules.absorb_ratio;
      state.lastEatAt = nowMs;
      playSound("eat");
      // Drives the swallow pulse in drawPlayer, which decays there. Scaled by
      // what was eaten, so absorbing something substantial reads differently
      // from hoovering a speck.
      p._pop = Math.min(1, (p._pop || 0) + 0.5 + Math.min(0.5, contact.mass / p.mass));
      state.absorbed.push({ id: contact.id, t: Math.round(nowMs) });
      // Eating a field pops it, for the same reason fusing two does: they
      // are bubbles, and a bubble that is removed should burst.
      popBubble(contact.x, contact.y, contact.mass, bubbleColor(contact),
                contact.live ? 1 : 0.7);
      selectBubble(contact);        // absorbing IS inspecting
    }

    // The run is won by clearing the map, not by passing a mass threshold.
    // The old rule ended the game at 140 mass with most of the corpus still on
    // screen, which meant the stated goal ("absorb the field") and the real one
    // ("reach a number") were different games. Now they are the same one.
    if (!state.bubbles.some(b => !b.eaten)) {
      spawnBurst(p.x, p.y, "#22c55e", 120);
      playSound("win");
      endRun(true);
      return;
    }

    const targetZoom = Math.max(0.34, Math.min(1.15, 46 / p.mass));
    state.camera.zoom += (targetZoom - state.camera.zoom) * Math.min(1, dt * 2.4);
    state.camera.x += (p.x - state.camera.x) * Math.min(1, dt * 6);
    state.camera.y += (p.y - state.camera.y) * Math.min(1, dt * 6);
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function draw() {
    const ctx = state.ctx, w = viewW(), h = viewH();
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    const T = theme();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, T.top); g.addColorStop(1, T.bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // Stars are a night-sky metaphor. In daylight they read as dust on the
    // screen, so they are simply absent rather than recoloured.
    if (T.stars) drawStars(ctx, w, h);
    if (effectsQuality > 0 && state.look.mesh) drawMesh(ctx);
    for (const b of state.bubbles) if (!isGone(b)) drawBubble(ctx, b);
    drawPops(ctx);
    drawParticles(ctx);
    // Pickups sit under π so the blob is never hidden by one it is about to
    // collect, and the timer sits above the HUD where it reads as status.
    // Run-relative, matching the basis stepPowerups() stores its deadlines in.
    // Passing absolute performance.now() here made every pickup read as long
    // expired and the timer bar as permanently empty.
    const runMs = state.startedAt ? performance.now() - state.startedAt : 0;
    if (state.mode === "play") drawPowerups(ctx, runMs);
    if (state.mode === "play" && state.player) drawPlayer(ctx);
    drawHud(ctx, w, h);
    if (state.mode === "play") drawPowerTimer(ctx, runMs);
  }

  function drawStars(ctx, w, h) {
    // The star field WRAPS in screen space instead of being a fixed patch of
    // world.
    //
    // Parallax multiplies the camera offset by each star's depth, so a star at
    // depth 0.25 moves a quarter as far as the world does. Stars were seeded
    // once across the world and then drawn at that parallaxed position, which
    // means panning away from the centre pulled them all toward the middle of
    // the screen and left the edges empty — the further you explored, the more
    // the sky bunched into a clump behind the origin.
    //
    // Wrapping the parallaxed position into a tile the size of the viewport
    // makes the field infinite and uniform: every part of the map has sky, and
    // the parallax still reads as depth because each layer wraps at its own
    // rate.
    const z = state.camera.zoom;
    const tileW = w + 40, tileH = h + 40;
    for (const s of state.stars) {
      const ox = (s.x - state.camera.x) * z * s.depth + w / 2;
      const oy = (s.y - state.camera.y) * z * s.depth + h / 2;
      // Positive modulo: JS % keeps the sign of the dividend, which would
      // leave a blank band whenever the offset went negative.
      const px = ((ox % tileW) + tileW) % tileW - 20;
      const py = ((oy % tileH) + tileH) % tileH - 20;
      s.tw += 0.02;
      ctx.fillStyle = `rgba(190,215,255,${(0.25 + Math.abs(Math.sin(s.tw)) * 0.5) * s.depth})`;
      ctx.beginPath(); ctx.arc(px, py, s.r * s.depth, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** Precompute the domain constellations once per field.
   *
   *  The previous version linked same-domain bubbles within a fixed 260px
   *  radius, recomputed every frame. On a 3400x2200 world with ~6 bubbles per
   *  domain scattered at random, that yielded about five edges in the entire
   *  map — so the connections were, in practice, invisible. A fixed radius is
   *  the wrong rule: whether two fields appear related should not depend on
   *  where the layout happened to drop them.
   *
   *  Linking each bubble to its k nearest same-domain neighbours instead
   *  guarantees every domain reads as a connected constellation at any
   *  density, and doing it once at load rather than per frame removes an
   *  O(n^2) pass from the render loop. */
  /** Pull a dragged bubble's connected neighbours along with it.
   *
   *  One hop only, at a fraction of the movement. Propagating through the whole
   *  graph would drag the entire domain across the map from any single node,
   *  which stops reading as "these are related" and starts reading as a bug.
   *  Velocity is added rather than position set, so the physics step still
   *  owns separation and the cluster relaxes naturally afterwards.
   */
  function dragNeighbours(source, dx, dy) {
    if (!dx && !dy) return;
    for (const e of state.edges) {
      const other = e.a === source ? e.b : (e.b === source ? e.a : null);
      if (!other || other.eaten) continue;
      // Heavier fields resist: a large bubble is a lot of assessed work and
      // should not be flicked about by a neighbour a tenth its size.
      const resist = Math.min(1, source.mass / Math.max(1, other.mass));
      const follow = 0.35 * resist;
      other.x = Math.max(other.mass, Math.min(WORLD_W - other.mass, other.x + dx * follow));
      other.y = Math.max(other.mass, Math.min(WORLD_H - other.mass, other.y + dy * follow));
      // A little residual motion, so releasing the drag leaves the group
      // settling rather than frozen mid-arrangement.
      other.vx += dx * follow * 0.02;
      other.vy += dy * follow * 0.02;
    }
  }

  function buildEdges() {
    const byDomain = new Map();
    for (const b of state.bubbles) {
      if (!byDomain.has(b.domain)) byDomain.set(b.domain, []);
      byDomain.get(b.domain).push(b);
    }
    const seen = new Set();
    state.edges = [];
    const K = 2;
    for (const group of byDomain.values()) {
      if (group.length < 2) continue;
      for (const a of group) {
        const nearest = group
          .filter(b => b !== a)
          .map(b => ({ b, d: Math.hypot(a.x - b.x, a.y - b.y) }))
          .sort((p, q) => p.d - q.d)
          .slice(0, K);
        for (const { b, d } of nearest) {
          const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          state.edges.push({ a, b, d });
        }
      }
    }
  }

  function drawMesh(ctx) {
    ctx.lineWidth = 1;
    const w = viewW(), h = viewH();
    for (const e of state.edges) {
      if (isGone(e.a) || isGone(e.b)) continue;
      // Filtered-out fields fade their links too, so the constellation
      // matches the selection rather than contradicting it.
      const faded = e.a.dimmed || e.b.dimmed;
      const sa = worldToScreen(e.a.x, e.a.y);
      const sb = worldToScreen(e.b.x, e.b.y);
      if ((sa.x < -100 && sb.x < -100) || (sa.x > w + 100 && sb.x > w + 100)) continue;
      if ((sa.y < -100 && sb.y < -100) || (sa.y > h + 100 && sb.y > h + 100)) continue;
      ctx.strokeStyle = faded
        ? "rgba(148,163,184,0.07)"
        : rgba(colorFor(e.a.domain), 0.3);
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    }
  }

  function drawBubble(ctx, b) {
    // The bubble-scale control is a rendering aid only, and is forced to 1
    // during play: drawing a bubble at a different radius from the one used
    // for collision would let the player visibly clip through a field, or be
    // killed by one they never touched.
    const look = state.mode === "play" ? 1 : state.look.scale;
    const s = worldToScreen(b.x, b.y), r = b.mass * state.camera.zoom * look;
    if (b.dimmed && state.mode !== "play") { drawDimmed(ctx, s, r, b); return; }
    if (s.x + r < 0 || s.x - r > viewW() || s.y + r < 0 || s.y - r > viewH()) return;
    const color = bubbleColor(b);
    const playing = state.mode === "play" && state.player;
    const edible = playing ? b.mass < state.player.mass : false;
    const pulse = 1 + Math.sin(b.pulse) * 0.02;
    const isSelected = state.selected === b;

    // Corpus fields read solid; unexplored taxonomy stays faint. This is the
    // difference between "science" and "your science" at a glance.
    const baseAlpha = b.live ? 0.8 : 0.3;

    if (effectsQuality > 0 && (b.live || edible)) {
      const glow = ctx.createRadialGradient(s.x, s.y, r * 0.2, s.x, s.y, r * 1.7 * pulse);
      glow.addColorStop(0, rgba(color, b.live ? 0.5 : 0.35));
      glow.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.7 * pulse, 0, Math.PI * 2); ctx.fill();
    }

    drawSoapFilm(ctx, s.x, s.y, r * pulse, color, {
      alpha: playing && !edible ? 0.42 : baseAlpha,
      live: b.live,
      // Each bubble's iridescence starts at its own point in the cycle and
      // turns slowly, so a cluster shimmers instead of reading as one decal
      // stamped repeatedly.
      phase: b.pulse,
    });

    if (playing && !edible) { ctx.lineWidth = 2.6; ctx.strokeStyle = "#fca5a5"; }
    else if (isSelected)    { ctx.lineWidth = 3;   ctx.strokeStyle = "#ffffff"; }
    else                    { ctx.lineWidth = b.live ? 1.6 : 1; ctx.strokeStyle = rgba(color, 0.9); }
    ctx.beginPath(); ctx.arc(s.x, s.y, r * pulse, 0, Math.PI * 2);
    ctx.stroke();

    if (r > 20 && state.look.labels) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = b.live ? theme().label : theme().labelDim;
      ctx.font = `600 ${Math.min(15, r / 2.8)}px -apple-system, system-ui, sans-serif`;
      ctx.fillText(b.domain, s.x, s.y - (b.live && r > 34 ? 7 : 0));
      if (b.live && r > 34) {
        ctx.fillStyle = theme().sub;
        ctx.font = `500 ${Math.min(12, r / 4)}px -apple-system, system-ui, sans-serif`;
        ctx.fillText(`${b.papers} paper${b.papers === 1 ? "" : "s"}`, s.x, s.y + 9);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Soap film
  // ---------------------------------------------------------------------
  //
  // A real bubble is not a coloured disc. It is a transparent shell whose
  // colour lives almost entirely at the rim: thin-film interference makes the
  // soap layer refract into bands that shift with viewing angle, the middle
  // shows whatever is behind it, and one or two hard specular dots mark the
  // light source. Drawing those four things in order is what makes this read
  // as a bubble rather than as a circle with a gradient on it.
  //
  // The field's own colour is kept as the CENTRE of the iridescent sweep
  // rather than being replaced by a full rainbow. Colour on this map means
  // discipline — a legend maps hue to field — so a bubble that shimmered
  // through every hue would be prettier and unreadable.

  /** Rotate a hex colour's hue by `deg`, keeping saturation and lightness.
   *  Used to build the interference bands either side of the field's hue. */
  function shiftHue(hex, deg) {
    const n = parseInt(hex.slice(1), 16);
    let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, bl = (n & 255) / 255;
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl);
    const l = (max + min) / 2;
    let h = 0, sat = 0;
    const d = max - min;
    if (d) {
      sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - bl) / d + (g < bl ? 6 : 0));
      else if (max === g) h = (bl - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    h = (h + deg / 360 + 1) % 1;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    const chan = (t) => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [chan(h + 1 / 3), chan(h), chan(h - 1 / 3)].map(v => Math.round(v * 255));
  }

  const rgbaArr = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /** Draw one soap bubble at (x, y) with radius r. */
  function drawSoapFilm(ctx, x, y, r, color, opts) {
    const alpha = opts.alpha;
    const live = opts.live;
    const phase = opts.phase || 0;

    // 1. The body. Densest at the rim and nearly clear through the middle,
    //    which is the whole visual difference between a bubble and a ball.
    //    `live` fields hold a little more colour so the corpus still reads
    //    louder than the taxonomy around it.
    const body = ctx.createRadialGradient(x, y, r * 0.05, x, y, r);
    body.addColorStop(0.00, rgba(color, alpha * (live ? 0.13 : 0.06)));
    body.addColorStop(0.55, rgba(color, alpha * (live ? 0.20 : 0.10)));
    body.addColorStop(0.82, rgba(color, alpha * (live ? 0.52 : 0.26)));
    body.addColorStop(1.00, rgba(color, alpha * (live ? 0.98 : 0.58)));
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    // Below this size the film detail is sub-pixel and costs more than it
    // shows, so a small bubble is just the body and its outline.
    if (effectsQuality === 0 || r < 9) return;

    // 2. Interference bands. A ring stroked with a sweep that runs through the
    //    field's hue and ±70° of it — the same asymmetric magenta/cyan/green
    //    split a real film produces, anchored to a colour that still names the
    //    discipline.
    const t = phase + (state.driftClock || 0) * 0.25;
    const bandW = Math.max(1.8, r * 0.20);
    ctx.save();
    ctx.lineWidth = bandW;
    let sweep = null;
    if (typeof ctx.createConicGradient === "function") {
      sweep = ctx.createConicGradient(t, x, y);
      const stops = [-70, -25, 15, 60, 110, 200, 290];
      stops.forEach((deg, i) => {
        sweep.addColorStop(i / (stops.length - 1),
                           rgbaArr(shiftHue(color, deg), alpha * 0.72));
      });
    } else {
      // Safari before 16 has no conic gradient. A linear sweep across the
      // bubble is a weaker imitation but keeps the rim iridescent rather than
      // flat, which is the part that matters.
      sweep = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      sweep.addColorStop(0.0, rgbaArr(shiftHue(color, -60), alpha * 0.5));
      sweep.addColorStop(0.5, rgbaArr(shiftHue(color, 40), alpha * 0.5));
      sweep.addColorStop(1.0, rgbaArr(shiftHue(color, 150), alpha * 0.5));
    }
    ctx.strokeStyle = sweep;
    ctx.beginPath(); ctx.arc(x, y, r - bandW / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // 3. Rim light. A thin bright edge just inside the boundary — the film
    //    catching the light all the way round, which is what gives a bubble
    //    its shell rather than its silhouette.
    const rim = ctx.createRadialGradient(x, y, r * 0.82, x, y, r);
    rim.addColorStop(0, "rgba(255,255,255,0)");
    rim.addColorStop(0.75, `rgba(255,255,255,${alpha * 0.20})`);
    rim.addColorStop(1, `rgba(255,255,255,${alpha * 0.55})`);
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    // 4. Speculars: one large soft highlight upper-left where the key light
    //    sits, one small hard dot lower-right from the light passing through
    //    and reflecting off the far wall of the shell. Both are needed — the
    //    second is what tells the eye the surface is a sphere and hollow.
    const hx = x - r * 0.34, hy = y - r * 0.40;
    const hi = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.42);
    hi.addColorStop(0, `rgba(255,255,255,${alpha * 0.75})`);
    hi.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hi;
    ctx.beginPath(); ctx.ellipse(hx, hy, r * 0.34, r * 0.24, -0.7, 0, Math.PI * 2); ctx.fill();

    if (r > 16) {
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(x + r * 0.42, y + r * 0.46, Math.max(1, r * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------------
  // Pops
  // ---------------------------------------------------------------------
  //
  // A bubble does not fade out — the film ruptures, snaps back into a ring of
  // droplets, and is gone in about a fifth of a second. Anything slower reads
  // as a dissolve, which is the wrong physics and, more practically, makes the
  // map feel laggy. The ring is drawn expanding and thinning past the original
  // radius, because that is where the film goes.

  /** Rupture a bubble at (x, y). `r` is its radius in WORLD units. */
  function popBubble(x, y, r, color, strength = 1) {
    if (effectsQuality === 0) return;
    state.pops = state.pops || [];
    state.pops.push({ x, y, r, color, life: 1, strength });
    if (state.pops.length > 40) state.pops.splice(0, state.pops.length - 40);
    // Droplets fly outward from the RIM, not from the centre: the film is at
    // the edge, so that is where the liquid was.
    const n = Math.round((10 + r * 0.5) * strength);
    for (let i = 0; i < Math.round(n * effectsQuality); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (30 + Math.random() * 130) * strength;
      state.particles.push({
        x: x + Math.cos(a) * r * 0.9, y: y + Math.sin(a) * r * 0.9,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 1.6 + Math.random() * 1.6, color,
      });
    }
    if (state.particles.length > 400) state.particles.splice(0, state.particles.length - 400);
  }

  function stepPops(dt) {
    if (!state.pops || !state.pops.length) return;
    for (const p of state.pops) p.life -= dt * 5.2;    // ~190ms, then gone
    state.pops = state.pops.filter(p => p.life > 0);
  }

  function drawPops(ctx) {
    if (!state.pops || !state.pops.length) return;
    for (const p of state.pops) {
      const s = worldToScreen(p.x, p.y);
      // Radius runs past the original as the film snaps outward; the ring
      // thins as it goes, so it reads as breaking up rather than growing.
      const grow = 1 + (1 - p.life) * 0.7;
      const r = p.r * state.camera.zoom * grow;
      ctx.save();
      ctx.lineWidth = Math.max(0.6, p.r * state.camera.zoom * 0.16 * p.life);
      ctx.strokeStyle = rgba(p.color, Math.max(0, p.life) * 0.75);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
      // A second, fainter ring a beat behind: real film ruptures unevenly and
      // one clean circle looks like a UI ripple.
      ctx.lineWidth = Math.max(0.4, p.r * state.camera.zoom * 0.07 * p.life);
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, p.life) * 0.4})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.86, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  /** A filtered-out field: still drawn, so the map keeps its shape, but
   *  pushed into the background so the matching set reads clearly. */
  function drawDimmed(ctx, s, r, b) {
    if (s.x + r < 0 || s.x - r > viewW() || s.y + r < 0 || s.y - r > viewH()) return;
    ctx.fillStyle = theme().mesh;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(148,163,184,0.22)"; ctx.stroke();
  }

  // ---------------------------------------------------------------------
  // Sound
  //
  // Synthesised with the Web Audio API rather than shipped as files: four
  // short tones cost nothing to download, cannot 404, and need no licence
  // trail. The context is created lazily on the first gesture because every
  // browser refuses to start one before that — building it at load time gives
  // a permanently suspended context and silence with no error.
  //
  // Off by default. Sound that starts by itself on a research tool is the
  // wrong default, and the preference is remembered per browser.
  // ---------------------------------------------------------------------
  let audioCtx = null;
  let soundOn = false;
  try { soundOn = localStorage.getItem("sp_arcade_sound") === "on"; } catch (_) {}

  function ensureAudio() {
    if (!soundOn) return null;
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { audioCtx = new AC(); } catch (_) { return null; }
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  // freq → freq2 over `ms`, shaped by a short attack and an exponential decay
  // so nothing clicks. Volume is deliberately low: this plays under a map a
  // researcher may be reading.
  function tone(freq, freq2, ms, type = "sine", gain = 0.06) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freq2 && freq2 !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t0 + ms / 1000);
    }
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(amp); amp.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + ms / 1000 + 0.02);
  }

  function playSound(kind) {
    // Guarded on mode as well as preference: the map is silent by design, and
    // a stray call from a code path that also runs while exploring should not
    // be able to break that.
    if (!soundOn || state.mode !== "play") return;
    switch (kind) {
      // Rising blip, pitched up slightly as π grows, so absorbing a large
      // field sounds different from hoovering a speck.
      case "eat": {
        const m = state.player ? state.player.mass : 40;
        const base = 420 + Math.min(260, m * 1.4);
        tone(base, base * 1.5, 90, "triangle", 0.05);
        break;
      }
      case "power":  tone(660, 1320, 220, "square", 0.045); break;
      case "shield": tone(320, 180, 260, "sawtooth", 0.05); break;
      case "death":  tone(220, 60, 420, "sawtooth", 0.07); break;
      case "win":
        // A small arpeggio rather than one tone: winning should not sound
        // like another absorption.
        [523, 659, 784, 1047].forEach((f, i) =>
          setTimeout(() => tone(f, f, 160, "triangle", 0.05), i * 110));
        break;
      default: break;
    }
  }

  function setSound(on, confirm = true) {
    soundOn = !!on;
    try { localStorage.setItem("sp_arcade_sound", soundOn ? "on" : "off"); } catch (_) {}
    const btn = document.getElementById("arcadeSoundBtn");
    if (btn) {
      btn.textContent = soundOn ? "Sound on" : "Sound off";
      btn.setAttribute("aria-pressed", soundOn ? "true" : "false");
      // Visibility is owned by syncModeUi() — the button belongs to play mode,
      // and this function must not resurrect it on the map.
    }
    // The confirmation beep is for a deliberate toggle only. Playing it while
    // painting a remembered preference meant the page made a noise on load,
    // which is the exact behaviour the off-by-default choice exists to avoid.
    if (soundOn && confirm) { ensureAudio(); tone(880, 880, 90, "triangle", 0.04); }
  }

  /** Spawn, expire and collect power-ups. Called once per frame. */
  function stepPowerups(nowMs, dt) {
    const p = state.player;
    if (!p) return;

    // Spawn on a random interval rather than a fixed one, so a player cannot
    // learn the rhythm and camp the spot.
    if (!state.nextPowerAt) {
      state.nextPowerAt = nowMs + POWER_SPAWN_MIN_MS
        + Math.random() * (POWER_SPAWN_MAX_MS - POWER_SPAWN_MIN_MS);
    }
    if (nowMs >= state.nextPowerAt && state.powerups.length < POWER_MAX_ON_FIELD) {
      const kind = POWER_KEYS[Math.floor(Math.random() * POWER_KEYS.length)];
      // Placed away from the very edge so one cannot land somewhere the
      // player is clamped out of reaching.
      state.powerups.push({
        kind,
        x: WORLD_W * (0.08 + Math.random() * 0.84),
        y: WORLD_H * (0.08 + Math.random() * 0.84),
        born: nowMs,
        // They expire. A field littered with uncollected pickups stops being
        // a reward and becomes scenery.
        dies: nowMs + 18000,
      });
      state.nextPowerAt = nowMs + POWER_SPAWN_MIN_MS
        + Math.random() * (POWER_SPAWN_MAX_MS - POWER_SPAWN_MIN_MS);
    }

    const pr = playerRadius(p.mass);
    for (let i = state.powerups.length - 1; i >= 0; i--) {
      const q = state.powerups[i];
      if (nowMs >= q.dies) { state.powerups.splice(i, 1); continue; }
      if (Math.hypot(q.x - p.x, q.y - p.y) < pr + 26) {
        state.power = q.kind;
        state.powerUntil = nowMs + POWERS[q.kind].ms;
        spawnBurst(q.x, q.y, POWERS[q.kind].color, 30);
        playSound("power");
        setMessage(`${POWERS[q.kind].glyph} ${POWERS[q.kind].label} — ${POWERS[q.kind].hint}.`,
                   "good");
        state.powerups.splice(i, 1);
      }
    }

    if (state.power && nowMs >= state.powerUntil) {
      state.power = null;
      setMessage("", "");
    }
  }

  function drawPowerups(ctx, nowMs) {
    for (const q of state.powerups) {
      const s = worldToScreen(q.x, q.y);
      const r = 17 * state.camera.zoom;
      if (s.x + r < -40 || s.x - r > viewW() + 40) continue;
      if (s.y + r < -40 || s.y - r > viewH() + 40) continue;
      const spec = POWERS[q.kind];
      // Bob and pulse, so a pickup reads as collectable rather than as
      // another bubble sitting still.
      const bob = Math.sin(nowMs / 260 + q.born) * 3 * state.camera.zoom;
      // Fade out over the last two seconds, so disappearing is telegraphed.
      const left = q.dies - nowMs;
      ctx.globalAlpha = left < 2000 ? Math.max(0.15, left / 2000) : 1;

      const glow = ctx.createRadialGradient(s.x, s.y + bob, 1, s.x, s.y + bob, r * 2.2);
      glow.addColorStop(0, spec.color + "cc");
      glow.addColorStop(1, spec.color + "00");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(s.x, s.y + bob, r * 2.2, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = "#0f172a";
      ctx.beginPath(); ctx.arc(s.x, s.y + bob, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = spec.color; ctx.stroke();
      ctx.font = `${Math.round(r * 1.05)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(spec.glyph, s.x, s.y + bob + 1);
      ctx.globalAlpha = 1;
    }
  }

  /** The remaining time on an active power.
   *
   *  Bottom-left. The top of the canvas is occupied by the HTML toolbar, which
   *  spans the full width and carries the mode hint — drawing here at y=14 put
   *  the bar straight through that sentence. The bottom-right is the minimap,
   *  so the bottom-left is the only corner with nothing already in it.
   *
   *  Uses the file's own roundRect() helper rather than ctx.roundRect, which
   *  is recent enough that a slightly older browser would throw mid-frame and
   *  take the whole render loop down with it.
   */
  function drawPowerTimer(ctx, nowMs) {
    if (!state.power) return;
    const spec = POWERS[state.power];
    const left = Math.max(0, state.powerUntil - nowMs);
    const frac = Math.max(0, Math.min(1, left / spec.ms));

    // Kept clear of the minimap, which occupies the bottom-right at
    // 132px + 12px of margin. On a narrow canvas a fixed 196px bar would run
    // underneath it.
    const MINIMAP_RESERVE = 132 + 12 + 12;
    const w = Math.max(80, Math.min(196, viewW() - 48 - MINIMAP_RESERVE));
    const barH = 6;
    const padX = 12, padY = 9;
    const boxW = w + padX * 2, boxH = 34 + padY;
    const x = 24;
    const y = viewH() - boxH - 16;

    ctx.save();
    ctx.fillStyle = theme().hud;
    roundRect(ctx, x, y, boxW, boxH, 8); ctx.fill();

    ctx.fillStyle = theme().hudText || "#e2e8f0";
    ctx.font = "600 12px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(`${spec.glyph} ${spec.label}`, x + padX, y + padY + 6);

    const barY = y + boxH - padY - barH;
    ctx.fillStyle = theme().track;
    roundRect(ctx, x + padX, barY, w, barH, 3); ctx.fill();
    ctx.fillStyle = spec.color;
    roundRect(ctx, x + padX, barY, Math.max(3, w * frac), barH, 3); ctx.fill();
    ctx.restore();
  }

  function drawPlayer(ctx) {
    // π as a character rather than a glyph on a disc.
    //
    // The player was a static circle with a letter in it, which reads as a
    // cursor, not as something alive — and it is the one object on screen the
    // player controls and looks at continuously. Everything below is derived
    // from state that already exists (position, mass, absorptions), so the
    // animation is a reading of what is happening rather than decoration
    // running on its own clock: it squashes in the direction it is moving,
    // looks where it is going, blinks, and reacts when it eats.
    const p = state.player, s = worldToScreen(p.x, p.y),
          r = playerRadius(p.mass) * state.camera.zoom;
    const t = performance.now() / 1000;

    // --- Motion, smoothed ------------------------------------------------
    // Velocity is derived here rather than stored on the player, so nothing in
    // the simulation has to know the renderer exists.
    if (p._px === undefined) { p._px = p.x; p._py = p.y; p._lookX = 0; p._lookY = 1; }
    const vx = p.x - p._px, vy = p.y - p._py;
    p._px = p.x; p._py = p.y;
    const speed = Math.hypot(vx, vy);
    if (speed > 0.05) {
      // Ease toward the direction of travel so the gaze does not snap around
      // on every frame of a jittery input.
      p._lookX += ((vx / speed) - p._lookX) * 0.18;
      p._lookY += ((vy / speed) - p._lookY) * 0.18;
    }

    // --- Squash and stretch ---------------------------------------------
    // Bounded hard: past about 12% it stops reading as momentum and starts
    // reading as a rendering bug.
    const stretch = Math.min(0.12, speed * 0.012);
    const ang = Math.atan2(vy, vx);
    // A slow idle breath so a stationary π is still alive.
    const breathe = 1 + Math.sin(t * 1.9) * 0.018;
    // Eating pulse: set in the absorb path, decays here.
    p._pop = Math.max(0, (p._pop || 0) - 0.045);
    const pop = 1 + p._pop * 0.22;

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(ang);
    ctx.scale((1 + stretch) * breathe * pop, (1 - stretch) * breathe * pop);
    ctx.rotate(-ang);

    if (effectsQuality > 0) {
      // The glow pulses with the breath, so the halo belongs to the body
      // rather than sitting behind it at a constant size.
      const halo = r * (2.1 + Math.sin(t * 1.9) * 0.12);
      const glow = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, halo);
      glow.addColorStop(0, `rgba(56,189,248,${0.45 + p._pop * 0.3})`);
      glow.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, halo, 0, Math.PI * 2); ctx.fill();
    }

    // --- Body and cranium -------------------------------------------------
    //
    // A big friendly brain. The dome and the body are filled as ONE path so
    // the head reads as a single creature rather than a ball with a hat on
    // it — stroke first at a doubled width, then fill over it, which leaves
    // only the outer half of the outline visible and erases the seam where
    // the two shapes cross.
    //
    // The crown overhangs the collision radius by about 12%. That is
    // deliberate and small: `r` still governs what π can eat and what eats it,
    // and the overhang sits at the top of the skull, where a contact is least
    // likely to be the one that decides a run.
    const body = ctx.createRadialGradient(-r * 0.3, -r * 0.45, r * 0.1, 0, 0, r * 1.15);
    body.addColorStop(0, "#e0f2fe"); body.addColorStop(1, "#0284c7");

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.moveTo(r * 0.86, -r * 0.36);
    ctx.ellipse(0, -r * 0.36, r * 0.86, r * 0.66, 0, 0, Math.PI * 2);
    ctx.lineWidth = 4; ctx.strokeStyle = "#7dd3fc"; ctx.stroke();
    ctx.fillStyle = body; ctx.fill();

    // --- Face -------------------------------------------------------------
    // Only drawn once the body is big enough to hold it. Below that the eyes
    // collapse into two dots touching each other, which looks like damage
    // rather than a face — so a small π keeps the plain glyph.
    if (r > 13) {
      // Brain folds. Rounded loops that curl back on themselves, the way a
      // cartoon brain is drawn — the earlier version used straight radiating
      // lines, which read as a cracked shell rather than as a mind. Soft blue
      // at low alpha so they sit under the skin instead of on top of it.
      ctx.save();
      ctx.strokeStyle = "rgba(3,105,161,0.40)";
      ctx.lineWidth = Math.max(1.3, r * 0.06);
      ctx.lineCap = "round";
      for (const side of [-1, 1]) {
        for (let i = 0; i < 2; i++) {
          const y = -r * (0.88 - i * 0.24);
          const w = r * (0.34 + i * 0.20);
          ctx.beginPath();
          ctx.moveTo(side * r * 0.08, y + r * 0.06);
          // Up and over, then tucked back under: one lobe of a gyrus.
          ctx.bezierCurveTo(side * w * 0.5, y - r * 0.20,
                            side * w * 1.5, y - r * 0.16,
                            side * w * 1.35, y + r * 0.10);
          ctx.stroke();
        }
      }
      ctx.restore();

      // The π is a marking on the forehead, not a label on a disc.
      //
      // Fixed dark ink rather than theme().playerText: that value flips to
      // near-white under the light theme, and the cranium is the pale end of
      // the body gradient in BOTH themes, so the marking needs a colour chosen
      // against the skull rather than against the page.
      ctx.fillStyle = "rgba(8,47,73,0.85)";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.min(18, r * 0.42)}px -apple-system, system-ui, sans-serif`;
      ctx.fillText("π", 0, -r * 0.30);

      // Blink: mostly open, with a brief close every few seconds. Driven by a
      // sine threshold rather than a timer so it needs no extra state.
      const blink = Math.sin(t * 1.1) > 0.985 ? 0.1 : 1;

      // --- Eyes -------------------------------------------------------------
      // Big, round, and white, with a dark pupil and two catchlights. Every
      // one of those choices is doing the same job: roundness, a high
      // white-to-pupil ratio and visible highlights are what the eye reads as
      // friendly. The previous solid-black almonds had none of them, which is
      // precisely why they read as a predator.
      const eyeR = r * 0.26;
      const eyeY = r * 0.10;
      const eyeDX = r * 0.32;
      const px = p._lookX * eyeR * 0.30, py = p._lookY * eyeR * 0.30;

      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * eyeDX, eyeY);
        ctx.scale(1, blink);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(0, 0, eyeR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#12263f";
        ctx.beginPath(); ctx.arc(px, py, eyeR * 0.56, 0, Math.PI * 2); ctx.fill();
        // Two highlights, one big and one small: a single dot looks painted
        // on, a pair looks wet.
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.arc(px - eyeR * 0.22, py - eyeR * 0.26, eyeR * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px + eyeR * 0.20, py + eyeR * 0.20, eyeR * 0.10, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Cheeks. Two soft warm patches under the eyes — the cheapest possible
      // signal that this thing means well.
      ctx.fillStyle = "rgba(251,113,133,0.28)";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * r * 0.55, eyeY + r * 0.28, r * 0.14, r * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Mouth ------------------------------------------------------------
      // A wide open grin with rounded corners and a big tongue — no teeth. It
      // grows as π swallows, on the same `_pop` the body pulse uses, so eating
      // stays one reaction read two ways rather than two effects that happen
      // to coincide.
      const openness = p._pop;                     // 0 at rest, 1 mid-swallow
      const mouthY = r * 0.44;
      const mouthW = r * (0.46 + openness * 0.10);
      const mouthH = r * (0.24 + openness * 0.34);

      ctx.save();
      // Half an ellipse closed with a flat top: a "D" on its side, which is
      // the shape of an open smile. A full ellipse would be a gasp.
      ctx.beginPath();
      ctx.moveTo(-mouthW, mouthY - mouthH * 0.32);
      ctx.quadraticCurveTo(0, mouthY - mouthH * 0.55, mouthW, mouthY - mouthH * 0.32);
      ctx.bezierCurveTo(mouthW * 0.98, mouthY + mouthH,
                        -mouthW * 0.98, mouthY + mouthH,
                        -mouthW, mouthY - mouthH * 0.32);
      ctx.closePath();
      ctx.fillStyle = "#3f1d2e";
      ctx.fill();
      // The tongue is clipped to the mouth, so it can never spill over the lip
      // however wide the grin gets.
      ctx.clip();
      ctx.fillStyle = "#fb7185";
      ctx.beginPath();
      ctx.ellipse(0, mouthY + mouthH * 0.78, mouthW * 0.62, mouthH * 0.60, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = theme().playerText;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.min(17, r / 2.2)}px -apple-system, system-ui, sans-serif`;
      ctx.fillText("π", 0, 0);
    }

    ctx.restore();
  }


  function drawParticles(ctx) {
    // Droplets, not sparks: what a bubble leaves behind is liquid, so each one
    // gets the same treatment as its parent in miniature — a tinted body with
    // a white catchlight — and shrinks as it dries rather than only fading.
    for (const q of state.particles) {
      const s = worldToScreen(q.x, q.y);
      const life = Math.max(0, q.life);
      const r = (2.4 * state.camera.zoom + 1) * (0.45 + life * 0.55);
      ctx.fillStyle = rgba(q.color, life * 0.8);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
      if (r > 1.8) {
        ctx.fillStyle = `rgba(255,255,255,${life * 0.6})`;
        ctx.beginPath();
        ctx.arc(s.x - r * 0.3, s.y - r * 0.3, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawHud(ctx, w, h) {
    if (state.mode === "play" && state.player) {
      // Progress is what is left of the map, because clearing the map is the
      // win. A mass bar measured progress toward a number that no longer ends
      // the game.
      const p = state.player;
      const total = state.bubbles.length;
      const left = state.bubbles.reduce((n, b) => n + (b.eaten ? 0 : 1), 0);
      const pct = total ? (total - left) / total : 0;
      ctx.fillStyle = theme().hud; roundRect(ctx, 12, 12, 208, 62, 10); ctx.fill();
      ctx.fillStyle = theme().hudText; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.font = "600 12px -apple-system, system-ui, sans-serif";
      ctx.fillText(`${total - left} / ${total} fields absorbed`, 24, 34);
      ctx.fillStyle = theme().hudDim; ctx.font = "500 11px -apple-system, system-ui, sans-serif";
      ctx.fillText(`Mass ${Math.round(p.mass)} · ${left} left`, 24, 66);
      ctx.fillStyle = theme().track; roundRect(ctx, 24, 42, 184, 8, 4); ctx.fill();
      ctx.fillStyle = pct > 0.75 ? "#22c55e" : "#38bdf8";
      roundRect(ctx, 24, 42, Math.max(4, 184 * pct), 8, 4); ctx.fill();
    }

    const mw = 132, mh = mw * (WORLD_H / WORLD_W);
    const mx = w - mw - 12, my = h - mh - 12;
    ctx.fillStyle = theme().hud; roundRect(ctx, mx, my, mw, mh, 8); ctx.fill();
    for (const b of state.bubbles) {
      if (isGone(b)) continue;
      ctx.fillStyle = rgba(bubbleColor(b), b.live ? 0.85 : 0.4);
      ctx.beginPath();
      ctx.arc(mx + (b.x / WORLD_W) * mw, my + (b.y / WORLD_H) * mh,
              Math.max(0.8, b.mass / 26), 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.mode === "play" && state.player) {
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(mx + (state.player.x / WORLD_W) * mw, my + (state.player.y / WORLD_H) * mh, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function loop(now) {
    if (state.mode === "idle") return;
    const dt = Math.min(0.05, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    if (dt > 0.034) { if (++slowFrames > 45) { effectsQuality = effectsQuality === 1 ? 0.5 : 0; slowFrames = 0; } }
    else if (slowFrames > 0) slowFrames--;
    update(dt);
    if (state.mode === "idle") return;
    draw();
    state.raf = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------
  // Input — the same canvas serves both modes.
  // ---------------------------------------------------------------------
  function bubbleAt(sx, sy) {
    const w = screenToWorld(sx, sy);
    let hit = null;
    for (const b of state.bubbles) {
      if (isGone(b)) continue;
      if (Math.hypot(b.x - w.x, b.y - w.y) <= b.mass) {
        if (!hit || b.mass < hit.mass) hit = b;   // prefer the smallest under cursor
      }
    }
    return hit;
  }

  function bindInput() {
    const c = state.canvas;

    c.addEventListener("mousedown", e => {
      if (state.mode !== "explore") return;
      // Grabbing a bubble takes precedence over panning the canvas: a press
      // that starts on a node is almost always meant to move that node.
      const p = canvasPos(e.clientX, e.clientY);
      const hit = bubbleAt(p.x, p.y);
      if (hit) {
        state.grabbed = { bubble: hit, moved: false };
        c.style.cursor = "grabbing";
        return;
      }
      state.drag = { sx: e.clientX, sy: e.clientY, cx: state.camera.x, cy: state.camera.y, moved: false };
    });

    window.addEventListener("mouseup", e => {
      if (state.mode === "explore") {
        if (state.grabbed) {
          // A grab that never moved is a click, so it selects instead.
          if (!state.grabbed.moved) selectBubble(state.grabbed.bubble);
          state.grabbed = null;
          c.style.cursor = "grab";
        } else if (state.drag && !state.drag.moved) {
          const p = canvasPos(e.clientX, e.clientY);
          if (p.x >= 0 && p.y >= 0 && p.x <= viewW() && p.y <= viewH()) selectBubble(bubbleAt(p.x, p.y));
        }
      }
      state.drag = null;
    });

    c.addEventListener("mousemove", e => {
      if (state.mode === "play") {
        const p = canvasPos(e.clientX, e.clientY);
        const w = screenToWorld(p.x, p.y);
        state.pointer = { x: w.x, y: w.y, active: true };
        return;
      }
      if (state.grabbed) {
        const p = canvasPos(e.clientX, e.clientY);
        const w = screenToWorld(p.x, p.y);
        const b = state.grabbed.bubble;
        const px = b.x, py = b.y;
        b.x = Math.max(b.mass, Math.min(WORLD_W - b.mass, w.x));
        b.y = Math.max(b.mass, Math.min(WORLD_H - b.mass, w.y));
        // A dragged bubble stops drifting, otherwise it slides out from under
        // the cursor and immediately undoes the arrangement being made.
        b.vx = 0; b.vy = 0;
        // Neighbours follow. The edges are drawn to say "these fields are
        // related", and a map where you can pull one node clean out of its
        // own constellation contradicts the line still joining them. Pulling
        // is elastic rather than rigid: a neighbour is nudged along a fraction
        // of the movement, so the cluster deforms and settles instead of
        // moving as a single block.
        dragNeighbours(b, b.x - px, b.y - py);
        state.grabbed.moved = true;
        return;
      }
      if (state.drag) {
        const dx = e.clientX - state.drag.sx, dy = e.clientY - state.drag.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.drag.moved = true;
        state.camera.x = state.drag.cx - dx / state.camera.zoom;
        state.camera.y = state.drag.cy - dy / state.camera.zoom;
        clampCamera();
      }
    });

    c.addEventListener("mouseleave", () => { state.pointer.active = false; });

    c.addEventListener("wheel", e => {
      if (state.mode !== "explore") return;
      e.preventDefault();
      // Zoom toward the cursor, so the point under the pointer stays put.
      const p = canvasPos(e.clientX, e.clientY);
      const before = screenToWorld(p.x, p.y);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      state.camera.zoom = Math.max(0.18, Math.min(2.2, state.camera.zoom * factor));
      state.userZoomed = true;
      const after = screenToWorld(p.x, p.y);
      state.camera.x += before.x - after.x;
      state.camera.y += before.y - after.y;
      clampCamera();
    }, { passive: false });

    // --- touch: drag pans in explore, steers in play; pinch zooms ---
    let pinch = null;
    const touchStart = e => {
      if (state.mode === "play") { touchMove(e); return; }
      if (e.touches.length === 2) {
        pinch = { d: touchDist(e), zoom: state.camera.zoom };
        state.grabbed = null;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        const p = canvasPos(t.clientX, t.clientY);
        const hit = bubbleAt(p.x, p.y);
        if (hit) { state.grabbed = { bubble: hit, moved: false }; return; }
        state.drag = { sx: t.clientX, sy: t.clientY, cx: state.camera.x, cy: state.camera.y, moved: false };
      }
    };
    const touchMove = e => {
      if (!e.touches.length) return;
      e.preventDefault();
      if (state.mode === "play") {
        const p = canvasPos(e.touches[0].clientX, e.touches[0].clientY);
        const w = screenToWorld(p.x, p.y);
        state.pointer = { x: w.x, y: w.y, active: true };
        return;
      }
      if (e.touches.length === 2 && pinch) {
        state.camera.zoom = Math.max(0.18, Math.min(2.2, pinch.zoom * (touchDist(e) / pinch.d)));
        state.userZoomed = true;
        clampCamera();
      } else if (state.grabbed) {
        const p = canvasPos(e.touches[0].clientX, e.touches[0].clientY);
        const w = screenToWorld(p.x, p.y);
        const b = state.grabbed.bubble;
        b.x = Math.max(b.mass, Math.min(WORLD_W - b.mass, w.x));
        b.y = Math.max(b.mass, Math.min(WORLD_H - b.mass, w.y));
        b.vx = 0; b.vy = 0;
        state.grabbed.moved = true;
      } else if (state.drag) {
        const t = e.touches[0];
        const dx = t.clientX - state.drag.sx, dy = t.clientY - state.drag.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.drag.moved = true;
        state.camera.x = state.drag.cx - dx / state.camera.zoom;
        state.camera.y = state.drag.cy - dy / state.camera.zoom;
        clampCamera();
      }
    };
    const touchEnd = e => {
      if (state.mode === "play") { state.pointer.active = false; return; }
      if (state.grabbed) {
        if (!state.grabbed.moved) selectBubble(state.grabbed.bubble);
        state.grabbed = null;
        state.drag = null; pinch = null;
        return;
      }
      if (state.drag && !state.drag.moved && e.changedTouches.length) {
        const p = canvasPos(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        selectBubble(bubbleAt(p.x, p.y));
      }
      state.drag = null; pinch = null;
    };
    c.addEventListener("touchstart", touchStart, { passive: false });
    c.addEventListener("touchmove", touchMove, { passive: false });
    c.addEventListener("touchend", touchEnd);

    window.addEventListener("keydown", e => {
      if (state.mode === "idle") return;
      if (e.key === "Escape") { abandonRun(); return; }
      if (state.mode !== "play") return;
      state.keys.add(e.key);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
    });
    window.addEventListener("keyup", e => state.keys.delete(e.key));
    window.addEventListener("resize", () => { if (state.mode !== "idle") resize(); });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { stopLoop(); if (state.mode === "play") setMessage("Paused — returns when you come back.", "info"); }
      else if (state.mode !== "idle") { setMessage("", ""); startLoop(); }
    });
  }

  function touchDist(e) {
    return Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                      e.touches[0].clientY - e.touches[1].clientY);
  }

  // Keep the world on screen: without this, panning flings the map into empty
  // space with no way back except reloading.
  function clampCamera() {
    const marginX = viewW() / (2 * state.camera.zoom);
    const marginY = viewH() / (2 * state.camera.zoom);
    state.camera.x = Math.max(-marginX * 0.5, Math.min(WORLD_W + marginX * 0.5, state.camera.x));
    state.camera.y = Math.max(-marginY * 0.5, Math.min(WORLD_H + marginY * 0.5, state.camera.y));
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function bindControls() {
    const search = document.getElementById("arcadeSearch");
    const minPapers = document.getElementById("arcadeMinPapers");
    const minOut = document.getElementById("arcadeMinPapersOut");
    const labels = document.getElementById("arcadeLabels");
    const mesh = document.getElementById("arcadeMesh");
    const scale = document.getElementById("arcadeScale");
    const scaleOut = document.getElementById("arcadeScaleOut");

    // The author control is a tag input owned by app.js's shared tag system,
    // which calls back through ScholarPiArcade.applyFilters when tags change.
    // Sound toggle. Bound here with the other controls, and reflected into the
    // button label immediately so its state is readable without pressing it.
    const soundBtn = document.getElementById("arcadeSoundBtn");
    if (soundBtn) {
      setSound(soundOn, false);                // paint the preference, silently
      soundBtn.addEventListener("click", () => setSound(!soundOn));
    }

    search.addEventListener("input", () => { state.filters.search = search.value; applyFilters(); });
    minPapers.addEventListener("input", () => {
      state.filters.minPapers = parseInt(minPapers.value, 10) || 0;
      minOut.textContent = state.filters.minPapers;
      applyFilters();
    });
    labels.addEventListener("change", () => { state.look.labels = labels.checked; });
    mesh.addEventListener("change", () => { state.look.mesh = mesh.checked; });
    const gravity = document.getElementById("arcadeGravity");
    gravity.addEventListener("change", () => { state.look.gravity = gravity.checked; });
    scale.addEventListener("input", () => {
      state.look.scale = parseFloat(scale.value) || 1;
      scaleOut.textContent = state.look.scale.toFixed(1) + "×";
    });

    document.getElementById("arcadeResetFilters").addEventListener("click", () => {
      state.filters = { search: "", minPapers: 0, liveOnly: false, author: "" };
      search.value = ""; author.value = "";
      minPapers.value = "0"; minOut.textContent = "0";
      applyFilters();
    });

    // Selecting a legend row focuses that field on the map, so the table and
    // the canvas are two views of one selection rather than separate lists.
    document.querySelector("#arcadeLegendTable tbody").addEventListener("click", e => {
      const row = e.target.closest("tr[data-field]");
      if (row) focusField(row.dataset.field);
    });
  }

  function init() {
    state.canvas = document.getElementById("arcadeCanvas");
    if (!state.canvas) return;
    state.ctx = state.canvas.getContext("2d");
    bindInput();
    selectBubble(null);

    bindControls();
    document.getElementById("arcadePlayBtn").addEventListener("click", startRun);
    document.getElementById("arcadeExitBtn").addEventListener("click", abandonRun);
    document.getElementById("arcadeRefreshBtn").addEventListener("click", () => enterExplore(true));
    document.getElementById("arcadeOverlayAgain").addEventListener("click", startRun);
    document.getElementById("arcadeOverlayClose").addEventListener("click", () => {
      document.getElementById("arcadeOverlay").classList.add("hidden");
      state.mode = "explore";
      state.player = null;
      // Same reason as abandonRun: the finished run consumed bubbles, so the
      // map has to be rebuilt from the corpus to be truthful again.
      enterExplore(true);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.ScholarPiArcade = { exit, open: () => enterExplore(false), applyFilters };
})();
