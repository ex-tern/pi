// HAL-OS in the browser, in Rust. An 8086 with the 386 pieces HAL-OS uses (32-bit EAX forms, CR0, LGDT, FS and
// GS), a BIOS written at a high level (video 10h, memory 12h/15h, disk 13h with the LBA extensions, keyboard 16h,
// clock 1Ah), a text screen at B800:0, VGA mode 13h with its palette, PCI configuration space, a serial line both
// ways and a second disk for the network's weights. It boots the HAL-OS shell (hal/shell.asm, built with nasm into
// shell.bin) from sector 0 the way a PC does; the shell's `hal` command boots the ternary network (hal/bitllm.bin,
// built by the HAL-OS repository's bitllm_kernel.py), which paints the screen and learns from whatever is sent down
// the serial line — the portal below the screen. The old page did this with v86 in JavaScript. Included into app.rs.

const HAL_IMG: &[u8] = include_bytes!("../hal/shell.bin");
/// The ternary network's boot disk: bitllm_kernel.py of the HAL-OS repository, built and trimmed of its padding.
const NET_IMG: &[u8] = include_bytes!("../hal/bitllm.bin");
const HAL_MARKER: &str = "\x1bHAL-OS:BOOT-NETWORK\n";
const T_HAL: u32 = 33;
const HAL_TOKEN: u32 = 4_000_000;
const MEM: usize = 0x110000;
// the network's side of the agreement (bitllm_kernel.py; checked when bitllm.bin is built)
const NET_W: usize = 320;
const NET_H: usize = 100;
const SLOTS: usize = NET_W * NET_H;
const OUT_LO: u8 = 4;
const CUBE: u32 = 6;
const KEY_BAND_START: usize = 30720;
const FRAME_ADDR: usize = 0x0600;
const DBOK_ADDR: usize = 0x065E;
const WEIGHT_MAGIC: u16 = 0xB17B;
const HAL_WEIGHT_BYTES: usize = (8 + 8 * 2 * 64) * 512;
const MAX_SEG: usize = 0x7F00;
const MIN_RUN: usize = 12;
const BRIDGE: usize = 12;
const CMD_WIRE_BASE: u16 = 0xFE00;
const WEIGHTS_KEY: &str = "piii:hal-weights";

const CF: u16 = 1;
const PF: u16 = 4;
const AF: u16 = 16;
const ZF: u16 = 64;
const SF: u16 = 128;
const IF: u16 = 512;
const DF: u16 = 1024;
const OF: u16 = 2048;
// registers, by their encoding
const AX: usize = 0;
const CX: usize = 1;
const DX: usize = 2;
const BX: usize = 3;
const SP: usize = 4;
const BP: usize = 5;
const SI: usize = 6;
const DI: usize = 7;
const ES: usize = 0;
const CS: usize = 1;
const SS: usize = 2;
const DS: usize = 3;

#[derive(Default)]
pub struct Hal {
    on: bool,
    mem: Vec<u8>,
    r: [u16; 8],
    hi: [u16; 8],
    s: [u16; 6],
    ip: u16,
    fl: u16,
    cr0: u32,
    halted: bool,
    waiting: bool,
    keys: Vec<(u8, u8)>,
    cur: (u8, u8),
    serial: String,
    note: String,
    dirty: bool,
    steps: u64,
    seg_ovr: Option<usize>,
    opsize: bool,
    ticking: bool,
    // the PC around the processor
    net: bool,
    pci: u32,
    gfx: bool,
    gc_idx: u8,
    retrace: bool,
    dac: Vec<u8>,
    dac_w: usize,
    dac_r: usize,
    rx: alloc::collections::VecDeque<u8>,
    /// bytes the line may still deliver in this slice of time: a UART runs at a baud rate, and the kernel only
    /// renders between bursts, so an unthrottled line would leave it decoding forever
    rx_budget: f64,
    rx_t: f64,
    vdirty: bool,
    weights: Vec<u8>,
    rgba: Vec<u8>,
    // the portal (network mode)
    p: Portal,
}

#[derive(Default)]
struct Portal {
    source: String,
    images: Vec<Vec<u8>>,
    img_at: usize,
    img_since: f64,
    loading: usize,
    text: String,
    armed: bool,
    fps: u32,
    keyframe_every: u32,
    prev: Option<Vec<u8>>,
    canvas: Vec<u8>,
    nframes: u32,
    sine_t: usize,
    last_send: f64,
    sent: u64,
    trained: u64,
    last_frame: Option<Vec<u8>>,
    preview: Option<Vec<u8>>,
    readback: Option<Vec<u8>>,
    dump: Option<Vec<u8>>,
    dump_since: f64,
    dump_wait: bool,
    rb_note: String,
    hint: String,
    chan_keys: bool,
    chan_mouse: bool,
    typed: Vec<u8>,
    key_ptr: usize,
    mouse: Option<(usize, usize)>,
    program: String,
    stats_t: f64,
    stats_frame: u16,
    stats_sent: u64,
    fps_guest: f64,
    rate: f64,
    reset_armed: bool,
    lfsr: u32,
    restored: Option<bool>,
}

enum Rm {
    Reg(usize),
    Mem(usize, u16),
}

fn parity(v: u8) -> bool {
    v.count_ones() % 2 == 0
}

