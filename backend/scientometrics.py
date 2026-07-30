"""
Scientometric analysis: hierarchical interdisciplinarity, reference integrity,
and a deliberately conservative authorship-assistance signal.

Three independent capabilities, grouped because all three reason about the
bibliographic and linguistic structure of a manuscript rather than its prose
content.

1. Hierarchical topic entropy
   OpenAlex deprecated its flat `concepts` taxonomy in favour of a four-level
   hierarchy (4 domains, 26 fields, 254 subfields, ~4,500 topics). Flat Shannon
   entropy over concepts cannot distinguish a paper spanning two topics inside
   one subfield from a paper genuinely bridging Health Sciences and Physical
   Sciences. The former is narrow specialisation; the latter is real
   interdisciplinary synergy. This module weights entropy by ontological
   distance so C3 and C4 measure the thing they claim to.

2. Reference integrity auditing ("Baseline Scout")
   Generative models fabricate plausible-looking citations. Extracted DOIs are
   verified against OpenAlex and Crossref; a confirmed-fabrication ratio above
   threshold zeroes C2. Crucially, "could not verify" and "confirmed not to
   exist" are tracked separately — a paywalled, brand-new or non-indexed work
   is unverifiable but perfectly real, and must never be counted as fabricated.

3. Authorship assistance signal
   Standard AI-text detectors misclassify over 60% of non-native English
   writing as machine-generated, because they key on low perplexity and low
   lexical variability — precisely the characteristics of formal ESL academic
   prose. Deploying one here would systematically penalise researchers from
   non-Anglophone institutions. The approach taken instead measures *internal
   consistency* across sections, which is invariant to a writer's baseline
   fluency, and is reported as advisory context that never alters a score.
"""
import re
import math
import logging
from collections import Counter
from typing import Dict, List, Optional, Tuple

import requests

from integrations import clean_author_name, is_likely_institution
from http_client import (
    fetch_json, run_bounded, doi_cache, author_cache, work_cache, DEFAULT_TIMEOUT,
)

OPENALEX_BASE = "https://api.openalex.org"
CROSSREF_BASE = "https://api.crossref.org"


# ===========================================================================
# 1. HIERARCHICAL INTERDISCIPLINARITY
# ===========================================================================
# How far apart two topics are in the OpenAlex ontology. Bridging domains is
# the strongest possible signal of interdisciplinarity; differing only at the
# topic level is ordinary within-speciality breadth.
_LEVEL_DISTANCE = {
    "domain": 1.00,
    "field": 0.72,
    "subfield": 0.42,
    "topic": 0.15,
    "same": 0.0,
}


def measure_ontological_distance(a: dict, b: dict) -> float:
    """Ontological distance between two OpenAlex topic records."""
    if a.get("domain") and b.get("domain") and a["domain"] != b["domain"]:
        return _LEVEL_DISTANCE["domain"]
    if a.get("field") and b.get("field") and a["field"] != b["field"]:
        return _LEVEL_DISTANCE["field"]
    if a.get("subfield") and b.get("subfield") and a["subfield"] != b["subfield"]:
        return _LEVEL_DISTANCE["subfield"]
    if a.get("id") != b.get("id"):
        return _LEVEL_DISTANCE["topic"]
    return _LEVEL_DISTANCE["same"]


def normalize_topic_records(work: dict) -> List[dict]:
    """Normalise OpenAlex topic records, falling back to legacy concepts.

    The `concepts` branch exists only for works OpenAlex has not yet
    reprocessed under the new taxonomy; it yields a flat structure that the
    distance function degrades gracefully on.
    """
    parsed = []
    for t in work.get("topics") or []:
        parsed.append({
            "id": t.get("id"),
            "name": t.get("display_name"),
            "score": float(t.get("score") or 0.0),
            "subfield": (t.get("subfield") or {}).get("display_name"),
            "field": (t.get("field") or {}).get("display_name"),
            "domain": (t.get("domain") or {}).get("display_name"),
        })
    if parsed:
        return [p for p in parsed if p["score"] > 0]

    for c in work.get("concepts") or []:
        score = float(c.get("score") or 0.0)
        if score > 0:
            parsed.append({
                "id": c.get("id"), "name": c.get("display_name"), "score": score,
                "subfield": None, "field": None, "domain": None,
            })
    return parsed


