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

import requests
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, HTMLResponse, StreamingResponse, PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from web3 import Web3
from eth_account.messages import encode_defunct

from config import (
    BASE_DIR, PIQ_CONTRACT_ADDRESS, REGISTRY_CONTRACT_ADDRESS, HOT_TOPICS,
    ORCID_CLIENT_ID, ORCID_CLIENT_SECRET, ORCID_REDIRECT_URI, FRONTEND_ORIGIN, OWNER_ID,
    ENVIRONMENT, IS_PRODUCTION, ALLOWED_ORIGINS, MAX_UPLOAD_MB, FREE_EVALS_PER_IP,
    RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS, ENABLE_SCILEM_LOCAL_MODEL, config_summary,
    SCILEM_DISABLED_NOTICE, PIQ_PROCESSING_FEE, DONATION_WALLET,
    CHAIN_ID, CHAIN_NAME, CHAIN_CURRENCY, BLOCK_EXPLORER_URL,
)
from database import (
    get_db_connection, get_free_evals_used, increment_free_evals_used,
    get_piq_balance, charge_piq_fee, refund_piq_fee, get_piq_fee_history,
)
from ledger import restore_state_from_web3, get_sepolia_explorer_url, get_chain_status
from integrations import (
    clean_author_name, is_likely_institution, fetch_doi_metadata,
    fetch_semantic_scholar_pdf, download_pdf_from_url, fetch_core_text_by_doi,
    create_virtual_pdf_from_text, search_openalex_topics,
)
from brain import (
    process_single_pdf, generate_rebuttal_strategy, PidyneLSTM,
    PidyneBlockchainDataset, reset_scilem, evaluate_scilem_analysis_report,
)

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader

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


@app.get("/api/auth/orcid/login-url")
def orcid_login_url(wallet: Optional[str] = None):
    state_payload = wallet if wallet and w3.is_address(wallet) else "none"
    url = (
        f"https://orcid.org/oauth/authorize?client_id={ORCID_CLIENT_ID}"
        f"&response_type=code&scope=/authenticate&redirect_uri={ORCID_REDIRECT_URI}"
        f"&state={state_payload}"
    )
    return {"url": url}


