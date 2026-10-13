//! ScholarPi: the state, what changes it, and the views.
//!
//! The page is a canvas of supers around the π mark (#/). Opening one (#/assess, #/explore[/papers|/authors|
//! /journal], #/live, #/library, #/account, #/paper/<hash>, #/confirm/<token>) makes it fill the canvas, and every
//! other super turns into an icon in the rail at the side (along the bottom on a phone); π in the rail goes back.
//! Every change goes through `update`, after which the whole view is built again and `Dom` patches the page.

use crate::dom::{Node, el, txt};
use crate::host;
use crate::json::{self, Value};
use crate::mem::Global;
use crate::sha256;
use crate::text::{bytes, clean_doi, date, fragment, num, plural, query, url_encode};
use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

type N = Node<Msg>;

#[derive(Clone, Copy, PartialEq)]
enum Page {
    Home,
    Group(u8),
    Item(u8, u8),
    Map,
    Live,
    Confirm,
    Assess,
    Explore,
    Library,
    Account,
    Paper,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Doi,
    Pdf,
    Find,
}

#[derive(Clone, Copy, PartialEq)]
enum Tab {
    Recent,
    Papers,
    Authors,
    Journal,
}

#[derive(Clone)]
enum Msg {
    Mode(Mode),
    Doi(String),
    Files(String),
    Unfile(usize),
    FindQ(String),
    Find,
    Topic(usize),
    Pick(usize),
    Assess,
    ClearRun,
    Q(String),
    Search,
    ConsentAll,
    ConsentMin,
    ConsentSave,
    ConsentToggle(usize),
    ConsentOpen,
    ConsentClose,
    SignIn,
    SignOut,
    Retry,
    Close(usize),
    GatePw(String),
    GateEnter,
    ConfirmName(String),
    ConfirmNote(String),
    ConfirmAnswer(bool),
    Print,
    PDown(u8, String),
    PMember(u8),
    Activate(u8),
}

impl crate::dom::Fill for Msg {
    fn fill(self, v: String) -> Self {
        match self {
            Msg::PDown(id, _) => Msg::PDown(id, v),
            m => m,
        }
    }
}

#[derive(Clone, PartialEq)]
enum Want {
    Session,
    Summary,
    Tab(Tab),
    Rubric,
    Emission,
    Trial,
    Topics,
    Find,
    Dossier(String),
    Mine,
    Piq,
    Challenge,
    Login,
    Stream,
    Visit,
    Live,
    Fair(String),
    Request(String),
    Answer,
    Gate,
    Item(u8, u8),
}

/// Something fetched: nothing yet, on its way, here, or failed.
#[derive(Default)]
struct Slot {
    data: Option<Value>,
    err: Option<String>,
    busy: bool,
}

impl Slot {
    fn needed(&self) -> bool {
        self.data.is_none() && !self.busy && self.err.is_none()
    }
    fn reset(&mut self) {
        *self = Slot::default();
    }
}

struct Pending {
    want: Want,
    buf: String,
    status: u32,
}

#[derive(Clone, Copy, PartialEq)]
enum Line {
    Live,
    Old,
    Fee,
    Reward,
    Err,
    Done,
}

struct State {
    page: Page,
    paper: String,
    tab: Tab,
    // privacy choices: count visits, help the model learn, send papers to outside AI models
    consent: Option<[bool; 3]>,
    draft: [bool; 3],
    consent_open: bool,
    // who you are
    token: String,
    orcid: String,
    wallet: String,
    name: String,
    session: Slot,
    piq: Slot,
    mine: Slot,
    login_err: Option<String>,
    // assess
    mode: Mode,
    doi: String,
    files: Vec<(u32, f64, String)>,
    find_q: String,
    found: Slot,
    topics: Slot,
    picked: Vec<usize>,
    running: bool,
    since: f64,
    challenge: Option<Value>,
    log: Vec<(Line, String)>,
    results: Vec<Value>,
    failed: Vec<Value>,
    tail: String,
    form_err: Option<String>,
    // explore
    q: String,
    summary: Slot,
    tabs: [Slot; 4],
    dossier: Slot,
    // library
    rubric: Slot,
    emission: Slot,
    trial: Slot,
    pending: BTreeMap<u32, Pending>,
    next_req: u32,
    ticking: bool,
    // the canvas: what is open, in the order it was opened (the page in use is one of them)
    open: Vec<(Page, String)>,
    live: Slot,
    fair: Slot,
    pi: String,
    pi_shown: usize,
    // a private deployment's password
    gate: bool,
    gate_pw: String,
    gate_err: Option<String>,
    // a permission request (/confirm/?t=…)
    ctoken: String,
    req: Slot,
    c_name: String,
    c_note: String,
    c_sent: Option<Value>,
    c_err: Option<String>,
    c_busy: bool,
    // the canvas: where supers were moved, the view, lock and chain, a drag under way
    offs: [(f64, f64); NSUP],
    pan: (f64, f64),
    locked: bool,
    chained: bool,
    dirty: bool,
    drag: Option<Drag>,
    pend_member: Option<u8>,
    item: Slot,
    item_key: (u8, u8),
}

static STATE: Global<Option<State>> = Global::new(None);
static DOM: Global<Option<crate::dom::Dom<Msg>>> = Global::new(None);

const T_POW: u32 = 1;
const T_TICK: u32 = 2;
const T_PI: u32 = 3;
const T_LIVE: u32 = 4;

fn st() -> &'static mut State {
    STATE.get().as_mut().expect("started")
}

// ------------------------------------------------------------------------------------------------- start and events

pub fn start() {
    let head = host::head();
    let style = host::create_el("style");
    let css = host::create_text(crate::style::CSS);
    host::append_child(style, css);
    host::append_child(head, style);
    let shape = host::create_el("style");
    let rule = crate::style::shape_css();
    let rule_node = host::create_text(&rule);
    host::append_child(shape, rule_node);
    host::append_child(head, shape);
    let meta = host::create_el("meta");
    host::set_attr(meta, "name", "theme-color");
    host::set_attr(meta, "content", "#f7f5ef");
    host::append_child(head, meta);
    let root = host::create_el("div");
    host::append_child(host::body(), root);
    *DOM.get() = Some(crate::dom::Dom::new(root));

    let consent = read_consent();
    let mut s = State {
        page: Page::Home,
        paper: String::new(),
        tab: Tab::Recent,
        consent,
        draft: consent.unwrap_or([true, true, true]),
        consent_open: consent.is_none(),
        token: String::new(),
        orcid: String::new(),
        wallet: String::new(),
        name: String::new(),
        session: Slot::default(),
        piq: Slot::default(),
        mine: Slot::default(),
        login_err: None,
        mode: Mode::Doi,
        doi: String::new(),
        files: Vec::new(),
        find_q: String::new(),
        found: Slot::default(),
        topics: Slot::default(),
        picked: Vec::new(),
        running: false,
        since: 0.0,
        challenge: None,
        log: Vec::new(),
        results: Vec::new(),
        failed: Vec::new(),
        tail: String::new(),
        form_err: None,
        q: String::new(),
        summary: Slot::default(),
        tabs: Default::default(),
        dossier: Slot::default(),
        rubric: Slot::default(),
        emission: Slot::default(),
        trial: Slot::default(),
        pending: BTreeMap::new(),
        next_req: 1,
        ticking: false,
        open: Vec::new(),
        live: Slot::default(),
        fair: Slot::default(),
        pi: crate::pi::digits(400),
        pi_shown: 2,
        gate: false,
        gate_pw: String::new(),
        gate_err: None,
        ctoken: String::new(),
        req: Slot::default(),
        c_name: String::new(),
        c_note: String::new(),
        c_sent: None,
        c_err: None,
        c_busy: false,
        offs: [(0.0, 0.0); NSUP],
        pan: (0.0, 0.0),
        locked: true,
        chained: true,
        dirty: false,
        drag: None,
        pend_member: None,
        item: Slot::default(),
        item_key: (255, 255),
    };

    // Coming back from ORCID: the callback sends ?orcid=…&orcid_name=…&token=… (or ?orcid_error=…).
    let href = host::href();
    let params = query(&href);
    let p = |k: &str| params.iter().find(|(a, _)| a == k).map(|(_, b)| b.clone());
    if let Some(e) = p("orcid_error") {
        s.login_err = Some(e);
        s.page = Page::Account;
    }
    if let (Some(orcid), Some(token)) = (p("orcid"), p("token")) {
        host::store_set("sp_orcid", &orcid);
        host::store_set("sp_token", &token);
        if let Some(n) = p("orcid_name") {
            host::store_set("sp_researcher_name", &n);
        }
        if let Some(w) = p("wallet") {
            host::store_set("sp_wallet", &w);
        }
    }
    let mut confirm_to: Option<String> = None;
    if href.split(['?', '#']).next().unwrap_or("").contains("/confirm") {
        confirm_to = p("t");
    }
    if !params.is_empty() || confirm_to.is_some() {
        let path = href.split(['?', '#']).next().unwrap_or("").to_string();
        let path = path.splitn(4, '/').nth(3).map(|x| format!("/{}", x)).unwrap_or_else(|| "/".to_string());
        let path = if path.starts_with("/confirm") { "/".to_string() } else { path };
        let frag = match &confirm_to {
            Some(t) => format!("/confirm/{}", url_encode(t)),
            None => fragment(&href).to_string(),
        };
        host::replace_url(&if frag.is_empty() { path } else { format!("{}#{}", path, frag) });
    }
    s.token = host::store_get("sp_token").unwrap_or_default();
    s.orcid = host::store_get("sp_orcid").unwrap_or_default();
    s.wallet = host::store_get("sp_wallet").unwrap_or_default();
    s.name = host::store_get("sp_researcher_name").unwrap_or_default();
    *STATE.get() = Some(s);
    layout_load();

    route();
    let s = st();
    if s.login_err.is_some() {
        s.page = Page::Account;
        open_win(Page::Account, "");
    }
    host::timer(400, T_PI);
    request(Want::Session, "GET", "/api/auth/session", "", 0);
    request(Want::Emission, "GET", "/api/emission", "", 0);
    request(Want::Trial, "GET", "/api/trial/status", "", 0);
    if st().consent.map(|c| c[0]).unwrap_or(false) {
        request(Want::Visit, "POST", "/api/visit", "", 0);
    }
    load();
    render();
}

pub fn on_event(id: u32, kind: &str, value: String) {
    let msg = match DOM.get().as_ref().and_then(|d| d.dispatch(id, kind, value)) {
        Some(m) => m,
        None => return,
    };
    update(msg);
    render();
}

pub fn on_nav() {
    route();
    load();
    host::scroll_top();
    render();
}

pub fn on_timer(token: u32) {
    let s = st();
    match token {
        T_POW => {
            let Some(c) = s.challenge.take() else { return };
            let challenge = c.get("challenge").str().to_string();
            let difficulty = c.get("difficulty").f() as u32;
            match sha256::solve(&challenge, difficulty, 200_000_000) {
                Some(nonce) => submit(Some((&c, nonce))),
                None => fail_run("The proof of work could not be solved. Try again."),
            }
        }
        T_TICK => {
            s.ticking = false;
            if s.running {
                tick();
            }
        }
        T_PI => {
            if s.pi_shown < 120 {
                s.pi_shown += 1;
                host::timer(if s.pi_shown < 12 { 160 } else { 90 }, T_PI);
            }
        }
        T_LIVE => {
            if matches!(s.page, Page::Home | Page::Live) && !s.live.busy {
                s.live.busy = true;
                request(Want::Live, "GET", "/api/live", "", 0);
            }
            host::timer(30000, T_LIVE);
        }
        _ => {}
    }
    render();
}

fn tick() {
    let s = st();
    if !s.ticking {
        s.ticking = true;
        host::timer(1000, T_TICK);
    }
}

