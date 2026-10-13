//! pifront — Pi Tech Lab's front door, in Rust on the standard library alone.
//!
//! One process listens on $PORT and does three things, in this order, for every request:
//!
//!   1. the gate: with SITE_PASSWORD set, nothing is served without the `pi_gate` cookie (an
//!      HMAC-SHA256 of the password with SESSION_SECRET, exactly as backend/gate.py makes it),
//!      except /api/health, /robots.txt and /api/gate itself; a browser gets the password page,
//!      an API caller a 401. The password is checked by the Python side (POST /api/gate, proxied),
//!      so there is one place that knows it.
//!   2. static files: a path that names a file under FRONTEND_DIR (../frontend by default) is
//!      served from here, with its content type and a cache header; the root and index.html are
//!      not, because the Python side stamps asset versions into index.html.
//!   3. everything else is passed through to the Python engines (UPSTREAM, 127.0.0.1:8001 by
//!      default): the request as it came, with X-Forwarded-* headers, and the response streamed
//!      back as it arrives, so the assessment's server-sent events reach the browser live.
//!
//! No dependencies: this builds offline in seconds, and nothing in the front door can go stale.
//! One thread per connection, `Connection: close` both ways: simple, and plenty behind a
//! platform's own load balancer. Engines are Python (backend/); see DESIGN.md.

mod sha256;

use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const COOKIE: &str = "pi_gate";
const OPEN: [&str; 3] = ["/api/gate", "/api/health", "/robots.txt"];
const PAGE: &str = include_str!("gate.html");

struct Config {
    upstream: String,
    frontend: PathBuf,
    password: String,
    secret: String,
}

impl Config {
    fn from_env() -> Config {
        let here = env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));
        let frontend = env::var("FRONTEND_DIR")
            .map(PathBuf::from)
            .ok()
            .or_else(|| ["frontend", "../frontend", "/app/frontend"].iter().map(PathBuf::from).find(|p| p.is_dir()))
            .or_else(|| here.map(|d| d.join("../frontend")))
            .unwrap_or_else(|| PathBuf::from("frontend"));
        Config {
            upstream: env::var("UPSTREAM").unwrap_or_else(|_| "127.0.0.1:8001".into()),
            frontend,
            password: env::var("SITE_PASSWORD").unwrap_or_default().trim().to_string(),
            secret: env::var("SESSION_SECRET").unwrap_or_default().trim().to_string(),
        }
    }
    /// The cookie value a visitor who typed the password carries: gate.py's `token`.
    fn token(&self) -> String {
        let key = if self.secret.is_empty() { self.password.as_bytes() } else { self.secret.as_bytes() };
        sha256::hex(&sha256::hmac_sha256(key, format!("gate:{}", self.password).as_bytes()))
    }
}

/// The head of a request: the line, the headers, and whatever body bytes came with it.
struct Head {
    method: String,
    target: String,
    version: String,
    headers: Vec<(String, String)>,
    raw: Vec<u8>, // the head's bytes, verbatim, so a proxied request is forwarded as it came
}

impl Head {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
    fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or("/")
    }
    fn query(&self) -> &str {
        self.target.splitn(2, '?').nth(1).unwrap_or("")
    }
    fn cookie(&self, name: &str) -> Option<String> {
        let c = self.header("cookie")?;
        c.split(';').map(|p| p.trim()).find_map(|p| {
            let (k, v) = p.split_once('=')?;
            if k.trim() == name { Some(v.trim().to_string()) } else { None }
        })
    }
}

fn read_head(reader: &mut BufReader<TcpStream>) -> io::Result<Option<Head>> {
    let mut raw = Vec::new();
    let mut line = String::new();
    // the request line
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    raw.extend_from_slice(line.as_bytes());
    let mut parts = line.trim_end().split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let version = parts.next().unwrap_or("HTTP/1.1").to_string();
    if method.is_empty() || !target.starts_with('/') {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "bad request line"));
    }
    let mut headers = Vec::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        raw.extend_from_slice(line.as_bytes());
        let t = line.trim_end_matches(['\r', '\n']);
        if t.is_empty() {
            break;
        }
        if let Some((k, v)) = t.split_once(':') {
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
        if raw.len() > 64 * 1024 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "head too large"));
        }
    }
    Ok(Some(Head { method, target, version, headers, raw }))
}

fn status_text(code: u16) -> &'static str {
    match code {
        200 => "OK",
        204 => "No Content",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "OK",
    }
}

fn respond(out: &mut TcpStream, code: u16, headers: &[(&str, &str)], body: &[u8]) -> io::Result<()> {
    let mut s = format!("HTTP/1.1 {} {}\r\n", code, status_text(code));
    for (k, v) in headers {
        s.push_str(&format!("{}: {}\r\n", k, v));
    }
    s.push_str(&format!("Content-Length: {}\r\nConnection: close\r\n\r\n", body.len()));
    out.write_all(s.as_bytes())?;
    out.write_all(body)?;
    out.flush()
}

// ---- the gate ---------------------------------------------------------------------------------

