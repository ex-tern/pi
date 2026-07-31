"""
Session tokens: turning a *claimed* identity into a *proven* one.

The problem this fixes
----------------------
Every identity-scoped endpoint took `wallet` and `orcid` as plain request
parameters and trusted them. Nothing tied those values to the person sending
the request. Signature verification existed — `/api/auth/wallet/verify`
recovered the signer and compared it to the claimed address — but the result
was returned to the browser and never enforced again, so it decided what the
UI displayed and nothing else.

Two consequences followed, and the second is severe.

Any visitor could read another researcher's assessment history and stored
profile, and delete their papers, by putting that person's wallet or ORCID in
a query string.

Worse, owner authorisation was `wallet.lower() == OWNER_ID.lower()` against
that same untrusted parameter — and OWNER_ID is *published* at
`/api/chain/status` as `owner_wallet`. Anyone could read the owner address
from a public endpoint and pass it back to obtain provider diagnostics, other
users' bug reports, backup triggers, corpus rescoring and Scilem reset. There
was no attack to mount; you simply asked.

The design
----------
A session token is a compact HMAC-signed statement by the server that it has
already verified an identity, and by which method:

    base64(payload) . hmac_sha256(secret, base64(payload))

Stateless on purpose. A server-side session table would need to survive the
ephemeral filesystem this deployment runs on, and a session store that
silently empties on redeploy logs everyone out at the worst moment. The
signature is self-validating, so it works across restarts and across workers
with no shared state.

`methods` records HOW each identity was proven — "signature" for a wallet that
produced a valid EIP-191 signature, "oauth" for an ORCID that completed the
authorisation-code flow. Linking both produces a token carrying both, which is
what makes a two-factor claim meaningful rather than decorative: the holder
demonstrably controls a private key AND an ORCID account.
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import time
from typing import Dict, Optional

try:
    from config import ETH_ADMIN_PRIVATE_KEY, DEPLOYMENT_FINGERPRINT, OWNER_ID
except ImportError:  # pragma: no cover - import shim for tests
    ETH_ADMIN_PRIVATE_KEY = ""
    DEPLOYMENT_FINGERPRINT = "unconfigured"
    OWNER_ID = ""

# Sessions last a working day. Long enough not to interrupt someone mid-task,
# short enough that a token copied out of a browser has a bounded life.
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", str(12 * 3600)))


def _secret() -> bytes:
    """Key used to sign session tokens.

    Prefers a dedicated SESSION_SECRET. Falls back to material that is already
    deployment-specific so that tokens are never signed with a predictable key
    — but a deployment that sets neither gets a key derived from the public
    fingerprint alone, which is guessable, so that case is refused outright
    rather than pretending to be secure.
    """
    explicit = os.getenv("SESSION_SECRET", "").strip()
    if explicit:
        return hashlib.sha256(explicit.encode()).digest()
    if ETH_ADMIN_PRIVATE_KEY:
        return hashlib.sha256(f"session:{ETH_ADMIN_PRIVATE_KEY}".encode()).digest()
    return b""


def sessions_available() -> bool:
    """False when no signing secret exists, so callers can say why."""
    return bool(_secret())


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: str) -> str:
    return hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()


def issue_session(wallet: str = "", orcid: str = "", methods: Optional[Dict] = None) -> str:
    """Mint a token asserting these identities were verified. "" if not possible."""
    if not sessions_available():
        logging.warning("Cannot issue a session: no SESSION_SECRET or admin key configured.")
        return ""
    wallet = (wallet or "").strip()
    orcid = (orcid or "").strip()
    if not wallet and not orcid:
        return ""
    payload = json.dumps({
        "w": wallet.lower(),
        "o": orcid,
        "m": methods or {},
        "iat": int(time.time()),
        "exp": int(time.time()) + SESSION_TTL_SECONDS,
    }, separators=(",", ":"), sort_keys=True)
    encoded = _b64(payload.encode())
    return f"{encoded}.{_sign(encoded)}"


def verify_session(token: str) -> Optional[Dict]:
    """Return the verified claims, or None. Never raises."""
    if not token or "." not in token or not sessions_available():
        return None
    encoded, _, signature = token.rpartition(".")
    # compare_digest, not ==, so a forged token cannot be refined byte by byte
    # from response timing.
    if not hmac.compare_digest(signature, _sign(encoded)):
        return None
    try:
        claims = json.loads(_unb64(encoded).decode())
    except Exception:
        return None
    if int(claims.get("exp", 0)) < time.time():
        return None
    return {
        "wallet": claims.get("w", ""),
        "orcid": claims.get("o", ""),
        "methods": claims.get("m", {}),
        "expires_at": claims.get("exp", 0),
    }


def token_from_request(request) -> str:
    """Read the token from the Authorization header, then a query parameter.

    The header is preferred because query strings end up in access logs and
    browser history. The query fallback exists for links a user opens directly
    (the owner's bug-report view), where a header cannot be set.
    """
    header = ""
    try:
        header = request.headers.get("authorization", "") or ""
    except Exception:
        pass
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    try:
        return (request.query_params.get("token") or "").strip()
    except Exception:
        return ""


def identity_from_request(request, wallet_param: str = "", orcid_param: str = "") -> Dict:
    """Resolve who is calling, and whether it was proven.

    Returns the verified identity when a valid token is present. Otherwise it
    echoes back the claimed parameters with ``verified=False`` — callers must
    decide what that is good enough for. Reading public aggregates: fine.
    Reading someone's history, deleting their work, or acting as the owner:
    not remotely.
    """
    claims = verify_session(token_from_request(request))
    if claims:
        return {
            "wallet": claims["wallet"], "orcid": claims["orcid"],
            "verified": True, "methods": claims.get("methods", {}),
        }
    return {
        "wallet": (wallet_param or "").strip().lower(),
        "orcid": (orcid_param or "").strip(),
        "verified": False, "methods": {},
    }


def is_owner(identity: Dict) -> bool:
    """Owner authorisation. Requires a PROVEN wallet, never a claimed one.

    OWNER_ID is public — it is served at /api/chain/status — so comparing it to
    an unauthenticated parameter authorised anybody who could read that page.
    """
    if not identity.get("verified"):
        return False
    if not OWNER_ID:
        return False
    return identity.get("wallet", "").lower() == OWNER_ID.lower()
