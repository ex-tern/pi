"""traffic.py -- website traffic, by day, for the Analytics window.

    anyone  GET /api/traffic?days=30
            {days: [{day, visitors, visits}], today, week, month, all_time,
             visits_30d}

Counted from the same ping as the site's visitor total (POST /api/visit,
once per browser session): `visitors` are distinct visitors that day,
`visits` are sessions. A visitor is the keyed, non-reversible hash of their
IP address (api._visitor_key), never the address itself; this table keeps
only (day, that hash, a count) and drops days older than 120.

Aggregates only: nothing here says who visited.
"""

import sqlite3
import logging
from datetime import date, timedelta
from typing import Callable

from fastapi import APIRouter, Query

KEEP_DAYS = 120


def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS site_traffic (
                      day TEXT NOT NULL, visitor_key TEXT NOT NULL, visits INTEGER DEFAULT 1,
                      PRIMARY KEY (day, visitor_key))""")


def record(get_conn: Callable, visitor_key: str) -> None:
    """One more visit today for this visitor. Never raises."""
    if not visitor_key:
        return
    conn = get_conn()
    try:
        ensure_table(conn)
        conn.execute("""INSERT INTO site_traffic (day, visitor_key, visits) VALUES (DATE('now'), ?, 1)
                        ON CONFLICT(day, visitor_key) DO UPDATE SET visits = visits + 1""", (visitor_key,))
        conn.execute("DELETE FROM site_traffic WHERE day < DATE('now', ?)", (f"-{KEEP_DAYS} day",))
        conn.commit()
    except sqlite3.Error as e:
        logging.debug("Could not record traffic: %s", e)
    finally:
        conn.close()


def summary(get_conn: Callable, days: int = 30, today: date = None) -> dict:
    today = today or date.today()
    conn = get_conn()
    try:
        ensure_table(conn)
        start = (today - timedelta(days=days - 1)).isoformat()
        rows = conn.execute(
            """SELECT day, COUNT(*), SUM(visits) FROM site_traffic
               WHERE day >= ? GROUP BY day""", (start,)).fetchall()

        def uniq(n):
            return conn.execute("SELECT COUNT(DISTINCT visitor_key) FROM site_traffic WHERE day >= ?",
                                ((today - timedelta(days=n - 1)).isoformat(),)).fetchone()[0] or 0
        week, month = uniq(7), uniq(30)
        # all time: the site's visitor total (kept since before this table
        # existed), never less than what the daily table itself has seen
        seen = conn.execute("SELECT COUNT(DISTINCT visitor_key) FROM site_traffic").fetchone()[0] or 0
        try:
            all_time = max(seen, conn.execute("SELECT COUNT(*) FROM site_visits").fetchone()[0] or 0)
        except sqlite3.Error:
            all_time = seen
    finally:
        conn.close()
    by = {r[0]: (int(r[1] or 0), int(r[2] or 0)) for r in rows}
    series = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        v, s = by.get(d, (0, 0))
        series.append({"day": d, "visitors": v, "visits": s})
    return {"days": series, "today": series[-1]["visitors"], "week": int(week), "month": int(month),
            "all_time": int(all_time), "visits_30d": sum(x["visits"] for x in series[-30:])}


def build_router(get_conn: Callable) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["traffic"])

    @router.get("/traffic")
    def traffic(days: int = Query(default=30, ge=7, le=90)):
        return summary(get_conn, days)

    return router
