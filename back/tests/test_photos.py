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
    assert r.status_code == 303 and r.headers["location"] == "/photos/browse"
    assert c.get("/photos/browse").status_code == 200
    pg = c.get("/api/photos/page?limit=1").json()
    assert pg["total"] == 2 and len(pg["items"]) == 1 and pg["folders"][0]["path"] == "Album"
    assert c.get("/api/photos/page?folder=Album").json()["total"] == 1
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


def test_preview_is_small(monkeypatch):
    from PIL import Image
    d = tempfile.mkdtemp()
    Image.new("RGB", (2400, 1600), (200, 120, 40)).save(os.path.join(d, "big.jpg"), quality=90)
    monkeypatch.setenv("SERVER_PHOTOS_DIR", d)
    monkeypatch.setenv("PHOTOS_PASSWORD", "pw")
    c = TestClient(api.app)
    assert c.get("/api/photos/thumb/big.jpg").status_code == 401
    c.post("/photos", data={"password": "pw"})
    r = c.get("/api/photos/thumb/big.jpg")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    import io
    assert max(Image.open(io.BytesIO(r.content)).size) <= 360
    assert c.get("/api/photos/thumb/big.jpg").status_code == 200  # the second time, from the disk


def test_strong_password_hash_and_lockout(monkeypatch):
    d = tempfile.mkdtemp()
    open(os.path.join(d, "a.jpg"), "w").write("x")
    monkeypatch.setenv("SERVER_PHOTOS_DIR", d)
    monkeypatch.delenv("PHOTOS_PASSWORD", raising=False)
    h = api.photos_hash("correct horse battery staple", rounds=1000)
    assert h.startswith("pbkdf2_sha256$1000$") and "correct" not in h
    monkeypatch.setenv("PHOTOS_PASSWORD_HASH", h)
    monkeypatch.setattr(api, "PHOTOS_LOCK_TRIES", 3)
    real_sleep = api.asyncio.sleep
    monkeypatch.setattr(api.asyncio, "sleep", lambda s: real_sleep(0))
    api._PHOTOS_FAILS.clear()
    c = TestClient(api.app)
    assert "wrong" in c.post("/photos", data={"password": "nope"}, follow_redirects=False).headers["location"]
    r = c.post("/photos", data={"password": "correct horse battery staple"}, follow_redirects=False)
    assert r.headers["location"] == "/photos/browse"
    assert c.get("/api/photos/page").status_code == 200
    for _ in range(3):
        TestClient(api.app).post("/photos", data={"password": "nope"}, follow_redirects=False)
    assert TestClient(api.app).post("/photos", data={"password": "correct horse battery staple"},
                                    follow_redirects=False).status_code == 429
    api._PHOTOS_FAILS.clear()
