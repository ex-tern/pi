// super/inner.js: what is inside an open bubble follows the same logic as outside it (owner, 2026-10-12: "make inside
// supers same logic as outside it"; full supers).
//
// An open bubble's name box and its window pills are supers: the engine draws them as glass panes (super/engine.js),
// each has four port sparkles (super/site.js owners name:<bubble> and pill:<key>), a lock and a save icon, its own n by
// hold shift + scroll, and lights up when selected. The soft curves from the name to the pills are real wires now:
// the name's output into each pill's input. Cut one (a double click, or Delete on a selected wire) and that pill is cut:
// it dims and its window does not open until you wire the name's output into its input again. Kept as se:pillcut.
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const KEY = "se:pillcut";
  const load = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch (_) { return new Set(); } };
  const save = s => { try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch (_) { /* private mode */ } };
  let cut = load();
  const SL = () => window.SuperLink;
  const pillIn = k => "port:pill:" + k + "/input", nameOut = b => "port:name:" + b + "/output";
  // the open bubbles and their visible pills
  function open() {
    return [...document.querySelectorAll(".orbit-bubble.is-group[data-key]:not(.is-compact):not(.is-growing)")].filter(b => !b.hidden && b.getClientRects().length)
      .map(b => ({ b, key: b.dataset.key, pills: [...b.querySelectorAll(".ob-members .ob-member[data-key]")].filter(m => m.getClientRects().length) }));
  }
  const linked = (L, k) => L.some(l => (l.a && l.a.h === pillIn(k)) || (l.b && l.b.h === pillIn(k)));
  let before = new Set();                                               // the pills wired into at the last look
  function ensure() {
    if (!on() || !SL() || !SL().links) return;
    const L = SL().links(), now = new Set();
    open().forEach(({ key, pills }) => {
      // its ports are placed by super/site.js once it is open; wire only when they are there
      if (!document.querySelector('.se-port[data-pid="name:' + CSS.escape(key) + '/output"]')) return;
      pills.forEach(m => {
        const k = m.dataset.key;
        if (!document.querySelector('.se-port[data-pid="pill:' + CSS.escape(k) + '/input"]')) return;
        if (linked(L, k)) { now.add(k); return; }
        if (!cut.has(k)) { SL().add({ h: nameOut(key), el: 1 }, { h: pillIn(k), el: 1 }); now.add(k); }
      });
    });
    before = new Set([...before, ...now]);
    mark();
  }
  // a wire into a pill cut: the pill is cut; a wire drawn into it again: it is whole
  function changed() {
    if (!SL() || !SL().links) return;
    const L = SL().links(); let dirty = false;
    open().forEach(({ pills }) => pills.forEach(m => {
      const k = m.dataset.key, has = linked(L, k);
      if (has && cut.has(k)) { cut.delete(k); dirty = true; }
      else if (!has && before.has(k) && !cut.has(k)) { cut.add(k); dirty = true; before.delete(k); }
      if (has) before.add(k);
    }));
    if (dirty) save(cut);
    mark();
  }
  function mark() { document.querySelectorAll(".ob-member[data-key]").forEach(m => m.classList.toggle("is-cut", cut.has(m.dataset.key))); }
  const isCut = key => cut.has(key);
  document.addEventListener("superlink:change", () => setTimeout(changed, 30));
  document.addEventListener("se:frame", () => requestAnimationFrame(ensure));
  setInterval(ensure, 400);
  window.SeInner = { isCut, ensure };
})();
