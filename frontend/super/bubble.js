// super/bubble.js: the bubbles (Lab, Library, Tools, Explore, Connect) are expandable supers, like the project
// super (super/project.js). Compact, a bubble is a 104 px squircle with its four ports and a small drawing of
// what it holds: its name as a box on the left, wired to one small box per window on the right. A scroll or a
// pinch on it (super/scroll.js) opens it gradually: it grows step by step into the bubble with its name and pills,
// which can be wired and opened; scrolling back compacts it again. The state is kept per bubble as se:bubble:<key>; the site
// starts with every bubble compact (owner, 2026-10-12).
//
//   SeBubble.zoom(el, dy)      a scroll step on a bubble: in (dy < 0) grows it toward open, out toward compact
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
    return drawing(name, [...el.querySelectorAll(".ob-member")].map(m => m.textContent.trim()), null, parseFloat(getComputedStyle(html).getPropertyValue("--se-compact")) || SIDE);
  }
  function drawing(name, members, cls, side) {
    const n = Math.max(1, members.length), gap = Math.min(4, 36 / n), bh = Math.min(8, (72 - (n - 1) * gap) / n), bw = 20, x1 = 68, total = n * bh + (n - 1) * gap, y0 = (SIDE - total) / 2 - 4;   // clear of the lock at the lower right
    // the name as large as its box lets (a compact bubble is drawn at --se-compact, 84 px or more: readable)
    const px = (side || SIDE) / SIDE, label = name.trim().slice(0, 10), lx = 6, lw = 54, fs = Math.min(13 / px, lw * 0.92 / (0.62 * Math.max(4, label.length))), lh = fs + 8, ly = SIDE / 2 - lh / 2 - 4;   // about 13 px on screen, as large as its box lets
    let s = '<svg class="' + (cls || "ob-mini") + '" viewBox="0 0 ' + SIDE + ' ' + SIDE + '" aria-hidden="true">';
    members.forEach((m, i) => {
      const y = y0 + i * (bh + gap) + bh / 2, x0 = lx + lw, mx = (x0 + x1) / 2, yc = ly + lh / 2;
      s += '<path class="obm-wire" d="M' + x0 + ',' + yc + ' C' + mx + ',' + yc + ' ' + mx + ',' + y + ' ' + x1 + ',' + y + '"/>';
    });
    s += '<rect class="obm-box obm-name" x="' + lx + '" y="' + ly + '" width="' + lw + '" height="' + lh + '" rx="4"/>' +
         '<text class="obm-text" x="' + (lx + lw / 2) + '" y="' + (ly + lh / 2 + fs * 0.36).toFixed(1) + '" text-anchor="middle" style="font-size:' + fs.toFixed(1) + 'px">' + esc(label) + '</text>';
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
    save(el, open ? "open" : "compact"); el._sbT = open ? 1 : 0; el._sbTo = null;
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
  // a scroll on it opens it gradually, as the project super does (owner, 2026-10-12: every super scrolls to
  // expand): each step grows it a little from its compact square toward its open size, the drawing giving way to
  // its name and pills; scrolling back shrinks it the same way. Fully open or fully compact, it settles.
  const natural = el => {                                            // its open size, measured once per opening
    const was = el.classList.contains("is-compact"), w0 = el.style.width, h0 = el.style.height;
    el.classList.remove("is-compact", "is-growing"); el.style.width = ""; el.style.height = "";
    const r = { w: el.offsetWidth, h: el.offsetHeight };
    if (was) el.classList.add("is-compact");
    el.style.width = w0; el.style.height = h0;
    return r;
  };
  function zoom(el, dy) {
    const compactSide = parseFloat(getComputedStyle(html).getPropertyValue("--se-compact")) || SIDE;
    if (el._sbT == null) el._sbT = isCompact(el) ? 0 : 1;
    if (!el._sbNat || (el._sbT === 0 || el._sbT === 1)) el._sbNat = natural(el);
    const tTo = Math.max(0, Math.min(1, (el._sbTo != null ? el._sbTo : el._sbT) - dy * 0.004));
    if (tTo === (el._sbTo != null ? el._sbTo : el._sbT)) return;
    el._sbTo = tTo;
    // every step glides (owner, 2026-10-12: no sudden movement): the steps of one gesture become one motion
    if (window.SeMotion) { const s = { v: el._sbT }; window.SeMotion.glide("bubble:t:" + (el.dataset.key || ""), s, "v", tTo, 160, () => { at(el, s.v, compactSide); }); return; }
    at(el, tTo, compactSide);
  }
  function at(el, t, compactSide) {
    if (t === el._sbT) return;
    el._sbT = t;
    if (el._sbTo != null && Math.abs(t - el._sbTo) < 0.001) el._sbTo = null;
    const n = el._sbNat, w = compactSide + (n.w - compactSide) * t, h = compactSide + (n.h - compactSide) * t;
    if (t >= 0.999) {                                                // open
      el._sbT = 1; el._sbTo = null;
      el.classList.remove("is-compact", "is-growing"); el.style.width = ""; el.style.height = ""; el.style.removeProperty("--sb-t");
      save(el, "open"); relayout(el); return;
    }
    if (t <= 0.001) {                                                // compact
      el._sbT = 0; el._sbTo = null;
      el.classList.remove("is-growing"); el.classList.add("is-compact"); el.style.width = ""; el.style.height = ""; el.style.removeProperty("--sb-t");
      redraw(el); save(el, "compact"); relayout(el); return;
    }
    if (!el.classList.contains("is-growing")) { el.classList.remove("is-compact"); el.classList.add("is-growing"); redraw(el); }
    el.style.width = w.toFixed(1) + "px"; el.style.height = h.toFixed(1) + "px";
    el.style.setProperty("--sb-t", t.toFixed(3));
    clearTimeout(el._sbLay); el._sbLay = setTimeout(() => relayout(el), 120);   // the others make room once it settles a little
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
  // on a phone a window takes most of the inner super: an open bubble compacts when one opens, so nothing is squeezed
  // past readable (a scroll opens it again)
  document.addEventListener("se:windows", () => {
    if (!on() || window.innerWidth >= 700 || !document.querySelector(".orbit-panel")) return;
    document.querySelectorAll(".orbit-bubble.is-group[data-key]:not(.is-compact)").forEach(el => setOpen(el, false, true));
  });
  // the drawing is drawn for the compact side (its name about 13 px on screen): drawn again when that changes
  let sideWas = 0;
  setInterval(() => {
    if (!on()) return;
    const side = parseFloat(getComputedStyle(html).getPropertyValue("--se-compact")) || SIDE;
    if (side === sideWas) return;
    sideWas = side;
    document.querySelectorAll(".orbit-bubble.is-group.is-compact, .orbit-bubble.is-group.is-growing").forEach(redraw);
  }, 700);
  window.SeBubble = { zoom, open: (el, open) => setOpen(el, open, true), isCompact, start, drawing };
  const boot = () => { if (!start()) setTimeout(boot, 200); };
  if (window.PiOrbit) boot(); else document.addEventListener("orbit:ready", boot, { once: true });
  setTimeout(boot, 1500);
})();
