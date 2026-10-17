// What an author and a reviewer can do with an assessment (app.js of the old page), in Rust: the history with its
// actions, badges that open what they claim, requesting peer and LLM reviews, writing a review, replying to one,
// rating and reporting, publishing and unpublishing, withdrawing, claiming held piQ, a suggested defense, and
// clearing one's history. Every confirmation happens in a window (no browser dialogs). Included into app.rs.

pub enum Modal {
    Info(String, String),
    Help(String),
    Defense { slot: Slot },
    Remove { hash: String, busy: bool, err: String },
    Claim { hash: String, title: String, author: String, matched: String, amount: f64 },
    Review { hash: String, st: Slot, bounty: String, confirm: Option<u8>, msg: String, busy: bool, queued: bool },
    Reviews { hash: String, st: Slot, llm: bool },
    Write { hash: String, elig: Slot, open: Slot, st: Slot, verdict: String, comment: String, msg: String, busy: bool, done: Option<String> },
    Rebut { hash: String, id: i64, llm: bool, body: String, msg: String, busy: bool },
    Report { id: i64, reasons: Slot, reason: String, detail: String, msg: String, busy: bool, done: Option<String> },
    Publish { hash: String, st: Slot, kind: String, doi: String, dist: bool, msg: String, busy: bool, done: bool },
    Unpublish { hash: String, busy: bool, msg: String },
    Clear { typed: String, msg: String, busy: bool, done: Option<String> },
}

const T_JOBS: u32 = 31;

#[derive(Default)]
pub struct Rev {
    claimable: Slot,
    toasts: Vec<(bool, String, String, String)>, // ok, title, message, hash
    seen_jobs: Vec<i64>,
    jobs_seeded: bool,
    watching: bool,
}

fn open_modal(m: Modal) {
    st().modal = Some(m);
}

fn rev_url(hash: &str, tail: &str) -> String {
    format!("/api/assessments/{}{}", url_encode(hash), tail)
}

fn refresh_mine() {
    let s = st();
    s.mine.reset();
    s.piq.reset();
    s.rev.claimable.reset();
    load();
}

// ---------------------------------------------------------------------------------------------- opening each window

fn rv_open(kind: &str, hash: &str) {
    let s = st();
    let q = ident_query(s);
    let h = hash.to_string();
    match kind {
        "defense" => {
            open_modal(Modal::Defense { slot: Slot { busy: true, ..Slot::default() } });
            request(Want::Tool(Tool::Rev, 1), "GET", &format!("/api/explorer/dossier/{}", url_encode(hash)), "", 0);
        }
        "remove" => open_modal(Modal::Remove { hash: h, busy: false, err: String::new() }),
        "review" => {
            open_modal(Modal::Review { hash: h, st: Slot { busy: true, ..Slot::default() }, bounty: String::new(), confirm: None, msg: String::new(), busy: false, queued: false });
            request(Want::Tool(Tool::Rev, 3), "GET", &format!("{}?{}", rev_url(hash, "/review"), q), "", 0);
        }
        "llm-review" | "peer-review" => {
            open_modal(Modal::Reviews { hash: h, st: Slot { busy: true, ..Slot::default() }, llm: kind == "llm-review" });
            request(Want::Tool(Tool::Rev, 4), "GET", &format!("{}?{}", rev_url(hash, "/review"), q), "", 0);
        }
        "write-review" => {
            let busy = || Slot { busy: true, ..Slot::default() };
            open_modal(Modal::Write { hash: h, elig: busy(), open: busy(), st: busy(), verdict: String::new(), comment: String::new(), msg: String::new(), busy: false, done: None });
            request(Want::Tool(Tool::Rev, 5), "GET", &format!("/api/reviews/eligibility?{}", q), "", 0);
            request(Want::Tool(Tool::Rev, 6), "GET", &format!("/api/reviews/open?{}", q), "", 0);
            request(Want::Tool(Tool::Rev, 7), "GET", &format!("{}?{}", rev_url(hash, "/review"), q), "", 0);
        }
        "publish" => {
            open_modal(Modal::Publish { hash: h, st: Slot { busy: true, ..Slot::default() }, kind: "author".into(), doi: String::new(), dist: false, msg: String::new(), busy: false, done: false });
            request(Want::Tool(Tool::Rev, 8), "GET", &format!("{}?{}", rev_url(hash, "/publish"), q), "", 0);
        }
        "withdraw" => open_modal(Modal::Unpublish { hash: h, busy: false, msg: String::new() }),
        "claim" => {
            request(Want::Tool(Tool::Rev, 10), "POST", &format!("{}?{}", rev_url(hash, "/claim"), q), "", 0);
        }
        "clear" => open_modal(Modal::Clear { typed: String::new(), msg: String::new(), busy: false, done: None }),
        "file" => host::open(&format!("/api/papers/{}/file", url_encode(hash))),
        _ => host::go(&format!("#/paper/{}", hash)),
    }
}

// ---------------------------------------------------------------------------------------------- answers

fn rev_apply(w: u8, v: Value, err: Option<String>) {
    let s = st();
    let q = ident_query(s);
    match (w, s.modal.as_mut()) {
        // the dossier, for a defense: its scores go to the strategist
        (1, Some(Modal::Defense { slot })) => match err {
            Some(e) => put(slot, Value::Null, Some(e)),
            None => {
                let scores = if v.get("scores_dict").truthy() { v.get("scores_dict") } else { v.get("criteria_breakdown") };
                let mut body = String::from("{\"scores\":");
                json::write(scores, &mut body);
                body.push('}');
                request(Want::Tool(Tool::Rev, 2), "POST", "/api/defense-strategy", &body, 0);
            }
        },
        (2, Some(Modal::Defense { slot })) => put(slot, v, err),
        (3, Some(Modal::Review { st: slot, bounty, .. })) => {
            if err.is_none() {
                *bounty = format!("{:.2}", if v.get("fee").get("fee").is_null() { 2.0 } else { v.get("fee").get("fee").f() });
            }
            put(slot, v, err)
        }
        (4, Some(Modal::Reviews { st: slot, .. })) => put(slot, v, err),
        (5, Some(Modal::Write { elig, .. })) => put(elig, v, err),
        (6, Some(Modal::Write { open, .. })) => put(open, v, err),
        (7, Some(Modal::Write { st: slot, .. })) => put(slot, v, err),
        (8, Some(Modal::Publish { st: slot, doi, .. })) => {
            if err.is_none() {
                *doi = v.get("doi").text();
            }
            put(slot, v, err)
        }
        // a review request placed (or cancelled)
        (9, Some(Modal::Review { msg, busy, queued, hash, .. })) => {
            *busy = false;
            match err {
                Some(e) => *msg = e,
                None => {
                    *msg = v.get("message").text();
                    if v.get("queued").truthy() {
                        *queued = true;
                        jobs_watch(true);
                    }
                    let h = hash.clone();
                    refresh_mine();
                    request(Want::Tool(Tool::Rev, 3), "GET", &format!("{}?{}", rev_url(&h, "/review"), q), "", 0);
                }
            }
        }
        // a claim
        (10, _) => {
            let text = match &err {
                Some(e) => format!("Could not claim: {}", e),
                None if v.get("claimed").truthy() => v.get("message").text(),
                None => format!(
                    "{}{}",
                    v.any(&["message", "detail"]).text().or_text("Could not claim."),
                    if v.get("how_to_fix").str().is_empty() { String::new() } else { format!("\n\n{}", v.get("how_to_fix").text()) }
                ),
            };
            open_modal(Modal::Info("Claim held piQ".into(), text));
            refresh_mine();
        }
        (11, _) => {
            // disowned: the suggestion goes
            st().rev.claimable.reset();
            load();
        }
        (12, Some(Modal::Remove { busy, err: e, .. })) => {
            *busy = false;
            match err {
                Some(x) => *e = format!("Could not remove that paper: {}", x),
                None => {
                    st().modal = None;
                    refresh_mine();
                    buddy_fetch();
                }
            }
        }
        (13, Some(Modal::Write { busy, msg, done, .. })) => {
            *busy = false;
            match err {
                Some(e) => *msg = e,
                None => {
                    *done = Some(v.get("message").text().or_text("Your review was recorded."));
                    refresh_mine();
                }
            }
        }
        (14, Some(Modal::Rebut { busy, msg, hash, llm, .. })) => {
            *busy = false;
            match err {
                Some(e) => *msg = e,
                None => {
                    let (h, l) = (hash.clone(), *llm);
                    rv_open(if l { "llm-review" } else { "peer-review" }, &h);
                }
            }
        }
        (15, Some(Modal::Report { reasons, .. })) => put(reasons, v, err),
        (16, Some(Modal::Report { busy, msg, done, .. })) => {
            *busy = false;
            match err {
                Some(e) => *msg = e,
                None => *done = Some(v.get("message").text().or_text("A moderator will look at this review.")),
            }
        }
        (17, Some(Modal::Reviews { hash, llm, .. })) => {
            // a vote landed: read the reviews again
            let (h, l) = (hash.clone(), *llm);
            if let Some(e) = err {
                open_modal(Modal::Info("Rating".into(), e));
            } else {
                rv_open(if l { "llm-review" } else { "peer-review" }, &h);
            }
        }
        (18, Some(Modal::Publish { busy, msg, done, .. })) => {
            *busy = false;
            match err {
                Some(e) => *msg = e,
                None => {
                    *msg = v.get("message").text().or_text("Published.");
                    *done = true;
                    refresh_mine();
                    s.dossier.reset();
                }
            }
        }
        (19, Some(Modal::Unpublish { busy, msg, .. })) => {
            *busy = false;
            match err {
                Some(e) => *msg = format!("Could not update: {}", e),
                None => {
                    open_modal(Modal::Info("Unpublished".into(), v.get("message").text().or_text("Unpublished.")));
                    refresh_mine();
                    st().dossier.reset();
                }
            }
        }
        (20, Some(Modal::Clear { busy, msg, done, .. })) => {
            *busy = false;
            match err {
                Some(e) => *msg = e,
                None => {
                    *done = Some(v.get("message").text().or_text("Done."));
                    st().studio.selection.clear();
                    refresh_mine();
                }
            }
        }
        (21, _) => put(&mut st().rev.claimable, v, err),
        (22, _) => jobs_answer(v),
        _ => {}
    }
}

