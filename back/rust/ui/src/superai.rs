//! SuperAI, the lab's language (back/rust/superai), compiled into this crate from that crate's own source files, so
//! the Learn page runs the learner's programs here with the same engine. Only what the page uses: the assembler, the
//! machine that runs `fn` code and the dataflow runner for `graph`s.
#![allow(dead_code)]

#[path = "../../superai/src/json.rs"]
pub mod json;
#[path = "../../superai/src/math.rs"]
pub mod math;
#[path = "../../superai/src/lang.rs"]
pub mod lang;
#[path = "../../superai/src/vm.rs"]
pub mod vm;
#[path = "../../superai/src/asm.rs"]
pub mod asm;
