//! The Program super's language, as on piii.app (back/rust/ui/src/program.rs): supers joined by wires, run as
//! dataflow like LabVIEW's block diagram, and Turing complete. Here it stands alone: a program is its nodes (what is
//! typed in each, and where it sits) and its wires.
//!
//!   in       the values a node works on, taken top to bottom (then left to right) by where their nodes sit
//!   control  a trigger: when wired, the node runs only once a value has arrived there
//!   gate     a condition: when wired, the node runs only when that value is true
//!   reg 0    a register: gives what it holds; at the end of each step takes what arrived. Loops pass through one.
//!
//! ▶ runs step after step: every node computes once in wire order, then every register takes its new value; the run
//! ends at a stop that gets true, when the registers settle, or after 100 000 steps.

use crate::num::{floor, pow};
use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;

const MAX_STEPS: u64 = 100_000;
const MAX_EVALS: u64 = 3_000_000;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Value>),
}

impl Value {
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tip {
    In,
    Control,
    Gate,
}

#[derive(Clone, PartialEq, Debug)]
pub enum Kind {
    Pick,
    Const(Value),
    Op(&'static str),
    Reg(Value),
    Stop,
    Show,
    List,
    At,
    Set,
    Len,
    Push,
    /// words that are no operation (on piii.app, a prompt for Super AI; offline here)
    Words,
}

// ------------------------------------------------------------------------------------------------- values

/// A list or a value written in brackets: [1, 2, 3], ["a", true], [[1,2],[3]].
fn parse_value(s: &str) -> Option<(Value, usize)> {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() && b[i] == b' ' {
        i += 1;
    }
    if i >= b.len() {
        return None;
    }
    if b[i] == b'[' {
        let mut items = Vec::new();
        i += 1;
        loop {
            while i < b.len() && (b[i] == b' ' || b[i] == b',') {
                i += 1;
            }
            if i >= b.len() {
                return None;
            }
            if b[i] == b']' {
                return Some((Value::Arr(items), i + 1));
            }
            let (v, used) = parse_value(&s[i..])?;
            items.push(v);
            i += used;
        }
    }
    if b[i] == b'"' {
        let start = i + 1;
        let end = s[start..].find('"')? + start;
        return Some((Value::Str(s[start..end].to_string()), end + 1));
    }
    let start = i;
    while i < b.len() && b[i] != b',' && b[i] != b']' && b[i] != b' ' {
        i += 1;
    }
    let tok = &s[start..i];
    let v = match tok {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        "null" => Value::Null,
        _ => Value::Num(tok.parse::<f64>().ok()?),
    };
    Some((v, i))
}

pub fn literal(t: &str) -> Option<Value> {
    let t = t.trim();
    if t.is_empty() {
        return None;
    }
    if t == "true" {
        return Some(Value::Bool(true));
    }
    if t == "false" {
        return Some(Value::Bool(false));
    }
    if t.len() >= 2 && (t.starts_with('"') && t.ends_with('"') || t.starts_with('“') && t.ends_with('”')) {
        let inner: String = t.chars().skip(1).take(t.chars().count() - 2).collect();
        return Some(Value::Str(inner));
    }
    if t.starts_with('[') {
        return parse_value(t).map(|x| x.0);
    }
    let b = t.as_bytes();
    let numeric = b.iter().enumerate().all(|(i, c)| c.is_ascii_digit() || *c == b'.' || (i == 0 && (*c == b'-' || *c == b'+')))
        && b.iter().any(|c| c.is_ascii_digit());
    if numeric {
        return t.parse::<f64>().ok().map(Value::Num);
    }
    None
}

pub fn kind_of(text: &str) -> Kind {
    let t = text.trim();
    let low = t.to_lowercase();
    let word = low.split_whitespace().next().unwrap_or("");
    let rest = t.split_once(char::is_whitespace).map(|x| x.1).unwrap_or("");
    match word {
        "" | "pick" | "✦" => return Kind::Pick,
        "reg" | "register" => return Kind::Reg(literal(rest).unwrap_or(Value::Num(0.0))),
        "stop" => return Kind::Stop,
        "show" | "display" => return Kind::Show,
        "list" => return Kind::List,
        "at" | "get" | "index" => return Kind::At,
        "set" => return Kind::Set,
        "len" | "length" => return Kind::Len,
        "push" | "append" => return Kind::Push,
        _ => {}
    }
    if let Some(v) = literal(t) {
        return Kind::Const(v);
    }
    let op = match low.as_str() {
        "+" | "add" => "+",
        "-" | "−" | "–" | "sub" => "−",
        "×" | "*" | "x" | "·" | "mul" => "×",
        "/" | "÷" | "div" => "÷",
        "%" | "mod" => "%",
        "^" | "pow" => "^",
        "min" => "min",
        "max" => "max",
        "<" => "<",
        ">" => ">",
        "=" | "==" => "=",
        "≠" | "!=" | "<>" => "≠",
        "≤" | "<=" => "≤",
        "≥" | ">=" => "≥",
        "and" | "&&" => "and",
        "or" | "||" => "or",
        "not" | "!" => "not",
        "round" => "round",
        "floor" => "floor",
        "abs" => "abs",
        "&" | "join" => "&",
        _ => return Kind::Words,
    };
    Kind::Op(op)
}

fn vnum(v: &Value) -> Option<f64> {
    match v {
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Value::Num(n) => Some(*n),
        Value::Str(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

pub fn vtruthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Num(n) => *n != 0.0 && !n.is_nan(),
        Value::Str(s) => {
            let t = s.trim();
            !t.is_empty() && t != "false" && t != "0"
        }
        Value::Arr(a) => !a.is_empty(),
    }
}

/// A value as it is shown.
pub fn vtext(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::Bool(b) => (if *b { "true" } else { "false" }).to_string(),
        Value::Num(n) => {
            if n.is_nan() {
                "NaN".into()
            } else if n.is_infinite() {
                if *n > 0.0 { "∞".into() } else { "-∞".into() }
            } else if *n == (*n as i64) as f64 && crate::num::abs(*n) < 1e15 {
                format!("{}", *n as i64)
            } else {
                let s = format!("{:.6}", n);
                s.trim_end_matches('0').trim_end_matches('.').to_string()
            }
        }
        Value::Str(s) => s.clone(),
        Value::Arr(a) => format!(
            "[{}]",
            a.iter().map(|x| if let Value::Str(s) = x { format!("\"{}\"", s) } else { vtext(x) }).collect::<Vec<_>>().join(", ")
        ),
    }
}

/// An operation on what arrives (all of it must have arrived: a node waits for its inputs, as in LabVIEW).
pub fn apply_op(op: &str, xs: &[Value]) -> Value {
    if xs.is_empty() || xs.iter().any(|x| x.is_null()) {
        return Value::Null;
    }
    let nums: Option<Vec<f64>> = xs.iter().map(vnum).collect();
    match op {
        "&" => Value::Str(xs.iter().map(vtext).collect::<Vec<_>>().concat()),
        "not" => Value::Bool(!vtruthy(&xs[0])),
        "and" => Value::Bool(xs.iter().all(vtruthy)),
        "or" => Value::Bool(xs.iter().any(vtruthy)),
        "=" => Value::Bool(xs.windows(2).all(|w| match (vnum(&w[0]), vnum(&w[1])) {
            (Some(a), Some(b)) => a == b,
            _ => vtext(&w[0]) == vtext(&w[1]),
        })),
        "≠" => Value::Bool(xs.windows(2).all(|w| match (vnum(&w[0]), vnum(&w[1])) {
            (Some(a), Some(b)) => a != b,
            _ => vtext(&w[0]) != vtext(&w[1]),
        })),
        _ => match nums {
            None if op == "+" => Value::Str(xs.iter().map(vtext).collect::<Vec<_>>().join(" ")),
            None => Value::Null,
            Some(n) => {
                let cmp = |f: fn(f64, f64) -> bool| Value::Bool(n.windows(2).all(|w| f(w[0], w[1])));
                match op {
                    "<" => cmp(|a, b| a < b),
                    ">" => cmp(|a, b| a > b),
                    "≤" => cmp(|a, b| a <= b),
                    "≥" => cmp(|a, b| a >= b),
                    "round" => Value::Num(floor(n[0] + 0.5)),
                    "floor" => Value::Num(floor(n[0])),
                    "abs" => Value::Num(if n[0] < 0.0 { -n[0] } else { n[0] }),
                    _ => Value::Num(n[1..].iter().fold(n[0], |a, &b| match op {
                        "+" => a + b,
                        "−" => a - b,
                        "×" => a * b,
                        "÷" => a / b,
                        "%" => a - b * floor(a / b),
                        "^" => pow(a, b),
                        "min" => if b < a { b } else { a },
                        "max" => if b > a { b } else { a },
                        _ => a,
                    })),
                }
            }
        },
    }
}

fn index_of(v: &Value, len: usize) -> Option<usize> {
    let i = vnum(v)?;
    if i < 0.0 || i != floor(i) || i as usize >= len { None } else { Some(i as usize) }
}

/// What a node gives for what arrived at its in.
pub fn eval_kind(k: &Kind, ins: &[Value]) -> Value {
    let first = || ins.iter().find(|v| !v.is_null()).cloned().unwrap_or(Value::Null);
    match k {
        Kind::Pick | Kind::Show | Kind::Stop => first(),
        Kind::Const(v) => v.clone(),
        Kind::Op(op) => apply_op(op, ins),
        Kind::Reg(_) | Kind::Words => Value::Null,
        Kind::List => Value::Arr(ins.iter().filter(|v| !v.is_null()).cloned().collect()),
        Kind::At => match (ins.first(), ins.get(1)) {
            (Some(Value::Arr(a)), Some(i)) => index_of(i, a.len()).map(|i| a[i].clone()).unwrap_or(Value::Null),
            (Some(Value::Str(s)), Some(i)) => {
                let cs: Vec<char> = s.chars().collect();
                index_of(i, cs.len()).map(|i| Value::Str(cs[i].to_string())).unwrap_or(Value::Null)
            }
            _ => Value::Null,
        },
        Kind::Set => match (ins.first(), ins.get(1), ins.get(2)) {
            (Some(Value::Arr(a)), Some(i), Some(v)) if !v.is_null() => match vnum(i) {
                Some(n) if n >= 0.0 && n == floor(n) && n < 1e7 => {
                    let mut a = a.clone();
                    let n = n as usize;
                    while a.len() <= n {
                        a.push(Value::Num(0.0));
                    }
                    a[n] = v.clone();
                    Value::Arr(a)
                }
                _ => Value::Null,
            },
            _ => Value::Null,
        },
        Kind::Len => match ins.first() {
            Some(Value::Arr(a)) => Value::Num(a.len() as f64),
            Some(Value::Str(s)) => Value::Num(s.chars().count() as f64),
            _ => Value::Null,
        },
        Kind::Push => match ins.first() {
            Some(Value::Arr(a)) => {
                let mut a = a.clone();
                a.extend(ins[1..].iter().filter(|v| !v.is_null()).cloned());
                Value::Arr(a)
            }
            _ => Value::Null,
        },
    }
}

// ------------------------------------------------------------------------------------------------- programs

pub struct Node {
    pub text: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Default)]
pub struct Program {
    pub name: String,
    pub about: String,
    pub nodes: Vec<Node>,
    /// (from, to, which tip of `to`)
    pub wires: Vec<(usize, usize, Tip)>,
    pub vals: BTreeMap<usize, Value>,
    pub regs: BTreeMap<usize, Value>,
    pub steps: u64,
    pub status: String,
}

impl Program {
    fn kind(&self, i: usize) -> Kind {
        kind_of(&self.nodes[i].text)
    }

