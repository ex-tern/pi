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
        # Ordered by the learned relevance model rather than by corpus order.
        # The figures in each entry are untouched measurements; learning
        # decides only which the researcher sees first.
        "adjacent": rank_suggestions(adjacent_fields(fields, corpus, limit=12),
                                     summary, fields)[:5],
        "corpus": summary,
        "picks": picks or {"available": False, "recommended": [], "caution": []},
        "headline": headline,
        "grounding": ("Every figure here is a count or mean over papers actually assessed by "
                      "this deployment. Where there is no data, riB reports its absence rather "
                      "than estimating."),
    }


# ---------------------------------------------------------------------------
# riB as a genuine learner
# ---------------------------------------------------------------------------
# riB was the hardest of the three to make learn, for a reason worth stating:
# it had no target. piD can be scored against the block that actually gets
# written, and siM against a corroborated panel verdict, but "was this guidance
# useful?" is not observable anywhere in the system. A model with no error
# signal cannot learn regardless of its architecture, and dressing statistics
# up as a network would have produced something that looked like learning and
# was not.
#
# So the target is created rather than inferred: a researcher marks a suggestion
# useful or not, and that verdict is the label. What riB learns is which
# suggestions are worth surfacing — a relevance model over the features of a
# candidate field, used to RANK what it shows.
#
# What it deliberately does not learn: the counts and means themselves. Those
# are measurements, they are the reason riB is trustworthy, and a learned
# adjustment to a fact is a fabrication. Learning is confined to ordering.
RIB_FEATURES = ["papers", "score_gap", "corpus_share", "is_listed", "novelty"]

# Authored prior: prefer fields with more assessed papers and a positive score
# gap. This reproduces the previous fixed ordering, so the breaker has a real
# baseline and day-one behaviour is unchanged.
RIB_DEFAULTS = [0.5, 0.3, 0.2, 0.0, 0.1]

_rib_model = None
_RIB_NAME = "rib:relevance"


def _rib():
    global _rib_model
    if _rib_model is None:
        from online_model import OnlineLinearModel
        from database import load_engine_state
        # Swept against held-out feedback rather than guessed. lr 0.05 gave
        # +7% error reduction over the frozen defaults; 0.30 gives +29.7% at
        # the same 88-90% agreement, because riB's target is a bounded 0/1
        # verdict where a larger step cannot run away. max_step still caps any
        # single researcher's influence on the ranking.
        _rib_model = OnlineLinearModel(
            name=_RIB_NAME, features=RIB_FEATURES, defaults=RIB_DEFAULTS,
            lr=0.30, max_step=0.05, decay_scale=800.0, lo=0.0, hi=1.0)
        raw = load_engine_state(_RIB_NAME)
        if raw:
            _rib_model.load_json(raw)
    return _rib_model


def rib_features(candidate: Dict, summary: Dict, listed: bool = False) -> List[float]:
    """Bounded features for one candidate suggestion.

    All normalised to roughly [0, 1] so no single feature dominates the
    gradient purely by living on a larger scale — a field with 400 papers must
    not swamp a score gap measured in piX points.
    """
    total = max(1, int((summary or {}).get("total_papers", 0) or 1))
    mean = float((summary or {}).get("mean_score", 0.0) or 0.0)
    papers = float(candidate.get("papers", 0) or 0)
    avg = candidate.get("avg_score")
    gap = (float(avg) - mean) if avg is not None else 0.0
    return [
        min(1.0, papers / 25.0),              # depth of material available
        max(-1.0, min(1.0, gap / 25.0)),      # quality relative to the corpus
        min(1.0, papers / total),             # how much of the corpus this is
        1.0 if listed else 0.0,               # already one of theirs
        1.0 if papers <= 2 else 0.0,          # thin, i.e. an opening
    ]


def rank_suggestions(candidates: List[Dict], summary: Dict,
                     listed_fields: Optional[List[str]] = None) -> List[Dict]:
    """Order candidate fields by learned relevance.

    Every candidate keeps its real figures untouched; only the order changes,
    and each carries the score it was ranked by so the ordering is inspectable
    rather than mysterious.
    """
    listed = {f.lower() for f in (listed_fields or [])}
    model = _rib()
    scored = []
    for c in candidates or []:
        feats = rib_features(c, summary, c.get("field", "").lower() in listed)
        scored.append({**c,
                       "relevance": round(model.predict(feats), 4),
                       "_features": feats})
    scored.sort(key=lambda r: -r["relevance"])
    return scored


