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
//   + − × ÷ % ^ min max                     arithmetic on what arrives (+ joins words with a space; & with none)
//   < > = ≠ ≤ ≥ and or not round floor abs  comparisons and logic
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
                    "round" => Value::Num(floor_f(n[0] + 0.5)),
                    "floor" => Value::Num(floor_f(n[0])),
                    "abs" => Value::Num(if n[0] < 0.0 { -n[0] } else { n[0] }),
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
        Kind::Pick | Kind::Show | Kind::Open | Kind::Stop => first(),
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
        let body = format!("{{\"engine\":{},\"prompt\":{}}}", json::quote(&engine), json::quote(&q));
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
    s.prog.ai.insert(q, text);
    if s.prog.ai_busy.is_empty() {
        prog_run(None);
    }
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
        Some(n) => format!("“{}”", n.text),
        None => name_of(id).to_string(),
    }
}

// ---------------------------------------------------------------------------------------------- editing

fn prog_save() {
    undo_mark();
    let s = st();
    let mut out = String::from("v1\n");
    for n in &s.prog.nodes {
        out.push_str(&format!("{}\t{:.1}\t{:.1}\t{}\n", n.id, n.x, n.y, n.text.replace(['\t', '\n'], " ")));
    }
    // sizes given by resizing, kept beside (a v1 reader ignores them)
    let sizes: Vec<String> = s.prog.nodes.iter().filter(|n| n.w > 0.0).map(|n| format!("{}:{:.1}:{:.1}", n.id, n.w, n.h)).collect();
    host::store_set("piii:program-sizes", &sizes.join(","));
    host::store_set("piii:program", &out);
    wires_save();
}

/// The program from this browser; answers false when there is none saved yet.
fn prog_load() -> bool {
    let s = st();
    let Some(v) = host::store_get("piii:program") else { return false };
    let mut lines = v.lines();
    if lines.next() != Some("v1") {
        return false;
    }
    s.prog.nodes.clear();
    let sizes: Vec<(usize, f64, f64)> = host::store_get("piii:program-sizes")
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
        P_SEL => s.prog.sel = Some(id),
        P_DEL => prog_remove(id),
        _ => {}
    }
}

