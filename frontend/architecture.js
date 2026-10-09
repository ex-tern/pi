// architecture.js — how Pi Tech Lab assesses a paper, as one simple flowchart.
//
// Replaces the four old cards (overview diagram, pipeline diagram, stage table,
// CoARA list) with six steps in a row. Click a step to see what happens there.
// Drawn with plain HTML and CSS: no diagram library to download or fail.
(function () {
  "use strict";
  const STEPS = [
    { k: "Paper in", s: "PDF or DOI, identity checked",
      d: ["Upload a PDF, or give a DOI (resolved through Unpaywall and OpenAlex).",
          "The author is verified with ORCID iD or a W3C DID.",
          "Reviewers are assigned double-blind."] },
    { k: "Read", s: "Text extracted, measured by rule",
      d: ["Layout-aware text extraction from the PDF.",
          "Rule-based checks: reporting standards (MDAR), research resource IDs (RRID), reproducibility markers, density of evidence.",
          "These scores are deterministic: the same paper always gets the same numbers."] },
    { k: "Panel", s: "Independent models assess it",
      d: ["Llama, Mistral, Qwen and Gemini each assess the paper separately.",
          "siM, the local model, reads its structure alongside them.",
          "No model sees another's verdict."] },
    { k: "Judge", s: "PiDN weighs the verdicts",
      d: ["Agreement between the models is measured; weak or contradictory reasoning is caught.",
          "One judgement is formed from the panel, and the quality of that judgement is graded.",
          "The criteria weighting the paper implies is recorded: the input to the forecast."] },
    { k: "Record", s: "Written to the ledger",
      d: ["The assessment is proven and recorded as a Proof-of-Research block on Sepolia.",
          "piQ is minted to the author, soulbound: it cannot be sold or moved.",
          "Weights, logic and scores are hashed in public; the record belongs to the researcher."] },
    { k: "Outputs", s: "What you get back",
      d: ["A dossier in CoARA/DORA form, with guidance for answering reviewers.",
          "The paper's place on the Global Map of Science.",
          "The next epoch's criteria weights, forecast from every recorded block."] },
  ];
  const root = document.createElement("div");
  root.className = "arch";
  root.innerHTML =
    '<p class="arch-lede">How a paper is assessed, in six steps. Click a step to see what happens there.</p>' +
    '<ol class="arch-flow" role="list"></ol>' +
    '<div class="arch-detail" aria-live="polite"></div>' +
    '<aside class="arch-note"><h3>How judging stays fair</h3><ul>' +
    '<li><b>Algorithms audit, people judge.</b> The scores support peer review; they do not replace it.</li>' +
    '<li><b>More than papers count.</b> Datasets, code and runnable environments are assessed as research outputs.</li>' +
    '<li><b>Open and owned.</b> Every weight and score is public, and researchers own their record through ORCID or a DID.</li>' +
    '</ul><p class="arch-cite">Built to the CoARA principles. Framework by Ali Vafadar Yengejeh, Università degli Studi di Milano-Bicocca.</p></aside>';
  const flow = root.querySelector(".arch-flow"), detail = root.querySelector(".arch-detail");
  let current = 0;
  function show(i) {
    current = i;
    flow.querySelectorAll(".arch-step").forEach((b, j) => { b.setAttribute("aria-pressed", String(j === i)); });
    const st = STEPS[i];
    detail.innerHTML = '<h3></h3><p class="arch-sub"></p><ul></ul>';
    detail.querySelector("h3").textContent = (i + 1) + ". " + st.k;
    detail.querySelector(".arch-sub").textContent = st.s;
    const ul = detail.querySelector("ul");
    st.d.forEach(t => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
  }
  STEPS.forEach((st, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button"; b.className = "arch-step";
    b.innerHTML = '<span class="arch-n"></span><span class="arch-k"></span><span class="arch-s"></span>';
    b.querySelector(".arch-n").textContent = i + 1;
    b.querySelector(".arch-k").textContent = st.k;
    b.querySelector(".arch-s").textContent = st.s;
    b.addEventListener("click", () => show(i));
    b.addEventListener("keydown", e => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); const n = (i + 1) % STEPS.length; show(n); flow.querySelectorAll(".arch-step")[n].focus(); }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); const n = (i + STEPS.length - 1) % STEPS.length; show(n); flow.querySelectorAll(".arch-step")[n].focus(); }
    });
    li.appendChild(b);
    flow.appendChild(li);
  });
  show(0);
  function start() { window.PiOrbit.setContent("Architecture", root); }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
