fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let t = std::time::Instant::now();
    let s = numbers::handle(&format!("{} {}", a[0], a[1]));
    eprintln!("{} {} in {:?}", a[0], a[1], t.elapsed());
    println!("{}", s);
}
