// More of the old page's JavaScript, in Rust (architecture.js, recent.js, performance.js, traffic.js, lab.js,
// superprompt.js, pien.js). Included into app.rs after tools.rs, whose Tool enum and dispatch call into it.

#[derive(Default)]
pub struct Tools2 {
    arch: usize,
    recent: Slot,
    engines: Slot,
    forecast: Slot,
    traffic: Slot,
    traffic_on: Option<usize>,
    // the owner's Lab
    private: Slot,
    views: Vec<(String, String, Slot)>,
    up_project: String,
    up_files: Vec<(u32, f64, String)>,
    up_msg: String,
    requests: Slot,
    rq: [String; 6],
    rq_msg: String,
    rq_open: bool,
    rq_armed: Option<i64>,
    // Super AI
    ask_q: String,
    ask_engines: Slot,
    ask: Vec<(String, String, u8, String, String)>, // id, name, state (0 wait, 1 ok, 2 err), text, model
    ask_outside: Vec<(String, String)>,
    verdict: Option<(u8, String)>,
    asked: String,
    // PiEN
    pien: Pien,
}

// ---------------------------------------------------------------------------------------------- Architecture

const ARCH: [(&str, &str, [&str; 3]); 6] = [
    ("Paper in", "PDF or DOI, identity checked", [
        "Upload a PDF, or give a DOI (resolved through Unpaywall and OpenAlex).",
        "The author is verified with ORCID iD or a W3C DID.",
        "Reviewers are assigned double-blind.",
    ]),
    ("Read", "Text extracted, measured by rule", [
        "Layout-aware text extraction from the PDF.",
        "Rule-based checks: reporting standards (MDAR), research resource IDs (RRID), reproducibility markers, density of evidence.",
        "These scores are deterministic: the same paper always gets the same numbers.",
    ]),
    ("Panel", "Independent models assess it", [
        "Llama, Mistral, Qwen and Gemini each assess the paper separately.",
        "SciM, the local model, reads its structure alongside them.",
        "No model sees another's verdict.",
    ]),
    ("Judge", "PiDN weighs the verdicts", [
        "Agreement between the models is measured; weak or contradictory reasoning is caught.",
        "One judgement is formed from the panel, and the quality of that judgement is graded.",
        "The criteria weighting the paper implies is recorded: the input to the forecast.",
    ]),
    ("Record", "Written to the ledger", [
        "The assessment is proven and recorded as a Proof-of-Research block on Sepolia.",
        "piQ is minted to the author, soulbound: it cannot be sold or moved.",
        "Weights, logic and scores are hashed in public; the record belongs to the researcher.",
    ]),
    ("Outputs", "What you get back", [
        "A dossier in DORA form, with guidance for answering reviewers.",
        "The paper's place on the Global Map of Science.",
        "The next epoch's criteria weights, forecast from every recorded block.",
    ]),
];

fn arch_view(s: &State) -> N {
    let cur = s.t2.arch.min(ARCH.len() - 1);
    let (k, sub, d) = &ARCH[cur];
    el("div")
        .cls("tool arch")
        .kid(el("p").cls("lede").text("How a paper is assessed, in six steps. Click a step to see what happens there."))
        .kid(el("ol").cls("arch-flow").kids(ARCH.iter().enumerate().map(|(i, (k, sub, _))| -> N {
            el("li")
                .kid(
                    el("button")
                        .attr("type", "button")
                        .cls("arch-step")
                        .attr("aria-pressed", if i == cur { "true" } else { "false" })
                        .on("click", Msg::T(Tool::Arch, 1, format!("{}", i)))
                        .kid(el("span").cls("arch-n").text(format!("{}", i + 1)))
                        .kid(el("span").cls("arch-k").text(*k))
                        .kid(el("span").cls("arch-s").text(*sub)),
                )
                .into()
        })))
        .kid(
            el("div")
                .cls("arch-detail card")
                .attr("aria-live", "polite")
                .kid(el("h3").text(format!("{}. {}", cur + 1, k)))
                .kid(el("p").cls("hint").text(*sub))
                .kid(el("ul").kids(d.iter().map(|t| -> N { el("li").text(*t).into() }))),
        )
        .kid(
            el("aside")
                .cls("arch-note")
                .kid(el("h3").text("How judging stays fair"))
                .kid(
                    el("ul")
                        .kid(el("li").kid(el("b").text("Algorithms audit, people judge. ")).kid(txt("The scores support peer review; they do not replace it.")))
                        .kid(el("li").kid(el("b").text("More than papers count. ")).kid(txt("Datasets, code and runnable environments are assessed as research outputs.")))
                        .kid(el("li").kid(el("b").text("Open and owned. ")).kid(txt("Every weight and score is public, and researchers own their record through ORCID or a DID."))),
                )
                .kid(el("p").cls("hint").kid(txt("Framework by ")).kid(ext_link("https://alivafadar.carrd.co/", "Ali Vafadar Yengejeh")).kid(txt(", Università degli Studi di Milano-Bicocca."))),
        )
        .kid(el("p").kid(el("a").cls("btn").attr("href", "#/map").text("The whole lab as a diagram →")))
        .into()
}

// ---------------------------------------------------------------------------------------------- Recent assessments

fn recent_view(s: &State) -> N {
    slot_view(&s.t2.recent, "Loading…", |d| {
        let list = d.get("entries").arr();
        let today = day_of(host::now());
        let yesterday = day_of(host::now() - 864e5);
        let when = |x: &str| -> String {
            if x == today { "today".into() } else if x == yesterday { "yesterday".into() } else { x.to_string() }
        };
        let mut root = el("div").cls("tool recent").kid(el("p").cls("lede").text(
            "Every assessment made here, newest first, signed in or not. Only the field, the score and the day are shown: never the title, the file or who.",
        ));
        if list.is_empty() {
            root = root.kid(el("p").cls("hint").text("No assessments yet. Be the first: open Tools, then Assess Manuscripts [Pi]."));
        } else {
            root = root.kid(el("ol").cls("rc-list").kids(list.iter().map(|e| -> N {
                let sc = e.get("score").f();
                el("li")
                    .kid(el("span").cls("rc-field").text(e.get("field").text()))
                    .kid(el("span").cls("md-bar").kid(el("i").style(format!("width:{:.0}%", sc.clamp(2.0, 100.0)))))
                    .kid(el("b").cls("rc-score").text(num(sc, 1)))
                    .kid(el("span").cls("hint").text(format!("{} · {}", when(e.get("date").str()), if e.get("signed_in").truthy() { "signed in" } else { "anonymous" })))
                    .into()
            })));
            root = root.kid(el("p").cls("hint").text(format!("{} assessed in all", num(d.get("total").f(), 0))));
        }
        root.into()
    })
}

