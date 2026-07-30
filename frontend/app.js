const API = ""; // same-origin, FastAPI serves both API and this frontend
const OWNER_ID = "0x1Af8D9A120b02D0983590587364F8705e6942356";

// ---------------------------------------------------------------------------
// Session state (replaces Streamlit's st.session_state, persisted in the browser)
// ---------------------------------------------------------------------------
const Session = {
  get wallet() { return localStorage.getItem("sp_wallet") || ""; },
  set wallet(v) { v ? localStorage.setItem("sp_wallet", v) : localStorage.removeItem("sp_wallet"); },
  get orcid() { return localStorage.getItem("sp_orcid") || ""; },
  set orcid(v) { v ? localStorage.setItem("sp_orcid", v) : localStorage.removeItem("sp_orcid"); },
  get researcherName() { return localStorage.getItem("sp_researcher_name") || "Anonymous Researcher"; },
  set researcherName(v) { v ? localStorage.setItem("sp_researcher_name", v) : localStorage.removeItem("sp_researcher_name"); },
  get freeEvalsUsed() { return parseInt(localStorage.getItem("sp_free_evals") || "0", 10); },
  set freeEvalsUsed(v) { localStorage.setItem("sp_free_evals", String(v)); },
  hasWeb3() { return !!this.wallet; },
  hasOrcid() { return !!this.orcid; },
  currentUser() { return this.orcid || this.wallet || "Anonymous"; },
};

let evaluatedBuffer = []; // mirrors st.session_state.evaluated_papers_buffer
let downloadErrors = [];

// ---------------------------------------------------------------------------
// Bootstrapping: read ORCID / wallet redirect params, clean URL
// ---------------------------------------------------------------------------
function bootstrapFromQueryParams() {
  const params = new URLSearchParams(window.location.search);
  let changed = false;
  if (params.has("orcid")) {
    Session.orcid = params.get("orcid");
    if (params.get("orcid_name")) Session.researcherName = params.get("orcid_name");
    changed = true;
  }
  if (params.has("wallet")) {
    Session.wallet = params.get("wallet");
    changed = true;
  }
  if (params.has("orcid_error")) {
    alert("ORCID authentication error: " + params.get("orcid_error"));
    changed = true;
  }
  if (changed) window.history.replaceState({}, document.title, window.location.pathname);
}

// ---------------------------------------------------------------------------
// Sidebar: wallet / orcid / logs / scilem
// ---------------------------------------------------------------------------
async function renderSidebar() {
  const mmWrap = document.getElementById("mmConnectWrap");
  const mmLinked = document.getElementById("mmLinked");
  const orcidWrap = document.getElementById("orcidConnectWrap");
  const orcidLinked = document.getElementById("orcidLinked");
  const researcherPanel = document.getElementById("researcherPanel");

  if (Session.hasWeb3()) {
    mmWrap.classList.add("hidden");
    mmLinked.classList.remove("hidden");
    mmLinked.textContent = `Web3 Linked: ${Session.wallet.slice(0, 6)}...${Session.wallet.slice(-4)}`;
  } else {
    mmWrap.classList.remove("hidden");
    mmLinked.classList.add("hidden");
  }

  if (Session.hasOrcid()) {
    orcidWrap.classList.add("hidden");
    orcidLinked.classList.remove("hidden");
    orcidLinked.textContent = `ORCID Linked: ${Session.orcid}`;
  } else {
    orcidWrap.classList.remove("hidden");
    orcidLinked.classList.add("hidden");
  }

  if (Session.hasWeb3() || Session.hasOrcid()) {
    researcherPanel.classList.remove("hidden");
    document.getElementById("researcherName").textContent = Session.researcherName;
    try {
      const qs = new URLSearchParams();
      if (Session.wallet) qs.set("wallet", Session.wallet);
      if (Session.orcid) qs.set("orcid", Session.orcid);
      const res = await fetch(`${API}/api/user/piq-total?${qs}`);
      const data = await res.json();
      document.getElementById("researcherPiq").textContent = `${data.total_piq.toFixed(2)} piQ`;
    } catch (e) { /* ignore */ }
  } else {
    researcherPanel.classList.add("hidden");
  }

  document.getElementById("scilemResetBtn").classList.toggle(
    "hidden", !(Session.hasWeb3() && Session.wallet.toLowerCase() === OWNER_ID.toLowerCase())
  );

  refreshAssessGate();
}

