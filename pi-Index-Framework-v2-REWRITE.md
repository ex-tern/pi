# The π-Index Framework — revised manuscript (v2)

> **How to use this file.** Everything outside the `⚠ VERIFY` and `⟨FILL⟩` markers is
> ready to use. Everything inside them is a factual claim only you can make truthfully —
> a real DOI, a real repository URL, a real measurement. Do not compile with the markers
> still in place, and do not replace them with plausible-looking values.
>
> **Why that instruction is not boilerplate.** Your own pipeline resolves cited DOIs
> against OpenAlex and Crossref (`reference_integrity`) and audits them
> (`audit_citation_integrity`). A fabricated DOI does not read as a real one — it
> resolves to nothing and is counted as a *fabricated reference*. Under your own rubric,
> an invented DOI scores **worse than no DOI at all**.

---

## Read this before you compile

Your rubric's own docstring says the composite is "a **reporting and integrity score**
that includes an interpretive component, not a measurement of research quality."

That sentence sets the ceiling on what this rewrite can honestly do. The score rewards
MDAR adherence, RRID density, reproducibility artefacts, empirical density, reference
integrity, open licensing and persistent identifiers. Your manuscript is a **conceptual
framework paper**. It has no experiment, no sample, no protocol and no resources — so
several of those signals have nothing to measure, and the honest score for a theory paper
under a reporting rubric is *structurally* below that of a well-reported empirical study.

So this rewrite does two things, and refuses a third:

| | |
|---|---|
| **Adds what is genuinely missing and genuinely true** | DOIs on real references, data/code availability pointing at software that exists, an explicit licence, CRediT roles, ORCID, a conflict-of-interest disclosure, a limitations section, and a methods section precise enough to reimplement |
| **Restructures so existing substance is findable** | The mathematics is already there; it was not in a shape the extractors or a referee could credit |
| **Does not fabricate** | No invented RRIDs, no fictional blinding or randomisation, no power analysis for a study with no participants, no preregistration that does not exist, no statistics for experiments never run |

The single largest *honest* gain available to you is not in this file, because I do not
have the numbers: **§8 reports real measurements from the deployed system.** A framework
paper that reports its own deployment's corpus size, engine calibration error and
inter-model agreement stops being purely conceptual. That is a better paper *and* a
higher score, and the two coincide precisely because the measurement is real.

---

## Title page

**The π-Index Framework: A Multidimensional, Algorithmic Architecture for Responsible
Research Assessment**

Ali Vafadar Yengejeh ^1
ORCID: ⟨FILL: 0000-0000-0000-0000⟩

^1 Università degli Studi di Milano-Bicocca, Milan, Italy
Correspondence: ⟨FILL: institutional email⟩

**Preprint.** Version 2.0 · ⟨FILL: date⟩ · Licensed CC BY 4.0
Preprint DOI: ⟨FILL: Zenodo/arXiv DOI, or delete this line⟩

> *Title change:* "Paradigm" → "Architecture", and the Lombardy framing moved out of the
> title into §9 where the case study lives. A title naming one region tells indexers the
> work is regional; the architecture is not, and C3/C4 both read the title. This is a
> presentational fix, not a claim change.

---

## Abstract (structured)

**Background.** Research assessment relies on citation-derived proxies — the h-index,
journal impact factors, raw citation counts — that became administrative targets and,
per Goodhart's Law, ceased to be reliable measures. DORA and the Leiden Manifesto both
call for multidimensional, discipline-aware assessment, but neither specifies a
computable alternative.

**Problem.** The obvious substitute, "LLM-as-a-judge", fails in documented ways: positive
bias, hallucinated critique, conflation of fluency with rigour, and susceptibility to
adversarial prompting. A single model asked to rate a manuscript produces a number with
no error bars and no audit trail.

**Approach.** This paper specifies the π-Index Assessment Engine: eight criteria (C1–C8),
each a weighted sum of named signals normalised to [0,1], adjudicated across an
independent multi-model panel rather than a single judge, with the deterministic
components — MDAR adherence, RRID validity, reference resolvability, reproducibility
artefacts — computed from the manuscript text without model involvement. Every score is
anchored to an append-only Proof of Review ledger.

**What is measured, and what is not.** ⟨NEW — the most important paragraph in the paper.⟩
Six of the eight criteria measure *reporting practice*, which is objective and verifiable.
Two — originality (C1) and societal impact (C4) — are not properties of a document:
novelty is a relation between a manuscript and its field, impact a relation between a
manuscript and the future. Neither is recoverable from a PDF. They are retained because
readers want them, marked as interpretive, and materially down-weighted. The composite is
therefore a reporting-and-integrity score containing an interpretive component, **not a
measurement of research quality**, and the engine reports what fraction of each score
rests on verifiable evidence.

