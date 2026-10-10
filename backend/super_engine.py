"""super_engine.py -- the Super Neural Engine: one prompt, every engine.

The star in the Functions palette (frontend/labview.js) is prompted by wiring:
whatever reaches it (words, numbers, buttons, windows, other nodes) is joined
into a prompt and sent here. Each of the project's engines answers in its own
terms, and the combined answer goes to a Show node.

    anyone  POST /api/super/ask     {prompt}  ->  {answer, parts: [{engine, text}]}
    anyone  POST /api/super/panel   {prompt, context?}  ->  {answer, jurors, judge}

    siM   the SciM assistant (assistant.answer): live state, the knowledge
          base, then optional cloud phrasing. Its answer leads.
    riB   the research buddy's ranking (rib_suggest): the assessed paper that
          best matches the prompt's words, and the field that pays off most.
    piD   the forecaster (pid_engine.engine_status): what it has learned and
          whether it is beating its own defaults.
    PiEn  the mark's shared model (pien.db): the card people open most for
          these words.

The "?" node asks the panel: the same external jurors that judge manuscripts
(Llama, Mistral, Qwen, Gemini, DeepSeek, each with its chain of fallback
routes), independently and in parallel under a wall-clock budget, and then the
judge, which reads their answers and gives a verdict with how far they agree.
SciLM (siM) sits out, as it does in adjudication: the panel is the outside view.

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


class PanelAsk(BaseModel):
    prompt: str
    context: str = ""


PANEL_BUDGET = 40.0
AGREEMENT = ("high", "moderate", "low")


def panel_prompt(prompt: str, context: str) -> str:
    return ("You are one member of an independent panel. Answer the question below in your own "
            "words, plainly and specifically, in at most 120 words. If it cannot be answered from "
            "what is given, say so.\n\n"
            + (f"WHAT THE SITE'S OWN ENGINES SAID (for context, not to be trusted blindly):\n{context}\n\n" if context else "")
            + f"QUESTION:\n{prompt}\n\n"
            'Return JSON with exactly these keys: "answer": string, "confidence": integer 0-100.')


def judge_prompt(prompt: str, answers: List[Dict]) -> str:
    lines = "\n".join(f"- {a['label']} (confidence {a.get('confidence', '?')}): {a['answer']}" for a in answers)
    return ("You are the judge of an independent panel. Read each member's answer to the question, "
            "weigh them, and give the panel's verdict: what they agree on, where they differ, and "
            "the best answer. Do not invent facts none of them gave.\n\n"
            f"QUESTION:\n{prompt}\n\nANSWERS:\n{lines}\n\n"
            'Return JSON with exactly these keys: "verdict": string (at most 80 words), '
            '"agreement": one of "high", "moderate", "low".')


def run_panel(prompt: str, context: str, jurors: List[Dict], ask_juror: Callable, judge: Callable,
              budget: float = PANEL_BUDGET) -> Dict:
    """Ask every juror in parallel under a wall-clock budget, then the judge.

    ask_juror(juror, prompt) -> {"answer", "confidence", "model"} or {"failed": reason}
    judge(prompt) -> {"verdict", "agreement", "model"} or {"failed": reason}
    """
    import concurrent.futures
    import time
    q = panel_prompt(prompt, context)
    results = {j["key"]: {"key": j["key"], "label": j["label"], "ok": False, "answer": "did not answer in time"} for j in jurors}
    ex = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(5, len(jurors))))
    try:
        futs = {ex.submit(ask_juror, j["key"], q): j for j in jurors}
        deadline = time.time() + budget
        try:
            for f in concurrent.futures.as_completed(futs, timeout=max(1.0, deadline - time.time())):
                j = futs[f]
                try:
                    r = f.result() or {}
                except Exception as e:                   # noqa: BLE001
                    r = {"failed": str(e)[:80]}
                if r.get("failed") or not str(r.get("answer") or "").strip():
                    results[j["key"]].update(answer=str(r.get("failed") or "no answer"))
                else:
                    conf = r.get("confidence")
                    results[j["key"]].update(ok=True, answer=_clip(r["answer"], 600), model=r.get("model", ""),
                                             confidence=int(conf) if isinstance(conf, (int, float)) else None)
        except concurrent.futures.TimeoutError:
            pass
    finally:
        ex.shutdown(wait=False)   # stragglers past the budget are not waited for
    answered = [r for r in results.values() if r["ok"]]
    verdict = {"verdict": "", "agreement": None}
    if len(answered) >= 2:
        try:
            v = judge(judge_prompt(prompt, answered)) or {}
            if not v.get("failed"):
                ag = str(v.get("agreement") or "").lower()
                verdict = {"verdict": _clip(v.get("verdict") or "", 600), "agreement": ag if ag in AGREEMENT else None, "model": v.get("model", "")}
        except Exception as e:                           # noqa: BLE001
            logging.warning("Super panel: judge failed: %s", e)
    elif len(answered) == 1:
        verdict = {"verdict": "Only one panel member answered, so there is nothing to weigh: " + answered[0]["answer"], "agreement": None}
    return {"jurors": list(results.values()), "judge": verdict, "answered": len(answered), "asked": len(jurors)}


def panel_text(res: Dict) -> str:
    if not res["answered"]:
        return "Panel: no model in the panel could be reached right now."
    head = f"Panel: {res['answered']} of {res['asked']} answered" + (f", agreement {res['judge']['agreement']}" if res["judge"].get("agreement") else "")
    lines = [head]
    if res["judge"].get("verdict"):
        lines.append("Judge: " + res["judge"]["verdict"])
    else:
        lines.append("Judge: could not be reached, so the answers are not weighed")
    for j in res["jurors"]:
        if j["ok"]:
            lines.append(f"· {j['label']}: " + _clip(j["answer"], 220))
    return "\n".join(lines)


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
                 pid_status: Callable[[], Dict], pien_db: str, rate_limit: Callable[[Request], None],
                 jurors: Optional[List[Dict]] = None, ask_juror: Optional[Callable] = None,
                 judge: Optional[Callable] = None, panel_rate_limit: Optional[Callable[[Request], None]] = None) -> APIRouter:
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

    @router.post("/panel")
    def panel(req: PanelAsk, request: Request):
        (panel_rate_limit or rate_limit)(request)
        prompt = (req.prompt or "").strip()
        if not prompt:
            raise HTTPException(status_code=400, detail="Wire something into the panel first.")
        if len(prompt) > MAX_PROMPT or len(req.context or "") > MAX_PROMPT:
            raise HTTPException(status_code=413, detail="Prompt is too long (max 4,000 characters).")
        if not (jurors and ask_juror and judge):
            raise HTTPException(status_code=503, detail="The panel is not configured on this deployment.")
        res = run_panel(prompt, (req.context or "").strip(), jurors, ask_juror, judge)
        return {"answer": panel_text(res), **res, "prompt": _clip(prompt, 200)}

    return router
