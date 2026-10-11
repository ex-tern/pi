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


JURORS = [{"key": "llama", "label": "Llama"}, {"key": "mistral", "label": "Mistral"}, {"key": "qwen", "label": "Qwen"}]


def test_panel_asks_every_juror_then_the_judge():
    asked = []

    def ask(j, q):
        asked.append(j)
        assert "QUESTION" in q
        return {"answer": f"{j} thinks yes", "confidence": 70, "model": j + "-m"}

    def judge(q):
        assert "Llama" in q and "Qwen" in q
        return {"verdict": "They agree: yes.", "agreement": "high", "model": "judge-m"}
    res = super_engine.run_panel("is it so?", "", JURORS, ask, judge)
    assert sorted(asked) == ["llama", "mistral", "qwen"]
    assert res["answered"] == 3 and res["judge"]["agreement"] == "high"
    text = super_engine.panel_text(res)
    assert text.startswith("Panel: 3 of 3 answered, agreement high") and "Judge: They agree: yes." in text


def test_panel_survives_failing_and_slow_jurors():
    import time

    def ask(j, q):
        if j == "llama":
            raise RuntimeError("boom")
        if j == "mistral":
            time.sleep(3)
        return {"answer": "fine", "confidence": 50}
    res = super_engine.run_panel("q", "", JURORS, ask, lambda q: {"verdict": "v", "agreement": "low"}, budget=1.0)
    ok = {j["key"]: j["ok"] for j in res["jurors"]}
    assert ok == {"llama": False, "mistral": False, "qwen": True}
    assert res["answered"] == 1 and "Only one panel member" in res["judge"]["verdict"]


def test_panel_with_nobody_reachable_says_so():
    res = super_engine.run_panel("q", "", JURORS, lambda j, q: {"failed": "down"}, lambda q: {})
    assert super_engine.panel_text(res) == "Panel: no model in the panel could be reached right now."


def test_panel_endpoint_unconfigured_is_503(tmp_path):
    assert make(tmp_path).post("/api/super/panel", json={"prompt": "hi"}).status_code == 503


def test_panel_says_when_the_judge_is_missing():
    res = super_engine.run_panel("q", "", JURORS, lambda j, q: {"answer": "a", "confidence": 1}, lambda q: {"failed": "down"})
    assert "Judge: could not be reached" in super_engine.panel_text(res)


# ---- the super prompt box: one engine at a time -------------------------------------
def make_box(tmp_path, ask=None, judge=None, ready=None):
    db = tmp_path / "pien.db"
    with sqlite3.connect(db) as c:
        c.execute("CREATE TABLE IF NOT EXISTS opens (card TEXT PRIMARY KEY, n INTEGER NOT NULL)")
        c.execute("INSERT OR IGNORE INTO opens VALUES ('tools:Assess Manuscripts', 9)")
    import rib_suggest
    hits = []
    app = FastAPI()
    app.include_router(super_engine.build_router(
        answer=lambda p: {"response": "SciM on " + p, "source": "knowledge-base"},
        rows=lambda: ROWS, suggest=rib_suggest.suggest, hot=rib_suggest.hot_topics,
        pid_status=lambda: {"total_observations": 10}, pien_db=str(db), rate_limit=lambda r: None,
        jurors=[{"key": "llama", "label": "Llama"}, {"key": "qwen", "label": "Qwen"}],
        ask_juror=ask or (lambda j, q: {"answer": j + " answers", "confidence": 70, "model": j + "-m"}),
        judge=judge or (lambda q: {"verdict": "They agree.", "agreement": "high", "model": "judge-m"}),
        juror_ready=ready or (lambda j: True),
        one_rate_limit=lambda r, e: hits.append(e)))
    return TestClient(app), hits


def test_engines_list_project_and_outside(tmp_path):
    c, _ = make_box(tmp_path, ready=lambda j: j == "llama")
    body = c.get("/api/super/engines").json()
    ids = {e["id"]: e for e in body["engines"]}
    assert [e["id"] for e in body["engines"]][:4] == ["sim", "rib", "pid", "pien"]
    assert ids["llama"]["ready"] and not ids["qwen"]["ready"] and ids["qwen"]["kind"] == "outside"
    assert body["judge"] is True


def test_one_asks_each_engine_on_its_own(tmp_path):
    c, hits = make_box(tmp_path)
    r = c.post("/api/super/one", json={"engine": "sim", "prompt": "what is piX"}).json()
    assert r["ok"] and r["text"] == "SciM on what is piX" and "ms" in r
    r = c.post("/api/super/one", json={"engine": "rib", "prompt": "protein folding"}).json()
    assert r["ok"] and "protein" in r["text"].lower()
    r = c.post("/api/super/one", json={"engine": "llama", "prompt": "hello"}).json()
    assert r == {**r, "ok": True, "text": "llama answers", "model": "llama-m", "confidence": 70}
    assert hits == ["sim", "rib", "llama"]          # one rate-limit bucket per engine


def test_one_refuses_unknown_empty_and_unconfigured(tmp_path):
    c, _ = make_box(tmp_path, ready=lambda j: False)
    assert c.post("/api/super/one", json={"engine": "nope", "prompt": "x"}).status_code == 404
    assert c.post("/api/super/one", json={"engine": "sim", "prompt": "  "}).status_code == 400
    assert c.post("/api/super/one", json={"engine": "sim", "prompt": "x" * 4001}).status_code == 413
    r = c.post("/api/super/one", json={"engine": "qwen", "prompt": "x"}).json()
    assert r["ok"] is False and "key" in r["text"]


def test_one_survives_a_failing_juror(tmp_path):
    def ask(j, q):
        raise RuntimeError("boom")
    c, _ = make_box(tmp_path, ask=ask)
    r = c.post("/api/super/one", json={"engine": "llama", "prompt": "x"}).json()
    assert r["ok"] is False and r["text"]
    c2, _ = make_box(tmp_path, ask=lambda j, q: {"failed": "rate-limited"})
    assert c2.post("/api/super/one", json={"engine": "qwen", "prompt": "x"}).json()["text"] == "rate-limited"


def test_weigh_needs_two_answers_then_asks_the_judge(tmp_path):
    seen = []
    c, _ = make_box(tmp_path, judge=lambda q: seen.append(q) or {"verdict": "Mostly yes.", "agreement": "moderate"})
    one = c.post("/api/super/weigh", json={"prompt": "q", "answers": [{"label": "Llama", "answer": "yes"}]}).json()
    assert one["ok"] is False and not seen
    r = c.post("/api/super/weigh", json={"prompt": "q", "answers": [{"label": "Llama", "answer": "yes"},
                                                                     {"label": "Qwen", "answer": "mostly"}]}).json()
    assert r["ok"] and r["text"] == "Mostly yes." and r["agreement"] == "moderate"
    assert "Llama" in seen[0] and "Qwen" in seen[0]