document.getElementById("connectMmBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("mmStatus");
  const provider = window.ethereum;
  if (!provider) { statusEl.textContent = "MetaMask not detected!"; return; }

  statusEl.textContent = "Connecting...";
  // If MetaMask's approval popup doesn't grab focus (common in some
  // browsers/OSes), the request just hangs with no feedback. Nudge the
  // user to go find it instead of leaving them staring at "Connecting...".
  const hintTimer = setTimeout(() => {
    statusEl.innerHTML = "Still waiting — check for a MetaMask popup " +
      "(click the fox icon in your browser toolbar) and approve it there.";
  }, 6000);

  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    clearTimeout(hintTimer);
    if (!accounts || !accounts.length) { statusEl.textContent = ""; return; }
    const account = accounts[0];
    statusEl.textContent = "Signing...";
    const nonce = Math.floor(Math.random() * 100000000);
    const message = `ScholarPi wants you to sign in with your Ethereum account:\n${account}\n\nSign in with Ethereum to authenticate session.\n\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    let signature = null;
    try {
      signature = await provider.request({ method: "personal_sign", params: [message, account] });
    } catch (e) { /* user may decline signing; still allow address-only link */ }

    const res = await fetch(`${API}/api/auth/wallet/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: account, message, signature }),
    });
    const data = await res.json();
    Session.wallet = data.address;
    statusEl.textContent = "";
    renderSidebar();
  } catch (e) {
    clearTimeout(hintTimer);
    if (e && e.code === -32002) {
      statusEl.textContent = "A MetaMask request is already open — click the fox icon in your toolbar to find it.";
    } else if (e && e.code === 4001) {
      statusEl.textContent = "Connection request was rejected.";
    } else {
      statusEl.textContent = "Connection failed.";
    }
  }
});

document.getElementById("connectOrcidBtn").addEventListener("click", async () => {
  const qs = Session.wallet ? `?wallet=${encodeURIComponent(Session.wallet)}` : "";
  const res = await fetch(`${API}/api/auth/orcid/login-url${qs}`);
  const data = await res.json();
  window.location.href = data.url;
});

document.getElementById("unlinkBtn").addEventListener("click", () => {
  Session.wallet = ""; Session.orcid = ""; Session.researcherName = "";
  renderSidebar();
});

async function pollLogs() {
  try {
    const res = await fetch(`${API}/api/logs`);
    const data = await res.json();
    const box = document.getElementById("logMonitor");
    box.textContent = data.logs.length ? data.logs.join("\n") : "No active logs...";
  } catch (e) { /* ignore */ }
}
setInterval(pollLogs, 4000);
pollLogs();

