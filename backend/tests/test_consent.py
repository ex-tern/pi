"""Permission requests: owner creates, link holder answers, record is kept."""

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

import auth
import consent

OWNER = "0x00000000000000000000000000000000000000aa"
OTHER = "0x00000000000000000000000000000000000000bb"


def _require_owner(request: Request, wallet: str = ""):
    identity = auth.identity_from_request(request, wallet)
    if auth.is_owner(identity):
        return identity
    raise HTTPException(status_code=403, detail="owner only")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-for-consent")
    monkeypatch.setattr(auth, "OWNER_ID", OWNER)
    app = FastAPI()
    app.include_router(consent.build_router(str(tmp_path), _require_owner))
    return TestClient(app)


def bearer(wallet):
    return {"Authorization": "Bearer " + auth.issue_session(wallet=wallet, methods={"wallet": "eip191"})}


REQ = {"title": "Permission to feature QuVI", "recipient": "Dr. Murtaza Vefadar",
       "requester": "Ali", "work": "QuVI", "message": "Hello.\n\nSecond paragraph.",
       "terms": ["Credit as author.", "  ", "Withdraw any time."]}


def create(client):
    r = client.post("/api/consent", json=REQ, headers=bearer(OWNER))
    assert r.status_code == 200, r.text
    return r.json()


def test_only_owner_creates_and_lists(client):
    assert client.post("/api/consent", json=REQ).status_code == 403
    assert client.post("/api/consent", json=REQ, headers=bearer(OTHER)).status_code == 403
    assert client.get("/api/consent").status_code == 403
    assert client.get("/api/consent", headers=bearer(OTHER)).status_code == 403


def test_link_flow_and_record(client):
    made = create(client)
    token = made["token"]
    assert len(token) >= 40 and made["path"].endswith(token)

    view = client.get("/api/consent/r/" + token).json()
    assert view["recipient"] == "Dr. Murtaza Vefadar"
    assert view["terms"] == ["Credit as author.", "Withdraw any time."]   # blanks dropped
    assert view["answer"] is None
    assert "token" not in view and "id" not in view                       # nothing extra leaks

    a = client.post("/api/consent/r/" + token, json={"decision": "granted", "name": "Murtaza Vefadar", "note": "ok"})
    assert a.status_code == 200 and a.json()["decision"] == "granted" and len(a.json()["receipt"]) == 16

    # Changing one's mind appends; the latest answer counts and history is kept.
    client.post("/api/consent/r/" + token, json={"decision": "declined", "name": "Murtaza Vefadar"})
    rows = client.get("/api/consent", headers=bearer(OWNER)).json()["requests"]
    assert rows[0]["status"] == "declined"
    assert [x["decision"] for x in rows[0]["answers"]] == ["granted", "declined"]
    assert client.get("/api/consent/r/" + token).json()["answer"]["decision"] == "declined"


def test_bad_tokens_and_inputs(client):
    assert client.get("/api/consent/r/not-a-real-token").status_code == 404
    token = create(client)["token"]
    assert client.post("/api/consent/r/" + token, json={"decision": "maybe", "name": "X Y"}).status_code == 422
    assert client.post("/api/consent/r/" + token, json={"decision": "granted", "name": ""}).status_code == 422
    bad = dict(REQ, terms=["", " "])
    assert client.post("/api/consent", json=bad, headers=bearer(OWNER)).status_code == 400


def test_closed_requests_refuse_answers(client):
    made = create(client)
    assert client.post("/api/consent/%d/close" % made["id"]).status_code == 403
    assert client.post("/api/consent/%d/close" % made["id"], headers=bearer(OWNER)).status_code == 200
    assert client.get("/api/consent/r/" + made["token"]).json()["closed"] is True
    r = client.post("/api/consent/r/" + made["token"], json={"decision": "granted", "name": "Someone"})
    assert r.status_code == 409
