// super/controls.js: the main canvas's controls and conditions (owner, 2026-10-13: "the top of the canvas have controls
// like stop, run, play, repeat, next, previous, and the bottom has conditions like time, when, how, then, if"; "controls
// and conditions are only in the main canvas"). They sit on the main super's top edge, either side of its sync port,
// and on its bottom edge, either side of its condition port: control comes in at the top and conditions at the bottom,
// as every super's sync and condition ports do (data goes in at the left and out at the right).
//
// The controls act on the selected super (the main or second super selected: on every Super AI super):
//   previous / next   select the super before or after it, in reading order
//   stop              stop it: a Super AI super stops asking, a window closes, a bubble or the project compacts;
//                     repeat and play stop too
//   run               run it once: a Super AI super asks (or computes), a bubble opens, a pill opens its window,
//                     the project opens
//   play              run every Super AI super in turn, from the first, `time` apart
//   repeat            run it again every `time` (on until pressed again or stopped)
// The conditions (a click on one types its value; Enter keeps it, empty clears it) shape every run:
//   time   how long between repeats and plays: 10, 10s, 2m (default 10 s)
//   when   when to run by itself: "changes" (whenever its value changes), "start" (on load), or a clock time 09:30
//   how    which engines answer: llama, mistral… (several by commas or spaces); empty: all of them
//   then   what follows a run: "next" (the next super runs), "stop", or words such as "open explore"
//   if     run only if its value passes: > 5, < 3, = yes, or a word it must contain
// Kept as se:cond (the conditions) in the visitor's browser.
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {}, LV = () => window.LabView || {}, SS = () => window.SeSelect || {};
  const SVG = d => '<svg viewBox="0 0 16 16" aria-hidden="true">' + d + "</svg>";
  const ICON = {
    previous: SVG('<path d="M4 3v10" stroke-width="1.6"/><path class="f" d="M13 3.5v9L6 8z"/>'),
    stop: SVG('<rect class="f" x="3.5" y="3.5" width="9" height="9"/>'),
    run: SVG('<path class="f" d="M4.5 3v10L13 8z"/>'),
    play: SVG('<path class="f" d="M2 3.5v9L8 8z"/><path class="f" d="M8 3.5v9L14 8z"/>'),
    repeat: SVG('<path d="M12.6 6.2A5 5 0 1 0 13 9.6" stroke-width="1.6"/><path class="f" d="M14.2 2.6v4.6H9.6z"/>'),
    next: SVG('<path class="f" d="M3 3.5v9L10 8z"/><path d="M12 3v10" stroke-width="1.6"/>'),
  };
  const CONTROLS = ["previous", "stop", "run", "play", "repeat", "next"];
  const CONDS = ["time", "when", "how", "then", "if"];
  const HINT = { time: "10s", when: "changes", how: "llama", then: "next", if: "> 5" };
  let top, bottom, cond = {}, repT = 0, playT = 0, playing = false, repeating = false, whenT = 0, lastVal = new Map(), clockDone = "";
  try { cond = JSON.parse(localStorage.getItem("se:cond") || "{}") || {}; } catch (_) { cond = {}; }
  const save = () => { try { localStorage.setItem("se:cond", JSON.stringify(cond)); } catch (_) { /* private mode */ } };
  const say = t => { const o = document.querySelector(".lv-out"); if (o) o.textContent = t; flash(t); };
  let noteEl, noteT = 0;
  function flash(t) {
    if (!noteEl) { noteEl = document.createElement("div"); noteEl.className = "se-ctl-note"; noteEl.setAttribute("aria-hidden", "true"); document.body.appendChild(noteEl); }
    noteEl.textContent = t; noteEl.classList.add("is-on"); clearTimeout(noteT); noteT = setTimeout(() => noteEl.classList.remove("is-on"), 2200);
    if (bottom) { const r = bottom.getBoundingClientRect(); noteEl.style.left = (window.innerWidth / 2) + "px"; noteEl.style.top = (r.top - 30) + "px"; }
  }

  // ---- what the controls act on ------------------------------------------------------------------
  const SUPERS = ".orbit-title .se-titlesuper, .orbit-bubble[data-key]:not([hidden]), .orbit-panel:not(.leaving), .se-project, .lv-node[data-id]";
  const shown = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.getClientRects().length; };
  function order() {                                                     // every super on the page, in reading order
    const all = [...document.querySelectorAll(SUPERS)].filter(shown).map(el => ({ el, r: el.getBoundingClientRect() }));
    const row = Math.max(24, window.innerHeight * 0.04);
    all.sort((a, b) => Math.abs(a.r.top - b.r.top) > row ? a.r.top - b.r.top : a.r.left - b.r.left);
    return all.map(x => x.el);
  }
  const engines = () => order().filter(el => el.classList.contains("lv-node") && LV().isEngine && LV().isEngine(el));
  const target = () => { const s = SS().selected ? SS().selected() : ""; return s && typeof s !== "string" ? s : null; };   // an element, or null for the main and second supers
  const nameOf = el => !el ? "every super" : el.classList.contains("orbit-panel") ? "the window" : el.classList.contains("orbit-bubble") ? ((el.querySelector(":scope > .ob-label") || {}).textContent || "the bubble").trim() : el.classList.contains("se-project") ? "the project" : el.classList.contains("lv-node") ? "the super" : el.classList.contains("ob-member") ? (el.textContent || "the pill").trim().slice(0, 30) : "the title";
  function valueOf(el) {
    if (!el) return "";
    if (el.classList.contains("lv-node")) return LV().valueOf ? LV().valueOf(el) : el.textContent || "";
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400);
  }

  // ---- the conditions ------------------------------------------------------------------------------
  function seconds() {
    const m = /^\s*([\d.]+)\s*(ms|s|sec|m|min|h)?\s*$/i.exec(cond.time || "");
    if (!m) return 10;
    const v = +m[1], u = (m[2] || "s").toLowerCase();
    return Math.max(0.5, Math.min(86400, u === "ms" ? v / 1000 : u[0] === "m" && u !== "ms" ? v * 60 : u === "h" ? v * 3600 : v));
  }
  const how = () => { const v = (cond.how || "").trim(); return v ? v.split(/[\s,;]+/).filter(Boolean) : null; };
  function passes(el) {                                                  // the "if" condition on its value
    const c = (cond.if || "").trim(); if (!c) return true;
    const v = valueOf(el), m = /^(>=|<=|!=|>|<|=)\s*(.+)$/.exec(c);
    if (m) {
      const a = parseFloat(String(v).replace(/[^\d.eE+-]/g, " ").trim().split(/\s+/)[0]), b = parseFloat(m[2]), num = isFinite(a) && isFinite(b);
      const x = num ? a : v.trim().toLowerCase(), y = num ? b : m[2].trim().toLowerCase();
      return m[1] === ">" ? x > y : m[1] === "<" ? x < y : m[1] === ">=" ? x >= y : m[1] === "<=" ? x <= y : m[1] === "!=" ? x !== y : x === y;
    }
    return v.toLowerCase().includes(c.toLowerCase());
  }
  function after(el) {                                                   // the "then" condition
    const t = (cond.then || "").trim().toLowerCase(); if (!t) return;
    if (t === "next") { setTimeout(() => { step(1); runOne(target()); }, 600); return; }
    if (t === "stop") { stopAll(); return; }
    if (t === "previous") { setTimeout(() => { step(-1); runOne(target()); }, 600); return; }
    if (LV().act && LV().act(cond.then)) return;
  }

  // ---- the controls ---------------------------------------------------------------------------------
  function runOne(el, quiet) {
    if (!el) { const all = engines(); if (!all.length) { say("Nothing to run: double click to make a super, type into it, then run"); return false; } all.forEach(n => runOne(n, true)); say("Ran " + all.length + " super" + (all.length > 1 ? "s" : "")); return true; }
    if (!passes(el)) { if (!quiet) say("if " + cond.if + ": not met, " + nameOf(el) + " does not run"); return false; }
    let ok = false;
    if (el.classList.contains("lv-node")) ok = !!(LV().run && LV().run(el));
    else if (el.classList.contains("orbit-bubble")) ok = !!(window.SeBubble && window.SeBubble.open(el, true) !== false);
    else if (el.classList.contains("ob-member")) { const k = el.dataset.key; if (k && O().openKey) { O().openKey(k); ok = true; } }
    else if (el.classList.contains("se-project")) { if (window.SeProject) { window.SeProject.open(); ok = true; } }
    else if (el.classList.contains("orbit-panel")) { el.classList.remove("se-held"); ok = true; }
    if (!quiet) say(ok ? "Run: " + nameOf(el) : nameOf(el) + " cannot run (locked?)");
    if (ok) after(el);
    return ok;
  }
  function stopOne(el) {
    if (!el) return;
    if (el.classList.contains("lv-node")) { if (LV().stop) LV().stop(el); }
    else if (el.classList.contains("orbit-bubble")) { if (window.SeBubble && !el.classList.contains("is-compact")) window.SeBubble.open(el, false); }
    else if (el.classList.contains("orbit-panel")) { const k = O().keyOf && O().keyOf(el) || (el.item && el.item.key); if (k && O().close) O().close(k); }
    else if (el.classList.contains("se-project")) { if (window.SeProject) window.SeProject.close(); }
  }
  function stopAll() {
    clearTimeout(repT); clearTimeout(playT); repT = playT = 0; playing = repeating = false; mark();
    const el = target();
    if (el) stopOne(el); else engines().forEach(n => LV().stop && LV().stop(n));
    say("Stopped " + nameOf(el));
  }
  function step(d) {
    const all = order(); if (!all.length) return;
    const cur = target(), i = cur ? all.indexOf(cur) : -1;
    const next = all[((i < 0 ? (d > 0 ? -1 : 0) : i) + d + all.length) % all.length];
    if (SS().select) SS().select(next);
    say("Selected " + nameOf(next));
  }
  function play() {
    if (playing) { playing = false; clearTimeout(playT); mark(); say("Play stopped"); return; }
    const list = engines(); if (!list.length) { say("Nothing to play: no Super AI super has words yet"); return; }
    playing = true; mark();
    let i = 0;
    const go = () => {
      if (!playing) return;
      if (i >= list.length) { playing = false; mark(); say("Played " + list.length); return; }
      const el = list[i++]; if (SS().select) SS().select(el);
      runOne(el, true); say("Playing " + i + " of " + list.length);
      // the next one when this one has answered (or after `time`, whichever is later)
      const t0 = performance.now(), wait = () => { if (!playing) return; const busy = LV().busy && LV().busy(el); if (busy && performance.now() - t0 < 120000) { playT = setTimeout(wait, 400); return; } playT = setTimeout(go, Math.max(0, seconds() * 1000 - (performance.now() - t0))); };
      playT = setTimeout(wait, 400);
    };
    go();
  }
  function repeat() {
    if (repeating) { repeating = false; clearTimeout(repT); mark(); say("Repeat off"); return; }
    repeating = true; mark();
    const el = target();
    const go = () => { if (!repeating) return; if (el && !el.isConnected) { repeating = false; mark(); return; } runOne(el, true); repT = setTimeout(go, seconds() * 1000); };
    say("Repeating " + nameOf(el) + " every " + seconds() + " s"); go();
  }
  const ACT = { previous: () => step(-1), next: () => step(1), stop: stopAll, run: () => runOne(target()), play, repeat };

  // "when": watched once a second
  function watch() {
    const w = (cond.when || "").trim().toLowerCase();
    if (!w || !on()) return;
    const clock = /^(\d{1,2}):(\d{2})$/.exec(w);
    if (clock) {
      const d = new Date(), stamp = d.toDateString() + w;
      if (d.getHours() === +clock[1] && d.getMinutes() === +clock[2] && clockDone !== stamp) { clockDone = stamp; runOne(target()); }
      return;
    }
    if (w === "changes" || w === "change" || w === "changed") {
      const list = target() ? [target()] : engines();
      list.forEach(el => { const v = valueOf(el), was = lastVal.get(el); lastVal.set(el, v); if (was != null && was !== v && !(LV().busy && LV().busy(el))) { if (passes(el)) after(el); } });
    }
  }

  // ---- the bars ------------------------------------------------------------------------------------
  function build() {
    if (top || !on() || !document.body) return;
    top = document.createElement("div"); top.className = "se-ctlbar se-ctl-top"; top.setAttribute("role", "toolbar"); top.setAttribute("aria-label", "controls");
    const half = (list, side) => '<div class="se-ctl-half se-ctl-' + side + '">' + list.map(k => '<button type="button" class="se-ctl" data-ctl="' + k + '" title="' + k + '">' + ICON[k] + '<span class="se-ctl-w">' + k + "</span></button>").join("") + "</div>";
    top.innerHTML = half(CONTROLS.slice(0, 3), "l") + half(CONTROLS.slice(3), "r");
    bottom = document.createElement("div"); bottom.className = "se-ctlbar se-ctl-bottom"; bottom.setAttribute("role", "toolbar"); bottom.setAttribute("aria-label", "conditions");
    const chip = k => '<label class="se-cond" data-cond="' + k + '"><span class="se-cond-k">' + k + '</span><input class="se-cond-v" size="1" spellcheck="false" placeholder="' + HINT[k] + '" aria-label="' + k + '"></label>';
    bottom.innerHTML = '<div class="se-ctl-half se-ctl-l">' + CONDS.slice(0, 2).map(chip).join("") + '</div><div class="se-ctl-half se-ctl-r">' + CONDS.slice(2).map(chip).join("") + "</div>";
    document.body.appendChild(top); document.body.appendChild(bottom);
    // the bars are the main canvas's own: a press, scroll or double click on them goes nowhere else
    [top, bottom].forEach(b => ["pointerdown", "dblclick", "wheel", "click", "keydown"].forEach(t => b.addEventListener(t, e => { e.stopPropagation(); }, { passive: t !== "click" && t !== "dblclick" && t !== "keydown" })));
    top.addEventListener("click", e => { const b = e.target.closest(".se-ctl"); if (!b) return; e.preventDefault(); ACT[b.dataset.ctl](); });
    bottom.querySelectorAll(".se-cond").forEach(c => {
      const k = c.dataset.cond, inp = c.querySelector("input");
      inp.value = cond[k] || ""; fitInput(inp);
      inp.addEventListener("input", () => fitInput(inp));
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } if (e.key === "Escape") { inp.value = cond[k] || ""; fitInput(inp); inp.blur(); } });
      inp.addEventListener("change", () => commit(k, inp));
      inp.addEventListener("blur", () => commit(k, inp));
    });
    mark(); place();
  }
  function fitInput(inp) { inp.size = Math.max(1, Math.min(18, (inp.value || "").length || 1)); inp.closest(".se-cond").classList.toggle("is-set", !!inp.value.trim()); }
  function commit(k, inp) {
    const v = inp.value.trim(); if ((cond[k] || "") === v) return;
    if (v) cond[k] = v; else delete cond[k];
    save(); fitInput(inp); lastVal.clear();
    say(v ? k + " " + v : k + " cleared");
  }
  function mark() {
    if (!top) return;
    const set = (k, v) => { const b = top.querySelector('[data-ctl="' + k + '"]'); if (b) { b.classList.toggle("is-on", v); b.setAttribute("aria-pressed", v ? "true" : "false"); } };
    set("play", playing); set("repeat", repeating);
  }
  // either side of the main super's sync port (top) and condition port (bottom), just inside its edge
  function place() {
    if (!top) return;
    const vis = on();
    top.hidden = bottom.hidden = !vis; if (!vis) return;
    const sync = document.querySelector('.se-port[data-pid="main/sync"]'), cnd = document.querySelector('.se-port[data-pid="main/condition"]');
    const W = window.innerWidth, H = window.innerHeight;
    const sr = sync && sync.getBoundingClientRect(), cr = cnd && cnd.getBoundingClientRect();
    const cx = sr && sr.width ? sr.left + sr.width / 2 : W / 2, ty = sr && sr.width ? sr.top + sr.height / 2 : 3;
    const bx = cr && cr.width ? cr.left + cr.width / 2 : W / 2, by = cr && cr.width ? cr.top + cr.height / 2 : H - 3;
    const st = (el, x, y) => { const l = Math.round(x) + "px", t = Math.round(y) + "px"; if (el.style.left !== l) el.style.left = l; if (el.style.top !== t) el.style.top = t; };
    // clear of the title super (top left): on a narrow screen the bar goes just under it
    let y = Math.max(4, ty + 4);
    const tt = document.querySelector(".orbit-title .se-titlesuper"), l = top.querySelector(".se-ctl-l");
    if (tt && l) { const a = tt.getBoundingClientRect(), b = l.getBoundingClientRect(); if (a.width && b.width && b.left < a.right + 4 && y < a.bottom + 4) y = Math.round(a.bottom + 6); }
    st(top, cx, y); st(bottom, bx, Math.min(H - 4, by - 4));
  }
  function loop() { place(); requestAnimationFrame(loop); }
  function start() {
    build(); if (!top) { setTimeout(start, 400); return; }
    requestAnimationFrame(loop);
    whenT = setInterval(watch, 1000);
    if ((cond.when || "").trim().toLowerCase() === "start") setTimeout(() => runOne(target()), 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.SeControls = { act: k => ACT[k] && ACT[k](), how, seconds, conditions: () => Object.assign({}, cond), set: (k, v) => { if (CONDS.includes(k)) { if (v) cond[k] = String(v); else delete cond[k]; save(); const i = bottom && bottom.querySelector('[data-cond="' + k + '"] input'); if (i) { i.value = cond[k] || ""; fitInput(i); } } } };
})();
