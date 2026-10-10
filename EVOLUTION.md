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

## 2026-10-09: double-click the logo to stop π

**What:** a double-click on the PiEN mark now freezes it: the sweep stops turning (`html.orbit-still`, animation paused) and π stops growing (`pi-worker.js` takes `{pause}` / `{resume}`), with the π box reading "N decimals, paused". Another double-click carries on from the same digit. This lasts for the visit only, because π restarts from 3. on every load. Double-click used to re-centre the logo; that is gone (drag it back instead).

**Verified:** the digits stop (0 new in 2 s) and the sweep's animation is paused; a second double-click resumes both; windows aren't left aside; 1440 and 390 px with no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: Neuro Frenzy: music with the clock, difficulty and reset

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

## 2026-10-09: ORCID sign-in returns to pitechlab.com

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

## 2026-10-09: scroll down to open the journal and the ledger

**What:** scrolling down on the main page opens "Proof-of-Research Ledger Explorer" and "The journal", with the journal in front, and brings back any windows set aside. On touch screens a swipe up does the same. This only counts on the page itself, not inside a window, a pill, the π box or the logo, and there is a 0.9 s cool-down. Scrolling up on the page still grows the logo, and the wheel over the logo still resizes it both ways. Scrolling down used to shrink the logo.

**Verified:** a wheel-down on empty page opened both, with the journal in front and the logo size unchanged; a wheel-up grew the logo and opened nothing; a swipe up at 390 px opened both; no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: the framework author links to his page

**What:** in the Architecture window, "Ali Vafadar Yengejeh" (the framework credit) now links to https://alivafadar.carrd.co/ in a new tab. The same goes for the older "Framework Author" note in the Architecture tab markup. The link is in the cobalt interactive colour.

**Verified:** the link opens the page in a new tab at 1440 and 390 px; no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: fix: scrolling opened windows at random and resized the logo

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

## 2026-10-09: scrolling opens a random window; the logo loses its trail; friends of π stop too

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

## 2026-10-09: RiBD suggests a ledger paper and a scanned manuscript

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

**Where it lives:** `backend/rib_suggest.py` (pure functions), `GET /api/buddy/suggest` (only public ledger fields: title, author, fields, piX, date) and `frontend/ribsuggest.js`. `app.js` only adds the slot.

**Verified:**
- `tests/test_rib_suggest.py` (5 tests) checks:
  - two different relevant picks, the first on the ledger
  - own and irrelevant papers never suggested
  - an empty profile asks to be filled in
  - only public fields returned
- Against a local database with a test profile and papers, the endpoint picked the ledger paper on glioblastoma and the stroke manuscript, and left out the researcher's own paper. The cards rendered, and a click opened the dossier, at 1440 and 390 px with no page errors.
- pytest at baseline (12 pre-existing failures); `build_hal.py` builds.

## 2026-10-09: Contact us is a window; a bigger logo; a logo click closes all windows

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

## 2026-10-09: Contact us never opens as a dialog

**What:** the Contact us button now opens the Contact us window (`PiOrbit.openTitle`) wherever it is reached from, so the old dialog with its × can't appear. The dialog remains only as a fallback if the orbit layout isn't running.

**Verified:** from the pill and from the button, no dialog appears and the form is in a window whose only visible buttons are Send and Clear, at 1440 and 390 px with no page errors; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: papers assessed automatically while the site is idle

**What:** the existing idle worker (`backend/idle_worker.py`) is now on, and it can actually run.
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

## 2026-10-09: idle worker never spins

**What:** the idle loop now waits at least 10 s between checks and before its first one, whatever `IDLE_POLL_SECONDS` / `IDLE_AFTER_SECONDS` are set to. With either at 0, the loop would otherwise run flat out and take a CPU core from the site. Assessments already in flight still block the worker, so a short quiet period never competes with a visitor's running assessment.

**Verified:** a new test with both set to 0 shows every wait ≥ 7.5 s (10 s with jitter); pytest at baseline; `build_hal.py` builds; the site loads at 1440 and 390 px with no page errors.

## 2026-10-09: the Live panel

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

**Backend:** `backend/live.py`, `GET /api/live`. Idle papers are recognised by their submitter, "ScholarPi (idle)". Recent assessments no longer counts that submitter as "signed in".

**Verified:**
- `tests/test_live.py` checks that idle papers are named and people's uploads never show their title or hash; the `test_recent.py` tests still pass.
- Docked at 1440 and 1100 px, no orbit element crosses into the panel, and an opened window stays left of it.
- Folded at 1024, 390 and 360 px, the tab overlaps no pill and opens the panel.
- The 15-size layout audit passes; no page errors or horizontal scroll.
- pytest at baseline (12 pre-existing failures); `build_hal.py` builds.

