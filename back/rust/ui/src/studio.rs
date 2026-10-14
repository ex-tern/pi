// The researcher's side of the old app.js, in Rust: the research profile (named profiles, fields, keywords, core
// ideas, a working abstract) and RiBD, the research mentor that reads it (/api/buddy, /api/buddy/suggest).
// Included into app.rs.

const TAG_LIMIT: usize = 12;

#[derive(Default)]
pub struct Studio {
    loaded_for: String,
    // the profile form
    tags: [Vec<String>; 3],
    drafts: [String; 3],
    abstract_: String,
    slots: Vec<(i64, String, bool)>,
    active: Option<i64>,
    slot_name: String,
    msg: (String, &'static str),
    saving: bool,
    del_armed: bool,
    // RiBD
    buddy: Slot,
    suggest: Slot,
    selection: Vec<String>,
}

/// (separator stored with, what commits a tag while typing, longest tag)
const TAGS: [(&str, char, usize); 3] = [(", ", ',', 60), (", ", ',', 60), ("\n", '\n', 200)];

fn ident_key(s: &State) -> String {
    format!("{}|{}", s.wallet, s.orcid)
}

fn tag_add(g: usize, raw: &str) {
    let t = &mut st().studio.tags[g];
    for piece in raw.split(TAGS[g].1) {
        let v = piece.trim();
        if v.is_empty() || t.iter().any(|x| x.to_lowercase() == v.to_lowercase()) {
            continue;
        }
        if t.len() >= TAG_LIMIT {
            break;
        }
        t.push(v.chars().take(TAGS[g].2).collect());
    }
}

fn tags_set(g: usize, stored: &str) {
    st().studio.tags[g] = stored.split(TAGS[g].1).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).take(TAG_LIMIT).collect();
}

fn profile_json(s: &State) -> String {
    let st_ = &s.studio;
    format!(
        "\"field\":{},\"goal\":{},\"idea\":{},\"abstract\":{}",
        json::quote(&st_.tags[0].join(TAGS[0].0)),
        json::quote(&st_.tags[1].join(TAGS[1].0)),
        json::quote(&st_.tags[2].join(TAGS[2].0)),
        json::quote(st_.abstract_.trim())
    )
}

fn profile_write(p: &Value) {
    tags_set(0, p.get("field").str());
    tags_set(1, p.get("goal").str());
    tags_set(2, p.get("idea").str());
    st().studio.abstract_ = p.get("abstract").text();
}

fn ident_json(s: &State) -> String {
    format!("\"wallet\":{},\"orcid\":{}", json::quote(&s.wallet), json::quote(&s.orcid))
}

/// Loads the profile (the local draft at once, then the server's copy) and the named profiles.
fn studio_load() {
    let s = st();
    let key = ident_key(s);
    if s.studio.loaded_for == key {
        return;
    }
    s.studio.loaded_for = key;
    if let Some(local) = host::store_get("sp_profile").and_then(|t| json::parse(&t)) {
        profile_write(&local);
    }
    let sel = host::store_get(&format!("sp_buddy_sel:{}", ident_key(st()))).unwrap_or_default();
    st().studio.selection = sel.split(',').filter(|x| !x.is_empty()).map(|x| x.to_string()).collect();
    if signed_in(st()) {
        let q = ident_query(st());
        request(Want::Tool(Tool::Profile, 0), "GET", &format!("/api/profile?{}", q), "", 0);
        request(Want::Tool(Tool::Profile, 1), "GET", &format!("/api/profiles?{}", q), "", 0);
        buddy_fetch();
    }
}

fn buddy_fetch() {
    let s = st();
    if !signed_in(s) {
        return;
    }
    let mut q = ident_query(s);
    if !s.studio.selection.is_empty() {
        q.push_str(&format!("&hashes={}", url_encode(&s.studio.selection.join(","))));
    }
    s.studio.buddy.busy = true;
    request(Want::Tool(Tool::Profile, 5), "GET", &format!("/api/buddy?{}", q), "", 0);
    s.studio.suggest.busy = true;
    request(Want::Tool(Tool::Profile, 6), "GET", &format!("/api/buddy/suggest?{}", ident_query(s)), "", 0);
}

