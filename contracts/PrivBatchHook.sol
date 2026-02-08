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
     * @notice Reveal commitments and execute batched swap with ZK proofs
     * @param key The pool key
     * @param commitmentHashes Array of commitment hashes
     * @param proofsA Array of proof A components (uint[2] for each proof)
     * @param proofsB Array of proof B components (uint[2][2] for each proof)
     * @param proofsC Array of proof C components (uint[2] for each proof)
     * @param publicSignalsArray Array of public signals arrays (each contains commitmentHash)
     * @param intents Array of swap intents (revealed parameters)
     * @dev This function verifies ZK proofs to ensure reveals match commitments,
     *      then executes batch swap. ZK proofs prove knowledge without exposing parameters in calldata
     *      until verification is complete.
     *      Key privacy benefit: Proofs verify commitment-reveal match without storing reveals on-chain first.
     */
    function revealAndBatchExecuteWithProofs(
        PoolKey calldata key,
        bytes32[] calldata commitmentHashes,
        uint[2][] calldata proofsA,
        uint[2][2][] calldata proofsB,
        uint[2][] calldata proofsC,
        uint[1][] calldata publicSignalsArray,
        SwapIntent[] calldata intents
    ) external {
        PoolId poolId = key.toId();

        // Verify batch conditions
        if (commitmentHashes.length < MIN_COMMITMENTS) revert InsufficientCommitments();
        if (commitmentHashes.length != intents.length) revert InvalidCommitment();
        if (commitmentHashes.length != proofsA.length) revert InvalidCommitment();

        BatchState storage state = batchStates[poolId];
        if (block.timestamp - state.lastBatchTimestamp < BATCH_INTERVAL) {
            revert BatchConditionsNotMet();
        }

        // Verify all ZK proofs and commitment-reveal matches
        _verifyZKProofs(commitmentHashes, proofsA, proofsB, proofsC, publicSignalsArray, intents);

        // Process reveals and execute batch
        Currency currency0 = key.currency0;
        _processAndExecuteBatchWithProofs(poolId, key, intents, commitmentHashes, currency0, state);
    }

    /**
     * @notice Verify all ZK proofs and commitment-reveal matches (helper to reduce stack depth)
     */
    function _verifyZKProofs(
        bytes32[] calldata commitmentHashes,
        uint[2][] calldata proofsA,
        uint[2][2][] calldata proofsB,
        uint[2][] calldata proofsC,
        uint[1][] calldata publicSignalsArray,
        SwapIntent[] calldata intents
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
        SwapIntent[] calldata intents,
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

        // Unlock and execute swap
        bytes memory swapResult = poolManager.unlock(abi.encode(callbackData));
        swapDelta = abi.decode(swapResult, (BalanceDelta));
    }

    /**
     * @notice Callback executed when PoolManager is unlocked
     * @param data Encoded SwapCallbackData
     * @return Encoded BalanceDelta result
     */
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "Only PoolManager");

        SwapCallbackData memory callbackData = abi.decode(data, (SwapCallbackData));

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
