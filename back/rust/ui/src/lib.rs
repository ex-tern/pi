//! ScholarPi's front end, in Rust.
//!
//! Every view, every word on the page and the style sheet live here. The browser still needs a document to start
//! from and a few lines of JavaScript to hand WebAssembly the DOM (front/app/host.js); everything above that is
//! this crate. It has no dependencies and no standard library, so it builds with rustc alone:
//!
//!     python back/scripts/tools.py build-ui        # writes front/app/ui.wasm
//!
//! Layout: `mem` (allocator and single-threaded globals), `host` (the imports from host.js), `json`, `sha256`
//! (the proof of work), `dom` (a small virtual DOM that patches the page), `app` (state, messages, views),
//! `style` (the style sheet).
#![no_std]

extern crate alloc;

mod app;
mod dom;
mod host;
mod json;
mod mem;
mod pi;
mod sha256;
mod style;
mod superai;
mod text;

use alloc::string::String;
use alloc::vec::Vec;

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(info: &core::panic::PanicInfo) -> ! {
    let msg = alloc::format!("ui panic: {}", info);
    host::log(&msg);
    core::arch::wasm32::unreachable()
}

/// Memory for a string the host is about to write in.
#[unsafe(export_name = "alloc")]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

/// Takes back a string the host wrote with `alloc`.
fn take(ptr: *mut u8, len: usize) -> String {
    let v = unsafe { Vec::from_raw_parts(ptr, len, len.max(1)) };
    String::from_utf8(v).unwrap_or_default()
}

/// The return buffer: a host function that answers with a string writes it here and returns its length.
#[unsafe(no_mangle)]
pub extern "C" fn ret(len: usize) -> *mut u8 {
    host::ret_buffer(len)
}

/// A press on an open page's bare background or head: the window is selected.
#[unsafe(no_mangle)]
pub extern "C" fn page_pressed() {
    app::on_page_press();
}

/// An open page dragged by its bare background: by (dx, dy) px.
#[unsafe(no_mangle)]
pub extern "C" fn panned(dx: f64, dy: f64) {
    app::on_page_pan(dx, dy);
}

/// Zoom asked for anywhere (a pinch, Ctrl/⌘ and the wheel, Ctrl/⌘ +, − or 0): deltaY (0 resets), and the point.
#[unsafe(no_mangle)]
pub extern "C" fn zoomed(dy: f64, x: f64, y: f64) {
    app::on_zoom(dy, x, y);
}

#[unsafe(no_mangle)]
pub extern "C" fn start() {
    app::start();
}

/// A DOM event on a node this crate made: its handle, the event kind and the node's value.
#[unsafe(no_mangle)]
pub extern "C" fn event(id: u32, kp: *mut u8, kl: usize, vp: *mut u8, vl: usize) {
    let kind = take(kp, kl);
    let value = take(vp, vl);
    app::on_event(id, &kind, value);
}

/// A piece of a response body (`done` = 1 on the last call; status 0 means the request failed).
#[unsafe(no_mangle)]
pub extern "C" fn fetched(req: u32, status: u32, p: *mut u8, l: usize, done: u32) {
    let chunk = take(p, l);
    app::on_fetch(req, status, chunk, done != 0);
}

#[unsafe(no_mangle)]
pub extern "C" fn timer(token: u32) {
    app::on_timer(token);
}

/// The window changed size.
#[unsafe(no_mangle)]
pub extern "C" fn resized() {
    app::on_resize();
}

/// The pointer moved (phase 0), was let go (1) or was taken away (2) while a super is being dragged.
#[unsafe(no_mangle)]
pub extern "C" fn pointer(phase: u32, x: f64, y: f64) {
    app::on_pointer(phase, x, y);
}

/// A key that edits the canvas (Delete, Backspace, Escape), pressed outside any field.
#[unsafe(no_mangle)]
pub extern "C" fn keyed(kp: *mut u8, kl: usize) -> u32 {
    let key = take(kp, kl);
    app::on_key(&key) as u32
}

/// Bytes the host was asked for (a picture's pixels, w × h; a file's contents): w = 0 means it could not be read.
#[unsafe(no_mangle)]
pub extern "C" fn pixels(token: u32, p: *mut u8, len: usize, w: u32, h: u32) {
    let data = if len > 0 { unsafe { Vec::from_raw_parts(p, len, len) } } else { Vec::new() };
    app::on_pixels(token, data, w, h);
}

/// The address changed (a link to #/… was followed, or back or forward).
#[unsafe(no_mangle)]
pub extern "C" fn nav() {
    app::on_nav();
}
