"""Per-address use: kept only for visitors who ticked "Count my visit", shown only to the owner, kept 90 days."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

import api

OWNER = "0x00000000000000000000000000000000000000aa"
OTHER = "0x00000000000000000000000000000000000000bb"
YES = {"pi_consent": "v1.c1.l0.e0"}
NO = {"pi_consent": "v1.c0.l1.e1"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-for-ips")
    monkeypatch.setattr(api, "OWNER_ID", OWNER)
    monkeypatch.setattr(api, "DB_PATH", str(tmp_path / "t.db"))
    conn = sqlite3.connect(api.DB_PATH)
    api.enforce_database_schema(conn)
    conn.commit()
    conn.close()
    api._IP_DAYS.clear()
    api._IP_PATHS.clear()
    return TestClient(api.app)


def bearer(wallet):
    return {"Authorization": "Bearer " + api.issue_session(wallet=wallet, methods={"wallet": "eip191"})}


def test_labels_hide_ids():
    assert api.ip_path_label("GET", "/api/papers/1234567/score") == "GET /api/papers/:id/score"
    assert api.ip_path_label("GET", "/api/dossier/0000-0002-1825-0097") == "GET /api/dossier/:id"
    assert api.ip_kind("/api/x") == "api" and api.ip_kind("/facemace/") == "page" and api.ip_kind("/app/ui.wasm") == "asset"
    assert api.ip_consented("v1.c1.l0.e0") and not api.ip_consented("v1.c0.l1.e1") and not api.ip_consented("")


def test_only_consented_and_only_owner(client):
    h = {"x-forwarded-for": "203.0.113.7", "user-agent": "TestBrowser/1"}
    client.cookies.update(YES)
    client.get("/api/analytics/summary", headers=h)
    client.get("/api/analytics/summary", headers=h)
    client.post("/api/hit", json={"view": "#/tool/facemace"}, headers=h)
    client.cookies.clear()
    client.cookies.update(NO)
    client.get("/api/analytics/summary", headers={"x-forwarded-for": "198.51.100.9"})
    assert client.post("/api/hit", json={"view": "#/x"}, headers={"x-forwarded-for": "198.51.100.9"}).json()["ok"] is False
    client.cookies.clear()

    assert client.get("/api/admin/ips").status_code in (403, 503)
    assert client.get("/api/admin/ips", headers=bearer(OTHER)).status_code == 403
    d = client.get("/api/admin/ips", headers=bearer(OWNER)).json()
    ips = {x["ip"]: x for x in d["ips"]}
    assert "198.51.100.9" not in ips                       # did not tick "Count my visit"
    me = ips["203.0.113.7"]
    assert me["requests"] == 2 and me["api"] == 2 and me["views"] == 1 and me["ua"] == "TestBrowser/1"
    assert {"path": "GET /api/analytics/summary", "hits": 2} in me["top"]
    one = client.get("/api/admin/ips/one", params={"ip": "203.0.113.7"}, headers=bearer(OWNER)).json()
    assert one["days"][0]["requests"] == 2 and any(p["path"] == "view #/tool/facemace" for p in one["paths"])
    assert d["retention_days"] == 90


def test_old_rows_are_deleted(client):
    conn = sqlite3.connect(api.DB_PATH)
    conn.execute("INSERT INTO ip_usage (ip, day, requests) VALUES ('192.0.2.1', '2000-01-01', 5)")
    conn.execute("INSERT INTO ip_paths (ip, path, hits, last_at) VALUES ('192.0.2.1', '/x', 5, '2000-01-01 00:00:00')")
    conn.commit()
    conn.close()
    api._IP_STATE["purged"] = 0.0
    api.ip_flush(force=True)
    conn = sqlite3.connect(api.DB_PATH)
    assert conn.execute("SELECT COUNT(*) FROM ip_usage WHERE ip = '192.0.2.1'").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM ip_paths WHERE ip = '192.0.2.1'").fetchone()[0] == 0
