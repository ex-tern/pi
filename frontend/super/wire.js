// super/wire.js — every word, every character, every number can have a connector.
//
// Wiring starts on purpose: from an edge or a port at once, from a piece of text after holding the press
// still for a moment (or with Alt held), so an ordinary drag or text selection never starts a wire by
// accident. A dragged wire snaps to the nearest port or thing within reach. Click a wire to select it and
// press Delete (or double-click it) to remove it. The piece of text is
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
    document.dispatchEvent(new CustomEvent("superlink:change"));      // the diagram (super/nodes.js) recomputes at once
  };
  // sync and condition are one kind of connector, input and output another (owner, 2026-10-12: "connectors sync and
  // condition are same curvy wires and same thing and cannot connect to input/output"): a wire joins two of a kind,
  // or a port and something that is not a port (a super's body, a word); never a sync or condition to an input or output
  const kindOf = an => { const h = an && an.h; if (!h || !h.startsWith("port:")) return null; const m = /(?:^port:|\/)(sync|condition|input|output)$/.exec(h); return m ? (m[1] === "sync" || m[1] === "condition" ? "ctl" : "data") : null; };
  const clash = (a, b) => { const ka = kindOf(a), kb = kindOf(b); return !!(ka && kb && ka !== kb); };
  let links = load().filter(l => l && l.a && l.b && !clash(l.a, l.b));
  // at first, one wire: the title (the site's name) into the site's input port; the bubbles start unconnected
  let fresh = false;
  try { fresh = localStorage.getItem(KEY) === null; } catch (_) { /* private mode */ }
  // a first visit starts with no text wires: the central engine super, wired by its ports, shows "running"
  let svg, drag = null, lastHtml = "", selected = -1;
  const LETTER = /[\p{L}\p{M}'’]/u, DIGIT = /\p{Nd}/u;
  const HOLD_MS = 280;                                              // how long a press on text is held before it wires

  // ---- where a piece of text lives ------------------------------------
  function hostOf(el) {
    if (!el) return null;
    let h;
    if ((h = el.closest(".lv-node"))) return { key: "node:" + h.dataset.id, el: h };
    if ((h = el.closest(".se-port"))) return { key: "port:" + (h.dataset.pid || h.dataset.port), el: h };     // a port: the site's ("input"), a window's or a loop's ("win:k/input"; super/site.js)
    if ((h = el.closest("[data-key]"))) return { key: "k:" + h.dataset.key, el: h };
    if ((h = el.closest(".orbit-panel"))) { const t = h.querySelector(".op-title"); return { key: "w:" + (t ? t.textContent : ""), el: h }; }
    if ((h = el.closest(".orbit-pi"))) return { key: "pi", el: h };
    if ((h = el.closest(".se-project"))) return { key: "project", el: h };   // the project super: a wire end like any super
    if ((h = el.closest(".lv-palette"))) return { key: "palette", el: h };
    if ((h = el.closest(".orbit-title"))) return { key: "title", el: h };
    if ((h = el.closest("[id]"))) return { key: "#" + h.id, el: h };
    return null;
  }
  function hostEl(key) {
    if (key.startsWith("node:")) return document.querySelector('.lv-node[data-id="' + CSS.escape(key.slice(5)) + '"]');
    if (key.startsWith("port:")) return document.querySelector('.se-port[data-pid="' + CSS.escape(key.slice(5)) + '"]');
    if (key.startsWith("k:")) {
      const all = [...document.querySelectorAll('[data-key="' + CSS.escape(key.slice(2)) + '"]')];
      return all.find(e => e.getClientRects().length) || null;
    }
    if (key.startsWith("w:")) return [...document.querySelectorAll(".orbit-panel")].find(p => { const t = p.querySelector(".op-title"); return t && t.textContent === key.slice(2); }) || null;
    if (key === "pi") return document.querySelector(".orbit-pi");
    if (key === "palette") return document.querySelector(".lv-palette");
    if (key === "project") return document.querySelector(".se-project");
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
    // a port: the wire runs right into its sparkle (owner, 2026-10-12: "side wires dont work": short wires between
    // two ports stopped a few px short of both, and looked broken)
    if (an.h && an.h.startsWith("port:")) {
      const pe = hostEl(an.h), dot = pe && (pe.querySelector(".se-port-dot") || pe);
      if (dot && dot.getClientRects().length) { const d = dot.getBoundingClientRect(); return [d.left + d.width / 2, d.top + d.height / 2]; }
    }
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
    // a wire to a compact bubble opens the bubble (super/bubble.js), so its pills show
    [a, b].forEach(an => {
      const el = an && an.h && an.h.startsWith("k:") ? hostEl(an.h) : null, bubble = el && el.closest && el.closest(".orbit-bubble.is-group.is-compact");
      if (bubble && window.SeBubble) window.SeBubble.open(bubble, true);
    });
    const t = intent(endWords(a).concat(endWords(b)));
    if ([a, b].some(an => an && an.h && an.h.startsWith("port:"))) return;   // a wire to a port carries a value, it opens nothing
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
  // deleting a wire cancels what it did (owner, 2026-10-12): the windows it opened close (Live is one), the bubble
  // it opened compacts, and a Super AI super it joined to run stops and shows its question again (super/nodes.js
  // sees it is no longer connected), each once no other wire still does the same
  // the wire from the title into the site's sync is the app's own: removing it resets the app (owner,
  // 2026-10-12): everything kept in this browser (the diagram, the wires, places, sizes, shapes, the view, the
  // edited program) is forgotten and the page starts again as on a first visit
  const isTitleSync = l => l && [l.a, l.b].some(an => an && an.h === "title") && [l.a, l.b].some(an => an && an.h === "port:sync");
  function resetApp() {
    try {
      Object.keys(localStorage).filter(k => /^(lv:|orbit:|se:|superai:|labview)/.test(k)).forEach(k => localStorage.removeItem(k));
    } catch (_) { /* private mode */ }
    const out = document.querySelector(".lv-out"); if (out) out.textContent = "Reset: the app starts again";
    setTimeout(() => location.reload(), 120);
  }
  function unact(l) {
    if (!l) return;
    if (isTitleSync(l) && html.classList.contains("shape-se")) { resetApp(); return; }
    [l.a, l.b].forEach(an => {
      const el = an && an.h && an.h.startsWith("k:") ? hostEl(an.h) : null, bubble = el && el.closest && el.closest(".orbit-bubble.is-group:not(.is-compact)");
      if (!bubble || !window.SeBubble) return;
      const still = links.some(m => [m.a, m.b].some(x => { const e = x && x.h && x.h.startsWith("k:") ? hostEl(x.h) : null; return e && bubble.contains(e); }));
      if (!still) window.SeBubble.open(bubble, false);
    });
    if (window.LabView && window.LabView.unrun) window.LabView.unrun();
    if (!O().close) return;
    const keys = new Set();
    [l.a, l.b].forEach(an => { if (an && !an.loop && an.h && an.h.startsWith("k:")) keys.add(an.h.slice(2)); });
    const t = intent(endWords(l.a).concat(endWords(l.b)));
    if (t && O().keyOfTitle) { const k = O().keyOfTitle(t); if (k) keys.add(k); }
    keys.forEach(k => {
      if (links.some(m => [m.a, m.b].some(an => an && an.h === "k:" + k))) return;
      if (O().close(k)) { const out = document.querySelector(".lv-out"); if (out) out.textContent = "Closed by disconnecting: " + label({ h: "k:" + k, el: 1 }); }
    });
  }

  // ---- one way to delete a wire, for every wire layer -------------------------------------------------
  // On a layer of wires (text wires here, bubble wires in orbit.js, node wires in super/nodes.js): a double click
  // on a wire deletes it; a click selects it (cobalt, .is-sel on its <g>, toggled in place so a redraw between two
  // clicks never loses the double click) and Delete or Backspace removes it, Escape or a click elsewhere lets go.
  //   selectable(svg, remove, pick)   remove(hit): delete the wire of this .wire-hit; pick(hit): toggle the
  //                                   layer's own selection, true when something is selected now
  // The selection survives a redraw: the layer re-applies .is-sel with reselect(svg, isPicked).
  function selectable(svg, remove, pick) {
    let picked = null;
    const mark = () => svg.querySelectorAll(".wire-hit").forEach(h => h.parentElement.classList.toggle("is-sel", h === picked));
    const clear = () => { picked = null; mark(); };
    svg.addEventListener("dblclick", e => { const w = e.target.closest && e.target.closest(".wire-hit"); if (!w) return; e.stopPropagation(); e.preventDefault(); picked = null; remove(w); });
    svg.addEventListener("click", e => {
      const w = e.target.closest && e.target.closest(".wire-hit"); if (!w) return;
      e.stopPropagation();
      picked = pick(w) ? w : null; mark();
      const out = document.querySelector(".lv-out"); if (out && picked) out.textContent = "Wire selected: press Delete to remove it";
    });
    document.addEventListener("pointerdown", e => { if (picked && !(e.target.closest && e.target.closest(".wire-hit"))) { pick(picked); clear(); } }, true);
    document.addEventListener("keydown", e => {
      if (!picked) return;
      const a = document.activeElement;
      if (a && a.matches && a.matches("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopImmediatePropagation(); const w = picked; picked = null; remove(w); }
      else if (e.key === "Escape") { pick(picked); clear(); }
    }, true);
    svg._reselect = () => mark();                                      // after a redraw (new elements): the pick is gone with them
    return { clear };
  }

  // ---- drawing ---------------------------------------------------------
  const se = () => html.classList.contains("shape-se") && window.SeMorph;
  const term = ([x, y]) => se() ? '<path class="wire-term" d="' + window.SeMorph.star(x, y, 4.5, 4.5) + '"/>' : '<rect class="wire-term" x="' + (x - 3) + '" y="' + (y - 3) + '" width="6" height="6"/>';
  // a port on a top or bottom edge (sync, condition) takes its wire vertically
  const vPort = an => { if (!an || !an.h || !an.h.startsWith("port:")) return false; const e = hostEl(an.h); return !!(e && (e.classList.contains("se-port-top") || e.classList.contains("se-port-bottom"))); };
  // a wire at a sync or condition port: one smooth curve, leaving and arriving straight up or down (owner, 2026-10-12:
  // "sync and condition are same curvy wires"): out of a super's top port upward, its bottom port downward; the site's
  // and the main super's ports (the lattice) and ends that are not ports, toward the other end
  const outDir = (an, me, other) => {
    if (vPort(an) && /^port:(node|bubble|win|project)/.test(an.h)) { const e = hostEl(an.h); return e && e.classList.contains("se-port-top") ? -1 : 1; }
    return (other[1] - me[1]) >= 0 ? 1 : -1;
  };
  function ctlCurve(p, q, a, b) {
    const f = v => v.toFixed(1), da = outDir(a, p, q), db = outDir(b, q, p);
    const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
    let c = Math.max(28, dy * 0.45 + dx * 0.2);
    if (da * (q[1] - p[1]) < 0 || db * (p[1] - q[1]) < 0) c = Math.max(c, 70);   // leaving away from the other end: a wider loop
    return "M" + f(p[0]) + "," + f(p[1]) + "C" + f(p[0]) + "," + f(p[1] + da * c) + " " + f(q[0]) + "," + f(q[1] + db * c) + " " + f(q[0]) + "," + f(q[1]);
  }
  function curve(p, q, a, b) {
    // the title's wire into a sync is curvy too (owner, 2026-10-12: "because this line is connected to sync should be
    // curvy"): level out of the title's side, then one smooth bend into the port from above or below; the π digits ride it
    const ta = a && a.h === "title", tb = b && b.h === "title";
    if ((ta && kindOf(b) === "ctl") || (tb && kindOf(a) === "ctl")) {
      const f = v => v.toFixed(1), dx = q[0] - p[0], dy = q[1] - p[1];
      if (ta) { const k = Math.max(30, Math.abs(dy) * 0.9) * (dy >= 0 ? 1 : -1); return "M" + f(p[0]) + "," + f(p[1]) + "C" + f(p[0] + dx * 0.62) + "," + f(p[1]) + " " + f(q[0]) + "," + f(q[1] - k) + " " + f(q[0]) + "," + f(q[1]); }
      const k = Math.max(30, Math.abs(dy) * 0.9) * (dy >= 0 ? -1 : 1);
      return "M" + f(p[0]) + "," + f(p[1]) + "C" + f(p[0]) + "," + f(p[1] - k) + " " + f(q[0] - dx * 0.62) + "," + f(q[1]) + " " + f(q[0]) + "," + f(q[1]);
    }
    if (kindOf(a) === "ctl" || kindOf(b) === "ctl") return ctlCurve(p, q, a, b);
    // side to side (input, output): never curvy (owner, 2026-10-12: "side to side shouldnt be curvy"): out level, one
    // straight run across, in level, with small superellipse corners, as a flow language routes it
    if ((kindOf(a) === "data" || kindOf(b) === "data") && se() && window.SeMorph.wire) return window.SeMorph.wire(p[0], p[1], q[0], q[1], true, null);
    const hz = Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]);
    const into = hz && vPort(b) && !vPort(a) ? "v" : hz && vPort(a) && !vPort(b) ? "v0" : null;
    if (se() && window.SeMorph.wire) return window.SeMorph.wire(p[0], p[1], q[0], q[1], hz, into);
    const c = Math.max(24, (hz ? Math.abs(q[0] - p[0]) : Math.abs(q[1] - p[1])) * 0.5);
    const sx = q[0] >= p[0] ? 1 : -1, sy = q[1] >= p[1] ? 1 : -1;
    return hz ? "M" + p[0] + "," + p[1] + "C" + (p[0] + sx * c) + "," + p[1] + " " + (q[0] - sx * c) + "," + q[1] + " " + q[0] + "," + q[1]
              : "M" + p[0] + "," + p[1] + "C" + p[0] + "," + (p[1] + sy * c) + " " + q[0] + "," + (q[1] - sy * c) + " " + q[0] + "," + q[1];
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const label = an => an.loop ? "the loop" : an.el ? an.h.replace(/^[a-z#]+:?/, "") : "“" + an.t + "”";
  function draw() {
    if (!svg) return;
    let s = "", defs = "";
    // a wire passes behind the supers it does not join (owner, 2026-10-12: "fix the graphics"): each wire is clipped
    // out of every super except those its ends are in (a holder is see-through: wires inside it show)
    const covers = se() ? [...document.querySelectorAll(".orbit-bubble.is-group:not([hidden]), .orbit-panel, .se-project, .lv-node:not(.is-holder)")]
      .filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect()).filter(r => r.width > 8 && r.height > 8) : [];
    const rr = (r, k) => { const x = r.left + 3, y = r.top + 3, w = r.width - 6, h = r.height - 6, c = Math.min(w, h) * k; return "M" + (x + c) + "," + y + "H" + (x + w - c) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + c) + "V" + (y + h - c) + "Q" + (x + w) + "," + (y + h) + " " + (x + w - c) + "," + (y + h) + "H" + (x + c) + "Q" + x + "," + (y + h) + " " + x + "," + (y + h - c) + "V" + (y + c) + "Q" + x + "," + y + " " + (x + c) + "," + y + "Z"; };
    const inR = (r, pt) => pt && pt[0] >= r.left - 4 && pt[0] <= r.right + 4 && pt[1] >= r.top - 4 && pt[1] <= r.bottom + 4;
    let piD = "", piRun = 0;
    links.forEach((l, i) => {
      const ca = centreOf(l.a) || (l.a.loop ? null : undefined), cb = centreOf(l.b) || (l.b.loop ? null : undefined);
      if (ca === undefined || cb === undefined) return;
      const p = endPoint(l.a, cb || [innerWidth / 2, innerHeight / 2]), q = endPoint(l.b, p || ca);
      if (!p || !q) return;
      const p2 = l.a.loop ? endPoint(l.a, q) : p;
      const d = curve(p2, q, l.a, l.b);
      // the π line runs along the title's wire (owner, 2026-10-12: "move this inside this wire"), left to right
      if (se() && isTitleSync(l)) { piD = p2[0] <= q[0] ? d : curve(q, p2, l.b, l.a); piRun = Math.abs(q[0] - p2[0]) - 40; }   // its straight stretch, before the bend
      const cut = covers.filter(r => !inR(r, p2) && !inR(r, q));
      let clip = "";
      if (cut.length) { defs += '<clipPath id="slc' + i + '"><path clip-rule="evenodd" d="M-9999,-9999H99999V99999H-9999Z' + cut.map(r => rr(r, 0.3)).join("") + '"/></clipPath>'; clip = ' clip-path="url(#slc' + i + ')"'; }
      const isPort = an => an && an.h && an.h.startsWith("port:");
      // a control wire (sync, condition) or a data wire (input, output, or one joining supers): data wires are thicker and
      // coloured by the type of what they carry (super/nodes.js typeOfLink)
      const ctl = kindOf(l.a) === "ctl" || kindOf(l.b) === "ctl";
      const innerW = false;   // inside a bubble a wire is a wire like any other (owner, 2026-10-12: "make inside wiring logic and super same as all supers")
      const dataW = !ctl && !innerW && [l.a, l.b].some(an => an && an.h && /^(node:|port:)/.test(an.h));
      const ty = dataW && window.LabView && window.LabView.typeOfLink ? window.LabView.typeOfLink(l.a, l.b) : "none";
      s += '<g class="wire sl-wire' + (ctl ? " sl-ctl" : dataW ? " sl-data" : innerW ? " sl-inner" : "") + (i === selected ? " is-sel" : "") + '"' + (dataW ? ' data-type="' + ty + '"' : "") + clip + '><path class="wire-bed" d="' + d + '"/><path class="wire-flow" d="' + d + '"/>' + (isPort(l.a) ? "" : term(p2)) + (isPort(l.b) ? "" : term(q)) +
           '<path class="wire-hit" data-i="' + i + '" d="' + d + '"><title>' + esc(label(l.a)) + " – " + esc(label(l.b)) + ': double-click to delete</title></path></g>';
    });
    if (drag) {
      if (drag.overRect) s += '<rect class="sl-hover" x="' + (drag.overRect.left - 2) + '" y="' + (drag.overRect.top - 1) + '" width="' + (drag.overRect.width + 4) + '" height="' + (drag.overRect.height + 2) + '" rx="3"/>';
      s += '<path class="wire-temp" d="' + (kindOf(drag.from) === "ctl" ? ctlCurve(drag.p, drag.q, drag.from, { h: "" }) : curve(drag.p, drag.q)) + '"/>';
    }
    if (defs) s = "<defs>" + defs + "</defs>" + s;
    if (se()) s = s.replace(/<title>[\s\S]*?<\/title>/g, "");   // superellipse look: no tooltips on wires (a hover only lights)
    if (s !== lastHtml) { lastHtml = s; svg.innerHTML = s; }
    if (piSvg && piD !== piSvg._d) {
      piSvg._d = piD;
      piSvg.firstChild.setAttribute("d", piD);
      piSvg.dataset.run = Math.max(0, Math.round(piRun));
      piSvg.classList.toggle("is-off", !piD);
      if (window.OrbitPi) window.OrbitPi();                         // the line fitted to the wire's new length
    }
  }
  let piSvg = null;

  // ---- what a point can connect to -------------------------------------
  // a port within reach wins (they are small); then what is under the pointer; then the nearest thing within reach
  const SNAP_PORT = 26, SNAP_THING = 18;
  function nearPort(x, y, except) {
    let best = null;
    const fromKind = except ? kindOf({ h: except }) : null;
    document.querySelectorAll(".se-port").forEach(p => {
      if (!p.getClientRects().length) return;
      const dot = p.querySelector(".se-port-dot") || p, r = dot.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      const key = "port:" + (p.dataset.pid || p.dataset.port);
      if (fromKind && clash({ h: except }, { h: key })) return;          // not a port of the other kind
      if (d <= SNAP_PORT && key !== except && (!best || d < best.d)) best = { d, p, key };
    });
    return best && { anchor: { h: best.key, el: 1 }, rect: best.p.getBoundingClientRect() };
  }
  function nearThing(x, y) {
    let best = null;
    document.querySelectorAll(".orbit-bubble, .orbit-panel, .lv-node").forEach(el => {
      if (!el.getClientRects().length || el.hidden) return;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (d <= SNAP_THING && (!best || d < best.d)) best = { d, el, r };
    });
    if (!best) return null;
    const h = hostOf(best.el);
    return h ? { anchor: { h: h.key, el: 1 }, rect: best.r } : null;
  }
  function targetAt(x, y, fromKey) {
    const port = nearPort(x, y, fromKey);
    if (port) return port;
    const u = unitAt(x, y);
    if (u) return { anchor: u.anchor, rect: rectOf(u.node, u.a, u.b) };
    const el = document.elementFromPoint(x, y);
    const box = el && el.closest(".orbit-bubble, .ob-member, .orbit-panel, .lv-node, .se-project, .orbit-pi, .se-port");
    if (box) { const h = hostOf(box); if (h) return { anchor: { h: h.key, el: 1 }, rect: box.getBoundingClientRect() }; }
    if (O().nearLoop && O().nearLoop(x, y)) return { anchor: { loop: 1 }, rect: null };
    return nearThing(x, y);
  }

  // ---- the edge of a thing: there the pointer wires --------------------
  // Bubbles, windows, nodes, the counter, Live and the title: on their edge (a few pixels either side of
  // the border, the ring for a round ● or a loop) the pointer becomes a wire's end; inside, they keep
  // their own use (moving, pressing, typing).
  const THINGS = ".orbit-bubble, .orbit-panel, .lv-node, .se-project, .orbit-pi, .orbit-title, .se-port";
  const IN = 10, OUT = 9;                                            // wide enough to find without hunting
  // the edge band shrinks with a small super, so a tiny thing is not all edge: about a tenth of its smaller side
  const bands = r => { const k = Math.min(1, Math.min(r.width, r.height) / 56); return { in: Math.max(4, IN * k), out: Math.max(4, OUT * k) }; };
  function edgeAt(x, y) {
    if (!x && !y) return null;
    const v = svg ? svg.style.visibility : "";
    if (svg) svg.style.visibility = "hidden";
    let top;
    try { top = document.elementFromPoint(x, y); } finally { if (svg) svg.style.visibility = v; }
    if (top && top.closest && top.closest(".lv-palette, input, textarea, select, .wire-handle, .op-close, button.orbit-core, .ob-member, .ob-chat, a, .op-head button")) return null;   // a pill or a button keeps its own pointer
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
        if (el.classList.contains("is-loop")) { if (d <= 4 || d > 13) return; }   // a loop: its ring moves it (super/nodes.js), just outside wires
        else { const b = bands(r); if (d > b.out || d < -b.in) return; }
      } else {
        const ins = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        const b = bands(r);
        if (ins) { d = -Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y); if (d < -b.in) return; }
        else { d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)); if (d > b.out) return; }
        const holds = owner && owner.classList.contains("is-holder");   // a super that holds supers is under them, not in their way
        if (!ins && owner && owner !== el && !holds) return;              // just outside it, but over something else
        if (ins && owner && owner !== el && !holds && !owner.contains(el) && !el.contains(owner)) return;   // covered
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
    // the π digits, along the title's wire (a layer of its own: the wires' layer is redrawn whole)
    piSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    piSvg.setAttribute("class", "sl-pi is-off");
    piSvg.setAttribute("aria-hidden", "true");
    piSvg.innerHTML = '<path id="slPiPath" class="om-page-pipath" d=""/><text class="om-page-pi" dy="-8"><textPath href="#slPiPath" startOffset="16"></textPath></text>';
    document.body.appendChild(piSvg);
    const removeWire = i => { if (i < 0 || i >= links.length) return; const gone = links.splice(i, 1)[0]; selected = -1; save(); lastHtml = ""; draw(); unact(gone); };
    selectable(svg, w => removeWire(+w.dataset.i), w => { const i = +w.dataset.i; selected = selected === i ? -1 : i; return selected >= 0; });
    // a drag from a piece of text draws a wire; a click stays a click
    const FIELDS = ".lv-palette, .lv-node, input, textarea, select, [contenteditable], canvas, video";
    const MOVERS = ".orbit-pi, .op-head, .orbit-bubble";                         // dragging these moves them
    // inside a Super AI super (or a holder) its words wire as words on the page do: held, then dragged
    const SUPER_TEXT = ".lv-node.is-holder, .lv-node.is-wrap";
    const owned = t => {
      if (!t.closest) return true;
      const node = t.closest(".lv-node");
      if (node && node.matches(SUPER_TEXT) && !t.closest("input, textarea, select, [contenteditable]")) return false;
      return !!t.closest(FIELDS) || (!t.closest(".ob-member") && !!t.closest(MOVERS));
    };
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
      let g = edgeAt(e.clientX, e.clientY);
      const port = e.target.closest && e.target.closest(".se-port");
      if (port) g = { anchor: { h: "port:" + (port.dataset.pid || port.dataset.port), el: 1 }, rect: port.getBoundingClientRect(), el: port };
      if (g) { e.preventDefault(); e.stopImmediatePropagation(); }       // on an edge (or a port) it wires: the thing does not move
      else if (owned(e.target)) return;
      const u = g ? null : unitAt(e.clientX, e.clientY);
      if (!g && !u) return;
      const x0 = e.clientX, y0 = e.clientY, from = g ? g.anchor : u.anchor;
      // from text: only after holding still a moment (or with Alt), so a drag or a selection stays one
      // on a touch screen an edge waits for the hold too, so a finger scrolling past a bubble or a pill never wires
      // it (and never opens its window); a port wires at once
      let armed = (!!g && (e.pointerType !== "touch" || !!port)) || e.altKey, holdT = 0;
      if (!armed) holdT = setTimeout(() => { armed = true; html.classList.add("sl-armed"); try { window.getSelection().removeAllRanges(); } catch (_) { /* fine */ } }, HOLD_MS);
      const disarm = () => { clearTimeout(holdT); html.classList.remove("sl-armed"); };
      const move = ev => {
        if (!drag) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;      // not yet: it may be a click
          if (!armed) { disarm(); window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", end, true); window.removeEventListener("pointercancel", end, true); return; }   // moved before the hold: an ordinary drag
          const p = endPoint(from, [ev.clientX, ev.clientY]) || [x0, y0];
          drag = { from, p, q: [ev.clientX, ev.clientY], overRect: null };
          html.classList.add("sl-dragging");
          try { window.getSelection().removeAllRanges(); } catch (_) { /* fine */ }
        }
        ev.preventDefault();
        drag.q = [ev.clientX, ev.clientY];
        const o = targetAt(ev.clientX, ev.clientY, from.h);
        drag.overRect = o && o.rect ? o.rect : null;
        html.classList.toggle("wire-target", !!(o && o.anchor.loop));
        draw();
      };
      const end = ev => {
        window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", end, true);
        window.removeEventListener("pointercancel", end, true);
        disarm();
        if (!drag) return;                                                     // it was a click: leave it alone
        eatClick = true; setTimeout(() => { eatClick = false; }, 350);         // the click that ends a wire (it comes a moment later) does nothing
        html.classList.remove("wire-target", "sl-dragging");
        let o = ev.type === "pointerup" ? targetAt(ev.clientX, ev.clientY, from.h) : null;
        drag = null;
        const near = ev.type === "pointerup" ? nearPort(ev.clientX, ev.clientY, null) : null;   // dropped on a port of the other kind: no, even though its super's body is under it
        if (o && (clash(from, o.anchor) || (near && clash(from, near.anchor)))) {                                      // a sync or condition to an input or output: no
          o = null;
          if (window.SeShape && window.SeShape.note) window.SeShape.note(ev.clientX, ev.clientY, "not joined", "sync and condition join only sync or condition; input and output only input or output");
        }
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
    // inside a holder the holder's bare space lies over the wire layers (super/nodes.css), so a click or a double
    // click there is handed to the wire under the point, if there is one: wiring inside a super is the same as
    // outside (owner, 2026-10-12)
    ["click", "dblclick"].forEach(type => document.addEventListener(type, e => {
      if (!e.isTrusted || !document.elementsFromPoint) return;
      const t = e.target;
      if (!(t && t.classList && t.classList.contains("lv-node") && t.classList.contains("is-holder"))) return;
      const hit = document.elementsFromPoint(e.clientX, e.clientY).find(el => el.classList && el.classList.contains("wire-hit"));
      if (!hit) return;
      e.stopImmediatePropagation(); e.preventDefault();
      hit.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
    }, true));
    setInterval(() => { if (document.visibilityState === "visible") draw(); }, 250);
    document.addEventListener("se:frame", draw);                      // super/motion.js: while something moves, every frame
    window.addEventListener("resize", () => { lastHtml = ""; draw(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  // super/nodes.js: a node dropped on a number is wired here; a removed node takes its wires along
  // (onlyIn: just the wires coming into it)
  function add(a, b) {
    if (clash(a, b)) return;
    if (links.some(l => JSON.stringify([l.a, l.b]) === JSON.stringify([a, b]))) return;
    links.push({ a, b }); save(); lastHtml = ""; draw();
  }
  function forget(h, onlyIn) {
    const before = links.length;
    links = links.filter(l => !((l.b && l.b.h === h) || (!onlyIn && l.a && l.a.h === h)));
    if (links.length !== before) { save(); lastHtml = ""; draw(); }
  }
  function removeAt(i) { if (i >= 0 && i < links.length) { links.splice(i, 1); save(); lastHtml = ""; draw(); return true; } return false; }
  window.SuperLink = { links: () => JSON.parse(JSON.stringify(links)), unitAt, add, forget, intent, removeAt, selectable, rectOf: an => (an && !an.loop ? endRect(an) : null) || null };
})();
