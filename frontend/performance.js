// performance.js — the Performance window, made simple.
//
// Four engines learn from how Pi Tech Lab is used. For each: what it does, in
// one sentence, and how it is doing, in plain words, with one small meter.
// Then what is expected to change next. The detailed forecast (chart and
// controls) stays available, folded away at the bottom.
(function () {
  "use strict";
  const root = document.createElement("div");
  root.className = "perf";
  root.innerHTML =
    '<p class="perf-lede">Four engines learn from how Pi Tech Lab is used. Here is how each one is doing.</p>' +
    '<div class="perf-cards"></div>' +
    '<p class="perf-idle"></p>' +
    '<section class="perf-next"><h3>What happens next</h3><p class="perf-next-body">…</p></section>' +
    '<details class="perf-more"><summary>Show the detailed forecast</summary><div class="perf-more-body"></div></details>';
  const cards = root.querySelector(".perf-cards");

  const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
  function card(name, what, status, meter, note) {
    return '<div class="perf-card"><div class="pc-head"><b>' + name + '</b>' +
      (note ? '<span class="pc-tag">' + note + '</span>' : '') + '</div>' +
      '<p class="pc-what">' + what + '</p>' +
      '<div class="pc-meter"><i style="width:' + Math.max(0, Math.min(100, meter || 0)) + '%"></i></div>' +
      '<p class="pc-status">' + status + '</p></div>';
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // how much better than its own starting point an engine is, if it can say yet
  function better(s) {
    if (!s) return null;
    if (typeof s.improvement_pct === "number") return Math.round(s.improvement_pct);
    if (typeof s.mean_abs_error === "number" && typeof s.baseline_abs_error === "number" && s.baseline_abs_error > 0)
      return Math.round((1 - s.mean_abs_error / s.baseline_abs_error) * 100);
    return null;
  }
  function learnedLine(obs, b, firstWhat) {
    if (!obs) return "Hasn't learned anything yet. It starts " + firstWhat + ".";
    if (b === null) return "Learned from " + obs.toLocaleString() + " example" + (obs === 1 ? "" : "s") + "; too early to say how well.";
    return b > 0 ? b + "% better than when it started (" + obs.toLocaleString() + " examples)."
                 : "Not better than its starting point yet (" + obs.toLocaleString() + " examples).";
  }

  let engines = null, forecast = null;
  async function fetchData() {
    try { engines = await (await fetch("/api/engines/status")).json(); } catch (_) { engines = null; }
    try { forecast = await (await fetch("/api/forecast")).json(); } catch (_) { forecast = null; }
    render();
  }

  function render() {
    const pe = window.PiEN ? window.PiEN.stats() : null;
    const html = [];
    // PiEN
    if (pe) {
      const r = pct(pe.followed, pe.offered);
      html.push(card("PiEN", "The mark in the middle. It suggests the card you'll want next.",
        r === null ? "No suggestions made yet. It needs a few clicks to see a pattern."
                   : "Its suggestion was the one opened " + r + "% of the time (" + pe.followed + " of " + pe.offered + ")." +
                     (pe.next ? " Right now it suggests <b>" + esc(pe.next) + "</b>." : ""),
        r || 0, (pe.mine + pe.everyone).toLocaleString() + " steps seen"));
    }
    const e = engines || {};
    // PiDN
    const d = e.piD, fc = forecast || {};
    const need = Math.max(0, (fc.blocks_required || 0) - (fc.blocks_recorded || 0));
    const bD = better(d);
    html.push(card("PiDN", "Predicts how the eight scoring criteria will be weighted next.",
      need ? "Needs " + need + " more assessment" + (need === 1 ? "" : "s") + " before its first prediction."
           : learnedLine(d && (d.total_observations || d.observations) || 0, bD, "after the first assessments"),
      bD === null ? 0 : Math.max(0, bD), d && d.learning ? "improving" : ""));
    // siM
    const m = e.siM, bM = better(m);
    html.push(card("SciM", "Reads a paper's structure in seconds and checks itself against the full model panel.",
      learnedLine(m && (m.consensus_observations || m.observations) || 0, bM, "when the panel first finishes an assessment"),
      bM === null ? 0 : Math.max(0, bM), m && m.learning ? "improving" : ""));
    // ResBD
    const b = e.riB, bB = better(b);
    html.push(card("RiBD", "Your research mentor. It suggests which papers are worth your time and what to fix first.",
      learnedLine(b && (b.observations || b.logged_observations) || 0, bB, "when you mark its suggestions as useful or not"),
      bB === null ? 0 : Math.max(0, bB), b && b.learning ? "improving" : ""));
    cards.innerHTML = html.join("");

    // While nobody is using the site, it assesses open-access papers on its
    // own, and every one of them is something the engines learn from.
    const idle = e.idle, ip = root.querySelector(".perf-idle");
    if (!idle || !idle.enabled) ip.textContent = "";
    else {
      const ago = idle.last_run_at ? Math.max(1, Math.round((Date.now() / 1000 - idle.last_run_at) / 60)) : null;
      ip.innerHTML = "<b>Working while idle.</b> When the site is quiet it assesses open-access papers by itself, " +
        "and the engines learn from each one: " + idle.assessed_today + " of " + idle.daily_cap + " today" +
        (idle.working_now ? ", one in progress now" : "") +
        (idle.last_title ? ". Latest: <i>" + esc(idle.last_title) + "</i>" + (ago ? " (" + (ago < 60 ? ago + " min" : Math.round(ago / 60) + " h") + " ago)" : "") : "") + ".";
    }

    // what happens next
    const nx = root.querySelector(".perf-next-body");
    const moving = (fc.criteria || []).filter(c => c.direction && c.direction !== "flat");
    if (!fc.ready || fc.mode === "baseline" || !moving.length) {
      nx.textContent = need
        ? "Nothing to predict yet: all eight criteria still count equally. After " + need + " more assessment" + (need === 1 ? "" : "s") + ", PiDN starts forecasting which ones will matter more."
        : "No change expected: all eight criteria are holding steady.";
    } else {
      const up = moving.filter(c => c.direction === "up").map(c => c.title), down = moving.filter(c => c.direction === "down").map(c => c.title);
      nx.innerHTML = (up.length ? "Expected to count more: <b>" + up.map(esc).join(", ") + "</b>. " : "") +
                     (down.length ? "Expected to count less: <b>" + down.map(esc).join(", ") + "</b>." : "");
    }
  }

  function start() {
    const host = window.PiOrbit.contentOf && window.PiOrbit.contentOf("Performance");
    if (!host) return;
    // the old, detailed forecast goes into the fold; app.js keeps driving it
    const more = root.querySelector(".perf-more-body");
    while (host.firstChild) more.appendChild(host.firstChild);
    host.appendChild(root);
    fetchData();
    setInterval(render, 4000);                 // PiEN's numbers change as you click
    setInterval(fetchData, 120000);
    document.addEventListener("scholarpi:assessment-done", () => setTimeout(fetchData, 1500));
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
