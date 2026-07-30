# ScholarPi — Logical Flaws, and the Grounds Worth Standing On

**Status: all findings below have been addressed.** Each section states what
was wrong and what now happens instead. The critique is kept in full rather
than rewritten into a changelog, because the reasoning is the part worth
keeping — a future change that quietly reintroduces one of these should be
recognisable as such.

Flaws are separated into **code bugs** (the implementation was wrong) and
**conceptual** (the design claimed more than the mechanism could deliver). The
conceptual ones mattered more, and fixing them meant giving up some of what the
project claimed.

---

## Part 1 — Code-level flaws

### 1.1 piQ is minted to the submitter, not the author

`book_address` is the connected wallet of whoever pressed the button, and that
is what `eth_book` records and what the leaderboard aggregates.

Anyone can submit anyone else's paper via DOI lookup or Auto-Discover. So the
optimal strategy for maximising piQ is **not to write good papers** — it is to
submit other people's good papers before they do. The entire incentive
structure inverts under thirty seconds of adversarial thought.

The per-author emission decay makes this worse, not better: it penalises a
prolific *author*, but the farmer is submitting under one wallet across many
authors, so the decay barely bites while the honest researcher's own rate falls.

**Fixed** — `attribution.py`. piQ is minted only when the submitter is verified
as an author, by one of two routes: their ORCID appears in the publisher's
deposited record for the DOI (conclusive), or their verified ORCID profile name
matches an extracted author (strong). Third-party submission still works and is
still fully assessed and published — it simply earns nothing, and the refusal
explains how to qualify.

Name matching is deliberately conservative: surname must match exactly and the
given name in full or by initial. Surname alone is rejected, because a
collision there mints someone else's tokens to you. A registry outage never
credits.

### 1.2 The epoch-weight feedback loop points the wrong way

`derive_next_epoch_weights` states its own logic plainly:

> a criterion that manuscripts consistently score well on is well-evidenced and
> carries more weight; one they score poorly on is sparsely evidenced and is
> down-weighted

That is backwards on information-theoretic grounds. A criterion **everyone
satisfies carries almost no information** — it cannot discriminate between
papers. A criterion with high variance across the corpus is the one doing the
discriminating work. Weighting by the mean rather than the variance
systematically inflates the influence of whatever the corpus already does well.

Worse, it is a positive feedback loop: high scores raise the weight, the raised
weight raises future composites on that criterion, which raises the weight
again. Left running, the composite converges on whichever criterion was easiest
to satisfy at the start.

**Fixed.** Weights now track *discriminating power*: distance from the
midpoint, which peaks for criteria that separate manuscripts and falls to a
floor for ones everything scores 5 or 95 on. Where corpus history exists,
measured standard deviation is used directly, since that is the quantity the
proxy was approximating. Inertia rose from 0.72 to 0.86, so the series is a
trend rather than an echo of the last submission.

Verified: given seven criteria at 95 and one at 50, the mid-range criterion now
receives roughly three times the weight of the others. Under the old rule it
would have received the least.

### 1.3 No appeals path for an automated accusation

Injection detection sets logic integrity to 0.0 and records "research
misconduct" language in a permanent ledger. The canary evidence is strong, but
it is not infallible — a model can emit the token spuriously, and the static
scanner can misread an unusual layout.

There is no review queue, no human override, and the record is explicitly
designed to be immutable. A system that can permanently mark someone as having
attempted misconduct, with no recourse, is not one I would deploy against real
researchers.

**Fixed.** Findings now set `status: quarantined` and `review_required: True`,
withhold piQ, and carry an explicit appeal note stating that this is a finding
rather than a determination of misconduct. The word "misconduct" was removed
from every recorded warning.

---

## Part 2 — Conceptual flaws

These are not bugs. They are places where the design claims more than the
mechanism can deliver.

### 2.1 "Uncorrelated errors" is the load-bearing claim, and it is overstated

The judgement-quality grading rests on this: *jurors from different providers
have uncorrelated errors, so agreement is evidence.*

Llama, Mistral, Qwen and Gemini are trained on heavily overlapping web corpora,
use broadly similar transformer architectures, are tuned against overlapping
preference data, and are increasingly distilled from one another. Their errors
are **correlated**, substantially. When four models agree that a paper is
novel, some of that agreement is shared prior, not independent confirmation.

The system currently reads agreement as near-linear evidence of truth. It
should not. The honest version: agreement rules out *idiosyncratic* error, not
*systematic* error — and systematic error is exactly what a shared training
distribution produces. Cross-model agreement on a claim that is popular-but-
wrong in the literature is precisely the case where all four will agree and all
four will be wrong.

