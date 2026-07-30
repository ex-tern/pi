"""
Provider routing, error sanitisation, and the proof-of-work challenge.

The sanitisation tests exist because a raw provider error was reaching end
users verbatim — naming the vendor, revealing that an account existed, and
linking to its settings page. None of that is a researcher's concern and all
of it is useful to someone probing the deployment.

Run with:  cd backend && pytest tests/ -v
"""
import hashlib
import os
import sys
import tempfile

import pytest

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import challenge
import providers


# --------------------------------------------------------------------------
# Error sanitisation
# --------------------------------------------------------------------------
LEAKY_ERROR = ("No endpoints available matching your guardrail restrictions and data policy. "
               "Configure: https://openrouter.ai/settings/privacy")


def test_the_reported_leak_is_classified_and_sanitised():
    result = providers.classify_provider_error(LEAKY_ERROR)
    assert result["category"] == "routing_policy"
    assert "openrouter" not in result["public"].lower()
    assert "http" not in result["public"]
    assert "guardrail" not in result["public"].lower()


def test_full_detail_is_retained_for_the_operator():
    result = providers.classify_provider_error(LEAKY_ERROR)
    assert "openrouter" in result["internal"].lower()


@pytest.mark.parametrize("raw,category", [
    ("Error 402: insufficient credits", "credit"),
    ("429 rate_limit_exceeded", "rate_limit"),
    ("401 Unauthorized: invalid api key", "auth"),
    ("404 model not found", "unknown_model"),
    ("Read operation timed out", "network"),
    ("blocked by content filter", "content_filter"),
    ("maximum context length exceeded", "context_length"),
])
def test_provider_errors_are_categorised(raw, category):
    assert providers.classify_provider_error(raw)["category"] == category


@pytest.mark.parametrize("raw", [
    LEAKY_ERROR, "Error 402: insufficient credits", "401 invalid api key",
    "429 rate_limit", "some entirely unexpected failure",
])
def test_no_public_message_ever_names_a_vendor_or_url(raw):
    public = providers.classify_provider_error(raw)["public"]
    lowered = public.lower()
    for vendor in ("openrouter", "groq", "openai", "anthropic", "google"):
        assert vendor not in lowered
    assert "http" not in lowered
    assert "sk-" not in lowered


def test_redaction_strips_urls_keys_and_vendor_names():
    text = "OpenRouter rejected key sk-abcdef123456 — see https://openrouter.ai/settings"
    cleaned = providers.redact_provider_text(text)
    assert "openrouter" not in cleaned.lower()
    assert "https://" not in cleaned
    assert "sk-abcdef123456" not in cleaned


def test_retryable_classification_guides_the_fallback_chain():
    """Auth and credit failures recur identically; retrying wastes the budget."""
    assert providers.classify_provider_error(LEAKY_ERROR)["retryable"] is True
    assert providers.classify_provider_error("401 unauthorized")["retryable"] is False
    assert providers.classify_provider_error("402 insufficient credits")["retryable"] is False


# --------------------------------------------------------------------------
# Routing
# --------------------------------------------------------------------------
@pytest.mark.parametrize("juror", ["llama", "mistral", "qwen", "gemini"])
def test_every_juror_has_a_defined_chain(juror, monkeypatch):
    monkeypatch.setattr(providers, "GROQ_API_KEY", "k")
    monkeypatch.setattr(providers, "OR_API_KEY", "k")
    monkeypatch.setattr(providers, "GEMINI_API_KEY", "k")
    routes = providers.build_routes(juror)
    assert len(routes) >= 2, "a single route means one restriction removes the juror entirely"


def test_mistral_can_bypass_openrouter_entirely(monkeypatch):
    """The fix for the reported failure: a route that avoids the blocked path."""
    monkeypatch.setattr(providers, "GROQ_API_KEY", "k")
    monkeypatch.setattr(providers, "OR_API_KEY", "")
    routes = providers.build_routes("mistral")
    assert routes
    assert all(r["provider"] != "OpenRouter" for r in routes)


