"""RiBD suggestions: papers to read (one from the ledger explorer, one scanned
manuscript and up to three more), chosen for the researcher's profile, and the
hot topics: the fields where papers here earn the most piX and piQ and where
activity is rising (hot_topics).

Pure functions over plain rows, so they can be tested without a database.

Relevance comes only from what the researcher wrote in their profile:
  - a shared field                       +3 each
  - a profile keyword found in the title +2 each
  - a word from their core claim in the title (5+ letters, not a stop word) +1 each
Nothing is suggested on relevance zero: a pick that matches nothing in the
profile would be advice assembled from someone else's interests, the very thing
RiBD refuses to do elsewhere. The researcher's own papers are never suggested.

The two picks are different papers:
  - from the explorer: a paper recorded on the Proof-of-Research ledger, the
    best match, ties broken by piX;
  - a scanned manuscript: any assessed manuscript, the best match, ties broken
    by how recently it was scanned.
"""
from __future__ import annotations

import json
import re
from typing import Dict, Iterable, List, Optional  # noqa: F401

STOP = set("""about above after again against among because before being below between
both could doing during each further having however might other their there these
those through under until using which while would within without study paper
results based model models method methods analysis approach towards toward""".split())


def _fields(raw) -> List[str]:
    if isinstance(raw, list):
        return [str(f).strip() for f in raw if str(f).strip()]
    try:
        v = json.loads(raw or "[]")
        if isinstance(v, list):
            return [str(f).strip() for f in v if str(f).strip()]
    except (ValueError, TypeError):
        pass
    return [f.strip() for f in str(raw or "").split(",") if f.strip()]


def profile_terms(profile: Dict) -> Dict[str, List[str]]:
    p = profile or {}
    fields = [f.strip() for f in str(p.get("field", "") or "").split(",") if f.strip()]
    keywords = [k.strip() for k in str(p.get("goal", "") or "").split(",") if k.strip()]
    idea_words = sorted({w for w in re.findall(r"[a-zA-Z][a-zA-Z\-]{4,}", str(p.get("idea", "") or "").lower())
                         if w not in STOP})
    return {"fields": fields, "keywords": keywords, "idea": idea_words}


def relevance(row: Dict, terms: Dict[str, List[str]]):
    """(score, reasons) for one paper against the profile terms."""
    title = str(row.get("title") or "").lower()
    pf = {f.lower() for f in _fields(row.get("fields"))}
    score, why = 0, []
    shared = [f for f in terms["fields"] if f.lower() in pf]
    if shared:
        score += 3 * len(shared)
        why.append("shares your field " + ", ".join(shared))
    kws = [k for k in terms["keywords"] if k.lower() in title]
    if kws:
        score += 2 * len(kws)
        why.append("mentions " + ", ".join(f"“{k}”" for k in kws))
    words = [w for w in terms["idea"] if re.search(r"\b" + re.escape(w) + r"\b", title)]
    if words:
        score += len(words)
        why.append("touches your core claim (" + ", ".join(words[:3]) + ")")
    return score, why


def _pick(rows: Iterable[Dict], terms, tiebreak: str, skip: set) -> Optional[Dict]:
    best, best_key = None, None
    for r in rows:
        h = r.get("eval_hash")
        if not h or h in skip:
            continue
        s, why = relevance(r, terms)
        if s <= 0:
            continue
        tb = (r.get("score") or 0.0) if tiebreak == "score" else str(r.get("timestamp") or "")
        key = (s, tb)
        if best_key is None or key > best_key:
            best_key = key
            best = dict(r, relevance=s, why="Suggested because it " + "; ".join(why) + ".",
                        fields=_fields(r.get("fields")))
    return best


