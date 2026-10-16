//! piii OS: the π canvas as an operating system (owner, 2026-10-17: "make the piii.app as os from scratch", for an
//! early-2008 MacBook Pro). It boots straight from the computer's UEFI firmware, with nothing underneath: Rust, no
//! standard library, no dependencies but the lab's own `numbers` crate.
//!
//!   app.rs    the π canvas: supers, wires, and what each super holds (knows nothing of the firmware)
//!   lang.rs   piii.app's Program language (dataflow, Turing complete) with its five examples
//!   gfx.rs    drawing: superellipses (n = π), wires, text (font.rs: Spleen, made by tools/font.py)
//!   uefi.rs   the firmware's tables and protocols, by hand; boot.rs: efi_main, screen, keyboard, pointers
//!   usb.rs    piii OS's own USB mouse driver (a mouse's receiver, the Mac's trackpad), through the firmware's USB layer
//!
//! Built for the machine (x86_64-unknown-uefi), it is BOOTX64.EFI. Built for this computer, it is a tool that runs
//! the same app with scripted clicks and writes what it draws as pictures (shots.rs): `cargo run -- shots DIR`.
#![cfg_attr(target_os = "uefi", no_std)]
#![cfg_attr(target_os = "uefi", no_main)]

extern crate alloc;

mod app;
mod font;
mod gfx;
mod lang;
mod num;

#[cfg(target_os = "uefi")]
mod boot;
#[cfg(target_os = "uefi")]
mod uefi;
#[cfg(target_os = "uefi")]
mod usb;

#[cfg(not(target_os = "uefi"))]
mod shots;

#[cfg(not(target_os = "uefi"))]
fn main() {
    shots::main();
}
