// The canvas is a program (owner, 2026-10-14: "make this a working graphical language like LabVIEW, which can
// completely work and Turing complete with all the rules"). Included into app.rs, like scene.rs.
//
// THE LANGUAGE. A program is supers joined by wires, run as dataflow, as in LabVIEW's block diagram. Every super has
// the four terminals of the superellipse language: out (right) where its value leaves, in (left) where values arrive,
// control (top) and gate (bottom).
//
//   in       the values a node works on. Several wires may arrive; they are taken top to bottom, in the order of
//            the supers they come from on the canvas (so "10 − 3" puts the 10 above the 3).
//   control  a trigger: when anything is wired to it, the node runs only once a value has arrived there.
//   gate     a condition: when a value is wired to it, the node runs only when that value is true; otherwise it
//            gives nothing ("held"), and so does everything downstream that needs it. One gate per super.
//   out      the node's value. One out feeds any number of tips.
//
// What a node does follows what is typed in it (a node in the Program super; the palette adds them):
//   3, -2.5, true, "words", [1, 2, 3]       a constant (a list in brackets)
//   π (pi)  e  φ (phi)  τ (tau)             the constants
//   + − × ÷ % ^ min max                     arithmetic on what arrives (+ joins words with a space; & with none)
//   < > = ≠ ≤ ≥ and or not round floor abs  comparisons and logic
//   √ (sqrt) sin cos tan ln exp ceil sign   more math on the first value
//   if                                      three values: the first true → the second, else the third
//   random  now                             no input needed: a number in [0, 1) (with n: a whole number below n);
//                                           the time, in milliseconds
//   range  sum  avg  sort  reverse          lists: [0 … n−1] (or [a … b−1]), their total, their mean, sorted, reversed
//   upper  lower  split  text  number       words: capitals, small letters, cut at a separator (a space if none),
//                                           any value as words, words as a number
//   reg 0                                   a register (LabVIEW's shift register): it gives what it holds, and at the
//                                           end of each step it takes what arrives at its in. Its gate, if false,
//                                           keeps what it holds. Loops must pass through a register.
//   pick                                    the first value that arrives (with gates: a choice, LabVIEW's case)
//   list  at  set  len  push                lists: build, read item i, write item i, length, append
//   show                                    shows what arrives
//   stop                                    stops the run when what arrives is true
//   open                                    opens the address that arrives ("#/assess", a link) when the run ends
//
// RUNNING. ▶ runs the program step after step: in each step every node computes once, in the order of the wires
// (registers give what they held at the start of the step), then every register takes its new value. The run ends
// when a stop node gets true, when the registers stop changing, or after 100 000 steps; with no register it is a
// single step. ⏹ empties the registers and values.
//
// TURING COMPLETE. Registers hold any value, lists grow without bound (push) and are read and written anywhere
// (at, set), and gates choose: a register holding a tape (a list), one holding the head, one holding the state, and
// a transition table read with at, run until a stop — a Turing machine. The examples include one (a busy beaver).
//
// The site's own supers take part too: a bubble passes on what arrives at it, ▶'s out gives true, and the layout
// controls (save, lock, chain, reset) act on the super whose control they reach, as before.

const UBASE: usize = 100;
const MAX_STEPS: u64 = 100_000;
const MAX_EVALS: u64 = 3_000_000;

pub struct UNode {
    id: usize,
    /// place, in design units, from the Program super's top-left corner (the nodes move with it)
    x: f64,
    y: f64,
    text: String,
    /// a size given by resizing it (0, 0: the size its text gives)
    w: f64,
    h: f64,
}

#[derive(Default)]
pub struct Prog {
    nodes: Vec<UNode>,
    next: usize,
    vals: BTreeMap<usize, Value>,
    regs: BTreeMap<usize, Value>,
    steps: u64,
    status: String,
    sel: Option<usize>,
    /// Super AI's answers to the prompts typed in supers, by the whole prompt sent
    ai: BTreeMap<String, String>,
    /// prompts waiting to be sent, and those on their way
    ai_want: Vec<String>,
    ai_busy: Vec<String>,
}

fn is_unode(id: usize) -> bool {
    (UBASE..PAGE_IN_HIGH).contains(&id)
}

/// User nodes take ids from 100 up; the page's edges and frame are 97–99, kept below.
const PAGE_IN_HIGH: usize = 1_000_000;

fn unode(s: &State, id: usize) -> Option<&UNode> {
    s.prog.nodes.iter().find(|n| n.id == id)
}

/// A node's size: wide enough for what is typed in it.
/// The size a sparkle or a super takes when made: one size for both (owner, 2026-10-14: "double clicking creates a
/// sparkle. Make it bigger. And right clicking makes a super. Make it same size as the sparkle. Uniform."). A super
/// only widens when what is typed in it needs the room.
const MADE: f64 = 88.0;

fn unode_size(text: &str) -> (f64, f64) {
    if text == SPARKLE {
        return (MADE, MADE);
    }
    if text.starts_with(MEMBER) {
        // a member keeps the size it had on its group's board
        return (220.0, 104.0);
    }
    let w = (text.chars().count() as f64 * 9.2 + 34.0).clamp(MADE, 320.0);
    (w, MADE)
}

// ---------------------------------------------------------------------------------------------- what a node does

#[derive(Clone, PartialEq)]
enum Kind {
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
    Open,
    /// words that are no operation: a prompt for Super AI (owner, 2026-10-14: "a super uses super text uses Super AI
    /// as a prompt and shows results in output if connected to another canvas")
    Ask(String),
    /// one of the site's own: a group's member (Leaderboards, piii VPN…) on its group's page, a π super like any other
    /// (owner, 2026-10-17: "everywhere is a canvas"). It passes on what arrives; a double click opens it.
    Member(String),
}

/// What a member super's text starts with (the rest is the member's name).
const MEMBER: &str = "⇢ ";

/// The member a super stands for, if it is one: (its group, its place in the group).
fn member_of(text: &str) -> Option<(usize, usize)> {
    let name = text.strip_prefix(MEMBER)?;
    GROUPS.iter().enumerate().find_map(|(gi, g)| g.members.iter().position(|m| m.0 == name).map(|m| (gi, m)))
}

fn literal(t: &str) -> Option<Value> {
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
        return json::parse(t);
    }
    let b = t.as_bytes();
    let numeric = b.iter().enumerate().all(|(i, c)| c.is_ascii_digit() || *c == b'.' || (i == 0 && (*c == b'-' || *c == b'+')))
        && b.iter().any(|c| c.is_ascii_digit());
    if numeric {
        return t.parse::<f64>().ok().map(Value::Num);
    }
    None
}

fn kind_of(text: &str) -> Kind {
    if let Some(name) = text.strip_prefix(MEMBER) {
        return Kind::Member(name.to_string());
    }
    let t = text.trim();
    let low = t.to_lowercase();
    let word = low.split_whitespace().next().unwrap_or("");
    let rest = t.split_once(char::is_whitespace).map(|x| x.1).unwrap_or("");
    match word {
        "" | "pick" | SPARKLE => return Kind::Pick,
        "reg" | "register" => return Kind::Reg(literal(rest).unwrap_or(Value::Num(0.0))),
        "stop" => return Kind::Stop,
        "show" | "display" => return Kind::Show,
        "list" => return Kind::List,
        "at" | "get" | "index" => return Kind::At,
        "set" => return Kind::Set,
        "len" | "length" => return Kind::Len,
        "push" | "append" => return Kind::Push,
        "open" | "go" => return Kind::Open,
        _ => {}
    }
    match low.as_str() {
        "pi" | "π" => return Kind::Const(Value::Num(core::f64::consts::PI)),
        "e" => return Kind::Const(Value::Num(core::f64::consts::E)),
        "phi" | "φ" => return Kind::Const(Value::Num(1.618_033_988_749_895)),
        "tau" | "τ" => return Kind::Const(Value::Num(core::f64::consts::TAU)),
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
        "sqrt" | "√" => "√",
        "sin" => "sin",
        "cos" => "cos",
        "tan" => "tan",
        "ln" | "log" => "ln",
        "exp" => "exp",
        "ceil" => "ceil",
        "sign" => "sign",
        "if" | "?" => "if",
        "random" | "rand" => "random",
        "now" | "time" => "now",
        "range" => "range",
        "sum" | "total" => "sum",
        "avg" | "mean" | "average" => "avg",
        "sort" => "sort",
        "reverse" => "reverse",
        "upper" => "upper",
        "lower" => "lower",
        "split" => "split",
        "text" | "str" => "text",
        "number" | "num" => "number",
        _ => return Kind::Ask(t.to_string()),
    };
    Kind::Op(op)
}

fn kind_name(k: &Kind) -> &'static str {
    match k {
        Kind::Pick => "pick",
        Kind::Const(Value::Arr(_)) => "list",
        Kind::Const(Value::Str(_)) => "text",
        Kind::Const(_) => "constant",
        Kind::Op(_) => "operation",
        Kind::Reg(_) => "register",
        Kind::Stop => "stop",
        Kind::Show => "show",
        Kind::List => "list",
        Kind::At => "at",
        Kind::Set => "set",
        Kind::Len => "len",
        Kind::Push => "push",
        Kind::Open => "open",
        Kind::Ask(_) => "Super AI",
        Kind::Member(_) => "member",
    }
}

fn vnum(v: &Value) -> Option<f64> {
    match v {
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        x => x.num(),
    }
}

fn vtruthy(v: &Value) -> bool {
    match v {
        Value::Str(s) => {
            let t = s.trim();
            !t.is_empty() && t != "false" && t != "0"
        }
        x => x.truthy(),
    }
}

fn floor_f(x: f64) -> f64 {
    let t = x as i64 as f64;
    if t > x { t - 1.0 } else { t }
}

/// A value as it is shown.
fn vtext(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::Bool(b) => (if *b { "true" } else { "false" }).to_string(),
        Value::Num(n) => {
            if n.is_nan() {
                "NaN".into()
            } else if n.is_infinite() {
                if *n > 0.0 { "∞".into() } else { "−∞".into() }
            } else if *n == (*n as i64) as f64 && n.abs() < 1e15 {
                format!("{}", *n as i64)
            } else {
                let s = format!("{:.6}", n);
                s.trim_end_matches('0').trim_end_matches('.').to_string()
            }
        }
        Value::Str(s) => s.clone(),
        Value::Arr(a) => format!("[{}]", a.iter().map(|x| if let Value::Str(s) = x { json::quote(s) } else { vtext(x) }).collect::<Vec<_>>().join(", ")),
        Value::Obj(_) => "{…}".into(),
    }
}

