"""Small shared helpers, kept out of api.py to avoid a circular import.

`assistant` needs the corpus size; `api` imports `assistant`. Putting the
lookup here lets both use it without either importing the other.
"""
import logging
import sqlite3


def corpus_size_safe() -> int:
    """Assessed-paper count, or 0 if the table is unavailable."""
    try:
        from database import get_db_connection
        conn = get_db_connection()
        try:
            return conn.execute("SELECT COUNT(*) FROM papers_assessment").fetchone()[0] or 0
        finally:
            conn.close()
    except (sqlite3.Error, Exception) as e:
        logging.debug("Corpus size unavailable: %s", e)
        return 0
