"""core.py: the FastAPI app and what every router shares: configuration, logging, the
database, the gate, rate limits, logs, the startup hook. Split from api.py; see DESIGN.md section 5."""
"""
ScholarPi — standalone FastAPI backend.

This replaces the Streamlit app (app.py + shared_ui.py + pages/*.py) with a
plain local webapp: this file is the server, /frontend is the client.
All core scoring/ledger/blockchain logic is untouched and imported straight
from brain.py / ledger.py / database.py / integrations.py.

Run with:  uvicorn api:app --host 127.0.0.1 --port 8000 --reload
Production:  gunicorn api:app -c gunicorn.conf.py   (see README)
"""
import os
import shutil
import re
import json
import uuid
import decimal
import time
import concurrent.futures
import random
import hashlib
import hmac
import logging
import logging.handlers
import colorsys
import threading
import traceback
import base64
import urllib.parse
from datetime import datetime
from collections import deque, defaultdict
from typing import Optional, List, Dict, Tuple

import sqlite3

import requests
from fastapi import (FastAPI, HTTPException, UploadFile, File, Form, Query, Request,
                     BackgroundTasks)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, HTMLResponse, StreamingResponse, PlainTextResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from web3 import Web3
from eth_account.messages import encode_defunct

from config import (
    BASE_DIR, DB_PATH, PIQ_CONTRACT_ADDRESS, HOT_TOPICS,
    ORCID_CLIENT_ID, ORCID_CLIENT_SECRET, ORCID_REDIRECT_URI, FRONTEND_ORIGIN, OWNER_ID,
    ENVIRONMENT, IS_PRODUCTION, ALLOWED_ORIGINS, MAX_UPLOAD_MB,
    RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS, ENABLE_SCILEM_LOCAL_MODEL, config_summary,
    SCILEM_DISABLED_NOTICE, ENABLE_SCILEM_ASSISTANT, SCILEM_MODE, SCILEM_LIMITED_NOTICE,
    PIQ_PROCESSING_FEE, DONATION_WALLET,
    DONATION_CHAIN_ID, DONATION_CHAIN_NAME, DONATION_CURRENCY,
    DONATION_EXPLORER_URL, DONATION_RPC_URLS,
    GROQ_API_KEY, OR_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY,
    DEEPSEEK_API_KEY, TOGETHER_API_KEY, GITHUB_MODELS_TOKEN,
    CHAIN_ID, CHAIN_NAME, CHAIN_CURRENCY, BLOCK_EXPLORER_URL, ETH_ADMIN_PRIVATE_KEY,
    TURNSTILE_SITE_KEY, REQUIRE_PROOF_OF_WORK, USE_LSTM_FORECAST,
    ENABLE_AUTO_SETTLEMENT, AUTO_SETTLE_BATCH, AUTO_SETTLE_INTERVAL_SECONDS,
)
from api_helpers import client_ip
from database import (
    get_db_connection, get_free_evals_used, increment_free_evals_used,
    get_piq_balance, charge_piq_fee, refund_piq_fee, get_piq_fee_history,
    get_piq_rewards_total,
    award_onboarding_grant, has_received_grant,
    get_bonus_evals, get_bonus_award_state,
    get_field_corpus_stats, save_researcher_profile, get_researcher_profile,
    list_profile_slots, save_profile_slot, activate_profile_slot, delete_profile_slot,
    MAX_PROFILE_SLOTS,
    delete_researcher_profile, list_assessments_for_identity, delete_assessment,
    store_bug_report, mark_bug_report_delivered, list_bug_reports, CONTACT_KINDS,
    get_arcade_progress, record_arcade_run, reset_arcade_difficulty, arcade_leaderboard,
    list_unclaimed_escrow, disown_escrow, list_disowned,
    list_unsettled_mintable, record_settlement, real_doi, grant_piq,
    get_curation_stats, credit_curation_reward, get_curation_award_for,
    list_escrowed_for_identity, release_escrow,
    store_challenge, get_challenge, record_challenge_attempt,
    set_published, publication_fee_paid,
    open_review_request, list_open_reviews, complete_review, review_summary,
    record_llm_review, has_open_review_request, open_review_bounty,
    has_human_review, cancel_review_request,
    add_unsolicited_review,
    count_journal_publications,
    review_owner_key, add_review_rebuttal, rate_review, review_rating_summary,
    report_review, rebuttals_for_paper, list_review_reports,
    REBUTTAL_MIN_CHARS, REPORT_REASONS,
    RESET_GROUPS, reset_state_groups,
    record_paper_read, get_paper_reads,
    create_review_job, finish_review_job, list_review_jobs, reclaim_stale_review_jobs,
    latest_backups, list_scilem_observations,
    get_papers_for_recommendation, get_corpus_totals,
    record_visit, visitor_stats,
)
import arcade
import diagnostics
import paper_store
from ledger import (restore_state_from_web3, get_sepolia_explorer_url, get_chain_status,
                    mint_pi_quotient_token)
