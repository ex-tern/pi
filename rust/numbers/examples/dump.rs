// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Ali Vafadar Yengejeh (Pi Tech Lab). Part of ScholarPi's open science engines: see LICENSE.
fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let t = std::time::Instant::now();
    let s = numbers::handle(&format!("{} {}", a[0], a[1]));
    eprintln!("{} {} in {:?}", a[0], a[1], t.elapsed());
    println!("{}", s);
}
