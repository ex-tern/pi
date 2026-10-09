// logosound.js — pressing the PiEN mark (the π logo) plays a song on a
// seamless loop; press again to stop. The file itself is cut so its end
// crossfades into its start, and it plays through Web Audio with the
// encoder's silent padding trimmed, so there is no gap at the loop point.
// The audio loads only on the first press; a drag never counts as a press.
//
// The song runs at 100 BPM, the tempo of π: pi-worker.js emits a digit every
// 60 ms, ten a beat, and the loop is exactly 8 bars (19.2 s = 320 digits).
// On every pass of the loop the digit stream is re-synced to the beat.
(function () {
  "use strict";
  const SRC = "sound/dd.mp3?v=6";
  const LOOP = 19.2;          // seconds: 32 beats at 100 BPM
  const FIRST_BEAT = 0.516;  // seconds into the loop
  const BEAT = 0.6;
  let ctx = null, buf = null, loopStart = 0, loopEnd = 0, node = null, gain = null, loading = null;
  let fallback = null, want = false, syncT = 0;

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

  function play(core) {
    node = ctx.createBufferSource();
    node.buffer = buf;
    node.loop = true;
    node.loopStart = loopStart;
    node.loopEnd = loopEnd;
    gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.05);
    node.connect(gain).connect(ctx.destination);
    const t0 = ctx.currentTime + 0.03;
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
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.12);
      n.stop(t + 0.13);
      node = gain = null;
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
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