def measure_topic_diversity(topics: List[dict]) -> Dict:
    """Affinity-weighted Shannon entropy scaled by mean ontological distance.

    Returns a normalized score in [0, 1] plus the components behind it, so the
    dossier can explain *why* a paper scored as interdisciplinary instead of
    presenting an unexplained number.
    """
    detail = {
        "entropy": 0.0, "normalized_entropy": 0.0, "distance_multiplier": 0.0,
        "score": 0.35, "topic_count": 0, "domains": [], "fields": [], "subfields": [],
        "spans_domains": False, "basis": "none",
    }
    valid = [t for t in (topics or []) if t.get("score", 0) > 0]
    detail["topic_count"] = len(valid)
    if len(valid) < 2:
        # A single detected topic is genuine information: this work is narrow.
        detail["basis"] = "single-topic" if valid else "no-topics"
        detail["score"] = 0.30 if valid else 0.35
        if valid:
            detail["domains"] = [d for d in {t.get("domain") for t in valid} if d]
            detail["fields"] = [f for f in {t.get("field") for t in valid} if f]
        return detail

    total = sum(t["score"] for t in valid)
    probs = [t["score"] / total for t in valid]
    entropy = -sum(p * math.log(p) for p in probs if p > 0)
    max_entropy = math.log(len(probs))
    normalized = entropy / max_entropy if max_entropy > 0 else 0.0

    # Mean pairwise separation, weighted by how much probability mass each
    # pair carries — two trivially-weighted topics from distant domains should
    # not outrank a paper genuinely balanced across two domains.
    weighted_sep, weight_total = 0.0, 0.0
    for i in range(len(valid)):
        for j in range(i + 1, len(valid)):
            w = probs[i] * probs[j]
            weighted_sep += measure_ontological_distance(valid[i], valid[j]) * w
            weight_total += w
    mean_sep = (weighted_sep / weight_total) if weight_total > 0 else 0.0

    domains = sorted({t["domain"] for t in valid if t.get("domain")})
    fields = sorted({t["field"] for t in valid if t.get("field")})
    subfields = sorted({t["subfield"] for t in valid if t.get("subfield")})

    # Distance rescales rather than replaces entropy: a paper must be both
    # spread across topics AND spread across the ontology to score highly.
    multiplier = 0.45 + (0.55 * mean_sep)
    score = normalized * multiplier

    detail.update({
        "entropy": round(entropy, 4),
        "normalized_entropy": round(normalized, 4),
        "distance_multiplier": round(multiplier, 4),
        "mean_separation": round(mean_sep, 4),
        "score": round(max(0.05, min(1.0, score)), 4),
        "domains": domains, "fields": fields, "subfields": subfields,
        "spans_domains": len(domains) > 1,
        "basis": "hierarchical-topics" if any(t.get("domain") for t in valid) else "legacy-concepts",
        "top_topics": [
            {"name": t["name"], "score": round(t["score"], 3),
             "field": t.get("field"), "domain": t.get("domain")}
            for t in sorted(valid, key=lambda x: x["score"], reverse=True)[:6]
        ],
    })
    return detail


def measure_panel_corroboration(judge_meta: dict, evidence_report: str = "") -> Dict:
    """Replaces VAPRI.

    VAPRI was ``md5(evidence_report) % 1000 / 1000`` — a hash digest treated as
    a measurement. It contributed up to 10 points to C1 and 5 to logic
    integrity, so a meaningful fraction of every score was deterministic noise
    with no relationship to the manuscript. Two documents differing by one
    character received unrelated VAPRI values.

    This computes what that slot should always have held: how well the
    evaluation corroborated itself. Three components, all real measurements:

    * agreement  — pairwise similarity of what jurors independently extracted
    * breadth    — how many independent providers actually returned a verdict
    * substance  — whether the synthesized report contains specific reasoning
                   rather than boilerplate
    """
    meta = judge_meta or {}
    agreement = float(meta.get("inter_model_agreement") or 0.0)
    jurors = int(meta.get("external_juror_count") or 0)

    # Saturating: the third independent juror adds far less than the second.
    breadth = min(1.0, math.log1p(jurors) / math.log(4.0)) if jurors > 0 else 0.0

    report = evidence_report or ""
    if not report.strip():
        substance = 0.0
    else:
        words = len(report.split())
        length_component = min(1.0, words / 350.0)
        # Specific reasoning cites criteria and numbers; boilerplate does not.
        specifics = len(re.findall(r"\bC[1-8]\b", report)) + len(re.findall(r"\d+(?:\.\d+)?%", report))
        specificity = min(1.0, specifics / 10.0)
        substance = (length_component * 0.5) + (specificity * 0.5)

    index = (agreement * 0.45) + (breadth * 0.35) + (substance * 0.20)
    index = max(0.0, min(1.0, index))

    return {
        "index": round(index, 4),
        "agreement": round(agreement, 4),
        "breadth": round(breadth, 4),
        "substance": round(substance, 4),
        "juror_count": jurors,
        "explanation": (
            f"Corroboration {index * 100:.0f}%: {jurors} independent juror(s) agreed "
            f"{agreement * 100:.0f}% on document identification, and the synthesized report "
            f"scored {substance * 100:.0f}% on specificity of reasoning."
        ),
    }


def measure_citation_engagement(text: str, reference_audit: dict = None) -> float:
    """Depth of literature engagement, from reference density and resolvability.

    Counts distinct bibliography entries relative to document length, rather
    than raw citation count, so a short paper citing thoroughly is not
    penalised against a long one citing sparsely.
    """
    if not text:
        return 0.0
    section = locate_bibliography(text)
    entries = len(re.findall(r"^\s*\[\d+\]|^\s*\d+\.\s+[A-Z]", section, re.MULTILINE))
    if entries == 0:
        entries = len(_DOI_RE.findall(section))
    doc_words = max(1, len(text.split()))
    # ~30 references in a ~6,000-word paper is a healthy density.
    density = min(1.0, (entries / doc_words) * 1000.0 / 5.0)
    breadth = min(1.0, entries / 30.0)
    base = (breadth * 0.6) + (density * 0.4)

    audit = reference_audit or {}
    conclusive = (audit.get("verified", 0) or 0) + (audit.get("fabricated", 0) or 0)
    if conclusive:
        # Engagement is discounted by the share of citations that don't resolve.
        base *= (audit.get("verified", 0) / conclusive)
    return round(max(0.0, min(1.0, base)), 4)


def measure_citation_resolvability(reference_audit: dict) -> float:
    """Share of conclusively-checked DOIs that resolve. Neutral when unknown."""
    audit = reference_audit or {}
    verified = audit.get("verified", 0) or 0
    fabricated = audit.get("fabricated", 0) or 0
    conclusive = verified + fabricated
    if not conclusive:
        # No verifiable evidence either way: neither reward nor punish.
        return 0.5
    return round(verified / conclusive, 4)


