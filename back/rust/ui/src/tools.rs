// The tools that ran as JavaScript in the old page (intern.js, unigyro.js, medicine.js, neurofrenzy.js, …), in Rust.
// Included into app.rs, like scene.rs: a tool is a member of a group (Target::Tool), opened in its own window.
// Its messages are Msg::T(tool, action, value); its state lives in State::t.

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tool {
    Intern,
    Unigyro,
    Md,
    Frenzy,
    /// the canvas's program (program.rs)
    Prog,
    // tools2.rs
    Arch,
    Recent,
    Perf,
    Analytics,
    Private,
    Requests,
    Ask,
    // quvi.rs
    Quvi,
    // facemace.rs
    Face,
    // sciencemap.rs
    Map,
    // studio.rs
    Profile,
    Buddy,
    Scim,
    // reviews.rs
    Rev,
    // owner.rs
    Bug,
    Owner,
    // ledger.rs
    Ledger,
    Board,
    Donate,
    // learn.rs
    Learn,
    Whitepaper,
    // hal.rs
    Hal,
    // board.rs: a super's page as a canvas
    Grid,
    // vpn.rs: your own VPN service
    Vpn,
    // os.rs: piii OS onto a flash drive
    OsFlash,
    // portal.rs: the open portal
    Portal,
    // proxy.rs: the web proxy
    Proxy,
    // ts.rs: piii VPN through Tailscale (drawn inside the piii VPN tool)
    TsVpn,
}

/// What every tool keeps.
#[derive(Default)]
pub struct Tools {
    md: Slot,
    nf: Frenzy,
}

const T_NF: u32 = 20;

/// What a tool's window shows.
fn tool_view(s: &State, t: Tool) -> N {
    match t {
        Tool::Intern => intern_view(s),
        Tool::Unigyro => unigyro_view(),
        Tool::Md => md_view(s),
        Tool::Frenzy => frenzy_view(s),
        Tool::Prog => txt(""),
        Tool::Arch => arch_view(s),
        Tool::Recent => recent_view(s),
        Tool::Perf => perf_view(s),
        Tool::Analytics => analytics_view(s),
        Tool::Private => private_view(s),
        Tool::Requests => requests_view(s),
        // the SciM assistant is part of Super AI (owner, 2026-10-14: "merge SciM assistant into Super AI"): every
        // engine at once above, the lab's own assistant on your data and the method below
        Tool::Ask => el("div")
            .kid(ask_view(s))
            .kid(el("h3").cls("ask-scim-h").text("SciM: your data and the method"))
            .kid(scim_view(s))
            .into(),
        Tool::Quvi => quvi_view(s),
        Tool::Face => face_view(s),
        Tool::Map => map_view(s),
        Tool::Profile => profile_view(s),
        Tool::Buddy => buddy_view(s),
        Tool::Scim => scim_view(s),
        Tool::Rev => txt(""),
        Tool::Bug => bug_view(s),
        Tool::Owner => owner_view(s),
        Tool::Ledger => ledger_view(s),
        Tool::Board => board_view(s),
        Tool::Donate => donate_view(s),
        Tool::Learn => learn_view(s),
        Tool::Whitepaper => paper_doc_view(),
        Tool::Hal => hal_view(s),
        Tool::Grid => txt(""),
        Tool::Vpn => vpn_view(s),
        Tool::OsFlash => os_view(s),
        Tool::Portal => portal_view(s),
        Tool::Proxy => proxy_view(s),
        Tool::TsVpn => ts_view(s),
    }
}

/// What a tool needs fetched when its window opens.
fn tool_load(t: Tool) {
    let s = st();
    if t == Tool::Md && s.t.md.needed() {
        s.t.md.busy = true;
        request(Want::Tool(Tool::Md, 0), "GET", "/medicine/plan.json?v=1", "", 0);
    }
    if t == Tool::Quvi {
        quvi_load();
    }
    if t == Tool::Face {
        face_load();
    }
    if t == Tool::Map {
        map_load();
    }
    if matches!(t, Tool::Profile | Tool::Buddy) {
        studio_load();
    }
    if matches!(t, Tool::Scim | Tool::Ask) {
        scim_load();
    }
    if t == Tool::Bug {
        bug_load();
    }
    if t == Tool::Owner {
        owner_load();
    }
    if matches!(t, Tool::Ledger | Tool::Board | Tool::Donate) {
        ledger_load(t);
    }
    if t == Tool::Learn {
        learn_load();
    }
    if t == Tool::Hal {
        hal_load();
    }
    if t == Tool::Intern {
        intern_load();
    }
    if t == Tool::Vpn {
        vpn_load();
        ts_load();
    }
    if t == Tool::Portal {
        portal_load();
    }
    if t == Tool::Proxy {
        proxy_load();
    }
    tools2_load(t);
}

