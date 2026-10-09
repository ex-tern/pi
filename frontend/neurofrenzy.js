// neurofrenzy.js — NeuroFrenzy, a game in the Lab bubble.
//
// Fill the blanks in neuroscience statements before the clock runs out.
// A browser port of NeuroGame ("Neuro Speed Typer", a Streamlit app in
// neurophilic/NeuroGame, to be renamed NeuroFrenzy): same questions, levels,
// time limits, hints and scoring (10 points per blank, nothing if late or
// wrong). It adds a visible countdown, three difficulties (easy, normal,
// hard: more or less time, hint shown or none), a reset button and a best
// score per difficulty.
//
// Music: a 100 BPM song plays on a seamless 8-bar loop (19.2 s) while a
// question's clock is running (and the window is in view), unless muted; it
// pauses between questions and resumes where it left off. The mute choice is
// remembered (orbit:nf:mute, synced when signed in).
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
  // Difficulty changes the clock and the hints, not the questions:
  // easy has half as much time again and shows the hint, hard has 60% of the
  // time and no hint. Each difficulty keeps its own best score.
  const LEVELS = {
    easy:   { name: "Easy",   time: 1.5, hint: "shown", say: "More time, and the hint is shown." },
    normal: { name: "Normal", time: 1,   hint: "ask",   say: "The original clock; hints if you ask." },
    hard:   { name: "Hard",   time: 0.6, hint: "none",  say: "Less than two thirds of the time, no hints." },
  };
  const getLevel = () => { try { const v = JSON.parse(localStorage.getItem("orbit:nf:level") || '"normal"'); return LEVELS[v] ? v : "normal"; } catch (_) { return "normal"; } };
  const setLevel = v => { if (window.PiOrbit) window.PiOrbit.store("orbit:nf:level", v); else try { localStorage.setItem("orbit:nf:level", JSON.stringify(v)); } catch (_) {} };
  const bestKey = () => getLevel() === "normal" ? "orbit:nf:best" : "orbit:nf:best:" + getLevel();
  const best = () => { try { return +(JSON.parse(localStorage.getItem(bestKey()) || "0")) || 0; } catch (_) { return 0; } };
  const saveBest = v => { if (window.PiOrbit && v > best()) window.PiOrbit.store(bestKey(), v); };
  const limit = q => Math.round(q.time * LEVELS[getLevel()].time);

  const root = document.createElement("div");
  root.className = "nf";

  // ------------------------------------------------------------ music
  const SONG = "sound/neurofrenzy.mp3?v=1", LOOP = 19.2;
  const muted = () => { try { return JSON.parse(localStorage.getItem("orbit:nf:mute") || "false") === true; } catch (_) { return false; } };
  let actx = null, song = null, src = null, vol = null, loading = null;
  function shown() {
    return !!root.closest(".orbit-panel") && !document.documentElement.classList.contains("orbit-aside") &&
      document.visibilityState === "visible";
  }
  function loadSong() {
    if (!loading) loading = fetch(SONG).then(r => r.arrayBuffer())
      .then(a => new Promise((ok, no) => actx.decodeAudioData(a, ok, no)))
      .then(b => { song = b; })
      .catch(() => { loading = null; });
    return loading;
  }
  function lead(b) {                       // skip the encoder's silent padding
    const d = b.getChannelData(0); let i = 0;
    while (i < d.length && Math.abs(d[i]) < 1e-4) i++;
    return i / b.sampleRate;
  }
  // The music runs only while a question's clock is running: it fades out when
  // you answer (or time runs out) and picks up where it left off at the next
  // question. Pausing suspends the audio clock, so the song's place is kept.
  let offT = 0;
  const wanted = () => !!timer && !answered && shown() && !muted();
  function musicOn() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!actx) actx = new AC();
    clearTimeout(offT);
    if (actx.state === "suspended") actx.resume().catch(() => {});
    if (src) {
      const t = actx.currentTime;
      vol.gain.cancelScheduledValues(t);
      vol.gain.setValueAtTime(vol.gain.value, t);
      vol.gain.linearRampToValueAtTime(0.8, t + 0.25);
      return;
    }
    loadSong().then(() => {
      if (src || !song || !wanted()) return;
      const at = lead(song);
      src = actx.createBufferSource();
      src.buffer = song; src.loop = true;
      src.loopStart = at; src.loopEnd = Math.min(song.duration, at + LOOP);
      vol = actx.createGain();
      vol.gain.setValueAtTime(0, actx.currentTime);
      vol.gain.linearRampToValueAtTime(0.8, actx.currentTime + 0.4);
      src.connect(vol).connect(actx.destination);
      src.start(actx.currentTime + 0.02, at);
    });
  }
  function musicOff() {
    if (!src || !actx || actx.state !== "running" || offT) return;
    const t = actx.currentTime;
    vol.gain.cancelScheduledValues(t);
    vol.gain.setValueAtTime(vol.gain.value, t);
    vol.gain.linearRampToValueAtTime(0, t + 0.25);
    offT = setTimeout(() => { offT = 0; if (!wanted() && actx) actx.suspend().catch(() => {}); }, 300);
  }
  function syncMusic() {
    if (wanted()) musicOn(); else musicOff();
    paintMute();
  }
  const box = document.createElement("div");
  box.className = "nf-box";
  const muteBtn = document.createElement("button");
  muteBtn.type = "button";
  muteBtn.className = "nf-mute";
  function paintMute() {
    const m = muted();
    muteBtn.setAttribute("aria-pressed", String(m));
    muteBtn.title = m ? "Turn the music on" : "Mute the music";
    muteBtn.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-3.5v11L6 12H3z"/>' +
      (m ? '<path d="M13 7.5l5 5M18 7.5l-5 5"/>' : '<path d="M13 7a4 4 0 0 1 0 6M15.2 5a7 7 0 0 1 0 10"/>') +
      '</svg><span>' + (m ? "Music off" : "Music on") + '</span>';
  }
  muteBtn.addEventListener("click", () => {
    const m = !muted();
    if (window.PiOrbit) window.PiOrbit.store("orbit:nf:mute", m); else try { localStorage.setItem("orbit:nf:mute", JSON.stringify(m)); } catch (_) {}
    syncMusic();
  });
  box.append(muteBtn, root);
  let qi = 0, score = 0, started = 0, timer = 0, answered = false;

  function intro() {
    stop();
    const lv = getLevel();
    root.innerHTML =
      '<h2>Neuro Frenzy</h2>' +
      '<p class="nf-lede">Neuroscience against the clock: fill in the blanks before time runs out. ' +
      QUESTIONS.length + ' questions, from easy to hard, ' + MAX + ' points to win.</p>' +
      '<div class="nf-diff" role="radiogroup" aria-label="Difficulty"><span>Difficulty</span>' +
      Object.entries(LEVELS).map(([k, L]) =>
        '<button type="button" role="radio" data-level="' + k + '" aria-checked="' + (k === lv) + '">' + L.name + '</button>').join("") +
      '</div><p class="nf-diff-say">' + LEVELS[lv].say + '</p>' +
      (best() ? '<p class="nf-best">Your best on ' + LEVELS[lv].name.toLowerCase() + ': <b>' + best() + '</b> of ' + MAX + '</p>' : '') +
      '<button type="button" class="nf-go">Start</button>';
    root.querySelectorAll(".nf-diff button").forEach(b => b.addEventListener("click", () => { setLevel(b.dataset.level); intro(); }));
    root.querySelector(".nf-go").addEventListener("click", () => { qi = 0; score = 0; ask(); });
  }

  // Reset: abandon the run and go back to the start screen.
  function reset() { qi = 0; score = 0; answered = false; intro(); }

  function ask() {
    const q = QUESTIONS[qi];
    answered = false;
    let n = 0;
    const sentence = esc(q.text).replace(/\[(\d)\]/g, () =>
      '<input class="nf-blank" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Blank ' + (++n) + '">');
    root.innerHTML =
      '<div class="nf-top"><span class="nf-level nf-' + q.level.toLowerCase() + '">' + q.level + '</span>' +
      '<span class="nf-prog">Question ' + (qi + 1) + ' of ' + QUESTIONS.length + '</span>' +
      '<span class="nf-score">' + score + ' pts</span>' +
      '<button type="button" class="nf-reset" title="Start over">Reset</button></div>' +
      '<div class="nf-clock"><i></i></div><p class="nf-time"></p>' +
      '<form class="nf-q"><p class="nf-text">' + sentence + '</p>' +
      (LEVELS[getLevel()].hint === "none" ? '' :
        '<details class="nf-hint"' + (LEVELS[getLevel()].hint === "shown" ? ' open' : '') + '><summary>' +
        (LEVELS[getLevel()].hint === "shown" ? 'Hint' : 'Need a hint?') + '</summary><p>' + esc(q.hint) + '</p></details>') +
      '<button type="submit" class="nf-go">Submit</button></form>' +
      '<p class="nf-feedback" aria-live="polite"></p>';
    root.querySelector(".nf-reset").addEventListener("click", reset);
    const form = root.querySelector(".nf-q");
    form.addEventListener("submit", e => { e.preventDefault(); if (!answered) check(false); else next(); });
    const first = root.querySelector(".nf-blank");
    if (first) first.focus({ preventScroll: true });
    started = performance.now();
    stop();
    timer = setInterval(tick, 100);
    syncMusic();
    tick();
  }

  function tick() {
    const q = QUESTIONS[qi];
    const T = limit(q);
    const left = Math.max(0, T - (performance.now() - started) / 1000);
    const bar = root.querySelector(".nf-clock i"), t = root.querySelector(".nf-time");
    if (bar) { bar.style.width = (100 * left / T) + "%"; bar.classList.toggle("low", left < 6); }
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
    if (timeUp || taken > limit(q)) {
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
      '<p class="nf-final"><b>' + score + '</b> of ' + MAX + ' points <span class="nf-on">on ' + LEVELS[getLevel()].name.toLowerCase() + '</span></p>' +
      (score > prev ? '<p class="nf-best">A new best.</p>' : '<p class="nf-best">Your best: <b>' + Math.max(prev, score) + '</b></p>') +
      '<div class="nf-row"><button type="button" class="nf-go">Play again</button>' +
      '<button type="button" class="nf-alt">Change difficulty</button></div>';
    root.querySelector(".nf-go").addEventListener("click", () => { qi = 0; score = 0; ask(); });
    root.querySelector(".nf-alt").addEventListener("click", reset);
  }

  function stop() { clearInterval(timer); timer = 0; syncMusic(); }

  function start() {
    intro();
    paintMute();
    window.PiOrbit.addPill({ key: "lib:NeuroFrenzy", section: { key: "lib", name: "Library" }, title: "Neuro Frenzy", content: box, inGroup: "Library" });
    // music follows the window: on while it is open and in view, off otherwise
    setInterval(syncMusic, 400);
    document.addEventListener("visibilitychange", syncMusic);
    // sound may only start after a gesture: the first click or key press anywhere unlocks it
    const unlock = () => { if (wanted()) musicOn(); };
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
    // a game paused out of sight is no game: if its window closes mid-question, start over next time
    new MutationObserver(() => { if (!root.closest(".orbit-panel") && timer) intro(); })
      .observe(document.body, { childList: true });
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
