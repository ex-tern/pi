"""Idle-time corpus growth.

When nobody is using the site, ScholarPi assesses open-access papers on its
own: it picks a live research topic, asks OpenAlex for open-access works on it,
retrieves one, and runs it through the ordinary assessment pipeline. The Map of
Science and the leaderboards therefore keep growing on a quiet deployment
instead of sitting at whatever the last visitor happened to upload.

Four constraints shape everything here, and each of them exists because the
obvious implementation gets it wrong:

  1. NOBODY IS CHARGED. An auto-assessment is work no user requested, so no
     user's piQ balance may move for it. `charge_fees` is off on this path.
     Author emission is untouched — the paper still earns what it qualifies
     for, because the paper's merit does not depend on who submitted it.

  2. IT ONLY RUNS WHEN THE SITE IS IDLE. "Idle" is measured from real request
     activity, not from a clock. Background work that competes with a live
     visitor for the same rate-limited provider quota makes the site slower for
     the one person actually using it.

  3. IT IS CAPPED, AND THE CAP IS DAILY. Providers rate-limit, and a runaway
     loop against a free tier is both expensive and self-defeating. The counter
     resets on the date, so a restart cannot be used to buy a fresh budget
     within the same day.

  4. IT NEVER RAISES INTO THE SERVER. Every step is wrapped. A failure here
     costs one skipped paper and a log line, never a request served to a
     person.

Off unless ENABLE_IDLE_ASSESSMENTS is set. A deployment that has not opted in
must not start spending on provider calls because it was left running.
"""

import time
import random
import logging
import threading
from datetime import datetime, timezone

import config


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
_STATE = {
    "day": "",
    "assessed_today": 0,
    "attempted_today": 0,
    "last_request_at": 0.0,
    "last_run_at": 0.0,
    "last_title": "",
    "last_error": "",
    "running": False,
    "seen": set(),          # DOIs tried this process, so a dud is not retried
}
_LOCK = threading.Lock()


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _roll_day():
    """Reset the daily counters when the date changes. Caller holds the lock."""
    today = _today()
    if _STATE["day"] != today:
        _STATE["day"] = today
        _STATE["assessed_today"] = 0
        _STATE["attempted_today"] = 0
        _STATE["seen"] = set()


def note_request():
    """Record that a real request was served. Called from the HTTP middleware.

    This is the only definition of "the site is busy" that means anything. A
    timer alone would happily run a batch of provider calls while somebody is
    waiting on an assessment, competing for the same rate-limited quota as the
    person who actually asked for something.
    """
    _STATE["last_request_at"] = time.time()


def idle_seconds() -> float:
    last = _STATE["last_request_at"]
    if not last:
        # Nothing has been served since start-up. Treat that as idle from the
        # moment the process began rather than as infinitely idle, so a fresh
        # deployment does not immediately fire a batch during boot.
        return 0.0
    return max(0.0, time.time() - last)


def status() -> dict:
    """Everything the owner panel needs, including when it is switched off."""
    with _LOCK:
        _roll_day()
        return {
            "enabled": bool(config.ENABLE_IDLE_ASSESSMENTS),
            "running": _STATE["running"],
            "assessed_today": _STATE["assessed_today"],
            "attempted_today": _STATE["attempted_today"],
            "daily_cap": config.IDLE_MAX_PER_DAY,
            "remaining_today": max(0, config.IDLE_MAX_PER_DAY - _STATE["assessed_today"]),
            "idle_seconds": round(idle_seconds()),
            "idle_threshold": config.IDLE_AFTER_SECONDS,
            "site_is_idle": idle_seconds() >= config.IDLE_AFTER_SECONDS,
            "last_title": _STATE["last_title"],
            "last_run_at": _STATE["last_run_at"],
            "last_error": _STATE["last_error"],
            # Stated explicitly because "the site assessed something while I was
            # away" invites exactly one question, and it should be answered
            # before it is asked.
            "funding": ("Assessed at no cost to any account. Idle assessments are not "
                        "charged to a user's piQ balance."),
        }


def _may_run() -> bool:
    with _LOCK:
        _roll_day()
        if not config.ENABLE_IDLE_ASSESSMENTS:
            return False
        if _STATE["running"]:
            return False
        if _STATE["assessed_today"] >= config.IDLE_MAX_PER_DAY:
            return False
        # Attempts are capped separately and more loosely. A run of papers that
        # cannot be retrieved must not be able to spin indefinitely against
        # OpenAlex just because none of them reached the assessment stage.
        if _STATE["attempted_today"] >= config.IDLE_MAX_PER_DAY * 4:
            return False
        if idle_seconds() < config.IDLE_AFTER_SECONDS:
            return False
        _STATE["running"] = True
        return True


