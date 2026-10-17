//! The browser (owner, 2026-10-17: "add a simple browser to reach piii.app on piii os"): an address to type, the
//! page as text and links, and piii.app's Open portal read and written. The network itself is the machine's (net.rs):
//! the browser asks through `App::fetch`, the loop carries it out once "Loading…" is on the screen, and hands the
//! answer back to `App::fetched`.

use super::*;
use crate::web::{self, Item, Json, Response, Url};
use alloc::string::ToString;

/// A request for the network.
#[derive(Clone, Debug, PartialEq)]
pub struct Fetch {
    pub method: String,
    pub url: String,
    pub body: String,
    pub ctype: String,
}

const PORTAL: &str = "http://piii.app/api/portal?limit=50";

#[derive(Default)]
pub(super) struct Browser {
    /// what is typed in the address field
    addr: String,
    /// the field being typed in: 0 the address, 1 a post, 2 a name
    pub(super) field: Option<u8>,
    page: Page,
    /// what the browser says above the page (where it is, or what went wrong)
    status: String,
    post: String,
    name: String,
    loading: bool,
    opened: bool,
    /// a post was sent: when it is in, the portal is loaded again
    posting: bool,
    links: Vec<String>,
    /// how it is connected (from the machine)
    pub(super) how: String,
    /// the address field just got focus: the first key typed replaces the whole address
    fresh: bool,
}

#[derive(Default)]
enum Page {
    #[default]
    Empty,
    Portal {
        posts: Vec<(i64, String, String, String)>,
        total: usize,
    },
    Doc {
        title: String,
        items: Vec<Item>,
    },
    Lines(Vec<String>),
}

/// one line of what the page shows, as drawn
struct Row {
    text: String,
    color: u32,
    big: bool,
    link: Option<usize>,
}

impl App {
    pub(super) fn br_open(&mut self) {
        if !self.br.opened {
            self.br.opened = true;
            self.br.addr = "piii.app".into();
            self.br_load("GET", PORTAL, "", "");
        }
    }

    fn br_load(&mut self, method: &str, url: &str, body: &str, ctype: &str) {
        self.fetch = Some(Fetch { method: method.into(), url: url.into(), body: body.into(), ctype: ctype.into() });
        self.br.loading = true;
        self.br.status = if self.br.how.is_empty() {
            "Starting the network (Ethernet) and loading… this can take up to half a minute.".into()
        } else {
            format!("Loading {}…", url)
        };
        self.dirty = true;
    }

    /// The network's name for how it is connected (set by the machine once it is).
    pub fn set_network(&mut self, how: &str) {
        self.br.how = how.into();
    }

    /// The answer to the last request.
    pub fn fetched(&mut self, r: Result<(Url, Response), String>) {
        self.br.loading = false;
        self.dirty = true;
        self.scroll = 0;
        let posting = core::mem::replace(&mut self.br.posting, false);
        let (url, resp) = match r {
            Ok(x) => x,
            Err(e) => {
                self.br.status = e;
                return;
            }
        };
        let body = resp.text();
        let ctype = resp.header("content-type").unwrap_or("").to_ascii_lowercase();
        let ok = (200..300).contains(&resp.status);
        let json = Json::parse(&body);
        if posting {
            if ok {
                self.br.post.clear();
                self.br.status = "Posted: on piii.app's Open portal, for everyone.".into();
                self.br_load("GET", PORTAL, "", "");
            } else {
                let why = json.as_ref().map(|j| j.get("detail").text()).filter(|t| !t.is_empty()).unwrap_or_else(|| format!("the server answered {}", resp.status));
                self.br.status = format!("Not posted: {}", why);
            }
            return;
        }
        self.br.addr = if url.host == "piii.app" && url.path.starts_with("/api/portal") { "piii.app".into() } else { url.text().trim_start_matches("http://").into() };
        self.br.status = if ok { format!("{} · {}", url.text(), self.br.how) } else { format!("{} answered {} {}", url.host, resp.status, resp.reason) };
        self.br.links.clear();
        // piii.app's Open portal: its posts
        if url.path.starts_with("/api/portal") {
            if let Some(j) = &json {
                if !matches!(j.get("posts"), Json::Null) {
                    let posts = j
                        .get("posts")
                        .arr()
                        .iter()
                        .map(|p| (p.get("id").f() as i64, p.get("name").text(), p.get("at").text(), p.get("text").text()))
                        .collect();
                    self.br.page = Page::Portal { posts, total: j.get("total").f() as usize };
                    return;
                }
            }
        }
        if let Some(j) = json.filter(|_| ctype.contains("json") || body.trim_start().starts_with('{') || body.trim_start().starts_with('[')) {
            let mut lines = Vec::new();
            j.pretty(0, &mut lines, "");
            self.br.page = Page::Lines(lines);
        } else if ctype.contains("html") || body.trim_start().to_ascii_lowercase().starts_with("<!doctype html") || body.contains("<html") {
            let (title, mut items) = web::html(&body, &url);
            if items.is_empty() && body.contains("host.js") {
                // piii.app's own page: a WebAssembly program, which this browser cannot run
                items = alloc::vec![
                    Item::Heading("piii.app".into()),
                    Item::Text("piii.app's page is a program (WebAssembly) that piii OS cannot run yet. What piii OS can open from it:".into()),
                    Item::Link("The Open portal: read and write".into(), PORTAL.into()),
                    Item::Link("The site's health".into(), "http://piii.app/api/health".into()),
                ];
            }
            self.br.page = Page::Doc { title, items };
        } else {
            self.br.page = Page::Lines(body.lines().map(|l| l.into()).collect());
        }
    }

