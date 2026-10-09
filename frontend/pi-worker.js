// pi-worker.js — digits of π, forever, in the background.
//
// Gibbons' unbounded spigot (2006): exact integer arithmetic with BigInt, so
// every digit it emits is final. It never needs to know in advance how many
// digits are wanted; it simply keeps going while the page stays open, and
// each digit costs a little more than the last. Paced so the number visibly
// grows instead of racing ahead.
let q = 1n, r = 0n, t = 1n, k = 1n, n = 3n, l = 3n;
let count = 0;
const PACE_MS = 60;     // about 16 digits a second

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
  setTimeout(tick, PACE_MS);
}
tick();