impl Hal {
    fn disk(&self) -> &'static [u8] {
        if self.net { NET_IMG } else { HAL_IMG }
    }

    fn boot(&mut self) {
        self.mem = alloc::vec![0u8; MEM];
        let img = self.disk();
        let n = 512.min(img.len());
        self.mem[0x7C00..0x7C00 + n].copy_from_slice(&img[..n]);
        self.r = [0; 8];
        self.hi = [0; 8];
        self.s = [0; 6];
        self.cr0 = 0;
        self.r[DX] = 0x80;
        self.r[SP] = 0x7C00;
        self.ip = 0x7C00;
        self.fl = 2 | IF;
        self.halted = false;
        self.waiting = false;
        self.keys.clear();
        self.serial.clear();
        self.note.clear();
        self.cur = (0, 0);
        self.steps = 0;
        self.gfx = false;
        self.rx.clear();
        self.dac = alloc::vec![0u8; 768];
        self.rgba = alloc::vec![0u8; 320 * 200 * 4];
        if self.weights.len() != HAL_WEIGHT_BYTES {
            self.weights = alloc::vec![0u8; HAL_WEIGHT_BYTES];
        }
        for i in 0..2000 {
            self.mem[0xB8000 + i * 2] = b' ';
            self.mem[0xB8000 + i * 2 + 1] = 0x07;
        }
        self.p.prev = None;
        self.p.dump = None;
        self.p.restored = None;
        self.dirty = true;
        self.vdirty = true;
        self.on = true;
    }

    fn boot_net(&mut self) {
        self.net = true;
        // what it learned before, if this browser kept it
        if let Some(b) = host::store_get(WEIGHTS_KEY).and_then(|t| b64_decode(&t)) {
            if b.len() == HAL_WEIGHT_BYTES && u16::from_le_bytes([b[0], b[1]]) == WEIGHT_MAGIC {
                self.weights = b;
            }
        }
        self.boot();
        if self.p.fps == 0 {
            self.p.fps = 8;
            self.p.keyframe_every = 8;
            self.p.source = "none".into();
            self.p.chan_keys = true;
            self.p.chan_mouse = true;
        }
        self.p.canvas = alloc::vec![OUT_LO; SLOTS];
        self.p.key_ptr = KEY_BAND_START;
        self.p.hint = "Pick a source, then press INJECT. Nothing goes on the wire until you do.".into();
    }

    // -------------------------------------------------------------- memory
    fn lin(seg: u16, off: u16) -> usize {
        (((seg as usize) << 4) + off as usize) & 0xFFFFF
    }
    fn rb(&self, seg: u16, off: u16) -> u8 {
        self.mem[Self::lin(seg, off)]
    }
    fn rw(&self, seg: u16, off: u16) -> u16 {
        self.rb(seg, off) as u16 | (self.rb(seg, off.wrapping_add(1)) as u16) << 8
    }
    fn wb(&mut self, seg: u16, off: u16, v: u8) {
        let a = Self::lin(seg, off);
        if (0xB8000..0xB8FA0).contains(&a) {
            self.dirty = true;
        } else if (0xA0000..0xAFA00).contains(&a) {
            self.vdirty = true;
        }
        if a < 0xF0000 {
            self.mem[a] = v;
        }
    }
    fn ww(&mut self, seg: u16, off: u16, v: u16) {
        self.wb(seg, off, v as u8);
        self.wb(seg, off.wrapping_add(1), (v >> 8) as u8);
    }
    fn fetch8(&mut self) -> u8 {
        let v = self.rb(self.s[CS], self.ip);
        self.ip = self.ip.wrapping_add(1);
        v
    }
    fn fetch16(&mut self) -> u16 {
        let lo = self.fetch8() as u16;
        lo | (self.fetch8() as u16) << 8
    }
    fn fetch32(&mut self) -> u32 {
        let lo = self.fetch16() as u32;
        lo | (self.fetch16() as u32) << 16
    }
    fn push(&mut self, v: u16) {
        self.r[SP] = self.r[SP].wrapping_sub(2);
        let (ss, sp) = (self.s[SS], self.r[SP]);
        self.ww(ss, sp, v);
    }
    fn pop(&mut self) -> u16 {
        let v = self.rw(self.s[SS], self.r[SP]);
        self.r[SP] = self.r[SP].wrapping_add(2);
        v
    }

    // -------------------------------------------------------------- registers
    fn r8(&self, i: usize) -> u8 {
        if i < 4 { self.r[i] as u8 } else { (self.r[i - 4] >> 8) as u8 }
    }
    fn set_r8(&mut self, i: usize, v: u8) {
        if i < 4 {
            self.r[i] = (self.r[i] & 0xFF00) | v as u16;
        } else {
            self.r[i - 4] = (self.r[i - 4] & 0x00FF) | (v as u16) << 8;
        }
    }
    fn r32(&self, i: usize) -> u32 {
        self.r[i] as u32 | (self.hi[i] as u32) << 16
    }
    fn set_r32(&mut self, i: usize, v: u32) {
        self.r[i] = v as u16;
        self.hi[i] = (v >> 16) as u16;
    }
    fn flag(&self, f: u16) -> bool {
        self.fl & f != 0
    }
    fn set_flag(&mut self, f: u16, on: bool) {
        if on { self.fl |= f } else { self.fl &= !f }
    }

    // -------------------------------------------------------------- addressing
    fn modrm(&mut self) -> (usize, usize, Rm) {
        let b = self.fetch8();
        let (md, reg, rm) = ((b >> 6) as usize, ((b >> 3) & 7) as usize, (b & 7) as usize);
        if md == 3 {
            return (md, reg, Rm::Reg(rm));
        }
        let (base, seg): (u16, usize) = match rm {
            0 => (self.r[BX].wrapping_add(self.r[SI]), DS),
            1 => (self.r[BX].wrapping_add(self.r[DI]), DS),
            2 => (self.r[BP].wrapping_add(self.r[SI]), SS),
            3 => (self.r[BP].wrapping_add(self.r[DI]), SS),
            4 => (self.r[SI], DS),
            5 => (self.r[DI], DS),
            6 => if md == 0 { (0, DS) } else { (self.r[BP], SS) },
            _ => (self.r[BX], DS),
        };
        let disp: u16 = match md {
            0 if rm == 6 => self.fetch16(),
            0 => 0,
            1 => self.fetch8() as i8 as i16 as u16,
            _ => self.fetch16(),
        };
        let seg = self.seg_ovr.unwrap_or(seg);
        (md, reg, Rm::Mem(seg, base.wrapping_add(disp)))
    }
    fn get(&self, rm: &Rm, w: bool) -> u16 {
        match *rm {
            Rm::Reg(i) => if w { self.r[i] } else { self.r8(i) as u16 },
            Rm::Mem(s, o) => if w { self.rw(self.s[s], o) } else { self.rb(self.s[s], o) as u16 },
        }
    }
    fn put(&mut self, rm: &Rm, w: bool, v: u16) {
        match *rm {
            Rm::Reg(i) => if w { self.r[i] = v } else { self.set_r8(i, v as u8) },
            Rm::Mem(s, o) => {
                let seg = self.s[s];
                if w { self.ww(seg, o, v) } else { self.wb(seg, o, v as u8) }
            }
        }
    }
    fn dseg(&self) -> u16 {
        self.s[self.seg_ovr.unwrap_or(DS)]
    }

    // -------------------------------------------------------------- arithmetic
    fn szp(&mut self, v: u16, w: bool) {
        let v = if w { v } else { v & 0xFF };
        self.set_flag(ZF, v == 0);
        self.set_flag(SF, if w { v & 0x8000 != 0 } else { v & 0x80 != 0 });
        self.set_flag(PF, parity(v as u8));
    }
    fn alu(&mut self, op: usize, a: u16, b: u16, w: bool) -> u16 {
        let mask: u32 = if w { 0xFFFF } else { 0xFF };
        let top: u32 = if w { 0x8000 } else { 0x80 };
        let (a32, b32) = (a as u32 & mask, b as u32 & mask);
        let c = self.flag(CF) as u32;
        let r: u32 = match op {
            0 | 2 => {
                let r = a32 + b32 + if op == 2 { c } else { 0 };
                self.set_flag(CF, r > mask);
                self.set_flag(OF, (!(a32 ^ b32) & (a32 ^ r) & top) != 0);
                self.set_flag(AF, ((a32 ^ b32 ^ r) & 0x10) != 0);
                r & mask
            }
            5 | 3 | 7 => {
                let bb = b32 + if op == 3 { c } else { 0 };
                let r = a32.wrapping_sub(bb) & mask;
                self.set_flag(CF, bb > a32);
                self.set_flag(OF, ((a32 ^ b32) & (a32 ^ r) & top) != 0);
                self.set_flag(AF, ((a32 ^ b32 ^ r) & 0x10) != 0);
                r
            }
            1 | 4 | 6 => {
                let r = match op { 1 => a32 | b32, 4 => a32 & b32, _ => a32 ^ b32 };
                self.set_flag(CF, false);
                self.set_flag(OF, false);
                r
            }
            _ => 0,
        };
        self.szp(r as u16, w);
        r as u16
    }
    fn alu32(&mut self, op: usize, a: u32, b: u32) -> u32 {
        let (r, cf, of) = match op {
            0 => {
                let (r, c) = a.overflowing_add(b);
                (r, c, (!(a ^ b) & (a ^ r)) >> 31 != 0)
            }
            5 | 7 => {
                let (r, c) = a.overflowing_sub(b);
                (r, c, ((a ^ b) & (a ^ r)) >> 31 != 0)
            }
            1 => (a | b, false, false),
            4 => (a & b, false, false),
            _ => (a ^ b, false, false),
        };
        self.set_flag(CF, cf);
        self.set_flag(OF, of);
        self.set_flag(ZF, r == 0);
        self.set_flag(SF, r >> 31 != 0);
        self.set_flag(PF, parity(r as u8));
        r
    }
    fn incdec(&mut self, v: u16, dec: bool, w: bool) -> u16 {
        let c = self.flag(CF);
        let r = self.alu(if dec { 5 } else { 0 }, v, 1, w);
        self.set_flag(CF, c);
        r
    }
    fn shift(&mut self, op: usize, v: u16, n: u8, w: bool) -> u16 {
        let n = n & 0x1F;
        if n == 0 {
            return v;
        }
        let bits = if w { 16 } else { 8 };
        let mask: u32 = if w { 0xFFFF } else { 0xFF };
        let top: u32 = 1 << (bits - 1);
        let mut x = v as u32 & mask;
        let mut cf = self.flag(CF);
        for _ in 0..n {
            match op {
                0 => {
                    cf = x & top != 0;
                    x = ((x << 1) | cf as u32) & mask;
                }
                1 => {
                    cf = x & 1 != 0;
                    x = (x >> 1) | if cf { top } else { 0 };
                }
                2 => {
                    let nc = x & top != 0;
                    x = ((x << 1) | cf as u32) & mask;
                    cf = nc;
                }
                3 => {
                    let nc = x & 1 != 0;
                    x = (x >> 1) | if cf { top } else { 0 };
                    cf = nc;
                }
                4 | 6 => {
                    cf = x & top != 0;
                    x = (x << 1) & mask;
                }
                5 => {
                    cf = x & 1 != 0;
                    x >>= 1;
                }
                _ => {
                    cf = x & 1 != 0;
                    x = (x >> 1) | (x & top);
                }
            }
        }
        self.set_flag(CF, cf);
        let msb = x & top != 0;
        match op {
            0 | 2 | 4 | 6 => self.set_flag(OF, msb != cf),
            1 | 3 => self.set_flag(OF, ((x << 1) ^ x) & top != 0),
            5 => self.set_flag(OF, v as u32 & top != 0),
            _ => self.set_flag(OF, false),
        }
        if op >= 4 {
            self.szp(x as u16, w);
        }
        x as u16
    }
    fn cond(&self, c: u8) -> bool {
        let (cf, zf, sf, of, pf) = (self.flag(CF), self.flag(ZF), self.flag(SF), self.flag(OF), self.flag(PF));
        let r = match c >> 1 {
            0 => of,
            1 => cf,
            2 => zf,
            3 => cf || zf,
            4 => sf,
            5 => pf,
            6 => sf != of,
            _ => zf || sf != of,
        };
        if c & 1 == 1 { !r } else { r }
    }
    fn jump_rel8(&mut self, take: bool) {
        let d = self.fetch8() as i8 as i16 as u16;
        if take {
            self.ip = self.ip.wrapping_add(d);
        }
    }
    fn interrupt(&mut self, n: u8) {
        let f = self.fl;
        self.push(f);
        let cs = self.s[CS];
        self.push(cs);
        let ip = self.ip;
        self.push(ip);
        self.set_flag(IF, false);
        self.ip = self.rw(0, n as u16 * 4);
        self.s[CS] = self.rw(0, n as u16 * 4 + 2);
    }
    fn stop(&mut self, why: String) -> bool {
        self.note = why;
        self.halted = true;
        self.dirty = true;
        false
    }

    /// The 32-bit forms behind an operand-size prefix that HAL-OS uses. False: not one of them (it runs 16-bit).
    fn op32(&mut self, op: u8) -> bool {
        match op {
            0xB8..=0xBF => {
                let v = self.fetch32();
                self.set_r32((op & 7) as usize, v);
            }
            0x05 | 0x0D | 0x25 | 0x2D | 0x35 | 0x3D => {
                let b = self.fetch32();
                let kind = (op >> 3) as usize;
                let r = self.alu32(kind, self.r32(AX), b);
                if kind != 7 {
                    self.set_r32(AX, r);
                }
            }
            0x50..=0x57 => {
                let i = (op & 7) as usize;
                let (h, l) = (self.hi[i], self.r[i]);
                self.push(h);
                self.push(l);
            }
            0x58..=0x5F => {
                let l = self.pop();
                let h = self.pop();
                let i = (op & 7) as usize;
                self.r[i] = l;
                self.hi[i] = h;
            }
            0xED => {
                let v = self.port_in32(self.r[DX]);
                self.set_r32(AX, v);
            }
            0xEF => {
                let v = self.r32(AX);
                self.port_out32(self.r[DX], v);
            }
            0x89 | 0x8B => {
                let (_, reg, rm) = self.modrm();
                match rm {
                    Rm::Reg(i) => {
                        if op == 0x89 {
                            let v = self.r32(reg);
                            self.set_r32(i, v);
                        } else {
                            let v = self.r32(i);
                            self.set_r32(reg, v);
                        }
                    }
                    Rm::Mem(s, o) => {
                        let seg = self.s[s];
                        if op == 0x89 {
                            let v = self.r32(reg);
                            self.ww(seg, o, v as u16);
                            self.ww(seg, o.wrapping_add(2), (v >> 16) as u16);
                        } else {
                            let v = self.rw(seg, o) as u32 | (self.rw(seg, o.wrapping_add(2)) as u32) << 16;
                            self.set_r32(reg, v);
                        }
                    }
                }
            }
            0x31 | 0x33 | 0x09 | 0x0B | 0x21 | 0x23 | 0x01 | 0x03 | 0x29 | 0x2B | 0x39 | 0x3B => {
                let (_, reg, rm) = self.modrm();
                let kind = (op >> 3) as usize;
                if let Rm::Reg(i) = rm {
                    let (a, b) = if op & 2 == 0 { (self.r32(i), self.r32(reg)) } else { (self.r32(reg), self.r32(i)) };
                    let r = self.alu32(kind, a, b);
                    if kind != 7 {
                        self.set_r32(if op & 2 == 0 { i } else { reg }, r);
                    }
                }
            }
            _ => return false,
        }
        true
    }

    /// Two-byte opcodes (0F xx): the few that real-mode boot code uses.
    fn op0f(&mut self) -> bool {
        let op = self.fetch8();
        match op {
            0x01 => {
                // LGDT / LIDT and friends: the tables only matter in protected mode, which is a moment here
                let _ = self.modrm();
            }
            0x20 => {
                let (_, _, rm) = self.modrm();
                if let Rm::Reg(i) = rm {
                    let v = self.cr0;
                    self.set_r32(i, v);
                }
            }
            0x22 => {
                let (_, _, rm) = self.modrm();
                if let Rm::Reg(i) = rm {
                    self.cr0 = self.r32(i);
                }
            }
            0x80..=0x8F => {
                let d = self.fetch16();
                if self.cond(op & 0x0F) {
                    self.ip = self.ip.wrapping_add(d);
                }
            }
            0xA0 | 0xA8 => {
                let v = self.s[if op == 0xA0 { 4 } else { 5 }];
                self.push(v);
            }
            0xA1 | 0xA9 => {
                let v = self.pop();
                self.s[if op == 0xA1 { 4 } else { 5 }] = v;
            }
            0xB6 | 0xB7 | 0xBE | 0xBF => {
                let (_, reg, rm) = self.modrm();
                let w = op & 1 == 1;
                let v = self.get(&rm, w);
                self.r[reg] = if w { v } else if op >= 0xBE { v as u8 as i8 as i16 as u16 } else { v & 0xFF };
            }
            _ => return false,
        }
        true
    }

    // -------------------------------------------------------------- the machine
    /// One instruction. False: it cannot go on yet (waiting for a key, or halted).
    fn step(&mut self) -> bool {
        if self.halted {
            return false;
        }
        let start = self.ip;
        self.seg_ovr = None;
        self.opsize = false;
        let mut rep: u8 = 0;
        let mut op = self.fetch8();
        loop {
            match op {
                0x26 => self.seg_ovr = Some(ES),
                0x2E => self.seg_ovr = Some(CS),
                0x36 => self.seg_ovr = Some(SS),
                0x3E => self.seg_ovr = Some(DS),
                0x64 => self.seg_ovr = Some(4),
                0x65 => self.seg_ovr = Some(5),
                0x66 => self.opsize = true,
                0x67 | 0xF0 => {}
                0xF2 | 0xF3 => rep = op,
                _ => break,
            }
            op = self.fetch8();
        }
        if self.opsize && self.op32(op) {
            return true;
        }
        match op {
            0x0F => {
                if !self.op0f() {
                    let at = format!("The machine met an instruction it does not know (0F) at {:04X}:{:04X} and stopped.", self.s[CS], start);
                    return self.stop(at);
                }
            }
            // ALU: op r/m,r · r,r/m · acc,imm
            0x00..=0x3F if op & 7 < 6 => {
                let kind = (op >> 3) as usize;
                let w = op & 1 == 1;
                match op & 7 {
                    0 | 1 => {
                        let (_, reg, rm) = self.modrm();
                        let a = self.get(&rm, w);
                        let b = if w { self.r[reg] } else { self.r8(reg) as u16 };
                        let r = self.alu(kind, a, b, w);
                        if kind != 7 {
                            self.put(&rm, w, r);
                        }
                    }
                    2 | 3 => {
                        let (_, reg, rm) = self.modrm();
                        let b = self.get(&rm, w);
                        let a = if w { self.r[reg] } else { self.r8(reg) as u16 };
                        let r = self.alu(kind, a, b, w);
                        if kind != 7 {
                            if w { self.r[reg] = r } else { self.set_r8(reg, r as u8) }
                        }
                    }
                    4 => {
                        let b = self.fetch8() as u16;
                        let r = self.alu(kind, self.r8(0) as u16, b, false);
                        if kind != 7 {
                            self.set_r8(0, r as u8);
                        }
                    }
                    _ => {
                        let b = self.fetch16();
                        let r = self.alu(kind, self.r[AX], b, true);
                        if kind != 7 {
                            self.r[AX] = r;
                        }
                    }
                }
            }
            0x06 | 0x0E | 0x16 | 0x1E => {
                let v = self.s[(op >> 3) as usize];
                self.push(v);
            }
            0x07 | 0x17 | 0x1F => {
                let v = self.pop();
                self.s[(op >> 3) as usize] = v;
            }
            0x27 | 0x2F => {
                // DAA / DAS
                let mut al = self.r8(0);
                let (cf, af) = (self.flag(CF), self.flag(AF));
                let sub = op == 0x2F;
                if al & 0x0F > 9 || af {
                    al = if sub { al.wrapping_sub(6) } else { al.wrapping_add(6) };
                    self.set_flag(AF, true);
                }
                if self.r8(0) > 0x99 || cf {
                    al = if sub { al.wrapping_sub(0x60) } else { al.wrapping_add(0x60) };
                    self.set_flag(CF, true);
                }
                self.set_r8(0, al);
                self.szp(al as u16, false);
            }
            0x37 | 0x3F => {
                // AAA / AAS
                if self.r8(0) & 0x0F > 9 || self.flag(AF) {
                    let ax = if op == 0x37 { self.r[AX].wrapping_add(0x106) } else { self.r[AX].wrapping_sub(6).wrapping_sub(0x100) };
                    self.r[AX] = ax;
                    self.set_flag(AF, true);
                    self.set_flag(CF, true);
                } else {
                    self.set_flag(AF, false);
                    self.set_flag(CF, false);
                }
                let al = self.r8(0) & 0x0F;
                self.set_r8(0, al);
            }
            0x40..=0x47 => {
                let i = (op & 7) as usize;
                self.r[i] = self.incdec(self.r[i], false, true);
            }
            0x48..=0x4F => {
                let i = (op & 7) as usize;
                self.r[i] = self.incdec(self.r[i], true, true);
            }
            0x50..=0x57 => {
                let v = self.r[(op & 7) as usize];
                self.push(v);
            }
            0x58..=0x5F => {
                let v = self.pop();
                self.r[(op & 7) as usize] = v;
            }
            0x60 => {
                let sp = self.r[SP];
                for i in 0..8 {
                    let v = if i == SP { sp } else { self.r[i] };
                    self.push(v);
                }
            }
            0x61 => {
                for i in (0..8).rev() {
                    let v = self.pop();
                    if i != SP {
                        self.r[i] = v;
                    }
                }
            }
            0x68 => {
                let v = self.fetch16();
                self.push(v);
            }
            0x6A => {
                let v = self.fetch8() as i8 as i16 as u16;
                self.push(v);
            }
            0x69 | 0x6B => {
                let (_, reg, rm) = self.modrm();
                let a = self.get(&rm, true) as i16 as i32;
                let b = if op == 0x69 { self.fetch16() as i16 as i32 } else { self.fetch8() as i8 as i32 };
                let r = a * b;
                self.r[reg] = r as u16;
                let over = r != (r as i16) as i32;
                self.set_flag(CF, over);
                self.set_flag(OF, over);
            }
            0x70..=0x7F => {
                let t = self.cond(op & 0x0F);
                self.jump_rel8(t);
            }
            0x80..=0x83 => {
                let w = op & 1 == 1;
                let (_, kind, rm) = self.modrm();
                let a = self.get(&rm, w);
                let b = match op {
                    0x81 => self.fetch16(),
                    0x83 => self.fetch8() as i8 as i16 as u16,
                    _ => self.fetch8() as u16,
                };
                let r = self.alu(kind, a, b, w);
                if kind != 7 {
                    self.put(&rm, w, r);
                }
            }
            0x84 | 0x85 => {
                let w = op & 1 == 1;
                let (_, reg, rm) = self.modrm();
                let a = self.get(&rm, w);
                let b = if w { self.r[reg] } else { self.r8(reg) as u16 };
                self.alu(4, a, b, w);
            }
            0x86 | 0x87 => {
                let w = op & 1 == 1;
                let (_, reg, rm) = self.modrm();
                let a = self.get(&rm, w);
                let b = if w { self.r[reg] } else { self.r8(reg) as u16 };
                self.put(&rm, w, b);
                if w { self.r[reg] = a } else { self.set_r8(reg, a as u8) }
            }
            0x88..=0x8B => {
                let w = op & 1 == 1;
                let (_, reg, rm) = self.modrm();
                if op & 2 == 0 {
                    let v = if w { self.r[reg] } else { self.r8(reg) as u16 };
                    self.put(&rm, w, v);
                } else {
                    let v = self.get(&rm, w);
                    if w { self.r[reg] = v } else { self.set_r8(reg, v as u8) }
                }
            }
            0x8C => {
                let (_, reg, rm) = self.modrm();
                let v = self.s[reg.min(5)];
                self.put(&rm, true, v);
            }
            0x8D => {
                let (_, reg, rm) = self.modrm();
                if let Rm::Mem(_, o) = rm {
                    self.r[reg] = o;
                }
            }
            0x8E => {
                let (_, reg, rm) = self.modrm();
                let v = self.get(&rm, true);
                if reg < 6 {
                    self.s[reg] = v;
                }
            }
            0x8F => {
                let (_, _, rm) = self.modrm();
                let v = self.pop();
                self.put(&rm, true, v);
            }
            0x90 => {}
            0x91..=0x97 => self.r.swap(AX, (op & 7) as usize),
            0x98 => self.r[AX] = self.r8(0) as i8 as i16 as u16,
            0x99 => self.r[DX] = if self.r[AX] & 0x8000 != 0 { 0xFFFF } else { 0 },
            0x9A => {
                let ip = self.fetch16();
                let cs = self.fetch16();
                let (oc, oi) = (self.s[CS], self.ip);
                self.push(oc);
                self.push(oi);
                self.s[CS] = cs;
                self.ip = ip;
            }
            0x9B => {}
            0x9C => {
                let f = self.fl;
                self.push(f);
            }
            0x9D => self.fl = (self.pop() & 0x0FD5) | 2,
            0x9E => self.fl = (self.fl & 0xFF00) | (self.r8(4) as u16 & 0xD5) | 2,
            0x9F => self.set_r8(4, self.fl as u8),
            0xA0..=0xA3 => {
                let o = self.fetch16();
                let seg = self.dseg();
                match op {
                    0xA0 => self.set_r8(0, self.rb(seg, o)),
                    0xA1 => self.r[AX] = self.rw(seg, o),
                    0xA2 => self.wb(seg, o, self.r8(0)),
                    _ => self.ww(seg, o, self.r[AX]),
                }
            }
            0xA4..=0xA7 | 0xAA..=0xAF => {
                let w = op & 1 == 1;
                let d: u16 = if self.flag(DF) { if w { 0xFFFE } else { 0xFFFF } } else if w { 2 } else { 1 };
                let mut n = 0u32;
                loop {
                    if rep != 0 {
                        if self.r[CX] == 0 {
                            break;
                        }
                        self.r[CX] = self.r[CX].wrapping_sub(1);
                    }
                    let src = self.dseg();
                    let es = self.s[ES];
                    let (si, di) = (self.r[SI], self.r[DI]);
                    let mut cmp = false;
                    match op & 0xFE {
                        0xA4 => {
                            let v = if w { self.rw(src, si) } else { self.rb(src, si) as u16 };
                            if w { self.ww(es, di, v) } else { self.wb(es, di, v as u8) }
                            self.r[SI] = si.wrapping_add(d);
                            self.r[DI] = di.wrapping_add(d);
                        }
                        0xA6 => {
                            let a = if w { self.rw(src, si) } else { self.rb(src, si) as u16 };
                            let b = if w { self.rw(es, di) } else { self.rb(es, di) as u16 };
                            self.alu(7, a, b, w);
                            self.r[SI] = si.wrapping_add(d);
                            self.r[DI] = di.wrapping_add(d);
                            cmp = true;
                        }
                        0xAA => {
                            if w { self.ww(es, di, self.r[AX]) } else { self.wb(es, di, self.r8(0)) }
                            self.r[DI] = di.wrapping_add(d);
                        }
                        0xAC => {
                            if w { self.r[AX] = self.rw(src, si) } else { self.set_r8(0, self.rb(src, si)) }
                            self.r[SI] = si.wrapping_add(d);
                        }
                        _ => {
                            let b = if w { self.rw(es, di) } else { self.rb(es, di) as u16 };
                            let a = if w { self.r[AX] } else { self.r8(0) as u16 };
                            self.alu(7, a, b, w);
                            self.r[DI] = di.wrapping_add(d);
                            cmp = true;
                        }
                    }
                    if rep == 0 {
                        break;
                    }
                    if cmp && ((rep == 0xF3 && !self.flag(ZF)) || (rep == 0xF2 && self.flag(ZF))) {
                        break;
                    }
                    n += 1;
                    if n > 0x20000 && self.r[CX] != 0 {
                        // a very long string operation goes on at the next step
                        self.ip = start;
                        break;
                    }
                }
            }
            0xA8 => {
                let b = self.fetch8() as u16;
                self.alu(4, self.r8(0) as u16, b, false);
            }
            0xA9 => {
                let b = self.fetch16();
                self.alu(4, self.r[AX], b, true);
            }
            0xB0..=0xB7 => {
                let v = self.fetch8();
                self.set_r8((op & 7) as usize, v);
            }
            0xB8..=0xBF => self.r[(op & 7) as usize] = self.fetch16(),
            0xC0 | 0xC1 | 0xD0..=0xD3 => {
                let w = op & 1 == 1;
                let (_, kind, rm) = self.modrm();
                let n = match op {
                    0xC0 | 0xC1 => self.fetch8(),
                    0xD0 | 0xD1 => 1,
                    _ => self.r8(1),
                };
                let v = self.get(&rm, w);
                let r = self.shift(kind, v, n, w);
                self.put(&rm, w, r);
            }
            0xC2 => {
                let n = self.fetch16();
                self.ip = self.pop();
                self.r[SP] = self.r[SP].wrapping_add(n);
            }
            0xC3 => self.ip = self.pop(),
            0xC4 | 0xC5 => {
                let (_, reg, rm) = self.modrm();
                if let Rm::Mem(s, o) = rm {
                    let seg = self.s[s];
                    self.r[reg] = self.rw(seg, o);
                    self.s[if op == 0xC4 { ES } else { DS }] = self.rw(seg, o.wrapping_add(2));
                }
            }
            0xC6 | 0xC7 => {
                let w = op & 1 == 1;
                let (_, _, rm) = self.modrm();
                let v = if w { self.fetch16() } else { self.fetch8() as u16 };
                self.put(&rm, w, v);
            }
            0xCA | 0xCB => {
                let n = if op == 0xCA { self.fetch16() } else { 0 };
                self.ip = self.pop();
                self.s[CS] = self.pop();
                self.r[SP] = self.r[SP].wrapping_add(n);
            }
            0xCC => self.interrupt(3),
            0xCD => {
                let n = self.fetch8();
                if !self.bios(n) {
                    // the keyboard has nothing yet: come back to this INT when it does
                    self.ip = start;
                    self.waiting = true;
                    return false;
                }
            }
            0xCE => {
                if self.flag(OF) {
                    self.interrupt(4);
                }
            }
            0xCF => {
                self.ip = self.pop();
                self.s[CS] = self.pop();
                self.fl = (self.pop() & 0x0FD5) | 2;
            }
            0xD4 => {
                let b = self.fetch8().max(1);
                let al = self.r8(0);
                self.set_r8(4, al / b);
                self.set_r8(0, al % b);
                self.szp(self.r8(0) as u16, false);
            }
            0xD5 => {
                let b = self.fetch8();
                let al = self.r8(0).wrapping_add(self.r8(4).wrapping_mul(b));
                self.r[AX] = al as u16;
                self.szp(al as u16, false);
            }
            0xD7 => {
                let seg = self.dseg();
                let v = self.rb(seg, self.r[BX].wrapping_add(self.r8(0) as u16));
                self.set_r8(0, v);
            }
            0xD8..=0xDF => {
                let _ = self.modrm();
            }
            0xE0..=0xE2 => {
                self.r[CX] = self.r[CX].wrapping_sub(1);
                let nz = self.r[CX] != 0;
                let t = match op { 0xE0 => nz && !self.flag(ZF), 0xE1 => nz && self.flag(ZF), _ => nz };
                self.jump_rel8(t);
            }
            0xE3 => {
                let t = self.r[CX] == 0;
                self.jump_rel8(t);
            }
            0xE4 | 0xE5 | 0xEC | 0xED => {
                let port = if op < 0xEC { self.fetch8() as u16 } else { self.r[DX] };
                let v = self.port_in(port);
                if op & 1 == 1 { self.r[AX] = v as u16 } else { self.set_r8(0, v) }
            }
            0xE6 | 0xE7 | 0xEE | 0xEF => {
                let port = if op < 0xEE { self.fetch8() as u16 } else { self.r[DX] };
                let v = self.r8(0);
                self.port_out(port, v);
            }
            0xE8 => {
                let d = self.fetch16();
                let ip = self.ip;
                self.push(ip);
                self.ip = self.ip.wrapping_add(d);
            }
            0xE9 => {
                let d = self.fetch16();
                self.ip = self.ip.wrapping_add(d);
            }
            0xEA => {
                let ip = self.fetch16();
                let cs = self.fetch16();
                self.s[CS] = cs;
                self.ip = ip;
            }
            0xEB => self.jump_rel8(true),
            0xF4 => {
                self.halted = true;
                return false;
            }
            0xF5 => self.fl ^= CF,
            0xF6 | 0xF7 => {
                let w = op & 1 == 1;
                let (_, kind, rm) = self.modrm();
                let v = self.get(&rm, w);
                match kind {
                    0 | 1 => {
                        let b = if w { self.fetch16() } else { self.fetch8() as u16 };
                        self.alu(4, v, b, w);
                    }
                    2 => self.put(&rm, w, !v),
                    3 => {
                        let r = self.alu(5, 0, v, w);
                        self.put(&rm, w, r);
                        self.set_flag(CF, v & if w { 0xFFFF } else { 0xFF } != 0);
                    }
                    4 | 5 => {
                        let over;
                        if w {
                            if kind == 4 {
                                let r = self.r[AX] as u32 * v as u32;
                                self.r[AX] = r as u16;
                                self.r[DX] = (r >> 16) as u16;
                                over = self.r[DX] != 0;
                            } else {
                                let r = (self.r[AX] as i16 as i32) * (v as i16 as i32);
                                self.r[AX] = r as u16;
                                self.r[DX] = (r >> 16) as u16;
                                over = r != (r as i16) as i32;
                            }
                        } else if kind == 4 {
                            let r = self.r8(0) as u16 * (v & 0xFF);
                            self.r[AX] = r;
                            over = r & 0xFF00 != 0;
                        } else {
                            let r = (self.r8(0) as i8 as i16) * (v as u8 as i8 as i16);
                            self.r[AX] = r as u16;
                            over = r != (r as i8) as i16;
                        }
                        self.set_flag(CF, over);
                        self.set_flag(OF, over);
                    }
                    _ => {
                        if !self.divide(kind == 7, v, w) {
                            return self.stop("Divide error: the machine stopped.".into());
                        }
                    }
                }
            }
            0xF8 => self.set_flag(CF, false),
            0xF9 => self.set_flag(CF, true),
            0xFA => self.set_flag(IF, false),
            0xFB => self.set_flag(IF, true),
            0xFC => self.set_flag(DF, false),
            0xFD => self.set_flag(DF, true),
            0xFE | 0xFF => {
                let w = op == 0xFF;
                let (_, kind, rm) = self.modrm();
                match kind {
                    0 | 1 => {
                        let v = self.get(&rm, w);
                        let r = self.incdec(v, kind == 1, w);
                        self.put(&rm, w, r);
                    }
                    2 => {
                        let t = self.get(&rm, true);
                        let ip = self.ip;
                        self.push(ip);
                        self.ip = t;
                    }
                    3 | 5 => {
                        if let Rm::Mem(s, o) = rm {
                            let seg = self.s[s];
                            let (ip, cs) = (self.rw(seg, o), self.rw(seg, o.wrapping_add(2)));
                            if kind == 3 {
                                let (oc, oi) = (self.s[CS], self.ip);
                                self.push(oc);
                                self.push(oi);
                            }
                            self.s[CS] = cs;
                            self.ip = ip;
                        }
                    }
                    4 => self.ip = self.get(&rm, true),
                    _ => {
                        let v = self.get(&rm, true);
                        self.push(v);
                    }
                }
            }
            _ => {
                let at = format!("The machine met an instruction it does not know ({:02X}) at {:04X}:{:04X} and stopped.", op, self.s[CS], start);
                return self.stop(at);
            }
        }
        // jmp 0xFFFF:0000 is how the shell reboots
        if self.s[CS] == 0xFFFF && self.ip == 0 {
            self.net = false;
            self.boot();
            return false;
        }
        true
    }

    fn divide(&mut self, signed: bool, v: u16, w: bool) -> bool {
        if w {
            if v == 0 {
                return false;
            }
            let n = (self.r[DX] as u32) << 16 | self.r[AX] as u32;
            if signed {
                let (n, d) = (n as i32, v as i16 as i32);
                let q = n.wrapping_div(d);
                if q > 32767 || q < -32768 {
                    return false;
                }
                self.r[AX] = q as u16;
                self.r[DX] = n.wrapping_rem(d) as u16;
            } else {
                let q = n / v as u32;
                if q > 0xFFFF {
                    return false;
                }
                self.r[AX] = q as u16;
                self.r[DX] = (n % v as u32) as u16;
            }
        } else {
            let d = v & 0xFF;
            if d == 0 {
                return false;
            }
            let n = self.r[AX];
            if signed {
                let (n, d) = (n as i16, d as u8 as i8 as i16);
                let q = n.wrapping_div(d);
                if q > 127 || q < -128 {
                    return false;
                }
                self.set_r8(0, q as u8);
                self.set_r8(4, n.wrapping_rem(d) as u8);
            } else {
                let q = n / d;
                if q > 0xFF {
                    return false;
                }
                self.set_r8(0, q as u8);
                self.set_r8(4, (n % d) as u8);
            }
        }
        true
    }

    // -------------------------------------------------------------- ports
    fn port_in(&mut self, port: u16) -> u8 {
        match port {
            0x3FD => 0x60 | (!self.rx.is_empty() && self.rx_budget >= 1.0) as u8,
            0x3F8 => {
                self.rx_budget -= 1.0;
                self.rx.pop_front().unwrap_or(0)
            }
            0x3FA => 0x01,
            0x60 => self.keys.first().map(|k| k.1).unwrap_or(0),
            0x64 => 0x1C,
            0x92 => 0x02,
            0x3DA | 0x3BA => {
                // vertical retrace, toggling, so a wait for it ends
                self.retrace = !self.retrace;
                if self.retrace { 0x09 } else { 0x00 }
            }
            0x3C9 => {
                let v = self.dac.get(self.dac_r % 768).copied().unwrap_or(0);
                self.dac_r += 1;
                v
            }
            0xCFC..=0xCFF => (self.port_in32(0xCFC) >> ((port - 0xCFC) * 8)) as u8,
            _ => 0xFF,
        }
    }
    fn port_out(&mut self, port: u16, v: u8) {
        match port {
            0x3F8 => self.serial_tx(v),
            0x3C8 => self.dac_w = v as usize * 3,
            0x3C7 => self.dac_r = v as usize * 3,
            0x3C9 => {
                let i = self.dac_w % 768;
                if self.dac.len() == 768 {
                    self.dac[i] = v & 0x3F;
                }
                self.dac_w += 1;
                self.vdirty = true;
            }
            0x3CE => self.gc_idx = v,
            0x3CF => {
                if self.gc_idx == 6 {
                    self.gfx = v & 1 == 1;
                    self.dirty = true;
                    self.vdirty = true;
                }
            }
            _ => {}
        }
    }
    fn port_in32(&mut self, port: u16) -> u32 {
        if port == 0xCFC {
            // bus 0, function 0: a host bridge, an ISA bridge and a VGA card answer; everyone else is absent
            let enabled = self.pci & 0x8000_0000 != 0;
            let (bus, dev, func, reg) = ((self.pci >> 16) & 0xFF, (self.pci >> 11) & 0x1F, (self.pci >> 8) & 7, self.pci & 0xFC);
            if !enabled || bus != 0 || func != 0 {
                return 0xFFFF_FFFF;
            }
            let id = match dev {
                0 => 0x1237_8086u32,
                1 => 0x7000_8086,
                2 => 0x1111_1234,
                _ => return 0xFFFF_FFFF,
            };
            return match reg {
                0 => id,
                8 => match dev { 0 => 0x0600_0002, 1 => 0x0601_0000, _ => 0x0300_0000 },
                _ => 0,
            };
        }
        self.port_in(port) as u32
    }
    fn port_out32(&mut self, port: u16, v: u32) {
        if port == 0xCF8 {
            self.pci = v;
        } else {
            self.port_out(port, v as u8);
        }
    }

    fn serial_tx(&mut self, v: u8) {
        if self.net {
            if let Some(d) = self.p.dump.as_mut() {
                d.push(v);
                if d.len() >= SLOTS {
                    let got = self.p.dump.take().unwrap_or_default();
                    self.readback_done(Some(got));
                }
            }
            return;
        }
        self.serial.push(v as char);
        if self.serial.ends_with(HAL_MARKER) {
            // the shell asks for the network: boot it, as the portal did
            self.boot_net();
            return;
        }
        if self.serial.len() > 256 {
            let cut = self.serial.len() - 64;
            self.serial = self.serial[cut..].to_string();
        }
    }

    // -------------------------------------------------------------- the BIOS
    fn cell(&mut self, row: u8, col: u8, ch: u8, attr: Option<u8>) {
        let a = 0xB8000 + (row as usize * 80 + col as usize) * 2;
        self.mem[a] = ch;
        if let Some(at) = attr {
            self.mem[a + 1] = at;
        }
        self.dirty = true;
    }
    fn scroll(&mut self, n: u8, attr: u8, top: u8, left: u8, bottom: u8, right: u8) {
        let (bottom, right) = (bottom.min(24), right.min(79));
        if top > bottom || left > right {
            return;
        }
        let rows = bottom - top + 1;
        let n = if n == 0 || n > rows { rows } else { n };
        for row in top..=bottom {
            for col in left..=right {
                let from = row + n;
                let (ch, at) = if from <= bottom {
                    let a = 0xB8000 + (from as usize * 80 + col as usize) * 2;
                    (self.mem[a], self.mem[a + 1])
                } else {
                    (b' ', attr)
                };
                self.cell(row, col, ch, Some(at));
            }
        }
    }
    fn teletype(&mut self, ch: u8) {
        let (mut row, mut col) = self.cur;
        match ch {
            13 => col = 0,
            10 => row += 1,
            8 => col = col.saturating_sub(1),
            7 => {}
            _ => {
                self.cell(row, col, ch, None);
                col += 1;
                if col >= 80 {
                    col = 0;
                    row += 1;
                }
            }
        }
        if row >= 25 {
            let at = self.mem[0xB8000 + (24 * 80 + 79) * 2 + 1];
            self.scroll(1, if at == 0 { 7 } else { at }, 0, 0, 24, 79);
            row = 24;
        }
        self.cur = (row, col);
        self.dirty = true;
    }
    /// A disk sector range: the boot disk (0x80, read only) or the weight disk (0x81).
    fn disk_io(&mut self, drive: u8, lba: usize, count: usize, seg: u16, off: u16, write: bool) -> bool {
        let bytes = count * 512;
        let base = lba * 512;
        if drive == 0x81 {
            if base + bytes > self.weights.len() {
                return false;
            }
            for i in 0..bytes {
                let o = off.wrapping_add(i as u16);
                if write {
                    self.weights[base + i] = self.rb(seg, o);
                } else {
                    let v = self.weights[base + i];
                    self.wb(seg, o, v);
                }
            }
            return true;
        }
        if write {
            return false;
        }
        let img = self.disk();
        for i in 0..bytes {
            let v = img.get(base + i).copied().unwrap_or(0);
            self.wb(seg, off.wrapping_add(i as u16), v);
        }
        true
    }
    /// A BIOS service. False: it has to wait (a key was asked for and none is there).
    fn bios(&mut self, n: u8) -> bool {
        let ah = self.r8(4);
        match n {
            0x10 => match ah {
                0x00 => {
                    self.gfx = self.r8(0) & 0x7F == 0x13;
                    self.vdirty = true;
                    for i in 0..2000 {
                        self.mem[0xB8000 + i * 2] = b' ';
                        self.mem[0xB8000 + i * 2 + 1] = 7;
                    }
                    self.cur = (0, 0);
                    self.dirty = true;
                }
                0x02 => {
                    self.cur = (self.r8(6).min(24), self.r8(2).min(79));
                    self.dirty = true;
                }
                0x03 => {
                    self.set_r8(6, self.cur.0);
                    self.set_r8(2, self.cur.1);
                    self.r[CX] = 0x0607;
                }
                0x06 | 0x07 => {
                    let (n, attr) = (self.r8(0), self.r8(7));
                    let (top, left, bottom, right) = (self.r8(5), self.r8(1), self.r8(6), self.r8(2));
                    self.scroll(if ah == 0x06 { n } else { 0 }, attr, top, left, bottom, right);
                }
                0x08 => {
                    let a = 0xB8000 + (self.cur.0 as usize * 80 + self.cur.1 as usize) * 2;
                    self.r[AX] = self.mem[a] as u16 | (self.mem[a + 1] as u16) << 8;
                }
                0x09 | 0x0A => {
                    let (ch, attr) = (self.r8(0), self.r8(3));
                    let (row, col) = self.cur;
                    let mut p = row as usize * 80 + col as usize;
                    for _ in 0..self.r[CX] {
                        if p >= 2000 {
                            break;
                        }
                        self.cell((p / 80) as u8, (p % 80) as u8, ch, if ah == 0x09 { Some(attr) } else { None });
                        p += 1;
                    }
                }
                0x0E => {
                    let c = self.r8(0);
                    self.teletype(c);
                }
                0x0F => {
                    self.r[AX] = if self.gfx { 0x2813 } else { 0x5003 };
                    self.set_r8(7, 0);
                }
                _ => {}
            },
            0x11 => self.r[AX] = 0x0021,
            0x12 => self.r[AX] = 640,
            0x13 => {
                let drive = self.r8(2);
                match ah {
                    0x00 => {
                        self.set_r8(4, 0);
                        self.set_flag(CF, false);
                    }
                    0x02 | 0x03 => {
                        let count = self.r8(0) as usize;
                        let cyl = self.r8(5) as usize | ((self.r8(1) as usize & 0xC0) << 2);
                        let sec = (self.r8(1) & 0x3F) as usize;
                        let head = self.r8(6) as usize;
                        let lba = (cyl * 16 + head) * 63 + sec.saturating_sub(1);
                        let (es, bx) = (self.s[ES], self.r[BX]);
                        let ok = self.disk_io(drive, lba, count, es, bx, ah == 0x03);
                        self.set_r8(4, if ok { 0 } else { 1 });
                        self.set_flag(CF, !ok);
                    }
                    0x08 => {
                        self.r[CX] = 63;
                        self.r[DX] = (15 << 8) | 2;
                        self.set_r8(4, 0);
                        self.set_flag(CF, false);
                    }
                    0x41 => {
                        // the LBA extensions are here
                        self.r[BX] = 0xAA55;
                        self.r[CX] = 1;
                        self.set_r8(4, 0x30);
                        self.set_flag(CF, false);
                    }
                    0x42 | 0x43 => {
                        let (ds, si) = (self.s[DS], self.r[SI]);
                        let count = self.rw(ds, si.wrapping_add(2)) as usize;
                        let off = self.rw(ds, si.wrapping_add(4));
                        let seg = self.rw(ds, si.wrapping_add(6));
                        let lba = self.rw(ds, si.wrapping_add(8)) as usize | (self.rw(ds, si.wrapping_add(10)) as usize) << 16;
                        let ok = self.disk_io(drive, lba, count, seg, off, ah == 0x43);
                        self.set_r8(4, if ok { 0 } else { 1 });
                        self.set_flag(CF, !ok);
                    }
                    _ => {
                        self.set_r8(4, 1);
                        self.set_flag(CF, true);
                    }
                }
            }
            0x15 => match ah {
                0x88 => {
                    self.r[AX] = 3072;
                    self.set_flag(CF, false);
                }
                0x24 => {
                    self.set_r8(4, 0);
                    self.set_flag(CF, false);
                }
                _ => {
                    self.set_r8(4, 0x86);
                    self.set_flag(CF, true);
                }
            },
            0x16 => match ah {
                0x00 | 0x10 => {
                    if self.keys.is_empty() {
                        return false;
                    }
                    let (ch, sc) = self.keys.remove(0);
                    self.r[AX] = ch as u16 | (sc as u16) << 8;
                }
                0x01 | 0x11 => match self.keys.first() {
                    Some(&(ch, sc)) => {
                        self.r[AX] = ch as u16 | (sc as u16) << 8;
                        self.set_flag(ZF, false);
                    }
                    None => self.set_flag(ZF, true),
                },
                0x02 => self.set_r8(0, 0),
                _ => {}
            },
            0x1A => {
                let day_ms = host::now() % 86_400_000.0;
                let bcd = |v: u32| (((v / 10) << 4) | (v % 10)) as u8;
                match ah {
                    0x00 => {
                        let ticks = (day_ms / 1000.0 * 1_193_180.0 / 65536.0) as u32;
                        self.r[CX] = (ticks >> 16) as u16;
                        self.r[DX] = ticks as u16;
                        self.set_r8(0, 0);
                    }
                    0x02 => {
                        let s = (day_ms / 1000.0) as u32;
                        self.set_r8(5, bcd(s / 3600));
                        self.set_r8(1, bcd(s / 60 % 60));
                        self.set_r8(6, bcd(s % 60));
                        self.set_r8(2, 0);
                        self.set_flag(CF, false);
                    }
                    0x04 => {
                        let iso = iso_now();
                        let num = |a: usize, b: usize| iso.get(a..b).and_then(|x| x.parse::<u32>().ok()).unwrap_or(0);
                        let y = num(0, 4);
                        self.set_r8(5, bcd(y / 100));
                        self.set_r8(1, bcd(y % 100));
                        self.set_r8(6, bcd(num(5, 7)));
                        self.set_r8(2, bcd(num(8, 10)));
                        self.set_flag(CF, false);
                    }
                    _ => {}
                }
            }
            0x19 => {
                self.net = false;
                self.boot();
            }
            _ => self.interrupt(n),
        }
        true
    }

    /// Runs for about `ms` milliseconds of wall time.
    fn run(&mut self, ms: f64) {
        if !self.on {
            return;
        }
        let t0 = host::now();
        'outer: loop {
            for _ in 0..20_000 {
                if !self.step() {
                    break 'outer;
                }
                self.steps += 1;
            }
            if host::now() - t0 > ms {
                break;
            }
        }
    }

    fn key(&mut self, k: &str) {
        if self.net {
            // in the network, a key is training data (the keyboard channel), not input
            if self.p.chan_keys && k.chars().count() == 1 {
                self.p.typed.push(k.chars().next().unwrap_or(' ') as u32 as u8);
            }
            return;
        }
        let (ch, sc): (u8, u8) = match k {
            "Enter" => (13, 0x1C),
            "Backspace" => (8, 0x0E),
            "Escape" => (27, 0x01),
            "Tab" => (9, 0x0F),
            _ => {
                let c = k.chars().next().unwrap_or('\0');
                if k.chars().count() != 1 || !(c as u32 >= 32 && (c as u32) < 127) {
                    return;
                }
                (c as u8, 0)
            }
        };
        if self.keys.len() < 32 {
            self.keys.push((ch, sc));
        }
        self.waiting = false;
    }

    // -------------------------------------------------------------- the portal
    fn frame_counter(&self) -> u16 {
        if self.mem.len() > FRAME_ADDR + 1 { u16::from_le_bytes([self.mem[FRAME_ADDR], self.mem[FRAME_ADDR + 1]]) } else { 0 }
    }

    fn send(&mut self, bytes: &[u8]) {
        if !self.net || bytes.is_empty() {
            return;
        }
        self.rx.extend(bytes.iter().copied());
        self.p.sent += bytes.len() as u64;
    }

    fn base_layer(&mut self) -> Option<Vec<u8>> {
        match self.p.source.as_str() {
            "images" => {
                if self.p.images.is_empty() {
                    return None;
                }
                if self.p.images.len() > 1 && host::now() - self.p.img_since > 4000.0 {
                    self.p.img_at = (self.p.img_at + 1) % self.p.images.len();
                    self.p.img_since = host::now();
                }
                self.p.images.get(self.p.img_at).cloned()
            }
            "text" => {
                let raw: Vec<u8> = if self.p.text.is_empty() { alloc::vec![b' '] } else { self.p.text.bytes().collect() };
                Some((0..SLOTS).map(|i| raw[i % raw.len()]).collect())
            }
            "sine" => {
                let t = self.p.sine_t;
                let table: Vec<u8> = (0..360).map(|d| sine_byte(d as f64)).collect();
                let out = (0..SLOTS).map(|i| table[(t + (i / NET_W) * 14 + i % NET_W) % 360]).collect();
                self.p.sine_t = (t + 9) % 360;
                Some(out)
            }
            "noise" => {
                let mut v = Vec::with_capacity(SLOTS);
                let mut s = if self.p.lfsr == 0 { (host::now() as u32) | 1 } else { self.p.lfsr };
                for _ in 0..SLOTS {
                    s ^= s << 13;
                    s ^= s >> 17;
                    s ^= s << 5;
                    v.push(s as u8);
                }
                self.p.lfsr = s;
                Some(v)
            }
            _ => None,
        }
    }

    /// Sender._run() of portal.py: one frame of the chosen source, as a delta against what the guest last saw.
    fn portal_tick(&mut self) {
        if !self.net || self.p.dump.is_some() || self.p.dump_wait {
            return;
        }
        let now = host::now();
        if now - self.p.stats_t >= 1000.0 {
            let dt = (now - self.p.stats_t) / 1000.0;
            let f = self.frame_counter();
            if self.p.stats_t > 0.0 {
                self.p.fps_guest = f.wrapping_sub(self.p.stats_frame) as f64 / dt;
                self.p.rate = (self.p.sent - self.p.stats_sent) as f64 / dt;
            }
            self.p.stats_frame = f;
            self.p.stats_sent = self.p.sent;
            self.p.stats_t = now;
            if self.p.restored.is_none() && self.steps > 2_000_000 {
                self.p.restored = Some(self.mem.get(DBOK_ADDR).copied().unwrap_or(0) != 0);
            }
            self.dirty = true;
        }
        if now - self.p.last_send < 1000.0 / self.p.fps.max(1) as f64 {
            return;
        }
        self.p.last_send = now;
        let full = self.p.source != "none";
        let live = self.p.armed && (full || self.p.chan_keys || self.p.chan_mouse);
        if !live {
            self.p.prev = None;
            self.p.nframes = 0;
            return;
        }
        // backpressure: never more than a few frames queued on the line
        if self.rx.len() > 4 * SLOTS {
            return;
        }
        let base = self.base_layer();
        if full && base.is_none() {
            return;
        }
        let baseline = if full || self.p.prev.is_some() { None } else { Some(self.p.canvas.clone()) };
        if let Some(b) = base {
            self.p.canvas = b;
        }
        if self.p.chan_mouse {
            if let Some((x, y)) = self.p.mouse {
                let marker = rgb_index(255, 255, 0);
                for r in y.saturating_sub(3)..(y + 4).min(NET_H) {
                    for c in x.saturating_sub(3)..(x + 4).min(NET_W) {
                        self.p.canvas[r * NET_W + c] = marker;
                    }
                }
            }
        }
        if self.p.chan_keys {
            for k in core::mem::take(&mut self.p.typed) {
                let at = self.p.key_ptr;
                self.p.canvas[at] = k;
                self.p.key_ptr = if at + 1 >= SLOTS { KEY_BAND_START } else { at + 1 };
            }
        }
        let frame = self.p.canvas.clone();
        let mut key = false;
        if let Some(b) = baseline {
            self.p.prev = Some(b);
        } else {
            key = full && self.p.nframes % self.p.keyframe_every.max(1) == 0;
        }
        let wire = encode_delta(self.p.prev.as_deref(), &frame, key);
        if !wire.is_empty() {
            self.send(&wire);
            self.p.trained += SLOTS as u64;
        }
        if full {
            self.p.last_frame = Some(frame.clone());
        }
        self.p.preview = Some(frame.clone());
        self.p.prev = Some(frame);
        self.p.nframes += 1;
        self.dirty = true;
    }

    fn readback_done(&mut self, got: Option<Vec<u8>>) {
        self.p.rb_note = match (&got, &self.p.last_frame) {
            (None, _) => "readback timed out".into(),
            (Some(g), Some(t)) => format!("readback · rmse {:.1} vs the last frame sent", rmse(t, g)),
            (Some(_), None) => "readback · what the network is painting".into(),
        };
        if got.is_some() {
            self.p.readback = got;
        }
        self.dirty = true;
    }

    fn program(&mut self, text: &str) -> bool {
        match assemble_cmds(text) {
            Ok(q) => {
                let mut body: Vec<u8> = Vec::new();
                for [op, a, b, c] in q {
                    body.extend_from_slice(&[op, a, b, c]);
                }
                let mut w = alloc::vec![(CMD_WIRE_BASE & 0xFF) as u8, (CMD_WIRE_BASE >> 8) as u8, body.len() as u8, (body.len() >> 8) as u8];
                w.extend(body);
                self.send(&w);
                // a RESET re-seeds every weight, so the guest no longer holds prev
                self.p.prev = None;
                true
            }
            Err(e) => {
                self.p.hint = e;
                false
            }
        }
    }

    fn save_weights(&self) {
        host::store_set(WEIGHTS_KEY, &b64_encode(&self.weights));
    }
}

