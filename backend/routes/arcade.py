"""routes/arcade.py: the Science Map arcade: runs, field papers, leaderboard, scoring. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import _arcade_key, _display_name, _profile_key  # noqa: F401
from routes.piq import normalize_identity, piq_fields  # noqa: F401

router = APIRouter()



@router.get("/api/arcade/start")
def arcade_start(request: Request, wallet: str = Query(default=""),
                 orcid: str = Query(default="")):
    """Issues a signed, seeded bubble field for one run."""
    ip = get_client_ip(request)
    # Snapshot the live corpus so the playfield reflects the real body of
    # assessed work. On a fresh database this is empty and the map falls back
    # to the default taxonomy — the game must be playable before paper one.
    try:
        corpus = get_field_corpus_stats(limit=arcade.OVERLAY_MAX_FIELDS)
    except Exception as e:
        logging.warning("Science Map corpus snapshot failed, using taxonomy only: %s", e)
        corpus = []
    try:
        totals = get_corpus_totals()
    except Exception as e:
        logging.warning("Corpus totals failed: %s", e)
        totals = {"papers": 0, "classified": 0, "unclassified": 0}
    player_key, is_identity = _arcade_key(request, wallet, orcid)
    progress = get_arcade_progress(player_key)
    session = arcade.start_session(ip, corpus_stats=corpus, corpus_totals=totals,
                                   level=progress["difficulty_level"])
    state = get_bonus_award_state(ip)
    session["wallet_state"] = {
        "bonus_earned": state["bonus"],
        "cap": arcade.BONUS_CAP,
        "cooldown_remaining": arcade.cooldown_remaining(state["last_award"]),
    }
    session["progress"] = {
        **progress,
        "is_identity": is_identity,
        # Said plainly rather than left for the player to infer from repeated
        # failure. An unwinnable field is a designed state, not a bug, and it
        # has an explicit way out.
        "reset_hint": (
            "This field can no longer be won at your current difficulty. Assess a manuscript "
            "to reset it to level 0."
            if not session["difficulty"]["winnable"] else
            "Each win raises the difficulty. Assessing a manuscript resets it."
        ),
    }
    return session


class ArcadeRun(BaseModel):
    token: str
    duration_ms: int
    absorbed: List[dict] = []
    wallet: str = ""
    orcid: str = ""


@router.get("/api/arcade/field-papers")
def arcade_field_papers(field: str = Query(default=""),
                        limit: int = Query(default=50, ge=1, le=200)):
    """The assessed papers inside one field of the Science Map.

    The map shows a field as a bubble whose size encodes how much work sits in
    it, but there was no way to get from the bubble to the work itself — the
    number was the whole answer. This is what makes a bubble openable: click a
    field, read what is actually in it.
    """
    name = (field or "").strip()
    if not name:
        return {"field": "", "papers": [], "count": 0}

    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT eval_hash, title, author_name, final_score, piq_minted,
                      fields, timestamp, doi, piq_escrowed, piq_claimed_at
               FROM papers_assessment
               WHERE final_score IS NOT NULL
               ORDER BY final_score DESC LIMIT 400""").fetchall()
    except sqlite3.Error:
        raise HTTPException(status_code=503, detail="The corpus could not be read.")
    finally:
        conn.close()

    # Matched in Python rather than with SQL LIKE: `fields` is a JSON array, so
    # a LIKE '%Physics%' would also match "Astrophysics" and "Physics
    # Education" — a bubble listing papers that belong to a different field is
    # worse than one that lists none.
    wanted = name.lower()
    out = []
    for r in rows:
        try:
            paper_fields = [f.strip() for f in json.loads(r[5] or "[]") if f and f.strip()]
        except (ValueError, TypeError):
            paper_fields = []
        if not any(f.lower() == wanted for f in paper_fields):
            continue
        out.append({
            "hash": r[0], "title": r[1] or "Untitled",
            "author": clean_author_name(r[2]), "score": round(safe_float(r[3], 0.0), 1),
            **piq_fields(r[4], r[8], r[9]), "date": (r[6] or "")[:10],
            # real_doi(): the column holds the string "None" for a paper with
            # no DOI, and shipping that renders a DOI chip that reads "None".
            "doi": real_doi(r[7]),
        })
        if len(out) >= limit:
            break

    return {"field": name, "papers": out, "count": len(out)}


@router.get("/api/arcade/leaderboard")
def arcade_leaderboard_endpoint(limit: int = Query(default=20, ge=1, le=100)):
    """Top Science Map players. Signed-in identities only."""
    return {"leaderboard": arcade_leaderboard(limit=limit),
            "note": ("Ranked by best run mass. Only signed-in players appear — an anonymous "
                     "player is keyed to a hashed IP, which is not a person and changes when "
                     "they reconnect.")}


