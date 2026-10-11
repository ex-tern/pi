"""routes/auth.py: signing in: wallet signatures, ORCID, the session. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403

router = APIRouter()



# ---------------------------------------------------------------------------
# 2. AUTH — MetaMask (SIWE-style) + ORCID
# ---------------------------------------------------------------------------
class WalletVerifyRequest(BaseModel):
    address: str
    message: Optional[str] = None
    signature: Optional[str] = None


@router.post("/api/auth/wallet/verify")
def verify_wallet(req: WalletVerifyRequest, request: Request):
    # An authentication surface, and ECDSA recovery is not free. Unlimited
    # attempts let an attacker both burn CPU and grind signatures offline
    # against a live oracle.
    check_rate_limit(get_client_ip(request), bucket="auth")
    if not w3.is_address(req.address):
        raise HTTPException(status_code=400, detail="Not a valid Ethereum address.")
    clean_wallet = w3.to_checksum_address(req.address)
    authenticated = False
    if req.signature and req.message:
        try:
            decoded_msg = urllib.parse.unquote(req.message)
            signable_msg = encode_defunct(text=decoded_msg)
            recovered = w3.eth.account.recover_message(signable_msg, signature=req.signature)
            authenticated = recovered.lower() == clean_wallet.lower()
        except Exception as e:
            add_log(f"SIWE signature verification fallback: {e}")
    if not authenticated:
        # An unsigned "link" proves nothing and now grants nothing. Returning a
        # session here would recreate the exact hole this replaces.
        add_log(f"Wallet link attempted without a valid signature: {clean_wallet}")
        return {
            "address": clean_wallet, "authenticated": False, "token": "",
            "detail": ("Signature required. Connecting an address proves you can type it, not "
                       "that you control it."),
        }

    add_log(f"Wallet authenticated by EIP-191 signature: {clean_wallet}")

    # Carry forward an ORCID that is ALREADY proven in the caller's current
    # session, exactly as the ORCID callback carries forward a proven wallet.
    #
    # Without this, signing a wallet after linking ORCID minted a token holding
    # only the wallet and silently dropped the ORCID. The browser still had both
    # in localStorage, so the sidebar — which passes both as parameters — summed
    # both accounts, while every identity-scoped action used the narrower token.
    # The result was a user shown a spendable balance of 0.51 piQ being told
    # their balance was 0.01 when they tried to spend it.
    #
    # This re-reads the ORCID from the signed token, never from a parameter, so
    # it asserts nothing the server did not already verify.
    methods = {"wallet": "signature"}
    proven_orcid = ""
    existing = auth.verify_session(auth.token_from_request(request))
    if existing and existing.get("orcid"):
        proven_orcid = existing["orcid"]
        methods["orcid"] = existing.get("methods", {}).get("orcid", "oauth")

    token = auth.issue_session(wallet=clean_wallet, orcid=proven_orcid, methods=methods)
    return {
        "address": clean_wallet, "authenticated": True, "token": token,
        "expires_in": auth.SESSION_TTL_SECONDS,
        "detail": None if token else ("Signature verified, but this deployment cannot sign "
                                      "sessions. Set SESSION_SECRET to enable sign-in."),
    }


# The site's own addresses. Signing in from one of them, ORCID is asked to
# send the visitor back to that same address's callback, whatever
# ORCID_REDIRECT_URI says: a stale value (it pointed at the old Railway
# address, scholarpi.up.railway.app) breaks sign-in outright as soon as the
# ORCID app's registered redirect URIs are updated to pitechlab.com. Each of
# these callbacks must be registered with the ORCID app:
#   https://pitechlab.com/api/auth/orcid/callback
#   https://exp.pitechlab.com/api/auth/orcid/callback
#   https://se.pitechlab.com/api/auth/orcid/callback
#   https://super.pitechlab.com/api/auth/orcid/callback
_OWN_ORIGINS = ("https://pitechlab.com", "https://www.pitechlab.com", "https://exp.pitechlab.com",
                "https://se.pitechlab.com", "https://super.pitechlab.com")


def resolve_orcid_redirect_uri(request: Request) -> str:
    """The callback URL registered with ORCID, defaulting to this deployment."""
    here = _request_origin(request)
    if here in _OWN_ORIGINS:
        return f"{here}/api/auth/orcid/callback"
    configured = (ORCID_REDIRECT_URI or "").strip()
    if configured and "localhost" not in configured and "127.0.0.1" not in configured:
        return configured
    return f"{resolve_frontend_origin(request)}/api/auth/orcid/callback"


@router.get("/api/auth/session")
def auth_session(request: Request):
    """What this caller has actually proven, and by which method.

    The UI needs to distinguish "an address is typed into a box" from "control
    of that address was demonstrated". Those looked identical before, which is
    why an unsigned wallet appeared to confer the same access as a signed one.
    """
    identity = auth.identity_from_request(request)
    return {
        "verified": identity["verified"],
        "wallet": identity["wallet"] or None,
        "orcid": identity["orcid"] or None,
        "methods": identity["methods"],
        "is_owner": auth.is_owner(identity),
        # Two independent proofs: a private key AND an ORCID account.
        "two_factor": bool(identity["verified"]
                           and identity["wallet"] and identity["orcid"]),
        "sessions_enabled": auth.sessions_available(),
        "note": (None if auth.sessions_available() else
                 "Sign-in is disabled: set SESSION_SECRET so sessions can be signed."),
    }


# --- Coming back to the site you started from ------------------------------
#
# ORCID only redirects to a callback URL registered with it, and the one
# configured in production was the old Railway address
# (scholarpi.up.railway.app). The callback is served by the same backend, so
# the sign-in itself worked, but it then sent the browser on to whatever
# FRONTEND_ORIGIN or that request's host said: the old address, not
# pitechlab.com. The session landed in another origin's storage and the
# visitor found themselves on "another website", not signed in.
#
# Now the login URL records the origin the visitor started on inside ORCID's
# `state` parameter, and the callback returns there. Only known origins are
# honoured (no open redirect): this site's own addresses, FRONTEND_ORIGIN, the
# callback's own host, and any listed in ORCID_RETURN_ORIGINS.
_ORCID_RETURN_DEFAULTS = ("https://pitechlab.com", "https://www.pitechlab.com")


def _request_origin(request: Request) -> str:
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    if not host:
        return ""
    proto = request.headers.get("x-forwarded-proto") or (
        "http" if host.startswith(("localhost", "127.0.0.1")) else "https")
    return f"{proto}://{host}".rstrip("/")


def _orcid_return_allowed(origin: str, request: Request) -> bool:
    if not origin or not origin.startswith(("https://", "http://localhost", "http://127.0.0.1")):
        return False
    extra = [o.strip().rstrip("/") for o in os.environ.get("ORCID_RETURN_ORIGINS", "").split(",") if o.strip()]
    allowed = set(_ORCID_RETURN_DEFAULTS) | set(extra) | {resolve_frontend_origin(request), _request_origin(request)}
    return origin in allowed


def _orcid_state(wallet_part: str, origin: str) -> str:
    if not origin:
        return wallet_part
    enc = base64.urlsafe_b64encode(origin.encode()).decode().rstrip("=")
    return f"{wallet_part}~{enc}"


def _orcid_unstate(state: Optional[str]):
    """(wallet part, return origin or "") from a `state` parameter."""
    if not state:
        return "", ""
    wallet_part, _, enc = state.partition("~")
    origin = ""
    if enc:
        try:
            origin = base64.urlsafe_b64decode(enc + "=" * (-len(enc) % 4)).decode()
        except Exception:
            origin = ""
    return wallet_part, origin


@router.get("/api/auth/orcid/login-url")
def orcid_login_url(request: Request, wallet: Optional[str] = None):
    if not ORCID_CLIENT_ID or not ORCID_CLIENT_SECRET:
        raise HTTPException(
            status_code=503,
            detail="ORCID sign-in is not configured on this deployment "
                   "(ORCID_CLIENT_ID / ORCID_CLIENT_SECRET are unset).",
        )
    start = _request_origin(request)
    state_payload = _orcid_state(wallet if wallet and w3.is_address(wallet) else "none",
                                 start if _orcid_return_allowed(start, request) else "")
    redirect_uri = resolve_orcid_redirect_uri(request)
    url = (
        f"https://orcid.org/oauth/authorize?client_id={ORCID_CLIENT_ID}"
        f"&response_type=code&scope=/authenticate"
        f"&redirect_uri={urllib.parse.quote(redirect_uri, safe='')}"
        f"&state={urllib.parse.quote(state_payload, safe='')}"
    )
    return {"url": url, "redirect_uri": redirect_uri}


def resolve_frontend_origin(request: Request) -> str:
    """Where to send the browser back to after an OAuth round trip.

    FRONTEND_ORIGIN defaults to http://localhost:8000, which is correct for
    local development and wrong for every deployment. On a hosted instance the
    ORCID callback was redirecting to localhost, so the browser silently
    dropped the `?orcid=` parameters and the sidebar never showed the account
    as connected.

    An explicitly configured FRONTEND_ORIGIN still wins; otherwise the origin
    is derived from the request itself, honouring the proxy headers that
    platforms like Railway set.
    """
    configured = (FRONTEND_ORIGIN or "").strip().rstrip("/")
    if configured and configured not in ("http://localhost:8000", "http://127.0.0.1:8000"):
        return configured

    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if forwarded_host:
        proto = request.headers.get("x-forwarded-proto")
        if not proto:
            proto = "https" if not forwarded_host.startswith(("localhost", "127.0.0.1")) else "http"
        return f"{proto}://{forwarded_host}".rstrip("/")
    return configured or "http://localhost:8000"


@router.get("/api/auth/orcid/callback")
def orcid_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None):
    wallet_part, back = _orcid_unstate(state)
    frontend = back if _orcid_return_allowed(back, request) else resolve_frontend_origin(request)
    wallet_qs = ""
    if wallet_part and wallet_part != "none" and w3.is_address(wallet_part):
        wallet_qs = f"&wallet={w3.to_checksum_address(wallet_part)}"

    if not code:
        return RedirectResponse(f"{frontend}/?orcid_error=missing_code")

    try:
        res = requests.post(
            "https://orcid.org/oauth/token",
            data={
                "client_id": ORCID_CLIENT_ID,
                "client_secret": ORCID_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": resolve_orcid_redirect_uri(request),
            },
            headers={"Accept": "application/json"},
        )
        if res.status_code == 200:
            data = res.json()
            real_orcid = data.get("orcid")
            real_name = data.get("name") or (f"ORCID Scholar ({real_orcid[-4:]})" if real_orcid else "")
            if real_orcid:
                add_log(f"ORCID authenticated via OAuth: {real_orcid}")
                name_qs = urllib.parse.quote(real_name or "")

                # The OAuth code exchange is the proof, so a session is minted
                # here. The wallet from `state` is carried only if it was itself
                # proven — a wallet that merely rode along in a query parameter
                # is a claim, and folding it into a signed token would launder
                # that claim into an assertion the server never verified.
                proven_wallet = ""
                methods = {"orcid": "oauth"}
                existing = auth.verify_session(request.query_params.get("token", ""))
                if existing and existing.get("wallet"):
                    proven_wallet = existing["wallet"]
                    methods["wallet"] = existing.get("methods", {}).get("wallet", "signature")

                token = auth.issue_session(wallet=proven_wallet, orcid=real_orcid, methods=methods)
                token_qs = f"&token={urllib.parse.quote(token)}" if token else ""
                return RedirectResponse(
                    f"{frontend}/?orcid={real_orcid}&orcid_name={name_qs}{wallet_qs}{token_qs}")
        err_desc = res.json().get("error_description", "Invalid Code") if res.content else "Invalid Code"
        add_log(f"ORCID Auth Error: {err_desc}")
        return RedirectResponse(f"{frontend}/?orcid_error={urllib.parse.quote(err_desc)}")
    except Exception as e:
        add_log(f"Failed to connect to ORCID API: {e}")
        return RedirectResponse(f"{frontend}/?orcid_error={urllib.parse.quote(str(e))}")
