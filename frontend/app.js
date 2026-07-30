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
    if (btn.dataset.tab === "analytics") { initAnalyticsTab(); }
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

// --- Summary stats bar ---
async function loadAnalyticsSummary() {
  try {
    const res = await fetch(`${API}/api/analytics/summary`);
    const data = await res.json();
    document.getElementById("statTotalPapers").textContent = data.total_papers;
    document.getElementById("statTotalPiq").textContent = data.total_piq.toFixed(2);
    document.getElementById("statAvgScore").textContent = data.total_papers ? data.avg_score.toFixed(1) : "–";
    document.getElementById("statUniqueAuthors").textContent = data.unique_authors;
  } catch (e) { /* ignore */ }
}

// --- Map: settings persisted in localStorage, filters kept in memory ---
const MapSettings = {
  get physics() { return localStorage.getItem("sp_map_physics") !== "false"; },
  set physics(v) { localStorage.setItem("sp_map_physics", String(v)); },
  get sizeMode() { return localStorage.getItem("sp_map_size_mode") || "frequency"; },
  set sizeMode(v) { localStorage.setItem("sp_map_size_mode", v); },
  get maxNodes() { return localStorage.getItem("sp_map_max_nodes") || "20"; },
  set maxNodes(v) { localStorage.setItem("sp_map_max_nodes", v); },
};

const mapFilterState = { minScore: 0, maxScore: 100, fields: [] };
let mapNetworkInstance = null;

async function loadMapFieldChecklist() {
  try {
    const res = await fetch(`${API}/api/analytics/fields`);
    const data = await res.json();
    const box = document.getElementById("mapFieldChecklist");
    box.innerHTML = data.fields.map(f => `
      <label class="checkbox-row">
        <input type="checkbox" class="map-field-checkbox" value="${escapeHtml(f)}" checked> ${escapeHtml(f)}
      </label>`).join("");
    mapFilterState.fields = [...data.fields];
    box.querySelectorAll(".map-field-checkbox").forEach(cb => {
      cb.addEventListener("change", () => {
        mapFilterState.fields = [...box.querySelectorAll(".map-field-checkbox:checked")].map(el => el.value);
      });
    });
  } catch (e) { /* ignore */ }
}

function applyMapSettingsToForm() {
  document.getElementById("mapPhysicsToggle").checked = MapSettings.physics;
  document.getElementById("mapSizeMode").value = MapSettings.sizeMode;
  document.getElementById("mapMaxNodes").value = MapSettings.maxNodes;
}

async function loadMap() {
  const author = document.getElementById("mapAuthorFilter").value;
  const minScore = document.getElementById("mapMinScore").value || 0;
  const maxScore = document.getElementById("mapMaxScore").value || 100;
  const fieldsParam = mapFilterState.fields.join(",");
  const maxNodes = document.getElementById("mapMaxNodes").value || 20;

  const emptyState = document.getElementById("mapEmptyState");
  try {
    const qs = new URLSearchParams({
      author, min_score: minScore, max_score: maxScore, fields: fieldsParam, max_nodes: maxNodes,
    });
    const res = await fetch(`${API}/api/analytics/map?${qs}`);
    const data = await res.json();

    if (data.empty) {
      emptyState.classList.remove("hidden");
      if (mapNetworkInstance) { mapNetworkInstance.destroy(); mapNetworkInstance = null; }
      document.querySelector("#mapLegendTable tbody").innerHTML = "";
      return;
    }
    emptyState.classList.add("hidden");

    const sizeMode = document.getElementById("mapSizeMode").value;
    const nodes = new vis.DataSet(data.nodes.map(n => ({
      id: n.id, label: "", title: n.title,
      size: sizeMode === "avg_score" ? Math.max(20, 15 + n.avg_score * 0.3) : n.size,
      color: { background: n.color, border: "#1a1a1a" }, shape: "dot",
    })));
    const edges = new vis.DataSet(data.edges.map(e => ({ from: e.from, to: e.to, color: "rgba(150,150,150,0.2)" })));
    const container = document.getElementById("mapNetwork");
    const physicsOn = document.getElementById("mapPhysicsToggle").checked;
    const options = {
      physics: physicsOn
        ? { barnesHut: { gravitationalConstant: -3000, centralGravity: 0.15, springLength: 180, springConstant: 0.005, damping: 1.0, avoidOverlap: 2.0 }, stabilization: { iterations: 500 } }
        : false,
      interaction: { hover: true },
    };
    if (mapNetworkInstance) mapNetworkInstance.destroy();
    mapNetworkInstance = new vis.Network(container, { nodes, edges }, options);

    const tbody = document.querySelector("#mapLegendTable tbody");
    tbody.innerHTML = data.legend.map(row =>
      `<tr class="legend-row" data-topic="${escapeHtml(row.topic)}">
        <td><span class="color-box" style="background:${row.color};"></span></td>
        <td>${escapeHtml(row.topic)}</td><td>${row.frequency}</td><td>${row.avg_weight}</td>
      </tr>`
    ).join("");
    tbody.querySelectorAll(".legend-row").forEach(tr => {
      tr.addEventListener("click", () => {
        const topic = tr.dataset.topic;
        if (!mapNetworkInstance) return;
        mapNetworkInstance.selectNodes([topic]);
        mapNetworkInstance.focus(topic, { scale: 1.4, animation: { duration: 400 } });
      });
    });
  } catch (e) { /* ignore */ }
}

