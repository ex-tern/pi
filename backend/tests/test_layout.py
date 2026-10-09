"""Orbit layout: saved per proven identity, only its own, shape-checked."""

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

import auth
import layout

A = "0x00000000000000000000000000000000000000aa"
B = "0x00000000000000000000000000000000000000bb"


def _require_identity(request: Request, wallet: str = "", orcid: str = ""):
    identity = auth.identity_from_request(request, wallet, orcid)
    if identity["verified"] and (identity["wallet"] or identity["orcid"]):
        return identity
    raise HTTPException(status_code=401, detail="sign in")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-for-layout")
    app = FastAPI()
    app.include_router(layout.build_router(str(tmp_path), _require_identity))
    return TestClient(app)


def bearer(wallet="", orcid=""):
    return {"Authorization": "Bearer " + auth.issue_session(wallet=wallet, orcid=orcid, methods={"wallet": "eip191"})}


LAYOUT = {"orbit:logo": '{"fx":0.4,"fy":0.5}', "orbit:open": '["lab:HAL-OS"]', "orbit:at2:lab:HAL-OS": '{"fx":0.1,"fy":-0.2}'}


def test_requires_sign_in(client):
    assert client.get("/api/me/layout").status_code == 401
    assert client.put("/api/me/layout", json={"layout": LAYOUT}).status_code == 401
    # a claimed wallet is not a signed one
    assert client.get("/api/me/layout", params={"wallet": A}).status_code == 401


def test_round_trip_and_isolation(client):
    assert client.get("/api/me/layout", headers=bearer(A)).json() == {"layout": {}, "updated_at": None}
    r = client.put("/api/me/layout", json={"layout": LAYOUT}, headers=bearer(A))
    assert r.status_code == 200 and r.json()["entries"] == 3
    got = client.get("/api/me/layout", headers=bearer(A)).json()
    assert got["layout"] == LAYOUT and got["updated_at"]
    # another user sees nothing of it
    assert client.get("/api/me/layout", headers=bearer(B)).json()["layout"] == {}
    # replace, not merge
    client.put("/api/me/layout", json={"layout": {"orbit:logo": "null"}}, headers=bearer(A))
    assert client.get("/api/me/layout", headers=bearer(A)).json()["layout"] == {"orbit:logo": "null"}


def test_orcid_identity_has_its_own_row(client):
    client.put("/api/me/layout", json={"layout": LAYOUT}, headers=bearer(orcid="0000-0002-1825-0097"))
    assert client.get("/api/me/layout", headers=bearer(orcid="0000-0002-1825-0097")).json()["layout"] == LAYOUT
    assert client.get("/api/me/layout", headers=bearer(A)).json()["layout"] == {}


def test_rejects_bad_shapes(client):
    h = bearer(A)
    assert client.put("/api/me/layout", json={"layout": {"sp_token": '"x"'}}, headers=h).status_code == 422
    assert client.put("/api/me/layout", json={"layout": {"orbit:x": "not json"}}, headers=h).status_code == 422
    assert client.put("/api/me/layout", json={"layout": {"orbit:x": '"' + "a" * 70000 + '"'}}, headers=h).status_code == 413
    many = {f"orbit:k{i}": "1" for i in range(layout.MAX_KEYS + 1)}
    assert client.put("/api/me/layout", json={"layout": many}, headers=h).status_code == 413
