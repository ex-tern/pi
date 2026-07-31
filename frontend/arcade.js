/* ===========================================================================
 * Science Map Arcade — an interactive map of science you play by absorbing it.
 *
 * The field of bubbles is issued and signed by the server (/api/arcade/start),
 * and every absorption is recorded with its elapsed timestamp so the server can
 * replay the run in arcade.py. Nothing here decides the reward: this file only
 * renders and reports. Editing it to claim a win produces a run the server's
 * replay rejects.
 *
 * Works with mouse, touch, and keyboard. Rendering is a single canvas with a
 * device-pixel-ratio aware backing store, so it stays sharp on phones.
 * ======================================================================== */
(function () {
  "use strict";

  const WORLD_W = 3400;
  const WORLD_H = 2200;

  // Domain palette. Hues are spread far enough apart to stay distinguishable
  // for the most common forms of colour-vision deficiency, and every bubble
  // also carries its domain name as a label, so colour is never the only cue.
  const DOMAIN_COLORS = {
    "Physics": "#6366f1", "Chemistry": "#14b8a6", "Biology": "#22c55e",
    "Medicine": "#ef4444", "Neuroscience": "#a855f7", "Computer Science": "#3b82f6",
    "Mathematics": "#f59e0b", "Materials": "#64748b", "Climate": "#0ea5e9",
    "Genomics": "#ec4899", "Astronomy": "#8b5cf6", "Economics": "#84cc16",
    "Psychology": "#f97316", "Engineering": "#06b6d4", "Ecology": "#10b981",
  };

  const state = {
    running: false,
    over: false,
    canvas: null,
    ctx: null,
    dpr: 1,
    rules: null,
    token: null,
    bubbles: [],
    absorbed: [],       // [{id, t}] — the run record the server replays
    player: null,
    pointer: { x: 0, y: 0, active: false },
    keys: new Set(),
    camera: { x: 0, y: 0, zoom: 1 },
    startedAt: 0,
    lastFrame: 0,
    raf: null,
    particles: [],
    stars: [],
    submitting: false,
  };

  // ---------------------------------------------------------------------
  // Ambient background: drifting stars plus a soft connective mesh. This is
  // the pk910-style depth effect. It is purely decorative and is the first
  // thing dropped when the device is slow (see FRAME BUDGET below).
  // ---------------------------------------------------------------------
  let effectsQuality = 1;   // 1 = full, 0.5 = reduced, 0 = off
  let slowFrames = 0;

  function seedStars() {
    state.stars = [];
    const count = 220;
    for (let i = 0; i < count; i++) {
      state.stars.push({
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        r: 0.4 + Math.random() * 1.5,
        depth: 0.25 + Math.random() * 0.75,
        tw: Math.random() * Math.PI * 2,
      });
    }
  }

  function spawnBurst(x, y, color, n) {
    if (effectsQuality === 0) return;
    const count = Math.round(n * effectsQuality);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 180;
      state.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 0.9 + Math.random() * 1.4, color,
      });
    }
    // Hard ceiling: a long run should never accumulate unbounded particles.
    if (state.particles.length > 400) {
      state.particles.splice(0, state.particles.length - 400);
    }
  }

  // ---------------------------------------------------------------------
  // Setup
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
    return {
      x: (wx - state.camera.x) * z + viewW() / 2,
      y: (wy - state.camera.y) * z + viewH() / 2,
    };
  }

  // ---------------------------------------------------------------------
  // Run lifecycle
  // ---------------------------------------------------------------------
  async function startRun() {
    const btn = document.getElementById("arcadeStartBtn");
    const msg = document.getElementById("arcadeMessage");
    if (btn) { btn.disabled = true; btn.textContent = "Loading field…"; }
    setMessage("", "");

    let data;
    try {
      const res = await fetch("/api/arcade/start");
      if (!res.ok) throw new Error("Server returned " + res.status);
      data = await res.json();
    } catch (err) {
      setMessage("Could not start a run: " + err.message +
        ". The arcade needs the ScholarPi server to be reachable.", "bad");
      if (btn) { btn.disabled = false; btn.textContent = "Play"; }
      return;
    }

    state.token = data.token;
    state.rules = data.rules;
    state.absorbed = [];
    state.particles = [];
    state.over = false;
    state.submitting = false;

    state.bubbles = data.field.map(b => ({
      id: b.id,
      mass: b.mass,
      domain: b.domain,
      x: b.x * WORLD_W,
      y: b.y * WORLD_H,
      vx: b.vx * WORLD_W,
      vy: b.vy * WORLD_H,
      eaten: false,
      pulse: Math.random() * Math.PI * 2,
    }));

    // Place the player in the least crowded quadrant so the opening is fair
    // regardless of how the seed happened to scatter the field.
    const spawn = findSafeSpawn();
    state.player = { x: spawn.x, y: spawn.y, mass: data.rules.start_mass, vx: 0, vy: 0 };
    state.camera = { x: spawn.x, y: spawn.y, zoom: 1 };
    state.pointer = { x: spawn.x, y: spawn.y, active: false };

    seedStars();
    renderWalletState(data.wallet_state, data.reward);

    state.running = true;
    state.startedAt = performance.now();
    state.lastFrame = state.startedAt;

    document.getElementById("arcadeStage").classList.remove("hidden");
    document.getElementById("arcadeIntro").classList.add("hidden");
    resize();
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(loop);
    if (btn) { btn.disabled = false; btn.textContent = "Play"; }
  }

  function findSafeSpawn() {
    let best = null;
    for (let i = 0; i < 40; i++) {
      const x = WORLD_W * (0.15 + Math.random() * 0.7);
      const y = WORLD_H * (0.15 + Math.random() * 0.7);
      let nearestThreat = Infinity;
      for (const b of state.bubbles) {
        if (b.mass <= state.rules.start_mass) continue;
        const d = Math.hypot(b.x - x, b.y - y);
        if (d < nearestThreat) nearestThreat = d;
      }
      if (!best || nearestThreat > best.d) best = { x, y, d: nearestThreat };
    }
    return best || { x: WORLD_W / 2, y: WORLD_H / 2 };
  }

  function exitRun(reason) {
    state.running = false;
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
    document.getElementById("arcadeStage").classList.add("hidden");
    document.getElementById("arcadeIntro").classList.remove("hidden");
    if (reason) setMessage(reason, "info");
  }

  function endRun(won) {
    if (state.over) return;
    state.over = true;
    state.running = false;
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: state.token,
          duration_ms: duration,
          absorbed: state.absorbed,
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
    } else if (data.granted > 0) {
      setMessage(data.message, "good");
      // Refresh the trial banner in app.js so the new allowance is visible
      // immediately rather than on the next page load.
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
    const title = document.getElementById("arcadeOverlayTitle");
    const body = document.getElementById("arcadeOverlayBody");
    if (!overlay) return;
    title.textContent = won ? "Field absorbed" : "Consumed";
    const mass = data && data.final_mass ? data.final_mass : Math.round(state.player.mass);
    const parts = [
      `Final mass <strong>${mass}</strong> of ${state.rules.win_mass} needed.`,
      `Absorbed <strong>${state.absorbed.length}</strong> of ${state.bubbles.length} fields.`,
    ];
    if (data && data.granted > 0) {
      parts.push(`<span class="arcade-reward">+${data.granted} free assessments unlocked.</span>`);
    } else if (won) {
      parts.push(data && data.message ? data.message : "");
    } else {
      parts.push("You ran into something larger. Grow on the small fields first.");
    }
    body.innerHTML = parts.filter(Boolean).map(p => `<p>${p}</p>`).join("");
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

  // ---------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------
  function update(dt) {
    const p = state.player;

    // Larger bubbles are slower. This is what makes the endgame a real
    // decision rather than a formality — mass buys safety but costs reach.
    const speed = 420 / (1 + p.mass / 46);

    let dx = 0, dy = 0;
    if (state.pointer.active) {
      dx = state.pointer.x - p.x;
      dy = state.pointer.y - p.y;
    }
    if (state.keys.has("ArrowLeft") || state.keys.has("a")) dx -= 100;
    if (state.keys.has("ArrowRight") || state.keys.has("d")) dx += 100;
    if (state.keys.has("ArrowUp") || state.keys.has("w")) dy -= 100;
    if (state.keys.has("ArrowDown") || state.keys.has("s")) dy += 100;

    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      // Ease in over the last few pixels so the bubble settles instead of
      // jittering around the cursor.
      const throttle = Math.min(1, dist / 60);
      p.x += (dx / dist) * speed * throttle * dt;
      p.y += (dy / dist) * speed * throttle * dt;
    }
    p.x = Math.max(p.mass, Math.min(WORLD_W - p.mass, p.x));
    p.y = Math.max(p.mass, Math.min(WORLD_H - p.mass, p.y));

    // Drift the field and bounce it off the world edges.
    for (const b of state.bubbles) {
      if (b.eaten) continue;
      b.x += b.vx * dt * 60;
      b.y += b.vy * dt * 60;
      if (b.x < b.mass || b.x > WORLD_W - b.mass) b.vx *= -1;
      if (b.y < b.mass || b.y > WORLD_H - b.mass) b.vy *= -1;
      b.pulse += dt * 1.6;

      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < Math.max(b.mass, p.mass) * 0.86) {
        if (b.mass < p.mass) {
          absorb(b);
        } else {
          spawnBurst(p.x, p.y, "#ef4444", 40);
          endRun(false);
          return;
        }
      }
    }

    if (p.mass >= state.rules.win_mass) {
      spawnBurst(p.x, p.y, "#22c55e", 90);
      endRun(true);
      return;
    }

    // Camera: follow with lag, and zoom out as the player grows so the
    // playfield stays legible at every scale.
    const targetZoom = Math.max(0.34, Math.min(1.15, 46 / p.mass));
    state.camera.zoom += (targetZoom - state.camera.zoom) * Math.min(1, dt * 2.4);
    state.camera.x += (p.x - state.camera.x) * Math.min(1, dt * 6);
    state.camera.y += (p.y - state.camera.y) * Math.min(1, dt * 6);

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const q = state.particles[i];
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 0.94; q.vy *= 0.94;
      q.life -= q.decay * dt;
      if (q.life <= 0) state.particles.splice(i, 1);
    }
  }

  function absorb(b) {
    b.eaten = true;
    state.player.mass += b.mass * state.rules.absorb_ratio;
    state.absorbed.push({ id: b.id, t: Math.round(performance.now() - state.startedAt) });
    spawnBurst(b.x, b.y, DOMAIN_COLORS[b.domain] || "#94a3b8", 14);
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function draw() {
    const ctx = state.ctx;
    const w = viewW(), h = viewH();
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#070b1c");
    grad.addColorStop(1, "#0d1430");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    drawStars(ctx, w, h);
    if (effectsQuality > 0) drawMesh(ctx);

    for (const b of state.bubbles) {
      if (b.eaten) continue;
      drawBubble(ctx, b);
    }
    drawParticles(ctx);
    drawPlayer(ctx);
    drawHud(ctx, w, h);
  }

  function drawStars(ctx, w, h) {
    const z = state.camera.zoom;
    for (const s of state.stars) {
      // Parallax: distant stars move less than the field.
      const px = (s.x - state.camera.x) * z * s.depth + w / 2;
      const py = (s.y - state.camera.y) * z * s.depth + h / 2;
      if (px < -10 || px > w + 10 || py < -10 || py > h + 10) continue;
      s.tw += 0.02;
      const a = 0.25 + Math.abs(Math.sin(s.tw)) * 0.5;
      ctx.fillStyle = `rgba(190,215,255,${a * s.depth})`;
      ctx.beginPath();
      ctx.arc(px, py, s.r * s.depth, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMesh(ctx) {
    // Connective lines between nearby fields — the "map of science" read.
    // Capped by distance and by effectsQuality so this stays O(n·k), not O(n²)
    // in practice on a slow device.
    const live = state.bubbles.filter(b => !b.eaten);
    const limit = effectsQuality === 1 ? 260 : 150;
    ctx.lineWidth = 1;
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      const sa = worldToScreen(a.x, a.y);
      if (sa.x < -200 || sa.x > viewW() + 200 || sa.y < -200 || sa.y > viewH() + 200) continue;
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        if (a.domain !== b.domain) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > limit) continue;
        const sb = worldToScreen(b.x, b.y);
        ctx.strokeStyle = hexToRgba(DOMAIN_COLORS[a.domain] || "#94a3b8", 0.16 * (1 - d / limit));
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
      }
    }
  }

  function drawBubble(ctx, b) {
    const s = worldToScreen(b.x, b.y);
    const r = b.mass * state.camera.zoom;
    if (s.x + r < 0 || s.x - r > viewW() || s.y + r < 0 || s.y - r > viewH()) return;

    const color = DOMAIN_COLORS[b.domain] || "#94a3b8";
    const edible = b.mass < state.player.mass;
    const pulse = 1 + Math.sin(b.pulse) * 0.02;

    if (effectsQuality > 0) {
      const glow = ctx.createRadialGradient(s.x, s.y, r * 0.2, s.x, s.y, r * 1.7 * pulse);
      glow.addColorStop(0, hexToRgba(color, 0.45));
      glow.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.7 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = hexToRgba(color, edible ? 0.82 : 0.42);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Threats get a hard bright ring; food does not. This is the single most
    // important readability cue in the game, so it is shape-based (ring vs no
    // ring) rather than relying on the fill colour alone.
    ctx.lineWidth = edible ? 1.2 : 2.6;
    ctx.strokeStyle = edible ? hexToRgba(color, 0.9) : "#fca5a5";
    ctx.stroke();

    if (r > 22) {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `600 ${Math.min(15, r / 2.6)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.domain, s.x, s.y);
    }
  }

  function drawPlayer(ctx) {
    const p = state.player;
    const s = worldToScreen(p.x, p.y);
    const r = p.mass * state.camera.zoom;

    if (effectsQuality > 0) {
      const glow = ctx.createRadialGradient(s.x, s.y, r * 0.1, s.x, s.y, r * 2.1);
      glow.addColorStop(0, "rgba(56,189,248,0.5)");
      glow.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    const body = ctx.createRadialGradient(s.x - r * 0.3, s.y - r * 0.3, r * 0.1, s.x, s.y, r);
    body.addColorStop(0, "#e0f2fe");
    body.addColorStop(1, "#0284c7");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#7dd3fc";
    ctx.stroke();

    ctx.fillStyle = "#083344";
    ctx.font = `700 ${Math.min(17, r / 2.2)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("π", s.x, s.y);
  }

  function drawParticles(ctx) {
    for (const q of state.particles) {
      const s = worldToScreen(q.x, q.y);
      ctx.fillStyle = hexToRgba(q.color, Math.max(0, q.life) * 0.8);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.4 * state.camera.zoom + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHud(ctx, w, h) {
    const p = state.player;
    const pct = Math.min(1, p.mass / state.rules.win_mass);

    ctx.fillStyle = "rgba(8,12,28,0.72)";
    roundRect(ctx, 12, 12, 208, 62, 10);
    ctx.fill();

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "600 12px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`Mass ${Math.round(p.mass)} / ${state.rules.win_mass}`, 24, 34);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 11px -apple-system, system-ui, sans-serif";
    ctx.fillText(`${state.absorbed.length} fields absorbed`, 24, 66);

    ctx.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, 24, 42, 184, 8, 4); ctx.fill();
    ctx.fillStyle = pct > 0.75 ? "#22c55e" : "#38bdf8";
    roundRect(ctx, 24, 42, Math.max(4, 184 * pct), 8, 4); ctx.fill();

    // Minimap — the "global map of science" overview, bottom right.
    const mw = 132, mh = mw * (WORLD_H / WORLD_W);
    const mx = w - mw - 12, my = h - mh - 12;
    ctx.fillStyle = "rgba(8,12,28,0.72)";
    roundRect(ctx, mx, my, mw, mh, 8); ctx.fill();
    for (const b of state.bubbles) {
      if (b.eaten) continue;
      ctx.fillStyle = hexToRgba(DOMAIN_COLORS[b.domain] || "#94a3b8", 0.75);
      ctx.beginPath();
      ctx.arc(mx + (b.x / WORLD_W) * mw, my + (b.y / WORLD_H) * mh,
              Math.max(0.8, b.mass / 26), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(mx + (p.x / WORLD_W) * mw, my + (p.y / WORLD_H) * mh, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------------------------------------------------------------------
  // Frame budget: if the device cannot hold a reasonable frame rate, shed the
  // decorative layers before letting the game itself become unplayable.
  // ---------------------------------------------------------------------
  function loop(now) {
    if (!state.running) return;
    const dt = Math.min(0.05, (now - state.lastFrame) / 1000);
    state.lastFrame = now;

    if (dt > 0.034) {
      if (++slowFrames > 45) {
        effectsQuality = effectsQuality === 1 ? 0.5 : 0;
        slowFrames = 0;
      }
    } else if (slowFrames > 0) {
      slowFrames--;
    }

    update(dt);
    if (state.running) draw();
    if (state.running) state.raf = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------
  function pointerToWorld(clientX, clientY) {
    const rect = state.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const z = state.camera.zoom;
    return {
      x: (sx - viewW() / 2) / z + state.camera.x,
      y: (sy - viewH() / 2) / z + state.camera.y,
    };
  }

  function bindInput() {
    const c = state.canvas;

    c.addEventListener("mousemove", e => {
      const p = pointerToWorld(e.clientX, e.clientY);
      state.pointer = { x: p.x, y: p.y, active: true };
    });
    c.addEventListener("mouseleave", () => { state.pointer.active = false; });

    const touch = e => {
      if (!e.touches.length) return;
      e.preventDefault();      // stop the page scrolling under the finger
      const t = e.touches[0];
      const p = pointerToWorld(t.clientX, t.clientY);
      state.pointer = { x: p.x, y: p.y, active: true };
    };
    c.addEventListener("touchstart", touch, { passive: false });
    c.addEventListener("touchmove", touch, { passive: false });
    c.addEventListener("touchend", () => { state.pointer.active = false; });

    window.addEventListener("keydown", e => {
      if (!state.running) return;
      if (e.key === "Escape") { exitRun("Run abandoned. Nothing was recorded."); return; }
      state.keys.add(e.key);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
    });
    window.addEventListener("keyup", e => state.keys.delete(e.key));
    window.addEventListener("resize", () => { if (state.running) resize(); });

    // Pause rather than penalise when the tab is backgrounded: rAF stops
    // firing there anyway, and resuming with a huge dt would teleport the
    // player into whatever is nearby.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.running) {
        state.running = false;
        if (state.raf) cancelAnimationFrame(state.raf);
        setMessage("Paused — the run resumes when you return to this tab.", "info");
      } else if (!document.hidden && state.token && !state.over && state.player) {
        const stage = document.getElementById("arcadeStage");
        if (stage && !stage.classList.contains("hidden")) {
          state.running = true;
          state.lastFrame = performance.now();
          setMessage("", "");
          state.raf = requestAnimationFrame(loop);
        }
      }
    });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function init() {
    state.canvas = document.getElementById("arcadeCanvas");
    if (!state.canvas) return;
    state.ctx = state.canvas.getContext("2d");
    bindInput();

    document.getElementById("arcadeStartBtn").addEventListener("click", startRun);
    document.getElementById("arcadeExitBtn").addEventListener("click",
      () => exitRun("Run abandoned. Nothing was recorded."));
    document.getElementById("arcadeOverlayClose").addEventListener("click", () => {
      document.getElementById("arcadeOverlay").classList.add("hidden");
      exitRun("");
    });
    document.getElementById("arcadeOverlayAgain").addEventListener("click", () => {
      document.getElementById("arcadeOverlay").classList.add("hidden");
      startRun();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.ScholarPiArcade = { exit: exitRun };
})();
