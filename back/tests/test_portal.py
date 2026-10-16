"""The open portal: anyone writes, everyone reads; per-writer limits; the writer or the owner takes a post down."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

import api

OWNER = "0x00000000000000000000000000000000000000aa"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-for-portal")
    monkeypatch.setattr(api, "OWNER_ID", OWNER)
    monkeypatch.setattr(api, "DB_PATH", str(tmp_path / "t.db"))
    conn = sqlite3.connect(api.DB_PATH)
    api.enforce_database_schema(conn)
    conn.commit()
    conn.close()
    api._RATE_LIMIT_BUCKETS.clear()
    return TestClient(api.app)


def ip(n):
    return {"x-forwarded-for": f"203.0.113.{n}"}


def test_write_and_read(client):
    r = client.post("/api/portal", json={"text": "  hello\x00 world ‮\n\n\n\nbye ", "name": "Ada\nL"}, headers=ip(1))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["text"] == "hello world \n\nbye" and d["name"] == "Ada L" and d["key"]
    client.post("/api/portal", json={"text": "second"}, headers=ip(2))
    got = client.get("/api/portal").json()
    assert [p["text"] for p in got["posts"]] == ["second", "hello world \n\nbye"]
    assert got["total"] == 2 and "key" not in got["posts"][0] and "ip_hash" not in got["posts"][0]
    page = client.get("/api/portal", params={"limit": 1}).json()
    assert page["more"] and client.get("/api/portal", params={"before": page["posts"][0]["id"]}).json()["posts"][0]["text"].startswith("hello")


def test_limits(client):
    assert client.post("/api/portal", json={"text": "   "}, headers=ip(3)).status_code == 400
    assert client.post("/api/portal", json={"text": "x" * 1001}, headers=ip(3)).status_code == 400
    assert client.post("/api/portal", json={"text": "one"}, headers=ip(3)).status_code == 200
    r = client.post("/api/portal", json={"text": "two"}, headers=ip(3))
    assert r.status_code == 429 and "seconds" in r.json()["detail"]
    assert client.post("/api/portal", json={"text": "two"}, headers=ip(4)).status_code == 200


def test_take_down(client):
    d = client.post("/api/portal", json={"text": "mine"}, headers=ip(5)).json()
    o = client.post("/api/portal", json={"text": "theirs"}, headers=ip(6)).json()
    assert client.post(f"/api/portal/{o['id']}/delete", json={"key": d["key"]}).status_code in (403, 503)
    assert client.post(f"/api/portal/{d['id']}/delete", json={"key": d["key"]}).status_code == 200
    tok = api.issue_session(wallet=OWNER, methods={"wallet": "eip191"})
    assert client.post(f"/api/portal/{o['id']}/delete", json={}, headers={"Authorization": "Bearer " + tok}).status_code == 200
    assert client.get("/api/portal").json()["posts"] == []
    assert client.post(f"/api/portal/{o['id']}/delete", json={}).status_code == 404
