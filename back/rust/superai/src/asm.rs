//! SuperAI assembly: the language written line by line with graphical signs, in the style of HAL-OS's assembly
//! (`;` comments, `label:` lines, one instruction or super per line). It assembles to the program JSON the site runs.
//!
//!   .language "SuperAI 1"            a top-level value (`.key value`), or an object (`.key a=1 b.c=2`)
//!   .put titles.byId "key" "value"   path[key] = value          .push hide "x"   append to the list at path
//!   .json live {"every": 30}          any JSON at a path (the escape hatch)
//!   ◇ assess "Evaluate" panel=tab-assess          a source (bare word: key, quoted: name)
//!   ◯ "Lab" source=lab at.fx=0.09 at.inSite=0.6,0.7   a bubble (quoted: title)
//!   ⊕ journal "Leaderboards" parts="a","b"       a merge (bare: source, quoted: title)
//!   connectors: ▷ output, ◁ input, △ sync, ▽ condition, as in `⟶ a▷ b◁` or `⟶ site△ hold△` (or a.output b.input)
//!   super signs: ■ square, ● dot, ◆ diamond, ✦ sparkle, ⊙ input or output, ▣ holder (in a diagram: hold), ⟶ wire
//!   diagram … end                     the start: ■ ✦ ● ⊙ supers (first word id, bare word kind, quoted text), ⟶ a.port b.port
//!   graph name … end                  a graph function: supers and wires, data flowing from outputs into inputs
//!   fn name p1 p2 … end               a code function for the stack machine (vm.rs): `op arg` lines and `label:` lines
//!   (simple words: say = out, get = load, set = store, goto = jmp, if = jnz, ifnot = jz, give = ret, stop = halt;
//!    `ask engine` prompts an LLM with the text on top and gives its answer)
//!   map … end                         the project map: ▭ "section" x= y= w= h=, ▣ id "Label" kind= …, ⟶ a b, .key …
//!
//! Values: numbers, "quoted text", bare words (text), null/true/false, JSON in [ ] or { }, and comma lists (`1,2` or `0.5,`).
//! An attribute with no `=` is true. Every line that cannot be read is an error with its line number.
use super::json::{self, Json};
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;

fn strip_comment(line: &str) -> &str {
    let (mut q, mut esc) = (false, false);
    for (i, c) in line.char_indices() {
        if q { if esc { esc = false } else if c == '\\' { esc = true } else if c == '"' { q = false } continue; }
        if c == '"' { q = true } else if c == ';' { return &line[..i]; }
    }
    line
}

/// Splits a line into tokens at spaces outside quotes and brackets.
fn tokens(line: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let (mut q, mut esc, mut depth) = (false, false, 0i32);
    for c in line.chars() {
        if q {
            cur.push(c);
            if esc { esc = false } else if c == '\\' { esc = true } else if c == '"' { q = false }
            continue;
        }
        match c {
            '"' => { q = true; cur.push(c) }
            '[' | '{' => { depth += 1; cur.push(c) }
            ']' | '}' => { depth -= 1; cur.push(c) }
            c if c.is_whitespace() && depth == 0 => { if !cur.is_empty() { out.push(core::mem::take(&mut cur)); } }
            c => cur.push(c),
        }
    }
    if q { return Err("a quote is not closed".into()); }
    if depth != 0 { return Err("a bracket is not closed".into()); }
    if !cur.is_empty() { out.push(cur); }
    Ok(out)
}

fn split_commas(t: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut q, mut esc, mut depth, mut start) = (false, false, 0i32, 0usize);
    for (i, c) in t.char_indices() {
        if q { if esc { esc = false } else if c == '\\' { esc = true } else if c == '"' { q = false } continue; }
        match c {
            '"' => q = true,
            '[' | '{' => depth += 1,
            ']' | '}' => depth -= 1,
            ',' if depth == 0 => { parts.push(&t[start..i]); start = i + 1; }
            _ => {}
        }
    }
    parts.push(&t[start..]);
    parts
}

