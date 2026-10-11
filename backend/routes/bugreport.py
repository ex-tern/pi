"""routes/bugreport.py: bug reports. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import _profile_key, require_owner  # noqa: F401

router = APIRouter()



# ---------------------------------------------------------------------------
# Bug reports
# ---------------------------------------------------------------------------
class BugReport(BaseModel):
    message: str
    contact: str = ""
    page: str = ""
    # "bug" or "suggestion". Defaults to bug so an older client, which has no
    # such field, keeps behaving exactly as it did.
    kind: str = "bug"
    wallet: str = ""
    orcid: str = ""


@router.get("/api/bug-report/status")
def bug_report_status():
    """What the form should promise before the user types anything."""
    # Kinds travel with the status so the form and the store share one
    # vocabulary rather than each hardcoding its own.
    return {**bugreport.delivery_status(),
            "kinds": [{"id": k, "label": v} for k, v in CONTACT_KINDS.items()]}


@router.post("/api/bug-report")
def submit_bug_report(payload: BugReport, request: Request):
    """Store the report, then attempt email delivery in the background.

    Storing first is the point. Mail is the part that fails — expired
    credentials, a throttling provider, a host that blocks outbound 587 — and
    telling someone their report was sent when it was silently dropped is worse
    than not offering the button. The confirmation the user gets is a receipt
    for something already committed to the database.
    """
    client_ip = get_client_ip(request)
    check_rate_limit(client_ip, bucket="bug_report")

    problem = bugreport.validate(payload.message, payload.contact)
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    kind = payload.kind if payload.kind in CONTACT_KINDS else "bug"
    key = _profile_key(payload.wallet, payload.orcid)
    report = bugreport.normalise(
        message=payload.message, contact=payload.contact, identity=key,
        page=payload.page, user_agent=request.headers.get("user-agent", ""),
    )
    report["kind"] = kind
    # The raw IP is not stored: a bug report is not an abuse signal, and
    # keeping one would attach an identifier to a complaint for no operational
    # reason. The hash still supports rate limiting and duplicate detection.
    ip_hash = hashlib.sha256(f"bugreport:{client_ip}".encode()).hexdigest()[:32]

    try:
        report["id"] = store_bug_report(report, ip_hash=ip_hash)
    except Exception as e:
        logging.exception("Bug report could not be stored")
        raise HTTPException(status_code=500,
                            detail="The report could not be saved. Please try again.") from e

    add_log(f"Contact message #{report['id']} received ({kind}, "
            f"{len(report['message'])} chars).")
    bugreport.send_async(report, on_result=lambda rid, res: mark_bug_report_delivered(
        rid, res["sent"], res.get("error") or ""))

    emailed = bugreport.smtp_configured()
    return {
        "received": True,
        "id": report["id"],
        "emailed": emailed,
        "kind": kind,
        "message": (
            f"Thank you — {'suggestion' if kind == 'suggestion' else 'report'} "
            f"#{report['id']} was saved"
            + (" and is being emailed to the maintainer." if emailed
               else ". Email delivery is not configured on this deployment, so it is stored "
                    "on the server for the maintainer to read.")
        ),
    }


@router.get("/api/bug-report/list")
def bug_report_list(request: Request, wallet: str = Query(default=""),
                    limit: int = Query(default=100, ge=1, le=300)):
    """Owner-only. The reports that failed to send exist nowhere else."""
    require_owner(request, wallet)
    reports = list_bug_reports(limit=limit)
    return {"reports": reports,
            "undelivered": sum(1 for r in reports if not r["delivered"]),
            "count": len(reports)}
