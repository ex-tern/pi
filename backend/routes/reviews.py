"""routes/reviews.py: the journal and peer review: requests, LLM reviews, rebuttals, ratings, reports. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import _identity_values, _profile_key, require_identity  # noqa: F401
from routes.piq import piq_fields, require_affordable  # noqa: F401

router = APIRouter()



class ReviewRequest(BaseModel):
    wallet: str = ""
    orcid: str = ""
    # What the author is willing to set aside for whoever reviews the paper.
    # None means "use the minimum" — the field is optional so an older client,
    # or a request that simply does not care, keeps working unchanged.
    bounty: Optional[float] = None


class ReviewSubmission(BaseModel):
    # Either an open request to fulfil, or a paper to review unprompted.
    # `review_id = 0` with an `eval_hash` is the second case: a paper that has
    # already been reviewed, or already published, can still be reviewed again
    # by someone else.
    review_id: int = 0
    eval_hash: str = ""
    verdict: str = "sound"          # sound | concerns | unsound
    comment: str = ""
    wallet: str = ""
    orcid: str = ""


@router.get("/api/journal")
def journal(limit: int = Query(default=100, ge=1, le=300),
            kind: str = Query(default="all")):   # all | published | reviewed
    """The Journal: papers their authors published, or that carry a review.

    Two distinct claims live here and are never merged into one column. A paper
    can be published without review, reviewed without publication, or both, and
    collapsing them would let the weaker claim borrow the stronger one's
    credibility — which is the failure this whole framework argues against.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT p.eval_hash, p.title, p.author_name, p.final_score, p.piq_minted,
                      p.piq_escrowed, p.piq_claimed_at,
                      p.doi, p.published_at, p.publish_kind, p.fields, p.timestamp,
                      (SELECT COUNT(*) FROM peer_reviews r
                        WHERE r.eval_hash = p.eval_hash AND r.completed_at IS NOT NULL
                          AND r.reviewer_key <> 'llm:panel') AS peer_count,
                      (SELECT COUNT(*) FROM peer_reviews r
                        WHERE r.eval_hash = p.eval_hash AND r.completed_at IS NOT NULL
                          AND r.reviewer_key = 'llm:panel') AS llm_count,
                      COALESCE(p.reads, 0) AS reads,
                      (SELECT COUNT(*) FROM peer_reviews r
                        WHERE r.eval_hash = p.eval_hash AND r.completed_at IS NULL) AS requested,
                      -- What a reviewer would earn for picking up the open
                      -- request. Carried here so the badge can name the reward
                      -- instead of making the reviewer open the dossier to
                      -- find out whether it is worth their afternoon.
                      (SELECT COALESCE(MAX(r.bounty), 0) FROM peer_reviews r
                        WHERE r.eval_hash = p.eval_hash AND r.completed_at IS NULL) AS open_bounty
               FROM papers_assessment p
               ORDER BY COALESCE(p.published_at, p.timestamp) DESC"""
        ).fetchall()
    except sqlite3.Error as e:
        add_log(f"Journal read failed: {e}")
        raise HTTPException(status_code=503, detail="The journal index is unavailable.")
    finally:
        conn.close()

    # Column order after adding the two piQ columns:
    #  0 hash  1 title  2 author  3 score  4 minted  5 escrowed  6 claimed_at
    #  7 doi   8 published_at  9 publish_kind  10 fields  11 timestamp
    # 12 peer  13 llm  14 reads  15 requested  16 open_bounty
    out = []
    for r in rows:
        published, peer, llm = bool(r[8]), int(r[12] or 0), int(r[13] or 0)
        requested = int(r[15] or 0)
        # A paper awaiting a reviewer belongs here too. It is the one state the
        # index used to hide, and it is the state where being visible actually
        # does something — a reviewer cannot pick up a request they cannot see.
        if not (published or peer or llm or requested):
            continue          # the Journal lists claims, not the whole corpus
        if kind == "published" and not published:
            continue
        if kind == "reviewed" and not (peer or llm):
            continue
        if kind == "requested" and not requested:
            continue
        try:
            fields = json.loads(r[10] or "[]")
        except (ValueError, TypeError):
            fields = []
        out.append({
            "hash": r[0], "title": r[1] or "Untitled",
            "author": clean_author_name(r[2]), "score": round(safe_float(r[3], 0.0), 1),
            **piq_fields(r[4], r[5], r[6]),
            # real_doi(): the column holds the string "None" for a paper with
            # no DOI, and shipping that renders a DOI chip that reads "None".
            "doi": real_doi(r[7]),
            "published": published, "publish_kind": (r[9] or "author") if published else None,
            "published_at": r[8], "peer_reviews": peer, "llm_reviewed": bool(llm),
            "review_requested": requested > 0,
            # The reward on the open request, so the badge can advertise it.
            # A published, already-reviewed paper can still be carrying one.
            "review_bounty": round(safe_float(r[16], 0.0), 2) if requested else 0.0,
            "reads": int(r[14] or 0),
            "fields": fields, "assessed_at": r[11],
            # Lets the badge link straight to the manuscript. Without it every
            # row fell back to the DOI or the dossier, so a published paper
            # with a stored file still did not open that file.
            "has_file": paper_store.has_paper(r[0]),
        })
        if len(out) >= limit:
            break

    return {
        "entries": out, "count": len(out),
        "note": ("Peer-reviewed means an independent researcher submitted a reasoned verdict; "
                 "LLM-reviewed means a model panel did. Published means the reviewed paper's "
                 "verified author then attached their name — review comes first, and nothing "
                 "here can be published without one. Journal-published additionally required a "
                 "DOI that resolves in a registry. Requested means a review has been "
                 "commissioned and is waiting for a reviewer; it is not a review, and it can "
                 "sit alongside the other badges — an already-reviewed or published paper can "
                 "still have an open request, and the piQ shown on it is what the next "
                 "reviewer earns."),
    }


@router.get("/api/reviews/open")
def open_reviews(request: Request, wallet: str = Query(default=""),
                 orcid: str = Query(default="")):
    """Papers awaiting review. Your own requests are excluded."""
    identity = auth.identity_from_request(request, wallet, orcid)
    key = _profile_key(identity["wallet"], identity["orcid"]) if identity["verified"] else ""
    # The owner can open requests on other people's papers, so filtering their
    # list by "requests you opened" would hide exactly the work they are
    # entitled to review. Filter by AUTHORSHIP instead — the rule that matters.
    if key and auth.is_owner(identity):
        # Everything open, including the owner's own papers: they are permitted
        # to review those, so hiding them would leave the exception unusable.
        open_items = list_open_reviews()
    else:
        open_items = list_open_reviews(exclude_key=key)
    return {"signed_in": bool(key), "open": open_items, "bounty": peer_review_fee()}


@router.get("/api/assessments/{file_hash}/review")
def review_state(file_hash: str, request: Request = None,
                 wallet: str = Query(default=""), orcid: str = Query(default="")):
    """Public: which reviews exist, kept strictly separate by kind."""
    summary = review_summary(file_hash)
    # Split on is_llm (derived from reviewer_key), not on the verdict text. The
    # verdict-prefix test disagreed with the reviewer_key test used by the badge
    # queries, so a paper could carry an LLM-reviewed badge whose review this
    # endpoint then reported as human — leaving the modal empty.
    human = [r for r in summary["reviews"] if not r.get("is_llm")]
    machine = [r for r in summary["reviews"] if r.get("is_llm")]

    # Attach the reply, the vote tally, and whether this caller may act — so
    # the client can render the controls correctly without a second round trip
    # per review, and without guessing at permissions it cannot enforce anyway.
    viewer = auth.identity_from_request(request, wallet, orcid) if request else {}
    viewer_key = (_profile_key(viewer.get("wallet", ""), viewer.get("orcid", ""))
                  if viewer.get("verified") else "")
    viewer_ids = (_identity_values(viewer.get("wallet", ""), viewer.get("orcid", ""))
                  if viewer.get("verified") else [])

    conn = get_db_connection()
    try:
        prow = conn.execute(
            "SELECT user_id, author_openalex_id, published_by FROM papers_assessment "
            "WHERE eval_hash = ?", (file_hash,)).fetchone()
    except sqlite3.Error:
        prow = None
    finally:
        conn.close()
    paper_ids = [v for v in (prow or []) if v]
    is_author = bool(viewer_ids) and any(v in paper_ids for v in viewer_ids)

    # Who opened the outstanding request, if there is one. Read once here
    # rather than inside the response dict, so the query is obvious and the
    # comparison is a plain boolean.
    requested_by_me = False
    if viewer_key:
        conn = get_db_connection()
        try:
            r = conn.execute(
                "SELECT requested_by FROM peer_reviews "
                "WHERE eval_hash = ? AND completed_at IS NULL LIMIT 1", (file_hash,)).fetchone()
            requested_by_me = bool(r and r[0] == viewer_key)
        except sqlite3.Error:
            requested_by_me = False
        finally:
            conn.close()

    # Authorship, for the request gate. Computed here so the interface and the
    # endpoint agree about who may act rather than discovering it on refusal.
    may_request = False
    if viewer_ids:
        try:
            prow2 = conn2 = None
            conn2 = get_db_connection()
            prow2 = conn2.execute(
                "SELECT author_name, doi, title, piq_claimed_at FROM papers_assessment "
                "WHERE eval_hash = ?", (file_hash,)).fetchone()
            conn2.close()
            if prow2:
                attr = verify_authorship(
                    submitter_orcid=viewer.get("orcid", ""),
                    submitter_wallet=viewer.get("wallet", ""),
                    extracted_authors=prow2[0] or "", doi=prow2[1] or "",
                    title=prow2[2] or "")
                may_request = bool(attr.get("verified") or prow2[3])
        except Exception:
            may_request = False

    replies = rebuttals_for_paper(file_hash)
    for r in human + machine:
        rid = r.get("id")
        r["rebuttals"] = replies.get(rid, [])
        r["rating"] = review_rating_summary(rid, viewer_key) if rid else {
            "helpful": 0, "unhelpful": 0, "my_vote": None}
        # A rebuttal is the author's right of reply, so it is offered only to
        # the author, only on a human review, and only once.
        r["may_rebut"] = bool(is_author and not r.get("is_llm") and not r["rebuttals"])
        r["may_rate"] = bool(viewer_key)
    return {
        **summary,
        "peer_reviewed": len(human) > 0,
        "peer_review_count": len(human),
        "llm_reviewed": len(machine) > 0,
        "reviews": human, "llm_reviews": machine,
        # A request is a distinct, weaker state than a review, and it is
        # reported separately for exactly the reason the two badges are
        # separate: "somebody asked for this to be checked" must never be
        # readable as "this was checked".
        "review_requested": has_open_review_request(file_hash),
        # Whether THIS caller opened it, so the interface can offer a cancel
        # button only to the person entitled to use it.
        "review_requested_by_me": requested_by_me,
        # Whether this viewer may commission a review — same authorship test
        # as publishing, so the button is offered only to the author rather
        # than shown to everyone and refused on click.
        "may_request": may_request,
        "may_publish_gate": len(human) > 0,
        "fee": peer_review_fee(), "llm_fee": llm_review_fee(),
        "bonus": peer_review_bonus(),
        "reads": get_paper_reads(file_hash),
    }


@router.post("/api/assessments/{file_hash}/review/request")
def request_review(file_hash: str, payload: ReviewRequest, request: Request):
    """Commission a review. Requires BOTH a signed wallet and a linked ORCID.

    Both, because this spends piQ and puts a claim in front of other
    researchers: a wallet proves control of the paying account, an ORCID ties
    the request to a real research identity that can be held to it.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")
    if not (identity["wallet"] and identity["orcid"]):
        raise HTTPException(
            status_code=403,
            detail=("Requesting review needs both a signed wallet and a linked ORCID. One proves "
                    "the paying account, the other ties the request to a research identity."))

    # Only the paper's author may commission a review of it, on the same
    # authorship test that gates publishing.
    #
    # Review is now the step that unlocks publication, so whoever can request
    # one effectively decides whether a paper becomes publishable. Leaving that
    # open to anyone would let a third party start the process on someone
    # else's manuscript — and, because a request puts the paper in front of
    # reviewers under a "Requested to be reviewed" marker, do so visibly and
    # without the author's involvement.
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT author_name, doi, title, piq_claimed_at FROM papers_assessment "
            "WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")

    attribution = verify_authorship(
        submitter_orcid=identity["orcid"], submitter_wallet=identity["wallet"],
        extracted_authors=row[0] or "", doi=row[1] or "", title=row[2] or "")
    # The escrow claim counts as standing evidence of authorship here, exactly
    # as it does for an author-published badge.
    # Author-only, with no exception — not even for the operator.
    #
    # The owner exemption that briefly lived here existed to give the operator
    # something they were allowed to review, back when reviewing your own paper
    # was impossible. That is no longer the reason it was solving: the owner can
    # now review their own work directly, so letting them commission reviews of
    # other people's papers buys nothing and hands one account the power to put
    # anyone's manuscript in front of reviewers.
    if not (attribution.get("verified") or bool(row[3])):
        raise HTTPException(
            status_code=403,
            detail=("Only the author of a paper can request a review of it. "
                    + (attribution.get("reason") or "Authorship is not verified for this paper.")
                    + (" " + attribution["how_to_verify"]
                       if attribution.get("how_to_verify") else "")))

    key = _profile_key(identity["wallet"], identity["orcid"])

    # The author chooses the bounty, above a floor.
    #
    # A flat price assumed every paper is equally easy to get read, which is
    # not true of anything: a niche or long manuscript competes for the same
    # reviewers as a short topical one, and the author is the only person who
    # knows which theirs is. Letting them offer more is the mechanism that
    # gets unattractive papers reviewed at all.
    #
    # Rejected rather than silently raised when below the floor. Quietly
    # charging more than someone asked for is worse than refusing them.
    fee = float(payload.bounty) if payload.bounty is not None else MIN_REVIEW_BOUNTY
    if fee < MIN_REVIEW_BOUNTY:
        raise HTTPException(
            status_code=400,
            detail=(f"The minimum review bounty is {MIN_REVIEW_BOUNTY:.2f} piQ. A review is a "
                    f"researcher's afternoon, and less than this stops recognising that."))
    if fee > MAX_REVIEW_BOUNTY:
        raise HTTPException(
            status_code=400,
            detail=f"The most that can be offered for one review is {MAX_REVIEW_BOUNTY:.0f} piQ.")
    fee = round(fee, 2)

    bal = get_piq_balance(identity["wallet"], identity["orcid"])
    require_affordable(bal, fee, "A peer review")

    result = open_review_request(file_hash, key, fee)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    if not charge_piq_fee(fee, identity["wallet"], identity["orcid"],
                          eval_hash=file_hash, reason="Peer review bounty (held)"):
        raise HTTPException(status_code=402, detail="The bounty could not be held.")

    add_log(f"Review requested for {file_hash[:12]}… bounty {fee:.2f} piQ"
            + (" (above the minimum)" if fee > MIN_REVIEW_BOUNTY else ""))
    return {"requested": True, "bounty": fee, "awaiting_review": True,
            "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
            "message": (f"Review requested. {fee:.2f} piQ is set aside and will be credited to "
                        f"the researcher who completes it, on top of their "
                        f"{PEER_REVIEW_BONUS:.2f} piQ completion bonus. The paper now carries a "
                        f"Requested-to-be-reviewed "
                        f"marker; the Peer-reviewed badge appears only once a review has actually "
                        f"been submitted.")}


