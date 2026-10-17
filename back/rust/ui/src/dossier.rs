// The parts of a paper's dossier the old page drew and the first port left out (app.js: renderDossierModal,
// renderJudgePanel, renderDiagnosticsPanel, renderIntegrityPanel, download.js): reception diagnostics, research
// integrity with the extracted references and bibliographic provenance, the adjudication panel, field
// classification, deterministic signals, the ledger record with its settlement link, export, and the paper's own
// download. Included into app.rs.

fn pill(cls: &str, text: impl Into<String>) -> N {
    el("span").cls("pill").cls(cls).text(text.into()).into()
}

fn sec(title: &str, body: N) -> N {
    el("details").cls("dossier-sec card").kid(el("summary").kid(el("h2").text(title.to_string()))).kid(body).into()
}

fn kv_table(rows: Vec<(String, N)>) -> N {
    el("table").cls("data-table").kid(el("tbody").kids(rows.into_iter().map(|(k, v)| -> N { el("tr").kid(el("td").text(k)).kid(el("td").kid(v)).into() }))).into()
}

/// Why the work is landing — or isn't.
fn diagnostics_panel(d: &Value) -> Option<N> {
    let g = d.get("diagnostics");
    if !g.get("available").truthy() {
        return None;
    }
    let findings = g.get("findings").arr();
    let mut card = el("div")
        .cls("card")
        .kid(el("h2").text("Why this work is landing — or isn't").kid(help_btn("diagnostics")))
        .kid(el("p").cls("lede").text(g.get("headline").text()))
        .kid_if(!g.get("profile_context").str().is_empty(), || el("p").cls("hint").text(g.get("profile_context").text()).into());
    if findings.is_empty() {
        card = card.kid(el("div").cls("ok-box").text("No structural obstacles detected. Nothing in the venue, authorship or reproducibility signals is holding this back."));
        return Some(card.into());
    }
    for (kind, title, blurb) in [
        ("quality", "In the manuscript", "These are properties of the work itself, and they are what reviewers will catch."),
        ("visibility", "In how it reaches people", "These do not reflect the quality of the work, but they strongly affect whether it is read."),
    ] {
        let rows: Vec<&Value> = findings.iter().filter(|f| f.get("kind").str() == kind).collect();
        if rows.is_empty() {
            continue;
        }
        card = card.kid(el("h3").text(title)).kid(el("p").cls("hint").text(blurb)).kids(rows.iter().map(|f| -> N {
            let (label, cls) = match f.get("severity").str() {
                "critical" => ("Critical", "diag-critical"),
                "major" => ("Major", "diag-major"),
                "positive" => ("Strength", "diag-positive"),
                _ => ("Minor", "diag-minor"),
            };
            el("div")
                .cls("diag-item")
                .cls(cls)
                .kid(el("div").cls("row").kid(el("span").cls("diag-badge").text(label)).kid(el("b").text(f.get("title").text())))
                .kid(el("p").text(f.get("reality").text()))
                .kid_if(!f.get("action").str().is_empty(), || el("p").kid(el("b").text("What to do: ")).kid(txt(f.get("action").str())).into())
                .into()
        }));
    }
    card = card.kid_if(!g.get("disclaimer").str().is_empty(), || el("p").cls("hint").text(g.get("disclaimer").text()).into());
    Some(card.into())
}

