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

# Geography and dates terminate a byline. A title block is typically
# "Title / Authors / Affiliation / City, Country / Date", and none of the
# affiliation markers above match a bare "Milan, Italy" or "July 2026" — so
# those lines were being appended to the author list and then split on their
# own commas, producing authors named "Ali Vafadar Yengejeh Milan" and
# "Italy July". The author string is the key for piQ attribution and
# per-author emission decay, so a corrupted one mis-credits real people.
_COUNTRIES = {
    "italy", "italia", "france", "germany", "deutschland", "spain", "españa",
    "portugal", "netherlands", "belgium", "switzerland", "austria", "greece",
    "sweden", "norway", "denmark", "finland", "poland", "czechia", "hungary",
    "romania", "ireland", "iceland", "croatia", "serbia", "slovenia", "slovakia",
    "bulgaria", "estonia", "latvia", "lithuania", "luxembourg", "malta", "cyprus",
    "united kingdom", "uk", "england", "scotland", "wales", "usa", "u.s.a.",
    "united states", "canada", "mexico", "brazil", "argentina", "chile", "colombia",
    "china", "japan", "korea", "south korea", "india", "pakistan", "iran", "iraq",
    "israel", "turkey", "türkiye", "egypt", "morocco", "tunisia", "algeria",
    "nigeria", "kenya", "south africa", "ethiopia", "ghana", "australia",
    "new zealand", "singapore", "malaysia", "indonesia", "thailand", "vietnam",
    "philippines", "russia", "ukraine", "saudi arabia", "uae", "qatar",
}

_MONTHS = {
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
}

# Cities are stripped ONLY when the same string already contains a country or
# a month — i.e. when there is independent evidence that address material was
# fused into the byline. Applied unconditionally this list would be actively
# harmful, because most of these are also surnames (Milan, Berlin, Paris,
# Lyon, Bologna). The context gate is what makes it safe.
_CITIES = {
    "milan", "milano", "rome", "roma", "turin", "torino", "bologna", "naples",
    "florence", "firenze", "venice", "padua", "padova", "pisa", "genoa", "trieste",
    "paris", "lyon", "marseille", "toulouse", "grenoble", "bordeaux", "nantes",
    "berlin", "munich", "münchen", "hamburg", "cologne", "frankfurt", "heidelberg",
    "stuttgart", "dresden", "leipzig", "bonn", "aachen", "freiburg", "tübingen",
    "madrid", "barcelona", "valencia", "seville", "bilbao", "granada",
    "lisbon", "porto", "amsterdam", "rotterdam", "utrecht", "leiden", "delft",
    "brussels", "leuven", "ghent", "antwerp", "zurich", "zürich", "geneva",
    "basel", "lausanne", "bern", "vienna", "wien", "graz", "salzburg",
    "london", "oxford", "cambridge", "manchester", "edinburgh", "glasgow",
    "bristol", "leeds", "birmingham", "sheffield", "nottingham", "southampton",
    "dublin", "stockholm", "uppsala", "gothenburg", "oslo", "bergen",
    "copenhagen", "aarhus", "helsinki", "warsaw", "krakow", "kraków", "prague",
    "budapest", "bucharest", "athens", "istanbul", "ankara", "moscow",
    "boston", "chicago", "seattle", "atlanta", "houston", "denver", "austin",
    "philadelphia", "pittsburgh", "baltimore", "minneapolis", "detroit",
    "toronto", "montreal", "vancouver", "ottawa", "beijing", "shanghai",
    "shenzhen", "guangzhou", "hangzhou", "nanjing", "wuhan", "tianjin",
    "tokyo", "kyoto", "osaka", "seoul", "busan", "taipei", "hong kong",
    "singapore", "delhi", "mumbai", "bangalore", "chennai", "kolkata",
    "sydney", "melbourne", "brisbane", "perth", "auckland", "wellington",
    "tehran", "tabriz", "cairo", "nairobi", "lagos", "johannesburg",
    "são paulo", "sao paulo", "rio de janeiro", "buenos aires", "santiago",
}

def looks_like_location(text: str) -> bool:
    """True for a line that is a place rather than a person.

    Matches on the LAST comma-separated token, because that is where a country
    sits in every conventional address format ("Milan, Italy", "Cambridge, MA,
    USA"), and a surname is never a country.
    """
    cleaned = (text or "").strip().strip(".,;")
    if not cleaned:
        return False
    if cleaned.lower() in _COUNTRIES:
        return True
    parts = [p.strip().lower() for p in cleaned.split(",") if p.strip()]
    return bool(parts) and parts[-1] in _COUNTRIES