    fn is_reg(&self, i: usize) -> bool {
        matches!(self.kind(i), Kind::Reg(_))
    }

    /// what arrives at a node's tip, top to bottom, then left to right
    fn data_in(&self, id: usize, tip: Tip) -> Vec<usize> {
        let mut v: Vec<usize> = self.wires.iter().filter(|w| w.1 == id && w.2 == tip).map(|w| w.0).collect();
        v.sort_by(|a, b| {
            let (na, nb) = (&self.nodes[*a], &self.nodes[*b]);
            (na.y, na.x).partial_cmp(&(nb.y, nb.x)).unwrap_or(core::cmp::Ordering::Equal)
        });
        v
    }

    /// The order nodes compute in: after everything they need, a register's out counting as known from the start.
    fn order(&self) -> (Vec<usize>, Vec<usize>) {
        let n = self.nodes.len();
        let deps: Vec<Vec<usize>> = (0..n)
            .map(|id| {
                let mut d = Vec::new();
                for t in [Tip::In, Tip::Control, Tip::Gate] {
                    d.extend(self.data_in(id, t).into_iter().filter(|a| !self.is_reg(*a) && *a != id));
                }
                d
            })
            .collect();
        let mut done: Vec<usize> = Vec::new();
        let mut left: Vec<usize> = (0..n).collect();
        loop {
            let before = left.len();
            let mut i = 0;
            while i < left.len() {
                if deps[left[i]].iter().all(|d| done.contains(d)) {
                    done.push(left[i]);
                    left.remove(i);
                } else {
                    i += 1;
                }
            }
            if left.is_empty() || left.len() == before {
                break;
            }
        }
        (done, left)
    }

