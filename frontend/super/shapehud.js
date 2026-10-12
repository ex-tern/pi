// super/shapehud.js: Shift + scroll, the way a super's shape (its n) changes (owner, 2026-10-12: "improve the
// shift+scroll experience").
//
//   SeShape.step(key, cur, dy, lo, hi)   the next n for the super `key` from a scroll of dy: smooth (a wheel's big
//                                        steps are evened out), and with soft detents at the shapes worth landing on
//                                        (n = 1 diamond, 2 circle, π the look's own, 4 and 8): passing one, it rests
//                                        there for a little more scroll before going on
//   SeShape.show(x, y, n)                the readout beside the pointer: a drawing of the shape, its n and its name
//
// Every Shift + scroll setter (super/site.js shapeEl, super/nodes.js reshape, super/loop.js scrollN and scrollSiteN)
// goes through step and shows the readout.
(function () {
  "use strict";
  const DETENTS = [1, 2, Math.PI, 4, 8];
  const HOLD = 0.16;                                  // how much scroll (in log n) a detent holds before letting go
  const raw = new Map();                              // key -> { v: the unsnapped n, t: last step }
  let bounds = { lo: 0, hi: Infinity };
  function step(key, cur, dy, lo, hi) {
    const now = performance.now();
    let r = raw.get(key);
    if (!r || now - r.t > 900) r = { v: cur };        // a new gesture starts from where the shape is
    r.t = now;
    const d = Math.max(-140, Math.min(140, dy));       // a wheel's notch and a trackpad's stream feel alike
    r.v = Math.min(hi, Math.max(lo, r.v * Math.exp(-d * 0.0018)));
    raw.set(key, r);
    bounds = { lo, hi };                              // the readout says 0 and ∞ at the ends
    // the detent: within HOLD of a notable n, the shape rests on it
    const L = Math.log(r.v);
    for (const k of DETENTS) if (Math.abs(L - Math.log(k)) < HOLD / 2) return k;
    return r.v;
  }
  // at the ends of its range a super is, for all you can see, the limit: n → 0 (a cross) and n → ∞ (a box)
  const atZero = n => n <= bounds.lo * 1.001, atInf = n => n >= bounds.hi * 0.999;
  function nameOf(n) {
    if (atZero(n)) return "cross";
    if (atInf(n)) return "box";
    if (n < 0.85) return "star";
    if (Math.abs(n - 1) < 0.02) return "diamond";
    if (n < 1.7) return "rounded diamond";
    if (Math.abs(n - 2) < 0.02) return "circle";
    if (Math.abs(n - Math.PI) < 0.02) return "squircle (π)";
    if (n < 5) return "squircle";
    if (n < 12) return "rounded box";
    return "box";
  }
  function path(n, r) {                               // the superellipse at n, in a 40 × 40 box
    const e = 2 / n, pts = [];
    for (let i = 0; i < 64; i++) {
      const t = i / 64 * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      pts.push((20 + r * Math.sign(c) * Math.pow(Math.abs(c), e)).toFixed(2) + "," + (20 + r * Math.sign(s) * Math.pow(Math.abs(s), e)).toFixed(2));
    }
    return "M" + pts.join("L") + "Z";
  }
  let hud = null, hideT = 0;
  function show(x, y, n) {
    if (!hud) {
      hud = document.createElement("div");
      hud.className = "se-shapehud"; hud.setAttribute("aria-live", "polite");
      hud.innerHTML = '<span class="sh-key">shift + scroll</span><svg viewBox="0 0 40 40" aria-hidden="true"><path d=""/></svg><span class="sh-n"></span><span class="sh-name"></span>';
      document.body.appendChild(hud);
    }
    hud.querySelector(".sh-key").textContent = "shift + scroll";
    hud.querySelector("path").setAttribute("d", atZero(n) ? "M20,5L20,35M5,20L35,20" : atInf(n) ? "M5,5H35V35H5Z" : path(n, 15));
    hud.querySelector(".sh-n").textContent = atZero(n) ? "n → 0" : atInf(n) ? "n → ∞" : "n = " + (n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
    hud.querySelector(".sh-name").textContent = nameOf(n);
    hud.classList.toggle("at-detent", DETENTS.some(k => Math.abs(n - k) < 1e-9));
    const W = window.innerWidth, H = window.innerHeight, w = hud.offsetWidth || 170, h = hud.offsetHeight || 48;
    hud.style.left = Math.min(W - w - 8, Math.max(8, x + 18)) + "px";
    hud.style.top = Math.min(H - h - 8, Math.max(8, y + 18)) + "px";
    hud.classList.add("show");
    clearTimeout(hideT); hideT = setTimeout(() => hud.classList.remove("show"), 1100);
  }
  let px = window.innerWidth / 2, py = window.innerHeight / 2;
  document.addEventListener("pointermove", e => { px = e.clientX; py = e.clientY; }, { passive: true, capture: true });
  document.addEventListener("wheel", e => { px = e.clientX; py = e.clientY; }, { passive: true, capture: true });
  // Shift + drag (super/shiftsize.js): the same readout with the super's width and height
  function size(x, y, w, h) {
    show(x, y, Math.PI);
    hud.querySelector("path").setAttribute("d", "M" + (20 - 15 * Math.min(1, w / Math.max(w, h))) + "," + (20 - 15 * Math.min(1, h / Math.max(w, h))) + "h" + (30 * Math.min(1, w / Math.max(w, h))) + "v" + (30 * Math.min(1, h / Math.max(w, h))) + "h" + (-30 * Math.min(1, w / Math.max(w, h))) + "Z");
    hud.querySelector(".sh-key").textContent = "shift + drag";
    hud.querySelector(".sh-n").textContent = w + " × " + h;
    hud.querySelector(".sh-name").textContent = "width × height";
    hud.classList.remove("at-detent");
  }
  // a note in the same place (a locked super: its size and n are kept)
  function note(x, y, what, why) {
    show(x, y, Math.PI);
    hud.querySelector(".sh-key").textContent = what;
    hud.querySelector("path").setAttribute("d", "M13,19V14a7,7 0 0 1 14,0V19M10,19H30V33H10Z");
    hud.querySelector(".sh-n").textContent = "";
    hud.querySelector(".sh-name").textContent = why;
    hud.classList.remove("at-detent");
  }
  window.SeShape = { step, show, at: n => show(px, py, n), size, note, nameOf, DETENTS };
})();
