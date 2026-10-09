"""RiBD suggestions: one ledger paper and one scanned manuscript, by profile."""

import rib_suggest as rs

PROFILE = {"field": "Neuroscience, Medicine", "goal": "stroke, glioblastoma",
           "idea": "Perfusion imaging separates tumour recurrence from necrosis."}


def row(h, title, fields, score=50.0, ts="2026-10-01", ledger=True):
    return {"eval_hash": h, "title": title, "author": "A. Author", "fields": fields,
            "score": score, "timestamp": ts, "on_ledger": ledger}


ROWS = [
    row("a", "Graph theory of social networks", '["Social Sciences"]', 90),
    row("b", "Stroke outcomes after thrombectomy", '["Medicine"]', 60),
    row("c", "Glioblastoma perfusion imaging", '["Neuroscience"]', 55),
    row("d", "Perfusion maps in recurrence", '["Neuroscience"]', 40, ts="2026-10-08", ledger=False),
    row("e", "Unrelated chemistry", '["Chemistry"]', 99, ledger=False),
]


def test_two_different_relevant_picks():
    out = rs.suggest(PROFILE, ROWS)
    assert out["explorer"]["eval_hash"] == "c"          # field + keyword + claim words, on the ledger
    assert out["manuscript"]["eval_hash"] in {"b", "d"}
    assert out["manuscript"]["eval_hash"] != out["explorer"]["eval_hash"]
    assert "Neuroscience" in out["explorer"]["why"] and "glioblastoma" in out["explorer"]["why"]


def test_explorer_pick_is_on_the_ledger():
    rows = [row("x", "Stroke imaging", '["Medicine"]', 80, ledger=False),
            row("y", "Stroke rehabilitation", '["Medicine"]', 30, ledger=True)]
    out = rs.suggest(PROFILE, rows)
    assert out["explorer"]["eval_hash"] == "y"
    assert out["manuscript"]["eval_hash"] == "x"


def test_never_suggests_own_or_irrelevant():
    out = rs.suggest(PROFILE, ROWS, own_hashes={"c", "b", "d"})
    assert out["explorer"] is None and out["manuscript"] is None
    assert "matches your profile" in out["reason"]


def test_empty_profile_asks_for_one():
    out = rs.suggest({}, ROWS)
    assert out["explorer"] is None and "profile" in out["reason"]


def test_only_public_fields_returned():
    out = rs.suggest(PROFILE, ROWS)
    assert set(out["explorer"]) <= {"eval_hash", "title", "author", "fields", "score", "timestamp", "why", "relevance"}