    fn allowed(&self, vals: &BTreeMap<usize, Value>, id: usize) -> bool {
        let ctl = self.data_in(id, Tip::Control);
        if !ctl.is_empty() && ctl.iter().all(|c| vals.get(c).map(|v| v.is_null()).unwrap_or(true)) {
            return false;
        }
        let gate = self.data_in(id, Tip::Gate);
        if !gate.is_empty() && !gate.iter().all(|c| vals.get(c).map(vtruthy).unwrap_or(false)) {
            return false;
        }
        true
    }

    /// One step; answers whether a stop fired.
    fn tick(&mut self, order: &[usize], evals: &mut u64) -> bool {
        let mut vals: BTreeMap<usize, Value> = BTreeMap::new();
        let regs: Vec<usize> = (0..self.nodes.len()).filter(|i| self.is_reg(*i)).collect();
        for r in &regs {
            let v = self.regs.get(r).cloned().unwrap_or_else(|| match self.kind(*r) {
                Kind::Reg(v) => v,
                _ => Value::Null,
            });
            self.regs.insert(*r, v.clone());
            vals.insert(*r, v);
        }
        let mut stop = false;
        for &id in order {
            if regs.contains(&id) {
                continue;
            }
            *evals += 1;
            let ins: Vec<Value> = self.data_in(id, Tip::In).iter().map(|a| vals.get(a).cloned().unwrap_or(Value::Null)).collect();
            let k = self.kind(id);
            let v = if self.allowed(&vals, id) { eval_kind(&k, &ins) } else { Value::Null };
            if k == Kind::Stop && vtruthy(&v) {
                stop = true;
            }
            vals.insert(id, v);
        }
        let mut next = Vec::new();
        for r in &regs {
            if !self.allowed(&vals, *r) {
                continue;
            }
            if let Some(v) = self.data_in(*r, Tip::In).iter().map(|a| vals.get(a).cloned().unwrap_or(Value::Null)).find(|v| !v.is_null()) {
                next.push((*r, v));
            }
        }
        for (r, v) in next {
            self.regs.insert(r, v);
        }
        self.vals = vals;
        self.steps += 1;
        stop
    }