fn atom(t: &str) -> Result<Json, String> {
    if t.starts_with('"') || t.starts_with('[') || t.starts_with('{') { return json::parse(t); }
    Ok(match t {
        "null" => Json::Null,
        "true" => Json::Bool(true),
        "false" => Json::Bool(false),
        _ => match t.parse::<f64>() { Ok(n) if t.chars().next().map_or(false, |c| c.is_ascii_digit() || c == '-' || c == '.') => Json::Num(n), _ => Json::Str(t.to_string()) },
    })
}

/// A value token: an atom, or a comma list of atoms (`a,` is a list of one).
pub fn value(t: &str) -> Result<Json, String> {
    let parts = split_commas(t);
    if parts.len() == 1 { return atom(t); }
    let parts: Vec<&str> = if parts.last() == Some(&"") { parts[..parts.len() - 1].to_vec() } else { parts };
    Ok(Json::Arr(parts.into_iter().map(atom).collect::<Result<_, _>>()?))
}

fn entry<'a>(o: &'a mut Json, key: &str, make: fn() -> Json) -> &'a mut Json {
    if !matches!(o, Json::Obj(_)) { *o = Json::Obj(vec![]); }
    if let Json::Obj(kv) = o {
        let i = match kv.iter().position(|(k, _)| k == key) { Some(i) => i, None => { kv.push((key.to_string(), make())); kv.len() - 1 } };
        return &mut kv[i].1;
    }
    unreachable!()
}
fn obj() -> Json { Json::Obj(vec![]) }
fn arr() -> Json { Json::Arr(vec![]) }
/// The object at a dotted path, made as it is walked.
fn at<'a>(root: &'a mut Json, path: &str) -> &'a mut Json {
    let mut cur = root;
    for seg in path.split('.').filter(|s| !s.is_empty()) { cur = entry(cur, seg, obj); }
    cur
}
fn set(root: &mut Json, path: &str, v: Json) {
    match path.rfind('.') {
        Some(i) => { let p = at(root, &path[..i]); *entry(p, &path[i + 1..], obj) = v; }
        None => *entry(root, path, obj) = v,
    }
}
fn push(list: &mut Json, v: Json) {
    if !matches!(list, Json::Arr(_)) { *list = arr(); }
    if let Json::Arr(a) = list { a.push(v); }
}

/// Reads `key=value` and bare tokens into an object; returns the positional tokens.
fn attrs(o: &mut Json, toks: &[String]) -> Result<Vec<String>, String> {
    let mut pos = Vec::new();
    for t in toks {
        let eq = if t.starts_with('"') || t.starts_with('[') || t.starts_with('{') { None } else { t.find('=') };
        match eq {
            Some(i) => set(o, &t[..i], value(&t[i + 1..])?),
            None => pos.push(t.clone()),
        }
    }
    Ok(pos)
}

#[derive(PartialEq, Clone, Copy)]
enum Ctx { Top, Diagram, Graph, Map, Code }

const SUPER_SIGNS: [&str; 6] = ["■", "✦", "●", "◆", "⊙", "▣"];

/// One sign line into an object: the positional words go to the keys a sign gives them.
fn sign_obj(sign: &str, rest: &[String], map: bool) -> Result<Json, String> {
    let mut o = obj();
    let mut pos: Vec<String> = Vec::new();
    // positional words come first; attributes after, so key order follows the line
    let mut i = 0;
    while i < rest.len() && (rest[i].starts_with('"') || !rest[i].contains('=')) { pos.push(rest[i].clone()); i += 1; }
    let quoted = |p: &String| p.starts_with('"');
    let mut first = true;
    for p in &pos {
        let (k, v) = match sign {
            "◇" => if quoted(p) { ("name", value(p)?) } else { ("key", value(p)?) },
            "◯" => if quoted(p) { ("title", value(p)?) } else { return Err(format!("◯ takes a quoted title, not {}", p)) },
            "▭" => if quoted(p) { ("label", value(p)?) } else { return Err(format!("▭ takes a quoted label, not {}", p)) },
            "⊕" => if quoted(p) { ("title", value(p)?) } else { ("source", value(p)?) },
            _ if first && !quoted(p) => ("id", Json::Str(p.clone())),
            "▣" if map && quoted(p) => ("label", value(p)?),
            _ if quoted(p) => ("text", value(p)?),
            _ if o.get("kind").is_some() => (p.as_str(), Json::Bool(true)),   // later bare words are flags
            _ => ("kind", value(p)?),
        };
        first = false;
        set(&mut o, k, v);
    }
    if sign == "▣" && !map { set(&mut o, "hold", Json::Bool(true)); }   // ▣ outside the map is a holder
    for t in &rest[i..] {
        let left = attrs(&mut o, core::slice::from_ref(t))?;
        for flag in left { set(&mut o, &flag, Json::Bool(true)); }
    }
    Ok(o)
}