fn slots_from(v: &Value) {
    let st_ = &mut st().studio;
    st_.slots = v.get("profiles").arr().iter().map(|p| (p.get("id").f() as i64, p.get("name").text(), p.get("active").truthy())).collect();
    if let Some(a) = st_.slots.iter().find(|x| x.2).or(st_.slots.first()) {
        st_.active = Some(a.0);
        st_.slot_name = a.1.clone();
    }
}

fn studio_apply(w: u8, v: Value, err: Option<String>) {
    let s = st();
    match w {
        0 => {
            if err.is_none() && v.get("stored").truthy() {
                profile_write(v.get("profile"));
                {
                    let mut o = String::new();
                    json::write(v.get("profile"), &mut o);
                    host::store_set("sp_profile", &o);
                }
            }
        }
        1 => {
            if err.is_none() {
                slots_from(&v)
            }
        }
        2 => {
            s.studio.saving = false;
            match err {
                Some(e) => s.studio.msg = (format!("Could not save to the server: {} Your profile is still stored in this browser.", e), "warn"),
                None => {
                    if !v.get("id").is_null() {
                        s.studio.active = Some(v.get("id").f() as i64);
                    }
                    slots_from(&v);
                    s.studio.msg = (format!("Profile “{}” saved.", v.get("name").text()), "ok");
                    buddy_fetch();
                }
            }
        }
        3 => match err {
            Some(e) => s.studio.msg = (format!("Could not switch profile: {}", e), "warn"),
            None => {
                slots_from(&v);
                profile_write(v.get("profile"));
                s.studio.msg = (format!("Switched to “{}”.", v.get("name").text()), "ok");
                buddy_fetch();
            }
        },
        4 => match err {
            Some(e) => s.studio.msg = (format!("Could not delete: {}", e), "warn"),
            None => {
                slots_from(&v);
                let next = s.studio.slots.iter().find(|x| x.2).map(|x| x.1.clone());
                s.studio.msg = (match next.clone() {
                    Some(n) => format!("Deleted. Now using “{}”.", n),
                    None => "Profile deleted.".to_string(),
                }, "ok");
                if next.is_some() {
                    request(Want::Tool(Tool::Profile, 0), "GET", &format!("/api/profile?{}", ident_query(st())), "", 0);
                }
            }
        },
        5 => put(&mut s.studio.buddy, v, err),
        6 => put(&mut s.studio.suggest, v, err),
        _ => {}
    }
}

const PF_DRAFT: u16 = 1; // + group * 16
const PF_COMMIT: u16 = 2; // + group * 16
const PF_REMOVE: u16 = 3; // value: group,index
const PF_ABSTRACT: u16 = 4;
const PF_SAVE: u16 = 5;
const PF_SLOT: u16 = 6;
const PF_NAME: u16 = 7;
const PF_DELETE: u16 = 8;
const PF_TICK: u16 = 9;

