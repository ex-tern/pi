// welcome.js — the arrival screen.
//
// Shown once per browser session, over the app, never instead of it: the app
// underneath has already loaded and every choice here only clicks one of its
// existing tabs. Skipped entirely for deep links (/#lab and friends), so a
// shared link still lands where it points. The brand mark reopens it.
(function () {
  "use strict";
  const KEY = "sp_welcomed";
  // One door per thing people come here to do. Icons are simple line drawings
  // so they stay legible small and in the site's ink.
  const ICONS = {
    assess: '<path d="M7 4h7l4 4v12H7z"/><path d="M14 4v4h4"/><path d="M9.5 14l2 2 3.5-4"/>',
    research: '<circle cx="11" cy="11" r="5.5"/><path d="M15 15l4.5 4.5"/>',
    map: '<circle cx="7" cy="16" r="2.2"/><circle cx="16.5" cy="7.5" r="2.2"/><circle cx="17" cy="17" r="1.6"/><path d="M8.8 14.6l6-5.6M9.2 16.3l6.2.6"/>',
    lab: '<path d="M10 4h4M10.5 4v5.2L5.6 18a1.6 1.6 0 0 0 1.4 2.4h10a1.6 1.6 0 0 0 1.4-2.4L13.5 9.2V4"/><path d="M8 14.5h8"/>',
  };
  const CHOICES = [
    { tab: "assess", icon: "assess", title: "Assess and improve a paper",
      text: "Upload a manuscript or a DOI. You get a fair, criteria-based assessment and the first things to fix." },
    { tab: "journal", icon: "research", title: "Research the corpus",
      text: "Browse reviewed papers, leaderboards and the open research ledger." },
    { tab: "analytics", icon: "map", title: "Explore the map of science",
      text: "See how fields connect and where the assessed work sits." },
    { tab: "lab", icon: "lab", title: "Experiment and test in the Lab",
      text: "Run live experiments in your browser, from a self-teaching neural machine to quantum circuits." },
  ];
  // The instrument: a ruled ring, the circle, and its diameter, which turns
  // with the cobalt point riding its end. Drawn once, then it keeps turning.
  const MARK =
    '<g class="wi-ticks"></g>' +
    '<circle class="wi-ring" cx="200" cy="200" r="186"/>' +
    '<circle class="wi-circle" cx="200" cy="200" r="150" pathLength="1000"/>' +
    '<g class="wi-orbit"><line class="wi-diameter" x1="50" y1="200" x2="350" y2="200" pathLength="1000"/>' +
    '<circle class="wi-halo" cx="350" cy="200" r="16"/><circle class="wi-point" cx="350" cy="200" r="8"/></g>';

  function seen() { try { return sessionStorage.getItem(KEY) === "1"; } catch (_) { return false; } }
  function remember() { try { sessionStorage.setItem(KEY, "1"); } catch (_) { /* private mode: shows again, harmless */ } }

  let root = null, lastFocus = null;

  function build() {
    root = document.createElement("div");
    root.className = "welcome";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "welcomeTitle");
    root.innerHTML = `
      <div class="welcome-inner">
        <div class="welcome-hero">
          <svg class="welcome-mark" viewBox="0 0 400 400" aria-hidden="true">${MARK}</svg>
          <h1 id="welcomeTitle" class="welcome-title">Welcome to PiTechLab</h1>
          <p class="welcome-sub">A research lab you can use from your browser. Assess papers fairly, research what has been reviewed,
          run experiments, and help ideas get better.</p>
          <button class="welcome-begin" type="button" data-tab="assess">Let's begin</button>
        </div>
        <ul class="welcome-choices">
          ${CHOICES.map(c => `<li><button type="button" data-tab="${c.tab}">
            <svg class="wc-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[c.icon]}</svg>
            <span class="wc-title">${c.title}</span><span class="wc-text">${c.text}</span></button></li>`).join("")}
        </ul>
        <p class="welcome-new"><span class="wn-dot" aria-hidden="true"></span>This site improves a little every night, and every change is tested first.
          <a class="wn-link" href="https://github.com/ex-tern/pi/blob/main/EVOLUTION.md" target="_blank" rel="noopener">See what's new</a></p>
        <button class="welcome-skip" type="button" data-skip="1">Skip to the site</button>
      </div>`;
    root.addEventListener("click", e => {
      const b = e.target.closest("button[data-tab], button[data-skip]");
      if (b) go(b.dataset.tab || null);
    });
    root.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); go(null); }
      if (e.key === "Tab") {                    // keep focus inside the dialog
        const f = root.querySelectorAll("button, a[href]");
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    // 72 ticks on the outer ring, every sixth longer: a measuring instrument.
    const ticks = root.querySelector(".wi-ticks");
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2, r2 = i % 6 === 0 ? 172 : 179;
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", 200 + 186 * Math.cos(a)); l.setAttribute("y1", 200 + 186 * Math.sin(a));
      l.setAttribute("x2", 200 + r2 * Math.cos(a)); l.setAttribute("y2", 200 + r2 * Math.sin(a));
      ticks.appendChild(l);
    }
    document.body.appendChild(root);
    // On the experimental site, "what's new" is that branch's log.
    fetch("/api/build", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(b => {
      if (b && b.branch && /^[\w.-]+$/.test(b.branch)) {
        root.querySelector(".wn-link").href = "https://github.com/ex-tern/pi/blob/" + b.branch + "/EVOLUTION.md";
      }
    }).catch(() => { /* keep the main-branch link */ });
  }

  function open() {
    if (!root) build();
    lastFocus = document.activeElement;
    root.classList.remove("leaving");
    root.hidden = false;
    document.documentElement.classList.add("welcome-open");
    requestAnimationFrame(() => root.classList.add("in"));
    setTimeout(() => root.querySelector(".welcome-begin").focus({ preventScroll: true }), 50);
  }

  function go(tab) {
    remember();
    if (tab) {
      const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
      if (btn) btn.click();
      window.scrollTo(0, 0);
    }
    root.classList.add("leaving");
    root.classList.remove("in");
    document.documentElement.classList.remove("welcome-open");
    const done = () => { root.hidden = true; if (!tab && lastFocus && lastFocus.focus) lastFocus.focus(); };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) done();
    else setTimeout(done, 420);
  }

  // The brand mark opens the welcome screen instead of reloading the page.
  const brand = document.querySelector(".brand");
  if (brand) brand.addEventListener("click", e => { e.preventDefault(); open(); });

  if (!seen() && !location.hash) open();
})();
