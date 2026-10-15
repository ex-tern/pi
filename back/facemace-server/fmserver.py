"""Face Mace Server: your photos, sorted by face, and a VPN, from a Linux machine at home.

(owner, 2026-10-15: "set up a server who serves my photos through Face Mace and also provides VPN for users";
a home Linux machine or NAS; the VPN also for the whole internet; many users who sign up; each with their own
photos.)

What it does:
  * accounts: people sign up; the owner approves them (or turns on open sign-up); the first account is made on the
    machine itself (`python3 fmserver.py create-admin NAME`);
  * photos: each person uploads their own photos and videos, kept on this machine, visible to them only, within a
    quota; Face Mace (the full edition, the same program as on the website and in the Windows app) opens them
    straight from here and sorts them by face in the person's browser;
  * VPN: WireGuard. Each person adds their devices and gets a configuration (a file, and a QR code for a phone).
    A device goes to this server only ("server"), or sends all its internet through it ("everything"): the second
    only for people the owner allows, and the firewall holds to it whatever a device's configuration says.

Nothing here needs root itself: the WireGuard peers and the firewall are changed by a small helper the installer
puts in place (fms-wg, allowed through sudo for exactly its few commands). With FMS_WG=off (development, tests) the
VPN parts keep their records and do not touch the system.

Run: uvicorn fmserver:app (the installer sets it up as a service, behind Caddy for HTTPS).
"""
from __future__ import annotations

import base64
import getpass
import hashlib
import ipaddress
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

# ------------------------------------------------------------------------------------------------- settings

HERE = Path(__file__).resolve().parent
DATA = Path(os.getenv("FMS_DATA", "/var/lib/facemace"))
FRONT = Path(os.getenv("FMS_FRONT", str(HERE.parent.parent / "front")))
WG = os.getenv("FMS_WG", "on").lower() not in ("off", "0", "no", "false")
WG_HELPER = os.getenv("FMS_WG_HELPER", "/usr/local/lib/facemace/fms-wg")
WG_ENDPOINT = os.getenv("FMS_WG_ENDPOINT", "")            # your public name and port, e.g. photos.example.org:51820
WG_DNS = os.getenv("FMS_WG_DNS", "1.1.1.1, 9.9.9.9")
WG_NET = ipaddress.ip_network(os.getenv("FMS_WG_NET", "10.66.0.0/16"))
WG_SERVER_IP = next(WG_NET.hosts())                        # 10.66.0.1
DEFAULT_QUOTA_GB = float(os.getenv("FMS_QUOTA_GB", "20"))
SESSION_DAYS = 30
MAX_DEVICES = int(os.getenv("FMS_MAX_DEVICES", "5"))
MEDIA = re.compile(r"\.(jpe?g|png|heic|heif|mp4|m4v|mov|3gp|3g2|avi|mkv|webm|wmv|mts|m2ts|mpg|mpeg|flv|ogv)$", re.I)
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,31}$")

# ------------------------------------------------------------------------------------------------- the store


