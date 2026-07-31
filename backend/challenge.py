"""
Proof-of-work challenge for free-tier submissions.

Why proof-of-work rather than a visual CAPTCHA
----------------------------------------------
Image CAPTCHAs no longer separate humans from automated agents: commercial
solvers and multimodal models clear them at high accuracy and low cost, so the
puzzle mostly taxes legitimate users — disproportionately those using screen
readers. They also require a third-party service, which means embedding an
external tracker on a research tool whose entire premise is researcher
sovereignty.

A computational proof-of-work inverts the economics instead of testing
perception. Solving one challenge costs a browser roughly a second of CPU;
it is imperceptible for someone assessing a paper, and it makes bulk automated
submission expensive in exactly the dimension an abuser cares about. It needs
no third party, sets no cookies, collects no biometrics, and works identically
for assistive technology.

Design
------
* The server issues a random challenge and a difficulty, signed with HMAC. No
  server-side state is required to validate it later — the signature carries
  the parameters, so this survives restarts and multiple workers.
* The client searches for a nonce where ``sha256(challenge:nonce)`` begins with
  the required number of zero bits.
* Difficulty scales with observed pressure: a first-time visitor gets a trivial
  puzzle, and a client that has been submitting heavily gets a harder one. The
  cost lands on abusive patterns rather than on everyone.
* Solutions are single-use and short-lived, so a solved challenge cannot be
  replayed across a batch of submissions.

Cloudflare Turnstile is supported as an optional additional layer when keys are
configured, for operators who want a managed signal as well.
"""
import time
import hmac
import hashlib
import logging
import secrets
import threading
from typing import Dict, Optional, Tuple

try:
    from config import ETH_ADMIN_PRIVATE_KEY, TURNSTILE_SECRET_KEY
except ImportError:
    ETH_ADMIN_PRIVATE_KEY = ""
    TURNSTILE_SECRET_KEY = ""

# --- Tuning ---------------------------------------------------------------
# Leading zero bits required. 16 bits ≈ 65k hashes ≈ well under a second in a
# browser; 22 bits ≈ 4M hashes ≈ several seconds. The point is not to be
# unsolvable but to make thousands of submissions costly.
BASE_DIFFICULTY = 16
MAX_DIFFICULTY = 24
CHALLENGE_TTL_SECONDS = 300
_SECRET = (ETH_ADMIN_PRIVATE_KEY or "scholarpi_pow_seed").encode("utf-8")

_lock = threading.Lock()
_consumed = {}          # solution digest -> expiry, prevents replay
_recent_solves = {}     # ip -> [timestamps], drives adaptive difficulty


def _sign(payload: str) -> str:
    return hmac.new(_SECRET, payload.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def _prune(now: float):
    for digest, expiry in list(_consumed.items()):
        if expiry < now:
            _consumed.pop(digest, None)
    for ip, stamps in list(_recent_solves.items()):
        kept = [t for t in stamps if now - t < 3600]
        if kept:
            _recent_solves[ip] = kept
        else:
            _recent_solves.pop(ip, None)


def difficulty_for(ip: str) -> int:
    """Escalate with recent solve volume from the same client.

    A researcher assessing a handful of papers never leaves the base tier. A
    client solving continuously climbs until each puzzle costs real time, which
    is the behaviour that should be expensive.
    """
    now = time.time()
    with _lock:
        _prune(now)
        recent = len(_recent_solves.get(ip, []))
    return min(MAX_DIFFICULTY, BASE_DIFFICULTY + (recent // 3) * 2)


def issue_challenge(ip: str) -> Dict:
    """Mint a stateless, signed challenge."""
    nonce = secrets.token_hex(16)
    issued = int(time.time())
    difficulty = difficulty_for(ip)
    payload = f"{nonce}:{issued}:{difficulty}"
    return {
        "challenge": nonce,
        "issued_at": issued,
        "difficulty": difficulty,
        "signature": _sign(payload),
        "algorithm": "sha256-leading-zero-bits",
        "expires_in": CHALLENGE_TTL_SECONDS,
        "instructions": (
            "Find an integer nonce such that the SHA-256 of "
            "'<challenge>:<nonce>' begins with the required number of zero bits."
        ),
    }


def _leading_zero_bits(digest: bytes) -> int:
    bits = 0
    for byte in digest:
        if byte == 0:
            bits += 8
            continue
        # Count leading zeros within the first non-zero byte.
        for shift in range(7, -1, -1):
            if byte >> shift:
                break
            bits += 1
        break
    return bits


def verify_solution(ip: str, challenge: str, issued_at, difficulty,
                    signature: str, solution) -> Tuple[bool, Optional[str]]:
    """Validate a submitted proof of work.

    Every parameter is re-derived from the signature rather than trusted, so a
    client cannot lower its own difficulty or extend its own expiry.
    """
    try:
        issued_at = int(issued_at)
        difficulty = int(difficulty)
        solution = str(solution)
    except (TypeError, ValueError):
        return False, "Malformed challenge response."

    if not challenge or not signature:
        return False, "Missing challenge parameters."

    expected = _sign(f"{challenge}:{issued_at}:{difficulty}")
    if not hmac.compare_digest(expected, signature):
        return False, "Challenge signature is invalid."

    now = time.time()
    if now - issued_at > CHALLENGE_TTL_SECONDS:
        return False, "Challenge expired. Request a new one."
    if issued_at > now + 60:
        return False, "Challenge timestamp is in the future."
    if not (BASE_DIFFICULTY <= difficulty <= MAX_DIFFICULTY):
        return False, "Challenge difficulty is out of range."

    digest = hashlib.sha256(f"{challenge}:{solution}".encode("utf-8")).digest()
    if _leading_zero_bits(digest) < difficulty:
        return False, "Proof of work is insufficient."

    # Single use: a solved challenge cannot be replayed across submissions.
    fingerprint = hashlib.sha256(f"{challenge}:{solution}".encode()).hexdigest()
    with _lock:
        _prune(now)
        if fingerprint in _consumed:
            return False, "This challenge has already been used."
        _consumed[fingerprint] = now + CHALLENGE_TTL_SECONDS
        _recent_solves.setdefault(ip, []).append(now)
    return True, None


# ---------------------------------------------------------------------------
# Optional managed layer
# ---------------------------------------------------------------------------
def verify_turnstile(token: str, ip: str = "") -> Tuple[bool, Optional[str]]:
    """Validate a Cloudflare Turnstile token, when configured.

    Additive rather than a replacement: proof-of-work still applies, so the
    deployment does not depend on a third party being reachable.
    """
    if not TURNSTILE_SECRET_KEY:
        return True, None
    if not token:
        return False, "Verification token missing."
    try:
        from http_client import get_session
        res = get_session().post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={"secret": TURNSTILE_SECRET_KEY, "response": token, "remoteip": ip},
            timeout=8,
        )
        payload = res.json() if res.status_code == 200 else {}
        if payload.get("success"):
            return True, None
        return False, "Verification failed. Please try again."
    except Exception as e:
        # An outage at the verification provider must not lock out legitimate
        # users; proof-of-work remains in force either way.
        logging.warning("Turnstile verification unavailable: %s", e)
        return True, None
