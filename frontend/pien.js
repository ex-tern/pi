// pien.js — PiEn, the engine behind the Pi Tech Lab mark.
//
// PiEn learns from how the site is used and suggests the card you are likely
// to want next, with a soft halo on that pill. It learns two ways:
//
//   * from you: which cards you open and which you open after which. Kept with
//     your layout ("orbit:pien"), so it follows your account when signed in.
//   * from everyone: the same steps, pooled anonymously on the server
//     (/api/pien, card names and counts only, never who).
//
// Your own habits weigh three times as much as everyone's. With little to go
// on, PiEn stays quiet rather than guess.
(function () {
  "use strict";
  const KEY = "orbit:pien";
  const GAP_MS = 30 * 60 * 1000;            // a step only counts within half an hour
  let mine = { o: {}, t: {}, last: "", at: 0 };
  let all = { opens: {}, next: {}, interactions: 0 };
  let pending = { opens: {}, steps: {} };

  function read() {
    const m = window.PiOrbit && window.PiOrbit.load(KEY);
    if (m && typeof m === "object") mine = Object.assign({ o: {}, t: {}, last: "", at: 0 }, m);
  }
  const save = () => window.PiOrbit.store(KEY, mine);

  function learn(key) {
    read();                                  // the account may have replaced it since
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
    const pick = predict();
    document.querySelectorAll(".orbit-bubble.pien-pick").forEach(b => {
      if (b.dataset.key !== pick) { b.classList.remove("pien-pick"); b.removeAttribute("data-pien"); }
    });
    if (pick) {
      const b = document.querySelector('.orbit-bubble[data-key="' + CSS.escape(pick) + '"]');
      if (b) { b.classList.add("pien-pick"); b.dataset.pien = "PiEn suggests this next"; }
    }
    const core = document.querySelector(".orbit-core");
    if (core) {
      const n = Object.values(mine.o).reduce((a, b) => a + b, 0);
      core.title = "PiEn · learned from " + n.toLocaleString() + " of your steps and " +
        all.interactions.toLocaleString() + " from everyone";
    }
  }

  // what everyone does, pooled anonymously
  function fetchModel() {
    fetch("/api/pien/model").then(r => (r.ok ? r.json() : null)).then(m => { if (m) { all = m; suggest(); } }).catch(() => {});
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

  function start() {
    read();
    document.addEventListener("orbit:open", e => learn(e.detail.key));
    fetchModel();
    setInterval(fetchModel, 10 * 60 * 1000);
    setInterval(() => flush(false), 20000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
    // pills come and go (sign-in), and the account's memory may arrive later
    setInterval(() => { read(); suggest(); }, 5000);
    setTimeout(suggest, 800);
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
