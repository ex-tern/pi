"""routes/piq.py: piQ: balances, the ledger, fees and settlement state. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403

router = APIRouter()



def count_assessed_papers() -> int:
    conn = get_db_connection()
    try:
        return conn.execute("SELECT COUNT(*) FROM papers_assessment").fetchone()[0] or 0
    finally:
        conn.close()


# One definition of "what this paper earned", used by every table.
#
# Papers carry piQ in two states: `piq_minted` (released to a verified author)
# and `piq_escrowed` (earned but held, because authorship is unverified). Each
# table used to pick one of them, so the same paper read 8.33 in the history,
# 0.00 in the Top Papers board, and something else again in the journal — three
# numbers, all sourced honestly, none agreeing.
#
# TOTAL is what a table shows: earned is a fact about the work. Whether it has
# been released is a fact about an account, and travels alongside as `piq_held`
# so a reader can still tell the two apart.
#
# The total therefore includes escrowed piQ WHETHER OR NOT it has been claimed.
# It previously dropped the escrowed part the moment the author claimed it, so
# verifying your own authorship made your paper's piQ fall by exactly the
# amount you had just been credited, and the paper slid down — sometimes off —
# every board ranked on piQ. Claiming is a movement between two states of the
# same award; it does not un-earn anything. `piq_held` (unclaimed) and
# `piq_claimed` (released) split the escrow, and always sum back to it.
PIQ_TOTAL_SQL = "(COALESCE(piq_minted, 0) + COALESCE(piq_escrowed, 0))"

def piq_fields(minted, escrowed, claimed_at) -> dict:
    """The figures every table reports, from the three stored columns.

    `piq` is stable across a claim; `piq_held` and `piq_claimed` are what move.
    """
    m = round(safe_float(minted, 0.0), 4)
    e = round(safe_float(escrowed, 0.0), 4)
    held = 0.0 if claimed_at else e
    return {"piq": round(m + e, 4), "piq_minted": m, "piq_held": held,
            "piq_claimed": round(e - held, 4)}


ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def is_tx_hash(tx) -> bool:
    """A real transaction hash, as opposed to a stored failure message.

    `tx_hash` is overloaded: on a successful mint it holds the hash, and on a
    skip it holds the REASON as plain text ("Eth Tx Skipped: no admin signing
    key configured"). Anything that is not 0x + 64 hex is therefore an
    explanation, not a settlement.
    """
    return bool(tx and isinstance(tx, str) and tx.startswith("0x") and len(tx) == 66)


def settlement_state(tx, wallet, minted) -> dict:
    """What the Settlement column should say, and why.

    Three states, because two were hiding a real distinction. A paper assessed
    for an author who never connected a wallet has nowhere to settle TO — it is
    finished, and "Local" is the whole truth. A paper with a wallet and minted
    piQ whose transaction never landed is a debt the deployment owes, and it
    was rendering identically to the first. An operator reading that column
    could not tell a healthy corpus from a stalled settlement queue.
    """
    if is_tx_hash(tx):
        return {"state": "on-chain", "label": "On-chain",
                "note": "Minted on the settlement chain. Opens the transaction."}

    has_wallet = bool(wallet) and str(wallet) not in ("", "None", ZERO_ADDRESS)
    if has_wallet and safe_float(minted, 0.0) > 0:
        # The stored text IS the reason it did not settle, so it is passed
        # through rather than replaced with a generic message.
        reason = str(tx or "").strip()
        generic = ("This assessment earned piQ against a connected wallet, but the mint has not "
                   "landed yet. It is queued and will be retried.")
        return {"state": "pending", "label": "Pending",
                "note": f"{generic} Last attempt: {reason[:160]}" if reason and reason != "Simulated_Ledger_Record"
                        else generic}

    return {"state": "local", "label": "Local",
            "note": ("Recorded in the Proof-of-Research ledger only. No wallet is attached to "
                     "this assessment, so there is nothing to settle on-chain — this is the "
                     "finished state for it, not a pending one.")}


def require_affordable(bal: dict, fee: float, what: str) -> None:
    """Refuse an action the caller cannot pay for, and say why in full.

    Three endpoints repeated this block verbatim — publishing, peer review and
    LLM review — differing only in the noun. Repetition here is worse than
    ordinary duplication: the message explains HELD piQ and how to release it,
    which is the single most confusing thing about the balance, so three copies
    meant three chances for that explanation to drift or be dropped.
    """
    if bal["balance"] + 1e-9 >= fee:
        return
    raise HTTPException(
        status_code=402,
        detail=(f"{what} costs {fee:.2f} piQ and your balance is {bal['balance']:.2f} piQ."
                + (f" You have {bal['held']:.2f} piQ held against papers whose authorship is"
                   f" not yet verified — claim those first and this becomes affordable."
                   if bal.get("held") else
                   " Have your own work assessed to earn piQ.")))


def resolve_active_fee() -> float:
    """Processing fee at the corpus's current difficulty epoch."""
    return compute_processing_fee(count_assessed_papers(), PIQ_PROCESSING_FEE)


def normalize_identity(wallet: Optional[str], orcid: Optional[str]):
    clean_wallet = w3.to_checksum_address(wallet) if wallet and w3.is_address(wallet) else ""
    return clean_wallet, (orcid or "").strip()


@router.get("/api/user/piq-total")
def user_piq_total(request: Request, wallet: Optional[str] = None,
                   orcid: Optional[str] = None):
    """Lifetime piQ awarded, plus the fee-adjusted spendable balance the
    assessment pipeline actually charges against.

    When a signed session exists it is the authority on WHICH accounts are
    yours, overriding the wallet/orcid parameters. Those parameters come from
    the browser's localStorage and can name an identity the session does not
    prove — so a user who had linked ORCID and later signed a wallet was shown
    the sum of both accounts here while every spending path charged against the
    session's narrower identity alone. The displayed balance and the spendable
    balance have to be the same number computed the same way, or the interface
    is lying about money.
    """
    claimed_wallet, claimed_orcid = normalize_identity(wallet, orcid)
    identity = auth.identity_from_request(request, wallet or "", orcid or "")
    # An identity the browser remembers but the session does not prove. Reported
    # so the interface can say "re-link ORCID to reach that piQ" instead of the
    # balance quietly dropping with no explanation.
    unproven = []
    if identity["verified"] and (identity["wallet"] or identity["orcid"]):
        if claimed_orcid and not identity["orcid"]:
            unproven.append("orcid")
        if claimed_wallet and not identity["wallet"]:
            unproven.append("wallet")
        wallet, orcid = identity["wallet"], identity["orcid"]
    clean_wallet, clean_orcid = normalize_identity(wallet, orcid)
    if not clean_wallet and not clean_orcid:
        return {
            "total_piq": 0.0, "minted": 0.0, "fees_paid": 0.0, "balance": 0.0,
            "fee_per_paper": resolve_active_fee(), "papers_affordable": 0,
        }
    # A verified ORCID earns a one-time onboarding stake, so the free tier is
    # an on-ramp rather than a wall for researchers without existing piQ.
    if clean_orcid and not has_received_grant(clean_wallet, clean_orcid):
        if award_onboarding_grant(NEW_PARTICIPANT_GRANT, clean_wallet, clean_orcid):
            add_log(f"Onboarding grant of {NEW_PARTICIPANT_GRANT} piQ issued to {clean_orcid}.")

    bal = get_piq_balance(clean_wallet, clean_orcid)
    # Rewards (arcade wins, bounties, grants, refunds) are ledger credits and
    # are NOT part of `minted`, which counts only piQ minted against an assessed
    # manuscript. Reported separately so the interface can show total piQ earned
    # rather than implying assessment is the only way to earn it.
    rewards = get_piq_rewards_total(clean_wallet, clean_orcid)
    fee = resolve_active_fee()
    return {
        "total_piq": bal["minted"],
        "held": bal.get("held", 0.0),
        "minted": bal["minted"],
        "rewards": rewards,
        "earned": round(bal["minted"] + rewards, 4),
        "fees_paid": bal["fees_paid"],
        "balance": bal["balance"],
        "fee_per_paper": fee,
        "papers_affordable": int(bal["balance"] // fee) if fee > 0 else 0,
        "unproven": unproven,
        "unproven_note": (
            f"This browser remembers {' and '.join(unproven)} that your current sign-in does "
            f"not prove, so any piQ held there is not counted or spendable. Re-link it to "
            f"bring it back." if unproven else ""),
    }


@router.get("/api/user/piq-ledger")
def user_piq_ledger(wallet: Optional[str] = None, orcid: Optional[str] = None):
    clean_wallet, clean_orcid = normalize_identity(wallet, orcid)
    if not clean_wallet and not clean_orcid:
        return {"entries": []}
    return {"entries": get_piq_fee_history(clean_wallet, clean_orcid)}
