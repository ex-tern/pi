// recent.js — "Recent assessments": every assessment on the site, including
// ones made without signing in, so visitors can see it being used. Field, piX
// score and day only: people upload unpublished work, so nothing that could
// identify a paper or a person is shown (see backend/recent.py).
(function () {
  "use strict";
  const content = document.createElement("div");
  content.className = "recent";
  const when = d => {
    if (!d) return "";
    const today = new Date().toISOString().slice(0, 10);
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    return d === today ? "today" : d === y ? "yesterday" : d;
  };
  async function load() {
    let data;
    try {
      const r = await fetch("/api/assessments/recent?limit=30");
      if (!r.ok) return;
      data = await r.json();
    } catch (_) { return; }
    const list = data.entries || [];
    content.innerHTML = '<p class="recent-lede">Every assessment made on Pi Tech Lab, newest first, signed in or not. ' +
      'Only the field, the score and the day are shown: never the title, the file or who.</p>';
    if (!list.length) {
      content.insertAdjacentHTML("beforeend", '<p class="recent-empty">No assessments yet. Be the first: open Tools, then Assess a Manuscript.</p>');
    } else {
      const ol = document.createElement("ol");
      ol.className = "recent-list";
      list.forEach(e => {
        const li = document.createElement("li");
        li.innerHTML = '<span class="rc-field"></span><span class="rc-bar"><i></i></span><b class="rc-score"></b><span class="rc-meta"></span>';
        li.querySelector(".rc-field").textContent = e.field;
        li.querySelector(".rc-bar i").style.width = Math.max(2, Math.min(100, e.score)) + "%";
        li.querySelector(".rc-score").textContent = e.score.toFixed(1);
        li.querySelector(".rc-meta").textContent = when(e.date) + " · " + (e.signed_in ? "signed in" : "anonymous");
        ol.appendChild(li);
      });
      content.appendChild(ol);
      content.insertAdjacentHTML("beforeend", '<p class="recent-total">' + (data.total || 0).toLocaleString() + " assessed in all</p>");
    }
    const latest = list[0];
    window.PiOrbit.setPeek("Recent assessments", latest ? latest.field + " · " + latest.score.toFixed(1) + " · " + when(latest.date) : "None yet");
  }
  function start() {
    window.PiOrbit.addPill({ key: "journal:Recent assessments", section: { key: "journal", name: "Explore" }, title: "Recent assessments", content });
    load();
    setInterval(load, 60000);
    document.addEventListener("scholarpi:assessment-done", () => setTimeout(load, 1500));
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
