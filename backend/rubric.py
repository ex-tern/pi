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

What this rubric measures — and what it does not
-----------------------------------------------
Version 3.0 corrects an overclaim. Every criterion the rubric measures *well*
is a reporting practice: MDAR adherence, RRID registration, data availability,
licensing, reproducibility artefacts, statistical reporting density, reference
resolvability. These are objective, verifiable, and currently under-checked by
human reviewers because checking them is tedious and unrewarded.

Novelty (C1) and societal impact (C4) are not properties of a document. Novelty
is a relation between a manuscript and its field; impact is a relation between
a manuscript and the future. Neither is recoverable from the PDF, and earlier
versions nonetheless produced a number to two decimal places for both — 70% and
45% of which was model opinion.

They are retained because they carry real information a reader wants, but their
weight in the composite is now materially reduced and both are marked
`interpretive: True`. The composite is therefore a **reporting and integrity
score** that includes an interpretive component, not a measurement of research
quality. `composite_confidence()` reports how much of a given score rests on
verifiable evidence, so the distinction is visible rather than buried here.

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

RUBRIC_VERSION = "pi-index-rubric/3.0"

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
        "interpretive": True,
        "definition": (
            "Interpretive. Novelty is a relation between a manuscript and its field, not a "
            "property of the document, so it cannot be measured from the text alone. This score "
            "reflects the model panel's reading, heavily discounted when the panel did not "
            "corroborate itself, and partly anchored to verifiable engagement with prior work. "
            "Treat it as informed opinion, not measurement."
        ),
        "weights": {"panel_rating": 0.45, "corroboration": 0.25,
                    "citation_engagement": 0.20, "reference_integrity": 0.10},
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
        "label": "Societal Reach",
        "interpretive": True,
        "definition": (
            "Interpretive. Real-world impact unfolds over years and cannot be read from a "
            "manuscript. What is measurable is *reach*: whether the work is openly licensed, "
            "spans more than one domain, and is therefore actually accessible to those it could "
            "benefit. The panel's reading contributes, but no longer dominates."
        ),
        "weights": {"openness_licence": 0.30, "panel_rating": 0.25, "topic_diversity": 0.25,
                    "domain_span": 0.20},
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


def clamp_unit_interval(v) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    if v != v:  # NaN
        return 0.0
    return max(0.0, min(1.0, v))


def normalize_signal_vector(raw: Dict) -> Dict[str, float]:
    """Coerce every catalogued signal into [0, 1], defaulting to 0.0."""
    return {name: clamp_unit_interval(raw.get(name, 0.0)) for name in SIGNAL_CATALOGUE}


def apply_scoring_rubric(signals: Dict) -> Dict[str, float]:
    """Apply the rubric. Returns criterion -> score in [0, 100].

    Because each criterion's weights sum to 1.0 and every signal is bounded to
    [0, 1], the result is bounded to [0, 100] by construction. No clamping is
    needed, which means a score of 100 genuinely represents every input signal
    at maximum rather than an additive overflow that happened to be truncated.
    """
    s = normalize_signal_vector(signals)
    return {
        key: round(sum(s[sig] * w for sig, w in spec["weights"].items()) * 100.0, 4)
        for key, spec in RUBRIC.items()
    }


def explain_criterion_score(key: str, signals: Dict) -> Dict:
    """Per-criterion breakdown: which signal contributed how many points.

    This is what makes a score actionable. A researcher seeing
    'reproducibility contributed 6/60 points to C5' knows precisely what to fix.
    """
    spec = RUBRIC.get(key)
    if not spec:
        return {}
    s = normalize_signal_vector(signals)
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


def explain_all_criteria(signals: Dict) -> List[Dict]:
    return [explain_criterion_score(k, signals) for k in CRITERIA_ORDER]


def composite_confidence(criteria_scores: Dict[str, float] = None) -> Dict:
    """How much of the composite rests on verifiable evidence.

    Publishing a single number without saying how much of it is measured and
    how much is opinion is the failure mode this rubric exists to avoid. The
    interpretive share is computed from the rubric itself, so it cannot drift
    from the weights actually in force.
    """
    interpretive_keys = [k for k, spec in RUBRIC.items() if spec.get("interpretive")]
    n = len(CRITERIA_ORDER)
    interpretive_share = len(interpretive_keys) / n if n else 0.0

    # Within every criterion, how much weight sits on model opinion rather
    # than on a deterministic signal.
    opinion_weight = sum(
        spec["weights"].get("panel_rating", 0.0) + spec["weights"].get("corroboration", 0.0)
        for spec in RUBRIC.values()
    ) / n if n else 0.0

    return {
        "interpretive_criteria": interpretive_keys,
        "interpretive_share": round(interpretive_share, 4),
        "model_opinion_share": round(opinion_weight, 4),
        "verifiable_share": round(1.0 - opinion_weight, 4),
        "statement": (
            f"{(1.0 - opinion_weight) * 100:.0f}% of this composite derives from verifiable "
            f"text analysis; {opinion_weight * 100:.0f}% from model interpretation. "
            f"{len(interpretive_keys)} of {n} criteria are marked interpretive and cannot be "
            f"measured from the manuscript alone."
        ),
    }


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
                "interpretive": bool(spec.get("interpretive")),
                "weights": spec["weights"],
                "deterministic_share": round(
                    sum(w for sig, w in spec["weights"].items()
                        if sig not in ("panel_rating", "corroboration")), 4),
            }
            for key, spec in RUBRIC.items()
        ],
        "confidence": composite_confidence(),
        "measures": (
            "Reporting quality and research integrity. The criteria this rubric measures well are "
            "reporting practices — what a manuscript documents, registers, deposits and cites. It "
            "does not measure the importance or correctness of the underlying research."
        ),
        "notes": [
            "Every criterion is a weighted sum of normalized signals; weights sum to 1.0.",
            "Scores are bounded to [0, 100] by construction, not by clamping.",
            "'deterministic_share' is the fraction of each criterion decided by verifiable text "
            "analysis rather than model opinion.",
            "'interpretive' criteria (C1, C4) cannot be measured from the document and are "
            "reported as informed opinion with reduced weight.",
        ],
    }


# ---------------------------------------------------------------------------
# Composite
# ---------------------------------------------------------------------------
def compute_composite_score(criteria_scores: Dict[str, float], epoch_weights: List[float] = None) -> float:
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