# ---------------------------------------------------------------------------
# One unit of work
# ---------------------------------------------------------------------------
def _pick_candidate():
    """Choose one open-access work that this process has not already tried.

    Imports are deferred to call time, not module scope: api imports this
    module, so importing api from the top of this file would be circular.
    """
    # These live in two different modules and it matters which: topic discovery
    # is a scientometrics concern, retrieval is an integrations one. Importing
    # both from `integrations` raised ImportError on the first idle tick — the
    # loop caught it and logged, so the worker degraded to doing nothing at all
    # rather than failing loudly at start-up.
    from scientometrics import fetch_active_research_topics
    from integrations import search_open_access_works

    topics = []
    try:
        topics = (fetch_active_research_topics(limit=10) or {}).get("topics") or []
    except Exception as e:                                       # noqa: BLE001
        logging.warning("Idle worker could not fetch topics: %s", e)
    if not topics:
        from api import HOT_TOPICS
        topics = list(HOT_TOPICS)
    if not topics:
        return None

    topic = random.choice(topics)
    topic = topic.get("name") if isinstance(topic, dict) else str(topic)
    if not topic:
        return None

    try:
        results = search_open_access_works(topic, limit=25) or []
    except Exception as e:                                       # noqa: BLE001
        logging.warning("Idle worker search failed for %r: %s", topic, e)
        return None

    random.shuffle(results)
    for r in results:
        doi = (r.get("doi") or "").strip()
        if not doi or doi in _STATE["seen"]:
            continue
        return {"topic": topic, "doi": doi,
                "title": (r.get("title") or "").strip(),
                "pdf_url": (r.get("pdf_url") or "").strip(),
                "pdf_candidates": r.get("pdf_candidates") or []}
    return None


def run_once() -> dict:
    """Assess at most one paper. Safe to call from a thread or a scheduler."""
    if not _may_run():
        return {"ran": False, "reason": "not eligible"}

    try:
        from api import (retrieve_manuscript_bytes, build_result_payload,
                         estimate_word_count, add_log)
        from brain import process_single_pdf
        import paper_store

        candidate = _pick_candidate()
        if not candidate:
            return {"ran": False, "reason": "no candidate found"}

        with _LOCK:
            _STATE["attempted_today"] += 1
            _STATE["seen"].add(candidate["doi"])

        pdf_bytes, attempts = retrieve_manuscript_bytes(
            doi=candidate["doi"], pdf_url=candidate["pdf_url"],
            candidates=candidate["pdf_candidates"])
        if not pdf_bytes:
            return {"ran": False, "reason": "could not retrieve", "doi": candidate["doi"]}

        paper_store.store_paper(pdf_bytes)
        fname = f"Idle_{candidate['doi'].replace('/', '_')[:60]}.pdf"

        # user_id is the platform itself, never a person. An idle assessment
        # has no submitter, so attributing one would put a paper in somebody's
        # history that they did not submit — and, worse, could make them look
        # like its curator.
        res = process_single_pdf(pdf_bytes, fname, "", "ScholarPi (idle)", "",
                                 provided_doi=candidate["doi"])
        if not res:
            return {"ran": False, "reason": "assessment returned nothing"}

        item = build_result_payload(res, fname)

        # A merged duplicate is not growth. It cost a retrieval, not an
        # assessment, so it does not consume the daily budget — otherwise a
        # corpus that already holds the popular papers on a topic would burn
        # its whole allowance rediscovering them.
        if item.get("duplicate"):
            return {"ran": False, "reason": "already in the corpus",
                    "doi": candidate["doi"], "eval_hash": item.get("eval_hash")}

        with _LOCK:
            _STATE["assessed_today"] += 1
            _STATE["last_title"] = item.get("title") or candidate["title"]
            _STATE["last_run_at"] = time.time()
            _STATE["last_error"] = ""

        add_log(f"Idle assessment: {(item.get('title') or candidate['doi'])[:70]} "
                f"(topic: {candidate['topic'][:40]}) — no account was charged.")
        return {"ran": True, "title": item.get("title"), "doi": candidate["doi"],
                "eval_hash": item.get("eval_hash"), "score": item.get("score")}

    except Exception as e:                                       # noqa: BLE001
        logging.exception("Idle assessment failed")
        with _LOCK:
            _STATE["last_error"] = str(e)[:300]
        return {"ran": False, "reason": "error", "error": str(e)[:200]}
    finally:
        with _LOCK:
            _STATE["running"] = False


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------
def _loop():
    # A first wait before anything happens, so a restart during a busy period
    # does not immediately treat "no requests yet this process" as quiet.
    time.sleep(config.IDLE_AFTER_SECONDS)
    while True:
        try:
            run_once()
        except Exception:                                        # noqa: BLE001
            logging.exception("Idle worker loop error")
        # Jittered, so several instances behind one load balancer do not all
        # wake at the same second and hit the same provider together.
        time.sleep(config.IDLE_POLL_SECONDS * (0.75 + random.random() * 0.5))


def start():
    """Start the background loop if the deployment has opted in."""
    if not config.ENABLE_IDLE_ASSESSMENTS:
        logging.info("Idle assessments are disabled (ENABLE_IDLE_ASSESSMENTS is not set).")
        return False
    t = threading.Thread(target=_loop, name="idle-assessments", daemon=True)
    t.start()
    logging.info("Idle assessments enabled: up to %d papers/day after %ds of quiet. "
                 "No account is charged for them.",
                 config.IDLE_MAX_PER_DAY, config.IDLE_AFTER_SECONDS)
    return True
