//! The web, as piii OS's browser reads it (owner, 2026-10-17: "add a simple browser to reach piii.app on piii os"):
//! addresses, HTTP/1.1 requests and answers (chunked too), HTML made into text and links, and JSON. No network
//! here (net.rs on the machine): this part runs the same on any computer, and is tested there.
//!
//! What it cannot do: HTTPS (no encryption yet: plain http:// only), scripts, pictures, styles. piii.app itself is a
//! WebAssembly program, which this browser does not run; it reads piii.app's open data instead (the Open portal).

use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// An address: http://host[:port]/path
#[derive(Clone, Debug, PartialEq)]
pub struct Url {
    pub host: String,
    pub port: u16,
    pub path: String,
}

impl Url {
    pub fn parse(s: &str) -> Result<Url, String> {
        let s = s.trim();
        if s.is_empty() {
            return Err("Type an address, like piii.app".into());
        }
        let lower = s.to_ascii_lowercase();
        if lower.starts_with("https://") {
            return Err("https:// is not possible yet: piii OS has no encryption. Try the same address with http://".into());
        }
        let rest = if lower.starts_with("http://") { &s[7..] } else { s };
        let (hostport, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, "/"),
        };
        let (host, port) = match hostport.rfind(':') {
            Some(i) => (&hostport[..i], hostport[i + 1..].parse::<u16>().map_err(|_| "That port is not a number.".to_string())?),
            None => (hostport, 80),
        };
        if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
            return Err(format!("\"{}\" is not an address piii OS can reach.", host));
        }
        Ok(Url { host: host.to_ascii_lowercase(), port, path: if path.is_empty() { "/".into() } else { path.into() } })
    }

    pub fn text(&self) -> String {
        if self.port == 80 { format!("http://{}{}", self.host, self.path) } else { format!("http://{}:{}{}", self.host, self.port, self.path) }
    }

    /// A link found on this page, made whole.
    pub fn join(&self, href: &str) -> Option<String> {
        let h = href.trim();
        let lower = h.to_ascii_lowercase();
        if lower.starts_with("http://") || lower.starts_with("https://") {
            return Some(h.into());
        }
        if lower.starts_with("javascript:") || lower.starts_with("mailto:") || h.starts_with('#') || h.is_empty() {
            return None;
        }
        let base = if self.port == 80 { format!("http://{}", self.host) } else { format!("http://{}:{}", self.host, self.port) };
        if let Some(r) = h.strip_prefix("//") {
            return Some(format!("http://{}", r));
        }
        if h.starts_with('/') {
            return Some(format!("{}{}", base, h));
        }
        let dir = match self.path.rfind('/') {
            Some(i) => &self.path[..=i],
            None => "/",
        };
        Some(format!("{}{}{}", base, dir, h))
    }
}

/// The request piii OS sends: the whole of it, as bytes.
pub fn request(method: &str, url: &Url, body: &str, ctype: &str) -> Vec<u8> {
    let host = if url.port == 80 { url.host.clone() } else { format!("{}:{}", url.host, url.port) };
    let mut r = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: Mozilla/5.0 (compatible; piiiOS/0.1; +https://piii.app)\r\nAccept: text/html,application/json,text/plain,*/*\r\nAccept-Encoding: identity\r\nConnection: close\r\n",
        method, url.path, host
    );
    if method != "GET" {
        r.push_str(&format!("Content-Type: {}\r\nContent-Length: {}\r\n", ctype, body.len()));
    }
    r.push_str("\r\n");
    r.push_str(body);
    r.into_bytes()
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub reason: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    /// An answer as it came off the wire: status line, headers, then the body (chunked or not).
    pub fn parse(raw: &[u8]) -> Result<Response, String> {
        let end = find(raw, b"\r\n\r\n").ok_or("The server's answer ended before its headers did.")?;
        let head = String::from_utf8_lossy(&raw[..end]).into_owned();
        let mut lines = head.split("\r\n");
        let first = lines.next().unwrap_or("");
        let mut parts = first.splitn(3, ' ');
        let proto = parts.next().unwrap_or("");
        if !proto.starts_with("HTTP/") {
            return Err("The server did not answer in HTTP.".into());
        }
        let status = parts.next().and_then(|x| x.parse().ok()).ok_or("The server's answer has no status.")?;
        let reason = parts.next().unwrap_or("").to_string();
        let headers: Vec<(String, String)> = lines
            .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
            .collect();
        let rest = &raw[end + 4..];
        let chunked = headers.iter().any(|(k, v)| k.eq_ignore_ascii_case("transfer-encoding") && v.to_ascii_lowercase().contains("chunked"));
        let body = if chunked { dechunk(rest) } else {
            match headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("content-length")).and_then(|(_, v)| v.parse::<usize>().ok()) {
                Some(n) => rest[..n.min(rest.len())].to_vec(),
                None => rest.to_vec(),
            }
        };
        Ok(Response { status, reason, headers, body })
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

fn find(h: &[u8], n: &[u8]) -> Option<usize> {
    h.windows(n.len()).position(|w| w == n)
}

fn dechunk(mut b: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let Some(e) = find(b, b"\r\n") else { break };
        let size_s = String::from_utf8_lossy(&b[..e]);
        let size_s = size_s.split(';').next().unwrap_or("").trim().to_string();
        let Ok(n) = usize::from_str_radix(&size_s, 16) else { break };
        b = &b[e + 2..];
        if n == 0 {
            break;
        }
        let take = n.min(b.len());
        out.extend_from_slice(&b[..take]);
        b = &b[take..];
        if b.starts_with(b"\r\n") {
            b = &b[2..];
        }
    }
    out
}

