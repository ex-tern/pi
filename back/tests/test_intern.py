"""Intern on the web: doctors find each other, message, set up calls; a case for a differential leaves de-identified."""
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

import api


def make(tmp_path, allowed=True, clock=None):
    asked = []

    def who(request: Request) -> str:
        k = request.headers.get("x-test-who", "")
        if not k:
            raise HTTPException(status_code=401, detail="Sign in")
        return k

    def panel(q):
        asked.append(q)
        return {"jurors": [{"key": "a", "label": "A", "ok": True, "answer": "Pneumonia"}], "judge": {"verdict": "Pneumonia most likely"},
                "answered": 1, "asked": 1}

    app = FastAPI()
    app.include_router(api.intern_build_router(str(tmp_path / "intern.db"), who, lambda r: None, panel,
                                               allowed=lambda r: allowed, now=clock or __import__("time").time))
    return TestClient(app), asked


def as_(key):
    return {"x-test-who": key}


def test_doctors_find_each_other_and_message(tmp_path):
    c, _ = make(tmp_path)
    assert c.get("/api/intern/me").status_code == 401
    assert c.get("/api/intern/me", headers=as_("orcid:a")).json()["doctor"] is None
    # no profile, no messages
    assert c.post("/api/intern/messages", json={"to": "orcid:b", "text": "hi"}, headers=as_("orcid:a")).status_code == 403
    assert c.put("/api/intern/me", json={"name": "A"}, headers=as_("orcid:a")).status_code == 400
    c.put("/api/intern/me", json={"name": "Dr Ada", "specialty": "Cardiology", "place": "Rome"}, headers=as_("orcid:a"))
    c.put("/api/intern/me", json={"name": "Dr Bea", "specialty": "Neurology", "place": "Milan"}, headers=as_("orcid:b"))
    c.put("/api/intern/me", json={"name": "Dr Hidden", "listed": False}, headers=as_("orcid:h"))
    found = c.get("/api/intern/doctors", params={"q": "neuro"}, headers=as_("orcid:a")).json()["doctors"]
    assert [d["name"] for d in found] == ["Dr Bea"] and found[0]["online"]
    all_ = c.get("/api/intern/doctors", headers=as_("orcid:a")).json()["doctors"]
    assert {d["name"] for d in all_} == {"Dr Bea"}, "neither yourself nor the unlisted"
    assert c.post("/api/intern/messages", json={"to": "orcid:b", "text": "  Can you see a patient?  "}, headers=as_("orcid:a")).status_code == 200
    assert c.post("/api/intern/messages", json={"to": "orcid:nobody", "text": "x"}, headers=as_("orcid:a")).status_code == 404
    assert c.post("/api/intern/messages", json={"to": "orcid:b", "text": "   "}, headers=as_("orcid:a")).status_code == 400
    c.post("/api/intern/messages", json={"to": "orcid:a", "text": "Yes, tomorrow."}, headers=as_("orcid:b"))
    msgs = c.get("/api/intern/messages", params={"peer": "orcid:b"}, headers=as_("orcid:a")).json()["messages"]
    assert [(m["mine"], m["text"]) for m in msgs] == [(True, "Can you see a patient?"), (False, "Yes, tomorrow.")]
    newer = c.get("/api/intern/messages", params={"peer": "orcid:b", "after": msgs[0]["id"]}, headers=as_("orcid:a")).json()["messages"]
    assert len(newer) == 1
    conv = c.get("/api/intern/conversations", headers=as_("orcid:b")).json()["conversations"]
    assert conv[0]["key"] == "orcid:a" and conv[0]["name"] == "Dr Ada" and conv[0]["mine"]
    # a third doctor cannot read the two's messages
    assert c.get("/api/intern/messages", params={"peer": "orcid:b"}, headers=as_("orcid:h")).json()["messages"] == []
    # leaving takes the profile and the messages away
    c.delete("/api/intern/me", headers=as_("orcid:a"))
    assert c.get("/api/intern/conversations", headers=as_("orcid:b")).json()["conversations"] == []


def test_call_signals_reach_only_the_callee_and_expire(tmp_path):
    t = [1000.0]
    c, _ = make(tmp_path, clock=lambda: t[0])
    for k, n in (("orcid:a", "Dr Ada"), ("orcid:b", "Dr Bea")):
        c.put("/api/intern/me", json={"name": n}, headers=as_(k))
    assert c.post("/api/intern/signal", json={"to": "orcid:b", "kind": "boom", "data": ""}, headers=as_("orcid:a")).status_code == 400
    c.post("/api/intern/signal", json={"to": "orcid:b", "kind": "offer", "data": "{sdp}"}, headers=as_("orcid:a"))
    got = c.get("/api/intern/signals", headers=as_("orcid:b")).json()
    assert [(s["from"], s["kind"], s["name"]) for s in got["signals"]] == [("orcid:a", "offer", "Dr Ada")]
    assert c.get("/api/intern/signals", headers=as_("orcid:a")).json()["signals"] == []
    assert c.get("/api/intern/signals", params={"after": got["last"]}, headers=as_("orcid:b")).json()["signals"] == []
    c.post("/api/intern/signal", json={"to": "orcid:b", "kind": "ice", "data": "x"}, headers=as_("orcid:a"))
    t[0] += api.INTERN_SIGNAL_TTL + 1
    assert c.get("/api/intern/signals", headers=as_("orcid:b")).json()["signals"] == [], "stale signals are not delivered"


def test_a_case_leaves_deidentified_and_only_with_consent(tmp_path):
    c, asked = make(tmp_path)
    case = ("54-year-old, seen 03/10/2026, record MRN 4481923, phone +39 333 123 4567, mail jo@ex.com: fever, cough "
            "and right basal crackles for three days.")
    assert c.post("/api/intern/diagnose", json={"case": case}).status_code == 400
    r = c.post("/api/intern/diagnose", json={"case": case, "consent": True}).json()
    for leak in ("03/10/2026", "4481923", "333 123 4567", "jo@ex.com"):
        assert leak not in r["sent"] and leak not in asked[0]
    assert "fever, cough" in r["sent"] and "[date]" in r["sent"] and "[email]" in r["sent"]
    assert "Pneumonia" in r["text"] and "not a diagnosis" in asked[0]
    assert c.post("/api/intern/diagnose", json={"case": "short", "consent": True}).status_code == 400
    blocked, _ = make(tmp_path, allowed=False)
    assert blocked.post("/api/intern/diagnose", json={"case": case, "consent": True}).status_code == 403
