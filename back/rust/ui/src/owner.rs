// Contact us (the bug-report and suggestion form) and the owner's console (app.js of the old page), in Rust:
// deployment numbers, reported reviews, incoming messages, the piQ grant, storage and cleanup, the settlement queue,
// the operational log, and a selective reset confirmed by typing. Everything owner-only is re-checked by the server
// on every call; hiding it here is a convenience, not the control. Included into app.rs.

#[derive(Default)]
pub struct Owner {
    // contact
    bug_status: Slot,
    bug_kind: String,
    bug_msg: String,
    bug_contact: String,
    bug_note: String,
    bug_busy: bool,
    bug_sent: Option<Value>,
    // console
    stats: Slot,
    reports: Slot,
    bugs: Slot,
    storage: Slot,
    settle: Slot,
    logs: Slot,
    grant: [String; 3],
    grant_msg: (String, &'static str),
    vacuum: bool,
    clean_msg: String,
    settle_armed: bool,
    settle_msg: String,
    // reset
    reset: Slot,
    picks: Vec<String>,
    reset_files: bool,
    reset_typed: String,
    reset_armed: bool,
    reset_msg: String,
    reset_done: Option<Value>,
    // visitors by address (owner, 2026-10-15: "detailed analytics for the owner only, to the IP address, and how much
    // that IP used"): the list over the days chosen, and the one address opened
    ips: Slot,
    ip_days: u32,
    ip_one: Slot,
    ip_sel: String,
}

const T_LOGS: u32 = 32;

fn owner_q(s: &State) -> String {
    format!("wallet={}", url_encode(&s.wallet))
}

fn bug_load() {
    let s = st();
    if s.owner.bug_status.needed() {
        s.owner.bug_status.busy = true;
        request(Want::Tool(Tool::Bug, 0), "GET", "/api/bug-report/status", "", 0);
    }
    if s.owner.bug_kind.is_empty() {
        s.owner.bug_kind = "bug".into();
    }
}

fn owner_load() {
    let s = st();
    if !is_owner(s) {
        return;
    }
    let q = owner_q(s);
    let get = |slot: &mut Slot, w: u8, url: String| {
        if slot.needed() {
            slot.busy = true;
            request(Want::Tool(Tool::Owner, w), "GET", &url, "", 0);
        }
    };
    get(&mut s.owner.stats, 0, format!("/api/admin/overview?{}", q));
    get(&mut st().owner.reports, 1, format!("/api/admin/review-reports?{}", q));
    get(&mut st().owner.bugs, 2, format!("/api/bug-report/list?{}&limit=50", q));
    get(&mut st().owner.storage, 3, format!("/api/admin/storage?{}", q));
    get(&mut st().owner.settle, 4, format!("/api/admin/settlement?{}", q));
    let days = if st().owner.ip_days == 0 { 30 } else { st().owner.ip_days };
    get(&mut st().owner.ips, 11, format!("/api/admin/ips?{}&days={}", q, days));
    get(&mut st().owner.logs, 5, "/api/logs".to_string());
    host::timer(4000, T_LOGS);
}

fn logs_tick() {
    let s = st();
    let on = matches!(s.page, Page::Item(g, m) if matches!(GROUPS.get(g as usize).and_then(|x| x.members.get(m as usize)), Some((_, Target::Tool(Tool::Owner)))));
    if on && is_owner(s) {
        request(Want::Tool(Tool::Owner, 5), "GET", "/api/logs", "", 0);
        host::timer(4000, T_LOGS);
    }
}

fn owner_apply(t: Tool, w: u8, v: Value, err: Option<String>) {
    let s = st();
    let o = &mut s.owner;
    match (t, w) {
        (Tool::Bug, 0) => put(&mut o.bug_status, v, err),
        (Tool::Bug, 1) => {
            o.bug_busy = false;
            match err {
                Some(e) => o.bug_note = format!("Could not send: {}", e),
                None => {
                    o.bug_sent = Some(v);
                    o.bug_msg.clear();
                    o.bugs.reset();
                }
            }
        }
        (Tool::Owner, 0) => put(&mut o.stats, v, err),
        (Tool::Owner, 1) => put(&mut o.reports, v, err),
        (Tool::Owner, 2) => put(&mut o.bugs, v, err),
        (Tool::Owner, 3) => put(&mut o.storage, v, err),
        (Tool::Owner, 4) => put(&mut o.settle, v, err),
        (Tool::Owner, 5) => {
            o.logs.busy = false;
            match err {
                Some(e) => o.logs.err = Some(e),
                None => o.logs.data = Some(v),
            }
        }
        (Tool::Owner, 6) => {
            o.grant_msg = match err {
                Some(e) => (e, "warn"),
                None => (v.get("message").text().or_text("Credited."), "ok"),
            };
            s.piq.reset();
        }
        (Tool::Owner, 7) => {
            o.clean_msg = match err {
                Some(e) => e,
                None => format!("Freed {} from {} file(s){}", v.get("human_freed").text(), v.get("orphans_removed").text(), if v.get("vacuumed").truthy() { ", database vacuumed." } else { "." }),
            };
            o.storage.reset();
            owner_load();
        }
        (Tool::Owner, 8) => {
            o.settle_msg = match err {
                Some(e) => format!("Settlement failed: {}", e),
                None => format!(
                    "Settled {}. Failed {}. {} still outstanding.{}",
                    v.get("settled_count").text(),
                    v.get("failed_count").text(),
                    v.get("remaining").text(),
                    v.get("failed").arr().first().map(|f| format!(" First failure: {}", f.get("reason").text())).unwrap_or_default()
                ),
            };
            o.settle.reset();
            owner_load();
        }
        (Tool::Owner, 9) => put(&mut o.reset, v, err),
        (Tool::Owner, 11) => put(&mut o.ips, v, err),
        (Tool::Owner, 12) => put(&mut o.ip_one, v, err),
        (Tool::Owner, 10) => {
            o.reset_armed = false;
            match err {
                Some(e) => o.reset_msg = e,
                None => {
                    o.reset_done = Some(v);
                    o.picks.clear();
                    o.reset_typed.clear();
                    refresh_mine();
                }
            }
        }
        _ => {}
    }
}

fn owner_update(t: Tool, a: u16, v: String) {
    let s = st();
    let ident = ident_json(s);
    let q = owner_q(s);
    let o = &mut s.owner;
    match (t, a) {
        (Tool::Bug, 1) => o.bug_kind = v,
        (Tool::Bug, 2) => o.bug_msg = v,
        (Tool::Bug, 3) => o.bug_contact = v,
        (Tool::Bug, 4) => {
            let msg = o.bug_msg.trim().to_string();
            let contact = o.bug_contact.trim().to_string();
            if msg.chars().count() < 10 {
                o.bug_note = "Please add a little more detail (at least 10 characters).".into();
                return;
            }
            let ok_mail = contact.is_empty() || {
                let parts: Vec<&str> = contact.split('@').collect();
                parts.len() == 2 && !parts[0].is_empty() && parts[1].contains('.') && !contact.contains(char::is_whitespace)
            };
            if !ok_mail {
                o.bug_note = "That email address doesn't look right. Leave it blank to report anonymously.".into();
                return;
            }
            o.bug_busy = true;
            o.bug_note.clear();
            let page = match st().page {
                Page::Item(g, m) => GROUPS.get(g as usize).and_then(|x| x.members.get(m as usize)).map(|x| x.0).unwrap_or("").to_string(),
                _ => String::new(),
            };
            let body = format!("{{\"message\":{},\"contact\":{},\"page\":{},\"kind\":{},{}}}", json::quote(&msg), json::quote(&contact), json::quote(&page), json::quote(&st().owner.bug_kind), ident);
            request(Want::Tool(Tool::Bug, 1), "POST", "/api/bug-report", &body, 0);
        }
        (Tool::Bug, 5) => {
            o.bug_sent = None;
            o.bug_msg.clear();
            o.bug_note.clear();
        }
        (Tool::Owner, n) if (1..4).contains(&n) => o.grant[(n - 1) as usize] = v,
        (Tool::Owner, 4) => {
            let amount: f64 = o.grant[1].trim().parse().unwrap_or(0.0);
            if amount == 0.0 {
                o.grant_msg = ("Enter an amount.".into(), "warn");
                return;
            }
            let target = o.grant[0].trim().to_string();
            let b = target.as_bytes();
            let is_orcid = b.len() == 19 && b.iter().enumerate().all(|(i, c)| if i % 5 == 4 { *c == b'-' } else { c.is_ascii_digit() || (i == 18 && (*c == b'X' || *c == b'x')) });
            o.grant_msg = ("Crediting…".into(), "");
            let body = format!(
                "{{\"wallet\":{},\"orcid\":{},\"amount\":{},\"reason\":{}}}",
                json::quote(if is_orcid { "" } else { &target }),
                json::quote(if is_orcid { &target } else { "" }),
                amount,
                json::quote(o.grant[2].trim())
            );
            request(Want::Tool(Tool::Owner, 6), "POST", &format!("/api/admin/grant?{}", q), &body, 0);
        }
        (Tool::Owner, 5) => o.vacuum = v == "1",
        (Tool::Owner, 6) => {
            o.clean_msg = if o.vacuum { "Cleaning and vacuuming…".into() } else { "Cleaning…".into() };
            let body = format!("{{\"orphans\":true,\"vacuum\":{},\"drain_queue\":false}}", o.vacuum);
            request(Want::Tool(Tool::Owner, 7), "POST", &format!("/api/admin/storage/cleanup?{}", q), &body, 0);
        }
        (Tool::Owner, 7) => {
            if !o.settle_armed {
                o.settle_armed = true;
                return;
            }
            o.settle_armed = false;
            o.settle_msg = "Settling…".into();
            request(Want::Tool(Tool::Owner, 8), "POST", &format!("/api/admin/settle?{}", q), "", 0);
        }
        (Tool::Owner, 8) => {
            o.reset.reset();
            o.reset.busy = true;
            o.reset_done = None;
            o.reset_msg.clear();
            request(Want::Tool(Tool::Owner, 9), "GET", &format!("/api/admin/reset/options?{}", q), "", 0);
        }
        (Tool::Owner, 9) => {
            if let Some(i) = o.picks.iter().position(|x| *x == v) {
                o.picks.remove(i);
            } else {
                o.picks.push(v);
            }
            o.reset_armed = false;
        }
        (Tool::Owner, 10) => o.reset_files = v == "1",
        (Tool::Owner, 11) => o.reset_typed = v,
        (Tool::Owner, 12) => {
            if !o.reset_armed {
                o.reset_armed = true;
                return;
            }
            let groups: Vec<String> = o.picks.iter().map(|x| json::quote(x)).collect();
            let body = format!("{{\"groups\":[{}],\"confirm\":{},\"clear_files\":{},\"wallet\":{}}}", groups.join(","), json::quote(o.reset_typed.trim()), o.reset_files, json::quote(&st().wallet));
            st().owner.reset_msg = "Resetting…".into();
            request(Want::Tool(Tool::Owner, 10), "POST", "/api/admin/reset", &body, 0);
        }
        (Tool::Owner, 13) => {
            o.reset.reset();
            o.reset_done = None;
        }
        (Tool::Owner, 14) => {
            o.ip_days = v.parse().unwrap_or(30);
            o.ips.reset();
            owner_load();
        }
        (Tool::Owner, 15) => {
            o.ip_sel = v.clone();
            o.ip_one.reset();
            o.ip_one.busy = true;
            request(Want::Tool(Tool::Owner, 12), "GET", &format!("/api/admin/ips/one?{}&ip={}", q, url_encode(&v)), "", 0);
        }
        (Tool::Owner, 16) => {
            o.ip_sel.clear();
            o.ip_one.reset();
        }
        (Tool::Owner, 17) => {
            o.ips.reset();
            owner_load();
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------------------------- views

fn bug_view(s: &State) -> N {
    let o = &s.owner;
    if let Some(d) = &o.bug_sent {
        return el("div")
            .cls("tool")
            .kid(el("h2").text("Message sent"))
            .kid(el("p").text(d.get("message").text().or_text("Thank you.")))
            .kid(el("p").cls("hint").text(format!("Reference #{} — quote this if you follow up.", d.get("id").text())))
            .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Bug, 5, String::new())).text("Send another message"))
            .into();
    }
    let status = o.bug_status.data.as_ref();
    let mut kinds: Vec<(String, String)> = status.map(|d| d.get("kinds").arr().iter().map(|k| (k.get("id").text(), k.get("label").text())).collect()).unwrap_or_default();
    if kinds.is_empty() {
        kinds = alloc::vec![("bug".into(), "Something is broken".into()), ("suggestion".into(), "An idea or suggestion".into())];
    }
    let (label, ph) = if o.bug_kind == "suggestion" {
        ("What would you like to see?", "What would you change or add, and what would it let you do that you cannot do today?")
    } else {
        ("What went wrong?", "What were you doing, what did you expect, and what happened instead? If you saw an error reference, paste it here.")
    };
    let n = o.bug_msg.trim().chars().count();
    el("div")
        .cls("tool bug")
        .kid(el("p").cls("lede").text(status.map(|d| d.get("note").text()).unwrap_or_default().or_text("Write to the lab: a problem you hit, or an idea.")))
        .kid(el("label").cls("field").kid(el("span").text("What is this about?")).kid(el("select").on_val("change", |v| Msg::T(Tool::Bug, 1, v)).kids(kinds.iter().map(|(id, l)| -> N { el("option").attr("value", id.clone()).attr_if(*id == o.bug_kind, "selected", "").text(l.clone()).into() }))))
        .kid(el("label").cls("field").kid(el("span").text(label)).kid(el("textarea").attr("rows", "6").attr("maxlength", "5000").attr("placeholder", ph).prop("value", o.bug_msg.clone()).on("input", Msg::TV(Tool::Bug, 2))))
        .kid(el("p").cls("hint").text(format!("{} / 5000", o.bug_msg.chars().count())))
        .kid(el("label").cls("field").kid(el("span").text("Your email — optional, only so you can be replied to")).kid(el("input").attr("type", "email").attr("maxlength", "200").attr("placeholder", "you@example.com").attr("autocomplete", "email").prop("value", o.bug_contact.clone()).on("input", Msg::TV(Tool::Bug, 3))))
        .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn primary").attr_if(n < 10 || o.bug_busy, "disabled", "").on("click", Msg::T(Tool::Bug, 4, String::new())).text(if o.bug_busy { "Sending…" } else { "Send" })).kid(el("span").cls("hint warn").text(o.bug_note.clone())))
        .into()
}

fn kv_row(k: &str, v: String) -> N {
    el("div").cls("pc-head").kid(el("span").text(k.to_string())).kid(el("b").text(v)).into()
}

fn owner_view(s: &State) -> N {
    if let Some(n) = owner_only(s) {
        return n;
    }
    let o = &s.owner;
    let stats = slot_view(&o.stats, "Loading…", |d| {
        let signups = d.get("accounts_with_balance").f().max(d.get("distinct_submitters").f());
        let idle = d.get("idle");
        let idle_rows: N = if !idle.get("enabled").truthy() {
            el("p").cls("hint").text("Idle assessments: off. Set ENABLE_IDLE_ASSESSMENTS to have the site assess open-access papers while nobody is using it.").into()
        } else {
            let state = if idle.get("running").truthy() {
                "assessing now".to_string()
            } else if idle.get("site_is_idle").truthy() {
                "idle — eligible to run".to_string()
            } else {
                format!("waiting ({}s of quiet needed)", (idle.get("idle_threshold").f() - idle.get("idle_seconds").f()).max(0.0) as i64)
            };
            el("div")
                .kid(el("h4").text("Idle assessments"))
                .kid(kv_row("State", state))
                .kid(kv_row("Today", format!("{} of {}", idle.get("assessed_today").text(), idle.get("daily_cap").text())))
                .kid(kv_row("Attempted", idle.get("attempted_today").text()))
                .kid_if(!idle.get("last_title").str().is_empty(), || kv_row("Last", idle.get("last_title").text()))
                .kid_if(!idle.get("last_error").str().is_empty(), || el("p").cls("hint warn").text(format!("Last error: {}", idle.get("last_error").text())).into())
                .kid(el("p").cls("hint").text(idle.get("funding").text()))
                .into()
        };
        el("div")
            .cls("perf-cards")
            .kid(el("div").cls("perf-card").kid(el("h4").text("People")).kid(kv_row("Signed up", num(signups, 0))).kid(kv_row("Saved profiles", num(d.get("saved_profiles").f(), 0))).kid(kv_row("Active · 7 days", num(d.get("active_7d").f(), 0))).kid(kv_row("Active · 30 days", num(d.get("active_30d").f(), 0))).kid(kv_row("Unique visitors", num(d.get("visitors").get("unique").f(), 0))))
            .kid(el("div").cls("perf-card").kid(el("h4").text("Activity")).kid(kv_row("Papers · total", num(d.get("papers_total").f(), 0))).kid(kv_row("Papers · 7 days", num(d.get("papers_7d").f(), 0))).kid(kv_row("Published", num(d.get("published").f(), 0))).kid(kv_row("Peer reviews", num(d.get("reviews_human").f(), 0))).kid(kv_row("LLM reviews", num(d.get("reviews_llm").f(), 0))).kid(kv_row("Awaiting a reviewer", num(d.get("reviews_open").f(), 0))))
            .kid(el("div").cls("perf-card").kid(el("h4").text("piQ")).kid(kv_row("Minted", format!("{:.2}", d.get("piq_minted").f()))).kid(kv_row("Held", format!("{:.2}", d.get("piq_held").f()))).kid(idle_rows))
            .into()
    });
    let reports = slot_view(&o.reports, "Loading…", |d| {
        let rs = d.get("reports").arr();
        if rs.is_empty() {
            return el("p").cls("hint").text("No reviews have been reported.").into();
        }
        el("div")
            .kids(rs.iter().map(|r| -> N {
                el("div")
                    .cls("card owner-item warn")
                    .kid(el("div").cls("pc-head").kid(el("span").cls("hint").text(r.get("created_at").str().chars().take(16).collect::<String>())).kid(el("b").text(r.get("reason").text().or_text("reported"))))
                    .kid(el("div").text(r.get("title").text().or_text("Untitled")))
                    .kid_if(!r.get("detail").str().is_empty(), || el("div").cls("hint").text(r.get("detail").text()).into())
                    .kid(el("div").cls("hint").text(format!("review #{}", r.get("review_id").text())))
                    .kid_if(!r.get("eval_hash").str().is_empty(), || act_btn("Read the review", "peer-review", r.get("eval_hash").str(), ""))
                    .into()
            }))
            .into()
    });
    let bugs = slot_view(&o.bugs, "Loading…", |d| {
        let rs = d.get("reports").arr();
        if rs.is_empty() {
            return el("p").cls("hint").text("Nobody has sent a message yet.").into();
        }
        el("div")
            .kids(rs.iter().map(|r| -> N {
                el("div")
                    .cls("card owner-item")
                    .cls_if(!r.get("delivered").truthy(), "warn")
                    .kid(el("div").cls("pc-head").kid(el("span").cls("hint").text(format!("{} · {}", if r.get("kind").str() == "suggestion" { "idea" } else { "bug" }, r.get("created_at").str().chars().take(16).collect::<String>()))).kid(el("span").text(if r.get("delivered").truthy() { "emailed" } else { "not emailed" })))
                    .kid(el("div").style("white-space:pre-wrap").text(r.get("message").text()))
                    .kid(el("div").cls("hint").text([r.get("contact").text(), r.get("identity").text(), r.get("page").text()].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join(" · ")))
                    .kid_if(!r.get("delivery_error").str().is_empty(), || el("div").cls("hint warn").text(r.get("delivery_error").text()).into())
                    .into()
            }))
            .into()
    });
    let grant = el("div")
        .kid(el("label").cls("field").kid(el("span").text("Wallet or ORCID")).kid(el("input").attr("type", "text").prop("value", o.grant[0].clone()).on("input", Msg::TV(Tool::Owner, 1))))
        .kid(el("label").cls("field").kid(el("span").text("Amount (piQ; negative to debit)")).kid(el("input").attr("type", "number").attr("step", "0.5").prop("value", o.grant[1].clone()).on("input", Msg::TV(Tool::Owner, 2))))
        .kid(el("label").cls("field").kid(el("span").text("Reason")).kid(el("input").attr("type", "text").prop("value", o.grant[2].clone()).on("input", Msg::TV(Tool::Owner, 3))))
        .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Owner, 4, String::new())).text("Credit")).kid(el("span").cls("hint").cls(o.grant_msg.1).text(o.grant_msg.0.clone())));
    let storage = slot_view(&o.storage, "Loading…", |d| {
        let orphans = d.get("orphans").get("count").f() as i64;
        el("div")
            .kid_if(!d.get("disk").get("percent_used").is_null(), || kv_row("Volume used", format!("{}%", d.get("disk").get("percent_used").text())))
            .kid(kv_row("Database", d.get("database").get("human").text()))
            .kid(kv_row("Manuscripts", format!("{} · {} files", d.get("manuscripts").get("human").text(), d.get("manuscripts").get("files").text())))
            .kid_if(!d.get("manuscript_cap").get("percent_used").is_null(), || kv_row("Manuscript cap", format!("{}% of {}", d.get("manuscript_cap").get("percent_used").text(), d.get("manuscript_cap").get("human").text())))
            .kid_if(!d.get("manuscript_cap").get("warning").str().is_empty(), || el("p").cls("hint warn").text(d.get("manuscript_cap").get("warning").text()).into())
            .kid(kv_row("Logs", d.get("logs").get("human").text()))
            .kid(kv_row("Orphaned files", format!("{} · {}", orphans, d.get("orphans").get("human").text())))
            .kid(el("p").cls("hint").text(d.get("note").text()))
            .kid(el("label").cls("am-check").kid(el("input").attr("type", "checkbox").prop("checked", if o.vacuum { "1" } else { "0" }).on("change", Msg::TV(Tool::Owner, 5))).kid(txt(" Also VACUUM the database")))
            .kid(el("button").attr("type", "button").cls("btn small").attr_if(orphans == 0, "disabled", "").on("click", Msg::T(Tool::Owner, 6, String::new())).text(format!("Delete {} orphaned file{}", orphans, if orphans == 1 { "" } else { "s" })))
            .kid(el("p").cls("hint").text(o.clean_msg.clone()))
            .into()
    });
    let settle = slot_view(&o.settle, "Loading…", |d| {
        if d.get("count").f() == 0.0 {
            return el("p").cls("hint").text("Nothing waiting to be settled on chain.").into();
        }
        let blockers = d.get("blockers").arr();
        el("div")
            .kid(kv_row("Unsettled papers", d.get("count").text()))
            .kid(kv_row("piQ owed on chain", format!("{:.2}", d.get("total_piq").f())))
            .kid(el("p").cls("hint").text(d.get("note").text()))
            .kid(if blockers.is_empty() {
                el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Owner, 7, String::new())).text(if o.settle_armed { format!("Really mint up to 10? Each costs gas ({} outstanding)", d.get("count").text()) } else { "Settle up to 10 on chain".to_string() })
            } else {
                el("div").cls("hint warn").kids(blockers.iter().map(|b| -> N { el("div").text(format!("· {}", b.text())).into() }))
            })
            .kid(el("p").cls("hint").text(o.settle_msg.clone()))
            .into()
    });
    let logs: N = match (&o.logs.data, &o.logs.err) {
        (Some(d), _) => el("pre").cls("lab-text owner-logs").text(if d.get("logs").arr().is_empty() { "No active logs…".to_string() } else { d.get("logs").arr().iter().map(|x| x.text()).collect::<Vec<_>>().join("\n") }).into(),
        (None, Some(_)) => el("p").cls("hint").text("Restricted — the operational log is visible to the owner wallet only.").into(),
        _ => spinner("Loading…"),
    };
    let reset: N = if let Some(d) = &o.reset_done {
        el("div")
            .kid(el("p").cls("lede").text(d.get("message").text().or_text("Done.")))
            .kid(el("table").cls("data-table").kid(el("tbody").kids(d.get("deleted").entries().iter().map(|(t, n)| -> N { el("tr").kid(el("td").text(t.clone())).kid(el("td").text(n.text())).into() }))))
            .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Owner, 13, String::new())).text("Done"))
            .into()
    } else if o.reset.data.is_none() && !o.reset.busy && o.reset.err.is_none() {
        el("button").attr("type", "button").cls("btn danger").on("click", Msg::T(Tool::Owner, 8, String::new())).text("Reset platform state…").into()
    } else {
        slot_view(&o.reset, "Reading current contents…", |d| {
            let opts: Vec<&Value> = d.get("options").arr().iter().filter(|x| x.get("available").truthy()).collect();
            let files = d.get("stored_files").f();
            let ready = !o.picks.is_empty() && o.reset_typed.trim() == "RESET";
            let destroys: Vec<String> = opts.iter().filter(|x| o.picks.contains(&x.get("id").text())).map(|x| x.get("destroys").text()).collect();
            el("div")
                .kid(el("div").cls("warning-box").kid(el("b").text("This cannot be undone. ")).kid(txt("Only the groups you tick are touched. The whole reset runs in one transaction, so if any part fails, nothing is deleted.")))
                .kids(opts.iter().map(|x| -> N {
                    let id = x.get("id").text();
                    el("label")
                        .cls("am-check reset-row")
                        .kid(el("input").attr("type", "checkbox").prop("checked", if o.picks.contains(&id) { "1" } else { "0" }).on("change", Msg::T(Tool::Owner, 9, id.clone())))
                        .kid(el("span").kid(el("b").text(x.get("label").text())).kid(el("span").cls("hint").text(format!(" {} row{} — {}", num(x.get("rows").f(), 0), if x.get("rows").f() == 1.0 { "" } else { "s" }, x.get("detail").text()))))
                        .into()
                }))
                .kid_if(files != 0.0, || {
                    el("label")
                        .cls("am-check reset-row")
                        .kid(el("input").attr("type", "checkbox").prop("checked", if o.reset_files { "1" } else { "0" }).on("change", Msg::TV(Tool::Owner, 10)))
                        .kid(el("span").kid(el("b").text("Also delete stored manuscript files")).kid(el("span").cls("hint").text(if files < 0.0 { " count unavailable".to_string() } else { format!(" {} file(s) — only applies when Assessed papers is selected", files as i64) })))
                        .into()
                })
                .kid(el("label").cls("field").kid(el("span").text("Type RESET to confirm")).kid(el("input").attr("type", "text").attr("autocomplete", "off").attr("placeholder", "RESET").prop("value", o.reset_typed.clone()).on("input", Msg::TV(Tool::Owner, 11))))
                .kid(el("button").attr("type", "button").cls("btn danger").attr_if(!ready, "disabled", "").on("click", Msg::T(Tool::Owner, 12, String::new())).text(if o.reset_armed { format!("Permanently delete {}?", destroys.join(", ")) } else { "Reset selected".to_string() }))
                .kid(el("p").cls("hint warn").text(o.reset_msg.clone()))
                .into()
        })
    };
    let ips = ips_view(o);
    let section = |title: &str, body: N| -> N { el("section").cls("card owner-sec").kid(el("h3").text(title.to_string())).kid(body).into() };
    el("div")
        .cls("tool owner")
        .kid(el("p").cls("lede").text("The owner's console. Everything here is re-checked by the server against your signed session."))
        .kid(section("Deployment", stats))
        .kid(section("Visitors by address", ips))
        .kid(section("Reported reviews", reports))
        .kid(section("Messages", bugs))
        .kid(section("Grant piQ", grant.into()))
        .kid(section("Storage", storage))
        .kid(section("Settlement", settle))
        .kid(section("Operational log", logs))
        .kid(section("Reset", reset))
        .into()
}

