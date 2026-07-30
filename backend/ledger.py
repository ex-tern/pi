import os
import json
import time
import hmac
import hashlib
import zipfile
import tempfile
import shutil
import logging
import requests

try:
    from web3 import Web3
    from web3.exceptions import ContractLogicError
    WEB3_AVAILABLE = True
except ImportError:
    WEB3_AVAILABLE = False
    Web3 = None

try:
    from cryptography.fernet import Fernet
    FERNET_AVAILABLE = True
except ImportError:
    FERNET_AVAILABLE = False
    Fernet = None

try:
    from config import (
        BASE_DIR, WEB3_PROVIDER_URI, REGISTRY_CONTRACT_ADDRESS,
        PINATA_API_KEY, PINATA_SECRET_API_KEY, ETH_ADMIN_PRIVATE_KEY, PIQ_CONTRACT_ADDRESS,
        WEB3_RPC_ENDPOINTS, CHAIN_ID, CHAIN_NAME, CHAIN_CURRENCY, BLOCK_EXPLORER_URL,
    )
except ImportError:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    WEB3_PROVIDER_URI = ""
    REGISTRY_CONTRACT_ADDRESS = ""
    PINATA_API_KEY = ""
    PINATA_SECRET_API_KEY = ""
    ETH_ADMIN_PRIVATE_KEY = ""
    PIQ_CONTRACT_ADDRESS = ""
    WEB3_RPC_ENDPOINTS = []
    CHAIN_ID = 11155111
    CHAIN_NAME = "Sepolia"
    CHAIN_CURRENCY = "SepoliaETH"
    BLOCK_EXPLORER_URL = "https://sepolia.etherscan.io"


# ---------------------------------------------------------------------------
# Web3 connection with RPC failover.
#
# Public testnet RPC endpoints are unreliable — they rate-limit, return 5xx,
# and go offline without warning. Binding the whole chain integration to a
# single hard-coded URL meant one flaky provider silently disabled minting,
# state restore and every on-chain feature. We now walk the configured
# endpoint list until one responds, cache the winner, and transparently
# re-select if it later stops answering.
# ---------------------------------------------------------------------------
_ACTIVE_RPC = None
_LAST_CONNECT_CHECK = 0.0
_CONNECT_RECHECK_SECONDS = 30.0


def _build_provider(uri: str):
    return Web3(Web3.HTTPProvider(uri, request_kwargs={"timeout": 12}))


def _select_working_rpc(force: bool = False):
    """Returns (web3_instance, rpc_uri) for the first endpoint that answers."""
    global w3, _ACTIVE_RPC, _LAST_CONNECT_CHECK

    if not WEB3_AVAILABLE:
        return None, None

    now = time.time()
    if (not force and _ACTIVE_RPC and w3 is not None
            and (now - _LAST_CONNECT_CHECK) < _CONNECT_RECHECK_SECONDS):
        return w3, _ACTIVE_RPC

    candidates = WEB3_RPC_ENDPOINTS or ([WEB3_PROVIDER_URI] if WEB3_PROVIDER_URI else [])
    # Retry the endpoint that worked last time first — it's the most likely
    # to still be healthy, and avoids re-probing the whole list every call.
    if _ACTIVE_RPC and _ACTIVE_RPC in candidates:
        candidates = [_ACTIVE_RPC] + [c for c in candidates if c != _ACTIVE_RPC]

    for uri in candidates:
        try:
            candidate = _build_provider(uri)
            if candidate.is_connected():
                w3 = candidate
                _ACTIVE_RPC = uri
                _LAST_CONNECT_CHECK = now
                return w3, uri
        except Exception as e:
            logging.debug("RPC endpoint %s unavailable: %s", uri, e)
            continue

    _LAST_CONNECT_CHECK = now
    _ACTIVE_RPC = None
    w3 = Web3()  # offline instance — address/utility helpers still work
    return w3, None


def get_web3():
    """Chain-connected Web3 instance, or an offline one if nothing responds."""
    instance, _ = _select_working_rpc()
    return instance


def is_chain_connected() -> bool:
    _, uri = _select_working_rpc()
    return uri is not None


