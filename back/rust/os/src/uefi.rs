//! The firmware, as piii OS uses it: UEFI's tables and protocols, declared by hand (no dependencies), and kept to
//! what EFI 1.10 also has, since a 2008 Mac (MacBookPro4,1) has that. piii OS stays on the firmware's boot services:
//! the firmware keeps driving the USB keyboard and mouse (a paired Bluetooth mouse too, through the Mac's HID
//! proxy), and piii OS draws the whole screen itself.

use core::ffi::c_void;
use core::ptr::null_mut;

pub type Handle = *mut c_void;
pub type Status = usize;
pub const SUCCESS: Status = 0;

#[repr(C)]
pub struct Guid(pub u32, pub u16, pub u16, pub [u8; 8]);

pub const GOP: Guid = Guid(0x9042a9de, 0x23dc, 0x4a38, [0x96, 0xfb, 0x7a, 0xde, 0xd0, 0x80, 0x51, 0x6a]);
pub const UGA: Guid = Guid(0x982c298b, 0xf4fa, 0x41cb, [0xb8, 0x38, 0x77, 0xaa, 0x68, 0x8f, 0xb8, 0x39]);
pub const CONSOLE_CONTROL: Guid = Guid(0xf42f7782, 0x012e, 0x4c12, [0x99, 0x56, 0x49, 0xf9, 0x43, 0x04, 0xf7, 0x21]);
pub const POINTER: Guid = Guid(0x31878c87, 0x0b75, 0x11d5, [0x9a, 0x4f, 0x00, 0x90, 0x27, 0x3f, 0xc1, 0x4d]);
pub const ABS_POINTER: Guid = Guid(0x8d59d32b, 0xc655, 0x4ae9, [0x9b, 0x15, 0xf2, 0x59, 0x04, 0x99, 0x2a, 0x43]);
pub const TEXT_IN_EX: Guid = Guid(0xdd9e7534, 0x7762, 0x4698, [0x8c, 0x14, 0xf5, 0x85, 0x17, 0xa6, 0x25, 0xaa]);

#[repr(C)]
pub struct Header {
    pub sig: u64,
    pub rev: u32,
    pub size: u32,
    pub crc: u32,
    pub reserved: u32,
}

#[repr(C)]
pub struct SystemTable {
    pub hdr: Header,
    pub vendor: *const u16,
    pub fw_rev: u32,
    pub con_in_handle: Handle,
    pub con_in: *mut TextIn,
    pub con_out_handle: Handle,
    pub con_out: *mut TextOut,
    pub err_handle: Handle,
    pub err: *mut TextOut,
    pub runtime: *mut Services,
    pub boot: *mut Services,
    pub n_tables: usize,
    pub tables: *mut c_void,
}

/// A service table: its header, then its functions in the order the specification lists them.
#[repr(C)]
pub struct Services {
    pub hdr: Header,
    pub f: [usize; 38],
}

// boot services, by place
const ALLOCATE_POOL: usize = 5;
const FREE_POOL: usize = 6;
const HANDLE_PROTOCOL: usize = 16;
const STALL: usize = 28;
const SET_WATCHDOG: usize = 29;
const LOCATE_HANDLE_BUFFER: usize = 36;
// runtime services
const RESET_SYSTEM: usize = 10;

#[repr(C)]
pub struct InputKey {
    pub scan: u16,
    pub ch: u16,
}

#[repr(C)]
pub struct TextIn {
    pub reset: extern "efiapi" fn(*mut TextIn, u8) -> Status,
    pub read: extern "efiapi" fn(*mut TextIn, *mut InputKey) -> Status,
    pub wait: *mut c_void,
}

#[repr(C)]
pub struct KeyData {
    pub key: InputKey,
    pub shift: u32,
    pub toggle: u8,
}

#[repr(C)]
pub struct TextInEx {
    pub reset: extern "efiapi" fn(*mut TextInEx, u8) -> Status,
    pub read: extern "efiapi" fn(*mut TextInEx, *mut KeyData) -> Status,
    pub wait: *mut c_void,
}

#[repr(C)]
pub struct TextOut {
    pub reset: extern "efiapi" fn(*mut TextOut, u8) -> Status,
    pub output: extern "efiapi" fn(*mut TextOut, *const u16) -> Status,
}

#[repr(C)]
pub struct GopInfo {
    pub version: u32,
    pub hres: u32,
    pub vres: u32,
    pub format: u32,
    pub masks: [u32; 4],
    pub stride: u32,
}

#[repr(C)]
pub struct GopMode {
    pub max_mode: u32,
    pub mode: u32,
    pub info: *mut GopInfo,
    pub info_size: usize,
    pub fb: u64,
    pub fb_size: usize,
}