document.getElementById("mapAuthorFilter").addEventListener("change", loadMap);
document.getElementById("mapApplyFiltersBtn").addEventListener("click", loadMap);
document.getElementById("mapPhysicsToggle").addEventListener("change", (e) => {
  MapSettings.physics = e.target.checked;
  loadMap();
});
document.getElementById("mapSizeMode").addEventListener("change", (e) => {
  MapSettings.sizeMode = e.target.value;
  loadMap();
});
document.getElementById("mapMaxNodes").addEventListener("change", (e) => {
  MapSettings.maxNodes = e.target.value;
  loadMap();
});

// --- Leaderboard: search, sort, pagination ---
const leaderboardState = { q: "", sort: "piq", order: "desc", limit: 10, offset: 0, total: 0 };
let leaderboardDebounce = null;

function renderSortIndicators(theadSelector, state) {
  document.querySelectorAll(`${theadSelector} th[data-sort]`).forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.sort === state.sort) th.classList.add(state.order === "asc" ? "sorted-asc" : "sorted-desc");
  });
}

function renderPagination(containerId, state, reload) {
  const el = document.getElementById(containerId);
  const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
  const currentPage = Math.floor(state.offset / state.limit) + 1;
  el.innerHTML = `
    <button class="btn" id="${containerId}-prev" ${currentPage <= 1 ? "disabled" : ""}>‹ Prev</button>
    <span class="page-indicator">Page ${currentPage} of ${totalPages} (${state.total} total)</span>
    <button class="btn" id="${containerId}-next" ${currentPage >= totalPages ? "disabled" : ""}>Next ›</button>
  `;
  document.getElementById(`${containerId}-prev`).addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - state.limit);
    reload();
  });
  document.getElementById(`${containerId}-next`).addEventListener("click", () => {
    if (state.offset + state.limit < state.total) { state.offset += state.limit; reload(); }
  });
}

async function loadLeaderboard() {
  try {
    const qs = new URLSearchParams({
      q: leaderboardState.q, sort: leaderboardState.sort, order: leaderboardState.order,
      limit: leaderboardState.limit, offset: leaderboardState.offset,
    });
    const res = await fetch(`${API}/api/analytics/leaderboard?${qs}`);
    const data = await res.json();
    leaderboardState.total = data.total;

    document.getElementById("leaderboardBody").innerHTML = data.rankings.length
      ? data.rankings.map(r =>
          `<tr><td>${escapeHtml(r.author)}</td><td>${r.piq.toFixed(2)}</td><td>${r.papers}</td><td>${r.avg_score.toFixed(1)}</td></tr>`
        ).join("")
      : `<tr><td colspan="4" class="hint">No authors match this search.</td></tr>`;

    renderSortIndicators("#leaderboardTable thead", leaderboardState);
    renderPagination("leaderboardPagination", leaderboardState, loadLeaderboard);

    // Keep the map's author filter populated from an unfiltered, unpaginated view
    if (!leaderboardState.q && leaderboardState.offset === 0) {
      const select = document.getElementById("mapAuthorFilter");
      const current = select.value;
      const authorOptions = data.rankings.map(r => r.author);
      select.innerHTML = `<option value="All Authors">All Authors</option>` +
        authorOptions.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
      if (authorOptions.includes(current)) select.value = current;
    }
  } catch (e) { /* ignore */ }
}

