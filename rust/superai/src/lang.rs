//! The SuperAI language: supers joined by wires, run as dataflow.
//!
//! A program (or one of its functions) is `{ supers: [...], wires: [[from, to], ...] }`.
//!
//! A super is `{ id, kind?, fn?, n?, text?, hint?, name? }`:
//!   kind "input"   a value handed in by name (`name`, else its id)
//!   kind "output"  a value handed back by name: what is wired into it
//!   kind "engine"  a Super AI super: computes what is computable, asks the engines the rest
//!   otherwise its function comes from `fn`, or from its shape n as on the page:
//!     n < 1 "add" (+), 1–1.7 "super" (◆), 1.7–2.6 "dot" (●), 2.6–5 "box" (■), n ≥ 5 "ask" (?)
//!
//! A wire joins "super.port" to "super.port"; the ports are input, output, sync and condition. Data
//! flows from an output into an input (in the order the wires are written); a condition that is
//! false holds a super (it gives nothing); sync only paces the page and is ignored here.
//!
//! What a ■ (or ●) does follows what is typed into it:
//!   a number            that number                       "60"
//!   an operator         that operation on what is wired in "+", "-", "×", "/", "^", "%",
//!                                                         "<", ">", "=", "≤", "≥", "min", "max",
//!                                                         "round", "floor", "and", "or", "not",
//!                                                         "&" (words joined with no space)
//!   other text          that text                          "min ago"
//!   nothing             the first wired value that is not held (so gated supers make a choice)
//! An operator on words joins them ("5" + "min ago" is "5 min ago").
//! An engine super computes the same way when its inputs are numbers (an operator super attached to it
//! by any wire gives the operation: 3 and 5 wired in, + attached, is 8); anything else becomes a
//! question for the engines, which the page asks and hands back as `answers`.

use crate::json::Json;
use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Held,
    Num(f64),
    Text(String),
    Bool(bool),
    List(Vec<Value>),
    Ask(String),
    Verb(String),
}

