"""Recent assessments: public, but never identifying."""

import sqlite3

from fastapi import FastAPI
from fastapi.testclient import TestClient

import recent


def make(tmp_path):
    path = tmp_path / "t.db"
    c = sqlite3.connect(path)
    c.execute("""CREATE TABLE papers_assessment (eval_hash TEXT PRIMARY KEY, user_id TEXT, title TEXT, filename TEXT,
                 fields TEXT, author_name TEXT, final_score REAL, timestamp DATETIME)""")
    rows = [
        ("h1", "Anonymous", "Secret unpublished title", "draft.pdf", '["Neuroscience", "Biology"]', "Dr X", 71.234, "2026-10-09 08:15:00"),
        ("h2", "0000-0002-1825-0097", "Another title", "b.pdf", "[]", "Dr Y", 55.0, "2026-10-08 10:00:00"),
        ("h3", "0xabc", "Third", "c.pdf", "Physics, Maths", "Dr Z", 80.0, "2026-10-07 09:00:00"),
        ("h4", "Anonymous", "Unscored", "d.pdf", "[]", "", None, "2026-10-09 09:00:00"),
    ]
    c.executemany("INSERT INTO papers_assessment VALUES (?,?,?,?,?,?,?,?)", rows)
    c.commit(); c.close()
    app = FastAPI()
    app.include_router(recent.build_router(lambda: sqlite3.connect(path)))
    return TestClient(app)


def test_lists_newest_first_without_identifying_anything(tmp_path):
    d = make(tmp_path).get("/api/assessments/recent").json()
    assert d["total"] == 3
    assert [e["field"] for e in d["entries"]] == ["Neuroscience", "Unassigned", "Physics"]
    first = d["entries"][0]
    assert first == {"field": "Neuroscience", "score": 71.2, "date": "2026-10-09", "signed_in": False}
    assert d["entries"][1]["signed_in"] is True
    text = str(d)
    for secret in ("Secret", "draft.pdf", "Dr X", "h1", "0000-0002", "0xabc", "08:15"):
        assert secret not in text


def test_limit_is_bounded(tmp_path):
    c = make(tmp_path)
    assert len(c.get("/api/assessments/recent?limit=1").json()["entries"]) == 1
    assert c.get("/api/assessments/recent?limit=500").status_code == 422