    pub(super) fn br_act(&mut self, a: Act) {
        if self.br.loading {
            return;
        }
        match a {
            Act::Field(n) => {
                if self.br.field != Some(n) {
                    self.br.fresh = n == 0;
                }
                self.br.field = Some(n);
            }
            Act::Go => {
                self.br.field = None;
                let a = self.br.addr.trim().to_string();
                match Url::parse(&a) {
                    Ok(u) => {
                        // piii.app's own address opens its portal (its page is a program this browser cannot run)
                        let to = if u.host == "piii.app" && u.path == "/" { PORTAL.into() } else { u.text() };
                        self.br_load("GET", &to, "", "");
                    }
                    Err(e) => self.br.status = e,
                }
            }
            Act::Portal => {
                self.br.addr = "piii.app".into();
                self.br_load("GET", PORTAL, "", "");
            }
            Act::Link(i) => {
                if let Some(to) = self.br.links.get(i).cloned() {
                    match Url::parse(&to) {
                        Ok(u) => self.br_load("GET", &u.text(), "", ""),
                        Err(e) => self.br.status = e,
                    }
                }
            }
            Act::Post => {
                let text = self.br.post.trim().to_string();
                if text.is_empty() {
                    self.br.field = Some(1);
                    self.br.status = "Write something first.".into();
                    return;
                }
                self.br.field = None;
                let body = format!("{{\"text\":{},\"name\":{}}}", web::quote(&text), web::quote(self.br.name.trim()));
                self.br.posting = true;
                self.br_load("POST", "http://piii.app/api/portal", &body, "application/json");
            }
            _ => {}
        }
    }

    /// Typing into a field: true when the key was the field's.
    pub(super) fn br_key(&mut self, k: Key) -> bool {
        let Some(n) = self.br.field else { return false };
        if self.view != View::Open(7) {
            self.br.field = None;
            return false;
        }
        let max = match n {
            0 => 200,
            1 => 1000,
            _ => 32,
        };
        let fresh = core::mem::replace(&mut self.br.fresh, false);
        if fresh && n == 0 && matches!(k, Key::Char(_) | Key::Backspace) {
            self.br.addr.clear();
            if k == Key::Backspace {
                self.dirty = true;
                return true;
            }
        }
        let s = match n {
            0 => &mut self.br.addr,
            1 => &mut self.br.post,
            _ => &mut self.br.name,
        };
        match k {
            Key::Char(c) => {
                if s.chars().count() < max {
                    s.push(c);
                }
            }
            Key::Space => {
                if s.chars().count() < max {
                    s.push(' ');
                }
            }
            Key::Backspace => {
                s.pop();
            }
            Key::Enter => {
                let a = if n == 0 { Act::Go } else { Act::Post };
                self.dirty = true;
                self.br_act(a);
                return true;
            }
            Key::Esc => self.br.field = None,
            Key::Tab | Key::BackTab => {
                self.br.field = None;
                return false;
            }
            _ => return false,
        }
        self.dirty = true;
        true
    }