/// An operation on what arrives (all of it must have arrived: a node waits for its inputs, as in LabVIEW).
fn apply_op(op: &str, xs: &[Value]) -> Value {
    // the sources: they need nothing to arrive
    match op {
        "random" => {
            let r = rand_unit();
            return match xs.iter().find(|x| !x.is_null()).and_then(vnum) {
                Some(n) if n >= 1.0 => Value::Num(floor_f(r * floor_f(n))),
                _ => Value::Num(r),
            };
        }
        "now" => return Value::Num(host::now()),
        _ => {}
    }
    if xs.is_empty() || xs.iter().any(|x| x.is_null()) {
        return Value::Null;
    }
    // one list in
    let list = |v: &Value| -> Option<Vec<Value>> { if let Value::Arr(a) = v { Some(a.clone()) } else { None } };
    match op {
        "if" => return if xs.len() >= 3 { if vtruthy(&xs[0]) { xs[1].clone() } else { xs[2].clone() } } else { Value::Null },
        "range" => {
            let (a, b) = match (vnum(&xs[0]), xs.get(1).and_then(vnum)) {
                (Some(a), Some(b)) => (a, b),
                (Some(b), None) => (0.0, b),
                _ => return Value::Null,
            };
            let (a, b) = (floor_f(a), floor_f(b));
            if b - a > 100_000.0 {
                return Value::Null;
            }
            let mut v = Vec::new();
            let mut i = a;
            while i < b {
                v.push(Value::Num(i));
                i += 1.0;
            }
            return Value::Arr(v);
        }
        "sum" | "avg" => {
            let a = list(&xs[0]).unwrap_or_else(|| xs.to_vec());
            let n: Option<Vec<f64>> = a.iter().map(vnum).collect();
            return match n {
                Some(n) if !n.is_empty() || op == "sum" => {
                    let t: f64 = n.iter().sum();
                    Value::Num(if op == "avg" { t / n.len() as f64 } else { t })
                }
                _ => Value::Null,
            };
        }
        "sort" | "reverse" => {
            let Some(mut a) = list(&xs[0]) else {
                return match &xs[0] {
                    Value::Str(s) if op == "reverse" => Value::Str(s.chars().rev().collect()),
                    _ => Value::Null,
                };
            };
            if op == "reverse" {
                a.reverse();
            } else {
                a.sort_by(|x, y| match (vnum(x), vnum(y)) {
                    (Some(p), Some(q)) => p.partial_cmp(&q).unwrap_or(core::cmp::Ordering::Equal),
                    _ => vtext(x).cmp(&vtext(y)),
                });
            }
            return Value::Arr(a);
        }
        "upper" => return Value::Str(vtext(&xs[0]).to_uppercase()),
        "lower" => return Value::Str(vtext(&xs[0]).to_lowercase()),
        "text" => return Value::Str(vtext(&xs[0])),
        "number" => return vtext(&xs[0]).trim().parse::<f64>().map(Value::Num).unwrap_or(Value::Null),
        "split" => {
            let t = vtext(&xs[0]);
            let sep = xs.get(1).map(vtext).unwrap_or_default();
            let parts: Vec<Value> = if sep.is_empty() {
                t.split_whitespace().map(|p| Value::Str(p.to_string())).collect()
            } else {
                t.split(sep.as_str()).map(|p| Value::Str(p.to_string())).collect()
            };
            return Value::Arr(parts);
        }
        _ => {}
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
                    "round" => Value::Num(floor_f(n[0] + 0.5)),
                    "floor" => Value::Num(floor_f(n[0])),
                    "abs" => Value::Num(if n[0] < 0.0 { -n[0] } else { n[0] }),
                    "√" => Value::Num(if n[0] < 0.0 { f64::NAN } else { n[0].sqrt_c() }),
                    "sin" => Value::Num(libm_cos(n[0] - core::f64::consts::FRAC_PI_2)),
                    "cos" => Value::Num(libm_cos(n[0])),
                    "tan" => Value::Num(libm_cos(n[0] - core::f64::consts::FRAC_PI_2) / libm_cos(n[0])),
                    "ln" => Value::Num(if n[0] <= 0.0 { f64::NAN } else { ln_f(n[0]) }),
                    "exp" => Value::Num(exp_f(n[0])),
                    "ceil" => Value::Num(-floor_f(-n[0])),
                    "sign" => Value::Num(if n[0] > 0.0 { 1.0 } else if n[0] < 0.0 { -1.0 } else { 0.0 }),
                    _ => Value::Num(n[1..].iter().fold(n[0], |a, &b| match op {
                        "+" => a + b,
                        "−" => a - b,
                        "×" => a * b,
                        "÷" => a / b,
                        "%" => a - b * floor_f(a / b),
                        "^" => powf(a, b),
                        "min" => if b < a { b } else { a },
                        "max" => if b > a { b } else { a },
                        _ => a,
                    })),
                }
            }
        },
    }
}

/// A number in [0, 1), from a small generator seeded by the clock.
fn rand_unit() -> f64 {
    static SEED: Global<u64> = Global::new(0);
    let s = SEED.get();
    if *s == 0 {
        *s = (host::now() * 1000.0) as u64 | 1;
    }
    let mut x = *s;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *s = x;
    (x >> 11) as f64 / (1u64 << 53) as f64
}

fn powf(a: f64, b: f64) -> f64 {
    if b == (b as i64) as f64 && b.abs() < 4096.0 {
        let mut r = 1.0;
        for _ in 0..(b.abs() as i64) {
            r *= a;
        }
        return if b < 0.0 { 1.0 / r } else { r };
    }
    // a^b = e^(b ln a), for a > 0
    if a <= 0.0 {
        return f64::NAN;
    }
    exp_f(b * ln_f(a))
}

fn ln_f(x: f64) -> f64 {
    // ln x = 2 atanh((x-1)/(x+1)), after taking out powers of two
    let (mut m, mut e) = (x, 0i32);
    while m > 2.0 {
        m /= 2.0;
        e += 1;
    }
    while m < 1.0 {
        m *= 2.0;
        e -= 1;
    }
    let z = (m - 1.0) / (m + 1.0);
    let (mut sum, mut term, z2) = (0.0, z, z * z);
    let mut k = 1.0;
    while k < 60.0 {
        sum += term / k;
        term *= z2;
        k += 2.0;
    }
    2.0 * sum + e as f64 * core::f64::consts::LN_2
}

fn exp_f(x: f64) -> f64 {
    let n = floor_f(x / core::f64::consts::LN_2);
    let r = x - n * core::f64::consts::LN_2;
    let (mut sum, mut term) = (1.0, 1.0);
    for k in 1..30 {
        term *= r / k as f64;
        sum += term;
    }
    let mut p = 1.0;
    let mut i = n as i64;
    while i > 0 {
        p *= 2.0;
        i -= 1;
    }
    while i < 0 {
        p /= 2.0;
        i += 1;
    }
    sum * p
}

fn index_of(v: &Value, len: usize) -> Option<usize> {
    let i = vnum(v)?;
    if i < 0.0 || i != floor_f(i) || i as usize >= len { None } else { Some(i as usize) }
}

/// What a node gives for what arrived at its in.
fn eval_kind(k: &Kind, ins: &[Value]) -> Value {
    let first = || ins.iter().find(|v| !v.is_null()).cloned().unwrap_or(Value::Null);
    match k {
        Kind::Pick | Kind::Show | Kind::Open | Kind::Stop | Kind::Member(_) => first(),
        Kind::Const(v) => v.clone(),
        Kind::Op(op) => apply_op(op, ins),
        Kind::Reg(_) | Kind::Ask(_) => Value::Null,
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
                Some(n) if n >= 0.0 && n == floor_f(n) && n < 1e7 => {
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

/// What is sent to Super AI: the super's words, and what arrives at its in after them.
fn ai_prompt(text: &str, ins: &[Value]) -> String {
    let given: Vec<String> = ins.iter().filter(|v| !v.is_null()).map(vtext).collect();
    if given.is_empty() {
        text.to_string()
    } else {
        format!("{}\n\n{}", text, given.join("\n"))
    }
}

/// The engine the program's prompts go to: the first outside model ready on this site, else the lab's own SciM.
fn ai_engine(s: &State) -> Option<String> {
    let d = s.t2.ask_engines.data.as_ref()?;
    let ready: Vec<(String, String)> = d.get("engines").arr().iter().filter(|e| e.get("ready").truthy()).map(|e| (e.get("id").text(), e.get("kind").text())).collect();
    Some(ready.iter().find(|e| e.1 == "outside").or(ready.first()).map(|e| e.0.clone()).unwrap_or_else(|| "sim".to_string()))
}

/// After a render: send the prompts the last run left waiting (the engines list first, once).
fn prog_ai_flush() {
    let s = st();
    if s.prog.ai_want.is_empty() {
        return;
    }
    if s.t2.ask_engines.data.is_none() {
        if s.t2.ask_engines.err.is_some() {
            // no list of engines: the lab's own
        } else {
            if !s.t2.ask_engines.busy {
                s.t2.ask_engines.busy = true;
                request(Want::Tool(Tool::Ask, 0), "GET", "/api/super/engines", "", 0);
            }
            return;
        }
    }
    let engine = ai_engine(s).unwrap_or_else(|| "sim".to_string());
    let want = core::mem::take(&mut s.prog.ai_want);
    for q in want {
        // pi: asked from the canvas, so a request for a program is answered in the π language
        let body = format!("{{\"engine\":{},\"prompt\":{},\"pi\":true}}", json::quote(&engine), json::quote(&q));
        st().prog.ai_busy.push(q.clone());
        request(Want::ProgAi(q), "POST", "/api/super/one", &body, 0);
    }
    st().prog.status = "Asking Super AI…".to_string();
}

/// Super AI answered a prompt: keep it, and run the program again so the answer flows on.
fn prog_ai_apply(q: String, v: Value, err: Option<String>) {
    let s = st();
    s.prog.ai_busy.retain(|x| *x != q);
    let text = match err {
        Some(e) => format!("Super AI could not answer: {}", e),
        None if v.get("ok").truthy() => v.get("text").text(),
        None => format!("Super AI could not answer: {}", v.get("text").text()),
    };
    // a π program in the answer (Super AI knows the language: owner, 2026-10-17, "teach the superAI"): it is put on
    // the canvas beside the super that asked, wired, ready to run
    let mut text = text;
    if let Some(prog) = pi_block(&text) {
        // what flows on from the super that asked is the words around the program, not the program again
        if let (Some(a), Some(b)) = (text.find("```pi"), text.rfind("```")) {
            let words = format!("{} {}", text[..a].trim(), if b > a + 4 { text[b + 3..].trim() } else { "" });
            let words = words.trim().trim_end_matches(':').trim().to_string();
            text = if words.is_empty() { "A π program, put on the canvas.".to_string() } else { words };
        }
        let asker = s.prog.nodes.iter().find(|n| matches!(kind_of(&n.text), Kind::Ask(ref t) if q.starts_with(t.as_str()))).map(|n| n.id);
        if let Some(a) = asker {
            let n = pi_place(a, &prog);
            if n > 0 {
                st().prog.status = format!("Super AI wrote a π program: {} supers, beside the one that asked. Press ▶ to run it.", n);
            }
        }
    }
    let s = st();
    s.prog.ai.insert(q, text);
    if s.prog.ai_busy.is_empty() {
        prog_run(None);
    }
}

/// The π program in an answer: the lines of its ```pi block.
fn pi_block(text: &str) -> Option<String> {
    let start = text.find("```pi")?;
    let rest = &text[start + 5..];
    let rest = rest.strip_prefix('\n').unwrap_or(rest.trim_start_matches(|c: char| c != '\n').trim_start_matches('\n'));
    let end = rest.find("```").unwrap_or(rest.len());
    let body = rest[..end].trim();
    if body.is_empty() { None } else { Some(body.to_string()) }
}

/// A π program, as written (`name: text` and `a -> b [control|gate]`), put on the canvas to the right of `beside`:
/// in columns by what leads to what, wired. Returns how many supers it made.
fn pi_place(beside: usize, prog: &str) -> usize {
    let mut names: Vec<(String, String)> = Vec::new();
    let mut links: Vec<(usize, usize, Tip)> = Vec::new();
    for l in prog.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("//")) {
        if let Some((a, b)) = l.split_once("->") {
            let a = a.trim();
            let mut bw = b.split_whitespace();
            let b = bw.next().unwrap_or("");
            let tip = match bw.next().map(|t| t.to_lowercase()) {
                Some(t) if t == "control" => Tip::Control,
                Some(t) if t == "gate" => Tip::Gate,
                _ => Tip::In,
            };
            if let (Some(i), Some(j)) = (names.iter().position(|n| n.0 == a), names.iter().position(|n| n.0 == b)) {
                links.push((i, j, tip));
            }
        } else if let Some((n, t)) = l.split_once(':') {
            if names.len() < 60 && !names.iter().any(|x| x.0 == n.trim()) {
                names.push((n.trim().to_string(), t.trim().to_string()));
            }
        }
    }
    if names.is_empty() {
        return 0;
    }
    // columns: the longest way in; a register starts a column of its own (what loops back into it is not counted)
    let reg = |i: usize| matches!(kind_of(&names[i].1), Kind::Reg(_));
    let mut col = alloc::vec![0usize; names.len()];
    for _ in 0..names.len() {
        for &(a, b, _) in &links {
            if !reg(b) && col[b] < col[a] + 1 {
                col[b] = (col[a] + 1).min(names.len());
            }
        }
    }
    let Some(n0) = unode(st(), beside) else { return 0 };
    let (w0, _) = if n0.w > 0.0 { (n0.w, n0.h) } else { unode_size(&n0.text) };
    let (x0, y0) = (n0.x + w0 + 90.0, n0.y);
    let mut rows = alloc::vec![0usize; names.len() + 1];
    let mut ids = Vec::new();
    for (i, (_, t)) in names.iter().enumerate() {
        let c = col[i].min(names.len());
        let id = prog_add(t, x0 + c as f64 * 150.0, y0 + rows[c] as f64 * 120.0);
        rows[c] += 1;
        ids.push(id);
    }
    for (a, b, t) in links {
        st().wires.push((ids[a], ids[b], t));
    }
    wires_save();
    prog_save();
    ids.len()
}

fn node_kind(s: &State, id: usize) -> Option<Kind> {
    unode(s, id).map(|n| kind_of(&n.text))
}

fn is_reg(s: &State, id: usize) -> bool {
    matches!(node_kind(s, id), Some(Kind::Reg(_)))
}

// ---------------------------------------------------------------------------------------------- running

/// Every node of the program: the site's supers, the page's edges and the nodes typed in.
fn all_nodes(s: &State) -> Vec<usize> {
    let mut v: Vec<usize> = (0..NSUP).collect();
    v.push(PAGE_IN);
    v.push(PAGE_OUT);
    v.extend(s.prog.nodes.iter().map(|n| n.id));
    v
}

/// Where a node is on the canvas (for the order of its inputs).
fn node_y(g: &Geo, id: usize) -> (f64, f64) {
    match id {
        PAGE_IN | PAGE_OUT | FRAME => (0.0, 0.0),
        _ => {
            let r = rect(g, id);
            (r.1, r.0)
        }
    }
}

/// The data sources of a node's tip (the layout controls are not data).
fn data_in(s: &State, g: &Geo, id: usize, tip: Tip) -> Vec<usize> {
    let mut v: Vec<usize> = arriving(s, id, tip, 0).into_iter().filter(|a| !is_ctl_super(*a)).collect();
    v.sort_by(|a, b| {
        let (pa, pb) = (node_y(g, *a), node_y(g, *b));
        pa.partial_cmp(&pb).unwrap_or(core::cmp::Ordering::Equal)
    });
    v
}

/// The order nodes compute in: after everything they need, a register's out counting as known from the start.
fn compute_order(s: &State, g: &Geo) -> (Vec<usize>, Vec<usize>) {
    let nodes = all_nodes(s);
    let deps: Vec<(usize, Vec<usize>)> = nodes
        .iter()
        .map(|&n| {
            let mut d: Vec<usize> = Vec::new();
            for t in [Tip::In, Tip::Control, Tip::Gate] {
                d.extend(data_in(s, g, n, t).into_iter().filter(|a| !is_reg(s, *a) && *a != n));
            }
            (n, d)
        })
        .collect();
    let mut done: Vec<usize> = Vec::new();
    let mut left: Vec<&(usize, Vec<usize>)> = deps.iter().collect();
    loop {
        let before = left.len();
        let mut i = 0;
        while i < left.len() {
            if left[i].1.iter().all(|d| done.contains(d) || !nodes.contains(d)) {
                done.push(left[i].0);
                left.remove(i);
            } else {
                i += 1;
            }
        }
        if left.is_empty() || left.len() == before {
            break;
        }
    }
    let stuck = left.iter().map(|x| x.0).collect();
    (done, stuck)
}

/// An operation on its own (nothing wired into its in): wired to another node's control or gate, by a wire or a pass,
/// it is not a value but the operation that node does with what arrives (owner, 2026-10-14: 4 and 3 into a sparkle
/// whose gate is joined to a "+" give 7).
fn lone_op(s: &State, id: usize) -> Option<&'static str> {
    if !is_unode(id) || s.wires.iter().any(|w| w.1 == id && w.2 == Tip::In) {
        return None;
    }
    match node_kind(s, id) {
        Some(Kind::Op(op)) => Some(op),
        _ => None,
    }
}

/// The operation a node is given through its control or gate, if one is.
fn operator_of(s: &State, id: usize) -> Option<&'static str> {
    let side = |t: Tip| matches!(t, Tip::Control | Tip::Gate);
    let mut cands: Vec<usize> = s.wires.iter().filter(|w| w.1 == id && side(w.2)).map(|w| w.0).collect();
    for p in &s.passes {
        if p.2 == id && side(p.3) {
            cands.push(p.0);
        }
        if p.0 == id && side(p.1) {
            cands.push(p.2);
        }
    }
    cands.into_iter().filter(|c| *c != id).find_map(|c| lone_op(s, c))
}

