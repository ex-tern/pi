"""
Scoring rubric invariants.

The bounds tests matter most. The previous scoring code relied on
`min(100, max(0, ...))` clamps, which silently hid the fact that additive
coefficient bonuses could push a criterion past 100. Bounds are now a
consequence of each criterion's weights summing to 1.0, and these tests
assert that property directly rather than trusting the clamp.

Run with:  cd backend && pytest tests/ -v
"""
import os
import sys
import tempfile

import pytest

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import rubric

ALL_SIGNALS = list(rubric.SIGNAL_CATALOGUE)


def signals(value=0.5, **overrides):
    v = {s: value for s in ALL_SIGNALS}
    v.update(overrides)
    return v


# --------------------------------------------------------------------------
# Structure
# --------------------------------------------------------------------------
@pytest.mark.parametrize("criterion", list(rubric.RUBRIC))
def test_criterion_weights_sum_to_one(criterion):
    total = sum(rubric.RUBRIC[criterion]["weights"].values())
    assert abs(total - 1.0) < 1e-9, f"{criterion} weights sum to {total}"


@pytest.mark.parametrize("criterion", list(rubric.RUBRIC))
def test_every_criterion_is_documented(criterion):
    spec = rubric.RUBRIC[criterion]
    assert spec.get("label")
    assert len(spec.get("definition", "")) > 40, "definitions must be substantive"


@pytest.mark.parametrize("criterion", list(rubric.RUBRIC))
def test_criterion_references_only_catalogued_signals(criterion):
    for signal in rubric.RUBRIC[criterion]["weights"]:
        assert signal in rubric.SIGNAL_CATALOGUE


def test_eight_criteria():
    assert len(rubric.RUBRIC) == 8


# --------------------------------------------------------------------------
# Bounds — by construction, not by clamping
# --------------------------------------------------------------------------
def test_all_signals_maximum_yields_exactly_100():
    for score in rubric.apply_scoring_rubric(signals(1.0)).values():
        assert abs(score - 100.0) < 1e-6


def test_all_signals_minimum_yields_exactly_zero():
    for score in rubric.apply_scoring_rubric(signals(0.0)).values():
        assert abs(score) < 1e-6


def test_all_signals_half_yields_exactly_50():
    for score in rubric.apply_scoring_rubric(signals(0.5)).values():
        assert abs(score - 50.0) < 1e-6


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -5.0, 99.0, "abc", None])
def test_hostile_signal_values_stay_in_range(bad):
    for score in rubric.apply_scoring_rubric({s: bad for s in ALL_SIGNALS}).values():
        assert 0.0 <= score <= 100.0


def test_missing_signals_default_to_zero():
    assert rubric.apply_scoring_rubric({})["C1_Semantic_Originality"] == 0.0


# --------------------------------------------------------------------------
# Monotonicity — improving any input must never lower a score
# --------------------------------------------------------------------------
@pytest.mark.parametrize("signal", ALL_SIGNALS)
def test_monotonic_in_each_signal(signal):
    base = rubric.apply_scoring_rubric(signals(0.4))
    bumped = rubric.apply_scoring_rubric(signals(0.4, **{signal: 0.9}))
    for key in base:
        assert bumped[key] >= base[key] - 1e-9, f"raising {signal} lowered {key}"


# --------------------------------------------------------------------------
# Explanations — what makes a score actionable
# --------------------------------------------------------------------------
def test_contributions_sum_to_the_score():
    ex = rubric.explain_criterion_score("C5_Open_Science_Repro", signals(0.6))
    assert abs(sum(c["points"] for c in ex["contributions"]) - ex["score"]) < 1e-6


def test_max_points_sum_to_100():
    ex = rubric.explain_criterion_score("C2_Methodological_Rigor_SciScore", signals(0.3))
    assert abs(sum(c["max_points"] for c in ex["contributions"]) - 100.0) < 1e-6


def test_largest_gap_identifies_the_weakest_high_weight_signal():
    ex = rubric.explain_criterion_score("C5_Open_Science_Repro", {
        "reproducibility": 0.9, "openness_licence": 0.2, "persistent_identifiers": 0.1,
    })
    assert ex["largest_gap"] == "persistent_identifiers"


