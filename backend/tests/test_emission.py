"""
piQ emission policy: difficulty must rise with adoption.

The central property is that the same manuscript earns progressively less as
the corpus grows — and that the mechanisms doing that can never mint unbounded
supply or make the economy insolvent.

Run with:  cd backend && pytest tests/ -v
"""
import os
import sys
import tempfile

import pytest

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import emission


# --------------------------------------------------------------------------
# The core requirement
# --------------------------------------------------------------------------
def test_identical_paper_earns_less_as_the_corpus_grows():
    """Expressed in halving intervals so retuning the schedule cannot make
    this pass vacuously by putting all three sizes in the same epoch."""
    interval = emission.HALVING_INTERVAL
    early = emission.compute_piq_emission(90.0, 80.0, total_papers=1)
    mid = emission.compute_piq_emission(90.0, 80.0, total_papers=interval + 1)
    late = emission.compute_piq_emission(90.0, 80.0, total_papers=(interval * 3) + 1)
    assert early["minted"] > mid["minted"] > late["minted"]


def test_quality_bar_rises_with_the_corpus():
    assert emission.compute_quality_threshold(0) < emission.compute_quality_threshold(1000) < emission.compute_quality_threshold(10000)


def test_quality_bar_never_becomes_unreachable():
    assert emission.compute_quality_threshold(10 ** 9) <= emission.FLOOR_PIX_CEILING + 1e-9
    assert emission.compute_quality_threshold(10 ** 9) < 100.0


def test_a_borderline_paper_qualifies_early_but_not_later():
    """Calibrated against the thresholds themselves, so retuning the policy
    doesn't silently invalidate the property being tested."""
    borderline = (emission.FLOOR_PIX_INITIAL + emission.FLOOR_PIX_CEILING) / 2 - 1
    assert emission.compute_piq_emission(borderline, 80.0, 10)["qualified"] is True
    assert emission.compute_piq_emission(borderline, 80.0, 10 ** 6)["qualified"] is False


def test_rejection_explains_the_rising_bar():
    borderline = (emission.FLOOR_PIX_INITIAL + emission.FLOOR_PIX_CEILING) / 2 - 1
    result = emission.compute_piq_emission(borderline, 80.0, 10 ** 6)
    assert any("risen" in reason for reason in result["reasons"])


# --------------------------------------------------------------------------
# Halving schedule
# --------------------------------------------------------------------------
def test_epoch_advances_with_each_interval():
    assert emission.current_halving_epoch(0) == 0
    assert emission.current_halving_epoch(emission.HALVING_INTERVAL) == 1


def test_epoch_is_capped():
    assert emission.current_halving_epoch(10 ** 9) == emission.MAX_HALVINGS


def test_supply_factor_halves_and_never_reaches_zero():
    assert abs(emission.compute_supply_factor(emission.HALVING_INTERVAL)
               - 0.5 * emission.compute_supply_factor(0)) < 1e-9
    assert emission.compute_supply_factor(10 ** 9) > 0


# --------------------------------------------------------------------------
# Per-author decay — quality must beat volume
# --------------------------------------------------------------------------
def test_prolific_author_earns_less_per_paper():
    solo = emission.compute_piq_emission(90.0, 80.0, 100, author_paper_count=0)
    prolific = emission.compute_piq_emission(90.0, 80.0, 100, author_paper_count=40)
    assert prolific["minted"] < solo["minted"]


def test_author_factor_is_monotonic_and_floored():
    assert emission.compute_author_decay_factor(0) == 1.0
    assert all(emission.compute_author_decay_factor(i) >= emission.compute_author_decay_factor(i + 1) for i in range(60))
    assert emission.compute_author_decay_factor(10 ** 6) >= emission.AUTHOR_MIN_FACTOR


# --------------------------------------------------------------------------
# Gates and safety
# --------------------------------------------------------------------------
def test_logic_gate_blocks_minting_and_is_not_a_difficulty_setting():
    result = emission.compute_piq_emission(95.0, emission.LOGIC_FLOOR - 5, 10)
    assert result["minted"] == 0.0
    assert result["logic_floor"] == emission.compute_piq_emission(
        95.0, emission.LOGIC_FLOOR - 5, 99999)["logic_floor"]


@pytest.mark.parametrize("pix", [-50, 0, 50, 100, 500, float("nan")])
@pytest.mark.parametrize("corpus", [0, 1, 500, 100000])
def test_emission_is_always_bounded(pix, corpus):
    """An out-of-range piX must never translate into unbounded token supply."""
    minted = emission.compute_piq_emission(pix, 90.0, corpus)["minted"]
    max_possible = 100.0 / emission.BASE_DIVISOR
    assert 0.0 <= minted <= max_possible


def test_garbage_input_mints_nothing():
    assert emission.compute_piq_emission("x", None, 10)["minted"] == 0.0


def test_negative_corpus_is_safe():
    assert emission.compute_piq_emission(90.0, 90.0, -5)["minted"] >= 0


# --------------------------------------------------------------------------
# Economic solvency
# --------------------------------------------------------------------------
@pytest.mark.parametrize("corpus", [0, 500, 2500, 5000, 10000, 20000, 10 ** 6])
def test_a_qualifying_paper_always_nets_positive(corpus):
    """Held flat, the fee would exceed emission at high corpus sizes and the
    economy would stall for accounting reasons rather than quality ones."""
    fees = emission.fee_manifest(corpus)
    assert fees["sustainable"], f"insolvent at corpus={corpus}: {fees}"
    assert fees["marginal_paper_nets"] > 0


def test_fee_scales_down_with_difficulty():
    assert emission.compute_processing_fee(0) > \
           emission.compute_processing_fee(emission.HALVING_INTERVAL * 2)


def test_fee_never_reaches_zero():
    assert emission.compute_processing_fee(10 ** 9) >= emission.MIN_FEE


# --------------------------------------------------------------------------
# Transparency
# --------------------------------------------------------------------------
def test_manifest_publishes_the_whole_schedule():
    manifest = emission.emission_manifest(emission.HALVING_INTERVAL + 10)
    assert manifest["current_epoch"] == 1
    assert len(manifest["schedule"]) == emission.MAX_HALVINGS + 1
    assert sum(1 for s in manifest["schedule"] if s["current"]) == 1
    assert len(manifest["explanation"]) >= 5


def test_countdown_to_next_halving_is_correct():
    corpus = emission.HALVING_INTERVAL + 250
    expected = (emission.HALVING_INTERVAL * 2) - corpus
    assert emission.compute_piq_emission(90.0, 90.0, corpus)["papers_until_next_halving"] == expected


def test_no_countdown_at_the_final_epoch():
    assert emission.compute_piq_emission(90.0, 90.0, 10 ** 9)["papers_until_next_halving"] is None


def test_manifest_is_json_serialisable():
    import json
    assert json.dumps(emission.emission_manifest(100))
