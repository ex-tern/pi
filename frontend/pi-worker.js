// pi-worker.js — digits of π, forever, in the background.
//
// Gibbons' unbounded spigot (2006): exact integer arithmetic with BigInt, so
// every digit it emits is final. It never needs to know in advance how many
// digits are wanted; it simply keeps going while the page stays open, and
// each digit costs a little more than the last. Paced so the number visibly
// grows instead of racing ahead.
//
// The pace is exact: one digit every 60 ms, ten digits a beat at 100 BPM,
// the tempo of the logo song (logosound.js), so a 19.2 s loop of the song is
// exactly 320 digits. The schedule corrects its own drift, and a {sync: true}
// message restarts it so the next digit lands on the song's beat.
let q = 1n, r = 0n, t = 1n, k = 1n, n = 3n, l = 3n;
let count = 0;
const PACE_MS = 60;     // 1000 digits a minute: 10 a beat at 100 BPM
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
  if (e.data && e.data.sync) {
    clearTimeout(timer);
    due = performance.now() + (+e.data.delay || 0);
    timer = setTimeout(tick, Math.max(0, due - performance.now()));
  }
};

due = performance.now();
tick();
