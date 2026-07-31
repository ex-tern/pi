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
import io
import json
import uuid
import decimal
import time
import math
import hashlib
import logging
import logging.handlers
import colorsys
import tempfile
import traceback
import urllib.parse
from datetime import datetime
from collections import deque, defaultdict
from typing import Optional, List

import sqlite3

import requests
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, HTMLResponse, StreamingResponse, PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from web3 import Web3
from eth_account.messages import encode_defunct

from config import (
    BASE_DIR, DB_PATH, PIQ_CONTRACT_ADDRESS, HOT_TOPICS,
    ORCID_CLIENT_ID, ORCID_CLIENT_SECRET, ORCID_REDIRECT_URI, FRONTEND_ORIGIN, OWNER_ID,
    ENVIRONMENT, IS_PRODUCTION, ALLOWED_ORIGINS, MAX_UPLOAD_MB, FREE_EVALS_PER_IP,
    RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS, ENABLE_SCILEM_LOCAL_MODEL, config_summary,
    SCILEM_DISABLED_NOTICE, ENABLE_SCILEM_ASSISTANT, SCILEM_MODE, SCILEM_LIMITED_NOTICE,
    PIQ_PROCESSING_FEE, DONATION_WALLET,
    GROQ_API_KEY, OR_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY,
    DEEPSEEK_API_KEY, TOGETHER_API_KEY, GITHUB_MODELS_TOKEN,
    CHAIN_ID, CHAIN_NAME, CHAIN_CURRENCY, BLOCK_EXPLORER_URL, ETH_ADMIN_PRIVATE_KEY,
    TURNSTILE_SITE_KEY, REQUIRE_PROOF_OF_WORK, USE_LSTM_FORECAST,
)
from database import (
    get_db_connection, get_free_evals_used, increment_free_evals_used,
    get_piq_balance, charge_piq_fee, refund_piq_fee, get_piq_fee_history,
    award_onboarding_grant, has_received_grant,
    get_bonus_evals, get_bonus_award_state, grant_bonus_evals,
    get_field_corpus_stats, save_researcher_profile, get_researcher_profile,
    delete_researcher_profile, list_assessments_for_identity, delete_assessment,
    store_bug_report, mark_bug_report_delivered, list_bug_reports,
    record_backup_cid, latest_backups,
    get_papers_for_recommendation, get_corpus_totals,
)
import arcade
import diagnostics
from ledger import restore_state_from_web3, get_sepolia_explorer_url, get_chain_status
import ledger as ledger_backup
from integrations import (
    normalize_doi, collect_pdf_candidates,
    clean_author_name, is_likely_institution, fetch_doi_metadata,
    fetch_semantic_scholar_pdf, download_pdf, fetch_core_text_by_doi,
    build_pdf_from_text, search_open_access_works,
)
from brain import (
    process_single_pdf, generate_rebuttal_strategy, PidyneLSTM,
    PidyneBlockchainDataset, clear_structural_analyzer_state, generate_assistant_reply,
    derive_next_epoch_weights, load_torch, torch_available,
)
from providers import provider_configuration
from rubric import (
    rubric_manifest, RUBRIC_VERSION, apply_scoring_rubric, compute_composite_score,
    CRITERIA_ORDER as BRAIN_CRITERIA_ORDER,
)
from emission import (
    emission_manifest, compute_processing_fee, fee_manifest,
    onboarding_grant, NEW_PARTICIPANT_GRANT, compute_document_fee, MINIMUM_FEE,
)
import forecast as forecast_engine
import assistant as scilem
import abuse_guard
import bugreport
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
_LOG_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(_LOG_DIR, exist_ok=True)
_log_handlers = [logging.StreamHandler()]
try:
    _log_handlers.append(
        logging.handlers.RotatingFileHandler(
            os.path.join(_LOG_DIR, "scholarpi.log"), maxBytes=5_000_000, backupCount=5
        )
    )
except OSError:
    pass
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
    """Never leak stack traces / internal details to clients in production;
    always log the full traceback server-side so it's still debuggable."""
    logging.error("Unhandled exception on %s %s: %s\n%s", request.method, request.url.path, exc, traceback.format_exc())
    detail = "Internal server error." if IS_PRODUCTION else f"{type(exc).__name__}: {exc}"
    return JSONResponse(status_code=500, content={"detail": detail})


