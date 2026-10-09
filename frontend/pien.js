// pien.js — PiEN, the engine behind the Pi Tech Lab mark.
//
// PiEN learns from how the site is used and suggests the card you are likely
// to want next, with a soft halo on that pill. It learns two ways:
//
//   * from you: which cards you open and which you open after which. Kept with
//     your layout ("orbit:pien"), so it follows your account when signed in.
//   * from everyone: the same steps, pooled anonymously on the server
//     (/api/pien, card names and counts only, never who).
//
// Your own habits weigh three times as much as everyone's. With little to go
// on, PiEN stays quiet rather than guess.
(function () {
  "use strict";
  const KEY = "orbit:pien";
  const GAP_MS = 30 * 60 * 1000;            // a step only counts within half an hour
  let mine = { o: {}, t: {}, last: "", at: 0, s: 0, h: 0 };
  let pick = null;                          // what PiEN suggests right now
  // Cards that were renamed or merged: what was learned about them carries over.
  const ALIAS = {
    "analytics:Key numbers": "analytics:Analytics",
    "analytics:Forecast": "analytics:Performance",
    "diagram:Overview": "diagram:Architecture",
    "diagram:Stage Reference": "diagram:Architecture",
    "diagram:Scoring Pipeline in Detail": "diagram:Architecture",
    "diagram:CoARA Compliance & Core Pillars": "diagram:Architecture",
    "journal:pi-Index (piX) Leaderboard [Top Papers]": "journal:Leaderboards",
    "journal:pi-Quotient (piQ) Leaderboard [Top Authors]": "journal:Leaderboards",
  };
  const A = k => ALIAS[k] || k;
  function normOpens(o) { const out = {}; Object.entries(o || {}).forEach(([k, n]) => { out[A(k)] = (out[A(k)] || 0) + n; }); return out; }
  function normNext(t) {
    const out = {};
    Object.entries(t || {}).forEach(([a, row]) => Object.entries(row || {}).forEach(([b, n]) => {
      const x = A(a), y = A(b);
      if (x === y) return;                                   // merged into one card: no longer a step
      out[x] = out[x] || {}; out[x][y] = (out[x][y] || 0) + n;
    }));
    return out;
  }
  let all = { opens: {}, next: {}, interactions: 0 };
  let pending = { opens: {}, steps: {} };

  function read() {
    const m = window.PiOrbit && window.PiOrbit.load(KEY);
    if (m && typeof m === "object") {
      mine = Object.assign({ o: {}, t: {}, last: "", at: 0, s: 0, h: 0 }, m);
      mine.o = normOpens(mine.o); mine.t = normNext(mine.t); mine.last = A(mine.last);
    }
  }
  const save = () => window.PiOrbit.store(KEY, mine);

  function learn(key) {
    read();                                  // the account may have replaced it since
    // how PiEN is doing: every open made while it had a suggestion counts,
    // and it scores when that suggestion is the one opened
    if (pick) { mine.s = (mine.s || 0) + 1; if (pick === key) mine.h = (mine.h || 0) + 1; }
    mine.o[key] = (mine.o[key] || 0) + 1;
    pending.opens[key] = (pending.opens[key] || 0) + 1;
    if (mine.last && mine.last !== key && Date.now() - mine.at < GAP_MS) {
      const row = mine.t[mine.last] = mine.t[mine.last] || {};
      row[key] = (row[key] || 0) + 1;
      const s = mine.last + "\u0000" + key;
      pending.steps[s] = (pending.steps[s] || 0) + 1;
    }
    mine.last = key; mine.at = Date.now();
    trim();
    save();
    suggest();
  }
  // keep what is stored small: the 8 most common next cards per card
  function trim() {
    Object.keys(mine.t).forEach(a => {
      const row = Object.entries(mine.t[a]).sort((x, y) => y[1] - x[1]).slice(0, 8);
      mine.t[a] = Object.fromEntries(row);
    });
  }

  const share = (row, k) => { const n = Object.values(row || {}).reduce((a, b) => a + b, 0); return n ? (row[k] || 0) / n : 0; };
  function predict() {
    const from = mine.last && Date.now() - mine.at < GAP_MS ? mine.last : "";
    const cands = window.PiOrbit.visibleKeys().filter(k => k !== from && !k.startsWith("links:"));
    // open windows count too: windows stay open, and the pick brings one forward
    let best = null, bestScore = 0;
    for (const k of cands) {
      const score =
        (from ? 3 * share(mine.t[from], k) + share(all.next[from], k) : 0) +
        0.3 * share(mine.o, k) + 0.1 * share(all.opens, k);
      if (score > bestScore) { best = k; bestScore = score; }
    }
    const seen = Object.values(mine.o).reduce((a, b) => a + b, 0) + all.interactions;
    return seen >= 3 && bestScore >= 0.12 ? best : null;
  }

  function suggest() {
    pick = predict();
    document.querySelectorAll(".orbit-bubble.pien-pick").forEach(b => {
      if (b.dataset.key !== pick) { b.classList.remove("pien-pick"); b.removeAttribute("data-pien"); }
    });
    if (pick) {
      const b = document.querySelector('.orbit-bubble[data-key="' + CSS.escape(pick) + '"]');
      if (b) { b.classList.add("pien-pick"); b.dataset.pien = "PiEN suggests this next"; }
    }
    const core = document.querySelector(".orbit-core");
    if (core) {
      const n = Object.values(mine.o).reduce((a, b) => a + b, 0);
      core.title = "PiEN · learned from " + n.toLocaleString() + " of your steps and " +
        all.interactions.toLocaleString() + " from everyone";
    }
  }

  // what everyone does, pooled anonymously
  function fetchModel() {
    fetch("/api/pien/model").then(r => (r.ok ? r.json() : null)).then(m => {
      if (!m) return;
      all = { opens: normOpens(m.opens), next: normNext(m.next), interactions: m.interactions || 0 };
      suggest(); renderPanel();
    }).catch(() => {});
  }
  function flush(beacon) {
    const opens = Object.entries(pending.opens).map(([k, n]) => [k, Math.min(10, n)]);
    const steps = Object.entries(pending.steps).map(([s, n]) => { const [a, b] = s.split("\u0000"); return [a, b, Math.min(10, n)]; });
    if (!opens.length && !steps.length) return;
    pending = { opens: {}, steps: {} };
    const body = JSON.stringify({ opens: opens.slice(0, 20), steps: steps.slice(0, 20) });
    if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/pien/learn", new Blob([body], { type: "application/json" }));
    else fetch("/api/pien/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
  }

  // ------------------------------------------------------------ PiEN in the Performance window
  const panel = document.createElement("section");
  panel.className = "pien-perf";
  const labelOf = k => { const b = document.querySelector('.orbit-bubble[data-key="' + CSS.escape(k) + '"]'); return b ? b.textContent : k.replace(/^[a-z]+:/, ""); };
  function renderPanel() {
    if (!panel.isConnected) return;
    const n = Object.values(mine.o).reduce((a, b) => a + b, 0);
    const rate = mine.s ? Math.round((100 * (mine.h || 0)) / mine.s) : null;
    // the most common next steps, yours and everyone's together
    const pairs = {};
    const add = (t, w) => Object.entries(t || {}).forEach(([a, row]) => Object.entries(row).forEach(([b, c]) => { const k = a + "\u0000" + b; pairs[k] = (pairs[k] || 0) + c * w; }));
    add(mine.t, 1); add(all.next, 1);
    const top = Object.entries(pairs).sort((x, y) => y[1] - x[1]).slice(0, 5);
    panel.innerHTML =
      '<h2>PiEN</h2>' +
      '<p class="pp-lede">The engine in the middle of the page. It learns how the site is used and suggests what to open next.</p>' +
      '<div class="pp-stats">' +
      '<div><b>' + (rate === null ? "—" : rate + "%") + '</b><span>suggestions followed' + (mine.s ? " (" + (mine.h || 0) + " of " + mine.s + ")" : "") + '</span></div>' +
      '<div><b>' + n.toLocaleString() + '</b><span>of your steps learned</span></div>' +
      '<div><b>' + (all.interactions || 0).toLocaleString() + '</b><span>steps learned from everyone</span></div>' +
      '</div>' +
      '<p class="pp-next"></p>' +
      (top.length ? '<h3>Most common next steps</h3><ol class="pp-pairs"></ol>' : '<p class="pp-empty">Nothing learned yet: open a few cards and PiEN starts to see patterns.</p>');
    const next = panel.querySelector(".pp-next");
    if (pick) {
      next.append("Suggests next: ");
      const b = document.createElement("button"); b.type = "button"; b.className = "cap-open"; b.textContent = labelOf(pick);
      b.addEventListener("click", () => window.PiOrbit.openTitle(labelOf(pick)));
      next.appendChild(b);
    } else next.textContent = "No suggestion yet: it needs a little more to go on.";
    const ol = panel.querySelector(".pp-pairs");
    if (ol) top.forEach(([k, c]) => {
      const [a, b] = k.split("\u0000");
      const li = document.createElement("li");
      li.textContent = labelOf(a) + " → " + labelOf(b);
      const sp = document.createElement("span"); sp.textContent = Math.round(c).toLocaleString(); li.appendChild(sp);
      ol.appendChild(li);
    });
  }
  function attachPanel() {
    const host = window.PiOrbit.contentOf && window.PiOrbit.contentOf("Performance");
    if (host && !panel.isConnected) host.insertBefore(panel, host.firstChild);
  }

  function start() {
    read();
    attachPanel();
    setInterval(renderPanel, 3000);
    document.addEventListener("orbit:open", e => { learn(e.detail.key); setTimeout(renderPanel, 50); });
    fetchModel();
    setInterval(fetchModel, 10 * 60 * 1000);
    setInterval(() => flush(false), 20000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
    // pills come and go (sign-in), and the account's memory may arrive later
    setInterval(() => { read(); suggest(); renderPanel(); }, 5000);
    setTimeout(suggest, 800);
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
