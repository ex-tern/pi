"""routes/admin.py: the owner: reset, overview, settlement, grants, storage. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import require_owner  # noqa: F401
from routes.piq import is_tx_hash  # noqa: F401

router = APIRouter()



class ResetRequest(BaseModel):
    groups: List[str] = []
    confirm: str = ""               # must be the literal word RESET
    clear_files: bool = False       # also delete stored manuscript PDFs
    wallet: str = ""


@router.get("/api/admin/reset/options")
def reset_options(request: Request, wallet: str = Query(default="")):
    """What can be wiped, and how much of it there currently is.

    The counts are the point. "Delete assessed papers" means nothing without
    "(29 rows)" beside it, and an operator about to destroy something
    irreversible should be shown the size of what they are destroying before
    they confirm rather than after.
    """
    require_owner(request, wallet)
    conn = get_db_connection()
    options = []
    try:
        for key, spec in sorted(RESET_GROUPS.items(), key=lambda kv: kv[1]["order"]):
            rows = 0
            missing = True
            for table in spec["tables"]:
                try:
                    rows += int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] or 0)
                    missing = False
                except sqlite3.Error:
                    continue
            options.append({"id": key, "label": spec["label"], "detail": spec["detail"],
                            "destroys": spec["destroys"], "rows": rows,
                            "available": not missing})
    finally:
        conn.close()

    stored_files = 0
    try:
        stored_files = paper_store.count_papers()
    except Exception:
        stored_files = -1        # unknown; the UI says so rather than guessing

    return {"options": options, "stored_files": stored_files,
            "confirm_word": "RESET",
            "note": ("Each group is independent. Nothing outside the groups you tick is "
                     "touched, and the whole reset runs in one transaction — if any part "
                     "fails, nothing is deleted.")}


@router.post("/api/admin/reset")
def admin_reset(payload: ResetRequest, request: Request):
    """Wipe the selected state groups. Owner only, and irreversible.

    Three independent gates, because this is the most destructive endpoint on
    the platform: the owner wallet must be proven, the confirmation word must
    be typed exactly, and at least one group must be named. A missing gate is
    a refusal, never a default — there is no combination of empty inputs that
    deletes anything.
    """
    require_owner(request, payload.wallet)

    if (payload.confirm or "").strip() != "RESET":
        raise HTTPException(
            status_code=400,
            detail="Type RESET exactly to confirm. Nothing has been deleted.")

    groups = [g for g in (payload.groups or []) if g in RESET_GROUPS]
    if not groups:
        raise HTTPException(
            status_code=400,
            detail="Choose at least one thing to reset. Nothing has been deleted.")

    result = reset_state_groups(groups)
    if not result["ok"]:
        raise HTTPException(status_code=503, detail=result["reason"])

    # Stored manuscripts are files on disk, not rows, so they are cleared
    # separately and only when explicitly asked for. Wiping the corpus while
    # silently leaving the PDFs behind — or deleting a researcher's uploads
    # when they only asked to clear balances — are both wrong.
    files_removed = 0
    if payload.clear_files and "assessments" in groups:
        try:
            files_removed = paper_store.clear_all()
        except Exception as e:
            logging.warning("Stored manuscripts could not be cleared: %s", e)
            files_removed = -1

    add_log(f"STATE RESET by owner — groups: {', '.join(groups)}; "
            f"rows deleted: {sum(result['deleted'].values())}"
            + (f"; files removed: {files_removed}" if payload.clear_files else ""))

    total = sum(result["deleted"].values())
    return {
        "reset": True,
        "groups": groups,
        "deleted": result["deleted"],
        "rows_deleted": total,
        "files_removed": files_removed,
        "message": (
            f"Reset complete. {total} row{'' if total == 1 else 's'} deleted across "
            f"{len(groups)} group{'' if len(groups) == 1 else 's'}."
            + (f" {files_removed} stored manuscript{'' if files_removed == 1 else 's'} removed."
               if payload.clear_files and files_removed >= 0 else "")
            + " This cannot be undone."),
    }


@router.get("/api/admin/overview")
def admin_overview(request: Request, wallet: str = Query(default="")):
    """Operator-only numbers: who has signed up, and what they are doing.

    Deliberately separate from /api/analytics/summary, which is public. These
    are counts of PEOPLE and of platform activity — how many identities exist,
    how many are active, what is being spent — and publishing them would tell
    every visitor the size of the user base and how thin the activity is. The
    public summary describes the corpus; this describes the deployment.
    """
    require_owner(request, wallet)
    conn = get_db_connection()

    def scalar(sql, params=()):
        try:
            row = conn.execute(sql, params).fetchone()
            return int(row[0] or 0) if row else 0
        except sqlite3.Error:
            return 0

    try:
        # "Signed up" = a distinct account that exists in the ledger or has
        # saved a profile. There is no users table — identity is a wallet or an
        # ORCID that has done something — so the count is derived from the
        # places an identity leaves a durable trace.
        ledger_accounts = scalar("SELECT COUNT(DISTINCT account) FROM piq_ledger")
        profiles = scalar("SELECT COUNT(*) FROM researcher_profiles")
        submitters = scalar(
            "SELECT COUNT(DISTINCT user_id) FROM papers_assessment "
            "WHERE user_id IS NOT NULL AND user_id <> ''")

        stats = {
            "accounts_with_balance": ledger_accounts,
            "saved_profiles": profiles,
            "distinct_submitters": submitters,
            # Activity windows, so "how many signed up" can be read against
            # "how many are still here" — a total with no recency is a number
            # that only ever goes up.
            "active_7d": scalar(
                "SELECT COUNT(DISTINCT user_id) FROM papers_assessment "
                "WHERE timestamp > DATETIME('now','-7 days') AND user_id <> ''"),
            "active_30d": scalar(
                "SELECT COUNT(DISTINCT user_id) FROM papers_assessment "
                "WHERE timestamp > DATETIME('now','-30 days') AND user_id <> ''"),
            "papers_7d": scalar(
                "SELECT COUNT(*) FROM papers_assessment "
                "WHERE timestamp > DATETIME('now','-7 days')"),
            "papers_total": scalar("SELECT COUNT(*) FROM papers_assessment"),
            "reviews_human": scalar(
                "SELECT COUNT(*) FROM peer_reviews WHERE completed_at IS NOT NULL "
                "AND reviewer_key <> 'llm:panel'"),
            "reviews_llm": scalar(
                "SELECT COUNT(*) FROM peer_reviews WHERE completed_at IS NOT NULL "
                "AND reviewer_key = 'llm:panel'"),
            "reviews_open": scalar(
                "SELECT COUNT(*) FROM peer_reviews WHERE completed_at IS NULL"),
            "published": scalar(
                "SELECT COUNT(*) FROM papers_assessment WHERE published_at IS NOT NULL"),
            "bugs_open": scalar("SELECT COUNT(*) FROM bug_reports WHERE delivered = 0"),
        }

        # piQ in circulation, split the way the balance itself is split.
        try:
            row = conn.execute(
                "SELECT COALESCE(SUM(piq_minted),0), "
                "COALESCE(SUM(CASE WHEN piq_claimed_at IS NULL THEN piq_escrowed ELSE 0 END),0) "
                "FROM papers_assessment").fetchone()
            stats["piq_minted"] = round(float(row[0] or 0), 2)
            stats["piq_held"] = round(float(row[1] or 0), 2)
        except sqlite3.Error:
            stats["piq_minted"] = stats["piq_held"] = 0.0
    finally:
        conn.close()

    try:
        stats["visitors"] = visitor_stats()
    except Exception:
        stats["visitors"] = {}

    # Idle-time corpus growth. Owner-only, alongside the rest of the operator
    # numbers, because it is the one process that spends provider quota with
    # nobody watching — so it is exactly the thing an operator needs visibility
    # of rather than a feature to leave running unseen.
    try:
        stats["idle"] = idle_worker.status()
    except Exception:
        stats["idle"] = {"enabled": False}

    return stats


def settlement_blockers() -> list:
    """Why settlement cannot run right now, in the operator's own terms.

    Named specifically rather than as a generic failure: "settlement
    unavailable" is not actionable, "PIQ_CONTRACT_ADDRESS is not set" is an
    instruction. Shared by the admin view and the automatic sweep so the queue
    page and the background worker can never disagree about why nothing moved.
    """
    blockers = []
    if not PIQ_CONTRACT_ADDRESS:
        blockers.append("PIQ_CONTRACT_ADDRESS is not set — there is no contract to mint against.")
    if not ETH_ADMIN_PRIVATE_KEY:
        blockers.append("ETH_ADMIN_PRIVATE_KEY is not set — nothing can sign a transaction.")
    try:
        if (get_chain_status() or {}).get("connected") is False:
            blockers.append(f"No {CHAIN_NAME} RPC endpoint is reachable.")
    except Exception:                                            # noqa: BLE001
        blockers.append(f"The {CHAIN_NAME} RPC endpoint could not be queried.")
    return blockers


def settle_batch(limit: int = 10) -> dict:
    """Mint outstanding records, one transaction each. Returns what happened.

    One transaction per record rather than a batch call: each mint costs gas
    and can fail independently, and a partial batch that reverts as a unit
    would lose the successes with it.
    """
    settled, failed = [], []
    for paper in list_unsettled_mintable(limit=limit):
        try:
            tx = mint_pi_quotient_token(paper["wallet"], paper["piq"],
                                        paper["eval_hash"], "")
        except Exception as e:                                   # noqa: BLE001
            failed.append({**paper, "reason": str(e)[:200]})
            continue
        # mint_pi_quotient_token reports refusals as a STRING rather than
        # raising, so a skip reads as success unless the shape is checked.
        if is_tx_hash(tx):
            if record_settlement(paper["eval_hash"], tx):
                settled.append({**paper, "tx_hash": tx})
                add_log(f"Settled {paper['eval_hash'][:12]}… on chain: {tx[:14]}…")
            else:
                # The mint succeeded but the row would not take it — almost
                # certainly settled by a concurrent call. Reported rather than
                # swallowed, because it means gas was spent twice.
                failed.append({**paper, "reason": f"Minted {tx[:14]}… but the record was "
                                                  f"already settled. Check for a double spend."})
        else:
            failed.append({**paper, "reason": str(tx)[:200]})
    return {"settled": settled, "failed": failed,
            "settled_count": len(settled), "failed_count": len(failed),
            "remaining": len(list_unsettled_mintable())}


# --- Automatic settlement ---------------------------------------------------
#
# Until now the ONLY way an unsettled record ever reached the chain was the
# owner opening the admin panel and pressing a button. Everything else in the
# pipeline retries; settlement did not, so a mint skipped by a provider outage
# or an unfunded gas wallet stayed skipped forever, and the queue grew silently.
# brain.py already carries a comment about that exact failure — "since nothing
# re-tried, it stayed unsettled forever" — for the case it had just fixed. This
# is the retry.
#
# Deliberately conservative, because this spends real money:
#   * it does nothing at all while any blocker is present, so a misconfigured
#     deployment burns no gas and logs one clear reason instead of a loop of
#     failures;
#   * it takes a small batch per pass, so a backlog drains over minutes rather
#     than in one unbounded burst;
#   * it can be switched off entirely with AUTO_SETTLE=0.
_settle_state = {"last": None, "last_result": None, "reason": ""}


def _settlement_loop():
    interval = max(60, int(AUTO_SETTLE_INTERVAL_SECONDS))
    while True:
        time.sleep(interval)
        try:
            blockers = settlement_blockers()
            if blockers:
                _settle_state["reason"] = blockers[0]
                continue
            if not list_unsettled_mintable(limit=1):
                _settle_state["reason"] = "Nothing outstanding."
                continue
            result = settle_batch(limit=AUTO_SETTLE_BATCH)
            _settle_state["last"] = datetime.now().isoformat()
            _settle_state["last_result"] = {k: result[k] for k in
                                            ("settled_count", "failed_count", "remaining")}
            _settle_state["reason"] = ""
            if result["settled_count"]:
                add_log(f"Auto-settlement: {result['settled_count']} minted, "
                        f"{result['remaining']} still outstanding.")
        except Exception as e:                                   # noqa: BLE001
            # A settlement sweep must never take the process down: it runs
            # unattended, and the queue is still there next pass.
            logging.warning("Auto-settlement pass failed: %s", e)
            _settle_state["reason"] = str(e)[:200]


def start_auto_settlement():
    if not ENABLE_AUTO_SETTLEMENT:
        logging.info("Automatic settlement is off (AUTO_SETTLE=0). "
                     "Unsettled records wait for the admin panel.")
        return False
    threading.Thread(target=_settlement_loop, name="auto-settlement", daemon=True).start()
    logging.info("Automatic settlement on: up to %d records every %ds.",
                 AUTO_SETTLE_BATCH, AUTO_SETTLE_INTERVAL_SECONDS)
    return True


class GrantRequest(BaseModel):
    """An owner-issued piQ credit. Amount is bounded at the edge."""
    wallet: str = ""
    orcid: str = ""
    amount: float = 0.0
    reason: str = "Owner grant"


# The ceiling is a guard against a slipped decimal point, not a policy: an
# owner who genuinely wants more can issue two grants, and each one is a
# separate audited row.
MAX_SINGLE_GRANT = 100_000.0


@router.post("/api/admin/grant")
def admin_grant(req: GrantRequest, request: Request, wallet: str = Query(default="")):
    """Credit piQ to an identity. Owner only, and written to the ledger.

    Exists so testing a paid path does not require hand-editing the database.
    A hand-written UPDATE is unattributable, unreversible and easy to get
    subtly wrong — raising `piq_minted` on a paper, for instance, would credit
    the balance AND inflate the corpus emission totals, which are a published
    figure. This writes one ledger row with a reason, which is the same
    mechanism every fee, refund and escrow release already uses.

    `require_owner` demands a session token minted from an EIP-191 signature by
    OWNER_ID. OWNER_ID is public — it is served at /api/chain/status — so a
    query parameter alone would let any reader mint themselves piQ.
    """
    require_owner(request, wallet)

    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="A grant must be a positive amount.")
    if req.amount > MAX_SINGLE_GRANT:
        raise HTTPException(
            status_code=400,
            detail=f"A single grant is capped at {MAX_SINGLE_GRANT:,.0f} piQ. "
                   f"Issue several if you genuinely need more.")

    target_wallet = (req.wallet or "").strip()
    target_orcid = (req.orcid or "").strip()
    if not target_wallet and not target_orcid:
        # Defaulting to the owner's own wallet is the common case — "give me
        # some piQ so I can test" — and saves pasting an address you are
        # already signed in as.
        target_wallet = OWNER_ID or ""
    if not target_wallet and not target_orcid:
        raise HTTPException(status_code=400,
                            detail="No recipient given and OWNER_ID is not configured.")

    result = grant_piq(req.amount, target_wallet, target_orcid,
                       reason=f"Owner grant: {(req.reason or '').strip()[:120]}".strip(": "))
    if not result.get("granted"):
        raise HTTPException(status_code=400, detail=result.get("reason") or "Grant failed.")

    who = result.get("account", "")
    add_log(f"Owner granted {result['granted']:.2f} piQ to {who[:16]}… "
            f"(balance now {result['balance']:.2f}).")
    return {
        **result,
        "message": (f"{result['granted']:.2f} piQ credited to {who}. "
                    f"Balance is now {result['balance']:.2f} piQ. This is a ledger entry — "
                    f"it appears in the fee history and can be reversed with a negative grant."),
    }


def _dir_size(path: str) -> Tuple[int, int]:
    """(bytes, file count) under a directory. Missing directory reads as empty."""
    total = files = 0
    for root, _dirs, names in os.walk(path):
        for n in names:
            try:
                total += os.path.getsize(os.path.join(root, n))
                files += 1
            except OSError:
                continue
    return total, files


def _human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} TB"


def _known_eval_hashes():
    conn = get_db_connection()
    try:
        return {r[0] for r in conn.execute("SELECT eval_hash FROM papers_assessment").fetchall()}
    finally:
        conn.close()


# Lets the paper store evict orphans before assessed manuscripts when it is full.
paper_store.set_known_hashes_provider(_known_eval_hashes)


@router.get("/api/admin/storage")
def storage_report(request: Request, wallet: str = Query(default="")):
    """What is actually using the data volume. Owner only.

    A hosting alert says "the volume is at 88%" and nothing else, which leaves
    an operator guessing between the database, the retained manuscripts and the
    logs — three things with completely different remedies. This measures each,
    and names the one item that is always safe to delete: a stored PDF whose
    assessment no longer exists.
    """
    require_owner(request, wallet)

    db_bytes = 0
    for suffix in ("", "-wal", "-shm"):          # WAL can be larger than the DB
        try:
            db_bytes += os.path.getsize(DB_PATH + suffix)
        except OSError:
            pass

    store_bytes, store_files = _dir_size(paper_store.PAPER_STORE_DIR)
    log_bytes, log_files = _dir_size(os.path.join(BASE_DIR, "logs"))

    # Orphans: a file on disk with no row pointing at it. These accumulate
    # because a paper is stored at UPLOAD time, before the pipeline has decided
    # whether the submission produces a record at all — a duplicate merge, a
    # failed extraction or a refused run all leave the bytes behind.
    orphans, orphan_bytes = [], 0
    try:
        conn = get_db_connection()
        try:
            known = {r[0] for r in conn.execute(
                "SELECT eval_hash FROM papers_assessment").fetchall()}
        finally:
            conn.close()
        for name in os.listdir(paper_store.PAPER_STORE_DIR):
            if not name.endswith(".pdf"):
                continue
            if name[:-4] not in known:
                p = os.path.join(paper_store.PAPER_STORE_DIR, name)
                try:
                    orphan_bytes += os.path.getsize(p)
                except OSError:
                    pass
                orphans.append(name[:-4])
    except Exception as e:                                       # noqa: BLE001
        logging.warning("Orphan scan failed: %s", e)

    try:
        usage = shutil.disk_usage(BASE_DIR)
        disk = {"total": usage.total, "used": usage.used, "free": usage.free,
                "percent_used": round(usage.used / usage.total * 100, 1) if usage.total else None}
    except Exception:                                            # noqa: BLE001
        disk = {}

    # Rows whose payload is a BLOB. The queue is transient by design, so a row
    # still sitting here is a submission that was never drained.
    queue_rows = 0
    try:
        conn = get_db_connection()
        try:
            queue_rows = conn.execute("SELECT COUNT(*) FROM ingestion_queue").fetchone()[0]
        finally:
            conn.close()
    except sqlite3.Error:
        queue_rows = 0

    return {
        "path": BASE_DIR,
        "disk": disk,
        "database": {"bytes": db_bytes, "human": _human(db_bytes),
                     "ingestion_queue_rows": queue_rows},
        "manuscripts": {"bytes": store_bytes, "human": _human(store_bytes),
                        "files": store_files},
        "logs": {"bytes": log_bytes, "human": _human(log_bytes), "files": log_files},
        "orphans": {"count": len(orphans), "bytes": orphan_bytes,
                    "human": _human(orphan_bytes)},
        "manuscript_cap": _cap_report(store_bytes),
        "note": ("Manuscripts are retained so a published assessment can serve the paper it "
                 "assessed. Orphans are stored files with no assessment left — always safe to "
                 "delete. VACUUM reclaims database pages freed by withdrawals; SQLite does not "
                 "return that space to the filesystem on its own."),
    }


def _cap_report(store_bytes: int) -> dict:
    """How close the manuscript store is to its total cap, for the owner panel."""
    cap = paper_store.MAX_TOTAL_BYTES
    if not cap:
        return {"bytes": 0, "human": "none", "percent_used": None, "warning": ""}
    pct = round(store_bytes / cap * 100, 1)
    warning = ""
    if pct >= 80:
        warning = (f"Manuscripts are at {pct}% of their {_human(cap)} cap. Past the cap, new "
                   "uploads evict orphaned files first, then the oldest stored manuscripts, "
                   "whose published papers then lose their file link. Raise "
                   "PAPER_STORE_MAX_TOTAL_BYTES if the volume has room.")
    return {"bytes": cap, "human": _human(cap), "percent_used": pct, "warning": warning}


class CleanupRequest(BaseModel):
    orphans: bool = True
    vacuum: bool = False
    drain_queue: bool = False


@router.post("/api/admin/storage/cleanup")
def storage_cleanup(req: CleanupRequest, request: Request, wallet: str = Query(default="")):
    """Reclaim space. Owner only, and every step is opt-in.

    Nothing here touches a manuscript that still has an assessment. Deleting
    those is a retention POLICY decision — it silently breaks the file link on
    every published paper — so it is deliberately not offered as a button.
    """
    require_owner(request, wallet)
    done = {"orphans_removed": 0, "bytes_freed": 0, "queue_rows_cleared": 0,
            "vacuumed": False}

    if req.orphans:
        try:
            conn = get_db_connection()
            try:
                known = {r[0] for r in conn.execute(
                    "SELECT eval_hash FROM papers_assessment").fetchall()}
            finally:
                conn.close()
            for name in os.listdir(paper_store.PAPER_STORE_DIR):
                if not name.endswith(".pdf") or name[:-4] in known:
                    continue
                p = os.path.join(paper_store.PAPER_STORE_DIR, name)
                try:
                    size = os.path.getsize(p)
                    os.remove(p)
                    done["orphans_removed"] += 1
                    done["bytes_freed"] += size
                except OSError:
                    continue
        except Exception as e:                                   # noqa: BLE001
            logging.warning("Orphan cleanup failed: %s", e)

    if req.drain_queue:
        try:
            conn = get_db_connection()
            try:
                cur = conn.execute("DELETE FROM ingestion_queue")
                done["queue_rows_cleared"] = cur.rowcount or 0
                conn.commit()
            finally:
                conn.close()
        except sqlite3.Error as e:
            logging.warning("Queue drain failed: %s", e)

    if req.vacuum:
        # VACUUM rewrites the database, so it needs free space roughly equal to
        # the current file while it runs. On a volume that is already nearly
        # full that is the one operation most likely to fail — so it runs last,
        # after the deletions above have made room for it.
        try:
            conn = get_db_connection()
            try:
                conn.execute("VACUUM")
                done["vacuumed"] = True
            finally:
                conn.close()
        except sqlite3.Error as e:
            logging.warning("VACUUM failed: %s", e)
            done["vacuum_error"] = str(e)[:200]

    add_log(f"Storage cleanup: {done['orphans_removed']} orphaned files "
            f"({_human(done['bytes_freed'])}), queue rows {done['queue_rows_cleared']}, "
            f"vacuum={done['vacuumed']}.")
    done["human_freed"] = _human(done["bytes_freed"])
    return done


@router.get("/api/admin/settlement")
def settlement_queue(request: Request, wallet: str = Query(default="")):
    """What earned piQ but never reached the chain, and why it can't right now."""
    require_owner(request, wallet)
    pending = list_unsettled_mintable()
    chain = {}
    try:
        chain = get_chain_status() or {}
    except Exception as e:                                       # noqa: BLE001
        chain = {"error": str(e)[:200]}

    blockers = settlement_blockers()

    return {
        "pending": pending,
        "count": len(pending),
        "total_piq": round(sum(p["piq"] for p in pending), 4),
        "chain": chain,
        "blockers": blockers,
        "can_settle": not blockers,
        # So the operator can see the sweep is alive without reading logs.
        "auto": {
            "enabled": bool(ENABLE_AUTO_SETTLEMENT),
            "every_seconds": AUTO_SETTLE_INTERVAL_SECONDS,
            "batch": AUTO_SETTLE_BATCH,
            "last_run": _settle_state.get("last"),
            "last_result": _settle_state.get("last_result"),
            "idle_reason": _settle_state.get("reason"),
        },
        "note": ("These assessments earned piQ against a real wallet, but minting was skipped —"
                 " no contract, no key, no gas, or a provider outage at the time. The piQ was"
                 " earned; the settlement is owed."),
    }


@router.post("/api/admin/settle")
def settle_pending(request: Request, wallet: str = Query(default=""),
                   limit: int = Query(default=10, ge=1, le=100)):
    """Mint the outstanding records, one transaction each.

    Batched with a low default rather than draining the queue in one call: each
    mint costs gas and can fail independently, and a loop that runs for minutes
    inside a request handler will be killed by the proxy halfway through with no
    record of where it stopped. Small batches are resumable by construction.
    """
    require_owner(request, wallet)
    # Same code path the automatic sweep uses, so pressing the button and
    # waiting for the timer cannot behave differently.
    return settle_batch(limit=limit)


@router.get("/api/admin/review-reports")
def admin_review_reports(request: Request, wallet: str = Query(default=""),
                         include_resolved: bool = Query(default=False)):
    """The moderation queue. Operator only."""
    require_owner(request, wallet)
    return {"reports": list_review_reports(include_resolved=include_resolved)}
