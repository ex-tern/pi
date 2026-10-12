//! The SuperAI machine: a small stack machine in the spirit of HAL-OS's assembly, which makes the language Turing
//! complete (owner, 2026-10-12: "write the SuperAI language with graphical signs, Turing complete, and HAL-OS assembly").
//!
//! A code function is `{ "params": [names], "code": [[op, arg?], ...] }` (written in assembly as `fn name params ... end`,
//! see asm.rs; labels are resolved to instruction numbers when it is assembled). Instructions:
//!
//!   push v        put a literal on the stack                 in name     put an input (or parameter) on the stack
//!   load r        put register r on the stack                store r     pop into register r
//!   loadi         pop an address, push memory[address]        storei      pop an address, pop a value, memory[address] = value
//!   dup drop swap over                                       stack shuffles
//!   add sub mul div mod pow min max cat   pop two, push the result (cat joins words; add on words joins with a space)
//!   lt gt eq le ge and or                 pop two, push true or false
//!   not round floor neg                   pop one, push the result
//!   jmp L         jump to L                                  jz L / jnz L   pop, jump when false / true
//!   call f        call function f of the same program, its parameters popped (last one on top), its result pushed
//!   ret           return the top of the stack (or nothing)  out         pop and give it as the output, keep going
//!   input sync condition (◁ △ ▽)   push what is wired into that connector      output (▷)  as out
//!   ask e (✦)   pop a question, push what LLM engine e answers (sim, rib, pid, pien, llama, mistral, …)
//!   halt          stop; the output is the last `out`, else the top of the stack
//!
//! Registers and memory are unbounded (a map from names and from numbers), jumps are conditional: with them it can
//! compute anything a Turing machine can, within a step budget (a million instructions) so a page never hangs.
use crate::json::Json;
use crate::lang::{apply, op_of, Value};
use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;

const BUDGET: usize = 1_000_000;
/// The engine `ask` uses when it names none: the lab's own assistant.
pub const DEFAULT_ENGINE: &str = "sim";
/// An error that starts with this is a question for an engine, not a failure.
pub const ASK: &str = "\u{0}ask:";
pub fn answer_key(engine: &str, q: &str) -> String { format!("{}:{}", engine, q) }

fn lit(j: &Json) -> Value {
    match j {
        Json::Null => Value::Held,
        Json::Bool(b) => Value::Bool(*b),
        Json::Num(n) => Value::Num(*n),
        Json::Str(s) => Value::Text(s.clone()),
        Json::Arr(a) => Value::List(a.iter().map(lit).collect()),
        Json::Obj(_) => Value::Held,
    }
}
fn bin(name: &str) -> Option<&'static str> {
    Some(match name {
        "add" => "+", "sub" => "-", "mul" => "×", "div" => "/", "mod" => "%", "pow" => "^", "min" => "min", "max" => "max",
        "cat" => "&", "lt" => "<", "gt" => ">", "eq" => "=", "le" => "≤", "ge" => "≥", "and" => "and", "or" => "or",
        _ => return None,
    })
}

/// Runs code function `f` with `inputs`; `funcs` are the program's functions (for `call`).
pub fn run(f: &Json, inputs: &BTreeMap<String, Value>, funcs: &Json, answers: &BTreeMap<String, String>) -> Result<Value, String> {
    let mut steps = 0usize;
    exec(f, inputs, funcs, answers, &mut steps, 0)
}

