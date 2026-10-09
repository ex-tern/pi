// logosound.js — pressing the PiEN mark (the π logo) plays a short song.
// Press again while it plays to stop it. The audio loads only on the first
// press, and a drag of the mark never counts as a press.
(function () {
  "use strict";
  let audio = null;

  function toggle(core) {
    if (!audio) {
      audio = new Audio("sound/dd.mp3?v=2");
      audio.addEventListener("ended", () => core.classList.remove("is-playing"));
      audio.addEventListener("pause", () => core.classList.remove("is-playing"));
      audio.addEventListener("play", () => core.classList.add("is-playing"));
    }
    if (!audio.paused) { audio.pause(); audio.currentTime = 0; return; }
    audio.currentTime = 0;
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
  }

  function start() {
    const core = document.querySelector(".orbit-core");
    if (!core) return;
    core.addEventListener("click", () => { if (!core.dataset.justDragged) toggle(core); });
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