@router.post("/api/arcade/finish")
def arcade_finish(payload: ArcadeRun, request: Request):
    """Verifies a completed run and grants allowance if it was a legitimate win."""
    ip = get_client_ip(request)
    # The reward is bounded by a cooldown and a lifetime cap, but the WORK was
    # not: every submission makes the server regenerate a 90-bubble field and
    # replay the run. Cheap once, a denial-of-service in a loop.
    check_rate_limit(ip, bucket="arcade")
    result = arcade.verify_run(ip, payload.token, payload.absorbed, payload.duration_ms)
    player_key, is_identity = _arcade_key(request, payload.wallet, payload.orcid)

    if not result["valid"]:
        logging.info("Arcade run rejected from %s: %s", ip, result.get("reason"))
        return {**result, "granted": 0, "bonus_total": get_bonus_evals(ip)}

    # Recorded before any reward logic. A run that was played happened,
    # whether or not it won and whether or not a cooldown blocks the payout —
    # and the difficulty ramp and the leaderboard both depend on that record.
    progress = record_arcade_run(
        player_key, won=result["won"], final_mass=result.get("final_mass", 0.0),
        is_identity=is_identity, display_name=_display_name(payload.wallet, payload.orcid),
        max_level=arcade.MAX_DIFFICULTY_LEVEL,
    )
    result["progress"] = progress

    if not result["won"]:
        return {**result, "granted": 0, "bonus_total": get_bonus_evals(ip),
                "message": (f"Run recorded at mass {result['final_mass']}. "
                            f"Reach {result['win_mass']} to earn free assessments.")}

    # No time cooldown: a win is rewarded when it happens. The lifetime cap and
    # the difficulty ramp are what bound the faucet.
    # A win pays in piQ, and only in piQ.
    #
    # It used to ALSO grant free assessments, so one reward was reported twice
    # in two different units — "+3 free assessments" beside "+1.00 piQ" — and a
    # player could not say what a win was worth. piQ is what buys an
    # assessment, so the piQ credit already is the free assessment; granting
    # both was paying twice for the same thing and describing it confusingly.
    #
    # `grant` is retained as a zeroed shape rather than removed, so the
    # response keeps its fields and any older client reading `granted` sees a
    # truthful zero instead of a missing key.
    grant = {"granted": 0, "bonus": get_bonus_evals(ip)}
    
    # --- piQ reward -------------------------------------------------------
    # Credited through refund_piq_fee (a plain positive ledger entry against the
    # same normalised account keys the balance is read from) rather than a
    # hand-written INSERT. The hand-written version wrote the raw identity while
    # every balance query reads normalised keys, and it swallowed its own
    # exception — so a failed credit looked identical to a successful one and
    # the win silently never reached the balance.
    piq_reward = 0.0
    credited = False
    balance_after = None

    # Credited to the PROVEN identity from the signed session, not to the
    # wallet/orcid the browser posted.
    #
    # Those two are not always the same set, and when they diverge the piQ
    # lands in an account the user cannot see or spend: the balance endpoint
    # scopes to the session, so a win credited against a localStorage-only
    # ORCID was written to the ledger and then rendered invisible. Crediting
    # and spending have to agree on who you are, and the signed token is the
    # only thing that actually knows.
    #
    # It also closes the obvious hole in taking the account name from the
    # request body: a win claim could otherwise nominate any ORCID it liked.
    identity = auth.identity_from_request(request, payload.wallet, payload.orcid)
    signed_in = bool(identity["verified"] and (identity["wallet"] or identity["orcid"]))
    fee_wallet, fee_orcid = ("", "")
    if signed_in:
        fee_wallet, fee_orcid = normalize_identity(identity["wallet"], identity["orcid"])

    if result["won"] and (fee_wallet or fee_orcid):
        piq_reward = arcade.PIQ_PER_WIN
        before = get_piq_balance(fee_wallet, fee_orcid)["balance"]
        refund_piq_fee(piq_reward, fee_wallet, fee_orcid,
                       eval_hash="", reason="Science Map Arcade victory")
        balance_after = get_piq_balance(fee_wallet, fee_orcid)["balance"]
        # Verified against the balance the user will actually see, not against
        # the fact that an INSERT did not raise.
        credited = balance_after > before + (piq_reward / 2)
        if credited:
            add_log(f"Arcade win credited {piq_reward:.2f} piQ to "
                    f"{_profile_key(fee_wallet, fee_orcid)} (balance now {balance_after:.2f}).")
        else:
            piq_reward = 0.0
            logging.warning("Arcade piQ credit did not land for %s/%s", fee_wallet, fee_orcid)

    if grant["granted"] == 0 and not credited:
        # Say which of the two reasons applies rather than blaming the cap for
        # a signed-out session, or vice versa.
        if not signed_in:
            why = ("Sign in with a wallet or ORCID — piQ for a win is credited to a signed-in "
                   "account, and this run was submitted without a proven session. If you are "
                   "signed in, re-link and play again.")
        else:
            why = ("The piQ credit did not go through. Nothing was taken from you — "
                   "play again, and please report it if it keeps happening.")
        return {**result, "granted": 0, "bonus_total": grant["bonus"],
                "piq_awarded": 0.0, "piq_balance": balance_after, "signed_in": signed_in,
                "message": "You won, but nothing could be credited for it. " + why}

    logging.info("Arcade win from %s credited %s piQ (difficulty now %s)",
                 ip, piq_reward, progress["difficulty_level"])

    earned = f"{piq_reward:.2f} piQ" if credited else "nothing"

    return {**result, "granted": grant["granted"], "bonus_total": grant["bonus"],
            "piq_awarded": piq_reward if credited else 0.0,
            "piq_balance": balance_after, "signed_in": signed_in,
            "message": (f"Victory! {earned} credited to your account."
                        + (f" Your piQ balance is now {balance_after:.2f}."
                           if credited and balance_after is not None else "")
                        + (" Sign in with a wallet or ORCID to earn piQ for wins too."
                           if not signed_in else "")
                        + f" Difficulty is now level {progress['difficulty_level']} — assess a "
                        f"manuscript to reset it.")}