fn exec(f: &Json, inputs: &BTreeMap<String, Value>, funcs: &Json, answers: &BTreeMap<String, String>, steps: &mut usize, depth: usize) -> Result<Value, String> {
    if depth > 200 { return Err("calls nested too deep".into()); }
    let code = f.get("code").map(Json::arr).unwrap_or(&[]);
    let mut st: Vec<Value> = Vec::new();
    let mut reg: BTreeMap<String, Value> = BTreeMap::new();
    let mut mem: BTreeMap<i64, Value> = BTreeMap::new();
    let mut out: Option<Value> = None;
    let mut pc = 0usize;
    let pop = |st: &mut Vec<Value>| st.pop().unwrap_or(Value::Held);
    while pc < code.len() {
        *steps += 1;
        if *steps > BUDGET { return Err("ran too long (a million steps)".into()); }
        let ins = code[pc].arr();
        let op = ins.first().and_then(Json::str).unwrap_or("");
        let arg = ins.get(1);
        let target = || arg.and_then(Json::num).map(|n| n as usize).ok_or_else(|| format!("{} needs a label", op));
        pc += 1;
        match op {
            "push" => st.push(arg.map(lit).unwrap_or(Value::Held)),
            // the four connectors: what is wired into a code super's input, sync and condition, and its output
            "input" | "sync" | "condition" | "◁" | "△" | "▽" => {
                let k = match op { "◁" => "input", "△" => "sync", "▽" => "condition", k => k };
                st.push(inputs.get(k).cloned().unwrap_or(Value::Held));
            }
            // prompting an LLM is an instruction: `ask engine` pops the question and pushes the engine's answer.
            // The machine cannot wait, so a question not yet answered stops the run with it (ASK); the page asks the
            // engine (/api/super/one) and runs again with the answer, keyed "engine:question" (answer_key)
            "ask" | "✦" => {
                let engine = arg.and_then(Json::str).unwrap_or(DEFAULT_ENGINE);
                let q = pop(&mut st).text();
                match answers.get(&answer_key(engine, &q)) {
                    Some(a) => st.push(Value::Text(a.clone())),
                    None => return Err(format!("{}{}\u{1f}{}", ASK, engine, q)),
                }
            }
            "output" | "▷" => { out = Some(pop(&mut st)); }
            "in" => { let k = arg.and_then(Json::str).unwrap_or(""); st.push(inputs.get(k).cloned().unwrap_or(Value::Held)); }
            "load" => { let k = arg.and_then(Json::str).unwrap_or(""); st.push(reg.get(k).cloned().unwrap_or(Value::Held)); }
            "store" => { let k = arg.and_then(Json::str).unwrap_or("").to_string(); let v = pop(&mut st); reg.insert(k, v); }
            "loadi" => { let a = pop(&mut st).num().unwrap_or(0.0) as i64; st.push(mem.get(&a).cloned().unwrap_or(Value::Held)); }
            "storei" => { let a = pop(&mut st).num().unwrap_or(0.0) as i64; let v = pop(&mut st); mem.insert(a, v); }
            "dup" => { let v = st.last().cloned().unwrap_or(Value::Held); st.push(v); }
            "drop" => { pop(&mut st); }
            "swap" => { let b = pop(&mut st); let a = pop(&mut st); st.push(b); st.push(a); }
            "over" => { let v = if st.len() >= 2 { st[st.len() - 2].clone() } else { Value::Held }; st.push(v); }
            "not" | "round" | "floor" => { let a = pop(&mut st); st.push(apply(op_of(op).unwrap(), &[a])); }
            "neg" => { let a = pop(&mut st); st.push(Value::Num(-a.num().unwrap_or(0.0))); }
            "jmp" => pc = target()?,
            "jz" => { let t = target()?; if !pop(&mut st).truthy() { pc = t; } }
            "jnz" => { let t = target()?; if pop(&mut st).truthy() { pc = t; } }
            "call" => {
                let name = arg.and_then(Json::str).unwrap_or("");
                let g = funcs.get(name).ok_or_else(|| format!("no function called {}", name))?;
                let ps: Vec<String> = g.get("params").map(Json::arr).unwrap_or(&[]).iter().filter_map(|p| p.str().map(|s| s.to_string())).collect();
                let mut args = BTreeMap::new();
                for p in ps.iter().rev() { let v = pop(&mut st); args.insert(p.clone(), v); }
                let r = if g.get("code").is_some() { exec(g, &args, funcs, answers, steps, depth + 1)? } else { Value::Held };
                st.push(r);
            }
            "ret" => return Ok(st.pop().or(out).unwrap_or(Value::Held)),
            "out" => { out = Some(pop(&mut st)); }
            "halt" => break,
            "nop" | "" => {}
            name => match bin(name) {
                Some(sym) => { let b = pop(&mut st); let a = pop(&mut st); st.push(apply(op_of(sym).unwrap(), &[a, b])); }
                None => return Err(format!("unknown instruction {}", name)),
            },
        }
    }
    Ok(out.or_else(|| st.pop()).unwrap_or(Value::Held))
}

#[allow(dead_code)]
fn _unused() -> Vec<Value> { vec![] }
