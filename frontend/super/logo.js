// super/logo.js: the title is a simple super (superellipse look): a ■ at n = π with its four port sparkles and
// "pi tech lab" inside, in the diagram's mono type. It sits in the page's top-left corner (super/loop.js
// seatEdges), moves by a drag (super/move.js), is the Reset view button once the view has changed
// (super/scroll.js), and Shift + scroll changes its n (super/site.js shapeEl → SeLogo.setN).
(function () {
  "use strict";
  const TITLE_N = Math.PI;
  let n = 0;
  function setN(v) {
    n = v;
    const sup = document.querySelector(".orbit-title .se-titlesuper");
    if (sup) sup.style.setProperty("--sts-k", Math.log2(Math.max(0.3, v)).toFixed(4));
  }
  function apply() {
    if (!document.documentElement.classList.contains("shape-se")) return false;
    const t = document.querySelector(".orbit-title");
    if (!t || t.querySelector(".se-titlesuper")) return !!t;
    t.insertAdjacentHTML("afterbegin", '<span class="se-titlesuper" aria-hidden="true"><span class="sts-text">pi tech lab</span>' +
      '<i class="sts-p sts-in"></i><i class="sts-p sts-out"></i><i class="sts-p sts-sync"></i><i class="sts-p sts-cond"></i></span>');
    t.title = "Pi Tech Lab";
    if (n) setN(n);
    if (window.PiOrbit && window.PiOrbit.layout) window.PiOrbit.layout();
    return true;
  }
  // the look is decided before the first paint (index.html), but be safe if the class comes later
  function start() {
    if (apply()) return;
    new MutationObserver((_, mo) => { if (apply()) mo.disconnect(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
  window.SeLogo = { setN, n: () => n || TITLE_N };
})();
