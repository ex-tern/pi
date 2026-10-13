#!/usr/bin/env python3
"""tools.py: every build and local-run script in one file (owner, 2026-10-13: "put everything in one file").

    python scripts/tools.py run [--lab]              run ScholarPi locally (was run.py)
    python scripts/tools.py build-hal --src DIR      HAL-OS's boot image for the Lab (was scripts/build_hal.py)
    python scripts/tools.py build-hal-shell [--check] the HAL-OS shell image (was scripts/build_hal_shell.py)
    python scripts/tools.py build-program [--check]  pitechlab.sasm to pitechlab.super.js (was scripts/build_program.py)
    python scripts/tools.py build-superai [...]      the SuperAI engine to WebAssembly (was scripts/build_superai.py)
    python scripts/tools.py sync-unigyro --src DIR   Unigyro from its own repo (was scripts/sync_unigyro.py)
    python scripts/tools.py zotero                   package the Zotero plugin (zotero/) as frontend/zotero/scholarpi.xpi
    python scripts/tools.py whitepaper [OUTDIR]      typeset the whitepaper, PDF and HTML; needs reportlab
                                                     (was backend/build_whitepaper.py + whitepaper_content.py)
"""
import argparse
import filecmp
import hashlib
import html
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import venv
from pathlib import Path


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
SUBTITLE = "Design, rubric, and honest limitations of a CoARA-aligned manuscript assessment system"
AUTHOR = "Ali Vafadar Yengejeh"
AFFILIATION = "University of Milano-Bicocca, Milan, Italy"
VERSION = "Whitepaper v1.0 · Rubric pi-index-rubric/3.0"

ABSTRACT = """\
Research assessment increasingly relies on quantitative indicators that are neither published \
nor auditable, and that measure the venue a paper appeared in rather than what the paper \
reports. ScholarPi is an open assessment framework that inverts this: it scores manuscripts \
against eight CoARA-aligned criteria in which 78% of the composite derives from deterministic, \
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
            "finalised in July 2022 and now the basis of the CoARA coalition, commits signatories to "
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
             "weight is stated, and the rubric is served from a versioned API endpoint. CoARA's "
             "transparency commitment is not satisfiable when the methodology is an undocumented "
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
            "Manifesto [2] and CoARA [3], none of which prescribe an instrument. Its deterministic "
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


# ---------------------------------------------------------------------------
# HTML fragment for the Architecture tab
# ---------------------------------------------------------------------------
def esc(t):
    return html.escape(str(t), quote=False)


def build_html(path):
    out = ['<div class="wp">']
    out.append(f'<h2 class="wp-title">{esc(TITLE)}</h2>')
    out.append(f'<p class="wp-subtitle">{esc(SUBTITLE)}</p>')
    out.append(f'<p class="wp-byline">{esc(AUTHOR)} · <span>{esc(AFFILIATION)}</span></p>')
    out.append(f'<p class="wp-version">{esc(VERSION)}</p>')

    out.append('<section class="wp-abstract"><h3>Abstract</h3>'
               f'<p>{esc(ABSTRACT)}</p></section>')

    for sec in SECTIONS:
        out.append(f'<h3 class="wp-h1">{esc(sec["n"])}. {esc(sec["title"])}</h3>')
        for p in sec.get("paras", []):
            out.append(f"<p>{esc(p)}</p>")
        if sec.get("bullets"):
            out.append("<ul class='wp-list'>")
            for lead, body in sec["bullets"]:
                out.append(f"<li><strong>{esc(lead)}</strong> {esc(body)}</li>")
            out.append("</ul>")
        for sub in sec.get("subsections", []):
            out.append(f'<h4 class="wp-h2">{esc(sub["n"])} {esc(sub["title"])}</h4>')
            for p in sub.get("paras", []):
                out.append(f"<p>{esc(p)}</p>")
        if sec.get("table"):
            spec = sec["table"]
            out.append('<div class="table-scroll"><table class="data-table wp-table"><thead><tr>')
            out += [f"<th>{esc(h)}</th>" for h in spec["headers"]]
            out.append("</tr></thead><tbody>")
            for r in spec["rows"]:
                out.append("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in r) + "</tr>")
            out.append("</tbody></table></div>")
            out.append(f'<p class="wp-note">{esc(spec["note"])}</p>')
        for p in sec.get("after", []):
            out.append(f"<p>{esc(p)}</p>")

    out.append('<h3 class="wp-h1">References</h3><ol class="wp-refs">')
    out += [f"<li>{esc(r)}</li>" for r in REFERENCES]
    out.append("</ol></div>")

    doc = "\n".join(out)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(doc)
    return path


def _main_build_whitepaper():
    outdir = sys.argv[1] if len(sys.argv) > 1 else "."
    pdf = build_pdf(os.path.join(outdir, "ScholarPi_Whitepaper.pdf"))
    frag = build_html(os.path.join(outdir, "whitepaper.html"))
    print("wrote:", pdf)
    print("wrote:", frag)


# ==============================================================================================================
# build_hal.py (was its own script)
# ==============================================================================================================
#!/usr/bin/env python3
"""build_hal.py -- build HAL-OS's boot image from its own repository, for the Lab.

    python scripts/build_hal.py --src ../HAL-OS
    python scripts/build_hal.py --src /tmp/HAL-OS --ref 7f2e094