fn studio_update(a: u16, v: String) {
    let s = st();
    let g = ((a >> 4) as usize).min(2);
    match a & 15 {
        PF_DRAFT => {
            if v.contains(TAGS[g].1) {
                tag_add(g, &v);
                s.studio.drafts[g].clear();
            } else {
                s.studio.drafts[g] = v;
            }
        }
        PF_COMMIT => {
            let d = core::mem::take(&mut s.studio.drafts[g]);
            tag_add(g, &if v.is_empty() { d } else { v });
        }
        PF_REMOVE => {
            let (gg, i) = v.split_once(',').unwrap_or(("0", "0"));
            let (gg, i) = (gg.parse::<usize>().unwrap_or(0).min(2), i.parse::<usize>().unwrap_or(999));
            if i < s.studio.tags[gg].len() {
                s.studio.tags[gg].remove(i);
            }
        }
        PF_ABSTRACT => s.studio.abstract_ = v,
        PF_NAME => s.studio.slot_name = v,
        PF_SAVE => {
            // pending text in a tag field counts as typed
            for gg in 0..3 {
                let d = core::mem::take(&mut s.studio.drafts[gg]);
                if !d.trim().is_empty() {
                    tag_add(gg, &d);
                }
            }
            let body = format!("{{{}}}", profile_json(s));
            host::store_set("sp_profile", &body);
            if !signed_in(s) {
                s.studio.msg = ("Saved in this browser. Sign in with ORCID to keep it permanently.".to_string(), "warn");
                return;
            }
            let name = if !s.studio.slot_name.trim().is_empty() {
                s.studio.slot_name.trim().to_string()
            } else if let Some(f) = s.studio.tags[0].first() {
                f.clone()
            } else {
                "My profile".to_string()
            };
            s.studio.saving = true;
            s.studio.msg = ("Saving…".to_string(), "");
            let slot = s.studio.active.map(|x| format!("{}", x)).unwrap_or_else(|| "null".to_string());
            let body = format!("{{{},{},\"name\":{},\"slot_id\":{}}}", ident_json(s), profile_json(s), json::quote(&name), slot);
            request(Want::Tool(Tool::Profile, 2), "POST", "/api/profiles", &body, 0);
        }
        PF_SLOT => {
            if v == "__new" {
                s.studio.active = None;
                s.studio.tags = Default::default();
                s.studio.abstract_.clear();
                s.studio.slot_name.clear();
                s.studio.msg = ("New profile — give it a name and save.".to_string(), "");
            } else if let Ok(id) = v.parse::<i64>() {
                request(Want::Tool(Tool::Profile, 3), "POST", &format!("/api/profiles/{}/activate", id), &format!("{{{}}}", ident_json(s)), 0);
            }
        }
        PF_DELETE => {
            if !s.studio.del_armed {
                s.studio.del_armed = true;
                return;
            }
            s.studio.del_armed = false;
            if let Some(id) = s.studio.slots.iter().find(|x| x.2).map(|x| x.0) {
                request(Want::Tool(Tool::Profile, 4), "DELETE", &format!("/api/profiles/{}?{}", id, ident_query(s)), "", 0);
            }
        }
        PF_TICK => {
            if let Some(i) = s.studio.selection.iter().position(|h| *h == v) {
                s.studio.selection.remove(i);
            } else if !v.is_empty() {
                s.studio.selection.push(v);
            }
            host::store_set(&format!("sp_buddy_sel:{}", ident_key(s)), &s.studio.selection.join(","));
            buddy_fetch();
        }
        _ => {}
    }
}

fn tag_input(s: &State, g: usize, label: &str, hint: &str) -> N {
    let st_ = &s.studio;
    el("div")
        .cls("field")
        .kid(el("span").text(label))
        .kid(
            el("div")
                .cls("tag-input")
                .kids(st_.tags[g].iter().enumerate().map(|(i, t)| -> N {
                    el("span")
                        .cls("tag-chip")
                        .kid(txt(t.clone()))
                        .kid(el("button").attr("type", "button").cls("tag-x").attr("aria-label", format!("Remove {}", t)).on("click", Msg::T(Tool::Profile, PF_REMOVE, format!("{},{}", g, i))).text("×"))
                        .into()
                }))
                .kid(
                    el("input")
                        .attr("type", "text")
                        .attr("placeholder", hint)
                        .attr("aria-label", label)
                        .prop("value", st_.drafts[g].clone())
                        .on("input", Msg::TV(Tool::Profile, PF_DRAFT | (g as u16) << 4))
                        .on("enter", Msg::TV(Tool::Profile, PF_COMMIT | (g as u16) << 4)),
                ),
        )
        .into()
}

