//! Drawing into a frame of pixels: the superellipse every super is drawn as (n = π), wires, shapes and text.
//! A pixel is 0x00RRGGBB, which is the firmware's own layout (blue, green, red, reserved), so a frame goes to the
//! screen as it is.

use crate::font::{Font, BIG, SMALL};
use crate::num::{abs, floor, pow, sqrt};
use alloc::vec;
use alloc::vec::Vec;

pub const PAPER: u32 = 0xF7F6F2;
pub const CARD: u32 = 0xFFFFFF;
pub const INK: u32 = 0x1B1B1A;
pub const MUTED: u32 = 0x6B6A64;
pub const LINE: u32 = 0xD9D6CC;
pub const ACCENT: u32 = 0x2F49D1;
pub const SOFT: u32 = 0xE8ECFB;
pub const FLOW: u32 = 0xC2186B;
pub const OK: u32 = 0x1F8A4C;
pub const WARN: u32 = 0xB4561B;

pub const N: f64 = core::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn new(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, w, h }
    }
    pub fn has(&self, px: f64, py: f64) -> bool {
        px >= self.x && py >= self.y && px < self.x + self.w && py < self.y + self.h
    }
    pub fn cx(&self) -> f64 {
        self.x + self.w / 2.0
    }
    pub fn cy(&self) -> f64 {
        self.y + self.h / 2.0
    }
    /// a point on the superellipse inscribed in this rectangle: is it inside the shape?
    pub fn has_super(&self, px: f64, py: f64) -> bool {
        let (a, b) = (self.w / 2.0, self.h / 2.0);
        if a <= 0.0 || b <= 0.0 {
            return false;
        }
        let (u, v) = (abs(px - self.cx()) / a, abs(py - self.cy()) / b);
        u <= 1.0 && v <= 1.0 && pow(u, N) + pow(v, N) <= 1.0
    }
}

pub struct Frame {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u32>,
}

fn mix(dst: u32, src: u32, a: u32) -> u32 {
    if a >= 255 {
        return src;
    }
    if a == 0 {
        return dst;
    }
    let ch = |s: u32| -> u32 {
        let (d, c) = ((dst >> s) & 0xFF, (src >> s) & 0xFF);
        ((c * a + d * (255 - a) + 127) / 255) << s
    };
    ch(16) | ch(8) | ch(0)
}

/// A small picture with its own transparency, drawn once and then only copied (the pointer: drawing it anew at each
/// move of the mouse is what made it lag).
pub struct Sprite {
    pub w: usize,
    pub h: usize,
    px: Vec<u32>,
    a: Vec<u8>,
}

impl Sprite {
    /// What `draw` puts on a w × h frame, with its edges' softness kept: drawn on black and on white, the difference
    /// is how much shows through.
    pub fn of(w: usize, h: usize, draw: impl Fn(&mut Frame)) -> Sprite {
        let (mut k, mut wt) = (Frame { w, h, px: vec![0; w * h] }, Frame { w, h, px: vec![0xFFFFFF; w * h] });
        draw(&mut k);
        draw(&mut wt);
        let mut px = vec![0u32; w * h];
        let mut al = vec![0u8; w * h];
        for i in 0..w * h {
            let ch = |p: u32, s: u32| (p >> s) & 0xFF;
            let through = (ch(wt.px[i], 8) as i32 - ch(k.px[i], 8) as i32).clamp(0, 255) as u32;
            let a = 255 - through;
            al[i] = a as u8;
            if a > 0 {
                let un = |s: u32| ((ch(k.px[i], s) * 255 + a / 2) / a).min(255) << s;
                px[i] = un(16) | un(8) | un(0);
            }
        }
        Sprite { w, h, px, a: al }
    }
}

impl Frame {
    /// A sprite with its top left at (x, y).
    pub fn sprite(&mut self, sp: &Sprite, x: i64, y: i64) {
        for j in 0..sp.h {
            for i in 0..sp.w {
                let k = j * sp.w + i;
                self.blend(x + i as i64, y + j as i64, sp.px[k], sp.a[k] as u32);
            }
        }
    }

