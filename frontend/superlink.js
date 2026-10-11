// superlink.js — every word, every character, every number can have a connector.
//
// Wiring is what the mouse does by default: drag from a piece of text and a
// wire follows the pointer (a plain click still clicks). The piece is
//   a word                 letters together ("Analytics")
//   a number               digits together ("1,549" counts as "1" "549"; up to 12 digits)
//   a character            a symbol (+, ✦, =) or one digit of π (or e, φ, γ), or inside a run over 12 digits
// Drop it on another word, number or character, on a bubble, window or node,
// or on the main loop, and a wire joins them. Click a wire to disconnect it.
// Text inside things that move when dragged (bubbles, window title bars, the
// π counter), in fields, nodes and the palette keeps its own behaviour.
//
// Wiring also says what you mean: when the words at the two ends of a new wire
// together name a window ("Assess" wired to "Manuscripts"), that window opens.
//
// Each end is remembered by where it lives and which occurrence it is (the
// 2nd "Analytics" in that window), so the wire comes back after a reload and
// whenever its window is open again. Kept in this browser as "orbit:textwires".
(function () {
  "use strict";
  const KEY = "orbit:textwires";
  const html = document.documentElement;
  const O = () => window.PiOrbit || {};
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (_) { return []; } };
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(links)); } catch (_) { /* private mode */ }
    document.dispatchEvent(new CustomEvent("superlink:change"));      // the diagram (labview.js) recomputes at once
  };
  let links = load().filter(l => l && l.a && l.b);
  let svg, drag = null, lastHtml = "";
  const LETTER = /[\p{L}\p{M}'’]/u, DIGIT = /\p{Nd}/u;

  // ---- where a piece of text lives ------------------------------------
  function hostOf(el) {
    if (!el) return null;
    let h;
    if ((h = el.closest(".lv-node"))) return { key: "node:" + h.dataset.id, el: h };
    if ((h = el.closest("[data-key]"))) return { key: "k:" + h.dataset.key, el: h };
    if ((h = el.closest(".orbit-panel"))) { const t = h.querySelector(".op-title"); return { key: "w:" + (t ? t.textContent : ""), el: h }; }
    if ((h = el.closest(".orbit-pi"))) return { key: "pi", el: h };
    if ((h = el.closest(".live-body"))) return { key: "live", el: h };
    if ((h = el.closest(".lv-palette"))) return { key: "palette", el: h };
    if ((h = el.closest(".orbit-title"))) return { key: "title", el: h };
    if ((h = el.closest("[id]"))) return { key: "#" + h.id, el: h };
    return null;
  }
  function hostEl(key) {
    if (key.startsWith("node:")) return document.querySelector('.lv-node[data-id="' + CSS.escape(key.slice(5)) + '"]');
    if (key.startsWith("k:")) {
      const all = [...document.querySelectorAll('[data-key="' + CSS.escape(key.slice(2)) + '"]')];
      return all.find(e => e.getClientRects().length) || null;
    }
    if (key.startsWith("w:")) return [...document.querySelectorAll(".orbit-panel")].find(p => { const t = p.querySelector(".op-title"); return t && t.textContent === key.slice(2); }) || null;
    if (key === "pi") return document.querySelector(".orbit-pi");
    if (key === "live") return document.querySelector(".live-dock.open .live-body");
    if (key === "palette") return document.querySelector(".lv-palette");
    if (key === "title") return document.querySelector(".orbit-title");
    if (key.startsWith("#")) return document.getElementById(key.slice(1));
    return null;
  }
  const textNodes = el => {
    const out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    let n; while ((n = w.nextNode())) { if (!n.parentElement.closest("script, style, input, textarea")) out.push(n); }
    return out;
  };

  // ---- the piece of text at a point ------------------------------------
  function caretAt(x, y) {
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p && { node: p.offsetNode, off: p.offset }; }
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); return r && { node: r.startContainer, off: r.startOffset }; }
    return null;
  }
  function rectOf(node, a, b) { const r = document.createRange(); r.setStart(node, a); r.setEnd(node, b); return r.getBoundingClientRect(); }
  const inside = (r, x, y, pad) => r.width && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  function unitAt(x, y) {
    const v = svg ? svg.style.visibility : "";                  // look through the wires to the text under them
    if (svg) svg.style.visibility = "hidden";
    let c;
    try { c = caretAt(x, y); } finally { if (svg) svg.style.visibility = v; }
    if (!c || !c.node || c.node.nodeType !== 3) return null;
    const node = c.node, t = node.data;
    if (node.parentElement.closest(".sl-layer, script, style, input, textarea")) return null;
    // the caret sits between characters: take the character the point is actually over
    let i = -1;
    for (const k of [c.off, c.off - 1]) if (k >= 0 && k < t.length && inside(rectOf(node, k, k + 1), x, y, 2)) { i = k; break; }
    if (i < 0 || /\s/.test(t[i])) return null;
    let a = i, b = i + 1, type = "c";
    if (LETTER.test(t[i])) {
      while (a > 0 && LETTER.test(t[a - 1])) a--;
      while (b < t.length && LETTER.test(t[b])) b++;
      type = "w";
    } else if (DIGIT.test(t[i]) && !node.parentElement.closest(".op-digits, .nb-digits")) {   // π and friends' digits: one at a time
      let a2 = i, b2 = i + 1;
      while (a2 > 0 && DIGIT.test(t[a2 - 1])) a2--;
      while (b2 < t.length && DIGIT.test(t[b2])) b2++;
      if (b2 - a2 <= 12) { a = a2; b = b2; type = "w"; }       // a number; inside a long run (π's digits), one digit
    }
    const host = hostOf(node.parentElement);
    if (!host) return null;
    const text = t.slice(a, b);
    // which occurrence of this piece in its host
    let occ = 0;
    for (const n of textNodes(host.el)) {
      const hits = matches(n.data, text, type);
      if (n === node) { occ += hits.filter(s => s < a).length; break; }
      occ += hits.length;
    }
    return { anchor: { h: host.key, t: text, y: type, o: occ }, node, a, b };
  }
  // where a piece occurs in a string: as a whole word or number ("w"), or as a character ("c")
  function matches(str, text, type) {
    const out = [];
    for (let k = str.indexOf(text); k >= 0; k = str.indexOf(text, k + 1)) {
      if (type === "w") {
        const before = str[k - 1], after = str[k + text.length], cls = LETTER.test(text[0]) ? LETTER : DIGIT;
        if ((before && cls.test(before)) || (after && cls.test(after))) continue;
      }
      out.push(k);
    }
    return out;
  }
  // ---- where an end is now ---------------------------------------------
  function endRect(an) {
    if (an.loop) return null;
    const el = hostEl(an.h);
    if (!el || !el.getClientRects().length) return undefined;
    if (an.el) return el.getBoundingClientRect();
    let occ = an.o;
    for (const n of textNodes(el)) {
      const hits = matches(n.data, an.t, an.y);
      if (occ < hits.length) {
        const r = rectOf(n, hits[occ], hits[occ] + an.t.length);
        // a digit scrolled out of its box (π's long line) has no visible place
        const box = n.parentElement.getBoundingClientRect();
        if (!r.width || r.right < box.left - 1 || r.left > box.right + 1) return undefined;
        return r;
      }
      occ -= hits.length;
    }
    return undefined;
  }
  function endPoint(an, toward) {
    if (an.loop) return O().loopPoint ? O().loopPoint(toward[0], toward[1]) : null;
    const r = endRect(an);
    if (!r) return null;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (!toward) return [cx, cy];
    // out of the side facing the other end, or the bottom/top for something straight above or below
    const dx = toward[0] - cx, dy = toward[1] - cy;
    return Math.abs(dx) > Math.abs(dy) * 1.2 ? [dx > 0 ? r.right + 2 : r.left - 2, cy] : [cx, dy > 0 ? r.bottom + 1 : r.top - 1];
  }
  const centreOf = an => { if (an.loop) return null; const r = endRect(an); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null; };

  // ---- intent: what the words at a wire's ends mean together -------------
  // Each word must start like a word of the window's title (see alike), and at least two of the title's words must be
  // named. The best covered title wins; on a tie, the shorter one.
  const wordsOf = t => (String(t || "").match(/[\p{L}\p{N}]+/gu) || []).map(w => w.toLowerCase()).filter(w => w.length >= 3);
  // alike: the same word, or sharing their first letters (≥ 4, and most of the shorter word):
  // "manuscriptic" ~ "manuscripts", "assess" ~ "assessment"; "assess" ≁ "assist"
  const alike = (a, b) => {
    if (a === b) return true;
    let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
    return k >= 4 && k >= Math.min(a.length, b.length) * 0.75;
  };
  function intent(words) {
    const ws = [...new Set(words.flatMap(wordsOf))];
    if (ws.length < 2) return null;
    const titles = O().pillTitles ? O().pillTitles() : [];
    let best = null;
    titles.forEach(title => {
      const tw = wordsOf(title);
      if (tw.length < 2) return;
      if (!ws.every(w => tw.some(x => alike(w, x)))) return;          // every wired word belongs to the title
      const named = tw.filter(x => ws.some(w => alike(w, x))).length;
      if (named < 2) return;
      const score = named / tw.length;
      if (!best || score > best.score || (score === best.score && title.length < best.title.length)) best = { title, score };
    });
    return best && best.title;
  }
  const endWords = an => an.loop ? [] : an.el ? [an.h.replace(/^[a-z#]+:?/, "").replace(/^[a-z]+:/, "")] : [an.t];
  function act(a, b) {
    const t = intent(endWords(a).concat(endWords(b)));
    if (!t || !O().openTitle) {                                   // no window named together: a window's button at either end opens it
      const ks = [b, a].filter(an => an && !an.loop && an.h && an.h.startsWith("k:"));
      const k = ks.find(an => !/ group$/.test(an.h)) || ks[0];          // a window's own button before its group
      if (k && O().openKey && O().openKey(k.h.slice(2))) { const out = document.querySelector(".lv-out"); if (out) out.textContent = "Opened by wiring: " + label(k); }
      return;
    }
    if (O().openTitle(t)) {
      const out = document.querySelector(".lv-out");
      if (out) out.textContent = "Opened " + t + ": you wired " + label(a) + " to " + label(b);
    }
  }

  // disconnecting undoes it: a window whose button (or words) the removed wire touched closes,
  // once no other wire still touches it
  function unact(l) {
    if (!l || !O().close) return;
    const keys = new Set();
    [l.a, l.b].forEach(an => { if (an && !an.loop && an.h && an.h.startsWith("k:")) keys.add(an.h.slice(2)); });
    const t = intent(endWords(l.a).concat(endWords(l.b)));
    if (t && O().keyOfTitle) { const k = O().keyOfTitle(t); if (k) keys.add(k); }
    keys.forEach(k => {
      if (links.some(m => [m.a, m.b].some(an => an && an.h === "k:" + k))) return;
      if (O().close(k)) { const out = document.querySelector(".lv-out"); if (out) out.textContent = "Closed by disconnecting: " + label({ h: "k:" + k, el: 1 }); }
    });
  }

  // ---- drawing ---------------------------------------------------------
  const se = () => html.classList.contains("shape-se") && window.SeMorph;
  const term = ([x, y]) => se() ? '<path class="wire-term" d="' + window.SeMorph.star(x, y, 4.5, 4.5) + '"/>' : '<rect class="wire-term" x="' + (x - 3) + '" y="' + (y - 3) + '" width="6" height="6"/>';
  function curve(p, q) {
    const hz = Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]);
    if (se() && window.SeMorph.wire) return window.SeMorph.wire(p[0], p[1], q[0], q[1], hz);
    const c = Math.max(24, (hz ? Math.abs(q[0] - p[0]) : Math.abs(q[1] - p[1])) * 0.5);
    const sx = q[0] >= p[0] ? 1 : -1, sy = q[1] >= p[1] ? 1 : -1;
    return hz ? "M" + p[0] + "," + p[1] + "C" + (p[0] + sx * c) + "," + p[1] + " " + (q[0] - sx * c) + "," + q[1] + " " + q[0] + "," + q[1]
              : "M" + p[0] + "," + p[1] + "C" + p[0] + "," + (p[1] + sy * c) + " " + q[0] + "," + (q[1] - sy * c) + " " + q[0] + "," + q[1];
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const label = an => an.loop ? "the loop" : an.el ? an.h.replace(/^[a-z#]+:?/, "") : "“" + an.t + "”";
  function draw() {
    if (!svg) return;
    let s = "";
    links.forEach((l, i) => {
      const ca = centreOf(l.a) || (l.a.loop ? null : undefined), cb = centreOf(l.b) || (l.b.loop ? null : undefined);
      if (ca === undefined || cb === undefined) return;
      const p = endPoint(l.a, cb || [innerWidth / 2, innerHeight / 2]), q = endPoint(l.b, p || ca);
      if (!p || !q) return;
      const p2 = l.a.loop ? endPoint(l.a, q) : p;
      const d = curve(p2, q);
      s += '<g class="wire sl-wire"><path class="wire-bed" d="' + d + '"/><path class="wire-flow" d="' + d + '"/>' + term(p2) + term(q) +
           '<path class="wire-hit" data-i="' + i + '" d="' + d + '"><title>' + esc(label(l.a)) + " – " + esc(label(l.b)) + ': double-click to delete</title></path></g>';
    });
    if (drag) {
      if (drag.overRect) s += '<rect class="sl-hover" x="' + (drag.overRect.left - 2) + '" y="' + (drag.overRect.top - 1) + '" width="' + (drag.overRect.width + 4) + '" height="' + (drag.overRect.height + 2) + '" rx="3"/>';
      s += '<path class="wire-temp" d="' + curve(drag.p, drag.q) + '"/>';
    }
    if (s !== lastHtml) { lastHtml = s; svg.innerHTML = s; }
  }

  // ---- what a point can connect to -------------------------------------
  function targetAt(x, y) {
    const u = unitAt(x, y);
    if (u) return { anchor: u.anchor, rect: rectOf(u.node, u.a, u.b) };
    const el = document.elementFromPoint(x, y);
    const box = el && el.closest(".orbit-bubble, .ob-member, .orbit-panel, .lv-node, .live-body, .orbit-pi");
    if (box) { const h = hostOf(box); if (h) return { anchor: { h: h.key, el: 1 }, rect: box.getBoundingClientRect() }; }
    if (O().nearLoop && O().nearLoop(x, y)) return { anchor: { loop: 1 }, rect: null };
    return null;
  }

  // ---- the edge of a thing: there the pointer wires --------------------
  // Bubbles, windows, nodes, the counter, Live and the title: on their edge (a few pixels either side of
  // the border, the ring for a round ● or a loop) the pointer becomes a wire's end; inside, they keep
  // their own use (moving, pressing, typing).
  const THINGS = ".orbit-bubble, .orbit-panel, .lv-node, .orbit-pi, .live-body, .orbit-title";
  const IN = 6, OUT = 5;
  function edgeAt(x, y) {
    if (!x && !y) return null;
    const v = svg ? svg.style.visibility : "";
    if (svg) svg.style.visibility = "hidden";
    let top;
    try { top = document.elementFromPoint(x, y); } finally { if (svg) svg.style.visibility = v; }
    if (top && top.closest && top.closest(".lv-palette, input, textarea, select, .wire-handle, .op-close, button.orbit-core")) return null;
    const owner = top && top.closest && top.closest(THINGS);
    let best = null;
    const near = el => {
      if (!el.getClientRects().length || el.hidden) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      let d;
      if (el.classList.contains("lv-dot")) {                              // round: its ring
        const R = r.width / 2, c = Math.hypot(x - (r.left + R), y - (r.top + r.height / 2));
        d = c - R;
        if (el.classList.contains("is-loop")) { if (d <= 4 || d > 13) return; }   // a loop: its ring moves it (labview.js), just outside wires
        else if (d > OUT || d < -IN) return;
      } else {
        const ins = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        if (ins) { d = -Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y); if (d < -IN) return; }
        else { d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)); if (d > OUT) return; }
        if (!ins && owner && owner !== el) return;                        // just outside it, but over something else
        if (ins && owner && owner !== el && !owner.contains(el) && !el.contains(owner)) return;   // covered
      }
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { el, d };
    };
    document.querySelectorAll(THINGS).forEach(near);
    if (!best) return null;
    const h = hostOf(best.el);
    return h ? { anchor: { h: h.key, el: 1 }, rect: best.el.getBoundingClientRect(), el: best.el } : null;
  }

  function start() {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "sl-layer");
    svg.setAttribute("aria-hidden", "true");
    document.body.appendChild(svg);
    svg.addEventListener("dblclick", e => {
      const w = e.target.closest && e.target.closest(".wire-hit");
      if (!w) return;
      e.stopPropagation();
      const gone = links.splice(+w.dataset.i, 1)[0]; save(); lastHtml = ""; draw();
      unact(gone);
    });
    // a drag from a piece of text draws a wire; a click stays a click
    const FIELDS = ".lv-palette, .lv-node, input, textarea, select, [contenteditable], canvas, video";
    const MOVERS = ".orbit-pi, .op-head, .orbit-bubble";                         // dragging these moves them
    const owned = t => !t.closest || !!t.closest(FIELDS) || (!t.closest(".ob-member") && !!t.closest(MOVERS));
    let eatClick = false;
    document.addEventListener("click", e => { if (eatClick) { eatClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
    // the pointer shows when it is on an edge
    let edgeEl = null;
    document.addEventListener("pointermove", e => {
      if (drag || e.buttons || html.classList.contains("lv-dragging")) return;
      const g = edgeAt(e.clientX, e.clientY), el = g ? g.el : null;
      if (el === edgeEl) return;
      if (edgeEl) edgeEl.classList.remove("sl-edge-on");
      edgeEl = el; html.classList.toggle("sl-edge", !!el);
      if (el) el.classList.add("sl-edge-on");
    }, true);
    document.addEventListener("pointerdown", e => {
      if (e.button !== 0 || drag) return;
      const g = edgeAt(e.clientX, e.clientY);
      if (g) { e.preventDefault(); e.stopImmediatePropagation(); }       // on an edge it wires: the thing does not move
      else if (owned(e.target)) return;
      const u = g ? null : unitAt(e.clientX, e.clientY);
      if (!g && !u) return;
      const x0 = e.clientX, y0 = e.clientY, from = g ? g.anchor : u.anchor;
      const move = ev => {
        if (!drag) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;      // not yet: it may be a click
          const p = endPoint(from, [ev.clientX, ev.clientY]) || [x0, y0];
          drag = { from, p, q: [ev.clientX, ev.clientY], overRect: null };
          html.classList.add("sl-dragging");
          try { window.getSelection().removeAllRanges(); } catch (_) { /* fine */ }
        }
        ev.preventDefault();
        drag.q = [ev.clientX, ev.clientY];
        const o = targetAt(ev.clientX, ev.clientY);
        drag.overRect = o && o.rect ? o.rect : null;
        html.classList.toggle("wire-target", !!(o && o.anchor.loop));
        draw();
      };
      const end = ev => {
        window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", end, true);
        window.removeEventListener("pointercancel", end, true);
        if (!drag) return;                                                     // it was a click: leave it alone
        eatClick = true; setTimeout(() => { eatClick = false; }, 350);         // the click that ends a wire (it comes a moment later) does nothing
        html.classList.remove("wire-target", "sl-dragging");
        const o = ev.type === "pointerup" ? targetAt(ev.clientX, ev.clientY) : null;
        drag = null;
        if (o && JSON.stringify(o.anchor) !== JSON.stringify(from) &&
            !links.some(l => JSON.stringify([l.a, l.b]) === JSON.stringify([from, o.anchor]) || JSON.stringify([l.a, l.b]) === JSON.stringify([o.anchor, from]))) {
          links.push({ a: from, b: o.anchor }); save();
          act(from, o.anchor);
        }
        lastHtml = ""; draw();
      };
      window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", end, true);
      window.addEventListener("pointercancel", end, true);
    }, true);
    // a double click on wires lying on top of each other (a bubble wire and a text wire, say) deletes them all,
    // so a wire never seems to survive its double click
    document.addEventListener("dblclick", e => {
      if (!e.isTrusted || !document.elementsFromPoint) return;
      const hits = document.elementsFromPoint(e.clientX, e.clientY).filter(el => el.classList && el.classList.contains("wire-hit"));
      if (hits.length < 2) return;
      const seen = new Set([hits[0].ownerSVGElement]);
      hits.slice(1).forEach(h => { if (seen.has(h.ownerSVGElement)) return; seen.add(h.ownerSVGElement); h.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: e.clientX, clientY: e.clientY })); });
    }, true);
    setInterval(() => { if (document.visibilityState === "visible") draw(); }, 250);
    window.addEventListener("resize", () => { lastHtml = ""; draw(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  // labview.js: a node dropped on a number is wired here; a removed node takes its wires along
  // (onlyIn: just the wires coming into it)
  function add(a, b) {
    if (links.some(l => JSON.stringify([l.a, l.b]) === JSON.stringify([a, b]))) return;
    links.push({ a, b }); save(); lastHtml = ""; draw();
  }
  function forget(h, onlyIn) {
    const before = links.length;
    links = links.filter(l => !((l.b && l.b.h === h) || (!onlyIn && l.a && l.a.h === h)));
    if (links.length !== before) { save(); lastHtml = ""; draw(); }
  }
  function removeAt(i) { if (i >= 0 && i < links.length) { links.splice(i, 1); save(); lastHtml = ""; draw(); return true; } return false; }
  window.SuperLink = { links: () => JSON.parse(JSON.stringify(links)), unitAt, add, forget, intent, removeAt, rectOf: an => (an && !an.loop ? endRect(an) : null) || null };
})();
