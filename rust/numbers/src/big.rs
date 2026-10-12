//! Unsigned big integers in base 10⁹, little-endian: the few operations the constants need (adding,
//! subtracting, multiplying and dividing by a small number or by another big one, comparing), each exact.
use alloc::vec;
use alloc::vec::Vec;
use core::cmp::Ordering;

pub const BASE: u64 = 1_000_000_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct N(pub Vec<u32>);

impl N {
    pub fn zero() -> N { N(vec![]) }
    pub fn small(v: u64) -> N { let mut n = N(vec![(v % BASE) as u32, (v / BASE % BASE) as u32, (v / BASE / BASE) as u32]); n.trim(); n }
    /// 10^(9·w): one in fixed point with w words after the point
    pub fn one_at(w: usize) -> N { let mut v = vec![0u32; w + 1]; v[w] = 1; N(v) }
    pub fn is_zero(&self) -> bool { self.0.is_empty() }
    fn trim(&mut self) { while self.0.last() == Some(&0) { self.0.pop(); } }

    pub fn cmp(&self, o: &N) -> Ordering {
        if self.0.len() != o.0.len() { return self.0.len().cmp(&o.0.len()); }
        for i in (0..self.0.len()).rev() { if self.0[i] != o.0[i] { return self.0[i].cmp(&o.0[i]); } }
        Ordering::Equal
    }
    pub fn add(&self, o: &N) -> N {
        let n = self.0.len().max(o.0.len());
        let mut r = Vec::with_capacity(n + 1); let mut c = 0u64;
        for i in 0..n {
            let s = *self.0.get(i).unwrap_or(&0) as u64 + *o.0.get(i).unwrap_or(&0) as u64 + c;
            r.push((s % BASE) as u32); c = s / BASE;
        }
        if c > 0 { r.push(c as u32); }
        let mut x = N(r); x.trim(); x
    }
    /// self − o, for self ≥ o
    pub fn sub(&self, o: &N) -> N {
        let mut r = Vec::with_capacity(self.0.len()); let mut b = 0i64;
        for i in 0..self.0.len() {
            let mut s = self.0[i] as i64 - *o.0.get(i).unwrap_or(&0) as i64 - b;
            if s < 0 { s += BASE as i64; b = 1; } else { b = 0; }
            r.push(s as u32);
        }
        let mut x = N(r); x.trim(); x
    }
    pub fn mul_small(&self, m: u64) -> N {
        if m == 0 || self.is_zero() { return N::zero(); }
        if m < (1u64 << 32) {                                            // fits u64 all the way (10⁹ · 2³² < 2⁶⁴): no 128-bit arithmetic, fast in wasm
            let mut r = Vec::with_capacity(self.0.len() + 2); let mut c = 0u64;
            for &d in &self.0 { let p = d as u64 * m + c; r.push((p % BASE) as u32); c = p / BASE; }
            while c > 0 { r.push((c % BASE) as u32); c /= BASE; }
            return N(r);
        }
        let mut r = Vec::with_capacity(self.0.len() + 3); let mut c: u128 = 0;
        for &d in &self.0 { let p = d as u128 * m as u128 + c; r.push((p % BASE as u128) as u32); c = p / BASE as u128; }
        while c > 0 { r.push((c % BASE as u128) as u32); c /= BASE as u128; }
        N(r)
    }
    /// ⌊self / d⌋ (d ≥ 1)
    pub fn div_small(&self, d: u64) -> N {
        if d < (1u64 << 32) {                                            // rem < d, so rem · 10⁹ + word < 2⁶⁴
            let mut r = vec![0u32; self.0.len()]; let mut rem = 0u64;
            for i in (0..self.0.len()).rev() { let cur = rem * BASE + self.0[i] as u64; r[i] = (cur / d) as u32; rem = cur % d; }
            let mut x = N(r); x.trim(); return x;
        }
        let mut r = vec![0u32; self.0.len()]; let mut rem: u128 = 0;
        for i in (0..self.0.len()).rev() { let cur = rem * BASE as u128 + self.0[i] as u128; r[i] = (cur / d as u128) as u32; rem = cur % d as u128; }
        let mut x = N(r); x.trim(); x
    }
    pub fn mul(&self, o: &N) -> N {
        if self.is_zero() || o.is_zero() { return N::zero(); }
        let mut acc = vec![0u64; self.0.len() + o.0.len() + 1];
        for (i, &a) in self.0.iter().enumerate() {
            if a == 0 { continue; }
            let mut c = 0u64;
            for (j, &b) in o.0.iter().enumerate() {
                let t = acc[i + j] + a as u64 * b as u64 + c;
                acc[i + j] = t % BASE; c = t / BASE;
            }
            let mut k = i + o.0.len();
            while c > 0 { let t = acc[k] + c; acc[k] = t % BASE; c = t / BASE; k += 1; }
        }
        let mut x = N(acc.into_iter().map(|v| v as u32).collect()); x.trim(); x
    }
    /// self · 10^(9w)
    pub fn shift(&self, w: usize) -> N { if self.is_zero() { return N::zero(); } let mut v = vec![0u32; w]; v.extend_from_slice(&self.0); N(v) }
    /// ⌊self / o⌋, o ≠ 0: long division in base 10⁹, each digit estimated from the leading words and corrected
    pub fn div(&self, o: &N) -> N {
        if self.cmp(o) == Ordering::Less { return N::zero(); }
        let top = |n: &N| -> f64 { let l = n.0.len(); let mut v = 0f64; for k in 0..3 { if l > k { v = v * BASE as f64 + n.0[l - 1 - k] as f64; } } v };
        let mut q = vec![0u32; self.0.len()];
        let mut rem = N::zero();
        for i in (0..self.0.len()).rev() {
            rem = rem.shift(1).add(&N(vec![self.0[i]]));
            if rem.cmp(o) == Ordering::Less { continue; }
            // the quotient digit from the leading words, then made exact
            let (lr, lo) = (rem.0.len(), o.0.len());
            let mut est = top(&rem) / top(o);
            let k = (lr.min(3)) as i32 - (lo.min(3)) as i32 + lo as i32 - lr as i32;   // align the two 3-word tops
            for _ in 0..k.max(0) { est /= BASE as f64; } for _ in 0..(-k).max(0) { est *= BASE as f64; }   // no powi without std
            let mut d = (est.max(0.0) as u64).min(BASE - 1);
            let mut t = o.mul_small(d);
            while t.cmp(&rem) == Ordering::Greater { d -= 1; t = t.sub(o); }
            rem = rem.sub(&t);
            while rem.cmp(o) != Ordering::Less { d += 1; rem = rem.sub(o); }
            q[i] = d as u32;
        }
        let mut x = N(q); x.trim(); x
    }
    /// the decimal digits, most significant first, no leading zeros ("0" for zero)
    pub fn to_dec(&self) -> alloc::string::String {
        use core::fmt::Write;
        let mut s = alloc::string::String::new();
        if self.is_zero() { s.push('0'); return s; }
        let _ = write!(s, "{}", self.0[self.0.len() - 1]);
        for i in (0..self.0.len() - 1).rev() { let _ = write!(s, "{:09}", self.0[i]); }
        s
    }
}

/// A signed big number (sign and magnitude), for the series whose terms change sign.
#[derive(Clone, Debug)]
pub struct Z { pub neg: bool, pub m: N }
impl Z {
    pub fn pos(m: N) -> Z { Z { neg: false, m } }
    pub fn add(&self, o: &Z) -> Z {
        if self.neg == o.neg { return Z { neg: self.neg, m: self.m.add(&o.m) }; }
        match self.m.cmp(&o.m) {
            Ordering::Less => Z { neg: o.neg, m: o.m.sub(&self.m) },
            _ => { let m = self.m.sub(&o.m); Z { neg: self.neg && !m.is_zero(), m } }
        }
    }
    pub fn mul_small(&self, k: u64) -> Z { Z { neg: self.neg, m: self.m.mul_small(k) } }
    /// truncated toward zero, as BigInt division is
    pub fn div_small(&self, k: u64) -> Z { let m = self.m.div_small(k); Z { neg: self.neg && !m.is_zero(), m } }
}