// ---------------------------------------------------------------------------------------------- the wire (wire.js)

fn sine_byte(deg: f64) -> u8 {
    // 127.5 · (1 + sin): sin from a short series on [-π, π]
    let mut x = deg * core::f64::consts::PI / 180.0;
    while x > core::f64::consts::PI {
        x -= 2.0 * core::f64::consts::PI;
    }
    let (x2, mut term, mut s) = (x * x, x, x);
    for k in 1..10 {
        term *= -x2 / ((2 * k) as f64 * (2 * k + 1) as f64);
        s += term;
    }
    (127.5 * (1.0 + s)) as u8
}

fn level(v: u8) -> u32 {
    (v as u32 * (CUBE - 1) + 127) / 255
}

fn rgb_index(r: u8, g: u8, b: u8) -> u8 {
    OUT_LO + ((level(r) * CUBE + level(g)) * CUBE + level(b)) as u8
}

fn palette_rgb(i: u8) -> (u8, u8, u8) {
    let k = i as i32 - OUT_LO as i32;
    if k < 0 || k >= (CUBE * CUBE * CUBE) as i32 {
        return (0, 0, 0);
    }
    (((k / 36) * 51) as u8, ((k / 6 % 6) * 51) as u8, ((k % 6) * 51) as u8)
}

