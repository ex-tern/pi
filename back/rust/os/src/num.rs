//! Arithmetic the core library does not have without an operating system under it: roots, powers, logarithms.

pub fn floor(x: f64) -> f64 {
    let t = x as i64 as f64;
    if t > x { t - 1.0 } else { t }
}

pub fn abs(x: f64) -> f64 {
    if x < 0.0 { -x } else { x }
}

pub fn sqrt(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    // the processor's own square root (SSE2: every x86-64, and piii OS turns it on)
    #[cfg(target_arch = "x86_64")]
    #[allow(unused_unsafe)]
    unsafe {
        use core::arch::x86_64::{_mm_cvtsd_f64, _mm_set_sd, _mm_sqrt_pd};
        return _mm_cvtsd_f64(_mm_sqrt_pd(_mm_set_sd(x)));
    }
    #[allow(unreachable_code)]
    // a first guess from the exponent bits, then Newton
    let mut g = f64::from_bits((x.to_bits() >> 1) + (1023u64 << 51));
    for _ in 0..6 {
        g = 0.5 * (g + x / g);
    }
    g
}

pub fn ln(x: f64) -> f64 {
    if x <= 0.0 {
        return f64::NEG_INFINITY;
    }
    // ln x = 2 atanh((m-1)/(m+1)) + e ln 2, with x = m·2^e, 1 ≤ m < 2
    let (mut m, mut e) = (x, 0i32);
    while m >= 2.0 {
        m /= 2.0;
        e += 1;
    }
    while m < 1.0 {
        m *= 2.0;
        e -= 1;
    }
    let z = (m - 1.0) / (m + 1.0);
    let (mut sum, mut term, z2) = (0.0, z, z * z);
    let mut k = 1.0;
    while k < 60.0 {
        sum += term / k;
        term *= z2;
        k += 2.0;
    }
    2.0 * sum + e as f64 * core::f64::consts::LN_2
}

pub fn exp(x: f64) -> f64 {
    if x < -700.0 {
        return 0.0;
    }
    if x > 700.0 {
        return f64::INFINITY;
    }
    let n = floor(x / core::f64::consts::LN_2);
    let r = x - n * core::f64::consts::LN_2;
    let (mut sum, mut term) = (1.0, 1.0);
    for k in 1..30 {
        term *= r / k as f64;
        sum += term;
    }
    let mut p = 1.0;
    let mut i = n as i64;
    while i > 0 {
        p *= 2.0;
        i -= 1;
    }
    while i < 0 {
        p /= 2.0;
        i += 1;
    }
    sum * p
}

pub fn pow(a: f64, b: f64) -> f64 {
    if b == (b as i64) as f64 && abs(b) < 4096.0 {
        let mut r = 1.0;
        for _ in 0..(abs(b) as i64) {
            r *= a;
        }
        return if b < 0.0 { 1.0 / r } else { r };
    }
    if a <= 0.0 {
        return if a == 0.0 { 0.0 } else { f64::NAN };
    }
    exp(b * ln(a))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn close() {
        for x in [0.001, 0.5, 1.0, 2.0, 10.0, 12345.678] {
            assert!(abs(sqrt(x) * sqrt(x) - x) < 1e-9 * x.max(1.0));
            assert!(abs(exp(ln(x)) - x) < 1e-9 * x.max(1.0));
        }
        assert!(abs(pow(2.0, 0.5) - core::f64::consts::SQRT_2) < 1e-12);
        assert!(abs(pow(0.3, core::f64::consts::PI) - 0.02276816211880925) < 1e-12);
    }
}
