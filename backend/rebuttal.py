"""
Genetic-algorithm optimisation of reviewer-facing rebuttal strategies.

Unconstrained LLM generation produces review feedback that is vague,
sycophantic, or generically encouraging — the "lazy review" failure mode. The
LAZYREVIEWPLUS line of work shows that evolving issue-specific templates under
an explicit multi-objective fitness function yields markedly more actionable
feedback than free-form generation.

The approach here is deliberately deterministic and self-contained:

* Candidates are assembled from criterion-specific clause banks — an opening
  diagnosis, one or more concrete remedies, and a verifiable commitment —
  rather than sampled from a language model. Every clause is written to be
  actionable, so the optimiser is choosing among good options rather than
  trying to rescue bad ones.
* Fitness is a weighted multi-objective score over conciseness, readability
  (Flesch reading ease), template adherence, actionability, specificity, and a
  hard penalty on sycophantic or off-task language.
* Selection is Boltzmann tournament: temperature starts high (exploration) and
  anneals down (exploitation), which avoids the premature convergence a plain
  greedy tournament shows on small populations.

Running without an LLM makes this reproducible, free, instant, and impossible
to prompt-inject — desirable properties for a component whose output the
researcher is expected to act on.
"""
import re
import math
import random
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# Criterion knowledge base
# ---------------------------------------------------------------------------
CRITERION_META = {
    "C1_Semantic_Originality": {
        "label": "Semantic Originality",
        "diagnosis": [
            "The novelty claim is not clearly separated from prior work.",
            "The contribution overlaps substantially with the existing literature as presented.",
            "The manuscript does not articulate what is new relative to the closest prior art.",
        ],
        "remedies": [
            "add an explicit 'Contributions' list of three to five numbered claims in the introduction",
            "include a comparison table positioning this work against the three closest prior papers",
            "state plainly, in one sentence, what was impossible before this work",
            "move the delta from prior work into the abstract rather than the discussion",
        ],
        "commitment": [
            "Reviewers can then verify novelty in under a minute instead of inferring it.",
            "This converts an implicit claim into one an editor can check directly.",
        ],
    },
    "C2_Methodological_Rigor_SciScore": {
        "label": "Methodological Rigor",
        "diagnosis": [
            "Reporting standards for methodology are incompletely met.",
            "The methods section omits elements required by MDAR reporting standards.",
            "Key experimental-design safeguards are not described.",
        ],
        "remedies": [
            "state randomization and blinding procedures explicitly, or state clearly that they do not apply and why",
            "report the power analysis or sample-size justification that determined N",
            "register every antibody, cell line, organism and software tool with its RRID",
            "add a per-experiment table of N, replicates and the exact statistical test used",
        ],
        "commitment": [
            "These are checkable facts, so addressing them removes the reviewer's main objection outright.",
            "Each item is a single sentence to add and closes a specific reporting gap.",
        ],
    },
    "C3_Interdisciplinary_Entropy": {
        "label": "Interdisciplinary Synergy",
        "diagnosis": [
            "The work is positioned within a single narrow subfield.",
            "Cross-domain relevance is present but not made explicit.",
            "The framing limits the manuscript's apparent reach.",
        ],
        "remedies": [
            "add a short subsection on implications for at least one adjacent discipline",
            "cite foundational work from a neighbouring field to anchor the cross-domain claim",
            "reframe the abstract so the problem is legible to readers outside the immediate speciality",
        ],
        "commitment": [
            "Breadth of readership is assessed from the framing, not only from the results.",
            "This widens the reviewer pool likely to champion the paper.",
        ],
    },
    "C4_Societal_Impact": {
        "label": "Societal Impact",
        "diagnosis": [
            "Broader impact is asserted rather than evidenced.",
            "The pathway from result to real-world consequence is not traced.",
            "Downstream beneficiaries are left unspecified.",
        ],
        "remedies": [
            "identify the specific stakeholder group that can act on this result",
            "quantify the expected effect with a concrete scenario rather than a general claim",
            "state the limitations and risks of deployment alongside the benefits",
        ],
        "commitment": [
            "Funders assess impact statements on specificity, not enthusiasm.",
            "A named beneficiary and a number outperform a paragraph of general claims.",
        ],
    },
    "C5_Open_Science_Repro": {
        "label": "Open Science",
        "diagnosis": [
            "Reproducibility artefacts are not detectable in the manuscript.",
            "No data or code availability statement was found.",
            "The work cannot currently be independently reproduced from what is provided.",
        ],
        "remedies": [
            "deposit code in a public repository and cite the archived DOI, not a bare URL",
            "add a formal Data Availability Statement naming the repository and access conditions",
            "publish a container or environment specification pinning exact dependency versions",
            "apply an explicit open licence to both data and code",
        ],
        "commitment": [
            "This is the highest-yield change available: it is mechanical, and it is scored deterministically.",
            "Archived artefacts are verified automatically, so the gain is immediate and certain.",
        ],
    },
    "C6_Literature_Integration": {
        "label": "Literature Integration",
        "diagnosis": [
            "Engagement with foundational literature is thin.",
            "Citations are present but not integrated into the argument.",
            "Contradictory prior findings are not addressed.",
        ],
        "remedies": [
            "engage directly with results that contradict yours rather than omitting them",
            "replace citation lists with sentences explaining what each cited work established",
            "add the seminal references that a domain expert would expect to see",
        ],
        "commitment": [
            "Reviewers read the reference list for gaps first; closing them pre-empts the objection.",
            "Addressing contradictory evidence strengthens rather than weakens the argument.",
        ],
    },
    "C7_Empirical_Density": {
        "label": "Empirical Density",
        "diagnosis": [
            "Quantitative support is sparse relative to the claims made.",
            "Results are described qualitatively where numbers are available.",
            "Effect sizes and uncertainty are not consistently reported.",
        ],
        "remedies": [
            "report effect sizes with confidence intervals, not p-values alone",
            "state exact sample sizes for every reported comparison",
            "add a summary table of quantitative results with dispersion measures",
            "replace qualitative descriptions such as 'substantially improved' with measured values",
        ],
        "commitment": [
            "Every claim that carries a number becomes independently checkable.",
            "This is usually a reporting change rather than new experimental work.",
        ],
    },
    "C8_Future_Actionability_FAIR": {
        "label": "Future Actionability",
        "diagnosis": [
            "The path for others to build on this work is unclear.",
            "Outputs are not described in FAIR terms.",
            "Future directions are listed without enough detail to be actionable.",
        ],
        "remedies": [
            "assign persistent identifiers to all outputs and describe them with standard metadata",
            "state the concrete next experiment precisely enough for another group to run it",
            "document the limitations that define where the method does and does not apply",
        ],
        "commitment": [
            "Actionability is assessed from specificity; a named next step outperforms a general direction.",
            "FAIR-compliant outputs remain discoverable and citable long after publication.",
        ],
    },
}

