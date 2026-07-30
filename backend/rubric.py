"""
The Pi-Index scoring rubric — explicit, versioned, and auditable.

Why this module exists
----------------------
Criteria scores were previously produced by expressions like::

    c1 = (ai_rating * 0.9) + (vapri * 10)
    c6 = ai_rating * 0.88 + (sciscore_adherence * 12)

Those coefficients had no derivation, no documentation, and no consistent
scale — some were multiplicative fractions, others additive bonuses in raw
points. Two consequences followed. A researcher could not learn what to
improve, because nothing stated which signals fed which criterion. And nobody
could audit the score, because the rubric existed only as arithmetic buried in
a function body.

CoARA's transparency commitment requires that quantitative indicators be
published with their methodology. That is not satisfiable when the methodology
is an undocumented magic number.

The model here
--------------
Every criterion is a weighted sum of *named, normalized signals*. Each signal
is a value in [0, 1] with a stated meaning. Each criterion's weights sum to
exactly 1.0, so the result is inherently in [0, 1] and scales to 0-100 without
clamping — clamping was previously masking the fact that the additive bonuses
could push a score past 100.

Every weight below is a declared editorial judgement about what the criterion
means, not a fitted parameter. Stating them in one table makes them arguable,
which is the point: a rubric you can disagree with is a rubric you can improve.
`RUBRIC_VERSION` changes whenever any weight changes, so historical scores
remain interpretable.
"""
from typing import Dict, List

RUBRIC_VERSION = "pi-index-rubric/2.0"

# ---------------------------------------------------------------------------
# Signal catalogue — every input any criterion may consume.
# All are normalized to [0, 1]; the descriptions are surfaced in the API and
# the dossier so a researcher can see exactly what was measured.
# ---------------------------------------------------------------------------
SIGNAL_CATALOGUE = {
    "panel_rating": "Adjudicated quality rating from the multi-LLM panel, normalized to 0-1.",
    "corroboration": "Cross-model corroboration: how strongly independent jurors agreed, weighted by how many participated.",
    "mdar_adherence": "Deterministic MDAR reporting adherence (blinding, randomization, power analysis, RRIDs).",
    "rrid_density": "Density of valid Research Resource Identifiers, saturating at 5.",
    "reproducibility": "Open-science artefacts: repository, data statement, open licence, container, preregistration.",
    "empirical_density": "Concentration of statistical reporting, sample sizes and quantitative results.",
    "topic_diversity": "Hierarchical interdisciplinarity across the OpenAlex domain/field/subfield ontology.",
    "domain_span": "Whether the work spans more than one top-level OpenAlex domain.",
    "citation_engagement": "Depth of engagement with prior literature, from resolvable reference density.",
    "reference_integrity": "Proportion of cited DOIs that resolve in OpenAlex or Crossref.",
    "openness_licence": "Presence of an explicit open licence on data or code.",
    "persistent_identifiers": "Use of persistent identifiers (DOIs, RRIDs, archived repositories) for outputs.",
    "text_completeness": "Whether enough machine-readable text was extracted to assess the manuscript fairly.",
}

# ---------------------------------------------------------------------------
# The rubric. Weights per criterion sum to 1.0 (asserted at import).
# ---------------------------------------------------------------------------
RUBRIC: Dict[str, Dict] = {
    "C1_Semantic_Originality": {
        "label": "Semantic Originality",
        "definition": (
            "Novelty of the contribution relative to the existing corpus. Rests primarily on the "
            "model panel's qualitative reading, since novelty is not directly measurable from text "
            "structure, but is discounted when the panel did not corroborate itself."
        ),
        "weights": {"panel_rating": 0.70, "corroboration": 0.20, "citation_engagement": 0.10},
    },
    "C2_Methodological_Rigor_SciScore": {
        "label": "Methodological Rigor",
        "definition": (
            "Adherence to MDAR reporting standards and resource identification. Deliberately "
            "dominated by deterministic checks rather than model opinion: rigour is a property of "
            "what the manuscript reports, which is verifiable, not of how convincing it reads."
        ),
        "weights": {"mdar_adherence": 0.55, "rrid_density": 0.20, "reference_integrity": 0.15,
                    "reproducibility": 0.10},
    },
    "C3_Interdisciplinary_Entropy": {
        "label": "Interdisciplinary Synergy",
        "definition": (
            "Breadth of the work across the scientific ontology, measured by affinity-weighted "
            "topic entropy scaled by ontological distance. Spanning domains counts for more than "
            "spanning topics within one subfield."
        ),
        "weights": {"topic_diversity": 0.60, "domain_span": 0.25, "panel_rating": 0.15},
    },
    "C4_Societal_Impact": {
        "label": "Societal Impact",
        "definition": (
            "Breadth of potential beneficiaries and openness of the contribution. Combines the "
            "panel's impact reading with structural evidence that the work is actually reachable "
            "by those it could benefit."
        ),
        "weights": {"panel_rating": 0.45, "topic_diversity": 0.20, "openness_licence": 0.20,
                    "domain_span": 0.15},
    },
    "C5_Open_Science_Repro": {
        "label": "Open Science",
        "definition": (
            "Open data, open code, licensing and containerized reproducibility. Entirely "
            "deterministic — these are artefacts that either exist and are cited, or do not."
        ),
        "weights": {"reproducibility": 0.60, "openness_licence": 0.20, "persistent_identifiers": 0.20},
    },
    "C6_Literature_Integration": {
        "label": "Literature Integration",
        "definition": (
            "Engagement with and integration of foundational literature. Reference integrity "
            "carries real weight: citations that do not resolve are not integration."
        ),
        "weights": {"citation_engagement": 0.40, "reference_integrity": 0.30,
                    "panel_rating": 0.20, "corroboration": 0.10},
    },
    "C7_Empirical_Density": {
        "label": "Empirical Density",
        "definition": (
            "Strength and density of quantitative evidence: statistical reporting, sample sizes, "
            "measured results. Overwhelmingly deterministic, since this is directly countable."
        ),
        "weights": {"empirical_density": 0.70, "mdar_adherence": 0.15, "panel_rating": 0.15},
    },
    "C8_Future_Actionability_FAIR": {
        "label": "Future Actionability",
        "definition": (
            "How readily others can build on the work: FAIR-compliant outputs, persistent "
            "identifiers, and reproducible artefacts."
        ),
        "weights": {"reproducibility": 0.35, "persistent_identifiers": 0.30,
                    "panel_rating": 0.25, "openness_licence": 0.10},
    },
}

