// logosound.js — pressing the PiEN mark (the π logo) plays a song on a
// seamless loop; press again to stop. The file itself is cut so its end
// crossfades into its start, and it plays through Web Audio with the
// encoder's silent padding trimmed, so there is no gap at the loop point.
// The audio loads only on the first press; a drag never counts as a press.
(function () {
  "use strict";
  const SRC = "sound/dd.mp3?v=3";
  let ctx = null, buf = null, loopStart = 0, loopEnd = 0, node = null, gain = null, loading = null;
  let fallback = null, want = false;

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
      .then(b => { buf = b; [loopStart, loopEnd] = edges(b); });
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
    node.start(0, loopStart);
    core.classList.add("is-playing");
  }

  function stop(core) {
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
