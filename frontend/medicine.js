// medicine.js — the MD pill in the Library bubble.
//
// Shows the public, grade-free graduation plan (medicine/plan.json, rendered
// by medicine/view.js). The source lives in its own repository, Medicine;
// the owner's full plan with grades stays private and is never served here.
(function () {
  "use strict";
  const root = document.createElement("div");
  root.className = "md";
  root.innerHTML = '<p class="md-lede">Loading the plan…</p>';
  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    fetch("medicine/plan.json?v=1").then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(p => { root.innerHTML = window.MedicineView.render(p); })
      .catch(() => { loaded = false; root.innerHTML = '<p class="md-lede">The plan could not be loaded.</p>'; });
  }

  function start() {
    window.PiOrbit.addPill({ key: "lib:Medicine", section: { key: "lib", name: "Library" }, title: "MD", content: root, inGroup: "Library" });
    load();
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