/// The adversarial scan, the reference audit, interdisciplinarity and the advisory authorship signal.
fn integrity_panel(d: &Value) -> Option<N> {
    let integ = d.get("integrity");
    let refs = d.get("reference_audit");
    let auth = d.get("authorship_signal");
    let topo = d.get("topology_detail");
    if !(integ.get("scanned").truthy() || !refs.get("verdict").str().is_empty() || auth.get("assessed").truthy() || !topo.get("basis").str().is_empty()) {
        return None;
    }
    let mut card = el("div").cls("card").kid(el("h2").text("Research integrity").kid(help_btn("integrity")));
    if integ.get("compromised").truthy() {
        let techniques: Vec<String> = integ.get("techniques").arr().iter().map(|t| t.text()).collect();
        let canary: Vec<String> = integ.get("canary").get("models").arr().iter().map(|m| m.text().to_uppercase()).collect();
        card = card.kid(
            el("div")
                .cls("err-box")
                .kid(el("b").text("Adversarial manipulation detected"))
                .kid(el("p").text("This manuscript contains content designed to influence an automated reviewer. Logic integrity was set to 0.0 and no piQ was minted."))
                .kid_if(!techniques.is_empty(), || el("p").cls("hint").text(format!("Techniques: {}", techniques.join(", "))).into())
                .kid_if(integ.get("canary").get("detected").truthy(), || el("p").cls("hint").text(format!("Independently confirmed by the model panel ({}).", canary.join(", "))).into()),
        );
    }
    let mut rows: Vec<(String, N)> = Vec::new();
    let scan = if !integ.get("scanned").truthy() {
        pill("", "Not performed")
    } else if integ.get("compromised").truthy() {
        pill("bad", "Manipulation detected")
    } else {
        match integ.get("severity").str() {
            "informational" => pill("warn", "Discusses injection (no penalty)"),
            "moderate" => pill("warn", "Flagged for review"),
            _ => pill("good", "Clean"),
        }
    };
    rows.push(("Adversarial injection scan".into(), scan));
    let verdict = refs.get("verdict").str();
    if !verdict.is_empty() {
        let p = match verdict {
            "clean" => pill("good", "All resolved"),
            "some_invalid" => pill("warn", format!("{} unresolvable", refs.get("fabricated").text())),
            "fabricated_references" => pill("bad", format!("{} fabricated — C2 zeroed", refs.get("fabricated").text())),
            "no_dois_found" => pill("", "No DOIs found"),
            "not_assessed" => pill("", "Not assessed"),
            v => pill("", v.to_string()),
        };
        let extra = if refs.get("checked").f() > 0.0 {
            format!(
                " {}/{} verified{}",
                refs.get("verified").text(),
                refs.get("checked").text(),
                if refs.get("unverified").f() > 0.0 { format!(", {} unverifiable", refs.get("unverified").text()) } else { String::new() }
            )
        } else {
            String::new()
        };
        rows.push(("Reference verification".into(), el("span").kid(p).kid(el("span").cls("hint").text(extra)).into()));
    }
    let basis = topo.get("basis").str();
    if !basis.is_empty() && basis != "unavailable" {
        let domains: Vec<String> = topo.get("domains").arr().iter().map(|x| x.text()).collect();
        let p = if topo.get("spans_domains").truthy() { pill("good", format!("Spans {} domains", domains.len())) } else { pill("", "Single domain") };
        rows.push(("Interdisciplinarity basis".into(), el("span").kid(p).kid(el("span").cls("hint").text(format!(" {}", domains.join(", ")))).into()));
    }
    if auth.get("assessed").truthy() {
        let p = match auth.get("flag").str() {
            "possible_unedited_generation" => pill("warn", "Indicators present (advisory)"),
            "inconclusive" => pill("", "Inconclusive"),
            "no_signal" => pill("good", "No indicators"),
            _ => pill("", "Not assessed"),
        };
        rows.push(("Authorship assistance signal".into(), el("span").kid(p).kid(el("span").cls("hint").text(" does not affect any score")).kid(help_btn("authorship")).into()));
    }
    card = card.kid(kv_table(rows));
    // the references themselves: a count alone can't tell a thin list from a parsing failure
    let entries = refs.get("entries").arr();
    let sm = refs.get("summary");
    if !entries.is_empty() {
        let total = sm.get("total").f() as usize;
        card = card.kid(
            el("details")
                .cls("dossier-details")
                .kid(el("summary").text(format!("Extracted references ({}{})", entries.len(), if total > entries.len() { format!(" of {}", total) } else { String::new() })))
                .kid(
                    el("p")
                        .cls("hint")
                        .text(format!(
                            "{} parsed · {} with DOI{}{}{}",
                            if total > 0 { total } else { entries.len() },
                            sm.get("with_doi").f() as i64,
                            sm.get("doi_coverage").num().map(|c| format!(" · {:.0}% DOI coverage", c * 100.0)).unwrap_or_default(),
                            if sm.get("median_year").is_null() { String::new() } else { format!(" · median year {}", sm.get("median_year").text()) },
                            if sm.get("year_range").arr().len() == 2 { format!(" · {}–{}", sm.get("year_range").arr()[0].text(), sm.get("year_range").arr()[1].text()) } else { String::new() }
                        )),
                )
                .kid(el("ol").cls("ref-list").kids(entries.iter().map(|e| -> N {
                    let doi = e.get("doi").text();
                    el("li")
                        .kid(el("span").text(e.get("authors").str().chars().take(110).collect::<String>().or_text("—")))
                        .kid_if(!e.get("year").is_null(), || el("span").cls("hint").text(format!(" ({})", e.get("year").text())).into())
                        .kid(if doi.is_empty() {
                            el("span").cls("hint").text(" no DOI")
                        } else {
                            el("a").attr("href", format!("https://doi.org/{}", doi)).attr("target", "_blank").attr("rel", "noopener").text(format!(" {}", doi))
                        })
                        .into()
                }))),
        );
    }
    let bib = refs.get("bibliographic");
    if !bib.get("title_basis").str().is_empty() {
        let label = |b: &str| -> String {
            match b {
                "crossref" => "Crossref (publisher record)",
                "openalex" => "OpenAlex",
                "pdf-layout" => "PDF typography",
                "pdf-metadata" => "PDF metadata",
                "model-consensus" => "model panel",
                "filename" => "filename",
                "unavailable" => "not determined",
                x => return x.to_string(),
            }
            .to_string()
        };
        let conf = |c: f64| if c >= 0.9 { "good" } else if c >= 0.5 { "warn" } else { "bad" };
        let mut rows: Vec<(String, N)> = alloc::vec![
            ("Title source".into(), el("span").kid(pill(conf(bib.get("title_confidence").f()), label(bib.get("title_basis").str()))).kid(el("span").cls("hint").text(format!(" confidence {:.0}%", bib.get("title_confidence").f() * 100.0))).into()),
            ("Authors source".into(), el("span").kid(pill(conf(bib.get("authors_confidence").f()), label(bib.get("authors_basis").str()))).kid(el("span").cls("hint").text(format!(" confidence {:.0}%", bib.get("authors_confidence").f() * 100.0))).into()),
        ];
        if !bib.get("journal").str().is_empty() {
            rows.push(("Journal".into(), txt(bib.get("journal").str())));
        }
        if !bib.get("year").is_null() {
            rows.push(("Year".into(), txt(&bib.get("year").text())));
        }
        let alts = bib.get("title_alternatives").arr();
        card = card.kid(
            el("details")
                .cls("dossier-details")
                .kid(el("summary").text("Bibliographic provenance"))
                .kid(kv_table(rows))
                .kid_if(!alts.is_empty(), || {
                    el("div")
                        .kid(el("p").cls("hint").text("Other title candidates considered:"))
                        .kid(el("ul").kids(alts.iter().map(|a| -> N { el("li").text(a.any(&["value", "text"]).text()).kid(el("span").cls("hint").text(format!(" ({})", a.get("basis").text()))).into() })))
                        .into()
                }),
        );
    }
    let fab = refs.get("fabricated_dois").arr();
    if !fab.is_empty() {
        card = card.kid(el("details").cls("dossier-details").kid(el("summary").text(format!("Unresolvable DOIs ({})", fab.len()))).kid(el("ul").kids(fab.iter().map(|x| -> N { el("li").kid(el("code").text(x.text())).into() }))));
    }
    if auth.get("assessed").truthy() && !auth.get("note").str().is_empty() {
        card = card.kid(
            el("div")
                .cls("note")
                .kid(el("b").text("Authorship note. "))
                .kid(txt(auth.get("note").str()))
                .kid(el("ul").kids(auth.get("indicators").arr().iter().map(|i| -> N { el("li").kid(el("b").text(format!("{}: ", i.get("name").text()))).kid(txt(i.get("detail").str())).into() })))
                .kid_if(!auth.get("bias_statement").str().is_empty(), || el("p").cls("hint").text(auth.get("bias_statement").text()).into()),
        );
    }
    Some(card.into())
}

