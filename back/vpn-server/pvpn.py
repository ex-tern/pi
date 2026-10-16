"""piii VPN: your own VPN provider, from a Linux machine at home (Ubuntu Server, Debian, Raspberry Pi OS).

(owner, 2026-10-16: "I have a PC with Linux Ubuntu server on it and I have an internet. I want to make my own VPN
provider. Make an app for it and merge it to the tools".)

What it does:
  * accounts: people sign up on the server's page; the owner approves them, or hands out invite codes that let them
    in at once with a plan; or sign-up is open. The first account is made on the machine (`piiivpn create-admin NAME`);
  * plans: per person, a monthly data allowance (0 = unlimited), a number of devices and, if you like, a date the
    access runs until. Over the allowance or past that date, the person's devices are cut off by themselves (and come
    back on the 1st of the month, or when you extend the date);
  * the VPN: WireGuard. Each device gets a configuration (a file, and a QR code for a phone) that sends all its
    internet through this machine. The firewall keeps devices away from your home network, from each other and from
    everything on this machine but its web page;
  * usage: bytes per device and per person per month, counted from WireGuard's counters once a minute; who is online.

Nothing here needs root itself: WireGuard's peers are changed by a small helper the installer puts in place (pvpn-wg,
allowed through sudo for its few commands only). With PVPN_WG=off (development, tests) the VPN parts keep their
records and do not touch the system.

Run: uvicorn pvpn:app (the installer sets it up as a service, behind Caddy for HTTPS). The command line:
    python3 pvpn.py create-admin NAME | status | invite [GB DEVICES DAYS USES] | sync | account
"""
from __future__ import annotations

import asyncio
import base64
import getpass
import hashlib
import ipaddress
import os
import re
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

VERSION = "1.0.0"

# ------------------------------------------------------------------------------------------------- settings

HERE = Path(__file__).resolve().parent
DATA = Path(os.getenv("PVPN_DATA", "/var/lib/piiivpn"))
WG = os.getenv("PVPN_WG", "on").lower() not in ("off", "0", "no", "false")
WG_HELPER = os.getenv("PVPN_WG_HELPER", "/usr/local/lib/piiivpn/pvpn-wg")
WG_ENDPOINT = os.getenv("PVPN_WG_ENDPOINT", "")           # your public name and port, e.g. vpn.example.org:51820
WG_DNS = os.getenv("PVPN_WG_DNS", "1.1.1.1, 9.9.9.9")
WG_NET = ipaddress.ip_network(os.getenv("PVPN_WG_NET", "10.77.0.0/16"))
WG_SERVER_IP = next(WG_NET.hosts())                        # 10.77.0.1
TICK = float(os.getenv("PVPN_TICK", "60"))                 # seconds between counting usage and applying the plans
ONLINE_S = 180                                             # a handshake this recent: the device is connected
SESSION_DAYS = 30
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,31}$")
KEY_RE = re.compile(r"^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$")
GB = 1_000_000_000
# the sites allowed to be this server's client in the browser: piii.app's Tools → piii VPN (it signs in with a token
# it keeps itself, not with this site's cookie); more with PVPN_ORIGINS (space-separated), e.g. http://localhost:8000
ORIGINS = {"https://www.piii.app", "https://piii.app"} | set(os.getenv("PVPN_ORIGINS", "").split())

# ------------------------------------------------------------------------------------------------- the store


