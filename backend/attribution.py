"""
Authorship attribution: who a manuscript's piQ actually belongs to.

The exploit this closes
-----------------------
piQ was minted to `eth_book` — the wallet of whoever pressed the button. But
anyone can submit anyone else's paper through DOI lookup or Auto-Discover, so
the optimal strategy for accumulating piQ was never to write good papers. It
was to submit *other people's* good papers before they did.

The per-author emission decay made this worse rather than better: it penalised
a prolific *author*, while a farmer submits under one wallet across many
different authors, so the decay barely engaged. The whole incentive structure
inverted under a few seconds of adversarial thought.

The rule now
------------
piQ is minted only when the submitter can be shown to be an author of the work.
Everything else is still assessed and still recorded — third-party submission
is genuinely useful, and discouraging it would gut Auto-Discover — but it earns
nothing.

Verification is tiered by strength of evidence:

* **ORCID in the registry record** — the publisher deposited this ORCID against
  this work. Effectively conclusive.
* **ORCID display name matching an extracted author** — strong, since the ORCID
  itself was verified through OAuth.
* **Wallet previously linked to a verified ORCID for this author** — carries the
  earlier verification forward.
* **Anything else** — unverified. Assessed, attributed to nobody, mints zero.

Name matching is deliberately conservative. A false positive here mints tokens
to the wrong person, which is worse than a false negative that merely denies a
legitimate author their piQ until they link ORCID.
"""
import re
import difflib
import logging
import unicodedata
from typing import Dict, List, Optional

from http_client import fetch_json, work_cache

OPENALEX_BASE = "https://api.openalex.org"
CROSSREF_BASE = "https://api.crossref.org"


def normalize_name(name: str) -> str:
    """Fold a personal name to a comparable form.

    Accents, punctuation, case and honorifics vary between a PDF byline, a
    Crossref record and an ORCID profile for the same person, so all three are
    stripped before comparison.
    """
    if not name:
        return ""
    text = unicodedata.normalize("NFKD", str(name))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"\b(prof|dr|phd|md|mr|mrs|ms|sir|dame)\.?\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def name_tokens(name: str) -> List[str]:
    """Split a normalised name into comparable tokens.

    Single characters are kept: dropping them discards initials, which are
    exactly what "J. Smith" consists of, and made every initialised byline
    unmatchable against its full form.
    """
    return [t for t in normalize_name(name).split() if t]


def names_match(a: str, b: str) -> bool:
    """Whether two strings plausibly name the same person.

    Requires the surname to match exactly and the given name to match either in
    full or by initial. Matching on surname alone would collide constantly on
    common names — and a collision here mints someone else's tokens to you.
    """
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return False

    surname_a, surname_b = ta[-1], tb[-1]
    if surname_a != surname_b:
        return False
    if len(ta) == 1 or len(tb) == 1:
        # Surname only on one side is not enough to mint against.
        return False

    given_a, given_b = ta[0], tb[0]
    if given_a == given_b:
        return True
    # "J. Smith" vs "John Smith" — initial match is acceptable only when one
    # side is genuinely an initial.
    if (len(given_a) == 1 or len(given_b) == 1) and given_a[0] == given_b[0]:
        return True
    return False


def fetch_orcid_profile_name(orcid: str) -> Optional[str]:
    """Public display name for a verified ORCID iD."""
    orcid = (orcid or "").strip()
    if not re.fullmatch(r"\d{4}-\d{4}-\d{4}-\d{3}[\dX]", orcid):
        return None
    status, payload = fetch_json(
        f"https://pub.orcid.org/v3.0/{orcid}/personal-details",
        cache=work_cache, cache_key=("orcid-name", orcid))
    if status != 200 or not payload:
        return None
    name = payload.get("name") or {}
    given = ((name.get("given-names") or {}) or {}).get("value", "")
    family = ((name.get("family-name") or {}) or {}).get("value", "")
    full = f"{given} {family}".strip()
    return full or None


