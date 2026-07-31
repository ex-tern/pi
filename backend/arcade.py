"""
Science Map arcade — server-authoritative scoring for the bubble game.

Why this is not just a client-side score POST
---------------------------------------------
The arcade hands out free assessment allowance, which has real cost (LLM
calls, CPU). Anything that grants allowance on the strength of a number the
browser reports is a free-credit faucet for anyone who can open devtools.

So the server never trusts the score. It trusts a *replay*:

1. ``start_session`` picks a random seed and returns it inside an HMAC-signed,
   expiring token. The seed deterministically generates the entire field of
   science bubbles — the client renders exactly the field the server can
   reconstruct.
2. The client plays and records the ordered list of bubble ids it absorbed,
   each with the elapsed milliseconds at which it happened.
3. ``verify_run`` regenerates the field from the seed and replays that list
   under the game's own rules: you may only absorb a bubble strictly smaller
   than you are at that moment, and absorbing it grows you by a fixed
   fraction. A run that claims an impossible absorption is rejected.

That reduces cheating to "actually simulate the game correctly", at which
point the cheater has reimplemented playing it. Timing floors additionally
stop an instant-win replay that absorbs the whole map in one frame.

Statelessness
-------------
Like ``challenge.py``, the signed token carries its own parameters, so no
server-side session table is needed and this survives restarts and multiple
gunicorn workers. Replay of a *token* is prevented by a short TTL plus the
per-IP cooldown enforced in the database.
"""
import time
import hmac
import json
import base64
import hashlib
import logging
import secrets
from typing import Dict, List, Optional, Tuple

try:
    from config import ETH_ADMIN_PRIVATE_KEY
except ImportError:  # pragma: no cover - config is always present in the app
    ETH_ADMIN_PRIVATE_KEY = ""

logger = logging.getLogger(__name__)

# --- Game constants -------------------------------------------------------
# These are mirrored exactly in frontend/app.js. If you change one, change
# both: a mismatch makes every honest run fail verification.
FIELD_SIZE = 90            # bubbles generated per run
START_MASS = 18.0          # player's starting radius-equivalent mass
ABSORB_RATIO = 0.28        # fraction of an eaten bubble's mass you gain
WIN_MASS = 140.0           # mass at which the run counts as a win
MIN_EAT_INTERVAL_MS = 90   # floor on time between two absorptions
MAX_RUN_MS = 20 * 60_000   # runs longer than 20 minutes are not accepted

# There is deliberately no separate "minimum run duration" constant. The floor
# on a win is already implied: a win needs N absorptions, each must be at least
# MIN_EAT_INTERVAL_MS after the previous one, and every event must fall within
# the reported duration — so duration >= N * MIN_EAT_INTERVAL_MS is enforced
# structurally. An independent constant on top of that is not a second layer of
# defence, it is a second source of truth, and an over-tight value silently
# rejects the fastest *honest* players. (It did exactly that at 4000ms: a clean
# run needs ~37 absorptions, i.e. ~3.3s at the permitted rate.)

# --- Reward policy --------------------------------------------------------
# A win grants allowance; the cap and cooldown are what keep it from being a
# renewable income stream. Tuned so a player can earn a meaningful trial run
# but not farm the service.
REWARD_PER_WIN = 3
BONUS_CAP = 9              # lifetime ceiling on arcade-earned allowance per IP
COOLDOWN_SECONDS = 6 * 3600

# Cap on how many real corpus fields ride inside the signed token. Bounded so a
# large corpus cannot inflate the token into an oversized request body.
OVERLAY_MAX_FIELDS = 20

TOKEN_TTL_SECONDS = MAX_RUN_MS // 1000 + 120
_SECRET = (ETH_ADMIN_PRIVATE_KEY or "scholarpi_arcade_seed").encode("utf-8")

# The domains a bubble can belong to. Kept here rather than derived from the
# live database so the game is playable on a fresh install with no papers in
# it, and so the client and server agree without an extra round trip.
DOMAINS = [
    "Physics", "Chemistry", "Biology", "Medicine", "Neuroscience",
    "Computer Science", "Mathematics", "Materials", "Climate", "Genomics",
    "Astronomy", "Economics", "Psychology", "Engineering", "Ecology",
]


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(payload: str) -> str:
    return _b64(hmac.new(_SECRET, payload.encode("utf-8"), hashlib.sha256).digest())


class _Rng:
    """Deterministic PRNG shared with the client.

    A 32-bit xorshift, chosen because it is trivial to reimplement identically
    in JavaScript — Python's ``random`` and JS's ``Math.random`` cannot be made
    to agree, and the whole verification scheme depends on both sides
    generating byte-identical bubble fields from the same seed.
    """

    __slots__ = ("state",)

    def __init__(self, seed: int):
        self.state = seed & 0xFFFFFFFF or 0x9E3779B9

    def next_u32(self) -> int:
        x = self.state
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        self.state = x & 0xFFFFFFFF
        return self.state

    def next_float(self) -> float:
        return self.next_u32() / 0x100000000


