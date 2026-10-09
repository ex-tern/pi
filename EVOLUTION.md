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

## 2026-10-09: The numbers window; full pill titles

**What:**
- Clicking the π box opens "π and friends", a window with seven constants computed live in your browser with exact integer arithmetic:
  - π (digit by digit, for as long as the page is open);
  - e, φ, √2, √3 and ln 2, each to 30 000 digits;
  - γ (Euler–Mascheroni), to 10 000 digits.

  Each shows its digits growing at about 16 a second, how many decimals are shown, and a one-line note. The first 100 digits of each were checked against published values. The window behaves like the others: it stays open and comes back after a reload. Dragging the π box still moves it; only a click opens the window.
- Pill titles are shown in full. Long ones wrap onto a second line on narrow screens instead of being cut with "…".
- Fixed: `orbit:ready` fired before `window.PiOrbit` existed.

**Files:** `frontend/numbers.js`, `frontend/consts-worker.js`, `frontend/orbit.js`, `frontend/orbit.css`, `frontend/index.html`, `CLAUDE.md`.

## 2026-10-09: Seamlessness pass

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

**Files:** `frontend/orbit.js`, `frontend/app.js`, `frontend/index.html`.

## 2026-10-09: π and friends stays put and shows all seven

**What:**
- **A window you have placed stays where you put it.** Windows refit as their content grows, and the numbers grow all the time, so every refit was re-centring the window. Now, once a window has been moved (or restored to a saved place), refits change only its size, never its position.
- **All seven constants are visible at once.** The window opens at full width, with a compact grid (three columns on desktop, one on phones). Each constant shows its two newest lines of digits; scroll back for the rest. Notes are hidden on phones.

**Files:** `frontend/orbit.js`, `frontend/orbit.css`, `frontend/index.html`.
- π and friends is now π with three friends, at the owner's choice: Euler's number e, the golden ratio φ and the Euler–Mascheroni constant γ. √2, √3 and ln 2 are removed. Two columns on wider screens, one on phones; notes are hidden only on short phones. All four are visible at every tested size, from 320×568 to 1920×1080.

## 2026-10-09: Capabilities

**What:** a "Capabilities" pill whose window lists everything Pi Tech Lab can do, in six groups: assess research, explore the record, see the field, Lab, ask and understand, and the site itself. Each entry has one line on what it does, and clicking it opens that window (or π and friends, or the contact form). Only what this visitor can use right now is listed: 21 entries for a visitor and 24 for the owner (QuVI, private projects, permission requests). The list updates when you sign in or out.

Modules can now add pills of their own (`PiOrbit.addPill`) and open windows by title (`PiOrbit.openTitle`).

**Files:** `frontend/capabilities.js`, `frontend/orbit.js`, `frontend/orbit.css`, `frontend/index.html`, `CLAUDE.md`.

## 2026-10-09: "Analytics"; one "Architecture" window

**What:**
- "Key numbers" is now "Analytics". Its remembered place, use, size and open window carry over.
- Overview, Scoring Pipeline in Detail, Stage Reference and CoARA Compliance & Core Pillars are merged into one pill and window, "Architecture", in that order. The Whitepaper stays its own pill. Capabilities lists Architecture and Analytics.
- A window's header no longer repeats its section name when the title already says it.

**Files:** `frontend/orbit.js`, `frontend/capabilities.js`, `frontend/index.html`.

## 2026-10-09: A cleaner map of science; Performance and PiEN

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

**Files:** `frontend/arcade.js`, `frontend/style.css`, `frontend/pien.js`, `frontend/orbit.js`, `frontend/orbit.css`, `frontend/capabilities.js`, `frontend/index.html`.

## 2026-10-09: Bubbles that hold pills, a chat pill, a signed-in check, a flowchart