CRITERIA_ORDER: List[str] = list(RUBRIC.keys())

# Fail fast at import rather than silently producing out-of-range scores.
for _key, _spec in RUBRIC.items():
    _total = sum(_spec["weights"].values())
    assert abs(_total - 1.0) < 1e-9, f"{_key} weights sum to {_total}, expected 1.0"
    for _sig in _spec["weights"]:
        assert _sig in SIGNAL_CATALOGUE, f"{_key} references unknown signal '{_sig}'"


def _clamp01(v) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    if v != v:  # NaN
        return 0.0
    return max(0.0, min(1.0, v))


def normalize_signals(raw: Dict) -> Dict[str, float]:
    """Coerce every catalogued signal into [0, 1], defaulting to 0.0."""
    return {name: _clamp01(raw.get(name, 0.0)) for name in SIGNAL_CATALOGUE}


def score_criteria(signals: Dict) -> Dict[str, float]:
    """Apply the rubric. Returns criterion -> score in [0, 100].

    Because each criterion's weights sum to 1.0 and every signal is bounded to
    [0, 1], the result is bounded to [0, 100] by construction. No clamping is
    needed, which means a score of 100 genuinely represents every input signal
    at maximum rather than an additive overflow that happened to be truncated.
    """
    s = normalize_signals(signals)
    return {
        key: round(sum(s[sig] * w for sig, w in spec["weights"].items()) * 100.0, 4)
        for key, spec in RUBRIC.items()
    }


def explain_criterion(key: str, signals: Dict) -> Dict:
    """Per-criterion breakdown: which signal contributed how many points.

    This is what makes a score actionable. A researcher seeing
    'reproducibility contributed 6/60 points to C5' knows precisely what to fix.
    """
    spec = RUBRIC.get(key)
    if not spec:
        return {}
    s = normalize_signals(signals)
    contributions = []
    for sig, w in sorted(spec["weights"].items(), key=lambda kv: kv[1], reverse=True):
        contributions.append({
            "signal": sig,
            "description": SIGNAL_CATALOGUE[sig],
            "value": round(s[sig], 4),
            "weight": w,
            "points": round(s[sig] * w * 100.0, 2),
            "max_points": round(w * 100.0, 2),
        })
    return {
        "id": key,
        "label": spec["label"],
        "definition": spec["definition"],
        "score": round(sum(c["points"] for c in contributions), 4),
        "contributions": contributions,
        # The single highest-yield fix: the signal leaving the most points unclaimed.
        "largest_gap": max(contributions, key=lambda c: c["max_points"] - c["points"])["signal"]
        if contributions else None,
    }


def explain_all(signals: Dict) -> List[Dict]:
    return [explain_criterion(k, signals) for k in CRITERIA_ORDER]


def rubric_manifest() -> Dict:
    """Machine-readable publication of the rubric, for the API and dossiers."""
    return {
        "version": RUBRIC_VERSION,
        "signals": SIGNAL_CATALOGUE,
        "criteria": [
            {
                "id": key,
                "label": spec["label"],
                "definition": spec["definition"],
                "weights": spec["weights"],
                "deterministic_share": round(
                    sum(w for sig, w in spec["weights"].items()
                        if sig not in ("panel_rating", "corroboration")), 4),
            }
            for key, spec in RUBRIC.items()
        ],
        "notes": [
            "Every criterion is a weighted sum of normalized signals; weights sum to 1.0.",
            "Scores are bounded to [0, 100] by construction, not by clamping.",
            "'deterministic_share' is the fraction of each criterion decided by verifiable text "
            "analysis rather than model opinion.",
        ],
    }


# ---------------------------------------------------------------------------
# Composite
# ---------------------------------------------------------------------------
def composite_score(criteria_scores: Dict[str, float], epoch_weights: List[float] = None) -> float:
    """The piX composite.

    Defaults to the unweighted mean, matching the historical definition so
    scores stay comparable. When epoch weights are supplied they reweight the
    criteria, but they are renormalized to mean 1.0 first so the composite
    stays on the same 0-100 scale regardless.
    """
    vals = [criteria_scores.get(k, 0.0) for k in CRITERIA_ORDER]
    if not vals:
        return 0.0
    if not epoch_weights or len(epoch_weights) != len(vals):
        return round(sum(vals) / len(vals), 4)
    try:
        w = [max(0.0, float(x)) for x in epoch_weights]
    except (TypeError, ValueError):
        return round(sum(vals) / len(vals), 4)
    total = sum(w)
    if total <= 0:
        return round(sum(vals) / len(vals), 4)
    w = [x * (len(w) / total) for x in w]
    return round(sum(v * wi for v, wi in zip(vals, w)) / len(vals), 4)