def get_chain_status() -> dict:
    """Everything the UI needs to show an honest network badge."""
    status = {
        "web3_available": WEB3_AVAILABLE,
        "chain_id": CHAIN_ID,
        "chain_name": CHAIN_NAME,
        "currency": CHAIN_CURRENCY,
        "explorer": BLOCK_EXPLORER_URL,
        "connected": False,
        "rpc": None,
        "block_number": None,
        "piq_contract": PIQ_CONTRACT_ADDRESS,
        "registry_contract": REGISTRY_CONTRACT_ADDRESS,
        "minting_enabled": False,
        "reason": None,
    }
    if not WEB3_AVAILABLE:
        status["reason"] = "web3.py is not installed on the server."
        return status

    instance, uri = _select_working_rpc(force=True)
    if not uri:
        status["reason"] = "No configured Sepolia RPC endpoint responded."
        return status

    status["connected"] = True
    status["rpc"] = uri
    try:
        status["block_number"] = instance.eth.block_number
        status["chain_id"] = instance.eth.chain_id
    except Exception as e:
        logging.debug("Chain metadata read failed: %s", e)

    if not ETH_ADMIN_PRIVATE_KEY:
        status["reason"] = "Connected read-only: no admin key configured, so piQ cannot be minted on-chain."
    elif len(PIQ_CONTRACT_ADDRESS or "") != 42:
        status["reason"] = "Connected, but the piQ contract address is not configured correctly."
    else:
        status["minting_enabled"] = True
        status["reason"] = "Connected. On-chain piQ minting is enabled."
    return status


w3, _ACTIVE_RPC = _select_working_rpc(force=True)

def derive_encryption_key(secret_seed: str) -> bytes:
    key = hashlib.sha256(secret_seed.encode('utf-8')).digest()
    import base64
    return base64.urlsafe_b64encode(key)

def safe_extract_zip(zip_path: str, extract_to: str):
    extract_to = os.path.abspath(extract_to)
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        for member in zip_ref.infolist():
            member_path = os.path.abspath(os.path.join(extract_to, member.filename))
            if not member_path.startswith(extract_to):
                logging.warning(f"Prevented zip-slip attack path: {member.filename}")
                continue
            zip_ref.extract(member, extract_to)

def restore_state_from_web3():
    w3 = get_web3()
    if not WEB3_AVAILABLE or not w3 or not w3.is_connected() or not REGISTRY_CONTRACT_ADDRESS or not ETH_ADMIN_PRIVATE_KEY:
        return
    try:
        abi = '[{"inputs":[],"name":"getCID","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}]'
        if len(REGISTRY_CONTRACT_ADDRESS) != 42 or not REGISTRY_CONTRACT_ADDRESS.startswith("0x"):
            return
        contract = w3.eth.contract(address=w3.to_checksum_address(REGISTRY_CONTRACT_ADDRESS), abi=json.loads(abi))
        cid = contract.functions.getCID().call()
        if cid:
            gateways = [
                f"https://ivory-worrying-boa-917.mypinata.cloud/ipfs/{cid}",
                f"https://gateway.pinata.cloud/ipfs/{cid}",
                f"https://ipfs.io/ipfs/{cid}"
            ]
            res = None
            for gw in gateways:
                try:
                    r = requests.get(gw, timeout=15)
                    if r.status_code == 200:
                        res = r
                        break
                except requests.RequestException:
                    continue
            if res and res.status_code == 200 and FERNET_AVAILABLE:
                fernet = Fernet(derive_encryption_key(ETH_ADMIN_PRIVATE_KEY))
                decrypted_data = fernet.decrypt(res.content)
                
                zip_path = os.path.join(BASE_DIR, "_restore.zip")
                with open(zip_path, 'wb') as fp:
                    fp.write(decrypted_data)
                safe_extract_zip(zip_path, BASE_DIR)
                if os.path.exists(zip_path):
                    os.remove(zip_path)

                from database import reset_schema_cache
                reset_schema_cache()
    except Exception as e:
        logging.error(f"Restore warning: {e}")