    /// ▶ (steps None: until it ends) or one step (Some(1)).
    pub fn run(&mut self, steps: Option<u64>) {
        let (order, stuck) = self.order();
        if !stuck.is_empty() {
            let names: Vec<String> = stuck.iter().map(|i| format!("\"{}\"", self.nodes[*i].text)).collect();
            self.status = format!("Not run: a loop with no register through {}. Put a reg in it.", names.join(", "));
            return;
        }
        let has_regs = (0..self.nodes.len()).any(|i| self.is_reg(i));
        let mut evals = 0u64;
        let start = self.steps;
        let why = match steps {
            Some(n) => {
                let mut stopped = false;
                for _ in 0..n {
                    if self.tick(&order, &mut evals) {
                        stopped = true;
                        break;
                    }
                }
                if stopped { "stopped by a stop node" } else { "one step" }
            }
            None if !has_regs => {
                self.tick(&order, &mut evals);
                "done (no register: one step)"
            }
            None => {
                let mut w = "after 100 000 steps (the limit)";
                loop {
                    let before = self.regs.clone();
                    if self.tick(&order, &mut evals) {
                        w = "stopped by a stop node";
                        break;
                    }
                    if before == self.regs && self.steps - start > 1 {
                        w = "settled: the registers stopped changing";
                        break;
                    }
                    if self.steps - start >= MAX_STEPS || evals >= MAX_EVALS {
                        break;
                    }
                }
                w
            }
        };
        let n = self.steps - start;
        self.status = format!("{} {} · {} · {} in all", n, if n == 1 { "step" } else { "steps" }, why, self.steps);
    }

