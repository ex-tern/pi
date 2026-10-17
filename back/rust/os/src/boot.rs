//! Where the firmware starts piii OS (efi_main): the screen (GOP, or UGA on older Macs), the keyboard and the
//! pointers, and the loop that hands their events to the app and puts its frames on the screen.

use crate::app::{App, Event, Key, Request};
use crate::gfx::{Frame, Rect};
use crate::uefi::{self, *};
use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

#[global_allocator]
static ALLOC: Pool = Pool;

enum Screen {
    Gop(*mut Gop),
    Uga(*mut Uga),
}

impl Screen {
    /// The firmware's graphics, switched to pictures (older Macs start in text), at a good size.
    fn open() -> Option<(Screen, usize, usize, String)> {
        let st = uefi::st();
        for h in [st.con_out_handle] {
            if let Some(cc) = handle_protocol::<ConsoleControl>(h, &CONSOLE_CONTROL) {
                unsafe { ((*cc).set_mode)(cc, 1) };
            }
        }
        for h in uefi::handles(&CONSOLE_CONTROL) {
            if let Some(cc) = handle_protocol::<ConsoleControl>(h, &CONSOLE_CONTROL) {
                unsafe { ((*cc).set_mode)(cc, 1) };
            }
        }
        // GOP: the console's own first, then any
        let mut gops: Vec<*mut Gop> = Vec::new();
        if let Some(g) = handle_protocol::<Gop>(st.con_out_handle, &GOP) {
            gops.push(g);
        }
        for h in uefi::handles(&GOP) {
            if let Some(g) = handle_protocol::<Gop>(h, &GOP) {
                if !gops.contains(&g) {
                    gops.push(g);
                }
            }
        }
        for g in gops {
            unsafe {
                let mode = (*g).mode;
                if mode.is_null() || (*mode).info.is_null() {
                    continue;
                }
                let (w, h) = ((*(*mode).info).hres as usize, (*(*mode).info).vres as usize);
                // a small start-up size (an emulator's 800 × 600): the largest mode up to 1920 × 1200 instead
                if w < 1024 {
                    let mut best: Option<(u32, usize)> = None;
                    for m in 0..(*mode).max_mode {
                        let (mut sz, mut info): (usize, *mut GopInfo) = (0, core::ptr::null_mut());
                        if ((*g).query)(g, m, &mut sz, &mut info) == SUCCESS && !info.is_null() {
                            let (mw, mh) = ((*info).hres as usize, (*info).vres as usize);
                            if mw <= 1920 && mh <= 1200 && mw * mh > best.map(|b| b.1).unwrap_or(0) && (*info).format < 3 {
                                best = Some((m, mw * mh));
                            }
                        }
                    }
                    if let Some((m, _)) = best {
                        ((*g).set_mode)(g, m);
                    }
                }
                let info = (*(*g).mode).info;
                let (w, h) = ((*info).hres as usize, (*info).vres as usize);
                if w > 0 && h > 0 {
                    return Some((Screen::Gop(g), w, h, format!("Graphics Output Protocol, {} × {}", w, h)));
                }
            }
        }
        // UGA: what EFI 1.10 Macs have
        let mut ugas: Vec<*mut Uga> = Vec::new();
        if let Some(u) = handle_protocol::<Uga>(st.con_out_handle, &UGA) {
            ugas.push(u);
        }
        for h in uefi::handles(&UGA) {
            if let Some(u) = handle_protocol::<Uga>(h, &UGA) {
                if !ugas.contains(&u) {
                    ugas.push(u);
                }
            }
        }
        for u in ugas {
            let (mut w, mut h, mut d, mut r) = (0u32, 0u32, 0u32, 0u32);
            if unsafe { ((*u).get_mode)(u, &mut w, &mut h, &mut d, &mut r) } == SUCCESS && w > 0 && h > 0 {
                return Some((Screen::Uga(u), w as usize, h as usize, format!("Universal Graphics Adapter, {} × {}", w, h)));
            }
        }
        None
    }

