// The canvas, as the site has always looked (owner, 2026-10-14: "keep the wiring and original look", "keep all the
// supers"): a blue frame round the page; the title super; the controls (save, lock, chain, reset) along the top and
// the arrows along the bottom; and in the middle the site's super holding the welcome, Tools, Connect, Privacy
// choices and the holder with Explore, Library, Lab and the project. Supers are joined by wires between the ports
// on their edges (✦), as written in the site's program (pitechlab.sasm): ▷ an output, ◁ an input, △ sync,
// ▽ condition. A wire from an output is magenta; the others are ink.
//
// Wiring, by the logic of the superellipse language (github.com/ex-tern/superellipse, src/super.rs and Pact): a
// super has four terminals at its extreme points. Out, on the right, is where a wire leaves; in (left), control (top)
// and gate (bottom) are where wires arrive, and data flows from left to right. Click an out, then a tip: a wire. Click
// a control or gate, then another super's control or gate: what arrives at the one is passed on to the other. Esc, or
// a click anywhere else, lets go; a double click on a wire, or a click and Delete, takes it away. A wire is refused for
// the language's reasons (a node can not feed itself, out is where a wire leaves, a super has one gate, already wired,
// that would make a loop), and the reason is said. Save, lock, chain and reset are the canvas's controls: their out
// goes into a control tip, and what arrives at a super's control (wired, or passed on) acts on it: lock holds it in
// place, chain makes it bring what it holds, save keeps the layout, and wiring reset puts it back where it started.
// Wires are drawn as the language draws them: the ins of one tip share a bus, control wires are dashed, gate wires
// dotted, every wire ends in an arrowhead. Dragging a bar out of a bubble onto anything opens what it stands for.
//
// Supers can be dragged (unless locked); with the chain on, the holder brings what it holds. Save keeps the
// layout in this browser, reset brings back the start. A click opens a super: it fills the canvas, every other
// super becomes an icon in the rail (owner, 2026-10-14: "everything selected/open should be completely shown fit
// the canvas and supers, other things get smaller turn into icons"). Included into app.rs (it shares its state).

const S_TITLE: usize = 0;
/// Once the save control; now the + that turns wiring on and off, first on the bar (owner, 2026-10-14: "this button
/// first from left", "make all the buttons uniform").
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
// the program (program.rs): its super, the palette, the examples, and run, step and clear
const S_PROG: usize = 19;
const S_PALETTE: usize = 20;
const S_EXAMPLES: usize = 21;
const S_RUN: usize = 22;
const S_STEP: usize = 23;
const S_CLEAR: usize = 24;
/// The sidebar's Insights group (owner, 2026-10-14: "put this in a new icon sidebar"): live, analytics, performance and
/// minting difficulty.
const S_INSIGHT: usize = 25;
const NSUP: usize = 26;

type Rect = (f64, f64, f64, f64);

/// Where each super starts (the controls and arrows spaced so that one's out and the next one's in do not touch), in a design canvas (wide: 1440 × 900, as the site is drawn on a laptop; narrow: a phone).
fn base(narrow: bool) -> ([Rect; NSUP], f64, f64) {
    if !narrow {
        (
            [
                (27.0, 15.0, 206.0, 44.0),
                (560.0, 9.0, 50.0, 48.0),
                (644.0, 9.0, 50.0, 48.0),
                (728.0, 9.0, 50.0, 48.0),
                (812.0, 9.0, 50.0, 48.0),
                (540.0, 843.0, 50.0, 48.0),
                (624.0, 843.0, 50.0, 48.0),
                (756.0, 843.0, 50.0, 48.0),
                (840.0, 843.0, 50.0, 48.0),
                (24.0, 96.0, 676.0, 420.0),
                (44.0, 118.0, 300.0, 98.0),
                (44.0, 236.0, 300.0, 168.0),
                (44.0, 428.0, 64.0, 64.0),
                (132.0, 436.0, 170.0, 48.0),
                (370.0, 118.0, 310.0, 378.0),
                (398.0, 146.0, 104.0, 100.0),
                (552.0, 146.0, 104.0, 100.0),
                (398.0, 366.0, 104.0, 100.0),
                (552.0, 366.0, 104.0, 100.0),
                (724.0, 96.0, 692.0, 734.0),
                (370.0, 540.0, 330.0, 220.0),
                (24.0, 540.0, 320.0, 220.0),
                (896.0, 9.0, 50.0, 48.0),
                (980.0, 9.0, 50.0, 48.0),
                (980.0, 9.0, 50.0, 48.0),
                (20.0, 334.0, 44.0, 44.0),
            ],
            1440.0,
            900.0,
        )
    } else {
        // a phone: the same canvas, stacked (the site, then the examples and palette, then the program), scaled to fit
        (
            [
                (14.0, 14.0, 190.0, 44.0),
                (330.0, 12.0, 50.0, 48.0),
                (412.0, 12.0, 50.0, 48.0),
                (494.0, 12.0, 50.0, 48.0),
                (576.0, 12.0, 50.0, 48.0),
                (0.0, 1460.0, 50.0, 48.0),
                (0.0, 1460.0, 50.0, 48.0),
                (0.0, 1460.0, 50.0, 48.0),
                (0.0, 1460.0, 50.0, 48.0),
                (8.0, 80.0, 684.0, 420.0),
                (24.0, 96.0, 310.0, 110.0),
                (24.0, 222.0, 310.0, 160.0),
                (24.0, 400.0, 64.0, 64.0),
                (112.0, 408.0, 170.0, 48.0),
                (360.0, 96.0, 316.0, 390.0),
                (390.0, 124.0, 104.0, 100.0),
                (546.0, 124.0, 104.0, 100.0),
                (390.0, 350.0, 104.0, 100.0),
                (546.0, 350.0, 104.0, 100.0),
                (8.0, 748.0, 684.0, 700.0),
                (354.0, 516.0, 338.0, 216.0),
                (8.0, 516.0, 330.0, 216.0),
                (240.0, 1460.0, 50.0, 48.0),
                (324.0, 1460.0, 50.0, 48.0),
                (324.0, 1460.0, 50.0, 48.0),
                (0.0, 1460.0, 50.0, 48.0),
            ],
            700.0,
            1515.0,
        )
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Side {
    L,
    R,
    T,
    B,
}

/// A super's four terminals, at its extreme points (±a, 0) and (0, ±b).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tip {
    In,
    Out,
    Control,
    Gate,
}

impl Tip {
    fn name(self) -> &'static str {
        match self {
            Tip::In => "in",
            Tip::Out => "out",
            Tip::Control => "control",
            Tip::Gate => "gate",
        }
    }
    fn code(self) -> u8 {
        match self {
            Tip::In => 0,
            Tip::Out => 1,
            Tip::Control => 2,
            Tip::Gate => 3,
        }
    }
    fn of(c: u8) -> Option<Tip> {
        [Tip::In, Tip::Out, Tip::Control, Tip::Gate].into_iter().find(|t| t.code() == c)
    }
    fn side(self) -> Side {
        match self {
            Tip::In => Side::L,
            Tip::Out => Side::R,
            Tip::Control => Side::T,
            Tip::Gate => Side::B,
        }
    }
}

/// The page's own super, for drawing; and the page's edge as two ends of a program: what comes in at its left
/// (a source, with only an out) and what goes out at its right (a sink, with only an in).
const FRAME: usize = 99;
const PAGE_IN: usize = 97;
const PAGE_OUT: usize = 98;

/// A wire: from a node's out to another's tip.
type WireT = (usize, usize, Tip);
/// A pass: what arrives at one super's control or gate, passed on to another's.
type PassT = (usize, Tip, usize, Tip);

/// The start (pitechlab.sasm, `diagram`), in the language's terms.
// an empty canvas: no wires to start with
const START_WIRES: [WireT; 0] = [];
const START_PASSES: [PassT; 0] = [];

/// Supers taken off the canvas (owner, 2026-10-14: the arrows, "delete these icons"; then the one-step button,
/// "delete this"); the title still moves the view, and Run still runs a program.
fn is_gone(id: usize) -> bool {
    // and the save control (owner, 2026-10-14: "delete this icon"): the layout keeps itself after every move. Then
    // everything on the canvas (owner, 2026-10-14: "delete all these things", everything on it): the sidebar reaches
    // every part of the site, and lock, chain and reset stay, under the bar. What you add (a double click: a sparkle,
    // a double right click: a super) still goes on it.
    // the legacy navigation is kept (owner, 2026-10-17): the sidebar's and the bar's supers sit pinned under them
    if rail_pin(id).is_some() {
        return host::vw() < 700.0;
    }
    !matches!(id, S_SAVE | S_LOCK | S_CHAIN | S_RESET)
}

/// The controls on the bar, in its order: their supers sit pinned under its buttons. No ▶ or ■ (owner, 2026-10-17:
/// "delete these buttons"): the program runs by itself whenever it changes, as LabVIEW's run continuously.
const BAR: [usize; 4] = [S_SAVE, S_LOCK, S_CHAIN, S_RESET];

/// The sidebar's icons, top to bottom (π, the five groups, the map; then privacy, cookies and the API), stand on
/// supers of their own that sit pinned under them, so they are wired like anything else (owner, 2026-10-14).
const RAIL: [usize; 11] = [S_TITLE, S_TOOLS, S_EXPLORE, S_LIBRARY, S_LAB, S_CONNECT, S_INSIGHT, S_PROJECT, S_PRIVACY, S_WELCOME, S_HOLD];

/// Which sidebar icon a super stands under, if any.
fn rail_pin(id: usize) -> Option<usize> {
    RAIL.iter().position(|x| *x == id)
}

/// Where the sidebar's i-th icon is on screen (its CSS, in numbers): π and six icons from the top; three at the foot.
fn rail_slot(i: usize, vh: f64) -> (f64, f64, f64, f64) {
    let (x, size, gap) = (20.0, 44.0, 8.0);
    let y = match i {
        0 => 22.0,
        1..=7 => 22.0 + i as f64 * (size + gap),
        _ => vh - 22.0 - size - (10 - i) as f64 * (size + gap),
    };
    (x, y, size, size)
}

fn on_bar(id: usize) -> bool {
    BAR.contains(&id)
}

fn is_ctl_super(id: usize) -> bool {
    matches!(id, S_LOCK | S_CHAIN | S_RESET)
}

/// The tips a node has: the page's edges one each; every super all four (owner, 2026-10-14: "make everything
/// wirable"), the title, the controls and the arrows too.
fn tips_of(id: usize) -> &'static [Tip] {
    match id {
        PAGE_IN => &[Tip::Out],
        PAGE_OUT => &[Tip::In],
        _ => &[Tip::In, Tip::Out, Tip::Control, Tip::Gate],
    }
}

fn has_tip(id: usize, tip: Tip) -> bool {
    tips_of(id).contains(&tip)
}


/// Can `from`'s out be wired to `to`'s `tip`? Or why not.
fn can_connect(s: &State, from: usize, to: usize, tip: Tip) -> Result<(), &'static str> {
    // anything joins anything (owner, 2026-10-14): a wire is refused only when it would go nowhere or is already there
    if !has_tip(from, Tip::Out) || !has_tip(to, tip) {
        return Err("there is no tip there");
    }
    if from == to && tip == Tip::Out {
        return Err("a tip does not wire to itself");
    }
    if s.wires.contains(&(from, to, tip)) {
        return Err("already wired");
    }
    Ok(())
}

/// Can what arrives at `from`'s `ft` be passed on to `to`'s `tt`? Or why not.
fn can_relay(s: &State, from: usize, ft: Tip, to: usize, tt: Tip) -> Result<(), &'static str> {
    // any tip passes on to any tip
    if !has_tip(from, ft) || !has_tip(to, tt) {
        return Err("there is no tip there");
    }
    if (from, ft) == (to, tt) {
        return Err("a tip does not wire to itself");
    }
    if s.passes.contains(&(from, ft, to, tt)) {
        return Err("already wired");
    }
    Ok(())
}

/// May the wire held at (a, ta) end at (id, tip)? Out to anything but an out is a wire, in from an out a wire drawn
/// the other way, and any other pair passes on what arrives.
fn can_join(s: &State, a: usize, ta: Tip, id: usize, tip: Tip) -> bool {
    // in and out wire only across, left to right: an out joins an in and an in an out, never a control or a gate
    // (owner, 2026-10-14); a control or a gate joins a control or a gate
    match (ta, tip) {
        (Tip::Out, Tip::In) => can_connect(s, a, id, Tip::In).is_ok(),
        (Tip::In, Tip::Out) => can_connect(s, id, a, Tip::In).is_ok(),
        (Tip::Control | Tip::Gate, Tip::Control | Tip::Gate) => can_relay(s, a, ta, id, tip).is_ok(),
        _ => false,
    }
}

/// The nodes whose outs arrive at `id`'s `tip`: wired there, or passed on to it.
fn arriving(s: &State, id: usize, tip: Tip, depth: u32) -> Vec<usize> {
    let mut v: Vec<usize> = s.wires.iter().filter(|w| w.1 == id && w.2 == tip).map(|w| w.0).collect();
    if depth < 32 {
        for p in s.passes.iter().filter(|p| p.2 == id && p.3 == tip) {
            v.extend(arriving(s, p.0, p.1, depth + 1));
        }
    }
    v
}

fn wires_save() {
    prog_autorun();
    undo_mark();
    let s = st();
    let mut out = String::from("v3;");
    for (a, b, t) in &s.wires {
        out.push_str(&format!("w{}-{}-{};", a, b, t.code()));
    }
    for (a, ta, b, tb) in &s.passes {
        out.push_str(&format!("p{}-{}-{}-{};", a, ta.code(), b, tb.code()));
    }
    host::store_set(&ckey("piii:wires2"), &out);
}

fn wires_load() {
    let s = st();
    s.wires = START_WIRES.to_vec();
    s.passes = START_PASSES.to_vec();
    let Some(v) = host::store_get(&ckey("piii:wires2")) else { return };
    let mut it = v.split(';');
    let version = it.next();
    if version != Some("v2") && version != Some("v3") {
        return;
    }
    // v2 was saved when the start wired the lock into the site, which left it free; every canvas now starts locked
    let old_start_lock = version == Some("v2");
    let ok = |id: usize| (id < NSUP && !is_gone(id)) || id == PAGE_IN || id == PAGE_OUT || s.prog.nodes.iter().any(|n| n.id == id);
    let (mut ws, mut ps): (Vec<WireT>, Vec<PassT>) = (Vec::new(), Vec::new());
    for e in it.filter(|e| !e.is_empty()) {
        let n: Vec<usize> = e[1..].split('-').filter_map(|x| x.parse().ok()).collect();
        match (e.as_bytes()[0], n.as_slice()) {
            (b'w', [a, b, t]) if ok(*a) && ok(*b) => {
                if let Some(t) = Tip::of(*t as u8) {
                    if old_start_lock && *a == S_LOCK && *b == S_SITE && t == Tip::Control {
                        continue;
                    }
                    ws.push((*a, *b, t));
                }
            }
            (b'p', [a, ta, b, tb]) if ok(*a) && ok(*b) => {
                if let (Some(ta), Some(tb)) = (Tip::of(*ta as u8), Tip::of(*tb as u8)) {
                    ps.push((*a, ta, *b, tb));
                }
            }
            _ => {}
        }
    }
    s.wires = ws;
    s.passes = ps;
}

/// Does a control have a wire out (it turns cobalt)?
fn ctl_wired(s: &State, ctl: usize) -> bool {
    s.wires.iter().any(|w| w.0 == ctl)
}

/// Every canvas starts locked, the program's nodes too: it stays where it is and keeps its size (owner, 2026-10-14:
/// "all canvases are locked by default"; "locking makes canvas at place and can't be draggable or resizable"). One is
/// unlocked by selecting it and clicking the lock, and locked again the same way (`s.free` holds the unlocked ones).
fn locked(s: &State, id: usize) -> bool {
    // on the π canvas what you draw starts unlocked, and stays so until it is locked (owner, 2026-10-14: "only in pi
    // canvas the default lock is off"); everything else is locked until it is selected and the lock is clicked
    // and now everything else too (owner, 2026-10-17: "everything is unlocked unless it's locked")
    if is_unode(id) {
        return s.locked.contains(&id);
    }
    s.sup_locked.contains(&id)
}

/// A canvas's storage key: the home canvas's as it always was; a page's, its own beside it.
fn ckey(base: &str) -> String {
    let c = &st().ctx;
    if c.is_empty() { base.to_string() } else { format!("{}@{}", base, c) }
}

fn locked_load() {
    st().locked = host::store_get(&ckey("piii:locked")).unwrap_or_default().split(',').filter_map(|x| x.parse().ok()).collect();
    st().sup_locked = host::store_get("piii:sup-locked").unwrap_or_default().split(',').filter_map(|x| x.parse().ok()).collect();
}

/// The site's own supers that have been locked (the rest are free to move and resize).
fn sup_locked_save() {
    let out: Vec<String> = st().sup_locked.iter().map(|x| x.to_string()).collect();
    host::store_set("piii:sup-locked", &out.join(","));
}

/// The canvas a page has: "" for the home canvas (and a page opened over it, the canvas live around it), else the
/// page's address.
fn page_ctx(s: &State) -> String {
    if s.page == Page::Home || s.peek {
        return String::new();
    }
    let href = host::href();
    fragment(&href).trim_start_matches('/').split('?').next().unwrap_or("").to_string()
}

/// Called whenever the page may have changed: the canvas in use becomes the page's, with what was drawn on it.
fn canvas_switch() {
    let want = page_ctx(st());
    if st().ctx == want {
        return;
    }
    let s = st();
    s.ctx = want;
    s.prog.vals.clear();
    s.prog.regs.clear();
    s.prog.steps = 0;
    s.prog.status.clear();
    s.prog.sel = None;
    s.sup_pick = None;
    s.held_port = None;
    s.wire_sel = None;
    s.marquee = None;
    s.drag = None;
    s.undo.clear();
    s.undo_at = 0.0;
    host::capture(false);
    let fresh = !prog_load();
    if fresh {
        st().prog.nodes.clear();
        st().prog.next = UBASE;
        canvas_adopt_layer();
    }
    groups_load();
    locked_load();
    wires_load();
    // a group's page: its members are π supers on its canvas (and, the first time, its old board comes over)
    if let Page::Group(g) = st().page {
        group_canvas(g as usize, fresh);
    }
    // the home canvas holds the site's places
    world_sync();
    // what is drawn here runs as soon as it shows
    prog_autorun();
}

/// Where a point on a group's old board shows on screen (roughly: the board sat under the page's heading).
fn board_to_screen(x: f64, y: f64) -> (f64, f64) {
    let s = st();
    let z = s.pzoom.max(0.01);
    let (left, top) = if host::vw() < 700.0 { (24.0, 120.0) } else { (178.0, 116.0) };
    (left + x * z + s.ppan.0, top + y * z + s.ppan.1)
}

