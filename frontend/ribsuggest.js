// ribsuggest.js — RiBD's suggestions: papers to read for your profile (one
// from the Proof-of-Research ledger explorer, one scanned manuscript and up to
// three more) and the hot topics: fields where papers here earn the most piX
// and piQ and where activity is rising.
// The choice is made server-side from your stated fields, keywords and core
// claim (/api/buddy/suggest, backend/rib_suggest.py); your own papers are
// never suggested. Each card opens the paper's dossier.
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function card(p, kind) {
    const label = kind === "explorer" ? "From the ledger explorer" : kind === "manuscript" ? "A scanned manuscript" : "Also worth reading";
    return '<button type="button" class="rs-card" data-hash="' + esc(p.eval_hash) + '">' +
      '<span class="rs-kind">' + label + '</span>' +
      '<strong class="rs-title">' + esc(p.title) + '</strong>' +
      '<span class="rs-meta">' + esc(p.author || "Unknown author") +
      (p.fields && p.fields.length ? ' · ' + p.fields.map(esc).join(", ") : '') +
      (typeof p.score === "number" ? ' · piX ' + p.score.toFixed(1) : '') + '</span>' +
      '<span class="rs-why">' + esc(p.why) + '</span></button>';
  }

  async function load(slot) {
    if (!slot || typeof Session === "undefined" || !Session.hasIdentity()) return;
    let data;
    try {
      const qs = new URLSearchParams({ wallet: Session.wallet || "", orcid: Session.orcid || "" });
      const res = await fetch("/api/buddy/suggest?" + qs);
      if (!res.ok) return;
      data = await res.json();
    } catch (_) { return; }
    if (!data || !data.available || !slot.isConnected) return;
    const picks = [["explorer", data.explorer], ["manuscript", data.manuscript]].filter(x => x[1])
      .concat((data.more || []).map(p => ["more", p]));
    let html = '<div class="rs"><h4>Papers to read</h4>' +
      (picks.length ? '<div class="rs-cards">' + picks.map(([k, p]) => card(p, k)).join("") + '</div>'
                    : '<p class="rs-none">' + esc(data.reason || "Nothing to suggest yet.") + '</p>');
    const hot = data.hot || [];
    if (hot.length) {
      html += '<h4 class="rs-hot-h">Hot topics to research</h4>' +
        '<p class="rs-hot-lede">Where papers assessed here earn the most piX and piQ, and where activity is rising. ' +
        'It describes what has paid off so far, not a promise.</p>' +
        '<ol class="rs-hot">' + hot.map(h =>
          '<li><span class="rs-hot-name">' + esc(h.field) + (h.yours ? ' <em>your field</em>' : '') + '</span>' +
          '<span class="rs-hot-meta">avg piX ' + h.avg_pix.toFixed(1) + ' · avg ' + h.avg_piq.toFixed(2) + ' piQ per paper · ' +
          h.recent + ' new in 30 days · ' + h.papers + ' papers</span>' +
          '<span class="rs-heat"><i style="width:' + Math.round(100 * h.heat) + '%"></i></span></li>').join("") + '</ol>';
    }
    slot.innerHTML = html + '</div>';
    slot.querySelectorAll(".rs-card").forEach(b => b.addEventListener("click", () => {
      if (typeof openDossierByHash === "function") openDossierByHash(b.dataset.hash);
    }));
  }

  window.RibSuggest = { load };
})();
