// logosound.js — pressing the PiEN mark (the π logo) plays a song on a
// seamless loop; press again to stop. The file itself is cut so its end
// crossfades into its start, and it plays through Web Audio with the
// encoder's silent padding trimmed, so there is no gap at the loop point.
// The audio loads only on the first press; a drag never counts as a press.
//
// The song runs at 100 BPM, the tempo of π: pi-worker.js emits a digit every
// 60 ms, ten a beat, and the loop is exactly 8 bars (19.2 s = 320 digits).
// On every pass of the loop the digit stream is re-synced to the beat.
//
// The loop is 6 bars (14.4 s = 240 digits), cut where the song repeats itself
// (it has a 24-beat pattern) with a one-bar crossfade, so the cycle can't be
// heard. And the volume follows π: each new digit sets the level for its
// 60 ms (0 quietest, 9 loudest), so no two passes of the loop sound alike.
//
// A press starts with a futuristic whoosh, synthesised on the spot (filtered
// noise sweeping up and across the stereo field, with a gliding pair of
// tones), exactly one beat long so the song drops in on the beat. Stopping
// plays a shorter whoosh going down.
(function () {
  "use strict";
  const SRC = "sound/dd.mp3?v=8";
  const LOOP = 14.4;          // seconds: 24 beats at 100 BPM
  const FIRST_BEAT = 0;      // the loop starts on a beat
  const BEAT = 0.6;
  let ctx = null, buf = null, loopStart = 0, loopEnd = 0, node = null, gain = null, loading = null;
  let fallback = null, want = false, syncT = 0, piGain = null;
  const level = d => 0.4 + 0.6 * d / 9;   // digit 0 → 40%, 9 → 100%

  function edges(b) {
    const d = b.getChannelData(0), n = d.length, th = 1e-4;
    let s = 0, e = n - 1;
    while (s < n && Math.abs(d[s]) < th) s++;
    while (e > s && Math.abs(d[e]) < th) e--;
    return [s / b.sampleRate, (e + 1) / b.sampleRate];
  }

  function load() {
    if (!loading) loading = fetch(SRC).then(r => r.arrayBuffer())
      .then(a => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no)))
      .then(b => { buf = b; loopStart = edges(b)[0]; loopEnd = Math.min(b.duration, loopStart + LOOP); });
    return loading;
  }

  // ------------------------------------------------------------ the whoosh
  let noise = null;
  function whoosh(ac, dest, t, up) {
    const D = up ? BEAT : 0.45;
    if (!noise || noise.sampleRate !== ac.sampleRate) {
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const lo = 260, hi = 7200, f0 = up ? lo : hi, f1 = up ? hi : lo;
    const out = ac.createGain();
    out.gain.value = 3.2;
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (pan) {
      pan.pan.setValueAtTime(up ? -0.75 : 0.75, t);
      pan.pan.linearRampToValueAtTime(up ? 0.75 : -0.75, t + D);
      out.connect(pan).connect(dest);
    } else out.connect(dest);

    // air: band-passed noise sweeping
    const src = ac.createBufferSource(); src.buffer = noise;
    const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3.5;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + D);
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.55, t + D * (up ? 0.8 : 0.25));
    ng.gain.exponentialRampToValueAtTime(0.0001, t + D);
    src.connect(bp).connect(ng).connect(out);
    src.start(t); src.stop(t + D + 0.02);

    // shine: two gliding tones a fifth apart, slightly detuned
    [1, 1.5].forEach((m, i) => {
      const o = ac.createOscillator(); o.type = i ? "triangle" : "sine";
      o.detune.value = i ? 7 : -7;
      o.frequency.setValueAtTime((up ? 180 : 1500) * m, t);
      o.frequency.exponentialRampToValueAtTime((up ? 1500 : 160) * m, t + D);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(i ? 0.035 : 0.06, t + D * (up ? 0.85 : 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t + D);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + D + 0.02);
    });
    return D;
  }
  window.PiWhoosh = whoosh;   // for previews

  function play(core) {
    node = ctx.createBufferSource();
    node.buffer = buf;
    node.loop = true;
    node.loopStart = loopStart;
    node.loopEnd = loopEnd;
    const t0 = ctx.currentTime + 0.03 + whoosh(ctx, ctx.destination, ctx.currentTime + 0.03, true);
    gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(1, t0 + 0.05);
    piGain = ctx.createGain();
    piGain.gain.value = 0.7;
    node.connect(gain).connect(piGain).connect(ctx.destination);
    node.start(t0, loopStart);
    core.classList.add("is-playing");
    beats(t0);
  }

  // Tell the π digits where the next beat is, once per pass of the loop.
  function beats(t0) {
    clearTimeout(syncT);
    const lat = (ctx.outputLatency || ctx.baseLatency || 0);
    const tick = () => {
      if (!node) return;
      const pos = (ctx.currentTime - t0) % LOOP;
      let next = FIRST_BEAT - pos;
      while (next < 0.05) next += BEAT;
      document.dispatchEvent(new CustomEvent("pi:beat", { detail: { delay: Math.round((next + lat) * 1000) } }));
      syncT = setTimeout(tick, LOOP * 1000);
    };
    tick();
  }

  function stop(core) {
    clearTimeout(syncT);
    if (node) {
      const n = node, g = gain, t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.3);
      n.stop(t + 0.32);
      whoosh(ctx, ctx.destination, t, false);
      node = gain = piGain = null;
    }
    core.classList.remove("is-playing");
  }

  function toggle(core) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {                       // very old browsers: a plain looping <audio>
      if (!fallback) { fallback = new Audio(SRC); fallback.loop = true; }
      if (fallback.paused) { fallback.play().catch(() => {}); core.classList.add("is-playing"); }
      else { fallback.pause(); fallback.currentTime = 0; core.classList.remove("is-playing"); }
      return;
    }
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume();
    want = !(node || want);
    if (!want) { stop(core); return; }
    load().then(() => { if (want && !node) play(core); }).catch(() => { loading = null; want = false; });
  }

  function start() {
    const core = document.querySelector(".orbit-core");
    if (!core) return;
    core.addEventListener("click", () => { if (!core.dataset.justDragged) toggle(core); });
    // the volume follows the digits of π as they are computed
    document.addEventListener("pi:digit", e => {
      if (piGain && ctx) piGain.gain.setTargetAtTime(level(+e.detail), ctx.currentTime, 0.012);
    });
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
