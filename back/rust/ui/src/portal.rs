// The open portal (owner, 2026-10-17: "can you make a open portal in piii.app so whatever you type in it stays public
// and saved on the site"): anyone writes, everyone reads, newest first. The server keeps it (/api/portal) and holds
// the limits; what is written is shown as text, never as markup. Each post this browser wrote keeps the key the
// server gave for it, so its writer can take it down again; the owner can take down any. Included into app.rs.

#[derive(Default)]
pub struct OpenPortal {
    posts: Vec<Value>,
    loaded: bool,
    busy: bool,
    more: bool,
    total: usize,
    err: String,
    text: String,
    name: String,
    sending: bool,
    note: String,
    ticking: bool,
    /// a post asked to come down, waiting for "sure?"
    armed: Option<i64>,
    /// the post just copied
    copied: Option<i64>,
}

const T_PORTAL: u32 = 38;
const PORTAL_MAX: usize = 1000;
const PORTAL_KEYS: &str = "piii:portal_keys";

fn portal_open() -> bool {
    let s = st();
    matches!(s.page, Page::Item(g, m) if matches!(GROUPS.get(g as usize).and_then(|x| x.members.get(m as usize)), Some((_, Target::Tool(Tool::Portal)))))
}

/// The keys of the posts written in this browser: "id:key" separated by spaces.
fn portal_keys() -> Vec<(i64, String)> {
    host::store_get(PORTAL_KEYS)
        .unwrap_or_default()
        .split(' ')
        .filter_map(|x| {
            let (i, k) = x.split_once(':')?;
            Some((i.parse().ok()?, k.to_string()))
        })
        .collect()
}

fn portal_key(id: i64) -> Option<String> {
    portal_keys().into_iter().find(|x| x.0 == id).map(|x| x.1)
}

fn portal_keys_set(keys: &[(i64, String)]) {
    // the newest 200 are enough
    let start = keys.len().saturating_sub(200);
    let s: Vec<String> = keys[start..].iter().map(|(i, k)| format!("{}:{}", i, k)).collect();
    host::store_set(PORTAL_KEYS, &s.join(" "));
}

fn portal_load() {
    let p = &mut st().portal;
    if p.name.is_empty() {
        p.name = host::store_get("piii:portal_name").unwrap_or_default();
    }
    if !p.loaded && !p.busy {
        p.busy = true;
        request(Want::Tool(Tool::Portal, 0), "GET", "/api/portal?limit=50", "", 0);
    }
    if !p.ticking {
        p.ticking = true;
        host::timer(15_000, T_PORTAL);
    }
}

/// Every quarter minute while the portal is open: what others wrote meanwhile.
fn portal_tick() {
    let p = &mut st().portal;
    p.ticking = false;
    if portal_open() {
        if !p.busy {
            request(Want::Tool(Tool::Portal, 3), "GET", "/api/portal?limit=50", "", 0);
        }
        p.ticking = true;
        host::timer(15_000, T_PORTAL);
    }
}

fn portal_apply(what: u8, v: Value, err: Option<String>) {
    let p = &mut st().portal;
    match what {
        // the newest
        0 | 3 => {
            p.busy = false;
            match err {
                Some(e) => {
                    if what == 0 {
                        p.err = e;
                    }
                }
                None => {
                    p.err.clear();
                    let fresh: Vec<Value> = v.get("posts").arr().to_vec();
                    if what == 3 && p.loaded {
                        // only what is newer than what is shown, on top; posts taken down go
                        let top = p.posts.first().map(|x| x.get("id").f() as i64).unwrap_or(0);
                        let mut add: Vec<Value> = fresh.iter().filter(|x| x.get("id").f() as i64 > top).cloned().collect();
                        let ids: Vec<i64> = fresh.iter().map(|x| x.get("id").f() as i64).collect();
                        let low = ids.last().copied().unwrap_or(0);
                        p.posts.retain(|x| {
                            let i = x.get("id").f() as i64;
                            i < low || ids.contains(&i)
                        });
                        add.extend(p.posts.drain(..));
                        p.posts = add;
                    } else {
                        p.posts = fresh;
                        p.more = v.get("more").truthy();
                    }
                    p.total = v.get("total").f() as usize;
                    p.loaded = true;
                }
            }
        }
        // older ones
        1 => {
            p.busy = false;
            match err {
                Some(e) => p.err = e,
                None => {
                    p.posts.extend(v.get("posts").arr().iter().cloned());
                    p.more = v.get("more").truthy();
                }
            }
        }
        // written
        2 => {
            p.sending = false;
            match err {
                Some(e) => p.note = e,
                None => {
                    let id = v.get("id").f() as i64;
                    let mut keys = portal_keys();
                    keys.push((id, v.get("key").text()));
                    portal_keys_set(&keys);
                    p.text.clear();
                    p.note = "On the portal, for everyone.".into();
                    if !p.posts.iter().any(|x| x.get("id").f() as i64 == id) {
                        p.posts.insert(0, v);
                        p.total += 1;
                    }
                }
            }
        }
        // taken down
        4 => match err {
            Some(e) => p.note = e,
            None => {
                let id = v.get("deleted").f() as i64;
                p.posts.retain(|x| x.get("id").f() as i64 != id);
                p.total = p.total.saturating_sub(1);
                let keys: Vec<(i64, String)> = portal_keys().into_iter().filter(|x| x.0 != id).collect();
                portal_keys_set(&keys);
                p.note = "Taken down.".into();
            }
        },
        _ => {}
    }
}