fn reg_initial(s: &State, id: usize) -> Value {
    match node_kind(s, id) {
        Some(Kind::Reg(v)) => v,
        _ => Value::Null,
    }
}

/// One step: every node computes once; then every register takes what arrived at it. Answers whether a stop fired.
fn prog_tick(order: &[usize], g: &Geo, evals: &mut u64) -> bool {
    let s = st();
    let mut vals: BTreeMap<usize, Value> = BTreeMap::new();
    let regs: Vec<usize> = s.prog.nodes.iter().filter(|n| matches!(kind_of(&n.text), Kind::Reg(_))).map(|n| n.id).collect();
    for r in &regs {
        let v = s.prog.regs.get(r).cloned().unwrap_or_else(|| reg_initial(s, *r));
        s.prog.regs.insert(*r, v.clone());
        vals.insert(*r, v);
    }
    let mut stop = false;
    // whether a node may run: its control has a value, its gate is true (when they are wired)
    // an operation joined to a control or gate is what the node does, not a value it waits for
    let opnodes: Vec<usize> = s.prog.nodes.iter().map(|n| n.id).filter(|i| lone_op(s, *i).is_some()).collect();
    let allowed = |vals: &BTreeMap<usize, Value>, id: usize| -> bool {
        let ctl: Vec<usize> = data_in(s, g, id, Tip::Control).into_iter().filter(|c| !opnodes.contains(c)).collect();
        if !ctl.is_empty() && ctl.iter().all(|c| vals.get(c).map(|v| v.is_null()).unwrap_or(true)) {
            return false;
        }
        let gate: Vec<usize> = data_in(s, g, id, Tip::Gate).into_iter().filter(|c| !opnodes.contains(c)).collect();
        if !gate.is_empty() && !gate.iter().all(|c| vals.get(c).map(vtruthy).unwrap_or(false)) {
            return false;
        }
        true
    };
    for &id in order {
        if regs.contains(&id) {
            continue;
        }
        *evals += 1;
        let ins: Vec<Value> = data_in(s, g, id, Tip::In).iter().map(|a| vals.get(a).cloned().unwrap_or(Value::Null)).collect();
        let v = if !allowed(&vals, id) {
            Value::Null
        } else if is_unode(id) {
            let k = node_kind(s, id).unwrap_or(Kind::Pick);
            // a sparkle (or an empty super) given an operation does it on what arrives, in order down the canvas
            let v = match (&k, operator_of(s, id)) {
                (Kind::Pick, Some(op)) => apply_op(op, &ins.iter().filter(|v| !v.is_null()).cloned().collect::<Vec<_>>()),
                // a prompt: Super AI's answer once it has come, asked only when the out is wired to something
                (Kind::Ask(t), _) => {
                    let s = st();
                    if s.wires.iter().any(|w| w.0 == id) || s.passes.iter().any(|p| p.0 == id || p.2 == id) {
                        let q = ai_prompt(t, &ins);
                        match s.prog.ai.get(&q) {
                            Some(a) => Value::Str(a.clone()),
                            None => {
                                if !s.prog.ai_want.contains(&q) && !s.prog.ai_busy.contains(&q) {
                                    s.prog.ai_want.push(q);
                                }
                                Value::Null
                            }
                        }
                    } else {
                        Value::Null
                    }
                }
                _ => eval_kind(&k, &ins),
            };
            if k == Kind::Stop && vtruthy(&v) {
                stop = true;
            }
            v
        } else {
            match id {
                S_RUN => Value::Bool(true),
                PAGE_IN | S_STEP | S_CLEAR | S_TITLE => Value::Null,
                _ if is_ctl_super(id) => Value::Null,
                _ => ins.into_iter().find(|v| !v.is_null()).unwrap_or(Value::Null),
            }
        };
        vals.insert(id, v);
    }
    // the registers take their new values (a false gate, or a control with nothing, keeps what they hold)
    let mut next: Vec<(usize, Value)> = Vec::new();
    for r in &regs {
        if !allowed(&vals, *r) {
            continue;
        }
        let ins = data_in(s, g, *r, Tip::In);
        if let Some(v) = ins.iter().map(|a| vals.get(a).cloned().unwrap_or(Value::Null)).find(|v| !v.is_null()) {
            next.push((*r, v));
        }
    }
    let s = st();
    for (r, v) in next {
        s.prog.regs.insert(r, v);
    }
    s.prog.vals = vals;
    s.prog.steps += 1;
    stop
}

fn prog_run(steps_wanted: Option<u64>) {
    let s = st();
    let g = geo(s);
    let (order, stuck) = compute_order(s, &g);
    if !stuck.is_empty() {
        s.prog.status = format!("Not run: a loop with no register through {}. Put a reg in it.", stuck.iter().map(|i| node_label(s, *i)).collect::<Vec<_>>().join(", "));
        return;
    }
    let has_regs = s.prog.nodes.iter().any(|n| matches!(kind_of(&n.text), Kind::Reg(_)));
    let mut evals = 0u64;
    let start = s.prog.steps;
    let why;
    match steps_wanted {
        Some(n) => {
            let mut stopped = false;
            for _ in 0..n {
                if prog_tick(&order, &g, &mut evals) {
                    stopped = true;
                    break;
                }
            }
            why = if stopped { "stopped by a stop node" } else { "one step" };
        }
        None => {
            if !has_regs {
                prog_tick(&order, &g, &mut evals);
                why = "done (no register: one step)";
            } else {
                let mut w = "after 100 000 steps (the limit)";
                loop {
                    let before: Vec<(usize, Value)> = st().prog.regs.iter().map(|(k, v)| (*k, v.clone())).collect();
                    if prog_tick(&order, &g, &mut evals) {
                        w = "stopped by a stop node";
                        break;
                    }
                    let after: Vec<(usize, Value)> = st().prog.regs.iter().map(|(k, v)| (*k, v.clone())).collect();
                    if before == after && st().prog.steps - start > 1 {
                        w = "settled: the registers stopped changing";
                        break;
                    }
                    if st().prog.steps - start >= MAX_STEPS || evals >= MAX_EVALS {
                        break;
                    }
                }
                why = w;
            }
            // what open nodes received, opened once the run ends
            let s = st();
            let opens: Vec<String> = s
                .prog
                .nodes
                .iter()
                .filter(|n| kind_of(&n.text) == Kind::Open)
                .filter_map(|n| s.prog.vals.get(&n.id).map(vtext))
                .filter(|t| !t.is_empty())
                .collect();
            for o in opens {
                if o.starts_with('#') {
                    host::go(&o);
                } else if o.starts_with("http") || o.starts_with('/') {
                    host::open(&o);
                }
            }
        }
    }
    let s = st();
    let n = s.prog.steps - start;
    s.prog.status = format!("{} {} · {} · {} in all", n, if n == 1 { "step" } else { "steps" }, why, s.prog.steps);
}

fn prog_clear() {
    let s = st();
    s.prog.regs.clear();
    s.prog.vals.clear();
    s.prog.steps = 0;
    s.prog.status = "Cleared: registers back to where they start.".to_string();
}

fn node_label(s: &State, id: usize) -> String {
    match unode(s, id) {
        Some(_) => name_of(id),
        None => name_of(id).to_string(),
    }
}

// ---------------------------------------------------------------------------------------------- editing

