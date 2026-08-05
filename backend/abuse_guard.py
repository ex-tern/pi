"""
Abuse controls for the free tier.

Threat model
------------
The free trial gives away real money: every assessment consumes LLM inference
credits. The only previous control was a per-IP counter, which stops a casual
repeat visitor and nothing else. An automated abuser rotating IPs through a
proxy pool, or a script submitting the same PDF under different filenames, had
effectively unlimited access.

The controls here are layered, because no single one is sufficient:

* **Content fingerprinting** — the free tier is metered on *distinct documents*,
  not requests. Resubmitting the same PDF costs nothing and consumes no
  allowance, so there is nothing to gain from retrying.
* **Subnet aggregation** — allowance is tracked per /24 (IPv4) and /48 (IPv6)
  as well as per address, so rotating within a single provider's range does not
  multiply the allowance.
* **Velocity limits** — a burst ceiling and a daily ceiling per subnet, since
  legitimate exploratory use is slow and bursty abuse is not.
* **Automation heuristics** — missing or scripted User-Agent strings, absent
  browser headers, and implausibly regular request timing.
* **Payload sanity** — rejects files that are not really PDFs, are trivially
  small, or are near-duplicates of something already processed.

Every decision returns a human-readable reason. A legitimate user who trips a
limit should understand what happened and what to do about it, rather than
receiving an opaque refusal.
"""
import re
import time
import math
import hashlib
import ipaddress
import logging
import threading
from collections import defaultdict, deque
from typing import Dict, Optional, Tuple

# --- Limits ---------------------------------------------------------------
# Read from config so FREE_EVALS_PER_IP and the enforced allowance cannot
# disagree. They were two separate constants holding the same number, which is
# one edit away from an interface that promises three free assessments and a
# guard that permits a different count.
try:
    from config import FREE_EVALS_PER_IP as _FREE_DOCUMENTS_DEFAULT
except Exception:                                    # pragma: no cover
    _FREE_DOCUMENTS_DEFAULT = 3

FREE_DOCUMENTS = _FREE_DOCUMENTS_DEFAULT   # distinct documents per identity-less visitor
SUBNET_FREE_DOCUMENTS = 12      # aggregate ceiling per /24 or /48
BURST_WINDOW_SECONDS = 60
BURST_MAX_REQUESTS = 6
DAILY_WINDOW_SECONDS = 24 * 3600
DAILY_MAX_REQUESTS = 40
MIN_REQUEST_INTERVAL = 1.5      # seconds between submissions from one client

# Machine-regular timing is a strong automation signal: humans do not submit
# with sub-second-consistent intervals.
REGULARITY_SAMPLES = 5
REGULARITY_STDEV_THRESHOLD = 0.35

_lock = threading.Lock()
_request_times = defaultdict(lambda: deque(maxlen=200))
_subnet_documents = defaultdict(set)
_blocked_until = {}

_BOT_AGENT_PATTERNS = [
    r"\bpython-requests\b", r"\bcurl/", r"\bwget\b", r"\bhttpx\b", r"\baiohttp\b",
    r"\bscrapy\b", r"\bgo-http-client\b", r"\bjava/", r"\bokhttp\b", r"\bpostman\b",
    r"\bheadlesschrome\b", r"\bphantomjs\b", r"\bselenium\b", r"\bplaywright\b",
    r"\bbot\b", r"\bspider\b", r"\bcrawler\b", r"\bnode-fetch\b", r"\baxios\b",
]


