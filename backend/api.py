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
import io
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
import urllib.parse
from datetime import datetime
from collections import deque, defaultdict
from typing import Optional, List, Dict, Tuple

import sqlite3

import requests
from fastapi import (FastAPI, HTTPException, UploadFile, File, Form, Header, Query, Request,
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
from database import (
    get_db_connection, get_free_evals_used, increment_free_evals_used,
    get_piq_balance, charge_piq_fee, refund_piq_fee, get_piq_fee_history,
    get_piq_rewards_total,
    award_onboarding_grant, has_received_grant,
    get_bonus_evals, get_bonus_award_state, grant_bonus_evals,
    get_field_corpus_stats, save_researcher_profile, get_researcher_profile,
    list_profile_slots, save_profile_slot, activate_profile_slot, delete_profile_slot,
    MAX_PROFILE_SLOTS,
    delete_researcher_profile, list_assessments_for_identity, delete_assessment,
    store_bug_report, mark_bug_report_delivered, list_bug_reports, CONTACT_KINDS,
    get_arcade_progress, record_arcade_run, reset_arcade_difficulty, arcade_leaderboard,
    list_unclaimed_escrow, disown_escrow, list_disowned,
    list_unsettled_mintable, record_settlement, real_doi, grant_piq,
    get_curation_stats, credit_curation_reward, get_curation_award_for,
    list_escrowed_for_identity, total_escrowed, release_escrow,
    store_challenge, get_challenge, record_challenge_attempt,
    set_published, is_published, publication_fee_paid,
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
    record_backup_cid, latest_backups, list_scilem_observations,
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
    build_pdf_from_text, search_open_access_works,
)
from attribution import (verify_authorship, verify_journal_claim,
                         names_match, fetch_orcid_profile_name)
from extraction import fetch_registry_metadata, full_text_from_pdf
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
    """Respect X-Forwarded-For when running behind a reverse proxy (nginx,
    a load balancer, etc.) — falls back to the direct connection otherwise."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


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
    It is deliberately the cheapest possible middleware — one clock read and an
    assignment — because it runs on the hot path of every request including
    static assets.
    """
    idle_worker.note_request()
    return await call_next(request)


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
}


@app.get("/api/build")
def build_info():
    """Public, and deliberately so: it identifies a build, not its contents."""
    return BUILD_INFO


@app.get("/api/health")
def health_check():
    db_ok = True
    try:
        conn = get_db_connection()
        conn.execute("SELECT 1")
        conn.close()
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "build": BUILD_INFO,
        "environment": ENVIRONMENT,
        "database": "ok" if db_ok else "unreachable",
        "storage": {
            "verdict": PERSISTENCE_REPORT.get("verdict"),
            "boot_count": PERSISTENCE_REPORT.get("boot_count"),
            "data_dir": PERSISTENCE_REPORT.get("data_dir"),
            "warning": PERSISTENCE_REPORT.get("warning"),
        },
    }


# ---------------------------------------------------------------------------
# 1. LOGS
# ---------------------------------------------------------------------------
@app.get("/api/logs")
def get_logs(request: Request, wallet: str = Query(default="")):
    """Operational log. Owner only.

    This was public. It carries wallet addresses, ORCIDs, authentication
    events, assessment failures and provider error categories — an operator's
    view of who used the deployment and what broke, served to anyone who
    guessed the path. It was genuinely useful for diagnosing this deployment
    remotely, which is precisely the problem: what helps a maintainer debug
    also helps anyone else map the system and its users.

    A break-glass token exists deliberately. Owner authorisation needs a signed
    session, and the situations where these logs matter most are exactly the
    ones where signing in may not work — a failed deploy, a missing
    SESSION_SECRET, a broken frontend. Locking the only diagnostic behind the
    thing that might be broken is how an operator ends up with no way in.
    """
    break_glass = os.getenv("LOG_ACCESS_TOKEN", "").strip()
    if break_glass:
        supplied = auth.token_from_request(request)
        # compare_digest so a wrong guess cannot be refined from timing.
        if supplied and hmac.compare_digest(supplied, break_glass):
            return {"logs": list(APP_LOGS), "access": "break-glass"}

    require_owner(request, wallet)
    return {"logs": list(APP_LOGS), "access": "owner"}


# ---------------------------------------------------------------------------
# 2. AUTH — MetaMask (SIWE-style) + ORCID
# ---------------------------------------------------------------------------
class WalletVerifyRequest(BaseModel):
    address: str
    message: Optional[str] = None
    signature: Optional[str] = None


@app.post("/api/auth/wallet/verify")
def verify_wallet(req: WalletVerifyRequest, request: Request):
    # An authentication surface, and ECDSA recovery is not free. Unlimited
    # attempts let an attacker both burn CPU and grind signatures offline
    # against a live oracle.
    check_rate_limit(get_client_ip(request), bucket="auth")
    if not w3.is_address(req.address):
        raise HTTPException(status_code=400, detail="Not a valid Ethereum address.")
    clean_wallet = w3.to_checksum_address(req.address)
    authenticated = False
    if req.signature and req.message:
        try:
            decoded_msg = urllib.parse.unquote(req.message)
            signable_msg = encode_defunct(text=decoded_msg)
            recovered = w3.eth.account.recover_message(signable_msg, signature=req.signature)
            authenticated = recovered.lower() == clean_wallet.lower()
        except Exception as e:
            add_log(f"SIWE signature verification fallback: {e}")
    if not authenticated:
        # An unsigned "link" proves nothing and now grants nothing. Returning a
        # session here would recreate the exact hole this replaces.
        add_log(f"Wallet link attempted without a valid signature: {clean_wallet}")
        return {
            "address": clean_wallet, "authenticated": False, "token": "",
            "detail": ("Signature required. Connecting an address proves you can type it, not "
                       "that you control it."),
        }

    add_log(f"Wallet authenticated by EIP-191 signature: {clean_wallet}")

    # Carry forward an ORCID that is ALREADY proven in the caller's current
    # session, exactly as the ORCID callback carries forward a proven wallet.
    #
    # Without this, signing a wallet after linking ORCID minted a token holding
    # only the wallet and silently dropped the ORCID. The browser still had both
    # in localStorage, so the sidebar — which passes both as parameters — summed
    # both accounts, while every identity-scoped action used the narrower token.
    # The result was a user shown a spendable balance of 0.51 piQ being told
    # their balance was 0.01 when they tried to spend it.
    #
    # This re-reads the ORCID from the signed token, never from a parameter, so
    # it asserts nothing the server did not already verify.
    methods = {"wallet": "signature"}
    proven_orcid = ""
    existing = auth.verify_session(auth.token_from_request(request))
    if existing and existing.get("orcid"):
        proven_orcid = existing["orcid"]
        methods["orcid"] = existing.get("methods", {}).get("orcid", "oauth")

    token = auth.issue_session(wallet=clean_wallet, orcid=proven_orcid, methods=methods)
    return {
        "address": clean_wallet, "authenticated": True, "token": token,
        "expires_in": auth.SESSION_TTL_SECONDS,
        "detail": None if token else ("Signature verified, but this deployment cannot sign "
                                      "sessions. Set SESSION_SECRET to enable sign-in."),
    }


def resolve_orcid_redirect_uri(request: Request) -> str:
    """The callback URL registered with ORCID, defaulting to this deployment."""
    configured = (ORCID_REDIRECT_URI or "").strip()
    if configured and "localhost" not in configured and "127.0.0.1" not in configured:
        return configured
    return f"{resolve_frontend_origin(request)}/api/auth/orcid/callback"


@app.get("/api/auth/session")
def auth_session(request: Request):
    """What this caller has actually proven, and by which method.

    The UI needs to distinguish "an address is typed into a box" from "control
    of that address was demonstrated". Those looked identical before, which is
    why an unsigned wallet appeared to confer the same access as a signed one.
    """
    identity = auth.identity_from_request(request)
    return {
        "verified": identity["verified"],
        "wallet": identity["wallet"] or None,
        "orcid": identity["orcid"] or None,
        "methods": identity["methods"],
        "is_owner": auth.is_owner(identity),
        # Two independent proofs: a private key AND an ORCID account.
        "two_factor": bool(identity["verified"]
                           and identity["wallet"] and identity["orcid"]),
        "sessions_enabled": auth.sessions_available(),
        "note": (None if auth.sessions_available() else
                 "Sign-in is disabled: set SESSION_SECRET so sessions can be signed."),
    }


@app.get("/api/auth/orcid/login-url")
def orcid_login_url(request: Request, wallet: Optional[str] = None):
    if not ORCID_CLIENT_ID or not ORCID_CLIENT_SECRET:
        raise HTTPException(
            status_code=503,
            detail="ORCID sign-in is not configured on this deployment "
                   "(ORCID_CLIENT_ID / ORCID_CLIENT_SECRET are unset).",
        )
    state_payload = wallet if wallet and w3.is_address(wallet) else "none"
    redirect_uri = resolve_orcid_redirect_uri(request)
    url = (
        f"https://orcid.org/oauth/authorize?client_id={ORCID_CLIENT_ID}"
        f"&response_type=code&scope=/authenticate"
        f"&redirect_uri={urllib.parse.quote(redirect_uri, safe='')}"
        f"&state={state_payload}"
    )
    return {"url": url, "redirect_uri": redirect_uri}


def resolve_frontend_origin(request: Request) -> str:
    """Where to send the browser back to after an OAuth round trip.

    FRONTEND_ORIGIN defaults to http://localhost:8000, which is correct for
    local development and wrong for every deployment. On a hosted instance the
    ORCID callback was redirecting to localhost, so the browser silently
    dropped the `?orcid=` parameters and the sidebar never showed the account
    as connected.

    An explicitly configured FRONTEND_ORIGIN still wins; otherwise the origin
    is derived from the request itself, honouring the proxy headers that
    platforms like Railway set.
    """
    configured = (FRONTEND_ORIGIN or "").strip().rstrip("/")
    if configured and configured not in ("http://localhost:8000", "http://127.0.0.1:8000"):
        return configured

    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if forwarded_host:
        proto = request.headers.get("x-forwarded-proto")
        if not proto:
            proto = "https" if not forwarded_host.startswith(("localhost", "127.0.0.1")) else "http"
        return f"{proto}://{forwarded_host}".rstrip("/")
    return configured or "http://localhost:8000"


@app.get("/api/auth/orcid/callback")
def orcid_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None):
    frontend = resolve_frontend_origin(request)
    wallet_qs = ""
    if state and state != "none" and w3.is_address(state):
        wallet_qs = f"&wallet={w3.to_checksum_address(state)}"

    if not code:
        return RedirectResponse(f"{frontend}/?orcid_error=missing_code")

    try:
        res = requests.post(
            "https://orcid.org/oauth/token",
            data={
                "client_id": ORCID_CLIENT_ID,
                "client_secret": ORCID_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": resolve_orcid_redirect_uri(request),
            },
            headers={"Accept": "application/json"},
        )
        if res.status_code == 200:
            data = res.json()
            real_orcid = data.get("orcid")
            real_name = data.get("name") or (f"ORCID Scholar ({real_orcid[-4:]})" if real_orcid else "")
            if real_orcid:
                add_log(f"ORCID authenticated via OAuth: {real_orcid}")
                name_qs = urllib.parse.quote(real_name or "")

                # The OAuth code exchange is the proof, so a session is minted
                # here. The wallet from `state` is carried only if it was itself
                # proven — a wallet that merely rode along in a query parameter
                # is a claim, and folding it into a signed token would launder
                # that claim into an assertion the server never verified.
                proven_wallet = ""
                methods = {"orcid": "oauth"}
                existing = auth.verify_session(request.query_params.get("token", ""))
                if existing and existing.get("wallet"):
                    proven_wallet = existing["wallet"]
                    methods["wallet"] = existing.get("methods", {}).get("wallet", "signature")

                token = auth.issue_session(wallet=proven_wallet, orcid=real_orcid, methods=methods)
                token_qs = f"&token={urllib.parse.quote(token)}" if token else ""
                return RedirectResponse(
                    f"{frontend}/?orcid={real_orcid}&orcid_name={name_qs}{wallet_qs}{token_qs}")
        err_desc = res.json().get("error_description", "Invalid Code") if res.content else "Invalid Code"
        add_log(f"ORCID Auth Error: {err_desc}")
        return RedirectResponse(f"{frontend}/?orcid_error={urllib.parse.quote(err_desc)}")
    except Exception as e:
        add_log(f"Failed to connect to ORCID API: {e}")
        return RedirectResponse(f"{frontend}/?orcid_error={urllib.parse.quote(str(e))}")


def count_assessed_papers() -> int:
    conn = get_db_connection()
    try:
        return conn.execute("SELECT COUNT(*) FROM papers_assessment").fetchone()[0] or 0
    finally:
        conn.close()


# One definition of "what this paper earned", used by every table.
#
# Papers carry piQ in two states: `piq_minted` (released to a verified author)
# and `piq_escrowed` (earned but held, because authorship is unverified). Each
# table used to pick one of them, so the same paper read 8.33 in the history,
# 0.00 in the Top Papers board, and something else again in the journal — three
# numbers, all sourced honestly, none agreeing.
#
# TOTAL is what a table shows: earned is a fact about the work. Whether it has
# been released is a fact about an account, and travels alongside as `piq_held`
# so a reader can still tell the two apart.
#
# The total therefore includes escrowed piQ WHETHER OR NOT it has been claimed.
# It previously dropped the escrowed part the moment the author claimed it, so
# verifying your own authorship made your paper's piQ fall by exactly the
# amount you had just been credited, and the paper slid down — sometimes off —
# every board ranked on piQ. Claiming is a movement between two states of the
# same award; it does not un-earn anything. `piq_held` (unclaimed) and
# `piq_claimed` (released) split the escrow, and always sum back to it.
PIQ_TOTAL_SQL = "(COALESCE(piq_minted, 0) + COALESCE(piq_escrowed, 0))"
PIQ_SELECT = ("COALESCE(piq_minted, 0) AS piq_minted, "
              "CASE WHEN piq_claimed_at IS NULL THEN COALESCE(piq_escrowed, 0) ELSE 0 END "
              "AS piq_held, "
              f"{PIQ_TOTAL_SQL} AS piq")


def piq_fields(minted, escrowed, claimed_at) -> dict:
    """The figures every table reports, from the three stored columns.

    `piq` is stable across a claim; `piq_held` and `piq_claimed` are what move.
    """
    m = round(safe_float(minted, 0.0), 4)
    e = round(safe_float(escrowed, 0.0), 4)
    held = 0.0 if claimed_at else e
    return {"piq": round(m + e, 4), "piq_minted": m, "piq_held": held,
            "piq_claimed": round(e - held, 4)}


ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def is_tx_hash(tx) -> bool:
    """A real transaction hash, as opposed to a stored failure message.

    `tx_hash` is overloaded: on a successful mint it holds the hash, and on a
    skip it holds the REASON as plain text ("Eth Tx Skipped: no admin signing
    key configured"). Anything that is not 0x + 64 hex is therefore an
    explanation, not a settlement.
    """
    return bool(tx and isinstance(tx, str) and tx.startswith("0x") and len(tx) == 66)


def settlement_state(tx, wallet, minted) -> dict:
    """What the Settlement column should say, and why.

    Three states, because two were hiding a real distinction. A paper assessed
    for an author who never connected a wallet has nowhere to settle TO — it is
    finished, and "Local" is the whole truth. A paper with a wallet and minted
    piQ whose transaction never landed is a debt the deployment owes, and it
    was rendering identically to the first. An operator reading that column
    could not tell a healthy corpus from a stalled settlement queue.
    """
    if is_tx_hash(tx):
        return {"state": "on-chain", "label": "On-chain",
                "note": "Minted on the settlement chain. Opens the transaction."}

    has_wallet = bool(wallet) and str(wallet) not in ("", "None", ZERO_ADDRESS)
    if has_wallet and safe_float(minted, 0.0) > 0:
        # The stored text IS the reason it did not settle, so it is passed
        # through rather than replaced with a generic message.
        reason = str(tx or "").strip()
        generic = ("This assessment earned piQ against a connected wallet, but the mint has not "
                   "landed yet. It is queued and will be retried.")
        return {"state": "pending", "label": "Pending",
                "note": f"{generic} Last attempt: {reason[:160]}" if reason and reason != "Simulated_Ledger_Record"
                        else generic}

    return {"state": "local", "label": "Local",
            "note": ("Recorded in the Proof-of-Research ledger only. No wallet is attached to "
                     "this assessment, so there is nothing to settle on-chain — this is the "
                     "finished state for it, not a pending one.")}


def require_affordable(bal: dict, fee: float, what: str) -> None:
    """Refuse an action the caller cannot pay for, and say why in full.

    Three endpoints repeated this block verbatim — publishing, peer review and
    LLM review — differing only in the noun. Repetition here is worse than
    ordinary duplication: the message explains HELD piQ and how to release it,
    which is the single most confusing thing about the balance, so three copies
    meant three chances for that explanation to drift or be dropped.
    """
    if bal["balance"] + 1e-9 >= fee:
        return
    raise HTTPException(
        status_code=402,
        detail=(f"{what} costs {fee:.2f} piQ and your balance is {bal['balance']:.2f} piQ."
                + (f" You have {bal['held']:.2f} piQ held against papers whose authorship is"
                   f" not yet verified — claim those first and this becomes affordable."
                   if bal.get("held") else
                   " Have your own work assessed to earn piQ.")))


def resolve_active_fee() -> float:
    """Processing fee at the corpus's current difficulty epoch."""
    return compute_processing_fee(count_assessed_papers(), PIQ_PROCESSING_FEE)


def normalize_identity(wallet: Optional[str], orcid: Optional[str]):
    clean_wallet = w3.to_checksum_address(wallet) if wallet and w3.is_address(wallet) else ""
    return clean_wallet, (orcid or "").strip()


