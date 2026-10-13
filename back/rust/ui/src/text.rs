//! Words and numbers for the page: number formatting, dates, URL encoding, query strings.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

/// A number with `dp` decimals, thousands grouped.
pub fn num(n: f64, dp: usize) -> String {
    if !n.is_finite() {
        return String::from("—");
    }
    let s = format!("{:.*}", dp, n);
    let (sign, s) = if let Some(r) = s.strip_prefix('-') { ("-", r) } else { ("", &s[..]) };
    let (int, frac) = match s.find('.') {
        Some(i) => (&s[..i], &s[i..]),
        None => (s, ""),
    };
    let mut out = String::from(sign);
    let b = int.as_bytes();
    for (i, c) in b.iter().enumerate() {
        if i > 0 && (b.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(*c as char);
    }
    out.push_str(frac);
    out
}

/// The calendar date of a Unix time in seconds.
pub fn date_of_epoch(secs: f64) -> String {
    let days = (secs / 86400.0) as i64;
    // Howard Hinnant's civil-from-days.
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// A date for whatever the API sent: an ISO string, or a Unix time in seconds or milliseconds.
pub fn date(v: &crate::json::Value) -> String {
    match v {
        crate::json::Value::Str(s) => s.chars().take(10).collect(),
        crate::json::Value::Num(n) => date_of_epoch(if *n > 1e11 { *n / 1000.0 } else { *n }),
        _ => String::new(),
    }
}

pub fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

pub fn url_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = if b[i] == b'%' && i + 3 <= b.len() {
            core::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok())
        } else {
            None
        };
        match (b[i], hex) {
            (b'+', _) => out.push(b' '),
            (b'%', Some(x)) => {
                out.push(x);
                i += 2;
            }
            (c, _) => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The query parameters of a URL, decoded.
pub fn query(url: &str) -> Vec<(String, String)> {
    let q = match url.find('?') {
        Some(i) => &url[i + 1..],
        None => return Vec::new(),
    };
    let q = q.split('#').next().unwrap_or("");
    q.split('&')
        .filter(|p| !p.is_empty())
        .map(|p| match p.find('=') {
            Some(i) => (url_decode(&p[..i]), url_decode(&p[i + 1..])),
            None => (url_decode(p), String::new()),
        })
        .collect()
}

/// What follows `#` in a URL.
pub fn fragment(url: &str) -> &str {
    match url.find('#') {
        Some(i) => &url[i + 1..],
        None => "",
    }
}

/// A DOI as people paste it: a doi.org link, a "doi:" prefix, spaces.
pub fn clean_doi(s: &str) -> String {
    let mut t = s.trim();
    for p in ["https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi.org/", "doi:", "DOI:"] {
        if let Some(r) = t.strip_prefix(p) {
            t = r.trim();
        }
    }
    String::from(t)
}

pub fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{} {}", n, if n == 1 { one } else { many })
}

pub fn bytes(n: f64) -> String {
    if n >= 1048576.0 {
        format!("{:.1} MB", n / 1048576.0)
    } else {
        format!("{:.0} KB", (n / 1024.0).max(1.0))
    }
}
