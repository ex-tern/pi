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


def test_more_reading_is_relevant_and_distinct():
    rows = ROWS + [row("f", "Stroke rehabilitation trial", '["Medicine"]', 70),
                   row("g", "Glioblastoma genetics", '["Biology"]', 65)]
    out = rs.suggest(PROFILE, rows)
    picked = {out["explorer"]["eval_hash"], out["manuscript"]["eval_hash"]}
    more = [m["eval_hash"] for m in out["more"]]
    assert more and not picked & set(more) and "a" not in more and "e" not in more


def test_hot_topics_rank_by_pix_piq_and_activity():
    from datetime import datetime, timedelta
    now = datetime(2026, 10, 9)
    recent = (now - timedelta(days=3)).isoformat(sep=" ")
    old = (now - timedelta(days=90)).isoformat(sep=" ")
    rows = [
        {"fields": '["Neuroscience"]', "score": 80, "piq": 2.0, "timestamp": recent},
        {"fields": '["Neuroscience"]', "score": 70, "piq": 1.5, "timestamp": recent},
        {"fields": '["Physics"]', "score": 40, "piq": 0.2, "timestamp": old},
        {"fields": '["Physics"]', "score": 45, "piq": 0.1, "timestamp": old},
        {"fields": '["Art"]', "score": 99, "piq": 9.0, "timestamp": recent},   # one paper: not enough to call
    ]
    hot = rs.hot_topics(rows, ["physics"], now=now)
    assert [h["field"] for h in hot] == ["Neuroscience", "Physics"]
    assert hot[0]["avg_pix"] == 75.0 and hot[0]["avg_piq"] == 1.75 and hot[0]["recent"] == 2
    assert hot[1]["yours"] is True and hot[0]["yours"] is False


def test_hot_topics_even_without_a_profile():
    rows = [{"eval_hash": str(i), "title": "t", "fields": '["Physics"]', "score": 50, "piq": 1, "timestamp": "2026-10-01"} for i in range(3)]
    out = rs.suggest({}, rows)
    assert out["hot"] and out["hot"][0]["field"] == "Physics"
