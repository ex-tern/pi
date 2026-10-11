"""routes/visits.py: visits and stats, riB feedback, the engines status. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import _profile_key  # noqa: F401

import traffic as _traffic  # the daily series

router = APIRouter()


def _visitor_key(ip: str) -> str:
    """A stable, non-reversible identifier for one visitor.

    Keyed with the session secret rather than a plain hash: a bare sha256 of an
    IPv4 address is trivially reversible by enumerating all four billion of
    them, so it would not actually be anonymous. With a secret key it is.
    """
    if not ip:
        return ""
    secret = (os.getenv("SESSION_SECRET") or "scholarpi-visits").encode()
    return hmac.new(secret, f"visit:{ip}".encode(), hashlib.sha256).hexdigest()[:32]


@router.post("/api/visit")
def register_visit(request: Request):
    """Count this visitor once. Called by the frontend on first load per session.

    Returns the current totals so the caller can render them without a second
    request.
    """
    key = _visitor_key(get_client_ip(request))
    record_visit(key)
    _traffic.record(get_db_connection, key)      # the daily series (traffic.py)
    return visitor_stats()


class RibFeedback(BaseModel):
    field: str = ""
    useful: bool = True
    features: List[float] = []
    wallet: str = ""
    orcid: str = ""


@router.post("/api/rib/feedback")
def rib_feedback(payload: RibFeedback, request: Request):
    """A researcher's verdict on one riB suggestion — riB's training signal.

    riB has no other way to learn. Its counts and means are measurements with
    no error to observe; whether a suggestion was worth making is only knowable
    from the person who received it.
    """
    identity = auth.identity_from_request(request, payload.wallet, payload.orcid)
    key = _profile_key(identity["wallet"], identity["orcid"]) if identity["verified"] else ""
    check_rate_limit(get_client_ip(request), bucket="review")

    candidate = {"field": payload.field, "_features": payload.features or None}
    summary = {"total_papers": 0, "mean_score": 0.0}
    try:
        result = rib_learning.observe_feedback(candidate, summary, payload.useful,
                                               account_key=key)
    except Exception as e:
        logging.warning("riB could not learn from feedback: %s", e)
        raise HTTPException(status_code=503, detail="Feedback could not be recorded.")
    return {"recorded": True, "learning": result,
            "message": ("Recorded. riB uses this to decide which suggestions to surface "
                        "first — it never adjusts the underlying counts.")}


@router.get("/api/engines/status")
def engines_status():
    """What each of the three engines has actually learned.

    Published rather than asserted: a claim that an engine improves over time
    is only meaningful if the improvement can be inspected, so each model
    reports its parameters, its observation count, and its error against its
    own frozen defaults. An engine that is not beating its defaults says so.
    """
    criteria_keys = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]
    out = {"idle": idle_worker.public_status(), "budget_note": ("All three learners are NumPy linear models with a few dozen "
                           "parameters each. No PyTorch is imported on this path, which is "
                           "what keeps the process inside a 500 MB envelope.")}

    def normalise(raw: dict) -> dict:
        """One shape for all three engines.

        They were written separately and each grew its own vocabulary for the
        same three facts: siM says `baseline_mean_abs_error`, riB says
        `baseline_abs_error`, piD says `total_observations` and reports no
        error at all. A caller comparing them had to know each engine's
        private naming, so the comparison lived in the client and drifted.

        The engine-specific payload is preserved untouched under the same keys
        it always used; these four are added alongside as the common view.
        """
        if not isinstance(raw, dict) or raw.get("error"):
            return raw if isinstance(raw, dict) else {"error": "unavailable"}
        obs = raw.get("observations")
        if obs is None:
            obs = raw.get("total_observations", raw.get("logged_observations", 0))
        mine = raw.get("mean_abs_error")
        base = raw.get("baseline_abs_error", raw.get("baseline_mean_abs_error"))
        return {**raw,
                "observations": int(obs or 0),
                "mean_abs_error": mine,
                "baseline_abs_error": base,
                # `learning` means "measurably better than its own defaults".
                # Reported as False rather than omitted when unknown: an engine
                # that cannot show improvement should say so, not stay silent
                # and let the interface assume the best.
                "learning": bool(raw.get("learning", False))}

    for key, fn in (("piD", lambda: forecast_engine.engine_status(criteria_keys)),
                    ("riB", rib_learning.engine_status),
                    ("siM", scilem_learning.status)):
        try:
            out[key] = normalise(fn())
        except Exception as e:
            out[key] = {"error": str(e)}

    # Whether either engine is currently being bootstrapped by a model. Shown
    # rather than hidden: an engine whose numbers are partly model-taught is a
    # materially different claim from one taught entirely by the platform's own
    # data, and the panel should be able to say which it is looking at.
    for key, mod in (("riB", rib_learning), ("siM", scilem_learning)):
        try:
            if isinstance(out.get(key), dict) and hasattr(mod, "tutor_status"):
                out[key]["tutor"] = mod.tutor_status()
        except Exception:
            pass
    return out


@router.get("/api/stats/visitors")
def visitor_counts():
    """Public visitor totals."""
    return visitor_stats()


@router.get("/api/stats/count")
def stats_count():
    conn = get_db_connection()
    try:
        n = conn.execute("SELECT COUNT(*) FROM papers_assessment").fetchone()[0]
    finally:
        conn.close()
    return {"total_analyzed": n}
