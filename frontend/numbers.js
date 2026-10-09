// numbers.js — the numbers window, opened by clicking the π box.
//
// π, computed digit by digit for as long as the page is open (pi-worker.js),
// and its companions, computed exactly to more and more digits
// (consts-worker.js): e, φ and γ. Digits are revealed at a steady
// pace, so every number visibly keeps growing.
(function () {
  "use strict";
  const NUMBERS = [
    { key: "pi", sym: "π", name: "Pi", note: "The ratio of a circle's circumference to its diameter." },
    { key: "e", sym: "e", name: "Euler's number", note: "The base of natural growth: (1 + 1/n)ⁿ as n grows without end." },
    { key: "phi", sym: "φ", name: "The golden ratio", note: "(1 + √5) / 2: a line cut so the whole is to the longer part as the longer is to the shorter." },
    { key: "gamma", sym: "γ", name: "Euler–Mascheroni constant", note: "How far 1 + ½ + ⅓ + … + 1/n stays above ln n. Nobody yet knows whether it is a fraction." },
  ];
  const PACE = 16;                 // digits a second, the same pace as π
  const have = {};                 // key -> full digit string available so far
  const shown = {};                // key -> how many decimals are on screen
  let worker = null, timer = 0, rows = {};

  const content = document.createElement("div");
  content.className = "nb";
  content.innerHTML = '<p class="nb-intro">Computed here, in your browser, with exact integer arithmetic. They keep growing while the page is open.</p>';
  NUMBERS.forEach(n => {
    const r = document.createElement("section");
    r.className = "nb-row";
    r.innerHTML = '<header><span class="nb-sym"></span><span class="nb-name"></span><span class="nb-count"></span></header>' +
      '<p class="nb-digits" aria-live="off"></p><p class="nb-note"></p>';
    r.querySelector(".nb-sym").textContent = n.sym;
    r.querySelector(".nb-name").textContent = n.name;
    r.querySelector(".nb-note").textContent = n.note;
    content.appendChild(r);
    rows[n.key] = { el: r, digits: r.querySelector(".nb-digits"), count: r.querySelector(".nb-count"), text: null };
    shown[n.key] = 0;
  });

  function startWorker() {
    if (worker) return;
    try {
      worker = new Worker("consts-worker.js?v=2");
      worker.onmessage = e => { if ((e.data.digits || "").length > (have[e.data.key] || "").length) have[e.data.key] = e.data.digits; };
      if (window.PiOrbit.still && window.PiOrbit.still()) worker.postMessage({ pause: true });
    } catch (_) { /* no workers: π alone still grows */ }
  }

  // Append only the new digits: the strings get long, re-rendering them would not scale.
  // A double-click on the logo stops π; its friends stop with it.
  const still = () => !!(window.PiOrbit.still && window.PiOrbit.still());
  document.addEventListener("orbit:still", e => {
    if (worker) worker.postMessage({ pause: !!e.detail });
    for (const n of NUMBERS) {
      const row = rows[n.key];
      if (row && shown[n.key]) row.count.textContent = shown[n.key].toLocaleString() + (e.detail ? " decimals, paused" : " decimals");
    }
  });

  function tick() {
    if (still()) return;
    const pi = window.PiOrbit.piDigits();
    if (pi) have.pi = pi[0] + "." + pi.slice(1);
    for (const n of NUMBERS) {
      const full = have[n.key];
      if (!full) continue;
      const dot = full.indexOf(".");
      const avail = full.length - dot - 1;
      const target = n.key === "pi" ? avail : Math.min(avail, shown[n.key] + Math.ceil(PACE / 4));
      const row = rows[n.key];
      if (!row.text) { row.text = document.createTextNode(full.slice(0, dot + 1)); row.digits.appendChild(row.text); }
      if (target > shown[n.key]) {
        const d = row.digits, atEnd = d.scrollHeight - d.scrollTop - d.clientHeight < 8;
        row.text.appendData(full.slice(dot + 1 + shown[n.key], dot + 1 + target));
        if (atEnd) d.scrollTop = d.scrollHeight;       // follow the newest digits, unless you scrolled back
        shown[n.key] = target;
        row.count.textContent = target.toLocaleString() + " decimals";
      }
    }
  }

  function start() {
    window.PiOrbit.addVirtual({ key: "numbers:Numbers", section: { key: "numbers", name: "Numbers" }, title: "π and friends", content });
    // compute only once the window has been opened (it may be reopened on load)
    new MutationObserver(() => {
      if (content.isConnected && content.closest(".orbit-panel")) {
        startWorker();
        if (!timer) { tick(); timer = setInterval(tick, 250); }
      }
    }).observe(document.body, { childList: true, subtree: false });
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