trait OrText {
    fn or_text(self, d: &str) -> String;
}
impl OrText for String {
    fn or_text(self, d: &str) -> String {
        if self.trim().is_empty() { d.to_string() } else { self }
    }
}

// ---------------------------------------------------------------------------------------------- actions

const RV_OPEN: u16 = 1; // value: kind\thash
const RV_CLOSE: u16 = 2;
const RV_BOUNTY: u16 = 3;
const RV_ASK: u16 = 4; // value: peer | llm (asks to confirm)
const RV_YES: u16 = 5; // confirmed
const RV_CANCEL_REQ: u16 = 6;
const RV_VERDICT: u16 = 7;
const RV_COMMENT: u16 = 8;
const RV_SUBMIT: u16 = 9;
const RV_VOTE: u16 = 10; // value: id,±1
const RV_REBUT: u16 = 11; // value: id
const RV_REPORT: u16 = 12; // value: id
const RV_REASON: u16 = 13;
const RV_DETAIL: u16 = 14;
const RV_KIND: u16 = 15;
const RV_DOI: u16 = 16;
const RV_DIST: u16 = 17;
const RV_CLAIM_YES: u16 = 18;
const RV_CLAIM_NO: u16 = 19;
const RV_CLAIM_ASK: u16 = 20; // value: hash\ttitle\tauthor\tmatched\tamount
const RV_TYPED: u16 = 21;
const RV_TOAST: u16 = 22; // value: index to dismiss