document.getElementById("scilemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("scilemInput");
  const box = document.getElementById("scilemChatBox");
  const prompt = input.value.trim();
  if (!prompt) return;
  box.insertAdjacentHTML("beforeend", `<div class="chat-msg user">👤 <strong>You:</strong> ${escapeHtml(prompt)}</div>`);
  input.value = "";
  box.scrollTop = box.scrollHeight;
  try {
    const res = await fetch(`${API}/api/scilem/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    box.insertAdjacentHTML("beforeend", `<div class="chat-msg ai">🧠 ${escapeHtml(data.response)}</div>`);
  } catch (e) {
    box.insertAdjacentHTML("beforeend", `<div class="chat-msg ai">Error connecting to Scilem backend.</div>`);
  }
  box.scrollTop = box.scrollHeight;
});

document.getElementById("scilemResetBtn").addEventListener("click", async () => {
  const res = await fetch(`${API}/api/scilem/reset`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: Session.wallet }),
  });
  if (res.ok) {
    document.getElementById("scilemChatBox").innerHTML = `<div class="chat-msg ai">🧠 <strong>Scilem has been reset.</strong> Neural weights and context cleared to baseline by Web3 owner.</div>`;
  }
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "analytics") { loadForecast(); loadMap(); loadLeaderboard(); loadTopPapers(); }
    if (btn.dataset.tab === "explorer") loadExplorer();
  });
});

document.querySelectorAll(".subtab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".subtab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".subtab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`subtab-${btn.dataset.subtab}`).classList.add("active");
  });
});

// ---------------------------------------------------------------------------
// ASSESS TAB
// ---------------------------------------------------------------------------
function refreshAssessGate() {
  const warn = document.getElementById("freeTrialWarning");
  const stakeWrap = document.getElementById("stakeCheckboxWrap");
  if (Session.freeEvalsUsed > 0) {
    if (!Session.hasWeb3()) {
      warn.classList.remove("hidden");
      stakeWrap.classList.add("hidden");
    } else {
      warn.classList.add("hidden");
      stakeWrap.classList.remove("hidden");
    }
  } else {
    warn.classList.add("hidden");
    stakeWrap.classList.add("hidden");
  }
}

document.getElementById("pdfFiles").addEventListener("change", (e) => {
  const list = document.getElementById("fileList");
  list.innerHTML = [...e.target.files].map(f => `• ${escapeHtml(f.name)}`).join("<br>");
});

async function loadTotalAnalyzed() {
  try {
    const res = await fetch(`${API}/api/stats/count`);
    const data = await res.json();
    document.getElementById("totalAnalyzed").textContent = data.total_analyzed;
  } catch (e) { /* ignore */ }
}

document.getElementById("runPipelineBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("pdfFiles");
  const doi = document.getElementById("doiInput").value.trim();
  const includeDoi = document.getElementById("includeDoiCheckbox").checked;
  const stakeChecked = document.getElementById("stakeCheckbox").checked;

  if (Session.freeEvalsUsed >= 1 && (!Session.hasWeb3() || !stakeChecked)) {
    alert("Free trial limit reached. Connect Web3 and stake 0.1 piQ.");
    return;
  }
  if (!fileInput.files.length && !(includeDoi && doi)) {
    alert("Please tick at least one source to assess.");
    return;
  }

  const runBtn = document.getElementById("runPipelineBtn");
  runBtn.disabled = true; runBtn.textContent = "Working...";
  const statusBox = document.getElementById("pipelineStatus");
  statusBox.classList.remove("hidden");
  statusBox.innerHTML = `<div class="status-line">Initializing Assessment Pipeline...</div>`;

  const formData = new FormData();
  for (const f of fileInput.files) formData.append("files", f);
  formData.append("doi", doi);
  formData.append("include_doi", includeDoi);
  formData.append("wallet", Session.wallet);
  formData.append("orcid", Session.orcid);

  try {
    const res = await fetch(`${API}/api/assess/stream`, { method: "POST", body: formData });
    if (!res.ok) {
      let detail = `Request failed (HTTP ${res.status}).`;
      try { detail = (await res.json()).detail || detail; } catch (e) { /* body wasn't JSON */ }
      statusBox.innerHTML += `<div class="status-line" style="color:#dc2626;">${escapeHtml(detail)}</div>`;
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let lines = buf.split("\n");
      buf = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        handleStreamLine(JSON.parse(l), statusBox);
      }
    }
    if (buf.trim()) handleStreamLine(JSON.parse(buf), statusBox);
  } catch (e) {
    statusBox.innerHTML += `<div class="status-line" style="color:#dc2626;">Error: ${escapeHtml(String(e))}</div>`;
  } finally {
    runBtn.disabled = false; runBtn.textContent = "Run Assessment Pipeline";
    fileInput.value = "";
    document.getElementById("fileList").innerHTML = "";
    loadTotalAnalyzed();
    renderSidebar();
  }
});

function handleStreamLine(obj, statusBox) {
  if (obj.type === "status") {
    statusBox.innerHTML += `<div class="status-line">${escapeHtml(obj.message)}</div>`;
    statusBox.scrollTop = statusBox.scrollHeight;
  } else if (obj.type === "result") {
    evaluatedBuffer.unshift(obj.item);
    Session.freeEvalsUsed = Session.freeEvalsUsed + 1;
    renderResults();
  } else if (obj.type === "download_error") {
    downloadErrors.unshift(obj);
    renderResults();
  } else if (obj.type === "done") {
    statusBox.innerHTML += `<div class="status-line"><strong>Complete.</strong></div>`;
  }
}

function renderResults() {
  const section = document.getElementById("resultsSection");
  if (!evaluatedBuffer.length && !downloadErrors.length) { section.classList.add("hidden"); return; }
  section.classList.remove("hidden");

  document.getElementById("downloadErrors").innerHTML = downloadErrors.map(err =>
    `<div class="warning-box">Failed DOI: <code>${escapeHtml(err.doi)}</code> (Publisher restricts direct access)</div>`
  ).join("");

  document.getElementById("resultsList").innerHTML = evaluatedBuffer.map((item, idx) => {
    const warnBadge = item.warnings && item.warnings.length ? ` ⚠️ <em>(${item.warnings.length} warning checks active)</em>` : "";
    return `
    <div class="result-card">
      <div>
        <strong>${escapeHtml(item.title)}</strong> — <em>${escapeHtml(item.author_name)}</em>${warnBadge}<br>
        <strong>Score: ${item.score.toFixed(2)} | piQ: ${item.piq}</strong>
      </div>
      <div class="result-actions">
        <button class="btn" onclick="showDetailsModal(${idx})">More Details</button>
        <button class="btn" onclick="showDefenseModal(${idx})">Suggest Defense</button>
        <button class="btn btn-secondary" onclick="removeResult(${idx})">✕</button>
      </div>
    </div>`;
  }).join("");
}

function removeResult(idx) { evaluatedBuffer.splice(idx, 1); renderResults(); }

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
const modalOverlay = document.getElementById("modalOverlay");
document.getElementById("modalClose").addEventListener("click", () => modalOverlay.classList.add("hidden"));
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) modalOverlay.classList.add("hidden"); });

function openModal(html) {
  document.getElementById("modalBody").innerHTML = html;
  modalOverlay.classList.remove("hidden");
}

function showDetailsModal(idx) { renderDossierModal(evaluatedBuffer[idx]); }

function renderDossierModal(item) {
  let html = `<h2>${escapeHtml(item.title)} by ${escapeHtml(item.author_name)}</h2>`;
  html += `<p><strong>Evaluation Hash:</strong> <code>${escapeHtml(item.eval_hash || "0x0")}</code></p>`;
  html += `<p><strong>piQ Minted:</strong> <code>${item.piq ?? 0}</code></p>`;
  if (item.tx_hash) {
    html += `<p><strong>Tx Hash:</strong> <code id="dossier-tx-${item.eval_hash}">${escapeHtml(item.tx_hash)}</code></p>`;
  }
  if (item.zk_proof) html += `<p><strong>zk-SNARK Proof:</strong> <code>${escapeHtml(item.zk_proof)}</code></p>`;

  if (item.warnings && item.warnings.length) {
    html += `<div class="badge-warn">⚠️ Manuscript Flagged with ${item.warnings.length} Warning Check(s):<ul>` +
      item.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("") + `</ul></div>`;
  }

  if (item.consensus_raw && typeof item.consensus_raw === "object") {
    html += `<h3>Multi-LLM Extractions</h3>`;
    for (const key of ["llama", "mistral", "qwen", "gemini", "scilem"]) {
      const data = item.consensus_raw[key];
      if (!data) continue;
      html += `<div class="llm-card"><strong>Model: ${key.toUpperCase()}</strong><br>`;
      if (key === "scilem") {
        html += `Engine Status: Active (Local PyTorch Neural Network)<br>Structural Analysis: ${escapeHtml(data.opinion || "Scilem structural analysis active.")}`;
      } else if (data.api_failed) {
        html += `Status: Rate / Credit Limit Hit<br>Opinion: ${escapeHtml(data.opinion || "No opinion extracted.")}`;
      } else {
        html += `Extracted Title: <code>${escapeHtml(data.title || "N/A")}</code><br>Extracted Authors: <code>${escapeHtml(data.authors || "N/A")}</code><br>Opinion: ${escapeHtml(data.opinion || "No opinion extracted.")}`;
      }
      html += `</div>`;
    }
  }

  if (item.evidence_report_text) {
    html += `<h3>Synthesized Evidence Report</h3><div class="llm-card" style="white-space:pre-wrap;">${escapeHtml(item.evidence_report_text)}</div>`;
  }

  openModal(html);

  if (item.tx_hash) {
    fetch(`${API}/api/explorer/tx-url?tx=${encodeURIComponent(item.tx_hash)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.url) return;
        const el = document.getElementById(`dossier-tx-${item.eval_hash}`);
        if (el) el.innerHTML = `<a href="${d.url}" target="_blank" rel="noopener">${escapeHtml(item.tx_hash)}</a>`;
      })
      .catch(() => {});
  }
}

