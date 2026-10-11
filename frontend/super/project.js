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
  // The map is the program's project section (super/pitechlab.super.js, SuperAI.program.project), and its
  // site row is the program's bubbles, so the map and the site are drawn from one source.
  const W = 1000, H = 620;
  const PROGRAM = (window.SuperAI && window.SuperAI.program) || window.SUPERAI_PROGRAM;
  const PR = PROGRAM.project;
  const row = PR.siteRow || { x: 20, y: 500, w: 960, h: 40 };
  const siteSupers = PROGRAM.bubbles.map(b => ({ id: "b-" + b.title, label: b.title, kind: "site", opens: b.members ? b.members[0] : "@source:" + b.source }))
    .concat(row.extra || []).map(x => Object.assign({ kind: "site" }, x));
  const gap = 14, bw = (row.w - gap * (siteSupers.length - 1)) / siteSupers.length;
  siteSupers.forEach((n, k) => Object.assign(n, { x: row.x + k * (bw + gap), y: row.y, w: bw, h: row.h }));
  const P = PR.supers.map(n => Object.assign({}, n, { live: n.opens === "@live" })).concat(siteSupers);
  const BY = Object.fromEntries(P.map(n => [n.id, n]));
  const WIRES = (PR.wires || []).filter(([a, b]) => BY[a] && BY[b]);
  const SECTIONS = PR.sections || [];

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
    // the program is always drawn: small, it is the miniature of itself; zoomed in, it can be read and used
    const show = Math.max(0, Math.min(1, (t - 0.25) / 0.35));
    el.style.setProperty("--pj-show", show.toFixed(3));
    el.classList.toggle("is-open", show > 0.02);
    el.classList.toggle("is-mini", t < 0.12);
    el.classList.toggle("is-full", t > 0.98);
    if (t < 0.6 && el.classList.contains("is-editing")) { el.querySelector(".pj-editor").hidden = true; el.classList.remove("is-editing"); }
    // the drawing fits the box, centred
    const pad = 0.05, s = Math.min(r.w * (1 - 2 * pad) / W, r.h * (1 - 2 * pad) / H);
    map.style.transform = "translate(" + ((r.w - W * s) / 2).toFixed(1) + "px," + ((r.h - H * s) / 2).toFixed(1) + "px) scale(" + s.toFixed(4) + ")";
    if (!probed) probeAll();
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
    el.setAttribute("aria-label", "Pi Tech Lab, the whole project written in SuperAI, drawn small. Zoom in on it to read and use it, zoom out to make it small again.");
    el.innerHTML =

      '<i class="pj-port pj-l"></i><i class="pj-port pj-r"></i><i class="pj-port pj-t"></i><i class="pj-port pj-b"></i>' +
      '<div class="pj-map" aria-hidden="false"></div>' +
      '<button type="button" class="pj-prog-btn">Program</button>' +
      '<div class="pj-editor" hidden><div class="pj-ed-head"><strong>Pi Tech Lab in SuperAI</strong><span class="pj-ed-state"></span></div>' +
      '<textarea class="pj-ed-text" spellcheck="false" aria-label="The SuperAI program the site runs"></textarea>' +
      '<div class="pj-ed-errors" role="alert"></div>' +
      '<div class="pj-ed-row"><button type="button" class="pj-ed-run">Run</button><button type="button" class="pj-ed-reset">Back to shipped</button>' +
      '<button type="button" class="pj-ed-dl">Download</button><button type="button" class="pj-ed-close">Close</button></div></div>';
    map = el.querySelector(".pj-map");
    map.style.width = W + "px"; map.style.height = H + "px";
    let inner = '<svg class="pj-wires" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"></svg>';
    SECTIONS.forEach(s => { inner += '<div class="pj-sec" style="left:' + s.x + "px;top:" + s.y + "px;width:" + s.w + "px;height:" + s.h + 'px"><span>' + esc(s.label) + "</span></div>"; });
    P.forEach(n => {
      const tag = (n.opens || n.live) && !n.input ? "button" : "div";
      inner += "<" + tag + ' class="pj-node pj-' + n.kind + (n.id === ANS_ID() ? " pj-answer" : "") + '" data-id="' + n.id + '"' + (tag === "button" ? ' type="button"' : "") +
        ' style="left:' + n.x + "px;top:" + n.y + "px;width:" + n.w + "px;height:" + n.h + 'px">' +
        '<b>' + esc(n.label) + "</b>" +
        (n.input ? '<input class="pj-field" type="text" placeholder="ask everything…" aria-label="Prompt for every engine" maxlength="4000">' : '<span class="pj-val">' + esc(n.note || "") + "</span>") +
        "</" + tag + ">";
    });
    map.innerHTML = inner;
    wiresSvg = map.querySelector(".pj-wires");
    drawWires();
    document.body.appendChild(el);
    wire();
    place();
    setTimeout(settleFree, 1500);                                    // never on top of something to begin with
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
        ns.forEach(n => { try { setVal(n.id, window.SuperAI.value(n.probe[1], j)); } catch (_) { setVal(n.id, "—"); } });
        if (u === "/api/super/engines") (j.engines || []).forEach(e => { if (BY[e.id] && BY[e.id].kind === "out") setVal(e.id, e.ready ? "ready" : "no key"); });
      }).catch(() => ns.forEach(n => setVal(n.id, "unreachable", "err")));
    });
    clearTimeout(probeT);
    probeT = setTimeout(() => { probed = false; if (el && el.classList.contains("is-open")) probeAll(); }, 30000);
  }

  // ------------------------------------------------------------ running it
  // the run follows the program's wires: the input super feeds the Super AI, it feeds the engines (by their
  // engine field), the outside models feed a judge, and the judge feeds the answer
  const IN = P.find(n => n.input) || {}, AI = P.find(n => n.kind === "ai") || {};
  const JUDGE = P.find(n => n.kind === "judge" && WIRES.some(([a, b]) => b === n.id && BY[a].kind === "out")) || {};
  const ANS = BY[(WIRES.find(([a]) => a === JUDGE.id) || [])[1]] || P.find(n => n.kind === "sink") || {};
  function ANS_ID() { return ANS.id; }
  const nodeFor = eid => P.find(n => n.engine === eid);
  let run = null;
  function ask(q) {
    if (!q || !window.SuperPrompt) return;
    if (run && !run.finished) run.stop();
    const r = run = window.SuperPrompt.run(q);
    const lit = new Set();
    map.querySelectorAll(".pj-wire").forEach(w => w.classList.remove("is-live"));
    const light = (a, b) => { const w = map.querySelector('.pj-wire[data-a="' + a + '"][data-b="' + b + '"]'); if (w) w.classList.add("is-live"); };
    light(IN.id, AI.id);
    setVal(AI.id, "thinking…", "busy");
    setVal(ANS.id, "", "busy");
    r.on(() => {
      if (run !== r) return;
      r.engines.forEach(e => {
        const sup = nodeFor(e.id), res = r.results[e.id];
        if (!sup) return;
        const id = sup.id;
        if (!lit.has(id)) { lit.add(id); light(AI.id, id); setVal(id, "…", "busy"); }
        if (res && res.state !== "wait" && !lit.has(id + ":done")) {
          lit.add(id + ":done");
          setVal(id, clip(res.text, 46), res.state === "ok" ? "ok" : "err");
          if (res.state === "ok") { light(id, JUDGE.id); light(id, ANS.id); }
        }
      });
      if (r.verdict) {
        if (r.verdict.state === "weigh") setVal(JUDGE.id, "weighing…", "busy");
        else if (r.verdict.state !== "wait") setVal(JUDGE.id, r.verdict.agreement ? r.verdict.agreement + " agreement" : (r.verdict.state === "ok" ? "weighed" : "no verdict"), r.verdict.state === "ok" ? "ok" : "err");
        if (r.verdict.state === "ok") light(JUDGE.id, ANS.id);
      }
      const t = window.SuperPrompt.summary(r);
      if (t) answer(t);
      if (r.finished) { setVal(AI.id, r.engines.filter(e => r.results[e.id] && r.results[e.id].state === "ok").length + " answered", "ok"); if (!t) answer(r.error || "No engine had an answer.", true); }
    });
  }
  function answer(text, err) {
    const n = nodeEl(ANS.id); if (!n) return;
    const s = n.querySelector(".pj-val");
    s.textContent = clip(text, 420);
    n.classList.remove("is-busy"); n.classList.toggle("is-ok", !err); n.classList.toggle("is-err", !!err);
    s.style.fontSize = Math.max(7, Math.min(12, Math.sqrt((150 * 90) / (0.62 * 1.3 * Math.max(1, s.textContent.length))))).toFixed(1) + "px";
  }

  // ------------------------------------------------------------ gestures
  const inside = e => !!(el && e.target && e.target.closest && e.target.closest(".se-project"));
  // the program as text: anything short enough stays on one line, so it reads like the program it is
  function inline(v) {
    if (Array.isArray(v)) return "[" + v.map(inline).join(", ") + "]";
    if (v && typeof v === "object") return "{" + Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => JSON.stringify(k) + ": " + inline(x)).join(", ") + "}";
    return v === undefined ? "null" : JSON.stringify(v);
  }
  function pretty(v, ind) {
    ind = ind || "";
    const one = inline(v);
    if (typeof v !== "object" || v === null || one.length + ind.length <= 110) return one;
    const next = ind + "  ";
    if (Array.isArray(v)) return "[\n" + v.map(x => next + pretty(x, next)).join(",\n") + "\n" + ind + "]";
    return "{\n" + Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => next + JSON.stringify(k) + ": " + pretty(x, next)).join(",\n") + "\n" + ind + "}";
  }
  function wire() {
    // zoom on it: open or compact it. Taken before the page's own scroll handlers (super/scroll.js)
    window.addEventListener("wheel", e => {
      if (!html.classList.contains("shape-se") || !inside(e)) return;
      if (e.target.closest(".pj-editor")) { e.stopImmediatePropagation(); return; }   // the program scrolls; it does not zoom
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
      if (spec.input) { map.querySelector(".pj-field").focus(); return; }
      if (spec.live && window.PiLive && window.PiLive.open) { setT(0); window.PiLive.open(); return; }
      if (spec.opens && String(spec.opens).startsWith("@source:") && O().open) { const k = spec.opens.slice(8); setT(0); setTimeout(() => O().open(k), 220); return; }
      if (spec.opens && O().openTitle) { setT(0); setTimeout(() => O().openTitle(spec.opens), 220); }
    });
    const input = map.querySelector(".pj-field");
    input.addEventListener("keydown", e => { if (e.key === "Enter" && input.value.trim()) { e.preventDefault(); ask(input.value.trim()); } });
    // the program itself: read it, edit it, run it (it is kept in this browser and the site rebuilds from it)
    const ed = el.querySelector(".pj-editor"), text = el.querySelector(".pj-ed-text"), errs = el.querySelector(".pj-ed-errors");
    const stateLine = () => { el.querySelector(".pj-ed-state").textContent = window.SuperAI.edited ? "running: your edited copy" : "running: the shipped program"; };
    const show = on => {
      ed.hidden = !on; el.classList.toggle("is-editing", on);
      if (on) { text.value = pretty(window.SuperAI.program); errs.textContent = ""; stateLine(); setTimeout(() => { text.focus({ preventScroll: true }); text.setSelectionRange(0, 0); text.scrollTop = 0; }, 0); }
    };
    el.querySelector(".pj-prog-btn").addEventListener("click", () => { if (t < 0.6) setT(1); show(ed.hidden); });
    el.querySelector(".pj-ed-close").addEventListener("click", () => show(false));
    el.querySelector(".pj-ed-run").addEventListener("click", () => {
      let p;
      try { p = JSON.parse(text.value); } catch (e) { errs.textContent = "Not valid JSON: " + e.message; return; }
      const bad = window.SuperAI.save(p);
      if (bad.length) { errs.textContent = bad.slice(0, 6).join(" · ") + (bad.length > 6 ? " · and " + (bad.length - 6) + " more" : ""); return; }
      // a program that changes the starting diagram starts it afresh
      if (JSON.stringify(p.diagram) !== JSON.stringify(window.SuperAI.program.diagram)) { try { localStorage.removeItem("lv:nodes"); localStorage.removeItem("orbit:textwires"); } catch (_) { /* private mode */ } }
      errs.textContent = "Running it…";
      setTimeout(() => location.reload(), 150);
    });
    el.querySelector(".pj-ed-reset").addEventListener("click", () => {
      if (!window.SuperAI.edited) { text.value = pretty(window.SuperAI.shipped); errs.textContent = "This is the shipped program."; return; }
      window.SuperAI.reset(); errs.textContent = "Back to the shipped program…"; setTimeout(() => location.reload(), 150);
    });
    el.querySelector(".pj-ed-dl").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text.value], { type: "application/json" }));
      a.download = "pitechlab.super.json"; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
    text.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); el.querySelector(".pj-ed-run").click(); }
      if (e.key === "Tab") { e.preventDefault(); const a = text.selectionStart; text.setRangeText("  ", a, text.selectionEnd, "end"); }
      if (e.key === "Escape") show(false);
    });
    window.addEventListener("resize", place);
    document.addEventListener("se:frame", place);
    setInterval(place, 500);                                         // the inner super moves with the page's fit
  }
  // nothing overlaps unless it is inside a super: dropped on the title, Live, the inner super's ring area
  // edges or a window, the compact project super moves to the nearest free spot
  function settleFree() {
    const vw = window.innerWidth, vh = window.innerHeight, c = compactRect();
    const blocks = [...document.querySelectorAll(".orbit-title, .live-tab, .live-dock.open .live-body, .orbit-panel, .lv-node")].filter(x => x.getClientRects().length).map(x => x.getBoundingClientRect());
    const free = (x, y) => blocks.every(b => x + MIN + 8 <= b.left || b.right + 8 <= x || y + MIN + 8 <= b.top || b.bottom + 8 <= y);
    if (free(c.x, c.y)) return;
    for (let d = 8; d < Math.max(vw, vh); d += 8) for (let a = 0; a < 16; a++) {
      const x = c.x + d * Math.cos(a * Math.PI / 8), y = c.y + d * Math.sin(a * Math.PI / 8);
      if (x < 4 || y < 4 || x > vw - MIN - 4 || y > vh - MIN - 4 || !free(x, y)) continue;
      state.x = x / vw; state.y = y / vh; place(); return;
    }
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
    const up = () => {
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true);
      if (!moved) return;
      settleFree(); save(state);
      document.dispatchEvent(new CustomEvent("se:obstacle"));           // the supers step off it; the bubbles make room by themselves
    };
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
