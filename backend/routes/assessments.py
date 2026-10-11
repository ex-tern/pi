"""routes/assessments.py: your assessments: mine, escrow, claims, authorship challenges, publishing, paper files. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.assess import JOURNAL_CHECK_BUDGET_SECONDS  # noqa: F401
from routes.identity import _identity_values, _profile_key, require_identity  # noqa: F401
from routes.piq import require_affordable  # noqa: F401

router = APIRouter()



# ---------------------------------------------------------------------------
# Assessment history and withdrawal
# ---------------------------------------------------------------------------
@router.get("/api/assessments/mine")
def my_assessments(request: Request, wallet: str = Query(default=""),
                   orcid: str = Query(default=""),
                   limit: int = Query(default=100, ge=1, le=300)):
    """Everything assessed under this identity.

    Anonymous visitors get an explicit empty result rather than an error: they
    genuinely have no history to show, because nothing durable is keyed to
    them, and saying so is more useful than a 400.
    """
    # Proven, not claimed. This returns a person's private assessment history;
    # accepting an unauthenticated ?orcid= made every user's record readable by
    # anyone who knew their ORCID, which is a published identifier.
    identity = auth.identity_from_request(request, wallet, orcid)
    key = _profile_key(identity["wallet"], identity["orcid"]) if identity["verified"] else ""
    if not key:
        return {"signed_in": False, "assessments": [], "count": 0,
                "reason": ("Sign in with a wallet or ORCID to keep a history of your "
                           "assessments. Anonymous runs are not linked to an identity.")}
    rows = list_assessments_for_identity(
        _identity_values(identity["wallet"], identity["orcid"]), limit=limit)

    # Annotated here rather than in the query: whether a file exists is a
    # filesystem fact, not a column, and the badge needs it to link to the
    # manuscript instead of falling back to the dossier.
    for r in rows:
        r["has_file"] = paper_store.has_paper(r.get("hash", ""))
    # Which identity this history was read under.
    #
    # Reported because an empty list has two very different causes — nothing
    # assessed, or assessed while a different identity was the proven one —
    # and the interface cannot tell them apart without knowing which key was
    # used. Stating the key is a fact; guessing that orphaned records exist
    # would not be, since a paper filed under an identity we cannot prove is
    # precisely a paper we cannot attribute to this user.
    return {"signed_in": True, "assessments": rows, "count": len(rows),
            "read_as": {"wallet": identity["wallet"], "orcid": identity["orcid"]}}


@router.get("/api/assessments/escrow")
def my_escrow(request: Request, wallet: str = Query(default=""),
              orcid: str = Query(default="")):
    """piQ this identity has earned but not yet been able to claim."""
    identity = auth.identity_from_request(request, wallet, orcid)
    if not identity["verified"]:
        return {"signed_in": False, "held": [], "total": 0.0}
    rows = list_escrowed_for_identity(_identity_values(identity["wallet"], identity["orcid"]))
    return {
        "signed_in": True,
        "held": rows,
        "total": round(sum(r["escrowed"] for r in rows), 4),
        "note": ("Held because authorship could not be linked to your identity. Claim a paper "
                 "once its DOI is registered against your ORCID, or once your ORCID profile "
                 "name matches the author line."),
    }


@router.get("/api/assessments/claimable")
def claimable_escrow(request: Request, wallet: str = Query(default=""),
                     orcid: str = Query(default="")):
    """piQ held against papers whose BYLINE matches this identity.

    Distinct from /api/assessments/escrow, which lists papers this identity
    SUBMITTED. That endpoint could never surface the case the escrow mostly
    exists for: a paper somebody else put through the pipeline, or one you
    assessed before linking an ORCID. Held piQ sat there unfindable, because
    the only view of it was filtered by the one fact that did not apply.

    This is a SHORTLIST, not a verdict. Matching is on the verified ORCID
    profile name against the extracted byline, which is cheap and offline;
    the real decision is still made by verify_authorship at claim time,
    against the registries. Saying "this may be yours" and then checking
    properly is the right order — the reverse would mean running a network
    verification against every held paper in the corpus to render a sidebar.
    """
    identity = auth.identity_from_request(request, wallet, orcid)
    if not identity["verified"] or not identity["orcid"]:
        # Without an ORCID there is no verified name to compare a byline
        # against, and a wallet address is not a person's name.
        return {"signed_in": bool(identity["verified"]), "candidates": [], "total": 0.0,
                "reason": ("Link an ORCID to see piQ that may be held for papers you authored. "
                           "A byline can only be matched against a verified profile name.")}

    try:
        profile_name = fetch_orcid_profile_name(identity["orcid"])
    except Exception as e:
        logging.debug("ORCID profile lookup failed during claimable scan: %s", e)
        profile_name = None
    if not profile_name:
        return {"signed_in": True, "candidates": [], "total": 0.0,
                "reason": "Your ORCID profile name could not be read, so no byline was compared."}

    # Papers this person has already said are not theirs stay out of the list.
    # Asking twice about the same paper turns a helpful prompt into nagging,
    # and re-suggesting something somebody explicitly declined reads as not
    # having listened.
    dismissed = list_disowned(_profile_key(identity["wallet"], identity["orcid"]))

    candidates = []
    for paper in list_unclaimed_escrow():
        if paper["hash"] in dismissed:
            continue
        authors = [a.strip() for a in (paper.get("author") or "").split(",") if a.strip()]
        for a in authors:
            if names_match(profile_name, a):
                candidates.append({**paper, "matched_author": a})
                break

    return {
        "signed_in": True,
        "candidates": candidates,
        "total": round(sum(c["escrowed"] for c in candidates), 4),
        "profile_name": profile_name,
        "note": ("Matched on your ORCID profile name against each paper's byline. Claiming "
                 "re-checks authorship against the publisher and ORCID registries, so a match "
                 "here is a candidate rather than a guarantee."),
    }


@router.post("/api/assessments/{file_hash}/disown")
def disown_paper(file_hash: str, request: Request, wallet: str = Query(default=""),
                 orcid: str = Query(default="")):
    """"Not mine." Stop suggesting this paper to this person.

    Nothing is forfeited. The piQ stays exactly where it was, still held and
    still claimable by whoever the author turns out to be — this records a
    person's answer to a question we asked them, and no more than that. A
    stronger reading would be wrong: someone declining a suggestion has not
    made a ruling about who the paper belongs to.
    """
    identity = require_identity(request, wallet, orcid)
    key = _profile_key(identity["wallet"], identity["orcid"])
    ok = disown_escrow(file_hash, key)
    return {"disowned": bool(ok),
            "message": ("Removed from your suggestions. The piQ stays held for this paper's "
                        "author — nothing was given up.")
                       if ok else "Could not record that. Please try again."}


@router.post("/api/assessments/{file_hash}/claim")
def claim_escrow(file_hash: str, request: Request, wallet: str = Query(default=""),
                 orcid: str = Query(default="")):
    """Re-run authorship verification and release the escrow if it now passes.

    Deliberately re-verifies rather than trusting the original result: the
    evidence changes over time. A preprint gets a DOI, a publisher deposits the
    ORCID, a researcher adds the work to their profile. The paper that could
    not be claimed in July may be claimable in September, and the claim should
    be decided on the evidence available when it is made.
    """
    identity = require_identity(request, wallet, orcid)
    check_rate_limit(get_client_ip(request), bucket="claim")

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT author_name, doi, piq_escrowed, piq_claimed_at, title "
            "FROM papers_assessment WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")
    if row[3]:
        return {"claimed": False, "message": "This paper's piQ has already been claimed."}
    if not row[2]:
        return {"claimed": False, "message": "Nothing is held for this paper."}

    attribution = verify_authorship(
        submitter_orcid=identity["orcid"],
        submitter_wallet=identity["wallet"],
        extracted_authors=row[0] or "",
        doi=row[1] or "",
        title=row[4] or "",
    )
    if not attribution.get("verified"):
        return {
            "claimed": False,
            "attribution": attribution,
            "message": attribution.get("reason", "Authorship still could not be verified."),
            "how_to_fix": attribution.get("how_to_verify"),
        }

    # verify_authorship has just passed for THIS paper and THIS identity, so
    # the claimant is an author of it. That is the whole authorisation; adding
    # "…and you must also have been the one who uploaded it" would refuse
    # precisely the authors this piQ is being held for.
    result = release_escrow(file_hash,
                            _identity_values(identity["wallet"], identity["orcid"]),
                            wallet=identity["wallet"], orcid=identity["orcid"],
                            authorship_proven=True)
    if not result["released"]:
        return {"claimed": False, "message": result["reason"]}

    add_log(f"Escrow released: {result['released']:.4f} piQ for {file_hash[:12]}… "
            f"(tier {attribution.get('tier')})")
    return {
        "claimed": True, "amount": result["released"],
        "tier": attribution.get("tier"),
        "message": (f"{result['released']:.4f} piQ released. Authorship confirmed via "
                    f"{attribution.get('tier')}."),
    }


class ChallengeStart(BaseModel):
    # An INDEX into the addresses found in the manuscript — never an address.
    # Accepting an address here would reduce the whole mechanism to "type one
    # you control", which is precisely the fraud it exists to prevent.
    email_index: int = 0
    wallet: str = ""
    orcid: str = ""


class ChallengeConfirm(BaseModel):
    code: str
    wallet: str = ""
    orcid: str = ""


@router.get("/api/assessments/{file_hash}/challenge")
def challenge_options(file_hash: str, request: Request, wallet: str = Query(default=""),
                      orcid: str = Query(default="")):
    """Which addresses in the manuscript a code could be sent to.

    Masked. This endpoint is reachable by anyone who can submit a paper, so
    returning author emails in full would turn the feature into a scraper for
    exactly the addresses researchers most want protected.
    """
    identity = require_identity(request, wallet, orcid)
    conn = get_db_connection()
    try:
        row = conn.execute("SELECT contact_emails, piq_escrowed, piq_claimed_at "
                           "FROM papers_assessment WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")
    try:
        emails = json.loads(row[0] or "[]")
    except (ValueError, TypeError):
        emails = []

    existing = get_challenge(file_hash, _profile_key(identity["wallet"], identity["orcid"]))
    return {
        "options": [{"index": i, "masked": authorship_challenge.mask_email(e)}
                    for i, e in enumerate(emails)],
        "escrowed": round(float(row[1] or 0), 4),
        "already_claimed": bool(row[2]),
        "pending": bool(existing and not existing.get("verified_at")),
        "note": ("A code is sent to an address printed in the manuscript. Addresses cannot be "
                 "supplied here — that is what makes controlling the mailbox meaningful."
                 if emails else
                 "No contact address could be found in this manuscript, so this route is "
                 "unavailable. Register the DOI against your ORCID instead."),
    }


@router.post("/api/assessments/{file_hash}/challenge")
def challenge_start(file_hash: str, payload: ChallengeStart, request: Request):
    """Send a one-time code to a manuscript-listed address."""
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="challenge")
    key = _profile_key(identity["wallet"], identity["orcid"])

    conn = get_db_connection()
    try:
        row = conn.execute("SELECT contact_emails, title, piq_escrowed, piq_claimed_at "
                           "FROM papers_assessment WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")
    if row[3]:
        return {"sent": False, "message": "This paper's piQ has already been claimed."}
    try:
        emails = json.loads(row[0] or "[]")
    except (ValueError, TypeError):
        emails = []
    if not emails:
        return {"sent": False, "message": "No contact address was found in this manuscript."}
    if not (0 <= payload.email_index < len(emails)):
        raise HTTPException(status_code=400, detail="That is not one of the manuscript's addresses.")

    address = emails[payload.email_index]
    code = authorship_challenge.generate_code()
    secret = os.getenv("SESSION_SECRET", "") or ETH_ADMIN_PRIVATE_KEY
    store_challenge(
        file_hash, key,
        authorship_challenge.mask_email(address),
        hashlib.sha256(address.lower().encode()).hexdigest(),
        authorship_challenge.hash_code(code, file_hash, secret),
    )
    result = authorship_challenge.send_challenge(address, code, row[1] or "this manuscript")
    add_log(f"Authorship challenge for {file_hash[:12]}… -> "
            f"{authorship_challenge.mask_email(address)} (sent={result['sent']})")
    if not result["sent"]:
        return {"sent": False,
                "message": ("The code could not be sent. Email is not configured on this "
                            "deployment, so this route is unavailable.")}
    return {
        "sent": True,
        "masked": authorship_challenge.mask_email(address),
        "expires_in_minutes": authorship_challenge.CODE_TTL_MINUTES,
        "message": (f"A confirmation code was sent to "
                    f"{authorship_challenge.mask_email(address)}. It expires in "
                    f"{authorship_challenge.CODE_TTL_MINUTES} minutes."),
    }


@router.post("/api/assessments/{file_hash}/challenge/confirm")
def challenge_confirm(file_hash: str, payload: ChallengeConfirm, request: Request):
    """Confirm the code and release the escrow."""
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="challenge")
    key = _profile_key(identity["wallet"], identity["orcid"])

    challenge = get_challenge(file_hash, key)
    if not challenge:
        return {"claimed": False, "message": "No code has been requested for this paper."}
    if challenge.get("verified_at"):
        return {"claimed": False, "message": "This challenge was already used."}
    if challenge["attempts"] >= authorship_challenge.MAX_ATTEMPTS:
        return {"claimed": False,
                "message": ("Too many incorrect attempts. Request a new code — the previous one "
                            "is no longer valid.")}
    if authorship_challenge.is_expired(challenge["created_at"]):
        return {"claimed": False, "message": "That code has expired. Request a new one."}

    secret = os.getenv("SESSION_SECRET", "") or ETH_ADMIN_PRIVATE_KEY
    supplied = authorship_challenge.hash_code(
        (payload.code or "").strip(), file_hash, secret)
    # compare_digest: a code must not be recoverable from response timing.
    if not hmac.compare_digest(supplied, challenge["code_hash"]):
        record_challenge_attempt(challenge["id"], verified=False)
        remaining = authorship_challenge.MAX_ATTEMPTS - challenge["attempts"] - 1
        return {"claimed": False,
                "message": f"That code is not correct. {max(0, remaining)} attempt(s) remaining."}

    record_challenge_attempt(challenge["id"], verified=True)
    result = release_escrow(file_hash, _identity_values(identity["wallet"], identity["orcid"]),
                            wallet=identity["wallet"], orcid=identity["orcid"])
    if not result["released"]:
        return {"claimed": False, "message": result["reason"]}
    add_log(f"Escrow released by email challenge: {result['released']:.4f} piQ for {file_hash[:12]}…")
    return {"claimed": True, "amount": result["released"], "tier": "corresponding-author-email",
            "message": (f"{result['released']:.4f} piQ released. You confirmed control of an "
                        f"address printed in the manuscript.")}


class PublishRequest(BaseModel):
    published: bool = True
    kind: str = "author"            # "author" | "journal"
    doi: str = ""                   # required for a journal claim
    wallet: str = ""
    orcid: str = ""
    # Publishing makes the stored manuscript publicly downloadable. The platform
    # cannot know whether the uploader holds redistribution rights — a typeset
    # version of record usually belongs to the publisher, not the author — so
    # the claim is made explicitly by the person who does know, and recorded.
    distribute_file: bool = False


@router.get("/api/assessments/{file_hash}/publish")
def publish_status(file_hash: str, request: Request, wallet: str = Query(default=""),
                   orcid: str = Query(default="")):
    """Whether this identity may publish this paper, and what it would cost."""
    identity = auth.identity_from_request(request, wallet, orcid)
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT author_name, doi, title, published_at, published_by, piq_claimed_at, "
            "final_score FROM papers_assessment WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")

    already_paid = publication_fee_paid(
        file_hash, _identity_values(identity["wallet"], identity["orcid"]))
    fee = publication_fee(safe_float(row[6], 0.0))
    published = bool(row[3])

    if not identity["verified"]:
        return {"published": published, "may_publish": False, "fee": fee,
                "reason": "Sign in to publish an assessment."}

    # Authorship must already be established. Publishing attaches a name to a
    # public record, so it requires the same proof as claiming the piQ — the
    # weaker "I typed this name" is exactly what the badge must not certify.
    attribution = verify_authorship(
        submitter_orcid=identity["orcid"], submitter_wallet=identity["wallet"],
        extracted_authors=row[0] or "", doi=row[1] or "", title=row[2] or "")
    verified = bool(attribution.get("verified")) or bool(row[5])

    # Review before publication. Reported here so the form can say why the
    # button is off, rather than letting someone fill it in and be refused.
    reviewed = has_human_review(file_hash)
    owner_override = bool(auth.is_owner(identity))

    return {
        "published": published,
        "published_at": row[3],
        "may_publish": verified and (reviewed or owner_override),
        "owner_override": owner_override and not reviewed,
        "authorship_ok": verified,
        "reviewed": reviewed,
        "review_requested": has_open_review_request(file_hash),
        "review_blocked_reason": ("" if (reviewed or owner_override) else
            ("This paper has not been peer reviewed. A paper must be reviewed before it can be "
             "published — request a review from this dossier, and publish once a reviewer has "
             "submitted their report.")),
        # Journal claims need both factors and a DOI that survives verification,
        # so the form can disable that option up front instead of letting a user
        # fill it in and be refused.
        "may_claim_journal": bool(identity["wallet"] and identity["orcid"]),
        # Whether publishing would expose a stored file, so the form can ask
        # for the redistribution attestation only when there is one to make.
        "has_file": paper_store.has_paper(file_hash),
        "journal_blocked_reason": (
            "" if (identity["wallet"] and identity["orcid"]) else
            ("A journal claim needs both a signed wallet and a linked ORCID. You have "
             + ("only an ORCID — connect and sign a wallet to enable it."
                if identity["orcid"] else
                "only a wallet — link your ORCID to enable it."))),
        "authorship_tier": attribution.get("tier") if attribution.get("verified") else (
            "escrow-claimed" if row[5] else "unverified"),
        "fee": fee,
        "fee_already_paid": already_paid,
        "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
        "held": get_piq_balance(identity["wallet"], identity["orcid"]).get("held", 0.0),
        # Two independent gates, reported separately. Collapsing them into one
        # message would tell a verified author whose paper is unreviewed that
        # their authorship is the problem, which it is not.
        "reason": ("" if verified else
                   (attribution.get("reason") or "Authorship is not verified for this paper.")),
        "how_to_fix": None if verified else attribution.get("how_to_verify"),
    }


@router.post("/api/assessments/{file_hash}/publish")
def publish_assessment(file_hash: str, payload: PublishRequest, request: Request):
    """Attach or withdraw an author's public endorsement of an assessment.

    "Published" here means the verified author has chosen to stand behind this
    assessment publicly. It is deliberately NOT a claim of journal publication,
    and the badge says "Author-published" so the two cannot be conflated — on a
    research platform, an unqualified "Published" badge would be read as peer
    review, which this is not.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="publish")
    key = _profile_key(identity["wallet"], identity["orcid"])
    identities = _identity_values(identity["wallet"], identity["orcid"])

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT author_name, doi, title, piq_claimed_at, final_score "
            "FROM papers_assessment WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")

    # Withdrawal never requires re-proving authorship or paying anything. An
    # endorsement that cannot be retracted is a trap, not an endorsement.
    if not payload.published:
        result = set_published(file_hash, identities, key, False)
        if not result["ok"]:
            raise HTTPException(status_code=403, detail=result["reason"])
        add_log(f"Assessment {file_hash[:12]}… withdrawn from publication.")
        return {"published": False,
                "message": ("Withdrawn. The badge is removed; the assessment and its ledger "
                            "block are unchanged. Re-publishing is free.")}

    kind = (payload.kind or "author").strip().lower()
    if kind not in ("author", "journal"):
        raise HTTPException(status_code=400, detail="Publication kind must be author or journal.")

    # Review comes before publication. Checked before the fee is taken, before
    # authorship is verified, and again inside set_published — this is the
    # ordering rule the journal rests on, and a rule enforced in one place is a
    # rule with one bug away from not existing. A machine review does not
    # satisfy it: has_human_review excludes the panel deliberately.
    # The operator may publish unreviewed work on the deployment they run.
    # Without this the platform cannot start: the first paper needs a review,
    # a review needs a peer, and the first participant has none. The paper
    # still gets no Peer-reviewed badge — the override skips the gate, it does
    # not manufacture a review — so a reader can always see the difference.
    owner_override = bool(auth.is_owner(identity))
    if not owner_override and not has_human_review(file_hash):
        raise HTTPException(
            status_code=409,
            detail=("This paper has not been peer reviewed, and a paper must be reviewed before "
                    "it can be published. Request a review from the dossier; once a reviewer has "
                    "submitted their report the paper carries a Peer-reviewed badge and "
                    "publishing becomes available. No piQ has been charged."
                    + (" A review has already been requested and is waiting for a reviewer."
                       if has_open_review_request(file_hash) else "")))

    # Publication requires a readable manuscript, and permission to show it.
    #
    # Both conditions are mandatory, for the same reason: a badge that asserts
    # "published" while the paper behind it cannot be opened is a claim a reader
    # has no way to check, which is precisely what this platform argues against.
    # Every published assessment therefore has a file, and every file is public
    # because its author said it could be.
    if not paper_store.has_paper(file_hash):
        raise HTTPException(
            status_code=409,
            detail=("Publishing needs the manuscript file, and none is stored for this "
                    "assessment. Papers assessed before file retention, and papers submitted by "
                    "DOI rather than upload, have no stored file — re-run the assessment with "
                    "the PDF uploaded and you can publish it."))
    if not payload.distribute_file:
        raise HTTPException(
            status_code=400,
            detail=("Publishing makes the uploaded manuscript publicly readable. Confirm you hold "
                    "the right to distribute this file — for a journal article that is often the "
                    "accepted manuscript rather than the publisher's typeset version."))

    attribution = verify_authorship(
        submitter_orcid=identity["orcid"], submitter_wallet=identity["wallet"],
        extracted_authors=row[0] or "", doi=row[1] or "", title=row[2] or "")

    # An author-published badge accepts the escrow-claim as standing evidence of
    # authorship. A journal claim does not: claiming escrow proves you satisfied
    # the minting check at some point in the past, which says nothing about
    # whether a particular DOI is yours.
    escrow_ok = bool(row[3]) and kind != "journal"
    if not (attribution.get("verified") or escrow_ok):
        raise HTTPException(
            status_code=403,
            detail=(attribution.get("reason") or "Authorship is not verified for this paper.")
                   + (" " + attribution["how_to_verify"] if attribution.get("how_to_verify") else ""))

    journal_check = None
    if kind == "journal":
        # The strongest badge on the platform, so it carries the strongest
        # identity requirement — both a signed wallet and a linked ORCID, the
        # same bar as commissioning a review. One factor was enough to mint a
        # permanent public claim about a journal that never made it.
        if not (identity["wallet"] and identity["orcid"]):
            missing = "a signed wallet" if not identity["wallet"] else "a linked ORCID"
            raise HTTPException(
                status_code=403,
                detail=(f"A journal claim needs both a signed wallet and a linked ORCID; you are "
                        f"missing {missing}. The wallet proves control of the account making the "
                        f"claim, the ORCID ties it to a research identity the registry can be "
                        f"checked against. Author-publishing needs only one and is available now."))

        # Bounded, because this is the one publish path that goes to the
        # internet. It resolves the DOI in Crossref, falls back to OpenAlex,
        # then reads the claimant's ORCID profile — each with its own retries.
        # On a host that cannot reach those registries the calls do not fail
        # fast, they fail slowly, and the button sits on "Publishing…" for a
        # minute or more with nothing to show for it. A refusal a user can act
        # on beats an indefinite wait.
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            fut = pool.submit(
                verify_journal_claim,
                doi=(payload.doi or row[1] or ""), orcid=identity["orcid"],
                assessed_title=row[2] or "", assessed_authors=row[0] or "")
            journal_check = fut.result(timeout=JOURNAL_CHECK_BUDGET_SECONDS)
        except concurrent.futures.TimeoutError:
            add_log(f"Journal claim on {file_hash[:12]}… timed out verifying the DOI.")
            raise HTTPException(
                status_code=504,
                detail=(f"The DOI could not be checked within "
                        f"{JOURNAL_CHECK_BUDGET_SECONDS}s — Crossref and OpenAlex are not "
                        f"answering from this server. Nothing was published and nothing was "
                        f"charged. Author-publish now if you want the paper visible, and "
                        f"switch to a journal claim once the registries are reachable."))
        finally:
            pool.shutdown(wait=False)
        if not journal_check["ok"]:
            add_log(f"Journal claim REFUSED on {file_hash[:12]}… — {journal_check['reason'][:120]}")
            raise HTTPException(
                status_code=422,
                detail=journal_check["reason"]
                       + (" " + journal_check["how_to_fix"] if journal_check["how_to_fix"] else ""))

    fee = publication_fee(safe_float(row[4], 0.0))["fee"]
    if fee > 0 and not publication_fee_paid(file_hash, identities):
        bal = get_piq_balance(identity["wallet"], identity["orcid"])
        require_affordable(bal, fee, "Publishing")
        if not charge_piq_fee(fee, identity["wallet"], identity["orcid"],
                              eval_hash=file_hash, reason="Publication fee"):
            raise HTTPException(status_code=402, detail="The publication fee could not be charged.")

    result = set_published(file_hash, identities, key, True, kind=kind,
                           allow_unreviewed=owner_override)
    if owner_override and not has_human_review(file_hash):
        add_log(f"Owner published {file_hash[:12]}… WITHOUT a peer review "
                f"(operator override; no Peer-reviewed badge attached).")
    if not result["ok"]:
        raise HTTPException(status_code=403, detail=result["reason"])

    # Record the DOI the claim was actually verified against. Without this the
    # badge would be backed by whatever DOI happened to be on the row, which
    # need not be the one that passed the check.
    if kind == "journal" and journal_check:
        verified_doi = (payload.doi or row[1] or "").replace("https://doi.org/", "").strip()
        conn = get_db_connection()
        try:
            conn.execute("UPDATE papers_assessment SET doi = ? WHERE eval_hash = ?",
                         (verified_doi, file_hash))
            conn.commit()
        except sqlite3.Error as e:
            logging.warning("Could not store verified DOI for %s: %s", file_hash[:12], e)
        finally:
            conn.close()

    tier = (journal_check or {}).get("tier") or attribution.get("tier") or "escrow-claimed"
    add_log(f"Assessment {file_hash[:12]}… published ({kind}) by {key[:16]}… (tier {tier})")

    if kind == "journal":
        reg = (journal_check or {}).get("registry", {})
        msg = (f"Published. This assessment now carries a Journal-published badge. The DOI "
               f"resolves in {reg.get('basis') or 'a registry'}, the registered title matches "
               f"this manuscript, and you are confirmed as an author "
               f"({'deposited ORCID' if tier == 'registry-orcid' else 'deposited author name'}).")
    else:
        msg = ("Published. Your assessment now carries an Author-published badge wherever it "
               "appears. This is your own endorsement, not a claim of journal publication.")

    return {
        "published": True,
        "charged": 0.0 if publication_fee_paid(file_hash, identities) and False else fee,
        "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
        "kind": kind,
        "verification": journal_check.get("registry") if journal_check else None,
        "tier": tier,
        "message": msg + " You can withdraw it at any time, free of charge.",
    }


