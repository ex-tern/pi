"""
Free-tier abuse controls.

The free trial gives away real money — every assessment consumes LLM inference
credits — so these limits need to hold against deliberate circumvention. The
false-positive tests matter just as much: a legitimate researcher who trips a
limit should never be blocked outright by a single weak signal.

Run with:  cd backend && pytest tests/ -v
"""
import os
import sys
import tempfile
import time

import pytest

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import abuse_guard


BROWSER_HEADERS = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    "accept-language": "en-GB,en;q=0.9",
    "accept": "text/html,application/xhtml+xml",
    "sec-fetch-site": "same-origin",
}


@pytest.fixture(autouse=True)
def reset_state():
    abuse_guard._request_times.clear()
    abuse_guard._subnet_documents.clear()
    abuse_guard._blocked_until.clear()
    yield


def valid_pdf(size=8192):
    body = b"%PDF-1.7\n/Pages 1 0 R\n" + b"x" * size
    return body


# --------------------------------------------------------------------------
# Free-tier allowance
# --------------------------------------------------------------------------
def test_free_tier_allows_three_documents():
    assert abuse_guard.FREE_DOCUMENTS == 3


def test_allowance_is_metered_in_distinct_documents():
    ip = "203.0.113.10"
    ok, _ = abuse_guard.check_free_tier(ip, documents_used=0, new_fingerprints=["a", "b", "c"])
    assert ok


def test_batch_larger_than_remaining_allowance_is_refused():
    ok, reason = abuse_guard.check_free_tier("203.0.113.11", documents_used=2,
                                             new_fingerprints=["a", "b", "c"])
    assert not ok
    assert "only 1 free" in reason


def test_exhausted_allowance_is_refused_with_a_clear_reason():
    ok, reason = abuse_guard.check_free_tier("203.0.113.12", documents_used=3,
                                             new_fingerprints=["new"])
    assert not ok
    assert "Free trial complete" in reason
    assert "wallet" in reason.lower()


def test_resubmitting_a_known_document_never_consumes_allowance():
    """Removes any incentive to retry, and means a mistake isn't punished."""
    ip = "203.0.113.13"
    abuse_guard.register_documents(ip, ["seen-doc"])
    ok, _ = abuse_guard.check_free_tier(ip, documents_used=99, new_fingerprints=["seen-doc"])
    assert ok


def test_identical_content_produces_an_identical_fingerprint():
    assert abuse_guard.document_fingerprint(b"same") == abuse_guard.document_fingerprint(b"same")
    assert abuse_guard.document_fingerprint(b"a") != abuse_guard.document_fingerprint(b"b")


# --------------------------------------------------------------------------
# Address rotation
# --------------------------------------------------------------------------
def test_addresses_in_one_ipv4_block_share_an_allowance():
    assert abuse_guard.subnet_key("203.0.113.5") == abuse_guard.subnet_key("203.0.113.200")


def test_different_blocks_do_not_share_an_allowance():
    assert abuse_guard.subnet_key("203.0.113.5") != abuse_guard.subnet_key("198.51.100.5")


def test_ipv6_is_grouped_by_allocation_block():
    a = abuse_guard.subnet_key("2001:db8:abcd:0001::1")
    b = abuse_guard.subnet_key("2001:db8:abcd:9999::9")
    assert a == b


def test_rotating_addresses_within_a_block_hits_the_aggregate_ceiling():
    """The whole point of subnet aggregation: rotation must not multiply the allowance."""
    for i in range(abuse_guard.SUBNET_FREE_DOCUMENTS):
        abuse_guard.register_documents(f"203.0.113.{i}", [f"doc-{i}"])
    ok, reason = abuse_guard.check_free_tier("203.0.113.250", documents_used=0,
                                             new_fingerprints=["fresh-doc"])
    assert not ok
    assert "network range" in reason


def test_malformed_address_is_handled():
    assert abuse_guard.subnet_key("not-an-ip").startswith("raw:")


# --------------------------------------------------------------------------
# Velocity
# --------------------------------------------------------------------------
def test_rapid_repeat_submissions_are_throttled():
    ip = "198.51.100.20"
    abuse_guard.record_request(ip)
    ok, reason = abuse_guard.check_velocity(ip)
    assert not ok
    assert "too quickly" in reason


def test_burst_ceiling_triggers_a_temporary_pause():
    ip = "198.51.100.21"
    now = time.time()
    for i in range(abuse_guard.BURST_MAX_REQUESTS):
        abuse_guard._request_times[ip].append(now - 30 + i)
    ok, reason = abuse_guard.check_velocity(ip)
    assert not ok
    assert "Paused" in reason


def test_a_paused_client_is_told_how_long_remains():
    ip = "198.51.100.22"
    abuse_guard._blocked_until[ip] = time.time() + 120
    ok, reason = abuse_guard.check_velocity(ip)
    assert not ok
    assert "rate-limited" in reason


def test_slow_legitimate_use_is_not_throttled():
    ip = "198.51.100.23"
    now = time.time()
    for i in range(3):
        abuse_guard._request_times[ip].append(now - 600 * (3 - i))
    ok, _ = abuse_guard.check_velocity(ip)
    assert ok