fn tool_apply(t: Tool, what: u8, v: Value, err: Option<String>) {
    let s = st();
    if t == Tool::Md {
        put(&mut s.t.md, v, err);
    } else if t == Tool::Intern {
        intern_apply(what, v, err);
    } else if t == Tool::Rev {
        rev_apply(what, v, err);
    } else if t == Tool::Vpn {
        vpn_apply(what, v, err);
    } else if t == Tool::Portal {
        portal_apply(what, v, err);
    } else if t == Tool::Proxy {
        proxy_apply(what, v, err);
    } else if t == Tool::TsVpn {
        ts_apply(what, v, err);
    } else if t == Tool::Prog && what == AI_ATTACH {
        ai_attach_apply(v, err);
    } else if t == Tool::Prog {
        ai_bubble_apply(v, err);
    } else if t == Tool::Learn {
        learn_apply(v, err);
    } else if matches!(t, Tool::Ledger | Tool::Board | Tool::Donate) {
        ledger_apply(t, what, v, err);
    } else if matches!(t, Tool::Bug | Tool::Owner) {
        owner_apply(t, what, v, err);
    } else if t == Tool::Scim {
        scim_apply(what, v, err);
    } else if matches!(t, Tool::Profile | Tool::Buddy) {
        studio_apply(what, v, err);
    } else if t == Tool::Map {
        map_apply(what, v, err);
    } else if t == Tool::Face {
        face_apply(what, v, err);
    } else if t == Tool::Quvi {
        put(&mut s.quvi.features, v, err);
    } else {
        tools2_apply(t, what, v, err);
    }
}

fn tool_update(t: Tool, a: u16, v: String) {
    match t {
        Tool::Frenzy => frenzy_update(a, v),
        Tool::Prog => prog_update(a, v),
        Tool::Quvi => quvi_update(a, v),
        Tool::Face => face_update(a, v),
        Tool::Map => map_update(a, v),
        Tool::Profile | Tool::Buddy => studio_update(a, v),
        Tool::Scim => scim_update(a, v),
        Tool::Rev => rev_update(a, v),
        Tool::Bug | Tool::Owner => owner_update(t, a, v),
        Tool::Ledger | Tool::Board | Tool::Donate => ledger_update(t, a, v),
        Tool::Learn => learn_update(a, v),
        Tool::Hal => hal_update(a, v),
        Tool::Grid => board_update(a, v),
        Tool::Intern => intern_update(a, v),
        Tool::Vpn => vpn_update(a, v),
        Tool::OsFlash => os_update(a, v),
        Tool::Portal => portal_update(a, v),
        Tool::Proxy => proxy_update(a, v),
        Tool::TsVpn => ts_update(a, v),
        _ => tools2_update(t, a, v),
    }
}

/// A tool's window closed (another page opened): what runs stops.
fn tools_leave() {
    let s = st();
    if s.t.nf.running() {
        frenzy_intro();
    }
}

fn ext_link(href: &str, label: &str) -> N {
    el("a").attr("href", href).attr("target", "_blank").attr("rel", "noopener").text(label).into()
}

// ---------------------------------------------------------------------------------------------- Intern

// ---------------------------------------------------------------------------------------------- Unigyro

const UG_VIDEO: &str = "QHxpu1xufFc";