**What (owner's requests):**
- **Lab** is a bubble with its pills inside: HAL-OS, plus QuVI, Private projects and Permission requests for the owner. **Tools** holds Assess a Manuscript. Each inner pill opens its window, and grouped pills no longer orbit on their own. A group is sized by everything in it.
- **siM Assistant** (renamed from "SciLM (siM) Assistant") has a chat box in its pill: type, press Enter, and the assistant window opens with the question asked.
- **Your account** shows a red dot when signed out and a green check when signed in.
- **The journal** pill shows a glimpse of what is inside: the number of entries and the latest one (`peeks.js`).
- **Architecture** is rebuilt as a six-step flowchart (paper in, read, panel, judge, record, outputs). Click or use the arrow keys to see each step; a "How judging stays fair" note sums up CoARA. Plain HTML and CSS, with no diagram library. It shows six across, three by two, or one column, depending on the window's width. The old cards stay in the page, hidden, for app.js.
- **Leaderboards:** the piX and piQ leaderboards are one pill.
- **Assessment results open by themselves** whenever a run finishes (app.js announces `scholarpi:assessment-done`), not only the first time.
- **Scrolling anywhere on the page** (outside windows) resizes PiEN. Scrolling on the π box resizes only the π box.

**Files:** `frontend/orbit.js`, `frontend/orbit.css`, `frontend/architecture.js`, `frontend/peeks.js`, `frontend/capabilities.js`, `frontend/pien.js`, `frontend/app.js`, `frontend/index.html`, `CLAUDE.md`.

## 2026-10-09: Recent assessments, for everyone

**What:** a "Recent assessments" pill (in Explore). It lists every assessment made on the site, newest first, including those made without signing in, so visitors can see the site in use. At the owner's choice, only the field, the piX score, the day and whether the person was signed in are shown. Never the title, the file, the author, the hash, any address or the time of day: people upload unpublished work. The pill shows the latest one, and the list refreshes when a run finishes.

Server: `backend/recent.py` (`GET /api/assessments/recent`), read-only, with tests in `backend/tests/test_recent.py` that check nothing identifying leaks.

**Files:** `backend/recent.py`, `backend/api.py`, `backend/tests/test_recent.py`, `frontend/recent.js`, `frontend/orbit.css`, `frontend/capabilities.js`, `frontend/index.html`, `CLAUDE.md`.

## 2026-10-09: Leaderboard dates no longer clipped

**What:**
- The Date column was a fixed 58 px, the width of a number, so dates were cut off ("09/10/2…"). It is now 76 px and never wraps, with a compact date: "9 Oct", plus the year only for other years.
- The "piQ (share)" header was clipped too. It now reads "piQ", and its hover text still explains the share.
- On phones the leaderboard table was wider than the screen and silently cut. It now scrolls sideways.

**Files:** `frontend/style.css`, `frontend/app.js`, `frontend/index.html`.

## 2026-10-09: Intern, in the Tools bubble

**What:** an "Intern" pill inside the Tools bubble, beside Assess a Manuscript. Intern ([in-tern/Intern](https://github.com/in-tern/Intern)) is a separate project: an iOS app, an AI electronic health record for doctors, built on Firebase, Azure Communication Services and MessageKit. It runs on iPhone and iPad, not in a browser, so its window says what it is and links to its source. Modules can now place a pill inside a group's bubble (`addPill({..., inGroup: "Tools"})`).

**Files:** `frontend/intern.js`, `frontend/orbit.js`, `frontend/orbit.css`, `frontend/capabilities.js`, `frontend/index.html`, `CLAUDE.md`.

## 2026-10-09: Push a window to the edge to close it

**What:** dragging a window by its header against the left, right or bottom edge of the screen (or so that more than half of it is off-screen) closes it. While it is far enough out it fades slightly, to show that letting go will close it. A closed window is forgotten (it does not come back on the next visit) and reopens centred from its pill. This is the only way a window closes: there are still no close buttons, Esc or mark clicks.

**Files:** `frontend/orbit.js`, `frontend/orbit.css`, `frontend/index.html`.

## 2026-10-09: HAL-OS starts when you press Start

**What:** opening HAL-OS no longer boots the machine. Its screen shows a "Start HAL-OS" button with the image size, and a note when there are weights from last time to pick up. The x86 emulator downloads and boots only when the button is pressed. Pause and Reboot do nothing until then, and pause/resume messages from the page are ignored until the machine is up.

**Files:** `frontend/hal/hal.js`, `frontend/hal/hal.css`, `frontend/hal/index.html`.

## 2026-10-09: QuVI is public on production

The owner set `QUVI_PUBLIC=1` in Railway's production environment. QuVI now appears in the Lab bubble for every visitor at pitechlab.com, without the "owner preview" badge. Verified signed out: the simulator loads in its window. The experimental environment is unchanged (owner-only) unless the same variable is set there. No code change was needed: the switch has existed since QuVI was added.

## 2026-10-09: HAL-OS opens only from its own pill

**What:** the HAL-OS window no longer appears by itself. Three routes used to open it:
- the Lab bubble's default action (its first member);
- the `/#lab` link, which lab.js also wrote into the address whenever a Lab window opened;
- restoring windows from the last visit.

Now only pressing the HAL-OS pill in the Lab bubble opens it, and the machine still boots only when Start is pressed. The Lab bubble's own default opens QuVI where QuVI is visible, otherwise nothing. lab.js no longer writes `#lab`.

**Files:** `frontend/orbit.js`, `frontend/lab.js`, `frontend/index.html`.

## 2026-10-09: The name behind, PiEN on hover, a tidy chat box

**What:**
- "Pi Tech Lab" (and its translations) sits behind pills and windows, like the π box, instead of floating over window headers.
- PiEN's name inside the mark shows only when you point at the mark, or reach it with Tab.
- siM's chat box: the send button sits inside the right end of the field, centred. A site-wide margin under inputs had pushed it down and against the pill's edge.

**Files:** `frontend/orbit.js`, `frontend/orbit.css`, `frontend/index.html`.

## 2026-10-09: Performance, made simple

**What:** the Performance window now reads in plain words:
- Four cards, one per engine that learns from the site: PiEN, PiDN, siM and ResBD. Each says in one sentence what the engine does and how it is doing, with one small meter.
  - PiEN: how often its suggestion was the one opened, and what it suggests now.
  - The others: how much better they are than their starting point, or what has to happen before they start learning.
- "What happens next": which scoring criteria are expected to count more or less, or why nothing is predicted yet.
- The old detailed forecast (chart, lookback, chart type, sensitivity, modifiers) is folded away under "Show the detailed forecast", still driven by app.js.
- PiEN's separate panel is replaced by its card; pien.js exposes `window.PiEN.stats()` for it.

**Files:** `frontend/performance.js`, `frontend/pien.js`, `frontend/orbit.css`, `frontend/index.html`, `CLAUDE.md`.

## 2026-10-09: RiBD, your research mentor; SciM

**What (owner's choices):**
- **ResBD is now RiBD,** introduced as "your research mentor": in its window bar, its help text, its Performance card and Capabilities. The monkey face drawn in its window bar is removed.
- **SciLM / siM is now SciM:** the "SciM Assistant" pill (with "Ask SciM…" in its chat box), its Performance card, Architecture, and the app's own labels.
- Only visible names changed. The engines' data keys (`siM`, `riB`) and element ids stay, so the server and app.js are unaffected. Remembered places, use and PiEN's learning carry over from the old names.

**Files:** `frontend/index.html`, `frontend/app.js`, `frontend/orbit.js`, `frontend/pien.js`, `frontend/capabilities.js`, `frontend/performance.js`, `frontend/architecture.js`.

## 2026-10-09: Unigyro, in the Lab, credited to Murtaza Vefadar

**What:** a "Unigyro" pill in the Lab bubble. Its window plays [Unigyro II: Single-Seater Robot Vehicle](https://www.youtube.com/watch?v=QHxpu1xufFc), Murtaza Vefadar's robot vehicle, with credit and links to the video and his channel ([@MortezaVafadar](https://www.youtube.com/@MortezaVafadar)). The player uses YouTube's privacy-enhanced domain and loads only when the window opens. The README now has a section crediting his two projects in the Lab (Unigyro and QuVI).

The [neurophilic/Unigyro](https://github.com/neurophilic/Unigyro) repository is empty, and this session cannot push to it (the Claude GitHub App is not installed for `neurophilic`). A README for it, citing him with the video and channel, was prepared for the owner to add.

**Files:** `frontend/unigyro.js`, `frontend/orbit.js`, `frontend/orbit.css`, `frontend/capabilities.js`, `frontend/index.html`, `README.md`, `CLAUDE.md`.

## 2026-10-09: neurophilic/Unigyro is the source of the Unigyro window

**What:** the Unigyro window's code and styles are two plain files, `frontend/unigyro.js` and `frontend/unigyro.css` (the styles moved out of orbit.css). Their source is the Unigyro repository's `pitechlab/` folder. `python scripts/sync_unigyro.py --src ../Unigyro` copies them in, and `--check` fails if the site's copies differ, the same pattern as HAL-OS (`build_hal.py`).

The Unigyro repository's contents (README crediting Murtaza Vefadar, a standalone playable page, `pitechlab/`, `CITATION.cff`) are ready but not yet published. This session cannot push to `neurophilic` until the Claude GitHub App is installed there, so the owner adds them; a copy is in Tech/Unigyro.

**Files:** `frontend/unigyro.css`, `frontend/orbit.css`, `frontend/index.html`, `scripts/sync_unigyro.py`, `CLAUDE.md`.

## 2026-10-09: NeuroFrenzy, a game in the Lab

**What:** a "NeuroFrenzy" pill in the Lab bubble: a browser port of neurophilic/NeuroGame ("Neuro Speed Typer", a Streamlit app), at the owner's request to rename it NeuroFrenzy.
- Gameplay: fill in the blanks in six neuroscience statements before the clock runs out. Easy (1 blank, 25 s), medium (2, 30 s) and hard (3, 40 s), with the same questions, hints and scoring as the original (10 points per blank, nothing if late or wrong; 120 to win).
- Additions: a visible countdown that turns red in the last seconds, inline blanks, Enter to submit and go on, and a remembered best score (`orbit:nf:best`, so it follows a signed-in account). A game left mid-question starts over when its window closes.
- Answers are checked case-insensitively, ignoring apostrophes, as in the original.

The repository rename (NeuroGame to NeuroFrenzy) and its new contents are for the owner: this session cannot write to `neurophilic`. A ready folder is in Tech/NeuroFrenzy.

**Files:** `frontend/neurofrenzy.js`, `frontend/neurofrenzy.css`, `frontend/orbit.css`, `frontend/capabilities.js`, `frontend/index.html`, `CLAUDE.md`.

## 2026-10-09: FaceMace; a Lib bubble; Tools renamed

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

**Files:** `frontend/facemace.js`, `frontend/facemace.css`, `frontend/facemace/`, `frontend/neurofrenzy.js`, `frontend/orbit.js`, `frontend/intern.js`, `frontend/capabilities.js`, `frontend/recent.js`, `frontend/pien.js`, `frontend/index.html`, `CLAUDE.md`.

## 2026-10-09: Medicine in the Lib bubble

**What:** a Medicine pill in the Lib bubble showing a public road-to-graduation plan: CFU progress (219 of 360, by year), the remaining courses grouped by session, and the to-do list. Data is `frontend/medicine/plan.json`, rendered by `medicine/view.js`; the same three files form the standalone Medicine repository.

**Why:** the owner asked for the Graduation Plan (now the Medicine folder) to get a repository and a Lib button, public but without personal files. The public plan carries no grades, no dates of passed exams, no average or base score, no course codes and no names; the libretto and correspondence stay private.

**Verified:** pytest at baseline; `build_hal.py` builds; the pill opens at 1440 and 390 px with no page errors, no horizontal scroll and no grade data in the rendered text.

## 2026-10-09: the π logo plays a song

**What:** pressing the PiEN mark plays a 19-second song (`frontend/sound/dd.mp3`, supplied by the owner); pressing again stops it. `logosound.js` loads the audio on the first press only, and drags never count as presses. The mark keeps its other click behaviour (setting windows aside).

**Verified:** pytest at baseline; `build_hal.py` builds; at 1440 and 390 px the first press plays (audio fetched), the second stops, with no page errors and no horizontal scroll.

## 2026-10-09: a more futuristic logo song

**What:** the logo song was reprocessed with ffmpeg to sound more futuristic: a slow flanger and phaser sweep, chorus, a short space echo, brighter highs, a wider stereo field and loudness normalised to -14 LUFS (the original clipped). Same length.

**Verified:** pytest at baseline; `build_hal.py` builds; the press-to-play / press-to-stop check passes at 1440 and 390 px.

## 2026-10-09: the logo song loops seamlessly

**What:** the song now plays end to end continuously until the logo is pressed again. The file was cut so its last 1.5 s crossfade (equal power) into its start, and `logosound.js` plays it through Web Audio with `loop`, `loopStart` and `loopEnd` set past the encoder's silent padding, so there is no gap or click at the loop point. Starts and stops fade over ~0.1 s; a quick double press ends silent.

**Verified:** decoded file has no edge silence and the seam step matches a normal sample step; still playing after a full loop; stop and double-press checks pass at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: a crisper logo song

**What:** the song was re-rendered from the owner's original upload for clarity: low-mid mud cut (-4 dB at 300 Hz), presence and air lifted (+3 dB at 3.5 kHz, +4 dB shelf above 9 kHz), the flanger, phaser and echo made lighter and shorter, gentler compression, -14 LUFS, and encoded at 256 kbps. It still loops seamlessly (1.5 s equal-power crossfade).

**Verified:** highs up about 3 dB and low-mids down relative to the previous version; loop, stop and double-press checks pass at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: logo song with the noise removed

**What:** re-rendered from the owner's original upload with noise removal: the clipped peaks repaired (`adeclip`), broadband hiss reduced with an FFT denoiser (`afftdn`, 14 dB), the flanger and phaser (which added a hissy wash) dropped, no treble boost, and a gentle low-pass at 15.5 kHz. Clarity kept with a light low-mid cut and presence lift, plus a short echo and wider stereo. Still -14 LUFS, 256 kbps, seamless 1.5 s crossfaded loop.

**Verified:** the 12–20 kHz hiss band is about 7 dB lower than the previous version; loop, stop and double-press checks pass at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: the logo song runs at the tempo of π

**What:** the song and the live π digits now share one tempo. The song measured 99.94 BPM, so it was nudged to exactly 100 BPM (a 0.06% change); π comes at one digit every 60 ms, which is exactly ten digits a beat. The loop is now exactly 8 bars (19.2 s, 320 digits) with a short beat-aligned crossfade. `pi-worker.js` keeps its 60 ms pace without drift and accepts a `sync` message; while the song plays, `logosound.js` re-syncs the digits to the song's beat once per loop (`pi:beat` event, handled in `orbit.js`).

**Verified:** the tiled loop measures 99.99 BPM with the beat at 0.516 s; π runs at 16.6 digits/s idle and while playing; loop, stop and double-press checks pass at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: logo song with less noise, a higher voice, an undetectable loop and π-driven volume

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

## 2026-10-09: logo song without the bass

**What:** the owner asked for the bass and low rumble to go. Both stems now pass through steep high-pass filters at 170 Hz (18 dB/oct on the music, 12 dB/oct on the voice), and the 300 Hz cut was eased to -2 dB. Energy below 170 Hz fell from 57% of the mix to 1.4%. Everything else is unchanged: the voice +2 semitones, denoising, the 6-bar seamless loop at 100 BPM and the π-driven volume.

**Verified:** the tiled loop measures 99.99 BPM with its beat at the start; loop, stop, π-volume and tempo checks pass at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: a futuristic whoosh on the logo

**What:** pressing the logo now starts with a whoosh synthesised in Web Audio (no file):
- band-passed noise sweeping 260 Hz → 7.2 kHz and panning left → right
- two gliding tones a fifth apart, slightly detuned

It lasts exactly one beat (0.6 s), so the song drops in on the beat. Stopping plays a shorter whoosh going down (0.45 s) while the song fades out over 0.3 s. Its level is matched to the song's peaks.

**Verified:**
- An offline render: the whoosh peaks at -4.4 dB against the song's -4.1 dB, with no page errors.
- Loop, stop, double-press, π-volume and tempo checks pass at 1440 and 390 px.
- pytest at baseline; `build_hal.py` builds.

## 2026-10-09: triple-click to play, and the owner's chosen loop

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

## 2026-10-09: the song moves to NeuroFrenzy

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

## 2026-10-09: renamed pills

**What:** three pill titles changed, keeping their storage keys so positions, use counts and open windows carry over:
- "Assist a Diagnosis [Intern]" → "Assist Diagnosis [Intern]"
- "NeuroFrenzy" → "Neuro Frenzy" (and the game's heading)
- "Medicine" → "MD"

The Capabilities pill lists them under a new Lib section; Neuro Frenzy was listed under Lab before, and MD wasn't listed.

**Verified:** each opens by its new title at 1440 and 390 px; the group contents are Tools [Assess Manuscripts [Pi], Assist Diagnosis [Intern], FaceMace] and Lib [Neuro Frenzy, MD]; the MD plan and the game music checks pass with no page errors; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: "Support ScholarPi" → "Support Pi"

**What:** the support pill, its window heading, both donation dialogs and the Capabilities entry now read "Support Pi". The pill key changes with its title, so `account:Support ScholarPi` is migrated to `account:Support Pi` (positions, use, window state, priority and open lists), and PiEN aliases the old key so what it has learned carries over. The body text describing ScholarPi is unchanged.

**Verified:** a stored position and priority under the old key moved to the new one; the pill opens by its new title at 1440 and 390 px with no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.
