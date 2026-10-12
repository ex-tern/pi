// super/boot.js: the page appears once it has settled (owner, 2026-10-12: things should not jerk when the page is
// refreshed). Until then (html.se-boot, set before the first paint in index.html) only the light behind the glass
// shows; when the supers have stopped moving (the same boxes for several frames in a row, the fonts in, the
// layout ready) or at the latest after MAX ms, everything fades in together, already in place.
(function () {
  "use strict";
  const html = document.documentElement;
  if (!html.classList.contains("se-boot")) return;
  const MAX = 2600, STILL = 8, t0 = performance.now();
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
  function unveil() {
    html.classList.add("se-unveil");
    html.classList.remove("se-boot");
    setTimeout(() => html.classList.remove("se-unveil"), 1100);
  }
  function frame() {
    const now = performance.now();
    if (now - t0 > MAX) return unveil();
    if (ready && fonts && (!window.SeEngine || window.SeEngine.ready || now - t0 > 1200)) {
      const s = snap();
      still = s && s === last ? still + 1 : 0; last = s;
      if (still >= STILL) return unveil();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
