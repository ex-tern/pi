import sqlite3
import json
import logging
from datetime import datetime
from typing import Optional
# Imported at module scope rather than inside complete_review: the bonus is
# part of what a completed review pays, and a lazy import would let a bad
# emission module fail at payment time instead of at start-up.
from emission import PEER_REVIEW_BONUS
from config import (
    DB_PATH, GENESIS_BLOCK_CONFIG, DEPLOYMENT_FINGERPRINT, compute_genesis_hash,
)

_schema_initialized = False

# Columns added after the original schema. Checked cheaply on every connection
# so a long-running process can never serve queries against a stale schema.
REQUIRED_ASSESSMENT_COLUMNS = {
    "warnings_json", "judge_metadata", "integrity_report", "reference_audit",
    "authorship_signal", "topology_detail", "classification", "criteria_breakdown",
    "signal_vector", "rubric_version", "author_metrics", "emission_record",
    "author_openalex_id", "scoring_epoch", "unweighted_score", "attribution",
    # The four deterministic structural measurements, stored so a later user
    # correction can be learned from without retaining manuscript text.
    "scilem_signals",
    # piQ earned by a paper whose authorship is not yet verified. Held, not
    # discarded — see the note on the column definition below.
    "piq_escrowed", "piq_claimed_at",
    # Candidate corresponding-author addresses found in the manuscript.
    "contact_emails",
    # Author-published state. See the column notes below.
    "published_at", "published_by", "publish_kind",
}

def reset_schema_cache():
    global _schema_initialized
    _schema_initialized = False

