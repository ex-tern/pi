// superlink.js — every word, every character, every number can have a connector.
//
// The Connect node in the Functions palette (or Escape, to leave) switches
// connect mode on. In it, the piece of text under the pointer lights up:
//   a word                 letters together ("Analytics")
//   a number               digits together ("1,549" counts as "1" "549"; up to 12 digits)
//   a character            a symbol (+, ✦, =) or one digit of π (or e, φ, γ), or inside a run over 12 digits
// Drag from it to another word, number or character, to a bubble or window, or
// to the main loop, and a wire joins them. Click a wire to disconnect it.
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
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(links)); } catch (_) { /* private mode */ } };
  let links = load().filter(l => l && l.a && l.b);
  let on = false, svg, hoverRect = null, drag = null, lastHtml = "";
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
    const c = caretAt(x, y);
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

  // ---- drawing ---------------------------------------------------------
  const se = () => html.classList.contains("shape-se") && window.SeMorph;
  const term = ([x, y]) => se() ? '<path class="wire-term" d="' + window.SeMorph.star(x, y, 4.5, 4.5) + '"/>' : '<rect class="wire-term" x="' + (x - 3) + '" y="' + (y - 3) + '" width="6" height="6"/>';
  function curve(p, q) {
    const hz = Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]);
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
           '<path class="wire-hit" data-i="' + i + '" d="' + d + '"><title>' + esc(label(l.a)) + " – " + esc(label(l.b)) + ': click to disconnect</title></path></g>';
    });
    if (on && hoverRect && !drag) s += '<rect class="sl-hover" x="' + (hoverRect.left - 2) + '" y="' + (hoverRect.top - 1) + '" width="' + (hoverRect.width + 4) + '" height="' + (hoverRect.height + 2) + '" rx="3"/>';
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

  // ---- connect mode ----------------------------------------------------
  function setOn(v) {
    on = v; html.classList.toggle("sl-on", v); hoverRect = null;
    if (toggle) { toggle.classList.toggle("is-running", v); toggle.setAttribute("aria-pressed", String(v)); }
    const out = document.querySelector(".lv-out");
    if (out) out.textContent = v ? "Connect: drag from any word, number or character to another, to a bubble or to the loop. Esc to stop" : "Connect mode off";
    draw();
  }
  let toggle = null;
  function addToggle() {
    const grid = document.querySelector(".lv-palette .lv-grid");
    if (!grid || grid.querySelector(".lv-link")) return !!grid;
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "lv-fn lv-link";
    toggle.title = "Connect: wire any word, number or character";
    toggle.setAttribute("aria-label", "Connect mode: wire any word, number or character");
    toggle.setAttribute("aria-pressed", "false");
    toggle.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 14C8 14 12 6 16 6" fill="none"/><path d="M4 11.5 6.5 14 4 16.5 1.5 14Z" fill="currentColor" stroke="none"/><path d="M16 3.5 18.5 6 16 8.5 13.5 6Z" fill="currentColor" stroke="none"/></svg>';
    toggle.addEventListener("click", e => { e.stopPropagation(); setOn(!on); });
    grid.appendChild(toggle);
    return true;
  }

  function start() {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "sl-layer");
    svg.setAttribute("aria-hidden", "true");
    document.body.appendChild(svg);
    svg.addEventListener("click", e => {
      const w = e.target.closest && e.target.closest(".wire-hit");
      if (!w) return;
      e.stopPropagation();
      links.splice(+w.dataset.i, 1); save(); lastHtml = ""; draw();
    });
    // in connect mode the page's own clicks and drags wait; text, bubbles and the loop become wire ends
    const mine = t => t.closest && (t.closest(".lv-palette") || t.closest(".sl-layer .wire-hit"));
    document.addEventListener("pointermove", e => {
      if (!on || drag) return;
      const t = targetAt(e.clientX, e.clientY);
      hoverRect = t && t.rect && !t.anchor.el ? t.rect : null;
      draw();
    }, true);
    document.addEventListener("pointerdown", e => {
      if (!on || e.button !== 0 || mine(e.target)) return;
      const t = targetAt(e.clientX, e.clientY);
      e.preventDefault(); e.stopPropagation();
      if (!t) return;
      const p = endPoint(t.anchor, [e.clientX, e.clientY]) || [e.clientX, e.clientY];
      drag = { from: t.anchor, p, q: [e.clientX, e.clientY], overRect: null };
      const move = ev => {
        drag.q = [ev.clientX, ev.clientY];
        const o = targetAt(ev.clientX, ev.clientY);
        drag.overRect = o && o.rect ? o.rect : null;
        html.classList.toggle("wire-target", !!(o && o.anchor.loop));
        draw();
      };
      const end = ev => {
        window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", end, true);
        window.removeEventListener("pointercancel", end, true);
        html.classList.remove("wire-target");
        const o = ev.type === "pointerup" ? targetAt(ev.clientX, ev.clientY) : null;
        const from = drag.from; drag = null;
        if (o && JSON.stringify(o.anchor) !== JSON.stringify(from) &&
            !links.some(l => JSON.stringify([l.a, l.b]) === JSON.stringify([from, o.anchor]) || JSON.stringify([l.a, l.b]) === JSON.stringify([o.anchor, from]))) {
          links.push({ a: from, b: o.anchor }); save();
        }
        lastHtml = ""; draw();
      };
      window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", end, true);
      window.addEventListener("pointercancel", end, true);
    }, true);
    // swallow the click that ends a connect gesture (and any other click) so nothing opens
    document.addEventListener("click", e => { if (on && !mine(e.target)) { e.preventDefault(); e.stopPropagation(); } }, true);
    document.addEventListener("dblclick", e => { if (on && !mine(e.target)) { e.preventDefault(); e.stopPropagation(); } }, true);
    document.addEventListener("keydown", e => { if (on && e.key === "Escape") setOn(false); });
    const tryToggle = () => { if (!addToggle()) setTimeout(tryToggle, 300); };
    tryToggle();
    setInterval(() => { if (document.visibilityState === "visible") draw(); }, 250);
    window.addEventListener("resize", () => { lastHtml = ""; draw(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.SuperLink = { links: () => JSON.parse(JSON.stringify(links)), on: () => on, set: setOn, unitAt };
})();
