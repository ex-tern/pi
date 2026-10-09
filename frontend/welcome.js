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
  // The mark: a black circle; its blue diameter
  // sweeps round with a fading trail behind each half.
  const TRAIL = Array.from({ length: 30 }, (_, i) => {
    const k = i + 1;                        // the sweep turns anticlockwise, so the
    return '<g transform="rotate(' + (k * 1.25) + ' 200 200)" opacity="' +   // trail lies at larger angles
      (0.30 * Math.pow(1 - k / 31, 1.8)).toFixed(3) + '">' +
      '<line class="wi-r1" x1="200" y1="200" x2="350" y2="200"/><line class="wi-r2" x1="200" y1="200" x2="50" y2="200"/></g>';
  }).join("");
  const MARK =
    '<circle class="wi-circle" cx="200" cy="200" r="150" pathLength="1000"/>' +
    '<g class="wi-orbit"><g class="wi-trail">' + TRAIL + '</g>' +
    '<line class="wi-r1 wi-radius" x1="200" y1="200" x2="350" y2="200" pathLength="1000"/>' +
    '<line class="wi-r2 wi-radius" x1="200" y1="200" x2="50" y2="200" pathLength="1000"/></g>';

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
          <svg class="welcome-mark" viewBox="40 40 320 320" aria-hidden="true">${MARK}</svg>
          <h1 id="welcomeTitle" class="welcome-title">Welcome to <span class="nowrap">Pi Tech Lab</span></h1>
          <p class="welcome-sub">A research lab you can use from your browser. Assess papers fairly, research what has been reviewed,
          run experiments, and help ideas get better.</p>
          <button class="welcome-begin" type="button" data-tab="assess">Let's begin</button>
        </div>
        <ul class="welcome-choices">
          ${CHOICES.map(c => `<li><button type="button" data-tab="${c.tab}">
            <svg class="wc-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[c.icon]}</svg>
            <span class="wc-title">${c.title}</span><span class="wc-text">${c.text}</span></button></li>`).join("")}
        </ul>
      </div>`;
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