const MODEL_LABELS: [(&str, &str); 5] = [("llama", "Llama 3.3 70B"), ("mistral", "Mistral Large"), ("qwen", "Qwen 2.5 72B"), ("gemini", "Gemini 2.0 Flash"), ("scilem", "SciM Local Neural Engine")];

/// Adjudication and the model panel.
fn judge_panel(d: &Value) -> Option<N> {
    let consensus = d.get("consensus_raw");
    let meta = if d.get("judge_metadata").is_null() { consensus.get("_judge_metadata") } else { d.get("judge_metadata") };
    // (key, label, role, active, detail)
    let mut models: Vec<(String, String, String, bool, String)> = Vec::new();
    for (list, active) in [(meta.get("participating_models"), true), (meta.get("failed_models"), false)] {
        for m in list.arr() {
            let detail = match m.get("detail") {
                Value::Str(s) => s.clone(),
                Value::Null => String::new(),
                v => {
                    let mut o = String::new();
                    json::write(v, &mut o);
                    o
                }
            };
            models.push((m.get("key").text(), m.get("label").text(), m.get("role").text(), active, detail));
        }
    }
    // older records kept only the raw consensus
    for (k, label) in MODEL_LABELS {
        if models.iter().any(|m| m.0 == k) {
            continue;
        }
        let e = consensus.get(k);
        if e.is_null() {
            continue;
        }
        models.push((k.into(), label.into(), if k == "scilem" { "Structural Analyst".into() } else { "Panel Juror".into() }, !e.get("api_failed").truthy(), e.get("opinion").text()));
    }
    if models.is_empty() {
        return None;
    }
    let judge = meta.any(&["final_judge_label", "judge_provider"]).text().or_text("Not recorded");
    let tier = meta.get("tier").str();
    let tier_cls = match tier {
        "High" => "good",
        "Limited" => "bad",
        _ => "warn",
    };
    let active = models.iter().filter(|m| m.3 && m.0 != "scilem").count();
    let rows: Vec<(String, N)> = alloc::vec![
        ("Final judge".into(), el("code").text(judge.clone()).into()),
        ("Independent external jurors".into(), txt(&meta.get("external_juror_count").text().or_text("—"))),
        ("Inter-model agreement".into(), txt(&meta.get("inter_model_agreement").num().map(|a| format!("{:.0}%", a * 100.0)).unwrap_or_else(|| "—".into()))),
        ("Judgement quality".into(), pill(tier_cls, format!("{}{}", tier.to_string().or_text("Not graded"), meta.get("confidence").num().map(|c| format!(" · {:.2}", c)).unwrap_or_default()))),
    ];
    let first = |l: &str| l.split(' ').next().unwrap_or("").to_lowercase();
    let with_detail: Vec<&(String, String, String, bool, String)> = models.iter().filter(|m| !m.4.trim().is_empty()).collect();
    Some(
        el("div")
            .cls("card")
            .kid(el("h2").text("Adjudication and the model panel"))
            .kid(kv_table(rows))
            .kid_if(!meta.get("rationale").str().is_empty(), || el("p").cls("hint").text(meta.get("rationale").text()).into())
            .kid_if(active <= 1, || {
                el("div")
                    .cls("note")
                    .kid(el("b").text("Limited panel. "))
                    .kid(txt(&format!(
                        "{} external model contributed to this assessment, so cross-model corroboration was not available and the judgement quality reflects that. This is a deployment configuration matter, not a property of the manuscript.",
                        if active == 0 { "No" } else { "Only one" }
                    )))
                    .into()
            })
            .kid(
                el("table")
                    .cls("data-table")
                    .kid(el("thead").kid(el("tr").kid(el("th").text("Model")).kid(el("th").text("Role")).kid(el("th").text("Status"))))
                    .kid(el("tbody").kids(models.iter().map(|m| -> N {
                        let is_judge = !first(&m.1).is_empty() && judge.to_lowercase().contains(&first(&m.1));
                        el("tr")
                            .kid(el("td").text(m.1.clone()).kid_if(is_judge, || pill("accent", "Final judge")))
                            .kid(el("td").text(m.2.clone()))
                            .kid(
                                el("td")
                                    .kid(if m.3 { pill("good", "Participated") } else { pill("bad", "Unavailable") })
                                    .kid_if(!m.3 && !m.4.is_empty(), || el("div").cls("hint").text(m.4.chars().take(90).collect::<String>()).into()),
                            )
                            .into()
                    }))),
            )
            .kid_if(!with_detail.is_empty(), || {
                el("details")
                    .cls("dossier-details")
                    .kid(el("summary").text(format!("Individual model assessments ({})", with_detail.len())))
                    .kids(with_detail.iter().map(|m| -> N {
                        el("div")
                            .cls("llm-card")
                            .kid(el("div").cls("row").kid(el("b").text(m.1.clone())).kid(if m.3 { pill("good", "Participated") } else { pill("bad", "Unavailable") }))
                            .kid(el("p").style("white-space:pre-wrap").text(m.4.clone()))
                            .into()
                    }))
                    .into()
            })
            .into(),
    )
}

