// unigyro.js — Unigyro, in the Lab bubble.
//
// Unigyro II is Murtaza Vefadar's single-seater robot vehicle. This window
// plays his video of it and credits him, with links to his channel. The video
// is his; Pi Tech Lab only embeds it. The player (YouTube's privacy-enhanced
// domain) loads only once the window is opened.
(function () {
  "use strict";
  const VIDEO = "QHxpu1xufFc";
  const WATCH = "https://www.youtube.com/watch?v=" + VIDEO;
  const CHANNEL = "https://www.youtube.com/@MortezaVafadar";
  const content = document.createElement("div");
  content.className = "unigyro";
  content.innerHTML =
    '<h2>Unigyro II</h2>' +
    '<p class="ug-lede">A single-seater robot vehicle, by <b>Murtaza Vefadar</b>.</p>' +
    '<div class="ug-video"><div class="ug-placeholder">The video loads when this window opens.</div></div>' +
    '<p class="ug-credit">Video and project © Murtaza Vefadar. ' +
    '<a href="' + WATCH + '" target="_blank" rel="noopener">Watch on YouTube ↗</a> · ' +
    '<a href="' + CHANNEL + '" target="_blank" rel="noopener">His channel ↗</a> · ' +
    'He is also the author of <span class="ug-quvi">QuVI</span>, in this Lab.</p>';
  const box = content.querySelector(".ug-video");
  function loadPlayer() {
    if (box.querySelector("iframe")) return;
    const f = document.createElement("iframe");
    f.src = "https://www.youtube-nocookie.com/embed/" + VIDEO + "?rel=0";
    f.title = "Unigyro II: Single-Seater Robot Vehicle, by Murtaza Vefadar";
    f.allow = "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    f.referrerPolicy = "strict-origin-when-cross-origin";
    f.allowFullscreen = true;
    f.loading = "lazy";
    box.innerHTML = ""; box.appendChild(f);
  }
  function start() {
    window.PiOrbit.addPill({ key: "lab:Unigyro", section: { key: "lab", name: "Lab" }, title: "Unigyro", content, inGroup: "Lab" });
    const q = content.querySelector(".ug-quvi");
    q.addEventListener("click", () => window.PiOrbit.openTitle("QuVI"));
    new MutationObserver(() => { if (content.closest(".orbit-panel")) loadPlayer(); })
      .observe(document.body, { childList: true });
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