def registry_orcids_for_doi(doi: str) -> List[str]:
    """ORCIDs the publisher deposited against this work."""
    doi = (doi or "").replace("https://doi.org/", "").strip()
    if not doi or doi.lower() in ("none", ""):
        return []

    found = []
    status, payload = fetch_json(f"{CROSSREF_BASE}/works/{doi}",
                                 cache=work_cache, cache_key=("cr-orcid", doi))
    if status == 200 and payload:
        for author in (payload.get("message", {}).get("author") or []):
            raw = author.get("ORCID") or ""
            match = re.search(r"(\d{4}-\d{4}-\d{4}-\d{3}[\dX])", raw)
            if match:
                found.append(match.group(1))

    if not found:
        status, payload = fetch_json(f"{OPENALEX_BASE}/works/https://doi.org/{doi}",
                                     cache=work_cache, cache_key=("oa-orcid", doi))
        if status == 200 and payload:
            for authorship in (payload.get("authorships") or []):
                raw = (authorship.get("author") or {}).get("orcid") or ""
                match = re.search(r"(\d{4}-\d{4}-\d{4}-\d{3}[\dX])", raw)
                if match:
                    found.append(match.group(1))
    return found


def orcid_lists_work(orcid: str, doi: str = "", title: str = "") -> Optional[str]:
    """Does this ORCID record contain the work? Returns how it matched.

    Sits between publisher-deposited ORCID (decisive) and name matching (weak).
    The claim is self-asserted — the researcher added the work themselves — but
    it is asserted on an authenticated, permanent, publicly auditable record
    under their own name. Fabricating it means attaching someone else's paper
    to your own research identity, traceably and durably, which is a far higher
    cost than typing a name into a profile field.
    """
    orcid = (orcid or "").strip()
    if not re.fullmatch(r"\d{4}-\d{4}-\d{4}-\d{3}[\dX]", orcid):
        return None

    status, payload = fetch_json(
        f"https://pub.orcid.org/v3.0/{orcid}/works",
        cache=work_cache, cache_key=("orcid-works", orcid))
    if status != 200 or not payload:
        return None

    wanted_doi = (doi or "").strip().lower().replace("https://doi.org/", "")
    wanted_title = re.sub(r"[^a-z0-9 ]+", " ", (title or "").lower()).strip()
    wanted_title = re.sub(r"\s+", " ", wanted_title)

    for group in (payload.get("group") or []):
        for summary in (group.get("work-summary") or []):
            # DOI match first: an identifier comparison is exact, whereas a
            # title comparison is a judgement call.
            for ext in ((summary.get("external-ids") or {}).get("external-id") or []):
                if str(ext.get("external-id-type", "")).lower() != "doi":
                    continue
                value = str(ext.get("external-id-value", "")).lower().replace(
                    "https://doi.org/", "").strip()
                if value and wanted_doi and value == wanted_doi:
                    return "doi"

            if not wanted_title or len(wanted_title) < 20:
                continue
            listed = (((summary.get("title") or {}).get("title") or {}).get("value") or "")
            listed = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", listed.lower())).strip()
            if listed and difflib.SequenceMatcher(None, listed, wanted_title).ratio() >= 0.92:
                return "title"
    return None


