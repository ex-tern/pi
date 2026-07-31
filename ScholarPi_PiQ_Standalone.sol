// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ScholarPi piQ — soulbound contribution token with a state registry.
 * SINGLE FILE. No imports, no npm, no OpenZeppelin. Paste and deploy.
 *
 * WHY A STANDALONE FILE
 * ---------------------
 * The previous version imported OpenZeppelin from npm. That resolves fine in
 * some Remix sessions and fails in others depending on workspace state and
 * network, and a failed import looks like a compiler error rather than a
 * missing dependency. It also complicates Etherscan verification, which wants
 * either an exact compiler+library match or a flattened source.
 *
 * The ERC20 surface actually needed here is small — mint, balances, metadata —
 * because transfers are disabled. Writing those ~60 lines inline removes the
 * entire class of dependency failures and makes verification a single-file
 * paste. For a contract this size that is a better trade than pulling in a
 * general-purpose library whose transfer machinery is deliberately unreachable.
 *
 * WHY IT REPLACES THE UPGRADEABLE VERSION
 * ---------------------------------------
 * The deployed contract at 0x17AF…78A88 is a UUPS *implementation* whose
 * constructor called _disableInitializers(). That is correct practice for an
 * implementation meant to sit behind a proxy — it stops an attacker seizing
 * the logic contract — but no proxy was deployed and the app was pointed
 * straight at the implementation. initialize() therefore reverts
 * unconditionally and permanently: the token has no name, no symbol, and an
 * owner of address(0), so every mint reverts. It cannot be repaired, only
 * replaced.
 *
 * This contract has no initializer at all. Everything is set in the
 * constructor, so it is either fully live or it does not exist.
 *
 * SOULBOUND
 * ---------
 * The app and whitepaper both describe piQ as soulbound; the old contract
 * inherited a stock ERC20 and was freely transferable. piQ records who did
 * assessed work, so a transferable version is tradeable reputation — the
 * opposite of the claim. Transfers, approvals and allowances all revert here,
 * so the code and the documentation agree.
 *
 * DEPLOYMENT (Remix, Sepolia)
 * ---------------------------
 *   1. verifier.sol is already deployed at
 *      0xA2Ef16A2047E71d98EbAAd79D57dEE3b5556AcBb
 *   2. Create a new file in Remix, paste this whole file in, compile with
 *      0.8.20 or newer.
 *   3. Deploy & Run -> Injected Provider (MetaMask on Sepolia)
 *      CONTRACT dropdown -> ScholarPi_PiQ_Token
 *      _verifierAddress = 0xA2Ef16A2047E71d98EbAAd79D57dEE3b5556AcBb
 *      initialOwner     = 0x6B89DD74DCa5d4DC98599206b1c2dE614066ef40
 *   4. Call isReady() -> must return true.
 *   5. Set BOTH PIQ_CONTRACT_ADDRESS and REGISTRY_CONTRACT_ADDRESS to this
 *      contract's address. They are deliberately the same value.
 */

/**
 * @dev Minimal external view of the deployed ZoKrates verifier.
 *
 * The struct layout is byte-identical to verifier.sol's — G1Point{X,Y},
 * G2Point{uint[2] X, uint[2] Y}, Proof{a,b,c}. ABI encoding depends on that
 * layout matching exactly; a reordered or differently-sized field would
 * encode to a different calldata shape and every verification would fail.
 * Declared here rather than imported so this file stands alone.
 */
interface IVerifier {
    struct G1Point {
        uint256 X;
        uint256 Y;
    }
    struct G2Point {
        uint256[2] X;
        uint256[2] Y;
    }
    struct Proof {
        G1Point a;
        G2Point b;
        G1Point c;
    }

    function verifyTx(Proof memory proof, uint256[1] memory input)
        external
        view
        returns (bool);
}

