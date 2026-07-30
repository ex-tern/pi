"""
Bibliographic extraction: title, authors, sections and references.

Why this exists
---------------
Extraction previously depended almost entirely on the LLM panel returning
well-formed JSON, with a local fallback that took `lines[0]` as the title and
searched the next nine lines for anything containing "by" or "university" as
the author. On a real PDF, line one is frequently a journal banner, a running
header, a DOI stamp or a preprint watermark — so the recorded title was often
not the title, and the author was often an affiliation.

That matters beyond cosmetics: the title is what inter-model agreement is
measured on, and the author string is the key for piQ attribution and
per-author emission decay. Getting them wrong corrupts the leaderboard and the
corroboration signal simultaneously.

Three tiers, in order of authority:

1. **Registry metadata.** If a DOI resolves, Crossref and OpenAlex hold the
   publisher-deposited title and author list. Nothing inferred from the PDF can
   beat that, so it is used verbatim when available.
2. **PDF typography.** Publishers set titles in the largest type on page one.
   Grouping first-page spans by font size and taking the largest cluster above
   the body-text size recovers the title reliably, and the block immediately
   following it is almost always the byline.
3. **Model consensus.** Used to fill whatever the first two tiers could not,
   and to corroborate them.

Every result carries its provenance and a confidence value, so downstream
consumers can tell a publisher-deposited title from a guess.
"""
import re
import logging
from typing import Dict, List, Optional, Tuple

try:
    import fitz
    FITZ_AVAILABLE = True
except ImportError:
    FITZ_AVAILABLE = False
    fitz = None

from http_client import fetch_json, work_cache

OPENALEX_BASE = "https://api.openalex.org"
CROSSREF_BASE = "https://api.crossref.org"


# ---------------------------------------------------------------------------
# Noise filters
# ---------------------------------------------------------------------------
# Lines that routinely sit above the real title on a published PDF.
_BANNER_PATTERNS = [
    r"^\s*(www\.|https?://)",
    r"\b(journal|proceedings|transactions|conference|workshop|symposium)\s+(of|on|in)\b",
    r"^\s*(vol\.?|volume|issue|no\.?)\s*\d",
    r"^\s*(doi|issn|isbn)\s*[:.]",
    r"^\s*(preprint|accepted manuscript|author accepted|postprint|draft)\b",
    r"^\s*(downloaded from|licensed under|copyright|©|\(c\)\s*\d{4})",
    r"^\s*(arxiv:|biorxiv|medrxiv|ssrn)",
    r"^\s*page\s+\d+",
    r"^\s*\d+\s*$",
    r"^\s*(open access|research article|original article|review article|short communication)\s*$",
    r"^\s*(supplementary|appendix)\b",
    r"creative commons|cc[- ]by",
]

_AFFILIATION_MARKERS = [
    "university", "universität", "università", "universidad", "université",
    "institute", "institut", "college", "department", "dept.", "faculty",
    "laboratory", "hospital", "school of", "academy", "centre", "center",
    "corporation", "gmbh", "inc.", "ltd", "llc", "foundation", "cnr", "cnrs",
    "academy of sciences", "research council",
]

_SECTION_HEADINGS = [
    "abstract", "introduction", "background", "related work", "materials and methods",
    "methods", "methodology", "experimental", "results", "results and discussion",
    "discussion", "conclusion", "conclusions", "limitations", "acknowledgements",
    "acknowledgments", "references", "bibliography", "supplementary",
]


def _looks_like_banner(text: str) -> bool:
    lowered = text.strip().lower()
    if not lowered:
        return True
    return any(re.search(p, lowered, re.IGNORECASE) for p in _BANNER_PATTERNS)


def looks_like_affiliation(text: str) -> bool:
    lowered = (text or "").lower()
    return any(marker in lowered for marker in _AFFILIATION_MARKERS)