/// The largest box that appears at the source's aspect once the 320×100 grid is shown at 4:3.
fn fit_box(w: usize, h: usize) -> (usize, usize) {
    let a = w as f64 / h.max(1) as f64;
    let ratio = a * (NET_W as f64 / NET_H as f64) / (4.0 / 3.0);
    let (mut bw, mut bh) = (NET_W as f64, NET_W as f64 / ratio);
    if bh > NET_H as f64 {
        bh = NET_H as f64;
        bw = NET_H as f64 * ratio;
    }
    (((bw + 0.5) as usize).clamp(1, NET_W), ((bh + 0.5) as usize).clamp(1, NET_H))
}

fn letterbox(rgba: &[u8], w: usize, h: usize) -> Vec<u8> {
    let (bw, bh) = fit_box(w, h);
    let (x0, y0) = ((NET_W - bw) / 2, (NET_H - bh) / 2);
    let mut out = alloc::vec![rgb_index(0, 0, 0); SLOTS];
    for y in 0..bh {
        let sy = (y * h / bh).min(h - 1);
        for x in 0..bw {
            let sx = (x * w / bw).min(w - 1);
            let p = (sy * w + sx) * 4;
            if p + 2 < rgba.len() {
                out[(y0 + y) * NET_W + x0 + x] = rgb_index(rgba[p], rgba[p + 1], rgba[p + 2]);
            }
        }
    }
    out
}