fn render() {
    let view = view(st());
    if let Some(d) = DOM.get().as_mut() {
        d.render(view);
    }
    let s = st();
    let t = match s.page {
        Page::Home => "piii lab",
        Page::Group(_) | Page::Item(_, _) => "piii lab",
        Page::Map => "piii lab · Project",
        Page::Live => "ScholarPi · Live",
        Page::Confirm => "ScholarPi · Permission request",
        Page::Assess => "ScholarPi · Assess a manuscript",
        Page::Explore => "ScholarPi · Explore",
        Page::Library => "ScholarPi · Library",
        Page::Account => "ScholarPi · Account",
        Page::Paper => "ScholarPi · Dossier",
    };
    host::set_title(t);
}

fn route() {
    let href = host::href();
    let frag = fragment(&href).trim_start_matches('/').to_string();
    let mut parts = frag.split('/');
    let s = st();
    match parts.next().unwrap_or("") {
        "" => s.page = Page::Home,
        "map" => s.page = Page::Map,
        "g" => {
            let g: u8 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            s.page = if (g as usize) < GROUPS.len() { Page::Group(g) } else { Page::Home };
        }
        "i" => {
            let g: u8 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(255);
            let m: u8 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(255);
            if GROUPS.get(g as usize).map(|x| (m as usize) < x.members.len()).unwrap_or(false) {
                if s.item_key != (g, m) {
                    s.item.reset();
                    s.item_key = (g, m);
                }
                s.page = Page::Item(g, m);
            } else {
                s.page = Page::Home;
            }
        }
        "live" => s.page = Page::Live,
        "confirm" => {
            let t = crate::text::url_decode(parts.next().unwrap_or(""));
            if t != s.ctoken {
                s.req.reset();
                s.c_sent = None;
                s.c_err = None;
            }
            s.ctoken = t;
            s.page = Page::Confirm;
        }
        "explore" => {
            s.page = Page::Explore;
            s.tab = match parts.next().unwrap_or("") {
                "papers" => Tab::Papers,
                "authors" => Tab::Authors,
                "journal" => Tab::Journal,
                _ => Tab::Recent,
            };
        }
        "library" => s.page = Page::Library,
        "account" => s.page = Page::Account,
        "paper" => {
            let h = parts.next().unwrap_or("").to_string();
            if h != s.paper {
                s.dossier.reset();
                s.fair.reset();
            }
            s.paper = h;
            s.page = Page::Paper;
        }
        _ => s.page = Page::Assess,
    }
    let arg = match s.page {
        Page::Paper => s.paper.clone(),
        Page::Confirm => s.ctoken.clone(),
        _ => String::new(),
    };
    if s.page != Page::Home {
        open_win(s.page, &arg);
    }
}

/// Puts a window among the open ones (a few papers at most: the oldest goes first).
fn open_win(page: Page, arg: &str) {
    let s = st();
    if s.open.iter().any(|(p, a)| *p == page && a == arg) {
        return;
    }
    if page == Page::Paper && s.open.iter().filter(|(p, _)| *p == Page::Paper).count() >= 4 {
        if let Some(i) = s.open.iter().position(|(p, _)| *p == Page::Paper) {
            s.open.remove(i);
        }
    }
    s.open.push((page, arg.to_string()));
}

fn hash_of(page: Page, arg: &str) -> String {
    match page {
        Page::Home => "#/".to_string(),
        Page::Group(g) => format!("#/g/{}", g),
        Page::Item(g, m) => format!("#/i/{}/{}", g, m),
        Page::Map => "#/map".to_string(),
        Page::Live => "#/live".to_string(),
        Page::Confirm => format!("#/confirm/{}", url_encode(arg)),
        Page::Assess => "#/assess".to_string(),
        Page::Explore => "#/explore".to_string(),
        Page::Library => "#/library".to_string(),
        Page::Account => "#/account".to_string(),
        Page::Paper => format!("#/paper/{}", arg),
    }
}

/// Fetches what the current page shows and does not have yet.
fn load() {
    let s = st();
    if s.gate {
        return;
    }
    match s.page {
        Page::Home | Page::Live => {
            if s.live.needed() {
                s.live.busy = true;
                request(Want::Live, "GET", "/api/live", "", 0);
                host::timer(30000, T_LIVE);
            }
            if s.page == Page::Home && s.summary.needed() {
                s.summary.busy = true;
                request(Want::Summary, "GET", "/api/analytics/summary", "", 0);
            }
        }
        Page::Group(_) | Page::Map => {}
        Page::Item(g, m) => {
            if let Some((_, Target::Data(url, _))) = GROUPS.get(g as usize).and_then(|x| x.members.get(m as usize)) {
                if s.item.needed() {
                    s.item.busy = true;
                    let u = if *url == "/api/profile" || *url == "/api/assessments/claimable" {
                        format!("{}?{}", url, ident_query(s))
                    } else {
                        url.to_string()
                    };
                    request(Want::Item(g, m), "GET", &u, "", 0);
                }
            }
        }
        Page::Confirm => {
            if s.req.needed() && !s.ctoken.is_empty() {
                s.req.busy = true;
                request(Want::Request(s.ctoken.clone()), "GET", &format!("/api/consent/r/{}", url_encode(&s.ctoken)), "", 0);
            }
        }
        Page::Assess => {
            if s.mode == Mode::Find && s.topics.needed() {
                s.topics.busy = true;
                request(Want::Topics, "GET", "/api/discover/hot-topics", "", 0);
            }
        }
        Page::Explore => {
            if s.summary.needed() {
                s.summary.busy = true;
                request(Want::Summary, "GET", "/api/analytics/summary", "", 0);
            }
            let t = s.tab;
            if s.tabs[t as usize].needed() {
                load_tab(t);
            }
        }
        Page::Library => {
            if s.rubric.needed() {
                s.rubric.busy = true;
                request(Want::Rubric, "GET", "/api/rubric", "", 0);
            }
        }
        Page::Account => {
            if signed_in(s) {
                if s.piq.needed() {
                    s.piq.busy = true;
                    let u = format!("/api/user/piq-total?{}", ident_query(s));
                    request(Want::Piq, "GET", &u, "", 0);
                }
                if s.mine.needed() {
                    s.mine.busy = true;
                    let u = format!("/api/assessments/mine?limit=100&{}", ident_query(s));
                    request(Want::Mine, "GET", &u, "", 0);
                }
            }
        }
        Page::Paper => {
            if s.dossier.needed() && !s.paper.is_empty() {
                s.dossier.busy = true;
                let u = format!("/api/explorer/dossier/{}", url_encode(&s.paper));
                request(Want::Dossier(s.paper.clone()), "GET", &u, "", 0);
            }

        }
    }
}

fn load_tab(t: Tab) {
    let s = st();
    let q = url_encode(s.q.trim());
    let u = match t {
        Tab::Recent if !q.is_empty() => format!("/api/explorer/search?q={}", q),
        Tab::Recent => "/api/explorer/latest?limit=60&sort=date&order=desc".to_string(),
        Tab::Papers => format!("/api/analytics/top-papers?limit=60&sort=score&order=desc&q={}", q),
        Tab::Authors => format!("/api/analytics/leaderboard?limit=60&sort=piq&order=desc&q={}", q),
        Tab::Journal => "/api/journal?limit=120&kind=all".to_string(),
    };
    s.tabs[t as usize].reset();
    s.tabs[t as usize].busy = true;
    request(Want::Tab(t), "GET", &u, "", 0);
}

fn ident_query(s: &State) -> String {
    format!("wallet={}&orcid={}", url_encode(&s.wallet), url_encode(&s.orcid))
}

fn signed_in(s: &State) -> bool {
    !s.token.is_empty() && (!s.orcid.is_empty() || !s.wallet.is_empty())
}

// ------------------------------------------------------------------------------------------------- the network

fn request(want: Want, method: &str, url: &str, body: &str, form: u32) {
    let s = st();
    let id = s.next_req;
    s.next_req += 1;
    s.pending.insert(id, Pending { want, buf: String::new(), status: 0 });
    host::fetch(id, method, url, body, form);
}

pub fn on_fetch(req: u32, status: u32, chunk: String, done: bool) {
    let s = st();
    let Some(p) = s.pending.get_mut(&req) else { return };
    p.status = status;
    if p.want == Want::Stream && status == 200 {
        stream_chunk(&chunk, done);
        if done {
            s.pending.remove(&req);
            end_run();
        }
        render();
        return;
    }
    p.buf.push_str(&chunk);
    if !done {
        return;
    }
    let p = s.pending.remove(&req).unwrap();
    let parsed = json::parse(&p.buf);
    let ok = (200..300).contains(&p.status);
    let err = if ok && parsed.is_some() {
        None
    } else if p.status == 0 {
        Some("The connection failed. Check your network and try again.".to_string())
    } else {
        Some(error_text(p.status, parsed.as_ref()))
    };
    if p.status == 401 && p.want != Want::Gate && err.as_deref() == Some("This deployment is private.") {
        s.gate = true;
        render();
        return;
    }
    if p.want == Want::Gate {
        if p.status == 204 || p.status == 200 {
            host::go("/");
        } else {
            st().gate_err = Some("That is not it.".to_string());
        }
        render();
        return;
    }
    apply(p.want, parsed.unwrap_or(Value::Null), err);
    render();
}

fn error_text(status: u32, v: Option<&Value>) -> String {
    let detail = v.map(|v| v.get("detail")).unwrap_or(&json::NULL);
    let d = match detail {
        Value::Str(s) => s.clone(),
        Value::Arr(a) => a.iter().map(|x| x.get("msg").str().to_string()).collect::<Vec<_>>().join("; "),
        Value::Obj(_) => detail.any(&["message", "reason"]).str().to_string(),
        _ => String::new(),
    };
    if d.is_empty() { format!("The server answered {}.", status) } else { d }
}

fn put(slot: &mut Slot, v: Value, err: Option<String>) {
    slot.busy = false;
    match err {
        Some(e) => slot.err = Some(e),
        None => slot.data = Some(v),
    }
}

fn apply(want: Want, v: Value, err: Option<String>) {
    let s = st();
    match want {
        Want::Session => {
            if err.is_none() && v.get("verified").truthy() {
                let o = v.get("orcid").str();
                let w = v.get("wallet").str();
                if !o.is_empty() {
                    s.orcid = o.to_string();
                }
                if !w.is_empty() {
                    s.wallet = w.to_string();
                }
            } else if err.is_none() && !s.token.is_empty() && !v.get("verified").truthy() && v.get("sessions_enabled").truthy() {
                // The session expired: the token proves nothing any more.
                s.token.clear();
                host::store_del("sp_token");
            }
            put(&mut s.session, v, err);
        }
        Want::Summary => put(&mut s.summary, v, err),
        Want::Tab(t) => put(&mut s.tabs[t as usize], v, err),
        Want::Rubric => put(&mut s.rubric, v, err),
        Want::Emission => put(&mut s.emission, v, err),
        Want::Trial => put(&mut s.trial, v, err),
        Want::Topics => put(&mut s.topics, v, err),
        Want::Find => {
            s.picked.clear();
            let e = if err.is_none() && !v.get("error").str().is_empty() && v.get("results").arr().is_empty() {
                Some(v.get("error").str().to_string())
            } else {
                err
            };
            put(&mut s.found, v, e);
        }
        Want::Dossier(h) => {
            if h == s.paper {
                put(&mut s.dossier, v, err);
            }
        }
        Want::Mine => put(&mut s.mine, v, err),
        Want::Piq => put(&mut s.piq, v, err),
        Want::Login => match err {
            Some(e) => s.login_err = Some(e),
            None => {
                let u = v.get("url").str();
                if u.is_empty() {
                    s.login_err = Some("ORCID sign-in is not available right now.".to_string());
                } else {
                    host::go(u);
                }
            }
        },
        Want::Challenge => match err {
            Some(e) => fail_run(&e),
            None => {
                if v.get("required").truthy() {
                    s.challenge = Some(v);
                    s.log.push((Line::Live, "Solving a short proof of work in your browser…".to_string()));
                    s.since = host::now();
                    host::timer(40, T_POW);
                } else {
                    submit(None);
                }
            }
        },
        Want::Stream => {
            // Refused before it began (402 balance, 403 privacy choice, 428 verification, 429 too many).
            fail_run(&err.unwrap_or_else(|| "The assessment could not start.".to_string()));
        }
        Want::Visit => {}
        Want::Live => put(&mut s.live, v, err),
        Want::Fair(h) => {
            if h == s.paper {
                put(&mut s.fair, v, err);
            }
        }
        Want::Request(t) => {
            if t == s.ctoken {
                put(&mut s.req, v, err);
            }
        }
        Want::Answer => {
            s.c_busy = false;
            match err {
                Some(e) => s.c_err = Some(e),
                None => s.c_sent = Some(v),
            }
        }
        Want::Gate => {}
        Want::Item(g, m) => {
            if s.item_key == (g, m) {
                put(&mut s.item, v, err);
            }
        }
    }
}