@app.get("/api/user/piq-total")
def user_piq_total(request: Request, wallet: Optional[str] = None,
                   orcid: Optional[str] = None):
    """Lifetime piQ awarded, plus the fee-adjusted spendable balance the
    assessment pipeline actually charges against.

    When a signed session exists it is the authority on WHICH accounts are
    yours, overriding the wallet/orcid parameters. Those parameters come from
    the browser's localStorage and can name an identity the session does not
    prove — so a user who had linked ORCID and later signed a wallet was shown
    the sum of both accounts here while every spending path charged against the
    session's narrower identity alone. The displayed balance and the spendable
    balance have to be the same number computed the same way, or the interface
    is lying about money.
    """
    claimed_wallet, claimed_orcid = normalize_identity(wallet, orcid)
    identity = auth.identity_from_request(request, wallet or "", orcid or "")
    # An identity the browser remembers but the session does not prove. Reported
    # so the interface can say "re-link ORCID to reach that piQ" instead of the
    # balance quietly dropping with no explanation.
    unproven = []
    if identity["verified"] and (identity["wallet"] or identity["orcid"]):
        if claimed_orcid and not identity["orcid"]:
            unproven.append("orcid")
        if claimed_wallet and not identity["wallet"]:
            unproven.append("wallet")
        wallet, orcid = identity["wallet"], identity["orcid"]
    clean_wallet, clean_orcid = normalize_identity(wallet, orcid)
    if not clean_wallet and not clean_orcid:
        return {
            "total_piq": 0.0, "minted": 0.0, "fees_paid": 0.0, "balance": 0.0,
            "fee_per_paper": resolve_active_fee(), "papers_affordable": 0,
        }
    # A verified ORCID earns a one-time onboarding stake, so the free tier is
    # an on-ramp rather than a wall for researchers without existing piQ.
    if clean_orcid and not has_received_grant(clean_wallet, clean_orcid):
        if award_onboarding_grant(NEW_PARTICIPANT_GRANT, clean_wallet, clean_orcid):
            add_log(f"Onboarding grant of {NEW_PARTICIPANT_GRANT} piQ issued to {clean_orcid}.")

    bal = get_piq_balance(clean_wallet, clean_orcid)
    # Rewards (arcade wins, bounties, grants, refunds) are ledger credits and
    # are NOT part of `minted`, which counts only piQ minted against an assessed
    # manuscript. Reported separately so the interface can show total piQ earned
    # rather than implying assessment is the only way to earn it.
    rewards = get_piq_rewards_total(clean_wallet, clean_orcid)
    fee = resolve_active_fee()
    return {
        "total_piq": bal["minted"],
        "held": bal.get("held", 0.0),
        "minted": bal["minted"],
        "rewards": rewards,
        "earned": round(bal["minted"] + rewards, 4),
        "fees_paid": bal["fees_paid"],
        "balance": bal["balance"],
        "fee_per_paper": fee,
        "papers_affordable": int(bal["balance"] // fee) if fee > 0 else 0,
        "unproven": unproven,
        "unproven_note": (
            f"This browser remembers {' and '.join(unproven)} that your current sign-in does "
            f"not prove, so any piQ held there is not counted or spendable. Re-link it to "
            f"bring it back." if unproven else ""),
    }


@app.get("/api/user/piq-ledger")
def user_piq_ledger(wallet: Optional[str] = None, orcid: Optional[str] = None):
    clean_wallet, clean_orcid = normalize_identity(wallet, orcid)
    if not clean_wallet and not clean_orcid:
        return {"entries": []}
    return {"entries": get_piq_fee_history(clean_wallet, clean_orcid)}


# ---------------------------------------------------------------------------
# 2b. CHAIN STATUS & DONATIONS
# ---------------------------------------------------------------------------
@app.get("/api/chain/contracts")
def chain_contracts():
    """The on-chain identities this ledger settles against.

    Surfaced so the explorer can show exactly which addresses a record refers
    to, rather than presenting hashes with no way to check where they landed.
    The admin address is derived from the signing key, never the key itself.
    """
    admin_address = None
    if ETH_ADMIN_PRIVATE_KEY:
        try:
            admin_address = w3.eth.account.from_key(ETH_ADMIN_PRIVATE_KEY).address
        except Exception:
            admin_address = None

    def entry(address, label, description, optional=False):
        """One row of the contracts panel, with the address actually validated.

        `configured` previously meant nothing more than "the environment
        variable is non-empty", so a truncated or mistyped address rendered as
        a normal, apparently-working entry with a live explorer link that
        resolves to nothing. Every code path that consumes these addresses
        checks the length and silently returns when it fails, so a typo
        disabled the feature with no message anywhere — the configuration
        looked correct and the feature simply did not happen.

        An address is now reported as valid only if web3 accepts it, and an
        address that is set but invalid says so explicitly. `optional` marks
        the entries a deployment can legitimately leave blank, so "not set" is
        not mistaken for "broken".
        """
        address = (address or "").strip()
        problem = None
        valid = False
        if address:
            try:
                w3.to_checksum_address(address)
                valid = True
            except Exception:
                problem = (
                    f"This is not a valid Ethereum address — it has "
                    f"{len(address.removeprefix('0x'))} hex characters where 40 are required. "
                    f"It is being ignored."
                )
        elif not optional:
            problem = "Not set."

        return {
            "label": label, "address": address or None, "description": description,
            "explorer_url": get_sepolia_explorer_url(address, "address") if valid else None,
            "configured": valid,
            "optional": optional,
            "problem": problem,
            "state": "ok" if valid else ("invalid" if address else "unset"),
        }

    return {
        "network": CHAIN_NAME, "chain_id": CHAIN_ID, "currency": CHAIN_CURRENCY,
        "explorer": BLOCK_EXPLORER_URL,
        "addresses": [
            entry(PIQ_CONTRACT_ADDRESS, "piQ token contract",
                  "Soulbound pi-Quotient token. Receives verifyProofAndMint calls when a "
                  "manuscript clears the minting threshold."),
            # The state registry row is deliberately absent. This deployment
            # has one contract — the piQ token — and a registry entry that is
            # permanently unconfigured is not information, it is a standing
            # invitation to paste the wrong address into it (which is what
            # happened). Encrypted backups are pinned to IPFS and the CID is
            # tracked locally; if a registry contract is deployed later, this
            # is where its row goes back.
            entry(admin_address, "Minting authority",
                  "Wallet that signs minting transactions. Derived from the configured signing "
                  "key; the key itself is never exposed."),
            entry(DONATION_WALLET, "Donation address",
                  "Receives Support & Donate contributions. Confers no piQ and no scoring "
                  "advantage."),
            entry(OWNER_ID, "Owner wallet",
                  "Administrative wallet permitted to re-score the corpus and reset local state."),
        ],
    }


@app.get("/api/backup/status")
def backup_status():
    """Whether durable off-host backup is actually happening.

    Worth surfacing because the failure mode is silent: pinning is best-effort
    and runs on a background thread, so a deployment can look completely
    healthy while storing nothing anywhere but its own ephemeral disk — which
    on a free-tier host is lost on redeploy.
    """
    backups = latest_backups(limit=5)
    configured = ledger_backup.ipfs_backup_available()
    registry = ledger_backup.registry_contract_usable()
    return {
        "configured": configured,
        "backups": backups,
        "last_backup": backups[0] if backups else None,
        "registry": registry,
        "anchoring_enabled": bool(registry.get("usable")),
        "note": (
            "Encrypted snapshots are pinned to IPFS. " + registry["reason"] + " The backup is "
            "durable and restorable either way; on-chain anchoring only adds tamper-evidence."
            if configured and not registry.get("usable") else
            "Encrypted snapshots are pinned to IPFS and their CIDs anchored on-chain."
            if configured else
            "Off-host backup is NOT configured. State exists only on this host's disk, which is "
            "not durable on an ephemeral filesystem. Set PINATA_API_KEY, PINATA_SECRET_API_KEY "
            "and BACKUP_ENCRYPTION_KEY to enable it."
        ),
    }


@app.post("/api/backup/run")
def backup_run(request: Request, wallet: str = Query(default="")):
    """Owner-triggered immediate backup, bypassing the throttle."""
    require_owner(request, wallet)
    result = ledger_backup.run_backup(force=True)
    add_log(f"Manual backup: {result}")
    return result


@app.get("/api/chain/status")
def chain_status():
    """Live Ethereum connectivity, so the UI can tell the user honestly
    whether on-chain minting is actually working right now."""
    status = get_chain_status()
    status["donation_wallet"] = DONATION_WALLET
    return status


@app.get("/api/donate/info")
def donate_info():
    """Where to send a real contribution.

    Reports the DONATION chain, not the ledger chain. The two differ on
    purpose: assessments are anchored on Sepolia because anchoring is free
    there, but SepoliaETH has no value, so soliciting donations on it asked
    people to fund inference credits with test tokens. Every field here is
    namespaced to donation_* so a future edit cannot quietly reconnect this
    endpoint to the settlement chain.
    """
    return {
        "wallet": DONATION_WALLET,
        "chain_id": DONATION_CHAIN_ID,
        "chain_id_hex": hex(DONATION_CHAIN_ID),
        "chain_name": DONATION_CHAIN_NAME,
        "currency": DONATION_CURRENCY,
        "rpc_urls": DONATION_RPC_URLS,
        "explorer_url": f"{DONATION_EXPLORER_URL.rstrip('/')}/address/{DONATION_WALLET}",
        "tx_explorer_base": f"{DONATION_EXPLORER_URL.rstrip('/')}/tx/",
        "is_mainnet": DONATION_CHAIN_ID == 1,
        # Sized for real ETH. The old ladder was denominated in a testnet token
        # that costs nothing, so "0.1" meant nothing; on mainnet it is a
        # meaningful sum and the suggestions have to reflect that.
        "suggested_amounts": ["0.001", "0.005", "0.01", "0.05"],
        "settlement_chain_note": (
            f"Assessments are anchored on {CHAIN_NAME} for provenance. Donations are separate "
            f"and settle on {DONATION_CHAIN_NAME} in {DONATION_CURRENCY}."
        ),
        "message": (
            "ScholarPi is independent, non-commercial research infrastructure. "
            "Contributions fund LLM inference credits, RPC access and hosting."
        ),
    }


# ---------------------------------------------------------------------------
# 3. INTAKE / ASSESSMENT PIPELINE  (streams NDJSON progress like the old
#    st.status(...) live box, then a final line with all results)
# ---------------------------------------------------------------------------
@app.get("/api/challenge")
def get_challenge(request: Request):
    """Issue a proof-of-work challenge for an anonymous submission."""
    ip = get_client_ip(request)
    payload = pow_challenge.issue_challenge(ip)
    payload["turnstile_site_key"] = TURNSTILE_SITE_KEY or None
    payload["required"] = REQUIRE_PROOF_OF_WORK
    return payload


@app.get("/api/providers/status")
def providers_status(request: Request, wallet: str = Query(default="")):
    """Operator view of which jurors can actually reach a model.

    Restricted to the owner wallet: it enumerates configured vendors, which is
    deployment information rather than something a researcher needs.
    """
    require_owner(request, wallet)
    return provider_configuration()


@app.get("/api/trial/status")
def trial_status(request: Request):
    """How much free allowance this visitor has left, and why."""
    ip = get_client_ip(request)
    used = get_free_evals_used(ip)
    # Fixed at FREE_DOCUMENTS. Arcade bonus is no longer added — a win pays piQ,
    # and reporting a grown trial alongside it described one reward twice.
    allowed = abuse_guard.FREE_DOCUMENTS
    return {
        "documents_allowed": allowed,
        "base_allowance": abuse_guard.FREE_DOCUMENTS,
        "bonus_allowance": 0,
        "documents_used": min(used, allowed),
        "remaining": max(0, allowed - used),
        "note": ("Metered per distinct manuscript. Re-assessing a paper you have already "
                 "submitted does not consume allowance."),
    }


# --------------------------------------------------------------------------
# Science Map arcade
#
# The reward is real allowance, so the server replays every submitted run
# rather than believing a reported score. See arcade.py for the reasoning.
# --------------------------------------------------------------------------
def require_owner(request: Request, wallet: str = "") -> dict:
    """Authorise an owner-only action against a PROVEN wallet.

    Every owner endpoint previously compared OWNER_ID to an unauthenticated
    query parameter — and OWNER_ID is published at /api/chain/status. Reading
    one public field was therefore sufficient to obtain provider diagnostics,
    other users' bug reports, backup control, corpus rescoring and SciLM (siM)
    reset. This requires a session token minted only after a valid EIP-191
    signature from that wallet.
    """
    identity = auth.identity_from_request(request, wallet)
    if auth.is_owner(identity):
        return identity
    if not auth.sessions_available():
        raise HTTPException(
            status_code=503,
            detail=("Owner actions are disabled: this deployment has no SESSION_SECRET or admin "
                    "key, so a session cannot be signed and ownership cannot be proven."),
        )
    raise HTTPException(
        status_code=403,
        detail=("Owner authorisation requires a signed session. Connect the owner wallet and "
                "sign the login message; passing the address alone is not proof of control."),
    )


def require_identity(request: Request, wallet: str = "", orcid: str = "") -> dict:
    """Authorise an action on a user's own data against a PROVEN identity."""
    identity = auth.identity_from_request(request, wallet, orcid)
    if identity["verified"] and (identity["wallet"] or identity["orcid"]):
        return identity
    if not auth.sessions_available():
        raise HTTPException(
            status_code=503,
            detail=("Identity-scoped features are disabled: this deployment cannot sign "
                    "sessions. Set SESSION_SECRET to enable them."),
        )
    raise HTTPException(
        status_code=401,
        detail=("Sign in to access your own records. Connect a wallet and sign the login "
                "message, or link ORCID."),
    )


def _profile_key(wallet: str = "", orcid: str = "") -> str:
    """One stable key per identity. ORCID wins when both are present, since it
    survives a wallet change and is the more durable research identity."""
    if orcid:
        return f"orcid:{orcid}"
    if wallet:
        return f"wallet:{wallet.lower()}"
    return ""


def _identity_values(wallet: str = "", orcid: str = "") -> list:
    """Every form this identity may appear as in `papers_assessment.user_id`.

    The assessment pipeline writes the RAW identifier (`user_id = orcid if
    orcid else wallet`), while profiles, arcade progress and bug reports use a
    namespaced `orcid:`/`wallet:` key. Anything that joins the two must accept
    both, or it silently matches nothing — which is exactly what made the
    assessment history appear empty for signed-in users.

    Wallet addresses are included in several casings because EIP-55 checksum
    casing is what a wallet reports, but a lowercase form is what a normalised
    key contains, and SQLite's `=` is case-sensitive for text.
    """
    values = []
    orcid = (orcid or "").strip()
    wallet = (wallet or "").strip()
    if orcid:
        values += [orcid, f"orcid:{orcid}"]
    if wallet:
        values += [wallet, wallet.lower(), f"wallet:{wallet.lower()}"]
    # Order-preserving dedupe.
    seen, out = set(), []
    for v in values:
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def _display_name(wallet: str = "", orcid: str = "") -> str:
    """A public label for a player that is not their full credential.

    A leaderboard is public. Printing a full wallet address or ORCID on it
    would publish a durable identifier next to a game score, which nobody
    signing in to assess a paper agreed to.
    """
    if orcid:
        return f"ORCID …{orcid[-4:]}" if len(orcid) > 4 else "ORCID researcher"
    if wallet and len(wallet) > 12:
        return f"{wallet[:6]}…{wallet[-4:]}"
    return ""


def _arcade_key(request: Request, wallet: str = "", orcid: str = ""):
    """Who this run belongs to, and whether that is a real identity.

    Difficulty must persist across refreshes, so it cannot live in the browser.
    A signed-in player is keyed to their identity; everyone else falls back to
    a hashed IP, which is enough to hold a ramp but is explicitly NOT treated
    as a person for leaderboard purposes.
    """
    key = _profile_key(wallet, orcid)
    if key:
        return key, True
    ip = get_client_ip(request)
    return "ip:" + hashlib.sha256(f"arcade:{ip}".encode()).hexdigest()[:32], False


@app.get("/api/arcade/start")
def arcade_start(request: Request, wallet: str = Query(default=""),
                 orcid: str = Query(default="")):
    """Issues a signed, seeded bubble field for one run."""
    ip = get_client_ip(request)
    # Snapshot the live corpus so the playfield reflects the real body of
    # assessed work. On a fresh database this is empty and the map falls back
    # to the default taxonomy — the game must be playable before paper one.
    try:
        corpus = get_field_corpus_stats(limit=arcade.OVERLAY_MAX_FIELDS)
    except Exception as e:
        logging.warning("Science Map corpus snapshot failed, using taxonomy only: %s", e)
        corpus = []
    try:
        totals = get_corpus_totals()
    except Exception as e:
        logging.warning("Corpus totals failed: %s", e)
        totals = {"papers": 0, "classified": 0, "unclassified": 0}
    player_key, is_identity = _arcade_key(request, wallet, orcid)
    progress = get_arcade_progress(player_key)
    session = arcade.start_session(ip, corpus_stats=corpus, corpus_totals=totals,
                                   level=progress["difficulty_level"])
    state = get_bonus_award_state(ip)
    session["wallet_state"] = {
        "bonus_earned": state["bonus"],
        "cap": arcade.BONUS_CAP,
        "cooldown_remaining": arcade.cooldown_remaining(state["last_award"]),
    }
    session["progress"] = {
        **progress,
        "is_identity": is_identity,
        # Said plainly rather than left for the player to infer from repeated
        # failure. An unwinnable field is a designed state, not a bug, and it
        # has an explicit way out.
        "reset_hint": (
            "This field can no longer be won at your current difficulty. Assess a manuscript "
            "to reset it to level 0."
            if not session["difficulty"]["winnable"] else
            "Each win raises the difficulty. Assessing a manuscript resets it."
        ),
    }
    return session


class ArcadeRun(BaseModel):
    token: str
    duration_ms: int
    absorbed: List[dict] = []
    wallet: str = ""
    orcid: str = ""


@app.get("/api/arcade/field-papers")
def arcade_field_papers(field: str = Query(default=""),
                        limit: int = Query(default=50, ge=1, le=200)):
    """The assessed papers inside one field of the Science Map.

    The map shows a field as a bubble whose size encodes how much work sits in
    it, but there was no way to get from the bubble to the work itself — the
    number was the whole answer. This is what makes a bubble openable: click a
    field, read what is actually in it.
    """
    name = (field or "").strip()
    if not name:
        return {"field": "", "papers": [], "count": 0}

    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT eval_hash, title, author_name, final_score, piq_minted,
                      fields, timestamp, doi, piq_escrowed, piq_claimed_at
               FROM papers_assessment
               WHERE final_score IS NOT NULL
               ORDER BY final_score DESC LIMIT 400""").fetchall()
    except sqlite3.Error:
        raise HTTPException(status_code=503, detail="The corpus could not be read.")
    finally:
        conn.close()

    # Matched in Python rather than with SQL LIKE: `fields` is a JSON array, so
    # a LIKE '%Physics%' would also match "Astrophysics" and "Physics
    # Education" — a bubble listing papers that belong to a different field is
    # worse than one that lists none.
    wanted = name.lower()
    out = []
    for r in rows:
        try:
            paper_fields = [f.strip() for f in json.loads(r[5] or "[]") if f and f.strip()]
        except (ValueError, TypeError):
            paper_fields = []
        if not any(f.lower() == wanted for f in paper_fields):
            continue
        out.append({
            "hash": r[0], "title": r[1] or "Untitled",
            "author": clean_author_name(r[2]), "score": round(safe_float(r[3], 0.0), 1),
            **piq_fields(r[4], r[8], r[9]), "date": (r[6] or "")[:10],
            # real_doi(): the column holds the string "None" for a paper with
            # no DOI, and shipping that renders a DOI chip that reads "None".
            "doi": real_doi(r[7]),
        })
        if len(out) >= limit:
            break

    return {"field": name, "papers": out, "count": len(out)}


@app.get("/api/arcade/leaderboard")
def arcade_leaderboard_endpoint(limit: int = Query(default=20, ge=1, le=100)):
    """Top Science Map players. Signed-in identities only."""
    return {"leaderboard": arcade_leaderboard(limit=limit),
            "note": ("Ranked by best run mass. Only signed-in players appear — an anonymous "
                     "player is keyed to a hashed IP, which is not a person and changes when "
                     "they reconnect.")}


@app.post("/api/arcade/finish")
def arcade_finish(payload: ArcadeRun, request: Request):
    """Verifies a completed run and grants allowance if it was a legitimate win."""
    ip = get_client_ip(request)
    # The reward is bounded by a cooldown and a lifetime cap, but the WORK was
    # not: every submission makes the server regenerate a 90-bubble field and
    # replay the run. Cheap once, a denial-of-service in a loop.
    check_rate_limit(ip, bucket="arcade")
    result = arcade.verify_run(ip, payload.token, payload.absorbed, payload.duration_ms)
    player_key, is_identity = _arcade_key(request, payload.wallet, payload.orcid)

    if not result["valid"]:
        logging.info("Arcade run rejected from %s: %s", ip, result.get("reason"))
        return {**result, "granted": 0, "bonus_total": get_bonus_evals(ip)}

    # Recorded before any reward logic. A run that was played happened,
    # whether or not it won and whether or not a cooldown blocks the payout —
    # and the difficulty ramp and the leaderboard both depend on that record.
    progress = record_arcade_run(
        player_key, won=result["won"], final_mass=result.get("final_mass", 0.0),
        is_identity=is_identity, display_name=_display_name(payload.wallet, payload.orcid),
        max_level=arcade.MAX_DIFFICULTY_LEVEL,
    )
    result["progress"] = progress

    if not result["won"]:
        return {**result, "granted": 0, "bonus_total": get_bonus_evals(ip),
                "message": (f"Run recorded at mass {result['final_mass']}. "
                            f"Reach {result['win_mass']} to earn free assessments.")}

    # No time cooldown: a win is rewarded when it happens. The lifetime cap and
    # the difficulty ramp are what bound the faucet.
    # A win pays in piQ, and only in piQ.
    #
    # It used to ALSO grant free assessments, so one reward was reported twice
    # in two different units — "+3 free assessments" beside "+1.00 piQ" — and a
    # player could not say what a win was worth. piQ is what buys an
    # assessment, so the piQ credit already is the free assessment; granting
    # both was paying twice for the same thing and describing it confusingly.
    #
    # `grant` is retained as a zeroed shape rather than removed, so the
    # response keeps its fields and any older client reading `granted` sees a
    # truthful zero instead of a missing key.
    grant = {"granted": 0, "bonus": get_bonus_evals(ip)}
    
    # --- piQ reward -------------------------------------------------------
    # Credited through refund_piq_fee (a plain positive ledger entry against the
    # same normalised account keys the balance is read from) rather than a
    # hand-written INSERT. The hand-written version wrote the raw identity while
    # every balance query reads normalised keys, and it swallowed its own
    # exception — so a failed credit looked identical to a successful one and
    # the win silently never reached the balance.
    piq_reward = 0.0
    credited = False
    balance_after = None

    # Credited to the PROVEN identity from the signed session, not to the
    # wallet/orcid the browser posted.
    #
    # Those two are not always the same set, and when they diverge the piQ
    # lands in an account the user cannot see or spend: the balance endpoint
    # scopes to the session, so a win credited against a localStorage-only
    # ORCID was written to the ledger and then rendered invisible. Crediting
    # and spending have to agree on who you are, and the signed token is the
    # only thing that actually knows.
    #
    # It also closes the obvious hole in taking the account name from the
    # request body: a win claim could otherwise nominate any ORCID it liked.
    identity = auth.identity_from_request(request, payload.wallet, payload.orcid)
    signed_in = bool(identity["verified"] and (identity["wallet"] or identity["orcid"]))
    fee_wallet, fee_orcid = ("", "")
    if signed_in:
        fee_wallet, fee_orcid = normalize_identity(identity["wallet"], identity["orcid"])

    if result["won"] and (fee_wallet or fee_orcid):
        piq_reward = arcade.PIQ_PER_WIN
        before = get_piq_balance(fee_wallet, fee_orcid)["balance"]
        refund_piq_fee(piq_reward, fee_wallet, fee_orcid,
                       eval_hash="", reason="Science Map Arcade victory")
        balance_after = get_piq_balance(fee_wallet, fee_orcid)["balance"]
        # Verified against the balance the user will actually see, not against
        # the fact that an INSERT did not raise.
        credited = balance_after > before + (piq_reward / 2)
        if credited:
            add_log(f"Arcade win credited {piq_reward:.2f} piQ to "
                    f"{_profile_key(fee_wallet, fee_orcid)} (balance now {balance_after:.2f}).")
        else:
            piq_reward = 0.0
            logging.warning("Arcade piQ credit did not land for %s/%s", fee_wallet, fee_orcid)

    if grant["granted"] == 0 and not credited:
        # Say which of the two reasons applies rather than blaming the cap for
        # a signed-out session, or vice versa.
        if not signed_in:
            why = ("Sign in with a wallet or ORCID — piQ for a win is credited to a signed-in "
                   "account, and this run was submitted without a proven session. If you are "
                   "signed in, re-link and play again.")
        else:
            why = ("The piQ credit did not go through. Nothing was taken from you — "
                   "play again, and please report it if it keeps happening.")
        return {**result, "granted": 0, "bonus_total": grant["bonus"],
                "piq_awarded": 0.0, "piq_balance": balance_after, "signed_in": signed_in,
                "message": "You won, but nothing could be credited for it. " + why}

    logging.info("Arcade win from %s credited %s piQ (difficulty now %s)",
                 ip, piq_reward, progress["difficulty_level"])

    earned = f"{piq_reward:.2f} piQ" if credited else "nothing"

    return {**result, "granted": grant["granted"], "bonus_total": grant["bonus"],
            "piq_awarded": piq_reward if credited else 0.0,
            "piq_balance": balance_after, "signed_in": signed_in,
            "message": (f"Victory! {earned} credited to your account."
                        + (f" Your piQ balance is now {balance_after:.2f}."
                           if credited and balance_after is not None else "")
                        + (" Sign in with a wallet or ORCID to earn piQ for wins too."
                           if not signed_in else "")
                        + f" Difficulty is now level {progress['difficulty_level']} — assess a "
                        f"manuscript to reset it.")}

def _visitor_key(ip: str) -> str:
    """A stable, non-reversible identifier for one visitor.

    Keyed with the session secret rather than a plain hash: a bare sha256 of an
    IPv4 address is trivially reversible by enumerating all four billion of
    them, so it would not actually be anonymous. With a secret key it is.
    """
    if not ip:
        return ""
    secret = (os.getenv("SESSION_SECRET") or "scholarpi-visits").encode()
    return hmac.new(secret, f"visit:{ip}".encode(), hashlib.sha256).hexdigest()[:32]


@app.post("/api/visit")
def register_visit(request: Request):
    """Count this visitor once. Called by the frontend on first load per session.

    Returns the current totals so the caller can render them without a second
    request.
    """
    record_visit(_visitor_key(get_client_ip(request)))
    return visitor_stats()


class RibFeedback(BaseModel):
    field: str = ""
    useful: bool = True
    features: List[float] = []
    wallet: str = ""
    orcid: str = ""


@app.post("/api/rib/feedback")
def rib_feedback(payload: RibFeedback, request: Request):
    """A researcher's verdict on one riB suggestion — riB's training signal.

    riB has no other way to learn. Its counts and means are measurements with
    no error to observe; whether a suggestion was worth making is only knowable
    from the person who received it.
    """
    identity = auth.identity_from_request(request, payload.wallet, payload.orcid)
    key = _profile_key(identity["wallet"], identity["orcid"]) if identity["verified"] else ""
    check_rate_limit(get_client_ip(request), bucket="review")

    candidate = {"field": payload.field, "_features": payload.features or None}
    summary = {"total_papers": 0, "mean_score": 0.0}
    try:
        result = rib_learning.observe_feedback(candidate, summary, payload.useful,
                                               account_key=key)
    except Exception as e:
        logging.warning("riB could not learn from feedback: %s", e)
        raise HTTPException(status_code=503, detail="Feedback could not be recorded.")
    return {"recorded": True, "learning": result,
            "message": ("Recorded. riB uses this to decide which suggestions to surface "
                        "first — it never adjusts the underlying counts.")}


@app.get("/api/engines/status")
def engines_status():
    """What each of the three engines has actually learned.

    Published rather than asserted: a claim that an engine improves over time
    is only meaningful if the improvement can be inspected, so each model
    reports its parameters, its observation count, and its error against its
    own frozen defaults. An engine that is not beating its defaults says so.
    """
    criteria_keys = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]
    out = {"budget_note": ("All three learners are NumPy linear models with a few dozen "
                           "parameters each. No PyTorch is imported on this path, which is "
                           "what keeps the process inside a 500 MB envelope.")}

    def normalise(raw: dict) -> dict:
        """One shape for all three engines.

        They were written separately and each grew its own vocabulary for the
        same three facts: siM says `baseline_mean_abs_error`, riB says
        `baseline_abs_error`, piD says `total_observations` and reports no
        error at all. A caller comparing them had to know each engine's
        private naming, so the comparison lived in the client and drifted.

        The engine-specific payload is preserved untouched under the same keys
        it always used; these four are added alongside as the common view.
        """
        if not isinstance(raw, dict) or raw.get("error"):
            return raw if isinstance(raw, dict) else {"error": "unavailable"}
        obs = raw.get("observations")
        if obs is None:
            obs = raw.get("total_observations", raw.get("logged_observations", 0))
        mine = raw.get("mean_abs_error")
        base = raw.get("baseline_abs_error", raw.get("baseline_mean_abs_error"))
        return {**raw,
                "observations": int(obs or 0),
                "mean_abs_error": mine,
                "baseline_abs_error": base,
                # `learning` means "measurably better than its own defaults".
                # Reported as False rather than omitted when unknown: an engine
                # that cannot show improvement should say so, not stay silent
                # and let the interface assume the best.
                "learning": bool(raw.get("learning", False))}

    for key, fn in (("piD", lambda: forecast_engine.engine_status(criteria_keys)),
                    ("riB", rib_learning.engine_status),
                    ("siM", scilem_learning.status)):
        try:
            out[key] = normalise(fn())
        except Exception as e:
            out[key] = {"error": str(e)}

    # Whether either engine is currently being bootstrapped by a model. Shown
    # rather than hidden: an engine whose numbers are partly model-taught is a
    # materially different claim from one taught entirely by the platform's own
    # data, and the panel should be able to say which it is looking at.
    for key, mod in (("riB", rib_learning), ("siM", scilem_learning)):
        try:
            if isinstance(out.get(key), dict) and hasattr(mod, "tutor_status"):
                out[key]["tutor"] = mod.tutor_status()
        except Exception:
            pass
    return out


@app.get("/api/stats/visitors")
def visitor_counts():
    """Public visitor totals."""
    return visitor_stats()


@app.get("/api/stats/count")
def stats_count():
    conn = get_db_connection()
    try:
        n = conn.execute("SELECT COUNT(*) FROM papers_assessment").fetchone()[0]
    finally:
        conn.close()
    return {"total_analyzed": n}




class ResearcherProfile(BaseModel):
    wallet: str = ""
    orcid: str = ""
    field: str = ""
    career_stage: str = ""
    goal: str = ""
    idea: str = ""
    abstract: str = ""


@app.get("/api/buddy")
def research_buddy(wallet: str = Query(default=""), orcid: str = Query(default=""),
                   hashes: str = Query(default=""),
                   background: BackgroundTasks = None):
    """riB — the researcher's stated fields against the live corpus.

    The analysis lives in rib_engine, which takes data and returns a report.
    This handler only fetches and hands over, so the engine can be tested
    without a database and its output is a pure function of its input.
    """
    key = _profile_key(wallet, orcid)
    if not key:
        return {"available": False, "reason": "Sign in to get tailored guidance."}

    profile = get_researcher_profile(key)
    try:
        corpus = get_field_corpus_stats(limit=60)
    except Exception as e:
        logging.warning("riB corpus read failed: %s", e)
        corpus = []

    # riB reads ONLY the papers the researcher has ticked.
    #
    # It previously fell back to the whole corpus when nothing was selected,
    # which meant its guidance was assembled from other people's work and
    # presented as though it were about yours. Reading nothing and saying so is
    # the honest version: an empty selection is not a request for advice about
    # everything, it is the absence of a request.
    selected = [h.strip() for h in (hashes or "").split(",") if h.strip()][:200]
    if not selected:
        return {
            "available": False,
            "needs_selection": True,
            "reason": ("Tick the papers you want the ResBD to read, under Your "
                       "assessments. It reasons only from the papers you choose, so it never "
                       "gives you advice assembled from someone else's work."),
            "profile": profile,
        }

    fields = rib_engine.parse_fields(profile)
    try:
        # The selection is the statement of scope, so the stated-fields filter
        # is not applied on top of it — that would silently drop papers the
        # researcher had just deliberately ticked.
        candidates = get_papers_for_recommendation(fields=None, hashes=selected)
        # The profile's fields are passed so riB can separate papers it cannot
        # judge against the reader's work from ones it can.
        picks = diagnostics.recommend_papers(candidates, user_fields=fields)
        picks["scope"] = f"{len(candidates)} selected paper{'' if len(candidates) == 1 else 's'}"
        picks["selection_active"] = True
        picks["selection_count"] = len(candidates)
    except Exception as e:
        logging.warning("riB recommendations failed: %s", e)
        picks = {"available": False, "reason": "Recommendations unavailable.",
                 "recommended": [], "caution": []}

    report = rib_engine.build_report(profile, corpus, picks)
    report["profile"] = profile

    # Teach the relevance ranker, AFTER the response has gone out.
    #
    # Tutoring calls a model, which is slow and can fail; the report the user
    # is waiting for must not depend on either. It is also self-limiting —
    # rib_engine.tutor_phase_active() returns False once real feedback is
    # sufficient or the daily cap is reached — so this becomes a no-op on a
    # deployment that has outgrown it, without anything here changing.
    try:
        if background is not None and rib_engine.tutor_phase_active():
            background.add_task(rib_engine.tutor_from_llm, candidates, profile, corpus)
        report["tutor"] = rib_engine.tutor_status()
    except Exception as e:                                   # noqa: BLE001
        logging.warning("riB tutoring could not be scheduled: %s", e)

    return report


@app.get("/api/profile")
def read_profile(wallet: str = Query(default=""), orcid: str = Query(default="")):
    """The stored researcher profile for this identity."""
    key = _profile_key(wallet, orcid)
    if not key:
        return {"stored": False, "profile": {},
                "reason": "Connect a wallet or link ORCID to save a profile."}
    profile = get_researcher_profile(key)
    return {"stored": bool(profile), "profile": profile}


@app.post("/api/profile")
def write_profile(payload: ResearcherProfile, request: Request):
    """Saves the researcher profile used to frame diagnostics."""
    check_rate_limit(get_client_ip(request), bucket="profile")
    key = _profile_key(payload.wallet, payload.orcid)
    if not key:
        raise HTTPException(
            status_code=400,
            detail="A wallet or ORCID is required to save a profile. Your draft is kept in "
                   "this browser until you connect one.")
    saved = save_researcher_profile(key, payload.dict())
    return {"stored": True, "profile": saved}


class ProfileSlotRequest(ResearcherProfile):
    """A named profile. Inherits the profile fields so the two forms cannot drift."""
    name: str = ""
    slot_id: Optional[int] = None


@app.get("/api/profiles")
def list_profiles(request: Request, wallet: str = Query(default=""),
                  orcid: str = Query(default="")):
    """Every named profile this identity has saved.

    A researcher working across two unrelated projects was previously forced
    to overwrite one description with the other, so the diagnostics framed
    every paper against whichever project they had described most recently.
    """
    key = _profile_key(wallet, orcid)
    if not key:
        return {"signed_in": False, "profiles": [], "max": MAX_PROFILE_SLOTS}
    return {"signed_in": True, "profiles": list_profile_slots(key),
            "max": MAX_PROFILE_SLOTS}


@app.post("/api/profiles")
def write_profile_slot(payload: ProfileSlotRequest, request: Request):
    """Create or update a named profile, and make it the active one."""
    check_rate_limit(get_client_ip(request), bucket="profile")
    key = _profile_key(payload.wallet, payload.orcid)
    if not key:
        raise HTTPException(
            status_code=400,
            detail="A wallet or ORCID is required to save a profile. Your draft is kept in "
                   "this browser until you connect one.")
    result = save_profile_slot(
        key, payload.dict(), name=payload.name, slot_id=payload.slot_id)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    return {"stored": True, "id": result["id"], "name": result["name"],
            "profiles": list_profile_slots(key)}


@app.post("/api/profiles/{slot_id}/activate")
def activate_profile(slot_id: int, payload: ResearcherProfile, request: Request):
    """Switch which profile frames diagnostics and the ResBD."""
    key = _profile_key(payload.wallet, payload.orcid)
    if not key:
        raise HTTPException(status_code=400, detail="Sign in to switch profiles.")
    result = activate_profile_slot(key, slot_id)
    if not result["ok"]:
        raise HTTPException(status_code=404, detail=result["reason"])
    return {"activated": True, "name": result["name"], "profile": result["profile"],
            "profiles": list_profile_slots(key)}


@app.delete("/api/profiles/{slot_id}")
def remove_profile_slot(slot_id: int, request: Request,
                        wallet: str = Query(default=""), orcid: str = Query(default="")):
    """Delete one named profile."""
    key = _profile_key(wallet, orcid)
    if not key:
        raise HTTPException(status_code=400, detail="Sign in to delete a profile.")
    result = delete_profile_slot(key, slot_id)
    if not result["ok"]:
        raise HTTPException(status_code=404, detail=result["reason"])
    return {"deleted": True, "profiles": list_profile_slots(key)}


@app.delete("/api/profile")
def reset_profile(request: Request, wallet: str = Query(default=""),
                  orcid: str = Query(default="")):
    """Delete the stored researcher profile for this identity.

    The row is removed rather than blanked. A profile whose fields are empty
    strings still exists, still frames the diagnostic summary, and still scopes
    the research buddy's recommendations — so a "reset" that left one behind
    would keep shaping results the user believed they had cleared.
    """
    check_rate_limit(get_client_ip(request), bucket="profile")
    key = _profile_key(wallet, orcid)
    if not key:
        raise HTTPException(
            status_code=400,
            detail="Connect a wallet or link ORCID to manage a stored profile.")
    removed = delete_researcher_profile(key)
    add_log(f"Researcher profile reset for {key[:16]}…")
    return {"reset": True, "had_profile": removed,
            "message": ("Profile cleared. Diagnostics will no longer be framed by it."
                        if removed else "There was no stored profile to clear.")}


# ---------------------------------------------------------------------------
# Assessment history and withdrawal
# ---------------------------------------------------------------------------
@app.get("/api/assessments/mine")
def my_assessments(request: Request, wallet: str = Query(default=""),
                   orcid: str = Query(default=""),
                   limit: int = Query(default=100, ge=1, le=300)):
    """Everything assessed under this identity.

    Anonymous visitors get an explicit empty result rather than an error: they
    genuinely have no history to show, because nothing durable is keyed to
    them, and saying so is more useful than a 400.
    """
    # Proven, not claimed. This returns a person's private assessment history;
    # accepting an unauthenticated ?orcid= made every user's record readable by
    # anyone who knew their ORCID, which is a published identifier.
    identity = auth.identity_from_request(request, wallet, orcid)
    key = _profile_key(identity["wallet"], identity["orcid"]) if identity["verified"] else ""
    if not key:
        return {"signed_in": False, "assessments": [], "count": 0,
                "reason": ("Sign in with a wallet or ORCID to keep a history of your "
                           "assessments. Anonymous runs are not linked to an identity.")}
    rows = list_assessments_for_identity(
        _identity_values(identity["wallet"], identity["orcid"]), limit=limit)

    # Annotated here rather than in the query: whether a file exists is a
    # filesystem fact, not a column, and the badge needs it to link to the
    # manuscript instead of falling back to the dossier.
    for r in rows:
        r["has_file"] = paper_store.has_paper(r.get("hash", ""))
    # Which identity this history was read under.
    #
    # Reported because an empty list has two very different causes — nothing
    # assessed, or assessed while a different identity was the proven one —
    # and the interface cannot tell them apart without knowing which key was
    # used. Stating the key is a fact; guessing that orphaned records exist
    # would not be, since a paper filed under an identity we cannot prove is
    # precisely a paper we cannot attribute to this user.
    return {"signed_in": True, "assessments": rows, "count": len(rows),
            "read_as": {"wallet": identity["wallet"], "orcid": identity["orcid"]}}


@app.get("/api/assessments/escrow")
def my_escrow(request: Request, wallet: str = Query(default=""),
              orcid: str = Query(default="")):
    """piQ this identity has earned but not yet been able to claim."""
    identity = auth.identity_from_request(request, wallet, orcid)
    if not identity["verified"]:
        return {"signed_in": False, "held": [], "total": 0.0}
    rows = list_escrowed_for_identity(_identity_values(identity["wallet"], identity["orcid"]))
    return {
        "signed_in": True,
        "held": rows,
        "total": round(sum(r["escrowed"] for r in rows), 4),
        "note": ("Held because authorship could not be linked to your identity. Claim a paper "
                 "once its DOI is registered against your ORCID, or once your ORCID profile "
                 "name matches the author line."),
    }


@app.get("/api/assessments/claimable")
def claimable_escrow(request: Request, wallet: str = Query(default=""),
                     orcid: str = Query(default="")):
    """piQ held against papers whose BYLINE matches this identity.

    Distinct from /api/assessments/escrow, which lists papers this identity
    SUBMITTED. That endpoint could never surface the case the escrow mostly
    exists for: a paper somebody else put through the pipeline, or one you
    assessed before linking an ORCID. Held piQ sat there unfindable, because
    the only view of it was filtered by the one fact that did not apply.

    This is a SHORTLIST, not a verdict. Matching is on the verified ORCID
    profile name against the extracted byline, which is cheap and offline;
    the real decision is still made by verify_authorship at claim time,
    against the registries. Saying "this may be yours" and then checking
    properly is the right order — the reverse would mean running a network
    verification against every held paper in the corpus to render a sidebar.
    """
    identity = auth.identity_from_request(request, wallet, orcid)
    if not identity["verified"] or not identity["orcid"]:
        # Without an ORCID there is no verified name to compare a byline
        # against, and a wallet address is not a person's name.
        return {"signed_in": bool(identity["verified"]), "candidates": [], "total": 0.0,
                "reason": ("Link an ORCID to see piQ that may be held for papers you authored. "
                           "A byline can only be matched against a verified profile name.")}

    try:
        profile_name = fetch_orcid_profile_name(identity["orcid"])
    except Exception as e:
        logging.debug("ORCID profile lookup failed during claimable scan: %s", e)
        profile_name = None
    if not profile_name:
        return {"signed_in": True, "candidates": [], "total": 0.0,
                "reason": "Your ORCID profile name could not be read, so no byline was compared."}

    # Papers this person has already said are not theirs stay out of the list.
    # Asking twice about the same paper turns a helpful prompt into nagging,
    # and re-suggesting something somebody explicitly declined reads as not
    # having listened.
    dismissed = list_disowned(_profile_key(identity["wallet"], identity["orcid"]))

    candidates = []
    for paper in list_unclaimed_escrow():
        if paper["hash"] in dismissed:
            continue
        authors = [a.strip() for a in (paper.get("author") or "").split(",") if a.strip()]
        for a in authors:
            if names_match(profile_name, a):
                candidates.append({**paper, "matched_author": a})
                break

    return {
        "signed_in": True,
        "candidates": candidates,
        "total": round(sum(c["escrowed"] for c in candidates), 4),
        "profile_name": profile_name,
        "note": ("Matched on your ORCID profile name against each paper's byline. Claiming "
                 "re-checks authorship against the publisher and ORCID registries, so a match "
                 "here is a candidate rather than a guarantee."),
    }


@app.post("/api/assessments/{file_hash}/disown")
def disown_paper(file_hash: str, request: Request, wallet: str = Query(default=""),
                 orcid: str = Query(default="")):
    """"Not mine." Stop suggesting this paper to this person.

    Nothing is forfeited. The piQ stays exactly where it was, still held and
    still claimable by whoever the author turns out to be — this records a
    person's answer to a question we asked them, and no more than that. A
    stronger reading would be wrong: someone declining a suggestion has not
    made a ruling about who the paper belongs to.
    """
    identity = require_identity(request, wallet, orcid)
    key = _profile_key(identity["wallet"], identity["orcid"])
    ok = disown_escrow(file_hash, key)
    return {"disowned": bool(ok),
            "message": ("Removed from your suggestions. The piQ stays held for this paper's "
                        "author — nothing was given up.")
                       if ok else "Could not record that. Please try again."}


@app.post("/api/assessments/{file_hash}/claim")
def claim_escrow(file_hash: str, request: Request, wallet: str = Query(default=""),
                 orcid: str = Query(default="")):
    """Re-run authorship verification and release the escrow if it now passes.

    Deliberately re-verifies rather than trusting the original result: the
    evidence changes over time. A preprint gets a DOI, a publisher deposits the
    ORCID, a researcher adds the work to their profile. The paper that could
    not be claimed in July may be claimable in September, and the claim should
    be decided on the evidence available when it is made.
    """
    identity = require_identity(request, wallet, orcid)
    check_rate_limit(get_client_ip(request), bucket="claim")

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT author_name, doi, piq_escrowed, piq_claimed_at, title "
            "FROM papers_assessment WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")
    if row[3]:
        return {"claimed": False, "message": "This paper's piQ has already been claimed."}
    if not row[2]:
        return {"claimed": False, "message": "Nothing is held for this paper."}

    attribution = verify_authorship(
        submitter_orcid=identity["orcid"],
        submitter_wallet=identity["wallet"],
        extracted_authors=row[0] or "",
        doi=row[1] or "",
        title=row[4] or "",
    )
    if not attribution.get("verified"):
        return {
            "claimed": False,
            "attribution": attribution,
            "message": attribution.get("reason", "Authorship still could not be verified."),
            "how_to_fix": attribution.get("how_to_verify"),
        }

    # verify_authorship has just passed for THIS paper and THIS identity, so
    # the claimant is an author of it. That is the whole authorisation; adding
    # "…and you must also have been the one who uploaded it" would refuse
    # precisely the authors this piQ is being held for.
    result = release_escrow(file_hash,
                            _identity_values(identity["wallet"], identity["orcid"]),
                            wallet=identity["wallet"], orcid=identity["orcid"],
                            authorship_proven=True)
    if not result["released"]:
        return {"claimed": False, "message": result["reason"]}

    add_log(f"Escrow released: {result['released']:.4f} piQ for {file_hash[:12]}… "
            f"(tier {attribution.get('tier')})")
    return {
        "claimed": True, "amount": result["released"],
        "tier": attribution.get("tier"),
        "message": (f"{result['released']:.4f} piQ released. Authorship confirmed via "
                    f"{attribution.get('tier')}."),
    }


class ChallengeStart(BaseModel):
    # An INDEX into the addresses found in the manuscript — never an address.
    # Accepting an address here would reduce the whole mechanism to "type one
    # you control", which is precisely the fraud it exists to prevent.
    email_index: int = 0
    wallet: str = ""
    orcid: str = ""


class ChallengeConfirm(BaseModel):
    code: str
    wallet: str = ""
    orcid: str = ""


@app.get("/api/assessments/{file_hash}/challenge")
def challenge_options(file_hash: str, request: Request, wallet: str = Query(default=""),
                      orcid: str = Query(default="")):
    """Which addresses in the manuscript a code could be sent to.

    Masked. This endpoint is reachable by anyone who can submit a paper, so
    returning author emails in full would turn the feature into a scraper for
    exactly the addresses researchers most want protected.
    """
    identity = require_identity(request, wallet, orcid)
    conn = get_db_connection()
    try:
        row = conn.execute("SELECT contact_emails, piq_escrowed, piq_claimed_at "
                           "FROM papers_assessment WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")
    try:
        emails = json.loads(row[0] or "[]")
    except (ValueError, TypeError):
        emails = []

    existing = get_challenge(file_hash, _profile_key(identity["wallet"], identity["orcid"]))
    return {
        "options": [{"index": i, "masked": authorship_challenge.mask_email(e)}
                    for i, e in enumerate(emails)],
        "escrowed": round(float(row[1] or 0), 4),
        "already_claimed": bool(row[2]),
        "pending": bool(existing and not existing.get("verified_at")),
        "note": ("A code is sent to an address printed in the manuscript. Addresses cannot be "
                 "supplied here — that is what makes controlling the mailbox meaningful."
                 if emails else
                 "No contact address could be found in this manuscript, so this route is "
                 "unavailable. Register the DOI against your ORCID instead."),
    }


@app.post("/api/assessments/{file_hash}/challenge")
def challenge_start(file_hash: str, payload: ChallengeStart, request: Request):
    """Send a one-time code to a manuscript-listed address."""
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="challenge")
    key = _profile_key(identity["wallet"], identity["orcid"])

    conn = get_db_connection()
    try:
        row = conn.execute("SELECT contact_emails, title, piq_escrowed, piq_claimed_at "
                           "FROM papers_assessment WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")
    if row[3]:
        return {"sent": False, "message": "This paper's piQ has already been claimed."}
    try:
        emails = json.loads(row[0] or "[]")
    except (ValueError, TypeError):
        emails = []
    if not emails:
        return {"sent": False, "message": "No contact address was found in this manuscript."}
    if not (0 <= payload.email_index < len(emails)):
        raise HTTPException(status_code=400, detail="That is not one of the manuscript's addresses.")

    address = emails[payload.email_index]
    code = authorship_challenge.generate_code()
    secret = os.getenv("SESSION_SECRET", "") or ETH_ADMIN_PRIVATE_KEY
    store_challenge(
        file_hash, key,
        authorship_challenge.mask_email(address),
        hashlib.sha256(address.lower().encode()).hexdigest(),
        authorship_challenge.hash_code(code, file_hash, secret),
    )
    result = authorship_challenge.send_challenge(address, code, row[1] or "this manuscript")
    add_log(f"Authorship challenge for {file_hash[:12]}… -> "
            f"{authorship_challenge.mask_email(address)} (sent={result['sent']})")
    if not result["sent"]:
        return {"sent": False,
                "message": ("The code could not be sent. Email is not configured on this "
                            "deployment, so this route is unavailable.")}
    return {
        "sent": True,
        "masked": authorship_challenge.mask_email(address),
        "expires_in_minutes": authorship_challenge.CODE_TTL_MINUTES,
        "message": (f"A confirmation code was sent to "
                    f"{authorship_challenge.mask_email(address)}. It expires in "
                    f"{authorship_challenge.CODE_TTL_MINUTES} minutes."),
    }


@app.post("/api/assessments/{file_hash}/challenge/confirm")
def challenge_confirm(file_hash: str, payload: ChallengeConfirm, request: Request):
    """Confirm the code and release the escrow."""
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="challenge")
    key = _profile_key(identity["wallet"], identity["orcid"])

    challenge = get_challenge(file_hash, key)
    if not challenge:
        return {"claimed": False, "message": "No code has been requested for this paper."}
    if challenge.get("verified_at"):
        return {"claimed": False, "message": "This challenge was already used."}
    if challenge["attempts"] >= authorship_challenge.MAX_ATTEMPTS:
        return {"claimed": False,
                "message": ("Too many incorrect attempts. Request a new code — the previous one "
                            "is no longer valid.")}
    if authorship_challenge.is_expired(challenge["created_at"]):
        return {"claimed": False, "message": "That code has expired. Request a new one."}

    secret = os.getenv("SESSION_SECRET", "") or ETH_ADMIN_PRIVATE_KEY
    supplied = authorship_challenge.hash_code(
        (payload.code or "").strip(), file_hash, secret)
    # compare_digest: a code must not be recoverable from response timing.
    if not hmac.compare_digest(supplied, challenge["code_hash"]):
        record_challenge_attempt(challenge["id"], verified=False)
        remaining = authorship_challenge.MAX_ATTEMPTS - challenge["attempts"] - 1
        return {"claimed": False,
                "message": f"That code is not correct. {max(0, remaining)} attempt(s) remaining."}

    record_challenge_attempt(challenge["id"], verified=True)
    result = release_escrow(file_hash, _identity_values(identity["wallet"], identity["orcid"]),
                            wallet=identity["wallet"], orcid=identity["orcid"])
    if not result["released"]:
        return {"claimed": False, "message": result["reason"]}
    add_log(f"Escrow released by email challenge: {result['released']:.4f} piQ for {file_hash[:12]}…")
    return {"claimed": True, "amount": result["released"], "tier": "corresponding-author-email",
            "message": (f"{result['released']:.4f} piQ released. You confirmed control of an "
                        f"address printed in the manuscript.")}


class PublishRequest(BaseModel):
    published: bool = True
    kind: str = "author"            # "author" | "journal"
    doi: str = ""                   # required for a journal claim
    wallet: str = ""
    orcid: str = ""
    # Publishing makes the stored manuscript publicly downloadable. The platform
    # cannot know whether the uploader holds redistribution rights — a typeset
    # version of record usually belongs to the publisher, not the author — so
    # the claim is made explicitly by the person who does know, and recorded.
    distribute_file: bool = False


@app.get("/api/assessments/{file_hash}/publish")
def publish_status(file_hash: str, request: Request, wallet: str = Query(default=""),
                   orcid: str = Query(default="")):
    """Whether this identity may publish this paper, and what it would cost."""
    identity = auth.identity_from_request(request, wallet, orcid)
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT author_name, doi, title, published_at, published_by, piq_claimed_at, "
            "final_score FROM papers_assessment WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")

    already_paid = publication_fee_paid(
        file_hash, _identity_values(identity["wallet"], identity["orcid"]))
    fee = publication_fee(safe_float(row[6], 0.0))
    published = bool(row[3])

    if not identity["verified"]:
        return {"published": published, "may_publish": False, "fee": fee,
                "reason": "Sign in to publish an assessment."}

    # Authorship must already be established. Publishing attaches a name to a
    # public record, so it requires the same proof as claiming the piQ — the
    # weaker "I typed this name" is exactly what the badge must not certify.
    attribution = verify_authorship(
        submitter_orcid=identity["orcid"], submitter_wallet=identity["wallet"],
        extracted_authors=row[0] or "", doi=row[1] or "", title=row[2] or "")
    verified = bool(attribution.get("verified")) or bool(row[5])

    # Review before publication. Reported here so the form can say why the
    # button is off, rather than letting someone fill it in and be refused.
    reviewed = has_human_review(file_hash)
    owner_override = bool(auth.is_owner(identity))

    return {
        "published": published,
        "published_at": row[3],
        "may_publish": verified and (reviewed or owner_override),
        "owner_override": owner_override and not reviewed,
        "authorship_ok": verified,
        "reviewed": reviewed,
        "review_requested": has_open_review_request(file_hash),
        "review_blocked_reason": ("" if (reviewed or owner_override) else
            ("This paper has not been peer reviewed. A paper must be reviewed before it can be "
             "published — request a review from this dossier, and publish once a reviewer has "
             "submitted their report.")),
        # Journal claims need both factors and a DOI that survives verification,
        # so the form can disable that option up front instead of letting a user
        # fill it in and be refused.
        "may_claim_journal": bool(identity["wallet"] and identity["orcid"]),
        # Whether publishing would expose a stored file, so the form can ask
        # for the redistribution attestation only when there is one to make.
        "has_file": paper_store.has_paper(file_hash),
        "journal_blocked_reason": (
            "" if (identity["wallet"] and identity["orcid"]) else
            ("A journal claim needs both a signed wallet and a linked ORCID. You have "
             + ("only an ORCID — connect and sign a wallet to enable it."
                if identity["orcid"] else
                "only a wallet — link your ORCID to enable it."))),
        "authorship_tier": attribution.get("tier") if attribution.get("verified") else (
            "escrow-claimed" if row[5] else "unverified"),
        "fee": fee,
        "fee_already_paid": already_paid,
        "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
        "held": get_piq_balance(identity["wallet"], identity["orcid"]).get("held", 0.0),
        # Two independent gates, reported separately. Collapsing them into one
        # message would tell a verified author whose paper is unreviewed that
        # their authorship is the problem, which it is not.
        "reason": ("" if verified else
                   (attribution.get("reason") or "Authorship is not verified for this paper.")),
        "how_to_fix": None if verified else attribution.get("how_to_verify"),
    }


@app.post("/api/assessments/{file_hash}/publish")
def publish_assessment(file_hash: str, payload: PublishRequest, request: Request):
    """Attach or withdraw an author's public endorsement of an assessment.

    "Published" here means the verified author has chosen to stand behind this
    assessment publicly. It is deliberately NOT a claim of journal publication,
    and the badge says "Author-published" so the two cannot be conflated — on a
    research platform, an unqualified "Published" badge would be read as peer
    review, which this is not.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="publish")
    key = _profile_key(identity["wallet"], identity["orcid"])
    identities = _identity_values(identity["wallet"], identity["orcid"])

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT author_name, doi, title, piq_claimed_at, final_score "
            "FROM papers_assessment WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")

    # Withdrawal never requires re-proving authorship or paying anything. An
    # endorsement that cannot be retracted is a trap, not an endorsement.
    if not payload.published:
        result = set_published(file_hash, identities, key, False)
        if not result["ok"]:
            raise HTTPException(status_code=403, detail=result["reason"])
        add_log(f"Assessment {file_hash[:12]}… withdrawn from publication.")
        return {"published": False,
                "message": ("Withdrawn. The badge is removed; the assessment and its ledger "
                            "block are unchanged. Re-publishing is free.")}

    kind = (payload.kind or "author").strip().lower()
    if kind not in ("author", "journal"):
        raise HTTPException(status_code=400, detail="Publication kind must be author or journal.")

    # Review comes before publication. Checked before the fee is taken, before
    # authorship is verified, and again inside set_published — this is the
    # ordering rule the journal rests on, and a rule enforced in one place is a
    # rule with one bug away from not existing. A machine review does not
    # satisfy it: has_human_review excludes the panel deliberately.
    # The operator may publish unreviewed work on the deployment they run.
    # Without this the platform cannot start: the first paper needs a review,
    # a review needs a peer, and the first participant has none. The paper
    # still gets no Peer-reviewed badge — the override skips the gate, it does
    # not manufacture a review — so a reader can always see the difference.
    owner_override = bool(auth.is_owner(identity))
    if not owner_override and not has_human_review(file_hash):
        raise HTTPException(
            status_code=409,
            detail=("This paper has not been peer reviewed, and a paper must be reviewed before "
                    "it can be published. Request a review from the dossier; once a reviewer has "
                    "submitted their report the paper carries a Peer-reviewed badge and "
                    "publishing becomes available. No piQ has been charged."
                    + (" A review has already been requested and is waiting for a reviewer."
                       if has_open_review_request(file_hash) else "")))

    # Publication requires a readable manuscript, and permission to show it.
    #
    # Both conditions are mandatory, for the same reason: a badge that asserts
    # "published" while the paper behind it cannot be opened is a claim a reader
    # has no way to check, which is precisely what this platform argues against.
    # Every published assessment therefore has a file, and every file is public
    # because its author said it could be.
    if not paper_store.has_paper(file_hash):
        raise HTTPException(
            status_code=409,
            detail=("Publishing needs the manuscript file, and none is stored for this "
                    "assessment. Papers assessed before file retention, and papers submitted by "
                    "DOI rather than upload, have no stored file — re-run the assessment with "
                    "the PDF uploaded and you can publish it."))
    if not payload.distribute_file:
        raise HTTPException(
            status_code=400,
            detail=("Publishing makes the uploaded manuscript publicly readable. Confirm you hold "
                    "the right to distribute this file — for a journal article that is often the "
                    "accepted manuscript rather than the publisher's typeset version."))

    attribution = verify_authorship(
        submitter_orcid=identity["orcid"], submitter_wallet=identity["wallet"],
        extracted_authors=row[0] or "", doi=row[1] or "", title=row[2] or "")

    # An author-published badge accepts the escrow-claim as standing evidence of
    # authorship. A journal claim does not: claiming escrow proves you satisfied
    # the minting check at some point in the past, which says nothing about
    # whether a particular DOI is yours.
    escrow_ok = bool(row[3]) and kind != "journal"
    if not (attribution.get("verified") or escrow_ok):
        raise HTTPException(
            status_code=403,
            detail=(attribution.get("reason") or "Authorship is not verified for this paper.")
                   + (" " + attribution["how_to_verify"] if attribution.get("how_to_verify") else ""))

    journal_check = None
    if kind == "journal":
        # The strongest badge on the platform, so it carries the strongest
        # identity requirement — both a signed wallet and a linked ORCID, the
        # same bar as commissioning a review. One factor was enough to mint a
        # permanent public claim about a journal that never made it.
        if not (identity["wallet"] and identity["orcid"]):
            missing = "a signed wallet" if not identity["wallet"] else "a linked ORCID"
            raise HTTPException(
                status_code=403,
                detail=(f"A journal claim needs both a signed wallet and a linked ORCID; you are "
                        f"missing {missing}. The wallet proves control of the account making the "
                        f"claim, the ORCID ties it to a research identity the registry can be "
                        f"checked against. Author-publishing needs only one and is available now."))

        # Bounded, because this is the one publish path that goes to the
        # internet. It resolves the DOI in Crossref, falls back to OpenAlex,
        # then reads the claimant's ORCID profile — each with its own retries.
        # On a host that cannot reach those registries the calls do not fail
        # fast, they fail slowly, and the button sits on "Publishing…" for a
        # minute or more with nothing to show for it. A refusal a user can act
        # on beats an indefinite wait.
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            fut = pool.submit(
                verify_journal_claim,
                doi=(payload.doi or row[1] or ""), orcid=identity["orcid"],
                assessed_title=row[2] or "", assessed_authors=row[0] or "")
            journal_check = fut.result(timeout=JOURNAL_CHECK_BUDGET_SECONDS)
        except concurrent.futures.TimeoutError:
            add_log(f"Journal claim on {file_hash[:12]}… timed out verifying the DOI.")
            raise HTTPException(
                status_code=504,
                detail=(f"The DOI could not be checked within "
                        f"{JOURNAL_CHECK_BUDGET_SECONDS}s — Crossref and OpenAlex are not "
                        f"answering from this server. Nothing was published and nothing was "
                        f"charged. Author-publish now if you want the paper visible, and "
                        f"switch to a journal claim once the registries are reachable."))
        finally:
            pool.shutdown(wait=False)
        if not journal_check["ok"]:
            add_log(f"Journal claim REFUSED on {file_hash[:12]}… — {journal_check['reason'][:120]}")
            raise HTTPException(
                status_code=422,
                detail=journal_check["reason"]
                       + (" " + journal_check["how_to_fix"] if journal_check["how_to_fix"] else ""))

    fee = publication_fee(safe_float(row[4], 0.0))["fee"]
    if fee > 0 and not publication_fee_paid(file_hash, identities):
        bal = get_piq_balance(identity["wallet"], identity["orcid"])
        require_affordable(bal, fee, "Publishing")
        if not charge_piq_fee(fee, identity["wallet"], identity["orcid"],
                              eval_hash=file_hash, reason="Publication fee"):
            raise HTTPException(status_code=402, detail="The publication fee could not be charged.")

    result = set_published(file_hash, identities, key, True, kind=kind,
                           allow_unreviewed=owner_override)
    if owner_override and not has_human_review(file_hash):
        add_log(f"Owner published {file_hash[:12]}… WITHOUT a peer review "
                f"(operator override; no Peer-reviewed badge attached).")
    if not result["ok"]:
        raise HTTPException(status_code=403, detail=result["reason"])

    # Record the DOI the claim was actually verified against. Without this the
    # badge would be backed by whatever DOI happened to be on the row, which
    # need not be the one that passed the check.
    if kind == "journal" and journal_check:
        verified_doi = (payload.doi or row[1] or "").replace("https://doi.org/", "").strip()
        conn = get_db_connection()
        try:
            conn.execute("UPDATE papers_assessment SET doi = ? WHERE eval_hash = ?",
                         (verified_doi, file_hash))
            conn.commit()
        except sqlite3.Error as e:
            logging.warning("Could not store verified DOI for %s: %s", file_hash[:12], e)
        finally:
            conn.close()

    tier = (journal_check or {}).get("tier") or attribution.get("tier") or "escrow-claimed"
    add_log(f"Assessment {file_hash[:12]}… published ({kind}) by {key[:16]}… (tier {tier})")

    if kind == "journal":
        reg = (journal_check or {}).get("registry", {})
        msg = (f"Published. This assessment now carries a Journal-published badge. The DOI "
               f"resolves in {reg.get('basis') or 'a registry'}, the registered title matches "
               f"this manuscript, and you are confirmed as an author "
               f"({'deposited ORCID' if tier == 'registry-orcid' else 'deposited author name'}).")
    else:
        msg = ("Published. Your assessment now carries an Author-published badge wherever it "
               "appears. This is your own endorsement, not a claim of journal publication.")

    return {
        "published": True,
        "charged": 0.0 if publication_fee_paid(file_hash, identities) and False else fee,
        "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
        "kind": kind,
        "verification": journal_check.get("registry") if journal_check else None,
        "tier": tier,
        "message": msg + " You can withdraw it at any time, free of charge.",
    }