/// The day (YYYY-MM-DD, UTC) of a time in milliseconds.
fn day_of(ms: f64) -> String {
    let days = (ms / 864e5) as i64;
    // civil from days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

// ---------------------------------------------------------------------------------------------- Performance

fn better(e: &Value) -> Option<i64> {
    if let Some(p) = e.get("improvement_pct").num() {
        return Some((p + 0.5) as i64);
    }
    let (m, b) = (e.get("mean_abs_error").num(), e.get("baseline_abs_error").num());
    match (m, b) {
        (Some(m), Some(b)) if b > 0.0 => Some(((1.0 - m / b) * 100.0 + 0.5) as i64),
        _ => None,
    }
}

fn learned_line(obs: f64, b: Option<i64>, first: &str) -> String {
    if obs <= 0.0 {
        return format!("Hasn't learned anything yet. It starts {}.", first);
    }
    let n = num(obs, 0);
    let ex = if obs == 1.0 { "example" } else { "examples" };
    match b {
        None => format!("Learned from {} {}; too early to say how well.", n, ex),
        Some(b) if b > 0 => format!("{}% better than when it started ({} {}).", b, n, ex),
        _ => format!("Not better than its starting point yet ({} {}).", n, ex),
    }
}

fn perf_card(name: &str, what: &str, status: String, meter: f64, note: &str) -> N {
    el("div")
        .cls("perf-card")
        .kid(el("div").cls("pc-head").kid(el("b").text(name)).kid_if(!note.is_empty(), || el("span").cls("pc-tag").text(note).into()))
        .kid(el("p").cls("hint").text(what))
        .kid(el("span").cls("md-bar").kid(el("i").style(format!("width:{:.0}%", meter.clamp(0.0, 100.0)))))
        .kid(el("p").cls("pc-status").text(status))
        .into()
}

fn perf_view(s: &State) -> N {
    let e = s.t2.engines.data.as_ref().unwrap_or(&json::NULL);
    let fc = s.t2.forecast.data.as_ref().unwrap_or(&json::NULL);
    if s.t2.engines.busy && s.t2.engines.data.is_none() {
        return spinner("Loading…");
    }
    let pe = &s.t2.pien;
    let rate = if pe.s > 0 { Some((100.0 * pe.h as f64 / pe.s as f64 + 0.5) as i64) } else { None };
    let mine: u32 = pe.opens.values().sum();
    let mut cards: Vec<N> = Vec::new();
    cards.push(perf_card(
        "PiEN",
        "The lab's own guide. It suggests the window you'll want next.",
        match rate {
            None => "No suggestions made yet. It needs a few clicks to see a pattern.".to_string(),
            Some(r) => format!(
                "Its suggestion was the one opened {}% of the time ({} of {}).{}",
                r,
                pe.h,
                pe.s,
                pe.pick.as_ref().map(|p| format!(" Right now it suggests {}.", p)).unwrap_or_default()
            ),
        },
        rate.unwrap_or(0) as f64,
        &format!("{} steps seen", num((mine as f64) + pe.all_n, 0)),
    ));
    let need = (fc.get("blocks_required").f() - fc.get("blocks_recorded").f()).max(0.0);
    let d = e.get("piD");
    let bd = better(d);
    cards.push(perf_card(
        "PiDN",
        "Predicts how the eight scoring criteria will be weighted next.",
        if need > 0.0 {
            format!("Needs {} more assessment{} before its first prediction.", num(need, 0), if need == 1.0 { "" } else { "s" })
        } else {
            learned_line(d.any(&["total_observations", "observations"]).f(), bd, "after the first assessments")
        },
        bd.unwrap_or(0).max(0) as f64,
        if d.get("learning").truthy() { "improving" } else { "" },
    ));
    let m = e.get("siM");
    let bm = better(m);
    cards.push(perf_card(
        "SciM",
        "Reads a paper's structure in seconds and checks itself against the full model panel.",
        learned_line(m.any(&["consensus_observations", "observations"]).f(), bm, "when the panel first finishes an assessment"),
        bm.unwrap_or(0).max(0) as f64,
        if m.get("learning").truthy() { "improving" } else { "" },
    ));
    let b = e.get("riB");
    let bb = better(b);
    cards.push(perf_card(
        "RiBD",
        "Your research mentor. It suggests which papers are worth your time and what to fix first.",
        learned_line(b.any(&["observations", "logged_observations"]).f(), bb, "when you mark its suggestions as useful or not"),
        bb.unwrap_or(0).max(0) as f64,
        if b.get("learning").truthy() { "improving" } else { "" },
    ));
    let idle = e.get("idle");
    let idle_line: Option<String> = if idle.get("enabled").truthy() {
        let last = idle.get("last_run_at").f();
        let ago = if last > 0.0 { Some(((host::now() / 1000.0 - last) / 60.0).max(1.0) as i64) } else { None };
        Some(format!(
            "Working while idle. When the site is quiet it assesses open-access papers by itself, and the engines learn from each one: {} of {} today{}{}.",
            idle.get("assessed_today").text(),
            idle.get("daily_cap").text(),
            if idle.get("working_now").truthy() { ", one in progress now" } else { "" },
            if idle.get("last_title").str().is_empty() {
                String::new()
            } else {
                format!(
                    ". Latest: {}{}",
                    idle.get("last_title").str(),
                    ago.map(|a| if a < 60 { format!(" ({} min ago)", a) } else { format!(" ({} h ago)", a / 60) }).unwrap_or_default()
                )
            }
        ))
    } else {
        None
    };
    let moving: Vec<&Value> = fc.get("criteria").arr().iter().filter(|c| !c.get("direction").str().is_empty() && c.get("direction").str() != "flat").collect();
    let next = if !fc.get("ready").truthy() || fc.get("mode").str() == "baseline" || moving.is_empty() {
        if need > 0.0 {
            format!(
                "Nothing to predict yet: all eight criteria still count equally. After {} more assessment{}, PiDN starts forecasting which ones will matter more.",
                num(need, 0),
                if need == 1.0 { "" } else { "s" }
            )
        } else {
            "No change expected: all eight criteria are holding steady.".to_string()
        }
    } else {
        let up: Vec<String> = moving.iter().filter(|c| c.get("direction").str() == "up").map(|c| c.get("title").text()).collect();
        let down: Vec<String> = moving.iter().filter(|c| c.get("direction").str() == "down").map(|c| c.get("title").text()).collect();
        format!(
            "{}{}",
            if up.is_empty() { String::new() } else { format!("Expected to count more: {}. ", up.join(", ")) },
            if down.is_empty() { String::new() } else { format!("Expected to count less: {}.", down.join(", ")) }
        )
    };
    el("div")
        .cls("tool perf")
        .kid(el("p").cls("lede").text("Four engines learn from how the lab is used. Here is how each one is doing."))
        .kid(el("div").cls("perf-cards").kids(cards))
        .kid_if(idle_line.is_some(), || el("p").cls("hint").text(idle_line.clone().unwrap_or_default()).into())
        .kid(el("section").cls("card").kid(el("h3").text("What happens next")).kid(el("p").text(next)))
        .kid(pien_panel(s))
        .kid(el("details").cls("perf-more").kid(el("summary").text("Show the detailed forecast")).kid(data_view(fc, 0)))
        .into()
}

// ---------------------------------------------------------------------------------------------- Analytics, with traffic

fn analytics_view(s: &State) -> N {
    let sm = slot_view(&s.summary, "Loading…", |d| {
        let tile = |b: String, t: &str| -> N { el("div").kid(el("b").text(b)).kid(el("span").text(t.to_string())).into() };
        el("div")
            .cls("md-stats")
            .kid(tile(num(d.get("total_papers").f(), 0), "papers assessed"))
            .kid(tile(num(d.get("total_piq").f(), 1), "piQ minted"))
            .kid(tile(num(d.get("avg_score").f(), 1), "average piX"))
            .kid(tile(num(d.get("unique_authors").f(), 0), "authors"))
            .kid(tile(num(d.get("visitors").get("unique").f(), 0), "visitors"))
            .into()
    });
    let tr = slot_view(&s.t2.traffic, "Loading the traffic…", |d| traffic_view(s, d));
    el("div").cls("tool analytics").kid(el("p").cls("lede").text("The corpus in numbers, and the website's traffic.")).kid(sm).kid(tr).into()
}

fn traffic_view(s: &State, d: &Value) -> N {
    let tile = |l: &str, k: &str| -> N { el("div").kid(el("b").text(num(d.get(k).f(), 0))).kid(el("span").text(l.to_string())).into() };
    let days = d.get("days").arr();
    let (w, h, pad_l, pad_b, pad_t) = (640.0, 150.0, 30.0, 20.0, 10.0);
    let max = days.iter().map(|x| x.get("visitors").f()).fold(1.0, f64::max);
    let mut step = 1.0;
    while step * 10.0 <= max {
        step *= 10.0;
    }
    let top = ((max / step) as i64 + if max % step > 0.0 { 1 } else { 0 }) as f64 * step;
    let n = days.len().max(1) as f64;
    let bw = (w - pad_l) / n;
    let inner = h - pad_b - pad_t;
    let mut svg = el("svg:svg")
        .cls("tr-chart")
        .attr("viewBox", format!("0 0 {} {}", w, h))
        .attr("role", "img")
        .attr("aria-label", "Distinct visitors per day")
        .kid(el("svg:line").cls("tr-grid").attr("x1", format!("{}", pad_l)).attr("x2", format!("{}", w)).attr("y1", format!("{}", pad_t)).attr("y2", format!("{}", pad_t)))
        .kid(el("svg:line").cls("tr-axis").attr("x1", format!("{}", pad_l)).attr("x2", format!("{}", w)).attr("y1", format!("{}", h - pad_b)).attr("y2", format!("{}", h - pad_b)))
        .kid(el("svg:text").cls("tr-lab").attr("x", format!("{}", pad_l - 4.0)).attr("y", format!("{}", pad_t + 4.0)).attr("text-anchor", "end").text(num(top, 0)))
        .kid(el("svg:text").cls("tr-lab").attr("x", format!("{}", pad_l - 4.0)).attr("y", format!("{}", h - pad_b + 4.0)).attr("text-anchor", "end").text("0"));
    for (i, x) in days.iter().enumerate() {
        let v = x.get("visitors").f();
        let bh = if v > 0.0 { (inner * v / top).max(2.0) } else { 0.0 };
        let bx = pad_l + i as f64 * bw + 1.0;
        let bwi = (bw - 2.0).max(1.0);
        let on = s.t2.traffic_on == Some(i);
        if bh > 0.0 {
            svg = svg.kid(el("svg:rect").cls("tr-bar").cls_if(on, "on").attr("x", format!("{:.1}", bx)).attr("y", format!("{:.1}", h - pad_b - bh)).attr("width", format!("{:.1}", bwi)).attr("height", format!("{:.1}", bh)));
        }
        svg = svg.kid(
            el("svg:rect")
                .cls("tr-hit")
                .attr("x", format!("{:.1}", pad_l + i as f64 * bw))
                .attr("y", "0")
                .attr("width", format!("{:.1}", bw))
                .attr("height", format!("{}", h - pad_b))
                .on("pointerenter", Msg::T(Tool::Analytics, 1, format!("{}", i)))
                .on("click", Msg::T(Tool::Analytics, 1, format!("{}", i)))
                .kid(el("svg:title").text(format!("{}: {} visitors · {} visits", x.get("day").text(), num(v, 0), num(x.get("visits").f(), 0)))),
        );
    }
    for i in [0usize, days.len() / 2, days.len().saturating_sub(1)] {
        if let Some(x) = days.get(i) {
            let anchor = if i == 0 { "start" } else if i + 1 == days.len() { "end" } else { "middle" };
            svg = svg.kid(el("svg:text").cls("tr-lab").attr("x", format!("{:.1}", pad_l + i as f64 * bw + bw / 2.0)).attr("y", format!("{}", h - 5.0)).attr("text-anchor", anchor).text(x.get("day").text()));
        }
    }
    let tip = s.t2.traffic_on.and_then(|i| days.get(i)).map(|x| {
        format!("{}: {} visitor{} · {} visit{}", x.get("day").text(), num(x.get("visitors").f(), 0), if x.get("visitors").f() == 1.0 { "" } else { "s" }, num(x.get("visits").f(), 0), if x.get("visits").f() == 1.0 { "" } else { "s" })
    });
    el("section")
        .cls("traffic")
        .kid(el("h3").text("Website traffic"))
        .kid(el("div").cls("md-stats").kid(tile("Today", "today")).kid(tile("Last 7 days", "week")).kid(tile("Last 30 days", "month")).kid(tile("All time", "all_time")))
        .kid(svg)
        .kid(el("p").cls("tr-tip").text(tip.unwrap_or_else(|| "Point at a day for its numbers.".to_string())))
        .kid(
            el("details").kid(el("summary").text("Show as a table")).kid(
                el("table")
                    .cls("data-table")
                    .kid(el("thead").kid(el("tr").kid(el("th").text("Day")).kid(el("th").text("Visitors")).kid(el("th").text("Visits"))))
                    .kid(el("tbody").kids(days.iter().rev().map(|x| -> N {
                        el("tr").kid(el("td").text(x.get("day").text())).kid(el("td").text(num(x.get("visitors").f(), 0))).kid(el("td").text(num(x.get("visits").f(), 0))).into()
                    }))),
            ),
        )
        .kid(el("p").cls("hint").text("Distinct visitors per day, counted once per browser session. No addresses are kept, only an anonymous key."))
        .into()
}

// ---------------------------------------------------------------------------------------------- the owner's Lab

fn is_owner(s: &State) -> bool {
    s.session.data.as_ref().map(|d| d.get("is_owner").truthy()).unwrap_or(false)
}

fn owner_only(s: &State) -> Option<N> {
    if is_owner(s) {
        None
    } else {
        Some(
            el("div")
                .cls("card")
                .kid(el("p").text("This is the lab owner's. Sign in as the owner to use it."))
                .kid(el("p").kid(el("a").cls("btn").attr("href", "#/account").text("Sign in")))
                .into(),
        )
    }
}

fn title_of(id: &str) -> String {
    id.split('-').map(|w| {
        let mut c = w.chars();
        match c.next() {
            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            None => String::new(),
        }
    }).collect::<Vec<_>>().join(" ")
}

fn file_url(p: &str, n: &str) -> String {
    format!("/api/lab/private/{}/{}", url_encode(p), url_encode(n))
}

fn private_view(s: &State) -> N {
    if let Some(n) = owner_only(s) {
        return n;
    }
    let t = &s.t2;
    let list = slot_view(&t.private, "Loading…", |d| {
        let ps = d.get("projects").arr();
        if ps.is_empty() {
            return el("p").cls("hint").text("No private projects yet. Upload files below.").into();
        }
        el("div")
            .kids(ps.iter().map(|p| -> N {
                let id = p.get("id").text();
                let shown = t.views.iter().find(|v| v.0 == id);
                el("div")
                    .cls("lab-project card")
                    .kid(el("h3").text(title_of(&id)))
                    .kid(el("div").cls("row").kids(p.get("files").arr().iter().map(|f| -> N {
                        let name = f.get("name").text();
                        let on = shown.map(|v| v.1 == name).unwrap_or(false);
                        el("button")
                            .attr("type", "button")
                            .cls("btn small")
                            .cls_if(on, "primary")
                            .on("click", Msg::T(Tool::Private, 1, format!("{}\t{}", id, name)))
                            .text(name)
                            .into()
                    })))
                    .kid(match shown {
                        Some((_, name, slot)) => file_view(&id, name, slot),
                        None => txt(""),
                    })
                    .into()
            }))
            .into()
    });
    el("div")
        .cls("tool private")
        .kid(el("p").cls("lede").text("Owner-only work in progress: files kept on the server, shown here."))
        .kid(list)
        .kid(
            el("section")
                .cls("card")
                .kid(el("h3").text("Upload"))
                .kid(
                    el("div")
                        .cls("row")
                        .kid(el("input").attr("type", "text").attr("placeholder", "project-name").attr("aria-label", "Project").prop("value", t.up_project.clone()).on("input", Msg::TV(Tool::Private, 2)))
                        .kid(el("input").attr("type", "file").attr("multiple", "").attr("aria-label", "Files").on("files", Msg::TV(Tool::Private, 3)))
                        .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Private, 4, String::new())).text("Upload")),
                )
                .kid(el("p").cls("hint").text(if t.up_files.is_empty() { t.up_msg.clone() } else { format!("{} file(s) chosen. {}", t.up_files.len(), t.up_msg) })),
        )
        .into()
}