async function showDefenseModal(idx) {
  const item = evaluatedBuffer[idx];
  openModal(`<h2>AI Peer Review Defense Strategy</h2><p>Synthesizing adversarial defense strategy...</p>`);
  const res = await fetch(`${API}/api/defense-strategy`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scores: item.scores_dict }),
  });
  const data = await res.json();
  openModal(`<h2>AI Peer Review Defense Strategy</h2><p>${escapeHtml(data.strategy)}</p>`);
}

// ---------------------------------------------------------------------------
// ANALYTICS TAB
// ---------------------------------------------------------------------------
let forecastChart = null;

async function loadForecast() {
  const lookback = document.getElementById("lookbackSelect").value;
  const msg = document.getElementById("forecastMsg");
  msg.textContent = "Training Pidyne LSTM...";
  try {
    const res = await fetch(`${API}/api/forecast?lookback=${lookback}`);
    const data = await res.json();
    if (!data.ready) {
      msg.textContent = data.message;
      document.getElementById("criteriaGrid").innerHTML = "";
      if (forecastChart) { forecastChart.destroy(); forecastChart = null; }
      return;
    }
    msg.textContent = `Ledger Forecast (Raw Sum = ${data.raw_sum.toFixed(6)}/8.0)`;

    const ctx = document.getElementById("forecastChart").getContext("2d");
    const labels = data.history.map(h => h.block);
    const criteriaKeys = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
    const colors = ["#38bdf8", "#f97316", "#22c55e", "#a855f7", "#eab308", "#ef4444", "#06b6d4", "#ec4899"];
    const datasets = criteriaKeys.map((k, i) => ({
      label: k, data: data.history.map(h => h[k]), borderColor: colors[i], fill: false, tension: 0.2, pointRadius: 3,
    }));
    if (forecastChart) forecastChart.destroy();
    forecastChart = new Chart(ctx, { type: "line", data: { labels, datasets }, options: { responsive: true, scales: { y: { beginAtZero: true } } } });

    document.getElementById("criteriaGrid").innerHTML = data.criteria.map(c =>
      `<button class="btn" onclick='showCriterionModal(${JSON.stringify(c).replace(/'/g, "&#39;")})'>${c.id}: ${c.weight.toFixed(5)}</button>`
    ).join("");
  } catch (e) {
    msg.textContent = "Error loading forecast.";
  }
}

