import os
import logging
import hashlib

# ---------------------------------------------------------------------------
# .env loading (lightweight, no external dependency required).
# Put secrets in backend/.env (KEY=VALUE per line) or export real env vars.
#
# The parsing here is deliberately careful about two things that silently
# destroy API keys, because the failure mode is invisible: the key is present,
# so nothing reports it as missing, but its *value* is wrong and every request
# fails authentication.
#
#   1. Inline comments.  `KEY=abc123 # my key` must yield "abc123", not
#      "abc123 # my key". Only unquoted values are stripped this way, and only
#      at whitespace, since '#' is a legal character inside a secret.
#   2. `export KEY=value`.  Copied straight out of shell instructions, this
#      previously parsed the name as "export KEY" and set nothing usable.
# ---------------------------------------------------------------------------
def _parse_env_line(line):
    """Returns ``(key, value)`` for one .env line, or ``None`` to skip it."""
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        return None
    if line.startswith("export "):
        line = line[len("export "):].lstrip()
    key, value = line.split("=", 1)
    key = key.strip()
    if not key:
        return None
    value = value.strip()

    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        # Quoted: take it verbatim. A '#' inside quotes belongs to the value.
        value = value[1:-1]
    else:
        # Unquoted: an inline comment starts at the first whitespace-preceded
        # '#'. Checking for the preceding space matters — a key may legally
        # contain '#' with no space in front of it.
        for i, ch in enumerate(value):
            if ch == "#" and i > 0 and value[i - 1].isspace():
                value = value[:i]
                break
        value = value.strip()
    return key, value


_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_ENV_PATH):
    with open(_ENV_PATH, "r") as _f:
        for _line in _f:
            _parsed = _parse_env_line(_line)
            if _parsed:
                # setdefault: a real environment variable always beats the
                # file, so container and CI configuration keeps precedence.
                os.environ.setdefault(_parsed[0], _parsed[1])

# The general-purpose model on Groq, used as the universal last-resort route
# for every juror and as the judge's final fallback.
#
# WAS llama-3.3-70b-versatile. GroqCloud decommissioned that model on
# 16 August 2026 and directed workloads to GPT-OSS 120B / Qwen3 32B, so every
# route naming it would start returning model-not-found — and since it is the
# route every juror falls back to, the whole panel would fail at once rather
# than degrading.
#
# Env-overridable, unlike before: a provider renaming a model should be a
# variable change on the host, not a code edit and a redeploy.
PRIMARY_MODEL = os.getenv("PRIMARY_MODEL", "openai/gpt-oss-120b")

# Groq's Qwen3, which replaces the decommissioned Llama for the Qwen juror's
# fastest route. Named separately so the Qwen juror stays Qwen-lineage — the
# panel's independence claim rests on juror errors being uncorrelated, and
# silently substituting a GPT model under a "qwen" label would quietly break
# that while still looking like five jurors.
GROQ_QWEN_MODEL = os.getenv("GROQ_QWEN_MODEL", "qwen/qwen3-32b")

# The small, cheap Groq model for when the large one is rate-limited.
GROQ_SMALL_MODEL = os.getenv("GROQ_SMALL_MODEL", "openai/gpt-oss-20b")

# Gemini model to try first. Override if your account has access to a newer
# one; the provider chain falls back through older flash models automatically,
# which matters because the free tier rate-limits aggressively.
GEMINI_PRIMARY_MODEL = os.getenv("GEMINI_PRIMARY_MODEL", "gemini-2.5-flash")
FALLBACK_MODEL = os.getenv("FALLBACK_MODEL", "llama-3.1-8b-instant")
MAX_TEXT_TOKENS = 15000
EPOCH_BLOCK_SIZE = 5