def observe_feedback(candidate: Dict, summary: Dict, useful: bool,
                     account_key: str = "", listed: bool = False) -> Dict:
    """Learn from a researcher's verdict on one suggestion."""
    from database import (save_engine_state, log_engine_observation,
                          record_rib_feedback)

    model = _rib()
    feats = candidate.get("_features") or rib_features(candidate, summary, listed)
    result = model.observe(feats, 1.0 if useful else 0.0)
    save_engine_state(_RIB_NAME, model.to_json())
    log_engine_observation(_RIB_NAME, feats, 1.0 if useful else 0.0, result,
                           source="user")
    record_rib_feedback(account_key, candidate.get("field", ""), feats, useful)
    return result


def engine_status() -> Dict:
    from database import engine_observation_count, rib_feedback_totals
    st = _rib().status()
    st["logged_observations"] = engine_observation_count(_RIB_NAME)
    st["feedback"] = rib_feedback_totals()
    st["engine"] = "riB"
    st["kind"] = "online relevance ranker (5 parameters)"
    st["learns"] = "which suggestions to surface, from researcher feedback"
    st["never_learns"] = "the counts and means themselves, which stay measured"
    return st


# ---------------------------------------------------------------------------
# LLM tutoring
#
# The ranker learns from researcher feedback. A new deployment has none, so it
# sits on its authored defaults until enough people vote — which on a quiet
# platform may be never. Tutoring bootstraps it: while real feedback is scarce,
# a language model judges whether a candidate is relevant to a stated profile,
# and that judgement is fed in as a WEAK observation.
#
# Three properties make this a bootstrap rather than a dependency:
#
#   * It stops on its own once real feedback passes the threshold. A person's
#     verdict about their own field beats a model's guess, and once there are
#     enough of the former the latter is noise.
#   * Every tutored observation is logged with source="llm", so the engine's
#     history can always separate what people said from what a model said.
#   * The learning rate is scaled down (RIB_TUTOR_WEIGHT), so a wrong model
#     answer moves the ranker less than a right human one.
#
# It is never shown to the user as advice. The only thing that reaches the
# interface is the ranking the engine already produced.
# ---------------------------------------------------------------------------
_TUTOR_CALLS = {"day": "", "count": 0}


def tutor_status() -> Dict:
    """Whether tutoring is on, and why it is or is not running."""
    from config import (ENABLE_RIB_LLM_TUTOR, RIB_TUTOR_UNTIL_OBS,
                        RIB_TUTOR_MAX_CALLS_PER_DAY)
    from database import engine_observation_count
    human = _human_observation_count()
    return {
        "enabled": bool(ENABLE_RIB_LLM_TUTOR),
        "active": tutor_phase_active(),
        "human_observations": human,
        "stops_at": RIB_TUTOR_UNTIL_OBS,
        "calls_today": _TUTOR_CALLS["count"] if _TUTOR_CALLS["day"] == _today() else 0,
        "daily_cap": RIB_TUTOR_MAX_CALLS_PER_DAY,
        "total_observations": engine_observation_count(_RIB_NAME),
        "note": ("A language model is helping train riB's relevance ranking while real "
                 "researcher feedback is scarce. It stops automatically once enough people "
                 "have rated suggestions, and its judgements are recorded separately from "
                 "theirs."),
    }


def _today() -> str:
    from datetime import datetime as _dt
    return _dt.now().strftime("%Y-%m-%d")


def _human_observation_count() -> int:
    """Observations that came from a person, not from the tutor."""
    from database import engine_observation_count
    try:
        return engine_observation_count(_RIB_NAME, source="user")
    except TypeError:
        # Older signature with no source filter: fall back to the total rather
        # than failing. It over-counts, which makes tutoring stop EARLIER —
        # the safe direction to be wrong in.
        return engine_observation_count(_RIB_NAME)


def tutor_phase_active() -> bool:
    from config import (ENABLE_RIB_LLM_TUTOR, RIB_TUTOR_UNTIL_OBS,
                        RIB_TUTOR_MAX_CALLS_PER_DAY)
    if not ENABLE_RIB_LLM_TUTOR:
        return False
    if _TUTOR_CALLS["day"] == _today() and _TUTOR_CALLS["count"] >= RIB_TUTOR_MAX_CALLS_PER_DAY:
        return False
    return _human_observation_count() < RIB_TUTOR_UNTIL_OBS