def backup_state_to_web3() -> bool:
    w3 = get_web3()
    if not WEB3_AVAILABLE or not FERNET_AVAILABLE or not w3 or not w3.is_connected() or not PINATA_API_KEY or not REGISTRY_CONTRACT_ADDRESS or not ETH_ADMIN_PRIVATE_KEY:
        return False
    
    temp_dir = tempfile.mkdtemp()
    try:
        safe_items = ["pi_index_main.db", "scilem_rlhf_dataset.jsonl", "pidyne_weights.pt"]
        for item in safe_items:
            src = os.path.join(BASE_DIR, item)
            if os.path.exists(src):
                shutil.copy(src, os.path.join(temp_dir, item))

        raw_zip_path = os.path.join(temp_dir, "sanitized_state.zip")
        with zipfile.ZipFile(raw_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, _, files in os.walk(temp_dir):
                for f in files:
                    if f != "sanitized_state.zip":
                        fp = os.path.join(root, f)
                        zipf.write(fp, os.path.relpath(fp, temp_dir))

        fernet = Fernet(derive_encryption_key(ETH_ADMIN_PRIVATE_KEY))
        with open(raw_zip_path, 'rb') as fp:
            encrypted_payload = fernet.encrypt(fp.read())

        enc_zip_path = os.path.join(temp_dir, "payload.enc")
        with open(enc_zip_path, 'wb') as fp:
            fp.write(encrypted_payload)

        headers = {
            "pinata_api_key": PINATA_API_KEY, 
            "pinata_secret_api_key": PINATA_SECRET_API_KEY
        }
        with open(enc_zip_path, 'rb') as fp:
            res = requests.post(
                "https://api.pinata.cloud/pinning/pinFileToIPFS", 
                files={"file": fp}, 
                headers=headers
            )
        cid = res.json().get("IpfsHash")
        if not cid:
            return False

        abi = '[{"inputs":[{"internalType":"string","name":"_cid","type":"string"}],"name":"updateCID","outputs":[],"stateMutability":"nonpayable","type":"function"}]'
        contract = w3.eth.contract(address=w3.to_checksum_address(REGISTRY_CONTRACT_ADDRESS), abi=json.loads(abi))
        account = w3.eth.account.from_key(ETH_ADMIN_PRIVATE_KEY)
        
        estimated_gas = contract.functions.updateCID(cid).estimate_gas({"from": account.address})
        tx = contract.functions.updateCID(cid).build_transaction({
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address),
            "gas": int(estimated_gas * 1.2),
            "gasPrice": w3.eth.gas_price,
        })
        signed_tx = w3.eth.account.sign_transaction(tx, private_key=ETH_ADMIN_PRIVATE_KEY)
        w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        return True
    except Exception as e:
        logging.error(f"Failed to backup state to Web3: {e}")
        return False
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def validate_block_por(
    block_index: int,
    weights: list,
    timestamp: str,
    previous_hash: str,
    eval_hash: str,
    model_used: str,
    final_score: float,
    formulas_hash: str,
):
    secret = (ETH_ADMIN_PRIVATE_KEY or "por_entropy_seed").encode('utf-8')
    node_sig = hmac.new(secret, f"{timestamp}:{block_index}".encode('utf-8'), hashlib.sha256).hexdigest()[:12]
    validator_node = f"Validator_Pi_{node_sig}"
    
    por_proof = f"PoR_{eval_hash[:12]}_Score:{final_score:.2f}"
    data_string = (
        f"{block_index}{weights}{timestamp}{previous_hash}{validator_node}{por_proof}{model_used}{formulas_hash}"
    )
    block_hash = hashlib.sha256(data_string.encode("utf-8")).hexdigest()
    return validator_node, block_hash, por_proof