def _plausible_title(text: str) -> bool:
    """A title is a phrase, not a sentence fragment, a URL or a heading."""
    t = (text or "").strip()
    if not (12 <= len(t) <= 320):
        return False
    words = t.split()
    if not (3 <= len(words) <= 45):
        return False
    if _looks_like_banner(t):
        return False
    if t.lower().rstrip(":") in _SECTION_HEADINGS:
        return False
    # Mostly-uppercase blocks are usually banners rather than titles.
    letters = [c for c in t if c.isalpha()]
    if letters and sum(1 for c in letters if c.isupper()) / len(letters) > 0.75 and len(words) > 4:
        return False
    if t.count("@") or re.search(r"\b10\.\d{4,9}/", t):
        return False
    return True


# ---------------------------------------------------------------------------
# Tier 2 — PDF typography
# ---------------------------------------------------------------------------
def extract_from_pdf_layout(file_bytes: bytes) -> Dict:
    """Recover title and byline from first-page typography.

    Publishers set the title in the largest type on page one. Spans are grouped
    into visual lines, clustered by rounded font size, and the largest size that
    yields a plausible title wins. The byline is then read from the text
    immediately following, since author lists sit directly under the title in
    essentially every layout.
    """
    result = {"title": "", "authors": "", "confidence": 0.0, "basis": "pdf-layout"}
    if not FITZ_AVAILABLE or not file_bytes:
        return result

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        logging.debug("Layout extraction could not open PDF: %s", e)
        return result

    try:
        if doc.page_count == 0:
            return result
        page = doc[0]
        data = page.get_text("dict")

        lines = []
        for block in data.get("blocks", []):
            for line in block.get("lines", []):
                spans = [sp for sp in line.get("spans", []) if sp.get("text", "").strip()]
                if not spans:
                    continue
                text = " ".join(sp["text"] for sp in spans).strip()
                text = re.sub(r"\s+", " ", text)
                if not text:
                    continue
                size = max(float(sp.get("size", 0) or 0) for sp in spans)
                bold = any("bold" in str(sp.get("font", "")).lower() for sp in spans)
                y = line.get("bbox", (0, 0, 0, 0))[1]
                lines.append({"text": text, "size": round(size, 1), "y": y, "bold": bold})

        if not lines:
            return result

        lines.sort(key=lambda l: l["y"])
        # Body-text size is the most common size on the page.
        sizes = [l["size"] for l in lines]
        body_size = max(set(sizes), key=sizes.count)

        # Consecutive lines at the same large size belong to one title.
        candidates = []
        for size in sorted({s for s in sizes if s > body_size + 0.4}, reverse=True):
            group, current = [], []
            for line in lines:
                if abs(line["size"] - size) < 0.3:
                    current.append(line)
                elif current:
                    group.append(current)
                    current = []
            if current:
                group.append(current)
            for chunk in group:
                joined = re.sub(r"\s+", " ", " ".join(c["text"] for c in chunk)).strip()
                if _plausible_title(joined):
                    candidates.append({"text": joined, "size": size, "y": chunk[0]["y"],
                                       "end_y": chunk[-1]["y"]})
        # Largest type first; ties broken by position on the page.
        candidates.sort(key=lambda c: (-c["size"], c["y"]))

        if candidates:
            best = candidates[0]
            result["title"] = best["text"]
            result["confidence"] = 0.75 if best["size"] > body_size * 1.25 else 0.6

            # Byline: the next few lines below the title, before any abstract.
            byline_parts = []
            for line in lines:
                if line["y"] <= best["end_y"] + 1:
                    continue
                text = line["text"].strip()
                low = text.lower()
                if low.startswith(("abstract", "keywords", "introduction", "a b s t r a c t")):
                    break
                if _looks_like_banner(text) or looks_like_affiliation(text):
                    continue
                if "@" in text or re.search(r"\b10\.\d{4,9}/", text):
                    continue
                if len(text) > 300:
                    break
                if re.search(r"[A-Za-z]{2,}", text):
                    byline_parts.append(text)
                if len(byline_parts) >= 3:
                    break
            if byline_parts:
                result["authors"] = clean_author_list(" ".join(byline_parts))
    except Exception as e:
        logging.debug("Layout extraction failed: %s", e)
    finally:
        try:
            doc.close()
        except Exception:
            pass
    return result


