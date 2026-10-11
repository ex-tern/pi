"""routes/analytics.py: analytics: summary, fields, emission, rescoring, architecture, rubric, leaderboards, the map. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import require_owner  # noqa: F401
from routes.piq import PIQ_TOTAL_SQL, count_assessed_papers, piq_fields, resolve_active_fee  # noqa: F401
from routes.reviews import REVIEW_MIN_CHARS  # noqa: F401

router = APIRouter()



# ---------------------------------------------------------------------------
# 7. ANALYTICS — leaderboard, top papers, map-of-science bubble network
# ---------------------------------------------------------------------------
def list_corpus_fields():
    """Fields actually present in the assessed corpus, most common first.

    Replaces a hardcoded nine-item list that bore no relation to what had been
    assessed. The filter now offers exactly the fields a user can actually
    filter by, so selecting one always returns something.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT fields FROM papers_assessment").fetchall()
    finally:
        conn.close()

    counts = defaultdict(int)
    for (raw,) in rows:
        try:
            for f in json.loads(raw) if raw else []:
                if f and f != "Unclassified":
                    counts[f] += 1
        except Exception:
            continue
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [f for f, _ in ranked], dict(ranked)


def aggregate_author_statistics(rows):
    """rows: (author_name, piq_minted, final_score[, piq_escrowed, piq_claimed_at]).

    Splits comma-joined author strings, filters out institutions/unknowns, and
    aggregates per individual author name.

    Three figures are produced, and they mean different things:

      * `minted`  — released to a verified author. Spendable.
      * `held`    — earned by the paper but not yet released, because
                    authorship has not been verified. Not spendable.
      * `claimed` — escrow the author has since claimed. Already credited to
                    their account, so it is no longer held — but it was still
                    earned by the work, and the total keeps counting it.
      * `piq`     — the total the work has earned, minted + held + claimed.
                    This is what the leaderboard ranks and displays.

    `claimed` exists because of a real regression: an author who verified
    their authorship and claimed their escrow watched their leaderboard row
    fall by the amount they had just been paid, because the claim moved the
    piQ out of `held` and nothing counted it afterwards. Claiming is not
    un-earning. The total is now invariant across a claim; only the split
    between held and claimed moves.

    The leaderboard ranks on the TOTAL. It previously ranked and displayed
    `minted` alone, which read as 0.00 for every author on a corpus where
    nobody had verified authorship yet — a table of real scholars credited
    with nothing, which says the opposite of what is true. What an author's
    work has earned is a fact about the work; whether it has been released
    yet is a fact about their account, and belongs beside the number rather
    than in place of it.
    """
    authors = {}
    for row in rows:
        author_str, piq, score = row[0], row[1], row[2]
        escrowed = safe_float(row[3], 0.0) if len(row) > 3 else 0.0
        claimed = bool(row[4]) if len(row) > 4 else True
        ca = clean_author_name(author_str)
        if not ca or ca.lower() in ("unidentified", "unknown") or is_likely_institution(ca):
            continue
        names = [x.strip() for x in ca.split(",") if x.strip()]
        if not names:
            continue

        # --- Split the paper's piQ across its authors ----------------------
        # Each co-author previously received the paper's FULL emission, so a
        # five-author paper that minted 10 piQ put 10 piQ against all five and
        # the leaderboard column summed to 50 for piQ that does not exist. The
        # table was not describing a distribution of anything — it was counting
        # one emission once per name on the byline.
        #
        # An equal split is used because the manuscript gives no basis for any
        # other one. CRediT roles are extracted elsewhere, but role is not a
        # share: "wrote the manuscript" and "ran the experiments" cannot be
        # ranked against each other without inventing a weighting, and first or
        # last position means opposite things in different fields. Equal shares
        # are the only division the document actually supports, and the whole
        # column now sums to what was really emitted.
        #
        # This is a DISPLAY split. The ledger is unchanged: piQ still settles
        # to the one identity whose authorship was verified, because a
        # co-author with no wallet and no ORCID has no account to settle into.
        # See the note on the endpoint below.
        share = 1.0 / len(names)
        for a in names:
            rec = authors.setdefault(a, {"author": a, "minted": 0.0, "held": 0.0,
                                         "claimed": 0.0, "papers": 0, "_score_sum": 0.0})
            rec["minted"] += safe_float(piq, 0.0) * share
            # Escrow counts either way — as held while unclaimed, as claimed
            # once released. It is NOT folded into `minted`: releasing escrow
            # credits the piQ ledger and leaves piq_minted untouched, so adding
            # it there would double-count against the spendable balance.
            if claimed:
                rec["claimed"] += escrowed * share
            else:
                rec["held"] += escrowed * share
            # Papers are NOT split. Co-authoring a paper is authoring it — a
            # five-author paper is one paper each, not a fifth of one.
            rec["papers"] += 1
            rec["_score_sum"] += safe_float(score, 0.0)
    results = []
    for rec in authors.values():
        rec["avg_score"] = round(rec["_score_sum"] / rec["papers"], 2) if rec["papers"] else 0.0
        rec["minted"] = round(rec["minted"], 2)
        rec["held"] = round(rec["held"], 2)
        rec["claimed"] = round(rec["claimed"], 2)
        # `piq` is the total, and is the field the leaderboard sorts and shows.
        # Invariant across a claim: claiming moves piQ from held to claimed.
        rec["piq"] = round(rec["minted"] + rec["held"] + rec["claimed"], 2)
        del rec["_score_sum"]
        results.append(rec)
    return results


