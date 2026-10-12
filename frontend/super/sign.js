// super/sign.js: every super carries its graphical sign, the same signs SuperAI is written with (owner, 2026-10-12:
// "super has a graphical sign (■ square, ● dot, ◆ diamond, ✦ sparkle, ▣ holder, ⟶ wire); put the super graphical sign
// in the app"). The sign follows the super's shape: its n (hold shift + scroll) picks ✦ below 0.85, ◆ below 1.7,
// ● below 2.6 and ■ from there; a super that holds supers is ▣. It sits left of the lock, at the top centre; a wire
// shows ⟶ while it is selected or hovered (its title).
//
//   SeSign.of(n, holder)   the sign for a shape        SeSign.sweep()   look again at every super
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const SUPERS = ".lv-node[data-id], .orbit-bubble.is-group[data-key], .orbit-panel, .se-project, .orbit-title .se-titlesuper, .orbit-bubble.is-group > .ob-label, .ob-member[data-key]";
  const NAME = { "■": "square", "●": "dot", "◆": "diamond", "✦": "sparkle", "▣": "holder" };
  const of = (n, holder) => holder ? "▣" : n < 0.85 ? "✦" : n < 1.7 ? "◆" : n < 2.6 ? "●" : "■";
  // its n: a Super AI super's data-n, else the k (n = 2^k) set on it by Shift + scroll or its opening, else its CSS shape
  function nOf(el) {
    if (el.dataset.n && isFinite(+el.dataset.n)) return +el.dataset.n;
    for (const v of ["--lv-k", "--se-k-panel", "--se-k-window", "--se-k"]) { const k = parseFloat(el.style.getPropertyValue(v)); if (isFinite(k)) return Math.pow(2, k); }
    const m = (getComputedStyle(el).getPropertyValue("corner-shape") || "").match(/superellipse\(\s*([-\d.]+)/);
    return m ? Math.pow(2, +m[1]) : Math.PI;
  }
  const isHolder = el => el.classList.contains("is-holder") || el.classList.contains("lv-group") || (el.dataset.id === "hold");
  function mark(el) {
    if (el.classList.contains("se-lockhost")) return;
    let b = el.querySelector(":scope > .se-sign");
    if (!b) { b = document.createElement("span"); b.className = "se-sign"; b.setAttribute("aria-hidden", "true"); el.appendChild(b); }
    const s = of(nOf(el), isHolder(el));
    if (b.dataset.g !== s) { b.dataset.g = s; el.dataset.sign = NAME[s]; }   // drawn by CSS, so it is in no super's text
  }
  function wires() {
    document.querySelectorAll(".sl-wire, .wire").forEach(w => {
      if (w.querySelector(":scope > title")) return;
      const t = document.createElementNS("http://www.w3.org/2000/svg", "title"); t.textContent = "⟶ wire"; w.prepend(t);
    });
  }
  let busy = false;
  function sweep() {
    if (!on() || busy) return; busy = true;
    try { document.querySelectorAll(SUPERS).forEach(mark); wires(); } finally { busy = false; }
  }
  let t = 0; const soon = () => { clearTimeout(t); t = setTimeout(sweep, 120); };
  window.addEventListener("wheel", soon, { passive: true, capture: true });
  document.addEventListener("superlink:change", soon);
  setInterval(sweep, 900);
  if (document.readyState !== "loading") setTimeout(sweep, 300); else document.addEventListener("DOMContentLoaded", () => setTimeout(sweep, 300));
  window.SeSign = { of, sweep };
})();