    /// A part of a frame onto the screen at the same place.
    fn show(&self, f: &mut Frame, r: Rect) {
        let x0 = (r.x.max(0.0) as usize).min(f.w);
        let y0 = (r.y.max(0.0) as usize).min(f.h);
        let x1 = ((r.x + r.w).max(0.0) as usize).min(f.w);
        let y1 = ((r.y + r.h).max(0.0) as usize).min(f.h);
        if x1 <= x0 || y1 <= y0 {
            return;
        }
        let (w, h, delta) = (x1 - x0, y1 - y0, f.w * 4);
        let buf = f.px.as_mut_ptr();
        // 2: from the buffer to the screen
        unsafe {
            match self {
                Screen::Gop(g) => ((**g).blt)(*g, buf, 2, x0, y0, x0, y0, w, h, delta),
                Screen::Uga(u) => ((**u).blt)(*u, buf, 2, x0, y0, x0, y0, w, h, delta),
            };
        }
    }
}

struct Pointers {
    rel: Vec<(*mut Pointer, f64, f64)>,
    abs: Vec<*mut AbsPointer>,
    /// the buttons as the firmware's pointers and piii OS's own USB mice last said, and both together
    fw_left: bool,
    usb_left: bool,
    left: bool,
}

struct Input {
    ex: Option<*mut TextInEx>,
    pointers: Pointers,
    mice: crate::usb::Mice,
}

impl Input {
    fn open() -> (Input, Vec<(String, String)>) {
        let st = uefi::st();
        let mut info = Vec::new();
        let ex = handle_protocol::<TextInEx>(st.con_in_handle, &TEXT_IN_EX);
        info.push(("Keyboard".into(), if ex.is_some() { "the firmware's keyboard (Simple Text Input Ex)".into() } else { "the firmware's keyboard (Simple Text Input)".into() }));
        // the console's pointer gathers every mouse; where there is one, it alone (or each move counts twice)
        let mut rel = Vec::new();
        let mut abs = Vec::new();
        let gathered = handle_protocol::<Pointer>(st.con_in_handle, &POINTER);
        let found_rel: Vec<*mut Pointer> = match gathered {
            Some(p) => alloc::vec![p],
            None => uefi::handles(&POINTER).into_iter().filter_map(|h| handle_protocol::<Pointer>(h, &POINTER)).collect(),
        };
        for p in found_rel {
            unsafe {
                ((*p).reset)(p, 0);
                let m = (*p).mode;
                let (rx, ry) = if m.is_null() { (0.0, 0.0) } else { ((*m).res_x as f64, (*m).res_y as f64) };
                // a move of `res` counts is a millimetre; about eight pixels to one
                let k = |r: f64| if r > 0.0 { (8.0 / r).clamp(0.05, 8.0) } else { 1.0 };
                rel.push((p, k(rx), k(ry)));
            }
        }
        let gathered_abs = handle_protocol::<AbsPointer>(st.con_in_handle, &ABS_POINTER);
        let found_abs: Vec<*mut AbsPointer> = match gathered_abs {
            Some(p) => alloc::vec![p],
            None => uefi::handles(&ABS_POINTER).into_iter().filter_map(|h| handle_protocol::<AbsPointer>(h, &ABS_POINTER)).collect(),
        };
        for p in found_abs {
            unsafe { ((*p).reset)(p, 0) };
            abs.push(p);
        }
        // the console's own pointer gathers the others: it is no mouse itself
        let n_dev = uefi::handles(&POINTER).into_iter().filter(|h| *h != st.con_in_handle).count();
        // and the USB mice the firmware has no driver for: piii OS reads those itself
        let mice = crate::usb::start();
        let n_abs = uefi::handles(&ABS_POINTER).into_iter().filter(|h| *h != st.con_in_handle).count();
        info.push((
            "Pointers".into(),
            if !mice.found.is_empty() {
                format!(
                    "{} (read by piii OS's own USB driver){}",
                    mice.found.join(", "),
                    if n_dev + n_abs > 0 { format!("; {} more read by the firmware", n_dev + n_abs) } else { String::new() }
                )
            } else if n_dev == 0 && n_abs == 0 {
                "none found: the arrow keys move the pointer and Enter clicks (plug in a USB mouse or its receiver, then restart)".into()
            } else {
                format!(
                    "{} mouse or trackpad{} ({}), {} touch or tablet",
                    n_dev,
                    if n_dev == 1 { "" } else { "s" },
                    if gathered.is_some() { "read through the console" } else { "read one by one" },
                    n_abs
                )
            },
        ));
        (Input { ex, pointers: Pointers { rel, abs, fw_left: false, usb_left: false, left: false }, mice }, info)
    }