def generate_field(seed: int, overlay: Optional[List] = None) -> List[Dict]:
    """Rebuilds the exact set of bubbles a given seed and corpus snapshot produce.

    Masses are drawn on a curve that guarantees a playable opening: the first
    handful of bubbles are always smaller than ``START_MASS`` so the player is
    never spawned into a field it cannot bite into, while the tail grows large
    enough that reaching ``WIN_MASS`` requires actually working up the ladder.

    ``overlay`` is the live corpus snapshot — ``[[field_name, paper_count], …]``
    — which grows the bubbles for fields that actually contain assessed papers,
    and appends bubbles for real fields outside the default taxonomy. This is
    what fuses the game with the map: the thing you are eating is the operator's
    real body of work, not decoration.

    Critically, the overlay is passed in rather than read from the database
    here. The database changes while people are playing; if verification
    re-read it, a paper assessed mid-run would rebuild a different field and
    reject an honest player. The snapshot is captured once at ``start_session``
    and travels inside the signed token, so the field is frozen for the life of
    the run while staying live from run to run.
    """
    overlay = overlay or []
    weights = {}
    for entry in overlay:
        try:
            weights[str(entry[0])] = int(entry[1])
        except (IndexError, TypeError, ValueError):
            continue

    # Domain list = default taxonomy, plus any real field the corpus contains
    # that isn't already in it. Sorted so the ordering is deterministic.
    domains = list(DOMAINS)
    for name in sorted(weights):
        if name not in domains:
            domains.append(name)

    busiest = max(weights.values()) if weights else 0

    rng = _Rng(seed)
    field = []
    for i in range(FIELD_SIZE):
        # Progression factor: early bubbles small, late bubbles large.
        t = i / max(1, FIELD_SIZE - 1)
        base = 6.0 + (t ** 1.6) * 78.0
        jitter = 0.7 + rng.next_float() * 0.6
        domain = domains[rng.next_u32() % len(domains)]

        # A field carrying real papers is visibly heavier, scaled against the
        # busiest field so the map is readable whether the corpus holds three
        # papers or three thousand. Capped at +60% so a single dominant field
        # cannot make the game unwinnable.
        papers = weights.get(domain, 0)
        boost = 1.0 + (0.6 * (papers / busiest)) if busiest else 1.0
        mass = round(base * jitter * boost, 3)

        field.append({
            "id": i,
            "mass": mass,
            "domain": domain,
            "papers": papers,
            "live": papers > 0,
            "x": round(rng.next_float(), 5),
            "y": round(rng.next_float(), 5),
            "vx": round((rng.next_float() - 0.5) * 0.00035, 8),
            "vy": round((rng.next_float() - 0.5) * 0.00035, 8),
        })
    return field


def build_overlay(corpus_stats: Optional[List[Dict]] = None) -> List:
    """Compacts corpus stats into the minimal form the token can carry.

    Only the field name and paper count survive: those are the two inputs
    ``generate_field`` needs, and keeping the payload small keeps the signed
    token short enough to sit comfortably in a JSON body.
    """
    overlay = []
    for row in (corpus_stats or [])[:OVERLAY_MAX_FIELDS]:
        name = str(row.get("field", "")).strip()[:48]
        if not name:
            continue
        try:
            overlay.append([name, int(row.get("papers", 0))])
        except (TypeError, ValueError):
            continue
    return overlay


def start_session(ip: str, corpus_stats: Optional[List[Dict]] = None) -> Dict:
    """Issues a signed seed plus corpus snapshot the server can later replay."""
    seed = secrets.randbelow(0xFFFFFFFF) or 0x9E3779B9
    issued_at = int(time.time())
    overlay = build_overlay(corpus_stats)
    payload = json.dumps(
        {"seed": seed, "t": issued_at,
         "ip": hashlib.sha256((ip or "").encode()).hexdigest()[:16],
         "ov": overlay},
        separators=(",", ":"), sort_keys=True,
    )
    encoded = _b64(payload.encode("utf-8"))
    field = generate_field(seed, overlay)

    # Legend rows carry the analytics the map UI needs (paper counts, mean piX)
    # but that the *game* must not depend on. They travel outside the signed
    # token deliberately: they do not affect bubble mass, so they cannot change
    # what a run verifies to, and keeping them out keeps the token small.
    stats_by_field = {}
    for row in (corpus_stats or []):
        name = str(row.get("field", "")).strip()
        if name:
            stats_by_field[name] = row
    legend = []
    for name in sorted({b["domain"] for b in field}):
        row = stats_by_field.get(name)
        legend.append({
            "field": name,
            "papers": int(row.get("papers", 0)) if row else 0,
            "avg_score": float(row.get("avg_score", 0.0)) if row else None,
            "authors": list(row.get("authors") or []) if row else [],
        })
    legend.sort(key=lambda r: (-r["papers"], r["field"]))

    authors = sorted({a for r in legend for a in r["authors"]})

    return {
        "token": f"{encoded}.{_sign(encoded)}",
        "seed": seed,
        "field": field,
        "legend": legend,
        "authors": authors,
        "corpus": {
            "fields_with_papers": sum(1 for b in field if b["live"]),
            "total_papers": sum(int(e[1]) for e in overlay),
            "is_empty": not overlay,
        },
        "rules": {
            "start_mass": START_MASS,
            "absorb_ratio": ABSORB_RATIO,
            "win_mass": WIN_MASS,
            "field_size": FIELD_SIZE,
        },
        "reward": {
            "per_win": REWARD_PER_WIN,
            "cap": BONUS_CAP,
            "cooldown_hours": COOLDOWN_SECONDS // 3600,
        },
    }