@app.get("/api/papers/{file_hash}/file")
def serve_paper_file(file_hash: str, request: Request,
                     wallet: str = Query(default=""), orcid: str = Query(default="")):
    """The manuscript a published assessment is an assessment of.

    Two ways to be allowed to read it, and no third:

      * the assessment is PUBLISHED — its author chose to make it public and
        attested they hold the right to distribute it; or
      * you are the author, reading your own unpublished upload.

    Retention is not publication. A file sitting in the store because someone
    once ran an assessment is nobody's business but theirs until they publish
    it, so an unpublished paper is 404 to everyone else — not 403, which would
    confirm the paper exists to someone who should not know that.
    """
    path = paper_store.paper_path(file_hash)

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT published_at, title, user_id FROM papers_assessment WHERE eval_hash = ?",
            (file_hash,)).fetchone()
    except sqlite3.Error:
        row = None
    finally:
        conn.close()

    if not row or not path:
        raise HTTPException(
            status_code=404,
            detail=("No manuscript file is stored for this assessment. Papers assessed before "
                    "file retention was enabled, and papers submitted by DOI rather than upload, "
                    "have no stored file — the DOI resolves to the published version instead."))

    if not row[0]:
        identity = auth.identity_from_request(request, wallet, orcid)
        owns = bool(identity["verified"]
                    and row[2]
                    and row[2] in _identity_values(identity["wallet"], identity["orcid"]))
        if not owns:
            raise HTTPException(
                status_code=404,
                detail="No public manuscript file is available for this assessment.")

    # HTTP header values are latin-1. `\w` in the pattern below matches Unicode
    # letters, so a title containing π — or an accent, or any non-Western
    # script — survived this filter and then blew up on the way out as
    #   UnicodeEncodeError: 'latin-1' codec can't encode character '\u03c0'
    # which surfaced as a 500 on a paper that was perfectly fine. The paper this
    # framework is named after cannot be the one paper it fails to serve.
    #
    # RFC 6266/5987 exists precisely for this: `filename` carries an ASCII
    # fallback for old clients, `filename*` carries the real UTF-8 name
    # percent-encoded. Every current browser prefers the second.
    raw_title = (row[1] or "manuscript")[:80].strip() or "manuscript"
    ascii_title = re.sub(r"[^A-Za-z0-9 \-.]", "", raw_title).strip() or "manuscript"
    utf8_title = urllib.parse.quote(re.sub(r'[\\"\r\n]', "", raw_title), safe="")
    return FileResponse(
        path, media_type="application/pdf",
        # inline: a reader clicking a badge wants to read the paper, not to
        # find it in their downloads folder.
        headers={"Content-Disposition":
                 f'inline; filename="{ascii_title}.pdf"; '
                 f"filename*=UTF-8''{utf8_title}.pdf"})


class ReviewRequest(BaseModel):
    wallet: str = ""
    orcid: str = ""
    # What the author is willing to set aside for whoever reviews the paper.
    # None means "use the minimum" — the field is optional so an older client,
    # or a request that simply does not care, keeps working unchanged.
    bounty: Optional[float] = None


class ReviewSubmission(BaseModel):
    # Either an open request to fulfil, or a paper to review unprompted.
    # `review_id = 0` with an `eval_hash` is the second case: a paper that has
    # already been reviewed, or already published, can still be reviewed again
    # by someone else.
    review_id: int = 0
    eval_hash: str = ""
    verdict: str = "sound"          # sound | concerns | unsound
    comment: str = ""
    wallet: str = ""
    orcid: str = ""


@app.get("/api/journal")
def journal(limit: int = Query(default=100, ge=1, le=300),
            kind: str = Query(default="all")):   # all | published | reviewed
    """The Journal: papers their authors published, or that carry a review.

    Two distinct claims live here and are never merged into one column. A paper
    can be published without review, reviewed without publication, or both, and
    collapsing them would let the weaker claim borrow the stronger one's
    credibility — which is the failure this whole framework argues against.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT p.eval_hash, p.title, p.author_name, p.final_score, p.piq_minted,
                      p.piq_escrowed, p.piq_claimed_at,
                      p.doi, p.published_at, p.publish_kind, p.fields, p.timestamp,
                      (SELECT COUNT(*) FROM peer_reviews r
                        WHERE r.eval_hash = p.eval_hash AND r.completed_at IS NOT NULL
                          AND r.reviewer_key <> 'llm:panel') AS peer_count,
                      (SELECT COUNT(*) FROM peer_reviews r
                        WHERE r.eval_hash = p.eval_hash AND r.completed_at IS NOT NULL
                          AND r.reviewer_key = 'llm:panel') AS llm_count,
                      COALESCE(p.reads, 0) AS reads,
                      (SELECT COUNT(*) FROM peer_reviews r
                        WHERE r.eval_hash = p.eval_hash AND r.completed_at IS NULL) AS requested,
                      -- What a reviewer would earn for picking up the open
                      -- request. Carried here so the badge can name the reward
                      -- instead of making the reviewer open the dossier to
                      -- find out whether it is worth their afternoon.
                      (SELECT COALESCE(MAX(r.bounty), 0) FROM peer_reviews r
                        WHERE r.eval_hash = p.eval_hash AND r.completed_at IS NULL) AS open_bounty
               FROM papers_assessment p
               ORDER BY COALESCE(p.published_at, p.timestamp) DESC"""
        ).fetchall()
    except sqlite3.Error as e:
        add_log(f"Journal read failed: {e}")
        raise HTTPException(status_code=503, detail="The journal index is unavailable.")
    finally:
        conn.close()

    # Column order after adding the two piQ columns:
    #  0 hash  1 title  2 author  3 score  4 minted  5 escrowed  6 claimed_at
    #  7 doi   8 published_at  9 publish_kind  10 fields  11 timestamp
    # 12 peer  13 llm  14 reads  15 requested  16 open_bounty
    out = []
    for r in rows:
        published, peer, llm = bool(r[8]), int(r[12] or 0), int(r[13] or 0)
        requested = int(r[15] or 0)
        # A paper awaiting a reviewer belongs here too. It is the one state the
        # index used to hide, and it is the state where being visible actually
        # does something — a reviewer cannot pick up a request they cannot see.
        if not (published or peer or llm or requested):
            continue          # the Journal lists claims, not the whole corpus
        if kind == "published" and not published:
            continue
        if kind == "reviewed" and not (peer or llm):
            continue
        if kind == "requested" and not requested:
            continue
        try:
            fields = json.loads(r[10] or "[]")
        except (ValueError, TypeError):
            fields = []
        out.append({
            "hash": r[0], "title": r[1] or "Untitled",
            "author": clean_author_name(r[2]), "score": round(safe_float(r[3], 0.0), 1),
            **piq_fields(r[4], r[5], r[6]),
            # real_doi(): the column holds the string "None" for a paper with
            # no DOI, and shipping that renders a DOI chip that reads "None".
            "doi": real_doi(r[7]),
            "published": published, "publish_kind": (r[9] or "author") if published else None,
            "published_at": r[8], "peer_reviews": peer, "llm_reviewed": bool(llm),
            "review_requested": requested > 0,
            # The reward on the open request, so the badge can advertise it.
            # A published, already-reviewed paper can still be carrying one.
            "review_bounty": round(safe_float(r[16], 0.0), 2) if requested else 0.0,
            "reads": int(r[14] or 0),
            "fields": fields, "assessed_at": r[11],
            # Lets the badge link straight to the manuscript. Without it every
            # row fell back to the DOI or the dossier, so a published paper
            # with a stored file still did not open that file.
            "has_file": paper_store.has_paper(r[0]),
        })
        if len(out) >= limit:
            break

    return {
        "entries": out, "count": len(out),
        "note": ("Peer-reviewed means an independent researcher submitted a reasoned verdict; "
                 "LLM-reviewed means a model panel did. Published means the reviewed paper's "
                 "verified author then attached their name — review comes first, and nothing "
                 "here can be published without one. Journal-published additionally required a "
                 "DOI that resolves in a registry. Requested means a review has been "
                 "commissioned and is waiting for a reviewer; it is not a review, and it can "
                 "sit alongside the other badges — an already-reviewed or published paper can "
                 "still have an open request, and the piQ shown on it is what the next "
                 "reviewer earns."),
    }


@app.get("/api/reviews/open")
def open_reviews(request: Request, wallet: str = Query(default=""),
                 orcid: str = Query(default="")):
    """Papers awaiting review. Your own requests are excluded."""
    identity = auth.identity_from_request(request, wallet, orcid)
    key = _profile_key(identity["wallet"], identity["orcid"]) if identity["verified"] else ""
    # The owner can open requests on other people's papers, so filtering their
    # list by "requests you opened" would hide exactly the work they are
    # entitled to review. Filter by AUTHORSHIP instead — the rule that matters.
    if key and auth.is_owner(identity):
        # Everything open, including the owner's own papers: they are permitted
        # to review those, so hiding them would leave the exception unusable.
        open_items = list_open_reviews()
    else:
        open_items = list_open_reviews(exclude_key=key)
    return {"signed_in": bool(key), "open": open_items, "bounty": peer_review_fee()}


@app.get("/api/assessments/{file_hash}/review")
def review_state(file_hash: str, request: Request = None,
                 wallet: str = Query(default=""), orcid: str = Query(default="")):
    """Public: which reviews exist, kept strictly separate by kind."""
    summary = review_summary(file_hash)
    # Split on is_llm (derived from reviewer_key), not on the verdict text. The
    # verdict-prefix test disagreed with the reviewer_key test used by the badge
    # queries, so a paper could carry an LLM-reviewed badge whose review this
    # endpoint then reported as human — leaving the modal empty.
    human = [r for r in summary["reviews"] if not r.get("is_llm")]
    machine = [r for r in summary["reviews"] if r.get("is_llm")]

    # Attach the reply, the vote tally, and whether this caller may act — so
    # the client can render the controls correctly without a second round trip
    # per review, and without guessing at permissions it cannot enforce anyway.
    viewer = auth.identity_from_request(request, wallet, orcid) if request else {}
    viewer_key = (_profile_key(viewer.get("wallet", ""), viewer.get("orcid", ""))
                  if viewer.get("verified") else "")
    viewer_ids = (_identity_values(viewer.get("wallet", ""), viewer.get("orcid", ""))
                  if viewer.get("verified") else [])

    conn = get_db_connection()
    try:
        prow = conn.execute(
            "SELECT user_id, author_openalex_id, published_by FROM papers_assessment "
            "WHERE eval_hash = ?", (file_hash,)).fetchone()
    except sqlite3.Error:
        prow = None
    finally:
        conn.close()
    paper_ids = [v for v in (prow or []) if v]
    is_author = bool(viewer_ids) and any(v in paper_ids for v in viewer_ids)

    # Who opened the outstanding request, if there is one. Read once here
    # rather than inside the response dict, so the query is obvious and the
    # comparison is a plain boolean.
    requested_by_me = False
    if viewer_key:
        conn = get_db_connection()
        try:
            r = conn.execute(
                "SELECT requested_by FROM peer_reviews "
                "WHERE eval_hash = ? AND completed_at IS NULL LIMIT 1", (file_hash,)).fetchone()
            requested_by_me = bool(r and r[0] == viewer_key)
        except sqlite3.Error:
            requested_by_me = False
        finally:
            conn.close()

    # Authorship, for the request gate. Computed here so the interface and the
    # endpoint agree about who may act rather than discovering it on refusal.
    may_request = False
    if viewer_ids:
        try:
            prow2 = conn2 = None
            conn2 = get_db_connection()
            prow2 = conn2.execute(
                "SELECT author_name, doi, title, piq_claimed_at FROM papers_assessment "
                "WHERE eval_hash = ?", (file_hash,)).fetchone()
            conn2.close()
            if prow2:
                attr = verify_authorship(
                    submitter_orcid=viewer.get("orcid", ""),
                    submitter_wallet=viewer.get("wallet", ""),
                    extracted_authors=prow2[0] or "", doi=prow2[1] or "",
                    title=prow2[2] or "")
                may_request = bool(attr.get("verified") or prow2[3])
        except Exception:
            may_request = False

    replies = rebuttals_for_paper(file_hash)
    for r in human + machine:
        rid = r.get("id")
        r["rebuttals"] = replies.get(rid, [])
        r["rating"] = review_rating_summary(rid, viewer_key) if rid else {
            "helpful": 0, "unhelpful": 0, "my_vote": None}
        # A rebuttal is the author's right of reply, so it is offered only to
        # the author, only on a human review, and only once.
        r["may_rebut"] = bool(is_author and not r.get("is_llm") and not r["rebuttals"])
        r["may_rate"] = bool(viewer_key)
    return {
        **summary,
        "peer_reviewed": len(human) > 0,
        "peer_review_count": len(human),
        "llm_reviewed": len(machine) > 0,
        "reviews": human, "llm_reviews": machine,
        # A request is a distinct, weaker state than a review, and it is
        # reported separately for exactly the reason the two badges are
        # separate: "somebody asked for this to be checked" must never be
        # readable as "this was checked".
        "review_requested": has_open_review_request(file_hash),
        # Whether THIS caller opened it, so the interface can offer a cancel
        # button only to the person entitled to use it.
        "review_requested_by_me": requested_by_me,
        # Whether this viewer may commission a review — same authorship test
        # as publishing, so the button is offered only to the author rather
        # than shown to everyone and refused on click.
        "may_request": may_request,
        "may_publish_gate": len(human) > 0,
        "fee": peer_review_fee(), "llm_fee": llm_review_fee(),
        "bonus": peer_review_bonus(),
        "reads": get_paper_reads(file_hash),
    }


@app.post("/api/assessments/{file_hash}/review/request")
def request_review(file_hash: str, payload: ReviewRequest, request: Request):
    """Commission a review. Requires BOTH a signed wallet and a linked ORCID.

    Both, because this spends piQ and puts a claim in front of other
    researchers: a wallet proves control of the paying account, an ORCID ties
    the request to a real research identity that can be held to it.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")
    if not (identity["wallet"] and identity["orcid"]):
        raise HTTPException(
            status_code=403,
            detail=("Requesting review needs both a signed wallet and a linked ORCID. One proves "
                    "the paying account, the other ties the request to a research identity."))

    # Only the paper's author may commission a review of it, on the same
    # authorship test that gates publishing.
    #
    # Review is now the step that unlocks publication, so whoever can request
    # one effectively decides whether a paper becomes publishable. Leaving that
    # open to anyone would let a third party start the process on someone
    # else's manuscript — and, because a request puts the paper in front of
    # reviewers under a "Requested to be reviewed" marker, do so visibly and
    # without the author's involvement.
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT author_name, doi, title, piq_claimed_at FROM papers_assessment "
            "WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")

    attribution = verify_authorship(
        submitter_orcid=identity["orcid"], submitter_wallet=identity["wallet"],
        extracted_authors=row[0] or "", doi=row[1] or "", title=row[2] or "")
    # The escrow claim counts as standing evidence of authorship here, exactly
    # as it does for an author-published badge.
    # Author-only, with no exception — not even for the operator.
    #
    # The owner exemption that briefly lived here existed to give the operator
    # something they were allowed to review, back when reviewing your own paper
    # was impossible. That is no longer the reason it was solving: the owner can
    # now review their own work directly, so letting them commission reviews of
    # other people's papers buys nothing and hands one account the power to put
    # anyone's manuscript in front of reviewers.
    if not (attribution.get("verified") or bool(row[3])):
        raise HTTPException(
            status_code=403,
            detail=("Only the author of a paper can request a review of it. "
                    + (attribution.get("reason") or "Authorship is not verified for this paper.")
                    + (" " + attribution["how_to_verify"]
                       if attribution.get("how_to_verify") else "")))

    key = _profile_key(identity["wallet"], identity["orcid"])

    # The author chooses the bounty, above a floor.
    #
    # A flat price assumed every paper is equally easy to get read, which is
    # not true of anything: a niche or long manuscript competes for the same
    # reviewers as a short topical one, and the author is the only person who
    # knows which theirs is. Letting them offer more is the mechanism that
    # gets unattractive papers reviewed at all.
    #
    # Rejected rather than silently raised when below the floor. Quietly
    # charging more than someone asked for is worse than refusing them.
    fee = float(payload.bounty) if payload.bounty is not None else MIN_REVIEW_BOUNTY
    if fee < MIN_REVIEW_BOUNTY:
        raise HTTPException(
            status_code=400,
            detail=(f"The minimum review bounty is {MIN_REVIEW_BOUNTY:.2f} piQ. A review is a "
                    f"researcher's afternoon, and less than this stops recognising that."))
    if fee > MAX_REVIEW_BOUNTY:
        raise HTTPException(
            status_code=400,
            detail=f"The most that can be offered for one review is {MAX_REVIEW_BOUNTY:.0f} piQ.")
    fee = round(fee, 2)

    bal = get_piq_balance(identity["wallet"], identity["orcid"])
    require_affordable(bal, fee, "A peer review")

    result = open_review_request(file_hash, key, fee)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    if not charge_piq_fee(fee, identity["wallet"], identity["orcid"],
                          eval_hash=file_hash, reason="Peer review bounty (held)"):
        raise HTTPException(status_code=402, detail="The bounty could not be held.")

    add_log(f"Review requested for {file_hash[:12]}… bounty {fee:.2f} piQ"
            + (" (above the minimum)" if fee > MIN_REVIEW_BOUNTY else ""))
    return {"requested": True, "bounty": fee, "awaiting_review": True,
            "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
            "message": (f"Review requested. {fee:.2f} piQ is set aside and will be credited to "
                        f"the researcher who completes it, on top of their "
                        f"{PEER_REVIEW_BONUS:.2f} piQ completion bonus. The paper now carries a "
                        f"Requested-to-be-reviewed "
                        f"marker; the Peer-reviewed badge appears only once a review has actually "
                        f"been submitted.")}


@app.post("/api/assessments/{file_hash}/review/cancel")
def cancel_review(file_hash: str, payload: ReviewRequest, request: Request):
    """Withdraw a review request you opened, and get the held piQ back.

    A request that cannot be withdrawn is a trap: circumstances change, a
    paper gets revised, and piQ set aside against a review nobody ever picks
    up would otherwise be held indefinitely with no way to release it.

    Refunded only after the row is actually gone, so a failed cancellation can
    never return piQ while leaving the request standing.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")
    key = _profile_key(identity["wallet"], identity["orcid"])

    result = cancel_review_request(file_hash, key)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])

    refund = result["refund"]
    refunded = False
    if refund > 0:
        try:
            refunded = refund_piq_fee(refund, identity["wallet"], identity["orcid"],
                                      eval_hash=file_hash,
                                      reason="Peer review request cancelled")
        except Exception as e:
            logging.warning("Refund failed after cancelling review on %s: %s",
                            file_hash[:12], e)

    add_log(f"Review request cancelled on {file_hash[:12]}… refund {refund:.2f} piQ")
    return {
        "cancelled": True, "refund": refund if refunded else 0.0,
        "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
        "message": (
            f"Review request withdrawn. {refund:.2f} piQ returned to your balance."
            if refunded and refund > 0 else
            "Review request withdrawn."
            + (f" The {refund:.2f} piQ could not be returned automatically — please report this."
               if refund > 0 else "")),
    }


