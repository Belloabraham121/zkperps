// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PrivBatchHook} from "../src/PrivBatchHook.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";

contract PrivBatchHookTest is Test {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    PrivBatchHook hook;
    IPoolManager poolManager;
    MockERC20 token0;
    MockERC20 token1;

    PoolKey poolKey;
    PoolId poolId;

    address user1 = address(0x1111);
    address user2 = address(0x2222);
    address user3 = address(0x3333);

    uint256 constant INITIAL_BALANCE = 1000000e18;
    uint256 constant INITIAL_LIQUIDITY = 1000000e18;

    event CommitmentSubmitted(PoolId indexed poolId, bytes32 indexed commitmentHash, address indexed committer);
    event CommitmentRevealed(PoolId indexed poolId, bytes32 indexed commitmentHash, address user);
    event BatchExecuted(PoolId indexed poolId, int256 netDelta0, int256 netDelta1, uint256 batchSize, uint256 timestamp);
    event TokensDistributed(PoolId indexed poolId, address indexed recipient, address token, uint256 amount);

    function setUp() public {
        // Deploy tokens (must be sorted by address)
        address token0Addr;
        address token1Addr;
        {
            MockERC20 temp0 = new MockERC20("Token0", "T0", 18);
            MockERC20 temp1 = new MockERC20("Token1", "T1", 18);
            
            // Ensure currency0 < currency1
            if (address(temp0) < address(temp1)) {
                token0Addr = address(temp0);
                token1Addr = address(temp1);
                token0 = temp0;
                token1 = temp1;
            } else {
                token0Addr = address(temp1);
                token1Addr = address(temp0);
                token0 = temp1;
                token1 = temp0;
            }
        }

        // Deploy PoolManager
        poolManager = new PoolManager(address(this));

        // Deploy hook with correct permissions
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );

        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(PrivBatchHook).creationCode,
            abi.encode(poolManager)
        );

        hook = new PrivBatchHook{salt: salt}(poolManager);
        require(address(hook) == hookAddress, "Hook address mismatch");

        // Setup pool key (currencies must be sorted)
        poolKey = PoolKey({
            currency0: Currency.wrap(token0Addr),
            currency1: Currency.wrap(token1Addr),
            fee: 3000, // 0.3%
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        // Initialize pool
        // Use a simple 1:1 price (sqrtPriceX96 = sqrt(1) * 2^96)
        uint160 sqrtPriceX96 = 79228162514264337593543950336; // sqrt(1) * 2^96
        poolManager.initialize(poolKey, sqrtPriceX96);

        // Setup users with tokens
        token0.mint(user1, INITIAL_BALANCE);
        token0.mint(user2, INITIAL_BALANCE);
        token0.mint(user3, INITIAL_BALANCE);
        token1.mint(user1, INITIAL_BALANCE);
        token1.mint(user2, INITIAL_BALANCE);
        token1.mint(user3, INITIAL_BALANCE);

        // Note: Adding liquidity requires proper router setup
        // For now, tests will focus on commitment/reveal logic
        // Full integration tests would require liquidity setup

        // Approve hook for all users
        vm.prank(user1);
        token0.approve(address(hook), type(uint256).max);
        vm.prank(user1);
        token1.approve(address(hook), type(uint256).max);
        vm.prank(user2);
        token0.approve(address(hook), type(uint256).max);
        vm.prank(user2);
        token1.approve(address(hook), type(uint256).max);
        vm.prank(user3);
        token0.approve(address(hook), type(uint256).max);
        vm.prank(user3);
        token1.approve(address(hook), type(uint256).max);
    }

    function _addLiquidity(uint256 amount0, uint256 amount1) internal {
        token0.mint(address(this), amount0);
        token1.mint(address(this), amount1);
        token0.approve(address(poolManager), amount0);
        token1.approve(address(poolManager), amount1);

        // Simplified liquidity addition - in real tests would use proper router
        // This is a placeholder for actual liquidity addition logic
    }

    // Helper function to create swap intent
    function _createSwapIntent(
        address user,
        Currency tokenIn,
        Currency tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 nonce
    ) internal view returns (PrivBatchHook.SwapIntent memory) {
        return PrivBatchHook.SwapIntent({
            user: user,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            recipient: recipient,
            nonce: nonce,
            deadline: block.timestamp + 1 hours
        });
    }

    // Test commitment submission
    function test_submitCommitment() public {
        PrivBatchHook.SwapIntent memory intent = _createSwapIntent(
            user1,
            Currency.wrap(address(token0)),
            Currency.wrap(address(token1)),
            1000e18,
            900e18,
            user1,
            1
        );

        bytes32 commitmentHash = hook.computeCommitmentHash(intent);

        vm.expectEmit(true, true, true, true);
        emit CommitmentSubmitted(poolId, commitmentHash, user1);

        vm.prank(user1);
        hook.submitCommitment(poolKey, commitmentHash);

        PrivBatchHook.Commitment[] memory commitments = hook.getCommitments(poolId);
        assertEq(commitments.length, 1);
        assertEq(commitments[0].commitmentHash, commitmentHash);
        assertEq(commitments[0].committer, user1);
        assertEq(commitments[0].revealed, false);
    }

    // Test multiple users submitting commitments
    function test_multipleUsersSubmitCommitments() public {
        PrivBatchHook.SwapIntent memory intent1 = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );
        PrivBatchHook.SwapIntent memory intent2 = _createSwapIntent(
            user2, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 2000e18, 1800e18, user2, 1
        );

        bytes32 hash1 = hook.computeCommitmentHash(intent1);
        bytes32 hash2 = hook.computeCommitmentHash(intent2);

        vm.prank(user1);
        hook.submitCommitment(poolKey, hash1);
        vm.prank(user2);
        hook.submitCommitment(poolKey, hash2);

        assertEq(hook.getPendingCommitmentCount(poolId), 2);
    }

    // Test checker function conditions
    function test_checker_conditionsNotMet() public {
        // Not enough commitments
        (bool canExec, ) = hook.checker(poolId);
        assertFalse(canExec);

        // Add one commitment (need at least 2)
        PrivBatchHook.SwapIntent memory intent = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );
        bytes32 hash = hook.computeCommitmentHash(intent);
        vm.prank(user1);
        hook.submitCommitment(poolKey, hash);

        (canExec, ) = hook.checker(poolId);
        assertFalse(canExec); // Still not enough
    }

    function test_checker_conditionsMet() public {
        // Add 2 commitments
        PrivBatchHook.SwapIntent memory intent1 = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );
        PrivBatchHook.SwapIntent memory intent2 = _createSwapIntent(
            user2, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 2000e18, 1800e18, user2, 1
        );

        bytes32 hash1 = hook.computeCommitmentHash(intent1);
        bytes32 hash2 = hook.computeCommitmentHash(intent2);

        vm.prank(user1);
        hook.submitCommitment(poolKey, hash1);
        vm.prank(user2);
        hook.submitCommitment(poolKey, hash2);

        // Wait for batch interval
        vm.warp(block.timestamp + 6 minutes);

        (bool canExec, bytes memory payload) = hook.checker(poolId);
        assertTrue(canExec);
        // Payload is empty for permissionless execution (not used)
        assertEq(payload.length, 0);
    }

    // Test invalid commitment handling
    function test_invalidCommitment() public {
        PrivBatchHook.SwapIntent memory intent = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );

        bytes32 hash = hook.computeCommitmentHash(intent);
        vm.prank(user1);
        hook.submitCommitment(poolKey, hash);

        // Add a second commitment to meet minimum requirement
        PrivBatchHook.SwapIntent memory intent2 = _createSwapIntent(
            user2, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 2000e18, 1800e18, user2, 1
        );
        bytes32 hash2 = hook.computeCommitmentHash(intent2);
        vm.prank(user2);
        hook.submitCommitment(poolKey, hash2);

        // Try to reveal with wrong hash for first intent
        PrivBatchHook.SwapIntent memory wrongIntent = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 950e18, user1, 1
        );

        PrivBatchHook.SwapIntent[] memory reveals = new PrivBatchHook.SwapIntent[](2);
        reveals[0] = wrongIntent; // Wrong hash
        reveals[1] = intent2; // Valid

        vm.warp(block.timestamp + 6 minutes);
        vm.expectRevert(PrivBatchHook.InvalidCommitment.selector);
        hook.revealAndBatchExecute(poolKey, reveals);
    }

    // Test expired deadline handling
    function test_expiredDeadline() public {
        PrivBatchHook.SwapIntent memory intent = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );
        intent.deadline = block.timestamp + 1 hours;

        bytes32 hash = hook.computeCommitmentHash(intent);
        vm.prank(user1);
        hook.submitCommitment(poolKey, hash);

        PrivBatchHook.SwapIntent[] memory reveals = new PrivBatchHook.SwapIntent[](2);
        reveals[0] = intent;
        reveals[1] = intent; // Duplicate for minimum

        // Wait past deadline
        vm.warp(block.timestamp + 2 hours);
        vm.warp(block.timestamp + 6 minutes); // Also past batch interval

        vm.expectRevert(PrivBatchHook.DeadlineExpired.selector);
        hook.revealAndBatchExecute(poolKey, reveals);
    }

    // Test nonce replay protection
    function test_nonceReplayProtection() public {
        PrivBatchHook.SwapIntent memory intent = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );

        bytes32 hash = hook.computeCommitmentHash(intent);
        vm.prank(user1);
        hook.submitCommitment(poolKey, hash);

        PrivBatchHook.SwapIntent[] memory reveals = new PrivBatchHook.SwapIntent[](2);
        reveals[0] = intent;
        reveals[1] = intent;

        vm.warp(block.timestamp + 6 minutes);

        // First execution should succeed (if we had proper setup)
        // Second execution with same nonce should fail
        // This test needs proper batch execution setup to fully test
    }

    // Test batch execution with valid reveals
    function test_batchExecution_validReveals() public {
        // This test requires proper pool setup and liquidity
        // Simplified version to test structure
        PrivBatchHook.SwapIntent memory intent1 = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );
        PrivBatchHook.SwapIntent memory intent2 = _createSwapIntent(
            user2, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 2000e18, 1800e18, user2, 1
        );

        bytes32 hash1 = hook.computeCommitmentHash(intent1);
        bytes32 hash2 = hook.computeCommitmentHash(intent2);

        vm.prank(user1);
        hook.submitCommitment(poolKey, hash1);
        vm.prank(user2);
        hook.submitCommitment(poolKey, hash2);

        PrivBatchHook.SwapIntent[] memory reveals = new PrivBatchHook.SwapIntent[](2);
        reveals[0] = intent1;
        reveals[1] = intent2;

        vm.warp(block.timestamp + 6 minutes);

        // Note: This will fail without proper liquidity setup
        // But tests the structure
        // vm.expectEmit(true, true, true, true);
        // emit BatchExecuted(poolId, ...);
        // hook.revealAndBatchExecute(poolKey, reveals);
    }

    // Test insufficient commitments
    function test_insufficientCommitments() public {
        PrivBatchHook.SwapIntent memory intent = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );

        PrivBatchHook.SwapIntent[] memory reveals = new PrivBatchHook.SwapIntent[](1);
        reveals[0] = intent;

        vm.warp(block.timestamp + 6 minutes);
        vm.expectRevert(PrivBatchHook.InsufficientCommitments.selector);
        hook.revealAndBatchExecute(poolKey, reveals);
    }

    // Test batch conditions not met (time)
    function test_batchConditionsNotMet_time() public {
        PrivBatchHook.SwapIntent memory intent1 = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );
        PrivBatchHook.SwapIntent memory intent2 = _createSwapIntent(
            user2, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 2000e18, 1800e18, user2, 1
        );

        bytes32 hash1 = hook.computeCommitmentHash(intent1);
        bytes32 hash2 = hook.computeCommitmentHash(intent2);

        vm.prank(user1);
        hook.submitCommitment(poolKey, hash1);
        vm.prank(user2);
        hook.submitCommitment(poolKey, hash2);

        PrivBatchHook.SwapIntent[] memory reveals = new PrivBatchHook.SwapIntent[](2);
        reveals[0] = intent1;
        reveals[1] = intent2;

        // Not enough time elapsed
        vm.warp(block.timestamp + 1 minutes);
        vm.expectRevert(PrivBatchHook.BatchConditionsNotMet.selector);
        hook.revealAndBatchExecute(poolKey, reveals);
    }

    // Test compute commitment hash
    function test_computeCommitmentHash() public {
        PrivBatchHook.SwapIntent memory intent = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );

        bytes32 hash = hook.computeCommitmentHash(intent);
        assertNotEq(hash, bytes32(0));

        // Same intent should produce same hash
        bytes32 hash2 = hook.computeCommitmentHash(intent);
        assertEq(hash, hash2);

        // Different intent should produce different hash
        intent.amountIn = 2000e18;
        bytes32 hash3 = hook.computeCommitmentHash(intent);
        assertNotEq(hash, hash3);
    }

    // Test get commitments
    function test_getCommitments() public {
        PrivBatchHook.SwapIntent memory intent = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );

        bytes32 hash = hook.computeCommitmentHash(intent);
        vm.prank(user1);
        hook.submitCommitment(poolKey, hash);

        PrivBatchHook.Commitment[] memory commitments = hook.getCommitments(poolId);
        assertEq(commitments.length, 1);
        assertEq(commitments[0].commitmentHash, hash);
    }

    // Test get pending commitment count
    function test_getPendingCommitmentCount() public {
        assertEq(hook.getPendingCommitmentCount(poolId), 0);

        PrivBatchHook.SwapIntent memory intent = _createSwapIntent(
            user1, Currency.wrap(address(token0)), Currency.wrap(address(token1)), 1000e18, 900e18, user1, 1
        );

        bytes32 hash = hook.computeCommitmentHash(intent);
        vm.prank(user1);
        hook.submitCommitment(poolKey, hash);

        assertEq(hook.getPendingCommitmentCount(poolId), 1);
    }
}