def enforce_database_schema(conn: sqlite3.Connection):
    """Bring the database up to the current schema.

    The in-process cache below is a performance optimisation, not a guarantee.
    It is deliberately guarded by a cheap column check: if the running process
    cached `_schema_initialized = True` before a new column was introduced, the
    ALTER TABLE would otherwise never execute, and every query naming that
    column would fail with "no such column" until the process was restarted.
    That failure mode is invisible in development (where you restart
    constantly) and total in production.
    """
    global _schema_initialized
    if _schema_initialized:
        try:
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(papers_assessment)")
            existing = {row[1] for row in cursor.fetchall()}
            if existing and REQUIRED_ASSESSMENT_COLUMNS.issubset(existing):
                return
            # Schema drifted since this process cached its state — fall through
            # and re-run the migration.
            logging.info("Schema drift detected; re-running migration.")
        except sqlite3.Error:
            return

    cursor = conn.cursor()
    
    # 1. Core Assessment Table
    cursor.execute("""CREATE TABLE IF NOT EXISTS papers_assessment 
                      (eval_hash TEXT PRIMARY KEY, user_id TEXT, title TEXT, filename TEXT, scope TEXT,
                       c1 REAL, c2 REAL, c3 REAL, c4 REAL, c5 REAL, c6 REAL, c7 REAL, c8 REAL, 
                       scope_alignment REAL, logic_score REAL, subfields TEXT, fields TEXT, 
                       author_name TEXT, final_score REAL, timestamp DATETIME)""")

    # 2. Blockchain PoR Table
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='blockchain_por_weights'")
    if cursor.fetchone():
        cursor.execute("PRAGMA table_info(blockchain_por_weights)")
        columns = [row[1] for row in cursor.fetchall()]
        if "por_proof" not in columns or "formulas_hash" not in columns:
            cursor.execute("ALTER TABLE blockchain_por_weights RENAME TO old_blockchain_por_weights")
            cursor.execute("""CREATE TABLE blockchain_por_weights 
                              (block_height INTEGER PRIMARY KEY AUTOINCREMENT, w1 REAL, w2 REAL, w3 REAL, w4 REAL, w5 REAL, w6 REAL, w7 REAL, w8 REAL, 
                               timestamp DATETIME, previous_hash TEXT, validator_node TEXT, block_hash TEXT, eval_hash TEXT, model_used TEXT,
                               por_proof TEXT DEFAULT 'Genesis_Proof', formulas_hash TEXT DEFAULT 'Locked_State')""")
            try:
                cursor.execute("INSERT INTO blockchain_por_weights (block_height, w1, w2, w3, w4, w5, w6, w7, w8, timestamp, previous_hash, validator_node, block_hash, eval_hash, model_used) SELECT block_height, w1, w2, w3, w4, w5, w6, w7, w8, timestamp, previous_hash, validator_node, block_hash, eval_hash, model_used FROM old_blockchain_por_weights")
            except: pass
            cursor.execute("DROP TABLE old_blockchain_por_weights")
    else:
        cursor.execute("""CREATE TABLE blockchain_por_weights 
                          (block_height INTEGER PRIMARY KEY AUTOINCREMENT, w1 REAL, w2 REAL, w3 REAL, w4 REAL, w5 REAL, w6 REAL, w7 REAL, w8 REAL, 
                           timestamp DATETIME, previous_hash TEXT, validator_node TEXT, block_hash TEXT, eval_hash TEXT, model_used TEXT,
                           por_proof TEXT DEFAULT 'Genesis_Proof', formulas_hash TEXT DEFAULT 'Locked_State')""")

    # Bug reports. Stored before any delivery attempt so a mail failure can
    # never lose a report — `delivered` records the outcome separately, and a
    # row with delivered=0 is a report the maintainer still needs to read out
    # of the database.
    cursor.execute("""CREATE TABLE IF NOT EXISTS bug_reports (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        message TEXT NOT NULL,
                        contact TEXT DEFAULT '',
                        identity TEXT DEFAULT '',
                        page TEXT DEFAULT '',
                        user_agent TEXT DEFAULT '',
                        ip_hash TEXT DEFAULT '',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        delivered INTEGER DEFAULT 0,
                        delivery_error TEXT DEFAULT '')""")

    # Backup provenance: which IPFS CID the state was last pinned under, and
    # whether that CID was anchored on-chain. Kept as history rather than a
    # single row, because "the backup silently stopped working three weeks
    # ago" is only diagnosable if the successful ones are dated.
    cursor.execute("""CREATE TABLE IF NOT EXISTS backup_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        cid TEXT NOT NULL,
                        tx_hash TEXT DEFAULT '',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")

    # Arcade progress and run history.
    #
    # Keyed by identity where one exists and by IP hash otherwise, because the
    # difficulty ramp must survive a browser refresh — held client-side it
    # would be a suggestion rather than a rule, and clearing localStorage would
    # reset the ramp for free.
    cursor.execute("""CREATE TABLE IF NOT EXISTS arcade_progress (
                        account_key TEXT PRIMARY KEY,
                        is_identity INTEGER DEFAULT 0,
                        difficulty_level INTEGER DEFAULT 0,
                        wins INTEGER DEFAULT 0,
                        runs INTEGER DEFAULT 0,
                        best_mass REAL DEFAULT 0,
                        display_name TEXT DEFAULT '',
                        last_run_at DATETIME,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_arcade_best ON arcade_progress(best_mass DESC)")

    # Scilem's learned calibration. One row of state plus an append-only
    # observation log, so the current weights can always be recomputed from
    # scratch and audited — a scoring model that cannot be reproduced or
    # rolled back has no business scoring research.
    cursor.execute("""CREATE TABLE IF NOT EXISTS scilem_state (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        state_json TEXT NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    cursor.execute("""CREATE TABLE IF NOT EXISTS scilem_observations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        eval_hash TEXT DEFAULT '',
                        signals_json TEXT NOT NULL,
                        predicted REAL,
                        target REAL,
                        source TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")

    # Authorship challenges. Codes are stored hashed and salted per paper, so a
    # database read never yields a live code.
    cursor.execute("""CREATE TABLE IF NOT EXISTS authorship_challenges (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        eval_hash TEXT NOT NULL,
                        account_key TEXT NOT NULL,
                        email_masked TEXT NOT NULL,
                        email_hash TEXT NOT NULL,
                        code_hash TEXT NOT NULL,
                        attempts INTEGER DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        verified_at DATETIME)""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_challenge_lookup "
                   "ON authorship_challenges(eval_hash, account_key)")

    # Peer review. A request is opened by paying a fee; the fee is held and
    # paid to whoever completes the review. The badge derives from a COMPLETED
    # row — never from the payment — so it cannot be bought.
    cursor.execute("""CREATE TABLE IF NOT EXISTS peer_reviews (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        eval_hash TEXT NOT NULL,
                        requested_by TEXT NOT NULL,
                        bounty REAL DEFAULT 0,
                        reviewer_key TEXT DEFAULT '',
                        verdict TEXT DEFAULT '',
                        comment TEXT DEFAULT '',
                        requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        completed_at DATETIME)""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_peer_reviews_hash ON peer_reviews(eval_hash)")

    # 3. New Ingestion Queue for Microservices
    cursor.execute("""CREATE TABLE IF NOT EXISTS ingestion_queue (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT, source_val TEXT, 
                        file_name TEXT, raw_bytes BLOB, status TEXT, timestamp DATETIME)""")

    # piQ ledger — double-entry style record of every credit (minting) and
    # debit (the flat per-paper processing fee). The user's spendable balance
    # is the signed sum of these entries, which is why the fee model replaced
    # the old "stake" checkbox: staking was never actually settled anywhere.
    cursor.execute("""CREATE TABLE IF NOT EXISTS piq_ledger (
                        entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        account TEXT NOT NULL,
                        account_kind TEXT NOT NULL,
                        delta REAL NOT NULL,
                        reason TEXT,
                        eval_hash TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_piq_ledger_account ON piq_ledger(account)")

    cursor.execute("CREATE TABLE IF NOT EXISTS global_eval_counter (count INTEGER)")
    cursor.execute("CREATE TABLE IF NOT EXISTS desci_attestations (attestation_id TEXT PRIMARY KEY, eval_hash TEXT, attester_id TEXT, stake_amount REAL, stance TEXT, timestamp DATETIME)")
    cursor.execute("CREATE TABLE IF NOT EXISTS auto_ip_tracking (ip_address TEXT PRIMARY KEY, first_seen DATETIME)")

    # Site visits. Deliberately NOT reusing auto_ip_tracking: that table exists
    # to meter the free trial and only ever sees people who submit a paper, so
    # counting it would report "visitors" while measuring submitters.
    #
    # visitor_key is a keyed hash of the IP, never the address itself. A raw IP
    # log is personal data under GDPR and would need a retention policy, a
    # lawful basis and a way to honour erasure requests — none of which a
    # visitor counter is worth. The hash counts distinct visitors and cannot be
    # reversed into who they were.
    cursor.execute("""CREATE TABLE IF NOT EXISTS site_visits (
                        visitor_key TEXT PRIMARY KEY,
                        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                        visits INTEGER DEFAULT 1)""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_site_visits_last ON site_visits(last_seen)")
    cursor.execute("""CREATE TABLE IF NOT EXISTS researcher_profiles (
                        account_key TEXT PRIMARY KEY, field TEXT, career_stage TEXT,
                        goal TEXT, idea TEXT, abstract TEXT, updated_at DATETIME)""")

    # Named profiles, so a researcher working across several projects can keep
    # a separate description of each rather than overwriting one.
    #
    # `researcher_profiles` above is KEPT as the active-profile mirror rather
    # than migrated away. Every existing reader — the diagnostic framing, the
    # Research Buddy, the reset path — asks it for "the profile for this
    # account", and that question still has one answer: whichever slot is
    # active. Adding a table beside it means multiple profiles cost one write
    # on activation instead of a rewrite of everything that consumes them.
    cursor.execute("""CREATE TABLE IF NOT EXISTS researcher_profile_slots (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        account_key TEXT NOT NULL,
                        name TEXT NOT NULL,
                        field TEXT DEFAULT '', career_stage TEXT DEFAULT '',
                        goal TEXT DEFAULT '', idea TEXT DEFAULT '',
                        abstract TEXT DEFAULT '',
                        is_active INTEGER DEFAULT 0,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_profile_slots_acct "
                   "ON researcher_profile_slots(account_key)")

    cursor.execute("SELECT COUNT(*) FROM global_eval_counter")
    if cursor.fetchone()[0] == 0: cursor.execute("INSERT INTO global_eval_counter (count) VALUES (0)")

    # auto_ip_tracking gains a usage counter so free-trial limits can be
    # enforced server-side (in addition to the client-side localStorage
    # gate, which a user can trivially clear).
    cursor.execute("PRAGMA table_info(auto_ip_tracking)")
    ip_cols = [row[1] for row in cursor.fetchall()]
    if "free_evals_used" not in ip_cols:
        try:
            cursor.execute("ALTER TABLE auto_ip_tracking ADD COLUMN free_evals_used INTEGER DEFAULT 0")
        except Exception:
            pass
    # Bonus allowance earned by playing the Science Map arcade. Kept in a
    # separate column from free_evals_used so the base entitlement and the
    # earned entitlement can be reasoned about (and capped) independently.
    if "bonus_evals" not in ip_cols:
        try:
            cursor.execute("ALTER TABLE auto_ip_tracking ADD COLUMN bonus_evals INTEGER DEFAULT 0")
        except Exception:
            pass
    if "bonus_last_award" not in ip_cols:
        try:
            cursor.execute("ALTER TABLE auto_ip_tracking ADD COLUMN bonus_last_award DATETIME")
        except Exception:
            pass

    # Ensure assessment columns exist
    target_columns = {
        "eth_book": "TEXT DEFAULT 'None'", "eth_wallet": "TEXT DEFAULT 'None'", "piq_minted": "REAL DEFAULT 0.0",
        "epc_minted": "REAL DEFAULT 0.0", "tx_hash": "TEXT DEFAULT 'Pending'", "zk_proof": "TEXT DEFAULT 'None'",
        "did": "TEXT DEFAULT 'None'", "zk_email_proof": "TEXT DEFAULT 'None'", "gaming_penalty": "REAL DEFAULT 0.0",
        "mdar_adherence_score": "REAL DEFAULT 0.0", "rrid_valid_count": "INTEGER DEFAULT 0",
        "credit_taxonomy_roles": "TEXT DEFAULT 'None'", "reproducibility_score": "REAL DEFAULT 0.0",
        "doi": "TEXT DEFAULT 'None'", "consensus_data": "TEXT DEFAULT '{}'", "evidence_report": "TEXT DEFAULT ''",
        "scilem_score": "REAL DEFAULT 50.0",
        # Pipeline warnings and final-judge metadata are persisted so the full
        # dossier can be reconstructed later from the ledger explorer, not just
        # from the in-memory result of the run that produced it.
        "warnings_json": "TEXT DEFAULT '[]'", "judge_metadata": "TEXT DEFAULT '{}'",
        # Adversarial-integrity verdict, reference-verification audit, advisory
        # authorship signal, and the hierarchical topic breakdown behind C3/C4.
        # Persisted so a dossier retrieved months later still explains itself.
        "integrity_report": "TEXT DEFAULT '{}'", "reference_audit": "TEXT DEFAULT '{}'",
        "authorship_signal": "TEXT DEFAULT '{}'", "topology_detail": "TEXT DEFAULT '{}'",
        # Real field classification (with its provenance), the per-criterion
        # rubric breakdown, the normalized signal vector that produced it, and
        # the rubric version — so any historical score can be re-derived and
        # audited even after the rubric changes.
        "classification": "TEXT DEFAULT '{}'", "criteria_breakdown": "TEXT DEFAULT '[]'",
        "signal_vector": "TEXT DEFAULT '{}'", "rubric_version": "TEXT DEFAULT ''",
        # Scilem's four deterministic measurements for this paper. Persisted so
        # a correction submitted weeks later can be turned into a learning step
        # without the deployment having to retain manuscript text.
        "scilem_signals": "TEXT DEFAULT '{}'",
        # Emission was previously computed and then thrown away when authorship
        # could not be verified, so a researcher saw "0.00 piQ" with no
        # indication that anything had been earned at all. The amount is now
        # recorded and held: the work was done, the paper qualified, and only
        # the link between submitter and author is missing. Claimable later.
        "piq_escrowed": "REAL DEFAULT 0.0",
        "piq_claimed_at": "DATETIME",
        # Addresses the manuscript itself lists for its authors. Stored because
        # the authorship challenge must send to an address the DOCUMENT names,
        # never one the claimant supplies — and the document text is not kept.
        "contact_emails": "TEXT DEFAULT '[]'",
        # Set when a VERIFIED author chooses to attach their name publicly to
        # an assessment. This is an authorship endorsement, not a claim about
        # journal publication — see the badge wording, which is deliberately
        # "Author-published" so the two cannot be confused.
        "published_at": "DATETIME",
        "published_by": "TEXT DEFAULT ''",
        # "author" or "journal". Journal is only ever set when a DOI actually
        # resolves in a registry — otherwise it would be a second purchasable
        # credibility claim, which is the thing this framework argues against.
        "publish_kind": "TEXT DEFAULT 'author'",
        # Real h-index / i10-index from OpenAlex. Reported as author context;
        # excluded from scoring per CoARA.
        "author_metrics": "TEXT DEFAULT '{}'",
        # Difficulty-adjusted emission record: what was minted and why.
        "emission_record": "TEXT DEFAULT '{}'",
        # Author identity resolved to an OpenAlex ID, so per-author accounting
        # survives byline variation ("J. Smith" vs "John Smith").
        "author_openalex_id": "TEXT DEFAULT ''",
        # Authorship verdict: piQ is minted only to verified authors, so the
        # evidence behind that decision must be recorded with the assessment.
        "attribution": "TEXT DEFAULT '{}'",
        # The epoch whose criteria weights produced final_score, plus the
        # unweighted mean, so a score stays interpretable after weights move.
        "scoring_epoch": "INTEGER DEFAULT 0", "unweighted_score": "REAL DEFAULT 0.0",
        # How many times this assessment's dossier has been opened. Counted
        # per identity/IP once a day (see record_paper_read) rather than per
        # click, because a raw click counter is trivially inflatable and a
        # reads number that can be manufactured is worse than no number.
        "reads": "INTEGER DEFAULT 0",
    }
    cursor.execute("PRAGMA table_info(papers_assessment)")
    existing_cols = [row[1] for row in cursor.fetchall()]
    for col, dtype in target_columns.items():
        if col not in existing_cols:
            try: cursor.execute(f"ALTER TABLE papers_assessment ADD COLUMN {col} {dtype}")
            except: pass

    # Reader log behind the `reads` column. One row per (paper, reader, day),
    # so a refresh loop cannot inflate the count and the aggregate on
    # papers_assessment stays reconstructible from evidence rather than being
    # a number nobody can audit.
    cursor.execute("""CREATE TABLE IF NOT EXISTS paper_reads (
                        eval_hash TEXT NOT NULL,
                        reader TEXT NOT NULL,
                        read_day TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (eval_hash, reader, read_day))""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_paper_reads_hash ON paper_reads(eval_hash)")

    # Contact messages are bugs OR suggestions. Added as a column rather than a
    # second table: they share every field, every delivery path and one
    # operator queue — the only thing that differs is what the sender is
    # claiming, which is exactly what a column is for. Existing rows default to
    # 'bug', which is what they were.
    cursor.execute("PRAGMA table_info(bug_reports)")
    if "kind" not in [row[1] for row in cursor.fetchall()]:
        try:
            cursor.execute("ALTER TABLE bug_reports ADD COLUMN kind TEXT DEFAULT 'bug'")
        except sqlite3.Error:
            pass

    # Queued LLM review work. The review outlives the HTTP request that asked
    # for it: the fee is charged up front, so a user who closes the tab must
    # still get what they paid for. The job row is what makes that recoverable
    # — the request is durable before any model is called, and a crash leaves
    # a "running" row that can be refunded rather than piQ spent on nothing.
    cursor.execute("""CREATE TABLE IF NOT EXISTS review_jobs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        eval_hash TEXT NOT NULL,
                        requested_by TEXT DEFAULT '',
                        wallet TEXT DEFAULT '',
                        orcid TEXT DEFAULT '',
                        kind TEXT DEFAULT 'llm',
                        status TEXT DEFAULT 'queued',
                        fee REAL DEFAULT 0,
                        verdict TEXT DEFAULT '',
                        message TEXT DEFAULT '',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        finished_at DATETIME)""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_review_jobs_by ON review_jobs(requested_by)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_review_jobs_status ON review_jobs(status)")

    # An author's reply to a review of their paper.
    #
    # Kept in its own table rather than as a column on peer_reviews, because a
    # rebuttal is a separate authored statement with its own author and its own
    # timestamp — not an edit to someone else's review. Reviews are never
    # modified by the person they are about; the reply sits beside the review
    # and both are shown.
    cursor.execute("""CREATE TABLE IF NOT EXISTS review_rebuttals (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        review_id INTEGER NOT NULL,
                        eval_hash TEXT NOT NULL,
                        author_key TEXT NOT NULL,
                        body TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rebuttals_review ON review_rebuttals(review_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rebuttals_hash ON review_rebuttals(eval_hash)")

    # Was this review useful? One vote per identity per review, enforced by the
    # primary key rather than by a check-then-insert, so two tabs cannot race
    # into two votes. Stored as a value (+1/-1) rather than two counters, so a
    # voter can change their mind and the row is simply overwritten.
    cursor.execute("""CREATE TABLE IF NOT EXISTS review_ratings (
                        review_id INTEGER NOT NULL,
                        voter_key TEXT NOT NULL,
                        value INTEGER NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (review_id, voter_key))""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ratings_review ON review_ratings(review_id)")

    # A report is a moderation signal, not a vote, and is deliberately a
    # different thing from a downvote: "I disagree with this review" and "this
    # review is abusive, fabricated, or conflicted" must not share a counter,
    # or the second gets buried under the first.
    cursor.execute("""CREATE TABLE IF NOT EXISTS review_reports (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        review_id INTEGER NOT NULL,
                        eval_hash TEXT DEFAULT '',
                        reporter_key TEXT NOT NULL,
                        reason TEXT NOT NULL,
                        detail TEXT DEFAULT '',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        resolved INTEGER DEFAULT 0)""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reports_review ON review_reports(review_id)")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_once "
                   "ON review_reports(review_id, reporter_key)")

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_papers_eval_hash ON papers_assessment(eval_hash)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_papers_eth_book ON papers_assessment(eth_book)")
    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_papers_author_oa ON papers_assessment(author_openalex_id)")
    except sqlite3.Error:
        pass
    conn.commit()
    _schema_initialized = True

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30.0)
    # WAL mode lets reads proceed concurrently with a write instead of
    # locking the whole file — matters once more than one request can be
    # in flight at a time (production, not single-user local dev).
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
    except sqlite3.Error:
        pass
    enforce_database_schema(conn)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM blockchain_por_weights")
    if cursor.fetchone()[0] == 0:
        g = GENESIS_BLOCK_CONFIG
        block_hash = compute_genesis_hash(g)
        cursor.execute("""INSERT INTO blockchain_por_weights (block_height, w1, w2, w3, w4, w5, w6, w7, w8, timestamp, previous_hash, validator_node, block_hash, eval_hash, model_used, por_proof, formulas_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (g["block_height"], *g["weights"], g["timestamp"], g["previous_hash"], g["validator_node"], block_hash, g["eval_hash"], g["model_used"], g["por_proof"], g["formulas_hash"]))
        conn.commit()
    else:
        _warn_on_genesis_mismatch(conn)
    return conn


# Emitted once per process rather than on every connection: this runs on a hot
# path and an unconditional warning would drown the log.
_genesis_checked = False


def _warn_on_genesis_mismatch(conn):
    """Detects a chain whose root no longer matches this deployment's config.

    The genesis block is derived from the owner wallet, token contract and
    chain id. Those are configuration, and configuration changes — but the
    chain root was written once, at first launch, and every later block hashes
    onto it. So if someone rotates the owner or points at a new token contract
    without resetting, the stored chain is still internally consistent while
    silently belonging to the *previous* deployment identity.

    That is exactly the ambiguity the derived genesis exists to remove, so it
    must be surfaced loudly rather than passed over. This only reports; it
    never rewrites history, because retroactively editing the root would
    invalidate every block above it.
    """
    global _genesis_checked
    if _genesis_checked:
        return
    _genesis_checked = True
    try:
        row = conn.execute(
            "SELECT block_hash, por_proof FROM blockchain_por_weights "
            "WHERE block_height = 1"
        ).fetchone()
    except sqlite3.Error:
        return
    if not row:
        return

    expected = compute_genesis_hash()
    if row[0] == expected:
        return

    stored_fp = ""
    if row[1] and ":" in str(row[1]):
        stored_fp = str(row[1]).split(":", 1)[1][:16]
    logging.warning(
        "Proof-of-Research chain genesis does not match this deployment's configuration. "
        "Stored root %s (deployment %s) vs expected %s (deployment %s). The existing chain "
        "was created under a different owner wallet, token contract or network. History is "
        "left untouched; run reset_state.py --yes to start a chain under the current identity.",
        row[0][:16], stored_fp or "legacy",
        expected[:16], DEPLOYMENT_FINGERPRINT[:16],
    )


def normalize_account(value: str) -> str:
    """Case-fold an account identifier for comparison.

    Ethereum addresses are case-insensitive — the mixed case in a checksummed
    address (EIP-55) is a checksum, not identity. The assessment path stores
    `eth_book` checksummed via `to_checksum_address`, while the browser sends
    whatever case the wallet reports, so exact string matching silently failed
    to find a user's own papers: balances read 0.00 while piQ plainly existed,
    and the fee check then refused to run the assessment at all.

    Everything is compared case-folded now. ORCID iDs are digits plus a
    possible trailing X, so folding them is harmless.
    """
    return (value or "").strip().lower()


def _account_keys(wallet: str = "", orcid: str = ""):
    keys = []
    if orcid:
        keys.append(("orcid", normalize_account(orcid)))
    if wallet:
        keys.append(("wallet", normalize_account(wallet)))
    return keys


def get_piq_minted_total(wallet: str = "", orcid: str = "") -> float:
    """Lifetime piQ awarded to this identity across all its assessed papers."""
    keys = _account_keys(wallet, orcid)
    if not keys:
        return 0.0
    clauses, params = [], []
    if orcid:
        clauses.append("LOWER(user_id) = ?")
        params.append(normalize_account(orcid))
    if wallet:
        # LOWER() on both sides: eth_book is stored checksummed, the caller's
        # wallet arrives in whatever case the browser wallet reported.
        clauses.append("LOWER(eth_book) = ?")
        params.append(normalize_account(wallet))
    conn = get_db_connection()
    try:
        rows = conn.execute(
            f"SELECT DISTINCT eval_hash, piq_minted FROM papers_assessment WHERE {' OR '.join(clauses)}",
            tuple(params),
        ).fetchall()
    finally:
        conn.close()
    total = 0.0
    for _, piq in rows:
        try:
            total += float(piq or 0.0)
        except (TypeError, ValueError):
            continue
    return round(total, 4)


def get_piq_ledger_net(wallet: str = "", orcid: str = "") -> float:
    """Net of every ledger entry: debits are negative, refunds positive.

    Summing *all* entries rather than only the negative ones is what makes
    refunds actually work — an earlier version totalled debits alone, so a
    refunded fee was recorded but never returned to the user's balance.
    """
    keys = _account_keys(wallet, orcid)
    if not keys:
        return 0.0
    placeholders = ", ".join("?" for _ in keys)
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"SELECT COALESCE(SUM(delta), 0) FROM piq_ledger WHERE LOWER(account) IN ({placeholders})",
            tuple(v for _, v in keys),
        ).fetchone()
    finally:
        conn.close()
    return float(row[0] or 0.0)


def get_piq_rewards_total(wallet: str = "", orcid: str = "") -> float:
    """piQ credited to this identity by something other than assessing a paper.

    Arcade wins, review bounties, refunds and onboarding grants are all ledger
    credits. `get_piq_minted_total` deliberately counts only piQ minted against
    an assessed manuscript, so none of these appear in it — which meant a player
    who won piQ in the arcade watched "piQ earned" stay at 0.00 while only the
    spendable balance moved, and reasonably concluded the reward never arrived.

    Summing the positive side of the ledger separately lets the interface show
    where piQ actually came from instead of implying assessment is the only
    source.
    """
    keys = _account_keys(wallet, orcid)
    if not keys:
        return 0.0
    placeholders = ", ".join("?" for _ in keys)
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"""SELECT COALESCE(SUM(delta), 0) FROM piq_ledger
                WHERE delta > 0 AND LOWER(account) IN ({placeholders})""",
            tuple(v for _, v in keys),
        ).fetchone()
    except sqlite3.Error:
        return 0.0
    finally:
        conn.close()
    return round(float(row[0] or 0.0), 4)


def get_piq_fees_paid(wallet: str = "", orcid: str = "") -> float:
    """Net piQ this identity has actually spent on fees, after refunds."""
    net = get_piq_ledger_net(wallet, orcid)
    return round(max(0.0, -net), 4)


def get_piq_balance(wallet: str = "", orcid: str = "") -> dict:
    """Spendable balance = lifetime minted piQ plus the net ledger position.

    New users start at zero, so the free-trial allowance (FREE_EVALS_PER_IP)
    is what lets someone get their first paper assessed and earn the piQ that
    funds subsequent runs.
    """
    minted = get_piq_minted_total(wallet, orcid)
    net = get_piq_ledger_net(wallet, orcid)
    # Rounded to 4dp so accumulated float error across many 0.1 debits can't
    # leave a drained account at -4e-15 and wrongly fail an affordability check.
    # Held piQ is reported alongside the balance but is NOT part of it: it has
    # been earned and not yet credited to a proven author, so it cannot be
    # spent. Returning it here is what lets every "insufficient balance"
    # message say "…and you have X held, claim it first" instead of leaving
    # someone staring at 0.00 while the interface shows them 31.35 elsewhere.
    held = 0.0
    keys = _account_keys(wallet, orcid)
    if keys:
        accounts = [a for _, a in keys]
        ph = ",".join("?" for _ in accounts)
        conn = get_db_connection()
        try:
            row = conn.execute(
                f"""SELECT COALESCE(SUM(piq_escrowed), 0) FROM papers_assessment
                    WHERE piq_claimed_at IS NULL
                      AND (user_id IN ({ph}) OR author_openalex_id IN ({ph}))""",
                (*accounts, *accounts)).fetchone()
            held = round(float(row[0] or 0.0), 4)
        except sqlite3.Error:
            held = 0.0
        finally:
            conn.close()

    return {
        "minted": minted,
        "fees_paid": round(max(0.0, -net), 4),
        "balance": round(minted + net, 4),
        "held": held,
    }


def has_received_grant(wallet: str = "", orcid: str = "") -> bool:
    """Whether this identity has already been granted its onboarding stake."""
    keys = _account_keys(wallet, orcid)
    if not keys:
        return True   # no identity: nothing to grant against
    placeholders = ", ".join("?" for _ in keys)
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"""SELECT COUNT(*) FROM piq_ledger
                WHERE LOWER(account) IN ({placeholders}) AND reason LIKE '%onboarding grant%'""",
            tuple(v for _, v in keys),
        ).fetchone()
        return bool(row and row[0])
    finally:
        conn.close()


def award_onboarding_grant(amount: float, wallet: str = "", orcid: str = "") -> bool:
    """Credit a one-time onboarding stake. Idempotent per identity."""
    keys = _account_keys(wallet, orcid)
    if not keys or has_received_grant(wallet, orcid):
        return False
    kind, account = keys[0]
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT INTO piq_ledger (account, account_kind, delta, reason, eval_hash) "
            "VALUES (?, ?, ?, ?, ?)",
            (account, kind, abs(float(amount)), "Verified-identity onboarding grant", ""),
        )
        conn.commit()
    finally:
        conn.close()
    return True


def charge_piq_fee(amount: float, wallet: str = "", orcid: str = "",
                   eval_hash: str = "", reason: str = "Manuscript processing fee") -> bool:
    """Debit a processing fee. Returns False (charging nothing) if the
    identity cannot cover it, so the caller can refuse the run."""
    keys = _account_keys(wallet, orcid)
    if not keys:
        return False
    if get_piq_balance(wallet, orcid)["balance"] + 1e-9 < amount:
        return False
    kind, account = keys[0]
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT INTO piq_ledger (account, account_kind, delta, reason, eval_hash) VALUES (?, ?, ?, ?, ?)",
            (account, kind, -abs(float(amount)), reason, eval_hash or ""),
        )
        conn.commit()
    finally:
        conn.close()
    return True


def refund_piq_fee(amount: float, wallet: str = "", orcid: str = "",
                   eval_hash: str = "", reason: str = "Processing fee refund") -> None:
    """Return a fee when the work it paid for could not be delivered."""
    keys = _account_keys(wallet, orcid)
    if not keys:
        return
    kind, account = keys[0]
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT INTO piq_ledger (account, account_kind, delta, reason, eval_hash) VALUES (?, ?, ?, ?, ?)",
            (account, kind, abs(float(amount)), reason, eval_hash or ""),
        )
        conn.commit()
    finally:
        conn.close()


def get_piq_fee_history(wallet: str = "", orcid: str = "", limit: int = 25) -> list:
    keys = _account_keys(wallet, orcid)
    if not keys:
        return []
    placeholders = ", ".join("?" for _ in keys)
    conn = get_db_connection()
    try:
        rows = conn.execute(
            f"""SELECT delta, reason, eval_hash, timestamp FROM piq_ledger
                WHERE LOWER(account) IN ({placeholders}) ORDER BY entry_id DESC LIMIT ?""",
            tuple(v for _, v in keys) + (limit,),
        ).fetchall()
    finally:
        conn.close()
    return [
        {"delta": r[0], "reason": r[1], "eval_hash": r[2], "timestamp": r[3]}
        for r in rows
    ]


def get_free_evals_used(ip_address: str) -> int:
    """Server-side free-trial counter, keyed by client IP. Authoritative —
    unlike the browser's localStorage counter, a user can't reset this by
    clearing site data."""
    if not ip_address:
        return 0
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT free_evals_used FROM auto_ip_tracking WHERE ip_address = ?", (ip_address,)
        ).fetchone()
        return int(row[0]) if row and row[0] is not None else 0
    finally:
        conn.close()


def get_papers_for_recommendation(fields: list = None, limit: int = 200,
                                  hashes: list = None) -> list:
    """Assessed papers with their per-criterion scores, for Scilem's picks.

    Returns the whole criteria vector rather than just the composite score,
    because a recommendation is only useful if it can say *why* — "strong
    empirical density, weak reproducibility" is actionable, "scored 71" is not.

    `hashes` restricts the set to specific assessments. This is what lets a
    researcher choose which of their papers the Research Buddy reasons from:
    a corpus-wide read is the right default, but someone working across two
    unrelated projects gets advice averaged over both unless they can say
    which one they mean. Filtered in SQL rather than after the fact, so the
    `limit` applies to the chosen papers instead of truncating them away.
    """
    picked = [h for h in (hashes or []) if h]
    conn = get_db_connection()
    try:
        if picked:
            ph = ",".join("?" for _ in picked)
            rows = conn.execute(
                f"""SELECT eval_hash, title, author_name, fields, final_score,
                           c1, c2, c3, c4, c5, c6, c7, c8, timestamp
                    FROM papers_assessment
                    WHERE final_score IS NOT NULL AND eval_hash IN ({ph})
                    ORDER BY timestamp DESC LIMIT ?""",
                (*picked, int(limit)),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT eval_hash, title, author_name, fields, final_score,
                          c1, c2, c3, c4, c5, c6, c7, c8, timestamp
                   FROM papers_assessment
                   WHERE final_score IS NOT NULL
                   ORDER BY timestamp DESC LIMIT ?""",
                (int(limit),),
            ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()

    import json as _json
    wanted = {f.strip().lower() for f in (fields or []) if f and f.strip()}
    out = []
    for r in rows:
        try:
            paper_fields = [f.strip() for f in _json.loads(r[3] or "[]") if f and f.strip()]
        except Exception:
            paper_fields = []
        if wanted and not any(f.lower() in wanted for f in paper_fields):
            continue
        try:
            score = float(r[4])
        except (TypeError, ValueError):
            continue
        criteria = {}
        for i in range(8):
            try:
                criteria[f"c{i + 1}"] = float(r[5 + i]) if r[5 + i] is not None else None
            except (TypeError, ValueError):
                criteria[f"c{i + 1}"] = None
        out.append({
            "eval_hash": r[0], "title": r[1] or "Untitled", "author_name": r[2] or "",
            "fields": paper_fields, "score": round(score, 1),
            "criteria": criteria, "timestamp": r[13],
        })
    return out


def save_researcher_profile(account_key: str, profile: dict) -> dict:
    """Stores the researcher's stated field, goal and abstract.

    Keyed by ORCID or wallet — an anonymous visitor has nowhere durable to put
    this, so the frontend keeps their draft in localStorage instead and only
    persists once an identity exists. Free-text is length-capped on the way in
    so a profile cannot be used as unbounded storage.
    """
    if not account_key:
        return {}
    fields = {
        "field": str(profile.get("field", ""))[:400],   # comma-joined list of fields
        "career_stage": str(profile.get("career_stage", ""))[:60],
        "goal": str(profile.get("goal", ""))[:600],
        # Newline-separated list of core ideas: up to 12 entries of 200 chars
        # plus separators is ~2411, so 1500 would have truncated the last few
        # mid-sentence with no warning.
        "idea": str(profile.get("idea", ""))[:3000],
        "abstract": str(profile.get("abstract", ""))[:4000],
    }
    conn = get_db_connection()
    try:
        conn.execute(
            """INSERT INTO researcher_profiles
                 (account_key, field, career_stage, goal, idea, abstract, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(account_key) DO UPDATE SET
                 field=excluded.field, career_stage=excluded.career_stage,
                 goal=excluded.goal, idea=excluded.idea, abstract=excluded.abstract,
                 updated_at=CURRENT_TIMESTAMP""",
            (account_key, fields["field"], fields["career_stage"],
             fields["goal"], fields["idea"], fields["abstract"]),
        )
        conn.commit()
    finally:
        conn.close()
    return fields


PROFILE_FIELDS = ("field", "career_stage", "goal", "idea", "abstract")
MAX_PROFILE_SLOTS = 8


def list_profile_slots(account_key: str) -> list:
    """Every named profile this account has saved, active one first."""
    if not account_key:
        return []
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT id, name, field, career_stage, goal, idea, abstract,
                      is_active, updated_at
               FROM researcher_profile_slots WHERE account_key = ?
               ORDER BY is_active DESC, updated_at DESC""", (account_key,)).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    return [{"id": r[0], "name": r[1], "field": r[2], "career_stage": r[3],
             "goal": r[4], "idea": r[5], "abstract": r[6],
             "active": bool(r[7]), "updated_at": r[8]} for r in rows]


def save_profile_slot(account_key: str, profile: dict, name: str = "",
                      slot_id: Optional[int] = None) -> dict:
    """Create or update one named profile, and make it the active one.

    Saving activates deliberately. Editing a profile is almost always a
    statement about what you are working on now, and leaving it saved-but-not-
    applied would mean the guidance on screen silently disagrees with the
    profile the user just wrote.
    """
    if not account_key:
        return {"ok": False, "reason": "Sign in to save a profile."}
    name = (name or "").strip()[:60] or "Untitled profile"
    values = {k: str(profile.get(k, "") or "")[:4000] for k in PROFILE_FIELDS}

    conn = get_db_connection()
    try:
        if slot_id is None:
            n = conn.execute(
                "SELECT COUNT(*) FROM researcher_profile_slots WHERE account_key = ?",
                (account_key,)).fetchone()[0]
            if n >= MAX_PROFILE_SLOTS:
                return {"ok": False, "reason": (
                    f"You can keep up to {MAX_PROFILE_SLOTS} profiles. Delete one first.")}
            cur = conn.execute(
                """INSERT INTO researcher_profile_slots
                     (account_key, name, field, career_stage, goal, idea, abstract, is_active)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
                (account_key, name, values["field"], values["career_stage"],
                 values["goal"], values["idea"], values["abstract"]))
            slot_id = cur.lastrowid
        else:
            cur = conn.execute(
                """UPDATE researcher_profile_slots
                   SET name = ?, field = ?, career_stage = ?, goal = ?, idea = ?,
                       abstract = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
                   WHERE id = ? AND account_key = ?""",
                (name, values["field"], values["career_stage"], values["goal"],
                 values["idea"], values["abstract"], int(slot_id), account_key))
            if not cur.rowcount:
                return {"ok": False, "reason": "That profile was not found under your account."}
        # Exactly one active slot, always.
        conn.execute(
            "UPDATE researcher_profile_slots SET is_active = 0 "
            "WHERE account_key = ? AND id <> ?", (account_key, int(slot_id)))
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        logging.warning("Could not save profile slot: %s", e)
        return {"ok": False, "reason": "The profile could not be saved."}
    finally:
        conn.close()

    # Mirror into the single-profile table every existing reader consults.
    save_researcher_profile(account_key, values)
    return {"ok": True, "reason": "", "id": int(slot_id), "name": name}


def activate_profile_slot(account_key: str, slot_id: int) -> dict:
    """Switch which profile the diagnostics and Research Buddy read."""
    if not account_key:
        return {"ok": False, "reason": "Sign in to switch profiles."}
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT field, career_stage, goal, idea, abstract, name
               FROM researcher_profile_slots WHERE id = ? AND account_key = ?""",
            (int(slot_id), account_key)).fetchone()
        if not row:
            return {"ok": False, "reason": "That profile was not found under your account."}
        conn.execute("UPDATE researcher_profile_slots SET is_active = 0 WHERE account_key = ?",
                     (account_key,))
        conn.execute("UPDATE researcher_profile_slots SET is_active = 1 WHERE id = ?",
                     (int(slot_id),))
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        logging.warning("Could not activate profile slot: %s", e)
        return {"ok": False, "reason": "The profile could not be switched."}
    finally:
        conn.close()

    values = dict(zip(PROFILE_FIELDS, row[:5]))
    save_researcher_profile(account_key, values)
    return {"ok": True, "reason": "", "name": row[5], "profile": values}


def delete_profile_slot(account_key: str, slot_id: int) -> dict:
    """Remove one named profile. The last remaining one may still be deleted.

    If the active profile goes, the most recently updated survivor takes over
    rather than leaving the account with profiles but none of them applied —
    a state where the interface would show a list and the diagnostics would
    behave as though it were empty.
    """
    if not account_key:
        return {"ok": False, "reason": "Sign in to delete a profile."}
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT is_active FROM researcher_profile_slots WHERE id = ? AND account_key = ?",
            (int(slot_id), account_key)).fetchone()
        if not row:
            return {"ok": False, "reason": "That profile was not found under your account."}
        was_active = bool(row[0])
        conn.execute("DELETE FROM researcher_profile_slots WHERE id = ? AND account_key = ?",
                     (int(slot_id), account_key))
        nxt = None
        if was_active:
            nxt = conn.execute(
                "SELECT id FROM researcher_profile_slots WHERE account_key = ? "
                "ORDER BY updated_at DESC LIMIT 1", (account_key,)).fetchone()
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        logging.warning("Could not delete profile slot: %s", e)
        return {"ok": False, "reason": "The profile could not be deleted."}
    finally:
        conn.close()

    if was_active:
        if nxt:
            activate_profile_slot(account_key, nxt[0])
        else:
            delete_researcher_profile(account_key)   # none left; clear the mirror
    return {"ok": True, "reason": ""}


def get_researcher_profile(account_key: str) -> dict:
    """The stored profile for an identity, or an empty dict."""
    if not account_key:
        return {}
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT field, career_stage, goal, idea, abstract, updated_at
               FROM researcher_profiles WHERE account_key = ?""",
            (account_key,),
        ).fetchone()
    except sqlite3.Error:
        return {}
    finally:
        conn.close()
    if not row:
        return {}
    return {"field": row[0] or "", "career_stage": row[1] or "", "goal": row[2] or "",
            "idea": row[3] or "", "abstract": row[4] or "", "updated_at": row[5]}


def get_field_corpus_stats(limit: int = 20) -> list:
    """Per-field aggregates over the assessed corpus, for the Science Map.

    Returns ``[{"field", "papers", "avg_score"}]`` ordered by paper count. This
    is what makes the map reflect the operator's *actual* corpus rather than a
    fixed decorative taxonomy — a field nobody has published in stays small,
    and one with fifty assessed papers dominates the map.

    Returns an empty list on a fresh database, which callers must handle: the
    map has to be usable before a single paper exists.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT fields, final_score, author_name, subfields FROM papers_assessment"
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()

    # Top-level domain per field, so the map can group and colour by domain
    # rather than showing a flat list of field names with no hierarchy. The
    # mapping is the same OpenAlex ontology the classifier assigns from, so a
    # field can never be placed in a domain the classifier would not have.
    try:
        from scientometrics import FIELD_TO_DOMAIN
    except Exception:
        FIELD_TO_DOMAIN = {}

    import json as _json
    exclude = {"unclassified", "unspecified", "none", ""}
    agg = {}
    for fields_json, score, author_name, subfields_json in rows:
        try:
            names = [f.strip() for f in _json.loads(fields_json or "[]") if f and f.strip()]
        except Exception:
            continue
        try:
            subs = [x.strip() for x in _json.loads(subfields_json or "[]") if x and x.strip()]
        except Exception:
            subs = []
        try:
            score_val = float(score) if score is not None else 50.0
        except (TypeError, ValueError):
            score_val = 50.0
        for name in names:
            if name.lower() in exclude:
                continue
            entry = agg.setdefault(name, {"papers": 0, "score_sum": 0.0,
                                          "authors": set(), "subfields": set()})
            entry["papers"] += 1
            entry["score_sum"] += score_val
            for sub in subs:
                if sub.lower() not in exclude and sub != name:
                    entry["subfields"].add(sub)
            # Authors per field power the map's author filter. Stored as a set
            # so one prolific author doesn't appear once per paper, and capped
            # on the way out so a large corpus can't bloat the response.
            if author_name:
                for part in str(author_name).replace(" and ", ",").split(","):
                    cleaned = part.strip()
                    if len(cleaned) > 2:
                        entry["authors"].add(cleaned)

    ranked = sorted(agg.items(), key=lambda kv: kv[1]["papers"], reverse=True)[:limit]
    return [
        {"field": name,
         # "Unassigned" rather than guessing: a field the ontology does not
         # know is a classifier result worth seeing, not one to bucket blindly.
         "domain": FIELD_TO_DOMAIN.get(name, "Unassigned"),
         "papers": v["papers"],
         "avg_score": round(v["score_sum"] / v["papers"], 1) if v["papers"] else 0.0,
         "subfields": sorted(v["subfields"])[:12],
         "authors": sorted(v["authors"])[:40]}
        for name, v in ranked
    ]


def get_corpus_totals() -> dict:
    """Distinct paper counts for the corpus.

    Separate from ``get_field_corpus_stats`` because the two answer different
    questions and conflating them produced a visible lie: a paper tagged with
    three fields contributes to three per-field rows, so summing those rows
    reported more papers than exist. Paper counts must come from counting
    papers.

    Also counts papers whose classification failed. Those are excluded from the
    field map (they belong to no field), and silently dropping them meant a
    corpus of unclassified papers rendered as "no papers assessed yet" — which
    is exactly what happens when the juror panel is unavailable and
    classification degrades, i.e. precisely when the operator most needs to see
    that their papers did land.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT fields FROM papers_assessment").fetchall()
    except sqlite3.Error:
        return {"papers": 0, "classified": 0, "unclassified": 0}
    finally:
        conn.close()

    import json as _json
    exclude = {"unclassified", "unspecified", "none", ""}
    total = classified = 0
    for (fields_json,) in rows:
        total += 1
        try:
            names = [f.strip() for f in _json.loads(fields_json or "[]") if f and f.strip()]
        except Exception:
            names = []
        if any(n.lower() not in exclude for n in names):
            classified += 1
    return {"papers": total, "classified": classified,
            "unclassified": total - classified}


def get_bonus_evals(ip_address: str) -> int:
    """Extra allowance this IP has earned from the Science Map arcade."""
    if not ip_address:
        return 0
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT bonus_evals FROM auto_ip_tracking WHERE ip_address = ?", (ip_address,)
        ).fetchone()
        return int(row[0]) if row and row[0] is not None else 0
    finally:
        conn.close()


def get_bonus_award_state(ip_address: str) -> dict:
    """Current bonus balance plus when it was last topped up.

    The timestamp is what enforces the cooldown between arcade rewards, so it
    has to live in the database rather than in process memory — otherwise a
    restart, or a second gunicorn worker, would hand out a fresh reward.
    """
    if not ip_address:
        return {"bonus": 0, "last_award": None}
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT bonus_evals, bonus_last_award FROM auto_ip_tracking WHERE ip_address = ?",
            (ip_address,),
        ).fetchone()
        if not row:
            return {"bonus": 0, "last_award": None}
        return {"bonus": int(row[0] or 0), "last_award": row[1]}
    finally:
        conn.close()


def grant_bonus_evals(ip_address: str, amount: int, cap: int) -> dict:
    """Adds arcade winnings to this IP's allowance, never exceeding ``cap``.

    Returns the granted amount (which may be less than requested, or zero) and
    the resulting balance. The cap is applied inside the same transaction that
    performs the update so two concurrent requests cannot both read a
    below-cap value and each add to it.
    """
    if not ip_address or amount <= 0:
        return {"granted": 0, "bonus": get_bonus_evals(ip_address)}
    conn = get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """INSERT INTO auto_ip_tracking (ip_address, first_seen, bonus_evals)
               VALUES (?, CURRENT_TIMESTAMP, 0)
               ON CONFLICT(ip_address) DO NOTHING""",
            (ip_address,),
        )
        row = conn.execute(
            "SELECT bonus_evals FROM auto_ip_tracking WHERE ip_address = ?", (ip_address,)
        ).fetchone()
        current = int(row[0] or 0) if row else 0
        granted = max(0, min(amount, cap - current))
        if granted:
            conn.execute(
                """UPDATE auto_ip_tracking
                   SET bonus_evals = ?, bonus_last_award = CURRENT_TIMESTAMP
                   WHERE ip_address = ?""",
                (current + granted, ip_address),
            )
        conn.commit()
        return {"granted": granted, "bonus": current + granted}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def increment_free_evals_used(ip_address: str) -> int:
    """Records one free-trial usage for this IP and returns the new count."""
    if not ip_address:
        return 0
    conn = get_db_connection()
    try:
        conn.execute(
            """INSERT INTO auto_ip_tracking (ip_address, first_seen, free_evals_used)
               VALUES (?, CURRENT_TIMESTAMP, 1)
               ON CONFLICT(ip_address) DO UPDATE SET free_evals_used = free_evals_used + 1""",
            (ip_address,),
        )
        conn.commit()
        row = conn.execute(
            "SELECT free_evals_used FROM auto_ip_tracking WHERE ip_address = ?", (ip_address,)
        ).fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Bug reports
# ---------------------------------------------------------------------------
# What a contact message can be. Published so the form, the store and the
# operator queue cannot disagree about the vocabulary.
CONTACT_KINDS = {
    "bug": "Something is broken",
    "suggestion": "An idea or suggestion",
}


def store_bug_report(report: dict, ip_hash: str = "") -> int:
    """Persist a report and return its id.

    Called before the mail attempt, so the id can be quoted back to the user
    as proof of receipt regardless of whether delivery later succeeds.
    """
    conn = get_db_connection()
    try:
        kind = report.get("kind") if report.get("kind") in CONTACT_KINDS else "bug"
        cur = conn.execute(
            """INSERT INTO bug_reports
                 (message, contact, identity, page, user_agent, ip_hash, created_at, kind)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (report.get("message", ""), report.get("contact", ""),
             report.get("identity", ""), report.get("page", ""),
             report.get("user_agent", ""), ip_hash,
             report.get("created_at") or datetime.now().isoformat(timespec="seconds"),
             kind),
        )
        conn.commit()
        return int(cur.lastrowid)
    finally:
        conn.close()


def mark_bug_report_delivered(report_id: int, delivered: bool, error: str = ""):
    if not report_id:
        return
    conn = get_db_connection()
    try:
        conn.execute(
            "UPDATE bug_reports SET delivered = ?, delivery_error = ? WHERE id = ?",
            (1 if delivered else 0, (error or "")[:300], report_id),
        )
        conn.commit()
    except sqlite3.Error as e:
        logging.warning("Could not record bug report delivery state: %s", e)
    finally:
        conn.close()


# What an operator can wipe, and what each choice actually destroys.
#
# Grouped by MEANING rather than by table, because an operator reasons about
# "the corpus" and "balances", not about `papers_assessment` and `piq_ledger`.
# Each group is independently selectable: wiping test papers without
# destroying the ledger, or clearing balances while keeping the corpus, are
# both legitimate and were impossible with the all-or-nothing script.
#
# `order` matters — groups are wiped in this sequence so that a partial
# failure never leaves a dangling reference (reviews before papers, and so on).
RESET_GROUPS = {
    "assessments": {
        "label": "Assessed papers",
        "detail": ("Every manuscript, its scores, its dossier and its stored file. "
                   "This is the corpus itself."),
        "tables": ["papers_assessment", "paper_reads"],
        "order": 20,
        "destroys": "the corpus",
    },
    "reviews": {
        "label": "Reviews and review activity",
        "detail": ("Peer and machine reviews, open review requests, replies, ratings and "
                   "moderation reports."),
        "tables": ["peer_reviews", "review_rebuttals", "review_ratings",
                   "review_reports", "review_jobs"],
        "order": 10,
        "destroys": "all review history",
    },
    "ledger": {
        "label": "piQ balances",
        "detail": ("The whole piQ ledger — every balance anyone has earned, spent or had "
                   "held. Papers keep their recorded piQ figures unless you also wipe them."),
        "tables": ["piq_ledger"],
        "order": 30,
        "destroys": "all balances",
    },
    "chain": {
        "label": "Proof-of-Research blocks",
        "detail": ("The local block records. The chain is append-only by design, so this is "
                   "a local wipe, not a rewrite of anything already settled on-chain."),
        "tables": ["blockchain_por_weights", "desci_attestations"],
        "order": 40,
        "destroys": "the local ledger blocks",
    },
    "profiles": {
        "label": "Researcher profiles",
        "detail": "Saved profiles and the Research Buddy inputs derived from them.",
        "tables": ["researcher_profiles"],
        "order": 50,
        "destroys": "saved profiles",
    },
    "trials": {
        "label": "Free-trial and arcade state",
        "detail": "Per-IP free assessment counters, arcade progress and win records.",
        "tables": ["auto_ip_tracking", "arcade_progress", "arcade_runs", "ingestion_queue"],
        "order": 60,
        "destroys": "trial counters",
    },
    "bugs": {
        "label": "Bug reports",
        "detail": "Reports submitted through Report a bug, including undelivered ones.",
        "tables": ["bug_reports"],
        "order": 70,
        "destroys": "bug reports",
    },
    "visits": {
        "label": "Visitor counts",
        "detail": "The unique-visitor tally shown in Analytics.",
        "tables": ["site_visits"],
        "order": 80,
        "destroys": "visitor statistics",
    },
}


def reset_state_groups(groups) -> dict:
    """Empty the tables behind the named reset groups.

    Returns a per-table row count of what was actually deleted, so the caller
    can report the real outcome rather than an assumed one. A table that does
    not exist in this schema version is skipped rather than failing the whole
    reset — schema drift must not make the wipe unusable.

    Everything runs in ONE transaction. A reset that half-completes is worse
    than one that fails: it leaves reviews pointing at papers that no longer
    exist, and no operator would know which half had gone.
    """
    chosen = [g for g in (groups or []) if g in RESET_GROUPS]
    if not chosen:
        return {"ok": False, "reason": "No valid reset groups were named.", "deleted": {}}

    chosen.sort(key=lambda g: RESET_GROUPS[g]["order"])
    deleted, skipped = {}, []
    conn = get_db_connection()
    try:
        conn.execute("BEGIN")
        for group in chosen:
            for table in RESET_GROUPS[group]["tables"]:
                try:
                    n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                    conn.execute(f"DELETE FROM {table}")
                    deleted[table] = int(n or 0)
                except sqlite3.Error:
                    skipped.append(table)      # not present in this schema version
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        logging.error("Reset failed and was rolled back: %s", e)
        return {"ok": False, "reason": f"The reset failed and nothing was deleted ({e}).",
                "deleted": {}}
    finally:
        conn.close()

    # Reclaim the space and reset AUTOINCREMENT counters, so a wiped
    # deployment really does start from 1 rather than from wherever it stopped.
    try:
        conn = get_db_connection()
        try:
            conn.execute("DELETE FROM sqlite_sequence")
        except sqlite3.Error:
            pass                                # no AUTOINCREMENT tables yet
        conn.commit()
        conn.close()
        conn = get_db_connection()
        conn.isolation_level = None
        conn.execute("VACUUM")
        conn.close()
    except sqlite3.Error as e:
        logging.warning("Post-reset VACUUM failed (data is still deleted): %s", e)

    logging.warning("STATE RESET performed on groups: %s", ", ".join(chosen))
    return {"ok": True, "reason": "", "deleted": deleted, "skipped": skipped,
            "groups": chosen}


def list_bug_reports(limit: int = 100) -> list:
    """Owner-only view. Undelivered reports first — those are the ones that
    exist nowhere else."""
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT id, message, contact, identity, page, created_at, delivered,
                      delivery_error, COALESCE(kind, 'bug')
               FROM bug_reports ORDER BY delivered ASC, id DESC LIMIT ?""",
            (int(limit),),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    return [{"id": r[0], "message": r[1], "contact": r[2], "identity": r[3],
             "page": r[4], "created_at": r[5], "delivered": bool(r[6]),
             "delivery_error": r[7], "kind": r[8] or "bug"} for r in rows]


def delete_researcher_profile(account_key: str) -> bool:
    """Remove a stored profile entirely.

    A reset must actually delete the row rather than blanking its columns:
    an empty-but-present profile still frames the diagnostic summary and still
    feeds the research buddy, so "reset" that left a row behind would keep
    influencing results the user believed they had cleared.
    """
    if not account_key:
        return False
    conn = get_db_connection()
    try:
        cur = conn.execute("DELETE FROM researcher_profiles WHERE account_key = ?", (account_key,))
        conn.commit()
        return cur.rowcount > 0
    except sqlite3.Error as e:
        logging.warning("Profile reset failed: %s", e)
        return False
    finally:
        conn.close()


def list_assessments_for_identity(identities, limit: int = 100) -> list:
    """Every assessment submitted under one identity, newest first.

    `identities` is the LIST of forms an identity can take in the database,
    not a single key. This matters because the assessment pipeline stores
    `user_id` as the raw ORCID or wallet address, while profiles, arcade
    progress and bug reports are keyed by a namespaced "orcid:..." string.
    Querying with only the namespaced key compared "orcid:0000-0002-..."
    against a stored "0000-0002-..." and matched nothing, so history was
    always empty for every user who had one — and the identical mismatch in
    delete_assessment meant paper removal silently found nothing to remove.

    Rather than rewrite historical rows, both forms are accepted.
    """
    values = [v for v in (identities if isinstance(identities, (list, tuple, set))
                          else [identities]) if v]
    if not values:
        return []
    placeholders = ",".join("?" for _ in values)
    conn = get_db_connection()
    try:
        rows = conn.execute(
            f"""SELECT eval_hash, title, author_name, final_score, fields, timestamp,
                      piq_minted, doi, filename, published_at, piq_escrowed, piq_claimed_at,
                      (SELECT COUNT(*) FROM peer_reviews r
                        WHERE r.eval_hash = papers_assessment.eval_hash
                          AND r.completed_at IS NOT NULL
                          AND r.reviewer_key = 'llm:panel') AS llm_count,
                      (SELECT COUNT(*) FROM peer_reviews r
                        WHERE r.eval_hash = papers_assessment.eval_hash
                          AND r.completed_at IS NOT NULL
                          AND r.reviewer_key <> 'llm:panel') AS peer_count
               FROM papers_assessment
               WHERE user_id IN ({placeholders})
                  OR author_openalex_id IN ({placeholders})
               ORDER BY timestamp DESC LIMIT ?""",
            (*values, *values, int(limit)),
        ).fetchall()
    except sqlite3.Error as e:
        logging.warning("Assessment history query failed: %s", e)
        return []
    finally:
        conn.close()
    out = []
    for r in rows:
        try:
            fields = json.loads(r[4]) if r[4] else []
        except (ValueError, TypeError):
            fields = []
        out.append({"hash": r[0], "title": r[1] or "Untitled", "author": r[2] or "",
                    "score": round(float(r[3] or 0), 1), "fields": fields,
                    "timestamp": r[5], "piq_minted": float(r[6] or 0),
                    "doi": r[7] or "", "filename": r[8] or "",
                    "published": bool(r[9]),
                    "escrowed": round(float(r[10] or 0), 4),
                    "claimed": bool(r[11]),
                    # Carried here so a history row can show the review badge and
                    # offer "Request a new review" without a second round trip
                    # per row.
                    "llm_reviewed": bool(r[12]),
                    "llm_review_count": int(r[12] or 0),
                    "peer_reviews": int(r[13] or 0)})
    return out


def delete_assessment(file_hash: str, identities=None, allow_any: bool = False) -> dict:
    """Remove one assessed paper.

    Ownership is checked in SQL rather than in Python so there is no window
    between the check and the delete. Without `allow_any` (owner wallet only),
    a user can delete only rows submitted under their own identity — otherwise
    knowing a hash, which appears in the public leaderboard, would be enough
    to delete someone else's assessment.

    The Proof-of-Research block is deliberately NOT removed. The chain is
    append-only and each block hashes its predecessor; deleting a block would
    invalidate every block after it and destroy the ledger's integrity claim.
    Removing the paper from the corpus and leaving its block standing is the
    honest outcome — the assessment happened, and the ledger records that it
    happened, even after the user withdraws the paper from the listings.
    """
    if not file_hash:
        return {"deleted": False, "reason": "No paper specified."}
    conn = get_db_connection()
    try:
        if allow_any:
            cur = conn.execute("DELETE FROM papers_assessment WHERE eval_hash = ?", (file_hash,))
        else:
            values = [v for v in (identities or []) if v]
            if not values:
                return {"deleted": False, "reason": "Sign in to remove a paper."}
            ph = ",".join("?" for _ in values)
            cur = conn.execute(
                f"""DELETE FROM papers_assessment
                   WHERE eval_hash = ?
                     AND (user_id IN ({ph}) OR author_openalex_id IN ({ph}))""",
                (file_hash, *values, *values),
            )
        conn.commit()
        if cur.rowcount:
            return {"deleted": True, "reason": ""}
        return {"deleted": False,
                "reason": "That paper was not found under your identity."}
    except sqlite3.Error as e:
        logging.warning("Assessment delete failed: %s", e)
        return {"deleted": False, "reason": "The paper could not be removed."}
    finally:
        conn.close()


def record_backup_cid(cid: str, tx_hash: str = "") -> None:
    """Record a successful pin. Never raises into the backup thread."""
    if not cid:
        return
    conn = get_db_connection()
    try:
        conn.execute("INSERT INTO backup_history (cid, tx_hash) VALUES (?, ?)",
                     (cid, tx_hash or ""))
        conn.commit()
    except sqlite3.Error as e:
        logging.warning("Could not record backup CID: %s", e)
    finally:
        conn.close()


def latest_backups(limit: int = 10) -> list:
    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT cid, tx_hash, created_at FROM backup_history ORDER BY id DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    return [{"cid": r[0], "tx_hash": r[1], "anchored": bool(r[1]), "created_at": r[2]}
            for r in rows]


# ---------------------------------------------------------------------------
# Arcade progress
# ---------------------------------------------------------------------------
def get_arcade_progress(account_key: str) -> dict:
    """Difficulty level and record for one player."""
    if not account_key:
        return {"difficulty_level": 0, "wins": 0, "runs": 0, "best_mass": 0.0}
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT difficulty_level, wins, runs, best_mass, last_run_at
               FROM arcade_progress WHERE account_key = ?""",
            (account_key,),
        ).fetchone()
    except sqlite3.Error:
        return {"difficulty_level": 0, "wins": 0, "runs": 0, "best_mass": 0.0}
    finally:
        conn.close()
    if not row:
        return {"difficulty_level": 0, "wins": 0, "runs": 0, "best_mass": 0.0}
    return {"difficulty_level": int(row[0] or 0), "wins": int(row[1] or 0),
            "runs": int(row[2] or 0), "best_mass": float(row[3] or 0.0),
            "last_run_at": row[4]}


def record_arcade_run(account_key: str, won: bool, final_mass: float,
                      is_identity: bool = False, display_name: str = "",
                      max_level: int = 12) -> dict:
    """Record one run; a win raises the difficulty for the next.

    best_mass uses MAX rather than assignment, so a later weaker run cannot
    erase a personal best — a leaderboard that goes down when you play again
    is not a leaderboard.
    """
    if not account_key:
        return {"difficulty_level": 0, "wins": 0}
    conn = get_db_connection()
    try:
        conn.execute(
            """INSERT INTO arcade_progress
                 (account_key, is_identity, difficulty_level, wins, runs, best_mass,
                  display_name, last_run_at, updated_at)
               VALUES (?, ?, 0, 0, 0, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT(account_key) DO NOTHING""",
            (account_key, 1 if is_identity else 0, display_name[:120]),
        )
        conn.execute(
            """UPDATE arcade_progress
                 SET runs = runs + 1,
                     wins = wins + ?,
                     difficulty_level = MIN(difficulty_level + ?, ?),
                     best_mass = MAX(best_mass, ?),
                     is_identity = ?,
                     display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END,
                     last_run_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
               WHERE account_key = ?""",
            (1 if won else 0, 1 if won else 0, int(max_level), float(final_mass or 0.0),
             1 if is_identity else 0, display_name[:120], display_name[:120], account_key),
        )
        conn.commit()
    except sqlite3.Error as e:
        logging.warning("Could not record arcade run: %s", e)
    finally:
        conn.close()
    return get_arcade_progress(account_key)


def reset_arcade_difficulty(account_key: str) -> bool:
    """Assessing a manuscript resets the ramp.

    This is the exchange the ramp exists to create: the arcade hands out
    assessment allowance, so the way to make it winnable again is to do the
    thing the allowance is for.
    """
    if not account_key:
        return False
    conn = get_db_connection()
    try:
        cur = conn.execute(
            """UPDATE arcade_progress SET difficulty_level = 0, updated_at = CURRENT_TIMESTAMP
               WHERE account_key = ? AND difficulty_level > 0""",
            (account_key,),
        )
        conn.commit()
        return cur.rowcount > 0
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def arcade_leaderboard(limit: int = 20) -> list:
    """Signed-in players only, ranked by personal best mass.

    Anonymous players are excluded because their key is an IP hash: it is not
    a person, it is shared by everyone behind a NAT, and it changes when they
    reconnect. Ranking it would be ranking noise.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT display_name, account_key, best_mass, wins, runs, difficulty_level
               FROM arcade_progress
               WHERE is_identity = 1 AND runs > 0
               ORDER BY best_mass DESC, wins DESC LIMIT ?""",
            (int(limit),),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    out = []
    for i, r in enumerate(rows):
        key = r[1] or ""
        # Never expose a full wallet or ORCID on a public board.
        label = r[0] or (f"{key[:6]}…{key[-4:]}" if len(key) > 12 else "Researcher")
        out.append({"rank": i + 1, "player": label,
                    "best_mass": round(float(r[2] or 0), 1), "wins": int(r[3] or 0),
                    "runs": int(r[4] or 0), "difficulty_level": int(r[5] or 0)})
    return out


# ---------------------------------------------------------------------------
# Scilem learned state
# ---------------------------------------------------------------------------
def get_scilem_state() -> dict:
    conn = get_db_connection()
    try:
        row = conn.execute("SELECT state_json FROM scilem_state WHERE id = 1").fetchone()
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    if not row or not row[0]:
        return None
    try:
        return json.loads(row[0])
    except (ValueError, TypeError):
        # Corrupt state falls back to the authored defaults rather than
        # propagating a parse error into every assessment.
        logging.warning("Scilem state is corrupt; falling back to defaults.")
        return None


def save_scilem_state(state: dict) -> None:
    conn = get_db_connection()
    try:
        conn.execute(
            """INSERT INTO scilem_state (id, state_json, updated_at)
               VALUES (1, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(id) DO UPDATE SET
                 state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP""",
            (json.dumps(state),),
        )
        conn.commit()
    except sqlite3.Error as e:
        logging.warning("Could not save Scilem state: %s", e)
    finally:
        conn.close()


def record_scilem_observation(signals: dict, predicted: float, target: float,
                              source: str, eval_hash: str = "") -> None:
    conn = get_db_connection()
    try:
        conn.execute(
            """INSERT INTO scilem_observations
                 (eval_hash, signals_json, predicted, target, source)
               VALUES (?, ?, ?, ?, ?)""",
            (eval_hash or "", json.dumps(signals), float(predicted), float(target), source),
        )
        conn.commit()
    except sqlite3.Error as e:
        logging.debug("Could not record Scilem observation: %s", e)
    finally:
        conn.close()


def list_scilem_observations(limit: int = 50) -> list:
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT eval_hash, signals_json, predicted, target, source, created_at
               FROM scilem_observations ORDER BY id DESC LIMIT ?""",
            (int(limit),),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    out = []
    for r in rows:
        try:
            signals = json.loads(r[1] or "{}")
        except (ValueError, TypeError):
            signals = {}
        out.append({"eval_hash": r[0], "signals": signals,
                    "predicted": r[2], "target": r[3],
                    "error": round(abs((r[3] or 0) - (r[2] or 0)), 5),
                    "source": r[4], "created_at": r[5]})
    return out


def clear_scilem_observations() -> None:
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM scilem_observations")
        conn.commit()
    except sqlite3.Error as e:
        logging.warning("Could not clear Scilem observations: %s", e)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Curation rewards
# ---------------------------------------------------------------------------
CURATION_REASON_PREFIX = "Curation reward"


def get_curation_stats(wallet: str = "", orcid: str = "") -> dict:
    """How much this identity has earned curating, and over how many papers.

    Read from the piQ ledger rather than a counter column, so the number is
    always the sum of entries that actually exist. A separate counter could
    drift from the ledger, and the ledger is what the balance is computed
    from — the cap must be enforced against the same source of truth the
    money comes out of.
    """
    keys = _account_keys(wallet, orcid)
    if not keys:
        return {"count": 0, "earned": 0.0}
    accounts = [a for _, a in keys]
    placeholders = ",".join("?" for _ in accounts)
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"""SELECT COUNT(*), COALESCE(SUM(delta), 0)
                FROM piq_ledger
                WHERE account IN ({placeholders}) AND reason LIKE ?""",
            (*accounts, CURATION_REASON_PREFIX + "%"),
        ).fetchone()
    except sqlite3.Error:
        return {"count": 0, "earned": 0.0}
    finally:
        conn.close()
    return {"count": int(row[0] or 0), "earned": round(float(row[1] or 0.0), 4)}


def get_curation_award_for(wallet: str = "", orcid: str = "", eval_hash: str = "") -> float:
    """What this identity has already been paid for curating this paper.

    Exists so a refused credit can be explained correctly. "Already rewarded"
    and "the write failed" are different facts, and reporting the second as the
    first tells the user they did something wrong when the platform did.
    """
    keys = _account_keys(wallet, orcid)
    if not keys or not eval_hash:
        return 0.0
    accounts = [a for _, a in keys]
    ph = ",".join("?" for _ in accounts)
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"""SELECT COALESCE(SUM(delta), 0) FROM piq_ledger
                WHERE account IN ({ph}) AND eval_hash = ? AND reason LIKE ?""",
            (*accounts, eval_hash, CURATION_REASON_PREFIX + "%")).fetchone()
        return round(float(row[0] or 0.0), 4)
    except sqlite3.Error:
        return 0.0
    finally:
        conn.close()


def credit_curation_reward(amount: float, wallet: str = "", orcid: str = "",
                           eval_hash: str = "", note: str = "") -> bool:
    """Credit a curation reward. One award per identity per paper.

    The uniqueness check is what stops the obvious exploit: resubmitting the
    same manuscript to collect the reward repeatedly. Assessment itself is
    deliberately free on a resubmission, so without this the same paper would
    be an unlimited faucet at no cost.
    """
    amount = round(float(amount or 0.0), 4)
    if amount <= 0:
        return False
    keys = _account_keys(wallet, orcid)
    if not keys:
        return False
    kind, account = keys[0]
    accounts = [a for _, a in keys]
    placeholders = ",".join("?" for _ in accounts)

    conn = get_db_connection()
    try:
        if eval_hash:
            already = conn.execute(
                f"""SELECT 1 FROM piq_ledger
                    WHERE account IN ({placeholders}) AND eval_hash = ? AND reason LIKE ?
                    LIMIT 1""",
                (*accounts, eval_hash, CURATION_REASON_PREFIX + "%"),
            ).fetchone()
            if already:
                return False
        conn.execute(
            "INSERT INTO piq_ledger (account, account_kind, delta, reason, eval_hash) "
            "VALUES (?, ?, ?, ?, ?)",
            (account, kind, amount,
             f"{CURATION_REASON_PREFIX}{(' — ' + note[:120]) if note else ''}", eval_hash or ""),
        )
        conn.commit()
        return True
    except sqlite3.Error as e:
        logging.warning("Curation reward could not be credited: %s", e)
        return False
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Escrowed piQ
# ---------------------------------------------------------------------------
def list_escrowed_for_identity(identities, limit: int = 100) -> list:
    """Papers this identity submitted that earned piQ but could not claim it."""
    values = [v for v in (identities or []) if v]
    if not values:
        return []
    ph = ",".join("?" for _ in values)
    conn = get_db_connection()
    try:
        rows = conn.execute(
            f"""SELECT eval_hash, title, author_name, final_score, piq_escrowed, doi, timestamp
                FROM papers_assessment
                WHERE piq_escrowed > 0 AND piq_claimed_at IS NULL
                  AND (user_id IN ({ph}) OR author_openalex_id IN ({ph}))
                ORDER BY timestamp DESC LIMIT ?""",
            (*values, *values, int(limit)),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    return [{"hash": r[0], "title": r[1] or "Untitled", "author": r[2] or "",
             "score": round(float(r[3] or 0), 1), "escrowed": round(float(r[4] or 0), 4),
             "doi": r[5] or "", "timestamp": r[6]} for r in rows]


def total_escrowed() -> float:
    """Corpus-wide piQ earned but unclaimed. Reported in analytics."""
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT COALESCE(SUM(piq_escrowed), 0) FROM papers_assessment "
            "WHERE piq_claimed_at IS NULL").fetchone()
        return round(float(row[0] or 0.0), 4)
    except sqlite3.Error:
        return 0.0
    finally:
        conn.close()


def release_escrow(eval_hash: str, identities, wallet: str = "", orcid: str = "") -> dict:
    """Move an escrowed amount into the claimant's balance. Idempotent.

    The claim is marked and the ledger credited inside one transaction. If the
    two could drift, a retried claim would either pay twice or mark a payment
    that never happened — and this is the one place in the system where a
    double-write creates money.
    """
    values = [v for v in (identities or []) if v]
    if not eval_hash or not values:
        return {"released": 0.0, "reason": "No claim to release."}
    keys = _account_keys(wallet, orcid)
    if not keys:
        return {"released": 0.0, "reason": "No identity to credit."}
    kind, account = keys[0]
    ph = ",".join("?" for _ in values)

    conn = get_db_connection()
    try:
        row = conn.execute(
            f"""SELECT piq_escrowed FROM papers_assessment
                WHERE eval_hash = ? AND piq_claimed_at IS NULL
                  AND (user_id IN ({ph}) OR author_openalex_id IN ({ph}))""",
            (eval_hash, *values, *values),
        ).fetchone()
        if not row or not row[0]:
            return {"released": 0.0, "reason": "Nothing is held for this paper under your identity."}
        amount = round(float(row[0]), 4)

        conn.execute(
            "INSERT INTO piq_ledger (account, account_kind, delta, reason, eval_hash) "
            "VALUES (?, ?, ?, ?, ?)",
            (account, kind, amount, "Authorship verified — escrow released", eval_hash))
        conn.execute(
            "UPDATE papers_assessment SET piq_claimed_at = CURRENT_TIMESTAMP WHERE eval_hash = ?",
            (eval_hash,))
        conn.commit()
        return {"released": amount, "reason": ""}
    except sqlite3.Error as e:
        conn.rollback()
        logging.warning("Escrow release failed for %s: %s", eval_hash, e)
        return {"released": 0.0, "reason": "The claim could not be completed."}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Authorship challenges
# ---------------------------------------------------------------------------
def store_challenge(eval_hash: str, account_key: str, email_masked: str,
                    email_hash: str, code_hash: str) -> int:
    """Record a new challenge, superseding any earlier one for this pair.

    Superseding matters: without it, requesting a second code would leave the
    first still valid, so every resend would widen the window an attacker has
    to guess in rather than replacing it.
    """
    conn = get_db_connection()
    try:
        conn.execute(
            "DELETE FROM authorship_challenges WHERE eval_hash = ? AND account_key = ? "
            "AND verified_at IS NULL", (eval_hash, account_key))
        cur = conn.execute(
            """INSERT INTO authorship_challenges
                 (eval_hash, account_key, email_masked, email_hash, code_hash)
               VALUES (?, ?, ?, ?, ?)""",
            (eval_hash, account_key, email_masked, email_hash, code_hash))
        conn.commit()
        return int(cur.lastrowid)
    except sqlite3.Error as e:
        logging.warning("Could not store authorship challenge: %s", e)
        return 0
    finally:
        conn.close()


def get_challenge(eval_hash: str, account_key: str) -> dict:
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT id, email_masked, code_hash, attempts, created_at, verified_at
               FROM authorship_challenges
               WHERE eval_hash = ? AND account_key = ?
               ORDER BY id DESC LIMIT 1""", (eval_hash, account_key)).fetchone()
    except sqlite3.Error:
        return {}
    finally:
        conn.close()
    if not row:
        return {}
    return {"id": row[0], "email_masked": row[1], "code_hash": row[2],
            "attempts": int(row[3] or 0), "created_at": row[4], "verified_at": row[5]}


def record_challenge_attempt(challenge_id: int, verified: bool = False) -> None:
    conn = get_db_connection()
    try:
        if verified:
            conn.execute("UPDATE authorship_challenges SET verified_at = CURRENT_TIMESTAMP, "
                         "attempts = attempts + 1 WHERE id = ?", (challenge_id,))
        else:
            conn.execute("UPDATE authorship_challenges SET attempts = attempts + 1 "
                         "WHERE id = ?", (challenge_id,))
        conn.commit()
    except sqlite3.Error as e:
        logging.warning("Could not record challenge attempt: %s", e)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Author publishing
# ---------------------------------------------------------------------------
def set_published(eval_hash: str, identities, account_key: str, published: bool,
                  kind: str = "author", allow_unreviewed: bool = False) -> dict:
    """Attach or withdraw an author's public endorsement of an assessment.

    Ownership is enforced in the UPDATE rather than by a prior SELECT, for the
    same reason as deletion: evaluation hashes appear in the public leaderboard,
    so a check-then-write would let anyone who can read one publish under
    someone else's name.

    Withdrawal is always permitted. An endorsement a researcher cannot retract
    is not an endorsement, it is a trap — circumstances change, coauthors
    object, a preprint gets retracted.

    Publication requires a completed human review. The check lives here, at the
    write, and not only in the endpoint: this is the single function that can
    set published_at, so putting the rule anywhere else leaves a path around
    it. "Reviewed, then published" is only a rule if it is impossible to
    publish something unreviewed, not merely discouraged in the interface.
    """
    values = [v for v in (identities or []) if v]
    if not eval_hash or not values:
        return {"ok": False, "reason": "Sign in to publish an assessment."}
    # `allow_unreviewed` is the operator override. It exists because the review
    # rule is otherwise a closed loop on a new deployment: publishing needs a
    # review, reviewing needs a peer, and the first participant has none. The
    # override lets the operator publish their own work — and deliberately does
    # NOT fabricate a review to do it, so the paper carries an Author-published
    # badge and no Peer-reviewed badge. The gap is visible to every reader,
    # which is the honest way to bootstrap: the paper is published, and nobody
    # is told it was reviewed when it was not.
    if published and not allow_unreviewed and not has_human_review(eval_hash):
        return {"ok": False, "reason": (
            "This paper has not been peer reviewed yet. A paper must be reviewed before it can "
            "be published — request a review from the dossier, and publish once a reviewer has "
            "submitted their report.")}
    ph = ",".join("?" for _ in values)
    conn = get_db_connection()
    try:
        if published:
            cur = conn.execute(
                f"""UPDATE papers_assessment
                    SET published_at = CURRENT_TIMESTAMP, published_by = ?, publish_kind = ?
                    WHERE eval_hash = ? AND (user_id IN ({ph}) OR author_openalex_id IN ({ph}))""",
                (account_key, kind, eval_hash, *values, *values))
        else:
            cur = conn.execute(
                f"""UPDATE papers_assessment
                    SET published_at = NULL, published_by = ''
                    WHERE eval_hash = ? AND (user_id IN ({ph}) OR author_openalex_id IN ({ph}))""",
                (eval_hash, *values, *values))
        conn.commit()
        if cur.rowcount:
            return {"ok": True, "reason": ""}
        return {"ok": False, "reason": "That paper was not found under your identity."}
    except sqlite3.Error as e:
        logging.warning("Publish state change failed: %s", e)
        return {"ok": False, "reason": "The change could not be saved."}
    finally:
        conn.close()


def is_published(eval_hash: str) -> bool:
    conn = get_db_connection()
    try:
        row = conn.execute("SELECT published_at FROM papers_assessment WHERE eval_hash = ?",
                           (eval_hash,)).fetchone()
        return bool(row and row[0])
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def publication_fee_paid(eval_hash: str, identities) -> bool:
    """Has this paper's publication fee already been charged to this identity?

    Read from the ledger rather than a flag, so the answer always agrees with
    the account the money actually left.
    """
    values = [v for v in (identities or []) if v]
    if not eval_hash or not values:
        return False
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT 1 FROM piq_ledger WHERE eval_hash = ? AND reason LIKE ? LIMIT 1",
            (eval_hash, "Publication fee%")).fetchone()
        return bool(row)
    except sqlite3.Error:
        return False
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Peer review
# ---------------------------------------------------------------------------
def open_review_request(eval_hash: str, requested_by: str, bounty: float) -> dict:
    """Open a review request. One open request per paper."""
    conn = get_db_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM peer_reviews WHERE eval_hash = ? AND completed_at IS NULL LIMIT 1",
            (eval_hash,)).fetchone()
        if existing:
            return {"ok": False, "reason": "A review is already open for this paper."}
        conn.execute(
            "INSERT INTO peer_reviews (eval_hash, requested_by, bounty) VALUES (?, ?, ?)",
            (eval_hash, requested_by, float(bounty)))
        conn.commit()
        return {"ok": True, "reason": ""}
    except sqlite3.Error as e:
        logging.warning("Could not open review request: %s", e)
        return {"ok": False, "reason": "The request could not be opened."}
    finally:
        conn.close()


def cancel_review_request(eval_hash: str, requested_by: str) -> dict:
    """Withdraw an open review request, returning what was set aside.

    Only the identity that opened the request may cancel it, and only while it
    is still open: once a reviewer has submitted a report the piQ is theirs and
    the badge is earned, so a cancellation at that point would be a way to take
    back a review you did not like.

    The row is deleted rather than flagged. A cancelled request is not a state
    the platform needs to remember — it is the absence of a request — and
    keeping tombstones would make `has_open_review_request` and the reviewer
    listing both need to know about a third state that means nothing to either.
    """
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT id, bounty, completed_at, requested_by FROM peer_reviews "
            "WHERE eval_hash = ? AND completed_at IS NULL LIMIT 1", (eval_hash,)).fetchone()
        if not row:
            return {"ok": False, "reason": "There is no open review request for this paper.",
                    "refund": 0.0}
        if row[3] != requested_by:
            return {"ok": False, "refund": 0.0, "reason": (
                "Only the person who requested this review can cancel it.")}
        conn.execute("DELETE FROM peer_reviews WHERE id = ?", (row[0],))
        conn.commit()
        return {"ok": True, "reason": "", "refund": round(float(row[1] or 0), 4)}
    except sqlite3.Error as e:
        conn.rollback()
        logging.warning("Could not cancel review request: %s", e)
        return {"ok": False, "reason": "The request could not be cancelled.", "refund": 0.0}
    finally:
        conn.close()


def record_llm_review(eval_hash: str, verdict: str, comment: str) -> dict:
    """Write a completed machine review straight into the reviews table.

    Machine reviews deliberately do NOT go through open_review_request +
    complete_review. That path exists to stop someone reviewing their own
    request, and it does so by rejecting a completion whose reviewer_key equals
    the requester's — which for the panel is "llm:panel" on both sides, so
    every machine review was silently rejected at the last step and no badge
    was ever attached. The self-review guard is meaningful for humans and
    meaningless for the panel, so the panel gets its own insert.

    A row is written whatever the panel concluded, including when no model was
    reachable: the badge records that a machine review was run and paid for,
    and the verdict inside it says what came of it. Silently charging piQ and
    attaching nothing would be the worse failure.

    Reviews accumulate; a paper can be reviewed again later and each review is
    kept, so a reader can see how the machine read the paper over time.
    """
    conn = get_db_connection()
    try:
        cur = conn.execute(
            """INSERT INTO peer_reviews
                   (eval_hash, requested_by, bounty, reviewer_key, verdict, comment,
                    completed_at)
               VALUES (?, 'llm:panel', 0, 'llm:panel', ?, ?, CURRENT_TIMESTAMP)""",
            (eval_hash, str(verdict)[:40], str(comment)[:4000]))
        conn.commit()
        return {"ok": True, "id": cur.lastrowid, "reason": ""}
    except sqlite3.Error as e:
        conn.rollback()
        logging.warning("Could not record LLM review: %s", e)
        return {"ok": False, "id": None, "reason": "The machine review could not be saved."}
    finally:
        conn.close()


def list_open_reviews(exclude_key: str = "", limit: int = 50,
                      exclude_authored_by=None) -> list:
    """Papers awaiting review, excluding ones the caller must not review.

    Two different exclusions, and they are not the same:

      * `exclude_key` drops requests this identity opened. For an ordinary
        researcher that is their own paper, since requests are author-only.
      * `exclude_authored_by` drops papers this identity AUTHORED, whoever
        requested the review. This is the rule that actually matters, and it
        is what an operator needs — they can open requests on other people's
        work, so "did you request it" would wrongly hide those from them.

    Pass `exclude_authored_by` to list everything a reviewer may legitimately
    take; pass only `exclude_key` for the stricter, older behaviour.
    """
    authored = [v for v in (exclude_authored_by or []) if v]
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT r.id, r.eval_hash, r.bounty, r.requested_at, p.user_id,
                      p.author_openalex_id,
                      p.title, p.author_name, p.final_score
               FROM peer_reviews r
               JOIN papers_assessment p ON p.eval_hash = r.eval_hash
               WHERE r.completed_at IS NULL AND (? = 1 OR r.requested_by <> ?)
               ORDER BY r.requested_at ASC LIMIT ?""",
            (1 if authored else 0, exclude_key or "\x00", int(limit))).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    out = []
    for r in rows:
        # Drop anything this identity authored. Done here rather than in SQL
        # because authorship can be recorded under either column and the list
        # is small; correctness matters more than the query shape.
        if authored and (r[4] in authored or r[5] in authored):
            continue
        out.append({"id": r[0], "hash": r[1], "bounty": round(float(r[2] or 0), 4),
                    "requested_at": r[3], "title": r[6] or "Untitled",
                    "author": r[7] or "", "score": round(float(r[8] or 0), 1)})
    return out


def complete_review(review_id: int, reviewer_key: str, verdict: str, comment: str,
                    reviewer_is_author: Optional[bool] = None) -> dict:
    """Record a completed review and credit the reviewer.

    The rule being enforced is *the reviewer must not be an author of the
    paper*. The requester check is a proxy for it, re-checked here rather than
    only at listing time: a request could be opened between a reviewer loading
    the list and submitting, and self-review must be impossible at the moment
    it is written, not merely hidden from a page.

    `reviewer_is_author` lets the caller supply the real answer when it knows
    it. Since review requests became author-only, requester and author are the
    same person, so the proxy started refusing legitimate reviews: an operator
    who opened a request on someone ELSE'S paper was blocked from reviewing it
    even though they authored nothing. Passing False here says "authorship was
    checked and this is not their paper", and the proxy steps aside. Passing
    None keeps the old, stricter behaviour for any caller that has not
    checked.
    """
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT eval_hash, requested_by, bounty, completed_at FROM peer_reviews WHERE id = ?",
            (review_id,)).fetchone()
        if not row:
            return {"ok": False, "reason": "No such review request."}
        if row[3]:
            return {"ok": False, "reason": "That review has already been completed."}
        if row[1] == reviewer_key and reviewer_is_author is not False:
            return {"ok": False, "reason": (
                "You cannot review a paper you requested review of. If this is your own "
                "manuscript, it needs a reviewer other than you — a badge you issued to "
                "yourself would certify nothing.")}

        conn.execute(
            """UPDATE peer_reviews SET reviewer_key = ?, verdict = ?, comment = ?,
                   completed_at = CURRENT_TIMESTAMP WHERE id = ?""",
            (reviewer_key, verdict[:40], comment[:4000], review_id))
        bounty = round(float(row[2] or 0), 4)
        kind = "orcid" if reviewer_key.startswith("orcid:") else "wallet"
        account = reviewer_key.split(":", 1)[-1]
        if bounty > 0:
            conn.execute(
                "INSERT INTO piq_ledger (account, account_kind, delta, reason, eval_hash) "
                "VALUES (?, ?, ?, ?, ?)",
                (account, kind, bounty, "Peer review bounty", row[0]))
        # The completion bonus is separate from the bounty and unconditional on
        # one having been posted, so reviewing a paper nobody commissioned still
        # pays. Written as its own ledger line rather than folded into the
        # bounty, so a reviewer can see which is which.
        bonus = round(float(PEER_REVIEW_BONUS), 4)
        if bonus > 0:
            conn.execute(
                "INSERT INTO piq_ledger (account, account_kind, delta, reason, eval_hash) "
                "VALUES (?, ?, ?, ?, ?)",
                (account, kind, bonus, "Peer review completion bonus", row[0]))
        conn.commit()
        return {"ok": True, "eval_hash": row[0], "paid": round(bounty + bonus, 4),
                "bounty": bounty, "bonus": bonus, "reason": ""}
    except sqlite3.Error as e:
        conn.rollback()
        logging.warning("Could not complete review: %s", e)
        return {"ok": False, "reason": "The review could not be saved."}
    finally:
        conn.close()


def review_summary(eval_hash: str) -> dict:
    """Completed reviews for a paper. The badge derives from this, not payment."""
    conn = get_db_connection()
    try:
        # reviewer_key is selected because it, not the verdict string, is what
        # says whether the panel or a human wrote a review. Callers were
        # classifying on `verdict.startswith("llm")` while the badge queries
        # counted `reviewer_key = 'llm:panel'` — two definitions of the same
        # fact, which disagreed on any row where the verdict was stored without
        # the prefix. The badge appeared and the review list came back empty.
        # `id` is selected so a review can be replied to, rated or reported.
        # Without it the client had no handle on an individual review and could
        # only ever address the paper as a whole.
        rows = conn.execute(
            """SELECT verdict, comment, completed_at, reviewer_key, id FROM peer_reviews
               WHERE eval_hash = ? AND completed_at IS NOT NULL
               ORDER BY completed_at DESC""", (eval_hash,)).fetchall()
        pending = conn.execute(
            "SELECT COUNT(*) FROM peer_reviews WHERE eval_hash = ? AND completed_at IS NULL",
            (eval_hash,)).fetchone()
    except sqlite3.Error:
        return {"reviewed": False, "count": 0, "pending": 0, "reviews": []}
    finally:
        conn.close()
    return {
        "reviewed": len(rows) > 0,
        "count": len(rows),
        "pending": int(pending[0]) if pending else 0,
        # Reviewer identity is deliberately absent: this is single-blind, and
        # publishing who reviewed what would deter honest negative reviews.
        # `is_llm` is the one exception, and it is not an identity — the panel
        # is not a person, and a reader must be able to tell machine from human.
        "reviews": [{
            "id": r[4],
            "verdict": r[0], "comment": r[1], "completed_at": r[2],
            "is_llm": (r[3] == "llm:panel") or str(r[0] or "").startswith("llm"),
        } for r in rows],
    }


REBUTTAL_MIN_CHARS = 120
REPORT_REASONS = {
    "fabricated": "The review shows no sign of having read the manuscript",
    "abusive": "Abusive, demeaning, or unprofessional language",
    "conflict": "The reviewer appears to have a conflict of interest",
    "identifying": "The review reveals the reviewer's or author's identity",
    "offtopic": "The review is about something other than this manuscript",
    "other": "Something else",
}


def review_owner_key(review_id: int) -> dict:
    """Who wrote the paper a review is about, and who wrote the review.

    Both are needed to decide who may reply and who may vote: the author of the
    paper is the only person who can rebut, and the author of the review is the
    one person who must not be able to vote it up.
    """
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT r.eval_hash, r.reviewer_key, r.completed_at,
                      p.user_id, p.author_openalex_id, p.published_by
               FROM peer_reviews r
               LEFT JOIN papers_assessment p ON p.eval_hash = r.eval_hash
               WHERE r.id = ?""", (int(review_id),)).fetchone()
    except (sqlite3.Error, ValueError, TypeError):
        return {}
    finally:
        conn.close()
    if not row:
        return {}
    return {"eval_hash": row[0], "reviewer_key": row[1] or "", "completed": bool(row[2]),
            "paper_identities": [v for v in (row[3], row[4], row[5]) if v]}


def add_review_rebuttal(review_id: int, eval_hash: str, author_key: str, body: str) -> dict:
    """Record an author's reply to a review. One reply per author per review.

    The review itself is never touched. A rebuttal is a second statement placed
    next to the first, so a reader sees the criticism and the answer to it —
    letting an author edit or suppress a review they disagree with would make
    the Peer-reviewed badge worthless.
    """
    body = (body or "").strip()
    if len(body) < REBUTTAL_MIN_CHARS:
        return {"ok": False, "reason": (
            f"A reply needs at least {REBUTTAL_MIN_CHARS} characters. A rebuttal that does not "
            f"say what it disputes is not a rebuttal.")}
    conn = get_db_connection()
    try:
        existing = conn.execute(
            "SELECT 1 FROM review_rebuttals WHERE review_id = ? AND author_key = ? LIMIT 1",
            (int(review_id), author_key)).fetchone()
        if existing:
            return {"ok": False, "reason": "You have already replied to this review."}
        conn.execute(
            """INSERT INTO review_rebuttals (review_id, eval_hash, author_key, body)
               VALUES (?, ?, ?, ?)""",
            (int(review_id), eval_hash, author_key, body[:6000]))
        conn.commit()
        return {"ok": True, "reason": ""}
    except sqlite3.Error as e:
        conn.rollback()
        logging.warning("Could not save rebuttal: %s", e)
        return {"ok": False, "reason": "The reply could not be saved."}
    finally:
        conn.close()


def rate_review(review_id: int, voter_key: str, value: int) -> dict:
    """Record a usefulness vote. One per identity, changeable."""
    value = 1 if int(value or 0) > 0 else -1
    conn = get_db_connection()
    try:
        conn.execute(
            """INSERT INTO review_ratings (review_id, voter_key, value)
               VALUES (?, ?, ?)
               ON CONFLICT(review_id, voter_key)
               DO UPDATE SET value = excluded.value, created_at = CURRENT_TIMESTAMP""",
            (int(review_id), voter_key, value))
        conn.commit()
        return {"ok": True, "reason": "", **review_rating_summary(review_id, voter_key)}
    except sqlite3.Error as e:
        conn.rollback()
        logging.warning("Could not record review rating: %s", e)
        return {"ok": False, "reason": "The rating could not be saved."}
    finally:
        conn.close()


def review_rating_summary(review_id: int, voter_key: str = "") -> dict:
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT COALESCE(SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END), 0),
                      COALESCE(SUM(CASE WHEN value < 0 THEN 1 ELSE 0 END), 0)
               FROM review_ratings WHERE review_id = ?""", (int(review_id),)).fetchone()
        mine = None
        if voter_key:
            m = conn.execute(
                "SELECT value FROM review_ratings WHERE review_id = ? AND voter_key = ?",
                (int(review_id), voter_key)).fetchone()
            mine = int(m[0]) if m else None
    except (sqlite3.Error, ValueError, TypeError):
        return {"helpful": 0, "unhelpful": 0, "my_vote": None}
    finally:
        conn.close()
    return {"helpful": int(row[0] or 0), "unhelpful": int(row[1] or 0), "my_vote": mine}


def report_review(review_id: int, eval_hash: str, reporter_key: str,
                  reason: str, detail: str = "") -> dict:
    """Flag a review for a moderator. One report per identity per review."""
    if reason not in REPORT_REASONS:
        return {"ok": False, "reason": "Choose a reason for the report."}
    conn = get_db_connection()
    try:
        conn.execute(
            """INSERT INTO review_reports (review_id, eval_hash, reporter_key, reason, detail)
               VALUES (?, ?, ?, ?, ?)""",
            (int(review_id), eval_hash or "", reporter_key, reason, (detail or "")[:2000]))
        conn.commit()
        return {"ok": True, "reason": ""}
    except sqlite3.IntegrityError:
        return {"ok": False, "reason": "You have already reported this review."}
    except sqlite3.Error as e:
        conn.rollback()
        logging.warning("Could not record review report: %s", e)
        return {"ok": False, "reason": "The report could not be saved."}
    finally:
        conn.close()


def rebuttals_for_paper(eval_hash: str) -> dict:
    """Every reply on a paper, keyed by the review it answers."""
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT review_id, body, created_at FROM review_rebuttals
               WHERE eval_hash = ? ORDER BY created_at ASC""", (eval_hash,)).fetchall()
    except sqlite3.Error:
        return {}
    finally:
        conn.close()
    out = {}
    for r in rows:
        out.setdefault(int(r[0]), []).append({"body": r[1], "created_at": r[2]})
    return out


def list_review_reports(limit: int = 100, include_resolved: bool = False) -> list:
    """Open moderation reports, for the operator."""
    conn = get_db_connection()
    try:
        rows = conn.execute(
            f"""SELECT rr.id, rr.review_id, rr.eval_hash, rr.reason, rr.detail,
                       rr.created_at, rr.resolved, p.title
                FROM review_reports rr
                LEFT JOIN papers_assessment p ON p.eval_hash = rr.eval_hash
                {"" if include_resolved else "WHERE rr.resolved = 0"}
                ORDER BY rr.id DESC LIMIT ?""", (int(limit),)).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    # The reporter's identity is deliberately not returned: a moderation queue
    # that names reporters invites retaliation against them.
    return [{"id": r[0], "review_id": r[1], "eval_hash": r[2], "reason": r[3],
             "detail": r[4], "created_at": r[5], "resolved": bool(r[6]),
             "title": r[7] or "Untitled"} for r in rows]


def has_open_review_request(eval_hash: str) -> bool:
    """Whether someone has asked for this paper to be reviewed and nobody has yet.

    This is what the "Requested to be reviewed" marker is drawn from. It is a
    request, not a credential, and it disappears the moment a review lands —
    at which point the Peer-reviewed badge is the honest thing to show instead.
    """
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT 1 FROM peer_reviews WHERE eval_hash = ? AND completed_at IS NULL LIMIT 1",
            (eval_hash,)).fetchone()
        return bool(row)
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def has_human_review(eval_hash: str) -> bool:
    """Whether a *person* has reviewed this paper.

    Machine reviews are excluded deliberately. This is the gate on publishing,
    and a paper that cleared it because a language model read it would make
    "reviewed before published" mean nothing.
    """
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT 1 FROM peer_reviews
               WHERE eval_hash = ? AND completed_at IS NOT NULL
                 AND reviewer_key <> 'llm:panel' LIMIT 1""", (eval_hash,)).fetchone()
        return bool(row)
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def count_journal_publications(identities) -> int:
    """How many papers this identity has published on the platform.

    The reviewer eligibility test. Reviewing is a privilege of people who have
    themselves put work into the journal and been through the same process —
    it is not a gate on competence, it is a gate on having something at stake.
    """
    values = [v for v in (identities or []) if v]
    if not values:
        return 0
    ph = ",".join("?" for _ in values)
    conn = get_db_connection()
    try:
        row = conn.execute(
            f"""SELECT COUNT(*) FROM papers_assessment
                WHERE published_at IS NOT NULL
                  AND (user_id IN ({ph}) OR author_openalex_id IN ({ph})
                       OR published_by IN ({ph}))""",
            (*values, *values, *values)).fetchone()
        return int(row[0] or 0)
    except sqlite3.Error:
        return 0
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def record_paper_read(eval_hash: str, reader: str) -> int:
    """Count one read of an assessment, at most once per reader per day.

    Returns the new total. Deduplicated on (paper, reader, day) because the
    number is displayed publicly next to a score: a counter that goes up on
    every page refresh measures nothing except how often a tab was reloaded,
    and would be inflatable by anyone who wanted their paper to look read.

    Never raises. Failing to count a read must not fail the read itself.
    """
    if not eval_hash:
        return 0
    reader = (reader or "anonymous")[:120]
    conn = get_db_connection()
    try:
        cur = conn.execute(
            """INSERT OR IGNORE INTO paper_reads (eval_hash, reader, read_day)
               VALUES (?, ?, DATE('now'))""", (eval_hash, reader))
        if cur.rowcount:
            conn.execute(
                "UPDATE papers_assessment SET reads = COALESCE(reads, 0) + 1 "
                "WHERE eval_hash = ?", (eval_hash,))
        conn.commit()
        row = conn.execute("SELECT COALESCE(reads, 0) FROM papers_assessment WHERE eval_hash = ?",
                           (eval_hash,)).fetchone()
        return int(row[0] or 0) if row else 0
    except sqlite3.Error as e:
        logging.warning("Could not record read for %s: %s", eval_hash[:12], e)
        return 0
    finally:
        conn.close()


def get_paper_reads(eval_hash: str) -> int:
    conn = get_db_connection()
    try:
        row = conn.execute("SELECT COALESCE(reads, 0) FROM papers_assessment WHERE eval_hash = ?",
                           (eval_hash,)).fetchone()
        return int(row[0] or 0) if row else 0
    except sqlite3.Error:
        return 0
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Background review jobs
# ---------------------------------------------------------------------------
def create_review_job(eval_hash: str, requested_by: str, wallet: str, orcid: str,
                      fee: float, kind: str = "llm") -> int:
    """Record a review as owed before any model is called.

    Written first, deliberately. The fee is charged up front, so the durable
    record of "this person is owed a review" must exist before the part that
    can fail — otherwise a crash between payment and completion leaves piQ
    spent with nothing on record to recover it against.
    """
    conn = get_db_connection()
    try:
        cur = conn.execute(
            """INSERT INTO review_jobs (eval_hash, requested_by, wallet, orcid, kind,
                                        status, fee)
               VALUES (?, ?, ?, ?, ?, 'running', ?)""",
            (eval_hash, requested_by, wallet, orcid, kind, float(fee or 0)))
        conn.commit()
        return int(cur.lastrowid)
    except sqlite3.Error as e:
        logging.warning("Could not create review job: %s", e)
        return 0
    finally:
        conn.close()


def finish_review_job(job_id: int, status: str, verdict: str = "", message: str = "") -> None:
    if not job_id:
        return
    conn = get_db_connection()
    try:
        conn.execute(
            """UPDATE review_jobs SET status = ?, verdict = ?, message = ?,
                   finished_at = CURRENT_TIMESTAMP WHERE id = ?""",
            (str(status)[:20], str(verdict)[:60], str(message)[:600], int(job_id)))
        conn.commit()
    except sqlite3.Error as e:
        logging.warning("Could not finish review job %s: %s", job_id, e)
    finally:
        conn.close()


def list_review_jobs(requested_by: str, limit: int = 20) -> list:
    """Recent review jobs for one identity, newest first.

    This is what lets the page pick up a review that finished while the window
    was closed: the browser asks what happened rather than needing to have
    been present when it did.
    """
    if not requested_by:
        return []
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT j.id, j.eval_hash, j.kind, j.status, j.verdict, j.message,
                      j.created_at, j.finished_at, p.title
               FROM review_jobs j
               LEFT JOIN papers_assessment p ON p.eval_hash = j.eval_hash
               WHERE j.requested_by = ?
               ORDER BY j.id DESC LIMIT ?""", (requested_by, int(limit))).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    return [{"id": r[0], "hash": r[1], "kind": r[2], "status": r[3], "verdict": r[4],
             "message": r[5], "created_at": r[6], "finished_at": r[7],
             "title": r[8] or "Untitled"} for r in rows]


def reclaim_stale_review_jobs(max_age_minutes: int = 30) -> list:
    """Jobs left "running" by a process that died. Returns them for refund.

    A worker thread does not survive a restart, so without this the fee for an
    interrupted review would sit charged forever against a review that will
    never be written.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT id, eval_hash, wallet, orcid, fee FROM review_jobs
               WHERE status = 'running'
                 AND created_at < DATETIME('now', ?)""",
            (f"-{int(max_age_minutes)} minutes",)).fetchall()
        if rows:
            conn.execute(
                """UPDATE review_jobs SET status = 'abandoned',
                       message = 'The service restarted before this review finished; '
                                 || 'the fee was returned.',
                       finished_at = CURRENT_TIMESTAMP
                   WHERE status = 'running' AND created_at < DATETIME('now', ?)""",
                (f"-{int(max_age_minutes)} minutes",))
            conn.commit()
    except sqlite3.Error as e:
        logging.warning("Could not reclaim stale review jobs: %s", e)
        return []
    finally:
        conn.close()
    return [{"id": r[0], "hash": r[1], "wallet": r[2], "orcid": r[3],
             "fee": float(r[4] or 0)} for r in rows]


# ---------------------------------------------------------------------------
# Site visits
# ---------------------------------------------------------------------------
def record_visit(visitor_key: str) -> None:
    """Note that a visitor was here. Idempotent per visitor.

    An UPSERT rather than a SELECT-then-INSERT: two tabs opening at once would
    otherwise race and either double-count or fail on the primary key.

    Never raises. A visitor counter is a nice-to-have; it must not be able to
    break a page load for the person being counted.
    """
    if not visitor_key:
        return
    conn = get_db_connection()
    try:
        conn.execute(
            """INSERT INTO site_visits (visitor_key, first_seen, last_seen, visits)
               VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
               ON CONFLICT(visitor_key) DO UPDATE SET
                   last_seen = CURRENT_TIMESTAMP,
                   visits = visits + 1""",
            (visitor_key,))
        conn.commit()
    except sqlite3.Error as e:
        logging.debug("Could not record visit: %s", e)
    finally:
        conn.close()


def visitor_stats() -> dict:
    """Unique visitors, all time and over recent windows."""
    conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT COUNT(*),
                      COALESCE(SUM(visits), 0),
                      SUM(CASE WHEN last_seen >= datetime('now', '-1 day')  THEN 1 ELSE 0 END),
                      SUM(CASE WHEN last_seen >= datetime('now', '-7 day')  THEN 1 ELSE 0 END),
                      SUM(CASE WHEN last_seen >= datetime('now', '-30 day') THEN 1 ELSE 0 END)
               FROM site_visits""").fetchone()
    except sqlite3.Error as e:
        logging.debug("Visitor stats unavailable: %s", e)
        return {"unique": 0, "total": 0, "day": 0, "week": 0, "month": 0}
    finally:
        conn.close()
    return {
        "unique": int(row[0] or 0),
        "total": int(row[1] or 0),
        "day": int(row[2] or 0),
        "week": int(row[3] or 0),
        "month": int(row[4] or 0),
    }


