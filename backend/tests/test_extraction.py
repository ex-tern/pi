"""
Bibliographic extraction: titles, authors, references.

Title and author extraction are not cosmetic. The title is what inter-model
agreement is measured on, and the author string is the key for piQ attribution
and per-author emission decay — so getting them wrong corrupts the
corroboration signal and the leaderboard at the same time.

Run with:  cd backend && pytest tests/ -v
"""
import os
import sys
import tempfile

import pytest

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import extraction

BODY = 10.0
PAGE = 792.0

REAL_TITLES = [
    "Deep Learning Approaches for Predicting Protein Structure from Sequence Data",
    "A Novel Framework for Assessing Reproducibility in Open Science",
    "Towards Robust Evaluation of Large Language Models in Clinical Settings",
]
BOILERPLATE = [
    ("JOURNAL OF COMPUTATIONAL BIOLOGY", 14.0, 40, False),
    ("RESEARCH ARTICLE", 12.0, 60, True),
    ("Abstract", 12.0, 300, True),
    ("Department of Computer Science, University of Example", 10.0, 200, False),
    ("Received 3 March 2025; accepted 14 June 2025", 9.0, 70, False),
    ("https://doi.org/10.1000/xyz", 9.0, 50, False),
    ("Downloaded from www.example.org on 12 May 2026", 9.0, 30, False),
    ("Vol. 42, Issue 7", 11.0, 45, False),
]


# --------------------------------------------------------------------------
# Title scoring
# --------------------------------------------------------------------------
@pytest.mark.parametrize("title", REAL_TITLES)
def test_a_real_title_scores_highly(title):
    assert extraction.score_title_candidate(title, 16.0, BODY, 120, PAGE, True) > 0.6


@pytest.mark.parametrize("text,size,y,bold", BOILERPLATE)
def test_boilerplate_never_outscores_a_real_title(text, size, y, bold):
    """A journal banner in large type must not beat the actual title."""
    best_real = max(extraction.score_title_candidate(t, 16.0, BODY, 120, PAGE, True)
                    for t in REAL_TITLES)
    assert extraction.score_title_candidate(text, size, BODY, y, PAGE, bold) < best_real


def test_a_large_banner_does_not_win_on_size_alone():
    """Size is capped precisely so this cannot happen."""
    banner = extraction.score_title_candidate("JOURNAL OF COMPUTATIONAL BIOLOGY",
                                              24.0, BODY, 30, PAGE, True)
    title = extraction.score_title_candidate(REAL_TITLES[0], 14.0, BODY, 130, PAGE, False)
    assert title > banner


def test_position_matters():
    """The same text lower on the page is less likely to be the title."""
    high = extraction.score_title_candidate(REAL_TITLES[0], 16.0, BODY, 120, PAGE, True)
    low = extraction.score_title_candidate(REAL_TITLES[0], 16.0, BODY, 700, PAGE, True)
    assert high > low


def test_section_headings_are_rejected():
    for heading in ("Abstract", "Introduction", "References", "Acknowledgements"):
        assert extraction.score_title_candidate(heading, 14.0, BODY, 200, PAGE, True) == 0.0


def test_degenerate_input_is_safe():
    for text in ("", "   ", "x", "a b"):
        assert extraction.score_title_candidate(text, 14.0, BODY, 100, PAGE) == 0.0


# --------------------------------------------------------------------------
# Author normalisation
# --------------------------------------------------------------------------
def test_a_normal_byline_is_parsed():
    result = extraction.clean_author_list("Jane Doe, John Smith and Alice Brown")
    assert "Jane Doe" in result and "John Smith" in result and "Alice Brown" in result


def test_affiliation_superscripts_are_stripped():
    result = extraction.clean_author_list("Jane Doe1, John Smith2,*")
    assert "1" not in result and "*" not in result
    assert "Jane Doe" in result


def test_affiliations_are_excluded_from_the_byline():
    result = extraction.clean_author_list(
        "Jane Doe, Department of Physics, University of Example, John Smith")
    assert "University" not in result
    assert "Jane Doe" in result and "John Smith" in result


def test_email_addresses_are_excluded():
    assert "@" not in extraction.clean_author_list("Jane Doe, jane@example.edu")


def test_empty_byline_is_safe():
    assert extraction.clean_author_list("") == ""
    assert extraction.clean_author_list(None) == ""


