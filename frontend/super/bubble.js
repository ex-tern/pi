// super/bubble.js: the bubbles (Lab, Library, Tools, Explore, Connect) are expandable supers, like the project
// super (super/project.js). Compact, a bubble is a 104 px squircle with its four ports and a small drawing of
// what it holds: its name as a box on the left, wired to one small box per window on the right. A scroll or a
// pinch on it (super/scroll.js) zooms it open: it grows into the bubble with its name and pills, which can be
// wired and opened; zooming out compacts it again. The state is kept per bubble as se:bubble:<key>; the site
// starts with every bubble compact (owner, 2026-10-12).
//
//   SeBubble.zoom(el, dy)      a scroll step on a bubble: in (dy < 0) opens it, out compacts it
//   SeBubble.open(el, open)    set it
//   SeBubble.isCompact(el)
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {};
  const SIDE = 104;
  const key = el => el.dataset.key ? "se:bubble:" + el.dataset.key : null;
  const load = el => { try { return localStorage.getItem(key(el)); } catch (_) { return null; } };
  const save = (el, v) => { try { localStorage.setItem(key(el), v); } catch (_) { /* private mode */ } };
  const isCompact = el => el.classList.contains("is-compact");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // the small drawing: the name's box, wired to one box per pill (drawn in a 104 × 104 box); the project super
  // (super/project.js) is drawn the same way, so every compact super is the same species
  function mini(el) {
    const name = (el.querySelector(":scope > .ob-label") || {}).textContent || "";
    return drawing(name, [...el.querySelectorAll(".ob-member")].map(m => m.textContent.trim()));
  }
  function drawing(name, members, cls) {
    const n = Math.max(1, members.length), gap = 4, bh = 8, bw = 30, x1 = 60, total = n * bh + (n - 1) * gap, y0 = (SIDE - total) / 2;
    const lx = 12, lw = 34, lh = 14, ly = SIDE / 2 - lh / 2;
    let s = '<svg class="' + (cls || "ob-mini") + '" viewBox="0 0 ' + SIDE + ' ' + SIDE + '" aria-hidden="true">';
    members.forEach((m, i) => {
      const y = y0 + i * (bh + gap) + bh / 2, x0 = lx + lw, mx = (x0 + x1) / 2;
      s += '<path class="obm-wire" d="M' + x0 + ',' + (SIDE / 2) + ' C' + mx + ',' + (SIDE / 2) + ' ' + mx + ',' + y + ' ' + x1 + ',' + y + '"/>';
    });
    s += '<rect class="obm-box obm-name" x="' + lx + '" y="' + ly + '" width="' + lw + '" height="' + lh + '" rx="4"/>' +
         '<text class="obm-text" x="' + (lx + lw / 2) + '" y="' + (ly + lh / 2 + 2.6) + '" text-anchor="middle">' + esc(name.trim().slice(0, 9)) + '</text>';
    members.forEach((m, i) => {
      const y = y0 + i * (bh + gap);
      s += '<rect class="obm-box" x="' + x1 + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="2.5"><title>' + esc(m) + '</title></rect>';
    });
    return s + "</svg>";
  }
  function redraw(el) {
    const svg = el.querySelector(":scope > .ob-mini");
    const fresh = mini(el);
    if (svg && svg._sig === fresh) return;                           // the same drawing (outerHTML would re-serialize it differently)
    if (svg) svg.remove();
    el.insertAdjacentHTML("beforeend", fresh);
    const made = el.querySelector(":scope > .ob-mini");
    if (made) made._sig = fresh;
  }

  // the bubble's size as laid out: orbit.js reads offsetWidth / offsetHeight, so the compact box is real
  function relayout(el) {
    if (el.dataset.key && O().prioritize) O().prioritize(el.dataset.key);
    clearTimeout(el._sbRelay);
    el._sbRelay = setTimeout(() => { if (O().layout) O().layout(); }, 40);
  }
  function setOpen(el, open, animate) {
    if (!el || isCompact(el) === !open) return;
    save(el, open ? "open" : "compact");
    const r0 = el.getBoundingClientRect();
    const k = parseFloat(el.style.getPropertyValue("--se-scale")) || 1;   // its size (super/scroll.js), a scale: measured sizes are scaled
    el.classList.toggle("is-compact", !open);
    el.style.width = ""; el.style.height = "";
    redraw(el);
    if (!animate || !window.SeMotion) { relayout(el); return; }
    const w1 = el.offsetWidth, h1 = el.offsetHeight, w0 = r0.width / k, h0 = r0.height / k;
    const s = { v: 0 };
    el.classList.add("is-growing");
    el.style.width = w0 + "px"; el.style.height = h0 + "px";
    window.SeMotion.glide("bubble:" + (el.dataset.key || ""), s, "v", 1, 220, () => {
      const t = s.v;
      el.style.width = (w0 + (w1 - w0) * t).toFixed(1) + "px"; el.style.height = (h0 + (h1 - h0) * t).toFixed(1) + "px";
      el.style.setProperty("--sb-t", t.toFixed(3));
      if (t >= 0.999) { el.style.width = ""; el.style.height = ""; el.classList.remove("is-growing"); el.style.removeProperty("--sb-t"); relayout(el); }
    });
    relayout(el);
  }
  // a scroll on it: a few steps in open it, a few steps out compact it (one gesture at a time, super/scroll.js)
  function zoom(el, dy) {
    el._sbAcc = (el._sbAcc || 0) + dy;
    clearTimeout(el._sbAccT); el._sbAccT = setTimeout(() => { el._sbAcc = 0; }, 500);
    if (el._sbAcc < -60 && isCompact(el)) { el._sbAcc = 0; setOpen(el, true, true); }
    else if (el._sbAcc > 60 && !isCompact(el)) { el._sbAcc = 0; setOpen(el, false, true); }
  }

  function start() {
    if (!on()) return;
    const bubbles = [...document.querySelectorAll(".orbit-bubble.is-group[data-key]")];
    if (!bubbles.length) return false;
    bubbles.forEach(el => {
      if (el.dataset.sbInit) return;
      el.dataset.sbInit = "1";
      const st = load(el);
      const compact = st !== "open";
      if (compact) { el.classList.add("is-compact"); redraw(el); }
      // the pills change as the page learns who can see what: the drawing follows
      new MutationObserver(ms => {                                   // its own drawing changing is not a change of pills
        if (isCompact(el) && ms.some(m => !(m.target.closest && m.target.closest(".ob-mini")) && !m.target.classList?.contains("ob-mini"))) redraw(el);
      }).observe(el, { childList: true, subtree: true, characterData: true });
      // a window opened by wiring (super/wire.js) from a compact bubble opens the bubble too, so the pill shows
    });
    if (O().layout) O().layout();
    return true;
  }
  window.SeBubble = { zoom, open: (el, open) => setOpen(el, open, true), isCompact, start, drawing };
  const boot = () => { if (!start()) setTimeout(boot, 200); };
  if (window.PiOrbit) boot(); else document.addEventListener("orbit:ready", boot, { once: true });
  setTimeout(boot, 1500);
})();