@router.post("/api/assessments/{file_hash}/review/cancel")
def cancel_review(file_hash: str, payload: ReviewRequest, request: Request):
    """Withdraw a review request you opened, and get the held piQ back.

    A request that cannot be withdrawn is a trap: circumstances change, a
    paper gets revised, and piQ set aside against a review nobody ever picks
    up would otherwise be held indefinitely with no way to release it.

    Refunded only after the row is actually gone, so a failed cancellation can
    never return piQ while leaving the request standing.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")
    key = _profile_key(identity["wallet"], identity["orcid"])

    result = cancel_review_request(file_hash, key)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])

    refund = result["refund"]
    refunded = False
    if refund > 0:
        try:
            refunded = refund_piq_fee(refund, identity["wallet"], identity["orcid"],
                                      eval_hash=file_hash,
                                      reason="Peer review request cancelled")
        except Exception as e:
            logging.warning("Refund failed after cancelling review on %s: %s",
                            file_hash[:12], e)

    add_log(f"Review request cancelled on {file_hash[:12]}… refund {refund:.2f} piQ")
    return {
        "cancelled": True, "refund": refund if refunded else 0.0,
        "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
        "message": (
            f"Review request withdrawn. {refund:.2f} piQ returned to your balance."
            if refunded and refund > 0 else
            "Review request withdrawn."
            + (f" The {refund:.2f} piQ could not be returned automatically — please report this."
               if refund > 0 else "")),
    }


@router.post("/api/assessments/{file_hash}/review/llm")
def request_llm_review(file_hash: str, payload: ReviewRequest, request: Request,
                       background: BackgroundTasks = None):
    """Commission a machine review using an actual LLM panel call. Cheaper, and labelled as what it is.

    Recorded in the same table as human reviews but with a reviewer key of
    "llm:panel", so the badge logic can tell them apart and never present one
    as the other.

    A review may be requested again on a paper that already has one. The models
    change, the evidence behind the report changes, and a second reading is a
    legitimate thing to want; each review is kept and shown with its date
    rather than overwriting the last one. The fee is charged per review, which
    is what stops "again" from being free.

    **The review runs in the background.** Everything that can be refused is
    checked and refused here — balance, stored manuscript, identity — and only
    then is the fee taken and a job queued. The model call itself, which is the
    slow part, happens after the response has gone out, so closing the window
    does not abandon a review the user has already paid for. The piQ is spent
    either way; the only question is whether the thing it bought gets written,
    and it now does. The page picks the result up from /api/reviews/jobs.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")
    key = _profile_key(identity["wallet"], identity["orcid"])

    fee = llm_review_fee()["fee"]
    bal = get_piq_balance(identity["wallet"], identity["orcid"])
    require_affordable(bal, fee, "An LLM review")

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT title, evidence_report, author_name FROM papers_assessment "
            "WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")

    # The reviewer reads the MANUSCRIPT, not our evidence report.
    #
    # This endpoint used to hand the model ScholarPi's own synthesised evidence
    # report and ask it to return one of our three rubric verdicts. That was a
    # review of our summary, phrased in our vocabulary — it could only ever
    # agree or disagree with an assessment that had already been made, and it
    # inherited every framing decision the rubric had taken. A machine review
    # worth 0.5 piQ should be an independent reading of the paper.
    manuscript = ""
    stored = paper_store.paper_path(file_hash)
    if stored:
        try:
            with open(stored, "rb") as fh:
                manuscript = full_text_from_pdf(fh.read())
        except OSError as e:
            logging.warning("Could not read stored manuscript %s: %s", file_hash[:12], e)

    if not manuscript.strip():
        # Refuse rather than silently fall back to reviewing our own report.
        # Charging for "a genuine review of the paper" and delivering a review
        # of a summary is the thing being fixed here.
        raise HTTPException(
            status_code=409,
            detail=("An LLM review reads the manuscript itself, and no manuscript file is "
                    "stored for this assessment. Papers assessed before file retention, and "
                    "papers submitted by DOI rather than upload, cannot be reviewed this way — "
                    "re-run the assessment with the PDF uploaded. No piQ has been charged."))

    if not charge_piq_fee(fee, identity["wallet"], identity["orcid"],
                          eval_hash=file_hash, reason="LLM review fee"):
        raise HTTPException(status_code=402, detail="The fee could not be charged.")

    # The job row is the receipt. Written immediately after the charge and
    # before any model call, so a crash mid-review leaves evidence that this
    # identity paid for a review that never arrived — which is what
    # reclaim_stale_review_jobs refunds against on the next start-up.
    job_id = create_review_job(file_hash, key, identity["wallet"], identity["orcid"],
                               fee, kind="llm")

    def _run():
        try:
            result = _perform_llm_review(file_hash, row[0] or "Untitled", manuscript)
        except Exception as e:                       # noqa: BLE001 - must never escape a worker
            logging.exception("LLM review job %s failed for %s", job_id, file_hash[:12])
            try:
                refund_piq_fee(fee, identity["wallet"], identity["orcid"],
                               eval_hash=file_hash, reason="LLM review refund (job failed)")
            except Exception:
                logging.warning("LLM review refund failed for %s", file_hash[:12])
            finish_review_job(job_id, "failed", "",
                              f"The review could not be completed and the {fee:.2f} piQ fee was "
                              f"returned. ({str(e)[:120]})")
            return

        saved = record_llm_review(file_hash, result["verdict"], result["comment"])
        if not saved["ok"]:
            # The fee bought a review that could not be stored. Give it back
            # rather than keep piQ for nothing.
            try:
                refund_piq_fee(fee, identity["wallet"], identity["orcid"],
                               eval_hash=file_hash, reason="LLM review refund (not saved)")
            except Exception:
                logging.warning("LLM review refund failed for %s", file_hash[:12])
            finish_review_job(job_id, "failed", result["verdict"], saved["reason"])
            return

        add_log(f"LLM referee report recorded for {file_hash[:12]}… ({result['verdict']})")
        finish_review_job(
            job_id, "complete", result["verdict"],
            (f"Referee report complete — recommendation: {result['verdict']}. The badge is "
             f"attached; open it to read the full report."
             if result["reached_model"] else
             "No model was reachable, so the review records that. The badge is attached and you "
             "can request a new review to try again."))

    if background is not None:
        # BackgroundTasks runs after the response is sent, in the server
        # process — the client disconnecting has no bearing on it.
        background.add_task(_run)
    else:
        threading.Thread(target=_run, daemon=True).start()

    return {
        "requested": True, "queued": True, "job_id": job_id, "charged": fee,
        "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
        "message": (f"Review queued. {fee:.2f} piQ charged. The panel is reading the manuscript "
                    f"now — this takes up to a minute, and it finishes whether or not you stay "
                    f"on this page. The badge appears here as soon as it lands."),
    }


