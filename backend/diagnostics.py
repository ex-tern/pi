"""
Reception diagnostics — why a manuscript is not landing, and what to do.

The scoring engine answers "how rigorous is this work?". This module answers a
different and much more useful question for the person who wrote it: "given
that the work is what it is, why is nobody reading it, and what can I actually
change?"

The critical separation
-----------------------
These are NOT score inputs, and nothing here feeds back into piX. That is
deliberate and it is the whole reason this can exist at all.

ScholarPi is CoARA-aligned: venue prestige, h-index, team size and author
seniority are explicitly excluded from assessment, because they measure career
stage and field citation culture rather than the quality of the work. Letting
them influence a score would reproduce exactly the bias CoARA exists to
dismantle.

But they *do* influence reception, and a researcher pretending otherwise is
worse off than one who knows. So this module reports them honestly as
**visibility factors**, clearly labelled as such, while the score stays blind
to them. "Your paper is good and structurally invisible" is a coherent and
common finding, and it is the one most worth telling someone.

Determinism
-----------
Every finding is derived from signals the assessment already produced. No LLM
call, so this costs nothing to run, never hallucinates a citation count, and
returns the same report for the same inputs — which matters when the report is
telling someone their coauthors are a problem.
"""
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Criterion titles, used to name the weakest dimensions in plain language.
CRITERION_LABELS = {
    "C1": "semantic originality",
    "C2": "MDAR methodological rigor",
    "C3": "citation entropy (breadth of literature engaged)",
    "C4": "open infrastructure (data and code availability)",
    "C5": "containerized execution (reproducibility)",
    "C6": "citation polarity (how the work positions itself)",
    "C7": "empirical density",
    "C8": "future actionability and FAIR compliance",
}

# Severity ranks, used to order findings so the most consequential lead.
CRITICAL, MAJOR, MINOR, POSITIVE = "critical", "major", "minor", "positive"
_SEVERITY_ORDER = {CRITICAL: 0, MAJOR: 1, MINOR: 2, POSITIVE: 3}

PREPRINT_HOSTS = (
    "arxiv", "biorxiv", "medrxiv", "chemrxiv", "psyarxiv", "ssrn", "preprints.org",
    "research square", "researchsquare", "osf", "hal", "zenodo", "techrxiv",
)


def _finding(severity, title, reality, action, kind="visibility"):
    """One diagnostic item.

    ``reality`` states what is true without softening it; ``action`` must be
    something the researcher can actually do. A finding with no actionable
    response is discouragement, not diagnosis, so every entry carries both.
    """
    return {"severity": severity, "title": title, "reality": reality,
            "action": action, "kind": kind}


def _looks_like_preprint(journal: str) -> bool:
    j = (journal or "").strip().lower()
    if not j:
        return False
    return any(host in j for host in PREPRINT_HOSTS)


def _count_authors(author_name: str) -> int:
    """Best-effort author count from the extracted byline."""
    if not author_name:
        return 0
    cleaned = author_name.replace(" and ", ",").replace(";", ",")
    parts = [p.strip() for p in cleaned.split(",") if p.strip()]
    # A byline of "Surname, Given" for one person splits into two fragments.
    # Treat very short fragments as name parts rather than separate authors.
    real = [p for p in parts if len(p) > 2]
    return len(real)


def analyse_venue(payload: Dict) -> List[Dict]:
    findings = []
    ref_audit = payload.get("reference_audit") or {}
    biblio = ref_audit.get("bibliographic") or {}
    journal = (biblio.get("journal") or "").strip()

    if not journal:
        findings.append(_finding(
            MAJOR, "No publication venue detected",
            "No journal or conference could be identified for this manuscript. If it is "
            "unpublished or sitting on a personal page, it is effectively invisible: it will "
            "not be indexed, will not appear in literature searches, and cannot accumulate "
            "citations no matter how good it is.",
            "Deposit it on a recognised preprint server for your field to get a DOI and make it "
            "discoverable immediately, then submit to a peer-reviewed venue in parallel."))
    elif _looks_like_preprint(journal):
        findings.append(_finding(
            MINOR, f"Preprint only ({journal})",
            f"This is hosted on {journal} and shows no sign of peer review. Preprints are "
            f"indexed and citable, so this is far better than nothing — but many hiring "
            f"panels, funders and reviewers discount unreviewed work, and some fields ignore "
            f"preprints almost entirely.",
            "Submit to a peer-reviewed venue. The preprint keeps priority on the idea while "
            "review is under way, so there is no cost to doing both."))
    return findings


