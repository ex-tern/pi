// super/legible.js: a limit on how small text can be (owner, 2026-10-12).
//
// Text drawn smaller than MIN px on screen (a window's content fitted small, a map seen whole, a bubble's pill
// in a small super) is not shown as unreadable type: it becomes a super, a small paper box in the shape language
// (the same kind as the boxes in a compact bubble's drawing). Zoom in (a scroll) and once it is readable the text
// comes back. Inputs and the super being typed into stay text.
//
//   SeLegible.MIN       the smallest readable size on screen, in px
//   SeLegible.check()   look again now (it also looks a few times a second, and after a scroll)
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const MIN = 11;
  // what is scaled on the page: a window's zoomed content, the project's map, the supers, the title
  const ROOTS = ".se-zoomed, .pj-map, .orbit-bubble.is-group";   // the supers' own words (nodes, the title) are set readable
  const SKIP = "input, textarea, select, [contenteditable], script, style, .se-port, .se-lock, .ob-mini";   // a compact super's drawing sets its name readable itself
  const cache = new WeakMap();                                       // root -> { els, at, key }

  const ownText = e => { for (const c of e.childNodes) if (c.nodeType === 3 && c.nodeValue.trim()) return true; return false; };
  function textEls(root) {
    const c = cache.get(root);
    if (c && performance.now() - c.at < 2500) return c;
    const els = [];
    if (ownText(root)) els.push(root);
    root.querySelectorAll("*").forEach(e => { if (ownText(e) && !e.closest(SKIP)) els.push(e); });
    els.forEach(e => { if (!e._seLift) e._seFs = null; });            // type sizes are read again (the layout may have changed them)
    const fresh = { els, at: performance.now(), key: c ? c.key : "" };
    cache.set(root, fresh);
    return fresh;
  }
  // the root's scale on screen: its drawn width over its laid-out width (every transform and scale above it)
  const scaleOf = el => { const w = el.offsetWidth; return w ? el.getBoundingClientRect().width / w : 1; };
  const sizeOf = e => {                                              // its type size, read once (the glyph class leaves it alone)
    if (e._seFs == null) e._seFs = parseFloat(getComputedStyle(e).fontSize) || 14;
    return e._seFs;
  };
  function check() {
    if (!on()) return;
    const typing = document.activeElement;
    document.querySelectorAll(ROOTS).forEach(root => {
      if (root.parentElement && root.parentElement.closest(ROOTS)) return;   // an inner root: its outer root covers it
      if (!root.getClientRects().length) return;
      const c = textEls(root);
      const s = scaleOf(root);
      const key = s.toFixed(3) + ":" + c.els.length + ":" + c.at.toFixed(0);
      if (key === c.key) return;
      c.key = key;
      for (const e of c.els) {
        let px;
        if (e instanceof SVGElement) { const r = e.getBoundingClientRect(); px = r.height / 1.2; }
        else {
          // type set smaller than readable at full size (a chart's axis, a footnote) is lifted to readable, once
          if (sizeOf(e) < MIN && !e._seLift && root.classList.contains("se-zoomed")) { e._seLift = true; e.style.fontSize = MIN + "px"; e._seFs = MIN; }
          px = sizeOf(e) * s;
        }
        const tiny = px > 0 && px < MIN && !(typing && e.contains(typing));
        if (e.classList.contains("se-glyph") !== tiny) e.classList.toggle("se-glyph", tiny);
      }
    });
  }
  let asked = false;
  const soon = () => { if (asked) return; asked = true; requestAnimationFrame(() => { asked = false; check(); }); };
  setInterval(() => { if (document.visibilityState === "visible") check(); }, 300);
  document.addEventListener("wheel", () => setTimeout(soon, 60), { passive: true, capture: true });
  document.addEventListener("se:frame", soon);
  // the smallest type in a piece of content at full size (after lifting): what the readable floor is measured from
  function minFont(root) {
    if (!root) return 14;
    const c = textEls(root);
    let m = Infinity;
    for (const e of c.els) if (!(e instanceof SVGElement)) { if (sizeOf(e) < MIN && root.classList.contains("se-zoomed")) { e._seLift = true; e.style.fontSize = MIN + "px"; e._seFs = MIN; } m = Math.min(m, sizeOf(e)); }
    return m === Infinity ? 14 : m;
  }
  window.SeLegible = { MIN, check, minFont };
})();