HAL-OS is a separate repository and stays one. ScholarPi does not vendor its
source; it builds the image from a checkout at deploy time (see Dockerfile),
the same way `python bitllm_kernel.py` does on a desktop, and serves the
result to the browser, where v86 boots it.

Two things are written to frontend/hal/:

    bitllm.img   the boot disk, trimmed (see below)
    build.json   what was built, from which ref, and the constants the browser
                 side was written against

THE AGREEMENT IS CHECKED HERE, NOT DISCOVERED IN A BROWSER
---------------------------------------------------------
frontend/hal/wire.js is a port of inject.py's encoder. The two only work if
they agree on geometry, palette band and protocol constants -- and a mismatch
does not error, it renders every colour slightly wrong or trains the wrong
slots. So the build imports the HAL-OS modules and compares their constants
with the values wire.js declares, and refuses to produce an image if any of
them disagree. Change the kernel's geometry and this build fails until
wire.js follows.

WHY THE IMAGE IS TRIMMED
------------------------
bitllm_kernel.py pads the disk to 8 MiB for VirtualBox's geometry probing.
Everything after the MBR and stage 2 is zeros, and in a browser those zeros
are an 8 MiB download. SeaBIOS under v86 boots a 64 KiB disk identically, and
the build checks that no non-zero byte is cut off.
"""


HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "frontend", "hal")
WIRE_JS = os.path.join(OUT_DIR, "wire.js")
TRIM_TO = 64 * 1024


def wire_constants():
    """The `export const NAME = <int>;` lines of wire.js, as a dict."""
    with open(WIRE_JS, "r", encoding="utf-8") as fh:
        text = fh.read()
    found = {}
    for name, value in re.findall(r"export const (\w+) = (0x[0-9A-Fa-f]+|\d+);", text):
        found[name] = int(value, 0)
    return found


def build_hal_main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--src", default=os.environ.get("HAL_OS_DIR",
                                                   os.path.join(os.path.dirname(HERE), "..", "HAL-OS")),
                   help="path to a HAL-OS checkout (default: $HAL_OS_DIR or ../HAL-OS)")
    p.add_argument("--ref", default=os.environ.get("HAL_OS_REF", ""),
                   help="the commit or tag the checkout is at, recorded in build.json")
    p.add_argument("--repo", default=os.environ.get("HAL_OS_REPO", "https://github.com/neurophilic/HAL-OS"))
    args = p.parse_args()

    src = os.path.abspath(args.src)
    if not os.path.isfile(os.path.join(src, "bitllm_kernel.py")):
        sys.exit("[build_hal] no bitllm_kernel.py in %s -- point --src at a HAL-OS checkout" % src)
    sys.path.insert(0, src)
    import bitllm_kernel as K   # noqa: E402
    import inject as I          # noqa: E402

    # ---- the agreement -------------------------------------------------
    js = wire_constants()
    expected = {
        "SCREEN_W": (I.SCREEN_W, K.NEURON_W),
        "SCREEN_H": (I.SCREEN_H, K.NEURON_H),
        # The palette is decided by the kernel (palette_dac starts the cube at
        # OUT_MIN), so that is what the browser must match -- not inject.py,
        # which disagrees with it in HAL-OS 7f2e094 (see the warning below).
        "OUT_LO": (K.OUT_MIN,),
        "CUBE": (I.CUBE,),
        "MAX_SEG": (I.MAX_SEG,),
        "MIN_RUN": (I.MIN_RUN,),
        "BRIDGE": (I.BRIDGE,),
        "CMD_ADDR": (I.CMD_ADDR,),
        "CMD_DUMP": (I.CMD_DUMP,),
        "CMD_WIRE_BASE": (I.CMD_WIRE_BASE, getattr(K, "CMD_WIRE_BASE", I.CMD_WIRE_BASE)),
    }
    bad = []
    for name, sources in expected.items():
        if name not in js:
            bad.append("%s missing from wire.js" % name)
            continue
        for v in sources:
            if js[name] != v:
                bad.append("%s: wire.js says %d, HAL-OS says %d" % (name, js[name], v))
    ops = {"FILL8": I.OP_FILL8, "ROW": I.OP_ROW, "SEEK": I.OP_SEEK,
           "SAVE": I.OP_SAVE, "LOAD": I.OP_LOAD, "RESET": I.OP_RESET}
    with open(WIRE_JS, "r", encoding="utf-8") as fh:
        wire_text = fh.read()
    for name, op in ops.items():
        if not re.search(r"\b%s: \[0x%02X," % (name, op), wire_text, re.I):
            bad.append("opcode %s (0x%02X) does not match wire.js MNEMONICS" % (name, op))
    if I.OUT_LO != K.OUT_MIN:
        print("[build_hal] WARNING: HAL-OS's own inject.py packs colours from index %d, but "
              "the kernel's palette starts at OUT_MIN = %d. Desktop injection will show "
              "shifted colours until inject.py is fixed; the browser follows the kernel."
              % (I.OUT_LO, K.OUT_MIN))
    if bad:
        sys.exit("[build_hal] wire.js and HAL-OS disagree -- refusing to build:\n  "
                 + "\n  ".join(bad))

    # ---- the image -----------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "bitllm.img")
        K.build(path)
        with open(path, "rb") as fh:
            img = fh.read()
    extent = len(img.rstrip(b"\0"))
    if extent > TRIM_TO:
        sys.exit("[build_hal] image has %d bytes of content, more than the %d it is "
                 "trimmed to -- raise TRIM_TO" % (extent, TRIM_TO))
    img = img[:TRIM_TO]

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "bitllm.img"), "wb") as fh:
        fh.write(img)

    # The kernel saves bank by bank, two 64-sector halves each, from WEIGHT_LBA.
    weight_sectors = K.WEIGHT_LBA + K.BANKS * 2 * K.SECT_PER_CALL
    info = {
        "repo": args.repo,
        "ref": args.ref or "local",
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "image_sha256": hashlib.sha256(img).hexdigest(),
        "image_bytes": len(img),
        "content_bytes": extent,
        "neurons": [K.NEURON_W, K.NEURON_H],
        "screen": [K.SCREEN_W, K.SCREEN_H],
        "resp_linear": K.RESP_SEG << 4,
        "frame_counter": K.FRAME,
        "weights_restored_flag": K.DBOK,
        "weight_magic": K.MAGIC,
        "weight_disk_bytes": max(1 << 20, weight_sectors * 512),
        "init_mode": getattr(K, "INIT_MODE", "block"),
        # Where the portal's keyboard channel writes, and where the command
        # row sits, in SLOT space. Read by the browser so it never guesses.
        "key_band_start": K.KEY_BAND_START,
        "cmd_base": K.CMD_BASE,
        "commands": bool(getattr(K, "COMMANDS", False)),
    }
    with open(os.path.join(OUT_DIR, "build.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=2)
    print("[build_hal] bitllm.img %d bytes (%d of content) from %s @ %s"
          % (len(img), extent, src, info["ref"]))


def _main_build_hal():
    build_hal_main()


# ==============================================================================================================
# build_hal_shell.py (was its own script)
# ==============================================================================================================
"""Build the HAL-OS shell boot image: frontend/hal/shell/shell.asm -> frontend/hal/shell.img.

    python scripts/build_hal_shell.py          # needs nasm
    python scripts/build_hal_shell.py --check  # verify the committed image matches the source