def _clean_address(raw: str, label: str) -> str:
    """Accept a single well-formed address, or nothing.

    Pasting two addresses into one variable is an easy mistake and produced a
    value that looked configured but could never work. Taking the first token
    silently would be worse — it would guess at intent — so a malformed value
    is discarded and reported, and the feature simply stays off.
    """
    value = (raw or "").strip()
    if not value:
        return ""
    if len(value.split()) > 1:
        logging.warning("%s contains %d values; expected one address. Ignoring it.",
                        label, len(value.split()))
        return ""
    if not (value.startswith("0x") and len(value) == 42):
        logging.warning("%s is not a valid Ethereum address (%d hex chars, expected 40). "
                        "Ignoring it.", label, max(0, len(value) - 2))
        return ""
    return value



WEB3_PROVIDER_URI = os.getenv("WEB3_PROVIDER_URI", "https://ethereum-sepolia-rpc.publicnode.com")
ETH_ADMIN_PRIVATE_KEY = os.getenv("ETH_ADMIN_PRIVATE_KEY", "")
# No default. The previous hardcoded fallback pointed at an uninitialized UUPS
# implementation, so forgetting to set this variable did not fail — it silently
# aimed the app at a dead contract that reverts every mint while still looking
# configured. An unset address is an honest "not configured"; a stale default
# is a wrong answer that reports itself as a right one.
PIQ_CONTRACT_ADDRESS = _clean_address(os.getenv("PIQ_CONTRACT_ADDRESS", ""),
                                      "PIQ_CONTRACT_ADDRESS")

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
# Raised from 0.1 to 1.0. At a tenth of a piQ the fee was too small to be a
# real signal — a qualifying paper mints tens of piQ, so processing cost was
# effectively noise against it, and "0.10 piQ" read as a rounding artefact
# rather than a price. One piQ per paper is legible and still comfortably
# affordable from a single assessed manuscript.
PIQ_PROCESSING_FEE = float(os.getenv("PIQ_PROCESSING_FEE", "1.0"))

# Wallet that receives Support & Donate contributions.
DONATION_WALLET = os.getenv("DONATION_WALLET", "0x6B89DD74DCa5d4DC98599206b1c2dE614066ef40")

# Donations settle on Ethereum mainnet, NOT on the chain the ledger anchors to.
#
# These are deliberately separate settings. The proof-of-research ledger runs on
# Sepolia because anchoring a hash costs nothing there and the testnet is the
# right place for it — but SepoliaETH is worthless, so a "donate" button
# pointing at Sepolia was asking people to send play money to fund real
# inference bills. Nobody who followed the instructions was contributing
# anything, and nobody was told.
#
# Overridable, so a deployment that genuinely wants testnet donations can have
# them, but the default is the chain where the currency is real.
DONATION_CHAIN_ID = int(os.getenv("DONATION_CHAIN_ID", "1"))
DONATION_CHAIN_NAME = os.getenv("DONATION_CHAIN_NAME", "Ethereum")
DONATION_CURRENCY = os.getenv("DONATION_CURRENCY", "ETH")
DONATION_EXPLORER_URL = os.getenv("DONATION_EXPLORER_URL", "https://etherscan.io")
_donation_rpcs_raw = os.getenv("DONATION_RPC_URLS", "").strip()
DONATION_RPC_URLS = ([u.strip() for u in _donation_rpcs_raw.split(",") if u.strip()]
                     if _donation_rpcs_raw else
                     ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com",
                      "https://rpc.ankr.com/eth"])

# ---------------------------------------------------------------------------
# Forecasting
# ---------------------------------------------------------------------------
# The pi-Dyne LSTM trains inside the HTTP request. On a memory-constrained host
# that risks the worker being OOM-killed, which the browser sees as a dropped
# connection — and an OOM kill terminates the process, so no in-process
# fallback can catch it.
#
# DEFAULT: False. The statistical projection (Holt linear trend) is used
# instead. On a series of a few dozen points the two largely agree, and one of
# them cannot take the server down. Set to "true" on a host with real memory
# headroom if you want the neural path.
USE_LSTM_FORECAST = os.getenv("USE_LSTM_FORECAST", "false").strip().lower() in ("true", "1", "yes", "on")