import ledger as ledger_backup
from integrations import (
    normalize_doi, search_scholarly_works,
    clean_author_name, is_likely_institution, fetch_doi_metadata,
    fetch_semantic_scholar_pdf, download_pdf, fetch_core_text_by_doi,
    build_pdf_from_text,
)
from attribution import (verify_authorship, verify_journal_claim,
                         names_match, fetch_orcid_profile_name)
from extraction import full_text_from_pdf
from brain import (
    process_single_pdf, generate_rebuttal_strategy, PidyneLSTM,
    PidyneBlockchainDataset, clear_structural_analyzer_state,
    derive_next_epoch_weights, load_torch,
)
from providers import provider_configuration
from rubric import (
    rubric_manifest, RUBRIC_VERSION, apply_scoring_rubric, compute_composite_score,
    CRITERIA_ORDER as BRAIN_CRITERIA_ORDER,
)
from emission import (
    emission_manifest, compute_processing_fee, fee_manifest,
    compute_curation_reward, publication_fee, peer_review_fee, llm_review_fee,
    peer_review_bonus, PEER_REVIEW_BONUS,
    MIN_REVIEW_BOUNTY, MAX_REVIEW_BOUNTY,
    onboarding_grant, NEW_PARTICIPANT_GRANT, compute_document_fee, MINIMUM_FEE,
)
import pid_engine as forecast_engine
import assistant as scilem
import abuse_guard
import bugreport
import rib_engine
import rib_suggest
import rib_engine as rib_learning
import auth
import authorship_challenge
import sim_engine as scilem_learning
import idle_worker
import challenge as pow_challenge
from scientometrics import FIELD_TO_DOMAIN, fetch_active_research_topics

import numpy as np

# torch is NOT imported here — see brain.load_torch(). Importing it at module
# scope cost ~350MB in every worker to serve an optional, off-by-default
# feature, which is what was OOM-killing this app on a 512MB host.

# ---------------------------------------------------------------------------
# Logging — actually configured (the app previously called logging.info()
# with no handler attached, so nothing was ever written anywhere).
# ---------------------------------------------------------------------------
# stdout first, and unconditionally. Every container platform captures it, so
# it is the handler that always works.
_log_handlers = [logging.StreamHandler()]

# A log FILE is a convenience. The directory creation was previously
# unguarded — while the handler below it was wrapped in try/except — so a data
# directory the process could not write to raised PermissionError at import
# time and the worker died before serving a single request. That is exactly
# what happens the first time a volume is mounted, because the mount arrives
# root-owned and replaces whatever the image had prepared. The application
# must not refuse to start over somewhere to put logs.
_LOG_DIR = os.path.join(BASE_DIR, "logs")
try:
    os.makedirs(_LOG_DIR, exist_ok=True)
    _log_handlers.append(
        logging.handlers.RotatingFileHandler(
            os.path.join(_LOG_DIR, "scholarpi.log"), maxBytes=5_000_000, backupCount=5
        )
    )
except OSError as _log_err:
    print(f"[startup] File logging disabled ({_log_err}); logging to stdout only.",
          file=sys.stderr)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=_log_handlers,
)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="ScholarPi API",
    version="2.0.0",
    docs_url=None if IS_PRODUCTION else "/api/docs",
    redoc_url=None if IS_PRODUCTION else "/api/redoc",
    openapi_url=None if IS_PRODUCTION else "/api/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# A password on the whole site when SITE_PASSWORD is set (the experimental copies); see gate.py.
import gate as _gate
_gate.install(app, lambda: os.getenv("SESSION_SECRET", "").strip())

w3 = Web3()
APP_LOGS = deque(maxlen=200)
_STATE_RESTORED = False
_RATE_LIMIT_BUCKETS = defaultdict(list)  # ip -> [timestamps]


def add_log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    entry = f"[{ts}] {msg}"
    APP_LOGS.appendleft(entry)
    logging.info(msg)


def get_client_ip(request: Request) -> str:
    return client_ip(request)


def check_rate_limit(ip: str, bucket: str = "default"):
    """Simple in-memory sliding-window rate limiter — no extra dependency,
    good enough for a single-process deployment. For multi-worker/production
    deployments behind a load balancer, put this behind nginx's own
    rate-limiting (see deploy/nginx.conf.example) instead/as well."""
    key = f"{bucket}:{ip}"
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW_SECONDS
    bucket_list = _RATE_LIMIT_BUCKETS[key]
    while bucket_list and bucket_list[0] < window_start:
        bucket_list.pop(0)
    if len(bucket_list) >= RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down and try again shortly.")
    bucket_list.append(now)


