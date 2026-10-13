//! JSON: a parser for what the API answers, and the string escaping for what the page sends.
//! Accessors never fail: a missing key or a wrong type reads as null, "" or nothing, which is what a view wants.

use alloc::string::String;
use alloc::vec::Vec;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Value>),
    Obj(Vec<(String, Value)>),
}

pub static NULL: Value = Value::Null;

impl Value {
    pub fn get(&self, key: &str) -> &Value {
        if let Value::Obj(kv) = self {
            for (k, v) in kv {
                if k == key {
                    return v;
                }
            }
        }
        &NULL
    }
    /// The first of several keys that is present and not null.
    pub fn any(&self, keys: &[&str]) -> &Value {
        for k in keys {
            let v = self.get(k);
            if !v.is_null() {
                return v;
            }
        }
        &NULL
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }
    pub fn arr(&self) -> &[Value] {
        match self {
            Value::Arr(a) => a,
            _ => &[],
        }
    }
    pub fn entries(&self) -> &[(String, Value)] {
        match self {
            Value::Obj(kv) => kv,
            _ => &[],
        }
    }
    pub fn str(&self) -> &str {
        match self {
            Value::Str(s) => s,
            _ => "",
        }
    }
    /// A string, or a number written out, for fields the API sends either way.
    pub fn text(&self) -> String {
        match self {
            Value::Str(s) => s.clone(),
            Value::Num(n) if *n == (*n as i64) as f64 => alloc::format!("{}", *n as i64),
            Value::Num(n) => alloc::format!("{:.2}", n),
            Value::Bool(b) => String::from(if *b { "yes" } else { "no" }),
            _ => String::new(),
        }
    }
    pub fn num(&self) -> Option<f64> {
        match self {
            Value::Num(n) if n.is_finite() => Some(*n),
            Value::Str(s) => s.trim().parse::<f64>().ok().filter(|n| n.is_finite()),
            _ => None,
        }
    }
    pub fn f(&self) -> f64 {
        self.num().unwrap_or(0.0)
    }
    pub fn truthy(&self) -> bool {
        match self {
            Value::Bool(b) => *b,
            Value::Num(n) => *n != 0.0,
            Value::Str(s) => !s.is_empty(),
            Value::Arr(a) => !a.is_empty(),
            Value::Obj(_) => true,
            Value::Null => false,
        }
    }
}

pub fn parse(s: &str) -> Option<Value> {
    let mut p = Parser { b: s.as_bytes(), i: 0 };
    p.ws();
    let v = p.value(0)?;
    p.ws();
    if p.i == p.b.len() { Some(v) } else { None }
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\n' | b'\r' | b'\t') {
            self.i += 1;
        }
    }
    fn eat(&mut self, lit: &[u8]) -> bool {
        if self.b[self.i..].starts_with(lit) {
            self.i += lit.len();
            true
        } else {
            false
        }
    }
    fn value(&mut self, depth: u32) -> Option<Value> {
        if depth > 200 || self.i >= self.b.len() {
            return None;
        }
        match self.b[self.i] {
            b'{' => {
                self.i += 1;
                let mut kv = Vec::new();
                self.ws();
                if self.eat(b"}") {
                    return Some(Value::Obj(kv));
                }
                loop {
                    self.ws();
                    if self.b.get(self.i) != Some(&b'"') {
                        return None;
                    }
                    let k = self.string()?;
                    self.ws();
                    if !self.eat(b":") {
                        return None;
                    }
                    self.ws();
                    let v = self.value(depth + 1)?;
                    kv.push((k, v));
                    self.ws();
                    if self.eat(b",") {
                        continue;
                    }
                    if self.eat(b"}") {
                        return Some(Value::Obj(kv));
                    }
                    return None;
                }
            }
            b'[' => {
                self.i += 1;
                let mut a = Vec::new();
                self.ws();
                if self.eat(b"]") {
                    return Some(Value::Arr(a));
                }
                loop {
                    self.ws();
                    a.push(self.value(depth + 1)?);
                    self.ws();
                    if self.eat(b",") {
                        continue;
                    }
                    if self.eat(b"]") {
                        return Some(Value::Arr(a));
                    }
                    return None;
                }
            }
            b'"' => self.string().map(Value::Str),
            b't' => self.eat(b"true").then_some(Value::Bool(true)),
            b'f' => self.eat(b"false").then_some(Value::Bool(false)),
            b'n' => self.eat(b"null").then_some(Value::Null),
            // Python's json writes these for non-finite floats.
            b'N' => self.eat(b"NaN").then_some(Value::Null),
            b'I' => self.eat(b"Infinity").then_some(Value::Null),
            _ => {
                let start = self.i;
                if self.b[self.i] == b'-' {
                    self.i += 1;
                    if self.eat(b"Infinity") {
                        return Some(Value::Null);
                    }
                }
                while self.i < self.b.len() && matches!(self.b[self.i], b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-') {
                    self.i += 1;
                }
                let s = core::str::from_utf8(&self.b[start..self.i]).ok()?;
                s.parse::<f64>().ok().map(Value::Num)
            }
        }
    }
    fn hex4(&mut self) -> Option<u32> {
        let s = core::str::from_utf8(self.b.get(self.i..self.i + 4)?).ok()?;
        self.i += 4;
        u32::from_str_radix(s, 16).ok()
    }
    fn string(&mut self) -> Option<String> {
        self.i += 1;
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = *self.b.get(self.i)?;
            self.i += 1;
            match c {
                b'"' => return String::from_utf8(out).ok(),
                b'\\' => {
                    let e = *self.b.get(self.i)?;
                    self.i += 1;
                    let ch = match e {
                        b'n' => '\n',
                        b't' => '\t',
                        b'r' => '\r',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'u' => {
                            let mut cp = self.hex4()?;
                            if (0xD800..0xDC00).contains(&cp) && self.b.get(self.i..self.i + 2) == Some(b"\\u") {
                                self.i += 2;
                                let lo = self.hex4()?;
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo.wrapping_sub(0xDC00) & 0x3FF);
                            }
                            char::from_u32(cp).unwrap_or('\u{FFFD}')
                        }
                        other => other as char,
                    };
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                }
                _ => out.push(c),
            }
        }
    }
}

/// `s` as a JSON string literal, quotes included.
pub fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&alloc::format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A value written back out (used to pass the selected discovered papers on, as they came).
pub fn write(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Num(n) => out.push_str(&alloc::format!("{}", n)),
        Value::Str(s) => out.push_str(&quote(s)),
        Value::Arr(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(x, out);
            }
            out.push(']');
        }
        Value::Obj(kv) => {
            out.push('{');
            for (i, (k, x)) in kv.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&quote(k));
                out.push(':');
                write(x, out);
            }
            out.push('}');
        }
    }
}
