"""super_engine.py -- the Super Neural Engine: one prompt, every engine.

The star in the Functions palette (frontend/labview.js) is prompted by wiring:
whatever reaches it (words, numbers, buttons, windows, other nodes) is joined
into a prompt and sent here. Each of the project's engines answers in its own
terms, and the combined answer goes to a Show node.

    anyone  POST /api/super/ask   {prompt}  ->  {answer, parts: [{engine, text}]}

    siM   the SciM assistant (assistant.answer): live state, the knowledge
          base, then optional cloud phrasing. Its answer leads.
    riB   the research buddy's ranking (rib_suggest): the assessed paper that
          best matches the prompt's words, and the field that pays off most.
    piD   the forecaster (pid_engine.engine_status): what it has learned and
          whether it is beating its own defaults.
    PiEn  the mark's shared model (pien.db): the card people open most for
          these words.

DESIGN NOTES

  * Every engine is optional. One that fails is left out of the answer
    instead of failing the request; one with nothing learned yet says so
    rather than staying silent. The parts list says which engines answered.
  * Nothing is written: this endpoint only reads, so asking cannot skew what
    the engines learn.
  * The prompt is bounded (4,000 characters, like /api/scilem/chat) and the
    caller's rate limit is the SciM assistant's.
"""

import logging
import os
import re
import sqlite3
from typing import Callable, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

MAX_PROMPT = 4000
STOP = {"the", "and", "for", "with", "that", "this", "from", "what", "which", "about", "into", "your", "have"}


class Ask(BaseModel):
    prompt: str


def words_of(prompt: str) -> List[str]:
    """The prompt's content words, lower case, in order, without repeats."""
    seen, out = set(), []
    for w in re.findall(r"[A-Za-z][A-Za-z\-]{2,}", prompt or ""):
        lw = w.lower()
        if lw not in STOP and lw not in seen:
            seen.add(lw)
            out.append(lw)
    return out


def _clip(text: str, n: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def sim_part(prompt: str, answer: Callable[[str], Dict]) -> Optional[str]:
    res = answer(prompt) or {}
    text = res.get("response") or ""
    return _clip(text, 420) if text else None


def rib_part(prompt: str, rows: List[Dict], suggest: Callable, hot: Callable) -> Optional[str]:
    if not rows:
        return "no assessed papers here yet, so nothing to rank"
    words = words_of(prompt)
    # The prompt stands in for a profile: its words as keywords and as the idea.
    profile = {"field": ", ".join(words[:6]), "goal": ", ".join(words[:6]), "idea": prompt}
    out = suggest(profile, rows, ())
    pick = out.get("explorer") or out.get("manuscript") or ((out.get("more") or [None])[0])
    bits = []
    if pick and pick.get("title"):
        score = pick.get("score")
        bits.append("read “" + _clip(pick["title"], 90) + "”" + (f" (piX {score:.1f})" if isinstance(score, (int, float)) else ""))
    topics = out.get("hot") or hot(rows)
    if topics:
        t = topics[0]
        name = t.get("field") or t.get("name")
        if name:
            bits.append("hot field: " + str(name))
    return "; ".join(bits) or "nothing assessed here matches these words yet"


def pid_part(status: Callable[[], Dict]) -> Optional[str]:
    st = status() or {}
    if st.get("error"):
        return None
    obs = st.get("total_observations", st.get("observations", 0)) or 0
    mine, base = st.get("mean_abs_error"), st.get("baseline_abs_error")
    if isinstance(mine, (int, float)) and isinstance(base, (int, float)):
        verdict = "beating its defaults" if mine < base else "not yet beating its defaults"
        return f"{int(obs):,} observations, error {mine:.3f} vs {base:.3f} ({verdict})"
    return f"{int(obs):,} observations, no error to score yet" if obs else "no observations yet, nothing learned to report"


def pien_part(prompt: str, db_path: str) -> Optional[str]:
    if not os.path.exists(db_path):
        return None
    with sqlite3.connect(db_path, timeout=5) as c:
        try:
            opens = c.execute("SELECT card, n FROM opens ORDER BY n DESC").fetchall()
        except sqlite3.Error:
            return None
    if not opens:
        return None
    words = words_of(prompt)
    hit = next(((card, n) for card, n in opens if any(w in card.lower() for w in words)), None)
    card, n = hit or opens[0]
    name = card.split(":", 1)[-1]
    return (f"for these words people open {name} ({n}×)" if hit else f"most opened: {name} ({n}×)")


def combine(parts: List[Dict]) -> str:
    return "\n".join(p["engine"] + ": " + p["text"] for p in parts) or "No engine had an answer for that."


def build_router(answer: Callable[[str], Dict], rows: Callable[[], List[Dict]], suggest: Callable, hot: Callable,
                 pid_status: Callable[[], Dict], pien_db: str, rate_limit: Callable[[Request], None]) -> APIRouter:
    router = APIRouter(prefix="/api/super", tags=["super"])

    @router.post("/ask")
    def ask(req: Ask, request: Request):
        rate_limit(request)
        prompt = (req.prompt or "").strip()
        if not prompt:
            raise HTTPException(status_code=400, detail="Wire something into the engine first.")
        if len(prompt) > MAX_PROMPT:
            raise HTTPException(status_code=413, detail="Prompt is too long (max 4,000 characters).")
        parts = []
        for engine, run in (("siM", lambda: sim_part(prompt, answer)),
                            ("riB", lambda: rib_part(prompt, rows(), suggest, hot)),
                            ("piD", lambda: pid_part(pid_status)),
                            ("PiEn", lambda: pien_part(prompt, pien_db))):
            try:
                text = run()
            except Exception as e:                       # noqa: BLE001 -- one engine never fails the rest
                logging.warning("Super engine: %s failed: %s", engine, e)
                text = None
            if text:
                parts.append({"engine": engine, "text": text})
        return {"answer": combine(parts), "parts": parts, "prompt": _clip(prompt, 200)}

    return router
