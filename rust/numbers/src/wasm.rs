//! The WebAssembly face of the constants: an allocator that reuses memory (size classes of powers of two, each
//! with a free list, so the many same-sized numbers of a long series recycle the same blocks), and five exports.
//! The page calls nb_alloc(n) for the request's bytes ("pi 1000"), writes them, calls nb_handle(ptr, n), reads the
//! answer at nb_out_ptr() / nb_out_len(), then nb_free_out() and nb_free(ptr, n).
use core::alloc::{GlobalAlloc, Layout};
use core::arch::wasm32;

extern "C" { static __heap_base: u8; }

const CLASSES: usize = 40;
static mut FREE: [usize; CLASSES] = [0; CLASSES];   // the head of each class's free list (0: empty)
static mut NEXT: usize = 0;
static mut OUT: (usize, usize) = (0, 0);

fn class(size: usize) -> usize { let s = size.max(16); (usize::BITS - (s - 1).leading_zeros()) as usize }   // 2^class ≥ size

struct Classes;
unsafe impl GlobalAlloc for Classes {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let c = class(l.size().max(l.align()));
        if c >= CLASSES { return core::ptr::null_mut(); }
        let head = FREE[c];
        if head != 0 { FREE[c] = *(head as *const usize); return head as *mut u8; }
        if NEXT == 0 { NEXT = core::ptr::addr_of!(__heap_base) as usize; }
        let size = 1usize << c;
        let start = (NEXT + size.min(4096) - 1) & !(size.min(4096) - 1);   // aligned to its size (up to a page)
        let end = start + size;
        let have = wasm32::memory_size(0) * 65536;
        if end > have {
            let pages = (end - have + 65535) / 65536;
            if wasm32::memory_grow(0, pages) == usize::MAX { return core::ptr::null_mut(); }
        }
        NEXT = end;
        start as *mut u8
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        let c = class(l.size().max(l.align()));
        *(p as *mut usize) = FREE[c]; FREE[c] = p as usize;
    }
}

#[global_allocator]
static A: Classes = Classes;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { wasm32::unreachable() }

#[no_mangle]
pub extern "C" fn nb_alloc(n: usize) -> *mut u8 { unsafe { A.alloc(Layout::from_size_align_unchecked(n.max(1), 8)) } }
#[no_mangle]
pub extern "C" fn nb_free(p: *mut u8, n: usize) { unsafe { A.dealloc(p, Layout::from_size_align_unchecked(n.max(1), 8)) } }

#[no_mangle]
pub extern "C" fn nb_handle(p: *const u8, n: usize) -> usize {
    let bytes = unsafe { core::slice::from_raw_parts(p, n) };
    let text = core::str::from_utf8(bytes).unwrap_or("");
    let out = alloc::boxed::Box::leak(crate::handle(text).into_boxed_str());
    unsafe { OUT = (out.as_ptr() as usize, out.len()); }
    out.len()
}
#[no_mangle]
pub extern "C" fn nb_out_ptr() -> usize { unsafe { OUT.0 } }
#[no_mangle]
pub extern "C" fn nb_out_len() -> usize { unsafe { OUT.1 } }
/// the last answer's memory goes back to the allocator
#[no_mangle]
pub extern "C" fn nb_free_out() {
    unsafe { if OUT.0 != 0 { A.dealloc(OUT.0 as *mut u8, Layout::from_size_align_unchecked(OUT.1.max(1), 1)); OUT = (0, 0); } }
}