def db() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DATA / "facemace.db", timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def init_db() -> None:
    with db() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, pw TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', admin INTEGER NOT NULL DEFAULT 0,
                full_tunnel INTEGER NOT NULL DEFAULT 0, quota INTEGER NOT NULL,
                note TEXT DEFAULT '', created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS photos (
                id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL, type TEXT NOT NULL,
                aside INTEGER NOT NULL DEFAULT 0, added REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS photos_user ON photos(user_id, name);
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL, pubkey TEXT UNIQUE NOT NULL, ip TEXT UNIQUE NOT NULL,
                tunnel TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
        """)


def setting(k: str, default: str = "") -> str:
    with db() as c:
        r = c.execute("SELECT v FROM settings WHERE k = ?", (k,)).fetchone()
    return r["v"] if r else default


def set_setting(k: str, v: str) -> None:
    with db() as c:
        c.execute("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", (k, v))


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


def make_user(name: str, pw: str, status: str = "pending", admin: bool = False) -> int:
    with db() as c:
        cur = c.execute("INSERT INTO users (name, pw, status, admin, full_tunnel, quota, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (name, pw_hash(pw), status, int(admin), int(admin), int(DEFAULT_QUOTA_GB * 1e9), time.time()))
        return cur.lastrowid


# ------------------------------------------------------------------------------------------------- the VPN (WireGuard)


def wg_keys() -> tuple[str, str]:
    """A new key pair, made here: the private key goes into the device's configuration only and is not kept."""
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat
    k = X25519PrivateKey.generate()
    priv = k.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    pub = k.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(priv).decode(), base64.b64encode(pub).decode()


def wg_call(*args: str) -> str:
    """The helper (root, through sudo, its few commands only); nothing when the VPN is off."""
    if not WG:
        return ""
    r = subprocess.run(["sudo", "-n", WG_HELPER, *args], capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        raise HTTPException(status_code=500, detail=f"The VPN could not be changed: {(r.stderr or r.stdout).strip()[:200]}")
    return r.stdout


def wg_server_pub() -> str:
    if not WG:
        return setting("wg_pub_dev") or (set_setting("wg_pub_dev", wg_keys()[1]) or setting("wg_pub_dev"))
    return wg_call("pubkey").strip()


def wg_firewall() -> None:
    """Who may use the VPN for the whole internet: the devices of the people allowed it (the rest reach this
    server only, whatever their configuration asks)."""
    with db() as c:
        ips = [r["ip"] for r in c.execute(
            "SELECT d.ip FROM devices d JOIN users u ON u.id = d.user_id "
            "WHERE d.tunnel = 'full' AND u.full_tunnel = 1 AND u.status = 'active'")]
    wg_call("internet", *ips)


def wg_sync() -> None:
    """The peers WireGuard has are the active people's devices: added, and the others taken away."""
    if not WG:
        return
    with db() as c:
        want = {r["pubkey"]: r["ip"] for r in c.execute(
            "SELECT d.pubkey, d.ip FROM devices d JOIN users u ON u.id = d.user_id WHERE u.status = 'active'")}
    have = set(x for x in wg_call("peers").split() if x)
    for pub in have - set(want):
        wg_call("remove", pub)
    for pub, ip in want.items():
        wg_call("add", pub, ip)
    wg_firewall()


def wg_transfer() -> dict:
    """Bytes in and out per device (since the VPN last started), and the last handshake."""
    out = {}
    if not WG:
        return out
    try:
        for line in wg_call("transfer").splitlines():
            p = line.split()
            if len(p) >= 4:
                out[p[0]] = {"rx": int(p[1]), "tx": int(p[2]), "handshake": int(p[3])}
    except HTTPException:
        pass
    return out


def free_ip(c: sqlite3.Connection) -> str:
    used = {r["ip"] for r in c.execute("SELECT ip FROM devices")}
    for h in WG_NET.hosts():
        if h == WG_SERVER_IP:
            continue
        if str(h) not in used:
            return str(h)
    raise HTTPException(status_code=507, detail="No VPN addresses left.")


def device_conf(priv: str, ip: str, tunnel: str) -> str:
    allowed = "0.0.0.0/0, ::/0" if tunnel == "full" else str(WG_NET)
    return "\n".join([
        "[Interface]",
        f"PrivateKey = {priv}",
        f"Address = {ip}/32",
        *([f"DNS = {WG_DNS}"] if tunnel == "full" else []),
        "",
        "[Peer]",
        f"PublicKey = {wg_server_pub()}",
        f"AllowedIPs = {allowed}",
        f"Endpoint = {WG_ENDPOINT or 'YOUR-PUBLIC-NAME:51820'}",
        "PersistentKeepalive = 25",
        "",
    ])


# ------------------------------------------------------------------------------------------------- the app

@asynccontextmanager
async def _life(_app):
    init_db()
    try:
        wg_sync()
    except Exception as e:  # the photos still work while the VPN is not set up
        print("VPN not synced:", e, file=sys.stderr)
    yield


app = FastAPI(title="Face Mace Server", docs_url=None, redoc_url=None, openapi_url=None, lifespan=_life)
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
    tok = req.cookies.get("fms", "")
    if not tok:
        raise HTTPException(status_code=401, detail="Sign in first.")
    h = hashlib.sha256(tok.encode()).hexdigest()
    with db() as c:
        u = c.execute("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?",
                      (h, time.time())).fetchone()
    if not u:
        raise HTTPException(status_code=401, detail="Sign in first.")
    if need == "active" and u["status"] != "active":
        raise HTTPException(status_code=403, detail="Your account is waiting for approval." if u["status"] == "pending" else "Your account is disabled.")
    if need == "admin" and not (u["admin"] and u["status"] == "active"):
        raise HTTPException(status_code=403, detail="For the owner only.")
    return u


@app.middleware("http")
async def _guard(req: Request, call_next):
    """Changes need the X-FMS header (a page on another site cannot send it without asking first), and every
    answer says what it may load."""
    if req.method in ("POST", "PUT", "PATCH", "DELETE") and req.url.path.startswith("/api/") and req.headers.get("x-fms") != "1":
        return JSONResponse({"detail": "Missing X-FMS header."}, status_code=403)
    resp = await call_next(req)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    return resp


def body(req_json: dict, k: str, default=""):
    v = req_json.get(k, default)
    return v if v is not None else default


# ---------------------------------------------------------------------------- accounts


@app.post("/api/fms/signup")
async def signup(req: Request):
    limit(req, "signup", 5, 3600)
    d = await req.json()
    name, pw = str(body(d, "name")).strip().lower(), str(body(d, "password"))
    if not NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="A user name is 3 to 32 letters, digits, dots, dashes or underscores.")
    if len(pw) < 10:
        raise HTTPException(status_code=400, detail="Use a password of at least 10 characters.")
    status = "active" if setting("open_signup", "0") == "1" else "pending"
    try:
        make_user(name, pw, status)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="That user name is taken.")
    if note := str(body(d, "note"))[:300]:
        with db() as c:
            c.execute("UPDATE users SET note = ? WHERE name = ?", (note, name))
    return {"status": status, "message": "Welcome: you can sign in." if status == "active" else "Thanks: the owner will approve your account; then you can sign in."}