def _decode_token(ip: str, token: str) -> Tuple[Optional[Tuple[int, List]], Optional[str]]:
    """Returns ``((seed, overlay), error)``.

    A tampered or stale token yields an error. The overlay is recovered from
    the signed payload, so the field is rebuilt exactly as it was issued even
    if the corpus has changed since — the signature covers it, so a client
    cannot substitute a weaker overlay to make bubbles easier to eat.
    """
    if not token or "." not in token:
        return None, "Malformed game token."
    encoded, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(signature, _sign(encoded)):
        return None, "Game token signature is invalid."
    try:
        payload = json.loads(_unb64(encoded).decode("utf-8"))
    except Exception:
        return None, "Game token could not be decoded."

    issued_at = int(payload.get("t", 0))
    if time.time() - issued_at > TOKEN_TTL_SECONDS:
        return None, "This game session expired. Start a new run."
    expected_ip = hashlib.sha256((ip or "").encode()).hexdigest()[:16]
    if payload.get("ip") != expected_ip:
        return None, "This game session belongs to a different client."
    overlay = payload.get("ov") or []
    if not isinstance(overlay, list):
        return None, "Game token payload is malformed."
    return (int(payload["seed"]), overlay), None


def verify_run(ip: str, token: str, absorbed: List[Dict], duration_ms: int) -> Dict:
    """Replays a submitted run against the server's own field.

    ``absorbed`` is the ordered list of ``{"id": int, "t": ms}`` the client
    claims it ate. The return value reports whether the run is valid, whether
    it won, and the final mass the server computed — the client's own score is
    never read.
    """
    decoded, error = _decode_token(ip, token)
    if error:
        return {"valid": False, "won": False, "reason": error}
    seed, overlay = decoded

    if not isinstance(absorbed, list):
        return {"valid": False, "won": False, "reason": "Run data is malformed."}
    if len(absorbed) > FIELD_SIZE:
        return {"valid": False, "won": False, "reason": "Run absorbed more bubbles than exist."}
    try:
        duration_ms = int(duration_ms)
    except (TypeError, ValueError):
        return {"valid": False, "won": False, "reason": "Run duration is malformed."}
    if duration_ms <= 0 or duration_ms > MAX_RUN_MS:
        return {"valid": False, "won": False, "reason": "Run duration is out of range."}

    field = {b["id"]: b for b in generate_field(seed, overlay)}
    mass = START_MASS
    seen = set()
    last_t = -MIN_EAT_INTERVAL_MS

    for step in absorbed:
        if not isinstance(step, dict):
            return {"valid": False, "won": False, "reason": "Run data is malformed."}
        try:
            bid = int(step.get("id"))
            t = int(step.get("t"))
        except (TypeError, ValueError):
            return {"valid": False, "won": False, "reason": "Run data is malformed."}

        bubble = field.get(bid)
        if bubble is None:
            return {"valid": False, "won": False, "reason": "Run referenced a bubble that does not exist."}
        if bid in seen:
            return {"valid": False, "won": False, "reason": "Run absorbed the same bubble twice."}
        if t < last_t + MIN_EAT_INTERVAL_MS:
            return {"valid": False, "won": False, "reason": "Run absorbed bubbles faster than is possible."}
        if t > duration_ms:
            return {"valid": False, "won": False, "reason": "Run event occurred after the run ended."}
        # The core rule: you can only eat something smaller than you are.
        if bubble["mass"] >= mass:
            return {"valid": False, "won": False,
                    "reason": "Run absorbed a bubble larger than the player."}

        seen.add(bid)
        last_t = t
        mass += bubble["mass"] * ABSORB_RATIO

    won = mass >= WIN_MASS
    return {
        "valid": True,
        "won": won,
        "final_mass": round(mass, 2),
        "absorbed": len(seen),
        "win_mass": WIN_MASS,
        "duration_ms": duration_ms,
    }


def cooldown_remaining(last_award: Optional[str]) -> int:
    """Seconds left before this IP may earn another reward. 0 when ready."""
    if not last_award:
        return 0
    from datetime import datetime, timezone
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            ts = datetime.strptime(str(last_award), fmt).replace(tzinfo=timezone.utc)
            break
        except ValueError:
            continue
    else:
        return 0
    elapsed = (datetime.now(timezone.utc) - ts).total_seconds()
    return max(0, int(COOLDOWN_SECONDS - elapsed))
