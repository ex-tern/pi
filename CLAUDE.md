# Working on ScholarPi with Claude

ScholarPi runs as two copies of this repository:

| Site | Branch | Railway environment | Purpose |
|---|---|---|---|
| https://pitechlab.com | `main` | production | Stable. Real users, real data. |
| https://exp.pitechlab.com | `experimental` | experimental | Evolves constantly. May break. Separate data volume. |

## Rules for Claude

1. **Work on `experimental`.** Branch from it, commit to it, and push to it when the owner asks for changes. That deploys to exp.pitechlab.com automatically.
2. **Never push to `main`, and never merge into it, without the owner explicitly saying so in that conversation.** Promoting means merging `experimental` into `main` after the owner has looked at the experimental site.
3. **Before every push, run:**
   - `cd backend && python -m pytest -q`: compare against the known baseline (12 failures that predate the Lab). Do not add new failures. (`tests/test_forecast.py` runs again since 2026-10-10: it now imports `pid_engine`, the forecasting module's current name.)
   - `python scripts/build_hal.py --src ../HAL-OS`: refuses to build if `frontend/hal/wire.js` and HAL-OS disagree.
   - Load the site in a browser at desktop and 390 px width: no page errors, no horizontal scroll.
4. **The repository is public.** Never commit secrets, `.env` files, or anything from private projects (those live on the server volume; see `backend/lab.py`).
5. **Keep the design language** in `frontend/theme.css`:
   - ink on paper, with one cobalt accent for "here / interactive"
   - status colours muted
   - Geist type, sentence case
   - the π circle as the only ornament

   Change it deliberately, not by accident.
6. **The base image comes from `public.ecr.aws`, not Docker Hub.** Railway builds hit Docker Hub's pull limit ("429 Too Many Requests" at "load metadata for docker.io/library/python"), which fails the build in seconds. Keep the `FROM` on the ECR mirror.
7. **`app.js` is large and load-bearing.** Prefer small, separate modules (`lab.js`, `orbit.js` and `channel.js` are the pattern) over growing it.

## Layout

```
backend/        FastAPI app (api.py), Lab private projects (lab.py),
                permission requests (consent.py), signed-in layout sync (layout.py),
                PiEN shared model (pien.py), recent assessments (recent.py), RiBD suggestions (rib_suggest.py), Live panel feed (live.py), idle auto-assessment (idle_worker.py), tests/
frontend/       index.html, app.js (the app), style.css + theme.css (look),
                orbit.js + orbit.css (orbit layout around the centre mark), pi-worker.js (live π digits), pien.js (PiEn, the mark that learns), numbers.js + consts-worker.js (π and friends: e, φ, γ), capabilities.js (the Capabilities pill), architecture.js (the Architecture flowchart), peeks.js (glimpses inside pills), recent.js (Recent assessments), intern.js (the Intern pill), performance.js (the simple Performance window), unigyro.js + unigyro.css (Unigyro, by Murtaza Vefadar; source: neurophilic/Unigyro, `python scripts/sync_unigyro.py --src ../Unigyro`), neurofrenzy.js + neurofrenzy.css + sound/neurofrenzy.mp3 (Neuro Frenzy, a game in the Library bubble with looping music and a mute toggle; from neurophilic/NeuroGame), facemace.js + facemace.css + facemace/ (FaceMace, sort photos by face; port of neurophilic/FaceID), medicine.js + medicine/ (MD, a public grade-free graduation plan in the Library bubble; never add grades, passed-exam dates or averages), ribsuggest.js (RiBD: papers to read and hot topics), live.js + live.css (the Live panel fixed to the right side), download.js (the dossier's Download paper button), lab.js (Lab tab), channel.js (experimental banner),
                hal/ (HAL-OS web portal + v86 emulator), confirm/ (permission-request page),
                quvi/ (browser port of Murtaza Vefadar's QuVI; `node frontend/quvi/engine.test.mjs`)
scripts/        build_hal.py (builds HAL-OS's boot image from its own repo), sync_unigyro.py (Unigyro from its own repo)
```

`SCHOLARPI_CHANNEL=experimental` turns on the experimental banner, `robots.txt: Disallow` and `X-Robots-Tag: noindex`.

**QuVI is owner-only until its author approves.** `QUVI_PUBLIC=1` shows it to everyone. Do not set it, or work around it, unless the owner says the author has given permission (see the Lab's permission requests).

Status: the owner set `QUVI_PUBLIC=1` on **production** on 2026-10-09, so QuVI is public at pitechlab.com. The experimental environment still has it owner-only unless the owner sets the same variable there.
