// peeks.js — a glimpse of what is inside some pills, shown in the pill itself.
//
//   The journal: how many entries, and the latest one.
(function () {
  "use strict";
  async function journal() {
    try {
      const r = await fetch("/api/journal?kind=all&limit=1");
      if (!r.ok) return;
      const d = await r.json();
      const latest = d.entries && d.entries[0] && d.entries[0].title;
      const n = d.count || 0;
      window.PiOrbit.setPeek("The journal", n ? n.toLocaleString() + (n === 1 ? " entry" : " entries") + (latest ? " · latest: " + latest : "") : "No entries yet");
    } catch (_) { /* offline: the pill just shows its name */ }
  }
  function start() {
    journal();
    setInterval(journal, 5 * 60 * 1000);
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