@app.post("/api/assessments/{file_hash}/review/llm")
def request_llm_review(file_hash: str, payload: ReviewRequest, request: Request,
                       background: BackgroundTasks = None):
    """Commission a machine review using an actual LLM panel call. Cheaper, and labelled as what it is.

    Recorded in the same table as human reviews but with a reviewer key of
    "llm:panel", so the badge logic can tell them apart and never present one
    as the other.

    A review may be requested again on a paper that already has one. The models
    change, the evidence behind the report changes, and a second reading is a
    legitimate thing to want; each review is kept and shown with its date
    rather than overwriting the last one. The fee is charged per review, which
    is what stops "again" from being free.

    **The review runs in the background.** Everything that can be refused is
    checked and refused here — balance, stored manuscript, identity — and only
    then is the fee taken and a job queued. The model call itself, which is the
    slow part, happens after the response has gone out, so closing the window
    does not abandon a review the user has already paid for. The piQ is spent
    either way; the only question is whether the thing it bought gets written,
    and it now does. The page picks the result up from /api/reviews/jobs.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")
    key = _profile_key(identity["wallet"], identity["orcid"])

    fee = llm_review_fee()["fee"]
    bal = get_piq_balance(identity["wallet"], identity["orcid"])
    require_affordable(bal, fee, "An LLM review")

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT title, evidence_report, author_name FROM papers_assessment "
            "WHERE eval_hash = ?", (file_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")

    # The reviewer reads the MANUSCRIPT, not our evidence report.
    #
    # This endpoint used to hand the model ScholarPi's own synthesised evidence
    # report and ask it to return one of our three rubric verdicts. That was a
    # review of our summary, phrased in our vocabulary — it could only ever
    # agree or disagree with an assessment that had already been made, and it
    # inherited every framing decision the rubric had taken. A machine review
    # worth 0.5 piQ should be an independent reading of the paper.
    manuscript = ""
    stored = paper_store.paper_path(file_hash)
    if stored:
        try:
            with open(stored, "rb") as fh:
                manuscript = full_text_from_pdf(fh.read())
        except OSError as e:
            logging.warning("Could not read stored manuscript %s: %s", file_hash[:12], e)

    if not manuscript.strip():
        # Refuse rather than silently fall back to reviewing our own report.
        # Charging for "a genuine review of the paper" and delivering a review
        # of a summary is the thing being fixed here.
        raise HTTPException(
            status_code=409,
            detail=("An LLM review reads the manuscript itself, and no manuscript file is "
                    "stored for this assessment. Papers assessed before file retention, and "
                    "papers submitted by DOI rather than upload, cannot be reviewed this way — "
                    "re-run the assessment with the PDF uploaded. No piQ has been charged."))

    if not charge_piq_fee(fee, identity["wallet"], identity["orcid"],
                          eval_hash=file_hash, reason="LLM review fee"):
        raise HTTPException(status_code=402, detail="The fee could not be charged.")

    # The job row is the receipt. Written immediately after the charge and
    # before any model call, so a crash mid-review leaves evidence that this
    # identity paid for a review that never arrived — which is what
    # reclaim_stale_review_jobs refunds against on the next start-up.
    job_id = create_review_job(file_hash, key, identity["wallet"], identity["orcid"],
                               fee, kind="llm")

    def _run():
        try:
            result = _perform_llm_review(file_hash, row[0] or "Untitled", manuscript)
        except Exception as e:                       # noqa: BLE001 - must never escape a worker
            logging.exception("LLM review job %s failed for %s", job_id, file_hash[:12])
            try:
                refund_piq_fee(fee, identity["wallet"], identity["orcid"],
                               eval_hash=file_hash, reason="LLM review refund (job failed)")
            except Exception:
                logging.warning("LLM review refund failed for %s", file_hash[:12])
            finish_review_job(job_id, "failed", "",
                              f"The review could not be completed and the {fee:.2f} piQ fee was "
                              f"returned. ({str(e)[:120]})")
            return

        saved = record_llm_review(file_hash, result["verdict"], result["comment"])
        if not saved["ok"]:
            # The fee bought a review that could not be stored. Give it back
            # rather than keep piQ for nothing.
            try:
                refund_piq_fee(fee, identity["wallet"], identity["orcid"],
                               eval_hash=file_hash, reason="LLM review refund (not saved)")
            except Exception:
                logging.warning("LLM review refund failed for %s", file_hash[:12])
            finish_review_job(job_id, "failed", result["verdict"], saved["reason"])
            return

        add_log(f"LLM referee report recorded for {file_hash[:12]}… ({result['verdict']})")
        finish_review_job(
            job_id, "complete", result["verdict"],
            (f"Referee report complete — recommendation: {result['verdict']}. The badge is "
             f"attached; open it to read the full report."
             if result["reached_model"] else
             "No model was reachable, so the review records that. The badge is attached and you "
             "can request a new review to try again."))

    if background is not None:
        # BackgroundTasks runs after the response is sent, in the server
        # process — the client disconnecting has no bearing on it.
        background.add_task(_run)
    else:
        threading.Thread(target=_run, daemon=True).start()

    return {
        "requested": True, "queued": True, "job_id": job_id, "charged": fee,
        "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
        "message": (f"Review queued. {fee:.2f} piQ charged. The panel is reading the manuscript "
                    f"now — this takes up to a minute, and it finishes whether or not you stay "
                    f"on this page. The badge appears here as soon as it lands."),
    }


def _perform_llm_review(file_hash: str, title: str, manuscript: str) -> dict:
    """Read a manuscript with the judge chain and return a referee report.

    Split out of the endpoint so it can run after the response has been sent.
    It takes no request and no identity: everything it needs was validated and
    paid for before it was scheduled, and it returns a result rather than
    writing one, so the caller owns refunding and recording.
    """
    from providers import (build_routes, is_route_cooling, record_success, record_rate_limit,
                           parse_retry_after, classify_provider_error, is_scilm_route)
    from brain import request_model_assessment

    # An ordinary scholarly peer review, in the reviewer's own terms.
    #
    # Deliberately free of ScholarPi's vocabulary: no piX, no piQ, no C1-C8, no
    # three-way rubric verdict. The model is asked to review the paper the way a
    # journal referee would, and to reach its own recommendation from standard
    # peer-review language. If it disagrees with our assessment that is a useful
    # signal, and it cannot produce one while writing inside our categories.
    truncated = len(manuscript) >= 59000
    prompt = (
        "You are an expert peer reviewer for an academic journal. Read the manuscript below "
        "and write a substantive referee report, exactly as you would for a journal editor.\n\n"
        "Judge the work on its own terms and in the conventions of its own field. Do not use "
        "any external scoring framework, rubric or numeric index — assess the research.\n\n"
        "Cover, in your own structure and words:\n"
        "  - what the paper claims and whether the evidence supports it\n"
        "  - the methodology, and any threat to the validity of the conclusions\n"
        "  - statistical or analytical soundness, where applicable\n"
        "  - novelty and contribution relative to existing literature\n"
        "  - reproducibility: data, code, materials, and enough detail to repeat the work\n"
        "  - clarity of presentation\n"
        "  - specific, actionable revisions, referring to concrete parts of the text\n\n"
        "Be direct about weaknesses. A referee report that praises everything is useless to an "
        "editor and to the authors. If the manuscript is strong, say why specifically.\n\n"
        "Return JSON with exactly these keys:\n"
        '  "recommendation": one of "accept", "minor revision", "major revision", "reject"\n'
        '  "summary": one or two sentences stating what the paper does\n'
        '  "report": your full referee report as markdown, 400-800 words, using headings\n'
        '  "strengths": array of short strings\n'
        '  "concerns": array of short strings, most serious first\n\n'
        + ("NOTE: the manuscript was truncated for length; review what is present and say so "
           "if the ending is missing.\n\n" if truncated else "")
        + f"TITLE: {title or 'Untitled'}\n\nMANUSCRIPT:\n{manuscript}"
    )

    # SciLM (siM) is excluded here for the same reason it is excluded from
    # adjudication: it is ScholarPi's own engine, and a "referee report" written
    # by the platform about a paper the platform scored is not an independent
    # reading. build_routes already filters the judge chain; the second filter
    # is cheap and makes the guarantee local to the thing that depends on it.
    judge_routes = [r for r in build_routes("judge") if not is_scilm_route(r)]
    # The fallbacks are what make the badge unconditional. If no model answers,
    # the review still exists and says so plainly — an honest "the panel could
    # not be reached" is a result, and hiding it after taking the fee is not.
    verdict = "inconclusive"
    comment = ("Machine review attempted, but no model in the panel was reachable at the time of "
               "the request. No referee report could be generated. Request a new review to try "
               "again.")
    reached_model = False
    review_model = ""

    if judge_routes:
        for route in judge_routes:
            cooling, remaining = is_route_cooling(route["model"], route["provider"])
            if cooling:
                continue

            _, attempt = request_model_assessment(
                "pidyne", route["model"], route["key"], route["base"], prompt
            )

            if not attempt.get("api_failed", True):
                record_success(route["model"], route["provider"])

                # Standard editorial recommendations, not our rubric. Anything
                # unrecognised is kept verbatim rather than coerced into one of
                # our categories — forcing a reviewer's conclusion into a
                # vocabulary it did not use is how the previous version stopped
                # being a genuine review.
                rec = str(attempt.get("recommendation") or "").strip().lower()
                allowed = ("accept", "minor revision", "major revision", "reject")
                verdict = rec if rec in allowed else (rec[:40] or "reviewed")

                report = str(attempt.get("report") or attempt.get("opinion") or "").strip()
                strengths = [str(x).strip() for x in (attempt.get("strengths") or []) if str(x).strip()]
                concerns = [str(x).strip() for x in (attempt.get("concerns") or []) if str(x).strip()]
                summary_line = str(attempt.get("summary") or "").strip()

                parts = []
                if summary_line:
                    parts.append(f"**Summary.** {summary_line}")
                parts.append(f"**Recommendation: {verdict}**")
                if report:
                    parts.append(report)
                if strengths:
                    parts.append("### Strengths\n" + "\n".join(f"- {x}" for x in strengths))
                if concerns:
                    parts.append("### Concerns\n" + "\n".join(f"- {x}" for x in concerns))
                parts.append(
                    f"---\n*Referee report written by {route['model']} via {route['provider']} "
                    f"from the full manuscript. This is a machine review — no human read the "
                    f"paper — and it is independent of ScholarPi's own assessment.*")

                comment = "\n\n".join(parts) if report or strengths or concerns else (
                    f"The model returned a recommendation ({verdict}) without a written report.")
                review_model = f"{route['model']} via {route['provider']}"
                reached_model = True
                break

            raw_err = attempt.get("_raw_error", "")
            classified = classify_provider_error(raw_err)
            if classified["category"] == "rate_limit":
                record_rate_limit(route["model"], route["provider"], parse_retry_after(raw_err))

    return {"verdict": verdict, "comment": comment,
            "reached_model": reached_model, "model": review_model}


@app.get("/api/reviews/jobs")
def review_jobs(request: Request, wallet: str = Query(default=""),
                orcid: str = Query(default="")):
    """Review work this identity has commissioned, and what became of it.

    The mechanism by which a review survives the window that asked for it: the
    browser polls this instead of holding a request open, so a review requested
    and then walked away from is still there — finished — on the next visit.
    """
    identity = auth.identity_from_request(request, wallet, orcid)
    if not identity["verified"]:
        return {"signed_in": False, "jobs": [], "pending": 0}
    key = _profile_key(identity["wallet"], identity["orcid"])
    jobs = list_review_jobs(key)
    return {"signed_in": True, "jobs": jobs,
            "pending": sum(1 for j in jobs if j["status"] in ("queued", "running"))}


# What a review has to contain to count. Published rather than merely
# enforced, so the writing window can show a reviewer the bar before they
# spend an hour on a report and have it refused at submission.
REVIEW_MIN_CHARS = 400
REVIEW_REQUIREMENTS = [
    {"id": "eligibility",
     "text": ("You must have at least one paper published in the journal list. Reviewing is open "
              "to people who have put their own work through the same process.")},
    {"id": "identity",
     "text": ("Both a signed wallet and a linked ORCID. The wallet proves control of the account "
              "being paid; the ORCID ties the report to a research identity.")},
    {"id": "independence",
     "text": ("You cannot review your own paper, or one you requested a review of. Requester and "
              "reviewer being the same person would make the badge self-issued.")},
    {"id": "verdict",
     "text": "A verdict: sound, concerns, or unsound."},
    {"id": "length",
     "text": (f"At least {REVIEW_MIN_CHARS} characters of reasoning, referring to specific parts "
              f"of the manuscript. A verdict with no argument behind it is not a review.")},
    {"id": "substance",
     "text": ("Cover the claims against the evidence, the methodology, and reproducibility. Be "
              "direct about weaknesses — a report that praises everything is useless to a reader.")},
]


class RebuttalRequest(BaseModel):
    review_id: int
    body: str = ""
    wallet: str = ""
    orcid: str = ""


class RatingRequest(BaseModel):
    review_id: int
    value: int = 1              # +1 helpful, -1 not helpful
    wallet: str = ""
    orcid: str = ""


class ReportRequest(BaseModel):
    review_id: int
    reason: str = ""
    detail: str = ""
    wallet: str = ""
    orcid: str = ""


@app.post("/api/reviews/rebut")
def rebut_review(payload: RebuttalRequest, request: Request):
    """Reply to a review of your own paper.

    The review is never edited or removed. A rebuttal is published beside it,
    so a reader sees the criticism and the author's answer together — an author
    who could suppress a review they disliked would make the Peer-reviewed
    badge meaningless, and one who cannot answer at all is being judged without
    a right of reply.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")

    info = review_owner_key(payload.review_id)
    if not info or not info.get("completed"):
        raise HTTPException(status_code=404, detail="No completed review with that id.")

    key = _profile_key(identity["wallet"], identity["orcid"])
    identities = _identity_values(identity["wallet"], identity["orcid"])
    # Only the paper's author may reply. Anyone else arguing with a review in
    # the author's slot would be a comment section, which is a different
    # feature with different moderation needs.
    if not any(v in info["paper_identities"] for v in identities):
        raise HTTPException(
            status_code=403,
            detail=("Only the author of the paper can reply to a review of it. If the paper is "
                    "yours, claim authorship first — the same check that gates publishing."))

    result = add_review_rebuttal(payload.review_id, info["eval_hash"], key, payload.body)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    add_log(f"Rebuttal filed on review {payload.review_id} for {info['eval_hash'][:12]}…")
    return {"submitted": True,
            "message": ("Your reply is published beneath the review. The review itself is "
                        "unchanged — readers see both.")}


@app.post("/api/reviews/rate")
def rate_review_endpoint(payload: RatingRequest, request: Request):
    """Mark a review helpful or unhelpful. One vote per identity, changeable."""
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")

    info = review_owner_key(payload.review_id)
    if not info or not info.get("completed"):
        raise HTTPException(status_code=404, detail="No completed review with that id.")

    key = _profile_key(identity["wallet"], identity["orcid"])
    # A reviewer voting on their own review is the one vote that means nothing.
    if key and key == info.get("reviewer_key"):
        raise HTTPException(status_code=403, detail="You cannot rate your own review.")

    result = rate_review(payload.review_id, key, payload.value)
    if not result["ok"]:
        raise HTTPException(status_code=503, detail=result["reason"])
    return {"rated": True, "helpful": result["helpful"], "unhelpful": result["unhelpful"],
            "my_vote": result["my_vote"]}


@app.post("/api/reviews/report")
def report_review_endpoint(payload: ReportRequest, request: Request):
    """Flag a review for a moderator.

    Deliberately separate from an unhelpful vote. "I disagree with this review"
    and "this review is abusive or fabricated" are different claims, and
    counting them together would bury the second under the volume of the first.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")

    info = review_owner_key(payload.review_id)
    if not info or not info.get("completed"):
        raise HTTPException(status_code=404, detail="No completed review with that id.")

    key = _profile_key(identity["wallet"], identity["orcid"])
    result = report_review(payload.review_id, info["eval_hash"], key,
                           payload.reason, payload.detail)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    add_log(f"Review {payload.review_id} reported ({payload.reason}).")
    return {"reported": True,
            "message": ("Thank you. A moderator will look at this review. The review stays "
                        "visible in the meantime — reports are not a way to hide criticism.")}


@app.get("/api/reviews/report-reasons")
def review_report_reasons():
    """The grounds on which a review can be reported, published so the form
    and any client agree on what is being claimed."""
    return {"reasons": [{"id": k, "label": v} for k, v in REPORT_REASONS.items()],
            "rebuttal_min_chars": REBUTTAL_MIN_CHARS}


class ClearHistoryRequest(BaseModel):
    confirm: str = ""               # must be the literal word DELETE
    wallet: str = ""
    orcid: str = ""


@app.post("/api/assessments/mine/clear")
def clear_my_history(payload: ClearHistoryRequest, request: Request):
    """Withdraw every assessment submitted under this identity.

    This is the user's own scope, not the operator's: it removes only papers
    submitted by this identity, and it uses the same withdrawal path as
    removing one paper at a time, so the guarantees are identical. The
    Proof-of-Research blocks remain — the chain is append-only, and deleting a
    block would invalidate every block after it, so "clear my history" means
    the papers leave the corpus and the listings, not that the ledger is
    rewritten. Said plainly in the response rather than left to be discovered.
    """
    identity = require_identity(request, payload.wallet, payload.orcid)
    if (payload.confirm or "").strip() != "DELETE":
        raise HTTPException(
            status_code=400,
            detail="Type DELETE exactly to confirm. Nothing has been removed.")

    identities = _identity_values(identity["wallet"], identity["orcid"])
    rows = list_assessments_for_identity(identities, limit=1000)
    if not rows:
        return {"cleared": True, "removed": 0,
                "message": "There was nothing to remove."}

    removed, failed = 0, 0
    for r in rows:
        h = r.get("eval_hash") or r.get("hash")
        if not h:
            continue
        try:
            if delete_assessment(h, identities):
                paper_store.delete_paper(h)
                removed += 1
            else:
                failed += 1
        except Exception as e:
            logging.warning("Could not remove %s during history clear: %s", str(h)[:12], e)
            failed += 1

    add_log(f"History cleared for {_profile_key(identity['wallet'], identity['orcid'])[:16]}…"
            f" — {removed} paper(s) withdrawn")
    return {
        "cleared": True, "removed": removed, "failed": failed,
        "message": (
            f"{removed} paper{'' if removed == 1 else 's'} withdrawn from the corpus and all "
            f"listings."
            + (f" {failed} could not be removed." if failed else "")
            + " Their Proof-of-Research blocks remain: the chain is append-only, so deleting a "
              "block would invalidate every block after it. piQ already earned is unaffected."),
    }


class ResetRequest(BaseModel):
    groups: List[str] = []
    confirm: str = ""               # must be the literal word RESET
    clear_files: bool = False       # also delete stored manuscript PDFs
    wallet: str = ""


@app.get("/api/admin/reset/options")
def reset_options(request: Request, wallet: str = Query(default="")):
    """What can be wiped, and how much of it there currently is.

    The counts are the point. "Delete assessed papers" means nothing without
    "(29 rows)" beside it, and an operator about to destroy something
    irreversible should be shown the size of what they are destroying before
    they confirm rather than after.
    """
    require_owner(request, wallet)
    conn = get_db_connection()
    options = []
    try:
        for key, spec in sorted(RESET_GROUPS.items(), key=lambda kv: kv[1]["order"]):
            rows = 0
            missing = True
            for table in spec["tables"]:
                try:
                    rows += int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] or 0)
                    missing = False
                except sqlite3.Error:
                    continue
            options.append({"id": key, "label": spec["label"], "detail": spec["detail"],
                            "destroys": spec["destroys"], "rows": rows,
                            "available": not missing})
    finally:
        conn.close()

    stored_files = 0
    try:
        stored_files = paper_store.count_papers()
    except Exception:
        stored_files = -1        # unknown; the UI says so rather than guessing

    return {"options": options, "stored_files": stored_files,
            "confirm_word": "RESET",
            "note": ("Each group is independent. Nothing outside the groups you tick is "
                     "touched, and the whole reset runs in one transaction — if any part "
                     "fails, nothing is deleted.")}


@app.post("/api/admin/reset")
def admin_reset(payload: ResetRequest, request: Request):
    """Wipe the selected state groups. Owner only, and irreversible.

    Three independent gates, because this is the most destructive endpoint on
    the platform: the owner wallet must be proven, the confirmation word must
    be typed exactly, and at least one group must be named. A missing gate is
    a refusal, never a default — there is no combination of empty inputs that
    deletes anything.
    """
    require_owner(request, payload.wallet)

    if (payload.confirm or "").strip() != "RESET":
        raise HTTPException(
            status_code=400,
            detail="Type RESET exactly to confirm. Nothing has been deleted.")

    groups = [g for g in (payload.groups or []) if g in RESET_GROUPS]
    if not groups:
        raise HTTPException(
            status_code=400,
            detail="Choose at least one thing to reset. Nothing has been deleted.")

    result = reset_state_groups(groups)
    if not result["ok"]:
        raise HTTPException(status_code=503, detail=result["reason"])

    # Stored manuscripts are files on disk, not rows, so they are cleared
    # separately and only when explicitly asked for. Wiping the corpus while
    # silently leaving the PDFs behind — or deleting a researcher's uploads
    # when they only asked to clear balances — are both wrong.
    files_removed = 0
    if payload.clear_files and "assessments" in groups:
        try:
            files_removed = paper_store.clear_all()
        except Exception as e:
            logging.warning("Stored manuscripts could not be cleared: %s", e)
            files_removed = -1

    add_log(f"STATE RESET by owner — groups: {', '.join(groups)}; "
            f"rows deleted: {sum(result['deleted'].values())}"
            + (f"; files removed: {files_removed}" if payload.clear_files else ""))

    total = sum(result["deleted"].values())
    return {
        "reset": True,
        "groups": groups,
        "deleted": result["deleted"],
        "rows_deleted": total,
        "files_removed": files_removed,
        "message": (
            f"Reset complete. {total} row{'' if total == 1 else 's'} deleted across "
            f"{len(groups)} group{'' if len(groups) == 1 else 's'}."
            + (f" {files_removed} stored manuscript{'' if files_removed == 1 else 's'} removed."
               if payload.clear_files and files_removed >= 0 else "")
            + " This cannot be undone."),
    }


@app.get("/api/admin/overview")
def admin_overview(request: Request, wallet: str = Query(default="")):
    """Operator-only numbers: who has signed up, and what they are doing.

    Deliberately separate from /api/analytics/summary, which is public. These
    are counts of PEOPLE and of platform activity — how many identities exist,
    how many are active, what is being spent — and publishing them would tell
    every visitor the size of the user base and how thin the activity is. The
    public summary describes the corpus; this describes the deployment.
    """
    require_owner(request, wallet)
    conn = get_db_connection()

    def scalar(sql, params=()):
        try:
            row = conn.execute(sql, params).fetchone()
            return int(row[0] or 0) if row else 0
        except sqlite3.Error:
            return 0

    try:
        # "Signed up" = a distinct account that exists in the ledger or has
        # saved a profile. There is no users table — identity is a wallet or an
        # ORCID that has done something — so the count is derived from the
        # places an identity leaves a durable trace.
        ledger_accounts = scalar("SELECT COUNT(DISTINCT account) FROM piq_ledger")
        profiles = scalar("SELECT COUNT(*) FROM researcher_profiles")
        submitters = scalar(
            "SELECT COUNT(DISTINCT user_id) FROM papers_assessment "
            "WHERE user_id IS NOT NULL AND user_id <> ''")

        stats = {
            "accounts_with_balance": ledger_accounts,
            "saved_profiles": profiles,
            "distinct_submitters": submitters,
            # Activity windows, so "how many signed up" can be read against
            # "how many are still here" — a total with no recency is a number
            # that only ever goes up.
            "active_7d": scalar(
                "SELECT COUNT(DISTINCT user_id) FROM papers_assessment "
                "WHERE timestamp > DATETIME('now','-7 days') AND user_id <> ''"),
            "active_30d": scalar(
                "SELECT COUNT(DISTINCT user_id) FROM papers_assessment "
                "WHERE timestamp > DATETIME('now','-30 days') AND user_id <> ''"),
            "papers_7d": scalar(
                "SELECT COUNT(*) FROM papers_assessment "
                "WHERE timestamp > DATETIME('now','-7 days')"),
            "papers_total": scalar("SELECT COUNT(*) FROM papers_assessment"),
            "reviews_human": scalar(
                "SELECT COUNT(*) FROM peer_reviews WHERE completed_at IS NOT NULL "
                "AND reviewer_key <> 'llm:panel'"),
            "reviews_llm": scalar(
                "SELECT COUNT(*) FROM peer_reviews WHERE completed_at IS NOT NULL "
                "AND reviewer_key = 'llm:panel'"),
            "reviews_open": scalar(
                "SELECT COUNT(*) FROM peer_reviews WHERE completed_at IS NULL"),
            "published": scalar(
                "SELECT COUNT(*) FROM papers_assessment WHERE published_at IS NOT NULL"),
            "bugs_open": scalar("SELECT COUNT(*) FROM bug_reports WHERE delivered = 0"),
        }

        # piQ in circulation, split the way the balance itself is split.
        try:
            row = conn.execute(
                "SELECT COALESCE(SUM(piq_minted),0), "
                "COALESCE(SUM(CASE WHEN piq_claimed_at IS NULL THEN piq_escrowed ELSE 0 END),0) "
                "FROM papers_assessment").fetchone()
            stats["piq_minted"] = round(float(row[0] or 0), 2)
            stats["piq_held"] = round(float(row[1] or 0), 2)
        except sqlite3.Error:
            stats["piq_minted"] = stats["piq_held"] = 0.0
    finally:
        conn.close()

    try:
        stats["visitors"] = visitor_stats()
    except Exception:
        stats["visitors"] = {}

    # Idle-time corpus growth. Owner-only, alongside the rest of the operator
    # numbers, because it is the one process that spends provider quota with
    # nobody watching — so it is exactly the thing an operator needs visibility
    # of rather than a feature to leave running unseen.
    try:
        stats["idle"] = idle_worker.status()
    except Exception:
        stats["idle"] = {"enabled": False}

    return stats


def settlement_blockers() -> list:
    """Why settlement cannot run right now, in the operator's own terms.

    Named specifically rather than as a generic failure: "settlement
    unavailable" is not actionable, "PIQ_CONTRACT_ADDRESS is not set" is an
    instruction. Shared by the admin view and the automatic sweep so the queue
    page and the background worker can never disagree about why nothing moved.
    """
    blockers = []
    if not PIQ_CONTRACT_ADDRESS:
        blockers.append("PIQ_CONTRACT_ADDRESS is not set — there is no contract to mint against.")
    if not ETH_ADMIN_PRIVATE_KEY:
        blockers.append("ETH_ADMIN_PRIVATE_KEY is not set — nothing can sign a transaction.")
    try:
        if (get_chain_status() or {}).get("connected") is False:
            blockers.append(f"No {CHAIN_NAME} RPC endpoint is reachable.")
    except Exception:                                            # noqa: BLE001
        blockers.append(f"The {CHAIN_NAME} RPC endpoint could not be queried.")
    return blockers


def settle_batch(limit: int = 10) -> dict:
    """Mint outstanding records, one transaction each. Returns what happened.

    One transaction per record rather than a batch call: each mint costs gas
    and can fail independently, and a partial batch that reverts as a unit
    would lose the successes with it.
    """
    settled, failed = [], []
    for paper in list_unsettled_mintable(limit=limit):
        try:
            tx = mint_pi_quotient_token(paper["wallet"], paper["piq"],
                                        paper["eval_hash"], "")
        except Exception as e:                                   # noqa: BLE001
            failed.append({**paper, "reason": str(e)[:200]})
            continue
        # mint_pi_quotient_token reports refusals as a STRING rather than
        # raising, so a skip reads as success unless the shape is checked.
        if is_tx_hash(tx):
            if record_settlement(paper["eval_hash"], tx):
                settled.append({**paper, "tx_hash": tx})
                add_log(f"Settled {paper['eval_hash'][:12]}… on chain: {tx[:14]}…")
            else:
                # The mint succeeded but the row would not take it — almost
                # certainly settled by a concurrent call. Reported rather than
                # swallowed, because it means gas was spent twice.
                failed.append({**paper, "reason": f"Minted {tx[:14]}… but the record was "
                                                  f"already settled. Check for a double spend."})
        else:
            failed.append({**paper, "reason": str(tx)[:200]})
    return {"settled": settled, "failed": failed,
            "settled_count": len(settled), "failed_count": len(failed),
            "remaining": len(list_unsettled_mintable())}


# --- Automatic settlement ---------------------------------------------------
#
# Until now the ONLY way an unsettled record ever reached the chain was the
# owner opening the admin panel and pressing a button. Everything else in the
# pipeline retries; settlement did not, so a mint skipped by a provider outage
# or an unfunded gas wallet stayed skipped forever, and the queue grew silently.
# brain.py already carries a comment about that exact failure — "since nothing
# re-tried, it stayed unsettled forever" — for the case it had just fixed. This
# is the retry.
#
# Deliberately conservative, because this spends real money:
#   * it does nothing at all while any blocker is present, so a misconfigured
#     deployment burns no gas and logs one clear reason instead of a loop of
#     failures;
#   * it takes a small batch per pass, so a backlog drains over minutes rather
#     than in one unbounded burst;
#   * it can be switched off entirely with AUTO_SETTLE=0.
_settle_state = {"last": None, "last_result": None, "reason": ""}


def _settlement_loop():
    interval = max(60, int(AUTO_SETTLE_INTERVAL_SECONDS))
    while True:
        time.sleep(interval)
        try:
            blockers = settlement_blockers()
            if blockers:
                _settle_state["reason"] = blockers[0]
                continue
            if not list_unsettled_mintable(limit=1):
                _settle_state["reason"] = "Nothing outstanding."
                continue
            result = settle_batch(limit=AUTO_SETTLE_BATCH)
            _settle_state["last"] = datetime.now().isoformat()
            _settle_state["last_result"] = {k: result[k] for k in
                                            ("settled_count", "failed_count", "remaining")}
            _settle_state["reason"] = ""
            if result["settled_count"]:
                add_log(f"Auto-settlement: {result['settled_count']} minted, "
                        f"{result['remaining']} still outstanding.")
        except Exception as e:                                   # noqa: BLE001
            # A settlement sweep must never take the process down: it runs
            # unattended, and the queue is still there next pass.
            logging.warning("Auto-settlement pass failed: %s", e)
            _settle_state["reason"] = str(e)[:200]


def start_auto_settlement():
    if not ENABLE_AUTO_SETTLEMENT:
        logging.info("Automatic settlement is off (AUTO_SETTLE=0). "
                     "Unsettled records wait for the admin panel.")
        return False
    threading.Thread(target=_settlement_loop, name="auto-settlement", daemon=True).start()
    logging.info("Automatic settlement on: up to %d records every %ds.",
                 AUTO_SETTLE_BATCH, AUTO_SETTLE_INTERVAL_SECONDS)
    return True


class GrantRequest(BaseModel):
    """An owner-issued piQ credit. Amount is bounded at the edge."""
    wallet: str = ""
    orcid: str = ""
    amount: float = 0.0
    reason: str = "Owner grant"


# The ceiling is a guard against a slipped decimal point, not a policy: an
# owner who genuinely wants more can issue two grants, and each one is a
# separate audited row.
MAX_SINGLE_GRANT = 100_000.0


@app.post("/api/admin/grant")
def admin_grant(req: GrantRequest, request: Request, wallet: str = Query(default="")):
    """Credit piQ to an identity. Owner only, and written to the ledger.

    Exists so testing a paid path does not require hand-editing the database.
    A hand-written UPDATE is unattributable, unreversible and easy to get
    subtly wrong — raising `piq_minted` on a paper, for instance, would credit
    the balance AND inflate the corpus emission totals, which are a published
    figure. This writes one ledger row with a reason, which is the same
    mechanism every fee, refund and escrow release already uses.

    `require_owner` demands a session token minted from an EIP-191 signature by
    OWNER_ID. OWNER_ID is public — it is served at /api/chain/status — so a
    query parameter alone would let any reader mint themselves piQ.
    """
    require_owner(request, wallet)

    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="A grant must be a positive amount.")
    if req.amount > MAX_SINGLE_GRANT:
        raise HTTPException(
            status_code=400,
            detail=f"A single grant is capped at {MAX_SINGLE_GRANT:,.0f} piQ. "
                   f"Issue several if you genuinely need more.")

    target_wallet = (req.wallet or "").strip()
    target_orcid = (req.orcid or "").strip()
    if not target_wallet and not target_orcid:
        # Defaulting to the owner's own wallet is the common case — "give me
        # some piQ so I can test" — and saves pasting an address you are
        # already signed in as.
        target_wallet = OWNER_ID or ""
    if not target_wallet and not target_orcid:
        raise HTTPException(status_code=400,
                            detail="No recipient given and OWNER_ID is not configured.")

    result = grant_piq(req.amount, target_wallet, target_orcid,
                       reason=f"Owner grant: {(req.reason or '').strip()[:120]}".strip(": "))
    if not result.get("granted"):
        raise HTTPException(status_code=400, detail=result.get("reason") or "Grant failed.")

    who = result.get("account", "")
    add_log(f"Owner granted {result['granted']:.2f} piQ to {who[:16]}… "
            f"(balance now {result['balance']:.2f}).")
    return {
        **result,
        "message": (f"{result['granted']:.2f} piQ credited to {who}. "
                    f"Balance is now {result['balance']:.2f} piQ. This is a ledger entry — "
                    f"it appears in the fee history and can be reversed with a negative grant."),
    }


def _dir_size(path: str) -> Tuple[int, int]:
    """(bytes, file count) under a directory. Missing directory reads as empty."""
    total = files = 0
    for root, _dirs, names in os.walk(path):
        for n in names:
            try:
                total += os.path.getsize(os.path.join(root, n))
                files += 1
            except OSError:
                continue
    return total, files


def _human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} TB"


@app.get("/api/admin/storage")
def storage_report(request: Request, wallet: str = Query(default="")):
    """What is actually using the data volume. Owner only.

    A hosting alert says "the volume is at 88%" and nothing else, which leaves
    an operator guessing between the database, the retained manuscripts and the
    logs — three things with completely different remedies. This measures each,
    and names the one item that is always safe to delete: a stored PDF whose
    assessment no longer exists.
    """
    require_owner(request, wallet)

    db_bytes = 0
    for suffix in ("", "-wal", "-shm"):          # WAL can be larger than the DB
        try:
            db_bytes += os.path.getsize(DB_PATH + suffix)
        except OSError:
            pass

    store_bytes, store_files = _dir_size(paper_store.PAPER_STORE_DIR)
    log_bytes, log_files = _dir_size(os.path.join(BASE_DIR, "logs"))

    # Orphans: a file on disk with no row pointing at it. These accumulate
    # because a paper is stored at UPLOAD time, before the pipeline has decided
    # whether the submission produces a record at all — a duplicate merge, a
    # failed extraction or a refused run all leave the bytes behind.
    orphans, orphan_bytes = [], 0
    try:
        conn = get_db_connection()
        try:
            known = {r[0] for r in conn.execute(
                "SELECT eval_hash FROM papers_assessment").fetchall()}
        finally:
            conn.close()
        for name in os.listdir(paper_store.PAPER_STORE_DIR):
            if not name.endswith(".pdf"):
                continue
            if name[:-4] not in known:
                p = os.path.join(paper_store.PAPER_STORE_DIR, name)
                try:
                    orphan_bytes += os.path.getsize(p)
                except OSError:
                    pass
                orphans.append(name[:-4])
    except Exception as e:                                       # noqa: BLE001
        logging.warning("Orphan scan failed: %s", e)

    try:
        usage = shutil.disk_usage(BASE_DIR)
        disk = {"total": usage.total, "used": usage.used, "free": usage.free,
                "percent_used": round(usage.used / usage.total * 100, 1) if usage.total else None}
    except Exception:                                            # noqa: BLE001
        disk = {}

    # Rows whose payload is a BLOB. The queue is transient by design, so a row
    # still sitting here is a submission that was never drained.
    queue_rows = 0
    try:
        conn = get_db_connection()
        try:
            queue_rows = conn.execute("SELECT COUNT(*) FROM ingestion_queue").fetchone()[0]
        finally:
            conn.close()
    except sqlite3.Error:
        queue_rows = 0

    return {
        "path": BASE_DIR,
        "disk": disk,
        "database": {"bytes": db_bytes, "human": _human(db_bytes),
                     "ingestion_queue_rows": queue_rows},
        "manuscripts": {"bytes": store_bytes, "human": _human(store_bytes),
                        "files": store_files},
        "logs": {"bytes": log_bytes, "human": _human(log_bytes), "files": log_files},
        "orphans": {"count": len(orphans), "bytes": orphan_bytes,
                    "human": _human(orphan_bytes)},
        "note": ("Manuscripts are retained so a published assessment can serve the paper it "
                 "assessed. Orphans are stored files with no assessment left — always safe to "
                 "delete. VACUUM reclaims database pages freed by withdrawals; SQLite does not "
                 "return that space to the filesystem on its own."),
    }


class CleanupRequest(BaseModel):
    orphans: bool = True
    vacuum: bool = False
    drain_queue: bool = False


@app.post("/api/admin/storage/cleanup")
def storage_cleanup(req: CleanupRequest, request: Request, wallet: str = Query(default="")):
    """Reclaim space. Owner only, and every step is opt-in.

    Nothing here touches a manuscript that still has an assessment. Deleting
    those is a retention POLICY decision — it silently breaks the file link on
    every published paper — so it is deliberately not offered as a button.
    """
    require_owner(request, wallet)
    done = {"orphans_removed": 0, "bytes_freed": 0, "queue_rows_cleared": 0,
            "vacuumed": False}

    if req.orphans:
        try:
            conn = get_db_connection()
            try:
                known = {r[0] for r in conn.execute(
                    "SELECT eval_hash FROM papers_assessment").fetchall()}
            finally:
                conn.close()
            for name in os.listdir(paper_store.PAPER_STORE_DIR):
                if not name.endswith(".pdf") or name[:-4] in known:
                    continue
                p = os.path.join(paper_store.PAPER_STORE_DIR, name)
                try:
                    size = os.path.getsize(p)
                    os.remove(p)
                    done["orphans_removed"] += 1
                    done["bytes_freed"] += size
                except OSError:
                    continue
        except Exception as e:                                   # noqa: BLE001
            logging.warning("Orphan cleanup failed: %s", e)

    if req.drain_queue:
        try:
            conn = get_db_connection()
            try:
                cur = conn.execute("DELETE FROM ingestion_queue")
                done["queue_rows_cleared"] = cur.rowcount or 0
                conn.commit()
            finally:
                conn.close()
        except sqlite3.Error as e:
            logging.warning("Queue drain failed: %s", e)

    if req.vacuum:
        # VACUUM rewrites the database, so it needs free space roughly equal to
        # the current file while it runs. On a volume that is already nearly
        # full that is the one operation most likely to fail — so it runs last,
        # after the deletions above have made room for it.
        try:
            conn = get_db_connection()
            try:
                conn.execute("VACUUM")
                done["vacuumed"] = True
            finally:
                conn.close()
        except sqlite3.Error as e:
            logging.warning("VACUUM failed: %s", e)
            done["vacuum_error"] = str(e)[:200]

    add_log(f"Storage cleanup: {done['orphans_removed']} orphaned files "
            f"({_human(done['bytes_freed'])}), queue rows {done['queue_rows_cleared']}, "
            f"vacuum={done['vacuumed']}.")
    done["human_freed"] = _human(done["bytes_freed"])
    return done


@app.get("/api/admin/settlement")
def settlement_queue(request: Request, wallet: str = Query(default="")):
    """What earned piQ but never reached the chain, and why it can't right now."""
    require_owner(request, wallet)
    pending = list_unsettled_mintable()
    chain = {}
    try:
        chain = get_chain_status() or {}
    except Exception as e:                                       # noqa: BLE001
        chain = {"error": str(e)[:200]}

    blockers = settlement_blockers()

    return {
        "pending": pending,
        "count": len(pending),
        "total_piq": round(sum(p["piq"] for p in pending), 4),
        "chain": chain,
        "blockers": blockers,
        "can_settle": not blockers,
        # So the operator can see the sweep is alive without reading logs.
        "auto": {
            "enabled": bool(ENABLE_AUTO_SETTLEMENT),
            "every_seconds": AUTO_SETTLE_INTERVAL_SECONDS,
            "batch": AUTO_SETTLE_BATCH,
            "last_run": _settle_state.get("last"),
            "last_result": _settle_state.get("last_result"),
            "idle_reason": _settle_state.get("reason"),
        },
        "note": ("These assessments earned piQ against a real wallet, but minting was skipped —"
                 " no contract, no key, no gas, or a provider outage at the time. The piQ was"
                 " earned; the settlement is owed."),
    }


