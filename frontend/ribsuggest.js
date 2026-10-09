// ribsuggest.js — RiBD suggests two papers for your profile: one from the
// Proof-of-Research ledger explorer and one scanned (assessed) manuscript.
// The choice is made server-side from your stated fields, keywords and core
// claim (/api/buddy/suggest, backend/rib_suggest.py); your own papers are
// never suggested. Each card opens the paper's dossier.
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function card(p, kind) {
    const label = kind === "explorer" ? "From the ledger explorer" : "A scanned manuscript";
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
    const picks = [["explorer", data.explorer], ["manuscript", data.manuscript]].filter(x => x[1]);
    slot.innerHTML = '<div class="rs"><h4>RiBD suggests</h4>' +
      (picks.length ? '<div class="rs-cards">' + picks.map(([k, p]) => card(p, k)).join("") + '</div>'
                    : '<p class="rs-none">' + esc(data.reason || "Nothing to suggest yet.") + '</p>') +
      '</div>';
    slot.querySelectorAll(".rs-card").forEach(b => b.addEventListener("click", () => {
      if (typeof openDossierByHash === "function") openDossierByHash(b.dataset.hash);
    }));
  }

  window.RibSuggest = { load };
})();
