//! piii OS's own USB mouse driver (owner, 2026-10-17: "make a bluetooth function so i can connect the old mac to
//! pebble logi mouse"). The 2008 Mac's Bluetooth (2.0) cannot reach a Pebble (Bluetooth Low Energy, 4.0), but its
//! USB receiver is an ordinary USB mouse, and so are the Mac's own trackpad (USB inside) and any Bluetooth mouse the
//! Mac hands to the firmware (its HID proxy). The firmware's USB layer reaches every USB device, with or without a
//! mouse driver of its own: through it, each mouse is put into the boot protocol every mouse speaks (buttons, then
//! how far in x and y), and its reports are gathered as they arrive.

use crate::uefi::{self, *};
use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use core::ffi::c_void;
use core::sync::atomic::{AtomicI32, AtomicU32, Ordering};

static DX: AtomicI32 = AtomicI32::new(0);
static DY: AtomicI32 = AtomicI32::new(0);
/// the buttons held, as the last report said (bit 0: left)
static BUTTONS: AtomicU32 = AtomicU32::new(0);
/// reports seen (to know a mouse is alive)
static REPORTS: AtomicU32 = AtomicU32::new(0);
/// the left button's presses and releases since last asked (a quick click is both, between two looks)
static DOWNS: AtomicU32 = AtomicU32::new(0);
static UPS: AtomicU32 = AtomicU32::new(0);
/// the last report as it came (its first 8 bytes, and its length), to show in Devices
static LAST: [core::sync::atomic::AtomicU8; 8] = [const { core::sync::atomic::AtomicU8::new(0) }; 8];
static LAST_LEN: AtomicU32 = AtomicU32::new(0);
/// whether each mouse took the boot protocol (buttons, x, y): 1 yes, 2 no
static BOOT_OK: AtomicU32 = AtomicU32::new(0);

/// What a report says: the buttons, then how far in x and in y.
fn feed(b: &[u8]) {
    if b.len() >= 3 && b[1..].iter().any(|x| *x != 0) {
        for (i, x) in b.iter().take(8).enumerate() {
            LAST[i].store(*x, Ordering::Relaxed);
        }
        LAST_LEN.store(b.len() as u32, Ordering::Relaxed);
    }
    if b.len() >= 3 {
        let before = BUTTONS.swap(b[0] as u32, Ordering::Relaxed) & 1;
        let now = b[0] as u32 & 1;
        if now == 1 && before == 0 {
            DOWNS.fetch_add(1, Ordering::Relaxed);
            uefi::log("piii OS: usb button down");
        } else if now == 0 && before == 1 {
            UPS.fetch_add(1, Ordering::Relaxed);
            uefi::log("piii OS: usb button up");
        }
        DX.fetch_add(b[1] as i8 as i32, Ordering::Relaxed);
        DY.fetch_add(b[2] as i8 as i32, Ordering::Relaxed);
        REPORTS.fetch_add(1, Ordering::Relaxed);
    }
}

/// A report from a mouse, when the firmware gathers them (on its own timer).
extern "efiapi" fn report(data: *mut u8, len: usize, _ctx: *mut c_void, status: u32) -> Status {
    if status == 0 && !data.is_null() {
        feed(unsafe { core::slice::from_raw_parts(data, len) });
    }
    SUCCESS
}

/// The last report that moved something, in hexadecimal, and whether the mouse took the boot protocol.
pub fn last_report() -> String {
    let n = (LAST_LEN.load(Ordering::Relaxed) as usize).min(8);
    let mut s = String::new();
    for i in 0..n {
        s.push_str(&format!("{:02x} ", LAST[i].load(Ordering::Relaxed)));
    }
    let boot = match BOOT_OK.load(Ordering::Relaxed) {
        1 => "took the simple (boot) format",
        2 => "refused the simple (boot) format",
        _ => "",
    };
    format!("{}({} bytes){}{}", s, LAST_LEN.load(Ordering::Relaxed), if boot.is_empty() { "" } else { "; it " }, boot)
}

/// The reports seen since piii OS started (to count how many a second arrive).
pub fn reports() -> u32 {
    REPORTS.load(Ordering::Relaxed)
}

pub struct Mice {
    pub found: Vec<String>,
    /// the mice piii OS asks itself, at every look of its loop: (the device, its endpoint, a report's size)
    asked: Vec<(*mut UsbIo, u8, usize)>,
}