def measure_persistent_identifier_use(text: str) -> float:
    """Presence of persistent identifiers on the work's own outputs."""
    if not text:
        return 0.0
    lowered = text.lower()
    signals = [
        bool(re.search(r"\b10\.\d{4,9}/", text)),                                    # DOIs
        bool(re.search(r"\brrid\s*:", lowered)),                                     # RRIDs
        bool(re.search(r"zenodo\.org|figshare\.com|dryad|osf\.io", lowered)),        # archives
        bool(re.search(r"\borcid\b", lowered)),                                      # ORCID
        bool(re.search(r"accession (number|code)|\bgse\d+|\bpdb\b", lowered)),       # data accessions
    ]
    return round(sum(signals) / len(signals), 4)


def measure_open_licensing(text: str) -> float:
    """Explicit open licensing on data or code."""
    if not text:
        return 0.0
    lowered = text.lower()
    strong = bool(re.search(
        r"\b(mit licen[cs]e|apache licen[cs]e|bsd licen[cs]e|gpl|gnu general public|"
        r"creative commons|cc[- ]by(?:[- ]sa|[- ]nc)?|cc0|public domain)\b", lowered))
    weak = bool(re.search(r"\b(open licen[cs]e|freely available|openly available|open access)\b", lowered))
    return 1.0 if strong else (0.5 if weak else 0.0)


def fetch_topic_diversity_for_doi(doi: str) -> Dict:
    """Fetch a work from OpenAlex by DOI and score its interdisciplinarity."""
    neutral = {"score": 0.50, "basis": "unavailable", "topic_count": 0,
               "domains": [], "fields": [], "subfields": [], "spans_domains": False}
    if not doi or doi in ("None", "none", ""):
        return neutral

    clean = doi.replace("https://doi.org/", "").replace("doi.org/", "").strip()
    status, payload = fetch_json(f"{OPENALEX_BASE}/works/https://doi.org/{clean}",
                                 cache=work_cache, cache_key=("work", clean))
    if status != 200 or not payload:
        return neutral
    topics = normalize_topic_records(payload)
    detail = measure_topic_diversity(topics)
    # Carry the raw assignments so the classifier can reuse them rather than
    # issuing a second identical request.
    detail["_topics"] = topics
    return detail


# ===========================================================================
# 3b. AUTHOR BIBLIOMETRICS (h-index, i10-index)
# ===========================================================================
# These were previously "present" in the API only as mislabelled fields: the
# dossier exposed MDAR adherence as `h_idx` and the RRID count as `i10_idx`.
# Those are unrelated quantities, so the reported numbers were meaningless.
#
# Real values are now fetched from OpenAlex. A deliberate design decision
# follows, and it is worth stating plainly: **these metrics are reported but do
# not contribute to piX.** CoARA's first commitment is to abandon inappropriate
# use of publication-based metrics, naming the h-index specifically, because it
# measures career stage and field citation culture as much as quality — a
# mid-career biomedical researcher and a brilliant early-career mathematician
# are not comparable on it. Letting it move a manuscript's score would
# contradict the framework's core claim while advertising CoARA alignment.
#
# They appear in the dossier as *author context*, which is what they are
# legitimately good for: situating a body of work, never grading a paper.

def fetch_author_metrics(author_name: str) -> Dict:
    """Retrieve h-index, i10-index and related counts for an author."""
    empty = {
        "resolved": False, "queried": author_name, "h_index": None, "i10_index": None,
        "works_count": None, "cited_by_count": None, "two_year_mean_citedness": None,
        "openalex_id": None, "orcid": None, "affiliation": None,
        "note": "Author could not be resolved in OpenAlex.",
    }
    if not author_name:
        return empty

    first = clean_author_name(author_name).split(",")[0].strip()
    if not first or first.lower() in ("unidentified", "unknown") or is_likely_institution(first):
        empty["note"] = "No individual author name available to resolve."
        return empty

    key = first.lower()
    cached = author_cache.get(key)
    if cached is not None:
        return cached

    try:
        status, payload = fetch_json(f"{OPENALEX_BASE}/authors",
                                     params={"search": first, "per_page": 1})
        if status == 200 and payload:
            results = payload.get("results") or []
            if results:
                a = results[0]
                stats = a.get("summary_stats") or {}
                inst = ((a.get("last_known_institutions") or [{}])[0]
                        if a.get("last_known_institutions") else
                        (a.get("last_known_institution") or {}))
                data = {
                    "resolved": True,
                    "queried": first,
                    "display_name": a.get("display_name"),
                    "h_index": stats.get("h_index"),
                    "i10_index": stats.get("i10_index"),
                    "two_year_mean_citedness": round(stats.get("2yr_mean_citedness") or 0.0, 4),
                    "works_count": a.get("works_count"),
                    "cited_by_count": a.get("cited_by_count"),
                    "openalex_id": a.get("id"),
                    "orcid": a.get("orcid"),
                    "affiliation": (inst or {}).get("display_name"),
                    "note": (
                        "Reported as author context only. Per CoARA, publication-based metrics such "
                        "as the h-index are not used to score this manuscript: they reflect career "
                        "stage and field citation culture, not the quality of the work under review."
                    ),
                    "affects_score": False,
                }
                author_cache.set(key, data)
                return data
    except Exception as e:
        logging.debug("Author bibliometrics lookup failed for %s: %s", first, e)
        empty["note"] = "OpenAlex was unreachable; author metrics unavailable for this assessment."

    author_cache.set(key, empty)
    return empty


def format_author_metrics(metrics: Dict) -> str:
    """One-line human summary for the dossier."""
    if not metrics or not metrics.get("resolved"):
        return "Author bibliometrics unavailable."
    parts = []
    if metrics.get("h_index") is not None:
        parts.append(f"h-index {metrics['h_index']}")
    if metrics.get("i10_index") is not None:
        parts.append(f"i10-index {metrics['i10_index']}")
    if metrics.get("works_count") is not None:
        parts.append(f"{metrics['works_count']} works")
    if metrics.get("cited_by_count") is not None:
        parts.append(f"{metrics['cited_by_count']:,} citations")
    return (metrics.get("display_name") or metrics.get("queried", "Author")) + ": " + ", ".join(parts) \
        if parts else "Author resolved, but no bibliometric summary is published."


