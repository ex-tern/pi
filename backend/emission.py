"""
piQ emission policy — minting difficulty that rises with adoption.

Motivation
----------
A flat reward of ``piX / 10`` per accepted manuscript has no scarcity: the
hundred-thousandth paper earns exactly what the first did. That has two bad
consequences. Supply grows without bound, so piQ steadily loses meaning as a
signal of contribution. And early contributors — who took the risk of using an
unproven system — are diluted by later ones at no disadvantage.

This module makes piQ progressively harder to earn as the corpus grows, using
three independent mechanisms that compose multiplicatively.

1. Halving schedule (supply-side)
   Emission halves each time the corpus reaches a new halving interval. This
   is the Bitcoin-style mechanism: predictable, transparent, and computable in
   advance by anyone. Total supply converges to a finite bound.

2. Rising quality bar (demand-side)
   The minimum piX required to mint at all rises as the corpus grows, toward a
   ceiling. Early on, a competent paper qualifies. Later, a paper must be good
   relative to what the corpus has already demonstrated is achievable. This is
   the mechanism that actually makes piQ *hard* rather than merely *scarce* —
   scarcity alone would just mean everyone earns less for the same work.

3. Per-author diminishing returns
   An author's own emission decays with the number of papers they have already
   had assessed. Without this, a prolific submitter could farm the system by
   volume, which is precisely the behaviour a research-quality metric should
   not reward. It also protects against one lab dominating the leaderboard.

Everything here is deterministic and published: `emission_manifest()` exposes
the full schedule so a researcher can see exactly where the system is and what
happens next. A difficulty curve nobody can inspect is indistinguishable from
an arbitrary one.
"""
import math
from typing import Dict, Optional

# --- Halving ---------------------------------------------------------------
# Corpus size at which emission halves.
#
# The first calibration was far too aggressive: a 500-paper interval with 8
# halvings meant emission fell to 1/256 by 4,000 papers, so a strong paper
# minted 0.035 piQ. That is scarcity long before the platform has enough
# adoption to justify it, and it made the system feel punitive rather than
# selective. The interval is now 2,500 with 4 halvings, so the floor is 1/16
# and is not reached until roughly 10,000 assessed papers.
HALVING_INTERVAL = 2500         # papers per halving epoch
MAX_HALVINGS = 4                # floor: emission never drops below 1/16

# --- Base emission ---------------------------------------------------------
# piQ = piX / 5 at genesis, so a strong paper (piX 80) mints 16 piQ rather
# than 8. Generous early adoption is the point: piQ has to be earnable before
# scarcity means anything.
BASE_DIVISOR = 5.0

# --- Quality bar -----------------------------------------------------------
# Starts low enough that a competent paper qualifies, and rises slowly. The
# previous 50 -> 75 over 2,000 papers excluded solid work almost immediately.
FLOOR_PIX_INITIAL = 40.0        # minimum piX to mint, at genesis
FLOOR_PIX_CEILING = 62.0        # asymptotic maximum for that minimum
FLOOR_GROWTH_SCALE = 12000.0    # corpus size over which the bar approaches its ceiling
LOGIC_FLOOR = 35.0              # logic integrity gate; a validity check, not difficulty

# --- Per-author decay ------------------------------------------------------
# Decay exists to stop volume farming, not to punish productive researchers.
# A 12-paper halflife penalised a normal publication record; 50 with a 0.5
# floor means a prolific author still earns at least half rate.
AUTHOR_DECAY_HALFLIFE = 50.0    # papers, per author, per halving of their own rate
AUTHOR_MIN_FACTOR = 0.50        # never below half, so contribution always pays


