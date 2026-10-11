"""routes/meta.py: what build this is: /api/build, robots.txt, /api/health, /api/logs. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import require_owner  # noqa: F401

router = APIRouter()



@router.get("/api/build")
def build_info():
    """Public, and deliberately so: it identifies a build, not its contents."""
    return BUILD_INFO


@router.get("/robots.txt", include_in_schema=False)
def robots_txt():
    """The experimental site must never compete with the real one in search."""
    if IS_EXPERIMENTAL:
        return PlainTextResponse("User-agent: *\nDisallow: /\n")
    return PlainTextResponse("User-agent: *\nAllow: /\n")


@router.get("/api/health")
def health_check():
    db_ok = True
    try:
        conn = get_db_connection()
        conn.execute("SELECT 1")
        conn.close()
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "build": BUILD_INFO,
        "environment": ENVIRONMENT,
        "database": "ok" if db_ok else "unreachable",
        "storage": {
            "verdict": PERSISTENCE_REPORT.get("verdict"),
            "boot_count": PERSISTENCE_REPORT.get("boot_count"),
            "data_dir": PERSISTENCE_REPORT.get("data_dir"),
            "warning": PERSISTENCE_REPORT.get("warning"),
        },
    }


# ---------------------------------------------------------------------------
# 1. LOGS
# ---------------------------------------------------------------------------
@router.get("/api/logs")
def get_logs(request: Request, wallet: str = Query(default="")):
    """Operational log. Owner only.

    This was public. It carries wallet addresses, ORCIDs, authentication
    events, assessment failures and provider error categories — an operator's
    view of who used the deployment and what broke, served to anyone who
    guessed the path. It was genuinely useful for diagnosing this deployment
    remotely, which is precisely the problem: what helps a maintainer debug
    also helps anyone else map the system and its users.

    A break-glass token exists deliberately. Owner authorisation needs a signed
    session, and the situations where these logs matter most are exactly the
    ones where signing in may not work — a failed deploy, a missing
    SESSION_SECRET, a broken frontend. Locking the only diagnostic behind the
    thing that might be broken is how an operator ends up with no way in.
    """
    break_glass = os.getenv("LOG_ACCESS_TOKEN", "").strip()
    if break_glass:
        supplied = auth.token_from_request(request)
        # compare_digest so a wrong guess cannot be refined from timing.
        if supplied and hmac.compare_digest(supplied, break_glass):
            return {"logs": list(APP_LOGS), "access": "break-glass"}

    require_owner(request, wallet)
    return {"logs": list(APP_LOGS), "access": "owner"}