def _perform_llm_review(file_hash: str, title: str, manuscript: str) -> dict:
    """Read a manuscript with the judge chain and return a referee report.

    Split out of the endpoint so it can run after the response has been sent.
    It takes no request and no identity: everything it needs was validated and
    paid for before it was scheduled, and it returns a result rather than
    writing one, so the caller owns refunding and recording.
    """
    from providers import (build_routes, is_route_cooling, record_success, record_rate_limit,
                           parse_retry_after, classify_provider_error, is_scilm_route)
    from brain import request_model_assessment

    # An ordinary scholarly peer review, in the reviewer's own terms.
    #
    # Deliberately free of ScholarPi's vocabulary: no piX, no piQ, no C1-C8, no
    # three-way rubric verdict. The model is asked to review the paper the way a
    # journal referee would, and to reach its own recommendation from standard
    # peer-review language. If it disagrees with our assessment that is a useful
    # signal, and it cannot produce one while writing inside our categories.
    truncated = len(manuscript) >= 59000
    prompt = (
        "You are an expert peer reviewer for an academic journal. Read the manuscript below "
        "and write a substantive referee report, exactly as you would for a journal editor.\n\n"
        "Judge the work on its own terms and in the conventions of its own field. Do not use "
        "any external scoring framework, rubric or numeric index — assess the research.\n\n"
        "Cover, in your own structure and words:\n"
        "  - what the paper claims and whether the evidence supports it\n"
        "  - the methodology, and any threat to the validity of the conclusions\n"
        "  - statistical or analytical soundness, where applicable\n"
        "  - novelty and contribution relative to existing literature\n"
        "  - reproducibility: data, code, materials, and enough detail to repeat the work\n"
        "  - clarity of presentation\n"
        "  - specific, actionable revisions, referring to concrete parts of the text\n\n"
        "Be direct about weaknesses. A referee report that praises everything is useless to an "
        "editor and to the authors. If the manuscript is strong, say why specifically.\n\n"
        "Return JSON with exactly these keys:\n"
        '  "recommendation": one of "accept", "minor revision", "major revision", "reject"\n'
        '  "summary": one or two sentences stating what the paper does\n'
        '  "report": your full referee report as markdown, 400-800 words, using headings\n'
        '  "strengths": array of short strings\n'
        '  "concerns": array of short strings, most serious first\n\n'
        + ("NOTE: the manuscript was truncated for length; review what is present and say so "
           "if the ending is missing.\n\n" if truncated else "")
        + f"TITLE: {title or 'Untitled'}\n\nMANUSCRIPT:\n{manuscript}"
    )

    # SciLM (siM) is excluded here for the same reason it is excluded from
    # adjudication: it is ScholarPi's own engine, and a "referee report" written
    # by the platform about a paper the platform scored is not an independent
    # reading. build_routes already filters the judge chain; the second filter
    # is cheap and makes the guarantee local to the thing that depends on it.
    judge_routes = [r for r in build_routes("judge") if not is_scilm_route(r)]
    # The fallbacks are what make the badge unconditional. If no model answers,
    # the review still exists and says so plainly — an honest "the panel could
    # not be reached" is a result, and hiding it after taking the fee is not.
    verdict = "inconclusive"
    comment = ("Machine review attempted, but no model in the panel was reachable at the time of "
               "the request. No referee report could be generated. Request a new review to try "
               "again.")
    reached_model = False
    review_model = ""

    if judge_routes:
        for route in judge_routes:
            cooling, remaining = is_route_cooling(route["model"], route["provider"])
            if cooling:
                continue

            _, attempt = request_model_assessment(
                "pidyne", route["model"], route["key"], route["base"], prompt
            )

            if not attempt.get("api_failed", True):
                record_success(route["model"], route["provider"])

                # Standard editorial recommendations, not our rubric. Anything
                # unrecognised is kept verbatim rather than coerced into one of
                # our categories — forcing a reviewer's conclusion into a
                # vocabulary it did not use is how the previous version stopped
                # being a genuine review.
                rec = str(attempt.get("recommendation") or "").strip().lower()
                allowed = ("accept", "minor revision", "major revision", "reject")
                verdict = rec if rec in allowed else (rec[:40] or "reviewed")

                report = str(attempt.get("report") or attempt.get("opinion") or "").strip()
                strengths = [str(x).strip() for x in (attempt.get("strengths") or []) if str(x).strip()]
                concerns = [str(x).strip() for x in (attempt.get("concerns") or []) if str(x).strip()]
                summary_line = str(attempt.get("summary") or "").strip()

                parts = []
                if summary_line:
                    parts.append(f"**Summary.** {summary_line}")
                parts.append(f"**Recommendation: {verdict}**")
                if report:
                    parts.append(report)
                if strengths:
                    parts.append("### Strengths\n" + "\n".join(f"- {x}" for x in strengths))
                if concerns:
                    parts.append("### Concerns\n" + "\n".join(f"- {x}" for x in concerns))
                parts.append(
                    f"---\n*Referee report written by {route['model']} via {route['provider']} "
                    f"from the full manuscript. This is a machine review — no human read the "
                    f"paper — and it is independent of ScholarPi's own assessment.*")

                comment = "\n\n".join(parts) if report or strengths or concerns else (
                    f"The model returned a recommendation ({verdict}) without a written report.")
                review_model = f"{route['model']} via {route['provider']}"
                reached_model = True
                break

            raw_err = attempt.get("_raw_error", "")
            classified = classify_provider_error(raw_err)
            if classified["category"] == "rate_limit":
                record_rate_limit(route["model"], route["provider"], parse_retry_after(raw_err))

    return {"verdict": verdict, "comment": comment,
            "reached_model": reached_model, "model": review_model}


