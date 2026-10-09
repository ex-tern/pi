"""ORCID sign-in returns the visitor to the site they started on.

The registered ORCID callback is the old Railway address; the sign-in must
still land back on pitechlab.com, and never on an origin we don't know.
"""

import os
import tempfile
import urllib.parse

import pytest

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())
os.environ.setdefault("SESSION_SECRET", "test-secret-for-orcid")

import api  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

OLD = "scholarpi.up.railway.app"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api, "ORCID_CLIENT_ID", "APP-TEST")
    monkeypatch.setattr(api, "ORCID_CLIENT_SECRET", "secret")
    monkeypatch.setattr(api, "ORCID_REDIRECT_URI", f"https://{OLD}/api/auth/orcid/callback")
    monkeypatch.setattr(api, "FRONTEND_ORIGIN", "http://localhost:8000")

    class Ok:
        status_code = 200
        content = b"{}"

        @staticmethod
        def json():
            return {"orcid": "0000-0002-1825-0097", "name": "Test Scholar"}

    monkeypatch.setattr(api.requests, "post", lambda *a, **k: Ok())
    return TestClient(api.app, follow_redirects=False)


def login_state(client, host, wallet=None):
    params = {"wallet": wallet} if wallet else {}
    r = client.get("/api/auth/orcid/login-url", params=params,
                   headers={"x-forwarded-host": host, "x-forwarded-proto": "https"})
    assert r.status_code == 200
    q = urllib.parse.parse_qs(urllib.parse.urlparse(r.json()["url"]).query)
    assert q["redirect_uri"] == [f"https://{OLD}/api/auth/orcid/callback"]   # still the registered one
    return q["state"][0]


def callback(client, state):
    return client.get("/api/auth/orcid/callback", params={"code": "abc", "state": state},
                      headers={"x-forwarded-host": OLD, "x-forwarded-proto": "https"})


def test_returns_to_pitechlab_not_the_old_address(client):
    r = callback(client, login_state(client, "pitechlab.com"))
    assert r.status_code in (302, 307)
    loc = r.headers["location"]
    assert loc.startswith("https://pitechlab.com/?orcid=0000-0002-1825-0097")
    assert "&token=" in loc


def test_wallet_still_carried(client):
    w = "0x00000000000000000000000000000000000000aa"
    r = callback(client, login_state(client, "pitechlab.com", wallet=w))
    assert "&wallet=0x" in r.headers["location"]


def test_unknown_origin_is_not_followed(client):
    evil = api._orcid_state("none", "https://evil.example")
    r = callback(client, evil)
    assert not r.headers["location"].startswith("https://evil.example")
    assert r.headers["location"].startswith(f"https://{OLD}/")


def test_old_style_state_still_works(client):
    r = callback(client, "none")
    assert r.headers["location"].startswith(f"https://{OLD}/?orcid=")


def test_errors_also_go_home(client, monkeypatch):
    class Bad:
        status_code = 400
        content = b'{"error_description": "bad code"}'

        @staticmethod
        def json():
            return {"error_description": "bad code"}

    monkeypatch.setattr(api.requests, "post", lambda *a, **k: Bad())
    r = callback(client, login_state(client, "pitechlab.com"))
    assert r.headers["location"].startswith("https://pitechlab.com/?orcid_error=")


def test_extra_origins_from_env(client, monkeypatch):
    monkeypatch.setenv("ORCID_RETURN_ORIGINS", "https://exp.pitechlab.com")
    r = callback(client, login_state(client, "exp.pitechlab.com"))
    assert r.headers["location"].startswith("https://exp.pitechlab.com/?orcid=")