// ------------------------------------------------------------------------------------------------- assessing

fn begin_assessment() {
    let s = st();
    if s.running {
        return;
    }
    s.form_err = None;
    let ready = match s.mode {
        Mode::Doi => {
            let d = clean_doi(&s.doi);
            d.starts_with("10.") && d.contains('/')
        }
        Mode::Pdf => !s.files.is_empty(),
        Mode::Find => !s.picked.is_empty(),
    };
    if !ready {
        s.form_err = Some(
            match s.mode {
                Mode::Doi => "Enter a DOI: it starts with 10. and has a slash, like 10.1038/s41586-020-2649-2.",
                Mode::Pdf => "Choose at least one PDF.",
                Mode::Find => "Select at least one paper from the search results.",
            }
            .to_string(),
        );
        return;
    }
    if !s.consent.map(|c| c[2]).unwrap_or(false) {
        s.consent_open = true;
        s.draft[2] = true;
        s.form_err = Some(
            "Assessing a paper sends its text to outside AI models. Allow that in your privacy choices to continue."
                .to_string(),
        );
        return;
    }
    s.running = true;
    s.log.clear();
    s.failed.clear();
    s.tail.clear();
    s.since = host::now();
    tick();
    if s.orcid.is_empty() && s.wallet.is_empty() {
        s.log.push((Line::Live, "Preparing the submission…".to_string()));
        request(Want::Challenge, "GET", "/api/challenge", "", 0);
    } else {
        submit(None);
    }
}

fn submit(pow: Option<(&Value, u64)>) {
    let s = st();
    let f = host::form_new();
    match s.mode {
        Mode::Doi => {
            host::form_str(f, "doi", &clean_doi(&s.doi));
            host::form_str(f, "include_doi", "true");
        }
        Mode::Pdf => {
            for (h, _, _) in &s.files {
                host::form_file(f, "files", *h);
            }
        }
        Mode::Find => {
            let results = s.found.data.as_ref().map(|d| d.get("results").arr()).unwrap_or(&[]);
            let mut out = String::from("[");
            for (i, k) in s.picked.iter().enumerate() {
                if let Some(r) = results.get(*k) {
                    if i > 0 {
                        out.push(',');
                    }
                    json::write(r, &mut out);
                }
            }
            out.push(']');
            host::form_str(f, "discover_papers", &out);
        }
    }
    host::form_str(f, "wallet", &s.wallet);
    host::form_str(f, "orcid", &s.orcid);
    if let Some((c, nonce)) = pow {
        host::form_str(f, "pow_challenge_id", c.get("challenge").str());
        host::form_str(f, "pow_issued_at", &c.get("issued_at").text());
        host::form_str(f, "pow_difficulty", &c.get("difficulty").text());
        host::form_str(f, "pow_signature", c.get("signature").str());
        host::form_str(f, "pow_solution", &nonce.to_string());
    }
    request(Want::Stream, "POST", "/api/assess/stream", "", f);
}

fn settle_live(s: &mut State) {
    for (k, _) in s.log.iter_mut() {
        if *k == Line::Live {
            *k = Line::Old;
        }
    }
}

fn fail_run(msg: &str) {
    let s = st();
    settle_live(s);
    s.log.push((Line::Err, msg.to_string()));
    s.running = false;
}

fn end_run() {
    let s = st();
    if !s.tail.trim().is_empty() {
        let line = core::mem::take(&mut s.tail);
        stream_line(&line);
    }
    settle_live(s);
    s.running = false;
    // A finished run changes the corpus: the lists, the totals, your balance and history.
    s.summary.reset();
    for t in s.tabs.iter_mut() {
        t.reset();
    }
    s.piq.reset();
    s.mine.reset();
    request(Want::Trial, "GET", "/api/trial/status", "", 0);
    request(Want::Emission, "GET", "/api/emission", "", 0);
}

fn stream_chunk(chunk: &str, done: bool) {
    let s = st();
    s.tail.push_str(chunk);
    while let Some(i) = s.tail.find('\n') {
        let line: String = s.tail[..i].to_string();
        s.tail.drain(..=i);
        stream_line(&line);
    }
    if done && s.tail.trim().is_empty() {
        s.tail.clear();
    }
}

fn stream_line(line: &str) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }
    let Some(v) = json::parse(line) else { return };
    let s = st();
    let msg = v.get("message").str().to_string();
    match v.get("type").str() {
        "status" => {
            settle_live(s);
            s.since = host::now();
            s.log.push((Line::Live, msg));
        }
        "heartbeat" => {}
        "fee" => s.log.push((Line::Fee, msg)),
        "fee_error" | "result_error" => {
            let label = v.get("label").str();
            s.log.push((Line::Err, if label.is_empty() { msg } else { format!("{}: {}", label, msg) }))
        }
        "reward" => {
            if v.get("outcome").str() == "minted" {
                s.log.push((Line::Reward, format!("+{} piQ minted. {}", num(v.get("amount").f(), 2), msg)));
            } else {
                let fix = v.get("how_to_fix").str();
                s.log.push((Line::Fee, format!("No piQ for this paper. {}{}{}", msg, if fix.is_empty() { "" } else { " " }, fix)));
            }
        }
        "curation" => {
            if v.get("awarded").truthy() && v.get("amount").f() > 0.0 {
                s.log.push((Line::Reward, format!("+{} piQ curation reward. {}", num(v.get("amount").f(), 4), msg)));
            } else {
                s.log.push((Line::Fee, format!("No curation reward. {}", msg)));
            }
        }
        "result" => {
            let item = v.get("item").clone();
            s.results.insert(0, item);
        }
        "download_error" => {
            s.log.push((Line::Err, format!("Could not get the paper for {}.", v.any(&["title", "doi"]).str())));
            s.failed.insert(0, v);
        }
        "stream_error" => s.log.push((Line::Err, format!("The assessment stopped unexpectedly. {}", msg))),
        "done" => {
            settle_live(s);
            s.log.push((Line::Done, if msg.is_empty() { "Complete.".to_string() } else { msg }));
        }
        _ => {}
    }
}

// ------------------------------------------------------------------------------------------------- update

fn update(msg: Msg) {
    let s = st();
    match msg {
        Msg::Mode(m) => {
            s.mode = m;
            s.form_err = None;
            load();
        }
        Msg::Doi(v) => s.doi = v,
        Msg::Files(v) => {
            for line in v.lines() {
                let mut it = line.splitn(3, '\t');
                let (Some(h), Some(sz), Some(name)) = (it.next(), it.next(), it.next()) else { continue };
                let h: u32 = h.parse().unwrap_or(0);
                if h == 0 {
                    continue;
                }
                if !name.to_ascii_lowercase().ends_with(".pdf") {
                    s.form_err = Some(format!("{} is not a PDF.", name));
                    continue;
                }
                s.files.push((h, sz.parse().unwrap_or(0.0), name.to_string()));
            }
        }
        Msg::Unfile(i) => {
            if i < s.files.len() {
                s.files.remove(i);
            }
        }
        Msg::FindQ(v) => s.find_q = v,
        Msg::Find => {
            let q = s.find_q.trim().to_string();
            if q.chars().count() >= 2 {
                s.found.reset();
                s.found.busy = true;
                request(Want::Find, "GET", &format!("/api/discover/search?limit=15&q={}", url_encode(&q)), "", 0);
            }
        }
        Msg::Topic(i) => {
            let t = s.topics.data.as_ref().and_then(|d| d.get("topics").arr().get(i)).map(|t| t.str().to_string());
            if let Some(t) = t {
                s.find_q = t;
                update(Msg::Find);
            }
        }
        Msg::Pick(i) => {
            if let Some(p) = s.picked.iter().position(|x| *x == i) {
                s.picked.remove(p);
            } else if s.picked.len() < 10 {
                s.picked.push(i);
            }
        }
        Msg::Assess => begin_assessment(),
        Msg::ClearRun => {
            s.log.clear();
            s.results.clear();
            s.failed.clear();
        }
        Msg::Q(v) => s.q = v,
        Msg::Search => load_tab(s.tab),
        Msg::ConsentAll => save_consent([true, true, true]),
        Msg::ConsentMin => save_consent([false, false, false]),
        Msg::ConsentSave => save_consent(s.draft),
        Msg::ConsentToggle(i) => s.draft[i] = !s.draft[i],
        Msg::ConsentOpen => {
            s.draft = s.consent.unwrap_or([true, true, true]);
            s.consent_open = true;
        }
        Msg::ConsentClose => s.consent_open = s.consent.is_none(),
        Msg::SignIn => {
            s.login_err = None;
            request(Want::Login, "GET", &format!("/api/auth/orcid/login-url?wallet={}", url_encode(&s.wallet)), "", 0);
        }
        Msg::SignOut => {
            for k in ["sp_token", "sp_orcid", "sp_wallet", "sp_researcher_name"] {
                host::store_del(k);
            }
            s.token.clear();
            s.orcid.clear();
            s.wallet.clear();
            s.name.clear();
            s.piq.reset();
            s.mine.reset();
            request(Want::Session, "GET", "/api/auth/session", "", 0);
        }
        Msg::Close(i) => {
            if i < s.open.len() {
                let (page, arg) = s.open.remove(i);
                let current = page == s.page
                    && match page {
                        Page::Paper => arg == s.paper,
                        Page::Confirm => arg == s.ctoken,
                        _ => true,
                    };
                if current {
                    let to = s.open.last().map(|(p, a)| hash_of(*p, a)).unwrap_or_else(|| "#/".to_string());
                    host::go(&to);
                }
            }
        }
        Msg::GatePw(v) => s.gate_pw = v,
        Msg::GateEnter => {
            s.gate_err = None;
            let body = format!("{{\"password\":{}}}", json::quote(&s.gate_pw));
            request(Want::Gate, "POST", "/api/gate", &body, 0);
        }
        Msg::ConfirmName(v) => s.c_name = v,
        Msg::ConfirmNote(v) => s.c_note = v,
        Msg::ConfirmAnswer(yes) => {
            s.c_err = None;
            if s.c_name.trim().chars().count() < 2 {
                s.c_err = Some("Write your name: it records who answered.".to_string());
            } else if !s.c_busy {
                s.c_busy = true;
                let body = format!(
                    "{{\"decision\":\"{}\",\"name\":{},\"note\":{}}}",
                    if yes { "granted" } else { "declined" },
                    json::quote(s.c_name.trim()),
                    json::quote(s.c_note.trim())
                );
                request(Want::Answer, "POST", &format!("/api/consent/r/{}", url_encode(&s.ctoken)), &body, 0);
            }
        }
        Msg::Print => host::print(),
        Msg::PDown(id, xy) => begin_drag(id as usize, &xy),
        Msg::PMember(m) => s.pend_member = Some(m),
        Msg::Activate(id) => activate(id as usize, None),
        Msg::Retry => {
            for slot in [&mut s.summary, &mut s.rubric, &mut s.dossier, &mut s.piq, &mut s.mine, &mut s.topics, &mut s.live, &mut s.req, &mut s.item] {
                if slot.err.is_some() {
                    slot.reset();
                }
            }
            let t = s.tab as usize;
            if s.tabs[t].err.is_some() {
                s.tabs[t].reset();
            }
            load();
        }
    }
}

