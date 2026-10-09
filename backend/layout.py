"""layout.py -- a signed-in visitor's orbit layout, kept on the server.

Where the pills sit, the mark's place and size, the π box, which windows are
open and how much each card has been used: the frontend keeps all of it in
browser storage under keys starting "orbit:". For a signed-in visitor it is
also saved here, so the same layout follows them to another browser or
device.

    user  GET /api/me/layout   {layout: {key: value}, updated_at}  (empty if none)
    user  PUT /api/me/layout   {layout: {key: value}}              replace it

DESIGN NOTES

  * Only a PROVEN identity (a signed session) can read or write a layout, and
    only its own: the key comes from the session, never from the request.
  * The layout is opaque presentation state. It is validated for shape and
    size only (string keys under "orbit:", JSON-encoded string values, 64 KB
    in all) and never interpreted, so it cannot reach anything else.
  * Its own SQLite file next to the main database, like consent.db: it touches
    no existing table.
"""

import json
import os
import sqlite3
import time
from typing import Callable, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

MAX_BYTES = 64 * 1024
MAX_KEYS = 600
MAX_KEY_LEN = 160


class LayoutIn(BaseModel):
    layout: Dict[str, str] = Field(default_factory=dict)


def _who(identity: dict) -> str:
    # one row per identity; ORCID wins when both are present (as for profiles)
    if identity.get("orcid"):
        return "orcid:" + identity["orcid"]
    return "wallet:" + (identity.get("wallet") or "").lower()


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def validate(layout: Dict[str, str]) -> Dict[str, str]:
    if len(layout) > MAX_KEYS:
        raise HTTPException(status_code=413, detail="Too many layout entries.")
    for k, v in layout.items():
        if not k.startswith("orbit:") or len(k) > MAX_KEY_LEN:
            raise HTTPException(status_code=422, detail="Layout keys must start with 'orbit:'.")
        try:
            json.loads(v)
        except Exception:
            raise HTTPException(status_code=422, detail="Layout values must be JSON text.")
    if len(json.dumps(layout, separators=(",", ":")).encode()) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Layout is too large.")
    return layout


def build_router(base_dir: str, require_identity: Callable) -> APIRouter:
    db_path = os.path.join(base_dir, "layout.db")
    router = APIRouter(prefix="/api/me", tags=["layout"])

    def conn():
        os.makedirs(base_dir, exist_ok=True)
        c = sqlite3.connect(db_path, timeout=10)
        c.execute("""CREATE TABLE IF NOT EXISTS layouts (
            who TEXT PRIMARY KEY, layout TEXT NOT NULL, updated_at TEXT NOT NULL)""")
        return c

    @router.get("/layout")
    def get_layout(identity: dict = Depends(require_identity)):
        with conn() as c:
            row = c.execute("SELECT layout, updated_at FROM layouts WHERE who = ?", (_who(identity),)).fetchone()
        if not row:
            return {"layout": {}, "updated_at": None}
        return {"layout": json.loads(row[0]), "updated_at": row[1]}

    @router.put("/layout")
    def put_layout(body: LayoutIn, identity: dict = Depends(require_identity)):
        layout = validate(body.layout)
        now = _now()
        with conn() as c:
            c.execute("""INSERT INTO layouts (who, layout, updated_at) VALUES (?, ?, ?)
                         ON CONFLICT(who) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at""",
                      (_who(identity), json.dumps(layout, separators=(",", ":")), now))
        return {"ok": True, "updated_at": now, "entries": len(layout)}

    return router