def analyse_authorship(payload: Dict) -> List[Dict]:
    findings = []
    author_count = _count_authors(payload.get("author_name", ""))
    metrics = payload.get("author_metrics") or {}

    if author_count == 1:
        findings.append(_finding(
            MAJOR, "Single-author paper",
            "This has one author. Single-author papers are cited measurably less in most "
            "fields — not because they are worse, but because each additional author brings "
            "their own network, institution and reading audience. One author means one "
            "network doing all the distribution.",
            "Collaborate. A coauthor in an adjacent subfield roughly doubles the paper's "
            "natural readership and usually strengthens the methods section as well."))
    elif 0 < author_count <= 2:
        findings.append(_finding(
            MINOR, "Very small author team",
            f"{author_count} authors. Small teams reach fewer readers on publication and tend "
            f"to draw a narrower range of methodological expertise.",
            "Consider bringing in a collaborator with complementary methods for the next "
            "paper in this line."))

    if metrics.get("resolved"):
        h = metrics.get("h_index")
        works = metrics.get("works_count")
        if isinstance(h, int) and h <= 3 and isinstance(works, int) and works <= 5:
            findings.append(_finding(
                MINOR, "Early-career author profile",
                f"The lead author resolves to an h-index of {h} across {works} indexed works. "
                f"This says nothing about the quality of this paper, but it does mean the work "
                f"arrives without an established readership — early-career papers rely far more "
                f"on venue, topic timing and coauthor networks to get seen.",
                "Prioritise visibility you control: a clear preprint, an accessible thread or "
                "summary, conference presentation, and a coauthor with an existing audience."))
        if not metrics.get("affiliation"):
            findings.append(_finding(
                MINOR, "No institutional affiliation resolved",
                "No affiliation could be resolved for the lead author. Unaffiliated work is "
                "systematically discounted by reviewers and is harder for readers to place, "
                "fairly or not.",
                "Ensure your affiliation is stated on the manuscript and correct in your ORCID "
                "and OpenAlex records — this is often a metadata problem, not a real one."))
    else:
        findings.append(_finding(
            MAJOR, "Author not discoverable in the literature graph",
            "The lead author could not be resolved in OpenAlex. That usually means an "
            "inconsistent name form across publications, or no ORCID linkage — so citations "
            "and works are being split across several partial identities instead of "
            "accumulating against one.",
            "Register an ORCID, attach it to every publication, and use one consistent name "
            "form. This is the single highest-leverage fix here and it costs an afternoon."))
    return findings


def analyse_rigor(payload: Dict) -> List[Dict]:
    """The findings that *are* about the work, drawn from the scored criteria."""
    findings = []
    criteria = payload.get("criteria_detail") or []
    scored = [c for c in criteria if isinstance(c.get("score"), (int, float))]
    if not scored:
        return findings

    weakest = sorted(scored, key=lambda c: c["score"])[:3]
    for c in weakest:
        if c["score"] >= 50:
            continue
        label = CRITERION_LABELS.get(c.get("id"), c.get("title") or c.get("id"))
        findings.append(_finding(
            MAJOR if c["score"] < 30 else MINOR,
            f"Weak on {label}",
            f"This scored {c['score']:.0f}/100 on {label} — one of its three weakest "
            f"dimensions. Unlike venue or team size, this is a property of the work itself, "
            f"and it is what reviewers will catch.",
            _remedy_for(c.get("id")),
            kind="quality"))

    repro = payload.get("repro_score")
    if isinstance(repro, (int, float)) and repro < 40:
        findings.append(_finding(
            MAJOR, "Low reproducibility signal",
            f"Reproducibility scored {repro:.0f}/100. Work that cannot be re-run is cited less "
            f"and is increasingly desk-rejected outright at reproducibility-conscious venues.",
            "Publish data and analysis code in a public repository with a DOI, and state "
            "software versions. This is usually a day of work and it moves several criteria "
            "at once.", kind="quality"))
    return findings


