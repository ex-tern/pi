//! The allocator, and a cell for the program's single-threaded globals.
//!
//! WebAssembly here runs on one thread and is never re-entered while it runs (the host only calls back on events,
//! timers and network replies), so a global needs no lock, only a way to say so to the compiler.

use core::alloc::{GlobalAlloc, Layout};
use core::cell::UnsafeCell;

pub struct Global<T>(UnsafeCell<T>);

unsafe impl<T> Sync for Global<T> {}

impl<T> Global<T> {
    pub const fn new(v: T) -> Self {
        Global(UnsafeCell::new(v))
    }
    /// The value. Callers never hold two of these across a call that could reach the same global again.
    #[allow(clippy::mut_from_ref)]
    pub fn get(&self) -> &mut T {
        unsafe { &mut *self.0.get() }
    }
}

/// Size classes of powers of two, each with its own free list; new blocks come from the end of the heap.
/// A front end allocates many small strings and frees them as views are redrawn, which this serves well.
struct Classes;

const CLASSES: usize = 32;
static FREE: Global<[usize; CLASSES]> = Global::new([0; CLASSES]);
static NEXT: Global<usize> = Global::new(0);

#[cfg(target_arch = "wasm32")]
#[global_allocator]
static ALLOC: Classes = Classes;

fn class_of(size: usize, align: usize) -> usize {
    let need = size.max(align).max(16);
    (usize::BITS - (need - 1).leading_zeros()) as usize
}

#[cfg(target_arch = "wasm32")]
unsafe fn bump(bytes: usize) -> *mut u8 {
    unsafe extern "C" {
        static __heap_base: u8;
    }
    let next = NEXT.get();
    if *next == 0 {
        *next = &raw const __heap_base as usize;
    }
    let align = bytes.min(4096);
    let p = (*next + align - 1) & !(align - 1);
    let end = p + bytes;
    let have = core::arch::wasm32::memory_size(0) * 65536;
    if end > have {
        let pages = (end - have).div_ceil(65536);
        if core::arch::wasm32::memory_grow(0, pages) == usize::MAX {
            return core::ptr::null_mut();
        }
    }
    *next = end;
    p as *mut u8
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn bump(_bytes: usize) -> *mut u8 {
    core::ptr::null_mut()
}

unsafe impl GlobalAlloc for Classes {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let c = class_of(layout.size(), layout.align());
        if c >= CLASSES || layout.align() > 4096 {
            return core::ptr::null_mut();
        }
        let free = FREE.get();
        let head = free[c];
        if head != 0 {
            free[c] = unsafe { *(head as *const usize) };
            return head as *mut u8;
        }
        unsafe { bump(1usize << c) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        let c = class_of(layout.size(), layout.align());
        let free = FREE.get();
        unsafe { *(ptr as *mut usize) = free[c] };
        free[c] = ptr as usize;
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if class_of(new_size, layout.align()) == class_of(layout.size(), layout.align()) {
            return ptr;
        }
        let new = unsafe { self.alloc(Layout::from_size_align_unchecked(new_size, layout.align())) };
        if !new.is_null() {
            unsafe { core::ptr::copy_nonoverlapping(ptr, new, layout.size().min(new_size)) };
            unsafe { self.dealloc(ptr, layout) };
        }
        new
    }
}