// ------------------------------------------------------------------------------------------------ pages as text

/// What a page shows, in order.
#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    Heading(String),
    Text(String),
    /// a link: its words and where it goes
    Link(String, String),
}

/// An HTML page as headings, paragraphs and links (scripts and styles left out).
pub fn html(src: &str, base: &Url) -> (String, Vec<Item>) {
    let mut items = Vec::new();
    let mut title = String::new();
    let mut cur = String::new();
    let mut link: Option<(String, String)> = None;
    let mut heading = false;
    let b = src.as_bytes();
    let mut i = 0;
    let flush = |cur: &mut String, items: &mut Vec<Item>, heading: bool| {
        let t = squeeze(cur);
        if !t.is_empty() {
            items.push(if heading { Item::Heading(t) } else { Item::Text(t) });
        }
        cur.clear();
    };
    while i < b.len() {
        if b[i] == b'<' {
            let Some(close) = src[i..].find('>') else { break };
            let tag = &src[i + 1..i + close];
            i += close + 1;
            if tag.starts_with("!--") {
                // a comment: to its end
                if let Some(e) = src[i - close - 1..].find("-->") {
                    i = i - close - 1 + e + 3;
                }
                continue;
            }
            let end_tag = tag.starts_with('/');
            let name: String = tag.trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
            match name.as_str() {
                "script" | "style" | "noscript" | "svg" | "template" if !end_tag => {
                    let closing = format!("</{}", name);
                    match src[i..].to_ascii_lowercase().find(&closing) {
                        Some(e) => {
                            i += e;
                            if let Some(c) = src[i..].find('>') {
                                i += c + 1;
                            }
                        }
                        None => i = b.len(),
                    }
                }
                "title" if !end_tag => {
                    if let Some(e) = src[i..].to_ascii_lowercase().find("</title") {
                        title = squeeze(&entities(&src[i..i + e]));
                        i += e;
                    }
                }
                "a" if !end_tag => {
                    flush(&mut cur, &mut items, heading);
                    let href = attr(tag, "href").unwrap_or_default();
                    link = Some((href, String::new()));
                }
                "a" => {
                    if let Some((href, words)) = link.take() {
                        let words = squeeze(&words);
                        if let Some(to) = base.join(&href) {
                            items.push(Item::Link(if words.is_empty() { to.clone() } else { words }, to));
                        } else if !words.is_empty() {
                            cur.push_str(&words);
                        }
                    }
                }
                "h1" | "h2" | "h3" | "h4" => {
                    flush(&mut cur, &mut items, heading);
                    heading = !end_tag;
                }
                "p" | "div" | "br" | "li" | "tr" | "section" | "article" | "header" | "footer" | "ul" | "ol" | "table" | "blockquote" | "pre" | "form" | "main" | "nav" => {
                    flush(&mut cur, &mut items, heading);
                }
                "td" | "th" => cur.push(' '),
                _ => {}
            }
        } else {
            let next = src[i..].find('<').map(|n| i + n).unwrap_or(b.len());
            let t = entities(&src[i..next]);
            match link.as_mut() {
                Some((_, words)) => words.push_str(&t),
                None => cur.push_str(&t),
            }
            i = next;
        }
    }
    flush(&mut cur, &mut items, heading);
    (title, items)
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let at = lower.find(&format!("{}=", name))?;
    let v = &tag[at + name.len() + 1..];
    let v = v.trim_start();
    if let Some(q) = v.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let rest = &v[1..];
        let e = rest.find(q)?;
        Some(entities(&rest[..e]))
    } else {
        Some(v.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or("").to_string())
    }
}

fn squeeze(s: &str) -> String {
    let mut out = String::new();
    for w in s.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(w);
    }
    out
}

