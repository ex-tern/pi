"""piii VPN through Tailscale: only the owner manages it; the computer found; invites made and withdrawn."""
import os
import sqlite3
import tempfile

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402

PC = {"nodeId": "nPC", "hostname": "piii", "os": "linux", "lastSeen": "2026-10-17T01:00:00Z", "connectedToControl": True,
      "advertisedRoutes": ["0.0.0.0/0", "::/0"], "enabledRoutes": []}
PHONE = {"nodeId": "nPH", "hostname": "iphone", "os": "iOS", "advertisedRoutes": [], "enabledRoutes": []}


@pytest.fixture
def tailscale(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-ts")
    monkeypatch.setenv("TAILSCALE_API_KEY", "tskey-api-test")
    monkeypatch.setenv("VPN_ADMIN_PASSWORD", "admin pw")
    monkeypatch.setattr(api, "DB_PATH", str(tmp_path / "t.db"))
    conn = sqlite3.connect(api.DB_PATH)
    api.enforce_database_schema(conn)
    conn.commit()
    conn.close()
    api._RATE_LIMIT_BUCKETS.clear()
    calls, invites = [], []

    def fake(method, path, body=None):
        calls.append((method, path, body))
        if path.endswith("/devices?fields=all"):
            return {"devices": [PHONE, PC]}
        if path == "/device/nPC/routes" and method == "GET":
            return {"advertisedRoutes": PC["advertisedRoutes"], "enabledRoutes": PC["enabledRoutes"]}
        if path == "/device/nPC/routes":
            PC["enabledRoutes"] = body["routes"]
            return {}
        if path == "/device/nPC/device-invites" and method == "POST":
            inv = {"id": f"i{len(invites) + 1}", "inviteUrl": f"https://login.tailscale.com/admin/invite/c{len(invites) + 1}",
                   "accepted": False, "multiUse": body[0]["multiUse"], "allowExitNode": body[0]["allowExitNode"]}
            invites.append(inv)
            return [inv]
        if path == "/device/nPC/device-invites":
            return list(invites)
        if path.startswith("/device-invites/") and method == "DELETE":
            invites[:] = [i for i in invites if i["id"] != path.rsplit("/", 1)[1]]
            return {}
        raise AssertionError(path)
    monkeypatch.setattr(api, "ts_call", fake)
    return TestClient(api.app), calls, invites


def test_only_the_owner(tailscale):
    c, calls, _ = tailscale
    assert c.get("/api/ts/status").json() == {"configured": True, "admin": False, "can_login": True}
    assert c.post("/api/ts/invite", json={"name": "x"}).status_code == 403
    assert c.post("/api/ts/login", json={"password": "nope"}).status_code == 401
    assert not calls


def test_invite_and_withdraw(tailscale):
    c, calls, invites = tailscale
    assert c.post("/api/ts/login", json={"password": "admin pw"}).status_code == 200
    st = c.get("/api/ts/status").json()
    assert st["exit_node"]["name"] == "piii" and st["exit_node"]["offers_exit"] and not st["exit_node"]["exit_approved"]
    assert c.post("/api/ts/approve-exit").json() == {"approved": True}
    assert set(PC["enabledRoutes"]) == {"0.0.0.0/0", "::/0"}
    r = c.post("/api/ts/invite", json={"name": "Sara's phone"}).json()
    assert r["url"].endswith("/c1") and invites[0]["allowExitNode"] is True and invites[0]["multiUse"] is False
    st = c.get("/api/ts/status").json()
    assert st["invites"][0]["name"] == "Sara's phone" and st["invites"][0]["url"].endswith("/c1")
    assert c.post("/api/ts/invite", json={"email": "not an email"}).status_code == 400
    assert c.post("/api/ts/invite/i1/delete").json() == {"deleted": "i1"}
    assert c.get("/api/ts/status").json()["invites"] == []
    assert c.post("/api/ts/invite/..%2Fx/delete").status_code in (400, 404)