/// Run the program a moment after it last changed (typing a word sends nothing until it rests).
fn prog_autorun() {
    let s = st();
    if s.autorun_at == 0.0 {
        host::timer(450, T_AUTORUN);
    }
    s.autorun_at = host::now();
}

fn prog_save() {
    prog_autorun();
    undo_mark();
    let s = st();
    let mut out = String::from("v1\n");
    for n in &s.prog.nodes {
        out.push_str(&format!("{}\t{:.1}\t{:.1}\t{}\n", n.id, n.x, n.y, n.text.replace(['\t', '\n'], " ")));
    }
    // sizes given by resizing, kept beside (a v1 reader ignores them)
    let sizes: Vec<String> = s.prog.nodes.iter().filter(|n| n.w > 0.0).map(|n| format!("{}:{:.1}:{:.1}", n.id, n.w, n.h)).collect();
    host::store_set(&ckey("piii:program-sizes"), &sizes.join(","));
    host::store_set(&ckey("piii:program"), &out);
    wires_save();
}

/// The program from this browser; answers false when there is none saved yet.
fn prog_load() -> bool {
    let s = st();
    let Some(v) = host::store_get(&ckey("piii:program")) else { return false };
    let mut lines = v.lines();
    if lines.next() != Some("v1") {
        return false;
    }
    s.prog.nodes.clear();
    let sizes: Vec<(usize, f64, f64)> = host::store_get(&ckey("piii:program-sizes"))
        .map(|v| v.split(',').filter_map(|e| {
            let f: Vec<&str> = e.split(':').collect();
            Some((f.first()?.parse().ok()?, f.get(1)?.parse().ok()?, f.get(2)?.parse().ok()?))
        }).collect())
        .unwrap_or_default();
    let _ = &sizes;
    for l in lines {
        let f: Vec<&str> = l.splitn(4, '\t').collect();
        if let [id, x, y, t] = f.as_slice() {
            if let (Ok(id), Ok(x), Ok(y)) = (id.parse::<usize>(), x.parse::<f64>(), y.parse::<f64>()) {
                if id >= UBASE {
                    let (w, h) = sizes.iter().find(|q| q.0 == id).map(|q| (q.1, q.2)).unwrap_or((0.0, 0.0));
                    s.prog.nodes.push(UNode { id, x, y, text: t.to_string(), w, h });
                }
            }
        }
    }
    s.prog.next = s.prog.nodes.iter().map(|n| n.id + 1).max().unwrap_or(UBASE).max(UBASE);
    true
}

fn prog_add(text: &str, x: f64, y: f64) -> usize {
    let s = st();
    if s.prog.next < UBASE {
        s.prog.next = UBASE;
    }
    let id = s.prog.next;
    s.prog.next += 1;
    s.prog.nodes.push(UNode { id, x, y, text: text.to_string(), w: 0.0, h: 0.0 });
    id
}

fn prog_remove(id: usize) {
    let s = st();
    s.prog.nodes.retain(|n| n.id != id);
    s.wires.retain(|w| w.0 != id && w.1 != id);
    s.passes.retain(|p| p.0 != id && p.2 != id);
    s.prog.regs.remove(&id);
    s.prog.vals.remove(&id);
    if s.prog.sel == Some(id) {
        s.prog.sel = None;
    }
    for g in s.groups.iter_mut() {
        g.retain(|x| *x != id);
    }
    s.groups.retain(|g| g.len() >= 2);
    groups_save();
    s.locked.retain(|x| *x != id);
    locked_save();
    prog_save();
}

/// A free place for a new node in the Program super.
fn prog_free_spot() -> (f64, f64) {
    let s = st();
    let g = geo(s);
    let (_, _, pw, ph) = rect(&g, S_PROG);
    let cols = ((pw - 20.0) / 150.0).max(1.0) as usize;
    let rows = ((ph - 80.0) / 82.0).max(1.0) as usize;
    for i in 0..cols * rows {
        let (x, y) = (16.0 + (i % cols) as f64 * 150.0, 62.0 + (i / cols) as f64 * 82.0);
        let busy = s.prog.nodes.iter().any(|n| {
            let (w, h) = unode_size(&n.text);
            x < n.x + w + 12.0 && n.x < x + 130.0 && y < n.y + h + 12.0 && n.y < y + 58.0
        });
        if !busy {
            return (x, y);
        }
    }
    (16.0 + (s.prog.nodes.len() % 4) as f64 * 24.0, 62.0 + (s.prog.nodes.len() % 4) as f64 * 24.0)
}

// actions (Msg::T(Tool::Prog, action | id << 4, value))
const P_TEXT: u16 = 1;
const P_ADD: u16 = 2;
const P_EXAMPLE: u16 = 3;
const P_SEL: u16 = 4;
const P_DEL: u16 = 5;
const P_OPEN: u16 = 6;
/// the AI language: what is typed to Super AI at the top of the zoom, and sending it
const P_AI_DRAFT: u16 = 7;
const P_AI_SEND: u16 = 8;
const P_LADDER: u16 = 9;

fn prog_update(a: u16, v: String) {
    let s = st();
    let id = UBASE + (a >> 4) as usize;
    match a & 15 {
        P_TEXT => {
            if let Some(n) = s.prog.nodes.iter_mut().find(|n| n.id == id) {
                n.text = v;
                s.prog.regs.remove(&id);
            }
            prog_save();
        }
        P_ADD => {
            if let Some((_, t)) = PALETTE.get(v.parse::<usize>().unwrap_or(0)) {
                let (x, y) = prog_free_spot();
                let id = prog_add(t, x, y);
                s.prog.sel = Some(id);
                prog_save();
            }
        }
        P_EXAMPLE => example_load(v.parse::<usize>().unwrap_or(0)),
        P_AI_DRAFT => s.ai_draft = v,
        // a rung of the ladder: the top is Super AI; the site's places are the home canvas
        P_LADDER => match (a >> 4) as usize {
            0 => {
                s.ai_level = true;
                if s.page != Page::Home {
                    host::go("#/");
                }
            }
            1 => {
                s.ai_level = false;
                host::go("#/");
            }
            _ => s.ai_level = false,
        },
        P_AI_SEND => {
            let q = s.ai_draft.trim().to_string();
            if q.is_empty() {
                return;
            }
            // what is said becomes a super of words wired to a show, in the middle of the canvas: Super AI answers
            // there, and a π program it writes lands beside it, running
            s.ai_draft.clear();
            s.ai_level = false;
            s.zoom_nav_at = host::now();
            // back down at the usual size, so what is made is readable
            s.zoom = 1.0;
            layout_save();
            let (x, y) = screen_to_node(host::vw() / 2.0 - 160.0, host::vh() / 2.0 - 44.0);
            let ask = prog_add(&q, x, y);
            let (w, _) = unode_size(&q);
            let show = prog_add("show", x + w + 60.0, y);
            st().wires.push((ask, show, Tip::In));
            st().prog.sel = Some(ask);
            wires_save();
            prog_save();
        }
        P_SEL => s.prog.sel = Some(id),
        P_DEL => prog_remove(id),
        P_OPEN => {
            if let Some(t) = unode(s, id).map(|n| n.text.clone()) {
                open_place(&t);
            }
        }
        _ => {}
    }
}

/// The palette: what each chip adds.
const PALETTE: [(&str, &str); 28] = [
    ("1", "1"),
    ("text", "\"words\""),
    ("+", "+"),
    ("−", "−"),
    ("×", "×"),
    ("÷", "÷"),
    ("%", "%"),
    ("<", "<"),
    ("=", "="),
    ("≥", "≥"),
    ("and", "and"),
    ("not", "not"),
    ("reg", "reg 0"),
    ("pick", "pick"),
    ("stop", "stop"),
    ("show", "show"),
    ("[ ]", "[1, 2, 3]"),
    ("at", "at"),
    ("set", "set"),
    ("push", "push"),
    ("if", "if"),
    ("π", "π"),
    ("√", "√"),
    ("sin", "sin"),
    ("random", "random"),
    ("range", "range"),
    ("sum", "sum"),
    ("split", "split"),
];

// ---------------------------------------------------------------------------------------------- examples

/// (name, what it shows, nodes as (text, x, y), wires as (from, to, tip) by node number)
type Example = (&'static str, &'static str, &'static [(&'static str, f64, f64)], &'static [(usize, usize, u8)]);

const EXAMPLES: [Example; 5] = [
    (
        "Count to 10",
        "A register counts up by one each step; the run stops when it reaches 10.",
        &[("reg 0", 24.0, 70.0), ("1", 24.0, 180.0), ("+", 200.0, 120.0), ("10", 200.0, 230.0), ("≥", 370.0, 170.0), ("stop", 530.0, 170.0)],
        &[(0, 2, 0), (1, 2, 0), (2, 0, 0), (2, 4, 0), (3, 4, 0), (4, 5, 0)],
    ),
    (
        "Factorial",
        "10! = 3 628 800: one register counts, the other multiplies.",
        &[("reg 1", 24.0, 70.0), ("1", 24.0, 160.0), ("reg 1", 24.0, 250.0), ("+", 200.0, 100.0), ("×", 200.0, 230.0), ("10", 200.0, 330.0), (">", 370.0, 200.0), ("stop", 530.0, 200.0)],
        &[(0, 3, 0), (1, 3, 0), (3, 0, 0), (0, 4, 0), (2, 4, 0), (4, 2, 0), (3, 6, 0), (5, 6, 0), (6, 7, 0)],
    ),
    (
        "Fibonacci",
        "Two registers pass the sum along; stops once it passes 1000.",
        &[("reg 0", 24.0, 70.0), ("reg 1", 24.0, 190.0), ("+", 200.0, 130.0), ("1000", 200.0, 250.0), ("≥", 370.0, 190.0), ("stop", 530.0, 190.0)],
        &[(0, 2, 0), (1, 2, 0), (2, 1, 0), (1, 0, 0), (2, 4, 0), (3, 4, 0), (4, 5, 0)],
    ),
    (
        "Greatest common divisor",
        "Euclid on 1071 and 462: the first register ends at 21.",
        &[("reg 1071", 24.0, 70.0), ("reg 462", 24.0, 180.0), ("%", 220.0, 120.0), ("0", 220.0, 240.0), ("=", 390.0, 180.0), ("stop", 540.0, 180.0)],
        &[(0, 2, 0), (1, 2, 0), (2, 1, 0), (1, 0, 0), (2, 4, 0), (3, 4, 0), (4, 5, 0)],
    ),
    (
        "Turing machine",
        "A two-state busy beaver: a tape (a list), a head and a state in registers, the rules read with at. It writes four 1s and halts.",
        &[
            ("reg [0,0,0,0,0,0]", 16.0, 60.0),   // 0 tape
            ("reg 3", 16.0, 140.0),              // 1 head
            ("reg 0", 16.0, 220.0),              // 2 state
            ("2", 16.0, 300.0),                  // 3
            ("[1,1,1,1]", 16.0, 380.0),          // 4 write
            ("[1,-1,-1,1]", 16.0, 460.0),        // 5 move
            ("[1,1,0,2]", 16.0, 540.0),          // 6 next state
            ("at", 230.0, 100.0),                // 7 symbol = tape[head]
            ("×", 230.0, 260.0),                 // 8 state × 2
            ("+", 230.0, 610.0),                 // 9 rule = state×2 + symbol
            ("at", 390.0, 400.0),                // 10 write = W[rule]
            ("at", 390.0, 480.0),                // 11 move = M[rule]
            ("at", 390.0, 560.0),                // 12 next = N[rule]
            ("set", 540.0, 60.0),                // 13 tape' = set(tape, head, write)
            ("+", 540.0, 180.0),                 // 14 head' = head + move
            ("2", 390.0, 650.0),                 // 15 halt state
            ("=", 540.0, 600.0),                 // 16 next = halt
            ("stop", 540.0, 680.0),              // 17
        ],
        &[
            (0, 7, 0), (1, 7, 0),
            (2, 8, 0), (3, 8, 0),
            (7, 9, 0), (8, 9, 0),
            (4, 10, 0), (9, 10, 0),
            (5, 11, 0), (9, 11, 0),
            (6, 12, 0), (9, 12, 0),
            (0, 13, 0), (1, 13, 0), (10, 13, 0),
            (1, 14, 0), (11, 14, 0),
            (13, 0, 0), (14, 1, 0), (12, 2, 0),
            (12, 16, 0), (15, 16, 0), (16, 17, 0),
        ],
    ),
];

