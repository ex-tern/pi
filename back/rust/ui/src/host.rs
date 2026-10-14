//! What the page lends this program: the imports from front/app/host.js, wrapped so the rest of the crate deals in
//! `&str` and `String`. Nodes, forms and files are numbered handles kept on the host's side.

use crate::mem::Global;
use alloc::string::String;
use alloc::vec::Vec;

#[cfg(target_arch = "wasm32")]
mod ffi {
#[link(wasm_import_module = "host")]
unsafe extern "C" {
    pub fn create(p: *const u8, l: usize) -> u32;
    pub fn text(p: *const u8, l: usize) -> u32;
    pub fn set_text(id: u32, p: *const u8, l: usize);
    pub fn attr(id: u32, kp: *const u8, kl: usize, vp: *const u8, vl: usize);
    pub fn unattr(id: u32, kp: *const u8, kl: usize);
    pub fn prop(id: u32, kp: *const u8, kl: usize, vp: *const u8, vl: usize);
    pub fn append(parent: u32, child: u32);
    pub fn insert(parent: u32, child: u32, before: u32);
    pub fn remove(id: u32);
    pub fn release(id: u32);
    pub fn listen(id: u32, kp: *const u8, kl: usize);
    pub fn body() -> u32;
    pub fn head() -> u32;
    pub fn fetch(req: u32, mp: *const u8, ml: usize, up: *const u8, ul: usize, bp: *const u8, bl: usize, form: u32);
    pub fn form() -> u32;
    pub fn form_str(f: u32, kp: *const u8, kl: usize, vp: *const u8, vl: usize);
    pub fn form_file(f: u32, kp: *const u8, kl: usize, file: u32);
    pub fn store_get(kp: *const u8, kl: usize) -> i32;
    pub fn store_set(kp: *const u8, kl: usize, vp: *const u8, vl: usize);
    pub fn store_del(kp: *const u8, kl: usize);
    pub fn cookie() -> i32;
    pub fn set_cookie(p: *const u8, l: usize);
    pub fn href() -> i32;
    pub fn replace_url(p: *const u8, l: usize);
    pub fn go(p: *const u8, l: usize);
    pub fn open(p: *const u8, l: usize);
    pub fn set_timer(ms: u32, token: u32);
    pub fn now() -> f64;
    pub fn log_(p: *const u8, l: usize);
    pub fn title(p: *const u8, l: usize);
    pub fn scroll_top();
    pub fn focus(id: u32);
    pub fn print();
    pub fn vw() -> f64;
    pub fn vh() -> f64;
    pub fn capture(on: u32);
    pub fn call(op: *const u8, ol: usize, a: *const u8, al: usize) -> i32;
    pub fn download(np: *const u8, nl: usize, tp: *const u8, tl: usize, dp: *const u8, dl: usize);
}
}

static RET: Global<Vec<u8>> = Global::new(Vec::new());

pub fn ret_buffer(len: usize) -> *mut u8 {
    let r = RET.get();
    r.clear();
    r.resize(len, 0);
    r.as_mut_ptr()
}

fn answer(len: i32) -> Option<String> {
    if len < 0 {
        return None;
    }
    let r = RET.get();
    Some(String::from_utf8_lossy(&r[..len as usize]).into_owned())
}

#[cfg(target_arch = "wasm32")]
mod imp {
    use super::{answer, String};
    use super::ffi::*;
    pub fn create_el(tag: &str) -> u32 {
        unsafe { create(tag.as_ptr(), tag.len()) }
    }
    pub fn create_text(s: &str) -> u32 {
        unsafe { text(s.as_ptr(), s.len()) }
    }
    pub fn set_text_(id: u32, s: &str) {
        unsafe { set_text(id, s.as_ptr(), s.len()) }
    }
    pub fn set_attr(id: u32, k: &str, v: &str) {
        unsafe { attr(id, k.as_ptr(), k.len(), v.as_ptr(), v.len()) }
    }
    pub fn remove_attr(id: u32, k: &str) {
        unsafe { unattr(id, k.as_ptr(), k.len()) }
    }
    pub fn set_prop(id: u32, k: &str, v: &str) {
        unsafe { prop(id, k.as_ptr(), k.len(), v.as_ptr(), v.len()) }
    }
    pub fn append_(p: u32, c: u32) {
        unsafe { append(p, c) }
    }
    pub fn insert_(p: u32, c: u32, b: u32) {
        unsafe { insert(p, c, b) }
    }
    pub fn remove_(id: u32) {
        unsafe { remove(id) }
    }
    pub fn release_(id: u32) {
        unsafe { release(id) }
    }
    pub fn listen_(id: u32, k: &str) {
        unsafe { listen(id, k.as_ptr(), k.len()) }
    }
    pub fn body_() -> u32 {
        unsafe { body() }
    }
    pub fn head_() -> u32 {
        unsafe { head() }
    }
    pub fn fetch_(req: u32, m: &str, u: &str, b: &str, f: u32) {
        unsafe { fetch(req, m.as_ptr(), m.len(), u.as_ptr(), u.len(), b.as_ptr(), b.len(), f) }
    }
    pub fn form_() -> u32 {
        unsafe { form() }
    }
    pub fn form_str_(f: u32, k: &str, v: &str) {
        unsafe { form_str(f, k.as_ptr(), k.len(), v.as_ptr(), v.len()) }
    }
    pub fn form_file_(f: u32, k: &str, file: u32) {
        unsafe { form_file(f, k.as_ptr(), k.len(), file) }
    }
    pub fn store_get_(k: &str) -> Option<String> {
        answer(unsafe { store_get(k.as_ptr(), k.len()) })
    }
    pub fn store_set_(k: &str, v: &str) {
        unsafe { store_set(k.as_ptr(), k.len(), v.as_ptr(), v.len()) }
    }
    pub fn store_del_(k: &str) {
        unsafe { store_del(k.as_ptr(), k.len()) }
    }
    pub fn cookie_() -> String {
        answer(unsafe { cookie() }).unwrap_or_default()
    }
    pub fn set_cookie_(s: &str) {
        unsafe { set_cookie(s.as_ptr(), s.len()) }
    }
    pub fn href_() -> String {
        answer(unsafe { href() }).unwrap_or_default()
    }
    pub fn replace_url_(s: &str) {
        unsafe { replace_url(s.as_ptr(), s.len()) }
    }
    pub fn go_(s: &str) {
        unsafe { go(s.as_ptr(), s.len()) }
    }
    pub fn open_(s: &str) {
        unsafe { open(s.as_ptr(), s.len()) }
    }
    pub fn timer_(ms: u32, token: u32) {
        unsafe { set_timer(ms, token) }
    }
    pub fn now_() -> f64 {
        unsafe { now() }
    }
    pub fn log__(s: &str) {
        unsafe { log_(s.as_ptr(), s.len()) }
    }
    pub fn title_(s: &str) {
        unsafe { title(s.as_ptr(), s.len()) }
    }
    pub fn scroll_top_() {
        unsafe { scroll_top() }
    }
    pub fn focus_(id: u32) {
        unsafe { focus(id) }
    }
    pub fn print_() {
        unsafe { print() }
    }
    pub fn vw_() -> f64 {
        unsafe { vw() }
    }
    pub fn vh_() -> f64 {
        unsafe { vh() }
    }
    pub fn capture_(on: bool) {
        unsafe { capture(on as u32) }
    }
    pub fn call_(op: &str, a: &str) -> Option<String> {
        answer(unsafe { call(op.as_ptr(), op.len(), a.as_ptr(), a.len()) })
    }
    pub fn download_(name: &str, mime: &str, data: &[u8]) {
        unsafe { download(name.as_ptr(), name.len(), mime.as_ptr(), mime.len(), data.as_ptr(), data.len()) }
    }
}

