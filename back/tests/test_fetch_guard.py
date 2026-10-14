"""The server fetches manuscript URLs only from public http(s) addresses, checks every redirect, and caps the body."""

import os
import tempfile

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())

import api  # noqa: E402


def test_private_and_odd_addresses_are_refused():
    for url in ["http://127.0.0.1/x.pdf", "http://localhost:8000/api/logs", "http://10.0.0.5/a",
                "http://169.254.169.254/latest/meta-data/", "http://[::1]/a", "file:///etc/passwd",
                "ftp://example.com/a.pdf", "http://0.0.0.0/", "http://192.168.1.1/", "not a url"]:
        assert not api.public_url(url), url


def test_a_public_address_is_allowed(monkeypatch):
    monkeypatch.setattr(api.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 443))])
    assert api.public_url("https://example.org/paper.pdf")


class Res:
    def __init__(self, status=200, headers=None, body=b""):
        self.status_code, self.headers, self.body = status, headers or {}, body
        self.is_redirect = status in (301, 302, 303, 307, 308)

    def iter_content(self, chunk_size):
        for i in range(0, len(self.body), chunk_size):
            yield self.body[i:i + chunk_size]

    def close(self):
        pass


class Session:
    def __init__(self, routes):
        self.routes, self.seen = routes, []

    def get(self, url, **kw):
        assert kw.get("allow_redirects") is False
        self.seen.append(url)
        return self.routes[url]


def public_except_internal(monkeypatch):
    monkeypatch.setattr(api, "public_url", lambda u: "internal" not in u)


def test_a_redirect_to_a_private_address_is_refused(monkeypatch):
    public_except_internal(monkeypatch)
    s = Session({"https://a.org/p.pdf": Res(302, {"Location": "http://internal/secret"})})
    res, body = api.fetch_public(s, "https://a.org/p.pdf")
    assert res is None and s.seen == ["https://a.org/p.pdf"]


def test_redirects_are_followed_when_public(monkeypatch):
    public_except_internal(monkeypatch)
    s = Session({"https://a.org/p": Res(301, {"Location": "/p.pdf"}), "https://a.org/p.pdf": Res(200, {}, b"%PDF-1.7 hi")})
    res, body = api.fetch_public(s, "https://a.org/p")
    assert body == b"%PDF-1.7 hi"


def test_an_endless_body_is_cut_off(monkeypatch):
    public_except_internal(monkeypatch)
    s = Session({"https://a.org/big.pdf": Res(200, {}, b"%PDF" + b"x" * 5000)})
    assert api.fetch_public(s, "https://a.org/big.pdf", max_bytes=1000) == (None, None)
    s = Session({"https://a.org/big.pdf": Res(200, {"Content-Length": "999999999"}, b"")})
    assert api.fetch_public(s, "https://a.org/big.pdf") == (None, None)
