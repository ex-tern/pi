// super/hold.js: every super holds supers (owner, 2026-10-12: "make all supers have every supers capabilities").
//
// What a Super AI super grown into a holder could do, every super does: a bubble (compact or open), a window, the
// project super and a holder all hold what sits wholly inside them: Super AI supers, compact bubbles, the project
// super and windows. What is held moves with its host when the host is dragged or laid out elsewhere, is not in
// the host's way, and a double click on a host's bare space makes a Super AI super inside it (super/nodes.js).
// A locked thing stays in the layer it is in: held by its host, it moves with it, and it is never dragged out
// (owner, 2026-10-12: "locking a super also keeps it in place and in its layer of the super its in").
//
//   SeHold.hosts()                 every super that can hold, biggest first
//   SeHold.hostOf(el)              the smallest host holding el wholly (inset by its margin), or null
//   SeHold.heldBy(host)            the elements the host holds right now
//   SeHold.begin(host, opts)       before a drag: remember what the host holds and where it is
//   SeHold.follow(host)            during a drag: move what it holds by how far the host moved since
//   SeHold.shift(host, dx, dy)     move what the host holds by a screen offset (a host laid out elsewhere)
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const HOSTS = ".orbit-bubble.is-group:not([hidden]), .orbit-panel:not(.leaving), .se-project, .lv-node.is-holder";
  const HELD = ".lv-node, .orbit-bubble.is-group:not([hidden]), .se-project, .orbit-panel:not(.leaving)";
  const locked = el => !!(window.SeLock && el && window.SeLock.isLocked(el));
  const rect = el => el.getBoundingClientRect();
  const margin = r => Math.min(r.width, r.height) * 0.03;
  const within = (b, r, k, kt) => b.left >= r.left + k && b.right <= r.right - k && b.top >= r.top + (kt == null ? k : kt) && b.bottom <= r.bottom - k;
  const topStrip = h => h.classList.contains("is-holder") ? 46 : null;   // a holder's lock and name sit at its top
  function hosts() {
    return [...document.querySelectorAll(HOSTS)].filter(h => h.getClientRects().length && !h.classList.contains("is-dragging") && !h.classList.contains("dragging"))
      .map(h => ({ el: h, r: rect(h) })).filter(x => x.r.width > 40 && x.r.height > 40).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  }
  function hostOf(el) {
    if (!on() || !el || !el.getClientRects().length) return null;
    const b = rect(el); let best = null;
    for (const h of hosts()) {
      if (h.el === el || h.el.contains(el) || el.contains(h.el)) continue;
      if (b.width >= h.r.width && b.height >= h.r.height) continue;          // nothing holds what is as big as itself
      const k = margin(h.r), kt = topStrip(h.el);
      if (within(b, h.r, k, kt == null ? k : Math.max(k, kt))) best = h.el;   // hosts come biggest first: the last fit is the smallest
    }
    return best;
  }
  function heldBy(host) {
    if (!on() || !host || !host.getClientRects().length) return [];
    const r = rect(host), k = margin(r), kt = topStrip(host);
    return [...document.querySelectorAll(HELD)].filter(el => el !== host && !host.contains(el) && !el.contains(host) && el.getClientRects().length)
      .filter(el => { const b = rect(el); return b.width < r.width && within(b, r, k, kt == null ? k : Math.max(k, kt)); })
      .filter(el => hostOf(el) === host);                                       // held by this one, not by a smaller host inside it
  }
  // moving what is held: each kind by its own module, by a screen offset
  function move(els, dx, dy) {
    if (!dx && !dy) return;
    const nodes = els.filter(e => e.classList.contains("lv-node")).map(e => e.dataset.id).filter(Boolean);
    if (nodes.length && window.LabView && window.LabView.moveNodes) window.LabView.moveNodes(nodes, dx, dy);
    const bubbles = els.filter(e => e.classList.contains("orbit-bubble")).map(e => e.dataset.key).filter(Boolean);
    if (bubbles.length && window.PiOrbit && window.PiOrbit.moveBubbles) window.PiOrbit.moveBubbles(bubbles, dx, dy);
    if (els.some(e => e.classList.contains("se-project")) && window.SeProject && window.SeProject.moveBy) window.SeProject.moveBy(dx, dy);
    els.filter(e => e.classList.contains("orbit-panel")).forEach(p => {
      p.style.left = (p.offsetLeft + dx) + "px"; p.style.top = (p.offsetTop + dy) + "px"; p.userMoved = true;
      if (p.item && window.PiOrbit && window.PiOrbit.saveWin) window.PiOrbit.saveWin(p.item, p);
    });
    document.dispatchEvent(new CustomEvent("se:frame"));
  }
  const drags = new WeakMap();
  function begin(host, opts) {
    if (!on() || !host) return;
    let held = heldBy(host);
    if (opts && opts.nodes === false) held = held.filter(e => !e.classList.contains("lv-node"));
    const r = rect(host);
    drags.set(host, { held, x: r.left, y: r.top });
  }
  function follow(host) {
    const d = drags.get(host); if (!d || !d.held.length) return;
    const r = rect(host), dx = r.left - d.x, dy = r.top - d.y;
    d.x = r.left; d.y = r.top;
    move(d.held, dx, dy);
  }
  function end(host) { drags.delete(host); }
  function shift(host, dx, dy) { move(heldBy(host), dx, dy); }
  window.SeHold = { hosts: () => hosts().map(h => h.el), hostOf, heldBy, begin, follow, end, shift, move };
})();
