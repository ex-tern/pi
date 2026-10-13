#!/usr/bin/env python3
"""tools.py: every build and local-run script in one file (owner, 2026-10-13: "put everything in one file").

    python back/scripts/tools.py run [--lab]              run ScholarPi locally (was run.py)
    python back/scripts/tools.py build-ui [--library DIR] the front end (back/rust/ui) to front/app/ui.wasm
    python back/scripts/tools.py zotero                   package the Zotero plugin (back/zotero/) as front/zotero/scholarpi.xpi
    python back/scripts/tools.py whitepaper [OUTDIR]      typeset the whitepaper PDF; needs reportlab
                                                     (was backend/build_whitepaper.py + whitepaper_content.py)
"""
import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import venv
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]       # this file is back/scripts/tools.py


# ==============================================================================================================
# whitepaper_content.py (was its own script)
# ==============================================================================================================
"""
Whitepaper content, kept separate from the typesetting code.

One source of truth for the prose, consumed by both the PDF builder and the
in-app HTML renderer, so the document on the Architecture tab and the
downloadable PDF cannot drift apart.
"""

TITLE = "ScholarPi: A Transparent, Deterministic-First Framework for Research Assessment"
SUBTITLE = "Design, rubric, and honest limitations of a manuscript assessment system"
AUTHOR = "Ali Vafadar Yengejeh"
AFFILIATION = "University of Milano-Bicocca, Milan, Italy"
VERSION = "Whitepaper v1.0 · Rubric pi-index-rubric/3.0"

ABSTRACT = """\
Research assessment increasingly relies on quantitative indicators that are neither published \
nor auditable, and that measure the venue a paper appeared in rather than what the paper \
reports. ScholarPi is an open assessment framework that inverts this: it scores manuscripts \
against eight open, science-aligned criteria in which 78% of the composite derives from deterministic, \
reproducible text analysis and only 22% from language-model interpretation, and it publishes \
the full rubric, every weight, and the split between the two. Large language models are used \
as a panel of jurors rather than as an oracle; their contribution is bounded by weight, gated \
on genuine cross-provider corroboration, and explicitly labelled where it cannot be verified. \
Two of the eight criteria are marked interpretive because novelty and societal impact are \
relations between a manuscript and its field or its future, not properties recoverable from a \
PDF. Every assessment is written to an append-only Proof-of-Research chain, and the scoring \
rubric is versioned so historical scores stay interpretable. This paper describes the \
architecture, states the rubric in full, and reports the system's limitations without \
mitigation: at the time of writing the reference deployment had assessed a single manuscript, \
no validation study against expert judgement has been conducted, and the framework therefore \
has no demonstrated accuracy. What it offers instead is auditability — every number it \
produces can be traced to a named, published signal."""

