# ScholarPi — What Changed, and What I'd Do Next

Written after removing the hardcoded logic from the scoring pipeline. Two parts:
what was actually wrong and is now fixed, then a prioritised list of what I'd
tackle next.

---

## Part 1 — What was hardcoded, and what replaced it

### 1. VAPRI was a hash digest used as a score

```python
vapri = (int(hashlib.md5(evidence_report.encode()), 16) % 1000) / 1000.0
c1 = (ai_rating * 0.9) + (vapri * 10)          # up to 10 points of C1
logic_integrity = (rating * penalty) + (vapri * 5.0)   # and 5 of logic integrity
```

This is deterministic pseudo-randomness. Two manuscripts differing by one
character received unrelated VAPRI values, and roughly 10% of C1 was noise. The
same digest was also the **training target** for the Scilem network — it was
being fitted to predict a hash, which is by construction unlearnable, so any
apparent convergence was memorisation.

**Replaced by** `compute_corroboration_index()`: inter-model agreement (45%),
juror breadth (35%, log-saturating), and evidence-report substance (20%). Scilem
now trains against the adjudicated quality rating, mapped to its tanh output
range.

### 2. Every paper was labelled "Computer Science"

```python
json.dumps(["Core Research Domain"]),   # subfields — for every paper
json.dumps(["Computer Science"]),       # fields    — for every paper
```

The Global Map of Science was not a map of anything. Worse, `refine_science_field()`
then keyword-matched those two constant strings through seventeen branches, so
every paper fell through to the same terminal label.

**Replaced by** two-tier classification: OpenAlex's own topic assignments when a
DOI resolves (authoritative — a deep-learning classifier over titles, abstracts
and citation networks), falling back to breadth-weighted term-frequency scoring
against per-field vocabularies. Every classification records its provenance and
confidence, so an inferred label is never mistaken for an authoritative one.

### 3. Eight criteria, eight undocumented coefficients

```python
c1 = (ai_rating * 0.9) + (vapri * 10)
c4 = ai_rating * 0.95 + (topological_entropy * 5)
c6 = ai_rating * 0.88 + (sciscore_adherence * 12)
```

No derivation, no documentation, inconsistent scales (some multiplicative
fractions, some additive raw-point bonuses). The `min(100, max(0, …))` clamps
were hiding the fact that additive bonuses could exceed 100.

**Replaced by** `rubric.py`: a versioned rubric where each criterion is a weighted
sum of named, normalized signals, weights summing to exactly 1.0. Scores are
bounded to [0, 100] **by construction**, not by clamping. Published at
`/api/rubric`, and each criterion declares its *deterministic share* — the
fraction decided by verifiable text analysis rather than model opinion (C5 is
100%, C2 is 90%).

The dossier now shows per-signal attribution: which signal contributed how many
points, and which leaves the most unclaimed. That is what makes a score
actionable rather than merely a number.

### 4. Smaller fabrications

| Was | Now |
|---|---|
| `Overall_Confidence: 0.85` (constant) | Derived from juror count and inter-model agreement |
| `drift = "N/A"`, `rec = "N/A"` | Removed; slots carry classification and rubric breakdown |
| `credit_taxonomy_roles = ["Data Curation"]` | Inferred from CRediT patterns in the text |
| `h_idx` / `i10_idx` = MDAR score and RRID count | Real h-index/i10-index from OpenAlex |
| Title/author = first juror that answered | Fuzzy-clustered consensus vote across jurors |
| `HOT_TOPICS` frozen list | Live OpenAlex trending, 6h cache, seed only on outage |
| `MAJOR_SCIENCE_FIELDS` fixed nine | Fields actually present in the corpus, ranked by count |

### 5. New this round

- **Difficulty-scaled piQ emission** (`emission.py`) — halving every 500 papers,
  a quality bar rising 50→75 piX, and per-author decay so volume can't beat
  quality. Published at `/api/emission`.
- **Stop button** on the assessment pipeline (AbortController; per-paper billing
  means stopping mid-batch charges only what was processed).
- **Map of Science rebuild** — labelled bubbles sized by area not radius, five
  live sliders, domain legend, fit/freeze controls, and physics that actually
  settles.
- **Schema drift guard** — `enforce_database_schema` cached a global flag, so a
  running server never applied new columns. That is almost certainly what caused
  your `TypeError: network error` and `Error loading ledger`.

---