function showCriterionModal(c) {
  openModal(`<h2>${c.id}: ${escapeHtml(c.title)}</h2><p><strong>Current Epoch Weight:</strong> <code>${c.weight.toFixed(6)}</code></p><p>${escapeHtml(c.description)}</p>`);
}

document.getElementById("runForecastBtn").addEventListener("click", loadForecast);
document.getElementById("lookbackSelect").addEventListener("change", loadForecast);
document.getElementById("mapAuthorFilter").addEventListener("change", loadMap);

let mapNetworkInstance = null;

async function loadMap() {
  const author = document.getElementById("mapAuthorFilter").value;
  try {
    const res = await fetch(`${API}/api/analytics/map?author=${encodeURIComponent(author)}`);
    const data = await res.json();
    const nodes = new vis.DataSet(data.nodes.map(n => ({
      id: n.id, label: "", title: n.title, size: n.size,
      color: { background: n.color, border: "#1a1a1a" }, shape: "dot",
    })));
    const edges = new vis.DataSet(data.edges.map(e => ({ from: e.from, to: e.to, color: "rgba(150,150,150,0.2)" })));
    const container = document.getElementById("mapNetwork");
    const options = {
      physics: { barnesHut: { gravitationalConstant: -3000, centralGravity: 0.15, springLength: 180, springConstant: 0.005, damping: 1.0, avoidOverlap: 2.0 }, stabilization: { iterations: 500 } },
      interaction: { hover: true },
    };
    if (mapNetworkInstance) mapNetworkInstance.destroy();
    mapNetworkInstance = new vis.Network(container, { nodes, edges }, options);

    const tbody = document.querySelector("#mapLegendTable tbody");
    tbody.innerHTML = data.legend.map(row =>
      `<tr><td><span class="color-box" style="background:${row.color};"></span></td><td>${escapeHtml(row.topic)}</td><td>${row.frequency}</td><td>${row.avg_weight}</td></tr>`
    ).join("");
  } catch (e) { /* ignore */ }
}

