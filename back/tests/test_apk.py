"""Tailscale for Android from piii.app: fetched from F-Droid when new, served, and kept when F-Droid is away."""
import os
import tempfile

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())

import pytest  # noqa: E402
import requests  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402

APK = b"PK\x03\x04" + b"x" * 1_200_000


class R:
    def __init__(self, js=None, body=b""):
        self.js, self.body = js, body

    def json(self):
        return self.js

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size):
        for i in range(0, len(self.body), chunk_size):
            yield self.body[i:i + chunk_size]

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def web(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "BASE_DIR", str(tmp_path))
    state = {"code": 100, "up": True, "fetched": []}

    def get(url, **kw):
        if not state["up"]:
            raise requests.ConnectionError("down")
        if url == api.APK_API:
            return R({"suggestedVersionCode": state["code"], "packages": [{"versionName": f"1.{state['code']}.0-tabc", "versionCode": state["code"]}]})
        state["fetched"].append(url)
        return R(body=APK)
    monkeypatch.setattr(api.requests, "get", get)
    return TestClient(api.app), state


def test_fetched_served_and_kept(web, monkeypatch):
    c, state = web
    r = c.get("/downloads/tailscale.apk")
    assert r.status_code == 200 and r.content == APK
    assert r.headers["content-type"] == "application/vnd.android.package-archive"
    assert 'filename="tailscale-1.100.0.apk"' in r.headers["content-disposition"]
    assert state["fetched"] == ["https://f-droid.org/repo/com.tailscale.ipn_100.apk"]
    # within a day: not asked again
    c.get("/downloads/tailscale.apk")
    assert len(state["fetched"]) == 1
    # a day later, a new version: fetched; F-Droid away: the last one still served
    m = api.apk_meta()
    m["checked"] = 0
    api.apk_save_meta(m)
    state["code"] = 101
    c.get("/downloads/tailscale.apk")
    assert state["fetched"][-1].endswith("_101.apk") and api.apk_meta()["version"] == "1.101.0-tabc"
    m = api.apk_meta()
    m["checked"] = 0
    api.apk_save_meta(m)
    state["up"] = False
    assert c.get("/downloads/tailscale.apk").status_code == 200
    assert c.get("/api/downloads/tailscale").json()["size"] == len(APK)


def test_nothing_yet_and_no_internet(web):
    c, state = web
    state["up"] = False
    assert c.get("/downloads/tailscale.apk").status_code == 503
