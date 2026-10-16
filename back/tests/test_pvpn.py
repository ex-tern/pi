"""piii VPN (back/vpn-server): joining (approval, invite codes, open), devices and their configurations, the plans
(monthly data, devices, an end date) cutting devices off and letting them back, usage counted from WireGuard's
counters, the owner's controls, and piii.app as a client (a bearer token, CORS for piii.app only). Runs with the VPN
off (PVPN_WG=off): WireGuard is stood in for, the system is not touched."""
import importlib
import os
import sys
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pvpn": "1"}
SITE = "https://www.piii.app"


@pytest.fixture
def srv(tmp_path, monkeypatch):
    monkeypatch.setenv("PVPN_DATA", str(tmp_path))
    monkeypatch.setenv("PVPN_WG", "off")
    monkeypatch.setenv("PVPN_TICK", "0")
    monkeypatch.setenv("PVPN_WG_ENDPOINT", "vpn.example.org:51820")
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "vpn-server"))
    import pvpn
    pvpn = importlib.reload(pvpn)
    pvpn.init_db()
    pvpn._hits.clear()
    pvpn._fake_peers.clear()
    return pvpn


def client(m):
    return TestClient(m.app)


def signin(c, name, pw):
    r = c.post("/api/pvpn/login", json={"name": name, "password": pw}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def owner(m):
    m.make_user("owner", "owner-password-1", "active", admin=True)
    c = client(m)
    signin(c, "owner", "owner-password-1")
    return c


def uid(o, name):
    return next(u["id"] for u in o.get("/api/pvpn/admin/overview").json()["users"] if u["name"] == name)


def test_joining_approval_invite_and_open(srv):
    o = owner(srv)
    anon = client(srv)
    assert anon.post("/api/pvpn/signup", json={"name": "ann", "password": "ann-password-1"}).status_code == 403  # no X-PVPN
    assert anon.post("/api/pvpn/signup", json={"name": "ann", "password": "ann-password-1"}, headers=H).json()["status"] == "pending"
    assert anon.post("/api/pvpn/signup", json={"name": "ann", "password": "ann-password-1"}, headers=H).status_code == 409
    assert anon.post("/api/pvpn/signup", json={"name": "x", "password": "ann-password-1"}, headers=H).status_code == 400
    ann = client(srv)
    signin(ann, "ann", "ann-password-1")
    assert ann.get("/api/pvpn/devices").status_code == 403           # waiting for approval
    assert ann.get("/api/pvpn/admin/overview").status_code == 403
    o.post(f"/api/pvpn/admin/users/{uid(o, 'ann')}", json={"status": "active"}, headers=H)
    me = ann.get("/api/pvpn/me").json()
    assert me["status"] == "active" and me["allowance"] == 100 * srv.GB and me["max_devices"] == 5 and not me["blocked"]

    # an invite: in at once, with its plan; used up after its uses
    code = o.post("/api/pvpn/admin/invites", json={"uses": 1, "allowance_gb": 7, "max_devices": 2, "days": 30}, headers=H).json()["code"]
    r = anon.post("/api/pvpn/signup", json={"name": "bob", "password": "bob-password-1", "invite": code.lower()}, headers=H)
    assert r.json()["status"] == "active"
    bob = [u for u in o.get("/api/pvpn/admin/overview").json()["users"] if u["name"] == "bob"][0]
    assert bob["allowance"] == 7 * srv.GB and bob["max_devices"] == 2 and 29 * 86400 < bob["until"] - time.time() <= 30 * 86400
    assert anon.post("/api/pvpn/signup", json={"name": "cat", "password": "cat-password-1", "invite": code}, headers=H).status_code == 400

    # invite only: no code, no account; open: active at once
    srv._hits.clear()                                                   # (five sign-ups an hour from one address)
    o.post("/api/pvpn/admin/settings", json={"signup": "invite"}, headers=H)
    assert anon.post("/api/pvpn/signup", json={"name": "dan", "password": "dan-password-1"}, headers=H).status_code == 403
    o.post("/api/pvpn/admin/settings", json={"signup": "open", "default_gb": 0}, headers=H)
    assert anon.post("/api/pvpn/signup", json={"name": "eve", "password": "eve-password-1"}, headers=H).json()["status"] == "active"
    assert o.post("/api/pvpn/admin/settings", json={"signup": "maybe"}, headers=H).status_code == 400


def test_devices_configuration_and_limit(srv):
    o = owner(srv)
    code = o.post("/api/pvpn/admin/invites", json={"uses": 1, "allowance_gb": 5, "max_devices": 2, "days": 0}, headers=H).json()["code"]
    a = client(srv)
    a.post("/api/pvpn/signup", json={"name": "ann", "password": "ann-password-1", "invite": code}, headers=H)
    signin(a, "ann", "ann-password-1")
    d = a.post("/api/pvpn/devices", json={"name": "Phone <x>"}, headers=H).json()
    assert d["name"] == "Phone x" and d["ip"].startswith("10.77.") and d["ip"] != "10.77.0.1"
    conf = d["conf"]
    assert "AllowedIPs = 0.0.0.0/0, ::/0" in conf and "Endpoint = vpn.example.org:51820" in conf and "DNS = " in conf
    assert d["qr"].startswith("data:image/svg+xml") and d["qr_svg"].startswith("<svg")
    priv = conf.split("PrivateKey = ")[1].split("\n")[0]
    assert srv.KEY_RE.match(priv)
    # the private key is not kept
    with srv.db() as c:
        assert priv not in str([tuple(r) for r in c.execute("SELECT * FROM devices")])
    assert len(srv._fake_peers) == 1
    a.post("/api/pvpn/devices", json={"name": "Laptop"}, headers=H)
    assert a.post("/api/pvpn/devices", json={"name": "Third"}, headers=H).status_code == 400
    devs = a.get("/api/pvpn/devices").json()["devices"]
    assert [x["name"] for x in devs] == ["Phone x", "Laptop"]
    assert a.delete(f"/api/pvpn/devices/{devs[0]['id']}", headers=H).json()["ok"]
    assert len(srv._fake_peers) == 1
    # another person cannot remove it
    other = client(srv)
    o.post("/api/pvpn/admin/settings", json={"signup": "open"}, headers=H)
    other.post("/api/pvpn/signup", json={"name": "bob", "password": "bob-password-1"}, headers=H)
    signin(other, "bob", "bob-password-1")
    assert other.delete(f"/api/pvpn/devices/{devs[1]['id']}", headers=H).status_code == 404


def test_usage_cuts_off_and_owner_restores(srv):
    o = owner(srv)
    code = o.post("/api/pvpn/admin/invites", json={"uses": 1, "allowance_gb": 1, "max_devices": 3, "days": 0}, headers=H).json()["code"]
    a = client(srv)
    a.post("/api/pvpn/signup", json={"name": "ann", "password": "ann-password-1", "invite": code}, headers=H)
    signin(a, "ann", "ann-password-1")
    pub = None
    a.post("/api/pvpn/devices", json={"name": "Phone"}, headers=H)
    pub = next(iter(srv._fake_peers))
    peer = srv._fake_peers[pub]
    # 300 MB, then 900 MB more: over the 1 GB a month
    peer.update(rx=100_000_000, tx=200_000_000, handshake=int(time.time()), endpoint="203.0.113.5:4000")
    srv.tick()
    assert a.get("/api/pvpn/me").json()["used"] == 300_000_000
    d = a.get("/api/pvpn/devices").json()["devices"][0]
    assert d["online"] and d["endpoint"] == "203.0.113.5:4000" and d["tx"] == 200_000_000
    peer.update(rx=400_000_000, tx=800_000_000)
    srv.tick()
    me = a.get("/api/pvpn/me").json()
    assert me["used"] == 1_200_000_000 and "used up" in me["blocked"]
    assert pub not in srv._fake_peers                                  # cut off
    srv.tick()                                                          # counted once, not again
    assert a.get("/api/pvpn/me").json()["used"] == 1_200_000_000
    # the owner raises the plan: back on, and its counters start from 0 (no double counting)
    o.post(f"/api/pvpn/admin/users/{uid(o, 'ann')}", json={"allowance_gb": 5}, headers=H)
    assert srv._fake_peers[pub]["rx"] == 0
    srv._fake_peers[pub].update(rx=1_000, tx=2_000)
    srv.tick()
    assert a.get("/api/pvpn/me").json()["used"] == 1_200_003_000
    # reset the month; an end date in the past cuts off; extending brings it back
    o.post(f"/api/pvpn/admin/users/{uid(o, 'ann')}", json={"reset_usage": True, "until": time.time() - 10}, headers=H)
    assert a.get("/api/pvpn/me").json()["used"] == 0 and pub not in srv._fake_peers
    o.post(f"/api/pvpn/admin/users/{uid(o, 'ann')}", json={"extend_days": 30}, headers=H)
    assert pub in srv._fake_peers
    # turned off: gone and signed out; the owner cannot lock themself out
    o.post(f"/api/pvpn/admin/users/{uid(o, 'ann')}", json={"status": "disabled"}, headers=H)
    assert pub not in srv._fake_peers and a.get("/api/pvpn/devices").status_code == 401
    assert o.post(f"/api/pvpn/admin/users/{uid(o, 'owner')}", json={"status": "disabled"}, headers=H).status_code == 400
    assert o.post(f"/api/pvpn/admin/users/{uid(o, 'ann')}", json={"allowance_gb": -1}, headers=H).status_code == 400
    ov = o.get("/api/pvpn/admin/overview").json()
    assert ov["server"]["month_bytes"] == 0 and any("ann" in l["what"] for l in ov["log"])
    o.delete(f"/api/pvpn/admin/users/{uid(o, 'ann')}", headers=H)
    assert not srv._fake_peers


def test_piii_app_is_a_client(srv):
    """piii.app signs in with a token it keeps (no cookie), and only piii.app may call from the browser."""
    srv.make_user("ann", "ann-password-1", "active")
    site = client(srv)
    pre = site.options("/api/pvpn/devices", headers={"Origin": SITE, "Access-Control-Request-Method": "POST",
                                                     "Access-Control-Request-Headers": "authorization,content-type,x-pvpn"})
    assert pre.status_code == 204 and pre.headers["access-control-allow-origin"] == SITE
    assert "X-PVPN" in pre.headers["access-control-allow-headers"]
    evil = site.options("/api/pvpn/devices", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in evil.headers
    r = site.post("/api/pvpn/login", json={"name": "ann", "password": "ann-password-1"}, headers=H | {"Origin": SITE})
    assert r.headers["access-control-allow-origin"] == SITE
    tok = r.json()["token"]
    fresh = client(srv)                                                 # no cookie: the token alone
    auth = H | {"Authorization": "Bearer " + tok, "Origin": SITE}
    assert fresh.get("/api/pvpn/me", headers=auth).json()["name"] == "ann"
    assert fresh.post("/api/pvpn/devices", json={"name": "Phone"}, headers=auth).status_code == 200
    assert fresh.get("/api/pvpn/me", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert fresh.get("/api/pvpn/public", headers={"Origin": SITE}).json()["app"] == "piii VPN"
    fresh.post("/api/pvpn/logout", headers=auth)
    assert fresh.get("/api/pvpn/me", headers=auth).status_code == 401


def test_cli_and_helper_scripts(srv, capsys):
    assert srv._cli(["invite", "10", "3", "0", "2"]) == 0
    code = capsys.readouterr().out.strip()
    with srv.db() as c:
        inv = c.execute("SELECT * FROM invites WHERE code = ?", (code,)).fetchone()
    assert inv["uses"] == 2 and inv["allowance"] == 10 * srv.GB
    os.environ["PVPN_ADMIN_PASSWORD"] = "owner-password-1"
    try:
        assert srv._cli(["create-admin", "boss"]) == 0
    finally:
        del os.environ["PVPN_ADMIN_PASSWORD"]
    assert srv._cli(["status"]) == 0 and "boss" in capsys.readouterr().out
    here = os.path.join(os.path.dirname(__file__), "..", "vpn-server")
    import subprocess
    for f in ("pvpn-wg", "pvpn-fw", "install.sh"):
        assert subprocess.run(["bash", "-n", os.path.join(here, f)]).returncode == 0
    bad = subprocess.run(["bash", os.path.join(here, "pvpn-wg"), "add", "not-a-key", "10.77.0.2"], capture_output=True)
    assert bad.returncode == 2
    bad = subprocess.run(["bash", os.path.join(here, "pvpn-wg"), "add", "A" * 42 + "A=", "192.168.1.5"], capture_output=True)
    assert bad.returncode == 2