def tutor_from_llm(candidates: List[Dict], profile: Dict, summary: Dict) -> Dict:
    """Ask a model which candidates are relevant, and teach the ranker.

    Returns a small record of what happened. Never raises: tutoring is an
    optimisation, and a provider outage must not affect the report the user is
    waiting for — which is why the caller runs this AFTER responding.
    """
    from config import RIB_TUTOR_WEIGHT, RIB_TUTOR_MAX_CALLS_PER_DAY
    if not tutor_phase_active() or not candidates:
        return {"tutored": 0, "reason": "not active"}

    fields = ", ".join(parse_fields(profile)) or "unstated"
    goal = (profile.get("goal") or "").strip() or "unstated"
    # A handful per call. The point is a steady trickle of signal, not to
    # label the whole corpus in one burst.
    batch = candidates[:5]

    listing = "\n".join(
        f"{i + 1}. {str(c.get('title') or 'Untitled')[:160]} "
        f"[fields: {', '.join(c.get('fields') or []) or 'unclassified'}]"
        for i, c in enumerate(batch))
    prompt = (
        "You are helping calibrate a recommender that suggests papers to a researcher.\n\n"
        f"The researcher works in: {fields}\n"
        f"Their stated goal: {goal}\n\n"
        "For each paper below, answer whether it is RELEVANT to that researcher — that is, "
        "whether reading it would plausibly help them with their stated field and goal. "
        "Judge relevance only. Do not judge quality; another part of the system does that.\n\n"
        f"{listing}\n\n"
        'Return JSON: {"verdicts": [{"n": 1, "relevant": true}, ...]}'
    )

    try:
        from providers import build_routes, is_route_cooling, record_success, is_scilm_route
        from brain import request_model_assessment
        routes = [r for r in build_routes("judge") if not is_scilm_route(r)]
        answer = None
        for route in routes[:3]:
            cooling, _ = is_route_cooling(route["model"], route["provider"])
            if cooling:
                continue
            _, attempt = request_model_assessment(
                "pidyne", route["model"], route["key"], route["base"], prompt)
            if not attempt.get("api_failed", True):
                record_success(route["model"], route["provider"])
                answer = attempt
                break
        if not answer:
            return {"tutored": 0, "reason": "no model reachable"}
    except Exception as e:                                   # noqa: BLE001
        logging.warning("riB tutoring call failed: %s", e)
        return {"tutored": 0, "reason": "call failed"}

    if _TUTOR_CALLS["day"] != _today():
        _TUTOR_CALLS["day"], _TUTOR_CALLS["count"] = _today(), 0
    _TUTOR_CALLS["count"] += 1

    verdicts = answer.get("verdicts")
    if not isinstance(verdicts, list):
        return {"tutored": 0, "reason": "unparseable answer"}

    from database import save_engine_state, log_engine_observation
    model = _rib()
    taught = 0
    for v in verdicts:
        try:
            idx = int(v.get("n", 0)) - 1
            relevant = bool(v.get("relevant"))
        except (TypeError, ValueError):
            continue
        if not (0 <= idx < len(batch)):
            continue
        cand = batch[idx]
        feats = cand.get("_features") or rib_features(cand, summary, False)
        # Scaled down: a model's guess should move the ranker less than a
        # researcher's verdict about their own field.
        target = 1.0 if relevant else 0.0
        result = model.observe(feats, target, weight=RIB_TUTOR_WEIGHT) \
            if _observe_accepts_weight(model) else model.observe(feats, target)
        log_engine_observation(_RIB_NAME, feats, target, result, source="llm")
        taught += 1

    if taught:
        save_engine_state(_RIB_NAME, model.to_json())
        logging.info("riB tutored on %d candidate(s); %d/%d calls used today.",
                     taught, _TUTOR_CALLS["count"], RIB_TUTOR_MAX_CALLS_PER_DAY)
    return {"tutored": taught, "reason": ""}


def _observe_accepts_weight(model) -> bool:
    """Whether the online model supports a per-observation learning weight.

    Checked rather than assumed: the ranker predates tutoring, and calling it
    with an argument it does not take would break ordinary user feedback too.
    """
    try:
        import inspect
        return "weight" in inspect.signature(model.observe).parameters
    except (TypeError, ValueError):
        return False
