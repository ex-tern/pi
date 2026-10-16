//! piii OS's one program: the π canvas. Supers (superellipses, n = π) joined by wires; drag them, click one to open
//! it, π to come back. What runs here needs no internet: the Program language with piii.app's examples, the exact
//! constants (π, e, φ, γ), this machine's devices; the supers that need the lab's servers list what they hold.
//!
//! It knows nothing of the firmware: it is given events and a frame to draw in (main.rs on the machine, or a test
//! that writes pictures), and it asks for a restart or a power-off through `request`.

use crate::font::{BIG, SMALL};
use crate::gfx::*;
use crate::lang::{self, vtext, Program};
use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

pub const VERSION: &str = "0.1";

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Key {
    Up,
    Down,
    Left,
    Right,
    Enter,
    Space,
    Esc,
    Tab,
    BackTab,
    PageUp,
    PageDown,
    Home,
    Char(char),
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Event {
    /// a mouse moved by (dx, dy) pixels
    Move(f64, f64),
    /// a pointer at (x, y) on the screen (a touch pad or tablet giving where, not how far)
    At(f64, f64),
    /// the button went down (true) or up (false)
    Button(bool),
    Key(Key),
    /// time passing (milliseconds), for what moves by itself
    Tick(u32),
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Request {
    Restart,
    PowerOff,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum View {
    Canvas,
    Open(usize),
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Act {
    Super(usize),
    Back,
    Example(usize),
    Run,
    Step,
    Clear,
    Constant(usize),
    Digits(usize),
    Restart,
    PowerOff,
    Scroll(i64),
}

struct Super {
    name: &'static str,
    note: &'static str,
    /// centre, as a fraction of the canvas
    fx: f64,
    fy: f64,
    online: &'static [&'static str],
}

const SUPERS: [Super; 9] = [
    Super { name: "Welcome", note: "start here", fx: 0.20, fy: 0.24, online: &[] },
    Super { name: "Program", note: "5 programs", fx: 0.50, fy: 0.24, online: &[] },
    Super { name: "Numbers", note: "π e φ γ", fx: 0.80, fy: 0.24, online: &[] },
    Super {
        name: "Tools",
        note: "online",
        fx: 0.20,
        fy: 0.52,
        online: &["Assess Manuscripts [Pi]", "Assist Diagnosis [Intern]", "Face Mace", "piii VPN", "Super AI", "RiBD"],
    },
    Super {
        name: "Explore",
        note: "online",
        fx: 0.50,
        fy: 0.52,
        online: &["Leaderboards", "Proof-of-Research Ledger Explorer", "Recent assessments"],
    },
    Super {
        name: "Library",
        note: "online",
        fx: 0.80,
        fy: 0.52,
        online: &["The Global Map of Science", "Whitepaper", "Architecture", "Capabilities", "Learn to program", "Assessment results", "The journal"],
    },
    Super { name: "Lab", note: "online", fx: 0.20, fy: 0.80, online: &["QuVI", "HAL-OS", "Unigyro", "Neuro Frenzy", "MD"] },
    Super {
        name: "Connect",
        note: "online",
        fx: 0.50,
        fy: 0.80,
        online: &["Your account", "Research profile", "piQ held for you", "Private projects", "Support Pi", "Contact us"],
    },
    Super { name: "Devices", note: "this machine", fx: 0.80, fy: 0.80, online: &[] },
];

/// (from, to, a control wire (dashed, top to bottom) rather than a flow wire (left to right))
const WIRES: [(usize, usize, bool); 9] = [(0, 1, false), (1, 2, false), (3, 4, false), (4, 5, false), (6, 7, false), (7, 8, false), (0, 3, true), (1, 4, true), (4, 7, true)];

const CONSTS: [(&str, &str, &str); 4] = [
    ("π", "pi", "Machin: 16·atan(1/5) − 4·atan(1/239)"),
    ("e", "e", "the sum of 1/k!"),
    ("φ", "phi", "(1 + √5)/2"),
    ("γ", "gamma", "Euler's constant, by Brent and McMillan"),
];
const DIGITS: [usize; 4] = [100, 1000, 5000, 20000];

pub struct App {
    pub w: usize,
    pub h: usize,
    view: View,
    /// where each super's centre is, in pixels (moved by dragging)
    pos: Vec<(f64, f64)>,
    pub px: f64,
    pub py: f64,
    down: bool,
    press: Option<(f64, f64, Option<Act>)>,
    drag: Option<(usize, f64, f64)>,
    moved: bool,
    focus: Option<usize>,
    hits: Vec<(Rect, Act)>,
    prog: Program,
    example: usize,
    konst: usize,
    digits: usize,
    numbers: Option<String>,
    computing: bool,
    scroll: i64,
    armed: Option<Act>,
    /// what the machine is: shown in Devices (given by main.rs)
    pub info: Vec<(String, String)>,
    pub request: Option<Request>,
    /// the screen must be drawn again
    pub dirty: bool,
    key_run: u32,
    hovered: Option<Act>,
}

impl App {
    pub fn new(w: usize, h: usize) -> App {
        let mut a = App {
            w,
            h,
            view: View::Canvas,
            pos: Vec::new(),
            // the pointer starts on the header, not on a super (Tab then begins at the first)
            px: w as f64 / 2.0,
            py: 28.0,
            down: false,
            press: None,
            drag: None,
            moved: false,
            focus: None,
            hits: Vec::new(),
            prog: lang::example(0),
            example: 0,
            konst: 0,
            digits: 1,
            numbers: None,
            computing: false,
            scroll: 0,
            armed: None,
            info: Vec::new(),
            request: None,
            dirty: true,
            key_run: 0,
            hovered: None,
        };
        a.layout();
        a
    }

    fn layout(&mut self) {
        let top = 70.0;
        let (cw, ch) = (self.w as f64, self.h as f64 - top - 40.0);
        self.pos = SUPERS.iter().map(|s| (s.fx * cw, top + s.fy * ch)).collect();
    }

    fn sz(&self) -> (f64, f64) {
        let k = (self.w as f64 / 1440.0).min(self.h as f64 / 900.0).clamp(0.6, 1.6);
        (220.0 * k, 132.0 * k)
    }

    fn super_rect(&self, i: usize) -> Rect {
        let (w, h) = self.sz();
        let (cx, cy) = self.pos[i];
        Rect::new(cx - w / 2.0, cy - h / 2.0, w, h)
    }

    // ------------------------------------------------------------------------------------------------ events

    pub fn event(&mut self, e: Event) {
        match e {
            Event::Move(dx, dy) => {
                self.move_to(self.px + dx, self.py + dy);
                self.key_run = 0;
            }
            Event::At(x, y) => self.move_to(x, y),
            Event::Button(true) => self.press_at(),
            Event::Button(false) => self.release(),
            Event::Key(k) => self.key(k),
            Event::Tick(_) => {
                if self.computing {
                    self.compute();
                }
            }
        }
    }

    fn move_to(&mut self, x: f64, y: f64) {
        let (x, y) = (x.clamp(0.0, self.w as f64 - 1.0), y.clamp(0.0, self.h as f64 - 1.0));
        if let Some((i, ox, oy)) = self.drag {
            let (w, h) = self.sz();
            let nx = (x - ox).clamp(w / 2.0, self.w as f64 - w / 2.0);
            let ny = (y - oy).clamp(70.0 + h / 2.0, self.h as f64 - h / 2.0);
            if (nx - self.pos[i].0).abs() + (ny - self.pos[i].1).abs() > 0.0 {
                self.pos[i] = (nx, ny);
                self.dirty = true;
            }
        }
        if let Some((sx, sy, _)) = self.press {
            if (x - sx).abs() + (y - sy).abs() > 5.0 {
                self.moved = true;
            }
        }
        self.px = x;
        self.py = y;
    }

    fn hit(&self, x: f64, y: f64) -> Option<Act> {
        // last drawn is on top
        self.hits.iter().rev().find(|(r, a)| match a {
            Act::Super(_) => r.has_super(x, y),
            _ => r.has(x, y),
        }).map(|(_, a)| *a)
    }

    /// whether what is under the pointer changed since last asked (its highlight must be drawn again)
    pub fn hover_changed(&mut self) -> bool {
        let h = self.hit(self.px, self.py);
        if h != self.hovered {
            self.hovered = h;
            true
        } else {
            false
        }
    }

    fn press_at(&mut self) {
        self.down = true;
        self.moved = false;
        let a = self.hit(self.px, self.py);
        self.press = Some((self.px, self.py, a));
        if let (View::Canvas, Some(Act::Super(i))) = (self.view, a) {
            self.drag = Some((i, self.px - self.pos[i].0, self.py - self.pos[i].1));
            self.focus = Some(i);
            self.dirty = true;
        }
    }

    fn release(&mut self) {
        self.down = false;
        let pressed = self.press.take();
        self.drag = None;
        if self.moved {
            return;
        }
        if let Some((_, _, Some(a))) = pressed {
            if self.hit(self.px, self.py) == Some(a) {
                self.act(a);
            }
        }
    }

    /// what Tab goes through: the supers on the canvas, the buttons on a page
    fn focusables(&self) -> Vec<(Rect, Act)> {
        self.hits.iter().filter(|(_, a)| !matches!(a, Act::Scroll(_))).cloned().collect()
    }

    fn key(&mut self, k: Key) {
        // arrows move the pointer (faster when held), so the keyboard alone can do everything
        let step = |run: u32| -> f64 { (8.0 + run as f64 * 6.0).min(48.0) };
        match k {
            Key::Up | Key::Down | Key::Left | Key::Right => {
                let s = step(self.key_run);
                self.key_run += 1;
                let (dx, dy) = match k {
                    Key::Up => (0.0, -s),
                    Key::Down => (0.0, s),
                    Key::Left => (-s, 0.0),
                    _ => (s, 0.0),
                };
                self.move_to(self.px + dx, self.py + dy);
                if self.down {
                    // a key-held drag: a click-hold is Space down, then arrows
                }
            }
            Key::Enter | Key::Space => {
                self.key_run = 0;
                match self.hit(self.px, self.py) {
                    Some(a) => self.act(a),
                    None => {}
                }
            }
            Key::Esc => {
                self.key_run = 0;
                if self.view != View::Canvas {
                    self.act(Act::Back);
                }
            }
            Key::Tab | Key::BackTab => {
                self.key_run = 0;
                let f = self.focusables();
                if f.is_empty() {
                    return;
                }
                let cur = f.iter().position(|(r, a)| {
                    if let Act::Super(_) = a { r.has_super(self.px, self.py) } else { r.has(self.px, self.py) }
                });
                let n = f.len();
                let next = match (cur, k) {
                    (None, Key::BackTab) => n - 1,
                    (None, _) => 0,
                    (Some(c), Key::BackTab) => (c + n - 1) % n,
                    (Some(c), _) => (c + 1) % n,
                };
                let (r, a) = f[next];
                self.px = r.cx();
                self.py = r.cy();
                if let Act::Super(i) = a {
                    self.focus = Some(i);
                }
                self.dirty = true;
            }
            Key::PageDown => self.act(Act::Scroll(10)),
            Key::PageUp => self.act(Act::Scroll(-10)),
            Key::Home => {
                self.key_run = 0;
                self.view = View::Canvas;
                self.dirty = true;
            }
            Key::Char(c) => {
                self.key_run = 0;
                // in Program, 1 to 5 load the examples, r runs, s steps, c clears
                if let View::Open(1) = self.view {
                    match c {
                        '1'..='5' => self.act(Act::Example(c as usize - '1' as usize)),
                        'r' | 'R' => self.act(Act::Run),
                        's' | 'S' => self.act(Act::Step),
                        'c' | 'C' => self.act(Act::Clear),
                        _ => {}
                    }
                }
            }
        }
    }

    fn act(&mut self, a: Act) {
        self.dirty = true;
        if self.armed.is_some() && self.armed != Some(a) {
            self.armed = None;
        }
        match a {
            Act::Super(i) => {
                self.view = View::Open(i);
                self.scroll = 0;
                self.focus = Some(i);
                if i == 2 && self.numbers.is_none() {
                    self.computing = true;
                }
            }
            Act::Back => {
                if let View::Open(i) = self.view {
                    let r = self.super_rect(i);
                    self.px = r.cx();
                    self.py = r.cy();
                }
                self.view = View::Canvas;
            }
            Act::Example(i) => {
                self.example = i;
                self.prog = lang::example(i);
            }
            Act::Run => self.prog.run(None),
            Act::Step => self.prog.run(Some(1)),
            Act::Clear => self.prog.clear(),
            Act::Constant(i) => {
                self.konst = i;
                self.numbers = None;
                self.computing = true;
                self.scroll = 0;
            }
            Act::Digits(i) => {
                self.digits = i;
                self.numbers = None;
                self.computing = true;
                self.scroll = 0;
            }
            Act::Scroll(d) => self.scroll = (self.scroll + d).max(0),
            Act::Restart | Act::PowerOff => {
                // pressed twice: the first press asks "sure?"
                if self.armed == Some(a) {
                    self.request = Some(if a == Act::Restart { Request::Restart } else { Request::PowerOff });
                } else {
                    self.armed = Some(a);
                }
            }
        }
    }

    /// The constant asked for, worked out (on the next tick, so "Computing…" shows first).
    fn compute(&mut self) {
        if !self.dirty_shown_computing() {
            return;
        }
        let (_, key, _) = CONSTS[self.konst];
        let d = DIGITS[self.digits];
        self.numbers = Some(numbers::handle(&format!("{} {}", key, d)));
        self.computing = false;
        self.dirty = true;
    }

    /// whether "Computing…" has been on the screen (drawn after the request, before the work)
    fn dirty_shown_computing(&self) -> bool {
        !self.dirty
    }

    // ------------------------------------------------------------------------------------------------ drawing

    pub fn draw(&mut self, f: &mut Frame) {
        self.hits.clear();
        f.clear(PAPER);
        match self.view {
            View::Canvas => self.draw_canvas(f),
            View::Open(i) => self.draw_open(f, i),
        }
        self.dirty = false;
    }

    fn header(&mut self, f: &mut Frame, title: &str, back: bool) {
        let bar = Rect::new(0.0, 0.0, self.w as f64, 56.0);
        f.rect(bar, CARD);
        f.rect(Rect::new(0.0, 55.0, self.w as f64, 1.0), LINE);
        // π: the canvas (on the canvas itself, the mark)
        let pi = Rect::new(14.0, 8.0, 52.0, 40.0);
        f.superellipse(pi, Some(INK), INK, 0.0);
        f.text_center(&BIG, pi.cx(), pi.y + 4.0, "π", CARD, 1);
        if back {
            self.hits.push((pi, Act::Back));
        }
        f.text(&BIG, 80.0, 12.0, title, INK, 1);
        let ver = format!("piii OS {}", VERSION);
        let vw = Frame::text_w(&SMALL, &ver, 1);
        f.text(&SMALL, self.w as f64 - vw - 18.0, 20.0, &ver, MUTED, 1);
    }

    fn draw_canvas(&mut self, f: &mut Frame) {
        self.header(f, "piii", false);
        // wires under the supers
        for (a, b, ctl) in WIRES {
            let (ra, rb) = (self.super_rect(a), self.super_rect(b));
            if ctl {
                f.wire((ra.cx(), ra.y + ra.h), (rb.cx(), rb.y), MUTED, Some((7.0, 6.0)), true);
            } else {
                f.wire((ra.x + ra.w, ra.cy()), (rb.x, rb.cy()), FLOW, None, false);
            }
        }
        for i in 0..SUPERS.len() {
            let r = self.super_rect(i);
            let s = &SUPERS[i];
            let on = self.focus == Some(i) || r.has_super(self.px, self.py);
            f.superellipse(r, Some(CARD), if on { ACCENT } else { INK }, if on { 3.0 } else { 2.0 });
            // the four terminals: in (left), out (right), control (top), gate (bottom)
            for (tx, ty) in [(r.x, r.cy()), (r.x + r.w, r.cy()), (r.cx(), r.y), (r.cx(), r.y + r.h)] {
                f.disc(tx, ty, 5.5, CARD);
                f.superellipse(Rect::new(tx - 5.0, ty - 5.0, 10.0, 10.0), Some(CARD), INK, 1.6);
            }
            f.text_center(&BIG, r.cx(), r.cy() - 26.0, s.name, INK, 1);
            f.text_center(&SMALL, r.cx(), r.cy() + 12.0, s.note, if s.online.is_empty() { MUTED } else { WARN }, 1);
            self.hits.push((r, Act::Super(i)));
        }
        let hint = "Drag a super to move it · click to open · π comes back · arrows move the pointer, Enter clicks, Tab goes to the next";
        f.text_center(&SMALL, self.w as f64 / 2.0, self.h as f64 - 28.0, hint, MUTED, 1);
    }

    fn button(&mut self, f: &mut Frame, x: f64, y: f64, label: &str, a: Act, on: bool) -> f64 {
        let w = Frame::text_w(&SMALL, label, 1) + 28.0;
        let r = Rect::new(x, y, w, 34.0);
        let hover = r.has(self.px, self.py);
        f.superellipse(r, Some(if on { INK } else { CARD }), if hover { ACCENT } else { INK }, if hover { 2.4 } else { 1.6 });
        f.text_center(&SMALL, r.cx(), y + 9.0, label, if on { CARD } else { INK }, 1);
        self.hits.push((r, a));
        w
    }

    fn draw_open(&mut self, f: &mut Frame, i: usize) {
        let s = &SUPERS[i];
        self.header(f, s.name, true);
        let (x, y, w) = (40.0, 84.0, self.w as f64 - 80.0);
        match i {
            0 => self.welcome(f, x, y, w),
            1 => self.program(f, x, y, w),
            2 => self.numbers_view(f, x, y, w),
            8 => self.devices(f, x, y, w),
            _ => self.online(f, i, x, y, w),
        }
    }

    fn welcome(&mut self, f: &mut Frame, x: f64, y: f64, w: f64) {
        let w = w.min(860.0);
        let mut yy = y;
        f.text(&BIG, x, yy, "This computer runs piii.", INK, 1);
        yy += 52.0;
        let text = "piii OS is the π canvas as a whole operating system: nothing runs underneath it. It starts \
                    straight from the computer's firmware, draws every super, wire and letter itself, and listens to \
                    the keyboard and the mouse on its own.\n\n\
                    Everything is a super, a box with four terminals: in on the left, out on the right, control on \
                    top and gate at the bottom. Wires carry what a super gives to the next one. Drag a super to move \
                    it, click it to open it, and press π (or Esc) to come back.\n\n\
                    Program runs piii's dataflow language, the same one as on www.piii.app, with its five examples: \
                    counting, a factorial, Fibonacci, Euclid's greatest common divisor and a Turing machine. Numbers \
                    works out π, e, φ and γ exactly, to as many digits as you ask. Devices shows what this machine \
                    is, and restarts or switches it off.\n\n\
                    Tools, Explore, Library, Lab and Connect live on the lab's servers. piii OS does not reach the \
                    internet yet, so they list what they hold; open www.piii.app on another device to use them.\n\n\
                    No mouse? The arrow keys move the pointer, Enter or Space clicks, and Tab jumps to the next \
                    thing to click.";
        f.para(&SMALL, x, yy, w, text, INK);
    }

    fn program(&mut self, f: &mut Frame, x: f64, y: f64, w: f64) {
        // the examples, and the run controls
        let mut bx = x;
        for (k, ex) in lang::EXAMPLES.iter().enumerate() {
            let label = format!("{} {}", k + 1, ex.0);
            bx += self.button(f, bx, y, &label, Act::Example(k), self.example == k) + 8.0;
        }
        let y2 = y + 46.0;
        let mut cx = x;
        cx += self.button(f, cx, y2, "Run", Act::Run, false) + 8.0;
        cx += self.button(f, cx, y2, "Step", Act::Step, false) + 8.0;
        self.button(f, cx, y2, "Clear", Act::Clear, false);
        let status = self.prog.status.clone();
        f.text(&SMALL, cx + 100.0, y2 + 9.0, &status, MUTED, 1);
        let about = self.prog.about.clone();
        f.text(&SMALL, x, y2 + 46.0, &about, INK, 1);
        // the diagram, scaled into the space left
        let area = Rect::new(x, y2 + 76.0, w, self.h as f64 - (y2 + 76.0) - 20.0);
        f.rect(area, CARD);
        f.frame(area, 1.0, LINE);
        let (mut maxx, mut maxy) = (1.0f64, 1.0f64);
        for n in &self.prog.nodes {
            maxx = maxx.max(n.x + 150.0);
            maxy = maxy.max(n.y + 60.0);
        }
        let k = ((area.w - 160.0) / maxx).min((area.h - 50.0) / maxy).min(1.6);
        // centred, with room at the sides for wires that run back
        let ox = area.x + (area.w - maxx * k) / 2.0;
        let place = |nx: f64, ny: f64| (ox + nx * k, area.y + 20.0 + ny * k);
        let nw = |t: &str| -> f64 { (Frame::text_w(&SMALL, t, 1) + 30.0).max(64.0) };
        let nh = 40.0;
        let rect_of = |i: usize, p: &Program| -> Rect {
            let n = &p.nodes[i];
            let (px, py) = place(n.x, n.y);
            Rect::new(px, py, nw(&n.text), nh)
        };
        for &(a, b, _) in &self.prog.wires {
            let (ra, rb) = (rect_of(a, &self.prog), rect_of(b, &self.prog));
            f.wire((ra.x + ra.w, ra.cy()), (rb.x, rb.cy()), FLOW, None, false);
        }
        for i in 0..self.prog.nodes.len() {
            let r = rect_of(i, &self.prog);
            let reg = self.prog.is_register(i);
            f.superellipse(r, Some(if reg { SOFT } else { CARD }), INK, 1.6);
            let t = self.prog.nodes[i].text.clone();
            f.text_center(&SMALL, r.cx(), r.cy() - 8.0, &t, INK, 1);
            if let Some(v) = self.prog.value(i) {
                let mut s = vtext(v);
                if s.chars().count() > 28 {
                    s = s.chars().take(27).collect::<String>() + "…";
                }
                f.text(&SMALL, r.x + 4.0, r.y + r.h + 2.0, &s, ACCENT, 1);
            }
        }
    }

    fn numbers_view(&mut self, f: &mut Frame, x: f64, y: f64, w: f64) {
        let mut bx = x;
        for (k, c) in CONSTS.iter().enumerate() {
            bx += self.button(f, bx, y, c.0, Act::Constant(k), self.konst == k) + 8.0;
        }
        bx += 24.0;
        for (k, d) in DIGITS.iter().enumerate() {
            let label = format!("{} digits", d);
            bx += self.button(f, bx, y, &label, Act::Digits(k), self.digits == k) + 8.0;
        }
        let (sym, _, how) = CONSTS[self.konst];
        f.text(&SMALL, x, y + 48.0, &format!("{} to {} digits after the point, exactly: {}", sym, DIGITS[self.digits], how), MUTED, 1);
        let top = y + 80.0;
        let box_ = Rect::new(x, top, w, self.h as f64 - top - 20.0);
        f.rect(box_, CARD);
        f.frame(box_, 1.0, LINE);
        match &self.numbers {
            None => {
                f.text(&BIG, x + 20.0, top + 20.0, "Computing…", MUTED, 1);
            }
            Some(n) => {
                let per = ((box_.w - 40.0) / SMALL.w as f64) as usize;
                // digits in groups of ten, as they read best
                let mut grouped = String::new();
                let (int, frac) = n.split_once('.').unwrap_or((n.as_str(), ""));
                grouped.push_str(int);
                grouped.push('.');
                for (k, c) in frac.chars().enumerate() {
                    if k > 0 && k % 10 == 0 {
                        grouped.push(' ');
                    }
                    grouped.push(c);
                }
                let lines = wrap(&grouped, per - per % 11);
                let fit = ((box_.h - 40.0) / (SMALL.h as f64 + 4.0)) as usize;
                let max_scroll = lines.len().saturating_sub(fit) as i64;
                if self.scroll > max_scroll {
                    self.scroll = max_scroll;
                }
                let mut yy = top + 20.0;
                for line in lines.iter().skip(self.scroll as usize).take(fit) {
                    f.text(&SMALL, x + 20.0, yy, line, INK, 1);
                    yy += SMALL.h as f64 + 4.0;
                }
                if max_scroll > 0 {
                    let up = Rect::new(box_.x + box_.w - 50.0, top + 10.0, 36.0, 36.0);
                    let dn = Rect::new(box_.x + box_.w - 50.0, box_.y + box_.h - 46.0, 36.0, 36.0);
                    f.superellipse(up, Some(CARD), INK, 1.6);
                    f.poly(&[(up.cx(), up.y + 10.0), (up.x + 9.0, up.y + 25.0), (up.x + 27.0, up.y + 25.0)], INK);
                    f.superellipse(dn, Some(CARD), INK, 1.6);
                    f.poly(&[(dn.cx(), dn.y + 26.0), (dn.x + 9.0, dn.y + 11.0), (dn.x + 27.0, dn.y + 11.0)], INK);
                    self.hits.push((up, Act::Scroll(-10)));
                    self.hits.push((dn, Act::Scroll(10)));
                    let msg = format!("lines {}–{} of {} · Page Up / Page Down", self.scroll + 1, (self.scroll as usize + fit).min(lines.len()), lines.len());
                    f.text(&SMALL, x + 20.0, box_.y + box_.h - 26.0, &msg, MUTED, 1);
                }
            }
        }
    }

    fn devices(&mut self, f: &mut Frame, x: f64, y: f64, w: f64) {
        let mut yy = y;
        let info = self.info.clone();
        for (k, v) in &info {
            f.text(&SMALL, x, yy, k, MUTED, 1);
            let h = f.para(&SMALL, x + 190.0, yy, (w - 190.0).min(900.0), v, INK);
            yy += h.max(20.0) + 6.0;
        }
        yy += 10.0;
        let note = "A Bluetooth mouse works here when the Mac's Bluetooth hands it to the firmware as an ordinary mouse \
                    (Apple's HID proxy). Pair it once in macOS before macOS is replaced, and it keeps working at start-up. \
                    If no pointer is listed above, the arrow keys move the pointer.";
        yy += f.para(&SMALL, x, yy, w.min(900.0), note, MUTED) + 20.0;
        let r1 = if self.armed == Some(Act::Restart) { "Restart: sure?" } else { "Restart" };
        let r2 = if self.armed == Some(Act::PowerOff) { "Switch off: sure?" } else { "Switch off" };
        let bw = self.button(f, x, yy, r1, Act::Restart, self.armed == Some(Act::Restart));
        self.button(f, x + bw + 10.0, yy, r2, Act::PowerOff, self.armed == Some(Act::PowerOff));
    }

    fn online(&mut self, f: &mut Frame, i: usize, x: f64, y: f64, w: f64) {
        let s = &SUPERS[i];
        let mut yy = y;
        f.para(&SMALL, x, yy, w.min(860.0), "This super lives on the lab's servers. piii OS does not reach the internet yet; open www.piii.app on another device to use what it holds:", MUTED);
        yy += 56.0;
        for name in s.online {
            let r = Rect::new(x, yy, (w).min(520.0), 40.0);
            f.superellipse(r, Some(CARD), LINE, 1.4);
            f.text(&SMALL, r.x + 18.0, r.y + 12.0, name, INK, 1);
            yy += 50.0;
        }
    }

    // ------------------------------------------------------------------------------------------------ the pointer

    /// The pointer arrow at (px, py), drawn over a frame.
    pub fn draw_pointer(&self, f: &mut Frame) {
        let (x, y) = (self.px, self.py);
        let pts = [(x, y), (x, y + 19.0), (x + 4.5, y + 15.0), (x + 8.0, y + 22.0), (x + 11.0, y + 20.5), (x + 7.5, y + 14.0), (x + 13.5, y + 14.0)];
        let out: Vec<(f64, f64)> = pts.iter().map(|p| (p.0, p.1)).collect();
        f.stroke(&[out[0], out[1], out[2], out[3], out[4], out[5], out[6], out[0]], 3.0, CARD, None);
        f.poly(&pts, INK);
    }

    /// the pointer's box (to redraw just there when only it moves)
    pub fn pointer_rect(&self) -> Rect {
        Rect::new(self.px - 3.0, self.py - 3.0, 20.0, 29.0)
    }
}
