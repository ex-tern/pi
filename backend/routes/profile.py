"""routes/profile.py: the researcher profile and the Research Buddy. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import _identity_values, _profile_key  # noqa: F401

router = APIRouter()





class ResearcherProfile(BaseModel):
    wallet: str = ""
    orcid: str = ""
    field: str = ""
    career_stage: str = ""
    goal: str = ""
    idea: str = ""
    abstract: str = ""


@router.get("/api/buddy")
def research_buddy(wallet: str = Query(default=""), orcid: str = Query(default=""),
                   hashes: str = Query(default=""),
                   background: BackgroundTasks = None):
    """riB — the researcher's stated fields against the live corpus.

    The analysis lives in rib_engine, which takes data and returns a report.
    This handler only fetches and hands over, so the engine can be tested
    without a database and its output is a pure function of its input.
    """
    key = _profile_key(wallet, orcid)
    if not key:
        return {"available": False, "reason": "Sign in to get tailored guidance."}

    profile = get_researcher_profile(key)
    try:
        corpus = get_field_corpus_stats(limit=60)
    except Exception as e:
        logging.warning("riB corpus read failed: %s", e)
        corpus = []

    # riB reads ONLY the papers the researcher has ticked.
    #
    # It previously fell back to the whole corpus when nothing was selected,
    # which meant its guidance was assembled from other people's work and
    # presented as though it were about yours. Reading nothing and saying so is
    # the honest version: an empty selection is not a request for advice about
    # everything, it is the absence of a request.
    selected = [h.strip() for h in (hashes or "").split(",") if h.strip()][:200]
    if not selected:
        return {
            "available": False,
            "needs_selection": True,
            "reason": ("Tick the papers you want the ResBD to read, under Your "
                       "assessments. It reasons only from the papers you choose, so it never "
                       "gives you advice assembled from someone else's work."),
            "profile": profile,
        }

    fields = rib_engine.parse_fields(profile)
    try:
        # The selection is the statement of scope, so the stated-fields filter
        # is not applied on top of it — that would silently drop papers the
        # researcher had just deliberately ticked.
        candidates = get_papers_for_recommendation(fields=None, hashes=selected)
        # The profile's fields are passed so riB can separate papers it cannot
        # judge against the reader's work from ones it can.
        picks = diagnostics.recommend_papers(candidates, user_fields=fields)
        picks["scope"] = f"{len(candidates)} selected paper{'' if len(candidates) == 1 else 's'}"
        picks["selection_active"] = True
        picks["selection_count"] = len(candidates)
    except Exception as e:
        logging.warning("riB recommendations failed: %s", e)
        picks = {"available": False, "reason": "Recommendations unavailable.",
                 "recommended": [], "caution": []}

    report = rib_engine.build_report(profile, corpus, picks)
    report["profile"] = profile

    # Teach the relevance ranker, AFTER the response has gone out.
    #
    # Tutoring calls a model, which is slow and can fail; the report the user
    # is waiting for must not depend on either. It is also self-limiting —
    # rib_engine.tutor_phase_active() returns False once real feedback is
    # sufficient or the daily cap is reached — so this becomes a no-op on a
    # deployment that has outgrown it, without anything here changing.
    try:
        if background is not None and rib_engine.tutor_phase_active():
            background.add_task(rib_engine.tutor_from_llm, candidates, profile, corpus)
        report["tutor"] = rib_engine.tutor_status()
    except Exception as e:                                   # noqa: BLE001
        logging.warning("riB tutoring could not be scheduled: %s", e)

    return report


@router.get("/api/buddy/suggest")
def research_buddy_suggest(wallet: str = Query(default=""), orcid: str = Query(default="")):
    """RiBD's two suggestions for this profile: a paper from the ledger
    explorer and a scanned manuscript (see rib_suggest). Only public ledger
    data is returned (title, author, fields, piX, date), the same the explorer
    already shows; the researcher's own papers are left out."""
    key = _profile_key(wallet, orcid)
    if not key:
        return {"available": False, "reason": "Sign in to get suggestions."}
    profile = get_researcher_profile(key)
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT p.eval_hash, p.title, p.author_name, p.fields, p.final_score, p.timestamp,
                      p.user_id, b.block_height, p.piq_minted
               FROM papers_assessment p
               LEFT JOIN blockchain_por_weights b ON p.eval_hash = b.eval_hash
               WHERE p.final_score IS NOT NULL AND COALESCE(p.title, '') <> ''
               ORDER BY p.timestamp DESC LIMIT 2000""").fetchall()
    except sqlite3.Error as e:
        logging.warning("RiBD suggest read failed: %s", e)
        return {"available": False, "reason": "Suggestions are unavailable right now."}
    finally:
        conn.close()
    mine = set(_identity_values(wallet, orcid))
    own = {r[0] for r in rows if r[6] and r[6] in mine}
    data = [{"eval_hash": r[0], "title": r[1], "author": clean_author_name(r[2]), "fields": r[3],
             "score": r[4], "timestamp": r[5], "on_ledger": r[7] is not None, "piq": r[8] or 0.0}
            for r in rows]
    out = rib_suggest.suggest(profile, data, own)
    out["available"] = True
    return out


@router.get("/api/profile")
def read_profile(wallet: str = Query(default=""), orcid: str = Query(default="")):
    """The stored researcher profile for this identity."""
    key = _profile_key(wallet, orcid)
    if not key:
        return {"stored": False, "profile": {},
                "reason": "Connect a wallet or link ORCID to save a profile."}
    profile = get_researcher_profile(key)
    return {"stored": bool(profile), "profile": profile}


@router.post("/api/profile")
def write_profile(payload: ResearcherProfile, request: Request):
    """Saves the researcher profile used to frame diagnostics."""
    check_rate_limit(get_client_ip(request), bucket="profile")
    key = _profile_key(payload.wallet, payload.orcid)
    if not key:
        raise HTTPException(
            status_code=400,
            detail="A wallet or ORCID is required to save a profile. Your draft is kept in "
                   "this browser until you connect one.")
    saved = save_researcher_profile(key, payload.dict())
    return {"stored": True, "profile": saved}


class ProfileSlotRequest(ResearcherProfile):
    """A named profile. Inherits the profile fields so the two forms cannot drift."""
    name: str = ""
    slot_id: Optional[int] = None


@router.get("/api/profiles")
def list_profiles(request: Request, wallet: str = Query(default=""),
                  orcid: str = Query(default="")):
    """Every named profile this identity has saved.

    A researcher working across two unrelated projects was previously forced
    to overwrite one description with the other, so the diagnostics framed
    every paper against whichever project they had described most recently.
    """
    key = _profile_key(wallet, orcid)
    if not key:
        return {"signed_in": False, "profiles": [], "max": MAX_PROFILE_SLOTS}
    return {"signed_in": True, "profiles": list_profile_slots(key),
            "max": MAX_PROFILE_SLOTS}


@router.post("/api/profiles")
def write_profile_slot(payload: ProfileSlotRequest, request: Request):
    """Create or update a named profile, and make it the active one."""
    check_rate_limit(get_client_ip(request), bucket="profile")
    key = _profile_key(payload.wallet, payload.orcid)
    if not key:
        raise HTTPException(
            status_code=400,
            detail="A wallet or ORCID is required to save a profile. Your draft is kept in "
                   "this browser until you connect one.")
    result = save_profile_slot(
        key, payload.dict(), name=payload.name, slot_id=payload.slot_id)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    return {"stored": True, "id": result["id"], "name": result["name"],
            "profiles": list_profile_slots(key)}


@router.post("/api/profiles/{slot_id}/activate")
def activate_profile(slot_id: int, payload: ResearcherProfile, request: Request):
    """Switch which profile frames diagnostics and the ResBD."""
    key = _profile_key(payload.wallet, payload.orcid)
    if not key:
        raise HTTPException(status_code=400, detail="Sign in to switch profiles.")
    result = activate_profile_slot(key, slot_id)
    if not result["ok"]:
        raise HTTPException(status_code=404, detail=result["reason"])
    return {"activated": True, "name": result["name"], "profile": result["profile"],
            "profiles": list_profile_slots(key)}


@router.delete("/api/profiles/{slot_id}")
def remove_profile_slot(slot_id: int, request: Request,
                        wallet: str = Query(default=""), orcid: str = Query(default="")):
    """Delete one named profile."""
    key = _profile_key(wallet, orcid)
    if not key:
        raise HTTPException(status_code=400, detail="Sign in to delete a profile.")
    result = delete_profile_slot(key, slot_id)
    if not result["ok"]:
        raise HTTPException(status_code=404, detail=result["reason"])
    return {"deleted": True, "profiles": list_profile_slots(key)}


@router.delete("/api/profile")
def reset_profile(request: Request, wallet: str = Query(default=""),
                  orcid: str = Query(default="")):
    """Delete the stored researcher profile for this identity.

    The row is removed rather than blanked. A profile whose fields are empty
    strings still exists, still frames the diagnostic summary, and still scopes
    the research buddy's recommendations — so a "reset" that left one behind
    would keep shaping results the user believed they had cleared.
    """
    check_rate_limit(get_client_ip(request), bucket="profile")
    key = _profile_key(wallet, orcid)
    if not key:
        raise HTTPException(
            status_code=400,
            detail="Connect a wallet or link ORCID to manage a stored profile.")
    removed = delete_researcher_profile(key)
    add_log(f"Researcher profile reset for {key[:16]}…")
    return {"reset": True, "had_profile": removed,
            "message": ("Profile cleared. Diagnostics will no longer be framed by it."
                        if removed else "There was no stored profile to clear.")}
