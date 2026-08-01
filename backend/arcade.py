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
# A win grants allowance; the lifetime cap and the difficulty ramp are what
# keep it from being a renewable income stream. There is deliberately no time
# cooldown: making a player who has already won wait out a clock punishes the
# fastest honest players and does nothing the cap does not already do.
REWARD_PER_WIN = 3
BONUS_CAP = 9              # lifetime ceiling on arcade-earned allowance per IP
COOLDOWN_SECONDS = 0       # retained for API shape; no time limit is enforced
PIQ_PER_WIN = 1.0          # piQ credited to a signed-in player for a verified win

# --- Difficulty ramp ------------------------------------------------------
# Each win makes the next run harder, until winning becomes arithmetically
# impossible; assessing a manuscript resets the ramp to zero.
#
# The point is not to frustrate. The arcade exists to hand out assessment
# allowance, and an unbounded win loop is an unbounded allowance faucet — the
# lifetime cap alone handles the economics, but it does so by silently
# refusing rewards, which reads as the game being broken. A ramp that visibly
# tightens, and a reset that is earned by doing the thing the site is FOR, is
# an honest exchange rather than a hidden ceiling.
#
# Difficulty is derived from a level integer and carried inside the signed
# token, so the server replays each run against exactly the parameters the
# client was given. It cannot be edited in the browser, and a token issued at
# level 2 can never be verified as though it were level 0.
DIFFICULTY_WIN_STEP = 1.18     # retained for API shape; the win is now clearing
DIFFICULTY_ABSORB_STEP = 0.88  # absorb efficiency multiplier per level
# The real difficulty lever, now that winning means clearing the field rather
# than passing a mass threshold. Raising the top of the mass ladder makes the
# largest fields harder to grow into: at some level the greedy optimum stalls
# with bubbles still standing, and that level is genuinely unwinnable.
# Absorb decay alone could not do this — with ninety bubbles the ladder steps
# are small enough that even a poor ratio compounds all the way to the top.
DIFFICULTY_SPREAD_STEP = 1.16  # heaviest-bubble multiplier per level
MAX_DIFFICULTY_LEVEL = 12      # hard ceiling; unwinnable well before this


def difficulty_params(level: int) -> Dict:
    """Game constants for a difficulty level."""
    level = max(0, min(int(level or 0), MAX_DIFFICULTY_LEVEL))
    return {
        "level": level,
        "win_mass": round(WIN_MASS * (DIFFICULTY_WIN_STEP ** level), 2),
        "absorb_ratio": round(ABSORB_RATIO * (DIFFICULTY_ABSORB_STEP ** level), 5),
        "start_mass": START_MASS,
        "field_size": FIELD_SIZE,
        "spread": round(DIFFICULTY_SPREAD_STEP ** level, 5),
    }


def optimal_run(seed: int, overlay: Optional[List], level: int) -> Dict:
    """Replay the optimal strategy: eat ascending, repeatedly, while you can.

    Repeatedly matters. Eating in one ascending pass under-counts, because a
    bubble too large early becomes edible once the player has grown on smaller
    ones. The loop keeps sweeping until a full pass absorbs nothing, which is
    the true fixed point of the greedy strategy and therefore the real upper
    bound on what a perfect run can clear.
    """
    params = difficulty_params(level)
    bubbles = sorted(generate_field(seed, overlay, level), key=lambda b: b["mass"])
    mass = params["start_mass"]
    eaten = set()
    progress = True
    while progress:
        progress = False
        for b in bubbles:
            if b["id"] in eaten or b["mass"] >= mass:
                continue
            mass += b["mass"] * params["absorb_ratio"]
            eaten.add(b["id"])
            progress = True
    return {"mass": round(mass, 2), "absorbed": len(eaten), "total": len(bubbles),
            "clears": len(eaten) == len(bubbles)}


def max_attainable_mass(seed: int, overlay: Optional[List], level: int) -> float:
    """Upper bound on the mass a perfect run could reach on this field."""
    return optimal_run(seed, overlay, level)["mass"]


def is_winnable(seed: int, overlay: Optional[List], level: int) -> bool:
    """Whether the whole field can be cleared.

    The win condition is now clearing the map, not passing a mass threshold —
    so winnability has to ask the same question. A field where the greedy
    optimum stalls with bubbles left standing is unwinnable however much mass
    the player accumulates, and the UI says so rather than letting someone
    grind at something arithmetically impossible.
    """
    return optimal_run(seed, overlay, level)["clears"]


# Cap on how many real corpus fields ride inside the signed token. Bounded so a
# large corpus cannot inflate the token into an oversized request body.
OVERLAY_MAX_FIELDS = 20

TOKEN_TTL_SECONDS = MAX_RUN_MS // 1000 + 120
_SECRET = (ETH_ADMIN_PRIVATE_KEY or "scholarpi_arcade_seed").encode("utf-8")

