# ScholarPi — Logical Flaws, and the Grounds Worth Standing On

You asked for two things: the logical flaws in the project, and defensible
grounds for it. Both are here, and they are related — the strongest case for
ScholarPi requires giving up some of what it currently claims.

I have separated flaws that are **code bugs** (fixable this afternoon) from
flaws that are **conceptual** (the design is wrong, not the implementation).
The conceptual ones matter more.

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

*Fix:* mint only when the submitter's verified ORCID appears in the extracted
author list; otherwise record the assessment with zero emission and mark it
third-party. This is maybe forty lines.

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

*Fix:* weight by normalized variance (or by an entropy/discriminability
measure) rather than by mean, and damp the loop harder. I wrote this function;
the error is mine.

### 1.3 No appeals path for an automated accusation

Injection detection sets logic integrity to 0.0 and records "research
misconduct" language in a permanent ledger. The canary evidence is strong, but
it is not infallible — a model can emit the token spuriously, and the static
scanner can misread an unusual layout.

There is no review queue, no human override, and the record is explicitly
designed to be immutable. A system that can permanently mark someone as having
attempted misconduct, with no recourse, is not one I would deploy against real
researchers.

*Fix:* quarantine rather than condemn. Flag, withhold minting, and require a
human decision before anything is written to the chain.

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

*What to do:* keep the panel, keep the agreement measure, but relabel it.
"Corroboration" is defensible. "High judgement quality" is not, because the
quality of a judgement is not established by counting agreeing models.

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

*What to do:* either drop C1/C4 from the composite and report them as
qualitative notes, or ground C1 in something real — embedding distance to
nearest OpenAlex neighbours in the same subfield would at least be a measurable
proxy for novelty rather than a vibe.

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

The strongest defence available is that piX is **transparent and per-criterion
decomposable** where JIF and h-index are not — a researcher can see exactly
what to fix. That is genuinely different. But it does not make the leaderboard
CoARA-compliant, and claiming compliance while operating one invites the
obvious rebuttal.

### 2.4 The blockchain does not constrain the party that needs constraining

The stated threat is tampering with assessment records. But the operator
controls the database, the scoring code, the rubric, the minting key, and the
server. Immutability of the ledger protects against an attacker who can modify
SQLite but cannot modify anything else — which is nobody.

A researcher who does not trust the operator gains nothing from the chain,
because the operator can simply score differently before anything is written.
A researcher who does trust the operator did not need the chain.

*What it is actually good for:* public verifiability that a specific
assessment happened at a specific time, and non-repudiation of the operator's
own past outputs. That is a real and modest benefit. It is not
trustlessness, and the framing should not imply it is.

### 2.5 The economy is closed and regressive

piQ funds assessment; piQ is earned by scoring well; therefore the researchers
who can afford to use the system most are those already producing
well-reported work with good infrastructure.

The three-paper free tier is where a new user gets stuck. A researcher without
institutional support — the exact constituency CoARA and the Global South
open-science literature are concerned with — is the one who runs out first and
cannot easily earn more. The difficulty schedule makes this strictly worse over
time.

There is also no exogenous demand for piQ. Its only use is buying access to the
system that mints it. That is a closed loop, and closed loops are worth
something only while participation grows.

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
quality", and calling the composite a quality score invites a rejection the
project does not deserve.

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

### What I would change to make that case cleanly

- **Rename the composite.** "Reporting Integrity Score", not pi-Index. It
  measures what it measures.
- **Drop or demote C1 and C4** from the composite until they are grounded in
  something measurable.
- **Retire the public leaderboard**, or restrict it to per-criterion
  deterministic measures where ranking is defensible.
- **Fix submitter-vs-author attribution** before any token has real value.
- **Reframe judgement quality as corroboration**, and state the correlated-error
  caveat in the dossier.
- **Keep the chain, narrow the claim**: timestamped non-repudiation of the
  operator's outputs, not trustlessness.

None of that weakens the project. It removes the parts a hostile reviewer would
attack first and leaves the parts that are genuinely defensible — which are
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
