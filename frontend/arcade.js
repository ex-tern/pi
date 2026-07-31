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

  const DOMAIN_COLORS = {
    "Physics": "#6366f1", "Chemistry": "#14b8a6", "Biology": "#22c55e",
    "Medicine": "#ef4444", "Neuroscience": "#a855f7", "Computer Science": "#3b82f6",
    "Mathematics": "#f59e0b", "Materials": "#64748b", "Climate": "#0ea5e9",
    "Genomics": "#ec4899", "Astronomy": "#8b5cf6", "Economics": "#84cc16",
    "Psychology": "#f97316", "Engineering": "#06b6d4", "Ecology": "#10b981",
  };
  const FALLBACK_COLORS = ["#f472b6", "#38bdf8", "#a3e635", "#fbbf24", "#c084fc", "#2dd4bf"];

  // Fields discovered from the corpus won't be in the palette above. Hash the
  // name to a stable colour so the same field is the same colour every load.
  function colorFor(domain) {
    if (DOMAIN_COLORS[domain]) return DOMAIN_COLORS[domain];
    let h = 0;
    for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) >>> 0;
    return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
  }

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
    filters: { search: "", minPapers: 0, liveOnly: false },
    look: { labels: true, mesh: true, scale: 1 },
  };

  // Filters DIM bubbles rather than removing them. Removal would change what
  // is physically present in the playfield, which the server's replay knows
  // nothing about — an honest player could then be rejected for eating a
  // bubble the server still has, or blocked by one they cannot see. Dimming
  // is purely a rendering concern and can never desynchronise a run.
  function applyFilters() {
    const f = state.filters;
    const needle = f.search.trim().toLowerCase();
    let shown = 0;
    for (const b of state.bubbles) {
      const matches =
        (!needle || b.domain.toLowerCase().includes(needle)) &&
        b.papers >= f.minPapers &&
        (!f.liveOnly || b.live);
      b.dimmed = !matches;
      if (matches) shown++;
    }
    const summary = document.getElementById("arcadeFilterSummary");
    if (summary) {
      const total = state.bubbles.length;
      summary.textContent = shown === total ? "All fields" : `${shown} of ${total}`;
    }
    renderLegend();
  }

  function renderLegend() {
    const body = document.querySelector("#arcadeLegendTable tbody");
    if (!body) return;
    const visible = new Set(state.bubbles.filter(b => !b.dimmed).map(b => b.domain));
    const rows = state.legend.filter(r => visible.has(r.field));
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
      .filter(b => !b.eaten && b.domain === name)
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
  }
  function viewW() { return state.canvas.width / state.dpr; }
  function viewH() { return state.canvas.height / state.dpr; }
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
      const res = await fetch("/api/arcade/start");
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
    state.selected = null;
    state.over = false;
    state.submitting = false;
    state.bubbles = data.field.map(b => ({
      id: b.id, mass: b.mass, domain: b.domain,
      papers: b.papers || 0, live: !!b.live,
      x: b.x * WORLD_W, y: b.y * WORLD_H,
      vx: b.vx * WORLD_W, vy: b.vy * WORLD_H,
      eaten: false, dimmed: false, pulse: Math.random() * Math.PI * 2,
    }));
    state.legend = data.legend || [];
    applyFilters();

    seedStars();
    renderWalletState(data.wallet_state, data.reward);
    renderCorpusSummary(data.corpus);
    setMessage("", "");
    state.loading = false;
    return true;
  }

  function renderCorpusSummary(corpus) {
    const el = document.getElementById("arcadeCorpus");
    if (!el || !corpus) return;
    if (corpus.is_empty) {
      el.innerHTML = `<strong>No papers assessed yet.</strong> The map is showing the base
        taxonomy of science. Assess a manuscript and its field grows here.`;
    } else {
      el.innerHTML = `<strong>${corpus.total_papers}</strong> assessed
        paper${corpus.total_papers === 1 ? "" : "s"} across
        <strong>${corpus.fields_with_papers}</strong> live
        field${corpus.fields_with_papers === 1 ? "" : "s"}. Solid bubbles are your corpus;
        faint ones are unexplored territory.`;
    }
  }

  // ---------------------------------------------------------------------
  // Mode transitions
  // ---------------------------------------------------------------------
  async function enterExplore(force) {
    document.getElementById("arcadeStage").classList.remove("hidden");
    if (force || !state.bubbles.length) {
      if (!await loadField()) return;
    }
    state.mode = "explore";
    state.player = null;
    state.camera.zoom = 0.34;
    state.camera.x = WORLD_W / 2;
    state.camera.y = WORLD_H / 2;
    syncModeUi();
    resize();
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
    document.getElementById("arcadeModeHint").textContent = playing
      ? "Move to absorb smaller fields. Esc exits."
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
    setMessage(won ? "Verifying your run…" : "Recording your run…", "info");
    let data;
    try {
      const res = await fetch("/api/arcade/finish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: state.token, duration_ms: duration, absorbed: state.absorbed }),
      });
      data = await res.json();
    } catch (err) {
      setMessage("Run finished but could not be submitted: " + err.message, "bad");
      showOverlay(won, null);
      return;
    }
    if (!data.valid) {
      setMessage("Run rejected: " + (data.reason || "verification failed") + ".", "bad");
    } else if (data.granted > 0) {
      setMessage(data.message, "good");
      if (window.ScholarPi && typeof window.ScholarPi.refreshTrialStatus === "function") {
        window.ScholarPi.refreshTrialStatus();
      }
    } else {
      setMessage(data.message || "Run recorded.", won ? "info" : "");
    }
    showOverlay(won, data);
  }

  function showOverlay(won, data) {
    const overlay = document.getElementById("arcadeOverlay");
    if (!overlay) return;
    document.getElementById("arcadeOverlayTitle").textContent = won ? "Field absorbed" : "Consumed";
    const mass = (data && data.final_mass) || Math.round(state.player ? state.player.mass : 0);
    const eatenLive = state.bubbles.filter(b => b.eaten && b.live).length;
    const parts = [
      `Final mass <strong>${mass}</strong> of ${state.rules.win_mass} needed.`,
      `Absorbed <strong>${state.absorbed.length}</strong> fields` +
        (eatenLive ? `, ${eatenLive} of them carrying real papers.` : "."),
    ];
    if (data && data.granted > 0) {
      parts.push(`<span class="arcade-reward">+${data.granted} free assessments unlocked.</span>`);
    } else if (won && data && data.message) {
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
    const bits = [`Earned <strong>${wallet.bonus_earned}</strong> / ${wallet.cap} bonus assessments.`];
    if (wallet.cooldown_remaining > 0) {
      bits.push(`Next reward in ${(wallet.cooldown_remaining / 3600).toFixed(1)}h.`);
    } else if (wallet.bonus_earned < wallet.cap) {
      bits.push(`A win is worth ${reward.per_win}.`);
    } else {
      bits.push("Cap reached — connect a wallet or ORCID to continue.");
    }
    el.innerHTML = bits.join(" ");
  }

  function selectBubble(b) {
    state.selected = b;
    const panel = document.getElementById("arcadeDetail");
    if (!panel) return;
    if (!b) { panel.innerHTML = `<p class="arcade-detail-empty">Select a field to inspect it.</p>`; return; }
    const avg = b.papers ? "" : "";
    panel.innerHTML = `
      <div class="arcade-detail-head">
        <span class="arcade-swatch" style="background:${colorFor(b.domain)}"></span>
        <strong>${escapeHtml(b.domain)}</strong>
      </div>
      <dl class="arcade-detail-rows">
        <div><dt>Assessed papers</dt><dd>${b.papers}</dd></div>
        <div><dt>Map weight</dt><dd>${b.mass.toFixed(1)}</dd></div>
        <div><dt>Status</dt><dd>${b.live ? "In your corpus" : "Unexplored"}</dd></div>
      </dl>
      ${b.live
        ? `<p class="arcade-detail-note">This field is part of your assessed corpus. Its size on
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
  function drift(dt) {
    for (const b of state.bubbles) {
      if (b.eaten) continue;
      b.x += b.vx * dt * 60;
      b.y += b.vy * dt * 60;
      if (b.x < b.mass || b.x > WORLD_W - b.mass) b.vx *= -1;
      if (b.y < b.mass || b.y > WORLD_H - b.mass) b.vy *= -1;
      b.pulse += dt * 1.6;
    }
  }

  function update(dt) {
    drift(dt);
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const q = state.particles[i];
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 0.94; q.vy *= 0.94;
      q.life -= q.decay * dt;
      if (q.life <= 0) state.particles.splice(i, 1);
    }
    if (state.mode !== "play" || !state.player) return;

    const p = state.player;
    const speed = 420 / (1 + p.mass / 46);
    let dx = 0, dy = 0;
    if (state.pointer.active) { dx = state.pointer.x - p.x; dy = state.pointer.y - p.y; }
    if (state.keys.has("ArrowLeft") || state.keys.has("a")) dx -= 100;
    if (state.keys.has("ArrowRight") || state.keys.has("d")) dx += 100;
    if (state.keys.has("ArrowUp") || state.keys.has("w")) dy -= 100;
    if (state.keys.has("ArrowDown") || state.keys.has("s")) dy += 100;

    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      const throttle = Math.min(1, dist / 60);
      p.x += (dx / dist) * speed * throttle * dt;
      p.y += (dy / dist) * speed * throttle * dt;
    }
    p.x = Math.max(p.mass, Math.min(WORLD_W - p.mass, p.x));
    p.y = Math.max(p.mass, Math.min(WORLD_H - p.mass, p.y));

    for (const b of state.bubbles) {
      if (b.eaten) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < Math.max(b.mass, p.mass) * 0.86) {
        if (b.mass < p.mass) {
          b.eaten = true;
          p.mass += b.mass * state.rules.absorb_ratio;
          state.absorbed.push({ id: b.id, t: Math.round(performance.now() - state.startedAt) });
          spawnBurst(b.x, b.y, colorFor(b.domain), b.live ? 26 : 14);
          selectBubble(b);          // absorbing IS inspecting
        } else {
          spawnBurst(p.x, p.y, "#ef4444", 40);
          endRun(false);
          return;
        }
      }
    }

    if (p.mass >= state.rules.win_mass) { spawnBurst(p.x, p.y, "#22c55e", 90); endRun(true); return; }

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
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#070b1c"); g.addColorStop(1, "#0d1430");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    drawStars(ctx, w, h);
    if (effectsQuality > 0 && state.look.mesh) drawMesh(ctx);
    for (const b of state.bubbles) if (!b.eaten) drawBubble(ctx, b);
    drawParticles(ctx);
    if (state.mode === "play" && state.player) drawPlayer(ctx);
    drawHud(ctx, w, h);
  }

  function drawStars(ctx, w, h) {
    const z = state.camera.zoom;
    for (const s of state.stars) {
      const px = (s.x - state.camera.x) * z * s.depth + w / 2;
      const py = (s.y - state.camera.y) * z * s.depth + h / 2;
      if (px < -10 || px > w + 10 || py < -10 || py > h + 10) continue;
      s.tw += 0.02;
      ctx.fillStyle = `rgba(190,215,255,${(0.25 + Math.abs(Math.sin(s.tw)) * 0.5) * s.depth})`;
      ctx.beginPath(); ctx.arc(px, py, s.r * s.depth, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawMesh(ctx) {
    const live = state.bubbles.filter(b => !b.eaten);
    const limit = effectsQuality === 1 ? 260 : 150;
    ctx.lineWidth = 1;
    for (let i = 0; i < live.length; i++) {
      const a = live[i], sa = worldToScreen(a.x, a.y);
      if (sa.x < -200 || sa.x > viewW() + 200 || sa.y < -200 || sa.y > viewH() + 200) continue;
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        if (a.domain !== b.domain) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > limit) continue;
        const sb = worldToScreen(b.x, b.y);
        ctx.strokeStyle = rgba(colorFor(a.domain), 0.16 * (1 - d / limit));
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      }
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
    const color = colorFor(b.domain);
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

    ctx.fillStyle = rgba(color, playing && !edible ? 0.42 : baseAlpha);
    ctx.beginPath(); ctx.arc(s.x, s.y, r * pulse, 0, Math.PI * 2); ctx.fill();

    if (playing && !edible) { ctx.lineWidth = 2.6; ctx.strokeStyle = "#fca5a5"; }
    else if (isSelected)    { ctx.lineWidth = 3;   ctx.strokeStyle = "#ffffff"; }
    else                    { ctx.lineWidth = b.live ? 1.6 : 1; ctx.strokeStyle = rgba(color, 0.9); }
    ctx.stroke();

    if (r > 20 && state.look.labels) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = b.live ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.6)";
      ctx.font = `600 ${Math.min(15, r / 2.8)}px -apple-system, system-ui, sans-serif`;
      ctx.fillText(b.domain, s.x, s.y - (b.live && r > 34 ? 7 : 0));
      if (b.live && r > 34) {
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = `500 ${Math.min(12, r / 4)}px -apple-system, system-ui, sans-serif`;
        ctx.fillText(`${b.papers} paper${b.papers === 1 ? "" : "s"}`, s.x, s.y + 9);
      }
    }
  }

  /** A filtered-out field: still drawn, so the map keeps its shape, but
   *  pushed into the background so the matching set reads clearly. */
  function drawDimmed(ctx, s, r, b) {
    if (s.x + r < 0 || s.x - r > viewW() || s.y + r < 0 || s.y - r > viewH()) return;
    ctx.fillStyle = "rgba(148,163,184,0.10)";
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(148,163,184,0.22)"; ctx.stroke();
  }

  function drawPlayer(ctx) {
    const p = state.player, s = worldToScreen(p.x, p.y), r = p.mass * state.camera.zoom;
    if (effectsQuality > 0) {
      const glow = ctx.createRadialGradient(s.x, s.y, r * 0.1, s.x, s.y, r * 2.1);
      glow.addColorStop(0, "rgba(56,189,248,0.5)"); glow.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 2.1, 0, Math.PI * 2); ctx.fill();
    }
    const body = ctx.createRadialGradient(s.x - r * 0.3, s.y - r * 0.3, r * 0.1, s.x, s.y, r);
    body.addColorStop(0, "#e0f2fe"); body.addColorStop(1, "#0284c7");
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#7dd3fc"; ctx.stroke();
    ctx.fillStyle = "#083344"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.min(17, r / 2.2)}px -apple-system, system-ui, sans-serif`;
    ctx.fillText("π", s.x, s.y);
  }

  function drawParticles(ctx) {
    for (const q of state.particles) {
      const s = worldToScreen(q.x, q.y);
      ctx.fillStyle = rgba(q.color, Math.max(0, q.life) * 0.8);
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.4 * state.camera.zoom + 1, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawHud(ctx, w, h) {
    if (state.mode === "play" && state.player) {
      const p = state.player, pct = Math.min(1, p.mass / state.rules.win_mass);
      ctx.fillStyle = "rgba(8,12,28,0.72)"; roundRect(ctx, 12, 12, 208, 62, 10); ctx.fill();
      ctx.fillStyle = "#e2e8f0"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.font = "600 12px -apple-system, system-ui, sans-serif";
      ctx.fillText(`Mass ${Math.round(p.mass)} / ${state.rules.win_mass}`, 24, 34);
      ctx.fillStyle = "#94a3b8"; ctx.font = "500 11px -apple-system, system-ui, sans-serif";
      ctx.fillText(`${state.absorbed.length} fields absorbed`, 24, 66);
      ctx.fillStyle = "rgba(255,255,255,0.14)"; roundRect(ctx, 24, 42, 184, 8, 4); ctx.fill();
      ctx.fillStyle = pct > 0.75 ? "#22c55e" : "#38bdf8";
      roundRect(ctx, 24, 42, Math.max(4, 184 * pct), 8, 4); ctx.fill();
    }

    const mw = 132, mh = mw * (WORLD_H / WORLD_W);
    const mx = w - mw - 12, my = h - mh - 12;
    ctx.fillStyle = "rgba(8,12,28,0.72)"; roundRect(ctx, mx, my, mw, mh, 8); ctx.fill();
    for (const b of state.bubbles) {
      if (b.eaten) continue;
      ctx.fillStyle = rgba(colorFor(b.domain), b.live ? 0.85 : 0.4);
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
      if (b.eaten) continue;
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
      state.drag = { sx: e.clientX, sy: e.clientY, cx: state.camera.x, cy: state.camera.y, moved: false };
    });

    window.addEventListener("mouseup", e => {
      if (state.mode === "explore" && state.drag && !state.drag.moved) {
        const p = canvasPos(e.clientX, e.clientY);
        if (p.x >= 0 && p.y >= 0 && p.x <= viewW() && p.y <= viewH()) selectBubble(bubbleAt(p.x, p.y));
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
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
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
        clampCamera();
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
    const liveOnly = document.getElementById("arcadeLiveOnly");
    const labels = document.getElementById("arcadeLabels");
    const mesh = document.getElementById("arcadeMesh");
    const scale = document.getElementById("arcadeScale");
    const scaleOut = document.getElementById("arcadeScaleOut");

    search.addEventListener("input", () => { state.filters.search = search.value; applyFilters(); });
    minPapers.addEventListener("input", () => {
      state.filters.minPapers = parseInt(minPapers.value, 10) || 0;
      minOut.textContent = state.filters.minPapers;
      applyFilters();
    });
    liveOnly.addEventListener("change", () => { state.filters.liveOnly = liveOnly.checked; applyFilters(); });
    labels.addEventListener("change", () => { state.look.labels = labels.checked; });
    mesh.addEventListener("change", () => { state.look.mesh = mesh.checked; });
    scale.addEventListener("input", () => {
      state.look.scale = parseFloat(scale.value) || 1;
      scaleOut.textContent = state.look.scale.toFixed(1) + "×";
    });

    document.getElementById("arcadeResetFilters").addEventListener("click", () => {
      state.filters = { search: "", minPapers: 0, liveOnly: false };
      search.value = ""; minPapers.value = "0"; minOut.textContent = "0"; liveOnly.checked = false;
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

  window.ScholarPiArcade = { exit, open: () => enterExplore(false) };
})();
