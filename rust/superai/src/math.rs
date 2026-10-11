//! The few float functions the language needs, so the engine has no dependencies (core has no libm).

pub fn trunc(x: f64) -> f64 {
    if !x.is_finite() || x.abs() >= 4503599627370496.0 { x } else { (x as i64) as f64 }
}
pub fn floor(x: f64) -> f64 {
    let t = trunc(x);
    if x < t { t - 1.0 } else { t }
}
/// Half away from zero, as Math.round does for positive numbers.
pub fn round(x: f64) -> f64 {
    if x >= 0.0 { floor(x + 0.5) } else { -floor(-x + 0.5) }
}
fn ln(x: f64) -> f64 {
    if x.is_nan() || x < 0.0 { return f64::NAN; }
    if x == 0.0 { return f64::NEG_INFINITY; }
    if x.is_infinite() { return x; }
    // x = m · 2^e with m in [1, 2)
    let bits = x.to_bits();
    let mut e = ((bits >> 52) & 0x7ff) as i64 - 1023;
    let mut m = f64::from_bits((bits & 0x000f_ffff_ffff_ffff) | 0x3ff0_0000_0000_0000);
    if e == -1023 { return ln(x * 4503599627370496.0) - 52.0 * core::f64::consts::LN_2; }   // subnormal
    if m > core::f64::consts::SQRT_2 { m /= 2.0; e += 1; }
    // ln m = 2 atanh(s), s = (m − 1) / (m + 1)
    let s = (m - 1.0) / (m + 1.0);
    let s2 = s * s;
    let (mut term, mut sum, mut k) = (s, 0.0, 1.0);
    while k < 60.0 { sum += term / k; term *= s2; k += 2.0; }
    2.0 * sum + e as f64 * core::f64::consts::LN_2
}
fn exp(x: f64) -> f64 {
    if x.is_nan() { return x; }
    if x > 709.8 { return f64::INFINITY; }
    if x < -745.2 { return 0.0; }
    let k = round(x / core::f64::consts::LN_2);
    let r = x - k * core::f64::consts::LN_2;
    let (mut term, mut sum, mut i) = (1.0, 1.0, 1.0);
    while i < 30.0 { term *= r / i; sum += term; i += 1.0; }
    let mut out = sum;
    let mut k = k as i64;
    while k > 0 { out *= 2.0; k -= 1; }
    while k < 0 { out /= 2.0; k += 1; }
    out
}
pub fn pow(a: f64, b: f64) -> f64 {
    if b == 0.0 { return 1.0; }
    if b == trunc(b) && b.abs() < 1e9 {
        let (mut base, mut n, mut acc) = (a, b.abs() as u64, 1.0);
        while n > 0 { if n & 1 == 1 { acc *= base; } base *= base; n >>= 1; }
        return if b < 0.0 { 1.0 / acc } else { acc };
    }
    if a < 0.0 { return f64::NAN; }
    exp(b * ln(a))
}

#[cfg(test)]
mod t {
    #[test]
    fn close_enough() {
        assert_eq!(super::round(2.5), 3.0);
        assert_eq!(super::round(-2.5), -3.0);
        assert_eq!(super::floor(-0.5), -1.0);
        assert_eq!(super::pow(2.0, 10.0), 1024.0);
        assert!((super::pow(2.0, 0.5) - core::f64::consts::SQRT_2).abs() < 1e-12);
        assert!((super::pow(10.0, 2.5) - 316.22776601683796).abs() < 1e-9);
    }
}
