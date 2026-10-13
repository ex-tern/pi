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
// Shown to the owner only (owner, 2026-10-13: "this is shown in the owner page only"): it is drawn once
// /api/auth/session says the signed-in visitor is the owner, and checked again every 30 s; every request is recorded
// from the start either way, so the list is whole when it appears.
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
  // what the visitor declined (super/consent.js) is never sent: it is listed as declined
  function declined(method, url, body) {
    const C = window.SeConsent; if (!C || !C.allows) return null;
    const a = C.allows(method, url, body); if (a.ok) return null;
    const e = classify(method, url, body); if (!e) return null;
    e.kind = "blocked"; e.to = a.why; e.status = "not sent"; e.ms = 0; log.unshift(e); if (log.length > MAX) log.length = MAX; paint();
    return e;
  }
  function begin(e) { if (!e) return null; inflight++; log.unshift(e); if (log.length > MAX) log.length = MAX; paint(); return e; }
  function done(e, status) { if (!e) return; inflight = Math.max(0, inflight - 1); e.status = status; e.ms = Date.now() - e.t; paint(); }

  // ---- the wrappers --------------------------------------------------------------------------------
  const F = window.fetch;
  if (F) window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url, method = (init && init.method) || (input && input.method) || "GET";
    if (declined(method, url, init && init.body)) return Promise.resolve(new Response(JSON.stringify({ declined: true }), { status: 403, headers: { "Content-Type": "application/json" } }));
    const e = begin(classify(method, url, init && init.body));
    return F.apply(this, arguments).then(r => { done(e, r.status); return r; }, err => { done(e, "failed"); throw err; });
  };
  const X = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (X) {
    const open = X.open, send = X.send;
    X.open = function (m, u) { this._seReq = [m, u]; return open.apply(this, arguments); };
    X.send = function (body) {
      if (this._seReq && declined(this._seReq[0], this._seReq[1], body)) { try { this.abort(); } catch (_) { /* fine */ } return; }
      const e = this._seReq ? begin(classify(this._seReq[0], this._seReq[1], body)) : null;
      if (e) this.addEventListener("loadend", () => done(e, this.status || "failed"), { once: true });
      return send.apply(this, arguments);
    };
  }
  if (navigator.sendBeacon) { const B = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (u, d) => { if (declined("POST", u, d)) return true; const e = begin(classify("POST", u, d)); const ok = B(u, d); done(e, ok ? "queued" : "failed"); return ok; }; }
  // what the page loaded from other sites (scripts, styles, fonts): from the browser's own record
  function others() {
    try { performance.getEntriesByType("resource").forEach(r => { const h = new URL(r.name).host; if (h && h !== OURS) hosts.set(h, (hosts.get(h) || 0) + 1); }); } catch (_) { /* fine */ }
  }

  // ---- the indicator -------------------------------------------------------------------------------
  const KIND = { read: "read", sent: "sent your data", ai: "to AI", other: "other site", blocked: "declined" };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const kb = n => n < 0 ? "a file" : n < 1024 ? n + " B" : (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
  const hhmmss = t => new Date(t).toTimeString().slice(0, 8);
  function build() {
    if (el || !document.body) return;
    el = document.createElement("div"); el.className = "se-req"; el.tabIndex = 0; el.setAttribute("role", "status"); el.hidden = true;   // until the owner is known
    el.innerHTML = '<span class="se-req-light" aria-hidden="true"></span><span class="se-req-sum"></span>';
    card = document.createElement("div"); card.className = "se-req-card"; card.setAttribute("role", "log"); card.setAttribute("aria-label", "Requests this page made");
    el.appendChild(card);
    // the page's own gestures (zoom, wiring, making supers) leave it alone
    ["pointerdown", "dblclick", "wheel", "click", "contextmenu"].forEach(t => el.addEventListener(t, e => e.stopPropagation(), { passive: t !== "click" && t !== "dblclick" && t !== "contextmenu" }));
    // a click opens the choices, a moment later so that a double click (delete, super/delete.js) does not (its second click
    // is the double click's, e.detail > 1); a drag moves it
    let clickT = 0;
    // like the other supers (owner, 2026-10-13: "privacy choices doesn't act as others"): a click selects it (super/select.js);
    // a click on it once selected opens the choices
    let wasSel = false;
    window.addEventListener("pointerdown", e => { if (el && el.contains(e.target)) wasSel = !!(window.SeSelect && window.SeSelect.isSelected(el)); }, true);
    el.addEventListener("click", e => { if (dragged) { dragged = false; return; } if (e.target.closest(".se-req-card")) return; clearTimeout(clickT); if (e.detail > 1 || !wasSel) return; clickT = setTimeout(() => { if (!owner && window.SeConsent && el.isConnected && !el.hidden) window.SeConsent.open(); }, 260); });
    el.addEventListener("dblclick", () => clearTimeout(clickT), true);
    el.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest(".se-req-card, button")) return;
      if (window.SeLock && (window.SeLock.pinned ? window.SeLock.pinned(el) : window.SeLock.isLocked(el))) return;   // locked, or in a locked super: it keeps its place
      const r = el.getBoundingClientRect(); drag = { x0: e.clientX, y0: e.clientY, l: r.left, t: r.top, on: false, id: e.pointerId };
    });
    window.addEventListener("pointermove", e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.on && Math.hypot(dx, dy) < 6) return;
      drag.on = true; el.classList.add("is-dragging");
      el.style.left = Math.round(drag.l + dx) + "px"; el.style.top = Math.round(drag.t + dy) + "px";
    }, true);
    window.addEventListener("pointerup", e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null; el.classList.remove("is-dragging");
      if (!d.on) return;
      dragged = true;
      keepAt();                                                          // where it was dropped, in shares of the second super
    }, true);
    el.addEventListener("keydown", e => { if (!owner && window.SeConsent && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); window.SeConsent.open(); } });
    el.addEventListener("mouseenter", () => { others(); paint(true); });
    el.addEventListener("focus", () => { others(); paint(true); });
    document.body.appendChild(el);
    paint();
  }
  let painted = 0, pend = 0;
  function paint(full) {
    if (!el) return;
    const now = performance.now();
    if (!owner) {                                                          // everyone else: the way back to their choices
      const t = "Privacy choices"; const sm = el.querySelector(".se-req-sum"); if (sm.textContent !== t) sm.textContent = t;
      el.setAttribute("aria-label", "Privacy choices: what this site does with you"); el.setAttribute("role", "button"); el.classList.remove("is-busy", "has-ai"); return;
    }
    el.setAttribute("role", "status");
    if (!full && now - painted < 120) { clearTimeout(pend); pend = setTimeout(() => paint(), 130); return; }
    painted = now;
    const n = log.filter(e => e.ours && e.kind !== "blocked").length, ai = log.filter(e => e.kind === "ai").length, sent = log.filter(e => e.kind === "sent").length, no = log.filter(e => e.kind === "blocked").length;
    el.classList.toggle("is-busy", inflight > 0);
    el.classList.toggle("has-ai", log.some(e => e.kind === "ai" && Date.now() - e.t < 4000));
    el.querySelector(".se-req-sum").textContent = n + " request" + (n === 1 ? "" : "s") + (ai ? " · " + ai + " to AI" : "") + (sent ? " · " + sent + " saved" : "") + (no ? " · " + no + " declined" : "");
    el.setAttribute("aria-label", n + " requests to our server, " + ai + " to AI models, " + sent + " saving your data" + (inflight ? ", " + inflight + " in progress" : ""));
    if (!full && !el.matches(":hover, :focus, :focus-within")) return;
    const rows = log.filter(e => e.ours).slice(0, 40).map(e =>
      '<li class="k-' + e.kind + '"><span class="t">' + hhmmss(e.t) + '</span><span class="k">' + KIND[e.kind] + '</span><span class="p">' + esc(e.method + " " + e.path) +
      (e.to && e.kind !== "read" ? '<em>' + esc(e.kind === "ai" ? "→ " + e.to : e.kind === "blocked" ? "not sent: " + e.to : e.to) + '</em>' : "") + '</span><span class="s">' + (e.sent ? kb(e.sent) : "") + (e.status != null ? " · " + esc(e.status) : " · …") + (e.ms != null ? " · " + e.ms + " ms" : "") + "</span></li>").join("");
    const ext = [...hosts.keys()];
    let body = card.querySelector(".se-req-body");
    if (!body) {                                                          // the list redraws; the button stays (a click on it lands)
      card.innerHTML = '<div class="se-req-body"></div>' + (window.SeConsent ? '<button type="button" class="se-req-choices">Your privacy choices</button>' : "");
      body = card.querySelector(".se-req-body");
      const ch = card.querySelector(".se-req-choices"); if (ch) ch.addEventListener("click", () => { el.blur(); window.SeConsent.open(); });
    }
    body.innerHTML = '<p class="h">What this page sent, and where</p>' +
      '<p class="n">Shown here only: this list stays in your browser and is never sent anywhere. Paths only, never what you typed.</p>' +
      '<ul>' + (rows || '<li class="none">Nothing yet.</li>') + '</ul>' +
      '<p class="n">' + (ext.length ? "Also loaded from: " + ext.map(esc).join(", ") + " (code libraries and fonts; nothing of yours is sent to them)." : "No other sites contacted.") + "</p>";
  }
  // a super inside the second super, as the others are (owner, 2026-10-13: "put privacy choices in there and same it should
  // act as other supers"): its place is kept in shares of the second super's box, as the start places the bubbles
  // (super/pack.js START), so it follows that super's moves and the page's zoom; at the start it sits just right of Connect.
  // Dragged, the new share is kept (se:at:privacy); deleted, it is gone until the app is reset.
  const START_AT = { x: 0.155, y: 0.855 };                                 // its left edge and its middle, in shares of the box
  let at = null, gone = false;
  try { at = JSON.parse(localStorage.getItem("se:at:privacy") || "null"); gone = localStorage.getItem("se:gone:privacy") === "1"; } catch (_) { at = null; }
  try { localStorage.removeItem("se:move:privacy"); } catch (_) { /* the old offset from the corner: no longer used */ }
  // layout to screen and back: the second super's box (PiOrbit.siteBox) under the page's zoom (PiOrbit.fit)
  function frame() {
    const O = window.PiOrbit, sb = O && O.siteBox && O.siteBox(), F = O && O.fit && O.fit();
    if (!sb || !sb.a || !F) return null;
    const f = F.f || 1, W2 = 2 * sb.a, H2 = 2 * sb.b;
    return {
      to: (x, y) => [F.px + (sb.cx - sb.a + x * W2 - F.px) * f, F.py + (sb.cy - sb.b + y * H2 - F.py) * f],
      from: (l, t) => [((F.px + (l - F.px) / f) - (sb.cx - sb.a)) / W2, ((F.py + (t - F.py) / f) - (sb.cy - sb.b)) / H2],
    };
  }
  function seat() {
    if (!el || el.hidden || drag) return;                                 // it follows the pointer while dragged
    const fr = frame(), h = el.offsetHeight;
    let left = 12, top = window.innerHeight - 12 - h;
    if (fr && at) { const p = fr.to(at.x, at.y); left = p[0]; top = p[1] - h / 2; }
    else if (fr && window.innerWidth < 700) {                             // a phone: in the free space right of the project, clear of the arrows
      const pj = document.querySelector(".se-project"), pr = pj && pj.getBoundingClientRect();
      const p = fr.to(0.75, 0.81), cy = pr && pr.height ? pr.top + pr.height / 2 : p[1];
      left = Math.min(window.innerWidth - 8 - el.offsetWidth, Math.max(pr && pr.width ? pr.right + 12 : 0, p[0] - el.offsetWidth / 2)); top = cy - h / 2;
    }
    else if (fr) { const p = fr.to(START_AT.x, START_AT.y); left = p[0]; top = p[1] - h / 2; }
    const L = Math.round(left) + "px", T = Math.round(top) + "px";
    if (el.style.left !== L) el.style.left = L; if (el.style.top !== T) el.style.top = T; if (el.style.bottom !== "auto") el.style.bottom = "auto";
  }
  function keepAt() {
    const fr = frame(); if (!fr || !el) return;
    const r = el.getBoundingClientRect(), s = fr.from(r.left, r.top + r.height / 2);
    at = { x: +s[0].toFixed(4), y: +s[1].toFixed(4) };
    try { localStorage.setItem("se:at:privacy", JSON.stringify(at)); } catch (_) { /* private mode */ }
  }
  // every frame while the page moves (a zoom, the second super dragged), so it moves with them, not after them
  (function follow() { seat(); requestAnimationFrame(follow); })();
  window.addEventListener("resize", seat);
  // the owner only: asked of the server, with the page's own cookie (the check itself is listed like any request)
  let owner = false, drag = null, dragged = false;
  async function whoIs() {
    try { const j = await (await window.fetch("/api/auth/session", { cache: "no-store" })).json(); owner = !!(j && j.is_owner === true); } catch (_) { owner = false; }
    // the owner sees the indicator; everyone else only a way back to their privacy choices (super/consent.js)
    if (el) {
      el.hidden = gone || (!owner && !window.SeConsent); el.classList.toggle("is-min", !owner);
      if (owner) delete el.dataset.ctl; else el.dataset.ctl = "privacy";   // a super with four ports, wireable like the controls
      seat(); paint();
    }
  }
  function boot() { build(); whoIs(); setInterval(whoIs, 30000); }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);
  function remove() { gone = true; if (el) el.hidden = true; try { localStorage.setItem("se:gone:privacy", "1"); } catch (_) { /* private mode */ } }
  window.SeRequests = { log: () => log.slice(), inflight: () => inflight, classify, isOwner: () => owner, refresh: whoIs, remove };
})();