# ===========================================================================
# 4. TRENDING TOPICS (live, not a hardcoded list)
# ===========================================================================
_TRENDING_CACHE = {"topics": [], "fetched_at": 0.0}
_TRENDING_TTL = 6 * 3600  # OpenAlex topic rankings move slowly; 6h is ample.


# Generic buckets OpenAlex assigns to work it cannot classify precisely. They
# dominate any volume ranking while being useless as a search suggestion.
_GENERIC_TOPIC_PATTERNS = [
    r"^(diverse|various|miscellaneous|general|other)\b",
    r"\b(and (other|related|various)|studies|topics|research)$",
    r"^(topic modeling|bibliometric|scientometric)",
    r"\beducation, innovation\b",
    r"\bdiverse (scientific|academic)\b",
]


def _is_generic_topic(name: str) -> bool:
    lowered = (name or "").strip().lower()
    if not lowered or len(lowered) < 8 or len(lowered) > 62:
        return True
    if lowered.count(" and ") >= 2:      # "A and B and C" catch-all buckets
        return True
    if any(re.search(p, lowered) for p in _GENERIC_TOPIC_PATTERNS):
        return True
    return False


def fetch_active_research_topics(limit: int = 10) -> Dict:
    """Currently *accelerating* research topics, from OpenAlex.

    Ranking purely by publication volume returns the largest historical
    buckets — "Topic Modeling", "Diverse Scientific and Economic Studies" —
    which are neither current nor useful as a starting point for discovery.

    This ranks by growth instead: the ratio of this year's output to the prior
    year's, restricted to topics with enough volume for that ratio to be
    meaningful. A topic doubling from a real base is genuinely hot; one that is
    merely large is not. Generic catch-all buckets are filtered out entirely.
    """
    import time as _time
    now = _time.time()
    if _TRENDING_CACHE["topics"] and (now - _TRENDING_CACHE["fetched_at"]) < _TRENDING_TTL:
        return {"topics": _TRENDING_CACHE["topics"], "source": "openalex", "cached": True}

    try:
        year = __import__("datetime").datetime.now().year

        def topic_counts(from_year, to_year):
            status, payload = fetch_json(
                f"{OPENALEX_BASE}/works",
                params={
                    "filter": (f"from_publication_date:{from_year}-01-01,"
                               f"to_publication_date:{to_year}-12-31,is_oa:true"),
                    "group_by": "primary_topic.id",
                    "per_page": 200,
                },
            )
            if status != 200 or not payload:
                return {}
            return {
                (g.get("key_display_name") or "").strip(): int(g.get("count") or 0)
                for g in payload.get("group_by", [])
                if g.get("key_display_name")
            }

        current = topic_counts(year - 1, year)
        previous = topic_counts(year - 3, year - 2)

        if current:
            scored = []
            # A floor on absolute volume keeps a topic that went from 2 papers
            # to 8 from outranking one that went from 400 to 1,200.
            volume_floor = max(40, sorted(current.values(), reverse=True)[
                min(len(current) - 1, 60)] if current else 40)
            for name, count in current.items():
                if _is_generic_topic(name) or count < volume_floor:
                    continue
                base = previous.get(name, 0)
                growth = (count / base) if base >= 10 else (2.0 if count >= volume_floor * 2 else 1.0)
                scored.append((name, growth, count))

            scored.sort(key=lambda x: (x[1], x[2]), reverse=True)
            names = [name for name, _, _ in scored[:limit]]
            if names:
                _TRENDING_CACHE["topics"] = names
                _TRENDING_CACHE["fetched_at"] = now
                return {"topics": names, "source": "openalex-growth", "cached": False,
                        "ranked_by": "publication growth vs. two years prior"}
    except Exception as e:
        logging.debug("Trending topics lookup failed: %s", e)

    if _TRENDING_CACHE["topics"]:
        return {"topics": _TRENDING_CACHE["topics"], "source": "openalex-stale", "cached": True}
    return {"topics": [], "source": "unavailable", "cached": False}


# ===========================================================================
# 1b. FIELD CLASSIFICATION
# ===========================================================================
# Previously every manuscript was written to the database as
# `["Computer Science"]` / `["Core Research Domain"]` — literal constants. The
# Global Map of Science was therefore not a map of anything: every node derived
# from the same two strings.
#
# Classification now has two tiers. When a DOI resolves, OpenAlex's own
# assignments are authoritative — they come from a deep-learning classifier
# over titles, abstracts and citation networks, which is far better than
# anything inferable locally. When it does not resolve, the manuscript text is
# scored against a term vocabulary per field. That vocabulary is the one
# unavoidable piece of domain knowledge here, but it drives a real measurement
# rather than substituting for one, and every assignment records which tier
# produced it so the provenance is never ambiguous.

# Top-level OpenAlex domains, with their constituent fields.
OPENALEX_DOMAINS = {
    "Physical Sciences": [
        "Computer Science", "Physics and Astronomy", "Mathematics", "Engineering",
        "Materials Science", "Chemistry", "Chemical Engineering", "Energy",
    ],
    "Life Sciences": [
        "Biochemistry, Genetics and Molecular Biology", "Agricultural and Biological Sciences",
        "Immunology and Microbiology", "Environmental Science", "Neuroscience",
    ],
    "Health Sciences": [
        "Medicine", "Nursing", "Pharmacology, Toxicology and Pharmaceutics",
        "Health Professions", "Dentistry", "Veterinary",
    ],
    "Social Sciences": [
        "Social Sciences", "Economics, Econometrics and Finance", "Psychology",
        "Business, Management and Accounting", "Arts and Humanities", "Decision Sciences",
    ],
}

