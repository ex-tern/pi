// super/boot.js: the page appears once it has settled (owner, 2026-10-12: things should not jerk when the page is
// refreshed). Until then (html.se-boot, set before the first paint in index.html) only the light behind the glass
// shows; when the supers have stopped moving (the same boxes for several frames in a row, the fonts in, the
// layout ready) or at the latest after MAX ms (0.5 s: owner, 2026-10-13 "reduce the 2.6 second delay to 0.5"), everything fades in together.
(function () {
  "use strict";
  const html = document.documentElement;
  if (!html.classList.contains("se-boot")) return;
  const MAX = 500, STILL = 4, t0 = 0;                    // counted from the page request itself, not from this script
  let ready = false, last = "", still = 0;
  document.addEventListener("orbit:ready", () => { ready = true; });
  let fonts = !document.fonts;
  if (document.fonts) document.fonts.ready.then(() => { fonts = true; });
  const SEL = ".orbit-bubble.is-group:not([hidden]), .lv-node, .orbit-title, .se-project";
  function snap() {
    let s = "";
    document.querySelectorAll(SEL).forEach(e => { const r = e.getBoundingClientRect(); s += (r.left | 0) + "," + (r.top | 0) + "," + (r.width | 0) + "," + (r.height | 0) + ";"; });
    return s;
  }
  let done = false;
  function unveil() {
    if (done) return; done = true;
    try { if (window.SeLegible) window.SeLegible.check(); } catch (e) { console.error("legible check", e); }   // text too small to read is hidden before anything shows; a failure never keeps the page veiled
    html.classList.add("se-unveil");
    html.classList.remove("se-boot");
    setTimeout(() => html.classList.remove("se-unveil"), 400);
  }
  // whatever happens (frames paused in a background tab, an error elsewhere), the page shows (owner, 2026-10-12: a blank page)
  setTimeout(unveil, Math.max(0, MAX + 200 - performance.now()));
  function frame() {
    if (done) return;
    const now = performance.now();
    if (now - t0 > MAX) return unveil();
    if (ready && fonts && (!window.SeEngine || window.SeEngine.ready || now - t0 > 300)) {
      const s = snap();
      still = s && s === last ? still + 1 : 0; last = s;
      if (still >= STILL) return unveil();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