SECTIONS = [
    {
        "n": "1",
        "title": "Introduction",
        "paras": [
            "Quantitative research assessment has a well-documented failure mode. The San Francisco "
            "Declaration on Research Assessment [1] identified it precisely in 2013: the Journal "
            "Impact Factor, designed as a library acquisition tool for comparing journals, became a "
            "proxy for the quality of individual articles and individual researchers. The Leiden "
            "Manifesto [2] followed in 2015 with ten principles for the responsible use of metrics, "
            "the first of which is that quantitative evaluation should support, not supplant, "
            "qualitative expert assessment. The Agreement on Reforming Research Assessment [3], "
            "finalised in July 2022, commits signatories to "
            "recognising a diverse range of outputs and to abandoning inappropriate uses of "
            "journal- and publication-based metrics.",

            "These documents agree on the diagnosis. What none of them supplies is an instrument. A "
            "reviewer who wants to check whether a manuscript reports its randomisation procedure, "
            "registers its reagents, deposits its data under an open licence, and cites literature "
            "that actually resolves, must do so by hand — a tedious, unrewarded task that is "
            "consequently done inconsistently or not at all.",

            "ScholarPi is an attempt at that instrument, built on a deliberately narrow claim. It "
            "does not measure research quality. It measures reporting quality and research "
            "integrity: what a manuscript documents, registers, deposits, and cites. Those are "
            "properties of the document, they are verifiable, and checking them is exactly the kind "
            "of work a machine should do so that human reviewers can spend their attention on the "
            "questions that require judgement.",
        ],
    },
    {
        "n": "2",
        "title": "Design principles",
        "paras": [
            "Four commitments constrain every part of the system, and several of them cost "
            "capability. They are stated here because the trade-offs they impose explain design "
            "decisions that would otherwise look arbitrary.",
        ],
        "bullets": [
            ("Deterministic first.", "Where a property can be measured from the text, it is "
             "measured, not inferred. Model opinion is a fallback for what cannot be counted, not a "
             "default. The rubric quantifies this: 78% of the composite is deterministic."),
            ("Published methodology.", "Every criterion is a weighted sum of named signals, every "
             "weight is stated, and the rubric is served from a versioned API endpoint. Transparency "
             "is not possible when the methodology is an undocumented "
             "coefficient buried in a function body."),
            ("Bounded claims.", "Where the system cannot measure something, it says so rather than "
             "producing a number to two decimal places. Two criteria are flagged interpretive; "
             "corroboration is reported as a tier, not a score; a single-juror verdict is labelled "
             "as uncorroborated."),
            ("Auditability over accuracy.", "Given a choice between a more accurate score nobody can "
             "check and a less accurate score anyone can reconstruct, the framework takes the "
             "second. A metric that cannot be audited cannot be contested, and a metric that cannot "
             "be contested cannot be corrected."),
        ],
    },
    {
        "n": "3",
        "title": "System architecture",
        "paras": [],
        "subsections": [
            {
                "n": "3.1",
                "title": "Intake and extraction",
                "paras": [
                    "Manuscripts enter as uploaded PDFs, by DOI resolution through Unpaywall, "
                    "Semantic Scholar and CORE, or by discovery through OpenAlex [4]. Text is "
                    "extracted with layout awareness: the largest-and-highest text block is not "
                    "reliably the title, and the line below it is frequently a journal banner "
                    "rather than an author list, so candidate blocks are scored on several weak "
                    "signals (font size relative to body text, boldness, vertical position) rather "
                    "than taken positionally.",

                    "Bibliographic metadata is reconciled across three tiers in order of authority: "
                    "publisher-deposited registry metadata from Crossref or OpenAlex, then PDF "
                    "typography, then the model panel. Author bylines are terminated at the first "
                    "line that is a place or a date, because a title block is conventionally "
                    "Title / Authors / Affiliation / City, Country / Date and the affiliation "
                    "markers alone do not match a bare “Milan, Italy”.",
                ],
            },
            {
                "n": "3.2",
                "title": "Deterministic signals",
                "paras": [
                    "Thirteen signals are measured, each normalised to [0, 1] with a stated "
                    "meaning. The four that carry the most weight are MDAR reporting adherence, "
                    "following the Materials Design Analysis Reporting framework [5]; density of "
                    "valid Research Resource Identifiers [6], saturating at five; open-science "
                    "reproducibility artefacts (repository, data availability statement, open "
                    "licence, container, preregistration); and empirical density, the concentration "
                    "of statistical reporting, sample sizes and quantitative results.",

                    "Reference integrity is measured by resolving cited DOIs against OpenAlex and "
                    "Crossref. This matters more than it may appear: a fabricated citation is the "
                    "highest-cost extraction error the system can make, and resolvability is a "
                    "cheap, decisive check on it.",
                ],
            },
            {
                "n": "3.3",
                "title": "The juror panel and corroboration",
                "paras": [
                    "Five language-model jurors of different lineages assess each manuscript "
                    "independently, alongside a deterministic structural analyser. Each juror has "
                    "an ordered chain of candidate routes across independent providers, so a single "
                    "account-level restriction degrades a juror to its next route rather than "
                    "removing it from the panel.",

                    "Corroboration is measured by the number of distinct provider-and-model routes "
                    "that contributed, not by the number of juror labels that answered. This "
                    "distinction is load-bearing. Every juror chain terminates in a shared "
                    "fallback model, so a constrained deployment can have five jurors all served by "
                    "one model; counting that as five independent opinions would report strong "
                    "corroboration for what is one model voting five times. Correlated agreement is "
                    "not evidence, and the system reports the collapse explicitly when it occurs.",

                    "A per-evaluation canary token is issued and checked on return. A juror that "
                    "emits the canary has been successfully prompt-injected by the manuscript, and "
                    "logic integrity for that assessment is set to zero.",
                ],
            },
        ],
    },
    {
        "n": "4",
        "title": "The Pi-Index rubric",
        "paras": [
            "Eight criteria, each a weighted sum of normalised signals whose weights sum to exactly "
            "1.0. The composite is therefore bounded to [0, 100] by construction rather than by "
            "clamping — an earlier design used additive bonuses that could push a score past 100 "
            "and were then clipped, which silently discarded information.",

            "The “deterministic share” column is the fraction of each criterion decided by "
            "verifiable text analysis rather than model opinion. It is computed from the rubric "
            "itself, so it cannot drift from the weights actually in force.",
        ],
        "table": {
            "headers": ["ID", "Criterion", "Principal signals", "Det. share"],
            "rows": [
                ["C1", "Semantic Originality *", "panel 0.45, corroboration 0.25, citation engagement 0.20", "0.30"],
                ["C2", "Methodological Rigor", "MDAR 0.55, RRID density 0.20, ref. integrity 0.15", "1.00"],
                ["C3", "Interdisciplinary Synergy", "topic diversity 0.60, domain span 0.25", "0.85"],
                ["C4", "Societal Reach *", "open licence 0.30, topic diversity 0.25, domain span 0.20", "0.75"],
                ["C5", "Open Science", "reproducibility 0.60, licence 0.20, persistent IDs 0.20", "1.00"],
                ["C6", "Literature Integration", "citation engagement 0.40, ref. integrity 0.30", "0.70"],
                ["C7", "Empirical Density", "empirical density 0.70, MDAR 0.15", "0.85"],
                ["C8", "Future Actionability", "reproducibility 0.35, persistent IDs 0.30", "0.75"],
            ],
            "note": "* Interpretive. Aggregate: 77.5% verifiable, 22.5% model interpretation.",
        },
        "after": [
            "C1 and C4 are marked interpretive and carry materially reduced deterministic weight. "
            "Novelty is a relation between a manuscript and its field; impact is a relation between "
            "a manuscript and the future. Neither is recoverable from the PDF. They are retained "
            "because they carry information a reader wants, but the composite reports them as "
            "informed opinion rather than measurement, and a confidence endpoint states the split "
            "numerically for every score produced.",

            "C8 is grounded in the FAIR Guiding Principles [7]: findability, accessibility, "
            "interoperability and reusability are assessed through persistent identifiers, "
            "licensing, and the presence of reproducible artefacts.",
        ],
    },
    {
        "n": "5",
        "title": "Scilem: learned calibration under constraint",
        "paras": [
            "The four structural signals are combined by a five-parameter linear model — four "
            "weights and a bias — fitted online. The signals themselves are never learned: their "
            "value to the framework is precisely that they are reproducible and identical for "
            "identical input. Only their relative weighting adapts.",

            "The model is deliberately small. The training set grows by one example per assessment, "
            "and anything with more capacity would memorise the corpus rather than learn from it. A "
            "five-parameter linear model over four bounded inputs can be printed in full, checked "
            "by hand, and explained to a reviewer, which matters more here than accuracy.",

            "Two teachers supply the target, and they are not weighted equally. Panel consensus "
            "updates automatically but is refused below two genuinely distinct routes, for the "
            "reason given in §3.3: learning from an uncorroborated verdict teaches imitation of "
            "whichever model happened to answer, not assessment of research. Explicit human "
            "corrections carry a higher learning rate but are restricted to signed-in identities "
            "and bounded per paper, because a repeatable anonymous correction endpoint is a direct "
            "route to steering the scoring model. Every update is bounded, weights are held "
            "non-negative and renormalised, and the full observation log is retained so any state "
            "can be recomputed and audited from scratch.",
        ],
    },
    {
        "n": "6",
        "title": "Proof-of-Research ledger and piQ emission",
        "paras": [
            "Each assessment appends a block recording the evaluation hash, the criteria weighting "
            "that assessment implied, the rubric fingerprint, and the predecessor's hash. The chain "
            "is append-only: withdrawing a paper removes it from the corpus and all listings but "
            "leaves its block standing, because deleting a block would invalidate every successor "
            "and destroy the integrity claim the chain exists to make.",

            "The genesis block is derived from the deployment's own identity — owner wallet, token "
            "contract, and chain ID — rather than being a fixed constant. With a hardcoded genesis, "
            "every instance would share an identical chain root and two exports from two different "
            "deployments would be cryptographically indistinguishable.",

            "piQ, the contribution token, is emitted under a published difficulty schedule with "
            "three multiplicative mechanisms: a halving every 2,500 assessed papers to a floor of "
            "1/16; a minimum piX threshold rising from 40 toward an asymptote of 62 as the corpus "
            "grows; and per-author diminishing returns to prevent volume farming. The full schedule "
            "is exposed through an endpoint so a researcher can compute in advance exactly what a "
            "given paper would earn.",
        ],
    },
    {
        "n": "7",
        "title": "Epoch weighting and forecasting",
        "paras": [
            "Each assessed manuscript's evidence profile implies a criteria weighting, recorded per "
            "block. The resulting series is projected one step ahead to show which criteria the "
            "assessed corpus is producing the strongest and most consistent evidence for.",

            "The default projection is Holt's linear trend method [8], implemented in NumPy. This "
            "is a deliberate choice over the neural alternative: Holt's method models level and "
            "trend with two parameters, which is the correct complexity for a series of a few dozen "
            "points, and fitting anything heavier to that much data estimates noise. An LSTM path "
            "exists behind a configuration flag and a wall-clock budget, and degrades to the "
            "statistical projection on any failure or overrun. On series this short the two "
            "largely agree.",
        ],
    },
    {
        "n": "8",
        "title": "Threat model",
        "paras": [
            "The system assumes an adversarial submitter. Manuscripts are structurally validated "
            "before any inference is purchased; hidden text and metadata manipulation are scanned "
            "for; a per-evaluation canary detects prompt injection; anonymous submissions require "
            "proof of work; and free allowance is metered per distinct document fingerprint so "
            "resubmitting the same paper costs nothing and cannot drain another user's quota.",

            "Provider errors are classified into a small set of neutral categories before reaching "
            "a user. A raw error naming the vendor, disclosing that a routing account exists, and "
            "linking to its settings page is not a researcher's concern and is useful to someone "
            "probing the deployment.",
        ],
    },
    {
        "n": "9",
        "title": "Limitations",
        "paras": [
            "This section is deliberately unmitigated. The framework's central claim is "
            "auditability, and a limitations section that argues its own limitations away would "
            "contradict it.",
        ],
        "bullets": [
            ("No validation study.", "The framework has never been evaluated against expert human "
             "judgement. No inter-rater agreement, no correlation with peer-review outcomes, no "
             "predictive validity has been established. Its scores should be read as structured "
             "descriptions of reporting practice, not as assessments whose accuracy is known."),
            ("Corpus of one.", "At the time of writing, the reference deployment had assessed a "
             "single manuscript (n = 1). Every corpus-relative mechanism — the rising quality bar, "
             "epoch weighting, field comparisons in the research assistant, the map of science — is "
             "therefore operating on essentially no data and should not be read as informative."),
            ("Reporting quality is not research quality.", "A methodologically weak study that "
             "reports itself impeccably will score well. A brilliant one published without a data "
             "statement will not. This is a known and accepted property of what the rubric "
             "measures, not a defect to be tuned away, but it is fatal if the score is read as a "
             "quality judgement."),
            ("Language and discipline bias.", "MDAR originates in the life sciences [5], and RRIDs "
             "are principally a biomedical convention [6]. Mathematics, theoretical physics and the "
             "humanities will score structurally lower on C2 and C5 for reasons that have nothing "
             "to do with their rigour. No discipline-relative normalisation is currently applied."),
            ("Model opinion remains 22%.", "Reduced, bounded, and labelled — but not eliminated. "
             "Jurors share overlapping training corpora, so their agreement rules out idiosyncratic "
             "error but not systematic error common to all of them."),
            ("Extraction is imperfect.", "Scores depend on text extracted from PDFs of varying "
             "quality. A scanned or unusually typeset manuscript will yield weaker signals, and the "
             "text-completeness signal flags but does not repair this."),
        ],
    },
    {
        "n": "10",
        "title": "Related work",
        "paras": [
            "ScholarPi's rubric operationalises commitments articulated in DORA [1], the Leiden "
            "Manifesto [2] and the Agreement on Reforming Research Assessment [3], none of which prescribe an instrument. Its deterministic "
            "checks build directly on MDAR [5], RRID [6] and FAIR [7]. Automated reporting-checklist "
            "tools exist in the life sciences and share the goal of relieving reviewers of "
            "mechanical verification; ScholarPi differs in publishing its full weighting, in "
            "quantifying the share of each score that rests on model opinion, and in binding each "
            "assessment to an append-only ledger with a versioned rubric fingerprint, so a score "
            "computed today remains interpretable after the rubric changes.",
        ],
    },
    {
        "n": "11",
        "title": "Conclusion",
        "paras": [
            "ScholarPi is a working instrument for a problem that has been well described and "
            "poorly tooled. Its contribution is not accuracy, which is unmeasured, but structure: "
            "an assessment in which every number traces to a named signal, the interpretive portion "
            "is quantified rather than hidden, and the whole rubric is published and versioned.",

            "The most useful next step is the one this paper cannot substitute for: a validation "
            "study against expert judgement on a corpus large enough to support conclusions. Until "
            "that exists, the honest description of this framework is a transparent, auditable, "
            "and unvalidated one.",
        ],
    },
]