def db() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DATA / "piiivpn.db", timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def init_db() -> None:
    with db() as c:
        c.execute("PRAGMA journal_mode = WAL")
        c.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, pw TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', admin INTEGER NOT NULL DEFAULT 0,
                allowance INTEGER NOT NULL DEFAULT 0,       -- bytes a month; 0 = unlimited
                max_devices INTEGER NOT NULL DEFAULT 5,
                until REAL NOT NULL DEFAULT 0,              -- unix time the access runs until; 0 = no end
                note TEXT DEFAULT '', created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL, pubkey TEXT UNIQUE NOT NULL, ip TEXT UNIQUE NOT NULL, created REAL NOT NULL,
                rx INTEGER NOT NULL DEFAULT 0, tx INTEGER NOT NULL DEFAULT 0,       -- all time, bytes
                seen_rx INTEGER NOT NULL DEFAULT 0, seen_tx INTEGER NOT NULL DEFAULT 0,  -- WireGuard's counters, last read
                handshake REAL NOT NULL DEFAULT 0, endpoint TEXT NOT NULL DEFAULT '');
            CREATE TABLE IF NOT EXISTS usage (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, month TEXT NOT NULL,
                bytes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month));
            CREATE TABLE IF NOT EXISTS invites (
                code TEXT PRIMARY KEY, uses INTEGER NOT NULL, allowance INTEGER NOT NULL, max_devices INTEGER NOT NULL,
                days INTEGER NOT NULL, note TEXT DEFAULT '', created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS log (at REAL NOT NULL, what TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
        """)


def setting(k: str, default: str = "") -> str:
    with db() as c:
        r = c.execute("SELECT v FROM settings WHERE k = ?", (k,)).fetchone()
    return r["v"] if r else default


def set_setting(k: str, v: str) -> None:
    with db() as c:
        c.execute("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", (k, v))


def settings() -> dict:
    return {
        "provider": setting("provider", "piii VPN"),
        "signup": setting("signup", "approval"),             # approval | invite | open
        "default_gb": float(setting("default_gb", "100")),
        "default_devices": int(setting("default_devices", "5")),
        "default_days": int(setting("default_days", "0")),
    }


def note(what: str) -> None:
    with db() as c:
        c.execute("INSERT INTO log (at, what) VALUES (?, ?)", (time.time(), what[:300]))
        c.execute("DELETE FROM log WHERE at < ?", (time.time() - 90 * 86400,))


def month(t: float | None = None) -> str:
    return time.strftime("%Y-%m", time.localtime(t if t is not None else time.time()))


# ------------------------------------------------------------------------------------------------- passwords


def pw_hash(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(h).decode()


def pw_ok(pw: str, stored: str) -> bool:
    try:
        _, s, h = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=base64.b64decode(s), n=2 ** 14, r=8, p=1, dklen=32)
        return secrets.compare_digest(got, base64.b64decode(h))
    except Exception:
        return False


def make_user(name: str, pw: str, status: str = "pending", admin: bool = False, allowance: int | None = None,
              max_devices: int | None = None, until: float = 0) -> int:
    s = settings()
    if allowance is None:
        allowance = 0 if admin else int(s["default_gb"] * GB)
    if max_devices is None:
        max_devices = 10 if admin else s["default_devices"]
    if not until and not admin and s["default_days"] > 0:
        until = time.time() + s["default_days"] * 86400
    with db() as c:
        cur = c.execute("INSERT INTO users (name, pw, status, admin, allowance, max_devices, until, created) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (name, pw_hash(pw), status, int(admin), allowance, max_devices, until, time.time()))
        return cur.lastrowid


# ------------------------------------------------------------------------------------------------- plans


def used_this_month(c: sqlite3.Connection, uid: int) -> int:
    r = c.execute("SELECT bytes FROM usage WHERE user_id = ? AND month = ?", (uid, month())).fetchone()
    return int(r["bytes"]) if r else 0


def blocked(c: sqlite3.Connection, u: sqlite3.Row) -> str:
    """Why this person's devices are off right now ('' when they may connect)."""
    if u["status"] == "pending":
        return "waiting for approval"
    if u["status"] != "active":
        return "turned off by the owner"
    if u["until"] and u["until"] < time.time():
        return "access ended " + time.strftime("%Y-%m-%d", time.localtime(u["until"]))
    if u["allowance"] and used_this_month(c, u["id"]) >= u["allowance"]:
        return "this month's data is used up"
    return ""


# ------------------------------------------------------------------------------------------------- WireGuard

_wg_lock = threading.RLock()


def wg_keys() -> tuple[str, str]:
    """A new key pair, made here: the private key goes into the device's configuration only and is not kept."""
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat
    k = X25519PrivateKey.generate()
    priv = k.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    pub = k.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(priv).decode(), base64.b64encode(pub).decode()


# with the VPN off (development, tests): what WireGuard would hold, so the rest behaves the same
_fake_peers: dict[str, dict] = {}


def wg_call(*args: str) -> str:
    """The helper (root, through sudo, its few commands only)."""
    if not WG:
        cmd = args[0]
        if cmd == "add":
            _fake_peers.setdefault(args[1], {"rx": 0, "tx": 0, "handshake": 0, "endpoint": "(none)"})
        elif cmd == "remove":
            _fake_peers.pop(args[1], None)
        elif cmd == "peers":
            return "\n".join(_fake_peers)
        elif cmd == "dump":
            return "\n".join(f"{k} {v['endpoint']} {v['handshake']} {v['rx']} {v['tx']}" for k, v in _fake_peers.items())
        return ""
    r = subprocess.run(["sudo", "-n", "/bin/bash", WG_HELPER, *args], capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        raise HTTPException(status_code=500, detail=f"The VPN could not be changed: {(r.stderr or r.stdout).strip()[:200]}")
    return r.stdout


def wg_server_pub() -> str:
    if not WG:
        return setting("wg_pub_dev") or (set_setting("wg_pub_dev", wg_keys()[1]) or setting("wg_pub_dev"))
    return wg_call("pubkey").strip()


def wg_dump() -> dict[str, dict]:
    """Per peer: where it connects from, its last handshake and WireGuard's byte counters (since it was added)."""
    out = {}
    try:
        for line in wg_call("dump").splitlines():
            p = line.split()
            if len(p) >= 5 and KEY_RE.match(p[0]):
                out[p[0]] = {"endpoint": "" if p[1] == "(none)" else p[1], "handshake": int(p[2]),
                             "rx": int(p[3]), "tx": int(p[4])}
    except (HTTPException, ValueError, subprocess.TimeoutExpired):
        pass
    return out


def account() -> None:
    """Counts what each device sent and received since the last look, into its person's month."""
    with _wg_lock:
        dump = wg_dump()
        if not dump:
            return
        m = month()
        with db() as c:
            for d in c.execute("SELECT id, user_id, pubkey, seen_rx, seen_tx FROM devices").fetchall():
                p = dump.get(d["pubkey"])
                if not p:
                    continue
                # the counters start again from 0 when a peer is (re)added or WireGuard restarts
                drx = p["rx"] - d["seen_rx"] if p["rx"] >= d["seen_rx"] else p["rx"]
                dtx = p["tx"] - d["seen_tx"] if p["tx"] >= d["seen_tx"] else p["tx"]
                c.execute("UPDATE devices SET seen_rx = ?, seen_tx = ?, rx = rx + ?, tx = tx + ?, handshake = ?, "
                          "endpoint = ? WHERE id = ?", (p["rx"], p["tx"], drx, dtx, p["handshake"], p["endpoint"], d["id"]))
                if drx or dtx:
                    c.execute("INSERT INTO usage (user_id, month, bytes) VALUES (?, ?, ?) "
                              "ON CONFLICT(user_id, month) DO UPDATE SET bytes = bytes + excluded.bytes",
                              (d["user_id"], m, drx + dtx))


def wg_sync() -> None:
    """WireGuard's peers are exactly the devices of the people who may connect now; the others are taken away."""
    with _wg_lock:
        with db() as c:
            users = {u["id"]: u for u in c.execute("SELECT * FROM users").fetchall()}
            ok = {uid for uid, u in users.items() if not blocked(c, u)}
            devs = c.execute("SELECT id, user_id, pubkey, ip FROM devices").fetchall()
            want = {d["pubkey"]: d for d in devs if d["user_id"] in ok}
            off = {users[d["user_id"]]["name"] for d in devs if d["user_id"] not in ok}
        have = {x for x in wg_call("peers").split() if KEY_RE.match(x)}
        for pub in have - set(want):
            wg_call("remove", pub)
        for pub, d in want.items():
            if pub not in have:
                with db() as c:
                    c.execute("UPDATE devices SET seen_rx = 0, seen_tx = 0 WHERE id = ?", (d["id"],))
                wg_call("add", pub, d["ip"])
        cut = sorted(off & {users[d["user_id"]]["name"] for d in devs if d["pubkey"] in have})
        if cut:
            note("cut off: " + ", ".join(cut))


def tick() -> None:
    account()
    wg_sync()


def free_ip(c: sqlite3.Connection) -> str:
    used = {r["ip"] for r in c.execute("SELECT ip FROM devices")}
    for h in WG_NET.hosts():
        if h != WG_SERVER_IP and str(h) not in used:
            return str(h)
    raise HTTPException(status_code=507, detail="No VPN addresses left.")


def device_conf(priv: str, ip: str) -> str:
    return "\n".join([
        "[Interface]",
        f"PrivateKey = {priv}",
        f"Address = {ip}/32",
        f"DNS = {WG_DNS}",
        "",
        "[Peer]",
        f"PublicKey = {wg_server_pub()}",
        # everything, IPv6 too: IPv6 goes nowhere rather than around the VPN
        "AllowedIPs = 0.0.0.0/0, ::/0",
        f"Endpoint = {WG_ENDPOINT or 'YOUR-PUBLIC-NAME:51820'}",
        "PersistentKeepalive = 25",
        "",
    ])


# ------------------------------------------------------------------------------------------------- the app


async def _ticker():
    while True:
        await asyncio.sleep(TICK)
        try:
            await asyncio.to_thread(tick)
        except Exception as e:  # keep counting next time
            print("piii VPN tick:", e, file=sys.stderr)


@asynccontextmanager
async def _life(_app):
    init_db()
    try:
        tick()
    except Exception as e:  # the page still works while the VPN is not set up
        print("VPN not synced:", e, file=sys.stderr)
    task = asyncio.create_task(_ticker()) if TICK > 0 else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="piii VPN", docs_url=None, redoc_url=None, openapi_url=None, lifespan=_life)
_hits: dict = defaultdict(deque)
_hits_lock = threading.Lock()


def client_ip(req: Request) -> str:
    # Caddy (on this machine) puts the caller in X-Forwarded-For; anything else is the direct peer
    peer = req.client.host if req.client else ""
    if peer in ("127.0.0.1", "::1"):
        return (req.headers.get("x-forwarded-for") or peer).split(",")[0].strip()
    return peer


def limit(req: Request, bucket: str, n: int, per: float) -> None:
    key, now = f"{bucket}:{client_ip(req)}", time.time()
    with _hits_lock:
        q = _hits[key]
        while q and q[0] < now - per:
            q.popleft()
        if len(q) >= n:
            raise HTTPException(status_code=429, detail="Too many tries. Wait a minute and try again.")
        q.append(now)


def me(req: Request, need: str = "active") -> sqlite3.Row:
    auth = req.headers.get("authorization", "")
    tok = auth[7:].strip() if auth.lower().startswith("bearer ") else req.cookies.get("pvpn", "")
    if not tok:
        raise HTTPException(status_code=401, detail="Sign in first.")
    h = hashlib.sha256(tok.encode()).hexdigest()
    with db() as c:
        u = c.execute("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?",
                      (h, time.time())).fetchone()
    if not u:
        raise HTTPException(status_code=401, detail="Sign in first.")
    if need == "active" and u["status"] != "active":
        raise HTTPException(status_code=403, detail="Your account is waiting for approval." if u["status"] == "pending" else "Your account is turned off.")
    if need == "admin" and not (u["admin"] and u["status"] == "active"):
        raise HTTPException(status_code=403, detail="For the owner only.")
    return u


@app.middleware("http")
async def _guard(req: Request, call_next):
    """Changes need the X-PVPN header (a page on another site cannot send it without asking first, and only piii.app
    is let ask), and every answer says what it may load."""
    origin = req.headers.get("origin", "")
    cors = origin in ORIGINS and req.url.path.startswith("/api/pvpn/")
    if req.method == "OPTIONS" and cors:
        return Response(status_code=204, headers={
            "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Max-Age": "600",
            "Access-Control-Allow-Methods": "GET, POST, DELETE",
            "Access-Control-Allow-Headers": "Authorization, Content-Type, X-PVPN"})
    if req.method in ("POST", "PUT", "PATCH", "DELETE") and req.url.path.startswith("/api/") and req.headers.get("x-pvpn") != "1":
        return JSONResponse({"detail": "Missing X-PVPN header."}, status_code=403)
    resp = await call_next(req)
    if cors:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    return resp


async def body(req: Request) -> dict:
    try:
        d = await req.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Send JSON.")
    if not isinstance(d, dict):
        raise HTTPException(status_code=400, detail="Send a JSON object.")
    return d


def num(d: dict, k: str, lo: float, hi: float) -> float:
    try:
        v = float(d[k])
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{k} must be a number.")
    if not lo <= v <= hi:
        raise HTTPException(status_code=400, detail=f"{k} must be between {lo:g} and {hi:g}.")
    return v


# ---------------------------------------------------------------------------- accounts


@app.post("/api/pvpn/signup")
async def signup(req: Request):
    limit(req, "signup", 5, 3600)
    d = await body(req)
    name, pw = str(d.get("name") or "").strip().lower(), str(d.get("password") or "")
    code = str(d.get("invite") or "").strip().upper()
    if not NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="A user name is 3 to 32 letters, digits, dots, dashes or underscores.")
    if len(pw) < 10:
        raise HTTPException(status_code=400, detail="Use a password of at least 10 characters.")
    mode = settings()["signup"]
    inv = None
    if code:
        with db() as c:
            inv = c.execute("SELECT * FROM invites WHERE code = ? AND uses > 0", (code,)).fetchone()
        if not inv:
            raise HTTPException(status_code=400, detail="That invite code is not valid (or has been used up).")
    elif mode == "invite":
        raise HTTPException(status_code=403, detail="This server takes new people by invite code only.")
    try:
        if inv:
            uid = make_user(name, pw, "active", allowance=inv["allowance"], max_devices=inv["max_devices"],
                            until=time.time() + inv["days"] * 86400 if inv["days"] > 0 else 0)
            with db() as c:
                c.execute("UPDATE invites SET uses = uses - 1 WHERE code = ?", (code,))
            note(f"{name} joined with invite {code}")
            status = "active"
        else:
            status = "active" if mode == "open" else "pending"
            uid = make_user(name, pw, status)
            note(f"{name} signed up ({status})")
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="That user name is taken.")
    if n := str(d.get("note") or "")[:300]:
        with db() as c:
            c.execute("UPDATE users SET note = ? WHERE id = ?", (n, uid))
    return {"status": status, "message": "Welcome: you can sign in." if status == "active" else "Thanks: the owner will approve your account; then you can sign in."}