def looks_like_date(text: str) -> bool:
    """True for a line that is a date, with or without a year."""
    lowered = (text or "").strip().lower().strip(".,;")
    if not lowered:
        return False
    tokens = re.findall(r"[a-z]+", lowered)
    if tokens and any(t in _MONTHS for t in tokens):
        return True
    # A short line that is mostly a year is a date line, not a name.
    return bool(_YEAR_RE.search(lowered)) and len(lowered) <= 30


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


def dehyphenate(text: str) -> str:
    """Rejoin words split across a line break by a hyphen.

    PDF text extraction preserves the typesetter's hyphenation, so a title
    wrapping mid-word arrives as "Ap- proaches". Left alone that corrupts the
    stored title and, worse, breaks the inter-model title agreement measure,
    since only some jurors see the artefact.
    """
    if not text:
        return ""
    # Hyphen followed by whitespace, between two lowercase letters, is a wrap
    # artefact. A hyphen between two words that are both capitalised, or
    # followed by a digit, is usually real ("SARS-CoV-2", "Cas9-mediated").
    joined = re.sub(r"([a-z])-\s+([a-z])", r"\1\2", text)
    return re.sub(r"\s+", " ", joined).strip()


def score_title_candidate(text: str, size: float, body_size: float, y: float,
                          page_height: float, is_bold: bool = False) -> float:
    """Score how title-like a text block is, from several weak signals.

    Largest-font-wins alone is wrong often enough to matter: a journal banner,
    a "RESEARCH ARTICLE" label or a large section heading can all outrank the
    real title. Combining typography with position, length, capitalisation and
    linguistic shape is markedly more robust, and returning a score rather than
    a boolean lets close calls be resolved by weight instead of by ordering.
    """
    t = (text or "").strip()
    if not _plausible_title(t):
        return 0.0

    score = 0.0
    words = t.split()

    # Relative size is the strongest single signal, but capped so an enormous
    # banner cannot dominate on size alone. When body size is unknown or
    # nonsensical, award the neutral middle rather than silently zeroing this
    # component — absence of evidence is not evidence of a small title.
    if body_size and body_size > 0:
        ratio = size / body_size
        score += min(0.40, max(0.0, (ratio - 1.0) * 0.55))
    else:
        score += 0.15

    # Titles sit in the upper portion of page one, below any journal furniture.
    if page_height and page_height > 0:
        relative_y = y / page_height
        if 0.04 <= relative_y <= 0.42:
            score += 0.22
        elif relative_y < 0.04:
            score += 0.06     # very top is usually a banner
        elif relative_y <= 0.60:
            score += 0.10
    else:
        score += 0.11   # geometry unavailable: neutral, not penalised

    # Typical academic titles run 8-20 words.
    if 8 <= len(words) <= 20:
        score += 0.16
    elif 5 <= len(words) <= 30:
        score += 0.09
    elif len(words) < 5:
        score -= 0.05

    if is_bold:
        score += 0.06

    # Title Case or sentence case; SHOUTING is usually a label.
    letters = [c for c in t if c.isalpha()]
    if letters:
        upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
        if upper_ratio > 0.7:
            score -= 0.18
        elif 0.03 <= upper_ratio <= 0.35:
            score += 0.08

    # Titles are noun phrases: they rarely end in a full stop, and colons or
    # question marks are common.
    if not t.endswith("."):
        score += 0.05
    if ":" in t or t.endswith("?"):
        score += 0.05

    # Domain vocabulary is weak evidence, but it separates a real title from
    # boilerplate of similar size and position.
    if re.search(r"\b(using|via|towards?|based|analysis|study|model|framework|"
                 r"approach|method|evaluation|effects?|role|impact|novel|review|"
                 r"assessment|investigation|design|development|comparison)\b",
                 t, re.IGNORECASE):
        score += 0.07

    # Strong negatives.
    if re.search(r"\b(abstract|keywords|introduction|references|acknowledge)\b",
                 t, re.IGNORECASE):
        score -= 0.35
    if looks_like_affiliation(t):
        score -= 0.30
    if re.search(r"\b(received|accepted|published|revised)\b.*\d{4}", t, re.IGNORECASE):
        score -= 0.30
    if "@" in t or re.search(r"\bhttps?://", t):
        score -= 0.30

    return max(0.0, min(1.0, score))