fn wire_emit(out: &mut Vec<u8>, addr: usize, data: &[u8]) {
    let n = data.len();
    let hdr = |out: &mut Vec<u8>, a: usize, len: usize| out.extend_from_slice(&[(a & 0xFF) as u8, ((a >> 8) & 0xFF) as u8, (len & 0xFF) as u8, ((len >> 8) & 0xFF) as u8]);
    let mut i = 0;
    while i < n {
        let mut j = i + 1;
        while j < n && data[j] == data[i] {
            j += 1;
        }
        let mut run = j - i;
        if run >= MIN_RUN {
            while run > 0 {
                let take = run.min(MAX_SEG);
                hdr(out, addr + i, take | 0x8000);
                out.push(data[i]);
                i += take;
                run -= take;
            }
            continue;
        }
        let mut k = i;
        while k < n {
            let mut m = k + 1;
            while m < n && data[m] == data[k] {
                m += 1;
            }
            if m - k >= MIN_RUN {
                break;
            }
            k = m;
        }
        while k > i {
            let take = (k - i).min(MAX_SEG);
            hdr(out, addr + i, take);
            out.extend_from_slice(&data[i..i + take]);
            i += take;
        }
    }
}

fn encode_delta(prev: Option<&[u8]>, cur: &[u8], keyframe: bool) -> Vec<u8> {
    let mut out = Vec::new();
    match prev {
        Some(p) if !keyframe => {
            let mut start: Option<usize> = None;
            let mut gap = 0;
            let mut spans: Vec<(usize, usize)> = Vec::new();
            for i in 0..cur.len() {
                if cur[i] != p[i] {
                    if start.is_none() {
                        start = Some(i);
                    }
                    gap = 0;
                } else if let Some(s) = start {
                    gap += 1;
                    if gap > BRIDGE {
                        spans.push((s, i - gap + 1));
                        start = None;
                    }
                }
            }
            if let Some(s) = start {
                spans.push((s, cur.len()));
            }
            for (lo, hi) in spans {
                wire_emit(&mut out, lo, &cur[lo..hi]);
            }
        }
        _ => wire_emit(&mut out, 0, cur),
    }
    out
}