fn entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::new();
    let mut rest = s;
    while let Some(a) = rest.find('&') {
        out.push_str(&rest[..a]);
        rest = &rest[a..];
        let Some(e) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let name = &rest[1..e];
        let c = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "hellip" => Some('…'),
            "copy" => Some('©'),
            _ if name.starts_with("#x") || name.starts_with("#X") => u32::from_str_radix(&name[2..], 16).ok().and_then(char::from_u32),
            _ if name.starts_with('#') => name[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match c {
            Some(c) => {
                out.push(c);
                rest = &rest[e + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

// ------------------------------------------------------------------------------------------------ JSON

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

pub const NULL: Json = Json::Null;

impl Json {
    pub fn parse(s: &str) -> Option<Json> {
        let b = s.as_bytes();
        let mut i = 0;
        let v = value(b, &mut i)?;
        ws(b, &mut i);
        if i == b.len() { Some(v) } else { None }
    }
    pub fn get(&self, k: &str) -> &Json {
        match self {
            Json::Obj(o) => o.iter().find(|(n, _)| n == k).map(|(_, v)| v).unwrap_or(&NULL),
            _ => &NULL,
        }
    }
    pub fn arr(&self) -> &[Json] {
        match self {
            Json::Arr(a) => a,
            _ => &[],
        }
    }
    pub fn text(&self) -> String {
        match self {
            Json::Null => String::new(),
            Json::Bool(b) => b.to_string(),
            Json::Num(n) => num(*n),
            Json::Str(s) => s.clone(),
            _ => String::new(),
        }
    }
    pub fn f(&self) -> f64 {
        match self {
            Json::Num(n) => *n,
            _ => 0.0,
        }
    }
    pub fn truthy(&self) -> bool {
        matches!(self, Json::Bool(true))
    }

    /// Laid out to read: one value a line, indented.
    pub fn pretty(&self, depth: usize, out: &mut Vec<String>, key: &str) {
        let pad = "  ".repeat(depth);
        let k = if key.is_empty() { String::new() } else { format!("{}: ", key) };
        match self {
            Json::Arr(a) if !a.is_empty() => {
                out.push(format!("{}{}[", pad, k));
                for v in a {
                    v.pretty(depth + 1, out, "");
                }
                out.push(format!("{}]", pad));
            }
            Json::Obj(o) if !o.is_empty() => {
                out.push(format!("{}{}{{", pad, k));
                for (n, v) in o {
                    v.pretty(depth + 1, out, n);
                }
                out.push(format!("{}}}", pad));
            }
            Json::Arr(_) => out.push(format!("{}{}[]", pad, k)),
            Json::Obj(_) => out.push(format!("{}{}{{}}", pad, k)),
            Json::Str(s) => out.push(format!("{}{}\"{}\"", pad, k, s)),
            v => out.push(format!("{}{}{}", pad, k, if matches!(v, Json::Null) { "null".into() } else { v.text() })),
        }
    }
}

fn num(n: f64) -> String {
    if n == (n as i64) as f64 && n.abs() < 1e15 { format!("{}", n as i64) } else { format!("{}", n) }
}

fn ws(b: &[u8], i: &mut usize) {
    while *i < b.len() && matches!(b[*i], b' ' | b'\n' | b'\r' | b'\t') {
        *i += 1;
    }
}

fn value(b: &[u8], i: &mut usize) -> Option<Json> {
    ws(b, i);
    match *b.get(*i)? {
        b'{' => {
            *i += 1;
            let mut o = Vec::new();
            ws(b, i);
            if b.get(*i) == Some(&b'}') {
                *i += 1;
                return Some(Json::Obj(o));
            }
            loop {
                ws(b, i);
                let Json::Str(k) = string(b, i)? else { return None };
                ws(b, i);
                if b.get(*i) != Some(&b':') {
                    return None;
                }
                *i += 1;
                o.push((k, value(b, i)?));
                ws(b, i);
                match b.get(*i)? {
                    b',' => *i += 1,
                    b'}' => {
                        *i += 1;
                        return Some(Json::Obj(o));
                    }
                    _ => return None,
                }
            }
        }
        b'[' => {
            *i += 1;
            let mut a = Vec::new();
            ws(b, i);
            if b.get(*i) == Some(&b']') {
                *i += 1;
                return Some(Json::Arr(a));
            }
            loop {
                a.push(value(b, i)?);
                ws(b, i);
                match b.get(*i)? {
                    b',' => *i += 1,
                    b']' => {
                        *i += 1;
                        return Some(Json::Arr(a));
                    }
                    _ => return None,
                }
            }
        }
        b'"' => string(b, i),
        b't' if b[*i..].starts_with(b"true") => {
            *i += 4;
            Some(Json::Bool(true))
        }
        b'f' if b[*i..].starts_with(b"false") => {
            *i += 5;
            Some(Json::Bool(false))
        }
        b'n' if b[*i..].starts_with(b"null") => {
            *i += 4;
            Some(Json::Null)
        }
        _ => {
            let s = *i;
            while *i < b.len() && matches!(b[*i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
                *i += 1;
            }
            let t = core::str::from_utf8(&b[s..*i]).ok()?;
            t.parse::<f64>().ok().map(Json::Num)
        }
    }
}

fn string(b: &[u8], i: &mut usize) -> Option<Json> {
    if b.get(*i) != Some(&b'"') {
        return None;
    }
    *i += 1;
    let mut out: Vec<u8> = Vec::new();
    loop {
        let c = *b.get(*i)?;
        *i += 1;
        match c {
            b'"' => return Some(Json::Str(String::from_utf8_lossy(&out).into_owned())),
            b'\\' => {
                let e = *b.get(*i)?;
                *i += 1;
                match e {
                    b'n' => out.push(b'\n'),
                    b't' => out.push(b'\t'),
                    b'r' => out.push(b'\r'),
                    b'b' | b'f' => {}
                    b'u' => {
                        let h = core::str::from_utf8(b.get(*i..*i + 4)?).ok()?;
                        *i += 4;
                        let mut cp = u32::from_str_radix(h, 16).ok()?;
                        // a pair of halves (characters beyond the first 65 536)
                        if (0xD800..0xDC00).contains(&cp) && b.get(*i) == Some(&b'\\') && b.get(*i + 1) == Some(&b'u') {
                            let h2 = core::str::from_utf8(b.get(*i + 2..*i + 6)?).ok()?;
                            let lo = u32::from_str_radix(h2, 16).ok()?;
                            *i += 6;
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        }
                        let ch = char::from_u32(cp).unwrap_or('?');
                        let mut buf = [0u8; 4];
                        out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                    }
                    o => out.push(o),
                }
            }
            o => out.push(o),
        }
    }
}

/// Text as a JSON string, quotes included.
pub fn quote(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => {}
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => {}
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses() {
        assert_eq!(Url::parse("piii.app").unwrap(), Url { host: "piii.app".into(), port: 80, path: "/".into() });
        assert_eq!(Url::parse("http://10.0.2.2:8080/a/b?c=1").unwrap(), Url { host: "10.0.2.2".into(), port: 8080, path: "/a/b?c=1".into() });
        assert!(Url::parse("https://piii.app").unwrap_err().contains("http://"));
        let u = Url::parse("http://x.org/a/b.html").unwrap();
        assert_eq!(u.join("c.html").unwrap(), "http://x.org/a/c.html");
        assert_eq!(u.join("/d").unwrap(), "http://x.org/d");
        assert_eq!(u.join("#top"), None);
    }

    #[test]
    fn answers() {
        let r = Response::parse(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n").unwrap();
        assert_eq!((r.status, r.text().as_str(), r.header("content-type")), (200, "hello world", Some("text/html")));
        let r = Response::parse(b"HTTP/1.1 301 Moved\r\nLocation: https://piii.app/\r\nContent-Length: 0\r\n\r\n").unwrap();
        assert_eq!((r.status, r.header("location")), (301, Some("https://piii.app/")));
        let q = String::from_utf8(request("POST", &Url::parse("piii.app/api/portal").unwrap(), "{}", "application/json")).unwrap();
        assert!(q.starts_with("POST /api/portal HTTP/1.1\r\nHost: piii.app\r\n") && q.contains("Content-Length: 2\r\n") && q.ends_with("\r\n\r\n{}"));
    }

    #[test]
    fn pages() {
        let base = Url::parse("http://e.org/x/").unwrap();
        let (t, items) = html("<html><head><title>Hi &amp; you</title><style>p{}</style><script>var a='<p>';</script></head><body><h1>Big</h1><p>One <b>two</b>&nbsp;three. <a href=\"/more\">More</a></p><!-- no --><p>Last</p></body></html>", &base);
        assert_eq!(t, "Hi & you");
        assert_eq!(items, alloc::vec![Item::Heading("Big".into()), Item::Text("One two three.".into()), Item::Link("More".into(), "http://e.org/more".into()), Item::Text("Last".into())]);
    }

    #[test]
    fn json() {
        let j = Json::parse(r#"{"posts":[{"id":3,"text":"a\nb é😀","name":""}],"more":false,"total":1}"#).unwrap();
        assert_eq!(j.get("posts").arr()[0].get("text").text(), "a\nb é😀");
        assert_eq!(j.get("total").f(), 1.0);
        assert_eq!(quote("a\"b\n"), "\"a\\\"b\\n\"");
        let mut lines = Vec::new();
        j.pretty(0, &mut lines, "");
        assert_eq!(lines[0], "{");
    }
}
