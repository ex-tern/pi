// traffic.js — website traffic in the Analytics window.
//
// Four numbers (distinct visitors today, in the last 7 and 30 days, all time)
// and one chart: distinct visitors per day over the last 30 days, one cobalt
// bar per day, a hover tooltip per bar and a table view. Data from
// GET /api/traffic (backend/traffic.py): aggregates only, counted once per
// browser session, from a keyed hash of the IP, never the address.
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtDay = d => new Date(d + "T00:00:00Z").toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
  const n = v => Number(v || 0).toLocaleString();

  const root = document.createElement("section");
  root.className = "traffic";
  root.innerHTML = '<h3>Website traffic</h3><div class="tr-tiles"></div>' +
    '<div class="tr-chart" role="img" aria-label="Distinct visitors per day, last 30 days"></div>' +
    '<div class="tr-tip" hidden></div>' +
    '<details class="tr-table"><summary>Show as a table</summary><div></div></details>' +
    '<p class="tr-note">Distinct visitors per day, counted once per browser session. No addresses are kept, only an anonymous key.</p>';

  function tiles(d) {
    root.querySelector(".tr-tiles").innerHTML = [
      ["Today", d.today], ["Last 7 days", d.week], ["Last 30 days", d.month], ["All time", d.all_time],
    ].map(([l, v]) => '<div class="tr-tile"><b>' + n(v) + '</b><span>' + l + '</span></div>').join("");
  }

  function chart(days) {
    const W = 600, H = 150, padL = 26, padB = 20, padT = 10;
    const max = Math.max(1, ...days.map(d => d.visitors));
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const top = Math.ceil(max / step) * step;
    const bw = (W - padL) / days.length, inner = H - padB - padT;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    // recessive grid: baseline and the top value
    svg += '<line class="tr-grid" x1="' + padL + '" x2="' + W + '" y1="' + padT + '" y2="' + padT + '"/>' +
           '<line class="tr-axis" x1="' + padL + '" x2="' + W + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '"/>' +
           '<text class="tr-lab" x="' + (padL - 4) + '" y="' + (padT + 4) + '" text-anchor="end">' + n(top) + '</text>' +
           '<text class="tr-lab" x="' + (padL - 4) + '" y="' + (H - padB + 4) + '" text-anchor="end">0</text>';
    days.forEach((d, i) => {
      const h = d.visitors ? Math.max(2, inner * d.visitors / top) : 0;
      const x = padL + i * bw + 1, w = Math.max(1, bw - 2), y = H - padB - h, r = Math.min(4, w / 2, h);
      if (h) svg += '<path class="tr-bar" d="M' + x + ',' + (H - padB) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
        'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (H - padB) + 'Z"/>';
      // hit target: the whole column, bigger than the mark
      svg += '<rect class="tr-hit" data-i="' + i + '" x="' + (padL + i * bw) + '" y="0" width="' + bw + '" height="' + (H - padB) + '"/>';
    });
    [0, Math.floor(days.length / 2), days.length - 1].forEach(i => {
      svg += '<text class="tr-lab" x="' + (padL + i * bw + bw / 2) + '" y="' + (H - 5) + '" text-anchor="' +
             (i === 0 ? "start" : i === days.length - 1 ? "end" : "middle") + '">' + esc(fmtDay(days[i].day)) + '</text>';
    });
    svg += '</svg>';
    const box = root.querySelector(".tr-chart");
    box.innerHTML = svg;
    const tip = root.querySelector(".tr-tip");
    box.querySelectorAll(".tr-hit").forEach(h => {
      const show = e => {
        const d = days[+h.dataset.i];
        tip.innerHTML = '<b>' + esc(fmtDay(d.day)) + '</b>' + n(d.visitors) + ' visitor' + (d.visitors === 1 ? '' : 's') +
          ' · ' + n(d.visits) + ' visit' + (d.visits === 1 ? '' : 's');
        tip.hidden = false;
        const b = root.getBoundingClientRect(), r = h.getBoundingClientRect();
        tip.style.left = Math.max(0, Math.min(b.width - tip.offsetWidth, r.left - b.left + r.width / 2 - tip.offsetWidth / 2)) + "px";
        tip.style.top = (r.top - b.top - tip.offsetHeight - 4) + "px";
        box.querySelectorAll(".tr-hit.on").forEach(x => x.classList.remove("on"));
        h.classList.add("on");
      };
      h.addEventListener("pointerenter", show);
      h.addEventListener("click", show);
    });
    box.addEventListener("pointerleave", () => { tip.hidden = true; box.querySelectorAll(".tr-hit.on").forEach(x => x.classList.remove("on")); });
    root.querySelector(".tr-table div").innerHTML = '<table><thead><tr><th>Day</th><th>Visitors</th><th>Visits</th></tr></thead><tbody>' +
      days.slice().reverse().map(d => '<tr><td>' + esc(fmtDay(d.day)) + '</td><td>' + n(d.visitors) + '</td><td>' + n(d.visits) + '</td></tr>').join("") +
      '</tbody></table>';
  }

  async function refresh() {
    try {
      const r = await fetch("/api/traffic?days=30");
      if (!r.ok) return;
      const d = await r.json();
      tiles(d);
      chart(d.days || []);
    } catch (_) { /* keep what is shown */ }
  }

  function start() {
    const host = window.PiOrbit.contentOf && window.PiOrbit.contentOf("Analytics");
    if (!host) return;
    host.appendChild(root);
    refresh();
    setInterval(() => { if (document.visibilityState === "visible" && root.isConnected && root.closest(".orbit-panel")) refresh(); }, 60000);
    document.addEventListener("orbit:open", () => setTimeout(() => { if (root.closest(".orbit-panel")) refresh(); }, 100));
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