fn file_view(project: &str, name: &str, slot: &Slot) -> N {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    let url = file_url(project, name);
    let actions = el("div").cls("row").kid(el("a").cls("btn small").attr("href", url.clone()).attr("download", name.to_string()).text("Download"));
    match ext.as_str() {
        "pdf" => el("div").kid(actions).kid(el("embed").cls("lab-doc").attr("type", "application/pdf").attr("src", url).attr("title", name.to_string())).into(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" => el("div").kid(actions).kid(el("img").cls("lab-img").attr("alt", name.to_string()).attr("src", url)).into(),
        _ => {
            let body: N = if slot.busy {
                spinner(&format!("Loading {}…", name))
            } else if let Some(e) = &slot.err {
                el("p").cls("hint").text(e.clone()).into()
            } else {
                let text = slot.data.as_ref().map(|v| v.str().to_string()).unwrap_or_default();
                match ext.as_str() {
                    // a page runs in a sandbox with no access to this site (no allow-same-origin)
                    "html" | "htm" => el("iframe").cls("lab-doc").attr("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox").attr("title", name.to_string()).prop("srcdoc", text).into(),
                    "csv" => csv_table(&text),
                    _ => el("pre").cls("lab-text").text(text).into(),
                }
            };
            el("div").kid(actions).kid(body).into()
        }
    }
}

fn csv_rows(text: &str) -> Vec<Vec<String>> {
    let (mut rows, mut row, mut cell, mut q) = (Vec::new(), Vec::new(), String::new(), false);
    let cs: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if q {
            if c == '"' && cs.get(i + 1) == Some(&'"') {
                cell.push('"');
                i += 1;
            } else if c == '"' {
                q = false;
            } else {
                cell.push(c);
            }
        } else if c == '"' {
            q = true;
        } else if c == ',' {
            row.push(core::mem::take(&mut cell));
        } else if c == '\n' || c == '\r' {
            if c == '\r' && cs.get(i + 1) == Some(&'\n') {
                i += 1;
            }
            row.push(core::mem::take(&mut cell));
            rows.push(core::mem::take(&mut row));
        } else {
            cell.push(c);
        }
        i += 1;
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows.into_iter().filter(|r: &Vec<String>| r.iter().any(|c| !c.is_empty())).collect()
}

fn csv_table(text: &str) -> N {
    let mut rows = csv_rows(text);
    let head = if rows.is_empty() { Vec::new() } else { rows.remove(0) };
    el("div")
        .cls("table-scroll")
        .kid(
            el("table")
                .cls("data-table")
                .kid(el("thead").kid(el("tr").kids(head.iter().map(|h| -> N { el("th").text(h.clone()).into() }))))
                .kid(el("tbody").kids(rows.iter().map(|r| -> N { el("tr").kids(r.iter().map(|c| -> N { el("td").text(c.clone()).into() })).into() }))),
        )
        .into()
}

const RQ_FIELDS: [(&str, &str); 6] = [
    ("title", "What you ask for (a title)"),
    ("recipient", "Who is asked (name or email)"),
    ("requester", "Who asks"),
    ("work", "The work"),
    ("message", "Message"),
    ("terms", "Terms, one a line"),
];

fn requests_view(s: &State) -> N {
    if let Some(n) = owner_only(s) {
        return n;
    }
    let t = &s.t2;
    let origin = {
        let h = host::href();
        h.splitn(4, '/').take(3).collect::<Vec<_>>().join("/")
    };
    let list = slot_view(&t.requests, "Loading…", |d| {
        let rs = d.get("requests").arr();
        if rs.is_empty() {
            return el("p").cls("hint").text("No requests yet. Create one below.").into();
        }
        el("div")
            .kids(rs.iter().map(|r| -> N {
                let status = match r.get("status").str() {
                    "granted" => "Permission given",
                    "declined" => "Declined",
                    _ => "Waiting for an answer",
                };
                let link = format!("{}{}", origin, r.get("path").str());
                let id = r.get("id").f() as i64;
                el("div")
                    .cls("card consent-item")
                    .kid(el("div").cls("row").kid(el("b").text(r.get("title").text())).kid(el("span").cls("pc-tag").text(format!("{}{}", status, if r.get("closed").truthy() { " · closed" } else { "" }))))
                    .kid(el("p").cls("hint").text(format!("To {} · created {}", r.get("recipient").text(), r.get("created_at").text())))
                    .kid(
                        el("div")
                            .cls("row")
                            .kid(el("input").attr("type", "text").attr("readonly", "").attr("aria-label", "Confirmation link").prop("value", link.clone()))
                            .kid(el("a").cls("btn small").attr("href", link).attr("target", "_blank").attr("rel", "noopener").text("Open"))
                            .kid_if(!r.get("closed").truthy(), || {
                                el("button")
                                    .attr("type", "button")
                                    .cls("btn small")
                                    .on("click", Msg::T(Tool::Requests, 2, format!("{}", id)))
                                    .text(if t.rq_armed == Some(id) { "Really close?" } else { "Close" })
                                    .into()
                            }),
                    )
                    .kid(el("ul").cls("hint").kids(r.get("answers").arr().iter().map(|a| -> N {
                        el("li")
                            .text(format!(
                                "{} by {} · {}{}",
                                if a.get("decision").str() == "granted" { "Given" } else { "Declined" },
                                a.get("name").text(),
                                a.get("answered_at").text(),
                                if a.get("note").str().is_empty() { String::new() } else { format!(" · “{}”", a.get("note").str()) }
                            ))
                            .into()
                    })))
                    .into()
            }))
            .into()
    });
    let mut form = el("section").cls("card").kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Requests, 3, String::new())).text(if t.rq_open { "Hide the form" } else { "New request" }));
    if t.rq_open {
        for (i, (_, label)) in RQ_FIELDS.iter().enumerate() {
            let f: N = if i >= 4 {
                el("textarea").attr("rows", "3").attr("aria-label", *label).prop("value", t.rq[i].clone()).on("input", Msg::TV(Tool::Requests, 16 + i as u16)).into()
            } else {
                el("input").attr("type", "text").attr("aria-label", *label).prop("value", t.rq[i].clone()).on("input", Msg::TV(Tool::Requests, 16 + i as u16)).into()
            };
            form = form.kid(el("label").cls("field").kid(el("span").text(*label)).kid(f));
        }
        form = form.kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Requests, 4, String::new())).text("Create"));
    }
    form = form.kid(el("p").cls("hint").text(t.rq_msg.clone()));
    el("div").cls("tool requests").kid(el("p").cls("lede").text("Ask authors for permission, with a link they answer.")).kid(list).kid(form).into()
}

