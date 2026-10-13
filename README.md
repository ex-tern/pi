# ScholarPi · Pi Tech Lab

**ScholarPi** assesses research papers. A panel of AI models reviews a manuscript, and deterministic checks look at its references, reproducibility and integrity. It then scores the paper on eight open, science-aligned criteria (the **piX** index) and shows what holds it back. Each assessment is recorded on a Proof-of-Research ledger and earns **piQ**, a soulbound token minted on Sepolia.

Live at **[piii.app](https://piii.app)** (branch `main`). Test builds run at [exp.pitechlab.com](https://exp.pitechlab.com) (`experimental`) and [se.pitechlab.com](https://se.pitechlab.com) (`super`).

## Layout

```
front/          everything the browser gets
  index.html    the whole front end in one file: styles, scripts, web workers (each part under a banner)
  super/        the site's program (pitechlab.sasm), the SuperAI engine (superai.wasm)
  hal/ quvi/ confirm/ learn/   separate pages: HAL-OS in the browser, QuVI, permission links, Learn SuperAI
  vendor/ fonts/ …             three.js, v86, Geist, images, sound, numbers.wasm
  zotero/       the Zotero plugin download (scholarpi.xpi, updates.json)
back/           everything else
  api.py        the whole server in one file (FastAPI; each former module under a banner)
  tests/        pytest suite
  scripts/tools.py   every build and run command
  rust/         the SuperAI language and the constants (π, e, φ, γ), built to WebAssembly
  zotero/       the Zotero plugin's source
  deploy/ LICENSES/
nixpacks.toml railway.toml requirements.txt runtime.txt .github/   read by Railway and GitHub at the root
```

## Run it

```bash
python back/scripts/tools.py run          # venv, dependencies, back/.env from .env.example, http://localhost:8000
python back/scripts/tools.py run --lab    # with HAL-OS (../HAL-OS) and private projects (../private)
```

Add at least `GROQ_API_KEY` to `back/.env` so the AI panel can run. Each panel seat runs on a different model when its own provider's key is set (`MISTRAL_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `OR_API_KEY`). `python back/api.py check-providers` shows which jurors can respond and which share a model.

## Commands

| | |
|---|---|
| `cd back && python -m pytest -q` | the tests |
| `node front/super/superai.test.mjs`, `node front/quvi/engine.test.mjs` | the JavaScript engines' tests |
| `python back/scripts/tools.py build-program [--check]` | assemble `super/pitechlab.sasm` into its region of `index.html` |
| `python back/scripts/tools.py build-superai [--crate numbers]` | Rust to WebAssembly |
| `python back/scripts/tools.py build-hal --src ../HAL-OS` | HAL-OS boot image for the Lab |
| `python back/scripts/tools.py build-hal-shell [--check]` | the HAL-OS shell image |
| `python back/scripts/tools.py zotero` | package the Zotero plugin |
| `python back/scripts/tools.py whitepaper [DIR]` | typeset the whitepaper (needs reportlab) |
| `python back/api.py cron` · `reset-state --dry-run` · `check-providers` | server-side tasks |

## Deploy

Railway builds with Nixpacks from the repository root: `requirements.txt` → `back/requirements.txt`. The build phase fetches the pinned HAL-OS commit and runs `build-hal`. The app starts with `gunicorn api:app -c back/gunicorn.conf.py`, and the healthcheck is `/api/health`. Data lives in `SCHOLARPI_DATA_DIR` on a volume. `back/.env.example` lists every setting.

Push to `experimental` first, and promote to `main` only after looking at exp.pitechlab.com. The repository is public: never commit `.env`, keys or private projects.

## How it works

- **Assessment:** text extraction, then jurors from independent model lineages and a judge, then the deterministic signals (reference audit against OpenAlex and Crossref, MDAR, RRIDs, interdisciplinarity), then a versioned rubric (`/api/rubric`) giving eight criteria, each 0–100. Prompt injection quarantines a paper for review; it never brands it as misconduct.
- **piQ:** emission halves every 1,000 papers, and the quality bar rises with it. The processing fee (1.00 piQ at the start) halves along with emission, so a paper that only just qualifies always earns more than it costs. piQ is minted only to verified authors (ORCID); a paper by authors not yet verified holds its piQ in escrow. A background loop settles the queue on chain (`AUTO_SETTLE=0` turns it off).
- **Authors** are grouped by ORCID or OpenAlex ID, not by name.
- **Privacy:** the first visit asks for consent; declined requests are never sent (`/api/cookies` lists every cookie and storage key).
- **Integrations:** `/api/dossier/by-doi` (used by the Zotero plugin), FAIR and CoARA dossiers per assessment.

## The look

Ink on paper with one cobalt accent, Geist type, sentence case, flat paper background. The superellipse look (`se.`, or `SCHOLARPI_SHAPE=superellipse`) is a SuperAI program of "supers" joined by wires and drawn by three.js; the round look keeps the orbit of bubbles around the π mark.

## Credits

The Lab shows **Unigyro II** and **QuVI**, by Murtaza Vefadar (Gebze Technical University). Both remain his; QuVI is MIT licensed, and `front/quvi/` is an independent browser implementation of it. HAL-OS, Neuro Frenzy and FaceMace come from their own repositories.

## License

There are two licences (see [LICENSE](LICENSE)). The science engines, including `back/api.py` (which contains them) and `back/rust/numbers`, are **AGPL-3.0-only**. The website, its design and the SuperAI language are **proprietary**. Third-party code keeps its own licence beside it.