fn unigyro_view() -> N {
    el("div")
        .cls("tool unigyro")
        .kid(el("p").cls("lede").kid(txt("A single-seater robot vehicle, by ")).kid(el("b").text("Murtaza Vefadar")).kid(txt(".")))
        .kid(
            el("div").cls("video").kid(
                el("iframe")
                    .attr("src", format!("https://www.youtube-nocookie.com/embed/{}?rel=0", UG_VIDEO))
                    .attr("title", "Unigyro II: Single-Seater Robot Vehicle, by Murtaza Vefadar")
                    .attr("allow", "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen")
                    .attr("referrerpolicy", "strict-origin-when-cross-origin")
                    .attr("allowfullscreen", "")
                    .attr("loading", "lazy"),
            ),
        )
        .kid(
            el("p")
                .cls("hint")
                .kid(txt("Video and project © Murtaza Vefadar. "))
                .kid(ext_link(&format!("https://www.youtube.com/watch?v={}", UG_VIDEO), "Watch on YouTube ↗"))
                .kid(txt(" · "))
                .kid(ext_link("https://www.youtube.com/@MortezaVafadar", "His channel ↗"))
                .kid(txt(" · He is also the author of QuVI, in this Lab.")),
        )
        .into()
}

// ---------------------------------------------------------------------------------------------- MD

/// The public, grade-free graduation plan (medicine/plan.json): CFU progress, timeline, to-dos.
fn md_view(s: &State) -> N {
    slot_view(&s.t.md, "Loading the plan…", |p| {
        let total = p.get("total").f().max(1.0);
        let earned: f64 = p.get("byYear").arr().iter().map(|y| y.get("earned").f()).sum();
        let items: Vec<&Value> = p.get("phases").arr().iter().flat_map(|ph| ph.get("items").arr().iter()).collect();
        let left: Vec<&&Value> = items.iter().filter(|i| !i.get("done").truthy()).collect();
        let left_cfu: f64 = left.iter().map(|i| i.get("cfu").f()).sum();
        let exams: Vec<&&&Value> = left.iter().filter(|i| i.get("graded").truthy()).collect();
        let exam_cfu: f64 = exams.iter().map(|i| i.get("cfu").f()).sum();
        let gap = total - earned - left_cfu;
        let pct = (100.0 * earned / total + 0.5) as i64;
        let bar = |v: f64, max: f64| -> N { el("span").cls("md-bar").kid(el("i").style(format!("width:{:.1}%", 100.0 * v / max))).into() };
        let stat = |b: String, t: String| -> N { el("div").kid(el("b").text(b)).kid(el("span").text(t)).into() };
        let mut root = el("div")
            .cls("tool md")
            .kid(el("h2").text(p.get("title").text()))
            .kid(
                el("p")
                    .cls("lede")
                    .kid(txt(format!("{}. Target: ", p.get("degree").text())))
                    .kid(el("b").text(p.get("target").text()))
                    .kid(txt(format!(", backup {}.", p.get("backup").text()))),
            )
            .kid(
                el("div")
                    .cls("md-stats")
                    .kid(stat(num(earned, 0), format!("of {} CFU earned", num(total, 0))))
                    .kid(stat(format!("{}%", pct), "of the degree".to_string()))
                    .kid(stat(format!("{}", exams.len()), format!("exams left ({} CFU)", num(exam_cfu, 0))))
                    .kid(stat(format!("{}", left.len()), format!("activities left ({} CFU)", num(left_cfu, 0)))),
            )
            .kid(bar(earned, total))
            .kid(el("h3").text("CFU by year"))
            .kid(el("div").cls("md-years").kids(p.get("byYear").arr().iter().map(|y| -> N {
                el("div")
                    .cls("md-year")
                    .kid(el("span").text(format!("Year {}", y.get("year").text())))
                    .kid(bar(y.get("earned").f(), 60.0))
                    .kid(el("em").text(y.get("earned").text()))
                    .into()
            })))
            .kid(el("h3").text("Timeline"))
            .kid(el("ol").cls("md-phases").kids(p.get("phases").arr().iter().map(|ph| -> N {
                let all = ph.get("items").arr().iter().all(|i| i.get("done").truthy());
                el("li")
                    .cls("md-phase")
                    .cls_if(all, "is-done")
                    .kid(el("div").cls("md-when").text(ph.get("when").text()))
                    .kid(
                        el("div")
                            .cls("md-what")
                            .kid(el("b").text(ph.get("label").text()))
                            .kid(el("ul").kids(ph.get("items").arr().iter().map(|i| -> N {
                                let tag = format!(
                                    "{} CFU{}{}",
                                    i.get("cfu").text(),
                                    if i.get("graded").truthy() { " · exam" } else { "" },
                                    if i.get("done").truthy() { " · done" } else { "" }
                                );
                                el("li")
                                    .cls_if(i.get("done").truthy(), "is-done")
                                    .kid(el("span").cls("md-name").text(i.get("name").text()))
                                    .kid(el("span").cls("md-tag").text(tag))
                                    .kid_if(!i.get("note").str().is_empty(), || el("small").text(i.get("note").text()).into())
                                    .into()
                            }))),
                    )
                    .into()
            })))
            .kid(el("h3").text("To do"))
            .kid(el("ul").cls("md-tasks").kids(p.get("tasks").arr().iter().map(|t| -> N {
                el("li").kid(el("span").cls("md-when").text(t.get("when").text())).kid(el("span").text(t.get("text").text())).into()
            })));
        if gap > 0.0 {
            root = root.kid(el("p").cls("hint").text(format!(
                "{} CFU are not yet placed in the plan ({} of {}).",
                num(gap, 0),
                num(earned + left_cfu, 0),
                num(total, 0)
            )));
        }
        root.kid(el("p").cls("hint").text(format!("Updated {}. Grades are deliberately not shown.", p.get("updated").text()))).into()
    })
}

