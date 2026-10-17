"""The photos on this server, for Face Mace, behind a password (owner, 2026-10-17: "the passworded portal from face
mace to these photos"): nothing without the password, only photos and videos, never anything outside the folder."""
import os
import tempfile

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())

from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402


def _folder():
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "Album", "2019"))
    os.makedirs(os.path.join(d, "$RECYCLE.BIN"))
    for p in ("Album/2019/a b.jpg", "$RECYCLE.BIN/gone.jpg", "notes.txt", "clip.MP4"):
        with open(os.path.join(d, p), "w") as f:
            f.write("x")
    return d


def test_photos_portal(monkeypatch):
    monkeypatch.setenv("SERVER_PHOTOS_DIR", _folder())
    monkeypatch.setenv("PHOTOS_PASSWORD", "pw")
    c = TestClient(api.app)
    assert c.get("/api/photos/list").status_code == 401
    assert c.get("/photos").status_code == 200
    r = c.post("/photos", data={"password": "bad"}, follow_redirects=False)
    assert r.status_code == 303 and "wrong" in r.headers["location"]
    r = c.post("/photos", data={"password": "pw"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/facemace"
    names = sorted(p["name"] for p in c.get("/api/photos/list").json()["photos"])
    assert names == ["Album/2019/a b.jpg", "clip.MP4"]
    url = next(p["url"] for p in c.get("/api/photos/list").json()["photos"] if p["name"].endswith(".jpg"))
    assert c.get(url).status_code == 200
    assert c.get("/api/photos/file/..%2F..%2Fetc%2Fpasswd").status_code == 404
    assert c.get("/api/photos/file/notes.txt").status_code == 404
    assert 'data-library="/api/photos/list"' in c.get("/facemace").text


def test_no_folder_no_portal(monkeypatch):
    monkeypatch.delenv("SERVER_PHOTOS_DIR", raising=False)
    monkeypatch.delenv("PHOTOS_PASSWORD", raising=False)
    c = TestClient(api.app)
    assert c.get("/api/photos/list").status_code == 404
    assert "data-library" not in c.get("/facemace").text
