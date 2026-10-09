// engine.js — a state-vector quantum circuit simulator for the web port of QuVI.
//
// QuVI (Murtaza Vefadar, MIT licence; see LICENSE-QuVI.txt) is a LabVIEW
// toolkit: qubits are wires, gates are VIs dropped on a timeline, and an
// Inspect VI reads probabilities, the state vector, Bloch spheres, density
// matrices and entropy off the end. LabVIEW cannot run in a browser, so this is
// an independent implementation of the same model, not a translation of his VIs.
//
// Conventions
//   * Qubit 0 is the top wire. Basis labels are written q0 q1 … q(n-1), so
//     |01⟩ means q0 = 0, q1 = 1. Index bit for qubit k is (n-1-k).
//   * A circuit is a list of columns. Each column holds one cell per wire:
//       null                         nothing on this wire
//       {op:"I"|"X"|"Y"|"Z"|"H"|"S"|"T"}
//       {op:"P"|"RX"|"RY"|"RZ", theta}   angle in radians
//       {op:"C"}   control: the column's gates act only where this qubit is 1
//       {op:"A"}   anti-control: … only where this qubit is 0
//       {op:"SW"}  swap: exactly two per column swap those wires
//       {op:"M"}   measure in Z, collapsing the state; result recorded
//     Controls apply to every gate and swap in their column, as in QuVI's
//     ^Control / vControl and ^AControl / vAControl VIs.

export const MAX_QUBITS = 6;

// ------------------------------------------------------------ complex helpers
const c = (re, im = 0) => ({ re, im });
const cmul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cadd = (a, b) => c(a.re + b.re, a.im + b.im);
const cconj = a => c(a.re, -a.im);
const cabs2 = a => a.re * a.re + a.im * a.im;

// 2x2 matrices as [[a,b],[c,d]] of complex numbers
const S2 = Math.SQRT1_2;
export function gateMatrix(op, theta = 0) {
  const t2 = theta / 2;
  switch (op) {
    case "I": return [[c(1), c(0)], [c(0), c(1)]];
    case "X": return [[c(0), c(1)], [c(1), c(0)]];
    case "Y": return [[c(0), c(0, -1)], [c(0, 1), c(0)]];
    case "Z": return [[c(1), c(0)], [c(0), c(-1)]];
    case "H": return [[c(S2), c(S2)], [c(S2), c(-S2)]];
    case "S": return [[c(1), c(0)], [c(0), c(0, 1)]];
    case "T": return [[c(1), c(0)], [c(0), c(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4))]];
    case "P": return [[c(1), c(0)], [c(0), c(Math.cos(theta), Math.sin(theta))]];
    case "RX": return [[c(Math.cos(t2)), c(0, -Math.sin(t2))], [c(0, -Math.sin(t2)), c(Math.cos(t2))]];
    case "RY": return [[c(Math.cos(t2)), c(-Math.sin(t2))], [c(Math.sin(t2)), c(Math.cos(t2))]];
    case "RZ": return [[c(Math.cos(t2), -Math.sin(t2)), c(0)], [c(0), c(Math.cos(t2), Math.sin(t2))]];
    default: throw new Error("unknown gate " + op);
  }
}

export function zeroState(n) {
  const v = Array.from({ length: 1 << n }, () => c(0));
  v[0] = c(1);
  return v;
}

const bitOf = (n, k) => 1 << (n - 1 - k);

function controlsMatch(index, n, controls) {
  for (const [k, pol] of controls) if (((index & bitOf(n, k)) !== 0) !== (pol === 1)) return false;
  return true;
}

export function applyGate(state, n, target, m, controls = []) {
  const tb = bitOf(n, target);
  for (let i = 0; i < state.length; i++) {
    if (i & tb) continue;                      // visit each pair once, from its |0⟩ member
    if (!controlsMatch(i, n, controls)) continue;
    const j = i | tb, a = state[i], b = state[j];
    state[i] = cadd(cmul(m[0][0], a), cmul(m[0][1], b));
    state[j] = cadd(cmul(m[1][0], a), cmul(m[1][1], b));
  }
}

export function applySwap(state, n, q1, q2, controls = []) {
  const b1 = bitOf(n, q1), b2 = bitOf(n, q2);
  for (let i = 0; i < state.length; i++) {
    if ((i & b1) && !(i & b2) && controlsMatch(i, n, controls)) {
      const j = (i & ~b1) | b2;
      const t = state[i]; state[i] = state[j]; state[j] = t;
    }
  }
}