@router.get("/api/analytics/summary")
def analytics_summary():
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT COUNT(*), COALESCE(SUM(piq_minted),0), COALESCE(AVG(final_score),0),
                      COALESCE(SUM(CASE WHEN piq_claimed_at IS NULL THEN piq_escrowed ELSE 0 END),0),
                      MIN(timestamp), MAX(timestamp)
               FROM papers_assessment"""
        ).fetchone()
        author_rows = conn.execute("SELECT author_name, 0, 0 FROM papers_assessment").fetchall()
    finally:
        conn.close()
    unique_authors = {r["author"] for r in aggregate_author_statistics(author_rows)}
    return {
        "total_papers": row[0] or 0,
        # Settled: minted to a verified author. This is what the leaderboard
        # ranks and what settles on-chain, so it must never include a claim
        # that has not been proven.
        "total_piq": round(safe_float(row[1], 0.0), 2),
        # Earned but held pending authorship verification. Reported separately
        # so the corpus total reflects work done, without conflating "earned"
        # with "credited to a proven author".
        "total_piq_escrowed": round(safe_float(row[3], 0.0), 2),
        "total_piq_earned": round(safe_float(row[1], 0.0) + safe_float(row[3], 0.0), 2),
        "avg_score": round(safe_float(row[2], 0.0), 2),
        "unique_authors": len(unique_authors),
        # Distinct visitors, counted by keyed IP hash. Reported here so the
        # analytics tab can show reach alongside output — a corpus of 40 papers
        # reads very differently at 60 visitors than at 6,000.
        "visitors": visitor_stats(),
        "earliest": row[4],
        "latest": row[5],
    }


@router.get("/api/analytics/fields")
def analytics_fields():
    fields, counts = list_corpus_fields()
    return {"fields": fields, "counts": counts, "source": "assessed-corpus"}


@router.get("/api/emission")
def get_emission_policy():
    """Publish the piQ emission policy and the corpus's current position on it.

    Difficulty that nobody can inspect is indistinguishable from difficulty
    that is arbitrary, so the whole schedule is published: where the corpus
    sits, what the current factors are, and exactly what happens next.
    """
    conn = get_db_connection()
    try:
        total = conn.execute("SELECT COUNT(*) FROM papers_assessment").fetchone()[0]
        minted = conn.execute("SELECT COALESCE(SUM(piq_minted), 0) FROM papers_assessment").fetchone()[0]
    finally:
        conn.close()
    manifest = emission_manifest(total)
    manifest["total_piq_minted"] = round(safe_float(minted, 0.0), 4)
    manifest["fee"] = fee_manifest(total, PIQ_PROCESSING_FEE)
    manifest["onboarding_grant"] = onboarding_grant(PIQ_PROCESSING_FEE)
    return manifest


class RescoreRequest(BaseModel):
    dry_run: bool = True
    limit: int = 500


@router.post("/api/admin/rescore")
def rescore_corpus(req: RescoreRequest, request: Request, wallet: str = Query(default="")):
    """Replay stored signal vectors through the current rubric.

    Scores were previously computed once and frozen, so a rubric change left
    old and new scores silently incomparable on the same leaderboard. Because
    the normalized signal vector is persisted with every assessment, re-scoring
    needs no re-analysis and no LLM calls: it is a pure recomputation.

    Defaults to a dry run that reports what would change without writing.
    """
    require_owner(request, wallet)

    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT eval_hash, signal_vector, rubric_version, final_score
               FROM papers_assessment
               WHERE signal_vector IS NOT NULL AND signal_vector != '{}'
               ORDER BY timestamp DESC LIMIT ?""",
            (max(1, min(5000, req.limit)),),
        ).fetchall()

        weight_row = conn.execute(
            """SELECT block_height, w1, w2, w3, w4, w5, w6, w7, w8
               FROM blockchain_por_weights ORDER BY block_height DESC LIMIT 1"""
        ).fetchone()
        epoch = weight_row[0] if weight_row else 0
        epoch_weights = list(weight_row[1:9]) if weight_row else None

        examined, changed, updates = 0, 0, []
        for eval_hash, raw_signals, old_version, old_score in rows:
            signals = parse_json_or_default(raw_signals, None)
            if not signals:
                continue
            examined += 1
            scores = apply_scoring_rubric(signals)
            new_score = compute_composite_score(scores, epoch_weights)
            delta = new_score - safe_float(old_score, 0.0)
            if abs(delta) > 0.01 or old_version != RUBRIC_VERSION:
                changed += 1
                updates.append((eval_hash, scores, new_score, compute_composite_score(scores), delta))

        if not req.dry_run:
            for eval_hash, scores, new_score, unweighted, _ in updates:
                conn.execute(
                    """UPDATE papers_assessment
                       SET c1=?, c2=?, c3=?, c4=?, c5=?, c6=?, c7=?, c8=?,
                           final_score=?, unweighted_score=?, rubric_version=?, scoring_epoch=?
                       WHERE eval_hash=?""",
                    (*scores.values(), new_score, unweighted, RUBRIC_VERSION, epoch, eval_hash),
                )
            conn.commit()
            add_log(f"Re-scored {len(updates)} record(s) under {RUBRIC_VERSION}.")
    finally:
        conn.close()

    return {
        "dry_run": req.dry_run,
        "rubric_version": RUBRIC_VERSION,
        "scoring_epoch": epoch,
        "examined": examined,
        "changed": changed,
        "sample": [
            {"eval_hash": h, "new_score": round(ns, 2), "delta": round(d, 2)}
            for h, _, ns, _, d in updates[:20]
        ],
        "note": (
            "Dry run: no records were modified. Re-run with dry_run=false to apply."
            if req.dry_run else
            "Records updated in place. piQ already minted is not retroactively changed."
        ),
    }