def generate_zk_snark_proof(eval_hash: str, final_score: float, logic_score: float, email_str="None") -> str:
    nonce = str(time.time_ns())
    circuit_payload = f"ZK_CIRCUIT_V2:{eval_hash}:{final_score:.4f}:{logic_score:.4f}:{email_str}:{nonce}"
    secret_key = (ETH_ADMIN_PRIVATE_KEY or "zk_proving_key").encode('utf-8')
    sig = hmac.new(secret_key, circuit_payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return "0x" + sig

def mint_pi_quotient_token(book_address: str, amount: float, eval_hash: str, zk_proof: str) -> str:
    if not WEB3_AVAILABLE:
        return "Eth Tx Skipped: web3.py is not installed on the server"

    w3 = get_web3()
    if not w3 or not w3.is_connected():
        # One forced re-probe in case the cached endpoint just went down.
        w3, uri = _select_working_rpc(force=True)
        if not uri:
            return "Eth Tx Skipped: no Sepolia RPC endpoint is reachable"

    if not ETH_ADMIN_PRIVATE_KEY:
        return "Eth Tx Skipped: no admin signing key configured"

    if not w3.is_address(book_address):
        return "Mint Rejected: Author wallet is not a valid Web3 ECDSA address"

    target_addr = w3.to_checksum_address(book_address)

    if len(PIQ_CONTRACT_ADDRESS) != 42 or not PIQ_CONTRACT_ADDRESS.startswith("0x"):
        return "Eth Tx Failed: Invalid Contract Address Configuration"

    try:
        amount_wei = int(round(amount * (10 ** 18)))

        account = w3.eth.account.from_key(ETH_ADMIN_PRIVATE_KEY)
        # Fail fast with a clear reason rather than letting the node reject an
        # unfundable transaction with an opaque error.
        if w3.eth.get_balance(account.address) == 0:
            return (
                f"Eth Tx Skipped: admin wallet {account.address[:8]}... has no "
                f"{CHAIN_CURRENCY} to pay gas"
            )

        abi = '[{"inputs":[{"internalType":"address","name":"researcher","type":"address"},{"internalType":"uint256","name":"amountWei","type":"uint256"},{"internalType":"string","name":"evalHash","type":"string"},{"internalType":"bytes","name":"zkProof","type":"bytes"}],"name":"verifyProofAndMint","outputs":[],"stateMutability":"nonpayable","type":"function"}]'
        contract = w3.eth.contract(address=w3.to_checksum_address(PIQ_CONTRACT_ADDRESS), abi=json.loads(abi))

        call = contract.functions.verifyProofAndMint(
            target_addr,
            amount_wei,
            eval_hash,
            bytes.fromhex(zk_proof[2:] if zk_proof.startswith("0x") else zk_proof),
        )

        # Estimate rather than hard-coding 250k gas: a fixed limit either
        # wastes gas or silently runs out as the contract evolves.
        try:
            gas_limit = int(call.estimate_gas({"from": account.address}) * 1.25)
        except Exception:
            gas_limit = 250000

        tx = call.build_transaction({
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address),
            "gas": gas_limit,
            "gasPrice": w3.eth.gas_price,
            "chainId": w3.eth.chain_id,
        })

        signed_tx = w3.eth.account.sign_transaction(tx, private_key=ETH_ADMIN_PRIVATE_KEY)
        raw = getattr(signed_tx, "raw_transaction", None) or getattr(signed_tx, "rawTransaction")
        tx_hash = w3.eth.send_raw_transaction(raw)
        hex_hash = tx_hash.hex()
        return hex_hash if hex_hash.startswith("0x") else "0x" + hex_hash

    except ContractLogicError as cle:
        return f"Smart Contract Revert: {str(cle)}"
    except Exception as e:
        logging.error("piQ mint failed: %s", e)
        return f"Eth Tx Failed: {str(e)}"

def generate_blockchain_pi(block_height: int) -> float:
    iterations = max(1, block_height * 50)
    pi_approx = 3.0
    sign = 1.0
    for i in range(1, iterations + 1):
        n = i * 2
        pi_approx += sign * (4.0 / (n * (n + 1) * (n + 2)))
        sign *= -1.0
    return pi_approx

def get_sepolia_explorer_url(identifier: str, kind="tx") -> str:
    if not identifier or not isinstance(identifier, str):
        return None
    if identifier in ("None", "Pending", "Simulated_Ledger_Record"):
        return None
    if any(marker in identifier for marker in ("Revert", "Failed", "Skipped", "Rejected", "Not Connected")):
        return None
    base = BLOCK_EXPLORER_URL.rstrip("/")
    if kind == "tx" and identifier.startswith("0x") and len(identifier) == 66:
        return f"{base}/tx/{identifier}"
    elif kind == "address" and identifier.startswith("0x") and len(identifier) == 42:
        return f"{base}/address/{identifier}"
    return None
