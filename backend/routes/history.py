"""routes/history.py: clearing your history. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import _identity_values, _profile_key, require_identity  # noqa: F401

router = APIRouter()



class ClearHistoryRequest(BaseModel):
    confirm: str = ""               # must be the literal word DELETE
    wallet: str = ""
    orcid: str = ""


@router.post("/api/assessments/mine/clear")
def clear_my_history(payload: ClearHistoryRequest, request: Request):
    """Withdraw every assessment submitted under this identity.

    This is the user's own scope, not the operator's: it removes only papers
    submitted by this identity, and it uses the same withdrawal path as
    removing one paper at a time, so the guarantees are identical. The
    Proof-of-Research blocks remain — the chain is append-only, and deleting a
    block would invalidate every block after it, so "clear my history" means
    the papers leave the corpus and the listings, not that the ledger is
    rewritten. Said plainly in the response rather than left to be discovered.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    if (payload.confirm or "").strip() != "DELETE":
        raise HTTPException(
            status_code=400,
            detail="Type DELETE exactly to confirm. Nothing has been removed.")

    identities = _identity_values(identity["wallet"], identity["orcid"])
    rows = list_assessments_for_identity(identities, limit=1000)
    if not rows:
        return {"cleared": True, "removed": 0,
                "message": "There was nothing to remove."}

    removed, failed = 0, 0
    for r in rows:
        h = r.get("eval_hash") or r.get("hash")
        if not h:
            continue
        try:
            if delete_assessment(h, identities):
                paper_store.delete_paper(h)
                removed += 1
            else:
                failed += 1
        except Exception as e:
            logging.warning("Could not remove %s during history clear: %s", str(h)[:12], e)
            failed += 1

    add_log(f"History cleared for {_profile_key(identity['wallet'], identity['orcid'])[:16]}…"
            f" — {removed} paper(s) withdrawn")
    return {
        "cleared": True, "removed": removed, "failed": failed,
        "message": (
            f"{removed} paper{'' if removed == 1 else 's'} withdrawn from the corpus and all "
            f"listings."
            + (f" {failed} could not be removed." if failed else "")
            + " Their Proof-of-Research blocks remain: the chain is append-only, so deleting a "
              "block would invalidate every block after it. piQ already earned is unaffected."),
    }
