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

/// A report from a mouse: called by the firmware (on its timer), so it only adds to what the loop takes.
extern "efiapi" fn report(data: *mut u8, len: usize, _ctx: *mut c_void, status: u32) -> Status {
    if status == 0 && !data.is_null() && len >= 3 {
        let b = unsafe { core::slice::from_raw_parts(data, len) };
        BUTTONS.store(b[0] as u32, Ordering::Relaxed);
        DX.fetch_add(b[1] as i8 as i32, Ordering::Relaxed);
        DY.fetch_add(b[2] as i8 as i32, Ordering::Relaxed);
        REPORTS.fetch_add(1, Ordering::Relaxed);
    }
    SUCCESS
}

pub struct Mice {
    pub found: Vec<String>,
}

/// The mice piii OS reads itself: every USB boot mouse that the firmware does not already read.
pub fn start() -> Mice {
    let mut found = Vec::new();
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
            ((*io).control)(io, &mut set_protocol, 2, 1000, core::ptr::null_mut(), 0, &mut st);
            ((*io).control)(io, &mut set_idle, 2, 1000, core::ptr::null_mut(), 0, &mut st);
        }
        let r = unsafe { ((*io).async_interrupt)(io, addr, 1, interval, max.clamp(3, 64), Some(report), core::ptr::null_mut()) };
        let who = match vendor {
            0x046d => "Logitech",
            0x05ac => "Apple",
            0x045e => "Microsoft",
            _ => "USB",
        };
        let line = format!("{} mouse {:04x}:{:04x}{}", who, vendor, product, if r == SUCCESS { "" } else { " (could not be read)" });
        uefi::log(&format!("piii OS: {}", line));
        if r == SUCCESS {
            found.push(line);
        }
    }
    Mice { found }
}

impl Mice {
    /// what the mice did since last asked: how far, and the buttons held
    pub fn take(&self) -> Option<(i32, i32, bool)> {
        if self.found.is_empty() || REPORTS.load(Ordering::Relaxed) == 0 {
            return None;
        }
        let dx = DX.swap(0, Ordering::Relaxed);
        let dy = DY.swap(0, Ordering::Relaxed);
        Some((dx, dy, BUTTONS.load(Ordering::Relaxed) & 1 != 0))
    }
}