**Results.** ⟨FILL from the live deployment — see §8. Corpus size, panel agreement rate,
SciLM calibration error against panel consensus, proportion of cited DOIs resolving.⟩

**Significance.** Stating a rubric as a published weight table makes it arguable, and a
rubric that can be disagreed with is one that can be improved — which is the property
citation counts lack.

**Keywords:** research assessment · scientometrics · responsible metrics · DORA ·
Leiden Manifesto · peer review · large language models · reproducibility · MDAR ·
open science

---

## 1. Introduction

*(Retain your existing text — it is the strongest part of the manuscript. Three changes.)*

1. **Attach DOIs to every reference on first citation.** Currently zero of 22 references
   carry one. Under your own `reference_integrity` signal this is the single largest
   recoverable loss in the paper, and it is pure formatting: the works are real and
   published.

2. **Cut the self-description.** "developed as an independent, individual research
   endeavor by the author", "conceptually developed and entirely authored as an individual
   research project at the Università degli Studi di Milano-Bicocca" — this appears in
   both the abstract and §1. It is a claim about provenance, not about the work, and a
   referee reads repetition of it as insecurity. Once, in the CRediT statement, is enough.

3. **Move the promise of a contribution list to the end of §1**, so a reader knows what
   the paper will deliver before the mathematics starts.

**Add as the final paragraph of §1:**

> **Contributions.** This paper contributes: (i) a fully specified eight-criterion rubric
> in which every weight is declared rather than fitted, published as a versioned table
> (§5, Table 1); (ii) a multi-judge adjudication protocol with an explicit corroboration
> requirement, replacing single-model rating (§4); (iii) a deterministic reporting-signal
> layer — MDAR, RRID, reference resolvability, reproducibility artefacts — computed
> without model involvement, so that the verifiable portion of any score is separable
> from the interpretive portion (§5, §7); (iv) an append-only Proof of Review ledger
> making assessments auditable after the fact (§6); and (v) an open-source reference
> implementation with a live deployment (§8).

---

## 2–4. Diagnosis and architecture

*(Retain. Two additions.)*

**§2 — add a scope statement.** The Italian and Bergamo material is a case study; say so
explicitly, or a referee will read a general claim resting on regional evidence.

**§4 — add the adjudication protocol.** ⟨NEW⟩ This is the paper's central methodological
claim and it is currently asserted rather than specified. State, precisely:

- how many judges are queried, and how independence between them is established;
- the adjudication rule that turns *n* ratings into one (median? trimmed mean? and what
  happens to outliers);
- the **minimum independent-source requirement** below which no consensus is recorded —
  and why an uncorroborated verdict is refused rather than accepted with low confidence;
- which routes are excluded from adjudication and why. Your own implementation excludes
  the structural analyser from judging, on the grounds that a deterministic component
  must not vote on the score it feeds. That is a genuine design insight and it is not
  in the paper.

---

## 5. The eight criteria

*(Retain the mathematics — it is the substance. Restructure the presentation.)*

**Add Table 1: the rubric as a published weight table.** Every criterion, every signal
feeding it, every weight, and whether the criterion is interpretive. Your rubric module
already contains exactly this; the paper does not. A referee cannot audit prose
containing tensors, and a weight table is the artefact that makes the whole framework
falsifiable.

| Criterion | Signals and weights | Interpretive? |
|---|---|---|
| C1 Originality | ⟨FILL from `rubric.py`⟩ | **Yes** |
| C2 Methodological rigour | ⟨FILL⟩ | No |
| C3 Interdisciplinarity | ⟨FILL⟩ | No |
| C4 Societal impact | ⟨FILL⟩ | **Yes** |
| C5 Open science | ⟨FILL⟩ | No |
| C6 Literature integration | ⟨FILL⟩ | No |
| C7 Empirical density | ⟨FILL⟩ | No |
| C8 Future actionability | ⟨FILL⟩ | ⟨FILL⟩ |

**For each of C1–C8, add one sentence naming the failure mode.** "C1 measures epistemic
displacement from the field's centroid; it therefore cannot distinguish genuine novelty
from unfamiliar terminology, and rewards the second." Naming a limitation is how a
referee learns you understand your own instrument — and C2 rewards exactly this.