REFERENCES = [
    "American Society for Cell Biology et al., “San Francisco Declaration on Research "
    "Assessment (DORA),” 2013. [Online]. Available: https://sfdora.org/read/",

    "D. Hicks, P. Wouters, L. Waltman, S. de Rijcke, and I. Rafols, “Bibliometrics: The Leiden "
    "Manifesto for research metrics,” Nature, vol. 520, no. 7548, pp. 429–431, Apr. 2015. "
    "doi:10.1038/520429a",

    "European University Association, Science Europe, and European Commission, “Agreement on "
    "Reforming Research Assessment,” Jul. 2022. [Online]. Available: "
    "https://coara.eu/agreement/the-agreement-full-text/",

    "J. Priem, H. Piwowar, and R. Orr, “OpenAlex: A fully-open index of scholarly works, "
    "authors, venues, institutions, and concepts,” arXiv:2205.01833, May 2022. "
    "doi:10.48550/arXiv.2205.01833",

    "M. Macleod et al., “The MDAR (Materials Design Analysis Reporting) Framework for "
    "transparent reporting in the life sciences,” Proceedings of the National Academy of "
    "Sciences, vol. 118, no. 17, e2103238118, Apr. 2021. doi:10.1073/pnas.2103238118",

    "A. E. Bandrowski and M. E. Martone, “RRIDs: A simple step toward improving "
    "reproducibility through rigor and transparency of experimental methods,” Neuron, vol. 90, "
    "no. 3, pp. 434–436, May 2016. doi:10.1016/j.neuron.2016.04.030",

    "M. D. Wilkinson et al., “The FAIR Guiding Principles for scientific data management and "
    "stewardship,” Scientific Data, vol. 3, 160018, Mar. 2016. doi:10.1038/sdata.2016.18",

    "C. C. Holt, “Forecasting seasonals and trends by exponentially weighted moving "
    "averages,” ONR Memorandum 52, Carnegie Institute of Technology, 1957; reprinted in "
    "International Journal of Forecasting, vol. 20, no. 1, pp. 5–10, 2004. "
    "doi:10.1016/j.ijforecast.2003.09.015",
]