type Blt<T> = extern "efiapi" fn(*mut T, *mut u32, u32, usize, usize, usize, usize, usize, usize, usize) -> Status;

#[repr(C)]
pub struct Gop {
    pub query: extern "efiapi" fn(*mut Gop, u32, *mut usize, *mut *mut GopInfo) -> Status,
    pub set_mode: extern "efiapi" fn(*mut Gop, u32) -> Status,
    pub blt: Blt<Gop>,
    pub mode: *mut GopMode,
}

#[repr(C)]
pub struct Uga {
    pub get_mode: extern "efiapi" fn(*mut Uga, *mut u32, *mut u32, *mut u32, *mut u32) -> Status,
    pub set_mode: extern "efiapi" fn(*mut Uga, u32, u32, u32, u32) -> Status,
    pub blt: Blt<Uga>,
}

#[repr(C)]
pub struct ConsoleControl {
    pub get_mode: extern "efiapi" fn(*mut ConsoleControl, *mut u32, *mut u8, *mut u8) -> Status,
    pub set_mode: extern "efiapi" fn(*mut ConsoleControl, u32) -> Status,
}

#[repr(C)]
pub struct PointerState {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub left: u8,
    pub right: u8,
}

#[repr(C)]
pub struct PointerMode {
    pub res_x: u64,
    pub res_y: u64,
    pub res_z: u64,
    pub left: u8,
    pub right: u8,
}

#[repr(C)]
pub struct Pointer {
    pub reset: extern "efiapi" fn(*mut Pointer, u8) -> Status,
    pub state: extern "efiapi" fn(*mut Pointer, *mut PointerState) -> Status,
    pub wait: *mut c_void,
    pub mode: *mut PointerMode,
}

#[repr(C)]
pub struct AbsState {
    pub x: u64,
    pub y: u64,
    pub z: u64,
    pub buttons: u32,
}

#[repr(C)]
pub struct AbsMode {
    pub min_x: u64,
    pub min_y: u64,
    pub min_z: u64,
    pub max_x: u64,
    pub max_y: u64,
    pub max_z: u64,
    pub attributes: u32,
}

#[repr(C)]
pub struct AbsPointer {
    pub reset: extern "efiapi" fn(*mut AbsPointer, u8) -> Status,
    pub state: extern "efiapi" fn(*mut AbsPointer, *mut AbsState) -> Status,
    pub wait: *mut c_void,
    pub mode: *mut AbsMode,
}

// ------------------------------------------------------------------------------------------------- the tables

static mut ST: *mut SystemTable = null_mut();
static mut IMAGE: Handle = null_mut();

pub fn init(image: Handle, st: *mut SystemTable) {
    unsafe {
        ST = st;
        IMAGE = image;
    }
}

pub fn st() -> &'static SystemTable {
    unsafe { &*ST }
}

fn bs(i: usize) -> usize {
    unsafe { (*(*ST).boot).f[i] }
}

pub fn ready() -> bool {
    unsafe { !ST.is_null() }
}

pub fn alloc_pool(size: usize) -> *mut u8 {
    let f: extern "efiapi" fn(u32, usize, *mut *mut u8) -> Status = unsafe { core::mem::transmute(bs(ALLOCATE_POOL)) };
    let mut p: *mut u8 = null_mut();
    // 2: EfiLoaderData
    if f(2, size, &mut p) == SUCCESS { p } else { null_mut() }
}

pub fn free_pool(p: *mut u8) {
    let f: extern "efiapi" fn(*mut u8) -> Status = unsafe { core::mem::transmute(bs(FREE_POOL)) };
    f(p);
}

pub fn stall(us: usize) {
    let f: extern "efiapi" fn(usize) -> Status = unsafe { core::mem::transmute(bs(STALL)) };
    f(us);
}

/// The firmware restarts a program that runs five minutes without this.
pub fn no_watchdog() {
    let f: extern "efiapi" fn(usize, u64, usize, *const u16) -> Status = unsafe { core::mem::transmute(bs(SET_WATCHDOG)) };
    f(0, 0, 0, core::ptr::null());
}

pub fn handle_protocol<T>(h: Handle, g: &Guid) -> Option<*mut T> {
    let f: extern "efiapi" fn(Handle, *const Guid, *mut *mut c_void) -> Status = unsafe { core::mem::transmute(bs(HANDLE_PROTOCOL)) };
    let mut p: *mut c_void = null_mut();
    if !h.is_null() && f(h, g, &mut p) == SUCCESS && !p.is_null() { Some(p as *mut T) } else { None }
}