    fn key(scan: u16, ch: u16, shift: bool) -> Option<Key> {
        Some(match (scan, ch) {
            (0x01, _) => Key::Up,
            (0x02, _) => Key::Down,
            (0x03, _) => Key::Right,
            (0x04, _) => Key::Left,
            (0x05, _) => Key::Home,
            (0x09, _) => Key::PageUp,
            (0x0a, _) => Key::PageDown,
            (0x17, _) => Key::Esc,
            (0x08, _) | (0, 0x08) => Key::Backspace,
            (0, 0x0d) | (0, 0x0a) => Key::Enter,
            (0, 0x20) => Key::Space,
            (0, 0x09) => if shift { Key::BackTab } else { Key::Tab },
            (0, c) if c > 0x20 => Key::Char(char::from_u32(c as u32)?),
            _ => return None,
        })
    }

    fn poll(&mut self, w: usize, h: usize, out: &mut Vec<Event>) {
        let st = uefi::st();
        // keys
        for _ in 0..32 {
            let got = unsafe {
                match self.ex {
                    Some(ex) => {
                        let mut kd = KeyData { key: InputKey { scan: 0, ch: 0 }, shift: 0, toggle: 0 };
                        if ((*ex).read)(ex, &mut kd) != SUCCESS {
                            None
                        } else {
                            let shift = kd.shift & 0x8000_0000 != 0 && kd.shift & 0x3 != 0;
                            Some((kd.key.scan, kd.key.ch, shift))
                        }
                    }
                    None => {
                        let ci = st.con_in;
                        let mut k = InputKey { scan: 0, ch: 0 };
                        if ci.is_null() || ((*ci).read)(ci, &mut k) != SUCCESS { None } else { Some((k.scan, k.ch, false)) }
                    }
                }
            };
            match got {
                Some((s, c, sh)) => {
                    uefi::log(&format!("piii OS: key scan {:#x} char {:#x}{}", s, c, if sh { " shift" } else { "" }));
                    if let Some(k) = Self::key(s, c, sh) {
                        out.push(Event::Key(k));
                    }
                }
                None => break,
            }
        }
        // mice and trackpads
        let mut left = self.pointers.fw_left;
        for &(p, kx, ky) in &self.pointers.rel {
            let mut s = PointerState { x: 0, y: 0, z: 0, left: 0, right: 0 };
            if unsafe { ((*p).state)(p, &mut s) } == SUCCESS {
                if s.x != 0 || s.y != 0 {
                    out.push(Event::Move(s.x as f64 * kx, s.y as f64 * ky));
                }
                if (s.left != 0) != self.pointers.fw_left {
                    uefi::log(&format!("piii OS: pointer button {}", s.left));
                }
                left = s.left != 0;
            }
        }
        for &p in &self.pointers.abs {
            let mut s = AbsState { x: 0, y: 0, z: 0, buttons: 0 };
            if unsafe { ((*p).state)(p, &mut s) } == SUCCESS {
                let m = unsafe { &*(*p).mode };
                let sx = (m.max_x.saturating_sub(m.min_x)).max(1) as f64;
                let sy = (m.max_y.saturating_sub(m.min_y)).max(1) as f64;
                out.push(Event::At((s.x.saturating_sub(m.min_x)) as f64 / sx * w as f64, (s.y.saturating_sub(m.min_y)) as f64 / sy * h as f64));
                left = s.buttons & 1 != 0;
            }
        }
        self.pointers.fw_left = left;
        // piii OS's own USB mice: a little faster for a big move, as a mouse feels right
        if self.pointers.fw_left != self.pointers.left {
            self.pointers.left = self.pointers.fw_left;
            out.push(Event::Button(self.pointers.left));
        }
        if let Some((dx, dy, downs, ups, held)) = self.mice.take() {
            if dx != 0 || dy != 0 {
                out.push(Event::Move(dx as f64, dy as f64));
            }
            // every press and release, in the order they must have come (a quick click is both at once)
            let mut l = self.pointers.usb_left;
            let mut d = downs;
            let mut u = ups;
            while d > 0 || u > 0 {
                if !l && d > 0 {
                    d -= 1;
                    l = true;
                } else if l && u > 0 {
                    u -= 1;
                    l = false;
                } else {
                    break;
                }
                out.push(Event::Button(l));
            }
            if l != held {
                l = held;
                out.push(Event::Button(l));
            }
            self.pointers.usb_left = l;
        }
    }
}

fn union(a: Rect, b: Rect) -> Rect {
    let (x0, y0) = (a.x.min(b.x), a.y.min(b.y));
    let (x1, y1) = ((a.x + a.w).max(b.x + b.w), (a.y + a.h).max(b.y + b.h));
    Rect::new(x0, y0, x1 - x0, y1 - y0)
}