@app.post("/api/admin/settle")
def settle_pending(request: Request, wallet: str = Query(default=""),
                   limit: int = Query(default=10, ge=1, le=100)):
    """Mint the outstanding records, one transaction each.

    Batched with a low default rather than draining the queue in one call: each
    mint costs gas and can fail independently, and a loop that runs for minutes
    inside a request handler will be killed by the proxy halfway through with no
    record of where it stopped. Small batches are resumable by construction.
    """
    require_owner(request, wallet)
    # Same code path the automatic sweep uses, so pressing the button and
    # waiting for the timer cannot behave differently.
    return settle_batch(limit=limit)


@app.get("/api/admin/review-reports")
def admin_review_reports(request: Request, wallet: str = Query(default=""),
                         include_resolved: bool = Query(default=False)):
    """The moderation queue. Operator only."""
    require_owner(request, wallet)
    return {"reports": list_review_reports(include_resolved=include_resolved)}


@app.get("/api/reviews/eligibility")
def review_eligibility(request: Request, wallet: str = Query(default=""),
                       orcid: str = Query(default="")):
    """Whether this identity may write reviews, and what is required of one.

    Answered before the writing window opens rather than at submission. Telling
    someone their report is refused after they have written it is the worst
    possible moment to mention a rule they could have been told up front.
    """
    identity = auth.identity_from_request(request, wallet, orcid)
    if not identity["verified"]:
        return {"signed_in": False, "eligible": False, "published_count": 0,
                "requirements": REVIEW_REQUIREMENTS, "min_chars": REVIEW_MIN_CHARS,
                "bonus": PEER_REVIEW_BONUS,
                "reason": "Sign in with a wallet or ORCID to review."}

    identities = _identity_values(identity["wallet"], identity["orcid"])
    published = count_journal_publications(identities)
    both_factors = bool(identity["wallet"] and identity["orcid"])

    # The owner is exempt from the publication requirement, and has to be.
    #
    # Publishing requires a completed review; reviewing requires having
    # published. On a fresh deployment that is a closed loop with no entry
    # point — the first paper can never be reviewed, so it can never be
    # published, so nobody ever becomes eligible to review. Somebody has to be
    # able to write the first review, and the operator is the only identity the
    # platform can already authenticate as trusted.
    #
    # It is an exemption from the ELIGIBILITY gate only. Everything that
    # protects the integrity of a review still applies to the owner: they
    # cannot review their own paper, cannot review one they requested, and the
    # report still has to meet the length and verdict requirements.
    is_owner = bool(auth.is_owner(identity))
    eligible = (published >= 1 or is_owner) and both_factors

    if is_owner and published < 1:
        reason = ""
    elif published < 1:
        reason = ("To become a reviewer you must have at least one paper published in the journal "
                  "list. Publish an assessment of your own work first — it needs a review of its "
                  "own to be publishable, so the requirement is a loop you enter by being "
                  "reviewed, not by reviewing.")
    elif not both_factors:
        missing = "a signed wallet" if not identity["wallet"] else "a linked ORCID"
        reason = f"Reviewing needs both a signed wallet and a linked ORCID; you are missing {missing}."
    else:
        reason = ""

    return {"signed_in": True, "eligible": eligible, "published_count": published,
            "requirements": REVIEW_REQUIREMENTS, "min_chars": REVIEW_MIN_CHARS,
            "bonus": PEER_REVIEW_BONUS, "reason": reason,
            # Surfaced so the writing window can say WHY it is open — an
            # exemption the user cannot see is indistinguishable from the rule
            # not existing.
            "owner_exemption": bool(is_owner and published < 1)}


@app.post("/api/reviews/submit")
def submit_review(payload: ReviewSubmission, request: Request):
    """Complete a review and collect the bounty plus the completion bonus."""
    identity = require_identity(request, payload.wallet, payload.orcid)
    check_rate_limit(get_client_ip(request), bucket="review")
    if not (identity["wallet"] and identity["orcid"]):
        raise HTTPException(
            status_code=403,
            detail="Reviewing needs both a signed wallet and a linked ORCID.")

    # Re-checked at submission, not only when the window opened. A page can be
    # left open across a change in standing, and the eligibility endpoint is a
    # courtesy to the reviewer — this is the control.
    identities = _identity_values(identity["wallet"], identity["orcid"])
    # Same owner exemption as the eligibility endpoint, and enforced here for
    # the same reason that endpoint exists: the gate is the control, and the
    # interface is only a courtesy. See review_eligibility for why the
    # exemption is necessary rather than convenient.
    if count_journal_publications(identities) < 1 and not auth.is_owner(identity):
        raise HTTPException(
            status_code=403,
            detail=("To review, you must have at least one paper published in the journal list. "
                    "Publish your own work first."))

    if payload.verdict not in ("sound", "concerns", "unsound"):
        raise HTTPException(status_code=400, detail="Verdict must be sound, concerns or unsound.")
    if len((payload.comment or "").strip()) < REVIEW_MIN_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(f"A review needs at least {REVIEW_MIN_CHARS} characters of reasoning; yours "
                    f"has {len((payload.comment or '').strip())}. A verdict with no argument "
                    f"behind it is not a review, and the badge would be worthless if it were."))

    key = _profile_key(identity["wallet"], identity["orcid"])

    # Is the reviewer an author of the paper they are reviewing? This is the
    # rule that actually matters; "did you request it" was only ever a stand-in
    # for it. Answering it directly lets a legitimate reviewer through and
    # still refuses the case the stand-in existed to catch.
    # An unsolicited review names the paper directly; a commissioned one names
    # the request. Both end up needing the same authorship check.
    unsolicited = not payload.review_id
    info = ({"eval_hash": (payload.eval_hash or "").strip()} if unsolicited
            else review_owner_key(payload.review_id))
    if unsolicited and not info["eval_hash"]:
        raise HTTPException(status_code=400,
                            detail="Name the paper you are reviewing.")
    reviewer_is_author = None
    if info and info.get("eval_hash"):
        conn = get_db_connection()
        try:
            prow = conn.execute(
                "SELECT author_name, doi, title, user_id, author_openalex_id, piq_claimed_at "
                "FROM papers_assessment WHERE eval_hash = ?", (info["eval_hash"],)).fetchone()
        except sqlite3.Error:
            prow = None
        finally:
            conn.close()
        if prow:
            attr = verify_authorship(
                submitter_orcid=identity["orcid"], submitter_wallet=identity["wallet"],
                extracted_authors=prow[0] or "", doi=prow[1] or "", title=prow[2] or "")
            # Any of: the byline resolves to them, the row is filed under their
            # identity, or they claimed the escrow on it.
            owns_row = any(v and v in identities for v in (prow[3], prow[4]))
            reviewer_is_author = bool(attr.get("verified") or owns_row
                                      or (prow[5] and owns_row))

    # The operator may review their own paper. Everyone else may not.
    #
    # This exists so a single-participant deployment can produce its first
    # reviews at all. It is a real weakening of what the Peer-reviewed badge
    # certifies, so it is not left implicit: the review is stored with a
    # disclosure line naming it as an operator self-review, and the badge opens
    # onto that text. A reader who checks can always see what they are looking
    # at, which is the property that keeps the badge worth having.
    is_owner_self = bool(reviewer_is_author and auth.is_owner(identity))
    if reviewer_is_author and not is_owner_self:
        raise HTTPException(
            status_code=403,
            detail=("You cannot review your own paper. A Peer-reviewed badge you issued to "
                    "your own work would certify nothing — it needs a reviewer other than you."))

    comment = payload.comment
    if is_owner_self:
        comment = (comment.rstrip()
                   + "\n\n---\n*Operator self-review: this review was written by the person who "
                     "runs this deployment, about their own paper. It is disclosed here because a "
                     "Peer-reviewed badge normally means an independent researcher read the work, "
                     "and in this case it does not.*")
        add_log(f"OWNER SELF-REVIEW recorded on review {payload.review_id} "
                f"(disclosed in the review text).")

    if unsolicited:
        # Nobody commissioned this, so nothing is charged to the author and no
        # bounty is released — only the completion bonus is credited.
        result = add_unsolicited_review(info["eval_hash"], key, payload.verdict, comment)
    else:
        result = complete_review(payload.review_id, key, payload.verdict, comment,
                                 reviewer_is_author=reviewer_is_author,
                                 allow_self_review=is_owner_self)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    add_log(f"Review completed on {result['eval_hash'][:12]}… paid {result['paid']:.2f} piQ")
    bounty, bonus = result.get("bounty", 0.0), result.get("bonus", PEER_REVIEW_BONUS)
    return {"submitted": True, "paid": result["paid"],
            "bounty": bounty, "bonus": bonus,
            "eval_hash": result["eval_hash"],
            "balance": get_piq_balance(identity["wallet"], identity["orcid"])["balance"],
            "message": (f"Review recorded. {result['paid']:.2f} piQ credited to your balance"
                        + (f" ({bounty:.2f} set aside by the requester + {bonus:.2f} completion "
                           f"bonus)" if bounty else f" ({bonus:.2f} completion bonus)")
                        + (". The paper now carries a Peer-reviewed badge and can be published."
                           if not unsolicited else
                           ". Your review is added alongside the ones already there — the paper's "
                           "review count goes up, and its author was not charged for it."))}


@app.delete("/api/assessments/{file_hash}")
def remove_assessment(file_hash: str, request: Request,
                      wallet: str = Query(default=""),
                      orcid: str = Query(default="")):
    """Withdraw one paper from the corpus.

    Ownership is enforced inside the DELETE statement, not by a prior SELECT:
    evaluation hashes are visible in the public leaderboard, so a check-then-
    delete would let anyone who can read a hash remove someone else's paper.

    The Proof-of-Research block for the assessment is intentionally left in
    place — the chain is append-only and every block hashes its predecessor, so
    removing one would invalidate all of its successors. The paper leaves the
    corpus and the listings; the record that it was once assessed remains, which
    is the only outcome consistent with the ledger's integrity claim.
    """
    identity = require_identity(request, wallet, orcid)
    result = delete_assessment(
        file_hash,
        identities=_identity_values(identity["wallet"], identity["orcid"]),
        allow_any=auth.is_owner(identity),
    )
    if not result["deleted"]:
        raise HTTPException(status_code=404 if "not found" in result["reason"].lower() else 403,
                            detail=result["reason"])
    # The manuscript file goes with the paper. The ledger block is append-only
    # and stays; the PDF is not part of the chain, and leaving a downloadable
    # copy of a withdrawn paper on a public URL would make "remove" mean
    # considerably less than it says.
    file_removed = paper_store.delete_paper(file_hash)

    # `key` was never defined in this function — the deletion itself succeeded
    # and then this log line raised NameError, which the framework turned into
    # a 500. The caller saw "Internal server error" for an operation that had
    # already worked, which is the worst combination: the paper was gone and the
    # interface said the request failed.
    actor = _profile_key(identity["wallet"], identity["orcid"]) or "owner"
    add_log(f"Assessment {file_hash[:12]}… withdrawn by {actor[:16]}"
            + (" (stored manuscript deleted)" if file_removed else ""))
    return {"deleted": True, "file_deleted": file_removed,
            "message": ("Paper removed from the corpus and all listings"
                        + (", and the stored manuscript file was deleted" if file_removed else "")
                        + ". Its ledger block remains, because the Proof-of-Research chain is "
                          "append-only.")}


# ---------------------------------------------------------------------------
# Bug reports
# ---------------------------------------------------------------------------
class BugReport(BaseModel):
    message: str
    contact: str = ""
    page: str = ""
    # "bug" or "suggestion". Defaults to bug so an older client, which has no
    # such field, keeps behaving exactly as it did.
    kind: str = "bug"
    wallet: str = ""
    orcid: str = ""


@app.get("/api/bug-report/status")
def bug_report_status():
    """What the form should promise before the user types anything."""
    # Kinds travel with the status so the form and the store share one
    # vocabulary rather than each hardcoding its own.
    return {**bugreport.delivery_status(),
            "kinds": [{"id": k, "label": v} for k, v in CONTACT_KINDS.items()]}


@app.post("/api/bug-report")
def submit_bug_report(payload: BugReport, request: Request):
    """Store the report, then attempt email delivery in the background.

    Storing first is the point. Mail is the part that fails — expired
    credentials, a throttling provider, a host that blocks outbound 587 — and
    telling someone their report was sent when it was silently dropped is worse
    than not offering the button. The confirmation the user gets is a receipt
    for something already committed to the database.
    """
    client_ip = get_client_ip(request)
    check_rate_limit(client_ip, bucket="bug_report")

    problem = bugreport.validate(payload.message, payload.contact)
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    kind = payload.kind if payload.kind in CONTACT_KINDS else "bug"
    key = _profile_key(payload.wallet, payload.orcid)
    report = bugreport.normalise(
        message=payload.message, contact=payload.contact, identity=key,
        page=payload.page, user_agent=request.headers.get("user-agent", ""),
    )
    report["kind"] = kind
    # The raw IP is not stored: a bug report is not an abuse signal, and
    # keeping one would attach an identifier to a complaint for no operational
    # reason. The hash still supports rate limiting and duplicate detection.
    ip_hash = hashlib.sha256(f"bugreport:{client_ip}".encode()).hexdigest()[:32]

    try:
        report["id"] = store_bug_report(report, ip_hash=ip_hash)
    except Exception as e:
        logging.exception("Bug report could not be stored")
        raise HTTPException(status_code=500,
                            detail="The report could not be saved. Please try again.") from e

    add_log(f"Contact message #{report['id']} received ({kind}, "
            f"{len(report['message'])} chars).")
    bugreport.send_async(report, on_result=lambda rid, res: mark_bug_report_delivered(
        rid, res["sent"], res.get("error") or ""))

    emailed = bugreport.smtp_configured()
    return {
        "received": True,
        "id": report["id"],
        "emailed": emailed,
        "kind": kind,
        "message": (
            f"Thank you — {'suggestion' if kind == 'suggestion' else 'report'} "
            f"#{report['id']} was saved"
            + (" and is being emailed to the maintainer." if emailed
               else ". Email delivery is not configured on this deployment, so it is stored "
                    "on the server for the maintainer to read.")
        ),
    }


@app.get("/api/bug-report/list")
def bug_report_list(request: Request, wallet: str = Query(default=""),
                    limit: int = Query(default=100, ge=1, le=300)):
    """Owner-only. The reports that failed to send exist nowhere else."""
    require_owner(request, wallet)
    reports = list_bug_reports(limit=limit)
    return {"reports": reports,
            "undelivered": sum(1 for r in reports if not r["delivered"]),
            "count": len(reports)}


