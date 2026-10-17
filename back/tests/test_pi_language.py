"""Super AI knows the π language (owner, 2026-10-17: "teach the superAI"): its reference is served, a question about
the language or a program asked for from the canvas gets an answer in it, and other questions are left alone."""
import os
import tempfile

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())

from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402

c = TestClient(api.app)


def test_reference_is_served_and_complete():
    r = c.get("/api/super/pi-language")
    assert r.status_code == 200
    t = r.json()["text"]
    for w in ("reg 0", "if", "range", "sum", "√", "random", "```pi", "Turing complete"):
        assert w in t


def test_detects_questions_about_the_language():
    assert api.pi_asked("How do I loop in the π language?")
    assert api.pi_asked("write a pi program that counts")
    assert not api.pi_asked("What is the capital of France?")


def test_local_engine_writes_programs():
    t = api.pi_local("a program for the sum of 1 to 10")
    assert "```pi" in t and "range" in t and "sum" in t and "b: 11" in t
    t = api.pi_local("count to 5")
    assert "reg 0" in t and "stop" in t
    assert api.pi_local("what is the π language?") == api.PI_LANGUAGE


def test_canvas_program_request_answered_in_pi():
    r = c.post("/api/super/one", json={"engine": "sim", "prompt": "make a program: sum of 1 to 4", "pi": True})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] and "```pi" in j["text"]


def test_outside_models_are_taught_the_language():
    p = api.pi_prompt("write a π program")
    assert api.PI_LANGUAGE in p and "QUESTION" in p and '"answer"' in p