@app.post("/api/pvpn/login")
async def login(req: Request):
    limit(req, "login", 10, 300)
    d = await body(req)
    name, pw = str(d.get("name") or "").strip().lower(), str(d.get("password") or "")
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE name = ?", (name,)).fetchone()
    if not u or not pw_ok(pw, u["pw"]):
        raise HTTPException(status_code=401, detail="That user name and password do not match.")
    tok = secrets.token_urlsafe(32)
    with db() as c:
        c.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        c.execute("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)",
                  (hashlib.sha256(tok.encode()).hexdigest(), u["id"], time.time() + SESSION_DAYS * 86400))
    # the token: in a cookie for this server's own page, and in the answer for piii.app, which keeps it itself
    r = JSONResponse({"name": u["name"], "status": u["status"], "token": tok})
    https = req.headers.get("x-forwarded-proto") == "https" or req.url.scheme == "https"
    r.set_cookie("pvpn", tok, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=https, path="/")
    return r


@app.post("/api/pvpn/logout")
def logout(req: Request):
    auth = req.headers.get("authorization", "")
    tok = auth[7:].strip() if auth.lower().startswith("bearer ") else req.cookies.get("pvpn", "")
    if tok:
        with db() as c:
            c.execute("DELETE FROM sessions WHERE token = ?", (hashlib.sha256(tok.encode()).hexdigest(),))
    r = JSONResponse({"ok": True})
    r.delete_cookie("pvpn", path="/")
    return r