fn profile_view(s: &State) -> N {
    let st_ = &s.studio;
    let filled = st_.tags.iter().filter(|t| !t.is_empty()).count() + if st_.abstract_.trim().is_empty() { 0 } else { 1 };
    let mut root = el("div").cls("tool profile").kid(el("p").cls("lede").text(
        "Your fields, keywords and core ideas. They shape what RiBD suggests and how your fields are compared with the corpus. None of this is scored or shared.",
    ));
    if !signed_in(s) {
        root = root.kid(el("div").cls("card").kid(el("p").text("Sign in with ORCID to keep your profile on the server; until then it is kept in this browser.")).kid(el("a").cls("btn").attr("href", "#/account").text("Sign in")));
    } else {
        root = root.kid(
            el("div")
                .cls("row pf-slots")
                .kid(
                    el("select")
                        .attr("aria-label", "Which profile")
                        .on_val("change", |v| Msg::T(Tool::Profile, PF_SLOT, v))
                        .kids(if st_.slots.is_empty() {
                            alloc::vec![el("option").attr("value", "").attr("selected", "").text("No saved profiles yet").into()]
                        } else {
                            st_.slots.iter().map(|(id, name, _)| -> N { el("option").attr("value", format!("{}", id)).attr_if(st_.active == Some(*id), "selected", "").text(name.clone()).into() }).collect::<Vec<N>>()
                        })
                        .kid(el("option").attr("disabled", "").text("──────────"))
                        .kid(el("option").attr("value", "__new").text("+ New profile…")),
                )
                .kid(el("input").attr("type", "text").attr("placeholder", "Profile name").attr("aria-label", "Profile name").prop("value", st_.slot_name.clone()).on("input", Msg::TV(Tool::Profile, PF_NAME)))
                .kid(el("button").attr("type", "button").cls("btn small").attr_if(st_.slots.is_empty(), "disabled", "").on("click", Msg::T(Tool::Profile, PF_DELETE, String::new())).text(if st_.del_armed { "Really delete it?" } else { "Delete" })),
        );
    }
    root = root
        .kid(el("p").cls("hint").text(if filled == 0 { "Not set yet.".to_string() } else { format!("{}/4 complete", filled) }))
        .kid(tag_input(s, 0, "Your research fields", "e.g. Genomics, press Enter"))
        .kid(tag_input(s, 1, "Keywords", "e.g. CRISPR screens, press Enter"))
        .kid(tag_input(s, 2, "Your core ideas (one per line)", "A sentence, then Enter"))
        .kid(el("label").cls("field").kid(el("span").text("Working abstract")).kid(el("textarea").attr("rows", "5").attr("aria-label", "Working abstract").prop("value", st_.abstract_.clone()).on("input", Msg::TV(Tool::Profile, PF_ABSTRACT))))
        .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn primary").attr_if(st_.saving, "disabled", "").on("click", Msg::T(Tool::Profile, PF_SAVE, String::new())).text("Save profile")).kid(el("span").cls("hint").cls(st_.msg.1).text(st_.msg.0.clone())));
    root.into()
}

/// RiBD: concrete next steps from the profile, the researcher's fields against the corpus, reading picks from the
/// papers they ticked, papers to read and hot topics.
fn buddy_view(s: &State) -> N {
    let st_ = &s.studio;
    let fields = &st_.tags[0];
    let goal = &st_.tags[1];
    let idea = &st_.tags[2];
    let filled = [!fields.is_empty(), !goal.is_empty(), !idea.is_empty()].iter().filter(|x| **x).count();
    let mut root = el("div").cls("tool buddy");
    if !signed_in(s) {
        return root
            .kid(el("p").cls("lede").text("RiBD is your research mentor: papers to read and hot topics to research, from your profile and the corpus."))
            .kid(el("div").cls("card").kid(el("p").text("Sign in with ORCID and fill in your research profile, and RiBD starts reading it.")).kid(el("a").cls("btn").attr("href", "#/account").text("Sign in")))
            .into();
    }
    if filled < 2 {
        let check = [("Your fields", !fields.is_empty(), "see how busy they are here"), ("Keywords", !goal.is_empty(), "find papers worth reading"), ("Your main idea", !idea.is_empty(), "see who else is working on it")];
        let done = check.iter().filter(|c| c.1).count();
        root = root
            .kid(el("p").cls("lede").kid(txt("RiBD is ")).kid(el("b").text("not on yet")).kid(txt(". It reads your research profile. With nothing to read, it would just be making things up — so it waits.")))
            .kid(el("span").cls("md-bar").kid(el("i").style(format!("width:{:.0}%", done as f64 / 3.0 * 100.0))))
            .kid(el("p").cls("hint").text(format!("{} of 3 done — fill in {} more", done, 2 - filled)))
            .kid(el("ul").cls("checklist").kids(check.iter().map(|(l, ok, why)| -> N {
                el("li").cls_if(*ok, "done").kid(el("span").cls("mark").text(if *ok { "✓" } else { "○" })).kid(el("b").text(*l)).kid(txt(format!(" — {}", why))).into()
            })))
            .kid(el("p").cls("hint").text(format!(
                "Fill in any two and RiBD will tell you which of your fields is busiest, where your work is most likely to be noticed, and what to fix first. It reads only the papers you tick under Your assessments{}.",
                if st_.selection.is_empty() { String::new() } else { format!(" ({} ticked)", st_.selection.len()) }
            )))
            .kid(el("a").cls("btn primary").attr("href", "#/i/4/2").text("Fill in your profile"));
        return root.kid(suggest_view(s)).into();
    }
    root = root.kid(el("p").cls("lede").text(format!(
        "Based on your profile{}{}.",
        if fields.is_empty() { String::new() } else { format!(" in {}", fields.join(", ")) },
        if goal.is_empty() { String::new() } else { format!(", focused on {}", goal.join(", ")) }
    )));
    root = root.kid(suggest_view(s)).kid(corpus_view(s));
    let mut actions: Vec<(&str, String)> = alloc::vec![("Build a citable trail", "Deposit preprints for everything you can. The cost of being unread is generally higher than the risk of being scooped, and a DOI you can cite is worth more than an unpublished draft.".to_string())];
    if fields.len() > 3 {
        actions.push(("You are spread across many fields", format!("You listed {}. Breadth is genuinely valuable, but citation accrues to a recognisable identity in one area. Consider which one or two you want to be known for.", fields.len())));
    }
    if idea.is_empty() {
        actions.push(("State your core claim", "You have not written down the central claim of your work. If it does not compress into a few sentences here, it will not compress into an abstract either — and reviewers read the abstract first.".to_string()));
    }
    actions.push(("Assess your weakest paper first", "The diagnostic is most useful on work that is not landing. Run the paper you are least happy with — it produces the most actionable report.".to_string()));
    root = root
        .kid(el("div").cls("perf-cards").kids(actions.into_iter().map(|(t, d)| -> N { el("div").cls("perf-card").kid(el("b").text(t)).kid(el("p").cls("hint").text(d)).into() })))
        .kid(el("p").cls("hint").text("These are heuristics from your stated profile, not an analysis of your publications. Assess a manuscript for findings grounded in an actual paper."));
    root.into()
}