fn passes(cfg: &Config, head: &Head) -> bool {
    if cfg.password.is_empty() || OPEN.contains(&head.path()) {
        return true;
    }
    match head.cookie(COOKIE) {
        Some(got) => !got.is_empty() && sha256::eq_ct(&got, &cfg.token()),
        None => false,
    }
}

fn refuse(out: &mut TcpStream, head: &Head) -> io::Result<()> {
    let wants_html = head.method == "GET" && head.header("accept").map(|a| a.contains("text/html")).unwrap_or(false);
    if wants_html {
        respond(
            out,
            401,
            &[("Content-Type", "text/html; charset=utf-8"), ("Cache-Control", "no-store"), ("X-Robots-Tag", "noindex, nofollow")],
            PAGE.as_bytes(),
        )
    } else {
        respond(
            out,
            401,
            &[("Content-Type", "application/json"), ("Cache-Control", "no-store")],
            br#"{"detail":"This deployment is private."}"#,
        )
    }
}

// ---- static files -----------------------------------------------------------------------------

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "wasm" => "application/wasm",
        "pdf" => "application/pdf",
        "txt" | "md" | "asm" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The file a path names under the frontend directory, if it is a plain file inside it.
fn static_file(cfg: &Config, path: &str) -> Option<PathBuf> {
    if path == "/" || path == "/index.html" || path.starts_with("/api/") {
        return None; // the Python side stamps index.html's asset versions
    }
    let rel = percent_decode(path.trim_start_matches('/'));
    let p = Path::new(&rel);
    if p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None; // no "..", no absolute paths
    }
    let full = cfg.frontend.join(p);
    if full.is_file() { Some(full) } else { None }
}

fn serve_file(out: &mut TcpStream, head: &Head, file: &Path) -> io::Result<()> {
    if head.method != "GET" && head.method != "HEAD" {
        return respond(out, 405, &[("Allow", "GET, HEAD")], b"");
    }
    let data = fs::read(file)?;
    let etag = format!("\"{}\"", sha256::hex(&sha256::sha256(&data)[..8]));
    if head.header("if-none-match") == Some(etag.as_str()) {
        return respond(out, 304, &[("ETag", &etag)], b"");
    }
    let versioned = head.query().split('&').any(|q| q.starts_with("v="));
    let cache = if versioned { "public, max-age=31536000, immutable" } else { "no-cache" };
    let ct = content_type(file);
    let body: &[u8] = if head.method == "HEAD" { b"" } else { &data };
    let mut s = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nETag: {}\r\nCache-Control: {}\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        ct,
        data.len(),
        etag,
        cache
    );
    if ct.starts_with("text/html") {
        s = s.replace("Connection: close", "X-Frame-Options: SAMEORIGIN\r\nConnection: close");
    }
    out.write_all(s.as_bytes())?;
    out.write_all(body)?;
    out.flush()
}

// ---- the way through to the engines ----------------------------------------------------------

