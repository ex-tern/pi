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
