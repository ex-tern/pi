"""routes/scilem.py: SciM (Scilem): status, learning, feedback, chat, reset. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import _profile_key, require_owner  # noqa: F401
from routes.piq import normalize_identity  # noqa: F401

router = APIRouter()



# ---------------------------------------------------------------------------
# 5. SCILEM ASSISTANT
# ---------------------------------------------------------------------------
class ScilemChatRequest(BaseModel):
    prompt: str
    wallet: Optional[str] = ""
    orcid: Optional[str] = ""


@router.get("/api/scilem/status")
def scilem_status():
    """Capabilities of the assistant, so the UI can describe it honestly.

    The badge previously read "Ready" whenever the assistant was enabled, while
    the assistant itself would then explain that it could only answer a narrow
    set of questions. Both statements were true and together they read as a
    contradiction, because "Ready" was answering a different question from the
    one the user was asking. The status now names the actual mode, and says in
    one sentence what that mode can and cannot do — so the badge and the prose
    agree.

    `cloud_phrasing` also checks every provider key rather than only Groq and
    OpenRouter; a deployment configured with, say, only a Mistral key had
    working phrasing but reported none.
    """
    has_phrasing = bool(GROQ_API_KEY or OR_API_KEY or GEMINI_API_KEY
                        or CEREBRAS_API_KEY or MISTRAL_API_KEY or DEEPSEEK_API_KEY
                        or TOGETHER_API_KEY or GITHUB_MODELS_TOKEN)
    if not ENABLE_SCILEM_ASSISTANT:
        mode, label, notice = "disabled", "Off", SCILEM_DISABLED_NOTICE
    elif SCILEM_MODE == "limited":
        # Operator-declared, not inferred. The deployment may well have
        # provider keys configured and still not have the memory to use them
        # comfortably, so this overrides the capability sniff rather than
        # being overridden by it.
        mode, label, notice = "limited", "Limited", SCILEM_LIMITED_NOTICE
    elif has_phrasing:
        mode, label = "grounded+phrasing", "Ready"
        notice = None
    else:
        mode, label = "grounded", "Grounded"
        notice = (
            "No language-model provider is configured, so open-ended questions cannot be "
            "rephrased or reasoned about. Answers come from live deployment state and the "
            "built-in knowledge base only — narrower, but never invented."
        )
    return {
        "enabled": ENABLE_SCILEM_ASSISTANT,
        "mode": mode,
        "badge": label,
        "local_model": ENABLE_SCILEM_LOCAL_MODEL,
        "cloud_phrasing": has_phrasing,
        "capabilities": scilem.CAPABILITIES,
        "notice": notice,
    }


@router.get("/api/scilem/learning")
def scilem_learning_status(request: Request, wallet: str = Query(default=""),
                           observations: int = Query(default=0, ge=0, le=200)):
    """What SciLM (siM) has learned, and from what.

    Public by design. This model contributes to a research-assessment score,
    so how it is weighted, how far it has drifted from its authored defaults
    and how well calibrated it currently is are all things a reader is
    entitled to check rather than take on trust.
    """
    payload = scilem_learning.status()
    if observations:
        # The raw observation log is owner-only: it pairs evaluation hashes
        # with panel verdicts, which is more detail than a public endpoint
        # should join up.
        if auth.is_owner(auth.identity_from_request(request, wallet)):
            payload["observations_log"] = list_scilem_observations(limit=observations)
        else:
            payload["observations_log"] = []
            payload["observations_note"] = "The raw observation log is restricted to the owner wallet."
    return payload


class ScilemFeedback(BaseModel):
    eval_hash: str
    corrected_score: float
    wallet: str = ""
    orcid: str = ""


@router.post("/api/scilem/feedback")
def scilem_feedback(payload: ScilemFeedback, request: Request):
    """A human correction to a structural score.

    Weighted more heavily than panel consensus, because a person who has read
    the manuscript is a better authority on it than a panel of models. Limited
    to signed-in users and to one correction per paper per identity: an
    anonymous, repeatable correction endpoint is a direct route to steering
    the scoring model, and this is the one input that is not self-correcting.
    """
    check_rate_limit(get_client_ip(request), bucket="scilem")
    key = _profile_key(payload.wallet, payload.orcid)
    if not key:
        raise HTTPException(
            status_code=403,
            detail="Sign in with a wallet or ORCID to submit a correction. Corrections adjust "
                   "the scoring model, so they must be attributable.")
    if not 0.0 <= payload.corrected_score <= 100.0:
        raise HTTPException(status_code=400, detail="Corrected score must be between 0 and 100.")

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT title, scilem_signals FROM papers_assessment WHERE eval_hash = ?",
            (payload.eval_hash,),
        ).fetchone()
    except sqlite3.Error:
        row = None
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")

    # The signals were measured and stored at assessment time. Reusing them
    # rather than re-deriving from text means a correction can be applied long
    # after the manuscript itself is gone — and, more importantly, that the
    # learning step uses exactly the measurements the original score used.
    try:
        signals = json.loads(row[1] or "{}")
    except (ValueError, TypeError):
        signals = {}
    if not signals or not any(signals.values()):
        return {"accepted": False,
                "message": ("This assessment predates structural-signal storage, so there is "
                            "nothing to learn from. Corrections work on assessments run after "
                            "this version.")}
    report = scilem_learning.observe(
        signals, max(0.0, min(1.0, payload.corrected_score / 100.0)),
        source="feedback", independent_sources=99, eval_hash=payload.eval_hash,
    )
    add_log(f"SciLM (siM) correction on {payload.eval_hash[:12]}… by {key[:16]}…: {report.get('learned')}")
    return {"accepted": bool(report.get("learned")), "report": report,
            "message": ("Correction applied. SciLM (siM)'s weighting has been adjusted."
                        if report.get("learned") else
                        f"Correction not applied: {report.get('reason', 'rejected.')}")}


@router.post("/api/scilem/chat")
def scilem_chat(req: ScilemChatRequest, request: Request):
    if not ENABLE_SCILEM_ASSISTANT:
        raise HTTPException(status_code=503, detail=SCILEM_DISABLED_NOTICE)
    check_rate_limit(get_client_ip(request), bucket="scilem")
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty.")
    if len(req.prompt) > 4000:
        raise HTTPException(status_code=413, detail="Prompt is too long (max 4,000 characters).")

    # Identity is taken from the verified request, not from the prompt, so a
    # question cannot talk the assistant into reading someone else's balance.
    clean_wallet, clean_orcid = normalize_identity(req.wallet, req.orcid)
    return scilem.answer(req.prompt, wallet=clean_wallet, orcid=clean_orcid)


class ScilemResetRequest(BaseModel):
    wallet: str


@router.post("/api/scilem/reset")
def scilem_reset(req: ScilemResetRequest, request: Request):
    require_owner(request, req.wallet)
    msg = clear_structural_analyzer_state()
    add_log(msg)
    return {"message": msg}
