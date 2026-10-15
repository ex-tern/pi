//! Face Mace for the desktop (owner, 2026-10-15: "make a downloadable version of FaceMace in .exe file for Windows").
//!
//! Face Mace already works entirely on the device: the browser decodes the photos, finds the faces and groups them;
//! nothing is uploaded. So the desktop program is the site's own Face Mace (the same ui.wasm and host.js) kept
//! inside this one file and served to the computer's browser at 127.0.0.1, an address no other machine can reach.
//! It opens the browser on it and runs until its window is closed.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

const HOST_JS: &[u8] = include_bytes!("../../../../front/app/host.js");
const UI_WASM: &[u8] = include_bytes!("../../../../front/app/ui.wasm");
const CASCADE: &[u8] = include_bytes!("../../../../front/facemace/cascade.json");
const GEIST: &[u8] = include_bytes!("../../../../front/fonts/Geist-Variable.woff2");
const GEIST_MONO: &[u8] = include_bytes!("../../../../front/fonts/GeistMono-Variable.woff2");
const ICON: &[u8] = include_bytes!("../../../../front/icon.svg");
/// libheif (LGPL-3.0, front/facemace/heic/NOTICE.txt): decodes HEIC photos where the browser cannot
const HEIC: &[u8] = include_bytes!("../../../../front/facemace/heic/libheif-bundle.mjs");
/// the neural face engines (front/facemace/ml/NOTICE.txt): the second profile cascade, ONNX Runtime, YuNet, SFace
const PROFILE: &[u8] = include_bytes!("../../../../front/facemace/cascade-profile.json");
const ORT_MJS: &[u8] = include_bytes!("../../../../front/facemace/ml/ort.wasm.min.mjs");
const ORT_GLUE: &[u8] = include_bytes!("../../../../front/facemace/ml/ort-wasm-simd-threaded.mjs");
const ORT_WASM: &[u8] = include_bytes!("../../../../front/facemace/ml/ort-wasm-simd-threaded.wasm");
const YUNET: &[u8] = include_bytes!("../../../../front/facemace/ml/yunet.onnx");
const SFACE: &[u8] = include_bytes!("../../../../front/facemace/ml/sface.onnx");

/// The one document: like the site's, but it opens on Face Mace alone.
const PAGE: &str = concat!(
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>Face Mace</title><link rel=\"icon\" href=\"/icon.svg\">",
    "<script type=\"module\" src=\"/app/host.js\"></script></html>"
);

fn answer(mut s: TcpStream) {
    let mut r = BufReader::new(match s.try_clone() {
        Ok(c) => c,
        Err(_) => return,
    });
    let mut line = String::new();
    if r.read_line(&mut line).is_err() {
        return;
    }
    // the headers, and a body if one is sent (read and dropped: nothing here takes uploads)
    let mut len = 0usize;
    loop {
        let mut h = String::new();
        if r.read_line(&mut h).unwrap_or(0) == 0 || h == "\r\n" || h == "\n" {
            break;
        }
        if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
            len = v.trim().parse().unwrap_or(0);
        }
    }
    if len > 0 {
        let mut sink = vec![0u8; len.min(1 << 20)];
        let _ = r.read_exact(&mut sink);
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");
    let path = target.split(['?', '#']).next().unwrap_or("/");
    let (status, kind, body): (&str, &str, &[u8]) = match (method, path) {
        ("GET", "/") | ("GET", "/facemace") | ("GET", "/facemace/") | ("GET", "/index.html") => ("200 OK", "text/html; charset=utf-8", PAGE.as_bytes()),
        ("GET", "/app/host.js") => ("200 OK", "text/javascript; charset=utf-8", HOST_JS),
        ("GET", "/app/ui.wasm") => ("200 OK", "application/wasm", UI_WASM),
        ("GET", "/facemace/cascade.json") => ("200 OK", "application/json", CASCADE),
        ("GET", "/fonts/Geist-Variable.woff2") => ("200 OK", "font/woff2", GEIST),
        ("GET", "/fonts/GeistMono-Variable.woff2") => ("200 OK", "font/woff2", GEIST_MONO),
        ("GET", "/icon.svg") => ("200 OK", "image/svg+xml", ICON),
        ("GET", "/facemace/heic/libheif-bundle.mjs") => ("200 OK", "text/javascript; charset=utf-8", HEIC),
        ("GET", "/facemace/cascade-profile.json") => ("200 OK", "application/json", PROFILE),
        ("GET", "/facemace/ml/ort.wasm.min.mjs") => ("200 OK", "text/javascript; charset=utf-8", ORT_MJS),
        ("GET", "/facemace/ml/ort-wasm-simd-threaded.mjs") => ("200 OK", "text/javascript; charset=utf-8", ORT_GLUE),
        ("GET", "/facemace/ml/ort-wasm-simd-threaded.wasm") => ("200 OK", "application/wasm", ORT_WASM),
        ("GET", "/facemace/ml/yunet.onnx") => ("200 OK", "application/octet-stream", YUNET),
        ("GET", "/facemace/ml/sface.onnx") => ("200 OK", "application/octet-stream", SFACE),
        // the site's server is not here: its questions get a plain "not here"
        (_, p) if p.starts_with("/api/") => ("404 Not Found", "application/json", b"{\"detail\":\"Face Mace runs on its own here: no server.\"}"),
        _ => ("404 Not Found", "text/plain; charset=utf-8", b"Not here."),
    };
    let head = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        status,
        kind,
        body.len()
    );
    let _ = s.write_all(head.as_bytes());
    if method != "HEAD" {
        let _ = s.write_all(body);
    }
    let _ = s.flush();
}

fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(url).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(url).spawn();
    if r.is_err() {
        println!("Open this address in your browser: {}", url);
    }
}

fn main() {
    // a port of its own, chosen by the system; 127.0.0.1 only, so no other machine can reach it
    let fixed = std::env::args().nth(1).and_then(|p| p.parse::<u16>().ok()).unwrap_or(0);
    let l = match TcpListener::bind(("127.0.0.1", fixed)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Face Mace could not start: {}", e);
            std::process::exit(1);
        }
    };
    let port = l.local_addr().map(|a| a.port()).unwrap_or(0);
    let url = format!("http://127.0.0.1:{}/facemace/", port);
    println!("Face Mace is open in your browser at {}", url);
    println!("Your photos stay on this computer. Close this window to quit Face Mace.");
    if std::env::var_os("FACEMACE_NO_BROWSER").is_none() {
        open_browser(&url);
    }
    for c in l.incoming().flatten() {
        thread::spawn(move || answer(c));
    }
}