@router.get("/api/reviews/jobs")
def review_jobs(request: Request, wallet: str = Query(default=""),
                orcid: str = Query(default="")):
    """Review work this identity has commissioned, and what became of it.

    The mechanism by which a review survives the window that asked for it: the
    browser polls this instead of holding a request open, so a review requested
    and then walked away from is still there — finished — on the next visit.
    """
    identity = auth.identity_from_request(request, wallet, orcid)
    if not identity["verified"]:
        return {"signed_in": False, "jobs": [], "pending": 0}
    key = _profile_key(identity["wallet"], identity["orcid"])
    jobs = list_review_jobs(key)
    return {"signed_in": True, "jobs": jobs,
            "pending": sum(1 for j in jobs if j["status"] in ("queued", "running"))}


# What a review has to contain to count. Published rather than merely
# enforced, so the writing window can show a reviewer the bar before they
# spend an hour on a report and have it refused at submission.
REVIEW_MIN_CHARS = 400
REVIEW_REQUIREMENTS = [
    {"id": "eligibility",
     "text": ("You must have at least one paper published in the journal list. Reviewing is open "
              "to people who have put their own work through the same process.")},
    {"id": "identity",
     "text": ("Both a signed wallet and a linked ORCID. The wallet proves control of the account "
              "being paid; the ORCID ties the report to a research identity.")},
    {"id": "independence",
     "text": ("You cannot review your own paper, or one you requested a review of. Requester and "
              "reviewer being the same person would make the badge self-issued.")},
    {"id": "verdict",
     "text": "A verdict: sound, concerns, or unsound."},
    {"id": "length",
     "text": (f"At least {REVIEW_MIN_CHARS} characters of reasoning, referring to specific parts "
              f"of the manuscript. A verdict with no argument behind it is not a review.")},
    {"id": "substance",
     "text": ("Cover the claims against the evidence, the methodology, and reproducibility. Be "
              "direct about weaknesses — a report that praises everything is useless to a reader.")},
]