The image is committed (it is 64 KB), so the deployment does not need nasm.
It is padded to 64 KB, the size of the network image, so the emulated BIOS
sees an ordinary small disk.
"""

build_hal_shell_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
build_hal_shell_SRC = os.path.join(build_hal_shell_ROOT, "frontend", "hal", "shell", "shell.asm")
build_hal_shell_OUT = os.path.join(build_hal_shell_ROOT, "frontend", "hal", "shell.img")
SIZE = 64 * 1024


def build() -> bytes:
    if not shutil.which("nasm"):
        sys.exit("nasm is required: apt install nasm / brew install nasm")
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "shell.bin")
        subprocess.run(["nasm", "-f", "bin", build_hal_shell_SRC, "-o", out], check=True)
        raw = open(out, "rb").read()
    if raw[510:512] != b"\x55\xaa":
        sys.exit("boot signature missing")
    if len(raw) > SIZE:
        sys.exit(f"shell is {len(raw)} bytes, more than {SIZE}")
    return raw + bytes(SIZE - len(raw))


def build_hal_shell_main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    img = build()
    if a.check:
        have = open(build_hal_shell_OUT, "rb").read() if os.path.exists(build_hal_shell_OUT) else b""
        if have != img:
            sys.exit("frontend/hal/shell.img is out of date: run python scripts/build_hal_shell.py")
        print("[build_hal_shell] shell.img matches shell.asm")
        return
    open(build_hal_shell_OUT, "wb").write(img)
    used = len(img.rstrip(b"\0"))
    print(f"[build_hal_shell] shell.img {len(img)} bytes ({used} used), sha256 {hashlib.sha256(img).hexdigest()[:16]}")


def _main_build_hal_shell():
    build_hal_shell_main()


# ==============================================================================================================
# build_program.py (was its own script)
# ==============================================================================================================
"""Assembles the site's program, frontend/super/pitechlab.sasm (SuperAI assembly), into
the program region of frontend/app.js (window.SUPERAI_PROGRAM, between the `// <pitechlab.super.js>` markers;
it was its own file, super/pitechlab.super.js), with the SuperAI engine in Rust (rust/superai, asm.rs).

    python scripts/tools.py build-program           assemble and write the region
    python scripts/tools.py build-program --check   fail if the region is not what the assembly gives