@router.get("/api/architecture")
def architecture_parameters():
    """Live values the architecture diagram renders.

    The diagram previously hardcoded "0.10 piQ", "piX >= 50" and a fixed juror
    list. Every one of those has since changed at least once, and a diagram
    that silently disagrees with the running system is worse than no diagram —
    it is documentation that lies with authority. These are read from the
    modules that actually govern behaviour, so the picture cannot drift.
    """
    corpus = count_assessed_papers()
    jurors = provider_configuration()["jurors"]
    reachable = [name for name, meta in jurors.items() if meta["reachable"]]

    return {
        "free_documents": abuse_guard.FREE_DOCUMENTS,
        "minimum_fee": MINIMUM_FEE,
        "current_fee": resolve_active_fee(),
        "fee_is_size_scaled": True,
        "quality_threshold": round(emission_manifest(corpus)["current_quality_floor"], 1),
        "logic_floor": emission_manifest(corpus)["logic_floor"],
        "halving_epoch": emission_manifest(corpus)["current_epoch"],
        "corpus_size": corpus,
        "jurors": reachable or ["structural analyser only"],
        "juror_count": len(reachable),
        "rubric_version": RUBRIC_VERSION,
        "criteria_count": len(BRAIN_CRITERIA_ORDER),
        "verifiable_share": rubric_manifest()["confidence"]["verifiable_share"],
        "chain_name": CHAIN_NAME,
        "proof_of_work": REQUIRE_PROOF_OF_WORK,
        "authorship_required_for_minting": True,
        "onboarding_grant": NEW_PARTICIPANT_GRANT,
        # The review → publish pipeline. Added because the diagram had no
        # review stage at all while review had become the gate on publication
        # — the single most consequential rule on the platform was missing
        # from the picture that claims to describe it.
        "peer_review_fee": peer_review_fee()["fee"],
        "peer_review_bonus": PEER_REVIEW_BONUS,
        "llm_review_fee": llm_review_fee()["fee"],
        "review_required_before_publish": True,
        "review_min_chars": REVIEW_MIN_CHARS,
        "reviewer_needs_publication": True,
        "rebuttal_min_chars": REBUTTAL_MIN_CHARS,
        "publication_fee": publication_fee(60.0)["fee"],
        "rib_tutor": rib_engine.tutor_status().get("active", False),
    }


