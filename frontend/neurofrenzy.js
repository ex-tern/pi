// neurofrenzy.js — NeuroFrenzy, a game in the Lab bubble.
//
// Fill the blanks in neuroscience statements before the clock runs out.
// A browser port of NeuroGame ("Neuro Speed Typer", a Streamlit app in
// neurophilic/NeuroGame, to be renamed NeuroFrenzy): same questions, levels,
// time limits, hints and scoring (10 points per blank, nothing if late or
// wrong). It adds a visible countdown and remembers your best score.
(function () {
  "use strict";
  const QUESTIONS = [
    { level: "Easy", time: 25, text: "The rapid accumulation of [1] acid drops the intracellular pH, inhibiting essential glycolytic enzymes.",
      answers: ["lactic"], hint: "Byproduct of anaerobic glycolysis" },
    { level: "Easy", time: 25, text: "Deep Lenticulostriate branch strokes cause pure motor hemiparesis because they supply the posterior limb of the internal [1].",
      answers: ["capsule"], hint: "White matter tract structure" },
    { level: "Medium", time: 30, text: "On an MR Spectroscopy (MRS) profile, a Glioblastoma shows highly elevated [1], a marker of cell membrane turnover, and decreased [2], a marker of healthy neurons.",
      answers: ["choline", "naa"], hint: "1: Starts with C | 2: N-acetylaspartate acronym" },
    { level: "Medium", time: 30, text: "Anoxic depolarization removes the [1] block from the [2] receptor pore, allowing massive calcium influx.",
      answers: ["magnesium", "nmda"], hint: "1: A mineral | 2: Glutamate receptor type" },
    { level: "Hard", time: 40, text: "Damage to the dominant inferior division of the MCA can cause [1] aphasia, while damage to the dominant parietal lobe can cause [2] syndrome, characterized by agraphia and [3] agnosia.",
      answers: ["wernicke's", "gerstmann", "finger"], hint: "1: Receptive aphasia | 2: Syndrome name | 3: Body part" },
    { level: "Hard", time: 40, text: "On Perfusion-Weighted Imaging, a tumor rim shows elevated relative cerebral blood [1] due to [2], whereas an [3] shows low or normal perfusion.",
      answers: ["volume", "neoangiogenesis", "abscess"], hint: "1: The 'V' in rCBV | 2: New blood vessel formation | 3: Encapsulated infection" },
  ];
  const MAX = QUESTIONS.reduce((a, q) => a + 10 * q.answers.length, 0);
  const norm = s => String(s || "").trim().toLowerCase().replace(/['’]/g, "");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const best = () => { try { return +(JSON.parse(localStorage.getItem("orbit:nf:best") || "0")) || 0; } catch (_) { return 0; } };
  const saveBest = v => { if (window.PiOrbit && v > best()) window.PiOrbit.store("orbit:nf:best", v); };

  const root = document.createElement("div");
  root.className = "nf";
  let qi = 0, score = 0, started = 0, timer = 0, answered = false;

  function intro() {
    stop();
    root.innerHTML =
      '<h2>NeuroFrenzy</h2>' +
      '<p class="nf-lede">Neuroscience against the clock: fill in the blanks before time runs out. ' +
      QUESTIONS.length + ' questions, from easy to hard, ' + MAX + ' points to win.</p>' +
      (best() ? '<p class="nf-best">Your best: <b>' + best() + '</b> of ' + MAX + '</p>' : '') +
      '<button type="button" class="nf-go">Start</button>';
    root.querySelector(".nf-go").addEventListener("click", () => { qi = 0; score = 0; ask(); });
  }

  function ask() {
    const q = QUESTIONS[qi];
    answered = false;
    let n = 0;
    const sentence = esc(q.text).replace(/\[(\d)\]/g, () =>
      '<input class="nf-blank" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Blank ' + (++n) + '">');
    root.innerHTML =
      '<div class="nf-top"><span class="nf-level nf-' + q.level.toLowerCase() + '">' + q.level + '</span>' +
      '<span class="nf-prog">Question ' + (qi + 1) + ' of ' + QUESTIONS.length + '</span>' +
      '<span class="nf-score">' + score + ' pts</span></div>' +
      '<div class="nf-clock"><i></i></div><p class="nf-time"></p>' +
      '<form class="nf-q"><p class="nf-text">' + sentence + '</p>' +
      '<details class="nf-hint"><summary>Need a hint?</summary><p>' + esc(q.hint) + '</p></details>' +
      '<button type="submit" class="nf-go">Submit</button></form>' +
      '<p class="nf-feedback" aria-live="polite"></p>';
    const form = root.querySelector(".nf-q");
    form.addEventListener("submit", e => { e.preventDefault(); if (!answered) check(false); else next(); });
    const first = root.querySelector(".nf-blank");
    if (first) first.focus({ preventScroll: true });
    started = performance.now();
    stop();
    timer = setInterval(tick, 100);
    tick();
  }

  function tick() {
    const q = QUESTIONS[qi];
    const left = Math.max(0, q.time - (performance.now() - started) / 1000);
    const bar = root.querySelector(".nf-clock i"), t = root.querySelector(".nf-time");
    if (bar) { bar.style.width = (100 * left / q.time) + "%"; bar.classList.toggle("low", left < 6); }
    if (t) t.textContent = left.toFixed(1) + " s left";
    if (left <= 0 && !answered) check(true);
  }

  function check(timeUp) {
    stop();
    answered = true;
    const q = QUESTIONS[qi];
    const taken = (performance.now() - started) / 1000;
    const inputs = [...root.querySelectorAll(".nf-blank")];
    const fb = root.querySelector(".nf-feedback");
    const right = inputs.map((inp, i) => norm(inp.value) === norm(q.answers[i]));
    inputs.forEach((inp, i) => { inp.disabled = true; inp.classList.add(right[i] ? "ok" : "no"); if (!right[i]) inp.value = q.answers[i]; });
    if (timeUp || taken > q.time) {
      fb.innerHTML = "<b>Time's up.</b> The answers were: " + q.answers.map(esc).join(", ") + ".";
    } else if (right.every(Boolean)) {
      const pts = 10 * q.answers.length;
      score += pts;
      fb.innerHTML = "<b>Correct!</b> " + taken.toFixed(1) + " s, +" + pts + " points.";
    } else {
      fb.innerHTML = "<b>Not quite.</b> The answers were: " + q.answers.map(esc).join(", ") + ".";
    }
    const btn = root.querySelector(".nf-q .nf-go");
    btn.textContent = qi + 1 < QUESTIONS.length ? "Next question" : "See your score";
    btn.focus({ preventScroll: true });
    root.querySelector(".nf-score").textContent = score + " pts";
  }

  function next() {
    qi++;
    if (qi < QUESTIONS.length) ask(); else end();
  }

  function end() {
    stop();
    const prev = best();
    saveBest(score);
    root.innerHTML =
      '<h2>' + (score === MAX ? "Perfect!" : "Game over") + '</h2>' +
      '<p class="nf-final"><b>' + score + '</b> of ' + MAX + ' points</p>' +
      (score > prev ? '<p class="nf-best">A new best.</p>' : '<p class="nf-best">Your best: <b>' + Math.max(prev, score) + '</b></p>') +
      '<button type="button" class="nf-go">Play again</button>';
    root.querySelector(".nf-go").addEventListener("click", () => { qi = 0; score = 0; ask(); });
  }

  function stop() { clearInterval(timer); timer = 0; }

  function start() {
    intro();
    window.PiOrbit.addPill({ key: "lib:NeuroFrenzy", section: { key: "lib", name: "Lib" }, title: "NeuroFrenzy", content: root, inGroup: "Lib" });
    // a game paused out of sight is no game: if its window closes mid-question, start over next time
    new MutationObserver(() => { if (!root.closest(".orbit-panel") && timer) intro(); })
      .observe(document.body, { childList: true });
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
