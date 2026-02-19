// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {Groth16Verifier} from "../CommitmentVerifier.sol";
import {PrivBatchHook} from "../PrivBatchHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";
import {MockPoolManagerForPerp} from "./MockPoolManagerForPerp.sol";
import {PerpPositionManager} from "../PerpPositionManager.sol";
import {MockUSDC} from "../MockUSDC.sol";
import {MockUSDT} from "../MockUSDT.sol";
import {MockOracleAdapter} from "./MockOracleAdapter.sol";

/**
 * @title PerpBatchExecutionTest
 * @notice Tests for PrivBatchHook perp flow: commit/reveal, batch execution guards, integration with PerpPositionManager.
 */
contract PerpBatchExecutionTest is Test {
    using PoolIdLibrary for PoolKey;

    Groth16Verifier verifier;
    MockPoolManagerForPerp mockPoolManager;
    PrivBatchHook hook;
    PerpPositionManager perpManager;
    MockUSDC usdc;
    MockUSDT usdt;
    MockOracleAdapter oracle;

    address owner;
    address user1;
    address user2;
    address constant MARKET_ETH = address(0x1);
    bytes32 constant POOL_ID_ETH = keccak256("ETH/USDC");
    uint256 constant MAX_LEVERAGE = 10e18;
    uint256 constant MAINTENANCE_MARGIN = 0.05e18;
    uint256 constant BATCH_INTERVAL = 5 minutes;
    uint256 constant SIZE = 1e18;
    uint256 constant LEVERAGE = 5e18;
    uint256 constant MOCK_EXECUTION_PRICE = 2800e18;

    PoolKey poolKey;
    PoolId poolId;

    function setUp() public {
        owner = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        usdc = new MockUSDC();
        usdt = new MockUSDT();
        usdc.mintWei(owner, 10_000_000 * 1e6);
        usdt.mintWei(owner, 10_000_000 * 1e18);

        oracle = new MockOracleAdapter();
        oracle.setPrice(MARKET_ETH, MOCK_EXECUTION_PRICE);

        perpManager = new PerpPositionManager(IERC20(address(usdc)), owner, address(0));
        perpManager.createMarket(MARKET_ETH, POOL_ID_ETH, address(oracle), MAX_LEVERAGE, MAINTENANCE_MARGIN);

        verifier = new Groth16Verifier();
        mockPoolManager = new MockPoolManagerForPerp();

        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        (address hookAddress, bytes32 salt) = HookMiner.find(
            owner,
            flags,
            type(PrivBatchHook).creationCode,
            abi.encode(IPoolManager(address(mockPoolManager)), address(verifier))
        );
        hook = new PrivBatchHook{salt: salt}(IPoolManager(address(mockPoolManager)), verifier);
        require(address(hook) == hookAddress, "Hook address mismatch");

        perpManager.setExecutor(address(hook));
        hook.setPerpPositionManagerAddress(address(perpManager));

        // PoolKey: currency0 < currency1 by address
        address tok0 = address(usdc) < address(usdt) ? address(usdc) : address(usdt);
        address tok1 = address(usdc) < address(usdt) ? address(usdt) : address(usdc);
        poolKey = PoolKey({
            currency0: Currency.wrap(tok0),
            currency1: Currency.wrap(tok1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        // Fund mock with base (1e6) and hook with quote (2800e6) so callback can settle/take
        _mintWeiIfMock(tok0, address(mockPoolManager), 1e6);
        _mintWeiIfMock(tok1, address(hook), 2800e6);
        _mintWeiIfMock(tok0, address(hook), 2800e6);
        _mintWeiIfMock(tok1, address(mockPoolManager), 1e6);
    }

    function test_SubmitPerpCommitment_Stored() public {
        bytes32 hash = keccak256("commitment1");
        hook.submitPerpCommitment(poolKey, hash);
        (bytes32 h,,, bool revealed) = hook.perpCommitments(poolId, 0);
        assertEq(h, hash);
        assertFalse(revealed);
    }

    function test_ComputePerpCommitmentHash_MatchesReveal() public {
        PrivBatchHook.PerpIntent memory intent = PrivBatchHook.PerpIntent({
            user: user1,
            market: MARKET_ETH,
            size: SIZE,
            isLong: true,
            isOpen: true,
            collateral: 500e18,
            leverage: LEVERAGE,
            nonce: 0,
            deadline: block.timestamp + 1 hours
        });
        bytes32 computed = hook.computePerpCommitmentHash(intent);
        assertEq(
            computed,
            keccak256(abi.encode(
                intent.user,
                intent.market,
                intent.size,
                intent.isLong,
                intent.isOpen,
                intent.collateral,
                intent.leverage,
                intent.nonce,
                intent.deadline
            ))
        );
    }

    function test_SubmitPerpReveal_StoresIntent() public {
        uint256 deadline = block.timestamp + 1 hours;
        PrivBatchHook.PerpIntent memory intent = PrivBatchHook.PerpIntent({
            user: user1,
            market: MARKET_ETH,
            size: SIZE,
            isLong: true,
            isOpen: true,
            collateral: 500e18,
            leverage: LEVERAGE,
            nonce: 0,
            deadline: deadline
        });
        bytes32 hash = hook.computePerpCommitmentHash(intent);
        hook.submitPerpCommitment(poolKey, hash);
        hook.submitPerpReveal(poolKey, intent);
        // Intent is in storage; we verify via batch execution later
    }

    function test_RevertWhen_PerpManagerNotSet() public {
        PrivBatchHook hookNoManager = _deployHookWithoutPerpManager();
        PoolKey memory keyNoManager = PoolKey({
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            fee: poolKey.fee,
            tickSpacing: poolKey.tickSpacing,
            hooks: IHooks(address(hookNoManager))
        });
        bytes32 h1 = keccak256("1");
        bytes32 h2 = keccak256("2");
        hookNoManager.submitPerpCommitment(keyNoManager, h1);
        hookNoManager.submitPerpCommitment(keyNoManager, h2);
        vm.warp(block.timestamp + BATCH_INTERVAL + 1);
        vm.expectRevert(PrivBatchHook.PerpManagerNotSet.selector);
        hookNoManager.revealAndBatchExecutePerps(keyNoManager, _array(h1, h2), true);
    }

    function test_RevertWhen_InsufficientCommitments() public {
        bytes32 h = keccak256("only-one");
        hook.submitPerpCommitment(poolKey, h);
        vm.warp(block.timestamp + BATCH_INTERVAL + 1);
        bytes32[] memory oneHash = new bytes32[](1);
        oneHash[0] = h;
        vm.expectRevert(PrivBatchHook.InsufficientCommitments.selector);
        hook.revealAndBatchExecutePerps(poolKey, oneHash, true);
    }

    function test_RevertWhen_BatchIntervalNotElapsed() public {
        uint256 deadline = block.timestamp + 1 hours;
        PrivBatchHook.PerpIntent memory i1 = _intent(user1, true, 0, deadline);
        PrivBatchHook.PerpIntent memory i2 = _intent(user2, true, 0, deadline);
        bytes32 h1 = hook.computePerpCommitmentHash(i1);
        bytes32 h2 = hook.computePerpCommitmentHash(i2);
        hook.submitPerpCommitment(poolKey, h1);
        hook.submitPerpCommitment(poolKey, h2);
        hook.submitPerpReveal(poolKey, i1);
        hook.submitPerpReveal(poolKey, i2);
        vm.expectRevert(PrivBatchHook.BatchConditionsNotMet.selector);
        hook.revealAndBatchExecutePerps(poolKey, _array(h1, h2), true);
    }

    function test_RevertWhen_InvalidPerpCommitment_NoReveal() public {
        bytes32 h1 = keccak256("no-reveal-1");
        bytes32 h2 = keccak256("no-reveal-2");
        hook.submitPerpCommitment(poolKey, h1);
        hook.submitPerpCommitment(poolKey, h2);
        vm.warp(block.timestamp + BATCH_INTERVAL + 1);
        vm.expectRevert(PrivBatchHook.InvalidPerpCommitment.selector);
        hook.revealAndBatchExecutePerps(poolKey, _array(h1, h2), true);
    }

    function test_FullBatchExecution_OpensPositions() public {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 collateral = (SIZE * MOCK_EXECUTION_PRICE) / LEVERAGE;
        uint256 depositRaw = 1000 * 1e6; // 1000 USDC (6 decimals)

        usdc.mintWei(user1, depositRaw);
        usdc.mintWei(user2, depositRaw);
        vm.startPrank(user1);
        usdc.approve(address(perpManager), depositRaw);
        perpManager.depositCollateral(user1, depositRaw);
        vm.stopPrank();
        vm.startPrank(user2);
        usdc.approve(address(perpManager), depositRaw);
        perpManager.depositCollateral(user2, depositRaw);
        vm.stopPrank();

        PrivBatchHook.PerpIntent memory i1 = PrivBatchHook.PerpIntent({
            user: user1,
            market: MARKET_ETH,
            size: SIZE,
            isLong: true,
            isOpen: true,
            collateral: collateral,
            leverage: LEVERAGE,
            nonce: 0,
            deadline: deadline
        });
        PrivBatchHook.PerpIntent memory i2 = PrivBatchHook.PerpIntent({
            user: user2,
            market: MARKET_ETH,
            size: SIZE,
            isLong: true,
            isOpen: true,
            collateral: collateral,
            leverage: LEVERAGE,
            nonce: 0,
            deadline: deadline
        });

        bytes32 h1 = hook.computePerpCommitmentHash(i1);
        bytes32 h2 = hook.computePerpCommitmentHash(i2);
        hook.submitPerpCommitment(poolKey, h1);
        hook.submitPerpCommitment(poolKey, h2);
        hook.submitPerpReveal(poolKey, i1);
        hook.submitPerpReveal(poolKey, i2);

        vm.warp(block.timestamp + BATCH_INTERVAL + 1);
        hook.revealAndBatchExecutePerps(poolKey, _array(h1, h2), true);

        (int256 size1,,,,,) = perpManager.getPosition(user1, MARKET_ETH);
        (int256 size2,,,,,) = perpManager.getPosition(user2, MARKET_ETH);
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(size1, int256(SIZE));
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(size2, int256(SIZE));
    }

    function _intent(address u, bool isLong, uint256 nonce, uint256 deadline)
        internal
        view
        returns (PrivBatchHook.PerpIntent memory)
    {
        uint256 collateral = (SIZE * MOCK_EXECUTION_PRICE) / LEVERAGE;
        return PrivBatchHook.PerpIntent({
            user: u,
            market: MARKET_ETH,
            size: SIZE,
            isLong: isLong,
            isOpen: true,
            collateral: collateral,
            leverage: LEVERAGE,
            nonce: nonce,
            deadline: deadline
        });
    }

    function _array(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory) {
        bytes32[] memory arr = new bytes32[](2);
        arr[0] = a;
        arr[1] = b;
        return arr;
    }

    function _mintWeiIfMock(address token, address to, uint256 amount) internal {
        if (token == address(usdc)) usdc.mintWei(to, amount);
        else if (token == address(usdt)) usdt.mintWei(to, amount);
    }

    function _deployHookWithoutPerpManager() internal returns (PrivBatchHook) {
        MockPoolManagerForPerp mock2 = new MockPoolManagerForPerp();
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        (address hookAddress, bytes32 salt) = HookMiner.find(
            owner,
            flags,
            type(PrivBatchHook).creationCode,
            abi.encode(IPoolManager(address(mock2)), address(verifier))
        );
        return new PrivBatchHook{salt: salt}(IPoolManager(address(mock2)), verifier);
    }
}
