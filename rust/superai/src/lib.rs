//! SuperAI, Pi Tech Lab's graphical language, in Rust.
//!
//! The same engine runs natively (the `superai` command, the tests) and in the browser as WebAssembly
//! (frontend/super/superai.wasm, loaded by frontend/super/superai-rs.js). It speaks JSON:
//!
//!   {"op":"validate", "program": P}                    is P a well-formed SuperAI program?
//!   {"op":"run", "program": F, "inputs": {..}, "answers": {..}}   run supers and wires F
//!   {"op":"call", "program": P, "function": name, "inputs": {..}}  run one of P's functions
//!   {"op":"engine", "typed": t, "ins": [..], "attached": op}       what one Super AI super gives
//!
//! and answers JSON. See lang.rs for the language itself.
#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

pub mod json;
pub mod lang;
pub mod math;

#[cfg(target_arch = "wasm32")]
mod wasm;

use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;
use json::Json;
use lang::Value;

fn obj(kv: Vec<(&str, Json)>) -> Json {
    Json::Obj(kv.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn errors(bad: Vec<String>) -> Json {
    obj(vec![("ok", Json::Bool(false)), ("errors", Json::Arr(bad.into_iter().map(Json::Str).collect()))])
}

/// Checks a whole SuperAI program: its language line, its diagram and its functions.
pub fn validate(p: &Json) -> Vec<String> {
    let mut bad = Vec::new();
    if !matches!(p, Json::Obj(_)) {
        return vec!["the program must be an object".into()];
    }
    if !p.s("language").map_or(false, |l| l.starts_with("SuperAI")) {
        bad.push("language must be \"SuperAI …\"".into());
    }
    match p.get("diagram") {
        Some(d) => if let Err(b) = lang::read(d) { bad.extend(b.into_iter().map(|e| format!("diagram: {}", e))); },
        None => bad.push("diagram must be an object".into()),
    }
    for (name, f) in p.get("functions").map(Json::obj).unwrap_or(&[]) {
        match lang::read(f) {
            Err(b) => bad.extend(b.into_iter().map(|e| format!("function {}: {}", name, e))),
            Ok(prog) => {
                let (_, cycle) = prog.order();
                if !cycle.is_empty() { bad.push(format!("function {}: a loop of wires through {}", name, cycle.join(", "))); }
                if !prog.supers.iter().any(|s| s.func == lang::Fn::Output) { bad.push(format!("function {}: needs a super of kind output", name)); }
            }
        }
    }
    bad
}

fn pairs_values(j: Option<&Json>) -> Vec<(String, Value)> {
    j.map(Json::obj).unwrap_or(&[]).iter().map(|(k, v)| (k.clone(), Value::from_json(v))).collect()
}
fn pairs_text(j: Option<&Json>) -> Vec<(String, String)> {
    j.map(Json::obj).unwrap_or(&[]).iter().filter_map(|(k, v)| v.str().map(|s| (k.clone(), s.to_string()))).collect()
}

fn run_json(f: &Json, req: &Json) -> Json {
    let prog = match lang::read(f) { Ok(p) => p, Err(b) => return errors(b) };
    let r = prog.run(&pairs_values(req.get("inputs")), &pairs_text(req.get("answers")));
    obj(vec![
        ("ok", Json::Bool(true)),
        ("values", Json::Obj(r.values.iter().map(|(k, v)| (k.clone(), v.to_json())).collect())),
        ("outputs", Json::Obj(r.outputs.iter().map(|(k, v)| (k.clone(), v.to_json())).collect())),
        ("asks", Json::Arr(r.asks.iter().map(|(id, p)| obj(vec![("id", Json::Str(id.clone())), ("prompt", Json::Str(p.clone()))])).collect())),
        ("order", Json::Arr(r.order.into_iter().map(Json::Str).collect())),
        ("cycle", Json::Arr(r.cycle.into_iter().map(Json::Str).collect())),
    ])
}

/// One request in, one answer out (both JSON text).
pub fn handle(text: &str) -> String {
    let req = match json::parse(text) { Ok(j) => j, Err(e) => return json::to_string(&errors(vec![e])) };
    let empty = Json::Null;
    let program = req.get("program").unwrap_or(&empty);
    let out = match req.s("op").unwrap_or("") {
        "validate" => { let bad = validate(program); if bad.is_empty() { obj(vec![("ok", Json::Bool(true)), ("errors", Json::Arr(vec![]))]) } else { errors(bad) } }
        "run" => run_json(program, &req),
        "call" => {
            let name = req.s("function").unwrap_or("");
            match program.get("functions").and_then(|f| f.get(name)) {
                Some(f) => run_json(f, &req),
                None => errors(vec![format!("no function called {}", name)]),
            }
        }
        "engine" => {
            let ins: Vec<Value> = req.get("ins").map(Json::arr).unwrap_or(&[]).iter().map(Value::from_json).collect();
            let attached = req.s("attached").and_then(lang::op_of);
            let v = lang::engine(req.s("typed").unwrap_or(""), &ins, attached, req.s("hint").unwrap_or(""));
            obj(vec![("ok", Json::Bool(true)), ("value", v.to_json())])
        }
        "version" => obj(vec![("ok", Json::Bool(true)), ("language", Json::Str("SuperAI 1".into())), ("engine", Json::Str(env!("CARGO_PKG_VERSION").into()))]),
        other => errors(vec![format!("unknown op {:?}", other)]),
    };
    json::to_string(&out)
}

#[cfg(test)]
mod tests;