// ---------------------------------------------------------------------------------------------- Neuro Frenzy

/// Fill the blanks in neuroscience statements before the clock runs out (a port of NeuroGame: same questions,
/// levels, time limits, hints and scoring, 10 points a blank, nothing if late or wrong).
struct NfQ {
    level: &'static str,
    time: f64,
    text: &'static str,
    answers: &'static [&'static str],
    hint: &'static str,
}

const NF_QS: [NfQ; 6] = [
    NfQ { level: "Easy", time: 25.0, text: "The rapid accumulation of [1] acid drops the intracellular pH, inhibiting essential glycolytic enzymes.", answers: &["lactic"], hint: "Byproduct of anaerobic glycolysis" },
    NfQ { level: "Easy", time: 25.0, text: "Deep Lenticulostriate branch strokes cause pure motor hemiparesis because they supply the posterior limb of the internal [1].", answers: &["capsule"], hint: "White matter tract structure" },
    NfQ { level: "Medium", time: 30.0, text: "On an MR Spectroscopy (MRS) profile, a Glioblastoma shows highly elevated [1], a marker of cell membrane turnover, and decreased [2], a marker of healthy neurons.", answers: &["choline", "naa"], hint: "1: Starts with C | 2: N-acetylaspartate acronym" },
    NfQ { level: "Medium", time: 30.0, text: "Anoxic depolarization removes the [1] block from the [2] receptor pore, allowing massive calcium influx.", answers: &["magnesium", "nmda"], hint: "1: A mineral | 2: Glutamate receptor type" },
    NfQ { level: "Hard", time: 40.0, text: "Damage to the dominant inferior division of the MCA can cause [1] aphasia, while damage to the dominant parietal lobe can cause [2] syndrome, characterized by agraphia and [3] agnosia.", answers: &["wernicke's", "gerstmann", "finger"], hint: "1: Receptive aphasia | 2: Syndrome name | 3: Body part" },
    NfQ { level: "Hard", time: 40.0, text: "On Perfusion-Weighted Imaging, a tumor rim shows elevated relative cerebral blood [1] due to [2], whereas an [3] shows low or normal perfusion.", answers: &["volume", "neoangiogenesis", "abscess"], hint: "1: The 'V' in rCBV | 2: New blood vessel formation | 3: Encapsulated infection" },
];

/// Difficulty changes the clock and the hints, not the questions: (key, name, time factor, hint, what it says).
const NF_LEVELS: [(&str, &str, f64, u8, &str); 3] = [
    ("easy", "Easy", 1.5, 2, "More time, and the hint is shown."),
    ("normal", "Normal", 1.0, 1, "The original clock; hints if you ask."),
    ("hard", "Hard", 0.6, 0, "Less than two thirds of the time, no hints."),
];

const NF_SONG: &str = "/sound/neurofrenzy.mp3?v=1";

#[derive(Default, PartialEq, Clone, Copy)]
enum NfStage {
    #[default]
    Intro,
    Asking,
    Answered,
    End,
}