    fn br_field(&mut self, f: &mut Frame, r: Rect, n: u8, text: &str, hint: &str) {
        let on = self.br.field == Some(n);
        f.superellipse(r, Some(CARD), if on { ACCENT } else { LINE }, if on { 2.0 } else { 1.4 });
        let per = ((r.w - 36.0) / SMALL.w as f64) as usize;
        let shown: String = if text.is_empty() && !on {
            String::new()
        } else {
            // the end of what is typed, where the typing is
            let cs: Vec<char> = text.chars().collect();
            cs[cs.len().saturating_sub(per.saturating_sub(1))..].iter().collect()
        };
        let ty = r.cy() - SMALL.h as f64 / 2.0;
        if shown.is_empty() && !on {
            f.text(&SMALL, r.x + 18.0, ty, hint, MUTED, 1);
        } else {
            let w = f.text(&SMALL, r.x + 18.0, ty, &shown, INK, 1);
            if on {
                f.rect(Rect::new(r.x + 18.0 + w + 1.0, ty - 2.0, 2.0, SMALL.h as f64 + 4.0), ACCENT);
            }
        }
        self.hits.push((r, Act::Field(n)));
    }

    pub(super) fn browser(&mut self, f: &mut Frame, x: f64, y: f64, w: f64) {
        // the address, and where to go
        let bw = 110.0;
        let field = Rect::new(x, y, (w - 2.0 * bw - 20.0).max(200.0), 36.0);
        let addr = self.br.addr.clone();
        self.br_field(f, field, 0, &addr, "an address: piii.app, or http://…");
        let mut bx = field.x + field.w + 10.0;
        bx += self.button(f, bx, y + 1.0, "Go", Act::Go, false) + 10.0;
        self.button(f, bx, y + 1.0, "Open portal", Act::Portal, false);
        let status = if self.br.loading { format!("{}", self.br.status) } else { self.br.status.clone() };
        let mut st = status;
        let per = (w / SMALL.w as f64) as usize;
        if st.chars().count() > per {
            st = st.chars().take(per.saturating_sub(1)).collect::<String>() + "…";
        }
        let bad = !self.br.loading && !st.contains(" · ") && !st.starts_with("Posted") && !st.is_empty();
        f.text(&SMALL, x, y + 48.0, &st, if bad { WARN } else { MUTED }, 1);
        let mut top = y + 76.0;
        // the portal: a place to write, above the posts
        if matches!(self.br.page, Page::Portal { .. }) {
            let pr = Rect::new(x, top, (w - 360.0).max(240.0), 40.0);
            let post = self.br.post.clone();
            self.br_field(f, pr, 1, &post, "Write on piii.app's Open portal: everyone sees it");
            let nr = Rect::new(pr.x + pr.w + 10.0, top, 200.0, 40.0);
            let name = self.br.name.clone();
            self.br_field(f, nr, 2, &name, "name (optional)");
            self.button(f, nr.x + nr.w + 10.0, top + 3.0, "Post", Act::Post, false);
            top += 54.0;
        }
        let area = Rect::new(x, top, w, self.h as f64 - top - 20.0);
        f.rect(area, CARD);
        f.frame(area, 1.0, LINE);
        if self.br.loading {
            f.text(&BIG, x + 20.0, top + 20.0, "Loading…", MUTED, 1);
            return;
        }
        let rows = self.br_rows((area.w - 90.0).max(100.0));
        let line_h = SMALL.h as f64 + 6.0;
        let mut fit = 0usize;
        let mut hh = 0.0;
        for r in rows.iter().skip(self.scroll as usize) {
            let h = if r.big { BIG.h as f64 + 10.0 } else { line_h };
            if hh + h > area.h - 30.0 {
                break;
            }
            hh += h;
            fit += 1;
        }
        let max_scroll = rows.len().saturating_sub(fit.max(1)) as i64;
        if self.scroll > max_scroll {
            self.scroll = max_scroll;
        }
        let mut yy = top + 16.0;
        for r in rows.iter().skip(self.scroll as usize).take(fit) {
            let font = if r.big { &BIG } else { &SMALL };
            let wdt = f.text(font, x + 20.0, yy, &r.text, r.color, 1);
            if let Some(i) = r.link {
                f.rect(Rect::new(x + 20.0, yy + font.h as f64 + 1.0, wdt, 1.0), ACCENT);
                self.hits.push((Rect::new(x + 16.0, yy - 3.0, wdt + 8.0, font.h as f64 + 6.0), Act::Link(i)));
            }
            yy += if r.big { BIG.h as f64 + 10.0 } else { line_h };
        }
        if max_scroll > 0 {
            let up = Rect::new(area.x + area.w - 50.0, top + 10.0, 36.0, 36.0);
            let dn = Rect::new(area.x + area.w - 50.0, area.y + area.h - 46.0, 36.0, 36.0);
            f.superellipse(up, Some(CARD), INK, 1.6);
            f.poly(&[(up.cx(), up.y + 10.0), (up.x + 9.0, up.y + 25.0), (up.x + 27.0, up.y + 25.0)], INK);
            f.superellipse(dn, Some(CARD), INK, 1.6);
            f.poly(&[(dn.cx(), dn.y + 26.0), (dn.x + 9.0, dn.y + 11.0), (dn.x + 27.0, dn.y + 11.0)], INK);
            self.hits.push((up, Act::Scroll(-8)));
            self.hits.push((dn, Act::Scroll(8)));
        }
    }

