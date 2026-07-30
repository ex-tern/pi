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
        # Pipeline warnings and final-judge metadata are persisted so the full
        # dossier can be reconstructed later from the ledger explorer, not just
        # from the in-memory result of the run that produced it.
        "warnings_json": "TEXT DEFAULT '[]'", "judge_metadata": "TEXT DEFAULT '{}'",
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


def _account_keys(wallet: str = "", orcid: str = ""):
    keys = []
    if orcid:
        keys.append(("orcid", orcid))
    if wallet:
        keys.append(("wallet", wallet))
    return keys


def get_piq_minted_total(wallet: str = "", orcid: str = "") -> float:
    """Lifetime piQ awarded to this identity across all its assessed papers."""
    keys = _account_keys(wallet, orcid)
    if not keys:
        return 0.0
    clauses, params = [], []
    if orcid:
        clauses.append("user_id = ?")
        params.append(orcid)
    if wallet:
        clauses.append("eth_book = ?")
        params.append(wallet)
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
            f"SELECT COALESCE(SUM(delta), 0) FROM piq_ledger WHERE account IN ({placeholders})",
            tuple(v for _, v in keys),
        ).fetchone()
    finally:
        conn.close()
    return float(row[0] or 0.0)


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
    return {
        "minted": minted,
        "fees_paid": round(max(0.0, -net), 4),
        "balance": round(minted + net, 4),
    }


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
                WHERE account IN ({placeholders}) ORDER BY entry_id DESC LIMIT ?""",
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