fn assemble_cmds(text: &str) -> Result<Vec<[u8; 4]>, String> {
    let mut q = Vec::new();
    for (n, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(|c: char| c == ',' || c.is_whitespace()).filter(|x| !x.is_empty()).collect();
        let name = parts[0].to_ascii_uppercase();
        let (op, want) = match name.as_str() {
            "FILL8" => (0x18u8, 3usize),
            "ROW" => (0x28, 2),
            "SEEK" => (0x38, 2),
            "SAVE" => (0x48, 0),
            "LOAD" => (0x58, 0),
            "RESET" => (0x68, 0),
            _ => return Err(format!("line {}: unknown instruction {}", n + 1, parts[0])),
        };
        let mut args: Vec<u8> = Vec::new();
        for t in &parts[1..] {
            let v: i64 = t.parse().map_err(|_| format!("line {}: {} is not a number", n + 1, t))?;
            args.push(v as u8);
        }
        if args.len() != want {
            return Err(format!("line {}: {} takes {} operand(s), got {}", n + 1, name, want, args.len()));
        }
        while args.len() < 3 {
            args.push(0);
        }
        q.push([op, args[0], args[1], args[2]]);
    }
    if q.is_empty() {
        return Err("nothing to assemble".into());
    }
    Ok(q)
}

