//! `superai`: the SuperAI engine on the command line. Reads a JSON request (see lib.rs) from a file
//! or standard input and prints the answer.
//!
//!   superai request.json
//!   echo '{"op":"call","program":…,"function":"percent","inputs":{"part":1,"whole":4}}' | superai
use std::io::Read;

fn main() {
    let mut text = String::new();
    match std::env::args().nth(1) {
        Some(path) => text = std::fs::read_to_string(&path).unwrap_or_else(|e| { eprintln!("superai: {}: {}", path, e); std::process::exit(2) }),
        None => { std::io::stdin().read_to_string(&mut text).expect("stdin"); }
    }
    println!("{}", superai::handle(&text));
}
