"""
Smoke tests for brain.py's deterministic scoring functions — the parts of
the engine that don't depend on external LLM APIs, so they can be verified
on every commit / in CI without any API keys configured.

Run with:  cd backend && pytest tests/ -v
"""
import math

import brain


SAMPLE_RIGOROUS_TEXT = """
A Randomized Double-Blind Study of Example Interventions

By Jane Doe, University of Example

Abstract: We conducted a randomized, double-blind trial with n=120
participants. A power analysis determined the required sample size.
p < 0.001 for the primary outcome; effect size was large (Cohen's d = 0.8).
Data availability: all code is available at github.com/example/repo under
an MIT license. A Docker container is provided for full reproducibility.
RRID:AB_12345 and RRID:AB_67890 were used for antibody reagents.
Results showed a 45.2% improvement and 12.3 ms average latency.

References
[1] Smith et al. 2020. Some Journal.
"""

SAMPLE_THIN_TEXT = "This is a short note with no methodology described at all."


def test_calculate_deterministic_mdar_detects_rigor_signals():
    mdar, rrid_count = brain.calculate_deterministic_mdar(SAMPLE_RIGOROUS_TEXT)
    assert 0.0 <= mdar <= 1.0
    assert rrid_count == 2
    # A paper describing blinding, randomization, power analysis, and 2 RRIDs
    # should score meaningfully higher than a paper mentioning none of that.
    thin_mdar, thin_rrid = brain.calculate_deterministic_mdar(SAMPLE_THIN_TEXT)
    assert mdar > thin_mdar
    assert thin_rrid == 0


def test_calculate_reproducibility_score_range_and_signal_detection():
    score, flags = brain.calculate_reproducibility_score(SAMPLE_RIGOROUS_TEXT)
    assert 0.0 <= score <= 1.0
    assert flags["code_or_data_repository"] is True
    assert flags["open_license"] is True
    assert flags["containerized_execution"] is True

    thin_score, thin_flags = brain.calculate_reproducibility_score(SAMPLE_THIN_TEXT)
    assert not any(thin_flags.values())
    assert score > thin_score


def test_calculate_empirical_density_range():
    density = brain.calculate_empirical_density(SAMPLE_RIGOROUS_TEXT)
    assert 0.0 <= density <= 1.0
    thin_density = brain.calculate_empirical_density(SAMPLE_THIN_TEXT)
    assert density > thin_density


def test_compute_formulaic_criteria_bounds_and_keys():
    scores = brain.compute_formulaic_criteria(
        reproducibility_score=0.75,
        sciscore_adherence=0.6,
        topological_entropy=0.5,
        ai_rating=80.0,
        vapri=0.3,
        empirical_density=0.4,
    )
    expected_keys = {
        "C1_Semantic_Originality", "C2_Methodological_Rigor_SciScore",
        "C3_Interdisciplinary_Entropy", "C4_Societal_Impact",
        "C5_Open_Science_Repro", "C6_Literature_Integration",
        "C7_Empirical_Density", "C8_Future_Actionability_FAIR",
    }
    assert set(scores.keys()) == expected_keys
    for v in scores.values():
        assert 0.0 <= v <= 100.0


def test_compute_formulaic_criteria_clamps_extremes():
    # ai_rating way out of the normal 0-100 range shouldn't blow past
    # the 0-100 output bound on any criterion.
    scores = brain.compute_formulaic_criteria(
        reproducibility_score=1.0, sciscore_adherence=1.0,
        topological_entropy=1.0, ai_rating=1000.0, vapri=1.0,
        empirical_density=1.0,
    )
    for v in scores.values():
        assert v <= 100.0


def test_generate_rebuttal_strategy_targets_lowest_criterion():
    scores = {"C1_Semantic_Originality": 90.0, "C7_Empirical_Density": 20.0, "C4_Societal_Impact": 70.0}
    strategy = brain.generate_rebuttal_strategy(scores)
    assert "C7_Empirical_Density" in strategy
    assert "20.0" in strategy


def test_get_formulas_hash_is_stable():
    assert brain.get_formulas_hash() == brain.get_formulas_hash()
    assert len(brain.get_formulas_hash()) == 64  # sha256 hex digest


def test_adaptive_chunking_short_text_passthrough():
    text = "short text"
    assert brain.adaptive_chunking(text, 1000) == text


def test_adaptive_chunking_truncates_long_text():
    text = "A" * 1000
    chunked = brain.adaptive_chunking(text, 100)
    assert "[TRUNCATED FOR TOKEN LIMITS]" in chunked
    assert len(chunked) < len(text)


def test_query_llm_json_reports_missing_key_without_network_call():
    provider, data = brain.query_llm_json("llama", "some-model", "", "https://example.com", "prompt")
    assert provider == "llama"
    assert data["api_failed"] is True
    assert "missing" in data["opinion"].lower()
