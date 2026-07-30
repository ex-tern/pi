import os
import json
import hashlib

# ---------------------------------------------------------------------------
# .env loading (lightweight, no external dependency required).
# Put secrets in backend/.env (KEY=VALUE per line) or export real env vars.
# ---------------------------------------------------------------------------
_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_ENV_PATH):
    with open(_ENV_PATH, "r") as _f:
        for _line in _f:
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

PRIMARY_MODEL = "llama-3.3-70b-versatile"
FALLBACK_MODEL = "llama-3.1-8b-instant"
MAX_TEXT_TOKENS = 15000
EPOCH_BLOCK_SIZE = 5

WEB3_PROVIDER_URI = os.getenv("WEB3_PROVIDER_URI", "https://ethereum-sepolia-rpc.publicnode.com")
ETH_ADMIN_PRIVATE_KEY = os.getenv("ETH_ADMIN_PRIVATE_KEY", "")
PIQ_CONTRACT_ADDRESS = os.getenv("PIQ_CONTRACT_ADDRESS", "0xaE7a504aCF32ABf0E891B74bF39E4527999A6256")

# ---------------------------------------------------------------------------
# Ethereum network
# ---------------------------------------------------------------------------
# Sepolia testnet by default. Public RPC endpoints rate-limit and go down
# fairly often, so the ledger tries each of these in order and uses the first
# one that actually responds, rather than failing the whole chain integration
# because a single provider is having a bad day.
CHAIN_ID = int(os.getenv("CHAIN_ID", "11155111"))
CHAIN_NAME = os.getenv("CHAIN_NAME", "Sepolia")
CHAIN_CURRENCY = os.getenv("CHAIN_CURRENCY", "SepoliaETH")
BLOCK_EXPLORER_URL = os.getenv("BLOCK_EXPLORER_URL", "https://sepolia.etherscan.io")

_fallback_rpcs_raw = os.getenv("WEB3_FALLBACK_RPCS", "").strip()
if _fallback_rpcs_raw:
    WEB3_FALLBACK_RPCS = [u.strip() for u in _fallback_rpcs_raw.split(",") if u.strip()]
else:
    WEB3_FALLBACK_RPCS = [
        "https://ethereum-sepolia-rpc.publicnode.com",
        "https://rpc.sepolia.org",
        "https://sepolia.drpc.org",
        "https://1rpc.io/sepolia",
    ]
# The configured primary always gets tried first, without being duplicated.
WEB3_RPC_ENDPOINTS = [WEB3_PROVIDER_URI] + [u for u in WEB3_FALLBACK_RPCS if u != WEB3_PROVIDER_URI]

# ---------------------------------------------------------------------------
# piQ processing fee
# ---------------------------------------------------------------------------
# Every manuscript costs a flat fee, debited from the submitter's piQ balance.
# This replaced the old "stake 0.1 piQ" checkbox, which was purely cosmetic —
# nothing was ever escrowed, returned or accounted for.
PIQ_PROCESSING_FEE = float(os.getenv("PIQ_PROCESSING_FEE", "0.1"))

# Wallet that receives Support & Donate contributions.
DONATION_WALLET = os.getenv("DONATION_WALLET", "0x1Af8D9A120b02D0983590587364F8705e6942356")

# ---------------------------------------------------------------------------
# Free-tier challenge
# ---------------------------------------------------------------------------
# Proof-of-work is always on for anonymous submissions and needs no keys.
# Cloudflare Turnstile is an optional additional signal; leave blank to skip it.
TURNSTILE_SITE_KEY = os.getenv("TURNSTILE_SITE_KEY", "")
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY", "")
REQUIRE_PROOF_OF_WORK = os.getenv("REQUIRE_PROOF_OF_WORK", "true").strip().lower() not in ("false", "0", "no")