@app.on_event("startup")
def on_startup():
    global _STATE_RESTORED
    for line in config_summary():
        logging.info(line)
    if not _STATE_RESTORED:
        try:
            restore_state_from_web3()
        except Exception as e:
            add_log(f"State restore warning: {e}")
        _STATE_RESTORED = True
        add_log("Backend started. Synchronized state with Sepolia Ethereum Ledger (if configured).")


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
def get_logs():
    return {"logs": list(APP_LOGS)}


# ---------------------------------------------------------------------------
# 2. AUTH — MetaMask (SIWE-style) + ORCID
# ---------------------------------------------------------------------------
class WalletVerifyRequest(BaseModel):
    address: str
    message: Optional[str] = None
    signature: Optional[str] = None


@app.post("/api/auth/wallet/verify")
def verify_wallet(req: WalletVerifyRequest):
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
    if authenticated:
        add_log(f"MetaMask Identity Cryptographically Authenticated via SIWE: {clean_wallet}")
    else:
        add_log(f"MetaMask Linked (unsigned): {clean_wallet}")
    return {"address": clean_wallet, "authenticated": authenticated}


def resolve_orcid_redirect_uri(request: Request) -> str:
    """The callback URL registered with ORCID, defaulting to this deployment."""
    configured = (ORCID_REDIRECT_URI or "").strip()
    if configured and "localhost" not in configured and "127.0.0.1" not in configured:
        return configured
    return f"{resolve_frontend_origin(request)}/api/auth/orcid/callback"


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
                add_log(f"ORCID Profile Successfully Authenticated: {real_orcid}")
                name_qs = urllib.parse.quote(real_name or "")
                return RedirectResponse(f"{frontend}/?orcid={real_orcid}&orcid_name={name_qs}{wallet_qs}")
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


def resolve_active_fee() -> float:
    """Processing fee at the corpus's current difficulty epoch."""
    return compute_processing_fee(count_assessed_papers(), PIQ_PROCESSING_FEE)


def normalize_identity(wallet: Optional[str], orcid: Optional[str]):
    clean_wallet = w3.to_checksum_address(wallet) if wallet and w3.is_address(wallet) else ""
    return clean_wallet, (orcid or "").strip()


