// Super prompt: double-click empty space to open a box that asks every engine at once.
//
// The engines are the project's own (siM, riB, piD, PiEn) and the outside models the
// panel uses (Llama, Mistral, Qwen, Gemini, DeepSeek); see backend/super_engine.py
// (/api/super/engines, /one, /weigh). Each engine is asked on its own, so its card fills
// in the moment it answers; once two outside models have answered, the judge weighs them.
// In the superellipse look Shift + double-click still makes a node (super/nodes.js);
// in the round look double-clicking the π mark itself still stops π.
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

  let box = null, list = null, input = null, engines = null, run = 0, judgeOn = false, verdict = null, lastOutside = [];
  const post = (path, data) => fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

  // the judge reads the outside models' answers and says what they agree on
  function weigh(q, mine) {
    if (!verdict) return;
    const meta = verdict.querySelector(".sp-meta"), body = verdict.querySelector(".sp-body");
    if (lastOutside.length < 2) {
      verdict.classList.remove("is-wait"); verdict.classList.add("is-err");
      meta.textContent = "nothing to weigh";
      body.innerHTML = '<p class="sp-off">Fewer than two outside models answered, so there is nothing to weigh.</p>';
      return;
    }
    meta.textContent = "weighing…";
    post("/weigh", { prompt: q, answers: lastOutside })
      .then(r => r.json())
      .then(j => {
        if (mine !== run) return;
        verdict.classList.remove("is-wait");
        if (j.ok) {
          body.innerHTML = md(j.text);
          meta.textContent = (j.agreement ? j.agreement + " agreement" : "") + (j.model ? (j.agreement ? " · " : "") + j.model : "");
        } else {
          verdict.classList.add("is-err");
          body.innerHTML = '<p class="sp-off">' + esc(j.text || j.detail || "The judge did not answer.") + "</p>";
          meta.textContent = "no verdict";
        }
      })
      .catch(() => { if (mine === run) { verdict.classList.remove("is-wait"); verdict.classList.add("is-err"); meta.textContent = "no verdict"; } });
  }

  function build() {
    box = document.createElement("div");
    box.className = "sp-veil";
    box.hidden = true;
    box.innerHTML =
      '<div class="sp-box" role="dialog" aria-modal="true" aria-labelledby="sp-title">' +
      '<div class="sp-head"><h2 id="sp-title">Super prompt</h2>' +
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
    // stop clicks in the box from reaching the page (the mark closes windows on click)
    ["click", "dblclick"].forEach(t => box.addEventListener(t, e => e.stopPropagation()));
  }

  function open() {
    if (!box) build();
    box.hidden = false;
    document.documentElement.classList.add("sp-open");
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();   // a double-click selects a word; drop it
    setTimeout(() => { input.focus(); input.select(); }, 0);
    loadEngines();
  }
  function close() {
    if (!box) return;
    box.hidden = true;
    document.documentElement.classList.remove("sp-open");
  }

  async function loadEngines() {
    if (engines) return engines;
    try {
      const r = await fetch(API + "/engines");
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      engines = j.engines || [];
      judgeOn = !!j.judge;
    } catch (_) {
      engines = null;
      list.innerHTML = '<p class="sp-note">The engines cannot be reached from here right now.</p>';
    }
    if (engines && !list.children.length) idle();
    return engines;
  }

  function idle() {
    const ready = engines.filter(e => e.ready), off = engines.filter(e => !e.ready);
    list.innerHTML = '<p class="sp-note">Ready: ' + ready.map(e => esc(e.name)).join(", ") +
      (off.length ? '<br><span class="sp-off">No key yet: ' + off.map(e => esc(e.name)).join(", ") + "</span>" : "") + "</p>";
  }

  function card(e) {
    const el = document.createElement("article");
    el.className = "sp-card is-wait";
    el.innerHTML =
      '<header><strong>' + esc(e.name) + '</strong>' +
      '<span class="sp-kind">' + (e.kind === "project" ? "in the lab" : e.kind === "judge" ? "the judge" : "outside") + "</span>" +
      '<span class="sp-meta">asking…</span>' +
      '<button type="button" class="sp-copy" aria-label="Copy ' + esc(e.name) + "'s answer\" hidden>Copy</button></header>" +
      '<div class="sp-body"><span class="sp-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>';
    return el;
  }

  async function ask() {
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    const all = await loadEngines();
    if (!all) return;
    const mine = ++run;
    const ready = all.filter(e => e.ready), off = all.filter(e => !e.ready);
    const outside = [];
    let pending = ready.filter(e => e.kind === "outside").length;
    list.innerHTML = "";
    if (pending >= 2 && judgeOn) {
      verdict = card({ name: "Verdict", kind: "judge" });
      verdict.classList.add("sp-verdict");
      verdict.querySelector(".sp-meta").textContent = "waiting for the outside models…";
      list.appendChild(verdict);
    } else verdict = null;
    lastOutside = outside;
    ready.forEach(e => {
      const el = card(e);
      list.appendChild(el);
      const meta = el.querySelector(".sp-meta"), body = el.querySelector(".sp-body"), copy = el.querySelector(".sp-copy");
      post("/one", { engine: e.id, prompt: q })
        .then(r => r.json().then(j => ({ ok: r.ok, j })))
        .then(({ ok, j }) => {
          if (mine !== run) return;
          el.classList.remove("is-wait");
          if (ok && j.ok) {
            if (e.kind === "outside") { outside.push({ label: e.name, answer: j.text, confidence: j.confidence }); }
            body.innerHTML = md(j.text);
            meta.textContent = [j.model || j.provider, (j.ms / 1000).toFixed(1) + " s"].filter(Boolean).join(" · ");
            copy.hidden = false;
            copy.onclick = () => navigator.clipboard && navigator.clipboard.writeText(j.text).then(() => { copy.textContent = "Copied"; setTimeout(() => copy.textContent = "Copy", 1200); });
          } else {
            el.classList.add("is-err");
            body.innerHTML = '<p class="sp-off">' + esc((j && (j.text || j.detail)) || "No answer.") + "</p>";
            meta.textContent = "no answer";
          }
        })
        .finally(() => { if (mine === run && e.kind === "outside" && --pending === 0) weigh(q, mine); })
        .catch(() => {
          if (mine !== run) return;
          el.classList.remove("is-wait"); el.classList.add("is-err");
          body.innerHTML = '<p class="sp-off">Could not reach this engine.</p>';
          meta.textContent = "no answer";
        });
    });
    if (off.length) {
      const p = document.createElement("p");
      p.className = "sp-note sp-off";
      p.textContent = "Not asked (no API key on this site yet): " + off.map(e => e.name).join(", ");
      list.appendChild(p);
    }
  }

  // ------------------------------------------------------------ the trigger
  // Bare page: not a control, window, bubble, node, port, wire or the π mark itself.
  const merged = () => document.documentElement.classList.contains("shape-se");
  const SE_BUSY = ".lv-node, .orbit-bubble, .orbit-panel, .orbit-title, .live-dock, .se-port, input, button, a, select, textarea, label, [contenteditable], .wire-hit, .wire-handle, .sp-veil";
  const BUSY = "a, button, input, textarea, select, label, summary, [contenteditable], [role=button], [role=dialog], " +
    ".orbit-bubble, .orbit-pi, .orbit-title, .orbit-panel, .wire-handle, .wire-hit, .orbit-mark, .lv-node, .live-dock, " +
    ".buddy-win, .sp-veil, header, nav, footer, form, table, pre, code, video, img, iframe, " +
    "p, li, h1, h2, h3, h4, h5, h6, dd, dt, td, th, blockquote";
  let down = null;
  document.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; }, true);
  function bare(e) {
    const t = e.target;
    if (!t || !t.closest) return false;
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return false;   // a drag, not a double click
    if (merged()) {
      if (t.closest(SE_BUSY)) return false;
      if (window.LabView && window.LabView.loopAt && window.LabView.loopAt(e.clientX, e.clientY)) return false;   // a loop's ring
      return true;
    }
    // round look: the core button is the mark, and double-clicking it stops π
    if (t.closest(".orbit-core")) return false;
    return !t.closest(BUSY);
  }
  document.addEventListener("dblclick", e => {
    if (e.shiftKey || e.button || e.defaultPrevented || !bare(e)) return;   // Shift + double-click: a node (super/nodes.js)
    e.preventDefault();
    e.stopPropagation();
    open();
  }, true);

  window.SuperPrompt = { open, close };
})();