# Bubbles are labelled ONLY with fields the assessed corpus actually contains.
#
# There used to be a fifteen-entry default taxonomy here — Physics, Chemistry,
# Neuroscience and so on — mixed into every field so the map looked populated
# on a fresh install. The cost of that was a map indistinguishable from a real
# one: a player inspecting "Astronomy" was shown a card with a map weight and a
# status, describing a field this deployment had never assessed a paper in. On
# a platform whose entire claim is that its numbers are auditable, a decorative
# taxonomy sitting in the same UI as real corpus counts is the wrong kind of
# filler.
#
# An empty corpus now yields an honestly empty map, which the client already
# has a state for (`corpus.is_empty`).
UNASSIGNED = "Unassigned"


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


def generate_field(seed: int, overlay: Optional[List] = None,
                   level: int = 0) -> List[Dict]:
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
    weights, domains_of = {}, {}
    for entry in overlay:
        try:
            name = str(entry[0])
            weights[name] = int(entry[1])
            # Third element is the parent domain, added so bubbles can be
            # coloured by discipline rather than by an arbitrary hash. Older
            # tokens carry only two elements and still decode.
            domains_of[name] = str(entry[2]) if len(entry) > 2 and entry[2] else UNASSIGNED
        except (IndexError, TypeError, ValueError):
            continue

    fields = sorted(weights)
    if not fields:
        # Empty corpus: one unlabelled field, so the map is visibly empty
        # rather than plausibly populated.
        fields = [UNASSIGNED]
        weights = {UNASSIGNED: 0}
        domains_of = {UNASSIGNED: UNASSIGNED}

    # --- How many bubbles each field gets -------------------------------
    # Proportional to its share of the corpus, with a floor of one so every
    # assessed field is visible however small. Bubble COUNT is share of the
    # corpus; bubble SIZE is the field's weight. Both come from paper counts,
    # neither from the RNG.
    total_papers = sum(weights.values())
    quota = []
    for name in fields:
        if total_papers > 0:
            share = weights[name] / total_papers
            n = max(1, int(round(share * FIELD_SIZE)))
        else:
            n = max(1, FIELD_SIZE // len(fields))
        quota.append([name, n])

    # Reconcile rounding against FIELD_SIZE exactly, largest field absorbing
    # the slack. The field must be exactly FIELD_SIZE bubbles or verification
    # and the client disagree about what exists.
    allocated = sum(n for _, n in quota)
    if allocated != FIELD_SIZE and quota:
        biggest = max(range(len(quota)), key=lambda i: (weights[quota[i][0]], quota[i][0]))
        quota[biggest][1] = max(1, quota[biggest][1] + (FIELD_SIZE - allocated))
        allocated = sum(n for _, n in quota)
        while allocated > FIELD_SIZE:                 # trim from the largest
            for q in sorted(quota, key=lambda q: -q[1]):
                if allocated == FIELD_SIZE:
                    break
                if q[1] > 1:
                    q[1] -= 1
                    allocated -= 1

    # --- Mass ladder, ordered by paper count ----------------------------
    # Every slot on the ladder is assigned to a field in ascending order of
    # papers, so a field with more assessed work is systematically a bigger,
    # heavier bubble. Size is now a reading of the corpus rather than an
    # RNG draw with a small paper-count nudge on top.
    #
    # The ladder itself is retained because it is what keeps the game
    # playable: the smallest bubbles must sit below START_MASS or the player
    # spawns unable to eat anything, and the largest must be reachable only
    # after real growth.
    slots = []
    for name, n in quota:
        slots.extend([name] * n)
    slots.sort(key=lambda name: (weights.get(name, 0), name))

    busiest = max(weights.values()) if weights else 0
    # Difficulty stretches the ladder rather than shifting it: the smallest
    # bubbles stay below START_MASS so the player can always begin, while the
    # heaviest grow out of reach. That is what makes a high level hard and
    # eventually impossible, in a way the player can see on the map.
    spread = DIFFICULTY_SPREAD_STEP ** max(0, min(int(level or 0), MAX_DIFFICULTY_LEVEL))
    rng = _Rng(seed)
    field = []
    for i, name in enumerate(slots[:FIELD_SIZE]):
        t = i / max(1, FIELD_SIZE - 1)
        base = 6.0 + (t ** 1.6) * 78.0 * spread
        # Jitter is now small and cosmetic — enough to stop the map looking
        # like a bar chart, never enough to reorder two fields by size.
        jitter = 0.94 + rng.next_float() * 0.12
        papers = weights.get(name, 0)
        boost = 1.0 + (0.35 * (papers / busiest)) if busiest else 1.0
        mass = round(base * jitter * boost, 3)

        field.append({
            "id": i,
            "mass": mass,
            "domain": name,                       # the field itself
            "parent": domains_of.get(name, UNASSIGNED),   # its discipline
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

    Field name, paper count and parent domain survive: the first two size the
    bubbles, the third colours them by discipline. Everything else is dropped
    to keep the signed token small enough to sit in a JSON body.
    """
    overlay = []
    for row in (corpus_stats or [])[:OVERLAY_MAX_FIELDS]:
        name = str(row.get("field", "")).strip()[:48]
        if not name:
            continue
        try:
            overlay.append([name, int(row.get("papers", 0)),
                            str(row.get("domain") or "")[:40]])
        except (TypeError, ValueError):
            continue
    return overlay


def start_session(ip: str, corpus_stats: Optional[List[Dict]] = None,
                  corpus_totals: Optional[Dict] = None, level: int = 0) -> Dict:
    """Issues a signed seed plus corpus snapshot the server can later replay."""
    seed = secrets.randbelow(0xFFFFFFFF) or 0x9E3779B9
    issued_at = int(time.time())
    overlay = build_overlay(corpus_stats)
    params = difficulty_params(level)
    # The level is inside the signature. A client cannot replay a level-3 run
    # as though it were level 0 to claim an easier win threshold, and cannot
    # edit its own difficulty down between being issued a field and submitting
    # a result.
    payload = json.dumps(
        {"seed": seed, "t": issued_at,
         "ip": hashlib.sha256((ip or "").encode()).hexdigest()[:16],
         "ov": overlay, "d": params["level"]},
        separators=(",", ":"), sort_keys=True,
    )
    encoded = _b64(payload.encode("utf-8"))
    field = generate_field(seed, overlay, params["level"])

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
            # Domain and subfields come straight from the assessed corpus's
            # own classification, so the map describes what has actually been
            # assessed rather than a decorative taxonomy.
            "domain": (row.get("domain") or "Unassigned") if row else "Unassigned",
            "subfields": list(row.get("subfields") or []) if row else [],
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
        # Paper counts come from counting papers, never from summing per-field
        # rows: a paper tagged with three fields appears in three of them.
        "corpus": {
            "fields_with_papers": sum(1 for b in field if b["live"]),
            "total_papers": int((corpus_totals or {}).get("papers", 0)),
            "classified_papers": int((corpus_totals or {}).get("classified", 0)),
            "unclassified_papers": int((corpus_totals or {}).get("unclassified", 0)),
            "is_empty": not (corpus_totals or {}).get("papers", 0),
        },
        # The client renders and plays with these; the server replays with the
        # same values derived from the signed level, so they cannot diverge.
        "rules": {
            "start_mass": params["start_mass"],
            "absorb_ratio": params["absorb_ratio"],
            "win_mass": params["win_mass"],
            "field_size": params["field_size"],
        },
        "difficulty": {
            "level": params["level"],
            "base_win_mass": WIN_MASS,
            "winnable": is_winnable(seed, overlay, params["level"]),
            "max_attainable": max_attainable_mass(seed, overlay, params["level"]),
        },
        "reward": {
            "per_win": REWARD_PER_WIN,
            "cap": BONUS_CAP,
            "cooldown_hours": COOLDOWN_SECONDS // 3600,
        },
    }


def _decode_token(ip: str, token: str) -> Tuple[Optional[Tuple[int, List, int]], Optional[str]]:
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
    # An older token with no "d" predates the difficulty ramp; treating it as
    # level 0 keeps sessions that were in flight during a deploy playable
    # rather than rejecting them with a signature-looking error.
    return (int(payload["seed"]), overlay, int(payload.get("d", 0))), None


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
    seed, overlay, level = decoded
    params = difficulty_params(level)

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

    field = {b["id"]: b for b in generate_field(seed, overlay, level)}
    mass = params["start_mass"]
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
        mass += bubble["mass"] * params["absorb_ratio"]

    # The run is won by clearing the field. A mass threshold ended the game
    # while most of the corpus was still on screen, which made "absorb the map"
    # the stated goal and "reach 140" the actual one. Every bubble must go.
    won = len(seen) == FIELD_SIZE
    return {
        "valid": True,
        "won": won,
        "final_mass": round(mass, 2),
        "absorbed": len(seen),
        "win_mass": params["win_mass"],
        "difficulty_level": params["level"],
        "winnable": is_winnable(seed, overlay, params["level"]),
        "duration_ms": duration_ms,
    }


def cooldown_remaining(last_award: Optional[str]) -> int:
    """Always 0: rewards are no longer time-limited.

    The waiting period is gone. What stops an arcade win from being a renewable
    income stream is now the lifetime ``BONUS_CAP`` plus the difficulty ramp,
    both of which bite on the *number* of wins rather than the clock — so a
    player who wins twice in a minute is treated the same as one who spaced the
    wins six hours apart, which is the honest reading of the same achievement.

    The function is kept (rather than deleted) so callers, the API shape and
    the client's `cooldown_remaining` field all stay valid.
    """
    return 0
