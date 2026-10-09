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

## 2026-10-09: New PiTechLab mark and a friendlier welcome

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

**Files:** `frontend/welcome.js`, `frontend/theme.css`, `frontend/index.html`, `frontend/icon.svg`, `frontend/confirm/index.html`.

## 2026-10-09: Total cap on stored manuscripts

**What:** `backend/paper_store.py` now has a total budget for retained manuscripts, `PAPER_STORE_MAX_TOTAL_BYTES` (default 2 GB, `0` turns it off). When a new upload would go over it, the store evicts orphaned files first (those with no assessment left), then the oldest stored manuscripts. A single file larger than the whole cap is not stored. The owner Storage panel shows how much of the cap is used and a warning from 80%. That warning says eviction removes the file link from published papers.

**Why:** the store had no total limit and filled the production disk. A full volume stops the database as well, not only uploads.

**Verified:**
- New `tests/test_paper_store.py` (6 tests) covers under the cap, oldest first, orphans first, an oversized file, a failing provider and a disabled cap.
- pytest is at baseline (12 pre-existing failures, 370 passed).
- `build_hal.py` builds.
- `/api/admin/storage` returns `manuscript_cap`.
- Headless Chromium, every tab at 1440 and 390 px, signed out and as a mocked owner: no page errors and no horizontal scroll. The Storage panel was screenshotted with the warning showing.

**Files:** `backend/paper_store.py`, `backend/api.py`, `backend/tests/test_paper_store.py`, `frontend/app.js`, `EVOLUTION.md`.

## 2026-10-09: The circling mark returns

**What:** the owner preferred the circle. The logo is back to the circle and its diameter, now without a centre dot, and the diameter turns slowly with the cobalt point riding its end: on the welcome screen inside the ruled ring, and in the sidebar mark. The favicon stays still. The friendlier welcome layout (greeting, four doors, nightly-improvement line) stays.

**Verified:**
- Browser at 1440 and 390 px, with no page errors and no horizontal scroll.
- The diameter's rotation is measured mid-turn.
- No centre dot is present.
- With reduced motion, the mark is still and fully drawn.

**Files:** `frontend/welcome.js`, `frontend/theme.css`, `frontend/index.html`, `frontend/icon.svg`, `frontend/confirm/index.html`.

## 2026-10-09: Name written as "Pi Tech Lab"

**What:** the owner's preferred spelling. Every visible name (titles, the sidebar brand, the welcome greeting, the permission page, the QuVI footer and the permission-request defaults) now reads "Pi Tech Lab". The domain stays pitechlab.com.

**Files:** `frontend/index.html`, `frontend/welcome.js`, `frontend/confirm/*`, `frontend/quvi/index.html`.

## 2026-10-09: Black circle, blue sweeping diameter; no dot, no skip link

**What:**
- The logo is now a black circle with a blue diameter, sweeping round with a smooth fading trail, on the welcome screen and in the sidebar. The cobalt dot is gone. The favicon and the permission page show it still.
- "Skip to the site" is removed from the welcome screen. Esc, "Let's begin" or any door still leads in.

**Verified:**
- Browser at 1440 and 390 px, with no page errors and no horizontal scroll.
- The rotation is measured mid-sweep.
- With reduced motion, the mark is still and the trail is hidden.

**Files:** `frontend/welcome.js`, `frontend/theme.css`, `frontend/index.html`, `frontend/icon.svg`, `frontend/confirm/index.html`.

## 2026-10-09: Simpler welcome mark; no "improves every night" line

**What:**
- The degree ring (ticks and outer circle) is removed from the welcome mark. It's now just the black circle and the sweeping blue diameter, cropped to fit.
- The line "This site improves a little every night…" and its link are removed from the welcome screen, at the owner's request.

**Files:** `frontend/welcome.js`, `frontend/theme.css`.

## 2026-10-09: Orbit layout; live π under the mark

**What:**
- The Pi Tech Lab mark stays fixed in the centre on every page. Every card (Evaluate, Explore, Envision, Lab, Architecture, account) is a bubble orbiting it.
- You can drag a bubble; its position is remembered. Click a bubble to open it as a floating window that can be moved, resized and maximised. Esc or a click on the mark closes it.
- The mark's size follows what the site is doing. It is large when idle and shrinks while windows are open. Its diameter spins faster while a request is running.
- Under the mark, π is computed live in a background worker (Gibbons spigot, exact integers). It gains digits for as long as the page stays open.
- The welcome screen is removed. The old sidebar and tabs remain hidden underneath and still drive the sections.

