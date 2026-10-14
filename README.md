# pi lab

A science lab you work in by drawing. Everything is a **super**, a box with four ports, and supers are joined by **wires**. What a super holds opens to fill the canvas, and the rest of the lab waits as icons beside it.

Live at https://www.piii.app/

## Objectives

- **Graphical.** The lab is a canvas of supers and wires, not a stack of pages. You drag the supers, wire them together, lock and save the layout, and open any one to work in it. Every super has the same shape, a superellipse with n = π.
- **Built in Rust.** The site is Rust compiled to WebAssembly, with no HTML files, no frameworks and no dependencies: `core` and `alloc` only. It draws every view, word and style itself. A few lines of JavaScript (`front/app/host.js`) lend it the page.
- **Science first.** The lab's first instrument is **ScholarPi**, which assesses research papers. A panel of independent AI models reads a manuscript. Deterministic checks audit its references, reproducibility and integrity. It is scored on eight open criteria (the **piX** index), and the report shows what holds it back. Each assessment is recorded on a Proof-of-Research ledger and earns **piQ**, a soulbound token.
- **Open and accountable.** The rubric and every weight are published (`/api/rubric`). The h-index and venue prestige are reported but never scored. Nothing optional happens before you choose (`/api/cookies`).
- **More instruments.** Lab, Library and Connect hold the tools still being rewritten in Rust: HAL-OS, Unigyro, Face Mace, the Map of Science, Neuro Frenzy and the MD plan.

## The canvas

```
 piii lab        [save] [lock] [chain] [reset]
                     │      │
      welcome ───────┘      ├──────────┐
      Tools  ═══▶ Explore ═══▶ Library │
      Connect      │            │      │
      Privacy     Lab   ═══▶  Project ─┘
                 [←] [↑]  [↓] [→]
```

Wiring follows the superellipse language (github.com/ex-tern/superellipse). Every super has four terminals at its extreme points: **out** on the right, where a wire leaves, and **in** (left), **control** (top) and **gate** (bottom), where wires arrive. Data flows from left to right.

- **To wire:** click an out, then a tip.
- **To pass on:** click a control or a gate, then another super's control or gate. What arrives at the first is passed on to the second.
- **To let go:** press Esc, or click anywhere else.
- **To remove a wire:** double-click it, or click it and press Delete.
- **Refusals:** a wire that makes no sense is refused, with the reason. For example, a node can not feed itself, a super has one gate, or that would make a loop.
- **The controls:** save, lock, chain and reset feed a super's control. Whatever arrives there, wired or passed on, acts on that super: lock keeps it in place, chain makes it bring what it holds, save keeps the layout, and reset puts it back where it started.
- **How wires look:** flow wires (into an in) are magenta, control wires dashed, gate wires dotted, and each ends in an arrowhead. The ins of one tip share a bus.

### The language

The canvas is a working dataflow language, like LabVIEW's block diagram, and it is Turing complete. The **Program** super holds nodes; the **Palette** adds them, and **Examples** loads five programs: count to 10, factorial, Fibonacci, Euclid's gcd and a Turing machine (a two-state busy beaver).

- **What a node does** follows what is typed in it:
  - a constant: `3`, `"words"`, `[1, 2, 3]`;
  - an operation: `+ − × ÷ % ^ < > = ≠ ≤ ≥ and or not min max &`;
  - `reg 0`: a register, LabVIEW's shift register;
  - `pick`, `stop`, `show` and `open`;
  - the list operations `list`, `at`, `set`, `len` and `push`.
- **The terminals:**
  - **in** takes values top to bottom, in the order of the supers they come from;
  - **control** is a trigger: the node runs once a value has arrived there;
  - **gate** is a condition: the node runs only when it is true;
  - **out** feeds any number of tips.
- **Running:**
  - ▶ runs step after step. In each step every node computes once, in wire order, and then every register takes its new value. The run ends at a `stop`, when the registers settle, or after 100 000 steps.
  - ⏹ clears.
- **Loops** must pass through a register; any other loop is refused.
- **Why it is Turing complete:** registers hold any value, lists grow and are read and written anywhere, and gates choose.

The controls (save, lock, chain, reset) float over every page.

When a super is open, the canvas floats on top of it and the other supers wait as icons; click π to return to the whole canvas.

The project map (`#/map`) shows the whole lab in the same notation: one prompt fanned out to every engine, and the assessment from manuscript to ledger.

## Layout

```
front/        what the browser gets
  app/        ui.wasm (built from back/rust/ui) and host.js
  fonts/ icon.svg manifest.webmanifest ScholarPi_Whitepaper.pdf zotero/
back/
  rust/ui/    the site: canvas, supers, wires, every window (no dependencies, no_std)
  rust/superai/   SuperAI, the lab's graphical language
  rust/numbers/   π, e, φ, γ, computed exactly
  api.py      the server and the science engines (FastAPI)
  tests/  scripts/tools.py  zotero/  deploy/  LICENSES/
nixpacks.toml railway.toml requirements.txt runtime.txt .github/
```

## Run and build

```bash
python back/scripts/tools.py run        # http://localhost:8000 (add GROQ_API_KEY to back/.env for the AI panel)
python back/scripts/tools.py build-ui   # the site to front/app/ui.wasm (rustup target add wasm32-unknown-unknown)
cd back && python -m pytest -q          # the tests
```

`build-ui --library DIR` builds without the wasm32 target, from the standard library's source.

## Deploy

Railway builds from the repository root with Nixpacks. `ui.wasm` is committed, so the build only installs Python. The app starts with `gunicorn api:app -c back/gunicorn.conf.py`. The healthcheck is `/api/health`, and data lives in `SCHOLARPI_DATA_DIR`. `back/.env.example` lists every setting. The repository is public: never commit `.env` or keys.