def _remedy_for(criterion_id: str) -> str:
    return {
        "C1": "Sharpen what is genuinely new here. State the specific claim that did not exist "
              "before this paper, in one sentence, in the abstract.",
        "C2": "Report methods against the MDAR framework — materials, design, analysis, "
              "reporting. Most losses here are omissions, not flaws.",
        "C3": "Engage a wider literature. Narrow citation ranges read as unaware of the field "
              "and reviewers notice quickly.",
        "C4": "Deposit data and code in a public repository and cite them with a DOI.",
        "C5": "Provide a container or environment specification so the analysis can be re-run.",
        "C6": "Position the work explicitly against the literature it disagrees with, rather "
              "than only citing what supports it.",
        "C7": "Strengthen the empirical basis — more data, clearer effect sizes, or explicit "
              "acknowledgement of what the evidence cannot support.",
        "C8": "Make outputs FAIR: findable, accessible, interoperable, reusable.",
    }.get(criterion_id, "Address this dimension directly in the next revision.")


def analyse_engagement(payload: Dict) -> List[Dict]:
    findings = []
    ref_audit = payload.get("reference_audit") or {}
    summary = ref_audit.get("summary") or {}
    total = summary.get("total")
    if isinstance(total, int) and 0 < total < 15:
        findings.append(_finding(
            MINOR, "Thin reference list",
            f"Only {total} references were found. Sparse bibliographies signal limited "
            f"engagement with the field, and they also reduce reciprocal citation — the "
            f"authors you cite are the ones most likely to read and cite you back.",
            "Engage the recent literature in your subfield properly, particularly work that "
            "complicates your result."))
    return findings


def build_report(payload: Dict, profile: Optional[Dict] = None) -> Dict:
    """The full reception diagnostic for one assessed manuscript.

    ``profile`` is the researcher's stated field and goal, used only to frame
    the summary — it never changes the findings, so the report cannot be
    talked into being kinder by describing yourself differently.
    """
    if not isinstance(payload, dict):
        return {"available": False, "reason": "No assessment data available."}

    findings: List[Dict] = []
    for analyser in (analyse_venue, analyse_authorship, analyse_rigor, analyse_engagement):
        try:
            findings.extend(analyser(payload) or [])
        except Exception as e:                      # one bad signal must not kill the report
            logger.warning("Diagnostic %s failed: %s", analyser.__name__, e)

    findings.sort(key=lambda f: _SEVERITY_ORDER.get(f["severity"], 9))

    score = payload.get("score")
    score_val = float(score) if isinstance(score, (int, float)) else None
    quality = [f for f in findings if f["kind"] == "quality"]
    visibility = [f for f in findings if f["kind"] == "visibility"]

    return {
        "available": True,
        "score": score_val,
        "headline": _headline(score_val, quality, visibility),
        "verdict": _verdict(quality, visibility),
        "findings": findings,
        "quality_count": len(quality),
        "visibility_count": len(visibility),
        "profile_context": _profile_context(profile),
        "disclaimer": (
            "Visibility factors — venue, team size, author profile — are reported here because "
            "they affect how work is received. They are deliberately excluded from the piX "
            "score itself, in line with CoARA: they reflect career stage and field culture, "
            "not the quality of this manuscript."
        ),
    }


def _headline(score, quality, visibility) -> str:
    if score is None:
        return "Assessment incomplete — diagnostic is partial."
    if score >= 70 and not quality and visibility:
        return ("Strong work with a distribution problem. The manuscript holds up; what is "
                "limiting it is how and where it reaches people.")
    if score >= 70:
        return "Strong work, and nothing structural is holding it back."
    if score >= 45 and visibility and not quality:
        return ("Reasonable work whose main obstacle is visibility rather than substance.")
    if quality and visibility:
        return ("Two separate problems: specific weaknesses in the work, and structural "
                "barriers to it being read. They need different fixes.")
    if quality:
        return "The main obstacles are in the manuscript itself, and they are addressable."
    return "No major structural obstacles detected."


def _verdict(quality, visibility) -> str:
    if not quality and not visibility:
        return "clear"
    if quality and visibility:
        return "both"
    return "quality" if quality else "visibility"