/// The box around every pixel that differs between two frames (None: they are the same).
fn changed(a: &Frame, b: &Frame) -> Option<Rect> {
    let w = a.w;
    let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0, 0);
    for y in 0..a.h {
        let (ra, rb) = (&a.px[y * w..(y + 1) * w], &b.px[y * w..(y + 1) * w]);
        if ra == rb {
            continue;
        }
        let l = ra.iter().zip(rb).position(|(p, q)| p != q).unwrap_or(0);
        let r = w - ra.iter().rev().zip(rb.iter().rev()).position(|(p, q)| p != q).unwrap_or(0);
        x0 = x0.min(l);
        x1 = x1.max(r);
        y0 = y0.min(y);
        y1 = y + 1;
    }
    if y1 == 0 {
        return None;
    }
    Some(Rect::new(x0 as f64, y0 as f64, (x1 - x0) as f64, (y1 - y0) as f64))
}

fn copy_rect(from: &Frame, to: &mut Frame, r: Rect) {
    let x0 = (r.x.max(0.0) as usize).min(from.w);
    let y0 = (r.y.max(0.0) as usize).min(from.h);
    let x1 = ((r.x + r.w).max(0.0) as usize).min(from.w);
    let y1 = ((r.y + r.h).max(0.0) as usize).min(from.h);
    for y in y0..y1 {
        let i = y * from.w;
        to.px[i + x0..i + x1].copy_from_slice(&from.px[i + x0..i + x1]);
    }
}

/// Where the firmware enters: before any Rust runs, the processor's SSE unit is switched on (CR0: no emulation,
/// monitor the coprocessor; CR4: FXSAVE and SIMD exceptions). UEFI firmware on x64 is meant to leave it on already;
/// saying so again costs nothing, and piii OS draws with hardware floating point (x86_64-piii-uefi.json), which on
/// a 2008 Mac is many times faster than the software kind: the pointer and the canvas keep up with the mouse.
#[unsafe(naked)]
#[export_name = "efi_main"]
pub extern "efiapi" fn entry(image: Handle, st: *mut SystemTable) -> Status {
    core::arch::naked_asm!(
        "mov rax, cr0",
        "and rax, -5",
        "or rax, 2",
        "mov cr0, rax",
        "mov rax, cr4",
        "or rax, 0x600",
        "mov cr4, rax",
        "jmp {main}",
        main = sym efi_main,
    )
}

