"""What makes the site 'busy' for the idle assessment worker."""

import importlib
import time

import config
import idle_worker as iw


def test_background_polling_is_not_busy():
    for path in ("/api/me/layout", "/api/pien/model", "/api/engines/status", "/orbit.js",
                 "/api/assessments/recent", "/api/logs"):
        assert not iw.is_busy_request(path, "GET"), path
    assert not iw.is_busy_request("/api/pien/learn", "POST")


def test_people_and_provider_calls_are_busy():
    assert iw.is_busy_request("/", "GET")
    assert iw.is_busy_request("/api/assess/stream", "POST")
    assert iw.is_busy_request("/api/scilem/chat", "POST")
    assert iw.is_busy_request("/api/assessments/abc/review/llm", "POST")


def test_polling_does_not_reset_idle_clock():
    iw._STATE["last_request_at"] = time.time() - 1000
    iw.note_request("/api/me/layout", "GET")
    assert iw.idle_seconds() > 900
    iw.note_request("/", "GET")
    assert iw.idle_seconds() < 5


def test_in_flight_assessment_blocks_the_worker(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_IDLE_ASSESSMENTS", True)
    monkeypatch.setattr(config, "IDLE_AFTER_SECONDS", 10)
    iw._STATE["running"] = False
    iw._STATE["assessed_today"] = 0
    iw._STATE["attempted_today"] = 0
    assert iw.begin("/api/assess/stream", "POST")
    iw._STATE["last_request_at"] = time.time() - 1000
    assert iw._may_run() is False          # an assessment is still running
    iw.end()
    iw._STATE["last_request_at"] = time.time() - 1000
    assert iw._may_run() is True
    iw._STATE["running"] = False


def test_on_by_default_only_when_hosted(monkeypatch):
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_PROJECT_ID", "ENABLE_IDLE_ASSESSMENTS"):
        monkeypatch.delenv(k, raising=False)
    importlib.reload(config)
    assert config.ENABLE_IDLE_ASSESSMENTS is False
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    importlib.reload(config)
    assert config.ENABLE_IDLE_ASSESSMENTS is True
    monkeypatch.setenv("ENABLE_IDLE_ASSESSMENTS", "0")
    importlib.reload(config)
    assert config.ENABLE_IDLE_ASSESSMENTS is False
    monkeypatch.delenv("ENABLE_IDLE_ASSESSMENTS")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME")
    importlib.reload(config)


def test_public_status_has_no_operator_detail():
    s = iw.public_status()
    assert set(s) == {"enabled", "assessed_today", "daily_cap", "last_title", "last_run_at", "working_now"}


def test_loop_never_spins(monkeypatch):
    """IDLE_POLL_SECONDS=0 must not turn the loop into a busy spin."""
    sleeps = []

    class Stop(Exception):
        pass

    def fake_sleep(s):
        sleeps.append(s)
        if len(sleeps) >= 3:
            raise Stop()

    monkeypatch.setattr(config, "IDLE_POLL_SECONDS", 0)
    monkeypatch.setattr(config, "IDLE_AFTER_SECONDS", 0)
    monkeypatch.setattr(iw, "run_once", lambda: {"ran": False})
    monkeypatch.setattr(iw.time, "sleep", fake_sleep)
    try:
        iw._loop()
    except Stop:
        pass
    assert all(s >= 7.5 for s in sleeps), sleeps