def verify_authorship(*, submitter_orcid: str = "", submitter_wallet: str = "",
                      extracted_authors: str = "", doi: str = "", title: str = "",
                      known_wallet_orcid: str = "") -> Dict:
    """Decide whether this submitter may be credited as an author.

    Returns the verdict, its evidence tier, and a human-readable reason —
    because "you earned nothing" needs to be explainable, and the explanation
    is also the instruction for how to fix it.
    """
    result = {
        "verified": False, "tier": "unverified", "confidence": 0.0,
        "matched_author": None, "credited_identity": None,
        "reason": "", "how_to_verify": None,
    }

    orcid = (submitter_orcid or known_wallet_orcid or "").strip()
    author_list = [a.strip() for a in (extracted_authors or "").split(",") if a.strip()]

    if not orcid:
        result["reason"] = (
            "No verified ORCID is linked to this submission, so authorship could not be "
            "established. The assessment is recorded, but no piQ is minted."
        )
        result["how_to_verify"] = (
            "Link your ORCID in the sidebar and re-submit. ORCID is verified through OAuth, so "
            "it proves identity in a way a wallet address alone cannot."
        )
        return result

    # Tier 1 — the publisher deposited this ORCID against this work.
    if doi:
        try:
            deposited = registry_orcids_for_doi(doi)
        except Exception as e:
            logging.debug("Registry ORCID lookup failed for %s: %s", doi, e)
            deposited = []
        if orcid in deposited:
            result.update({
                "verified": True, "tier": "registry-orcid", "confidence": 0.99,
                "credited_identity": orcid,
                "reason": ("Your ORCID is listed as an author of this work in the publisher's "
                           "deposited record. Authorship is confirmed."),
            })
            return result

    # Tier 2 — the work appears on the claimant's own ORCID record.
    try:
        listed_via = orcid_lists_work(orcid, doi=doi, title=title)
    except Exception as e:
        logging.debug("ORCID works lookup failed for %s: %s", orcid, e)
        listed_via = None
    if listed_via:
        result.update({
            "verified": True, "tier": "orcid-listed-work", "confidence": 0.92,
            "credited_identity": orcid,
            "reason": (f"This work appears on your ORCID record (matched by {listed_via}). "
                       f"Authorship is confirmed."),
        })
        return result

    # Tier 3 — verified ORCID profile name matches an extracted author.
    profile_name = None
    try:
        profile_name = fetch_orcid_profile_name(orcid)
    except Exception as e:
        logging.debug("ORCID profile lookup failed for %s: %s", orcid, e)

    # Record what was compared, so a refusal is diagnosable. "Your name does
    # not match" is unactionable when the user can see their own name on the
    # paper — the useful information is which two strings were compared, and
    # extraction errors mean the second one is often not what they expect.
    result["compared"] = {
        "your_orcid_name": profile_name or None,
        "extracted_authors": author_list or [],
    }
    if profile_name and author_list:
        for candidate in author_list:
            if names_match(profile_name, candidate):
                result.update({
                    "verified": True, "tier": "orcid-name-match", "confidence": 0.85,
                    "matched_author": candidate, "credited_identity": orcid,
                    "reason": (f"Your verified ORCID profile name matches the author "
                               f"'{candidate}' on this manuscript."),
                })
                return result

    if not author_list:
        result["reason"] = (
            "No author list could be extracted from this manuscript, so authorship could not be "
            "checked. The assessment is recorded, but no piQ is minted."
        )
        result["how_to_verify"] = (
            "Submit with a DOI so the publisher's deposited author record can be used, which is "
            "more reliable than reading the byline from the PDF."
        )
        return result

    # Name BOTH sides of the comparison. "Your name does not match" is
    # unactionable when the user can see their own name printed on the paper —
    # the useful information is which two strings were actually compared, and
    # PDF byline extraction is imperfect often enough that the second one is
    # frequently not what they expect.
    shown = ", ".join(author_list[:3]) + ("…" if len(author_list) > 3 else "")
    result["reason"] = (
        f"Your ORCID profile name ({profile_name or 'could not be read'}) does not match any "
        f"author extracted from this manuscript ({shown or 'none found'}). The assessment is "
        f"recorded and its piQ is held, but piQ settles only to a paper's own authors."
    )
    result["how_to_verify"] = (
        "If your name is on the paper but not in that list, the byline was misread — resubmit "
        "with the DOI, which uses the publisher's deposited author record instead of reading the "
        "PDF. Otherwise, check that your ORCID profile name matches your published byline."
    )
    return result


# ---------------------------------------------------------------------------
# Journal-publication claims
# ---------------------------------------------------------------------------
# "Journal-published" is the strongest badge the platform issues, and it was
# also the easiest to obtain: the only test was that the submitted DOI resolved
# in a registry. That asks one question and skips the two that matter.
#
#   * It never asked whether the DOI is THIS manuscript. Any real DOI passed —
#     including the example DOI printed in the form's own placeholder — so a
#     famous paper's identifier could be pasted onto an unrelated draft.
#   * It never asked whether the claimant is an author OF that DOI. Resolving a
#     stranger's work proves the work exists, not that it is yours.
#
# A badge anyone can mint by copying a string from a search result is worse
# than no badge, because a reader cannot tell the honest ones from the rest.
# All three questions are now asked, and each is answered against the
# publisher's deposited record rather than the submitter's assertion.

JOURNAL_TITLE_MATCH_RATIO = 0.75   # registry title vs assessed manuscript title