**Add §5.9 — Sensitivity.** ⟨NEW⟩ How much does the composite move when a weight moves?
If a 10% perturbation reorders the leaderboard, the weights are load-bearing and must be
defended; if it does not, say so — that is a strong result and a cheap experiment to run
against your existing corpus.

---

## 6. Proof of Review ledger

*(Retain. Add the threat model — currently missing and a referee will ask.)*

State what the ledger does and does not protect against: it makes an assessment
tamper-evident *after* recording, but does not make the assessment correct. Anchoring a
hash proves the score has not changed since it was written; it proves nothing about
whether the score was right. Distinguishing these is the difference between a security
claim and a marketing claim.

---

## 7. Topological mapping

*(Retain.)* Add the proportion normalisation used to prevent a single high-volume field
from dominating the map — a real implementation detail that belongs in the record.

---

## 8. Deployment and measurement ⟨NEW SECTION — HIGHEST-VALUE ADDITION⟩

> This section does not exist in the current manuscript, and adding it is worth more —
> to the paper and to the score — than every cosmetic change above combined. It converts
> the work from a proposal into a proposal *with evidence*.

Report, from the live deployment:

- **Corpus.** Papers assessed, distinct fields covered, date range. ⟨FILL⟩
- **Panel behaviour.** How often judges agree; how often adjudication is refused for
  insufficient corroboration; distribution of independent-source counts. ⟨FILL⟩
- **Calibration.** The structural engine's mean absolute error against panel consensus,
  *versus its own default weighting as a baseline*. Reporting error without a baseline
  is uninterpretable; the baseline is what makes it a result. ⟨FILL⟩
- **Reporting-signal prevalence.** What fraction of assessed manuscripts carry a data
  availability statement, an open licence, any valid RRID. This is a finding about the
  literature, independently publishable, and it is sitting in your database. ⟨FILL⟩
- **Reference integrity.** Proportion of cited DOIs resolving across the corpus. ⟨FILL⟩

**State the sample and its limits.** A corpus that is small, self-selected, or dominated
by one field is still worth reporting — but only if reported as such.

---

## 9. Case study: Lombardy and Bergamo

*(Your existing §8, relabelled.)* Framed explicitly as an illustrative application, not
as validation.

---

## 10. Limitations ⟨NEW SECTION⟩

> A limitations section is not a concession. Under C2 it is evidence of methodological
> self-awareness, and its absence from a paper this ambitious is conspicuous.

At minimum:

1. **The composite scores reporting, not quality.** A rigorous study reported carelessly
   scores below a slight study reported immaculately. This is a real inversion, it is
   inherent to the approach, and it must be stated by the framework's own author before
   a critic states it first.
2. **C1 and C4 are model opinion.** They are not measurements and the paper should not
   present them as such.
3. **Goodhart applies reflexively.** ⟨THE POINT A REFEREE WILL RAISE, SO RAISE IT⟩ The
   paper argues that metrics decay once they become targets. The π-Index is a metric. If
   it were adopted as a target, authors would optimise for MDAR keywords, RRID counts and
   DOI density rather than for the practices those signals proxy. The framework's own
   thesis predicts its own decay. Address this directly — the honest answer is that
   optimising for the π-Index at least requires performing the reporting practices, which
   have independent value, whereas optimising for citation counts requires only
   citations. That is a *weaker* claim than immunity, and it is the defensible one.
4. **Single-author, single-institution, no external validation.**
5. **English-language, PDF-native, machine-readable text assumed.** A scanned manuscript
   or a non-English one is measured worse, and that is a bias in the instrument.

---

## 11. Conclusion

*(Retain, trimmed.)* Remove any claim §8 does not now support.

---

## Back matter ⟨ALL NEW — none of this is currently in the paper⟩

### Data and Code Availability

> ⟨FILL — and only claim what is actually public and actually reachable.⟩

```
The reference implementation of the π-Index Assessment Engine is available at
⟨FILL: repository URL⟩ under ⟨FILL: licence⟩. The version described in this paper is
tagged ⟨FILL: version/commit⟩ and archived at ⟨FILL: Zenodo DOI⟩.

The rubric weight table (Table 1) is machine-readable at ⟨FILL: path⟩.

Assessment records underlying §8 are available at ⟨FILL⟩. [If manuscripts cannot be
redistributed for copyright reasons, say exactly that, and state what derived data IS
available — a restriction stated is a restriction respected; a restriction omitted
reads as an absence.]
```

### Software and Licensing