fn example_load(i: usize) {
    let Some((name, _, nodes, wires)) = EXAMPLES.get(i) else { return };
    let s = st();
    // the program's own nodes go; the site's supers and their wires stay
    let old: Vec<usize> = s.prog.nodes.iter().map(|n| n.id).collect();
    s.wires.retain(|w| !old.contains(&w.0) && !old.contains(&w.1));
    s.passes.retain(|p| !old.contains(&p.0) && !old.contains(&p.2));
    s.prog.nodes.clear();
    s.prog.regs.clear();
    s.prog.vals.clear();
    s.prog.steps = 0;
    s.prog.sel = None;
    let ids: Vec<usize> = nodes.iter().map(|(t, x, y)| prog_add(t, *x, *y)).collect();
    for (a, b, t) in wires.iter() {
        if let (Some(a), Some(b), Some(t)) = (ids.get(*a), ids.get(*b), Tip::of(*t)) {
            st().wires.push((*a, *b, t));
        }
    }
    st().prog.status = format!("{}: press ▶ to run it, ⏹ to clear.", name);
    prog_save();
}

// ---------------------------------------------------------------------------------------------- the view

/// What a sparkle is: a junction (a double click on the canvas makes one). It passes on what arrives.
const SPARKLE: &str = "✦";

/// A double click on the bare canvas: left, a sparkle; right, a super (owner, 2026-10-14), where it was clicked.
fn canvas_add(sup: bool, at: &str) {
    let s = st();
    let mut it = at.split(',');
    let (Some(Ok(x)), Some(Ok(y))) = (it.next().map(|v| v.parse::<f64>()), it.next().map(|v| v.parse::<f64>())) else { return };
    let g = geo(s);
    let p = ((x - g.ox) / g.k, (y - g.oy) / g.k);
    let (px, py, _, _) = rect(&g, S_PROG);
    let text = if sup { "" } else { SPARKLE };
    let (w, h) = unode_size(text);
    let id = prog_add(text, p.0 - px - w / 2.0, p.1 - py - h / 2.0);
    // the new one is selected, locked like every super; whatever was unlocked before locks again
    relock_except(None, None, false);
    st().sup_pick = None;
    st().prog.sel = Some(id);
    prog_save();
    note(if sup {
        "A super: type in it what it does (3, +, reg 0, stop…)".to_string()
    } else {
        "A sparkle: a junction that passes on what arrives".to_string()
    });
}

fn sparkle_view(s: &State, n: &UNode, r: Rect, mini: bool) -> N {
    let v = vtext(s.prog.vals.get(&n.id).unwrap_or(&Value::Null));
    el("div")
        .cls("sx unode sparkle")
        .cls_if(s.prog.sel == Some(n.id), "sel").cls_if(!mini && locked(s, n.id), "is-locked")
        .attr("data-s", format!("{}", n.id))
        .attr("data-solid", "1")
        .attr("title", if v.is_empty() { "A sparkle: a junction".to_string() } else { format!("A sparkle: {}", v) })
        .style(format!("left:{:.1}px;top:{:.1}px;width:{:.1}px;height:{:.1}px", r.0, r.1, r.2, r.3))
        .on_if(!mini, "pdown", Msg::PDown(n.id, String::new()))
        .kid(
            el("svg:svg")
                // the sparkle fills its box, point to point, like a super fills its own: the two start the same size
                // (owner, 2026-10-14: "super and sparkle are same size in the beginning")
                .attr("viewBox", "-44 -44 88 88")
                .attr("width", "100%")
                .attr("height", "100%")
                .attr("aria-hidden", "true")
                .kid(el("svg:path").attr("d", star(0.0, 0.0, 43.0))),
        )
        // what passes through, short: the whole of it in its title
        .kid_if(!v.is_empty(), || el("span").cls("sp-val").attr("title", v.clone()).text(if v.chars().count() > 140 { v.chars().take(139).collect::<String>() + "…" } else { v.clone() }).into())
        .kid_if(!mini && s.prog.sel == Some(n.id) && !locked(s, n.id), || grip())
        .into()
}

/// The corner of a selected, unlocked super or sparkle: dragged, it resizes, with a finger too (a phone has no Shift
/// and no middle button).
fn grip() -> N {
    el("span").cls("u-grip").attr("data-resize", "1").attr("title", "Drag to resize").attr("aria-hidden", "true").into()
}

/// Grown half as big again as it was made (by area): a super is a canvas, an empty one to draw in (owner, 2026-10-14:
/// "if a super gets bigger than 50% of its size, it becomes a canvas, empty canvas, which you can draw again inside it").
fn unode_is_canvas(n: &UNode) -> bool {
    let (iw, ih) = unode_size(&n.text);
    n.text != SPARKLE && n.w > 0.0 && n.w * n.h >= 1.5 * iw * ih
}

/// The supers and sparkles drawn inside a canvas super: the ones lying wholly within it.
fn unode_inside(s: &State, id: usize) -> Vec<usize> {
    let Some(p) = unode(s, id) else { return Vec::new() };
    if !unode_is_canvas(p) {
        return Vec::new();
    }
    let size = |n: &UNode| if n.w > 0.0 { (n.w, n.h) } else { unode_size(&n.text) };
    let (pw, ph) = size(p);
    s.prog
        .nodes
        .iter()
        .filter(|n| n.id != id)
        .filter(|n| {
            let (w, h) = size(n);
            w * h < pw * ph && n.x >= p.x && n.y >= p.y && n.x + w <= p.x + pw && n.y + h <= p.y + ph
        })
        .map(|n| n.id)
        .collect()
}

/// The superellipse |x|^π + |y|^π = 1 as an SVG path in a −1…1 box, stretched over a super by its viewBox (owner,
/// 2026-10-17: "improve the super"): the whole outline is the π shape, not a box with rounded corners.
fn se_path() -> String {
    let n = core::f64::consts::PI;
    let mut d = String::new();
    for i in 0..96 {
        let t = i as f64 / 96.0 * core::f64::consts::TAU;
        let (c, sn) = (libm_cos(t), libm_cos(t - core::f64::consts::FRAC_PI_2));
        let x = c.signum() * powf(c.abs(), 2.0 / n);
        let y = sn.signum() * powf(sn.abs(), 2.0 / n);
        d.push_str(&format!("{}{:.4},{:.4}", if i == 0 { "M" } else { "L" }, x, y));
    }
    d.push('Z');
    d
}

/// A super's outline, behind what is in it.
fn se_shape() -> N {
    el("svg:svg")
        .cls("u-shape")
        .attr("viewBox", "-1.02 -1.02 2.04 2.04")
        .attr("preserveAspectRatio", "none")
        .attr("aria-hidden", "true")
        .kid(el("svg:path").attr("d", se_path()))
        .into()
}

/// A line drawing, as the sidebar drew its icons.
fn line_icon(d: &[&str]) -> N {
    el("svg:svg")
        .attr("viewBox", "0 0 24 24")
        .attr("width", "20")
        .attr("height", "20")
        .attr("fill", "none")
        .attr("stroke", "currentColor")
        .attr("stroke-width", "1.8")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("aria-hidden", "true")
        .kids(d.iter().map(|x| -> N { el("svg:path").attr("d", *x).into() }))
        .into()
}

/// A place's icon, as it was in the sidebar (owner, 2026-10-17: "restore the icons"); a group's member, its mark.
fn place_mark(name: &str) -> N {
    match WORLD.iter().position(|w| *w == name) {
        Some(i) if i < GROUPS.len() => mark_of(Page::Group(i as u8), name),
        Some(6) => mark_of(Page::Map, name),
        Some(7) => line_icon(&["M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z", "M12 10.5v3.5"]),
        Some(8) => line_icon(&["M8 7l-5 5 5 5", "M16 7l5 5-5 5"]),
        _ => ai_mark(name),
    }
}

fn member_view(s: &State, n: &UNode, r: Rect, mini: bool, name: &str, kz: f64) -> N {
    // far out a place is a speck, then a mark; it reads as itself once it is big enough (owner, 2026-10-17: "the web
    // starts as an empty canvas. We have to zoom in to find out")
    let px = r.2.min(r.3) * kz;
    let v = vtext(s.prog.vals.get(&n.id).unwrap_or(&Value::Null));
    let pien = st().t2.pien.pick.as_deref() == Some(name);
    el("div")
        .cls("sx unode k-member")
        .cls_if(pien, "pien")
        .cls_if(s.prog.sel == Some(n.id), "sel").cls_if(!mini && locked(s, n.id), "is-locked")
        .attr("data-s", format!("{}", n.id))
        .attr("data-solid", "1")
        .attr("title", format!("{}: double click to open it", name))
        .attr("tabindex", "0")
        .attr("role", "link")
        .attr("aria-label", format!("Open {}", name))
        .style(format!("left:{:.1}px;top:{:.1}px;width:{:.1}px;height:{:.1}px", r.0, r.1, r.2, r.3))
        .on_if(!mini, "pdown", Msg::PDown(n.id, String::new()))
        .on("enter", Msg::TV(Tool::Prog, P_OPEN | (((n.id - UBASE) as u16) << 4)))
        .cls_if(px < 8.0, "u-speck")
        .cls_if((8.0..30.0).contains(&px), "u-iconic")
        .kid(se_shape())
        // the site's places have line drawings; a group's member is its name (its initials when small)
        .kid_if(px >= 30.0 && WORLD.contains(&name), || el("span").cls("u-mark").kid(place_mark(name)).into())
        .kid_if(px >= 30.0, || el("span").cls("tag").text(name.to_string()).into())
        .kid_if((8.0..30.0).contains(&px), || el("span").cls("u-icon").kid(place_mark(name)).into())
        .kid_if(px >= 30.0 && !v.is_empty(), || el("span").cls("u-val").text(v.clone()).into())
        .kid_if(!mini && s.prog.sel == Some(n.id) && !locked(s, n.id), || grip())
        .into()
}

// ---------------------------------------------------------------------------------------------- the zoom's ladder

/// Where the view is on the ladder, from the top: 0 Super AI, 1 the site's places, 2 graphical, then the depths of the
/// super in the middle of the window.
fn ladder_at(s: &State) -> usize {
    if s.ai_level {
        return 0;
    }
    let g = geo(s);
    let (cx, cy) = (host::vw() / 2.0, host::vh() / 2.0);
    let mut best: Option<(f64, u8)> = None;
    for n in s.prog.nodes.iter().filter(|n| n.text != SPARKLE && !n.text.trim().is_empty() && !n.text.starts_with(MEMBER)) {
        let (x, y, w, h) = rect(&g, n.id);
        let (sx, sy, sw, sh) = (g.ox + x * g.k, g.oy + y * g.k, w * g.k, h * g.k);
        let d = ((sx + sw / 2.0 - cx).abs() + (sy + sh / 2.0 - cy).abs()) / sw.max(1.0);
        let depth = zoom_depth(sw.min(sh));
        if best.map(|b| d < b.0).unwrap_or(true) && d < 1.5 {
            best = Some((d, depth));
        }
    }
    // a page's own words count too: assembly, hexadecimal, bits
    let words = if s.page == Page::Home { 0 } else { word_level(s) as usize };
    let canvas = match best {
        Some((_, dp)) if dp >= 2 => 1 + dp as usize,
        _ => if s.page == Page::Home { 1 } else { 2 },
    };
    if words > 0 { canvas.max(4 + words) } else { canvas }
}

const LADDER: [&str; 8] = ["Super AI", "the site", "graphical", "high language", "BASIC", "assembly", "hexadecimal", "0 and 1"];

