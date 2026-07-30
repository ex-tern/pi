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
import logging
from typing import Dict, List, Optional

try:
    from config import GROQ_API_KEY, OR_API_KEY, GEMINI_API_KEY, PRIMARY_MODEL
except ImportError:
    GROQ_API_KEY = OR_API_KEY = GEMINI_API_KEY = ""
    PRIMARY_MODEL = "llama-3.3-70b-versatile"

GROQ_BASE = "https://api.groq.com/openai/v1"
OPENROUTER_BASE = "https://openrouter.ai/api/v1"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/"


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
            _route(PRIMARY_MODEL, GROQ_API_KEY, GROQ_BASE, "Groq"),
            _route("llama-3.1-8b-instant", GROQ_API_KEY, GROQ_BASE, "Groq"),
            _route("meta-llama/llama-3.3-70b-instruct", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("meta-llama/llama-3.1-8b-instruct", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
        ],
        "mistral": [
            _route("mistralai/mistral-large", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("mistralai/mistral-nemo", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("mistralai/mistral-7b-instruct", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            # Groq hosts Mixtral directly, which bypasses OpenRouter routing
            # policy entirely — the single most useful fallback for this juror.
            _route("mixtral-8x7b-32768", GROQ_API_KEY, GROQ_BASE, "Groq"),
        ],
        "qwen": [
            _route("qwen/qwen-2.5-72b-instruct", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("qwen/qwen-2.5-7b-instruct", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("qwen/qwq-32b-preview", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
        ],
        "gemini": [
            _route("gemini-2.0-flash", GEMINI_API_KEY, GEMINI_BASE, "Google"),
            _route("gemini-1.5-flash", GEMINI_API_KEY, GEMINI_BASE, "Google"),
            _route("google/gemini-2.0-flash-001", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
            _route("google/gemma-2-9b-it", OR_API_KEY, OPENROUTER_BASE, "OpenRouter"),
        ],
    }
    return [r for r in chains.get(juror, []) if r]


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
    for juror in ("llama", "mistral", "qwen", "gemini"):
        routes = build_routes(juror)
        jurors[juror] = {
            "route_count": len(routes),
            "providers": sorted({r["provider"] for r in routes}),
            "reachable": bool(routes),
            "primary_model": routes[0]["model"] if routes else None,
        }

    advice = []
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
    }