# ---------------------------------------------------------------------------
# OpenRouter
# ---------------------------------------------------------------------------
# Attribution headers OpenRouter uses to identify the calling application.
# Requests without them are treated as anonymous.
OPENROUTER_SITE_URL = os.getenv("OPENROUTER_SITE_URL", "https://scholarpi.up.railway.app")
OPENROUTER_SITE_NAME = os.getenv("OPENROUTER_SITE_NAME", "ScholarPi")

# Provider routing policy. Now UNSET by default, and this is a behaviour change
# with a reason.
#
# The previous default was "deny", on the theory that declaring the policy lets
# OpenRouter pick a compliant endpoint. That reasoning is backwards.
# `data_collection: "deny"` is a *restriction*: it tells OpenRouter to route
# only to providers that do not retain prompts. For any model served solely by
# logging providers, that filter eliminates every endpoint and the request
# fails with "No endpoints available matching your data policy" — the exact
# error this setting was meant to avoid. Because it was the default, it applied
# to every OpenRouter juror on every install.
#
# Sending nothing lets the account's own privacy setting govern, which is both
# the widest-availability option and the one that respects what the operator
# actually configured on OpenRouter. Set it explicitly only to override that.
OPENROUTER_DATA_COLLECTION = os.getenv("OPENROUTER_DATA_COLLECTION", "").strip().lower()
if OPENROUTER_DATA_COLLECTION not in ("deny", "allow"):
    OPENROUTER_DATA_COLLECTION = ""

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
def _resolve_data_dir() -> str:
    """Where the ledger, database and learned state live.

    Order matters. An explicit SCHOLARPI_DATA_DIR always wins. Failing that,
    Railway sets RAILWAY_VOLUME_MOUNT_PATH automatically whenever a volume is
    attached, so a mounted volume is used even if the operator forgot the
    second configuration step — which is the failure this ordering exists to
    prevent. Mounting a volume and not pointing the app at it looks like a
    successful setup and still discards the database on every redeploy.
    """
    explicit = os.getenv("SCHOLARPI_DATA_DIR", "").strip()
    if explicit:
        return os.path.expanduser(explicit)
    railway_volume = os.getenv("RAILWAY_VOLUME_MOUNT_PATH", "").strip()
    if railway_volume:
        return os.path.join(railway_volume, "scholarpi")
    return os.path.expanduser("~/Scientometric_Pi_Index")


BASE_DIR = _resolve_data_dir()
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

# The SciLM (siM) sidebar chat (/api/scilem/chat) lazily loads a ~1.1B parameter
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

# The assistant itself is ON by default and needs no local model. It answers
# from the live database and a knowledge base built from the running rubric and
# emission policy, so it cannot hallucinate a balance or a score. The heavy
# local model above remains optional and off; it was never what made the
# assistant useful.
ENABLE_SCILEM_ASSISTANT = _env_bool("ENABLE_SCILEM_ASSISTANT", True)

# How the assistant should describe itself.
#
#   auto     - infer from what is actually configured (provider keys present
#              => "Ready", otherwise "Grounded").
#   limited  - state plainly that capability is reduced on this host.
#
# "limited" exists because inference and the local model both cost memory this
# deployment does not have on a free tier. The honest thing is to say so: a
# badge reading "Ready" on a host that will refuse half the questions asked of
# it is worse than no badge, because the user blames their question rather
# than the deployment. Set SCILEM_MODE=auto once the instance has headroom.
SCILEM_MODE = (os.getenv("SCILEM_MODE", "limited").strip().lower() or "limited")
if SCILEM_MODE not in ("auto", "limited"):
    SCILEM_MODE = "limited"

SCILEM_LIMITED_NOTICE = (
    "Running in limited mode: this deployment is memory-constrained, so the assistant answers "
    "from live deployment state and its built-in knowledge base only. Those answers are exact "
    "and never invented \u2014 but open-ended questions outside that scope will not be answered."
)

SCILEM_DISABLED_NOTICE = (
    "The SciLM (siM) assistant is disabled on this deployment."
)