fn portal_update(a: u16, v: String) {
    let s = st();
    let wallet = s.wallet.clone();
    let p = &mut s.portal;
    match a {
        1 => {
            p.text = v;
            p.note.clear();
        }
        2 => p.name = v,
        3 => {
            let text = p.text.trim().to_string();
            if text.is_empty() || p.sending {
                return;
            }
            if text.chars().count() > PORTAL_MAX {
                p.note = format!("At most {} characters.", PORTAL_MAX);
                return;
            }
            p.sending = true;
            p.note.clear();
            host::store_set("piii:portal_name", p.name.trim());
            let body = format!("{{\"text\":{},\"name\":{}}}", json::quote(&text), json::quote(p.name.trim()));
            request(Want::Tool(Tool::Portal, 2), "POST", "/api/portal", &body, 0);
        }
        // older
        4 => {
            if p.busy {
                return;
            }
            let last = p.posts.last().map(|x| x.get("id").f() as i64).unwrap_or(0);
            p.busy = true;
            request(Want::Tool(Tool::Portal, 1), "GET", &format!("/api/portal?limit=50&before={}", last), "", 0);
        }
        // take down: first "sure?", then down
        5 => {
            let id: i64 = v.parse().unwrap_or(0);
            if p.armed != Some(id) {
                p.armed = Some(id);
                return;
            }
            p.armed = None;
            let key = portal_key(id).unwrap_or_default();
            let body = format!("{{\"key\":{},\"wallet\":{}}}", json::quote(&key), json::quote(&wallet));
            request(Want::Tool(Tool::Portal, 4), "POST", &format!("/api/portal/{}/delete", id), &body, 0);
        }
        6 => p.armed = None,
        // copy a post's words
        7 => {
            let id: i64 = v.parse().unwrap_or(0);
            if let Some(x) = p.posts.iter().find(|x| x.get("id").f() as i64 == id) {
                host::call("copy", &x.get("text").text());
                p.copied = Some(id);
            }
        }
        _ => {}
    }
}

/// "2026-10-17 09:41:05" (UTC) → "17 Oct 2026, 09:41 UTC"
fn portal_when(at: &str) -> String {
    const M: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let b = at.as_bytes();
    if b.len() < 16 {
        return at.to_string();
    }
    let m: usize = at[5..7].parse().unwrap_or(0);
    let d: u32 = at[8..10].parse().unwrap_or(0);
    match M.get(m.wrapping_sub(1)) {
        Some(mn) => format!("{} {} {}, {} UTC", d, mn, &at[0..4], &at[11..16]),
        None => at.to_string(),
    }
}