**Fixed, and strengthened.** The metric is relabelled: tiers are now
**Strong / Partial / Single-source corroboration** rather than High / Moderate /
Limited *judgement quality*. Every rationale states the limit explicitly —
agreement rules out idiosyncratic error but not systematic error common to
models sharing a training distribution.

Beyond relabelling, the panel gained a **DeepSeek-lineage juror**. That is not
redundancy: a juror from a genuinely different model lineage makes the
independence assumption more nearly true, which is the only way to strengthen
corroboration rather than just add another correlated vote.

### 2.2 C1 and C4 are not properties of a document

**Originality** is a relation between a document and a field. **Societal
impact** is a relation between a document and the future. Neither is contained
in the PDF, and no amount of reading it more carefully will extract them.

C1 is 70% panel opinion. C4 is 45% panel opinion plus a licence check. The
system produces a number to two decimal places for quantities it has no access
to. That the number is stable and well-documented does not make it a
measurement.

This is the single largest gap between what the rubric appears to say and what
it can support.

**Fixed** — rubric v3.0. Both are now marked `interpretive: True` and their
weights rebalanced away from model opinion: C1's panel weight fell from 0.70 to
0.45 with the remainder moved onto verifiable citation engagement and reference
integrity; C4 was renamed **Societal Reach** — which *is* measurable — and now
leads on open licensing rather than the panel's guess.

`composite_confidence()` publishes the split: **78% of the composite now
derives from verifiable analysis, 22% from model interpretation**, up from 66/34.
The UI states this, and `/api/rubric` exposes the exact figures.

Grounding C1 in embedding distance to nearest OpenAlex neighbours remains the
right long-term answer and is not done.

### 2.3 piX is the thing CoARA asks you not to build

CoARA's first commitment is to stop reducing research quality to a single
metric and stop ranking people by it. ScholarPi:

- reduces a manuscript to a single 0–100 number,
- mints a token proportional to that number,
- ranks researchers by accumulated tokens on a public leaderboard.

The system reports the h-index while pointedly excluding it from scoring — and
then does the same reductive thing with a different number. "Our single number
is better designed than their single number" is a real argument, but it is not
the argument the CoARA framing implies.

**Addressed by reframing rather than deletion.** piX is now presented
throughout as a **Reporting & Integrity Score**, and the help text opens by
stating that it does not measure research quality. The leaderboards carry the
same caveat inline. The piQ board is labelled as ranking *reporting practice*.

The defence that remains — and it is a real one — is that piX is transparent
and per-criterion decomposable where JIF and h-index are not. A researcher can
see exactly which signal cost them points. That is a genuine difference in
kind, not degree.

### 2.4 The blockchain does not constrain the party that needs constraining

The stated threat is tampering with assessment records. But the operator
controls the database, the scoring code, the rubric, the minting key, and the
server. Immutability of the ledger protects against an attacker who can modify
SQLite but cannot modify anything else — which is nobody.

A researcher who does not trust the operator gains nothing from the chain,
because the operator can simply score differently before anything is written.
A researcher who does trust the operator did not need the chain.

**Fixed** — the claim is narrowed in the explorer help, verbatim: the chain
provides timestamped, non-repudiable evidence that an assessment produced a
specific result at a specific time, so the operator cannot revise their own past
outputs unnoticed. It explicitly does *not* make the system trustless, because
whoever runs the deployment controls the scoring code, the rubric and the
signing key. **The ledger constrains revision, not authorship.**

### 2.5 The economy is closed and regressive

piQ funds assessment; piQ is earned by scoring well; therefore the researchers
who can afford to use the system most are those already producing
well-reported work with good infrastructure.

The three-paper free tier is where a new user gets stuck. A researcher without
institutional support — the exact constituency CoARA and the Global South
open-science literature are concerned with — is the one who runs out first and
cannot easily earn more. The difficulty schedule makes this strictly worse over
time.

**Partly fixed.** Linking a verified ORCID now grants a one-time **2.0 piQ
onboarding stake** — roughly nineteen papers at the current fee. It is gated on
a verified identity so it cannot be farmed, idempotent per identity, and turns
the free tier from a wall into an on-ramp.

The closed-loop critique stands and is not solvable in code. piQ has no
exogenous demand; its only use is access to the system that mints it. That is a
real limitation of the token model and should be stated rather than papered
over.

### 2.6 The system measures reporting quality, not research quality

This is the deepest one, and it is not a criticism so much as an identification.

