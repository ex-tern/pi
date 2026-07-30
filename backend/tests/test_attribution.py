"""
Authorship attribution and the corrected epoch-weight direction.

Both of these were exploitable or wrong in ways that inverted the system's
incentives, so the tests here are about the *direction* of the mechanism, not
just its arithmetic.

Run with:  cd backend && pytest tests/ -v
"""
import os
import sys
import tempfile

import pytest

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import attribution


# --------------------------------------------------------------------------
# Name matching — a false positive mints someone else's tokens to you
# --------------------------------------------------------------------------
@pytest.mark.parametrize("a,b", [
    ("John Smith", "John Smith"),
    ("J. Smith", "John Smith"),
    ("John A. Smith", "John Smith"),
    ("José García", "Jose Garcia"),
    ("Dr. John Smith", "John Smith"),
    ("A. Kumar", "Anil Kumar"),
])
def test_the_same_person_matches(a, b):
    assert attribution.names_match(a, b)


@pytest.mark.parametrize("a,b", [
    ("John Smith", "Jane Smith"),
    ("John Smith", "John Smithson"),
    ("Smith", "Smith"),
    ("John Smith", "Smith"),
    ("", "John Smith"),
    ("John Smith", ""),
])
def test_different_people_do_not_match(a, b):
    assert not attribution.names_match(a, b)


def test_surname_alone_is_never_enough():
    """Common surnames collide constantly; matching on one would mint wrongly."""
    assert not attribution.names_match("Smith", "John Smith")


def test_accents_and_honorifics_are_normalised():
    assert attribution.normalize_name("Dr. José García") == "jose garcia"


def test_initials_survive_tokenisation():
    """Dropping single characters discarded initials entirely."""
    assert "j" in attribution.name_tokens("J. Smith")


# --------------------------------------------------------------------------
# The verdict — third-party submission is allowed but earns nothing
# --------------------------------------------------------------------------
def test_no_orcid_means_no_minting():
    result = attribution.verify_authorship(extracted_authors="Jane Doe")
    assert result["verified"] is False
    assert "no piq is minted" in result["reason"].lower()


def test_refusal_explains_how_to_fix_it():
    result = attribution.verify_authorship(extracted_authors="Jane Doe")
    assert result["how_to_verify"]
    assert "orcid" in result["how_to_verify"].lower()


def test_submitting_someone_elses_paper_earns_nothing(monkeypatch):
    """The exploit this closes: farming piQ from other people's work."""
    monkeypatch.setattr(attribution, "fetch_orcid_profile_name", lambda o: "Farmer McFarm")
    monkeypatch.setattr(attribution, "registry_orcids_for_doi", lambda d: [])
    result = attribution.verify_authorship(
        submitter_orcid="0000-0002-1825-0097",
        extracted_authors="Jane Doe, John Smith", doi="10.1234/x")
    assert result["verified"] is False


def test_a_real_author_is_credited_by_name(monkeypatch):
    monkeypatch.setattr(attribution, "fetch_orcid_profile_name", lambda o: "Jane Doe")
    monkeypatch.setattr(attribution, "registry_orcids_for_doi", lambda d: [])
    result = attribution.verify_authorship(
        submitter_orcid="0000-0002-1825-0097",
        extracted_authors="Jane Doe, John Smith", doi="")
    assert result["verified"] is True
    assert result["tier"] == "orcid-name-match"
    assert result["matched_author"] == "Jane Doe"


def test_a_registry_deposited_orcid_is_conclusive(monkeypatch):
    monkeypatch.setattr(attribution, "registry_orcids_for_doi",
                        lambda d: ["0000-0002-1825-0097"])
    monkeypatch.setattr(attribution, "fetch_orcid_profile_name", lambda o: "Unrelated Name")
    result = attribution.verify_authorship(
        submitter_orcid="0000-0002-1825-0097",
        extracted_authors="Someone Else", doi="10.1234/x")
    assert result["verified"] is True
    assert result["tier"] == "registry-orcid"
    assert result["confidence"] > 0.95


def test_a_registry_outage_does_not_falsely_credit(monkeypatch):
    def explode(_):
        raise RuntimeError("registry unreachable")
    monkeypatch.setattr(attribution, "registry_orcids_for_doi", explode)
    monkeypatch.setattr(attribution, "fetch_orcid_profile_name", lambda o: "Unrelated Name")
    result = attribution.verify_authorship(
        submitter_orcid="0000-0002-1825-0097",
        extracted_authors="Jane Doe", doi="10.1234/x")
    assert result["verified"] is False


def test_no_extractable_authors_is_reported_honestly(monkeypatch):
    monkeypatch.setattr(attribution, "fetch_orcid_profile_name", lambda o: "Jane Doe")
    monkeypatch.setattr(attribution, "registry_orcids_for_doi", lambda d: [])
    result = attribution.verify_authorship(
        submitter_orcid="0000-0002-1825-0097", extracted_authors="", doi="")
    assert result["verified"] is False
    assert "author list" in result["reason"].lower()


@pytest.mark.parametrize("orcid", ["", "not-an-orcid", "1234", None])
def test_malformed_orcids_are_rejected(orcid):
    assert attribution.fetch_orcid_profile_name(orcid) is None
