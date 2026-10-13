//! π, computed here: the Rabinowitz–Wagon spigot, exact to the digits asked for. The mark on the canvas shows them
//! appearing one by one.

use alloc::string::String;
use alloc::vec;

/// "3.14159…" with `n` digits after the point.
pub fn digits(n: usize) -> String {
    let len = (n + 2) * 10 / 3 + 1;
    let mut a = vec![2u32; len];
    let mut out = String::with_capacity(n + 2);
    let mut held: u32 = 0;
    let mut nines = 0usize;
    let mut first = true;
    for _ in 0..n + 2 {
        let mut q: u32 = 0;
        for i in (0..len).rev() {
            let x = 10 * a[i] + q * (i as u32 + 1);
            a[i] = x % (2 * i as u32 + 1);
            q = x / (2 * i as u32 + 1);
        }
        a[0] = q % 10;
        q /= 10;
        match q {
            9 => nines += 1,
            10 => {
                push(&mut out, held + 1, &mut first);
                for _ in 0..nines {
                    push(&mut out, 0, &mut first);
                }
                held = 0;
                nines = 0;
            }
            _ => {
                if out.len() > 0 || !first || held != 0 {
                    push(&mut out, held, &mut first);
                }
                held = q;
                for _ in 0..nines {
                    push(&mut out, 9, &mut first);
                }
                nines = 0;
            }
        }
    }
    // The first predigit pushed is a leading 0 placeholder; the string starts "03…" before the point is placed.
    let s = out.trim_start_matches('0');
    let mut r = String::with_capacity(n + 2);
    for (i, c) in s.chars().enumerate() {
        r.push(c);
        if i == 0 {
            r.push('.');
        }
    }
    r.truncate(n + 2);
    r
}

fn push(out: &mut String, d: u32, first: &mut bool) {
    *first = false;
    out.push(char::from(b'0' + d as u8));
}
