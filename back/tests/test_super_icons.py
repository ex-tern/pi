"""Super AI icons: drawn once per name, checked to be plain path data, never more than three new per request."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api


def make(draw, allowed=True):
    kept = {}
    app = FastAPI()
    app.include_router(api.super_icons_build_router(
        draw=draw, rate_limit=lambda r: None, load=lambda: dict(kept),
        store=lambda n, p: kept.__setitem__(n, p), allowed=lambda r: allowed))
    return TestClient(app), kept


def test_draws_new_names_and_keeps_them():
    calls = []
    c, kept = make(lambda n: calls.append(n) or ["M4 4h16v16H4z"])
    r = c.post("/api/super/icons", json={"names": ["Live", "Analytics", "Live"]}).json()
    assert r["icons"] == {"Live": ["M4 4h16v16H4z"], "Analytics": ["M4 4h16v16H4z"]}
    assert calls == ["Live", "Analytics"] and set(kept) == {"Live", "Analytics"}
    c.post("/api/super/icons", json={"names": ["Live"]})
    assert calls == ["Live", "Analytics"]


def test_at_most_three_new_per_request():
    c, _ = make(lambda n: ["M2 2L22 22"])
    r = c.post("/api/super/icons", json={"names": ["a", "b", "c", "d", "e"]}).json()
    assert len(r["icons"]) == 3 and r["pending"] == ["d", "e"]


def test_failed_drawings_are_reported():
    c, kept = make(lambda n: None)
    r = c.post("/api/super/icons", json={"names": ["x"]}).json()
    assert r["failed"] == ["x"] and kept == {}


def test_declined_outside_models_draw_nothing():
    c, _ = make(lambda n: ["M2 2L22 22"], allowed=False)
    r = c.post("/api/super/icons", json={"names": ["x"]}).json()
    assert r["icons"] == {} and r["failed"] == ["x"]


def test_only_plain_path_data_is_accepted():
    assert api.icon_paths({"paths": ["M4 4L20 20", "M4 20 L20 4"]}) == ["M4 4L20 20", "M4 20 L20 4"]
    for bad in (["<script>"], ['M4 4" onload=x'], ["javascript:1"], ["L4 4"], ["M4 4L900 900"], [], "M4 4", None):
        assert api.icon_paths({"paths": bad}) is None
    assert api.icon_name("  Super\n  AI\t ") == "Super AI"
