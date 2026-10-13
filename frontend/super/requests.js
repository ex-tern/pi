// super/requests.js: server request indicators (owner, 2026-10-13: "create server request indicators"; "how can we
// build trust that users' data and AI is not abused").
//
// Every request this page makes is shown, as it happens, in a small indicator in the bottom-left corner: a light that
// is on while a request is out, and what went where. Hover or focus it to see the list:
//   what was asked for     the path only (never the query's values or the body)
//   what kind it was       read: the page fetched something / sent: your data was stored on our server /
//                          AI: text went to an AI model, ours (siM, riB, piD, PiEn) or an outside provider, named
//   how much was sent      bytes, so a visitor can see nothing large leaves quietly
//   other sites            hosts other than ours the page loaded from (the code libraries on cdnjs, the fonts)
// The list is kept in this tab's memory only. It is never sent anywhere, and it is cleared when the tab closes.
// It wraps fetch, XMLHttpRequest and sendBeacon at the very start of <head>, so nothing the page sends goes unseen.
(function () {
  "use strict";
  if (window.SeRequests) return;
  const MAX = 200, log = [], hosts = new Map();
  let inflight = 0, el = null, card = null;
  const OURS = location.host;
  // the AI routes (backend/routes): text sent to them reaches a model
  const AI = [
    [/^\/api\/super\/(one|ask|panel|weigh|engines)?/, "Super AI engines"],
    [/^\/api\/assess(\/|$)/, "the assessment pipeline (several AI models)"],
    [/^\/api\/scilem\/chat/, "SciM, our assistant"],
    [/^\/api\/buddy\/suggest/, "RiBD, our research mentor"],
    [/^\/api\/assessments\/[^/]+\/review\/llm/, "an AI reviewer"],
    [/^\/api\/pien\/learn/, "PiEn, our shared model (it learns from it)"],
  ];
  const OUTSIDE = ["llama", "mistral", "qwen", "gemini", "deepseek"];   // outside providers (backend/providers.py)
  const OWN = { sim: "siM", rib: "riB", pid: "piD", pien: "PiEn" };

  function classify(method, url, body) {
    let u; try { u = new URL(url, location.href); } catch (_) { return null; }
    const path = u.pathname, ours = u.host === OURS;
    const size = typeof body === "string" ? new Blob([body]).size : body && body.size ? body.size : body && body.byteLength ? body.byteLength : body instanceof FormData ? -1 : 0;
    const e = { t: Date.now(), method: (method || "GET").toUpperCase(), host: u.host, path, ours, sent: size, kind: "read", to: "" };
    if (!ours) { e.kind = "other"; e.to = u.host; return e; }
    const writes = e.method !== "GET" && e.method !== "HEAD";
    const ai = writes && AI.find(([re]) => re.test(path));                // reading a status or a list is a read, not a call to AI
    if (ai) {
      e.kind = "ai"; e.to = ai[1];
      // which engine: read from the request on this page only (it is what the page is about to send anyway)
      try { const j = typeof body === "string" ? JSON.parse(body) : null; const g = j && (j.engine || j.model); if (g) { const k = String(g).toLowerCase(); e.to = OUTSIDE.includes(k) ? g + " (an outside AI provider)" : (OWN[k] || g) + " (our own model)"; } } catch (_) { /* not JSON */ }
    } else if (writes) { e.kind = "sent"; e.to = "our server"; }
    return e;
  }
  function begin(e) { if (!e) return null; inflight++; log.unshift(e); if (log.length > MAX) log.length = MAX; paint(); return e; }
  function done(e, status) { if (!e) return; inflight = Math.max(0, inflight - 1); e.status = status; e.ms = Date.now() - e.t; paint(); }

  // ---- the wrappers --------------------------------------------------------------------------------
  const F = window.fetch;
  if (F) window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url, method = (init && init.method) || (input && input.method) || "GET";
    const e = begin(classify(method, url, init && init.body));
    return F.apply(this, arguments).then(r => { done(e, r.status); return r; }, err => { done(e, "failed"); throw err; });
  };
  const X = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (X) {
    const open = X.open, send = X.send;
    X.open = function (m, u) { this._seReq = [m, u]; return open.apply(this, arguments); };
    X.send = function (body) {
      const e = this._seReq ? begin(classify(this._seReq[0], this._seReq[1], body)) : null;
      if (e) this.addEventListener("loadend", () => done(e, this.status || "failed"), { once: true });
      return send.apply(this, arguments);
    };
  }
  if (navigator.sendBeacon) { const B = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (u, d) => { const e = begin(classify("POST", u, d)); const ok = B(u, d); done(e, ok ? "queued" : "failed"); return ok; }; }
  // what the page loaded from other sites (scripts, styles, fonts): from the browser's own record
  function others() {
    try { performance.getEntriesByType("resource").forEach(r => { const h = new URL(r.name).host; if (h && h !== OURS) hosts.set(h, (hosts.get(h) || 0) + 1); }); } catch (_) { /* fine */ }
  }

  // ---- the indicator -------------------------------------------------------------------------------
  const KIND = { read: "read", sent: "sent your data", ai: "to AI", other: "other site" };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const kb = n => n < 0 ? "a file" : n < 1024 ? n + " B" : (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
  const hhmmss = t => new Date(t).toTimeString().slice(0, 8);
  function build() {
    if (el || !document.body) return;
    el = document.createElement("div"); el.className = "se-req"; el.tabIndex = 0; el.setAttribute("role", "status");
    el.innerHTML = '<span class="se-req-light" aria-hidden="true"></span><span class="se-req-sum"></span>';
    card = document.createElement("div"); card.className = "se-req-card"; card.setAttribute("role", "log"); card.setAttribute("aria-label", "Requests this page made");
    el.appendChild(card);
    // the page's own gestures (zoom, wiring, making supers) leave it alone
    ["pointerdown", "dblclick", "wheel", "click", "contextmenu"].forEach(t => el.addEventListener(t, e => e.stopPropagation(), { passive: t !== "click" && t !== "dblclick" && t !== "contextmenu" }));
    el.addEventListener("mouseenter", () => { others(); paint(true); });
    el.addEventListener("focus", () => { others(); paint(true); });
    document.body.appendChild(el);
    paint();
  }
  let painted = 0, pend = 0;
  function paint(full) {
    if (!el) return;
    const now = performance.now();
    if (!full && now - painted < 120) { clearTimeout(pend); pend = setTimeout(() => paint(), 130); return; }
    painted = now;
    const n = log.filter(e => e.ours).length, ai = log.filter(e => e.kind === "ai").length, sent = log.filter(e => e.kind === "sent").length;
    el.classList.toggle("is-busy", inflight > 0);
    el.classList.toggle("has-ai", log.some(e => e.kind === "ai" && Date.now() - e.t < 4000));
    el.querySelector(".se-req-sum").textContent = n + " request" + (n === 1 ? "" : "s") + (ai ? " · " + ai + " to AI" : "") + (sent ? " · " + sent + " saved" : "");
    el.setAttribute("aria-label", n + " requests to our server, " + ai + " to AI models, " + sent + " saving your data" + (inflight ? ", " + inflight + " in progress" : ""));
    if (!full && !el.matches(":hover, :focus, :focus-within")) return;
    const rows = log.filter(e => e.ours).slice(0, 40).map(e =>
      '<li class="k-' + e.kind + '"><span class="t">' + hhmmss(e.t) + '</span><span class="k">' + KIND[e.kind] + '</span><span class="p">' + esc(e.method + " " + e.path) +
      (e.to && e.kind !== "read" ? '<em>' + esc(e.kind === "ai" ? "→ " + e.to : e.to) + '</em>' : "") + '</span><span class="s">' + (e.sent ? kb(e.sent) : "") + (e.status != null ? " · " + esc(e.status) : " · …") + (e.ms != null ? " · " + e.ms + " ms" : "") + "</span></li>").join("");
    const ext = [...hosts.keys()];
    card.innerHTML = '<p class="h">What this page sent, and where</p>' +
      '<p class="n">Shown here only: this list stays in your browser and is never sent anywhere. Paths only, never what you typed.</p>' +
      '<ul>' + (rows || '<li class="none">Nothing yet.</li>') + '</ul>' +
      '<p class="n">' + (ext.length ? "Also loaded from: " + ext.map(esc).join(", ") + " (code libraries and fonts; nothing of yours is sent to them)." : "No other sites contacted.") + "</p>";
  }
  // clear of the conditions bar (super/controls.js): on a narrow screen it sits just above it
  function seat() {
    if (!el) return;
    const bar = document.querySelector(".se-ctl-bottom:not([hidden])"), B = 12;
    let bottom = B;
    if (bar) {                                                           // the bar is an anchor: its buttons are its extent
      const rs = [...bar.querySelectorAll(".se-cond, .se-ctl")].map(x => x.getBoundingClientRect()).filter(r => r.width);
      if (rs.length) {
        const r = { left: Math.min(...rs.map(x => x.left)), top: Math.min(...rs.map(x => x.top)), bottom: Math.max(...rs.map(x => x.bottom)) }, w = el.offsetWidth;
        if (r.left < B + w + 8 && r.bottom > window.innerHeight - B - el.offsetHeight - 8) bottom = Math.max(B, Math.round(window.innerHeight - r.top + 8));
      }
    }
    const v = bottom + "px"; if (el.style.bottom !== v) el.style.bottom = v;
  }
  setInterval(seat, 500); window.addEventListener("resize", seat);
  if (document.body) build(); else document.addEventListener("DOMContentLoaded", build);
  window.SeRequests = { log: () => log.slice(), inflight: () => inflight, classify };
})();