/// Every handle that has a protocol.
pub fn handles(g: &Guid) -> alloc::vec::Vec<Handle> {
    let f: extern "efiapi" fn(u32, *const Guid, *mut c_void, *mut usize, *mut *mut Handle) -> Status =
        unsafe { core::mem::transmute(bs(LOCATE_HANDLE_BUFFER)) };
    let (mut n, mut buf): (usize, *mut Handle) = (0, null_mut());
    let mut out = alloc::vec::Vec::new();
    // 2: ByProtocol
    if f(2, g, null_mut(), &mut n, &mut buf) == SUCCESS && !buf.is_null() {
        for i in 0..n {
            out.push(unsafe { *buf.add(i) });
        }
        free_pool(buf as *mut u8);
    }
    out
}

/// 0 restarts cold, 2 switches off.
pub fn reset(kind: u32) -> ! {
    let f: extern "efiapi" fn(u32, Status, usize, *const c_void) -> ! = unsafe { core::mem::transmute((*st().runtime).f[RESET_SYSTEM]) };
    f(kind, SUCCESS, 0, core::ptr::null())
}

/// Text on the firmware's console (only before the screen is drawn on, and for a panic).
pub fn print(s: &str) {
    let out = st().con_out;
    if out.is_null() {
        return;
    }
    let mut buf = [0u16; 256];
    let mut i = 0;
    for c in s.chars() {
        if i >= buf.len() - 2 {
            break;
        }
        if c == '\n' {
            buf[i] = '\r' as u16;
            i += 1;
        }
        buf[i] = if (c as u32) < 0x10000 { c as u16 } else { '?' as u16 };
        i += 1;
    }
    buf[i] = 0;
    unsafe { ((*out).output)(out, buf.as_ptr()) };
}

/// The firmware's name, as it gives it.
pub fn vendor() -> alloc::string::String {
    let mut s = alloc::string::String::new();
    let p = st().vendor;
    if p.is_null() {
        return s;
    }
    for i in 0..64 {
        let c = unsafe { *p.add(i) };
        if c == 0 {
            break;
        }
        s.push(char::from_u32(c as u32).unwrap_or('?'));
    }
    s
}

// ------------------------------------------------------------------------------------------------- memory

pub struct Pool;

unsafe impl core::alloc::GlobalAlloc for Pool {
    unsafe fn alloc(&self, l: core::alloc::Layout) -> *mut u8 {
        if l.align() <= 8 {
            return alloc_pool(l.size().max(1));
        }
        // more than the pool's 8: room to move up to the alignment, the pool's own pointer kept just below
        let raw = alloc_pool(l.size() + l.align() + 8);
        if raw.is_null() {
            return raw;
        }
        let start = raw as usize + 8;
        let aligned = (start + l.align() - 1) & !(l.align() - 1);
        *((aligned - 8) as *mut usize) = raw as usize;
        aligned as *mut u8
    }
    unsafe fn dealloc(&self, p: *mut u8, l: core::alloc::Layout) {
        if l.align() <= 8 {
            free_pool(p);
        } else {
            free_pool(*((p as usize - 8) as *const usize) as *mut u8);
        }
    }
}

// ------------------------------------------------------------------------------------------------- a log, for emulators

/// A line on the first serial port (an emulator shows it; on a machine without one, nothing happens).
pub fn log(s: &str) {
    #[cfg(target_arch = "x86_64")]
    unsafe {
        use core::arch::asm;
        for b in s.bytes().chain(core::iter::once(b'\n')) {
            let mut spins = 0;
            loop {
                let lsr: u8;
                asm!("in al, dx", out("al") lsr, in("dx") 0x3FDu16, options(nomem, nostack));
                if lsr & 0x20 != 0 || spins > 10_000 {
                    break;
                }
                spins += 1;
            }
            asm!("out dx, al", in("dx") 0x3F8u16, in("al") b, options(nomem, nostack));
        }
    }
}

/// The processor's name (cpuid's brand string).
pub fn cpu() -> alloc::string::String {
    #[cfg(target_arch = "x86_64")]
    {
        use core::arch::x86_64::__cpuid;
        let max = unsafe { __cpuid(0x8000_0000) }.eax;
        if max >= 0x8000_0004 {
            let mut b = alloc::vec::Vec::new();
            for leaf in 0x8000_0002u32..=0x8000_0004 {
                let r = unsafe { __cpuid(leaf) };
                for reg in [r.eax, r.ebx, r.ecx, r.edx] {
                    b.extend_from_slice(&reg.to_le_bytes());
                }
            }
            let s: alloc::string::String = b.iter().take_while(|c| **c != 0).map(|c| *c as char).collect();
            return s.split_whitespace().collect::<alloc::vec::Vec<_>>().join(" ");
        }
    }
    alloc::string::String::from("unknown")
}

#[allow(dead_code)]
pub fn image() -> Handle {
    unsafe { IMAGE }
}
