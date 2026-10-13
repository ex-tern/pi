// The canvas, as the site has always looked (owner, 2026-10-14: "keep the wiring and original look", "keep all the
// supers"): a blue frame round the page; the title super; the controls (save, lock, chain, reset) along the top and
// the arrows along the bottom; and in the middle the site's super holding the welcome, Tools, Connect, Privacy
// choices and the holder with Explore, Library, Lab and the project. Supers are joined by wires between the ports
// on their edges (✦), as written in the site's program (pitechlab.sasm): ▷ an output, ◁ an input, △ sync,
// ▽ condition. A wire from an output is magenta; the others are ink.
//
// Supers can be dragged (unless locked); with the chain on, the holder brings what it holds. Save keeps the
// layout in this browser, reset brings back the start. A click opens a super: it fills the canvas, every other
// super becomes an icon in the rail (owner, 2026-10-14: "everything selected/open should be completely shown fit
// the canvas and supers, other things get smaller turn into icons"). Included into app.rs (it shares its state).

const S_TITLE: usize = 0;
const S_SAVE: usize = 1;
const S_LOCK: usize = 2;
const S_CHAIN: usize = 3;
const S_RESET: usize = 4;
const S_LEFT: usize = 5;
const S_UP: usize = 6;
const S_DOWN: usize = 7;
const S_RIGHT: usize = 8;
const S_SITE: usize = 9;
const S_WELCOME: usize = 10;
const S_TOOLS: usize = 11;
const S_CONNECT: usize = 12;
const S_PRIVACY: usize = 13;
const S_HOLD: usize = 14;
const S_EXPLORE: usize = 15;
const S_LIBRARY: usize = 16;
const S_LAB: usize = 17;
const S_PROJECT: usize = 18;
const NSUP: usize = 19;

type Rect = (f64, f64, f64, f64);