fn proxy(cfg: &Config, head: &Head, reader: BufReader<TcpStream>, out: &mut TcpStream, peer: &str) -> io::Result<()> {
    let mut up = match TcpStream::connect_timeout(&cfg.upstream.parse().map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "UPSTREAM"))?, Duration::from_secs(5)) {
        Ok(s) => s,
        Err(_) => {
            // the engines are not up (yet): the health check says so, a browser sees a plain note
            let (code, msg): (u16, &[u8]) = if head.path() == "/api/health" {
                (503, br#"{"status":"starting","detail":"The engines are not up yet."}"#)
            } else {
                (502, br#"{"detail":"The engines are not reachable right now."}"#)
            };
            return respond(out, code, &[("Content-Type", "application/json"), ("Cache-Control", "no-store"), ("Retry-After", "5")], msg);
        }
    };
    up.set_read_timeout(Some(Duration::from_secs(900)))?; // an assessment streams for minutes
    // the head as it came, less hop-by-hop headers, plus where it came from
    let mut s = format!("{} {} {}\r\n", head.method, head.target, head.version);
    let mut has_proto = false;
    let mut has_for = false;
    for (k, v) in &head.headers {
        let kl = k.to_ascii_lowercase();
        if kl == "connection" || kl == "keep-alive" || kl == "proxy-connection" {
            continue;
        }
        if kl == "x-forwarded-proto" {
            has_proto = true;
        }
        if kl == "x-forwarded-for" {
            has_for = true;
        }
        s.push_str(&format!("{}: {}\r\n", k, v));
    }
    if !has_proto {
        s.push_str("X-Forwarded-Proto: http\r\n");
    }
    if !has_for {
        s.push_str(&format!("X-Forwarded-For: {}\r\n", peer));
    }
    s.push_str("Connection: close\r\n\r\n");
    up.write_all(s.as_bytes())?;
    // the body: whatever the reader already buffered, then the rest of the connection, copied as it comes
    let body_len: Option<u64> = head.header("content-length").and_then(|v| v.parse().ok());
    let chunked = head.header("transfer-encoding").map(|v| v.to_ascii_lowercase().contains("chunked")).unwrap_or(false);
    let mut client_in = reader;
    if body_len.unwrap_or(0) > 0 || chunked {
        let mut up_w = up.try_clone()?;
        thread::spawn(move || {
            if let Some(n) = body_len {
                let mut lim = (&mut client_in).take(n);
                let _ = io::copy(&mut lim, &mut up_w);
            } else {
                let _ = io::copy(&mut client_in, &mut up_w);
            }
            let _ = up_w.shutdown(std::net::Shutdown::Write);
        });
    } else {
        let _ = up.shutdown(std::net::Shutdown::Write);
    }
    // the response, streamed back as it arrives (server-sent events included)
    let mut buf = [0u8; 16 * 1024];
    loop {
        let n = match up.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        if out.write_all(&buf[..n]).is_err() {
            break;
        }
        let _ = out.flush();
    }
    Ok(())
}

// ---- one connection ---------------------------------------------------------------------------

fn handle(cfg: Arc<Config>, stream: TcpStream) {
    let peer = stream.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default();
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
    let mut out = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut reader = BufReader::with_capacity(32 * 1024, stream);
    let head = match read_head(&mut reader) {
        Ok(Some(h)) => h,
        Ok(None) => return,
        Err(_) => {
            let _ = respond(&mut out, 400, &[("Content-Type", "text/plain")], b"bad request");
            return;
        }
    };
    let result = if !passes(&cfg, &head) {
        refuse(&mut out, &head)
    } else if let Some(file) = static_file(&cfg, head.path()) {
        serve_file(&mut out, &head, &file)
    } else {
        proxy(&cfg, &head, reader, &mut out, &peer)
    };
    if let Err(e) = result {
        eprintln!("[pifront] {} {}: {}", head.method, head.path(), e);
    }
    let _ = out.shutdown(std::net::Shutdown::Both);
}

fn main() {
    let cfg = Arc::new(Config::from_env());
    let port = env::var("PORT").unwrap_or_else(|_| "8000".into());
    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).unwrap_or_else(|e| {
        eprintln!("[pifront] cannot listen on {}: {}", addr, e);
        std::process::exit(1);
    });
    eprintln!(
        "[pifront] listening on {} · frontend {} · engines at {} · gate {}",
        addr,
        cfg.frontend.display(),
        cfg.upstream,
        if cfg.password.is_empty() { "off" } else { "on" }
    );
    for conn in listener.incoming() {
        match conn {
            Ok(stream) => {
                let cfg = Arc::clone(&cfg);
                thread::spawn(move || handle(cfg, stream));
            }
            Err(e) => eprintln!("[pifront] accept: {}", e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn head(line: &str, headers: &[(&str, &str)]) -> Head {
        let mut p = line.split_whitespace();
        Head {
            method: p.next().unwrap().into(),
            target: p.next().unwrap().into(),
            version: "HTTP/1.1".into(),
            headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            raw: vec![],
        }
    }
    fn cfg(pw: &str, secret: &str) -> Config {
        Config { upstream: "127.0.0.1:1".into(), frontend: PathBuf::from("../../frontend"), password: pw.into(), secret: secret.into() }
    }
    #[test]
    fn gate_off_passes_everything() {
        assert!(passes(&cfg("", ""), &head("GET /anything", &[])));
    }
    #[test]
    fn gate_on_needs_the_cookie() {
        let c = cfg("pw", "secret");
        assert!(!passes(&c, &head("GET /", &[])));
        assert!(passes(&c, &head("GET /api/health", &[])));
        assert!(passes(&c, &head("POST /api/gate", &[])));
        let cookie = format!("a=b; pi_gate={}; c=d", c.token());
        assert!(passes(&c, &head("GET /app.js", &[("Cookie", &cookie)])));
        assert!(!passes(&c, &head("GET /app.js", &[("Cookie", "pi_gate=nope")])));
        // the same token gate.py would set: hmac(secret, "gate:pw")
        assert_eq!(c.token(), "61064040b5649b6241d4418f9b0466c1afbe56d8f125d26138d9fb31709b3bad");
    }
    #[test]
    fn static_paths() {
        let c = cfg("", "");
        assert!(static_file(&c, "/").is_none());
        assert!(static_file(&c, "/index.html").is_none());
        assert!(static_file(&c, "/api/build").is_none());
        assert!(static_file(&c, "/../Cargo.toml").is_none());
        assert!(static_file(&c, "/%2e%2e/Cargo.toml").is_none());
        assert!(static_file(&c, "/app.js").is_some());
        assert!(static_file(&c, "/super/loop.js").is_some());
        assert!(static_file(&c, "/no-such-file.js").is_none());
        assert!(static_file(&c, "/super").is_none()); // a directory is not a file
    }
    #[test]
    fn content_types() {
        assert_eq!(content_type(Path::new("a.woff2")), "font/woff2");
        assert_eq!(content_type(Path::new("x/y.mjs")), "text/javascript; charset=utf-8");
        assert_eq!(content_type(Path::new("hal/shell.img")), "application/octet-stream");
    }
}