fn suggest_view(s: &State) -> N {
    let st_ = &s.studio;
    let Some(d) = st_.suggest.data.as_ref() else { return txt("") };
    if !d.get("available").truthy() {
        return txt("");
    }
    let mut picks: Vec<(&str, &Value)> = Vec::new();
    if !d.get("explorer").is_null() {
        picks.push(("From the ledger explorer", d.get("explorer")));
    }
    if !d.get("manuscript").is_null() {
        picks.push(("A scanned manuscript", d.get("manuscript")));
    }
    for p in d.get("more").arr() {
        picks.push(("Also worth reading", p));
    }
    let hot = d.get("hot").arr();
    el("div")
        .cls("rs")
        .kid(el("h3").text("Papers to read"))
        .kid(if picks.is_empty() {
            el("p").cls("hint").text(if d.get("reason").str().is_empty() { "Nothing to suggest yet.".to_string() } else { d.get("reason").text() })
        } else {
            el("div").cls("rs-cards").kids(picks.iter().map(|(kind, p)| -> N {
                let fields: Vec<String> = p.get("fields").arr().iter().map(|x| x.text()).collect();
                el("a")
                    .cls("rs-card")
                    .attr("href", format!("#/paper/{}", p.get("eval_hash").str()))
                    .kid(el("span").cls("hint").text(*kind))
                    .kid(el("b").text(p.get("title").text()))
                    .kid(el("span").cls("hint").text(format!(
                        "{}{}{}",
                        if p.get("author").str().is_empty() { "Unknown author".to_string() } else { p.get("author").text() },
                        if fields.is_empty() { String::new() } else { format!(" · {}", fields.join(", ")) },
                        p.get("score").num().map(|x| format!(" · piX {:.1}", x)).unwrap_or_default()
                    )))
                    .kid(el("span").cls("rs-why").text(p.get("why").text()))
                    .into()
            }))
        })
        .kid_if(!hot.is_empty(), || {
            el("div")
                .kid(el("h3").text("Hot topics to research"))
                .kid(el("p").cls("hint").text("Where papers assessed here earn the most piX and piQ, and where activity is rising. It describes what has paid off so far, not a promise."))
                .kid(el("ol").cls("rs-hot").kids(hot.iter().map(|h| -> N {
                    el("li")
                        .kid(el("b").text(h.get("field").text()))
                        .kid_if(h.get("yours").truthy(), || el("em").text(" your field").into())
                        .kid(el("span").cls("hint").text(format!(
                            " avg piX {:.1} · avg {:.2} piQ per paper · {} new in 30 days · {} papers",
                            h.get("avg_pix").f(),
                            h.get("avg_piq").f(),
                            h.get("recent").text(),
                            h.get("papers").text()
                        )))
                        .kid(el("span").cls("md-bar").kid(el("i").style(format!("width:{:.0}%", 100.0 * h.get("heat").f()))))
                        .into()
                })))
                .into()
        })
        .into()
}