@app.post("/api/pvpn/password")
async def change_password(req: Request):
    u = me(req, need="any")
    d = await body(req)
    if not pw_ok(str(d.get("old") or ""), u["pw"]):
        raise HTTPException(status_code=401, detail="The present password is not right.")
    new = str(d.get("new") or "")
    if len(new) < 10:
        raise HTTPException(status_code=400, detail="Use a password of at least 10 characters.")
    with db() as c:
        c.execute("UPDATE users SET pw = ? WHERE id = ?", (pw_hash(new), u["id"]))
        c.execute("DELETE FROM sessions WHERE user_id = ?", (u["id"],))
    return {"ok": True, "message": "Changed: sign in again."}


@app.get("/api/pvpn/me")
def whoami(req: Request):
    u = me(req, need="any")
    with db() as c:
        used = used_this_month(c, u["id"])
        why = blocked(c, u)
        n = c.execute("SELECT COUNT(*) FROM devices WHERE user_id = ?", (u["id"],)).fetchone()[0]
    return {"name": u["name"], "status": u["status"], "admin": bool(u["admin"]), "allowance": u["allowance"],
            "used": used, "month": month(), "until": u["until"], "devices": n, "max_devices": u["max_devices"],
            "blocked": why, "provider": settings()["provider"], "vpn": WG, "endpoint_set": bool(WG_ENDPOINT) or not WG}