/// A screen point, in the canvas's own units (from the Program super's corner, as nodes are kept).
fn screen_to_node(sx: f64, sy: f64) -> (f64, f64) {
    let g = geo(st());
    let (px, py, _, _) = rect(&g, S_PROG);
    ((sx - g.ox) / g.k - px, (sy - g.oy) / g.k - py)
}

/// A group's page as a π canvas: every member there as a super of its own (locked, like everything that is not drawn
/// by you), laid out and wired by what leads to what (FLOWS); on the first visit what you drew on the old board comes
/// over too (its sparkles and supers, and their wires).
fn group_canvas(gi: usize, fresh: bool) {
    let Some(grp) = GROUPS.get(gi) else { return };
    let mut changed = false;
    if fresh {
        // what you drew on the old board: its sparkles and supers, and the wires that touch them
        let b = board(gi);
        let (extra, links, sizes) = (b.extra.clone(), b.links.clone(), b.sizes.clone());
        let n = b.pos.len();
        let mut by_board: Vec<Option<usize>> = alloc::vec![None; n];
        for (k, (kind, bx, by, l)) in extra.iter().enumerate() {
            let (sx, sy) = board_to_screen(*bx, *by);
            let (x, y) = screen_to_node(sx, sy);
            let id = prog_add(&if *kind == 0 { SPARKLE.to_string() } else { l.clone() }, x, y);
            if let Some((gw, gh)) = sizes.get(n + k).copied().filter(|g| g.0 != 0.0 || g.1 != 0.0) {
                if let Some(nd) = st().prog.nodes.iter_mut().find(|nd| nd.id == id) {
                    nd.w = 88.0 + gw;
                    nd.h = 88.0 + gh;
                }
            }
            by_board.push(Some(id));
        }
        // members first, so a wire between one of yours and a member finds it
        group_members_place(gi, true);
        let member_id = |m: usize| -> Option<usize> {
            let text = format!("{}{}", MEMBER, grp.members.get(m)?.0);
            st().prog.nodes.iter().find(|nd| nd.text == text).map(|nd| nd.id)
        };
        for (a, c, t) in links {
            if a < n && c < n {
                continue; // between two members: their wires now follow the flows
            }
            let id_of = |i: usize| if i < n { member_id(i) } else { by_board.get(i).copied().flatten() };
            let (Some(ia), Some(ic)) = (id_of(a), id_of(c)) else { continue };
            let (to, from) = (t & 3, ((t >> 2) & 3) ^ 1);
            let s = st();
            match (Tip::of(from), Tip::of(to)) {
                (Some(Tip::Out), Some(Tip::In)) => s.wires.push((ia, ic, Tip::In)),
                (Some(Tip::In), Some(Tip::Out)) => s.wires.push((ic, ia, Tip::In)),
                (Some(fa), Some(tc)) if matches!(fa, Tip::Control | Tip::Gate) && matches!(tc, Tip::Control | Tip::Gate) => s.passes.push((ia, fa, ic, tc)),
                _ => {}
            }
        }
        changed = true;
    }
    // laid out and wired by meaning once (owner, 2026-10-17: "reorganize everything", "rewire everything"): your own
    // sparkles and supers stay where they are, with their wires
    if host::store_get(&ckey("piii:canvas-v")).as_deref() != Some("4") {
        group_members_place(gi, false);
        host::store_set(&ckey("piii:canvas-v"), "4");
        changed = true;
    }
    // members were locked when placed, before everything was unlocked unless locked: they come free, once
    if host::store_get(&ckey("piii:lock-v")).as_deref() != Some("1") {
        let members: Vec<usize> = st().prog.nodes.iter().filter(|n| n.text.starts_with(MEMBER)).map(|n| n.id).collect();
        st().locked.retain(|x| !members.contains(x));
        host::store_set(&ckey("piii:lock-v"), "1");
        changed = true;
    }
    // every member the site has now, there; one it no longer has here, gone
    changed |= group_members_sync(gi);
    if changed {
        locked_save();
        wires_save();
        prog_save();
        st().undo.clear();
        st().undo_at = 0.0;
    }
}

/// The members of a group put at their places in its flow, and wired by it (member to member; nothing of yours is
/// touched). Missing ones are made; with `only_missing`, the ones there stay where they are.
fn group_members_place(gi: usize, only_missing: bool) {
    let grp = &GROUPS[gi];
    let place = flow_layout(gi);
    let mut ids: Vec<Option<usize>> = alloc::vec![None; grp.members.len()];
    for (m, (name, _)) in grp.members.iter().enumerate() {
        let text = format!("{}{}", MEMBER, name);
        let (sx, sy) = board_to_screen(place[m].0, place[m].1);
        let (x, y) = screen_to_node(sx, sy);
        let have = st().prog.nodes.iter().position(|nd| nd.text == text);
        match have {
            Some(i) => {
                let nd = &mut st().prog.nodes[i];
                if !only_missing {
                    nd.x = x;
                    nd.y = y;
                    nd.w = 0.0;
                    nd.h = 0.0;
                }
                ids[m] = Some(nd.id);
            }
            None if member_hidden(gi, m) => {}
            None => {
                let id = prog_add(&text, x, y);
                ids[m] = Some(id);
            }
        }
    }
    if only_missing {
        return;
    }
    // the wires between members: as the flows say, and no others
    let members: Vec<usize> = ids.iter().flatten().copied().collect();
    let s = st();
    s.wires.retain(|w| !(members.contains(&w.0) && members.contains(&w.1)));
    s.passes.retain(|p| !(members.contains(&p.0) && members.contains(&p.2)));
    let idx = |name: &str| grp.members.iter().position(|m| m.0 == name);
    for (a, b) in FLOWS[gi].iter() {
        if let (Some(Some(ia)), Some(Some(ib))) = (idx(a).map(|i| ids[i]), idx(b).map(|i| ids[i])) {
            st().wires.push((ia, ib, Tip::In));
        }
    }
}

/// Members added to the group since appear at their place in the flow; members moved to another group go. Answers
/// whether anything changed.
fn group_members_sync(gi: usize) -> bool {
    let grp = &GROUPS[gi];
    let place = flow_layout(gi);
    let mut changed = false;
    for (m, (name, _)) in grp.members.iter().enumerate() {
        let text = format!("{}{}", MEMBER, name);
        if member_hidden(gi, m) || st().prog.nodes.iter().any(|nd| nd.text == text) {
            continue;
        }
        let (sx, sy) = board_to_screen(place[m].0, place[m].1);
        let (x, y) = screen_to_node(sx, sy);
        prog_add(&text, x, y);
        changed = true;
    }
    let stale: Vec<usize> = st().prog.nodes.iter().filter(|nd| nd.text.starts_with(MEMBER) && member_of(&nd.text).map(|(g, _)| g != gi).unwrap_or(true)).map(|nd| nd.id).collect();
    for id in &stale {
        let s = st();
        s.prog.nodes.retain(|nd| nd.id != *id);
        s.wires.retain(|w| w.0 != *id && w.1 != *id);
        s.passes.retain(|p| p.0 != *id && p.2 != *id);
        changed = true;
    }
    changed
}

/// What was drawn on this page before it had a canvas of its own (sparkles and named supers, in the page's own
/// coordinates), moved onto its canvas once, roughly where it showed.
fn canvas_adopt_layer() {
    let key = layer_key();
    let Some(t) = host::store_get(&key) else { return };
    let s = st();
    let g = geo(s);
    let (px, py, _, _) = rect(&g, S_PROG);
    let z = s.pzoom.max(0.01);
    let (left, top) = (if host::vw() < 700.0 { 12.0 } else { 104.0 }, 74.0);
    let mut n = 0;
    for l in t.lines() {
        let f: Vec<&str> = l.splitn(4, '\t').collect();
        if let [k, x, y, label] = f.as_slice() {
            if let (Ok(k), Ok(x), Ok(y)) = (k.parse::<u8>(), x.parse::<f64>(), y.parse::<f64>()) {
                let (sx, sy) = (left + x * z + s.ppan.0, top + y * z + s.ppan.1);
                let text = if k == 0 { SPARKLE.to_string() } else { label.to_string() };
                prog_add(&text, (sx - g.ox) / g.k - px, (sy - g.oy) / g.k - py);
                n += 1;
            }
        }
    }
    if n > 0 {
        prog_save();
    }
    host::store_del(&key);
    st().layers.remove(&key);
}

fn locked_save() {
    let out: Vec<String> = st().locked.iter().map(|x| x.to_string()).collect();
    host::store_set(&ckey("piii:locked"), &out.join(","));
}

/// A super under this share of the window's width or height, as drawn now, is an icon; at or over both, a canvas (owner,
/// 2026-10-14: "if a super is less than 10% of the screen size, then it's icon. If it's more than 10%, it's a canvas").
/// An icon is drawn as one and is never locked; it changes as the canvas zooms or the super is resized.
// 5% for a while, then 10% again (owner, 2026-10-14)
const ICON_SHARE: f64 = 0.10;

/// The smallest a super gets, in design units (a speck, but never nothing: the canvas zooms in without end to find it).
const MIN_SUPER: f64 = 0.5;

fn icon_area(w_px: f64, h_px: f64) -> bool {
    // measured as it looks: under 10% of the window's width or of its height, an icon; at least 10% of both, a canvas
    // that reads in full (owner, 2026-10-14: "it's bigger than 10% of the screen. It should read completely")
    w_px < ICON_SHARE * host::vw() || h_px < ICON_SHARE * host::vh()
}

/// Supers that take the icon look when small: not the controls (already icons), the title, the holder's frame, or
/// a program's nodes (their text is what they are).
fn icon_kind(id: usize) -> bool {
    id >= S_WELCOME && id < NSUP && id != S_HOLD && !is_ctl_super(id) && !matches!(id, S_RUN | S_STEP | S_CLEAR)
}

/// Is this super (or program node) an icon on the main canvas as it is drawn now?
fn is_icon(s: &State, id: usize) -> bool {
    if id == S_HOLD || is_ctl_super(id) {
        return false;
    }
    let g = geo(s);
    let (_, _, w, h) = rect(&g, id);
    w > 0.0 && icon_area(w * g.k, h * g.k)
}

/// A super on the main canvas that a double click shrinks: shown as a canvas, and unlocked (owner, 2026-10-14: "if a
/// super is unlocked, double clicking it on its canvas will close it", to an icon).
fn shrinkable(s: &State, id: usize) -> bool {
    id < NSUP && icon_kind(id) && !is_icon(s, id) && !s.sup_locked.contains(&id)
}

/// The share of the window an icon is shrunk to when its starting size is itself a canvas.
const SHRUNK_SHARE: f64 = 0.08;

/// The size (w, h) a box of base size (bw, bh), drawn at scale k, takes as an icon: its starting size when that is
/// an icon, else that shape at 8% of the window.
fn icon_size(bw: f64, bh: f64, k: f64) -> (f64, f64) {
    let (vw, vh) = (host::vw(), host::vh());
    if icon_area(bw * k, bh * k) {
        (bw, bh)
    } else {
        // that shape, at 8% of the window across or down, whichever comes first
        let f = (SHRUNK_SHARE * vw / (bw * k)).min(SHRUNK_SHARE * vh / (bh * k));
        (bw * f, bh * f)
    }
}

fn shrink_to_icon(id: usize) {
    let s = st();
    let (b, _, _) = base(host::vw() < 700.0);
    let (bw, bh) = (b[id].2, b[id].3);
    let (w, h) = icon_size(bw, bh, geo(s).k);
    s.sizes[id] = (w - bw, h - bh);
    // back to an icon (still unlocked: nothing locks unless it is locked)
    layout_save();
    note(format!("{} is an icon again", name_of(id)));
}

/// The icon a small super is drawn as: its line drawing when it has one, else its name's initials.
fn icon_view(id: usize) -> N {
    let name = sup_label(id);
    let mark = match group_of(id) {
        Some(gi) => mark_of(Page::Group(gi as u8), name),
        // the supers pinned under the bar and the sidebar have icons of their own there
        None if rail_pin(id).is_some() || on_bar(id) || is_gone(id) => txt(glyph(name)),
        None => ai_mark(name),
    };
    el("span").cls("icon-g").kid(mark).into()
}

/// What the lock acts on: the selected canvas, newest kind first. Some((is it unlocked now)), or None.
/// Is the main canvas the one in use (its selection is what the lock acts on)? A selection left on it does not
/// follow you to another page.
fn canvas_live(s: &State) -> bool {
    // every page has its π canvas now (its ctx): what is selected on it is what the lock acts on
    s.page == Page::Home || s.peek || !s.ctx.is_empty()
}

fn lock_target_free(s: &State) -> Option<bool> {
    if let Page::Group(g) = s.page {
        if let Some(b) = s.boards.get(g as usize) {
            if let Some(n) = b.picked {
                // an icon is never locked
                return Some(bnode_free(b, n));
            }
        }
    }
    if s.float_pick {
        return Some(s.float_free);
    }
    if s.win_pick {
        return Some(s.win_free);
    }
    if !canvas_live(s) {
        return None;
    }
    if let Some(id) = s.sup_pick {
        return Some(!locked(s, id));
    }
    if let Some(id) = s.prog.sel {
        return Some(!locked(s, id));
    }
    None
}

/// Selecting something else locks what was selected before (owner, 2026-10-14: "selecting other canvas, other super
/// locks the previous super automatically"). Called just before a new selection is made.
/// Every unlocked canvas is locked again except the one being selected (so a drag that let the selection go does
/// not leave the previous one unlocked).
/// No longer: nothing locks by itself (owner, 2026-10-17: "everything is unlocked unless it's locked"); only the lock
/// locks. Kept so the places that selected through it still read the same.
fn relock_except(_main: Option<usize>, _node: Option<usize>, _win: bool) {}

/// The lock: the selected canvas is unlocked, or locked again. With nothing selected it says how.
fn lock_toggle() {
    let s = st();
    // keep the selection that the click on the lock would otherwise let go
    s.last_tap = (usize::MAX, None, host::now());
    let flip = |v: &mut Vec<usize>, id: usize| -> bool {
        if let Some(i) = v.iter().position(|x| *x == id) {
            v.remove(i);
            false
        } else {
            v.push(id);
            true
        }
    };
    if let Page::Group(g) = s.page {
        let gi = g as usize;
        if let Some(n) = board(gi).picked {
            let b = board(gi);
            let open = flip(&mut b.free, n);
            board_save(gi);
            note(if open { "Unlocked: drag it to move it, the middle button resizes it" } else { "Locked in place" }.to_string());
            return;
        }
    }
    if s.float_pick {
        s.float_free = !s.float_free;
        host::store_set("piii:float-free", if s.float_free { "1" } else { "0" });
        note(if s.float_free { "The canvas is unlocked: drag it to move it, click it to change its size" } else { "The canvas is locked in place" }.to_string());
        return;
    }
    if s.win_pick {
        s.win_free = !s.win_free;
        host::store_set("piii:win-free", if s.win_free { "1" } else { "0" });
        note(if s.win_free { "The window is unlocked: drag its edges to resize it" } else { "The window is locked at its size" }.to_string());
        return;
    }
    let picks = if canvas_live(s) { (s.sup_pick, s.prog.sel) } else { (None, None) };
    let id = match picks {
        (Some(id), _) | (None, Some(id)) => id,
        _ => {
            note("Select a canvas first, then click the lock to unlock it".to_string());
            return;
        }
    };
    if is_unode(id) {
        // on the π canvas the lock is off until it is turned on: the list holds the locked ones
        let open = !flip(&mut s.locked, id);
        for m in group_with(s, id) {
            s.locked.retain(|x| *x != m);
            if !open {
                s.locked.push(m);
            }
        }
        locked_save();
        note(if open { format!("Unlocked: {} can be moved and resized", name_of(id)) } else { format!("Locked in place: {}", name_of(id)) });
        return;
    }
    let open = !flip(&mut s.sup_locked, id);
    // a group locks and unlocks as one
    for m in group_with(s, id) {
        s.sup_locked.retain(|x| *x != m);
        if !open {
            s.sup_locked.push(m);
        }
    }
    sup_locked_save();
    note(if open { format!("Unlocked: {} can be moved and resized", name_of(id)) } else { format!("Locked in place: {}", name_of(id)) });
}

fn chain_on(s: &State, id: usize) -> bool {
    s.chained || arriving(s, id, Tip::Control, 0).contains(&S_CHAIN)
}

fn name_of(id: usize) -> String {
    match id {
        FRAME => "the page".to_string(),
        PAGE_IN => "the page's left edge".to_string(),
        PAGE_OUT => "the page's right edge".to_string(),
        S_SITE => "the site".to_string(),
        S_TITLE => "π".to_string(),
        S_WELCOME => "Cookies".to_string(),
        S_HOLD => "API".to_string(),
        S_PROJECT => "Project".to_string(),
        _ if is_unode(id) => match unode(st(), id) {
            Some(n) if n.text.trim().is_empty() => "a super".to_string(),
            Some(n) if n.text == SPARKLE => "a sparkle".to_string(),
            // words already in quotes are not quoted again
            Some(n) => format!("“{}”", n.text.trim().trim_matches(|c| c == '"' || c == '“' || c == '”')),
            None => "a node".to_string(),
        },
        _ => sup_label(id).split(':').next().unwrap_or("").to_string(),
    }
}

/// A bar of a bubble being dragged out: wherever it lands, what it stands for opens.
#[derive(Clone, Copy)]
pub enum From {
    Bar(usize, usize),
}

pub struct Wiring {
    from: From,
    at: (f64, f64),
    to: Option<(usize, Side)>,
}

/// What moves with a super when the chain is on.
fn held_by(id: usize) -> &'static [usize] {
    match id {
        S_HOLD => &[S_EXPLORE, S_LIBRARY, S_LAB, S_PROJECT],
        S_SITE => &[S_WELCOME, S_TOOLS, S_CONNECT, S_PRIVACY, S_HOLD, S_EXPLORE, S_LIBRARY, S_LAB, S_PROJECT],
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
    /// A tool rewritten in Rust (tools.rs).
    Tool(Tool),
}

struct Group {
    sup: usize,
    title: &'static str,
    members: &'static [(&'static str, Target)],
}

