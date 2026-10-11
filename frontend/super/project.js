// The project, in SuperAI: one super that holds the whole of Pi Tech Lab as a diagram.
//
// SuperAI is the site's graphical language (LabVIEW style, powered by AI engines): supers joined by
// wires, data flowing from outputs into inputs. This module writes the project itself in it (PROGRAM
// below: the engines, the outside models and the judge, the assessment pipeline from a manuscript to
// the ledger, the site's bubbles, Live) and compacts it into a single super on the page.
//
//   zoom (scroll or pinch) on the super   it grows until it fills the inner super, and the diagram shows
//   zoom out                              it compacts back into one super
//   type into the Prompt super, Enter     every engine answers along the wires (superprompt.js), the
//                                         judge weighs the outside models, the answer reaches Answer
//   press a super in the diagram          the window it stands for opens (the map compacts first)
//   drag the compact super                it moves; where it is and how far it is open are kept
//
// Every super in the diagram reads its live value from the backend it stands for (the probes: GET
// endpoints only, refreshed every 30 s while the map is open), so the diagram is the running project,
// not a picture of it. Superellipse look only.
(function () {
  "use strict";
  if (window.SeProject) return;
  const html = document.documentElement;
  const O = () => window.PiOrbit || {};
  const KEY = "se:project";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; } };
  const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* private mode */ } };
  const clip = (s, n) => { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ------------------------------------------------------------ the program
  // A super: id, label, x, y, w, h (in a 1000 × 620 drawing), kind (in: an input you type into; ai: the
  // Super AI; lab: an engine of the lab; out: an outside model; judge; step: a step of the assessment;
  // site: a bubble of the site; sink: an output), a probe [url, value] and what pressing it opens.
  const W = 1000, H = 620, S = 74, h = 40;
  const P = [
    // one prompt, every engine
    { id: "prompt", label: "Prompt", kind: "in", x: 20, y: 120, w: 150, h: 64 },
    { id: "superai", label: "Super AI", kind: "ai", x: 210, y: 128, w: 96, h: 48, probe: ["/api/super/engines", j => (j.engines || []).filter(e => e.ready).length + " engines"] },
    { id: "sim", label: "siM", kind: "lab", engine: "sim", x: 350, y: 20, w: S, h, probe: ["/api/scilem/status", j => j.badge || j.mode || (j.enabled ? "on" : "off")], opens: "SciM Assistant" },
    { id: "rib", label: "riB", kind: "lab", engine: "rib", x: 350, y: 76, w: S, h, probe: ["/api/engines/status", j => j.riB ? Object.keys(j.riB.weights || {}).length + " weights" : "—"], opens: "Capabilities" },
    { id: "pid", label: "piD", kind: "lab", engine: "pid", x: 350, y: 132, w: S, h, probe: ["/api/forecast", j => (j.blocks_recorded || 0) + " blocks"], opens: "Performance" },
    { id: "pien", label: "PiEn", kind: "lab", engine: "pien", x: 350, y: 188, w: S, h, probe: ["/api/pien/model", j => (j.interactions || 0) + " uses"], opens: "Capabilities" },
    { id: "llama", label: "Llama", kind: "out", engine: "llama", x: 470, y: 8, w: S, h },
    { id: "mistral", label: "Mistral", kind: "out", engine: "mistral", x: 470, y: 58, w: S, h },
    { id: "qwen", label: "Qwen", kind: "out", engine: "qwen", x: 470, y: 108, w: S, h },
    { id: "gemini", label: "Gemini", kind: "out", engine: "gemini", x: 470, y: 158, w: S, h },
    { id: "deepseek", label: "DeepSeek", kind: "out", engine: "deepseek", x: 470, y: 208, w: S, h },
    { id: "judge", label: "Judge", kind: "judge", x: 600, y: 108, w: S, h, probe: ["/api/super/engines", j => j.judge ? "ready" : "no key"] },
    { id: "answer", label: "Answer", kind: "sink", x: 720, y: 70, w: 160, h: 118 },
    { id: "live", label: "Live", kind: "site", x: 906, y: 20, w: S, h, probe: ["/api/live", j => (j.today || 0) + " today"], live: true },
    { id: "traffic", label: "Traffic", kind: "site", x: 906, y: 200, w: S, h, probe: ["/api/traffic", j => (j.today || 0) + " visits"], opens: "Analytics" },
    // the assessment: a manuscript in, a score, a token and a record on the ledger out
    { id: "manuscript", label: "Manuscript", kind: "in", x: 20, y: 330, w: 92, h: 46, probe: ["/api/stats/count", j => (j.total_analyzed || 0) + " assessed"], opens: "Assess Manuscripts [Pi]" },
    { id: "extract", label: "Extract", kind: "step", x: 132, y: 333, w: 88, h, probe: null, note: "PDF → text" },
    { id: "integrity", label: "Integrity", kind: "step", x: 238, y: 333, w: 88, h, note: "MDAR · RRID" },
    { id: "jurors", label: "Jurors", kind: "step", x: 344, y: 333, w: 88, h, probe: ["/api/super/engines", j => (j.engines || []).filter(e => e.kind === "outside" && e.ready).length + " models"] },
    { id: "verdict", label: "Verdict", kind: "judge", x: 450, y: 333, w: 88, h, note: "the judge" },
    { id: "pix", label: "piX", kind: "step", x: 556, y: 333, w: 88, h, probe: ["/api/analytics/summary", j => "avg " + Math.round(+j.avg_score || 0)], opens: "Whitepaper" },
    { id: "piq", label: "piQ", kind: "step", x: 662, y: 333, w: 88, h, probe: ["/api/emission", j => "floor " + (+j.current_quality_floor || 0).toFixed(1)], opens: "Minting Difficulty" },
    { id: "ledger", label: "Ledger", kind: "step", x: 768, y: 333, w: 88, h, probe: ["/api/chain/status", j => j.connected ? (j.chain_name || "chain") + " #" + j.block_number : "offline"], opens: "Proof-of-Research Ledger Explorer" },
    { id: "explorer", label: "Explorer", kind: "sink", x: 874, y: 333, w: 106, h, probe: ["/api/explorer/latest", j => (j.count || 0) + " records"], opens: "Proof-of-Research Ledger Explorer" },
    // the site: its bubbles, each a super that opens what it holds
    { id: "b-connect", label: "Connect", kind: "site", x: 20, y: 500, w: 104, h, opens: "Why sign in" },
    { id: "b-account", label: "Your account", kind: "site", x: 140, y: 500, w: 104, h, opens: "Your account" },
    { id: "b-scim", label: "SciM Assistant", kind: "site", x: 260, y: 500, w: 104, h, opens: "SciM Assistant" },
    { id: "b-about", label: "About", kind: "site", x: 380, y: 500, w: 104, h, opens: "Capabilities" },
    { id: "b-lab", label: "Lab", kind: "site", x: 500, y: 500, w: 104, h, opens: "HAL-OS" },
    { id: "b-library", label: "Library", kind: "site", x: 620, y: 500, w: 104, h, opens: "The Global Map of Science" },
    { id: "b-tools", label: "Tools", kind: "site", x: 740, y: 500, w: 104, h, opens: "Assess Manuscripts [Pi]" },
    { id: "b-explore", label: "Explore", kind: "site", x: 860, y: 500, w: 120, h, opens: "Recent assessments", probe: ["/api/assessments/recent", j => (j.total || 0) + " recent"] },
  ];
  const BY = Object.fromEntries(P.map(n => [n.id, n]));
  const WIRES = [
    ["prompt", "superai"],
    ...["sim", "rib", "pid", "pien", "llama", "mistral", "qwen", "gemini", "deepseek"].map(e => ["superai", e]),
    ...["llama", "mistral", "qwen", "gemini", "deepseek"].map(e => [e, "judge"]),
    ["judge", "answer"], ["sim", "answer"],
    ["manuscript", "extract"], ["extract", "integrity"], ["integrity", "jurors"], ["jurors", "verdict"], ["verdict", "pix"], ["pix", "piq"], ["piq", "ledger"], ["ledger", "explorer"],
    ["pix", "pid"], ["pix", "rib"],                               // the scores teach the forecaster and the research buddy
    ["b-tools", "manuscript"], ["b-scim", "sim"], ["explorer", "b-explore"], ["ledger", "live"],
  ];
  const SECTIONS = [
    { label: "one prompt, every engine", x: 14, y: 0, w: 972, h: 270 },
    { label: "the assessment", x: 14, y: 300, w: 972, h: 110 },
    { label: "the site", x: 14, y: 470, w: 972, h: 100 },
  ];

  // ------------------------------------------------------------ the super on the page
  let el = null, map = null, wiresSvg = null, state = load() || {}, t = +state.t || 0, tTo = t;
  const MIN = 104;                                                   // the compact super's side
  function compactRect() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = state.x != null ? state.x * vw : 0.126 * vw, y = state.y != null ? state.y * vh : 0.70 * vh;
    return { x: Math.max(4, Math.min(vw - MIN - 4, x)), y: Math.max(4, Math.min(vh - MIN - 4, y)), w: MIN, h: MIN };
  }
  function fullRect() {
    const sb = O().siteBox ? O().siteBox() : null, vw = window.innerWidth, vh = window.innerHeight;
    if (!sb) return { x: vw * 0.06, y: vh * 0.1, w: vw * 0.88, h: vh * 0.8 };
    const f = sb.fit || 1, cx = sb.px + (sb.cx - sb.px) * f, cy = sb.py + (sb.cy - sb.py) * f, a = sb.a * f, b = sb.b * f, m = 0.06;
    return { x: cx - a * (1 - m), y: cy - b * (1 - m), w: 2 * a * (1 - m), h: 2 * b * (1 - m) };
  }
  const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  function place() {
    if (!el) return;
    const c = compactRect(), f = fullRect(), k = ease(t);
    const r = { x: c.x + (f.x - c.x) * k, y: c.y + (f.y - c.y) * k, w: c.w + (f.w - c.w) * k, h: c.h + (f.h - c.h) * k };
    el.style.left = r.x.toFixed(1) + "px"; el.style.top = r.y.toFixed(1) + "px";
    el.style.width = r.w.toFixed(1) + "px"; el.style.height = r.h.toFixed(1) + "px";
    const show = Math.max(0, Math.min(1, (t - 0.25) / 0.35));
    el.style.setProperty("--pj-show", show.toFixed(3));
    el.classList.toggle("is-open", show > 0.02);
    el.classList.toggle("is-full", t > 0.98);
    // the drawing fits the box, centred
    const pad = 0.05, s = Math.min(r.w * (1 - 2 * pad) / W, r.h * (1 - 2 * pad) / H);
    map.style.transform = "translate(" + ((r.w - W * s) / 2).toFixed(1) + "px," + ((r.h - H * s) / 2).toFixed(1) + "px) scale(" + s.toFixed(4) + ")";
    if (show > 0.02 && !probed) probeAll();
  }
  function setT(v, commit) {
    tTo = Math.max(0, Math.min(1, v));
    const go = () => { place(); if (commit !== false) { state.t = +t.toFixed(3); save(state); } };
    if (window.SeMotion) { const s = { v: t }; window.SeMotion.glide("project:t", s, "v", tTo, 180, () => { t = s.v; go(); }); }
    else { t = tTo; go(); }
  }

  function build() {
    el = document.createElement("div");
    el.className = "se-project";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Pi Tech Lab, the whole project written in SuperAI. Zoom in to open it, zoom out to compact it.");
    el.innerHTML =
      '<div class="pj-face"><strong>Pi Tech Lab</strong><span>the project in SuperAI</span><em>zoom in</em></div>' +
      '<i class="pj-port pj-l"></i><i class="pj-port pj-r"></i><i class="pj-port pj-t"></i><i class="pj-port pj-b"></i>' +
      '<div class="pj-map" aria-hidden="false"></div>';
    map = el.querySelector(".pj-map");
    map.style.width = W + "px"; map.style.height = H + "px";
    let inner = '<svg class="pj-wires" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"></svg>';
    SECTIONS.forEach(s => { inner += '<div class="pj-sec" style="left:' + s.x + "px;top:" + s.y + "px;width:" + s.w + "px;height:" + s.h + 'px"><span>' + esc(s.label) + "</span></div>"; });
    P.forEach(n => {
      const tag = n.opens || n.live ? "button" : "div";
      inner += "<" + tag + ' class="pj-node pj-' + n.kind + '" data-id="' + n.id + '"' + (tag === "button" ? ' type="button"' : "") +
        ' style="left:' + n.x + "px;top:" + n.y + "px;width:" + n.w + "px;height:" + n.h + 'px">' +
        '<b>' + esc(n.label) + "</b>" +
        (n.id === "prompt" ? '<input class="pj-field" type="text" placeholder="ask everything…" aria-label="Prompt for every engine" maxlength="4000">' : '<span class="pj-val">' + esc(n.note || "") + "</span>") +
        "</" + tag + ">";
    });
    map.innerHTML = inner;
    wiresSvg = map.querySelector(".pj-wires");
    drawWires();
    document.body.appendChild(el);
    wire();
    place();
  }
  function port(n, side) {
    return side === "out" ? [n.x + n.w, n.y + n.h / 2] : side === "in" ? [n.x, n.y + n.h / 2] : side === "top" ? [n.x + n.w / 2, n.y] : [n.x + n.w / 2, n.y + n.h];
  }
  function drawWires() {
    let s = "";
    WIRES.forEach(([a, b]) => {
      const A = BY[a], B = BY[b];
      let p, q, d;
      if (B.x >= A.x + A.w - 2) {                                    // flow left to right: output into input
        p = port(A, "out"); q = port(B, "in");
        const c = Math.max(24, (q[0] - p[0]) * 0.5);
        d = "M" + p + " C" + (p[0] + c) + "," + p[1] + " " + (q[0] - c) + "," + q[1] + " " + q;
      } else {                                                       // up or down between rows: bottom into top, or top into bottom
        const down = B.y > A.y;
        p = port(A, down ? "bottom" : "top"); q = port(B, down ? "top" : "bottom");
        const c = Math.max(30, Math.abs(q[1] - p[1]) * 0.5) * (down ? 1 : -1);
        d = "M" + p + " C" + p[0] + "," + (p[1] + c) + " " + q[0] + "," + (q[1] - c) + " " + q;
      }
      s += '<path class="pj-wire" data-a="' + a + '" data-b="' + b + '" d="' + d + '"/>';
      s += '<path class="pj-end" d="' + star(p[0], p[1], 3.2) + '"/><path class="pj-end" d="' + star(q[0], q[1], 3.2) + '"/>';
    });
    wiresSvg.innerHTML = s;
  }
  const star = (x, y, r) => { const k = r * 0.32; return "M" + x + "," + (y - r) + "Q" + (x + k) + "," + (y - k) + " " + (x + r) + "," + y + "Q" + (x + k) + "," + (y + k) + " " + x + "," + (y + r) + "Q" + (x - k) + "," + (y + k) + " " + (x - r) + "," + y + "Q" + (x - k) + "," + (y - k) + " " + x + "," + (y - r) + "Z"; };

  // ------------------------------------------------------------ live values
  let probed = false, probeT = 0;
  const nodeEl = id => map.querySelector('.pj-node[data-id="' + id + '"]');
  const setVal = (id, v, state) => {
    const n = nodeEl(id); if (!n) return;
    const s = n.querySelector(".pj-val"); if (s) s.textContent = v;
    n.classList.remove("is-ok", "is-err", "is-busy");
    if (state) n.classList.add("is-" + state);
  };
  function probeAll() {
    probed = true;
    const urls = {};
    P.forEach(n => { if (n.probe) (urls[n.probe[0]] = urls[n.probe[0]] || []).push(n); });
    Object.entries(urls).forEach(([u, ns]) => {
      fetch(u).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(j => {
        ns.forEach(n => { try { setVal(n.id, n.probe[1](j)); } catch (_) { setVal(n.id, "—"); } });
        if (u === "/api/super/engines") (j.engines || []).forEach(e => { if (BY[e.id] && BY[e.id].kind === "out") setVal(e.id, e.ready ? "ready" : "no key"); });
      }).catch(() => ns.forEach(n => setVal(n.id, "unreachable", "err")));
    });
    clearTimeout(probeT);
    probeT = setTimeout(() => { probed = false; if (el && el.classList.contains("is-open")) probeAll(); }, 30000);
  }

  // ------------------------------------------------------------ running it
  let run = null;
  function ask(q) {
    if (!q || !window.SuperPrompt) return;
    if (run && !run.finished) run.stop();
    const r = run = window.SuperPrompt.run(q);
    const lit = new Set();
    map.querySelectorAll(".pj-wire").forEach(w => w.classList.remove("is-live"));
    const light = (a, b) => { const w = map.querySelector('.pj-wire[data-a="' + a + '"][data-b="' + b + '"]'); if (w) w.classList.add("is-live"); };
    light("prompt", "superai");
    setVal("superai", "thinking…", "busy");
    setVal("answer", "", "busy");
    r.on(() => {
      if (run !== r) return;
      r.engines.forEach(e => {
        const id = e.id, res = r.results[id];
        if (!BY[id]) return;
        if (!lit.has(id)) { lit.add(id); light("superai", id); setVal(id, "…", "busy"); }
        if (res && res.state !== "wait" && !lit.has(id + ":done")) {
          lit.add(id + ":done");
          setVal(id, clip(res.text, 46), res.state === "ok" ? "ok" : "err");
          if (BY[id].kind === "out" && res.state === "ok") light(id, "judge");
          if (id === "sim" && res.state === "ok") light("sim", "answer");
        }
      });
      if (r.verdict) {
        if (r.verdict.state === "weigh") setVal("judge", "weighing…", "busy");
        else if (r.verdict.state !== "wait") setVal("judge", r.verdict.agreement ? r.verdict.agreement + " agreement" : (r.verdict.state === "ok" ? "weighed" : "no verdict"), r.verdict.state === "ok" ? "ok" : "err");
        if (r.verdict.state === "ok") light("judge", "answer");
      }
      const t = window.SuperPrompt.summary(r);
      if (t) answer(t);
      if (r.finished) { setVal("superai", r.engines.filter(e => r.results[e.id] && r.results[e.id].state === "ok").length + " answered", "ok"); if (!t) answer(r.error || "No engine had an answer.", true); }
    });
  }
  function answer(text, err) {
    const n = nodeEl("answer"); if (!n) return;
    const s = n.querySelector(".pj-val");
    s.textContent = clip(text, 420);
    n.classList.remove("is-busy"); n.classList.toggle("is-ok", !err); n.classList.toggle("is-err", !!err);
    s.style.fontSize = Math.max(7, Math.min(12, Math.sqrt((150 * 90) / (0.62 * 1.3 * Math.max(1, s.textContent.length))))).toFixed(1) + "px";
  }

  // ------------------------------------------------------------ gestures
  const inside = e => !!(el && e.target && e.target.closest && e.target.closest(".se-project"));
  function wire() {
    // zoom on it: open or compact it. Taken before the page's own scroll handlers (super/scroll.js)
    window.addEventListener("wheel", e => {
      if (!html.classList.contains("shape-se") || !inside(e)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const dy = e.deltaY || e.deltaX, k = e.ctrlKey ? 0.012 : 0.0016;   // a pinch reports small deltas
      setT(tTo - dy * k);
    }, { capture: true, passive: false });
    // presses inside it are its own: the page does not select, wire or drag through it
    window.addEventListener("pointerdown", e => {
      if (!inside(e)) return;
      e.stopImmediatePropagation();
      if (e.button !== 0) return;
      const onNode = e.target.closest(".pj-node, .pj-field");
      if (onNode && el.classList.contains("is-open")) return;          // a press on a super of the diagram: its click
      dragFrom(e);
    }, true);
    window.addEventListener("dblclick", e => { if (inside(e)) { e.stopImmediatePropagation(); } }, true);
    ["click", "keydown"].forEach(ty => el.addEventListener(ty, e => e.stopPropagation()));
    map.addEventListener("click", e => {
      const n = e.target.closest(".pj-node"); if (!n || e.target.closest(".pj-field")) return;
      const spec = BY[n.dataset.id]; if (!spec) return;
      if (spec.id === "prompt") { map.querySelector(".pj-field").focus(); return; }
      if (spec.live && window.PiLive && window.PiLive.open) { setT(0); window.PiLive.open(); return; }
      if (spec.opens && O().openTitle) { setT(0); setTimeout(() => O().openTitle(spec.opens), 220); }
    });
    const input = map.querySelector(".pj-field");
    input.addEventListener("keydown", e => { if (e.key === "Enter" && input.value.trim()) { e.preventDefault(); ask(input.value.trim()); } });
    window.addEventListener("resize", place);
    document.addEventListener("se:frame", place);
    setInterval(place, 500);                                         // the inner super moves with the page's fit
  }
  function dragFrom(e) {
    if (el.classList.contains("is-open")) return;                    // open, it stays put: zoom out to move it
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      state.x = (ev.clientX - dx) / window.innerWidth; state.y = (ev.clientY - dy) / window.innerHeight;
      place();
    };
    const up = () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); if (moved) save(state); };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  }

  function start() {
    if (!html.classList.contains("shape-se") || el) return !!el;
    build();
    return true;
  }
  if (!start()) {
    const mo = new MutationObserver(() => { if (start()) mo.disconnect(); });
    mo.observe(html, { attributes: true, attributeFilter: ["class"] });
  }
  window.SeProject = { open: () => setT(1), close: () => setT(0), ask, program: () => ({ supers: P.map(n => ({ id: n.id, label: n.label, kind: n.kind })), wires: WIRES.slice() }) };
})();
