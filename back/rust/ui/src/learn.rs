// The Learn page (learn/index.html of the old site) and the whitepaper (whitepaper.html), in Rust. Learn teaches
// SuperAI in nine lessons and checks each challenge by running the learner's program with the SuperAI engine itself
// (crate::superai, the same source as back/rust/superai); a program that asks an AI sends its question to
// /api/super/one and runs on with the answer. Included into app.rs.

use crate::superai::{asm, json as sj, lang, vm};

/// One block of a document.
enum B {
    H(u8, &'static str),
    P(&'static str),
    L(bool, &'static [&'static str]),
    T(&'static [&'static str], &'static [&'static [&'static str]]),
    C(&'static str),
    /// a step of a stack picture: the instruction, and the pile after it
    Q(&'static str, &'static [&'static str]),
}
use B::*;

struct Lesson {
    t: &'static str,
    words: &'static [&'static str],
    idea: &'static [B],
    task: &'static str,
    func: &'static str,
    start: &'static str,
    tests: &'static [(&'static [(&'static str, &'static str)], Option<&'static str>)],
    hint: &'static str,
    answer: &'static str,
}

include!("lessons.rs");
include!("whitepaper.rs");

#[derive(Default)]
pub struct Learn {
    loaded: bool,
    at: usize,
    done: Vec<usize>,
    code: Vec<Option<String>>,
    out: String,
    bad: bool,
    rows: Vec<(bool, String, String, String)>,
    asked: Vec<String>,
    hint: bool,
    won: bool,
    // a check under way: which test, the answers the AI gave so far, the first result
    run: Option<(usize, Vec<(String, String)>, Option<String>, bool)>,
    program: Option<sj::Json>,
    asked_key: String,
}

const LEARN_KEY: &str = "superai:course";

/// Inline text: `code` and **bold**.
fn rich(s: &str) -> Vec<N> {
    let mut out: Vec<N> = Vec::new();
    let mut bold = false;
    for (i, part) in s.split('`').enumerate() {
        if i % 2 == 1 {
            out.push(el("code").text(part.to_string()).into());
            continue;
        }
        for (j, seg) in part.split("**").enumerate() {
            if j > 0 {
                bold = !bold;
            }
            if seg.is_empty() {
                continue;
            }
            out.push(if bold { el("strong").text(seg.to_string()).into() } else { txt(seg) });
        }
    }
    out
}

fn doc_view(blocks: &[B], cls: &str) -> N {
    let mut out: Vec<N> = Vec::new();
    let mut stack: Vec<N> = Vec::new();
    let flush = |stack: &mut Vec<N>, out: &mut Vec<N>| {
        if !stack.is_empty() {
            out.push(el("div").cls("stack-pic").kids(core::mem::take(stack)).into());
        }
    };
    for b in blocks {
        if let Q(cap, vals) = b {
            stack.push(el("figure").kid(el("div").cls("col").kids(vals.iter().map(|v| -> N { el("span").text(v.to_string()).into() }))).kid(el("figcaption").kid(el("code").text(cap.to_string()))).into());
            continue;
        }
        flush(&mut stack, &mut out);
        out.push(match b {
            H(l, t) => el(match l { 1 | 2 => "h2", 3 => "h3", _ => "h4" }).kids(rich(t)).into(),
            P(t) => el("p").kids(rich(t)).into(),
            L(ordered, items) => el(if *ordered { "ol" } else { "ul" }).kids(items.iter().map(|i| -> N { el("li").kids(rich(i)).into() })).into(),
            T(head, rows) => el("div")
                .cls("table-scroll")
                .kid(el("table").cls("data-table").kid(el("thead").kid(el("tr").kids(head.iter().map(|h| -> N { el("th").kids(rich(h)).into() })))).kid(el("tbody").kids(rows.iter().map(|r| -> N { el("tr").kids(r.iter().map(|c| -> N { el("td").kids(rich(c)).into() })).into() }))))
                .into(),
            C(code) => el("pre").cls("ex").text(code.to_string()).into(),
            Q(..) => unreachable!(),
        });
    }
    flush(&mut stack, &mut out);
    el("div").cls(cls).kids(out).into()
}

// ---------------------------------------------------------------------------------------------- the course

fn learn_load() {
    let l = &mut st().learn;
    if l.loaded {
        return;
    }
    l.loaded = true;
    l.code = alloc::vec![None; LESSONS.len()];
    if let Some(v) = host::store_get(LEARN_KEY).and_then(|t| json::parse(&t)) {
        l.at = (v.get("at").f() as usize).min(LESSONS.len() - 1);
        l.done = v.get("done").arr().iter().map(|x| x.f() as usize).filter(|i| *i < LESSONS.len()).collect();
        for (k, c) in v.get("code").entries() {
            if let Ok(i) = k.parse::<usize>() {
                if i < LESSONS.len() {
                    l.code[i] = Some(c.text());
                }
            }
        }
    }
    learn_reset_out();
}

fn learn_save() {
    let l = &st().learn;
    let done: Vec<String> = l.done.iter().map(|i| format!("{}", i)).collect();
    let code: Vec<String> = l.code.iter().enumerate().filter_map(|(i, c)| c.as_ref().map(|c| format!("\"{}\":{}", i, json::quote(c)))).collect();
    host::store_set(LEARN_KEY, &format!("{{\"at\":{},\"done\":[{}],\"code\":{{{}}}}}", l.at, done.join(","), code.join(",")));
}

fn learn_reset_out() {
    let l = &mut st().learn;
    l.out = "Press Check (or Ctrl + Enter) to run your program.".into();
    l.bad = false;
    l.rows.clear();
    l.asked.clear();
    l.hint = false;
    l.won = false;
    l.run = None;
}

fn learn_code(l: &Learn) -> String {
    l.code.get(l.at).cloned().flatten().unwrap_or_else(|| LESSONS[l.at].start.to_string())
}

fn learn_update(a: u16, v: String) {
    let l = &mut st().learn;
    match a {
        1 => {
            l.at = v.parse::<usize>().unwrap_or(0).min(LESSONS.len() - 1);
            learn_reset_out();
            learn_save();
            host::scroll_top();
        }
        2 => {
            let at = l.at;
            l.code[at] = Some(v);
            learn_save();
        }
        3 => l.hint = true,
        4 => {
            let at = l.at;
            l.code[at] = Some(LESSONS[at].answer.to_string());
            learn_save();
        }
        5 => {
            let at = l.at;
            l.code[at] = None;
            learn_save();
            learn_reset_out();
        }
        6 => learn_check(),
        7 => {
            // a sign from the toolbar, added at the end of the program
            let at = l.at;
            let mut c = learn_code(l);
            c.push_str(&v);
            l.code[at] = Some(c);
            learn_save();
        }
        _ => {}
    }
}

fn learn_check() {
    let l = &mut st().learn;
    if l.run.is_some() {
        return;
    }
    let lesson = &LESSONS[l.at];
    let src = learn_code(l);
    l.rows.clear();
    l.asked.clear();
    l.won = false;
    match asm::assemble(&src) {
        Err(e) => {
            l.bad = true;
            l.out = format!("The machine could not read this yet:\n{}", e.join("\n"));
        }
        Ok(p) => {
            if p.get("functions").and_then(|f| f.get(lesson.func)).is_none() {
                l.bad = true;
                l.out = format!("There is no function called {} yet.", lesson.func);
                return;
            }
            l.bad = false;
            l.out = "Running…".into();
            l.program = Some(p);
            l.run = Some((0, Vec::new(), None, true));
            learn_step();
        }
    }
}

/// Runs the current test as far as it goes: to an answer, or to a question for an AI (sent to the server).
fn learn_step() {
    let l = &mut st().learn;
    let lesson = &LESSONS[l.at];
    let Some((ti, answers, first, all)) = l.run.clone() else { return };
    let Some(p) = l.program.as_ref() else { return };
    if ti >= lesson.tests.len() {
        l.run = None;
        l.out = match first {
            Some(f) if f.is_empty() => "(nothing)".into(),
            Some(f) => f,
            None => String::new(),
        };
        if all {
            if !l.done.contains(&l.at) {
                l.done.push(l.at);
            }
            l.won = true;
            learn_save();
        }
        return;
    }
    let (ins, want) = lesson.tests[ti];
    let empty = sj::Json::Null;
    let funcs = p.get("functions").unwrap_or(&empty);
    let f = funcs.get(lesson.func).unwrap_or(&empty);
    let val = |v: &str| lang::parse_num(v).map(lang::Value::Num).unwrap_or_else(|| lang::Value::Text(v.to_string()));
    // the result: Ok(text), Err(Ok((engine, prompt, key))) a question, Err(Err(e)) an error
    let result: Result<String, Result<(String, String, String), String>> = if f.get("code").is_some() {
        let inputs: alloc::collections::BTreeMap<String, lang::Value> = ins.iter().map(|(k, v)| (k.to_string(), val(v))).collect();
        let ans: alloc::collections::BTreeMap<String, String> = answers.iter().cloned().collect();
        match vm::run(f, &inputs, funcs, &ans) {
            Ok(v) => Ok(v.text()),
            Err(e) if e.starts_with(vm::ASK) => {
                let (engine, q) = e[vm::ASK.len()..].split_once('\u{1f}').unwrap_or(("sim", ""));
                Err(Ok((engine.to_string(), q.to_string(), vm::answer_key(engine, q))))
            }
            Err(e) => Err(Err(e)),
        }
    } else {
        match lang::read(f) {
            Err(e) => Err(Err(e.join(" · "))),
            Ok(prog) => {
                let inputs: Vec<(String, lang::Value)> = ins.iter().map(|(k, v)| (k.to_string(), val(v))).collect();
                let r = prog.run(&inputs, &answers);
                match r.asks.iter().find(|(id, _)| !answers.iter().any(|(k, _)| k == id)) {
                    Some((id, q)) => Err(Ok(("sim".to_string(), q.clone(), id.clone()))),
                    None => Ok(r.outputs.iter().find(|(k, _)| k == "out").or(r.outputs.first()).map(|(_, v)| v.text()).unwrap_or_default()),
                }
            }
        }
    };
    match result {
        Err(Ok((engine, prompt, key))) => {
            if answers.len() >= 24 {
                l.run = Some((ti, answers, first, all));
                learn_finish_test(Err("too many questions in one run".into()));
                return;
            }
            l.asked.push(format!("{} was asked: {}", engine, prompt));
            l.out = format!("Asking {}…", engine);
            l.run = Some((ti, answers, first, all));
            l.asked_key = key;
            let body = format!("{{\"engine\":{},\"prompt\":{}}}", json::quote(&engine), json::quote(&prompt));
            request(Want::Tool(Tool::Learn, 0), "POST", "/api/super/one", &body, 0);
        }
        Err(Err(e)) => learn_finish_test(Err(e)),
        Ok(t) => {
            let _ = want;
            learn_finish_test(Ok(t))
        }
    }
}

fn learn_finish_test(r: Result<String, String>) {
    let l = &mut st().learn;
    let lesson = &LESSONS[l.at];
    let Some((ti, _answers, first, all)) = l.run.clone() else { return };
    let (ins, want) = lesson.tests[ti];
    let got = match &r {
        Ok(t) => t.clone(),
        Err(e) => format!("error: {}", e),
    };
    let asked_any = !l.asked.is_empty();
    let ok = r.is_ok() && match want { None => asked_any && !got.is_empty(), Some(w) => got == w };
    let ins_t = if ins.is_empty() { "no inputs".to_string() } else { ins.iter().map(|(k, v)| format!("{} = {}", k, v)).collect::<Vec<_>>().join(", ") };
    l.rows.push((ok, ins_t, got.clone(), match want { None => "(asks an AI)".to_string(), Some(w) => format!("want {}", w) }));
    l.run = Some((ti + 1, Vec::new(), first.or(Some(got)), all && ok));
    learn_step();
}

fn learn_apply(v: Value, err: Option<String>) {
    let l = &mut st().learn;
    let Some((ti, mut answers, first, all)) = l.run.clone() else { return };
    let engine = l.asked.last().and_then(|a| a.split(' ').next()).unwrap_or("sim").to_string();
    let text = match err {
        None if !v.get("text").is_null() => v.get("text").text(),
        None => format!("({} gave no answer)", engine),
        Some(_) => format!("({} could not be reached)", engine),
    };
    answers.push((core::mem::take(&mut l.asked_key), text));
    l.run = Some((ti, answers, first, all));
    learn_step();
}

fn learn_view(s: &State) -> N {
    let l = &s.learn;
    let lesson = &LESSONS[l.at];
    let known: Vec<&str> = {
        let mut k: Vec<&str> = Vec::new();
        for x in &LESSONS[..=l.at] {
            for w in x.words {
                if !k.contains(w) {
                    k.push(w);
                }
            }
        }
        k
    };
    let toc = el("nav").cls("learn-toc").kids(LESSONS.iter().enumerate().map(|(i, x)| -> N {
        let done = l.done.contains(&i);
        el("button")
            .attr("type", "button")
            .cls_if(done, "done")
            .cls_if(i == l.at, "on")
            .attr_if(i == l.at, "aria-current", "true")
            .on("click", Msg::T(Tool::Learn, 1, format!("{}", i)))
            .kid(el("span").cls("tick").text(if done { "✓".to_string() } else { format!("{}", i + 1) }))
            .text(x.t)
            .into()
    }));
    let code = learn_code(l);
    let running = l.run.is_some();
    el("div")
        .cls("tool learn")
        .kid(el("p").cls("lede").text("Learn to program with SuperAI: nine short lessons, from your first line to asking an AI. Each explains one idea, shows it running, then gives you a small challenge the page checks for you."))
        .kid(el("div").cls("learn-bar").kid(el("div").style(format!("width:{}%", 100 * l.done.len() / LESSONS.len()))))
        .kid(
            el("div")
                .cls("learn-grid")
                .kid(toc)
                .kid(
                    el("div")
                        .cls("learn-main")
                        .kid(el("h2").text(format!("{}. {}", l.at + 1, lesson.t)))
                        .kid(doc_view(lesson.idea, "learn-idea"))
                        .kid(el("div").cls("learn-task").kids(rich(lesson.task)))
                        .kid(el("div").cls("learn-tools").kids(SIGNS.iter().map(|(sg, t)| -> N { el("button").attr("type", "button").attr("title", format!("Insert {}", t)).attr("aria-label", format!("Insert {}", t)).on("click", Msg::T(Tool::Learn, 7, sg.to_string())).text(sg.to_string()).into() })))
                        .kid(el("textarea").cls("learn-code").attr("spellcheck", "false").attr("aria-label", "Your program").attr("rows", format!("{}", code.lines().count().max(6) + 2)).prop("value", code).on("input", Msg::TV(Tool::Learn, 2)))
                        .kid(
                            el("div")
                                .cls("row")
                                .kid(el("button").attr("type", "button").cls("btn primary").attr_if(running, "disabled", "").on("click", Msg::T(Tool::Learn, 6, String::new())).text(if running { "Running…" } else { "Check" }))
                                .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Learn, 3, String::new())).text("Hint"))
                                .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Learn, 4, String::new())).text("Show an answer"))
                                .kid(el("button").attr("type", "button").cls("btn ghost").on("click", Msg::T(Tool::Learn, 5, String::new())).text("Start over")),
                        )
                        .kid_if(l.hint, || el("p").cls("hint learn-hint").text(format!("Hint: {}", lesson.hint)).into())
                        .kid(el("h4").text("Result"))
                        .kid(el("pre").cls("learn-out").cls_if(l.bad, "bad").text(l.out.clone()))
                        .kid_if(!l.rows.is_empty(), || {
                            el("table")
                                .cls("data-table learn-tests")
                                .kid(el("tbody").kids(l.rows.iter().map(|(ok, ins, got, want)| -> N {
                                    el("tr").kid(el("td").cls(if *ok { "ok" } else { "no" }).text(if *ok { "✓" } else { "✗" })).kid(el("td").text(ins.clone())).kid(el("td").text(got.clone())).kid(el("td").cls("hint").text(want.clone())).into()
                                })))
                                .into()
                        })
                        .kid_if(!l.asked.is_empty(), || el("pre").cls("learn-log").text(l.asked.join("\n")).into())
                        .kid_if(l.won, || {
                            let next = l.at + 1;
                            el("div")
                                .cls("learn-win")
                                .text(if next < LESSONS.len() { "Well done. " } else { "Well done: you finished the course. Try writing your own program from scratch." })
                                .kid_if(next < LESSONS.len(), || el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Learn, 1, format!("{}", next))).text(format!("Next: {} →", LESSONS.get(next).map(|x| x.t).unwrap_or(""))).into())
                                .into()
                        })
                        .kid(el("h4").text("Words you know so far"))
                        .kid(el("table").cls("data-table learn-sheet").kid(el("tbody").kids(known.iter().filter_map(|k| WORDS.iter().find(|w| w.0 == *k)).map(|w| -> N { el("tr").kid(el("td").kid(el("code").text(w.1))).kid(el("td").text(w.2)).into() })))),
                ),
        )
        .into()
}