// Outside the browser (cargo check, unit tests) the host does nothing.
#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use super::{answer, String};
    pub fn create_el(_: &str) -> u32 { 1 }
    pub fn create_text(_: &str) -> u32 { 1 }
    pub fn set_text_(_: u32, _: &str) {}
    pub fn set_attr(_: u32, _: &str, _: &str) {}
    pub fn remove_attr(_: u32, _: &str) {}
    pub fn set_prop(_: u32, _: &str, _: &str) {}
    pub fn append_(_: u32, _: u32) {}
    pub fn insert_(_: u32, _: u32, _: u32) {}
    pub fn remove_(_: u32) {}
    pub fn release_(_: u32) {}
    pub fn listen_(_: u32, _: &str) {}
    pub fn body_() -> u32 { 1 }
    pub fn head_() -> u32 { 1 }
    pub fn fetch_(_: u32, _: &str, _: &str, _: &str, _: u32) {}
    pub fn form_() -> u32 { 1 }
    pub fn form_str_(_: u32, _: &str, _: &str) {}
    pub fn form_file_(_: u32, _: &str, _: u32) {}
    pub fn store_get_(_: &str) -> Option<String> { let _ = answer(-1); None }
    pub fn store_set_(_: &str, _: &str) {}
    pub fn store_del_(_: &str) {}
    pub fn cookie_() -> String { String::new() }
    pub fn set_cookie_(_: &str) {}
    pub fn href_() -> String { String::new() }
    pub fn replace_url_(_: &str) {}
    pub fn go_(_: &str) {}
    pub fn open_(_: &str) {}
    pub fn timer_(_: u32, _: u32) {}
    pub fn now_() -> f64 { 0.0 }
    pub fn log__(_: &str) {}
    pub fn title_(_: &str) {}
    pub fn scroll_top_() {}
    pub fn focus_(_: u32) {}
    pub fn print_() {}
    pub fn vw_() -> f64 { 1280.0 }
    pub fn vh_() -> f64 { 800.0 }
    pub fn capture_(_: bool) {}
    pub fn call_(_: &str, _: &str) -> Option<String> { None }
    pub fn download_(_: &str, _: &str, _: &[u8]) {}
}

pub use imp::{
    append_ as append_child, body_ as body, cookie_ as cookie, create_el, create_text, focus_ as focus,
    form_ as form_new, form_file_ as form_file, form_str_ as form_str, go_ as go, head_ as head, href_ as href,
    insert_ as insert_before, listen_ as listen, now_ as now, open_ as open, release_ as release,
    remove_ as remove, remove_attr, replace_url_ as replace_url, scroll_top_ as scroll_top, set_attr,
    set_cookie_ as set_cookie, set_prop, print_ as print, vw_ as vw, vh_ as vh, capture_ as capture, set_text_ as set_text, store_del_ as store_del,
    store_get_ as store_get, store_set_ as store_set, timer_ as timer, title_ as set_title,
};

pub fn fetch(req: u32, method: &str, url: &str, body: &str, form: u32) {
    imp::fetch_(req, method, url, body, form)
}

pub fn log(s: &str) {
    imp::log__(s)
}

/// One of the host's helpers that has no import of its own (sound, drawing, pictures): `op` names it, `arg` is its
/// text; some answer.
pub fn call(op: &str, arg: &str) -> Option<String> {
    imp::call_(op, arg)
}

/// Hands the browser bytes to save as a file.
pub fn download(name: &str, mime: &str, data: &[u8]) {
    imp::download_(name, mime, data)
}