#[derive(Default)]
struct Frenzy {
    stage: NfStage,
    qi: usize,
    score: u32,
    started: f64,
    left: f64,
    blanks: Vec<String>,
    right: Vec<bool>,
    feedback: (String, String),
    prev_best: u32,
    hint_open: bool,
}

impl Frenzy {
    fn running(&self) -> bool {
        self.stage == NfStage::Asking
    }
}

fn nf_max() -> u32 {
    NF_QS.iter().map(|q| 10 * q.answers.len() as u32).sum()
}

fn nf_level() -> usize {
    let v = host::store_get("orbit:nf:level").unwrap_or_default();
    let v = v.trim_matches('"');
    NF_LEVELS.iter().position(|l| l.0 == v).unwrap_or(1)
}

fn nf_best_key() -> String {
    let l = nf_level();
    if l == 1 { "orbit:nf:best".to_string() } else { format!("orbit:nf:best:{}", NF_LEVELS[l].0) }
}

fn nf_best() -> u32 {
    host::store_get(&nf_best_key()).and_then(|v| v.trim_matches('"').parse::<f64>().ok()).unwrap_or(0.0) as u32
}

fn nf_muted() -> bool {
    host::store_get("orbit:nf:mute").map(|v| v == "true").unwrap_or(false)
}

fn nf_limit(q: &NfQ) -> f64 {
    ((q.time * NF_LEVELS[nf_level()].2 + 0.5) as i64) as f64
}

fn nf_norm(s: &str) -> String {
    s.trim().to_lowercase().replace(['\'', '’'], "")
}

/// The music plays only while a question's clock runs, unless muted.
fn nf_music() {
    let s = st();
    let on = s.t.nf.running() && !nf_muted() && matches!(s.page, Page::Item(_, _));
    host::call("audio", &if on { format!("play\t{}\t0\t19.2", NF_SONG) } else { "pause".to_string() });
}

fn frenzy_intro() {
    let nf = &mut st().t.nf;
    nf.stage = NfStage::Intro;
    nf.qi = 0;
    nf.score = 0;
    nf_music();
}

fn frenzy_ask() {
    let nf = &mut st().t.nf;
    let q = &NF_QS[nf.qi];
    nf.stage = NfStage::Asking;
    nf.blanks = alloc::vec![String::new(); q.answers.len()];
    nf.right.clear();
    nf.feedback = (String::new(), String::new());
    nf.started = host::now();
    nf.left = nf_limit(q);
    nf.hint_open = NF_LEVELS[nf_level()].3 == 2;
    host::timer(100, T_NF);
    nf_music();
}

fn frenzy_tick() {
    let s = st();
    let nf = &mut s.t.nf;
    if nf.stage != NfStage::Asking {
        return;
    }
    let q = &NF_QS[nf.qi];
    nf.left = (nf_limit(q) - (host::now() - nf.started) / 1000.0).max(0.0);
    if nf.left <= 0.0 {
        frenzy_check(true);
    } else {
        host::timer(100, T_NF);
    }
}

fn frenzy_check(time_up: bool) {
    let nf = &mut st().t.nf;
    let q = &NF_QS[nf.qi];
    let taken = (host::now() - nf.started) / 1000.0;
    nf.right = q.answers.iter().enumerate().map(|(i, a)| nf_norm(nf.blanks.get(i).map(|x| x.as_str()).unwrap_or("")) == nf_norm(a)).collect();
    let answers = q.answers.join(", ");
    nf.feedback = if time_up || taken > nf_limit(q) {
        ("Time's up.".to_string(), format!(" The answers were: {}.", answers))
    } else if nf.right.iter().all(|r| *r) {
        let pts = 10 * q.answers.len() as u32;
        nf.score += pts;
        ("Correct!".to_string(), format!(" {:.1} s, +{} points.", taken, pts))
    } else {
        ("Not quite.".to_string(), format!(" The answers were: {}.", answers))
    };
    nf.stage = NfStage::Answered;
    nf_music();
}

fn frenzy_next() {
    let nf = &mut st().t.nf;
    nf.qi += 1;
    if nf.qi < NF_QS.len() {
        frenzy_ask();
    } else {
        nf.prev_best = nf_best();
        if nf.score > nf.prev_best {
            host::store_set(&nf_best_key(), &format!("{}", nf.score));
        }
        nf.stage = NfStage::End;
        nf_music();
    }
}

