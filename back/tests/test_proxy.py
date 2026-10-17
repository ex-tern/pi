"""The web proxy: off without a password, only with it, only public addresses, and the page made harmless."""
import os
import sqlite3
import tempfile

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402


class Res:
    def __init__(self, ctype, status=200):
        self.headers = {"Content-Type": ctype}
        self.status_code = status
        self.encoding = "utf-8"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-for-proxy")
    monkeypatch.setattr(api, "DB_PATH", str(tmp_path / "t.db"))
    conn = sqlite3.connect(api.DB_PATH)
    api.enforce_database_schema(conn)
    conn.commit()
    conn.close()
    api._RATE_LIMIT_BUCKETS.clear()
    api._proxy_hits.clear()
    return TestClient(api.app)


def test_off_without_a_password(client, monkeypatch):
    monkeypatch.delenv("PROXY_PASSWORD", raising=False)
    assert client.get("/api/proxy/status").json() == {"enabled": False, "allowed": False}
    assert client.get("/proxy", params={"u": "https://example.org/"}).status_code == 403
    assert client.post("/api/proxy/enter", json={"password": "x"}).status_code == 403


def test_only_with_the_password(client, monkeypatch):
    monkeypatch.setenv("PROXY_PASSWORD", "open sesame")
    r = client.get("/proxy", params={"u": "https://example.org/"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/#/proxy"
    assert client.post("/api/proxy/enter", json={"password": "wrong"}).status_code == 401
    assert client.post("/api/proxy/enter", json={"password": "open sesame"}).status_code == 200
    assert client.get("/api/proxy/status").json() == {"enabled": True, "allowed": True}
    # a private address: refused, after the password
    r = client.get("/proxy", params={"u": "http://192.168.0.1/"})
    assert r.status_code == 400 and "public" in r.text
    r = client.get("/proxy", params={"u": "http://127.0.0.1:8000/api/logs"})
    assert r.status_code == 400


def test_the_page_runs_nothing_and_points_back(client, monkeypatch):
    monkeypatch.setenv("PROXY_PASSWORD", "pw")
    client.post("/api/proxy/enter", json={"password": "pw"})
    page = (b'<html><head><script>steal()</script></head><body onload="x()"><a href="/next">Next</a>'
            b'<img src="pic.png"><form action="/s"><input name="q"></form><a href="javascript:bad()">j</a></body></html>')
    seen = []

    def fake(method, url, data=None, ctype=""):
        seen.append((method, url, data))
        if url.endswith(".js"):
            return url, Res("application/javascript"), b"evil()"
        return url, Res("text/html; charset=utf-8"), page
    monkeypatch.setattr(api, "proxy_fetch", fake)
    r = client.get("/proxy", params={"u": "example.org/a/"})
    assert r.status_code == 200 and seen[-1][1] == "https://example.org/a/"
    csp = r.headers["content-security-policy"]
    assert "script-src 'none'" in csp and csp.startswith("sandbox")
    t = r.text
    assert "steal" not in t and "onload" not in t and "javascript:" not in t
    assert '/proxy?u=https%3A%2F%2Fexample.org%2Fnext' in t and '/proxy?u=https%3A%2F%2Fexample.org%2Fa%2Fpic.png' in t
    assert 'action="/proxy/form"' in t and 'name="__u" value="https://example.org/s"' in t
    # a script file comes back empty
    assert client.get("/proxy", params={"u": "https://example.org/x.js"}).content == b""
    # a search form, through the proxy
    client.get("/proxy/form", params={"__u": "https://example.org/s", "q": "pi day"})
    assert seen[-1][1] == "https://example.org/s?q=pi+day"
    client.post("/proxy/form", data={"__u": "https://example.org/login", "a": "1"})
    assert seen[-1] == ("POST", "https://example.org/login", b"a=1")


def test_not_its_own_site(client, monkeypatch):
    monkeypatch.setenv("PROXY_PASSWORD", "pw")
    client.post("/api/proxy/enter", json={"password": "pw"})
    r = client.get("/proxy", params={"u": "https://piii.app/"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/"
