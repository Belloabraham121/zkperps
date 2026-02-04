// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary
} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {TransientStateLibrary} from "v4-core/libraries/TransientStateLibrary.sol";

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

    // ============ Events ============
    event CommitmentSubmitted(
        PoolId indexed poolId,
        bytes32 indexed commitmentHash,
        address indexed committer
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
        bytes32 indexed commitmentHash,
        address user
    );
    event TokensDistributed(
        PoolId indexed poolId,
        address indexed recipient,
        address token,
        uint256 amount
    );

    // ============ Structs ============
    struct Commitment {
        bytes32 commitmentHash;
        address committer;
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

    // Configurable parameters
    uint256 public constant MIN_COMMITMENTS = 2;
    uint256 public constant BATCH_INTERVAL = 5 minutes;

    // Note: Automation removed - batch execution is permissionless
    // Anyone can call revealAndBatchExecute when conditions are met

    // ============ Constructor ============
    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {
        // No automation executor needed - execution is permissionless
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
            committer: msg.sender,
            timestamp: block.timestamp,
            revealed: false
        });

        commitments[poolId].push(newCommitment);

        emit CommitmentSubmitted(poolId, _commitmentHash, msg.sender);
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
     * @notice Reveal commitments and execute batched swap
     * @param key The pool key
     * @param reveals Array of revealed swap intents
     */
    function revealAndBatchExecute(
        PoolKey calldata key,
        SwapIntent[] calldata reveals
    ) external {
        PoolId poolId = key.toId();

        // Verify batch conditions
        if (reveals.length < MIN_COMMITMENTS) revert InsufficientCommitments();

        BatchState storage state = batchStates[poolId];
        if (block.timestamp - state.lastBatchTimestamp < BATCH_INTERVAL) {
            revert BatchConditionsNotMet();
        }

        // Process reveals and accumulate deltas
        (int256 netDelta0, int256 netDelta1, UserContribution[] memory contributions) = 
            _processReveals(poolId, reveals, key.currency0);

        // Execute swap
        BalanceDelta swapDelta = _executeBatchSwap(key, netDelta0, netDelta1);

        // Validate slippage for all users before distribution
        _validateSlippage(key, contributions, swapDelta, netDelta0, netDelta1);

        // Distribute output tokens to recipients
        _distributeTokens(key, contributions, swapDelta, netDelta0, netDelta1);

        // Update state
        state.lastBatchTimestamp = block.timestamp;
        state.batchNonce++;

        // Emit event with actual swap results
        emit BatchExecuted(
            poolId,
            swapDelta.amount0(),
            swapDelta.amount1(),
            reveals.length,
            block.timestamp
        );
    }

    /**
     * @notice Process reveals and accumulate net deltas
     * @param poolId The pool ID
     * @param reveals Array of revealed swap intents
     * @param token0 The currency0 of the pool
     * @return netDelta0 Net delta for currency0
     * @return netDelta1 Net delta for currency1
     * @return contributions Array of user contributions for distribution
     */
    function _processReveals(
        PoolId poolId,
        SwapIntent[] calldata reveals,
        Currency token0
    ) internal returns (
        int256 netDelta0,
        int256 netDelta1,
        UserContribution[] memory contributions
    ) {
        Commitment[] storage poolCommitments = commitments[poolId];
        contributions = new UserContribution[](reveals.length);

        for (uint256 i = 0; i < reveals.length; i++) {
            SwapIntent calldata intent = reveals[i];

            // Verify deadline
            if (block.timestamp > intent.deadline) revert DeadlineExpired();

            // Verify nonce uniqueness
            if (usedNonces[poolId][intent.user][intent.nonce]) revert InvalidNonce();

            // Compute and verify commitment hash
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

            // Find and validate commitment
            bool found = false;
            for (uint256 j = 0; j < poolCommitments.length; j++) {
                if (
                    poolCommitments[j].commitmentHash == computedHash &&
                    !poolCommitments[j].revealed
                ) {
                    poolCommitments[j].revealed = true;
                    found = true;
                    emit CommitmentRevealed(poolId, computedHash, intent.user);
                    break;
                }
            }

            if (!found) revert InvalidCommitment();

            // Mark nonce as used
            usedNonces[poolId][intent.user][intent.nonce] = true;

            // Store user contribution for distribution
            contributions[i] = UserContribution({
                recipient: intent.recipient,
                inputAmount: intent.amountIn,
                inputCurrency: intent.tokenIn,
                outputCurrency: intent.tokenOut,
                minAmountOut: intent.minAmountOut
            });

            // Accumulate deltas
            if (Currency.unwrap(intent.tokenIn) == Currency.unwrap(token0)) {
                netDelta0 += int256(intent.amountIn);
                netDelta1 -= int256(intent.minAmountOut);
            } else {
                netDelta1 += int256(intent.amountIn);
                netDelta0 -= int256(intent.minAmountOut);
            }

            // Transfer tokens directly from user to PoolManager (no custody in hook)
            // Users must approve the hook, but tokens go directly to PoolManager
            IERC20(Currency.unwrap(intent.tokenIn)).transferFrom(
                intent.user,
                address(poolManager),
                intent.amountIn
            );
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
        SwapCallbackData memory callbackData = SwapCallbackData({
            key: key,
            netAmount0: netDelta0,
            netAmount1: netDelta1,
            zeroForOne: zeroForOne,
            sqrtPriceLimitX96: 0
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

        // Input tokens were already transferred directly to PoolManager in _processReveals
        // Now we just need to sync and settle
        // Sync input currency to checkpoint the balance in PoolManager
        poolManager.sync(inputCurrency);

        // Settle input tokens (pay to pool)
        // settle() will use the tokens that were transferred to PoolManager
        poolManager.settle();

        // Execute the swap
        SwapParams memory swapParams = SwapParams({
            zeroForOne: callbackData.zeroForOne,
            amountSpecified: callbackData.zeroForOne ? callbackData.netAmount0 : callbackData.netAmount1,
            sqrtPriceLimitX96: callbackData.sqrtPriceLimitX96
        });

        BalanceDelta swapDelta = poolManager.swap(
            callbackData.key,
            swapParams,
            ""
        );

        // Take output tokens (receive from pool)
        // Note: We take to hook first, then distribute to recipients
        // This is necessary because we need to calculate proportional shares
        // Future optimization: could take directly to recipients if we pre-calculate shares
        int256 outputDelta = callbackData.zeroForOne
            ? swapDelta.amount1()
            : swapDelta.amount0();

        if (outputDelta > 0) {
            poolManager.take(outputCurrency, address(this), uint256(outputDelta));
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
                
                emit TokensDistributed(poolId, contrib.recipient, outputToken, share);
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