    pub fn new(w: usize, h: usize) -> Frame {
        Frame { w, h, px: vec![PAPER; w * h] }
    }

    pub fn clear(&mut self, c: u32) {
        for p in self.px.iter_mut() {
            *p = c;
        }
    }

    #[inline]
    pub fn blend(&mut self, x: i64, y: i64, c: u32, a: u32) {
        if x < 0 || y < 0 || x as usize >= self.w || y as usize >= self.h || a == 0 {
            return;
        }
        let i = y as usize * self.w + x as usize;
        self.px[i] = mix(self.px[i], c, a);
    }

    pub fn rect(&mut self, r: Rect, c: u32) {
        let x0 = (r.x.max(0.0)) as usize;
        let y0 = (r.y.max(0.0)) as usize;
        let x1 = ((r.x + r.w).max(0.0) as usize).min(self.w);
        let y1 = ((r.y + r.h).max(0.0) as usize).min(self.h);
        for y in y0..y1 {
            let row = y * self.w;
            for x in x0..x1 {
                self.px[row + x] = c;
            }
        }
    }

    /// a rectangle's outline, t pixels thick, inside it
    pub fn frame(&mut self, r: Rect, t: f64, c: u32) {
        self.rect(Rect::new(r.x, r.y, r.w, t), c);
        self.rect(Rect::new(r.x, r.y + r.h - t, r.w, t), c);
        self.rect(Rect::new(r.x, r.y, t, r.h), c);
        self.rect(Rect::new(r.x + r.w - t, r.y, t, r.h), c);
    }

    /// Covers row y's span [l, r) (fractional ends) with weight `wgt` of 255 into a coverage row.
    fn span(cov: &mut [u32], x0: i64, l: f64, r: f64, wgt: u32) {
        if r <= l {
            return;
        }
        let n = cov.len() as i64;
        let (li, ri) = (floor(l) as i64, floor(r) as i64);
        for xi in li..=ri {
            let i = xi - x0;
            if i < 0 || i >= n {
                continue;
            }
            let (a, b) = ((xi as f64).max(l), ((xi + 1) as f64).min(r));
            if b > a {
                cov[i as usize] += ((b - a) * wgt as f64) as u32;
            }
        }
    }

    /// The superellipse |x/a|ⁿ + |y/b|ⁿ ≤ 1 inscribed in r (n = π), filled with `fill` and outlined `t` thick with
    /// `stroke`: smooth edges, four sub-rows to a row.
    pub fn superellipse(&mut self, r: Rect, fill: Option<u32>, stroke: u32, t: f64) {
        let (cx, cy, a, b) = (r.cx(), r.cy(), r.w / 2.0, r.h / 2.0);
        if a < 1.0 || b < 1.0 {
            return;
        }
        let half = |a: f64, b: f64, dy: f64| -> f64 {
            let v = abs(dy) / b;
            if v >= 1.0 {
                return -1.0;
            }
            a * pow(1.0 - pow(v, N), 1.0 / N)
        };
        let x0 = floor(cx - a) as i64 - 1;
        let width = (2.0 * a) as usize + 4;
        let (ia, ib) = ((a - t).max(0.0), (b - t).max(0.0));
        let mut outer = vec![0u32; width];
        let mut inner = vec![0u32; width];
        let ys = floor(cy - b) as i64;
        let ye = floor(cy + b) as i64 + 1;
        const SUB: usize = 4;
        for y in ys..=ye {
            if y < 0 || y as usize >= self.h {
                continue;
            }
            for v in outer.iter_mut() {
                *v = 0;
            }
            for v in inner.iter_mut() {
                *v = 0;
            }
            for s in 0..SUB {
                let sy = y as f64 + (s as f64 + 0.5) / SUB as f64 - cy;
                let ho = half(a, b, sy);
                if ho > 0.0 {
                    Self::span(&mut outer, x0, cx - ho, cx + ho, 255 / SUB as u32);
                }
                if t > 0.0 && ia > 0.0 && ib > 0.0 {
                    let hi = half(ia, ib, sy);
                    if hi > 0.0 {
                        Self::span(&mut inner, x0, cx - hi, cx + hi, 255 / SUB as u32);
                    }
                }
            }
            for i in 0..width {
                let o = outer[i].min(255);
                if o == 0 {
                    continue;
                }
                let x = x0 + i as i64;
                let inn = if t > 0.0 { inner[i].min(255) } else { o };
                if let Some(f) = fill {
                    self.blend(x, y, f, inn);
                }
                if t > 0.0 {
                    self.blend(x, y, stroke, o.saturating_sub(inn));
                }
            }
        }
    }

