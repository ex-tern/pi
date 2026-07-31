"""
Bug reports: stored first, mailed second.

The ordering is the whole design. Mail is the failure-prone half of this
feature — credentials expire, providers throttle, hosts block outbound port
587 — and a report that a user was told had been sent, but which was silently
dropped, is worse than a feature that does not exist. So every report is
committed to the database before any network call is attempted, and the
delivery outcome is recorded against the row. Nothing a user takes the trouble
to write can be lost by a mail failure.

Mail is also sent on a background thread. A user pressing "Send report" should
not wait on an SMTP handshake, and an unreachable mail server must not hold the
request open until the gateway times out — which would present as the very
class of bug people are most likely to be reporting.
"""
import re
import ssl
import smtplib
import logging
import threading
from datetime import datetime
from email.message import EmailMessage
from typing import Dict, Optional

try:
    from config import (BUG_REPORT_TO, SMTP_HOST, SMTP_PORT, SMTP_USER,
                        SMTP_PASSWORD, SMTP_FROM, SMTP_USE_TLS, ENVIRONMENT)
except ImportError:  # pragma: no cover - import shim for tests
    BUG_REPORT_TO = "a.vafadaryengejeh@campus.unimib.it"
    SMTP_HOST = SMTP_USER = SMTP_PASSWORD = SMTP_FROM = ""
    SMTP_PORT = 587
    SMTP_USE_TLS = True
    ENVIRONMENT = "development"

MAX_MESSAGE_CHARS = 5000
MAX_CONTACT_CHARS = 200

# Deliberately permissive: this validates shape, not deliverability. Rejecting
# an unusual-but-valid address would lose a report, which costs more than
# accepting one that later bounces.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def smtp_configured() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def delivery_status() -> Dict:
    """What the UI should promise the user before they type anything.

    If mail is not configured, the form still works and still stores the
    report — but it must not claim the message was emailed.
    """
    return {
        "recipient": BUG_REPORT_TO,
        "email_enabled": smtp_configured(),
        "note": (
            "Your report is sent by email and also stored on the server."
            if smtp_configured() else
            "Email delivery is not configured on this deployment, so your report is stored "
            "on the server for the maintainer to read. It will not be lost."
        ),
    }


def validate(message: str, contact: str = "") -> Optional[str]:
    """Returns an error string, or None when the report is acceptable."""
    message = (message or "").strip()
    if len(message) < 10:
        return "Please describe the problem in a little more detail (at least 10 characters)."
    if len(message) > MAX_MESSAGE_CHARS:
        return f"Report is too long (max {MAX_MESSAGE_CHARS:,} characters)."
    contact = (contact or "").strip()
    if contact:
        if len(contact) > MAX_CONTACT_CHARS:
            return "Contact address is too long."
        if not _EMAIL_RE.match(contact):
            return "That does not look like a valid email address. Leave it blank to report anonymously."
    return None


def _header_safe(value: str) -> str:
    """Strip CR/LF from anything interpolated into a mail header.

    A newline in a user-supplied header value lets the sender inject arbitrary
    additional headers — extra Bcc recipients, a forged Reply-To — turning this
    form into an open relay. The contact address reaches the Reply-To header,
    so it is untrusted input in a header position and must be flattened.
    """
    return re.sub(r"[\r\n]+", " ", str(value or "")).strip()[:MAX_CONTACT_CHARS]


def build_message(report: Dict) -> EmailMessage:
    msg = EmailMessage()
    summary = _header_safe(report.get("message", ""))[:60] or "Bug report"
    msg["Subject"] = f"[ScholarPi] Bug report #{report.get('id', '?')}: {summary}"
    msg["From"] = SMTP_FROM
    msg["To"] = BUG_REPORT_TO
    contact = _header_safe(report.get("contact", ""))
    if contact and _EMAIL_RE.match(contact):
        # Lets the maintainer reply straight to the reporter. Only set when the
        # address passed validation, so a malformed value cannot land here.
        msg["Reply-To"] = contact

    # The body carries the context that makes a report actionable without a
    # follow-up round trip: what they were doing, what the client was, and
    # which identity (if any) it happened under.
    body = [
        f"Report #{report.get('id', '?')}",
        f"Received:  {report.get('created_at', '')}",
        f"Contact:   {contact or '(not provided)'}",
        f"Identity:  {report.get('identity') or '(anonymous)'}",
        f"Page:      {report.get('page') or '(unknown)'}",
        f"Env:       {ENVIRONMENT}",
        "",
        "--- Report ---",
        str(report.get("message", "")).strip(),
    ]
    if report.get("user_agent"):
        body += ["", "--- Client ---", str(report["user_agent"])[:500]]
    msg.set_content("\n".join(body))
    return msg


def send_email(report: Dict) -> Dict:
    """Attempt delivery. Never raises — the caller has already stored the row."""
    if not smtp_configured():
        return {"sent": False, "error": "SMTP is not configured on this deployment."}
    try:
        msg = build_message(report)
        if SMTP_PORT == 465:
            # Implicit TLS: the socket is encrypted from the first byte, so
            # STARTTLS is neither needed nor available on this port.
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
        # The exception text can name the mail host and the account, so it is
        # logged rather than returned to the browser.
        logging.warning("Bug report #%s email delivery failed: %s: %s",
                        report.get("id"), type(e).__name__, e)
        return {"sent": False, "error": f"{type(e).__name__}: {e}"[:300]}


def send_async(report: Dict, on_result=None):
    """Deliver off the request thread.

    The user's confirmation depends on the report being *stored*, which has
    already happened by the time this is called. Blocking their request on an
    SMTP handshake would add a multi-second wait, and a hung mail server would
    stall the request until the gateway killed it.
    """
    def run():
        result = send_email(report)
        if on_result:
            try:
                on_result(report.get("id"), result)
            except Exception:
                logging.exception("Bug report delivery callback failed")

    threading.Thread(target=run, name="bugreport-mail", daemon=True).start()


def normalise(message: str, contact: str, identity: str, page: str,
              user_agent: str, report_id=None) -> Dict:
    return {
        "id": report_id,
        "message": (message or "").strip()[:MAX_MESSAGE_CHARS],
        "contact": (contact or "").strip()[:MAX_CONTACT_CHARS],
        "identity": (identity or "").strip()[:120],
        "page": (page or "").strip()[:120],
        "user_agent": (user_agent or "").strip()[:500],
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
