// quvi.js — the editor and inspectors for the QuVI web port.
import * as E from "./engine.js";
import { EXAMPLES } from "./examples.js";

const $ = id => document.getElementById(id);
const MIN_COLS = 10, MAX_COLS = 40;

// ------------------------------------------------------------ access
// Shown publicly only once the author has approved (the server's
// QUVI_PUBLIC flag); until then, only the signed-in owner sees it.
async function allowed() {
  try {
    const f = await (await fetch("/api/lab/features", { cache: "no-store" })).json();
    if (f.quvi_public) return true;
  } catch (_) { /* fall through to the owner check */ }
  let token = "";
  try { token = localStorage.getItem("sp_token") || ""; } catch (_) { /* storage blocked */ }
  if (!token) return false;
  try {
    const r = await fetch("/api/auth/session", { cache: "no-store", headers: { Authorization: "Bearer " + token } });
    return r.ok && (await r.json()).is_owner === true;
  } catch (_) { return false; }
}

// ------------------------------------------------------------ state
let n = 2;
let circuit = [];            // columns, each an array of n cells
let tool = { op: "H" };
let step = 0;                // number of columns applied for inspection
let tab = "prob";
let seed = 1;

function rng(s) {             // mulberry32: measurements stay put while stepping
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOOLS = [
  { op: "H", label: "H", title: "Hadamard" },
  { op: "X", label: "X", title: "Pauli-X (NOT)" },
  { op: "Y", label: "Y", title: "Pauli-Y" },
  { op: "Z", label: "Z", title: "Pauli-Z" },
  { op: "S", label: "S", title: "S gate (√Z)" },
  { op: "T", label: "T", title: "T gate (fourth root of Z)" },
  { op: "I", label: "I", title: "Identity" },
  null,
  { op: "P", label: "P", title: "Phase(θ)", angle: true },
  { op: "RX", label: "RX", title: "Rotation about X by θ", angle: true },
  { op: "RY", label: "RY", title: "Rotation about Y by θ", angle: true },
  { op: "RZ", label: "RZ", title: "Rotation about Z by θ", angle: true },
  null,
  { op: "C", label: '<span class="dot"></span>Control', title: "Control: the column's gates act when this qubit is 1" },
  { op: "A", label: '<span class="ring"></span>Anti-control', title: "Anti-control: act when this qubit is 0" },
  { op: "SW", label: "× Swap", title: "Swap: place on two wires in the same column" },
  { op: "M", label: "Measure", title: "Measure in Z" },
  null,
  { op: "ERASE", label: "Erase", title: "Remove gates" },
];

// ------------------------------------------------------------ editing
function emptyCol() { return Array.from({ length: n }, () => null); }
function trim() {
  while (circuit.length && circuit[circuit.length - 1].every(c => !c)) circuit.pop();
}
function sameCell(a, b) { return a && b && a.op === b.op && (a.theta ?? null) === (b.theta ?? null); }

function place(colIdx, q) {
  while (circuit.length <= colIdx) circuit.push(emptyCol());
  const column = circuit[colIdx];
  if (tool.op === "ERASE" || sameCell(column[q], toolCell())) column[q] = null;
  else {
    if (tool.op === "SW") {
      const others = column.map((c, k) => (c && c.op === "SW" && k !== q ? k : -1)).filter(k => k >= 0);
      if (others.length >= 2) { hint("A column can swap only two wires. Remove one × first."); return; }
    }
    column[q] = toolCell();
  }
  trim();
  step = circuit.length;
  $("example").value = "";
  $("exNote").textContent = "";
  render();
}

function toolCell() {
  const t = TOOLS.find(t => t && t.op === tool.op);
  if (t && t.angle) return { op: tool.op, theta: (parseFloat($("angle").value) || 0) * Math.PI };
  return { op: tool.op };
}

function hint(text) {
  $("toolHint").textContent = text;
  clearTimeout(hint.t);
  hint.t = setTimeout(() => { $("toolHint").textContent = "Pick a gate, then click a spot on a wire. Click a placed gate to remove it."; }, 3500);
}

function setQubits(k) {
  k = Math.max(1, Math.min(E.MAX_QUBITS, k));
  if (k === n) return;
  circuit = circuit.map(colm => Array.from({ length: k }, (_, q) => (q < colm.length ? colm[q] : null)));
  n = k;
  trim();
  step = Math.min(step, circuit.length) || circuit.length;
  render();
}

function loadExample(key) {
  const ex = EXAMPLES[key];
  if (!ex) { circuit = []; $("exNote").textContent = ""; step = 0; render(); return; }
  n = ex.n;
  circuit = ex.circuit.map(colm => colm.map(c => (c ? { ...c } : null)));
  step = circuit.length;
  $("exNote").textContent = ex.note;
  render();
}

// ------------------------------------------------------------ rendering: palette + diagram
function renderTools() {
  $("tools").innerHTML = "";
  for (const t of TOOLS) {
    if (!t) { const s = document.createElement("span"); s.className = "sep"; $("tools").appendChild(s); continue; }
    const b = document.createElement("button");
    b.type = "button"; b.className = "tool"; b.innerHTML = t.label; b.title = t.title;
    b.setAttribute("aria-label", t.title);
    b.setAttribute("aria-pressed", String(tool.op === t.op));
    b.addEventListener("click", () => { tool = { op: t.op }; renderTools(); $("angleWrap").hidden = !t.angle; });
    $("tools").appendChild(b);
  }
}

function cellLabel(cell) {
  if (!cell.theta && cell.theta !== 0) return cell.op;
  const k = cell.theta / Math.PI;
  const s = Math.abs(k - Math.round(k * 1000) / 1000) < 1e-9 ? String(Math.round(k * 1000) / 1000) : k.toFixed(3);
  return cell.op + "<small>" + s + "π</small>";
}

const METER = '<svg viewBox="0 0 36 36" aria-hidden="true"><path d="M8 25 A11 11 0 0 1 28 25" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="18" y1="26" x2="25" y2="13" stroke="currentColor" stroke-width="1.6"/></svg>';

function renderDiagram() {
  const d = $("diagram");
  const cols = Math.min(MAX_COLS, Math.max(MIN_COLS, circuit.length + 1));
  d.style.gridTemplateColumns = "max-content repeat(" + cols + ", var(--cell))";
  d.innerHTML = "";
  // column headers: click to inspect up to that step
  d.appendChild(document.createElement("span"));
  for (let c = 0; c < cols; c++) {
    const h = document.createElement("button");
    h.type = "button"; h.className = "colhead" + (c + 1 === step ? " at" : "");
    h.textContent = c < circuit.length ? String(c + 1) : "";
    h.title = c < circuit.length ? "Inspect after step " + (c + 1) : "";
    if (c < circuit.length) h.addEventListener("click", () => { step = c + 1; renderInspect(); renderDiagramState(); });
    d.appendChild(h);
  }
  for (let q = 0; q < n; q++) {
    const lab = document.createElement("span");
    lab.className = "wire-label"; lab.textContent = "q" + q + "  |0⟩";
    d.appendChild(lab);
    for (let c = 0; c < cols; c++) {
      const cell = circuit[c] && circuit[c][q];
      const b = document.createElement("button");
      b.type = "button"; b.className = "cell"; b.dataset.col = c; b.dataset.q = q;
      b.setAttribute("aria-label", "q" + q + ", step " + (c + 1) + (cell ? ": " + cell.op : ": empty"));
      let inner = '<span class="slot"></span>';
      if (cell) {
        if (cell.op === "C") inner += '<span class="ctrl"></span>';
        else if (cell.op === "A") inner += '<span class="ctrl actrl"></span>';
        else if (cell.op === "SW") inner += '<span class="swapx">×</span>';
        else if (cell.op === "M") inner += '<span class="meter">' + METER + "</span>";
        else inner += '<span class="gate">' + cellLabel(cell) + "</span>";
      }
      b.innerHTML = inner;
      b.addEventListener("click", () => place(c, q));
      d.appendChild(b);
    }
  }
  drawLinks();
  renderDiagramState();
}

// Vertical connectors for columns that join wires (controls, swaps).
function drawLinks() {
  const d = $("diagram");
  d.querySelectorAll(".link").forEach(l => l.remove());
  circuit.forEach((colm, c) => {
    const joined = colm.map((cell, q) => (cell && (cell.op === "C" || cell.op === "A" || cell.op === "SW") ? q : -1)).filter(q => q >= 0);
    const acted = colm.map((cell, q) => (cell && !["C", "A", "M"].includes(cell.op) ? q : -1)).filter(q => q >= 0);
    if (!joined.length || joined.length + acted.length < 2) return;
    const wires = [...new Set([...joined, ...acted])];
    const top = d.querySelector('.cell[data-col="' + c + '"][data-q="' + Math.min(...wires) + '"]');
    const bot = d.querySelector('.cell[data-col="' + c + '"][data-q="' + Math.max(...wires) + '"]');
    if (!top || !bot) return;
    const link = document.createElement("span");
    link.className = "link"; link.dataset.col = c;
    link.style.left = (top.offsetLeft + top.offsetWidth / 2 - 0.75) + "px";
    link.style.top = (top.offsetTop + top.offsetHeight / 2) + "px";
    link.style.height = (bot.offsetTop - top.offsetTop) + "px";
    d.appendChild(link);
  });
}

function renderDiagramState() {
  $("diagram").querySelectorAll(".cell, .link").forEach(el => el.classList.toggle("future", +el.dataset.col >= step));
  $("diagram").querySelectorAll(".colhead").forEach((h, i) => h.classList.toggle("at", i + 1 === step));
  $("step").max = String(circuit.length);
  $("step").value = String(step);
  $("stepOut").textContent = step + " of " + circuit.length;
}

// ------------------------------------------------------------ rendering: inspectors
const fixed = (x, d = 3) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(d);

function renderInspect() {
  const { state, measurements } = E.run(circuit, n, step, rng(seed));
  const p = E.probabilities(state);
  const panel = $("panel");
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));

  if (tab === "prob") {
    const rows = p.map((v, i) => [i, v]).filter(([, v]) => p.length <= 16 || v > 1e-9);
    panel.innerHTML = '<div class="bars">' + rows.map(([i, v]) =>
      '<span class="k">|' + E.basisLabel(i, n) + '⟩</span><span class="track"><span class="fill" style="width:' + (v * 100).toFixed(2) +
      '%"></span></span><span class="v">' + (v * 100).toFixed(1) + "%</span>").join("") + "</div>" +
      (p.length > 16 ? '<p class="muted">Showing the ' + rows.length + " outcomes with non-zero probability.</p>" : "");
  } else if (tab === "state") {
    const rows = state.map((a, i) => [i, a]).filter(([, a]) => state.length <= 16 || a.re * a.re + a.im * a.im > 1e-12);
    panel.innerHTML = '<table class="sv"><thead><tr><th>Basis</th><th>Amplitude</th><th>|a|</th><th>Phase</th></tr></thead><tbody>' +
      rows.map(([i, a]) => {
        const mag = Math.hypot(a.re, a.im), ph = mag > 1e-9 ? Math.atan2(a.im, a.re) : 0;
        return "<tr><td class=\"mono\">|" + E.basisLabel(i, n) + "⟩</td><td class=\"mono\">" + E.fmt(a) + "</td><td>" + fixed(mag) +
          "</td><td>" + (mag > 1e-9 ? phaseDial(ph) + " " + fixed(ph / Math.PI, 3) + "π" : '<span class="muted">—</span>') + "</td></tr>";
      }).join("") + "</tbody></table>";
  } else if (tab === "bloch") {
    panel.innerHTML = '<div class="blochs">' + Array.from({ length: n }, (_, q) => {
      const rho = E.reducedDensity1(state, n, q), b = E.blochVector(rho), r = Math.hypot(b.x, b.y, b.z);
      return '<figure class="bloch">' + blochSVG(b) + '<figcaption class="cap"><b>q' + q + "</b> · x " + fixed(b.x, 2) + ", y " + fixed(b.y, 2) +
        ", z " + fixed(b.z, 2) + "<br>" + (r < 0.999 ? "mixed (|r| = " + fixed(r, 2) + "): entangled with other qubits" : "pure state") + "</figcaption></figure>";
    }).join("") + "</div>";
  } else if (tab === "rho") {
    const reduced = Array.from({ length: n }, (_, q) => {
      const rho = E.reducedDensity1(state, n, q);
      return "<div><div class=\"heat small\" style=\"grid-template-columns:repeat(2,40px)\">" +
        [rho[0][0], rho[0][1], rho[1][0], rho[1][1]].map(z => heatCell(z, true)).join("") +
        '</div><p class="rho-cap">Reduced ρ of q' + q + "</p></div>";
    }).join("");
    let full = "";
    if (n <= 4) {
      const R = E.densityMatrix(state), N = R.length;
      full = '<div><div class="heat" style="grid-template-columns:repeat(' + N + ',22px)">' + R.flat().map(z => heatCell(z, false)).join("") +
        '</div><p class="rho-cap">Full density matrix |ψ⟩⟨ψ|, ' + N + "×" + N + ". Shade shows |ρᵢⱼ|; hover for the value.</p></div>";
    } else full = '<p class="muted">The full matrix is shown for up to 4 qubits.</p>';
    panel.innerHTML = '<div class="rho-wrap">' + full + reduced + "</div>";
  } else {
    panel.innerHTML = '<table class="sv"><thead><tr><th>Qubit</th><th>P(1)</th><th>Entropy S (bits)</th><th>Purity</th><th>Reading</th></tr></thead><tbody>' +
      Array.from({ length: n }, (_, q) => {
        const rho = E.reducedDensity1(state, n, q), S = E.entropy1(rho);
        const reading = S > 0.999 ? "maximally entangled" : S > 1e-6 ? "partly entangled" : "independent of the rest";
        return "<tr><td>q" + q + "</td><td>" + fixed(E.probabilityOfOne(state, n, q)) + "</td><td>" + fixed(S) + "</td><td>" + fixed(E.purity1(rho)) + "</td><td>" + reading + "</td></tr>";
      }).join("") + "</tbody></table><p class=\"muted\">Von Neumann entropy of each qubit's reduced state: 0 means it can be described on its own, 1 means it is fully entangled with the others.</p>";
  }
  $("measured").textContent = measurements.length
    ? "Measured: " + measurements.map(m => "q" + m.qubit + " → " + m.outcome).join(", ") + ". Results are random; “Measure again” samples new ones."
    : "";
}

