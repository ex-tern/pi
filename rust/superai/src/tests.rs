use super::*;
use crate::lang::{engine, num_text, op_of, Value};

fn call(program: &str, func: &str, inputs: &str) -> String {
    let req = format!(r#"{{"op":"call","program":{},"function":"{}","inputs":{}}}"#, program, func, inputs);
    let out = json::parse(&handle(&req)).unwrap();
    assert_eq!(out.get("ok"), Some(&Json::Bool(true)), "{}", handle(&req));
    out.get("outputs").unwrap().get("out").unwrap().s("text").unwrap().to_string()
}

const FUNCS: &str = r#"{"language":"SuperAI 1","diagram":{"supers":[],"wires":[]},"functions":{
 "percent":{"supers":[{"id":"part","kind":"input"},{"id":"whole","kind":"input"},{"id":"hundred","text":"100"},
   {"id":"mul","text":"×"},{"id":"div","text":"/"},{"id":"r","text":"round"},{"id":"out","kind":"output"}],
   "wires":[["hundred.output","mul.input"],["part.output","mul.input"],["mul.output","div.input"],["whole.output","div.input"],
     ["div.output","r.input"],["whole.output","r.condition"],["r.output","out.input"]]},
 "ago":{"supers":[{"id":"m","kind":"input"},{"id":"one","text":"1"},{"id":"lt1","text":"<"},{"id":"jn","text":"just now"},
   {"id":"sixty","text":"60"},{"id":"lt60","text":"<"},{"id":"minw","text":"min ago"},{"id":"mins","text":"+"},
   {"id":"day","text":"1440"},{"id":"lt1440","text":"<"},{"id":"dh","text":"/"},{"id":"rh","text":"round"},{"id":"hw","text":"h ago"},{"id":"hrs","text":"+"},
   {"id":"dd","text":"/"},{"id":"rd","text":"round"},{"id":"dw","text":"d ago"},{"id":"days","text":"+"},
   {"id":"pick"},{"id":"out","kind":"output"}],
   "wires":[["m.output","lt1.input"],["one.output","lt1.input"],["lt1.output","jn.condition"],
     ["m.output","lt60.input"],["sixty.output","lt60.input"],["m.output","mins.input"],["minw.output","mins.input"],["lt60.output","mins.condition"],
     ["m.output","lt1440.input"],["day.output","lt1440.input"],["m.output","dh.input"],["sixty.output","dh.input"],["dh.output","rh.input"],
     ["rh.output","hrs.input"],["hw.output","hrs.input"],["lt1440.output","hrs.condition"],
     ["m.output","dd.input"],["day.output","dd.input"],["dd.output","rd.input"],["rd.output","days.input"],["dw.output","days.input"],
     ["jn.output","pick.input"],["mins.output","pick.input"],["hrs.output","pick.input"],["days.output","pick.input"],["pick.output","out.input"]]}
}}"#;

#[test]
fn numbers_read_like_the_page() {
    assert_eq!(num_text(5.0), "5");
    assert_eq!(num_text(2.5), "2.500");
    assert_eq!(num_text(f64::NAN), "NaN");
    assert_eq!(op_of(" × "), Some(lang::Op::Mul));
    assert_eq!(op_of("hello"), None);
}

#[test]
fn engine_computes_what_is_computable() {
    // 2, 3 into a super with + typed: 5
    assert_eq!(engine("+", &[Value::Num(2.0), Value::Num(3.0)], None, ""), Value::Num(5.0));
    // 3, 5 wired in, + attached anywhere: 8
    assert_eq!(engine("", &[Value::Num(3.0), Value::Num(5.0)], op_of("+"), ""), Value::Num(8.0));
    // an operator wired in as a value works on the numbers
    assert_eq!(engine("", &[Value::Num(6.0), Value::Text("×".into()), Value::Num(7.0)], None, ""), Value::Num(42.0));
    // a number typed in is that number; numbers alone are just themselves
    assert_eq!(engine("12", &[], None, ""), Value::Num(12.0));
    assert_eq!(engine("", &[Value::Num(4.0)], None, ""), Value::Num(4.0));
    // a verb is an instruction, a question is asked, nothing shows the hint
    assert_eq!(engine("open", &[], None, ""), Value::Verb("open".into()));
    assert_eq!(engine("", &[Value::Text("run".into())], None, ""), Value::Verb("run".into()));
    assert_eq!(engine("why?", &[Value::Num(1.0)], None, ""), Value::Ask("why? (wired in: 1)".into()));
    // a label with numbers: the number; with an operator attached: the result ("math" with 4, 3 and + attached: 7)
    assert_eq!(engine("math", &[Value::Num(4.0), Value::Num(3.0)], op_of("+"), ""), Value::Num(7.0));
    assert_eq!(engine("show result", &[Value::Num(7.0)], None, ""), Value::Num(7.0));
    assert_eq!(engine("is it prime?", &[Value::Num(7.0)], None, ""), Value::Ask("is it prime? (wired in: 7)".into()));
    assert_eq!(engine("", &[], None, "Connect wires to begin"), Value::Text("Connect wires to begin".into()));
}