contract ScholarPi_PiQ_Token {
    // ---------------------------------------------------------------------
    // ERC20 metadata and state
    // ---------------------------------------------------------------------
    string public constant name = "Pi Quotient";
    string public constant symbol = "piQ";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    // ---------------------------------------------------------------------
    // Ownership
    // ---------------------------------------------------------------------
    address public owner;

    // ---------------------------------------------------------------------
    // zk-SNARK minting
    // ---------------------------------------------------------------------
    IVerifier public zkVerifier;

    /// Replay protection: one mint per evaluation hash, ever.
    mapping(string => bool) public hasBeenAssessed;

    // ---------------------------------------------------------------------
    // State registry (IPFS backup pointer)
    // ---------------------------------------------------------------------
    string private _stateCID;
    uint256 public cidUpdatedAt;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MintProofVerified(address indexed researcher, uint256 amount, string evalHash);
    event VerifierUpdated(address indexed previousVerifier, address indexed newVerifier);
    event StateCIDUpdated(string cid, uint256 timestamp);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------
    error SoulboundTransferNotAllowed();
    error NotOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _verifierAddress, address initialOwner) {
        if (_verifierAddress == address(0)) revert ZeroAddress();
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        zkVerifier = IVerifier(_verifierAddress);
        emit OwnershipTransferred(address(0), initialOwner);
    }

    // ---------------------------------------------------------------------
    // Soulbound: the ERC20 transfer surface exists only to refuse
    // ---------------------------------------------------------------------
    // These are declared rather than omitted so that wallets and explorers
    // calling them get an explicit revert with a named error, instead of the
    // ambiguous failure of calling a function that does not exist. Refusing
    // loudly is more useful than being silently non-conformant.

    /// @notice piQ is non-transferable. Always reverts.
    function transfer(address, uint256) external pure returns (bool) {
        revert SoulboundTransferNotAllowed();
    }

    /// @notice piQ is non-transferable. Always reverts.
    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert SoulboundTransferNotAllowed();
    }

    /**
     * @notice Approvals are refused, not recorded.
     * @dev An allowance that can never be spent is a promise the contract
     *      cannot keep, and an integrator reading a non-zero allowance would
     *      reasonably conclude a transfer is possible.
     */
    function approve(address, uint256) external pure returns (bool) {
        revert SoulboundTransferNotAllowed();
    }

    /// @notice Always zero: no allowance can ever exist.
    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }

    // ---------------------------------------------------------------------
    // Minting
    // ---------------------------------------------------------------------

    /**
     * @notice Mint piQ against a Groth16 proof that the assessment qualified.
     * @param researcher       Recipient of the minted piQ.
     * @param amountWei        Amount in the smallest unit (18 decimals).
     * @param evalHash         Evaluation hash, used for replay protection.
     * @param truncatedHashInt Public input to the circuit.
     * @param proof            Groth16 proof produced by ZoKrates.
     */
    function verifyProofAndMint(
        address researcher,
        uint256 amountWei,
        string memory evalHash,
        uint256 truncatedHashInt,
        IVerifier.Proof memory proof
    ) public onlyOwner {
        require(bytes(evalHash).length > 0, "Evaluation hash cannot be empty");
        require(!hasBeenAssessed[evalHash], "Manuscript already assessed");
        require(amountWei > 0, "Mint amount must be greater than zero");
        if (researcher == address(0)) revert ZeroAddress();

        uint256[1] memory publicInputs = [truncatedHashInt];
        require(zkVerifier.verifyTx(proof, publicInputs), "ZK proof verification failed");

        // Effects before interactions, and the replay flag before the balance
        // change, so no future modification can mint twice for one evaluation.
        hasBeenAssessed[evalHash] = true;
        totalSupply += amountWei;
        balanceOf[researcher] += amountWei;

        // Mint is signalled as a Transfer from the zero address, which is what
        // every indexer and block explorer expects.
        emit Transfer(address(0), researcher, amountWei);
        emit MintProofVerified(researcher, amountWei, evalHash);
    }

    /**
     * @notice Relinquish your own piQ.
     * @dev The only balance-reducing path. Soulbound should not mean trapped:
     *      a holder who wants the record gone can remove it, but cannot move
     *      it to anyone else.
     */
    function burn(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    /**
     * @notice Point the contract at a newly generated Verifier.
     * @dev The verifying key is compiled into verifier.sol, so regenerating
     *      the circuit produces a new contract. Without this, a circuit change
     *      would strand the token and force a redeployment that destroys every
     *      minted balance.
     */
    function setVerifier(address _verifierAddress) external onlyOwner {
        if (_verifierAddress == address(0)) revert ZeroAddress();
        emit VerifierUpdated(address(zkVerifier), _verifierAddress);
        zkVerifier = IVerifier(_verifierAddress);
    }

    // ---------------------------------------------------------------------
    // State registry
    // ---------------------------------------------------------------------

    /**
     * @notice Anchor the IPFS CID of the latest encrypted state backup.
     * @dev The CID points at ciphertext — the backup is encrypted before it
     *      leaves the server — so publishing it reveals that a backup exists
     *      and when, but not its contents.
     */
    function updateCID(string calldata cid) external onlyOwner {
        require(bytes(cid).length > 0, "CID cannot be empty");
        _stateCID = cid;
        cidUpdatedAt = block.timestamp;
        emit StateCIDUpdated(cid, block.timestamp);
    }

    /// @notice The most recently anchored backup CID, or an empty string.
    function getCID() external view returns (string memory) {
        return _stateCID;
    }

    // ---------------------------------------------------------------------
    // Ownership
    // ---------------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------------------------------------------------------------------
    // Introspection
    // ---------------------------------------------------------------------

    /**
     * @notice True when this contract is live and correctly constructed.
     * @dev The app probes deployments before trusting them. An uninitialized
     *      proxy implementation returns empty metadata and a zero owner while
     *      still having bytecode, which is indistinguishable from a healthy
     *      contract to anything that only checks that code exists.
     */
    function isReady() external view returns (bool) {
        return owner != address(0) && address(zkVerifier) != address(0);
    }
}