/// Assembles SuperAI assembly into a program (or the errors, each with its line).
pub fn assemble(src: &str) -> Result<Json, Vec<String>> {
    let mut p = obj();
    let mut bad = Vec::new();
    let mut ctx = Ctx::Top;
    let mut name = String::new();
    // a code function's lines and labels, resolved at `end`
    let mut code: Vec<(usize, String, Option<String>)> = Vec::new();
    let mut labels: Vec<(String, usize)> = Vec::new();
    let mut params: Vec<Json> = Vec::new();
    for (n, raw) in src.lines().enumerate() {
        let ln = n + 1;
        let line = strip_comment(raw).trim();
        if line.is_empty() { continue; }
        let toks = match tokens(line) { Ok(t) => t, Err(e) => { bad.push(format!("line {}: {}", ln, e)); continue; } };
        let head = toks[0].as_str();
        let rest = &toks[1..];
        let r: Result<(), String> = (|| {
            if head == "end" {
                match ctx {
                    Ctx::Top => return Err("end without a block".into()),
                    Ctx::Code => {
                        let mut out = Vec::new();
                        for (l, op, arg) in code.drain(..) {
                            let mut ins = vec![Json::Str(op.clone())];
                            if let Some(a) = arg {
                                let jump = matches!(op.as_str(), "jmp" | "jz" | "jnz");
                                if jump {
                                    match labels.iter().find(|(k, _)| *k == a) { Some((_, i)) => ins.push(Json::Num(*i as f64)), None => return Err(format!("line {}: no label {}", l, a)) }
                                } else if matches!(op.as_str(), "in" | "load" | "store" | "call" | "ask" | "✦") {
                                    ins.push(Json::Str(a));
                                } else { ins.push(value(&a)?); }
                            }
                            out.push(Json::Arr(ins));
                        }
                        labels.clear();
                        let f = entry(entry(&mut p, "functions", obj), &name, obj);
                        set(f, "params", Json::Arr(core::mem::take(&mut params)));
                        set(f, "code", Json::Arr(out));
                    }
                    _ => {}
                }
                ctx = Ctx::Top;
                return Ok(());
            }
            if ctx == Ctx::Code {
                if let Some(l) = head.strip_suffix(':') { if rest.is_empty() { labels.push((l.to_string(), code.len())); return Ok(()); } }
                if rest.len() > 1 { return Err(format!("{} takes one argument", head)); }
                // simple words for the same instructions
                let op = match head { "say" => "out", "get" => "load", "set" => "store", "goto" => "jmp", "if" => "jnz", "ifnot" => "jz", "stop" => "halt", "give" => "ret", h => h };
                code.push((ln, op.to_string(), rest.first().cloned()));
                return Ok(());
            }
            match head {
                "diagram" | "map" if ctx == Ctx::Top => {
                    ctx = if head == "diagram" { Ctx::Diagram } else { Ctx::Map };
                    let o = entry(&mut p, if head == "diagram" { "diagram" } else { "project" }, obj);
                    entry(o, "supers", arr); entry(o, "wires", arr);
                }
                "graph" | "fn" if ctx == Ctx::Top => {
                    name = rest.first().ok_or("a function needs a name")?.clone();
                    if head == "graph" {
                        ctx = Ctx::Graph;
                        let f = entry(entry(&mut p, "functions", obj), &name, obj);
                        entry(f, "supers", arr); entry(f, "wires", arr);
                    } else {
                        ctx = Ctx::Code;
                        params = rest[1..].iter().map(|s| Json::Str(s.clone())).collect();
                    }
                }
                "⟶" | "->" => {
                    if rest.len() != 2 { return Err("⟶ joins two ends".into()); }
                    let w = Json::Arr(vec![Json::Str(port(&rest[0])), Json::Str(port(&rest[1]))]);
                    let host = match ctx { Ctx::Diagram => entry(&mut p, "diagram", obj), Ctx::Map => entry(&mut p, "project", obj), Ctx::Graph => entry(entry(&mut p, "functions", obj), &name, obj), _ => return Err("⟶ belongs in a diagram, graph or map".into()) };
                    push(entry(host, "wires", arr), w);
                }
                ".json" => {
                    if rest.len() != 2 { return Err(".json takes a path and one JSON value".into()); }
                    set(host_of(&mut p, ctx, &name), &rest[0], json::parse(&rest[1])?);
                }
                ".put" => {
                    if rest.len() != 3 { return Err(".put takes a path, a key and a value".into()); }
                    let key = match value(&rest[1])? { Json::Str(s) => s, _ => return Err(".put's key is text".into()) };
                    let o = at(host_of(&mut p, ctx, &name), &rest[0]);
                    *entry(o, &key, obj) = value(&rest[2])?;
                }
                ".push" => {
                    if rest.len() != 2 { return Err(".push takes a path and a value".into()); }
                    let v = value(&rest[1])?;
                    let h = host_of(&mut p, ctx, &name);
                    let path = rest[0].clone();
                    let l = match path.rfind('.') { Some(i) => entry(at(h, &path[..i]), &path[i + 1..], arr), None => entry(h, &path, arr) };
                    push(l, v);
                }
                d if d.starts_with('.') && d.len() > 1 => {
                    let key = &d[1..];
                    let mut o = obj();
                    let pos = attrs(&mut o, rest)?;
                    let v = if matches!(&o, Json::Obj(kv) if kv.is_empty()) {
                        if pos.len() != 1 { return Err(format!("{} takes one value or key=value pairs", d)); }
                        value(&pos[0])?
                    } else {
                        if !pos.is_empty() { return Err(format!("{}: {} is not key=value", d, pos[0])); }
                        o
                    };
                    set(host_of(&mut p, ctx, &name), key, v);
                }
                s if SUPER_SIGNS.contains(&s) || ["◇", "◯", "▭", "⊕"].contains(&s) => {
                    let o = sign_obj(s, rest, ctx == Ctx::Map)?;
                    let list = match (ctx, s) {
                        (Ctx::Top, "◇") => entry(&mut p, "sources", arr),
                        (Ctx::Top, "◯") => entry(&mut p, "bubbles", arr),
                        (Ctx::Top, "⊕") => entry(&mut p, "merges", arr),
                        (Ctx::Map, "▭") => entry(entry(&mut p, "project", obj), "sections", arr),
                        (Ctx::Map, "▣") => entry(entry(&mut p, "project", obj), "supers", arr),
                        (Ctx::Diagram, s) if SUPER_SIGNS.contains(&s) => entry(entry(&mut p, "diagram", obj), "supers", arr),
                        (Ctx::Graph, s) if SUPER_SIGNS.contains(&s) => entry(entry(entry(&mut p, "functions", obj), &name, obj), "supers", arr),
                        _ => return Err(format!("{} does not belong here", s)),
                    };
                    push(list, o);
                }
                other => return Err(format!("unknown line {}", other)),
            }
            Ok(())
        })();
        if let Err(e) = r { bad.push(if e.starts_with("line ") { e } else { format!("line {}: {}", ln, e) }); }
    }
    if ctx != Ctx::Top { bad.push("the last block has no end".into()); }
    if bad.is_empty() { Ok(p) } else { Err(bad) }
}

/// The connectors as signs: `a▷` is a.output, `b◁` b.input, `c△` c.sync, `d▽` d.condition (either side of the name).
pub fn port(end: &str) -> String {
    for (sign, name) in [("▷", "output"), ("◁", "input"), ("△", "sync"), ("▽", "condition")] {
        if let Some(id) = end.strip_suffix(sign).or_else(|| end.strip_prefix(sign)) { return format!("{}.{}", id, name); }
    }
    end.to_string()
}

fn host_of<'a>(p: &'a mut Json, ctx: Ctx, name: &str) -> &'a mut Json {
    match ctx {
        Ctx::Map => entry(p, "project", obj),
        Ctx::Diagram => entry(p, "diagram", obj),
        Ctx::Graph | Ctx::Code => entry(entry(p, "functions", obj), name, obj),
        Ctx::Top => p,
    }
}