def test_no_key_means_no_route(monkeypatch):
    monkeypatch.setattr(providers, "GROQ_API_KEY", "")
    monkeypatch.setattr(providers, "OR_API_KEY", "")
    monkeypatch.setattr(providers, "GEMINI_API_KEY", "")
    assert providers.build_routes("qwen") == []


def test_diagnostics_explain_a_single_reachable_juror(monkeypatch):
    monkeypatch.setattr(providers, "GROQ_API_KEY", "k")
    monkeypatch.setattr(providers, "OR_API_KEY", "")
    monkeypatch.setattr(providers, "GEMINI_API_KEY", "")
    config = providers.provider_configuration()
    assert config["reachable_jurors"] < 4
    assert config["advice"], "the operator must be told why the panel is incomplete"


def test_diagnostics_flag_single_account_dependence(monkeypatch):
    monkeypatch.setattr(providers, "GROQ_API_KEY", "")
    monkeypatch.setattr(providers, "OR_API_KEY", "k")
    monkeypatch.setattr(providers, "GEMINI_API_KEY", "")
    advice = " ".join(providers.provider_configuration()["advice"])
    assert "single OpenRouter account" in advice


# --------------------------------------------------------------------------
# Proof of work
# --------------------------------------------------------------------------
def solve(c):
    nonce = 0
    while True:
        digest = hashlib.sha256(f"{c['challenge']}:{nonce}".encode()).digest()
        if challenge._leading_zero_bits(digest) >= c["difficulty"]:
            return nonce
        nonce += 1


def test_a_correct_solution_is_accepted():
    c = challenge.issue_challenge("203.0.113.1")
    ok, _ = challenge.verify_solution("203.0.113.1", c["challenge"], c["issued_at"],
                                      c["difficulty"], c["signature"], solve(c))
    assert ok


def test_a_solution_cannot_be_replayed():
    c = challenge.issue_challenge("203.0.113.2")
    n = solve(c)
    challenge.verify_solution("203.0.113.2", c["challenge"], c["issued_at"],
                              c["difficulty"], c["signature"], n)
    ok, why = challenge.verify_solution("203.0.113.2", c["challenge"], c["issued_at"],
                                        c["difficulty"], c["signature"], n)
    assert not ok and "already been used" in why


def test_difficulty_cannot_be_lowered_by_the_client():
    c = challenge.issue_challenge("203.0.113.3")
    ok, why = challenge.verify_solution("203.0.113.3", c["challenge"], c["issued_at"],
                                        4, c["signature"], solve(c))
    assert not ok and "signature" in why.lower()


def test_a_forged_signature_is_rejected():
    c = challenge.issue_challenge("203.0.113.4")
    ok, _ = challenge.verify_solution("203.0.113.4", c["challenge"], c["issued_at"],
                                      c["difficulty"], "0" * 32, solve(c))
    assert not ok


def test_an_incorrect_nonce_is_rejected():
    c = challenge.issue_challenge("203.0.113.5")
    ok, why = challenge.verify_solution("203.0.113.5", c["challenge"], c["issued_at"],
                                        c["difficulty"], c["signature"], solve(c) + 1)
    assert not ok and "insufficient" in why.lower()


def test_an_expired_challenge_is_rejected():
    c = challenge.issue_challenge("203.0.113.6")
    stale = c["issued_at"] - challenge.CHALLENGE_TTL_SECONDS - 60
    sig = challenge._sign(f"{c['challenge']}:{stale}:{c['difficulty']}")
    ok, why = challenge.verify_solution("203.0.113.6", c["challenge"], stale,
                                        c["difficulty"], sig, 0)
    assert not ok and "expired" in why.lower()


@pytest.mark.parametrize("bad", [None, "", "abc", -1])
def test_malformed_responses_are_rejected(bad):
    c = challenge.issue_challenge("203.0.113.7")
    ok, _ = challenge.verify_solution("203.0.113.7", c["challenge"], c["issued_at"],
                                      c["difficulty"], c["signature"], bad)
    assert not ok


