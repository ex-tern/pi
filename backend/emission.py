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
# Calibration history, kept because this parameter has been wrong twice in
# opposite directions and the reasoning matters more than the numbers.
#
#   500 papers / 8 halvings  — far too aggressive. Emission fell to 1/256 by
#       4,000 papers, so a strong paper minted 0.035 piQ. Scarcity long before
#       the platform had adoption to justify it; punitive rather than selective.
#
#   2,500 papers / 4 halvings — too slow in the other direction. At the
#       corpus sizes this deployment will realistically see, the first halving
#       was unreachable, so the schedule was invisible: a mechanism nobody ever
#       observes is indistinguishable from one that does not exist.
#
#   250 papers / 10 halvings — current. The first halving arrives at a corpus
#       size that is actually attainable, so the schedule is something a
#       participant can watch happen, and there are enough epochs that each
#       step is a halving rather than a cliff.
#
# The trade-off is deliberate and worth stating: the floor of 1/1024 is
# reached at 2,500 papers, where a piX 60 manuscript mints about 0.012 piQ.
# That is *very* scarce. It is defensible only because the base rate stays
# generous early (piQ = piX / 5, so the same paper mints 12 piQ today) and
# because piQ's purpose is to record contribution, not to fund anything. If
# the intent ever becomes to keep piQ economically meaningful at scale, this
# is the constant to revisit — not the quality floor, which does different work.
# Widened from 250 to 1,000. At 250 the corpus crossed a halving every few
# weeks of modest use, so a researcher's second paper could mint half what
# their first did for no reason they could see or influence. Scarcity that
# arrives faster than a user can perceive the cause of reads as the system
# quietly breaking, not as a designed schedule.
HALVING_INTERVAL = 1000         # papers per halving epoch
MAX_HALVINGS = 10               # floor: emission never drops below 1/1024

# --- Base emission ---------------------------------------------------------
# piQ = piX / 5 at genesis, so a strong paper (piX 80) mints 16 piQ rather
# than 8. Generous early adoption is the point: piQ has to be earnable before
# scarcity means anything.
# Lowered from 5.0 to 4.0: a piX 80 paper now mints 20 piQ rather than 16, and
# a piX 40 paper 10 rather than 8. With a publication fee of ~1 piQ and an LLM
# review at 0.5, one qualifying paper should comfortably fund several actions
# on the platform — otherwise the currency records contribution in a unit too
# small to spend.
BASE_DIVISOR = 4.0

# --- Quality bar -----------------------------------------------------------
# Starts low enough that a competent paper qualifies, and rises slowly. The
# previous 50 -> 75 over 2,000 papers excluded solid work almost immediately.
FLOOR_PIX_INITIAL = 22.0        # minimum piX to mint, at genesis
FLOOR_PIX_CEILING = 55.0        # asymptotic maximum for that minimum
FLOOR_GROWTH_SCALE = 20000.0    # corpus size over which the bar approaches its ceiling

# The logic gate is a validity check, not a difficulty dial, so it is lowered
# with more care than the rest: it exists to stop internally incoherent work
# from minting at all. 35 was rejecting manuscripts whose logic score was
# depressed by extraction quality rather than by the argument — a scanned PDF
# or an unusual structure can cost a paper 15 points it did not deserve to
# lose. 22 still excludes genuinely incoherent submissions while no longer
# punishing papers for how well they happened to parse.
LOGIC_FLOOR = 22.0              # logic integrity gate; a validity check, not difficulty

# --- Per-author decay ------------------------------------------------------
# Decay exists to stop volume farming, not to punish productive researchers.
# A 12-paper halflife penalised a normal publication record; 50 with a 0.5
# floor means a prolific author still earns at least half rate.
# Widened from 50 to 120 papers, with the floor raised from 0.50 to 0.75. The
# decay is aimed at bulk submission, and a researcher with a normal career-long
# output should never feel it — at 120 they are still near full rate after
# dozens of papers, and never drop below three quarters.
AUTHOR_DECAY_HALFLIFE = 120.0   # papers, per author, per halving of their own rate
AUTHOR_MIN_FACTOR = 0.75        # never below three quarters, so contribution always pays


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


# --- New-participant grant -------------------------------------------------
# The economy was regressive: piQ funds assessment and is earned by scoring
# well, so the researchers most able to use the system were those already
# producing well-resourced work. A newcomer without institutional support —
# precisely the constituency CoARA and the open-science literature care about —
# hit the wall first and had no route out.
#
# Linking a verified ORCID now grants a one-time starting balance. It costs
# nothing real (piQ is minted, not bought), it is gated on a verified identity
# so it cannot be farmed, and it converts the free tier from a hard wall into
# an on-ramp.
NEW_PARTICIPANT_GRANT = 2.0


