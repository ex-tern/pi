"""routes/status.py: the proof-of-work challenge, provider status, the free trial. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import require_owner  # noqa: F401

router = APIRouter()



# ---------------------------------------------------------------------------
# 3. INTAKE / ASSESSMENT PIPELINE  (streams NDJSON progress like the old
#    st.status(...) live box, then a final line with all results)
# ---------------------------------------------------------------------------
@router.get("/api/challenge")
def get_challenge(request: Request):
    """Issue a proof-of-work challenge for an anonymous submission."""
    ip = get_client_ip(request)
    payload = pow_challenge.issue_challenge(ip)
    payload["turnstile_site_key"] = TURNSTILE_SITE_KEY or None
    payload["required"] = REQUIRE_PROOF_OF_WORK
    return payload


@router.get("/api/providers/status")
def providers_status(request: Request, wallet: str = Query(default="")):
    """Operator view of which jurors can actually reach a model.

    Restricted to the owner wallet: it enumerates configured vendors, which is
    deployment information rather than something a researcher needs.
    """
    require_owner(request, wallet)
    return provider_configuration()


@router.get("/api/trial/status")
def trial_status(request: Request):
    """How much free allowance this visitor has left, and why."""
    ip = get_client_ip(request)
    used = get_free_evals_used(ip)
    # Fixed at FREE_DOCUMENTS. Arcade bonus is no longer added — a win pays piQ,
    # and reporting a grown trial alongside it described one reward twice.
    allowed = abuse_guard.FREE_DOCUMENTS
    return {
        "documents_allowed": allowed,
        "base_allowance": abuse_guard.FREE_DOCUMENTS,
        "bonus_allowance": 0,
        "documents_used": min(used, allowed),
        "remaining": max(0, allowed - used),
        "note": ("Metered per distinct manuscript. Re-assessing a paper you have already "
                 "submitted does not consume allowance."),
    }