# Data directory (SQLite DB + PyTorch weights). Overridable so production
# deployments (Docker, systemd) can point it at a persistent volume instead
# of the service account's home directory.
BASE_DIR = os.path.expanduser(os.getenv("SCHOLARPI_DATA_DIR", "~/Scientometric_Pi_Index"))
os.makedirs(BASE_DIR, exist_ok=True)
DB_PATH = os.path.join(BASE_DIR, "pi_index_main.db")

# ---------------------------------------------------------------------------
# Production / deployment settings
# ---------------------------------------------------------------------------
# "development" (default) or "production". In production, error responses
# omit internal detail, and CORS defaults to FRONTEND_ORIGIN only instead of "*".
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"

# Comma-separated list of allowed CORS origins. Defaults to "*" in
# development for convenience, and to FRONTEND_ORIGIN only in production.
# Set explicitly (e.g. "https://scholarpi.example.com,https://app.example.com")
# to override either default.
_allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "").strip()
if _allowed_origins_raw:
    ALLOWED_ORIGINS = [o.strip() for o in _allowed_origins_raw.split(",") if o.strip()]
elif IS_PRODUCTION:
    ALLOWED_ORIGINS = []  # filled in below once FRONTEND_ORIGIN is known
else:
    ALLOWED_ORIGINS = ["*"]

# Max upload size per file (MB) enforced by the API before any parsing happens.
MAX_UPLOAD_MB = float(os.getenv("MAX_UPLOAD_MB", "25"))

# Free assessments allowed per client IP before a connected Web3 wallet is
# required, enforced server-side (in addition to the client-side UI gate).
FREE_EVALS_PER_IP = int(os.getenv("FREE_EVALS_PER_IP", "3"))

# Rolling window (seconds) + max requests for the lightweight in-memory rate
# limiter applied to the assessment endpoints.
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
RATE_LIMIT_MAX_REQUESTS = int(os.getenv("RATE_LIMIT_MAX_REQUESTS", "10"))

# The Scilem sidebar chat (/api/scilem/chat) lazily loads a ~1.1B parameter
# TinyLlama model on first use — several hundred MB to a few GB of RAM.
# That's fine on a real server, but it WILL crash a free-tier host with
# ~512MB of RAM (Render's free web service, for example). Set this to
# "false" on memory-constrained deployments; the endpoint then returns a
# friendly message instead of trying to load the model and getting killed
# by the host's out-of-memory limit. Manuscript assessment itself does not
# use this model and is unaffected either way.
#
# DEFAULT: False. The current deployment target does not have the memory
# headroom to host the local language model, so the sidebar assistant is
# switched off and the UI explains why. Override with the environment
# variable ENABLE_SCILEM_LOCAL_MODEL=true on a machine with enough RAM.


def _env_bool(key: str, default: bool) -> bool:
    """Read a boolean from the environment, falling back to `default` when
    the variable is unset or blank."""
    raw = os.getenv(key)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("true", "1", "yes", "on")


SCILEM_LOCAL_MODEL_DEFAULT = False
ENABLE_SCILEM_LOCAL_MODEL = _env_bool("ENABLE_SCILEM_LOCAL_MODEL", SCILEM_LOCAL_MODEL_DEFAULT)

SCILEM_DISABLED_NOTICE = (
    "Due to server limitations, the local language model is inactive. "
    "The Scilem conversational assistant is unavailable on this deployment. "
    "Manuscript assessment is unaffected — the Scilem deterministic structural "
    "analyser still runs on every paper as part of the evaluation panel."
)


def get_secret(key, default=""):
    """Reads secrets from environment / .env. (Streamlit secrets removed - this
    is now a plain FastAPI app, not a Streamlit app.)"""
    val = os.getenv(key)
    return val if val else default