/// The ladder, at the window's right edge: where the zoom is, from the AI language down to bare metal.
fn ladder_view(s: &State) -> N {
    let at = ladder_at(s);
    el("nav")
        .cls("ladder")
        .attr("aria-label", "How far in you are")
        .attr("data-stop", "1")
        .kids(LADDER.iter().enumerate().map(|(i, l)| -> N {
            el("button")
                .attr("type", "button")
                .cls("rung")
                .cls_if(i == at, "at")
                .attr("title", match i {
                    0 => "Zoomed all the way out: tell Super AI what to make",
                    1 => "The site's places: zoom into one to open it",
                    2 => "Supers and wires",
                    _ => "Zoom into a super to read it at this depth",
                })
                .on("click", Msg::TV(Tool::Prog, P_LADDER | ((i as u16) << 4)))
                .text(*l)
                .into()
        }))
        .into()
}

/// The top of the zoom: the AI language.
fn ai_level_view(s: &State) -> N {
    let places: Vec<String> = s.prog.nodes.iter().filter_map(|n| n.text.strip_prefix(MEMBER).map(|x| x.to_string())).collect();
    let mine = s.prog.nodes.iter().filter(|n| !n.text.starts_with(MEMBER)).count();
    el("div")
        .cls("ai-level")
        .attr("data-stop", "1")
        .kid(el("div").cls("ai-in")
            .kid(el("div").cls("ai-k").text("AI language"))
            .kid(el("h1").text("Super AI"))
            .kid(el("p").cls("lede").text(format!(
                "The highest level: say what to make, in words. Below this, the site{}, then supers and wires, then code, BASIC, assembly, and the 0s and 1s. {}",
                if places.is_empty() { String::new() } else { format!(" ({})", places.join(", ")) },
                if mine > 0 { format!("Your canvas has {} supers and sparkles of your own and {} wires.", mine, s.wires.len()) } else { "Your canvas is empty so far.".to_string() }
            )))
            .kid(el("div").cls("ai-row")
                .kid(el("input")
                    .attr("type", "text")
                    .attr("aria-label", "What to make")
                    .attr("placeholder", "a program that counts to 10 and stops…")
                    .prop("value", s.ai_draft.clone())
                    .on("input", Msg::TV(Tool::Prog, P_AI_DRAFT))
                    .on("enter", Msg::T(Tool::Prog, P_AI_SEND, String::new())))
                .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Prog, P_AI_SEND, String::new())).text("Make it")))
            .kid(el("p").cls("hint").text("Zoom in to go back down to the canvas.")))
        .into()
}

// ---------------------------------------------------------------------------------------------- zooming into a super

/// How deep a super is shown, from how big it is on screen (owner, 2026-10-17: "restore the resizing to change into
/// icon and to see code if zoom too much. The more you zoom in, the more fundamental it gets. You can even zoom into
/// zero and one. From high level of graphical to low level bare metal."). Made small (resized or zoomed out) it is an
/// icon; zoomed in, its π source, then the code it stands for, then x86-64 assembly, then the machine code's bits.
fn zoom_depth(px: f64) -> u8 {
    match px {
        p if p < 30.0 => 0,
        p if p < 240.0 => 1,
        p if p < 480.0 => 2,
        p if p < 960.0 => 3,
        p if p < 1920.0 => 4,
        p if p < 3840.0 => 5,
        _ => 6,
    }
}

/// The ladder, from the top (owner, 2026-10-17: "from bare metal 0 and 1 to assembly to basic language, then to high
/// language, then to graphical language, then to AI language"; the AI language is the canvas zoomed all the way out).
const DEPTH_NAMES: [&str; 7] = ["icon", "graphical", "high language · Rust", "basic language · BASIC", "assembly · x86-64", "hexadecimal", "bare metal · 0 and 1"];

/// A value as π (and Rust) would write it.
fn lit_of(v: &Value) -> String {
    match v {
        Value::Str(t) => json::quote(t),
        x => vtext(x),
    }
}

fn vname(id: usize) -> String {
    if is_unode(id) { format!("n{}", id) } else { format!("site{}", id) }
}

/// What arrives at a node's in, in order.
fn ins_of(s: &State, id: usize) -> Vec<usize> {
    s.wires.iter().filter(|w| w.1 == id && w.2 == Tip::In).map(|w| w.0).collect()
}

/// The π source of one super: itself and the wires into it, in the language Super AI writes.
fn depth_pi(s: &State, n: &UNode) -> String {
    let mut out = format!("{}: {}\n", vname(n.id), n.text.trim());
    for w in s.wires.iter().filter(|w| w.1 == n.id) {
        let tip = match w.2 { Tip::Control => " control", Tip::Gate => " gate", _ => "" };
        out.push_str(&format!("{} -> {}{}\n", vname(w.0), vname(n.id), tip));
    }
    out
}

/// The same super as code: what the engine computes, written out.
fn depth_code(s: &State, n: &UNode, k: &Kind) -> String {
    let v = vname(n.id);
    let ins: Vec<String> = ins_of(s, n.id).into_iter().map(vname).collect();
    let args = if ins.is_empty() { "/* nothing wired */".to_string() } else { ins.join(", ") };
    let body = match k {
        Kind::Const(Value::Num(x)) => format!("let {v}: f64 = {};", vtext(&Value::Num(*x))),
        Kind::Const(c) => format!("let {v}: Value = {};", lit_of(c)),
        Kind::Op(op) => {
            let sym = match *op { "×" => "*", "÷" => "/", "−" => "-", "≠" => "!=", "≤" => "<=", "≥" => ">=", "=" => "==", "and" => "&&", "or" => "||", o => o };
            match (*op, ins.len()) {
                ("+" | "−" | "×" | "÷" | "%" | "<" | ">" | "=" | "≠" | "≤" | "≥" | "and" | "or", l) if l >= 2 => format!("let {v} = {};", ins.join(&format!(" {} ", sym))),
                ("^", 2) => format!("let {v} = {}.powf({});", ins[0], ins[1]),
                ("√", _) => format!("let {v} = {}.sqrt();", ins.first().cloned().unwrap_or_default()),
                ("not", _) => format!("let {v} = !{};", ins.first().cloned().unwrap_or_default()),
                ("if", 3) => format!("let {v} = if {} {{ {} }} else {{ {} }};", ins[0], ins[1], ins[2]),
                (o, _) => format!("let {v} = pi::{}({});", o.replace('&', "join"), args),
            }
        }
        Kind::Reg(init) => format!("static mut {}: Value = {};\nlet {v} = unsafe {{ {} }};          // at the step's end:\nunsafe {{ {} = {}; }}", v.to_uppercase(), lit_of(init), v.to_uppercase(), v.to_uppercase(), ins.first().cloned().unwrap_or_else(|| v.to_uppercase())),
        Kind::Stop => format!("if truthy(&{}) {{ return Run::Stopped; }}", ins.first().cloned().unwrap_or_default()),
        Kind::Show => format!("show({});", args),
        Kind::Ask(t) => format!("let {v} = super_ai({:?}, &[{}]);", t, ins.join(", ")),
        Kind::List => format!("let {v} = vec![{}];", ins.join(", ")),
        _ => format!("let {v} = pi::{}({});", kind_name(k), args),
    };
    format!("// {} — {}\nfn step_{}(..) {{\n    {}\n}}\n", n.text.trim(), kind_name(k), v, body.replace('\n', "\n    "))
}

/// The same super in BASIC: numbered lines, one variable per super, GOSUB into the runtime for what BASIC lacks.
fn depth_basic(s: &State, n: &UNode, k: &Kind) -> String {
    let v = vname(n.id).to_uppercase();
    let ins: Vec<String> = ins_of(s, n.id).into_iter().map(|i| vname(i).to_uppercase()).collect();
    let first = ins.first().cloned().unwrap_or_else(|| "0".into());
    let mut l: Vec<String> = Vec::new();
    match k {
        Kind::Const(Value::Str(t)) => l.push(format!("LET {}$ = {}", v, json::quote(t))),
        Kind::Const(c) => l.push(format!("LET {} = {}", v, lit_of(c))),
        Kind::Op(op) => {
            let sym = match *op { "×" => "*", "÷" => "/", "−" => "-", "≠" => "<>", "≤" => "<=", "≥" => ">=", "%" => "MOD", "and" => "AND", "or" => "OR", o => o };
            match *op {
                "+" | "−" | "×" | "÷" | "%" | "^" | "<" | ">" | "=" | "≠" | "≤" | "≥" | "and" | "or" if ins.len() >= 2 => l.push(format!("LET {} = {}", v, ins.join(&format!(" {} ", sym)))),
                "√" => l.push(format!("LET {} = SQR({})", v, first)),
                "sin" | "cos" | "tan" | "abs" | "exp" => l.push(format!("LET {} = {}({})", v, op.to_uppercase(), first)),
                "ln" => l.push(format!("LET {} = LOG({})", v, first)),
                "floor" => l.push(format!("LET {} = INT({})", v, first)),
                "random" => l.push(format!("LET {} = RND(1)", v)),
                "not" => l.push(format!("LET {} = NOT {}", v, first)),
                "if" if ins.len() >= 3 => {
                    l.push(format!("IF {} THEN LET {} = {} ELSE LET {} = {}", ins[0], v, ins[1], v, ins[2]));
                }
                o => {
                    l.push(format!("LET A$ = \"{}\"", o));
                    l.push("GOSUB 9000 : REM the π runtime".to_string());
                    l.push(format!("LET {} = R", v));
                }
            }
        }
        Kind::Reg(init) => {
            l.push(format!("IF STEP = 0 THEN LET {} = {}", v, lit_of(init)));
            l.push(format!("LET NEXT{} = {} : REM taken at the step's end", v, first));
        }
        Kind::Stop => l.push(format!("IF {} THEN END", first)),
        Kind::Show => l.push(format!("PRINT {}", first)),
        Kind::Ask(t) => {
            l.push(format!("LET Q$ = {}", json::quote(t)));
            l.push("GOSUB 9500 : REM ask Super AI".to_string());
            l.push(format!("LET {}$ = A$", v));
        }
        _ => {
            l.push(format!("LET A$ = \"{}\"", kind_name(k)));
            l.push("GOSUB 9000 : REM the π runtime".to_string());
            l.push(format!("LET {} = R", v));
        }
    }
    let base = 100 + (n.id % 90) * 10;
    let mut out = format!("REM {} — {}\n", n.text.trim(), kind_name(k));
    for (i, x) in l.iter().enumerate() {
        out.push_str(&format!("{} {}\n", base + i, x));
    }
    out
}

