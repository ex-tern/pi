"""consent.py -- permission requests with a confirm link.

The owner writes to an author ("may we feature your work?") and includes a
link. The link opens a page that states exactly what is being asked, and the
recipient answers with one click. The answer is kept as the written record.

    owner   POST /api/consent              create a request, get its link
    owner   GET  /api/consent              every request and its answers
    owner   POST /api/consent/{id}/close   stop accepting answers
    link    GET  /api/consent/r/{token}    what is being asked (public with the token)
    link    POST /api/consent/r/{token}    answer: granted or declined

DESIGN NOTES

  * The token in the link is the only credential the recipient has, so it is
    long (32 bytes, urlsafe) and random. Without it the request cannot be
    read or answered; with it, only that one request can be.
  * Answers are append-only. If the recipient changes their mind the new
    answer is recorded after the old one, and the latest one counts. A record
    that could be silently overwritten would not be a record.
  * Each answer stores what the recipient saw: the title and terms are
    copied into the answer, so editing a request later cannot change what
    someone agreed to.
  * Stored in its own SQLite file next to the main database. It touches no
    existing table, so it cannot affect assessments, ledgers or migrations.
"""

import hashlib
import json
import os
import secrets
import sqlite3
import time
from typing import Callable, List

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from api_helpers import client_ip

MAX_ANSWERS_PER_REQUEST = 50


class NewRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    recipient: str = Field(..., min_length=2, max_length=120)
    work: str = Field("", max_length=300)            # the work being asked about
    message: str = Field("", max_length=4000)        # shown above the terms
    terms: List[str] = Field(default_factory=list, max_length=20)
    requester: str = Field("", max_length=200)       # who is asking


class Answer(BaseModel):
    decision: str = Field(..., pattern="^(granted|declined)$")
    name: str = Field(..., min_length=2, max_length=120)
    note: str = Field("", max_length=2000)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def build_router(base_dir: str, require_owner: Callable) -> APIRouter:
    db_path = os.path.join(base_dir, "consent.db")
    router = APIRouter(prefix="/api/consent", tags=["consent"])

    def conn():
        os.makedirs(base_dir, exist_ok=True)
        c = sqlite3.connect(db_path, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("""CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL, recipient TEXT NOT NULL, work TEXT,
            message TEXT, terms TEXT NOT NULL, requester TEXT,
            created_at TEXT NOT NULL, closed_at TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id INTEGER NOT NULL REFERENCES requests(id),
            decision TEXT NOT NULL, name TEXT NOT NULL, note TEXT,
            answered_at TEXT NOT NULL,
            seen_title TEXT NOT NULL, seen_terms TEXT NOT NULL,
            ip TEXT, user_agent TEXT)""")
        return c

    def public_view(row) -> dict:
        return {
            "title": row["title"], "recipient": row["recipient"], "work": row["work"] or "",
            "message": row["message"] or "", "terms": json.loads(row["terms"]),
            "requester": row["requester"] or "", "created_at": row["created_at"],
            "closed": bool(row["closed_at"]),
        }

    def latest_answer(c, request_id):
        a = c.execute("SELECT decision, name, note, answered_at FROM answers WHERE request_id=? "
                      "ORDER BY id DESC LIMIT 1", (request_id,)).fetchone()
        return dict(a) if a else None

    def ip_of(request: Request) -> str:
        return client_ip(request, "")

    # ---------------------------------------------------------------- owner
    @router.post("")
    def create(body: NewRequest, request: Request):
        require_owner(request)
        terms = [t.strip()[:500] for t in body.terms if t and t.strip()]
        if not terms:
            raise HTTPException(status_code=400, detail="Add at least one term the recipient agrees to.")
        token = secrets.token_urlsafe(32)
        with conn() as c:
            cur = c.execute(
                "INSERT INTO requests (token, title, recipient, work, message, terms, requester, created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (token, body.title.strip(), body.recipient.strip(), body.work.strip(),
                 body.message.strip(), json.dumps(terms), body.requester.strip(), _now()))
            rid = cur.lastrowid
        return {"id": rid, "token": token, "path": "/confirm/?t=" + token}

    @router.get("")
    def list_all(request: Request):
        require_owner(request)
        out = []
        with conn() as c:
            for r in c.execute("SELECT * FROM requests ORDER BY id DESC").fetchall():
                answers = [dict(a) for a in c.execute(
                    "SELECT decision, name, note, answered_at, ip, user_agent FROM answers "
                    "WHERE request_id=? ORDER BY id", (r["id"],)).fetchall()]
                item = public_view(r)
                item.update({"id": r["id"], "path": "/confirm/?t=" + r["token"],
                             "status": answers[-1]["decision"] if answers else "pending",
                             "answers": answers})
                out.append(item)
        return {"requests": out}

    @router.post("/{rid}/close")
    def close(rid: int, request: Request):
        require_owner(request)
        with conn() as c:
            c.execute("UPDATE requests SET closed_at=? WHERE id=? AND closed_at IS NULL", (_now(), rid))
        return {"ok": True}

    # ---------------------------------------------------------------- recipient
    def by_token(c, token: str):
        if not token or len(token) > 100:
            raise HTTPException(status_code=404, detail="This link is not valid.")
        row = c.execute("SELECT * FROM requests WHERE token=?", (token,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="This link is not valid.")
        return row

    @router.get("/r/{token}")
    def view(token: str):
        with conn() as c:
            row = by_token(c, token)
            data = public_view(row)
            data["answer"] = latest_answer(c, row["id"])
        return data

    @router.post("/r/{token}")
    def answer(token: str, body: Answer, request: Request):
        with conn() as c:
            row = by_token(c, token)
            if row["closed_at"]:
                raise HTTPException(status_code=409, detail="This request has been closed by its sender.")
            n = c.execute("SELECT COUNT(*) FROM answers WHERE request_id=?", (row["id"],)).fetchone()[0]
            if n >= MAX_ANSWERS_PER_REQUEST:
                raise HTTPException(status_code=429, detail="Too many answers for this request.")
            when = _now()
            c.execute(
                "INSERT INTO answers (request_id, decision, name, note, answered_at, seen_title, "
                "seen_terms, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?)",
                (row["id"], body.decision, body.name.strip(), body.note.strip(), when,
                 row["title"], row["terms"], ip_of(request)[:64],
                 (request.headers.get("user-agent") or "")[:300]))
        # A short receipt the recipient can keep: hash of what they agreed to.
        receipt = hashlib.sha256(
            f"{token}|{body.decision}|{body.name.strip()}|{when}|{row['terms']}".encode()).hexdigest()[:16]
        return {"decision": body.decision, "answered_at": when, "receipt": receipt}

    return router
