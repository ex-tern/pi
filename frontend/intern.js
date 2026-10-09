// intern.js — the Intern pill, inside the Tools bubble.
//
// Intern is a separate project: an iOS app, an AI electronic health record
// for doctors. It runs on iPhone, not in a browser, so its window says what it
// is and links to its source.
(function () {
  "use strict";
  const content = document.createElement("div");
  content.className = "intern";
  content.innerHTML =
    '<h2>Intern</h2>' +
    '<p class="in-lede">An AI electronic health record for doctors: an iOS app.</p>' +
    '<ul class="in-points">' +
    '<li><b>Records and chat.</b> Patient records with a built-in messaging interface.</li>' +
    '<li><b>Calls and notifications.</b> Calling and push notifications through Azure Communication Services.</li>' +
    '<li><b>Sync and sign-in.</b> Firebase for accounts, storage and real-time data.</li>' +
    '</ul>' +
    '<p class="in-note">Intern runs on iPhone and iPad (iOS 13 or later), not in the browser, so it is not live here.</p>' +
    '<p><a class="btn btn-outline" href="https://github.com/in-tern/Intern" target="_blank" rel="noopener">Source on GitHub ↗</a></p>';
  function start() {
    window.PiOrbit.addPill({ key: "assess:Intern", section: { key: "assess", name: "Tools" }, title: "Assist Diagnosis [Intern]", content, inGroup: "Tools" });
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