fn rev_update(a: u16, v: String) {
    let s = st();
    let q = ident_query(s);
    let ident = ident_json(s);
    match a {
        RV_OPEN => {
            let (k, h) = v.split_once('\t').unwrap_or((v.as_str(), ""));
            let (k, h) = (k.to_string(), h.to_string());
            rv_open(&k, &h);
        }
        RV_CLOSE => s.modal = None,
        RV_TOAST => {
            let i: usize = v.parse().unwrap_or(usize::MAX);
            if i < s.rev.toasts.len() {
                s.rev.toasts.remove(i);
            }
        }
        RV_CLAIM_ASK => {
            let p: Vec<&str> = v.split('\t').collect();
            if p.len() >= 5 {
                open_modal(Modal::Claim { hash: p[0].into(), title: p[1].into(), author: p[2].into(), matched: p[3].into(), amount: p[4].parse().unwrap_or(0.0) });
            }
        }
        _ => {}
    }
    let Some(m) = st().modal.as_mut() else { return };
    match (a, m) {
        (RV_BOUNTY, Modal::Review { bounty, .. }) => *bounty = v,
        (RV_ASK, Modal::Review { confirm, .. }) => *confirm = Some(if v == "llm" { 2 } else { 1 }),
        (RV_YES, Modal::Review { confirm, hash, bounty, busy, msg, .. }) => {
            let which = confirm.take().unwrap_or(1);
            *busy = true;
            *msg = "Placing the request…".to_string();
            let (path, body) = if which == 2 {
                ("/review/llm", format!("{{{}}}", ident))
            } else {
                ("/review/request", format!("{{{},\"bounty\":{}}}", ident, bounty.trim().parse::<f64>().unwrap_or(2.0)))
            };
            request(Want::Tool(Tool::Rev, 9), "POST", &rev_url(hash, path), &body, 0);
        }
        (RV_CANCEL_REQ, Modal::Review { hash, busy, msg, confirm, .. }) => {
            if *confirm != Some(3) {
                *confirm = Some(3);
                return;
            }
            *confirm = None;
            *busy = true;
            *msg = "Withdrawing…".to_string();
            request(Want::Tool(Tool::Rev, 9), "POST", &rev_url(hash, "/review/cancel"), &format!("{{{}}}", ident), 0);
        }
        (RV_VERDICT, Modal::Write { verdict, .. }) => *verdict = v,
        (RV_COMMENT, Modal::Write { comment, .. }) => *comment = v,
        (RV_SUBMIT, Modal::Write { hash, open, verdict, comment, busy, msg, .. }) => {
            let rid = open.data.as_ref().and_then(|o| o.get("open").arr().iter().find(|r| r.get("hash").str() == hash).map(|r| r.get("id").f() as i64)).unwrap_or(0);
            *busy = true;
            msg.clear();
            let body = format!(
                "{{\"review_id\":{},\"eval_hash\":{},\"verdict\":{},\"comment\":{},{}}}",
                rid,
                json::quote(if rid > 0 { "" } else { hash }),
                json::quote(verdict),
                json::quote(comment.trim()),
                ident
            );
            request(Want::Tool(Tool::Rev, 13), "POST", "/api/reviews/submit", &body, 0);
        }
        (RV_VOTE, Modal::Reviews { .. }) => {
            let (id, val) = v.split_once(',').unwrap_or(("0", "1"));
            let body = format!("{{\"review_id\":{},\"value\":{},{}}}", id, val, ident);
            request(Want::Tool(Tool::Rev, 17), "POST", "/api/reviews/rate", &body, 0);
        }
        (RV_REBUT, Modal::Reviews { hash, llm, .. }) => {
            let (h, l) = (hash.clone(), *llm);
            open_modal(Modal::Rebut { hash: h, id: v.parse().unwrap_or(0), llm: l, body: String::new(), msg: String::new(), busy: false });
        }
        (RV_REPORT, Modal::Reviews { .. }) => {
            open_modal(Modal::Report { id: v.parse().unwrap_or(0), reasons: Slot { busy: true, ..Slot::default() }, reason: String::new(), detail: String::new(), msg: String::new(), busy: false, done: None });
            request(Want::Tool(Tool::Rev, 15), "GET", "/api/reviews/report-reasons", "", 0);
        }
        (RV_COMMENT, Modal::Rebut { body, .. }) => *body = v,
        (RV_SUBMIT, Modal::Rebut { id, body, busy, .. }) => {
            *busy = true;
            let b = format!("{{\"review_id\":{},\"body\":{},{}}}", id, json::quote(body.trim()), ident);
            request(Want::Tool(Tool::Rev, 14), "POST", "/api/reviews/rebut", &b, 0);
        }
        (RV_REASON, Modal::Report { reason, .. }) => *reason = v,
        (RV_DETAIL, Modal::Report { detail, .. }) => *detail = v,
        (RV_SUBMIT, Modal::Report { id, reason, detail, busy, .. }) => {
            *busy = true;
            let b = format!("{{\"review_id\":{},\"reason\":{},\"detail\":{},{}}}", id, json::quote(reason), json::quote(detail.trim()), ident);
            request(Want::Tool(Tool::Rev, 16), "POST", "/api/reviews/report", &b, 0);
        }
        (RV_KIND, Modal::Publish { kind, .. }) => *kind = v,
        (RV_DOI, Modal::Publish { doi, .. }) => *doi = v,
        (RV_DIST, Modal::Publish { dist, .. }) => *dist = v == "1",
        (RV_SUBMIT, Modal::Publish { hash, kind, doi, dist, busy, msg, st: slot, .. }) => {
            let has_file = slot.data.as_ref().map(|d| d.get("has_file").truthy()).unwrap_or(false);
            if kind == "journal" && doi.trim().is_empty() {
                *msg = "A journal claim needs a DOI.".to_string();
                return;
            }
            if has_file && !*dist {
                *msg = "Confirm you may distribute the uploaded file before publishing.".to_string();
                return;
            }
            *busy = true;
            *msg = if kind == "journal" { "Checking the DOI against Crossref and OpenAlex…".into() } else { "Publishing…".into() };
            let b = format!("{{\"published\":true,\"kind\":{},\"doi\":{},\"distribute_file\":{},{}}}", json::quote(kind), json::quote(doi.trim()), dist, ident);
            request(Want::Tool(Tool::Rev, 18), "POST", &format!("{}?{}", rev_url(hash, "/publish"), q), &b, 0);
        }
        (RV_YES, Modal::Unpublish { hash, busy, .. }) => {
            *busy = true;
            let b = format!("{{\"published\":false,{}}}", ident);
            request(Want::Tool(Tool::Rev, 19), "POST", &format!("{}?{}", rev_url(hash, "/publish"), q), &b, 0);
        }
        (RV_YES, Modal::Remove { hash, busy, .. }) => {
            *busy = true;
            request(Want::Tool(Tool::Rev, 12), "DELETE", &format!("{}?{}", rev_url(hash, ""), q), "", 0);
        }
        (RV_CLAIM_YES, Modal::Claim { hash, .. }) => {
            let h = hash.clone();
            st().modal = None;
            rv_open("claim", &h);
        }
        (RV_CLAIM_NO, Modal::Claim { hash, .. }) => {
            let h = hash.clone();
            st().modal = None;
            request(Want::Tool(Tool::Rev, 11), "POST", &format!("{}?{}", rev_url(&h, "/disown"), q), "", 0);
        }
        (RV_TYPED, Modal::Clear { typed, .. }) => *typed = v,
        (RV_YES, Modal::Clear { typed, busy, .. }) => {
            *busy = true;
            let b = format!("{{\"confirm\":{},{}}}", json::quote(typed.trim()), ident);
            request(Want::Tool(Tool::Rev, 20), "POST", "/api/assessments/mine/clear", &b, 0);
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------------------------- finished machine reviews

fn jobs_watch(now: bool) {
    let r = &mut st().rev;
    if !r.watching {
        r.watching = true;
        host::timer(if now { 50 } else { 4000 }, T_JOBS);
    }
}

fn jobs_tick() {
    let s = st();
    s.rev.watching = false;
    if !signed_in(s) {
        return;
    }
    request(Want::Tool(Tool::Rev, 22), "GET", &format!("/api/reviews/jobs?{}", ident_query(s)), "", 0);
}

fn jobs_answer(v: Value) {
    let r = &mut st().rev;
    let jobs = v.get("jobs").arr();
    let finished: Vec<&Value> = jobs.iter().filter(|j| !matches!(j.get("status").str(), "running" | "queued")).collect();
    for j in &finished {
        let id = j.get("id").f() as i64;
        if r.jobs_seeded && !r.seen_jobs.contains(&id) {
            r.toasts.push((j.get("status").str() == "complete", j.get("title").text().or_text("Your paper"), j.get("message").text(), j.get("hash").text()));
        }
        if !r.seen_jobs.contains(&id) {
            r.seen_jobs.push(id);
        }
    }
    let fresh = r.jobs_seeded && r.toasts.iter().any(|_| true);
    r.jobs_seeded = true;
    if v.get("pending").f() > 0.0 {
        jobs_watch(false);
    }
    if fresh {
        refresh_mine();
    }
}

// ---------------------------------------------------------------------------------------------- badges and actions on a paper

fn safe_doi(raw: &str) -> String {
    let d = raw.trim().trim_start_matches("https://doi.org/").trim_start_matches("http://doi.org/").trim_start_matches("https://dx.doi.org/").trim();
    let ok = d.starts_with("10.") && d.contains('/') && !d.chars().any(|c| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>'));
    if ok { d.to_string() } else { String::new() }
}

fn seal(kind: &str, mark: &str, label: String, title: &str, open: Option<(String, String)>) -> N {
    let mut e = el(if open.is_some() { "button" } else { "span" }).cls("seal").cls(&format!("seal-{}", kind)).attr("title", title.to_string());
    if let Some((action, arg)) = open {
        e = e.attr("type", "button").attr("data-stop", "1").on("click", Msg::T(Tool::Rev, RV_OPEN, format!("{}\t{}", action, arg)));
    }
    e.kid(el("span").cls("seal-mark").text(mark.to_string())).kid(el("span").text(label)).into()
}

/// The marks a paper carries, each opening what it claims.
fn badges(a: &Value) -> Vec<N> {
    let h = a.any(&["hash", "eval_hash"]).text();
    let mut v = Vec::new();
    if a.get("published").truthy() {
        let doi = safe_doi(a.get("doi").str());
        let open = if a.get("has_file").truthy() {
            Some(("file".to_string(), h.clone()))
        } else if !doi.is_empty() {
            Some(("doi".to_string(), doi.clone()))
        } else if !h.is_empty() {
            Some(("dossier".to_string(), h.clone()))
        } else {
            None
        };
        v.push(if a.get("publish_kind").str() == "journal" {
            seal("journal", "★", "Journal-published".into(), "A DOI for this work resolves in Crossref or OpenAlex, the registered title matches this manuscript, and the claimant is a deposited author.", open)
        } else {
            seal("author", "✓", "Author-published".into(), "The verified author attached their name to this assessment. An authorship endorsement, not journal publication.", open)
        });
    }
    let n = a.get("peer_reviews").f();
    if n > 0.0 {
        v.push(seal("peer", "◆", if n > 1.0 { format!("Peer-reviewed ×{}", n as i64) } else { "Peer-reviewed".into() }, "An independent researcher — not an author — submitted a reasoned verdict.", Some(("peer-review".into(), h.clone()))));
    }
    if a.get("llm_reviewed").truthy() || a.get("llm_review_count").f() > 0.0 {
        v.push(seal("llm", "▣", "LLM-reviewed".into(), "A model panel wrote this review. No human read the paper.", Some(("llm-review".into(), h.clone()))));
    }
    if a.get("review_requested").truthy() {
        let reward = a.get("review_bounty").f();
        v.push(seal(
            "requested",
            "◷",
            format!("Requested to be reviewed{}", if reward > 0.0 { format!(" · {:.2} piQ", reward) } else { String::new() }),
            "Someone has commissioned a peer review of this paper and it is waiting for a reviewer. This is not a review and says nothing about the work.",
            Some(("dossier".into(), h.clone())),
        ));
    }
    v
}

fn act_btn(label: &str, kind: &str, hash: &str, cls: &str) -> N {
    el("button").attr("type", "button").cls("btn small").cls(cls).attr("data-stop", "1").on("click", Msg::T(Tool::Rev, RV_OPEN, format!("{}\t{}", kind, hash))).text(label.to_string()).into()
}

/// The author's and the reviewer's powers over one assessment, shown in its dossier.
fn authorship_actions(a: &Value) -> N {
    let h = a.any(&["hash", "eval_hash"]).text();
    if h.is_empty() {
        return txt("");
    }
    let claimed = a.get("claimed").truthy() || !a.get("piq_claimed_at").str().is_empty() || !a.get("claimed_at").str().is_empty();
    let escrowed = a.get("escrowed").f();
    let reviewed = a.get("peer_reviews").f() > 0.0;
    let llm = a.get("llm_reviewed").truthy();
    let published = a.get("published").truthy();
    let mut bar = el("div").cls("row").kid(act_btn(if llm { "Request a new review" } else { "Request a Review" }, "review", &h, ""));
    if escrowed > 0.0 && !claimed {
        bar = bar.kid(act_btn(&format!("Claim {:.2}", escrowed), "claim", &h, ""));
    }
    if published {
        bar = bar.kid(act_btn("Unpublish", "withdraw", &h, "")).kid(act_btn("Withdraw", "remove", &h, "danger"));
    } else {
        bar = bar.kid(if reviewed {
            act_btn("Publish", "publish", &h, "")
        } else {
            el("button").attr("type", "button").cls("btn small").attr("disabled", "").attr("title", "This paper must be peer reviewed before it can be published").text("Publish").into()
        });
    }
    let n = a.get("peer_reviews").f() as i64;
    el("div")
        .cls("card author-actions")
        .kid(
            el("details")
                .kid(el("summary").text("If this is your manuscript"))
                .kid(el("p").cls("hint").text("Requesting a review spends piQ. Publishing attaches a badge to this assessment publicly, requires verified authorship, and — because review comes before publication — requires a completed peer review."))
                .kid(bar)
                .kid_if(!published && !reviewed, || el("p").cls("hint").text("Publishing is unavailable until a reviewer has submitted a report. Request a peer review above; once it lands, the paper carries a Peer-reviewed badge and this button turns on.").into()),
        )
        .kid(el("div").cls("row").style("margin-top:10px").kid(act_btn("Write a review", "write-review", &h, "")).kid(el("span").cls("hint").text(if a.get("review_requested").truthy() {
            "This paper has been submitted for review and is waiting for a reviewer.".to_string()
        } else if n > 0 {
            format!("Already reviewed {} time{}. Reviews accumulate — another one adds to the count and costs the author nothing.", n, if n == 1 { "" } else { "s" })
        } else {
            "Any eligible reviewer can review this paper. Nothing is charged to its author.".to_string()
        })))
        .into()
}

// ---------------------------------------------------------------------------------------------- your assessments, with their actions

fn history_view(s: &State) -> N {
    slot_view(&s.mine, "Loading your assessments…", |m| {
        let rows = m.get("assessments").arr();
        if rows.is_empty() {
            let as_ = m.get("read_as");
            let shown = if !as_.get("orcid").str().is_empty() {
                format!("ORCID {}", as_.get("orcid").str())
            } else if !as_.get("wallet").str().is_empty() {
                format!("wallet {}", short(as_.get("wallet").str()))
            } else {
                "this identity".to_string()
            };
            return el("p").cls("hint").text(format!("Nothing assessed under {} yet. Papers are filed under the identity your sign-in proves at the time you assess them.", shown)).into();
        }
        let sel = &s.studio.selection;
        let all = rows.iter().all(|a| sel.contains(&a.any(&["eval_hash", "hash"]).text()));
        el("div")
            .kid(el("p").cls("hint").kid(el("b").text("Tick a paper to include it in your RiBD. ")).kid(txt("RiBD reads only the papers you tick when suggesting what to work on next.")))
            .kid(
                el("div").cls("table-scroll").kid(
                    el("table")
                        .cls("data-table history")
                        .kid(el("thead").kid(el("tr").kid(el("th").text("RiBD")).kid(el("th").text("Paper")).kid(el("th").text("piX")).kid(el("th").text("piQ")).kid(el("th").text(""))))
                        .kid(el("tbody").kids(rows.iter().map(|a| -> N {
                            let h = a.any(&["eval_hash", "hash"]).text();
                            let piq = if a.get("escrowed").f() > 0.0 && a.get("piq").f() == 0.0 { format!("{:.2} held", a.get("escrowed").f()) } else { format!("{:.2}", a.get("piq").f()) };
                            el("tr")
                                .cls_if(sel.contains(&h), "picked")
                                .kid(el("td").kid(el("input").attr("type", "checkbox").attr("aria-label", "Include this paper in your RiBD").prop("checked", if sel.contains(&h) { "1" } else { "0" }).on("change", Msg::T(Tool::Profile, PF_TICK, h.clone()))))
                                .kid(
                                    el("td")
                                        .kid(el("div").kid(el("a").attr("href", format!("#/paper/{}", h)).text(a.get("title").text().or_text("Untitled"))).kids(badges(a)))
                                        .kid(el("div").cls("hint").text(format!("{}{}", a.get("timestamp").str().chars().take(10).collect::<String>(), if a.get("doi").str().is_empty() || a.get("doi").str() == "None" { String::new() } else { format!(" · {}", a.get("doi").str()) }))),
                                )
                                .kid(el("td").text(num(a.any(&["score", "final_score"]).f(), 1)))
                                .kid(el("td").text(piq))
                                .kid(el("td").cls("row nowrap").kid(el("a").cls("btn small primary").attr("href", format!("#/paper/{}", h)).text("Full report")).kid(act_btn("Suggest defense", "defense", &h, "")).kid(act_btn("Remove", "remove", &h, "danger")))
                                .into()
                        }))),
                ),
            )
            .kid(
                el("p")
                    .cls("hint")
                    .text("Removing a paper withdraws it from the corpus and all listings. Its Proof-of-Research block remains — the chain is append-only.")
                    .kid_if(all, || act_btn("Clear all history", "clear", "", "danger")),
            )
            .into()
    })
}

/// piQ held for papers whose byline matches you, which you did not submit.
fn claimable_view(s: &State) -> N {
    let Some(d) = s.rev.claimable.data.as_ref() else { return txt("") };
    let list = d.get("candidates").arr();
    if list.is_empty() {
        return txt("");
    }
    el("div")
        .cls("card")
        .kid(el("div").cls("pc-head").kid(el("h3").text("piQ held for you")).kid(el("b").text(format!("{:.2} piQ", d.get("total").f()))))
        .kid(el("p").cls("hint").text(format!(
            "{} paper{} carry a byline matching {}. Claiming re-checks authorship against the publisher and ORCID registries.",
            list.len(),
            if list.len() == 1 { "" } else { "s" },
            d.get("profile_name").text().or_text("your ORCID name")
        )))
        .kids(list.iter().map(|c| -> N {
            el("div")
                .cls("row spread")
                .kid(el("div").kid(el("b").text(c.get("title").text().or_text("Untitled"))).kid(el("div").cls("hint").text(c.get("author").text())))
                .kid(
                    el("button")
                        .attr("type", "button")
                        .cls("btn small")
                        .on("click", Msg::T(Tool::Rev, RV_CLAIM_ASK, format!("{}\t{}\t{}\t{}\t{}", c.get("hash").text(), c.get("title").text(), c.get("author").text(), c.get("matched_author").text(), c.get("escrowed").f())))
                        .text(format!("Claim {:.2}", c.get("escrowed").f())),
                )
                .into()
        }))
        .into()
}

// ---------------------------------------------------------------------------------------------- the windows

fn rbtn(label: &str, a: u16, v: &str, cls: &str, disabled: bool) -> N {
    el("button").attr("type", "button").cls("btn").cls(cls).attr_if(disabled, "disabled", "").on("click", Msg::T(Tool::Rev, a, v.to_string())).text(label.to_string()).into()
}

fn verdict_label(r: &Value, llm: bool) -> String {
    if llm {
        r.get("verdict").str().trim_start_matches("llm-").to_string().or_text("unrecorded")
    } else {
        match r.get("verdict").str() {
            "sound" => "Sound".into(),
            "concerns" => "Concerns raised".into(),
            "unsound" => "Unsound".into(),
            x => x.to_string().or_text("recorded"),
        }
    }
}

fn review_card(r: &Value, llm: bool) -> N {
    let rating = r.get("rating");
    let id = r.get("id").f() as i64;
    let mine = rating.get("my_vote").num();
    el("div")
        .cls("opt-card")
        .kid(el("div").cls("pc-head").kid(el("b").text(format!("{}: {}", if llm || r.get("is_llm").truthy() { "Recommendation" } else { "Verdict" }, verdict_label(r, llm)))).kid(el("span").cls("pc-tag").text(r.get("completed_at").str().chars().take(10).collect::<String>())))
        .kid(markdown(&r.get("comment").text().or_text("No text was recorded.")))
        .kids(r.get("rebuttals").arr().iter().map(|rb| -> N {
            el("div").cls("rebuttal").kid(el("div").cls("hint").text(format!("Author's reply · {}", rb.get("created_at").str().chars().take(10).collect::<String>()))).kid(markdown(rb.get("body").str())).into()
        }))
        .kid_if(id > 0, || {
            el("div")
                .cls("row")
                .kid(rbtn(&format!("▲ Helpful {}", rating.get("helpful").f() as i64), RV_VOTE, &format!("{},1", id), if mine == Some(1.0) { "primary small" } else { "small" }, false))
                .kid(rbtn(&format!("▼ Not useful {}", rating.get("unhelpful").f() as i64), RV_VOTE, &format!("{},-1", id), if mine == Some(-1.0) { "primary small" } else { "small" }, false))
                .kid_if(r.get("may_rebut").truthy(), || rbtn("Refute this review", RV_REBUT, &format!("{}", id), "small", false))
                .kid(rbtn("Report", RV_REPORT, &format!("{}", id), "small link", false))
                .into()
        })
        .into()
}

fn modal_view(s: &State) -> N {
    let Some(m) = s.modal.as_ref() else { return txt("") };
    let piq = s.piq.data.as_ref();
    let balance = piq.map(|p| p.get("balance").f()).unwrap_or(0.0);
    let body: N = match m {
        Modal::Help(k) => help_view(s, k),
        Modal::Info(t, x) => el("div").kid(el("h2").text(t.clone())).kid(el("p").cls("lede").style("white-space:pre-wrap").text(x.clone())).into(),
        Modal::Defense { slot } => el("div").kid(el("h2").text("Suggested defense")).kid(slot_view(slot, "Asking the strategist…", |d| markdown(d.get("strategy").str()))).into(),
        Modal::Remove { busy, err, .. } => el("div")
            .kid(el("h2").text("Withdraw this paper?"))
            .kid(el("p").cls("lede").text("It is removed from the corpus, the leaderboard and the research buddy. Its ledger block stays, because the Proof-of-Research chain is append-only."))
            .kid(el("div").cls("row").kid(rbtn(if *busy { "Withdrawing…" } else { "Withdraw it" }, RV_YES, "", "danger", *busy)).kid(rbtn("Keep it", RV_CLOSE, "", "", false)))
            .kid(el("p").cls("hint").text(err.clone()))
            .into(),
        Modal::Claim { title, author, matched, amount, .. } => el("div")
            .kid(el("h2").text("Is this your paper?"))
            .kid(el("div").cls("card").kid(el("b").text(title.clone().or_text("Untitled"))).kid(el("div").cls("hint").text(author.clone().or_text("No byline recorded"))))
            .kid(el("p").kid(txt("We matched ")).kid(el("b").text(matched.clone().or_text("your name"))).kid(txt(" on this paper's byline against your ORCID profile name. That is a name match, not proof — please confirm before we check it properly.")))
            .kid(el("p").cls("hint").text(format!("Saying yes re-verifies authorship against the publisher's deposited record and your ORCID profile. If that check passes, {:.2} piQ held for this paper is released to you. If it does not, nothing changes and you will be told why.", amount)))
            .kid(el("p").cls("hint").text("Saying no removes it from your suggestions. Nothing is given up — the piQ stays held for whoever the author is."))
            .kid(el("div").cls("row").kid(rbtn("Yes, this is my paper", RV_CLAIM_YES, "", "primary", false)).kid(rbtn("No, not mine", RV_CLAIM_NO, "", "", false)))
            .into(),
        Modal::Review { st: slot, bounty, confirm, msg, busy, queued, .. } => slot_view(slot, "Loading…", |d| {
            let peer_fee = if d.get("fee").get("fee").is_null() { 2.0 } else { d.get("fee").get("fee").f() };
            let llm_fee = if d.get("llm_fee").get("fee").is_null() { 0.5 } else { d.get("llm_fee").get("fee").f() };
            let already_llm = d.get("llm_reviewed").truthy();
            let requested = d.get("review_requested").truthy();
            let may = !matches!(d.get("may_request"), Value::Bool(false));
            let held = piq.map(|p| p.get("held").f()).unwrap_or(0.0);
            let mut peer = el("div")
                .cls("opt-card")
                .kid(el("div").cls("pc-head").kid(el("b").text("Peer review")).kid(el("span").cls("pc-tag").text(format!("{:.2} piQ", peer_fee))))
                .kid(el("p").text("Another researcher — signed in with both a wallet and an ORCID, with at least one paper published here, and not you — reads the paper and submits a reasoned verdict. The fee is a reward credited to them on completion, not a price for the badge."))
                .kid(el("p").cls("hint").text("A paper must be peer reviewed before it can be published, so this is the step that unlocks publishing."));
            if requested {
                peer = peer.kid(
                    el("div")
                        .cls("opt-done")
                        .text("A review has already been requested for this paper and is waiting for a reviewer.")
                        .kid_if(d.get("review_requested_by_me").truthy(), || rbtn(if *confirm == Some(3) { format!("Really withdraw? The {:.2} piQ returns to you", peer_fee) } else { "Cancel this request".into() }.as_str(), RV_CANCEL_REQ, "", "small", *busy))
                        .kid_if(!d.get("review_requested_by_me").truthy(), || el("div").cls("hint").text("Someone else requested it, so only they can withdraw it.").into()),
                );
            } else if !may {
                peer = peer.kid(el("div").cls("opt-inactive").text("Only the author of a paper can request a review of it — the same authorship check that gates publishing. If this is your manuscript, claim authorship from the dossier first."));
            } else {
                peer = peer
                    .kid(el("label").cls("field").kid(el("span").text("Offer to the reviewer (piQ)")).kid(el("input").attr("type", "number").attr("step", "0.5").attr("min", format!("{}", peer_fee)).attr("max", "500").prop("value", bounty.clone()).on("input", Msg::TV(Tool::Rev, RV_BOUNTY))))
                    .kid(el("p").cls("hint").text(format!("Minimum {:.2} piQ. Offering more attracts reviewers to a paper that might otherwise wait — the whole amount goes to whoever completes the review, on top of their {:.2} piQ completion bonus.", peer_fee, if d.get("bonus").get("bonus").is_null() { 2.0 } else { d.get("bonus").get("bonus").f() })))
                    .kid(rbtn("Request peer review", RV_ASK, "peer", "primary", *busy));
            }
            let llm = el("div")
                .cls("opt-card")
                .kid(el("div").cls("pc-head").kid(el("b").text("LLM review")).kid(el("span").cls("pc-tag").text(format!("{:.2} piQ", llm_fee))))
                .kid(el("p").text("A language model reads the manuscript itself and writes a referee report the way a journal reviewer would — claims against evidence, methodology, statistics, novelty, reproducibility, and specific revisions — ending in a recommendation."))
                .kid(el("p").cls("hint").text("It does not use the lab's criteria and knows nothing of your piX score, so it can disagree with the assessment. Badged LLM-reviewed, never peer-reviewed. Requires a stored manuscript file."))
                .kid_if(already_llm, || el("p").cls("opt-done").text("This paper carries an LLM review. Open its badge to read it, or request a new one — each review is kept and dated.").into())
                .kid(rbtn(if *queued { "Review in progress…" } else if already_llm { "Request a new review" } else { "Request LLM review" }, RV_ASK, "llm", "primary", *busy || *queued));
            let mut out = el("div")
                .kid(el("h2").text(if already_llm { "Request a new review" } else { "Request a review" }))
                .kid(el("p").cls("hint").text(format!("Spendable balance: {:.2} piQ{}", balance, if held > 0.0 { format!(" · {:.2} piQ held — held piQ cannot be spent until you claim it.", held) } else { String::new() })))
                .kid(peer)
                .kid(llm);
            if let Some(c) = confirm.filter(|c| *c != 3) {
                let (label, cost) = if c == 2 { ("an LLM review", llm_fee) } else { ("a peer review", bounty.trim().parse::<f64>().unwrap_or(peer_fee)) };
                out = out.kid(el("div").cls("confirm-box").kid(el("p").text(format!("Request {}? This costs {:.2} piQ. Your spendable balance: {:.2} piQ.", label, cost, balance))).kid(el("div").cls("row").kid(rbtn("Yes, request it", RV_YES, "", "primary", *busy)).kid(rbtn("Not now", RV_CLOSE, "", "", false))));
            }
            out.kid(el("p").cls("hint").text(msg.clone())).kid_if(*queued, || el("p").cls("hint").text("You can close this window. The review continues on the server and the badge appears as soon as it lands.").into()).into()
        }),
        Modal::Reviews { st: slot, llm, .. } => slot_view(slot, "Loading the review…", |d| {
            let list = if *llm { d.get("llm_reviews").arr() } else { d.get("reviews").arr() };
            if list.is_empty() {
                return el("div")
                    .kid(el("h2").text(if *llm { "LLM review" } else { "Peer review" }))
                    .kid(el("p").cls("hint").text(if *llm { "No machine review has been written for this paper yet.".to_string() } else { format!("No peer review has been submitted for this paper yet.{}", if d.get("review_requested").truthy() { " One has been requested and is waiting for a reviewer." } else { "" }) }))
                    .into();
            }
            el("div")
                .kid(el("h2").text(if *llm { "Referee report" } else { "Peer review" }))
                .kid(el("p").cls("hint").text(if *llm {
                    "An independent reading of the manuscript by a language model, in the conventions of ordinary peer review. It may disagree with the assessment. Not peer review — no human read the paper to produce this."
                } else {
                    "Written by an independent researcher who is not an author of this paper and did not commission the review. Reviewers are not named — this is single-blind."
                }))
                .kids(list.iter().map(|r| review_card(r, *llm)))
                .into()
        }),
        Modal::Write { hash, elig, open, st: slot, verdict, comment, msg, busy, done } => {
            if let Some(d) = done {
                el("div").kid(el("h2").text("Review submitted")).kid(el("p").cls("lede").text(d.clone())).kid(el("p").cls("hint").text("The paper now carries a Peer-reviewed badge, and its author can publish it. Your report is readable from that badge; your identity is not attached to it.")).into()
            } else if elig.busy || open.busy || slot.busy {
                spinner("Checking your reviewer status…")
            } else {
                let e = elig.data.as_ref().unwrap_or(&json::NULL);
                let o = open.data.as_ref().unwrap_or(&json::NULL);
                let d = slot.data.as_ref().unwrap_or(&json::NULL);
                let bonus = if e.get("bonus").is_null() { 2.0 } else { e.get("bonus").f() };
                let min_chars = if e.get("min_chars").is_null() { 400.0 } else { e.get("min_chars").f() } as usize;
                let reqs = el("div").kid(el("h3").text("What a review has to meet")).kid(el("ul").kids(e.get("requirements").arr().iter().map(|r| -> N { el("li").text(r.get("text").text()).into() })));
                if !e.get("signed_in").truthy() {
                    el("div").kid(el("h2").text("Become a reviewer")).kid(el("p").cls("lede").text("Sign in to review. Completing a review earns piQ, and piQ has to be credited to an account.")).kid(reqs).into()
                } else if !e.get("eligible").truthy() {
                    el("div")
                        .kid(el("h2").text("Become a reviewer"))
                        .kid(el("div").cls("warning-box").kid(el("b").text("You are not yet able to review. ")).kid(txt(e.get("reason").text().or_text("You do not meet the reviewer requirements."))))
                        .kid(el("p").cls("lede").text(format!("To become a reviewer you must have at least one paper published in the journal list. You currently have {}. This is not a test of expertise — it is a requirement that a reviewer has been through the same process they are judging.", num(e.get("published_count").f(), 0))))
                        .kid(reqs)
                        .kid(el("p").cls("hint").text(format!("Completing a review earns {:.2} piQ, plus whatever the requester set aside.", bonus)))
                        .into()
                } else {
                    let open_here = o.get("open").arr().iter().find(|r| r.get("hash").str() == hash);
                    let can_anyway = !d.get("may_request").truthy() || is_owner(s);
                    if open_here.is_none() && !can_anyway {
                        el("div")
                            .kid(el("h2").text("Write a review"))
                            .kid(el("p").cls("lede").text(if d.get("peer_review_count").f() > 0.0 {
                                "This paper has already been peer reviewed."
                            } else if d.get("may_request").truthy() {
                                "This is your own paper, so you cannot review it. A Peer-reviewed badge you issued to your own work would certify nothing — it needs a reviewer other than you."
                            } else {
                                "A review is open on this paper, but you are the one who requested it, and a requester reviewing their own request would make the badge self-issued through a longer route."
                            }))
                            .kid(reqs)
                            .into()
                    } else {
                        let bounty = open_here.map(|r| r.get("bounty").f()).unwrap_or(0.0);
                        let existing = d.get("peer_review_count").f() as i64;
                        let n = comment.trim().chars().count();
                        el("div")
                            .kid(el("h2").text("Write a review"))
                            .kid_if(d.get("may_request").truthy() && is_owner(s), || el("div").cls("warning-box").kid(el("b").text("This is your own paper. ")).kid(txt("You are permitted to review it because you run this deployment; your review is stored with a note saying it was written by the operator about their own paper.")).into())
                            .kid_if(e.get("owner_exemption").truthy(), || el("div").cls("warning-box").kid(el("b").text("You are reviewing as the operator. ")).kid(txt("As the owner you are exempt from the publication requirement so the first reviews can be written.")).into())
                            .kid_if(existing > 0, || el("div").cls("opt-done").text(format!("This paper already carries {} peer review{}. Yours is added alongside them.", existing, if existing == 1 { "" } else { "s" })).into())
                            .kid(el("p").cls("lede").text(format!("You are reviewing {}. Your report is published with the paper; your name is not — reviews here are single-blind.", open_here.map(|r| r.get("title").text()).unwrap_or_else(|| d.get("title").text().or_text("this paper")))))
                            .kid(el("p").cls("hint").text(if bounty > 0.0 { format!("On submission {:.2} piQ set aside by the requester, plus a {:.2} piQ completion bonus, is credited to you, and the paper receives a Peer-reviewed badge.", bounty, bonus) } else { format!("On submission a {:.2} piQ completion bonus is credited to you, and the paper receives a Peer-reviewed badge. The reward is for a reasoned report, not for any particular verdict.", bonus) }))
                            .kid(reqs)
                            .kid(
                                el("label").cls("field").kid(el("span").text("Verdict")).kid(
                                    el("select")
                                        .on_val("change", |v| Msg::T(Tool::Rev, RV_VERDICT, v))
                                        .kid(el("option").attr("value", "").text("Choose a verdict…"))
                                        .kid(el("option").attr("value", "sound").attr_if(verdict == "sound", "selected", "").text("Sound — the claims are supported by the evidence"))
                                        .kid(el("option").attr("value", "concerns").attr_if(verdict == "concerns", "selected", "").text("Concerns — publishable, but specific problems must be addressed"))
                                        .kid(el("option").attr("value", "unsound").attr_if(verdict == "unsound", "selected", "").text("Unsound — the conclusions do not follow from the work")),
                                ),
                            )
                            .kid(el("label").cls("field").kid(el("span").text(format!("Your report — minimum {} characters", min_chars))).kid(el("textarea").attr("rows", "12").attr("placeholder", "Cover the claims against the evidence, the methodology, statistical soundness, novelty, reproducibility, and the specific revisions you would ask for.").prop("value", comment.clone()).on("input", Msg::TV(Tool::Rev, RV_COMMENT))))
                            .kid(el("p").cls("hint").cls_if(n >= min_chars, "ok").text(format!("{} / {}", n, min_chars)))
                            .kid(rbtn(if *busy { "Submitting…" } else { "Submit review" }, RV_SUBMIT, "", "primary", *busy || n < min_chars || verdict.is_empty()))
                            .kid(el("p").cls("hint warn").text(msg.clone()))
                            .into()
                    }
                }
            }
        }
        Modal::Rebut { body, msg, busy, .. } => {
            let n = body.trim().chars().count();
            el("div")
                .kid(el("h2").text("Refute this review"))
                .kid(el("p").cls("lede").text("Your reply is published directly beneath the review, permanently and under your name as the paper's author. The review itself is not changed, hidden or removed."))
                .kid(el("p").cls("hint").text("This is the place to correct a factual error, point to evidence the reviewer missed, or explain a decision they questioned."))
                .kid(el("label").cls("field").kid(el("span").text("Your reply — minimum 120 characters")).kid(el("textarea").attr("rows", "8").prop("value", body.clone()).on("input", Msg::TV(Tool::Rev, RV_COMMENT))))
                .kid(el("p").cls("hint").cls_if(n >= 120, "ok").text(format!("{} / 120", n)))
                .kid(rbtn(if *busy { "Publishing…" } else { "Publish reply" }, RV_SUBMIT, "", "primary", *busy || n < 120))
                .kid(el("p").cls("hint warn").text(msg.clone()))
                .into()
        }
        Modal::Report { reasons, reason, detail, msg, busy, done, .. } => {
            if let Some(d) = done {
                el("div").kid(el("h2").text("Report submitted")).kid(el("p").cls("lede").text(d.clone())).into()
            } else {
                let mut rs: Vec<(String, String)> = reasons.data.as_ref().map(|d| d.get("reasons").arr().iter().map(|r| (r.get("id").text(), r.get("label").text())).collect()).unwrap_or_default();
                if rs.is_empty() {
                    rs.push(("other".into(), "Something else".into()));
                }
                el("div")
                    .kid(el("h2").text("Report this review"))
                    .kid(el("p").cls("lede").text("Reporting is for reviews that break the rules — not for reviews you disagree with. If you think it is wrong on the facts, reply to it instead."))
                    .kid(el("label").cls("field").kid(el("span").text("Reason")).kid(el("select").on_val("change", |v| Msg::T(Tool::Rev, RV_REASON, v)).kid(el("option").attr("value", "").text("Choose a reason…")).kids(rs.iter().map(|(id, l)| -> N { el("option").attr("value", id.clone()).attr_if(reason == id, "selected", "").text(l.clone()).into() }))))
                    .kid(el("label").cls("field").kid(el("span").text("What specifically? (optional)")).kid(el("textarea").attr("rows", "5").prop("value", detail.clone()).on("input", Msg::TV(Tool::Rev, RV_DETAIL))))
                    .kid(rbtn(if *busy { "Submitting…" } else { "Submit report" }, RV_SUBMIT, "", "danger", *busy || reason.is_empty()))
                    .kid(el("p").cls("hint warn").text(msg.clone()))
                    .into()
            }
        }
        Modal::Publish { st: slot, kind, doi, dist, msg, busy, done, hash } => slot_view(slot, "Loading…", |d| {
            if *done {
                return el("div").kid(el("h2").text("Published")).kid(el("p").cls("lede").text(msg.clone())).into();
            }
            let fee = if d.get("fee_already_paid").truthy() { 0.0 } else if d.get("fee").get("fee").is_null() { 1.0 } else { d.get("fee").get("fee").f() };
            let author_ok = if d.get("authorship_ok").is_null() { d.get("may_publish").truthy() } else { d.get("authorship_ok").truthy() };
            let reviewed = if d.get("reviewed").is_null() { true } else { d.get("reviewed").truthy() };
            let may = d.get("may_publish").truthy();
            let over = d.get("owner_override").truthy();
            let has_file = d.get("has_file").truthy();
            if !reviewed && !over {
                return el("div")
                    .kid(el("h2").text("Publish this assessment"))
                    .kid(el("div").cls("warning-box").kid(el("b").text("This paper has not been peer reviewed. ")).kid(txt(d.get("review_blocked_reason").text().or_text("A paper must be reviewed before it can be published."))))
                    .kid(el("p").cls("lede").text("Review comes before publication here. A published badge on an unreviewed paper would be a claim nobody had checked."))
                    .kid(if d.get("review_requested").truthy() {
                        el("p").cls("hint").text("A review has already been requested for this paper and is waiting for a reviewer. Nothing more is needed from you.").into()
                    } else {
                        act_btn("Request a peer review", "review", hash, "primary")
                    })
                    .into();
            }
            let journal_ok = !matches!(d.get("may_claim_journal"), Value::Bool(false));
            el("div")
                .kid(el("h2").text("Publish this assessment"))
                .kid(if over {
                    el("div").cls("warning-box").kid(el("b").text("Publishing without a peer review, as the operator. ")).kid(txt("It will carry an Author-published badge and no Peer-reviewed badge. Readers can see the difference."))
                } else {
                    el("div").cls("hint").text("Publishing attaches a badge to the assessment publicly. This paper carries a peer review, which is what makes publishing available.")
                })
                .kid(
                    el("div")
                        .cls("opt-card")
                        .kid(el("label").cls("am-check").kid(el("input").attr("type", "radio").attr("name", "pubkind").prop("checked", if kind == "author" { "1" } else { "0" }).on("change", Msg::T(Tool::Rev, RV_KIND, "author".into()))).kid(el("span").kid(el("b").text("Author-published")).kid(txt(" — you confirm this is your work and choose to stand behind the assessment."))))
                        .kid(el("label").cls("am-check").kid(el("input").attr("type", "radio").attr("name", "pubkind").attr_if(!journal_ok, "disabled", "").prop("checked", if kind == "journal" { "1" } else { "0" }).on("change", Msg::T(Tool::Rev, RV_KIND, "journal".into()))).kid(el("span").kid(el("b").text("Journal-published")).kid(txt(" — the work appeared in a journal. The DOI must resolve, to this manuscript, with you among its authors."))))
                        .kid_if(!d.get("journal_blocked_reason").str().is_empty(), || el("div").cls("opt-inactive").text(d.get("journal_blocked_reason").text()).into())
                        .kid(el("label").cls("field").kid(el("span").text("DOI, for a journal claim")).kid(el("input").attr("type", "text").attr("placeholder", "10.1038/s41586-021-03819-2").attr_if(!journal_ok, "disabled", "").prop("value", doi.clone()).on("input", Msg::TV(Tool::Rev, RV_DOI)))),
                )
                .kid(el("div").cls(if may { "opt-ok" } else { "opt-blocked" }).text(if may {
                    format!("{}, and authorship verified via {}. Publishing costs {:.2} piQ{}.", if over { "Operator override (unreviewed)" } else { "Peer reviewed" }, d.get("authorship_tier").text(), fee, if d.get("fee_already_paid").truthy() { " (already paid — free now)" } else { "" })
                } else if !author_ok {
                    format!("Names do not match yet. {} {}", d.get("reason").text(), d.get("how_to_fix").text())
                } else {
                    format!("Not publishable yet. {}", d.get("review_blocked_reason").text().or_text("A peer review is required first."))
                }))
                .kid(if has_file {
                    el("label").cls("am-check opt-card").kid(el("input").attr("type", "checkbox").prop("checked", if *dist { "1" } else { "0" }).on("change", Msg::TV(Tool::Rev, RV_DIST))).kid(el("span").kid(el("b").text("Make the manuscript file public. Required. ")).kid(txt("Anyone can open the PDF you uploaded from the badge. Tick to confirm you hold the right to distribute this file.")))
                } else {
                    el("label").cls("opt-blocked").text("No manuscript file is stored for this assessment, so it cannot be published. Re-run the assessment with the PDF uploaded and you will be able to publish it.")
                })
                .kid(rbtn(if *busy { "Publishing…" } else { "Publish" }, RV_SUBMIT, "", "primary", *busy || !may || !has_file))
                .kid(el("p").cls("hint").text(msg.clone()))
                .into()
        }),
        Modal::Unpublish { busy, msg, .. } => el("div")
            .kid(el("h2").text("Unpublish this assessment?"))
            .kid(el("p").cls("lede").text("The badge is removed and the paper stops appearing as published. It stays in the corpus, and re-publishing later is free. To take it out of the journal entirely, use Withdraw instead."))
            .kid(el("div").cls("row").kid(rbtn(if *busy { "Unpublishing…" } else { "Unpublish" }, RV_YES, "", "primary", *busy)).kid(rbtn("Keep it published", RV_CLOSE, "", "", false)))
            .kid(el("p").cls("hint").text(msg.clone()))
            .into(),
        Modal::Clear { typed, msg, busy, done } => {
            if let Some(d) = done {
                el("div").kid(el("h2").text("History cleared")).kid(el("p").cls("lede").text(d.clone())).into()
            } else {
                el("div")
                    .kid(el("h2").text("Clear your assessment history"))
                    .kid(el("div").cls("warning-box").kid(el("b").text("This withdraws every paper you have submitted. ")).kid(txt("They leave the corpus, the leaderboards and the journal index. This cannot be undone.")))
                    .kid(el("p").cls("hint").text("Their Proof-of-Research blocks remain. piQ you have already earned is unaffected."))
                    .kid(el("label").cls("field").kid(el("span").text("Type DELETE to confirm")).kid(el("input").attr("type", "text").attr("autocomplete", "off").attr("placeholder", "DELETE").prop("value", typed.clone()).on("input", Msg::TV(Tool::Rev, RV_TYPED))))
                    .kid(rbtn(if *busy { "Withdrawing…" } else { "Withdraw all my papers" }, RV_YES, "", "danger", *busy || typed.trim() != "DELETE"))
                    .kid(el("p").cls("hint warn").text(msg.clone()))
                    .into()
            }
        }
    };
    el("div")
        .cls("modal-veil")
        .attr("role", "dialog")
        .attr("aria-modal", "true")
        // no close button (owner, 2026-10-17): it opens by zooming in and closes by zooming out (or Esc)
        .kid(el("div").cls("modal-box zoomed").kid(body))
        .into()
}

fn toasts_view(s: &State) -> N {
    if s.rev.toasts.is_empty() {
        return txt("");
    }
    el("div")
        .cls("toasts")
        .kids(s.rev.toasts.iter().enumerate().map(|(i, (ok, title, msg, hash))| -> N {
            el("div")
                .cls("toast")
                .cls(if *ok { "ok" } else { "warn" })
                .kid(el("b").text(if *ok { "Review complete" } else { "Review not completed" }))
                .kid(el("div").text(title.clone()))
                .kid(el("div").cls("hint").text(msg.clone()))
                .kid_if(*ok && !hash.is_empty(), || rbtn("Read the review", RV_OPEN, &format!("llm-review\t{}", hash), "small", false))
                .kid(el("button").attr("type", "button").cls("modal-x").attr("aria-label", "Dismiss").on("click", Msg::T(Tool::Rev, RV_TOAST, format!("{}", i))).text("✕"))
                .into()
        }))
        .into()
}

const REV_CSS: &str = "\
.modal-veil{position:fixed;inset:0;z-index:2147483400;background:rgba(25,25,25,.35);display:grid;place-items:center;padding:16px}\
.modal-box{position:relative;background:var(--paper);border:1.4px solid #2b2b2b;max-width:680px;width:100%;max-height:88vh;overflow:auto;padding:22px 24px}\
.modal-box h2{margin:0 0 10px;padding-right:30px}.modal-box h3{margin:16px 0 6px}\
.modal-x{position:absolute;right:10px;top:8px;border:0;background:none;font-size:18px;cursor:pointer;color:var(--muted)}\
.opt-card{border:1px solid var(--line2);background:#fff;padding:12px 14px;margin:12px 0}\
.opt-done{border-left:3px solid var(--good);padding:6px 10px;margin:8px 0;background:var(--good-soft)}\
.opt-inactive,.opt-blocked{border-left:3px solid var(--warn);padding:6px 10px;margin:8px 0;background:var(--warn-soft)}\
.opt-ok{border-left:3px solid var(--good);padding:6px 10px;margin:8px 0}\
.warning-box{border:1px solid var(--warn);background:var(--warn-soft);padding:10px 12px;margin:10px 0}\
.confirm-box{border:1.4px solid var(--accent);background:var(--accent-soft);padding:10px 12px;margin:12px 0}\
.rebuttal{border-left:3px solid var(--accent);padding:6px 10px;margin:10px 0;background:var(--accent-soft)}\
.btn.danger{border-color:var(--bad);color:var(--bad)}\
.seal{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:11.5px;padding:1px 7px;margin-left:6px;border:1px solid var(--line2);background:#fff;vertical-align:middle}\
button.seal{cursor:pointer}.seal-mark{font-size:10px}\
.seal-journal{border-color:#bf8c3e;color:#8a5e17}.seal-author{border-color:var(--good);color:var(--good)}\
.seal-peer{border-color:var(--accent);color:var(--accent)}.seal-llm{border-color:#8a6cb6;color:#6a4c96}.seal-requested{border-style:dashed;color:var(--muted)}\
.history td{vertical-align:top}.history tr.picked{background:var(--accent-soft)}.nowrap{flex-wrap:nowrap;white-space:nowrap}\
.row.spread{justify-content:space-between;align-items:center;margin:8px 0}\
.author-actions summary{cursor:pointer;font-weight:600}\
.toasts{position:fixed;right:16px;bottom:16px;z-index:2147483300;display:flex;flex-direction:column;gap:8px;max-width:340px}\
.toast{position:relative;background:#fff;border:1.4px solid var(--good);padding:10px 30px 10px 12px;font-size:13.5px}.toast.warn{border-color:var(--warn)}\
";
