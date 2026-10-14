"""The site is Rust (back/rust/ui -> front/app/ui.wasm): every page address gets the same loader, with no HTML files."""
import os

from fastapi.testclient import TestClient

import api
from tests.test_gate import _Req

FRONT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "front")


def test_no_html_files_are_served_from_disk():
    found = [os.path.join(d, f) for d, _, fs in os.walk(FRONT) for f in fs if f.lower().endswith((".html", ".htm"))]
    assert found == []


def test_every_page_address_starts_the_rust_app():
    c = TestClient(api.app)
    for path in ("/", "/index.html", "/app", "/confirm/?t=abc"):
        r = c.get(path)
        assert r.status_code == 200, path
        assert '/app/host.js?v=' in r.text and "<body" not in r.text
    assert c.get("/app/ui.wasm").headers["content-type"] == "application/wasm"


def test_the_loader_version_follows_the_build():
    assert api.rust_loader() == api.rust_loader()


def test_a_private_deployment_still_lets_the_app_load(monkeypatch):
    monkeypatch.setenv("SITE_PASSWORD", "open sesame")
    for path in ("/app/host.js", "/app/ui.wasm", "/fonts/Geist-Variable.woff2", "/icon.svg"):
        assert api.passes(_Req(path), "s") is True, path
    assert api.passes(_Req("/api/explorer/latest"), "s") is False
    page = api.page()
    assert page.status_code == 401 and b"/app/host.js" in page.body
