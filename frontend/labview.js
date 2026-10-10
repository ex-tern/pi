// labview.js — a Functions palette, like LabVIEW's: arithmetic, Boolean,
// comparison and structure nodes. They are dummies for now: pressing one runs
// it once on the two newest digits of π the mark is computing (orbit.js) and
// shows the result, the way a node fires when its inputs arrive. The loops keep
// running on new digits until pressed again.
(function () {
  "use strict";
  const sq = '<svg viewBox="0 0 20 20" aria-hidden="true">';
  const FNS = [
    { k: "add", g: "+", name: "Add", run: (a, b) => a + " + " + b + " = " + (a + b) },
    { k: "sub", g: "−", name: "Subtract", run: (a, b) => a + " − " + b + " = " + (a - b) },
    { k: "mul", g: "×", name: "Multiply", run: (a, b) => a + " × " + b + " = " + (a * b) },
    { k: "div", g: "÷", name: "Divide", run: (a, b) => b ? a + " ÷ " + b + " = " + +(a / b).toFixed(4) : a + " ÷ 0 = NaN" },
    { k: "and", g: "AND", name: "And", run: (a, b) => bits(a) + " AND " + bits(b) + " = " + bits(a & b) },
    { k: "or", g: "OR", name: "Or", run: (a, b) => bits(a) + " OR " + bits(b) + " = " + bits(a | b) },
    { k: "xor", g: "XOR", name: "Exclusive Or", run: (a, b) => bits(a) + " XOR " + bits(b) + " = " + bits(a ^ b) },
    { k: "not", g: "NOT", name: "Not", run: a => "NOT " + bits(a) + " = " + bits(~a & 15) },
    { k: "gt", g: ">", name: "Greater?", run: (a, b) => a + " > " + b + " → " + (a > b ? "T" : "F") },
    { k: "eq", g: "=", name: "Equal?", run: (a, b) => a + " = " + b + " → " + (a === b ? "T" : "F") },
    { k: "for", svg: sq + '<rect x="2.5" y="2.5" width="15" height="15" rx="1"/><text x="4.5" y="9">N</text><text x="4.5" y="16">i</text></svg>', name: "For Loop", loop: "for" },
    { k: "while", svg: sq + '<rect x="2.5" y="2.5" width="15" height="15" rx="1"/><path d="M13.5 13.5a4 4 0 1 1 0-5.5" fill="none"/><path d="M13.6 5.6v3h-3" fill="none"/></svg>', name: "While Loop", loop: "while" },
    { k: "case", svg: sq + '<rect x="2.5" y="2.5" width="15" height="15" rx="1"/><path d="M5 6.5h10" /><text x="7.2" y="14.5">?</text></svg>', name: "Case Structure", run: a => "case " + (a % 2 ? "odd" : "even") + " (" + a + ")" },
  ];
  function bits(n) { return (n & 15).toString(2).padStart(4, "0"); }
  function digits() {
    const d = (window.PiOrbit && window.PiOrbit.piDigits && window.PiOrbit.piDigits()) || "31";
    return [+d[d.length - 2] || 3, +d[d.length - 1] || 1, d.length];
  }

  function build() {
    if (document.querySelector(".lv-palette")) return;
    const pal = document.createElement("aside");
    pal.className = "lv-palette";
    pal.setAttribute("aria-label", "Functions palette");
    let open = false, chosen = false;
    try { const s = localStorage.getItem("lv:open"); if (s !== null) { open = s === "1"; chosen = true; } } catch (_) { /* fine */ }
    pal.innerHTML = '<button type="button" class="lv-head" aria-expanded="false"><span class="lv-title">Functions</span><span class="lv-caret" aria-hidden="true"></span></button>' +
      '<div class="lv-grid" role="group" aria-label="Functions"></div><output class="lv-out" aria-live="polite">Press a node to run it on π</output>';
    const grid = pal.querySelector(".lv-grid"), out = pal.querySelector(".lv-out"), head = pal.querySelector(".lv-head");
    const setOpen = v => { open = v; pal.classList.toggle("is-open", v); head.setAttribute("aria-expanded", String(v)); };
    head.addEventListener("click", () => { chosen = true; setOpen(!open); try { localStorage.setItem("lv:open", open ? "1" : "0"); } catch (_) { /* fine */ } });
    pal.classList.toggle("is-open", open); head.setAttribute("aria-expanded", String(open));

    let looping = null, loopTimer = null, iter = 0;
    function stopLoop() { clearInterval(loopTimer); loopTimer = null; if (looping) looping.classList.remove("is-running"); looping = null; }
    FNS.forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lv-fn lv-" + f.k;
      b.title = f.name;
      b.setAttribute("aria-label", f.name);
      if (f.svg) b.innerHTML = f.svg; else b.textContent = f.g;
      b.addEventListener("click", () => {
        b.classList.remove("fired"); void b.offsetWidth; b.classList.add("fired");
        if (f.loop) {
          if (looping === b) { stopLoop(); out.textContent = f.name + " stopped after " + iter + " iterations"; return; }
          stopLoop(); looping = b; iter = 0; b.classList.add("is-running");
          const N = 10;
          loopTimer = setInterval(() => {
            const [a, c, len] = digits(); iter++;
            if (f.loop === "for") {
              out.textContent = "For i = " + (iter - 1) + " of N = " + N + " · " + a + " + " + c + " = " + (a + c);
              if (iter >= N) { stopLoop(); out.textContent = "For Loop done: N = " + N; }
            } else {
              out.textContent = "While i = " + iter + " · digit " + len + " of π is " + c + (c === 0 ? " → stop" : "");
              if (c === 0) stopLoop();
            }
          }, 400);
          return;
        }
        const [a, c] = digits();
        out.textContent = f.name + ": " + f.run(a, c);
        document.dispatchEvent(new CustomEvent("labview:fire", { detail: { fn: f.k } }));
      });
      grid.appendChild(b);
    });
    document.body.appendChild(pal);
    // unless you chose, it starts open only where it has room beside the diagram
    const roomy = () => {
      pal.classList.add("is-open");
      const r = pal.getBoundingClientRect();
      const hit = [...document.querySelectorAll(".orbit-bubble, .orbit-core, .orbit-pi")].some(b => {
        if (!b.offsetParent) return false;
        const q = b.getBoundingClientRect();
        return !(q.right <= r.left || r.right <= q.left || q.bottom <= r.top || r.bottom <= q.top);
      });
      pal.classList.toggle("is-open", open);
      return !hit;
    };
    const decide = () => { if (!chosen) setOpen(window.innerWidth >= 700 && roomy()); };
    setTimeout(decide, 1200);
    let rt = 0;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(decide, 400); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
