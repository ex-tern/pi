// consts-worker.js — important constants, computed exactly, to more and more digits.
//
// Fixed-point arithmetic on BigInt: a value v is held as round(v · 10^P).
// Each constant is computed at 100, 300, 1 000, 3 000, 10 000 and 30 000 digits
// (γ stops at 10 000: it is the slowest); the page reveals the digits at a steady pace.
//
//   e    Σ 1/k!
//   φ    (1 + √5) / 2           √ by Newton's method on integers
//   γ    Brent–McMillan: γ ≈ Σaₖ/Σbₖ, b₀ = 1, a₀ = −ln n,
//        bₖ = bₖ₋₁·n²/k², aₖ = (aₖ₋₁·n²/k + bₖ)/k, with n ≈ D·ln10/4
const GUARD = 24;

function isqrt(n) {                      // ⌊√n⌋ for BigInt n ≥ 0
  if (n < 2n) return n;
  // a start above the root, then Newton downwards
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}
function atanhRat(p, q, S) {             // atanh(p/q) · S, for small p/q
  let term = (S * p) / q, sum = term, k = 1n;
  const pp = p * p, qq = q * q;
  while (term !== 0n) {
    term = (term * pp) / qq;
    sum += term / (2n * k + 1n);
    k++;
  }
  return sum;
}
function ln2(S) { return 2n * atanhRat(1n, 3n, S); }
function lnInt(n, S) {                   // ln n for an integer n ≥ 1
  let m = 0n;
  while ((1n << (m + 1n)) <= n) m++;
  const p = n - (1n << m), q = n + (1n << m);
  return m * ln2(S) + (p === 0n ? 0n : 2n * atanhRat(p, q, S));
}
function e(S) { let t = S, s = S, k = 1n; while (t !== 0n) { t /= k; s += t; k++; } return s; }
function gamma(S, D) {
  const n = BigInt(Math.ceil(D * Math.log(10) / 4) + 2), n2 = n * n;
  let a = -lnInt(n, S), b = S, U = a, V = b, k = 1n;
  for (;;) {
    b = (b * n2) / (k * k);
    a = ((a * n2) / k + b) / k;
    if (a === 0n && b === 0n) break;
    U += a; V += b; k++;
  }
  return (U * S) / V;
}

// "3.14159…" from a fixed-point value, D digits after the point
function show(v, P, D) {
  const neg = v < 0n; if (neg) v = -v;
  let s = v.toString().padStart(P + 1, "0");
  const int = s.slice(0, s.length - P), frac = s.slice(s.length - P, s.length - P + D);
  return (neg ? "-" : "") + int + "." + frac;
}

const JOBS = [
  ["e", D => { const P = D + GUARD, S = 10n ** BigInt(P); return show(e(S), P, D); }],
  ["phi", D => { const P = D + GUARD, S = 10n ** BigInt(P); return show((S + isqrt(5n * S * S)) / 2n, P, D); }],
  ["gamma", D => { const P = D + GUARD + 10, S = 10n ** BigInt(P); return show(gamma(S, D + 10), P, D); }, 10000],
];
const STEPS = [100, 300, 1000, 3000, 10000, 30000];

if (typeof self !== "undefined" && typeof postMessage === "function" && typeof window === "undefined" && !globalThis.__constsTest) {
  // {pause: true} from the page (a double-click on the logo) holds the work
  // between steps; {pause: false} carries on.
  let paused = false;
  self.onmessage = e => { if (e.data && "pause" in e.data) paused = !!e.data.pause; };
  (async () => {
    for (const D of STEPS) {
      for (const [key, f, cap] of JOBS) {
        if (cap && D > cap) continue;
        while (paused) await new Promise(r => setTimeout(r, 200));
        postMessage({ key, digits: f(D) });
        await new Promise(r => setTimeout(r, 0));    // stay responsive to the page
      }
    }
  })();
}
if (typeof module !== "undefined") module.exports = { JOBS };