fn read_consent() -> Option<[bool; 3]> {
    let c = host::cookie();
    let v = c.split(';').map(|p| p.trim()).find_map(|p| p.strip_prefix("pi_consent="))?;
    let mut out = [false; 3];
    let mut seen = 0;
    for part in v.split('.') {
        let (k, on) = (part.get(..1)?, part.get(1..) == Some("1"));
        match k {
            "c" => out[0] = on,
            "l" => out[1] = on,
            "e" => out[2] = on,
            _ => continue,
        }
        seen += 1;
    }
    if v.starts_with("v1") && seen == 3 { Some(out) } else { None }
}

fn save_consent(c: [bool; 3]) {
    let s = st();
    let first = s.consent.is_none();
    let b = |x: bool| if x { 1 } else { 0 };
    let secure = if host::href().starts_with("https:") { "; Secure" } else { "" };
    host::set_cookie(&format!(
        "pi_consent=v1.c{}.l{}.e{}; Max-Age=31536000; Path=/; SameSite=Lax{}",
        b(c[0]),
        b(c[1]),
        b(c[2]),
        secure
    ));
    s.consent = Some(c);
    s.draft = c;
    s.consent_open = false;
    if first && c[0] {
        request(Want::Visit, "POST", "/api/visit", "", 0);
    }
    if c[2] && s.form_err.as_deref().map(|e| e.starts_with("Assessing a paper sends")).unwrap_or(false) {
        s.form_err = None;
    }
}

// ------------------------------------------------------------------------------------------------- views

fn view(s: &State) -> N {
    if s.gate {
        return gate_view(s);
    }
    let body: N = if s.page == Page::Home {
        canvas_view(s)
    } else {
        let page = match s.page {
            Page::Assess => assess_page(s),
            Page::Explore => explore_page(s),
            Page::Library => library_page(s),
            Page::Account => account_page(s),
            Page::Paper => paper_page(s),
            Page::Live => live_page(s),
            Page::Confirm => confirm_page(s),
            Page::Group(g) => group_page(g as usize),
            Page::Item(g, m) => item_page(s, g as usize, m as usize),
            Page::Map => map_page(),
            Page::Home => txt(""),
        };
        el("div").cls("focus").kid(rail(s)).kid(window_frame(s, page)).into()
    };
    el("div").cls("app").kid(body).kid_if(s.consent_open, || consent_panel(s)).into()
}


fn super_name(s: &State, page: Page, arg: &str) -> String {
    match page {
        Page::Home => "Everything".to_string(),
        Page::Assess => "Assess".to_string(),
        Page::Explore => "Explore".to_string(),
        Page::Live => "Live".to_string(),
        Page::Library => "Library".to_string(),
        Page::Account => {
            if signed_in(s) && !s.name.is_empty() {
                s.name.clone()
            } else if signed_in(s) {
                "Account".to_string()
            } else {
                "Sign in".to_string()
            }
        }
        Page::Paper => {
            let t = if arg == s.paper {
                s.dossier.data.as_ref().map(|d| d.get("title").str().to_string()).unwrap_or_default()
            } else {
                String::new()
            };
            if t.is_empty() { "A paper".to_string() } else { t }
        }
        Page::Confirm => "Permission request".to_string(),
        Page::Group(g) => GROUPS.get(g as usize).map(|x| x.title).unwrap_or("").to_string(),
        Page::Item(g, m) => GROUPS.get(g as usize).and_then(|x| x.members.get(m as usize)).map(|x| x.0).unwrap_or("").to_string(),
        Page::Map => "Project".to_string(),
    }
}

/// An icon: two letters for a name (one word: its first two; more: their initials).
fn glyph(name: &str) -> String {
    let words: Vec<&str> = name.split([' ', ':', '-', '/']).filter(|w| w.chars().any(|c| c.is_alphanumeric())).collect();
    match words.len() {
        0 => "·".to_string(),
        1 => {
            let mut c = words[0].chars();
            let a = c.next().map(|x| x.to_uppercase().to_string()).unwrap_or_default();
            let b = c.next().map(|x| x.to_lowercase().to_string()).unwrap_or_default();
            format!("{}{}", a, b)
        }
        _ => words.iter().take(2).filter_map(|w| w.chars().next()).flat_map(|c| c.to_uppercase()).collect(),
    }
}

fn is_current(s: &State, page: Page, arg: &str) -> bool {
    page == s.page
        && match page {
            Page::Paper => arg == s.paper,
            Page::Confirm => arg == s.ctoken,
            _ => true,
        }
}

/// A super's icon: a line drawing for each kind; a paper shows its title's initials, so several can be told apart.
fn mark_of(page: Page, name: &str) -> N {
    let d: &[&str] = match page {
        Page::Home => return txt("π"),
        Page::Paper | Page::Item(_, _) => return txt(glyph(name)),
        Page::Group(g) => match GROUPS.get(g as usize).map(|x| x.sup).unwrap_or(0) {
            S_TOOLS => &["M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"],
            S_EXPLORE => &["M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z", "M20 20l-4.8-4.8"],
            S_LIBRARY => &["M4 4h5v16H4z", "M9 4h5v16H9z", "M14.5 6.2l4.3-1.2 3.4 13.5-4.3 1.2z"],
            S_LAB => &["M9 3h6", "M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3", "M7 15h10"],
            _ => &["M12 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8z", "M4 21c1.6-4 4.6-6 8-6s6.4 2 8 6"],
        },
        Page::Map => &["M4 5h5v5H4z", "M15 5h5v5h-5z", "M9.5 17h5v4h-5z", "M9 7.5h6", "M6.5 10v3.5H12V17", "M17.5 10v3.5H12"],
        Page::Assess => &["M7 3h7l4 4v14H7z", "M14 3v4h4", "M9.5 14.5l2 2 4-4.5"],
        Page::Explore => &["M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z", "M20 20l-4.8-4.8"],
        Page::Live => &["M3 12h4l2.5-6 5 12 2.5-6h4"],
        Page::Library => &["M4 4h5v16H4z", "M9 4h5v16H9z", "M14.5 6.2l4.3-1.2 3.4 13.5-4.3 1.2z"],
        Page::Account => &["M12 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8z", "M4 21c1.6-4 4.6-6 8-6s6.4 2 8 6"],
        Page::Confirm => &["M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z", "M9 12l2.2 2.2L15.5 10"],
    };
    el("svg:svg")
        .attr("viewBox", "0 0 24 24")
        .attr("width", "20")
        .attr("height", "20")
        .attr("fill", "none")
        .attr("stroke", "currentColor")
        .attr("stroke-width", "1.8")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("aria-hidden", "true")
        .kids(d.iter().map(|x| -> N { el("svg:path").attr("d", *x).into() }))
        .into()
}

fn rail(s: &State) -> N {
    let icon = |page: Page, arg: &str| -> N {
        let name = super_name(s, page, arg);
        let open = s.open.iter().any(|(p, a)| *p == page && a == arg);
        el("a")
            .cls("ric")
            .cls_if(open, "open")
            .cls_if(is_current(s, page, arg), "on")
            .attr("href", hash_of(page, arg))
            .attr("aria-label", name.clone())
            .kid(el("span").cls("g").kid(mark_of(page, &name)))
            .kid(el("span").cls("tip").text(name))
            .kid(ports())
            .into()
    };
    let mut r = el("nav").cls("rail").attr("aria-label", "Everything else").kid(
        el("a")
            .cls("ric home")
            .attr("href", "#/")
            .attr("aria-label", "Back to the canvas")
            .kid(el("span").cls("g").text("π"))
            .kid(el("span").cls("tip").text("piii lab"))
            .kid(ports()),
    );
    r = r.kid(el("span").cls("rsep"));
    let tops = [Page::Group(0), Page::Group(1), Page::Group(2), Page::Group(3), Page::Group(4), Page::Map];
    for p in tops {
        r = r.kid(icon(p, ""));
    }
    let extra: Vec<&(Page, String)> = s.open.iter().filter(|(p, _)| !tops.contains(p)).collect();
    if !extra.is_empty() {
        r = r.kid(el("span").cls("rsep"));
        for (p, a) in extra {
            r = r.kid(icon(*p, a));
        }
    }
    r.into()
}

fn window_frame(s: &State, content: N) -> N {
    let idx = s.open.iter().position(|(p, a)| is_current(s, *p, a));
    let arg = match s.page {
        Page::Paper => s.paper.as_str(),
        Page::Confirm => s.ctoken.as_str(),
        _ => "",
    };
    el("section")
        .cls("win")
        .attr("aria-label", super_name(s, s.page, arg))
        .kid(
            el("div")
                .cls("win-head")
                .kid(el("span").cls("win-title tag").text(super_name(s, s.page, arg)))
                .kid_if(idx.is_some(), || {
                    el("button")
                        .cls("win-x")
                        .attr("aria-label", "Close")
                        .attr("title", "Close")
                        .text("×")
                        .on("click", Msg::Close(idx.unwrap_or(0)))
                        .into()
                }),
        )
        .kid(el("div").cls("win-body").kid(el("div").cls("win-in").kid(content)))
        .kid(ports())
        .into()
}

fn gate_view(s: &State) -> N {
    el("div")
        .cls("gate")
        .kid(
            el("div")
                .cls("gate-in")
                .kid(el("div").cls("mark-big small").text("π"))
                .kid(el("p").cls("hint").text("This copy of Piii Lab is private."))
                .kid(
                    el("input")
                        .cls("input")
                        .attr("type", "password")
                        .attr("aria-label", "Password")
                        .attr("autocomplete", "current-password")
                        .prop("value", s.gate_pw.clone())
                        .on_val("input", Msg::GatePw)
                        .on("enter", Msg::GateEnter),
                )
                .kid(el("button").cls("btn primary").text("Enter").on("click", Msg::GateEnter))
                .kid(el("div").cls("gate-no").attr("aria-live", "polite").text(s.gate_err.clone().unwrap_or_default())),
        )
        .into()
}