def suggest(profile: Dict, rows: List[Dict], own_hashes: Iterable[str] = ()) -> Dict:
    """{"explorer": pick|None, "manuscript": pick|None, "reason": str|None}.

    rows: dicts with eval_hash, title, author, fields (JSON or list), score,
    timestamp, on_ledger (bool).
    """
    terms = profile_terms(profile)
    if not (terms["fields"] or terms["keywords"] or terms["idea"]):
        return {"explorer": None, "manuscript": None, "more": [],
                "reason": "Add your fields or keywords to your profile and RiBD will suggest papers.",
                "hot": hot_topics(rows)}
    own = set(own_hashes or ())
    explorer = _pick((r for r in rows if r.get("on_ledger")), terms, "score", own)
    skip = own | ({explorer["eval_hash"]} if explorer else set())
    manuscript = _pick(rows, terms, "recent", skip)
    reason = None
    if not explorer and not manuscript:
        reason = "Nothing assessed here matches your profile yet."
    keep = ("eval_hash", "title", "author", "fields", "score", "timestamp", "why", "relevance")
    trim = lambda p: {k: p.get(k) for k in keep} if p else None   # noqa: E731
    # Also worth reading: up to three more relevant papers, best match first,
    # then highest piX.
    taken = skip | ({manuscript["eval_hash"]} if manuscript else set())
    more = []
    for r in rows:
        h = r.get("eval_hash")
        if not h or h in taken:
            continue
        sc, why = relevance(r, terms)
        if sc > 0:
            more.append((sc, r.get("score") or 0.0, dict(r, why="Suggested because it " + "; ".join(why) + ".",
                                                         fields=_fields(r.get("fields")), relevance=sc)))
    more.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return {"explorer": trim(explorer), "manuscript": trim(manuscript),
            "more": [trim(m[2]) for m in more[:3]], "reason": reason,
            "hot": hot_topics(rows, terms["fields"])}


def _ts_days_ago(ts: str, now) -> Optional[float]:
    from datetime import datetime
    try:
        t = datetime.fromisoformat(str(ts).replace("Z", "")[:19])
    except ValueError:
        return None
    return (now - t).total_seconds() / 86400.0


def hot_topics(rows: List[Dict], my_fields: Iterable[str] = (), limit: int = 5, now=None) -> List[Dict]:
    """Fields worth researching here: where papers earn the most piX and piQ,
    and where activity is rising.

    Per field with at least two assessed papers:
      avg_pix      mean piX
      avg_piq      mean piQ minted per paper
      recent       papers in the last 30 days
    Each is scaled to 0..1 across fields and combined
    0.4 piX + 0.4 piQ + 0.2 recent activity. It describes what has paid off
    in this corpus so far, not a promise about any future paper.
    """
    from datetime import datetime
    now = now or datetime.utcnow()
    stats: Dict[str, Dict] = {}
    for r in rows:
        try:
            score = float(r.get("score"))
        except (TypeError, ValueError):
            continue
        piq = float(r.get("piq") or 0.0)
        age = _ts_days_ago(r.get("timestamp"), now)
        for f in _fields(r.get("fields"))[:2]:
            s = stats.setdefault(f, {"n": 0, "pix": 0.0, "piq": 0.0, "recent": 0})
            s["n"] += 1
            s["pix"] += score
            s["piq"] += piq
            if age is not None and age <= 30:
                s["recent"] += 1
    rowsf = [(f, s["n"], s["pix"] / s["n"], s["piq"] / s["n"], s["recent"])
             for f, s in stats.items() if s["n"] >= 2]
    if not rowsf:
        return []

    def scale(vals):
        lo, hi = min(vals), max(vals)
        return [0.5 if hi == lo else (v - lo) / (hi - lo) for v in vals]

    px = scale([r[2] for r in rowsf])
    pq = scale([r[3] for r in rowsf])
    rc = scale([r[4] for r in rowsf])
    mine = {f.lower() for f in (my_fields or [])}
    out = []
    for i, (f, n, apx, apq, rec) in enumerate(rowsf):
        heat = 0.4 * px[i] + 0.4 * pq[i] + 0.2 * rc[i]
        out.append({"field": f, "papers": n, "avg_pix": round(apx, 1), "avg_piq": round(apq, 3),
                    "recent": rec, "heat": round(heat, 3), "yours": f.lower() in mine})
    out.sort(key=lambda d: (d["heat"], d["avg_pix"]), reverse=True)
    return out[:limit]
