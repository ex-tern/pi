"""
Model provider routing, fallback chains, and error sanitisation.

Two problems this solves.

**Only one juror was ever reaching a model.** Llama is the only juror with a
direct provider (Groq); Mistral and Qwen route exclusively through OpenRouter,
and Gemini falls back to it. A single OpenRouter account setting — the privacy
/ data-policy restriction — therefore silently disabled three of the four
external jurors at once. The panel still reported a verdict, but it was a
one-model verdict wearing a four-model label, and judgement quality could never
rise above "Moderate". Each juror now has a chain of candidate models, so one
blocked route degrades to the next instead of removing the juror entirely.

**Provider errors were shown verbatim to end users.** A message like::

    Error querying MISTRAL: No endpoints available matching your guardrail
    restrictions and data policy. Configure: https://openrouter.ai/settings/privacy

discloses which vendors the operator uses, that an OpenRouter account exists,
and a link to its settings page — none of which is a researcher's business, and
all of which is useful to someone probing the deployment. Errors are now
classified into a small set of neutral, public-safe categories, with the full
provider text logged server-side and exposed only to the operator.
"""
import re
import time
import logging
import threading
from typing import Dict, List, Optional, Tuple

try:
    from config import (CEREBRAS_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY,
                        TOGETHER_API_KEY, GITHUB_MODELS_TOKEN,
                        GROQ_API_KEY, OR_API_KEY, GEMINI_API_KEY, PRIMARY_MODEL,
                        GROQ_QWEN_MODEL, GROQ_SMALL_MODEL,
                        FALLBACK_MODEL, GEMINI_PRIMARY_MODEL)
except ImportError:
    GROQ_API_KEY = OR_API_KEY = GEMINI_API_KEY = ""
    CEREBRAS_API_KEY = MISTRAL_API_KEY = DEEPSEEK_API_KEY = ""
    TOGETHER_API_KEY = GITHUB_MODELS_TOKEN = ""
    PRIMARY_MODEL = "openai/gpt-oss-120b"
    FALLBACK_MODEL = "llama-3.1-8b-instant"
    GROQ_QWEN_MODEL = "qwen/qwen3-32b"
    GROQ_SMALL_MODEL = "openai/gpt-oss-20b"
    GEMINI_PRIMARY_MODEL = "gemini-2.5-flash"

# ---------------------------------------------------------------------------
# Rate-limit circuit breaker
# ---------------------------------------------------------------------------
# A provider that has just returned 429 will almost certainly return 429 again
# on the next paper. Retrying it regardless wastes the request's time budget,
# and on quota-metered tiers each rejected call can still count against the
# allowance — so hammering a rate-limited provider actively delays recovery.
#
# Once a route reports a rate limit it is placed in cooldown and skipped
# entirely until the window expires. Cooldown grows with consecutive failures
# and is reset by the first success, which is standard exponential backoff
# applied per route rather than per request.
_breaker_lock = threading.Lock()
_cooldowns: Dict[str, Dict] = {}

BASE_COOLDOWN_SECONDS = 45
MAX_COOLDOWN_SECONDS = 900


def _route_key(model: str, provider: str) -> str:
    return f"{provider}:{model}"


def is_route_cooling(model: str, provider: str) -> Tuple[bool, float]:
    """Whether this route is in cooldown, and for how much longer."""
    key = _route_key(model, provider)
    with _breaker_lock:
        entry = _cooldowns.get(key)
        if not entry:
            return False, 0.0
        remaining = entry["until"] - time.time()
        if remaining <= 0:
            _cooldowns.pop(key, None)
            return False, 0.0
        return True, remaining


def record_rate_limit(model: str, provider: str, retry_after: Optional[float] = None):
    """Open the breaker for a route, honouring Retry-After when supplied."""
    key = _route_key(model, provider)
    with _breaker_lock:
        entry = _cooldowns.get(key) or {"failures": 0}
        entry["failures"] += 1
        # The provider's own Retry-After is authoritative when present;
        # guessing shorter than it asks for is how quota bans happen.
        backoff = retry_after if retry_after and retry_after > 0 else \
            BASE_COOLDOWN_SECONDS * (2 ** min(entry["failures"] - 1, 5))
        entry["until"] = time.time() + min(MAX_COOLDOWN_SECONDS, backoff)
        _cooldowns[key] = entry
        logging.info("Route %s cooling down for %.0fs (failure %d).",
                     key, entry["until"] - time.time(), entry["failures"])