# ==============================================================================================================
# build_whitepaper.py (was its own script)
# ==============================================================================================================
"""Typeset the ScholarPi whitepaper as a PDF, and emit a matching HTML fragment.

Both outputs are generated from whitepaper_content.py so the document embedded
in the Architecture tab and the downloadable PDF cannot drift apart.
"""


try:  # reportlab is needed only to typeset the whitepaper (not installed on the server)
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import BaseDocTemplate, Frame, KeepTogether, ListFlowable, ListItem, PageTemplate, Paragraph, Spacer, Table, TableStyle
    ACCENT = colors.HexColor("#2563eb")
    INK = colors.HexColor("#0f172a")
    MUTED = colors.HexColor("#475569")
    FAINT = colors.HexColor("#94a3b8")
    RULE = colors.HexColor("#cbd5e1")
    ABSTRACT_BG = colors.HexColor("#f6f9ff")
    TABLE_HEAD = colors.HexColor("#eef4ff")
except ImportError:
    colors = None
    BaseDocTemplate = object



def styles():
    base = getSampleStyleSheet()
    s = {}
    s["title"] = ParagraphStyle(
        "title", parent=base["Title"], fontName="Helvetica-Bold", fontSize=21,
        leading=26, textColor=INK, spaceAfter=6, alignment=TA_CENTER)
    s["subtitle"] = ParagraphStyle(
        "subtitle", parent=base["Normal"], fontName="Helvetica", fontSize=11.5,
        leading=15, textColor=MUTED, alignment=TA_CENTER, spaceAfter=14)
    s["byline"] = ParagraphStyle(
        "byline", parent=base["Normal"], fontName="Helvetica", fontSize=10,
        leading=14, textColor=INK, alignment=TA_CENTER, spaceAfter=2)
    s["affil"] = ParagraphStyle(
        "affil", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=9,
        leading=12, textColor=MUTED, alignment=TA_CENTER, spaceAfter=1)
    s["version"] = ParagraphStyle(
        "version", parent=base["Normal"], fontName="Helvetica", fontSize=8.5,
        leading=11, textColor=FAINT, alignment=TA_CENTER, spaceAfter=16)

    # The abstract is set as a distinct typographic object: tinted panel, accent
    # rule, narrower measure. It is the one section a reader may read alone, so
    # it should not look like body copy that happens to come first.
    s["abstract_head"] = ParagraphStyle(
        "abstract_head", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9,
        leading=12, textColor=ACCENT, spaceAfter=5)
    s["abstract"] = ParagraphStyle(
        "abstract", parent=base["Normal"], fontName="Helvetica", fontSize=9.5,
        leading=14.2, textColor=INK, alignment=TA_JUSTIFY)

    s["h1"] = ParagraphStyle(
        "h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=13,
        leading=17, textColor=INK, spaceBefore=17, spaceAfter=7)
    s["h2"] = ParagraphStyle(
        "h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=10.8,
        leading=14, textColor=ACCENT, spaceBefore=11, spaceAfter=5)
    s["body"] = ParagraphStyle(
        "body", parent=base["Normal"], fontName="Helvetica", fontSize=9.7,
        leading=14.4, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=8)
    s["bullet"] = ParagraphStyle(
        "bullet", parent=s["body"], spaceAfter=6, leading=14)
    s["cell"] = ParagraphStyle(
        "cell", parent=base["Normal"], fontName="Helvetica", fontSize=8.2,
        leading=11, textColor=INK)
    s["cellhead"] = ParagraphStyle(
        "cellhead", parent=s["cell"], fontName="Helvetica-Bold", textColor=INK)
    s["note"] = ParagraphStyle(
        "note", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=8,
        leading=11, textColor=MUTED, spaceBefore=5, spaceAfter=8)
    s["ref"] = ParagraphStyle(
        "ref", parent=base["Normal"], fontName="Helvetica", fontSize=8.4,
        leading=12, textColor=INK, spaceAfter=6, leftIndent=15, firstLineIndent=-15)
    return s