function heatCell(z, label) {
  const m = Math.min(1, Math.hypot(z.re, z.im));
  const style = "background: rgba(47,64,232," + (m * 0.92).toFixed(3) + ")" + (label && m > 0.5 ? ";color:#fff" : "");
  return '<div style="' + style + '" title="' + E.fmt(z) + '">' + (label ? fixed(m, 2) : "") + "</div>";
}

function phaseDial(ph) {
  const x = 7 + 6 * Math.cos(ph), y = 7 - 6 * Math.sin(ph);
  return '<svg class="phase" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="none" stroke="#c9c9c4"/><line x1="7" y1="7" x2="' +
    x.toFixed(2) + '" y2="' + y.toFixed(2) + '" stroke="#2f40e8" stroke-width="1.6"/></svg>';
}

// A Bloch sphere, drawn with a fixed oblique camera. Vectors shorter than 1
// (mixed states) end inside the sphere.
function blochSVG({ x, y, z }) {
  const R = 72, cx = 95, cy = 95, az = -Math.PI / 6, el = Math.PI / 9;
  const proj = (X, Y, Z) => {
    const x1 = X * Math.cos(az) - Y * Math.sin(az), y1 = X * Math.sin(az) + Y * Math.cos(az);
    return { sx: cx + R * y1, sy: cy - R * (Z * Math.cos(el) - x1 * Math.sin(el)), front: x1 > 0 };
  };
  let eqFront = "", eqBack = "";
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * 2 * Math.PI, P = proj(Math.cos(a), Math.sin(a), 0);
    const seg = (P.front ? eqFront : eqBack) ? " L" : " M";
    if (P.front) eqFront += seg + P.sx.toFixed(1) + " " + P.sy.toFixed(1); else eqBack += seg + P.sx.toFixed(1) + " " + P.sy.toFixed(1);
  }
  const ax = (X, Y, Z, t, dx = 0, dy = 0) => {
    const P = proj(X, Y, Z), Q = proj(-X, -Y, -Z);
    return '<line x1="' + Q.sx + '" y1="' + Q.sy + '" x2="' + P.sx + '" y2="' + P.sy + '" stroke="#dcdcd8"/>' +
      (t ? '<text x="' + (P.sx + dx) + '" y="' + (P.sy + dy) + '" font-size="11" fill="#6e6e6a" text-anchor="middle">' + t + "</text>" : "");
  };
  const tip = proj(x, y, z), o = proj(0, 0, 0), bottom = proj(0, 0, -1);
  return '<svg viewBox="0 0 190 190" role="img" aria-label="Bloch vector x ' + fixed(x, 2) + ", y " + fixed(y, 2) + ", z " + fixed(z, 2) + '">' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="#c9c9c4"/>' +
    '<path d="' + eqBack.trim() + '" fill="none" stroke="#dcdcd8" stroke-dasharray="3 3"/>' +
    '<path d="' + eqFront.trim() + '" fill="none" stroke="#c9c9c4"/>' +
    ax(1, 0, 0, "x", -8, 10) + ax(0, 1, 0, "y", 10, 4) + ax(0, 0, 1, "|0⟩", 0, -6) +
    '<text x="' + bottom.sx + '" y="' + (bottom.sy + 14) + '" font-size="11" fill="#6e6e6a" text-anchor="middle">|1⟩</text>' +
    '<line x1="' + o.sx + '" y1="' + o.sy + '" x2="' + tip.sx.toFixed(1) + '" y2="' + tip.sy.toFixed(1) + '" stroke="#191919" stroke-width="2"/>' +
    '<circle cx="' + tip.sx.toFixed(1) + '" cy="' + tip.sy.toFixed(1) + '" r="5" fill="#2f40e8"/>' +
    '<circle cx="' + o.sx + '" cy="' + o.sy + '" r="2" fill="#191919"/></svg>';
}

