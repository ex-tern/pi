// Super prompt: one question, every engine, each answer in its own card as it arrives.
//
// The engines are the project's own (siM, riB, piD, PiEn) and the outside models the
// panel uses (Llama, Mistral, Qwen, Gemini, DeepSeek); see backend/super_engine.py
// (/api/super/engines, /one, /weigh). Each engine is asked on its own, so its card fills
// in the moment it answers; once two outside models have answered, the judge weighs them.
//
// In the superellipse look a double click on bare page makes a Super AI super
// (super/nodes.js): what is typed into it is asked here (SuperPrompt.run), its short
// answer shows inside it, and pressing it opens this box with every engine's answer
// (SuperPrompt.open(question, run)). In the round look a double click on empty space
// opens the box directly; double-clicking the π mark itself still stops π.
(function () {
  "use strict";
  if (window.__superprompt) return;
  window.__superprompt = true;

  const API = "/api/super";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // just enough markdown for model answers: code blocks, inline code, bold, italics, lists, paragraphs
  function md(s) {
    const blocks = [];
    let t = esc(s).replace(/```[a-z0-9]*\n?([\s\S]*?)```/gi, (_, c) => { blocks.push(c); return "\u0000" + (blocks.length - 1) + "\u0000"; });
    t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>")
      .replace(/^[ \t]*[-*•][ \t]+(.+)$/gm, "<li>$1</li>")
      .replace(/^[ \t]*\d+[.)][ \t]+(.+)$/gm, "<li>$1</li>");
    t = t.split(/\n{2,}/).map(p => /^\s*\u0000\d+\u0000\s*$/.test(p) ? p.trim() : /^\s*<li>/.test(p) ? "<ul>" + p.replace(/\n/g, "") + "</ul>" : "<p>" + p.replace(/\n/g, "<br>") + "</p>").join("");
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => "<pre>" + blocks[+i] + "</pre>");
  }
  const post = (path, data, signal) => fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal });

  // ------------------------------------------------------------ the engines
  let engines = null, judgeOn = false, loading = null;
  function loadEngines() {
    if (engines) return Promise.resolve(engines);
    if (loading) return loading;
    loading = fetch(API + "/engines").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(j => { engines = j.engines || []; judgeOn = !!j.judge; return engines; })
      .catch(() => null).finally(() => { loading = null; });
    return loading;
  }

  // One question to every engine. Returns a run: {q, engines, results: {id: {state, text, model, ms}},
  // verdict, done (a promise), stop()}; listeners added with run.on(fn) hear every change.
  function run(q, opts) {
    const r = { q, engines: [], off: [], results: {}, verdict: null, fns: [], stopped: false };
    const ctrl = new AbortController();
    r.on = fn => { r.fns.push(fn); return r; };
    const emit = () => r.fns.forEach(fn => { try { fn(r); } catch (_) { /* a listener's fault is its own */ } });
    r.stop = () => { r.stopped = true; ctrl.abort(); };
    r.done = loadEngines().then(all => {
      if (!all) { r.error = "The engines cannot be reached from here right now."; emit(); return r; }
      r.engines = all.filter(e => e.ready);
      const only = opts && Array.isArray(opts.only) && opts.only.length ? opts.only.map(x => String(x).toLowerCase()) : null;   // the canvas's "how" condition: these engines only
      if (only) { const some = r.engines.filter(e => only.includes(String(e.id).toLowerCase()) || only.includes(String(e.name || "").toLowerCase())); if (some.length) r.engines = some; }
      r.off = all.filter(e => !e.ready);
      r.engines.forEach(e => { r.results[e.id] = { state: "wait" }; });
      const outside = r.engines.filter(e => e.kind === "outside");
      if (outside.length >= 2 && judgeOn) r.verdict = { state: "wait", text: "" };
      emit();
      const answered = [];
      const asks = r.engines.map(e => post("/one", { engine: e.id, prompt: q }, ctrl.signal)
        .then(res => res.json().then(j => ({ ok: res.ok, j })))
        .then(({ ok, j }) => {
          const ans = ok && j.ok;
          r.results[e.id] = { state: ans ? "ok" : "err", text: (ans ? j.text : (j.text || j.detail)) || "No answer.", model: j.model || "", ms: j.ms };
          if (ans && e.kind === "outside") answered.push({ label: e.name, answer: j.text, confidence: j.confidence });
        })
        .catch(() => { if (!r.stopped) r.results[e.id] = { state: "err", text: "Could not reach this engine." }; })
        .finally(emit));
      return Promise.all(asks).then(() => {
        if (!r.verdict || r.stopped) return r;
        if (answered.length < 2) { r.verdict = { state: "err", text: "Fewer than two outside models answered, so there is nothing to weigh." }; emit(); return r; }
        r.verdict.state = "weigh"; emit();
        return post("/weigh", { prompt: q, answers: answered }, ctrl.signal).then(res => res.json())
          .then(j => { r.verdict = j.ok ? { state: "ok", text: j.text, agreement: j.agreement, model: j.model || "" } : { state: "err", text: j.text || j.detail || "The judge did not answer." }; })
          .catch(() => { r.verdict = { state: "err", text: "The judge could not be reached." }; })
          .then(() => { emit(); return r; });
      });
    });
    r.done.then(() => { r.finished = true; emit(); });
    return r;
  }
  // the short answer a super shows inside itself: the verdict, else the lab's own answer, else the first one
  function summary(r) {
    if (r.verdict && r.verdict.state === "ok") return r.verdict.text;
    const firstOk = id => r.results[id] && r.results[id].state === "ok" ? r.results[id].text : "";
    return firstOk("sim") || (r.engines.map(e => firstOk(e.id)).find(Boolean)) || (r.error || "");
  }

  // ------------------------------------------------------------ the box
  let box = null, list = null, input = null, current = null;

  function build() {
    box = document.createElement("div");
    box.className = "sp-veil";
    box.hidden = true;
    box.innerHTML =
      '<div class="sp-box" role="dialog" aria-modal="true" aria-labelledby="sp-title">' +
      '<div class="sp-head"><h2 id="sp-title">Super AI</h2>' +
      '<span class="sp-hint">Every engine in the lab and outside it, at once</span>' +
      '<button type="button" class="sp-x" aria-label="Close">×</button></div>' +
      '<form class="sp-form"><textarea class="sp-in" rows="3" maxlength="4000" placeholder="Ask anything…" aria-label="Your question"></textarea>' +
      '<div class="sp-row"><span class="sp-keys">Enter to ask · Shift+Enter for a new line · Esc to close</span>' +
      '<button type="submit" class="btn btn-primary sp-go">Ask every engine</button></div></form>' +
      '<div class="sp-list" aria-live="polite"></div></div>';
    document.body.appendChild(box);
    list = box.querySelector(".sp-list");
    input = box.querySelector(".sp-in");
    box.addEventListener("pointerdown", e => { if (e.target === box) close(); });
    box.querySelector(".sp-x").addEventListener("click", close);
    box.querySelector(".sp-form").addEventListener("submit", e => { e.preventDefault(); ask(); });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
    });
    box.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    // clicks in the box stay in the box (a click on the page closes windows, a double click makes a super)
    ["click", "dblclick"].forEach(t => box.addEventListener(t, e => e.stopPropagation()));
  }

  // open the box; with a question and a run (a super's), show that run's answers
  function open(q, r, onAsk) {
    if (!box) build();
    box.hidden = false;
    box.onAsk = onAsk || null;
    document.documentElement.classList.add("sp-open");
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();   // a double click selects a word; drop it
    if (q != null) input.value = q;
    if (r) show(r);
    else loadEngines().then(all => { if (!current) idle(all); });
    setTimeout(() => { input.focus(); if (!r) input.select(); }, 0);
  }
  function close() {
    if (!box) return;
    box.hidden = true;
    document.documentElement.classList.remove("sp-open");
  }

  function idle(all) {
    if (!all) { list.innerHTML = '<p class="sp-note">The engines cannot be reached from here right now.</p>'; return; }
    const ready = all.filter(e => e.ready), off = all.filter(e => !e.ready);
    list.innerHTML = '<p class="sp-note">Ready: ' + ready.map(e => esc(e.name)).join(", ") +
      (off.length ? '<br><span class="sp-off">No key yet: ' + off.map(e => esc(e.name)).join(", ") + "</span>" : "") + "</p>";
  }

  function card(name, kind) {
    const el = document.createElement("article");
    el.className = "sp-card is-wait";
    el.innerHTML =
      '<header><strong>' + esc(name) + '</strong>' +
      '<span class="sp-kind">' + (kind === "project" ? "in the lab" : kind === "judge" ? "the judge" : "outside") + "</span>" +
      '<span class="sp-meta">asking…</span>' +
      '<button type="button" class="sp-copy" aria-label="Copy ' + esc(name) + "'s answer\" hidden>Copy</button></header>" +
      '<div class="sp-body"><span class="sp-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>';
    return el;
  }
  function fill(el, res, metaOk) {
    if (!res || res.state === "wait" || res.state === "weigh") {
      if (res && res.state === "weigh") el.querySelector(".sp-meta").textContent = "weighing…";
      return;
    }
    if (el.dataset.done === res.text) return;
    el.dataset.done = res.text;
    el.classList.remove("is-wait");
    el.classList.toggle("is-err", res.state !== "ok");
    const meta = el.querySelector(".sp-meta"), body = el.querySelector(".sp-body"), copy = el.querySelector(".sp-copy");
    if (res.state === "ok") {
      body.innerHTML = md(res.text);
      meta.textContent = metaOk;
      copy.hidden = false;
      copy.onclick = () => navigator.clipboard && navigator.clipboard.writeText(res.text).then(() => { copy.textContent = "Copied"; setTimeout(() => copy.textContent = "Copy", 1200); });
    } else {
      body.innerHTML = '<p class="sp-off">' + esc(res.text) + "</p>";
      meta.textContent = "no answer";
    }
  }

  // render a run into the box and keep it current
  function show(r) {
    current = r;
    list.innerHTML = "";
    const cards = {};
    let verdictEl = null;
    const paint = () => {
      if (current !== r) return;
      if (r.error && !r.engines.length) { list.innerHTML = '<p class="sp-note">' + esc(r.error) + "</p>"; return; }
      if (r.verdict && !verdictEl) {
        verdictEl = card("Verdict", "judge");
        verdictEl.classList.add("sp-verdict");
        verdictEl.querySelector(".sp-meta").textContent = "waiting for the outside models…";
        list.prepend(verdictEl);
      }
      r.engines.forEach(e => {
        if (!cards[e.id]) { cards[e.id] = card(e.name, e.kind); list.appendChild(cards[e.id]); }
        const res = r.results[e.id];
        fill(cards[e.id], res, res ? [res.model, res.ms != null ? (res.ms / 1000).toFixed(1) + " s" : ""].filter(Boolean).join(" · ") : "");
      });
      if (verdictEl && r.verdict) fill(verdictEl, r.verdict, [r.verdict.agreement ? r.verdict.agreement + " agreement" : "", r.verdict.model].filter(Boolean).join(" · "));
      if (r.off.length && !list.querySelector(".sp-off-note")) {
        const p = document.createElement("p");
        p.className = "sp-note sp-off sp-off-note";
        p.textContent = "Not asked (no API key on this site yet): " + r.off.map(e => e.name).join(", ");
        list.appendChild(p);
      }
    };
    r.on(paint);
    paint();
  }

  function ask() {
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    if (current && !current.finished) current.stop();
    const r = run(q);
    if (box.onAsk) box.onAsk(q, r);   // a super that opened the box hears the new question
    show(r);
  }

  // ------------------------------------------------------------ the trigger (round look only)
  // Empty space: not a control, window, bubble, node, wire or the π mark itself. In the superellipse
  // look a double click on bare page makes a Super AI super instead (super/nodes.js).
  const merged = () => document.documentElement.classList.contains("shape-se");
  const BUSY = "a, button, input, textarea, select, label, summary, [contenteditable], [role=button], [role=dialog], " +
    ".orbit-bubble, .orbit-pi, .orbit-title, .orbit-panel, .wire-handle, .wire-hit, .orbit-mark, .orbit-core, .lv-node, .live-dock, " +
    ".buddy-win, .sp-veil, header, nav, footer, form, table, pre, code, video, img, iframe, " +
    "p, li, h1, h2, h3, h4, h5, h6, dd, dt, td, th, blockquote";
  document.addEventListener("dblclick", e => {
    if (merged() || e.shiftKey || e.button || e.defaultPrevented) return;
    const t = e.target;
    if (!t || !t.closest || t.closest(BUSY)) return;
    e.preventDefault();
    e.stopPropagation();
    open();
  }, true);

  window.SuperPrompt = { open, close, run, summary, loadEngines };
})();