    pub fn clear(&mut self) {
        self.regs.clear();
        self.vals.clear();
        self.steps = 0;
        self.status = "Cleared: registers back to where they start.".to_string();
    }

    /// What a node holds now (a register's value, or what it last gave).
    pub fn value(&self, i: usize) -> Option<&Value> {
        self.regs.get(&i).or_else(|| self.vals.get(&i)).filter(|v| !v.is_null())
    }

    pub fn is_register(&self, i: usize) -> bool {
        self.is_reg(i)
    }
}

/// (name, what it shows, nodes as (text, x, y), wires as (from, to)): the examples piii.app has.
type Example = (&'static str, &'static str, &'static [(&'static str, f64, f64)], &'static [(usize, usize)]);

pub const EXAMPLES: [Example; 5] = [
    (
        "Count to 10",
        "A register counts up by one each step; the run stops when it reaches 10.",
        &[("reg 0", 24.0, 70.0), ("1", 24.0, 180.0), ("+", 200.0, 120.0), ("10", 200.0, 230.0), ("≥", 370.0, 170.0), ("stop", 530.0, 170.0)],
        &[(0, 2), (1, 2), (2, 0), (2, 4), (3, 4), (4, 5)],
    ),
    (
        "Factorial",
        "10! = 3 628 800: one register counts, the other multiplies.",
        &[("reg 1", 24.0, 70.0), ("1", 24.0, 160.0), ("reg 1", 24.0, 250.0), ("+", 200.0, 100.0), ("×", 200.0, 230.0), ("10", 200.0, 330.0), (">", 370.0, 200.0), ("stop", 530.0, 200.0)],
        &[(0, 3), (1, 3), (3, 0), (0, 4), (2, 4), (4, 2), (3, 6), (5, 6), (6, 7)],
    ),
    (
        "Fibonacci",
        "Two registers pass the sum along; stops once it passes 1000.",
        &[("reg 0", 24.0, 70.0), ("reg 1", 24.0, 190.0), ("+", 200.0, 130.0), ("1000", 200.0, 250.0), ("≥", 370.0, 190.0), ("stop", 530.0, 190.0)],
        &[(0, 2), (1, 2), (2, 1), (1, 0), (2, 4), (3, 4), (4, 5)],
    ),
    (
        "Greatest common divisor",
        "Euclid on 1071 and 462: the first register ends at 21.",
        &[("reg 1071", 24.0, 70.0), ("reg 462", 24.0, 180.0), ("%", 220.0, 120.0), ("0", 220.0, 240.0), ("=", 390.0, 180.0), ("stop", 540.0, 180.0)],
        &[(0, 2), (1, 2), (2, 1), (1, 0), (2, 4), (3, 4), (4, 5)],
    ),
    (
        "Turing machine",
        "A two-state busy beaver: a tape (a list), a head and a state in registers, the rules read with at. It writes four 1s and halts.",
        &[
            ("reg [0,0,0,0,0,0]", 16.0, 60.0),
            ("reg 3", 16.0, 140.0),
            ("reg 0", 16.0, 220.0),
            ("2", 16.0, 300.0),
            ("[1,1,1,1]", 16.0, 380.0),
            ("[1,-1,-1,1]", 16.0, 460.0),
            ("[1,1,0,2]", 16.0, 540.0),
            ("at", 230.0, 100.0),
            ("×", 230.0, 260.0),
            ("+", 230.0, 610.0),
            ("at", 390.0, 400.0),
            ("at", 390.0, 480.0),
            ("at", 390.0, 560.0),
            ("set", 540.0, 60.0),
            ("+", 540.0, 180.0),
            ("2", 390.0, 650.0),
            ("=", 540.0, 600.0),
            ("stop", 540.0, 680.0),
        ],
        &[
            (0, 7), (1, 7),
            (2, 8), (3, 8),
            (7, 9), (8, 9),
            (4, 10), (9, 10),
            (5, 11), (9, 11),
            (6, 12), (9, 12),
            (0, 13), (1, 13), (10, 13),
            (1, 14), (11, 14),
            (13, 0), (14, 1), (12, 2),
            (12, 16), (15, 16), (16, 17),
        ],
    ),
];

