import sqlite3
import hashlib
import logging
from config import DB_PATH, GENESIS_BLOCK_CONFIG

_schema_initialized = False

def reset_schema_cache():
    global _schema_initialized
    _schema_initialized = False

def enforce_database_schema(conn: sqlite3.Connection):
    global _schema_initialized
    if _schema_initialized: return

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

    # 3. New Ingestion Queue for Microservices
    cursor.execute("""CREATE TABLE IF NOT EXISTS ingestion_queue (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT, source_val TEXT, 
                        file_name TEXT, raw_bytes BLOB, status TEXT, timestamp DATETIME)""")

    cursor.execute("CREATE TABLE IF NOT EXISTS global_eval_counter (count INTEGER)")
    cursor.execute("CREATE TABLE IF NOT EXISTS desci_attestations (attestation_id TEXT PRIMARY KEY, eval_hash TEXT, attester_id TEXT, stake_amount REAL, stance TEXT, timestamp DATETIME)")
    cursor.execute("CREATE TABLE IF NOT EXISTS auto_ip_tracking (ip_address TEXT PRIMARY KEY, first_seen DATETIME)")

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

    # Ensure assessment columns exist
    target_columns = {
        "eth_book": "TEXT DEFAULT 'None'", "eth_wallet": "TEXT DEFAULT 'None'", "piq_minted": "REAL DEFAULT 0.0",
        "epc_minted": "REAL DEFAULT 0.0", "tx_hash": "TEXT DEFAULT 'Pending'", "zk_proof": "TEXT DEFAULT 'None'",
        "did": "TEXT DEFAULT 'None'", "zk_email_proof": "TEXT DEFAULT 'None'", "gaming_penalty": "REAL DEFAULT 0.0",
        "mdar_adherence_score": "REAL DEFAULT 0.0", "rrid_valid_count": "INTEGER DEFAULT 0",
        "credit_taxonomy_roles": "TEXT DEFAULT 'None'", "reproducibility_score": "REAL DEFAULT 0.0",
        "doi": "TEXT DEFAULT 'None'", "consensus_data": "TEXT DEFAULT '{}'", "evidence_report": "TEXT DEFAULT ''",
        "scilem_score": "REAL DEFAULT 50.0",
    }
    cursor.execute("PRAGMA table_info(papers_assessment)")
    existing_cols = [row[1] for row in cursor.fetchall()]
    for col, dtype in target_columns.items():
        if col not in existing_cols:
            try: cursor.execute(f"ALTER TABLE papers_assessment ADD COLUMN {col} {dtype}")
            except: pass

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_papers_eval_hash ON papers_assessment(eval_hash)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_papers_eth_book ON papers_assessment(eth_book)")
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
        block_hash = hashlib.sha256(f"{g['block_height']}{g['weights']}{g['timestamp']}{g['previous_hash']}{g['validator_node']}{g['por_proof']}{g['model_used']}{g['formulas_hash']}".encode("utf-8")).hexdigest()
        cursor.execute("""INSERT INTO blockchain_por_weights (block_height, w1, w2, w3, w4, w5, w6, w7, w8, timestamp, previous_hash, validator_node, block_hash, eval_hash, model_used, por_proof, formulas_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (g["block_height"], *g["weights"], g["timestamp"], g["previous_hash"], g["validator_node"], block_hash, g["eval_hash"], g["model_used"], g["por_proof"], g["formulas_hash"]))
        conn.commit()
    return conn


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