_SYCOPHANTIC = [
    r"\bexcellent\b", r"\boutstanding\b", r"\bgroundbreaking\b", r"\bbrilliant\b",
    r"\bamazing\b", r"\bfantastic\b", r"\bwonderful\b", r"\bimpressive work\b",
    r"\bstrongly recommend\b", r"\bflawless\b", r"\bperfect\b", r"\bworld-class\b",
]
_OFF_TASK = [
    r"\bas an ai\b", r"\bi (cannot|can't|am unable)\b", r"\blanguage model\b",
    r"\bi hope this helps\b", r"\bfeel free to\b", r"\bgood luck\b",
    r"\bplease let me know\b", r"\bin conclusion,? (i|we) (think|believe)\b",
]
_ACTIONABLE_VERBS = [
    "add", "state", "report", "deposit", "register", "publish", "cite", "include",
    "replace", "quantify", "identify", "document", "assign", "engage", "apply", "move",
]


# ---------------------------------------------------------------------------
# Readability
# ---------------------------------------------------------------------------
def count_syllables(word: str) -> int:
    word = word.lower().strip(".,;:!?()[]\"'")
    if not word:
        return 0
    vowels = "aeiouy"
    count, prev_vowel = 0, False
    for ch in word:
        is_vowel = ch in vowels
        if is_vowel and not prev_vowel:
            count += 1
        prev_vowel = is_vowel
    if word.endswith("e") and count > 1:
        count -= 1
    return max(1, count)