GROQ_API_KEY = get_secret("GROQ_API_KEY")
PINATA_API_KEY = get_secret("PINATA_API_KEY")
PINATA_SECRET_API_KEY = get_secret("PINATA_SECRET_API_KEY")
REGISTRY_CONTRACT_ADDRESS = get_secret("REGISTRY_CONTRACT_ADDRESS")
OR_API_KEY = get_secret("OR_API_KEY")
GEMINI_API_KEY = get_secret("GEMINI_API_KEY")
ORCID_CLIENT_ID = get_secret("ORCID_CLIENT_ID")
ORCID_CLIENT_SECRET = get_secret("ORCID_CLIENT_SECRET")
# Must point at the backend's own callback route, e.g. http://localhost:8000/api/auth/orcid/callback
ORCID_REDIRECT_URI = get_secret("ORCID_REDIRECT_URI", "http://localhost:8000/api/auth/orcid/callback")
# Where the frontend is served from, used to redirect the browser back after ORCID login
FRONTEND_ORIGIN = get_secret("FRONTEND_ORIGIN", "http://localhost:8000")
# Web3 owner wallet allowed to reset Scilem
OWNER_ID = get_secret("OWNER_ID", "0x1Af8D9A120b02D0983590587364F8705e6942356")

if IS_PRODUCTION and not ALLOWED_ORIGINS:
    ALLOWED_ORIGINS = [FRONTEND_ORIGIN]


def config_summary():
    """Human-readable startup summary of which optional features are
    configured, without ever printing secret values themselves."""

    def flag(val):
        return "configured" if val else "NOT configured"

    lines = [
        f"Environment: {ENVIRONMENT}",
        f"Data directory: {BASE_DIR}",
        f"CORS allowed origins: {ALLOWED_ORIGINS}",
        f"LLM judge — Groq: {flag(GROQ_API_KEY)}",
        f"LLM judge — OpenRouter (Mistral/Qwen + fallback): {flag(OR_API_KEY)}",
        f"LLM judge — Gemini: {flag(GEMINI_API_KEY)}",
        f"IPFS backup (Pinata): {flag(PINATA_API_KEY and PINATA_SECRET_API_KEY)}",
        f"On-chain state registry: {flag(REGISTRY_CONTRACT_ADDRESS and ETH_ADMIN_PRIVATE_KEY)}",
        f"ORCID login: {flag(ORCID_CLIENT_ID and ORCID_CLIENT_SECRET)}",
        f"Scilem local chat model: {'enabled' if ENABLE_SCILEM_LOCAL_MODEL else 'DISABLED (ENABLE_SCILEM_LOCAL_MODEL=false)'}",
    ]
    if not (GROQ_API_KEY or OR_API_KEY or GEMINI_API_KEY):
        lines.append(
            "NOTE: no external LLM keys configured — assessments will run "
            "entirely on the local Scilem model + deterministic heuristics."
        )
    return lines

GENESIS_BLOCK_CONFIG = {
    "block_height": 1,
    "weights": [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    "timestamp": "2026-01-01T00:00:00.000000",
    "previous_hash": "0" * 64,
    "validator_node": "Validator_Pi_Genesis",
    "eval_hash": "genesis",
    "model_used": "Genesis_Ensemble",
    "por_proof": "Genesis_Proof_Anchor",
    "formulas_hash": hashlib.sha256(b"C1:Semantic_Originality|C2:MDAR_Rigor|C3:Citation_Entropy|C4:Open_Infrastructure|C5:Containerized_Execution|C6:Citation_Polarity|C7:Empirical_Density|C8:Future_Actionability_FAIR|CoARA_Dossier_v2.0").hexdigest(),
}

HOT_TOPICS = [
    "Quantum Error Correction", "Generative AI in Oncology", "CRISPR-Cas12 Therapeutics",
    "Solid-State Battery Electrolytes", "Perovskite Solar Cell Efficiency",
    "Neuromorphic Computing Hardware", "Neural Radiance Fields 3D Reconstruction",
    "Carbon Capture Metal-Organic Frameworks", "Fusion Energy Plasma Confinement",
    "Exoplanet Atmospheric Spectroscopy"
]