def test_contributions_sorted_by_weight_descending():
    ex = rubric.explain_criterion_score("C1_Semantic_Originality", signals())
    weights = [c["weight"] for c in ex["contributions"]]
    assert weights == sorted(weights, reverse=True)


def test_unknown_criterion_returns_empty_rather_than_raising():
    assert rubric.explain_criterion_score("C99_Nonexistent", signals()) == {}


# --------------------------------------------------------------------------
# Manifest — the published, auditable form
# --------------------------------------------------------------------------
def test_manifest_is_versioned_and_complete():
    manifest = rubric.rubric_manifest()
    assert manifest["version"] == rubric.RUBRIC_VERSION
    assert len(manifest["signals"]) == len(rubric.SIGNAL_CATALOGUE)
    assert len(manifest["criteria"]) == 8
    assert all("weights" in c for c in manifest["criteria"])


def test_open_science_is_fully_deterministic():
    """C5 must not depend on model opinion: these artefacts exist or they don't."""
    manifest = rubric.rubric_manifest()
    c5 = next(c for c in manifest["criteria"] if c["id"] == "C5_Open_Science_Repro")
    assert c5["deterministic_share"] == 1.0


def test_methodological_rigor_is_mostly_deterministic():
    manifest = rubric.rubric_manifest()
    c2 = next(c for c in manifest["criteria"] if c["id"] == "C2_Methodological_Rigor_SciScore")
    assert c2["deterministic_share"] >= 0.9


def test_manifest_is_json_serialisable():
    import json
    assert json.dumps(rubric.rubric_manifest())


# --------------------------------------------------------------------------
# Composite
# --------------------------------------------------------------------------
def test_uniform_scores_give_that_score():
    scores = {k: 60.0 for k in rubric.CRITERIA_ORDER}
    assert abs(rubric.compute_composite_score(scores) - 60.0) < 1e-6


@pytest.mark.parametrize("bad_weights", [["x"] * 8, [1, 2], [0.0] * 8, None, []])
def test_unusable_epoch_weights_fall_back_to_the_mean(bad_weights):
    scores = {k: 60.0 for k in rubric.CRITERIA_ORDER}
    assert abs(rubric.compute_composite_score(scores, bad_weights) - 60.0) < 1e-6


def test_epoch_weighting_shifts_the_composite():
    scores = {k: 60.0 for k in rubric.CRITERIA_ORDER}
    scores["C1_Semantic_Originality"] = 100.0
    assert rubric.compute_composite_score(scores, [3, 1, 1, 1, 1, 1, 1, 1]) > \
           rubric.compute_composite_score(scores, [1] * 8)


def test_empty_scores_are_safe():
    assert rubric.compute_composite_score({}) == 0.0


# --------------------------------------------------------------------------
# v3 — honest framing of what the composite measures
# --------------------------------------------------------------------------
def test_interpretive_criteria_are_marked():
    """C1 and C4 are relations to a field and to the future, not document
    properties. They must be labelled so, not silently averaged in."""
    interpretive = [k for k, spec in rubric.RUBRIC.items() if spec.get("interpretive")]
    assert "C1_Semantic_Originality" in interpretive
    assert "C4_Societal_Impact" in interpretive


def test_interpretive_criteria_no_longer_dominated_by_model_opinion():
    for key in ("C1_Semantic_Originality", "C4_Societal_Impact"):
        panel = rubric.RUBRIC[key]["weights"].get("panel_rating", 0.0)
        assert panel <= 0.45, f"{key} still leans too heavily on model opinion"


def test_the_verifiable_share_is_published():
    confidence = rubric.composite_confidence()
    assert confidence["verifiable_share"] > 0.7, \
        "most of the composite must rest on verifiable analysis"
    assert confidence["statement"]


def test_the_manifest_states_what_is_measured():
    manifest = rubric.rubric_manifest()
    assert "reporting" in manifest["measures"].lower()
    assert "does not measure" in manifest["measures"].lower()


def test_model_opinion_share_fell_from_v2():
    """v2 carried ~34% model opinion; v3 materially reduces it."""
    assert rubric.composite_confidence()["model_opinion_share"] < 0.30
