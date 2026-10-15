//! Face Mace for the desktop (owner, 2026-10-15: "make a downloadable version of FaceMace in .exe file for Windows").
//!
//! Face Mace already works entirely on the device: the browser decodes the photos, finds the faces and groups them;
//! nothing is uploaded. So the desktop program is the site's own Face Mace (the same ui.wasm and host.js) kept
//! inside this one file and served to the computer's browser at 127.0.0.1, an address no other machine can reach.
//! It opens the browser on it and runs until its window is closed.

// No console window on Windows: Face Mace lives in the browser, and quits by itself when its page is closed
// (owner, 2026-10-15: "make the exe file installable").
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
    "<script type=\"module\" src=\"/app/host.js\"></script>",
    // the page says it is still open: Face Mace quits a little after the last page is closed
    "<script>(function(){function a(){fetch('/__alive',{cache:'no-store'}).catch(function(){})}a();setInterval(a,10000)})()</script></html>"
);

/// Always the same address, so what the browser remembers (people, settings) is there next time, and a second
/// start finds the first one running.
const PORT: u16 = 47123;

/// When a page last said it was open (seconds since 1970); 0 before the first.
static ALIVE: AtomicU64 = AtomicU64::new(0);

/// When a page last said Face Mace was working (seconds since 1970; 0: not working). While it is, Windows is kept
/// from sleeping (owner, 2026-10-15: "dont let the windows sleep").
static BUSY: AtomicU64 = AtomicU64::new(0);

#[cfg(windows)]
mod power {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    const ES_AWAYMODE_REQUIRED: u32 = 0x0000_0040;
    /// Awake (the system; the screen may still turn off) or free to sleep again.
    pub fn keep_awake(on: bool) {
        unsafe {
            SetThreadExecutionState(if on { ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED } else { ES_CONTINUOUS });
        }
    }
}

#[cfg(not(windows))]
mod power {
    pub fn keep_awake(_on: bool) {}
}

fn now_s() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

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
        ("GET", "/__busy") => {
            BUSY.store(now_s(), Ordering::Relaxed);
            ALIVE.store(now_s(), Ordering::Relaxed);
            ("200 OK", "text/plain; charset=utf-8", b"ok".as_slice())
        }
        ("GET", "/__idle") => {
            BUSY.store(0, Ordering::Relaxed);
            ("200 OK", "text/plain; charset=utf-8", b"ok".as_slice())
        }
        ("GET", "/__alive") => {
            ALIVE.store(now_s(), Ordering::Relaxed);
            ("200 OK", "text/plain; charset=utf-8", b"ok".as_slice())
        }
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
    // the browser opened without a console window flashing up (CREATE_NO_WINDOW)
    #[cfg(target_os = "windows")]
    let r = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd").args(["/C", "start", "", url]).creation_flags(0x0800_0000).spawn()
    };
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(url).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(url).spawn();
    if r.is_err() {
        println!("Open this address in your browser: {}", url);
    }
}

/// Whether a Face Mace already answers at the port (then this start only opens the browser on it).
fn running_already(port: u16) -> bool {
    let Ok(mut c) = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(800)) else { return false };
    let _ = c.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = c.write_all(b"GET /facemace/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let mut buf = Vec::new();
    let _ = c.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).contains("Face Mace")
}

fn main() {
    let port = std::env::args().nth(1).and_then(|p| p.parse::<u16>().ok()).unwrap_or(PORT);
    let url = format!("http://127.0.0.1:{}/facemace/", port);
    let l = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(l) => l,
        Err(e) => {
            if running_already(port) {
                open_browser(&url);
                return;
            }
            // the port is someone else's: any free one (what is remembered then lasts this run only)
            match TcpListener::bind(("127.0.0.1", 0)) {
                Ok(l) => l,
                Err(_) => {
                    eprintln!("Face Mace could not start: {}", e);
                    std::process::exit(1);
                }
            }
        }
    };
    let port = l.local_addr().map(|a| a.port()).unwrap_or(port);
    let url = format!("http://127.0.0.1:{}/facemace/", port);
    println!("Face Mace is open in your browser at {}", url);
    println!("Your photos stay on this computer. Face Mace quits a minute after its page is closed.");
    if std::env::var_os("FACEMACE_NO_BROWSER").is_none() {
        open_browser(&url);
    }
    // quits when no page has said it is open for 90 seconds (or none came within 3 minutes of starting)
    let started = now_s();
    // one thread keeps Windows awake while a page says Face Mace is working (the setting belongs to the thread
    // that makes it, so the same one turns it off)
    thread::spawn(move || {
        let mut on = false;
        loop {
            let b = BUSY.load(Ordering::Relaxed);
            let want = b != 0 && now_s().saturating_sub(b) < 45;
            if want != on {
                power::keep_awake(want);
                on = want;
            }
            thread::sleep(Duration::from_secs(5));
        }
    });
    if std::env::var_os("FACEMACE_STAY").is_none() {
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(5));
            let last = ALIVE.load(Ordering::Relaxed);
            let quiet = if last == 0 { now_s().saturating_sub(started) > 180 } else { now_s().saturating_sub(last) > 90 };
            if quiet {
                std::process::exit(0);
            }
        });
    }
    for c in l.incoming().flatten() {
        thread::spawn(move || answer(c));
    }
}