@app.get("/api/pvpn/public")
def public_info():
    """What the sign-in page needs (here, and on piii.app)."""
    s = settings()
    return {"app": "piii VPN", "version": VERSION, "provider": s["provider"], "signup": s["signup"],
            "vpn": WG, "endpoint_set": bool(WG_ENDPOINT) or not WG}


# ---------------------------------------------------------------------------- devices


def device_rows(c: sqlite3.Connection, uid: int | None = None) -> list[dict]:
    q = "SELECT d.*, u.name AS owner FROM devices d JOIN users u ON u.id = d.user_id"
    rows = c.execute(q + (" WHERE d.user_id = ?" if uid is not None else "") + " ORDER BY d.created",
                     (() if uid is None else (uid,))).fetchall()
    now = time.time()
    return [{"id": r["id"], "name": r["name"], "ip": r["ip"], "created": r["created"], "owner": r["owner"],
             "rx": r["rx"], "tx": r["tx"], "handshake": r["handshake"], "endpoint": r["endpoint"],
             "online": bool(r["handshake"]) and now - r["handshake"] < ONLINE_S} for r in rows]


@app.get("/api/pvpn/devices")
def devices(req: Request):
    u = me(req)
    with db() as c:
        return {"devices": device_rows(c, u["id"]), "max": u["max_devices"], "blocked": blocked(c, u), "vpn": WG,
                "endpoint_set": bool(WG_ENDPOINT) or not WG}