"""

build_program_ROOT = pathlib.Path(__file__).resolve().parent.parent
build_program_SRC = build_program_ROOT / "frontend/super/pitechlab.sasm"
build_program_OUT = build_program_ROOT / "frontend/app.js"
REGION_OPEN = "// <pitechlab.super.js> generated by `python scripts/tools.py build-program` from super/pitechlab.sasm: edit the\n// assembly, not this region\n"
REGION_CLOSE = "// </pitechlab.super.js>\n"
CRATE = build_program_ROOT / "rust/superai"

HEAD = """// Pi Tech Lab, written in SuperAI. GENERATED from super/pitechlab.sasm by scripts/build_program.py: edit the
// assembly, not this file.
//
// SuperAI is the site's graphical language: supers joined by wires, data flowing from outputs into inputs, powered
// by AI engines. super/runtime.js loads this as SuperAI.program (or the visitor's own edited copy):
//
//   orbit.js           builds the site from  sources, titles, merges and bubbles
//   super/nodes.js     lays out the diagram  diagram.supers and diagram.wires (on a first visit)
//   super/project.js   draws the project map project
"""


def build_program_main():
    subprocess.run(["cargo", "build", "-q", "--release"], cwd=CRATE, check=True)
    req = json.dumps({"op": "assemble", "source": build_program_SRC.read_text(encoding="utf-8")})
    r = subprocess.run([str(CRATE / "target/release/superai")], input=req, capture_output=True, text=True, check=True)
    ans = json.loads(r.stdout)
    if not ans.get("ok"):
        sys.exit("pitechlab.sasm:\n  " + "\n  ".join(ans.get("errors", [])))
    prog = ans["program"]
    v = json.loads(subprocess.run([str(CRATE / "target/release/superai")], input=json.dumps({"op": "validate", "program": prog}),
                                  capture_output=True, text=True, check=True).stdout)
    if not v.get("ok"):
        sys.exit("the program does not validate:\n  " + "\n  ".join(v.get("errors", [])))
    text = HEAD + "window.SUPERAI_PROGRAM = " + json.dumps(prog, ensure_ascii=False, indent=1) + ";\n"
    app = build_program_OUT.read_text(encoding="utf-8")
    a, b = app.index(REGION_OPEN) + len(REGION_OPEN), app.index(REGION_CLOSE)
    if "--check" in sys.argv:
        if app[a:b] != text:
            sys.exit("the program in app.js is out of date: run python scripts/tools.py build-program")
        print("app.js's program matches pitechlab.sasm")
        return
    build_program_OUT.write_text(app[:a] + text + app[b:], encoding="utf-8")
    print(f"wrote the program into {build_program_OUT.relative_to(build_program_ROOT)} ({len(text)} bytes)")


def _main_build_program():
    build_program_main()


# ==============================================================================================================
# build_superai.py (was its own script)
# ==============================================================================================================
"""Build a Rust crate of the site to WebAssembly: the SuperAI engine (rust/superai -> frontend/super/superai.wasm)
by default, or another of the front end's Rust modules with --crate (rust/numbers -> frontend/numbers.wasm).

    python scripts/build_superai.py                   build and copy the .wasm
    python scripts/build_superai.py --crate numbers   the constants (π, e, φ, γ)
    python scripts/build_superai.py --test            run the crate's tests first (cargo test)