@app.get("/api/auth/orcid/callback")
def orcid_callback(code: Optional[str] = None, state: Optional[str] = None):
    wallet_qs = ""
    if state and state != "none" and w3.is_address(state):
        wallet_qs = f"&wallet={w3.to_checksum_address(state)}"

    if not code:
        return RedirectResponse(f"{FRONTEND_ORIGIN}/?orcid_error=missing_code")

    try:
        res = requests.post(
            "https://orcid.org/oauth/token",
            data={
                "client_id": ORCID_CLIENT_ID,
                "client_secret": ORCID_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": ORCID_REDIRECT_URI,
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
                return RedirectResponse(f"{FRONTEND_ORIGIN}/?orcid={real_orcid}&orcid_name={name_qs}{wallet_qs}")
        err_desc = res.json().get("error_description", "Invalid Code") if res.content else "Invalid Code"
        add_log(f"ORCID Auth Error: {err_desc}")
        return RedirectResponse(f"{FRONTEND_ORIGIN}/?orcid_error={urllib.parse.quote(err_desc)}")
    except Exception as e:
        add_log(f"Failed to connect to ORCID API: {e}")
        return RedirectResponse(f"{FRONTEND_ORIGIN}/?orcid_error={urllib.parse.quote(str(e))}")


def _normalize_identity(wallet: Optional[str], orcid: Optional[str]):
    clean_wallet = w3.to_checksum_address(wallet) if wallet and w3.is_address(wallet) else ""
    return clean_wallet, (orcid or "").strip()


@app.get("/api/user/piq-total")
def user_piq_total(wallet: Optional[str] = None, orcid: Optional[str] = None):
    """Lifetime piQ awarded, plus the fee-adjusted spendable balance the
    assessment pipeline actually charges against."""
    clean_wallet, clean_orcid = _normalize_identity(wallet, orcid)
    if not clean_wallet and not clean_orcid:
        return {
            "total_piq": 0.0, "minted": 0.0, "fees_paid": 0.0, "balance": 0.0,
            "fee_per_paper": PIQ_PROCESSING_FEE, "papers_affordable": 0,
        }
    bal = get_piq_balance(clean_wallet, clean_orcid)
    return {
        "total_piq": bal["minted"],
        "minted": bal["minted"],
        "fees_paid": bal["fees_paid"],
        "balance": bal["balance"],
        "fee_per_paper": PIQ_PROCESSING_FEE,
        "papers_affordable": int(bal["balance"] // PIQ_PROCESSING_FEE) if PIQ_PROCESSING_FEE > 0 else 0,
    }


@app.get("/api/user/piq-ledger")
def user_piq_ledger(wallet: Optional[str] = None, orcid: Optional[str] = None):
    clean_wallet, clean_orcid = _normalize_identity(wallet, orcid)
    if not clean_wallet and not clean_orcid:
        return {"entries": []}
    return {"entries": get_piq_fee_history(clean_wallet, clean_orcid)}


# ---------------------------------------------------------------------------
# 2b. CHAIN STATUS & DONATIONS
# ---------------------------------------------------------------------------
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
@app.get("/api/stats/count")
def stats_count():
    conn = get_db_connection()
    try:
        n = conn.execute("SELECT COUNT(*) FROM papers_assessment").fetchone()[0]
    finally:
        conn.close()
    return {"total_analyzed": n}


def _item_from_result(res, filename):
    consensus = res[19] if isinstance(res[19], dict) else {}
    scores = res[8] or {}
    return {
        "judge_metadata": consensus.get("_judge_metadata", {}),
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
        "scores_dict": res[8],
        "eval_hash": res[9],
        "piq": res[10],
        "tx_hash": res[11],
        "zk_proof": res[12],
        "h_idx": res[14],
        "i10_idx": res[15],
        "repro_score": res[16],
        "filename": filename,
        "warnings": res[18],
        "consensus_raw": res[19],
        "evidence_report_text": res[20],
        "scilem_rating": res[21],
    }


def _resolve_pdf_bytes(doi: str = "", pdf_url: str = ""):
    """Shared resolution chain: try a known PDF URL directly, then DOI
    metadata, then Semantic Scholar, then a CORE full-text fallback wrapped
    into a virtual PDF. Used by both the single-DOI intake and the
    auto-discovery batch below so the two paths can't silently drift apart."""
    doi = (doi or "").strip()
    pdf_url = (pdf_url or "").strip()
    try:
        if pdf_url:
            pdf_bytes = download_pdf_from_url(pdf_url)
            if pdf_bytes:
                return pdf_bytes
        if doi:
            metadata = fetch_doi_metadata(doi)
            pdf_bytes = download_pdf_from_url(metadata["pdf_url"]) if metadata and metadata.get("pdf_url") else None
            if pdf_bytes:
                return pdf_bytes
            pdf_bytes = download_pdf_from_url(fetch_semantic_scholar_pdf(doi))
            if pdf_bytes:
                return pdf_bytes
            pdf_bytes = create_virtual_pdf_from_text(fetch_core_text_by_doi(doi))
            if pdf_bytes:
                return pdf_bytes
    except Exception as e:
        add_log(f"Resolve error (doi={doi or 'none'}): {e}")
    return None


def _run_assessment_stream(files: List[tuple], doi: Optional[str], include_doi: bool,
                            discover_papers: List[dict], user_id: str, book_address: str,
                            fee_wallet: str = "", fee_orcid: str = "", charge_fees: bool = False):
    """Generator yielding NDJSON status/result lines, mirroring the old
    st.status(...) 'Analyzing X...' live progress box.

    Each paper is billed the flat PIQ_PROCESSING_FEE at the moment it is
    about to be processed. Billing per-paper rather than per-request means a
    batch that runs out of balance halfway through stops cleanly, and a paper
    whose source could never be retrieved is refunded rather than charged for
    work that was never done.
    """

    def line(obj):
        return json.dumps(obj) + "\n"

    fee = PIQ_PROCESSING_FEE

    def take_fee(label: str):
        """Returns (ok, ndjson_lines_to_emit)."""
        if not charge_fees or fee <= 0:
            return True, []
        if charge_piq_fee(fee, fee_wallet, fee_orcid, reason=f"Processing fee — {label[:120]}"):
            bal = get_piq_balance(fee_wallet, fee_orcid)
            return True, [line({
                "type": "fee",
                "message": f"Charged {fee:.2f} piQ processing fee. Remaining balance: {bal['balance']:.2f} piQ.",
                "amount": fee, "balance": bal["balance"],
            })]
        bal = get_piq_balance(fee_wallet, fee_orcid)
        return False, [line({
            "type": "fee_error",
            "message": (
                f"Insufficient piQ balance to process '{label[:80]}'. "
                f"Each paper costs {fee:.2f} piQ; your balance is {bal['balance']:.2f} piQ."
            ),
            "balance": bal["balance"], "required": fee,
        })]

    def give_back(label: str):
        if charge_fees and fee > 0:
            refund_piq_fee(fee, fee_wallet, fee_orcid, reason=f"Refund — source unavailable for {label[:100]}")
            return [line({
                "type": "fee",
                "message": f"Refunded {fee:.2f} piQ — the source for '{label[:60]}' could not be retrieved.",
                "amount": fee,
            })]
        return []

    yield line({"type": "status", "message": "Initializing assessment pipeline..."})
    if charge_fees and fee > 0:
        bal = get_piq_balance(fee_wallet, fee_orcid)
        yield line({"type": "status", "message":
                    f"Processing fee: {fee:.2f} piQ per paper. Available balance: {bal['balance']:.2f} piQ."})

    if include_doi and doi and doi.strip():
        doi = doi.strip()
        ok, msgs = take_fee(f"DOI {doi}")
        for m in msgs:
            yield m
        if not ok:
            yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
            return
        yield line({"type": "status", "message": f"Resolving DOI: {doi}..."})
        pdf_bytes = _resolve_pdf_bytes(doi=doi)

        if pdf_bytes:
            yield line({"type": "status", "message": "Assessing document..."})
            res = process_single_pdf(pdf_bytes, f"DOI_{doi}.pdf", "", user_id, book_address, provided_doi=doi)
            if res:
                item = _item_from_result(res, f"DOI_{doi}.pdf")
                item["fee_charged"] = fee if charge_fees else 0.0
                add_log(f"Assessed DOI {doi}: score {item['score']:.2f}")
                yield line({"type": "result", "item": item})
        else:
            for m in give_back(f"DOI {doi}"):
                yield m
            yield line({"type": "download_error", "doi": doi, "url": f"https://doi.org/{doi}"})

    for paper in discover_papers:
        title = (paper.get("title") or "Untitled").strip()
        p_doi = (paper.get("doi") or "").strip()
        pdf_url = (paper.get("pdf_url") or "").strip()

        ok, msgs = take_fee(title)
        for m in msgs:
            yield m
        if not ok:
            yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
            return

        yield line({"type": "status", "message": f"Retrieving open-access paper: {title[:80]}..."})
        pdf_bytes = _resolve_pdf_bytes(doi=p_doi, pdf_url=pdf_url)

        fname = f"Discovered_{p_doi or title[:60]}.pdf"
        if pdf_bytes:
            yield line({"type": "status", "message": f"Assessing: {title[:80]}..."})
            res = process_single_pdf(pdf_bytes, fname, "", user_id, book_address, provided_doi=p_doi or "None")
            if res:
                item = _item_from_result(res, fname)
                item["fee_charged"] = fee if charge_fees else 0.0
                add_log(f"Assessed discovered paper '{title[:60]}': score {item['score']:.2f}")
                yield line({"type": "result", "item": item})
        else:
            for m in give_back(title):
                yield m
            yield line({"type": "download_error", "doi": p_doi or title, "url": f"https://doi.org/{p_doi}" if p_doi else ""})

    for fname, raw_bytes in files:
        ok, msgs = take_fee(fname)
        for m in msgs:
            yield m
        if not ok:
            yield line({"type": "done", "message": "Stopped: insufficient piQ balance."})
            return

        yield line({"type": "status", "message": f"Analyzing {fname}..."})
        res = process_single_pdf(raw_bytes, fname, "", user_id, book_address)
        if res:
            item = _item_from_result(res, fname)
            item["fee_charged"] = fee if charge_fees else 0.0
            add_log(f"Assessed {fname}: score {item['score']:.2f}")
            yield line({"type": "result", "item": item})

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
):
    client_ip = get_client_ip(request)
    check_rate_limit(client_ip, bucket="assess")

    has_web3 = bool(wallet and w3.is_address(wallet))
    user_id = orcid if orcid else (wallet if has_web3 else "Anonymous")
    book_address = w3.to_checksum_address(wallet) if has_web3 else "0x0000000000000000000000000000000000000000"

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
                })
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="discover_papers must be valid JSON.")

    # Server-side free-trial gate — the browser's localStorage counter is a
    # convenience for the UI, not a security boundary (a user can clear it
    # trivially). This is the authoritative check.
    free_trial_active = False
    if not has_web3 and not orcid:
        used = get_free_evals_used(client_ip)
        if used >= FREE_EVALS_PER_IP:
            raise HTTPException(
                status_code=402,
                detail=f"Free trial limit ({FREE_EVALS_PER_IP}) reached for this connection. "
                       f"Connect a Web3 wallet in the sidebar to continue.",
            )
        free_trial_active = True

    max_bytes = int(MAX_UPLOAD_MB * 1024 * 1024)
    file_payload = []
    for f in files:
        if f.content_type and f.content_type not in ("application/pdf", "application/octet-stream"):
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is not a PDF file.")
        raw = await f.read()
        if len(raw) > max_bytes:
            raise HTTPException(status_code=413, detail=f"'{f.filename}' exceeds the {MAX_UPLOAD_MB}MB upload limit.")
        file_payload.append((f.filename, raw))

    paper_count = len(file_payload) + len(discover_list) + (1 if (include_doi and doi.strip()) else 0)

    # piQ processing fee. Identified users pay PIQ_PROCESSING_FEE per paper
    # out of their earned balance; users still on the free trial don't, since
    # they have no balance yet and the trial exists precisely to let them earn
    # their first piQ.
    fee_wallet, fee_orcid = _normalize_identity(wallet, orcid)
    charge_fees = bool((fee_wallet or fee_orcid) and not free_trial_active and PIQ_PROCESSING_FEE > 0)

    if charge_fees and paper_count:
        bal = get_piq_balance(fee_wallet, fee_orcid)
        required = round(PIQ_PROCESSING_FEE * paper_count, 4)
        if bal["balance"] + 1e-9 < PIQ_PROCESSING_FEE:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Insufficient piQ balance. Processing costs {PIQ_PROCESSING_FEE:.2f} piQ per paper "
                    f"and your balance is {bal['balance']:.2f} piQ. Earn piQ by having your own "
                    f"manuscripts assessed."
                ),
            )
        if bal["balance"] + 1e-9 < required:
            affordable = int(bal["balance"] // PIQ_PROCESSING_FEE)
            add_log(
                f"Partial batch: balance {bal['balance']:.2f} piQ covers {affordable}/{paper_count} papers."
            )

    if free_trial_active and paper_count:
        increment_free_evals_used(client_ip)

    def gen():
        yield from _run_assessment_stream(
            file_payload, doi, include_doi, discover_list, user_id, book_address,
            fee_wallet=fee_wallet, fee_orcid=fee_orcid, charge_fees=charge_fees,
        )

    return StreamingResponse(gen(), media_type="application/x-ndjson")


# ---------------------------------------------------------------------------
# 3b. AUTO-DISCOVERY — search open-access literature (OpenAlex) to feed
#     straight into the assessment pipeline above
# ---------------------------------------------------------------------------
@app.get("/api/discover/hot-topics")
def discover_hot_topics():
    return {"topics": HOT_TOPICS}


@app.get("/api/discover/search")
def discover_search(
    request: Request,
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(default=15, ge=1, le=30),
):
    check_rate_limit(get_client_ip(request), bucket="discover")
    try:
        results = search_openalex_topics(q, limit=limit)
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
    pdf_bytes = create_virtual_pdf_from_text(req.paper_text, title="Pasted Manuscript Text")
    if not pdf_bytes:
        raise HTTPException(status_code=500, detail="Could not convert text into a processable document.")
    res = process_single_pdf(pdf_bytes, "Pasted_Text.pdf", "", "Anonymous")
    if not res:
        raise HTTPException(status_code=500, detail="Assessment failed.")
    item = _item_from_result(res, "Pasted_Text.pdf")
    add_log(f"Assessed pasted text: score {item['score']:.2f}")
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


@app.get("/api/scilem/status")
def scilem_status():
    """Lets the frontend disable the assistant UI up front rather than
    letting the user type a question and only then be told it won't work."""
    return {
        "enabled": ENABLE_SCILEM_LOCAL_MODEL,
        "notice": None if ENABLE_SCILEM_LOCAL_MODEL else SCILEM_DISABLED_NOTICE,
    }


@app.post("/api/scilem/chat")
def scilem_chat(req: ScilemChatRequest, request: Request):
    if not ENABLE_SCILEM_LOCAL_MODEL:
        # 503 rather than 200: the feature is genuinely unavailable, and
        # saying so in the status code keeps clients from treating the
        # notice text as a real model answer.
        raise HTTPException(status_code=503, detail=SCILEM_DISABLED_NOTICE)
    check_rate_limit(get_client_ip(request), bucket="scilem")
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty.")
    if len(req.prompt) > 4000:
        raise HTTPException(status_code=413, detail="Prompt is too long (max 4,000 characters).")
    return {"response": evaluate_scilem_analysis_report(req.prompt)}


class ScilemResetRequest(BaseModel):
    wallet: str


@app.post("/api/scilem/reset")
def scilem_reset(req: ScilemResetRequest):
    if not req.wallet or req.wallet.lower() != OWNER_ID.lower():
        raise HTTPException(status_code=403, detail="Only the Web3 owner wallet may reset Scilem.")
    msg = reset_scilem()
    add_log(msg)
    return {"message": msg}


# ---------------------------------------------------------------------------
# 6. PIDYNE FORECAST  (LSTM epoch-weight forecasting)
# ---------------------------------------------------------------------------
def get_criteria_info(weights):
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

WEIGHT_MIN = 0.05
# The largest a single weight can be while the other seven still hold their
# floor and all eight sum to 8.0. Clipping to anything tighter than this is
# infeasible: renormalizing after the clip just pushes the value back over
# the cap, so the stated bound would be quietly violated.
WEIGHT_MAX = 8.0 - (7 * WEIGHT_MIN)


def _normalize_weights(vec):
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
    """Trains the Pidyne LSTM on the recorded per-block criteria weights and
    projects the next epoch's weighting.

    The chart this feeds used to be meaningless because every block was
    written with a constant [1.0] * 8 weight vector — eight perfectly flat,
    perfectly overlapping lines. Blocks now record the criteria weighting each
    assessed manuscript's evidence profile implies (see
    brain.derive_epoch_weights), so the series carries real signal, and this
    endpoint returns the observed history plus the forecast point explicitly
    marked, along with the per-criterion delta and trend direction.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT block_height, w1, w2, w3, w4, w5, w6, w7, w8, timestamp
               FROM blockchain_por_weights ORDER BY block_height ASC"""
        ).fetchall()
    finally:
        conn.close()

    if len(rows) < 3:
        return {
            "ready": False,
            "message": (
                f"The Pidyne forecaster needs at least 3 ledger blocks to learn a trend; "
                f"{len(rows)} recorded so far. Assess a few manuscripts to build history."
            ),
            "blocks_recorded": len(rows), "blocks_required": 3,
            "history": [], "forecast": None, "criteria": [],
        }

    weight_matrix = np.array([[safe_float(v, 1.0) for v in r[1:9]] for r in rows], dtype=np.float32)

    # A constant series means the ledger predates the weight fix. Say so
    # plainly rather than drawing eight flat lines and calling it a forecast.
    if float(np.max(np.ptp(weight_matrix, axis=0))) < 1e-6:
        return {
            "ready": False,
            "message": (
                "All recorded blocks carry identical criteria weights, so there is no trend to "
                "forecast. These blocks were written before per-block weighting was enabled — "
                "assess new manuscripts to begin building a meaningful series."
            ),
            "blocks_recorded": len(rows), "blocks_required": 3,
            "history": [], "forecast": None, "criteria": [],
        }

    actual_lookback = max(1, min(lookback, len(rows) - 1))

    dataset = PidyneBlockchainDataset(weight_matrix, actual_lookback)
    dataloader = DataLoader(dataset, batch_size=min(4, max(1, len(dataset))), shuffle=False)
    model = PidyneLSTM()
    optimizer = optim.Adam(model.parameters(), lr=0.01)
    loss_fn = nn.MSELoss()

    model.train()
    final_loss = 0.0
    for _ in range(300):
        epoch_loss = 0.0
        for seq, target in dataloader:
            optimizer.zero_grad()
            loss = loss_fn(model(seq), target)
            loss.backward()
            optimizer.step()
            epoch_loss += float(loss.item())
        final_loss = epoch_loss / max(1, len(dataloader))

    model.eval()
    with torch.no_grad():
        window = torch.tensor(weight_matrix[-actual_lookback:], dtype=torch.float32).unsqueeze(0)
        raw_pred = model(window).squeeze().numpy()

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

    next_weights = _normalize_weights(projected)

    hist_slice = rows[-(actual_lookback + 1):]
    history = []
    for r in hist_slice:
        entry = {"block": int(r[0]), "label": f"Block {int(r[0])}", "timestamp": r[9], "is_forecast": False}
        for i, key in enumerate(CRITERIA_KEYS):
            entry[key] = round(safe_float(r[1 + i], 1.0), 5)
        history.append(entry)

    next_block = int(rows[-1][0]) + 1
    forecast_point = {"block": next_block, "label": f"Block {next_block} (forecast)",
                      "timestamp": None, "is_forecast": True}
    for i, key in enumerate(CRITERIA_KEYS):
        forecast_point[key] = round(float(next_weights[i]), 5)

    criteria = get_criteria_info(next_weights)
    for i, c in enumerate(criteria):
        current = float(last[i])
        delta = float(next_weights[i]) - current
        c["current_weight"] = round(current, 5)
        c["delta"] = round(delta, 5)
        c["delta_pct"] = round((delta / current) * 100.0, 2) if current else 0.0
        c["trend"] = "rising" if delta > 0.01 else ("falling" if delta < -0.01 else "stable")

    ranked = sorted(criteria, key=lambda c: c["weight"], reverse=True)
    mover = max(criteria, key=lambda c: abs(c["delta"]))
    interpretation = (
        f"Across the last {len(hist_slice)} ledger blocks, {ranked[0]['id']} ({ranked[0]['title']}) "
        f"carries the most forecast weight at {ranked[0]['weight']:.3f}, while {ranked[-1]['id']} "
        f"({ranked[-1]['title']}) carries the least at {ranked[-1]['weight']:.3f}. The largest "
        f"projected shift is {mover['id']} ({mover['title']}), {mover['trend']} by "
        f"{abs(mover['delta_pct']):.1f}%. Higher weight means the assessed corpus is producing "
        f"stronger, more consistent evidence for that criterion."
    )

    return {
        "ready": True,
        "history": history,
        "forecast": forecast_point,
        "criteria": criteria,
        "raw_sum": float(np.sum(next_weights)),
        "lookback_used": actual_lookback,
        "blocks_recorded": len(rows),
        "training_loss": round(final_loss, 6),
        "interpretation": interpretation,
        "top_criterion": ranked[0]["id"],
        "biggest_mover": mover["id"],
    }