def _title_similarity(a: str, b: str) -> float:
    """How close two titles are, ignoring case, accents and punctuation."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    # A preprint often carries a subtitle the published version drops (or the
    # reverse), so containment counts as a strong match rather than a partial.
    if len(na) > 25 and len(nb) > 25 and (na in nb or nb in na):
        return 0.95
    return difflib.SequenceMatcher(None, na, nb).ratio()


def verify_journal_claim(*, doi: str, orcid: str, assessed_title: str,
                         assessed_authors: str = "") -> Dict:
    """Whether this DOI may back a Journal-published badge for this person.

    Three independent conditions, all required:

      1. The DOI resolves in Crossref or OpenAlex.
      2. The work it resolves to IS the assessed manuscript (title match).
      3. The claimant is an author of that work — by deposited ORCID (strongest)
         or by their ORCID profile name matching a deposited author.

    Returns ``{ok, reason, how_to_fix, tier, registry}``. Every failure names
    which condition failed and what would satisfy it, because a refusal a user
    cannot act on is indistinguishable from a bug.
    """
    out = {"ok": False, "reason": "", "how_to_fix": None, "tier": "unverified",
           "registry": {}}

    doi = (doi or "").replace("https://doi.org/", "").strip().rstrip(".")
    if not doi:
        out["reason"] = "A journal claim needs a DOI."
        out["how_to_fix"] = ("Enter the DOI of the published version. It is checked against "
                             "Crossref and OpenAlex, not taken on trust.")
        return out

    if not re.match(r"^10\.\d{4,9}/\S+$", doi):
        out["reason"] = f"'{doi}' is not a well-formed DOI."
        out["how_to_fix"] = "A DOI looks like 10.1038/s41586-021-03819-2."
        return out

    # --- 1. Does it resolve? ------------------------------------------------
    try:
        from extraction import fetch_registry_metadata
        meta = fetch_registry_metadata(doi) or {}
    except Exception as e:
        logging.warning("Registry lookup failed for %s: %s", doi, e)
        meta = {}
    out["registry"] = {k: meta.get(k) for k in ("title", "authors", "year", "journal", "basis")}

    if not meta.get("title"):
        out["reason"] = ("That DOI could not be resolved in Crossref or OpenAlex, so journal "
                         "publication cannot be confirmed.")
        out["how_to_fix"] = ("Author-publish for now and switch to a journal claim once the DOI "
                             "is registered — deposits can take a few days to appear.")
        return out

    # --- 2. Is it THIS paper? ----------------------------------------------
    ratio = _title_similarity(meta["title"], assessed_title or "")
    if ratio < JOURNAL_TITLE_MATCH_RATIO:
        out["reason"] = (
            f"That DOI resolves to a different work. The registry has "
            f"\"{meta['title'][:120]}\", and this assessment is of "
            f"\"{(assessed_title or 'an untitled manuscript')[:120]}\".")
        out["how_to_fix"] = ("Use the DOI of this manuscript's published version. A DOI belonging "
                             "to another paper cannot back a claim about this one.")
        out["registry"]["title_match"] = round(ratio, 3)
        return out
    out["registry"]["title_match"] = round(ratio, 3)

    # --- 3. Are YOU an author of it? ---------------------------------------
    if not orcid:
        out["reason"] = "A journal claim requires a linked ORCID."
        out["how_to_fix"] = ("Link ORCID in the sidebar. It is what lets the publisher's "
                             "deposited author record be checked against you.")
        return out

    try:
        deposited = registry_orcids_for_doi(doi)
    except Exception as e:
        logging.debug("Deposited ORCID lookup failed for %s: %s", doi, e)
        deposited = []

    if orcid in deposited:
        out.update({"ok": True, "tier": "registry-orcid",
                    "reason": "Your ORCID is listed as an author in the publisher's record."})
        return out

    # Fall back to matching your ORCID profile name against the deposited
    # byline. Weaker than a deposited ORCID — names collide, ORCIDs do not —
    # so it is recorded as a distinct, lower tier rather than presented as
    # equivalent evidence.
    profile_name = None
    try:
        profile_name = fetch_orcid_profile_name(orcid)
    except Exception as e:
        logging.debug("ORCID profile lookup failed for %s: %s", orcid, e)

    registry_authors = [a.strip() for a in (meta.get("authors") or "").split(",") if a.strip()]
    if profile_name and any(names_match(profile_name, a) for a in registry_authors):
        out.update({"ok": True, "tier": "registry-name",
                    "reason": (f"Your ORCID profile name ({profile_name}) matches an author in "
                               f"the publisher's deposited record.")})
        return out

    shown = ", ".join(registry_authors[:4]) + ("…" if len(registry_authors) > 4 else "")
    out["reason"] = (
        f"You are not listed as an author of that DOI. The publisher's record names "
        f"{shown or 'no authors'}, and your ORCID ({orcid}) is not among the deposited ORCIDs"
        + (f" — your profile name reads {profile_name}." if profile_name else "."))
    out["how_to_fix"] = (
        "Ask the publisher to deposit your ORCID against the work, or make sure your ORCID "
        "profile name matches your published byline. Author-publishing needs neither and is "
        "available now.")
    return out
