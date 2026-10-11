// live.js — the Live panel, fixed to the right-hand side of the page.
//
// What the site is doing right now: whether it is assessing papers by itself
// while idle (idle_worker.py), how many papers were assessed today, and the
// latest assessments as they arrive. Papers the site assessed on its own are
// open-access and named; other people's uploads show only field, piX and day
// (backend/live.py). Refreshes every 30 s and after your own assessment.
//
// On a wide screen it is docked and the orbit layout makes room for it
// (orbit.js reads its width). It folds to a slim tab with the arrow, and on
// narrow screens it starts folded and opens over the page.
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const WIDE = 1100;
  const dock = document.createElement("aside");
  dock.className = "live-dock";
  dock.setAttribute("aria-label", "Live: what Pi Tech Lab is doing now");
  dock.innerHTML =
    '<button type="button" class="live-tab" aria-expanded="false"><span class="live-dot"></span><span class="live-tab-text">Live</span></button>' +
    '<div class="live-body"><div class="live-scroll"><div class="live-head"><span class="live-dot"></span><b>Live</b>' +
    '<span class="live-updated"></span></div>' +
    '<p class="live-status">…</p><p class="live-counts"></p>' +
    '<h4>Latest papers</h4><ol class="live-list"></ol></div></div>';

  const body = dock.querySelector(".live-body");               // the panel's content (a window's, in the superellipse look)
  const pref = () => { try { return JSON.parse(localStorage.getItem("orbit:live:open") || "null"); } catch (_) { return null; } };
  const isOpen = () => dock.classList.contains("open");
  function apply(open) {
    dock.classList.toggle("open", open);
    // docked, the page makes room for it; in the superellipse look it sits inside the inner super instead
    dock.classList.toggle("docked", open && window.innerWidth >= WIDE && !document.documentElement.classList.contains("shape-se"));
    dock.querySelector(".live-tab").setAttribute("aria-expanded", String(open));
    if (window.PiOrbit && window.PiOrbit.layout) window.PiOrbit.layout();
  }
  function setOpen(open) {
    if (window.PiOrbit) window.PiOrbit.store("orbit:live:open", open);
    apply(open);
  }
  dock.querySelector(".live-tab").addEventListener("click", () => setOpen(!isOpen()));

  function ago(ts) {
    const t = Date.parse(String(ts).replace(" ", "T") + (/[zZ+]/.test(ts) ? "" : "Z"));
    if (!t) return "";
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    // written in SuperAI (pitechlab.super.js: functions.ago), run by the Rust engine; the same in JavaScript until it loads
    const s = window.SuperAI && window.SuperAI.call ? window.SuperAI.call("ago", { m }) : null;
    if (s) return s;
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
  }

  let last = null, data = null;
  // the panel as a value, for a wire from it (super/nodes.js): how many assessed today, whether it works now
  function value() {
    const d = data || {}, idle = d.idle || {};
    const open = asWindow ? winOpen() : isOpen();
    const t = d.today == null ? (open ? "Live" : "Live, folded") : d.today + " assessed today" + (idle.working_now ? ", assessing now" : "");
    return { num: d.today || 0, isNum: d.today != null, bool: !!idle.working_now || open, str: t, text: t };
  }
  const winOpen = () => { const i = window.PiOrbit && window.PiOrbit.info && window.PiOrbit.info("live:Live"); return !!(i && i.open); };
  window.PiLive = {
    open: () => { if (asWindow) { if (window.PiOrbit.openKey) window.PiOrbit.openKey("live:Live"); } else setOpen(true); },
    close: () => { if (asWindow) { if (window.PiOrbit.close) window.PiOrbit.close("live:Live"); } else setOpen(false); },
    isOpen: () => (asWindow ? winOpen() : isOpen()), value };
  function render(d) {
    data = d;
    const idle = d.idle || {};
    const status = body.querySelector(".live-status");
    body.classList.toggle("working", !!idle.working_now); dock.classList.toggle("working", !!idle.working_now);
    // Live is written in SuperAI (pitechlab.super.js: live, and the functions liveStatus, liveCounts and ago),
    // run by the Rust engine; the same lines in JavaScript until it has loaded
    const S = window.SuperAI, L = (S && S.program && S.program.live) || {};
    const said = S && S.call ? S.call(L.status || "liveStatus", { enabled: !!idle.enabled, working: !!idle.working_now }) : null;
    if (said) {
      const m = /^([^.,]*[.,])(.*)$/.exec(said);                     // its first phrase in bold, as before
      status.innerHTML = idle.enabled && m ? "<b>" + esc(m[1].replace(/,$/, "")) + "</b>" + (m[1].endsWith(",") ? "," : "") + esc(m[2]) : esc(said);
    } else if (!idle.enabled) status.textContent = "Papers are assessed when people submit them.";
    else status.innerHTML = idle.working_now
      ? "<b>Assessing a paper now</b>, found on its own while the site is quiet."
      : "<b>Working while idle.</b> When the site is quiet it finds open-access papers and assesses them.";
    const counts = S && S.call ? S.call(L.counts || "liveCounts", { today: d.today || 0, byself: idle.assessed_today || 0, total: d.total || 0, enabled: !!idle.enabled }) : null;
    body.querySelector(".live-counts").textContent = counts ||
      (d.today.toLocaleString() + " assessed today" +
      (idle.enabled ? " (" + (idle.assessed_today || 0) + " by itself)" : "") +
      " · " + d.total.toLocaleString() + " in total");
    const list = body.querySelector(".live-list");
    list.innerHTML = (d.latest || []).map(p => p.auto
      ? '<li class="auto"><button type="button" data-hash="' + esc(p.eval_hash) + '">' + esc(p.title || "Untitled") + '</button>' +
        '<span>' + esc(p.field) + ' · piX ' + (+p.score || 0).toFixed(1) + ' · ' + esc(ago(p.at)) + ' · <em>assessed while idle</em></span></li>'
      : '<li><b>A paper in ' + esc(p.field) + '</b>' +
        '<span>piX ' + (+p.score || 0).toFixed(1) + ' · ' + esc(p.date) + ' · ' + (p.signed_in ? "by a signed-in researcher" : "anonymous") + '</span></li>'
    ).join("") || '<li class="none">Nothing assessed yet.</li>';
    list.querySelectorAll("button[data-hash]").forEach(b => b.addEventListener("click", () => {
      if (typeof openDossierByHash === "function") openDossierByHash(b.dataset.hash);
    }));
    body.querySelector(".live-updated").textContent = "updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const n = (d.latest || []).length ? JSON.stringify(d.latest[0]) : "";
    if (last !== null && n !== last) { body.classList.remove("ping"); void dock.offsetWidth; body.classList.add("ping"); }
    last = n;
  }

  async function refresh() {
    try {
      const L = (window.SuperAI && window.SuperAI.program && window.SuperAI.program.live) || {};
      const r = await fetch(L.source || "/api/live");
      if (r.ok) render(await r.json());
    } catch (_) { /* offline: keep what is shown */ }
  }

  // the superellipse look: Live is a window in the Explore bubble (owner, 2026-10-12), a pill like the others
  // (pitechlab.super.js bubbles: Explore holds "Live"); its body is the window's content, and PiLive.open /
  // close open and close that window. The round look keeps the panel at the side.
  const se = () => document.documentElement.classList.contains("shape-se");
  let asWindow = false;
  function start() {
    if (se() && window.PiOrbit && window.PiOrbit.addPill) {
      asWindow = true;
      const content = document.createElement("div");
      content.className = "live-window";
      content.appendChild(dock.querySelector(".live-body"));
      dock.remove();
      window.PiOrbit.addPill({ key: "live:Live", section: { key: "live", name: "Live" }, title: "Live", content });
      refresh();
      document.addEventListener("superai:ready", () => { if (data) render(data); });
      const every = ((window.SuperAI && window.SuperAI.program && window.SuperAI.program.live) || {}).every || 30;
      setInterval(() => { if (document.visibilityState === "visible") refresh(); }, Math.max(5, every) * 1000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
      document.addEventListener("scholarpi:assessment-done", () => setTimeout(refresh, 1500));
      return;
    }
    document.body.appendChild(dock);
    const p = pref();
    apply(p === null ? (window.innerWidth >= WIDE && !se()) : !!p);
    window.addEventListener("resize", () => apply(isOpen()));
    refresh();
    document.addEventListener("superai:ready", () => { if (data) render(data); });   // the lines again, now from SuperAI
    const every = ((window.SuperAI && window.SuperAI.program && window.SuperAI.program.live) || {}).every || 30;
    setInterval(() => { if (document.visibilityState === "visible") refresh(); }, Math.max(5, every) * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
    document.addEventListener("scholarpi:assessment-done", () => setTimeout(refresh, 1500));
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