Needs Rust with the wasm32-unknown-unknown target (`rustup target add wasm32-unknown-unknown`). Where
that target cannot be downloaded, `--build-std` builds core and alloc from rust-src instead
(RUSTC_BOOTSTRAP=1 cargo build -Z build-std=core,alloc).
"""

build_superai_ROOT = Path(__file__).resolve().parent.parent
CRATES = {"superai": build_superai_ROOT / "frontend" / "super" / "superai.wasm", "numbers": build_superai_ROOT / "frontend" / "numbers.wasm"}


def build_superai_main() -> int:
    args = sys.argv[1:]
    name = args[args.index("--crate") + 1] if "--crate" in args else "superai"
    CRATE, OUT = build_superai_ROOT / "rust" / name, CRATES[name]
    if "--test" in args:
        subprocess.run(["cargo", "test", "-q"], cwd=CRATE, check=True)
    cmd = ["cargo", "build", "--release", "--lib", "--target", "wasm32-unknown-unknown"]
    env = dict(os.environ)
    if "--build-std" in args:
        cmd += ["-Z", "build-std=core,alloc", "-Z", "build-std-features=compiler-builtins-mem", "--offline"]
        env["RUSTC_BOOTSTRAP"] = "1"
    subprocess.run(cmd, cwd=CRATE, check=True, env=env)
    built = CRATE / "target" / "wasm32-unknown-unknown" / "release" / (name + ".wasm")
    shutil.copyfile(built, OUT)
    print(f"{OUT.relative_to(build_superai_ROOT)}: {OUT.stat().st_size} bytes")
    return 0


def _main_build_superai():
    sys.exit(build_superai_main())


# ==============================================================================================================
# sync_unigyro.py (was its own script)
# ==============================================================================================================
#!/usr/bin/env python3
"""sync_unigyro.py -- take the Lab's Unigyro window from its own repository.

    python scripts/sync_unigyro.py --src ../Unigyro          # copy in
    python scripts/sync_unigyro.py --src ../Unigyro --check  # only compare

