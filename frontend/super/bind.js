// super/bind.js: supers synced to a holder stay inside it (owner, 2026-10-12: "these supers stay inside its loop no
// matter how you resize it or zoom it, nothing gets out because they are synced together").
//
// A holder (a Super AI super grown into a holder, like the third super) binds every super its sync reaches by control
// wires: a wire from its sync or condition into another super's sync makes that super its member, and so on down
// (Explore's condition into Lab's sync binds Lab to the holder Explore is bound to); a member that is itself a holder
// keeps its own. Members never leave: dragged out or pushed out they glide back in, and as the holder shrinks they
// re-form into its new shape: each keeps its place in proportion and scales with it, as small as the holder goes.
//
//   SeBind.members(holder)    the elements bound to a holder
//   SeBind.need(holder)       { w, h }: the room its members take now, or null
//   SeBind.enforce()          move any member that is out back inside its holder
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const ownerOf = h => {                                               // a port anchor's super, as "node:<id>", "bubble:<key>", "project", "win:<key>"
    const m = h && /^port:(node:[^/]+|bubble:[^/]+|win:[^/]+|project)\/(\w+)$/.exec(h);
    return m ? { owner: m[1], port: m[2] } : null;
  };
  function elOf(owner) {
    if (owner.startsWith("node:")) return document.querySelector('.lv-node[data-id="' + CSS.escape(owner.slice(5)) + '"]');
    if (owner.startsWith("bubble:")) return [...document.querySelectorAll('.orbit-bubble.is-group[data-key="' + CSS.escape(owner.slice(7)) + '"]')].find(e => e.getClientRects().length) || null;
    if (owner === "project") return document.querySelector(".se-project");
    if (owner.startsWith("win:")) return window.PiOrbit && window.PiOrbit.elOf ? window.PiOrbit.elOf(owner.slice(4)) : null;
    return null;
  }
  // the control graph: parent owner -> child owners (a wire from a sync or condition into a sync)
  function graph() {
    const L = window.SuperLink && window.SuperLink.links ? window.SuperLink.links() : [], kids = new Map();
    L.forEach(l => {
      const a = ownerOf(l.a && l.a.h), b = ownerOf(l.b && l.b.h);
      if (!a || !b || a.owner === b.owner) return;
      const ctl = p => p === "sync" || p === "condition";
      if (!ctl(a.port) || !ctl(b.port)) return;
      // into a sync: the other end is the parent; both syncs: the wire's start is the parent
      let par = null, kid = null;
      if (b.port === "sync") { par = a.owner; kid = b.owner; } else if (a.port === "sync") { par = b.owner; kid = a.owner; }
      if (!par) return;
      (kids.get(par) || kids.set(par, []).get(par)).push(kid);
    });
    return kids;
  }
  const isHolder = el => !!(el && el.classList.contains("lv-node") && el.classList.contains("is-holder"));
  function members(holder) {
    if (!on() || !isHolder(holder)) return [];
    const kids = graph(), me = "node:" + holder.dataset.id, out = [], seen = new Set([me]), q = [me];
    while (q.length) {
      const o = q.shift();
      (kids.get(o) || []).forEach(k => {
        if (seen.has(k)) return; seen.add(k);
        const el = elOf(k); if (!el || !el.getClientRects().length || el.contains(holder)) return;
        out.push(el);
        if (!isHolder(el)) q.push(k);                                   // a member holder keeps its own members
      });
    }
    return out;
  }
  const fitK = () => Math.max(0.25, Math.min(1, (window.PiOrbit && window.PiOrbit.fit && window.PiOrbit.fit().f) || 1));
  // the room inside a holder: a small margin, and its top strip (lock and name), both in proportion to it when it is small
  function inner(r) { const k = Math.min(r.width, r.height) * 0.035 + Math.min(4, r.width * 0.02), top = Math.min(46 * fitK(), r.height * 0.065); return { l: r.left + k, t: r.top + Math.max(k, top), r: r.right - k, b: r.bottom - k, pad: 2 * k, top: Math.max(k, top) + k }; }
  function need(holder) {
    const ms = members(holder); if (!ms.length) return null;
    const rs = ms.map(e => e.getBoundingClientRect());
    const w = Math.max(...rs.map(b => b.right)) - Math.min(...rs.map(b => b.left)), h = Math.max(...rs.map(b => b.bottom)) - Math.min(...rs.map(b => b.top));
    const r = holder.getBoundingClientRect(), i = inner(r);
    return { w: w + i.pad + 4, h: h + i.top + 4 };
  }
  // the holder resized (owner, 2026-10-12: "the holder can shrink as small as it can... the members form into the new
  // shape"): each member keeps its place in the holder as a share of it (across and down apart), and its size scales
  // with the holder (by the smaller of the two, so a bubble stays a square). The place is kept as a share, so putting
  // it there again is always the same answer: nothing drifts, whoever else moves things
  let state = new WeakMap();                                             // holder -> { w, h (unzoomed), at: Map(member -> [sx, sy]) }
  // a member's width on screen set to `sw` (its height in its own proportion): absolute, so many small steps of a
  // resize never compound
  function sizeTo(el, sw) {
    const b = el.getBoundingClientRect(); if (!b.width || !sw) return;
    const k = Math.max(0.05, sw / b.width); if (Math.abs(k - 1) < 0.01) return;
    if (el.classList.contains("lv-node") && window.LabView && window.LabView.rectOf && window.LabView.setRect) {
      const r = window.LabView.rectOf(el); if (r) window.LabView.setRect(el, r.x, r.y, r.w * k, r.h * k);
    } else if (el.classList.contains("orbit-bubble")) {
      const w = el.offsetWidth * k, h = el.offsetHeight * k;
      el.style.width = w + "px"; el.style.height = h + "px"; el.classList.add("se-sized");
      const key = el.dataset.key; if (key) try { localStorage.setItem("se:size:" + key + (el.classList.contains("is-compact") ? "" : ":open"), JSON.stringify({ w, h })); } catch (_) { /* private mode */ }
    } else if (el.classList.contains("se-project") && window.SeProject && window.SeProject.resize) {
      window.SeProject.resize(sw / fitK(), sw * (b.height / b.width) / fitK());   // its size is kept unzoomed (project.js draws it times the zoom)
    }
  }
  const shareOf = (el, r, i) => {                                        // its centre and width in shares of the holder, kept within its room
    const b = el.getBoundingClientRect();
    const x = Math.max(i.l + b.width / 2, Math.min(i.r - b.width / 2, b.left + b.width / 2)), y = Math.max(i.t + b.height / 2, Math.min(i.b - b.height / 2, b.top + b.height / 2));
    return [(x - r.left) / r.width, (y - r.top) / r.height, b.width / r.width];
  };
  function putAt(el, tx, ty) {
    // a bubble glides to its new place: it is measured again only once that glide is over (else each correction is
    // added to the last and they swing)
    if (el._bindT && performance.now() - el._bindT < 900 * ((window.SeMotion && window.SeMotion.SLOW) || 1)) return;
    const b = el.getBoundingClientRect(), dx = tx - (b.left + b.width / 2), dy = ty - (b.top + b.height / 2);
    if (Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) return;
    el._bindT = performance.now();
    if (el.classList.contains("orbit-bubble") && el.dataset.key && window.PiOrbit && window.PiOrbit.placeBubble) window.PiOrbit.placeBubble(el.dataset.key, tx, ty);
    else window.SeHold.move([el], dx, dy);
  }
  const held = new Set();                                                // members being dragged now: theirs, not ours
  // nothing is checked while a load or reset is settling, nor for a moment after (positions are not final yet)
  let busyAt = performance.now();
  function enforce() {
    if (!on() || !window.SeHold) return;
    if (html.classList.contains("se-boot") || html.classList.contains("se-unveil")) { busyAt = performance.now(); return; }
    if (performance.now() - busyAt < 2500) return;
    if (html.classList.contains("se-chain-dragging")) return;
    document.querySelectorAll(".lv-node.is-holder").forEach(h => {
      if (h.classList.contains("is-dragging") || !h.getClientRects().length) return;
      // its members: the supers its sync reaches, and (owner, 2026-10-13: "supers can dynamically get smaller or bigger if
      // they are inside a super that restricts them from going out") whatever it holds by being inside it (super/hold.js),
      // kept once taken in until you drag it out yourself: they all scale and move with it, so nothing gets out
      const wired = members(h), st0 = state.get(h);
      const kept = st0 ? [...st0.at.keys()].filter(e => e.isConnected && e.getClientRects().length && !wired.includes(e) && !e.contains(h)) : [];
      const geo = window.SeHold.heldBy ? window.SeHold.heldBy(h).filter(e => e && e.matches && e.matches(".orbit-bubble.is-group, .lv-node, .se-project") && !wired.includes(e) && !e.contains(h)) : [];
      const ms = [...new Set([...wired, ...kept, ...geo])]; if (!ms.length) { state.delete(h); return; }
      const r = h.getBoundingClientRect(), sc = parseFloat(h.style.scale) || 1, w = r.width / sc, hh = r.height / sc, i = inner(r);
      let st = state.get(h);
      if (!st) { st = { w, h: hh, at: new Map() }; state.set(h, st); }
      // a new member (owner, 2026-10-12: "this should put connect inside the third super"): where it is if it is inside
      // already; else it takes the other members' size when it is bigger, and the first free spot inside
      ms.forEach(el => {
        if (st.at.has(el)) return;
        const b = el.getBoundingClientRect(), inside = b.left >= i.l && b.right <= i.r && b.top >= i.t && b.bottom <= i.b;
        if (inside || st.at.size === 0) { st.at.set(el, shareOf(el, r, i)); return; }
        const others = ms.filter(o => o !== el && st.at.has(o)).map(o => o.getBoundingClientRect());
        const typ = others.length ? others.reduce((m, o) => m + o.width, 0) / others.length : r.width * 0.25;
        let w = b.width, hgt = b.height;
        if (w > typ * 1.05 || w > (i.r - i.l) * 0.5) { const k = Math.min(typ, (i.r - i.l) * 0.5) / w; w *= k; hgt *= k; }
        let best = null;
        for (let gy = 0; gy < 6 && !best; gy++) for (let gx = 0; gx < 8 && !best; gx++) {
          const cx = i.l + w / 2 + (i.r - i.l - w) * gx / 7, cy = i.t + hgt / 2 + (i.b - i.t - hgt) * gy / 5;
          const box = { left: cx - w / 2 - 4, right: cx + w / 2 + 4, top: cy - hgt / 2 - 4, bottom: cy + hgt / 2 + 4 };
          if (!others.some(o => o.left < box.right && o.right > box.left && o.top < box.bottom && o.bottom > box.top)) best = [cx, cy];
        }
        if (!best) best = [i.l + (i.r - i.l) / 2, i.t + (i.b - i.t) / 2];
        st.at.set(el, [(best[0] - r.left) / r.width, (best[1] - r.top) / r.height, w / r.width]);
        st.sizedAt = performance.now();                                   // its size goes to its share now
      });
      const resized = Math.abs(w - st.w) > 1 || Math.abs(hh - st.h) > 1;
      if (resized) {                                                     // resized: the members scale with it, to their share of it
        const kw = w / st.w, kh = hh / st.h; st.w = w; st.h = hh;
        ms.forEach(el => { const a = st.at.get(el); if (a && kw !== kh) a[2] *= Math.min(kw, kh) / kw; });   // the smaller of the two: a square stays a square
        st.sizedAt = performance.now();
      }
      // a bubble that is opening, open or filling the inner super is its own (owner, 2026-10-12: "fix this bug": its
      // pills spilled out while its size was held to its share); compact again, it takes its share back
      const busy = el => el.classList.contains("orbit-bubble") && (!el.classList.contains("is-compact") || el.classList.contains("is-growing") || el.classList.contains("se-max"));
      // a member bubble opened in it (owner, 2026-10-12: "this is a bug": it spilled out of a small holder): an unlocked
      // holder grows to take it, its other members keeping their sizes (only their places spread with it)
      const lockedH = !!(window.SeLock && window.SeLock.isLocked(h));
      if (!lockedH && window.LabView && window.LabView.rectOf && window.LabView.setRect) {
        const open = ms.filter(el => busy(el) && !el.classList.contains("se-max"));
        if (open.length) {
          const pad = 10, U = { l: r.left, t: r.top, r: r.right, b: r.bottom };
          open.forEach(el => { const b = el.getBoundingClientRect(); U.l = Math.min(U.l, b.left - pad); U.t = Math.min(U.t, b.top - pad - (i.t - r.top)); U.r = Math.max(U.r, b.right + pad); U.b = Math.max(U.b, b.bottom + pad); });
          // never over a super outside it (owner, 2026-10-12: "3rd super shouldnt eat the connect super when gets bigger")
          const outs = window.SeHold.outsiders ? window.SeHold.outsiders(h) : [];
          const blocked = outs.length && window.SeHold.wouldMeet({ left: U.l, top: U.t, right: U.r, bottom: U.b }, outs);   // then the others still scale with it (below)
          if (!blocked && (U.l < r.left - 1 || U.t < r.top - 1 || U.r > r.right + 1 || U.b > r.bottom + 1)) {
            const L = window.LabView.rectOf(h), k = sc, nw = (U.r - U.l) / k, nh = (U.b - U.t) / k;
            window.LabView.setRect(h, L.x + (U.l - r.left) / k, L.y + (U.t - r.top) / k, nw, nh);
            st.w = nw; st.h = nh;                                         // a growth for it, not a resize: nothing scales
            return;
          }
        }
      }
      // the universal law of room (owner, 2026-10-13: "there should be always 30% empty area in every super"): what a
      // super holds covers at most 70 % of it; more, and its members shrink together (their shares) until 30 % is free
      {
        const area = ms.filter(el => !busy(el) && !el.classList.contains("orbit-panel")).reduce((sum, el) => { const b = el.getBoundingClientRect(); return sum + b.width * b.height; }, 0);
        const A = r.width * r.height;
        if (A > 0 && area > 0.7 * A) { const k = Math.sqrt(0.7 * A / area) * 0.99; ms.forEach(el => { const a = st.at.get(el); if (a && !busy(el)) a[2] *= k; }); st.sizedAt = performance.now(); }
      }
      ms.forEach(el => {                                                 // sizes: to their share while the holder changes; else the share follows them (sized by you)
        if (el.classList.contains("orbit-panel") || held.has(el) || busy(el)) return;
        const a = st.at.get(el); if (!a) return;
        if (performance.now() - (st.sizedAt || 0) < 1500) sizeTo(el, a[2] * r.width);
        else a[2] = el.getBoundingClientRect().width / r.width;
      });
      ms.forEach(el => {
        if (held.has(el) || busy(el) || el.classList.contains("is-dragging") || el.classList.contains("dragging") || el.classList.contains("se-opening")) return;
        const a = st.at.get(el); putAt(el, r.left + a[0] * r.width, r.top + a[1] * r.height);
      });
    });
  }
  // a member you move takes its new place (within its holder: dragged out, it comes back to the nearest place inside)
  document.addEventListener("pointerdown", e => {
    const el = e.target && e.target.closest && e.target.closest(".orbit-bubble.is-group, .lv-node, .se-project");
    if (el && !el.classList.contains("is-holder")) held.add(el);
  }, true);
  document.addEventListener("pointerup", () => setTimeout(() => {
    held.forEach(el => {
      document.querySelectorAll(".lv-node.is-holder").forEach(h => {
        const st = state.get(h); if (!st || !st.at.has(el)) return;
        const r = h.getBoundingClientRect(), e = el.getBoundingClientRect(), cx = e.left + e.width / 2, cy = e.top + e.height / 2;
        // a super it holds only by being inside it goes free when you drag it out; a wired member comes back in
        if (!members(h).includes(el) && (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom)) { st.at.delete(el); return; }
        st.at.set(el, shareOf(el, r, inner(r)));
      });
    });
    held.clear(); enforce();
  }, 120), true);
  let raf = 0;
  const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; enforce(); }); };
  document.addEventListener("se:frame", soon);
  document.addEventListener("superlink:change", soon);
  setInterval(enforce, 500);
  // bound to a holder: then it is never dropped out of the site either (orbit.js, nodes.js, project.js treat it as saved)
  const isBound = el => !!el && [...document.querySelectorAll(".lv-node.is-holder")].some(h => members(h).includes(el));
  // at its smallest a super is a sparkle (owner, 2026-10-12: "minimum size can be a sparkle"): under 22 px it is marked
  // se-sparkle, its icons and words hide, and without the engine it is cut to the sparkle's shape (super.css)
  function sparkles() {
    if (!on()) return;
    document.querySelectorAll(".lv-node, .orbit-bubble.is-group, .se-project, .orbit-panel").forEach(el => {
      if (!el.getClientRects().length) return;
      const r = el.getBoundingClientRect(); el.classList.toggle("se-sparkle", Math.min(r.width, r.height) < 22);
    });
  }
  document.addEventListener("se:frame", () => requestAnimationFrame(sparkles));
  setInterval(sparkles, 400);
  // super/pack.js re-arranged the start: forget every member's place and look again once the glides are over
  function settle() { state = new WeakMap(); busyAt = performance.now() + 1500; }
  window.SeBind = { members, need, enforce, isBound, settle };
})();