// ---------------------------------------------------------------------------------------------- Super AI: one question, every engine

fn ask_view(s: &State) -> N {
    let t = &s.t2;
    let ready: Vec<String> = t.ask_engines.data.as_ref().map(|d| d.get("engines").arr().iter().filter(|e| e.get("ready").truthy()).map(|e| e.get("name").text()).collect()).unwrap_or_default();
    let off: Vec<String> = t.ask_engines.data.as_ref().map(|d| d.get("engines").arr().iter().filter(|e| !e.get("ready").truthy()).map(|e| e.get("name").text()).collect()).unwrap_or_default();
    let mut root = el("div")
        .cls("tool ask")
        .kid(el("p").cls("lede").text("One question to every engine in the lab and outside it, each answer in its own card as it arrives."))
        .kid(
            el("div")
                .cls("ask-form")
                .kid(el("textarea").attr("rows", "3").attr("maxlength", "4000").attr("placeholder", "Ask anything…").attr("aria-label", "Your question").prop("value", t.ask_q.clone()).on("input", Msg::TV(Tool::Ask, 1)))
                .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Ask, 2, String::new())).text("Ask every engine")),
        );
    if t.ask.is_empty() {
        root = root.kid(el("p").cls("hint").text(if ready.is_empty() && t.ask_engines.data.is_some() {
            "The engines cannot be reached from here right now.".to_string()
        } else {
            format!("Ready: {}{}", ready.join(", "), if off.is_empty() { String::new() } else { format!(". No key yet: {}", off.join(", ")) })
        }));
    } else {
        root = root.kid(el("p").cls("hint").text(format!("Asked: {}", t.asked)));
        if let Some((st_, text)) = &t.verdict {
            root = root.kid(
                el("div")
                    .cls("card ask-card verdict")
                    .kid(el("div").cls("pc-head").kid(el("b").text("The judge")).kid(el("span").cls("pc-tag").text(match st_ {
                        0 => "waiting",
                        3 => "weighing…",
                        1 => "verdict",
                        _ => "no verdict",
                    })))
                    .kid(if text.is_empty() { txt("") } else { markdown(text) }),
            );
        }
        for (_, name, st_, text, model) in &t.ask {
            root = root.kid(
                el("div")
                    .cls("card ask-card")
                    .cls_if(*st_ == 2, "err")
                    .kid(el("div").cls("pc-head").kid(el("b").text(name.clone())).kid(el("span").cls("pc-tag").text(match st_ {
                        0 => "thinking…".to_string(),
                        1 => model.clone(),
                        _ => "no answer".to_string(),
                    })))
                    .kid(if *st_ == 0 { spinner("") } else { markdown(text) }),
            );
        }
    }
    root.into()
}