class Doc(BaseDocTemplate):
    """Adds a running footer with page numbers."""

    def __init__(self, path, **kw):
        super().__init__(path, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm,
                         topMargin=19 * mm, bottomMargin=19 * mm, **kw)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="main")
        self.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=self._chrome)])

    def _chrome(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        y = self.bottomMargin - 6 * mm
        canvas.line(self.leftMargin, y, self.leftMargin + self.width, y)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(FAINT)
        canvas.drawString(self.leftMargin, y - 4.5 * mm, "ScholarPi Whitepaper v1.0")
        canvas.drawRightString(self.leftMargin + self.width, y - 4.5 * mm, f"Page {doc.page}")
        canvas.restoreState()


def abstract_block(s, width):
    """The abstract, set in a tinted panel with an accent rule."""
    inner = [
        Paragraph("ABSTRACT", s["abstract_head"]),
        Paragraph(ABSTRACT, s["abstract"]),
    ]
    t = Table([[inner]], colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ABSTRACT_BG),
        ("LEFTPADDING", (0, 0), (-1, -1), 13),
        ("RIGHTPADDING", (0, 0), (-1, -1), 13),
        ("TOPPADDING", (0, 0), (-1, -1), 11),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, ACCENT),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#dbeafe")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def rubric_table(spec, s, width):
    head = [Paragraph(h, s["cellhead"]) for h in spec["headers"]]
    rows = [[Paragraph(c, s["cell"]) for c in r] for r in spec["rows"]]
    col_w = [width * x for x in (0.07, 0.24, 0.53, 0.16)]
    t = Table([head] + rows, colWidths=col_w, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEAD),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, ACCENT),
        ("GRID", (0, 0), (-1, -1), 0.25, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ALIGN", (3, 1), (3, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fbfcfe")]),
    ]))
    return t