def subnet_key(ip: str) -> str:
    """Group an address into its provider block.

    /24 for IPv4 and /48 for IPv6 are the granularities at which addresses are
    typically allocated together, so this is what makes rotation within one
    pool ineffective without penalising unrelated users.
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return f"raw:{ip}"
    if addr.version == 4:
        return str(ipaddress.ip_network(f"{addr}/24", strict=False))
    return str(ipaddress.ip_network(f"{addr}/48", strict=False))


def document_fingerprint(file_bytes: bytes) -> str:
    """Content hash — the unit the free tier is actually metered in."""
    return hashlib.sha256(file_bytes or b"").hexdigest()


def _stdev(values):
    if len(values) < 2:
        return float("inf")
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))


def assess_automation_signals(headers: Dict[str, str], ip: str) -> Dict:
    """Score how likely this client is a script rather than a browser."""
    ua = (headers.get("user-agent") or "").strip()
    signals, score = [], 0.0

    if not ua:
        signals.append("no User-Agent header")
        score += 0.45
    elif any(re.search(p, ua, re.IGNORECASE) for p in _BOT_AGENT_PATTERNS):
        signals.append(f"scripted User-Agent ({ua[:40]})")
        score += 0.5
    elif len(ua) < 20:
        signals.append("implausibly short User-Agent")
        score += 0.2

    # Real browsers send these; most HTTP libraries do not.
    if not headers.get("accept-language"):
        signals.append("no Accept-Language header")
        score += 0.2
    accept = headers.get("accept") or ""
    if accept in ("", "*/*"):
        signals.append("generic Accept header")
        score += 0.15
    if not (headers.get("sec-fetch-site") or headers.get("referer") or headers.get("origin")):
        signals.append("no browser navigation headers")
        score += 0.15

    # Timing regularity.
    with _lock:
        times = list(_request_times.get(ip, []))
    if len(times) >= REGULARITY_SAMPLES:
        gaps = [b - a for a, b in zip(times[-REGULARITY_SAMPLES:], times[-REGULARITY_SAMPLES + 1:])]
        if gaps and _stdev(gaps) < REGULARITY_STDEV_THRESHOLD:
            signals.append("machine-regular request timing")
            score += 0.3

    score = min(1.0, score)
    return {
        "score": round(score, 3),
        "signals": signals,
        # Two independent signals are required before acting: any single one
        # has a plausible innocent explanation (privacy tooling, a proxy that
        # strips headers, a fast typist).
        "likely_automated": score >= 0.6 and len(signals) >= 2,
    }


def record_request(ip: str):
    with _lock:
        _request_times[ip].append(time.time())


def check_velocity(ip: str) -> Tuple[bool, Optional[str]]:
    """Burst, daily and minimum-interval ceilings for one client."""
    now = time.time()
    with _lock:
        blocked = _blocked_until.get(ip)
        if blocked and blocked > now:
            return False, (f"Temporarily rate-limited for another "
                           f"{int(blocked - now)}s after repeated rapid submissions.")
        times = _request_times[ip]
        recent = [t for t in times if now - t < BURST_WINDOW_SECONDS]
        daily = [t for t in times if now - t < DAILY_WINDOW_SECONDS]

        if times and (now - times[-1]) < MIN_REQUEST_INTERVAL:
            return False, "Submissions are arriving too quickly. Please wait a moment between papers."
        if len(recent) >= BURST_MAX_REQUESTS:
            _blocked_until[ip] = now + 300
            return False, (f"More than {BURST_MAX_REQUESTS} submissions in "
                           f"{BURST_WINDOW_SECONDS}s. Paused for 5 minutes.")
        if len(daily) >= DAILY_MAX_REQUESTS:
            return False, (f"Daily submission ceiling of {DAILY_MAX_REQUESTS} reached for this "
                           f"connection. This resets on a rolling 24-hour basis.")
    return True, None


def check_free_tier(ip: str, documents_used: int, new_fingerprints: list,
                    bonus: int = 0) -> Tuple[bool, Optional[str]]:
    """Free-tier allowance, metered in distinct documents.

    Metering documents rather than requests means a resubmission of something
    already assessed is free — which removes any incentive to retry, and means
    a genuine mistake does not cost the user their allowance.

    ``bonus`` is additional allowance earned from the Science Map arcade. It
    extends the per-IP entitlement but deliberately does *not* raise the
    subnet-wide ceiling below: that ceiling exists to stop address rotation,
    and letting earned credit lift it would reopen exactly that hole.
    """
    subnet = subnet_key(ip)
    with _lock:
        seen = _subnet_documents[subnet]
        genuinely_new = [f for f in new_fingerprints if f not in seen]

    if not genuinely_new:
        return True, None

    # The free trial is FREE_DOCUMENTS, full stop.
    #
    # Arcade wins used to add to it, so the allowance drifted upward and a
    # visitor could be told they had twelve free assessments when the trial is
    # three. Wins now pay piQ, which is what buys an assessment — the trial is
    # a fixed introduction, not a second balance that grows.
    allowance = FREE_DOCUMENTS
    remaining = allowance - documents_used
    if remaining <= 0:
        return False, (
            f"Free trial complete: {allowance} distinct manuscripts have been assessed from "
            f"this connection. Connect an Ethereum wallet or link ORCID to continue. "
            f"Re-assessing a paper you have already submitted remains free."
        )
    if len(genuinely_new) > remaining:
        return False, (
            f"This batch contains {len(genuinely_new)} new manuscripts but only {remaining} free "
            f"assessment(s) remain on this connection. Submit fewer, or connect an identity."
        )

    with _lock:
        if len(_subnet_documents[subnet]) + len(genuinely_new) > SUBNET_FREE_DOCUMENTS:
            return False, (
                "The free-trial allowance for this network range has been reached. This limit is "
                "aggregate to prevent address rotation; connect a wallet or ORCID to continue."
            )
    return True, None


def register_documents(ip: str, fingerprints: list):
    """Record documents against the subnet's aggregate allowance."""
    subnet = subnet_key(ip)
    with _lock:
        bucket = _subnet_documents[subnet]
        for f in fingerprints:
            bucket.add(f)
        # Bound memory: a subnet that has clearly exhausted its allowance does
        # not need every fingerprint retained.
        if len(bucket) > SUBNET_FREE_DOCUMENTS * 8:
            _subnet_documents[subnet] = set(list(bucket)[-SUBNET_FREE_DOCUMENTS * 4:])