fn live_page(s: &State) -> N {
    let body = slot_view(&s.live, "Loading…", |d| {
        let idle = d.get("idle");
        let status = if idle.get("working_now").truthy() {
            "Assessing a paper on its own right now."
        } else if idle.get("enabled").truthy() {
            "Quiet. Papers are assessed when people submit them, and on their own when nobody is using the site."
        } else {
            "Papers are assessed when people submit them."
        };
        let rows = d.get("latest").arr();
        let list: N = if rows.is_empty() {
            empty("Nothing assessed yet.")
        } else {
            el("div")
                .cls("list")
                .kids(rows.iter().map(|r| -> N {
                    let field = r.get("field").str();
                    let score = el("div").cls("score").text(num(r.get("score").f(), 1)).kid(el("small").text("piX"));
                    if r.get("auto").truthy() {
                        el("div")
                            .cls("item")
                            .kid(
                                el("div")
                                    .cls("grow")
                                    .kid(
                                        el("a")
                                            .cls("t")
                                            .attr("href", format!("#/paper/{}", r.get("eval_hash").str()))
                                            .text(r.get("title").str().to_string().or_untitled()),
                                    )
                                    .kid(el("div").cls("s").text(format!(
                                        "Assessed on its own · {} · {}",
                                        if field.is_empty() { "open research" } else { field },
                                        date(r.get("at"))
                                    ))),
                            )
                            .kid(score)
                            .into()
                    } else {
                        el("div")
                            .cls("item")
                            .kid(
                                el("div")
                                    .cls("grow")
                                    .kid(el("div").cls("t").text(format!(
                                        "A paper in {}",
                                        if field.is_empty() { "an unlisted field" } else { field }
                                    )))
                                    .kid(el("div").cls("s").text(format!(
                                        "Submitted by {} · {}",
                                        if r.get("signed_in").truthy() { "a signed-in researcher" } else { "a visitor" },
                                        r.get("date").str()
                                    ))),
                            )
                            .kid(score)
                            .into()
                    }
                }))
                .into()
        };
        el("div")
            .cls("stack")
            .kid(
                el("div")
                    .cls("card")
                    .kid(el("p").style("font-weight:500").text(status))
                    .kid(el("p").cls("hint").style("margin-top:4px").text(format!(
                        "{} assessed today · {} in total",
                        num(d.get("today").f(), 0),
                        num(d.get("total").f(), 0)
                    ))),
            )
            .kid(list)
            .into()
    });
    el("div")
        .kid(head(
            "Live",
            "What Piii Lab is doing now. Papers people submit stay private here: only their field and score are shown.",
        ))
        .kid(body)
        .into()
}

fn confirm_page(s: &State) -> N {
    let body = slot_view(&s.req, "Loading the request…", |r| {
        let terms = r.get("terms").arr();
        let requester = r.get("requester").str();
        let mut card = el("div").cls("card").kid(el("h2").text(r.get("title").str())).kid(
            el("p").cls("hint").style("margin-top:4px").text(format!(
                "From {} to {}{}",
                if requester.is_empty() { "Piii Lab" } else { requester },
                r.get("recipient").str(),
                if r.get("created_at").is_null() { String::new() } else { format!(" · {}", date(r.get("created_at"))) }
            )),
        );
        let work = r.get("work").str();
        if !work.is_empty() {
            card = card.kid(el("p").style("margin-top:12px").kid(el("strong").text("Work: ")).text(work));
        }
        let msg = r.get("message").str();
        if !msg.is_empty() {
            card = card.kid(el("p").style("margin-top:10px;white-space:pre-wrap").text(msg));
        }
        if !terms.is_empty() {
            card = card.kid(el("h3").style("margin-top:16px").text("What you would allow")).kid(
                el("ul").style("margin:6px 0 0;padding-left:20px").kids(terms.iter().map(|t| -> N {
                    let text = match t {
                        Value::Str(x) => x.clone(),
                        _ => t.any(&["text", "label", "title", "term"]).str().to_string(),
                    };
                    el("li").style("margin:4px 0").text(text).into()
                })),
            );
        }
        let mut col = el("div").cls("stack").kid(card);
        if let Some(done) = &s.c_sent {
            let granted = done.get("decision").str() == "granted";
            return col
                .kid(
                    el("div")
                        .cls("card")
                        .kid(el("h2").text(if granted { "Permission granted" } else { "Permission declined" }))
                        .kid(
                            el("p")
                                .cls("hint")
                                .style("margin-top:6px")
                                .text(format!("Recorded {}. Your receipt: ", done.get("answered_at").str()))
                                .kid(el("code").text(done.get("receipt").str())),
                        ),
                )
                .into();
        }
        let prev = r.get("answer");
        if !prev.is_null() {
            col = col.kid(el("div").cls("note").text(format!(
                "Already answered: {} by {} on {}. You can answer again; the latest answer counts.",
                prev.get("decision").str(),
                prev.get("name").str(),
                prev.get("answered_at").str()
            )));
        }
        if r.get("closed").truthy() {
            return col.kid(el("div").cls("note").text("This request has been closed by its sender.")).into();
        }
        col.kid(
            el("div")
                .cls("card")
                .kid(el("h3").text("Your answer"))
                .kid(
                    el("input")
                        .cls("input")
                        .style("margin-top:10px")
                        .attr("type", "text")
                        .attr("aria-label", "Your name")
                        .attr("placeholder", "Your name")
                        .attr("autocomplete", "name")
                        .prop("value", s.c_name.clone())
                        .on_val("input", Msg::ConfirmName),
                )
                .kid(
                    el("textarea")
                        .cls("input")
                        .style("margin-top:8px;min-height:84px;resize:vertical")
                        .attr("aria-label", "A note (optional)")
                        .attr("placeholder", "A note (optional)")
                        .prop("value", s.c_note.clone())
                        .on_val("input", Msg::ConfirmNote),
                )
                .kid_if(s.c_err.is_some(), || {
                    el("div").cls("err-box").style("margin-top:10px").text(s.c_err.clone().unwrap_or_default()).into()
                })
                .kid(
                    el("div")
                        .cls("row")
                        .style("margin-top:12px")
                        .kid(
                            el("button")
                                .cls("btn primary")
                                .attr_if(s.c_busy, "disabled", "")
                                .text("Grant permission")
                                .on("click", Msg::ConfirmAnswer(true)),
                        )
                        .kid(el("button").cls("btn").attr_if(s.c_busy, "disabled", "").text("Decline").on("click", Msg::ConfirmAnswer(false))),
                ),
        )
        .into()
    });
    el("div")
        .kid(head(
            "Permission request",
            "Someone asks for your permission. Your answer, your name and the time are recorded, and you get a receipt.",
        ))
        .kid(body)
        .into()
}


fn footer() -> N {
    el("footer")
        .cls("foot")
        .kid(
            el("div")
                .cls("foot-in")
                .kid(el("span").text("Piii Lab · ScholarPi"))
                .kid(el("button").text("Privacy choices").on("click", Msg::ConsentOpen))
                .kid(el("a").attr("href", "/api/cookies").attr("target", "_blank").text("Cookies"))
                .kid(el("a").attr("href", "/docs").attr("target", "_blank").text("API")),
        )
        .into()
}

fn consent_panel(s: &State) -> N {
    let opt = |i: usize, title: &str, sub: &str| -> N {
        el("label")
            .cls("opt")
            .kid(
                el("input")
                    .cls("box")
                    .attr("type", "checkbox")
                    .prop("checked", if s.draft[i] { "1" } else { "0" })
                    .on("change", Msg::ConsentToggle(i)),
            )
            .kid(el("div").kid(el("div").text(title)).kid(el("div").cls("s").text(sub)))
            .into()
    };
    el("div")
        .cls("consent")
        .attr("role", "dialog")
        .attr("aria-label", "Privacy choices")
        .kid(el("h2").text("Your privacy choices"))
        .kid(
            el("p").cls("hint").style("margin:6px 0 8px").text(
                "Nothing optional happens until you choose. You can change this any time from the footer.",
            ),
        )
        .kid(opt(0, "Count my visit", "A pseudonymous key from your address, for the visitor totals."))
        .kid(opt(1, "Help the model learn", "Lets the in-house model learn from how papers are scored."))
        .kid(opt(
            2,
            "Send papers to outside AI models",
            "Needed to assess: the panel runs on independent model providers.",
        ))
        .kid(
            el("div")
                .cls("row")
                .style("margin-top:12px")
                .kid(el("button").cls("btn primary").text("Allow all").on("click", Msg::ConsentAll))
                .kid(el("button").cls("btn").text("Save choices").on("click", Msg::ConsentSave))
                .kid(el("button").cls("btn").text("Only necessary").on("click", Msg::ConsentMin))
                .kid_if(s.consent.is_some(), || {
                    el("button").cls("btn link").text("Close").on("click", Msg::ConsentClose).into()
                }),
        )
        .into()
}

fn head(title: &str, lede: &str) -> N {
    el("div").cls("head").kid(el("h1").text(title)).kid(el("p").cls("lede").text(lede)).into()
}

fn spinner(label: &str) -> N {
    el("div").cls("empty").kid(el("span").cls("spin")).text(label).into()
}

fn failure(e: &str) -> N {
    el("div")
        .cls("err-box row")
        .kid(el("span").style("flex:1").text(e))
        .kid(el("button").cls("btn small").text("Try again").on("click", Msg::Retry))
        .into()
}

/// Whatever a slot holds: a spinner, its error, or the view of its data.
fn slot_view(slot: &Slot, label: &str, f: impl FnOnce(&Value) -> N) -> N {
    if let Some(e) = &slot.err {
        return failure(e);
    }
    match &slot.data {
        Some(v) => f(v),
        None => spinner(label),
    }
}

fn seg<T: Copy + PartialEq>(cur: T, items: &[(T, &str, Msg)]) -> N {
    el("div")
        .cls("seg")
        .attr("role", "tablist")
        .kids(items.iter().map(|(t, label, m)| -> N {
            el("button").cls_if(*t == cur, "on").attr("role", "tab").text(*label).on("click", m.clone()).into()
        }))
        .into()
}

fn tab_link<T: Copy + PartialEq>(cur: T, items: &[(T, &str, &str)]) -> N {
    el("div")
        .cls("seg")
        .kids(items.iter().map(|(t, label, href)| -> N {
            el("a").attr("href", *href).cls_if(*t == cur, "on").text(*label).into()
        }))
        .into()
}

fn tier_pill(tier: &str) -> Option<N> {
    let c = match tier {
        "High" => "good",
        "Moderate" => "warn",
        "Limited" => "bad",
        _ => return None,
    };
    Some(el("span").cls("pill").cls(c).text(format!("Judgement: {}", tier.to_ascii_lowercase())).into())
}

fn paper_pills(d: &Value, total_piq: f64) -> Vec<N> {
    let mut out: Vec<N> = Vec::new();
    if d.get("duplicate").truthy() {
        out.push(el("span").cls("pill accent").text("Already assessed: the existing record, fee returned").into());
    }
    if total_piq > 0.0 {
        out.push(el("span").cls("pill accent").text(format!("{} piQ", num(total_piq, 2))).into());
    }
    let meta = if d.get("judge_metadata").is_null() {
        d.get("consensus_raw").get("_judge_metadata")
    } else {
        d.get("judge_metadata")
    };
    if let Some(p) = tier_pill(meta.get("tier").str()) {
        out.push(p);
    }
    if d.get("integrity").get("compromised").truthy() {
        out.push(el("span").cls("pill bad").text("Integrity flag").into());
    }
    match d.get("reference_audit").get("verdict").str() {
        "fabricated_references" => out.push(el("span").cls("pill bad").text("Fabricated references").into()),
        "some_invalid" => out.push(el("span").cls("pill warn").text("Some references unverified").into()),
        "clean" => out.push(el("span").cls("pill good").text("References verified").into()),
        _ => {}
    }
    let w = d.get("warnings").arr().len();
    if w > 0 {
        out.push(el("span").cls("pill warn").text(plural(w, "warning", "warnings")).into());
    }
    if d.get("published").truthy() {
        out.push(el("span").cls("pill good").text("Published").into());
    }
    out
}

fn bars(d: &Value) -> N {
    let detail = d.get("criteria_detail").arr();
    let rows: Vec<(String, f64)> = if !detail.is_empty() {
        detail.iter().map(|c| (c.any(&["title", "label"]).str().to_string(), c.get("score").f())).collect()
    } else {
        d.get("criteria_breakdown").arr().iter().map(|c| (c.get("label").str().to_string(), c.get("score").f())).collect()
    };
    el("div")
        .cls("bars")
        .kids(rows.into_iter().map(|(label, v)| -> N {
            el("div")
                .cls("bar")
                .kid(el("span").cls("lab").attr("title", label.clone()).text(label))
                .kid(el("span").cls("track").kid(el("span").cls("fill").style(format!("width:{}%", v.clamp(0.0, 100.0)))))
                .kid(el("span").cls("v").text(num(v, 0)))
                .into()
        }))
        .into()
}