pub fn example(i: usize) -> Program {
    let (name, about, nodes, wires) = EXAMPLES[i.min(EXAMPLES.len() - 1)];
    Program {
        name: name.to_string(),
        about: about.to_string(),
        nodes: nodes.iter().map(|(t, x, y)| Node { text: t.to_string(), x: *x, y: *y }).collect(),
        wires: wires.iter().map(|(a, b)| (*a, *b, Tip::In)).collect(),
        status: format!("{}: press Run, or Step (r, s).", name),
        ..Default::default()
    }
}

#[allow(dead_code)]
pub fn empty() -> Program {
    Program { nodes: vec![], ..Default::default() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(i: usize) -> Program {
        let mut p = example(i);
        p.run(None);
        p
    }

    #[test]
    fn the_examples_give_what_they_say() {
        assert_eq!(run(0).value(0), Some(&Value::Num(10.0)));
        assert_eq!(run(1).value(2), Some(&Value::Num(3628800.0)));
        let fib = run(2);
        assert!(matches!(fib.value(1), Some(Value::Num(n)) if *n >= 1000.0));
        assert_eq!(run(3).value(0), Some(&Value::Num(21.0)));
        let tm = run(4);
        let ones = match tm.value(0) {
            Some(Value::Arr(a)) => a.iter().filter(|v| **v == Value::Num(1.0)).count(),
            _ => 0,
        };
        assert_eq!(ones, 4, "{}", tm.status);
        assert!(tm.status.contains("stop"));
    }

    #[test]
    fn a_loop_without_a_register_is_refused() {
        let mut p = Program {
            nodes: vec![Node { text: "+".into(), x: 0.0, y: 0.0 }, Node { text: "1".into(), x: 0.0, y: 50.0 }],
            wires: vec![(0, 0, Tip::In)],
            ..Default::default()
        };
        p.wires = vec![(1, 0, Tip::In), (0, 1, Tip::In)];
        // 1 is a constant fed by + and feeding it: a loop with no register
        p.run(None);
        assert!(p.status.starts_with("Not run"), "{}", p.status);
    }
}