def _json_safe(value):
    """Fallback encoder for values json.dumps cannot serialise natively.

    Reached only for types the default encoder rejects. Everything the scoring
    pipeline can produce is converted to its nearest JSON equivalent rather
    than raising, because the alternative — an exception mid-stream — silently
    destroys a result the user has already been charged for.
    """
    # numpy scalars and arrays expose .item()/.tolist() without importing numpy
    # here, which keeps this working even if numpy is absent.
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        try:
            return value.item()
        except Exception:
            pass
    if hasattr(value, "tolist"):
        try:
            return value.tolist()
        except Exception:
            pass
    if isinstance(value, (set, frozenset, tuple)):
        return list(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    # Last resort: a string is always better than a dead stream.
    return str(value)


def _fmt_score(value) -> str:
    """Format a score for a log line without ever raising.

    This is not cosmetic. These log calls sit between the database write and
    the `yield` that delivers the result to the browser, so a TypeError here
    (score is None when a stage degrades) killed the generator *after* the
    paper was persisted: it appeared in the leaderboard and analytics, but the
    Assessment Results panel stayed empty and the user believed the run had
    silently failed. Logging must never be able to destroy a completed result.
    """
    try:
        return f"{float(value):.2f}"
    except (TypeError, ValueError):
        return "n/a"


def build_result_payload(res, filename, profile=None):
    consensus = res[19] if isinstance(res[19], dict) else {}
    scores = res[8] or {}

    def opt(idx, default):
        return res[idx] if len(res) > idx and res[idx] is not None else default

    payload = {
        "judge_metadata": consensus.get("_judge_metadata", {}),
        "integrity": opt(22, {}),
        "reference_audit": opt(23, {}),
        "authorship_signal": opt(24, {}),
        "topology_detail": opt(25, {}),
        "author_metrics": opt(26, {}),
        "emission": opt(27, {}),
        "criteria_detail": [
            {"id": f"C{i + 1}", "title": CRITERIA_TITLES.get(f"C{i + 1}", ""), "score": safe_float(v, 0.0)}
            for i, v in enumerate(scores.values())
        ],
        "mdar_score": res[14],
        "rrid_count": res[15],
        "explorer_url": get_sepolia_explorer_url(res[11], "tx"),
        "title": res[0],
        "author_name": clean_author_name(res[1]),
        "score": res[2],
        "logic_integrity": res[3],
        "classification": opt(4, {}),
        "criteria_breakdown": opt(5, []),
        "fields": opt(6, []),
        "subfields": opt(7, []),
        "scores_dict": res[8],
        "eval_hash": res[9],
        "piq": res[10],
        "tx_hash": res[11],
        "zk_proof": res[12],
        "repro_score": res[16],
        "filename": filename,
        "warnings": res[18],
        "consensus_raw": res[19],
        "evidence_report_text": res[20],
        "scilem_rating": res[21],
        "rubric_version": RUBRIC_VERSION,
        # True when this submission resolved to an assessment that already
        # existed — either the identical file, or the same work in a different
        # file. Surfaced so the interface can say "you already have this" and
        # link to the existing record, rather than presenting a stored result
        # as though it were fresh work.
        "duplicate": bool(res[17]) if len(res) > 17 else False,
    }

    # Reception diagnostic: why this work is or isn't landing. Deterministic
    # and derived entirely from signals already in the payload, so it adds no
    # latency and no provider cost. Wrapped because a diagnostic failure must
    # never cost the user the assessment they just paid for.
    try:
        payload["diagnostics"] = diagnostics.build_report(payload, profile)
    except Exception as e:
        logging.warning("Diagnostic report failed for %s: %s", payload.get("eval_hash"), e)
        payload["diagnostics"] = {"available": False, "reason": "Diagnostic unavailable."}
    return payload


def retrieve_manuscript_bytes(doi: str = "", pdf_url: str = "", candidates: List[str] = None):
    """Resolve a manuscript to PDF bytes, trying every known source.

    Returns ``(pdf_bytes, attempts)`` where `attempts` records what was tried
    and why each failed. Previously this returned only bytes-or-None, so a
    discovery failure surfaced in the UI as an unexplained "could not
    retrieve" with no way to tell a paywall from a transient network error.

    Sources are tried most-direct first: known PDF URLs, then DOI metadata,
    then Semantic Scholar, then a CORE full-text fallback wrapped into a
    synthetic PDF.
    """
    doi = normalize_doi(doi or "")
    attempts = []
    urls = [u for u in ([pdf_url] + list(candidates or [])) if u]

    for url in urls[:6]:
        try:
            data = download_pdf(url)
            if data:
                attempts.append({"source": url[:120], "result": "ok"})
                return data, attempts
            attempts.append({"source": url[:120], "result": "not a retrievable PDF"})
        except Exception as e:
            attempts.append({"source": url[:120], "result": f"error: {e}"[:120]})

    if doi:
        try:
            metadata = fetch_doi_metadata(doi)
            if metadata and metadata.get("pdf_url"):
                data = download_pdf(metadata["pdf_url"])
                if data:
                    attempts.append({"source": "Unpaywall", "result": "ok"})
                    return data, attempts
            attempts.append({"source": "Unpaywall", "result": "no open-access PDF listed"})
        except Exception as e:
            attempts.append({"source": "Unpaywall", "result": f"error: {e}"[:120]})

        try:
            s2 = fetch_semantic_scholar_pdf(doi)
            data = download_pdf(s2) if s2 else None
            if data:
                attempts.append({"source": "Semantic Scholar", "result": "ok"})
                return data, attempts
            attempts.append({"source": "Semantic Scholar", "result": "no open-access PDF"})
        except Exception as e:
            attempts.append({"source": "Semantic Scholar", "result": f"error: {e}"[:120]})

        try:
            text = fetch_core_text_by_doi(doi)
            data = build_pdf_from_text(text) if text else None
            if data:
                attempts.append({"source": "CORE full text", "result": "ok (text-only)"})
                return data, attempts
            attempts.append({"source": "CORE full text", "result": "no full text indexed"})
        except Exception as e:
            attempts.append({"source": "CORE full text", "result": f"error: {e}"[:120]})

    add_log(f"Retrieval failed (doi={doi or 'none'}): {len(attempts)} source(s) tried")
    return None, attempts


def estimate_word_count(pdf_bytes: bytes) -> int:
    """Approximate word count without a full parse.

    Used only for pricing, so a cheap estimate is right: opening every page
    with PyMuPDF purely to set a fee would double the parsing cost of the
    thing being priced. Falls back to a byte-size heuristic if extraction is
    unavailable, and pricing floors at the minimum either way.
    """
    if not pdf_bytes:
        return 0
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            pages = min(doc.page_count, 6)
            sampled = sum(len(doc[i].get_text("text").split()) for i in range(pages))
            if pages == 0:
                return 0
            return int((sampled / pages) * doc.page_count)
        finally:
            doc.close()
    except Exception:
        # ~2.5KB of PDF per 100 words is a rough but serviceable fallback.
        return int(len(pdf_bytes) / 25)


def stream_assessment_progress(files: List[tuple], doi: Optional[str], include_doi: bool,
                            discover_papers: List[dict], user_id: str, book_address: str,
                            fee_wallet: str = "", fee_orcid: str = "", charge_fees: bool = False,
                            active_fee: float = PIQ_PROCESSING_FEE,
                            researcher_profile: Optional[dict] = None):
    """Generator yielding NDJSON status/result lines, mirroring the old
    st.status(...) 'Analyzing X...' live progress box.

    Each paper is billed the flat PIQ_PROCESSING_FEE at the moment it is
    about to be processed. Billing per-paper rather than per-request means a
    batch that runs out of balance halfway through stops cleanly, and a paper
    whose source could never be retrieved is refunded rather than charged for
    work that was never done.
    """

    def emit_result(item, label):
        """Serialise one result, degrading to a visible error rather than
        killing the stream.

        Belt and braces alongside `_json_safe`: any future field that cannot be
        encoded costs the user *this* result's presentation, not the whole run
        and not the results already delivered."""
        try:
            return line({"type": "result", "item": item})
        except Exception as e:
            logging.exception("Result serialisation failed for %s", label)
            return line({"type": "result_error", "label": str(label),
                         "message": ("This paper was assessed and saved to the ledger, but its "
                                     "result could not be displayed. It appears in Analytics.")})

    def line(obj):
        # json.dumps with the default encoder raises TypeError on numpy scalars
        # (float32, int64, bool_), arrays, sets, datetimes and Decimals — all of
        # which reach this payload from the scoring path, which is numpy-based.
        #
        # This generator has no exception handling around it, so that TypeError
        # killed the stream *after* the paper was written to the database: the
        # result appeared in the leaderboard and analytics while the Assessment
        # Results panel stayed empty, with nothing in the browser to indicate
        # anything had gone wrong. Serialisation must never be able to discard a
        # completed assessment.
        return json.dumps(obj, default=_json_safe) + "\n"


    # --- Keeping the stream alive -----------------------------------------
    #
    # Processing one paper is a single blocking call that can run for minutes:
    # extraction, then the model panel, then enrichment. The generator emits
    # "Analyzing X..." immediately before it and nothing at all until it
    # returns, so for that whole window the response body is silent.
    #
    # A silent body is what gets a streaming connection dropped. Proxies, load
    # balancers and browsers all reap connections that have sent nothing for a
    # while, and when that happens the client sees a bare "network error" mid-
    # run while the server carries on none the wiser — which is exactly the
    # failure being reported: a long "Analyzing…", then a lost connection, and
    # nothing in the server log because the server did not fail.
    #
    # So the work runs on a thread and the generator emits a heartbeat every
    # few seconds while it waits. Bytes keep flowing, nothing along the path
    # sees an idle connection, and the client gets an honest elapsed time
    # instead of a frozen line.
    def run_with_heartbeat(label, fn, *args, **kwargs):
        """Run `fn` off-thread, yielding heartbeat lines until it finishes.

        Yields (payload_line_or_None, result_or_MISSING) pairs: the caller
        forwards the lines and takes the result from the final pair.
        """
        started = time.time()
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            future = pool.submit(fn, *args, **kwargs)
            while True:
                try:
                    yield None, future.result(timeout=HEARTBEAT_SECONDS)
                    return
                except concurrent.futures.TimeoutError:
                    yield line({
                        "type": "heartbeat",
                        "label": label,
                        "elapsed": int(time.time() - started),
                        "message": f"Still analyzing {label}…",
                    }), None
        finally:
            # wait=False: the result has already been taken, or the client has
            # gone and nothing is waiting for it.
            pool.shutdown(wait=False)

    # A missing profile is normal (anonymous users have none); it only frames
    # the wording of the diagnostic summary and never changes the findings.
    researcher_profile = researcher_profile or {}

    fee = active_fee

    def refund_if_duplicate(item, label):
        """Return the fee when a submission turned out to be a paper we have.

        The fee buys an assessment. A duplicate consumes no model calls, mints
        nothing and creates no new record, so charging for it would be charging
        for work that did not happen — and the result panel says in plain words
        that no fee was taken, which has to be true rather than reassuring.
        """
        if not item.get("duplicate") or not charge_fees or not item.get("fee_charged"):
            return
        amount = float(item.get("fee_charged") or 0.0)
        if amount <= 0:
            return
        if refund_piq_fee(amount, fee_wallet, fee_orcid,
                          eval_hash=item.get("eval_hash", ""),
                          reason=f"Duplicate submission — {str(label)[:100]}"):
            item["fee_charged"] = 0.0
            bal = get_piq_balance(fee_wallet, fee_orcid)
            yield line({"type": "fee", "amount": 0.0, "balance": bal["balance"],
                        "message": (f"Already assessed — {amount:.4f} piQ returned. "
                                    f"Balance: {bal['balance']:.2f} piQ.")})
        else:
            logging.warning("Duplicate refund failed for %s", item.get("eval_hash", "")[:12])

    def take_fee(label: str, word_count: int = 0):
        """Returns (ok, ndjson_lines_to_emit).

        Priced per document: a thesis costs more to process than a four-page
        note, and charging both the same was neither honest nor sustainable.
        The floor keeps a trivial submission from being free.
        """
        nonlocal fee
        pricing = compute_document_fee(word_count, count_assessed_papers(), PIQ_PROCESSING_FEE)
        fee = pricing["fee"]
        if not charge_fees or fee <= 0:
            return True, []
        if charge_piq_fee(fee, fee_wallet, fee_orcid, reason=f"Processing fee — {label[:120]}"):
            bal = get_piq_balance(fee_wallet, fee_orcid)
            return True, [line({
                "type": "fee",
                "message": (f"Charged {fee:.4f} piQ ({pricing['size_band']}). "
                            f"Remaining balance: {bal['balance']:.2f} piQ."),
                "amount": fee, "balance": bal["balance"], "pricing": pricing,
            })]
        bal = get_piq_balance(fee_wallet, fee_orcid)
        return False, [line({
            "type": "fee_error",
            "message": (
                f"Insufficient piQ balance to process '{label[:80]}'. "
                f"This paper costs {fee:.4f} piQ ({pricing['size_band']}); "
                f"your balance is {bal['balance']:.2f} piQ."
            ),
            "balance": bal["balance"], "required": fee,
        })]

    def reward_notice(item, label):
        """One explicit line per paper about what it earned, and why.

        The result card showed "piQ 0.00" and nothing else. Zero is a valid
        outcome — unverified authorship, or a score below the minting
        threshold — but presented as a bare number it is indistinguishable
        from a bug, and the explanation the pipeline had already computed
        (including the instructions for fixing it) was sitting unread in the
        payload. Earning nothing has to be as legible as earning something.
        """
        emission_rec = item.get("emission") or {}
        attribution = emission_rec.get("attribution") or {}
        minted = safe_float(item.get("piq"), 0.0)

        if minted > 0:
            return [line({
                "type": "reward",
                "outcome": "minted",
                "amount": minted,
                "tier": attribution.get("tier"),
                "message": (
                    f"{minted:.2f} piQ minted for '{str(label)[:60]}'. "
                    + (attribution.get("reason") or "")
                ),
            })]

        # Nothing minted. Say which of the two reasons applies.
        if not attribution.get("verified"):
            return [line({
                "type": "reward",
                "outcome": "withheld_authorship",
                "amount": 0.0,
                "message": (attribution.get("reason")
                            or "Authorship could not be verified, so no piQ was minted."),
                "how_to_fix": attribution.get("how_to_verify"),
            })]

        return [line({
            "type": "reward",
            "outcome": "below_threshold",
            "amount": 0.0,
            "message": (emission_rec.get("reason")
                        or "This paper did not meet the minting threshold, so no piQ was minted."),
        })]

    def award_curation(item, label):
        """Credit a curation reward when the submitter is not the author.

        Runs only when authorship verification came back negative — that is
        precisely the case where full emission is withheld, and where the
        submitter has still done real work by putting a paper through the
        pipeline. Returns the ndjson lines to emit, which is empty when
        nothing is awarded.
        """
        if not (fee_wallet or fee_orcid):
            item["curation"] = {
                "awarded": 0.0, "eligible": False,
                "reason": ("Curation rewards are credited to an account. Sign in with a wallet or "
                           "ORCID before running the pipeline and submitting other people's "
                           "papers earns piQ."),
            }
            return []
        emission_rec = item.get("emission") or {}
        attribution = emission_rec.get("attribution") or {}
        # Authors get the full on-chain emission; this path is only for the
        # unverified case, so the two rewards can never both apply.
        if attribution.get("verified"):
            return []

        stats = get_curation_stats(fee_wallet, fee_orcid)
        reward = compute_curation_reward(
            pix_score=safe_float(item.get("score"), 0.0),
            logic_integrity=safe_float(item.get("logic_integrity"), 0.0),
            total_papers=count_assessed_papers(),
            curation_count=stats["count"],
            curation_earned=stats["earned"],
        )
        # Every outcome is reported, including the ones that pay nothing.
        # Previously an ineligible reward wrote its reason into the payload and
        # emitted no line, so from the browser a curation reward that correctly
        # declined to pay and one that silently failed looked identical — which
        # is why "the curation reward doesn't work" was indistinguishable from
        # "the curation reward decided not to pay this time".
        if not reward.get("eligible"):
            item["curation"] = reward
            return [line({
                "type": "curation",
                "amount": 0.0,
                "awarded": False,
                "balance": get_piq_balance(fee_wallet, fee_orcid)["balance"],
                "message": reward.get("reason") or "No curation reward for this paper.",
            })]

        eval_hash = item.get("eval_hash", "")
        already = bool(eval_hash) and get_curation_award_for(
            fee_wallet, fee_orcid, eval_hash)
        credited = credit_curation_reward(
            reward["awarded"], fee_wallet, fee_orcid,
            eval_hash=eval_hash, note=str(label)[:80],
        )
        if not credited:
            # Two different failures used to share one message. "You already
            # earned this" is a correct, final answer; a database error is a
            # bug the user should be told about rather than have explained away
            # as something they did.
            reason = ("You have already earned a curation reward for this manuscript. "
                      "Resubmitting a paper does not earn it twice."
                      if already else
                      "The curation reward could not be credited to your account. This is a "
                      "fault on our side, not a rule — please report it.")
            reward = {**reward, "awarded": 0.0, "eligible": False, "reason": reason}
            item["curation"] = reward
            return [line({
                "type": "curation", "amount": 0.0, "awarded": False,
                "balance": get_piq_balance(fee_wallet, fee_orcid)["balance"],
                "message": reason,
            })]

        item["curation"] = reward
        bal = get_piq_balance(fee_wallet, fee_orcid)
        add_log(f"Curation reward {reward['awarded']:.4f} piQ for {str(label)[:60]}")
        return [line({
            "type": "curation",
            "amount": reward["awarded"],
            "awarded": True,
            "balance": bal["balance"],
            "message": reward["reason"],
        })]

    # No refund path is needed any more: a paper is priced and charged only
    # after its bytes have been retrieved, so a retrieval failure never
    # incurred a fee in the first place. Refunding something never charged was
    # the previous design and was one accounting step more than necessary.

    yield line({"type": "status", "message": "Initializing assessment pipeline..."})
    if charge_fees and fee > 0:
        bal = get_piq_balance(fee_wallet, fee_orcid)
        yield line({"type": "status", "message":
                    f"Processing fee: {fee:.2f} piQ per paper. Available balance: {bal['balance']:.2f} piQ."})

    if include_doi and doi and doi.strip():
        doi = doi.strip()
        yield line({"type": "status", "message": f"Resolving DOI: {doi}..."})
        pdf_bytes, attempts = retrieve_manuscript_bytes(doi=doi)

        if pdf_bytes:
            # Retained exactly as an upload is. Only uploaded files used to be
            # stored, so a paper fetched by DOI could never be LLM-reviewed,
            # published, or served to a reader — three features silently
            # unavailable depending on how the paper happened to arrive. The
            # bytes are here and identical in kind; the only reason they were
            # not kept is that this path was written separately from the
            # upload path. Failures are swallowed inside store_paper: losing
            # the file must never fail a run that has been charged for.
            paper_store.store_paper(pdf_bytes)
            # Priced after retrieval so the fee reflects the actual document,
            # and so nothing is charged for a paper that could not be fetched.
            ok, msgs = take_fee(f"DOI {doi}", estimate_word_count(pdf_bytes))
            for m in msgs:
                yield m
            if not ok:
                yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
                return
            yield line({"type": "status", "message": "Assessing document..."})
            res = None
            for hb, out in run_with_heartbeat(
                    f"DOI {doi}", process_single_pdf, pdf_bytes, f"DOI_{doi}.pdf", "",
                    user_id, book_address, provided_doi=doi):
                if hb:
                    yield hb
                else:
                    res = out
            if res:
                item = build_result_payload(res, f"DOI_{doi}.pdf", profile=researcher_profile)
                item["fee_charged"] = fee if charge_fees else 0.0
                for m in refund_if_duplicate(item, f"DOI {doi}"):
                    yield m
                for m in award_curation(item, f"DOI {doi}"):
                    yield m
                for m in reward_notice(item, f"DOI {doi}"):
                    yield m
                add_log(f"Assessed DOI {doi}: score {_fmt_score(item.get('score'))}")
                yield emit_result(item, f"DOI {doi}")
        else:
            yield line({"type": "download_error", "doi": doi,
                        "url": f"https://doi.org/{doi}", "attempts": attempts})

    for paper in discover_papers:
        title = (paper.get("title") or "Untitled").strip()
        p_doi = (paper.get("doi") or "").strip()
        pdf_url = (paper.get("pdf_url") or "").strip()

        yield line({"type": "status", "message": f"Retrieving open-access paper: {title[:80]}..."})
        pdf_bytes, attempts = retrieve_manuscript_bytes(
            doi=p_doi, pdf_url=pdf_url, candidates=paper.get("pdf_candidates"))

        fname = f"Discovered_{p_doi or title[:60]}.pdf"
        if pdf_bytes:
            # Same reasoning as the DOI path above: an auto-discovered paper is
            # a retrieved PDF like any other, and keeping it is what makes the
            # assessment reviewable and publishable later.
            paper_store.store_paper(pdf_bytes)
            ok, msgs = take_fee(title, estimate_word_count(pdf_bytes))
            for m in msgs:
                yield m
            if not ok:
                yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
                return
            yield line({"type": "status", "message": f"Assessing: {title[:80]}..."})
            res = None
            for hb, out in run_with_heartbeat(
                    fname, process_single_pdf, pdf_bytes, fname, "", user_id,
                    book_address, provided_doi=p_doi or "None"):
                if hb:
                    yield hb
                else:
                    res = out
            if res:
                item = build_result_payload(res, fname, profile=researcher_profile)
                item["fee_charged"] = fee if charge_fees else 0.0
                for m in refund_if_duplicate(item, title):
                    yield m
                for m in award_curation(item, title):
                    yield m
                for m in reward_notice(item, title):
                    yield m
                add_log(f"Assessed discovered paper '{title[:60]}': score {_fmt_score(item.get('score'))}")
                yield emit_result(item, fname)
        else:
            yield line({"type": "download_error", "doi": p_doi or title,
                        "title": title,
                        "url": f"https://doi.org/{p_doi}" if p_doi else "",
                        "attempts": attempts})

    for fname, raw_bytes in files:
        ok, msgs = take_fee(fname, estimate_word_count(raw_bytes))
        for m in msgs:
            yield m
        if not ok:
            yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
            return

        yield line({"type": "status", "message": f"Analyzing {fname}..."})
        res = None
        for hb, out in run_with_heartbeat(
                fname, process_single_pdf, raw_bytes, fname, "", user_id, book_address):
            if hb:
                yield hb
            else:
                res = out
        if res:
            item = build_result_payload(res, fname, profile=researcher_profile)
            item["fee_charged"] = fee if charge_fees else 0.0
            for m in refund_if_duplicate(item, fname):
                yield m
            for m in award_curation(item, fname):
                yield m
            for m in reward_notice(item, fname):
                yield m
            add_log(f"Assessed {fname}: score {_fmt_score(item.get('score'))}")
            yield emit_result(item, fname)

    yield line({"type": "done", "message": "Complete."})


# Seconds between stream heartbeats while one paper is being processed.
# Short enough to stay under any reasonable proxy idle timeout, long
# enough that it costs nothing.
HEARTBEAT_SECONDS = int(os.getenv("STREAM_HEARTBEAT_SECONDS", "10"))

# Ceiling on verifying a journal DOI against the registries. Generous
# enough for a slow-but-working Crossref, short enough that an
# unreachable one is reported rather than waited out.
JOURNAL_CHECK_BUDGET_SECONDS = int(os.getenv("JOURNAL_CHECK_BUDGET_SECONDS", "25"))

MAX_DISCOVERY_BATCH = 10


@app.post("/api/assess/stream")
async def assess_stream(
    request: Request,
    files: List[UploadFile] = File(default=[]),
    doi: str = Form(default=""),
    include_doi: bool = Form(default=False),
    discover_papers: str = Form(default=""),  # JSON-encoded array of {title, doi, pdf_url}
    wallet: str = Form(default=""),
    orcid: str = Form(default=""),
    pow_challenge_id: str = Form(default=""),
    pow_issued_at: str = Form(default="0"),
    pow_difficulty: str = Form(default="0"),
    pow_signature: str = Form(default=""),
    pow_solution: str = Form(default=""),
    turnstile_token: str = Form(default=""),
):
    client_ip = get_client_ip(request)
    check_rate_limit(client_ip, bucket="assess")

    # File the paper under the PROVEN identity, not the one the browser claimed.
    #
    # This is why a completed assessment never reached "Your assessments". The
    # pipeline stored `user_id` from the raw posted wallet/orcid, while the
    # history endpoint reads back under the identity the SESSION proves — so
    # the moment those two disagreed, the paper was filed in a bucket the
    # history query could not see. And they disagree routinely: a browser that
    # remembers an ORCID in localStorage posts it alongside a wallet-only
    # session, `user_id` becomes that unproven ORCID, and history looks for the
    # wallet. The assessment ran, was charged for, and vanished.
    #
    # It is the same fix already applied to arcade rewards, for the same
    # reason: whatever writes a record and whatever reads it back have to agree
    # on who you are, and only the signed session actually knows.
    identity = auth.identity_from_request(request, wallet, orcid)
    if identity["verified"] and (identity["wallet"] or identity["orcid"]):
        wallet = identity["wallet"] or ""
        orcid = identity["orcid"] or ""

    has_web3 = bool(wallet and w3.is_address(wallet))
    user_id = orcid if orcid else (wallet if has_web3 else "Anonymous")
    book_address = w3.to_checksum_address(wallet) if has_web3 else "0x0000000000000000000000000000000000000000"

    # Loaded once per submission rather than per paper: it frames the wording
    # of the diagnostic summary, and re-reading it for every paper in a batch
    # would be a query per document for a value that cannot change mid-run.
    # A missing profile is normal (anonymous users have none) and simply
    # leaves the diagnostic unframed — it never changes the findings.
    try:
        researcher_profile = get_researcher_profile(_profile_key(wallet, orcid))
    except Exception as e:
        logging.debug("Profile lookup failed, continuing without it: %s", e)
        researcher_profile = {}

    discover_list = []
    if discover_papers.strip():
        try:
            parsed = json.loads(discover_papers)
            if not isinstance(parsed, list):
                raise ValueError("discover_papers must be a JSON array")
            if len(parsed) > MAX_DISCOVERY_BATCH:
                raise HTTPException(status_code=400, detail=f"Too many auto-discovered papers selected (max {MAX_DISCOVERY_BATCH} per run).")
            for p in parsed:
                if not isinstance(p, dict):
                    continue
                discover_list.append({
                    "title": str(p.get("title", ""))[:300],
                    "doi": str(p.get("doi", ""))[:200],
                    "pdf_url": str(p.get("pdf_url", ""))[:1000],
                    "pdf_candidates": [str(u)[:1000] for u in (p.get("pdf_candidates") or [])][:5],
                })
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="discover_papers must be valid JSON.")

    # Server-side free-trial gate — the browser's localStorage counter is a
    # convenience for the UI, not a security boundary (a user can clear it
    # trivially). This is the authoritative check.
    free_trial_active = not has_web3 and not orcid

    max_bytes = int(MAX_UPLOAD_MB * 1024 * 1024)
    file_payload, fingerprints = [], []
    for f in files:
        if f.content_type and f.content_type not in ("application/pdf", "application/octet-stream"):
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is not a PDF file.")
        raw = await f.read()
        # Structural validation before any paid inference: a renamed .txt or a
        # truncated download should be rejected here, not after it has consumed
        # LLM credits.
        valid, why = abuse_guard.validate_upload(f.filename, raw, max_bytes)
        if not valid:
            raise HTTPException(status_code=400, detail=why)
        file_payload.append((f.filename, raw))
        fingerprints.append(abuse_guard.document_fingerprint(raw))
        # Retained so a published assessment can serve the manuscript it is an
        # assessment OF. Keyed by sha256 of the bytes, which is the same value
        # brain.py uses for eval_hash — so the file is addressable from the
        # assessment with no extra bookkeeping. Storage failures are swallowed
        # inside store_paper: losing the file must never fail a paid run.
        paper_store.store_paper(raw)

    # DOI and discovery submissions are fingerprinted by identifier, since
    # their bytes are not available until retrieval.
    if include_doi and doi.strip():
        fingerprints.append(abuse_guard.document_fingerprint(doi.strip().lower().encode()))
    for entry in discover_list:
        key = (entry.get("doi") or entry.get("title") or "").strip().lower()
        if key:
            fingerprints.append(abuse_guard.document_fingerprint(key.encode()))

    # Layered abuse controls. Velocity limits apply to everyone; free-tier
    # metering and automation heuristics apply only to unidentified visitors,
    # since identified users pay in piQ and that is its own control.
    # Proof of work, for anonymous submissions only. Identified users have
    # already paid in piQ, which is a stronger control than any puzzle.
    if REQUIRE_PROOF_OF_WORK and not (has_web3 or orcid):
        ok, why = pow_challenge.verify_solution(
            ip=client_ip, challenge=pow_challenge_id, issued_at=pow_issued_at,
            difficulty=pow_difficulty, signature=pow_signature, solution=pow_solution,
        )
        if not ok:
            raise HTTPException(status_code=428, detail=f"Verification required: {why}")
        ok, why = pow_challenge.verify_turnstile(turnstile_token, client_ip)
        if not ok:
            raise HTTPException(status_code=428, detail=why)

    verdict = abuse_guard.evaluate_request(
        ip=client_ip,
        headers={k.lower(): v for k, v in request.headers.items()},
        documents_used=get_free_evals_used(client_ip),
        fingerprints=fingerprints,
        has_identity=bool(has_web3 or orcid),
        # Bonus no longer extends the trial; passed as 0 so the parameter stays
        # in the signature for any caller that still supplies one.
        bonus=0,
    )
    if not verdict["allowed"]:
        add_log(f"Blocked submission from {client_ip}: {verdict['reason'][:100]}")
        raise HTTPException(status_code=verdict["code"], detail=verdict["reason"])

    paper_count = len(file_payload) + len(discover_list) + (1 if (include_doi and doi.strip()) else 0)

    # piQ processing fee. Identified users pay PIQ_PROCESSING_FEE per paper
    # out of their earned balance; users still on the free trial don't, since
    # they have no balance yet and the trial exists precisely to let them earn
    # their first piQ.
    fee_wallet, fee_orcid = normalize_identity(wallet, orcid)
    active_fee = resolve_active_fee()
    charge_fees = bool((fee_wallet or fee_orcid) and not free_trial_active and active_fee > 0)

    if charge_fees and paper_count:
        bal = get_piq_balance(fee_wallet, fee_orcid)
        required = round(active_fee * paper_count, 4)
        if bal["balance"] + 1e-9 < active_fee:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Insufficient piQ balance. Processing costs {active_fee:.4f} piQ per paper "
                    f"and your balance is {bal['balance']:.2f} piQ. Earn piQ by having your own "
                    f"manuscripts assessed."
                ),
            )
        if bal["balance"] + 1e-9 < required:
            affordable = int(bal["balance"] // active_fee)
            add_log(
                f"Partial batch: balance {bal['balance']:.2f} piQ covers {affordable}/{paper_count} papers."
            )

    if free_trial_active and paper_count:
        # Metered per distinct document, so a resubmission costs no allowance.
        abuse_guard.register_documents(client_ip, fingerprints)
        for _ in range(max(1, len(fingerprints))):
            increment_free_evals_used(client_ip)

    # Assessing resets the arcade difficulty ramp. This is the exchange the
    # ramp exists to create: the game hands out assessment allowance, so the
    # way to make it winnable again is to spend that allowance on an
    # assessment. Reset happens at submission rather than on success, because
    # the user has committed the paper by this point and a provider failure
    # downstream is not their fault.
    if paper_count:
        try:
            arcade_player_key, _ = _arcade_key(request, wallet, orcid)
            if reset_arcade_difficulty(arcade_player_key):
                add_log("Arcade difficulty reset to level 0 after an assessment.")
        except Exception as e:
            logging.debug("Arcade difficulty reset skipped: %s", e)

    def gen():
        """Wraps the assessment stream so a failure is *visible*.

        This generator previously had no exception handling anywhere in it.
        Because assessment writes to the database before it yields the result,
        any exception raised after that write — a serialisation failure, a bad
        index, a provider client blowing up — ended the HTTP stream silently.
        The browser saw a connection that simply stopped: no error, no result,
        while the paper sat in the leaderboard. Every diagnosis of that
        behaviour was guesswork because nothing anywhere recorded the cause.

        Now the traceback is logged server-side with a short reference, and a
        terminal `stream_error` line is emitted so the UI can say that the run
        failed and quote the reference, instead of appearing to hang.
        """
        try:
            yield from stream_assessment_progress(
                file_payload, doi, include_doi, discover_list, user_id, book_address,
                fee_wallet=fee_wallet, fee_orcid=fee_orcid, charge_fees=charge_fees,
                active_fee=active_fee, researcher_profile=researcher_profile,
            )
        except Exception as exc:
            ref = uuid.uuid4().hex[:8]
            logging.exception("Assessment stream failed [ref %s]", ref)
            add_log(f"Assessment stream failed [ref {ref}]: {type(exc).__name__}: {exc}")
            detail = f"{type(exc).__name__}: {exc}" if ENVIRONMENT != "production" else ""
            try:
                yield json.dumps({
                    "type": "stream_error",
                    "reference": ref,
                    "detail": detail,
                    "message": ("The assessment stopped unexpectedly. Any paper that finished "
                                "before this point was saved and appears in Analytics. "
                                f"Server log reference: {ref}."),
                }, default=_json_safe) + "\n"
            except Exception:
                pass

    return StreamingResponse(gen(), media_type="application/x-ndjson")


# ---------------------------------------------------------------------------
# 3b. AUTO-DISCOVERY — search open-access literature (OpenAlex) to feed
#     straight into the assessment pipeline above
# ---------------------------------------------------------------------------
@app.get("/api/discover/hot-topics")
def discover_hot_topics():
    """Currently active research topics, pulled live from OpenAlex.

    The previous implementation returned a hand-written list frozen at
    authoring time, which would have silently aged into a set of stale
    suggestions. HOT_TOPICS survives only as a last-resort seed for when
    OpenAlex is unreachable, and the response says which source was used so
    the UI never implies staleness is freshness.
    """
    # A fresh draw per request, from both sources.
    #
    # This row was static: the same ten chips in the same order on every visit,
    # which teaches a returning user that the suggestions are decoration and
    # stops them looking. Sampling means the row is worth a glance each time,
    # and it widens the corpus — a topic nobody is ever shown is a topic nobody
    # assesses.
    #
    # OpenAlex first when reachable, and its picks are shuffled too: "most
    # active concepts" is a stable ranking, so taking the top ten produced the
    # same list every time even though the source was live.
    result = fetch_active_research_topics(limit=30)
    live = list(result.get("topics") or [])
    if live:
        random.shuffle(live)
        return {**result, "topics": live[:10], "sampled": True}

    seeds = list(HOT_TOPICS)
    random.shuffle(seeds)
    return {"topics": seeds[:10], "source": "fallback-seed", "cached": False, "sampled": True}


@app.get("/api/discover/search")
def discover_search(
    request: Request,
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(default=15, ge=1, le=30),
):
    check_rate_limit(get_client_ip(request), bucket="discover")
    error = ""
    try:
        results, error = search_scholarly_works(q, limit=limit)
    except Exception as e:                                       # noqa: BLE001
        add_log(f"Discovery search error: {e}")
        results, error = [], f"The search could not be completed ({type(e).__name__})."
    if error:
        add_log(f"Discovery search for {q!r}: {error}")
    # `error` is carried to the client rather than folded into an empty list.
    # An empty result and an unreachable provider are different facts, and the
    # interface cannot tell a user which one they are looking at unless the
    # server says so.
    return {"results": results, "query": q, "error": error}


class TextAssessRequest(BaseModel):
    paper_text: str


@app.post("/api/assess/text")
def assess_text(req: TextAssessRequest, request: Request):
    """Kept for parity with the previous stub API: assess raw pasted text
    instead of an uploaded PDF, by wrapping it in a virtual PDF."""
    check_rate_limit(get_client_ip(request), bucket="assess")
    if not req.paper_text.strip():
        raise HTTPException(status_code=400, detail="Paper text cannot be empty.")
    if len(req.paper_text) > 500_000:
        raise HTTPException(status_code=413, detail="Paper text is too long (max 500,000 characters).")
    pdf_bytes = build_pdf_from_text(req.paper_text, title="Pasted Manuscript Text")
    if not pdf_bytes:
        raise HTTPException(status_code=500, detail="Could not convert text into a processable document.")
    res = process_single_pdf(pdf_bytes, "Pasted_Text.pdf", "", "Anonymous")
    if not res:
        raise HTTPException(status_code=500, detail="Assessment failed.")
    item = build_result_payload(res, "Pasted_Text.pdf")
    add_log(f"Assessed pasted text: score {_fmt_score(item.get('score'))}")
    return item


# ---------------------------------------------------------------------------
# 4. DEFENSE STRATEGY
# ---------------------------------------------------------------------------
class DefenseRequest(BaseModel):
    # Bounded on the way in. The handler is deterministic and cheap, but an
    # unbounded dict is still free server memory for anyone who asks, and
    # validating shape at the edge is cheaper than defending it everywhere.
    scores: Dict[str, float] = Field(default_factory=dict, max_length=64)


@app.post("/api/defense-strategy")
def defense_strategy(req: DefenseRequest):
    return {"strategy": generate_rebuttal_strategy(req.scores)}


# ---------------------------------------------------------------------------
# 5. SCILEM ASSISTANT
# ---------------------------------------------------------------------------
class ScilemChatRequest(BaseModel):
    prompt: str
    wallet: Optional[str] = ""
    orcid: Optional[str] = ""


@app.get("/api/scilem/status")
def scilem_status():
    """Capabilities of the assistant, so the UI can describe it honestly.

    The badge previously read "Ready" whenever the assistant was enabled, while
    the assistant itself would then explain that it could only answer a narrow
    set of questions. Both statements were true and together they read as a
    contradiction, because "Ready" was answering a different question from the
    one the user was asking. The status now names the actual mode, and says in
    one sentence what that mode can and cannot do — so the badge and the prose
    agree.

    `cloud_phrasing` also checks every provider key rather than only Groq and
    OpenRouter; a deployment configured with, say, only a Mistral key had
    working phrasing but reported none.
    """
    has_phrasing = bool(GROQ_API_KEY or OR_API_KEY or GEMINI_API_KEY
                        or CEREBRAS_API_KEY or MISTRAL_API_KEY or DEEPSEEK_API_KEY
                        or TOGETHER_API_KEY or GITHUB_MODELS_TOKEN)
    if not ENABLE_SCILEM_ASSISTANT:
        mode, label, notice = "disabled", "Off", SCILEM_DISABLED_NOTICE
    elif SCILEM_MODE == "limited":
        # Operator-declared, not inferred. The deployment may well have
        # provider keys configured and still not have the memory to use them
        # comfortably, so this overrides the capability sniff rather than
        # being overridden by it.
        mode, label, notice = "limited", "Limited", SCILEM_LIMITED_NOTICE
    elif has_phrasing:
        mode, label = "grounded+phrasing", "Ready"
        notice = None
    else:
        mode, label = "grounded", "Grounded"
        notice = (
            "No language-model provider is configured, so open-ended questions cannot be "
            "rephrased or reasoned about. Answers come from live deployment state and the "
            "built-in knowledge base only — narrower, but never invented."
        )
    return {
        "enabled": ENABLE_SCILEM_ASSISTANT,
        "mode": mode,
        "badge": label,
        "local_model": ENABLE_SCILEM_LOCAL_MODEL,
        "cloud_phrasing": has_phrasing,
        "capabilities": scilem.CAPABILITIES,
        "notice": notice,
    }


@app.get("/api/scilem/learning")
def scilem_learning_status(request: Request, wallet: str = Query(default=""),
                           observations: int = Query(default=0, ge=0, le=200)):
    """What SciLM (siM) has learned, and from what.

    Public by design. This model contributes to a research-assessment score,
    so how it is weighted, how far it has drifted from its authored defaults
    and how well calibrated it currently is are all things a reader is
    entitled to check rather than take on trust.
    """
    payload = scilem_learning.status()
    if observations:
        # The raw observation log is owner-only: it pairs evaluation hashes
        # with panel verdicts, which is more detail than a public endpoint
        # should join up.
        if auth.is_owner(auth.identity_from_request(request, wallet)):
            payload["observations_log"] = list_scilem_observations(limit=observations)
        else:
            payload["observations_log"] = []
            payload["observations_note"] = "The raw observation log is restricted to the owner wallet."
    return payload


class ScilemFeedback(BaseModel):
    eval_hash: str
    corrected_score: float
    wallet: str = ""
    orcid: str = ""


@app.post("/api/scilem/feedback")
def scilem_feedback(payload: ScilemFeedback, request: Request):
    """A human correction to a structural score.

    Weighted more heavily than panel consensus, because a person who has read
    the manuscript is a better authority on it than a panel of models. Limited
    to signed-in users and to one correction per paper per identity: an
    anonymous, repeatable correction endpoint is a direct route to steering
    the scoring model, and this is the one input that is not self-correcting.
    """
    check_rate_limit(get_client_ip(request), bucket="scilem")
    key = _profile_key(payload.wallet, payload.orcid)
    if not key:
        raise HTTPException(
            status_code=403,
            detail="Sign in with a wallet or ORCID to submit a correction. Corrections adjust "
                   "the scoring model, so they must be attributable.")
    if not 0.0 <= payload.corrected_score <= 100.0:
        raise HTTPException(status_code=400, detail="Corrected score must be between 0 and 100.")

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT title, scilem_signals FROM papers_assessment WHERE eval_hash = ?",
            (payload.eval_hash,),
        ).fetchone()
    except sqlite3.Error:
        row = None
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="No assessment found for that hash.")

    # The signals were measured and stored at assessment time. Reusing them
    # rather than re-deriving from text means a correction can be applied long
    # after the manuscript itself is gone — and, more importantly, that the
    # learning step uses exactly the measurements the original score used.
    try:
        signals = json.loads(row[1] or "{}")
    except (ValueError, TypeError):
        signals = {}
    if not signals or not any(signals.values()):
        return {"accepted": False,
                "message": ("This assessment predates structural-signal storage, so there is "
                            "nothing to learn from. Corrections work on assessments run after "
                            "this version.")}
    report = scilem_learning.observe(
        signals, max(0.0, min(1.0, payload.corrected_score / 100.0)),
        source="feedback", independent_sources=99, eval_hash=payload.eval_hash,
    )
    add_log(f"SciLM (siM) correction on {payload.eval_hash[:12]}… by {key[:16]}…: {report.get('learned')}")
    return {"accepted": bool(report.get("learned")), "report": report,
            "message": ("Correction applied. SciLM (siM)'s weighting has been adjusted."
                        if report.get("learned") else
                        f"Correction not applied: {report.get('reason', 'rejected.')}")}


@app.post("/api/scilem/chat")
def scilem_chat(req: ScilemChatRequest, request: Request):
    if not ENABLE_SCILEM_ASSISTANT:
        raise HTTPException(status_code=503, detail=SCILEM_DISABLED_NOTICE)
    check_rate_limit(get_client_ip(request), bucket="scilem")
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty.")
    if len(req.prompt) > 4000:
        raise HTTPException(status_code=413, detail="Prompt is too long (max 4,000 characters).")

    # Identity is taken from the verified request, not from the prompt, so a
    # question cannot talk the assistant into reading someone else's balance.
    clean_wallet, clean_orcid = normalize_identity(req.wallet, req.orcid)
    return scilem.answer(req.prompt, wallet=clean_wallet, orcid=clean_orcid)


class ScilemResetRequest(BaseModel):
    wallet: str


@app.post("/api/scilem/reset")
def scilem_reset(req: ScilemResetRequest, request: Request):
    require_owner(request, req.wallet)
    msg = clear_structural_analyzer_state()
    add_log(msg)
    return {"message": msg}


# ---------------------------------------------------------------------------
# 6. PIDYNE FORECAST  (LSTM epoch-weight forecasting)
# ---------------------------------------------------------------------------
def describe_forecast_criteria(weights):
    labels = [
        ("C1", "Originality", "Semantic distance from literature corpus penalized by generative AI laundering heuristics."),
        ("C2", "Methodological Rigor", "Deterministic adherence to MDAR reporting standards and valid RRIDs via SciScore."),
        ("C3", "Interdisciplinary Synergy", "Measures cross-disciplinary integration and entropy across scientific domains."),
        ("C4", "Societal Impact", "Evaluates broader societal and open infrastructure contributions."),
        ("C5", "Open Science", "Evaluates open data, open code, and containerized reproducibility."),
        ("C6", "Literature Integration", "Evaluates citation polarity and integration with existing foundational literature."),
        ("C7", "Empirical Density", "Assesses empirical sample strength and baseline variance."),
        ("C8", "Future Actionability", "Evaluates future research actionability and adherence to FAIR principles."),
    ]
    return [
        {"id": lid, "title": title, "description": desc, "weight": float(w)}
        for (lid, title, desc), w in zip(labels, weights)
    ]


CRITERIA_KEYS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]