    /// A path of points stroked w wide (round ends and joins); dashed with (on, off) lengths if asked.
    pub fn stroke(&mut self, pts: &[(f64, f64)], w: f64, c: u32, dash: Option<(f64, f64)>) {
        if pts.len() < 2 {
            return;
        }
        let pad = w / 2.0 + 1.5;
        let (mut minx, mut miny, mut maxx, mut maxy) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for p in pts {
            minx = minx.min(p.0);
            miny = miny.min(p.1);
            maxx = maxx.max(p.0);
            maxy = maxy.max(p.1);
        }
        let (bx, by) = (floor(minx - pad) as i64, floor(miny - pad) as i64);
        let (bw, bh) = ((maxx - minx + 2.0 * pad) as usize + 2, (maxy - miny + 2.0 * pad) as usize + 2);
        if bw * bh > 4_000_000 {
            return;
        }
        let mut cov = vec![0u8; bw * bh];
        // the segments to draw (with dashes: only the "on" pieces)
        let mut segs: Vec<((f64, f64), (f64, f64))> = Vec::new();
        let mut along = 0.0;
        for p in pts.windows(2) {
            let (a, b) = (p[0], p[1]);
            let len = sqrt((b.0 - a.0) * (b.0 - a.0) + (b.1 - a.1) * (b.1 - a.1));
            match dash {
                None => segs.push((a, b)),
                Some((on, off)) => {
                    let period = on + off;
                    let mut t0 = 0.0;
                    while t0 < len {
                        let x = along + t0;
                        let ph = x - floor(x / period) * period; // (no % on floats without a C library)
                        let t1 = if ph < on { (t0 + on - ph).min(len) } else { (t0 + period - ph).min(len) };
                        if ph < on && len > 0.0 {
                            let f = |t: f64| (a.0 + (b.0 - a.0) * t / len, a.1 + (b.1 - a.1) * t / len);
                            segs.push((f(t0), f(t1)));
                        }
                        if t1 <= t0 {
                            break;
                        }
                        t0 = t1;
                    }
                }
            }
            along += len;
        }
        let r = w / 2.0;
        for (a, b) in segs {
            let (sx0, sy0) = (floor(a.0.min(b.0) - pad) as i64, floor(a.1.min(b.1) - pad) as i64);
            let (sx1, sy1) = (floor(a.0.max(b.0) + pad) as i64 + 1, floor(a.1.max(b.1) + pad) as i64 + 1);
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let l2 = dx * dx + dy * dy;
            for y in sy0..=sy1 {
                for x in sx0..=sx1 {
                    let (px, py) = (x as f64 + 0.5, y as f64 + 0.5);
                    let t = if l2 > 0.0 { (((px - a.0) * dx + (py - a.1) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
                    let (qx, qy) = (a.0 + t * dx - px, a.1 + t * dy - py);
                    let d = sqrt(qx * qx + qy * qy);
                    let k = (r + 0.5 - d).clamp(0.0, 1.0);
                    if k > 0.0 {
                        let (ix, iy) = (x - bx, y - by);
                        if ix >= 0 && iy >= 0 && (ix as usize) < bw && (iy as usize) < bh {
                            let i = iy as usize * bw + ix as usize;
                            cov[i] = cov[i].max((k * 255.0) as u8);
                        }
                    }
                }
            }
        }
        for iy in 0..bh {
            for ix in 0..bw {
                let a = cov[iy * bw + ix];
                if a > 0 {
                    self.blend(bx + ix as i64, by + iy as i64, c, a as u32);
                }
            }
        }
    }

    pub fn line(&mut self, a: (f64, f64), b: (f64, f64), w: f64, c: u32) {
        self.stroke(&[a, b], w, c, None);
    }

    /// A filled polygon (four by four samples to a pixel).
    pub fn poly(&mut self, pts: &[(f64, f64)], c: u32) {
        if pts.len() < 3 {
            return;
        }
        let (mut minx, mut miny, mut maxx, mut maxy) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for p in pts {
            minx = minx.min(p.0);
            miny = miny.min(p.1);
            maxx = maxx.max(p.0);
            maxy = maxy.max(p.1);
        }
        let inside = |x: f64, y: f64| -> bool {
            let mut c = false;
            let n = pts.len();
            let mut j = n - 1;
            for i in 0..n {
                let (a, b) = (pts[i], pts[j]);
                if (a.1 > y) != (b.1 > y) && x < (b.0 - a.0) * (y - a.1) / (b.1 - a.1) + a.0 {
                    c = !c;
                }
                j = i;
            }
            c
        };
        for y in floor(miny) as i64..=floor(maxy) as i64 {
            for x in floor(minx) as i64..=floor(maxx) as i64 {
                let mut n = 0;
                for sy in 0..4 {
                    for sx in 0..4 {
                        if inside(x as f64 + (sx as f64 + 0.5) / 4.0, y as f64 + (sy as f64 + 0.5) / 4.0) {
                            n += 1;
                        }
                    }
                }
                if n > 0 {
                    self.blend(x, y, c, n * 255 / 16);
                }
            }
        }
    }

    pub fn disc(&mut self, cx: f64, cy: f64, r: f64, c: u32) {
        self.stroke(&[(cx, cy), (cx + 0.01, cy)], 2.0 * r, c, None);
    }

    /// A wire from a to b as the site draws it: a curve leaving and arriving level, ending in an arrowhead.
    pub fn wire(&mut self, a: (f64, f64), b: (f64, f64), c: u32, dash: Option<(f64, f64)>, vertical: bool) {
        // a wire running back (into a register, upstream) keeps its curve close instead of swinging wide
        let back = !vertical && b.0 < a.0;
        let k = if vertical {
            abs(b.1 - a.1).max(40.0) * 0.5
        } else if back {
            (abs(b.1 - a.1) * 0.35).clamp(30.0, 70.0)
        } else {
            (abs(b.0 - a.0) * 0.5).clamp(20.0, 160.0)
        };
        let (c1, c2) = if vertical { ((a.0, a.1 + k), (b.0, b.1 - k)) } else { ((a.0 + k, a.1), (b.0 - k, b.1)) };
        let mut pts = Vec::with_capacity(33);
        for i in 0..=32 {
            let t = i as f64 / 32.0;
            let u = 1.0 - t;
            let x = u * u * u * a.0 + 3.0 * u * u * t * c1.0 + 3.0 * u * t * t * c2.0 + t * t * t * b.0;
            let y = u * u * u * a.1 + 3.0 * u * u * t * c1.1 + 3.0 * u * t * t * c2.1 + t * t * t * b.1;
            pts.push((x, y));
        }
        // stop short of the tip, where the arrowhead goes
        let n = pts.len();
        let (dx, dy) = (b.0 - pts[n - 3].0, b.1 - pts[n - 3].1);
        let l = sqrt(dx * dx + dy * dy).max(0.001);
        let (ux, uy) = (dx / l, dy / l);
        pts[n - 1] = (b.0 - ux * 8.0, b.1 - uy * 8.0);
        self.stroke(&pts, 2.4, c, dash);
        let (px, py) = (-uy, ux);
        self.poly(&[(b.0, b.1), (b.0 - ux * 11.0 + px * 5.5, b.1 - uy * 11.0 + py * 5.5), (b.0 - ux * 11.0 - px * 5.5, b.1 - uy * 11.0 - py * 5.5)], c);
    }

    // ------------------------------------------------------------------------------------------------ text

    fn glyph(font: &Font, ch: char) -> Option<&'static [u16]> {
        let mut code = ch as u32;
        // what the font lacks, drawn as its nearest
        code = match code {
            0x2212 => '-' as u32,
            0x3B3 => 'y' as u32,
            0x2260 => '#' as u32,
            c => c,
        };
        let font: &'static Font = if font.w == 8 { &SMALL } else { &BIG };
        let i = font.codes.binary_search(&code).ok().or_else(|| font.codes.binary_search(&('?' as u32)).ok())?;
        Some(&font.rows[i * font.h..(i + 1) * font.h])
    }

    /// Text at (x, y) (its top-left), each font pixel drawn s × s; answers how wide it was.
    pub fn text(&mut self, font: &Font, x: f64, y: f64, s: &str, c: u32, scale: usize) -> f64 {
        let mut cx = x;
        let sc = scale.max(1);
        for ch in s.chars() {
            if let Some(rows) = Self::glyph(font, ch) {
                for (ry, row) in rows.iter().enumerate() {
                    if *row == 0 {
                        continue;
                    }
                    for rx in 0..font.w {
                        if row & (0x8000 >> rx) != 0 {
                            let (px, py) = (cx as i64 + (rx * sc) as i64, y as i64 + (ry * sc) as i64);
                            for dy in 0..sc as i64 {
                                for dx in 0..sc as i64 {
                                    self.blend(px + dx, py + dy, c, 255);
                                }
                            }
                        }
                    }
                }
                // a ≠: the font has none, so an = with a stroke through it
                if ch == '≠' {
                    let (gx, gy, gw, gh) = (cx, y, (font.w * sc) as f64, (font.h * sc) as f64);
                    self.line((gx + gw * 0.7, gy + gh * 0.25), (gx + gw * 0.3, gy + gh * 0.8), sc as f64 * 1.2, c);
                }
            }
            cx += (font.w * sc) as f64;
        }
        cx - x
    }

    pub fn text_w(font: &Font, s: &str, scale: usize) -> f64 {
        (s.chars().count() * font.w * scale.max(1)) as f64
    }

    pub fn text_center(&mut self, font: &Font, cx: f64, y: f64, s: &str, c: u32, scale: usize) {
        let w = Self::text_w(font, s, scale);
        self.text(font, cx - w / 2.0, y, s, c, scale);
    }

    /// Words wrapped to `width`; answers the height used.
    pub fn para(&mut self, font: &Font, x: f64, y: f64, width: f64, s: &str, c: u32) -> f64 {
        let per = (width / font.w as f64).max(1.0) as usize;
        let mut yy = y;
        for line in wrap(s, per) {
            self.text(font, x, yy, &line, c, 1);
            yy += font.h as f64 + 4.0;
        }
        yy - y
    }
}

/// Lines of at most `per` characters, broken at spaces where it can.
pub fn wrap(s: &str, per: usize) -> Vec<alloc::string::String> {
    let mut out = Vec::new();
    for par in s.split('\n') {
        let mut line = alloc::string::String::new();
        for word in par.split(' ') {
            let wl = word.chars().count();
            let ll = line.chars().count();
            if ll > 0 && ll + 1 + wl > per {
                out.push(core::mem::take(&mut line));
            }
            if wl > per {
                // a word longer than the line (π's digits): cut it
                let cs: Vec<char> = word.chars().collect();
                for chunk in cs.chunks(per) {
                    if !line.is_empty() {
                        out.push(core::mem::take(&mut line));
                    }
                    line = chunk.iter().collect();
                }
                continue;
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(word);
        }
        out.push(line);
    }
    out
}