/// The mice piii OS reads itself: every USB boot mouse that the firmware does not already read.
pub fn start() -> Mice {
    let mut found = Vec::new();
    let mut asked = Vec::new();
    for h in uefi::handles(&USB_IO) {
        // a firmware that has its own driver for it gives a pointer there: left to the firmware
        if handle_protocol::<Pointer>(h, &POINTER).is_some() {
            continue;
        }
        let Some(io) = handle_protocol::<UsbIo>(h, &USB_IO) else { continue };
        let mut ifd = UsbInterfaceDesc::default();
        if unsafe { ((*io).interface_desc)(io, &mut ifd) } != SUCCESS {
            continue;
        }
        // a HID device whose protocol is a mouse (boot subclass, or a report-protocol device that says mouse)
        if ifd.class != 3 || ifd.protocol != 2 {
            continue;
        }
        let mut dd = UsbDeviceDesc::default();
        unsafe { ((*io).device_desc)(io, &mut dd) };
        let (vendor, product) = (dd.vendor, dd.product);
        // the interrupt endpoint the reports come on
        let mut ep: Option<(u8, usize, usize)> = None;
        for i in 0..ifd.n_endpoints {
            let mut e = UsbEndpointDesc::default();
            if unsafe { ((*io).endpoint_desc)(io, i, &mut e) } == SUCCESS && e.address & 0x80 != 0 && e.attributes & 3 == 3 {
                let mp = e.max_packet;
                ep = Some((e.address, (mp & 0x7ff) as usize, (e.interval as usize).clamp(1, 32)));
                break;
            }
        }
        let Some((addr, max, interval)) = ep else { continue };
        // the boot protocol (buttons, x, y), and reports only when something changes
        let mut st = 0u32;
        let mut set_protocol = UsbRequest { kind: 0x21, request: 0x0B, value: 0, index: ifd.number as u16, length: 0 };
        let mut set_idle = UsbRequest { kind: 0x21, request: 0x0A, value: 0, index: ifd.number as u16, length: 0 };
        unsafe {
            // 2: no data stage
            let r = ((*io).control)(io, &mut set_protocol, 2, 1000, core::ptr::null_mut(), 0, &mut st);
            BOOT_OK.store(if r == SUCCESS { 1 } else { 2 }, Ordering::Relaxed);
            uefi::log(&format!("piii OS: boot protocol: {}", if r == SUCCESS { "yes" } else { "refused" }));
            ((*io).control)(io, &mut set_idle, 2, 1000, core::ptr::null_mut(), 0, &mut st);
        }
        // Asked directly at each look of piii OS's own loop (about 200 a second) when the firmware lets it: an older
        // firmware gathers a mouse's reports on its own timer only every 50 ms or so, and the pointer then jumps
        // 20 times a second instead of gliding. A try with a short wait says whether this works here.
        let size = max.clamp(3, 64);
        let mut buf = [0u8; 64];
        let mut len = size;
        let mut st = 0u32;
        let probe = unsafe { ((*io).sync_interrupt)(io, addr, buf.as_mut_ptr() as *mut c_void, &mut len, 2, &mut st) };
        // 0: a report came; 0x8000000000000012: none in the wait (the mouse was still), which is fine too
        let direct = probe == SUCCESS || probe == 0x8000_0000_0000_0012;
        if probe == SUCCESS {
            feed(&buf[..len.min(64)]);
        }
        let r = if direct {
            asked.push((io, addr, size));
            SUCCESS
        } else {
            unsafe { ((*io).async_interrupt)(io, addr, 1, interval, size, Some(report), core::ptr::null_mut()) }
        };
        let who = match vendor {
            0x046d => "Logitech",
            0x05ac => "Apple",
            0x045e => "Microsoft",
            _ => "USB",
        };
        let line = format!(
            "{} mouse {:04x}:{:04x}{}",
            who,
            vendor,
            product,
            if r != SUCCESS { " (could not be read)" } else if direct { ", asked directly" } else { ", through the firmware's timer" }
        );
        uefi::log(&format!("piii OS: {}", line));
        if r == SUCCESS {
            found.push(line);
        }
    }
    Mice { found, asked }
}

impl Mice {
    /// what the mice did since last asked: how far, the left button's presses and releases, and whether it is held
    pub fn take(&self) -> Option<(i32, i32, u32, u32, bool)> {
        // the mice asked directly: what each has (a still mouse answers nothing within the 1 ms wait)
        for &(io, addr, size) in &self.asked {
            let mut buf = [0u8; 64];
            let mut len = size;
            let mut st = 0u32;
            if unsafe { ((*io).sync_interrupt)(io, addr, buf.as_mut_ptr() as *mut c_void, &mut len, 1, &mut st) } == SUCCESS {
                feed(&buf[..len.min(64)]);
            }
        }
        if self.found.is_empty() || REPORTS.load(Ordering::Relaxed) == 0 {
            return None;
        }
        let dx = DX.swap(0, Ordering::Relaxed);
        let dy = DY.swap(0, Ordering::Relaxed);
        let downs = DOWNS.swap(0, Ordering::Relaxed);
        let ups = UPS.swap(0, Ordering::Relaxed);
        Some((dx, dy, downs, ups, BUTTONS.load(Ordering::Relaxed) & 1 != 0))
    }
}