fn rmse(a: &[u8], b: &[u8]) -> f64 {
    let n = a.len().min(b.len());
    if n == 0 {
        return 0.0;
    }
    let s: f64 = (0..n)
        .map(|i| {
            let d = a[i] as f64 - b[i] as f64;
            d * d
        })
        .sum();
    let x = s / n as f64;
    // the square root, by Newton's method (no std here)
    let mut r = if x > 1.0 { x / 2.0 } else { 1.0 };
    for _ in 0..40 {
        r = 0.5 * (r + x / r);
    }
    if x == 0.0 { 0.0 } else { r }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_encode(d: &[u8]) -> String {
    let mut s = String::with_capacity(d.len() * 4 / 3 + 4);
    for c in d.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for k in 0..4 {
            if k <= c.len() {
                s.push(B64[((n >> (18 - 6 * k)) & 63) as usize] as char);
            } else {
                s.push('=');
            }
        }
    }
    s
}

fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return None,
        } as u32;
        acc = (acc << 6 | v) & 0xFFFFFF;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

// ---------------------------------------------------------------------------------------------- the page

fn hal_open() -> bool {
    let s = st();
    matches!(s.page, Page::Item(g, m) if matches!(GROUPS.get(g as usize).and_then(|x| x.members.get(m as usize)), Some((_, Target::Tool(Tool::Hal)))))
}

fn hal_load() {
    let h = &mut st().hal;
    if !h.on {
        h.boot();
    }
    if !h.ticking {
        h.ticking = true;
        host::timer(16, T_HAL);
    }
}

/// A frame: run the machine for a while, feed the portal, and draw what changed.
fn hal_tick() -> bool {
    let h = &mut st().hal;
    if !hal_open() {
        h.ticking = false;
        return false;
    }
    if h.p.dump.is_some() && host::now() - h.p.dump_since > 20_000.0 {
        h.p.dump = None;
        h.readback_done(None);
    }
    let now = host::now();
    if h.rx_t > 0.0 {
        h.rx_budget = (h.rx_budget + (now - h.rx_t) * 16.0).min(4096.0);
    }
    h.rx_t = now;
    if h.p.dump_wait && h.rx.is_empty() {
        h.p.dump_wait = false;
        h.p.dump = Some(Vec::with_capacity(SLOTS));
        h.p.dump_since = now;
        h.send(&[0xFF, 0xFF, 0x01, 0x00]);
    }
    h.portal_tick();
    if !h.halted && !(h.waiting && h.keys.is_empty()) {
        h.waiting = false;
        h.run(if h.net { 12.0 } else { 6.0 });
    }
    host::timer(16, T_HAL);
    if h.vdirty && h.gfx {
        h.vdirty = false;
        hal_blit();
    }
    let d = h.dirty;
    h.dirty = false;
    d
}

/// Mode 13h through the palette, onto the screen's canvas.
fn hal_blit() {
    let h = &mut st().hal;
    if h.rgba.len() != 320 * 200 * 4 || h.mem.len() < 0xAFA00 || h.dac.len() != 768 {
        return;
    }
    for i in 0..64000 {
        let c = h.mem[0xA0000 + i] as usize * 3;
        let o = i * 4;
        h.rgba[o] = h.dac[c] << 2 | h.dac[c] >> 4;
        h.rgba[o + 1] = h.dac[c + 1] << 2 | h.dac[c + 1] >> 4;
        h.rgba[o + 2] = h.dac[c + 2] << 2 | h.dac[c + 2] >> 4;
        h.rgba[o + 3] = 255;
    }
    host::call("blit", &format!(".hal-vga\t{}\t{}\t320\t200", h.rgba.as_ptr() as usize, h.rgba.len()));
}

/// A 320×100 neuron frame drawn as the guest shows it (each neuron two rows tall), onto a canvas.
fn hal_draw(sel: &str, frame: &[u8]) {
    let mut img = alloc::vec![0u8; 320 * 200 * 4];
    for y in 0..200 {
        let row = (y >> 1) * NET_W;
        for x in 0..320 {
            let (r, g, b) = palette_rgb(frame.get(row + x).copied().unwrap_or(OUT_LO));
            let o = (y * 320 + x) * 4;
            img[o] = r;
            img[o + 1] = g;
            img[o + 2] = b;
            img[o + 3] = 255;
        }
    }
    host::call("blit", &format!("{}\t{}\t{}\t320\t200", sel, img.as_ptr() as usize, img.len()));
}

/// After the page is drawn: paint the canvases it holds (they are filled by hand, not by the virtual DOM).
fn hal_paint() {
    let h = &mut st().hal;
    if !h.on || !hal_open() {
        return;
    }
    if h.gfx {
        hal_blit();
    }
    let h = &st().hal;
    if h.net {
        let pv = h.p.preview.clone().unwrap_or_else(|| alloc::vec![OUT_LO; SLOTS]);
        hal_draw(".hal-preview", &pv);
        let rb = h.p.readback.clone().unwrap_or_else(|| alloc::vec![OUT_LO; SLOTS]);
        hal_draw(".hal-readback", &rb);
    }
}

pub fn hal_pixels(token: u32, data: Vec<u8>, w: u32, ht: u32) {
    let h = &mut st().hal;
    let k = token - HAL_TOKEN;
    if k == 9999 {
        // a weight disk the person chose
        if data.len() >= 2 && u16::from_le_bytes([data[0], data[1]]) == WEIGHT_MAGIC {
            let mut wbuf = alloc::vec![0u8; HAL_WEIGHT_BYTES];
            let n = data.len().min(HAL_WEIGHT_BYTES);
            wbuf[..n].copy_from_slice(&data[..n]);
            h.weights = wbuf;
            h.save_weights();
            h.boot_net();
            h.p.hint = "Weights loaded; the network rebooted with them.".into();
        } else {
            h.p.hint = "That file is not a HAL-OS weight disk (no signature at sector 0).".into();
        }
        return;
    }
    h.p.loading = h.p.loading.saturating_sub(1);
    if w > 0 && ht > 0 {
        let frame = letterbox(&data, w as usize, ht as usize);
        if h.p.images.is_empty() {
            h.p.preview = Some(frame.clone());
        }
        h.p.images.push(frame);
        h.p.source = "images".into();
        h.p.img_since = host::now();
        h.p.prev = None;
    }
    h.dirty = true;
}

fn hal_update(a: u16, v: String) {
    let h = &mut st().hal;
    match a {
        1 => h.key(&v),
        2 => {
            h.net = false;
            h.boot();
        }
        3 => {
            for c in v.chars() {
                h.key(&c.to_string());
            }
            h.key("Enter");
        }
        // the portal
        10 => {
            h.p.source = v;
            h.p.prev = None;
        }
        11 => {
            // pictures: file handles from the host, one per line
            h.p.images.clear();
            h.p.img_at = 0;
            for (i, line) in v.lines().take(200).enumerate() {
                if let Some(id) = line.split('\t').next() {
                    h.p.loading += 1;
                    host::call("rgba", &format!("{}\t{}\t640", HAL_TOKEN + i as u32, id));
                }
            }
        }
        12 => h.p.text = v,
        13 => {
            h.p.armed = !h.p.armed;
            h.p.prev = None;
            h.p.hint = if h.p.armed {
                "Live. Every byte sent is a weight update — the network cannot be un-taught.".into()
            } else {
                "Pick a source, then press INJECT. Nothing goes on the wire until you do.".into()
            };
        }
        14 => h.p.fps = v.parse().unwrap_or(8).clamp(1, 30),
        15 => h.p.keyframe_every = v.parse().unwrap_or(8).clamp(1, 64),
        16 => h.p.chan_keys = v == "1",
        17 => {
            h.p.chan_mouse = v == "1";
            if !h.p.chan_mouse {
                h.p.mouse = None;
            }
        }
        18 => {
            let mut it = v.split(',').map(|x| x.parse::<f64>().unwrap_or(0.0));
            let (x, y, w, ht) = (it.next().unwrap_or(0.0), it.next().unwrap_or(0.0), it.next().unwrap_or(1.0), it.next().unwrap_or(1.0));
            if w > 0.0 && ht > 0.0 {
                h.p.mouse = Some((((x / w) * NET_W as f64) as usize % NET_W, ((y / ht) * NET_H as f64) as usize % NET_H));
            }
        }
        19 => {
            // read back what the network paints: let the line drain, then ask for a dump
            if h.p.dump.is_none() && !h.p.dump_wait && h.net {
                h.p.armed = false;
                h.p.rb_note = "reading back…".into();
                h.p.dump_wait = true;
            }
        }
        20 => {
            if h.program("SAVE") {
                h.p.hint = "Saved: the network wrote its weights to its disk, and this browser keeps a copy.".into();
                // give the kernel a moment to write, then keep the disk
                h.run(400.0);
                h.save_weights();
            }
        }
        21 => {
            if !h.p.reset_armed {
                h.p.reset_armed = true;
                return;
            }
            h.p.reset_armed = false;
            if h.program("RESET") {
                h.p.hint = "Reset: every weight re-seeded.".into();
            }
        }
        22 => {
            let w = h.weights.clone();
            host::download("hal-os-weights.img", "application/octet-stream", &w);
        }
        23 => {
            if let Some(id) = v.lines().next().and_then(|l| l.split('\t').next()) {
                host::call("bytes", &format!("{}\t{}", HAL_TOKEN + 9999, id));
            }
        }
        24 => h.p.program = v,
        25 => {
            let t = h.p.program.clone();
            if h.program(&t) {
                h.p.hint = "Program sent.".into();
            }
        }
        26 => h.boot_net(),
        27 => {
            host::store_del(WEIGHTS_KEY);
            h.weights = alloc::vec![0u8; HAL_WEIGHT_BYTES];
            h.boot_net();
            h.p.hint = "Forgotten: the network starts fresh.".into();
        }
        _ => {}
    }
}