/// Field classification, the deterministic signals and the ledger record: the facts behind the score.
fn record_panels(s: &State, d: &Value) -> Vec<N> {
    let mut out: Vec<N> = Vec::new();
    let cls = d.get("classification");
    let fields: Vec<String> = cls.get("fields").arr().iter().map(|x| x.text()).collect();
    if !fields.is_empty() {
        let domains: Vec<String> = cls.get("domains").arr().iter().map(|x| x.text()).collect();
        let basis = match cls.get("basis").str() {
            "openalex-topics" => pill("good", "OpenAlex classifier"),
            "text-vocabulary" => pill("warn", "Inferred from text"),
            "insufficient-text" => pill("", "Insufficient text"),
            "no-vocabulary-match" => pill("", "No match"),
            b => pill("", b.to_string().or_text("unknown")),
        };
        let mut rows: Vec<(String, N)> = alloc::vec![("Fields".into(), txt(&fields.join(", ")))];
        if !domains.is_empty() {
            rows.push(("Domains".into(), txt(&domains.join(", "))));
        }
        rows.push(("Basis".into(), el("span").kid(basis).kid(el("span").cls("hint").text(cls.get("confidence").num().map(|c| format!(" confidence {:.0}%", c * 100.0)).unwrap_or_default())).into()));
        out.push(sec("Field classification", kv_table(rows)));
    }
    let mut sig: Vec<(String, N)> = Vec::new();
    if let Some(v) = d.get("mdar_score").num() {
        sig.push(("MDAR adherence".into(), txt(&format!("{:.1}%", v * 100.0))));
    }
    if let Some(v) = d.get("rrid_count").num() {
        sig.push(("Valid RRIDs detected".into(), txt(&format!("{}", v as i64))));
    }
    if let Some(v) = d.get("repro_score").num() {
        sig.push(("Reproducibility signal".into(), txt(&format!("{:.1}%", v * 100.0))));
    }
    if let Some(v) = d.get("scilem_rating").num() {
        sig.push(("SciM structural rating".into(), txt(&format!("{:.2}", v))));
    }
    if let Some(v) = d.get("logic_integrity").num() {
        sig.push(("Logic integrity".into(), txt(&format!("{:.1}", v))));
    }
    if !sig.is_empty() {
        out.push(sec("Deterministic signals", kv_table(sig)));
    }
    let hash = d.get("eval_hash").text();
    let mut rows: Vec<(String, N)> = alloc::vec![("Evaluation hash".into(), el("code").cls("wrap").text(hash.clone().or_text("—")).into()), ("piQ minted".into(), el("code").text(format!("{:.2}", d.get("piq").f())).into())];
    if d.get("fee_charged").f() > 0.0 {
        rows.push(("Processing fee".into(), el("code").text(format!("{:.2} piQ", d.get("fee_charged").f())).into()));
    }
    let tx = d.get("tx_hash").text();
    if !tx.is_empty() && tx != "Pending" && tx != "None" {
        let cell: N = match s.ledger.tx.data.as_ref().filter(|_| s.ledger.tx_for == tx) {
            Some(v) if !v.get("url").str().is_empty() => el("a").attr("href", v.get("url").text()).attr("target", "_blank").attr("rel", "noopener").kid(el("code").cls("wrap").text(tx.clone())).into(),
            Some(_) => el("span").kid(el("code").cls("wrap").text(tx.clone())).kid(el("span").cls("hint").text(" (not settled on-chain)")).into(),
            None => el("code").cls("wrap").text(tx.clone()).into(),
        };
        rows.push(("Transaction".into(), cell));
    }
    let zk = d.get("zk_proof").text();
    if !zk.is_empty() && zk != "None" {
        rows.push(("zk-SNARK proof".into(), el("code").cls("wrap").text(zk).into()));
    }
    let doi = d.get("doi").text();
    if !doi.is_empty() && doi != "None" {
        rows.push(("DOI".into(), el("code").text(doi).into()));
    }
    if !d.get("timestamp").is_null() {
        rows.push(("Assessed".into(), txt(&d.get("timestamp").str().replace('T', " ").chars().take(19).collect::<String>())));
    }
    out.push(sec("Ledger record", kv_table(rows)));
    if !hash.is_empty() {
        let h = url_encode(&hash);
        out.push(
            el("div")
                .cls("card")
                .kid(el("h2").text("Export").kid(help_btn("export")))
                .kid(
                    el("div")
                        .cls("row")
                        .kid(el("a").cls("btn primary").attr("href", format!("/api/dossier/{}/coara.html", h)).attr("target", "_blank").attr("rel", "noopener").text("CoARA dossier"))
                        .kid(el("a").cls("btn").attr("href", format!("/api/dossier/{}/fair", h)).attr("target", "_blank").attr("rel", "noopener").text("FAIR JSON")),
                )
                .kid(el("p").cls("hint").text("The CoARA dossier is a printable record for evaluation portfolios. The FAIR JSON is machine-actionable and EOSC-aligned, for institutional repositories and reference managers."))
                .into(),
        );
    }
    out
}