async function loadLeaderboard() {
  try {
    const res = await fetch(`${API}/api/analytics/leaderboard`);
    const data = await res.json();
    document.getElementById("leaderboardBody").innerHTML = data.rankings.map(r =>
      `<tr><td>${escapeHtml(r.author)}</td><td>${r.piq.toFixed(2)}</td></tr>`
    ).join("");

    const select = document.getElementById("mapAuthorFilter");
    const current = select.value;
    const authorOptions = data.rankings.map(r => r.author);
    select.innerHTML = `<option value="All Authors">All Authors</option>` +
      authorOptions.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
    if (authorOptions.includes(current)) select.value = current;
  } catch (e) { /* ignore */ }
}

async function loadTopPapers() {
  try {
    const res = await fetch(`${API}/api/analytics/top-papers`);
    const data = await res.json();
    document.getElementById("topPapersBody").innerHTML = data.papers.map(p =>
      `<tr><td>${escapeHtml(p.title)}</td><td>${escapeHtml(p.author || "")}</td><td>${(p.score || 0).toFixed(1)}</td></tr>`
    ).join("");
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// EXPLORER TAB
// ---------------------------------------------------------------------------
let explorerDebounce = null;
document.getElementById("explorerSearch").addEventListener("input", () => {
  clearTimeout(explorerDebounce);
  explorerDebounce = setTimeout(loadExplorer, 350);
});

async function loadExplorer() {
  const q = document.getElementById("explorerSearch").value.trim();
  const container = document.getElementById("explorerResults");
  try {
    if (q) {
      const res = await fetch(`${API}/api/explorer/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.records.length) { container.innerHTML = `<div class="warning-box">No matching ledger records found.</div>`; return; }
      container.innerHTML = `<h3>Search Results</h3>` + data.records.map(r => explorerRowHtml(r)).join("");
    } else {
      const res = await fetch(`${API}/api/explorer/latest`);
      const data = await res.json();
      container.innerHTML = `<h3>Latest Assessed Papers</h3><table class="data-table"><thead><tr><th>Title</th><th>Author</th><th>Score</th><th>Hash</th></tr></thead><tbody>` +
        data.records.map(r => `<tr><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.author || "")}</td><td>${(r.score || 0).toFixed(2)}</td><td><code>${escapeHtml((r.eval_hash || "").slice(0, 10))}...</code></td></tr>`).join("") +
        `</tbody></table>`;
    }
  } catch (e) {
    container.innerHTML = `<div class="warning-box">Error loading ledger.</div>`;
  }
}

function explorerRowHtml(r) {
  const id = `dossier_${r.eval_hash}`;
  window[`__dossier_${r.eval_hash}`] = r;
  return `<div class="result-card">
    <div><strong>${escapeHtml(r.title)}</strong> — ${escapeHtml(r.author_name || "")} (Score: ${(r.score || 0).toFixed(2)})<br><code>${escapeHtml(r.eval_hash)}</code></div>
    <div class="result-actions"><button class="btn" onclick='renderDossierModal(window["__dossier_${r.eval_hash}"])'>Full Dossier</button></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
bootstrapFromQueryParams();
renderSidebar();
loadTotalAnalyzed();