def bullets(items, s):
    return ListFlowable(
        [ListItem(Paragraph(f"<b>{lead}</b> {body}", s["bullet"]), leftIndent=14)
         for lead, body in items],
        bulletType="bullet", bulletFontSize=7, bulletOffsetY=1,
        leftIndent=13, bulletColor=ACCENT, spaceAfter=8,
    )


def build_pdf(path):
    s = styles()
    doc = Doc(path, title=TITLE, author=AUTHOR, subject="Research assessment framework")
    W = doc.width
    story = []

    story += [
        Paragraph(TITLE, s["title"]),
        Paragraph(SUBTITLE, s["subtitle"]),
        Paragraph(AUTHOR, s["byline"]),
        Paragraph(AFFILIATION, s["affil"]),
        Paragraph(VERSION, s["version"]),
        abstract_block(s, W),
        Spacer(1, 6),
    ]

    for sec in SECTIONS:
        story.append(Paragraph(f"{sec['n']}. {sec['title']}", s["h1"]))
        for p in sec.get("paras", []):
            story.append(Paragraph(p, s["body"]))
        if sec.get("bullets"):
            story.append(bullets(sec["bullets"], s))
        for sub in sec.get("subsections", []):
            story.append(Paragraph(f"{sub['n']} {sub['title']}", s["h2"]))
            for p in sub.get("paras", []):
                story.append(Paragraph(p, s["body"]))
        if sec.get("table"):
            story.append(KeepTogether([
                rubric_table(sec["table"], s, W),
                Paragraph(sec["table"]["note"], s["note"]),
            ]))
        for p in sec.get("after", []):
            story.append(Paragraph(p, s["body"]))

    story.append(Paragraph("References", s["h1"]))
    for i, ref in enumerate(REFERENCES, 1):
        story.append(Paragraph(f"[{i}]&nbsp;&nbsp;{ref}", s["ref"]))

    doc.build(story)
    return path