def _plausible_title(text: str) -> bool:
    """A title is a phrase, not a sentence fragment, a URL or a heading."""
    t = (text or "").strip()
    if not (8 <= len(t) <= 320):
        return False
    words = t.split()
    # A one- or two-word title is unusual but real ("CRISPR-Cas9",
    # "Attention Is All You Need" is five, but plenty are shorter). The
    # character floor above already excludes fragments, so requiring three
    # words was rejecting valid titles for no benefit.
    if not (1 <= len(words) <= 45):
        return False
    # A single word must be substantial to qualify — "Abstract" should not.
    if len(words) == 1 and (len(t) < 10 or t.lower().rstrip(":") in _SECTION_HEADINGS):
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

        page_height = float(page.rect.height or 1)

        # Group consecutive lines of similar size into blocks — a title that
        # wraps across two lines must be recovered whole, not truncated.
        candidates, current = [], []
        for line in lines:
            if current and abs(line["size"] - current[-1]["size"]) < 0.35 and \
                    (line["y"] - current[-1]["y"]) < line["size"] * 2.2:
                current.append(line)
            else:
                if current:
                    candidates.append(current)
                current = [line]
        if current:
            candidates.append(current)

        scored = []
        for chunk in candidates[:25]:   # titles are near the top
            joined = dehyphenate(" ".join(c["text"] for c in chunk))
            size = max(c["size"] for c in chunk)
            bold = any(c["bold"] for c in chunk)
            value = score_title_candidate(joined, size, body_size, chunk[0]["y"],
                                          page_height, bold)
            if value > 0:
                scored.append({"text": joined, "size": size, "y": chunk[0]["y"],
                               "end_y": chunk[-1]["y"], "score": value})

        scored.sort(key=lambda c: c["score"], reverse=True)
        if scored:
            best = scored[0]
            result["title"] = best["text"]
            # Map the composite score onto a calibrated confidence, and record
            # runners-up so a wrong pick is at least visible and correctable.
            result["confidence"] = round(min(0.88, 0.35 + best["score"] * 0.6), 3)
            result["alternatives"] = [
                {"text": c["text"][:200], "score": round(c["score"], 3)} for c in scored[1:4]
            ]

            # Byline: the next few lines below the title, before any abstract.
            byline_parts = []
            for line in lines:
                if line["y"] <= best["end_y"] + 1:
                    continue
                text = line["text"].strip()
                low = text.lower()
                if low.startswith(("abstract", "keywords", "introduction", "a b s t r a c t")):
                    break
                # Geography and dates mark the END of the byline, so they
                # terminate the scan rather than being skipped: anything below
                # a "Milan, Italy" line is address block, not more authors.
                if looks_like_location(text) or looks_like_date(text):
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
                # Joined with a comma, not a space. A byline wrapping across
                # two lines has no trailing comma on the first, so a space-join
                # fused the last name of one line to the first name of the next
                # into a single bogus author.
                result["authors"] = clean_author_list(", ".join(byline_parts))
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

    # Is there address material in this string at all? Only then is it safe to
    # strip city-like trailing tokens, since "Milan" and "Berlin" are perfectly
    # ordinary surnames in a byline that contains no address.
    _lower = text.lower()
    address_context = bool(
        set(re.findall(r"[a-z]+", _lower)) & _MONTHS
        or _YEAR_RE.search(text)
        or any(c in _lower for c in _COUNTRIES)
    )

    names = []
    for part in text.split(","):
        name = part.strip(" .,-")
        if not name or len(name) < 3 or len(name) > 60:
            continue
        if looks_like_affiliation(name) or looks_like_location(name) or looks_like_date(name):
            continue
        if "@" in name:
            continue
        # A year anywhere in a "name" means a date fragment was concatenated
        # onto it; there is no recovering the real name from that, and keeping
        # it would attribute piQ to a person who does not exist.
        if _YEAR_RE.search(name):
            continue
        words = name.split()
        # Drop a trailing country token fused onto the last name
        # ("Yengejeh Milan" -> "Yengejeh") before the word-count checks.
        while len(words) > 1 and words[-1].lower().strip(".,") in _COUNTRIES:
            words = words[:-1]
        while (address_context and len(words) > 1
               and words[-1].lower().strip(".,") in _CITIES):
            words = words[:-1]
        name = " ".join(words)
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

    consider("title", dehyphenate(registry.get("title", "")),
             registry.get("basis", "registry"), registry.get("confidence", 0.0))
    consider("title", dehyphenate(layout.get("title", "")), "pdf-layout",
             layout.get("confidence", 0.0))
    consider("title", dehyphenate(model_title or ""), "model-consensus", 0.55)
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