/// The same super as x86-64: its values live in a frame, 8 bytes each, below rbp; numbers in SSE registers. Returns
/// the listing, and the bytes it assembles to.
fn depth_asm(s: &State, n: &UNode, k: &Kind) -> (String, Vec<u8>) {
    let slot = |id: usize| -> u8 { (0u8).wrapping_sub((((id % 15) + 1) * 8) as u8) };
    let mut asm = String::new();
    let mut code: Vec<u8> = Vec::new();
    let ins = ins_of(s, n.id);
    let mut line = |text: String, bytes: &[u8], asm: &mut String, code: &mut Vec<u8>| {
        let hex: Vec<String> = bytes.iter().map(|b| format!("{:02x}", b)).collect();
        asm.push_str(&format!("{:<34} ; {}\n", text, hex.join(" ")));
        code.extend_from_slice(bytes);
    };
    let me = slot(n.id);
    match k {
        Kind::Const(Value::Num(x)) => {
            let mut b = alloc::vec![0x48, 0xB8];
            b.extend_from_slice(&x.to_bits().to_le_bytes());
            line(format!("mov  rax, 0x{:016x}", x.to_bits()), &b, &mut asm, &mut code);
            line(format!("mov  [rbp{}], rax", me as i8), &[0x48, 0x89, 0x45, me], &mut asm, &mut code);
        }
        Kind::Op(op) if matches!(*op, "+" | "−" | "×" | "÷") && !ins.is_empty() => {
            let opc = match *op { "+" => 0x58, "−" => 0x5C, "×" => 0x59, _ => 0x5E };
            let name = match *op { "+" => "addsd", "−" => "subsd", "×" => "mulsd", _ => "divsd" };
            line(format!("movsd xmm0, [rbp{}]", slot(ins[0]) as i8), &[0xF2, 0x0F, 0x10, 0x45, slot(ins[0])], &mut asm, &mut code);
            for i in &ins[1..] {
                line(format!("{} xmm0, [rbp{}]", name, slot(*i) as i8), &[0xF2, 0x0F, opc, 0x45, slot(*i)], &mut asm, &mut code);
            }
            line(format!("movsd [rbp{}], xmm0", me as i8), &[0xF2, 0x0F, 0x11, 0x45, me], &mut asm, &mut code);
        }
        Kind::Op("√") if !ins.is_empty() => {
            line(format!("sqrtsd xmm0, [rbp{}]", slot(ins[0]) as i8), &[0xF2, 0x0F, 0x51, 0x45, slot(ins[0])], &mut asm, &mut code);
            line(format!("movsd [rbp{}], xmm0", me as i8), &[0xF2, 0x0F, 0x11, 0x45, me], &mut asm, &mut code);
        }
        Kind::Op(op) if matches!(*op, "<" | ">" | "≤" | "≥" | "=" | "≠") && ins.len() >= 2 => {
            let (cc, name) = match *op { "<" => (0x92, "setb"), ">" => (0x97, "seta"), "≤" => (0x96, "setbe"), "≥" => (0x93, "setae"), "=" => (0x94, "sete"), _ => (0x95, "setne") };
            line(format!("movsd xmm0, [rbp{}]", slot(ins[0]) as i8), &[0xF2, 0x0F, 0x10, 0x45, slot(ins[0])], &mut asm, &mut code);
            line(format!("ucomisd xmm0, [rbp{}]", slot(ins[1]) as i8), &[0x66, 0x0F, 0x2E, 0x45, slot(ins[1])], &mut asm, &mut code);
            line(format!("{} al", name), &[0x0F, cc, 0xC0], &mut asm, &mut code);
            line("movzx eax, al".to_string(), &[0x0F, 0xB6, 0xC0], &mut asm, &mut code);
            line(format!("mov  [rbp{}], rax", me as i8), &[0x48, 0x89, 0x45, me], &mut asm, &mut code);
        }
        Kind::Reg(_) => {
            line(format!("mov  rax, [rbp{}]", me as i8), &[0x48, 0x8B, 0x45, me], &mut asm, &mut code);
            line("; held across steps: written back at the step's end".to_string(), &[], &mut asm, &mut code);
            if let Some(i) = ins.first() {
                line(format!("mov  rcx, [rbp{}]", slot(*i) as i8), &[0x48, 0x8B, 0x4D, slot(*i)], &mut asm, &mut code);
                line(format!("mov  [rbp{}], rcx", me as i8), &[0x48, 0x89, 0x4D, me], &mut asm, &mut code);
            }
        }
        _ => {
            // everything else calls into the π runtime: the values arrive in rdi (a pointer to them) and rsi (how many)
            line(format!("lea  rdi, [rbp{}]", ins.first().map(|i| slot(*i)).unwrap_or(me) as i8), &[0x48, 0x8D, 0x7D, ins.first().map(|i| slot(*i)).unwrap_or(me)], &mut asm, &mut code);
            line(format!("mov  esi, {}", ins.len()), &[0xBE, ins.len() as u8, 0, 0, 0], &mut asm, &mut code);
            line(format!("call pi_{}", kind_name(k).replace(' ', "_")), &[0xE8, 0, 0, 0, 0], &mut asm, &mut code);
            line(format!("mov  [rbp{}], rax", me as i8), &[0x48, 0x89, 0x45, me], &mut asm, &mut code);
        }
    }
    (asm, code)
}