def _main_build_whitepaper():
    outdir = sys.argv[1] if len(sys.argv) > 1 else "."
    pdf = build_pdf(os.path.join(outdir, "ScholarPi_Whitepaper.pdf"))
    print("wrote:", pdf)


# ==============================================================================================================
# build_ui: the front end
# ==============================================================================================================

def build_ui_main() -> int:
    """back/rust/ui -> front/app/ui.wasm.

    With the wasm32 target installed (rustup target add wasm32-unknown-unknown) this is a plain cargo build. Without
    it, --library DIR builds core, compiler_builtins and alloc for wasm32 from the standard library's source (the
    `library/` folder of rust-lang/rust at the tag of your rustc) and links the crate against them with rustc alone,
    so no download is needed.
    """
    args = sys.argv[1:]
    crate = REPO / "back" / "rust" / "ui"
    out = REPO / "front" / "app" / "ui.wasm"
    target = "wasm32-unknown-unknown"
    env = dict(os.environ)
    if "--library" not in args:
        subprocess.run(["cargo", "build", "--release", "--target", target], cwd=crate, check=True)
        shutil.copyfile(crate / "target" / target / "release" / "ui.wasm", out)
    else:
        lib = Path(args[args.index("--library") + 1]).resolve()
        sysroot = crate / "target" / "sysroot"
        sysroot.mkdir(parents=True, exist_ok=True)
        env["RUSTC_BOOTSTRAP"] = "1"
        base = ["rustc", "--edition", "2024", "--crate-type", "rlib", "--target", target, "-C", "opt-level=s",
                "-C", "panic=abort", "--cap-lints", "allow", "--out-dir", str(sysroot), "-L", str(sysroot)]
        parts = [("core", lib / "core/src/lib.rs", []),
                 ("compiler_builtins", lib / "compiler-builtins/compiler-builtins/src/lib.rs",
                  ["--cfg", 'feature="mem"', "--cfg", 'feature="compiler-builtins"',
                   "--cfg", 'feature="unmangled-names"', "-C", "codegen-units=1"]),
                 ("alloc", lib / "alloc/src/lib.rs", [])]
        for name, src, extra in parts:
            if not (sysroot / f"lib{name}.rlib").exists():
                print(f"building {name} for {target}")
                subprocess.run(base + ["--crate-name", name, *extra, str(src)], check=True, env=env)
        subprocess.run(["rustc", "--edition", "2024", "--crate-type", "cdylib", "--crate-name", "ui", "--target", target,
                        "-C", "opt-level=z", "-C", "panic=abort", "-C", "lto", "-C", "codegen-units=1",
                        "-C", "strip=symbols", "--sysroot", str(sysroot / "none"), "-L", str(sysroot),
                        str(crate / "src" / "lib.rs"), "-o", str(out)], check=True, env=env)
    print(f"{out.relative_to(REPO)}: {out.stat().st_size} bytes")
    return 0