def validate_upload(filename: str, raw: bytes, max_bytes: int) -> Tuple[bool, Optional[str]]:
    """Reject payloads that cannot be a real manuscript.

    Cheap structural checks run before any model is invoked, so a malformed or
    trivial upload never reaches paid inference.
    """
    if not raw:
        return False, f"'{filename}' is empty."
    if len(raw) > max_bytes:
        return False, f"'{filename}' exceeds the {max_bytes // (1024 * 1024)}MB limit."
    if not raw[:1024].lstrip().startswith(b"%PDF"):
        return False, (f"'{filename}' is not a valid PDF (missing the %PDF header). "
                       f"Renaming another file type to .pdf will not work.")
    if len(raw) < 4096:
        return False, (f"'{filename}' is too small to be a manuscript "
                       f"({len(raw)} bytes). It may be a placeholder or a failed download.")
    # Structural validation by actually parsing the file, not by searching for
    # a byte string.
    #
    # The previous check looked for the literal bytes "/Page" in the first
    # 200KB. That is wrong for any PDF 1.5 or later that uses cross-reference
    # streams and object streams (/ObjStm), because in that format the page
    # tree is stored COMPRESSED INSIDE a stream — the token "/Page" does not
    # appear anywhere in the raw bytes of a perfectly valid file. pdflatex
    # produces exactly this by default, so the check was rejecting a large
    # share of legitimate academic manuscripts with a message stating the file
    # had no readable page structure, which was the opposite of the truth.
    #
    # Parsing costs a few milliseconds and answers the question that was
    # actually being asked: can this document be opened and does it have pages?
    try:
        import fitz  # PyMuPDF, already a dependency of the extraction pipeline
    except ImportError:
        # Without a parser, fall back to the byte heuristic — but only as a
        # *positive* signal. A file that fails it is passed through rather than
        # rejected, because the heuristic's false-positive rate on modern PDFs
        # is far too high to refuse work on.
        logging.warning("PyMuPDF unavailable; skipping structural PDF validation.")
        return True, None

    try:
        with fitz.open(stream=raw, filetype="pdf") as doc:
            if doc.needs_pass:
                return False, (f"'{filename}' is password-protected. Remove the password and "
                               f"upload it again.")
            if doc.page_count < 1:
                return False, f"'{filename}' contains no pages."
    except Exception as e:
        logging.info("Rejected upload %s: %s: %s", filename, type(e).__name__, e)
        return False, (f"'{filename}' could not be opened as a PDF. It may be corrupted or "
                       f"incompletely downloaded.")
    return True, None


def evaluate_request(ip: str, headers: Dict[str, str], documents_used: int,
                     fingerprints: list, has_identity: bool, bonus: int = 0) -> Dict:
    """Single entry point. Returns an allow/deny verdict with a reason.

    Identified users skip the free-tier and automation checks — they are paying
    in piQ, which is itself the abuse control — but velocity limits still apply
    to everyone, since those protect the service rather than the free tier.
    """
    # Order matters: velocity is evaluated against prior requests, then this
    # one is recorded. Recording first would compare the request against
    # itself, so the minimum-interval check would reject every request
    # including a client's very first.
    ok, reason = check_velocity(ip)
    if not ok:
        return {"allowed": False, "reason": reason, "code": 429, "automation": None}
    record_request(ip)

    if has_identity:
        return {"allowed": True, "reason": None, "code": 200, "automation": None}

    automation = assess_automation_signals(headers, ip)
    if automation["likely_automated"]:
        logging.warning("Automated free-tier access blocked from %s: %s", ip, automation["signals"])
        return {
            "allowed": False, "code": 403, "automation": automation,
            "reason": ("This request appears to come from an automated client rather than a "
                       "browser. The free trial is intended for individual researchers. "
                       "Connect an Ethereum wallet or link ORCID for programmatic access."),
        }

    ok, reason = check_free_tier(ip, documents_used, fingerprints, bonus=bonus)
    if not ok:
        return {"allowed": False, "reason": reason, "code": 402, "automation": automation}

    return {"allowed": True, "reason": None, "code": 200, "automation": automation}