// actions
const NF_LEVEL: u16 = 1;
const NF_GO: u16 = 2;
const NF_BLANK: u16 = 3; // + blank index * 16
const NF_SUBMIT: u16 = 4;
const NF_RESET: u16 = 5;
const NF_MUTE: u16 = 6;
const NF_HINT: u16 = 7;

fn frenzy_update(a: u16, v: String) {
    let s = st();
    match a & 15 {
        NF_LEVEL => {
            if let Some(l) = NF_LEVELS.get(v.parse::<usize>().unwrap_or(1)) {
                host::store_set("orbit:nf:level", &format!("\"{}\"", l.0));
            }
        }
        NF_GO => {
            s.t.nf.qi = 0;
            s.t.nf.score = 0;
            frenzy_ask();
        }
        NF_BLANK => {
            let i = (a >> 4) as usize;
            if let Some(b) = s.t.nf.blanks.get_mut(i) {
                *b = v;
            }
        }
        NF_SUBMIT => match s.t.nf.stage {
            NfStage::Asking => frenzy_check(false),
            NfStage::Answered => frenzy_next(),
            _ => {}
        },
        NF_RESET => frenzy_intro(),
        NF_MUTE => {
            host::store_set("orbit:nf:mute", if nf_muted() { "false" } else { "true" });
            nf_music();
        }
        NF_HINT => s.t.nf.hint_open = !s.t.nf.hint_open,
        _ => {}
    }
}

fn nf_btn(label: &str, a: u16, cls: &str) -> El<Msg> {
    el("button").attr("type", "button").cls("btn").cls(cls).on("click", Msg::T(Tool::Frenzy, a, String::new())).text(label)
}