fn bytes_h(b: f64) -> String {
    if b >= 1e9 { format!("{:.1} GB", b / 1e9) } else if b >= 1e6 { format!("{:.1} MB", b / 1e6) } else if b >= 1e3 { format!("{:.0} kB", b / 1e3) } else { format!("{} B", b as i64) }
}

/// Each address (of visitors who ticked "Count my visit"): how much it used and what; one opened, day by day.
fn ips_view(o: &Owner) -> N {
    let days = if o.ip_days == 0 { 30 } else { o.ip_days };
    let pick = el("div").cls("row ip-days").kid(el("span").cls("hint").text("Last")).kids([1u32, 7, 30, 90].iter().map(|d| -> N {
        el("button").attr("type", "button").cls("btn small").cls_if(*d == days, "primary").on("click", Msg::T(Tool::Owner, 14, d.to_string())).text(if *d == 1 { "day".to_string() } else { format!("{} days", d) }).into()
    })).kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Owner, 17, String::new())).text("Refresh"));
    let list = slot_view(&o.ips, "Loading…", |d| {
        let t = d.get("totals");
        let rows = d.get("ips").arr();
        let head = el("p").cls("hint").text(format!("{} address{} · {} requests · {} page views · {} sent. Only visitors who ticked “Count my visit” are recorded; kept {} days; seen by you only.", num(t.get("addresses").f(), 0), if t.get("addresses").f() == 1.0 { "" } else { "es" }, num(t.get("requests").f(), 0), num(t.get("views").f(), 0), bytes_h(t.get("bytes").f()), d.get("retention_days").text()));
        if rows.is_empty() {
            return el("div").kid(head).kid(el("p").cls("hint").text("Nobody recorded in this time.")).into();
        }
        el("div")
            .kid(head)
            .kid(
                el("div").cls("ip-wrap").kid(
                    el("table")
                        .cls("data-table ip-table")
                        .kid(el("thead").kid(el("tr").kid(el("th").text("Address")).kid(el("th").text("Requests")).kid(el("th").text("Page views")).kid(el("th").text("Sent")).kid(el("th").text("Days")).kid(el("th").text("Last seen")).kid(el("th").text("Most used"))))
                        .kid(el("tbody").kids(rows.iter().map(|x| -> N {
                            let ip = x.get("ip").text();
                            let top: Vec<String> = x.get("top").arr().iter().take(3).map(|t| format!("{} ×{}", t.get("path").text(), t.get("hits").text())).collect();
                            el("tr")
                                .cls_if(o.ip_sel == ip, "sel")
                                .kid(el("td").kid(el("button").attr("type", "button").cls("linkish").attr("title", x.get("ua").text()).on("click", Msg::T(Tool::Owner, 15, ip.clone())).text(ip.clone())))
                                .kid(el("td").text(num(x.get("requests").f(), 0)))
                                .kid(el("td").text(num(x.get("views").f(), 0)))
                                .kid(el("td").text(bytes_h(x.get("bytes").f())))
                                .kid(el("td").text(x.get("days").text()))
                                .kid(el("td").text(x.get("last").str().chars().take(16).collect::<String>()))
                                .kid(el("td").cls("ip-top").text(top.join(" · ")))
                                .into()
                        }))),
                ),
            )
            .into()
    });
    let one: N = if o.ip_sel.is_empty() {
        el("span").into()
    } else {
        slot_view(&o.ip_one, "Loading the address…", |d| {
            el("div")
                .cls("ip-one card")
                .kid(el("div").cls("pc-head").kid(el("b").text(d.get("ip").text())).kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Owner, 16, String::new())).text("Close")))
                .kid_if(!d.get("ua").str().is_empty(), || el("p").cls("hint").text(d.get("ua").text()).into())
                .kid(el("h4").text("Day by day"))
                .kid(el("table").cls("data-table").kid(el("thead").kid(el("tr").kid(el("th").text("Day")).kid(el("th").text("Requests")).kid(el("th").text("Pages")).kid(el("th").text("API")).kid(el("th").text("Page views")).kid(el("th").text("Sent")).kid(el("th").text("From–to (UTC)")))).kid(el("tbody").kids(d.get("days").arr().iter().map(|x| -> N {
                    el("tr")
                        .kid(el("td").text(x.get("day").text()))
                        .kid(el("td").text(num(x.get("requests").f(), 0)))
                        .kid(el("td").text(num(x.get("pages").f(), 0)))
                        .kid(el("td").text(num(x.get("api").f(), 0)))
                        .kid(el("td").text(num(x.get("views").f(), 0)))
                        .kid(el("td").text(bytes_h(x.get("bytes").f())))
                        .kid(el("td").text(format!("{}–{}", x.get("first").str().get(11..16).unwrap_or(""), x.get("last").str().get(11..16).unwrap_or(""))))
                        .into()
                }))))
                .kid(el("h4").text("What it used"))
                .kid(el("table").cls("data-table").kid(el("tbody").kids(d.get("paths").arr().iter().map(|x| -> N {
                    el("tr").kid(el("td").cls("ip-path").text(x.get("path").text())).kid(el("td").text(num(x.get("hits").f(), 0))).kid(el("td").cls("hint").text(x.get("last").str().chars().take(16).collect::<String>())).into()
                }))))
                .into()
        })
    };
    el("div").kid(pick).kid(list).kid(one).into()
}

const OWNER_CSS: &str = "\
.owner-sec{margin:12px 0}.owner-sec h3{margin:0 0 8px}\
.owner-item{margin:8px 0}.owner-item.warn{border-left:3px solid var(--warn)}\
.owner-logs{max-height:320px;font-size:12px}\
.reset-row{align-items:flex-start;margin:8px 0}\
.ip-days{gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 8px}.ip-wrap{overflow-x:auto}.ip-table td,.ip-table th{white-space:nowrap}.ip-table td.ip-top{white-space:normal;font-size:12px;color:var(--muted);min-width:220px}.ip-table tr.sel td{background:color-mix(in srgb,var(--accent,#3b82f6) 8%,transparent)}\
.linkish{border:0;background:none;padding:0;font:inherit;color:var(--accent,#2563eb);cursor:pointer;text-decoration:underline}.ip-one{margin-top:12px}.ip-one h4{margin:12px 0 6px}.ip-path{font-family:var(--mono,monospace);font-size:12px;word-break:break-all}\
.bug textarea,.bug input,.bug select,.owner input,.owner select{font:inherit;padding:7px 9px;border:1px solid var(--line2);background:var(--surface)}\
";
