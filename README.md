# Piii Lab

**ScholarPi** assesses research papers. A panel of AI models reviews a manuscript, and deterministic checks look at its references, reproducibility and integrity. It then scores the paper on eight open, science-aligned criteria (the **piX** index) and shows what holds it back. Each assessment is recorded on a Proof-of-Research ledger and earns **piQ**, a soulbound token minted on Sepolia.

Live at https://www.piii.app/

## Layout

```
front/          what the browser gets
  app/          the site: ui.wasm (built from back/rust/ui) and host.js, the shim that lends it the page
  fonts/ icon.svg manifest.webmanifest ScholarPi_Whitepaper.pdf
  zotero/       the Zotero plugin download (scholarpi.xpi, updates.json)
back/           everything else
  api.py        the whole server in one file (FastAPI; each former module under a banner)
  tests/        pytest suite
  scripts/tools.py   every build and run command
  rust/         the site (ui), the SuperAI language and the constants (π, e, φ, γ)
  zotero/       the Zotero plugin's source
  deploy/ LICENSES/
nixpacks.toml railway.toml requirements.txt runtime.txt .github/   read by Railway and GitHub at the root
```

The site is written in Rust. There are no HTML files: the server answers every page address with the few lines a browser needs to start WebAssembly, and `back/rust/ui` draws the rest, styles included. It has no dependencies and no standard library.

## Run it

```bash
python back/scripts/tools.py run          # venv, dependencies, back/.env from .env.example, http://localhost:8000
python back/scripts/tools.py run --lab    # with private projects (../private)
```

Add at least `GROQ_API_KEY` to `back/.env` so the AI panel can run. Each panel seat runs on a different model when its own provider's key is set (`MISTRAL_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `OR_API_KEY`). `python back/api.py check-providers` shows which jurors can respond and which share a model.

## Commands

| | |
|---|---|
| `cd back && python -m pytest -q` | the tests |
| `python back/scripts/tools.py build-ui [--library DIR]` | the site to `front/app/ui.wasm` (needs `rustup target add wasm32-unknown-unknown`, or `--library` with the standard library's source) |
| `python back/scripts/tools.py zotero` | package the Zotero plugin |
| `python back/scripts/tools.py whitepaper [DIR]` | typeset the whitepaper (needs reportlab) |
| `python back/api.py cron` · `reset-state --dry-run` · `check-providers` | server-side tasks |

## Deploy

Railway builds with Nixpacks from the repository root: `requirements.txt` → `back/requirements.txt`. The site's `ui.wasm` is committed, so the build only installs Python. The app starts with `gunicorn api:app -c back/gunicorn.conf.py`, and the healthcheck is `/api/health`. Data lives in `SCHOLARPI_DATA_DIR` on a volume. `back/.env.example` lists every setting.

The repository is public: never commit `.env`, keys or private projects.

## How it works

- **Assessment:** text extraction, then jurors from independent model lineages and a judge, then the deterministic signals (reference audit against OpenAlex and Crossref, MDAR, RRIDs, interdisciplinarity), then a versioned rubric (`/api/rubric`) giving eight criteria, each 0–100. Prompt injection quarantines a paper for review; it never brands it as misconduct.
- **piQ:** emission halves every 1,000 papers, and the quality bar rises with it. The processing fee (1.00 piQ at the start) halves along with emission, so a paper that only just qualifies always earns more than it costs. piQ is minted only to verified authors (ORCID); a paper by authors not yet verified holds its piQ in escrow. A background loop settles the queue on chain (`AUTO_SETTLE=0` turns it off).
- **Authors** are grouped by ORCID or OpenAlex ID, not by name.
- **Privacy:** the first visit asks for consent; declined requests are never sent (`/api/cookies` lists every cookie and storage key).
- **The page:** a canvas of supers around a π computed in the browser. The super you open fills the canvas, and the others become icons in the rail.
- **Integrations:** `/api/dossier/by-doi` (used by the Zotero plugin), a FAIR dossier per assessment.

## License

There are two licences (see [LICENSE](LICENSE)). The science engines, including `back/api.py` (which contains them) and `back/rust/numbers`, are **AGPL-3.0-only**. The website, its design and the SuperAI language are **proprietary**. Third-party code keeps its own licence beside it.
