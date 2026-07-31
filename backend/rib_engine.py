"""
riB — the Research Buddy engine.

One of three engines in the framework, each with its own file:

    piD  (pid_engine.py)  epoch-weight forecasting
    riB  (rib_engine.py)  researcher-relative corpus guidance   <- this file
    siM  (sim_engine.py)  SciLM's learned structural calibration

What riB does
-------------
It answers one question the frontend cannot: how does *this researcher's*
stated work sit against what this deployment has actually assessed? Which of
their fields are crowded, which are empty, how their scores compare to the
corpus mean, and which adjacent fields hold material they have not claimed.

What it refuses to do
---------------------
Every number returned is a real count or a real mean over assessed papers.
Where there is no data it says so, rather than generating plausible advice —
a researcher cannot distinguish a grounded suggestion from an invented one, and
should not have to. That constraint is the whole reason this is an engine
rather than a prompt: the moment guidance comes from a language model, its
provenance stops being checkable.

It was previously inline in the API handler, which made the assessment
pipeline's only researcher-facing analysis indistinguishable from routing code.
"""
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


def parse_fields(profile: Dict) -> List[str]:
    """The researcher's stated fields, as a clean list."""
    raw = str((profile or {}).get("field", "") or "")
    return [f.strip() for f in raw.split(",") if f.strip()]


def corpus_summary(corpus: List[Dict]) -> Dict:
    """Totals over the assessed corpus.

    The mean is weighted by paper count, not a mean of per-field means. An
    unweighted average would let a field with one paper move the corpus mean as
    much as a field with fifty, which is not what "the corpus average" means to
    anyone reading it.
    """
    total_papers = sum(r.get("papers", 0) for r in (corpus or []))
    if not total_papers:
        return {"total_papers": 0, "mean_score": None, "fields_assessed": 0}
    weighted = sum(r.get("avg_score", 0.0) * r.get("papers", 0) for r in corpus)
    return {
        "total_papers": total_papers,
        "mean_score": round(weighted / total_papers, 1),
        "fields_assessed": len(corpus),
    }


def compare_fields(fields: List[str], corpus: List[Dict],
                   corpus_mean: Optional[float]) -> List[Dict]:
    """Each stated field against the corpus, including the ones with no data.

    Fields with nothing assessed are returned explicitly rather than omitted.
    Silently dropping them would leave a researcher believing every field they
    listed had been evaluated, when the honest answer is that this deployment
    has never seen work in that area.
    """
    by_field = {r["field"].lower(): r for r in (corpus or []) if r.get("field")}
    reports = []
    for name in fields:
        row = by_field.get(name.lower())
        if not row:
            reports.append({"field": name, "in_corpus": False,
                            "papers": 0, "avg_score": None, "vs_corpus": None})
            continue
        delta = (round(row["avg_score"] - corpus_mean, 1)
                 if corpus_mean is not None else None)
        reports.append({
            "field": name, "in_corpus": True,
            "papers": row["papers"], "avg_score": row["avg_score"],
            "vs_corpus": delta,
        })
    return reports


def adjacent_fields(fields: List[str], corpus: List[Dict], limit: int = 5) -> List[Dict]:
    """Fields with assessed work that the researcher did not list.

    The most useful suggestion available without external data: these are areas
    this deployment demonstrably holds material in, so pointing at them is a
    statement of fact rather than a guess about where someone should publish.
    """
    listed = {f.lower() for f in fields}
    return [
        {"field": r["field"], "papers": r["papers"], "avg_score": r.get("avg_score")}
        for r in (corpus or []) if r.get("field", "").lower() not in listed
    ][:limit]


def build_report(profile: Dict, corpus: List[Dict], picks: Optional[Dict] = None) -> Dict:
    """Assemble the full riB report from already-fetched inputs.

    Takes data rather than fetching it, so the engine can be exercised without
    a database and its output is a pure function of its input — which is what
    makes the "every number is grounded" claim testable rather than asserted.
    """
    fields = parse_fields(profile)
    summary = corpus_summary(corpus)
    reports = compare_fields(fields, corpus, summary["mean_score"])

    in_corpus = [r for r in reports if r["in_corpus"]]
    missing = [r for r in reports if not r["in_corpus"]]

    if not summary["total_papers"]:
        headline = ("Nothing has been assessed in this deployment yet, so there is nothing to "
                    "compare your fields against.")
    elif not fields:
        headline = (f"{summary['total_papers']} paper(s) assessed across "
                    f"{summary['fields_assessed']} field(s). Add your research fields to see "
                    f"how yours compare.")
    elif not in_corpus:
        headline = ("None of your listed fields have assessed work here yet, so no comparison "
                    "is possible for them.")
    else:
        best = max(in_corpus, key=lambda r: (r["vs_corpus"] if r["vs_corpus"] is not None else -99))
        headline = (f"{len(in_corpus)} of your {len(fields)} field(s) have assessed work here. "
                    f"{best['field']} scores "
                    f"{'above' if (best['vs_corpus'] or 0) >= 0 else 'below'} the corpus mean "
                    f"by {abs(best['vs_corpus'] or 0):.1f} piX.")

    return {
        "available": True,
        "engine": "riB",
        "profile_fields": fields,
        "fields": reports,
        "fields_with_data": len(in_corpus),
        "fields_without_data": [r["field"] for r in missing],
        "adjacent": adjacent_fields(fields, corpus),
        "corpus": summary,
        "picks": picks or {"available": False, "recommended": [], "caution": []},
        "headline": headline,
        "grounding": ("Every figure here is a count or mean over papers actually assessed by "
                      "this deployment. Where there is no data, riB reports its absence rather "
                      "than estimating."),
    }