/// Where each super starts, in a design canvas (wide: 1440 × 900, as the site is drawn on a laptop; narrow: a phone).
fn base(narrow: bool) -> ([Rect; NSUP], f64, f64) {
    if !narrow {
        (
            [
                (27.0, 15.0, 206.0, 44.0),
                (608.0, 7.0, 50.0, 48.0),
                (666.0, 7.0, 50.0, 48.0),
                (724.0, 7.0, 50.0, 48.0),
                (782.0, 7.0, 50.0, 48.0),
                (590.0, 845.0, 50.0, 48.0),
                (648.0, 845.0, 50.0, 48.0),
                (742.0, 845.0, 50.0, 48.0),
                (800.0, 845.0, 50.0, 48.0),
                (296.0, 213.0, 849.0, 474.0),
                (325.0, 244.0, 226.0, 118.0),
                (325.0, 381.0, 226.0, 184.0),
                (346.0, 586.0, 64.0, 64.0),
                (427.0, 594.0, 137.0, 48.0),
                (585.0, 244.0, 531.0, 412.0),
                (671.0, 309.0, 98.0, 97.0),
                (930.0, 309.0, 98.0, 97.0),
                (671.0, 494.0, 98.0, 97.0),
                (930.0, 494.0, 98.0, 97.0),
            ],
            1440.0,
            900.0,
        )
    } else {
        (
            [
                (14.0, 14.0, 150.0, 40.0),
                (190.0, 14.0, 42.0, 40.0),
                (236.0, 14.0, 42.0, 40.0),
                (282.0, 14.0, 42.0, 40.0),
                (328.0, 14.0, 42.0, 40.0),
                (101.0, 792.0, 42.0, 40.0),
                (147.0, 792.0, 42.0, 40.0),
                (201.0, 792.0, 42.0, 40.0),
                (247.0, 792.0, 42.0, 40.0),
                (12.0, 76.0, 366.0, 696.0),
                (26.0, 94.0, 338.0, 92.0),
                (26.0, 204.0, 338.0, 140.0),
                (26.0, 362.0, 64.0, 64.0),
                (104.0, 370.0, 150.0, 46.0),
                (26.0, 444.0, 338.0, 312.0),
                (46.0, 468.0, 132.0, 120.0),
                (212.0, 468.0, 132.0, 120.0),
                (46.0, 616.0, 132.0, 120.0),
                (212.0, 616.0, 132.0, 120.0),
            ],
            390.0,
            844.0,
        )
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Side {
    L,
    R,
    T,
    B,
}

/// The wires of the start (pitechlab.sasm, `diagram`). FRAME is the page's own super (main).
const FRAME: usize = 99;
const WIRES: [(usize, Side, usize, Side, bool); 11] = [
    (FRAME, Side::L, S_SITE, Side::L, false),     // main◁ site◁
    (S_SITE, Side::R, FRAME, Side::R, true),      // site▷ main▷
    (S_SITE, Side::T, S_CONNECT, Side::T, false), // site△ Connect△
    (S_SITE, Side::T, S_HOLD, Side::T, false),    // site△ hold△
    (S_TOOLS, Side::R, S_EXPLORE, Side::L, true), // Tools▷ Explore◁
    (S_EXPLORE, Side::R, S_LIBRARY, Side::L, true),
    (S_LAB, Side::R, S_PROJECT, Side::L, true),
    (S_EXPLORE, Side::B, S_LAB, Side::T, false), // Explore▽ Lab△
    (S_LIBRARY, Side::B, S_PROJECT, Side::T, false),
    (S_SAVE, Side::B, S_TOOLS, Side::T, false), // ctl:save▽ Tools△
    (S_LOCK, Side::B, S_SITE, Side::T, false),  // ctl:lock▽ site△
];

/// What moves with a super when the chain is on.
fn held_by(id: usize) -> &'static [usize] {
    match id {
        S_HOLD => &[S_EXPLORE, S_LIBRARY, S_LAB, S_PROJECT],
        _ => &[],
    }
}

// ---------------------------------------------------------------------------------------------- the bubbles' members

#[derive(Clone, Copy)]
enum Target {
    /// One of the site's windows, by its address.
    Hash(&'static str),
    /// A file or another site, in a new tab.
    Url(&'static str),
    /// Words, shown in the member's window.
    Words(&'static str),
    /// What an endpoint answers, laid out.
    Data(&'static str, &'static str),
    /// A tool that ran in JavaScript and is being rewritten in Rust.
    Soon(&'static str),
}

struct Group {
    sup: usize,
    title: &'static str,
    members: &'static [(&'static str, Target)],
}

const GROUPS: [Group; 5] = [
    Group {
        sup: S_TOOLS,
        title: "Tools",
        members: &[
            ("Assess Manuscripts [Pi]", Target::Hash("#/assess")),
            ("Assist Diagnosis [Intern]", Target::Soon("The Intern helped with diagnoses from the MD plan.")),
            ("FaceMace", Target::Soon("FaceMace sorted photos by face, in your browser.")),
        ],
    },
    Group {
        sup: S_EXPLORE,
        title: "Explore",
        members: &[
            ("Live", Target::Hash("#/live")),
            ("The journal", Target::Hash("#/explore/journal")),
            ("Leaderboards", Target::Hash("#/explore/papers")),
            ("Proof-of-Research Ledger Explorer", Target::Data("/api/explorer/latest?limit=30", "Every assessment as a block on the Proof-of-Research ledger.")),
            ("Recent assessments", Target::Hash("#/explore")),
            ("Analytics", Target::Data("/api/analytics/summary", "The corpus in numbers.")),
            ("Performance", Target::Data("/api/forecast", "piD's forecast from the ledger.")),
            ("Minting Difficulty", Target::Hash("#/library")),
        ],
    },
    Group {
        sup: S_LIBRARY,
        title: "Library",
        members: &[
            ("RiBD", Target::Data("/api/buddy/suggest", "Papers to read, suggested for your profile.")),
            ("The Global Map of Science", Target::Soon("The map of science and its game drew every assessed field as a graph.")),
            ("Whitepaper", Target::Url("/ScholarPi_Whitepaper.pdf")),
            ("Architecture", Target::Hash("#/map")),
            ("Capabilities", Target::Words(
                "siM is the lab's own assistant model. riB learns which papers are worth reading. piD forecasts from the \
                 ledger. PiEn learns how the site is used. Super AI joins them, with Llama, Mistral, Qwen, Gemini and \
                 DeepSeek as independent jurors and a judge over them.",
            )),
            ("Neuro Frenzy", Target::Soon("Neuro Frenzy is a game in the Library.")),
            ("MD", Target::Soon("MD is the public Medicine plan.")),
        ],
    },
    Group {
        sup: S_LAB,
        title: "Lab",
        members: &[
            ("HAL-OS", Target::Soon("HAL-OS booted an x86 machine in your browser.")),
            ("Unigyro", Target::Soon("Unigyro II, by Murtaza Vefadar (Gebze Technical University).")),
        ],
    },
    Group {
        sup: S_CONNECT,
        title: "Connect",
        members: &[
            ("Your account", Target::Hash("#/account")),
            ("Your assessments", Target::Hash("#/account")),
            ("Research profile", Target::Data("/api/profile", "What you told the site about your research.")),
            ("piQ held for you", Target::Data("/api/assessments/claimable", "piQ held in escrow until you claim it.")),
            ("Assessment results", Target::Hash("#/assess")),
            ("Reset platform", Target::Soon("Resetting the platform is for the owner.")),
            ("Why sign in", Target::Words(
                "Signing in with ORCID links your assessments to you: they stay in your history, and the piQ they earn \
                 is minted to you instead of held in escrow. Anonymous visitors have a short free trial.",
            )),
            ("Invite a researcher", Target::Words(
                "Send a colleague to www.piii.app. Researchers signed in with ORCID can request and give peer reviews \
                 of each other's papers.",
            )),
            ("Support Pi", Target::Data("/api/donate/info", "How to support the lab.")),
            ("Contact us", Target::Words("Write to the lab through the issues of its repository on GitHub: github.com/ex-tern/pi.")),
            ("GitHub", Target::Url("https://github.com/ex-tern/pi")),
        ],
    },
];

fn group_of(sup: usize) -> Option<usize> {
    GROUPS.iter().position(|g| g.sup == sup)
}

// ---------------------------------------------------------------------------------------------- geometry

struct Geo {
    k: f64,
    ox: f64,
    oy: f64,
    w: f64,
    h: f64,
    rects: [Rect; NSUP],
}

fn geo(s: &State) -> Geo {
    let (w, h) = (host::vw(), host::vh());
    let narrow = w < 700.0;
    let (b, dw, dh) = base(narrow);
    let k = (w / dw).min(h / dh).max(0.2);
    let ox = (w - dw * k) / 2.0;
    let oy = (h - dh * k) / 2.0;
    let mut rects = b;
    for (i, r) in rects.iter_mut().enumerate() {
        let (dx, dy) = s.offs[i];
        let pan = if i >= S_SITE { s.pan } else { (0.0, 0.0) };
        r.0 += dx + pan.0;
        r.1 += dy + pan.1;
    }
    Geo { k, ox, oy, w, h, rects }
}

/// A port, in design units (the frame's own ports sit on the page's edge).
fn port(g: &Geo, id: usize, side: Side) -> (f64, f64) {
    if id == FRAME {
        let (l, t) = (-g.ox / g.k, -g.oy / g.k);
        let (r, b) = ((g.w - g.ox) / g.k, (g.h - g.oy) / g.k);
        return match side {
            Side::L => (l + 1.0, (t + b) / 2.0),
            Side::R => (r - 1.0, (t + b) / 2.0),
            Side::T => ((l + r) / 2.0, t + 1.0),
            Side::B => ((l + r) / 2.0, b - 1.0),
        };
    }
    let (x, y, w, h) = g.rects[id];
    match side {
        Side::L => (x, y + h / 2.0),
        Side::R => (x + w, y + h / 2.0),
        Side::T => (x + w / 2.0, y),
        Side::B => (x + w / 2.0, y + h),
    }
}

fn normal(side: Side) -> (f64, f64) {
    match side {
        Side::L => (-1.0, 0.0),
        Side::R => (1.0, 0.0),
        Side::T => (0.0, -1.0),
        Side::B => (0.0, 1.0),
    }
}

/// An ink wire: a curve leaving each port straight out of its edge.
fn curve(a: (f64, f64), sa: Side, b: (f64, f64), sb: Side) -> String {
    let d = ((b.0 - a.0).abs() + (b.1 - a.1).abs()).max(60.0) * 0.4;
    // a wire out of a top port runs down into what it feeds, as the site draws it
    let na = if sa == Side::T && b.1 > a.1 { (0.0, 1.0) } else { normal(sa) };
    let nb = normal(sb);
    // a wire into an input on the same side (main◁ site◁) runs straight
    let nb = if sa == sb && (sa == Side::L || sa == Side::R) { (-nb.0, -nb.1) } else { nb };
    format!(
        "M{:.1} {:.1}C{:.1} {:.1} {:.1} {:.1} {:.1} {:.1}",
        a.0,
        a.1,
        a.0 + na.0 * d,
        a.1 + na.1 * d,
        b.0 + nb.0 * d,
        b.1 + nb.1 * d,
        b.0,
        b.1
    )
}

/// A data wire: out of an output, across in straight runs with rounded corners, into an input.
fn step(a: (f64, f64), b: (f64, f64)) -> String {
    let mx = (a.0 + b.0) / 2.0;
    let dy = b.1 - a.1;
    if dy.abs() < 1.0 {
        return format!("M{:.1} {:.1}H{:.1}", a.0, a.1, b.0);
    }
    let r = 12.0f64.min(dy.abs() / 2.0).min((mx - a.0).abs()).max(0.0);
    let sy = if dy > 0.0 { 1.0 } else { -1.0 };
    let sx = if b.0 >= a.0 { 1.0 } else { -1.0 };
    format!(
        "M{:.1} {:.1}H{:.1}Q{:.1} {:.1} {:.1} {:.1}V{:.1}Q{:.1} {:.1} {:.1} {:.1}H{:.1}",
        a.0,
        a.1,
        mx - sx * r,
        mx,
        a.1,
        mx,
        a.1 + sy * r,
        b.1 - sy * r,
        mx,
        b.1,
        mx + sx * r,
        b.1,
        b.0
    )
}

/// A port's mark: a four-pointed star.
fn star(x: f64, y: f64, r: f64) -> String {
    format!(
        "M{x:.1} {:.1}Q{x:.1} {y:.1} {:.1} {y:.1}Q{x:.1} {y:.1} {x:.1} {:.1}Q{x:.1} {y:.1} {:.1} {y:.1}Q{x:.1} {y:.1} {x:.1} {:.1}Z",
        y - r,
        x + r,
        y + r,
        x - r,
        y - r
    )
}

// ---------------------------------------------------------------------------------------------- icons

fn svg_icon(paths: &[&str], size: &str, cls: &str) -> N {
    el("svg:svg")
        .cls(cls)
        .attr("viewBox", "0 0 24 24")
        .attr("width", size)
        .attr("height", size)
        .attr("fill", "none")
        .attr("stroke", "currentColor")
        .attr("stroke-width", "2")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("aria-hidden", "true")
        .kids(paths.iter().map(|d| -> N { el("svg:path").attr("d", *d).into() }))
        .into()
}

fn control_icon(id: usize, s: &State) -> N {
    match id {
        S_SAVE => svg_icon(&["M5 3h11l3 3v15H5z", "M8 3v6h8V3", "M8 21v-7h8v7"], "26", "ci accent"),
        S_LOCK => {
            if s.locked {
                el("svg:svg")
                    .cls("ci accent")
                    .attr("viewBox", "0 0 24 24")
                    .attr("width", "26")
                    .attr("height", "26")
                    .attr("aria-hidden", "true")
                    .kid(el("svg:path").attr("d", "M7 10V7a5 5 0 0 1 10 0v3").attr("fill", "none").attr("stroke", "currentColor").attr("stroke-width", "2.4"))
                    .kid(el("svg:rect").attr("x", "4.5").attr("y", "10").attr("width", "15").attr("height", "11").attr("rx", "2").attr("fill", "currentColor"))
                    .into()
            } else {
                svg_icon(&["M7 10V7a5 5 0 0 1 9.6-2", "M4.5 10h15v11h-15z"], "26", "ci")
            }
        }
        S_CHAIN => svg_icon(
            &["M9 12h6", "M8 8H6.5a4 4 0 0 0 0 8H8", "M16 8h1.5a4 4 0 0 1 0 8H16"],
            "28",
            if s.chained { "ci" } else { "ci faint" },
        ),
        S_RESET => svg_icon(&["M4 4v6h6", "M4.6 15a8 8 0 1 0 1.9-8.3L4 10"], "24", "ci"),
        S_LEFT => svg_icon(&["M19 12H5", "M11 6l-6 6 6 6"], "26", "ci"),
        S_UP => svg_icon(&["M12 19V5", "M6 11l6-6 6 6"], "26", "ci"),
        S_DOWN => svg_icon(&["M12 5v14", "M6 13l6 6 6-6"], "26", "ci"),
        S_RIGHT => svg_icon(&["M5 12h14", "M13 6l6 6-6 6"], "26", "ci"),
        _ => txt(""),
    }
}

fn sup_label(id: usize) -> &'static str {
    match id {
        S_TITLE => "piii lab",
        S_SAVE => "Save the layout",
        S_LOCK => "Lock: supers stay where they are",
        S_CHAIN => "Chain: a holder brings what it holds",
        S_RESET => "Reset: back to the start",
        S_LEFT => "Move left",
        S_UP => "Move up",
        S_DOWN => "Move down",
        S_RIGHT => "Move right",
        S_WELCOME => "Welcome",
        S_TOOLS => "Tools",
        S_CONNECT => "Connect",
        S_PRIVACY => "Privacy choices",
        S_EXPLORE => "Explore",
        S_LIBRARY => "Library",
        S_LAB => "Lab",
        S_PROJECT => "Project",
        _ => "",
    }
}

// ---------------------------------------------------------------------------------------------- the canvas

const WELCOME: &str = "ScholarPi: AI models assess your paper against open, science-aligned criteria and show what holds it \
back. Start in Assess a Manuscript; the rest of the lab is round it.";

/// A bubble's inside: its name on a tag, and one bar for each thing it holds.
fn bubble_inside(gi: usize, small: bool) -> Vec<N> {
    let g = &GROUPS[gi];
    let mut v: Vec<N> = Vec::new();
    v.push(el("span").cls("tag").text(if small { "" } else { g.title }).into());
    let mut bars = el("span").cls("bars-tree");
    for (m, (name, _)) in g.members.iter().enumerate() {
        bars = bars.kid(
            el("span")
                .cls("bar-i")
                .attr("title", *name)
                .attr("aria-label", *name)
                .attr("role", "button")
                .on("pdown", Msg::PMember(m as u8)),
        );
    }
    v.push(bars.into());
    v
}

fn tools_inside() -> Vec<N> {
    let g = &GROUPS[0];
    let mut bars = el("span").cls("t-bars");
    for (m, (name, _)) in g.members.iter().enumerate() {
        bars = bars.kid(el("span").cls("t-bar").attr("title", *name).attr("aria-label", *name).attr("role", "button").on("pdown", Msg::PMember(m as u8)));
    }
    let mut v: Vec<N> = Vec::new();
    v.push(el("span").cls("t-in").attr("title", "Tools").into());
    v.push(el("span").cls("t-brace").into());
    v.push(bars.into());
    v
}

fn canvas_view(s: &State) -> N {
    let g = geo(s);
    // wires and ports, drawn under the supers
    let mut wires = el("svg:svg").cls("wires").attr("aria-hidden", "true").attr("width", "1").attr("height", "1");
    for (a, sa, b, sb, data) in WIRES {
        let (pa, pb) = (port(&g, a, sa), port(&g, b, sb));
        let d = if data && sa == Side::R && sb == Side::L { step(pa, pb) } else { curve(pa, sa, pb, sb) };
        wires = wires.kid(el("svg:path").cls(if data { "w data" } else { "w" }).attr("d", d));
    }
    let mut stars = String::new();
    let r = if g.w < 700.0 { 5.5 } else { 8.5 / g.k.max(0.6) };
    for id in 0..NSUP {
        for side in [Side::L, Side::R, Side::T, Side::B] {
            let (x, y) = port(&g, id, side);
            stars.push_str(&star(x, y, r));
        }
    }
    for side in [Side::L, Side::R, Side::T, Side::B] {
        let (x, y) = port(&g, FRAME, side);
        stars.push_str(&star(x, y, r));
    }
    wires = wires.kid(el("svg:path").cls("ports").attr("d", stars));

    let mut stage = el("div")
        .cls("stage")
        .style(format!("transform:translate({:.1}px,{:.1}px) scale({:.4})", g.ox, g.oy, g.k))
        .kid(wires);
    for id in 0..NSUP {
        if id == S_SITE {
            continue;
        }
        let (x, y, w, h) = g.rects[id];
        let mut sx = el("div")
            .cls("sx")
            .attr("data-s", format!("{}", id))
            .style(format!("left:{:.1}px;top:{:.1}px;width:{:.1}px;height:{:.1}px", x, y, w, h))
            .on("pdown", Msg::PDown(id as u8, String::new()));
        let label = sup_label(id);
        if !label.is_empty() && id != S_HOLD {
            sx = sx.attr("tabindex", "0").attr("role", "button").attr("aria-label", label).on("enter", Msg::Activate(id as u8));
        }
        sx = match id {
            S_TITLE => sx.cls("title").text("piii lab"),
            S_SAVE | S_LOCK | S_CHAIN | S_RESET | S_LEFT | S_UP | S_DOWN | S_RIGHT => sx.cls("ctl").attr("title", label).kid(control_icon(id, s)),
            S_WELCOME => sx.cls("words").text(WELCOME),
            S_TOOLS => sx.cls("tools").kids(tools_inside()),
            S_CONNECT => sx.cls("bubble small").kids(bubble_inside(4, true)),
            S_PRIVACY => sx.cls("pchip").text("Privacy choices"),
            S_HOLD => sx.cls("hold"),
            S_EXPLORE => sx.cls("bubble").kids(bubble_inside(1, false)),
            S_LIBRARY => sx.cls("bubble").kids(bubble_inside(2, false)),
            S_LAB => sx.cls("bubble big").kids(bubble_inside(3, false)),
            S_PROJECT => {
                let mut bars = el("span").cls("bars-tree");
                for _ in 0..3 {
                    bars = bars.kid(el("span").cls("bar-i"));
                }
                sx.cls("bubble").kid(el("span").cls("tag").text("Project")).kid(bars)
            }
            _ => sx,
        };
        if s.drag.as_ref().map(|d| d.id == id && d.moved).unwrap_or(false) {
            sx = sx.cls("moving");
        }
        stage = stage.kid(sx);
    }
    el("div").cls("scene").kid(el("div").cls("frame")).kid(stage).kid(footer()).into()
}

// ---------------------------------------------------------------------------------------------- dragging and opening

pub struct Drag {
    id: usize,
    member: Option<u8>,
    sx: f64,
    sy: f64,
    k: f64,
    moved: bool,
    start: Vec<(usize, (f64, f64))>,
    pan0: (f64, f64),
}

fn begin_drag(id: usize, at: &str) {
    let s = st();
    let mut it = at.split(',');
    let x: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let y: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let g = geo(s);
    let mut ids = alloc::vec![id];
    if s.chained {
        ids.extend_from_slice(held_by(id));
    }
    let start = ids.iter().map(|i| (*i, s.offs[*i])).collect();
    s.drag = Some(Drag { id, member: s.pend_member.take(), sx: x, sy: y, k: g.k, moved: false, start, pan0: s.pan });
    host::capture(true);
}

pub fn on_pointer(phase: u32, x: f64, y: f64) {
    let s = st();
    let Some(d) = s.drag.as_mut() else {
        host::capture(false);
        return;
    };
    let (dx, dy) = ((x - d.sx) / d.k, (y - d.sy) / d.k);
    match phase {
        0 => {
            if !d.moved && (x - d.sx).abs() + (y - d.sy).abs() > 5.0 {
                d.moved = true;
            }
            let movable = !s.locked && d.id >= S_WELCOME;
            if d.moved && movable {
                for (i, (ox, oy)) in d.start.clone() {
                    s.offs[i] = (ox + dx, oy + dy);
                }
                s.dirty = true;
            } else if d.moved && d.id == S_TITLE {
                // the title moves the view
                s.pan = (d.pan0.0 + dx, d.pan0.1 + dy);
            }
            render();
        }
        1 => {
            host::capture(false);
            let d = s.drag.take().unwrap();
            if !d.moved {
                activate(d.id, d.member);
            }
            render();
        }
        _ => {
            host::capture(false);
            s.drag = None;
            render();
        }
    }
}

pub fn on_resize() {
    render();
}

fn layout_save() {
    let s = st();
    let mut out = String::new();
    for (x, y) in s.offs.iter() {
        out.push_str(&format!("{:.1},{:.1};", x, y));
    }
    out.push_str(&format!("|{:.1},{:.1}|{}|{}", s.pan.0, s.pan.1, s.locked as u8, s.chained as u8));
    host::store_set("piii:layout", &out);
    s.dirty = false;
}

fn layout_load() {
    let s = st();
    let Some(v) = host::store_get("piii:layout") else { return };
    let parts: Vec<&str> = v.split('|').collect();
    if let Some(offs) = parts.first() {
        for (i, p) in offs.split(';').filter(|p| !p.is_empty()).enumerate().take(NSUP) {
            let mut xy = p.split(',');
            let x = xy.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
            let y = xy.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
            s.offs[i] = (x, y);
        }
    }
    if let Some(p) = parts.get(1) {
        let mut xy = p.split(',');
        s.pan = (xy.next().and_then(|v| v.parse().ok()).unwrap_or(0.0), xy.next().and_then(|v| v.parse().ok()).unwrap_or(0.0));
    }
    s.locked = parts.get(2) != Some(&"0");
    s.chained = parts.get(3) != Some(&"0");
}

fn activate(id: usize, member: Option<u8>) {
    let s = st();
    match id {
        S_SAVE => layout_save(),
        S_LOCK => {
            s.locked = !s.locked;
            layout_save();
        }
        S_CHAIN => {
            s.chained = !s.chained;
            layout_save();
        }
        S_RESET => {
            s.offs = [(0.0, 0.0); NSUP];
            s.pan = (0.0, 0.0);
            s.locked = true;
            s.chained = true;
            s.open.clear();
            host::store_del("piii:layout");
        }
        S_LEFT => s.pan.0 -= 60.0,
        S_RIGHT => s.pan.0 += 60.0,
        S_UP => s.pan.1 -= 60.0,
        S_DOWN => s.pan.1 += 60.0,
        S_WELCOME => host::go("#/assess"),
        S_PRIVACY => {
            s.draft = s.consent.unwrap_or([true, true, true]);
            s.consent_open = true;
        }
        S_PROJECT => host::go("#/map"),
        S_TOOLS | S_EXPLORE | S_LIBRARY | S_LAB | S_CONNECT => {
            let gi = group_of(id).unwrap_or(0);
            match member {
                Some(m) => open_member(gi, m as usize),
                None => host::go(&format!("#/g/{}", gi)),
            }
        }
        _ => {}
    }
}

fn open_member(gi: usize, m: usize) {
    let Some((_, t)) = GROUPS.get(gi).and_then(|g| g.members.get(m)) else { return };
    match t {
        Target::Hash(h) => host::go(h),
        Target::Url(u) => host::open(u),
        _ => host::go(&format!("#/i/{}/{}", gi, m)),
    }
}

// ---------------------------------------------------------------------------------------------- the open supers

/// A bubble, open: everything it holds, each a super of its own.
fn group_page(gi: usize) -> N {
    let g = &GROUPS[gi];
    el("div")
        .kid(head(g.title, "Everything in this super. Open one and it takes the canvas; the rest wait as icons."))
        .kid(el("div").cls("members").kids(g.members.iter().enumerate().map(|(m, (name, t))| -> N {
            let (href, note, ext) = match t {
                Target::Hash(h) => (h.to_string(), "", false),
                Target::Url(u) => (u.to_string(), "Opens in a new tab", true),
                Target::Words(_) => (format!("#/i/{}/{}", gi, m), "", false),
                Target::Data(_, d) => (format!("#/i/{}/{}", gi, m), *d, false),
                Target::Soon(_) => (format!("#/i/{}/{}", gi, m), "Being rewritten in Rust", false),
            };
            el("a")
                .cls("member sx-like")
                .attr("href", href)
                .attr_if(ext, "target", "_blank")
                .attr_if(ext, "rel", "noopener")
                .kid(el("span").cls("tag").text(*name))
                .kid_if(!note.is_empty(), || el("span").cls("m-note").text(note).into())
                .kid(ports())
                .into()
        })))
        .into()
}

/// The four ports of a super drawn by CSS (a window, an icon, a member).
fn ports() -> N {
    let st = |c: &'static str| -> N {
        el("svg:svg")
            .cls(c)
            .attr("viewBox", "-8 -8 16 16")
            .attr("width", "14")
            .attr("height", "14")
            .attr("aria-hidden", "true")
            .kid(el("svg:path").attr("d", star(0.0, 0.0, 7.0)))
            .into()
    };
    el("span").cls("pts").kid(st("pt l")).kid(st("pt r")).kid(st("pt t")).kid(st("pt b")).into()
}

fn item_page(s: &State, gi: usize, m: usize) -> N {
    let Some((name, t)) = GROUPS.get(gi).and_then(|g| g.members.get(m)) else { return empty("Nothing here.") };
    let body: N = match t {
        Target::Words(w) => el("div").cls("card").kid(el("p").style("font-size:16px").text(*w)).into(),
        Target::Soon(w) => el("div")
            .cls("card")
            .kid(el("p").style("font-size:16px").text(*w))
            .kid(el("p").cls("hint").style("margin-top:10px").text(
                "It ran as JavaScript in the page. The site is Rust now, and this tool is being rewritten; until then it is not available.",
            ))
            .into(),
        Target::Data(_, d) => el("div")
            .kid(el("p").cls("lede").style("margin-bottom:14px").text(*d))
            .kid(slot_view(&s.item, "Loading…", |v| data_view(v, 0)))
            .into(),
        _ => txt(""),
    };
    el("div").kid(head(name, GROUPS[gi].title)).kid(body).into()
}

/// What an endpoint answered, laid out: names and values; lists of records as rows.
fn data_view(v: &Value, depth: usize) -> N {
    match v {
        Value::Obj(kv) => {
            let mut dl = el("dl").cls("kv");
            let mut rest: Vec<N> = Vec::new();
            for (k, x) in kv {
                let label = k.replace('_', " ");
                match x {
                    Value::Obj(_) | Value::Arr(_) if depth < 2 => {
                        if !x.truthy() {
                            continue;
                        }
                        rest.push(el("div").style("margin-top:14px").kid(el("h3").style("margin-bottom:6px").text(label)).kid(data_view(x, depth + 1)).into());
                    }
                    Value::Null => {}
                    _ => {
                        dl = dl.kid(el("dt").text(label)).kid(el("dd").style("overflow-wrap:anywhere").text(scalar(x)));
                    }
                }
            }
            el("div").cls("card").kid(dl).kids(rest).into()
        }
        Value::Arr(a) => {
            if a.is_empty() {
                return el("p").cls("hint").text("Nothing yet.").into();
            }
            el("div")
                .cls("list")
                .kids(a.iter().take(60).map(|r| -> N {
                    match r {
                        Value::Obj(kv) => {
                            let title = r.any(&["title", "name", "author", "label", "topic"]).text();
                            let rest: Vec<String> = kv
                                .iter()
                                .filter(|(k, x)| !matches!(x, Value::Obj(_) | Value::Arr(_) | Value::Null) && !["title", "name", "author", "label", "topic"].contains(&k.as_str()))
                                .take(4)
                                .map(|(k, x)| format!("{} {}", k.replace('_', " "), scalar(x)))
                                .collect();
                            el("div")
                                .cls("item")
                                .kid(el("div").cls("grow").kid(el("div").cls("t").text(if title.is_empty() { "—".to_string() } else { title })).kid(el("div").cls("s").text(rest.join(" · "))))
                                .into()
                        }
                        x => el("div").cls("item").kid(el("div").cls("t").text(scalar(x))).into(),
                    }
                }))
                .into()
        }
        x => el("p").text(scalar(x)).into(),
    }
}

fn scalar(v: &Value) -> String {
    match v {
        Value::Num(n) => {
            if *n == (*n as i64) as f64 { num(*n, 0) } else { num(*n, 3) }
        }
        Value::Str(s) => {
            if s.len() > 140 { format!("{}…", s.chars().take(140).collect::<String>()) } else { s.clone() }
        }
        x => x.text(),
    }
}

// ---------------------------------------------------------------------------------------------- the project map

struct MapNode {
    id: &'static str,
    label: &'static str,
    kind: &'static str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    opens: &'static str,
    note: &'static str,
}

const fn mn(id: &'static str, label: &'static str, kind: &'static str, x: f64, y: f64, w: f64, h: f64, opens: &'static str, note: &'static str) -> MapNode {
    MapNode { id, label, kind, x, y, w, h, opens, note }
}

// pitechlab.sasm, `map`: the whole project as one super's inside
const MAP: [MapNode; 24] = [
    mn("prompt", "Prompt", "in", 20.0, 120.0, 150.0, 64.0, "", ""),
    mn("superai", "Super AI", "ai", 210.0, 128.0, 96.0, 48.0, "", ""),
    mn("sim", "siM", "lab", 350.0, 20.0, 74.0, 40.0, "#/i/2/4", ""),
    mn("rib", "riB", "lab", 350.0, 76.0, 74.0, 40.0, "#/i/2/4", ""),
    mn("pid", "piD", "lab", 350.0, 132.0, 74.0, 40.0, "#/i/1/6", ""),
    mn("pien", "PiEn", "lab", 350.0, 188.0, 74.0, 40.0, "#/i/2/4", ""),
    mn("llama", "Llama", "out", 470.0, 8.0, 74.0, 40.0, "", ""),
    mn("mistral", "Mistral", "out", 470.0, 58.0, 74.0, 40.0, "", ""),
    mn("qwen", "Qwen", "out", 470.0, 108.0, 74.0, 40.0, "", ""),
    mn("gemini", "Gemini", "out", 470.0, 158.0, 74.0, 40.0, "", ""),
    mn("deepseek", "DeepSeek", "out", 470.0, 208.0, 74.0, 40.0, "", ""),
    mn("judge", "Judge", "judge", 600.0, 108.0, 74.0, 40.0, "", ""),
    mn("answer", "Answer", "sink", 720.0, 70.0, 160.0, 118.0, "", ""),
    mn("live", "Live", "site", 906.0, 20.0, 74.0, 40.0, "#/live", ""),
    mn("traffic", "Traffic", "site", 906.0, 200.0, 74.0, 40.0, "#/i/1/5", ""),
    mn("manuscript", "Manuscript", "in", 20.0, 330.0, 92.0, 46.0, "#/assess", ""),
    mn("extract", "Extract", "step", 132.0, 333.0, 88.0, 40.0, "", "PDF → text"),
    mn("integrity", "Integrity", "step", 238.0, 333.0, 88.0, 40.0, "", "MDAR · RRID"),
    mn("jurors", "Jurors", "step", 344.0, 333.0, 88.0, 40.0, "", ""),
    mn("verdict", "Verdict", "judge", 450.0, 333.0, 88.0, 40.0, "", "the judge"),
    mn("pix", "piX", "step", 556.0, 333.0, 88.0, 40.0, "/ScholarPi_Whitepaper.pdf", ""),
    mn("piq", "piQ", "step", 662.0, 333.0, 88.0, 40.0, "#/library", ""),
    mn("ledger", "Ledger", "step", 768.0, 333.0, 88.0, 40.0, "#/i/1/3", ""),
    mn("explorer", "Explorer", "sink", 874.0, 333.0, 106.0, 40.0, "#/explore", ""),
];

const MAP_WIRES: [(&str, &str); 28] = [
    ("prompt", "superai"),
    ("superai", "sim"),
    ("superai", "rib"),
    ("superai", "pid"),
    ("superai", "pien"),
    ("superai", "llama"),
    ("superai", "mistral"),
    ("superai", "qwen"),
    ("superai", "gemini"),
    ("superai", "deepseek"),
    ("llama", "judge"),
    ("mistral", "judge"),
    ("qwen", "judge"),
    ("gemini", "judge"),
    ("deepseek", "judge"),
    ("judge", "answer"),
    ("sim", "answer"),
    ("manuscript", "extract"),
    ("extract", "integrity"),
    ("integrity", "jurors"),
    ("jurors", "verdict"),
    ("verdict", "pix"),
    ("pix", "piq"),
    ("piq", "ledger"),
    ("ledger", "explorer"),
    ("pix", "pid"),
    ("pix", "rib"),
    ("ledger", "live"),
];

const MAP_SECTIONS: [(&str, f64, f64, f64, f64); 3] =
    [("one prompt, every engine", 14.0, 0.0, 972.0, 270.0), ("the assessment", 14.0, 300.0, 972.0, 110.0), ("the site", 14.0, 470.0, 972.0, 100.0)];

fn map_page() -> N {
    let find = |id: &str| MAP.iter().find(|n| n.id == id);
    let mut svg = el("svg:svg").cls("map").attr("viewBox", "0 -24 1000 604").attr("role", "img").attr("aria-label", "The project map");
    for (label, x, y, w, h) in MAP_SECTIONS {
        svg = svg
            .kid(el("svg:rect").cls("m-sec").attr("x", format!("{}", x)).attr("y", format!("{}", y)).attr("width", format!("{}", w)).attr("height", format!("{}", h)))
            .kid(el("svg:text").cls("m-sec-t").attr("x", format!("{}", x + 8.0)).attr("y", format!("{}", y - 6.0)).text(label));
    }
    for (a, b) in MAP_WIRES {
        let (Some(na), Some(nb)) = (find(a), find(b)) else { continue };
        // into the node's left edge, or its top/bottom when it sits above or below
        let pa = (na.x + na.w, na.y + na.h / 2.0);
        let (pb, sb) = if nb.x > na.x + na.w {
            ((nb.x, nb.y + nb.h / 2.0), Side::L)
        } else if nb.y < na.y {
            ((nb.x + nb.w / 2.0, nb.y + nb.h), Side::B)
        } else {
            ((nb.x + nb.w / 2.0, nb.y), Side::T)
        };
        let data = sb == Side::L;
        svg = svg.kid(el("svg:path").cls(if data { "w data" } else { "w" }).attr("d", if data { curve(pa, Side::R, pb, Side::L) } else { curve(pa, Side::R, pb, sb) }));
    }
    let mut stars = String::new();
    for n in MAP.iter() {
        for (x, y) in [(n.x, n.y + n.h / 2.0), (n.x + n.w, n.y + n.h / 2.0), (n.x + n.w / 2.0, n.y), (n.x + n.w / 2.0, n.y + n.h)] {
            stars.push_str(&star(x, y, 4.5));
        }
    }
    for n in MAP.iter() {
        let mut gnode = el("svg:g").cls("m-node").cls(n.kind);
        gnode = gnode
            .kid(el("svg:rect").attr("x", format!("{}", n.x)).attr("y", format!("{}", n.y)).attr("width", format!("{}", n.w)).attr("height", format!("{}", n.h)))
            .kid(el("svg:text").attr("x", format!("{}", n.x + n.w / 2.0)).attr("y", format!("{}", n.y + n.h / 2.0 + if n.note.is_empty() { 5.0 } else { -2.0 })).attr("text-anchor", "middle").text(n.label));
        if !n.note.is_empty() {
            gnode = gnode.kid(el("svg:text").cls("m-note").attr("x", format!("{}", n.x + n.w / 2.0)).attr("y", format!("{}", n.y + n.h / 2.0 + 13.0)).attr("text-anchor", "middle").text(n.note));
        }
        if !n.opens.is_empty() {
            let a = el("svg:a").attr("href", n.opens).cls("m-link");
            let a = if n.opens.starts_with('/') { a.attr("target", "_blank") } else { a };
            svg = svg.kid(a.kid(gnode));
        } else {
            svg = svg.kid(gnode);
        }
    }
    svg = svg.kid(el("svg:path").cls("ports").attr("d", stars));
    // the site row: the supers of the canvas, as a reminder of where the map sits
    let mut x = 20.0;
    for g in GROUPS.iter() {
        let w = 150.0;
        svg = svg.kid(
            el("svg:a").attr("href", format!("#/g/{}", group_of(g.sup).unwrap_or(0))).cls("m-link").kid(
                el("svg:g")
                    .cls("m-node site")
                    .kid(el("svg:rect").attr("x", format!("{}", x)).attr("y", "500").attr("width", format!("{}", w)).attr("height", "40"))
                    .kid(el("svg:text").attr("x", format!("{}", x + w / 2.0)).attr("y", "525").attr("text-anchor", "middle").text(g.title)),
            ),
        );
        x += w + 42.0;
    }
    el("div")
        .kid(head("Project", "The whole project as one super's inside: one prompt to every engine, the assessment from manuscript to ledger, and the site."))
        .kid(el("div").cls("map-wrap").kid(svg))
        .into()
}