@app.get("/api/user/piq-total")
def user_piq_total(wallet: Optional[str] = None, orcid: Optional[str] = None):
    """Lifetime piQ awarded, plus the fee-adjusted spendable balance the
    assessment pipeline actually charges against."""
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
    fee = resolve_active_fee()
    return {
        "total_piq": bal["minted"],
        "minted": bal["minted"],
        "fees_paid": bal["fees_paid"],
        "balance": bal["balance"],
        "fee_per_paper": fee,
        "papers_affordable": int(bal["balance"] // fee) if fee > 0 else 0,
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
def backup_run(wallet: str = Query(default="")):
    """Owner-triggered immediate backup, bypassing the throttle."""
    if not wallet or not OWNER_ID or wallet.lower() != OWNER_ID.lower():
        raise HTTPException(status_code=403, detail="Owner wallet required.")
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
    return {
        "wallet": DONATION_WALLET,
        "chain_id": CHAIN_ID,
        "chain_id_hex": hex(CHAIN_ID),
        "chain_name": CHAIN_NAME,
        "currency": CHAIN_CURRENCY,
        "explorer_url": f"{BLOCK_EXPLORER_URL.rstrip('/')}/address/{DONATION_WALLET}",
        "suggested_amounts": ["0.005", "0.01", "0.05", "0.1"],
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
def providers_status(wallet: str = Query(default="")):
    """Operator view of which jurors can actually reach a model.

    Restricted to the owner wallet: it enumerates configured vendors, which is
    deployment information rather than something a researcher needs.
    """
    if not wallet or wallet.lower() != OWNER_ID.lower():
        raise HTTPException(status_code=403,
                            detail="Provider diagnostics are restricted to the owner wallet.")
    return provider_configuration()


@app.get("/api/trial/status")
def trial_status(request: Request):
    """How much free allowance this visitor has left, and why."""
    ip = get_client_ip(request)
    used = get_free_evals_used(ip)
    bonus = get_bonus_evals(ip)
    allowed = abuse_guard.FREE_DOCUMENTS + bonus
    return {
        "documents_allowed": allowed,
        "base_allowance": abuse_guard.FREE_DOCUMENTS,
        "bonus_allowance": bonus,
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
@app.get("/api/arcade/start")
def arcade_start(request: Request):
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
    session = arcade.start_session(ip, corpus_stats=corpus, corpus_totals=totals)
    state = get_bonus_award_state(ip)
    session["wallet_state"] = {
        "bonus_earned": state["bonus"],
        "cap": arcade.BONUS_CAP,
        "cooldown_remaining": arcade.cooldown_remaining(state["last_award"]),
    }
    return session


class ArcadeRun(BaseModel):
    token: str
    duration_ms: int
    absorbed: List[dict] = []


@app.post("/api/arcade/finish")
def arcade_finish(payload: ArcadeRun, request: Request):
    """Verifies a completed run and grants allowance if it was a legitimate win."""
    ip = get_client_ip(request)
    result = arcade.verify_run(ip, payload.token, payload.absorbed, payload.duration_ms)

    if not result["valid"]:
        logging.info("Arcade run rejected from %s: %s", ip, result.get("reason"))
        return {**result, "granted": 0, "bonus_total": get_bonus_evals(ip)}

    if not result["won"]:
        return {**result, "granted": 0, "bonus_total": get_bonus_evals(ip),
                "message": (f"Run recorded at mass {result['final_mass']}. "
                            f"Reach {arcade.WIN_MASS} to earn free assessments.")}

    state = get_bonus_award_state(ip)
    remaining_cooldown = arcade.cooldown_remaining(state["last_award"])
    if remaining_cooldown > 0:
        hours = remaining_cooldown / 3600
        return {**result, "granted": 0, "bonus_total": state["bonus"],
                "cooldown_remaining": remaining_cooldown,
                "message": (f"You won — but arcade rewards are limited to one per "
                            f"{arcade.COOLDOWN_SECONDS // 3600} hours. "
                            f"Next reward available in {hours:.1f}h.")}

    grant = grant_bonus_evals(ip, arcade.REWARD_PER_WIN, arcade.BONUS_CAP)
    if grant["granted"] == 0:
        return {**result, "granted": 0, "bonus_total": grant["bonus"],
                "message": (f"You won, but this connection has already earned the maximum "
                            f"{arcade.BONUS_CAP} bonus assessments. Connect a wallet or link "
                            f"ORCID to keep going.")}

    logging.info("Arcade win from %s granted %s free assessments", ip, grant["granted"])
    return {**result, "granted": grant["granted"], "bonus_total": grant["bonus"],
            "message": (f"Victory. {grant['granted']} free assessment"
                        f"{'s' if grant['granted'] != 1 else ''} added to this connection.")}


@app.get("/api/stats/count")
def stats_count():
    conn = get_db_connection()
    try:
        n = conn.execute("SELECT COUNT(*) FROM papers_assessment").fetchone()[0]
    finally:
        conn.close()
    return {"total_analyzed": n}


def _profile_key(wallet: str = "", orcid: str = "") -> str:
    """One stable key per identity. ORCID wins when both are present, since it
    survives a wallet change and is the more durable research identity."""
    if orcid:
        return f"orcid:{orcid}"
    if wallet:
        return f"wallet:{wallet.lower()}"
    return ""


class ResearcherProfile(BaseModel):
    wallet: str = ""
    orcid: str = ""
    field: str = ""
    career_stage: str = ""
    goal: str = ""
    idea: str = ""
    abstract: str = ""


@app.get("/api/buddy")
def research_buddy(wallet: str = Query(default=""), orcid: str = Query(default="")):
    """Tailored guidance: the researcher's stated fields against the live corpus.

    This is the part the frontend cannot compute on its own. It compares the
    fields the researcher says they work in against what has actually been
    assessed here — which of their fields are crowded, which are empty, and how
    their own assessed papers score relative to the corpus mean.

    Everything returned is grounded in a real count or a real mean. Where there
    is no data, it says so rather than generating plausible-sounding advice,
    because a researcher cannot distinguish a grounded suggestion from an
    invented one and should not have to.
    """
    key = _profile_key(wallet, orcid)
    if not key:
        return {"available": False, "reason": "Sign in to get tailored guidance."}

    profile = get_researcher_profile(key)
    fields = [f.strip() for f in str(profile.get("field", "")).split(",") if f.strip()]

    try:
        corpus = get_field_corpus_stats(limit=60)
    except Exception as e:
        logging.warning("Buddy corpus read failed: %s", e)
        corpus = []
    by_field = {row["field"].lower(): row for row in corpus}
    total_papers = sum(r["papers"] for r in corpus)
    corpus_mean = (
        round(sum(r["avg_score"] * r["papers"] for r in corpus) / total_papers, 1)
        if total_papers else None
    )

    field_reports = []
    for name in fields:
        row = by_field.get(name.lower())
        if row:
            delta = (round(row["avg_score"] - corpus_mean, 1)
                     if corpus_mean is not None else None)
            field_reports.append({
                "field": name, "in_corpus": True,
                "papers": row["papers"], "avg_score": row["avg_score"],
                "vs_corpus": delta,
            })
        else:
            field_reports.append({"field": name, "in_corpus": False,
                                  "papers": 0, "avg_score": None, "vs_corpus": None})

    # Fields with assessed work that the researcher did not list. These are the
    # most useful suggestions available without external data: they are areas
    # this deployment demonstrably has material in.
    listed = {f.lower() for f in fields}
    adjacent = [
        {"field": r["field"], "papers": r["papers"], "avg_score": r["avg_score"]}
        for r in corpus if r["field"].lower() not in listed
    ][:5]

    # Scilem's reading picks. Scoped to the researcher's fields when they have
    # listed any and those fields contain assessed work; otherwise drawn from
    # the whole corpus, since a recommendation from an adjacent field is more
    # useful than an empty list.
    try:
        candidates = get_papers_for_recommendation(fields=fields)
        if not candidates and fields:
            candidates = get_papers_for_recommendation(fields=None)
            scope = "corpus"
        else:
            scope = "your fields" if fields else "corpus"
        picks = diagnostics.recommend_papers(candidates)
        picks["scope"] = scope
    except Exception as e:
        logging.warning("Buddy recommendations failed: %s", e)
        picks = {"available": False, "reason": "Recommendations unavailable.",
                 "recommended": [], "caution": []}

    return {
        "available": True,
        "profile": profile,
        "fields": field_reports,
        "adjacent": adjacent,
        "picks": picks,
        "corpus": {"total_papers": total_papers, "mean_score": corpus_mean,
                   "fields_assessed": len(corpus)},
    }


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
def write_profile(payload: ResearcherProfile):
    """Saves the researcher profile used to frame diagnostics."""
    key = _profile_key(payload.wallet, payload.orcid)
    if not key:
        raise HTTPException(
            status_code=400,
            detail="A wallet or ORCID is required to save a profile. Your draft is kept in "
                   "this browser until you connect one.")
    saved = save_researcher_profile(key, payload.dict())
    return {"stored": True, "profile": saved}


@app.delete("/api/profile")
def reset_profile(wallet: str = Query(default=""), orcid: str = Query(default="")):
    """Delete the stored researcher profile for this identity.

    The row is removed rather than blanked. A profile whose fields are empty
    strings still exists, still frames the diagnostic summary, and still scopes
    the research buddy's recommendations — so a "reset" that left one behind
    would keep shaping results the user believed they had cleared.
    """
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
def my_assessments(wallet: str = Query(default=""), orcid: str = Query(default=""),
                   limit: int = Query(default=100, ge=1, le=300)):
    """Everything assessed under this identity.

    Anonymous visitors get an explicit empty result rather than an error: they
    genuinely have no history to show, because nothing durable is keyed to
    them, and saying so is more useful than a 400.
    """
    key = _profile_key(wallet, orcid)
    if not key:
        return {"signed_in": False, "assessments": [], "count": 0,
                "reason": ("Sign in with a wallet or ORCID to keep a history of your "
                           "assessments. Anonymous runs are not linked to an identity.")}
    rows = list_assessments_for_identity(key, limit=limit)
    return {"signed_in": True, "assessments": rows, "count": len(rows)}


@app.delete("/api/assessments/{file_hash}")
def remove_assessment(file_hash: str, wallet: str = Query(default=""),
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
    key = _profile_key(wallet, orcid)
    is_owner = bool(wallet and OWNER_ID and wallet.lower() == OWNER_ID.lower())
    result = delete_assessment(file_hash, account_key=key, allow_any=is_owner)
    if not result["deleted"]:
        raise HTTPException(status_code=404 if "not found" in result["reason"].lower() else 403,
                            detail=result["reason"])
    add_log(f"Assessment {file_hash[:12]}… withdrawn by {key[:16] or 'owner'}")
    return {"deleted": True,
            "message": ("Paper removed from the corpus and all listings. Its ledger block "
                        "remains, because the Proof-of-Research chain is append-only.")}


# ---------------------------------------------------------------------------
# Bug reports
# ---------------------------------------------------------------------------
class BugReport(BaseModel):
    message: str
    contact: str = ""
    page: str = ""
    wallet: str = ""
    orcid: str = ""


@app.get("/api/bug-report/status")
def bug_report_status():
    """What the form should promise before the user types anything."""
    return bugreport.delivery_status()


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

    key = _profile_key(payload.wallet, payload.orcid)
    report = bugreport.normalise(
        message=payload.message, contact=payload.contact, identity=key,
        page=payload.page, user_agent=request.headers.get("user-agent", ""),
    )
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

    add_log(f"Bug report #{report['id']} received ({len(report['message'])} chars).")
    bugreport.send_async(report, on_result=lambda rid, res: mark_bug_report_delivered(
        rid, res["sent"], res.get("error") or ""))

    emailed = bugreport.smtp_configured()
    return {
        "received": True,
        "id": report["id"],
        "emailed": emailed,
        "message": (
            f"Thank you — report #{report['id']} was saved"
            + (" and is being emailed to the maintainer." if emailed
               else ". Email delivery is not configured on this deployment, so it is stored "
                    "on the server for the maintainer to read.")
        ),
    }


@app.get("/api/bug-report/list")
def bug_report_list(wallet: str = Query(default=""), limit: int = Query(default=100, ge=1, le=300)):
    """Owner-only. The reports that failed to send exist nowhere else."""
    if not wallet or not OWNER_ID or wallet.lower() != OWNER_ID.lower():
        raise HTTPException(status_code=403, detail="Owner wallet required.")
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

    # A missing profile is normal (anonymous users have none); it only frames
    # the wording of the diagnostic summary and never changes the findings.
    researcher_profile = researcher_profile or {}

    fee = active_fee

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
            # Priced after retrieval so the fee reflects the actual document,
            # and so nothing is charged for a paper that could not be fetched.
            ok, msgs = take_fee(f"DOI {doi}", estimate_word_count(pdf_bytes))
            for m in msgs:
                yield m
            if not ok:
                yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
                return
            yield line({"type": "status", "message": "Assessing document..."})
            res = process_single_pdf(pdf_bytes, f"DOI_{doi}.pdf", "", user_id, book_address, provided_doi=doi)
            if res:
                item = build_result_payload(res, f"DOI_{doi}.pdf", profile=researcher_profile)
                item["fee_charged"] = fee if charge_fees else 0.0
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
            ok, msgs = take_fee(title, estimate_word_count(pdf_bytes))
            for m in msgs:
                yield m
            if not ok:
                yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
                return
            yield line({"type": "status", "message": f"Assessing: {title[:80]}..."})
            res = process_single_pdf(pdf_bytes, fname, "", user_id, book_address, provided_doi=p_doi or "None")
            if res:
                item = build_result_payload(res, fname, profile=researcher_profile)
                item["fee_charged"] = fee if charge_fees else 0.0
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
        res = process_single_pdf(raw_bytes, fname, "", user_id, book_address)
        if res:
            item = build_result_payload(res, fname, profile=researcher_profile)
            item["fee_charged"] = fee if charge_fees else 0.0
            add_log(f"Assessed {fname}: score {_fmt_score(item.get('score'))}")
            yield emit_result(item, fname)

    yield line({"type": "done", "message": "Complete."})


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
        bonus=get_bonus_evals(client_ip),
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
    result = fetch_active_research_topics(limit=10)
    if result["topics"]:
        return result
    return {"topics": HOT_TOPICS, "source": "fallback-seed", "cached": False}


@app.get("/api/discover/search")
def discover_search(
    request: Request,
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(default=15, ge=1, le=30),
):
    check_rate_limit(get_client_ip(request), bucket="discover")
    try:
        results = search_open_access_works(q, limit=limit)
    except Exception as e:
        add_log(f"Discovery search error: {e}")
        results = []
    return {"results": results, "query": q}


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
    scores: dict


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
def scilem_reset(req: ScilemResetRequest):
    if not req.wallet or req.wallet.lower() != OWNER_ID.lower():
        raise HTTPException(status_code=403, detail="Only the Web3 owner wallet may reset Scilem.")
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
def run_forecast(lookback: int = Query(default=3, ge=1, le=5)):
    """Public wrapper: never lets an internal fault look like a dead connection.

    A 500 and a dropped socket render identically in the browser ("could not
    reach the forecasting service"), which sends the operator looking at
    networking when the real fault is in this handler. Catching here means the
    UI gets a structured answer with a log reference either way.
    """
    try:
        return _run_forecast_impl(lookback)
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


def _run_forecast_impl(lookback: int = 3):
    """Trains the Pidyne LSTM on the recorded per-block criteria weights and
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
                "blocks_recorded": 0, "blocks_required": 3, "history": [],
                "forecast": None, "criteria": []}

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
    if len(rows) in (1, 2):
        if len(rows) == 2:
            baseline = np.array([safe_float(v, 1.0) for v in rows[0][1:9]], dtype=np.float32)
            current = np.array([safe_float(v, 1.0) for v in rows[1][1:9]], dtype=np.float32)
        else:
            baseline = np.full(8, 1.0, dtype=np.float32)
            current = np.array([safe_float(v, 1.0) for v in rows[0][1:9]], dtype=np.float32)
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
                "One assessment recorded. This is the measured shift from the genesis "
                "baseline, not a projection — a trend needs at least two assessed papers "
                "before a direction can be inferred."
            ),
            "blocks_recorded": len(rows), "blocks_required": 3,
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

    if len(rows) < 1:
        return {
            "ready": False,
            "mode": "empty",
            "message": (
                "No manuscripts assessed yet. The first assessment produces a criteria "
                "weighting immediately; a projected trend needs three ledger blocks."
            ),
            "blocks_recorded": len(rows), "blocks_required": 3,
            "history": [], "forecast": None, "criteria": [],
        }

    weight_matrix = np.array([[safe_float(v, 1.0) for v in r[1:9]] for r in rows], dtype=np.float32)

    series_source = "ledger"
    if float(np.max(np.ptp(weight_matrix, axis=0))) < 1e-6:
        reconstructed = reconstruct_weight_history()
        if len(reconstructed) >= 3:
            weight_matrix = np.array(reconstructed, dtype=np.float32)
            rows = [(i + 1, *w, None) for i, w in enumerate(reconstructed)]
            series_source = "reconstructed"
        else:
            return {
                "ready": False,
                "message": (
                    "The recorded blocks all carry identical criteria weights (they predate "
                    "per-block weighting), and there are not yet enough assessed papers to "
                    "reconstruct a series. Assess a few manuscripts to build one."
                ),
                "blocks_recorded": len(rows), "blocks_required": 3,
                "history": [], "forecast": None, "criteria": [],
            }

    actual_lookback = max(1, min(lookback, len(rows) - 1))

    try:
        key = forecast_engine.cache_key(len(rows), actual_lookback, series_source)
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
            
    if raw_pred is None:
        raw_pred = forecast_engine.holt_linear_forecast(weight_matrix)

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
    CONTRAST_GAIN = 2.5
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
    """rows: iterable of (author_name, piq_minted, final_score). Splits
    comma-joined author strings, filters out institutions/unknowns, and
    aggregates piQ/paper-count/avg-score per individual author name."""
    authors = {}
    for author_str, piq, score in rows:
        ca = clean_author_name(author_str)
        if not ca or ca.lower() in ("unidentified", "unknown") or is_likely_institution(ca):
            continue
        for a in [x.strip() for x in ca.split(",") if x.strip()]:
            rec = authors.setdefault(a, {"author": a, "piq": 0.0, "papers": 0, "_score_sum": 0.0})
            rec["piq"] += safe_float(piq, 0.0)
            rec["papers"] += 1
            rec["_score_sum"] += safe_float(score, 0.0)
    results = []
    for rec in authors.values():
        rec["avg_score"] = round(rec["_score_sum"] / rec["papers"], 2) if rec["papers"] else 0.0
        rec["piq"] = round(rec["piq"], 2)
        del rec["_score_sum"]
        results.append(rec)
    return results


@app.get("/api/analytics/summary")
def analytics_summary():
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT COUNT(*), COALESCE(SUM(piq_minted),0), COALESCE(AVG(final_score),0),
                      MIN(timestamp), MAX(timestamp)
               FROM papers_assessment"""
        ).fetchone()
        author_rows = conn.execute("SELECT author_name, 0, 0 FROM papers_assessment").fetchall()
    finally:
        conn.close()
    unique_authors = {r["author"] for r in aggregate_author_statistics(author_rows)}
    return {
        "total_papers": row[0] or 0,
        "total_piq": round(safe_float(row[1], 0.0), 2),
        "avg_score": round(safe_float(row[2], 0.0), 2),
        "unique_authors": len(unique_authors),
        "earliest": row[3],
        "latest": row[4],
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
def rescore_corpus(req: RescoreRequest, wallet: str = Query(default="")):
    """Replay stored signal vectors through the current rubric.

    Scores were previously computed once and frozen, so a rubric change left
    old and new scores silently incomparable on the same leaderboard. Because
    the normalized signal vector is persisted with every assessment, re-scoring
    needs no re-analysis and no LLM calls: it is a pure recomputation.

    Defaults to a dry run that reports what would change without writing.
    """
    if not wallet or wallet.lower() != OWNER_ID.lower():
        raise HTTPException(status_code=403, detail="Only the owner wallet may re-score the corpus.")

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
        rows = conn.execute("SELECT author_name, piq_minted, final_score FROM papers_assessment").fetchall()
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
    sort_col = {"score": "final_score", "piq": "piq_minted", "date": "timestamp",
                "title": "title", "logic": "logic_score"}[sort]
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
                       mdar_adherence_score, reproducibility_score, timestamp, eval_hash, tx_hash
                FROM papers_assessment
                WHERE {where_sql}
                ORDER BY {sort_col} {order_sql}
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()
    finally:
        conn.close()

    papers = [{
        "title": r[0], "author": clean_author_name(r[1]), "score": r[2], "piq": r[3],
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
        "timestamp": r[25], "doi": r[26], "submitted_by": r[27], "eth_book": r[28],
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


@app.get("/api/explorer/latest")
def explorer_latest():
    conn = get_db_connection()
    try:
        # Joined against the Proof-of-Research chain so the explorer shows
        # actual ledger data — block height, validator, block hash, proof and
        # settlement transaction — rather than a plain list of titles.
        rows = conn.execute(
            """SELECT p.title, p.author_name, p.final_score, p.eval_hash, p.timestamp,
                      p.tx_hash, p.zk_proof, p.piq_minted,
                      b.block_height, b.block_hash, b.previous_hash, b.validator_node,
                      b.por_proof, b.model_used, b.formulas_hash
               FROM papers_assessment p
               LEFT JOIN blockchain_por_weights b ON p.eval_hash = b.eval_hash
               ORDER BY p.timestamp DESC LIMIT 25"""
        ).fetchall()
    except sqlite3.Error as e:
        add_log(f"Ledger read failed: {e}")
        raise HTTPException(status_code=503,
                            detail="The ledger database is unavailable. If the server was recently "
                                   "updated, restart it so the schema migration can run.")
    finally:
        conn.close()
    records = []
    for r in rows:
        tx = r[5]
        records.append({
            "title": r[0], "author": clean_author_name(r[1]), "score": r[2],
            "eval_hash": r[3], "timestamp": r[4],
            "tx_hash": tx, "explorer_url": get_sepolia_explorer_url(tx, "tx"),
            "settled": bool(tx and isinstance(tx, str) and tx.startswith("0x") and len(tx) == 66),
            "zk_proof": r[6], "piq": r[7],
            "block_height": r[8], "block_hash": r[9], "previous_hash": r[10],
            "validator_node": r[11], "por_proof": r[12], "model_used": r[13],
            "formulas_hash": r[14],
        })
    return {"records": records, "chain": {
        "network": CHAIN_NAME, "chain_id": CHAIN_ID, "explorer": BLOCK_EXPLORER_URL,
    }}


@app.get("/api/explorer/dossier/{eval_hash}")
def explorer_dossier(eval_hash: str):
    conn = get_db_connection()
    try:
        row = conn.execute(f"SELECT {restrict_to_existing_columns(conn, EXPLORER_COLUMNS)} FROM papers_assessment p WHERE p.eval_hash = ?", (eval_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    return build_dossier_from_row(row)


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
if os.path.isdir(_FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=8000, reload=True)