fn ask_start() {
    let s = st();
    let q = s.t2.ask_q.trim().to_string();
    if q.is_empty() {
        return;
    }
    let Some(d) = s.t2.ask_engines.data.as_ref() else { return };
    let engines: Vec<(String, String, String)> = d.get("engines").arr().iter().filter(|e| e.get("ready").truthy()).map(|e| (e.get("id").text(), e.get("name").text(), e.get("kind").text())).collect();
    let judge = d.get("judge").truthy();
    s.t2.asked = q.clone();
    s.t2.ask = engines.iter().map(|(id, name, _)| (id.clone(), name.clone(), 0u8, String::new(), String::new())).collect();
    s.t2.ask_outside.clear();
    let outside = engines.iter().filter(|e| e.2 == "outside").count();
    s.t2.verdict = if outside >= 2 && judge { Some((0, String::new())) } else { None };
    for (i, (id, _, _)) in engines.iter().enumerate() {
        let body = format!("{{\"engine\":{},\"prompt\":{}}}", json::quote(id), json::quote(&q));
        request(Want::Tool(Tool::Ask, 10 + i as u8), "POST", "/api/super/one", &body, 0);
    }
}

fn ask_answer(i: usize, v: Value, err: Option<String>) {
    let s = st();
    let kinds: Vec<String> = s.t2.ask_engines.data.as_ref().map(|d| d.get("engines").arr().iter().filter(|e| e.get("ready").truthy()).map(|e| e.get("kind").text()).collect()).unwrap_or_default();
    let Some(row) = s.t2.ask.get_mut(i) else { return };
    let ok = err.is_none() && v.get("ok").truthy();
    row.2 = if ok { 1 } else { 2 };
    row.3 = if ok { v.get("text").text() } else { err.unwrap_or_else(|| v.any(&["text", "detail"]).text()) };
    if row.3.is_empty() {
        row.3 = "No answer.".to_string();
    }
    row.4 = v.get("model").text();
    if ok && kinds.get(i).map(|k| k == "outside").unwrap_or(false) {
        s.t2.ask_outside.push((row.1.clone(), row.3.clone()));
    }
    // once every engine has answered, the judge weighs what the outside models said
    if s.t2.ask.iter().all(|r| r.2 != 0) {
        if let Some((0, _)) = s.t2.verdict {
            if s.t2.ask_outside.len() < 2 {
                s.t2.verdict = Some((2, "Fewer than two outside models answered, so there is nothing to weigh.".to_string()));
            } else {
                s.t2.verdict = Some((3, String::new()));
                let answers: Vec<String> = s.t2.ask_outside.iter().map(|(l, a)| format!("{{\"label\":{},\"answer\":{}}}", json::quote(l), json::quote(a))).collect();
                let body = format!("{{\"prompt\":{},\"answers\":[{}]}}", json::quote(&s.t2.asked), answers.join(","));
                request(Want::Tool(Tool::Ask, 9), "POST", "/api/super/weigh", &body, 0);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------- PiEN: what you will open next

/// PiEN learns which windows are opened, and which after which (yours weigh three times everyone's, pooled
/// anonymously on the server: /api/pien), and suggests the one you are likely to want next.
#[derive(Default)]
pub struct Pien {
    opens: BTreeMap<String, u32>,
    next: BTreeMap<String, BTreeMap<String, u32>>,
    last: String,
    at: f64,
    s: u32,
    h: u32,
    all_opens: BTreeMap<String, f64>,
    all_next: BTreeMap<String, BTreeMap<String, f64>>,
    all_n: f64,
    pend_opens: BTreeMap<String, u32>,
    pend_steps: BTreeMap<(String, String), u32>,
    pick: Option<String>,
    loaded: bool,
}

const PIEN_GAP: f64 = 30.0 * 60.0 * 1000.0;

fn pien_load() {
    let p = &mut st().t2.pien;
    if p.loaded {
        return;
    }
    p.loaded = true;
    let Some(v) = host::store_get("piii:pien") else { return };
    for l in v.lines() {
        let f: Vec<&str> = l.split('\t').collect();
        match f.as_slice() {
            ["o", k, n] => {
                p.opens.insert(k.to_string(), n.parse().unwrap_or(0));
            }
            ["t", a, b, n] => {
                p.next.entry(a.to_string()).or_default().insert(b.to_string(), n.parse().unwrap_or(0));
            }
            ["l", k, at] => {
                p.last = k.to_string();
                p.at = at.parse().unwrap_or(0.0);
            }
            ["s", s_, h] => {
                p.s = s_.parse().unwrap_or(0);
                p.h = h.parse().unwrap_or(0);
            }
            _ => {}
        }
    }
}

fn pien_save() {
    let p = &st().t2.pien;
    let mut out = String::new();
    for (k, n) in &p.opens {
        out.push_str(&format!("o\t{}\t{}\n", k, n));
    }
    for (a, row) in &p.next {
        let mut r: Vec<(&String, &u32)> = row.iter().collect();
        r.sort_by(|x, y| y.1.cmp(x.1));
        for (b, n) in r.into_iter().take(8) {
            out.push_str(&format!("t\t{}\t{}\t{}\n", a, b, n));
        }
    }
    out.push_str(&format!("l\t{}\t{:.0}\ns\t{}\t{}\n", p.last, p.at, p.s, p.h));
    host::store_set("piii:pien", &out);
}

/// Every window PiEN can suggest: the members of the bubbles.
fn pien_keys() -> Vec<&'static str> {
    GROUPS.iter().flat_map(|g| g.members.iter().map(|m| m.0)).filter(|k| !matches!(*k, "GitHub" | "Contact us" | "Owner console" | "Private projects" | "Permission requests")).collect()
}

fn share_u(row: Option<&BTreeMap<String, u32>>, k: &str) -> f64 {
    let Some(r) = row else { return 0.0 };
    let n: u32 = r.values().sum();
    if n == 0 { 0.0 } else { *r.get(k).unwrap_or(&0) as f64 / n as f64 }
}

fn share_f(row: Option<&BTreeMap<String, f64>>, k: &str) -> f64 {
    let Some(r) = row else { return 0.0 };
    let n: f64 = r.values().sum();
    if n <= 0.0 { 0.0 } else { *r.get(k).unwrap_or(&0.0) / n }
}

fn pien_predict() -> Option<String> {
    let p = &st().t2.pien;
    let from = if !p.last.is_empty() && host::now() - p.at < PIEN_GAP { p.last.as_str() } else { "" };
    let mut best: Option<&str> = None;
    let mut best_score = 0.0;
    for k in pien_keys() {
        if k == from {
            continue;
        }
        let score = if from.is_empty() { 0.0 } else { 3.0 * share_u(p.next.get(from), k) + share_f(p.all_next.get(from), k) }
            + 0.3 * share_u(Some(&p.opens), k)
            + 0.1 * share_f(Some(&p.all_opens), k);
        if score > best_score {
            best = Some(k);
            best_score = score;
        }
    }
    let seen = p.opens.values().sum::<u32>() as f64 + p.all_n;
    if seen >= 3.0 && best_score >= 0.12 { best.map(|b| b.to_string()) } else { None }
}

/// A window was opened: PiEN learns from it.
fn pien_learn(key: &str) {
    pien_load();
    let now = host::now();
    let p = &mut st().t2.pien;
    if key.is_empty() || key == p.last && now - p.at < 2000.0 {
        return;
    }
    if let Some(pick) = &p.pick {
        p.s += 1;
        if pick == key {
            p.h += 1;
        }
    }
    *p.opens.entry(key.to_string()).or_default() += 1;
    *p.pend_opens.entry(key.to_string()).or_default() += 1;
    if !p.last.is_empty() && p.last != key && now - p.at < PIEN_GAP {
        *p.next.entry(p.last.clone()).or_default().entry(key.to_string()).or_default() += 1;
        *p.pend_steps.entry((p.last.clone(), key.to_string())).or_default() += 1;
    }
    p.last = key.to_string();
    p.at = now;
    pien_save();
    st().t2.pien.pick = pien_predict();
    let total: u32 = st().t2.pien.pend_opens.values().sum();
    if total >= 5 {
        pien_flush();
    }
}

fn pien_flush() {
    let p = &mut st().t2.pien;
    if p.pend_opens.is_empty() && p.pend_steps.is_empty() {
        return;
    }
    let opens: Vec<String> = p.pend_opens.iter().take(20).map(|(k, n)| format!("[{},{}]", json::quote(k), (*n).min(10))).collect();
    let steps: Vec<String> = p.pend_steps.iter().take(20).map(|((a, b), n)| format!("[{},{},{}]", json::quote(a), json::quote(b), (*n).min(10))).collect();
    p.pend_opens.clear();
    p.pend_steps.clear();
    request(Want::Tool(Tool::Perf, 5), "POST", "/api/pien/learn", &format!("{{\"opens\":[{}],\"steps\":[{}]}}", opens.join(","), steps.join(",")), 0);
}

fn pien_model(v: &Value) {
    let p = &mut st().t2.pien;
    p.all_opens = v.get("opens").entries().iter().map(|(k, n)| (k.clone(), n.f())).collect();
    p.all_next = v.get("next").entries().iter().map(|(a, row)| (a.clone(), row.entries().iter().map(|(b, n)| (b.clone(), n.f())).collect())).collect();
    p.all_n = v.get("interactions").f();
    st().t2.pien.pick = pien_predict();
}

fn pien_panel(s: &State) -> N {
    let p = &s.t2.pien;
    let mut pairs: BTreeMap<(String, String), f64> = BTreeMap::new();
    for (a, row) in &p.next {
        for (b, n) in row {
            *pairs.entry((a.clone(), b.clone())).or_default() += *n as f64;
        }
    }
    for (a, row) in &p.all_next {
        for (b, n) in row {
            *pairs.entry((a.clone(), b.clone())).or_default() += *n;
        }
    }
    let mut top: Vec<((String, String), f64)> = pairs.into_iter().collect();
    top.sort_by(|x, y| y.1.partial_cmp(&x.1).unwrap_or(core::cmp::Ordering::Equal));
    el("section")
        .cls("card")
        .kid(el("h3").text("PiEN: most common next steps"))
        .kid(match &p.pick {
            Some(k) => el("p").kid(txt("Suggests next: ")).kid(el("b").text(k.clone())),
            None => el("p").cls("hint").text("No suggestion yet: it needs a little more to go on."),
        })
        .kid(if top.is_empty() {
            el("p").cls("hint").text("Nothing learned yet: open a few windows and PiEN starts to see patterns.")
        } else {
            el("ol").kids(top.iter().take(5).map(|((a, b), n)| -> N { el("li").text(format!("{} → {} ({})", a, b, num(*n, 0))).into() }))
        })
        .into()
}

// ---------------------------------------------------------------------------------------------- loading, answers, actions

fn tools2_load(t: Tool) {
    let s = st();
    let get = |slot: &mut Slot, want: Want, url: &str| {
        if slot.needed() {
            slot.busy = true;
            request(want, "GET", url, "", 0);
        }
    };
    match t {
        Tool::Recent => get(&mut s.t2.recent, Want::Tool(Tool::Recent, 0), "/api/assessments/recent?limit=30"),
        Tool::Perf => {
            get(&mut s.t2.engines, Want::Tool(Tool::Perf, 0), "/api/engines/status");
            get(&mut st().t2.forecast, Want::Tool(Tool::Perf, 1), "/api/forecast");
        }
        Tool::Analytics => {
            get(&mut s.summary, Want::Summary, "/api/analytics/summary");
            get(&mut st().t2.traffic, Want::Tool(Tool::Analytics, 0), "/api/traffic?days=30");
        }
        Tool::Private => {
            if is_owner(s) {
                get(&mut s.t2.private, Want::Tool(Tool::Private, 0), "/api/lab/private");
            }
        }
        Tool::Requests => {
            if is_owner(s) {
                get(&mut s.t2.requests, Want::Tool(Tool::Requests, 0), "/api/consent");
            }
        }
        Tool::Ask => get(&mut s.t2.ask_engines, Want::Tool(Tool::Ask, 0), "/api/super/engines"),
        _ => {}
    }
}

fn tools2_apply(t: Tool, w: u8, v: Value, err: Option<String>) {
    let s = st();
    match (t, w) {
        (Tool::Recent, _) => put(&mut s.t2.recent, v, err),
        (Tool::Perf, 0) => put(&mut s.t2.engines, v, err),
        (Tool::Perf, 1) => put(&mut s.t2.forecast, v, err),
        (Tool::Perf, 6) => {
            if err.is_none() {
                pien_model(&v)
            }
        }
        (Tool::Analytics, _) => put(&mut s.t2.traffic, v, err),
        (Tool::Private, 0) => put(&mut s.t2.private, v, err),
        (Tool::Private, 1) => {
            // a file's text: the request carried its index among the views
        }
        (Tool::Private, 2) => {
            s.t2.up_msg = match err {
                Some(e) => format!("Failed: {}", e),
                None => "Uploaded.".to_string(),
            };
            s.t2.private.reset();
            tools2_load(Tool::Private);
        }
        (Tool::Private, n) if n >= 100 => {
            let i = (n - 100) as usize;
            if let Some(view) = s.t2.views.get_mut(i) {
                view.2.busy = false;
                match err {
                    Some(e) => view.2.err = Some(e),
                    None => view.2.data = Some(v),
                }
            }
        }
        (Tool::Requests, 0) => put(&mut s.t2.requests, v, err),
        (Tool::Requests, 1) => {
            match err {
                Some(e) => s.t2.rq_msg = e,
                None => {
                    s.t2.rq_msg = "Created. Copy its link from the list above and paste it into your email.".to_string();
                    s.t2.rq_open = false;
                    s.t2.rq = Default::default();
                }
            }
            s.t2.requests.reset();
            tools2_load(Tool::Requests);
        }
        (Tool::Requests, 2) => {
            s.t2.requests.reset();
            tools2_load(Tool::Requests);
        }
        (Tool::Ask, 0) => put(&mut s.t2.ask_engines, v, err),
        (Tool::Ask, 9) => {
            s.t2.verdict = Some(if err.is_none() && v.get("ok").truthy() {
                (1, format!("{}{}", v.get("text").text(), if v.get("agreement").is_null() { String::new() } else { format!("\n\nAgreement: {}", v.get("agreement").text()) }))
            } else {
                (2, err.unwrap_or_else(|| v.any(&["text", "detail"]).text()))
            });
        }
        (Tool::Ask, n) if n >= 10 => ask_answer((n - 10) as usize, v, err),
        _ => {}
    }
}

fn tools2_update(t: Tool, a: u16, v: String) {
    let s = st();
    match (t, a) {
        (Tool::Arch, 1) => s.t2.arch = v.parse().unwrap_or(0),
        (Tool::Analytics, 1) => s.t2.traffic_on = v.parse().ok(),
        (Tool::Private, 1) => {
            let (p, n) = v.split_once('\t').unwrap_or(("", ""));
            s.t2.views.retain(|x| x.0 != p);
            let mut slot = Slot::default();
            let ext = n.rsplit('.').next().unwrap_or("").to_lowercase();
            let text = !matches!(ext.as_str(), "pdf" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg");
            if text {
                slot.busy = true;
            }
            s.t2.views.push((p.to_string(), n.to_string(), slot));
            if text {
                let i = s.t2.views.len() - 1;
                request(Want::Tool(Tool::Private, 100 + i.min(150) as u8), "GET", &file_url(p, n), "", 0);
            }
        }
        (Tool::Private, 2) => s.t2.up_project = v,
        (Tool::Private, 3) => {
            s.t2.up_files = v
                .lines()
                .filter_map(|l| {
                    let f: Vec<&str> = l.splitn(3, '\t').collect();
                    match f.as_slice() {
                        [h, sz, name] => Some((h.parse().ok()?, sz.parse().unwrap_or(0.0), name.to_string())),
                        _ => None,
                    }
                })
                .collect();
        }
        (Tool::Private, 4) => {
            let project = s.t2.up_project.trim().to_lowercase();
            let ok = !project.is_empty() && project.len() <= 48 && project.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !project.starts_with('-');
            if !ok {
                s.t2.up_msg = "Project names use lowercase letters, digits and dashes.".to_string();
                return;
            }
            if s.t2.up_files.is_empty() {
                s.t2.up_msg = "Choose at least one file.".to_string();
                return;
            }
            let files = core::mem::take(&mut s.t2.up_files);
            s.t2.up_msg = format!("Uploading {} file(s)…", files.len());
            for (h, _, name) in files {
                let f = host::form_new();
                host::form_file(f, "file", h);
                request(Want::Tool(Tool::Private, 2), "PUT", &file_url(&project, &name), "", f);
            }
        }
        (Tool::Requests, 2) => {
            let id: i64 = v.parse().unwrap_or(-1);
            if s.t2.rq_armed == Some(id) {
                s.t2.rq_armed = None;
                request(Want::Tool(Tool::Requests, 2), "POST", &format!("/api/consent/{}/close", id), "", 0);
            } else {
                s.t2.rq_armed = Some(id);
            }
        }
        (Tool::Requests, 3) => s.t2.rq_open = !s.t2.rq_open,
        (Tool::Requests, 4) => {
            let r = &s.t2.rq;
            let terms: Vec<String> = r[5].lines().map(|x| x.trim()).filter(|x| !x.is_empty()).map(json::quote).collect();
            let body = format!(
                "{{\"title\":{},\"recipient\":{},\"requester\":{},\"work\":{},\"message\":{},\"terms\":[{}]}}",
                json::quote(&r[0]),
                json::quote(&r[1]),
                json::quote(&r[2]),
                json::quote(&r[3]),
                json::quote(&r[4]),
                terms.join(",")
            );
            request(Want::Tool(Tool::Requests, 1), "POST", "/api/consent", &body, 0);
        }
        (Tool::Requests, n) if (16..22).contains(&n) => s.t2.rq[(n - 16) as usize] = v,
        (Tool::Ask, 1) => s.t2.ask_q = v,
        (Tool::Ask, 2) => ask_start(),
        _ => {}
    }
}

const TOOLS2_CSS: &str = "\
.arch-flow{list-style:none;padding:0;margin:16px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}\
.arch-step{width:100%;height:100%;text-align:left;border:1.4px solid #2b2b2b;background:#fff;padding:10px 12px;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:3px}\
.arch-step[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}\
.arch-n{font:600 12px/1 'Geist Mono',ui-monospace,monospace;color:var(--accent)}.arch-k{font-weight:600}.arch-s{font-size:12.5px;color:var(--muted)}\
.arch-detail ul,.arch-note ul{padding-left:20px;line-height:1.6}.arch-note{margin:16px 0}\
.rc-list{list-style:none;padding:0;margin:14px 0}.rc-list li{display:grid;grid-template-columns:minmax(120px,1fr) 2fr 50px 150px;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line);font-size:14px}\
@media (max-width:600px){.rc-list li{grid-template-columns:1fr 60px}.rc-list .md-bar,.rc-list .hint{grid-column:1/-1}}\
.perf-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:14px 0}\
.perf-card{border:1px solid var(--line2);background:#fff;padding:12px 14px}.perf-card .hint{margin:4px 0 8px}\
.pc-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.pc-tag{font-size:12px;color:var(--accent);border:1px solid var(--accent-soft);padding:1px 7px}\
.pc-status{font-size:13.5px;margin-top:8px}.perf-more{margin-top:14px}.perf .card{margin-top:12px}\
.tr-chart{width:100%;height:auto;max-width:720px;display:block;margin-top:8px}\
.tr-grid{stroke:var(--line);stroke-dasharray:3 3}.tr-axis{stroke:var(--line2)}.tr-lab{font-size:10px;fill:var(--muted)}\
.tr-bar{fill:var(--accent)}.tr-bar.on{fill:var(--magenta)}.tr-hit{fill:transparent;cursor:pointer}.tr-tip{font-size:13px;color:var(--muted);min-height:1.3em}\
.data-table{border-collapse:collapse;font-size:13px;margin-top:8px}.data-table th,.data-table td{border:1px solid var(--line);padding:4px 8px;text-align:left}\
.table-scroll{overflow:auto;max-height:480px}\
.lab-project{margin:12px 0}.lab-doc{width:100%;height:560px;border:1px solid var(--line2);margin-top:10px;background:#fff}\
.lab-img{max-width:100%;margin-top:10px}.lab-text{white-space:pre-wrap;font-size:13px;background:#fff;border:1px solid var(--line);padding:10px;max-height:480px;overflow:auto}\
.field{display:flex;flex-direction:column;gap:4px;margin:10px 0}.field span{font-size:13px;color:var(--muted)}\
.field input,.field textarea,.tool .row input[type=text]{font:inherit;padding:7px 9px;border:1px solid var(--line2);background:#fff}\
.consent-item{margin:10px 0}.consent-item input{flex:1;min-width:200px}\
.ask-form{display:flex;flex-direction:column;gap:8px;margin:14px 0}.ask-form textarea{font:inherit;padding:10px;border:1px solid var(--line2);background:#fff}\
.ask-form .btn{align-self:flex-start}.ask-card{margin:10px 0}.ask-card.err{opacity:.7}.ask-card.verdict{border-color:var(--accent)}\
.member.pien,.ric.pien{box-shadow:0 0 0 4px var(--accent-soft),0 0 18px var(--accent-soft)}\
.member .pien-tag{font-size:11.5px;color:var(--accent)}\
";