#[test]
fn percent_is_a_superai_function() {
    assert_eq!(call(FUNCS, "percent", r#"{"part":1,"whole":4}"#), "25");
    assert_eq!(call(FUNCS, "percent", r#"{"part":2,"whole":3}"#), "67");
    assert_eq!(call(FUNCS, "percent", r#"{"part":2,"whole":0}"#), "");   // held: nothing to say
}

#[test]
fn ago_is_a_superai_function() {
    assert_eq!(call(FUNCS, "ago", r#"{"m":0}"#), "just now");
    assert_eq!(call(FUNCS, "ago", r#"{"m":45}"#), "45 min ago");
    assert_eq!(call(FUNCS, "ago", r#"{"m":150}"#), "3 h ago");
    assert_eq!(call(FUNCS, "ago", r#"{"m":4000}"#), "3 d ago");
}

#[test]
fn validate_finds_what_is_wrong() {
    assert!(validate(&json::parse(FUNCS).unwrap()).is_empty());
    let bad = json::parse(r#"{"language":"x","diagram":{"supers":[{"id":"a"},{"id":"a"}],"wires":[["a.out","b.input"]]}}"#).unwrap();
    let errs = validate(&bad);
    assert!(errs.iter().any(|e| e.contains("language")));
    assert!(errs.iter().any(|e| e.contains("two supers are called a")));
    assert!(errs.iter().any(|e| e.contains("a.out")));
    assert!(errs.iter().any(|e| e.contains("no super called b")));
}

#[test]
fn run_asks_and_takes_answers() {
    let f = r#"{"supers":[{"id":"q","kind":"engine","text":"what is pi?"},{"id":"out","kind":"output"}],"wires":[["q.output","out.input"]]}"#;
    let r = json::parse(&handle(&format!(r#"{{"op":"run","program":{}}}"#, f))).unwrap();
    assert_eq!(r.get("asks").unwrap().arr()[0].s("prompt"), Some("what is pi?"));
    let r = json::parse(&handle(&format!(r#"{{"op":"run","program":{},"answers":{{"what is pi?":"about 3.14159"}}}}"#, f))).unwrap();
    assert_eq!(r.get("outputs").unwrap().get("out").unwrap().s("text"), Some("about 3.14159"));
    assert!(r.get("asks").unwrap().arr().is_empty());
}

#[test]
fn loops_of_wires_are_held_and_reported() {
    let f = r#"{"supers":[{"id":"a","text":"+"},{"id":"b","text":"+"}],"wires":[["a.output","b.input"],["b.output","a.input"]]}"#;
    let r = json::parse(&handle(&format!(r#"{{"op":"run","program":{}}}"#, f))).unwrap();
    assert_eq!(r.get("cycle").unwrap().arr().len(), 2);
}

#[test]
fn json_round_trips() {
    let t = r#"{"a":[1,2.5,"x\"yé"],"b":{"c":null,"d":true}}"#;
    let j = json::parse(t).unwrap();
    assert_eq!(json::parse(&json::to_string(&j)).unwrap(), j);
}

// The stack machine and the assembly (vm.rs, asm.rs): loops, memory and calls make it Turing complete.
const FACT: &str = r#"
.language "SuperAI 1"
diagram
end
fn fact n            ; n! by a loop
  in n
  store k
  push 1
  store acc
loop:
  load k
  push 1
  le
  jnz done
  load acc
  load k
  mul
  store acc
  load k
  push 1
  sub
  store k
  jmp loop
done:
  load acc
  ret
end
fn fib n             ; fibonacci by recursion
  in n
  push 2
  lt
  jz rec
  in n
  ret
rec:
  in n
  push 1
  sub
  call fib
  in n
  push 2
  sub
  call fib
  add
  ret
end
fn tape              ; memory: write 0..9, sum it back
  push 0
  store i
w:
  load i
  load i
  storei
  load i
  push 1
  add
  dup
  store i
  push 10
  lt
  jnz w
  push 0
  store s
  push 0
  store i
r:
  load s
  load i
  loadi
  add
  store s
  load i
  push 1
  add
  dup
  store i
  push 10
  lt
  jnz r
  load s
  out
  halt
end
"#;

fn call_out(p: &crate::json::Json, f: &str, inputs: &str) -> String {
    let req = format!(r#"{{"op":"call","function":"{}","inputs":{},"program":{}}}"#, f, inputs, crate::json::to_string(p));
    crate::handle(&req)
}

#[test]
fn machine_computes() {
    let p = crate::asm::assemble(FACT).expect("assembles");
    assert!(call_out(&p, "fact", r#"{"n":5}"#).contains(r#""value":120"#), "{}", call_out(&p, "fact", r#"{"n":5}"#));
    assert!(call_out(&p, "fib", r#"{"n":10}"#).contains(r#""value":55"#));
    assert!(call_out(&p, "tape", "{}").contains(r#""value":45"#));
    assert!(crate::validate(&p).is_empty(), "{:?}", crate::validate(&p));
}

#[test]
fn machine_stops_runaways() {
    let p = crate::asm::assemble("fn spin\nl:\njmp l\nend\n").unwrap();
    assert!(call_out(&p, "spin", "{}").contains("million"));
}

#[test]
fn assembly_reads_signs() {
    let src = r#"
.name "Pi Tech Lab"
.projectAt inSite=0.746,0.566
.put titles.byId "a:b" "Why sign in"
.push hide "SciM Assistant"
◇ lab "Lab" panel=tab-lab
◯ "Lab" source=lab at.fx=0.094 at.inSite=0.599,0.698
⊕ journal "Boards" parts="a b","c"
diagram
  ■ hold box text="super" hold desktop n=12 at.inSite=0.31,0.055,0.961,0.945
  ⟶ main.sync site.sync
end
graph add
  ⊙ a input
  ■ plus "+"
  ⊙ out output
  ⟶ a.output plus.input
  ⟶ plus.output out.input
end
map
  ▭ "the site" x=14 y=0 w=972 h=270
  ▣ sim "siM" kind=lab probe="/api/x","{badge}" opens=Capabilities
  .siteRow x=20 y=500 w=960 h=40 extra=[]
  ⟶ prompt superai
end
"#;
    let p = crate::asm::assemble(src).unwrap();
    let j = crate::json::to_string(&p);
    for want in [r#""projectAt":{"inSite":[0.746,0.566]}"#, r#""byId":{"a:b":"Why sign in"}"#, r#""hide":["SciM Assistant"]"#,
        r#"{"key":"lab","name":"Lab","panel":"tab-lab"}"#, r#""parts":["a b","c"]"#,
        r#"{"id":"hold","kind":"box","text":"super","hold":true,"desktop":true,"n":12,"at":{"inSite":[0.31,0.055,0.961,0.945]}}"#,
        r#"["main.sync","site.sync"]"#, r#"{"id":"plus","text":"+"}"#, r#"{"id":"sim","label":"siM","kind":"lab","probe":["/api/x","{badge}"],"opens":"Capabilities"}"#,
        r#""extra":[]"#] {
        assert!(j.contains(want), "missing {} in {}", want, j);
    }
    assert!(crate::asm::assemble("diagram\n◇ x\n").is_err());
}

#[test]
fn connectors_as_signs() {
    let p = crate::asm::assemble("diagram\n⟶ main△ site△\n⟶ site▽ main▽\n⟶ a▷ b◁\nend\nfn gate\n▽\njz no\n◁\n▷\nhalt\nno:\npush 0\n▷\nend\n").unwrap();
    let j = crate::json::to_string(&p);
    assert!(j.contains(r#"["main.sync","site.sync"],["site.condition","main.condition"],["a.output","b.input"]"#), "{}", j);
    assert!(call_out(&p, "gate", r#"{"input":7,"condition":true}"#).contains(r#""value":7"#));
    assert!(call_out(&p, "gate", r#"{"input":7,"condition":false}"#).contains(r#""value":0"#));
}
