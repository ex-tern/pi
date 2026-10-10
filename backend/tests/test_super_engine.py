"""The Super Neural Engine: every engine answers, one failing never sinks the rest."""
import sqlite3

from fastapi import FastAPI
from fastapi.testclient import TestClient

import super_engine

ROWS = [
    {"eval_hash": "a", "title": "Graph neural networks for protein folding", "author": "A", "fields": '["Biology"]',
     "score": 7.5, "timestamp": "2026-10-01T00:00:00", "on_ledger": True, "piq": 1.0},
    {"eval_hash": "b", "title": "Tax policy and growth", "author": "B", "fields": '["Economics"]',
     "score": 6.0, "timestamp": "2026-10-02T00:00:00", "on_ledger": True, "piq": 0.5},
]


def make(tmp_path, answer=None, rows=None, pid=None, limited=None):
    db = tmp_path / "pien.db"
    with sqlite3.connect(db) as c:
        c.execute("CREATE TABLE opens (card TEXT PRIMARY KEY, n INTEGER NOT NULL)")
        c.executemany("INSERT INTO opens VALUES (?, ?)", [("tools:Assess Manuscripts", 9), ("library:Neuro Frenzy", 4)])
    import rib_suggest
    app = FastAPI()
    app.include_router(super_engine.build_router(
        answer=answer or (lambda p: {"response": "SciM says hello about " + p}),
        rows=rows or (lambda: ROWS), suggest=rib_suggest.suggest, hot=rib_suggest.hot_topics,
        pid_status=pid or (lambda: {"total_observations": 1200, "mean_abs_error": 0.1, "baseline_abs_error": 0.2}),
        pien_db=str(db), rate_limit=limited or (lambda r: None)))
    return TestClient(app)


def test_every_engine_answers(tmp_path):
    r = make(tmp_path).post("/api/super/ask", json={"prompt": "protein folding neural"})
    assert r.status_code == 200
    body = r.json()
    engines = [p["engine"] for p in body["parts"]]
    assert engines == ["siM", "riB", "piD", "PiEn"]
    assert "protein folding" in body["answer"]
    assert "Graph neural networks" in body["parts"][1]["text"]
    assert "beating its defaults" in body["parts"][2]["text"]


def test_pien_matches_prompt_words(tmp_path):
    body = make(tmp_path).post("/api/super/ask", json={"prompt": "neuro games"}).json()
    pien = [p for p in body["parts"] if p["engine"] == "PiEn"][0]["text"]
    assert "Neuro Frenzy" in pien


def test_a_failing_engine_is_left_out(tmp_path):
    def boom(_):
        raise RuntimeError("down")
    body = make(tmp_path, answer=boom).post("/api/super/ask", json={"prompt": "tax growth"}).json()
    engines = [p["engine"] for p in body["parts"]]
    assert "siM" not in engines and "riB" in engines


def test_empty_and_long_prompts_refused(tmp_path):
    c = make(tmp_path)
    assert c.post("/api/super/ask", json={"prompt": "   "}).status_code == 400
    assert c.post("/api/super/ask", json={"prompt": "x" * 4001}).status_code == 413


def test_rate_limit_applies(tmp_path):
    from fastapi import HTTPException

    def limited(_):
        raise HTTPException(status_code=429, detail="slow down")
    assert make(tmp_path, limited=limited).post("/api/super/ask", json={"prompt": "hi"}).status_code == 429


def test_engines_with_nothing_learned_say_so(tmp_path):
    body = make(tmp_path, rows=lambda: [], pid=lambda: {"total_observations": 0}).post(
        "/api/super/ask", json={"prompt": "anything"}).json()
    texts = {p["engine"]: p["text"] for p in body["parts"]}
    assert "no assessed papers" in texts["riB"]
    assert "no observations yet" in texts["piD"]