/// The palette: what each chip adds.
const PALETTE: [(&str, &str); 20] = [
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
        .cls_if(s.prog.sel == Some(n.id), "sel")
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
        .kid_if(!v.is_empty(), || el("span").cls("sp-val").text(v.clone()).into())
        .into()
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

fn unode_view(s: &State, n: &UNode, r: Rect, mini: bool) -> N {
    if n.text == SPARKLE {
        return sparkle_view(s, n, r, mini);
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
        _ => "k-fn",
    };
    // a prompt on its way to Super AI says so
    let asking = matches!(&k, Kind::Ask(_)) && shown.is_empty() && !s.prog.ai_busy.is_empty() && s.wires.iter().any(|w| w.0 == n.id);
    let shown = if asking { "asking Super AI…".to_string() } else { shown };
    let a = ((n.id - UBASE) as u16) << 4;
    // grown to half as big again as it was made (by area), a super is a canvas: its name up in the corner and room
    // below it (owner, 2026-10-14: "if a new super becomes 50% larger than its initial state, it turns into a canvas")
    let canvas = unode_is_canvas(n);
    el("div")
        .cls("sx unode")
        .cls_if(canvas, "u-canvas")
        .cls(kcls)
        .cls_if(s.prog.sel == Some(n.id), "sel")
        .cls_if(!shown.is_empty(), "has-val")
        .cls_if(n.text.trim().is_empty(), "empty")
        .attr("data-s", format!("{}", n.id))
        .attr("data-solid", "1")
        .attr("title", format!("{}: {}", kind_name(&k), n.text))
        .style(format!("left:{:.1}px;top:{:.1}px;width:{:.1}px;height:{:.1}px", r.0, r.1, r.2, r.3))
        .on_if(!mini, "pdown", Msg::PDown(n.id, String::new()))
        .kid(
            el("input")
                .cls("u-text")
                .attr("aria-label", "What this node does")
                .attr("spellcheck", "false")
                .attr("autocomplete", "off")
                .prop("value", n.text.clone())
                .on("input", Msg::TV(Tool::Prog, P_TEXT | a)),
        )
        // an empty super shows what arrives at it, so a result can land in one
        .kid_if(!n.text.trim().is_empty() || !shown.is_empty(), || el("span").cls("u-val").text(if shown.is_empty() { kind_name(&k).to_string() } else { shown }).into())
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
.sx.unode{background:#fff;border:1.4px solid #2b2b2b;display:flex;flex-direction:column;justify-content:center;padding:4px 10px;cursor:grab;z-index:2}\
.sx.unode.sparkle{background:transparent;border:0;padding:0;box-shadow:none;overflow:visible;display:grid;place-items:center}\
.sparkle svg{display:block}.sparkle path{fill:none;stroke:var(--ink);stroke-width:2.2;vector-effect:non-scaling-stroke;stroke-linejoin:round}.sparkle.sel path{fill:none;stroke:var(--accent)}.sx.unode.sparkle.sel{outline:0}\
.sp-val{position:absolute;top:100%;left:50%;transform:translateX(-50%);font-size:11.5px;color:var(--magenta);font-weight:600;white-space:nowrap}\
.sx.unode.sel{outline:2px solid var(--accent);outline-offset:3px}\
.sx.unode.u-canvas{justify-content:flex-start;align-items:flex-start;padding:12px 14px;border-radius:18px}\
.sx.unode.u-canvas .u-text,.sx.unode.u-canvas.empty .u-text{width:auto;field-sizing:content;min-width:5ch;max-width:100%;border:1.5px solid #2b2b2b;border-radius:9px;padding:1px 7px;background:#fff;text-align:left}\
.sx.unode.u-canvas .u-val{margin-top:auto;align-self:flex-end;max-width:100%}\
.sx.unode.u-canvas.empty .u-text{display:none}\
.sx.unode.u-canvas .u-val{white-space:pre-wrap;overflow:hidden;text-overflow:clip;text-align:left;align-self:stretch;margin-top:8px;font-size:13px;line-height:1.45;color:var(--ink);font-weight:400}\
.unode.k-ask{border-color:var(--accent)}.unode.k-ask .u-val{color:var(--accent)}\
.u-text{font:500 15px/1.2 'Geist Mono',ui-monospace,monospace;border:0;background:transparent;width:100%;padding:0;color:var(--ink);text-align:center;outline:none;cursor:text}\
.sx.unode.empty .u-text{border:1.2px solid #9a9a95;background:#fbfbf9;padding:7px 4px}.sx.unode.empty .u-text:focus{border-color:var(--accent)}\
.u-val{font-size:11.5px;color:var(--faint);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}\
.unode.has-val .u-val{color:var(--magenta);font-weight:600;font-size:12.5px}\
.unode.k-reg{border-color:var(--accent);border-width:2px}.unode.k-reg .u-val{color:var(--accent)}\
.unode.k-stop{border-color:var(--bad)}.unode.k-const{background:#fbfbf9}\
.unode.k-show .u-val{font-size:15px}\
.sx.palette,.sx.examples{background:#fff;padding:38px 10px 10px;cursor:grab;display:block}\
.sx.palette>.tag,.sx.examples>.tag{position:absolute;left:12px;top:9px}\
.chips{display:flex;flex-wrap:wrap;gap:6px}\
.chip{font:500 13px/1 'Geist Mono',ui-monospace,monospace;border:1px solid #2b2b2b;background:#fbfbf9;padding:6px 9px;min-width:34px;cursor:pointer}\
.chip:hover,.ex:hover{border-color:var(--accent);color:var(--accent)}\
.ex-list{display:flex;flex-direction:column;gap:5px}\
.ex{font:inherit;font-size:13.5px;text-align:left;border:1px solid #2b2b2b;background:#fbfbf9;padding:4px 10px;cursor:pointer}\
.ctl-bar{position:fixed;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:12px;z-index:2147483000}\
.ctl-bar .ric{position:relative}.ctl-bar svg.ci{width:20px;height:20px;stroke-width:1.8}\
@media (max-width:699px){.ctl-bar{top:auto;bottom:80px;gap:10px}}\
";
