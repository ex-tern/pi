# ScholarPi — Pi-Index Assessment Engine

> Every document of the project is in this one file (owner, 2026-10-13: "merge all .md files together"). After the README come these parts:
>
> - [Working on it: the rules (was CLAUDE.md)](#working-on-it-the-rules-was-claudemd)
> - [Design (was DESIGN.md)](#design-was-designmd)
> - [The experimental site (was EXPERIMENTAL.md)](#the-experimental-site-was-experimentalmd)
> - [The pi-Index framework, v2 (was pi-Index-Framework-v2-REWRITE.md)](#the-pi-index-framework-v2-was-pi-index-framework-v2-rewritemd)
> - [Critique: logical flaws and what was done (was CRITIQUE.md)](#critique-logical-flaws-and-what-was-done-was-critiquemd)
> - [Recommendations (was RECOMMENDATIONS.md)](#recommendations-was-recommendationsmd)
> - [Vendored libraries (was front/vendor/README.md)](#vendored-libraries-was-frontendvendorreadmemd)
> - [Evolution: the project's history (was EVOLUTION.md)](#evolution-the-projects-history-was-evolutionmd)

A local-first (and production-deployable) research-assessment webapp:

- **Backend:** FastAPI (`back/api.py`) — REST/streaming API, also serves
  the frontend as static files from the same process.
- **Frontend:** plain HTML/CSS/JS (`front/`) — no build step, no
  framework.
- **Engine:** deterministic MDAR/reproducibility/empirical-density scoring,
  multi-LLM consensus (Llama/Mistral/Qwen/Gemini + a local PyTorch "Scilem"
  model), a SQLite-backed Proof-of-Research ledger, and optional
  Ethereum/IPFS state backup.

### In the Lab: work by Murtaza Vefadar

Two projects in the Pi Tech Lab are the work of **Murtaza Vefadar** (Department of
Physics, Gebze Technical University), shown here with credit:

- **Unigyro II**, his single-seater robot vehicle.
  Video: [Unigyro II: Single-Seater Robot Vehicle](https://www.youtube.com/watch?v=QHxpu1xufFc)
  (played in the Lab's Unigyro window). Channel: [youtube.com/@MortezaVafadar](https://www.youtube.com/@MortezaVafadar).
- **QuVI**, his LabVIEW quantum circuit toolkit, described in
  [From Block Diagrams to Bloch Spheres: Graphical Quantum Circuit Simulation in LabVIEW](https://arxiv.org/abs/2602.00643)
  ([source](https://github.com/MurVefa/QuVI---Quantum-Circuit-Toolkit), MIT licence).
  `front/quvi/` is an independent browser implementation of the same model, credited to him under the MIT licence.

The video and both projects remain his.

---

## 1. Local development

```bash
python back/scripts/tools.py run     # macOS, Linux or Windows (add --lab: with HAL-OS and private projects)
```

It creates a virtualenv, installs dependencies, copies
`back/.env.example` → `back/.env` on first run, and starts the server
with auto-reload. Open **http://localhost:8000**.

### Manual setup
```bash
cd back
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # then edit .env with your keys
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

### Running with no API keys at all
Every key in `.env` is optional:
- Assessment works end-to-end via the local PyTorch "Scilem" model +
  deterministic regex heuristics (MDAR/RRID detection, reproducibility
  signals, empirical density) if no LLM keys are set.
- Web3 wallet linking works (address-only or SIWE-signed via MetaMask), but
  on-chain minting is skipped and records are written locally with
  `tx_hash = "Simulated_Ledger_Record"`.
- ORCID login needs `ORCID_CLIENT_ID`/`ORCID_CLIENT_SECRET`; without them the
  button just won't complete a login.
- IPFS/Ethereum state backup is skipped silently without Pinata/Web3 keys.

Add keys to `back/.env` any time — no code changes needed. See
`back/.env.example` for where to get each one.

---

## 2. Production deployment

### Bare metal / VM (systemd + nginx)

Python and Rust only: there is no Docker image, by design.

1. `cd back && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
2. `cp .env.example .env` and fill it in; set `ENVIRONMENT=production`
3. Copy `back/deploy/scholarpi.service` to `/etc/systemd/system/`, edit the
   paths/user to match your setup, then:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now scholarpi
   ```
4. Copy `back/deploy/nginx.conf.example` to `/etc/nginx/sites-available/`, fill
   in your domain + cert paths (e.g. via `certbot --nginx`), enable it, and
   `systemctl reload nginx`.

### Production environment variables worth setting explicitly

| Variable | Purpose | Production default you probably want |
|---|---|---|
| `ENVIRONMENT` | Enables production hardening (see §3) | `production` |
| `ALLOWED_ORIGINS` | CORS allow-list, comma-separated | your real domain(s), not `*` |
| `FRONTEND_ORIGIN` | Used to build ORCID redirect URLs | your real `https://` domain |
| `ORCID_REDIRECT_URI` | Must exactly match your ORCID app's registered URI | `https://your-domain/api/auth/orcid/callback` |
| `SCHOLARPI_DATA_DIR` | Where the SQLite DB / weights / logs live | a persistent volume/mount, not a container's ephemeral home dir |
| `MAX_UPLOAD_MB` | Per-file upload cap | 25 (default) or lower |
| `FREE_EVALS_PER_IP` | Free assessments before a wallet is required | 1 (default) |
| `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS` | In-process rate limit on assessment/chat endpoints | tune to your traffic |
| `WEB_CONCURRENCY` | Gunicorn worker count | 2 is a reasonable start for SQLite |

---

## 3. What "production ready" means here, concretely

- **CORS** is driven by `ALLOWED_ORIGINS`/`FRONTEND_ORIGIN`, not a hardcoded
  `"*"`. In development it still defaults to `*` for convenience; in
  `ENVIRONMENT=production` it defaults to `FRONTEND_ORIGIN` only.
- **Server-side free-trial enforcement.** The original design tracked free
  evaluations in the browser's `localStorage` only — trivially bypassed by
  clearing site data. There's now an authoritative, server-side counter
  keyed by client IP (`auto_ip_tracking.free_evals_used` in SQLite,
  respects `X-Forwarded-For` behind a reverse proxy). The client-side gate
  still exists too, purely as a fast UI hint.
- **Rate limiting** on the assessment and Scilem-chat endpoints (in-process
  sliding window; put nginx's own `limit_req` in front of it too for
  defense in depth — see `back/deploy/nginx.conf.example`).
- **Upload validation**: content-type check + a configurable per-file size
  cap (`MAX_UPLOAD_MB`), enforced before any parsing happens.
- **No leaked internals.** A global exception handler logs full tracebacks
  server-side but returns a generic `"Internal server error."` to clients
  when `ENVIRONMENT=production` (full exception text in development, for
  easier debugging). API docs (`/api/docs`, `/api/redoc`,
  `/api/openapi.json`) are disabled in production.
- **Real logging.** Previously the app called `logging.info(...)` with no
  handler ever configured, so nothing was written anywhere. Logging is now
  configured at startup: stdout (for `journalctl`) plus a
  rotating file at `$SCHOLARPI_DATA_DIR/logs/scholarpi.log`.
- **`/api/health`** endpoint (checks DB connectivity) for load balancers,
  container orchestrators, and uptime monitors.
- **WAL-mode SQLite** so reads aren't blocked by an in-flight write —
  matters once more than one request can be in flight (multi-worker
  gunicorn), not just single-user local dev.
- `back/deploy/scholarpi.service`
  includes basic systemd sandboxing (`ProtectSystem=strict`,
  `NoNewPrivileges=true`).
- **Pinned, trimmed dependencies** (`requirements.txt`) — compatible-release
  version ranges instead of unpinned `latest`, and five packages that were
  listed but never actually imported anywhere in the codebase (`pandas`,
  `torchvision`, `beautifulsoup4`, `tabulate`, `groq`) were dropped.
- **Automated tests** (`back/tests/`, run via `pytest`) covering the
  deterministic scoring engine and the database layer, wired into CI
  (`.github/workflows/tests.yml`) so regressions get caught on every push.

### What's *not* claimed as production-hardened

- **SQLite** is genuinely fine at small-to-moderate scale (WAL mode +
  `busy_timeout` handle a handful of concurrent workers well), but it is
  not a horizontally-scalable database. If you outgrow a single VM/box,
  migrate `database.py` to Postgres — the SQL is plain enough that this is
  a contained, mechanical change, not a rewrite.
- **On-chain minting requires a matching deployed contract.** The Solidity
  contract (kept outside this repository since 2026-10-13: Python and Rust only here) expects a true Groth16 zk-SNARK proof
  (`Verifier.Proof`) tied to a ZoKrates circuit; `ledger.py` currently
  submits a simplified HMAC-based "proof" against a 4-argument ABI. This
  only matters if you deploy your own contract — otherwise the app runs
  fully with `tx_hash = "Simulated_Ledger_Record"`. Tell me your deployed
  contract's actual ABI and this can be aligned exactly.
- **The "Stop" button** on an in-progress assessment isn't wired to a
  server-side cancel flag; closing the tab stops the client from reading
  further progress, but an in-flight batch finishes server-side.

---

## 4. Testing

```bash
cd back
pip install -r requirements-dev.txt
pytest tests/ -v
```

Covers the deterministic scoring functions (MDAR/RRID detection,
reproducibility signals, empirical density, formulaic criteria bounds, the
rebuttal-strategy generator) and the database layer (schema creation, WAL
mode, free-trial counter correctness and isolation, schema-migration
idempotency) — all without requiring any LLM API keys, so it runs the same
in CI as it does locally. `.github/workflows/tests.yml` runs this suite on
every push/PR.

---

## 5. What's where

| Feature | Route |
|---|---|
| Sidebar (wallet, ORCID, live logs, Scilem chat) | `front/index.html` sidebar + `/api/auth/*`, `/api/logs`, `/api/scilem/*` |
| Assess Manuscript (local PDF or DOI lookup) | "Assess Manuscript" tab + `POST /api/assess/stream` (NDJSON progress stream) |
| pi-Dyne LSTM forecast | "Analytics & Map" tab + `GET /api/forecast` |
| Map of Science | Same tab, rendered client-side with `vis-network` from `GET /api/analytics/map` |
| piQ Leaderboard / piX Top Papers | `GET /api/analytics/leaderboard`, `GET /api/analytics/top-papers` |
| Ledger Explorer (search + full dossier, tx linked to Etherscan) | "Ledger Explorer" tab + `GET /api/explorer/search`, `/latest`, `/dossier/{hash}`, `/tx-url` |
| Architecture | "Architecture" tab, static description |
| Defense strategy / criterion detail modals | Modal popups, backed by `/api/defense-strategy` |
| Health check | `GET /api/health` |
| Zotero plugin | download https://pitechlab.com/zotero/scholarpi.xpi, then in Zotero 7: Tools → Plugins → ⚙ → Install Plugin From File. Adds a piX column and a ScholarPi item section. Source in `back/zotero/`; `python back/scripts/tools.py zotero` rebuilds it |
| Background cron worker | `python back/api.py cron`, or `.github/workflows/cron.yml` |

## 6. First-run notes

- The **first Scilem chat message** (`/api/scilem/chat`) downloads the
  TinyLlama model — needs internet access and a few hundred MB of disk, can
  take a minute or two. Manuscript assessment itself does not require this;
  only the sidebar chat does.
- If you register an ORCID OAuth app, its **redirect URI** must exactly
  match `ORCID_REDIRECT_URI` — including in production, where it must be
  your real HTTPS domain, not `localhost`.

## 7. License

Two licenses (see [LICENSE](LICENSE)):

- **The science engines are open source** under the [GNU AGPL 3.0](back/LICENSES/AGPL-3.0-only.txt): the Pi-Index
  rubric and the assessment pipeline, now all in `back/api.py` (the whole server is one file, so that file as
  a whole is AGPL-3.0-only) and the constants in Rust (`back/rust/numbers/`). Use, study, change and share them; if you run a changed
  version as a service, offer its users your source.
- **The website and its design are proprietary**, all rights reserved
  ([Pi Tech Lab Proprietary License](back/LICENSES/LicenseRef-PiTechLab-Proprietary.txt)): the front end, its look, the
  SuperAI language and its engines, and the platform that runs the service.
- Third-party work keeps its own license, beside it.


---

# Working on it: the rules (was CLAUDE.md)

ScholarPi runs as two copies of this repository:

| Site | Branch | Railway environment | Purpose |
|---|---|---|---|
| https://pitechlab.com | `main` | production | Stable. Real users, real data. |
| https://exp.pitechlab.com | `experimental` | experimental | Evolves constantly. May break. Separate data volume. |
| https://se.pitechlab.com (also super.pitechlab.com) | `super` | its own environment | The superellipse site (`front/superellipse.css`, on by host name `se.*` or `super.*`, `SCHOLARPI_SHAPE=superellipse` or `?shape=se`). Deploys alone from `super`, branched from `experimental` on 2026-10-10. Changes the owner asks for on se. go to `super`. |

### Rules for Claude

1. **Work on `experimental`.** Branch from it, commit to it, and push to it when the owner asks for changes. That deploys to exp.pitechlab.com automatically.
2. **Never push to `main`, and never merge into it, without the owner explicitly saying so in that conversation.** Promoting means merging `experimental` into `main` after the owner has looked at the experimental site.
3. **Before every push, run:**
   - `cd back && python -m pytest -q`: compare against the known baseline. Do not add new failures. The tests import `api` (as the old module names: `import api as brain`).
   - `python back/scripts/tools.py build-hal --src ../HAL-OS`: refuses to build if `front/hal/wire.js` and HAL-OS disagree.
   - Load the site in a browser at desktop and 390 px width: no page errors, no horizontal scroll.
4. **The repository is public.** Never commit secrets, `.env` files, or anything from private projects (those live on the server volume; see `back/lab.py`).
5. **Keep the design language** in `front/theme.css`:
   - ink on paper, with one cobalt accent for "here / interactive"
   - status colours muted
   - Geist type, sentence case
   - the π circle as the only ornament

   Change it deliberately, not by accident.
6. **Python and Rust only; no Docker, no Java** (owner, 2026-10-13). Railway builds with Nixpacks (`railway.toml`, `nixpacks.toml`: the Python provider installs `requirements.txt`, the build phase fetches the pinned HAL-OS commit and runs `back/scripts/tools.py build-hal`, the start command is gunicorn with `back/gunicorn.conf.py`, which chdirs into `back/` itself). The Dockerfile, docker-compose, the entrypoint script, the Java client and the Solidity/ZK artifacts (`.sol`, `.zok`, keys, `abi.json`) are gone; `back/ledger.py` carries the contract ABIs it needs inline. `python back/scripts/tools.py run` runs it locally (`run --lab` builds HAL-OS and serves private projects as production does). The browser still runs JavaScript (the front end's modules) and the SuperAI engine compiled from Rust to WebAssembly.
7. **Prefer Python** (owner, 2026-10-13: "always use py language more"): put new logic in Python on the server whenever it can live there; JavaScript only for what must run in the browser (drawing, gestures, the page's own state), and keep it thin, calling the Python API.
8. **Two licenses** (LICENSE, owner, 2026-10-13: "its science-related engines are public open source, but its website design is owned by me only"): the science engines are AGPL-3.0-only (back/rust/numbers, and back/api.py, which now holds them: the rubric, brain, providers, scientometrics, attribution, security, extraction, integrations, http_client, diagnostics and ledger sections; since the whole server is that one file, the file as a whole is AGPL-3.0-only). Everything else, the website and its design above all, is `LicenseRef-PiTechLab-Proprietary` (back/LICENSES/): never add an open-source license header or a permissive `license =` to it. Third-party code keeps its own license file beside it.
10. **Two folders** (owner, 2026-10-13: "merge everything into front, back, folders only"): `front/` is everything the browser gets (index.html, the separate pages, WebAssembly, fonts, vendored libraries, the Zotero download); `back/` is everything else (api.py and its tests, gunicorn.conf.py, scripts/tools.py, the Rust crates, the Zotero plugin's source, the deploy examples, the licence texts). At the root stay only what Railway and GitHub read there (nixpacks.toml, railway.toml, requirements.txt, runtime.txt, .github/, .gitignore), LICENSE and this README.
9. **One file per language, and the front end is one file** (owner, 2026-10-13: "put everything in one file, all .py in one .py, all .js in one .js etc", then "merge everything in front end into one thing"): the server is `back/api.py`, the build and run scripts are `back/scripts/tools.py`, and the whole front end is `front/index.html`: its styles, the page's script, the SuperAI engine's binding and the web workers (script blocks started as blobs by `window.inlineWorker`) inline, each part under a banner naming the file it was; the file names used in this document (super/nodes.js, orbit.css, core.py, routes/…) name those sections. Add new code to the right section, not a new file. Still files: gunicorn.conf.py, the tests, WebAssembly, fonts, images, sound, the vendored libraries, the separate pages (hal/, quvi/, confirm/, learn/, which carries its own copy of the engine's binding) and the Zotero plugin (back/zotero/). The program (super/pitechlab.sasm) is assembled into a marked region of index.html by `python back/scripts/tools.py build-program`. index.html is served gzipped with an ETag (no-cache, 304 when unchanged).

### Layout

Since 2026-10-13 each language is one file (rule 9): `back/api.py`, `back/scripts/tools.py`, `front/app.js`, `front/style.css`. The map below names the sections inside them by the files they were.

```
back/        FastAPI app: core.py (the app, configuration, logging, the database, the gate, rate limits, startup) + routes/ (one APIRouter per concern: meta, auth, piq, chain, status, identity, arcade, visits, profile, assessments, reviews, history, admin, reviewing, bugreport, assess, discover, scilem, forecast, analytics, explorer; `from core import *` plus explicit imports between routers, no cycles) + api.py (assembles them, re-exports every name for idle_worker and the tests; gunicorn runs api:app), Lab private projects (lab.py),
                permission requests (consent.py), signed-in layout sync (layout.py),
                PiEN shared model (pien.py), recent assessments (recent.py), RiBD suggestions (rib_suggest.py), Live panel feed (live.py), idle auto-assessment (idle_worker.py), website traffic by day (traffic.py), the Super Neural Engine's one-prompt-every-engine endpoint, the "?" panel of AI jurors with a judge, and the super prompt box's per-engine endpoints /api/super/engines, /one and /weigh (super_engine.py), the site password (gate.py), the deployment's look (shape.py: SCHOLARPI_SHAPE=superellipse stamps shape-se into index.html on the way out, so a first visit lays out the superellipse site before the first paint instead of learning it from /api/build after the modules had laid out the round look), tests/
front/       index.html, app.js (the app), vendor/three (three.js r185, the superellipse look's graphics engine, see vendor/README.md), style.css + theme.css (look),
                orbit.js + orbit.css (orbit layout around the centre mark; scroll sizes the mark from a 4 px dot to a backdrop covering the page; curved wires between bubbles that you disconnect by clicking and connect by dragging from a bubble's handle, kept as orbit:wires; the main loop (the mark, "π" in orbit:wires) is a wire end too: drop on its edge, the counter or the mark, or drag from its edge; diagram nodes can take it as an input), pi-worker.js (live π digits), pien.js (PiEn, the mark that learns), numbers.js + consts-worker.js (π and friends: e, φ, γ), capabilities.js (the Capabilities pill), architecture.js (the Architecture flowchart), peeks.js (glimpses inside pills), recent.js (Recent assessments), intern.js (the Intern pill), performance.js (the simple Performance window), unigyro.js + unigyro.css (Unigyro, by Murtaza Vefadar; source: neurophilic/Unigyro, `python back/scripts/sync_unigyro.py --src ../Unigyro`), neurofrenzy.js + neurofrenzy.css + sound/neurofrenzy.mp3 (Neuro Frenzy, a game in the Library bubble with looping music and a mute toggle; from neurophilic/NeuroGame), facemace.js + facemace.css + facemace/ (FaceMace, sort photos by face; port of neurophilic/FaceID), medicine.js + medicine/ (MD, a public grade-free graduation plan in the Library bubble; never add grades, passed-exam dates or averages), ribsuggest.js (RiBD: papers to read and hot topics), live.js + live.css (the Live panel fixed to the right side), download.js (the dossier's Download paper button), traffic.js + traffic.css (website traffic in the Analytics window), superprompt.js + superprompt.css (SuperPrompt.run(question) asks every engine at once, the lab's siM, riB, piD and PiEn and the outside models Llama, Mistral, Qwen, Gemini and DeepSeek, one request each to /api/super/one, then the judge weighs the outside answers via /api/super/weigh; SuperPrompt.open shows a run's cards; the box itself is the round look's, opened by a double click on empty space),
                super/ (the superellipse look, se.pitechlab.com / super.pitechlab.com and, since 2026-10-12, pitechlab.com; one rule book, below),
                lab.js (Lab tab), channel.js (experimental banner),
                hal/ (HAL-OS web portal + v86 emulator; boots to the HAL-OS> shell, hal/shell/shell.asm -> hal/shell.img via `python back/scripts/build_hal_shell.py`, needs nasm; its `hal` command starts the network), confirm/ (permission-request page),
                quvi/ (browser port of Murtaza Vefadar's QuVI; `node front/quvi/engine.test.mjs`)
back/rust/numbers/   the site's constants in Rust (π by Machin, e, φ, γ by Brent–McMillan; base-10⁹ big numbers with exact long division; no dependencies, no_std for wasm32, a size-class allocator so long series reuse memory): `cargo test`, then `python back/scripts/build_superai.py --crate numbers --build-std` writes front/numbers.wasm (committed); pi-worker.js and consts-worker.js are now thin loaders that pace its digits out
back/rust/superai/   the SuperAI language in Rust (no dependencies; no_std for wasm32): json.rs, asm.rs (the assembly), vm.rs (the stack machine), lang.rs (supers, wires, dataflow, the operators, the engine super), math.rs, the `superai` command (JSON request in, JSON answer out); `cargo test` in back/rust/superai, then `python back/scripts/build_superai.py` (add `--build-std` where the wasm32 target cannot be downloaded: it builds core and alloc from rust-src) writes front/super/superai.wasm, which is committed
back/scripts/        tools.py: build-program (pitechlab.sasm into app.js's program region), build-superai (the SuperAI engine to WebAssembly), build-hal (HAL-OS's boot image from its own repo), build-hal-shell (the HAL-OS shell image; `--check` verifies it matches the source), sync-unigyro (Unigyro from its own repo), whitepaper, run
```

### The superellipse look (front/super/): the rule book

The front end is a **SuperAI program**: `super/pitechlab.super.js` (plain JSON-compatible data) says what exists and how it is wired; `super/runtime.js` loads it as `SuperAI.program` (or the visitor's edited copy, `superai:program`, when it passes `SuperAI.validate`), and `super/superai-rs.js` runs the language's own engine, written in Rust (`back/rust/superai`, built to `super/superai.wasm` by `back/scripts/build_superai.py`; `node front/super/superai.test.mjs` tests it). The program's parts: `sources` (native blocks: parts of index.html whose cards become windows), `titles`, `hide`, `merges`, `bubbles` (what each bubble holds, and `at`, where it starts), `diagram` (the supers and wires a first visit starts with: `supers` with kind, text, hint, size, at, everywhere, desktop; `wires` as "super.port" pairs, where "site" is the inner super, "main" the main super, "title" the title super and "bubble:Title" a bubble), `live` (the Live window's source, refresh and the functions that write its lines), `functions` (small parts of the site written in SuperAI and run by the Rust engine: percent, ago, liveStatus, liveCounts, add; `SuperAI.call(name, inputs)`) and `project` (the project map). Change the site's structure in the program, not in the modules; the windows' insides stay native.

**Drawn by three.js** (owner, 2026-10-12: "use an open source graphical engine"; super/engine.js, three.js r185 vendored in front/vendor/three, MIT): one WebGL canvas under the page draws the light behind the glass, the main and inner supers, every super's frosted pane (from its superellipse distance field: fill, ink edge, iridescent sheen when hovered or selected, soft shadow), every wire (strips sampled from the wires' own svg paths, dots flowing on hover), the lattice and every port sparkle; the page's elements keep their size, place and behaviour and stop painting their chrome (html.se-gl, super/glass.css). A software renderer (no graphics processor) or frames slower than 28 ms fall back to the CSS glass look; `?gl=1` forces the engine (tests here run without a GPU, so use it to see the engine).

**Everything is a super**, drawn the same way (super/super.css, the uniform block at its end; the material in super/glass.css): frosted glass over a deep warm light drifting slowly behind the page, amber, honey and sage with a soft vignette, embers and a fine grain (owner, 2026-10-12: "add this glass effect", "improve the glass ui"); each pane has a bright bevel along its top, a faint prism split at its edge and a wide warm shadow; every rounded corner on the page, inside windows too, is a superellipse corner (owner: "make everything superellipses, not round corners"; super/super.css :where(*) rule, and the drawings' boxes are superellipse paths), with an iridescent sheen running round the edge of the hovered or selected super, a 1.5 px ink edge, a superellipse at n = π (Shift + scroll gives one its own n, kept as se:n:<name>), four port sparkles on its sides (input left, output right, sync top, condition bottom; super/site.js places them and reads their values), a lock at its lower right (super/lock.js: a scroll in on it locks, out unlocks; locked, what is inside stays inside and it goes into no other super; se:lock:<name>), and the same hover (a hint of cobalt on its edge) and selection (a click, a cobalt edge; super/select.js: the supers nest and one is selected at a time). The supers: the **main super** (the loop round everything, super/loop.js: its ports a little inside the display's edge), the **inner super** (the site, super/site.js: locked in place and as big as the main super lets, its edge just inside the main super's side ports and just clear of the title super, super/loop.js siteMargins; no zoom, no drag), the **title super** ("pi tech lab" on one line, top-left corner, super/logo.js; a scroll on it resets the view once the view has changed; the 0 key too), the **bubbles** (Lab, Library, Tools, Explore, Connect; expandable, super/bubble.js: compact, a square of side --se-compact, the largest of which ten fit in the inner super (super/loop.js compactSide), with a small drawing of its name wired to its windows; every scroll step grows it a little toward its open size, its drawing giving way to its name and pills, and back (super/bubble.js zoom, --sb-t); open, it is its drawing grown up (owner, 2026-10-12): its name in a box on the left wired by soft curves (super/bubble.js links) to one labelled box per window in a column on the right, words never under 12 px; a scroll out on a pill shrinks the bubble; a wire dropped on it opens it; a scroll in on one of its pills expands that pill into its window; se:bubble:<key>), the **windows** (open at one uniform width in the middle of the inner super and no taller than their content (desktop; super/zoombox.js fitHeight), no bar: the content's own title shows and the window moves by the blank margin inside its edge; content fitted whole and zoomed, never scrolled, super/zoombox.js), the **project super** (the whole project as a SuperAI program, super/project.js: compact it is the same species as a bubble, drawn by the same function (SeBubble.drawing: its name's box, "Project", wired to a box per section); every scroll step grows it a little, the bubble drawing fading as the map comes in (--pj-map), until it fills the inner super, and scrolled on past that it shows the running program to edit; it drags and follows its ports as a bubble does), and the **Super AI supers** (super/nodes.js: the central one, id site-box, says "run"; a double click on bare space makes one that says "prompt" (windows open or not); type a question and Enter asks every engine, but only when it is connected to run by wires or sits inside it (connectedToRun), else it shows its question and says to connect it first; numbers and operators compute locally (2, 3 → + is 5; 3, 5 with + attached is 8; a word typed into a super is its label, not a question, unless it ends with "?": "math" with 4 and 3 wired in and + attached at any of its sparkles shows 7, and "show result" wired from it shows 7 too; a Super AI super takes what is wired to any of its sparkles as an input, a wire from another super's sync or condition sparkle carrying that super's result, data flowing from an output or else the way the wire was drawn; the site's and the main super's ports are the lattice, not data; an attached operator super is its operation; back/rust/superai lang.rs engine() agrees); a ■ scrolled past 150 px is a holder that holds supers (see-through; inside it is like the page; it moves by its label strip or edge); its n is the one it was made with until Shift + scroll gives it another (owner, 2026-10-13: "remove the rule of usage = super's n": it no longer follows size or use); Shift + scroll on a Super AI super or a holder changes only its shape).

**The start since se:start 20** (owner, 2026-10-13: "make the initial state as you desire"; pack.js START and the diagram in pitechlab.sasm): a welcome super at the second super's top left saying in one sentence what ScholarPi is and to start with Tools (a ■ with words shows them, super/define.js; a text super with a size of its own keeps it, nodes.css, its type big enough to clear legible.js at the start's zoom); Tools open under it; Connect folded below Tools; the third super on the right holding Explore and Library above, Lab and the project below, as squares big enough to read; wires: the site's own, Tools to Explore to Library, Lab to the project, save into Tools, lock into the second super; the demonstration wiring into if, then and the timer (and its small square) is gone. Phones keep their stacked start. The paragraph below is the start before it.

**The start** (a first visit, or after the app is reset; owner, 2026-10-12: "this should be initial state of the program", from the owner's own layout): the view zoomed out; no central super and no hint; Connect on the left of the inner super; the third super (`hold`) on its right holding Tools → Explore → Library along the top and Lab → the project below them; the project locked. Wires: main.sync → site.sync, title → site.sync (a curve), site.sync → Connect.sync and hold.sync, hold.sync → Tools, Explore and Library's syncs; data: Connect.output → hold.input, Tools → Explore → Library (output → input), Lab.output → project.input; Explore.condition → Lab.sync, site.sync → project.sync (the project is not the third super's member); site.condition → main.condition and the side wires (super/pitechlab.super.js: bubbles' at.inSite, their centres in shares of the inner super, so the start lands the same on every screen, and atPhone for a phone's two columns; diagram supers and wires; projectAt.inSite; lock.js LOCKED_AT_START). Without a central super a Super AI super counts as connected (connectedToRun) when it is wired into anything or held by a super; a program that has one lays it out again only if it is missing (nodes.js progRun). A change to the start bumps `se:start` (now 21).

**Nothing is clickable, only zoomable** (owner, 2026-10-12), except wires and the prompts typed into Super AI supers: a click on a super selects it and lets you type into it, and presses nothing (stop, pause and ask go by wires and Enter); the project map's supers are not buttons; the lock locks by a scroll in on it and unlocks by a scroll out (the keyboard still toggles it); the title super resets the view by a scroll on it once the view has changed; the project super shows the program by a scroll on past the whole map (a scroll out on its head, or Escape, closes it; ⌘/Ctrl + Enter runs it, ⌘/Ctrl + S downloads it, ⌘/Ctrl + Shift + Backspace goes back to the shipped program); the windows' insides stay native (forms, links, buttons).

**A scroll** (super/scroll.js, one rule): on bare space it does nothing (the inner super is locked); on a super it sizes the super (Alt + scroll zooms its text); every super scrolls to expand (owner, 2026-10-12): on a bubble or the project super every step grows or shrinks it a little; on a pill a few steps in open its window; in a window it zooms the content with every step and grows the window while there is room (back out: content first, then window; Alt + scroll zooms the content alone); Alt + scroll on the title or the palette sizes it; **only Shift + scroll changes an n** (the ring is not a control). One gesture stays on what it started on for 400 ms; a gesture that ends within 6 % of 100 % settles on 100 %; Safari's pinch works the same; the view glides (super/motion.js).

**SuperAI is drawn, like LabVIEW** (super/define.js, owner, 2026-10-13: "make this super language a graphical language like a LabVIEW that can be used to write new, functioning supers"; "just the front end"): a holder named `super NAME` (or `def NAME`) is a definition; inside it supers typed `in` (or `in a`, `in b`, top to bottom) are its inputs and one typed `out` its output (else the holder's input and output ports, else the super nothing inside takes from); a condition wire holds a super while false. What is drawn compiles to the language's `{ supers, wires }` (`LabView.graphOf`) after each edit (never while the page loads or the start is still re-laid, `se:touched`) and is kept as `superai:defs`. Any super with NAME typed in runs it on what is wired in; definitions call one another and themselves (a condition ends recursion). New words: `≠`, `select` (condition, then, else), `repeat F` (x, n), `while F T` (x), `count` (+1 per sync tick or run; condition false holds), `keep` (remembers the last value, kept in lv:nodes `mem`), `supers` (lists them), `export` (Enter or the open control: downloads `my-supers.sasm`, the language's text form, for pitechlab.sasm). Numbers and operators compute in any super, whatever its shape; a square's words are text, a prompt's words a question. The Rust engine does not know the new words yet: they run in JavaScript (the wasm32 target could not be installed to rebuild superai.wasm).

**Asking first** (super/consent.js + consent.css, owner, 2026-10-13: "add ask for permission what site is doing with users when site loads", "use cookies"): a first visit (no `pi_consent` cookie, or an older version of the notice) shows what the site does: always on (layout in the browser, sign-in session and account layout, IP for rate limits, the cookie) and three choices, unticked until chosen, and "Reject all" in blue beside "Accept all" (as easy to refuse as to accept): count my visit (`POST /api/visit`), help PiEn learn (`/api/pien/learn`), outside AI providers (llama, mistral, qwen, gemini, deepseek; off also turns off assessment, the panel and the AI reviewer, whose jurors are outside). Until a choice, nothing optional is sent. The cookie `pi_consent=v1.cX.lX.eX` (a year, SameSite=Lax, Secure on https) can be read by the server; the page enforces it in requests.js, which never sends a declined request and lists it as declined. Change what the notice says → bump its version so everyone is asked again. **The server honours it too** (back/cookies.py, owner, 2026-10-13: "add use of cookies for the site and its permissions"): a middleware answers a declined visit count or PiEn lesson as done without doing it, and refuses with 403 the assessment, the panel, the weigh, the AI reviewer and an outside engine in /api/super/one (super_engine.py) when the cookie says no to outside providers; with no cookie at all it serves as before (API clients, tests), and a failure inside the check never blocks a request. `GET /api/cookies` lists every cookie and storage key the site uses (cookies.py COOKIES and STORAGE): the notice shows that list, so add a cookie or storage key there when the site starts using one, and keep cookies.py RULES and consent.js `allows` in step.

**Server request indicator** (super/requests.js + requests.css, owner, 2026-10-13: "create server request indicators"; trust that users' data and AI are not abused; "this is shown in the owner page only"): shown only once `/api/auth/session` says the owner is signed in (checked every 30 s); everyone else sees only "Privacy choices" in its place, which reopens the notice. It is a super by itself inside the main canvas (owner, 2026-10-13): drawn by the engine like the controls (engine.js KINDS), with four ports (owner `ctl:privacy`, site.js), seated at the main super's bottom-left inside its edge and above the conditions bar; a click or a wire that opens it opens the choices (controls.js openOne). Loaded first in <head>, it wraps fetch, XMLHttpRequest and sendBeacon and shows every request in a corner chip (bottom left, lifted above the conditions bar): a light while one is out, counts of requests, AI calls and saves; hover or focus lists each one: time, read / sent your data / to AI (which model, ours or an outside provider by name), path only (never query values or bodies), bytes sent, status, time, and the other sites the page loaded from. The list lives in the tab's memory only and is never sent anywhere. Keep its AI route list in step with back/routes when an AI endpoint is added.

**The selected super is surrounded in blue** (owner, 2026-10-13: "add blue surround for a super that is selected"): its own edge turns cobalt and thicker (engine.js and super.css), the main and second supers too; never a rectangle or a dotted line round it.

**The top bar is save, lock, chain and reset**, and they are buttons (owner, 2026-10-13: "lock button should lock in place"): a click on lock locks the selected super where it is (again: unlocks); save, chain and reset the same way; with nothing selected, they act on what they are wired to. **The page shows 0.5 s after it is requested** (super/boot.js MAX, owner: "reduce the 2.6 second delay to 0.5"), with a 0.3 s fade (owner, 2026-10-13: "remove these 3 buttons from control": open, compact and stop are gone from it; their code stays in controls.js for old wires), side by side, two either side of the main super's sync port ("put all these together"). **Blue means wired, nothing else** ("they should be blue if they are connected, only then"): a control or an arrow is cobalt only while a wire is on it; a lock or save state shows in its icon's shape (closed padlock, filled disk), never in blue. **Privacy choices is a super like the others** ("this is also movable and deletable, draggable etc., same as others"): it lives inside the second super ("put privacy choices in there and same it should act as other supers"): at the start just right of Connect (a phone: under the columns), kept in shares of the second super's box (se:at:privacy) so it follows that super's moves and the page's zoom; it drags, a double click deletes it until the app is reset (se:gone:privacy), and wired to the lock it keeps its place; a click selects it as it does any super, and a click on it once selected opens the choices; on a phone it starts right of the project, clear of the arrows. **The bottom bar is four arrows, smart buttons PiEn decides** (super/controls.js arrowGo, pien.js PiEN.rank; owner, 2026-10-13: "add only top, down, left, right arrows to this section", "each of these are smart buttons, using PiEn it decides what it does"): → and ← step through PiEn's ranking of the cards (the pills) a visitor is likely to want next, selecting and naming each; ↓ opens the one pointed at, else PiEn's first pick; ↑ closes the window opened last, else folds the selected bubble. They are supers with four ports (ctl:left, ctl:up, ctl:down, ctl:right): a click, Enter or a wire that opens one presses it. The conditions (if, then, + − × ÷, timer) are no longer on the bar; the same words still work typed into a super, and a stored timer no longer ticks. A wire from the lock control to the second or main super's own port locks that super (controls.js syncWired; it used to be skipped).

**A locked super holds what is in it in place** (owner, 2026-10-13: "initial lock system doesn't work"; super/lock.js SeLock.pinned): a super in a locked second super (locked at the start by the lock control's wire) or in a locked holder can not be dragged or deleted either; windows still move. Cut the lock's wire (or unlock) to rearrange. **The lock and the save wire keep a super** (owner, 2026-10-13: "everything is movable or deletable unless it's connected to lock", then "even though the save control wire is connected to the object, when double clicked it deletes"): a super connected to the lock (wired to the lock control, or locked by it; the main canvas and the logo start locked) can not be moved or removed by any gesture; a super wired to the save control can be moved but not removed (super/delete.js KEEPERS); everything else can, chained or not. Save keeps a state for reset to bring back; chain groups supers that move together. Removing a super still never removes what it holds. **Every connection makes a sparkle** (owner, 2026-10-13): a wire's end has a sparkle; at a port it is the port's own, and where the port's is not showing (a small super's tiny ports, a covered port) the wire draws one (super/wire.js).

**Removing a super** (super/delete.js, owner, 2026-10-13: "because the super was not connected to save icon and it was not connected to chain icon ... and it was not connected to lock icon, I was able to remove it. And when I removed it, it didn't remove the elements inside it. Make this a rule"; "this rule also applies the other way around"): a super wired to the save, lock or chain control can not be removed by any gesture (double click, scroll out at its smallest, drop outside the second super) until the wire is cut; saved or locked, it stays as before; one wired to none of them, unsaved and unlocked, can be removed. Removing a super never removes the supers inside it: they stay where they are (a holder dropped outside the second super leaves them where they were when the drag began, `SeHold.release`). `SeDelete.keeps(el)` says why one stays.

**Reset and saved states** (super/restore.js, owner, 2026-10-13): saving a super snapshots it and what it holds; saving the logo, or the save control on the main or second super, snapshots the page. Wiring the reset control to a super brings that super back to its last saved state; wired to the logo or the main loop (its edge or any of its ports), the whole app starts again as on a first visit (owner, 2026-10-13: "connecting the circular icon to logo or main loop, to reset the app"; SuperLink.reset). The page reloads once to apply it. The controls and conditions sit on the main canvas unless the next layer super covers more than 70% of the page (super/controls.js).

**Wiring** (super/wire.js): a wire passes behind the supers it does not join (clipped out of them); a wire into a sync or condition port arrives vertically, never running along an edge; a port shows no extra star where a wire meets it, and ports under a window that is not theirs are hidden; port names (the site's and the main super's too) show only while a wire is being drawn. Then: from an edge or a port at once (the pointer is a + there), from a word only after holding the press still for 280 ms (or with Alt), so a drag or a selection never starts a wire; inside a holder the same (a click on a holder's bare space over a wire reaches the wire); a wire snaps to a port within 26 px; a wire's two ends that together name a window open it (SuperLink.intent); a new wire touching a pill, a window, a compact bubble or Live opens it; **deleting a wire cancels what it did** (windows close, the bubble compacts, a Super AI super cut off from run stops and shows its question again); a double click deletes a wire, a click selects it (cobalt) for Delete, for text wires, bubble wires and node wires alike (one helper: SuperLink.selectable); hovering on a wire shows data flowing along it; wires are graphite, 1.5 px; **removing the title's wire into the site's sync resets the app** (everything kept under lv:, orbit:, se: and superai: is forgotten and the page reloads).

**Too small, a super closes** (owner, 2026-10-12): scrolled on out at its smallest, a window closes (its content all in view first) and a Super AI super or holder fades away with its wires (a holder with what it holds; never the central super); an open bubble or the project super compacts, which is its closing.

**Superellipses in every browser** (owner, 2026-10-12: "make everything superellipses, not round corners"): every rounded corner in the look is `corner-shape: superellipse(…)` (super/super.css); browsers without corner-shape (Safari, Firefox) get super/squircle.js, which paints each rounded element's background and border as an SVG superellipse of its size and colours (its own border-radius cut to 0.6 so the shape is drawn whole; no backdrop blur or box shadow outside it); `?sq=1` turns it on anywhere for testing.

**Everything always fully readable** (owner, 2026-10-12; super/legible.js, super/zoombox.js): type set under 11 px in a window's content is lifted to 11 px; a window's content is never fitted smaller than the scale that keeps its smallest type at 11 px on screen (the readable floor): a window too small for that grows (as far as the inner super lets, super/loop.js winCap), and content still bigger than its window moves by dragging it (the pointer is a hand); a window you sized yourself keeps its size. Anything else drawn under 11 px on screen is simply not shown (no box in its place: owner, "dont use censoring, simply dont show the word"); zoom in and it is text again. This covers every text in the look (super/legible.js ROOTS: windows' content, the project map, bubbles and their drawings, Super AI supers and holders, the project super, the title), so the zoomed-out start shows no unreadable type; words added or changed inside those (a drawing redrawn) are looked at at once (a MutationObserver), and the first fade-in waits for that check (super/boot.js), so no word flashes and then disappears.

**No sudden movement** (owner, 2026-10-12): everything moves slowly and steadily; super/motion.js stretches every tween (SLOW); bubbles' layout, bubbles growing step by step, windows pushed aside or sized to fit, a window's content zooming, a super stepping off another, the project super stepping off a window and text turning into boxes all glide or fade; the page has no zoom feedback (the inner super is locked).

**Nothing overlaps unless it is inside a super**: bubbles step out of the way of windows, supers and the project super (orbit.js obstacles), windows push each other apart and step off supers, gliding (supers never jump: the project super glides aside too) (super/loop.js separateWindows, keepWindowsIn: a window stays inside the inner super and, unless you sized it, takes no more than about half of it), a super dropped on anything steps off it (clear), the central super never steps aside. **Dropped outside the inner super, a thing is gone on purpose**: a super is deleted with its wires (a holder with what it holds; the central super comes back to the middle), a bubble is gone until the app is reset (orbit:gone:<key>), a window closes.

**Phones** (narrower than 700 px): supers marked `desktop` are left out, a window may take most of the inner super and never shrinks below a readable size, compact bubbles are smaller (compactSide), a swipe never opens a window, and a finger on an edge must hold before it wires.

**Live** is a window in the Explore bubble (live.js adds the pill; PiLive.open/close open and close it); its lines are written in SuperAI (`live`, `liveStatus`, `liveCounts`, `ago`). The side panel and its tab exist only in the round look.

**Since the last rule-book pass** (owner, 2026-10-12): the view starts zoomed out (START_ZOOM 0.62 on desktop, 0.6 on phones; the inner super zooms out to 0.25 and back to 1, super/loop.js), and opening a window zooms back to 1; Super AI supers start at 84 px (nodes.js ENGINE_BASE); the start adds a locked "hold shift + scroll" super beside run (`shift` in the program's diagram); a scroll in on a window's button, link, tab or toggle presses it (super/scroll.js PRESS; never a super, which is role=button too: a scroll on a super sizes it); the title super is bigger (164 × 46); the super under the pointer never moves (orbit.js placePills pins the hovered bubble; loop.js and project.js skip hovered windows and the project); wires are 2.2 px ink at 0.82, and the lattice is real wires drawn the same way: only the site's input and output to the main super's input and output (super/site.js; sync and condition go by the start's own wires, no loose sweeps); the π digits run along the title's wire (super/wire.js .sl-pi, as many as its straight stretch holds, with no count or status after them), not round the main loop; a Super AI super or ■ grown into a holder holds bubbles too: a bubble dropped wholly inside it stays there (orbit.js obstacles: a holder is in the way only of what straddles its edge) and moves with it; panes reflect each other in the engine (super/engine.js: each pane takes its six nearest neighbours, their light glows into the edge facing them and their edge shows as a faint compressed mirror image in the rim); and a load or reset shows only the light until the supers have settled, then fades everything in in place (super/boot.js, html.se-boot, set before the first paint). Then: a **third super** at the start (`hold` in the program's diagram, desktop only; at.inSite is its box in shares of the inner super, n = 12): a holder holding every bubble but Connect, the project, run and the hint; a holder takes the pointer only at its edge and top strip (nodes.js .lv-edge), so what it holds stays reachable, and moves from anywhere on its bare space too (owner: "a super should be movable anywhere not just at the top"; nodes.js BARE: a press on bare page inside a holder drags the smallest one there), and dragging it carries its supers, bubbles and the project (SeProject.moveBy); a change to the start bumps `se:start` in index.html's first script, which forgets the old layout once (lv:, orbit:, se:); the π line is plain black; **Shift + scroll** goes through super/shapehud.js (SeShape.step: smooth, with soft detents at n = 1, 2, π, 4 and 8; a readout by the pointer draws the shape with its n and name); the main super's ports sit on its edge (site.js mainPort), so the side wires meet it; and a hovered bubble stays put only while that covers nothing (orbit.js placePills). Supers almost touch (orbit.js GAP 3 px, 2 on phones; windows 3 px apart; a super steps off another by 4 px), and two unlocked supers (bubbles, the project) may overlap and merge; a locked one keeps clear (orbit.js blocks, lockEl). A layout with no free spot keeps a bubble where it was meant to be, inside the inner super (orbit.js keepInside), never outside it. A super's own n is its own: what is inside it keeps n = π (super.css resets --se-k-window on descendants), and the engine draws n down to 0.3 (stars). The Shift + scroll readout says "shift + scroll" and shows n → 0 and n → ∞ at the ends of a super's range; **Shift + drag** sizes a super's width and height apart (super/shiftsize.js: Super AI supers and holders via LabView.resize, windows, compact bubbles as se:size:<key>). The lock sits at the top centre of every super, just under its sync sparkle (a holder's name sits under it). The side wires are real wires in the program's diagram (main.input → site.input, site.output → main.output; a kept diagram gets them once, lv:side-wired), and every wire into a port runs right into its sparkle (wire.js endPoint). No magnifying-glass pointer anywhere. The lock toggles by a click as well as by a scroll in (lock) or out (unlock), with a target a little bigger than the padlock. A pinch (or Ctrl + scroll) does exactly what a scroll does, on the same things (super/scroll.js pick); only its small deltas are scaled. **Every super holds supers** (owner, 2026-10-12: "make all supers have every supers capabilities"; super/hold.js): a bubble, a window, the project super and a holder hold what sits wholly inside them (Super AI supers, compact bubbles, the project, windows); what is held moves with its host when the host is dragged or laid out elsewhere (SeHold.begin/follow/shift, hooked into the bubble, window, project and holder drags and orbit.js layout), is not in its host's way (orbit.js obstacles, loop.js separateWindows), and a double click inside a bubble, on a window's blank margin or on the compact project makes a Super AI super there (nodes.js: placed wholly inside, so it is held). A locked super is held by nothing and **keeps its size and its n**: a scroll, Shift + scroll or Shift + drag on it shows "locked" (super/scroll.js, shiftsize.js, project.js; a locked window's content still zooms). A window opens by growing out of its button, the window itself translated and scaled (super/shape.js open; close folds a plain pane back), never a stand-in drawn elsewhere, while its shape grows slowly from n → 0 to n = 12, which it keeps (owner: "when zooming on a button new super grows from n=0 to n=12 slowly"). Closing, it folds back into its button slowly while its shape shrinks from n = 12 to n → 0 (owner: "opened super shrinks from n=12 to n=0 slowly"; shape.js close, .se-fold). The main, second and third supers are drawn as every super is (owner: "all supers have the same effect"): glass, bevel, shadow (lying lowest), the sheen when hovered or selected, reflections (a holder is glass too, drawn under what it holds). A super's shadow follows how high it lies (engine.js heightOf, uLift: z-index, held or not, kind; ranked from the bottom): the one on top casts a bigger, softer, farther shadow, the one underneath a small close one. The background is flat paper with a fine grain (owner: "remove the gradient background color", "keep the grains"; engine.js light() and the grain line, glass.css body::before), a soft white halo of light behind the middle ("add back ground halo") and a light vignette toward its edges ("add light vignette"): no coloured glows or embers; panes have dark ink edges and darker shadows on it. A click on the main super closes nothing (nothing is clickable). The lock takes a scroll only on supers 70 px and bigger (a small super is sized by the scroll; the lock is clicked). **Every super follows the same logic** (owner, 2026-10-12: "make all supers consistent and same engine, same logic"): every kind (Super AI supers, holders, bubbles, windows, the project super, the title) is drawn by the same engine, has four ports, a lock (the title's is small, at its top), Shift + scroll for its n and Shift + drag for its width and height (the project via SeProject.resize, kept in its state; the title as se:size:title), holds supers (super/hold.js), and closes when it gets too small: a compact bubble or the compact project scrolled on out fades away and is gone until the app is reset (orbit:gone:<key>, se:gone:project; PiOrbit.gone), as dropping it outside the inner super does (the project too). A hidden bubble is hidden whatever its state (super.css .orbit-bubble[hidden]). **From smallest to filling the inner super** (owner, 2026-10-12: "a super can grow to fill the second super fully from minimize to maximize"; super/maximize.js SeMax): a Super AI super or holder grows as far as the inner super lets (nodes.js zoomNode max), and a window until it stops growing; a few scroll steps more and it glides out to fill the inner super (.se-max); a scroll out (a window's content all in view) glides it back to its box before. A super filling the inner super takes scrolls on its bare space (scroll.js pick). The Shift gestures are named "hold shift + scroll" and "hold shift + drag" (the hint super and the readout; a kept diagram takes the program's hint words). The hint super is kept across loads (it went at the second load for a while, by the old intro clean-up; lv:shift-back brings it back once). **A locked super keeps its place and its layer** (owner, 2026-10-12: "locking a super also keeps it in place and in its layer of the super its in"): it is not dragged (a note says so), the layout never pushes it (orbit.js placePills, loop.js separateWindows/keepWindowsIn, project.js settleFree, nodes.js clear), others step off it, and it stays held by the super it is in, moving with it (hold.js and nodes.js inside() include locked supers). **The main and second supers lock too** (super/lock.js lock hosts .se-lockhost-main/-site at the top centre of each loop, just beside the sync wire, above the nodes layer; se:lock:main, se:lock:site; the main super starts locked, owner: "main super should be locked as default", and unlocked it is kept as "0"): locked, Shift + scroll keeps their n and a scroll on bare space keeps the second super's zoom. **Verbs with what they act on** (owner, 2026-10-12: "this prompt should expand the explore", "this prompt and wiring should open analytics, and so forth"; nodes.js verbOf, findTarget, actOn): a super that says "open explore", "close analytics", "expand library", "hide the journal" (open/show/expand, close/hide/compact, pause/hold/stop, run/go/resume, then a bubble's name or a window's title, whole or its start) does it once its words are entered or its wiring changes, wired or not, and is never sent to the engines; a verb alone acts on what is wired in, and a bubble wired in expands or compacts. A bubble never rests half grown: when the scroll stops it glides on to open or back to compact, whichever is nearer (bubble.js _sbSettle; owner: "i cant see explore"). A closing window's fold aims at its own pill wherever that is while it folds, frame by frame (shape.js close; orbit.js buttonOf gives the window's own pill in its open bubble). **Shift + drag** moves the edge nearest the press, the opposite edge staying put, on any super: open bubbles too (kept as se:size:<key>:open) and a holder from its bare space (shiftsize.js). A growing bubble shows its drawing and its pills one after the other, never both (super.css: the drawing fades out over the first half, the name, links and pills fade in over the second). **Deleting a super** (owner, 2026-10-12: "any super can be deleted by double click if it is not locked. ask for a confirmation"; super/delete.js SeDelete.ask): a double click on an unlocked super (a Super AI super but run, a bubble, a window's blank margin or head, the compact project) shows two small supers by the pointer, a square that says "delete" and a sparkle that says "keep"; Escape or a press elsewhere keeps it; a locked super says "locked, unlock it to delete it". Scrolled on out at its very smallest, any super asks the same instead of closing at once; scrolled on in at its very largest, a bubble fills the inner super too (SeMax), and a scroll out anywhere on it brings it back. **Layers by dropping** (owner: "dragging and dropping into a super determines its layer"): a Super AI super dropped wholly on a window takes that window's layer (data-layer win:<key>, kept as `layer`), is drawn above it (nodes.js .lv-canvas-top) and moves with it; any other Super AI super lies under windows (the nodes canvas sits at z 11) and a window holds it only if it was dropped there (hold.js). A window still growing out of its pill (.se-opening) is held by nothing, so a layout shift cannot carry it off; windows are opaque paper in the engine (glass.css), and the engine draws panes in their nesting order (engine.js depthOf). Supers go right to the inner super's edge (orbit.js keepInside 0.98, loop.js insideLoop 2 px); a hovered bubble yields only to fixed obstacles, so opening Lab never makes it jump; a scroll on a holder's bare space is the holder's (scroll.js holderAt). **Any size if unlocked** (owner, 2026-10-12: "any super can get any size if its unlocked"; free size, keep the rules): Shift + drag and scrolling take an unlocked super from 16 px (a window you size, 24 px) up to the whole inner super, no fixed minimum or half-the-inner-super cap (nodes.js MIN_SIDE, shiftsize.js, project.js resize, loop.js winCap and minOf for a window you sized, super.css lifts the round look's 260 px window minimum); scrolled on out at that smallest it still asks before it goes, and dragged out to the whole inner super it fills it (SeMax.maximize with the box from before the drag; a scroll out gives that back). A window you have not sized keeps its readable minimum. A double click on a holder's bare space makes a super inside it (the press's own target counts, not the holder that captured it for its drag; nodes.js, delete.js); on its edge it asks to delete it. **The chain** (owner, 2026-10-12: "add chain icon which groups the supers inside it for every super near the lock icon"; super/chain.js): beside every super's lock (not the main and second supers' lock hosts) sits a chain; chained (se:chain:<name>, .is-chained), the super and everything it holds, all the way down (SeHold.heldBy), are one group: a drag on any member moves the whole group (SeHold.move), so nothing comes apart or is pulled out, and a press that does not move selects the member; unchained, what it holds still follows it, and each can be dragged on its own. A click toggles it, a scroll in chains, a scroll out unchains; it carries .se-lock too, so gestures leave it alone as they do the lock (lock.js uses .se-lock:not(.se-chain)); a locked chained group does not move. **Wired supers group** (owner, 2026-10-12: "if you connect two supers together or more, they are grouped as one super inside the super the sync is connected to"; nodes.js regroup, groupGraph): Super AI supers joined by wires (any wire between them but a sync wire, and wires dropped on a super's body, its inputs) are wrapped in a group super, a holder (`grp`, .lv-group, labelled "group") round them, chained (super/chain.js) so they move as one; it grows to keep them inside and never shrinks under you. A sync wire says where a super belongs: drawn into its sync sparkle from another super, or out of its sync sparkle onto one, its group goes inside that super (a holder, which grows to take it; an open bubble; a window, whose layer it then takes; the project), and a single Super AI super it is wired to grows into a holder to take it; the site and the main super are where it already is, and a group holding run never moves. Cut the wires apart and the group lets go (its holder goes, the supers stay where they are). Checked on every wire change and every 0.9 s. **Sunshine** (owner, 2026-10-12: "make background so sunshines like this glasses", an evening photo; this replaces the flat paper and the white halo above): a cool grey-blue overcast with soft clouds drifting across the upper sky, a warm peach glow along a low horizon (about 74 % down), a low sun to the right of the middle whose gold light rakes across in slow soft rays, warm ground light below, the grain and the light vignette kept (engine.js light(), the clouds in the page's background only; glass.css body::before draws the same without the engine); the panes show it through their frost, so the ones near the sun glow warm. **The sun hits the glass** (owner, 2026-10-12: "make the sun rays hit the glass"; engine.js PANE_FS, sunAt shared with light()): every pane knows which way the sun is and how near (sunK): its rays cross the glass, slanting from the sun; a warm wash lies over the side facing it; the edge facing it has a gold rim, a bright glint where it catches square on, a soft gold halo spilling just outside, and its ink line warms to bronze; the light gathers at the far inner edge as a lens focuses it (a soft caustic); the prism split is strongest on the lit edge. The CSS fallback keeps the plain glass. **Two kinds of connector, flow-language wires** (owner, 2026-10-12: "connectors sync and condition are same curvy wires and same thing and cannot connect to input/output", "input output wire thicker and color data type specific", "like flow language"; wire.js kindOf, clash, ctlCurve; nodes.js typeOfLink): sync and condition are one kind (control), input and output another (data). A wire joins two of a kind, or a port and something that is not a port (a super's body, a word); a sync or condition never joins an input or output: such a drop is refused with a note, even onto a body under that port, and stored wires that break the rule are dropped on load; SuperLink.add refuses them too. A control wire is one smooth curve leaving and arriving straight up or down (a super's top port upward, its bottom port downward; the lattice's ports and non-port ends toward the other end), fine graphite; the title's wire keeps its straight stretch for the π digits. A wire at a side port (input, output) is never curvy (owner, 2026-10-12: "side to side shouldnt be curvy"): out level, one straight run across, in level, with small superellipse corners (SeMorph.wire horizontal; nodes.js input wires too). A data wire (input, output, or one joining supers) is thick (3.8 px in the engine, 3.6 in CSS; a list 5.6) and coloured by the type it carries, as LabVIEW draws them, muted: a whole number blue #2a5aa8, a decimal orange #c0661c, text pink #b2457d, true/false green #3d7c3a, a list violet #6b4fa2, an AI answer teal #1f7a7e, nothing yet ink (engine.js TYPE_COLOR, super.css .sl-data[data-type]); the side wires (the lattice) are thick too. A group or a super growing to take one stays within the inner super, and the group's supers are pulled inside its frame (nodes.js inSite, pullIn). **Growing never takes in what was outside** (owner, 2026-10-12: "to encompass the connect automatically should not happen"; hold.js outsiders, growRoom, wouldMeet): a super scrolled bigger stops when it would touch a super outside it (a note says "stops here"), Shift + drag takes back a step that would, and filling the inner super (SeMax) is refused when it would take one in; a holder's top strip zooms with the page (hold.js topStrip). **Deleting without asking, saving instead** (owner, 2026-10-12: "remove these instead add a save icon next to the lock"; super/save.js, delete.js): the square/sparkle confirmation is gone; beside every super's lock and chain sits a save icon (a disk; se:save:<name>, .is-saved; a click toggles it, a scroll in saves, out unsaves); a double click on an unsaved, unlocked super deletes it at once, as a scroll on out at its smallest does; a saved super is never deleted (a double click, its smallest size or a drop outside the inner super leaves it, with a note "saved, unsave it to delete it"; dropped outside, it comes back inside). **The sky follows the system's dark mode** (owner, 2026-10-12: "dark/light only depend on the system darkmode setting not timezone", "remove the bottom horizon, and rays from background, do the same for light version"; index.html's first script SeSky.night(), html.se-night, --night, se:sky; engine.js uNight, tint(); glass.css html.se-night): the system's dark mode is the night look, else the day look (it switches live; ?sky=day or ?sky=night tries one). Both are one soft sky from top to bottom, with no horizon band, no ground and no rays in the background: a grey-blue overcast with soft clouds by day, a deep blue-grey with dark clouds and stars by night. The sun (low right of the middle) and the moon (high on the right) are not drawn; their light shows only on the glass, gold by day and silver by night (lighter frost by night, so words stay readable), and only small supers show rays (rayK: none on panes over about 110 px, so the main, second and third supers never carry a burst). **The favicon** in the superellipse look is a super (super/icon.svg; owner, 2026-10-12: "change the favicon to something like this"): a superellipse pane at n = 1.45 with a cobalt edge, an iridescent sheen low on its left, its four port sparkles and a dot at its centre; index.html's first script swaps the icon links when the look is on.

**The page always shows** (owner, 2026-10-12: a blank page in the dark): super/boot.js lifts the veil after MAX + 600 ms by a timer whatever happens (frames paused, an error elsewhere), and a failing text check never keeps it. **Only a selected super lights up** (owner, 2026-10-12: "only when selecting a super makes it light up"): no hover sheen or hint edge in the engine (engine.js hov false) or in CSS (glass.css sheen on .se-sel only; super.css hover hints removed); wires still show their flow on hover. **The main super zooms itself when unlocked** (owner, 2026-10-12: "if the main super is selected and locked, the second super gets zoomed in; if it's unlocked, its own gets zoomed in and out"; super/scroll.js, loop.js zoomMain, orbit:main:zoom): with the main super selected (a click on its bare space), a scroll on bare space zooms the second super while the main super is locked, and zooms the main super itself (its loop and everything in it scale together about the centre, from a quarter up to the screen; the title stays) while it is unlocked; resetting the view brings it back to 1. **Supers synced into a holder stay inside it and re-form with it** (owner, 2026-10-12: "these supers stay inside its loop no matter how you resize it or zoom it, nothing gets out because they are synced together", "the holder can shrink as small as it can... the members form into the new shape"; super/bind.js SeBind): a holder's members are the supers its sync reaches by control wires (its sync or condition into their sync, and on down; a member holder keeps its own). Each keeps its centre and width as shares of the holder: resized, the holder sets them there again (absolute, so many small steps never compound or swing; a bubble placed by PiOrbit.placeBubble, re-measured only after its glide), scaling by the smaller of the holder's two changes so a bubble stays square; a member you drag, open or size yourself takes its new place and size as its share; a super that newly joins (a sync wire from the holder into it) stays where it is if it is inside already, else takes the other members' size when bigger and the first free spot inside (owner: "this should put connect inside the third super"); dragged out of the holder, or dropped outside the site, it comes back inside (it is treated as saved); nothing is checked while a load settles. A holder with members, the start's third super (`hold`) and a group hold at any size, down to a sparkle (nodes.js keepsHold, keepHold: a ■ under 150 px otherwise stops being a holder, which once let a shrunken holder's members stay big outside it). A holder's top strip (lock and name) is in proportion to it (6.5 % of its height, at most 46 px: orbit.js obstacles, hold.js topStrip, bind.js inner), so a shrunken holder's members are never pushed out of it.

**The start is locked and saved; no chain icon** (owner, 2026-10-12: "all supers in initial state should have active lock and save on. delete the chain icon from all supers"; lock.js atStart, save.js atStart, chain.js, `se:start` 6): the main super, the title, every bubble, the third super and the project begin locked (the second super begins unlocked: owner, 2026-10-12, "default set second super loop is unlocked"; `se:start` 7), and all but the main and second supers (which are never deleted) begin saved; unlocking or unsaving one is kept as "0". Locked, a bubble and the project still open and compact by a scroll (the lock keeps their place, size and n), so the site is usable from the start. No super shows a chain any more; the save icon sits where it was, beside the lock; a group made by wiring is still chained, so its supers still move as one. A member bubble that is opening, open or filling the inner super is left to itself by super/bind.js (owner: "fix this bug": its pills spilled out while its size was held to its share); compact again, it takes its share back.

**A double click makes a prompt; wiring makes it a Display** (owner, 2026-10-12: "just double clicking creates either display or a prompt, depending on the connecting input to output. If input is a prompt, the output will show a display"; nodes.js makeHere, spawnAt kind, autoKinds, `auto`): a double click on bare space (or inside a bubble, a window's margin or the compact project) makes a prompt, a Super AI super drawn as a sparkle (n = 0.62), with no placeholder word ("dont write prompt place holder"); when a prompt's output is wired into such a super's input (or onto its body), that one becomes a Display, a complete square (n = 24, a plain ■) that shows what comes in; cut the wire and an empty Display is a prompt again. Only supers made this way change kind. A double right click and a double click on a holder's bare space make nothing (the browser's own menu is back); a double click on a super still deletes it when unsaved. **At its smallest a super is a sparkle** (owner, 2026-10-12: "minimum size can be a sparkle"; nodes.js MIN_SIDE 10, shiftsize.js, project.js, engine.js, bind.js se-sparkle): supers shrink to 10 px; under about 30 px the engine glides a super's shape to the port sparkles' astroid, and under 22 px it is marked se-sparkle: what it shows hides, and without the engine its box is cut to four points. The compact project is kept inside the second super by its own size, not the default one (project.js room).

**What is inside an open bubble is a super** (owner, 2026-10-12: "make inside supers same logic as outside it", full supers; super/inner.js SeInner, site.js owners name:<bubble> and pill:<key>, engine.js inner kind, lock.js/save.js): an open bubble's name box and window pills are glass panes drawn above their bubble, with four port sparkles, a lock and a save at their right end, their own n by hold shift + scroll and selection light; the soft curves are real wires (the name's output into each pill's input), drawn and behaving as every wire does (owner: "make inside wiring logic and super same as all supers"); cut one and that pill dims and its window does not open until it is wired again (se:pillcut). **Double click: square, prompt, Display** (owner, 2026-10-12: "double click creates a prompt and it's square, empty square. If it's connected to another prompt input, it becomes a prompt. And the second super becomes the display of the result"; nodes.js autoKinds): a double click makes an empty square (n = 24); its output wired into another super's input makes it a prompt (a Super AI super, a square too: owner, "prompt shape is square also") and that one its Display, which shows only the Super AI's answer to that prompt ("thinking…" while it asks; nodes.js promptInto), never its question; unwired, both are squares again. **No grouping** ("remove the grouping"): wired supers are no longer wrapped in group holders, and groups made before let go of their supers. An unlocked holder grows to take a member bubble that opens in it (super/bind.js), and a super shrunk to a sparkle shows no ports (site.js is-tiny). **Lensing** (owner: "add a lensing effect to the supers"; engine.js PANE_FS): each pane bends the sky behind it, magnifying a little through its middle and refracting along its edge.

**A locked bubble or project does not grow** (owner, 2026-10-12: "connect super is locked but it still grows, this is a bug"): a scroll on it, or on its pills, shows "locked", and SeBubble.open will not open a locked bubble (a wire or a verb either); unlock it to open it.

The title super is selectable like any super (select.js). A holder growing to take an opened member never grows over a super outside it, and a growing super stops 16 px short of an outside super (hold.js growRoom, wouldMeet), so the layout never pushes that super into it (owner: "3rd super shouldnt eat the connect super when gets bigger").

**Every super closes the same way** (owner, 2026-10-12: "closing a super should animate like n goes to zero and vanishes", "makes them uniform"; super/delete.js vanish): deleted (a double click, or scrolled on out at its smallest), any super, a holder too, glides its n to 0.3 (a star) while it shrinks into its centre and fades, then goes at once (LabView.close(el, true)).

**An open bubble behaves like the third super** (owner, 2026-10-12: "all of these should behave like 3rd super"; bubble.js fit, --in-z): sized by hand or held to a share by its holder, its name box and pills re-form to its box, scaled together (CSS zoom), never squashed.

**SuperAI assembly** (owner, 2026-10-12: "write the SuperAI language with graphical signs, Turing complete, and HAL-OS assembly", "use the connectors sync, condition, input, output as well"): the front end's program is written in `front/super/pitechlab.sasm`; `python back/scripts/build_program.py` assembles it with the Rust engine (back/rust/superai asm.rs, op `assemble`) into `super/pitechlab.super.js` (generated: edit the .sasm; `--check` verifies they agree). Signs: ◇ source, ◯ bubble, ⊕ merge, ■ ✦ ● ⊙ supers, ⟶ wire, ▭ map section, ▣ map super; the connectors ▷ output, ◁ input, △ sync, ▽ condition (`⟶ main△ site△`); `.key value`, `.put path "k" v`, `.push path v`, `.json path {…}`; blocks `diagram … end`, `graph name … end`, `map … end`, and `fn name params … end`: stack-machine code (back/rust/superai vm.rs: push, in, load/store, loadi/storei memory, arithmetic, jmp/jz/jnz to `label:`, call, ret, out, halt, and ◁ △ ▽ ▷ for the connectors; a million-step budget), which makes the language Turing complete. Prompting an LLM is an instruction (owner: "use prompting llm also as part of the programming language", "make it very simple"): `ask engine` (✦) sends the text on top to that engine (sim by default; rib, pid, pien, llama, mistral, qwen, gemini, deepseek) and puts its answer on top; the machine stops with the question (`asks`), `SuperAI.ask(name, inputs)` (super/superai-rs.js) asks /api/super/one and runs it again with the answer. Simple words: say, get, set, goto, if, ifnot, give, stop. BitLLM runs only inside HAL-OS's emulator, so it is not an `ask` engine yet. **Learn SuperAI** (owner: "create example on how to program a simple program on the web"): front/learn/index.html, served at /learn/, a course (owner: "create a page to teach me to program"): nine lessons (first program, numbers and math, inputs, remembering, decisions, loops, functions, supers and wires, ask an AI), each an idea with stack pictures and an example, then a challenge the page checks against tests (an AI lesson passes when the program asks), with a hint, an answer, a growing word list and progress kept as superai:course; run in the browser by the same wasm. The project super's editor shows the program as SuperAI assembly (the shipped super/pitechlab.sasm, or the text you ran last, superai:source) and takes assembly as well as JSON; ⌘/Ctrl + S downloads the form shown (.sasm or .json). runtime.js's own check knows the site's supers (site, main, title, project, run), so the shipped program passes it and can be edited.

**No sign icon on supers** (owner, 2026-10-13: "delete this", the grey ■ beside the lock): the signs ■ ● ◆ ✦ ▣ live in the language only (super/sign.js was removed). The assembly writes supers with them (◆ added; ▣ outside the map is a holder, `hold`).

**Every super starts at n = 1000, a square** (owner, 2026-10-13: "make all super n=10 initial state", then "make all n equal thousand"): the main and second supers, the title, every bubble (compact and open), an open bubble's name box and pills, every window (it opens from n → 0 to 1000 and folds from 1000), the project super (compact and open), the third super and every super made by a double click. One value: super.css --se-k-window 9.96578 (log₂ 1000), published by shape.js (no longer the live π) and read by the engine (engine.js nOf falls back to the page's k, then 1000; it draws n above 60 as 60, which already looks square). Hold shift + scroll reaches 1000 (site.js, nodes.js) and gives any super its own n (se:n:<name>). Buttons and cards inside a window are not supers and keep n = π. No n follows use any more (nodes.js autoN and shape.js's pill rule are gone).

**The start is packed close** (owner, 2026-10-13: "make the supers very close to each other"; super/pack.js SePack): on a first visit or after a reset, once the second super has stopped moving, Connect, the third super and its members are set 4 layout px apart (about 2 px on screen at the zoomed-out start), from the real compact size, so the same on every screen shape: Connect beside the third super, Tools → Explore → Library along its top, Lab and the project under Explore and Library, the third super wrapped round them with exactly the room super/bind.js keeps members in (padding 3.5 % of its smaller side plus up to 4 px; top strip 6.5 % of its height, at most 46 px; any closer and bind.js squeezed members together), the group in the middle of the second super; again on every load until you first press, scroll or wire on a super (se:touched); while the start is untouched, a resize of the window lays the start out afresh (it reloads: moving the laid-out supers live fought the layout and bind.js; SeBind.settle makes bind.js measure its members afresh after a pack). PiOrbit.placeBubbleAt(key, sx, sy) sets a bubble's target straight from a screen point. A locked super simply does nothing when dragged, scrolled, sized, opened or deleted: no "locked … unlock it to …" note anywhere (owner, 2026-10-13). The third super has no label ("delete super label"; a holder with no name shows nothing, never what is wired into it). **π and friends are off** (owner, 2026-10-13: "deactivate pi and friends counter and stop showing it"): no π digits along the title's wire, no "π and friends" window, no workers (numbers.js, orbit.js; window.PI_FRIENDS = true brings them back). **A super that opens is selected** (owner, 2026-10-13; select.js): a window as it appears, a bubble once grown open, the project once open.

**The start as the owner's picture** (owner, 2026-10-13: "set initial state of the app as this image"; super/pack.js START replaces the close packing): the view at 0.62; in shares of the second super (x of its width, y of its height), Connect a square of side 0.165 in its top-left corner (top 0.064); the third super at 0.168–0.387 × 0.069–0.376, holding Tools, Explore (top row) and Lab, Library (bottom row) as small squares of side 0.0155 centred at x 0.278 / 0.346, y 0.155 / 0.291 (so small they are sparkles); the project a wide box at 0.099–0.406 × 0.381–0.551, outside the third super (its sync wire comes from the site's sync). Sizes are kept as se:size:<key>; the program's at.inSite says the same; still laid out again on every load and window resize until you first touch a super (se:touched), desktop only.
 `SCHOLARPI_SHAPE=superellipse` stamps the look into index.html as it is served (back/shape.py), so a first visit lays out the superellipse site before the first paint.

`SITE_PASSWORD=…` puts a password on the whole deployment (back/gate.py: every page, API call and static file answers with a small password page or 401 until the visitor has typed it once; a signed HttpOnly cookie, an HMAC of the password with SESSION_SECRET, keeps them in for a month; changing the password logs everyone out; /api/health, /robots.txt and /api/gate stay open). Unset, nothing changes; never set it on production.

`SCHOLARPI_CHANNEL=experimental` turns on the experimental banner (not in the superellipse look, where the main loop fills the whole screen; noindex still applies), `robots.txt: Disallow` and `X-Robots-Tag: noindex`.

**QuVI is owner-only until its author approves.** `QUVI_PUBLIC=1` shows it to everyone. Do not set it, or work around it, unless the owner says the author has given permission (see the Lab's permission requests).

Status: the owner set `QUVI_PUBLIC=1` on **production** on 2026-10-09, so QuVI is public at pitechlab.com. The experimental environment still has it owner-only unless the owner sets the same variable there.

**Glass, light and shadows, second pass** (owner, 2026-10-13: "improve the glass reflection, light reflection and lensing effect, improve the shadows"; super/engine.js): the panes see the whole sky through their glass, clouds and stars too (sky(), shared with the background), so the lens has something to bend: a slab with a rounded bevel, magnifying a little through its middle and bending sharply outward over the bevel, the colours parting there; the bevel reflects the sky beside it more the steeper it is (Fresnel), a glossy streak lies across the upper left, and a soft highlight and a glint on the bevel follow the pointer (uMouse); neighbours show as a faint mirrored pane in the rim. The shadow is a dark contact shadow plus a soft penumbra cast away from the sun and the moon, longer the higher the super lies, cool by day and deeper by night, with a faint caustic of the light the glass gathers. For n of 2.2 and up the engine measures a pane as the rounded box that meets the superellipse at its corners (exact: the first-order estimate drew wings out of square shadows). **No blue rectangle on a selected super** (owner, 2026-10-13: "remove the blue corner rect"): it keeps its ink edge and its sheen shows the selection (engine and CSS); no browser focus ring on supers.

**Controls at the top, conditions at the bottom, in from the left, out to the right** (owner, 2026-10-13: "the top of the canvas have controls like stop, run, play, repeat, next, previous, and the bottom has conditions like time, when, how, then, if", "controls and conditions are only in the main canvas", "from the right is out, and from the left is in for supers, for every super"; super/controls.js SeControls): the main super alone carries two bars, either side of its sync port on its top edge (previous, stop, run | play, repeat, next) and of its condition port on its bottom edge (time, when | how, then, if); under the title on a narrow screen. The controls act on the selected super (with the main or second super selected, on every Super AI super): previous and next select the super before or after in reading order; run runs it once (a Super AI super asks, words typed into a plain super make it a Super AI super that asks, run from here counting as connected; a bubble opens, a pill opens its window, the project opens); stop stops it (asking stops, a window closes, a bubble or the project compacts) and stops play and repeat; play runs every Super AI super in turn, each after the last has answered and `time` apart; repeat runs it every `time`. The conditions are typed into their chips (Enter keeps, empty clears; se:cond): time (10, 10s, 2m; default 10 s), when ("changes", "start", or a clock time 09:30), how (the engines that answer: llama, mistral…; SuperPrompt.run opts.only), then ("next", "previous", "stop" or words such as "open explore", LabView.act), if (> 5, < 3, = yes, or a word the value must contain). The buttons are real buttons (the bars are the main canvas's own; select.js, scroll.js leave them alone). Every super's side ports are named "in" (left) and "out" (right), its top "control" and its bottom "condition" (site.js SHOW; the port ids stay input, output, sync, condition).

**The buttons are supers** (owner, 2026-10-13: "the buttons are super as well for wiring"): every control and condition has four ports (site.js owners ctl:<name>, cond:<name>; SeSite.value gives a control's name while it is on, a condition's value) and is drawn as a pane by the engine. A control wired to supers acts on them rather than on the selected one (the main or second super wired: every super); a condition wired from a super reads that super's value live (time, how; if: tested against the typed test, or wired alone the super must say something true; when: the wired super's change starts a run; then: the wired supers run after each run). A wired button's word turns cobalt. The selected main or second super keeps its ink edge (no blue outline round the screen).

**The start, again as the owner's picture** (owner, 2026-10-13: "the initial state of app is this picture"; super/pack.js, `se:start` 13): every bubble and the project the same square (the compact size, smaller only if the group would not fit), Connect on the left, the third super beside it holding Tools, Explore and Library along its top and Lab and the project under Explore and Library (the corner under Tools empty; Library.condition → project.sync again, so the project is a member), squares 2.7 % of their side apart, the third super's padding 12.5 % and its lock strip 15 %, the group in the middle of the second super; the view at 0.62. This replaces the small-squares picture above.


**Controls and conditions, final set, all icons** (owner, 2026-10-13: "the control buttons at the top are save, lock, open, stop, and the condition buttons at the bottom are if, then, plus, minus, multiply, divide, timer"; "delete these icons from the super and put these icons on the control. Everything should be iconized"; super/controls.js; this replaces the earlier previous/run/play/repeat/next and time/when/how sets): top, either side of the main super's sync port: save, lock | open, stop; bottom, either side of its condition port: if, then, + | −, ×, ÷, timer. Every button is an icon (its name is its tooltip and accessible name); the padlock and the disk are the ones the supers carried, and they show the state of what they act on (closed padlock: locked; filled disk: saved). The supers carry no lock or save icon any more (super.css hides .se-lock, .se-save and the lock hosts; locking and saving still hold). Controls act on the supers wired to them, else on the selected super: save and lock toggle it (the main or second super selected: lock toggles its own lock), open opens it (as run did: a Super AI super asks, a bubble or the project opens, a pill opens its window), stop stops or closes it and ends the timer. Conditions: if and then as before; + − × ÷ compute every super wired into them (by any port but their output) and the number typed in, showing "= result" and giving it at their output port (SeSite.value), so they wire on like any super; timer (10, 10s, 2m) opens the supers wired from it, else the super selected when it was set, every so often, counting down on itself; empty or stop ends it.
**The start wires the canvas in; locked by the lock wire; reset is a control; edges are lines of connectors** (owner, 2026-10-13: "initial state should look like something like this", a picture; "if I connect them to the lock control, they should stay locked"; "delete this reset button and instead put the reset in the control icons"; "each super can have many connectors", "the top line is control, bottom line is condition, left line is in, right line is out"; `se:start` 16):
- The start's diagram wires the controls and conditions in (pitechlab.sasm: `ctl:<name>` and `cond:<name>` are wire ends, known to runtime.js, lang.rs and nodes.js anchorOf/layoutProgram): save → Tools, Explore; lock → Connect, the third super, Tools, Explore, Library; Connect → if and then; Tools → then; the site and the project → timer. The title's wire into the site and the main super's sync and condition wires into the site are gone.
- A super wired to the lock control is locked and stays locked while the wire is there; cut the wire and it unlocks (controls.js syncWired, se:lockwired); one wired to save is saved. lock.js locks only the main super and the title at the start, so everything else (Lab, the project) moves freely. The lock and save controls act on the selected super; a wired one says it stays locked or saved while wired.
- A super wired from its condition port into a condition's top port is that condition's subject: if governs only its subjects, then follows only their opening (and opens what its out port is wired to), the timer opens them; a value wired into a condition's in port is what it reads.
- Reset is the fifth control (a circular arrow, after open and stop): a press arms it, a second press within 3 s starts the app afresh (SuperLink.reset, wire.js resetApp).
- Every side of a super is a line of connectors: a wire starts from, or is dropped on, any point along a side (wire.js nearEdge, within 9 px; the sparkle still wins within 12 px of it) and keeps where along it it is (the anchor's `t`, 0..1 from the left or the top; edgePoint), so one super takes many wires on each side; the main and second supers keep their sparkles.
- The controls and conditions look like supers (square at n = 1000, ink edge, frosted pane, its shadow; no button hover or press look).
- The connectors (port sparkles) are 15 px (owner: "make the connectors a bit bigger"; smaller supers still scale theirs by --port-s).
- The favicon is a super: a square pane with "pi" in it and its four port sparkles (super/icon.svg).
- orbit.js no longer keeps a box clear for the π counter while π and friends are off (it sat in the third super and threw back every bubble dropped there); the project lands exactly beside Lab at the start (pack.js measures its move).

**Universal laws** (owner, 2026-10-13):
- **A scroll sizes any super, always** ("scrolling in and out in any super should make it bigger and smaller always universal law"; super/scroll.js): selected or not (the scroll selects it), locked or not. A lock keeps a super's place (and its n), never its size: a locked bubble opens by a scroll (SeBubble.open no longer refuses it), a locked window, node, project or the second super sizes. The title sizes by a plain scroll too (the 0 key still resets the view). The "click it first" rule is gone.
- **Every super keeps 30 % of itself empty** ("there should be always 30% empty area in every super"; super/bind.js): what a holder holds covers at most 70 % of it; past that its members shrink together (their shares) until 30 % is free. Bubbles that are open, opening or filling are left out of the sum.
- **The chain control** ("add a chain control icon for grouping the supers"; controls.js, super/chain.js): the third control on the left of the top bar (save, lock, chain | open, stop, reset), two links; it chains the selected super, so it and everything it holds move as one group, or unchains it; a super wired to it stays chained while the wire is there (se:chainwired).

**The start, as the owner's latest picture** (owner, 2026-10-13: "set this as the initial state of the web app"; super/pack.js START, `se:start` 17; this replaces the earlier start pictures): in shares of the second super, Connect open at its top left (0.022–0.278 × 0.125–0.369); the third super at 0.323–0.951 × 0.112–0.928 holding Tools (centre 0.452, 0.358), the project (0.665, 0.315) and Library (0.851, 0.325) as squares of side 0.159 of the width, Lab under Tools (0.448, 0.708) and Explore open beside it (0.602–0.921 × 0.529–0.837); open bubbles are opened by pack.js and sized as se:size:<key>:open. Wires: site.sync → Connect.sync; Connect.out → hold.in; Tools.out → Explore.in, Explore.out → Library.in, Lab.out → project.in; Tools.condition → Lab.sync and Explore.sync; Explore.condition → project.sync; save and lock into the site's sync; the site's condition into then (the third super's sync wires to its members are gone, so its supers are held by where they are, not bound). Thin pills in a small open bubble are panes in the engine too (setPane takes half sizes over 2 px; inner panes never turn into sparkles).

**The start, as the owner's picture of 05:50** (owner, 2026-10-13: "this is the initial state of the app"; `se:start` 18; replaces the start above): Connect open at the second super's top left (0.023–0.298 × 0.162–0.309); the third super at 0.313–0.852 × 0.150–0.848 holding Tools, Explore and Library along its top (centres x 0.418 / 0.589 / 0.750, y 0.356) and Lab and the project under them (x 0.525 / 0.713, y 0.667), squares of side 0.157 of the width; a small square (`sq`, ■) below Connect whose output feeds if. Wires: site.sync → Connect and the third super; Connect.out → hold.in; Tools → Explore → Library; Lab → project; Explore.condition → Lab.sync, Library.condition → project.sync; save → Tools; lock → the site; Connect and Tools → then; the third super → if; the site → timer; sq.out → if.in.

**Supers inside a super size with it** (owner, 2026-10-13: "supers can dynamically get smaller or bigger if they are inside a super that restricts them from going out"; super/bind.js): a holder's members are now its wired members and everything it holds by being inside it (SeHold.heldBy), kept once taken in until you drag one out yourself (a wired member comes back in); resized, the holder scales and places them all by their shares, so they shrink and grow with it and nothing gets out. A holder blocked from growing round an opened member (it would meet a super outside) still scales its other members (it used to stop there).

**The start, as the owner's picture of 05:50** (owner, 2026-10-13: "this is the initial state of the app"; `se:start` 18; replaces the start above): Connect open at the second super's top left (0.023–0.298 × 0.162–0.309); the third super at 0.313–0.852 × 0.150–0.848 holding Tools, Explore and Library along its top (centres x 0.418 / 0.589 / 0.750, y 0.356) and Lab and the project under them (x 0.525 / 0.713, y 0.667), squares of side 0.157 of the width; a small square (`sq`, ■) below Connect whose output feeds if. Wires: site.sync → Connect and the third super; Connect.out → hold.in; Tools → Explore → Library; Lab → project; Explore.condition → Lab.sync, Library.condition → project.sync; save → Tools; lock → the site; Connect and Tools → then; the third super → if; the site → timer; sq.out → if.in.

**Supers inside a super size with it** (owner, 2026-10-13: "supers can dynamically get smaller or bigger if they are inside a super that restricts them from going out"; super/bind.js): a holder's members are its wired members and everything it holds by being inside it (SeHold.heldBy), kept once taken in until you drag one out yourself (a wired member comes back in); resized, the holder scales and places them all by their shares, so they shrink and grow with it and nothing gets out. A holder blocked from growing round an opened member still scales its other members.

**The compact control** (owner, 2026-10-13: "a compact button in the control, which compacts a super"; controls.js compactOne): four corners pointing in, after open (save, lock, chain | open, compact, stop, reset). On the selected or wired super: an open bubble folds back to its compact square (a compact one sized by hand goes back to the usual size), the project compacts, a window folds into its pill, a Super AI super goes back to 84 px, a holder wraps close round what it holds (keeping 30 % free; its members keep their sizes).

**Very small to very large, a wall at every edge, rainbow reflections, bigger buttons** (owner, 2026-10-13):
- "Any super can get smaller, including the one inside the [third] super... very small... very large, depending on the scroll or zoom": a compact bubble or the compact project scrolled out shrinks, down to a sparkle (10 layout px; bubble.js zoom, project.js wheel), and scrolled in grows back to its compact size, then opens and on to filling the second super; only at a sparkle does a further scroll out close it.
- "Add resistance to the super if another super wants to go out of the super. So it's like hitting a wall, but if you push hard, you can pass" (super/wall.js SeWall): a drag of a super lying inside another (SeHold.hostOf, else the second super) stops at the host's inner edge, giving a little (12 % of the push); once the pointer is 90 px past the wall the super breaks through and follows freely. Hooked into the bubble (orbit.js), Super AI super (nodes.js) and project (project.js) drags; drop decisions use the walled point.
- "Add some rainbow color shine to the reflected effect" (engine.js): a thin-film rainbow over every pane's bevel, its colours running along the edge and with the depth, drifting slowly; the glossy streak has a rainbow edge.
- "The buttons are not clickable and make them bigger": wire.js no longer takes a press on the canvas's bars for a wire from the main super's edge (it ate their clicks); the controls and conditions are 36 px tall with 20 px icons (30 px and 16 px on phones).
- The compact control: see above; the chain control: see above.

**The middle mouse button is Shift held** (owner, 2026-10-13: "middle mouse button is like shift scroll for scaling"): held, the wheel changes a super's n as Shift + scroll does (super/scroll.js midDown, set from the pointer press too, and the wheel event's buttons), and a middle drag sizes a super's width and height as Shift + drag does (super/shiftsize.js). The browser's middle-click autoscroll and paste are off in the look.


---

# Design (was DESIGN.md)

This is the project written from the top: what it is, the few rules everything follows, and then each part
in the order you meet it, as if it had been designed in one sitting. `CLAUDE.md` is the working log of the
same project; this document is its shape.

### 1. What it is

Pi Tech Lab (ScholarPi) is a research-assessment engine: you give it a paper, and a set of engines
score it (the pi-index, piX), review it, and record the assessment in a Proof-of-Research ledger. The
engine is a FastAPI service that also serves its own frontend, a single page of plain HTML, CSS and
JavaScript with no build step.

The site that presents it is not a menu over the engine. It is a diagram of the engine, drawn in one
shape, the superellipse, and operated in one language, wiring. The site is a *super* (a superellipse)
inside a *super*; every window, button, card and node is a super; the exponent n of each super says
what it is; and things do what they do because they are wired to each other, not because they were
clicked. This presentation is the **superellipse superlattice**, "super" for short, and it is what
super.pitechlab.com shows. The same code, with the look off, is the ordinary orbit site at
pitechlab.com.

### 2. The rules

Everything on the page follows these, and nothing on the page is an exception to them.

**Shape.** A super is |x/a|ⁿ + |y/b|ⁿ = 1. Its n is a number you can see: n < 1 is a star, 1 a diamond,
2 an ellipse, π a squircle (the house shape), ∞ a box. Every rounded thing on the page is a super at
some n: the main loop and the inner super at n = π until you change them, windows, bubbles, buttons,
cards, chips, inputs and selects at π, pills a γ star (n = 0.5772…, Euler's constant) beside their name
until used, dots and wire ends γ sparkles, nodes at whatever n you gave them. The constants are
computed live in the page (π by the π worker, γ by the constants worker); the shapes come from CSS
`corner-shape: superellipse(log₂ n)` where the browser has it and from clip paths drawn in the page
where it does not (Safari).

**Every super has a shape of its own.** Scroll just outside a super's edge (within about 28 px) and its
n changes, independently of every other super: the bare corners outside the main loop change the main
loop; the band outside the inner super's ring changes the inner super; the rim of a window, a card, a
bubble, a node, the title, the palette or the Live panel changes that one. Shift + scroll does the same
to the super directly under the pointer. A super keeps its n per browser.

**Inside a super, scroll sizes what is in it.** On bare space inside the main loop, the whole site
zooms; on a thing, that thing grows or shrinks; content that scrolls keeps scrolling. One gesture stays
on what it started on for half a second, so a thing shrinking away from the pointer keeps shrinking.

**Nothing leaves its super.** The main loop is the display itself (no padding: its a×b box is the
screen less its stroke), and it always holds everything: when a small n (a star) cannot hold the page,
the page scales toward the centre until it fits, all the way to n = 0, where the page is a point.
Windows live inside the inner super, where their bubbles are, no larger than about half of it, and the
bubbles step out of an open window's way and come back when it closes, so a window hides nothing.
Dragging the inner super moves the bubbles and their wires with it, never past the main loop.

**Wiring is what the mouse does.** A drag from any word, number, character, edge or port draws a wire; a
click is just a click. A window opens when a wire touches its button or its words, and closes when the
last wire touching it is deleted. When the words at a wire's two ends together name a window ("Assess"
to "Manuscripts"), that window opens. Double-click a wire to delete it, and every wire lying under
that point with it. Nothing on a pill looks pushable: no hand cursor, no hover glow, no tooltip. Enter
and Space still open things from the keyboard.

**Motion is one thing.** Every animation goes through one tween (anime.js when it loads, a small
requestAnimationFrame tween otherwise): windows morph out of their buttons and back, sizes, zoom and n
glide to where a scroll takes them, the ◆ grows while it thinks. While a pointer is down, a tween runs
or a scroll just happened, every wire and the lattice are redrawn once per animation frame, so a wire
never lags what it joins; at rest the page redraws four times a second and otherwise does nothing.
Layout is measured once per tick, never inside an animation frame.

**Ink on paper.** One typeface (Geist), sentence case, ink on paper with one cobalt accent for "here /
interactive", muted status colours, the π circle as the only ornament.

### 3. The page, from the outside in

**The main super.** The outermost loop fills the display. π's digits run small and faint along its
inside, creeping slowly round it (an eighth of the sweep's speed), the newest digit cobalt, with their
count; the digits come from the π worker and never stop (double-click the bare page to pause them).
Empty space inside the loop is the loop: a click there closes windows. With windows open the loop is
still drawn at page size but takes no clicks, and the π counter hides. Its n is yours to scroll, kept as
`orbit:mark:n`.

**The lattice.** The site is wired to the main super LabVIEW style through four ports on the sides of
the inner super: **input** (left; whatever is wired into it is the site's question, sent to every
engine), **output** (right; the engines' answer, a value you can wire onward), **sync** (top; the site's
clock, π's digit count, ticking), **condition** (bottom; wired false, the site pauses). Every super is a node of the lattice: open windows and
loops get the same four ports on their sides, and the wires follow the rule by where the ports are:
flow left to right (an output into the next super's input), sync down into the top, condition up
into the bottom. A lattice line
runs from each port to the main loop: input and output straight out, sync and condition as two curves
sweeping to either side. Every wire on the page follows the same rule: out of a side it runs nearly
straight with small superellipse corners; out of a top or bottom it sweeps in one curve. Ports are
wire ends like anything else.

**The inner super.** The site proper: a superellipse laid out inside the main one (86% × 80% of the
stage at zoom 1), holding the bubbles. Drag it by its ring; its offset is kept as `orbit:site:offset`.
Its n follows the main loop's until you scroll it apart (`orbit:site:n`). On a first visit the site is
zoomed out to half size (`orbit:zoom` 0.5), a small super in the middle of the page, and the only wire
is the title ("Pi Tech Lab") into the input port, so the site asks the engines about itself.

**The bubbles.** The engine's parts, as pills in bubbles: Connect (sign in, invite, support, contact),
Your account, SciM Assistant (a chat field), Lab (HAL-OS, Unigyro), Library (the global map of science,
Neuro Frenzy, MD), Explore (the journal, leaderboards, proof-of-research ledger explorer, recent
assessments), About (analytics, whitepaper, minting difficulty, GitHub, capabilities), Tools (assess
manuscripts, assist diagnosis, FaceMace). Bubbles are placed without overlap, shrinking together when
there is no room, and remember where you drop them; a pill is a γ star beside its name that grows with
use into the shape around it. Bubbles start unconnected; their wires are kept as `orbit:wires`.

**Windows.** A pill's window opens by wiring, morphing out of its button. It is a whole super; inside it
the same language holds: every corner is a superellipse corner, buttons, chips, tags, inputs and selects
are whole supers, cards are whole supers padded clear of their corners, tables and scrollers keep small
radii with the same corner. Zoom on a window to size it (there is no resize corner); its size and place
are remembered. A window stays inside the inner super and the bubbles make room for it.

**The title, Live and the palette.** "Pi Tech Lab" is drawn from superellipses (letters at n = 4, the
i-dot a γ sparkle) in a super badge; the Live panel (what the site is doing now: idle assessments,
today's count, the latest papers) folds to a tab inside the main loop; the Functions palette exists but
is hidden on super, where nodes are made by clicking. All three move when dragged from inside (not from
a word or button), stop at the main loop's edge, and remember their offsets (`se:move:<name>`) and
sizes (`se:size:<name>`).

### 4. The graphical language

A click on bare page inside the main super (no window open) makes a **node** there: a transparent,
uniform 56 px super in a random shape. Its n says what it is, and scrolling its shape changes what it
is, same id and wires:

| n | shape | glyph | it is |
|---|---|---|---|
| < 1 | star | + | add: numbers add, words join; alone on a button it opens it, on a window brings it up |
| 1 – 1.7 | diamond | ◆ | Super AI: what is wired in is its prompt; siM, riB, piD and PiEn each answer; it grows toward π while it thinks |
| 1.7 – 2.6 | round | ● | a dot: type a word or number into it; wired, it passes the value through; press it to pause what it is wired to |
| 2.6 – 5 | squircle | ■ | a box: shows whatever is wired into it; press it to stop (freeze) what it shows, press again to let go |
| ≥ 5 | box | ? | help: type a question and a panel of AI jurors answers; dropped on a thing it explains that thing |

Nodes mean what their inputs suggest, and for ■ and ● the first use decides for good: the first key
typed makes a text field (a letter) or an integer field (a digit); an operator typed (x × * · + - / ÷ :
^ %) makes it that operation on the numbers wired in; ■ dropped on an open window becomes that
window's stop button; ● sized past 104 px becomes a **loop**, a ring that counts once a second and
whose value is the result of what sits inside it (click its ring to pause, drag its ring to move it with
everything inside). Any number on the page is an input: wire it to a node. Drop a node on a wire to
remove the wire, on another node to wire them, on a button, window, the π mark or a port to connect
it. Nodes that grow step out of each other's way; nothing steps out of a loop. Double-click a node to
delete it, wires and all. The diagram is kept in the browser (`lv:nodes`, `orbit:textwires`).

### 5. The engines

Behind `/api` one FastAPI process runs everything, and all of it is one file, `back/api.py` (owner,
2026-10-13: "all .py in one .py"): what were core (the app, configuration, logging, the database, the gate,
rate limits, the startup hook), one router per concern (meta, auth, piq, chain, status, identity, arcade,
visits, profile, assessments, reviews, history, admin, reviewing, bugreport, assess, discover, scilem,
forecast, analytics, explorer; `meta_router`, `auth_router`, ...), the Lab, consent, layout, PiEn,
recent, live, traffic and Super Neural Engine routers and the static frontend follow one another under
banners naming the module each was. gunicorn runs `api:app`.
The engines behind the routes:

- **Assessment.** `brain.py` orchestrates a paper's assessment: deterministic scoring (`rubric.py`,
  `scientometrics.py`, `extraction.py`, `emission.py`) and multi-LLM consensus over the providers in
  `providers.py` (Llama, Mistral, Qwen, Gemini, DeepSeek) with a local model (Scilem). A provider that
  fails is skipped; only a content filter or a context overflow ends the chain.
- **The engines by name.** `sim_engine.py` (siM, the SciLM learning engine and its calibration),
  `rib_engine.py` (riB, the Research Buddy; `rib_suggest.py` serves papers to read and hot topics),
  `pid_engine.py` (piD, pi-Dyne forecasting), `pien.py` (PiEn, the shared model that learns from
  assessments); `emission.py` sets piQ's minting difficulty, `arcade.py` scores the Science Map game. `super_engine.py` asks
  all of them one prompt (`POST /api/super/ask`, the ◆) and runs the panel of jurors with a judge
  (`POST /api/super/panel`, the ?).
- **The record.** `ledger.py` and `paper_store.py` keep the Proof-of-Research ledger in SQLite
  (`database.py`, `persistence.py`), with optional Ethereum/IPFS backup (`integrations.py`; the
  contracts and zk circuit are at the repository root). `recent.py` lists recent assessments,
  `live.py` feeds the Live panel, `traffic.py` counts visits by day, `idle_worker.py` assesses
  open-access papers by itself while the site is quiet.
- **People.** `auth.py` signs researchers in; `layout.py` syncs a signed-in user's layout;
  `consent.py` handles permission requests (the Lab's private projects stay on the server volume,
  `lab.py`); `challenge.py` and `authorship_challenge.py` verify authorship; `abuse_guard.py` and
  `security.py` keep the rest honest; `assistant.py` is SciM, the chat.
- **The door.** `gate.py` puts a password on a whole deployment when `SITE_PASSWORD` is set: every
  page, API call and static file answers with a small password page until the visitor has typed it
  once, and a signed cookie (an HMAC of the password with `SESSION_SECRET`) keeps them in for a month.
  It is never set on production.

### 6. The frontend, in the order it loads

`index.html` loads, in this order:

1. `style.css`, `theme.css`: the design language and the app's styles; `orbit.css`, `super/nodes.css`,
   `live.css`, `traffic.css`, `super/super.css` (the super look, on by host name `se.*` or `super.*`,
   `SCHOLARPI_SHAPE=superellipse` or `?shape=se`, including the Safari fallbacks).
2. `app.js`: the application: assessment, the ledger explorer, sign-in, the windows' contents. Large and
   load-bearing; new work goes in small modules beside it.
3. `channel.js`: which site this is (the experimental banner, the super look).
4. `orbit.js`: the orbit layout: the mark, the main loop, bubbles and their placement, windows, the
   bubble wires, the fit that keeps everything inside the loop, the inner super's box and offset, and
   the `PiOrbit` API every other module uses.
5. The pills' modules: `pi-worker.js` and `numbers.js` + `consts-worker.js` (π and friends),
   `pien.js`, `capabilities.js`, `architecture.js`, `peeks.js`, `recent.js`, `intern.js`,
   `performance.js`, `unigyro.js`, `neurofrenzy.js`, `facemace.js`, `medicine.js`, `ribsuggest.js`,
   `live.js`, `download.js`, `traffic.js`, `lab.js`, and `hal/` (HAL-OS in a v86 emulator) and
   `quvi/` (a browser port of QuVI).
6. The super look, one concern per file (`front/super/`): `super/loop.js` (the main super: the loop the
   size of the page, its n, the zoom and the fit, windows kept inside the inner super, the inner super's
   box and offset; created by orbit.js with what it needs from the layout), `super/logo.js` (the title), `super/motion.js` (the one tween and the
   per-frame redraw signal), `super/shape.js` (shapes, wires' paths, windows morphing), `super/nodes.js` (the
   graphical language), `super/wire.js` (wiring as the mouse's default; edges and ports as wire ends;
   opening by wiring), `super/move.js` (moving the title, palette and Live), `super/site.js` (the inner super,
   its ports, lattice and values; every super's own shape; windows clipped to supers where CSS cannot),
   `super/scroll.js` (what a scroll does, where), `super/hover.js` (the super under the pointer lights up cobalt), `super/select.js` (a super has to be selected before anything inside it answers).

Everything the page remembers lives in `localStorage` under short prefixed keys (`orbit:`, `se:`,
`lv:`), and a signed-in researcher's layout is synced through the backend.

### 7. The three sites

| Site | Branch | What it is |
|---|---|---|
| pitechlab.com | `main` | Production. Real users, real data. Promoted by merging `experimental` after the owner has looked. |
| exp.pitechlab.com | `experimental` | Evolves constantly; separate data; `SCHOLARPI_CHANNEL=experimental` shows the banner and sets noindex. |
| super.pitechlab.com (se.) | `super` | The superellipse superlattice, deployed alone from its branch. |

Each is a Railway environment built by Nixpacks (`nixpacks.toml`: Python only, no Docker) and started
with gunicorn. `python back/scripts/tools.py run` runs it locally at
http://localhost:8000.

### 8. Working on it

Before a push: `cd back && python -m pytest -q` against the known baseline;
`python back/scripts/tools.py build-hal --src ../HAL-OS` (refuses if HAL-OS and `front/hal/wire.js`
disagree); load the site at desktop and 390 px widths with no page errors and no horizontal scroll.
Work goes to `experimental` (or `super` for the super site); `main` only when the owner says so. The
repository is public: no secrets, no `.env`, nothing from private projects. Credits that are not ours
stay theirs: Unigyro and QuVI are Murtaza Vefadar's, HAL-OS, Neuro Frenzy and FaceMace come from their
own repositories.


---

# The experimental site (was EXPERIMENTAL.md)

A second copy of the site that deploys from the `experimental` branch, keeps its own data, and tells every visitor it's experimental. You change it freely with Claude, and promote to pitechlab.com only when you like what you see.

### One-time setup (about 15 minutes)

**1. GitHub Desktop: create the branch**
Branch → New Branch → name it `experimental`, based on `main` → **Publish branch**.

**2. Railway: create the environment**
Open the project → environment switcher at the top (it says *production*) → **New Environment** → name it `experimental` and choose to duplicate *production*. Then, in the new environment:

- **Service → Settings → Source**: set the branch to `experimental`.
- **Volume**: check that the service has its **own** volume, not production's. Experiments must never touch real data. If none is attached, add one.
- **Variables:**
  - `SCHOLARPI_CHANNEL` = `experimental`
  - `SCHOLARPI_STABLE_URL` = `https://pitechlab.com`
  - `SESSION_SECRET` = a **new** random value, so sign-ins don't carry across sites
  - `FRONTEND_ORIGIN` = `https://exp.pitechlab.com`
  - `ORCID_REDIRECT_URI` = `https://exp.pitechlab.com/api/auth/orcid/callback`
  - Remove `ETH_ADMIN_PRIVATE_KEY`, the Pinata keys and any other key that can act on real accounts, unless you deliberately want experiments to use them.

**3. Domain**
- Railway (experimental environment) → service → **Settings → Networking → Custom Domain** → `exp.pitechlab.com`.
- Porkbun → pitechlab.com → DNS → add a **CNAME**: host `exp`, answer = the target Railway shows. Add any verification TXT record it shows too.

### Day to day

- Ask Claude for a change. It works on `experimental`, runs the checks in `CLAUDE.md`, and pushes after you agree.
- Railway redeploys exp.pitechlab.com. Look at it there; a slim black strip at the top shows it's the experimental build.
- When you're happy, **promote it**: in GitHub Desktop, switch to `main` → Branch → **Merge into current branch** → `experimental` → Push. pitechlab.com updates.
- If an experiment goes wrong, nothing reached the main site: revert the commit on `experimental`.


---

# The pi-Index framework, v2 (was pi-Index-Framework-v2-REWRITE.md)

> **How to use this file.** Everything outside the `⚠ VERIFY` and `⟨FILL⟩` markers is
> ready to use. Everything inside them is a factual claim only you can make truthfully —
> a real DOI, a real repository URL, a real measurement. Do not compile with the markers
> still in place, and do not replace them with plausible-looking values.
>
> **Why that instruction is not boilerplate.** Your own pipeline resolves cited DOIs
> against OpenAlex and Crossref (`reference_integrity`) and audits them
> (`audit_citation_integrity`). A fabricated DOI does not read as a real one — it
> resolves to nothing and is counted as a *fabricated reference*. Under your own rubric,
> an invented DOI scores **worse than no DOI at all**.

---

### Read this before you compile

Your rubric's own docstring says the composite is "a **reporting and integrity score**
that includes an interpretive component, not a measurement of research quality."

That sentence sets the ceiling on what this rewrite can honestly do. The score rewards
MDAR adherence, RRID density, reproducibility artefacts, empirical density, reference
integrity, open licensing and persistent identifiers. Your manuscript is a **conceptual
framework paper**. It has no experiment, no sample, no protocol and no resources — so
several of those signals have nothing to measure, and the honest score for a theory paper
under a reporting rubric is *structurally* below that of a well-reported empirical study.

So this rewrite does two things, and refuses a third:

| | |
|---|---|
| **Adds what is genuinely missing and genuinely true** | DOIs on real references, data/code availability pointing at software that exists, an explicit licence, CRediT roles, ORCID, a conflict-of-interest disclosure, a limitations section, and a methods section precise enough to reimplement |
| **Restructures so existing substance is findable** | The mathematics is already there; it was not in a shape the extractors or a referee could credit |
| **Does not fabricate** | No invented RRIDs, no fictional blinding or randomisation, no power analysis for a study with no participants, no preregistration that does not exist, no statistics for experiments never run |

The single largest *honest* gain available to you is not in this file, because I do not
have the numbers: **§8 reports real measurements from the deployed system.** A framework
paper that reports its own deployment's corpus size, engine calibration error and
inter-model agreement stops being purely conceptual. That is a better paper *and* a
higher score, and the two coincide precisely because the measurement is real.

---

### Title page

**The π-Index Framework: A Multidimensional, Algorithmic Architecture for Responsible
Research Assessment**

Ali Vafadar Yengejeh ^1
ORCID: ⟨FILL: 0000-0000-0000-0000⟩

^1 Università degli Studi di Milano-Bicocca, Milan, Italy
Correspondence: ⟨FILL: institutional email⟩

**Preprint.** Version 2.0 · ⟨FILL: date⟩ · Licensed CC BY 4.0
Preprint DOI: ⟨FILL: Zenodo/arXiv DOI, or delete this line⟩

> *Title change:* "Paradigm" → "Architecture", and the Lombardy framing moved out of the
> title into §9 where the case study lives. A title naming one region tells indexers the
> work is regional; the architecture is not, and C3/C4 both read the title. This is a
> presentational fix, not a claim change.

---

### Abstract (structured)

**Background.** Research assessment relies on citation-derived proxies — the h-index,
journal impact factors, raw citation counts — that became administrative targets and,
per Goodhart's Law, ceased to be reliable measures. DORA and the Leiden Manifesto both
call for multidimensional, discipline-aware assessment, but neither specifies a
computable alternative.

**Problem.** The obvious substitute, "LLM-as-a-judge", fails in documented ways: positive
bias, hallucinated critique, conflation of fluency with rigour, and susceptibility to
adversarial prompting. A single model asked to rate a manuscript produces a number with
no error bars and no audit trail.

**Approach.** This paper specifies the π-Index Assessment Engine: eight criteria (C1–C8),
each a weighted sum of named signals normalised to [0,1], adjudicated across an
independent multi-model panel rather than a single judge, with the deterministic
components — MDAR adherence, RRID validity, reference resolvability, reproducibility
artefacts — computed from the manuscript text without model involvement. Every score is
anchored to an append-only Proof of Review ledger.

**What is measured, and what is not.** ⟨NEW — the most important paragraph in the paper.⟩
Six of the eight criteria measure *reporting practice*, which is objective and verifiable.
Two — originality (C1) and societal impact (C4) — are not properties of a document:
novelty is a relation between a manuscript and its field, impact a relation between a
manuscript and the future. Neither is recoverable from a PDF. They are retained because
readers want them, marked as interpretive, and materially down-weighted. The composite is
therefore a reporting-and-integrity score containing an interpretive component, **not a
measurement of research quality**, and the engine reports what fraction of each score
rests on verifiable evidence.

**Results.** ⟨FILL from the live deployment — see §8. Corpus size, panel agreement rate,
SciLM calibration error against panel consensus, proportion of cited DOIs resolving.⟩

**Significance.** Stating a rubric as a published weight table makes it arguable, and a
rubric that can be disagreed with is one that can be improved — which is the property
citation counts lack.

**Keywords:** research assessment · scientometrics · responsible metrics · DORA ·
Leiden Manifesto · peer review · large language models · reproducibility · MDAR ·
open science

---

### 1. Introduction

*(Retain your existing text — it is the strongest part of the manuscript. Three changes.)*

1. **Attach DOIs to every reference on first citation.** Currently zero of 22 references
   carry one. Under your own `reference_integrity` signal this is the single largest
   recoverable loss in the paper, and it is pure formatting: the works are real and
   published.

2. **Cut the self-description.** "developed as an independent, individual research
   endeavor by the author", "conceptually developed and entirely authored as an individual
   research project at the Università degli Studi di Milano-Bicocca" — this appears in
   both the abstract and §1. It is a claim about provenance, not about the work, and a
   referee reads repetition of it as insecurity. Once, in the CRediT statement, is enough.

3. **Move the promise of a contribution list to the end of §1**, so a reader knows what
   the paper will deliver before the mathematics starts.

**Add as the final paragraph of §1:**

> **Contributions.** This paper contributes: (i) a fully specified eight-criterion rubric
> in which every weight is declared rather than fitted, published as a versioned table
> (§5, Table 1); (ii) a multi-judge adjudication protocol with an explicit corroboration
> requirement, replacing single-model rating (§4); (iii) a deterministic reporting-signal
> layer — MDAR, RRID, reference resolvability, reproducibility artefacts — computed
> without model involvement, so that the verifiable portion of any score is separable
> from the interpretive portion (§5, §7); (iv) an append-only Proof of Review ledger
> making assessments auditable after the fact (§6); and (v) an open-source reference
> implementation with a live deployment (§8).

---

### 2–4. Diagnosis and architecture

*(Retain. Two additions.)*

**§2 — add a scope statement.** The Italian and Bergamo material is a case study; say so
explicitly, or a referee will read a general claim resting on regional evidence.

**§4 — add the adjudication protocol.** ⟨NEW⟩ This is the paper's central methodological
claim and it is currently asserted rather than specified. State, precisely:

- how many judges are queried, and how independence between them is established;
- the adjudication rule that turns *n* ratings into one (median? trimmed mean? and what
  happens to outliers);
- the **minimum independent-source requirement** below which no consensus is recorded —
  and why an uncorroborated verdict is refused rather than accepted with low confidence;
- which routes are excluded from adjudication and why. Your own implementation excludes
  the structural analyser from judging, on the grounds that a deterministic component
  must not vote on the score it feeds. That is a genuine design insight and it is not
  in the paper.

---

### 5. The eight criteria

*(Retain the mathematics — it is the substance. Restructure the presentation.)*

**Add Table 1: the rubric as a published weight table.** Every criterion, every signal
feeding it, every weight, and whether the criterion is interpretive. Your rubric module
already contains exactly this; the paper does not. A referee cannot audit prose
containing tensors, and a weight table is the artefact that makes the whole framework
falsifiable.

| Criterion | Signals and weights | Interpretive? |
|---|---|---|
| C1 Originality | ⟨FILL from `rubric.py`⟩ | **Yes** |
| C2 Methodological rigour | ⟨FILL⟩ | No |
| C3 Interdisciplinarity | ⟨FILL⟩ | No |
| C4 Societal impact | ⟨FILL⟩ | **Yes** |
| C5 Open science | ⟨FILL⟩ | No |
| C6 Literature integration | ⟨FILL⟩ | No |
| C7 Empirical density | ⟨FILL⟩ | No |
| C8 Future actionability | ⟨FILL⟩ | ⟨FILL⟩ |

**For each of C1–C8, add one sentence naming the failure mode.** "C1 measures epistemic
displacement from the field's centroid; it therefore cannot distinguish genuine novelty
from unfamiliar terminology, and rewards the second." Naming a limitation is how a
referee learns you understand your own instrument — and C2 rewards exactly this.

**Add §5.9 — Sensitivity.** ⟨NEW⟩ How much does the composite move when a weight moves?
If a 10% perturbation reorders the leaderboard, the weights are load-bearing and must be
defended; if it does not, say so — that is a strong result and a cheap experiment to run
against your existing corpus.

---

### 6. Proof of Review ledger

*(Retain. Add the threat model — currently missing and a referee will ask.)*

State what the ledger does and does not protect against: it makes an assessment
tamper-evident *after* recording, but does not make the assessment correct. Anchoring a
hash proves the score has not changed since it was written; it proves nothing about
whether the score was right. Distinguishing these is the difference between a security
claim and a marketing claim.

---

### 7. Topological mapping

*(Retain.)* Add the proportion normalisation used to prevent a single high-volume field
from dominating the map — a real implementation detail that belongs in the record.

---

### 8. Deployment and measurement ⟨NEW SECTION — HIGHEST-VALUE ADDITION⟩

> This section does not exist in the current manuscript, and adding it is worth more —
> to the paper and to the score — than every cosmetic change above combined. It converts
> the work from a proposal into a proposal *with evidence*.

Report, from the live deployment:

- **Corpus.** Papers assessed, distinct fields covered, date range. ⟨FILL⟩
- **Panel behaviour.** How often judges agree; how often adjudication is refused for
  insufficient corroboration; distribution of independent-source counts. ⟨FILL⟩
- **Calibration.** The structural engine's mean absolute error against panel consensus,
  *versus its own default weighting as a baseline*. Reporting error without a baseline
  is uninterpretable; the baseline is what makes it a result. ⟨FILL⟩
- **Reporting-signal prevalence.** What fraction of assessed manuscripts carry a data
  availability statement, an open licence, any valid RRID. This is a finding about the
  literature, independently publishable, and it is sitting in your database. ⟨FILL⟩
- **Reference integrity.** Proportion of cited DOIs resolving across the corpus. ⟨FILL⟩

**State the sample and its limits.** A corpus that is small, self-selected, or dominated
by one field is still worth reporting — but only if reported as such.

---

### 9. Case study: Lombardy and Bergamo

*(Your existing §8, relabelled.)* Framed explicitly as an illustrative application, not
as validation.

---

### 10. Limitations ⟨NEW SECTION⟩

> A limitations section is not a concession. Under C2 it is evidence of methodological
> self-awareness, and its absence from a paper this ambitious is conspicuous.

At minimum:

1. **The composite scores reporting, not quality.** A rigorous study reported carelessly
   scores below a slight study reported immaculately. This is a real inversion, it is
   inherent to the approach, and it must be stated by the framework's own author before
   a critic states it first.
2. **C1 and C4 are model opinion.** They are not measurements and the paper should not
   present them as such.
3. **Goodhart applies reflexively.** ⟨THE POINT A REFEREE WILL RAISE, SO RAISE IT⟩ The
   paper argues that metrics decay once they become targets. The π-Index is a metric. If
   it were adopted as a target, authors would optimise for MDAR keywords, RRID counts and
   DOI density rather than for the practices those signals proxy. The framework's own
   thesis predicts its own decay. Address this directly — the honest answer is that
   optimising for the π-Index at least requires performing the reporting practices, which
   have independent value, whereas optimising for citation counts requires only
   citations. That is a *weaker* claim than immunity, and it is the defensible one.
4. **Single-author, single-institution, no external validation.**
5. **English-language, PDF-native, machine-readable text assumed.** A scanned manuscript
   or a non-English one is measured worse, and that is a bias in the instrument.

---

### 11. Conclusion

*(Retain, trimmed.)* Remove any claim §8 does not now support.

---

### Back matter ⟨ALL NEW — none of this is currently in the paper⟩

#### Data and Code Availability

> ⟨FILL — and only claim what is actually public and actually reachable.⟩

```
The reference implementation of the π-Index Assessment Engine is available at
⟨FILL: repository URL⟩ under ⟨FILL: licence⟩. The version described in this paper is
tagged ⟨FILL: version/commit⟩ and archived at ⟨FILL: Zenodo DOI⟩.

The rubric weight table (Table 1) is machine-readable at ⟨FILL: path⟩.

Assessment records underlying §8 are available at ⟨FILL⟩. [If manuscripts cannot be
redistributed for copyright reasons, say exactly that, and state what derived data IS
available — a restriction stated is a restriction respected; a restriction omitted
reads as an absence.]
```

#### Software and Licensing

Implementation: Python ⟨FILL⟩, FastAPI ⟨FILL⟩, SQLite ⟨FILL⟩. Ledger anchoring on
⟨FILL: chain⟩. Language models queried: ⟨FILL: exact model identifiers and dates⟩ —
model versions change under a fixed name, so an undated model name is not reproducible.

Code: ⟨FILL: licence⟩. Text: CC BY 4.0.

#### CRediT Author Statement

**Ali Vafadar Yengejeh:** Conceptualization; Methodology; Software; Formal analysis;
Investigation; Data curation; Writing – original draft; Writing – review & editing;
Visualization; Project administration.

#### Competing Interests ⟨READ THIS ONE CAREFULLY⟩

> This is not a formality in your case, and omitting it would be a genuine problem.

```
The author designed the π-Index framework, developed and operates the ScholarPi
platform that implements it, and is the owner of the deployment on which the
measurements in §8 were obtained. The author therefore has a direct interest in the
framework's adoption.

Assessments of this manuscript produced by the π-Index engine should be interpreted in
light of this: the author controls both the instrument and the manuscript being measured.
No score this framework assigns to this paper constitutes independent validation of
either.
```

**Why this paragraph has to be there.** If you assess this paper on your own platform and
it tops your own leaderboard, that result is worthless as evidence *unless* the conflict
is disclosed — and actively damaging if it is not. A reader who discovers the arrangement
themselves will discount the whole framework. Disclosed, it costs you nothing a careful
reader would not have worked out; undisclosed, it is the finding.

#### Funding

⟨FILL — "This research received no external funding" if true.⟩

#### Acknowledgements

⟨FILL, or delete. An empty section scores nothing and reads as padding.⟩

---

### References — add DOIs

Zero of your 22 references carry a DOI. These are real, published works; the DOIs exist.
This is the highest-yield mechanical change in the document.

> **⚠ VERIFY EVERY ONE.** The DOIs below are from memory and I am not certain of them.
> Resolve each at `https://doi.org/⟨doi⟩` before compiling. Under your own
> `reference_integrity` signal an unresolvable DOI is counted as a *fabricated
> reference* — strictly worse than leaving it out. Check, or omit.

| # | Work | DOI to verify |
|---|---|---|
| [1] | Hicks et al. (2015), Leiden Manifesto, *Nature* 520:429–431 | `10.1038/520429a` |
| [13] | Leinster & Cobbold (2012), *Ecology* 93(3):477–489 | `10.1890/10-2402.1` |
| [14] | Mandelbrot & Van Ness (1968), *SIAM Review* 10(4):422–437 | `10.1137/1010093` |
| [15] | Wang, Song & Barabási (2013), *Science* 342:127–132 | `10.1126/science.1237825` |
| [16] | Wilkinson et al. (2016), *Scientific Data* 3:160018 | `10.1038/sdata.2016.18` |
| [18] | Boguñá et al. (2021), *Nat. Rev. Physics* 3:114–135 | `10.1038/s42254-020-00264-4` |
| [19] | Nickel & Kiela (2017), *NeurIPS* 30 | ⟨no DOI — cite arXiv `1705.08039`⟩ |
| [12] | Rényi (1961), *Berkeley Symposium* | ⟨no DOI — proceedings; cite URL⟩ |
| [3] | DORA (2012) | ⟨FILL — cite the declaration URL and access date⟩ |
| [7],[8],[9] | arXiv preprints | ⟨FILL: arXiv IDs — you have these⟩ |
| [10],[11],[20],[21],[22] | Books | ⟨FILL: ISBN; publisher DOIs exist for some Springer/CRC titles⟩ |

**Also:** replace every "et al." in the reference list with the full author list. Your own
`audit_citation_integrity` matches on author strings, and truncated lists resolve less
reliably.

---

### What I deliberately did not do

So you can decide differently, knowing the trade-off:

| Not added | Why |
|---|---|
| RRIDs | A theory paper uses no antibodies, cell lines, organisms or software resources requiring identifiers. Inserting RRID-formatted strings would be fabrication, and it is detectable — your validator checks them against the registry. |
| MDAR blinding / randomisation / power analysis | There is no experiment, no arm and no participant. These fields would be false. |
| Fabricated statistics to raise C7 empirical density | The honest route to C7 is §8: report real measurements from the real deployment. |
| Preregistration | You did not preregister. |
| Keyword padding for C3 interdisciplinarity | The paper genuinely spans scientometrics, information geometry and distributed systems. Naming those honestly is legitimate; salting unrelated field terms to widen the topic vector is not, and it would corrupt your own Map of Science. |

Every item in that table would raise the number. Each is also the specific behaviour your
paper exists to argue against.


---

# Critique: logical flaws and what was done (was CRITIQUE.md)

**Status: all findings below have been addressed.** Each section states what
was wrong and what now happens instead. The critique is kept in full rather
than rewritten into a changelog, because the reasoning is the part worth
keeping — a future change that quietly reintroduces one of these should be
recognisable as such.

Flaws are separated into **code bugs** (the implementation was wrong) and
**conceptual** (the design claimed more than the mechanism could deliver). The
conceptual ones mattered more, and fixing them meant giving up some of what the
project claimed.

---

### Part 1 — Code-level flaws

#### 1.1 piQ is minted to the submitter, not the author

`book_address` is the connected wallet of whoever pressed the button, and that
is what `eth_book` records and what the leaderboard aggregates.

Anyone can submit anyone else's paper via DOI lookup or Auto-Discover. So the
optimal strategy for maximising piQ is **not to write good papers** — it is to
submit other people's good papers before they do. The entire incentive
structure inverts under thirty seconds of adversarial thought.

The per-author emission decay makes this worse, not better: it penalises a
prolific *author*, but the farmer is submitting under one wallet across many
authors, so the decay barely bites while the honest researcher's own rate falls.

**Fixed** — `attribution.py`. piQ is minted only when the submitter is verified
as an author, by one of two routes: their ORCID appears in the publisher's
deposited record for the DOI (conclusive), or their verified ORCID profile name
matches an extracted author (strong). Third-party submission still works and is
still fully assessed and published — it simply earns nothing, and the refusal
explains how to qualify.

Name matching is deliberately conservative: surname must match exactly and the
given name in full or by initial. Surname alone is rejected, because a
collision there mints someone else's tokens to you. A registry outage never
credits.

#### 1.2 The epoch-weight feedback loop points the wrong way

`derive_next_epoch_weights` states its own logic plainly:

> a criterion that manuscripts consistently score well on is well-evidenced and
> carries more weight; one they score poorly on is sparsely evidenced and is
> down-weighted

That is backwards on information-theoretic grounds. A criterion **everyone
satisfies carries almost no information** — it cannot discriminate between
papers. A criterion with high variance across the corpus is the one doing the
discriminating work. Weighting by the mean rather than the variance
systematically inflates the influence of whatever the corpus already does well.

Worse, it is a positive feedback loop: high scores raise the weight, the raised
weight raises future composites on that criterion, which raises the weight
again. Left running, the composite converges on whichever criterion was easiest
to satisfy at the start.

**Fixed.** Weights now track *discriminating power*: distance from the
midpoint, which peaks for criteria that separate manuscripts and falls to a
floor for ones everything scores 5 or 95 on. Where corpus history exists,
measured standard deviation is used directly, since that is the quantity the
proxy was approximating. Inertia rose from 0.72 to 0.86, so the series is a
trend rather than an echo of the last submission.

Verified: given seven criteria at 95 and one at 50, the mid-range criterion now
receives roughly three times the weight of the others. Under the old rule it
would have received the least.

#### 1.3 No appeals path for an automated accusation

Injection detection sets logic integrity to 0.0 and records "research
misconduct" language in a permanent ledger. The canary evidence is strong, but
it is not infallible — a model can emit the token spuriously, and the static
scanner can misread an unusual layout.

There is no review queue, no human override, and the record is explicitly
designed to be immutable. A system that can permanently mark someone as having
attempted misconduct, with no recourse, is not one I would deploy against real
researchers.

**Fixed.** Findings now set `status: quarantined` and `review_required: True`,
withhold piQ, and carry an explicit appeal note stating that this is a finding
rather than a determination of misconduct. The word "misconduct" was removed
from every recorded warning.

---

### Part 2 — Conceptual flaws

These are not bugs. They are places where the design claims more than the
mechanism can deliver.

#### 2.1 "Uncorrelated errors" is the load-bearing claim, and it is overstated

The judgement-quality grading rests on this: *jurors from different providers
have uncorrelated errors, so agreement is evidence.*

Llama, Mistral, Qwen and Gemini are trained on heavily overlapping web corpora,
use broadly similar transformer architectures, are tuned against overlapping
preference data, and are increasingly distilled from one another. Their errors
are **correlated**, substantially. When four models agree that a paper is
novel, some of that agreement is shared prior, not independent confirmation.

The system currently reads agreement as near-linear evidence of truth. It
should not. The honest version: agreement rules out *idiosyncratic* error, not
*systematic* error — and systematic error is exactly what a shared training
distribution produces. Cross-model agreement on a claim that is popular-but-
wrong in the literature is precisely the case where all four will agree and all
four will be wrong.

**Fixed, and strengthened.** The metric is relabelled: tiers are now
**Strong / Partial / Single-source corroboration** rather than High / Moderate /
Limited *judgement quality*. Every rationale states the limit explicitly —
agreement rules out idiosyncratic error but not systematic error common to
models sharing a training distribution.

Beyond relabelling, the panel gained a **DeepSeek-lineage juror**. That is not
redundancy: a juror from a genuinely different model lineage makes the
independence assumption more nearly true, which is the only way to strengthen
corroboration rather than just add another correlated vote.

#### 2.2 C1 and C4 are not properties of a document

**Originality** is a relation between a document and a field. **Societal
impact** is a relation between a document and the future. Neither is contained
in the PDF, and no amount of reading it more carefully will extract them.

C1 is 70% panel opinion. C4 is 45% panel opinion plus a licence check. The
system produces a number to two decimal places for quantities it has no access
to. That the number is stable and well-documented does not make it a
measurement.

This is the single largest gap between what the rubric appears to say and what
it can support.

**Fixed** — rubric v3.0. Both are now marked `interpretive: True` and their
weights rebalanced away from model opinion: C1's panel weight fell from 0.70 to
0.45 with the remainder moved onto verifiable citation engagement and reference
integrity; C4 was renamed **Societal Reach** — which *is* measurable — and now
leads on open licensing rather than the panel's guess.

`composite_confidence()` publishes the split: **78% of the composite now
derives from verifiable analysis, 22% from model interpretation**, up from 66/34.
The UI states this, and `/api/rubric` exposes the exact figures.

Grounding C1 in embedding distance to nearest OpenAlex neighbours remains the
right long-term answer and is not done.

#### 2.3 piX is the thing CoARA asks you not to build

CoARA's first commitment is to stop reducing research quality to a single
metric and stop ranking people by it. ScholarPi:

- reduces a manuscript to a single 0–100 number,
- mints a token proportional to that number,
- ranks researchers by accumulated tokens on a public leaderboard.

The system reports the h-index while pointedly excluding it from scoring — and
then does the same reductive thing with a different number. "Our single number
is better designed than their single number" is a real argument, but it is not
the argument the CoARA framing implies.

**Addressed by reframing rather than deletion.** piX is now presented
throughout as a **Reporting & Integrity Score**, and the help text opens by
stating that it does not measure research quality. The leaderboards carry the
same caveat inline. The piQ board is labelled as ranking *reporting practice*.

The defence that remains — and it is a real one — is that piX is transparent
and per-criterion decomposable where JIF and h-index are not. A researcher can
see exactly which signal cost them points. That is a genuine difference in
kind, not degree.

#### 2.4 The blockchain does not constrain the party that needs constraining

The stated threat is tampering with assessment records. But the operator
controls the database, the scoring code, the rubric, the minting key, and the
server. Immutability of the ledger protects against an attacker who can modify
SQLite but cannot modify anything else — which is nobody.

A researcher who does not trust the operator gains nothing from the chain,
because the operator can simply score differently before anything is written.
A researcher who does trust the operator did not need the chain.

**Fixed** — the claim is narrowed in the explorer help, verbatim: the chain
provides timestamped, non-repudiable evidence that an assessment produced a
specific result at a specific time, so the operator cannot revise their own past
outputs unnoticed. It explicitly does *not* make the system trustless, because
whoever runs the deployment controls the scoring code, the rubric and the
signing key. **The ledger constrains revision, not authorship.**

#### 2.5 The economy is closed and regressive

piQ funds assessment; piQ is earned by scoring well; therefore the researchers
who can afford to use the system most are those already producing
well-reported work with good infrastructure.

The three-paper free tier is where a new user gets stuck. A researcher without
institutional support — the exact constituency CoARA and the Global South
open-science literature are concerned with — is the one who runs out first and
cannot easily earn more. The difficulty schedule makes this strictly worse over
time.

**Partly fixed.** Linking a verified ORCID now grants a one-time **2.0 piQ
onboarding stake** — roughly nineteen papers at the current fee. It is gated on
a verified identity so it cannot be farmed, idempotent per identity, and turns
the free tier from a wall into an on-ramp.

The closed-loop critique stands and is not solvable in code. piQ has no
exogenous demand; its only use is access to the system that mints it. That is a
real limitation of the token model and should be stated rather than papered
over.

#### 2.6 The system measures reporting quality, not research quality

This is the deepest one, and it is not a criticism so much as an identification.

Look at what actually works: MDAR adherence, RRID registration, data
availability statements, open licences, container specifications, statistical
reporting density, reference resolvability. Every one of these is a **reporting
practice**. A meticulously reported weak study will outscore a brilliantly
insightful but sparsely documented one. The rubric's own `deterministic_share`
field makes this visible: the criteria the system measures well are exactly the
ones about documentation.

That is a real and useful thing to measure. It is simply not "research
quality".

**This is now the project's stated position.** The rubric docstring, the API
manifest, the piX help text and the leaderboard captions all say so directly:
*measures reporting quality and research integrity; does not measure the
importance or correctness of the underlying research.* A meticulously reported
weak study will outscore a brilliant but sparsely documented one, and saying so
plainly is more defensible than hoping nobody notices.

---

### Part 3 — Grounds worth standing on

Here is the version of this project I would defend without reservation.

#### ScholarPi is a reporting-integrity auditor for manuscripts

Not a quality judge. Not a replacement for peer review. An automated,
transparent, pre-submission audit of the things about a paper that are
**checkable** — and that reviewers currently check inconsistently, slowly, or
not at all.

That claim is fully supported by what the code does, and it addresses a real
problem.

**1. The checkable things genuinely go unchecked.**
Whether a paper registers its RRIDs, states a power analysis, deposits code
under a licence, or cites works that actually exist — these are objective and
verifiable, and human reviewers routinely miss them because checking is tedious
and unrewarded. Automating exactly this is a good division of labour: machines
do the mechanical verification, humans do the judgement.

**2. Reference verification addresses a live 2025–26 problem.**
Fabricated citations from unchecked generative text are a documented failure
mode serious enough that arXiv now sanctions it. Verifying cited DOIs against
two independent registries — and carefully distinguishing "does not exist" from
"could not check" — is a real contribution, and the conservative design (both
registries must agree; outages never accuse) is exactly right.

**3. The prompt-injection defence addresses a documented attack.**
Hidden instructions in submitted PDFs were found at major venues. Any venue
using LLM assistance is exposed. The two-layer defence here — static
concealed-text scanning plus a cryptographic canary the manuscript cannot
predict — is a sound design, and I am not aware of a deployed alternative that
does both.

**4. The bias-safe authorship signal is better than the market.**
Commercial AI detectors misclassify a large fraction of non-native English
writing. Building a check that deliberately ignores lexical variety and
grammatical simplicity, requires multiple independent indicators, and refuses
to affect any score is a defensible ethical position that most vendors have not
taken. This is a genuine differentiator and worth foregrounding.

**5. Transparency is real and unusual.**
The full rubric with every weight is published at an endpoint. Each criterion
declares how much of it is deterministic versus model opinion. Each score
decomposes to per-signal point contributions with the largest unclaimed gap
named. Compare that to JIF, which is a proprietary ratio, or h-index, which
nobody can decompose at all. This is the CoARA-aligned part, and it is
substantive.

**6. The right user is the author, pre-submission.**
Positioned as a self-check — *"before you submit, here are eleven verifiable
things reviewers will notice and you can still fix"* — everything above is
strength and none of the conceptual flaws bite. No leaderboard, no ranking of
people, no claim to measure quality, no need for the token economy to work.

#### What changed, and what has not

**Done:**

- piX presented as a **Reporting & Integrity Score** wherever a user meets it.
- C1 and C4 demoted, relabelled interpretive, model-opinion share cut to 22%.
- Leaderboards retained but captioned to say they rank reporting practice.
- Submitter-vs-author attribution fixed before the token had real value.
- Corroboration relabelled, correlated-error caveat stated, independent-lineage
  juror added.
- Chain claim narrowed to non-repudiation.
- Onboarding grant to open the economy.
- Integrity findings quarantined rather than published as accusations.

**Not done, deliberately:**

- **The leaderboard still exists.** Removing it entirely is defensible but
  removes the project's main feedback loop; the caveat is the compromise.
- **C1 is still not grounded in a measurement.** Embedding distance to
  OpenAlex neighbours is the right fix and requires infrastructure not present.
- **The token economy remains closed.** No amount of code fixes that.

None of the completed changes weakens the project. They remove what a hostile
reviewer would attack first and leave what is genuinely defensible — which is
most of the engineering and all of the integrity work.

---

### One thing I would not concede

The objection "this is just AI grading papers, which is bad" does not land
against the design as built. The deterministic majority of the rubric never
consults a model, the model panel's influence is explicitly bounded and
published per-criterion, and the system refuses to score what it cannot
measure in several places where it would have been easy not to.

That restraint is the most defensible feature of the project. It should be the
headline, not a footnote.


---

# Recommendations (was RECOMMENDATIONS.md)

Written after removing the hardcoded logic from the scoring pipeline. Two parts:
what was actually wrong and is now fixed, then a prioritised list of what I'd
tackle next.

---

### Part 1 — What was hardcoded, and what replaced it

#### 1. VAPRI was a hash digest used as a score

```python
vapri = (int(hashlib.md5(evidence_report.encode()), 16) % 1000) / 1000.0
c1 = (ai_rating * 0.9) + (vapri * 10)          # up to 10 points of C1
logic_integrity = (rating * penalty) + (vapri * 5.0)   # and 5 of logic integrity
```

This is deterministic pseudo-randomness. Two manuscripts differing by one
character received unrelated VAPRI values, and roughly 10% of C1 was noise. The
same digest was also the **training target** for the Scilem network — it was
being fitted to predict a hash, which is by construction unlearnable, so any
apparent convergence was memorisation.

**Replaced by** `compute_corroboration_index()`: inter-model agreement (45%),
juror breadth (35%, log-saturating), and evidence-report substance (20%). Scilem
now trains against the adjudicated quality rating, mapped to its tanh output
range.

#### 2. Every paper was labelled "Computer Science"

```python
json.dumps(["Core Research Domain"]),   # subfields — for every paper
json.dumps(["Computer Science"]),       # fields    — for every paper
```

The Global Map of Science was not a map of anything. Worse, `refine_science_field()`
then keyword-matched those two constant strings through seventeen branches, so
every paper fell through to the same terminal label.

**Replaced by** two-tier classification: OpenAlex's own topic assignments when a
DOI resolves (authoritative — a deep-learning classifier over titles, abstracts
and citation networks), falling back to breadth-weighted term-frequency scoring
against per-field vocabularies. Every classification records its provenance and
confidence, so an inferred label is never mistaken for an authoritative one.

#### 3. Eight criteria, eight undocumented coefficients

```python
c1 = (ai_rating * 0.9) + (vapri * 10)
c4 = ai_rating * 0.95 + (topological_entropy * 5)
c6 = ai_rating * 0.88 + (sciscore_adherence * 12)
```

No derivation, no documentation, inconsistent scales (some multiplicative
fractions, some additive raw-point bonuses). The `min(100, max(0, …))` clamps
were hiding the fact that additive bonuses could exceed 100.

**Replaced by** `rubric.py`: a versioned rubric where each criterion is a weighted
sum of named, normalized signals, weights summing to exactly 1.0. Scores are
bounded to [0, 100] **by construction**, not by clamping. Published at
`/api/rubric`, and each criterion declares its *deterministic share* — the
fraction decided by verifiable text analysis rather than model opinion (C5 is
100%, C2 is 90%).

The dossier now shows per-signal attribution: which signal contributed how many
points, and which leaves the most unclaimed. That is what makes a score
actionable rather than merely a number.

#### 4. Smaller fabrications

| Was | Now |
|---|---|
| `Overall_Confidence: 0.85` (constant) | Derived from juror count and inter-model agreement |
| `drift = "N/A"`, `rec = "N/A"` | Removed; slots carry classification and rubric breakdown |
| `credit_taxonomy_roles = ["Data Curation"]` | Inferred from CRediT patterns in the text |
| `h_idx` / `i10_idx` = MDAR score and RRID count | Real h-index/i10-index from OpenAlex |
| Title/author = first juror that answered | Fuzzy-clustered consensus vote across jurors |
| `HOT_TOPICS` frozen list | Live OpenAlex trending, 6h cache, seed only on outage |
| `MAJOR_SCIENCE_FIELDS` fixed nine | Fields actually present in the corpus, ranked by count |

#### 5. New this round

- **Difficulty-scaled piQ emission** (`emission.py`) — halving every 500 papers,
  a quality bar rising 50→75 piX, and per-author decay so volume can't beat
  quality. Published at `/api/emission`.
- **Stop button** on the assessment pipeline (AbortController; per-paper billing
  means stopping mid-batch charges only what was processed).
- **Map of Science rebuild** — labelled bubbles sized by area not radius, five
  live sliders, domain legend, fit/freeze controls, and physics that actually
  settles.
- **Schema drift guard** — `enforce_database_schema` cached a global flag, so a
  running server never applied new columns. That is almost certainly what caused
  your `TypeError: network error` and `Error loading ledger`.

---

### Part 2 — Recommendations, in priority order

#### Tier 1 — Correctness and trust

**1. The Scilem network is still architecturally unable to learn.**
It hashes each word to an arbitrary integer in `[0, 10000)` and embeds that. Two
occurrences of "reproducibility" collide with unrelated words at a rate governed
by the vocabulary size, and there is no relationship between token IDs and
meaning. Training it on a real target (as it now does) is a prerequisite for
learning, not a guarantee of it.
*Recommendation:* replace with a small frozen sentence-transformer over
abstracts, or drop the neural component and rely on the deterministic signals,
which are the part carrying real information. Consider whether it earns its
memory footprint at all.

**2. `final_score` is the unweighted mean of eight criteria.**
`composite_score()` supports epoch weighting but is called without weights, so
the Pidyne forecast currently predicts weights that never affect any score. Either
wire the forecast into the composite (and stamp each score with its epoch so
historical scores stay comparable), or state plainly in the UI that the forecast
is observational. Right now it implies an influence it does not have.

**3. Reference verification is serial and blocking.**
`audit_references` makes up to 30 sequential HTTP calls inside the request path.
At ~200ms each that is 6 seconds added per paper.
*Recommendation:* `asyncio.gather` with a semaphore, plus a persistent DOI-result
cache — verified DOIs never change, so this should be a near-permanent cache.

**4. No test suite in the repo.**
The 516 assertions I wrote live in `/tmp` and will not survive. They should be
`back/tests/`, wired into the existing `.github/workflows/tests.yml`. The
high-value ones: rubric bounds and monotonicity, injection false-positives on
legitimate papers, reference-audit outage behaviour, and emission difficulty
ordering.

#### Tier 2 — Substance

**5. C1 Semantic Originality doesn't measure originality.**
It is 70% panel opinion. Genuine novelty measurement means comparing against the
corpus — e.g. cosine distance between this abstract's embedding and its nearest
OpenAlex neighbours in the same subfield. That would make C1 the strongest
criterion instead of the softest.

**6. Author disambiguation is string equality.**
`author_name = ?` means "J. Smith" and "John Smith" are different researchers,
and the piQ leaderboard is unreliable as a result. OpenAlex author IDs (already
fetched for h-index) or ORCID should be the join key.

**7. The corpus is never revisited.**
Scores are computed once and frozen. When the rubric version changes, old scores
become incomparable to new ones with nothing surfacing that. A re-scoring job
that replays stored `signal_vector`s through the current rubric would fix this
cheaply — the signal vectors are already persisted for exactly this purpose.

#### Tier 3 — Reach

**8. Zotero plugin.** `/api/dossier/by-doi` exists and is the hard part. A
~200-line plugin surfacing piX in a user's library is the single highest-leverage
adoption step available, per Part VI of your research.

**9. Batch/institutional API.** Institutions will not upload PDFs one at a time.
An authenticated endpoint accepting a DOI list and returning a job ID would make
departmental evaluation feasible.

**10. Reviewer-in-the-loop.** The framework claims algorithms are auditors, not
replacements. Nothing currently lets a human reviewer record agreement or
disagreement with a criterion score. Capturing that would both honour the claim
and produce the labelled dataset needed for anything genuinely learned.

#### Things I'd deliberately *not* do

- **Don't let h-index affect piX.** It is reported as author context and
  excluded from scoring on purpose. CoARA's first commitment names the h-index
  specifically; letting it move a manuscript's score would contradict the
  framework's central claim while advertising CoARA alignment.
- **Don't lower the authorship-signal reporting bar.** It requires three
  independent indicators and ignores lexical variety by design. Making it more
  sensitive would reintroduce exactly the bias against non-native English writers
  that Part V of your research warns about.
- **Don't add a general-purpose AI-detection score.** Same reason, larger blast
  radius.

---

### Open question worth deciding

**The processing fee now scales with difficulty.** Held flat at 0.1 piQ it would
have exceeded what even a perfect paper mints from epoch 5 onward — every user
spending faster than they could earn, and participation ending for accounting
reasons rather than quality ones. Scaling the fee by the same halving factor
keeps a qualifying paper net-positive at every epoch.

If you'd rather the fee stayed literally fixed at 0.1 piQ, that is a coherent
choice, but it makes the system terminal at scale. Set `PIQ_PROCESSING_FEE` and
override `current_fee()` in `emission.py` if you want that behaviour.


---

# Vendored libraries (was front/vendor/README.md)

Optional. The app loads Chart.js from a CDN and falls back to this directory
if that fails.

### Why this exists

CDN fetches fail for reasons the server cannot see: privacy extensions,
corporate proxies, filtered networks, or being offline. When that happened the
Pidyne Forecast rendered as an empty box, and the failure looked like a backend
problem — it was reported as one, and time was spent looking at an API that was
returning correct data the whole time.

The app now degrades in three stages: try a second CDN, then this local copy,
then render the forecast as a table. Populating this directory removes the
dependency on someone else's network entirely.

### To self-host

Run from the repository root:

    curl -Lo "front/vendor/chart.umd.min.js" \
      https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js

Then commit it. Pin the same version the CDN tag in `index.html` uses (4.4.4),
so behaviour does not change depending on which source won the race.

Mermaid (architecture diagrams) can be vendored the same way if needed:

    curl -Lo "front/vendor/mermaid.min.js" \
      https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js

### three.js (the superellipse look's graphics engine)

`vendor/three/` holds three.js r185 (0.185.1, MIT, see `vendor/three/LICENSE`): `three.module.min.js` and
`three.core.min.js`, copied unchanged from the `build/` folder of https://github.com/mrdoob/three.js at tag
`r185`. `front/super/engine.js` imports it to draw every super, wire, port and the glass light with WebGL.
To update, copy the same two files from a newer tag and bump `?v=` on `super/engine.js` in `index.html`.


---

# Evolution: the project's history (was EVOLUTION.md)

Changes made on the `experimental` branch, newest last. Each entry: what changed, why, how it was verified. The nightly run reads this to avoid repeating work.

### 2026-10-09: QuVI added to the Lab (owner preview)

**What:** a browser port of QuVI, Murtaza Vefadar's LabVIEW quantum-circuit toolkit (MIT licence). It has:
- a state-vector engine for up to 6 qubits, with QuVI's gate set: I, X, Y, Z, H, S, T, Phase, RX/RY/RZ, controls, anti-controls, swap and Z measurement
- a wire-and-block circuit editor with a step-through timeline
- inspectors for probabilities, state vector with phase, Bloch spheres, reduced and full density matrices, and per-qubit entropy and purity
- his examples: Teleportation, Grover, QFT-4Q and Superdense coding, plus Bell and GHZ

**Why:** to prepare the QuVI experiment for the Lab. The permission email promised that nothing goes live without the author's approval, so it's visible only to the signed-in owner until `QUVI_PUBLIC=1` is set (`/api/lab/features`). Credit and the full MIT licence text are on the page.

**Verified:**
- `node front/quvi/engine.test.mjs`: Bell, GHZ, teleportation fidelity for every outcome, superdense coding, Grover certainty, exact QFT amplitudes, anti-control, swap and norm all pass.
- pytest at baseline (12 pre-existing failures), plus a new feature-flag test.
- `build_hal.py` builds.
- Browser checks for anonymous (hidden, plus a "Coming to the Lab" notice at /quvi/), owner (card and simulator) and public (card, no badge). Every tab at 1440 and 390 px, with no page errors and no horizontal scroll.

**Files:** `front/quvi/*`, `front/lab.js`, `front/index.html`, `front/theme.css`, `back/lab.py`, `back/api.py`, `back/tests/test_lab.py`, `CLAUDE.md`.

### 2026-10-09: New PiTechLab mark and a friendlier welcome

**What:**
- The circle-and-diameter logo is replaced by a friendly mark: a hand-drawn π on a cobalt tile, its right leg curling up, with a small spark. It's used for the sidebar brand, favicon, permission page and welcome screen.
- The site is now named PiTechLab, with ScholarPi as its assessment tool.
- The welcome screen has a warm greeting and the mark drawing itself, then four doors with icons: assess and improve a paper, research the corpus, explore the map of science, and experiment and test in the Lab. Below them, a line saying the site improves nightly, linking to this log for the running branch, and a "Skip to the site" link.

**Why:** the owner didn't like the old logo and wanted the welcome to feel friendlier and to name what the site is for: research, lab, testing, assessment, improvement and innovation.

**Verified:**
- pytest at baseline, `build_hal.py` and the QuVI engine tests.
- Browser at 1440 and 390 px on every tab, with no page errors and no horizontal scroll.
- Welcome: focus lands on "Let's begin", a door opens its tab, the brand reopens the screen, and Skip and Esc close it.
- With reduced motion, the π strokes show fully without animating.

**Files:** `front/welcome.js`, `front/theme.css`, `front/index.html`, `front/icon.svg`, `front/confirm/index.html`.

### 2026-10-09: Total cap on stored manuscripts

**What:** `back/paper_store.py` now has a total budget for retained manuscripts, `PAPER_STORE_MAX_TOTAL_BYTES` (default 2 GB, `0` turns it off). When a new upload would go over it, the store evicts orphaned files first (those with no assessment left), then the oldest stored manuscripts. A single file larger than the whole cap is not stored. The owner Storage panel shows how much of the cap is used and a warning from 80%. That warning says eviction removes the file link from published papers.

**Why:** the store had no total limit and filled the production disk. A full volume stops the database as well, not only uploads.

**Verified:**
- New `tests/test_paper_store.py` (6 tests) covers under the cap, oldest first, orphans first, an oversized file, a failing provider and a disabled cap.
- pytest is at baseline (12 pre-existing failures, 370 passed).
- `build_hal.py` builds.
- `/api/admin/storage` returns `manuscript_cap`.
- Headless Chromium, every tab at 1440 and 390 px, signed out and as a mocked owner: no page errors and no horizontal scroll. The Storage panel was screenshotted with the warning showing.

**Files:** `back/paper_store.py`, `back/api.py`, `back/tests/test_paper_store.py`, `front/app.js`, `EVOLUTION.md`.

### 2026-10-09: The circling mark returns

**What:** the owner preferred the circle. The logo is back to the circle and its diameter, now without a centre dot, and the diameter turns slowly with the cobalt point riding its end: on the welcome screen inside the ruled ring, and in the sidebar mark. The favicon stays still. The friendlier welcome layout (greeting, four doors, nightly-improvement line) stays.

**Verified:**
- Browser at 1440 and 390 px, with no page errors and no horizontal scroll.
- The diameter's rotation is measured mid-turn.
- No centre dot is present.
- With reduced motion, the mark is still and fully drawn.

**Files:** `front/welcome.js`, `front/theme.css`, `front/index.html`, `front/icon.svg`, `front/confirm/index.html`.

### 2026-10-09: Name written as "Pi Tech Lab"

**What:** the owner's preferred spelling. Every visible name (titles, the sidebar brand, the welcome greeting, the permission page, the QuVI footer and the permission-request defaults) now reads "Pi Tech Lab". The domain stays pitechlab.com.

**Files:** `front/index.html`, `front/welcome.js`, `front/confirm/*`, `front/quvi/index.html`.

### 2026-10-09: Black circle, blue sweeping diameter; no dot, no skip link

**What:**
- The logo is now a black circle with a blue diameter, sweeping round with a smooth fading trail, on the welcome screen and in the sidebar. The cobalt dot is gone. The favicon and the permission page show it still.
- "Skip to the site" is removed from the welcome screen. Esc, "Let's begin" or any door still leads in.

**Verified:**
- Browser at 1440 and 390 px, with no page errors and no horizontal scroll.
- The rotation is measured mid-sweep.
- With reduced motion, the mark is still and the trail is hidden.

**Files:** `front/welcome.js`, `front/theme.css`, `front/index.html`, `front/icon.svg`, `front/confirm/index.html`.

### 2026-10-09: Simpler welcome mark; no "improves every night" line

**What:**
- The degree ring (ticks and outer circle) is removed from the welcome mark. It's now just the black circle and the sweeping blue diameter, cropped to fit.
- The line "This site improves a little every night…" and its link are removed from the welcome screen, at the owner's request.

**Files:** `front/welcome.js`, `front/theme.css`.

### 2026-10-09: Orbit layout; live π under the mark

**What:**
- The Pi Tech Lab mark stays fixed in the centre on every page. Every card (Evaluate, Explore, Envision, Lab, Architecture, account) is a bubble orbiting it.
- You can drag a bubble; its position is remembered. Click a bubble to open it as a floating window that can be moved, resized and maximised. Esc or a click on the mark closes it.
- The mark's size follows what the site is doing. It is large when idle and shrinks while windows are open. Its diameter spins faster while a request is running.
- Under the mark, π is computed live in a background worker (Gibbons spigot, exact integers). It gains digits for as long as the page stays open.
- The welcome screen is removed. The old sidebar and tabs remain hidden underneath and still drive the sections.

**Checks:** 21 bubbles for visitors, 31 for the owner. HAL-OS runs inside a window. The first 150 digits of π were checked. There are no page errors at 1440 or 390 px. On phones, a few bubbles may touch as they pass.

**Files:** `front/orbit.js`, `front/orbit.css`, `front/pi-worker.js`, `front/index.html`, `front/lab.js`, `front/theme.css`; `front/welcome.js` removed.

### 2026-10-09: Still pills, no overlaps, a movable mark, use makes pills grow

**What:**
- "Pi Tech Lab" sits in the top-left corner. The "Drag anything. Click to open." line is removed.
- Pills no longer drift. Each gets a fixed place on rings around the mark, and they never overlap each other, the mark, the π line, the title or the corner buttons. A dropped pill takes the nearest free spot, and the others make room.
- The mark can be dragged; the pills come with it. Double-click brings it back to the middle. Its size follows what you do: it is large when idle and steps back further with each open window. It pulses when a card opens, grows slightly under the pointer, and spins faster while the site is working.
- Use makes pills prominent. Opening a card counts 1 and moving it counts ⅓, remembered in this browser. At scores of 1, 3 and 8 a pill gets larger and bolder, and more-used pills sit closer to the mark.

**Checks:** at 1440, 1280 and 390 px there are no overlaps after loading, after dropping a pill on another, after moving the mark and after reload. Pills stay still over time and when a window opens. There is no horizontal scroll and no new page errors.

- Pills re-place themselves when the experimental banner fills in late, so nothing ends up under the π line.

**Files:** `front/orbit.js`, `front/orbit.css`, `front/index.html`.

### 2026-10-09: Varied pills; π in its own box; resizable logo; GitHub and ResBD as pills

**What (owner's requests):**
- Every pill has its own size, typeface and style. Sizes run from 0.86× to 1.3×. Typefaces are Geist, Geist light, Geist Mono, a serif or a serif italic. Styles are outline, ink, soft, dashed, cobalt, square or underline. The look is picked from the pill's name, so it is the same on every visit. This is a deliberate widening of the design language for the orbit, at the owner's request.
- Use still grows a pill, on top of its own size. The growth shows on your next visit, so nothing shifts while you work.
- The π counter is its own box. You can drag it anywhere and resize it from its corner or with the scroll wheel. Double-click resets it.
- The logo resizes with its small blue knob or the scroll wheel. Double-click resets its size and place.
- GitHub is a pill (it opens in a new tab), and the floating GitHub button is hidden. ResBD is a pill whose window opens like any other card.
- "Pi Tech Lab" in the corner is bigger: 28–44 px on desktop, 26 px on phones.

**Checks:** at 1440, 1280 and 390 px there are no overlaps after moving or resizing the π box and the logo. Pills stay still when a card opens. There is no horizontal scroll and no page errors.

**Files:** `front/orbit.js`, `front/orbit.css`, `front/index.html`.

### 2026-10-09: Size follows complexity and use; no resize knob on the logo

**What:**
- A pill's size now follows how much is behind it, not chance. It is measured from the card: embedded tools (HAL-OS, QuVI), the map and other drawings, inputs, buttons, tables and the amount of text. Cards are ranked and sized 0.84× to 1.34× by rank, and the most complex value seen is remembered. Use multiplies on top, so the most complex, most used cards are the biggest. Typeface and style stay varied per pill.
- The small resize circle on the logo is removed. The logo still resizes with the scroll wheel; double-click resets it.

**Files:** `front/orbit.js`, `front/orbit.css`, `front/index.html`.

### 2026-10-09: Pills move only when pushed; the mark sizes to the open card

**What:**
- Every pill keeps its own place, stored relative to the mark as a share of the screen. Moving one pill no longer reflows the rest.
  - A dropped pill gives way only to fixed things (the mark, the π box, the title). It takes the nearest spot clear of them.
  - Only the pills it lands on are pushed, each to the nearest unused spot. Pushes don't cascade, and pushed pills stay where they were pushed.
  - When the screen edge or a moving mark pushes a pill, the move is temporary: the pill returns once there is room.
- With a window open, the mark sizes to the complexity of the card in front. Key numbers ≈ 60 px and HAL-OS or the map ≈ 135–140 px on desktop; on phones, about 42–84 px.

**Checks:** dropping a pill on empty space moves only that pill. Dropping onto another moves just the pill it lands on. Positions survive a reload. Opening cards moves no pills.

**Files:** `front/orbit.js`, `front/index.html`.

### 2026-10-09: Windows stay open, fit their content, and come to the centre when clicked

**What (owner's requests):**
- The maximise and close buttons are removed. Windows never close: Esc and the mark no longer close them, and open windows reopen in the same order on the next visit.
- Clicking a pill, or a window behind another, brings that window to the front and glides it to the centre.
- A click on the mark sets every window aside (faded out, still open) to show the pills; another click, or opening any pill, brings them back.
- Windows fit their content. Width runs from about 320 px for a few lines up to 440–820 px depending on the card's complexity, and 960 px for tools and tables. Height matches the content up to the screen. They refit as content loads, until you resize one yourself. On phones they are full-width and as tall as needed, up to 86% of the screen.
- The π box sits beneath windows; the mark stays above them. The focus ring on a clicked window is gone.

**Files:** `front/orbit.js`, `front/orbit.css`, `front/index.html`.

### 2026-10-09: Your layout follows your account

**What:**
- When you are signed in, the whole page state is saved to your account about a second after each change, and loaded when you sign in on any browser or device:
  - every pill's place, size and use;
  - the mark's place and size;
  - the π box's place and size;
  - which windows are open, in their stacking order;
  - each window's place, and its size once you have resized it.

  The first time you sign in, this browser's layout becomes the account's. Signed out, everything stays in the browser only.
- Windows now remember their place, and their size once resized, even when you are signed out.
- Server: `back/layout.py`, with `GET`/`PUT /api/me/layout`, available only to a signed session and only for its own identity (ORCID or wallet). Its own `layout.db`. The data is opaque, shape-checked and capped at 64 KB and 600 keys under "orbit:". Tests are in `back/tests/test_layout.py`.

**Checks:** a second browser signed in as the same user shows the same layout and windows. A signed-out browser keeps its own. pytest: 374 pass; the 12 known failures are unchanged.

**Files:** `back/layout.py`, `back/api.py`, `back/tests/test_layout.py`, `front/orbit.js`, `front/index.html`, `CLAUDE.md`.

### 2026-10-09: The name, top centre, in many languages

**What:**
- "Pi Tech Lab" moves to the top centre. Every 30 seconds to 3 minutes, at random, it fades into the name in another of 32 languages, each in its own script. Right-to-left scripts run right to left. Joined and syllabic scripts keep normal letter spacing. Hovering shows the language's name, and screen readers always hear "Pi Tech Lab".
- Each name is shrunk if needed to fit the screen. The pills keep clear of the widest name, so a change of language never moves a pill.

**Checks:** all 32 names at 1440 and 390 px fit with no overlap and no horizontal scroll. No pill moves when the name changes.

**Files:** `front/orbit.js`, `front/orbit.css`, `front/index.html`.

### 2026-10-09: PiEn; nothing overlaps on any screen; smaller title; HAL-OS start-up race

**What:**
- **PiEn.** The mark is PiEn, an engine that learns how the site is used. Its name is inside the circle.
  - It learns which cards are opened and which follow which.
  - Your own pattern is kept with your layout (`orbit:pien`, synced to your account when you are signed in).
  - Everyone's pattern is pooled anonymously on the server (`back/pien.py`, `/api/pien`): card names and counts only, never who. Requests are capped at 40 entries of at most 10, and each address may send 60 an hour.
  - After each step, PiEn puts a soft blue halo on the card you are most likely to want next. Your habits weigh three times as much as everyone's, and it stays quiet with too little to go on. Hovering the mark shows how much it has learned.
- **No overlaps on any screen.** Pills, the mark, the π box and the title never overlap: the π box avoids the mark and the title, and the mark stays below the title. When a screen has no room for every pill, all pills shrink together in steps until they fit. Tested at 13 sizes from 320×568 to 2560×1440, including phones in landscape: fresh, with the mark in a corner, and with the π box dropped on the mark.
- **Title** is smaller: 20–28 px.
- **HAL-OS** ignores pause/resume until the emulator has finished starting. This fixes occasional emulator errors when windows were opened in quick succession.

**Files:** `back/pien.py`, `back/api.py`, `back/tests/test_pien.py`, `front/pien.js`, `front/orbit.js`, `front/orbit.css`, `front/hal/hal.js`, `front/index.html`, `CLAUDE.md`.

### 2026-10-09: The numbers window; full pill titles

**What:**
- Clicking the π box opens "π and friends", a window with seven constants computed live in your browser with exact integer arithmetic:
  - π (digit by digit, for as long as the page is open);
  - e, φ, √2, √3 and ln 2, each to 30 000 digits;
  - γ (Euler–Mascheroni), to 10 000 digits.

  Each shows its digits growing at about 16 a second, how many decimals are shown, and a one-line note. The first 100 digits of each were checked against published values. The window behaves like the others: it stays open and comes back after a reload. Dragging the π box still moves it; only a click opens the window.
- Pill titles are shown in full. Long ones wrap onto a second line on narrow screens instead of being cut with "…".
- Fixed: `orbit:ready` fired before `window.PiOrbit` existed.

**Files:** `front/numbers.js`, `front/consts-worker.js`, `front/orbit.js`, `front/orbit.css`, `front/index.html`, `CLAUDE.md`.

### 2026-10-09: Seamlessness pass

An audit of every window, as a visitor and as the owner, at 1440 and 390 px: page errors, failed requests, empty or zero-sized content, sideways scrolling, keyboard use and speed. Fixes:

- **The app's own jumps land in windows.** app.js and lab.js were written for tabs:
  - Every `scrollIntoView` now opens (or brings forward) the window holding its target and scrolls inside that window. This covers "Fill in your profile" from ResBD.
  - "Go to" links open their section's card, or the map.
  - Assessment results and "piQ held for you" open their windows by themselves when they appear.
- **Contact us** is a pill that opens the contact form directly, instead of a window holding a single button.
- **No needless refusals:** the operational log is only polled when signed in. Every visitor's page used to log a 403 for `/api/logs`.
- **Keyboard and screen readers:** the π box is a button (Tab, then Enter, opens π and friends). Windows are labelled regions rather than dialogs, since they never close. Pills, PiEn and the π box are all reachable with Tab.
- **Speed:** layout takes about 1 ms (13 ms on a landscape phone), with no long tasks while dragging.

**Checks:**
- No page errors and no failed requests (the only external failures are chart/diagram CDNs blocked inside the test sandbox).
- Nothing overlaps at 13 screen sizes, the account layout syncs, all 32 titles fit, and the constants are exact.
- pytest: 378 pass; the 12 known failures are unchanged.

**Files:** `front/orbit.js`, `front/app.js`, `front/index.html`.

### 2026-10-09: π and friends stays put and shows all seven

**What:**
- **A window you have placed stays where you put it.** Windows refit as their content grows, and the numbers grow all the time, so every refit was re-centring the window. Now, once a window has been moved (or restored to a saved place), refits change only its size, never its position.
- **All seven constants are visible at once.** The window opens at full width, with a compact grid (three columns on desktop, one on phones). Each constant shows its two newest lines of digits; scroll back for the rest. Notes are hidden on phones.

**Files:** `front/orbit.js`, `front/orbit.css`, `front/index.html`.
- π and friends is now π with three friends, at the owner's choice: Euler's number e, the golden ratio φ and the Euler–Mascheroni constant γ. √2, √3 and ln 2 are removed. Two columns on wider screens, one on phones; notes are hidden only on short phones. All four are visible at every tested size, from 320×568 to 1920×1080.

### 2026-10-09: Capabilities

**What:** a "Capabilities" pill whose window lists everything Pi Tech Lab can do, in six groups: assess research, explore the record, see the field, Lab, ask and understand, and the site itself. Each entry has one line on what it does, and clicking it opens that window (or π and friends, or the contact form). Only what this visitor can use right now is listed: 21 entries for a visitor and 24 for the owner (QuVI, private projects, permission requests). The list updates when you sign in or out.

Modules can now add pills of their own (`PiOrbit.addPill`) and open windows by title (`PiOrbit.openTitle`).

**Files:** `front/capabilities.js`, `front/orbit.js`, `front/orbit.css`, `front/index.html`, `CLAUDE.md`.

### 2026-10-09: "Analytics"; one "Architecture" window

**What:**
- "Key numbers" is now "Analytics". Its remembered place, use, size and open window carry over.
- Overview, Scoring Pipeline in Detail, Stage Reference and CoARA Compliance & Core Pillars are merged into one pill and window, "Architecture", in that order. The Whitepaper stays its own pill. Capabilities lists Architecture and Analytics.
- A window's header no longer repeats its section name when the title already says it.

**Files:** `front/orbit.js`, `front/capabilities.js`, `front/index.html`.

### 2026-10-09: A cleaner map of science; Performance and PiEN

**The Global Map of Science:**
- **Laid out as regions.** Each discipline gets a region sized to its fields, on a grid shaped like the window. Its fields gather there without overlapping, and the map comes to rest. Before, near-frictionless "billiard" physics piled every bubble against the walls, with links running across the whole map.
- **Cleaner graphics.** Flat, muted fills with thin outlines on paper, Geist labels, and a faint name over each region. The soap film, glows, stars and dark theme are gone, and a field's own label is skipped when it repeats its region's name. Links are short and quiet, and the selection is a cobalt ring. Toolbar, hint and minimap are paper with hairlines.
- **Fills its window.** The view fits the map itself (not the whole world) and keeps the toolbar strip clear. The canvas follows its window as it opens and resizes, and the layout is re-planned for the window's shape until you touch it.
- **Rewards are unaffected.** Positions are presentation only; runs are verified on masses and timing.

**Performance and PiEN:**
- "Forecast" is now "Performance", and its saved place carries over.
- PiEN (now spelled PiEN everywhere) has a section at the top of Performance:
  - how often its suggestions are followed (it now keeps score);
  - how many of your steps and everyone's it has learned;
  - what it suggests next;
  - the most common next steps.
- What was learned about renamed or merged cards counts toward their new names.

**Files:** `front/arcade.js`, `front/style.css`, `front/pien.js`, `front/orbit.js`, `front/orbit.css`, `front/capabilities.js`, `front/index.html`.

### 2026-10-09: Bubbles that hold pills, a chat pill, a signed-in check, a flowchart

**What (owner's requests):**
- **Lab** is a bubble with its pills inside: HAL-OS, plus QuVI, Private projects and Permission requests for the owner. **Tools** holds Assess a Manuscript. Each inner pill opens its window, and grouped pills no longer orbit on their own. A group is sized by everything in it.
- **siM Assistant** (renamed from "SciLM (siM) Assistant") has a chat box in its pill: type, press Enter, and the assistant window opens with the question asked.
- **Your account** shows a red dot when signed out and a green check when signed in.
- **The journal** pill shows a glimpse of what is inside: the number of entries and the latest one (`peeks.js`).
- **Architecture** is rebuilt as a six-step flowchart (paper in, read, panel, judge, record, outputs). Click or use the arrow keys to see each step; a "How judging stays fair" note sums up CoARA. Plain HTML and CSS, with no diagram library. It shows six across, three by two, or one column, depending on the window's width. The old cards stay in the page, hidden, for app.js.
- **Leaderboards:** the piX and piQ leaderboards are one pill.
- **Assessment results open by themselves** whenever a run finishes (app.js announces `scholarpi:assessment-done`), not only the first time.
- **Scrolling anywhere on the page** (outside windows) resizes PiEN. Scrolling on the π box resizes only the π box.

**Files:** `front/orbit.js`, `front/orbit.css`, `front/architecture.js`, `front/peeks.js`, `front/capabilities.js`, `front/pien.js`, `front/app.js`, `front/index.html`, `CLAUDE.md`.

### 2026-10-09: Recent assessments, for everyone

**What:** a "Recent assessments" pill (in Explore). It lists every assessment made on the site, newest first, including those made without signing in, so visitors can see the site in use. At the owner's choice, only the field, the piX score, the day and whether the person was signed in are shown. Never the title, the file, the author, the hash, any address or the time of day: people upload unpublished work. The pill shows the latest one, and the list refreshes when a run finishes.

Server: `back/recent.py` (`GET /api/assessments/recent`), read-only, with tests in `back/tests/test_recent.py` that check nothing identifying leaks.

**Files:** `back/recent.py`, `back/api.py`, `back/tests/test_recent.py`, `front/recent.js`, `front/orbit.css`, `front/capabilities.js`, `front/index.html`, `CLAUDE.md`.

### 2026-10-09: Leaderboard dates no longer clipped

**What:**
- The Date column was a fixed 58 px, the width of a number, so dates were cut off ("09/10/2…"). It is now 76 px and never wraps, with a compact date: "9 Oct", plus the year only for other years.
- The "piQ (share)" header was clipped too. It now reads "piQ", and its hover text still explains the share.
- On phones the leaderboard table was wider than the screen and silently cut. It now scrolls sideways.

**Files:** `front/style.css`, `front/app.js`, `front/index.html`.

### 2026-10-09: Intern, in the Tools bubble

**What:** an "Intern" pill inside the Tools bubble, beside Assess a Manuscript. Intern ([in-tern/Intern](https://github.com/in-tern/Intern)) is a separate project: an iOS app, an AI electronic health record for doctors, built on Firebase, Azure Communication Services and MessageKit. It runs on iPhone and iPad, not in a browser, so its window says what it is and links to its source. Modules can now place a pill inside a group's bubble (`addPill({..., inGroup: "Tools"})`).

**Files:** `front/intern.js`, `front/orbit.js`, `front/orbit.css`, `front/capabilities.js`, `front/index.html`, `CLAUDE.md`.

### 2026-10-09: Push a window to the edge to close it

**What:** dragging a window by its header against the left, right or bottom edge of the screen (or so that more than half of it is off-screen) closes it. While it is far enough out it fades slightly, to show that letting go will close it. A closed window is forgotten (it does not come back on the next visit) and reopens centred from its pill. This is the only way a window closes: there are still no close buttons, Esc or mark clicks.

**Files:** `front/orbit.js`, `front/orbit.css`, `front/index.html`.

### 2026-10-09: HAL-OS starts when you press Start

**What:** opening HAL-OS no longer boots the machine. Its screen shows a "Start HAL-OS" button with the image size, and a note when there are weights from last time to pick up. The x86 emulator downloads and boots only when the button is pressed. Pause and Reboot do nothing until then, and pause/resume messages from the page are ignored until the machine is up.

**Files:** `front/hal/hal.js`, `front/hal/hal.css`, `front/hal/index.html`.

### 2026-10-09: QuVI is public on production

The owner set `QUVI_PUBLIC=1` in Railway's production environment. QuVI now appears in the Lab bubble for every visitor at pitechlab.com, without the "owner preview" badge. Verified signed out: the simulator loads in its window. The experimental environment is unchanged (owner-only) unless the same variable is set there. No code change was needed: the switch has existed since QuVI was added.

### 2026-10-09: HAL-OS opens only from its own pill

**What:** the HAL-OS window no longer appears by itself. Three routes used to open it:
- the Lab bubble's default action (its first member);
- the `/#lab` link, which lab.js also wrote into the address whenever a Lab window opened;
- restoring windows from the last visit.

Now only pressing the HAL-OS pill in the Lab bubble opens it, and the machine still boots only when Start is pressed. The Lab bubble's own default opens QuVI where QuVI is visible, otherwise nothing. lab.js no longer writes `#lab`.

**Files:** `front/orbit.js`, `front/lab.js`, `front/index.html`.

### 2026-10-09: The name behind, PiEN on hover, a tidy chat box

**What:**
- "Pi Tech Lab" (and its translations) sits behind pills and windows, like the π box, instead of floating over window headers.
- PiEN's name inside the mark shows only when you point at the mark, or reach it with Tab.
- siM's chat box: the send button sits inside the right end of the field, centred. A site-wide margin under inputs had pushed it down and against the pill's edge.

**Files:** `front/orbit.js`, `front/orbit.css`, `front/index.html`.

### 2026-10-09: Performance, made simple

**What:** the Performance window now reads in plain words:
- Four cards, one per engine that learns from the site: PiEN, PiDN, siM and ResBD. Each says in one sentence what the engine does and how it is doing, with one small meter.
  - PiEN: how often its suggestion was the one opened, and what it suggests now.
  - The others: how much better they are than their starting point, or what has to happen before they start learning.
- "What happens next": which scoring criteria are expected to count more or less, or why nothing is predicted yet.
- The old detailed forecast (chart, lookback, chart type, sensitivity, modifiers) is folded away under "Show the detailed forecast", still driven by app.js.
- PiEN's separate panel is replaced by its card; pien.js exposes `window.PiEN.stats()` for it.

**Files:** `front/performance.js`, `front/pien.js`, `front/orbit.css`, `front/index.html`, `CLAUDE.md`.

### 2026-10-09: RiBD, your research mentor; SciM

**What (owner's choices):**
- **ResBD is now RiBD,** introduced as "your research mentor": in its window bar, its help text, its Performance card and Capabilities. The monkey face drawn in its window bar is removed.
- **SciLM / siM is now SciM:** the "SciM Assistant" pill (with "Ask SciM…" in its chat box), its Performance card, Architecture, and the app's own labels.
- Only visible names changed. The engines' data keys (`siM`, `riB`) and element ids stay, so the server and app.js are unaffected. Remembered places, use and PiEN's learning carry over from the old names.

**Files:** `front/index.html`, `front/app.js`, `front/orbit.js`, `front/pien.js`, `front/capabilities.js`, `front/performance.js`, `front/architecture.js`.

### 2026-10-09: Unigyro, in the Lab, credited to Murtaza Vefadar

**What:** a "Unigyro" pill in the Lab bubble. Its window plays [Unigyro II: Single-Seater Robot Vehicle](https://www.youtube.com/watch?v=QHxpu1xufFc), Murtaza Vefadar's robot vehicle, with credit and links to the video and his channel ([@MortezaVafadar](https://www.youtube.com/@MortezaVafadar)). The player uses YouTube's privacy-enhanced domain and loads only when the window opens. The README now has a section crediting his two projects in the Lab (Unigyro and QuVI).

The [neurophilic/Unigyro](https://github.com/neurophilic/Unigyro) repository is empty, and this session cannot push to it (the Claude GitHub App is not installed for `neurophilic`). A README for it, citing him with the video and channel, was prepared for the owner to add.

**Files:** `front/unigyro.js`, `front/orbit.js`, `front/orbit.css`, `front/capabilities.js`, `front/index.html`, `README.md`, `CLAUDE.md`.

### 2026-10-09: neurophilic/Unigyro is the source of the Unigyro window

**What:** the Unigyro window's code and styles are two plain files, `front/unigyro.js` and `front/unigyro.css` (the styles moved out of orbit.css). Their source is the Unigyro repository's `pitechlab/` folder. `python back/scripts/sync_unigyro.py --src ../Unigyro` copies them in, and `--check` fails if the site's copies differ, the same pattern as HAL-OS (`build_hal.py`).

The Unigyro repository's contents (README crediting Murtaza Vefadar, a standalone playable page, `pitechlab/`, `CITATION.cff`) are ready but not yet published. This session cannot push to `neurophilic` until the Claude GitHub App is installed there, so the owner adds them; a copy is in Tech/Unigyro.

**Files:** `front/unigyro.css`, `front/orbit.css`, `front/index.html`, `back/scripts/sync_unigyro.py`, `CLAUDE.md`.

### 2026-10-09: NeuroFrenzy, a game in the Lab

**What:** a "NeuroFrenzy" pill in the Lab bubble: a browser port of neurophilic/NeuroGame ("Neuro Speed Typer", a Streamlit app), at the owner's request to rename it NeuroFrenzy.
- Gameplay: fill in the blanks in six neuroscience statements before the clock runs out. Easy (1 blank, 25 s), medium (2, 30 s) and hard (3, 40 s), with the same questions, hints and scoring as the original (10 points per blank, nothing if late or wrong; 120 to win).
- Additions: a visible countdown that turns red in the last seconds, inline blanks, Enter to submit and go on, and a remembered best score (`orbit:nf:best`, so it follows a signed-in account). A game left mid-question starts over when its window closes.
- Answers are checked case-insensitively, ignoring apostrophes, as in the original.

The repository rename (NeuroGame to NeuroFrenzy) and its new contents are for the owner: this session cannot write to `neurophilic`. A ready folder is in Tech/NeuroFrenzy.

**Files:** `front/neurofrenzy.js`, `front/neurofrenzy.css`, `front/orbit.css`, `front/capabilities.js`, `front/index.html`, `CLAUDE.md`.

### 2026-10-09: FaceMace; a Lib bubble; Tools renamed

**FaceMace** (Tools bubble) sorts photos by face, a browser port of neurophilic/FaceID ("Auto Face Discovery & Sorter", Streamlit):
- **How it works.** The same method, step for step, in a Web Worker (`facemace/worker.js`):
  - photos shrunk to 600 px and turned to greyscale;
  - OpenCV's Haar cascade (converted to `facemace/cascade.json`, with its licence) evaluated in plain JS, scale step 1.1, 5 neighbours;
  - LBPH face descriptors (radius 1, 8 neighbours, 8×8 grid) and chi-square nearest neighbour against the 40–120 strictness, learning as it goes.
- **Checked against the Python version with real OpenCV 5.0.** Same groups at strictness 75 and 45, face boxes within a few pixels, distances within a few points. About 1 s per photo; changing the strictness re-groups instantly, since faces are found once.
- **Input and output.** Choose a folder or photos, or drop them. Download a ZIP of `Auto_Sorted_Faces/Person_N/…` and `No_Faces_Detected/`, as the original writes, or save straight into a folder (File System Access API).
- **Private by design.** Photos never leave the device.

**Lib**, a new bubble, now holds NeuroFrenzy (moved from Lab). Groups can be declared empty and filled by modules.

**Tools renamed** (owner's request): "Assess Manuscripts [Pi]" (was Assess a Manuscript) and "Assist a Diagnosis [Intern]" (was Intern). Remembered state and PiEN's learning carry over.

**Files:** `front/facemace.js`, `front/facemace.css`, `front/facemace/`, `front/neurofrenzy.js`, `front/orbit.js`, `front/intern.js`, `front/capabilities.js`, `front/recent.js`, `front/pien.js`, `front/index.html`, `CLAUDE.md`.

### 2026-10-09: Medicine in the Lib bubble

**What:** a Medicine pill in the Lib bubble showing a public road-to-graduation plan: CFU progress (219 of 360, by year), the remaining courses grouped by session, and the to-do list. Data is `front/medicine/plan.json`, rendered by `medicine/view.js`; the same three files form the standalone Medicine repository.

**Why:** the owner asked for the Graduation Plan (now the Medicine folder) to get a repository and a Lib button, public but without personal files. The public plan carries no grades, no dates of passed exams, no average or base score, no course codes and no names; the libretto and correspondence stay private.

**Verified:** pytest at baseline; `build_hal.py` builds; the pill opens at 1440 and 390 px with no page errors, no horizontal scroll and no grade data in the rendered text.

### 2026-10-09: the π logo plays a song

**What:** pressing the PiEN mark plays a 19-second song (`front/sound/dd.mp3`, supplied by the owner); pressing again stops it. `logosound.js` loads the audio on the first press only, and drags never count as presses. The mark keeps its other click behaviour (setting windows aside).

**Verified:** pytest at baseline; `build_hal.py` builds; at 1440 and 390 px the first press plays (audio fetched), the second stops, with no page errors and no horizontal scroll.

### 2026-10-09: a more futuristic logo song

**What:** the logo song was reprocessed with ffmpeg to sound more futuristic: a slow flanger and phaser sweep, chorus, a short space echo, brighter highs, a wider stereo field and loudness normalised to -14 LUFS (the original clipped). Same length.

**Verified:** pytest at baseline; `build_hal.py` builds; the press-to-play / press-to-stop check passes at 1440 and 390 px.

### 2026-10-09: the logo song loops seamlessly

**What:** the song now plays end to end continuously until the logo is pressed again. The file was cut so its last 1.5 s crossfade (equal power) into its start, and `logosound.js` plays it through Web Audio with `loop`, `loopStart` and `loopEnd` set past the encoder's silent padding, so there is no gap or click at the loop point. Starts and stops fade over ~0.1 s; a quick double press ends silent.

**Verified:** decoded file has no edge silence and the seam step matches a normal sample step; still playing after a full loop; stop and double-press checks pass at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: a crisper logo song

**What:** the song was re-rendered from the owner's original upload for clarity: low-mid mud cut (-4 dB at 300 Hz), presence and air lifted (+3 dB at 3.5 kHz, +4 dB shelf above 9 kHz), the flanger, phaser and echo made lighter and shorter, gentler compression, -14 LUFS, and encoded at 256 kbps. It still loops seamlessly (1.5 s equal-power crossfade).

**Verified:** highs up about 3 dB and low-mids down relative to the previous version; loop, stop and double-press checks pass at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: logo song with the noise removed

**What:** re-rendered from the owner's original upload with noise removal: the clipped peaks repaired (`adeclip`), broadband hiss reduced with an FFT denoiser (`afftdn`, 14 dB), the flanger and phaser (which added a hissy wash) dropped, no treble boost, and a gentle low-pass at 15.5 kHz. Clarity kept with a light low-mid cut and presence lift, plus a short echo and wider stereo. Still -14 LUFS, 256 kbps, seamless 1.5 s crossfaded loop.

**Verified:** the 12–20 kHz hiss band is about 7 dB lower than the previous version; loop, stop and double-press checks pass at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: the logo song runs at the tempo of π

**What:** the song and the live π digits now share one tempo. The song measured 99.94 BPM, so it was nudged to exactly 100 BPM (a 0.06% change); π comes at one digit every 60 ms, which is exactly ten digits a beat. The loop is now exactly 8 bars (19.2 s, 320 digits) with a short beat-aligned crossfade. `pi-worker.js` keeps its 60 ms pace without drift and accepts a `sync` message; while the song plays, `logosound.js` re-syncs the digits to the song's beat once per loop (`pi:beat` event, handled in `orbit.js`).

**Verified:** the tiled loop measures 99.99 BPM with the beat at 0.516 s; π runs at 16.6 digits/s idle and while playing; loop, stop and double-press checks pass at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: logo song with less noise, a higher voice, an undetectable loop and π-driven volume

**What:**
- **Stems:** the original was split into vocals and accompaniment with Spleeter (2 stems, run offline; only the final mix is committed).
- **Voice:** the vocals went up 2 semitones with formants preserved, so the tempo is unchanged.
- **Noise:** stronger FFT denoising on both stems (22 and 20 dB), a gentle gate on the vocals and a low-pass at 14.5 kHz.
- **Loop:** the song turned out to repeat every 24 beats, so the loop is now those 6 bars (14.4 s = 240 digits of π). It is cut on matching beats with a one-bar crossfade, and it still runs at 100 BPM.
- **Volume:** the level follows π. `orbit.js` emits `pi:digit` for every computed digit, and `logosound.js` sets the gain to 40% + 60% × digit/9 with a 12 ms glide. The digits are beat-synced at ten a beat, so no two passes of the loop sound alike.

**Verified:**
- **Loop:** the tiled loop measures 99.98 BPM with its beat at the loop start.
- **Volume:** every digit produced exactly the expected volume step (17 a second).
- **π pace:** 16.6 digits a second, whether or not the song plays.
- **Browser:** loop, stop and double-press checks pass at 1440 and 390 px with no page errors.
- **Checks:** pytest at baseline; `build_hal.py` builds.

### 2026-10-09: logo song without the bass

**What:** the owner asked for the bass and low rumble to go. Both stems now pass through steep high-pass filters at 170 Hz (18 dB/oct on the music, 12 dB/oct on the voice), and the 300 Hz cut was eased to -2 dB. Energy below 170 Hz fell from 57% of the mix to 1.4%. Everything else is unchanged: the voice +2 semitones, denoising, the 6-bar seamless loop at 100 BPM and the π-driven volume.

**Verified:** the tiled loop measures 99.99 BPM with its beat at the start; loop, stop, π-volume and tempo checks pass at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: a futuristic whoosh on the logo

**What:** pressing the logo now starts with a whoosh synthesised in Web Audio (no file):
- band-passed noise sweeping 260 Hz → 7.2 kHz and panning left → right
- two gliding tones a fifth apart, slightly detuned

It lasts exactly one beat (0.6 s), so the song drops in on the beat. Stopping plays a shorter whoosh going down (0.45 s) while the song fades out over 0.3 s. Its level is matched to the song's peaks.

**Verified:**
- An offline render: the whoosh peaks at -4.4 dB against the song's -4.1 dB, with no page errors.
- Loop, stop, double-press, π-volume and tempo checks pass at 1440 and 390 px.
- pytest at baseline; `build_hal.py` builds.

### 2026-10-09: triple-click to play, and the owner's chosen loop

**What:**
- **Triple click:** the song now starts and stops with three clicks on the logo, each within 450 ms of the last. A single click only sets windows aside, as before, and only the first click of a burst does so. A double click still re-centres the logo, but that now waits 380 ms and is cancelled if a third click follows.
- **Audio:** back to the version the owner picked (`dd-100-preview`): the cleaned 100 BPM mix with the original vocal pitch and bass, an 8-bar loop (19.2 s = 320 digits) with a beat-aligned join.
- **Kept:** the whoosh and the π-driven volume.
- **Beat sync:** the digits now shift by under 60 ms to meet the beat (any tenth of a beat will do) instead of pausing up to a beat.

**Verified:**
- One or two clicks don't play, and three play and stop.
- A double click still re-centres the logo, and a triple click leaves it in place.
- Loop, π-volume and tempo checks pass at 1440 and 390 px with no page errors.
- pytest at baseline; `build_hal.py` builds.

### 2026-10-09: the song moves to NeuroFrenzy

**What:** the owner moved the song from the π logo into the NeuroFrenzy game.
- **Music:** it plays by default on a seamless 8-bar loop (19.2 s) while the game's window is open and in view. It fades out when the window closes, is set aside or the tab is hidden.
- **Mute:** a "Music on / Music off" toggle sits top-right in the game and is remembered (`orbit:nf:mute`, synced when signed in).
- **Autoplay:** browsers need a gesture before sound, so after a reload that reopens the window, the music starts with the first click or key press.
- **Removed:** the logo is back to its earlier behaviour, and `logosound.js` (the triple click and the whoosh) is gone along with the `pi:digit` / `pi:beat` hooks. The drift-free π pacing stays.
- **File:** `sound/dd.mp3` was renamed to `sound/neurofrenzy.mp3`.

**Verified:**
- A triple click on the logo plays nothing.
- Opening NeuroFrenzy starts the loop at 0–19.2 s. Mute stops it and is stored; unmute restarts it.
- Aside stops it and bringing the windows back restarts it.
- After a reload the context waits suspended, then runs after the first click.
- The game plays as before, and the toggle doesn't overlap the header.
- 1440 and 390 px with no page errors and no horizontal scroll; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: renamed pills

**What:** three pill titles changed, keeping their storage keys so positions, use counts and open windows carry over:
- "Assist a Diagnosis [Intern]" → "Assist Diagnosis [Intern]"
- "NeuroFrenzy" → "Neuro Frenzy" (and the game's heading)
- "Medicine" → "MD"

The Capabilities pill lists them under a new Lib section; Neuro Frenzy was listed under Lab before, and MD wasn't listed.

**Verified:** each opens by its new title at 1440 and 390 px; the group contents are Tools [Assess Manuscripts [Pi], Assist Diagnosis [Intern], FaceMace] and Lib [Neuro Frenzy, MD]; the MD plan and the game music checks pass with no page errors; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: "Support ScholarPi" → "Support Pi"

**What:** the support pill, its window heading, both donation dialogs and the Capabilities entry now read "Support Pi". The pill key changes with its title, so `account:Support ScholarPi` is migrated to `account:Support Pi` (positions, use, window state, priority and open lists), and PiEN aliases the old key so what it has learned carries over. The body text describing ScholarPi is unchanged.

**Verified:** a stored position and priority under the old key moved to the new one; the pill opens by its new title at 1440 and 390 px with no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: double-click the logo to stop π

**What:** a double-click on the PiEN mark now freezes it: the sweep stops turning (`html.orbit-still`, animation paused) and π stops growing (`pi-worker.js` takes `{pause}` / `{resume}`), with the π box reading "N decimals, paused". Another double-click carries on from the same digit. This lasts for the visit only, because π restarts from 3. on every load. Double-click used to re-centre the logo; that is gone (drag it back instead).

**Verified:** the digits stop (0 new in 2 s) and the sweep's animation is paused; a second double-click resumes both; windows aren't left aside; 1440 and 390 px with no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: Neuro Frenzy: music with the clock, difficulty and reset

**What:**
- **Music:** it plays only while a question's clock runs. It fades out when you answer or time runs out, and picks up where it left off at the next question; the audio clock is suspended, so the song keeps its place. It is silent on the start and score screens.
- **Difficulty:** easy, normal and hard on the start screen.
  - Easy gives 1.5× the time and shows the hint.
  - Normal is the original.
  - Hard gives 0.6× the time and no hint.
  - The choice is remembered (`orbit:nf:level`), and each difficulty keeps its own best (`orbit:nf:best` stays normal's).
- **Reset:** a Reset button in the question header returns to the start screen. The score screen adds "Change difficulty".

**Verified:**
- Audio: none on the start screen, running during a question, suspended after answering, running at the next question, suspended after Reset.
- Timing: hard starts at 15 s and easy at 38 s for a 25 s question; the hint is hidden on hard and open on easy.
- Layout: the mute toggle doesn't overlap the header; 1440 and 390 px with no page errors or horizontal scroll.
- Checks: pytest at baseline; `build_hal.py` builds.

### 2026-10-09: ORCID sign-in returns to pitechlab.com

**Bug:** connecting ORCID on pitechlab.com ended on another website. Production's `ORCID_REDIRECT_URI` still points at the old Railway address (`https://scholarpi.up.railway.app/api/auth/orcid/callback`, the URI registered with ORCID). That address is the same backend, so the sign-in worked, but the callback then sent the browser on to its own host. The visitor landed on scholarpi.up.railway.app, signed in there, not on pitechlab.com.

**Fix:**
- **Remembering where you started:** `/api/auth/orcid/login-url` records the origin the visitor started on in ORCID's `state` (`<wallet|none>~<base64url origin>`).
- **Going back there:** `/api/auth/orcid/callback` returns there, on success and on error.
- **Safety:** only known origins are followed, so this is no open redirect. They are pitechlab.com and www, `FRONTEND_ORIGIN`, the callback's own host, and anything in `ORCID_RETURN_ORIGINS` (comma-separated).
- **Compatibility:** old-style states (`none` or a wallet) still work. The registered redirect URI is unchanged, so nothing needs changing at ORCID.

**Verified:** new `tests/test_orcid_return.py` (6 tests):
- lands on `https://pitechlab.com/?orcid=…&token=…` from the old callback host
- the wallet is still carried
- an unknown origin is ignored
- old states still work
- errors go home
- extra origins come from the env

pytest 386 passed with the 12 baseline failures; `build_hal.py` builds; the site loads at 1440 and 390 px with no page errors.

### 2026-10-09: scroll down to open the journal and the ledger

**What:** scrolling down on the main page opens "Proof-of-Research Ledger Explorer" and "The journal", with the journal in front, and brings back any windows set aside. On touch screens a swipe up does the same. This only counts on the page itself, not inside a window, a pill, the π box or the logo, and there is a 0.9 s cool-down. Scrolling up on the page still grows the logo, and the wheel over the logo still resizes it both ways. Scrolling down used to shrink the logo.

**Verified:** a wheel-down on empty page opened both, with the journal in front and the logo size unchanged; a wheel-up grew the logo and opened nothing; a swipe up at 390 px opened both; no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: the framework author links to his page

**What:** in the Architecture window, "Ali Vafadar Yengejeh" (the framework credit) now links to https://alivafadar.carrd.co/ in a new tab. The same goes for the older "Framework Author" note in the Architecture tab markup. The link is in the cobalt interactive colour.

**Verified:** the link opens the page in a new tab at 1440 and 390 px; no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: fix: scrolling opened windows at random and resized the logo

**Bug:**
- Every 0.9 s of a scroll, including a trackpad's momentum, re-opened the journal and the ledger. Each call also brought back every window that had been set aside, so windows seemed to open at random.
- Scrolling up on the page resized the logo.

**Fix:**
- One scroll gesture opens the two at most once; a new gesture needs 600 ms of quiet.
- Nothing happens if both are already open, or while windows are set aside (a logo click brings those back).
- Scrolling up on the page does nothing. The wheel over the logo itself still resizes it.

**Verified:**
- A 2-second momentum scroll opened exactly 2 windows, once.
- A second scroll with both open, a scroll up, and a scroll while aside changed nothing; the logo scale stayed untouched.
- 1440 and 390 px with no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: scrolling opens a random window; the logo loses its trail; friends of π stop too

**What:**
- **Scrolling as a feature:**
  - Scrolling up or down on the page itself (not over a window, pill, the π box or the logo) resizes the logo, up bigger and down smaller.
  - Each scroll gesture also opens one random window that isn't open yet. When everything is open, it brings a random open one to the front.
  - A new gesture starts after 600 ms of quiet, measured on the input's own timestamps so a busy page doesn't split one gesture into many.
  - HAL-OS, links and bubbles are never picked. On touch screens a vertical swipe opens a random window.
- **Logo:** the faded blue trail behind the sweep is removed; the mark is the circle and one line.
- **Double-click pause:** it now stops e, φ and γ as well as π. `orbit.js` dispatches `orbit:still`, `numbers.js` stops showing new digits ("N decimals, paused"), and `consts-worker.js` holds its work between steps until resumed.

**Verified:**
- Scrolling: each gesture opened one distinct window and never HAL-OS; the logo scale went down on down-scrolls and up on up-scrolls.
- Mark: it has 2 lines (no trail).
- Pause: with π and friends open, a double-click froze all four counts for 2.5 s, and another resumed them.
- 1440 and 390 px with no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: RiBD suggests a ledger paper and a scanned manuscript

**What:** RiBD (the research mentor) now opens with "RiBD suggests", two cards chosen for the researcher's profile:
- **From the ledger explorer:** a paper recorded on the Proof-of-Research ledger, the best match, ties broken by piX.
- **A scanned manuscript:** any assessed manuscript, the best match, ties broken by how recently it was scanned. It is never the same paper as the first.

**How matching works:**
- Relevance uses only the profile:
  - a shared field: +3
  - a profile keyword in the title: +2
  - a word from the core claim in the title: +1
- Nothing with zero relevance is suggested, and the researcher's own papers never are.
- Each card says why it was picked and opens the paper's dossier.

**Where it lives:** `back/rib_suggest.py` (pure functions), `GET /api/buddy/suggest` (only public ledger fields: title, author, fields, piX, date) and `front/ribsuggest.js`. `app.js` only adds the slot.

**Verified:**
- `tests/test_rib_suggest.py` (5 tests) checks:
  - two different relevant picks, the first on the ledger
  - own and irrelevant papers never suggested
  - an empty profile asks to be filled in
  - only public fields returned
- Against a local database with a test profile and papers, the endpoint picked the ledger paper on glioblastoma and the stroke manuscript, and left out the researcher's own paper. The cards rendered, and a click opened the dossier, at 1440 and 390 px with no page errors.
- pytest at baseline (12 pre-existing failures); `build_hal.py` builds.

### 2026-10-09: Contact us is a window; a bigger logo; a logo click closes all windows

**What:**
- **Contact us:** it is now a window like the others (drag to an edge to close it) instead of a dialog with a close button. The form is drawn in the window, "Cancel" became "Clear", and after sending, "Send another message" brings the form back.
- **Fixed:** the contact form could never send. `submitBugReport` read `kindEl`, a variable that only existed inside `openBugReport`, so every send failed with "kindEl is not defined". The bug dates back to V2.2.
- **Logo size:** the smallest it can go is now 0.8 (was 0.45), and a smaller saved size is raised to it. It is also larger idle (up to 140 px radius, 18% of the screen) and with windows open (48–100 px desktop, 30–58 px phone, was 20–70 / 16–42).
- **Logo click:** a click now closes every open window, for good and not remembered for the next load. It used to set windows aside until the next click. The close waits 280 ms so a double-click (pause π) doesn't also close everything.

**Verified:**
- Contact: it opens as a window with no modal and no close button; Clear empties it; a send (mocked) shows the reference in the window, and the form comes back.
- Logo: with an old saved scale of 0.45 it is 202 px idle and 114 px with windows at 1440, 106 / 68 px at 390.
- Clicks: a double-click paused π and kept 3 windows open; a click then closed all 3, and none reopened after a reload.
- Layout: the 15-size layout audit has no overlaps; 1440 and 390 px with no page errors or horizontal scroll.
- Checks: pytest at baseline; `build_hal.py` builds.

### 2026-10-09: Contact us never opens as a dialog

**What:** the Contact us button now opens the Contact us window (`PiOrbit.openTitle`) wherever it is reached from, so the old dialog with its × can't appear. The dialog remains only as a fallback if the orbit layout isn't running.

**Verified:** from the pill and from the button, no dialog appears and the form is in a window whose only visible buttons are Send and Clear, at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: papers assessed automatically while the site is idle

**What:** the existing idle worker (`back/idle_worker.py`) is now on, and it can actually run.
- **On by default on the hosted deployments.** Railway sets `RAILWAY_ENVIRONMENT*`. It stays off by default elsewhere, so a clone of this public repo never spends provider quota. `ENABLE_IDLE_ASSESSMENTS=0` switches it off anywhere.
- **What it does:** while the site is quiet it picks a live research topic, finds an open-access paper on OpenAlex and runs it through the normal pipeline.
  - Up to 10 a day (`IDLE_MAX_PER_DAY`), after 5 minutes of quiet.
  - No account is charged, and duplicates don't count.
  - Each assessment is something SciM and PiDN learn from.
- **Fixed: it could never run.** Every request reset the idle clock, including the background polling of any open tab (layout sync every 2.5 s, PiEN, status panels). One tab left open anywhere kept the site "busy" forever.
  - Now only a page load or a request that uses the model providers counts as busy: `/api/assess/…`, SciM chat, reviews, rebuttals, defence strategies, rescoring.
  - Provider requests count as in flight until they finish, and a streamed assessment counts until its last chunk. The worker never starts while one is running.
- **Visible:** `/api/engines/status` includes `idle` (enabled, assessed today, daily cap, latest title and time, working now; no errors or thresholds). The Performance window shows "Working while idle … N of 10 today. Latest: …".

**Verified:**
- `tests/test_idle_busy.py` (6 tests):
  - polling isn't busy, while people and provider calls are
  - polling doesn't reset the idle clock
  - an in-flight assessment blocks the worker
  - on by default only when hosted, and `=0` turns it off
  - the public status has no operator detail
- Local run with an open tab polling:
  - the worker went idle and tried to fetch topics from OpenAlex (blocked from this sandbox, reachable from Railway)
  - the Performance window showed the line at 1440 and 390 px with no page errors
- pytest at baseline (12 pre-existing failures); `build_hal.py` builds.

### 2026-10-09: idle worker never spins

**What:** the idle loop now waits at least 10 s between checks and before its first one, whatever `IDLE_POLL_SECONDS` / `IDLE_AFTER_SECONDS` are set to. With either at 0, the loop would otherwise run flat out and take a CPU core from the site. Assessments already in flight still block the worker, so a short quiet period never competes with a visitor's running assessment.

**Verified:** a new test with both set to 0 shows every wait ≥ 7.5 s (10 s with jitter); pytest at baseline; `build_hal.py` builds; the site loads at 1440 and 390 px with no page errors.

### 2026-10-09: the Live panel

**What:** a panel fixed to the right-hand side showing what the site is doing now:
- whether it is assessing papers by itself while idle, with a pulsing cobalt dot while one is in progress
- how many papers were assessed today (and how many by itself), and the total
- the 12 latest assessments:
  - papers the site found and assessed itself (open access) are named, and the title opens the dossier
  - other people's uploads show only field, piX, day and whether they were signed in, as in Recent assessments

It refreshes every 30 s (only while the tab is visible) and after your own assessment.

**Layout:**
- **Wide screens (≥ 1100 px):** it starts docked. The orbit layout gives up its 300 px (stage, pills, logo, rings), and windows centre and size in the space beside it.
- **Folding:** the "Live" tab folds it to a slim tab and back, and the choice is remembered (`orbit:live:open`).
- **Narrow screens:** it starts folded, opens over the page, and the pills keep clear of the tab.

**Backend:** `back/live.py`, `GET /api/live`. Idle papers are recognised by their submitter, "ScholarPi (idle)". Recent assessments no longer counts that submitter as "signed in".

**Verified:**
- `tests/test_live.py` checks that idle papers are named and people's uploads never show their title or hash; the `test_recent.py` tests still pass.
- Docked at 1440 and 1100 px, no orbit element crosses into the panel, and an opened window stays left of it.
- Folded at 1024, 390 and 360 px, the tab overlaps no pill and opens the panel.
- The 15-size layout audit passes; no page errors or horizontal scroll.
- pytest at baseline (12 pre-existing failures); `build_hal.py` builds.

### 2026-10-09: Download paper in the dossier; a yellow account dot for one sign-in

**What:**
- **Download paper:** every dossier has a "Download paper" button (`front/download.js`). The server still decides who may have the file (`/api/papers/{hash}/file`, now with `?download=1` for a file to save). That is anyone once the author has published the assessment, or the author for their own upload; the session token goes with the request.
  - If the file isn't available but the paper has a DOI (as auto-assessed open-access papers do), the button opens the publisher's copy.
  - Otherwise it says the manuscript stays private until its author publishes it.
- **Account pill:** the dot is red when signed out, yellow (muted, #c9a53e) with one sign-in (a wallet or ORCID), and a green check with both. Its title says which one is missing.

**Verified:**
- Download:
  - a published paper downloads as "Published paper π test.pdf" (UTF-8 name kept)
  - an idle open-access paper opens its DOI
  - a private draft shows the message, and its file stays 404
- The download response is `attachment` with `?download=1` and `inline` without.
- Account dot: red, yellow with ORCID only, green with both.
- 1440 and 390 px with no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: RiBD: papers to read and hot topics

**What:**
- **Papers to read:** besides the ledger paper and the scanned manuscript, RiBD suggests up to three more relevant papers ("Also worth reading"), best match first, then highest piX. Never the researcher's own.
- **Hot topics to research:** fields with at least two assessed papers, ranked by 0.4 × average piX, 0.4 × average piQ minted per paper and 0.2 × papers in the last 30 days, each scaled across fields.
  - Each line shows avg piX, avg piQ per paper, new in 30 days, the paper count and a heat bar, and marks the researcher's own fields.
  - It is shown even before a profile is filled in, and is labelled as what has paid off here so far, not a promise.

The backend is `rib_suggest.hot_topics` and the `more` and `hot` fields of `/api/buddy/suggest`, read over the newest 2,000 assessments.

**Verified:**
- `tests/test_rib_suggest.py` (now 8 tests):
  - more reading is relevant and distinct
  - hot topics rank by piX, piQ and activity
  - fields with a single paper are left out
  - "your field" is marked
  - it works without a profile
- Against a local database:
  - Neuroscience ranked hottest (avg piX 71.7, 1.77 piQ, 3 new) and Physics coldest
  - the reading list was glioblastoma and stroke papers
  - the panel renders at 1440 and 390 px with no page errors or horizontal scroll
- pytest at baseline (12 pre-existing failures); `build_hal.py` builds.

### 2026-10-09: ORCID sign-in uses the site's own callback

**Bug:** the owner updated the ORCID app's redirect URIs to pitechlab.com. Production still sent `redirect_uri=https://scholarpi.up.railway.app/api/auth/orcid/callback` (from `ORCID_REDIRECT_URI`), so ORCID refused every sign-in with "redirect_uri does not match for registered client".

**Fix:** signing in from one of the site's own addresses (pitechlab.com, www, exp) asks ORCID to return to that address's own callback, `https://<host>/api/auth/orcid/callback`, whatever `ORCID_REDIRECT_URI` says. The token exchange uses the same value. Other hosts keep the old behaviour. Each callback must be registered in the ORCID app.

**Verified:** `tests/test_orcid_return.py` (7 tests): the login URL and token exchange use `https://pitechlab.com/api/auth/orcid/callback`, the visitor lands back on pitechlab.com, and the earlier return-origin, error and open-redirect tests still pass. pytest at baseline (12 pre-existing failures); `build_hal.py` builds; the site loads with no page errors.

### 2026-10-09: the Lib bubble becomes Library, with RiBD and the Map of Science

**What:** the "Lib" bubble is renamed "Library" and now holds RiBD and The Global Map of Science as well as Neuro Frenzy and MD.
- The bubble's key moves from `lib:Lib group` to `lib:Library group`, and the stored position migrates with it.
- RiBD still only shows when signed in, as before.
- A window opened from a bubble is now labelled with the bubble (Library, Tools, Lab) instead of its old tab name (Evaluate, Envision).
- Capabilities lists the four under "Library".

**Verified:** signed in, the bubble lists RiBD, The Global Map of Science, Neuro Frenzy and MD, and none of them is left as a loose pill. Each opens with the "Library" label. A position saved under the old key is carried over. No pills overlap, the 15-size layout audit passes, and there are no page errors or horizontal scroll at 1440 and 390 px. pytest at baseline; `build_hal.py` builds.

### 2026-10-09: the π mark and counter show what the site is processing

**What:** the sweep of the π mark and the live π counter now represent the site's work. Each level sets the sweep speed, the digit rate and the counter's wording:

| Level | Sweep | π digits | Counter reads |
|---|---|---|---|
| quiet | 18°/s, a turn in 20 s | 2.5/s | "N decimals, the site is quiet" |
| working (one paper being assessed, by a person or by the site itself while idle) | 60°/s | 11/s | "assessing a paper" |
| busy (several at once) | 165°/s | 25/s | "assessing several papers" |

The mark also gets a soft cobalt glow while working.

**How:**
- **Server activity:** `GET /api/activity` (back/live.py, from `idle_worker.activity()`, no database) reports provider requests in flight and whether the idle worker is assessing. `orbit.js` polls it every 5 s while the tab is visible.
- **This page's own requests:** a request the page is waiting on (`orbit-busy`) raises the level by one.
- **Smooth sweep:** the sweep is now turned by `orbit.js` (requestAnimationFrame) at a speed that eases to the new level, so a change of pace never jumps the line.
- **Digit pace:** the π worker takes `{pace}`.
- **Unchanged:** double-click still stops both, and reduced motion keeps the mark still.

**Verified:**
- With `/api/activity` mocked to each level at 1440 and 390 px:
  - quiet ran at 2.5 digits/s and 18°/s, working at 11 and 60, busy at 25 and 166
  - the counter wording changed with each level
  - after a double-click, π stopped and the sweep eased to a halt
  - no page errors or horizontal scroll
- `tests/test_live.py` checks the activity levels.
- pytest at baseline (12 pre-existing failures); `build_hal.py` builds.

### 2026-10-09: slower π

**What:** the owner found π grew too fast. Digits now come at 1 a second while quiet (was 2.5), 2.5 a second while a paper is assessed (was 11) and 5 a second with several (was 25). The sweep speeds are unchanged.

**Verified:** the measured rates over 4 s at each level were 1.0, 2.5 and 5.0 digits/s at 1440 and 390 px, with no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

### 2026-10-09: deploy fix, ASCII commit messages

**What:** the last two production deploys failed at Railway's "Build image" step within 5 seconds, before any Dockerfile step ran. Their commit subjects were the only ones containing a non-ASCII character (π); every deploy with an ASCII subject, before and since, built. The code is unchanged. This commit has an ASCII message so the same code builds, and CLAUDE.md now asks for ASCII commit messages.

### 2026-10-09: the real deploy failure, Docker Hub's rate limit

**Correction:** the entry above blamed the π in commit messages. The build log shows the real cause: `load metadata for docker.io/library/python:3.11-slim` → `429 Too Many Requests` from registry-1.docker.io. Railway's builders share Docker Hub's anonymous pull limit, and the commit messages had nothing to do with it.

**Fix:** the Dockerfile now pulls the same official image from AWS's public mirror, `public.ecr.aws/docker/library/python:3.11-slim`, which has no Docker Hub limit. CLAUDE.md rule 6 now records this instead of the wrong ASCII rule.

**Verified:** pytest at baseline; `build_hal.py` builds. The sandbox cannot reach public.ecr.aws, so the experimental deploy of this commit is the first real build check.

### 2026-10-10: the forecast tests run again

**What:** `tests/test_forecast.py` imported a `forecast` module that no longer exists, so the whole file was skipped with `--ignore` and its 14 tests (forecast caching, bounded training, the Holt fallback) protected nothing. The module was renamed piD (`back/pid_engine.py`) with the same functions, so the test now imports `pid_engine as forecast`. CLAUDE.md's pre-push command drops the `--ignore`.

**Verified:** all 14 forecast tests pass; the full suite is 12 failed (the same pre-existing baseline) and 418 passed, up from 404; `build_hal.py` builds; the site loaded at 1440 and 390 px on every tab with no page errors and no horizontal scroll (no frontend change).

**Files:** `back/tests/test_forecast.py`, `CLAUDE.md`, `EVOLUTION.md`.

### 2026-10-10: website traffic in Analytics

**What:** the Analytics window now has a "Website traffic" section:
- **Tiles:** distinct visitors today, in the last 7 days, the last 30 days and all time.
- **Chart:** a 30-day bar chart of distinct visitors per day, one cobalt series, hover tooltip per day with visitors and visits.
- **Table view** of the same numbers.

**Data:** `back/traffic.py`, a new `site_traffic` table (day, the existing keyed IP hash, visit count), filled by the same once-per-session ping as the visitor total (`POST /api/visit`).
- `GET /api/traffic?days=30` returns aggregates only.
- Rows older than 120 days are dropped.
- "All time" is the existing `site_visits` total (never less than what the daily table has seen).
- The day series starts from this deploy, since no per-day history was kept before.

**Verified:**
- `tests/test_traffic.py` checks counting, gap filling, the 7- and 30-day windows, all time, the upsert and pruning, and that no visitor key leaves the API.
- With 30 seeded days, the section rendered in the Analytics window at 1440 and 390 px: 4 tiles, bars for the days with visitors, a 30-row table, and a tooltip on hover. No page errors or horizontal scroll.
- pytest at baseline (12 failures, now including test_forecast); `build_hal.py` builds.

### 2026-10-10: the traffic chart keeps its proportions

**What:** the new Website traffic chart in Analytics drew a fixed 600×150 drawing and stretched it to the window with `preserveAspectRatio="none"`. On a phone the day and count labels came out squashed and the bar corners warped, and on a wide screen they were drawn wider than they should be. The chart is now drawn at the box's real width (one unit per pixel) and redrawn when the window or panel is resized.

**Verified:** screenshots of the chart with a hovered bar at 1440 and 390 px show labels at their normal shape and round bar tops; every tab at both widths had no page errors and no horizontal scroll; pytest at baseline (12 pre-existing failures, 420 passed); `build_hal.py` builds.

**Files:** `front/traffic.js`, `front/traffic.css`, `front/index.html`, `EVOLUTION.md`.
### 2026-10-10: HAL-OS boots to a command prompt

**What:** HAL-OS is now a basic working OS. The Lab's machine boots a 16-bit real-mode shell (`front/hal/shell/shell.asm`, about 3 KB) to a `HAL-OS>` prompt. It uses only the BIOS (video, keyboard, clock, memory, disk), so it would run on QEMU, VirtualBox or real hardware too. Commands:
- help, clear/cls, echo
- time and date (the RTC, UTC), uptime, mem (conventional and extended memory)
- color XY (text attribute), calc A op B (signed 16-bit + − * / %)
- note TEXT / notes (kept in memory until reboot), pi (100 digits), ver/about
- reboot, halt
- hal: starts the ternary network

Commands are case-insensitive, and the line editor supports backspace.

**How it hands over:** `hal` writes a marker (`ESC HAL-OS:BOOT-NETWORK`) to COM1. `hal.js` watches the serial port in shell mode and boots `bitllm.img` with the same weight disk, so the network behaves exactly as before.
- In shell mode the guest gets the keyboard, and nothing is sent down the wire.
- Reboot returns to the prompt. Forget and Load weights boot the network directly.

**Build:** `python back/scripts/build_hal_shell.py` (nasm) writes `front/hal/shell.img` (padded to 64 KB, committed, so deploys need no nasm). `--check` verifies it matches the source. The HAL-OS repository itself is untouched.

**Verified:** in the browser, on the standalone portal and inside the Lab window, at 1280/1440 and 390 px:
- every command produced the expected output, e.g. `calc 12 * 7` → 84, `calc -100 / 7` → -14, `mem` 639 KB + 3072 KB
- notes round-tripped, an unknown command was reported, and Shift worked for capitals and `*`
- `hal` booted the network (≈190 fps, weights restored path intact), and Reboot came back to the prompt
- no page errors or horizontal scroll

pytest at baseline; `build_hal.py` builds.

### 2026-10-10: the page, super-simplified

**What:** the owner asked for a super-simple interface. The stage went from about 20 pills of mixed styles to six bubbles and two pills:
- **Bubbles:**
  - Tools, Library and Lab, as before.
  - **Explore:** The journal, Leaderboards, Proof-of-Research Ledger Explorer, Recent assessments.
  - **About:** Analytics, Performance, Architecture, Whitepaper, Minting Difficulty, GitHub, Capabilities.
  - **Connect:** Why sign in, Invite a researcher, Support Pi, Contact us.
- **Pills:** Your account (with its sign-in dot) and the SciM Assistant chat.
- **One look:** every pill and bubble is the same calm outline in Geist, at one size. The varied typefaces, ink/dashed/square styles and usage-based sizes are switched off (`SIMPLE` in orbit.js keeps them for later), and so is the bold for much-used pills.
- **Ornaments:** the dashed orbit rings are gone, leaving the π circle as the only ornament. Bubbles carry a single cobalt dot.
- **Late pills:** pills that modules add later (Capabilities, Recent assessments) join the bubble that lists them.
- **Phones:** long member names wrap so nothing runs off a narrow screen.

**Verified:**
- At 1440, 1024 and 390 px the stage shows exactly the eight items with no overlaps, and nothing off-screen at 390 or 360 px.
- Members open their windows labelled with their bubble (Explore / The journal, About / Capabilities, Connect / Contact us).
- The 15-size layout audit passes; no page errors or horizontal scroll.
- pytest at baseline; `build_hal.py` builds.

### 2026-10-10: bubbles wired together like LabVIEW

**What:** the six bubbles and two pills are joined by wires in the style of a LabVIEW block diagram: square terminals at each end and right-angled wires (side to side, or bottom to top when stacked), drawn under the bubbles. The wires follow how data actually moves through the site:
- Your account → Tools
- Tools → Explore (an assessment lands in the journal and the ledger)
- Explore → Library (RiBD, the map), Explore → About (analytics, performance), Explore → SciM Assistant
- Connect → Your account
- Lab → Library

**Activity:** a wire comes alive while a window at either end is open: cobalt, with data flowing along it and filled terminals. The Tools → Explore wire is also live while the site is assessing a paper. The flow speeds up with the site's activity level from `/api/activity`: 1.6 s quiet, 0.8 s working, 0.4 s busy. Reduced motion shows a solid live wire instead. Wires redraw every 250 ms, so they follow pills as they move.

**Verified:**
- At 1440 and 390 px there are 7 wires, none live at rest.
- Opening The journal made the 4 wires touching Explore live, and closing all windows made them quiet again.
- No pill overlaps, page errors or horizontal scroll.
- pytest at baseline; `build_hal.py` builds.

### 2026-10-10: the superellipse look, for se.pitechlab.com

**What:** `front/superellipse.css` gives superellipse ("squircle") corners to pills, bubbles, member chips, buttons, cards, tiles, the π box and windows. It uses CSS `corner-shape: superellipse(2)` with radii that suit each element. Browsers without corner-shape (at the time of writing, those outside Chrome/Edge 139+) keep ordinary rounded corners at the same radii.

**When it is on:** when `<html>` has `shape-se`, which `channel.js` sets:
- on any host starting with `se.`, so se.pitechlab.com needs no configuration beyond the domain
- with `?shape=se` in the address
- when `/api/build` reports `"shape": "superellipse"` (the new `SCHOLARPI_SHAPE` variable)

The experimental banner then reads "Superellipse preview". Every other site is unchanged.

**Verified:**
- With `?shape=se` at 1440 and 390 px, bubbles, chips and windows compute `corner-shape: squircle` (radii 19.5 / 12.9 / 26 px).
- Without it, pills stay round and the class is absent.
- No page errors or horizontal scroll.
- pytest at baseline; `build_hal.py` builds.

**Setting up the subdomain (owner, in Railway and DNS):** add `se.pitechlab.com` as a custom domain, either on the experimental service (the same site and data in the new look) or on a new environment deploying `experimental`. Then add the CNAME record Railway shows at the DNS provider.

### 2026-10-10: Superellipse title for the superellipse look

**What:** `front/selogo.js` draws the "Pi Tech Lab" title from superellipse geometry (|x/a|^n + |y/b|^n = 1, n = 4): letters built from superellipse rings and bars, with a cobalt superellipse dot on the i, inside a superellipse badge. It replaces the text title only when `html.shape-se` is set (se.pitechlab.com, `SCHOLARPI_SHAPE=superellipse` or `?shape=se`). The accessible name stays "Pi Tech Lab".

**Why:** the owner asked for the title to be built on superellipses, with letters and badge both superellipse-based.

**Verified:**
- pytest at baseline (12 failed, 420 passed); `build_hal.py` builds.
- Browser at 1440 and 390 px with `?shape=se`: logo shown, text title hidden, no overlap with pills, no horizontal scroll, no errors.
- Without the superellipse look the plain text title is unchanged.

### 2026-10-10: n means something: buttons n = γ, windows n = π; a Functions palette

**What:**
- `front/semorph.js`: in the superellipse look, buttons, pills and bubbles have corners with exponent n = γ (Euler–Mascheroni, 0.5772…, concave), and windows and cards n = π. Both values are computed in the page and keep improving: γ from H_m − ln m with its asymptotic correction (or the Numbers window's exact digits once present), π from the mark's live digits (Machin's formula until they arrive). They reach CSS as `corner-shape: superellipse(K)`, n = 2^K.
- Opening a window grows it out of its button while n climbs from γ to π; closing folds it back while n falls to γ. The moving outline is drawn from the superellipse formula, so browsers without `corner-shape` see the morph too. Reduced motion skips it.
- `front/labview.js` + `labview.css`: a LabVIEW-style Functions palette, bottom-left: Add, Subtract, Multiply, Divide, And, Or, Exclusive Or, Not, Greater?, Equal?, For Loop, While Loop, Case Structure. They are dummies that fire on the two newest π digits; the loops run until pressed again. It starts open only where it does not cover the diagram (folded on phones) and remembers your choice.

**Why:** the owner asked for minimise/maximise to be a change in n, buttons at n = γ, windows at n = π, computed by the app and animated; then for dummy LabVIEW function buttons.

**Verified:** pytest at baseline (12 failed, 420 passed); `build_hal.py` builds. Browser at 1440, 1280×720 and 390 px, with and without `?shape=se`: CSS gets K = log2 γ and log2 π, the morph runs γ → π on open and π → γ on close and leaves nothing behind, every palette node gives a result, the palette covers no bubble when it starts, no horizontal scroll, no page errors.

### 2026-10-10: Diamonds, n by use, a graphical language, and the mark as the central loop

**What:**
- Superellipse look: buttons, pills and bubbles are stretched four-pointed diamonds (each end half a superellipse at n = γ, `border-radius: X / 50%` with `corner-shape`). Each button's own n grows with use, n(u) = γ + (π − γ)·u/(u + 8), set per element as `--se-k` (`@property`, not inherited); the open/close morph starts from that n. Dots, wire terminals, the node output terminals and the title's i-dot are whole γ-superellipses (sparkles), via a computed `clip-path` polygon (`--se-sparkle`) or `SeMorph.star`.
- `labview.js` is now a small graphical language: drag a node out of the Functions palette onto any pill, bubble, window, the π mark, the π counter or another node and it is wired to it and computes live (pills and windows give their use count, open state and name; the mark gives the newest π digit; nodes chain). Text, Join and Ask SciM build prompts graphically; Ask SciM sends to the SciM Assistant only when pressed. Drop on the palette to remove, double-click to unwire, press a loop to pause it. On phones the palette folds while dragging so the pills under it can be reached. The diagram is kept in localStorage.
- The mark is the central loop in the superellipse look: a superellipse at n = π (drawn by orbit.js from the live π), the diameter reaching the curve at every angle, the π counter inside it (in the mark's layer), and a While Loop's terminals: i, and continue/stop, which follows the double-click pause. A click on the counter still opens π and friends; elsewhere the counter is unchanged.

**Why:** owner requests: Gemini-like diamonds ("buttons become diamonds"), nodes draggable and attachable to every button and object, n growing with use, "this is a graphical language", "prompts are made graphically", and the mark and counter merged into a superellipse central loop.

**Verified:** pytest at baseline (12 failed, 420 passed); `build_hal.py` builds. Browser at 1440 and 390 px with `?shape=se`, and 1280×720 plain: Add wired to the π mark and Performance computes; Text "Explain" + Join + Whitepaper gives "Explain Whitepaper", and Ask SciM opens SciM with it; Performance's n rose from γ to 1.43 after use; drop on the palette removes; the diagram survives a reload; the counter sits in the loop, opens π and friends on click, and the stop terminal shows when π is paused; plain look keeps the counter under the mark; no horizontal scroll, no page errors.

### 2026-10-10: Symmetric superellipses; stars that grow with use; scroll the loop's n

**What:** in the superellipse look every shape is a full symmetric superellipse |x/a|^n + |y/b|^n = 1 (`border-radius: 50%` + `corner-shape`), as in the owner's Desmos pictures. A pill is a small star at n = γ beside its name until it is used; each use (t = u/(u+8)) widens it and raises n until, at n = π, it is the shape around the name; hover or focus shows it fully grown (`--se-t`, `--se-k` registered with `@property`, so they animate). Bubbles, buttons in windows and Functions nodes are superellipses at n = π. Scrolling on the central loop changes its n (0.3 to 12, shown while scrolling, kept in this browser); elsewhere scroll still resizes the mark. The While Loop terminals were removed at the owner's request.

**Why:** owner: "central logo is superellipse and scrolling changes its n", "objects should be symmetrical superellipse", "button should transition from star … into the other shape value" (chose: star until used), "delete these" (the loop terminals).

**Verified:** pytest at baseline (12 failed, 420 passed); `build_hal.py` builds. Browser at 1440 and 390 px: unused pills are stars, Performance after 6 uses t = 0.43 / n = 1.68, hover grows to t = 1, the loop's n scrolls 1.83 → 6.45 and survives a reload; the diagram, Ask SciM and the open/close morph tests still pass; no horizontal scroll, no page errors.

### 2026-10-10: The mark from a dot to the whole page; curved wires you can rewire

**What:**
- Scrolling on the mark (or empty space) sizes it from a 4 px dot to a radius covering the whole page (`logoMin`/`logoMax` from the screen, replacing the 0.8 to 2.2 range). Past the room around it (`capR`, 42% of the short side) it centres and becomes a backdrop behind the pills and windows (`orbit-mark-big`); the layout stops treating it as an obstacle, and scrolling the backdrop only sizes it (it no longer opens a random window). Below 40 px the counter inside the loop hides (`orbit-mark-tiny`). In the superellipse look the loop's n moved to Shift + scroll.
- Wires between bubbles are curves (cubic Béziers out of a side or the bottom). Click a wire to disconnect it; drag from a bubble's handle (a terminal just outside the edge facing away from the mark) onto another bubble to connect them; Escape cancels. The wiring is kept as `orbit:wires`. The Functions nodes' wires are curves too and disconnect on click. Wires are only rebuilt when they change, so clicks land.

**Why:** owner: "the logo can get bigger by scrolling max to encompass the whole page, minimum to be dot"; "lines are curved and can be connected or disconnected".

**Verified:** pytest at baseline (12 failed, 420 passed); `build_hal.py` builds. Browser at 1440 and 390 px (superellipse look) and 1280×720 plain: the mark scrolls to 8 px and up to cover the stage, pills stay on top and clickable, the size survives a reload; Shift + scroll changes n; all wires curved; a click removes one, a handle drag adds Lab–Tools, both kept after reload; a node's wire disconnects on click; no horizontal scroll, no page errors.

### 2026-10-10: The loop is the page; scrolling moves n from 0 to ∞

**What:** in the superellipse look the mark is a superellipse the size of the stage (a, b = half its width and height; the SVG stretches with `preserveAspectRatio="none"`), behind the bubbles, so everything sits inside it, with the π counter at its centre. Scrolling anywhere on the page (no Shift) moves n from 0.01 to 1000, shown as "n → 0" and "n → ∞" at the ends: the loop pinches to a cross and then the centre, passes through a diamond (1) and an ellipse (2), and fills the page's rectangle. It is kept as `orbit:mark:n`. The layout keeps a clear area at the centre for the counter. Shift + scroll is gone. Also fixed: in backdrop mode the stage's opaque paper hid the mark, so the paper now sits on the mark's layer just under a see-through stage (this affected the plain look's page-sized mark from the previous change too).

**Why:** owner: "remove shift scrolling. zooming makes it n from 0 to infinity and everything is inside this super[ellipse]".

**Verified:** pytest at baseline (12 failed, 420 passed); `build_hal.py` builds. Browser at 1440 and 390 px (superellipse look): the loop spans the stage and every bubble is inside it; scrolling gives n = 0.128, n → 0 and n → ∞; it opens no windows; n survives a reload; the counter opens π and friends. Plain look at 1280 and 390: dot to page size scroll unchanged, and the page-sized mark is now visible. No horizontal scroll, no page errors.

### 2026-10-10: Everything inside the loop

**What:** in the superellipse look the loop always holds every object on the page.
- **Containment:** each time it is drawn (and every 250 ms), `drawLoop` measures the bubbles, title, π counter, Functions palette, Live tab and panel, and diagram nodes, and scales the superellipse just enough that every corner (plus 6 px) satisfies |x/a|^n + |y/b|^n ≤ 1. At n = π this is the page's own frame; for small n the sides curve inward and hug the outermost objects (the loop itself grows far beyond the screen, and only the visible part is drawn, by x, so it stays smooth down to n = 0.01).
- **Layout:** the loop is drawn in page coordinates over the whole screen, including the Live panel. The bubble layout only uses room inside the loop at n = π, and treats the Functions palette as an obstacle (re-laid out when the palette opens or closes).
- **Edge items:** `seatEdges` steps the title, the palette and the floating Live panel in from their edge or corner until they fit inside it, on any screen.
- **Mark behaviour:** empty space inside the loop now acts as the mark (a click closes all windows, a double-click pauses π). With a window open, the loop gathers into a small superellipse mark above the windows, as in the plain look, so it can still be tapped on a phone.

**Why:** owner: "put everything inside the main super".

**Verified:** pytest at baseline (12 failed, 420 passed); `build_hal.py` builds. Browser at 1440 and 390 px: no object outside the loop at n = π (scale 1, the page frame), 0.285, 0.0116, 0.01 and ∞, and with Live opened and closed; the palette covers no bubble, open or closed; a click on empty space and a tap on the small mark close windows; a double-click pauses and restarts π; the diagram, Ask SciM and window morph tests pass; no horizontal scroll, no page errors.

### 2026-10-10: The main loop connects to everything

**What:** the main loop (the mark) is a wire end, stored as "π" in `orbit:wires`.
- **Bubble wires:** drag from a bubble's handle onto the loop's edge, the π counter or the mark (plain look) to wire them. In the superellipse look you can also drag from the loop's edge (`.loop-hit`, a 16 px band along the curve) onto any bubble. The wire meets the loop where it faces the bubble (`loopPoint`), leaving the bubble by the side facing it. Click to disconnect, as with the other wires; the loop lights up while a wire is held over it.
- **Diagram nodes:** they meet the loop the same way. A node dropped on the loop's edge takes it as an input; a drop on empty space inside it still just places the node (`nearLoop`).

**Why:** owner: "main super can connect to everything".

**Verified:** pytest at baseline (12 failed, 420 passed); `build_hal.py` builds. Browser at 1440 and 390 px (superellipse look) and 1280×720 plain: Lab handle → counter or mark saves ["Lab","π"] and draws it; loop edge → Tools saves ["π","Tools"]; a click removes a loop wire; Add dropped on the loop edge takes it as input, Subtract dropped on empty space stays unwired; no horizontal scroll, no page errors.

### 2026-10-10: A connector on every word, character and number

**What:** `front/superlink.js`.
- **Connect mode:** a Connect node in the Functions palette turns it on (Escape turns it off). While it is on, the piece of text under the pointer lights up, found with `caretPositionFromPoint` / `caretRangeFromPoint` and checked against the character's own box:
  - a word (letters together);
  - a number (up to 12 digits together);
  - a single character (a symbol, a digit of π or its friends, or a digit inside a longer run).
- **Wiring:** drag from it to another word, number or character, to a bubble or window, or to the main loop's edge, and a curved wire joins them (sparkle terminals in the superellipse look). Click a wire to disconnect it. Mode swallows the page's own clicks and drags so nothing opens by accident; the palette still works.
- **Saving:** each end is stored by its host (a bubble or pill's key, a window's title, the counter, Live, the palette, a node) plus the piece and which occurrence it is. So a wire returns after a reload and whenever its window is open again, and hides while its text is not on screen. Kept as `orbit:textwires`.
- **Fix:** a node dropped on the page-sized loop's edge now settles just inside the loop near the drop, instead of at the screen's edge.

**Why:** owner: "every word every character every number can have a super connector".

**Verified:** pytest at baseline (12 failed, 420 passed); `build_hal.py` builds. Browser at 1440 and 390 px (superellipse look) and 1280×720 plain:
- "engines" → "PiEN" in the Performance window is wired, redrawn after a reload, and removed by a click;
- a single π digit → the loop, and the π symbol → "Analytics", are wired;
- the count line's number is picked as a whole number;
- Escape leaves the mode;
- bubble wiring, node wiring and the diagram tests still pass;
- no horizontal scroll, no page errors.
