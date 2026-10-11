"""routes/reviewing.py: reviewing: eligibility, submitting a review, removing an assessment. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import _identity_values, _profile_key, require_identity  # noqa: F401
from routes.reviews import REVIEW_MIN_CHARS, REVIEW_REQUIREMENTS, ReviewSubmission  # noqa: F401

router = APIRouter()



@router.get("/api/reviews/eligibility")
def review_eligibility(request: Request, wallet: str = Query(default=""),
                       orcid: str = Query(default="")):
    """Whether this identity may write reviews, and what is required of one.

    Answered before the writing window opens rather than at submission. Telling
    someone their report is refused after they have written it is the worst
    possible moment to mention a rule they could have been told up front.
    """
    identity = auth.identity_from_request(request, wallet, orcid)
    if not identity["verified"]:
        return {"signed_in": False, "eligible": False, "published_count": 0,
                "requirements": REVIEW_REQUIREMENTS, "min_chars": REVIEW_MIN_CHARS,
                "bonus": PEER_REVIEW_BONUS,
                "reason": "Sign in with a wallet or ORCID to review."}

    identities = _identity_values(identity["wallet"], identity["orcid"])
    published = count_journal_publications(identities)
    both_factors = bool(identity["wallet"] and identity["orcid"])

    # The owner is exempt from the publication requirement, and has to be.
    #
    # Publishing requires a completed review; reviewing requires having
    # published. On a fresh deployment that is a closed loop with no entry
    # point — the first paper can never be reviewed, so it can never be
    # published, so nobody ever becomes eligible to review. Somebody has to be
    # able to write the first review, and the operator is the only identity the
    # platform can already authenticate as trusted.
    #
    # It is an exemption from the ELIGIBILITY gate only. Everything that
    # protects the integrity of a review still applies to the owner: they
    # cannot review their own paper, cannot review one they requested, and the
    # report still has to meet the length and verdict requirements.
    is_owner = bool(auth.is_owner(identity))
    eligible = (published >= 1 or is_owner) and both_factors

    if is_owner and published < 1:
        reason = ""
    elif published < 1:
        reason = ("To become a reviewer you must have at least one paper published in the journal "
                  "list. Publish an assessment of your own work first — it needs a review of its "
                  "own to be publishable, so the requirement is a loop you enter by being "
                  "reviewed, not by reviewing.")
    elif not both_factors:
        missing = "a signed wallet" if not identity["wallet"] else "a linked ORCID"
        reason = f"Reviewing needs both a signed wallet and a linked ORCID; you are missing {missing}."
    else:
        reason = ""

    return {"signed_in": True, "eligible": eligible, "published_count": published,
            "requirements": REVIEW_REQUIREMENTS, "min_chars": REVIEW_MIN_CHARS,
            "bonus": PEER_REVIEW_BONUS, "reason": reason,
            # Surfaced so the writing window can say WHY it is open — an
            # exemption the user cannot see is indistinguishable from the rule
            # not existing.
            "owner_exemption": bool(is_owner and published < 1)}


@router.post("/api/reviews/submit")
def submit_review(payload: ReviewSubmission, request: Request):
    """Complete a review and collect the bounty plus the completion bonus."""
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")
    if not (identity["wallet"] and identity["orcid"]):
        raise HTTPException(
            status_code=403,
            detail="Reviewing needs both a signed wallet and a linked ORCID.")

    # Re-checked at submission, not only when the window opened. A page can be
    # left open across a change in standing, and the eligibility endpoint is a
    # courtesy to the reviewer — this is the control.
    identities = _identity_values(identity["wallet"], identity["orcid"])
    # Same owner exemption as the eligibility endpoint, and enforced here for
    # the same reason that endpoint exists: the gate is the control, and the
    # interface is only a courtesy. See review_eligibility for why the
    # exemption is necessary rather than convenient.
    if count_journal_publications(identities) < 1 and not auth.is_owner(identity):
        raise HTTPException(
            status_code=403,
            detail=("To review, you must have at least one paper published in the journal list. "
                    "Publish your own work first."))

    if payload.verdict not in ("sound", "concerns", "unsound"):
        raise HTTPException(status_code=400, detail="Verdict must be sound, concerns or unsound.")
    if len((payload.comment or "").strip()) < REVIEW_MIN_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(f"A review needs at least {REVIEW_MIN_CHARS} characters of reasoning; yours "
                    f"has {len((payload.comment or '').strip())}. A verdict with no argument "
                    f"behind it is not a review, and the badge would be worthless if it were."))

    key = _profile_key(identity["wallet"], identity["orcid"])

    # Is the reviewer an author of the paper they are reviewing? This is the
    # rule that actually matters; "did you request it" was only ever a stand-in
    # for it. Answering it directly lets a legitimate reviewer through and
    # still refuses the case the stand-in existed to catch.
    # An unsolicited review names the paper directly; a commissioned one names
    # the request. Both end up needing the same authorship check.
    unsolicited = not payload.review_id
    info = ({"eval_hash": (payload.eval_hash or "").strip()} if unsolicited
            else review_owner_key(payload.review_id))
    if unsolicited and not info["eval_hash"]:
        raise HTTPException(status_code=400,
                            detail="Name the paper you are reviewing.")
    reviewer_is_author = None
    if info and info.get("eval_hash"):
        conn = get_db_connection()
        try:
            prow = conn.execute(
                "SELECT author_name, doi, title, user_id, author_openalex_id, piq_claimed_at "
                "FROM papers_assessment WHERE eval_hash = ?", (info["eval_hash"],)).fetchone()
        except sqlite3.Error:
            prow = None
        finally:
            conn.close()
        if prow:
            attr = verify_authorship(
                submitter_orcid=identity["orcid"], submitter_wallet=identity["wallet"],
                extracted_authors=prow[0] or "", doi=prow[1] or "", title=prow[2] or "")
            # Any of: the byline resolves to them, the row is filed under their
            # identity, or they claimed the escrow on it.
            owns_row = any(v and v in identities for v in (prow[3], prow[4]))
            reviewer_is_author = bool(attr.get("verified") or owns_row
                                      or (prow[5] and owns_row))

    # The operator may review their own paper. Everyone else may not.
    #
    # This exists so a single-participant deployment can produce its first
    # reviews at all. It is a real weakening of what the Peer-reviewed badge
    # certifies, so it is not left implicit: the review is stored with a
    # disclosure line naming it as an operator self-review, and the badge opens
    # onto that text. A reader who checks can always see what they are looking
    # at, which is the property that keeps the badge worth having.
    is_owner_self = bool(reviewer_is_author and auth.is_owner(identity))
    if reviewer_is_author and not is_owner_self:
        raise HTTPException(
            status_code=403,
            detail=("You cannot review your own paper. A Peer-reviewed badge you issued to "
                    "your own work would certify nothing — it needs a reviewer other than you."))

    comment = payload.comment
    if is_owner_self:
        comment = (comment.rstrip()
                   + "\n\n---\n*Operator self-review: this review was written by the person who "
                     "runs this deployment, about their own paper. It is disclosed here because a "
                     "Peer-reviewed badge normally means an independent researcher read the work, "
                     "and in this case it does not.*")
        add_log(f"OWNER SELF-REVIEW recorded on review {payload.review_id} "
                f"(disclosed in the review text).")

    if unsolicited:
        # Nobody commissioned this, so nothing is charged to the author and no
        # bounty is released — only the completion bonus is credited.
        result = add_unsolicited_review(info["eval_hash"], key, payload.verdict, comment)
    else:
        result = complete_review(payload.review_id, key, payload.verdict, comment,
                                 reviewer_is_author=reviewer_is_author,
                                 allow_self_review=is_owner_self)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    add_log(f"Review completed on {result['eval_hash'][:12]}… paid {result['paid']:.2f} piQ")
    bounty, bonus = result.get("bounty", 0.0), result.get("bonus", PEER_REVIEW_BONUS)
    return {"submitted": True, "paid": result["paid"],
            "bounty": bounty, "bonus": bonus,
            "eval_hash": result["eval_hash"],
            "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
            "message": (f"Review recorded. {result['paid']:.2f} piQ credited to your balance"
                        + (f" ({bounty:.2f} set aside by the requester + {bonus:.2f} completion "
                           f"bonus)" if bounty else f" ({bonus:.2f} completion bonus)")
                        + (". The paper now carries a Peer-reviewed badge and can be published."
                           if not unsolicited else
                           ". Your review is added alongside the ones already there — the paper's "
                           "review count goes up, and its author was not charged for it."))}


@router.delete("/api/assessments/{file_hash}")
def remove_assessment(file_hash: str, request: Request,
                      wallet: str = Query(default=""),
                      orcid: str = Query(default="")):
    """Withdraw one paper from the corpus.

    Ownership is enforced inside the DELETE statement, not by a prior SELECT:
    evaluation hashes are visible in the public leaderboard, so a check-then-
    delete would let anyone who can read a hash remove someone else's paper.

    The Proof-of-Research block for the assessment is intentionally left in
    place — the chain is append-only and every block hashes its predecessor, so
    removing one would invalidate all of its successors. The paper leaves the
    corpus and the listings; the record that it was once assessed remains, which
    is the only outcome consistent with the ledger's integrity claim.
    """
    identity = require_identity(request, wallet, orcid)
    result = delete_assessment(
        file_hash,
        identities=_identity_values(identity["wallet"], identity["orcid"]),
        allow_any=auth.is_owner(identity),
    )
    if not result["deleted"]:
        raise HTTPException(status_code=404 if "not found" in result["reason"].lower() else 403,
                            detail=result["reason"])
    # The manuscript file goes with the paper. The ledger block is append-only
    # and stays; the PDF is not part of the chain, and leaving a downloadable
    # copy of a withdrawn paper on a public URL would make "remove" mean
    # considerably less than it says.
    file_removed = paper_store.delete_paper(file_hash)

    # `key` was never defined in this function — the deletion itself succeeded
    # and then this log line raised NameError, which the framework turned into
    # a 500. The caller saw "Internal server error" for an operation that had
    # already worked, which is the worst combination: the paper was gone and the
    # interface said the request failed.
    actor = _profile_key(identity["wallet"], identity["orcid"]) or "owner"
    add_log(f"Assessment {file_hash[:12]}… withdrawn by {actor[:16]}"
            + (" (stored manuscript deleted)" if file_removed else ""))
    return {"deleted": True, "file_deleted": file_removed,
            "message": ("Paper removed from the corpus and all listings"
                        + (", and the stored manuscript file was deleted" if file_removed else "")
                        + ". Its ledger block remains, because the Proof-of-Research chain is "
                          "append-only.")}
