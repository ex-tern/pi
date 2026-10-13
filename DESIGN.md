# Pi Tech Lab, top down

This is the project written from the top: what it is, the few rules everything follows, and then each part
in the order you meet it, as if it had been designed in one sitting. `CLAUDE.md` is the working log of the
same project; this document is its shape.

## 1. What it is

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

## 2. The rules

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

## 3. The page, from the outside in

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

## 4. The graphical language

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

## 5. The engines

Behind `/api` one FastAPI process runs everything, and all of it is one file, `backend/api.py` (owner,
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

## 6. The frontend, in the order it loads

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
6. The super look, one concern per file (`frontend/super/`): `super/loop.js` (the main super: the loop the
   size of the page, its n, the zoom and the fit, windows kept inside the inner super, the inner super's
   box and offset; created by orbit.js with what it needs from the layout), `super/logo.js` (the title), `super/motion.js` (the one tween and the
   per-frame redraw signal), `super/shape.js` (shapes, wires' paths, windows morphing), `super/nodes.js` (the
   graphical language), `super/wire.js` (wiring as the mouse's default; edges and ports as wire ends;
   opening by wiring), `super/move.js` (moving the title, palette and Live), `super/site.js` (the inner super,
   its ports, lattice and values; every super's own shape; windows clipped to supers where CSS cannot),
   `super/scroll.js` (what a scroll does, where), `super/hover.js` (the super under the pointer lights up cobalt), `super/select.js` (a super has to be selected before anything inside it answers).

Everything the page remembers lives in `localStorage` under short prefixed keys (`orbit:`, `se:`,
`lv:`), and a signed-in researcher's layout is synced through the backend.

## 7. The three sites

| Site | Branch | What it is |
|---|---|---|
| pitechlab.com | `main` | Production. Real users, real data. Promoted by merging `experimental` after the owner has looked. |
| exp.pitechlab.com | `experimental` | Evolves constantly; separate data; `SCHOLARPI_CHANNEL=experimental` shows the banner and sets noindex. |
| super.pitechlab.com (se.) | `super` | The superellipse superlattice, deployed alone from its branch. |

Each is a Railway environment built by Nixpacks (`nixpacks.toml`: Python only, no Docker) and started
with gunicorn. `python scripts/tools.py run` runs it locally at
http://localhost:8000.

## 8. Working on it

Before a push: `cd backend && python -m pytest -q` against the known baseline;
`python scripts/tools.py build-hal --src ../HAL-OS` (refuses if HAL-OS and `frontend/hal/wire.js`
disagree); load the site at desktop and 390 px widths with no page errors and no horizontal scroll.
Work goes to `experimental` (or `super` for the super site); `main` only when the owner says so. The
repository is public: no secrets, no `.env`, nothing from private projects. Credits that are not ours
stay theirs: Unigyro and QuVI are Murtaza Vefadar's, HAL-OS, Neuro Frenzy and FaceMace come from their
own repositories.