def record_success(model: str, provider: str):
    """Close the breaker: one success clears the accumulated backoff."""
    with _breaker_lock:
        _cooldowns.pop(_route_key(model, provider), None)


def parse_retry_after(error_text: str) -> Optional[float]:
    """Pull a retry delay out of a provider error message.

    Providers report this inconsistently — a Retry-After header, a
    "retryDelay" field, or prose. Reading whichever is present is more
    reliable than assuming a fixed backoff.
    """
    if not error_text:
        return None
    for pattern in (r"retry[- ]?after[\"':\s]+(\d+(?:\.\d+)?)",
                    r"retryDelay[\"':\s]+(\d+(?:\.\d+)?)s?",
                    r"try again in (\d+(?:\.\d+)?)\s*(?:second|sec|s)\b",
                    r"wait (\d+(?:\.\d+)?)\s*(?:second|sec|s)\b"):
        match = re.search(pattern, str(error_text), re.IGNORECASE)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                continue
    return None


def cooldown_status() -> List[Dict]:
    """Operator view of which routes are currently backed off."""
    now = time.time()
    with _breaker_lock:
        return [
            {"route": key, "seconds_remaining": round(entry["until"] - now, 1),
             "consecutive_failures": entry["failures"]}
            for key, entry in _cooldowns.items() if entry["until"] > now
        ]


GROQ_BASE = "https://api.groq.com/openai/v1"
OPENROUTER_BASE = "https://openrouter.ai/api/v1"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/"

# Direct providers, all OpenAI-compatible and all with a free tier. Their
# purpose is independence from OpenRouter, not extra capacity: a juror whose
# only path is OpenRouter disappears entirely when that account's data policy
# rejects a model, and four of the five jurors were in that position.
CEREBRAS_BASE = "https://api.cerebras.ai/v1"
MISTRAL_BASE = "https://api.mistral.ai/v1"
DEEPSEEK_BASE = "https://api.deepseek.com/v1"
TOGETHER_BASE = "https://api.together.xyz/v1"
GITHUB_MODELS_BASE = "https://models.inference.ai.azure.com"


def _route(model: str, key: str, base: str, provider: str) -> Optional[Dict]:
    return {"model": model, "key": key, "base": base, "provider": provider} if key else None