## 2026-10-09: Download paper in the dossier; a yellow account dot for one sign-in

**What:**
- **Download paper:** every dossier has a "Download paper" button (`frontend/download.js`). The server still decides who may have the file (`/api/papers/{hash}/file`, now with `?download=1` for a file to save). That is anyone once the author has published the assessment, or the author for their own upload; the session token goes with the request.
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

## 2026-10-09: RiBD: papers to read and hot topics

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

## 2026-10-09: ORCID sign-in uses the site's own callback

**Bug:** the owner updated the ORCID app's redirect URIs to pitechlab.com. Production still sent `redirect_uri=https://scholarpi.up.railway.app/api/auth/orcid/callback` (from `ORCID_REDIRECT_URI`), so ORCID refused every sign-in with "redirect_uri does not match for registered client".

**Fix:** signing in from one of the site's own addresses (pitechlab.com, www, exp) asks ORCID to return to that address's own callback, `https://<host>/api/auth/orcid/callback`, whatever `ORCID_REDIRECT_URI` says. The token exchange uses the same value. Other hosts keep the old behaviour. Each callback must be registered in the ORCID app.

**Verified:** `tests/test_orcid_return.py` (7 tests): the login URL and token exchange use `https://pitechlab.com/api/auth/orcid/callback`, the visitor lands back on pitechlab.com, and the earlier return-origin, error and open-redirect tests still pass. pytest at baseline (12 pre-existing failures); `build_hal.py` builds; the site loads with no page errors.

## 2026-10-09: the Lib bubble becomes Library, with RiBD and the Map of Science

**What:** the "Lib" bubble is renamed "Library" and now holds RiBD and The Global Map of Science as well as Neuro Frenzy and MD.
- The bubble's key moves from `lib:Lib group` to `lib:Library group`, and the stored position migrates with it.
- RiBD still only shows when signed in, as before.
- A window opened from a bubble is now labelled with the bubble (Library, Tools, Lab) instead of its old tab name (Evaluate, Envision).
- Capabilities lists the four under "Library".

**Verified:** signed in, the bubble lists RiBD, The Global Map of Science, Neuro Frenzy and MD, and none of them is left as a loose pill. Each opens with the "Library" label. A position saved under the old key is carried over. No pills overlap, the 15-size layout audit passes, and there are no page errors or horizontal scroll at 1440 and 390 px. pytest at baseline; `build_hal.py` builds.

## 2026-10-09: the π mark and counter show what the site is processing

**What:** the sweep of the π mark and the live π counter now represent the site's work. Each level sets the sweep speed, the digit rate and the counter's wording:

| Level | Sweep | π digits | Counter reads |
|---|---|---|---|
| quiet | 18°/s, a turn in 20 s | 2.5/s | "N decimals, the site is quiet" |
| working (one paper being assessed, by a person or by the site itself while idle) | 60°/s | 11/s | "assessing a paper" |
| busy (several at once) | 165°/s | 25/s | "assessing several papers" |

The mark also gets a soft cobalt glow while working.

**How:**
- **Server activity:** `GET /api/activity` (backend/live.py, from `idle_worker.activity()`, no database) reports provider requests in flight and whether the idle worker is assessing. `orbit.js` polls it every 5 s while the tab is visible.
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

## 2026-10-09: slower π

**What:** the owner found π grew too fast. Digits now come at 1 a second while quiet (was 2.5), 2.5 a second while a paper is assessed (was 11) and 5 a second with several (was 25). The sweep speeds are unchanged.

**Verified:** the measured rates over 4 s at each level were 1.0, 2.5 and 5.0 digits/s at 1440 and 390 px, with no page errors or horizontal scroll; pytest at baseline; `build_hal.py` builds.

## 2026-10-09: deploy fix, ASCII commit messages

**What:** the last two production deploys failed at Railway's "Build image" step within 5 seconds, before any Dockerfile step ran. Their commit subjects were the only ones containing a non-ASCII character (π); every deploy with an ASCII subject, before and since, built. The code is unchanged. This commit has an ASCII message so the same code builds, and CLAUDE.md now asks for ASCII commit messages.

## 2026-10-09: the real deploy failure, Docker Hub's rate limit

**Correction:** the entry above blamed the π in commit messages. The build log shows the real cause: `load metadata for docker.io/library/python:3.11-slim` → `429 Too Many Requests` from registry-1.docker.io. Railway's builders share Docker Hub's anonymous pull limit, and the commit messages had nothing to do with it.

**Fix:** the Dockerfile now pulls the same official image from AWS's public mirror, `public.ecr.aws/docker/library/python:3.11-slim`, which has no Docker Hub limit. CLAUDE.md rule 6 now records this instead of the wrong ASCII rule.