/// What a super shows at a depth past the graphical: a heading, and the text.
fn depth_view(s: &State, n: &UNode, k: &Kind, depth: u8, kz: f64) -> N {
    let text = match depth {
        2 => depth_code(s, n, k),
        3 => depth_basic(s, n, k),
        4 => depth_asm(s, n, k).0,
        5 => {
            let (_, bytes) = depth_asm(s, n, k);
            bytes.chunks(8).map(|c| c.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ")).collect::<Vec<_>>().join("\n")
        }
        _ => {
            let (_, bytes) = depth_asm(s, n, k);
            bytes.iter().map(|b| format!("{:08b}", b)).collect::<Vec<_>>().chunks(4).map(|c| c.join(" ")).collect::<Vec<_>>().join("\n")
        }
    };
    // the text stays one size on screen however far in: the deeper you go, the more of it there is room for
    el("div")
        .cls("u-deep")
        .style(format!("font-size:{:.3}px", 12.5 / kz.max(1e-6)))
        .kid(el("div").cls("u-deep-h").text(format!("{} · {}", DEPTH_NAMES[depth as usize], n.text.trim())))
        .kid(el("pre").cls("u-deep-t").text(text))
        .into()
}

/// A super as an icon: what it does, as one mark.
fn icon_mark(k: &Kind, text: &str) -> String {
    match k {
        Kind::Op(op) => op.to_string(),
        Kind::Const(_) => text.trim().chars().take(4).collect(),
        Kind::Reg(_) => "R".into(),
        Kind::Stop => "■".into(),
        Kind::Show => "▣".into(),
        Kind::Ask(_) => "✦".into(),
        _ => kind_name(k).chars().take(2).collect(),
    }
}

fn unode_view(s: &State, n: &UNode, r: Rect, mini: bool, kz: f64) -> N {
    if n.text == SPARKLE {
        return sparkle_view(s, n, r, mini);
    }
    if let Some(name) = n.text.strip_prefix(MEMBER) {
        return member_view(s, n, r, mini, name, kz);
    }
    let k = kind_of(&n.text);
    let val = if let Kind::Reg(_) = k { s.prog.regs.get(&n.id).cloned().unwrap_or(Value::Null) } else { s.prog.vals.get(&n.id).cloned().unwrap_or(Value::Null) };
    let shown = vtext(&val);
    let kcls = match &k {
        Kind::Reg(_) => "k-reg",
        Kind::Op(_) => "k-op",
        Kind::Const(_) => "k-const",
        Kind::Stop => "k-stop",
        Kind::Show => "k-show",
        Kind::Ask(_) => "k-ask",
        Kind::Member(_) => "k-member",
        _ => "k-fn",
    };
    // a prompt on its way to Super AI says so
    let asking = matches!(&k, Kind::Ask(_)) && shown.is_empty() && !s.prog.ai_busy.is_empty() && s.wires.iter().any(|w| w.0 == n.id);
    let shown = if asking { "asking Super AI…".to_string() } else { shown };
    let a = ((n.id - UBASE) as u16) << 4;
    // grown to half as big again as it was made (by area), a super is a canvas: its name up in the corner and room
    // below it (owner, 2026-10-14: "if a new super becomes 50% larger than its initial state, it turns into a canvas")
    let canvas = unode_is_canvas(n);
    // how deep it is shown: by its size on screen (a super grown into a canvas holds drawings, so it goes no deeper)
    let depth = if mini || n.text.trim().is_empty() { 1 } else { zoom_depth(r.2.min(r.3) * kz) };
    let speck = !mini && r.2.min(r.3) * kz < 8.0;
    let depth = if canvas && depth > 1 { 1 } else { depth };
    if depth != 1 {
        let tag = if depth == 0 { el("span").cls("u-icon").text(icon_mark(&k, &n.text)).into() } else { depth_view(s, n, &k, depth, kz) };
        return el("div")
            .cls("sx unode")
            .cls(kcls)
            .cls(if depth == 0 { "u-iconic" } else { "u-deeper" })
            .cls_if(speck, "u-speck")
            .cls_if(s.prog.sel == Some(n.id), "sel").cls_if(!mini && locked(s, n.id), "is-locked")
            .attr("data-s", format!("{}", n.id))
            .attr("data-solid", "1")
            .attr("title", format!("{}: {} — {}", kind_name(&k), n.text, DEPTH_NAMES[depth as usize]))
            .style(format!("left:{:.1}px;top:{:.1}px;width:{:.1}px;height:{:.1}px", r.0, r.1, r.2, r.3))
            .on_if(!mini, "pdown", Msg::PDown(n.id, String::new()))
            .kid(se_shape())
            .kid(tag)
            .kid_if(!mini && s.prog.sel == Some(n.id) && !locked(s, n.id), || grip())
            .into();
    }
    el("div")
        .cls("sx unode")
        .cls_if(canvas, "u-canvas")
        .cls(kcls)
        .cls_if(s.prog.sel == Some(n.id), "sel").cls_if(!mini && locked(s, n.id), "is-locked")
        .cls_if(!shown.is_empty(), "has-val")
        .cls_if(n.text.trim().is_empty(), "empty")
        .attr("data-s", format!("{}", n.id))
        .attr("data-solid", "1")
        .attr("title", format!("{}: {}", kind_name(&k), n.text))
        .style(format!("left:{:.1}px;top:{:.1}px;width:{:.1}px;height:{:.1}px", r.0, r.1, r.2, r.3))
        .on_if(!mini, "pdown", Msg::PDown(n.id, String::new()))
        .kid(se_shape())
        .kid(
            el("input")
                .cls("u-text")
                .attr("placeholder", "type…")
                .attr("aria-label", "What this node does")
                .attr("spellcheck", "false")
                .attr("autocomplete", "off")
                .prop("value", n.text.clone())
                .on("input", Msg::TV(Tool::Prog, P_TEXT | a)),
        )
        // an empty super shows what arrives at it, so a result can land in one
        .kid_if(!n.text.trim().is_empty() || !shown.is_empty(), || el("span").cls("u-val").cls(s.prog.vals.get(&n.id).filter(|v| !v.is_null()).map(value_type).unwrap_or("t-none")).text(if shown.is_empty() { kind_name(&k).to_string() } else { shown }).into())
        .kid_if(!mini && s.prog.sel == Some(n.id) && !locked(s, n.id), || grip())
        .into()
}

fn palette_view() -> Vec<N> {
    alloc::vec![
        el("span").cls("tag").text("Palette").into(),
        el("div")
            .cls("chips")
            .kids(PALETTE.iter().enumerate().map(|(i, (label, t))| -> N {
                el("button")
                    .attr("type", "button")
                    .cls("chip")
                    .attr("title", format!("Add a node: {}", t))
                    .attr("data-stop", "1")
                    .on("click", Msg::T(Tool::Prog, P_ADD, format!("{}", i)))
                    .text(*label)
                    .into()
            }))
            .into(),
    ]
}

fn examples_view() -> Vec<N> {
    alloc::vec![
        el("span").cls("tag").text("Examples").into(),
        el("div")
            .cls("ex-list")
            .kids(EXAMPLES.iter().enumerate().map(|(i, (name, what, _, _))| -> N {
                el("button")
                    .attr("type", "button")
                    .cls("ex")
                    .attr("title", *what)
                    .attr("data-stop", "1")
                    .on("click", Msg::T(Tool::Prog, P_EXAMPLE, format!("{}", i)))
                    .text(*name)
                    .into()
            }))
            .into(),
    ]
}

fn prog_region_view(s: &State) -> Vec<N> {
    alloc::vec![
        el("span").cls("tag").text("Program").into(),
        el("span").cls("p-status").attr("role", "status").text(if s.prog.status.is_empty() {
            "Type in a node: 3, +, reg 0, stop… Wire an out to an in. ▶ runs.".to_string()
        } else {
            s.prog.status.clone()
        }).into(),
    ]
}

const PROG_CSS: &str = "\
.sx.prog{background:rgba(255,255,255,.55);border:1px solid #b9b9b4;box-shadow:none;cursor:grab}\
.sx.prog>.tag{position:absolute;left:14px;top:12px}\
.p-status{position:absolute;left:110px;right:14px;top:14px;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.sx.unode{background:transparent;border:0;box-shadow:none;overflow:visible;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:4px 14px;cursor:grab;z-index:2}\
.u-shape{position:absolute;inset:0;width:100%;height:100%;overflow:visible;z-index:-1;pointer-events:none;filter:drop-shadow(0 8px 14px rgba(25,25,25,.12))}\
.u-shape path{fill:#fff;stroke:#2b2b2b;stroke-width:calc(1.6px * var(--wz, 1) / var(--k, 1));vector-effect:non-scaling-stroke;stroke-linejoin:round}\
.unode.sel .u-shape path{stroke:var(--accent);stroke-width:calc(2.6px * var(--wz, 1) / var(--k, 1))}.sx.unode.sel:not(.sparkle){outline:0}\
.unode.k-reg .u-shape path{stroke:var(--accent)}.unode.k-stop .u-shape path{stroke:var(--bad)}\
.unode.k-ask .u-shape path{stroke:var(--accent)}.unode.k-const .u-shape path{fill:#fbfbf9}\
.sx.unode.k-member.pien .u-shape path{stroke:var(--accent)}\
.sx.unode.sparkle{background:transparent;border:0;padding:0;box-shadow:none;overflow:visible;display:grid;place-items:center}\
.sparkle svg{display:block}.sparkle path{fill:none;stroke:#2b2b2b;stroke-width:calc(1.6px * var(--wz, 1) / var(--k, 1));vector-effect:non-scaling-stroke;stroke-linejoin:round}.sparkle.sel path{fill:none;stroke:var(--accent)}.sx.unode.sparkle.sel{outline:0}\
.sp-val{position:absolute;top:100%;left:50%;transform:translateX(-50%);font-size:11.5px;line-height:1.35;color:var(--magenta);font-weight:600;width:max-content;max-width:180px;text-align:center;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;background:color-mix(in srgb,var(--paper) 88%,transparent);border-radius:6px;padding:1px 5px;pointer-events:none}\
.sx.unode.sel{outline:2px solid var(--accent);outline-offset:3px}\
.u-grip{position:absolute;right:calc(2px / var(--k, 1));bottom:calc(2px / var(--k, 1));width:calc(16px / var(--k, 1));height:calc(16px / var(--k, 1));cursor:nwse-resize;touch-action:none;z-index:3;background:none;border:0}\
.u-grip::after{content:\"\";position:absolute;right:calc(3px / var(--k, 1));bottom:calc(3px / var(--k, 1));width:calc(8px / var(--k, 1));height:calc(8px / var(--k, 1));border-radius:50%;background:var(--accent)}\
@media (pointer:coarse){.u-grip{width:calc(26px / var(--k, 1));height:calc(26px / var(--k, 1))}}\
.sx.unode.u-canvas{justify-content:flex-start;align-items:flex-start;padding:14% 16% 12%}\
.sx.unode.u-canvas .u-text,.sx.unode.u-canvas.empty .u-text{width:auto;field-sizing:content;min-width:5ch;max-width:100%;border:0;border-bottom:1.5px solid #d9d6cc;padding:1px 2px;background:transparent;text-align:left}\
.sx.unode.u-canvas .u-val{margin-top:auto;align-self:flex-end;max-width:100%}\
.sx.unode.u-canvas.empty .u-text{display:none}\
.sx.unode.u-canvas .u-val{white-space:pre-wrap;overflow:hidden;text-overflow:clip;text-align:left;align-self:stretch;margin-top:8px;font-size:13px;line-height:1.45;color:var(--ink);font-weight:400}\
.unode.k-ask .u-val{color:var(--accent)}\
.u-text{font:500 15px/1.2 'Geist Mono',ui-monospace,monospace;border:0;background:transparent;width:100%;padding:0;color:var(--ink);text-align:center;outline:none;cursor:text}\
.sx.unode .u-val{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.wires .w-val{paint-order:stroke fill}\
.sx.unode .u-val.t-num{color:#b4651a}.sx.unode .u-val.t-bool{color:#2f8f4e}.sx.unode .u-val.t-text{color:#c2185b}.sx.unode .u-val.t-list{color:#6a4fb3}\
.ladder{position:fixed;right:10px;top:50%;transform:translateY(-50%);z-index:2147483100;display:flex;flex-direction:column;gap:2px;padding:6px;border-radius:14px;background:color-mix(in srgb,var(--paper) 85%,transparent);backdrop-filter:blur(6px)}\
.ladder .rung{font:500 11px/1.2 'Geist Mono',ui-monospace,monospace;color:#8a877f;background:none;border:0;padding:4px 8px;border-radius:8px;text-align:right;cursor:pointer;box-shadow:none}\
.ladder .rung:hover{color:#2b2b2b}.ladder .rung.at{color:var(--accent);background:var(--accent-soft);font-weight:700}\
@media (max-width:699px){.ladder{top:auto;bottom:8px;right:50%;transform:translateX(50%);flex-direction:row;overflow-x:auto;max-width:calc(100vw - 16px)}}\
.ai-level{position:fixed;inset:0;z-index:2147483050;display:grid;place-items:center;background:color-mix(in srgb,var(--paper) 82%,transparent);backdrop-filter:blur(3px)}\
.ai-in{width:min(640px,calc(100vw - 32px));text-align:center}.ai-in h1{font-size:44px;margin:4px 0 10px}\
.ai-k{font:600 12px/1 'Geist Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}\
.ai-row{display:flex;gap:10px;margin:18px 0 8px}.ai-row input{flex:1;min-width:0;font:inherit;font-size:16px;padding:12px 14px;border:1.5px solid #2b2b2b;border-radius:14px;background:var(--card)}\
.sx.unode.u-speck .u-shape path{fill:#2b2b2b;stroke:none}.sx.unode.u-speck>*:not(.u-shape){display:none}.sx.unode.u-speck{box-shadow:none}\
@keyframes pi-grow{from{transform:translate(var(--fx,0),var(--fy,0)) scale(var(--fsx,.2),var(--fsy,.2));opacity:.55;border-radius:48px}60%{opacity:1}to{transform:none;opacity:1}}\
@keyframes pi-back{from{transform:scale(1.6);opacity:0;filter:blur(8px)}40%{opacity:.8}to{transform:none;opacity:1;filter:none}}\
@keyframes pi-rise{from{transform:scale(.6);opacity:0;filter:blur(8px)}to{transform:none;opacity:1;filter:none}}\
@keyframes pi-fade{from{opacity:0}to{opacity:1}}\
.focus.grow-in>.win,.focus.grow-in>.scene{animation:pi-grow .7s cubic-bezier(.16,.8,.2,1) both;transform-origin:50vw 50vh}\
.focus.back-in>.win,.focus.back-in>.scene{animation:pi-back .65s cubic-bezier(.16,.8,.2,1) both;transform-origin:50vw 50vh}\
.ai-level{animation:pi-fade .35s ease-out both}.ai-level .ai-in{animation:pi-rise .45s cubic-bezier(.2,.75,.15,1) both}\
@keyframes wl0{from{opacity:.25;filter:blur(10px)}to{opacity:1;filter:none}}@keyframes wl1{from{opacity:.25;filter:blur(10px)}to{opacity:1;filter:none}}\
@keyframes wl2{from{opacity:.25;filter:blur(10px)}to{opacity:1;filter:none}}@keyframes wl3{from{opacity:.25;filter:blur(10px)}to{opacity:1;filter:none}}\
.win-in.wl-0{animation:wl0 .45s ease-out}.win-in.wl-1{animation:wl1 .45s ease-out}.win-in.wl-2{animation:wl2 .45s ease-out}.win-in.wl-3{animation:wl3 .45s ease-out}\
@keyframes pi-dissolve{from{opacity:0;filter:blur(6px)}to{opacity:1;filter:none}}\
.u-deep,.u-icon,.sx.unode .u-text,.sx.unode .u-val,.sx.unode .u-mark,.sx.unode .tag{animation:pi-dissolve .4s ease-out both}.sx.unode .u-shape path{transition:fill .25s,stroke .25s}\
.ladder .rung{transition:color .35s,background-color .35s,transform .35s}.ladder .rung.at{transform:translateX(-4px)}\
.sx.unode.k-member{flex-direction:column;gap:6px}.u-mark{display:grid;place-items:center;color:#2b2b2b}.u-mark svg{width:26px;height:26px}\
.u-icon svg{width:20px;height:20px;display:block}.sx.unode.k-member.u-iconic{flex-direction:row}\
.sx.unode.u-iconic{padding:0;align-items:center;justify-content:center}\
.u-icon{font:600 22px/1 'Geist Mono',ui-monospace,monospace;color:#2b2b2b;transform:scale(calc(1 / var(--k, 1)));white-space:nowrap}\
.sx.unode.u-deeper{padding:0;cursor:grab}\
.u-deep{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:max-content;max-width:none;font-family:'Geist Mono',ui-monospace,monospace;line-height:1.45;color:#2b2b2b;text-align:left}\
.u-deep-h{font-weight:600;color:var(--accent);margin-bottom:.5em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.u-deep-t{margin:0;font:inherit;white-space:pre;user-select:text;-webkit-user-select:text}\
.unode.k-op .u-deep-t,.unode.k-const .u-deep-t{color:#2b2b2b}\
.sx.unode.is-locked{cursor:default}.sx.unode.is-locked::after{content:'';position:absolute;right:16%;top:12%;width:9px;height:11px;background:#8a877f;-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 11'%3E%3Cpath d='M2 5V3.3a2.5 2.5 0 0 1 5 0V5h1v6H1V5zm1 0h3V3.3a1.5 1.5 0 0 0-3 0z'/%3E%3C/svg%3E\") center/contain no-repeat;mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 11'%3E%3Cpath d='M2 5V3.3a2.5 2.5 0 0 1 5 0V5h1v6H1V5zm1 0h3V3.3a1.5 1.5 0 0 0-3 0z'/%3E%3C/svg%3E\") center/contain no-repeat;pointer-events:none}\
.u-text::placeholder{color:#b3b1aa;font-size:12.5px}.sx.unode.empty .u-text{border-bottom:1.5px dashed transparent;padding:4px 2px}.sx.unode.empty .u-text:focus,.sx.unode .u-text:focus{border-bottom:1.5px solid var(--accent)}\
.u-val{font-size:11.5px;color:var(--faint);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}\
.unode.has-val .u-val{color:var(--magenta);font-weight:600;font-size:12.5px}\
.unode.k-reg .u-val{color:var(--accent)}\
\
.unode.k-show .u-val{font-size:15px}\
.sx.unode.k-member{justify-content:center;align-items:center;text-align:center;padding:16px 26px;cursor:pointer}\
.sx.unode.k-member .tag{font:500 15px/1.3 'Geist',system-ui,sans-serif;font-size:max(15px, calc(10px / var(--k, 1)));white-space:normal;border:0;background:none;padding:0;border-radius:0;box-shadow:none}\
.sx.unode.k-member .u-val{position:absolute;right:22%;bottom:16%}\
.sx.palette,.sx.examples{background:#fff;padding:38px 10px 10px;cursor:grab;display:block}\
.sx.palette>.tag,.sx.examples>.tag{position:absolute;left:12px;top:9px}\
.chips{display:flex;flex-wrap:wrap;gap:6px}\
.chip{font:500 13px/1 'Geist Mono',ui-monospace,monospace;border:1px solid #2b2b2b;background:#fbfbf9;padding:6px 9px;min-width:34px;cursor:pointer}\
.chip:hover,.ex:hover{border-color:var(--accent);color:var(--accent)}\
.ex-list{display:flex;flex-direction:column;gap:5px}\
.ex{font:inherit;font-size:13.5px;text-align:left;border:1px solid #2b2b2b;background:#fbfbf9;padding:4px 10px;cursor:pointer}\
.ctl-bar{position:fixed;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:12px;z-index:2147483090}\
.ctl-bar .ric{position:relative}.ctl-bar svg.ci{width:20px;height:20px;stroke-width:1.8}\
@media (max-width:699px){.ctl-bar{top:auto;bottom:80px;gap:10px}}\
";
