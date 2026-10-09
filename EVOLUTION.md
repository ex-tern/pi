# Evolution log

Changes made on the `experimental` branch, newest last. Each entry: what changed, why, how it was verified. The nightly run reads this to avoid repeating work.

## 2026-10-09: QuVI added to the Lab (owner preview)

**What:** a browser port of QuVI, Murtaza Vefadar's LabVIEW quantum-circuit toolkit (MIT licence). It has:
- a state-vector engine for up to 6 qubits, with QuVI's gate set: I, X, Y, Z, H, S, T, Phase, RX/RY/RZ, controls, anti-controls, swap and Z measurement
- a wire-and-block circuit editor with a step-through timeline
- inspectors for probabilities, state vector with phase, Bloch spheres, reduced and full density matrices, and per-qubit entropy and purity
- his examples: Teleportation, Grover, QFT-4Q and Superdense coding, plus Bell and GHZ

**Why:** to prepare the QuVI experiment for the Lab. The permission email promised that nothing goes live without the author's approval, so it's visible only to the signed-in owner until `QUVI_PUBLIC=1` is set (`/api/lab/features`). Credit and the full MIT licence text are on the page.

**Verified:**
- `node frontend/quvi/engine.test.mjs`: Bell, GHZ, teleportation fidelity for every outcome, superdense coding, Grover certainty, exact QFT amplitudes, anti-control, swap and norm all pass.
- pytest at baseline (12 pre-existing failures), plus a new feature-flag test.
- `build_hal.py` builds.
- Browser checks for anonymous (hidden, plus a "Coming to the Lab" notice at /quvi/), owner (card and simulator) and public (card, no badge). Every tab at 1440 and 390 px, with no page errors and no horizontal scroll.

**Files:** `frontend/quvi/*`, `frontend/lab.js`, `frontend/index.html`, `frontend/theme.css`, `backend/lab.py`, `backend/api.py`, `backend/tests/test_lab.py`, `CLAUDE.md`.