**Checks:** 21 bubbles for visitors, 31 for the owner. HAL-OS runs inside a window. The first 150 digits of π were checked. There are no page errors at 1440 or 390 px. On phones, a few bubbles may touch as they pass.

**Files:** `frontend/orbit.js`, `frontend/orbit.css`, `frontend/pi-worker.js`, `frontend/index.html`, `frontend/lab.js`, `frontend/theme.css`; `frontend/welcome.js` removed.

## 2026-10-09: Still pills, no overlaps, a movable mark, use makes pills grow

**What:**
- "Pi Tech Lab" sits in the top-left corner. The "Drag anything. Click to open." line is removed.
- Pills no longer drift. Each gets a fixed place on rings around the mark, and they never overlap each other, the mark, the π line, the title or the corner buttons. A dropped pill takes the nearest free spot, and the others make room.
- The mark can be dragged; the pills come with it. Double-click brings it back to the middle. Its size follows what you do: it is large when idle and steps back further with each open window. It pulses when a card opens, grows slightly under the pointer, and spins faster while the site is working.
- Use makes pills prominent. Opening a card counts 1 and moving it counts ⅓, remembered in this browser. At scores of 1, 3 and 8 a pill gets larger and bolder, and more-used pills sit closer to the mark.

**Checks:** at 1440, 1280 and 390 px there are no overlaps after loading, after dropping a pill on another, after moving the mark and after reload. Pills stay still over time and when a window opens. There is no horizontal scroll and no new page errors.

- Pills re-place themselves when the experimental banner fills in late, so nothing ends up under the π line.

**Files:** `frontend/orbit.js`, `frontend/orbit.css`, `frontend/index.html`.

## 2026-10-09: Varied pills; π in its own box; resizable logo; GitHub and ResBD as pills