Unigyro is Murtaza Vefadar's project and lives in its own repository,
https://github.com/neurophilic/Unigyro. That repository is the source: the
window the Lab shows is its `pitechlab/unigyro.js` and `pitechlab/unigyro.css`.
This script copies those two files into frontend/, so a change to Unigyro is
made there and pulled in here, the same way HAL-OS is built from its own
repository (scripts/build_hal.py).

--check copies nothing and fails if the site's copies differ from the source.
"""


sync_unigyro_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [("pitechlab/unigyro.js", "frontend/unigyro.js"),
         ("pitechlab/unigyro.css", "frontend/unigyro.css")]


def sync_unigyro_main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--src", required=True, help="a checkout of neurophilic/Unigyro")
    ap.add_argument("--check", action="store_true", help="compare only; change nothing")
    a = ap.parse_args()
    src = os.path.abspath(a.src)
    missing = [s for s, _ in FILES if not os.path.isfile(os.path.join(src, s))]
    if missing:
        print("[sync_unigyro] the source has no " + ", ".join(missing) +
              " -- is " + src + " a checkout of neurophilic/Unigyro?", file=sys.stderr)
        return 2
    differ = []
    for s, d in FILES:
        sp, dp = os.path.join(src, s), os.path.join(sync_unigyro_ROOT, d)
        same = os.path.isfile(dp) and filecmp.cmp(sp, dp, shallow=False)
        if a.check:
            if not same:
                differ.append(d)
        elif not same:
            shutil.copyfile(sp, dp)
            print("[sync_unigyro] updated " + d + " from " + s)
    if a.check and differ:
        print("[sync_unigyro] out of step with the Unigyro repository: " + ", ".join(differ), file=sys.stderr)
        return 1
    print("[sync_unigyro] " + ("in step with" if a.check else "synced from") + " " + src)
    return 0


def _main_sync_unigyro():
    sys.exit(sync_unigyro_main())


# ==============================================================================================================
# run.py (was its own script)
# ==============================================================================================================
#!/usr/bin/env python3
"""Run ScholarPi locally, on macOS, Linux or Windows (Python only: no shell or batch scripts).

    python run.py          set up a virtual environment the first time, then serve http://localhost:8000
    python run.py --lab    the Lab wired as production has it: HAL-OS's boot image built from ../HAL-OS
                           (or $HAL_OS_DIR) and private projects served from ../private (or $PRIVATE_PROJECTS_DIR)
"""

run_ROOT = Path(__file__).resolve().parent.parent
BACKEND = run_ROOT / "backend"


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
        print("Created backend/.env from .env.example: edit it to add your API keys.")
    env = dict(os.environ)
    host, port = "0.0.0.0", env.get("PORT", "8000")
    args = ["--reload"]
    if lab:
        subprocess.run([str(py), str(run_ROOT / "scripts/tools.py"), "build-hal", "--src", env.get("HAL_OS_DIR", str(run_ROOT.parent / "HAL-OS"))], check=True)
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
    """Zips zotero/ into frontend/zotero/scholarpi.xpi and writes frontend/zotero/updates.json beside it."""
    import zipfile
    root = Path(__file__).resolve().parent.parent
    src, out = root / "zotero", root / "frontend" / "zotero"
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
    "build-hal": _main_build_hal,
    "build-hal-shell": _main_build_hal_shell,
    "build-program": _main_build_program,
    "build-superai": _main_build_superai,
    "sync-unigyro": _main_sync_unigyro,
    "run": _main_run,
    "zotero": _main_zotero,
}


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(2)
    _command = sys.argv.pop(1)
    COMMANDS[_command]()