def safe_float(val, default=0.0):
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    try:
        return float(val)
    except Exception:
        import re
        try:
            nums = re.findall(r"[-+]?\d*\.\d+|\d+", str(val))
            return float(nums[0]) if nums else default
        except Exception:
            return default


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Never leak stack traces to clients; always keep them debuggable.

    The full traceback goes to the process log, as before. What is new is that
    a one-line summary also goes to `add_log`, which is what feeds the owner's
    Live System Monitor.

    Without that, a 500 was invisible from inside the running application: the
    caller saw "Internal server error." with no endpoint, no exception type and
    no location, and the only copy of the useful information was in the hosting
    platform's log stream. Diagnosing a fault should not require leaving the
    product — especially when the person who has to diagnose it is the one
    already looking at the sidebar.

    A short reference is returned to the client too. It identifies nothing
    about the request; it just gives the caller something to quote that can be
    matched against the log line, so "I got a 500" becomes answerable.
    """
    tb = traceback.format_exc()
    logging.error("Unhandled exception on %s %s: %s\n%s",
                  request.method, request.url.path, exc, tb)

    # The deepest frame inside this codebase, which is almost always where the
    # bug is. The last frame overall is frequently in a library and says
    # nothing useful about which of our lines was wrong.
    where = ""
    try:
        frames = [f for f in traceback.extract_tb(exc.__traceback__)
                  if BASE_DIR in (f.filename or "")]
        if frames:
            f = frames[-1]
            where = f" at {os.path.basename(f.filename)}:{f.lineno} in {f.name}()"
    except Exception:                                            # noqa: BLE001
        pass

    ref = uuid.uuid4().hex[:8]
    try:
        add_log(f"500 [{ref}] {request.method} {request.url.path} — "
                f"{type(exc).__name__}: {str(exc)[:200]}{where}")
    except Exception:                                            # noqa: BLE001
        # A logging failure must never replace the error being reported.
        pass

    detail = ("Internal server error." if IS_PRODUCTION
              else f"{type(exc).__name__}: {exc}{where}")
    return JSONResponse(status_code=500,
                        content={"detail": detail, "ref": ref})


@app.middleware("http")
async def _track_activity(request: Request, call_next):
    """Every served request marks the site as busy.

    This is what makes idle_worker's notion of "idle" real rather than a timer.
    Only requests that mean somebody is using the site count (see
    idle_worker.is_busy_request); provider-using ones also count as in flight
    until they finish. Cheap on purpose: it runs on every request, including
    static assets.
    """
    path, method = request.url.path, request.method
    idle_worker.note_request(path, method)
    counted = idle_worker.begin(path, method)
    try:
        response = await call_next(request)
    except Exception:
        if counted:
            idle_worker.end()
        raise
    if not counted:
        return response
    # A streamed assessment is still running after call_next returns: it only
    # counts as finished when its last chunk has gone out.
    body = getattr(response, "body_iterator", None)
    if body is None:
        idle_worker.end()
        return response

    async def _tracked():
        try:
            async for chunk in body:
                yield chunk
        finally:
            idle_worker.end()
    response.body_iterator = _tracked()
    return response


@app.on_event("startup")
def on_startup():
    global _STATE_RESTORED
    for line in config_summary():
        logging.info(line)
    if not _STATE_RESTORED:
        # Bounded inside restore_state_from_web3, but guarded again here.
        # Startup blocks the server from accepting connections, so anything
        # slow added to this function silently becomes a deployment failure —
        # the healthcheck times out and the platform reports a broken app that
        # is in fact working. Nothing here may be unbounded.
        _restore_started = time.time()
        try:
            restore_state_from_web3()
        except Exception as e:
            add_log(f"State restore warning: {e}")
        finally:
            _elapsed = time.time() - _restore_started
            if _elapsed > 10:
                logging.warning(
                    "State restore took %.1fs of the startup window. If deploys begin failing "
                    "their healthcheck, lower RESTORE_BUDGET_SECONDS.", _elapsed)
        _STATE_RESTORED = True

    # Refund reviews this process was killed in the middle of. A background
    # worker does not survive a restart, so without this the fee for an
    # interrupted review stays charged against a report that will never be
    # written — the user would have paid for nothing and had no way to tell.
    try:
        for stale in reclaim_stale_review_jobs():
            if stale["fee"] > 0:
                refund_piq_fee(stale["fee"], stale["wallet"], stale["orcid"],
                               eval_hash=stale["hash"],
                               reason="LLM review refund (interrupted by restart)")
                add_log(f"Refunded {stale['fee']:.2f} piQ for review job {stale['id']} "
                        f"interrupted by a restart.")
    except Exception as e:
        logging.warning("Could not reclaim stale review jobs: %s", e)

    # Say plainly, at every boot, whether this deployment can survive a
    # redeploy. The failure mode is silent by construction: an ephemeral
    # filesystem raises no error, it simply comes back empty, so the operator
    # discovers it only by noticing the corpus has reset.
    # Started after restore, on a daemon thread, so it cannot lengthen the
    # startup window that the platform healthcheck is timing.
    try:
        idle_worker.start()
    except Exception as e:
        logging.warning("Idle assessment worker could not start: %s", e)

    # Drains the settlement queue on a timer. Daemon thread, same as above, so
    # it cannot delay the healthcheck or hold the process open on shutdown.
    try:
        start_auto_settlement()
    except Exception as e:
        logging.warning("Automatic settlement could not start: %s", e)

    verdict = (PERSISTENCE_REPORT or {}).get("verdict")
    backups_on = False
    try:
        backups_on = ledger_backup.ipfs_backup_available()
    except Exception:
        pass

    if verdict == "ephemeral" and not backups_on:
        add_log(
            "DATA WILL BE LOST ON REDEPLOY. This host's filesystem is ephemeral and no IPFS "
            "backup is configured, so the ledger, piQ balances and assessment history are "
            "discarded every time the app restarts. Mount a persistent volume at "
            "SCHOLARPI_DATA_DIR, or set PINATA_API_KEY, PINATA_SECRET_API_KEY and "
            "BACKUP_ENCRYPTION_KEY to enable off-host backups."
        )
        logging.error("EPHEMERAL STORAGE WITH NO BACKUP — state is discarded on every redeploy.")
    elif verdict == "ephemeral":
        add_log(
            "This host's filesystem is ephemeral. Encrypted IPFS backups are configured, so "
            "state is restored on boot — but anything assessed since the last backup is lost. "
            "A persistent volume is the durable fix; backups are a safety net."
        )
    add_log("Backend started.")


# ---------------------------------------------------------------------------
# 0. HEALTH CHECK  (for Docker HEALTHCHECK / load balancer / uptime monitors)
# ---------------------------------------------------------------------------
# Storage durability check, run once at startup. A container platform without a
# mounted volume silently discards the ledger on every deploy, and the failure
# is invisible because nothing errors — so this reports it loudly instead.
try:
    from persistence import check_persistence
    PERSISTENCE_REPORT = check_persistence(BASE_DIR, DB_PATH)
except Exception as _e:
    logging.warning("Persistence check failed: %s", _e)
    PERSISTENCE_REPORT = {"verdict": "unknown", "warning": None}


# Which build is actually running.
#
# Diagnosing this deployment repeatedly came down to one unanswerable question:
# is the code I am looking at the code that is running? Inferring it from
# whether some endpoint happens to 404 is slow and easy to get wrong. Railway
# injects the commit SHA, so the answer can simply be reported.
BUILD_SHA = (os.getenv("RAILWAY_GIT_COMMIT_SHA")
             or os.getenv("SOURCE_COMMIT")
             or os.getenv("GIT_COMMIT") or "")
BUILD_INFO = {
    "commit": BUILD_SHA[:12] or "unknown",
    "branch": os.getenv("RAILWAY_GIT_BRANCH", "") or None,
    "deployed_at": datetime.now().isoformat(timespec="seconds"),
    # Bumped by hand when a change must be verifiable as live. Cheap, and it
    # works even where the platform injects no git metadata at all.
    "app_version": "2026.07.31",
    # "stable" for the main site, "experimental" for the copy that evolves
    # constantly (exp.<domain>, deployed from the `experimental` branch).
    # The frontend shows a banner on anything that is not stable.
    "channel": (os.getenv("SCHOLARPI_CHANNEL", "stable").strip().lower() or "stable"),
    "stable_url": os.getenv("SCHOLARPI_STABLE_URL", "").strip() or None,
    # "superellipse" turns on the squircle look (frontend/superellipse.css);
    # se.<domain> gets it from its host name anyway.
    "shape": (os.getenv("SCHOLARPI_SHAPE", "").strip().lower() or None),
}
IS_EXPERIMENTAL = BUILD_INFO["channel"] != "stable"


def parse_json_or_default(raw, default):
    if not raw:
        return default
    try:
        parsed = json.loads(raw)
        return parsed if parsed is not None else default
    except Exception:
        return default