def get_secret(key, default=""):
    """Reads secrets from environment / .env. (Streamlit secrets removed - this
    is now a plain FastAPI app, not a Streamlit app.)"""
    val = os.getenv(key)
    return val if val else default


GROQ_API_KEY = get_secret("GROQ_API_KEY")
PINATA_API_KEY = get_secret("PINATA_API_KEY")
PINATA_SECRET_API_KEY = get_secret("PINATA_SECRET_API_KEY")
REGISTRY_CONTRACT_ADDRESS = _clean_address(
    get_secret("REGISTRY_CONTRACT_ADDRESS"), "REGISTRY_CONTRACT_ADDRESS")
OR_API_KEY = get_secret("OR_API_KEY")
GEMINI_API_KEY = get_secret("GEMINI_API_KEY")

# Additional direct providers. Each is OpenAI-compatible, so it slots into the
# existing route machinery unchanged, and each has a genuinely free tier.
#
# These exist because the juror panel was structurally fragile: every juror
# except "llama" reached its model only through OpenRouter, so a single
# OpenRouter policy rejection silently collapsed four of five jurors at once.
# Cross-model corroboration is the panel's entire epistemic claim, and it
# cannot rest on one intermediary.
CEREBRAS_API_KEY = get_secret("CEREBRAS_API_KEY")
MISTRAL_API_KEY = get_secret("MISTRAL_API_KEY")
DEEPSEEK_API_KEY = get_secret("DEEPSEEK_API_KEY")
TOGETHER_API_KEY = get_secret("TOGETHER_API_KEY")
GITHUB_MODELS_TOKEN = get_secret("GITHUB_MODELS_TOKEN")
ORCID_CLIENT_ID = get_secret("ORCID_CLIENT_ID")
ORCID_CLIENT_SECRET = get_secret("ORCID_CLIENT_SECRET")
# Must point at the backend's own callback route, e.g. http://localhost:8000/api/auth/orcid/callback
ORCID_REDIRECT_URI = get_secret("ORCID_REDIRECT_URI", "http://localhost:8000/api/auth/orcid/callback")
# Where the frontend is served from, used to redirect the browser back after ORCID login
FRONTEND_ORIGIN = get_secret("FRONTEND_ORIGIN", "http://localhost:8000")
# Web3 owner wallet allowed to reset SciLM (siM)
OWNER_ID = get_secret("OWNER_ID", "0x6B89DD74DCa5d4DC98599206b1c2dE614066ef40")

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
        f"SciLM (siM) local chat model: {'enabled' if ENABLE_SCILEM_LOCAL_MODEL else 'DISABLED (ENABLE_SCILEM_LOCAL_MODEL=false)'}",
    ]
    if not (GROQ_API_KEY or OR_API_KEY or GEMINI_API_KEY):
        lines.append(
            "NOTE: no external LLM keys configured — assessments will run "
            "entirely on the local SciLM (siM) model + deterministic heuristics."
        )
    return lines

# ---------------------------------------------------------------------------
# Genesis block
#
# The root of the Proof-of-Research chain is derived from the identity of this
# deployment — its owner wallet, its piQ token contract, and the chain it
# settles on — rather than being a fixed constant.
#
# Why: with a hardcoded genesis, every ScholarPi instance that ever existed
# shares an identical chain root. Two exports from two different deployments
# (or from the same deployment before and after a relaunch under a new owner
# and a new token contract) are then cryptographically indistinguishable, and
# the ledger cannot substantiate which instance produced a given record — which
# is most of the point of keeping a chain at all.
#
# Deriving it means the root is still fully deterministic and reproducible by
# anyone holding the same three public values, while being unique to this
# deployment. Nothing secret goes into it: the admin private key is deliberately
# excluded, so the fingerprint can be published and independently recomputed.
DEPLOYMENT_FINGERPRINT = hashlib.sha256(
    "|".join([
        "ScholarPi-PoR-v1",
        (OWNER_ID or "").lower(),
        (PIQ_CONTRACT_ADDRESS or "").lower(),
        str(CHAIN_ID),
    ]).encode("utf-8")
).hexdigest()