def current_halving_epoch(total_papers: int) -> int:
    """Which halving epoch the corpus is currently in (0 = genesis)."""
    if total_papers < 0:
        return 0
    return min(MAX_HALVINGS, int(total_papers // HALVING_INTERVAL))


def compute_supply_factor(total_papers: int) -> float:
    """Emission multiplier from the halving schedule."""
    return 0.5 ** current_halving_epoch(total_papers)


def compute_quality_threshold(total_papers: int) -> float:
    """Minimum piX required to mint, rising asymptotically with corpus size.

    Saturating exponential rather than linear: the bar rises quickly while the
    corpus is small and evidence is thin, then flattens, so it can never become
    unreachable no matter how large the corpus grows.
    """
    if total_papers <= 0:
        return FLOOR_PIX_INITIAL
    progress = 1.0 - math.exp(-total_papers / FLOOR_GROWTH_SCALE)
    return round(FLOOR_PIX_INITIAL + (FLOOR_PIX_CEILING - FLOOR_PIX_INITIAL) * progress, 3)


def compute_author_decay_factor(author_paper_count: int) -> float:
    """Diminishing returns on an author's own accumulated output."""
    if author_paper_count <= 0:
        return 1.0
    factor = 0.5 ** (author_paper_count / AUTHOR_DECAY_HALFLIFE)
    return round(max(AUTHOR_MIN_FACTOR, factor), 6)


def compute_piq_emission(pix_score: float, logic_integrity: float, total_papers: int,
                     author_paper_count: int = 0) -> Dict:
    """Decide how much piQ this manuscript mints, and explain the decision.

    Returns the amount plus every factor that produced it, so the result is
    auditable rather than an unexplained number.
    """
    try:
        pix = float(pix_score)
        logic = float(logic_integrity)
    except (TypeError, ValueError):
        pix, logic = 0.0, 0.0

    # Defensive clamp. The rubric bounds piX to [0, 100] by construction, but
    # emission is the one place where an out-of-range value would translate
    # directly into unbounded token supply. Never trust an upstream bound when
    # the downstream consequence is minting.
    if pix != pix:  # NaN
        pix = 0.0
    if logic != logic:
        logic = 0.0
    pix = max(0.0, min(100.0, pix))
    logic = max(0.0, min(100.0, logic))
    total_papers = max(0, int(total_papers or 0))
    author_paper_count = max(0, int(author_paper_count or 0))

    floor = compute_quality_threshold(total_papers)
    epoch = current_halving_epoch(total_papers)
    supply = compute_supply_factor(total_papers)
    author_mult = compute_author_decay_factor(author_paper_count)

    reasons = []
    minted = 0.0
    qualified = True

    if logic < LOGIC_FLOOR:
        qualified = False
        reasons.append(
            f"Logic integrity {logic:.1f} is below the required {LOGIC_FLOOR:.0f}. This is a "
            f"validity gate, not a difficulty setting: it does not move with adoption."
        )
    if pix < floor:
        qualified = False
        reasons.append(
            f"piX {pix:.1f} is below the current minting threshold of {floor:.1f}. That threshold "
            f"began at {FLOOR_PIX_INITIAL:.0f} and has risen with the size of the assessed corpus "
            f"({total_papers} papers), so qualifying now requires stronger work than it did earlier."
        )

    if qualified:
        base = pix / BASE_DIVISOR
        minted = round(base * supply * author_mult, 4)
        reasons.append(
            f"Base emission {base:.3f} piQ (piX {pix:.1f} / {BASE_DIVISOR:.0f}), scaled by the "
            f"halving factor {supply:.4f} (epoch {epoch} of at most {MAX_HALVINGS}) and the "
            f"author factor {author_mult:.4f} ({author_paper_count} prior paper(s))."
        )

    papers_to_next = None
    if epoch < MAX_HALVINGS:
        papers_to_next = ((epoch + 1) * HALVING_INTERVAL) - total_papers

    return {
        "minted": minted,
        "qualified": qualified,
        "pix": round(pix, 3),
        "logic_integrity": round(logic, 3),
        "quality_floor": floor,
        "logic_floor": LOGIC_FLOOR,
        "halving_epoch": epoch,
        "supply_factor": round(supply, 6),
        "author_factor": author_mult,
        "author_paper_count": author_paper_count,
        "corpus_size": total_papers,
        "papers_until_next_halving": papers_to_next,
        "effective_rate": round((supply * author_mult) / BASE_DIVISOR, 6),
        "reasons": reasons,
    }


# --- Processing fee -------------------------------------------------------
# The fee must track emission, or the economy stalls. Held flat at 0.1 piQ, it
# would exceed what even a perfect paper mints from epoch 5 onward: every user
# would spend faster than they could earn, and participation would end — not
# because the work got worse, but because the accounting became incoherent.
# Scaling the fee by the same halving factor keeps the ratio of cost to reward
# constant, so difficulty rises in absolute terms while the system stays usable.
BASE_FEE = 0.1
MIN_FEE = 0.001


def compute_processing_fee(total_papers: int, base_fee: float = BASE_FEE) -> float:
    """Processing fee at the corpus's current difficulty."""
    try:
        base = float(base_fee)
    except (TypeError, ValueError):
        base = BASE_FEE
    return round(max(MIN_FEE, base * compute_supply_factor(total_papers)), 6)


def fee_manifest(total_papers: int, base_fee: float = BASE_FEE) -> Dict:
    fee = compute_processing_fee(total_papers, base_fee)
    # What a paper exactly at the qualifying threshold nets after the fee.
    floor_pix = compute_quality_threshold(total_papers)
    marginal = (floor_pix / BASE_DIVISOR) * compute_supply_factor(total_papers)
    return {
        "fee": fee,
        "base_fee": base_fee,
        "supply_factor": round(compute_supply_factor(total_papers), 6),
        "marginal_paper_mints": round(marginal, 6),
        "marginal_paper_nets": round(marginal - fee, 6),
        "sustainable": marginal > fee,
        "note": (
            f"The fee scales with the same halving factor as emission, so a paper that just "
            f"clears the {floor_pix:.1f} piX threshold still nets "
            f"{marginal - fee:+.4f} piQ. Without this, a flat fee would exceed emission entirely "
            f"at high corpus sizes and the economy would stall."
        ),
    }


def theoretical_max_supply() -> float:
    """Upper bound on total piQ, assuming every paper scores a perfect 100.

    Each epoch emits at most HALVING_INTERVAL papers x 10 piQ x its factor.
    The geometric series converges, then the final uncapped epoch continues at
    the floor rate — so this is a bound on the *pre-floor* portion, reported
    for transparency rather than as a hard cap.
    """
    per_epoch_max = HALVING_INTERVAL * (100.0 / BASE_DIVISOR)
    return round(sum(per_epoch_max * (0.5 ** e) for e in range(MAX_HALVINGS + 1)), 2)


def emission_manifest(total_papers: int = 0) -> Dict:
    """Publish the full emission policy and where the corpus currently sits."""
    epoch = current_halving_epoch(total_papers)
    schedule = []
    for e in range(MAX_HALVINGS + 1):
        start = e * HALVING_INTERVAL
        schedule.append({
            "epoch": e,
            "papers_from": start,
            "papers_to": None if e == MAX_HALVINGS else ((e + 1) * HALVING_INTERVAL) - 1,
            "supply_factor": round(0.5 ** e, 6),
            "piq_per_100_pix": round((100.0 / BASE_DIVISOR) * (0.5 ** e), 4),
            "quality_floor_at_start": compute_quality_threshold(start),
            "current": e == epoch,
        })
    return {
        "policy_version": "piq-emission/1.0",
        "corpus_size": total_papers,
        "current_epoch": epoch,
        "current_supply_factor": round(compute_supply_factor(total_papers), 6),
        "current_quality_floor": compute_quality_threshold(total_papers),
        "logic_floor": LOGIC_FLOOR,
        "halving_interval": HALVING_INTERVAL,
        "max_halvings": MAX_HALVINGS,
        "base_divisor": BASE_DIVISOR,
        "author_decay_halflife": AUTHOR_DECAY_HALFLIFE,
        "author_min_factor": AUTHOR_MIN_FACTOR,
        "theoretical_max_supply_pre_floor": theoretical_max_supply(),
        "schedule": schedule,
        "explanation": [
            "piQ becomes harder to earn as the platform grows, by three independent mechanisms.",
            f"Halving: emission halves every {HALVING_INTERVAL:,} assessed papers, for up to "
            f"{MAX_HALVINGS} halvings (a floor of 1/{2 ** MAX_HALVINGS} of the base rate).",
            f"Rising bar: the minimum piX needed to mint starts at {FLOOR_PIX_INITIAL:.0f} and "
            f"rises asymptotically toward {FLOOR_PIX_CEILING:.0f} as the corpus grows.",
            f"Author decay: an individual's emission halves roughly every "
            f"{AUTHOR_DECAY_HALFLIFE:.0f} papers they submit, floored at "
            f"{AUTHOR_MIN_FACTOR:.2f}, so piQ rewards quality rather than volume.",
            "Early contributors are therefore not diluted by later volume, and piQ remains a "
            "meaningful signal of contribution rather than of participation.",
        ],
    }