@app.post("/api/fms/login")
async def login(req: Request):
    limit(req, "login", 10, 300)
    d = await req.json()
    name, pw = str(body(d, "name")).strip().lower(), str(body(d, "password"))
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE name = ?", (name,)).fetchone()
    if not u or not pw_ok(pw, u["pw"]):
        raise HTTPException(status_code=401, detail="That user name and password do not match.")
    tok = secrets.token_urlsafe(32)
    with db() as c:
        c.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        c.execute("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)",
                  (hashlib.sha256(tok.encode()).hexdigest(), u["id"], time.time() + SESSION_DAYS * 86400))
    r = JSONResponse({"name": u["name"], "status": u["status"]})
    https = req.headers.get("x-forwarded-proto") == "https" or req.url.scheme == "https"
    r.set_cookie("fms", tok, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=https, path="/")
    return r


@app.post("/api/fms/logout")
def logout(req: Request):
    tok = req.cookies.get("fms", "")
    if tok:
        with db() as c:
            c.execute("DELETE FROM sessions WHERE token = ?", (hashlib.sha256(tok.encode()).hexdigest(),))
    r = JSONResponse({"ok": True})
    r.delete_cookie("fms", path="/")
    return r


@app.post("/api/fms/password")
async def change_password(req: Request):
    u = me(req, need="any")
    d = await req.json()
    if not pw_ok(str(body(d, "old")), u["pw"]):
        raise HTTPException(status_code=401, detail="The present password is not right.")
    new = str(body(d, "new"))
    if len(new) < 10:
        raise HTTPException(status_code=400, detail="Use a password of at least 10 characters.")
    with db() as c:
        c.execute("UPDATE users SET pw = ? WHERE id = ?", (pw_hash(new), u["id"]))
        c.execute("DELETE FROM sessions WHERE user_id = ?", (u["id"],))
    return {"ok": True, "message": "Changed: sign in again."}


def used_bytes(c: sqlite3.Connection, uid: int) -> int:
    return int(c.execute("SELECT COALESCE(SUM(size), 0) FROM photos WHERE user_id = ?", (uid,)).fetchone()[0])


@app.get("/api/fms/me")
def whoami(req: Request):
    u = me(req, need="any")
    with db() as c:
        used = used_bytes(c, u["id"])
        n = c.execute("SELECT COUNT(*) FROM photos WHERE user_id = ? AND aside = 0", (u["id"],)).fetchone()[0]
    return {"name": u["name"], "status": u["status"], "admin": bool(u["admin"]), "full_tunnel": bool(u["full_tunnel"]),
            "quota": u["quota"], "used": used, "photos": n, "vpn": WG, "endpoint_set": bool(WG_ENDPOINT) or not WG,
            "open_signup": setting("open_signup", "0") == "1"}


@app.get("/api/fms/public")
def public_info():
    return {"open_signup": setting("open_signup", "0") == "1", "vpn": WG}