**Verified:** pytest at baseline; `build_hal.py` builds. The sandbox cannot reach public.ecr.aws, so the experimental deploy of this commit is the first real build check.

## 2026-10-10: the forecast tests run again

**What:** `tests/test_forecast.py` imported a `forecast` module that no longer exists, so the whole file was skipped with `--ignore` and its 14 tests (forecast caching, bounded training, the Holt fallback) protected nothing. The module was renamed piD (`backend/pid_engine.py`) with the same functions, so the test now imports `pid_engine as forecast`. CLAUDE.md's pre-push command drops the `--ignore`.

**Verified:** all 14 forecast tests pass; the full suite is 12 failed (the same pre-existing baseline) and 418 passed, up from 404; `build_hal.py` builds; the site loaded at 1440 and 390 px on every tab with no page errors and no horizontal scroll (no frontend change).

**Files:** `backend/tests/test_forecast.py`, `CLAUDE.md`, `EVOLUTION.md`.

## 2026-10-10: website traffic in Analytics

**What:** the Analytics window now has a "Website traffic" section:
- **Tiles:** distinct visitors today, in the last 7 days, the last 30 days and all time.
- **Chart:** a 30-day bar chart of distinct visitors per day, one cobalt series, hover tooltip per day with visitors and visits.
- **Table view** of the same numbers.

**Data:** `backend/traffic.py`, a new `site_traffic` table (day, the existing keyed IP hash, visit count), filled by the same once-per-session ping as the visitor total (`POST /api/visit`).
- `GET /api/traffic?days=30` returns aggregates only.
- Rows older than 120 days are dropped.
- "All time" is the existing `site_visits` total (never less than what the daily table has seen).
- The day series starts from this deploy, since no per-day history was kept before.

**Verified:**
- `tests/test_traffic.py` checks counting, gap filling, the 7- and 30-day windows, all time, the upsert and pruning, and that no visitor key leaves the API.
- With 30 seeded days, the section rendered in the Analytics window at 1440 and 390 px: 4 tiles, bars for the days with visitors, a 30-row table, and a tooltip on hover. No page errors or horizontal scroll.
- pytest at baseline (12 failures, now including test_forecast); `build_hal.py` builds.

## 2026-10-10: the traffic chart keeps its proportions

**What:** the new Website traffic chart in Analytics drew a fixed 600×150 drawing and stretched it to the window with `preserveAspectRatio="none"`. On a phone the day and count labels came out squashed and the bar corners warped, and on a wide screen they were drawn wider than they should be. The chart is now drawn at the box's real width (one unit per pixel) and redrawn when the window or panel is resized.

**Verified:** screenshots of the chart with a hovered bar at 1440 and 390 px show labels at their normal shape and round bar tops; every tab at both widths had no page errors and no horizontal scroll; pytest at baseline (12 pre-existing failures, 420 passed); `build_hal.py` builds.

**Files:** `frontend/traffic.js`, `frontend/traffic.css`, `frontend/index.html`, `EVOLUTION.md`.
## 2026-10-10: HAL-OS boots to a command prompt

**What:** HAL-OS is now a basic working OS. The Lab's machine boots a 16-bit real-mode shell (`frontend/hal/shell/shell.asm`, about 3 KB) to a `HAL-OS>` prompt. It uses only the BIOS (video, keyboard, clock, memory, disk), so it would run on QEMU, VirtualBox or real hardware too. Commands:
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

**Build:** `python scripts/build_hal_shell.py` (nasm) writes `frontend/hal/shell.img` (padded to 64 KB, committed, so deploys need no nasm). `--check` verifies it matches the source. The HAL-OS repository itself is untouched.

**Verified:** in the browser, on the standalone portal and inside the Lab window, at 1280/1440 and 390 px:
- every command produced the expected output, e.g. `calc 12 * 7` → 84, `calc -100 / 7` → -14, `mem` 639 KB + 3072 KB
- notes round-tripped, an unknown command was reported, and Shift worked for capitals and `*`
- `hal` booted the network (≈190 fps, weights restored path intact), and Reboot came back to the prompt
- no page errors or horizontal scroll

pytest at baseline; `build_hal.py` builds.

## 2026-10-10: the page, super-simplified

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

## 2026-10-10: bubbles wired together like LabVIEW

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

## 2026-10-10: the superellipse look, for se.pitechlab.com

**What:** `frontend/superellipse.css` gives superellipse ("squircle") corners to pills, bubbles, member chips, buttons, cards, tiles, the π box and windows. It uses CSS `corner-shape: superellipse(2)` with radii that suit each element. Browsers without corner-shape (at the time of writing, those outside Chrome/Edge 139+) keep ordinary rounded corners at the same radii.

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

## 2026-10-10: Superellipse title for the superellipse look