fn corpus_view(s: &State) -> N {
    let Some(d) = s.studio.buddy.data.as_ref() else {
        return if s.studio.buddy.busy { spinner("RiBD is reading…") } else { txt("") };
    };
    if !d.get("available").truthy() {
        return txt("");
    }
    let c = d.get("corpus");
    if c.get("total_papers").f() == 0.0 {
        return el("div").cls("card").kid(el("p").cls("hint").text("No papers assessed in this deployment yet, so there is nothing to compare your fields against. Assess one and this section starts reporting how your fields sit relative to the corpus.")).into();
    }
    let fields = d.get("fields").arr();
    let inc: Vec<&Value> = fields.iter().filter(|f| f.get("in_corpus").truthy()).collect();
    let missing: Vec<String> = fields.iter().filter(|f| !f.get("in_corpus").truthy()).map(|f| f.get("field").text()).collect();
    let adjacent = d.get("adjacent").arr();
    let mut card = el("div")
        .cls("card")
        .kid(el("h3").text("Your fields against the corpus"))
        .kid(el("p").cls("hint").text(format!(
            "{} papers assessed across {} fields{}.",
            num(c.get("total_papers").f(), 0),
            num(c.get("fields_assessed").f(), 0),
            c.get("mean_score").num().map(|x| format!(", mean piX {}", num(x, 1))).unwrap_or_default()
        )));
    if !inc.is_empty() {
        card = card.kid(
            el("table")
                .cls("data-table")
                .kid(el("thead").kid(el("tr").kid(el("th").text("Your field")).kid(el("th").text("Papers")).kid(el("th").text("Avg piX")).kid(el("th").text("vs corpus"))))
                .kid(el("tbody").kids(inc.iter().map(|f| -> N {
                    let dlt = f.get("vs_corpus").num();
                    el("tr")
                        .kid(el("td").text(f.get("field").text()))
                        .kid(el("td").text(f.get("papers").text()))
                        .kid(el("td").text(f.get("avg_score").num().map(|x| num(x, 1)).unwrap_or_else(|| "—".to_string())))
                        .kid(el("td").cls(match dlt {
                            Some(x) if x > 0.0 => "up",
                            Some(x) if x < 0.0 => "down",
                            _ => "",
                        }).text(dlt.map(|x| format!("{}{:.1}", if x >= 0.0 { "+" } else { "" }, x)).unwrap_or_else(|| "—".to_string())))
                        .into()
                }))),
        );
    }
    if !missing.is_empty() {
        card = card.kid(el("p").cls("hint").text(format!("No assessed work yet in {}. Nothing here can tell you how those fields are performing until something in them is assessed.", missing.join(", "))));
    }
    if !adjacent.is_empty() {
        card = card.kid(el("p").cls("hint").text(format!(
            "Active here but not on your profile: {}. If any overlap your work, adding them sharpens this comparison.",
            adjacent.iter().map(|a| format!("{} ({})", a.get("field").text(), a.get("papers").text())).collect::<Vec<_>>().join(", ")
        )));
    }
    let picks = d.get("picks");
    let mut out = el("div").kid(card);
    if picks.get("available").truthy() {
        let list = |items: &[Value], kind: &str| -> Vec<N> {
            items
                .iter()
                .map(|p| -> N {
                    let fields: Vec<String> = p.get("fields").arr().iter().map(|x| x.text()).collect();
                    el("a")
                        .cls("rs-card")
                        .cls(kind)
                        .attr("href", format!("#/paper/{}", p.any(&["eval_hash", "hash"]).str()))
                        .kid(el("span").cls("pc-tag").text(format!("piX {:.1}", p.get("score").f())))
                        .kid(el("b").text(p.get("title").text()))
                        .kid(el("span").cls("hint").text(format!("{}{}", if p.get("author_name").str().is_empty() { "Unknown author".to_string() } else { p.get("author_name").text() }, if fields.is_empty() { String::new() } else { format!(" · {}", fields.join(", ")) })))
                        .kid(el("span").cls("rs-why").text(p.get("why").text()))
                        .into()
                })
                .collect()
        };
        let mut pk = el("div").cls("card").kid(el("h3").text(format!("RiBD reading picks — from {}", if picks.get("scope").str().is_empty() { "your selection".to_string() } else { picks.get("scope").text() })));
        if !picks.get("recommended").arr().is_empty() {
            pk = pk.kid(el("h4").text("Worth reading")).kid(el("div").cls("rs-cards").kids(list(picks.get("recommended").arr(), "yes")));
        }
        if !picks.get("caution").arr().is_empty() {
            pk = pk.kid(el("h4").text("Read critically")).kid(el("div").cls("rs-cards").kids(list(picks.get("caution").arr(), "no")));
        }
        if !picks.get("unrelated").arr().is_empty() {
            pk = pk
                .kid(el("h4").text("Outside your stated fields"))
                .kid(el("p").cls("hint").text("These match none of the fields on your profile. They may still be worth reading — RiBD is saying it cannot judge them against your work, not that they are weak."))
                .kid(el("div").cls("rs-cards").kids(list(picks.get("unrelated").arr(), "off")));
        }
        pk = pk.kid(el("p").cls("hint").text(picks.get("note").text()));
        out = out.kid(pk);
    }
    out.into()
}