# ---------------------------------------------------------------------------
# 7. ANALYTICS — leaderboard, top papers, map-of-science bubble network
# ---------------------------------------------------------------------------
MAJOR_SCIENCE_FIELDS = [
    "Computer Science", "Physics", "Chemistry", "Life Sciences",
    "Medical Sciences", "Earth Sciences", "Social Sciences",
    "Mathematics & Statistics", "Engineering & Technology",
]


def _aggregate_authors(rows):
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
    unique_authors = {r["author"] for r in _aggregate_authors(author_rows)}
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
    return {"fields": MAJOR_SCIENCE_FIELDS}


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

    results = _aggregate_authors(rows)
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


def refine_science_field(s):
    s_lower = s.lower()
    mapping = [
        (["blockchain", "smart contract", "crypto", "ledger"], "Computer Science > Blockchain & Distributed Systems"),
        (["machine learning", "deep learning", "neural", "ai", "artificial intelligence"], "Computer Science > Artificial Intelligence & Machine Learning"),
        (["algorithm", "software", "computation", "cyber", "data", "information"], "Computer Science > Algorithms & Software Engineering"),
        (["quantum", "optics", "photonics"], "Physics > Quantum Mechanics & Optics"),
        (["energy", "mechanics", "thermodynamics", "physics"], "Physics > Applied Mechanics & Energy Systems"),
        (["polymer", "catalysis", "molecule", "chemical", "chemistry"], "Chemistry > Chemical Synthesis & Molecular Catalysis"),
        (["genetics", "genomics", "gene", "biology"], "Life Sciences > Genetics & Genomics"),
        (["cellular", "protein", "molecular biology"], "Life Sciences > Molecular & Cellular Biology"),
        (["ecology", "ecosystem", "biodiversity"], "Life Sciences > Ecology & Evolutionary Biology"),
        (["clinical", "hospital", "patient", "disease", "pharmac", "medical", "medicine"], "Medical Sciences > Clinical Medicine & Pharmacology"),
        (["biomedical", "neuroscience", "cardiac"], "Medical Sciences > Biomedical Research"),
        (["climate", "carbon", "atmosphere", "meteorology", "earth"], "Earth Sciences > Climate Science & Meteorology"),
        (["geology", "ocean", "seismic"], "Earth Sciences > Geology & Earth Systems"),
        (["economics", "finance", "market", "social"], "Social Sciences > Economics & Quantitative Finance"),
        (["sociology", "psychology", "policy", "management"], "Social Sciences > Behavioral & Policy Studies"),
        (["math", "statistics", "algebra", "probability", "calculus"], "Mathematics & Statistics > Applied Mathematics & Statistics"),
        (["engineering", "robotics", "materials", "civil", "electrical"], "Engineering & Technology > Applied Engineering & Materials Science"),
    ]
    for keywords, label in mapping:
        if any(k in s_lower for k in keywords):
            return label
    return f"Engineering & Technology > Applied Technical Research ({s.title()})"


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
    exclude_terms = {"general", "general science", "unspecified domain", "unspecified sub-domain", "core research topic"}
    for fields_json, subfields_json, final_score, author_str in rows:
        cleaned_author = clean_author_name(author_str)
        if author and author != "All Authors" and author not in cleaned_author:
            continue
        score = safe_float(final_score, 50.0)
        if score < min_score or score > max_score:
            continue
        try:
            raw_subfields = [s.title().strip() for s in json.loads(subfields_json)]
        except Exception:
            continue
        for rs in raw_subfields:
            if rs and rs.lower() not in exclude_terms:
                s = refine_science_field(rs)
                major = s.split(">")[0].strip()
                if selected_fields and major not in selected_fields:
                    continue
                agg = topic_aggregates.setdefault(s, {"weight_sum": 0.0, "frequency": 0})
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
   p.warnings_json, p.judge_metadata, p.timestamp, p.doi, p.user_id, p.eth_book"""

CRITERIA_TITLES = {
    "C1": "Semantic Originality", "C2": "Methodological Rigor", "C3": "Interdisciplinary Synergy",
    "C4": "Societal Impact", "C5": "Open Science", "C6": "Literature Integration",
    "C7": "Empirical Density", "C8": "Future Actionability",
}


def _safe_json(raw, default):
    if not raw:
        return default
    try:
        parsed = json.loads(raw)
        return parsed if parsed is not None else default
    except Exception:
        return default


def _row_to_dossier(r):
    consensus = _safe_json(r[20], {})
    judge_meta = _safe_json(r[24], {}) or consensus.get("_judge_metadata", {}) or {}
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
        "warnings": _safe_json(r[23], []),
        "judge_metadata": judge_meta,
        "timestamp": r[25], "doi": r[26], "submitted_by": r[27], "eth_book": r[28],
        "explorer_url": get_sepolia_explorer_url(r[14], "tx"),
        "fee_charged": PIQ_PROCESSING_FEE,
    }


@app.get("/api/explorer/search")
def explorer_search(q: str = Query(default="")):
    conn = get_db_connection()
    try:
        if q.strip():
            q_term = f"%{q.strip()}%"
            rows = conn.execute(
                f"""SELECT {EXPLORER_COLUMNS}
                    FROM papers_assessment p
                    LEFT JOIN blockchain_por_weights b ON p.eval_hash = b.eval_hash
                    WHERE b.block_hash LIKE ? OR p.eval_hash LIKE ? OR p.title LIKE ? OR p.author_name LIKE ?
                    LIMIT 10""",
                (q_term, q_term, q_term, q_term),
            ).fetchall()
        else:
            rows = conn.execute(f"SELECT {EXPLORER_COLUMNS} FROM papers_assessment p ORDER BY p.timestamp DESC LIMIT 20").fetchall()
    finally:
        conn.close()
    return {"records": [_row_to_dossier(r) for r in rows]}


@app.get("/api/explorer/latest")
def explorer_latest():
    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT title, author_name, final_score, eval_hash FROM papers_assessment ORDER BY timestamp DESC LIMIT 20"
        ).fetchall()
    finally:
        conn.close()
    return {"records": [{"title": r[0], "author": r[1], "score": r[2], "eval_hash": r[3]} for r in rows]}


@app.get("/api/explorer/dossier/{eval_hash}")
def explorer_dossier(eval_hash: str):
    conn = get_db_connection()
    try:
        row = conn.execute(f"SELECT {EXPLORER_COLUMNS} FROM papers_assessment p WHERE p.eval_hash = ?", (eval_hash,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    return _row_to_dossier(row)


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
