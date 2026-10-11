"""routes/chain.py: the chain: contracts, backups, chain status, donations. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.identity import require_owner  # noqa: F401

router = APIRouter()



# ---------------------------------------------------------------------------
# 2b. CHAIN STATUS & DONATIONS
# ---------------------------------------------------------------------------
@router.get("/api/chain/contracts")
def chain_contracts():
    """The on-chain identities this ledger settles against.

    Surfaced so the explorer can show exactly which addresses a record refers
    to, rather than presenting hashes with no way to check where they landed.
    The admin address is derived from the signing key, never the key itself.
    """
    admin_address = None
    if ETH_ADMIN_PRIVATE_KEY:
        try:
            admin_address = w3.eth.account.from_key(ETH_ADMIN_PRIVATE_KEY).address
        except Exception:
            admin_address = None

    def entry(address, label, description, optional=False):
        """One row of the contracts panel, with the address actually validated.

        `configured` previously meant nothing more than "the environment
        variable is non-empty", so a truncated or mistyped address rendered as
        a normal, apparently-working entry with a live explorer link that
        resolves to nothing. Every code path that consumes these addresses
        checks the length and silently returns when it fails, so a typo
        disabled the feature with no message anywhere — the configuration
        looked correct and the feature simply did not happen.

        An address is now reported as valid only if web3 accepts it, and an
        address that is set but invalid says so explicitly. `optional` marks
        the entries a deployment can legitimately leave blank, so "not set" is
        not mistaken for "broken".
        """
        address = (address or "").strip()
        problem = None
        valid = False
        if address:
            try:
                w3.to_checksum_address(address)
                valid = True
            except Exception:
                problem = (
                    f"This is not a valid Ethereum address — it has "
                    f"{len(address.removeprefix('0x'))} hex characters where 40 are required. "
                    f"It is being ignored."
                )
        elif not optional:
            problem = "Not set."

        return {
            "label": label, "address": address or None, "description": description,
            "explorer_url": get_sepolia_explorer_url(address, "address") if valid else None,
            "configured": valid,
            "optional": optional,
            "problem": problem,
            "state": "ok" if valid else ("invalid" if address else "unset"),
        }

    return {
        "network": CHAIN_NAME, "chain_id": CHAIN_ID, "currency": CHAIN_CURRENCY,
        "explorer": BLOCK_EXPLORER_URL,
        "addresses": [
            entry(PIQ_CONTRACT_ADDRESS, "piQ token contract",
                  "Soulbound pi-Quotient token. Receives verifyProofAndMint calls when a "
                  "manuscript clears the minting threshold."),
            # The state registry row is deliberately absent. This deployment
            # has one contract — the piQ token — and a registry entry that is
            # permanently unconfigured is not information, it is a standing
            # invitation to paste the wrong address into it (which is what
            # happened). Encrypted backups are pinned to IPFS and the CID is
            # tracked locally; if a registry contract is deployed later, this
            # is where its row goes back.
            entry(admin_address, "Minting authority",
                  "Wallet that signs minting transactions. Derived from the configured signing "
                  "key; the key itself is never exposed."),
            entry(DONATION_WALLET, "Donation address",
                  "Receives Support & Donate contributions. Confers no piQ and no scoring "
                  "advantage."),
            entry(OWNER_ID, "Owner wallet",
                  "Administrative wallet permitted to re-score the corpus and reset local state."),
        ],
    }


@router.get("/api/backup/status")
def backup_status():
    """Whether durable off-host backup is actually happening.

    Worth surfacing because the failure mode is silent: pinning is best-effort
    and runs on a background thread, so a deployment can look completely
    healthy while storing nothing anywhere but its own ephemeral disk — which
    on a free-tier host is lost on redeploy.
    """
    backups = latest_backups(limit=5)
    configured = ledger_backup.ipfs_backup_available()
    registry = ledger_backup.registry_contract_usable()
    return {
        "configured": configured,
        "backups": backups,
        "last_backup": backups[0] if backups else None,
        "registry": registry,
        "anchoring_enabled": bool(registry.get("usable")),
        "note": (
            "Encrypted snapshots are pinned to IPFS. " + registry["reason"] + " The backup is "
            "durable and restorable either way; on-chain anchoring only adds tamper-evidence."
            if configured and not registry.get("usable") else
            "Encrypted snapshots are pinned to IPFS and their CIDs anchored on-chain."
            if configured else
            "Off-host backup is NOT configured. State exists only on this host's disk, which is "
            "not durable on an ephemeral filesystem. Set PINATA_API_KEY, PINATA_SECRET_API_KEY "
            "and BACKUP_ENCRYPTION_KEY to enable it."
        ),
    }


@router.post("/api/backup/run")
def backup_run(request: Request, wallet: str = Query(default="")):
    """Owner-triggered immediate backup, bypassing the throttle."""
    require_owner(request, wallet)
    result = ledger_backup.run_backup(force=True)
    add_log(f"Manual backup: {result}")
    return result


@router.get("/api/chain/status")
def chain_status():
    """Live Ethereum connectivity, so the UI can tell the user honestly
    whether on-chain minting is actually working right now."""
    status = get_chain_status()
    status["donation_wallet"] = DONATION_WALLET
    return status


@router.get("/api/donate/info")
def donate_info():
    """Where to send a real contribution.

    Reports the DONATION chain, not the ledger chain. The two differ on
    purpose: assessments are anchored on Sepolia because anchoring is free
    there, but SepoliaETH has no value, so soliciting donations on it asked
    people to fund inference credits with test tokens. Every field here is
    namespaced to donation_* so a future edit cannot quietly reconnect this
    endpoint to the settlement chain.
    """
    return {
        "wallet": DONATION_WALLET,
        "chain_id": DONATION_CHAIN_ID,
        "chain_id_hex": hex(DONATION_CHAIN_ID),
        "chain_name": DONATION_CHAIN_NAME,
        "currency": DONATION_CURRENCY,
        "rpc_urls": DONATION_RPC_URLS,
        "explorer_url": f"{DONATION_EXPLORER_URL.rstrip('/')}/address/{DONATION_WALLET}",
        "tx_explorer_base": f"{DONATION_EXPLORER_URL.rstrip('/')}/tx/",
        "is_mainnet": DONATION_CHAIN_ID == 1,
        # Sized for real ETH. The old ladder was denominated in a testnet token
        # that costs nothing, so "0.1" meant nothing; on mainnet it is a
        # meaningful sum and the suggestions have to reflect that.
        "suggested_amounts": ["0.001", "0.005", "0.01", "0.05"],
        "settlement_chain_note": (
            f"Assessments are anchored on {CHAIN_NAME} for provenance. Donations are separate "
            f"and settle on {DONATION_CHAIN_NAME} in {DONATION_CURRENCY}."
        ),
        "message": (
            "ScholarPi is independent, non-commercial research infrastructure. "
            "Contributions fund LLM inference credits, RPC access and hosting."
        ),
    }