FIELD_TO_DOMAIN = {f: d for d, fields in OPENALEX_DOMAINS.items() for f in fields}

# Discriminative terms per field. Chosen to be specific rather than exhaustive:
# a term that appears across many fields carries no information, so generic
# research vocabulary ("study", "results", "data") is deliberately absent.
FIELD_TERMS = {
    "Computer Science": ["algorithm", "neural network", "machine learning", "software", "dataset",
                         "computation", "training data", "classifier", "runtime", "benchmark",
                         "gpu", "inference", "source code", "compiler", "distributed system"],
    "Physics and Astronomy": ["quantum", "photon", "particle", "spectroscopy", "telescope",
                              "relativity", "plasma", "thermodynamic", "electron", "wavelength",
                              "cosmolog", "astrophys", "lattice", "superconduct"],
    "Mathematics": ["theorem", "lemma", "proof", "manifold", "topology", "algebraic",
                    "stochastic process", "convergence", "differential equation", "conjecture"],
    "Engineering": ["mechanical", "structural", "turbine", "actuator", "finite element",
                    "control system", "hydraulic", "fatigue", "load bearing", "robotics"],
    "Materials Science": ["alloy", "polymer", "crystalline", "nanoparticle", "thin film",
                          "microstructure", "tensile", "composite material", "graphene", "substrate"],
    "Chemistry": ["catalysis", "synthesis", "molecule", "reagent", "solvent", "chromatography",
                  "stoichiometr", "organic compound", "titration", "spectrometry"],
    "Chemical Engineering": ["reactor", "distillation", "process design", "mass transfer",
                             "catalytic converter", "fluidized bed"],
    "Energy": ["photovoltaic", "solar cell", "battery", "fuel cell", "renewable energy",
               "grid storage", "electrolyte", "wind turbine", "biofuel"],
    "Biochemistry, Genetics and Molecular Biology": ["gene expression", "protein", "genome", "dna",
                                                     "rna", "crispr", "enzyme", "transcription",
                                                     "sequencing", "molecular", "peptide", "plasmid"],
    "Agricultural and Biological Sciences": ["crop", "soil", "cultivar", "agronom", "livestock",
                                             "biodiversity", "ecosystem", "species richness",
                                             "photosynthesis", "harvest", "pollinat"],
    "Immunology and Microbiology": ["antibody", "pathogen", "bacteri", "virus", "immune response",
                                    "vaccine", "microbiome", "antigen", "infection", "strain"],
    "Environmental Science": ["climate", "emission", "pollutant", "carbon dioxide", "watershed",
                              "sustainability", "contaminant", "atmospheric", "greenhouse gas"],
    "Neuroscience": ["neuron", "cortex", "synap", "brain", "eeg", "fmri", "neurotransmitter",
                     "cognitive", "hippocamp", "axon"],
    "Medicine": ["patient", "clinical trial", "diagnosis", "therapy", "comorbid", "prognosis",
                 "cohort", "symptom", "treatment group", "tumor", "tumour", "surgery", "mortality"],
    "Nursing": ["nursing", "patient care", "bedside", "caregiver", "clinical practice guideline"],
    "Pharmacology, Toxicology and Pharmaceutics": ["pharmacokinetic", "dosage", "drug", "toxicity",
                                                   "bioavailability", "placebo", "adverse effect",
                                                   "compound screening"],
    "Health Professions": ["rehabilitation", "physiotherap", "occupational therapy", "public health"],
    "Dentistry": ["dental", "periodont", "enamel", "orthodont", "caries"],
    "Veterinary": ["veterinary", "canine", "bovine", "equine", "animal health"],
    "Social Sciences": ["sociolog", "demographic", "survey respondent", "qualitative interview",
                        "social network", "policy", "governance", "inequality", "ethnograph"],
    "Economics, Econometrics and Finance": ["econometric", "gdp", "market", "elasticity",
                                            "monetary", "investment", "regression discontinuity",
                                            "welfare", "fiscal", "asset pricing"],
    "Psychology": ["participants completed", "questionnaire", "cognitive bias", "behavioral",
                   "psycholog", "self-report", "stimuli", "reaction time", "personality"],
    "Business, Management and Accounting": ["firm performance", "supply chain", "stakeholder",
                                            "organizational", "marketing", "accounting", "strategy"],
    "Arts and Humanities": ["historiograph", "literary", "philosoph", "aesthetic", "archaeolog",
                            "linguistic", "discourse analysis", "manuscript tradition"],
    "Decision Sciences": ["optimization model", "operations research", "queueing", "decision theory",
                          "linear programming", "heuristic search"],
}


def classify_by_openalex_topics(topics: List[dict]) -> Dict:
    """Derive fields/subfields from OpenAlex topic assignments (authoritative)."""
    fields, subfields, domains = [], [], []
    for t in sorted(topics or [], key=lambda x: x.get("score", 0), reverse=True):
        for value, bucket in ((t.get("field"), fields), (t.get("subfield"), subfields),
                              (t.get("domain"), domains)):
            if value and value not in bucket:
                bucket.append(value)
    if not fields and not subfields:
        return {}
    return {
        "fields": fields or [FIELD_TO_DOMAIN.get(d, d) for d in domains] or ["Unclassified"],
        "subfields": subfields or fields or ["Unclassified"],
        "domains": domains,
        "basis": "openalex-topics",
        "confidence": 0.95,
    }