    /// The page, as the lines it is drawn in.
    fn br_rows(&mut self, width: f64) -> Vec<Row> {
        let per = (width / SMALL.w as f64).max(10.0) as usize;
        let bper = (width / BIG.w as f64).max(5.0) as usize;
        let mut rows = Vec::new();
        let mut links = Vec::new();
        let mut text = |rows: &mut Vec<Row>, s: &str, color: u32| {
            for l in wrap(s, per) {
                rows.push(Row { text: l, color, big: false, link: None });
            }
        };
        match &self.br.page {
            Page::Empty => {}
            Page::Portal { posts, total } => {
                rows.push(Row { text: format!("piii.app · Open portal · {} posts", total), color: MUTED, big: false, link: None });
                rows.push(Row { text: String::new(), color: INK, big: false, link: None });
                if posts.is_empty() {
                    text(&mut rows, "Nothing yet: be the first.", MUTED);
                }
                for (id, name, at, body) in posts {
                    let who = if name.is_empty() { "anonymous" } else { name.as_str() };
                    let when: String = at.chars().take(16).collect();
                    rows.push(Row { text: format!("{}  #{} · {} UTC", who, id, when), color: ACCENT, big: false, link: None });
                    text(&mut rows, body, INK);
                    rows.push(Row { text: String::new(), color: INK, big: false, link: None });
                }
            }
            Page::Doc { title, items } => {
                if !title.is_empty() {
                    for l in wrap(title, bper) {
                        rows.push(Row { text: l, color: INK, big: true, link: None });
                    }
                }
                for it in items {
                    match it {
                        Item::Heading(h) => {
                            rows.push(Row { text: String::new(), color: INK, big: false, link: None });
                            for l in wrap(h, bper) {
                                rows.push(Row { text: l, color: INK, big: true, link: None });
                            }
                        }
                        Item::Text(t) => {
                            text(&mut rows, t, INK);
                            rows.push(Row { text: String::new(), color: INK, big: false, link: None });
                        }
                        Item::Link(words, to) => {
                            let i = links.len();
                            links.push(to.clone());
                            for (k, l) in wrap(&format!("→ {}", words), per).into_iter().enumerate() {
                                rows.push(Row { text: l, color: ACCENT, big: false, link: if k == 0 { Some(i) } else { None } });
                            }
                        }
                    }
                }
            }
            Page::Lines(lines) => {
                for l in lines {
                    text(&mut rows, l, INK);
                }
            }
        }
        self.br.links = links;
        rows
    }
}