// The groups, reorganized by what each thing is for (owner, 2026-10-17: "reorganize everything"): Tools are what you
// use on your own work (assessing, asking, reading lists, diagnosis, faces, and getting online through the lab);
// Explore is what the lab has assessed; the Library is what to read and learn; the Lab its experiments (piii OS
// among them); Connect is you and the people round the lab; Insights how the site is doing. Each group's order
// follows its wires (FLOWS), the way things lead from one to the next.
const GROUPS: [Group; 6] = [
    Group {
        sup: S_TOOLS,
        title: "Tools",
        members: &[
            ("RiBD", Target::Tool(Tool::Buddy)),
            ("Assess Manuscripts [Pi]", Target::Hash("#/assess")),
            ("Super AI", Target::Tool(Tool::Ask)),
            ("Assist Diagnosis [Intern]", Target::Tool(Tool::Intern)),
            ("Face Mace", Target::Tool(Tool::Face)),
            ("Web proxy", Target::Tool(Tool::Proxy)),
            ("piii VPN", Target::Tool(Tool::Vpn)),
        ],
    },
    Group {
        sup: S_EXPLORE,
        title: "Explore",
        members: &[
            ("Recent assessments", Target::Tool(Tool::Recent)),
            ("Leaderboards", Target::Tool(Tool::Board)),
            ("Proof-of-Research Ledger Explorer", Target::Tool(Tool::Ledger)),
        ],
    },
    Group {
        sup: S_LIBRARY,
        title: "Library",
        members: &[
            ("Learn to program", Target::Tool(Tool::Learn)),
            ("Capabilities", Target::Words(
                "siM is the lab's own assistant model. riB learns which papers are worth reading. piD forecasts from the \
                 ledger. PiEn learns how the site is used. Super AI joins them, with Llama, Mistral, Qwen, Gemini and \
                 DeepSeek as independent jurors and a judge over them.",
            )),
            ("Architecture", Target::Tool(Tool::Arch)),
            ("Whitepaper", Target::Tool(Tool::Whitepaper)),
            ("The journal", Target::Hash("#/explore/journal")),
            ("The Global Map of Science", Target::Tool(Tool::Map)),
        ],
    },
    Group {
        sup: S_LAB,
        title: "Lab",
        members: &[
            ("HAL-OS", Target::Tool(Tool::Hal)),
            ("piii OS", Target::Tool(Tool::OsFlash)),
            ("QuVI", Target::Tool(Tool::Quvi)),
            ("MD", Target::Tool(Tool::Md)),
            ("Neuro Frenzy", Target::Tool(Tool::Frenzy)),
            ("Unigyro", Target::Tool(Tool::Unigyro)),
        ],
    },
    Group {
        sup: S_CONNECT,
        title: "Connect",
        members: &[
            ("Why sign in", Target::Words(
                "Signing in with ORCID links your assessments to you: they stay in your history, and the piQ they earn \
                 is minted to you instead of held in escrow. Anonymous visitors have a short free trial.",
            )),
            // your assessments and the piQ held for you are on it (owner, 2026-10-17: "simplify everything")
            ("Your account", Target::Hash("#/account")),
            ("Research profile", Target::Tool(Tool::Profile)),
            ("Private projects", Target::Tool(Tool::Private)),
            ("Permission requests", Target::Tool(Tool::Requests)),
            ("Owner console", Target::Tool(Tool::Owner)),
            ("Invite a researcher", Target::Words(
                "Send a colleague to www.piii.app. Researchers signed in with ORCID can request and give peer reviews \
                 of each other's papers.",
            )),
            ("Open portal", Target::Tool(Tool::Portal)),
            ("Contact us", Target::Tool(Tool::Bug)),
            ("Support Pi", Target::Tool(Tool::Donate)),
            ("GitHub", Target::Url("https://github.com/ex-tern/pi")),
        ],
    },
    Group {
        sup: S_INSIGHT,
        title: "Insights",
        members: &[
            ("Live", Target::Hash("#/live")),
            ("Analytics", Target::Tool(Tool::Analytics)),
            ("Performance", Target::Tool(Tool::Perf)),
            ("Minting Difficulty", Target::Hash("#/library")),
        ],
    },
];

/// How each group's members lead into one another (owner, 2026-10-17: "rewire everything", by meaning): an out into
/// an in, by name. What stands alone has no wire.
const FLOWS: [&[(&str, &str)]; 6] = [
    // Tools: find what is worth reading, assess it, ask about it; the lighter way online before the whole one
    &[("RiBD", "Assess Manuscripts [Pi]"), ("Assess Manuscripts [Pi]", "Super AI"), ("Web proxy", "piii VPN")],
    // Explore: every assessment ranks on the leaderboards and is a block on the ledger
    &[("Recent assessments", "Leaderboards"), ("Recent assessments", "Proof-of-Research Ledger Explorer")],
    // Library: learn, see what the models can do and how they are built, read the paper; results into the journal,
    // the journal's papers onto the map
    &[
        ("Learn to program", "Architecture"),
        ("Capabilities", "Architecture"),
        ("Architecture", "Whitepaper"),
        ("Whitepaper", "The journal"),
        ("The journal", "The Global Map of Science"),
    ],
    // Lab: the operating systems, the old one before the new; study medicine, then practise neuroscience
    &[("HAL-OS", "piii OS"), ("MD", "Neuro Frenzy")],
    // Connect: why sign in, then your account and what hangs off it; invite people to the open portal
    &[
        ("Why sign in", "Your account"),
        ("Your account", "Research profile"),
        ("Research profile", "Private projects"),
        ("Private projects", "Permission requests"),
        ("Invite a researcher", "Open portal"),
    ],
    // Insights: what happens now, counted, and how fast it is served
    &[("Live", "Analytics"), ("Analytics", "Performance")],
];

/// A group's members placed by their wires (owner, 2026-10-17: "layout of each canvas"): each in the column after
/// everything that leads into it, top to bottom in the group's order; what stands alone in rows below. Where each
/// goes, in the old board's units (as `board_to_screen` reads them).
fn flow_layout(gi: usize) -> Vec<(f64, f64)> {
    let g = &GROUPS[gi];
    let n = g.members.len();
    let idx = |name: &str| g.members.iter().position(|m| m.0 == name);
    let links: Vec<(usize, usize)> = FLOWS[gi].iter().filter_map(|(a, b)| Some((idx(a)?, idx(b)?))).collect();
    let wired: Vec<bool> = (0..n).map(|i| links.iter().any(|l| l.0 == i || l.1 == i)).collect();
    // the column: one after the furthest that leads into it
    let mut col = alloc::vec![0usize; n];
    for _ in 0..n {
        for &(a, b) in &links {
            if col[b] < col[a] + 1 {
                col[b] = col[a] + 1;
            }
        }
    }
    let (cw, rh) = (220.0 + 64.0, 104.0 + 40.0);
    let shown = |i: usize| !member_hidden(gi, i);
    // the rows within each column: each where the ones it is wired to are, on average (a few rounds of it), so the
    // wires run as straight as they can and do not share a line
    let ncol = col.iter().copied().max().unwrap_or(0) + 1;
    let mut row = alloc::vec![0.0f64; n];
    let mut order: Vec<Vec<usize>> = (0..ncol).map(|c| (0..n).filter(|i| wired[*i] && shown(*i) && col[*i] == c).collect()).collect();
    for (c, o) in order.iter().enumerate() {
        let _ = c;
        for (r, i) in o.iter().enumerate() {
            row[*i] = r as f64;
        }
    }
    for round in 0..6 {
        for c in 0..ncol {
            let mut keyed: Vec<(f64, usize)> = order[c]
                .iter()
                .map(|&i| {
                    // the next column's ones leading out of it first (left to right), then the ones leading in
                    let nb: Vec<f64> = links.iter().filter_map(|&(a, b)| if a == i && shown(b) { Some(row[b]) } else if b == i && shown(a) && round % 2 == 1 { Some(row[a]) } else { None }).collect();
                    let k = if nb.is_empty() { row[i] } else { nb.iter().sum::<f64>() / nb.len() as f64 };
                    (k, i)
                })
                .collect();
            keyed.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(core::cmp::Ordering::Equal).then(x.1.cmp(&y.1)));
            order[c] = keyed.iter().map(|x| x.1).collect();
            for (r, i) in order[c].iter().enumerate() {
                row[*i] = r as f64;
            }
        }
    }
    // then each level with what feeds it (a gap left where needed), so a wire runs straight wherever it can
    let mut at = alloc::vec![0usize; n];
    for (c, o) in order.iter().enumerate() {
        let mut next = 0usize;
        for &i in o {
            let src: Vec<f64> = links.iter().filter(|l| l.1 == i && shown(l.0) && col[l.0] < c).map(|l| at[l.0] as f64).collect();
            let want = if c == 0 || src.is_empty() { next } else { (src.iter().sum::<f64>() / src.len() as f64 + 0.5) as usize };
            at[i] = want.max(next);
            next = at[i] + 1;
        }
    }
    let mut pos = alloc::vec![(0.0, 0.0); n];
    let mut below = 0usize;
    for o in order.iter() {
        for &i in o {
            pos[i] = (24.0 + col[i] as f64 * cw, 24.0 + at[i] as f64 * rh);
            below = below.max(at[i] + 1);
        }
    }
    let cols = ((host::vw() - 220.0) / cw).clamp(1.0, 4.0) as usize;
    for (k, i) in (0..n).filter(|i| !wired[*i] && shown(*i)).enumerate() {
        pos[i] = (24.0 + (k % cols) as f64 * cw, 24.0 + (below + k / cols) as f64 * rh + if below > 0 { 24.0 } else { 0.0 });
    }
    pos
}

/// Where a group member is opened, found by its name (the map's links follow members as they move between groups).
fn member_href(name: &str) -> String {
    GROUPS
        .iter()
        .enumerate()
        .find_map(|(gi, g)| g.members.iter().position(|m| m.0 == name).map(|m| format!("#/i/{}/{}", gi, m)))
        .unwrap_or_else(|| "#/".to_string())
}

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
    /// the program's nodes, placed
    extra: Vec<(usize, Rect)>,
}

/// Where a super or a program node is, in design units.
fn rect(g: &Geo, id: usize) -> Rect {
    if id < NSUP {
        return g.rects[id];
    }
    g.extra.iter().find(|(i, _)| *i == id).map(|(_, r)| *r).unwrap_or((0.0, 0.0, 0.0, 0.0))
}

fn geo(s: &State) -> Geo {
    let (w, h) = (host::vw(), host::vh());
    let mut g = if s.ctx.is_empty() {
        geo_zoom(s, w, h, w < 700.0, s.zoom)
    } else {
        // a page's canvas zooms and pans with the page (owner, 2026-10-17: "improve zooming out and zooming in"): its
        // drawings stay on what they were drawn over, and the home canvas's view never reaches it
        let mut g = geo_view(s, w, h, w < 700.0, 1.0, (0.0, 0.0));
        let z = s.pzoom.max(1e-6);
        g.ox = s.porg.0 * (1.0 - z) + s.ppan.0 + z * g.ox;
        g.oy = s.porg.1 * (1.0 - z) + s.ppan.1 + z * g.oy;
        g.k *= z;
        g
    };
    // the bar's controls and the sidebar's icons stay where they show, so their wires meet them
    for (i, id) in BAR.iter().enumerate() {
        let (x, y, bw, bh) = bar_slot(i, w, h);
        g.rects[*id] = ((x - g.ox) / g.k, (y - g.oy) / g.k, bw / g.k, bh / g.k);
    }
    if w >= 700.0 {
        for (i, id) in RAIL.iter().enumerate() {
            let (x, y, bw, bh) = rail_slot(i, h);
            g.rects[*id] = ((x - g.ox) / g.k, (y - g.oy) / g.k, bw / g.k, bh / g.k);
        }
    }
    g
}

/// Where the floating bar's i-th button is on screen (x, y, w, h): its CSS, in numbers.
fn bar_slot(i: usize, vw: f64, vh: f64) -> (f64, f64, f64, f64) {
    let (bw, bh) = (44.0, 44.0);
    let narrow = vw < 700.0;
    let gap = if narrow { 10.0 } else { 12.0 };
    let top = if narrow { vh - 80.0 - bh } else { 10.0 };
    // the + for wiring, lock, chain, reset (a click undoes)
    let n = BAR.len() as f64;
    let left = vw / 2.0 - (n * bw + (n - 1.0) * gap) / 2.0 + i as f64 * (bw + gap);
    (left, top, bw, bh)
}

/// The canvas laid out in a box of w × h: the whole page, or the floating π canvas over an open super.
fn geo_box(s: &State, w: f64, h: f64, narrow: bool) -> Geo {
    geo_zoom(s, w, h, narrow, 1.0)
}

/// The canvas at a zoom (the whole page zooms without end, in or out; the floating copy always fits).
fn geo_zoom(s: &State, w: f64, h: f64, narrow: bool, zoom: f64) -> Geo {
    geo_view(s, w, h, narrow, zoom, s.pan)
}

/// The canvas at a zoom and a pan.
fn geo_view(s: &State, w: f64, h: f64, narrow: bool, zoom: f64, view_pan: (f64, f64)) -> Geo {
    let (b, dw, dh) = base(narrow);
    let zoom = if zoom.is_finite() && zoom > 0.0 { zoom } else { 1.0 };
    // on a phone the canvas is drawn at its own size, so what is drawn is as big under a finger as on a screen
    // (owner, 2026-10-14: "make the app mobile friendly")
    let k = if narrow { zoom } else { (w / dw).min(h / dh).max(0.2) * zoom };
    let ox = (w - dw * k) / 2.0;
    let oy = (h - dh * k) / 2.0;
    let mut rects = b;
    for (i, r) in rects.iter_mut().enumerate() {
        let (dx, dy) = s.offs[i];
        let pan = if i >= S_SITE && !matches!(i, S_RUN | S_STEP | S_CLEAR) { view_pan } else { (0.0, 0.0) };
        r.0 += dx + pan.0;
        r.1 += dy + pan.1;
        r.2 += s.sizes[i].0;
        r.3 += s.sizes[i].1;
    }
    let (px, py, _, _) = rects[S_PROG];
    let extra = s.prog.nodes.iter().map(|n| {
        let (w, h) = if n.w > 0.0 { (n.w, n.h) } else { unode_size(&n.text) };
        (n.id, (px + n.x, py + n.y, w, h))
    }).collect();
    Geo { k, ox, oy, w, h, rects, extra }
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
    let (x, y, w, h) = rect(g, id);
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
        S_SAVE => svg_icon(&["M12 5v14", "M5 12h14"], "26", if s.wire_mode { "ci accent" } else { "ci" }),
        S_LOCK => {
            if !lock_target_free(s).unwrap_or(false) {
                // on (every super held in place): gray (owner, 2026-10-14: "when the lock icon is on, it changes color
                // to gray"), drawn in outline like every icon
                svg_icon(&["M7 10V7a5 5 0 0 1 10 0v3", "M4.5 10h15v11h-15z"], "26", "ci gray")
            } else {
                svg_icon(&["M7 10V7a5 5 0 0 1 9.6-2", "M4.5 10h15v11h-15z"], "26", "ci accent")
            }
        }
        S_CHAIN => svg_icon(
            &["M9 12h6", "M8 8H6.5a4 4 0 0 0 0 8H8", "M16 8h1.5a4 4 0 0 1 0 8H16"],
            "28",
            if ctl_wired(s, S_CHAIN) { "ci accent" } else if s.chained { "ci" } else { "ci faint" },
        ),
        S_RESET => svg_icon(&["M4 4v6h6", "M4.6 15a8 8 0 1 0 1.9-8.3L4 10"], "24", "ci"),
        S_LEFT => svg_icon(&["M19 12H5", "M11 6l-6 6 6 6"], "26", "ci"),
        S_UP => svg_icon(&["M12 19V5", "M6 11l6-6 6 6"], "26", "ci"),
        S_DOWN => svg_icon(&["M12 5v14", "M6 13l6 6 6-6"], "26", "ci"),
        S_RIGHT => svg_icon(&["M5 12h14", "M13 6l6 6-6 6"], "26", "ci"),
        // line icons in ink, as every icon (owner, 2026-10-14: "all of these icons should look the same and uniform")
        S_RUN => svg_icon(&["M7.5 5v14l11-7z"], "24", "ci"),
        S_STEP => svg_icon(&["M6 5l9 7-9 7z", "M18 5v14"], "24", "ci"),
        S_CLEAR => svg_icon(&["M6 6h12v12H6z"], "22", "ci"),
        _ => txt(""),
    }
}

fn sup_label(id: usize) -> &'static str {
    match id {
        S_TITLE => "piii lab",
        S_PROG => "Program",
        S_PALETTE => "Palette",
        S_EXAMPLES => "Examples",
        S_RUN => "Run the program",
        S_STEP => "One step",
        S_CLEAR => "Stop: clear the values",
        S_SAVE => "Wire: click to turn wiring on or off",
        S_LOCK => "Lock: every canvas stays where it is, at its size; select one, then click here to unlock it (or lock it again)",
        S_CHAIN => "Chain: a holder brings what it holds",
        S_RESET => "Click: undo. Hold: reset and clear this canvas",
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
        S_INSIGHT => "Insights",
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
    let _ = small;
    v.push(el("span").cls("tag").text(g.title).into());
    let mut bars = el("span").cls("bars-tree");
    for (m, (name, _)) in g.members.iter().enumerate() {
        // a bar has no words on it, so it is not a button (owner, 2026-10-14: "I should not be able to click an object
        // if I can't read it"); the click goes to the super, whose window lists each member by name
        let _ = (m, name);
        bars = bars.kid(el("span").cls("bar-i").attr("aria-hidden", "true"));
    }
    v.push(bars.into());
    v
}

fn tools_inside() -> Vec<N> {
    let g = &GROUPS[0];
    let mut bars = el("span").cls("t-bars");
    for (m, (name, _)) in g.members.iter().enumerate() {
        let _ = (m, name);
        bars = bars.kid(el("span").cls("t-bar").attr("aria-hidden", "true"));
    }
    let mut v: Vec<N> = Vec::new();
    v.push(el("span").cls("t-in").text("Tools").into());
    v.push(el("span").cls("t-brace").into());
    v.push(bars.into());
    v
}

fn canvas_view(s: &State) -> N {
    scene_view(s, false)
}

/// The super an open page belongs to, lit on the floating canvas.
fn lit(s: &State) -> usize {
    match s.page {
        Page::Group(g) | Page::Item(g, _) => GROUPS.get(g as usize).map(|x| x.sup).unwrap_or(99),
        Page::Map => S_PROJECT,
        Page::Assess => S_TOOLS,
        Page::Explore | Page::Live | Page::Paper => S_EXPLORE,
        Page::Library => S_LIBRARY,
        Page::Account | Page::Confirm => S_CONNECT,
        Page::Home => 99,
    }
}

/// The π canvas floating on top of an open super (owner, 2026-10-14: "pi canvas is always floating on top"):
/// the same supers and wires, small, the open one lit; a click opens another, π goes back to the whole canvas.
fn float_size() -> (f64, f64) {
    let (vw, vh) = (host::vw(), host::vh());
    if vw < 700.0 {
        let w = vw - 24.0;
        (w, (w * 0.5).min(vh * if st().float_big { 0.55 } else { 0.3 }))
    } else {
        let w = if st().float_big { (vw * 0.5).clamp(420.0, 960.0).min(vw - 120.0) } else { (vw * 0.26).clamp(260.0, 420.0) };
        (w, (w * 0.625).min(vh - 60.0))
    }
}

