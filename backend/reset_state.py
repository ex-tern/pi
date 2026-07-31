"""
Full state reset for a fresh ScholarPi launch.

What this destroys
------------------
* Every assessed manuscript and its scores (``papers_assessment``)
* The entire piQ ledger — all balances anyone ever earned (``piq_ledger``)
* Free-trial counters, arcade winnings and IP tracking (``auto_ip_tracking``)
* The global evaluation counter, attestations, and the ingestion queue
* The trained Scilem model weights, so the judge starts from scratch

There is no undo. This is intentional — it exists to wipe a testnet deployment
back to zero before a real launch — but because it lives permanently in the
repo, it refuses to run without an explicit ``--yes`` flag. A destructive
script that runs on a bare invocation is one stray shell-history arrow key away
from deleting production.

Usage
-----
    python reset_state.py --yes                # wipe everything
    python reset_state.py --yes --keep-model   # wipe data, keep trained weights
    python reset_state.py --dry-run            # show what would be deleted
"""
import os
import sys
import argparse
import sqlite3

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import BASE_DIR  # noqa: E402
from database import get_db_connection, enforce_database_schema, reset_schema_cache  # noqa: E402

# Tables emptied by a reset. Listed explicitly rather than discovered from
# sqlite_master so that adding a table doesn't silently start wiping it.
DATA_TABLES = [
    "papers_assessment",
    "piq_ledger",
    "auto_ip_tracking",
    "desci_attestations",
    "ingestion_queue",
    "blockchain_por_weights",
]

MODEL_FILES = ["scilem_model.pt", "scilem_weights.pt", "pidyne_model.pt"]


def table_counts(conn):
    counts = {}
    for table in DATA_TABLES:
        try:
            counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        except sqlite3.Error:
            counts[table] = None      # table not present in this schema version
    return counts


def main():
    parser = argparse.ArgumentParser(description="Reset all ScholarPi state.")
    parser.add_argument("--yes", action="store_true",
                        help="Confirm the wipe. Required; without it nothing is deleted.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would be deleted and exit.")
    parser.add_argument("--keep-model", action="store_true",
                        help="Preserve trained Scilem/Pidyne weights.")
    args = parser.parse_args()

    conn = get_db_connection()
    counts = table_counts(conn)

    print(f"Data directory: {BASE_DIR}")
    print("\nCurrent contents:")
    total = 0
    for table, n in counts.items():
        if n is None:
            print(f"  {table:26} (table not present)")
        else:
            print(f"  {table:26} {n:>8} rows")
            total += n
    print(f"  {'TOTAL':26} {total:>8} rows")

    if args.dry_run:
        print("\nDry run — nothing was deleted.")
        conn.close()
        return 0

    if not args.yes:
        print("\nRefusing to run without --yes. This operation cannot be undone.")
        conn.close()
        return 1

    print("\nWiping…")
    try:
        conn.execute("BEGIN IMMEDIATE")
        for table in DATA_TABLES:
            if counts.get(table) is None:
                continue
            conn.execute(f"DELETE FROM {table}")
            print(f"  cleared {table}")
        # The global counter is a single-row table, so it is reset rather than
        # emptied — the schema expects exactly one row to exist.
        try:
            conn.execute("UPDATE global_eval_counter SET count = 0")
            print("  reset global_eval_counter")
        except sqlite3.Error:
            pass
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"\nReset failed and was rolled back: {e}")
        conn.close()
        return 1

    # VACUUM must run outside a transaction; it reclaims the space the deleted
    # rows occupied so the file on disk actually shrinks.
    try:
        conn.execute("VACUUM")
        print("  vacuumed database")
    except sqlite3.Error as e:
        print(f"  (vacuum skipped: {e})")
    conn.close()

    if not args.keep_model:
        for name in MODEL_FILES:
            path = os.path.join(BASE_DIR, name)
            if os.path.exists(path):
                os.remove(path)
                print(f"  removed {name}")

    # Recreate the schema so the app starts cleanly against an empty database
    # rather than building it lazily on the first request.
    reset_schema_cache()
    conn = get_db_connection()
    enforce_database_schema(conn)
    conn.commit()
    conn.close()
    print("  schema recreated")

    print("\nReset complete. ScholarPi will start from zero.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