@app.post("/api/pvpn/devices")
async def add_device(req: Request):
    """A new device: its configuration is shown once (the private key is not kept here)."""
    u = me(req)
    limit(req, "device", 20, 3600)
    d = await body(req)
    name = re.sub(r"[^\w .'-]", "", str(d.get("name") or ""))[:40].strip() or "Device"
    priv, pub = wg_keys()
    with _wg_lock:
        with db() as c:
            if c.execute("SELECT COUNT(*) FROM devices WHERE user_id = ?", (u["id"],)).fetchone()[0] >= u["max_devices"]:
                raise HTTPException(status_code=400, detail=f"Your plan has {u['max_devices']} devices: remove one first.")
            ip = free_ip(c)
            c.execute("INSERT INTO devices (user_id, name, pubkey, ip, created) VALUES (?, ?, ?, ?, ?)",
                      (u["id"], name, pub, ip, time.time()))
            why = blocked(c, u)
        if not why:
            wg_call("add", pub, ip)
    conf = device_conf(priv, ip)
    import segno
    q = segno.make(conf, error="m")
    return {"name": name, "ip": ip, "conf": conf, "qr_svg": q.svg_inline(scale=4, border=2),
            "qr": q.svg_data_uri(scale=4, border=2, dark="#000", light="#fff"), "blocked": why,
            "file": (re.sub(r"[^\w-]", "-", name)[:15] or "piiivpn") + ".conf"}


def _remove_device(r: sqlite3.Row) -> None:
    with _wg_lock:
        with db() as c:
            c.execute("DELETE FROM devices WHERE id = ?", (r["id"],))
        if r["pubkey"] in {x for x in wg_call("peers").split()}:
            wg_call("remove", r["pubkey"])


@app.delete("/api/pvpn/devices/{did}")
def remove_device(req: Request, did: int):
    u = me(req)
    with db() as c:
        r = c.execute("SELECT * FROM devices WHERE id = ? AND user_id = ?", (did, u["id"])).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="No such device.")
    _remove_device(r)
    return {"ok": True}


# ---------------------------------------------------------------------------- the owner


@app.get("/api/pvpn/admin/overview")
def admin_overview(req: Request):
    me(req, need="admin")
    with db() as c:
        devs = device_rows(c)
        users = []
        for u in c.execute("SELECT * FROM users ORDER BY status = 'pending' DESC, created").fetchall():
            mine = [d for d in devs if d["owner"] == u["name"]]
            users.append({k: u[k] for k in ("id", "name", "status", "admin", "allowance", "max_devices", "until", "note", "created")}
                         | {"used": used_this_month(c, u["id"]), "blocked": blocked(c, u), "devices": len(mine),
                            "online": sum(d["online"] for d in mine)})
        invites = [dict(r) for r in c.execute("SELECT * FROM invites WHERE uses > 0 ORDER BY created DESC")]
        total = int(c.execute("SELECT COALESCE(SUM(bytes), 0) FROM usage WHERE month = ?", (month(),)).fetchone()[0])
        log = [dict(r) for r in c.execute("SELECT at, what FROM log ORDER BY at DESC LIMIT 30")]
    return {"users": users, "devices": devs, "invites": invites, "settings": settings(), "log": log,
            "server": {"version": VERSION, "endpoint": WG_ENDPOINT, "dns": WG_DNS, "net": str(WG_NET), "vpn": WG,
                       "month": month(), "month_bytes": total, "online": sum(d["online"] for d in devs)}}


