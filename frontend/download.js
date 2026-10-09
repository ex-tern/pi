// download.js — the dossier's "Download paper" button.
//
// The server decides who may have the file (GET /api/papers/{hash}/file):
// anyone once its author has published the assessment, and the author for
// their own upload; the request carries the session token (app.js adds it to
// every same-origin fetch). If the file is not available to you but the paper
// has a DOI, the button takes you to the publisher's copy instead, which is
// where an open-access paper (like the ones assessed while the site is idle)
// can be downloaded. Otherwise it says why there is nothing to download.
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cleanDoi = d => { d = String(d || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""); return /^10\.\d{4,9}\/\S+$/.test(d) ? d : ""; };

  function button(item) {
    const hash = item && (item.hash || item.eval_hash);
    if (!hash) return "";
    return '<div class="dl-row"><button type="button" class="btn btn-outline dl-btn" data-dl-hash="' + esc(hash) + '"' +
      ' data-dl-doi="' + esc(cleanDoi(item.doi)) + '" data-dl-title="' + esc(item.title || "paper") + '">' +
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10M5.5 8.5 10 13l4.5-4.5M4 16h12"/></svg>Download paper</button>' +
      '<span class="dl-msg" aria-live="polite"></span></div>';
  }

  async function download(btn) {
    const msg = btn.parentElement.querySelector(".dl-msg");
    const { dlHash: hash, dlDoi: doi, dlTitle: title } = btn.dataset;
    msg.textContent = "";
    btn.disabled = true;
    try {
      const r = await fetch("/api/papers/" + encodeURIComponent(hash) + "/file?download=1");
      if (r.ok) {
        const blob = await r.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "paper") + ".pdf";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        msg.textContent = "Downloaded.";
        return;
      }
      if (doi) {
        window.open("https://doi.org/" + encodeURI(doi), "_blank", "noopener,noreferrer");
        msg.textContent = "Opened the publisher's copy (DOI " + doi + ").";
        return;
      }
      msg.textContent = "No file to download: the manuscript stays private until its author publishes the assessment.";
    } catch (_) {
      msg.textContent = "The download failed. Please try again.";
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-dl-hash]");
    if (b) { e.preventDefault(); download(b); }
  });
  window.PaperDownload = { button };
})();