def flesch_reading_ease(text: str) -> float:
    """Standard Flesch score. Higher is easier; ~30-50 is typical for academic prose."""
    sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
    words = re.findall(r"[A-Za-z']+", text)
    if not sentences or not words:
        return 0.0
    syllables = sum(count_syllables(w) for w in words)
    return 206.835 - 1.015 * (len(words) / len(sentences)) - 84.6 * (syllables / len(words))


# ---------------------------------------------------------------------------
# Fitness
# ---------------------------------------------------------------------------
FITNESS_WEIGHTS = {
    "conciseness": 0.20,
    "readability": 0.15,
    "actionability": 0.28,
    "specificity": 0.22,
    "adherence": 0.15,
}
TARGET_WORDS = 95


def score_rebuttal_fitness(candidate: str, criterion_key: str) -> Dict:
    """Multi-objective fitness in [0, 1], with the components exposed.

    Penalties are subtractive and uncapped-downward so a single sycophantic or
    off-task phrase reliably eliminates a candidate regardless of how well it
    scores elsewhere.
    """
    words = candidate.split()
    n_words = len(words)
    scores = {}

    # Conciseness: triangular around the target length.
    scores["conciseness"] = max(0.0, 1.0 - abs(n_words - TARGET_WORDS) / TARGET_WORDS)

    # Readability: reward the 30-60 Flesch band appropriate for expert readers.
    flesch = flesch_reading_ease(candidate)
    if 30 <= flesch <= 60:
        scores["readability"] = 1.0
    elif flesch < 30:
        scores["readability"] = max(0.0, flesch / 30.0)
    else:
        scores["readability"] = max(0.0, 1.0 - (flesch - 60) / 60.0)

    lowered = candidate.lower()

    # Actionability: density of imperative verbs the author can act on.
    verb_hits = sum(1 for v in _ACTIONABLE_VERBS if re.search(rf"\b{v}\b", lowered))
    scores["actionability"] = min(1.0, verb_hits / 4.0)

    # Specificity: concrete nouns, numbers and named artefacts beat generalities.
    specifics = len(re.findall(r"\b(RRID|DOI|N\s*=|\d+)\b", candidate))
    specifics += sum(1 for t in ("repository", "container", "licence", "license", "metadata",
                                 "confidence interval", "effect size", "sample size", "table")
                     if t in lowered)
    scores["specificity"] = min(1.0, specifics / 5.0)

    # Adherence: required structural elements present.
    meta = CRITERION_META.get(criterion_key, {})
    label = meta.get("label", "")
    adherence = 0.0
    if label and label.lower() in lowered:
        adherence += 0.34
    if re.search(r"\d{1,3}(\.\d)?\s*/\s*100|\bscored?\b|\bcurrently\b", lowered):
        adherence += 0.33
    if any(re.search(rf"\b{v}\b", lowered) for v in _ACTIONABLE_VERBS):
        adherence += 0.33
    scores["adherence"] = min(1.0, adherence)

    base = sum(scores[k] * w for k, w in FITNESS_WEIGHTS.items())

    penalty = 0.0
    syc = sum(1 for p in _SYCOPHANTIC if re.search(p, lowered))
    off = sum(1 for p in _OFF_TASK if re.search(p, lowered))
    penalty += 0.25 * syc
    penalty += 0.40 * off
    if n_words > 220:
        penalty += 0.20
    if n_words < 25:
        penalty += 0.30

    return {
        "fitness": max(0.0, base - penalty),
        "components": {k: round(v, 4) for k, v in scores.items()},
        "penalty": round(penalty, 4),
        "flesch": round(flesch, 1),
        "words": n_words,
        "sycophancy_hits": syc,
        "off_task_hits": off,
    }