def reconstruct_weight_history(limit: int = 60):
    """Rebuild the epoch-weight series from stored criteria scores.

    Blocks written before per-block weighting all carry [1.0] * 8, which gives
    the forecaster a flat line and nothing to learn. The papers themselves
    still hold their C1-C8 scores, so the same derivation the ledger now uses
    can simply be replayed over them in timestamp order.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT c1, c2, c3, c4, c5, c6, c7, c8 FROM papers_assessment
               WHERE final_score IS NOT NULL
               ORDER BY timestamp ASC LIMIT ?""",
            (limit,),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()

    history, previous = [], None
    for row in rows:
        scores = {key: safe_float(value, 50.0)
                  for key, value in zip(BRAIN_CRITERIA_ORDER, row)}
        previous = derive_next_epoch_weights(scores, previous)
        history.append(list(previous))
    return history

WEIGHT_MIN = 0.05
# The largest a single weight can be while the other seven still hold their
# floor and all eight sum to 8.0. Clipping to anything tighter than this is
# infeasible: renormalizing after the clip just pushes the value back over
# the cap, so the stated bound would be quietly violated.
WEIGHT_MAX = 8.0 - (7 * WEIGHT_MIN)


def project_weights_onto_simplex(vec):
    """Project a raw weight vector onto {w : sum(w) = 8, MIN <= w_i <= MAX}.

    Clip and renormalize interact — each one breaks the other's invariant —
    so alternate between them until both hold.
    """
    w = np.asarray(vec, dtype=np.float64).copy()
    if not np.all(np.isfinite(w)):
        w = np.where(np.isfinite(w), w, 1.0)

    for _ in range(12):
        w = np.clip(w, WEIGHT_MIN, WEIGHT_MAX)
        total = float(np.sum(w))
        if total <= 0:
            return np.full(8, 1.0, dtype=np.float64)
        w = w * (8.0 / total)
        if np.all(w >= WEIGHT_MIN - 1e-9) and np.all(w <= WEIGHT_MAX + 1e-9):
            break
    return np.clip(w, WEIGHT_MIN, WEIGHT_MAX)


@app.get("/api/forecast")
def run_forecast(
    lookback: int = Query(default=3, ge=1, le=5),
    # Holt's smoothing constants, exposed so the projection can be interrogated
    # rather than taken on faith. Bounded well inside (0, 1): at the extremes
    # the method degenerates — alpha near 0 ignores the data, near 1 ignores
    # the history — and neither produces a forecast worth showing.
    alpha: float = Query(default=0.6, ge=0.05, le=0.95),
    beta: float = Query(default=0.3, ge=0.05, le=0.95),
    gain: float = Query(default=2.5, ge=1.0, le=4.0),
):
    """Public wrapper: never lets an internal fault look like a dead connection.

    A 500 and a dropped socket render identically in the browser ("could not
    reach the forecasting service"), which sends the operator looking at
    networking when the real fault is in this handler. Catching here means the
    UI gets a structured answer with a log reference either way.
    """
    try:
        return _run_forecast_impl(lookback, alpha=alpha, beta=beta, gain=gain)
    except Exception as exc:
        ref = uuid.uuid4().hex[:8]
        logging.exception("Forecast failed [ref %s]", ref)
        add_log(f"Forecast failed [ref {ref}]: {type(exc).__name__}: {exc}")
        return {
            "ready": False, "mode": "error",
            "message": (f"The forecaster hit an internal error and could not complete. "
                        f"Server log reference: {ref}."),
            "detail": (f"{type(exc).__name__}: {exc}" if ENVIRONMENT != "production" else ""),
            "blocks_recorded": 0, "blocks_required": 3,
            "history": [], "forecast": None, "criteria": [],
        }


def _run_forecast_impl(lookback: int = 3, alpha: float = 0.6,
                       beta: float = 0.3, gain: float = 2.5):
    """Trains the PiDN LSTM on the recorded per-block criteria weights and
    projects the next epoch's weighting.

    The chart this feeds used to be meaningless because every block was
    written with a constant [1.0] * 8 weight vector — eight perfectly flat,
    perfectly overlapping lines. Blocks now record the criteria weighting each
    assessed manuscript's evidence profile implies (see
    brain.derive_next_epoch_weights), so the series carries real signal, and this
    endpoint returns the observed history plus the forecast point explicitly
    marked, along with the per-criterion delta and trend direction.
    """
    try:
        conn = get_db_connection()
        try:
            rows = conn.execute(
                """SELECT block_height, w1, w2, w3, w4, w5, w6, w7, w8, timestamp
                   FROM blockchain_por_weights ORDER BY block_height ASC"""
            ).fetchall()
        finally:
            conn.close()
    except sqlite3.Error as e:
        add_log(f"Forecast ledger read failed: {e}")
        return {"ready": False, "message": "The Proof-of-Research ledger is unavailable.",
                "blocks_recorded": 0, "blocks_required": 2, "history": [],
                "forecast": None, "criteria": []}

    # ---- Make the series reflect the papers, not just the ledger -----------
    #
    # An observation is a block whose weights actually differ from the uniform
    # genesis vector; a block that carries [1.0] * 8 says nothing happened.
    # When the ledger holds fewer observations than there are assessed papers —
    # a fresh deployment, blocks written before per-block weighting, or a
    # ledger that simply has not caught up — the papers still carry their
    # C1–C8 scores, so the series is replayed from them instead.
    #
    # This is what makes the section work from the first assessed manuscript.
    # Before it, the reconstruction was attempted only after the ledger had
    # already produced a flat series AND required three reconstructed points to
    # be usable, so a user with one or two assessed papers was shown "Not
    # enough ledger history yet" over an empty box — while the data needed to
    # draw something real sat in papers_assessment the whole time.
    def _observations(rs):
        """Indices of blocks that record an actual measurement."""
        return [i for i, r in enumerate(rs)
                if any(abs(safe_float(v, 1.0) - 1.0) > 1e-9 for v in r[1:9])]

    forced_source = None
    if len(_observations(rows)) < 2:
        reconstructed = reconstruct_weight_history()
        if len(reconstructed) > len(_observations(rows)):
            # Block numbering restarts at 1: these are derived observations in
            # paper order, not ledger blocks, and `series_source` says so.
            rows = [(i + 1, *w, None) for i, w in enumerate(reconstructed)]
            forced_source = "reconstructed"

    # How many manuscripts actually exist, so the empty state can tell "nothing
    # assessed yet" apart from "assessed, but every weight came out uniform".
    try:
        papers_assessed = int(count_assessed_papers() or 0)
    except Exception:
        papers_assessed = 0

    # Two regimes, because "forecast" and "report" are different claims.
    #
    # A trend cannot honestly be projected from a single assessment — one
    # point has no direction. But the moment there is one assessed paper there
    # IS something real to report: how that paper's evidence profile moved the
    # criteria weighting away from the genesis baseline. That is a measurement,
    # not a projection, so it is returned as a delta and labelled as one.
    # Fabricating a curve through one point would be the dishonest option, and
    # showing nothing at all was the useless one.
    # One assessment must produce something visible. Depending on whether the
    # genesis block is present, "one assessment" is either two rows (genesis +
    # the paper) or a single row, and the second case previously fell into the
    # "no manuscripts assessed yet" branch and showed an empty state to a user
    # who had just assessed a manuscript. Both are handled as the same measured
    # shift, against a uniform baseline when there is no recorded predecessor.
    # A single row that is only the genesis block is NOT one assessment — it is
    # zero. Routing it to the delta branch compared the uniform genesis
    # weighting against a uniform baseline, produced eight deltas of exactly
    # 0.0, and drew eight zero-length bars: a chart that is present, correct,
    # and completely invisible. That is the "forecast shows nothing" state a
    # fresh deployment sits in.
    #
    # The regime is chosen by how many OBSERVATIONS there are, not how many
    # rows: zero observations is the baseline chart, one is the measured delta,
    # two or more is a projection. Counting rows instead meant a genesis block
    # padded the count — and, worse, that two real observations (a direction,
    # which is projectable) were still routed to the single-point delta.
    obs_idx = _observations(rows)
    only_genesis = not obs_idx

    if len(obs_idx) == 1:
        i_cur = obs_idx[0]
        current = np.array([safe_float(v, 1.0) for v in rows[i_cur][1:9]], dtype=np.float32)
        # Measured against the block before it when there is one, and against
        # the uniform genesis weighting when the observation is the first row.
        baseline = (np.array([safe_float(v, 1.0) for v in rows[i_cur - 1][1:9]], dtype=np.float32)
                    if i_cur > 0 else np.full(8, 1.0, dtype=np.float32))
        criteria = []
        for i, key_c in enumerate(CRITERIA_KEYS):
            delta = float(current[i] - baseline[i])
            criteria.append({
                "id": key_c,
                "title": CRITERIA_TITLES.get(key_c, key_c),
                "current": round(float(current[i]), 5),
                "previous": round(float(baseline[i]), 5),
                "delta": round(delta, 5),
                "direction": "up" if delta > 1e-4 else ("down" if delta < -1e-4 else "flat"),
            })
        ranked = sorted(criteria, key=lambda c: abs(c["delta"]), reverse=True)
        movers = [c for c in ranked if c["direction"] != "flat"][:3]
        return {
            "ready": True,
            "mode": "delta",
            "method": "observed-delta",
            "message": (
                "One assessment recorded. This is the measured shift from the baseline "
                "weighting, not a projection — a trend needs a second assessed paper "
                "before a direction can be inferred."
            ),
            "blocks_recorded": len(rows), "blocks_required": 2,
            "series_source": forced_source or "ledger",
            "observations": 1,
            "history": [], "forecast": None,
            "criteria": criteria,
            "insight": (
                "Your first assessment weighted "
                + ", ".join(f"{c['title']} {'up' if c['direction'] == 'up' else 'down'}"
                            for c in movers)
                + " relative to the uniform baseline."
            ) if movers else (
                "Your first assessment produced a weighting indistinguishable from the "
                "uniform baseline — its evidence was evenly spread across all eight criteria."
            ),
        }

    if only_genesis or len(rows) < 1:
        # An empty state is not the same as no information. The rubric's
        # genesis weighting is a real, defined starting point — it is what the
        # forecast will move AWAY from — so it is rendered as a chart rather
        # than withheld behind "come back when you have data". Showing the
        # baseline also makes the first assessment's effect legible, because
        # the user has already seen what it started from.
        baseline = np.full(8, 1.0, dtype=np.float32)
        criteria = []
        for i, key_c in enumerate(CRITERIA_KEYS):
            criteria.append({
                "id": key_c,
                "title": CRITERIA_TITLES.get(key_c, key_c),
                "current": 1.0, "previous": 1.0, "delta": 0.0, "direction": "flat",
            })
        return {
            "ready": True,
            "mode": "baseline",
            "method": "genesis-baseline",
            "message": (
                "This is the genesis weighting: all eight criteria weighted equally, which is "
                "where every deployment starts. It is the baseline, not a prediction — assess a "
                "manuscript and this chart shows how its evidence profile moves the weighting."
            ) if not papers_assessed else (
                "The assessed corpus has not moved the weighting off its uniform baseline yet: "
                "every criterion is carrying equal evidence. This is a measurement, not an "
                "empty chart — it will separate as the corpus grows."
            ),
            "blocks_recorded": len(rows), "blocks_required": 2,
            "series_source": forced_source or "ledger",
            "observations": 0,
            "history": [], "forecast": None,
            "criteria": criteria,
            "insight": (
                "Nothing has been assessed yet, so no criterion carries more weight than any "
                "other. The framework does not assume which criteria matter — it learns that "
                "from the evidence profiles of the manuscripts it sees."
            ) if not papers_assessed else (
                f"{papers_assessed} paper{'s' if papers_assessed != 1 else ''} assessed, and "
                "the derived weighting is still indistinguishable from uniform — the evidence "
                "so far is evenly spread across all eight criteria."
            ),
        }

    weight_matrix = np.array([[safe_float(v, 1.0) for v in r[1:9]] for r in rows], dtype=np.float32)

    # Belt and braces. Reaching here means at least two observations, so the
    # series already varies; this only catches a series that varies between
    # rows but is column-wise constant. Two reconstructed points are enough —
    # two points are a direction, and Holt projects from a direction. The old
    # floor of three is what turned a corpus of two assessed papers into "not
    # enough ledger history".
    series_source = forced_source or "ledger"
    if float(np.max(np.ptp(weight_matrix, axis=0))) < 1e-6:
        reconstructed = reconstruct_weight_history()
        if len(reconstructed) >= 2:
            weight_matrix = np.array(reconstructed, dtype=np.float32)
            rows = [(i + 1, *w, None) for i, w in enumerate(reconstructed)]
            series_source = "reconstructed"
        else:
            return {
                "ready": False,
                "message": (
                    "The recorded blocks all carry identical criteria weights (they predate "
                    "per-block weighting), and there are not yet enough assessed papers to "
                    "reconstruct a series. Assess a manuscript to build one."
                ),
                "blocks_recorded": len(rows), "blocks_required": 2,
                "history": [], "forecast": None, "criteria": [],
            }

    # At least one step back, at most everything we have. With two rows this is
    # 1, which is what makes a two-observation corpus projectable at all.
    actual_lookback = max(1, min(lookback, len(rows) - 1))

    try:
        key = forecast_engine.cache_key(
            len(rows), actual_lookback,
            f"{series_source}:a{alpha:.2f}:b{beta:.2f}:g{gain:.2f}")
    except TypeError:
        key = forecast_engine.cache_key(len(rows), actual_lookback)
        
    cached = forecast_engine.get_cached(key)
    if cached:
        return cached

    raw_pred, method, final_loss = None, "holt-linear-trend", 0.0
    
    # The neural path is attempted only when explicitly enabled AND torch can
    # actually be loaded. Both conditions matter: a host that cannot afford the
    # import must degrade to the statistical projection rather than crashing
    # the worker, and a crashed worker is exactly what the user sees as
    # "could not reach the forecasting service".
    if USE_LSTM_FORECAST:
        t = load_torch()
        if t:
            raw_pred = forecast_engine.train_lstm_forecast(
                weight_matrix, actual_lookback,
                model_factory=PidyneLSTM,
                dataset_factory=PidyneBlockchainDataset,
                loader_factory=t["DataLoader"],
                torch_mod=t["torch"], nn_mod=t["nn"], optim_mod=t["optim"],
            )
            if raw_pred is not None:
                method = "pidyne-lstm"
            
    # piD learns here. Every block that has appeared since the last pass is
    # replayed one step ahead — predicted from only the blocks before it, then
    # scored against what was actually written — so the model is trained the
    # way it is used and never sees the answer first. This is what makes piD a
    # learner rather than a procedure that refits and forgets.
    criteria_keys = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]
    try:
        forecast_engine.learn_from_history(weight_matrix, criteria_keys)
        learned_pred = np.array(
            [forecast_engine.learned_forecast(weight_matrix[:, i], c)
             for i, c in enumerate(criteria_keys[:weight_matrix.shape[1]])])
    except Exception as e:
        logging.warning("piD learned forecast unavailable: %s", e)
        learned_pred = None

    if raw_pred is None and learned_pred is not None:
        raw_pred = learned_pred
        method = "pid-learned"
    if raw_pred is None:
        raw_pred = forecast_engine.holt_linear_forecast(weight_matrix, alpha=alpha, beta=beta)

    last = weight_matrix[-1]

    # The LSTM head ends in softmax * 8, which pulls every output toward a
    # uniform 1.0 and would otherwise render as eight near-identical lines.
    # Two corrections, in order:
    #
    #  1. Contrast: amplify the prediction's deviation from its own mean.
    #     This sharpens the signal without ever reordering the criteria —
    #     an earlier version extrapolated from the last observed block with
    #     a gain above 1.0, which overshot past the model's own prediction
    #     and could invert the ordering the network actually forecast.
    #  2. Continuity: blend lightly toward the last observed block so the
    #     forecast point joins the history smoothly rather than jumping.
    CONTRAST_GAIN = float(gain)
    CONTINUITY = 0.30

    pred_mean = float(np.mean(raw_pred))
    sharpened = pred_mean + (raw_pred - pred_mean) * CONTRAST_GAIN
    projected = (CONTINUITY * last) + ((1.0 - CONTINUITY) * sharpened)

    next_weights = project_weights_onto_simplex(projected)

    hist_slice = rows[-(actual_lookback + 1):]
    history = []
    for r in hist_slice:
        entry = {"block": int(r[0]), "label": f"Block {int(r[0])}", "timestamp": r[9], "is_forecast": False}
        for i, key_c in enumerate(CRITERIA_KEYS):
            entry[key_c] = round(safe_float(r[1 + i], 1.0), 5)
        history.append(entry)

    next_block = int(rows[-1][0]) + 1
    forecast_point = {"block": next_block, "label": f"Block {next_block} (forecast)",
                      "timestamp": None, "is_forecast": True}
    for i, key_c in enumerate(CRITERIA_KEYS):
        forecast_point[key_c] = round(float(next_weights[i]), 5)

    criteria = describe_forecast_criteria(next_weights)
    for i, c in enumerate(criteria):
        current = float(last[i])
        delta = float(next_weights[i]) - current
        c["current_weight"] = round(current, 5)
        c["delta"] = round(delta, 5)
        c["delta_pct"] = round((delta / current) * 100.0, 2) if current else 0.0
        c["trend"] = "rising" if delta > 0.01 else ("falling" if delta < -0.01 else "stable")

    ranked = sorted(criteria, key=lambda cx: cx["weight"], reverse=True)
    mover = max(criteria, key=lambda cx: abs(cx["delta"]))
    interpretation = (
        f"Across the last {len(hist_slice)} ledger blocks, {ranked[0]['id']} ({ranked[0]['title']}) "
        f"carries the most forecast weight at {ranked[0]['weight']:.3f}, while {ranked[-1]['id']} "
        f"({ranked[-1]['title']}) carries the least at {ranked[-1]['weight']:.3f}. The largest "
        f"projected shift is {mover['id']} ({mover['title']}), {mover['trend']} by "
        f"{abs(mover['delta_pct']):.1f}%. Higher weight means the assessed corpus is producing "
        f"stronger, more consistent evidence for that criterion."
    )

    result = {
        "ready": True,
        "history": history,
        "forecast": forecast_point,
        "criteria": criteria,
        "raw_sum": float(np.sum(next_weights)),
        "lookback_used": actual_lookback,
        "blocks_recorded": len(rows),
        "training_loss": round(final_loss, 6),
        "method": method,
        "settings": {"alpha": round(alpha, 3), "beta": round(beta, 3),
                     "gain": round(gain, 3), "lookback": actual_lookback},
        "cached": False,
        "series_source": series_source,
        "interpretation": interpretation,
        "top_criterion": ranked[0]["id"],
        "biggest_mover": mover["id"],
    }
    forecast_engine.store_cached(key, result)
    return result


# ---------------------------------------------------------------------------
# 7. ANALYTICS — leaderboard, top papers, map-of-science bubble network
# ---------------------------------------------------------------------------
def list_corpus_fields():
    """Fields actually present in the assessed corpus, most common first.

    Replaces a hardcoded nine-item list that bore no relation to what had been
    assessed. The filter now offers exactly the fields a user can actually
    filter by, so selecting one always returns something.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT fields FROM papers_assessment").fetchall()
    finally:
        conn.close()

    counts = defaultdict(int)
    for (raw,) in rows:
        try:
            for f in json.loads(raw) if raw else []:
                if f and f != "Unclassified":
                    counts[f] += 1
        except Exception:
            continue
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [f for f, _ in ranked], dict(ranked)


def aggregate_author_statistics(rows):
    """rows: (author_name, piq_minted, final_score[, piq_escrowed, piq_claimed_at]).

    Splits comma-joined author strings, filters out institutions/unknowns, and
    aggregates per individual author name.

    Three figures are produced, and they mean different things:

      * `minted`  — released to a verified author. Spendable.
      * `held`    — earned by the paper but not yet released, because
                    authorship has not been verified. Not spendable.
      * `claimed` — escrow the author has since claimed. Already credited to
                    their account, so it is no longer held — but it was still
                    earned by the work, and the total keeps counting it.
      * `piq`     — the total the work has earned, minted + held + claimed.
                    This is what the leaderboard ranks and displays.

    `claimed` exists because of a real regression: an author who verified
    their authorship and claimed their escrow watched their leaderboard row
    fall by the amount they had just been paid, because the claim moved the
    piQ out of `held` and nothing counted it afterwards. Claiming is not
    un-earning. The total is now invariant across a claim; only the split
    between held and claimed moves.

    The leaderboard ranks on the TOTAL. It previously ranked and displayed
    `minted` alone, which read as 0.00 for every author on a corpus where
    nobody had verified authorship yet — a table of real scholars credited
    with nothing, which says the opposite of what is true. What an author's
    work has earned is a fact about the work; whether it has been released
    yet is a fact about their account, and belongs beside the number rather
    than in place of it.
    """
    authors = {}
    for row in rows:
        author_str, piq, score = row[0], row[1], row[2]
        escrowed = safe_float(row[3], 0.0) if len(row) > 3 else 0.0
        claimed = bool(row[4]) if len(row) > 4 else True
        ca = clean_author_name(author_str)
        if not ca or ca.lower() in ("unidentified", "unknown") or is_likely_institution(ca):
            continue
        names = [x.strip() for x in ca.split(",") if x.strip()]
        if not names:
            continue

        # --- Split the paper's piQ across its authors ----------------------
        # Each co-author previously received the paper's FULL emission, so a
        # five-author paper that minted 10 piQ put 10 piQ against all five and
        # the leaderboard column summed to 50 for piQ that does not exist. The
        # table was not describing a distribution of anything — it was counting
        # one emission once per name on the byline.
        #
        # An equal split is used because the manuscript gives no basis for any
        # other one. CRediT roles are extracted elsewhere, but role is not a
        # share: "wrote the manuscript" and "ran the experiments" cannot be
        # ranked against each other without inventing a weighting, and first or
        # last position means opposite things in different fields. Equal shares
        # are the only division the document actually supports, and the whole
        # column now sums to what was really emitted.
        #
        # This is a DISPLAY split. The ledger is unchanged: piQ still settles
        # to the one identity whose authorship was verified, because a
        # co-author with no wallet and no ORCID has no account to settle into.
        # See the note on the endpoint below.
        share = 1.0 / len(names)
        for a in names:
            rec = authors.setdefault(a, {"author": a, "minted": 0.0, "held": 0.0,
                                         "claimed": 0.0, "papers": 0, "_score_sum": 0.0})
            rec["minted"] += safe_float(piq, 0.0) * share
            # Escrow counts either way — as held while unclaimed, as claimed
            # once released. It is NOT folded into `minted`: releasing escrow
            # credits the piQ ledger and leaves piq_minted untouched, so adding
            # it there would double-count against the spendable balance.
            if claimed:
                rec["claimed"] += escrowed * share
            else:
                rec["held"] += escrowed * share
            # Papers are NOT split. Co-authoring a paper is authoring it — a
            # five-author paper is one paper each, not a fifth of one.
            rec["papers"] += 1
            rec["_score_sum"] += safe_float(score, 0.0)
    results = []
    for rec in authors.values():
        rec["avg_score"] = round(rec["_score_sum"] / rec["papers"], 2) if rec["papers"] else 0.0
        rec["minted"] = round(rec["minted"], 2)
        rec["held"] = round(rec["held"], 2)
        rec["claimed"] = round(rec["claimed"], 2)
        # `piq` is the total, and is the field the leaderboard sorts and shows.
        # Invariant across a claim: claiming moves piQ from held to claimed.
        rec["piq"] = round(rec["minted"] + rec["held"] + rec["claimed"], 2)
        del rec["_score_sum"]
        results.append(rec)
    return results


@app.get("/api/analytics/summary")
def analytics_summary():
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT COUNT(*), COALESCE(SUM(piq_minted),0), COALESCE(AVG(final_score),0),
                      COALESCE(SUM(CASE WHEN piq_claimed_at IS NULL THEN piq_escrowed ELSE 0 END),0),
                      MIN(timestamp), MAX(timestamp)
               FROM papers_assessment"""
        ).fetchone()
        author_rows = conn.execute("SELECT author_name, 0, 0 FROM papers_assessment").fetchall()
    finally:
        conn.close()
    unique_authors = {r["author"] for r in aggregate_author_statistics(author_rows)}
    return {
        "total_papers": row[0] or 0,
        # Settled: minted to a verified author. This is what the leaderboard
        # ranks and what settles on-chain, so it must never include a claim
        # that has not been proven.
        "total_piq": round(safe_float(row[1], 0.0), 2),
        # Earned but held pending authorship verification. Reported separately
        # so the corpus total reflects work done, without conflating "earned"
        # with "credited to a proven author".
        "total_piq_escrowed": round(safe_float(row[3], 0.0), 2),
        "total_piq_earned": round(safe_float(row[1], 0.0) + safe_float(row[3], 0.0), 2),
        "avg_score": round(safe_float(row[2], 0.0), 2),
        "unique_authors": len(unique_authors),
        # Distinct visitors, counted by keyed IP hash. Reported here so the
        # analytics tab can show reach alongside output — a corpus of 40 papers
        # reads very differently at 60 visitors than at 6,000.
        "visitors": visitor_stats(),
        "earliest": row[4],
        "latest": row[5],
    }


@app.get("/api/analytics/fields")
def analytics_fields():
    fields, counts = list_corpus_fields()
    return {"fields": fields, "counts": counts, "source": "assessed-corpus"}


@app.get("/api/emission")
def get_emission_policy():
    """Publish the piQ emission policy and the corpus's current position on it.

    Difficulty that nobody can inspect is indistinguishable from difficulty
    that is arbitrary, so the whole schedule is published: where the corpus
    sits, what the current factors are, and exactly what happens next.
    """
    conn = get_db_connection()
    try:
        total = conn.execute("SELECT COUNT(*) FROM papers_assessment").fetchone()[0]
        minted = conn.execute("SELECT COALESCE(SUM(piq_minted), 0) FROM papers_assessment").fetchone()[0]
    finally:
        conn.close()
    manifest = emission_manifest(total)
    manifest["total_piq_minted"] = round(safe_float(minted, 0.0), 4)
    manifest["fee"] = fee_manifest(total, PIQ_PROCESSING_FEE)
    manifest["onboarding_grant"] = onboarding_grant(PIQ_PROCESSING_FEE)
    return manifest


class RescoreRequest(BaseModel):
    dry_run: bool = True
    limit: int = 500


@app.post("/api/admin/rescore")
def rescore_corpus(req: RescoreRequest, request: Request, wallet: str = Query(default="")):
    """Replay stored signal vectors through the current rubric.

    Scores were previously computed once and frozen, so a rubric change left
    old and new scores silently incomparable on the same leaderboard. Because
    the normalized signal vector is persisted with every assessment, re-scoring
    needs no re-analysis and no LLM calls: it is a pure recomputation.

    Defaults to a dry run that reports what would change without writing.
    """
    require_owner(request, wallet)

    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT eval_hash, signal_vector, rubric_version, final_score
               FROM papers_assessment
               WHERE signal_vector IS NOT NULL AND signal_vector != '{}'
               ORDER BY timestamp DESC LIMIT ?""",
            (max(1, min(5000, req.limit)),),
        ).fetchall()

        weight_row = conn.execute(
            """SELECT block_height, w1, w2, w3, w4, w5, w6, w7, w8
               FROM blockchain_por_weights ORDER BY block_height DESC LIMIT 1"""
        ).fetchone()
        epoch = weight_row[0] if weight_row else 0
        epoch_weights = list(weight_row[1:9]) if weight_row else None

        examined, changed, updates = 0, 0, []
        for eval_hash, raw_signals, old_version, old_score in rows:
            signals = parse_json_or_default(raw_signals, None)
            if not signals:
                continue
            examined += 1
            scores = apply_scoring_rubric(signals)
            new_score = compute_composite_score(scores, epoch_weights)
            delta = new_score - safe_float(old_score, 0.0)
            if abs(delta) > 0.01 or old_version != RUBRIC_VERSION:
                changed += 1
                updates.append((eval_hash, scores, new_score, compute_composite_score(scores), delta))

        if not req.dry_run:
            for eval_hash, scores, new_score, unweighted, _ in updates:
                conn.execute(
                    """UPDATE papers_assessment
                       SET c1=?, c2=?, c3=?, c4=?, c5=?, c6=?, c7=?, c8=?,
                           final_score=?, unweighted_score=?, rubric_version=?, scoring_epoch=?
                       WHERE eval_hash=?""",
                    (*scores.values(), new_score, unweighted, RUBRIC_VERSION, epoch, eval_hash),
                )
            conn.commit()
            add_log(f"Re-scored {len(updates)} record(s) under {RUBRIC_VERSION}.")
    finally:
        conn.close()

    return {
        "dry_run": req.dry_run,
        "rubric_version": RUBRIC_VERSION,
        "scoring_epoch": epoch,
        "examined": examined,
        "changed": changed,
        "sample": [
            {"eval_hash": h, "new_score": round(ns, 2), "delta": round(d, 2)}
            for h, _, ns, _, d in updates[:20]
        ],
        "note": (
            "Dry run: no records were modified. Re-run with dry_run=false to apply."
            if req.dry_run else
            "Records updated in place. piQ already minted is not retroactively changed."
        ),
    }


@app.get("/api/architecture")
def architecture_parameters():
    """Live values the architecture diagram renders.

    The diagram previously hardcoded "0.10 piQ", "piX >= 50" and a fixed juror
    list. Every one of those has since changed at least once, and a diagram
    that silently disagrees with the running system is worse than no diagram —
    it is documentation that lies with authority. These are read from the
    modules that actually govern behaviour, so the picture cannot drift.
    """
    corpus = count_assessed_papers()
    jurors = provider_configuration()["jurors"]
    reachable = [name for name, meta in jurors.items() if meta["reachable"]]

    return {
        "free_documents": abuse_guard.FREE_DOCUMENTS,
        "minimum_fee": MINIMUM_FEE,
        "current_fee": resolve_active_fee(),
        "fee_is_size_scaled": True,
        "quality_threshold": round(emission_manifest(corpus)["current_quality_floor"], 1),
        "logic_floor": emission_manifest(corpus)["logic_floor"],
        "halving_epoch": emission_manifest(corpus)["current_epoch"],
        "corpus_size": corpus,
        "jurors": reachable or ["structural analyser only"],
        "juror_count": len(reachable),
        "rubric_version": RUBRIC_VERSION,
        "criteria_count": len(BRAIN_CRITERIA_ORDER),
        "verifiable_share": rubric_manifest()["confidence"]["verifiable_share"],
        "chain_name": CHAIN_NAME,
        "proof_of_work": REQUIRE_PROOF_OF_WORK,
        "authorship_required_for_minting": True,
        "onboarding_grant": NEW_PARTICIPANT_GRANT,
        # The review → publish pipeline. Added because the diagram had no
        # review stage at all while review had become the gate on publication
        # — the single most consequential rule on the platform was missing
        # from the picture that claims to describe it.
        "peer_review_fee": peer_review_fee()["fee"],
        "peer_review_bonus": PEER_REVIEW_BONUS,
        "llm_review_fee": llm_review_fee()["fee"],
        "review_required_before_publish": True,
        "review_min_chars": REVIEW_MIN_CHARS,
        "reviewer_needs_publication": True,
        "rebuttal_min_chars": REBUTTAL_MIN_CHARS,
        "publication_fee": publication_fee(60.0)["fee"],
        "rib_tutor": rib_engine.tutor_status().get("active", False),
    }


@app.get("/api/rubric")
def get_rubric():
    """Publish the scoring rubric.

    CoARA's transparency commitment requires quantitative indicators be
    published with their methodology. Exposing the rubric as data — rather
    than leaving it implicit in code — is what makes every score auditable.
    """
    return rubric_manifest()


@app.get("/api/analytics/leaderboard")
def analytics_leaderboard(
    q: str = Query(default=""),
    sort: str = Query(default="piq", pattern="^(piq|papers|avg_score|author)$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT author_name, piq_minted, final_score, piq_escrowed, piq_claimed_at "
            "FROM papers_assessment").fetchall()
    finally:
        conn.close()

    results = aggregate_author_statistics(rows)
    if q.strip():
        q_lower = q.strip().lower()
        results = [r for r in results if q_lower in r["author"].lower()]

    results.sort(key=lambda r: r[sort], reverse=(order == "desc"))
    total = len(results)
    page = results[offset: offset + limit]
    return {"rankings": page, "total": total}


@app.get("/api/analytics/top-papers")
def analytics_top_papers(
    q: str = Query(default=""),
    min_score: float = Query(default=0.0, ge=0.0, le=100.0),
    max_score: float = Query(default=100.0, ge=0.0, le=100.0),
    sort: str = Query(default="score", pattern="^(score|piq|date|title|logic)$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    # Sorting by piQ orders by the TOTAL, which is the figure the column
    # displays. Ordering by piq_minted while showing minted+held would put rows
    # out of sequence with their own numbers.
    # Escrow is counted claimed or not — the same rule piq_fields() displays by,
    # so claiming cannot move a paper's rank.
    sort_col = {"score": "final_score",
                "piq": PIQ_TOTAL_SQL,
                "date": "timestamp", "title": "title", "logic": "logic_score"}[sort]
    order_sql = "DESC" if order == "desc" else "ASC"

    clauses = ["final_score >= ?", "final_score <= ?"]
    params = [min_score, max_score]
    if q.strip():
        clauses.append("(title LIKE ? OR author_name LIKE ?)")
        like = f"%{q.strip()}%"
        params.extend([like, like])
    where_sql = " AND ".join(clauses)

    conn = get_db_connection()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM papers_assessment WHERE {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"""SELECT title, author_name, final_score, piq_minted, logic_score,
                       mdar_adherence_score, reproducibility_score, timestamp, eval_hash, tx_hash,
                       piq_escrowed, piq_claimed_at
                FROM papers_assessment
                WHERE {where_sql}
                ORDER BY {sort_col} {order_sql}
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()
    finally:
        conn.close()

    papers = [{
        "title": r[0], "author": clean_author_name(r[1]), "score": r[2],
        # Total earned, with the held portion alongside — the same rule every
        # other table follows. Reporting piq_minted alone is why this board
        # showed 0.00 for papers the history showed as 8.33.
        **piq_fields(r[3], r[10], r[11]),
        "logic_score": r[4], "mdar_score": r[5], "repro_score": r[6], "date": r[7],
        "eval_hash": r[8], "tx_hash": r[9],
    } for r in rows]
    return {"papers": papers, "total": total}


