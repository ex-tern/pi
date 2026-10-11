"""routes/identity.py: who is asking: the owner, a signed-in identity, profile and arcade keys. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403

router = APIRouter()



# --------------------------------------------------------------------------
# Science Map arcade
#
# The reward is real allowance, so the server replays every submitted run
# rather than believing a reported score. See arcade.py for the reasoning.
# --------------------------------------------------------------------------
def require_owner(request: Request, wallet: str = "") -> dict:
    """Authorise an owner-only action against a PROVEN wallet.

    Every owner endpoint previously compared OWNER_ID to an unauthenticated
    query parameter — and OWNER_ID is published at /api/chain/status. Reading
    one public field was therefore sufficient to obtain provider diagnostics,
    other users' bug reports, backup control, corpus rescoring and SciLM (siM)
    reset. This requires a session token minted only after a valid EIP-191
    signature from that wallet.
    """
    identity = auth.identity_from_request(request, wallet)
    if auth.is_owner(identity):
        return identity
    if not auth.sessions_available():
        raise HTTPException(
            status_code=503,
            detail=("Owner actions are disabled: this deployment has no SESSION_SECRET or admin "
                    "key, so a session cannot be signed and ownership cannot be proven."),
        )
    raise HTTPException(
        status_code=403,
        detail=("Owner authorisation requires a signed session. Connect the owner wallet and "
                "sign the login message; passing the address alone is not proof of control."),
    )


def require_identity(request: Request, wallet: str = "", orcid: str = "") -> dict:
    """Authorise an action on a user's own data against a PROVEN identity."""
    identity = auth.identity_from_request(request, wallet, orcid)
    if identity["verified"] and (identity["wallet"] or identity["orcid"]):
        return identity
    if not auth.sessions_available():
        raise HTTPException(
            status_code=503,
            detail=("Identity-scoped features are disabled: this deployment cannot sign "
                    "sessions. Set SESSION_SECRET to enable them."),
        )
    raise HTTPException(
        status_code=401,
        detail=("Sign in to access your own records. Connect a wallet and sign the login "
                "message, or link ORCID."),
    )


def _profile_key(wallet: str = "", orcid: str = "") -> str:
    """One stable key per identity. ORCID wins when both are present, since it
    survives a wallet change and is the more durable research identity."""
    if orcid:
        return f"orcid:{orcid}"
    if wallet:
        return f"wallet:{wallet.lower()}"
    return ""


def _identity_values(wallet: str = "", orcid: str = "") -> list:
    """Every form this identity may appear as in `papers_assessment.user_id`.

    The assessment pipeline writes the RAW identifier (`user_id = orcid if
    orcid else wallet`), while profiles, arcade progress and bug reports use a
    namespaced `orcid:`/`wallet:` key. Anything that joins the two must accept
    both, or it silently matches nothing — which is exactly what made the
    assessment history appear empty for signed-in users.

    Wallet addresses are included in several casings because EIP-55 checksum
    casing is what a wallet reports, but a lowercase form is what a normalised
    key contains, and SQLite's `=` is case-sensitive for text.
    """
    values = []
    orcid = (orcid or "").strip()
    wallet = (wallet or "").strip()
    if orcid:
        values += [orcid, f"orcid:{orcid}"]
    if wallet:
        values += [wallet, wallet.lower(), f"wallet:{wallet.lower()}"]
    # Order-preserving dedupe.
    seen, out = set(), []
    for v in values:
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def _display_name(wallet: str = "", orcid: str = "") -> str:
    """A public label for a player that is not their full credential.

    A leaderboard is public. Printing a full wallet address or ORCID on it
    would publish a durable identifier next to a game score, which nobody
    signing in to assess a paper agreed to.
    """
    if orcid:
        return f"ORCID …{orcid[-4:]}" if len(orcid) > 4 else "ORCID researcher"
    if wallet and len(wallet) > 12:
        return f"{wallet[:6]}…{wallet[-4:]}"
    return ""


def _arcade_key(request: Request, wallet: str = "", orcid: str = ""):
    """Who this run belongs to, and whether that is a real identity.

    Difficulty must persist across refreshes, so it cannot live in the browser.
    A signed-in player is keyed to their identity; everyone else falls back to
    a hashed IP, which is enough to hold a ramp but is explicitly NOT treated
    as a person for leaderboard purposes.
    """
    key = _profile_key(wallet, orcid)
    if key:
        return key, True
    ip = get_client_ip(request)
    return "ip:" + hashlib.sha256(f"arcade:{ip}".encode()).hexdigest()[:32], False
