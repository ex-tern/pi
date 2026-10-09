"""The Lab's private projects: owner-only, path-safe, type-restricted.

These exercise lab.py with the real session machinery from auth.py: a token
is minted the same way the wallet-signature login mints one, and ownership is
decided by auth.is_owner(), not by anything the test stubs out.
"""

import os

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

import auth
import lab

OWNER = "0x00000000000000000000000000000000000000aa"
OTHER = "0x00000000000000000000000000000000000000bb"


def _require_owner(request: Request, wallet: str = ""):
    # Same decision as api.require_owner, without importing the whole app.
    identity = auth.identity_from_request(request, wallet)
    if auth.is_owner(identity):
        return identity
    raise HTTPException(status_code=403, detail="owner only")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-for-lab")
    monkeypatch.setattr(auth, "OWNER_ID", OWNER)
    monkeypatch.delenv("PRIVATE_PROJECTS_DIR", raising=False)
    app = FastAPI()
    app.include_router(lab.build_router(str(tmp_path), _require_owner))
    c = TestClient(app)
    c.root = os.path.join(str(tmp_path), "private_projects")
    return c


def bearer(wallet):
    return {"Authorization": "Bearer " + auth.issue_session(wallet=wallet, methods={"wallet": "eip191"})}


def put(client, project, name, data, headers):
    return client.put("/api/lab/private/%s/%s" % (project, name),
                      files={"file": (name, data)}, headers=headers)


def test_anonymous_and_non_owner_are_refused(client):
    assert client.get("/api/lab/private").status_code == 403
    assert client.get("/api/lab/private", headers=bearer(OTHER)).status_code == 403
    # Claiming the owner's (public) address without a signed session is not enough.
    assert client.get("/api/lab/private?wallet=" + OWNER).status_code == 403
    assert put(client, "graduation-plan", "a.md", b"x", bearer(OTHER)).status_code == 403
    assert not os.path.exists(client.root)


def test_owner_round_trip(client):
    h = bearer(OWNER)
    assert put(client, "graduation-plan", "libretto.csv", b"Code,Activity\nX,Y\n", h).status_code == 200
    assert put(client, "graduation-plan", "Road-to-Graduation.html", b"<h1>plan</h1>", h).status_code == 200

    listing = client.get("/api/lab/private", headers=h)
    assert listing.status_code == 200
    assert listing.headers["cache-control"].startswith("no-store")
    projects = listing.json()["projects"]
    assert [p["id"] for p in projects] == ["graduation-plan"]
    assert sorted(f["name"] for f in projects[0]["files"]) == ["Road-to-Graduation.html", "libretto.csv"]

    r = client.get("/api/lab/private/graduation-plan/Road-to-Graduation.html", headers=h)
    assert r.status_code == 200 and r.content == b"<h1>plan</h1>"
    # HTML is handed over as text, never rendered as a page of this origin.
    assert r.headers["content-type"].startswith("text/plain")
    assert r.headers["x-content-type-options"] == "nosniff"

    # Another wallet still cannot read what the owner stored.
    assert client.get("/api/lab/private/graduation-plan/libretto.csv", headers=bearer(OTHER)).status_code == 403

    assert client.delete("/api/lab/private/graduation-plan/libretto.csv", headers=h).status_code == 200
    assert client.get("/api/lab/private/graduation-plan/libretto.csv", headers=h).status_code == 404


@pytest.mark.parametrize("project,name", [
    ("graduation-plan", "..%2F..%2Fetc.md"),
    ("..", "x.md"),
    ("Graduation Plan", "x.md"),
    ("graduation-plan", ".hidden.md"),
    ("graduation-plan", "run.sh"),
    ("graduation-plan", "page.svg"),
])
def test_bad_names_and_types_are_refused(client, project, name):
    r = put(client, project, name, b"x", bearer(OWNER))
    assert r.status_code in (400, 404, 405, 415), r.status_code
    assert not os.path.exists(os.path.join(client.root, "..", "etc.md"))


def test_size_limit(client, monkeypatch):
    monkeypatch.setattr(lab, "MAX_FILE_BYTES", 10)
    assert put(client, "p", "big.txt", b"x" * 11, bearer(OWNER)).status_code == 413


def test_quvi_flag_defaults_to_private(monkeypatch):
    app = FastAPI()
    app.include_router(lab.build_features_router())
    c = TestClient(app)
    monkeypatch.delenv("QUVI_PUBLIC", raising=False)
    assert c.get("/api/lab/features").json() == {"quvi_public": False}
    monkeypatch.setenv("QUVI_PUBLIC", "1")
    assert c.get("/api/lab/features").json() == {"quvi_public": True}
    monkeypatch.setenv("QUVI_PUBLIC", "no")
    assert c.get("/api/lab/features").json() == {"quvi_public": False}