pub fn num_text(v: f64) -> String {
    if v.is_nan() {
        return "NaN".into();
    }
    if v.is_infinite() {
        return if v > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if v == crate::math::trunc(v) && v.abs() < 1e15 {
        return format!("{}", v as i64);
    }
    if v == crate::math::trunc(v) {
        return format!("{}", v);
    }
    format!("{:.3}", v)
}

impl Value {
    pub fn text(&self) -> String {
        match self {
            Value::Held => String::new(),
            Value::Num(n) => num_text(*n),
            Value::Text(t) | Value::Ask(t) | Value::Verb(t) => t.clone(),
            Value::Bool(b) => (if *b { "true" } else { "false" }).into(),
            Value::List(xs) => xs.iter().map(Value::text).collect::<Vec<_>>().join(", "),
        }
    }
    pub fn num(&self) -> Option<f64> {
        match self {
            Value::Num(n) => Some(*n),
            Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            Value::Text(t) => parse_num(t),
            _ => None,
        }
    }
    pub fn truthy(&self) -> bool {
        match self {
            Value::Held => false,
            Value::Num(n) => *n != 0.0 && !n.is_nan(),
            Value::Bool(b) => *b,
            Value::Text(t) => { let t = t.trim(); !t.is_empty() && t != "false" && t != "0" }
            Value::List(xs) => !xs.is_empty(),
            Value::Ask(_) | Value::Verb(_) => true,
        }
    }
    pub fn to_json(&self) -> Json {
        let (k, v) = match self {
            Value::Held => ("held", Json::Null),
            Value::Num(n) => ("number", Json::Num(*n)),
            Value::Text(t) => ("text", Json::Str(t.clone())),
            Value::Bool(b) => ("bool", Json::Bool(*b)),
            Value::List(xs) => ("list", Json::Arr(xs.iter().map(Value::to_json).collect())),
            Value::Ask(p) => ("ask", Json::Str(p.clone())),
            Value::Verb(p) => ("verb", Json::Str(p.clone())),
        };
        Json::Obj(vec![("kind".into(), Json::Str(k.into())), ("value".into(), v), ("text".into(), Json::Str(self.text()))])
    }
    pub fn from_json(j: &Json) -> Value {
        match j {
            Json::Null => Value::Held,
            Json::Bool(b) => Value::Bool(*b),
            Json::Num(n) => Value::Num(*n),
            Json::Str(s) => Value::Text(s.clone()),
            Json::Arr(a) => Value::List(a.iter().map(Value::from_json).collect()),
            Json::Obj(_) => match (j.s("kind"), j.get("value")) {
                (Some("number"), Some(v)) => Value::Num(v.num().unwrap_or(f64::NAN)),
                (Some("held"), _) => Value::Held,
                (_, Some(v)) => Value::from_json(v),
                _ => Value::Held,
            },
        }
    }
}

pub fn parse_num(t: &str) -> Option<f64> {
    let t = t.trim();
    if t.is_empty() {
        return None;
    }
    let b = t.as_bytes();
    let ok = b.iter().enumerate().all(|(i, c)| c.is_ascii_digit() || (i == 0 && *c == b'-') || *c == b'.' || *c == b',');
    if !ok || !b.iter().any(|c| c.is_ascii_digit()) || b.iter().filter(|c| **c == b'.' || **c == b',').count() > 1 {
        return None;
    }
    t.replace(',', ".").parse::<f64>().ok()
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Op { Mul, Add, Sub, Div, Pow, Rem, Lt, Gt, Eq, Le, Ge, Min, Max, Round, Floor, And, Or, Not, Cat }

pub fn op_of(t: &str) -> Option<Op> {
    let k = t.trim().to_lowercase();
    Some(match k.as_str() {
        "x" | "×" | "*" | "·" => Op::Mul,
        "+" => Op::Add,
        "-" | "−" | "–" => Op::Sub,
        "/" | "÷" | ":" => Op::Div,
        "^" => Op::Pow,
        "%" => Op::Rem,
        "<" => Op::Lt,
        ">" => Op::Gt,
        "=" | "==" => Op::Eq,
        "<=" | "≤" => Op::Le,
        ">=" | "≥" => Op::Ge,
        "min" => Op::Min,
        "max" => Op::Max,
        "round" => Op::Round,
        "floor" => Op::Floor,
        "and" => Op::And,
        "or" => Op::Or,
        "not" => Op::Not,
        "&" | "join" => Op::Cat,
        _ => return None,
    })
}

pub fn op_sym(op: Op) -> &'static str {
    match op {
        Op::Mul => "×", Op::Add => "+", Op::Sub => "-", Op::Div => "÷", Op::Pow => "^", Op::Rem => "%",
        Op::Lt => "<", Op::Gt => ">", Op::Eq => "=", Op::Le => "≤", Op::Ge => "≥", Op::Min => "min",
        Op::Max => "max", Op::Round => "round", Op::Floor => "floor", Op::And => "and", Op::Or => "or", Op::Not => "not", Op::Cat => "&",
    }
}

/// An operation on numbers, folded left to right as the page does (2, 3, 4 into - is 2 - 3 - 4).
pub fn apply_nums(op: Op, xs: &[f64]) -> Value {
    if xs.is_empty() {
        return Value::Held;
    }
    let cmp = |f: fn(f64, f64) -> bool| Value::Bool(xs.windows(2).all(|w| f(w[0], w[1])));
    match op {
        Op::Lt => cmp(|a, b| a < b),
        Op::Gt => cmp(|a, b| a > b),
        Op::Eq => cmp(|a, b| a == b),
        Op::Le => cmp(|a, b| a <= b),
        Op::Ge => cmp(|a, b| a >= b),
        Op::And => Value::Bool(xs.iter().all(|x| *x != 0.0)),
        Op::Or => Value::Bool(xs.iter().any(|x| *x != 0.0)),
        Op::Not => Value::Bool(xs[0] == 0.0),
        Op::Round => Value::Num(crate::math::round(xs[0])),
        Op::Floor => Value::Num(crate::math::floor(xs[0])),
        _ => Value::Num(xs[1..].iter().fold(xs[0], |a, &b| match op {
            Op::Mul => a * b,
            Op::Add => a + b,
            Op::Sub => a - b,
            Op::Div => a / b,
            Op::Pow => crate::math::pow(a, b),
            Op::Rem => a % b,
            Op::Min => if b < a { b } else { a },
            Op::Max => if b > a { b } else { a },
            _ => a,
        })),
    }
}

/// An operation on whatever is wired in: numbers compute, words join (with +), truth for and/or/not.
pub fn apply(op: Op, ins: &[Value]) -> Value {
    let ins: Vec<&Value> = ins.iter().filter(|v| **v != Value::Held).collect();
    if ins.is_empty() {
        return Value::Held;
    }
    match op {
        Op::And => return Value::Bool(ins.iter().all(|v| v.truthy())),
        Op::Or => return Value::Bool(ins.iter().any(|v| v.truthy())),
        Op::Not => return Value::Bool(!ins[0].truthy()),
        Op::Cat => return Value::Text(ins.iter().map(|v| v.text()).collect::<String>()),   // joined as they are, no spaces
        _ => {}
    }
    let nums: Option<Vec<f64>> = ins.iter().map(|v| v.num()).collect();
    match nums {
        Some(xs) => apply_nums(op, &xs),
        None if op == Op::Add => Value::Text(ins.iter().map(|v| v.text()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join(" ")),
        None if op == Op::Eq => Value::Bool(ins.windows(2).all(|w| w[0].text() == w[1].text())),
        None => Value::Held,
    }
}

pub const VERBS: &[(&str, &str)] = &[
    ("open", "open"), ("show", "open"), ("close", "close"), ("hide", "close"), ("pause", "pause"),
    ("hold", "pause"), ("stop", "pause"), ("run", "run"), ("go", "run"), ("resume", "run"),
];
pub fn verb_of(t: &str) -> Option<&'static str> {
    let k = t.trim().to_lowercase();
    VERBS.iter().find(|(w, _)| *w == k).map(|(_, v)| *v)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Fn { Input, Output, Engine, Add, Super, Dot, Box, Ask }

pub fn fn_of_n(n: f64) -> Fn {
    if n < 1.0 { Fn::Add } else if n < 1.7 { Fn::Super } else if n < 2.6 { Fn::Dot } else if n < 5.0 { Fn::Box } else { Fn::Ask }
}

#[derive(Clone, Debug)]
pub struct Super {
    pub id: String,
    pub name: String,
    pub func: Fn,
    pub text: String,
    pub hint: String,
}

#[derive(Clone, Debug)]
pub struct End {
    pub id: String,
    pub port: String,
}

#[derive(Clone, Debug)]
pub struct Program {
    pub supers: Vec<Super>,
    pub wires: Vec<(End, End)>,
}

const PORTS: &[&str] = &["input", "output", "sync", "condition"];

fn end_of(s: &str) -> Option<End> {
    let (id, port) = s.rsplit_once('.')?;
    let ok_id = !id.is_empty() && id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_');
    if !ok_id || !PORTS.contains(&port) {
        return None;
    }
    Some(End { id: id.into(), port: port.into() })
}

/// Reads a program (or a function) and says everything that is wrong with it.
pub fn read(j: &Json) -> Result<Program, Vec<String>> {
    let mut bad = Vec::new();
    let mut supers = Vec::new();
    if !matches!(j.get("supers"), Some(Json::Arr(_))) {
        bad.push("supers must be a list".to_string());
    }
    let mut ids: Vec<String> = vec!["site".into()];
    for (i, s) in j.get("supers").map(Json::arr).unwrap_or(&[]).iter().enumerate() {
        let id = match s.s("id") {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => { bad.push(format!("supers[{}] needs an id", i)); continue; }
        };
        if ids.contains(&id) {
            bad.push(format!("two supers are called {}", id));
        }
        ids.push(id.clone());
        let func = match (s.s("kind"), s.s("fn"), s.get("n").and_then(Json::num)) {
            (Some("input"), _, _) => Fn::Input,
            (Some("output"), _, _) => Fn::Output,
            (Some("engine"), _, _) => Fn::Engine,
            (_, Some(f), _) => match f {
                "add" | "plus" => Fn::Add,
                "super" => Fn::Super,
                "dot" => Fn::Dot,
                "box" => Fn::Box,
                "ask" | "help" => Fn::Ask,
                other => { bad.push(format!("super {}: no function called {}", id, other)); Fn::Box }
            },
            (_, _, Some(n)) => fn_of_n(n),
            _ => Fn::Box,
        };
        supers.push(Super {
            name: s.s("name").unwrap_or(&id).to_string(),
            id,
            func,
            text: s.s("text").unwrap_or("").to_string(),
            hint: s.s("hint").unwrap_or("").to_string(),
        });
    }
    let mut wires = Vec::new();
    if let Some(w) = j.get("wires") {
        if !matches!(w, Json::Arr(_)) {
            bad.push("wires must be a list".into());
        }
        for (i, w) in w.arr().iter().enumerate() {
            let pair = w.arr();
            if pair.len() != 2 {
                bad.push(format!("wires[{}] must be [from, to]", i));
                continue;
            }
            let mut ends = Vec::new();
            for e in pair {
                let t = e.str().unwrap_or("");
                match end_of(t) {
                    None => bad.push(format!("wire end {} must be \"super.port\" (input, output, sync or condition)", t)),
                    Some(end) if !ids.contains(&end.id) => bad.push(format!("wire end {}: no super called {}", t, end.id)),
                    Some(end) => ends.push(end),
                }
            }
            if ends.len() == 2 {
                let b = ends.pop().unwrap();
                let a = ends.pop().unwrap();
                wires.push((a, b));
            }
        }
    }
    if bad.is_empty() { Ok(Program { supers, wires }) } else { Err(bad) }
}

/// Which way a wire carries data: from the output end into the other end's input or condition.
fn flow(w: &(End, End)) -> Option<(&End, &End)> {
    let (a, b) = (&w.0, &w.1);
    if a.port == "output" && b.port != "output" { Some((a, b)) }
    else if b.port == "output" && a.port != "output" { Some((b, a)) }
    else if a.port == "input" && b.port == "input" { Some((a, b)) }
    else { None }
}

pub struct Run {
    pub values: BTreeMap<String, Value>,
    pub outputs: Vec<(String, Value)>,
    pub asks: Vec<(String, String)>,
    pub order: Vec<String>,
    pub cycle: Vec<String>,
}

impl Program {
    fn find(&self, id: &str) -> Option<&Super> {
        self.supers.iter().find(|s| s.id == id)
    }
    /// The supers in the order data reaches them; those caught in a loop of wires come back separately.
    pub fn order(&self) -> (Vec<String>, Vec<String>) {
        let ids: Vec<&str> = self.supers.iter().map(|s| s.id.as_str()).collect();
        let mut deg: BTreeMap<&str, usize> = ids.iter().map(|i| (*i, 0)).collect();
        let mut next: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        for w in &self.wires {
            if let Some((from, to)) = flow(w) {
                if to.port == "sync" || from.id == to.id || !deg.contains_key(from.id.as_str()) || !deg.contains_key(to.id.as_str()) {
                    continue;
                }
                *deg.get_mut(to.id.as_str()).unwrap() += 1;
                next.entry(from.id.as_str()).or_default().push(to.id.as_str());
            }
        }
        let mut ready: Vec<&str> = ids.iter().copied().filter(|i| deg[i] == 0).collect();
        let mut out = Vec::new();
        let mut k = 0;
        while k < ready.len() {
            let i = ready[k];
            k += 1;
            out.push(i.to_string());
            for &t in next.get(i).map(|v| v.as_slice()).unwrap_or(&[]) {
                let d = deg.get_mut(t).unwrap();
                *d -= 1;
                if *d == 0 { ready.push(t); }
            }
        }
        let cycle = ids.iter().filter(|i| !out.iter().any(|o| o == *i)).map(|i| i.to_string()).collect();
        (out, cycle)
    }

    /// An operator super joined to `id` by any wire, at any port (the page's "attached" operator).
    fn attached_op(&self, id: &str) -> Option<Op> {
        for (a, b) in &self.wires {
            let other = if a.id == id { &b.id } else if b.id == id { &a.id } else { continue };
            if other == id { continue; }
            if let Some(s) = self.find(other) {
                if let Some(op) = op_of(&s.text) { return Some(op); }
            }
        }
        None
    }

    pub fn run(&self, inputs: &[(String, Value)], answers: &[(String, String)]) -> Run {
        let (order, cycle) = self.order();
        let mut values: BTreeMap<String, Value> = BTreeMap::new();
        let mut asks = Vec::new();
        for id in &order {
            let s = self.find(id).unwrap();
            let mut ins = Vec::new();
            let mut cond: Option<Value> = None;
            for w in &self.wires {
                if let Some((from, to)) = flow(w) {
                    if to.id != *id || from.id == *id { continue; }
                    let v = if from.id == "site" { Value::Held } else { values.get(&from.id).cloned().unwrap_or(Value::Held) };
                    match to.port.as_str() {
                        "condition" => { cond = Some(match (cond, v) { (Some(c), v) => Value::Bool(c.truthy() && v.truthy()), (None, v) => v }); }
                        "input" | "output" => ins.push(v),
                        _ => {}
                    }
                }
            }
            let v = if cond.as_ref().map_or(false, |c| !c.truthy()) {
                Value::Held
            } else {
                self.eval(s, &ins, inputs, answers)
            };
            if let Value::Ask(p) = &v {
                if let Some((_, a)) = answers.iter().find(|(q, _)| q == p) {
                    values.insert(id.clone(), Value::Text(a.clone()));
                    continue;
                }
                asks.push((id.clone(), p.clone()));
            }
            values.insert(id.clone(), v);
        }
        for id in &cycle { values.insert(id.clone(), Value::Held); }
        let outputs = self.supers.iter().filter(|s| s.func == Fn::Output).map(|s| (s.name.clone(), values.get(&s.id).cloned().unwrap_or(Value::Held))).collect();
        Run { values, outputs, asks, order, cycle }
    }

    fn eval(&self, s: &Super, ins: &[Value], inputs: &[(String, Value)], _answers: &[(String, String)]) -> Value {
        let typed = s.text.trim();
        let live: Vec<Value> = ins.iter().filter(|v| **v != Value::Held).cloned().collect();
        let first = || live.first().cloned().unwrap_or(Value::Held);
        match s.func {
            Fn::Input => inputs.iter().find(|(k, _)| *k == s.name).map(|(_, v)| v.clone()).unwrap_or(Value::Held),
            Fn::Output => first(),
            Fn::Engine => engine(typed, &live, self.attached_op(&s.id), &s.hint),
            Fn::Add => if live.is_empty() { constant(typed) } else { apply(Op::Add, &live) },
            Fn::Super | Fn::Ask => {
                let wired: Vec<String> = live.iter().map(Value::text).filter(|t| !t.is_empty()).collect();
                let p = if typed.is_empty() { wired.join(" ") } else if wired.is_empty() { typed.into() } else { format!("{} ({})", typed, wired.join("; ")) };
                if p.trim().is_empty() { Value::Held } else { Value::Ask(p) }
            }
            Fn::Dot | Fn::Box => {
                if let Some(op) = op_of(typed) {
                    if live.is_empty() { Value::Text(typed.into()) } else { apply(op, &live) }
                } else if !typed.is_empty() {
                    constant(typed)
                } else {
                    first()
                }
            }
        }
    }
}

fn constant(typed: &str) -> Value {
    if typed.is_empty() { Value::Held } else if let Some(x) = parse_num(typed) { Value::Num(x) } else { Value::Text(typed.into()) }
}

/// What a Super AI super gives, from what is typed into it and what is wired in: computable things are
/// computed at once; a verb is an instruction; anything else is a question for the engines.
pub fn engine(typed: &str, ins: &[Value], attached: Option<Op>, hint: &str) -> Value {
    if let Some(x) = parse_num(typed) {
        return Value::Num(x);
    }
    let is_num = |v: &Value| v.num().is_some() && !matches!(v, Value::Bool(_));
    let op_ins: Vec<&Value> = ins.iter().filter(|v| op_of(&v.text()).is_some() && !is_num(v)).collect();
    let typed_op = op_of(typed);
    let op = typed_op.or_else(|| op_ins.first().and_then(|v| op_of(&v.text()))).or(if typed.is_empty() { attached } else { None });
    let nums: Vec<&Value> = ins.iter().filter(|v| !op_ins.contains(v)).collect();
    if let Some(op) = op {
        if !nums.is_empty() && nums.iter().all(|v| is_num(v)) {
            return apply(op, &nums.iter().map(|v| (*v).clone()).collect::<Vec<_>>());
        }
    }
    let verb = verb_of(typed);
    if typed.is_empty() && !ins.is_empty() && ins.iter().all(is_num) {
        return if ins.len() == 1 { Value::Num(ins[0].num().unwrap()) } else { Value::List(ins.to_vec()) };
    }
    if let Some(v) = verb {
        return Value::Verb(v.into());
    }
    let wired: Vec<String> = ins.iter().map(Value::text).filter(|t| !t.is_empty()).collect();
    let prompt = if typed.is_empty() { wired.join(" ") } else if wired.is_empty() { typed.into() } else { format!("{} (wired in: {})", typed, wired.join("; ")) };
    let prompt = prompt.trim();
    if typed.is_empty() {
        if let Some(v) = verb_of(prompt) { return Value::Verb(v.into()); }
    }
    if prompt.is_empty() {
        return if hint.is_empty() { Value::Held } else { Value::Text(hint.into()) };
    }
    Value::Ask(prompt.into())
}