@router.get("/api/rubric")
def get_rubric():
    """Publish the scoring rubric.

    CoARA's transparency commitment requires quantitative indicators be
    published with their methodology. Exposing the rubric as data — rather
    than leaving it implicit in code — is what makes every score auditable.
    """
    return rubric_manifest()


@router.get("/api/analytics/leaderboard")
def analytics_leaderboard(
    q: str = Query(default=""),
    sort: str = Query(default="piq", pattern="^(piq|papers|avg_score|author)$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT author_name, piq_minted, final_score, piq_escrowed, piq_claimed_at "
            "FROM papers_assessment").fetchall()
    finally:
        conn.close()

    results = aggregate_author_statistics(rows)
    if q.strip():
        q_lower = q.strip().lower()
        results = [r for r in results if q_lower in r["author"].lower()]

    results.sort(key=lambda r: r[sort], reverse=(order == "desc"))
    total = len(results)
    page = results[offset: offset + limit]
    return {"rankings": page, "total": total}


@router.get("/api/analytics/top-papers")
def analytics_top_papers(
    q: str = Query(default=""),
    min_score: float = Query(default=0.0, ge=0.0, le=100.0),
    max_score: float = Query(default=100.0, ge=0.0, le=100.0),
    sort: str = Query(default="score", pattern="^(score|piq|date|title|logic)$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    # Sorting by piQ orders by the TOTAL, which is the figure the column
    # displays. Ordering by piq_minted while showing minted+held would put rows
    # out of sequence with their own numbers.
    # Escrow is counted claimed or not — the same rule piq_fields() displays by,
    # so claiming cannot move a paper's rank.
    sort_col = {"score": "final_score",
                "piq": PIQ_TOTAL_SQL,
                "date": "timestamp", "title": "title", "logic": "logic_score"}[sort]
    order_sql = "DESC" if order == "desc" else "ASC"

    clauses = ["final_score >= ?", "final_score <= ?"]
    params = [min_score, max_score]
    if q.strip():
        clauses.append("(title LIKE ? OR author_name LIKE ?)")
        like = f"%{q.strip()}%"
        params.extend([like, like])
    where_sql = " AND ".join(clauses)

    conn = get_db_connection()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM papers_assessment WHERE {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"""SELECT title, author_name, final_score, piq_minted, logic_score,
                       mdar_adherence_score, reproducibility_score, timestamp, eval_hash, tx_hash,
                       piq_escrowed, piq_claimed_at
                FROM papers_assessment
                WHERE {where_sql}
                ORDER BY {sort_col} {order_sql}
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()
    finally:
        conn.close()

    papers = [{
        "title": r[0], "author": clean_author_name(r[1]), "score": r[2],
        # Total earned, with the held portion alongside — the same rule every
        # other table follows. Reporting piq_minted alone is why this board
        # showed 0.00 for papers the history showed as 8.33.
        **piq_fields(r[3], r[10], r[11]),
        "logic_score": r[4], "mdar_score": r[5], "repro_score": r[6], "date": r[7],
        "eval_hash": r[8], "tx_hash": r[9],
    } for r in rows]
    return {"papers": papers, "total": total}


def format_topic_path(field: str, subfield: str) -> str:
    """Compose a 'Domain > Field' path from stored classification data.

    This replaces a keyword-matching function that ran over the hardcoded
    strings every record was written with. Because those strings were always
    the same two literals, the mapping's seventeen branches were decorative:
    every paper fell through to the same terminal label. Fields now come from
    OpenAlex (or the text classifier), so the real hierarchy is already known
    and simply needs formatting.
    """
    field = (field or "").strip() or "Unclassified"
    subfield = (subfield or "").strip()
    domain = FIELD_TO_DOMAIN.get(field, "Other")
    if subfield and subfield.lower() != field.lower():
        return f"{domain} > {field} > {subfield}"
    return f"{domain} > {field}"


@router.get("/api/analytics/map")
def analytics_map(
    author: str = Query(default="All Authors"),
    min_score: float = Query(default=0.0, ge=0.0, le=100.0),
    max_score: float = Query(default=100.0, ge=0.0, le=100.0),
    fields: str = Query(default=""),
    max_nodes: int = Query(default=20, ge=5, le=50),
):
    """Returns bubble/network data as JSON (nodes + edges + legend rows) so
    the frontend can render it with vis-network (loaded from CDN) instead of
    the old server-side PyVis-generated iframe HTML."""
    selected_fields = {f.strip() for f in fields.split(",") if f.strip()} if fields.strip() else None

    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT fields, subfields, final_score, author_name FROM papers_assessment").fetchall()
    finally:
        conn.close()

    topic_aggregates = {}
    exclude_terms = {"unclassified", "unspecified", "none", ""}
    for fields_json, subfields_json, final_score, author_str in rows:
        cleaned_author = clean_author_name(author_str)
        if author and author != "All Authors" and author not in cleaned_author:
            continue
        score = safe_float(final_score, 50.0)
        if score < min_score or score > max_score:
            continue
        try:
            paper_fields = [f.strip() for f in json.loads(fields_json or "[]") if f]
            paper_subfields = [s.strip() for s in json.loads(subfields_json or "[]") if s]
        except Exception:
            continue

        # Pair each field with its corresponding subfield where the classifier
        # produced both; fall back to the field alone otherwise.
        pairs = []
        for i, f in enumerate(paper_fields):
            sub = paper_subfields[i] if i < len(paper_subfields) else ""
            pairs.append((f, sub))
        if not pairs:
            pairs = [(s, "") for s in paper_subfields]

        for field, subfield in pairs:
            if not field or field.lower() in exclude_terms:
                continue
            # The filter operates on the field, which is what the UI offers.
            if selected_fields and field not in selected_fields:
                continue
            path = format_topic_path(field, subfield)
            agg = topic_aggregates.setdefault(path, {"weight_sum": 0.0, "frequency": 0})
            agg["weight_sum"] += score
            agg["frequency"] += 1

    if not topic_aggregates:
        return {"nodes": [], "edges": [], "legend": [], "empty": True}
    if len(topic_aggregates) > max_nodes:
        sorted_topics = sorted(topic_aggregates.items(), key=lambda x: (x[1]["frequency"], x[1]["weight_sum"]), reverse=True)
        topic_aggregates = dict(sorted_topics[:max_nodes])

    unique_topics = list(topic_aggregates.keys())
    major_fields = {}
    for topic in unique_topics:
        major = topic.split(">")[0].strip()
        major_fields.setdefault(major, []).append(topic)

    major_keys = sorted(major_fields.keys())
    color_map = {}
    for i, major in enumerate(major_keys):
        h = i / len(major_keys) if major_keys else 0
        subfields = sorted(major_fields[major])
        n_subs = len(subfields)
        for j, topic in enumerate(subfields):
            if n_subs <= 1:
                s, v = 0.7, 0.9
            else:
                ratio = j / (n_subs - 1)
                s = 0.4 + (0.5 * ratio)
                v = 0.95 - (0.35 * ratio)
            rgb = colorsys.hsv_to_rgb(h, s, v)
            color_map[topic] = "#%02x%02x%02x" % tuple(int(x * 255) for x in rgb)

    nodes, legend = [], []
    for topic, metrics in topic_aggregates.items():
        avg_weight = metrics["weight_sum"] / metrics["frequency"]
        node_size = max(20, 15 + (avg_weight * 0.3))
        nodes.append({
            "id": topic, "label": "", "title": f"{topic} | Frequency: {metrics['frequency']} | Avg Score: {avg_weight:.1f}",
            "size": node_size, "color": color_map[topic],
            "frequency": metrics["frequency"], "avg_score": round(avg_weight, 1),
        })
        legend.append({"topic": topic, "color": color_map[topic], "frequency": metrics["frequency"], "avg_weight": round(avg_weight, 1)})

    edges = []
    for i, t1 in enumerate(unique_topics):
        for j, t2 in enumerate(unique_topics):
            if i < j and t1.split(">")[0].strip() == t2.split(">")[0].strip():
                edges.append({"from": t1, "to": t2})

    legend.sort(key=lambda x: x["frequency"], reverse=True)
    return {"nodes": nodes, "edges": edges, "legend": legend, "empty": False}