def classify_by_text_vocabulary(text: str, top_n: int = 3) -> Dict:
    """Score manuscript text against per-field term vocabularies.

    Uses length-normalized term frequency with a saturating count per term, so
    one term repeated fifty times cannot outweigh eight distinct terms — the
    breadth of matched vocabulary is what actually indicates a field, not the
    raw frequency of any single word.
    """
    # 25 words is about the length of a title plus one sentence — below that
    # there is genuinely nothing to classify. A higher floor was rejecting
    # ordinary abstracts and falling through to "Unclassified".
    if not text or len(text.split()) < 25:
        return {"fields": ["Unclassified"], "subfields": ["Unclassified"], "domains": [],
                "basis": "insufficient-text", "confidence": 0.0, "scores": {}}

    lowered = text.lower()
    n_words = max(1, len(lowered.split()))
    scores = {}
    for field, terms in FIELD_TERMS.items():
        matched, total = 0, 0.0
        for term in terms:
            c = lowered.count(term)
            if c:
                matched += 1
                total += min(c, 8)  # saturate: repetition is not extra evidence
        if matched:
            # Breadth of distinct matched terms dominates; density is secondary.
            breadth = matched / len(terms)
            density = (total / n_words) * 1000.0
            scores[field] = round((breadth * 0.75) + (min(density, 10.0) / 10.0 * 0.25), 5)

    if not scores:
        return {"fields": ["Unclassified"], "subfields": ["Unclassified"], "domains": [],
                "basis": "no-vocabulary-match", "confidence": 0.0, "scores": {}}

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    top = ranked[:top_n]
    best_score = top[0][1]
    # Only keep fields within a reasonable margin of the leader; a long tail of
    # weak matches is noise, not interdisciplinarity.
    kept = [f for f, s in top if s >= best_score * 0.45]
    total_all = sum(scores.values()) or 1.0
    confidence = round(min(0.85, best_score / total_all + best_score), 4)

    domains, seen = [], set()
    for f in kept:
        d = FIELD_TO_DOMAIN.get(f)
        if d and d not in seen:
            seen.add(d)
            domains.append(d)

    return {
        "fields": kept,
        "subfields": kept,
        "domains": domains,
        "basis": "text-vocabulary",
        "confidence": confidence,
        "scores": {f: s for f, s in ranked[:6]},
    }


def classify_manuscript_fields(text: str, topics: List[dict] = None) -> Dict:
    """Field classification with explicit provenance.

    OpenAlex assignments win when available; text analysis is the fallback.
    The result always records which tier produced it, so a downstream consumer
    can weight an inferred classification differently from an authoritative one.
    """
    if topics:
        from_topics = classify_by_openalex_topics(topics)
        if from_topics:
            return from_topics
    return classify_by_text_vocabulary(text)


# ===========================================================================
# 2. REFERENCE INTEGRITY ("Baseline Scout")
# ===========================================================================
_DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Za-z0-9]+\b")
_ARXIV_RE = re.compile(r"\barXiv\s*:\s*(\d{4}\.\d{4,5})(v\d+)?\b", re.IGNORECASE)

# Trailing punctuation that belongs to the sentence, not the identifier.
_DOI_TRAILING = ".,;:)]}>\"'"


def _clean_doi(raw: str) -> str:
    d = raw.strip()
    while d and d[-1] in _DOI_TRAILING:
        d = d[:-1]
    return d.lower()


def locate_bibliography(text: str) -> str:
    """Isolate the bibliography, so in-text DOIs aren't mistaken for citations.

    Takes the last plausible heading occurrence, since papers routinely say
    "references" in prose ("see references therein") before the actual section.
    The positional guard is deliberately permissive at 25%: a heading that
    early is unlikely in a full paper, but demanding a later position caused
    short documents to fall through to a whole-text scan, which then picked up
    in-text DOIs as if they were bibliography entries.
    """
    if not text:
        return ""
    lowered = text.lower()
    best_idx = -1
    for kw in ("references", "bibliography", "works cited", "literature cited"):
        # A heading on its own line is the strongest signal; fall back to any
        # occurrence only if no line-anchored heading exists.
        for candidate in (lowered.rfind(f"\n{kw}"), lowered.rfind(kw)):
            if candidate > best_idx and candidate > len(text) * 0.25:
                best_idx = candidate
                break
    if best_idx != -1:
        return text[best_idx:]
    return text[-6000:] if len(text) > 6000 else text


def extract_cited_identifiers(text: str, limit: int = 25) -> List[str]:
    """Collect unique DOIs from the reference section, order preserved."""
    section = locate_bibliography(text)
    seen, out = set(), []
    for m in _DOI_RE.finditer(section):
        d = _clean_doi(m.group(0))
        if len(d) > 8 and d not in seen:
            seen.add(d)
            out.append(d)
            if len(out) >= limit:
                break
    return out


def verify_doi_against_openalex(doi: str) -> Optional[bool]:
    """True = exists, False = definitively absent, None = inconclusive."""
    status, _ = fetch_json(f"{OPENALEX_BASE}/works/https://doi.org/{doi}",
                           cache=doi_cache, cache_key=("oa", doi))
    if status == 200:
        return True
    if status == 404:
        return False
    return None


def verify_doi_against_crossref(doi: str) -> Optional[bool]:
    status, _ = fetch_json(f"{CROSSREF_BASE}/works/{doi}/agency",
                           cache=doi_cache, cache_key=("cr", doi))
    if status == 200:
        return True
    if status == 404:
        return False
    return None


