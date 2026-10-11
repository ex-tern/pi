"""The site password (gate.py): off by default, a signed cookie once typed, the password never stored."""
import gate


class _Req:
    def __init__(self, path="/", cookies=None, accept="text/html", method="GET"):
        self.url = type("U", (), {"path": path, "scheme": "https"})()
        self.cookies = cookies or {}
        self.headers = {"accept": accept}
        self.method = method


def test_unset_means_open(monkeypatch):
    monkeypatch.delenv("SITE_PASSWORD", raising=False)
    assert gate.enabled() is False
    assert gate.passes(_Req("/anything"), "s") is True


def test_set_means_closed_until_the_cookie(monkeypatch):
    monkeypatch.setenv("SITE_PASSWORD", "open sesame")
    assert gate.passes(_Req("/"), "s") is False
    assert gate.passes(_Req("/app.js"), "s") is False
    assert gate.passes(_Req("/api/build"), "s") is False
    for path in gate.OPEN:
        assert gate.passes(_Req(path), "s") is True


def test_the_right_password_gives_a_cookie_that_passes(monkeypatch):
    monkeypatch.setenv("SITE_PASSWORD", "open sesame")
    assert gate.check("wrong", "s") is None
    value = gate.check("open sesame", "s")
    assert value and "sesame" not in value and len(value) == 64
    assert gate.passes(_Req("/", cookies={gate.COOKIE: value}), "s") is True
    assert gate.passes(_Req("/", cookies={gate.COOKIE: value}), "other-secret") is False   # another secret: another cookie


def test_changing_the_password_logs_everyone_out(monkeypatch):
    monkeypatch.setenv("SITE_PASSWORD", "one")
    old = gate.check("one", "s")
    monkeypatch.setenv("SITE_PASSWORD", "two")
    assert gate.passes(_Req("/", cookies={gate.COOKIE: old}), "s") is False