fn score_big(score: f64) -> N {
    el("div").cls("big").text(num(score, 1)).kid(el("small").text("piX")).into()
}

// ---- Assess

fn assess_page(s: &State) -> N {
    let body: N = match s.mode {
        Mode::Doi => el("div")
            .kid(
                el("div").cls("field").kid(
                    el("input")
                        .cls("input")
                        .attr("type", "text")
                        .attr("inputmode", "url")
                        .attr("autocomplete", "off")
                        .attr("spellcheck", "false")
                        .attr("aria-label", "DOI")
                        .attr("placeholder", "DOI, for example 10.1038/s41586-020-2649-2")
                        .prop("value", s.doi.clone())
                        .on_val("input", Msg::Doi)
                        .on("enter", Msg::Assess),
                ),
            )
            .kid(el("p").cls("hint").style("margin-top:8px").text(
                "Open-access papers are fetched automatically. For anything else, upload the PDF.",
            ))
            .into(),
        Mode::Pdf => el("div")
            .kid(
                el("label")
                    .cls("drop")
                    .on_val("drop", Msg::Files)
                    .kid(
                        el("input")
                            .attr("type", "file")
                            .attr("multiple", "")
                            .attr("accept", "application/pdf,.pdf")
                            .on_val("files", Msg::Files),
                    )
                    .kid(el("div").style("font-weight:500;color:var(--ink)").text("Choose PDF files"))
                    .kid(el("div").cls("hint").text("or drop them here")),
            )
            .kid_if(!s.files.is_empty(), || {
                el("div")
                    .cls("chips")
                    .style("margin-top:12px")
                    .kids(s.files.iter().enumerate().map(|(i, (_, size, name))| -> N {
                        el("button")
                            .cls("chip")
                            .attr("title", "Remove")
                            .on("click", Msg::Unfile(i))
                            .text(format!("{} · {}", name, bytes(*size)))
                            .kid(el("span").cls("x").text("×"))
                            .into()
                    }))
                    .into()
            })
            .into(),
        Mode::Find => find_view(s),
    };

    let fee_note = {
        let fee = s.emission.data.as_ref().map(|e| e.get("fee").get("fee").f());
        if signed_in(s) {
            match fee {
                Some(f) => format!("{} piQ per paper, charged from your balance.", num(f, 2)),
                None => String::new(),
            }
        } else {
            match &s.trial.data {
                Some(t) if !t.get("remaining").is_null() => format!(
                    "Free trial: {} of {} papers left. Sign in to keep a history and earn piQ.",
                    t.get("remaining").text(),
                    t.get("documents_allowed").text()
                ),
                _ => String::new(),
            }
        }
    };

    let mut col = el("div")
        .kid(head(
            "Assess a manuscript",
            "A panel of independent AI models reads the paper, deterministic checks audit its references and \
             reproducibility, and it is scored on eight open criteria: the piX index.",
        ))
        .kid(
            el("div")
                .cls("card")
                .kid(seg(
                    s.mode,
                    &[(Mode::Doi, "By DOI", Msg::Mode(Mode::Doi)), (Mode::Pdf, "Upload PDF", Msg::Mode(Mode::Pdf)), (
                        Mode::Find,
                        "Find papers",
                        Msg::Mode(Mode::Find),
                    )],
                ))
                .kid(body)
                .kid_if(s.form_err.is_some(), || {
                    el("div").cls("note").style("margin-top:14px").text(s.form_err.clone().unwrap_or_default()).into()
                })
                .kid(
                    el("div")
                        .cls("spread")
                        .style("margin-top:16px")
                        .kid(el("span").cls("hint").text(fee_note))
                        .kid(
                            el("button")
                                .cls("btn primary")
                                .attr_if(s.running, "disabled", "")
                                .on("click", Msg::Assess)
                                .kid_if(s.running, || el("span").cls("spin").style("border-color:rgba(255,255,255,.4);border-top-color:#fff").into())
                                .text(if s.running { "Assessing…" } else { "Assess" }),
                        ),
                ),
        );

    if !s.log.is_empty() {
        let secs = ((host::now() - s.since) / 1000.0).max(0.0) as u64;
        col = col.kid(
            el("div")
                .cls("card")
                .kid(
                    el("div")
                        .cls("spread")
                        .style("margin-bottom:8px")
                        .kid(el("h3").text("Progress"))
                        .kid_if(!s.running, || el("button").cls("btn small").text("Clear").on("click", Msg::ClearRun).into()),
                )
                .kid(el("div").cls("log").attr("aria-live", "polite").kids(s.log.iter().map(|(k, t)| -> N {
                    let c = match k {
                        Line::Live => "live",
                        Line::Old => "old",
                        Line::Fee => "fee",
                        Line::Reward => "reward",
                        Line::Err => "err",
                        Line::Done => "done",
                    };
                    let mut d = el("div").cls(c);
                    if *k == Line::Live && s.running {
                        d = d.kid(el("span").cls("spin")).text(format!("{} {}s", t, secs));
                    } else {
                        d = d.text(t.clone());
                    }
                    d.into()
                }))),
        );
    }
    for item in &s.results {
        col = col.kid(result_card(item));
    }
    if !s.failed.is_empty() {
        col = col.kid(
            el("div")
                .cls("card")
                .kid(el("h3").text("Papers that could not be downloaded"))
                .kid(el("p").cls("hint").style("margin:4px 0 10px").text(
                    "Their full text is not openly available to us. Download the PDF yourself and upload it.",
                ))
                .kids(s.failed.iter().map(|f| -> N {
                    let label = f.any(&["title", "doi"]).str().to_string();
                    let url = f.get("url").str().to_string();
                    let row = el("div").style("padding:4px 0");
                    if url.is_empty() {
                        row.text(label).into()
                    } else {
                        row.kid(el("a").attr("href", url).attr("target", "_blank").attr("rel", "noopener").text(label)).into()
                    }
                })),
        );
    }
    col.into()
}

fn find_view(s: &State) -> N {
    let mut v = el("div").kid(
        el("div")
            .cls("field")
            .kid(
                el("input")
                    .cls("input")
                    .attr("type", "search")
                    .attr("aria-label", "Search papers")
                    .attr("placeholder", "A topic, a title or an author")
                    .prop("value", s.find_q.clone())
                    .on_val("input", Msg::FindQ)
                    .on("enter", Msg::Find),
            )
            .kid(el("button").cls("btn").text("Search").on("click", Msg::Find)),
    );
    if s.found.data.is_none() && !s.found.busy && s.found.err.is_none() {
        if let Some(t) = &s.topics.data {
            let topics = t.get("topics").arr();
            if !topics.is_empty() {
                v = v.kid(el("p").cls("hint").style("margin:14px 0 8px").text("Trending in open research")).kid(
                    el("div").cls("chips").kids(topics.iter().enumerate().map(|(i, t)| -> N {
                        el("button").cls("chip").text(t.str()).on("click", Msg::Topic(i)).into()
                    })),
                );
            }
        }
        return v.into();
    }
    v = v.kid(el("div").style("margin-top:14px").kid(slot_view(&s.found, "Searching OpenAlex and Crossref…", |d| {
        let rows = d.get("results").arr();
        if rows.is_empty() {
            return el("div").cls("empty").text("Nothing found. Try other words.").into();
        }
        el("div")
            .kid(el("p").cls("hint").style("margin-bottom:8px").text(format!(
                "Select up to 10. {} selected.",
                s.picked.len()
            )))
            .kid(el("div").cls("list").kids(rows.iter().enumerate().map(|(i, r)| -> N {
                let usable = !r.get("pdf_url").str().is_empty() || !r.get("doi").str().is_empty();
                let on = s.picked.contains(&i);
                let mut meta: Vec<String> = Vec::new();
                for k in ["authors", "year", "oa_status"] {
                    let t = r.get(k).text();
                    if !t.is_empty() {
                        meta.push(t);
                    }
                }
                let mut row = el("label").cls("item").cls(if usable { "pick" } else { "off" });
                let mut b = el("input").cls("box").attr("type", "checkbox").prop("checked", if on { "1" } else { "0" });
                if usable {
                    b = b.on("change", Msg::Pick(i));
                } else {
                    b = b.attr("disabled", "");
                    row = row.attr("title", "No open PDF or DOI to fetch");
                }
                row.kid(b)
                    .kid(el("div").cls("grow").kid(el("div").cls("t").text(r.get("title").str())).kid(el("div").cls("s").text(meta.join(" · "))))
                    .into()
            })))
            .into()
    })));
    v.into()
}

fn result_card(d: &Value) -> N {
    let hash = d.any(&["eval_hash", "hash"]).str().to_string();
    let total = d.get("piq").f() + d.get("escrowed").f();
    let diag = d.get("diagnostics");
    let mut card = el("div")
        .cls("card")
        .kid(
            el("div")
                .cls("res-head")
                .kid(
                    el("div")
                        .style("min-width:0")
                        .kid(el("h2").style("overflow-wrap:anywhere").text(d.get("title").str().to_string().or_untitled()))
                        .kid(el("p").cls("hint").style("margin-top:4px").text(d.get("author_name").str().to_string().or_unknown())),
                )
                .kid(score_big(d.get("score").f())),
        )
        .kid(el("div").cls("pills").style("margin-top:12px").kids(paper_pills(d, total)))
        .kid(bars(d));
    if diag.get("available").truthy() {
        let headline = diag.get("headline").str();
        if !headline.is_empty() {
            card = card.kid(el("p").style("margin-top:16px;font-weight:500").text(headline));
        }
        card = card.kids(diag.get("findings").arr().iter().take(5).map(|f| -> N {
            el("div")
                .cls("find")
                .cls(f.get("severity").str())
                .kid(el("div").cls("ft").text(f.get("title").str()))
                .kid(el("div").cls("fa").text(f.any(&["action", "reality"]).str()))
                .into()
        }));
    }
    if !hash.is_empty() {
        card = card.kid(
            el("div").style("margin-top:16px").kid(el("a").attr("href", format!("#/paper/{}", hash)).text("Open the full dossier →")),
        );
    }
    card.into()
}

trait OrDefault {
    fn or_untitled(self) -> String;
    fn or_unknown(self) -> String;
}

impl OrDefault for String {
    fn or_untitled(self) -> String {
        if self.trim().is_empty() { "Untitled manuscript".to_string() } else { self }
    }
    fn or_unknown(self) -> String {
        if self.trim().is_empty() || self == "None" { "Unidentified author".to_string() } else { self }
    }
}

// ---- Explore

fn explore_page(s: &State) -> N {
    let stats = slot_view(&s.summary, "Loading the totals…", |d| {
        let stat = |v: String, label: &str| -> N { el("div").cls("stat").kid(el("b").text(v)).kid(el("span").text(label)).into() };
        let earned = if d.get("total_piq_earned").is_null() { d.get("total_piq").f() } else { d.get("total_piq_earned").f() };
        el("div")
            .cls("stats")
            .kid(stat(num(d.get("total_papers").f(), 0), "papers assessed"))
            .kid(stat(num(d.get("unique_authors").f(), 0), "authors"))
            .kid(stat(num(d.get("avg_score").f(), 1), "average piX"))
            .kid(stat(num(earned, 1), "piQ earned"))
            .into()
    });
    let t = s.tab;
    let tabs = tab_link(
        t,
        &[
            (Tab::Recent, "Latest", "#/explore"),
            (Tab::Papers, "Top papers", "#/explore/papers"),
            (Tab::Authors, "Authors", "#/explore/authors"),
            (Tab::Journal, "Journal", "#/explore/journal"),
        ],
    );
    let search: N = if t == Tab::Journal {
        el("p").cls("hint").style("margin-bottom:12px").text("Papers published here, reviewed, or waiting for a reviewer.").into()
    } else {
        el("div")
            .cls("field")
            .style("margin-bottom:14px")
            .kid(
                el("input")
                    .cls("input")
                    .attr("type", "search")
                    .attr("aria-label", "Search")
                    .attr("placeholder", if t == Tab::Authors { "Search authors" } else { "Search titles and authors" })
                    .prop("value", s.q.clone())
                    .on_val("input", Msg::Q)
                    .on("enter", Msg::Search),
            )
            .kid(el("button").cls("btn").text("Search").on("click", Msg::Search))
            .into()
    };
    let list = slot_view(&s.tabs[t as usize], "Loading…", |d| match t {
        Tab::Recent => paper_list(d.get("records").arr(), "timestamp", "author"),
        Tab::Papers => paper_list(d.get("papers").arr(), "date", "author"),
        Tab::Authors => author_list(d.get("rankings").arr()),
        Tab::Journal => journal_list(d.get("entries").arr()),
    });
    el("div")
        .kid(head(
            "Explore",
            "Every assessment is recorded on the Proof-of-Research ledger. Browse the latest, the strongest papers and \
             the authors behind them.",
        ))
        .kid(stats)
        .kid(tabs)
        .kid(search)
        .kid(list)
        .into()
}

