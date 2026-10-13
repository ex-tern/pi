# ScholarPi — Pi-Index Assessment Engine

A local-first (and production-deployable) research-assessment webapp:

- **Backend:** FastAPI (`backend/api.py`) — REST/streaming API, also serves
  the frontend as static files from the same process.
- **Frontend:** plain HTML/CSS/JS (`frontend/`) — no build step, no
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
  `frontend/quvi/` is an independent browser implementation of the same model, credited to him under the MIT licence.

The video and both projects remain his.

---

## 1. Local development

```bash
python scripts/tools.py run     # macOS, Linux or Windows (add --lab: with HAL-OS and private projects)
```

It creates a virtualenv, installs dependencies, copies
`backend/.env.example` → `backend/.env` on first run, and starts the server
with auto-reload. Open **http://localhost:8000**.

### Manual setup
```bash
cd backend
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

Add keys to `backend/.env` any time — no code changes needed. See
`backend/.env.example` for where to get each one.

---

## 2. Production deployment

### Bare metal / VM (systemd + nginx)

Python and Rust only: there is no Docker image, by design.

1. `cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
2. `cp .env.example .env` and fill it in; set `ENVIRONMENT=production`
3. Copy `deploy/scholarpi.service` to `/etc/systemd/system/`, edit the
   paths/user to match your setup, then:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now scholarpi
   ```
4. Copy `deploy/nginx.conf.example` to `/etc/nginx/sites-available/`, fill
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
  defense in depth — see `deploy/nginx.conf.example`).
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
- `deploy/scholarpi.service`
  includes basic systemd sandboxing (`ProtectSystem=strict`,
  `NoNewPrivileges=true`).
- **Pinned, trimmed dependencies** (`requirements.txt`) — compatible-release
  version ranges instead of unpinned `latest`, and five packages that were
  listed but never actually imported anywhere in the codebase (`pandas`,
  `torchvision`, `beautifulsoup4`, `tabulate`, `groq`) were dropped.
- **Automated tests** (`backend/tests/`, run via `pytest`) covering the
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
cd backend
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
| Sidebar (wallet, ORCID, live logs, Scilem chat) | `frontend/index.html` sidebar + `/api/auth/*`, `/api/logs`, `/api/scilem/*` |
| Assess Manuscript (local PDF or DOI lookup) | "Assess Manuscript" tab + `POST /api/assess/stream` (NDJSON progress stream) |
| pi-Dyne LSTM forecast | "Analytics & Map" tab + `GET /api/forecast` |
| Map of Science | Same tab, rendered client-side with `vis-network` from `GET /api/analytics/map` |
| piQ Leaderboard / piX Top Papers | `GET /api/analytics/leaderboard`, `GET /api/analytics/top-papers` |
| Ledger Explorer (search + full dossier, tx linked to Etherscan) | "Ledger Explorer" tab + `GET /api/explorer/search`, `/latest`, `/dossier/{hash}`, `/tx-url` |
| Architecture | "Architecture" tab, static description |
| Defense strategy / criterion detail modals | Modal popups, backed by `/api/defense-strategy` |
| Health check | `GET /api/health` |
| Background cron worker | `python backend/api.py cron`, or `.github/workflows/cron.yml` |

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

- **The science engines are open source** under the [GNU AGPL 3.0](LICENSES/AGPL-3.0-only.txt): the Pi-Index
  rubric and the assessment pipeline, now all in `backend/api.py` (the whole server is one file, so that file as
  a whole is AGPL-3.0-only) and the constants in Rust (`rust/numbers/`). Use, study, change and share them; if you run a changed
  version as a service, offer its users your source.
- **The website and its design are proprietary**, all rights reserved
  ([Pi Tech Lab Proprietary License](LICENSES/LicenseRef-PiTechLab-Proprietary.txt)): the front end, its look, the
  SuperAI language and its engines, and the platform that runs the service.
- Third-party work keeps its own license, beside it.