## Part 2 — Recommendations, in priority order

### Tier 1 — Correctness and trust

**1. The Scilem network is still architecturally unable to learn.**
It hashes each word to an arbitrary integer in `[0, 10000)` and embeds that. Two
occurrences of "reproducibility" collide with unrelated words at a rate governed
by the vocabulary size, and there is no relationship between token IDs and
meaning. Training it on a real target (as it now does) is a prerequisite for
learning, not a guarantee of it.
*Recommendation:* replace with a small frozen sentence-transformer over
abstracts, or drop the neural component and rely on the deterministic signals,
which are the part carrying real information. Consider whether it earns its
memory footprint at all.

**2. `final_score` is the unweighted mean of eight criteria.**
`composite_score()` supports epoch weighting but is called without weights, so
the Pidyne forecast currently predicts weights that never affect any score. Either
wire the forecast into the composite (and stamp each score with its epoch so
historical scores stay comparable), or state plainly in the UI that the forecast
is observational. Right now it implies an influence it does not have.

**3. Reference verification is serial and blocking.**
`audit_references` makes up to 30 sequential HTTP calls inside the request path.
At ~200ms each that is 6 seconds added per paper.
*Recommendation:* `asyncio.gather` with a semaphore, plus a persistent DOI-result
cache — verified DOIs never change, so this should be a near-permanent cache.

**4. No test suite in the repo.**
The 516 assertions I wrote live in `/tmp` and will not survive. They should be
`backend/tests/`, wired into the existing `.github/workflows/tests.yml`. The
high-value ones: rubric bounds and monotonicity, injection false-positives on
legitimate papers, reference-audit outage behaviour, and emission difficulty
ordering.

### Tier 2 — Substance

**5. C1 Semantic Originality doesn't measure originality.**
It is 70% panel opinion. Genuine novelty measurement means comparing against the
corpus — e.g. cosine distance between this abstract's embedding and its nearest
OpenAlex neighbours in the same subfield. That would make C1 the strongest
criterion instead of the softest.

**6. Author disambiguation is string equality.**
`author_name = ?` means "J. Smith" and "John Smith" are different researchers,
and the piQ leaderboard is unreliable as a result. OpenAlex author IDs (already
fetched for h-index) or ORCID should be the join key.

**7. The corpus is never revisited.**
Scores are computed once and frozen. When the rubric version changes, old scores
become incomparable to new ones with nothing surfacing that. A re-scoring job
that replays stored `signal_vector`s through the current rubric would fix this
cheaply — the signal vectors are already persisted for exactly this purpose.

### Tier 3 — Reach

**8. Zotero plugin.** `/api/dossier/by-doi` exists and is the hard part. A
~200-line plugin surfacing piX in a user's library is the single highest-leverage
adoption step available, per Part VI of your research.

**9. Batch/institutional API.** Institutions will not upload PDFs one at a time.
An authenticated endpoint accepting a DOI list and returning a job ID would make
departmental evaluation feasible.

**10. Reviewer-in-the-loop.** The framework claims algorithms are auditors, not
replacements. Nothing currently lets a human reviewer record agreement or
disagreement with a criterion score. Capturing that would both honour the claim
and produce the labelled dataset needed for anything genuinely learned.

### Things I'd deliberately *not* do

- **Don't let h-index affect piX.** It is reported as author context and
  excluded from scoring on purpose. CoARA's first commitment names the h-index
  specifically; letting it move a manuscript's score would contradict the
  framework's central claim while advertising CoARA alignment.
- **Don't lower the authorship-signal reporting bar.** It requires three
  independent indicators and ignores lexical variety by design. Making it more
  sensitive would reintroduce exactly the bias against non-native English writers
  that Part V of your research warns about.
- **Don't add a general-purpose AI-detection score.** Same reason, larger blast
  radius.

---

## Open question worth deciding

**The processing fee now scales with difficulty.** Held flat at 0.1 piQ it would
have exceeded what even a perfect paper mints from epoch 5 onward — every user
spending faster than they could earn, and participation ending for accounting
reasons rather than quality ones. Scaling the fee by the same halving factor
keeps a qualifying paper net-positive at every epoch.

If you'd rather the fee stayed literally fixed at 0.1 piQ, that is a coherent
choice, but it makes the system terminal at scale. Set `PIQ_PROCESSING_FEE` and
override `current_fee()` in `emission.py` if you want that behaviour.