const STUDIO_CSS: &str = "\
.tag-input{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid var(--line2);background:#fff;padding:6px}\
.tag-input input{flex:1;min-width:160px;border:0;outline:none;font:inherit;padding:3px}\
.tag-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line2);background:var(--card);padding:2px 4px 2px 9px;font-size:13.5px}\
.tag-x{border:0;background:none;cursor:pointer;font-size:15px;line-height:1;color:var(--muted)}\
.pf-slots select,.pf-slots input{font:inherit;padding:6px 9px;border:1px solid var(--line2);background:#fff}\
.hint.ok{color:var(--good)}.hint.warn{color:var(--warn)}\
.checklist{list-style:none;padding:0;margin:10px 0}.checklist li{margin:6px 0}.checklist .mark{display:inline-block;width:20px;color:var(--muted)}.checklist li.done .mark{color:var(--good)}\
.rs-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:10px 0}\
.rs-card{display:flex;flex-direction:column;gap:4px;border:1px solid var(--line2);background:#fff;padding:10px 12px;color:var(--ink);text-decoration:none}\
.rs-card:hover{border-color:var(--accent)}.rs-card.no{border-left:3px solid var(--warn)}.rs-card.yes{border-left:3px solid var(--good)}\
.rs-why{font-size:13px}.rs-hot{padding-left:20px}.rs-hot li{margin:8px 0}.rs-hot .md-bar{margin-top:4px}\
td.up{color:var(--good)}td.down{color:var(--bad)}\
.buddy .card,.profile .card{margin:12px 0}\
";

// ---------------------------------------------------------------------------------------------- SciM, the lab's assistant

/// Grounded rather than generative: it answers from the live database and a knowledge base built from the running
/// rubric (/api/scilem/status, /api/scilem/chat), so it cannot invent a balance.
#[derive(Default)]
pub struct Scim {
    status: Slot,
    q: String,
    chat: Vec<(bool, String, String)>, // (from you, text, source label)
    busy: bool,
}

const SCIM_SUGGESTIONS: [&str; 6] = ["What is piQ?", "How much does it cost?", "My balance", "How can I improve my score?", "How is judgement made?", "Current difficulty"];

fn scim_load() {
    let s = st();
    if s.scim.status.needed() {
        s.scim.status.busy = true;
        request(Want::Tool(Tool::Scim, 0), "GET", "/api/scilem/status", "", 0);
    }
}

fn scim_ask(q: String) {
    let s = st();
    let q = q.trim().to_string();
    if q.is_empty() || s.scim.busy {
        return;
    }
    s.scim.q.clear();
    s.scim.chat.push((true, q.clone(), String::new()));
    s.scim.busy = true;
    let body = format!("{{\"prompt\":{},{}}}", json::quote(&q), ident_json(s));
    request(Want::Tool(Tool::Scim, 1), "POST", "/api/scilem/chat", &body, 0);
}