fn frenzy_view(s: &State) -> N {
    let nf = &s.t.nf;
    let muted = nf_muted();
    let mute = el("button")
        .attr("type", "button")
        .cls("nf-mute")
        .attr("aria-pressed", if muted { "true" } else { "false" })
        .attr("title", if muted { "Turn the music on" } else { "Mute the music" })
        .on("click", Msg::T(Tool::Frenzy, NF_MUTE, String::new()))
        .text(if muted { "♪ Music off" } else { "♪ Music on" });
    let lv = nf_level();
    let max = nf_max();
    let body: N = match nf.stage {
        NfStage::Intro => {
            let best = nf_best();
            el("div")
                .kid(el("p").cls("lede").text(format!(
                    "Neuroscience against the clock: fill in the blanks before time runs out. {} questions, from easy to hard, {} points to win.",
                    NF_QS.len(),
                    max
                )))
                .kid(el("div").cls("nf-diff").attr("role", "radiogroup").attr("aria-label", "Difficulty").kid(el("span").text("Difficulty")).kids(
                    NF_LEVELS.iter().enumerate().map(|(i, l)| -> N {
                        el("button")
                            .attr("type", "button")
                            .attr("role", "radio")
                            .attr("aria-checked", if i == lv { "true" } else { "false" })
                            .cls_if(i == lv, "on")
                            .on("click", Msg::T(Tool::Frenzy, NF_LEVEL, format!("{}", i)))
                            .text(l.1)
                            .into()
                    }),
                ))
                .kid(el("p").cls("hint").text(NF_LEVELS[lv].4))
                .kid_if(best > 0, || {
                    el("p").cls("nf-best").kid(txt(format!("Your best on {}: ", NF_LEVELS[lv].1.to_lowercase()))).kid(el("b").text(format!("{}", best))).kid(txt(format!(" of {}", max))).into()
                })
                .kid(nf_btn("Start", NF_GO, "primary"))
                .into()
        }
        NfStage::Asking | NfStage::Answered => {
            let q = &NF_QS[nf.qi];
            let answered = nf.stage == NfStage::Answered;
            let t = nf_limit(q);
            // the sentence, its blanks as fields
            let mut sentence = el("p").cls("nf-text");
            let mut rest = q.text;
            let mut i = 0usize;
            while let Some(at) = rest.find('[') {
                sentence = sentence.kid(txt(&rest[..at]));
                let end = rest[at..].find(']').map(|e| at + e + 1).unwrap_or(rest.len());
                let val = if answered && !nf.right.get(i).copied().unwrap_or(false) { q.answers[i].to_string() } else { nf.blanks.get(i).cloned().unwrap_or_default() };
                let mut f = el("input")
                    .cls("nf-blank")
                    .attr("type", "text")
                    .attr("autocomplete", "off")
                    .attr("autocapitalize", "off")
                    .attr("spellcheck", "false")
                    .attr("aria-label", format!("Blank {}", i + 1))
                    .prop("value", val);
                if answered {
                    f = f.attr("disabled", "").cls(if nf.right.get(i).copied().unwrap_or(false) { "ok" } else { "no" });
                } else {
                    f = f.on_val("input", NF_BLANK_FNS[i.min(3)]).on("enter", Msg::T(Tool::Frenzy, NF_SUBMIT, String::new()));
                }
                sentence = sentence.kid(f);
                rest = &rest[end..];
                i += 1;
            }
            sentence = sentence.kid(txt(rest));
            let hint_mode = NF_LEVELS[lv].3;
            let low = nf.left < 6.0 && !answered;
            el("div")
                .kid(
                    el("div")
                        .cls("nf-top")
                        .kid(el("span").cls("nf-level").cls(&format!("nf-{}", q.level.to_lowercase())).text(q.level))
                        .kid(el("span").cls("nf-prog").text(format!("Question {} of {}", nf.qi + 1, NF_QS.len())))
                        .kid(el("span").cls("nf-score").text(format!("{} pts", nf.score)))
                        .kid(nf_btn("Reset", NF_RESET, "small")),
                )
                .kid(el("div").cls("nf-clock").kid(el("i").cls_if(low, "low").style(format!("width:{:.1}%", 100.0 * nf.left / t.max(1.0)))))
                .kid(el("p").cls("nf-time").text(if answered { String::new() } else { format!("{:.1} s left", nf.left) }))
                .kid(sentence)
                .kid_if(hint_mode > 0, || {
                    let open = nf.hint_open;
                    el("div")
                        .cls("nf-hint")
                        .kid(el("button").attr("type", "button").cls("btn link").on("click", Msg::T(Tool::Frenzy, NF_HINT, String::new())).text(if hint_mode == 2 {
                            "Hint"
                        } else if open {
                            "Hide the hint"
                        } else {
                            "Need a hint?"
                        }))
                        .kid_if(open, || el("p").text(q.hint).into())
                        .into()
                })
                .kid(nf_btn(
                    if !answered { "Submit" } else if nf.qi + 1 < NF_QS.len() { "Next question" } else { "See your score" },
                    NF_SUBMIT,
                    "primary",
                ))
                .kid(el("p").cls("nf-feedback").attr("aria-live", "polite").kid(el("b").text(nf.feedback.0.clone())).kid(txt(nf.feedback.1.clone())))
                .into()
        }
        NfStage::End => {
            let best = nf.prev_best.max(nf.score);
            el("div")
                .kid(el("h2").text(if nf.score == max { "Perfect!" } else { "Game over" }))
                .kid(
                    el("p")
                        .cls("nf-final")
                        .kid(el("b").text(format!("{}", nf.score)))
                        .kid(txt(format!(" of {} points ", max)))
                        .kid(el("span").cls("hint").text(format!("on {}", NF_LEVELS[lv].1.to_lowercase()))),
                )
                .kid(if nf.score > nf.prev_best {
                    el("p").cls("nf-best").text("A new best.")
                } else {
                    el("p").cls("nf-best").kid(txt("Your best: ")).kid(el("b").text(format!("{}", best)))
                })
                .kid(el("div").cls("row").kid(nf_btn("Play again", NF_GO, "primary")).kid(nf_btn("Change difficulty", NF_RESET, "")))
                .into()
        }
    };
    el("div").cls("tool nf").kid(mute).kid(body).into()
}

const NF_BLANK_FNS: [fn(String) -> Msg; 4] = [
    |v| Msg::T(Tool::Frenzy, NF_BLANK, v),
    |v| Msg::T(Tool::Frenzy, NF_BLANK | 16, v),
    |v| Msg::T(Tool::Frenzy, NF_BLANK | 32, v),
    |v| Msg::T(Tool::Frenzy, NF_BLANK | 48, v),
];