# --------------------------------------------------------------------------
# Automation heuristics — false positives are the real risk
# --------------------------------------------------------------------------
@pytest.mark.parametrize("agent", [
    "python-requests/2.31.0", "curl/8.1.2", "Wget/1.21", "Go-http-client/1.1",
    "axios/1.6.0", "Scrapy/2.11", "PostmanRuntime/7.36",
])
def test_scripted_clients_are_detected(agent):
    result = abuse_guard.assess_automation_signals({"user-agent": agent}, "198.51.100.30")
    assert result["likely_automated"]


def test_a_real_browser_is_not_flagged():
    result = abuse_guard.assess_automation_signals(BROWSER_HEADERS, "198.51.100.31")
    assert not result["likely_automated"]
    assert result["score"] < 0.6


def test_a_single_weak_signal_is_not_enough_to_block():
    """Privacy tooling strips headers; that alone must not deny access."""
    headers = dict(BROWSER_HEADERS)
    headers.pop("accept-language")
    result = abuse_guard.assess_automation_signals(headers, "198.51.100.32")
    assert not result["likely_automated"]


def test_machine_regular_timing_is_recognised():
    ip = "198.51.100.33"
    now = time.time()
    for i in range(abuse_guard.REGULARITY_SAMPLES + 1):
        abuse_guard._request_times[ip].append(now + i * 2.0)  # exactly 2s apart
    result = abuse_guard.assess_automation_signals({"user-agent": ""}, ip)
    assert any("machine-regular" in s for s in result["signals"])


# --------------------------------------------------------------------------
# Payload validation — runs before any paid inference
# --------------------------------------------------------------------------
def test_a_valid_pdf_passes():
    ok, _ = abuse_guard.validate_upload("paper.pdf", valid_pdf(), 25 * 1024 * 1024)
    assert ok


def test_a_renamed_non_pdf_is_rejected():
    ok, reason = abuse_guard.validate_upload("fake.pdf", b"just plain text" * 500,
                                             25 * 1024 * 1024)
    assert not ok
    assert "%PDF" in reason


def test_an_empty_file_is_rejected():
    ok, reason = abuse_guard.validate_upload("empty.pdf", b"", 25 * 1024 * 1024)
    assert not ok
    assert "empty" in reason


def test_a_trivially_small_file_is_rejected():
    ok, reason = abuse_guard.validate_upload("tiny.pdf", b"%PDF-1.4\n/Pages", 25 * 1024 * 1024)
    assert not ok
    assert "too small" in reason


def test_an_oversized_file_is_rejected():
    ok, reason = abuse_guard.validate_upload("big.pdf", valid_pdf(200), 100)
    assert not ok
    assert "limit" in reason


def test_a_pdf_without_page_structure_is_rejected():
    ok, reason = abuse_guard.validate_upload("broken.pdf", b"%PDF-1.7\n" + b"z" * 9000,
                                             25 * 1024 * 1024)
    assert not ok
    assert "page structure" in reason


# --------------------------------------------------------------------------
# Combined verdict
# --------------------------------------------------------------------------
def test_a_legitimate_first_time_visitor_is_allowed():
    verdict = abuse_guard.evaluate_request(
        ip="203.0.113.100", headers=BROWSER_HEADERS, documents_used=0,
        fingerprints=["doc-1"], has_identity=False)
    assert verdict["allowed"]


def test_a_scripted_free_tier_client_is_refused_with_403():
    verdict = abuse_guard.evaluate_request(
        ip="203.0.113.101", headers={"user-agent": "python-requests/2.31.0"},
        documents_used=0, fingerprints=["doc-1"], has_identity=False)
    assert not verdict["allowed"]
    assert verdict["code"] == 403


def test_identified_users_skip_free_tier_and_automation_checks():
    """They pay in piQ, which is its own abuse control."""
    verdict = abuse_guard.evaluate_request(
        ip="203.0.113.102", headers={"user-agent": "python-requests/2.31.0"},
        documents_used=99, fingerprints=["doc-1"], has_identity=True)
    assert verdict["allowed"]


def test_velocity_limits_apply_even_to_identified_users():
    """Those protect the service itself, not just the free tier."""
    ip = "203.0.113.103"
    abuse_guard.record_request(ip)
    verdict = abuse_guard.evaluate_request(
        ip=ip, headers=BROWSER_HEADERS, documents_used=0,
        fingerprints=["doc"], has_identity=True)
    assert not verdict["allowed"]
    assert verdict["code"] == 429


def test_exhausted_free_tier_returns_402():
    verdict = abuse_guard.evaluate_request(
        ip="203.0.113.104", headers=BROWSER_HEADERS, documents_used=3,
        fingerprints=["brand-new"], has_identity=False)
    assert not verdict["allowed"]
    assert verdict["code"] == 402


def test_every_refusal_explains_itself():
    verdict = abuse_guard.evaluate_request(
        ip="203.0.113.105", headers={"user-agent": "curl/8.0"}, documents_used=0,
        fingerprints=["d"], has_identity=False)
    assert not verdict["allowed"]
    assert verdict["reason"] and len(verdict["reason"]) > 40