/// The paper itself (download.js): the stored manuscript when the server lets this reader have it — asked for with
/// the session, so an author gets their own private file — and otherwise the publisher's copy through its DOI.
fn download_button(d: &Value) -> N {
    let hash = d.get("eval_hash").text();
    let doi = safe_doi(d.get("doi").str());
    if hash.is_empty() || (!d.get("has_file").truthy() && doi.is_empty()) {
        return txt("");
    }
    let name: String = d.get("title").str().chars().filter(|c| !"/\\:*?\"<>|".contains(*c)).take(80).collect::<String>().or_text("paper");
    el("button")
        .attr("type", "button")
        .cls("btn")
        .attr("title", if d.get("has_file").truthy() { "The manuscript that was assessed" } else { "The publisher's copy, through its DOI" })
        .on("click", Msg::T(Tool::Ledger, 41, format!("{}\t{}.pdf\t{}", hash, name, doi)))
        .text("Download paper")
        .into()
}

fn paper_download(v: &str) {
    let mut it = v.split('\t');
    let (hash, name, doi) = (it.next().unwrap_or(""), it.next().unwrap_or("paper.pdf"), it.next().unwrap_or(""));
    let fallback = if doi.is_empty() { String::new() } else { format!("https://doi.org/{}", doi) };
    host::call("getfile", &format!("/api/papers/{}/file?download=1\t{}\t{}", url_encode(hash), name, fallback));
}