// ---------------------------------------------------------------------------------------------- the tools' look

const TOOLS_CSS: &str = "\
.tool{max-width:760px}\
.tool .points{margin:14px 0;padding-left:20px;line-height:1.6}\
.tool .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}\
.unigyro .video{position:relative;width:100%;aspect-ratio:16/9;background:#111;margin:14px 0;overflow:hidden}\
.unigyro .video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}\
.md h2{margin:0 0 6px}.md h3{margin:22px 0 8px}\
.md-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:16px 0 10px}\
.md-stats div{border:1px solid var(--line);background:var(--card);padding:10px 12px}\
.md-stats b{display:block;font-size:24px}.md-stats span{color:var(--muted);font-size:13px}\
.md-bar{display:block;height:8px;background:var(--line);overflow:hidden}.md-bar i{display:block;height:100%;background:var(--accent)}\
.md-year{display:grid;grid-template-columns:60px 1fr 34px;gap:10px;align-items:center;margin:5px 0;font-size:14px}\
.md-year em{font-style:normal;text-align:right;color:var(--muted)}\
.md-phases{list-style:none;padding:0;margin:0}\
.md-phase{display:grid;grid-template-columns:140px 1fr;gap:14px;padding:10px 0;border-top:1px solid var(--line)}\
.md-phase.is-done{opacity:.6}.md-when{color:var(--muted);font-size:13px}\
.md-what ul{list-style:none;padding:0;margin:6px 0 0}.md-what li{margin:4px 0;font-size:14px}\
.md-what li.is-done .md-name{text-decoration:line-through}\
.md-tag{margin-left:8px;color:var(--muted);font-size:12px}.md-what small{display:block;color:var(--faint)}\
.md-tasks{list-style:none;padding:0}.md-tasks li{display:grid;grid-template-columns:140px 1fr;gap:14px;padding:6px 0;border-top:1px solid var(--line)}\
@media (max-width:600px){.md-phase,.md-tasks li{grid-template-columns:1fr;gap:4px}}\
.nf{position:relative}\
.nf-mute{position:absolute;right:0;top:-6px;border:1px solid var(--line2);background:var(--card);padding:4px 10px;font:inherit;font-size:13px;cursor:pointer}\
.nf-mute[aria-pressed=true]{color:var(--muted)}\
.nf-diff{display:flex;gap:8px;align-items:center;margin:16px 0 6px;flex-wrap:wrap}\
.nf-diff span{color:var(--muted);margin-right:4px}\
.nf-diff button{border:1px solid var(--line2);background:var(--card);padding:6px 14px;font:inherit;cursor:pointer}\
.nf-diff button.on{border-color:var(--ink);background:var(--ink);color:#fff}\
.nf-best{margin:12px 0}\
.nf-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0 10px;padding-right:110px}\
.nf-level{padding:2px 10px;border:1px solid var(--line2);font-size:13px}\
.nf-easy{border-color:var(--good);color:var(--good)}.nf-medium{border-color:var(--warn);color:var(--warn)}.nf-hard{border-color:var(--bad);color:var(--bad)}\
.nf-prog{color:var(--muted);font-size:14px}.nf-score{font-weight:600;margin-left:auto}\
.nf-clock{height:8px;background:var(--line);overflow:hidden}.nf-clock i{display:block;height:100%;background:var(--accent);transition:width .1s linear}\
.nf-clock i.low{background:var(--bad)}\
.nf-time{color:var(--muted);font-size:13px;margin:6px 0 14px;min-height:1.2em}\
.nf-text{font-size:18px;line-height:2.1}\
.nf-blank{font:inherit;font-size:16px;width:150px;padding:2px 8px;margin:0 4px;border:0;border-bottom:2px solid var(--ink);background:#fff}\
.nf-blank.ok{border-color:var(--good);color:var(--good);background:var(--good-soft)}\
.nf-blank.no{border-color:var(--bad);color:var(--bad);background:var(--bad-soft)}\
.nf-hint{margin:10px 0}.nf-hint p{margin:6px 0;color:var(--muted)}\
.nf-feedback{margin-top:14px;min-height:1.4em}\
.nf-final{font-size:20px}.nf-final b{font-size:40px}\
";