def onboarding_grant(base_fee: float = None) -> Dict:
    """One-time piQ grant for a newly verified identity."""
    fee = base_fee if base_fee is not None else BASE_FEE
    return {
        "amount": NEW_PARTICIPANT_GRANT,
        "covers_papers": int(NEW_PARTICIPANT_GRANT // fee) if fee > 0 else 0,
        "reason": "Verified-identity onboarding grant",
        "rationale": (
            "piQ is earned by having your own work assessed, which means a researcher new to the "
            "platform would otherwise be unable to participate at all after the free trial. This "
            "grant is one-time, requires a verified ORCID, and cannot be repeated."
        ),
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

# --- Size-proportional pricing ---------------------------------------------
# A flat per-paper fee charged a four-page note the same as an eighty-page
# monograph, while the second genuinely costs several times more inference —
# the assessment prompt is bounded, but extraction, reference verification and
# structural analysis all scale with the document.
#
# The fee therefore scales with length, with a floor of MINIMUM_FEE so a
# trivial submission still carries a real cost (that floor is what stops
# someone probing the system with one-page files for free), and a ceiling so a
# thesis cannot become unaffordable.
MINIMUM_FEE = 0.1               # never below this, whatever the size
FEE_CEILING_MULTIPLE = 5.0      # never more than 5x the minimum
BASELINE_WORDS = 6000.0         # a typical research article


def size_multiplier(word_count: int) -> float:
    """Fee multiplier for a document of this length.

    Sub-linear in length: cost grows with the document but a paper twice as
    long is not twice as expensive to assess, because the model prompt is
    truncated to a token budget while only the deterministic passes scale
    fully. A square-root curve matches that shape closely enough and is
    predictable enough to explain.
    """
    try:
        words = max(0, int(word_count or 0))
    except (TypeError, ValueError):
        words = 0
    if words <= 0:
        return 1.0
    ratio = words / BASELINE_WORDS
    return max(1.0, min(FEE_CEILING_MULTIPLE, math.sqrt(ratio)))


def compute_document_fee(word_count: int, total_papers: int = 0,
                         base_fee: float = None) -> Dict:
    """Fee for one manuscript: size-proportional, difficulty-scaled, floored."""
    difficulty_fee = compute_processing_fee(total_papers, base_fee)
    multiplier = size_multiplier(word_count)
    raw = difficulty_fee * multiplier
    fee = round(max(MINIMUM_FEE, raw), 4)

    words = max(0, int(word_count or 0))
    if words == 0:
        band = "unknown length"
    elif words < 2000:
        band = "short (under 2,000 words)"
    elif words < 10000:
        band = "standard article"
    elif words < 25000:
        band = "long article"
    else:
        band = "thesis or monograph"

    return {
        "fee": fee,
        "minimum": MINIMUM_FEE,
        "word_count": words,
        "size_band": band,
        "size_multiplier": round(multiplier, 3),
        "difficulty_fee": difficulty_fee,
        "at_minimum": fee <= MINIMUM_FEE + 1e-9,
        "explanation": (
            f"{fee:.4f} piQ for a {band} ({words:,} words). Longer documents cost more because "
            f"extraction, reference verification and structural analysis all scale with length. "
            f"The floor is {MINIMUM_FEE:.2f} piQ and the ceiling "
            f"{FEE_CEILING_MULTIPLE:.0f}x that."
            if words else
            f"{fee:.4f} piQ. Length was not known in advance, so the minimum fee applies."
        ),
    }


def compute_processing_fee(total_papers: int, base_fee: float = BASE_FEE) -> float:
    """Processing fee at the corpus's current difficulty."""
    try:
        base = float(base_fee)
    except (TypeError, ValueError):
        base = BASE_FEE
    return round(max(MIN_FEE, base * compute_supply_factor(total_papers)), 6)


def fee_manifest(total_papers: int, base_fee: float = BASE_FEE) -> Dict:
    fee = max(MINIMUM_FEE, compute_processing_fee(total_papers, base_fee))
    # What a paper exactly at the qualifying threshold nets after the fee.
    floor_pix = compute_quality_threshold(total_papers)
    marginal = (floor_pix / BASE_DIVISOR) * compute_supply_factor(total_papers)
    return {
        "fee": fee,
        "minimum_fee": MINIMUM_FEE,
        "size_scaled": True,
        "size_note": (
            f"This is the fee for a typical article. Longer documents cost proportionally more "
            f"(square-root of length, capped at {FEE_CEILING_MULTIPLE:.0f}x), never less than "
            f"{MINIMUM_FEE:.2f} piQ."
        ),
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


# ---------------------------------------------------------------------------
# Curation rewards
# ---------------------------------------------------------------------------
# Paying people to submit manuscripts they did not write is a growth lever, and
# it is also the fastest way to destroy the meaning of the thing being paid in.
# OpenAlex indexes hundreds of millions of open-access papers and this app has
# a discovery feature, so an uncapped submitter reward is a script away from
# being an infinite faucet. The per-author decay that normally prevents volume
# farming does not help here either: it is keyed to the PAPER's author, so
# someone submitting other people's work never accrues any decay at all.
#
# Curation is therefore paid as a deliberately different thing:
#
#   * Smaller — a fraction of what the same paper would have earned its author.
#   * Decaying per SUBMITTER, so the tenth submission is worth much less than
#     the first. This is the mechanism per-author decay cannot provide.
#   * Lifetime capped per identity, so the total exposure is bounded and
#     computable rather than open-ended.
#   * Identity gated, so farming costs a verified ORCID or wallet rather than
#     a fresh browser session.
#   * Credited to the piQ LEDGER, never minted on-chain. This is the important
#     one. On-chain piQ is soulbound and is claimed — in the app, in the
#     whitepaper — to record who did assessed work. Minting it for uploads
#     would make that claim false. Curation piQ is spendable service credit;
#     authored piQ is a record. Keeping them in separate places is what lets
#     both statements stay true, and keeps the leaderboard meaningful.
CURATION_SHARE = 0.15           # fraction of the authorship emission
CURATION_HALFLIFE = 5.0         # submissions before a curator earns half rate
CURATION_MIN_AWARD = 0.01       # below this, award nothing rather than dust

# There is deliberately no lifetime cap, and deliberately no decay floor.
#
# The two go together. Curation piQ is an unbacked credit — it is written into
# the ledger, not drawn from a reserve — so something has to bound how much any
# one identity can create. A hard cap did that with a wall: earn 12 piQ, then
# get told "no" forever, which is a bad experience precisely at the moment
# someone has proved they are a useful contributor.
#
# Removing the DECAY FLOOR does the same work without a wall. With the floor at
# 0.20 the reward never fell below a fifth of base, so the total grew without
# bound (44x base over 200 papers, and rising). With no floor the multiplier is
# a clean geometric 0.5^(n/5), and the lifetime total converges:
#
#     sum = 1 / (1 - 0.5^(1/5)) = 7.73 x the first paper's reward
#
# So a prolific curator's total is finite and computable, the tenth submission
# still pays something, and nobody is ever refused outright. The bound is a
# property of the schedule rather than a rule bolted on top of it.


def curation_decay(curation_count: int) -> float:
    """Multiplier for a curator who has already submitted `curation_count`.

    Unfloored, so the lifetime sum converges (see the note above).
    """
    n = max(0, int(curation_count or 0))
    return round(0.5 ** (n / CURATION_HALFLIFE), 6)


def compute_curation_reward(pix_score: float, logic_integrity: float,
                            total_papers: int, curation_count: int,
                            curation_earned: float) -> Dict:
    """What a submitter earns for a paper they did not author.

    Returns a full explanation whether or not anything is awarded, because
    "you earned nothing" is only actionable if it says why.
    """
    base = compute_piq_emission(
        pix_score=pix_score, logic_integrity=logic_integrity,
        total_papers=total_papers, author_paper_count=0,
    )

    decay = curation_decay(curation_count)
    amount = round(base["minted"] * CURATION_SHARE * decay, 4)

    if not base["qualified"]:
        return {"awarded": 0.0, "eligible": False, "decay": decay,
                "reason": ("This paper did not meet the quality threshold, so it earns no "
                           "curation reward. " + base.get("reason", ""))}
    if amount < CURATION_MIN_AWARD:
        return {"awarded": 0.0, "eligible": False, "decay": decay,
                "reason": ("The curation reward for this paper rounds to zero — your curation "
                           "rate has decayed with the number of papers you have submitted. "
                           "Having your own work assessed is unaffected.")}

    return {
        "awarded": amount,
        "eligible": True,
        "decay": decay,
        "base_emission": base["minted"],
        "share": CURATION_SHARE,
        "curation_count": int(curation_count or 0),
        "earned_to_date": round(float(curation_earned or 0.0), 4),
        "reason": (
            f"Curation reward: {amount:.4f} piQ. This is {CURATION_SHARE * 100:.0f}% of the "
            f"{base['minted']:.3f} piQ the paper would have earned its author, reduced to "
            f"{decay * 100:.0f}% by your curation decay ({int(curation_count or 0)} previous "
            f"submissions). Curation piQ is credited to your spendable balance; it is not "
            f"minted on-chain and does not count toward the piQ leaderboard, which records "
            f"authored work only."
        ),
    }


def curation_manifest() -> Dict:
    """Published policy, so a curator can compute their own reward."""
    return {
        "share_of_author_emission": CURATION_SHARE,
        "halflife_submissions": CURATION_HALFLIFE,
        "lifetime_cap": None,
        "lifetime_total_multiple": round(1 / (1 - 0.5 ** (1 / CURATION_HALFLIFE)), 3),
        "requires_identity": True,
        "on_chain": False,
        "schedule": [
            {"submissions": n, "multiplier": curation_decay(n)}
            for n in (0, 1, 2, 5, 10, 20, 50)
        ],
        "note": (
            "Curation piQ is credited to your spendable balance and is not minted on-chain. "
            "On-chain piQ records authored work only, which is what makes it meaningful as a "
            "contribution record. Curation rewards let you keep using the service; they do not "
            "claim you wrote the paper."
        ),
    }


# ---------------------------------------------------------------------------
# Publication fee
# ---------------------------------------------------------------------------
# Attaching your name publicly to an assessment costs piQ.
#
# Not as a revenue mechanism — piQ is not money — but because a free action is
# a costless one, and the leaderboard's value depends on publication meaning
# that an author considered the assessment worth standing behind. A button that
# costs nothing gets pressed on everything, and the signal dies.
#
# Charged ONCE per paper. Withdrawing and re-publishing does not charge again:
# the fee buys the right to attach your name, not each individual toggle, and
# charging per toggle would penalise someone for reconsidering — which is
# exactly the behaviour an honest system should leave free.
PUBLICATION_FEE = 1.0


def publication_fee(pix_score: float = 0.0) -> Dict:
    """What publishing costs, and why.

    Flat rather than proportional to piX. A fee that scales with score would
    charge the strongest work the most, which inverts the incentive the
    leaderboard exists to create.
    """
    return {
        "fee": PUBLICATION_FEE,
        "charged_once_per_paper": True,
        "refundable": False,
        "rationale": (
            f"Publishing costs {PUBLICATION_FEE:.2f} piQ, charged once per manuscript. It is not "
            f"refunded when you withdraw, and re-publishing the same paper is free. The fee "
            f"exists so that a published assessment means an author judged it worth standing "
            f"behind — a free action carries no such signal."
        ),
    }


# ---------------------------------------------------------------------------
# Peer review bounty
# ---------------------------------------------------------------------------
# What a review request costs, and what the reviewer is paid.
#
# The fee is a BOUNTY, not a badge price. It is held when the request opens and
# paid to whoever completes the review — so the money buys someone's time, not
# a claim about quality. A badge that could be bought outright would be exactly
# the purchasable credibility that DORA and CoARA exist to oppose, and it would
# be worth nothing to a reader the moment they understood how it was obtained.
PEER_REVIEW_BOUNTY = 2.0


def peer_review_fee() -> Dict:
    return {
        "fee": PEER_REVIEW_BOUNTY,
        "paid_to": "the reviewer, on completion",
        "refundable": False,
        "rationale": (
            f"Opening a review costs {PEER_REVIEW_BOUNTY:.2f} piQ. The whole amount is paid to "
            f"the researcher who completes the review — it commissions their time, it does not "
            f"purchase a badge. The Peer-reviewed badge appears only once a review has actually "
            f"been submitted by someone other than the requester."
        ),
    }


# LLM review costs less than peer review because it costs less to produce: it
# buys inference, not a researcher's afternoon. Pricing them the same would
# imply they are the same thing, and the whole point of having two badges is
# that a reader can tell them apart.
LLM_REVIEW_FEE = 0.5


# Paid to a reviewer for a completed review, over and above any bounty the
# requester posted. A review written on a paper nobody paid to have reviewed is
# worth exactly as much to a reader as one that was commissioned, so paying it
# nothing would make unsolicited review — the kind that actually needs
# encouraging — the only unpaid work on the platform.
PEER_REVIEW_BONUS = 2.0


def peer_review_bonus() -> Dict:
    return {
        "bonus": PEER_REVIEW_BONUS,
        "rationale": (
            f"Completing a peer review credits {PEER_REVIEW_BONUS:.2f} piQ to the reviewer, in "
            f"addition to any bounty the requester posted. It is paid on submission of a "
            f"reasoned report, not on the verdict reached — paying differently for different "
            f"conclusions would buy the conclusion."
        ),
    }


def llm_review_fee() -> Dict:
    return {
        "fee": LLM_REVIEW_FEE,
        "rationale": (
            f"An LLM review costs {LLM_REVIEW_FEE:.2f} piQ. A panel of models reads the "
            f"manuscript again and writes a critical review. It is labelled LLM-reviewed, never "
            f"peer-reviewed: no human read it, and a badge that blurred the two would mislead "
            f"exactly the readers it is meant to inform."
        ),
    }