@app.post("/api/pvpn/admin/users/{uid}")
async def admin_user(req: Request, uid: int):
    a = me(req, need="admin")
    d = await body(req)
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="No such person.")
        if uid == a["id"] and (d.get("status") not in (None, "active") or d.get("admin") is False):
            raise HTTPException(status_code=400, detail="You cannot lock yourself out.")
        if "status" in d:
            if d["status"] not in ("active", "pending", "disabled"):
                raise HTTPException(status_code=400, detail="status is active, pending or disabled.")
            c.execute("UPDATE users SET status = ? WHERE id = ?", (d["status"], uid))
            if d["status"] != "active":
                c.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        if "admin" in d:
            c.execute("UPDATE users SET admin = ? WHERE id = ?", (1 if d["admin"] else 0, uid))
        if "allowance_gb" in d:
            c.execute("UPDATE users SET allowance = ? WHERE id = ?", (int(num(d, "allowance_gb", 0, 1e6) * GB), uid))
        if "max_devices" in d:
            c.execute("UPDATE users SET max_devices = ? WHERE id = ?", (int(num(d, "max_devices", 0, 100)), uid))
        if "until" in d:  # unix time; 0 = no end
            c.execute("UPDATE users SET until = ? WHERE id = ?", (num(d, "until", 0, 4e9), uid))
        if "extend_days" in d:  # from today, or from the present end if it is still ahead
            days = num(d, "extend_days", 1, 3650)
            c.execute("UPDATE users SET until = ? WHERE id = ?", (max(time.time(), u["until"] or 0) + days * 86400, uid))
        if d.get("reset_usage"):
            c.execute("DELETE FROM usage WHERE user_id = ? AND month = ?", (uid, month()))
    note(f"{a['name']} changed {u['name']}: " + ", ".join(sorted(d)))
    wg_sync()
    return {"ok": True}


@app.delete("/api/pvpn/admin/users/{uid}")
def admin_delete_user(req: Request, uid: int):
    a = me(req, need="admin")
    if uid == a["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete yourself.")
    with db() as c:
        u = c.execute("SELECT name FROM users WHERE id = ?", (uid,)).fetchone()
        c.execute("DELETE FROM users WHERE id = ?", (uid,))
    if u:
        note(f"{a['name']} deleted {u['name']}")
    wg_sync()
    return {"ok": True}