fn portal_view(s: &State) -> N {
    let p = &s.portal;
    let name = p.name.clone();
    let n = p.text.chars().count();
    let owner = is_owner(s);
    let mine = portal_keys();
    let write = el("div")
        .cls("portal-write")
        .kid(
            el("textarea")
                .attr("rows", "4")
                .attr("maxlength", "1000")
                .attr("aria-label", "Write on the portal")
                .attr("placeholder", "Write anything. It stays here, public, for everyone who comes.")
                .prop("value", p.text.clone())
                .on("input", Msg::TV(Tool::Portal, 1)),
        )
        .kid(
            el("div")
                .cls("portal-row")
                .kid(
                    el("input")
                        .attr("type", "text")
                        .attr("maxlength", "32")
                        .attr("aria-label", "Your name (optional)")
                        .attr("placeholder", "Name (optional)")
                        .prop("value", name)
                        .on("input", Msg::TV(Tool::Portal, 2)),
                )
                .kid(el("span").cls(if n > PORTAL_MAX { "hint warn" } else { "hint" }).text(format!("{} / {}", n, PORTAL_MAX)))
                .kid(
                    el("button")
                        .attr("type", "button")
                        .cls("btn primary")
                        .attr_if(p.text.trim().is_empty() || n > PORTAL_MAX || p.sending, "disabled", "")
                        .on("click", Msg::T(Tool::Portal, 3, String::new()))
                        .text(if p.sending { "Posting…" } else { "Post" }),
                ),
        )
        .kid(el("p").cls("hint").text(p.note.clone()));
    let list: Vec<N> = p
        .posts
        .iter()
        .map(|x| -> N {
            let id = x.get("id").f() as i64;
            let who = x.get("name").text();
            let can = owner || mine.iter().any(|k| k.0 == id);
            let mut head = el("div")
                .cls("portal-head")
                .kid(el("b").attr("data-solid", "").text(if who.is_empty() { "anonymous".to_string() } else { who }))
                .kid(el("span").cls("hint").text(format!("#{} · {}", id, portal_when(&x.get("at").text()))));
            head = head.kid(
                el("button")
                    .attr("type", "button")
                    .cls("btn small portal-copy")
                    .on("click", Msg::T(Tool::Portal, 7, id.to_string()))
                    .text(if p.copied == Some(id) { "Copied" } else { "Copy" }),
            );
            if can {
                head = if p.armed == Some(id) {
                    head.kid(el("button").attr("type", "button").cls("btn small danger").on("click", Msg::T(Tool::Portal, 5, id.to_string())).text("Sure? Take it down"))
                        .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Portal, 6, String::new())).text("Keep"))
                } else {
                    head.kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Portal, 5, id.to_string())).text("Take down"))
                };
            }
            el("article").cls("portal-post").kid(head).kid(el("p").cls("portal-text").attr("data-solid", "").text(x.get("text").text())).into()
        })
        .collect();
    let mut root = el("div")
        .cls("tool portal")
        .kid(el("p").cls("lede").text("The open portal: whatever is written here is saved on the site and public. Be kind; no personal details of anyone."))
        .kid(write);
    if !p.err.is_empty() {
        root = root.kid(el("p").cls("hint warn").text(p.err.clone()));
    }
    if p.loaded {
        root = root.kid(el("p").cls("hint").text(match p.total {
            0 => "Nothing yet: be the first.".to_string(),
            1 => "1 post.".to_string(),
            t => format!("{} posts.", t),
        }));
    } else if p.busy {
        root = root.kid(el("p").cls("hint").text("Loading…"));
    }
    root = root.kid(el("div").cls("portal-list").kids(list));
    if p.more {
        root = root.kid(el("button").attr("type", "button").cls("btn").attr_if(p.busy, "disabled", "").on("click", Msg::T(Tool::Portal, 4, String::new())).text(if p.busy { "Loading…" } else { "Older posts" }));
    }
    root.into()
}

const PORTAL_CSS: &str = "\
.portal{max-width:760px}\
.portal-text,.portal-head b{user-select:text;-webkit-user-select:text;-webkit-touch-callout:default;cursor:text}\
.portal-write{display:grid;gap:8px;margin:12px 0 4px}\
.portal-write textarea,.portal-row input{font:inherit;padding:10px 12px;border:1px solid var(--line2);background:var(--card);color:var(--ink);border-radius:10px}\
.portal-write textarea{resize:vertical;min-height:90px}\
.portal-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}\
.portal-row input{flex:1 1 180px;min-width:0}\
.portal-row .btn{margin-left:auto}\
.portal-list{display:grid;gap:10px;margin:8px 0 14px}\
.portal-post{border:1px solid var(--line);background:var(--card);border-radius:12px;padding:10px 14px}\
.portal-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:13px}\
.portal-head .portal-copy{margin-left:auto}\
.portal-text{margin:6px 0 2px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}\
";
