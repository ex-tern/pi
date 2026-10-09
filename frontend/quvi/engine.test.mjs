// Run with: node frontend/quvi/engine.test.mjs
// Checks the simulator against answers known from theory.
import * as E from "./engine.js";
import { EXAMPLES } from "./examples.js";

let failed = 0;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
function check(name, ok, detail = "") {
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + detail));
  if (!ok) failed++;
}
const runEx = (key, rand) => E.run(EXAMPLES[key].circuit, EXAMPLES[key].n, undefined, rand);

{ const { state } = runEx("bell"); const p = E.probabilities(state);
  check("Bell: |00⟩ and |11⟩ each 1/2", near(p[0], 0.5) && near(p[3], 0.5) && near(p[1] + p[2], 0));
  check("Bell: each qubit has entropy 1", near(E.entropy1(E.reducedDensity1(state, 2, 0)), 1, 1e-9)); }

{ const { state } = runEx("ghz"); const p = E.probabilities(state);
  check("GHZ: |000⟩ and |111⟩ each 1/2", near(p[0], 0.5) && near(p[7], 0.5)); }

for (const r of [0.01, 0.4, 0.6, 0.99]) {
  const { state, measurements } = runEx("teleport", () => r);
  const b = E.blochVector(E.reducedDensity1(state, 3, 2));
  check("Teleportation (rand " + r + "): q2 = RY(π/3)|0⟩, outcomes " + measurements.map(m => m.outcome).join(""),
    near(b.x, Math.sin(Math.PI / 3), 1e-9) && near(b.y, 0, 1e-9) && near(b.z, Math.cos(Math.PI / 3), 1e-9),
    JSON.stringify(b));
}

{ const { measurements } = runEx("superdense", Math.random);
  check("Superdense coding decodes 11", measurements.map(m => m.outcome).join("") === "11"); }

{ const { state } = runEx("grover"); const p = E.probabilities(state);
  check("Grover finds |11⟩ with certainty", near(p[3], 1, 1e-9), p.join(",")); }

{ const { state } = runEx("qft"); const N = 16, x = 5;
  let ok = true;
  for (let y = 0; y < N; y++) {
    const want = { re: Math.cos(2 * Math.PI * x * y / N) / 4, im: Math.sin(2 * Math.PI * x * y / N) / 4 };
    if (!near(state[y].re, want.re, 1e-9) || !near(state[y].im, want.im, 1e-9)) ok = false;
  }
  check("QFT|0101⟩ has amplitude e^{2πi·5y/16}/4 on every |y⟩", ok); }

{ // anti-control fires on |0⟩ only; swap moves amplitude; norm is preserved
  const n = 2, s = E.zeroState(n);
  E.applyGate(s, n, 1, E.gateMatrix("X"), [[0, 0]]);
  check("Anti-control: X on q1 when q0 = 0 gives |01⟩", near(E.probabilities(s)[1], 1));
  E.applySwap(s, n, 0, 1);
  check("Swap: |01⟩ → |10⟩", near(E.probabilities(s)[2], 1));
  const r = E.run([[{ op: "H" }, { op: "RX", theta: 1.1 }], [{ op: "T" }, { op: "RZ", theta: 0.3 }]], 2).state;
  check("Norm preserved", near(E.probabilities(r).reduce((a, b) => a + b, 0), 1, 1e-12)); }

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