fn scim_apply(w: u8, v: Value, err: Option<String>) {
    let s = st();
    match w {
        0 => {
            if err.is_none() {
                let intro = if v.get("notice").str().is_empty() { v.get("capabilities").text() } else { format!("{}\n\n{}", v.get("capabilities").text(), v.get("notice").text()) };
                if !intro.is_empty() && s.scim.chat.is_empty() {
                    s.scim.chat.push((false, intro, String::new()));
                }
            }
            put(&mut s.scim.status, v, err);
        }
        _ => {
            s.scim.busy = false;
            match err {
                Some(e) => s.scim.chat.push((false, e, String::new())),
                None => {
                    let label = match v.get("source").str() {
                        "live-data" => "from your data",
                        "knowledge-base" => "from the framework",
                        "cloud-model" => "model-assisted",
                        "no-match" => "no grounded answer",
                        _ => "",
                    };
                    s.scim.chat.push((false, v.get("response").text(), label.to_string()));
                }
            }
        }
    }
}

fn scim_update(a: u16, v: String) {
    match a {
        1 => st().scim.q = v,
        2 => {
            let q = if v.is_empty() { st().scim.q.clone() } else { v };
            scim_ask(q);
        }
        _ => {}
    }
}

fn scim_view(s: &State) -> N {
    let sc = &s.scim;
    let status = sc.status.data.as_ref();
    let enabled = status.map(|d| d.get("enabled").truthy()).unwrap_or(true);
    let badge = match status {
        None if sc.status.err.is_some() => "Unknown".to_string(),
        None => "…".to_string(),
        Some(d) if !d.get("enabled").truthy() => "Off".to_string(),
        Some(d) => if d.get("badge").str().is_empty() { if d.get("cloud_phrasing").truthy() { "Ready".into() } else { "Grounded".into() } } else { d.get("badge").text() },
    };
    el("div")
        .cls("tool scim")
        .kid(el("div").cls("row").kid(el("p").cls("lede").text("Ask about the corpus and the method. Answers come from live data and the framework, so it cannot invent a balance.")).kid(el("span").cls("pc-tag").attr("title", status.map(|d| d.get("notice").text()).unwrap_or_default()).text(badge)))
        .kid(el("div").cls("chat").attr("aria-live", "polite").kids(sc.chat.iter().map(|(you, t, label)| -> N {
            el("div")
                .cls("chat-msg")
                .cls(if *you { "you" } else { "ai" })
                .kid(if *you { txt(t.clone()) } else { markdown(t) })
                .kid_if(!label.is_empty(), || el("span").cls("chat-src").text(label.clone()).into())
                .into()
        })).kid_if(sc.busy, || el("div").cls("chat-msg ai").text("Thinking…").into()))
        .kid_if(enabled, || {
            el("div")
                .cls("chips")
                .kids(SCIM_SUGGESTIONS.iter().map(|q| -> N { el("button").attr("type", "button").cls("chip").on("click", Msg::T(Tool::Scim, 2, q.to_string())).text(*q).into() }))
                .into()
        })
        .kid(
            el("div")
                .cls("row chat-form")
                .kid(el("input").attr("type", "text").attr("placeholder", if enabled { "Ask SciM…" } else { "Assistant disabled" }).attr_if(!enabled, "disabled", "").attr("aria-label", "Your question").prop("value", sc.q.clone()).on("input", Msg::TV(Tool::Scim, 1)).on("enter", Msg::T(Tool::Scim, 2, String::new())))
                .kid(el("button").attr("type", "button").cls("btn primary").attr_if(!enabled || sc.busy, "disabled", "").on("click", Msg::T(Tool::Scim, 2, String::new())).text("Ask")),
        )
        .into()
}

const SCIM_CSS: &str = "\
.chat{display:flex;flex-direction:column;gap:8px;margin:12px 0;max-height:55vh;overflow:auto;border:1px solid var(--line);background:#fff;padding:12px}\
.chat-msg{max-width:85%;padding:8px 12px;border:1px solid var(--line2);background:var(--card);font-size:14.5px}\
.chat-msg.you{align-self:flex-end;background:var(--ink);color:#fff;border-color:var(--ink)}\
.chat-src{display:block;margin-top:4px;font-size:11.5px;color:var(--muted)}\
.chat-form input{flex:1;font:inherit;padding:8px 10px;border:1px solid var(--line2);background:#fff}\
.scim .chips{margin:6px 0 10px}\
";