@app.delete("/api/pvpn/admin/devices/{did}")
def admin_remove_device(req: Request, did: int):
    me(req, need="admin")
    with db() as c:
        r = c.execute("SELECT * FROM devices WHERE id = ?", (did,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="No such device.")
    _remove_device(r)
    return {"ok": True}


def new_invite(uses: int, gb: float, devices: int, days: int, why: str = "") -> str:
    code = "-".join(secrets.token_hex(2).upper() for _ in range(3))
    with db() as c:
        c.execute("INSERT INTO invites (code, uses, allowance, max_devices, days, note, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  (code, uses, int(gb * GB), devices, days, why[:120], time.time()))
    return code


@app.post("/api/pvpn/admin/invites")
async def admin_invite(req: Request):
    me(req, need="admin")
    d = await body(req)
    code = new_invite(int(num(d, "uses", 1, 1000)), num(d, "allowance_gb", 0, 1e6), int(num(d, "max_devices", 1, 100)),
                      int(num(d, "days", 0, 3650)), str(d.get("note") or ""))
    return {"code": code}


@app.delete("/api/pvpn/admin/invites/{code}")
def admin_drop_invite(req: Request, code: str):
    me(req, need="admin")
    with db() as c:
        c.execute("DELETE FROM invites WHERE code = ?", (code.upper(),))
    return {"ok": True}


@app.post("/api/pvpn/admin/settings")
async def admin_settings(req: Request):
    me(req, need="admin")
    d = await body(req)
    if "signup" in d:
        if d["signup"] not in ("approval", "invite", "open"):
            raise HTTPException(status_code=400, detail="signup is approval, invite or open.")
        set_setting("signup", d["signup"])
    if "provider" in d:
        set_setting("provider", re.sub(r"[<>\x00-\x1f]", "", str(d["provider"]))[:40].strip() or "piii VPN")
    if "default_gb" in d:
        set_setting("default_gb", str(num(d, "default_gb", 0, 1e6)))
    if "default_devices" in d:
        set_setting("default_devices", str(int(num(d, "default_devices", 1, 100))))
    if "default_days" in d:
        set_setting("default_days", str(int(num(d, "default_days", 0, 3650))))
    return settings()


# ---------------------------------------------------------------------------- pages


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(HERE / "dashboard.html", media_type="text/html", headers={"Cache-Control": "no-cache"})


@app.get("/icon.svg", include_in_schema=False)
def icon():
    return FileResponse(HERE / "icon.svg", media_type="image/svg+xml")


# ------------------------------------------------------------------------------------------------- the command line


def _gb(b: int) -> str:
    return f"{b / GB:.2f} GB"


def _cli(argv: list[str]) -> int:
    init_db()
    cmd = argv[0] if argv else ""
    if cmd == "create-admin" and len(argv) >= 2:
        name = argv[1].strip().lower()
        if not NAME_RE.match(name):
            print("A user name is 3 to 32 letters, digits, dots, dashes or underscores.")
            return 1
        pw = os.getenv("PVPN_ADMIN_PASSWORD") or ""
        for _ in range(3 if not pw else 0):
            pw = getpass.getpass("Owner's password (10 characters or more): ")
            if len(pw) < 10:
                print(f"That is {len(pw)} characters: use 10 or more.")
            elif getpass.getpass("Once more: ") != pw:
                print("The two do not match.")
            else:
                break
            pw = ""
        if len(pw) < 10:
            print("No password set. Run again:  sudo piiivpn create-admin " + name)
            return 1
        try:
            make_user(name, pw, "active", admin=True)
        except sqlite3.IntegrityError:
            with db() as c:
                c.execute("UPDATE users SET pw = ?, status = 'active', admin = 1 WHERE name = ?", (pw_hash(pw), name))
            print(f"{name} is now an active owner (password changed).")
            return 0
        print(f"Owner account {name} made. Sign in at your server's address.")
        return 0
    if cmd == "invite":
        try:
            gb, devs, days, uses = (float(argv[1]) if len(argv) > 1 else settings()["default_gb"],
                                    int(argv[2]) if len(argv) > 2 else settings()["default_devices"],
                                    int(argv[3]) if len(argv) > 3 else 0, int(argv[4]) if len(argv) > 4 else 1)
        except ValueError:
            print("Usage: invite [GB-A-MONTH DEVICES DAYS USES]   (GB 0 = unlimited, DAYS 0 = no end)")
            return 1
        print(new_invite(uses, gb, devs, days))
        return 0
    if cmd == "sync":
        tick()
        print("Usage counted; VPN peers in step with the accounts and plans.")
        return 0
    if cmd == "account":
        account()
        return 0
    if cmd == "status":
        tick()
        with db() as c:
            devs = device_rows(c)
            print(f"piii VPN {VERSION} · {month()} · endpoint {WG_ENDPOINT or '(not set)'} · "
                  f"{sum(d['online'] for d in devs)} of {len(devs)} devices online")
            for u in c.execute("SELECT * FROM users ORDER BY name").fetchall():
                why = blocked(c, u)
                plan = "unlimited" if not u["allowance"] else _gb(u["allowance"])
                print(f"  {u['name']:<20} {u['status']:<9} {_gb(used_this_month(c, u['id']))} of {plan}"
                      + (f"  OFF: {why}" if why else ""))
                for d in devs:
                    if d["owner"] == u["name"]:
                        print(f"      {d['name']:<18} {d['ip']:<14} {'online' if d['online'] else 'offline':<8} "
                              f"↓{_gb(d['tx'])} ↑{_gb(d['rx'])}")
        return 0
    print("Usage: piiivpn create-admin NAME | status | invite [GB DEVICES DAYS USES] | sync")
    return 1


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