Implementation: Python ⟨FILL⟩, FastAPI ⟨FILL⟩, SQLite ⟨FILL⟩. Ledger anchoring on
⟨FILL: chain⟩. Language models queried: ⟨FILL: exact model identifiers and dates⟩ —
model versions change under a fixed name, so an undated model name is not reproducible.

Code: ⟨FILL: licence⟩. Text: CC BY 4.0.

### CRediT Author Statement

**Ali Vafadar Yengejeh:** Conceptualization; Methodology; Software; Formal analysis;
Investigation; Data curation; Writing – original draft; Writing – review & editing;
Visualization; Project administration.

### Competing Interests ⟨READ THIS ONE CAREFULLY⟩

> This is not a formality in your case, and omitting it would be a genuine problem.

```
The author designed the π-Index framework, developed and operates the ScholarPi
platform that implements it, and is the owner of the deployment on which the
measurements in §8 were obtained. The author therefore has a direct interest in the
framework's adoption.

Assessments of this manuscript produced by the π-Index engine should be interpreted in
light of this: the author controls both the instrument and the manuscript being measured.
No score this framework assigns to this paper constitutes independent validation of
either.
```

**Why this paragraph has to be there.** If you assess this paper on your own platform and
it tops your own leaderboard, that result is worthless as evidence *unless* the conflict
is disclosed — and actively damaging if it is not. A reader who discovers the arrangement
themselves will discount the whole framework. Disclosed, it costs you nothing a careful
reader would not have worked out; undisclosed, it is the finding.

### Funding

⟨FILL — "This research received no external funding" if true.⟩

### Acknowledgements

⟨FILL, or delete. An empty section scores nothing and reads as padding.⟩

---

## References — add DOIs

Zero of your 22 references carry a DOI. These are real, published works; the DOIs exist.
This is the highest-yield mechanical change in the document.

> **⚠ VERIFY EVERY ONE.** The DOIs below are from memory and I am not certain of them.
> Resolve each at `https://doi.org/⟨doi⟩` before compiling. Under your own
> `reference_integrity` signal an unresolvable DOI is counted as a *fabricated
> reference* — strictly worse than leaving it out. Check, or omit.

| # | Work | DOI to verify |
|---|---|---|
| [1] | Hicks et al. (2015), Leiden Manifesto, *Nature* 520:429–431 | `10.1038/520429a` |
| [13] | Leinster & Cobbold (2012), *Ecology* 93(3):477–489 | `10.1890/10-2402.1` |
| [14] | Mandelbrot & Van Ness (1968), *SIAM Review* 10(4):422–437 | `10.1137/1010093` |
| [15] | Wang, Song & Barabási (2013), *Science* 342:127–132 | `10.1126/science.1237825` |
| [16] | Wilkinson et al. (2016), *Scientific Data* 3:160018 | `10.1038/sdata.2016.18` |
| [18] | Boguñá et al. (2021), *Nat. Rev. Physics* 3:114–135 | `10.1038/s42254-020-00264-4` |
| [19] | Nickel & Kiela (2017), *NeurIPS* 30 | ⟨no DOI — cite arXiv `1705.08039`⟩ |
| [12] | Rényi (1961), *Berkeley Symposium* | ⟨no DOI — proceedings; cite URL⟩ |
| [3] | DORA (2012) | ⟨FILL — cite the declaration URL and access date⟩ |
| [7],[8],[9] | arXiv preprints | ⟨FILL: arXiv IDs — you have these⟩ |
| [10],[11],[20],[21],[22] | Books | ⟨FILL: ISBN; publisher DOIs exist for some Springer/CRC titles⟩ |

**Also:** replace every "et al." in the reference list with the full author list. Your own
`audit_citation_integrity` matches on author strings, and truncated lists resolve less
reliably.

---

## What I deliberately did not do

So you can decide differently, knowing the trade-off:

| Not added | Why |
|---|---|
| RRIDs | A theory paper uses no antibodies, cell lines, organisms or software resources requiring identifiers. Inserting RRID-formatted strings would be fabrication, and it is detectable — your validator checks them against the registry. |
| MDAR blinding / randomisation / power analysis | There is no experiment, no arm and no participant. These fields would be false. |
| Fabricated statistics to raise C7 empirical density | The honest route to C7 is §8: report real measurements from the real deployment. |
| Preregistration | You did not preregister. |
| Keyword padding for C3 interdisciplinarity | The paper genuinely spans scientometrics, information geometry and distributed systems. Naming those honestly is legitimate; salting unrelated field terms to widen the topic vector is not, and it would corrupt your own Map of Science. |

Every item in that table would raise the number. Each is also the specific behaviour your
paper exists to argue against.