**What:** `frontend/selogo.js` draws the "Pi Tech Lab" title from superellipse geometry (|x/a|^n + |y/b|^n = 1, n = 4): letters built from superellipse rings and bars, with a cobalt superellipse dot on the i, inside a superellipse badge. It replaces the text title only when `html.shape-se` is set (se.pitechlab.com, `SCHOLARPI_SHAPE=superellipse` or `?shape=se`). The accessible name stays "Pi Tech Lab".

**Why:** the owner asked for the title to be built on superellipses, with letters and badge both superellipse-based.

**Verified:**
- pytest at baseline (12 failed, 420 passed); `build_hal.py` builds.
- Browser at 1440 and 390 px with `?shape=se`: logo shown, text title hidden, no overlap with pills, no horizontal scroll, no errors.
- Without the superellipse look the plain text title is unchanged.

## 2026-10-10: n means something: buttons n = γ, windows n = π; a Functions palette

**What:**
- `frontend/semorph.js`: in the superellipse look, buttons, pills and bubbles have corners with exponent n = γ (Euler–Mascheroni, 0.5772…, concave), and windows and cards n = π. Both values are computed in the page and keep improving: γ from H_m − ln m with its asymptotic correction (or the Numbers window's exact digits once present), π from the mark's live digits (Machin's formula until they arrive). They reach CSS as `corner-shape: superellipse(K)`, n = 2^K.
- Opening a window grows it out of its button while n climbs from γ to π; closing folds it back while n falls to γ. The moving outline is drawn from the superellipse formula, so browsers without `corner-shape` see the morph too. Reduced motion skips it.
- `frontend/labview.js` + `labview.css`: a LabVIEW-style Functions palette, bottom-left: Add, Subtract, Multiply, Divide, And, Or, Exclusive Or, Not, Greater?, Equal?, For Loop, While Loop, Case Structure. They are dummies that fire on the two newest π digits; the loops run until pressed again. It starts open only where it does not cover the diagram (folded on phones) and remembers your choice.

**Why:** the owner asked for minimise/maximise to be a change in n, buttons at n = γ, windows at n = π, computed by the app and animated; then for dummy LabVIEW function buttons.

**Verified:** pytest at baseline (12 failed, 420 passed); `build_hal.py` builds. Browser at 1440, 1280×720 and 390 px, with and without `?shape=se`: CSS gets K = log2 γ and log2 π, the morph runs γ → π on open and π → γ on close and leaves nothing behind, every palette node gives a result, the palette covers no bubble when it starts, no horizontal scroll, no page errors.

## 2026-10-10: Diamonds, n by use, a graphical language, and the mark as the central loop

**What:**
- Superellipse look: buttons, pills and bubbles are stretched four-pointed diamonds (each end half a superellipse at n = γ, `border-radius: X / 50%` with `corner-shape`). Each button's own n grows with use, n(u) = γ + (π − γ)·u/(u + 8), set per element as `--se-k` (`@property`, not inherited); the open/close morph starts from that n. Dots, wire terminals, the node output terminals and the title's i-dot are whole γ-superellipses (sparkles), via a computed `clip-path` polygon (`--se-sparkle`) or `SeMorph.star`.
- `labview.js` is now a small graphical language: drag a node out of the Functions palette onto any pill, bubble, window, the π mark, the π counter or another node and it is wired to it and computes live (pills and windows give their use count, open state and name; the mark gives the newest π digit; nodes chain). Text, Join and Ask SciM build prompts graphically; Ask SciM sends to the SciM Assistant only when pressed. Drop on the palette to remove, double-click to unwire, press a loop to pause it. On phones the palette folds while dragging so the pills under it can be reached. The diagram is kept in localStorage.
- The mark is the central loop in the superellipse look: a superellipse at n = π (drawn by orbit.js from the live π), the diameter reaching the curve at every angle, the π counter inside it (in the mark's layer), and a While Loop's terminals: i, and continue/stop, which follows the double-click pause. A click on the counter still opens π and friends; elsewhere the counter is unchanged.

**Why:** owner requests: Gemini-like diamonds ("buttons become diamonds"), nodes draggable and attachable to every button and object, n growing with use, "this is a graphical language", "prompts are made graphically", and the mark and counter merged into a superellipse central loop.

**Verified:** pytest at baseline (12 failed, 420 passed); `build_hal.py` builds. Browser at 1440 and 390 px with `?shape=se`, and 1280×720 plain: Add wired to the π mark and Performance computes; Text "Explain" + Join + Whitepaper gives "Explain Whitepaper", and Ask SciM opens SciM with it; Performance's n rose from γ to 1.43 after use; drop on the palette removes; the diagram survives a reload; the counter sits in the loop, opens π and friends on click, and the stop terminal shows when π is paused; plain look keeps the counter under the mark; no horizontal scroll, no page errors.
