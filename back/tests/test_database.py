"""
Tests for database.py against a real (temporary) SQLite file — no mocking
of sqlite3 itself, since correctness here is about actual schema/SQL
behavior, not abstract logic.

Run with:  cd backend && pytest tests/ -v
"""

import pytest

import api as database


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """Point database.py at an isolated, empty SQLite file for this test."""
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(database, "DB_PATH", str(db_path))
    database.reset_schema_cache()
    yield db_path
    database.reset_schema_cache()


def test_get_db_connection_creates_schema_and_genesis_block(temp_db):
    conn = database.get_db_connection()
    try:
        tables = {
            row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        for expected in ("papers_assessment", "blockchain_por_weights", "auto_ip_tracking"):
            assert expected in tables

        genesis_count = conn.execute("SELECT COUNT(*) FROM blockchain_por_weights").fetchone()[0]
        assert genesis_count == 1
    finally:
        conn.close()


def test_get_db_connection_enables_wal_mode(temp_db):
    conn = database.get_db_connection()
    try:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode.lower() == "wal"
    finally:
        conn.close()


def test_free_evals_starts_at_zero_for_unseen_ip(temp_db):
    assert database.get_free_evals_used("203.0.113.1") == 0


def test_increment_free_evals_used_persists_and_accumulates(temp_db):
    ip = "203.0.113.2"
    assert database.increment_free_evals_used(ip) == 1
    assert database.increment_free_evals_used(ip) == 2
    assert database.increment_free_evals_used(ip) == 3
    assert database.get_free_evals_used(ip) == 3


def test_free_evals_are_isolated_per_ip(temp_db):
    database.increment_free_evals_used("203.0.113.10")
    database.increment_free_evals_used("203.0.113.10")
    assert database.get_free_evals_used("203.0.113.10") == 2
    assert database.get_free_evals_used("203.0.113.99") == 0


def test_increment_free_evals_used_ignores_empty_ip(temp_db):
    assert database.increment_free_evals_used("") == 0
    assert database.get_free_evals_used("") == 0


def test_enforce_database_schema_is_idempotent(temp_db):
    conn = database.get_db_connection()
    try:
        # Calling it again on the same connection should not error or
        # duplicate anything (mirrors what happens across many requests
        # sharing the schema-initialized flag).
        database.enforce_database_schema(conn)
        database.enforce_database_schema(conn)
        cols = [row[1] for row in conn.execute("PRAGMA table_info(auto_ip_tracking)").fetchall()]
        assert cols.count("free_evals_used") == 1
    finally:
        conn.close()


def test_leaderboard_groups_researchers_by_registry_id():
    """One researcher written two ways is one row; two researchers with one name are two (owner, 2026-10-13)."""
    import json as _json
    A = {"name": "John Smith", "openalex_id": "A1", "orcid": "0000-0001-0000-0001"}
    A2 = {"name": "J. Smith", "openalex_id": "A1", "orcid": "0000-0001-0000-0001"}      # same person, other byline
    B = {"name": "John Smith", "openalex_id": "A2", "orcid": ""}                          # a different John Smith
    C = {"name": "Ada Lovelace", "openalex_id": "A3", "orcid": ""}
    rows = [
        ("John Smith, Ada Lovelace", 2.0, 80.0, 0.0, None, _json.dumps([A, C])),
        ("J. Smith", 1.0, 60.0, 0.0, None, _json.dumps([A2])),
        ("John Smith", 1.0, 50.0, 0.0, None, _json.dumps([B])),
        ("Ada Lovelace", 4.0, 90.0, 0.0, None, ""),          # no registry record: her name joins her id
    ]
    out = {(r["orcid"] or r["openalex_id"]): r for r in database.aggregate_author_statistics(rows)}
    assert set(out) == {"0000-0001-0000-0001", "A2", "A3"}
    assert out["0000-0001-0000-0001"]["papers"] == 2
    assert out["A3"]["papers"] == 2 and out["A3"]["piq"] == 5.0          # 1.0 (half of 2.0) + 4.0
    assert out["A2"]["papers"] == 1
    # rows from before author_ids existed still group by name
    old = database.aggregate_author_statistics([("Grace Hopper", 1.0, 70.0), ("Grace Hopper", 1.0, 80.0)])
    assert len(old) == 1 and old[0]["papers"] == 2