extern "efiapi" fn efi_main(image: Handle, st: *mut SystemTable) -> Status {
    uefi::init(image, st);
    uefi::no_watchdog();
    uefi::log("piii OS: starting");
    let Some((screen, w, h, gfx)) = Screen::open() else {
        uefi::print("piii OS: this computer's firmware gives no graphics (neither GOP nor UGA).\n");
        uefi::log("piii OS: no graphics");
        loop {
            uefi::stall(1_000_000);
        }
    };
    uefi::log(&format!("piii OS: {}", gfx));
    let (mut input, keys) = Input::open();
    let mut app = App::new(w, h);
    // the pointer's speed as it was left last time
    if let Some(v) = uefi::get_var("PiiiPointerSpeed") {
        if let Some(&i) = v.first() {
            app.set_speed(i as usize);
            uefi::log(&format!("piii OS: pointer speed {} (kept from last time)", i));
        }
    }
    let rev = uefi::st().hdr.rev;
    app.info.push(("Computer".into(), uefi::cpu()));
    app.info.push(("Firmware".into(), format!("{} (revision {:#x}), EFI {}.{}", uefi::vendor(), uefi::st().fw_rev, rev >> 16, (rev & 0xffff) / 10)));
    app.info.push(("Screen".into(), gfx));
    app.info.extend(keys);
    for (k, v) in &app.info {
        uefi::log(&format!("piii OS: {}: {}", k, v));
    }
    let mut scene = Frame::new(w, h);
    let mut before = Frame::new(w, h);
    let mut first = true;
    let mut shown = Frame::new(w, h);
    let mut events = Vec::new();
    let mut last_ptr = app.pointer_rect();
    let mut frames: u64 = 0;
    let mut net: Option<crate::net::Net> = None;
    // time, in the processor's own ticks: how many to a millisecond
    let tsc = uefi::tsc;
    let per_ms = uefi::clock_start();
    let (mut sec_start, mut looks, mut draws, mut worst, mut reports0) = (tsc(), 0u32, 0u32, 0u64, crate::usb::reports());
    loop {
        looks += 1;
        if tsc() - sec_start >= per_ms * 1000 {
            let r = crate::usb::reports();
            app.live = alloc::vec![
                ("Mouse reports".into(), format!("{} a second (a moving mouse sends 60 to 125)", r - reports0)),
                ("Looks a second".into(), format!("{} (how often piii OS reads the mouse and keys)", looks)),
                ("Drawing".into(), format!("{} whole drawings in the last second, the slowest {} ms", draws, worst / per_ms)),
            ];
            if app.devices_open() {
                app.dirty = true;
            }
            uefi::log(&format!("piii OS: second: {} reports, {} looks, {} drawings, slowest {} ms", r - reports0, looks, draws, worst / per_ms));
            reports0 = r;
            looks = 0;
            draws = 0;
            worst = 0;
            sec_start = tsc();
        }
        events.clear();
        input.poll(w, h, &mut events);
        let (px, py) = (app.px, app.py);
        for e in events.drain(..) {
            app.event(e);
        }
        app.event(Event::Tick(10));
        if app.speed_changed {
            app.speed_changed = false;
            let ok = uefi::set_var("PiiiPointerSpeed", &[app.speed() as u8]);
            uefi::log(&format!("piii OS: pointer speed {} {}", app.speed(), if ok { "kept" } else { "(could not be kept)" }));
        }
        if let Some(r) = app.request {
            uefi::log(&format!("piii OS: {:?}", r));
            uefi::reset(if r == Request::Restart { 0 } else { 2 });
        }
        let moved = app.px != px || app.py != py;
        if moved && app.hover_changed() {
            app.dirty = true;
        }
        if app.dirty {
            let started = tsc();
            // drawn whole, but only what changed goes to the screen (a hover, a dragged super: a small part of it)
            core::mem::swap(&mut scene, &mut before);
            app.draw(&mut scene);
            let changed = if first { Some(Rect::new(0.0, 0.0, w as f64, h as f64)) } else { changed(&before, &scene) };
            first = false;
            let now = app.pointer_rect();
            let r = match changed {
                Some(c) => {
                    copy_rect(&scene, &mut shown, c);
                    union(c, union(last_ptr, now))
                }
                None => union(last_ptr, now),
            };
            copy_rect(&scene, &mut shown, last_ptr);
            app.draw_pointer(&mut shown);
            screen.show(&mut shown, r);
            last_ptr = now;
            draws += 1;
            worst = worst.max(tsc() - started);
            frames += 1;
            if frames <= 3 || frames % 50 == 0 {
                uefi::log(&format!("piii OS: frame {}", frames));
            }
        } else if moved {
            // only the pointer moved: put back what was under it, draw it at its new place, show just there
            copy_rect(&scene, &mut shown, last_ptr);
            app.draw_pointer(&mut shown);
            let now = app.pointer_rect();
            screen.show(&mut shown, union(last_ptr, now));
            last_ptr = now;
        }
        // the browser asked for the network: done now, with "Loading…" already on the screen
        if !app.dirty {
            if let Some(fx) = app.fetch.take() {
                if net.is_none() {
                    match crate::net::Net::start() {
                        Ok(n) => {
                            app.set_network(&n.how);
                            net = Some(n);
                        }
                        Err(e) => {
                            uefi::log(&format!("piii OS: network: {}", e));
                            app.fetched(Err(e));
                        }
                    }
                }
                if let Some(n) = net.as_mut() {
                    let r = n.fetch(&fx.method, &fx.url, &fx.body, &fx.ctype);
                    uefi::log(&format!("piii OS: {} {}: {}", fx.method, fx.url, match &r { Ok((_, resp)) => format!("{} ({} bytes)", resp.status, resp.body.len()), Err(e) => e.clone() }));
                    app.fetched(r);
                }
                // what the mice did meanwhile is old: not a jump of the pointer
                let _ = input.mice.take();
            }
        }
        // about 250 looks a second (a mouse asked directly waits up to 1 ms of it): a mouse reports up to 125
        uefi::stall(3_000);
    }
}

#[panic_handler]
fn panic(info: &core::panic::PanicInfo) -> ! {
    let msg = format!("piii OS stopped: {}\n", info);
    uefi::log(&msg);
    if uefi::ready() {
        uefi::print(&msg);
    }
    loop {
        if uefi::ready() {
            uefi::stall(1_000_000);
        }
    }
}