@router.get("/api/papers/{file_hash}/file")
def serve_paper_file(file_hash: str, request: Request,
                     wallet: str = Query(default=""), orcid: str = Query(default=""),
                     download: bool = Query(default=False)):
    """The manuscript a published assessment is an assessment of.

    Two ways to be allowed to read it, and no third:

      * the assessment is PUBLISHED — its author chose to make it public and
        attested they hold the right to distribute it; or
      * you are the author, reading your own unpublished upload.

    Retention is not publication. A file sitting in the store because someone
    once ran an assessment is nobody's business but theirs until they publish
    it, so an unpublished paper is 404 to everyone else — not 403, which would
    confirm the paper exists to someone who should not know that.
    """
    path = paper_store.paper_path(file_hash)

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT published_at, title, user_id FROM papers_assessment WHERE eval_hash = ?",
            (file_hash,)).fetchone()
    except sqlite3.Error:
        row = None
    finally:
        conn.close()

    if not row or not path:
        raise HTTPException(
            status_code=404,
            detail=("No manuscript file is stored for this assessment. Papers assessed before "
                    "file retention was enabled, and papers submitted by DOI rather than upload, "
                    "have no stored file — the DOI resolves to the published version instead."))

    if not row[0]:
        identity = auth.identity_from_request(request, wallet, orcid)
        owns = bool(identity["verified"]
                    and row[2]
                    and row[2] in _identity_values(identity["wallet"], identity["orcid"]))
        if not owns:
            raise HTTPException(
                status_code=404,
                detail="No public manuscript file is available for this assessment.")

    # HTTP header values are latin-1. `\w` in the pattern below matches Unicode
    # letters, so a title containing π — or an accent, or any non-Western
    # script — survived this filter and then blew up on the way out as
    #   UnicodeEncodeError: 'latin-1' codec can't encode character '\u03c0'
    # which surfaced as a 500 on a paper that was perfectly fine. The paper this
    # framework is named after cannot be the one paper it fails to serve.
    #
    # RFC 6266/5987 exists precisely for this: `filename` carries an ASCII
    # fallback for old clients, `filename*` carries the real UTF-8 name
    # percent-encoded. Every current browser prefers the second.
    raw_title = (row[1] or "manuscript")[:80].strip() or "manuscript"
    ascii_title = re.sub(r"[^A-Za-z0-9 \-.]", "", raw_title).strip() or "manuscript"
    utf8_title = urllib.parse.quote(re.sub(r'[\\"\r\n]', "", raw_title), safe="")
    return FileResponse(
        path, media_type="application/pdf",
        # inline: a reader clicking a badge wants to read the paper, not to
        # find it in their downloads folder. ?download=1 (the dossier's
        # Download button) asks for a file to save instead.
        headers={"Content-Disposition":
                 f'{"attachment" if download else "inline"}; filename="{ascii_title}.pdf"; '
                 f"filename*=UTF-8''{utf8_title}.pdf"})