# --------------------------------------------------------------------------
# Reference parsing — must work without DOIs present
# --------------------------------------------------------------------------
NUMBERED = """
Body text of the paper discussing things.

References
[1] Smith, J. and Doe, A. (2021). A study of things. Journal of Things, 4(2), 1-10.
    doi:10.1038/s41586-021-00001-1
[2] Brown, B. (2019). Another investigation. Proceedings of Somewhere, 45-60.
[3] Lee, C., Kim, D. (2023). Recent advances. Nature Methods 20, 100-110.
    https://doi.org/10.1038/s41592-023-00002-2
"""


def test_numbered_references_are_split_into_entries():
    entries = extraction.parse_reference_entries(NUMBERED)
    assert len(entries) == 3


def test_entries_without_dois_are_still_captured():
    """Many fields still publish bibliographies without DOIs."""
    entries = extraction.parse_reference_entries(NUMBERED)
    assert any(not e["has_identifier"] for e in entries)
    assert all(e["raw"] for e in entries)


def test_dois_and_years_are_extracted():
    entries = extraction.parse_reference_entries(NUMBERED)
    assert any("10.1038/s41586-021-00001-1" in (e["doi"] or "") for e in entries)
    assert {e["year"] for e in entries} >= {"2021", "2019", "2023"}


def test_authors_are_captured_per_entry():
    entries = extraction.parse_reference_entries(NUMBERED)
    assert any("Smith" in e["authors"] for e in entries)


def test_summary_reports_coverage_and_recency():
    summary = extraction.summarize_references(extraction.parse_reference_entries(NUMBERED))
    assert summary["total"] == 3
    assert 0 <= summary["doi_coverage"] <= 1
    assert summary["median_year"] in (2019, 2021, 2023)
    assert summary["year_range"] == [2019, 2023]


def test_an_unnumbered_bibliography_still_parses():
    text = ("Body.\n\nReferences\n\n"
            "Smith J. A study of things. Journal of Things. 2021;4:1-10.\n\n"
            "Brown B. Another investigation. Proceedings. 2019;12:45-60.\n\n"
            "Lee C. Recent advances in the field. Nature Methods. 2023;20:100-110.\n")
    assert len(extraction.parse_reference_entries(text)) >= 2


def test_no_bibliography_yields_no_entries():
    assert extraction.parse_reference_entries("Just body text with no reference list.") == []


def test_empty_input_is_safe():
    assert extraction.parse_reference_entries("") == []
    assert extraction.summarize_references([])["total"] == 0


# --------------------------------------------------------------------------
# Reconciliation — authority ordering
# --------------------------------------------------------------------------
def test_registry_metadata_outranks_everything():
    result = extraction.reconcile_bibliographic_record(
        registry={"title": "Publisher Title", "authors": "Real Author",
                  "confidence": 0.98, "basis": "crossref"},
        layout={"title": "Layout Title", "authors": "Layout Author", "confidence": 0.7},
        model_title="Model Title", model_authors="Model Author", filename="file.pdf")
    assert result["title"] == "Publisher Title"
    assert result["title_basis"] == "crossref"


def test_layout_beats_the_model_panel():
    result = extraction.reconcile_bibliographic_record(
        registry={}, layout={"title": "Layout Title", "confidence": 0.7},
        model_title="Model Title", model_authors="", filename="")
    assert result["title"] == "Layout Title"


def test_filename_is_the_last_resort():
    result = extraction.reconcile_bibliographic_record(
        registry={}, layout={}, model_title="", model_authors="",
        filename="A_Study_Of_Interesting_Things.pdf")
    assert "Study" in result["title"]
    assert result["title_basis"] == "filename"


def test_nothing_available_yields_an_honest_placeholder():
    result = extraction.reconcile_bibliographic_record(
        registry={}, layout={}, model_title="", model_authors="", filename="")
    assert result["title"] == "Untitled Manuscript"
    assert result["title_confidence"] == 0.0


def test_placeholder_model_values_are_ignored():
    """'N/A' from a failed juror must not become the recorded title."""
    result = extraction.reconcile_bibliographic_record(
        registry={}, layout={}, model_title="N/A", model_authors="N/A", filename="")
    assert result["title"] == "Untitled Manuscript"


def test_alternatives_are_retained_for_correction():
    result = extraction.reconcile_bibliographic_record(
        registry={"title": "Publisher Title", "confidence": 0.98, "basis": "crossref"},
        layout={"title": "Layout Title", "confidence": 0.7},
        model_title="Model Title", model_authors="", filename="")
    assert len(result["title_alternatives"]) >= 1