def _main_build_ui():
    sys.exit(build_ui_main())


# ==============================================================================================================
# run.py (was its own script)
# ==============================================================================================================
#!/usr/bin/env python3
"""Run ScholarPi locally, on macOS, Linux or Windows (Python only: no shell or batch scripts).

    python run.py          set up a virtual environment the first time, then serve http://localhost:8000
    python run.py --lab    with private projects served from ../private (or $PRIVATE_PROJECTS_DIR)
"""

run_ROOT = REPO
BACKEND = run_ROOT / "back"


def venv_python() -> Path:
    env = BACKEND / "venv"
    py = env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not py.exists():
        print("Creating virtual environment...")
        venv.create(env, with_pip=True)
        print("Installing dependencies (first run only, this can take a few minutes)...")
        subprocess.run([str(py), "-m", "pip", "install", "-q", "-r", str(BACKEND / "requirements.txt")], check=True)
    return py


def run_main() -> None:
    lab = "--lab" in sys.argv
    py = venv_python()
    env_file = BACKEND / ".env"
    if not env_file.exists() and (BACKEND / ".env.example").exists():
        shutil.copy(BACKEND / ".env.example", env_file)
        print("Created back/.env from .env.example: edit it to add your API keys.")
    env = dict(os.environ)
    host, port = "0.0.0.0", env.get("PORT", "8000")
    args = ["--reload"]
    if lab:
        env.setdefault("PRIVATE_PROJECTS_DIR", str(run_ROOT.parent / "private"))
        env.setdefault("SESSION_SECRET", secrets.token_hex(32))   # owner sign-in needs one; a fresh one per run only means signing in again
        host, args = "127.0.0.1", []
    print(f"\nStarting ScholarPi at http://localhost:{port} ...")
    sys.exit(subprocess.call([str(py), "-m", "uvicorn", "api:app", "--host", host, "--port", port, *args], cwd=BACKEND, env=env))


def _main_run():
    run_main()

# ==============================================================================================================
# zotero: the ScholarPi plugin for Zotero 7 (zotero/), packaged for download from pitechlab.com
# ==============================================================================================================
def _main_zotero():
    """Zips back/zotero/ into front/zotero/scholarpi.xpi and writes front/zotero/updates.json beside it."""
    import zipfile
    root = REPO
    src, out = root / "back" / "zotero", root / "front" / "zotero"
    manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    out.mkdir(parents=True, exist_ok=True)
    xpi = out / "scholarpi.xpi"
    with zipfile.ZipFile(xpi, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(src.rglob("*")):
            if f.is_file():
                info = zipfile.ZipInfo(str(f.relative_to(src)), date_time=(2026, 1, 1, 0, 0, 0))   # same input, same file
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, f.read_bytes())
    pid = manifest["applications"]["zotero"]["id"]
    updates = {"addons": {pid: {"updates": [{
        "version": manifest["version"],
        "update_link": "https://pitechlab.com/zotero/scholarpi.xpi",
        "applications": {"zotero": {"strict_min_version": manifest["applications"]["zotero"]["strict_min_version"]}},
    }]}}}
    (out / "updates.json").write_text(json.dumps(updates, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {xpi.relative_to(root)} ({xpi.stat().st_size} bytes) and updates.json, version {manifest['version']}")


COMMANDS = {
    "whitepaper": _main_build_whitepaper,
    "build-ui": _main_build_ui,
    "run": _main_run,
    "zotero": _main_zotero,
}


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(2)
    _command = sys.argv.pop(1)
    COMMANDS[_command]()