def build_routes(juror: str) -> List[Dict]:
    """Ordered candidate routes for one juror.

    Direct provider first (fewer intermediaries, fewer policy layers), then
    OpenRouter alternatives ordered from most to least capable. The smaller
    models at the end of each chain exist specifically because they are widely
    available under restrictive routing policies — a weaker juror that actually
    responds contributes more to cross-model corroboration than a stronger one
    that is always blocked.
    """
    chains = {
        "llama": [
            # Groq's llama-3.3-70b-versatile led this chain until GroqCloud
            # decommissioned it on 16 Aug 2026. It is not replaced with a Groq
            # model here: the substitutes Groq offers are GPT and Qwen lineage,
            # and this juror is Llama BY DESIGN — the panel's claim rests on
            # juror errors being uncorrelated, so a "llama" juror silently
            # answering as GPT would keep the label and lose the property.
            # Cerebras and Together still serve real Llama, so they lead now.
            _route("llama-3.3-70b", CEREBRAS_API_KEY, CEREBRAS_BASE, "Cerebras"),
            _route("llama-3.1-8b-instant", GROQ_API_KEY, GROQ_BASE, "Groq"),
            _route("meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", TOGETHER_API_KEY, TOGETHER_BASE, "Together"),
            _route("meta-llama/llama-3.3-70b-instruct", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("meta-llama/llama-3.1-8b-instruct", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
        ],
        "mistral": [
            # Mistral's own free tier removes this juror's OpenRouter dependency
            # entirely, which is the point: it was previously the juror most
            # exposed to a single account's routing policy.
            _route("mistral-small-latest", MISTRAL_API_KEY, MISTRAL_BASE, "Mistral"),
            _route("open-mistral-nemo", MISTRAL_API_KEY, MISTRAL_BASE, "Mistral"),
            _route("mistralai/mistral-large", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("mistralai/mistral-nemo", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("mistralai/mistral-7b-instruct", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            # Groq's mixtral-8x7b-32768 sat here as the one route that bypassed
            # OpenRouter's routing policy. Groq has retired it, and for the same
            # reason as the llama juror above it is not swapped for a
            # different-lineage Groq model: this juror's value to the panel is
            # that it is NOT another GPT. The universal fallback appended below
            # still keeps it answering when Mistral's own API is unreachable.
        ],
        "qwen": [
            # Groq's Qwen3 is the fastest real-Qwen route available and is one
            # of the two models GroqCloud named as the migration target, so it
            # leads — same lineage, so nothing about this juror's independence
            # changes.
            _route(GROQ_QWEN_MODEL, GROQ_API_KEY, GROQ_BASE, "Groq"),
            _route("qwen-3-32b", CEREBRAS_API_KEY, CEREBRAS_BASE, "Cerebras"),
            _route("Qwen/Qwen2.5-72B-Instruct-Turbo", TOGETHER_API_KEY, TOGETHER_BASE, "Together"),
            _route("qwen/qwen-2.5-72b-instruct", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("qwen/qwen-2.5-7b-instruct", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("qwen/qwq-32b-preview", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
        ],
        # A juror from a different model lineage. This is not redundancy: the
        # panel's whole epistemic claim rests on juror errors being
        # uncorrelated, and four models trained on overlapping corpora with
        # similar architectures do not satisfy that well. A DeepSeek-lineage
        # juror is genuinely more independent than a fourth Western
        # instruction-tuned model, which strengthens corroboration rather than
        # just adding another vote.
        "deepseek": [
            _route("deepseek-chat", DEEPSEEK_API_KEY, DEEPSEEK_BASE, "DeepSeek"),
            _route("deepseek/deepseek-chat", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("openai/gpt-oss-120b", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
        ],
        # Gemini's free tier rate-limits hard, so the chain is ordered by
        # decreasing quota pressure: flash-lite models have the most generous
        # free allowances, and OpenRouter provides a route that does not draw
        # on the Google quota at all.
        "gemini": [
            _route(GEMINI_PRIMARY_MODEL, GEMINI_API_KEY, GEMINI_BASE, "Google"),
            _route("gemini-2.5-flash", GEMINI_API_KEY, GEMINI_BASE, "Google"),
            _route("gemini-2.5-flash-lite", GEMINI_API_KEY, GEMINI_BASE, "Google"),
            _route("gemini-2.0-flash", GEMINI_API_KEY, GEMINI_BASE, "Google"),
            _route("google/gemini-2.0-flash-001", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("google/gemma-2-9b-it", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            # GitHub Models is free with any GitHub token and serves a
            # non-Google lineage, so it keeps this juror alive even when the
            # Gemini quota is exhausted and OpenRouter is unavailable.
            _route("gpt-4o-mini", GITHUB_MODELS_TOKEN, GITHUB_MODELS_BASE, "GitHub Models"),
        ],
    }
    # The final judge adjudicates the panel's verdicts, and it previously had
    # no chain at all: one hardcoded model on whichever provider happened to be
    # configured, with a straight drop to the local fallback the moment that
    # call failed. Worse, on Groq it ran PRIMARY_MODEL — the *same model and
    # the same quota bucket* as the llama juror — so a single Groq rate limit
    # removed both the juror and the adjudicator in one go.
    #
    # This chain is ordered to reach a different provider from the one the
    # panel has just finished hammering, and only falls back to the shared Groq
    # model near the end. Judging should also not be done by a panel member
    # where that is avoidable: a juror grading the debate it took part in is a
    # weaker check than an outside model, so independent providers come first.
    chains["judge"] = [
        _route("llama-3.3-70b", CEREBRAS_API_KEY, CEREBRAS_BASE, "Cerebras"),
        _route("mistral-large-latest", MISTRAL_API_KEY, MISTRAL_BASE, "Mistral"),
        _route("deepseek-chat", DEEPSEEK_API_KEY, DEEPSEEK_BASE, "DeepSeek"),
        _route("gpt-4o-mini", GITHUB_MODELS_TOKEN, GITHUB_MODELS_BASE, "GitHub Models"),
        _route("meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", TOGETHER_API_KEY, TOGETHER_BASE, "Together"),
        _route(GEMINI_PRIMARY_MODEL, GEMINI_API_KEY, GEMINI_BASE, "Google"),
        # Shared with every juror's fallback — deliberately last, since if the
        # panel exhausted this quota the judge will find it exhausted too.
        _route(PRIMARY_MODEL, GROQ_API_KEY, GROQ_BASE, "Groq"),
        _route(GROQ_SMALL_MODEL, GROQ_API_KEY, GROQ_BASE, "Groq"),
    ]

    routes = [r for r in chains.get(juror, []) if r]

    # Universal last resort #1: the Groq-hosted PRIMARY_MODEL
    # (GPT-OSS 120B since the Llama 3.3 decommission). Every juror ends here because it is the one
    # route this deployment is most likely to actually have configured — Groq's
    # free tier needs no billing relationship, and unlike the OpenRouter Auto
    # Router it names a known model of known quality rather than whatever the
    # account happens to be allowed today. A juror that reaches a shared Llama
    # instead of returning nothing still contributes a verdict; it is only a
    # weaker form of independence, not an absent one.
    #
    # It is appended, never promoted: for jurors whose own lineage is
    # reachable, that lineage is always tried first, and the dedupe below
    # keeps the Llama juror (where it is already primary) from listing it
    # twice. FALLBACK_MODEL follows it as the smallest, most consistently
    # available model on the same account, for when the 70B quota is spent.
    for fallback_model in (PRIMARY_MODEL, GROQ_SMALL_MODEL, FALLBACK_MODEL):
        route = _route(fallback_model, GROQ_API_KEY, GROQ_BASE, "Groq")
        if route:
            routes.append(route)

    # Universal last resort #2: OpenRouter's Auto Router selects whichever model
    # is actually available to this account right now. It is the correct
    # answer to "no endpoints available matching your data policy" — rather
    # than naming a model the account may not reach, it asks OpenRouter to
    # pick one it can. Placed last so a named, known-quality model is always
    # preferred when one is reachable.
    if OR_API_KEY:
        routes.append({"model": "openrouter/auto", "key": OR_API_KEY,
                       "base": OPENROUTER_BASE, "provider": "OpenRouter"})

    # Dedupe while preserving order. Appending the universal fallbacks would
    # otherwise make the Llama juror and the judge retry a route they had
    # already exhausted seconds earlier — burning time budget on a call whose
    # outcome is already known.
    seen, unique = set(), []
    for r in routes:
        ident = (r["provider"], r["model"])
        if ident in seen:
            continue
        seen.add(ident)
        unique.append(r)

    if juror == "judge":
        # SciLM (siM) is a juror and never the judge. It is ScholarPi's own
        # engine: letting it adjudicate the panel would mean the platform
        # grading its own submission to the panel, and the whole claim of the
        # adjudication step is that an outside model settles disagreements the
        # jurors could not. Filtered here, at the one place judge routes are
        # built, so no future edit to a chain can reintroduce it by accident.
        unique = [r for r in unique if not is_scilm_route(r)]

    return unique


# Anything that names the local engine, in any of the spellings the codebase
# has used for it. Matched loosely on purpose: the cost of wrongly excluding an
# unrelated model whose name happens to contain "scilm" is one fallback route,
# and the cost of wrongly including SciLM is a self-adjudicated verdict.
_SCILM_TOKENS = ("scilm", "scilem", "sim-local", "local")


def is_scilm_route(route: dict) -> bool:
    """Whether a route resolves to ScholarPi's own SciLM (siM) engine."""
    if not route:
        return True
    blob = f"{route.get('model', '')} {route.get('provider', '')} {route.get('kind', '')}".lower()
    return any(tok in blob for tok in _SCILM_TOKENS)


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------
# Each entry maps a provider failure to (category, public message, whether
# trying the next route in the chain could help).
_ERROR_RULES = [
    (r"no endpoints available|data policy|guardrail|privacy",
     "routing_policy",
     "This model is unavailable under the deployment's current routing policy.",
     True),
    (r"\b402\b|insufficient credit|quota exceeded|billing",
     "credit",
     "This model is temporarily unavailable due to provider account limits.",
     False),
    (r"\b429\b|rate.?limit|resource_exhausted|too many requests",
     "rate_limit",
     "This model was rate-limited and did not return a verdict in time.",
     True),
    (r"\b401\b|\b403\b|invalid api key|unauthorized|authentication",
     "auth",
     "This model is not correctly configured on the deployment.",
     False),
    (r"\b404\b|model not found|unknown model|does not exist",
     "unknown_model",
     "This model is not available from the provider.",
     True),
    (r"timeout|timed out|connection|network|unreachable|read operation",
     "network",
     "This model could not be reached before the time budget expired.",
     True),
    (r"content.?filter|safety|blocked by",
     "content_filter",
     "This model declined to assess the manuscript.",
     False),
    (r"context length|too many tokens|maximum context",
     "context_length",
     "The manuscript exceeded this model's context window.",
     False),
]


def classify_provider_error(error_text: str) -> Dict:
    """Turn a raw provider error into a public-safe classification.

    The full text is preserved under `internal` for operator-facing surfaces
    and logs; `public` is what a researcher sees. Nothing in `public` names a
    vendor, an account, or a configuration URL.
    """
    raw = str(error_text or "")
    for pattern, category, message, retryable in _ERROR_RULES:
        if re.search(pattern, raw, re.IGNORECASE):
            return {"category": category, "public": message,
                    "retryable": retryable, "internal": raw[:600]}
    return {"category": "unknown", "retryable": True, "internal": raw[:600],
            "public": "This model did not return a usable assessment."}


def redact_provider_text(text: str) -> str:
    """Strip provider identity and configuration URLs from any string.

    A defence in depth for text that reaches a user through a path other than
    `classify_provider_error` — a model's own prose, for instance, which can
    quote an error it was given.
    """
    if not text:
        return ""
    cleaned = re.sub(r"https?://\S+", "[link removed]", str(text))
    for vendor in ("openrouter", "groq", "anthropic", "openai", "together\\.ai", "deepinfra"):
        cleaned = re.sub(rf"\b{vendor}\b", "the provider", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bsk-[A-Za-z0-9_\-]{8,}", "[redacted]", cleaned)
    return cleaned


# ---------------------------------------------------------------------------
# Operator diagnostics
# ---------------------------------------------------------------------------
def provider_configuration() -> Dict:
    """What is configured, what each juror can reach, and what to fix.

    Operator-facing: this is the view that answers "why is only one model
    running", which was previously invisible without reading the source.
    """
    keys = {
        "Groq": bool(GROQ_API_KEY),
        "OpenRouter": bool(OR_API_KEY),
        "Google Gemini": bool(GEMINI_API_KEY),
    }
    jurors = {}
    for juror in ("llama", "mistral", "qwen", "gemini", "deepseek", "judge"):
        routes = build_routes(juror)
        jurors[juror] = {
            "route_count": len(routes),
            "providers": sorted({r["provider"] for r in routes}),
            "reachable": bool(routes),
            "primary_model": routes[0]["model"] if routes else None,
        }

    advice = []
    cooling = cooldown_status()
    if cooling:
        advice.append(
            "Some routes are in rate-limit cooldown and are being skipped: "
            + ", ".join(f"{c['route']} ({c['seconds_remaining']:.0f}s)" for c in cooling[:5])
            + ". This is deliberate — retrying a rate-limited provider delays its recovery."
        )
    if not keys["Groq"] and not keys["OpenRouter"]:
        advice.append(
            "No general-purpose provider key is configured. Set GROQ_API_KEY (free tier "
            "available) to enable the Llama juror at minimum."
        )
    unreachable = [j for j, v in jurors.items() if not v["reachable"]]
    if unreachable:
        advice.append(
            f"These jurors have no configured route and will never participate: "
            f"{', '.join(unreachable)}. Cross-model corroboration — and therefore "
            f"judgement quality — is capped until at least three jurors can respond."
        )
    if keys["OpenRouter"] and not keys["Groq"]:
        advice.append(
            "Every juror currently depends on a single OpenRouter account, so one account-level "
            "restriction disables the whole panel. Adding GROQ_API_KEY gives Llama and Mistral "
            "an independent route."
        )
    if keys["OpenRouter"]:
        advice.append(
            "If OpenRouter reports 'no endpoints available matching your data policy', the "
            "account's privacy setting is excluding every provider that serves the requested "
            "model. Allowing prompt-logging providers, or permitting the smaller fallback models "
            "in each chain, restores those jurors."
        )
    if not keys["Google Gemini"] and keys["OpenRouter"]:
        advice.append(
            "The Gemini juror is routed through OpenRouter. A direct GEMINI_API_KEY gives it an "
            "independent path, which matters because independence is what makes corroboration "
            "meaningful."
        )

    reachable_count = sum(1 for v in jurors.values() if v["reachable"])
    return {
        "keys_configured": keys,
        "jurors": jurors,
        "reachable_jurors": reachable_count,
        "expected_quality": ("High" if reachable_count >= 3 else
                             "Moderate" if reachable_count >= 1 else "Limited"),
        "advice": advice,
        "cooldowns": cooling,
    }
