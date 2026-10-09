// pi-worker.js — digits of π, forever, in the background.
//
// Gibbons' unbounded spigot (2006): exact integer arithmetic with BigInt, so
// every digit it emits is final. It never needs to know in advance how many
// digits are wanted; it simply keeps going while the page stays open, and
// each digit costs a little more than the last. Paced so the number visibly
// grows instead of racing ahead.
//
// The pace follows what the site is processing ({pace: ms}, sent by orbit.js
// from /api/activity): slow while it is quiet, fast while papers are being
// assessed. The schedule corrects its own drift, and a {sync: true, delay}
// message restarts it.
// {pause: true} stops it where it is; {resume: true} carries on.
let q = 1n, r = 0n, t = 1n, k = 1n, n = 3n, l = 3n;
let count = 0;
let PACE_MS = 60;       // set by the page from what the site is processing ({pace})
let due = 0, timer = 0;

function next() {
  for (;;) {
    if (4n * q + r - t < n * t) {
      const d = n;
      const nr = 10n * (r - n * t);
      n = (10n * (3n * q + r)) / t - 10n * n;
      q *= 10n;
      r = nr;
      return Number(d);
    }
    const nr = (2n * q + r) * l;
    const nn = (q * (7n * k) + 2n + r * l) / (t * l);
    q *= k; t *= l; l += 2n; k += 1n; n = nn; r = nr;
  }
}

function tick() {
  const d = next();
  count++;
  postMessage({ digit: d, count });
  due += PACE_MS;
  const now = performance.now();
  if (due < now - 4 * PACE_MS) due = now;          // fell far behind (tab asleep): skip, don't burst
  timer = setTimeout(tick, Math.max(0, due - now));
}

onmessage = e => {
  if (e.data && e.data.pace) {          // the site got busier or quieter: change speed, keep going
    const was = PACE_MS;
    PACE_MS = Math.max(20, Math.min(2000, +e.data.pace || 60));
    if (timer && PACE_MS < was) { clearTimeout(timer); due = performance.now(); timer = setTimeout(tick, 0); }
    return;
  }
  if (e.data && e.data.pause) { clearTimeout(timer); timer = 0; return; }
  if (e.data && e.data.resume) {
    clearTimeout(timer);
    due = performance.now();
    timer = setTimeout(tick, 0);
    return;
  }
  if (e.data && e.data.sync) {
    clearTimeout(timer);
    due = performance.now() + (+e.data.delay || 0);
    timer = setTimeout(tick, Math.max(0, due - performance.now()));
  }
};

due = performance.now();
tick();