fn tx_load(d: &Value) {
    let tx = d.get("tx_hash").text();
    let l = &mut st().ledger;
    if tx.is_empty() || tx == "Pending" || tx == "None" || l.tx_for == tx {
        return;
    }
    l.tx_for = tx.clone();
    l.tx.reset();
    l.tx.busy = true;
    request(Want::Tool(Tool::Ledger, 4), "GET", &format!("/api/explorer/tx-url?tx={}", url_encode(&tx)), "", 0);
}

const DOSSIER_CSS: &str = "\
.dossier-sec summary{cursor:pointer;list-style:none}.dossier-sec summary::-webkit-details-marker{display:none}.dossier-sec summary h2{display:inline;font-size:18px}.dossier-sec summary::after{content:' ▸';color:var(--faint)}.dossier-sec[open] summary::after{content:' ▾'}\
.dossier-sec[open] summary{margin-bottom:10px}.dossier-details{margin:10px 0}.dossier-details summary{cursor:pointer;color:var(--muted)}\
.diag-item{border-left:3px solid var(--line2);padding:6px 12px;margin:8px 0}.diag-item p{margin:4px 0}\
.diag-badge{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:2px 6px;border-radius:6px;background:var(--soft)}\
.diag-critical{border-color:#dc2626}.diag-critical .diag-badge{background:#fde2e2;color:#991b1b}\
.diag-major{border-color:#ea580c}.diag-major .diag-badge{background:#ffedd5;color:#9a3412}\
.diag-minor{border-color:#ca8a04}.diag-positive{border-color:#16a34a}.diag-positive .diag-badge{background:#dcfce7;color:#166534}\
.ok-box{padding:10px 12px;border-radius:8px;background:rgba(22,163,74,.07);color:#166534}\
.ref-list{font-size:13px;padding-left:22px}.ref-list li{margin:3px 0}\
.llm-card{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}\
.md table{border-collapse:collapse;margin:8px 0}.md td{border:1px solid var(--line);padding:4px 8px}.md blockquote{border-left:3px solid var(--line2);margin:8px 0;padding:2px 12px;color:var(--muted)}.md code{font-family:var(--mono,monospace);background:var(--soft);padding:1px 4px;border-radius:4px}\
.crit tr.gap td{background:rgba(234,88,12,.08)}.crit .override{color:#9a3412}\
";