# ---------------------------------------------------------------------------
# Genetic algorithm
# ---------------------------------------------------------------------------
def compose_rebuttal_text(criterion_key: str, score: float, diag_i: int, remedy_idx: List[int],
             commit_i: int) -> str:
    meta = CRITERION_META[criterion_key]
    diagnosis = meta["diagnosis"][diag_i % len(meta["diagnosis"])]
    remedies = [meta["remedies"][i % len(meta["remedies"])] for i in remedy_idx]
    # Preserve order while removing duplicates introduced by crossover.
    seen, ordered = set(), []
    for r in remedies:
        if r not in seen:
            seen.add(r)
            ordered.append(r)
    commitment = meta["commitment"][commit_i % len(meta["commitment"])]

    if len(ordered) == 1:
        remedy_text = f"To address this, {ordered[0]}."
    else:
        joined = "; ".join(ordered[:-1]) + f"; and {ordered[-1]}"
        remedy_text = f"To address this: {joined}."

    return (f"{meta['label']} is the weakest criterion, currently scored {score:.1f}/100. "
            f"{diagnosis} {remedy_text} {commitment}")


def random_rebuttal_genome(meta: dict, rng: random.Random) -> Dict:
    return {
        "diag": rng.randrange(len(meta["diagnosis"])),
        "remedies": rng.sample(range(len(meta["remedies"])),
                               k=rng.randint(2, min(3, len(meta["remedies"])))),
        "commit": rng.randrange(len(meta["commitment"])),
    }


def crossover_genomes(a: Dict, b: Dict, rng: random.Random) -> Dict:
    child_remedies = list({*a["remedies"][:1], *b["remedies"][:2]})
    if not child_remedies:
        child_remedies = a["remedies"]
    return {
        "diag": rng.choice([a["diag"], b["diag"]]),
        "remedies": child_remedies[:3],
        "commit": rng.choice([a["commit"], b["commit"]]),
    }


def mutate_genome(g: Dict, meta: dict, rng: random.Random, rate: float = 0.3) -> Dict:
    g = {"diag": g["diag"], "remedies": list(g["remedies"]), "commit": g["commit"]}
    if rng.random() < rate:
        g["diag"] = rng.randrange(len(meta["diagnosis"]))
    if rng.random() < rate:
        pool = [i for i in range(len(meta["remedies"])) if i not in g["remedies"]]
        if pool and g["remedies"]:
            g["remedies"][rng.randrange(len(g["remedies"]))] = rng.choice(pool)
    if rng.random() < rate:
        g["commit"] = rng.randrange(len(meta["commitment"]))
    if rng.random() < rate * 0.5 and len(g["remedies"]) < 3:
        pool = [i for i in range(len(meta["remedies"])) if i not in g["remedies"]]
        if pool:
            g["remedies"].append(rng.choice(pool))
    return g


def select_by_boltzmann_tournament(pop: List[Tuple[Dict, float]], temperature: float,
                      rng: random.Random) -> Dict:
    """Boltzmann tournament selection.

    High temperature keeps selection near-uniform (exploration); as it anneals,
    probability mass concentrates on the fittest genomes (exploitation). This
    avoids the premature convergence a plain greedy tournament exhibits on the
    small populations used here.
    """
    if not pop:
        return {}
    t = max(0.05, temperature)
    best = max(f for _, f in pop)
    weights = [math.exp((f - best) / t) for _, f in pop]
    total = sum(weights)
    if total <= 0:
        return rng.choice(pop)[0]
    r = rng.random() * total
    acc = 0.0
    for (genome, _), w in zip(pop, weights):
        acc += w
        if acc >= r:
            return genome
    return pop[-1][0]