fn empty(text: &str) -> N {
    el("div").cls("list").kid(el("div").cls("empty").text(text)).into()
}

fn paper_list(rows: &[Value], date_key: &str, author_key: &str) -> N {
    if rows.is_empty() {
        return empty("No papers yet.");
    }
    el("div")
        .cls("list")
        .kids(rows.iter().map(|r| -> N {
            let hash = r.any(&["eval_hash", "hash"]).str();
            let author = r.any(&[author_key, "author_name", "author"]).str().to_string().or_unknown();
            let d = date(r.any(&[date_key, "timestamp", "assessed_at", "date"]));
            let piq = r.get("piq").f();
            let mut sub = author;
            if !d.is_empty() {
                sub = format!("{} · {}", sub, d);
            }
            if piq > 0.0 {
                sub = format!("{} · {} piQ", sub, num(piq, 2));
            }
            el("div")
                .cls("item")
                .kid(
                    el("div")
                        .cls("grow")
                        .kid(el("a").cls("t").attr("href", format!("#/paper/{}", hash)).text(r.get("title").str().to_string().or_untitled()))
                        .kid(el("div").cls("s").text(sub)),
                )
                .kid(el("div").cls("score").text(num(r.get("score").f(), 1)).kid(el("small").text("piX")))
                .into()
        }))
        .into()
}

fn author_list(rows: &[Value]) -> N {
    if rows.is_empty() {
        return empty("No authors yet.");
    }
    el("div")
        .cls("list")
        .kids(rows.iter().enumerate().map(|(i, r)| -> N {
            let orcid = r.get("orcid").str();
            let name = r.get("author").str().to_string().or_unknown();
            let title: N = if orcid.is_empty() {
                el("div").cls("t").text(name).into()
            } else {
                el("a").cls("t").attr("href", format!("https://orcid.org/{}", orcid)).attr("target", "_blank").attr("rel", "noopener").text(name).into()
            };
            let papers = r.get("papers").f() as usize;
            el("div")
                .cls("item")
                .kid(el("div").cls("score").style("min-width:28px;text-align:left;color:var(--faint)").text(format!("{}", i + 1)))
                .kid(el("div").cls("grow").kid(title).kid(el("div").cls("s").text(format!(
                    "{} · average piX {}",
                    plural(papers, "paper", "papers"),
                    num(r.get("avg_score").f(), 1)
                ))))
                .kid(el("div").cls("score").text(num(r.get("piq").f(), 2)).kid(el("small").text("piQ")))
                .into()
        }))
        .into()
}

fn journal_list(rows: &[Value]) -> N {
    if rows.is_empty() {
        return empty("Nothing published or reviewed yet.");
    }
    el("div")
        .cls("list")
        .kids(rows.iter().map(|r| -> N {
            let mut pills: Vec<N> = Vec::new();
            if r.get("published").truthy() {
                pills.push(el("span").cls("pill good").text("Published").into());
            }
            let pr = r.get("peer_reviews").f() as usize;
            if pr > 0 {
                pills.push(el("span").cls("pill accent").text(plural(pr, "peer review", "peer reviews")).into());
            }
            if r.get("llm_reviewed").truthy() {
                pills.push(el("span").cls("pill").text("LLM-reviewed").into());
            }
            if r.get("review_requested").truthy() {
                pills.push(el("span").cls("pill warn").text("Waiting for a reviewer").into());
            }
            el("div")
                .cls("item")
                .kid(
                    el("div")
                        .cls("grow")
                        .kid(el("a").cls("t").attr("href", format!("#/paper/{}", r.get("hash").str())).text(r.get("title").str().to_string().or_untitled()))
                        .kid(el("div").cls("s").text(format!("{} · {}", r.get("author").str().to_string().or_unknown(), date(r.get("assessed_at")))))
                        .kid(el("div").cls("pills").style("margin-top:6px").kids(pills)),
                )
                .kid(el("div").cls("score").text(num(r.get("score").f(), 1)).kid(el("small").text("piX")))
                .into()
        }))
        .into()
}

// ---- A paper's dossier

fn paper_page(s: &State) -> N {
    let body = slot_view(&s.dossier, "Loading the dossier…", |d| {
        el("div").cls("stack").kid(dossier_view(d)).into()
    });
    el("div").kid(body).into()
}

fn dossier_view(d: &Value) -> N {
    let hash = d.get("eval_hash").str().to_string();
    let doi = d.get("doi").str();
    let meta = d.get("judge_metadata");
    let minted = d.get("piq").f();
    let held = d.get("escrowed").f();
    let mut sub: Vec<N> = Vec::new();
    if !doi.is_empty() && doi != "None" {
        sub.push(el("a").attr("href", format!("https://doi.org/{}", doi)).attr("target", "_blank").attr("rel", "noopener").text(format!("doi:{}", doi)).into());
        sub.push(txt(" · "));
    }
    sub.push(txt(date(d.get("timestamp"))));

    let mut col = el("div").cls("stack").kid(
        el("div")
            .cls("card")
            .kid(
                el("div")
                    .cls("res-head")
                    .kid(
                        el("div")
                            .style("min-width:0")
                            .kid(el("h1").style("font-size:24px;overflow-wrap:anywhere").text(d.get("title").str().to_string().or_untitled()))
                            .kid(el("p").cls("hint").style("margin-top:6px").text(d.get("author_name").str().to_string().or_unknown()))
                            .kid(el("p").cls("hint").kids(sub)),
                    )
                    .kid(score_big(d.get("score").f())),
            )
            .kid(el("div").cls("pills").style("margin-top:12px").kids(paper_pills(d, 0.0)))
            .kid(bars(d)),
    );

    // piQ
    let mut kv: Vec<(String, String)> = Vec::new();
    kv.push(("piQ minted".into(), num(minted, 2)));
    if held > 0.0 {
        kv.push(("piQ held for unverified authors".into(), num(held, 2)));
    }
    let conf = meta.get("confidence").num();
    if let Some(c) = conf {
        kv.push(("Panel confidence".into(), format!("{}%", num(c * 100.0, 0))));
    }
    if let Some(a) = meta.get("inter_model_agreement").num() {
        kv.push(("Agreement between models".into(), format!("{}%", num(a * 100.0, 0))));
    }
    let pr = d.get("peer_reviews").f() as usize;
    kv.push(("Peer reviews".into(), pr.to_string()));
    if !d.get("reads").is_null() {
        kv.push(("Reads".into(), d.get("reads").text()));
    }
    if !d.get("rubric_version").is_null() {
        kv.push(("Rubric".into(), d.get("rubric_version").text()));
    }
    col = col.kid(
        el("div")
            .cls("card")
            .kid(el("h2").style("margin-bottom:10px").text("Record"))
            .kid(el("dl").cls("kv").kids(kv.into_iter().flat_map(|(k, v)| [el("dt").text(k).into(), el("dd").text(v).into()]))),
    );

    // The criteria in full.
    let crit = d.get("criteria_breakdown").arr();
    if !crit.is_empty() {
        col = col.kid(
            el("div").cls("card").kid(el("h2").style("margin-bottom:12px").text("The eight criteria")).kids(crit.iter().map(|c| -> N {
                let contribs = c.get("contributions").arr();
                let gap = c.get("largest_gap");
                let gap_text = match gap {
                    Value::Str(g) => g.clone(),
                    Value::Obj(_) => gap.any(&["description", "signal"]).str().to_string(),
                    _ => String::new(),
                };
                el("div")
                    .cls("crit")
                    .kid(el("div").cls("spread").kid(el("h3").text(c.get("label").str())).kid(el("b").text(num(c.get("score").f(), 0))))
                    .kid(el("p").cls("hint").style("margin-top:4px").text(c.get("definition").str()))
                    .kid_if(!gap_text.is_empty(), || el("p").style("margin-top:6px;font-size:14px").text(format!("Largest gap: {}", gap_text)).into())
                    .kid_if(!contribs.is_empty(), || {
                        el("div")
                            .cls("scroll")
                            .style("margin-top:8px")
                            .kid(
                                el("table")
                                    .kid(el("thead").kid(el("tr").kid(el("th").text("Signal")).kid(el("th").cls("n").text("Value")).kid(el("th").cls("n").text("Points"))))
                                    .kid(el("tbody").kids(contribs.iter().map(|x| -> N {
                                        let desc = x.get("description").str();
                                        el("tr")
                                            .kid(el("td").text(if desc.is_empty() { x.get("signal").str() } else { desc }))
                                            .kid(el("td").cls("n").text(num(x.get("value").f(), 2)))
                                            .kid(el("td").cls("n").text(format!("{} / {}", num(x.get("points").f(), 1), num(x.get("max_points").f(), 1))))
                                            .into()
                                    }))),
                            )
                            .into()
                    })
                    .into()
            })),
        );
    }

    // The panel.
    let models = meta.get("participating_models").arr();
    let rationale = meta.get("rationale").str();
    if !models.is_empty() || !rationale.is_empty() {
        col = col.kid(
            el("div")
                .cls("card")
                .kid(el("h2").style("margin-bottom:8px").text("The panel"))
                .kid_if(!rationale.is_empty(), || el("p").style("margin-bottom:10px").text(rationale).into())
                .kid(el("div").cls("pills").kids(models.iter().map(|m| -> N {
                    el("span").cls("pill").text(format!("{} · {}", m.get("label").str(), m.get("role").str())).into()
                })))
                .kid_if(!meta.get("failed_models").arr().is_empty(), || {
                    el("p").cls("hint").style("margin-top:8px").text(format!(
                        "Did not respond: {}",
                        meta.get("failed_models").arr().iter().map(|m| m.get("label").str()).collect::<Vec<_>>().join(", ")
                    ))
                    .into()
                }),
        );
    }

    // References.
    let ra = d.get("reference_audit");
    if !ra.is_null() && ra.get("verdict").str() != "not_assessed" {
        let sm = ra.get("summary");
        col = col.kid(
            el("div")
                .cls("card")
                .kid(el("h2").style("margin-bottom:10px").text("References"))
                .kid(el("dl").cls("kv").kids([
                    el("dt").text("Checked against OpenAlex and Crossref").into(),
                    el("dd").text(ra.get("checked").text()).into(),
                    el("dt").text("Verified").into(),
                    el("dd").text(ra.get("verified").text()).into(),
                    el("dt").text("Not found").into(),
                    el("dd").text(ra.get("unverified").text()).into(),
                    el("dt").text("Fabricated").into(),
                    el("dd").text(ra.get("fabricated").text()).into(),
                    el("dt").text("Total references").into(),
                    el("dd").text(sm.get("total").text()).into(),
                    el("dt").text("Median year").into(),
                    el("dd").text(sm.get("median_year").text()).into(),
                ])),
        );
    }

    let warnings = d.get("warnings").arr();
    if !warnings.is_empty() {
        col = col.kid(
            el("div")
                .cls("card")
                .kid(el("h2").style("margin-bottom:6px").text("Warnings"))
                .kid(el("ul").style("margin:0;padding-left:20px").kids(warnings.iter().map(|w| -> N { el("li").text(w.str()).into() }))),
        );
    }

    let report = d.get("evidence_report_text").str();
    if !report.trim().is_empty() {
        col = col.kid(el("div").cls("card").kid(el("h2").text("Evidence report")).kid(markdown(report)));
    }

    let mut links = el("div").cls("row");
    links = links.kid(el("a").attr("href", format!("/api/dossier/{}/fair", hash)).attr("target", "_blank").text("FAIR record"));
    if d.get("has_file").truthy() {
        links = links.kid(el("a").attr("href", format!("/api/papers/{}/file", hash)).attr("target", "_blank").text("Manuscript"));
    }
    let ex = d.get("explorer_url").str();
    if !ex.is_empty() {
        links = links.kid(el("a").attr("href", ex).attr("target", "_blank").attr("rel", "noopener").text("On chain"));
    }
    col = col.kid(el("div").cls("card").kid(links));
    col.into()
}

