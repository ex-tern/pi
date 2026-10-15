"""Face Mace Server: sign-up and approval, private photos with a quota, VPN devices and who may use it for the
internet. Runs with the VPN off (FMS_WG=off): the records are checked, the system is not touched."""
import importlib
import os
import sys

import pytest
from fastapi.testclient import TestClient

H = {"x-fms": "1"}


@pytest.fixture
def srv(tmp_path, monkeypatch):
    monkeypatch.setenv("FMS_DATA", str(tmp_path))
    monkeypatch.setenv("FMS_WG", "off")
    monkeypatch.setenv("FMS_WG_ENDPOINT", "photos.example.org:51820")
    monkeypatch.setenv("FMS_QUOTA_GB", "0.000002")       # 2 kB, to see the quota work
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "facemace-server"))
    import fmserver
    fmserver = importlib.reload(fmserver)
    fmserver.init_db()
    fmserver._hits.clear()
    return fmserver


def client(m):
    return TestClient(m.app)


def signin(c, name, pw):
    r = c.post("/api/fms/login", json={"name": name, "password": pw}, headers=H)
    assert r.status_code == 200, r.text


def test_signup_needs_approval_and_header(srv):
    owner = client(srv)
    srv.make_user("owner", "owner-password-1", "active", admin=True)
    assert owner.post("/api/fms/signup", json={"name": "ann", "password": "ann-password-1"}).status_code == 403  # no X-FMS
    r = owner.post("/api/fms/signup", json={"name": "ann", "password": "ann-password-1"}, headers=H)
    assert r.json()["status"] == "pending"
    assert owner.post("/api/fms/signup", json={"name": "ann", "password": "ann-password-1"}, headers=H).status_code == 409
    assert owner.post("/api/fms/signup", json={"name": "x", "password": "ann-password-1"}, headers=H).status_code == 400
    assert owner.post("/api/fms/signup", json={"name": "bob", "password": "short"}, headers=H).status_code == 400

    ann = client(srv)
    signin(ann, "ann", "ann-password-1")
    assert ann.get("/api/fms/me").json()["status"] == "pending"
    assert ann.get("/api/fms/photos").status_code == 403          # waiting for approval
    assert ann.get("/api/fms/admin/users").status_code == 403
    assert client(srv).post("/api/fms/login", json={"name": "ann", "password": "wrong-password"}, headers=H).status_code == 401

    signin(owner, "owner", "owner-password-1")
    users = owner.get("/api/fms/admin/users").json()["users"]
    aid = next(u["id"] for u in users if u["name"] == "ann")
    assert owner.post(f"/api/fms/admin/users/{aid}", json={"status": "active"}, headers=H).json()["ok"]
    assert ann.get("/api/fms/photos").json() == {"photos": []}
    # open sign-up: active at once
    owner.post("/api/fms/admin/settings", json={"open_signup": True}, headers=H)
    assert owner.post("/api/fms/signup", json={"name": "cat", "password": "cat-password-1"}, headers=H).json()["status"] == "active"


def test_photos_are_private_and_within_quota(srv):
    srv.make_user("ann", "ann-password-1", "active")
    srv.make_user("bob", "bob-password-1", "active")
    ann, bob = client(srv), client(srv)
    signin(ann, "ann", "ann-password-1")
    signin(bob, "bob", "bob-password-1")
    files = [("files", ("Holiday/a.jpg", b"x" * 1200, "image/jpeg")), ("files", ("notes.txt", b"hello", "text/plain")),
             ("files", ("Holiday/b.jpg", b"y" * 1200, "image/jpeg"))]
    r = ann.post("/api/fms/photos", files=files, data={"mtimes": "1000,2000,3000"}, headers=H).json()
    assert [a["name"] for a in r["added"]] == ["Holiday/a.jpg"]
    assert {s["name"]: s["why"] for s in r["skipped"]} == {"notes.txt": "not a photo or video", "Holiday/b.jpg": "over your quota"}
    lst = ann.get("/api/fms/photos").json()["photos"]
    assert len(lst) == 1 and lst[0]["mtime"] == 1000 and lst[0]["size"] == 1200
    pid = lst[0]["id"]
    got = ann.get(f"/api/fms/photos/{pid}")
    assert got.status_code == 200 and got.content == b"x" * 1200
    part = ann.get(f"/api/fms/photos/{pid}", headers={"Range": "bytes=10-19"})
    assert part.status_code == 206 and part.content == b"x" * 10      # Face Mace reads dates from a file's start
    assert bob.get(f"/api/fms/photos/{pid}").status_code == 404        # not Bob's
    assert bob.delete(f"/api/fms/photos/{pid}", headers=H).status_code == 404
    assert ann.post(f"/api/fms/photos/{pid}/aside", headers=H).json()["ok"]
    assert ann.get("/api/fms/photos").json()["photos"] == []
    assert len(ann.get("/api/fms/photos?aside=1").json()["photos"]) == 1
    assert ann.delete(f"/api/fms/photos/{pid}", headers=H).json()["ok"]
    assert ann.get(f"/api/fms/photos/{pid}").status_code == 404


def test_vpn_devices_and_the_whole_internet(srv):
    srv.make_user("ann", "ann-password-1", "active")
    oid = srv.make_user("owner", "owner-password-1", "active", admin=True)
    ann, owner = client(srv), client(srv)
    signin(ann, "ann", "ann-password-1")
    signin(owner, "owner", "owner-password-1")
    assert ann.post("/api/fms/vpn", json={"name": "Phone", "tunnel": "full"}, headers=H).status_code == 403
    d = ann.post("/api/fms/vpn", json={"name": "Phone", "tunnel": "server"}, headers=H).json()
    assert d["tunnel"] == "server" and "AllowedIPs = 10.66.0.0/16" in d["conf"] and "Endpoint = photos.example.org:51820" in d["conf"]
    assert "DNS" not in d["conf"] and d["qr_svg"].startswith("<svg") and d["ip"] == "10.66.0.2"
    assert "PrivateKey = " in d["conf"]
    import sqlite3
    with srv.db() as c:
        cols = [r[1] for r in c.execute("PRAGMA table_info(devices)")]
    assert "private" not in " ".join(cols)                          # the private key is not kept
    aid = next(u["id"] for u in owner.get("/api/fms/admin/users").json()["users"] if u["name"] == "ann")
    owner.post(f"/api/fms/admin/users/{aid}", json={"full_tunnel": True}, headers=H)
    f = ann.post("/api/fms/vpn", json={"name": "Laptop", "tunnel": "full"}, headers=H).json()
    assert "AllowedIPs = 0.0.0.0/0, ::/0" in f["conf"] and "DNS = " in f["conf"] and f["ip"] == "10.66.0.3"
    devs = ann.get("/api/fms/vpn").json()["devices"]
    assert [x["name"] for x in devs] == ["Phone", "Laptop"]
    assert ann.delete(f"/api/fms/vpn/{devs[0]['id']}", headers=H).json()["ok"]
    assert [x["name"] for x in ann.get("/api/fms/vpn").json()["devices"]] == ["Laptop"]
    # the owner cannot lock themselves out
    assert owner.post(f"/api/fms/admin/users/{oid}", json={"status": "disabled"}, headers=H).status_code == 400


def test_passwords_are_hashed(srv):
    srv.make_user("ann", "ann-password-1", "active")
    with srv.db() as c:
        pw = c.execute("SELECT pw FROM users").fetchone()[0]
    assert pw.startswith("scrypt$") and "ann-password-1" not in pw
    assert srv.pw_ok("ann-password-1", pw) and not srv.pw_ok("nope", pw)