def recommend_papers(papers: List[Dict], limit: int = 4,
                     user_fields: Optional[List[str]] = None) -> Dict:
    """riB's picks: which assessed papers to read, which to treat with care.

    Grounded entirely in the per-criterion scores the engine already produced.
    Each verdict names the specific criteria driving it, because "recommended"
    without a reason is just a ranking, and a researcher cannot act on a rank.

    The negative list is framed as *read critically*, not *ignore*. A low piX
    means weak methodological reporting, not that the findings are wrong, and
    presenting it as a blacklist would be both unfair to the authors and
    misleading about what the score measures.
    """
    if not papers:
        return {"available": False, "reason": "No assessed papers to draw on yet.",
                "recommended": [], "caution": [], "unrelated": []}

    def strengths(criteria, high=True):
        scored = [(k, v) for k, v in (criteria or {}).items() if isinstance(v, (int, float))]
        if not scored:
            return []
        scored.sort(key=lambda kv: kv[1], reverse=high)
        picked = [k for k, v in scored[:2] if (v >= 60 if high else v < 45)]
        return [CRITERION_LABELS.get(k.upper(), k) for k in picked]

    # Papers sharing no field with the profile are set aside rather than ranked
    # against it. A rubric score says how well work is reported; it says nothing
    # about whether the work is relevant to the reader. Mixing an unrelated
    # paper into "worth reading" presents a relevance judgement the engine never
    # made — and one it cannot make from scores alone.
    wanted = {f.strip().lower() for f in (user_fields or []) if f and f.strip()}
    unrelated_src = []
    if wanted:
        related = []
        for p in papers:
            fields = {str(f).strip().lower() for f in (p.get("fields") or []) if str(f).strip()}
            # An unclassified paper is not "unrelated" — it is unknown, and
            # filing it under a heading that says otherwise would be a claim.
            (related if (not fields or fields & wanted) else unrelated_src).append(p)
        papers = related

    ranked = sorted(papers, key=lambda p: p["score"], reverse=True)

    recommended = []
    for p in ranked[:limit]:
        if p["score"] < 55:
            break                      # nothing above the bar; don't pad the list
        good = strengths(p["criteria"], high=True)
        recommended.append({
            "eval_hash": p["eval_hash"], "title": p["title"],
            "author_name": p["author_name"], "score": p["score"],
            "fields": p["fields"],
            "why": ("Strong on " + " and ".join(good) + ".") if good
                   else "Scores consistently well across the rubric.",
        })

    caution = []
    for p in reversed(ranked):
        if len(caution) >= limit or p["score"] >= 45:
            break
        weak = strengths(p["criteria"], high=False)
        caution.append({
            "eval_hash": p["eval_hash"], "title": p["title"],
            "author_name": p["author_name"], "score": p["score"],
            "fields": p["fields"],
            "why": ("Weak on " + " and ".join(weak) + ".") if weak
                   else "Scores below the rubric threshold across several dimensions.",
        })

    unrelated = [{
        "eval_hash": p["eval_hash"], "title": p["title"],
        "author_name": p["author_name"], "score": p["score"], "fields": p["fields"],
        "why": ("Outside the fields on your profile"
                + (" (" + ", ".join(p["fields"][:3]) + ")" if p["fields"] else "")
                + ". riB cannot judge it against your work."),
    } for p in sorted(unrelated_src, key=lambda p: p["score"], reverse=True)[:limit]]

    return {
        "available": bool(recommended or caution or unrelated),
        "recommended": recommended,
        "caution": caution,
        "unrelated": unrelated,
        "considered": len(papers) + len(unrelated_src),
        "note": (
            "Ranked by riB's rubric scores, which measure how well work is reported and "
            "reproducible — not whether its conclusions are correct. A low score means the "
            "methods are hard to verify, so read critically rather than dismiss."
        ),
    }


def _profile_context(profile: Optional[Dict]) -> str:
    if not profile:
        return ""
    field = (profile.get("field") or "").strip()
    goal = (profile.get("goal") or "").strip()
    if field and goal:
        return f"Framed against your stated field ({field}) and goal: {goal}"
    if field:
        return f"Framed against your stated field: {field}"
    return ""