def clean_author_list(raw: str) -> str:
    """Normalise a byline into 'Name, Name, Name'."""
    if not raw:
        return ""
    text = re.sub(r"\s+", " ", raw).strip()
    # Strip affiliation superscripts, ORCID glyphs and footnote markers.
    text = re.sub(r"[\d\*†‡§¶#]+", "", text)
    text = re.sub(r"\(.*?\)|\[.*?\]", "", text)
    text = re.sub(r"\b(and|&)\b", ",", text, flags=re.IGNORECASE)
    text = text.replace(";", ",")

    names = []
    for part in text.split(","):
        name = part.strip(" .,-")
        if not name or len(name) < 3 or len(name) > 60:
            continue
        if looks_like_affiliation(name):
            continue
        if "@" in name:
            continue
        words = name.split()
        if not (1 < len(words) <= 5):
            continue
        # A personal name is mostly capitalised words.
        capitalised = sum(1 for w in words if w[:1].isupper())
        if capitalised < max(1, len(words) - 1):
            continue
        if name not in names:
            names.append(name)
    return ", ".join(names[:20])


# ---------------------------------------------------------------------------
# Tier 1 — registry metadata
# ---------------------------------------------------------------------------
def fetch_registry_metadata(doi: str) -> Dict:
    """Publisher-deposited title and authors. The most authoritative source."""
    result = {"title": "", "authors": "", "confidence": 0.0, "basis": "none",
              "year": None, "journal": "", "reference_count": None}
    doi = (doi or "").replace("https://doi.org/", "").strip()
    if not doi or doi.lower() in ("none", ""):
        return result

    status, payload = fetch_json(f"{CROSSREF_BASE}/works/{doi}",
                                 cache=work_cache, cache_key=("cr-meta", doi))
    if status == 200 and payload:
        msg = payload.get("message") or {}
        titles = msg.get("title") or []
        if titles:
            authors = []
            for a in (msg.get("author") or []):
                given, family = a.get("given", ""), a.get("family", "")
                full = f"{given} {family}".strip() or a.get("name", "")
                if full:
                    authors.append(full)
            result.update({
                "title": re.sub(r"\s+", " ", titles[0]).strip(),
                "authors": ", ".join(authors[:20]),
                "confidence": 0.98, "basis": "crossref",
                "year": (msg.get("issued", {}).get("date-parts", [[None]])[0] or [None])[0],
                "journal": (msg.get("container-title") or [""])[0],
                "reference_count": msg.get("reference-count"),
            })
            return result

    status, payload = fetch_json(f"{OPENALEX_BASE}/works/https://doi.org/{doi}",
                                 cache=work_cache, cache_key=("oa-meta", doi))
    if status == 200 and payload:
        title = payload.get("title") or payload.get("display_name") or ""
        if title:
            authors = [a.get("author", {}).get("display_name", "")
                       for a in (payload.get("authorships") or [])]
            result.update({
                "title": re.sub(r"\s+", " ", title).strip(),
                "authors": ", ".join(a for a in authors if a),
                "confidence": 0.95, "basis": "openalex",
                "year": payload.get("publication_year"),
                "journal": ((payload.get("primary_location") or {}).get("source") or {}).get("display_name", ""),
                "reference_count": len(payload.get("referenced_works") or []) or None,
            })
    return result


# ---------------------------------------------------------------------------
# Structured reference parsing
# ---------------------------------------------------------------------------
_REF_START = re.compile(
    r"^\s*(?:\[(\d{1,3})\]|\((\d{1,3})\)|(\d{1,3})[.)])\s+(?=[A-Z\"'])", re.MULTILINE)
_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
_DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Za-z0-9]+\b")


