"""cookies.py -- the cookies and browser storage the site uses, and what a visitor allowed.

Owner, 2026-10-13: "add ask for permission what site is doing with users when site loads", "use cookies", "add use
of cookies for the site and its permissions".

The visitor's choice is the first-party cookie pi_consent, set by the first-visit notice (frontend/super/consent.js):

    pi_consent=v1.c1.l0.e1      c: count my visit   l: help PiEn learn   e: outside AI providers

The page already sends nothing a visitor declined. Here the server honours the same choice on its own, so a
request that reaches it anyway is refused: when a browser's pi_consent says no to something, the server does not
do it. With no pi_consent at all (an API client, a script, a test) the server does not guess: it serves the request
as before, since a browser that has not chosen yet sends nothing optional in the first place.

    GET /api/cookies   -> {version, cookies: [...], storage: [...], choice: {count, learn, ext} | null}

The lists below are what the notice shows under "Cookies and storage", so what the site says it uses and what it
does use are written in one place. Add a cookie or a storage key here when the site starts using one.
"""

import logging
import re
from typing import Dict, List, Optional

COOKIE = "pi_consent"
VERSION = "v1"
YEAR = 365 * 24 * 3600

# every cookie the site sets: no tracking or advertising cookies, and none from other sites
COOKIES: List[Dict] = [
    {"name": "pi_consent", "purpose": "Remembers your privacy choices (this notice), so we do not ask again.",
     "essential": True, "lasts": "1 year", "set_by": "this site (the page)", "read_by": "this site (page and server)"},
    {"name": "pi_gate", "purpose": "Only on private test copies of the site: remembers that you typed their password.",
     "essential": True, "lasts": "30 days", "set_by": "this site (server, HttpOnly)", "read_by": "this site (server)"},
]
# what the page keeps in your browser's storage (not cookies: never sent with requests by themselves)
STORAGE: List[Dict] = [
    {"name": "lv:, orbit:, se:, superai: keys", "purpose": "Your layout, the supers you make and draw, your wires, saved states.",
     "essential": True, "lasts": "until you clear it or reset the app"},
    {"name": "sp_token, sp_wallet, sp_orcid", "purpose": "Your sign-in, if you sign in (sent only to this site).",
     "essential": True, "lasts": "until you sign out"},
    {"name": "pisave:pending (session)", "purpose": "Hands a saved state to the page while it reloads after a reset.",
     "essential": True, "lasts": "this tab only"},
]

# the optional things, and what each one switches
CHOICES = {"count": "c", "learn": "l", "ext": "e"}
OUTSIDE = ("llama", "mistral", "qwen", "gemini", "deepseek", "judge")

# requests that need a choice: (method, path pattern, the choice, what happens when it is off)
#   "skip"    answered as done but not done (a visit not counted, a lesson not learned): nothing breaks
#   "refuse"  403 with the reason, the page shows it
RULES = [
    ("POST", re.compile(r"^/api/visit$"), "count", "skip"),
    ("POST", re.compile(r"^/api/pien/learn$"), "learn", "skip"),
    ("POST", re.compile(r"^/api/assess(/|$)"), "ext", "refuse"),
    ("POST", re.compile(r"^/api/super/(panel|weigh)$"), "ext", "refuse"),
    ("POST", re.compile(r"^/api/assessments/[^/]+/review/llm$"), "ext", "refuse"),
]
WHY = {"count": "you chose not to have your visit counted",
       "learn": "you chose not to help PiEn learn",
       "ext": "you chose not to use outside AI providers (this uses them); change it in Privacy choices"}


def parse(value: Optional[str]) -> Optional[Dict[str, bool]]:
    """The choice in a pi_consent value, or None when there is none (or it is from an older notice)."""
    if not value:
        return None
    parts = str(value).strip().split(".")
    if not parts or parts[0] != VERSION:
        return None
    flags = {p[0]: p[1:] == "1" for p in parts[1:] if len(p) == 2 and p[1] in "01"}
    return {k: bool(flags.get(c, False)) for k, c in CHOICES.items()}


def from_request(request) -> Optional[Dict[str, bool]]:
    try:
        return parse(request.cookies.get(COOKIE))
    except Exception:                                   # noqa: BLE001 -- no cookies at all: no choice
        return None


def declined(request, what: str) -> bool:
    """True only when the visitor's cookie says no to `what` (no cookie: not declined, see the module notes)."""
    c = from_request(request)
    return c is not None and not c.get(what, False)


def rule_for(method: str, path: str):
    m = (method or "").upper()
    for rm, rx, what, how in RULES:
        if m == rm and rx.search(path or ""):
            return what, how
    return None


def outside_engine(engine: str) -> bool:
    return (engine or "").strip().lower() in OUTSIDE


def info(request) -> Dict:
    return {"version": VERSION, "cookie": COOKIE, "cookies": COOKIES, "storage": STORAGE, "choice": from_request(request)}


def install(app):
    """The server honours pi_consent: a middleware for the rules above, and GET /api/cookies."""
    from fastapi import Request
    from fastapi.responses import JSONResponse

    @app.middleware("http")
    async def _consent(request: Request, call_next):
        try:
            r = rule_for(request.method, request.url.path)
            if r and declined(request, r[0]):
                what, how = r
                if how == "skip":
                    return JSONResponse(status_code=200, content={"skipped": True, "why": WHY[what]}, headers={"Cache-Control": "no-store"})
                return JSONResponse(status_code=403, content={"detail": WHY[what], "declined": what}, headers={"Cache-Control": "no-store"})
        except Exception as e:                          # noqa: BLE001 -- never let the check itself take the site down
            logging.warning("cookies: consent check skipped: %s", e)
        return await call_next(request)

    @app.get("/api/cookies")
    def _cookies(request: Request):
        return JSONResponse(content=info(request), headers={"Cache-Control": "no-store"})
