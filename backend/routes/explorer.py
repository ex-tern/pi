"""routes/explorer.py: the ledger explorer and dossiers (FAIR, CoARA). Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.analytics import list_corpus_fields  # noqa: F401
from routes.identity import _profile_key  # noqa: F401
from routes.piq import piq_fields, resolve_active_fee, settlement_state  # noqa: F401

router = APIRouter()



# ---------------------------------------------------------------------------
# 8. LEDGER EXPLORER
# ---------------------------------------------------------------------------
EXPLORER_COLUMNS = """p.title, p.author_name, p.filename, p.final_score, p.logic_score,
   p.c1, p.c2, p.c3, p.c4, p.c5, p.c6, p.c7, p.c8,
   p.piq_minted, p.tx_hash, p.zk_proof, p.mdar_adherence_score,
   p.rrid_valid_count, p.reproducibility_score, p.eval_hash,
   p.consensus_data, p.evidence_report, p.scilem_score,
   p.warnings_json, p.judge_metadata, p.timestamp, p.doi, p.user_id, p.eth_book,
   p.integrity_report, p.reference_audit, p.authorship_signal, p.topology_detail,
   p.classification, p.criteria_breakdown, p.author_metrics, p.rubric_version,
   p.emission_record, p.attribution"""

CRITERIA_TITLES = {
    "C1": "Semantic Originality", "C2": "Methodological Rigor", "C3": "Interdisciplinary Synergy",
    "C4": "Societal Impact", "C5": "Open Science", "C6": "Literature Integration",
    "C7": "Empirical Density", "C8": "Future Actionability",
}


def build_dossier_from_row(r):
    consensus = parse_json_or_default(r[20], {})
    judge_meta = parse_json_or_default(r[24], {}) or consensus.get("_judge_metadata", {}) or {}
    scores = {"C1": r[5], "C2": r[6], "C3": r[7], "C4": r[8], "C5": r[9], "C6": r[10], "C7": r[11], "C8": r[12]}
    return {
        "title": r[0], "author_name": r[1], "filename": r[2], "score": r[3], "logic_integrity": r[4],
        "scores_dict": scores,
        "criteria_detail": [
            {"id": k, "title": CRITERIA_TITLES[k], "score": safe_float(v, 0.0)} for k, v in scores.items()
        ],
        "piq": r[13], "tx_hash": r[14], "zk_proof": r[15], "mdar_score": r[16], "rrid_count": r[17],
        "repro_score": r[18], "eval_hash": r[19],
        "consensus_raw": consensus,
        "evidence_report_text": r[21] or "",
        "scilem_rating": r[22],
        "warnings": parse_json_or_default(r[23], []),
        "judge_metadata": judge_meta,
        "timestamp": r[25], "doi": real_doi(r[26]), "submitted_by": r[27], "eth_book": r[28],
        "integrity": parse_json_or_default(r[29], {}),
        "reference_audit": parse_json_or_default(r[30], {}),
        "authorship_signal": parse_json_or_default(r[31], {}),
        "topology_detail": parse_json_or_default(r[32], {}),
        "classification": parse_json_or_default(r[33], {}),
        "criteria_breakdown": parse_json_or_default(r[34], []),
        "author_metrics": parse_json_or_default(r[35], {}),
        "rubric_version": r[36],
        "emission": parse_json_or_default(r[37], {}),
        "explorer_url": get_sepolia_explorer_url(r[14], "tx"),
        "fee_charged": resolve_active_fee(),
    }


def restrict_to_existing_columns(conn, requested: str) -> str:
    """Restrict a column list to columns that actually exist.

    A long-running process can hold a stale schema, and naming a missing column
    fails the whole query — which is what turned the Ledger Explorer into a
    blanket "Error loading ledger". Degrading to the available subset keeps the
    explorer usable while the migration catches up.
    """
    try:
        present = {row[1] for row in conn.execute("PRAGMA table_info(papers_assessment)")}
    except sqlite3.Error:
        return requested
    kept = []
    for col in (c.strip() for c in requested.replace("\n", " ").split(",")):
        if not col:
            continue
        bare = col.split(".")[-1].strip()
        kept.append(col if bare in present else f"NULL AS {bare}")
    return ", ".join(kept)


@router.get("/api/explorer/search")
def explorer_search(q: str = Query(default="")):
    conn = get_db_connection()
    try:
        if q.strip():
            q_term = f"%{q.strip()}%"
            rows = conn.execute(
                f"""SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)}
                    FROM papers_assessment p
                    LEFT JOIN blockchain_por_weights b ON p.eval_hash = b.eval_hash
                    WHERE b.block_hash LIKE ? OR p.eval_hash LIKE ? OR p.title LIKE ? OR p.author_name LIKE ?
                    LIMIT 10""",
                (q_term, q_term, q_term, q_term),
            ).fetchall()
        else:
            rows = conn.execute(f"SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p ORDER BY p.timestamp DESC LIMIT 20").fetchall()
    finally:
        conn.close()
    return {"records": [build_dossier_from_row(r) for r in rows]}


# Sortable columns, whitelisted. The sort key reaches an ORDER BY clause, so
# it can never be interpolated from user input directly — a mapping is the
# only safe way to expose sorting over a SQL query.
_EXPLORER_SORTS = {
    "date": "p.timestamp",
    "score": "p.final_score",
    # Total earned, claimed or not — see PIQ_TOTAL_SQL. Claiming an award must
    # not reorder the explorer.
    "piq": "(COALESCE(p.piq_minted,0) + COALESCE(p.piq_escrowed,0))",
    "title": "p.title",
    "author": "p.author_name",
}


@router.get("/api/explorer/latest")
def explorer_latest(
    min_score: float = Query(default=0.0, ge=0.0, le=100.0),
    max_score: float = Query(default=100.0, ge=0.0, le=100.0),
    field: str = Query(default="", max_length=400),   # comma-separated; matches ANY
    sort: str = Query(default="date"),
    order: str = Query(default="desc"),
    limit: int = Query(default=25, ge=1, le=200),
):
    """Ledger records, filtered and sorted.

    The filtering controls moved here from the leaderboards. A leaderboard's
    job is to show a ranking; the moment it is filtered it stops being one,
    because "top papers scoring at least 80" is a search result wearing a
    ranking's clothes. The explorer is the surface whose job IS finding a
    particular record, so that is where the filters belong.
    """
    sort_column = _EXPLORER_SORTS.get(sort, _EXPLORER_SORTS["date"])
    direction = "ASC" if str(order).lower() == "asc" else "DESC"

    conn = get_db_connection()
    try:
        # Joined against the Proof-of-Research chain so the explorer shows
        # actual ledger data — block height, validator, block hash, proof and
        # settlement transaction — rather than a plain list of titles.
        #
        # NULL scores sort last in both directions: a paper with no score is
        # not the best paper, and it is not the worst either — it is absent
        # from the ranking, and putting it at the top of an ascending sort
        # would misrepresent it as a zero.
        rows = conn.execute(
            f"""SELECT p.title, p.author_name, p.final_score, p.eval_hash, p.timestamp,
                      p.tx_hash, p.zk_proof, p.piq_minted,
                      b.block_height, b.block_hash, b.previous_hash, b.validator_node,
                      b.por_proof, b.model_used, b.formulas_hash, p.fields,
                      p.published_at, p.piq_escrowed, p.piq_claimed_at,
                      -- Needed to tell "nothing to settle to" apart from
                      -- "settlement owed": both used to render as "Local".
                      p.eth_book
               FROM papers_assessment p
               LEFT JOIN blockchain_por_weights b ON p.eval_hash = b.eval_hash
               WHERE COALESCE(p.final_score, 0) >= ? AND COALESCE(p.final_score, 0) <= ?
               ORDER BY ({sort_column} IS NULL), {sort_column} {direction}
               LIMIT ?""",
            (min_score, max_score, int(limit)),
        ).fetchall()
    except sqlite3.Error as e:
        add_log(f"Ledger read failed: {e}")
        raise HTTPException(status_code=503,
                            detail="The ledger database is unavailable. If the server was recently "
                                   "updated, restart it so the schema migration can run.")
    finally:
        conn.close()
    records = []
    # A list, matched with OR. Researchers work across several fields, and a
    # single-value filter forced them to run the same query once per field.
    wanted_fields = {f.strip().lower() for f in (field or "").split(",") if f.strip()}
    for r in rows:
        # Field filtering is done here rather than in SQL because `fields` is a
        # JSON array in a TEXT column; a LIKE against it would match substrings
        # across element boundaries ("Biology" matching "Marine Biology" is
        # fine, but "Bio" matching either is not).
        try:
            row_fields = [str(f).strip() for f in json.loads(r[15] or "[]") if str(f).strip()]
        except (ValueError, TypeError):
            row_fields = []
        if wanted_fields and not any(f.lower() in wanted_fields for f in row_fields):
            continue
        tx = r[5]
        st = settlement_state(tx, r[19] if len(r) > 19 else "", r[7])
        records.append({
            "fields": row_fields,
            "published": bool(r[16]),
            "published_at": r[16],
            "title": r[0], "author": clean_author_name(r[1]), "score": r[2],
            "eval_hash": r[3], "timestamp": r[4],
            "tx_hash": tx, "explorer_url": get_sepolia_explorer_url(tx, "tx"),
            "settled": st["state"] == "on-chain",
            # Three states, not two. "Local" for both an unsettleable record and
            # one the deployment owes money on made a real backlog invisible.
            "settlement": st["state"],
            "settlement_label": st["label"],
            "settlement_note": st["note"],
            "zk_proof": r[6], **piq_fields(r[7], r[17], r[18]),
            "block_height": r[8], "block_hash": r[9], "previous_hash": r[10],
            "validator_node": r[11], "por_proof": r[12], "model_used": r[13],
            "formulas_hash": r[14],
        })
    return {
        "records": records,
        "count": len(records),
        # The filter dropdown is built from fields that are actually present in
        # the corpus, so selecting one always returns something.
        # list_corpus_fields() returns (ordered_names, counts_by_name). Serialising
        # the whole tuple sent the browser [[...names...], {...counts...}], so the
        # filter rendered two nonsense entries instead of a field list.
        "available_fields": list_corpus_fields()[0],
        "filters": {"min_score": min_score, "max_score": max_score,
                    "field": field, "sort": sort, "order": direction.lower()},
        "chain": {
            "network": CHAIN_NAME, "chain_id": CHAIN_ID, "explorer": BLOCK_EXPLORER_URL,
        },
    }


@router.get("/api/explorer/dossier/{eval_hash}")
def explorer_dossier(eval_hash: str, request: Request = None,
                     wallet: str = Query(default=""), orcid: str = Query(default="")):
    conn = get_db_connection()
    try:
        row = conn.execute(f"SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p WHERE p.eval_hash = ?", (eval_hash,)).fetchone()
        status = conn.execute(
            "SELECT published_at, publish_kind, piq_minted, piq_escrowed, piq_claimed_at "
            "FROM papers_assessment WHERE eval_hash = ?", (eval_hash,)).fetchone()
    except sqlite3.Error:
        status = None
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")

    dossier = build_dossier_from_row(row)

    # piQ read from the authoritative columns, not from the emission_record
    # JSON. The blob is written by the assessment pipeline and is empty ('{}')
    # for every row assessed before it existed, so a dossier built from it
    # reported "piQ 0.00" on papers that had plainly minted or escrowed piQ.
    # piq_minted and piq_escrowed are the columns the balance and the escrow
    # claim both read; the dossier now agrees with them by construction.
    if status:
        dossier["piq"] = round(safe_float(status[2], 0.0), 4)
        dossier["escrowed"] = round(safe_float(status[3], 0.0), 4)
        dossier["claimed"] = bool(status[4])
    # Publication and review state travel with the dossier so the seals render
    # the same wherever the dossier is opened from — a badge that appears on a
    # card and vanishes in the full record is worse than no badge.
    summary = review_summary(eval_hash)
    reviews = summary.get("reviews", [])
    dossier["published"] = bool(status and status[0])
    dossier["publish_kind"] = (status[1] if status and status[1] else "author") \
        if (status and status[0]) else None
    # is_llm, not a verdict prefix. Machine verdicts are now ordinary editorial
    # recommendations ("major revision"), so a prefix test would classify every
    # referee report as a human peer review and attach the wrong badge.
    dossier["peer_reviews"] = sum(1 for r in reviews if not r.get("is_llm"))
    dossier["llm_reviewed"] = any(r.get("is_llm") for r in reviews)
    # Only advertise the file when it is actually readable — the endpoint
    # serves a published paper to anyone, and an unpublished one to nobody but
    # its author. Advertising an unpublished file would produce a link that
    # 404s for every reader who follows it.
    dossier["has_file"] = bool(dossier["published"] and paper_store.has_paper(eval_hash))

    # A request is a weaker claim than a review and is carried separately, so
    # the marker can never be mistaken for the badge.
    dossier["review_requested"] = has_open_review_request(eval_hash)
    # The reward actually escrowed on the open request, not the standard fee —
    # a requester who offered more to attract a reviewer should have that
    # number shown, and it is the figure the badge advertises.
    dossier["review_bounty"] = (open_review_bounty(eval_hash)
                                or peer_review_fee()["fee"])

    # Opening the full dossier is what counts as a read. Not a leaderboard row
    # scrolling past, not a card in a list — someone opened the record and
    # looked at it. Deduplicated per reader per day inside record_paper_read.
    reader = ""
    try:
        identity = auth.identity_from_request(request, wallet, orcid) if request else {}
        if identity.get("verified"):
            reader = _profile_key(identity.get("wallet", ""), identity.get("orcid", ""))
        elif request is not None:
            reader = "ip:" + hashlib.sha256(
                get_client_ip(request).encode("utf-8")).hexdigest()[:24]
    except Exception:
        reader = ""
    dossier["reads"] = record_paper_read(eval_hash, reader) if reader else get_paper_reads(eval_hash)
    return dossier


# ---------------------------------------------------------------------------
# 8b. INTEROPERABILITY — EOSC / FAIR-aligned dossier export
#
# For the platform to federate into the European Open Science Cloud and be
# consumable by institutional repositories and reference managers, its
# assessments must be retrievable as structured, self-describing metadata
# rather than only as rendered HTML. These endpoints expose exactly that:
# stable identifiers, explicit provenance, an open licence, and a schema
# version — the machine-actionability half of FAIR.
# ---------------------------------------------------------------------------
DOSSIER_SCHEMA_VERSION = "scholarpi-dossier/1.0"
DOSSIER_LICENSE = "https://creativecommons.org/licenses/by/4.0/"

CRITERION_DEFINITIONS = {
    "C1": ("Semantic Originality", "Novelty relative to the existing corpus, penalized by generative-AI laundering heuristics."),
    "C2": ("Methodological Rigor", "Deterministic MDAR reporting adherence and RRID validity."),
    "C3": ("Interdisciplinary Synergy", "Hierarchical topic diversity across the OpenAlex domain/field/subfield ontology."),
    "C4": ("Societal Impact", "Broader societal and open-infrastructure contribution."),
    "C5": ("Open Science", "Open data, open code, licensing and containerized reproducibility."),
    "C6": ("Literature Integration", "Citation polarity and integration with foundational literature."),
    "C7": ("Empirical Density", "Empirical sample strength, statistical reporting and baseline variance."),
    "C8": ("Future Actionability", "Future research actionability and adherence to FAIR principles."),
}


def build_fair_dossier(d: dict) -> dict:
    """Assemble a self-describing, CoARA-aligned assessment record."""
    integrity = d.get("integrity") or {}
    ref_audit = d.get("reference_audit") or {}
    authorship = d.get("authorship_signal") or {}
    topology = d.get("topology_detail") or {}
    judge = d.get("judge_metadata") or {}

    doi = d.get("doi")
    if doi in ("None", "", None):
        doi = None

    return {
        "@context": {
            "schema": "https://schema.org/",
            "coara": "https://www.coara.org/agreement/the-commitments/",
            "eosc": "https://eosc.eu/interoperability-framework/",
        },
        "schema_version": DOSSIER_SCHEMA_VERSION,
        "license": DOSSIER_LICENSE,
        "generated_at": datetime.now().isoformat(),

        "identifiers": {
            "evaluation_hash": d.get("eval_hash"),
            "doi": doi,
            "transaction_hash": d.get("tx_hash") if (d.get("tx_hash") or "").startswith("0x") else None,
            "zk_proof": d.get("zk_proof"),
            "explorer_url": d.get("explorer_url"),
        },
        "resource": {
            "type": "schema:ScholarlyArticle",
            "title": d.get("title"),
            "authors": [a.strip() for a in (d.get("author_name") or "").split(",") if a.strip()],
            "assessed_at": d.get("timestamp"),
        },
        "assessment": {
            "framework": "Pi-Index",
            "alignment": ["CoARA", "DORA", "RRA"],
            "composite_score_piX": d.get("score"),
            "logic_integrity": d.get("logic_integrity"),
            "piq_minted": d.get("piq"),
            "criteria": [
                {
                    "id": cid,
                    "name": CRITERION_DEFINITIONS[cid][0],
                    "definition": CRITERION_DEFINITIONS[cid][1],
                    "score": safe_float((d.get("scores_dict") or {}).get(cid), 0.0),
                    "scale": {"min": 0.0, "max": 100.0},
                }
                for cid in CRITERION_DEFINITIONS
            ],
        },
        # CoARA asks that quantitative indicators be published with their
        # provenance and limitations, not as bare numbers.
        "qualitative_basis": {
            "final_judge": judge.get("final_judge_label"),
            "independent_jurors": judge.get("external_juror_count"),
            "juror_models": [m.get("label") for m in (judge.get("participating_models") or [])],
            "judgement_quality": judge.get("tier"),
            "judgement_confidence": judge.get("confidence"),
            "inter_model_agreement": judge.get("inter_model_agreement"),
            "rationale": judge.get("rationale"),
        },
        "open_science_indicators": {
            "mdar_adherence": d.get("mdar_score"),
            "valid_rrid_count": d.get("rrid_count"),
            "reproducibility_signal": d.get("repro_score"),
        },
        "interdisciplinarity": {
            "score": topology.get("score"),
            "basis": topology.get("basis"),
            "spans_domains": topology.get("spans_domains"),
            "domains": topology.get("domains", []),
            "fields": topology.get("fields", []),
            "topic_count": topology.get("topic_count"),
        },
        "research_integrity": {
            "adversarial_scan_performed": integrity.get("scanned", False),
            "manipulation_detected": integrity.get("compromised", False),
            "severity": integrity.get("severity", "none"),
            "techniques": integrity.get("techniques", []),
            "model_panel_confirmed": (integrity.get("canary") or {}).get("detected", False),
            "reference_audit": {
                "verdict": ref_audit.get("verdict"),
                "checked": ref_audit.get("checked"),
                "verified": ref_audit.get("verified"),
                "unresolvable": ref_audit.get("fabricated"),
                "unverifiable": ref_audit.get("unverified"),
            },
            "authorship_signal": {
                "flag": authorship.get("flag"),
                "confidence": authorship.get("confidence"),
                "affects_score": False,
                "caveat": authorship.get("bias_statement"),
            },
        },
        "warnings": d.get("warnings", []),
        "limitations": [
            "Automated assessment is decision support for human peer review, not a replacement for it.",
            "Criteria scores derive from the submitted text; claims not stated in the manuscript cannot be credited.",
            "The authorship signal is advisory, never affects any score, and cannot establish misconduct.",
            "Reference verification distinguishes unresolvable from unverifiable identifiers; only the former is penalized.",
        ],
    }


@router.get("/api/dossier/{eval_hash}/fair")
def fair_dossier(eval_hash: str):
    """EOSC-aligned, machine-actionable assessment record."""
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p WHERE p.eval_hash = ?", (eval_hash,)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    return build_fair_dossier(build_dossier_from_row(row))


@router.get("/api/dossier/by-doi")
def dossier_by_doi(doi: str = Query(..., min_length=4, max_length=200)):
    """Look up an assessment by DOI.

    This is the integration point for reference managers (a Zotero plugin can
    resolve a library item straight to its assessment) and for institutional
    repositories surfacing dossiers alongside faculty publications.
    """
    clean = doi.replace("https://doi.org/", "").replace("doi.org/", "").strip()
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"""SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p
                WHERE LOWER(p.doi) = LOWER(?) ORDER BY p.timestamp DESC LIMIT 1""",
            (clean,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return {"found": False, "doi": clean,
                "message": "No ScholarPi assessment exists for this DOI yet."}
    dossier = build_dossier_from_row(row)
    return {
        "found": True,
        "doi": clean,
        "eval_hash": dossier["eval_hash"],
        "title": dossier["title"],
        "piX": dossier["score"],
        "piQ": dossier["piq"],
        "judgement_quality": (dossier.get("judge_metadata") or {}).get("tier"),
        "integrity_flag": (dossier.get("integrity") or {}).get("compromised", False),
        "dossier_url": f"/api/dossier/{dossier['eval_hash']}/fair",
    }


@router.get("/api/dossier/{eval_hash}/coara.html", response_class=HTMLResponse)
def coara_dossier_html(eval_hash: str):
    """Printable CoARA/DORA dossier for inclusion in evaluation portfolios."""
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p WHERE p.eval_hash = ?", (eval_hash,)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")

    d = build_dossier_from_row(row)
    fair = build_fair_dossier(d)
    judge = d.get("judge_metadata") or {}
    integrity = d.get("integrity") or {}

    def esc(v):
        return (str(v) if v is not None else "—").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    rows = "".join(
        f"<tr><td><strong>{c['id']}</strong></td><td>{esc(c['name'])}"
        f"<div class='def'>{esc(c['definition'])}</div></td>"
        f"<td class='num'>{c['score']:.1f}</td></tr>"
        for c in fair["assessment"]["criteria"]
    )
    warn_html = "".join(f"<li>{esc(w)}</li>" for w in d.get("warnings", [])) or "<li>None raised.</li>"
    jurors = ", ".join(fair["qualitative_basis"]["juror_models"] or []) or "—"

    integrity_banner = ""
    if integrity.get("compromised"):
        integrity_banner = (
            "<div class='alert'><strong>Research integrity alert.</strong> This manuscript was found to "
            "contain content designed to manipulate an automated reviewer. Logic integrity was set to "
            "0.0 and no piQ was minted.</div>"
        )

    return HTMLResponse(f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>CoARA Assessment Dossier — {esc(d.get('title'))}</title>
<style>
 body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:820px;
   margin:40px auto;padding:0 24px;color:#0f172a;line-height:1.6}}
 h1{{font-size:1.5rem;margin-bottom:4px}} h2{{font-size:1.05rem;margin-top:28px;
   border-bottom:1px solid #e2e8f0;padding-bottom:6px}}
 .sub{{color:#64748b;margin-bottom:20px}}
 table{{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}}
 th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}}
 th{{background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}}
 .num{{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}}
 .def{{color:#64748b;font-size:11.5px;margin-top:2px}}
 .kv{{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}}
 .kv span:first-child{{color:#64748b}}
 .alert{{background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;color:#7f1d1d;
   padding:12px 14px;border-radius:6px;margin:16px 0;font-size:13px}}
 .note{{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;
   font-size:12px;color:#475569;margin-top:12px}}
 code{{background:#f1f5f9;padding:2px 5px;border-radius:4px;font-size:11px;word-break:break-all}}
 ul{{padding-left:20px;font-size:13px}} li{{margin-bottom:6px}}
 @media print{{body{{margin:0}} h2{{page-break-after:avoid}}}}
</style></head><body>
<h1>{esc(d.get('title'))}</h1>
<div class="sub">{esc(d.get('author_name'))}</div>
{integrity_banner}

<h2>Assessment Summary</h2>
<div class="kv"><span>Composite pi-Index (piX)</span><strong>{safe_float(d.get('score'),0):.1f} / 100</strong></div>
<div class="kv"><span>Logic integrity</span><strong>{safe_float(d.get('logic_integrity'),0):.1f} / 100</strong></div>
<div class="kv"><span>pi-Quotient minted</span><strong>{safe_float(d.get('piq'),0):.2f} piQ</strong></div>
<div class="kv"><span>Assessed</span><strong>{esc(d.get('timestamp'))}</strong></div>

<h2>Qualitative Basis</h2>
<p style="font-size:13px">CoARA requires quantitative indicators be published with their provenance.
This assessment was adjudicated by <strong>{esc(judge.get('final_judge_label'))}</strong> over the
independent evaluations of {esc(jurors)}.</p>
<div class="kv"><span>Independent external jurors</span><strong>{esc(judge.get('external_juror_count'))}</strong></div>
<div class="kv"><span>Judgement quality</span><strong>{esc(judge.get('tier'))}</strong></div>
<div class="kv"><span>Inter-model agreement</span><strong>{esc(judge.get('inter_model_agreement'))}</strong></div>
<div class="note">{esc(judge.get('rationale'))}</div>

<h2>Criteria Assessment</h2>
<table><thead><tr><th>ID</th><th>Criterion</th><th class="num">Score</th></tr></thead><tbody>{rows}</tbody></table>

<h2>Open Science Indicators</h2>
<div class="kv"><span>MDAR adherence</span><strong>{safe_float(d.get('mdar_score'),0)*100:.1f}%</strong></div>
<div class="kv"><span>Valid RRIDs detected</span><strong>{esc(d.get('rrid_count'))}</strong></div>
<div class="kv"><span>Reproducibility signal</span><strong>{safe_float(d.get('repro_score'),0)*100:.1f}%</strong></div>

<h2>Processing Warnings</h2>
<ul>{warn_html}</ul>

<h2>Verification</h2>
<div class="kv"><span>Evaluation hash</span><code>{esc(d.get('eval_hash'))}</code></div>
<div class="kv"><span>zk-SNARK proof</span><code>{esc(d.get('zk_proof'))}</code></div>
<div class="kv"><span>Transaction</span><code>{esc(d.get('tx_hash'))}</code></div>

<h2>Limitations</h2>
<ul>{''.join(f'<li>{esc(l)}</li>' for l in fair['limitations'])}</ul>

<div class="note">Machine-readable equivalent: <code>/api/dossier/{esc(eval_hash)}/fair</code> ·
Schema <code>{DOSSIER_SCHEMA_VERSION}</code> · Licensed CC BY 4.0.<br>
Pi-Index is decision support aligned with CoARA and DORA. It does not replace peer review.</div>
</body></html>""")


@router.get("/api/explorer/tx-url")
def explorer_tx_url(tx: str):
    if not tx or not tx.startswith("0x") or len(tx) != 66:
        return {"url": None}
    try:
        return {"url": get_sepolia_explorer_url(tx, "tx")}
    except Exception:
        return {"url": None}