fn paper_doc_view() -> N {
    el("div")
        .cls("tool wp")
        .kid(el("p").cls("hint").kid(txt("Also as a PDF: ")).kid(el("a").attr("href", "/ScholarPi_Whitepaper.pdf").attr("target", "_blank").attr("rel", "noopener").text("ScholarPi_Whitepaper.pdf")))
        .kid(doc_view(WHITEPAPER, "wp-body"))
        .into()
}

const LEARN_CSS: &str = "\
.learn-bar{height:4px;background:var(--line);border-radius:2px;margin:10px 0 16px;overflow:hidden}.learn-bar div{height:100%;background:var(--accent,#2563eb);transition:width .3s}\
.learn-grid{display:grid;grid-template-columns:220px 1fr;gap:24px}@media(max-width:760px){.learn-grid{grid-template-columns:1fr}}\
.learn-toc{display:flex;flex-direction:column;gap:4px}.learn-toc button{display:flex;gap:8px;align-items:center;text-align:left;padding:7px 9px;border:1px solid transparent;border-radius:8px;background:none;font:inherit;cursor:pointer;color:var(--ink)}\
.learn-toc button:hover{background:rgba(0,0,0,.03)}.learn-toc button.on{border-color:var(--line2);background:#fff}\
.learn-toc .tick{display:inline-flex;width:22px;height:22px;border-radius:11px;align-items:center;justify-content:center;font-size:12px;background:#f1f1ef;flex:none}.learn-toc .done .tick{background:#16a34a;color:#fff}\
.learn-idea p{margin:8px 0}.learn-idea code,.learn-task code,.learn-sheet code{font-family:var(--mono,monospace);font-size:.92em;background:#f3f3f1;padding:1px 4px;border-radius:4px}\
pre.ex,.learn-out,.learn-log{font-family:var(--mono,monospace);font-size:13px;background:#f7f7f5;border:1px solid var(--line);border-radius:8px;padding:10px 12px;white-space:pre-wrap;overflow:auto}\
.learn-out.bad{border-color:#dc2626;color:#991b1b}\
.stack-pic{display:flex;flex-wrap:wrap;gap:14px;margin:12px 0}.stack-pic figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}\
.stack-pic .col{display:flex;flex-direction:column-reverse;justify-content:flex-start;min-height:60px;min-width:56px;border:1px solid var(--line2);border-top:none;border-radius:0 0 8px 8px;padding:4px;gap:3px}\
.stack-pic .col span{background:#fff;border:1px solid var(--line2);border-radius:5px;padding:2px 8px;font:12px var(--mono,monospace);text-align:center}\
.learn-task{margin:14px 0 8px;padding:10px 12px;border-left:3px solid var(--accent,#2563eb);background:rgba(37,99,235,.05)}\
.learn-tools{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.learn-tools button{min-width:30px;height:28px;border:1px solid var(--line2);border-radius:6px;background:#fff;cursor:pointer;font:14px inherit}\
.learn-code{width:100%;box-sizing:border-box;font:13px/1.5 var(--mono,monospace);padding:10px 12px;border:1px solid var(--line2);border-radius:8px;background:#fff;tab-size:2}\
.learn-tests td.ok{color:#16a34a;font-weight:600}.learn-tests td.no{color:#dc2626;font-weight:600}\
.learn-win{margin:12px 0;padding:10px 12px;border-radius:8px;background:rgba(22,163,74,.08);display:flex;gap:10px;align-items:center;flex-wrap:wrap}\
.wp-body{max-width:760px}.wp-body h2{font-size:24px;margin:8px 0}.wp-body h3{margin:22px 0 8px}.wp-body p{line-height:1.6;margin:8px 0}\
";
