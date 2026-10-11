"""gate.py -- a password on the whole site, for the experimental copies.

Set SITE_PASSWORD on a deployment and nothing is served until the visitor has
typed it once: every page and API call answers with a small password page
(or 401 for an API caller) until a signed cookie says they have. The cookie
is an HMAC of the password with the deployment's secret, so changing the
password logs everyone out; it carries no password itself. Nothing is written
and nothing is logged about who tried what.

Unset (the default, and always on production), the gate does nothing.

    POST /api/gate   {"password": "..."}   -> 204 + cookie, or 401

Let through without the cookie: the health check Railway polls, robots.txt
and the gate endpoint itself. Everything else, static files included, waits
behind the password: a hidden site should not leak its scripts either.
"""

import hashlib
import hmac
import os
from typing import Callable, Optional

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

COOKIE = "pi_gate"
MAX_AGE = 60 * 60 * 24 * 30          # a month, then the password is asked again
OPEN = ("/api/gate", "/api/health", "/robots.txt")


def password() -> str:
    return (os.getenv("SITE_PASSWORD") or "").strip()


def enabled() -> bool:
    return bool(password())


def token(pw: str, secret: str) -> str:
    """The cookie value for a password: an HMAC, never the password."""
    return hmac.new((secret or pw).encode(), ("gate:" + pw).encode(), hashlib.sha256).hexdigest()


def passes(request: Request, secret: str) -> bool:
    pw = password()
    if not pw:
        return True
    if request.url.path in OPEN:
        return True
    got = request.cookies.get(COOKIE) or ""
    return bool(got) and hmac.compare_digest(got, token(pw, secret))


def check(given: str, secret: str) -> Optional[str]:
    """The cookie to set for a correct password, else None."""
    pw = password()
    if not pw or not hmac.compare_digest((given or "").strip().encode(), pw.encode()):
        return None
    return token(pw, secret)


def set_cookie(response: Response, value: str, secure: bool):
    response.set_cookie(COOKIE, value, max_age=MAX_AGE, httponly=True, samesite="lax", secure=secure, path="/")


def wants_html(request: Request) -> bool:
    return request.method == "GET" and "text/html" in (request.headers.get("accept") or "")


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Pi Tech Lab</title>
<style>
  html { background: #f6f6f4; color: #191919; font: 15px/1.5 Geist, "Geist Variable", system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
  form { display: grid; gap: 12px; width: min(320px, calc(100vw - 32px)); text-align: center; }
  .pi { width: 56px; height: 56px; border: 1.5px solid #191919; border-radius: 50%; corner-shape: superellipse(1.6515);
        display: grid; place-items: center; margin: 0 auto 6px; font-size: 24px; }
  p { margin: 0; color: #6b6b67; }
  input { font: inherit; padding: 10px 14px; border: 1px solid #c9c9c4; border-radius: 999px; background: #fff; color: inherit; text-align: center; outline: none; }
  input:focus { border-color: #2f40e8; box-shadow: 0 0 0 3px rgba(47, 64, 232, 0.15); }
  button { font: inherit; padding: 10px 18px; border: 0; border-radius: 999px; background: #191919; color: #fff; cursor: pointer; }
  .no { color: #b4574f; min-height: 1.5em; }
</style></head>
<body><form method="post" autocomplete="off">
  <div class="pi" aria-hidden="true">&pi;</div>
  <p>This copy of Pi Tech Lab is private.</p>
  <input type="password" name="password" aria-label="Password" autofocus required>
  <button type="submit">Enter</button>
  <div class="no" aria-live="polite">__MSG__</div>
</form>
<script>
document.querySelector("form").addEventListener("submit", async e => {
  e.preventDefault();
  const no = document.querySelector(".no"), pw = document.querySelector("input").value;
  const r = await fetch("/api/gate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) }).catch(() => null);
  if (r && r.ok) location.reload(); else { no.textContent = "That is not it."; document.querySelector("input").select(); }
});
</script></body></html>"""


def page(msg: str = "") -> HTMLResponse:
    return HTMLResponse(PAGE.replace("__MSG__", msg), status_code=401, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"})


def install(app, secret_of: Callable[[], str]):
    """Mount the gate on a FastAPI app. secret_of() gives the signing secret (SESSION_SECRET)."""

    @app.middleware("http")
    async def _gate(request: Request, call_next):
        if passes(request, secret_of()):
            return await call_next(request)
        if wants_html(request):
            return page()
        return JSONResponse(status_code=401, content={"detail": "This deployment is private."}, headers={"Cache-Control": "no-store"})

    @app.post("/api/gate", status_code=204)
    async def _enter(request: Request):
        try:
            body = await request.json()
        except Exception:                                   # noqa: BLE001
            body = {}
        value = check(str((body or {}).get("password", "")), secret_of())
        if not value:
            return JSONResponse(status_code=401, content={"detail": "That is not it."})
        response = Response(status_code=204)
        set_cookie(response, value, secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https")
        return response
