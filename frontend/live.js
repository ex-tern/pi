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
    '<div class="live-body"><div class="live-head"><span class="live-dot"></span><b>Live</b>' +
    '<span class="live-updated"></span></div>' +
    '<p class="live-status">…</p><p class="live-counts"></p>' +
    '<h4>Latest papers</h4><ol class="live-list"></ol></div>';

  const pref = () => { try { return JSON.parse(localStorage.getItem("orbit:live:open") || "null"); } catch (_) { return null; } };
  const isOpen = () => dock.classList.contains("open");
  function apply(open) {
    dock.classList.toggle("open", open);
    dock.classList.toggle("docked", open && window.innerWidth >= WIDE);
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
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
  }

  let last = null;
  function render(d) {
    const idle = d.idle || {};
    const status = dock.querySelector(".live-status");
    dock.classList.toggle("working", !!idle.working_now);
    if (!idle.enabled) status.textContent = "Papers are assessed when people submit them.";
    else status.innerHTML = idle.working_now
      ? "<b>Assessing a paper now</b>, found on its own while the site is quiet."
      : "<b>Working while idle.</b> When the site is quiet it finds open-access papers and assesses them.";
    dock.querySelector(".live-counts").textContent =
      d.today.toLocaleString() + " assessed today" +
      (idle.enabled ? " (" + (idle.assessed_today || 0) + " by itself)" : "") +
      " · " + d.total.toLocaleString() + " in total";
    const list = dock.querySelector(".live-list");
    list.innerHTML = (d.latest || []).map(p => p.auto
      ? '<li class="auto"><button type="button" data-hash="' + esc(p.eval_hash) + '">' + esc(p.title || "Untitled") + '</button>' +
        '<span>' + esc(p.field) + ' · piX ' + p.score.toFixed(1) + ' · ' + esc(ago(p.at)) + ' · <em>assessed while idle</em></span></li>'
      : '<li><b>A paper in ' + esc(p.field) + '</b>' +
        '<span>piX ' + p.score.toFixed(1) + ' · ' + esc(p.date) + ' · ' + (p.signed_in ? "by a signed-in researcher" : "anonymous") + '</span></li>'
    ).join("") || '<li class="none">Nothing assessed yet.</li>';
    list.querySelectorAll("button[data-hash]").forEach(b => b.addEventListener("click", () => {
      if (typeof openDossierByHash === "function") openDossierByHash(b.dataset.hash);
    }));
    dock.querySelector(".live-updated").textContent = "updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const n = (d.latest || []).length ? JSON.stringify(d.latest[0]) : "";
    if (last !== null && n !== last) { dock.classList.remove("ping"); void dock.offsetWidth; dock.classList.add("ping"); }
    last = n;
  }

  async function refresh() {
    try {
      const r = await fetch("/api/live");
      if (r.ok) render(await r.json());
    } catch (_) { /* offline: keep what is shown */ }
  }

  function start() {
    document.body.appendChild(dock);
    const p = pref();
    apply(p === null ? window.innerWidth >= WIDE : !!p);
    window.addEventListener("resize", () => apply(isOpen()));
    refresh();
    setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
    document.addEventListener("scholarpi:assessment-done", () => setTimeout(refresh, 1500));
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