fn scene_view(s: &State, mini: bool) -> N {
    let g = if mini {
        let (w, h) = float_size();
        geo_box(s, w, h, false)
    } else {
        geo(s)
    };
    // wires, drawn under the supers; their ports over them
    // one size for everything on a wire, from the zoom: the strokes are in screen pixels, the rest in canvas units
    let ws = wire_scale(g.k);
    let du = ws / g.k.max(0.05);
    let mut wires = el("svg:svg").cls("wires").attr("aria-hidden", "true").attr("width", "1").attr("height", "1")
        .style(format!("--wz:{:.3}", ws))
        .kid(
            el("svg:defs")
                .kid(arrowhead("ah-flow", "flow", 10.0 * du))
                .kid(arrowhead("ah-ink", "ink", 10.0 * du)),
        );
    let nw = s.wires.len();
    for (i, (a, b, tip)) in s.wires.iter().enumerate() {
        let (a, b, tip) = (*a, *b, *tip);
        let (px, py) = leave_point(&g, a, tip);
        let (qx, qy) = tip_point(&g, b, tip);
        // spokes: the home canvas's Super AI reaches each place in a straight line, centre to centre, from edge to edge
        let hub = s.ctx.is_empty() && unode(s, a).map(|n| world_of(&n.text) == Some(WORLD_HUB)).unwrap_or(false);
        let spoke = if hub && tip == Tip::In {
            let (ax, ay, aw, ah) = rect(&g, a);
            let (bx, by, bw, bh) = rect(&g, b);
            let (c1, c2) = ((ax + aw / 2.0, ay + ah / 2.0), (bx + bw / 2.0, by + bh / 2.0));
            let (dx, dy) = (c2.0 - c1.0, c2.1 - c1.1);
            // where the line leaves the outline |x/a|^π + |y/b|^π = 1
            let n = core::f64::consts::PI;
            let edge = |w: f64, h: f64| -> f64 {
                let (u, v) = ((dx / (w / 2.0)).abs(), (dy / (h / 2.0)).abs());
                let p = |x: f64| if x <= 0.0 { 0.0 } else { powf(x, n) };
                let sum = p(u) + p(v);
                if sum <= 0.0 { 0.0 } else { 1.0 / powf(sum, 1.0 / n) }
            };
            let (t1, t2) = (edge(aw, ah), 1.0 - edge(bw, bh));
            Some(format!("M{:.1},{:.1} L{:.1},{:.1}", c1.0 + dx * t1, c1.1 + dy * t1, c1.0 + dx * t2, c1.1 + dy * t2))
        } else {
            None
        };
        let d = match tip {
            _ if spoke.is_some() => spoke.clone().unwrap_or_default(),
            // a wire going back (a loop through a register): out, down below both supers, across, and up into the
            // in, never through them (owner, 2026-10-17: the counter's wiring crossed its own supers)
            Tip::In | Tip::Out if qx < px + 4.0 => {
                let e = 24.0 * du;
                // clear of every super in the way: above them all or below them all, whichever is nearer
                let (x0, x1) = (qx - e, px + e);
                let (ra, rb) = (rect(&g, a), rect(&g, b));
                let mut top = ra.1.min(rb.1);
                let mut bottom = (ra.1 + ra.3).max(rb.1 + rb.3);
                for n in s.prog.nodes.iter() {
                    let r = rect(&g, n.id);
                    if r.0 < x1 && r.0 + r.2 > x0 && r.1 < bottom + 200.0 && r.1 + r.3 > top - 200.0 {
                        top = top.min(r.1);
                        bottom = bottom.max(r.1 + r.3);
                    }
                }
                let (up, down) = (top - 26.0 * du, bottom + 26.0 * du);
                let lane = if (py - up).abs() <= (down - py).abs() { up } else { down };
                format!("M{:.1},{:.1} H{:.1} V{:.1} H{:.1} V{:.1} H{:.1}", px, py, px + e, lane, qx - e, qy, qx)
            }
            // forward: its upright part where no super stands (the middle, else nearer either end)
            Tip::In | Tip::Out if (qy - py).abs() > 0.5 => {
                let clear = |x: f64| {
                    let (y0, y1) = (py.min(qy), py.max(qy));
                    !s.prog.nodes.iter().any(|n| {
                        if n.id == a || n.id == b {
                            return false;
                        }
                        let r = rect(&g, n.id);
                        x > r.0 - 6.0 * du && x < r.0 + r.2 + 6.0 * du && y1 > r.1 && y0 < r.1 + r.3
                    })
                };
                let mid = (px + qx) / 2.0;
                let picks = [mid, px + 0.25 * (qx - px), px + 0.75 * (qx - px), px + 14.0 * du, qx - 14.0 * du];
                let x = picks.iter().copied().find(|x| clear(*x)).unwrap_or(mid);
                format!("M{:.1},{:.1} H{:.1} V{:.1} H{:.1}", px, py, x, qy, qx)
            }
            Tip::In | Tip::Out => elbow(px, py, qx, qy, 24.0 * du),
            _ => {
                // top-to-bottom wires curve (owner, 2026-10-14): leave the way the tip faces, arrive straight down
                // into a control or straight up into a gate
                let k = ((qy - py).abs() / 2.0).max(40.0 * du);
                let (c1x, c1y) = (px + k, py);
                let c2y = if tip == Tip::Control { qy - k } else { qy + k };
                format!("M{:.1},{:.1} C{:.1},{:.1} {:.1},{:.1} {:.1},{:.1}", px, py, c1x, c1y, qx, c2y, qx, qy)
            }
        };
        wires = draw_link(wires, mini, s.wire_sel == Some(i), i, &d, tip);
        // the logic, shown (owner, 2026-10-17: "show wiring by adding logic to pi programming language"): after a run
        // each wire is coloured by what it carries (a number, true or false, words, a list) and says it at its middle
        if let (false, Some(v)) = (mini, s.prog.vals.get(&a).filter(|v| !v.is_null())) {
            let (ty, mut t) = (value_type(v), vtext(v));
            if t.chars().count() > 14 {
                t = t.chars().take(13).collect::<String>() + "…";
            }
            // just after the out it leaves, starting there (so it never runs back over the super it leaves)
            let (mx, my) = (px + 8.0 * du, py - 6.0 * du);
            wires = wires.kid(
                el("svg:text")
                    .cls("w-val")
                    .cls(ty)
                    .attr("x", format!("{:.1}", mx))
                    .attr("y", format!("{:.1}", my))
                    .attr("text-anchor", "start")
                    .attr("font-size", format!("{:.2}", 12.0 * du))
                    .attr("stroke-width", format!("{:.2}", 4.0 * du))
                    .text(t),
            );
        }
    }
    for (j, (a, ta, b, tb)) in s.passes.iter().enumerate() {
        let (a, ta, b, tb) = (*a, *ta, *b, *tb);
        let ((px, py), (qx, qy)) = (tip_point(&g, a, ta), tip_point(&g, b, tb));
        // out of its tip (up from a control, down from a gate), round by a lane left of both, and into the other tip
        // from outside, clear of everything between
        let away = |t: Tip| if t == Tip::Control { -40.0 * du } else { 40.0 * du };
        // curved too (owner, 2026-10-14): one sweep, leaving and arriving the way each tip faces
        let k = (((qy - py).abs() + (qx - px).abs()) / 80.0).max(1.5);
        let d = format!(
            "M{:.1},{:.1} C{:.1},{:.1} {:.1},{:.1} {:.1},{:.1}",
            px,
            py,
            px,
            py + away(ta) * k,
            qx,
            qy + away(tb) * k,
            qx,
            qy
        );
        wires = draw_link(wires, mini, s.wire_sel == Some(nw + j), nw + j, &d, tb);
    }
    if let (false, Some(w)) = (mini, s.wiring.as_ref()) {
        let From::Bar(gi, _) = w.from;
        let pa = port(&g, GROUPS[gi].sup, Side::R);
        let d = match w.to {
            Some((id, side)) => curve(pa, Side::R, port(&g, id, side), side),
            None => curve(pa, Side::R, w.at, Side::L),
        };
        wires = wires.kid(el("svg:path").cls("w-temp").attr("d", d));
    }
    if let (false, Some((a, ta))) = (mini, s.held_port) {
        let (x1, y1) = if ta == Tip::Out { leave_point(&g, a, Tip::In) } else { tip_point(&g, a, ta) };
        // the end jumps to the tip it would join, which lights up: what you see is what letting go makes
        let snap = nearest_tip(s, s.pend_at.0 * g.k + g.ox, s.pend_at.1 * g.k + g.oy);
        let (x2, y2) = match snap {
            Some((id, t)) => if t == Tip::Out { leave_point(&g, id, if is_ctl_super(id) { Tip::Control } else { Tip::In }) } else { tip_point(&g, id, t) },
            None => s.pend_at,
        };
        // an out curves away to the right, an in to the left, a control up and a gate down
        let away = |t: Tip| -> (f64, f64) {
            match t {
                Tip::Out => (1.0, 0.0),
                Tip::In => (-1.0, 0.0),
                Tip::Control => (0.0, -1.0),
                Tip::Gate => (0.0, 1.0),
            }
        };
        let k = (((x2 - x1).abs() + (y2 - y1).abs()) * 0.4).max(30.0 * du);
        let (ax, ay) = away(ta);
        let (bx, by) = match snap { Some((_, t)) => away(t), None => (-ax, -ay) };
        let e = 24.0 * du;
        let d = match ta {
            Tip::Out => elbow(x1, y1, x2, y2, e),
            Tip::In => elbow(x2, y2, x1, y1, e),
            _ => format!("M{:.1},{:.1} C{:.1},{:.1} {:.1},{:.1} {:.1},{:.1}", x1, y1, x1 + ax * k, y1 + ay * k, x2 + bx * k, y2 + by * k, x2, y2),
        };
        wires = wires.kid(el("svg:path").cls("w-temp").cls_if(snap.is_some(), "snapped").attr("d", d));
    }
    let ports_svg = ports_view(s, &g, mini);

    let mut stage = el("div")
        .cls("stage")
        // its scale as --k too: a sparkle's line (drawn in screen px) is as thick as a super's border, which scales
        // with the stage (owner, 2026-10-14: "thickness of the lines should be same")
        // and --wz: every line (a wire, a super's outline, a sparkle, a box's border) is one thickness on screen,
        // growing gently with the zoom (owner, 2026-10-17: "uniform everything")
        .style(format!("transform:translate({:.1}px,{:.1}px) scale({:.4});--k:{:.4};--wz:{:.3}", g.ox, g.oy, g.k, g.k, wire_scale(g.k)))
        .kid(wires);
    for id in 0..NSUP {
        if id == S_SITE || is_gone(id) {
            continue;
        }
        let (x, y, w, h) = g.rects[id];
        let mut sx = el("div")
            .cls("sx")
            .cls_if(mini && id == lit(s), "lit")
            .cls_if(!mini && s.wiring.as_ref().and_then(|w| w.to).map(|(t, _)| t == id).unwrap_or(false), "wire-target")
            .cls_if(!mini && id >= S_WELCOME && s.sup_locked.contains(&id) && !(icon_kind(id) && icon_area(w * g.k, h * g.k)), "locked")
            .cls_if(!mini && s.sup_pick == Some(id), "picked")
            .cls_if(!mini && id == S_RESET && s.reset_hold.is_some(), "holding")
            .cls_if(!mini && (on_bar(id) || rail_pin(id).is_some()), "under-bar")
            .attr("data-s", format!("{}", id))
            .attr_if(id != S_PROG && id != S_HOLD, "data-solid", "1")
            .style(format!("left:{:.1}px;top:{:.1}px;width:{:.1}px;height:{:.1}px", x, y, w, h));
        // only what can be read is clickable: not the small canvas floating on an open super (too small to read; the
        // rail and π get about), and not the holder, which has no words
        if !mini && id != S_HOLD {
            sx = sx.on("pdown", Msg::PDown(id, String::new()));
        }
        let label = sup_label(id);
        if !label.is_empty() && id != S_HOLD && !mini {
            sx = sx.attr("tabindex", "0").attr("role", "button").attr("aria-label", label).on("enter", Msg::Activate(id as u8));
        }
        let icon = icon_kind(id) && icon_area(w * g.k, h * g.k);
        sx = match id {
            _ if icon => sx.cls("icon").attr("title", label).kid(icon_view(id)),
            S_TITLE => sx.cls("title").text("piii lab"),
            S_SAVE | S_LOCK | S_CHAIN | S_RESET | S_LEFT | S_UP | S_DOWN | S_RIGHT | S_RUN | S_STEP | S_CLEAR => sx.cls("ctl").attr("title", label).kid(control_icon(id, s)).kid(ports()),
            S_PROG => sx.cls("prog").kids(prog_region_view(s)),
            S_PALETTE => sx.cls("palette").kids(palette_view()),
            S_EXAMPLES => sx.cls("examples").kids(examples_view()),
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
    // the program's nodes, over its super: the bigger first, so what is drawn inside a canvas super lies on it
    let mut order: Vec<&UNode> = s.prog.nodes.iter().collect();
    let area = |n: &UNode| { let r = rect(&g, n.id); r.2 * r.3 };
    order.sort_by(|a, b| area(b).partial_cmp(&area(a)).unwrap_or(core::cmp::Ordering::Equal));
    // the same thing, close together on screen, is one thing (owner, 2026-10-17: "icons merge to icons, words merge to
    // words, same icons into same icons, same words into same words"): zoomed out, copies of a super glide into the
    // first of them, which counts them; zoomed in, they come apart again
    let merged = merges(s, &g);
    for n in order {
        let r = rect(&g, n.id);
        let (into, count) = merged.get(&n.id).copied().unwrap_or((None, 1));
        let wrap = el("div").cls("u-wrap").cls_if(into.is_some(), "merged");
        let wrap = match into {
            Some((dx, dy)) => wrap.style(format!("transform:translate({:.1}px,{:.1}px)", dx, dy)),
            None => wrap,
        };
        stage = stage.kid(
            wrap.kid(unode_view(s, n, r, mini, g.k))
                .kid_if(count > 1 && !mini, || {
                    el("span")
                        .cls("u-count")
                        .style(format!("left:{:.1}px;top:{:.1}px;font-size:{:.2}px", r.0 + r.2, r.1, 12.0 / g.k.max(1e-6)))
                        .text(format!("×{}", count))
                        .into()
                }),
        );
    }
    // the selected super's group, outlined
    if !mini {
        if let Some(sel) = s.prog.sel {
            let members = group_with(s, sel);
            if !members.is_empty() {
                let (mut l, mut t, mut r, mut b) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
                for id in members.iter().chain(core::iter::once(&sel)) {
                    let (x, y, w, h) = rect(&g, *id);
                    l = l.min(x);
                    t = t.min(y);
                    r = r.max(x + w);
                    b = b.max(y + h);
                }
                let pad = 10.0 / g.k.max(0.05);
                stage = stage.kid(el("div").cls("group-box").style(format!("left:{:.1}px;top:{:.1}px;width:{:.1}px;height:{:.1}px", l - pad, t - pad, r - l + 2.0 * pad, b - t + 2.0 * pad)));
            }
        }
    }
    stage = stage.kid(ports_svg);
    if mini {
        let (w, h) = float_size();
        let at = match s.float_at {
            Some((l, t)) => format!("left:{:.0}px;top:{:.0}px;right:auto;bottom:auto;", l, t),
            None => String::new(),
        };
        // locked by default like every canvas: it moves and changes size only while the lock is off (owner, 2026-10-14:
        // "the second main canvas is locked by default and can't be resized or dragged unless the lock button is off")
        let free = s.float_free;
        return el("aside")
            .cls("scene floating")
            .cls_if(!free, "locked")
            .cls_if(s.float_pick, "picked")
            .cls_if(s.float_drag.as_ref().map(|d| d.moved).unwrap_or(false), "moving")
            .attr("aria-label", if free { "The canvas: drag it anywhere, click to change its size" } else { "The canvas, locked in place" })
            .attr("title", if free { "Drag to move, click to change its size" } else { "Locked: click it, then the lock, to unlock it" })
            .style(format!("{}width:{:.0}px;height:{:.0}px", at, w, h))
            .on("pdown", Msg::FloatDown(String::new()))
            .kid(el("div").cls("frame"))
            // no π badge on it (owner, 2026-10-14: "delete this logo"); π in the rail goes back to the canvas
            .kid(stage)
            .into();
    }
    // Two layers (owner, 2026-10-17: "everywhere is a canvas"): the bare canvas underneath, which takes the double
    // clicks, the pans and the right-button box; and what is drawn, on top of everything (the sidebar and the bar
    // too), where only the supers, sparkles, wires and tips take the pointer, so whatever is under them stays usable
    let picked = s.sup_pick.is_none() && s.prog.sel.is_none();
    let wiring = s.wiring.is_some() || s.held_port.is_some();
    let over = !s.ctx.is_empty();
    let bare = el("div")
        .cls("scene")
        // a page's own canvas: the page itself is its bare canvas (its double clicks come from the window)
        .cls_if(over, "over")
        // the main canvas is selected whenever nothing on it is: its frame is blue then
        .cls_if(picked, "picked")
        .cls_if(wiring, "wiring")
        .cls_if(s.pan_drag.is_some(), "panning")
        .attr("title", "Double click: a sparkle. Double right click: a super.")
        .on("click", Msg::WireSel(255))
        .on("dbl", Msg::Dbl(false, String::new()))
        .on("dbl2", Msg::Dbl(true, String::new()))
        .on("mwheel", Msg::TV(Tool::Grid, 50))
        .on("bgdown", Msg::TV(Tool::Grid, 52))
        .on("rsel", Msg::TV(Tool::Grid, 90))
        .kid(el("div").cls("frame"));
    let drawn = el("div")
        .cls("scene scene-top")
        .cls_if(over, "over")
        .cls_if(wiring, "wiring")
        .cls_if(s.pan_drag.is_some(), "panning")
        .kid(stage)
        .kid_if(s.marquee.is_some(), || {
            let (x0, y0, x1, y1) = s.marquee.unwrap_or_default();
            el("div").cls("marquee").style(format!("left:{:.0}px;top:{:.0}px;width:{:.0}px;height:{:.0}px", x0.min(x1), y0.min(y1), (x1 - x0).abs(), (y1 - y0).abs())).into()
        })
        .kid_if(!s.note.is_empty(), || el("div").cls("wire-note").attr("role", "status").text(s.note.clone()).into());
    // no footer line on the canvas (owner, 2026-10-14: "delete this")
    el("div").cls("scene-pair").kid(bare).kid(drawn).into()
}

/// Where a node's tip is: the page's edges at the page's sides, a super's at its extreme points.
fn tip_point(g: &Geo, id: usize, tip: Tip) -> (f64, f64) {
    match id {
        PAGE_IN => port(g, FRAME, Side::L),
        PAGE_OUT => port(g, FRAME, Side::R),
        _ => port(g, id, tip.side()),
    }
}

/// Where a wire into `into` leaves its node: a control's bottom into a control tip (it hangs from above); else the
/// node's out.
fn leave_point(g: &Geo, id: usize, into: Tip) -> (f64, f64) {
    // every super has a gate at its bottom now, so a control leaves by its out, on the right, like the rest
    let _ = into;
    tip_point(g, id, Tip::Out)
}

/// Tells how to resize a locked super, and makes the lock blink once.
fn lock_hint(_id: usize) {
    note("Locked: click the lock up top to resize it".to_string());
    st().lock_blink = host::now();
}

/// The angled route of an in/out wire, from an out at (px, py) to an in at (qx, qy) (owner, 2026-10-14: "left to right
/// wiring is angled"): across, then up or down, then across into the in; a wire going back steps out by `e`, runs
/// between the two, and comes back in from the left.
fn elbow(px: f64, py: f64, qx: f64, qy: f64, e: f64) -> String {
    if qx >= px + 4.0 {
        let mid = (px + qx) / 2.0;
        if (qy - py).abs() < 0.5 {
            format!("M{:.1},{:.1} H{:.1}", px, py, qx)
        } else {
            format!("M{:.1},{:.1} H{:.1} V{:.1} H{:.1}", px, py, mid, qy, qx)
        }
    } else {
        let my = (py + qy) / 2.0;
        format!("M{:.1},{:.1} H{:.1} V{:.1} H{:.1} V{:.1} H{:.1}", px, py, px + e, my, qx - e, qy, qx)
    }
}

/// How big wires, arrowheads and tips look on screen at a zoom: they grow and shrink with the canvas, but gently, so a
/// wire never turns into a hair when zoomed out or a band when zoomed in (owner, 2026-10-14: "improve the scaling of
/// the wirings").
fn wire_scale(z: f64) -> f64 {
    let z = if z.is_finite() && z > 0.0 { z } else { 1.0 };
    // the square root of the zoom: twice as big a canvas, wires about 1.4 times as thick
    z.sqrt_c().clamp(0.75, 1.4)
}

/// An arrowhead `size` user units across.
fn arrowhead(id: &'static str, cls: &'static str, size: f64) -> N {
    let size = format!("{:.2}", size);
    el("svg:marker")
        .attr("id", id)
        .attr("viewBox", "0 0 10 10")
        .attr("refX", "10")
        .attr("refY", "5")
        .attr("markerUnits", "userSpaceOnUse")
        .attr("markerWidth", size.clone())
        .attr("markerHeight", size)
        .attr("orient", "auto")
        .kid(el("svg:path").cls(format!("head {}", cls).as_str()).attr("d", "M0,0L10,5L0,10Z"))
        .into()
}

/// A wire or pass on the canvas: its kind by where it arrives (flow into in, control, gate), an arrowhead, and on
/// the whole canvas a wider unseen line over it to take the click.
/// What kind of value a wire carries, as a class: LabVIEW's habit of colouring wires by type.
fn value_type(v: &Value) -> &'static str {
    match v {
        Value::Num(_) => "t-num",
        Value::Bool(_) => "t-bool",
        Value::Str(_) => "t-text",
        Value::Arr(_) | Value::Obj(_) => "t-list",
        Value::Null => "t-none",
    }
}

fn draw_link(mut wires: crate::dom::El<Msg>, mini: bool, sel: bool, i: usize, d: &str, arrives: Tip) -> crate::dom::El<Msg> {
    // the value on it, if the program has run: its colour
    let ty = st().wires.get(i).and_then(|w| st().prog.vals.get(&w.0)).filter(|v| !v.is_null()).map(value_type);
    let kind = match arrives {
        Tip::In | Tip::Out => "flow",
        Tip::Control => "control",
        Tip::Gate => "gate",
    };
    wires = wires.kid(
        el("svg:path")
            .cls("w")
            .cls(kind)
            .cls_if(sel, "sel")
            .cls_if(ty.is_some(), ty.unwrap_or(""))
            .attr("d", d)
            .attr("marker-end", if kind == "flow" { "url(#ah-flow)" } else { "url(#ah-ink)" }),
    );
    if !mini {
        wires = wires.kid(
            el("svg:path")
                .cls("w-hit")
                .attr("data-stop", "1")
                .attr("d", d)
                .attr("data-solid", "1")
                .on("click", Msg::WireSel(i as u8))
                .on("dblclick", Msg::WireDel(i as u8)),
        );
    }
    wires
}

/// A small sparkle (n = ½) of radius r: a port's mark.
fn sparkle(cx: f64, cy: f64, r: f64) -> String {
    let mut d = String::new();
    for i in 0..48 {
        let t = i as f64 / 48.0 * core::f64::consts::TAU;
        let (c, sn) = (libm_cos(t), libm_cos(t - core::f64::consts::FRAC_PI_2));
        // |x/r|^½ + |y/r|^½ = 1: x = r·sign(c)·c⁴
        let x = cx + r * c.signum() * (c * c) * (c * c);
        let y = cy + r * sn.signum() * (sn * sn) * (sn * sn);
        d.push_str(&format!("{}{:.2},{:.2}", if i == 0 { "M" } else { "L" }, x, y));
    }
    d.push('Z');
    d
}

/// cos without the standard library: a short series after folding into [-π, π].
fn libm_cos(x: f64) -> f64 {
    let tau = core::f64::consts::TAU;
    let mut x = x % tau;
    if x > core::f64::consts::PI {
        x -= tau;
    } else if x < -core::f64::consts::PI {
        x += tau;
    }
    let x2 = x * x;
    let (mut term, mut sum, mut k) = (1.0, 1.0, 0.0);
    while k < 20.0 {
        term *= -x2 / ((k + 1.0) * (k + 2.0));
        sum += term;
        k += 2.0;
    }
    sum
}

/// The ports to wire with, over everything: each node's out (filled), its tips (drawn round); while a wire is being
/// made, the tips it may join are marked.
fn ports_view(s: &State, g: &Geo, mini: bool) -> N {
    // the connectors: small sparkles (owner, 2026-10-14: "make the center sparkle bigger and connector sparkles smaller")
    let ws = wire_scale(g.k);
    let r = if mini { 4.0 / g.k } else { (if g.w < 700.0 { 8.5 } else { 6.5 }) * ws / g.k.max(0.05) };
    // the place to press stays easy to hit however far out the canvas is zoomed
    let pad = (r * 2.4).max(15.0 / g.k.max(0.05));
    let mut svg = el("svg:svg").cls("ports-svg").attr("width", "1").attr("height", "1").attr("aria-hidden", if mini { "true" } else { "false" });
    let snap = if !mini && s.held_port.is_some() { nearest_tip(s, s.pend_at.0 * g.k + g.ox, s.pend_at.1 * g.k + g.oy) } else { None };
    let mut nodes: Vec<usize> = (0..NSUP).filter(|i| *i != S_PALETTE && *i != S_EXAMPLES && !is_gone(*i)).collect();
    nodes.push(PAGE_IN);
    nodes.push(PAGE_OUT);
    nodes.extend(s.prog.nodes.iter().map(|n| n.id));
    for id in nodes {
        for &tip in tips_of(id) {
            let (x, y) = if tip == Tip::Out { leave_point(g, id, if is_ctl_super(id) { Tip::Control } else { Tip::In }) } else { tip_point(g, id, tip) };
            let on = s.held_port == Some((id, tip));
            let target = !mini
                && match s.held_port {
                    Some((a, ta)) => can_join(s, a, ta, id, tip),
                    None => false,
                };
            // a tip with nothing on it stays out of sight until the pointer comes near or a wire is being made
            // (owner, 2026-10-14: "make this canvas look less cluttery")
            let wired = s.wires.iter().any(|w| (w.0 == id && tip == Tip::Out) || (w.1 == id && w.2 == tip))
                || s.passes.iter().any(|p| (p.0 == id && p.1 == tip) || (p.2 == id && p.3 == tip));
            let mut gp = el("svg:g")
                .cls_if(wired || mini, "wired")
                .attr("data-p", format!("{}-{}", id, tip.name()))
                .attr("data-solid", "1")
                .cls("port")
                .cls(if tip == Tip::Out { "out" } else { "tip" })
                .cls_if(on, "on")
                .cls_if(target, "target")
                .cls_if(snap == Some((id, tip)), "snap")
                .kid(el("svg:path").cls("mark").attr("d", sparkle(x, y, r)));
            if !mini {
                // its name beside it, shown while wiring is on and the pointer is over its super (owner, 2026-10-14:
                // "when hovering on a sparkle or super, show the labels of in, out, control and gate")
                gp = gp.kid(tip_label(x, y, r * 1.7, 11.0 * ws / g.k.max(0.05), tip));
            }
            if !mini {
                gp = gp
                    .attr("data-stop", "1")
                    .on("click", Msg::Port(id, tip.code()))
                    .on("pdown", Msg::PortDown(id, tip.code(), String::new()))
                    // a big target: easy to hit (owner, 2026-10-14: "improve the wiring experience")
                    .kid(el("svg:circle").cls("pad").attr("cx", format!("{:.1}", x)).attr("cy", format!("{:.1}", y)).attr("r", format!("{:.1}", pad)))
                    .kid(el("svg:title").text(format!("{}: {}", name_of(id), match tip {
                        Tip::Out => "out. Click, then click a tip",
                        Tip::In => "in",
                        Tip::Control => "control. Click, then another super's control or gate to pass it on",
                        Tip::Gate => "gate. Click, then another super's control or gate to pass it on",
                    })));
            }
            svg = svg.kid(gp);
        }
    }
    svg.into()
}

/// A tip's name, just outside it: in to the left, out to the right, control above, gate below.
fn tip_label(x: f64, y: f64, off: f64, fs: f64, tip: Tip) -> N {
    let (lx, ly, anchor) = match tip {
        Tip::In => (x - off, y, "end"),
        Tip::Out => (x + off, y, "start"),
        Tip::Control => (x, y - off, "middle"),
        Tip::Gate => (x, y + off, "middle"),
    };
    el("svg:text")
        .cls("tip-lab")
        .attr("x", format!("{:.1}", lx))
        .attr("y", format!("{:.1}", ly))
        .attr("font-size", format!("{:.2}", fs))
        .attr("text-anchor", anchor)
        .attr("dominant-baseline", "central")
        .text(tip.name())
        .into()
}

/// How near (px) a wire let go of must be to a tip to join it.
const SNAP: f64 = 36.0;

/// A press on a tip: with nothing held, the wire starts here and follows the pointer; let go on (or near) another tip
/// and they are wired. With a wire held, the press finishes it. A press without a drag leaves the wire held, so two
/// clicks still wire too.
fn port_press(id: usize, tip: Tip, xy: &str) {
    let s = st();
    s.port_press = host::now();
    let mut it = xy.split(',');
    let x: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let y: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let was_held = s.held_port.is_some();
    port_click(id, tip);
    if !was_held && st().held_port.is_some() {
        st().port_drag = Some((x, y));
    }
    render();
}

/// The tip nearest (x, y) on screen that the held wire may join, within SNAP.
fn nearest_tip(s: &State, x: f64, y: f64) -> Option<(usize, Tip)> {
    let (a, ta) = s.held_port?;
    let g = geo(s);
    let mut nodes: Vec<usize> = (0..NSUP).filter(|i| *i != S_PALETTE && *i != S_EXAMPLES && !is_gone(*i)).collect();
    nodes.push(PAGE_IN);
    nodes.push(PAGE_OUT);
    nodes.extend(s.prog.nodes.iter().map(|n| n.id));
    let mut best: Option<(f64, usize, Tip)> = None;
    for id in nodes {
        for &tip in tips_of(id) {
            if (id, tip) == (a, ta) {
                continue;
            }
            let ok = can_join(s, a, ta, id, tip);
            if !ok {
                continue;
            }
            let (px, py) = if tip == Tip::Out { leave_point(&g, id, if is_ctl_super(id) { Tip::Control } else { Tip::In }) } else { tip_point(&g, id, tip) };
            let (dx, dy) = (px * g.k + g.ox - x, py * g.k + g.oy - y);
            let d = (dx * dx + dy * dy).sqrt_c();
            if d <= SNAP && best.map(|b| d < b.0).unwrap_or(true) {
                best = Some((d, id, tip));
            }
        }
    }
    best.map(|b| (b.1, b.2))
}

/// A click on a port: the first one held, the second one wired to it (or the reason it can not be).
fn port_click(id: usize, tip: Tip) {
    let s = st();
    let Some((a, ta)) = s.held_port else {
        match tip {
            _ => {
                s.wire_sel = None;
                s.held_port = Some((id, tip));
                let g = geo(s);
                s.pend_at = tip_point(&g, id, tip);
                host::capture(true);
            }
        }
        return;
    };
    s.held_port = None;
    host::capture(false);
    if (a, ta) == (id, tip) {
        return;
    }
    if !can_join(s, a, ta, id, tip) {
        return;
    }
    if ta == Tip::Out && tip == Tip::In {
        match can_connect(s, a, id, tip) {
            Err(e) => note(format!("Not wired: {}", e)),
            Ok(()) => {
                s.wires.push((a, id, tip));
                wires_save();
                let msg = match a {
                    S_RESET => {
                        if id < NSUP {
                            s.offs[id] = (0.0, 0.0);
                            for h in held_by(id) {
                                s.offs[*h] = (0.0, 0.0);
                            }
                            layout_save();
                        }
                        format!("Back where it started: {}", name_of(id))
                    }
                    S_LOCK => format!("{} stays locked until it is selected and the lock is clicked", name_of(id)),
                    S_CHAIN => format!("Chained: {} brings what it holds", name_of(id)),
                    _ => format!("Wired {}'s out to {}'s {}", name_of(a), name_of(id), tip.name()),
                };
                note(msg);
            }
        }
    } else if ta == Tip::In && tip == Tip::Out {
        // started at an in, ended at an out: the same wire, drawn the other way
        match can_connect(s, id, a, Tip::In) {
            Err(e) => note(format!("Not wired: {}", e)),
            Ok(()) => {
                s.wires.push((id, a, Tip::In));
                wires_save();
                note(format!("Wired {}'s out to {}'s in", name_of(id), name_of(a)));
            }
        }
    } else if !(ta == Tip::Out && tip != Tip::Out) {
        match can_relay(s, a, ta, id, tip) {
            Err(e) => note(format!("Not passed on: {}", e)),
            Ok(()) => {
                s.passes.push((a, ta, id, tip));
                wires_save();
                note(format!("What arrives at {}'s {} passes on to {}'s {}", name_of(a), ta.name(), name_of(id), tip.name()));
            }
        }
    }
}

/// Takes away a wire (or a pass: they are numbered after the wires).
fn remove_link(i: usize) {
    let s = st();
    let nw = s.wires.len();
    if i < nw {
        s.wires.remove(i);
    } else if i - nw < s.passes.len() {
        s.passes.remove(i - nw);
    } else {
        return;
    }
    s.wire_sel = None;
    wires_save();
    note("Wire taken away".to_string());
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
    /// how it was pressed (owner, 2026-10-14: "Shift plus click drags or middle mouse resizes supers"):
    /// 0 a click, 1 shift + click, 2 the middle button (resizes it); either moves or resizes only once the lock frees it
    how: u8,
    size0: (f64, f64),
    /// unlocked (or an icon) when it was pressed: a resize that grows an icon into a canvas carries on to the end
    free: bool,
}

/// Where a super has been moved to (its offset), or where a program node is in its super.
fn pos_of(s: &State, id: usize) -> (f64, f64) {
    if id < NSUP {
        return s.offs[id];
    }
    unode(s, id).map(|n| (n.x, n.y)).unwrap_or((0.0, 0.0))
}

fn set_pos(s: &mut State, id: usize, p: (f64, f64)) {
    if id < NSUP {
        s.offs[id] = p;
    } else if let Some(n) = s.prog.nodes.iter_mut().find(|n| n.id == id) {
        n.x = p.0;
        n.y = p.1;
    }
}

fn begin_drag(id: usize, at: &str) {
    let s = st();
    let mut it = at.split(',');
    let x: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let y: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let how: u8 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let g = geo(s);
    if s.held_port.is_some() {
        // a wire is being made: a press on a super lets it go
        s.held_port = None;
        host::capture(false);
        render();
        return;
    }
    if id == S_RESET {
        reset_hold_begin();
    }
    let mut ids = alloc::vec![id];
    if chain_on(s, id) {
        ids.extend_from_slice(held_by(id));
    }
    if is_unode(id) {
        // selecting a super locks the one selected before (owner, 2026-10-14: "selecting other super locks the
        // previous super automatically"; "lock system doesn't work properly": supers you drew were left unlocked)
        if s.prog.sel != Some(id) {
            relock_except(Some(id), None, false);
        }
        let s = st();
        s.sup_pick = None;
        s.prog.sel = Some(id);
        // a canvas super carries what is drawn inside it
        if how == 0 {
            let inside = unode_inside(s, id);
            ids.extend(inside);
            // and a group moves as one
            for m in group_with(s, id) {
                if !ids.contains(&m) {
                    ids.push(m);
                    ids.extend(unode_inside(s, m).into_iter().filter(|x| *x != id));
                }
            }
            ids.sort_unstable();
            ids.dedup();
        }
    }
    let start = ids.iter().map(|i| (*i, pos_of(s, *i))).collect();
    let free = !locked(s, id);
    s.drag = Some(Drag { id, member: s.pend_member.take(), sx: x, sy: y, k: g.k, moved: false, start, pan0: s.pan, how, size0: if id < NSUP { s.sizes[id] } else { let r = rect(&g, id); (r.2, r.3) }, free });
    host::capture(true);
}

/// The super under a point (the topmost), the site when only the site is there, the page near its edge.
fn sup_at(g: &Geo, p: (f64, f64)) -> Option<usize> {
    for (id, (x, y, w, h)) in g.extra.iter().rev() {
        if p.0 >= *x && p.0 <= x + w && p.1 >= *y && p.1 <= y + h {
            return Some(*id);
        }
    }
    for id in (0..NSUP).rev() {
        if id == S_SITE || is_gone(id) {
            continue;
        }
        let (x, y, w, h) = g.rects[id];
        if p.0 >= x - 4.0 && p.0 <= x + w + 4.0 && p.1 >= y - 4.0 && p.1 <= y + h + 4.0 {
            return Some(id);
        }
    }
    let (x, y, w, h) = g.rects[S_SITE];
    if p.0 >= x && p.0 <= x + w && p.1 >= y && p.1 <= y + h {
        return Some(S_SITE);
    }
    let (vx, vy) = (p.0 * g.k + g.ox, p.1 * g.k + g.oy);
    if vx < 28.0 || vy < 28.0 || vx > g.w - 28.0 || vy > g.h - 28.0 {
        return Some(FRAME);
    }
    None
}

/// The side of the target a wire joins: the nearest side of the kind the wire carries (sync and condition join
/// sync and condition, input and output join input and output).
fn side_for(g: &Geo, id: usize, p: (f64, f64), ctl: Option<bool>) -> Side {
    let (cx, cy) = if id == FRAME {
        (port(g, FRAME, Side::T).0, port(g, FRAME, Side::L).1)
    } else {
        let (x, y, w, h) = rect(g, id);
        (x + w / 2.0, y + h / 2.0)
    };
    let (dx, dy) = (p.0 - cx, p.1 - cy);
    let horiz = if dx < 0.0 { Side::L } else { Side::R };
    let vert = if dy < 0.0 { Side::T } else { Side::B };
    match ctl {
        Some(true) => vert,
        Some(false) => horiz,
        None => {
            let (w, h) = if id == FRAME { (g.w / g.k, g.h / g.k) } else { (rect(g, id).2, rect(g, id).3) };
            if dx.abs() / w.max(1.0) > dy.abs() / h.max(1.0) { horiz } else { vert }
        }
    }
}

fn wiring_move(x: f64, y: f64) {
    let s = st();
    let g = geo(s);
    let p = ((x - g.ox) / g.k, (y - g.oy) / g.k);
    let Some(w) = s.wiring.as_mut() else { return };
    w.at = p;
    let From::Bar(gi, _) = w.from;
    let own = GROUPS[gi].sup;
    w.to = sup_at(&g, p).filter(|t| *t != own).map(|t| (t, side_for(&g, t, p, None)));
}

/// How long the reset button is held before it resets.
const RESET_HOLD_MS: f64 = 900.0;

fn reset_hold_begin() {
    let s = st();
    s.reset_hold = Some(host::now());
    host::timer(RESET_HOLD_MS as u32, T_RESET);
}

/// Let go of the reset button: before the hold was long enough it was a click, and a click is undo (owner, 2026-10-14:
/// "merge the undo button to reset button. If clicked once, it's undo. If hold, it's reset").
fn reset_hold_end(clicked: bool) {
    let s = st();
    if s.reset_hold.take().is_some() && clicked {
        undo();
    }
}

fn note(text: String) {
    let s = st();
    s.note = text;
    s.note_at = host::now();
    host::timer(2600, T_NOTE);
}

fn wiring_end() {
    let s = st();
    let Some(w) = s.wiring.take() else { return };
    let Some((b, sb)) = w.to else { return };
    let From::Bar(gi, m) = w.from;
    note(format!("Opened {}: wired to {}", GROUPS[gi].members[m].0, name_of(b)));
    let _ = sb;
    open_member(gi, m);
}

pub fn on_key(key: &str) -> bool {
    // Esc closes Face Mace's photo viewer first
    if key == "Escape" && st().face.viewer.is_some() {
        st().face.viewer = None;
        render();
        return true;
    }
    if key.starts_with('+') || key.starts_with('-') {
        return map_key(key);
    }
    let s = st();
    if s.modal.is_none() && board_key_press(key) {
        return true;
    }
    if key == "Undo" {
        undo();
        return true;
    }
    // the bar's two buttons, as keys
    // no wiring mode to turn on: the tips always take the pointer
    if key == "Wire" {
        return false;
    }
    if key == "Lock" {
        lock_toggle();
        render();
        return true;
    }
    match key {
        "Escape" if (s.sup_pick.is_some() || s.float_pick || s.win_pick) && s.modal.is_none() && s.held_port.is_none() => {
            s.sup_pick = None;
            s.float_pick = false;
            s.win_pick = false;
        }
        "Escape" => {
            if s.modal.is_some() {
                s.modal = None;
                render();
                return true;
            }
            s.wiring = None;
            s.held_port = None;
            s.wire_sel = None;
            host::capture(false);
        }
        "Delete" | "Backspace" => {
            if let Some(i) = s.wire_sel {
                remove_link(i);
            } else if let Some(id) = s.prog.sel {
                prog_remove(id);
            }
        }
        _ => return false,
    }
    render();
    true
}

pub struct FloatDrag {
    sx: f64,
    sy: f64,
    l0: f64,
    t0: f64,
    moved: bool,
}

/// The floating canvas's top-left corner now, in px.
fn float_corner(s: &State) -> (f64, f64) {
    if let Some(p) = s.float_at {
        return p;
    }
    let (w, h) = float_size();
    let (vw, vh) = (host::vw(), host::vh());
    if vw < 700.0 { (vw - 12.0 - w, vh - 76.0 - h) } else { (vw - 18.0 - w, vh - 18.0 - h) }
}

fn float_clamp(p: (f64, f64)) -> (f64, f64) {
    let (w, h) = float_size();
    let (vw, vh) = (host::vw(), host::vh());
    (p.0.clamp(0.0, (vw - w).max(0.0)), p.1.clamp(0.0, (vh - h).max(0.0)))
}

fn float_begin(at: &str) {
    let s = st();
    let mut it = at.split(',');
    let x: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let y: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let (l0, t0) = float_corner(s);
    s.float_drag = Some(FloatDrag { sx: x, sy: y, l0, t0, moved: false });
    host::capture(true);
}

pub fn float_load() {
    st().float_big = host::store_get("piii:float-big").as_deref() == Some("1");
    let Some(v) = host::store_get("piii:float") else { return };
    let mut it = v.split(',');
    if let (Some(Ok(l)), Some(Ok(t))) = (it.next().map(|x| x.parse::<f64>()), it.next().map(|x| x.parse::<f64>())) {
        st().float_at = Some(float_clamp((l, t)));
    }
}

pub fn on_pointer(phase: u32, x: f64, y: f64) {
    let s = st();
    if let Some((x0, y0, p0)) = s.pan_drag {
        let k = geo(s).k;
        s.pan = (p0.0 + (x - x0) / k, p0.1 + (y - y0) / k);
        if phase != 0 {
            s.pan_drag = None;
            host::capture(false);
            layout_save();
        }
        render();
        return;
    }
    if s.reset_cap {
        // the floating reset button, held: its release ends the hold
        if phase != 0 {
            s.reset_cap = false;
            host::capture(false);
            reset_hold_end(phase == 1);
            render();
        }
        return;
    }
    if board_pointer(phase, x, y) {
        return;
    }
    if let Some(d) = s.float_drag.as_mut() {
        match phase {
            0 => {
                if !d.moved && (x - d.sx).abs() + (y - d.sy).abs() > 4.0 {
                    d.moved = true;
                }
                if d.moved && s.float_free {
                    let p = (d.l0 + x - d.sx, d.t0 + y - d.sy);
                    s.float_at = Some(float_clamp(p));
                }
            }
            _ => {
                host::capture(false);
                let moved = s.float_drag.as_ref().map(|d| d.moved).unwrap_or(true);
                s.float_drag = None;
                if !moved && phase == 1 {
                    // a click selects it, for the lock
                    s.float_pick = true;
                    s.win_pick = false;
                    s.sup_pick = None;
                    if let Page::Group(g) = s.page {
                        board(g as usize).picked = None;
                    }
                }
                // a click no longer grows it (owner, 2026-10-17: "super gets bigger suddenly"): it only selects it
                if let Some((l, t)) = s.float_at {
                    host::store_set("piii:float", &format!("{:.0},{:.0}", l, t));
                }
            }
        }
        render();
        return;
    }
    if s.held_port.is_some() {
        // a wire being made follows the pointer until a tip is clicked, or, dragged out of a tip, until it is let go
        if phase == 0 {
            let g = geo(s);
            s.pend_at = ((x - g.ox) / g.k, (y - g.oy) / g.k);
            render();
        } else if let Some((x0, y0)) = s.port_drag.take() {
            if (x - x0).abs() + (y - y0).abs() > 6.0 {
                match nearest_tip(s, x, y) {
                    Some((id, tip)) => port_click(id, tip),
                    None => {
                        s.held_port = None;
                        host::capture(false);
                    }
                }
                s.port_press = host::now();
                render();
            }
        }
        return;
    }
    if s.wiring.is_some() {
        match phase {
            0 => wiring_move(x, y),
            1 => {
                host::capture(false);
                wiring_end();
            }
            _ => {
                host::capture(false);
                s.wiring = None;
            }
        }
        render();
        return;
    }
    // locking keeps a super in place: no drag while it is locked, shift or not (owner, 2026-10-14: "locking makes canvas at
    // place and can't be draggable or resizable")
    // shift + drag, or the middle button held, resizes; a plain drag moves (owner, 2026-10-14: "shift click or middle
    // click holding can resize any super")
    let movable = s.drag.as_ref().map(|d| d.how == 0 && d.free && d.id >= S_WELCOME).unwrap_or(false);
    // resizing too waits for the lock: a super is resized only once the lock has freed it (owner, 2026-10-14)
    let resizable = s.drag.as_ref().map(|d| d.how != 0 && d.id >= S_WELCOME && !on_bar(d.id) && rail_pin(d.id).is_none() && d.free).unwrap_or(false);
    let Some(d) = s.drag.as_mut() else {
        host::capture(false);
        return;
    };
    let (dx, dy) = ((x - d.sx) / d.k, (y - d.sy) / d.k);
    match phase {
        0 => {
            if !d.moved && (x - d.sx).abs() + (y - d.sy).abs() > 5.0 {
                d.moved = true;
                // a Shift or middle-button drag on a super still locked: say how to free it, rather than nothing
                // happening (owner, 2026-10-14: "I can't resize a sparkle")
                if d.how != 0 && !d.free && d.id >= S_WELCOME && !on_bar(d.id) && rail_pin(d.id).is_none() {
                    let id = d.id;
                    lock_hint(id);
                }
                if d.id == S_RESET {
                    reset_hold_end(false);
                }
                // a bar pulled out of its bubble is a wire: wherever it lands, what it stands for opens
                if let (Some(m), Some(gi)) = (d.member, group_of(d.id)) {
                    let at = ((x - d.sx) / d.k, (y - d.sy) / d.k);
                    s.drag = None;
                    s.wiring = Some(Wiring { from: From::Bar(gi, m as usize), at, to: None });
                    wiring_move(x, y);
                    render();
                    return;
                }
            }
            if d.moved && resizable && is_unode(d.id) {
                let (w, h) = ((d.size0.0 + dx).max(MIN_SUPER), (d.size0.1 + dy).max(MIN_SUPER));
                if let Some(n) = s.prog.nodes.iter_mut().find(|n| n.id == d.id) {
                    n.w = w;
                    n.h = h;
                }
            } else if d.moved && resizable {
                let (b, _, _) = base(host::vw() < 700.0);
                let (bw, bh) = (b[d.id].2, b[d.id].3);
                // no limit either way (owner, 2026-10-14: "a super can get infinitely bigger or infinitely smaller"): it only
                // stays above nothing, so it can still be found by zooming in; under 10% of the window it is an icon
                let (w, h) = ((bw + d.size0.0 + dx).max(MIN_SUPER), (bh + d.size0.1 + dy).max(MIN_SUPER));
                s.sizes[d.id] = (w - bw, h - bh);
                s.dirty = true;
            } else if d.moved && movable {
                for (i, (ox, oy)) in d.start.clone() {
                    set_pos(s, i, (ox + dx, oy + dy));
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
            s.drag_end_at = host::now();
            if d.how != 0 && d.moved {
                if is_unode(d.id) {
                    prog_save();
                } else {
                    layout_save();
                }
            } else if !d.moved && d.id == S_RESET {
                // reset is held, not clicked: let go early and nothing happens
                reset_hold_end(true);
            } else if !d.moved && s.last_tap.0 == d.id && host::now() - s.last_tap.2 < 450.0 && unode(s, d.id).map(|n| is_place(&n.text)).unwrap_or(false) {
                // one of the site's places, double clicked (or tapped twice): it opens
                s.last_tap = (usize::MAX, None, 0.0);
                if let Some(t) = unode(s, d.id).map(|n| n.text.clone()) {
                    open_place(&t);
                }
            } else if !d.moved && is_unode(d.id) && d.free && !touching() && s.last_tap.0 == d.id && host::now() - s.last_tap.2 < 450.0 && !unode(s, d.id).map(unode_is_canvas).unwrap_or(false) {
                // a super or sparkle of yours, unlocked and double clicked: gone, with its wires (owner, 2026-10-14); not
                // with a finger, where a double tap is too easy to make by accident (owner, 2026-10-15)
                s.last_tap = (usize::MAX, None, 0.0);
                s.free.retain(|i| *i != d.id);
                s.locked.retain(|i| *i != d.id);
                locked_save();
                prog_remove(d.id);
                layout_save();
            } else if !d.moved && (is_ctl_super(d.id) || matches!(d.id, S_TITLE | S_RUN | S_CLEAR) || is_unode(d.id)) {
                // the controls are buttons: one click does it
                if is_unode(d.id) {
                    s.last_tap = (d.id, None, host::now());
                }
                activate(d.id, d.member);
            } else if !d.moved {
                // anything else opens on a double click
                let now = host::now();
                if s.last_tap.0 == d.id && s.last_tap.1 == d.member && now - s.last_tap.2 < 450.0 && d.member.is_none() && shrinkable(s, d.id) {
                    // an unlocked canvas, double clicked: back to an icon, in place (owner, 2026-10-14)
                    s.last_tap = (usize::MAX, None, 0.0);
                    shrink_to_icon(d.id);
                } else if s.last_tap.0 == d.id && s.last_tap.1 == d.member && now - s.last_tap.2 < 450.0 {
                    s.last_tap = (usize::MAX, None, 0.0);
                    s.peek_next = true;
                    activate(d.id, d.member);
                } else {
                    s.last_tap = (d.id, d.member, now);
                    relock_except(Some(d.id), None, false);
                    let s = st();
                    s.sup_pick = Some(d.id);
                    s.prog.sel = None;
                    s.float_pick = false;
                    s.win_pick = false;
                }
            } else if is_unode(d.id) {
                prog_save();
            } else {
                // moved (a super, or the view by its title): kept at once, there being no save button
                layout_save();
            }
            render();
        }
        _ => {
            host::capture(false);
            s.drag = None;
            reset_hold_end(false);
            render();
        }
    }
}

/// The wheel over the canvas: zoom about the pointer, as far in or out as you like (owner, 2026-10-14: "zooming in
/// and zooming out can be indefinitely"). The value is deltaY, then x, y within the canvas.
/// The wheel, or two fingers, over the canvas: it pans (deltaY, x, y, w, h, deltaX).
fn canvas_wheel(v: &str) {
    let s = st();
    let n: Vec<f64> = v.split(',').filter_map(|x| x.parse().ok()).collect();
    let (dy, dx) = (n.first().copied().unwrap_or(0.0), n.get(5).copied().unwrap_or(0.0));
    let k = geo(s).k;
    s.pan = (s.pan.0 - dx / k, s.pan.1 - dy / k);
    layout_save();
}

/// A press on the bare canvas: dragging pans it (owner, 2026-10-14: "I can't pan on the canvas").
fn canvas_pan_begin(v: &str) {
    let s = st();
    if s.held_port.is_some() {
        return;
    }
    let n: Vec<f64> = v.split(',').filter_map(|x| x.parse().ok()).collect();
    s.pan_drag = Some((n.first().copied().unwrap_or(0.0), n.get(1).copied().unwrap_or(0.0), s.pan));
    host::capture(true);
}

fn canvas_zoom(v: &str) {
    let s = st();
    let n: Vec<f64> = v.split(',').filter_map(|x| x.parse().ok()).collect();
    let (dy, px, py) = (n.first().copied().unwrap_or(0.0), n.get(1).copied().unwrap_or(0.0), n.get(2).copied().unwrap_or(0.0));
    let g0 = geo(s);
    // the design point under the pointer, before
    let d = ((px - g0.ox) / g0.k - s.pan.0, (py - g0.oy) / g0.k - s.pan.1);
    let f = libm_exp(-dy * 0.0015);
    let z = zoom_within(s.zoom, f, canvas_zoom_limits(s));
    if !(z.is_finite() && z > 1e-300 && z < 1e300) || z == s.zoom {
        // in past the 0s and 1s: round again to the top, Super AI (owner, 2026-10-17: "if you zoom in, things loop
        // back to Super AI")
        if dy < 0.0 && host::now() - s.zoom_nav_at > 700.0 && anything_on_screen(s) && push_through(dy, 1200.0) {
            loop_to_ai();
        }
        return;
    }
    let (z0, pan0) = (s.zoom, s.pan);
    s.zoom = z;
    let g1 = geo(s);
    s.pan = ((px - g1.ox) / g1.k - d.0, (py - g1.oy) / g1.k - d.1);
    // zooming in never empties the view (owner, 2026-10-17: "if zooming in makes canvas empty, it stops there"): a
    // step that would leave nothing on screen is not taken
    if z > z0 && !s.prog.nodes.is_empty() && !anything_on_screen(s) {
        s.zoom = z0;
        s.pan = pan0;
        return;
    }
    layout_save();
}

/// Which supers are drawn as one: the same text, centres within 56px of each other on screen or overlapping. For each super merged
/// into another, where it glides to (design units); for each that takes others in, how many it stands for.
fn merges(s: &State, g: &Geo) -> BTreeMap<usize, (Option<(f64, f64)>, usize)> {
    let mut out: BTreeMap<usize, (Option<(f64, f64)>, usize)> = BTreeMap::new();
    let mut leaders: Vec<(usize, &str, f64, f64)> = Vec::new();
    for n in s.prog.nodes.iter() {
        let t = n.text.trim();
        // what is being dragged stays itself
        if t.is_empty() || s.drag.as_ref().map(|d| d.id == n.id).unwrap_or(false) {
            continue;
        }
        let (x, y, w, h) = rect(g, n.id);
        let (cx, cy) = (x + w / 2.0, y + h / 2.0);
        // close: within 56px, or overlapping each other on screen
        let (tx, ty) = ((0.5 * w * g.k).max(56.0), (0.5 * h * g.k).max(56.0));
        let near = leaders.iter().find(|l| l.1 == t && ((l.2 - cx) * g.k).abs() < tx && ((l.3 - cy) * g.k).abs() < ty).map(|l| (l.0, l.2, l.3));
        match near {
            Some((lid, lx, ly)) => {
                out.insert(n.id, (Some((lx - cx, ly - cy)), 1));
                out.entry(lid).or_insert((None, 1)).1 += 1;
            }
            None => leaders.push((n.id, t, cx, cy)),
        }
    }
    out
}

/// The welcome view: the home canvas zoomed out to its ring of places, Super AI in the middle of the window.
fn welcome_view() {
    let s = st();
    s.ai_level = 0;
    // the whole ring filling most of the window beside the sidebar
    s.zoom = 1.0;
    let g = geo(s);
    let world: Vec<Rect> = s.prog.nodes.iter().filter(|n| world_of(&n.text).is_some()).map(|n| rect(&g, n.id)).collect();
    if !world.is_empty() {
        let (l, t) = world.iter().fold((f64::MAX, f64::MAX), |a, r| (a.0.min(r.0), a.1.min(r.1)));
        let (r, b) = world.iter().fold((f64::MIN, f64::MIN), |a, q| (a.0.max(q.0 + q.2), a.1.max(q.1 + q.3)));
        let (vw, vh) = (host::vw() - 300.0, host::vh() - 120.0);
        let fit = (vw.max(200.0) / ((r - l) * g.k)).min(vh.max(200.0) / ((b - t) * g.k));
        s.zoom = fit.max(canvas_zoom_limits(s).0);
    }
    let hub = s.prog.nodes.iter().find(|n| world_of(&n.text) == Some(WORLD_HUB)).map(|n| n.id);
    if let Some(id) = hub {
        let g = geo(s);
        let (x, y, w, h) = rect(&g, id);
        // move the view so the hub's middle is the window's
        let (sx, sy) = (g.ox + (x + w / 2.0) * g.k, g.oy + (y + h / 2.0) * g.k);
        let (vw, vh) = (host::vw(), host::vh());
        s.pan = (s.pan.0 + (vw / 2.0 + 30.0 - sx) / g.k, s.pan.1 + (vh / 2.0 - sy) / g.k);
    }
    layout_save();
}

/// Pushing against a level's edge: true once the wheel has pushed hard enough (`need`, in wheel units: about four
/// notches for the usual crossing) in one direction without letting up. The push is shown as a growing ring.
fn push_through(dy: f64, need: f64) -> bool {
    let s = st();
    let now = host::now();
    let dir = if dy < 0.0 { -1.0 } else { 1.0 };
    if now - s.resist.2 > 450.0 || s.resist.1 != dir {
        s.resist.0 = 0.0;
    }
    s.resist = (s.resist.0 + dy.abs(), dir, now);
    if s.resist.0 >= need {
        s.resist = (0.0, 0.0, now);
        return true;
    }
    false
}

/// How far a push against an edge has got (0…1), for the ring that shows it.
fn push_shown() -> f64 {
    let s = st();
    if host::now() - s.resist.2 > 450.0 { 0.0 } else { (s.resist.0 / 700.0).min(1.0) }
}

/// Round the loop: past the deepest zoom is the highest level again.
fn loop_to_ai() {
    let s = st();
    s.zoom_nav_at = host::now();
    s.trans = (3, (0.0, 0.0, 0.0, 0.0), host::now());
    s.zoom = canvas_zoom_limits(s).0;
    s.pzoom = 1.0;
    host::store_set("piii:pzoom", "1");
    s.ai_level = 1;
    layout_save();
    if s.page != Page::Home || s.peek {
        host::go("#/");
    }
}

/// Is any super or sparkle of the canvas at least partly in the window?
fn anything_on_screen(s: &State) -> bool {
    let g = geo(s);
    let (vw, vh) = (host::vw(), host::vh());
    s.prog.nodes.iter().any(|n| {
        let (x, y, w, h) = rect(&g, n.id);
        let (sx, sy, sw, sh) = (g.ox + x * g.k, g.oy + y * g.k, w * g.k, h * g.k);
        // its middle in the window, clear of the sidebar: something to look at, not an edge
        let (mx, my) = (sx + sw / 2.0, sy + sh / 2.0);
        mx > 80.0 && mx < vw && my > 0.0 && my < vh
    })
}

/// A zoom step by `f` from `z`, kept within (lo, hi): a step that would go past a limit stops at it, and from outside
/// the limits (a super just made bigger, a drawing just cleared) only a step back towards them is taken.
fn zoom_within(z: f64, f: f64, (lo, hi): (f64, f64)) -> f64 {
    let n = z * f;
    if f > 1.0 && n > hi {
        z.max(hi)
    } else if f < 1.0 && n < lo {
        z.min(lo)
    } else {
        n
    }
}

/// How far the canvas zooms, in proportion to what is drawn on it (owner, 2026-10-14: "use proportional zoom
/// limits"): out until the whole drawing is a tenth of the window, in until the smallest super or sparkle fills it.
/// With nothing drawn, a quarter to four times the start. As factors of the zoom (1 = the start).
fn canvas_zoom_limits(s: &State) -> (f64, f64) {
    let g = geo(s);
    let base = g.k / s.zoom.max(1e-300);
    let m = host::vw().min(host::vh()).max(1.0);
    let rects: Vec<Rect> = s.prog.nodes.iter().map(|n| rect(&g, n.id)).filter(|r| r.2 > 0.0 && r.3 > 0.0).collect();
    if rects.is_empty() {
        return (0.25, 4.0);
    }
    let (mut l, mut t, mut r, mut b) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    let mut small = f64::MAX;
    for (x, y, w, h) in &rects {
        l = l.min(*x);
        t = t.min(*y);
        r = r.max(x + w);
        b = b.max(y + h);
        small = small.min(w.max(*h));
    }
    let all = (r - l).max(b - t).max(1e-9);
    // in far enough to reach a super's bits: its machine code fills the window several times over
    let hi = 40.0 * m / small.max(1e-9) / base;
    // out until the whole drawing is a third of the window (further, it is only specks)
    // out until the drawing is a ring of icons in the middle (where the site starts); one step more is Super AI (owner,
    // 2026-10-17: "after this comes Super AI, is closer to this")
    let lo = (0.45 * m / all / base).min(hi * 0.45).min(1.0);
    (lo, hi)
}

fn libm_exp(x: f64) -> f64 {
    // e^x = 2^(x / ln 2): the integer part by doubling, the rest by its series
    let t = x / core::f64::consts::LN_2;
    let i = if t >= 0.0 { t as i64 } else { t as i64 - 1 };
    let r = (t - i as f64) * core::f64::consts::LN_2;
    let (mut term, mut sum) = (1.0, 1.0);
    for k in 1..20 {
        term *= r / k as f64;
        sum += term;
    }
    let mut p = 1.0f64;
    let base = if i >= 0 { 2.0 } else { 0.5 };
    for _ in 0..i.unsigned_abs().min(2000) {
        p *= base;
    }
    sum * p
}

pub fn on_resize() {
    render();
}

/// What undo keeps of the canvas: its supers and sparkles, their sizes, the wires, and the layout (its view, pan and
/// zoom, left out: moving the view is not a change to undo). On a page's own canvas: what is drawn there, nothing of
/// the home canvas's layout.
const UNDO_KEYS: [&str; 5] = ["piii:program", "piii:program-sizes", "piii:wires2", "piii:layout2", "piii:groups"];

fn undo_keys() -> Vec<String> {
    let home = st().ctx.is_empty();
    UNDO_KEYS.iter().filter(|k| home || **k != "piii:layout2").map(|k| ckey(k)).collect()
}

/// The layout's parts undo leaves as they are now: the view (pan, zoom), the locks and the chain.
fn keeps_now(i: usize) -> bool {
    matches!(i, 1 | 2 | 3 | 5)
}

fn layout_no_view(v: &str) -> String {
    v.split('|').enumerate().map(|(i, p)| if keeps_now(i) { "" } else { p }).collect::<Vec<_>>().join("|")
}

fn undo_snapshot() -> String {
    undo_keys()
        .iter()
        .map(|k| {
            let v = host::store_get(k).unwrap_or_default();
            if k == "piii:layout2" { layout_no_view(&v) } else { v }
        })
        .collect::<Vec<_>>()
        .join("\u{1}")
}

/// Called just before the canvas is saved: keeps how it was, once per burst of changes (typing a word, a reset).
fn undo_mark() {
    let now = host::now();
    let s = st();
    let quiet = now - s.undo_at > 400.0;
    s.undo_at = now;
    if !quiet && !s.undo.is_empty() {
        return;
    }
    let snap = undo_snapshot();
    let s = st();
    if s.undo.last() != Some(&snap) {
        s.undo.push(snap);
        if s.undo.len() > 80 {
            s.undo.remove(0);
        }
    }
}

/// One step back: the canvas as it was before the last change.
fn undo() {
    let now_snap = undo_snapshot();
    let s = st();
    // a step that changed nothing is skipped
    while s.undo.last() == Some(&now_snap) {
        s.undo.pop();
    }
    let Some(snap) = s.undo.pop() else {
        note("Nothing to undo".to_string());
        render();
        return;
    };
    let view: Vec<String> = host::store_get("piii:layout2").unwrap_or_default().split('|').map(|x| x.to_string()).collect();
    for (k, v) in undo_keys().iter().zip(snap.split('\u{1}')) {
        let v = if k == "piii:layout2" && !v.is_empty() {
            // the view stays where it is now
            v.split('|').enumerate().map(|(i, p)| if keeps_now(i) && view.len() > i { view[i].clone() } else { p.to_string() }).collect::<Vec<_>>().join("|")
        } else {
            v.to_string()
        };
        if v.is_empty() {
            host::store_del(k);
        } else {
            host::store_set(k, &v);
        }
    }
    let s = st();
    s.prog.nodes.clear();
    s.prog.vals.clear();
    s.prog.regs.clear();
    s.prog.sel = None;
    if s.ctx.is_empty() {
        s.offs = [(0.0, 0.0); NSUP];
        s.sizes = [(0.0, 0.0); NSUP];
    }
    s.wire_sel = None;
    s.held_port = None;
    prog_load();
    groups_load();
    wires_load();
    if st().ctx.is_empty() {
        layout_load();
    }
    // the next change starts a step of its own
    st().undo_at = 0.0;
    note("Undone".to_string());
    render();
}

// ---------------------------------------------------------------------------------------------- grouping

/// The others grouped with a super or sparkle (none when it is in no group).
fn group_with(s: &State, id: usize) -> Vec<usize> {
    s.groups.iter().find(|g| g.contains(&id)).map(|g| g.iter().copied().filter(|x| *x != id).collect()).unwrap_or_default()
}

fn groups_save() {
    let out: Vec<String> = st().groups.iter().map(|g| g.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",")).collect();
    host::store_set(&ckey("piii:groups"), &out.join(";"));
}

fn groups_load() {
    let s = st();
    s.groups = host::store_get(&ckey("piii:groups"))
        .unwrap_or_default()
        .split(';')
        .map(|g| g.split(',').filter_map(|x| x.parse::<usize>().ok()).filter(|x| is_unode(*x)).collect::<Vec<usize>>())
        .filter(|g| g.len() >= 2)
        .collect();
}

/// The right button held and dragged on the canvas (owner, 2026-10-14: "hold right click to select and group supers
/// and sparkles"): "x0,y0,x1,y1,phase" in screen px; while it moves (phase 0) the box is drawn; let go (1), what lies
/// in it is selected, and two or more are grouped, to move, lock and unlock as one. Boxing exactly a group again
/// takes the group apart.
fn marquee_update(v: &str) {
    let n: Vec<f64> = v.split(',').filter_map(|x| x.parse().ok()).collect();
    if n.len() < 5 {
        return;
    }
    let s = st();
    let (x0, y0, x1, y1) = (n[0], n[1], n[2], n[3]);
    if n[4] == 0.0 {
        s.marquee = Some((x0, y0, x1, y1));
        return;
    }
    s.marquee = None;
    let g = geo(s);
    let (l, r) = ((x0.min(x1) - g.ox) / g.k, (x0.max(x1) - g.ox) / g.k);
    let (t, b) = ((y0.min(y1) - g.oy) / g.k, (y0.max(y1) - g.oy) / g.k);
    // what has its middle in the box
    let mut picked: Vec<usize> = s
        .prog
        .nodes
        .iter()
        .map(|n| n.id)
        .filter(|id| {
            let (x, y, w, h) = rect(&g, *id);
            let (cx, cy) = (x + w / 2.0, y + h / 2.0);
            cx >= l && cx <= r && cy >= t && cy <= b
        })
        .collect();
    picked.sort_unstable();
    match picked.len() {
        0 => {}
        1 => {
            relock_except(Some(picked[0]), None, false);
            let s = st();
            s.sup_pick = None;
            s.prog.sel = Some(picked[0]);
        }
        k => {
            let s = st();
            let same = s.groups.iter().position(|g| {
                let mut g = g.clone();
                g.sort_unstable();
                g == picked
            });
            if let Some(i) = same {
                s.groups.remove(i);
                note(format!("Ungrouped: {} apart again", k));
            } else {
                for gr in s.groups.iter_mut() {
                    gr.retain(|x| !picked.contains(x));
                }
                s.groups.retain(|gr| gr.len() >= 2);
                s.groups.push(picked.clone());
                note(format!("Grouped {}: they move, lock and unlock as one. Box them again to ungroup", k));
            }
            undo_mark();
            groups_save();
            relock_except(Some(picked[0]), None, false);
            let s = st();
            s.sup_pick = None;
            s.prog.sel = Some(picked[0]);
        }
    }
}

fn layout_save() {
    undo_mark();
    let s = st();
    let mut out = String::new();
    for (x, y) in s.offs.iter() {
        out.push_str(&format!("{:.1},{:.1};", x, y));
    }
    let free: Vec<String> = s.free.iter().map(|i| i.to_string()).collect();
    out.push_str(&format!("|{:.1},{:.1}|f{}|{}|", s.pan.0, s.pan.1, free.join(","), s.chained as u8));
    for (w, h) in s.sizes.iter() {
        out.push_str(&format!("{:.1},{:.1};", w, h));
    }
    out.push_str(&format!("|{}", s.zoom));
    host::store_set("piii:layout2", &out);
    s.dirty = false;
}

fn layout_load() {
    let s = st();
    let Some(v) = host::store_get("piii:layout2") else { return };
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
    s.free = parts.get(2).and_then(|p| p.strip_prefix('f')).map(|p| p.split(',').filter_map(|x| x.parse().ok()).collect()).unwrap_or_default();
    // unlocked unless locked (owner, 2026-10-17)
    s.float_free = host::store_get("piii:float-free").as_deref() != Some("0");
    s.win_free = host::store_get("piii:win-free").as_deref() != Some("0");
    s.chained = parts.get(3) != Some(&"0");
    s.zoom = parts.get(5).and_then(|v| v.parse::<f64>().ok()).filter(|z| z.is_finite() && *z > 0.0).unwrap_or(1.0);
    if let Some(sz) = parts.get(4) {
        for (i, p) in sz.split(';').filter(|p| !p.is_empty()).enumerate().take(NSUP) {
            let mut xy = p.split(',');
            s.sizes[i] = (xy.next().and_then(|v| v.parse().ok()).unwrap_or(0.0), xy.next().and_then(|v| v.parse().ok()).unwrap_or(0.0));
        }
    }
}

fn activate(id: usize, member: Option<u8>) {
    let s = st();
    match id {
        S_SAVE => wire_mode_toggle(),
        S_LOCK => lock_toggle(),
        S_CHAIN => {
            s.chained = !s.chained;
            layout_save();
        }
        // on a super's own canvas the reset puts that canvas back (owner, 2026-10-14: "merge the reset this canvas
        // button with this")
        // on a page's own canvas: that canvas is cleared (and a group's board put back), never the home canvas
        S_RESET if !s.ctx.is_empty() => {
            if let Page::Group(g) = s.page {
                board_reset(g as usize);
            }
            undo_mark();
            program_clear();
            let s = st();
            s.wires.clear();
            s.passes.clear();
            s.wire_sel = None;
            s.held_port = None;
            wires_save();
            s.groups.clear();
            groups_save();
            st().locked.clear();
            locked_save();
            prog_clear();
            if let Page::Group(g) = st().page {
                group_members_place(g as usize, false);
                locked_save();
                wires_save();
                prog_save();
            }
            note("This page's canvas is cleared (the reset button, clicked, undoes it)".to_string());
        }
        S_RESET => {
            // undo can bring it all back
            undo_mark();
            let s = st();
            s.offs = [(0.0, 0.0); NSUP];
            s.sizes = [(0.0, 0.0); NSUP];
            s.zoom = 1.0;
            s.pan = (0.0, 0.0);
            s.free.clear();
            s.sup_locked.clear();
            sup_locked_save();
            s.float_free = true;
            s.win_free = true;
            s.win_off = (0.0, 0.0);
            host::store_del("piii:winoff");
            host::store_del("piii:float-free");
            host::store_del("piii:win-free");
            s.chained = true;
            s.open.clear();
            s.wires = START_WIRES.to_vec();
            s.passes = START_PASSES.to_vec();
            s.wire_sel = None;
            s.held_port = None;
            host::store_del("piii:layout2");
            host::store_del("piii:wires2");
            // and clears the canvas: what was drawn on it goes, the example too (owner, 2026-10-14: "reset button should
            // clear the canvas")
            program_clear();
            st().groups.clear();
            groups_save();
            st().locked.clear();
            locked_save();
            st().example_on = false;
            host::store_del("piii:example");
            layer().clear();
            layer_save();
        }
        S_RUN => prog_run(None),
        S_STEP => prog_run(Some(1)),
        S_CLEAR => prog_clear(),
        S_PROG | S_PALETTE | S_EXAMPLES => s.prog.sel = None,
        _ if is_unode(id) => s.prog.sel = Some(id),
        S_LEFT => s.pan.0 -= 60.0,
        S_RIGHT => s.pan.0 += 60.0,
        S_UP => s.pan.1 -= 60.0,
        S_DOWN => s.pan.1 += 60.0,
        S_TITLE => {
            if st().page != Page::Home {
                host::go("#/");
            }
        }
        S_WELCOME => host::go("#/assess"),
        S_PRIVACY => {
            s.draft = s.consent.unwrap_or([true, true, true]);
            s.consent_open = true;
        }
        S_PROJECT => host::go("#/map"),
        S_TOOLS | S_EXPLORE | S_LIBRARY | S_LAB | S_CONNECT | S_INSIGHT => {
            let gi = group_of(id).unwrap_or(0);
            match member {
                Some(m) => open_member(gi, m as usize),
                None => host::go(&format!("#/g/{}", gi)),
            }
        }
        _ => {}
    }
}

/// The home canvas's own places, where the sidebar was (owner, 2026-10-17: "remove all sidebar and top bar and merge
/// them into each other as in zooming inside each other opens them"): the six groups, the map, privacy and the API.
const WORLD: [&str; 10] = ["Tools", "Explore", "Library", "Lab", "Connect", "Insights", "The map", "Privacy", "API", "Super AI"];

/// The one in the middle, wired out to all the others (owner, 2026-10-17: "put a super AI bubble in the middle and
/// make it connected to the other bubbles").
const WORLD_HUB: usize = 9;

fn world_of(text: &str) -> Option<usize> {
    let name = text.strip_prefix(MEMBER)?;
    WORLD.iter().position(|w| *w == name)
}

/// A super that is one of the site's places (a group's member, or one of the home canvas's): can it be opened?
fn is_place(text: &str) -> bool {
    member_of(text).is_some() || world_of(text).is_some()
}

/// Open the place a super stands for. True if it was one.
fn open_place(text: &str) -> bool {
    // on the home canvas its own places come first (its Super AI is the AI language, not the Tools page of that name)
    let home_place = st().ctx.is_empty() && world_of(text).is_some();
    if let (false, Some((gi, m))) = (home_place, member_of(text)) {
        open_member(gi, m);
        return true;
    }
    match world_of(text) {
        Some(i) if i < GROUPS.len() => host::go(&format!("#/g/{}", i)),
        Some(6) => host::go("#/map"),
        Some(7) => {
            let s = st();
            s.draft = s.consent.unwrap_or([true, true, true]);
            s.consent_open = true;
        }
        Some(8) => open_modal(Modal::Info("The API".into(), API_GUIDE.into())),
        Some(WORLD_HUB) => {
            let s = st();
            s.trans = (3, (0.0, 0.0, 0.0, 0.0), host::now());
            s.ai_level = 1;
            if s.page != Page::Home {
                host::go("#/");
            }
        }
        _ => return false,
    }
    true
}

/// The home canvas has its places: in a ring round the middle, as supers to zoom into. The ring is laid out in the
/// canvas's own units (220 × 104 each, never overlapping, whatever the zoom was), and laid out again once for
/// canvases that got their ring before (owner, 2026-10-17: "fix this", places piled on each other).
fn world_sync() {
    if !st().ctx.is_empty() {
        return;
    }
    let v = host::store_get("piii:world-v");
    let again = !matches!(v.as_deref(), Some("3") | Some("4"));
    let (cx, cy) = screen_to_node(host::vw() / 2.0, host::vh() / 2.0);
    let (rx, ry) = (430.0, 300.0);
    let mut changed = false;
    let ring = WORLD.len() - 1;
    for (i, w) in WORLD.iter().enumerate() {
        let text = format!("{}{}", MEMBER, w);
        let a = i as f64 / ring as f64 * core::f64::consts::TAU - core::f64::consts::FRAC_PI_2;
        let (w0, h0) = unode_size(&text);
        // the ring, and Super AI in its middle
        let (x, y) = if i == WORLD_HUB {
            (cx - w0 / 2.0, cy - h0 / 2.0)
        } else {
            (cx + rx * libm_cos(a) - w0 / 2.0, cy + ry * libm_cos(a - core::f64::consts::FRAC_PI_2) - h0 / 2.0)
        };
        match st().prog.nodes.iter_mut().find(|n| n.text == text) {
            Some(n) if again => {
                n.x = x;
                n.y = y;
                n.w = 0.0;
                n.h = 0.0;
                changed = true;
            }
            Some(_) => {}
            None => {
                prog_add(&text, x, y);
                changed = true;
            }
        }
    }
    // Super AI wired out to every place, once (a wire taken away later stays away)
    if again {
        let id_of = |name: &str| st().prog.nodes.iter().find(|n| n.text.strip_prefix(MEMBER) == Some(name)).map(|n| n.id);
        if let Some(hub) = id_of(WORLD[WORLD_HUB]) {
            for (i, w) in WORLD.iter().enumerate() {
                if i == WORLD_HUB {
                    continue;
                }
                if let Some(to) = id_of(w) {
                    if !st().wires.iter().any(|x| x.0 == hub && x.1 == to) {
                        st().wires.push((hub, to, Tip::In));
                    }
                }
            }
            wires_save();
        }
        host::store_set("piii:world-v", "3");
    }
    // the welcome page's dashed links, tip to tip (owner, 2026-10-17: "make the initial state exactly look like this
    // with the wiring"): the places pass on to their neighbours down each side of the ring, and they all reach
    // Super AI's control from above, which passes down to Insights and Connect
    if host::store_get("piii:world-links").as_deref() != Some("1") {
        let id_of = |name: &str| st().prog.nodes.iter().find(|n| n.text.strip_prefix(MEMBER) == Some(name)).map(|n| n.id);
        let links: [(&str, Tip, &str, Tip); 14] = [
            ("Tools", Tip::In, "API", Tip::Control),
            ("Tools", Tip::Out, "Explore", Tip::Control),
            ("API", Tip::In, "Privacy", Tip::Control),
            ("Privacy", Tip::Gate, "The map", Tip::Control),
            ("Explore", Tip::Out, "Library", Tip::Control),
            ("Library", Tip::Gate, "Lab", Tip::Control),
            ("Tools", Tip::Gate, "Super AI", Tip::Control),
            ("API", Tip::Out, "Super AI", Tip::Control),
            ("Explore", Tip::In, "Super AI", Tip::Control),
            ("Privacy", Tip::Out, "Super AI", Tip::Control),
            ("Library", Tip::In, "Super AI", Tip::Control),
            ("Super AI", Tip::Control, "Insights", Tip::Control),
            ("Super AI", Tip::Control, "Connect", Tip::Control),
            ("Tools", Tip::Control, "Tools", Tip::Control),
        ];
        for (a, ta, b, tb) in links.iter() {
            if a == b {
                continue;
            }
            if let (Some(x), Some(y)) = (id_of(a), id_of(b)) {
                if !st().passes.iter().any(|p| p.0 == x && p.1 == *ta && p.2 == y && p.3 == *tb) {
                    st().passes.push((x, *ta, y, *tb));
                }
            }
        }
        wires_save();
        host::store_set("piii:world-links", "1");
    }
    if changed {
        prog_save();
    }
}

/// Zoomed far enough into a place, it opens (owner, 2026-10-17: "zooming inside each other opens them"): one that is
/// under the pointer and fills most of the window. True if one opened.
fn zoom_into_place(px: f64, py: f64, dy: f64) -> bool {
    let s = st();
    if host::now() - s.zoom_nav_at < 700.0 {
        return false;
    }
    let g = geo(s);
    let m = host::vw().min(host::vh());
    let hit = s.prog.nodes.iter().filter(|n| is_place(&n.text)).find_map(|n| {
        let (x, y, w, h) = rect(&g, n.id);
        let (sx, sy, sw, sh) = (g.ox + x * g.k, g.oy + y * g.k, w * g.k, h * g.k);
        (px >= sx && px <= sx + sw && py >= sy && py <= sy + sh && sw.min(sh) >= 0.6 * m).then(|| (n.text.clone(), (sx, sy, sw, sh)))
    });
    // a place under the pointer filling the window opens only after a push into it
    let hit = match hit {
        Some(h) if push_through(dy, 700.0) => Some(h),
        _ => None,
    };
    match hit {
        Some((t, r)) => {
            // the page grows out of the super it was
            st().trans = (1, r, host::now());
            st().zoom_nav_at = host::now();
            st().pzoom = 1.0;
            host::store_set("piii:pzoom", "1");
            open_place(&t)
        }
        None => false,
    }
}

/// Zoomed out past the farthest a page goes: up to what holds it (a member's page → its group → the home canvas).
fn zoom_out_of_page() -> bool {
    let s = st();
    if host::now() - s.zoom_nav_at < 700.0 {
        return false;
    }
    s.zoom_nav_at = host::now();
    // the level above opens at its usual size; the home canvas as it was left, around the place come out of
    s.trans = (2, (0.0, 0.0, 0.0, 0.0), host::now());
    s.pzoom = 1.0;
    host::store_set("piii:pzoom", "1");
    match s.page {
        Page::Item(g, _) => host::go(&format!("#/g/{}", g)),
        _ => host::go("#/"),
    }
    true
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

/// The four ports of a super drawn by CSS (a window, an icon, a member).
/// The tips of a control on the floating bar: the same tips as on the canvas, which sit pinned under the bar, so a wire
/// starts or ends here.
fn bar_ports(id: usize) -> N {
    let tip = |c: &'static str, t: Tip| -> N {
        el("svg:svg")
            .cls(c)
            .attr("viewBox", "-8 -8 16 16")
            .attr("width", "14")
            .attr("height", "14")
            .attr("data-stop", "1")
            .attr("data-nonav", "1")
            .on("click", Msg::Port(id, t.code()))
            .on("pdown", Msg::PortDown(id, t.code(), String::new()))
            .kid(el("svg:title").text(match t {
                Tip::Out => "out. Click, then click a tip",
                Tip::In => "in",
                Tip::Control => "control",
                Tip::Gate => "gate",
            }))
            .kid(el("svg:path").attr("d", star(0.0, 0.0, 7.0)))
            .into()
    };
    let lab = |c: &'static str, t: &'static str| -> N { el("span").cls(c).attr("aria-hidden", "true").text(t).into() };
    el("span")
        .cls("pts bar-pts")
        .kid(tip("pt l", Tip::In))
        .kid(tip("pt r", Tip::Out))
        .kid(tip("pt t", Tip::Control))
        .kid(tip("pt b", Tip::Gate))
        .kid(lab("pl l", "in"))
        .kid(lab("pl r", "out"))
        .kid(lab("pl t", "control"))
        .kid(lab("pl b", "gate"))
        .into()
}

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
        Target::Tool(t) => tool_view(s, *t),
        _ => txt(""),
    };
    // the group as a small label over the title, not as a sentence under it (owner, 2026-10-15: "enhance the ui")
    el("div").kid(el("div").cls("head").kid(el("span").cls("eyebrow").text(GROUPS[gi].title)).kid(el("h1").text(*name))).kid(body).into()
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

// The whole project as one super's inside (pitechlab.sasm, `map`; brought up to date 2026-10-14): one prompt to
// every engine, the assessment from manuscript to ledger, the lab's own tools, and what it all runs on.
const MAP: [MapNode; 41] = [
    // one prompt, every engine
    mn("prompt", "Prompt", "in", 20.0, 120.0, 150.0, 64.0, "@Super AI", ""),
    mn("superai", "Super AI", "ai", 210.0, 128.0, 96.0, 48.0, "@Super AI", ""),
    mn("sim", "siM", "lab", 350.0, 20.0, 74.0, 40.0, "@Super AI", "SciM"),
    mn("rib", "riB", "lab", 350.0, 76.0, 74.0, 40.0, "@RiBD", "RiBD"),
    mn("pid", "piD", "lab", 350.0, 132.0, 74.0, 40.0, "@Performance", "forecast"),
    mn("pien", "PiEn", "lab", 350.0, 188.0, 74.0, 40.0, "@Performance", "next step"),
    mn("llama", "Llama", "out", 470.0, 8.0, 74.0, 40.0, "", ""),
    mn("mistral", "Mistral", "out", 470.0, 58.0, 74.0, 40.0, "", ""),
    mn("qwen", "Qwen", "out", 470.0, 108.0, 74.0, 40.0, "", ""),
    mn("gemini", "Gemini", "out", 470.0, 158.0, 74.0, 40.0, "", ""),
    mn("deepseek", "DeepSeek", "out", 470.0, 208.0, 74.0, 40.0, "", ""),
    mn("judge", "Judge", "judge", 600.0, 108.0, 74.0, 40.0, "", ""),
    mn("answer", "Answer", "sink", 720.0, 70.0, 160.0, 118.0, "@Super AI", ""),
    mn("live", "Live", "site", 906.0, 20.0, 74.0, 40.0, "#/live", ""),
    mn("traffic", "Analytics", "site", 906.0, 200.0, 74.0, 40.0, "@Analytics", ""),
    // the assessment
    mn("manuscript", "Manuscript", "in", 20.0, 330.0, 92.0, 46.0, "#/assess", ""),
    mn("extract", "Extract", "step", 132.0, 333.0, 88.0, 40.0, "@Architecture", "PDF → text"),
    mn("integrity", "Integrity", "step", 238.0, 333.0, 88.0, 40.0, "@Architecture", "MDAR · RRID"),
    mn("jurors", "Jurors", "step", 344.0, 333.0, 88.0, 40.0, "@Architecture", ""),
    mn("verdict", "Verdict", "judge", 450.0, 333.0, 88.0, 40.0, "@Architecture", "the judge"),
    mn("pix", "piX", "step", 556.0, 333.0, 88.0, 40.0, "@Whitepaper", ""),
    mn("piq", "piQ", "step", 662.0, 333.0, 88.0, 40.0, "#/library", ""),
    mn("ledger", "Ledger", "step", 768.0, 333.0, 88.0, 40.0, "@Proof-of-Research Ledger Explorer", ""),
    mn("explorer", "Explorer", "sink", 874.0, 333.0, 106.0, 40.0, "@Proof-of-Research Ledger Explorer", ""),
    // the lab: what runs here, in the browser
    mn("canvas", "Canvas", "lab", 20.0, 470.0, 104.0, 44.0, "#/", "supers · wires"),
    mn("program", "Program", "lab", 144.0, 470.0, 104.0, 44.0, "#/", "dataflow"),
    mn("learn", "SuperAI", "lab", 268.0, 470.0, 104.0, 44.0, "@Learn to program", "learn to program"),
    mn("hal", "HAL-OS", "lab", 392.0, 470.0, 104.0, 44.0, "@HAL-OS", "x86 · ternary net"),
    mn("quvi", "QuVI", "lab", 516.0, 470.0, 104.0, 44.0, "@QuVI", "quantum circuits"),
    mn("face", "Face Mace", "lab", 640.0, 470.0, 104.0, 44.0, "@Face Mace", "faces, sorted"),
    mn("map", "Map of Science", "lab", 764.0, 470.0, 104.0, 44.0, "@The Global Map of Science", "and its game"),
    mn("frenzy", "Neuro Frenzy", "lab", 888.0, 470.0, 92.0, 44.0, "@Neuro Frenzy", ""),
    // what it runs on
    mn("browser", "Browser", "in", 20.0, 610.0, 92.0, 44.0, "", ""),
    mn("host", "host.js", "step", 132.0, 612.0, 88.0, 40.0, "", "DOM · fetch"),
    mn("wasm", "ui.wasm", "ai", 240.0, 612.0, 110.0, 40.0, "", "Rust, no_std"),
    mn("api", "API", "step", 400.0, 612.0, 100.0, 40.0, "", "Python · FastAPI"),
    mn("db", "SQLite", "step", 540.0, 612.0, 88.0, 40.0, "", "corpus · piQ"),
    mn("chain", "Sepolia", "step", 668.0, 612.0, 88.0, 40.0, "@Proof-of-Research Ledger Explorer", "settlement"),
    mn("providers", "Model providers", "out", 796.0, 612.0, 110.0, 40.0, "", ""),
    mn("orcid", "ORCID", "out", 926.0, 612.0, 54.0, 40.0, "#/account", ""),
    mn("owner", "Owner", "sink", 926.0, 560.0, 54.0, 30.0, "@Owner console", ""),
];

const MAP_WIRES: [(&str, &str); 36] = [
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
    ("canvas", "program"),
    ("program", "learn"),
    ("learn", "hal"),
    ("browser", "host"),
    ("host", "wasm"),
    ("wasm", "api"),
    ("api", "db"),
    ("db", "chain"),
    ("chain", "providers"),
    ("wasm", "canvas"),
    ("orcid", "owner"),
];

const MAP_SECTIONS: [(&str, f64, f64, f64, f64); 5] = [
    ("one prompt, every engine", 14.0, 0.0, 972.0, 270.0),
    ("the assessment", 14.0, 300.0, 972.0, 110.0),
    ("the lab, in the browser", 14.0, 440.0, 972.0, 96.0),
    ("what it runs on", 14.0, 566.0, 972.0, 110.0),
    ("the site", 14.0, 706.0, 972.0, 80.0),
];

fn map_page() -> N {
    let find = |id: &str| MAP.iter().find(|n| n.id == id);
    let mut svg = el("svg:svg").cls("map").attr("viewBox", "0 -24 1000 824").attr("role", "img").attr("aria-label", "The project map");
    for (label, x, y, w, h) in MAP_SECTIONS {
        svg = svg
            .kid(el("svg:rect").cls("m-sec").attr("x", format!("{}", x)).attr("y", format!("{}", y)).attr("width", format!("{}", w)).attr("height", format!("{}", h)))
            .kid(el("svg:text").cls("m-sec-t").attr("x", format!("{}", x + 8.0)).attr("y", format!("{}", y - 6.0)).text(label));
    }
    for (a, b) in MAP_WIRES {
        let (Some(na), Some(nb)) = (find(a), find(b)) else { continue };
        // into the node's left edge, or its top/bottom when it sits above or below
        // across a row out of the right into the left; between rows out of the top or bottom, straight up or down
        let sec = |y: f64| MAP_SECTIONS.iter().position(|q| y >= q.2 && y <= q.2 + q.4).unwrap_or(0);
        let across = sec(na.y) != sec(nb.y);
        let (pa, sa, pb, sb) = if across && nb.y + nb.h < na.y {
            ((na.x + na.w / 2.0, na.y), Side::T, (nb.x + nb.w / 2.0, nb.y + nb.h), Side::B)
        } else if across && nb.y > na.y + na.h {
            ((na.x + na.w / 2.0, na.y + na.h), Side::B, (nb.x + nb.w / 2.0, nb.y), Side::T)
        } else {
            ((na.x + na.w, na.y + na.h / 2.0), Side::R, (nb.x, nb.y + nb.h / 2.0), Side::L)
        };
        let data = sb == Side::L;
        let d = if sa == Side::T || sa == Side::B {
            let my = (pa.1 + pb.1) / 2.0;
            format!("M{:.1} {:.1}C{:.1} {:.1} {:.1} {:.1} {:.1} {:.1}", pa.0, pa.1, pa.0, my, pb.0, my, pb.0, pb.1)
        } else {
            curve(pa, Side::R, pb, Side::L)
        };
        svg = svg.kid(el("svg:path").cls(if data { "w data" } else { "w" }).attr("d", d));
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
            .kid(el("svg:rect").attr("x", format!("{}", n.x)).attr("y", format!("{}", n.y)).attr("width", format!("{}", n.w)).attr("height", format!("{}", n.h)).attr("rx", format!("{:.0}", (n.h * 0.3).min(14.0))))
            .kid(el("svg:text").attr("x", format!("{}", n.x + n.w / 2.0)).attr("y", format!("{}", n.y + n.h / 2.0 + if n.note.is_empty() { 5.0 } else { -2.0 })).attr("text-anchor", "middle").text(n.label));
        if !n.note.is_empty() {
            gnode = gnode.kid(el("svg:text").cls("m-note").attr("x", format!("{}", n.x + n.w / 2.0)).attr("y", format!("{}", n.y + n.h / 2.0 + 13.0)).attr("text-anchor", "middle").text(n.note));
        }
        if !n.opens.is_empty() {
            // "@name" opens the group member of that name, wherever it is now kept
            let href = n.opens.strip_prefix('@').map(member_href).unwrap_or_else(|| n.opens.to_string());
            let a = el("svg:a").attr("href", href).cls("m-link");
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
                    .kid(el("svg:rect").attr("x", format!("{}", x)).attr("y", "726").attr("width", format!("{}", w)).attr("height", "40").attr("rx", "12"))
                    .kid(el("svg:text").attr("x", format!("{}", x + w / 2.0)).attr("y", "751").attr("text-anchor", "middle").text(g.title)),
            ),
        );
        x += w + 42.0;
    }
    el("div")
        .kid(head("Project", "The whole project as one super's inside: one prompt to every engine, the assessment from manuscript to ledger, the lab's tools in the browser, what it all runs on, and the site. Click a box to open it."))
        .kid(el("div").cls("map-wrap").kid(svg))
        .into()
}

/// The last press was a finger's.
fn touching() -> bool {
    host::call("ptr", "").as_deref() == Some("touch")
}