# ---------------------------------------------------------------------------
# Engine model state — piD, riB, siM
# ---------------------------------------------------------------------------
def _ensure_engine_tables(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS engine_models (
                        name TEXT PRIMARY KEY,
                        state TEXT NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    # Every observation is kept, not just the resulting weights. A learned
    # model whose training history is discarded cannot be recomputed, audited
    # or explained after the fact — and these models feed research assessment,
    # where "the number changed and we cannot say why" is not acceptable.
    conn.execute("""CREATE TABLE IF NOT EXISTS engine_observations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        engine TEXT NOT NULL,
                        features TEXT NOT NULL,
                        target REAL NOT NULL,
                        predicted REAL,
                        error REAL,
                        baseline_error REAL,
                        source TEXT DEFAULT '',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_engine_obs ON engine_observations(engine, id)")


def save_engine_state(name: str, state_json: str) -> None:
    """Persist a model. Never raises: learning must not break a request."""
    conn = get_db_connection()
    try:
        _ensure_engine_tables(conn)
        conn.execute(
            """INSERT INTO engine_models (name, state, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(name) DO UPDATE SET state = excluded.state,
                                               updated_at = CURRENT_TIMESTAMP""",
            (name, state_json))
        conn.commit()
    except sqlite3.Error as e:
        logging.warning("Could not persist engine model %s: %s", name, e)
    finally:
        conn.close()


def load_engine_state(name: str) -> str:
    conn = get_db_connection()
    try:
        _ensure_engine_tables(conn)
        row = conn.execute("SELECT state FROM engine_models WHERE name = ?", (name,)).fetchone()
        return row[0] if row else ""
    except sqlite3.Error:
        return ""
    finally:
        conn.close()


def log_engine_observation(engine: str, features, target: float, result: dict,
                           source: str = "") -> None:
    conn = get_db_connection()
    try:
        _ensure_engine_tables(conn)
        conn.execute(
            """INSERT INTO engine_observations
                   (engine, features, target, predicted, error, baseline_error, source)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (engine, json.dumps([float(f) for f in features]), float(target),
             result.get("predicted"), result.get("error"),
             result.get("baseline_error"), source))
        conn.commit()
    except (sqlite3.Error, TypeError, ValueError) as e:
        logging.debug("Could not log engine observation: %s", e)
    finally:
        conn.close()


def engine_observation_count(engine: str, source: str = "") -> int:
    """How many observations an engine has learned from.

    `source` narrows it — "user" for researcher feedback, "llm" for tutoring.
    The distinction matters for riB: tutoring is supposed to stop once REAL
    feedback is sufficient, and counting its own tutored observations toward
    that threshold would let it switch itself off by talking to itself.
    """
    conn = get_db_connection()
    try:
        _ensure_engine_tables(conn)
        if source:
            row = conn.execute(
                "SELECT COUNT(*) FROM engine_observations WHERE engine = ? AND source = ?",
                (engine, source)).fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) FROM engine_observations WHERE engine = ?",
                (engine,)).fetchone()
        return int(row[0] or 0)
    except sqlite3.Error:
        return 0
    finally:
        conn.close()


def recent_engine_observations(engine: str, limit: int = 30) -> list:
    conn = get_db_connection()
    try:
        _ensure_engine_tables(conn)
        rows = conn.execute(
            """SELECT target, predicted, error, baseline_error, source, created_at
               FROM engine_observations WHERE engine = ? ORDER BY id DESC LIMIT ?""",
            (engine, int(limit))).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    return [{"target": r[0], "predicted": r[1], "error": r[2],
             "baseline_error": r[3], "source": r[4], "created_at": r[5]} for r in rows]


# --- riB guidance feedback -------------------------------------------------
def record_rib_feedback(account_key: str, suggestion: str, features,
                        useful: bool) -> None:
    """A researcher's verdict on one piece of riB guidance.

    This is riB's only training signal. Without it riB can compute statistics
    but cannot learn, because nothing in the system otherwise observes whether
    its advice was any good.
    """
    conn = get_db_connection()
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS rib_feedback (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            account_key TEXT,
                            suggestion TEXT,
                            features TEXT,
                            useful INTEGER,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
        conn.execute(
            "INSERT INTO rib_feedback (account_key, suggestion, features, useful) "
            "VALUES (?, ?, ?, ?)",
            (account_key, str(suggestion)[:300],
             json.dumps([float(f) for f in features]), 1 if useful else 0))
        conn.commit()
    except (sqlite3.Error, TypeError, ValueError) as e:
        logging.warning("Could not record riB feedback: %s", e)
    finally:
        conn.close()


def rib_feedback_totals() -> dict:
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(useful),0) FROM rib_feedback").fetchone()
        return {"count": int(row[0] or 0), "useful": int(row[1] or 0)}
    except sqlite3.Error:
        return {"count": 0, "useful": 0}
    finally:
        conn.close()
