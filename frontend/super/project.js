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
  let showProgram = () => {};
  let el = null, map = null, wiresSvg = null, state = load() || {}, t = +state.t || 0, tTo = t;
  // the compact super's side: the same as a compact bubble's (super/loop.js compactSide, --se-compact)
  const MIN0 = 104;
  const MINv = () => { const v = parseFloat(getComputedStyle(html).getPropertyValue("--se-compact")); return v > 0 ? v : MIN0; };
  let MIN = MIN0;
  // the page's zoom (the inner super zoomed out, super/loop.js): the compact project super is laid out as the bubbles
  // are, unzoomed, and drawn scaled toward the page's centre with them
  const zoomOf = () => { const sb = O().siteBox ? O().siteBox() : null; return sb ? { f: sb.fit || 1, px: sb.px, py: sb.py } : { f: 1, px: 0, py: 0 }; };
  const toScreen = (x, y) => { const z = zoomOf(); return [z.px + (x - z.px) * z.f, z.py + (y - z.py) * z.f]; };
  const toLayout = (x, y) => { const z = zoomOf(); return [z.px + (x - z.px) / z.f, z.py + (y - z.py) / z.f]; };
  function compactLayout() {
    MIN = MINv();
    const vw = window.innerWidth, vh = window.innerHeight;
    // where it starts: the program's projectAt.inSite (its top left in shares of the inner super, desktop), else as before
    const pa = (((window.SuperAI || {}).program || {}).projectAt || {}).inSite, sb0 = O().siteBox ? O().siteBox() : null;
    const ph = vw < 700, startX = !ph && pa && sb0 && sb0.a ? sb0.cx - sb0.a + pa[0] * 2 * sb0.a : (ph ? 0.126 : 0.775) * vw, startY = !ph && pa && sb0 && sb0.b ? sb0.cy - sb0.b + pa[1] * 2 * sb0.b : (ph ? 0.70 : 0.651) * vh;
    const x = state.x != null ? state.x * vw : startX, y = state.y != null ? state.y * vh : startY;   // desktop: inside the third super, beside Lab
    const w = state.w >= 10 ? state.w : MIN, h = state.h >= 10 ? state.h : MIN;   // any size if unlocked (down to a sparkle)
    const B = room(w, h);                                          // it lives inside the inner super, the second super (by its own size)   // its own size once Shift + drag gave it one (super/shiftsize.js)
    return { x: Math.max(B.x0, Math.min(B.x1, x)), y: Math.max(B.y0, Math.min(B.y1, y)), w, h };
  }
  function compactRect() {
    const c = compactLayout(), f = zoomOf().f, [x, y] = toScreen(c.x, c.y);
    return { x, y, w: c.w * f, h: c.h * f };
  }
  // where the compact super may sit: inside the inner super, clear of its curved corners (the page when there is none)
  function room(w, h) {
    const vw = window.innerWidth, vh = window.innerHeight, f = fullRect(true), W = w || MIN, H = h || MIN;
    const x0 = Math.max(4, f.x), y0 = Math.max(4, f.y), x1 = Math.min(vw - W - 4, f.x + f.w - W), y1 = Math.min(vh - H - 4, f.y + f.h - H);
    return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : { x0: 4, y0: 4, x1: vw - W - 4, y1: vh - H - 4 };
  }
  function fullRect(unzoomed) {
    const sb = O().siteBox ? O().siteBox() : null, vw = window.innerWidth, vh = window.innerHeight;
    if (!sb) return { x: vw * 0.06, y: vh * 0.1, w: vw * 0.88, h: vh * 0.8 };
    const f = unzoomed ? 1 : (sb.fit || 1), cx = sb.px + (sb.cx - sb.px) * f, cy = sb.py + (sb.cy - sb.py) * f, a = sb.a * f, b = sb.b * f, m = 0.015;
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
    // compact, it is drawn at the page's zoom like a compact bubble, so its sign, lock and save shrink with it (super.css --pj-z)
    el.style.setProperty("--pj-z", (k < 0.5 ? zoomOf().f + (1 - zoomOf().f) * k * 2 : 1).toFixed(3));
    el.style.setProperty("--pj-map", Math.max(0, Math.min(1, (t - 0.04) / 0.22)).toFixed(3));   // the map comes in as the bubble drawing goes
    // opening, its corners square up a little (n from π to 8), so the map and the program are never cut by them
    const sq = Math.max(0, Math.min(1, (t - 0.4) / 0.5)), sqk = sq * sq * (3 - 2 * sq);
    el.style.setProperty("--pj-k", "9.96578"); void sqk;   // n = 1000 compact and open (owner, 2026-10-13)
    el.classList.toggle("is-open", show > 0.02);
    el.classList.toggle("is-mini", t < 0.12);
    el.classList.toggle("is-full", t > 0.98);
    if (t < 0.6 && el.classList.contains("is-editing")) { el.querySelector(".pj-editor").hidden = true; el.classList.remove("is-editing"); }
    // the drawing fits the box, centred
    const pad = 0.1, s = Math.min(r.w * (1 - 2 * pad) / W, r.h * (1 - 2 * pad) / H);   // clear of the π corners (a superellipse at n = π needs about 10 %)
    map.style.transform = "translate(" + ((r.w - W * s) / 2).toFixed(1) + "px," + ((r.h - H * s) / 2).toFixed(1) + "px) scale(" + s.toFixed(4) + ")";
    if (!probed) probeAll();
  }
  // closed for good (too small, or dropped outside the inner super) until the app is reset, as a bubble is
  let overAcc = 0, overT = 0;
  function closeSoon(dy) {
    overAcc += dy; clearTimeout(overT); overT = setTimeout(() => { overAcc = 0; }, 500);
    if (overAcc > 160) { overAcc = 0; const r = el.getBoundingClientRect(); if (window.SeDelete) window.SeDelete.ask(el, r.left + r.width / 2, r.top + r.height / 2); else goAway(); }   // ask first (owner, 2026-10-12)
  }
  function goAway() {
    if (!el || el.classList.contains("se-closing")) return;
    el.classList.add("se-closing");
    setTimeout(() => { el.classList.remove("se-closing"); el.hidden = true; try { localStorage.setItem("se:gone:project", "1"); } catch (_) { /* private mode */ } document.dispatchEvent(new CustomEvent("se:obstacle")); document.dispatchEvent(new CustomEvent("se:frame")); }, 700 * ((window.SeMotion && window.SeMotion.SLOW) || 1));
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

      '<div class="pj-face" aria-hidden="true"></div>' +
      '<div class="pj-map" aria-hidden="false"></div>' +
      '<div class="pj-editor" hidden><div class="pj-ed-head"><strong>Pi Tech Lab in SuperAI</strong><span class="pj-ed-state"></span></div>' +
      '<textarea class="pj-ed-text" spellcheck="false" aria-label="The SuperAI program the site runs"></textarea>' +
      '<div class="pj-ed-errors" role="alert"></div>' +
      '<div class="pj-ed-row">⌘ or Ctrl + Enter runs it · ⌘ or Ctrl + S downloads it · ⌘ or Ctrl + Shift + Backspace goes back to the shipped program · zoom out to close</div></div>';
    map = el.querySelector(".pj-map");
    // compact, it is drawn as a bubble is (super/bubble.js drawing): its name's box wired to one box per part of it
    const face = () => {
      const f = el.querySelector(".pj-face");
      if (!f || f.dataset.done === String(MINv()) || !window.SeBubble || !window.SeBubble.drawing) return !!(f && f.dataset.done);
      f.innerHTML = window.SeBubble.drawing("Project", SECTIONS.map(x => x.label), "ob-mini pj-mini", MINv()); f.dataset.done = String(MINv()); return true;
    };
    setInterval(face, 700);                                        // drawn again when the compact side changes (its name about 13 px on screen)
    map.style.width = W + "px"; map.style.height = H + "px";
    let inner = '<svg class="pj-wires" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"></svg>';
    SECTIONS.forEach(s => { inner += '<div class="pj-sec" style="left:' + s.x + "px;top:" + s.y + "px;width:" + s.w + "px;height:" + s.h + 'px"><span>' + esc(s.label) + "</span></div>"; });
    P.forEach(n => {
      const tag = "div";                                               // nothing in the map is clickable: only zoomable (owner, 2026-10-12)
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
    try { if (localStorage.getItem("se:gone:project") === "1") el.hidden = true; } catch (_) { /* private mode */ }   // put away until the app is reset
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
  // the program is shown as it is written, in SuperAI assembly (super/pitechlab.sasm; owner, 2026-10-12: the front end
  // written in SuperAI): the shipped text, or the text you ran last; the JSON when neither is at hand
  let shippedSource = "";
  fetch("super/pitechlab.sasm?v=1").then(r => r.ok ? r.text() : "").then(t => { shippedSource = t || ""; }).catch(() => {});
  function sourceText() {
    let mine = null; try { mine = localStorage.getItem("superai:source"); } catch (_) { /* private mode */ }
    if (window.SuperAI.edited && mine) return mine;
    if (!window.SuperAI.edited && shippedSource) return shippedSource;
    return pretty(window.SuperAI.program);
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
    // Shift + scroll changes its n (super/scroll.js, SeSite.shapeEl), so it is left alone here
    let progAcc = 0, progT = 0;
    window.addEventListener("wheel", e => {
      if (!html.classList.contains("shape-se") || !inside(e) || e.shiftKey) return;
      if (window.SeLock && el && window.SeLock.isLocked(el) && !e.target.closest(".pj-editor, .se-lock")) {   // locked: it does not grow or shrink (owner, 2026-10-12)
        e.preventDefault(); e.stopImmediatePropagation();
        /* a locked super simply does nothing: no note (owner, 2026-10-13) */
        return;
      }
      if (e.target.closest(".pj-editor")) {                              // the program scrolls; at its top, a scroll out closes it
        e.stopImmediatePropagation();
        const ta = el.querySelector(".pj-ed-text");
        if ((e.deltaY || 0) > 0 && (!ta || ta.scrollTop <= 0 || ta.scrollTop + ta.clientHeight >= ta.scrollHeight - 1) && !e.target.closest(".pj-ed-text")) { e.preventDefault(); showProgram(false); }
        return;
      }
      e.preventDefault(); e.stopImmediatePropagation();
      // it opens gradually with the scroll (owner, 2026-10-12): every step grows it a little toward the whole map;
      // scrolled on past the whole map, the program the site runs shows (nothing to click: only zoom), and the
      // first steps back hide it again
      const dy = e.deltaY || e.deltaX, k = e.ctrlKey ? 0.012 : 0.0016;            // a pinch reports small deltas
      const editing = el.classList.contains("is-editing");
      if (dy < 0 && tTo >= 1) { progAcc += dy; clearTimeout(progT); progT = setTimeout(() => { progAcc = 0; }, 500); if (progAcc < -120 && !editing) { progAcc = 0; showProgram(true); } return; }
      if (dy > 0 && editing) { showProgram(false); return; }
      if (dy > 0 && tTo <= 0 && t <= 0.001) { closeSoon(dy); return; }   // compact and scrolled on out: too small, it closes (the same logic as every super)
      setT(tTo - dy * k);
    }, { capture: true, passive: false });
    // presses inside it are its own: the page does not select, wire or drag through it
    window.addEventListener("pointerdown", e => {
      if (!inside(e)) return;
      // on its edge the press wires (super/wire.js), as on any super: left to the page
      const r = el.getBoundingClientRect(), d = Math.min(e.clientX - r.left, r.right - e.clientX, e.clientY - r.top, r.bottom - e.clientY);
      if (d <= 10 && !el.classList.contains("is-open")) return;
      if (window.SeSelect && window.SeSelect.select) window.SeSelect.select(el);   // a click selects it, like any super
      e.stopImmediatePropagation();
      if (e.button !== 0) return;
      const onNode = e.target.closest(".pj-node, .pj-field");
      if (onNode && el.classList.contains("is-open")) return;          // a press on a super of the diagram: its click
      dragFrom(e);
    }, true);
    window.addEventListener("dblclick", e => { if (inside(e)) { e.stopImmediatePropagation(); } }, true);
    ["click", "keydown"].forEach(ty => el.addEventListener(ty, e => e.stopPropagation()));
    const input = map.querySelector(".pj-field");
    input.addEventListener("keydown", e => { if (e.key === "Enter" && input.value.trim()) { e.preventDefault(); ask(input.value.trim()); } });
    // the program itself: read it, edit it, run it (it is kept in this browser and the site rebuilds from it)
    const ed = el.querySelector(".pj-editor"), text = el.querySelector(".pj-ed-text"), errs = el.querySelector(".pj-ed-errors");
    const stateLine = () => { el.querySelector(".pj-ed-state").textContent = window.SuperAI.edited ? "running: your edited copy" : "running: the shipped program"; };
    const show = showProgram = on => {
      ed.hidden = !on; el.classList.toggle("is-editing", on);
      if (on) { text.value = sourceText(); errs.textContent = ""; stateLine(); setTimeout(() => { text.focus({ preventScroll: true }); text.setSelectionRange(0, 0); text.scrollTop = 0; }, 0); }
    };
    const run = () => {
      let p;
      // JSON, or SuperAI assembly (super/pitechlab.sasm's form), assembled by the Rust engine
      if (!/^\s*\{/.test(text.value)) {
        const rs = window.SuperAI && window.SuperAI.rs, r = rs && rs.ready && rs.handle({ op: "assemble", source: text.value });
        if (!r) { errs.textContent = "The engine is still loading"; return; }
        if (!r.ok) { errs.textContent = (r.errors || []).slice(0, 6).join(" · "); return; }
        p = r.program;
      } else try { p = JSON.parse(text.value); } catch (e) { errs.textContent = "Not valid JSON: " + e.message; return; }
      const bad = window.SuperAI.save(p);
      if (bad.length) { errs.textContent = bad.slice(0, 6).join(" · ") + (bad.length > 6 ? " · and " + (bad.length - 6) + " more" : ""); return; }
      try { localStorage.setItem("superai:source", text.value); } catch (_) { /* private mode */ }   // the words you wrote, shown again next time
      // a program that changes the starting diagram starts it afresh
      if (JSON.stringify(p.diagram) !== JSON.stringify(window.SuperAI.program.diagram)) { try { localStorage.removeItem("lv:nodes"); localStorage.removeItem("orbit:textwires"); } catch (_) { /* private mode */ } }
      errs.textContent = "Running it…";
      setTimeout(() => location.reload(), 150);
    };
    const backToShipped = () => {
      if (!window.SuperAI.edited) { text.value = shippedSource || pretty(window.SuperAI.shipped); errs.textContent = "This is the shipped program."; return; }
      try { localStorage.removeItem("superai:source"); } catch (_) { /* private mode */ }
      window.SuperAI.reset(); errs.textContent = "Back to the shipped program…"; setTimeout(() => location.reload(), 150);
    };
    const download = () => {
      const a = document.createElement("a");
      const json = /^\s*\{/.test(text.value);                           // the program as written: assembly (.sasm) or JSON
      a.href = URL.createObjectURL(new Blob([text.value], { type: json ? "application/json" : "text/plain" }));
      a.download = json ? "pitechlab.super.json" : "pitechlab.sasm"; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    text.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); download(); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Backspace") { e.preventDefault(); backToShipped(); }
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
    if (el && el.matches(":hover")) return;                           // the super under the pointer never moves
    if (el && window.SeLock && window.SeLock.isLocked(el)) return;    // nor a locked one
    const vw = window.innerWidth, vh = window.innerHeight, c = compactLayout(), f = zoomOf().f;
    const blocks = [...document.querySelectorAll(".orbit-title, .orbit-panel, .lv-node")].filter(x => x.getClientRects().length).map(x => ({ r: x.getBoundingClientRect(), hold: x.classList.contains("is-holder") }));
    const free = (lx, ly) => { const [x, y] = toScreen(lx, ly), m = Math.max(c.w, c.h) * f; return blocks.every(({ r: b, hold }) => {
      if (hold) { const k = b.width * 0.03; if (x >= b.left + k && y >= b.top + k && x + m <= b.right - k && y + m <= b.bottom - k) return true; }   // wholly inside a holder: held, not in the way
      return x + m + 3 <= b.left || b.right + 3 <= x || y + m + 3 <= b.top || b.bottom + 3 <= y; }); };
    if (free(c.x, c.y)) return;
    for (let d = 8; d < Math.max(vw, vh); d += 8) for (let a = 0; a < 16; a++) {
      const x = c.x + d * Math.cos(a * Math.PI / 8), y = c.y + d * Math.sin(a * Math.PI / 8);
      const B = room(c.w, c.h);
      if (x < B.x0 || y < B.y0 || x > B.x1 || y > B.y1 || !free(x, y)) continue;
      glideTo(x / vw, y / vh); return;
    }
  }
  // it steps aside gliding, never at once (owner, 2026-10-12: supers do not move suddenly); its wires follow it
  function glideTo(fx, fy) {
    const done = () => { save(state); document.dispatchEvent(new CustomEvent("se:frame")); };
    if (state.x == null || state.y == null) { const r = el.getBoundingClientRect(), [lx, ly] = toLayout(r.left, r.top); state.x = lx / window.innerWidth; state.y = ly / window.innerHeight; }
    if (!window.SeMotion) { state.x = fx; state.y = fy; place(); done(); return; }
    const s = { x: state.x, y: state.y };
    window.SeMotion.tween(s, { x: fx, y: fy }, { duration: 380, easing: "easeOutCubic", update: () => { state.x = s.x; state.y = s.y; place(); document.dispatchEvent(new CustomEvent("se:frame")); }, complete: done });
  }
  // a window or a super arriving on the compact project super: it steps off, gliding (orbit.js's layout tick says when
  // the windows changed, as "se:windows")
  document.addEventListener("se:windows", () => { if (el && !el.classList.contains("is-open") && !el._pjDrag) settleFree(); });
  function dragFrom(e) {
    if (el.classList.contains("is-open")) return;                    // open, it stays put: zoom out to move it
    if (window.SeLock && window.SeLock.isLocked(el)) return;   // locked: it keeps its place
    el._pjDrag = true;
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved && window.SeHold) window.SeHold.begin(el);                // what it holds comes along (super/hold.js)
      moved = true;
      const [lx, ly] = toLayout(ev.clientX - dx, ev.clientY - dy);     // where it goes, unzoomed (the page may be zoomed out)
      state.x = lx / window.innerWidth; state.y = ly / window.innerHeight;
      place();
      if (window.SeHold) window.SeHold.follow(el);
      document.dispatchEvent(new CustomEvent("se:frame:first")); document.dispatchEvent(new CustomEvent("se:frame"));   // its ports and wires follow it, as a bubble's do
    };
    const up = ev => {
      const ev2x = ev ? ev.clientX : -1, ev2y = ev ? ev.clientY : -1;
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true);
      el._pjDrag = false;
      if (window.SeHold) window.SeHold.end(el);
      if (!moved) return;
      if (ev2x >= 0 && window.SeSite && window.SeSite.inSite && !window.SeSite.inSite(ev2x, ev2y)) { if ((window.SeSave && window.SeSave.isSaved(el)) || (window.SeBind && window.SeBind.isBound(el))) { if (window.SeShape && window.SeShape.note) window.SeShape.note(ev2x, ev2y, "saved", "unsave it to delete it"); } else { goAway(); return; } }   // dropped outside the inner super: gone on purpose
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
  window.SeProject = { open: () => setT(1), close: () => setT(0), ask,
    // moved with a holder it sits in (super/nodes.js): by a screen offset, compact only
    remove: () => goAway(),                                            // super/delete.js: deleted after a confirmation
    // Shift + drag (super/shiftsize.js): its compact width and height, in layout px
    resize: (w, h) => { state.w = Math.round(Math.max(10, w)); state.h = Math.round(Math.max(10, h)); place(); save(state); document.dispatchEvent(new CustomEvent("se:frame")); },
    moveBy: (dx, dy) => {
      if (!el || el.classList.contains("is-open")) return;
      if (state.x == null || state.y == null) { const r = el.getBoundingClientRect(), [lx, ly] = toLayout(r.left, r.top); state.x = lx / window.innerWidth; state.y = ly / window.innerHeight; }
      const f = zoomOf().f || 1; state.x += dx / f / window.innerWidth; state.y += dy / f / window.innerHeight; place(); save(state);
    },
    inRect: (r, k) => { if (!el || el.classList.contains("is-open")) return false; const b = el.getBoundingClientRect(); return b.left >= r.left + k && b.right <= r.right - k && b.top >= r.top + k && b.bottom <= r.bottom - k; }, program: () => ({ supers: P.map(n => ({ id: n.id, label: n.label, kind: n.kind })), wires: WIRES.slice() }) };
})();