export function probabilityOfOne(state, n, k) {
  const b = bitOf(n, k);
  let p = 0;
  for (let i = 0; i < state.length; i++) if (i & b) p += cabs2(state[i]);
  return p;
}

// Projective Z measurement. `rand` is injectable so tests are deterministic.
export function measure(state, n, k, rand = Math.random) {
  const p1 = probabilityOfOne(state, n, k);
  const outcome = rand() < p1 ? 1 : 0;
  const norm = Math.sqrt(outcome ? p1 : 1 - p1) || 1;
  const b = bitOf(n, k);
  for (let i = 0; i < state.length; i++) {
    const isOne = (i & b) !== 0;
    state[i] = isOne === (outcome === 1) ? c(state[i].re / norm, state[i].im / norm) : c(0);
  }
  return outcome;
}

// Run columns [0, upto) of a circuit. Returns the state and measurement record.
export function run(circuit, n, upto = circuit.length, rand = Math.random) {
  const state = zeroState(n);
  const measurements = [];
  for (let col = 0; col < Math.min(upto, circuit.length); col++) {
    const cells = circuit[col] || [];
    const controls = [], swaps = [], gates = [], meas = [];
    for (let k = 0; k < n; k++) {
      const cell = cells[k];
      if (!cell) continue;
      if (cell.op === "C") controls.push([k, 1]);
      else if (cell.op === "A") controls.push([k, 0]);
      else if (cell.op === "SW") swaps.push(k);
      else if (cell.op === "M") meas.push(k);
      else gates.push([k, cell]);
    }
    for (const [k, cell] of gates) applyGate(state, n, k, gateMatrix(cell.op, cell.theta), controls);
    if (swaps.length === 2) applySwap(state, n, swaps[0], swaps[1], controls);
    for (const k of meas) measurements.push({ column: col, qubit: k, outcome: measure(state, n, k, rand) });
  }
  return { state, measurements };
}

// ------------------------------------------------------------ inspection
export const basisLabel = (i, n) => i.toString(2).padStart(n, "0");

export function probabilities(state) { return state.map(cabs2); }

// Reduced density matrix of one qubit: trace out every other wire.
export function reducedDensity1(state, n, k) {
  const b = bitOf(n, k);
  let r00 = 0, r11 = 0, r01 = c(0);
  for (let i = 0; i < state.length; i++) {
    if (i & b) continue;
    const a0 = state[i], a1 = state[i | b];
    r00 += cabs2(a0); r11 += cabs2(a1);
    r01 = cadd(r01, cmul(a0, cconj(a1)));
  }
  return [[c(r00), r01], [cconj(r01), c(r11)]];
}

// Bloch vector from a 2x2 density matrix: x = 2 Re ρ01, y = -2 Im ρ01, z = ρ00 - ρ11.
export function blochVector(rho) {
  return { x: 2 * rho[0][1].re, y: -2 * rho[0][1].im, z: rho[0][0].re - rho[1][1].re };
}

// Von Neumann entropy (bits) of a single-qubit reduced state, from its
// eigenvalues (1 ± |r|)/2. 0 for a product qubit, 1 when maximally entangled.
export function entropy1(rho) {
  const { x, y, z } = blochVector(rho);
  const r = Math.min(1, Math.sqrt(x * x + y * y + z * z));
  const h = p => (p <= 1e-12 ? 0 : -p * Math.log2(p));
  return h((1 + r) / 2) + h((1 - r) / 2);
}

export function purity1(rho) {
  const { x, y, z } = blochVector(rho);
  return (1 + x * x + y * y + z * z) / 2;
}

// Full density matrix |ψ⟩⟨ψ| (pure state).
export function densityMatrix(state) {
  return state.map(a => state.map(b => cmul(a, cconj(b))));
}

export const fmt = (z, d = 3) => {
  const re = Math.abs(z.re) < 5e-10 ? 0 : z.re, im = Math.abs(z.im) < 5e-10 ? 0 : z.im;
  if (!im) return re.toFixed(d);
  if (!re) return im.toFixed(d) + "i";
  return re.toFixed(d) + (im < 0 ? " − " : " + ") + Math.abs(im).toFixed(d) + "i";
};