def classify_citation_validity(doi: str) -> str:
    """Classify one DOI as verified / fabricated / unverified.

    Crossref is consulted only when OpenAlex does not confirm the work, which
    halves the request count for the common case of a well-indexed reference.
    """
    oa = verify_doi_against_openalex(doi)
    if oa is True:
        return "verified"
    cr = verify_doi_against_crossref(doi)
    if cr is True:
        return "verified"
    if oa is False and cr is False:
        return "fabricated"
    return "unverified"


def audit_citation_integrity(text: str, max_checks: int = 15, budget_seconds: float = 8.0) -> Dict:
    """Verify cited DOIs against two independent registries.

    A DOI is only called fabricated when BOTH OpenAlex and Crossref
    affirmatively return 404. Crossref is the DOI registration authority, so a
    404 there is close to definitive; requiring agreement from both guards
    against transient outages being read as fabrication. Anything ambiguous is
    counted as unverified and carries no penalty whatsoever.
    """
    report = {
        "checked": 0, "verified": 0, "fabricated": 0, "unverified": 0,
        "total_found": 0, "fabricated_dois": [], "unverified_dois": [],
        "hallucination_ratio": 0.0, "verdict": "not_assessed", "warnings": [],
        "penalty_applied": False,
    }

    dois = extract_cited_identifiers(text)
    report["total_found"] = len(dois)
    if not dois:
        report["verdict"] = "no_dois_found"
        return report

    # Verified in parallel under a hard time budget. Sequentially this could
    # occupy the request for minutes when a registry is slow, which is what
    # surfaced as an unexplained gateway timeout. Anything unfinished when the
    # budget expires is reported as unverified — never as fabricated.
    candidates = dois[:max_checks]
    outcomes = run_bounded(
        ((doi, (lambda d=doi: classify_citation_validity(d))) for doi in candidates),
        budget_seconds=budget_seconds, max_workers=6,
    )

    for doi in candidates:
        report["checked"] += 1
        outcome = outcomes.get(doi, "unverified")
        if outcome == "verified":
            report["verified"] += 1
        elif outcome == "fabricated":
            report["fabricated"] += 1
            if len(report["fabricated_dois"]) < 10:
                report["fabricated_dois"].append(doi)
        else:
            report["unverified"] += 1
            if len(report["unverified_dois"]) < 10:
                report["unverified_dois"].append(doi)

    report["timed_out"] = len(outcomes) < len(candidates)

    conclusive = report["verified"] + report["fabricated"]
    ratio = (report["fabricated"] / conclusive) if conclusive else 0.0
    report["hallucination_ratio"] = round(ratio, 4)

    # Thresholds require both a proportion and an absolute count. One bad DOI
    # among three checked is 33% but is far more likely a typo than fabrication.
    if report["fabricated"] >= 3 and ratio >= 0.30:
        report["verdict"] = "fabricated_references"
        report["penalty_applied"] = True
        report["warnings"].append(
            f"HALLUCINATED REFERENCES DETECTED: {report['fabricated']} of {conclusive} verifiable cited "
            f"DOIs ({ratio * 100:.0f}%) do not exist in either OpenAlex or Crossref. Fabricated citations "
            f"are a hallmark of unchecked generative-AI text. C2 Methodological Rigor has been set to 0.0. "
            f"Examples: {', '.join(report['fabricated_dois'][:3])}."
        )
    elif report["fabricated"] > 0:
        report["verdict"] = "some_invalid"
        report["warnings"].append(
            f"INVALID REFERENCES: {report['fabricated']} cited DOI(s) could not be resolved in either "
            f"OpenAlex or Crossref ({', '.join(report['fabricated_dois'][:3])}). This may be a "
            f"transcription error rather than fabrication; no penalty applied, but verification is advised."
        )
    else:
        report["verdict"] = "clean"

    if report["unverified"]:
        report["warnings"].append(
            f"UNVERIFIED REFERENCES: {report['unverified']} cited DOI(s) could not be checked "
            f"(registry timeout, or the work is too new or not indexed). These are NOT counted as "
            f"fabricated and carry no penalty."
        )
    return report


# ===========================================================================
# 3. AUTHORSHIP ASSISTANCE SIGNAL (bias-safe, FPR-capped)
# ===========================================================================
# Hedging and self-reference vary hugely by discipline and first language, so
# they are NOT used as evidence. Only structural self-inconsistency is.
_SECTION_HEADINGS = [
    "abstract", "introduction", "background", "related work", "methods",
    "methodology", "materials and methods", "results", "discussion",
    "conclusion", "conclusions", "limitations",
]

# Formulaic connectives characteristic of unedited LLM output. Individually
# meaningless — many careful human writers use them — so they count only when
# density is extreme AND other structural evidence agrees.
_LLM_CONNECTIVES = [
    r"\bit is important to note that\b", r"\bit is worth noting that\b",
    r"\bplays a (crucial|vital|significant|pivotal) role\b",
    r"\bdelve[sd]? into\b", r"\ba testament to\b",
    r"\bin the realm of\b", r"\bnavigating the (complex|landscape)\b",
    r"\bunderscore[sd]? the importance\b", r"\bmultifaceted\b",
]


def split_into_sections(text: str) -> Dict[str, str]:
    """Split on recognised headings; returns {} when structure is unclear."""
    if not text:
        return {}
    pattern = r"(?im)^\s*(?:\d+\.?\s*)?(" + "|".join(re.escape(h) for h in _SECTION_HEADINGS) + r")\s*:?\s*$"
    parts = re.split(pattern, text)
    if len(parts) < 3:
        return {}
    sections = {}
    for i in range(1, len(parts) - 1, 2):
        name = parts[i].strip().lower()
        body = parts[i + 1]
        if len(body.split()) >= 60:
            sections[name] = body
    return sections


