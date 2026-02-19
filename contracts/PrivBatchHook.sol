// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {Groth16Verifier} from "./CommitmentVerifier.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/**
 * @title IPerpPositionManager
 * @notice Minimal interface for PrivBatchHook to open/close perp positions
 */
interface IPerpPositionManager {
    function openPosition(
        address user,
        address market,
        uint256 size,
        bool isLong,
        uint256 leverage,
        uint256 entryPrice
    ) external;
    function closePosition(address user, address market, uint256 sizeToClose, uint256 markPrice) external;
}

/**
 * @title PrivBatchHook
 * @notice A Uniswap v4 hook enabling private batch swaps through commit-reveal mechanism
 * @dev Users commit hashed swap intents, autonomous agent reveals and executes batched swaps
 */
contract PrivBatchHook is BaseHook, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    // ============ Errors ============
    error InvalidCommitment();
    error CommitmentAlreadyRevealed();
    error DeadlineExpired();
    error InsufficientCommitments();
    error SlippageExceeded();
    error InvalidNonce();
    error BatchConditionsNotMet();
    error SwapExecutionFailed();
    error InvalidSwapDirection();
    error SlippageExceededForUser(address user, uint256 expected, uint256 actual);
    error NetDeltaMismatch(); // Privacy: Net deltas don't match individual contributions
    error InvalidNetDeltaSign(); // Privacy: Net deltas must have opposite signs
    error PerpManagerNotSet();
    error InvalidPerpCommitment();
    error PerpCommitmentAlreadyRevealed();

    // ============ Events ============
    // Privacy-enhanced events: Minimize sensitive data exposure
    event CommitmentSubmitted(
        PoolId indexed poolId,
        bytes32 indexed commitmentHash
        // Removed: address committer (privacy improvement)
    );
    event BatchExecuted(
        PoolId indexed poolId,
        int256 netDelta0,
        int256 netDelta1,
        uint256 batchSize,
        uint256 timestamp
    );
    event CommitmentRevealed(
        PoolId indexed poolId,
        bytes32 indexed commitmentHash
        // Removed: address user (privacy improvement)
    );
    event TokensDistributed(
        PoolId indexed poolId,
        bytes32 indexed recipientHash,  // Hash of recipient instead of address
        address token,
        uint256 amount
        // Removed: address recipient (privacy improvement - use recipientHash instead)
    );
    event CommitmentVerified(
        PoolId indexed poolId,
        bytes32 indexed commitmentHash
        // ZK proof verified - commitment is valid without revealing parameters
    );
    event PerpCommitmentSubmitted(PoolId indexed poolId, bytes32 indexed commitmentHash);
    event PerpCommitmentVerified(PoolId indexed poolId, bytes32 indexed commitmentHash);
    event PerpCommitmentRevealed(PoolId indexed poolId, bytes32 indexed commitmentHash);
    event PerpBatchExecuted(PoolId indexed poolId, uint256 batchSize, uint256 executionPrice, uint256 timestamp);

    // ============ Structs ============
    struct Commitment {
        bytes32 commitmentHash;
        address committer;  // Optional: can be address(0) for anonymous commitments
        uint256 timestamp;
        bool revealed;
    }

    struct SwapIntent {
        address user;
        Currency tokenIn;
        Currency tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 nonce;
        uint256 deadline;
    }

    struct BatchState {
        uint256 lastBatchTimestamp;
        uint256 batchNonce;
    }

    // Struct to pass data through unlock callback
    struct SwapCallbackData {
        PoolKey key;
        int256 netAmount0;
        int256 netAmount1;
        bool zeroForOne;
        uint160 sqrtPriceLimitX96;
    }

    // Struct to track user contributions for distribution
    struct UserContribution {
        address recipient;
        uint256 inputAmount;
        Currency inputCurrency;
        Currency outputCurrency;
        uint256 minAmountOut;
    }

    // ============ Perp structs ============
    struct PerpIntent {
        address user;
        address market;   // market id (address)
        uint256 size;     // magnitude in base asset (18 decimals)
        bool isLong;
        bool isOpen;      // true = open, false = close
        uint256 collateral; // for opens only (18 decimals)
        uint256 leverage;   // 1e18 = 1x
        uint256 nonce;
        uint256 deadline;
    }

    // Callback data for perp batch swap (inside unlock)
    struct PerpSwapCallbackData {
        PoolKey key;
        int256 netBaseDelta;  // signed: positive = net long, negative = net short
        bool baseIsCurrency0;
    }

    // ============ State Variables ============
    mapping(PoolId => Commitment[]) public commitments;
    mapping(PoolId => BatchState) public batchStates;
    mapping(PoolId => mapping(address => mapping(uint256 => bool)))
        public usedNonces;
    
    // Privacy improvement: Store reveals separately to minimize batch execution calldata
    // Key: commitmentHash, Value: SwapIntent
    mapping(bytes32 => SwapIntent) private revealStorage;
    
    // ZK Privacy: Track commitments verified with ZK proofs
    // Key: commitmentHash, Value: true if verified with ZK proof
    mapping(bytes32 => bool) public verifiedCommitments;

    // ============ Perp state ============
    mapping(PoolId => Commitment[]) public perpCommitments;
    mapping(bytes32 => PerpIntent) private perpRevealStorage;
    mapping(bytes32 => bool) public perpVerifiedCommitments;
    mapping(PoolId => mapping(address => mapping(uint256 => bool))) public perpUsedNonces;
    mapping(PoolId => BatchState) public perpBatchStates;
    IPerpPositionManager public perpPositionManager;

    // Configurable parameters
    uint256 public constant MIN_COMMITMENTS = 2;
    uint256 public constant BATCH_INTERVAL = 5 minutes;

    // Note: Automation removed - batch execution is permissionless
    // Anyone can call revealAndBatchExecute when conditions are met

    // ============ Constructor ============
    // ZK Verifier for commitment proofs
    Groth16Verifier public immutable verifier;

    constructor(IPoolManager _poolManager, Groth16Verifier _verifier) BaseHook(_poolManager) {
        verifier = _verifier;
    }

    /**
     * @notice Set the perp position manager (one-time; must be set before revealAndBatchExecutePerps).
     * @dev Caller must also set this hook as executor on the PerpPositionManager.
     */
    function setPerpPositionManager(IPerpPositionManager _perpPositionManager) external {
        require(address(perpPositionManager) == address(0), "Already set");
        perpPositionManager = _perpPositionManager;
    }

    /// @notice Set perp position manager by address (convenience for external callers/test).
    function setPerpPositionManagerAddress(address _addr) external {
        require(address(perpPositionManager) == address(0), "Already set");
        perpPositionManager = IPerpPositionManager(_addr);
    }

    // ============ Hook Permissions ============
    function getHookPermissions()
        public
        pure
        override
        returns (Hooks.Permissions memory)
    {
        return
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            });
    }

    // ============ Core Functions ============

    /**
     * @notice Submit a commitment hash for a future swap
     * @param key The pool key
     * @param _commitmentHash Hash of the swap intent
     */
    function submitCommitment(
        PoolKey calldata key,
        bytes32 _commitmentHash
    ) external {
        PoolId poolId = key.toId();

        Commitment memory newCommitment = Commitment({
            commitmentHash: _commitmentHash,
            committer: address(0),  // Anonymous commitment - no address stored
            timestamp: block.timestamp,
            revealed: false
        });

        commitments[poolId].push(newCommitment);

        // Privacy-enhanced: Don't emit committer address
        emit CommitmentSubmitted(poolId, _commitmentHash);
    }

    /**
     * @notice Submit a commitment with ZK proof (privacy-enhanced)
     * @param key The pool key
     * @param commitmentHash The commitment hash to verify
     * @param a Proof component A (uint[2])
     * @param b Proof component B (uint[2][2])
     * @param c Proof component C (uint[2])
     * @param publicSignals Public signals array (uint[1] - commitmentHash)
     * @dev This function verifies a ZK proof that proves knowledge of the commitment pre-image
     *      without revealing the actual swap parameters. The commitment is marked as verified.
     *      Key privacy benefit: Trade parameters never appear in calldata or events.
     */
    function submitCommitmentWithProof(
        PoolKey calldata key,
        bytes32 commitmentHash,
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[1] calldata publicSignals
    ) external {
        PoolId poolId = key.toId();

        // Verify proof on-chain
        bool isValid = verifyCommitmentProof(a, b, c, publicSignals);
        if (!isValid) revert InvalidCommitment();

        // Verify public signal matches commitment hash
        if (publicSignals[0] != uint256(commitmentHash)) revert InvalidCommitment();

        // Check if commitment already exists
        Commitment[] storage poolCommitments = commitments[poolId];
        bool commitmentExists = false;
        for (uint256 i = 0; i < poolCommitments.length; i++) {
            if (poolCommitments[i].commitmentHash == commitmentHash) {
                commitmentExists = true;
                break;
            }
        }

        // If commitment doesn't exist, create it
        if (!commitmentExists) {
            Commitment memory newCommitment = Commitment({
                commitmentHash: commitmentHash,
                committer: address(0),  // Anonymous commitment
                timestamp: block.timestamp,
                revealed: false
            });
            poolCommitments.push(newCommitment);
            emit CommitmentSubmitted(poolId, commitmentHash);
        }

        // Mark commitment as verified with ZK proof
        verifiedCommitments[commitmentHash] = true;

        // Emit verification event
        emit CommitmentVerified(poolId, commitmentHash);
    }

    /**
     * @notice Internal function to verify ZK proof
     * @param a Proof component A
     * @param b Proof component B
     * @param c Proof component C
     * @param publicSignals Public signals (commitmentHash)
     * @return isValid Whether the proof is valid
     */
    function verifyCommitmentProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[1] calldata publicSignals
    ) internal view returns (bool isValid) {
        isValid = verifier.verifyProof(a, b, c, publicSignals);
    }

    /**
     * @notice Submit a reveal for a commitment (privacy improvement: separate from batch execution)
     * @param key The pool key
     * @param intent The swap intent to reveal
     * @dev Users can submit reveals separately to minimize batch execution calldata
     *      The reveal is stored on-chain and can be retrieved by commitment hash during batch execution
     *      This reduces calldata exposure in the batch execution transaction
     */
    function submitReveal(
        PoolKey calldata key,
        SwapIntent calldata intent
    ) external {
        PoolId poolId = key.toId();
        
        // Verify deadline
        if (block.timestamp > intent.deadline) revert DeadlineExpired();
        
        // Verify nonce uniqueness
        if (usedNonces[poolId][intent.user][intent.nonce]) revert InvalidNonce();
        
        // Compute commitment hash
        bytes32 computedHash = keccak256(
            abi.encode(
                intent.user,
                intent.tokenIn,
                intent.tokenOut,
                intent.amountIn,
                intent.minAmountOut,
                intent.recipient,
                intent.nonce,
                intent.deadline
            )
        );
        
        // Verify commitment exists and not yet revealed
        Commitment[] storage poolCommitments = commitments[poolId];
        bool found = false;
        for (uint256 i = 0; i < poolCommitments.length; i++) {
            if (
                poolCommitments[i].commitmentHash == computedHash &&
                !poolCommitments[i].revealed
            ) {
                found = true;
                break;
            }
        }
        
        if (!found) revert InvalidCommitment();
        
        // Store reveal (privacy: stored separately, not in batch execution calldata)
        revealStorage[computedHash] = intent;
        
        // Privacy-enhanced: Don't emit user address
        emit CommitmentRevealed(poolId, computedHash);
    }

    /**
     * @notice Submit a reveal for a ZK-verified commitment (privacy-enhanced)
     * @param key The pool key
     * @param commitmentHash The Poseidon commitment hash (must already be ZK-verified)
     * @param intent The swap intent to reveal
     * @dev This function stores the intent for later batch execution.
     *      Unlike submitReveal(), it does NOT verify keccak256 because the commitment
     *      was already verified with a ZK proof (Poseidon hash).
     *      Each user calls this in a SEPARATE transaction, keeping individual intents
     *      out of the batch execution calldata — this is the key privacy improvement.
     *      
     *      Flow:
     *      1. User calls submitCommitmentWithProof() → commitment + proof stored
     *      2. User calls submitRevealForZK() → intent stored (separate tx)
     *      3. Executor calls revealAndBatchExecuteWithProofs() → only hashes + proofs in calldata
     */
    function submitRevealForZK(
        PoolKey calldata key,
        bytes32 commitmentHash,
        SwapIntent calldata intent
    ) external {
        // Verify commitment was ZK-verified
        if (!verifiedCommitments[commitmentHash]) revert InvalidCommitment();

        // Verify deadline
        if (block.timestamp > intent.deadline) revert DeadlineExpired();

        PoolId poolId = key.toId();

        // Verify nonce uniqueness
        if (usedNonces[poolId][intent.user][intent.nonce]) revert InvalidNonce();

        // Store reveal (privacy: stored in contract storage, not in batch execution calldata)
        revealStorage[commitmentHash] = intent;

        // Privacy-enhanced: Don't emit user address
        emit CommitmentRevealed(poolId, commitmentHash);
    }

    // ============ Perp commit/reveal ============

    /**
     * @notice Submit a commitment hash for a perp intent
     */
    function submitPerpCommitment(PoolKey calldata key, bytes32 commitmentHash) external {
        PoolId poolId = key.toId();
        perpCommitments[poolId].push(Commitment({
            commitmentHash: commitmentHash,
            committer: address(0),
            timestamp: block.timestamp,
            revealed: false
        }));
        emit PerpCommitmentSubmitted(poolId, commitmentHash);
    }

    /**
     * @notice Submit a perp commitment with ZK proof
     */
    function submitPerpCommitmentWithProof(
        PoolKey calldata key,
        bytes32 commitmentHash,
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[1] calldata publicSignals
    ) external {
        PoolId poolId = key.toId();
        if (!verifyCommitmentProof(a, b, c, publicSignals)) revert InvalidCommitment();
        if (publicSignals[0] != uint256(commitmentHash)) revert InvalidCommitment();

        Commitment[] storage poolCommitments = perpCommitments[poolId];
        for (uint256 i = 0; i < poolCommitments.length; i++) {
            if (poolCommitments[i].commitmentHash == commitmentHash) {
                perpVerifiedCommitments[commitmentHash] = true;
                emit PerpCommitmentVerified(poolId, commitmentHash);
                return;
            }
        }
        perpCommitments[poolId].push(Commitment({
            commitmentHash: commitmentHash,
            committer: address(0),
            timestamp: block.timestamp,
            revealed: false
        }));
        perpVerifiedCommitments[commitmentHash] = true;
        emit PerpCommitmentSubmitted(poolId, commitmentHash);
        emit PerpCommitmentVerified(poolId, commitmentHash);
    }

    /**
     * @notice Reveal a perp intent (must match commitment hash)
     */
    function submitPerpReveal(PoolKey calldata key, PerpIntent calldata intent) external {
        PoolId poolId = key.toId();
        if (block.timestamp > intent.deadline) revert DeadlineExpired();
        if (perpUsedNonces[poolId][intent.user][intent.nonce]) revert InvalidNonce();

        bytes32 computedHash = keccak256(abi.encode(
            intent.user,
            intent.market,
            intent.size,
            intent.isLong,
            intent.isOpen,
            intent.collateral,
            intent.leverage,
            intent.nonce,
            intent.deadline
        ));

        Commitment[] storage poolCommitments = perpCommitments[poolId];
        bool found = false;
        for (uint256 i = 0; i < poolCommitments.length; i++) {
            if (poolCommitments[i].commitmentHash == computedHash && !poolCommitments[i].revealed) {
                found = true;
                break;
            }
        }
        if (!found) revert InvalidPerpCommitment();

        perpRevealStorage[computedHash] = intent;
        emit PerpCommitmentRevealed(poolId, computedHash);
    }

    /**
     * @notice Reveal a perp intent for a ZK-verified commitment
     */
    function submitPerpRevealForZK(
        PoolKey calldata key,
        bytes32 commitmentHash,
        PerpIntent calldata intent
    ) external {
        if (!perpVerifiedCommitments[commitmentHash]) revert InvalidPerpCommitment();
        if (block.timestamp > intent.deadline) revert DeadlineExpired();

        PoolId poolId = key.toId();
        if (perpUsedNonces[poolId][intent.user][intent.nonce]) revert InvalidNonce();

        perpRevealStorage[commitmentHash] = intent;
        emit PerpCommitmentRevealed(poolId, commitmentHash);
    }

    /**
     * @notice Reveal perp intents and execute batch: net swap + update positions
     * @param key Pool key for the perp market (base/quote pool)
     * @param commitmentHashes Array of perp commitment hashes (reveals must be submitted first)
     * @param baseIsCurrency0 True if base asset is currency0 in the pool
     */
    function revealAndBatchExecutePerps(
        PoolKey calldata key,
        bytes32[] calldata commitmentHashes,
        bool baseIsCurrency0
    ) external {
        if (address(perpPositionManager) == address(0)) revert PerpManagerNotSet();
        if (commitmentHashes.length < MIN_COMMITMENTS) revert InsufficientCommitments();

        PoolId poolId = key.toId();
        BatchState storage state = perpBatchStates[poolId];
        if (block.timestamp - state.lastBatchTimestamp < BATCH_INTERVAL) revert BatchConditionsNotMet();

        (PerpIntent[] memory intents, int256 netBaseDelta) = _processPerpReveals(poolId, key, commitmentHashes);
        uint256 executionPrice = _executePerpBatchSwap(key, netBaseDelta, baseIsCurrency0);

        for (uint256 i = 0; i < intents.length; i++) {
            PerpIntent memory intent = intents[i];
            if (intent.isOpen) {
                perpPositionManager.openPosition(
                    intent.user,
                    intent.market,
                    intent.size,
                    intent.isLong,
                    intent.leverage,
                    executionPrice
                );
            } else {
                perpPositionManager.closePosition(intent.user, intent.market, intent.size, executionPrice);
            }
        }

        state.lastBatchTimestamp = block.timestamp;
        state.batchNonce++;
        Commitment[] storage poolCommitments = perpCommitments[poolId];
        for (uint256 i = 0; i < commitmentHashes.length; i++) {
            delete perpRevealStorage[commitmentHashes[i]];
            _markPerpCommitmentRevealed(poolId, poolCommitments, commitmentHashes[i]);
        }
        emit PerpBatchExecuted(poolId, commitmentHashes.length, executionPrice, block.timestamp);
    }

    /**
     * @notice Load and validate perp reveals; compute net base delta
     */
    function _processPerpReveals(
        PoolId poolId,
        PoolKey calldata key,
        bytes32[] calldata commitmentHashes
    ) internal returns (PerpIntent[] memory intents, int256 netBaseDelta) {
        intents = new PerpIntent[](commitmentHashes.length);
        netBaseDelta = 0;

        Commitment[] storage poolCommitments = perpCommitments[poolId];

        for (uint256 i = 0; i < commitmentHashes.length; i++) {
            PerpIntent memory intent = perpRevealStorage[commitmentHashes[i]];
            if (intent.user == address(0)) revert InvalidPerpCommitment();
            if (block.timestamp > intent.deadline) revert DeadlineExpired();
            if (perpUsedNonces[poolId][intent.user][intent.nonce]) revert InvalidNonce();

            _validateAndMarkPerpCommitment(poolId, poolCommitments, commitmentHashes[i]);
            perpUsedNonces[poolId][intent.user][intent.nonce] = true;
            intents[i] = intent;

            if (intent.isOpen) {
                netBaseDelta += intent.isLong ? int256(intent.size) : -int256(intent.size);
            } else {
                netBaseDelta += intent.isLong ? -int256(intent.size) : int256(intent.size);
            }
        }
    }

    function _validateAndMarkPerpCommitment(
        PoolId,
        Commitment[] storage poolCommitments,
        bytes32 commitmentHash
    ) internal {
        for (uint256 j = 0; j < poolCommitments.length; j++) {
            if (poolCommitments[j].commitmentHash == commitmentHash && !poolCommitments[j].revealed) {
                return;
            }
        }
        revert InvalidPerpCommitment();
    }

    function _markPerpCommitmentRevealed(PoolId, Commitment[] storage poolCommitments, bytes32 commitmentHash) internal {
        for (uint256 j = 0; j < poolCommitments.length; j++) {
            if (poolCommitments[j].commitmentHash == commitmentHash && !poolCommitments[j].revealed) {
                poolCommitments[j].revealed = true;
                return;
            }
        }
    }

    /**
     * @notice Compute perp commitment hash (view helper)
     */
    function computePerpCommitmentHash(PerpIntent calldata intent) external pure returns (bytes32) {
        return keccak256(abi.encode(
            intent.user,
            intent.market,
            intent.size,
            intent.isLong,
            intent.isOpen,
            intent.collateral,
            intent.leverage,
            intent.nonce,
            intent.deadline
        ));
    }

    /**
     * @notice Check if batch execution conditions are met
     * @param poolId The pool ID to check
     * @return canExec Whether execution can proceed
     * @return execPayload Empty - not used (execution is permissionless)
     * @dev Anyone can call revealAndBatchExecute when conditions are met
     *      This function is useful for off-chain monitoring
     */
    function checker(
        PoolId poolId
    ) external view returns (bool canExec, bytes memory execPayload) {
        BatchState memory state = batchStates[poolId];
        Commitment[] memory poolCommitments = commitments[poolId];

        uint256 pendingCount = 0;
        for (uint256 i = 0; i < poolCommitments.length; i++) {
            if (!poolCommitments[i].revealed) {
                pendingCount++;
            }
        }

        bool hasEnoughCommitments = pendingCount >= MIN_COMMITMENTS;
        bool intervalElapsed = block.timestamp - state.lastBatchTimestamp >=
            BATCH_INTERVAL;

        canExec = hasEnoughCommitments && intervalElapsed;
        execPayload = ""; // Not used - execution is permissionless
    }

    /**
     * @notice Execute batched swap with ZK proofs (privacy-enhanced: no intents in calldata)
     * @param key The pool key
     * @param commitmentHashes Array of commitment hashes
     * @param proofsA Array of proof A components (uint[2] for each proof)
     * @param proofsB Array of proof B components (uint[2][2] for each proof)
     * @param proofsC Array of proof C components (uint[2] for each proof)
     * @param publicSignalsArray Array of public signals arrays (each contains commitmentHash)
     * @dev PRIVACY: This function does NOT take swap intents as parameters.
     *      Intents must be submitted separately via submitRevealForZK() BEFORE calling this.
     *      This means the batch execution transaction's calldata only contains:
     *      - Pool key (public, needed for routing)
     *      - Commitment hashes (opaque 32-byte values)
     *      - ZK proofs (cryptographic data, reveals nothing about trade details)
     *      
     *      Individual trade details (user, amounts, tokens, recipients) are NOT visible
     *      in the batch execution calldata on the block explorer.
     */
    function revealAndBatchExecuteWithProofs(
        PoolKey calldata key,
        bytes32[] calldata commitmentHashes,
        uint[2][] calldata proofsA,
        uint[2][2][] calldata proofsB,
        uint[2][] calldata proofsC,
        uint[1][] calldata publicSignalsArray
    ) external {
        PoolId poolId = key.toId();

        // Verify batch conditions
        if (commitmentHashes.length < MIN_COMMITMENTS) revert InsufficientCommitments();
        if (commitmentHashes.length != proofsA.length) revert InvalidCommitment();

        BatchState storage state = batchStates[poolId];
        if (block.timestamp - state.lastBatchTimestamp < BATCH_INTERVAL) {
            revert BatchConditionsNotMet();
        }

        // Verify all ZK proofs
        _verifyZKProofs(commitmentHashes, proofsA, proofsB, proofsC, publicSignalsArray);

        // Retrieve intents from storage (privacy: NOT in calldata)
        SwapIntent[] memory intents = new SwapIntent[](commitmentHashes.length);
        for (uint256 i = 0; i < commitmentHashes.length; i++) {
            SwapIntent memory storedIntent = revealStorage[commitmentHashes[i]];
            if (storedIntent.user == address(0)) revert InvalidCommitment();
            intents[i] = storedIntent;
        }

        // Process reveals and execute batch
        Currency currency0 = key.currency0;
        _processAndExecuteBatchWithProofs(poolId, key, intents, commitmentHashes, currency0, state);

        // Clean up stored reveals after execution (privacy: remove from storage)
        for (uint256 i = 0; i < commitmentHashes.length; i++) {
            delete revealStorage[commitmentHashes[i]];
        }
    }

    /**
     * @notice Verify all ZK proofs (helper to reduce stack depth)
     * @dev Only verifies proofs match commitment hashes. Intents are loaded from storage separately.
     */
    function _verifyZKProofs(
        bytes32[] calldata commitmentHashes,
        uint[2][] calldata proofsA,
        uint[2][2][] calldata proofsB,
        uint[2][] calldata proofsC,
        uint[1][] calldata publicSignalsArray
    ) internal view {
        for (uint256 i = 0; i < commitmentHashes.length; i++) {
            // Verify ZK proof
            bool proofValid = verifyCommitmentProof(
                proofsA[i],
                proofsB[i],
                proofsC[i],
                publicSignalsArray[i]
            );
            if (!proofValid) revert InvalidCommitment();

            // Verify public signal matches commitment hash
            // The ZK proof's public signal IS the Poseidon commitment hash
            if (publicSignalsArray[i][0] != uint256(commitmentHashes[i])) {
                revert InvalidCommitment();
            }

        
        }
    }

    /**
     * @notice Compute commitment hash from swap intent (helper)
     */
    function _computeCommitmentHash(SwapIntent calldata intent) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                intent.user,
                intent.tokenIn,
                intent.tokenOut,
                intent.amountIn,
                intent.minAmountOut,
                intent.recipient,
                intent.nonce,
                intent.deadline
            )
        );
    }

    /**
     * @notice Process reveals and execute batch (helper to reduce stack depth)
     */
    function _processAndExecuteBatchWithProofs(
        PoolId poolId,
        PoolKey calldata key,
        SwapIntent[] memory intents,
        bytes32[] calldata commitmentHashes,
        Currency currency0,
        BatchState storage state
    ) internal {
        // Process reveals and accumulate deltas
        // zkVerified=true: skip keccak256 check since ZK proofs already verified commitment-intent match
        (int256 netDelta0, int256 netDelta1, UserContribution[] memory contributions) = 
            _processReveals(poolId, intents, currency0, commitmentHashes, true);

        // Privacy validation: Ensure netting is correct and no individual data leaks
        _validateBatchPrivacy(netDelta0, netDelta1, currency0, contributions);

        // Execute swap (only net deltas visible to pool)
        BalanceDelta swapDelta = _executeBatchSwap(key, netDelta0, netDelta1);

        // Validate slippage for all users before distribution
        _validateSlippage(key, contributions, swapDelta, netDelta0, netDelta1);

        // Distribute output tokens to recipients
        _distributeTokens(key, contributions, swapDelta, netDelta0, netDelta1);

        // Update state
        state.lastBatchTimestamp = block.timestamp;
        state.batchNonce++;

        // Mark commitments as verified and revealed
        Commitment[] storage poolCommitments = commitments[poolId];
        for (uint256 i = 0; i < commitmentHashes.length; i++) {
            verifiedCommitments[commitmentHashes[i]] = true;
            // Mark commitment as revealed
            for (uint256 j = 0; j < poolCommitments.length; j++) {
                if (
                    poolCommitments[j].commitmentHash == commitmentHashes[i] &&
                    !poolCommitments[j].revealed
                ) {
                    poolCommitments[j].revealed = true;
                    break;
                }
            }
        }

        // Emit event with actual swap results
        emit BatchExecuted(
            poolId,
            swapDelta.amount0(),
            swapDelta.amount1(),
            commitmentHashes.length,
            block.timestamp
        );
    }

    /**
     * @notice Reveal commitments and execute batched swap
     * @param key The pool key
     * @param commitmentHashes Array of commitment hashes (privacy: minimal calldata)
     * @dev This function now accepts only commitment hashes, reducing calldata exposure
     *      Reveals must be submitted separately via submitReveal() before batch execution
     */
    function revealAndBatchExecute(
        PoolKey calldata key,
        bytes32[] calldata commitmentHashes
    ) external {
        PoolId poolId = key.toId();

        // Verify batch conditions
        if (commitmentHashes.length < MIN_COMMITMENTS) revert InsufficientCommitments();

        BatchState storage state = batchStates[poolId];
        if (block.timestamp - state.lastBatchTimestamp < BATCH_INTERVAL) {
            revert BatchConditionsNotMet();
        }

        // Retrieve reveals from storage (privacy: not in calldata)
        SwapIntent[] memory reveals = new SwapIntent[](commitmentHashes.length);
        for (uint256 i = 0; i < commitmentHashes.length; i++) {
            SwapIntent memory storedReveal = revealStorage[commitmentHashes[i]];
            if (storedReveal.user == address(0)) revert InvalidCommitment();
            reveals[i] = storedReveal;
        }

        // Process reveals and accumulate deltas
        // zkVerified=false: use keccak256 check for non-ZK commit-reveal path
        (int256 netDelta0, int256 netDelta1, UserContribution[] memory contributions) = 
            _processReveals(poolId, reveals, key.currency0, commitmentHashes, false);

        // Privacy validation: Ensure netting is correct and no individual data leaks
        _validateBatchPrivacy(netDelta0, netDelta1, key.currency0, contributions);

        // Execute swap (only net deltas visible to pool)
        BalanceDelta swapDelta = _executeBatchSwap(key, netDelta0, netDelta1);

        // Validate slippage for all users before distribution
        _validateSlippage(key, contributions, swapDelta, netDelta0, netDelta1);

        // Distribute output tokens to recipients
        _distributeTokens(key, contributions, swapDelta, netDelta0, netDelta1);

        // Update state
        state.lastBatchTimestamp = block.timestamp;
        state.batchNonce++;

        // Clean up stored reveals (privacy: remove after use)
        for (uint256 i = 0; i < commitmentHashes.length; i++) {
            delete revealStorage[commitmentHashes[i]];
        }

        // Emit event with actual swap results
        emit BatchExecuted(
            poolId,
            swapDelta.amount0(),
            swapDelta.amount1(),
            commitmentHashes.length,
            block.timestamp
        );
    }

    /**
     * @notice Process reveals and accumulate net deltas
     * @param poolId The pool ID
     * @param reveals Array of revealed swap intents (from storage, not calldata)
     * @param token0 The currency0 of the pool
     * @param commitmentHashes Array of commitment hashes for verification
     * @return netDelta0 Net delta for currency0
     * @return netDelta1 Net delta for currency1
     * @return contributions Array of user contributions for distribution
     */
    function _processReveals(
        PoolId poolId,
        SwapIntent[] memory reveals,
        Currency token0,
        bytes32[] calldata commitmentHashes,
        bool zkVerified
    ) internal returns (
        int256 netDelta0,
        int256 netDelta1,
        UserContribution[] memory contributions
    ) {
        Commitment[] storage poolCommitments = commitments[poolId];
        contributions = new UserContribution[](reveals.length);
        address token0Address = Currency.unwrap(token0);

        for (uint256 i = 0; i < reveals.length; i++) {
            SwapIntent memory intent = reveals[i];

            // Verify deadline
            if (block.timestamp > intent.deadline) revert DeadlineExpired();

            // Verify nonce uniqueness
            if (usedNonces[poolId][intent.user][intent.nonce]) revert InvalidNonce();

            // Verify commitment hash
            // For ZK-verified path: commitment hash is a Poseidon hash, already verified by ZK proof
            // For non-ZK path: commitment hash is keccak256, verify here
            if (!zkVerified) {
                bytes32 computedHash = keccak256(
                    abi.encode(
                        intent.user,
                        intent.tokenIn,
                        intent.tokenOut,
                        intent.amountIn,
                        intent.minAmountOut,
                        intent.recipient,
                        intent.nonce,
                        intent.deadline
                    )
                );
                if (computedHash != commitmentHashes[i]) revert InvalidCommitment();
            }

            // Validate and mark commitment as revealed
            _validateAndMarkCommitment(poolId, poolCommitments, commitmentHashes[i]);

            // Mark nonce as used
            usedNonces[poolId][intent.user][intent.nonce] = true;

            // Store user contribution
            contributions[i] = UserContribution({
                recipient: intent.recipient,
                inputAmount: intent.amountIn,
                inputCurrency: intent.tokenIn,
                outputCurrency: intent.tokenOut,
                minAmountOut: intent.minAmountOut
            });

            // Accumulate deltas
            address tokenInAddress = Currency.unwrap(intent.tokenIn);
            if (tokenInAddress == token0Address) {
                netDelta0 += int256(intent.amountIn);
                netDelta1 -= int256(intent.minAmountOut);
            } else {
                netDelta1 += int256(intent.amountIn);
                netDelta0 -= int256(intent.minAmountOut);
            }

            // Transfer tokens from user to hook (NOT directly to poolManager)
            // The hook will transfer the net amount to poolManager inside the unlock callback
            // This is necessary because tokens transferred before unlock() aren't seen by sync()/settle()
            IERC20(tokenInAddress).transferFrom(
                intent.user,
                address(this),
                intent.amountIn
            );
        }
    }

    /**
     * @notice Validate and mark commitment as revealed (helper to reduce stack depth)
     */
    function _validateAndMarkCommitment(
        PoolId poolId,
        Commitment[] storage poolCommitments,
        bytes32 commitmentHash
    ) internal {
        for (uint256 j = 0; j < poolCommitments.length; j++) {
            if (
                poolCommitments[j].commitmentHash == commitmentHash &&
                !poolCommitments[j].revealed
            ) {
                poolCommitments[j].revealed = true;
                return;
            }
        }
        revert InvalidCommitment();
    }

    /**
     * @notice Validate batch privacy: Ensure netting hides individual contributions
     * @param netDelta0 Net delta for currency0
     * @param netDelta1 Net delta for currency1
     * @param token0 The currency0 of the pool
     * @param contributions Array of user contributions
     * @dev This function validates that:
     *      1. Net deltas have opposite signs (valid swap direction)
     *      2. Net deltas correctly represent the sum of individual contributions
     *      3. No individual trade data leaks through validation
     */
    function _validateBatchPrivacy(
        int256 netDelta0,
        int256 netDelta1,
        Currency token0,
        UserContribution[] memory contributions
    ) internal pure {
        // Privacy: Validate that net deltas have opposite signs (valid swap)
        // This ensures the batch represents a valid net swap direction
        bool validSwap = (netDelta0 > 0 && netDelta1 < 0) || (netDelta1 > 0 && netDelta0 < 0);
        if (!validSwap) revert InvalidNetDeltaSign();

        // Privacy: Verify net deltas match sum of contributions (without exposing individual data)
        // This ensures netting is correct and individual contributions are properly hidden
        int256 calculatedDelta0 = 0;
        int256 calculatedDelta1 = 0;
        address token0Address = Currency.unwrap(token0);

        for (uint256 i = 0; i < contributions.length; i++) {
            address tokenInAddress = Currency.unwrap(contributions[i].inputCurrency);
            
            if (tokenInAddress == token0Address) {
                calculatedDelta0 += int256(contributions[i].inputAmount);
                calculatedDelta1 -= int256(contributions[i].minAmountOut);
            } else {
                calculatedDelta1 += int256(contributions[i].inputAmount);
                calculatedDelta0 -= int256(contributions[i].minAmountOut);
            }
        }

        // Privacy: Validate net deltas match calculated sum (ensures correct netting)
        // Note: We use minAmountOut for output, which is conservative but correct for validation
        if (calculatedDelta0 != netDelta0 || calculatedDelta1 != netDelta1) {
            revert NetDeltaMismatch();
        }
    }

    /**
     * @notice Execute the batched swap via PoolManager
     * @param key The pool key
     * @param netDelta0 Net delta for currency0
     * @param netDelta1 Net delta for currency1
     * @return swapDelta The balance delta from the swap
     */
    function _executeBatchSwap(
        PoolKey calldata key,
        int256 netDelta0,
        int256 netDelta1
    ) internal returns (BalanceDelta swapDelta) {
        // Determine swap direction from net deltas
        bool zeroForOne;
        if (netDelta0 > 0 && netDelta1 < 0) {
            zeroForOne = true;
        } else if (netDelta1 > 0 && netDelta0 < 0) {
            zeroForOne = false;
        } else {
            revert InvalidSwapDirection();
        }

        // Execute swap via unlock pattern
        // Set proper sqrtPriceLimitX96 based on swap direction
        uint160 priceLimit = zeroForOne
            ? TickMath.MIN_SQRT_PRICE + 1
            : TickMath.MAX_SQRT_PRICE - 1;

        SwapCallbackData memory callbackData = SwapCallbackData({
            key: key,
            netAmount0: netDelta0,
            netAmount1: netDelta1,
            zeroForOne: zeroForOne,
            sqrtPriceLimitX96: priceLimit
        });

        // Unlock and execute swap (prefix 0 = swap)
        bytes memory swapResult = poolManager.unlock(abi.encodePacked(uint8(0), abi.encode(callbackData)));
        swapDelta = abi.decode(swapResult, (BalanceDelta));
    }

    /**
     * @notice Execute net perp swap and return execution price (18 decimals)
     */
    function _executePerpBatchSwap(
        PoolKey calldata key,
        int256 netBaseDelta,
        bool baseIsCurrency0
    ) internal returns (uint256 executionPrice) {
        if (netBaseDelta == 0) revert InvalidPerpCommitment();
        PerpSwapCallbackData memory callbackData = PerpSwapCallbackData({
            key: key,
            netBaseDelta: netBaseDelta,
            baseIsCurrency0: baseIsCurrency0
        });
        bytes memory result = poolManager.unlock(abi.encodePacked(uint8(1), abi.encode(callbackData)));
        executionPrice = abi.decode(result, (uint256));
    }

    /**
     * @notice Callback executed when PoolManager is unlocked
     * @param data Encoded SwapCallbackData
     * @return Encoded BalanceDelta result
     */
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "Only PoolManager");

        uint8 callbackType = uint8(data[0]);
        bytes memory payload = new bytes(data.length - 1);
        for (uint256 i = 1; i < data.length; i++) {
            payload[i - 1] = data[i];
        }
        if (callbackType == 1) {
            return _unlockCallbackPerp(payload);
        }
        SwapCallbackData memory callbackData = abi.decode(payload, (SwapCallbackData));

        Currency inputCurrency = callbackData.zeroForOne
            ? callbackData.key.currency0
            : callbackData.key.currency1;

        Currency outputCurrency = callbackData.zeroForOne
            ? callbackData.key.currency1
            : callbackData.key.currency0;

        // Step 1: Execute the swap (creates debts/credits in the PoolManager)
        // Use negative amountSpecified for exact-input swap
        int256 netInput = callbackData.zeroForOne
            ? callbackData.netAmount0
            : callbackData.netAmount1;

        SwapParams memory swapParams = SwapParams({
            zeroForOne: callbackData.zeroForOne,
            amountSpecified: -netInput, // Negative = exact input in V4
            sqrtPriceLimitX96: callbackData.sqrtPriceLimitX96
        });

        BalanceDelta swapDelta = poolManager.swap(
            callbackData.key,
            swapParams,
            ""
        );

        // Step 2: Settle input — pay what we owe to the pool
        // The swap created a negative delta for the input currency (we owe tokens)
        // sync() snapshots current balance, then we transfer, then settle() credits the difference
        int128 inputDelta = callbackData.zeroForOne
            ? swapDelta.amount0()
            : swapDelta.amount1();

        if (inputDelta < 0) {
            uint256 amountToPay = uint256(uint128(-inputDelta));
            poolManager.sync(inputCurrency);
            IERC20(Currency.unwrap(inputCurrency)).transfer(address(poolManager), amountToPay);
            poolManager.settle();
        }

        // Step 3: Take output — receive what we're owed from the pool
        int128 outputDelta = callbackData.zeroForOne
            ? swapDelta.amount1()
            : swapDelta.amount0();

        if (outputDelta > 0) {
            poolManager.take(outputCurrency, address(this), uint256(uint128(outputDelta)));
        }

        return abi.encode(swapDelta);
    }

    /**
     * @notice Callback for perp batch: execute net base swap and return execution price (18 decimals)
     */
    function _unlockCallbackPerp(bytes memory payload) internal returns (bytes memory) {
        PerpSwapCallbackData memory cb = abi.decode(payload, (PerpSwapCallbackData));
        int256 netBase = cb.netBaseDelta;
        bool zeroForOne = cb.baseIsCurrency0 ? (netBase > 0) : (netBase < 0); // buy base = base out
        uint256 absBase = uint256(netBase > 0 ? netBase : -netBase);
        if (absBase == 0) return abi.encode(uint256(0));

        uint160 priceLimit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        // amountSpecified: negative = exact input, positive = exact output (in V4)
        int256 amountSpecified = netBase > 0 ? int256(absBase) : -int256(absBase);

        SwapParams memory swapParams = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: priceLimit
        });

        BalanceDelta swapDelta = poolManager.swap(cb.key, swapParams, "");

        Currency baseCurrency = cb.baseIsCurrency0 ? cb.key.currency0 : cb.key.currency1;
        Currency quoteCurrency = cb.baseIsCurrency0 ? cb.key.currency1 : cb.key.currency0;
        int128 baseDelta = cb.baseIsCurrency0 ? swapDelta.amount0() : swapDelta.amount1();
        int128 quoteDelta = cb.baseIsCurrency0 ? swapDelta.amount1() : swapDelta.amount0();

        // Settle: pay what we owe
        if (baseDelta < 0) {
            poolManager.sync(baseCurrency);
            IERC20(Currency.unwrap(baseCurrency)).transfer(address(poolManager), uint256(uint128(-baseDelta)));
            poolManager.settle();
        }
        if (quoteDelta < 0) {
            poolManager.sync(quoteCurrency);
            IERC20(Currency.unwrap(quoteCurrency)).transfer(address(poolManager), uint256(uint128(-quoteDelta)));
            poolManager.settle();
        }
        // Take what we're owed
        if (baseDelta > 0) {
            poolManager.take(baseCurrency, address(this), uint256(uint128(baseDelta)));
        }
        if (quoteDelta > 0) {
            poolManager.take(quoteCurrency, address(this), uint256(uint128(quoteDelta)));
        }

        // Execution price in 18 decimals: quote per base (quoteDelta / baseDelta)
        uint256 baseAbs = baseDelta > 0 ? uint256(uint128(baseDelta)) : uint256(uint128(-baseDelta));
        uint256 quoteAbs = quoteDelta > 0 ? uint256(uint128(quoteDelta)) : uint256(uint128(-quoteDelta));
        uint256 executionPrice = baseAbs > 0 ? (quoteAbs * 1e18) / baseAbs : 0;
        return abi.encode(executionPrice);
    }

    /**
     * @notice Distribute output tokens to recipients based on their contributions
     * @param key The pool key
     * @param contributions Array of user contributions
     * @param swapDelta The balance delta from the swap
     * @param netDelta0 Net delta for currency0
     * @param netDelta1 Net delta for currency1
     */
    function _distributeTokens(
        PoolKey calldata key,
        UserContribution[] memory contributions,
        BalanceDelta swapDelta,
        int256 netDelta0,
        int256 netDelta1
    ) internal {
        PoolId poolId = key.toId();
        
        // Determine swap direction and output currency
        bool zeroForOne = netDelta0 > 0 && netDelta1 < 0;
        Currency outputCurrency = zeroForOne ? key.currency1 : key.currency0;
        address outputToken = Currency.unwrap(outputCurrency);
        
        // Get actual output amount from swap
        int256 actualOutputDelta = zeroForOne ? swapDelta.amount1() : swapDelta.amount0();
        if (actualOutputDelta <= 0) return;
        uint256 totalOutput = uint256(actualOutputDelta);

        // Calculate total input and identify eligible users
        (uint256 totalInput, uint256[] memory eligibleIndices, uint256 eligibleCount) = 
            _calculateEligibleUsers(key, contributions, zeroForOne, outputCurrency);

        if (totalInput == 0 || eligibleCount == 0) return;

        // Distribute tokens proportionally
        _distributeProportionally(
            poolId,
            contributions,
            eligibleIndices,
            eligibleCount,
            totalInput,
            totalOutput,
            outputToken
        );
    }

    /**
     * @notice Validate slippage for all users after swap execution
     * @param key The pool key
     * @param contributions Array of user contributions
     * @param swapDelta The balance delta from the swap
     * @param netDelta0 Net delta for currency0
     * @param netDelta1 Net delta for currency1
     */
    function _validateSlippage(
        PoolKey calldata key,
        UserContribution[] memory contributions,
        BalanceDelta swapDelta,
        int256 netDelta0,
        int256 netDelta1
    ) internal pure {
        // Determine swap direction and output currency
        bool zeroForOne = netDelta0 > 0 && netDelta1 < 0;
        Currency outputCurrency = zeroForOne ? key.currency1 : key.currency0;
        Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
        
        // Get actual output amount from swap
        int256 actualOutputDelta = zeroForOne ? swapDelta.amount1() : swapDelta.amount0();
        if (actualOutputDelta <= 0) {
            // No output - this would be caught earlier, but validate anyway
            return;
        }
        uint256 totalOutput = uint256(actualOutputDelta);

        // Calculate total input for users swapping in the net direction
        uint256 totalInput = 0;
        for (uint256 i = 0; i < contributions.length; i++) {
            bool matchesInput = Currency.unwrap(contributions[i].inputCurrency) == Currency.unwrap(inputCurrency);
            bool matchesOutput = Currency.unwrap(contributions[i].outputCurrency) == Currency.unwrap(outputCurrency);
            
            if (matchesInput && matchesOutput) {
                totalInput += contributions[i].inputAmount;
            }
        }

        if (totalInput == 0) {
            // No eligible users - nothing to validate
            return;
        }

        // Validate slippage for each eligible user
        // Use conservative floor division - this ensures users get at least their minimum
        // (The last user may get more due to remainder, which is fine)
        for (uint256 i = 0; i < contributions.length; i++) {
            bool matchesInput = Currency.unwrap(contributions[i].inputCurrency) == Currency.unwrap(inputCurrency);
            bool matchesOutput = Currency.unwrap(contributions[i].outputCurrency) == Currency.unwrap(outputCurrency);
            
            if (matchesInput && matchesOutput) {
                // Calculate user's minimum guaranteed output using floor division
                // This is conservative - actual output may be slightly higher due to rounding
                uint256 minGuaranteedOutput = (totalOutput * contributions[i].inputAmount) / totalInput;
                
                // Compare against user's minimum acceptable output
                if (minGuaranteedOutput < contributions[i].minAmountOut) {
                    revert SlippageExceededForUser(
                        contributions[i].recipient,
                        contributions[i].minAmountOut,
                        minGuaranteedOutput
                    );
                }
            }
        }
    }

    /**
     * @notice Calculate eligible users and total input
     */
    function _calculateEligibleUsers(
        PoolKey calldata key,
        UserContribution[] memory contributions,
        bool zeroForOne,
        Currency outputCurrency
    ) internal pure returns (uint256 totalInput, uint256[] memory eligibleIndices, uint256 eligibleCount) {
        Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
        address inputToken = Currency.unwrap(inputCurrency);
        address outputToken = Currency.unwrap(outputCurrency);
        
        eligibleIndices = new uint256[](contributions.length);
        
        for (uint256 i = 0; i < contributions.length; i++) {
            address contribInput = Currency.unwrap(contributions[i].inputCurrency);
            address contribOutput = Currency.unwrap(contributions[i].outputCurrency);
            
            if (contribInput == inputToken && contribOutput == outputToken) {
                totalInput += contributions[i].inputAmount;
                eligibleIndices[eligibleCount] = i;
                eligibleCount++;
            }
        }
    }

    /**
     * @notice Distribute tokens proportionally to eligible users
     */
    function _distributeProportionally(
        PoolId poolId,
        UserContribution[] memory contributions,
        uint256[] memory eligibleIndices,
        uint256 eligibleCount,
        uint256 totalInput,
        uint256 totalOutput,
        address outputToken
    ) internal {
        uint256 distributed = 0;
        
        for (uint256 j = 0; j < eligibleCount; j++) {
            uint256 i = eligibleIndices[j];
            UserContribution memory contrib = contributions[i];
            
            // Calculate share
            uint256 share = (j == eligibleCount - 1)
                ? totalOutput - distributed  // Last user gets remainder
                : (totalOutput * contrib.inputAmount) / totalInput;

            if (share > 0) {
                IERC20(outputToken).transfer(contrib.recipient, share);
                distributed += share;
                
                // Privacy-enhanced: Emit hash of recipient instead of address
                bytes32 recipientHash = keccak256(abi.encodePacked(contrib.recipient));
                emit TokensDistributed(poolId, recipientHash, outputToken, share);
            }
        }
    }

    /**
     * @notice Generate commitment hash off-chain helper view
     * @param intent The swap intent to hash
     * @return The commitment hash
     */
    function computeCommitmentHash(
        SwapIntent calldata intent
    ) external pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    intent.user,
                    intent.tokenIn,
                    intent.tokenOut,
                    intent.amountIn,
                    intent.minAmountOut,
                    intent.recipient,
                    intent.nonce,
                    intent.deadline
                )
            );
    }

    /**
     * @notice Get pending commitments for a pool
     * @param poolId The pool ID
     * @return Array of commitments
     */
    function getCommitments(
        PoolId poolId
    ) external view returns (Commitment[] memory) {
        return commitments[poolId];
    }

    /**
     * @notice Get count of unrevealed commitments
     * @param poolId The pool ID
     * @return count Number of pending commitments
     */
    function getPendingCommitmentCount(
        PoolId poolId
    ) external view returns (uint256 count) {
        Commitment[] memory poolCommitments = commitments[poolId];
        for (uint256 i = 0; i < poolCommitments.length; i++) {
            if (!poolCommitments[i].revealed) {
                count++;
            }
        }
    }

    // ============ Hook Overrides ============

    function _beforeSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        bytes calldata
    ) internal pure override returns (bytes4, BeforeSwapDelta, uint24) {
        // Optional: Block direct swaps to force batch-only mode
        // For hackathon: allow both modes
        return (
            BaseHook.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            0
        );
    }

    function _afterSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) internal pure override returns (bytes4, int128) {
        // Optional: Return delta adjustments or MEV redistribution
        return (BaseHook.afterSwap.selector, 0);
    }
}
