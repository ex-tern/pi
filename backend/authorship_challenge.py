"""
Proving authorship by controlling the corresponding-author address.

Why this exists
---------------
The other authorship tiers all fail in the same place. Publisher-deposited
ORCID is decisive but only exists once a work is formally published with the
ORCID attached. An ORCID profile listing the work is good evidence but must be
added by the researcher first. Name matching — comparing an ORCID display name
to the extracted author line — is the fallback, and it is exactly what a
fabricated identity defeats: create an ORCID reading "Ali Vafadar Yengejeh",
upload that person's preprint, collect their piQ.

A manuscript names its corresponding author's email address, in the document
itself, put there by the authors. Sending a one-time code to that address and
requiring it back proves control of the mailbox the paper nominates. It works
for preprints with no DOI, for unaffiliated researchers with no institutional
address, and it cannot be satisfied by inventing a username.

The one rule that makes it work
-------------------------------
The address must come from the MANUSCRIPT, never from the request. If a
claimant could nominate where the code is sent, the whole mechanism reduces to
"type an address you control", which is the attack it exists to stop. Callers
select from addresses found in the document, by index, and only ever see them
masked.
"""
import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

# Codes are short because they are typed by hand, and short is safe here only
# because attempts are capped and the window is narrow.
CODE_LENGTH = 6
CODE_TTL_MINUTES = 30
MAX_ATTEMPTS = 5

# Addresses that appear in papers but never belong to a corresponding author.
_NON_AUTHOR_DOMAINS = {
    "example.com", "example.org", "doi.org", "crossref.org", "orcid.org",
    "elsevier.com", "springer.com", "wiley.com", "nature.com", "arxiv.org",
    "biorxiv.org", "medrxiv.org", "researchgate.net", "editorialmanager.com",
}
_NON_AUTHOR_LOCALS = {
    "support", "info", "help", "noreply", "no-reply", "editor", "editorial",
    "permissions", "subscriptions", "admin", "webmaster", "privacy", "legal",
}

_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")

# Text near an address that marks it as the corresponding author's.
_CORRESPONDING_HINTS = (
    "correspond", "corresponding author", "to whom correspondence",
    "email:", "e-mail:", "contact:", "∗", "*",
)


def extract_candidate_emails(paper_text: str, limit: int = 5) -> List[Dict]:
    """Addresses in the manuscript that could belong to a corresponding author.

    Ordered by how strongly the surrounding text marks them as such, then by
    position — corresponding-author details sit in the front matter, while a
    publisher's contact address is usually in the footer.
    """
    if not paper_text:
        return []

    found, seen = [], set()
    for m in _EMAIL_RE.finditer(paper_text):
        address = m.group(0).strip().strip(".,;:")
        lower = address.lower()
        if lower in seen:
            continue
        local, _, domain = lower.partition("@")
        if domain in _NON_AUTHOR_DOMAINS or local in _NON_AUTHOR_LOCALS:
            continue
        seen.add(lower)

        # Score the 200 characters before the address: an explicit
        # "Corresponding author:" is far stronger evidence than proximity alone.
        window = paper_text[max(0, m.start() - 200):m.start()].lower()
        score = sum(3 for h in _CORRESPONDING_HINTS[:3] if h in window)
        score += sum(1 for h in _CORRESPONDING_HINTS[3:] if h in window)
        # Front matter beats the footer.
        if m.start() < 4000:
            score += 2
        found.append({"email": address, "score": score, "position": m.start()})

    found.sort(key=lambda e: (-e["score"], e["position"]))
    return found[:limit]


def mask_email(address: str) -> str:
    """Show enough to recognise an address, not enough to learn one.

    The endpoint that lists candidates is reachable by anyone who can submit a
    paper, so returning author emails in full would turn this feature into a
    scraper for exactly the addresses academics most want protected.
    """
    address = (address or "").strip()
    local, sep, domain = address.partition("@")
    if not sep:
        return "…"
    if len(local) <= 2:
        shown = local[:1] + "…"
    else:
        shown = local[0] + "…" + local[-1]
    parts = domain.split(".")
    if len(parts) >= 2:
        host = parts[0]
        host_shown = host[0] + "…" if len(host) > 3 else host
        domain = ".".join([host_shown] + parts[1:])
    return f"{shown}@{domain}"


def generate_code() -> str:
    """A numeric code, uniform over its range."""
    return "".join(str(secrets.randbelow(10)) for _ in range(CODE_LENGTH))


def hash_code(code: str, eval_hash: str, secret: str) -> str:
    """Codes are stored hashed and salted per paper.

    A challenge table read from a database backup should not hand over live
    codes, and binding the hash to the evaluation hash stops a code issued for
    one paper being replayed against another.
    """
    return hmac.new(
        (secret or "scholarpi-challenge").encode(),
        f"{eval_hash}:{code}".encode(),
        hashlib.sha256,
    ).hexdigest()


def is_expired(created_at) -> bool:
    if not created_at:
        return True
    if isinstance(created_at, str):
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
            try:
                created_at = datetime.strptime(created_at, fmt)
                break
            except ValueError:
                continue
        else:
            return True
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - created_at > timedelta(minutes=CODE_TTL_MINUTES)


def build_message(code: str, title: str, masked: str) -> Dict:
    """Subject and body for the challenge email.

    Written for someone who did not expect it: an unrequested code with no
    context reads as phishing, and the honest response to that is to explain
    what is being claimed and to say plainly that ignoring it is safe.
    """
    subject = f"[ScholarPi] Confirm authorship of “{title[:60]}”"
    body = (
        f"Someone has submitted the following manuscript to ScholarPi and is claiming\n"
        f"authorship of it:\n\n"
        f"    {title[:120]}\n\n"
        f"This address ({masked}) is listed in the manuscript as a contact for the\n"
        f"authors, so we are asking you to confirm.\n\n"
        f"    Confirmation code: {code}\n\n"
        f"The code expires in {CODE_TTL_MINUTES} minutes.\n\n"
        f"If this was you, enter the code in ScholarPi to release the piQ earned by\n"
        f"the assessment.\n\n"
        f"If this was NOT you, ignore this email. No code, no claim — nothing happens,\n"
        f"and no piQ is transferred to anyone. You do not need to reply or take any\n"
        f"action.\n\n"
        f"ScholarPi assesses manuscripts against CoARA-aligned reporting criteria.\n"
    )
    return {"subject": subject, "body": body}


def send_challenge(to_address: str, code: str, title: str) -> Dict:
    """Deliver the code. Never raises."""
    try:
        import smtplib
        import ssl
        from email.message import EmailMessage
        from config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_USE_TLS
    except Exception as e:
        return {"sent": False, "error": f"Mail is not configured: {e}"}

    if not (SMTP_HOST and SMTP_FROM):
        return {"sent": False, "error": "SMTP is not configured on this deployment."}

    content = build_message(code, title, mask_email(to_address))
    try:
        msg = EmailMessage()
        msg["Subject"] = content["subject"]
        msg["From"] = SMTP_FROM
        msg["To"] = to_address
        msg.set_content(content["body"])
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20,
                                  context=ssl.create_default_context()) as server:
                if SMTP_USER:
                    server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(msg)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
                if SMTP_USE_TLS:
                    server.starttls(context=ssl.create_default_context())
                if SMTP_USER:
                    server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(msg)
        return {"sent": True, "error": None}
    except Exception as e:
        # The address is not echoed into the error: a failure message that
        # confirms an address exists is itself a disclosure.
        logging.warning("Authorship challenge delivery failed: %s: %s", type(e).__name__, e)
        return {"sent": False, "error": f"{type(e).__name__}"}
