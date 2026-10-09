"""live.py -- the Live side panel: what the site is doing right now.

    anyone  GET /api/live
            {idle, today, total, latest: [...]}

    idle    idle_worker.public_status(): whether papers are assessed
            automatically while the site is quiet, how many today, the latest
    today   assessments made today (UTC), all kinds
    total   assessments in the corpus
    latest  the 12 newest assessments, newest first. Two kinds:
      auto  assessed by the site itself while idle: open-access papers found
            on OpenAlex, so the title is public and shown
            {auto: true, title, field, score, at, eval_hash}
      user  assessed by a person: as in recent.py, only what cannot identify
            the paper (the owner's choice for other people's uploads)
            {auto: false, field, score, date, signed_in}

Reads only.
"""

from typing import Callable

from fastapi import APIRouter

from recent import _first_field

IDLE_USER = "ScholarPi (idle)"


def build_router(get_conn: Callable, idle_status: Callable) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["live"])

    @router.get("/live")
    def live():
        conn = get_conn()
        try:
            rows = conn.execute(
                "SELECT eval_hash, title, fields, final_score, timestamp, user_id FROM papers_assessment "
                "WHERE final_score IS NOT NULL ORDER BY timestamp DESC LIMIT 12").fetchall()
            total = conn.execute(
                "SELECT COUNT(*) FROM papers_assessment WHERE final_score IS NOT NULL").fetchone()[0]
            today = conn.execute(
                "SELECT COUNT(*) FROM papers_assessment WHERE final_score IS NOT NULL "
                "AND DATE(timestamp) = DATE('now')").fetchone()[0]
        finally:
            conn.close()
        latest = []
        for h, title, fields, score, ts, uid in rows:
            try:
                s = round(float(score), 1)
            except (TypeError, ValueError):
                continue
            if str(uid or "") == IDLE_USER:
                latest.append({"auto": True, "title": (title or "")[:200], "field": _first_field(fields),
                               "score": s, "at": str(ts or "")[:19], "eval_hash": h})
            else:
                latest.append({"auto": False, "field": _first_field(fields), "score": s,
                               "date": str(ts or "")[:10],
                               "signed_in": bool(uid) and str(uid) not in ("Anonymous", IDLE_USER)})
        try:
            idle = idle_status()
        except Exception:                                   # noqa: BLE001
            idle = {"enabled": False}
        return {"idle": idle, "today": int(today or 0), "total": int(total or 0), "latest": latest}

    return router