def test_difficulty_escalates_with_repeated_solving():
    """Cost lands on sustained automation, not on a researcher assessing a few papers."""
    ip = "203.0.113.8"
    challenge._recent_solves[ip] = []
    base = challenge.difficulty_for(ip)
    challenge._recent_solves[ip] = [challenge.time.time()] * 12
    assert challenge.difficulty_for(ip) > base


def test_difficulty_is_bounded():
    ip = "203.0.113.9"
    challenge._recent_solves[ip] = [challenge.time.time()] * 5000
    assert challenge.difficulty_for(ip) <= challenge.MAX_DIFFICULTY


def test_a_first_time_visitor_gets_the_base_tier():
    challenge._recent_solves.pop("203.0.113.77", None)
    assert challenge.issue_challenge("203.0.113.77")["difficulty"] == challenge.BASE_DIFFICULTY


# --------------------------------------------------------------------------
# Rate-limit circuit breaker
# --------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def clear_breaker():
    providers._cooldowns.clear()
    yield


def test_a_route_is_not_cooling_by_default():
    assert providers.is_route_cooling("gemini-2.5-flash", "Google")[0] is False


def test_a_rate_limited_route_enters_cooldown():
    providers.record_rate_limit("gemini-2.5-flash", "Google")
    cooling, remaining = providers.is_route_cooling("gemini-2.5-flash", "Google")
    assert cooling and remaining > 0


def test_the_providers_own_retry_after_is_honoured():
    """Guessing shorter than the provider asks for is how quota bans happen."""
    providers.record_rate_limit("gemini-2.5-flash", "Google", retry_after=25)
    _, remaining = providers.is_route_cooling("gemini-2.5-flash", "Google")
    assert 20 <= remaining <= 26


def test_cooldown_grows_with_consecutive_failures():
    providers.record_rate_limit("m", "P")
    _, first = providers.is_route_cooling("m", "P")
    providers.record_rate_limit("m", "P")
    _, second = providers.is_route_cooling("m", "P")
    assert second > first


def test_cooldown_is_capped():
    for _ in range(20):
        providers.record_rate_limit("m", "P")
    _, remaining = providers.is_route_cooling("m", "P")
    assert remaining <= providers.MAX_COOLDOWN_SECONDS + 1


def test_a_success_clears_the_backoff():
    providers.record_rate_limit("m", "P")
    providers.record_success("m", "P")
    assert providers.is_route_cooling("m", "P")[0] is False


def test_cooldowns_do_not_leak_between_routes():
    providers.record_rate_limit("model-a", "Google")
    assert providers.is_route_cooling("model-b", "Google")[0] is False


@pytest.mark.parametrize("text,expected", [
    ("Retry-After: 42", 42.0),
    ('"retryDelay": "17s"', 17.0),
    ("429 Too Many Requests", None),
    ("", None),
])
def test_retry_after_is_parsed_from_varied_formats(text, expected):
    assert providers.parse_retry_after(text) == expected


def test_cooldowns_are_reported_to_the_operator():
    providers.record_rate_limit("gemini-2.5-flash", "Google")
    status = providers.cooldown_status()
    assert any("gemini-2.5-flash" in c["route"] for c in status)


def test_diagnostics_explain_active_cooldowns(monkeypatch):
    monkeypatch.setattr(providers, "GEMINI_API_KEY", "k")
    providers.record_rate_limit("gemini-2.5-flash", "Google")
    advice = " ".join(providers.provider_configuration()["advice"])
    assert "cooldown" in advice.lower()


def test_gemini_has_multiple_free_tier_fallbacks(monkeypatch):
    """The free tier rate-limits hard, so one model is not enough."""
    monkeypatch.setattr(providers, "GEMINI_API_KEY", "k")
    monkeypatch.setattr(providers, "OR_API_KEY", "k")
    routes = providers.build_routes("gemini")
    assert len(routes) >= 4
    assert any(r["provider"] == "OpenRouter" for r in routes), \
        "needs a route that doesn't draw on the Google quota"
