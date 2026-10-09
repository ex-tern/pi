// welcome.js — the arrival screen.
//
// Shown once per browser session, over the app, never instead of it: the app
// underneath has already loaded and every choice here only clicks one of its
// existing tabs. Skipped entirely for deep links (/#lab and friends), so a
// shared link still lands where it points. The brand mark reopens it.
(function () {
  "use strict";
  const KEY = "sp_welcomed";
  const CHOICES = [
    { tab: "assess",    title: "Evaluate a manuscript", text: "Upload a paper or a DOI and get a CoARA-aligned assessment." },
    { tab: "journal",   title: "Explore the corpus",    text: "Reviewed papers, leaderboards and the research ledger." },
    { tab: "analytics", title: "Envision the field",    text: "Analytics and the living map of science." },
    { tab: "lab",       title: "Enter the Lab",         text: "HAL-OS and other projects, running live in your browser." },
  ];

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
        <svg class="welcome-instrument" viewBox="0 0 400 400" aria-hidden="true">
          <g class="wi-ticks"></g>
          <circle class="wi-ring wi-ring-outer" cx="200" cy="200" r="186"/>
          <circle class="wi-circle" cx="200" cy="200" r="150" pathLength="1000"/>
          <line class="wi-diameter" x1="50" y1="200" x2="350" y2="200" pathLength="1000"/>
          <circle class="wi-centre" cx="200" cy="200" r="3"/>
          <g class="wi-orbit"><circle class="wi-point" cx="350" cy="200" r="7"/><circle class="wi-halo" cx="350" cy="200" r="16"/></g>
        </svg>
        <div class="welcome-copy">
          <h1 id="welcomeTitle" class="welcome-title">ScholarPi</h1>
          <p class="welcome-sub">Research, measured fairly. Assessment that reads the work, not the journal it appeared in.</p>
          <button class="welcome-begin" type="button" data-tab="assess">Begin</button>
          <ul class="welcome-choices">
            ${CHOICES.map(c => `<li><button type="button" data-tab="${c.tab}"><span class="wc-title">${c.title}</span><span class="wc-text">${c.text}</span></button></li>`).join("")}
          </ul>
          <p class="welcome-pi" aria-hidden="true">π = 3.14159 26535 89793 23846 26433 83279 50288 41971 69399 37510</p>
        </div>
      </div>`;
    // 72 ticks on the outer ring, every sixth longer: a measuring instrument.
    const ticks = root.querySelector(".wi-ticks");
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2, long = i % 6 === 0;
      const r1 = 186, r2 = long ? 174 : 180;
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", 200 + r1 * Math.cos(a)); l.setAttribute("y1", 200 + r1 * Math.sin(a));
      l.setAttribute("x2", 200 + r2 * Math.cos(a)); l.setAttribute("y2", 200 + r2 * Math.sin(a));
      ticks.appendChild(l);
    }
    root.addEventListener("click", e => {
      const b = e.target.closest("button[data-tab]");
      if (b) go(b.dataset.tab);
    });
    root.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); go(null); }
      if (e.key === "Tab") {                    // keep focus inside the dialog
        const f = root.querySelectorAll("button");
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    document.body.appendChild(root);
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
