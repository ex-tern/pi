//! piii OS on an ordinary computer: the same app, driven by scripted pointer and key events, its frames written
//! as PNG pictures, to look at every screen without booting a machine (and in the tests).
//!
//!     cargo run --release -- shots DIR [WIDTH HEIGHT]

use crate::app::{App, Event, Key};
use crate::gfx::Frame;
use std::io::Write;

fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    !c
}

fn adler(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &x in data {
        a = (a + x as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

/// A frame as a PNG (stored, not compressed: simple and exact).
pub fn png(f: &Frame) -> Vec<u8> {
    let mut raw = Vec::with_capacity(f.h * (f.w * 3 + 1));
    for y in 0..f.h {
        raw.push(0);
        for x in 0..f.w {
            let p = f.px[y * f.w + x];
            raw.extend_from_slice(&[(p >> 16) as u8, (p >> 8) as u8, p as u8]);
        }
    }
    let mut z = vec![0x78, 0x01];
    for (i, chunk) in raw.chunks(65535).enumerate() {
        let last = (i + 1) * 65535 >= raw.len();
        z.push(last as u8);
        let n = chunk.len() as u16;
        z.extend_from_slice(&n.to_le_bytes());
        z.extend_from_slice(&(!n).to_le_bytes());
        z.extend_from_slice(chunk);
    }
    z.extend_from_slice(&adler(&raw).to_be_bytes());
    let mut out = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut chunk = |kind: &[u8], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut c = kind.to_vec();
        c.extend_from_slice(data);
        out.extend_from_slice(&c);
        out.extend_from_slice(&crc32(&c).to_be_bytes());
    };
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&(f.w as u32).to_be_bytes());
    ihdr.extend_from_slice(&(f.h as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(b"IHDR", &ihdr);
    chunk(b"IDAT", &z);
    chunk(b"IEND", &[]);
    out
}

struct Shooter {
    app: App,
    frame: Frame,
    dir: String,
    n: usize,
}

impl Shooter {
    fn go(&mut self, events: &[Event]) {
        for e in events {
            self.app.event(*e);
            // as the machine's loop does: a tick, and a redraw when asked (twice: "Computing…", then the result)
            for _ in 0..2 {
                self.app.event(Event::Tick(10));
                if self.app.dirty {
                    self.app.draw(&mut self.frame);
                }
            }
        }
    }
    fn click_at(&mut self, x: f64, y: f64) {
        self.go(&[Event::At(x, y), Event::Button(true), Event::Button(false)]);
    }
    fn shot(&mut self, name: &str) {
        self.app.dirty = true;
        self.go(&[Event::Tick(10)]);
        let mut f = Frame { w: self.frame.w, h: self.frame.h, px: self.frame.px.clone() };
        self.app.draw_pointer(&mut f);
        self.n += 1;
        let path = format!("{}/{:02}-{}.png", self.dir, self.n, name);
        std::fs::File::create(&path).unwrap().write_all(&png(&f)).unwrap();
        println!("{}", path);
    }
}

pub fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|s| s.as_str()) != Some("shots") {
        eprintln!("piii OS is built for UEFI (x86_64-unknown-uefi). Here: piii-os shots DIR [WIDTH HEIGHT]");
        std::process::exit(2);
    }
    let dir = args.get(2).cloned().unwrap_or_else(|| "shots".into());
    std::fs::create_dir_all(&dir).unwrap();
    let w: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1440);
    let h: usize = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(900);
    let mut app = App::new(w, h);
    app.info = vec![
        ("Computer".into(), "Intel(R) Core(TM)2 Duo CPU T8300 @ 2.40GHz".into()),
        ("Firmware".into(), "Apple (revision 0x10001), EFI 1.10".into()),
        ("Screen".into(), format!("Universal Graphics Adapter, {} × {}", w, h)),
        ("Keyboard".into(), "the firmware's keyboard (Simple Text Input)".into()),
        ("Pointers".into(), "1 mouse or trackpad device (read through the console), 0 absolute (touch or tablet)".into()),
    ];
    let mut s = Shooter { app, frame: Frame::new(w, h), dir, n: 0 };
    let (fw, fh) = (w as f64, h as f64);
    s.go(&[Event::At(fw * 0.5, fh * 0.6)]);
    s.shot("canvas");
    // drag Numbers a little to the right and down
    let at = (fw * 0.80, 70.0 + 0.24 * (fh - 110.0));
    s.go(&[Event::At(at.0, at.1), Event::Button(true), Event::Move(-60.0, 40.0), Event::Move(-30.0, 20.0), Event::Button(false)]);
    s.shot("dragged");
    // Welcome
    s.click_at(fw * 0.20, 70.0 + 0.24 * (fh - 110.0));
    s.shot("welcome");
    s.go(&[Event::Key(Key::Esc)]);
    // Program: the Turing machine, run
    s.click_at(fw * 0.50, 70.0 + 0.24 * (fh - 110.0));
    s.go(&[Event::Key(Key::Char('5')), Event::Key(Key::Char('r'))]);
    s.shot("program-turing");
    s.go(&[Event::Key(Key::Char('2')), Event::Key(Key::Char('r'))]);
    s.shot("program-factorial");
    s.go(&[Event::Key(Key::Esc)]);
    // Numbers: π to 1000 digits
    s.click_at(fw * 0.80 - 90.0, 70.0 + 0.24 * (fh - 110.0) + 60.0);
    s.shot("numbers-pi");
    s.go(&[Event::Key(Key::Esc)]);
    // Library (online)
    s.click_at(fw * 0.80, 70.0 + 0.52 * (fh - 110.0));
    s.shot("library");
    s.go(&[Event::Key(Key::Esc)]);
    // Devices, by keyboard only: from Library, Tab three times to it, then Enter
    for _ in 0..3 {
        s.go(&[Event::Key(Key::Tab)]);
    }
    s.go(&[Event::Key(Key::Enter)]);
    s.shot("devices");
}