**What (owner's requests):**
- Every pill has its own size, typeface and style. Sizes run from 0.86× to 1.3×. Typefaces are Geist, Geist light, Geist Mono, a serif or a serif italic. Styles are outline, ink, soft, dashed, cobalt, square or underline. The look is picked from the pill's name, so it is the same on every visit. This is a deliberate widening of the design language for the orbit, at the owner's request.
- Use still grows a pill, on top of its own size. The growth shows on your next visit, so nothing shifts while you work.
- The π counter is its own box. You can drag it anywhere and resize it from its corner or with the scroll wheel. Double-click resets it.
- The logo resizes with its small blue knob or the scroll wheel. Double-click resets its size and place.
- GitHub is a pill (it opens in a new tab), and the floating GitHub button is hidden. ResBD is a pill whose window opens like any other card.
- "Pi Tech Lab" in the corner is bigger: 28–44 px on desktop, 26 px on phones.

**Checks:** at 1440, 1280 and 390 px there are no overlaps after moving or resizing the π box and the logo. Pills stay still when a card opens. There is no horizontal scroll and no page errors.

**Files:** `frontend/orbit.js`, `frontend/orbit.css`, `frontend/index.html`.

## 2026-10-09: Size follows complexity and use; no resize knob on the logo

**What:**
- A pill's size now follows how much is behind it, not chance. It is measured from the card: embedded tools (HAL-OS, QuVI), the map and other drawings, inputs, buttons, tables and the amount of text. Cards are ranked and sized 0.84× to 1.34× by rank, and the most complex value seen is remembered. Use multiplies on top, so the most complex, most used cards are the biggest. Typeface and style stay varied per pill.
- The small resize circle on the logo is removed. The logo still resizes with the scroll wheel; double-click resets it.

**Files:** `frontend/orbit.js`, `frontend/orbit.css`, `frontend/index.html`.

## 2026-10-09: Pills move only when pushed; the mark sizes to the open card

**What:**
- Every pill keeps its own place, stored relative to the mark as a share of the screen. Moving one pill no longer reflows the rest.
  - A dropped pill gives way only to fixed things (the mark, the π box, the title). It takes the nearest spot clear of them.
  - Only the pills it lands on are pushed, each to the nearest unused spot. Pushes don't cascade, and pushed pills stay where they were pushed.
  - When the screen edge or a moving mark pushes a pill, the move is temporary: the pill returns once there is room.
- With a window open, the mark sizes to the complexity of the card in front. Key numbers ≈ 60 px and HAL-OS or the map ≈ 135–140 px on desktop; on phones, about 42–84 px.

**Checks:** dropping a pill on empty space moves only that pill. Dropping onto another moves just the pill it lands on. Positions survive a reload. Opening cards moves no pills.

**Files:** `frontend/orbit.js`, `frontend/index.html`.

## 2026-10-09: Windows stay open, fit their content, and come to the centre when clicked

**What (owner's requests):**
- The maximise and close buttons are removed. Windows never close: Esc and the mark no longer close them, and open windows reopen in the same order on the next visit.
- Clicking a pill, or a window behind another, brings that window to the front and glides it to the centre.
- A click on the mark sets every window aside (faded out, still open) to show the pills; another click, or opening any pill, brings them back.
- Windows fit their content. Width runs from about 320 px for a few lines up to 440–820 px depending on the card's complexity, and 960 px for tools and tables. Height matches the content up to the screen. They refit as content loads, until you resize one yourself. On phones they are full-width and as tall as needed, up to 86% of the screen.
- The π box sits beneath windows; the mark stays above them. The focus ring on a clicked window is gone.

**Files:** `frontend/orbit.js`, `frontend/orbit.css`, `frontend/index.html`.

## 2026-10-09: Your layout follows your account

**What:**
- When you are signed in, the whole page state is saved to your account about a second after each change, and loaded when you sign in on any browser or device:
  - every pill's place, size and use;
  - the mark's place and size;
  - the π box's place and size;
  - which windows are open, in their stacking order;
  - each window's place, and its size once you have resized it.

  The first time you sign in, this browser's layout becomes the account's. Signed out, everything stays in the browser only.
- Windows now remember their place, and their size once resized, even when you are signed out.
- Server: `backend/layout.py`, with `GET`/`PUT /api/me/layout`, available only to a signed session and only for its own identity (ORCID or wallet). Its own `layout.db`. The data is opaque, shape-checked and capped at 64 KB and 600 keys under "orbit:". Tests are in `backend/tests/test_layout.py`.

**Checks:** a second browser signed in as the same user shows the same layout and windows. A signed-out browser keeps its own. pytest: 374 pass; the 12 known failures are unchanged.

**Files:** `backend/layout.py`, `backend/api.py`, `backend/tests/test_layout.py`, `frontend/orbit.js`, `frontend/index.html`, `CLAUDE.md`.

## 2026-10-09: The name, top centre, in many languages

**What:**
- "Pi Tech Lab" moves to the top centre. Every 30 seconds to 3 minutes, at random, it fades into the name in another of 32 languages, each in its own script. Right-to-left scripts run right to left. Joined and syllabic scripts keep normal letter spacing. Hovering shows the language's name, and screen readers always hear "Pi Tech Lab".
- Each name is shrunk if needed to fit the screen. The pills keep clear of the widest name, so a change of language never moves a pill.

**Checks:** all 32 names at 1440 and 390 px fit with no overlap and no horizontal scroll. No pill moves when the name changes.

**Files:** `frontend/orbit.js`, `frontend/orbit.css`, `frontend/index.html`.

## 2026-10-09: PiEn; nothing overlaps on any screen; smaller title; HAL-OS start-up race

**What:**
- **PiEn.** The mark is PiEn, an engine that learns how the site is used. Its name is inside the circle.
  - It learns which cards are opened and which follow which.
  - Your own pattern is kept with your layout (`orbit:pien`, synced to your account when you are signed in).
  - Everyone's pattern is pooled anonymously on the server (`backend/pien.py`, `/api/pien`): card names and counts only, never who. Requests are capped at 40 entries of at most 10, and each address may send 60 an hour.
  - After each step, PiEn puts a soft blue halo on the card you are most likely to want next. Your habits weigh three times as much as everyone's, and it stays quiet with too little to go on. Hovering the mark shows how much it has learned.
- **No overlaps on any screen.** Pills, the mark, the π box and the title never overlap: the π box avoids the mark and the title, and the mark stays below the title. When a screen has no room for every pill, all pills shrink together in steps until they fit. Tested at 13 sizes from 320×568 to 2560×1440, including phones in landscape: fresh, with the mark in a corner, and with the π box dropped on the mark.
- **Title** is smaller: 20–28 px.
- **HAL-OS** ignores pause/resume until the emulator has finished starting. This fixes occasional emulator errors when windows were opened in quick succession.

**Files:** `backend/pien.py`, `backend/api.py`, `backend/tests/test_pien.py`, `frontend/pien.js`, `frontend/orbit.js`, `frontend/orbit.css`, `frontend/hal/hal.js`, `frontend/index.html`, `CLAUDE.md`.
