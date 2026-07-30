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
    RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS, config_summary,
)
from database import (
    get_db_connection, get_free_evals_used, increment_free_evals_used,
)
from ledger import restore_state_from_web3, get_sepolia_explorer_url
from integrations import (
    clean_author_name, is_likely_institution, fetch_doi_metadata,
    fetch_semantic_scholar_pdf, download_pdf_from_url, fetch_core_text_by_doi,
    create_virtual_pdf_from_text,
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


@app.get("/api/user/piq-total")
def user_piq_total(wallet: Optional[str] = None, orcid: Optional[str] = None):
    clauses, params = [], []
    if wallet and w3.is_address(wallet):
        clauses.append("eth_book = ?")
        params.append(w3.to_checksum_address(wallet))
    if orcid:
        clauses.append("user_id = ?")
        params.append(orcid)
    if not clauses:
        return {"total_piq": 0.0}
    conn = get_db_connection()
    try:
        rows = conn.execute(
            f"SELECT DISTINCT eval_hash, piq_minted FROM papers_assessment WHERE {' OR '.join(clauses)}",
            tuple(params),
        ).fetchall()
    finally:
        conn.close()
    return {"total_piq": sum(safe_float(r[1], 0.0) for r in rows if r[1])}


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
    return {
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


def _run_assessment_stream(files: List[tuple], doi: Optional[str], include_doi: bool,
                            user_id: str, book_address: str):
    """Generator yielding NDJSON status/result lines, mirroring the old
    st.status(...) 'Analyzing X...' live progress box."""

    def line(obj):
        return json.dumps(obj) + "\n"

    yield line({"type": "status", "message": "Initializing Assessment Pipeline..."})

    if include_doi and doi and doi.strip():
        doi = doi.strip()
        yield line({"type": "status", "message": f"Resolving DOI: {doi}..."})
        try:
            metadata = fetch_doi_metadata(doi)
            pdf_bytes = download_pdf_from_url(metadata["pdf_url"]) if metadata and metadata.get("pdf_url") else None
            if not pdf_bytes:
                pdf_bytes = download_pdf_from_url(fetch_semantic_scholar_pdf(doi))
            if not pdf_bytes:
                pdf_bytes = create_virtual_pdf_from_text(fetch_core_text_by_doi(doi))
        except Exception as e:
            pdf_bytes = None
            add_log(f"DOI resolve error: {e}")

        if pdf_bytes:
            yield line({"type": "status", "message": "Assessing document..."})
            res = process_single_pdf(pdf_bytes, f"DOI_{doi}.pdf", "", user_id, book_address, provided_doi=doi)
            if res:
                item = _item_from_result(res, f"DOI_{doi}.pdf")
                add_log(f"Assessed DOI {doi}: score {item['score']:.2f}")
                yield line({"type": "result", "item": item})
        else:
            yield line({"type": "download_error", "doi": doi, "url": f"https://doi.org/{doi}"})

    for fname, raw_bytes in files:
        yield line({"type": "status", "message": f"Analyzing {fname}..."})
        res = process_single_pdf(raw_bytes, fname, "", user_id, book_address)
        if res:
            item = _item_from_result(res, fname)
            add_log(f"Assessed {fname}: score {item['score']:.2f}")
            yield line({"type": "result", "item": item})

    yield line({"type": "done", "message": "Complete."})


@app.post("/api/assess/stream")
async def assess_stream(
    request: Request,
    files: List[UploadFile] = File(default=[]),
    doi: str = Form(default=""),
    include_doi: bool = Form(default=False),
    wallet: str = Form(default=""),
    orcid: str = Form(default=""),
):
    client_ip = get_client_ip(request)
    check_rate_limit(client_ip, bucket="assess")

    has_web3 = bool(wallet and w3.is_address(wallet))
    user_id = orcid if orcid else (wallet if has_web3 else "Anonymous")
    book_address = w3.to_checksum_address(wallet) if has_web3 else "0x0000000000000000000000000000000000000000"

    # Server-side free-trial gate — the browser's localStorage counter is a
    # convenience for the UI, not a security boundary (a user can clear it
    # trivially). This is the authoritative check.
    if not has_web3:
        used = get_free_evals_used(client_ip)
        if used >= FREE_EVALS_PER_IP:
            raise HTTPException(
                status_code=402,
                detail=f"Free trial limit ({FREE_EVALS_PER_IP}) reached for this connection. "
                       f"Connect a Web3 wallet in the sidebar to continue.",
            )

    max_bytes = int(MAX_UPLOAD_MB * 1024 * 1024)
    file_payload = []
    for f in files:
        if f.content_type and f.content_type not in ("application/pdf", "application/octet-stream"):
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is not a PDF file.")
        raw = await f.read()
        if len(raw) > max_bytes:
            raise HTTPException(status_code=413, detail=f"'{f.filename}' exceeds the {MAX_UPLOAD_MB}MB upload limit.")
        file_payload.append((f.filename, raw))

    if not has_web3 and (file_payload or (include_doi and doi.strip())):
        increment_free_evals_used(client_ip)

    def gen():
        yield from _run_assessment_stream(file_payload, doi, include_doi, user_id, book_address)

    return StreamingResponse(gen(), media_type="application/x-ndjson")


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


@app.post("/api/scilem/chat")
def scilem_chat(req: ScilemChatRequest, request: Request):
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


@app.get("/api/forecast")
def run_forecast(lookback: int = Query(default=3, ge=1, le=5)):
    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT w1, w2, w3, w4, w5, w6, w7, w8 FROM blockchain_por_weights ORDER BY block_height ASC"
        ).fetchall()
    finally:
        conn.close()

    if len(rows) < 2:
        return {"ready": False, "message": "Not enough blockchain data to train meta-model. Need at least 2 blocks.",
                "history": [], "criteria": []}

    actual_lookback = max(1, min(lookback, len(rows) - 1))
    weight_data = np.array([[safe_float(v, 1.0) for v in r] for r in rows], dtype=np.float32)

    dataset = PidyneBlockchainDataset(weight_data, actual_lookback)
    dataloader = DataLoader(dataset, batch_size=min(4, max(1, len(dataset))), shuffle=False)
    model = PidyneLSTM()
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    model.train()
    for _ in range(300):
        for seq, target in dataloader:
            optimizer.zero_grad()
            loss = nn.MSELoss()(model(seq), target)
            loss.backward()
            optimizer.step()
    model.eval()
    with torch.no_grad():
        raw_pred = model(torch.tensor(weight_data[-actual_lookback:], dtype=torch.float32).unsqueeze(0)).squeeze().numpy()
        predicted = weight_data[-1] + (raw_pred - weight_data[-1]) * 20.0
        next_weights = np.clip(predicted, 0.01, 7.9) * (8.0 / np.sum(np.clip(predicted, 0.01, 7.9)))

    hist_slice = rows[-(actual_lookback + 1):]
    history = [
        {"block": i, "C1": r[0], "C2": r[1], "C3": r[2], "C4": r[3], "C5": r[4], "C6": r[5], "C7": r[6], "C8": r[7]}
        for i, r in enumerate(hist_slice)
    ]

    return {
        "ready": True,
        "history": history,
        "criteria": get_criteria_info(next_weights),
        "raw_sum": float(sum(next_weights)),
    }


# ---------------------------------------------------------------------------
# 7. ANALYTICS — leaderboard, top papers, map-of-science bubble network
# ---------------------------------------------------------------------------
@app.get("/api/analytics/leaderboard")
def analytics_leaderboard():
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT author_name, piq_minted FROM papers_assessment").fetchall()
    finally:
        conn.close()
    author_piq = {}
    for author_str, piq in rows:
        ca = clean_author_name(author_str)
        if ca and ca.lower() not in ["unidentified", "unknown"] and not is_likely_institution(ca):
            for a in [x.strip() for x in ca.split(",")]:
                author_piq[a] = author_piq.get(a, 0.0) + safe_float(piq, 0.0)
    ranked = sorted(author_piq.items(), key=lambda x: x[1], reverse=True)[:20]
    return {"rankings": [{"author": a, "piq": p} for a, p in ranked]}


@app.get("/api/analytics/top-papers")
def analytics_top_papers():
    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT title, author_name, final_score FROM papers_assessment ORDER BY final_score DESC LIMIT 20"
        ).fetchall()
    finally:
        conn.close()
    return {"papers": [{"title": r[0], "author": r[1], "score": r[2]} for r in rows]}


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
def analytics_map(author: str = Query(default="All Authors")):
    """Returns bubble/network data as JSON (nodes + edges + legend rows) so
    the frontend can render it with vis-network (loaded from CDN) instead of
    the old server-side PyVis-generated iframe HTML."""
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
        try:
            raw_subfields = [s.title().strip() for s in json.loads(subfields_json)]
        except Exception:
            continue
        score = safe_float(final_score, 50.0)
        for rs in raw_subfields:
            if rs and rs.lower() not in exclude_terms:
                s = refine_science_field(rs)
                agg = topic_aggregates.setdefault(s, {"weight_sum": 0.0, "frequency": 0})
                agg["weight_sum"] += score
                agg["frequency"] += 1

    if not topic_aggregates:
        topic_aggregates["Computer Science > Algorithms & Software Engineering"] = {"weight_sum": 50.0, "frequency": 1}
    if len(topic_aggregates) > 15:
        sorted_topics = sorted(topic_aggregates.items(), key=lambda x: (x[1]["frequency"], x[1]["weight_sum"]), reverse=True)
        topic_aggregates = dict(sorted_topics[:15])

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
        })
        legend.append({"topic": topic, "color": color_map[topic], "frequency": metrics["frequency"], "avg_weight": round(avg_weight, 1)})

    edges = []
    for i, t1 in enumerate(unique_topics):
        for j, t2 in enumerate(unique_topics):
            if i < j and t1.split(">")[0].strip() == t2.split(">")[0].strip():
                edges.append({"from": t1, "to": t2})

    legend.sort(key=lambda x: x["frequency"], reverse=True)
    return {"nodes": nodes, "edges": edges, "legend": legend}


# ---------------------------------------------------------------------------
# 8. LEDGER EXPLORER
# ---------------------------------------------------------------------------
EXPLORER_COLUMNS = """p.title, p.author_name, p.filename, p.final_score, p.logic_score,
   p.c1, p.c2, p.c3, p.c4, p.c5, p.c6, p.c7, p.c8,
   p.piq_minted, p.tx_hash, p.zk_proof, p.mdar_adherence_score,
   p.rrid_valid_count, p.reproducibility_score, p.eval_hash,
   p.consensus_data, p.evidence_report, p.scilem_score"""


def _row_to_dossier(r):
    return {
        "title": r[0], "author_name": r[1], "filename": r[2], "score": r[3], "logic_integrity": r[4],
        "scores_dict": {"C1": r[5], "C2": r[6], "C3": r[7], "C4": r[8], "C5": r[9], "C6": r[10], "C7": r[11], "C8": r[12]},
        "piq": r[13], "tx_hash": r[14], "zk_proof": r[15], "mdar_score": r[16], "rrid_count": r[17],
        "repro_score": r[18], "eval_hash": r[19],
        "consensus_raw": json.loads(r[20]) if r[20] else {}, "evidence_report_text": r[21] or "",
        "scilem_rating": r[22],
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
