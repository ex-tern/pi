"""routes/assess.py: assessing a manuscript: the result payload, fetching by DOI, the streamed assessment. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.explorer import CRITERIA_TITLES  # noqa: F401
from routes.identity import _arcade_key, _profile_key  # noqa: F401
from routes.piq import count_assessed_papers, normalize_identity, resolve_active_fee  # noqa: F401

router = APIRouter()



def _json_safe(value):
    """Fallback encoder for values json.dumps cannot serialise natively.

    Reached only for types the default encoder rejects. Everything the scoring
    pipeline can produce is converted to its nearest JSON equivalent rather
    than raising, because the alternative — an exception mid-stream — silently
    destroys a result the user has already been charged for.
    """
    # numpy scalars and arrays expose .item()/.tolist() without importing numpy
    # here, which keeps this working even if numpy is absent.
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        try:
            return value.item()
        except Exception:
            pass
    if hasattr(value, "tolist"):
        try:
            return value.tolist()
        except Exception:
            pass
    if isinstance(value, (set, frozenset, tuple)):
        return list(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    # Last resort: a string is always better than a dead stream.
    return str(value)


def _fmt_score(value) -> str:
    """Format a score for a log line without ever raising.

    This is not cosmetic. These log calls sit between the database write and
    the `yield` that delivers the result to the browser, so a TypeError here
    (score is None when a stage degrades) killed the generator *after* the
    paper was persisted: it appeared in the leaderboard and analytics, but the
    Assessment Results panel stayed empty and the user believed the run had
    silently failed. Logging must never be able to destroy a completed result.
    """
    try:
        return f"{float(value):.2f}"
    except (TypeError, ValueError):
        return "n/a"


def build_result_payload(res, filename, profile=None):
    consensus = res[19] if isinstance(res[19], dict) else {}
    scores = res[8] or {}

    def opt(idx, default):
        return res[idx] if len(res) > idx and res[idx] is not None else default

    payload = {
        "judge_metadata": consensus.get("_judge_metadata", {}),
        "integrity": opt(22, {}),
        "reference_audit": opt(23, {}),
        "authorship_signal": opt(24, {}),
        "topology_detail": opt(25, {}),
        "author_metrics": opt(26, {}),
        "emission": opt(27, {}),
        "criteria_detail": [
            {"id": f"C{i + 1}", "title": CRITERIA_TITLES.get(f"C{i + 1}", ""), "score": safe_float(v, 0.0)}
            for i, v in enumerate(scores.values())
        ],
        "mdar_score": res[14],
        "rrid_count": res[15],
        "explorer_url": get_sepolia_explorer_url(res[11], "tx"),
        "title": res[0],
        "author_name": clean_author_name(res[1]),
        "score": res[2],
        "logic_integrity": res[3],
        "classification": opt(4, {}),
        "criteria_breakdown": opt(5, []),
        "fields": opt(6, []),
        "subfields": opt(7, []),
        "scores_dict": res[8],
        "eval_hash": res[9],
        "piq": res[10],
        "tx_hash": res[11],
        "zk_proof": res[12],
        "repro_score": res[16],
        "filename": filename,
        "warnings": res[18],
        "consensus_raw": res[19],
        "evidence_report_text": res[20],
        "scilem_rating": res[21],
        "rubric_version": RUBRIC_VERSION,
        # True when this submission resolved to an assessment that already
        # existed — either the identical file, or the same work in a different
        # file. Surfaced so the interface can say "you already have this" and
        # link to the existing record, rather than presenting a stored result
        # as though it were fresh work.
        "duplicate": bool(res[17]) if len(res) > 17 else False,
    }

    # Reception diagnostic: why this work is or isn't landing. Deterministic
    # and derived entirely from signals already in the payload, so it adds no
    # latency and no provider cost. Wrapped because a diagnostic failure must
    # never cost the user the assessment they just paid for.
    try:
        payload["diagnostics"] = diagnostics.build_report(payload, profile)
    except Exception as e:
        logging.warning("Diagnostic report failed for %s: %s", payload.get("eval_hash"), e)
        payload["diagnostics"] = {"available": False, "reason": "Diagnostic unavailable."}
    return payload


def retrieve_manuscript_bytes(doi: str = "", pdf_url: str = "", candidates: List[str] = None):
    """Resolve a manuscript to PDF bytes, trying every known source.

    Returns ``(pdf_bytes, attempts)`` where `attempts` records what was tried
    and why each failed. Previously this returned only bytes-or-None, so a
    discovery failure surfaced in the UI as an unexplained "could not
    retrieve" with no way to tell a paywall from a transient network error.

    Sources are tried most-direct first: known PDF URLs, then DOI metadata,
    then Semantic Scholar, then a CORE full-text fallback wrapped into a
    synthetic PDF.
    """
    doi = normalize_doi(doi or "")
    attempts = []
    urls = [u for u in ([pdf_url] + list(candidates or [])) if u]

    for url in urls[:6]:
        try:
            data = download_pdf(url)
            if data:
                attempts.append({"source": url[:120], "result": "ok"})
                return data, attempts
            attempts.append({"source": url[:120], "result": "not a retrievable PDF"})
        except Exception as e:
            attempts.append({"source": url[:120], "result": f"error: {e}"[:120]})

    if doi:
        try:
            metadata = fetch_doi_metadata(doi)
            if metadata and metadata.get("pdf_url"):
                data = download_pdf(metadata["pdf_url"])
                if data:
                    attempts.append({"source": "Unpaywall", "result": "ok"})
                    return data, attempts
            attempts.append({"source": "Unpaywall", "result": "no open-access PDF listed"})
        except Exception as e:
            attempts.append({"source": "Unpaywall", "result": f"error: {e}"[:120]})

        try:
            s2 = fetch_semantic_scholar_pdf(doi)
            data = download_pdf(s2) if s2 else None
            if data:
                attempts.append({"source": "Semantic Scholar", "result": "ok"})
                return data, attempts
            attempts.append({"source": "Semantic Scholar", "result": "no open-access PDF"})
        except Exception as e:
            attempts.append({"source": "Semantic Scholar", "result": f"error: {e}"[:120]})

        try:
            text = fetch_core_text_by_doi(doi)
            data = build_pdf_from_text(text) if text else None
            if data:
                attempts.append({"source": "CORE full text", "result": "ok (text-only)"})
                return data, attempts
            attempts.append({"source": "CORE full text", "result": "no full text indexed"})
        except Exception as e:
            attempts.append({"source": "CORE full text", "result": f"error: {e}"[:120]})

    add_log(f"Retrieval failed (doi={doi or 'none'}): {len(attempts)} source(s) tried")
    return None, attempts


def estimate_word_count(pdf_bytes: bytes) -> int:
    """Approximate word count without a full parse.

    Used only for pricing, so a cheap estimate is right: opening every page
    with PyMuPDF purely to set a fee would double the parsing cost of the
    thing being priced. Falls back to a byte-size heuristic if extraction is
    unavailable, and pricing floors at the minimum either way.
    """
    if not pdf_bytes:
        return 0
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            pages = min(doc.page_count, 6)
            sampled = sum(len(doc[i].get_text("text").split()) for i in range(pages))
            if pages == 0:
                return 0
            return int((sampled / pages) * doc.page_count)
        finally:
            doc.close()
    except Exception:
        # ~2.5KB of PDF per 100 words is a rough but serviceable fallback.
        return int(len(pdf_bytes) / 25)


def stream_assessment_progress(files: List[tuple], doi: Optional[str], include_doi: bool,
                            discover_papers: List[dict], user_id: str, book_address: str,
                            fee_wallet: str = "", fee_orcid: str = "", charge_fees: bool = False,
                            active_fee: float = PIQ_PROCESSING_FEE,
                            researcher_profile: Optional[dict] = None):
    """Generator yielding NDJSON status/result lines, mirroring the old
    st.status(...) 'Analyzing X...' live progress box.

    Each paper is billed the flat PIQ_PROCESSING_FEE at the moment it is
    about to be processed. Billing per-paper rather than per-request means a
    batch that runs out of balance halfway through stops cleanly, and a paper
    whose source could never be retrieved is refunded rather than charged for
    work that was never done.
    """

    def emit_result(item, label):
        """Serialise one result, degrading to a visible error rather than
        killing the stream.

        Belt and braces alongside `_json_safe`: any future field that cannot be
        encoded costs the user *this* result's presentation, not the whole run
        and not the results already delivered."""
        try:
            return line({"type": "result", "item": item})
        except Exception as e:
            logging.exception("Result serialisation failed for %s", label)
            return line({"type": "result_error", "label": str(label),
                         "message": ("This paper was assessed and saved to the ledger, but its "
                                     "result could not be displayed. It appears in Analytics.")})

    def line(obj):
        # json.dumps with the default encoder raises TypeError on numpy scalars
        # (float32, int64, bool_), arrays, sets, datetimes and Decimals — all of
        # which reach this payload from the scoring path, which is numpy-based.
        #
        # This generator has no exception handling around it, so that TypeError
        # killed the stream *after* the paper was written to the database: the
        # result appeared in the leaderboard and analytics while the Assessment
        # Results panel stayed empty, with nothing in the browser to indicate
        # anything had gone wrong. Serialisation must never be able to discard a
        # completed assessment.
        return json.dumps(obj, default=_json_safe) + "\n"


    # --- Keeping the stream alive -----------------------------------------
    #
    # Processing one paper is a single blocking call that can run for minutes:
    # extraction, then the model panel, then enrichment. The generator emits
    # "Analyzing X..." immediately before it and nothing at all until it
    # returns, so for that whole window the response body is silent.
    #
    # A silent body is what gets a streaming connection dropped. Proxies, load
    # balancers and browsers all reap connections that have sent nothing for a
    # while, and when that happens the client sees a bare "network error" mid-
    # run while the server carries on none the wiser — which is exactly the
    # failure being reported: a long "Analyzing…", then a lost connection, and
    # nothing in the server log because the server did not fail.
    #
    # So the work runs on a thread and the generator emits a heartbeat every
    # few seconds while it waits. Bytes keep flowing, nothing along the path
    # sees an idle connection, and the client gets an honest elapsed time
    # instead of a frozen line.
    def run_with_heartbeat(label, fn, *args, **kwargs):
        """Run `fn` off-thread, yielding heartbeat lines until it finishes.

        Yields (payload_line_or_None, result_or_MISSING) pairs: the caller
        forwards the lines and takes the result from the final pair.
        """
        started = time.time()
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            future = pool.submit(fn, *args, **kwargs)
            while True:
                try:
                    yield None, future.result(timeout=HEARTBEAT_SECONDS)
                    return
                except concurrent.futures.TimeoutError:
                    yield line({
                        "type": "heartbeat",
                        "label": label,
                        "elapsed": int(time.time() - started),
                        "message": f"Still analyzing {label}…",
                    }), None
        finally:
            # wait=False: the result has already been taken, or the client has
            # gone and nothing is waiting for it.
            pool.shutdown(wait=False)

    # A missing profile is normal (anonymous users have none); it only frames
    # the wording of the diagnostic summary and never changes the findings.
    researcher_profile = researcher_profile or {}

    fee = active_fee

    def refund_if_duplicate(item, label):
        """Return the fee when a submission turned out to be a paper we have.

        The fee buys an assessment. A duplicate consumes no model calls, mints
        nothing and creates no new record, so charging for it would be charging
        for work that did not happen — and the result panel says in plain words
        that no fee was taken, which has to be true rather than reassuring.
        """
        if not item.get("duplicate") or not charge_fees or not item.get("fee_charged"):
            return
        amount = float(item.get("fee_charged") or 0.0)
        if amount <= 0:
            return
        if refund_piq_fee(amount, fee_wallet, fee_orcid,
                          eval_hash=item.get("eval_hash", ""),
                          reason=f"Duplicate submission — {str(label)[:100]}"):
            item["fee_charged"] = 0.0
            bal = get_piq_balance(fee_wallet, fee_orcid)
            yield line({"type": "fee", "amount": 0.0, "balance": bal["balance"],
                        "message": (f"Already assessed — {amount:.4f} piQ returned. "
                                    f"Balance: {bal['balance']:.2f} piQ.")})
        else:
            logging.warning("Duplicate refund failed for %s", item.get("eval_hash", "")[:12])

    def take_fee(label: str, word_count: int = 0):
        """Returns (ok, ndjson_lines_to_emit).

        Priced per document: a thesis costs more to process than a four-page
        note, and charging both the same was neither honest nor sustainable.
        The floor keeps a trivial submission from being free.
        """
        nonlocal fee
        pricing = compute_document_fee(word_count, count_assessed_papers(), PIQ_PROCESSING_FEE)
        fee = pricing["fee"]
        if not charge_fees or fee <= 0:
            return True, []
        if charge_piq_fee(fee, fee_wallet, fee_orcid, reason=f"Processing fee — {label[:120]}"):
            bal = get_piq_balance(fee_wallet, fee_orcid)
            return True, [line({
                "type": "fee",
                "message": (f"Charged {fee:.4f} piQ ({pricing['size_band']}). "
                            f"Remaining balance: {bal['balance']:.2f} piQ."),
                "amount": fee, "balance": bal["balance"], "pricing": pricing,
            })]
        bal = get_piq_balance(fee_wallet, fee_orcid)
        return False, [line({
            "type": "fee_error",
            "message": (
                f"Insufficient piQ balance to process '{label[:80]}'. "
                f"This paper costs {fee:.4f} piQ ({pricing['size_band']}); "
                f"your balance is {bal['balance']:.2f} piQ."
            ),
            "balance": bal["balance"], "required": fee,
        })]

    def reward_notice(item, label):
        """One explicit line per paper about what it earned, and why.

        The result card showed "piQ 0.00" and nothing else. Zero is a valid
        outcome — unverified authorship, or a score below the minting
        threshold — but presented as a bare number it is indistinguishable
        from a bug, and the explanation the pipeline had already computed
        (including the instructions for fixing it) was sitting unread in the
        payload. Earning nothing has to be as legible as earning something.
        """
        emission_rec = item.get("emission") or {}
        attribution = emission_rec.get("attribution") or {}
        minted = safe_float(item.get("piq"), 0.0)

        if minted > 0:
            return [line({
                "type": "reward",
                "outcome": "minted",
                "amount": minted,
                "tier": attribution.get("tier"),
                "message": (
                    f"{minted:.2f} piQ minted for '{str(label)[:60]}'. "
                    + (attribution.get("reason") or "")
                ),
            })]

        # Nothing minted. Say which of the two reasons applies.
        if not attribution.get("verified"):
            return [line({
                "type": "reward",
                "outcome": "withheld_authorship",
                "amount": 0.0,
                "message": (attribution.get("reason")
                            or "Authorship could not be verified, so no piQ was minted."),
                "how_to_fix": attribution.get("how_to_verify"),
            })]

        return [line({
            "type": "reward",
            "outcome": "below_threshold",
            "amount": 0.0,
            "message": (emission_rec.get("reason")
                        or "This paper did not meet the minting threshold, so no piQ was minted."),
        })]

    def award_curation(item, label):
        """Credit a curation reward when the submitter is not the author.

        Runs only when authorship verification came back negative — that is
        precisely the case where full emission is withheld, and where the
        submitter has still done real work by putting a paper through the
        pipeline. Returns the ndjson lines to emit, which is empty when
        nothing is awarded.
        """
        if not (fee_wallet or fee_orcid):
            item["curation"] = {
                "awarded": 0.0, "eligible": False,
                "reason": ("Curation rewards are credited to an account. Sign in with a wallet or "
                           "ORCID before running the pipeline and submitting other people's "
                           "papers earns piQ."),
            }
            return []
        emission_rec = item.get("emission") or {}
        attribution = emission_rec.get("attribution") or {}
        # Authors get the full on-chain emission; this path is only for the
        # unverified case, so the two rewards can never both apply.
        if attribution.get("verified"):
            return []

        stats = get_curation_stats(fee_wallet, fee_orcid)
        reward = compute_curation_reward(
            pix_score=safe_float(item.get("score"), 0.0),
            logic_integrity=safe_float(item.get("logic_integrity"), 0.0),
            total_papers=count_assessed_papers(),
            curation_count=stats["count"],
            curation_earned=stats["earned"],
        )
        # Every outcome is reported, including the ones that pay nothing.
        # Previously an ineligible reward wrote its reason into the payload and
        # emitted no line, so from the browser a curation reward that correctly
        # declined to pay and one that silently failed looked identical — which
        # is why "the curation reward doesn't work" was indistinguishable from
        # "the curation reward decided not to pay this time".
        if not reward.get("eligible"):
            item["curation"] = reward
            return [line({
                "type": "curation",
                "amount": 0.0,
                "awarded": False,
                "balance": get_piq_balance(fee_wallet, fee_orcid)["balance"],
                "message": reward.get("reason") or "No curation reward for this paper.",
            })]

        eval_hash = item.get("eval_hash", "")
        already = bool(eval_hash) and get_curation_award_for(
            fee_wallet, fee_orcid, eval_hash)
        credited = credit_curation_reward(
            reward["awarded"], fee_wallet, fee_orcid,
            eval_hash=eval_hash, note=str(label)[:80],
        )
        if not credited:
            # Two different failures used to share one message. "You already
            # earned this" is a correct, final answer; a database error is a
            # bug the user should be told about rather than have explained away
            # as something they did.
            reason = ("You have already earned a curation reward for this manuscript. "
                      "Resubmitting a paper does not earn it twice."
                      if already else
                      "The curation reward could not be credited to your account. This is a "
                      "fault on our side, not a rule — please report it.")
            reward = {**reward, "awarded": 0.0, "eligible": False, "reason": reason}
            item["curation"] = reward
            return [line({
                "type": "curation", "amount": 0.0, "awarded": False,
                "balance": get_piq_balance(fee_wallet, fee_orcid)["balance"],
                "message": reason,
            })]

        item["curation"] = reward
        bal = get_piq_balance(fee_wallet, fee_orcid)
        add_log(f"Curation reward {reward['awarded']:.4f} piQ for {str(label)[:60]}")
        return [line({
            "type": "curation",
            "amount": reward["awarded"],
            "awarded": True,
            "balance": bal["balance"],
            "message": reward["reason"],
        })]

    # No refund path is needed any more: a paper is priced and charged only
    # after its bytes have been retrieved, so a retrieval failure never
    # incurred a fee in the first place. Refunding something never charged was
    # the previous design and was one accounting step more than necessary.

    yield line({"type": "status", "message": "Initializing assessment pipeline..."})
    if charge_fees and fee > 0:
        bal = get_piq_balance(fee_wallet, fee_orcid)
        yield line({"type": "status", "message":
                    f"Processing fee: {fee:.2f} piQ per paper. Available balance: {bal['balance']:.2f} piQ."})

    if include_doi and doi and doi.strip():
        doi = doi.strip()
        yield line({"type": "status", "message": f"Resolving DOI: {doi}..."})
        pdf_bytes, attempts = retrieve_manuscript_bytes(doi=doi)

        if pdf_bytes:
            # Retained exactly as an upload is. Only uploaded files used to be
            # stored, so a paper fetched by DOI could never be LLM-reviewed,
            # published, or served to a reader — three features silently
            # unavailable depending on how the paper happened to arrive. The
            # bytes are here and identical in kind; the only reason they were
            # not kept is that this path was written separately from the
            # upload path. Failures are swallowed inside store_paper: losing
            # the file must never fail a run that has been charged for.
            paper_store.store_paper(pdf_bytes)
            # Priced after retrieval so the fee reflects the actual document,
            # and so nothing is charged for a paper that could not be fetched.
            ok, msgs = take_fee(f"DOI {doi}", estimate_word_count(pdf_bytes))
            for m in msgs:
                yield m
            if not ok:
                yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
                return
            yield line({"type": "status", "message": "Assessing document..."})
            res = None
            for hb, out in run_with_heartbeat(
                    f"DOI {doi}", process_single_pdf, pdf_bytes, f"DOI_{doi}.pdf", "",
                    user_id, book_address, provided_doi=doi):
                if hb:
                    yield hb
                else:
                    res = out
            if res:
                item = build_result_payload(res, f"DOI_{doi}.pdf", profile=researcher_profile)
                item["fee_charged"] = fee if charge_fees else 0.0
                for m in refund_if_duplicate(item, f"DOI {doi}"):
                    yield m
                for m in award_curation(item, f"DOI {doi}"):
                    yield m
                for m in reward_notice(item, f"DOI {doi}"):
                    yield m
                add_log(f"Assessed DOI {doi}: score {_fmt_score(item.get('score'))}")
                yield emit_result(item, f"DOI {doi}")
        else:
            yield line({"type": "download_error", "doi": doi,
                        "url": f"https://doi.org/{doi}", "attempts": attempts})

    for paper in discover_papers:
        title = (paper.get("title") or "Untitled").strip()
        p_doi = (paper.get("doi") or "").strip()
        pdf_url = (paper.get("pdf_url") or "").strip()

        yield line({"type": "status", "message": f"Retrieving open-access paper: {title[:80]}..."})
        pdf_bytes, attempts = retrieve_manuscript_bytes(
            doi=p_doi, pdf_url=pdf_url, candidates=paper.get("pdf_candidates"))

        fname = f"Discovered_{p_doi or title[:60]}.pdf"
        if pdf_bytes:
            # Same reasoning as the DOI path above: an auto-discovered paper is
            # a retrieved PDF like any other, and keeping it is what makes the
            # assessment reviewable and publishable later.
            paper_store.store_paper(pdf_bytes)
            ok, msgs = take_fee(title, estimate_word_count(pdf_bytes))
            for m in msgs:
                yield m
            if not ok:
                yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
                return
            yield line({"type": "status", "message": f"Assessing: {title[:80]}..."})
            res = None
            for hb, out in run_with_heartbeat(
                    fname, process_single_pdf, pdf_bytes, fname, "", user_id,
                    book_address, provided_doi=p_doi or "None"):
                if hb:
                    yield hb
                else:
                    res = out
            if res:
                item = build_result_payload(res, fname, profile=researcher_profile)
                item["fee_charged"] = fee if charge_fees else 0.0
                for m in refund_if_duplicate(item, title):
                    yield m
                for m in award_curation(item, title):
                    yield m
                for m in reward_notice(item, title):
                    yield m
                add_log(f"Assessed discovered paper '{title[:60]}': score {_fmt_score(item.get('score'))}")
                yield emit_result(item, fname)
        else:
            yield line({"type": "download_error", "doi": p_doi or title,
                        "title": title,
                        "url": f"https://doi.org/{p_doi}" if p_doi else "",
                        "attempts": attempts})

    for fname, raw_bytes in files:
        ok, msgs = take_fee(fname, estimate_word_count(raw_bytes))
        for m in msgs:
            yield m
        if not ok:
            yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
            return

        yield line({"type": "status", "message": f"Analyzing {fname}..."})
        res = None
        for hb, out in run_with_heartbeat(
                fname, process_single_pdf, raw_bytes, fname, "", user_id, book_address):
            if hb:
                yield hb
            else:
                res = out
        if res:
            item = build_result_payload(res, fname, profile=researcher_profile)
            item["fee_charged"] = fee if charge_fees else 0.0
            for m in refund_if_duplicate(item, fname):
                yield m
            for m in award_curation(item, fname):
                yield m
            for m in reward_notice(item, fname):
                yield m
            add_log(f"Assessed {fname}: score {_fmt_score(item.get('score'))}")
            yield emit_result(item, fname)

    yield line({"type": "done", "message": "Complete."})


# Seconds between stream heartbeats while one paper is being processed.
# Short enough to stay under any reasonable proxy idle timeout, long
# enough that it costs nothing.
HEARTBEAT_SECONDS = int(os.getenv("STREAM_HEARTBEAT_SECONDS", "10"))

# Ceiling on verifying a journal DOI against the registries. Generous
# enough for a slow-but-working Crossref, short enough that an
# unreachable one is reported rather than waited out.
JOURNAL_CHECK_BUDGET_SECONDS = int(os.getenv("JOURNAL_CHECK_BUDGET_SECONDS", "25"))

MAX_DISCOVERY_BATCH = 10


@router.post("/api/assess/stream")
async def assess_stream(
    request: Request,
    files: List[UploadFile] = File(default=[]),
    doi: str = Form(default=""),
    include_doi: bool = Form(default=False),
    discover_papers: str = Form(default=""),  # JSON-encoded array of {title, doi, pdf_url}
    wallet: str = Form(default=""),
    orcid: str = Form(default=""),
    pow_challenge_id: str = Form(default=""),
    pow_issued_at: str = Form(default="0"),
    pow_difficulty: str = Form(default="0"),
    pow_signature: str = Form(default=""),
    pow_solution: str = Form(default=""),
    turnstile_token: str = Form(default=""),
):
    client_ip = get_client_ip(request)
    check_rate_limit(client_ip, bucket="assess")

    # File the paper under the PROVEN identity, not the one the browser claimed.
    #
    # This is why a completed assessment never reached "Your assessments". The
    # pipeline stored `user_id` from the raw posted wallet/orcid, while the
    # history endpoint reads back under the identity the SESSION proves — so
    # the moment those two disagreed, the paper was filed in a bucket the
    # history query could not see. And they disagree routinely: a browser that
    # remembers an ORCID in localStorage posts it alongside a wallet-only
    # session, `user_id` becomes that unproven ORCID, and history looks for the
    # wallet. The assessment ran, was charged for, and vanished.
    #
    # It is the same fix already applied to arcade rewards, for the same
    # reason: whatever writes a record and whatever reads it back have to agree
    # on who you are, and only the signed session actually knows.
    identity = auth.identity_from_request(request, wallet, orcid)
    if identity["verified"] and (identity["wallet"] or identity["orcid"]):
        wallet = identity["wallet"] or ""
        orcid = identity["orcid"] or ""

    has_web3 = bool(wallet and w3.is_address(wallet))
    user_id = orcid if orcid else (wallet if has_web3 else "Anonymous")
    book_address = w3.to_checksum_address(wallet) if has_web3 else "0x0000000000000000000000000000000000000000"

    # Loaded once per submission rather than per paper: it frames the wording
    # of the diagnostic summary, and re-reading it for every paper in a batch
    # would be a query per document for a value that cannot change mid-run.
    # A missing profile is normal (anonymous users have none) and simply
    # leaves the diagnostic unframed — it never changes the findings.
    try:
        researcher_profile = get_researcher_profile(_profile_key(wallet, orcid))
    except Exception as e:
        logging.debug("Profile lookup failed, continuing without it: %s", e)
        researcher_profile = {}

    discover_list = []
    if discover_papers.strip():
        try:
            parsed = json.loads(discover_papers)
            if not isinstance(parsed, list):
                raise ValueError("discover_papers must be a JSON array")
            if len(parsed) > MAX_DISCOVERY_BATCH:
                raise HTTPException(status_code=400, detail=f"Too many auto-discovered papers selected (max {MAX_DISCOVERY_BATCH} per run).")
            for p in parsed:
                if not isinstance(p, dict):
                    continue
                discover_list.append({
                    "title": str(p.get("title", ""))[:300],
                    "doi": str(p.get("doi", ""))[:200],
                    "pdf_url": str(p.get("pdf_url", ""))[:1000],
                    "pdf_candidates": [str(u)[:1000] for u in (p.get("pdf_candidates") or [])][:5],
                })
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="discover_papers must be valid JSON.")

    # Server-side free-trial gate — the browser's localStorage counter is a
    # convenience for the UI, not a security boundary (a user can clear it
    # trivially). This is the authoritative check.
    free_trial_active = not has_web3 and not orcid

    max_bytes = int(MAX_UPLOAD_MB * 1024 * 1024)
    file_payload, fingerprints = [], []
    for f in files:
        if f.content_type and f.content_type not in ("application/pdf", "application/octet-stream"):
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is not a PDF file.")
        raw = await f.read()
        # Structural validation before any paid inference: a renamed .txt or a
        # truncated download should be rejected here, not after it has consumed
        # LLM credits.
        valid, why = abuse_guard.validate_upload(f.filename, raw, max_bytes)
        if not valid:
            raise HTTPException(status_code=400, detail=why)
        file_payload.append((f.filename, raw))
        fingerprints.append(abuse_guard.document_fingerprint(raw))
        # Retained so a published assessment can serve the manuscript it is an
        # assessment OF. Keyed by sha256 of the bytes, which is the same value
        # brain.py uses for eval_hash — so the file is addressable from the
        # assessment with no extra bookkeeping. Storage failures are swallowed
        # inside store_paper: losing the file must never fail a paid run.
        paper_store.store_paper(raw)

    # DOI and discovery submissions are fingerprinted by identifier, since
    # their bytes are not available until retrieval.
    if include_doi and doi.strip():
        fingerprints.append(abuse_guard.document_fingerprint(doi.strip().lower().encode()))
    for entry in discover_list:
        key = (entry.get("doi") or entry.get("title") or "").strip().lower()
        if key:
            fingerprints.append(abuse_guard.document_fingerprint(key.encode()))

    # Layered abuse controls. Velocity limits apply to everyone; free-tier
    # metering and automation heuristics apply only to unidentified visitors,
    # since identified users pay in piQ and that is its own control.
    # Proof of work, for anonymous submissions only. Identified users have
    # already paid in piQ, which is a stronger control than any puzzle.
    if REQUIRE_PROOF_OF_WORK and not (has_web3 or orcid):
        ok, why = pow_challenge.verify_solution(
            ip=client_ip, challenge=pow_challenge_id, issued_at=pow_issued_at,
            difficulty=pow_difficulty, signature=pow_signature, solution=pow_solution,
        )
        if not ok:
            raise HTTPException(status_code=428, detail=f"Verification required: {why}")
        ok, why = pow_challenge.verify_turnstile(turnstile_token, client_ip)
        if not ok:
            raise HTTPException(status_code=428, detail=why)

    verdict = abuse_guard.evaluate_request(
        ip=client_ip,
        headers={k.lower(): v for k, v in request.headers.items()},
        documents_used=get_free_evals_used(client_ip),
        fingerprints=fingerprints,
        has_identity=bool(has_web3 or orcid),
        # Bonus no longer extends the trial; passed as 0 so the parameter stays
        # in the signature for any caller that still supplies one.
        bonus=0,
    )
    if not verdict["allowed"]:
        add_log(f"Blocked submission from {client_ip}: {verdict['reason'][:100]}")
        raise HTTPException(status_code=verdict["code"], detail=verdict["reason"])

    paper_count = len(file_payload) + len(discover_list) + (1 if (include_doi and doi.strip()) else 0)

    # piQ processing fee. Identified users pay PIQ_PROCESSING_FEE per paper
    # out of their earned balance; users still on the free trial don't, since
    # they have no balance yet and the trial exists precisely to let them earn
    # their first piQ.
    fee_wallet, fee_orcid = normalize_identity(wallet, orcid)
    active_fee = resolve_active_fee()
    charge_fees = bool((fee_wallet or fee_orcid) and not free_trial_active and active_fee > 0)

    if charge_fees and paper_count:
        bal = get_piq_balance(fee_wallet, fee_orcid)
        required = round(active_fee * paper_count, 4)
        if bal["balance"] + 1e-9 < active_fee:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Insufficient piQ balance. Processing costs {active_fee:.4f} piQ per paper "
                    f"and your balance is {bal['balance']:.2f} piQ. Earn piQ by having your own "
                    f"manuscripts assessed."
                ),
            )
        if bal["balance"] + 1e-9 < required:
            affordable = int(bal["balance"] // active_fee)
            add_log(
                f"Partial batch: balance {bal['balance']:.2f} piQ covers {affordable}/{paper_count} papers."
            )

    if free_trial_active and paper_count:
        # Metered per distinct document, so a resubmission costs no allowance.
        abuse_guard.register_documents(client_ip, fingerprints)
        for _ in range(max(1, len(fingerprints))):
            increment_free_evals_used(client_ip)

    # Assessing resets the arcade difficulty ramp. This is the exchange the
    # ramp exists to create: the game hands out assessment allowance, so the
    # way to make it winnable again is to spend that allowance on an
    # assessment. Reset happens at submission rather than on success, because
    # the user has committed the paper by this point and a provider failure
    # downstream is not their fault.
    if paper_count:
        try:
            arcade_player_key, _ = _arcade_key(request, wallet, orcid)
            if reset_arcade_difficulty(arcade_player_key):
                add_log("Arcade difficulty reset to level 0 after an assessment.")
        except Exception as e:
            logging.debug("Arcade difficulty reset skipped: %s", e)

    def gen():
        """Wraps the assessment stream so a failure is *visible*.

        This generator previously had no exception handling anywhere in it.
        Because assessment writes to the database before it yields the result,
        any exception raised after that write — a serialisation failure, a bad
        index, a provider client blowing up — ended the HTTP stream silently.
        The browser saw a connection that simply stopped: no error, no result,
        while the paper sat in the leaderboard. Every diagnosis of that
        behaviour was guesswork because nothing anywhere recorded the cause.

        Now the traceback is logged server-side with a short reference, and a
        terminal `stream_error` line is emitted so the UI can say that the run
        failed and quote the reference, instead of appearing to hang.
        """
        try:
            yield from stream_assessment_progress(
                file_payload, doi, include_doi, discover_list, user_id, book_address,
                fee_wallet=fee_wallet, fee_orcid=fee_orcid, charge_fees=charge_fees,
                active_fee=active_fee, researcher_profile=researcher_profile,
            )
        except Exception as exc:
            ref = uuid.uuid4().hex[:8]
            logging.exception("Assessment stream failed [ref %s]", ref)
            add_log(f"Assessment stream failed [ref {ref}]: {type(exc).__name__}: {exc}")
            detail = f"{type(exc).__name__}: {exc}" if ENVIRONMENT != "production" else ""
            try:
                yield json.dumps({
                    "type": "stream_error",
                    "reference": ref,
                    "detail": detail,
                    "message": ("The assessment stopped unexpectedly. Any paper that finished "
                                "before this point was saved and appears in Analytics. "
                                f"Server log reference: {ref}."),
                }, default=_json_safe) + "\n"
            except Exception:
                pass

    return StreamingResponse(gen(), media_type="application/x-ndjson")