function render() {
  $("qCount").textContent = String(n);
  $("qMinus").disabled = n <= 1; $("qPlus").disabled = n >= E.MAX_QUBITS;
  renderTools();
  renderDiagram();
  renderInspect();
}

// ------------------------------------------------------------ start
async function main() {
  if (!(await allowed())) {
    $("gate").hidden = false;
    $("gate").innerHTML = "<h2>Coming to the Lab</h2><p>This experiment is a browser version of QuVI, a quantum circuit toolkit by Murtaza Vefadar. " +
      "It will open here once the author has reviewed it.</p><p>Read his paper: <a href=\"https://arxiv.org/abs/2602.00643\" target=\"_blank\" rel=\"noopener\">From Block Diagrams to Bloch Spheres</a>.</p>";
    return;
  }
  $("app").hidden = false;
  for (const [key, ex] of Object.entries(EXAMPLES)) {
    const o = document.createElement("option"); o.value = key; o.textContent = ex.name; $("example").appendChild(o);
  }
  $("example").addEventListener("change", e => loadExample(e.target.value));
  $("qMinus").addEventListener("click", () => setQubits(n - 1));
  $("qPlus").addEventListener("click", () => setQubits(n + 1));
  $("clear").addEventListener("click", () => { $("example").value = ""; loadExample(""); });
  $("rerun").addEventListener("click", () => { seed = (seed * 48271) % 2147483647 || 1; renderInspect(); });
  $("step").addEventListener("input", e => { step = +e.target.value; renderInspect(); renderDiagramState(); });
  document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; renderInspect(); }));
  window.addEventListener("resize", () => drawLinks());
  $("example").value = "bell";
  loadExample("bell");
}
main();