def parse_reference_entries(text: str, limit: int = 120) -> List[Dict]:
    """Split a bibliography into individual, structured entries.

    Previously only bare DOIs were harvested, so a reference list without DOIs —
    still the norm in many fields — produced no evidence of literature
    engagement at all. Numbered entries are split first; where a bibliography
    is unnumbered, blank-line separation is used instead.
    """
    from scientometrics import locate_bibliography
    section = locate_bibliography(text or "")
    if not section:
        return []

    starts = [m.start() for m in _REF_START.finditer(section)]
    if len(starts) >= 3:
        chunks = [section[a:b] for a, b in zip(starts, starts[1:] + [len(section)])]
    else:
        chunks = [c for c in re.split(r"\n\s*\n", section) if len(c.strip()) > 40]

    entries = []
    for chunk in chunks[:limit]:
        raw = re.sub(r"\s+", " ", chunk).strip()
        if len(raw) < 25:
            continue
        doi_match = _DOI_RE.search(raw)
        year_match = _YEAR_RE.search(raw)
        # Authors run up to the year or the first sentence break.
        head = raw[:year_match.start()] if year_match else raw[:120]
        head = re.sub(r"^\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s*", "", head)
        entries.append({
            "raw": raw[:400],
            "doi": doi_match.group(0).rstrip(".,;)") if doi_match else "",
            "year": year_match.group(0) if year_match else "",
            "authors": head.strip(" .,-")[:160],
            "has_identifier": bool(doi_match),
        })
    return entries


def summarize_references(entries: List[Dict]) -> Dict:
    total = len(entries)
    with_doi = sum(1 for e in entries if e["has_identifier"])
    years = [int(e["year"]) for e in entries if e.get("year", "").isdigit()]
    recent = sum(1 for y in years if y >= 2020)
    return {
        "total": total,
        "with_doi": with_doi,
        "doi_coverage": round(with_doi / total, 3) if total else 0.0,
        "median_year": sorted(years)[len(years) // 2] if years else None,
        "recent_share": round(recent / len(years), 3) if years else 0.0,
        "year_range": [min(years), max(years)] if years else None,
    }


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------
def reconcile_bibliographic_record(*, registry: Dict, layout: Dict,
                                   model_title: str = "", model_authors: str = "",
                                   filename: str = "") -> Dict:
    """Choose the best title and author list, and record why.

    Ordering is by authority, not by convenience: a publisher-deposited record
    beats typography, which beats a model's reading, which beats the filename.
    """
    sources = {"title": [], "authors": []}

    def consider(field, value, basis, confidence):
        value = (value or "").strip()
        if value and value.lower() not in ("n/a", "none", "untitled", "unidentified"):
            sources[field].append({"value": value, "basis": basis, "confidence": confidence})

    consider("title", registry.get("title"), registry.get("basis", "registry"), registry.get("confidence", 0.0))
    consider("title", layout.get("title"), "pdf-layout", layout.get("confidence", 0.0))
    consider("title", model_title, "model-consensus", 0.55)
    if filename:
        cleaned = re.sub(r"\.pdf$", "", filename, flags=re.IGNORECASE).replace("_", " ").strip()
        if _plausible_title(cleaned):
            consider("title", cleaned, "filename", 0.2)

    consider("authors", registry.get("authors"), registry.get("basis", "registry"), registry.get("confidence", 0.0))
    consider("authors", layout.get("authors"), "pdf-layout", layout.get("confidence", 0.0))
    consider("authors", clean_author_list(model_authors), "model-consensus", 0.55)

    def pick(field, fallback):
        ranked = sorted(sources[field], key=lambda s: s["confidence"], reverse=True)
        if not ranked:
            return {"value": fallback, "basis": "unavailable", "confidence": 0.0, "alternatives": []}
        best = ranked[0]
        return {"value": best["value"], "basis": best["basis"], "confidence": best["confidence"],
                "alternatives": [r for r in ranked[1:4]]}

    title = pick("title", "Untitled Manuscript")
    authors = pick("authors", "Unidentified")

    return {
        "title": title["value"], "title_basis": title["basis"],
        "title_confidence": title["confidence"], "title_alternatives": title["alternatives"],
        "authors": authors["value"], "authors_basis": authors["basis"],
        "authors_confidence": authors["confidence"], "authors_alternatives": authors["alternatives"],
        "journal": registry.get("journal", ""), "year": registry.get("year"),
    }
