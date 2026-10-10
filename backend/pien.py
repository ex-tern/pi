"""pien.py -- what PiEn, the engine behind the Pi Tech Lab mark, learns from everyone.

PiEn suggests the card a visitor is likely to want next. Each browser learns
its own visitor's habits (kept with their layout); this module pools what all
visitors do, anonymously, so a newcomer gets sensible suggestions too.

    anyone  POST /api/pien/learn   {opens: [[card, n]], steps: [[from, to, n]]}
    anyone  GET  /api/pien/model   {opens: {card: n}, next: {from: {to: n}}, interactions}

DESIGN NOTES

  * Anonymous by construction: only card names ("lab:HAL-OS") and counts are
    accepted. No identity, no timestamps per visitor, no IP is stored.
  * Hard to skew: a request carries at most 40 entries of at most 10 each,
    card names must look like card names, and each address may send 60
    requests an hour (kept in memory only, to apply the limit).
  * The model sent back is small: the 6 most common next cards per card.
  * Its own SQLite file next to the main database, touching no other table.
"""

import os
import re
import sqlite3
import threading
import time
from collections import defaultdict, deque
from typing import List, Tuple

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from api_helpers import client_ip

CARD = re.compile(r"^[a-z]{2,12}:[^\n\r\t]{1,100}$")
MAX_ENTRIES = 40
MAX_COUNT = 10
PER_HOUR = 60
TOP_NEXT = 6


class Learn(BaseModel):
    opens: List[Tuple[str, int]] = Field(default_factory=list)
    steps: List[Tuple[str, str, int]] = Field(default_factory=list)


def _client_ip(request: Request) -> str:
    return client_ip(request, "?")


def build_router(base_dir: str) -> APIRouter:
    db_path = os.path.join(base_dir, "pien.db")
    router = APIRouter(prefix="/api/pien", tags=["pien"])
    seen = defaultdict(deque)
    lock = threading.Lock()

    def conn():
        os.makedirs(base_dir, exist_ok=True)
        c = sqlite3.connect(db_path, timeout=10)
        c.execute("CREATE TABLE IF NOT EXISTS opens (card TEXT PRIMARY KEY, n INTEGER NOT NULL)")
        c.execute("CREATE TABLE IF NOT EXISTS steps (a TEXT NOT NULL, b TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (a, b))")
        return c

    def limited(ip: str) -> bool:
        now = time.time()
        with lock:
            q = seen[ip]
            while q and q[0] < now - 3600:
                q.popleft()
            if len(q) >= PER_HOUR:
                return True
            q.append(now)
            if len(seen) > 50000:          # never grow without bound
                seen.clear()
            return False

    @router.post("/learn")
    def learn(body: Learn, request: Request):
        if len(body.opens) + len(body.steps) > MAX_ENTRIES:
            raise HTTPException(status_code=413, detail="Too much at once.")
        for card, n in body.opens:
            if not CARD.match(card) or not 1 <= n <= MAX_COUNT:
                raise HTTPException(status_code=422, detail="Not a card.")
        for a, b, n in body.steps:
            if not CARD.match(a) or not CARD.match(b) or a == b or not 1 <= n <= MAX_COUNT:
                raise HTTPException(status_code=422, detail="Not a step between cards.")
        if limited(_client_ip(request)):
            raise HTTPException(status_code=429, detail="PiEn has heard enough from here for now.")
        with conn() as c:
            for card, n in body.opens:
                c.execute("INSERT INTO opens (card, n) VALUES (?, ?) ON CONFLICT(card) DO UPDATE SET n = n + excluded.n", (card, n))
            for a, b, n in body.steps:
                c.execute("INSERT INTO steps (a, b, n) VALUES (?, ?, ?) ON CONFLICT(a, b) DO UPDATE SET n = n + excluded.n", (a, b, n))
        return {"ok": True}

    @router.get("/model")
    def model():
        with conn() as c:
            opens = {k: n for k, n in c.execute("SELECT card, n FROM opens")}
            nxt = defaultdict(dict)
            for a, b, n in c.execute("SELECT a, b, n FROM steps ORDER BY a, n DESC"):
                if len(nxt[a]) < TOP_NEXT:
                    nxt[a][b] = n
        return {"opens": opens, "next": nxt, "interactions": sum(opens.values())}

    return router