class RebuttalRequest(BaseModel):
    review_id: int
    body: str = ""
    wallet: str = ""
    orcid: str = ""


class RatingRequest(BaseModel):
    review_id: int
    value: int = 1              # +1 helpful, -1 not helpful
    wallet: str = ""
    orcid: str = ""


class ReportRequest(BaseModel):
    review_id: int
    reason: str = ""
    detail: str = ""
    wallet: str = ""
    orcid: str = ""


@router.post("/api/reviews/rebut")
def rebut_review(payload: RebuttalRequest, request: Request):
    """Reply to a review of your own paper.

    The review is never edited or removed. A rebuttal is published beside it,
    so a reader sees the criticism and the author's answer together — an author
    who could suppress a review they disliked would make the Peer-reviewed
    badge meaningless, and one who cannot answer at all is being judged without
    a right of reply.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")

    info = review_owner_key(payload.review_id)
    if not info or not info.get("completed"):
        raise HTTPException(status_code=404, detail="No completed review with that id.")

    key = _profile_key(identity["wallet"], identity["orcid"])
    identities = _identity_values(identity["wallet"], identity["orcid"])
    # Only the paper's author may reply. Anyone else arguing with a review in
    # the author's slot would be a comment section, which is a different
    # feature with different moderation needs.
    if not any(v in info["paper_identities"] for v in identities):
        raise HTTPException(
            status_code=403,
            detail=("Only the author of the paper can reply to a review of it. If the paper is "
                    "yours, claim authorship first — the same check that gates publishing."))

    result = add_review_rebuttal(payload.review_id, info["eval_hash"], key, payload.body)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    add_log(f"Rebuttal filed on review {payload.review_id} for {info['eval_hash'][:12]}…")
    return {"submitted": True,
            "message": ("Your reply is published beneath the review. The review itself is "
                        "unchanged — readers see both.")}


@router.post("/api/reviews/rate")
def rate_review_endpoint(payload: RatingRequest, request: Request):
    """Mark a review helpful or unhelpful. One vote per identity, changeable."""
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")

    info = review_owner_key(payload.review_id)
    if not info or not info.get("completed"):
        raise HTTPException(status_code=404, detail="No completed review with that id.")

    key = _profile_key(identity["wallet"], identity["orcid"])
    # A reviewer voting on their own review is the one vote that means nothing.
    if key and key == info.get("reviewer_key"):
        raise HTTPException(status_code=403, detail="You cannot rate your own review.")

    result = rate_review(payload.review_id, key, payload.value)
    if not result["ok"]:
        raise HTTPException(status_code=503, detail=result["reason"])
    return {"rated": True, "helpful": result["helpful"], "unhelpful": result["unhelpful"],
            "my_vote": result["my_vote"]}


@router.post("/api/reviews/report")
def report_review_endpoint(payload: ReportRequest, request: Request):
    """Flag a review for a moderator.

    Deliberately separate from an unhelpful vote. "I disagree with this review"
    and "this review is abusive or fabricated" are different claims, and
    counting them together would bury the second under the volume of the first.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")

    info = review_owner_key(payload.review_id)
    if not info or not info.get("completed"):
        raise HTTPException(status_code=404, detail="No completed review with that id.")

    key = _profile_key(identity["wallet"], identity["orcid"])
    result = report_review(payload.review_id, info["eval_hash"], key,
                           payload.reason, payload.detail)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    add_log(f"Review {payload.review_id} reported ({payload.reason}).")
    return {"reported": True,
            "message": ("Thank you. A moderator will look at this review. The review stays "
                        "visible in the meantime — reports are not a way to hide criticism.")}


@router.get("/api/reviews/report-reasons")
def review_report_reasons():
    """The grounds on which a review can be reported, published so the form
    and any client agree on what is being claimed."""
    return {"reasons": [{"id": k, "label": v} for k, v in REPORT_REASONS.items()],
            "rebuttal_min_chars": REBUTTAL_MIN_CHARS}