/// The evidence report: headings, lists, paragraphs and **bold**.
fn markdown(src: &str) -> N {
    let mut out: Vec<N> = Vec::new();
    let mut list: Vec<N> = Vec::new();
    let mut para = String::new();
    fn inline(s: &str) -> Vec<N> {
        let mut v: Vec<N> = Vec::new();
        for (i, part) in s.split("**").enumerate() {
            if part.is_empty() {
                continue;
            }
            if i % 2 == 1 { v.push(el("strong").text(part).into()) } else { v.push(txt(part)) }
        }
        v
    }
    let flush_para = |para: &mut String, out: &mut Vec<N>| {
        if !para.trim().is_empty() {
            out.push(el("p").kids(inline(para.trim())).into());
        }
        para.clear();
    };
    let flush_list = |list: &mut Vec<N>, out: &mut Vec<N>| {
        if !list.is_empty() {
            out.push(el("ul").kids(core::mem::take(list)).into());
        }
    };
    for line in src.lines() {
        let t = line.trim();
        if t.is_empty() {
            flush_para(&mut para, &mut out);
            flush_list(&mut list, &mut out);
        } else if let Some(h) = t.strip_prefix('#') {
            flush_para(&mut para, &mut out);
            flush_list(&mut list, &mut out);
            out.push(el("h3").kids(inline(h.trim_start_matches('#').trim())).into());
        } else if let Some(li) = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")).or_else(|| t.strip_prefix("• ")) {
            flush_para(&mut para, &mut out);
            list.push(el("li").kids(inline(li)).into());
        } else {
            flush_list(&mut list, &mut out);
            if !para.is_empty() {
                para.push(' ');
            }
            para.push_str(t);
        }
    }
    flush_para(&mut para, &mut out);
    flush_list(&mut list, &mut out);
    el("div").cls("md").kids(out).into()
}

// ---- Library

fn library_page(s: &State) -> N {
    let rubric = slot_view(&s.rubric, "Loading the rubric…", |r| {
        let conf = r.get("confidence").get("statement").str();
        el("div")
            .cls("card")
            .kid(el("div").cls("spread").kid(el("h2").text("The piX rubric")).kid(el("span").cls("pill").text(r.get("version").str())))
            .kid_if(!conf.is_empty(), || el("p").cls("hint").style("margin-top:6px").text(conf).into())
            .kids(r.get("criteria").arr().iter().map(|c| -> N {
                let mut weights: Vec<(String, f64)> =
                    c.get("weights").entries().iter().map(|(k, v)| (k.clone(), v.f())).collect();
                weights.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(core::cmp::Ordering::Equal));
                let share = c.get("deterministic_share").num();
                el("div")
                    .cls("crit")
                    .style("margin-top:14px")
                    .kid(
                        el("div")
                            .cls("row")
                            .kid(el("h3").text(c.get("label").str()))
                            .kid_if(c.get("interpretive").truthy(), || el("span").cls("pill warn").text("interpretive").into())
                            .kid_if(share.is_some(), || {
                                el("span").cls("pill").text(format!("{}% verifiable", num(share.unwrap_or(0.0) * 100.0, 0))).into()
                            }),
                    )
                    .kid(el("p").cls("hint").style("margin-top:4px").text(c.get("definition").str()))
                    .kid(el("div").cls("chips").style("margin-top:8px").kids(weights.iter().take(6).map(|(k, w)| -> N {
                        el("span").cls("pill").text(format!("{} {}%", k.replace('_', " "), num(w * 100.0, 0))).into()
                    })))
                    .into()
            }))
            .into()
    });
    let emission = slot_view(&s.emission, "Loading the emission schedule…", |e| {
        let floor = e.get("current_quality_floor").f();
        let rows = e.get("schedule").arr();
        el("div")
            .cls("card")
            .kid(el("h2").style("margin-bottom:10px").text("piQ emission"))
            .kid(el("dl").cls("kv").kids([
                el("dt").text("Papers assessed").into(),
                el("dd").text(num(e.get("corpus_size").f(), 0)).into(),
                el("dt").text("Epoch").into(),
                el("dd").text(format!("{} of {}", e.get("current_epoch").text(), e.get("max_halvings").text())).into(),
                el("dt").text("Supply factor").into(),
                el("dd").text(format!("{}%", num(e.get("current_supply_factor").f() * 100.0, 2))).into(),
                el("dt").text("Quality floor").into(),
                el("dd").text(format!("piX {}", num(floor, 1))).into(),
                el("dt").text("Fee per paper").into(),
                el("dd").text(format!("{} piQ", num(e.get("fee").get("fee").f(), 4))).into(),
            ]))
            .kids(e.get("explanation").arr().iter().map(|p| -> N { el("p").cls("hint").style("margin-top:8px").text(p.str()).into() }))
            .kid_if(!rows.is_empty(), || {
                el("div")
                    .cls("scroll")
                    .style("margin-top:12px")
                    .kid(
                        el("table")
                            .kid(el("thead").kid(
                                el("tr")
                                    .kid(el("th").text("Epoch"))
                                    .kid(el("th").text("Papers"))
                                    .kid(el("th").cls("n").text("Supply"))
                                    .kid(el("th").cls("n hide-sm").text("piQ per 100 piX"))
                                    .kid(el("th").cls("n").text("Floor")),
                            ))
                            .kid(el("tbody").kids(rows.iter().take(12).map(|r| -> N {
                                el("tr")
                                    .cls_if(r.get("current").truthy(), "now")
                                    .kid(el("td").text(r.get("epoch").text()))
                                    .kid(el("td").text(match r.get("papers_to").num() {
                                        Some(to) if to > 0.0 => format!("{}–{}", num(r.get("papers_from").f(), 0), num(to, 0)),
                                        _ => format!("{}+", num(r.get("papers_from").f(), 0)),
                                    }))
                                    .kid(el("td").cls("n").text(format!("{}%", num(r.get("supply_factor").f() * 100.0, 2))))
                                    .kid(el("td").cls("n hide-sm").text(num(r.get("piq_per_100_pix").f(), 2)))
                                    .kid(el("td").cls("n").text(num(r.get("quality_floor_at_start").f(), 1)))
                                    .into()
                            }))),
                    )
                    .into()
            })
            .into()
    });
    let link = |href: &str, title: &str, sub: &str| -> N {
        el("div")
            .cls("item")
            .kid(el("div").cls("grow").kid(el("a").cls("t").attr("href", href).attr("target", "_blank").text(title)).kid(el("div").cls("s").text(sub)))
            .into()
    };
    el("div")
        .kid(head("Library", "How the scores are made, how piQ is issued, and the tools that work with ScholarPi."))
        .kid(
            el("div")
                .cls("stack")
                .kid(rubric)
                .kid(emission)
                .kid(
                    el("div")
                        .cls("list")
                        .kid(link("/ScholarPi_Whitepaper.pdf", "Whitepaper", "The design of the index, the panel and the ledger (PDF)."))
                        .kid(link("/zotero/scholarpi.xpi", "Zotero plugin", "Shows each paper's piX in your Zotero library. Zotero 7: Tools → Plugins → Install from file."))
                        .kid(link("/docs", "API reference", "Every endpoint, for building on ScholarPi."))
                        .kid(link("/api/cookies", "Cookies and storage", "Everything this site keeps in your browser, and why.")),
                ),
        )
        .into()
}

// ---- Account

fn account_page(s: &State) -> N {
    let mut col = el("div").kid(head("Account", "Your identity, your piQ and the papers you have assessed."));
    if !signed_in(s) {
        let mut card = el("div")
            .cls("card")
            .kid(el("h2").text("Sign in with ORCID"))
            .kid(el("p").cls("lede").style("margin:6px 0 14px").text(
                "Signing in links your assessments to you, keeps their history, and lets the piQ they earn be minted to you \
                 instead of held in escrow.",
            ))
            .kid(el("button").cls("btn primary").text("Sign in with ORCID").on("click", Msg::SignIn));
        if let Some(e) = &s.login_err {
            card = card.kid(el("div").cls("err-box").style("margin-top:14px").text(e.clone()));
        }
        col = col.kid(card);
        if let Some(t) = &s.trial.data {
            col = col.kid(el("div").cls("card").kid(el("h3").text("Free trial")).kid(el("p").cls("hint").style("margin-top:4px").text(format!(
                "{} of {} papers left without signing in. {}",
                t.get("remaining").text(),
                t.get("documents_allowed").text(),
                t.get("note").str()
            ))));
        }
        return col.into();
    }
    let who = if s.name.is_empty() { "Signed in".to_string() } else { s.name.clone() };
    let mut idrow = el("p").cls("hint").style("margin-top:4px");
    if !s.orcid.is_empty() {
        idrow = idrow.text("ORCID ").kid(el("a").attr("href", format!("https://orcid.org/{}", s.orcid)).attr("target", "_blank").attr("rel", "noopener").text(s.orcid.clone()));
    }
    if !s.wallet.is_empty() {
        idrow = idrow.text(format!("{}Wallet {}", if s.orcid.is_empty() { "" } else { " · " }, short(&s.wallet)));
    }
    col = col.kid(
        el("div").cls("card").kid(
            el("div")
                .cls("spread")
                .kid(el("div").kid(el("h2").text(who)).kid(idrow))
                .kid(el("button").cls("btn").text("Sign out").on("click", Msg::SignOut)),
        ),
    );
    col = col.kid(slot_view(&s.piq, "Loading your balance…", |p| {
        let stat = |v: String, label: &str| -> N { el("div").cls("stat").kid(el("b").text(v)).kid(el("span").text(label)).into() };
        el("div")
            .cls("stats")
            .style("margin-top:14px")
            .kid(stat(num(p.get("balance").f(), 2), "piQ to spend"))
            .kid(stat(num(p.get("minted").f(), 2), "piQ minted"))
            .kid(stat(num(p.get("held").f(), 2), "piQ held"))
            .kid(stat(p.get("papers_affordable").text(), "papers you can afford"))
            .into()
    }));
    col = col.kid(el("h2").style("margin:8px 0 12px").text("Your assessments")).kid(slot_view(&s.mine, "Loading your assessments…", |m| {
        let rows = m.get("assessments").arr();
        if rows.is_empty() {
            return empty("None yet. Assess a paper and it will appear here.");
        }
        paper_list(rows, "timestamp", "author_name")
    }));
    col.into()
}

fn short(w: &str) -> String {
    if w.len() > 12 { format!("{}…{}", &w[..6], &w[w.len() - 4..]) } else { w.to_string() }
}

include!("scene.rs");
