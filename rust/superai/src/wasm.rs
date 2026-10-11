//! The WebAssembly face: a bump allocator over linear memory, reset before each request, and three
//! exports. The page calls sa_reset, sa_alloc(n) for the request's bytes, writes them, calls
//! sa_handle(ptr, n) and reads the answer at sa_out_ptr() / sa_out_len().

use core::alloc::{GlobalAlloc, Layout};
use core::arch::wasm32;

extern "C" {
    static __heap_base: u8;
}

struct Bump;
static mut NEXT: usize = 0;
static mut OUT: (usize, usize) = (0, 0);

fn base() -> usize {
    core::ptr::addr_of!(__heap_base) as usize
}

unsafe impl GlobalAlloc for Bump {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        if NEXT == 0 { NEXT = base(); }
        let start = (NEXT + l.align() - 1) & !(l.align() - 1);
        let end = start + l.size();
        let have = wasm32::memory_size(0) * 65536;
        if end > have {
            let pages = (end - have + 65535) / 65536;
            if wasm32::memory_grow(0, pages) == usize::MAX { return core::ptr::null_mut(); }
        }
        NEXT = end;
        start as *mut u8
    }
    unsafe fn dealloc(&self, _p: *mut u8, _l: Layout) {}
}

#[global_allocator]
static A: Bump = Bump;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    wasm32::unreachable()
}

#[no_mangle]
pub extern "C" fn sa_reset() {
    unsafe { NEXT = base(); }
}

#[no_mangle]
pub extern "C" fn sa_alloc(n: usize) -> *mut u8 {
    unsafe { A.alloc(Layout::from_size_align_unchecked(n.max(1), 8)) }
}

#[no_mangle]
pub extern "C" fn sa_handle(p: *const u8, n: usize) -> usize {
    let bytes = unsafe { core::slice::from_raw_parts(p, n) };
    let text = core::str::from_utf8(bytes).unwrap_or("");
    let out = crate::handle(text);
    let out = alloc::boxed::Box::leak(out.into_boxed_str());
    unsafe { OUT = (out.as_ptr() as usize, out.len()); }
    out.len()
}

#[no_mangle]
pub extern "C" fn sa_out_ptr() -> usize { unsafe { OUT.0 } }
#[no_mangle]
pub extern "C" fn sa_out_len() -> usize { unsafe { OUT.1 } }