# ---------------------------------------------------------------------------- photos


def photo_path(uid: int, pid: str) -> Path:
    return DATA / "users" / str(uid) / "photos" / pid


def clean_name(n: str) -> str:
    parts = [p for p in re.split(r"[\\/]+", n or "") if p not in ("", ".", "..")]
    n = "/".join(parts)[-240:]
    return re.sub(r"[\x00-\x1f]", "", n) or "photo.jpg"


@app.get("/api/fms/photos")
def photos(req: Request, aside: int = 0):
    u = me(req)
    with db() as c:
        rows = c.execute("SELECT id, name, size, mtime, type FROM photos WHERE user_id = ? AND aside = ? ORDER BY name",
                         (u["id"], 1 if aside else 0)).fetchall()
    return {"photos": [dict(r) | {"url": f"/api/fms/photos/{r['id']}"} for r in rows]}


@app.post("/api/fms/photos")
async def upload(req: Request, files: list[UploadFile] = File(...), mtimes: str = Form("")):
    """Photos and videos, as many as fit in the quota; each written to disk as it comes (any size)."""
    u = me(req)
    times = [t for t in mtimes.split(",")] if mtimes else []
    added, skipped = [], []
    with db() as c:
        used = used_bytes(c, u["id"])
    folder = DATA / "users" / str(u["id"]) / "photos"
    folder.mkdir(parents=True, exist_ok=True)
    for k, f in enumerate(files):
        name = clean_name(f.filename or "")
        if not MEDIA.search(name):
            skipped.append({"name": name, "why": "not a photo or video"})
            continue
        pid = secrets.token_hex(12)
        dest = folder / pid
        size = 0
        try:
            with open(dest, "wb") as out:
                while chunk := await f.read(1 << 20):
                    size += len(chunk)
                    if used + size > u["quota"]:
                        raise OverflowError
                    out.write(chunk)
        except OverflowError:
            dest.unlink(missing_ok=True)
            skipped.append({"name": name, "why": "over your quota"})
            continue
        try:
            mt = float(times[k]) if k < len(times) and times[k] else time.time() * 1000
        except ValueError:
            mt = time.time() * 1000
        used += size
        with db() as c:
            c.execute("INSERT INTO photos (id, user_id, name, size, mtime, type, added) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (pid, u["id"], name, size, mt, f.content_type or "application/octet-stream", time.time()))
        added.append({"id": pid, "name": name, "size": size})
    return {"added": added, "skipped": skipped, "used": used, "quota": u["quota"]}


def own_photo(req: Request, pid: str) -> tuple[sqlite3.Row, sqlite3.Row]:
    u = me(req)
    if not re.fullmatch(r"[0-9a-f]{24}", pid):
        raise HTTPException(status_code=404, detail="No such photo.")
    with db() as c:
        p = c.execute("SELECT * FROM photos WHERE id = ? AND user_id = ?", (pid, u["id"])).fetchone()
    if not p:
        raise HTTPException(status_code=404, detail="No such photo.")
    return u, p


@app.get("/api/fms/photos/{pid}")
def photo(req: Request, pid: str):
    u, p = own_photo(req, pid)
    return FileResponse(photo_path(u["id"], pid), media_type=p["type"], headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/fms/photos/{pid}/thumb")
def thumb(req: Request, pid: str):
    """A small picture for the list (made once, kept); the photo itself where it cannot be made."""
    u, p = own_photo(req, pid)
    t = DATA / "users" / str(u["id"]) / "thumbs" / (pid + ".jpg")
    if not t.exists():
        try:
            from PIL import Image, ImageOps
            try:
                import pillow_heif
                pillow_heif.register_heif_opener()
            except Exception:
                pass
            t.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(photo_path(u["id"], pid)) as im:
                im = ImageOps.exif_transpose(im)
                im.thumbnail((320, 320))
                im.convert("RGB").save(t, "JPEG", quality=80)
        except Exception:
            return Response(status_code=204)
    return FileResponse(t, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=604800"})


@app.delete("/api/fms/photos/{pid}")
def delete_photo(req: Request, pid: str):
    u, p = own_photo(req, pid)
    photo_path(u["id"], pid).unlink(missing_ok=True)
    (DATA / "users" / str(u["id"]) / "thumbs" / (pid + ".jpg")).unlink(missing_ok=True)
    with db() as c:
        c.execute("DELETE FROM photos WHERE id = ?", (pid,))
    return {"ok": True}


@app.post("/api/fms/photos/{pid}/aside")
def aside_photo(req: Request, pid: str):
    """Put aside (Face Mace's duplicates, moved out of the way): kept, but no longer in the photos."""
    u, p = own_photo(req, pid)
    with db() as c:
        c.execute("UPDATE photos SET aside = 1 WHERE id = ?", (pid,))
    return {"ok": True}


@app.post("/api/fms/photos/{pid}/restore")
def restore_photo(req: Request, pid: str):
    u, p = own_photo(req, pid)
    with db() as c:
        c.execute("UPDATE photos SET aside = 0 WHERE id = ?", (pid,))
    return {"ok": True}


# ---------------------------------------------------------------------------- VPN devices


@app.get("/api/fms/vpn")
def devices(req: Request):
    u = me(req)
    tr = wg_transfer()
    with db() as c:
        rows = c.execute("SELECT id, name, ip, tunnel, created, pubkey FROM devices WHERE user_id = ? ORDER BY created", (u["id"],)).fetchall()
    return {"devices": [{k: r[k] for k in ("id", "name", "ip", "tunnel", "created")} | tr.get(r["pubkey"], {}) for r in rows],
            "full_allowed": bool(u["full_tunnel"]), "max": MAX_DEVICES, "vpn": WG, "endpoint_set": bool(WG_ENDPOINT) or not WG}


@app.post("/api/fms/vpn")
async def add_device(req: Request):
    """A new device: its configuration is shown once (the private key is not kept here)."""
    u = me(req)
    d = await req.json()
    name = re.sub(r"[^\w .-]", "", str(body(d, "name")))[:40].strip() or "Device"
    tunnel = "full" if body(d, "tunnel") == "full" else "server"
    if tunnel == "full" and not u["full_tunnel"]:
        raise HTTPException(status_code=403, detail="Sending all your internet through this server is not allowed for your account (the owner can allow it).")
    priv, pub = wg_keys()
    with db() as c:
        if c.execute("SELECT COUNT(*) FROM devices WHERE user_id = ?", (u["id"],)).fetchone()[0] >= MAX_DEVICES:
            raise HTTPException(status_code=400, detail=f"At most {MAX_DEVICES} devices: remove one first.")
        ip = free_ip(c)
        c.execute("INSERT INTO devices (user_id, name, pubkey, ip, tunnel, created) VALUES (?, ?, ?, ?, ?, ?)",
                  (u["id"], name, pub, ip, tunnel, time.time()))
    wg_call("add", pub, ip)
    if tunnel == "full":
        wg_firewall()
    conf = device_conf(priv, ip, tunnel)
    import segno
    qr = segno.make(conf, error="m").svg_inline(scale=4, border=2)
    return {"name": name, "ip": ip, "tunnel": tunnel, "conf": conf, "qr_svg": qr, "file": re.sub(r"[^\w-]", "-", name)[:15] + ".conf"}


@app.delete("/api/fms/vpn/{did}")
def remove_device(req: Request, did: int):
    u = me(req)
    with db() as c:
        r = c.execute("SELECT * FROM devices WHERE id = ? AND user_id = ?", (did, u["id"])).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="No such device.")
        c.execute("DELETE FROM devices WHERE id = ?", (did,))
    wg_call("remove", r["pubkey"])
    wg_firewall()
    return {"ok": True}


# ---------------------------------------------------------------------------- the owner


@app.get("/api/fms/admin/users")
def admin_users(req: Request):
    me(req, need="admin")
    tr = wg_transfer()
    with db() as c:
        users = c.execute("SELECT id, name, status, admin, full_tunnel, quota, note, created FROM users ORDER BY status = 'pending' DESC, created DESC").fetchall()
        out = []
        for u in users:
            devs = c.execute("SELECT pubkey, name, tunnel FROM devices WHERE user_id = ?", (u["id"],)).fetchall()
            rx = sum(tr.get(d["pubkey"], {}).get("rx", 0) for d in devs)
            tx = sum(tr.get(d["pubkey"], {}).get("tx", 0) for d in devs)
            out.append(dict(u) | {"used": used_bytes(c, u["id"]),
                                  "photos": c.execute("SELECT COUNT(*) FROM photos WHERE user_id = ?", (u["id"],)).fetchone()[0],
                                  "devices": len(devs), "vpn_rx": rx, "vpn_tx": tx})
    return {"users": out, "open_signup": setting("open_signup", "0") == "1"}


@app.post("/api/fms/admin/users/{uid}")
async def admin_user(req: Request, uid: int):
    a = me(req, need="admin")
    d = await req.json()
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="No such user.")
        if uid == a["id"] and (d.get("status") not in (None, "active") or d.get("admin") is False):
            raise HTTPException(status_code=400, detail="You cannot lock yourself out.")
        if "status" in d and d["status"] in ("active", "pending", "disabled"):
            c.execute("UPDATE users SET status = ? WHERE id = ?", (d["status"], uid))
            if d["status"] != "active":
                c.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        if "full_tunnel" in d:
            c.execute("UPDATE users SET full_tunnel = ? WHERE id = ?", (1 if d["full_tunnel"] else 0, uid))
        if "admin" in d:
            c.execute("UPDATE users SET admin = ? WHERE id = ?", (1 if d["admin"] else 0, uid))
        if "quota_gb" in d:
            c.execute("UPDATE users SET quota = ? WHERE id = ?", (int(max(0.0, float(d["quota_gb"])) * 1e9), uid))
    wg_sync()
    return {"ok": True}


@app.delete("/api/fms/admin/users/{uid}")
def admin_delete_user(req: Request, uid: int):
    a = me(req, need="admin")
    if uid == a["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete yourself.")
    with db() as c:
        c.execute("DELETE FROM users WHERE id = ?", (uid,))
    shutil.rmtree(DATA / "users" / str(uid), ignore_errors=True)
    wg_sync()
    return {"ok": True}


@app.post("/api/fms/admin/settings")
async def admin_settings(req: Request):
    me(req, need="admin")
    d = await req.json()
    if "open_signup" in d:
        set_setting("open_signup", "1" if d["open_signup"] else "0")
    return {"open_signup": setting("open_signup", "0") == "1"}


# ---------------------------------------------------------------------------- pages


def _ver(p: Path) -> str:
    try:
        return hashlib.sha256(p.read_bytes()).hexdigest()[:12]
    except OSError:
        return "0"


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(HERE / "dashboard.html", media_type="text/html", headers={"Cache-Control": "no-cache"})


@app.get("/facemace", include_in_schema=False)
@app.get("/facemace/", include_in_schema=False)
def facemace():
    """Face Mace, the full edition, with this server's photos as a place to open them from."""
    v = _ver(FRONT / "app" / "ui.wasm")
    return HTMLResponse('<!doctype html><html lang="en" data-edition="full" data-library="/api/fms/photos">'
                        '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                        '<title>Face Mace</title><link rel="icon" href="/icon.svg">'
                        f'<script type="module" src="/app/host.js?v={v}"></script></html>',
                        headers={"Cache-Control": "no-cache"})


@app.get("/icon.svg", include_in_schema=False)
def icon():
    return FileResponse(FRONT / "icon.svg", media_type="image/svg+xml")


for _p, _d in (("/app", "app"), ("/facemace", "facemace"), ("/fonts", "fonts")):
    if (FRONT / _d).is_dir():
        app.mount(_p, StaticFiles(directory=FRONT / _d), name=_d)

# ------------------------------------------------------------------------------------------------- the command line


def _cli(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "create-admin":
        init_db()
        name = argv[1].strip().lower()
        if not NAME_RE.match(name):
            print("A user name is 3 to 32 letters, digits, dots, dashes or underscores.")
            return 1
        pw = os.getenv("FMS_ADMIN_PASSWORD") or getpass.getpass("Password (10 characters or more): ")
        if len(pw) < 10:
            print("Too short.")
            return 1
        try:
            make_user(name, pw, "active", admin=True)
        except sqlite3.IntegrityError:
            with db() as c:
                c.execute("UPDATE users SET pw = ?, status = 'active', admin = 1, full_tunnel = 1 WHERE name = ?", (pw_hash(pw), name))
            print(f"{name} is now an active owner (password changed).")
            return 0
        print(f"Owner account {name} made. Sign in at your server's address.")
        return 0
    if argv[:1] == ["sync"]:
        init_db()
        wg_sync()
        print("VPN peers and firewall in step with the accounts.")
        return 0
    print("Usage: python3 fmserver.py create-admin NAME | sync")
    return 1


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