document.querySelectorAll("#leaderboardTable thead th[data-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.sort;
    if (leaderboardState.sort === col) {
      leaderboardState.order = leaderboardState.order === "asc" ? "desc" : "asc";
    } else {
      leaderboardState.sort = col;
      leaderboardState.order = "desc";
    }
    leaderboardState.offset = 0;
    loadLeaderboard();
  });
});
document.getElementById("leaderboardSearch").addEventListener("input", (e) => {
  clearTimeout(leaderboardDebounce);
  leaderboardDebounce = setTimeout(() => {
    leaderboardState.q = e.target.value.trim();
    leaderboardState.offset = 0;
    loadLeaderboard();
  }, 350);
});

// --- Top Papers: search, score filter, sort, pagination ---
const topPapersState = { q: "", minScore: 0, sort: "score", order: "desc", limit: 10, offset: 0, total: 0 };
let topPapersDebounce = null;

async function loadTopPapers() {
  try {
    const qs = new URLSearchParams({
      q: topPapersState.q, min_score: topPapersState.minScore, max_score: 100,
      sort: topPapersState.sort, order: topPapersState.order,
      limit: topPapersState.limit, offset: topPapersState.offset,
    });
    const res = await fetch(`${API}/api/analytics/top-papers?${qs}`);
    const data = await res.json();
    topPapersState.total = data.total;

    document.getElementById("topPapersBody").innerHTML = data.papers.length
      ? data.papers.map((p, idx) => `
          <tr class="clickable-row" data-hash="${escapeHtml(p.eval_hash || "")}">
            <td>${escapeHtml(p.title)}</td>
            <td>${escapeHtml(p.author || "")}</td>
            <td>${(p.score || 0).toFixed(1)}</td>
            <td>${(p.piq || 0).toFixed(2)}</td>
            <td>${(p.logic_score || 0).toFixed(1)}</td>
            <td>${p.date ? new Date(p.date).toLocaleDateString() : ""}</td>
          </tr>`
        ).join("")
      : `<tr><td colspan="6" class="hint">No papers match these filters.</td></tr>`;

    document.querySelectorAll("#topPapersBody .clickable-row").forEach(tr => {
      tr.addEventListener("click", async () => {
        const hash = tr.dataset.hash;
        if (!hash) return;
        try {
          const r = await fetch(`${API}/api/explorer/dossier/${encodeURIComponent(hash)}`);
          if (!r.ok) return;
          const dossier = await r.json();
          renderDossierModal({
            title: dossier.title, author_name: dossier.author_name, eval_hash: dossier.eval_hash,
            piq: dossier.piq, tx_hash: dossier.tx_hash, zk_proof: dossier.zk_proof,
            warnings: [], consensus_raw: dossier.consensus_raw, evidence_report_text: dossier.evidence_report_text,
          });
        } catch (e) { /* ignore */ }
      });
    });

    renderSortIndicators("#topPapersTable thead", topPapersState);
    renderPagination("topPapersPagination", topPapersState, loadTopPapers);
  } catch (e) { /* ignore */ }
}

document.querySelectorAll("#topPapersTable thead th[data-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.sort;
    if (col === "none") return;
    if (topPapersState.sort === col) {
      topPapersState.order = topPapersState.order === "asc" ? "desc" : "asc";
    } else {
      topPapersState.sort = col;
      topPapersState.order = "desc";
    }
    topPapersState.offset = 0;
    loadTopPapers();
  });
});
document.getElementById("topPapersSearch").addEventListener("input", (e) => {
  clearTimeout(topPapersDebounce);
  topPapersDebounce = setTimeout(() => {
    topPapersState.q = e.target.value.trim();
    topPapersState.offset = 0;
    loadTopPapers();
  }, 350);
});
document.getElementById("topPapersMinScore").addEventListener("input", (e) => {
  clearTimeout(topPapersDebounce);
  topPapersDebounce = setTimeout(() => {
    topPapersState.minScore = e.target.value ? Number(e.target.value) : 0;
    topPapersState.offset = 0;
    loadTopPapers();
  }, 350);
});

async function initAnalyticsTab() {
  applyMapSettingsToForm();
  await loadMapFieldChecklist();
  loadAnalyticsSummary();
  loadForecast();
  loadLeaderboard();
  loadTopPapers();
  loadMap();
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
