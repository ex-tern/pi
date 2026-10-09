"""PiEn's shared model: anonymous counts, bounded, shape-checked, rate-limited."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import pien


@pytest.fixture
def client(tmp_path):
    app = FastAPI()
    app.include_router(pien.build_router(str(tmp_path)))
    return TestClient(app)


def test_learns_and_reports(client):
    assert client.get("/api/pien/model").json() == {"opens": {}, "next": {}, "interactions": 0}
    r = client.post("/api/pien/learn", json={"opens": [["lab:HAL-OS", 2], ["assess:Assess a Manuscript", 1]],
                                             "steps": [["lab:HAL-OS", "assess:Assess a Manuscript", 1]]})
    assert r.status_code == 200
    client.post("/api/pien/learn", json={"opens": [["lab:HAL-OS", 1]], "steps": [["lab:HAL-OS", "assess:Assess a Manuscript", 2]]})
    m = client.get("/api/pien/model").json()
    assert m["opens"]["lab:HAL-OS"] == 3 and m["interactions"] == 4
    assert m["next"]["lab:HAL-OS"]["assess:Assess a Manuscript"] == 3


def test_rejects_anything_but_cards(client):
    for body in ({"opens": [["not a card", 1]]}, {"opens": [["lab:x", 11]]}, {"opens": [["lab:x", 0]]},
                 {"steps": [["lab:x", "lab:x", 1]]}, {"steps": [["lab:x\nevil", "lab:y", 1]]},
                 {"opens": [["sp_token:abc" * 20, 1]]}):
        assert client.post("/api/pien/learn", json=body).status_code == 422, body
    assert client.post("/api/pien/learn", json={"opens": [["lab:x", 1]] * 41}).status_code == 413


def test_rate_limited_per_address(client):
    for _ in range(pien.PER_HOUR):
        assert client.post("/api/pien/learn", json={"opens": [["lab:x", 1]]}).status_code == 200
    assert client.post("/api/pien/learn", json={"opens": [["lab:x", 1]]}).status_code == 429
    # another address is unaffected
    assert client.post("/api/pien/learn", json={"opens": [["lab:x", 1]]}, headers={"x-forwarded-for": "10.0.0.9"}).status_code == 200


def test_model_keeps_top_next_only(client):
    steps = [["lab:a", f"lab:b{i}", 1 + i % 3] for i in range(10)]
    client.post("/api/pien/learn", json={"steps": steps})
    assert len(client.get("/api/pien/model").json()["next"]["lab:a"]) == pien.TOP_NEXT