def measure_lexical_profile(text: str) -> Optional[Dict]:
    words = re.findall(r"[a-zA-Z']+", text.lower())
    if len(words) < 60:
        return None
    sentences = [s for s in re.split(r"[.!?]+", text) if len(s.split()) >= 3]
    if not sentences:
        return None

    lengths = [len(s.split()) for s in sentences]
    mean_len = sum(lengths) / len(lengths)
    variance = sum((l - mean_len) ** 2 for l in lengths) / len(lengths)

    counts = Counter(words)
    # Type-token ratio is length-sensitive, so sample a fixed window.
    window = words[:400]
    ttr = len(set(window)) / len(window) if window else 0.0
    hapax = sum(1 for w, c in counts.items() if c == 1) / len(counts) if counts else 0.0

    return {
        "ttr": ttr,
        "hapax_ratio": hapax,
        "mean_sentence_length": mean_len,
        # Burstiness: humans vary sentence length far more than unedited LLM prose.
        "sentence_length_cv": (math.sqrt(variance) / mean_len) if mean_len else 0.0,
        "word_count": len(words),
    }


def measure_connective_density(text: str) -> float:
    words = max(1, len(text.split()))
    hits = sum(len(re.findall(p, text, re.IGNORECASE)) for p in _LLM_CONNECTIVES)
    return (hits / words) * 1000.0  # per 1,000 words


def assess_authorship_consistency(text: str) -> Dict:
    """Advisory assessment of possible unedited generative-AI text.

    Design constraints, stated plainly because they are the point:

    * This NEVER changes a score. It is context for a human reader.
    * Low lexical variety, simple grammar and formulaic structure are NOT
      treated as evidence. Those are the documented markers that cause
      detectors to misclassify >60% of non-native English writing.
    * The only evidence used is *internal inconsistency* — a sharp shift in
      linguistic profile between sections of the same document. A researcher
      writing in a second language is consistently themselves throughout;
      a document with one section pasted in from a model is not.
    * Multiple independent indicators must agree before anything is reported,
      targeting the <=0.5% false-positive regime the literature recommends.
    """
    result = {
        "assessed": False,
        "flag": "not_assessed",
        "confidence": "none",
        "indicators": [],
        "note": "",
        "affects_score": False,
        "bias_statement": (
            "This signal deliberately ignores vocabulary richness, grammatical simplicity and "
            "sentence complexity, because those characteristics reflect a writer's first language "
            "rather than authorship. Standard detectors misclassify more than 60% of non-native "
            "English academic writing; this check is designed not to."
        ),
    }

    if not text or len(text.split()) < 400:
        result["note"] = "Document too short for a reliable authorship assessment."
        return result

    sections = split_into_sections(text)
    result["assessed"] = True
    indicators = []

    # --- Indicator 1: cross-section profile divergence ---
    profiles = {name: p for name, p in ((n, measure_lexical_profile(b)) for n, b in sections.items()) if p}
    divergence = 0.0
    if len(profiles) >= 3:
        ttrs = [p["ttr"] for p in profiles.values()]
        cvs = [p["sentence_length_cv"] for p in profiles.values()]
        spread_ttr = max(ttrs) - min(ttrs)
        spread_cv = max(cvs) - min(cvs)
        divergence = spread_ttr
        # A within-document swing this large is not explained by first language,
        # which affects every section of a document equally.
        if spread_ttr > 0.28 and spread_cv > 0.45:
            indicators.append({
                "name": "cross-section inconsistency",
                "detail": (f"Lexical profile varies sharply between sections "
                           f"(type-token spread {spread_ttr:.2f}, burstiness spread {spread_cv:.2f}), "
                           f"which a consistent single author would not normally produce."),
            })

    # --- Indicator 2: near-absent burstiness ---
    whole = measure_lexical_profile(text)
    if whole and whole["sentence_length_cv"] < 0.22:
        indicators.append({
            "name": "uniform sentence rhythm",
            "detail": (f"Sentence-length variation is unusually low "
                       f"(CV {whole['sentence_length_cv']:.2f}). Human academic prose typically "
                       f"varies more, regardless of the author's first language."),
        })

    # --- Indicator 3: extreme formulaic-connective density ---
    density = measure_connective_density(text)
    if density > 3.0:
        indicators.append({
            "name": "formulaic connective density",
            "detail": (f"Characteristic filler constructions appear {density:.1f} times per 1,000 "
                       f"words, well above typical academic usage."),
        })

    result["indicators"] = indicators
    result["metrics"] = {
        "sections_analyzed": len(profiles),
        "connective_density_per_1k": round(density, 2),
        "sentence_length_cv": round(whole["sentence_length_cv"], 3) if whole else None,
        "cross_section_divergence": round(divergence, 3),
    }

    # Reporting bar: two or more independent indicators. One alone is not
    # enough — that is exactly where false positives come from.
    if len(indicators) >= 3:
        result["flag"] = "possible_unedited_generation"
        result["confidence"] = "moderate"
        result["note"] = (
            "Multiple independent structural indicators are consistent with unedited generative-AI "
            "text. This is advisory context for a human reviewer, not a finding, and has not affected "
            "any score. It is not evidence of misconduct: assisted drafting is legitimate in most "
            "venues, and these indicators can co-occur in heavily edited or template-driven writing."
        )
    elif len(indicators) == 2:
        result["flag"] = "inconclusive"
        result["confidence"] = "low"
        result["note"] = (
            "Some structural indicators are present but fall below the reporting threshold. No "
            "conclusion is drawn and no score has been affected."
        )
    else:
        result["flag"] = "no_signal"
        result["confidence"] = "none"
        result["note"] = (
            "No structural indicators of unedited generative text were found. Note that this check "
            "is intentionally conservative and cannot establish that a document was written without "
            "assistance."
        )
    return result
