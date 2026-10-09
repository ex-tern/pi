"""recent.py -- recent assessments, visible to everyone, without saying whose.

Every assessment, including one made without signing in, appears here so
other visitors can see the site being used. People upload unpublished work, so
only what cannot identify a paper is shown, at the owner's choice:

    anyone  GET /api/assessments/recent?limit=20
            {entries: [{field, score, date, signed_in}], total}

    field      the paper's first field of science ("Unassigned" if none)
    score      its piX, to one decimal
    date       the day it was assessed (no time of day)
    signed_in  whether the person was signed in; never who

Never the title, the file, the hash, the author or any address. Reads only.
"""

import json
from typing import Callable

from fastapi import APIRouter, Query


def _first_field(raw) -> str:
    try:
        v = json.loads(raw or "[]")
    except (ValueError, TypeError):
        v = [s.strip() for s in str(raw or "").split(",") if s.strip()]
    if isinstance(v, list) and v:
        f = v[0]
        if isinstance(f, dict):
            f = f.get("name") or f.get("field") or ""
        return str(f).strip()[:80] or "Unassigned"
    if isinstance(v, str) and v.strip():
        return v.strip()[:80]
    return "Unassigned"


def build_router(get_conn: Callable) -> APIRouter:
    router = APIRouter(prefix="/api/assessments", tags=["recent"])

    @router.get("/recent")
    def recent(limit: int = Query(default=20, ge=1, le=50)):
        conn = get_conn()
        try:
            rows = conn.execute(
                "SELECT fields, final_score, timestamp, user_id FROM papers_assessment "
                "WHERE final_score IS NOT NULL ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM papers_assessment WHERE final_score IS NOT NULL").fetchone()[0]
        finally:
            conn.close()
        entries = []
        for fields, score, ts, uid in rows:
            try:
                s = round(float(score), 1)
            except (TypeError, ValueError):
                continue
            entries.append({
                "field": _first_field(fields),
                "score": s,
                "date": str(ts or "")[:10],
                "signed_in": bool(uid) and str(uid) != "Anonymous",
            })
        return {"entries": entries, "total": int(total or 0)}

    return router