Look at what actually works: MDAR adherence, RRID registration, data
availability statements, open licences, container specifications, statistical
reporting density, reference resolvability. Every one of these is a **reporting
practice**. A meticulously reported weak study will outscore a brilliantly
insightful but sparsely documented one. The rubric's own `deterministic_share`
field makes this visible: the criteria the system measures well are exactly the
ones about documentation.

That is a real and useful thing to measure. It is simply not "research
quality".

**This is now the project's stated position.** The rubric docstring, the API
manifest, the piX help text and the leaderboard captions all say so directly:
*measures reporting quality and research integrity; does not measure the
importance or correctness of the underlying research.* A meticulously reported
weak study will outscore a brilliant but sparsely documented one, and saying so
plainly is more defensible than hoping nobody notices.

---

## Part 3 — Grounds worth standing on

Here is the version of this project I would defend without reservation.

### ScholarPi is a reporting-integrity auditor for manuscripts

Not a quality judge. Not a replacement for peer review. An automated,
transparent, pre-submission audit of the things about a paper that are
**checkable** — and that reviewers currently check inconsistently, slowly, or
not at all.

That claim is fully supported by what the code does, and it addresses a real
problem.

**1. The checkable things genuinely go unchecked.**
Whether a paper registers its RRIDs, states a power analysis, deposits code
under a licence, or cites works that actually exist — these are objective and
verifiable, and human reviewers routinely miss them because checking is tedious
and unrewarded. Automating exactly this is a good division of labour: machines
do the mechanical verification, humans do the judgement.

**2. Reference verification addresses a live 2025–26 problem.**
Fabricated citations from unchecked generative text are a documented failure
mode serious enough that arXiv now sanctions it. Verifying cited DOIs against
two independent registries — and carefully distinguishing "does not exist" from
"could not check" — is a real contribution, and the conservative design (both
registries must agree; outages never accuse) is exactly right.

**3. The prompt-injection defence addresses a documented attack.**
Hidden instructions in submitted PDFs were found at major venues. Any venue
using LLM assistance is exposed. The two-layer defence here — static
concealed-text scanning plus a cryptographic canary the manuscript cannot
predict — is a sound design, and I am not aware of a deployed alternative that
does both.

**4. The bias-safe authorship signal is better than the market.**
Commercial AI detectors misclassify a large fraction of non-native English
writing. Building a check that deliberately ignores lexical variety and
grammatical simplicity, requires multiple independent indicators, and refuses
to affect any score is a defensible ethical position that most vendors have not
taken. This is a genuine differentiator and worth foregrounding.

**5. Transparency is real and unusual.**
The full rubric with every weight is published at an endpoint. Each criterion
declares how much of it is deterministic versus model opinion. Each score
decomposes to per-signal point contributions with the largest unclaimed gap
named. Compare that to JIF, which is a proprietary ratio, or h-index, which
nobody can decompose at all. This is the CoARA-aligned part, and it is
substantive.

**6. The right user is the author, pre-submission.**
Positioned as a self-check — *"before you submit, here are eleven verifiable
things reviewers will notice and you can still fix"* — everything above is
strength and none of the conceptual flaws bite. No leaderboard, no ranking of
people, no claim to measure quality, no need for the token economy to work.

### What changed, and what has not

**Done:**

- piX presented as a **Reporting & Integrity Score** wherever a user meets it.
- C1 and C4 demoted, relabelled interpretive, model-opinion share cut to 22%.
- Leaderboards retained but captioned to say they rank reporting practice.
- Submitter-vs-author attribution fixed before the token had real value.
- Corroboration relabelled, correlated-error caveat stated, independent-lineage
  juror added.
- Chain claim narrowed to non-repudiation.
- Onboarding grant to open the economy.
- Integrity findings quarantined rather than published as accusations.

**Not done, deliberately:**

- **The leaderboard still exists.** Removing it entirely is defensible but
  removes the project's main feedback loop; the caveat is the compromise.
- **C1 is still not grounded in a measurement.** Embedding distance to
  OpenAlex neighbours is the right fix and requires infrastructure not present.
- **The token economy remains closed.** No amount of code fixes that.

None of the completed changes weakens the project. They remove what a hostile
reviewer would attack first and leave what is genuinely defensible — which is
most of the engineering and all of the integrity work.

---

## One thing I would not concede

The objection "this is just AI grading papers, which is bad" does not land
against the design as built. The deterministic majority of the rubric never
consults a model, the model panel's influence is explicitly bounded and
published per-criterion, and the system refuses to score what it cannot
measure in several places where it would have been easy not to.

That restraint is the most defensible feature of the project. It should be the
headline, not a footnote.
