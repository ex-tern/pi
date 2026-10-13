// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Ali Vafadar Yengejeh (Pi Tech Lab). Part of ScholarPi's open science engines: see LICENSE.
//! The site's constants, computed exactly to many digits: π, e, φ and γ. A port of frontend/pi-worker.js
//! and frontend/consts-worker.js (owner, 2026-10-13: "write the whole project in py and rust only"; the
//! front end moves to Rust one module at a time). Fixed point: a value v is held as ⌊v · 10^(9w)⌋ in
//! base-10⁹ words (big.rs), with guard words beyond the digits shown.
//!
//!   π   Machin: 16·atan(1/5) − 4·atan(1/239)
//!   e   Σ 1/k!
//!   φ   (1 + √5)/2, √5 = (9/4)·√(1 − 1/81) by the binomial series
//!   γ   Brent–McMillan: γ ≈ U/V, U = Σaₖ, V = Σbₖ, b₀ = 1, a₀ = −ln n, bₖ = bₖ₋₁·n²/k², aₖ = (aₖ₋₁·n²/k + bₖ)/k
//!
//! In the browser (wasm.rs) the page asks for "pi 1000" and gets "3.1415…" back.
#![cfg_attr(target_arch = "wasm32", no_std)]
extern crate alloc;

pub mod big;
#[cfg(target_arch = "wasm32")]
mod wasm;

use alloc::string::String;
use big::{N, Z};

const GUARD_WORDS: usize = 3;

/// atan(1/x) · 10^(9w), x a small integer
fn atan_inv(x: u64, w: usize) -> Z {
    let x2 = x * x;
    let mut t = N::one_at(w).div_small(x);       // 1/x
    let mut sum = Z::pos(t.clone());
    let mut k = 1u64;
    while !t.is_zero() {
        t = t.div_small(x2);
        let term = t.div_small(2 * k + 1);
        sum = sum.add(&Z { neg: k % 2 == 1, m: term });
        k += 1;
    }
    sum
}
pub fn pi(w: usize) -> N { atan_inv(5, w).mul_small(16).add(&Z { neg: true, m: atan_inv(239, w).m.mul_small(4) }).m }
pub fn e(w: usize) -> N {
    let (mut t, mut s, mut k) = (N::one_at(w), N::one_at(w), 1u64);
    while !t.is_zero() { t = t.div_small(k); s = s.add(&t); k += 1; }
    s
}
pub fn phi(w: usize) -> N {
    // √5 = (9/4)·√(1 − 1/81), by the binomial series: tₖ = tₖ₋₁ · (2k − 3) / (162k), t₁ negative and every
    // term after it the same sign (two digits a term, four times faster than √(1 + 1/4))
    let mut t = N::one_at(w).div_small(162);           // |t₁| = 1/162
    let mut s = N::one_at(w).sub(&t);
    let mut k = 2u64;
    while !t.is_zero() { t = t.mul_small(2 * k - 3).div_small(162 * k); s = s.sub(&t); k += 1; }
    let sqrt5 = s.mul_small(9).div_small(4);
    N::one_at(w).add(&sqrt5).div_small(2)
}
/// atanh(p/q) · 10^(9w), p/q small
fn atanh_rat(p: u64, q: u64, w: usize) -> N {
    let mut term = N::one_at(w).mul_small(p).div_small(q);
    let mut sum = term.clone();
    let (pp, qq) = (p * p, q * q);
    let mut k = 1u64;
    while !term.is_zero() { term = term.mul_small(pp).div_small(qq); sum = sum.add(&term.div_small(2 * k + 1)); k += 1; }
    sum
}
fn ln_int(n: u64, w: usize) -> N {
    let mut m = 0u32;
    while (1u64 << (m + 1)) <= n { m += 1; }
    let (p, q) = (n - (1u64 << m), n + (1u64 << m));
    let ln2 = atanh_rat(1, 3, w).mul_small(2);
    let mut r = ln2.mul_small(m as u64);
    if p != 0 { r = r.add(&atanh_rat(p, q, w).mul_small(2)); }
    r
}
/// γ to about `digits` digits
pub fn gamma(w: usize, digits: usize) -> N {
    let n = ((digits as f64) * core::f64::consts::LN_10 / 4.0) as u64 + 3;   // ⌈·⌉ + 2 (no ceil without std)
    let n2 = n * n;
    let mut a = Z { neg: true, m: ln_int(n, w) };
    let mut b = N::one_at(w);
    let (mut u, mut v) = (a.clone(), b.clone());
    let mut k = 1u64;
    loop {
        b = b.mul_small(n2).div_small(k * k);
        a = a.mul_small(n2).div_small(k).add(&Z::pos(b.clone())).div_small(k);
        if a.m.is_zero() && b.is_zero() { break; }
        u = u.add(&a); v = v.add(&b);
        k += 1;
    }
    u.m.shift(w).div(&v)                                // (U · S) / V
}

/// "3.14159…": a fixed-point value with w words after the point, shown to `d` digits after it
pub fn show(v: &N, w: usize, d: usize) -> String {
    let s = v.to_dec();
    let p = 9 * w;
    let s = if s.len() <= p { let mut z = String::new(); for _ in 0..(p + 1 - s.len()) { z.push('0'); } z + &s } else { s };
    let (int, frac) = s.split_at(s.len() - p);
    let mut out = String::from(int); out.push('.'); out.push_str(&frac[..d.min(frac.len())]);
    out
}

/// One request: "pi 1000", "e 300", "phi 3000", "gamma 1000" → the constant to that many digits after the point.
pub fn handle(req: &str) -> String {
    let mut it = req.split_whitespace();
    let key = it.next().unwrap_or("");
    let d: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(100).clamp(1, 200_000);
    let w = d / 9 + 1 + GUARD_WORDS;
    match key {
        "pi" => show(&pi(w), w, d),
        "e" => show(&e(w), w, d),
        "phi" => show(&phi(w), w, d),
        "gamma" => { let w = w + 2; show(&gamma(w, d + 10), w, d) }
        _ => String::from("unknown constant"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PI100: &str = "3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679";
    const E100: &str = "2.7182818284590452353602874713526624977572470936999595749669676277240766303535475945713821785251664274";
    const PHI100: &str = "1.6180339887498948482045868343656381177203091798057628621354486227052604628189024497072072041893911374";
    const G100: &str = "0.5772156649015328606065120900824024310421593359399235988057672348848677267776646709369470632917467495";
    #[test] fn constants() {
        assert_eq!(handle("pi 100"), PI100);
        assert_eq!(handle("e 100"), E100);
        assert_eq!(handle("phi 100"), PHI100);
        assert_eq!(handle("gamma 100"), G100);
    }
    #[test] fn division() {
        let a = N::small(123456789).mul(&N::small(987654321)).mul(&N::small(1_000_000_007)).add(&N::small(42));
        let b = N::small(987654321).mul(&N::small(1_000_000_007));
        assert_eq!(a.div(&b).to_dec(), "123456789");
        let big = N::one_at(40).add(&N::small(7)); let d = N::small(3).shift(13).add(&N::small(11));
        let q = big.div(&d);
        assert!(q.mul(&d).cmp(&big) != core::cmp::Ordering::Greater && q.add(&N::small(1)).mul(&d).cmp(&big) == core::cmp::Ordering::Greater);
    }
}