const CGA: [&str; 16] = ["#000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa", "#555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#fff"];

fn text_screen(h: &Hal) -> Vec<N> {
    let mut rows: Vec<N> = Vec::new();
    if h.mem.len() < 0xB8FA0 {
        return rows;
    }
    let style = |at: u8| format!("color:{};background:{}", CGA[(at & 15) as usize], CGA[((at >> 4) & 7) as usize]);
    for row in 0..25usize {
        let mut line = el("div").cls("hal-row");
        let mut run = String::new();
        let mut run_attr = 0u8;
        for col in 0..80usize {
            let a = 0xB8000 + (row * 80 + col) * 2;
            let (ch, at) = (h.mem[a], h.mem[a + 1]);
            let c = if (32..127).contains(&ch) { ch as char } else if ch == 0 { ' ' } else { '·' };
            let cursor = h.cur == (row as u8, col as u8) && !h.halted;
            if (cursor || at != run_attr) && !run.is_empty() {
                line = line.kid(el("span").style(style(run_attr)).text(core::mem::take(&mut run)));
            }
            if cursor {
                line = line.kid(el("span").cls("hal-cur").style(style(at)).text(c.to_string()));
                continue;
            }
            run_attr = at;
            run.push(c);
        }
        if !run.is_empty() {
            line = line.kid(el("span").style(style(run_attr)).text(run));
        }
        rows.push(line.into());
    }
    rows
}

fn hal_view(s: &State) -> N {
    let h = &s.hal;
    let screen: N = if h.gfx {
        el("div")
            .cls("hal-screen gfx")
            .attr("tabindex", "0")
            .attr("role", "application")
            .attr("aria-label", "HAL-OS screen")
            .on("key", Msg::TV(Tool::Hal, 1))
            .on("mmove", Msg::TV(Tool::Hal, 18))
            .kid(el("canvas").cls("hal-vga").attr("width", "320").attr("height", "200"))
            .into()
    } else {
        el("div").cls("hal-screen").attr("tabindex", "0").attr("role", "application").attr("aria-label", "HAL-OS screen: click and type").on("key", Msg::TV(Tool::Hal, 1)).kids(text_screen(h)).into()
    };
    let state = if h.halted {
        "halted".to_string()
    } else if h.net {
        format!(
            "network · {:.0} frames/s · {}/s on the wire{}",
            h.p.fps_guest,
            bytes(h.p.rate),
            match h.p.restored {
                Some(true) => " · weights restored",
                Some(false) => " · weights fresh",
                None => "",
            }
        )
    } else if h.waiting {
        "shell · waiting for a key".to_string()
    } else {
        "running".to_string()
    };
    let mut root = el("div")
        .cls("tool hal")
        .kid(el("p").cls("lede").text(if h.net {
            "The ternary network: 32,000 neurons, one per pair of pixels, each with eight weights in {−1, 0, +1}, painting VGA mode 13h. Whatever goes down the serial line is training data: pick a source and press INJECT."
        } else {
            "HAL-OS boots here on an x86 machine written in Rust: a real 16-bit boot sector and shell, a BIOS, a text screen. Click the screen and type: try help, calc 6 * 7, note, notes, time, mem, color 1f — or hal to start the ternary network."
        }))
        .kid(screen)
        .kid(
            el("div")
                .cls("row hal-bar")
                .kid(el("span").cls("hal-dot").cls(if h.halted { "off" } else if h.p.armed && h.net { "live" } else { "on" }))
                .kid(el("span").cls("hint").text(format!("{} · {} instructions", state, num(h.steps as f64, 0))))
                .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Hal, 2, String::new())).text(if h.net { "Back to the shell" } else { "Reboot" }))
                .kid_if(!h.net, || el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Hal, 26, String::new())).text("Start the network").into()),
        )
        .kid_if(!h.note.is_empty(), || el("p").cls("hint warn").text(h.note.clone()).into());
    if h.net {
        let p = &h.p;
        let src = |v: &str, label: &str| -> N { el("option").attr("value", v.to_string()).attr_if(p.source == v, "selected", "").text(label.to_string()).into() };
        root = root.kid(
            el("div")
                .cls("hal-portal")
                .kid(
                    el("div")
                        .cls("card")
                        .kid(el("h3").text("Channels"))
                        .kid(
                            el("label")
                                .cls("field")
                                .kid(el("span").text("Source"))
                                .kid(el("select").on("change", Msg::TV(Tool::Hal, 10)).kid(src("none", "None")).kid(src("images", "Pictures")).kid(src("text", "Text")).kid(src("sine", "Moving sine")).kid(src("noise", "Noise"))),
                        )
                        .kid_if(p.source == "images", || {
                            el("label")
                                .cls("btn small")
                                .kid(el("input").attr("type", "file").attr("accept", "image/*").attr("multiple", "").attr("hidden", "").on("files", Msg::TV(Tool::Hal, 11)))
                                .text(if p.loading > 0 {
                                    format!("Loading {}…", p.loading)
                                } else if p.images.is_empty() {
                                    "Choose pictures".to_string()
                                } else {
                                    format!("{} picture{} · choose again", p.images.len(), if p.images.len() == 1 { "" } else { "s" })
                                })
                                .into()
                        })
                        .kid_if(p.source == "text", || el("input").cls("input").attr("type", "text").attr("placeholder", "Text to send").prop("value", p.text.clone()).on("input", Msg::TV(Tool::Hal, 12)).into())
                        .kid(el("label").cls("am-check").kid(el("input").attr("type", "checkbox").prop("checked", if p.chan_keys { "1" } else { "0" }).on("change", Msg::TV(Tool::Hal, 16))).kid(txt(" Keyboard: keys typed on the screen")))
                        .kid(el("label").cls("am-check").kid(el("input").attr("type", "checkbox").prop("checked", if p.chan_mouse { "1" } else { "0" }).on("change", Msg::TV(Tool::Hal, 17))).kid(txt(" Mouse: a marker where the pointer is")))
                        .kid(el("label").cls("field").kid(el("span").text(format!("Frames per second: {}", p.fps))).kid(el("input").attr("type", "range").attr("min", "1").attr("max", "30").prop("value", format!("{}", p.fps)).on("input", Msg::TV(Tool::Hal, 14))))
                        .kid(el("label").cls("field").kid(el("span").text(format!("A full frame every {}", p.keyframe_every))).kid(el("input").attr("type", "range").attr("min", "1").attr("max", "32").prop("value", format!("{}", p.keyframe_every)).on("input", Msg::TV(Tool::Hal, 15))))
                        .kid(el("button").attr("type", "button").cls("btn hal-inject").cls_if(p.armed, "live").attr("aria-pressed", if p.armed { "true" } else { "false" }).on("click", Msg::T(Tool::Hal, 13, String::new())).text(if p.armed { "INJECTING" } else { "INJECT" }))
                        .kid(el("p").cls("hint").text(p.hint.clone()))
                        .kid(el("p").cls("hint").text(format!("{} sent · {}× compression", bytes(p.sent as f64), if p.sent > 0 { p.trained / p.sent.max(1) } else { 0 }))),
                )
                .kid(
                    el("div")
                        .cls("card")
                        .kid(el("h3").text("Sent and read back"))
                        .kid(
                            el("div")
                                .cls("hal-pair")
                                .kid(el("figure").kid(el("canvas").cls("hal-preview").attr("width", "320").attr("height", "200")).kid(el("figcaption").text("last frame sent")))
                                .kid(el("figure").kid(el("canvas").cls("hal-readback").attr("width", "320").attr("height", "200")).kid(el("figcaption").text(p.rb_note.clone().or_text("readback")))),
                        )
                        .kid(el("button").attr("type", "button").cls("btn small").attr_if(p.dump.is_some() || p.dump_wait, "disabled", "").on("click", Msg::T(Tool::Hal, 19, String::new())).text("Read back and score")),
                )
                .kid(
                    el("div")
                        .cls("card")
                        .kid(el("h3").text("Weights and programs"))
                        .kid(
                            el("div")
                                .cls("row")
                                .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Hal, 20, String::new())).text("Save"))
                                .kid(el("button").attr("type", "button").cls("btn small danger").on("click", Msg::T(Tool::Hal, 21, String::new())).text(if p.reset_armed { "Really reset?" } else { "Reset" }))
                                .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Hal, 22, String::new())).text("Download weights"))
                                .kid(el("label").cls("btn small").kid(el("input").attr("type", "file").attr("hidden", "").on("files", Msg::TV(Tool::Hal, 23))).text("Upload weights"))
                                .kid(el("button").attr("type", "button").cls("btn small ghost").on("click", Msg::T(Tool::Hal, 27, String::new())).text("Forget")),
                        )
                        .kid(el("p").cls("hint").text("Commands travel on the wire's control plane, which no pixel address can reach: FILL8 x y v · ROW y v · SEEK a b · SAVE · LOAD · RESET."))
                        .kid(el("textarea").cls("learn-code").attr("rows", "3").attr("placeholder", "ROW 188 31").prop("value", p.program.clone()).on("input", Msg::TV(Tool::Hal, 24)))
                        .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Hal, 25, String::new())).text("Run")),
                ),
        );
    }
    root.into()
}

const HAL_CSS: &str = "\
.hal-screen{background:#000;color:var(--faint);font:15px/1.2 var(--mono,ui-monospace,monospace);padding:10px;border-radius:10px;overflow:auto;white-space:pre;outline:none;box-shadow:inset 0 0 0 1px #222;cursor:text;max-width:100%}\
.hal-screen.gfx{padding:0;line-height:0;display:inline-block}.hal-vga{width:640px;max-width:100%;aspect-ratio:4/3;image-rendering:pixelated;display:block;border-radius:10px}\
.hal-screen:focus{box-shadow:inset 0 0 0 2px #2563eb}\
.hal-row{height:1.2em}\
.hal-cur{animation:halblink 1s steps(1) infinite}@keyframes halblink{50%{color:#000 !important;background:#aaa !important}}\
.hal-bar{margin-top:8px;align-items:center;flex-wrap:wrap}.hal-dot{width:9px;height:9px;border-radius:50%;background:#999}.hal-dot.on{background:#16a34a}.hal-dot.live{background:#dc2626}\
.hal-portal{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:14px}\
.hal-portal .field{display:flex;flex-direction:column;gap:4px;margin:8px 0}\
.hal-inject{font-weight:700;letter-spacing:.06em;margin-top:8px}.hal-inject.live{background:#dc2626;color:#fff;border-color:#dc2626}\
.hal-pair{display:flex;gap:10px;flex-wrap:wrap}.hal-pair figure{margin:0;flex:1 1 140px}.hal-pair canvas{width:100%;aspect-ratio:4/3;image-rendering:pixelated;background:#000;border-radius:6px}\
.hal-pair figcaption{font-size:12px;color:var(--faint);margin-top:4px}\
";