def format_topic_path(field: str, subfield: str) -> str:
    """Compose a 'Domain > Field' path from stored classification data.

    This replaces a keyword-matching function that ran over the hardcoded
    strings every record was written with. Because those strings were always
    the same two literals, the mapping's seventeen branches were decorative:
    every paper fell through to the same terminal label. Fields now come from
    OpenAlex (or the text classifier), so the real hierarchy is already known
    and simply needs formatting.
    """
    field = (field or "").strip() or "Unclassified"
    subfield = (subfield or "").strip()
    domain = FIELD_TO_DOMAIN.get(field, "Other")
    if subfield and subfield.lower() != field.lower():
        return f"{domain} > {field} > {subfield}"
    return f"{domain} > {field}"


@app.get("/api/analytics/map")
def analytics_map(
    author: str = Query(default="All Authors"),
    min_score: float = Query(default=0.0, ge=0.0, le=100.0),
    max_score: float = Query(default=100.0, ge=0.0, le=100.0),
    fields: str = Query(default=""),
    max_nodes: int = Query(default=20, ge=5, le=50),
):
    """Returns bubble/network data as JSON (nodes + edges + legend rows) so
    the frontend can render it with vis-network (loaded from CDN) instead of
    the old server-side PyVis-generated iframe HTML."""
    selected_fields = {f.strip() for f in fields.split(",") if f.strip()} if fields.strip() else None

    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT fields, subfields, final_score, author_name FROM papers_assessment").fetchall()
    finally:
        conn.close()

    topic_aggregates = {}
    exclude_terms = {"unclassified", "unspecified", "none", ""}
    for fields_json, subfields_json, final_score, author_str in rows:
        cleaned_author = clean_author_name(author_str)
        if author and author != "All Authors" and author not in cleaned_author:
            continue
        score = safe_float(final_score, 50.0)
        if score < min_score or score > max_score:
            continue
        try:
            paper_fields = [f.strip() for f in json.loads(fields_json or "[]") if f]
            paper_subfields = [s.strip() for s in json.loads(subfields_json or "[]") if s]
        except Exception:
            continue

        # Pair each field with its corresponding subfield where the classifier
        # produced both; fall back to the field alone otherwise.
        pairs = []
        for i, f in enumerate(paper_fields):
            sub = paper_subfields[i] if i < len(paper_subfields) else ""
            pairs.append((f, sub))
        if not pairs:
            pairs = [(s, "") for s in paper_subfields]

        for field, subfield in pairs:
            if not field or field.lower() in exclude_terms:
                continue
            # The filter operates on the field, which is what the UI offers.
            if selected_fields and field not in selected_fields:
                continue
            path = format_topic_path(field, subfield)
            agg = topic_aggregates.setdefault(path, {"weight_sum": 0.0, "frequency": 0})
            agg["weight_sum"] += score
            agg["frequency"] += 1

    if not topic_aggregates:
        return {"nodes": [], "edges": [], "legend": [], "empty": True}
    if len(topic_aggregates) > max_nodes:
        sorted_topics = sorted(topic_aggregates.items(), key=lambda x: (x[1]["frequency"], x[1]["weight_sum"]), reverse=True)
        topic_aggregates = dict(sorted_topics[:max_nodes])

    unique_topics = list(topic_aggregates.keys())
    major_fields = {}
    for topic in unique_topics:
        major = topic.split(">")[0].strip()
        major_fields.setdefault(major, []).append(topic)

    major_keys = sorted(major_fields.keys())
    color_map = {}
    for i, major in enumerate(major_keys):
        h = i / len(major_keys) if major_keys else 0
        subfields = sorted(major_fields[major])
        n_subs = len(subfields)
        for j, topic in enumerate(subfields):
            if n_subs <= 1:
                s, v = 0.7, 0.9
            else:
                ratio = j / (n_subs - 1)
                s = 0.4 + (0.5 * ratio)
                v = 0.95 - (0.35 * ratio)
            rgb = colorsys.hsv_to_rgb(h, s, v)
            color_map[topic] = "#%02x%02x%02x" % tuple(int(x * 255) for x in rgb)

    nodes, legend = [], []
    for topic, metrics in topic_aggregates.items():
        avg_weight = metrics["weight_sum"] / metrics["frequency"]
        node_size = max(20, 15 + (avg_weight * 0.3))
        nodes.append({
            "id": topic, "label": "", "title": f"{topic} | Frequency: {metrics['frequency']} | Avg Score: {avg_weight:.1f}",
            "size": node_size, "color": color_map[topic],
            "frequency": metrics["frequency"], "avg_score": round(avg_weight, 1),
        })
        legend.append({"topic": topic, "color": color_map[topic], "frequency": metrics["frequency"], "avg_weight": round(avg_weight, 1)})

    edges = []
    for i, t1 in enumerate(unique_topics):
        for j, t2 in enumerate(unique_topics):
            if i < j and t1.split(">")[0].strip() == t2.split(">")[0].strip():
                edges.append({"from": t1, "to": t2})

    legend.sort(key=lambda x: x["frequency"], reverse=True)
    return {"nodes": nodes, "edges": edges, "legend": legend, "empty": False}


# ---------------------------------------------------------------------------
# 8. LEDGER EXPLORER
# ---------------------------------------------------------------------------
EXPLORER_COLUMNS = """p.title, p.author_name, p.filename, p.final_score, p.logic_score,
   p.c1, p.c2, p.c3, p.c4, p.c5, p.c6, p.c7, p.c8,
   p.piq_minted, p.tx_hash, p.zk_proof, p.mdar_adherence_score,
   p.rrid_valid_count, p.reproducibility_score, p.eval_hash,
   p.consensus_data, p.evidence_report, p.scilem_score,
   p.warnings_json, p.judge_metadata, p.timestamp, p.doi, p.user_id, p.eth_book,
   p.integrity_report, p.reference_audit, p.authorship_signal, p.topology_detail,
   p.classification, p.criteria_breakdown, p.author_metrics, p.rubric_version,
   p.emission_record, p.attribution"""

CRITERIA_TITLES = {
    "C1": "Semantic Originality", "C2": "Methodological Rigor", "C3": "Interdisciplinary Synergy",
    "C4": "Societal Impact", "C5": "Open Science", "C6": "Literature Integration",
    "C7": "Empirical Density", "C8": "Future Actionability",
}


def parse_json_or_default(raw, default):
    if not raw:
        return default
    try:
        parsed = json.loads(raw)
        return parsed if parsed is not None else default
    except Exception:
        return default


def build_dossier_from_row(r):
    consensus = parse_json_or_default(r[20], {})
    judge_meta = parse_json_or_default(r[24], {}) or consensus.get("_judge_metadata", {}) or {}
    scores = {"C1": r[5], "C2": r[6], "C3": r[7], "C4": r[8], "C5": r[9], "C6": r[10], "C7": r[11], "C8": r[12]}
    return {
        "title": r[0], "author_name": r[1], "filename": r[2], "score": r[3], "logic_integrity": r[4],
        "scores_dict": scores,
        "criteria_detail": [
            {"id": k, "title": CRITERIA_TITLES[k], "score": safe_float(v, 0.0)} for k, v in scores.items()
        ],
        "piq": r[13], "tx_hash": r[14], "zk_proof": r[15], "mdar_score": r[16], "rrid_count": r[17],
        "repro_score": r[18], "eval_hash": r[19],
        "consensus_raw": consensus,
        "evidence_report_text": r[21] or "",
        "scilem_rating": r[22],
        "warnings": parse_json_or_default(r[23], []),
        "judge_metadata": judge_meta,
        "timestamp": r[25], "doi": real_doi(r[26]), "submitted_by": r[27], "eth_book": r[28],
        "integrity": parse_json_or_default(r[29], {}),
        "reference_audit": parse_json_or_default(r[30], {}),
        "authorship_signal": parse_json_or_default(r[31], {}),
        "topology_detail": parse_json_or_default(r[32], {}),
        "classification": parse_json_or_default(r[33], {}),
        "criteria_breakdown": parse_json_or_default(r[34], []),
        "author_metrics": parse_json_or_default(r[35], {}),
        "rubric_version": r[36],
        "emission": parse_json_or_default(r[37], {}),
        "explorer_url": get_sepolia_explorer_url(r[14], "tx"),
        "fee_charged": resolve_active_fee(),
    }


def restrict_to_existing_columns(conn, requested: str) -> str:
    """Restrict a column list to columns that actually exist.

    A long-running process can hold a stale schema, and naming a missing column
    fails the whole query — which is what turned the Ledger Explorer into a
    blanket "Error loading ledger". Degrading to the available subset keeps the
    explorer usable while the migration catches up.
    """
    try:
        present = {row[1] for row in conn.execute("PRAGMA table_info(papers_assessment)")}
    except sqlite3.Error:
        return requested
    kept = []
    for col in (c.strip() for c in requested.replace("\n", " ").split(",")):
        if not col:
            continue
        bare = col.split(".")[-1].strip()
        kept.append(col if bare in present else f"NULL AS {bare}")
    return ", ".join(kept)


@app.get("/api/explorer/search")
def explorer_search(q: str = Query(default="")):
    conn = get_db_connection()
    try:
        if q.strip():
            q_term = f"%{q.strip()}%"
            rows = conn.execute(
                f"""SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)}
                    FROM papers_assessment p
                    LEFT JOIN blockchain_por_weights b ON p.eval_hash = b.eval_hash
                    WHERE b.block_hash LIKE ? OR p.eval_hash LIKE ? OR p.title LIKE ? OR p.author_name LIKE ?
                    LIMIT 10""",
                (q_term, q_term, q_term, q_term),
            ).fetchall()
        else:
            rows = conn.execute(f"SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p ORDER BY p.timestamp DESC LIMIT 20").fetchall()
    finally:
        conn.close()
    return {"records": [build_dossier_from_row(r) for r in rows]}


# Sortable columns, whitelisted. The sort key reaches an ORDER BY clause, so
# it can never be interpolated from user input directly — a mapping is the
# only safe way to expose sorting over a SQL query.
_EXPLORER_SORTS = {
    "date": "p.timestamp",
    "score": "p.final_score",
    # Total earned, claimed or not — see PIQ_TOTAL_SQL. Claiming an award must
    # not reorder the explorer.
    "piq": "(COALESCE(p.piq_minted,0) + COALESCE(p.piq_escrowed,0))",
    "title": "p.title",
    "author": "p.author_name",
}


@app.get("/api/explorer/latest")
def explorer_latest(
    min_score: float = Query(default=0.0, ge=0.0, le=100.0),
    max_score: float = Query(default=100.0, ge=0.0, le=100.0),
    field: str = Query(default="", max_length=400),   # comma-separated; matches ANY
    sort: str = Query(default="date"),
    order: str = Query(default="desc"),
    limit: int = Query(default=25, ge=1, le=200),
):
    """Ledger records, filtered and sorted.

    The filtering controls moved here from the leaderboards. A leaderboard's
    job is to show a ranking; the moment it is filtered it stops being one,
    because "top papers scoring at least 80" is a search result wearing a
    ranking's clothes. The explorer is the surface whose job IS finding a
    particular record, so that is where the filters belong.
    """
    sort_column = _EXPLORER_SORTS.get(sort, _EXPLORER_SORTS["date"])
    direction = "ASC" if str(order).lower() == "asc" else "DESC"

    conn = get_db_connection()
    try:
        # Joined against the Proof-of-Research chain so the explorer shows
        # actual ledger data — block height, validator, block hash, proof and
        # settlement transaction — rather than a plain list of titles.
        #
        # NULL scores sort last in both directions: a paper with no score is
        # not the best paper, and it is not the worst either — it is absent
        # from the ranking, and putting it at the top of an ascending sort
        # would misrepresent it as a zero.
        rows = conn.execute(
            f"""SELECT p.title, p.author_name, p.final_score, p.eval_hash, p.timestamp,
                      p.tx_hash, p.zk_proof, p.piq_minted,
                      b.block_height, b.block_hash, b.previous_hash, b.validator_node,
                      b.por_proof, b.model_used, b.formulas_hash, p.fields,
                      p.published_at, p.piq_escrowed, p.piq_claimed_at,
                      -- Needed to tell "nothing to settle to" apart from
                      -- "settlement owed": both used to render as "Local".
                      p.eth_book
               FROM papers_assessment p
               LEFT JOIN blockchain_por_weights b ON p.eval_hash = b.eval_hash
               WHERE COALESCE(p.final_score, 0) >= ? AND COALESCE(p.final_score, 0) <= ?
               ORDER BY ({sort_column} IS NULL), {sort_column} {direction}
               LIMIT ?""",
            (min_score, max_score, int(limit)),
        ).fetchall()
    except sqlite3.Error as e:
        add_log(f"Ledger read failed: {e}")
        raise HTTPException(status_code=503,
                            detail="The ledger database is unavailable. If the server was recently "
                                   "updated, restart it so the schema migration can run.")
    finally:
        conn.close()
    records = []
    # A list, matched with OR. Researchers work across several fields, and a
    # single-value filter forced them to run the same query once per field.
    wanted_fields = {f.strip().lower() for f in (field or "").split(",") if f.strip()}
    for r in rows:
        # Field filtering is done here rather than in SQL because `fields` is a
        # JSON array in a TEXT column; a LIKE against it would match substrings
        # across element boundaries ("Biology" matching "Marine Biology" is
        # fine, but "Bio" matching either is not).
        try:
            row_fields = [str(f).strip() for f in json.loads(r[15] or "[]") if str(f).strip()]
        except (ValueError, TypeError):
            row_fields = []
        if wanted_fields and not any(f.lower() in wanted_fields for f in row_fields):
            continue
        tx = r[5]
        st = settlement_state(tx, r[19] if len(r) > 19 else "", r[7])
        records.append({
            "fields": row_fields,
            "published": bool(r[16]),
            "published_at": r[16],
            "title": r[0], "author": clean_author_name(r[1]), "score": r[2],
            "eval_hash": r[3], "timestamp": r[4],
            "tx_hash": tx, "explorer_url": get_sepolia_explorer_url(tx, "tx"),
            "settled": st["state"] == "on-chain",
            # Three states, not two. "Local" for both an unsettleable record and
            # one the deployment owes money on made a real backlog invisible.
            "settlement": st["state"],
            "settlement_label": st["label"],
            "settlement_note": st["note"],
            "zk_proof": r[6], **piq_fields(r[7], r[17], r[18]),
            "block_height": r[8], "block_hash": r[9], "previous_hash": r[10],
            "validator_node": r[11], "por_proof": r[12], "model_used": r[13],
            "formulas_hash": r[14],
        })
    return {
        "records": records,
        "count": len(records),
        # The filter dropdown is built from fields that are actually present in
        # the corpus, so selecting one always returns something.
        # list_corpus_fields() returns (ordered_names, counts_by_name). Serialising
        # the whole tuple sent the browser [[...names...], {...counts...}], so the
        # filter rendered two nonsense entries instead of a field list.
        "available_fields": list_corpus_fields()[0],
        "filters": {"min_score": min_score, "max_score": max_score,
                    "field": field, "sort": sort, "order": direction.lower()},
        "chain": {
            "network": CHAIN_NAME, "chain_id": CHAIN_ID, "explorer": BLOCK_EXPLORER_URL,
        },
    }


@app.get("/api/explorer/dossier/{eval_hash}")
def explorer_dossier(eval_hash: str, request: Request = None,
                     wallet: str = Query(default=""), orcid: str = Query(default="")):
    conn = get_db_connection()
    try:
        row = conn.execute(f"SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p WHERE p.eval_hash = ?", (eval_hash,)).fetchone()
        status = conn.execute(
            "SELECT published_at, publish_kind, piq_minted, piq_escrowed, piq_claimed_at "
            "FROM papers_assessment WHERE eval_hash = ?", (eval_hash,)).fetchone()
    except sqlite3.Error:
        status = None
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")

    dossier = build_dossier_from_row(row)

    # piQ read from the authoritative columns, not from the emission_record
    # JSON. The blob is written by the assessment pipeline and is empty ('{}')
    # for every row assessed before it existed, so a dossier built from it
    # reported "piQ 0.00" on papers that had plainly minted or escrowed piQ.
    # piq_minted and piq_escrowed are the columns the balance and the escrow
    # claim both read; the dossier now agrees with them by construction.
    if status:
        dossier["piq"] = round(safe_float(status[2], 0.0), 4)
        dossier["escrowed"] = round(safe_float(status[3], 0.0), 4)
        dossier["claimed"] = bool(status[4])
    # Publication and review state travel with the dossier so the seals render
    # the same wherever the dossier is opened from — a badge that appears on a
    # card and vanishes in the full record is worse than no badge.
    summary = review_summary(eval_hash)
    reviews = summary.get("reviews", [])
    dossier["published"] = bool(status and status[0])
    dossier["publish_kind"] = (status[1] if status and status[1] else "author") \
        if (status and status[0]) else None
    # is_llm, not a verdict prefix. Machine verdicts are now ordinary editorial
    # recommendations ("major revision"), so a prefix test would classify every
    # referee report as a human peer review and attach the wrong badge.
    dossier["peer_reviews"] = sum(1 for r in reviews if not r.get("is_llm"))
    dossier["llm_reviewed"] = any(r.get("is_llm") for r in reviews)
    # Only advertise the file when it is actually readable — the endpoint
    # serves a published paper to anyone, and an unpublished one to nobody but
    # its author. Advertising an unpublished file would produce a link that
    # 404s for every reader who follows it.
    dossier["has_file"] = bool(dossier["published"] and paper_store.has_paper(eval_hash))

    # A request is a weaker claim than a review and is carried separately, so
    # the marker can never be mistaken for the badge.
    dossier["review_requested"] = has_open_review_request(eval_hash)
    # The reward actually escrowed on the open request, not the standard fee —
    # a requester who offered more to attract a reviewer should have that
    # number shown, and it is the figure the badge advertises.
    dossier["review_bounty"] = (open_review_bounty(eval_hash)
                                or peer_review_fee()["fee"])

    # Opening the full dossier is what counts as a read. Not a leaderboard row
    # scrolling past, not a card in a list — someone opened the record and
    # looked at it. Deduplicated per reader per day inside record_paper_read.
    reader = ""
    try:
        identity = auth.identity_from_request(request, wallet, orcid) if request else {}
        if identity.get("verified"):
            reader = _profile_key(identity.get("wallet", ""), identity.get("orcid", ""))
        elif request is not None:
            reader = "ip:" + hashlib.sha256(
                get_client_ip(request).encode("utf-8")).hexdigest()[:24]
    except Exception:
        reader = ""
    dossier["reads"] = record_paper_read(eval_hash, reader) if reader else get_paper_reads(eval_hash)
    return dossier


# ---------------------------------------------------------------------------
# 8b. INTEROPERABILITY — EOSC / FAIR-aligned dossier export
#
# For the platform to federate into the European Open Science Cloud and be
# consumable by institutional repositories and reference managers, its
# assessments must be retrievable as structured, self-describing metadata
# rather than only as rendered HTML. These endpoints expose exactly that:
# stable identifiers, explicit provenance, an open licence, and a schema
# version — the machine-actionability half of FAIR.
# ---------------------------------------------------------------------------
DOSSIER_SCHEMA_VERSION = "scholarpi-dossier/1.0"
DOSSIER_LICENSE = "https://creativecommons.org/licenses/by/4.0/"

CRITERION_DEFINITIONS = {
    "C1": ("Semantic Originality", "Novelty relative to the existing corpus, penalized by generative-AI laundering heuristics."),
    "C2": ("Methodological Rigor", "Deterministic MDAR reporting adherence and RRID validity."),
    "C3": ("Interdisciplinary Synergy", "Hierarchical topic diversity across the OpenAlex domain/field/subfield ontology."),
    "C4": ("Societal Impact", "Broader societal and open-infrastructure contribution."),
    "C5": ("Open Science", "Open data, open code, licensing and containerized reproducibility."),
    "C6": ("Literature Integration", "Citation polarity and integration with foundational literature."),
    "C7": ("Empirical Density", "Empirical sample strength, statistical reporting and baseline variance."),
    "C8": ("Future Actionability", "Future research actionability and adherence to FAIR principles."),
}


def build_fair_dossier(d: dict) -> dict:
    """Assemble a self-describing, CoARA-aligned assessment record."""
    integrity = d.get("integrity") or {}
    ref_audit = d.get("reference_audit") or {}
    authorship = d.get("authorship_signal") or {}
    topology = d.get("topology_detail") or {}
    judge = d.get("judge_metadata") or {}

    doi = d.get("doi")
    if doi in ("None", "", None):
        doi = None

    return {
        "@context": {
            "schema": "https://schema.org/",
            "coara": "https://www.coara.org/agreement/the-commitments/",
            "eosc": "https://eosc.eu/interoperability-framework/",
        },
        "schema_version": DOSSIER_SCHEMA_VERSION,
        "license": DOSSIER_LICENSE,
        "generated_at": datetime.now().isoformat(),

        "identifiers": {
            "evaluation_hash": d.get("eval_hash"),
            "doi": doi,
            "transaction_hash": d.get("tx_hash") if (d.get("tx_hash") or "").startswith("0x") else None,
            "zk_proof": d.get("zk_proof"),
            "explorer_url": d.get("explorer_url"),
        },
        "resource": {
            "type": "schema:ScholarlyArticle",
            "title": d.get("title"),
            "authors": [a.strip() for a in (d.get("author_name") or "").split(",") if a.strip()],
            "assessed_at": d.get("timestamp"),
        },
        "assessment": {
            "framework": "Pi-Index",
            "alignment": ["CoARA", "DORA", "RRA"],
            "composite_score_piX": d.get("score"),
            "logic_integrity": d.get("logic_integrity"),
            "piq_minted": d.get("piq"),
            "criteria": [
                {
                    "id": cid,
                    "name": CRITERION_DEFINITIONS[cid][0],
                    "definition": CRITERION_DEFINITIONS[cid][1],
                    "score": safe_float((d.get("scores_dict") or {}).get(cid), 0.0),
                    "scale": {"min": 0.0, "max": 100.0},
                }
                for cid in CRITERION_DEFINITIONS
            ],
        },
        # CoARA asks that quantitative indicators be published with their
        # provenance and limitations, not as bare numbers.
        "qualitative_basis": {
            "final_judge": judge.get("final_judge_label"),
            "independent_jurors": judge.get("external_juror_count"),
            "juror_models": [m.get("label") for m in (judge.get("participating_models") or [])],
            "judgement_quality": judge.get("tier"),
            "judgement_confidence": judge.get("confidence"),
            "inter_model_agreement": judge.get("inter_model_agreement"),
            "rationale": judge.get("rationale"),
        },
        "open_science_indicators": {
            "mdar_adherence": d.get("mdar_score"),
            "valid_rrid_count": d.get("rrid_count"),
            "reproducibility_signal": d.get("repro_score"),
        },
        "interdisciplinarity": {
            "score": topology.get("score"),
            "basis": topology.get("basis"),
            "spans_domains": topology.get("spans_domains"),
            "domains": topology.get("domains", []),
            "fields": topology.get("fields", []),
            "topic_count": topology.get("topic_count"),
        },
        "research_integrity": {
            "adversarial_scan_performed": integrity.get("scanned", False),
            "manipulation_detected": integrity.get("compromised", False),
            "severity": integrity.get("severity", "none"),
            "techniques": integrity.get("techniques", []),
            "model_panel_confirmed": (integrity.get("canary") or {}).get("detected", False),
            "reference_audit": {
                "verdict": ref_audit.get("verdict"),
                "checked": ref_audit.get("checked"),
                "verified": ref_audit.get("verified"),
                "unresolvable": ref_audit.get("fabricated"),
                "unverifiable": ref_audit.get("unverified"),
            },
            "authorship_signal": {
                "flag": authorship.get("flag"),
                "confidence": authorship.get("confidence"),
                "affects_score": False,
                "caveat": authorship.get("bias_statement"),
            },
        },
        "warnings": d.get("warnings", []),
        "limitations": [
            "Automated assessment is decision support for human peer review, not a replacement for it.",
            "Criteria scores derive from the submitted text; claims not stated in the manuscript cannot be credited.",
            "The authorship signal is advisory, never affects any score, and cannot establish misconduct.",
            "Reference verification distinguishes unresolvable from unverifiable identifiers; only the former is penalized.",
        ],
    }


@app.get("/api/dossier/{eval_hash}/fair")
def fair_dossier(eval_hash: str):
    """EOSC-aligned, machine-actionable assessment record."""
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p WHERE p.eval_hash = ?", (eval_hash,)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    return build_fair_dossier(build_dossier_from_row(row))


@app.get("/api/dossier/by-doi")
def dossier_by_doi(doi: str = Query(..., min_length=4, max_length=200)):
    """Look up an assessment by DOI.

    This is the integration point for reference managers (a Zotero plugin can
    resolve a library item straight to its assessment) and for institutional
    repositories surfacing dossiers alongside faculty publications.
    """
    clean = doi.replace("https://doi.org/", "").replace("doi.org/", "").strip()
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"""SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p
                WHERE LOWER(p.doi) = LOWER(?) ORDER BY p.timestamp DESC LIMIT 1""",
            (clean,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return {"found": False, "doi": clean,
                "message": "No ScholarPi assessment exists for this DOI yet."}
    dossier = build_dossier_from_row(row)
    return {
        "found": True,
        "doi": clean,
        "eval_hash": dossier["eval_hash"],
        "title": dossier["title"],
        "piX": dossier["score"],
        "piQ": dossier["piq"],
        "judgement_quality": (dossier.get("judge_metadata") or {}).get("tier"),
        "integrity_flag": (dossier.get("integrity") or {}).get("compromised", False),
        "dossier_url": f"/api/dossier/{dossier['eval_hash']}/fair",
    }


@app.get("/api/dossier/{eval_hash}/coara.html", response_class=HTMLResponse)
def coara_dossier_html(eval_hash: str):
    """Printable CoARA/DORA dossier for inclusion in evaluation portfolios."""
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p WHERE p.eval_hash = ?", (eval_hash,)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")

    d = build_dossier_from_row(row)
    fair = build_fair_dossier(d)
    judge = d.get("judge_metadata") or {}
    integrity = d.get("integrity") or {}

    def esc(v):
        return (str(v) if v is not None else "—").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    rows = "".join(
        f"<tr><td><strong>{c['id']}</strong></td><td>{esc(c['name'])}"
        f"<div class='def'>{esc(c['definition'])}</div></td>"
        f"<td class='num'>{c['score']:.1f}</td></tr>"
        for c in fair["assessment"]["criteria"]
    )
    warn_html = "".join(f"<li>{esc(w)}</li>" for w in d.get("warnings", [])) or "<li>None raised.</li>"
    jurors = ", ".join(fair["qualitative_basis"]["juror_models"] or []) or "—"

    integrity_banner = ""
    if integrity.get("compromised"):
        integrity_banner = (
            "<div class='alert'><strong>Research integrity alert.</strong> This manuscript was found to "
            "contain content designed to manipulate an automated reviewer. Logic integrity was set to "
            "0.0 and no piQ was minted.</div>"
        )

    return HTMLResponse(f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>CoARA Assessment Dossier — {esc(d.get('title'))}</title>
<style>
 body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:820px;
   margin:40px auto;padding:0 24px;color:#0f172a;line-height:1.6}}
 h1{{font-size:1.5rem;margin-bottom:4px}} h2{{font-size:1.05rem;margin-top:28px;
   border-bottom:1px solid #e2e8f0;padding-bottom:6px}}
 .sub{{color:#64748b;margin-bottom:20px}}
 table{{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}}
 th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}}
 th{{background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}}
 .num{{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}}
 .def{{color:#64748b;font-size:11.5px;margin-top:2px}}
 .kv{{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}}
 .kv span:first-child{{color:#64748b}}
 .alert{{background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;color:#7f1d1d;
   padding:12px 14px;border-radius:6px;margin:16px 0;font-size:13px}}
 .note{{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;
   font-size:12px;color:#475569;margin-top:12px}}
 code{{background:#f1f5f9;padding:2px 5px;border-radius:4px;font-size:11px;word-break:break-all}}
 ul{{padding-left:20px;font-size:13px}} li{{margin-bottom:6px}}
 @media print{{body{{margin:0}} h2{{page-break-after:avoid}}}}
</style></head><body>
<h1>{esc(d.get('title'))}</h1>
<div class="sub">{esc(d.get('author_name'))}</div>
{integrity_banner}

<h2>Assessment Summary</h2>
<div class="kv"><span>Composite pi-Index (piX)</span><strong>{safe_float(d.get('score'),0):.1f} / 100</strong></div>
<div class="kv"><span>Logic integrity</span><strong>{safe_float(d.get('logic_integrity'),0):.1f} / 100</strong></div>
<div class="kv"><span>pi-Quotient minted</span><strong>{safe_float(d.get('piq'),0):.2f} piQ</strong></div>
<div class="kv"><span>Assessed</span><strong>{esc(d.get('timestamp'))}</strong></div>

<h2>Qualitative Basis</h2>
<p style="font-size:13px">CoARA requires quantitative indicators be published with their provenance.
This assessment was adjudicated by <strong>{esc(judge.get('final_judge_label'))}</strong> over the
independent evaluations of {esc(jurors)}.</p>
<div class="kv"><span>Independent external jurors</span><strong>{esc(judge.get('external_juror_count'))}</strong></div>
<div class="kv"><span>Judgement quality</span><strong>{esc(judge.get('tier'))}</strong></div>
<div class="kv"><span>Inter-model agreement</span><strong>{esc(judge.get('inter_model_agreement'))}</strong></div>
<div class="note">{esc(judge.get('rationale'))}</div>

<h2>Criteria Assessment</h2>
<table><thead><tr><th>ID</th><th>Criterion</th><th class="num">Score</th></tr></thead><tbody>{rows}</tbody></table>

<h2>Open Science Indicators</h2>
<div class="kv"><span>MDAR adherence</span><strong>{safe_float(d.get('mdar_score'),0)*100:.1f}%</strong></div>
<div class="kv"><span>Valid RRIDs detected</span><strong>{esc(d.get('rrid_count'))}</strong></div>
<div class="kv"><span>Reproducibility signal</span><strong>{safe_float(d.get('repro_score'),0)*100:.1f}%</strong></div>

<h2>Processing Warnings</h2>
<ul>{warn_html}</ul>

<h2>Verification</h2>
<div class="kv"><span>Evaluation hash</span><code>{esc(d.get('eval_hash'))}</code></div>
<div class="kv"><span>zk-SNARK proof</span><code>{esc(d.get('zk_proof'))}</code></div>
<div class="kv"><span>Transaction</span><code>{esc(d.get('tx_hash'))}</code></div>

<h2>Limitations</h2>
<ul>{''.join(f'<li>{esc(l)}</li>' for l in fair['limitations'])}</ul>

<div class="note">Machine-readable equivalent: <code>/api/dossier/{esc(eval_hash)}/fair</code> ·
Schema <code>{DOSSIER_SCHEMA_VERSION}</code> · Licensed CC BY 4.0.<br>
Pi-Index is decision support aligned with CoARA and DORA. It does not replace peer review.</div>
</body></html>""")


@app.get("/api/explorer/tx-url")
def explorer_tx_url(tx: str):
    if not tx or not tx.startswith("0x") or len(tx) != 66:
        return {"url": None}
    try:
        return {"url": get_sepolia_explorer_url(tx, "tx")}
    except Exception:
        return {"url": None}


# ---------------------------------------------------------------------------
# 9. Serve the frontend (single-page static app)
# ---------------------------------------------------------------------------
_FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

# Asset versions are derived from file mtimes, not maintained by hand.
#
# index.html references its assets as `app.js?v=16`. That integer was edited
# manually on each release, and when it was forgotten — which is the normal
# outcome for a number a human has to remember to change — every returning
# browser kept serving the previously cached JS and CSS. The symptom is
# indistinguishable from the code being broken: fixes ship, the deployment is
# correct, and the user sees the old behaviour with no error anywhere.
#
# Rewriting the query string from the file's modification time removes the
# step. Change a file, its version changes; do not, and the browser cache
# stays valid. Done on the way out rather than by editing the file on disk, so
# the source stays readable and nothing has to be regenerated at build time.
_ASSET_QUERY = re.compile(r'\b(?P<file>[\w./-]+\.(?:js|css))\?v=[\w.]+')


def _asset_version(filename: str) -> str:
    try:
        return str(int(os.path.getmtime(os.path.join(_FRONTEND_DIR, filename))))
    except OSError:
        # Unknown file: leave the cache-buster alone rather than invent one
        # that changes on every request and defeats caching entirely.
        return ""


def _versioned_index() -> str:
    with open(os.path.join(_FRONTEND_DIR, "index.html"), "r", encoding="utf-8") as fh:
        html = fh.read()

    def sub(match):
        version = _asset_version(match.group("file"))
        return f"{match.group('file')}?v={version}" if version else match.group(0)

    return _ASSET_QUERY.sub(sub, html)


if os.path.isdir(_FRONTEND_DIR):
    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    def _serve_index():
        """index.html with asset versions stamped from the files on disk.

        no-store on the HTML itself, because it is the document that carries
        the version numbers — a cached copy of it would pin the browser to
        whatever asset versions were current when it was cached, which is the
        exact failure this exists to prevent. The assets it points at stay
        aggressively cacheable, which is where the benefit actually is.
        """
        try:
            return HTMLResponse(_versioned_index(),
                                headers={"Cache-Control": "no-store, must-revalidate"})
        except OSError:
            raise HTTPException(status_code=404, detail="Frontend is not available.")

    # Mounted after the routes above so "/" resolves to the stamped index
    # rather than to the raw file on disk.
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=8000, reload=True)