RUBRIC_FORMULAS_HASH = hashlib.sha256(
    b"C1:Semantic_Originality|C2:MDAR_Rigor|C3:Citation_Entropy|C4:Open_Infrastructure"
    b"|C5:Containerized_Execution|C6:Citation_Polarity|C7:Empirical_Density"
    b"|C8:Future_Actionability_FAIR|CoARA_Dossier_v2.0"
).hexdigest()

GENESIS_BLOCK_CONFIG = {
    "block_height": 1,
    "weights": [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    "timestamp": "2026-01-01T00:00:00.000000",
    # A genesis block has no parent, so the conventional all-zero parent hash
    # is kept. Deployment identity lives in the fields below instead, which
    # feed the block hash just the same.
    "previous_hash": "0" * 64,
    "validator_node": f"Validator_Pi_Genesis:{DEPLOYMENT_FINGERPRINT[:16]}",
    "eval_hash": "genesis",
    "model_used": "Genesis_Ensemble",
    "por_proof": f"Genesis_Proof_Anchor:{DEPLOYMENT_FINGERPRINT}",
    "formulas_hash": RUBRIC_FORMULAS_HASH,
}


def compute_genesis_hash(g=None) -> str:
    """The genesis block hash for a given config.

    Kept here, next to the config it consumes, so the ledger writer and any
    integrity check derive the hash from one definition instead of two copies
    of the same concatenation drifting apart.
    """
    g = g or GENESIS_BLOCK_CONFIG
    return hashlib.sha256(
        f"{g['block_height']}{g['weights']}{g['timestamp']}{g['previous_hash']}"
        f"{g['validator_node']}{g['por_proof']}{g['model_used']}{g['formulas_hash']}"
        .encode("utf-8")
    ).hexdigest()

# A seed pool, sampled from rather than shown whole.
#
# The row displays ten chips. When the list WAS ten, every visitor saw the same
# ten in the same order on every visit — which teaches a returning user that
# the suggestions are decoration and stops them looking. A larger pool with a
# random draw per request means the row is worth glancing at each time, and
# widens the corpus, since a suggestion nobody is ever shown is a topic nobody
# assesses.
#
# Spread deliberately across disciplines: a pool of ten physics topics would
# make the map of science a map of physics.
HOT_TOPICS = [
    # Physical sciences and engineering
    "Quantum Error Correction", "Solid-State Battery Electrolytes",
    "Perovskite Solar Cell Efficiency", "Neuromorphic Computing Hardware",
    "Carbon Capture Metal-Organic Frameworks", "Fusion Energy Plasma Confinement",
    "Exoplanet Atmospheric Spectroscopy", "Topological Superconductors",
    "Metamaterial Acoustic Cloaking", "Green Hydrogen Electrolysis",
    "Additive Manufacturing Fatigue Life", "Room-Temperature Superconductivity Claims",
    # Life and health sciences
    "Generative AI in Oncology", "CRISPR-Cas12 Therapeutics",
    "mRNA Vaccine Thermostability", "Gut Microbiome and Immunity",
    "Organoid Disease Modelling", "Antimicrobial Resistance Surveillance",
    "Single-Cell Spatial Transcriptomics", "Alzheimer's Biomarker Validation",
    "Wearable Continuous Glucose Monitoring", "Protein Structure Prediction Accuracy",
    # Computing and mathematics
    "Neural Radiance Fields 3D Reconstruction", "Retrieval-Augmented Generation",
    "Federated Learning Privacy Guarantees", "Formal Verification of Neural Networks",
    "Post-Quantum Cryptography Migration", "Graph Neural Networks for Chemistry",
    "Mechanistic Interpretability", "Differential Privacy in Practice",
    # Earth, climate and environment
    "Climate Tipping Point Detection", "Microplastics in Freshwater Systems",
    "Soil Carbon Sequestration Measurement", "Urban Heat Island Mitigation",
    "Biodiversity Loss and Ecosystem Services", "Permafrost Methane Release",
    # Social sciences, humanities and research policy
    "Responsible Research Assessment", "Open Peer Review Outcomes",
    "Replication Crisis in Psychology", "Science Funding Allocation Models",
    "Digital Humanities Text Mining", "Misinformation Diffusion Networks",
    "Research Software Sustainability", "Citation Bias and Equity",
]


# ---------------------------------------------------------------------------
# Bug reports
# ---------------------------------------------------------------------------
# Reports are always written to the local database first and emailed second.
# That order is deliberate: mail is the part that can fail (bad credentials,
# provider throttling, an SMTP port blocked by the host), and a report that
# was accepted from a user and then silently dropped is worse than one that
# was never accepted at all.
BUG_REPORT_TO = get_secret("BUG_REPORT_TO", "a.vafadaryengejeh@campus.unimib.it")
SMTP_HOST = get_secret("SMTP_HOST")
SMTP_PORT = int(get_secret("SMTP_PORT", "587") or 587)
SMTP_USER = get_secret("SMTP_USER")
SMTP_PASSWORD = get_secret("SMTP_PASSWORD")
# Defaults to SMTP_USER because most providers reject a From: they do not own.
SMTP_FROM = get_secret("SMTP_FROM") or SMTP_USER
SMTP_USE_TLS = _env_bool("SMTP_USE_TLS", True)


# ---------------------------------------------------------------------------
# riB LLM tutoring
# ---------------------------------------------------------------------------
# riB's relevance ranker learns from researcher feedback ("useful" / "not
# useful"). On a new deployment there is no feedback, so it ranks from its
# authored defaults and stays there until enough people have voted — which on a
# quiet platform may be never.
#
# Tutoring closes that gap: while real feedback is scarce, a language model is
# asked to judge whether a candidate paper is relevant to a stated profile, and
# its answer is fed to the ranker as a WEAK observation. It is a bootstrap, not
# a permanent dependency, and it is bounded three ways:
#
#   * it stops automatically once real feedback passes RIB_TUTOR_UNTIL_OBS,
#     because a human verdict about their own field beats a model's guess
#   * it is capped per day, so a busy deployment cannot run up inference cost
#   * every tutored observation is logged with source="llm", so the engine's
#     history says which judgements came from people and which from a model
#
# Off unless explicitly enabled AND a provider key exists.
ENABLE_RIB_LLM_TUTOR = _env_bool("ENABLE_RIB_LLM_TUTOR", False)
RIB_TUTOR_UNTIL_OBS = int(os.getenv("RIB_TUTOR_UNTIL_OBS", "200"))
RIB_TUTOR_MAX_CALLS_PER_DAY = int(os.getenv("RIB_TUTOR_MAX_CALLS_PER_DAY", "50"))
RIB_TUTOR_WEIGHT = float(os.getenv("RIB_TUTOR_WEIGHT", "0.35"))

# siM LLM tutoring. Mirrors the riB settings above — same bootstrap problem
# (an engine that learns from data a new deployment does not have yet), same
# three bounds, same off-by-default.
ENABLE_SIM_LLM_TUTOR = _env_bool("ENABLE_SIM_LLM_TUTOR", False)
SIM_TUTOR_UNTIL_OBS = int(os.getenv("SIM_TUTOR_UNTIL_OBS", "150"))
SIM_TUTOR_MAX_CALLS_PER_DAY = int(os.getenv("SIM_TUTOR_MAX_CALLS_PER_DAY", "40"))
SIM_TUTOR_WEIGHT = float(os.getenv("SIM_TUTOR_WEIGHT", "0.35"))

# ---------------------------------------------------------------------------
# Idle-time auto-assessment
# ---------------------------------------------------------------------------
# When nobody is using the site, assess open-access papers so the corpus and
# the Map of Science keep growing on a quiet deployment.
#
# Off by default, and deliberately so: this is the only feature that spends
# provider quota with no person present, and a deployment that has not asked
# for it must not start doing so merely because it was left running.
#
# NO ACCOUNT IS CHARGED for these. The processing fee exists to price work a
# user requested; nobody requested this one, so nobody's piQ balance moves.
# Author emission is unaffected — a paper earns on its merits regardless of
# who put it through the pipeline.
ENABLE_IDLE_ASSESSMENTS = _env_bool("ENABLE_IDLE_ASSESSMENTS", False)

# Papers per UTC day. Providers rate-limit well before this on a free tier, so
# treat it as a ceiling rather than a target.
#
# Lowered from 50 to 10. Fifty unattended assessments a day is a lot of
# provider quota spent with nobody watching, and it competes with the quota a
# real submission needs — the corpus grows either way, just more slowly and
# without eating the allowance a waiting user depends on.
IDLE_MAX_PER_DAY = int(os.getenv("IDLE_MAX_PER_DAY", "10"))

# Quiet period, in seconds, before the site counts as idle. Measured from the
# last real request served, not from a clock — background work must never
# compete for provider quota with somebody who is waiting on a response.
IDLE_AFTER_SECONDS = int(os.getenv("IDLE_AFTER_SECONDS", "300"))

# How often the worker wakes to check. Jittered at the call site.
IDLE_POLL_SECONDS = int(os.getenv("IDLE_POLL_SECONDS", "180"))


# ---------------------------------------------------------------------------
# Automatic on-chain settlement
# ---------------------------------------------------------------------------
# An assessment with a connected wallet and minted piQ tries to settle at the
# moment it is written. When that attempt is skipped — no RPC reachable, the
# gas wallet empty, a provider blip — the record used to sit unsettled forever,
# because the only retry in the system was the owner opening the admin panel
# and pressing a button. Everything else in the pipeline retries; this now does
# too.
#
# ON by default: an operator who has configured a contract, a signing key and a
# funded wallet has already said they want piQ to settle, and leaving earned
# tokens stranded is the worse default. It spends gas, so it is one env var to
# turn off, and it refuses to run at all while any blocker is present.
ENABLE_AUTO_SETTLEMENT = _env_bool("AUTO_SETTLE", True)

# Records per pass. Small on purpose: a backlog should drain over several
# minutes rather than in one unbounded burst that empties the gas wallet before
# anyone notices it is misconfigured.
AUTO_SETTLE_BATCH = int(os.getenv("AUTO_SETTLE_BATCH", "5"))

# Seconds between passes. Floored at 60 at the call site — settlement is not
# time-critical, and a tight loop against an RPC endpoint gets rate-limited.
AUTO_SETTLE_INTERVAL_SECONDS = int(os.getenv("AUTO_SETTLE_INTERVAL_SECONDS", "600"))


# ---------------------------------------------------------------------------
# Assessment panel budget
# ---------------------------------------------------------------------------
# Wall-clock ceiling, in seconds, on collecting the model panel's verdicts for
# ONE paper. Each route allows 45s with a retry and a juror can have several
# routes, so without a ceiling a host that cannot reach any provider makes the
# pipeline sit for ten minutes or more behind a single "Analyzing…" line with
# no output and no error.
#
# Jurors that miss the deadline are recorded as failed and the assessment
# continues on whoever answered — the same path a provider outage already
# takes, warning included. Raise it on a deployment with slow but working
# providers; lower it if you would rather fail fast than wait.
PANEL_BUDGET_SECONDS = int(os.getenv("PANEL_BUDGET_SECONDS", "90"))

# How long one model call may take before it is abandoned. Applies per route.
#
# Was 45s with one automatic retry, i.e. 90s to rule out a single dead
# endpoint — and a run walks a dozen of them across five jurors. A model that
# has not begun responding within 20s is not going to rescue the assessment,
# and there are more routes waiting; the retry in particular spent the budget
# on the least promising thing available, the endpoint that just failed.
PROVIDER_TIMEOUT_SECONDS = float(os.getenv("PROVIDER_TIMEOUT_SECONDS", "20"))
