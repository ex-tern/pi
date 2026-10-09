// examples.js — circuits after QuVI's examples (Teleportation, Grover Search,
// QFT-4Q, Superdense Coding), plus the two smallest entangled states.
// Each column is an array of cells, one per wire (see engine.js).

const g = (op, theta) => (theta === undefined ? { op } : { op, theta });
const C = { op: "C" }, M = { op: "M" }, SW = { op: "SW" };
const col = (n, cells) => Array.from({ length: n }, (_, k) => cells[k] || null);
const PI = Math.PI;

export const EXAMPLES = {
  bell: {
    name: "Bell pair",
    note: "H then CNOT: two qubits that always agree when measured. Each one alone is maximally uncertain (entropy 1).",
    n: 2,
    circuit: [col(2, { 0: g("H") }), col(2, { 0: C, 1: g("X") })],
  },
  ghz: {
    name: "GHZ state",
    note: "Three-way entanglement: |000⟩ and |111⟩ with equal weight, nothing in between.",
    n: 3,
    circuit: [col(3, { 0: g("H") }), col(3, { 0: C, 1: g("X") }), col(3, { 1: C, 2: g("X") })],
  },
  teleport: {
    name: "Teleportation",
    note: "q0 is prepared with RY(π/3) and its state reappears on q2. Corrections use quantum controls (the deferred-measurement form), so q2's Bloch sphere matches q0's original state for every measurement outcome.",
    n: 3,
    circuit: [
      col(3, { 0: g("RY", PI / 3), 1: g("H") }),
      col(3, { 1: C, 2: g("X") }),
      col(3, { 0: C, 1: g("X") }),
      col(3, { 0: g("H") }),
      col(3, { 1: C, 2: g("X") }),
      col(3, { 0: C, 2: g("Z") }),
      col(3, { 0: M, 1: M }),
    ],
  },
  superdense: {
    name: "Superdense coding",
    note: "One qubit carries two classical bits. Alice encodes 11 with X then Z on her half of a Bell pair; Bob decodes with CNOT and H and always reads 11.",
    n: 2,
    circuit: [
      col(2, { 0: g("H") }),
      col(2, { 0: C, 1: g("X") }),
      col(2, { 0: g("X") }),
      col(2, { 0: g("Z") }),
      col(2, { 0: C, 1: g("X") }),
      col(2, { 0: g("H") }),
      col(2, { 0: M, 1: M }),
    ],
  },
  grover: {
    name: "Grover search",
    note: "Two-qubit search for |11⟩: one oracle (CZ) and one diffusion step find the marked item with certainty.",
    n: 2,
    circuit: [
      col(2, { 0: g("H"), 1: g("H") }),
      col(2, { 0: C, 1: g("Z") }),
      col(2, { 0: g("H"), 1: g("H") }),
      col(2, { 0: g("X"), 1: g("X") }),
      col(2, { 0: C, 1: g("Z") }),
      col(2, { 0: g("X"), 1: g("X") }),
      col(2, { 0: g("H"), 1: g("H") }),
    ],
  },
  qft: {
    name: "QFT, 4 qubits",
    note: "The quantum Fourier transform of |0101⟩ (x = 5). Every outcome is equally likely; the information is in the phases, which turn by 5 × 2π/16 per step. Open the state vector to see them.",
    n: 4,
    circuit: (() => {
      const n = 4, cols = [col(n, { 1: g("X"), 3: g("X") })];
      for (let j = 0; j < n; j++) {
        cols.push(col(n, { [j]: g("H") }));
        for (let k = j + 1; k < n; k++) cols.push(col(n, { [k]: C, [j]: g("P", PI / (1 << (k - j))) }));
      }
      cols.push(col(n, { 0: SW, 3: SW }));
      cols.push(col(n, { 1: SW, 2: SW }));
      return cols;
    })(),
  },
};
