"""The Live panel feed: auto-assessed papers named, people's uploads not."""

import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import live


@pytest.fixture
def client(tmp_path):
    db = str(tmp_path / "t.db")
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE papers_assessment (eval_hash TEXT, title TEXT, fields TEXT, final_score REAL, timestamp TEXT, user_id TEXT)")
    c.executemany("INSERT INTO papers_assessment VALUES (?,?,?,?,datetime('now', ?),?)", [
        ("h1", "Open paper found while idle", '["Neuroscience"]', 61.25, "-1 minutes", "ScholarPi (idle)"),
        ("h2", "Someone's unpublished draft", '["Medicine"]', 40.0, "-2 minutes", "0xabc"),
        ("h3", "Anonymous upload", '["Physics"]', 50.0, "-3 minutes", "Anonymous"),
        ("h4", "Old", '["Physics"]', 20.0, "-3 days", "0xdef"),
    ])
    c.commit(); c.close()
    app = FastAPI()
    app.include_router(live.build_router(lambda: sqlite3.connect(db),
                                         lambda: {"enabled": True, "assessed_today": 1}))
    return TestClient(app)


def test_feed(client):
    d = client.get("/api/live").json()
    assert d["total"] == 4 and d["today"] == 3
    assert d["idle"]["enabled"] is True
    auto, user, anon = d["latest"][:3]
    assert set(auto) == {"auto", "title", "field", "score", "at", "eval_hash"} and auto["field"] == "Neuroscience"
    assert auto["auto"] and auto["title"] == "Open paper found while idle"
    # a person's upload: never its title or hash
    assert user == {"auto": False, "field": "Medicine", "score": 40.0, "date": user["date"], "signed_in": True}
    assert "title" not in user and "eval_hash" not in user
    assert anon["signed_in"] is False