def evolve_rebuttal_for_criterion(criterion_key: str, score: float, generations: int = 12,
                      population_size: int = 24, seed: int = None) -> Dict:
    """Evolve the highest-fitness rebuttal for one criterion.

    Seeded from the criterion and score by default, so the same weakness always
    yields the same advice — a researcher re-opening a dossier should not see
    the recommendation change underneath them.
    """
    meta = CRITERION_META.get(criterion_key)
    if not meta:
        return {
            "text": (f"Focus on strengthening {criterion_key} (currently {score:.1f}/100). "
                     f"State the methodology explicitly, register RRIDs, and deposit raw artefacts "
                     f"in an open repository."),
            "fitness": 0.0, "generations": 0, "history": [],
        }

    if seed is None:
        seed = abs(hash((criterion_key, round(score, 1)))) % (2 ** 31)
    rng = random.Random(seed)

    population = [random_rebuttal_genome(meta, rng) for _ in range(population_size)]
    history = []
    best_genome, best_fit, best_eval = None, -1.0, None

    for gen in range(generations):
        scored = []
        for g in population:
            text = compose_rebuttal_text(criterion_key, score, g["diag"], g["remedies"], g["commit"])
            ev = score_rebuttal_fitness(text, criterion_key)
            scored.append((g, ev["fitness"]))
            if ev["fitness"] > best_fit:
                best_fit, best_genome, best_eval = ev["fitness"], g, ev

        history.append({
            "generation": gen,
            "best": round(max(f for _, f in scored), 4),
            "mean": round(sum(f for _, f in scored) / len(scored), 4),
        })

        # Anneal from exploratory to exploitative.
        temperature = 1.0 * (1.0 - gen / max(1, generations))

        # Elitism: the incumbent best always survives intact.
        next_pop = [best_genome]
        while len(next_pop) < population_size:
            p1 = select_by_boltzmann_tournament(scored, temperature, rng)
            p2 = select_by_boltzmann_tournament(scored, temperature, rng)
            next_pop.append(mutate_genome(crossover_genomes(p1, p2, rng), meta, rng))
        population = next_pop

    text = compose_rebuttal_text(criterion_key, score, best_genome["diag"],
                    best_genome["remedies"], best_genome["commit"])
    return {
        "text": text,
        "fitness": round(best_fit, 4),
        "evaluation": best_eval,
        "generations": generations,
        "population_size": population_size,
        "history": history,
        "criterion": meta["label"],
    }


def generate_rebuttal_strategy(scores_dict: dict) -> str:
    """Public entry point. Optimises advice for the two weakest criteria."""
    if not scores_dict:
        return "No criteria scores are available to analyse."

    numeric = {}
    for k, v in scores_dict.items():
        try:
            numeric[k] = float(v)
        except (TypeError, ValueError):
            continue
    if not numeric:
        return "No numeric criteria scores are available to analyse."

    ranked = sorted(numeric.items(), key=lambda kv: kv[1])
    primary_key, primary_score = ranked[0]
    primary = evolve_rebuttal_for_criterion(primary_key, primary_score)

    parts = [
        "**Adversarial Defense Strategy**",
        "",
        "**Priority 1 — highest-leverage weakness**",
        primary["text"],
    ]

    if len(ranked) > 1:
        secondary_key, secondary_score = ranked[1]
        # Only worth raising when it is genuinely also weak.
        if secondary_score < 70:
            secondary = evolve_rebuttal_for_criterion(secondary_key, secondary_score)
            parts += ["", "**Priority 2 — next most material**", secondary["text"]]

    strongest_key, strongest_score = ranked[-1]
    strongest_label = CRITERION_META.get(strongest_key, {}).get("label", strongest_key)
    parts += [
        "",
        f"**Leverage your strength.** {strongest_label} is your strongest criterion at "
        f"{strongest_score:.1f}/100. Lead with it in the cover letter so the editor encounters the "
        f"paper's strongest dimension before its weakest.",
        "",
        f"*Strategy optimised over {primary['generations']} generations "
        f"(fitness {primary['fitness']:.3f}), scored on actionability, specificity, conciseness "
        f"and readability, with sycophantic and off-task language penalised.*",
    ]
    return "\n".join(parts)
