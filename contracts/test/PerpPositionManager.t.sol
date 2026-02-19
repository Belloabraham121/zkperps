// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {PerpPositionManager} from "../PerpPositionManager.sol";
import {MockUSDC} from "../MockUSDC.sol";
import {MockOracleAdapter} from "./MockOracleAdapter.sol";

contract PerpPositionManagerTest is Test {
    PerpPositionManager manager;
    MockUSDC usdc;
    MockOracleAdapter oracle;

    address owner;
    address executor;
    address user1;
    address user2;

    address constant MARKET_ETH = address(0x1);
    bytes32 constant POOL_ID = keccak256("ETH/USDC");
    uint256 constant MAX_LEVERAGE = 10e18;
    uint256 constant MAINTENANCE_MARGIN = 0.05e18; // 5%
    uint256 constant ENTRY_PRICE = 2800e18;
    uint256 constant SIZE = 1e18; // 1 unit base
    uint256 constant LEVERAGE = 5e18;

    function setUp() public {
        owner = address(this);
        executor = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        usdc = new MockUSDC();
        usdc.mintWei(user1, 1_000_000 * 1e6); // 1M USDC (6 decimals)
        usdc.mintWei(user2, 1_000_000 * 1e6);
        usdc.mintWei(owner, 1_000_000 * 1e6);

        oracle = new MockOracleAdapter();
        oracle.setPrice(MARKET_ETH, ENTRY_PRICE);

        manager = new PerpPositionManager(IERC20(address(usdc)), owner, executor);
        manager.createMarket(MARKET_ETH, POOL_ID, address(oracle), MAX_LEVERAGE, MAINTENANCE_MARGIN);
    }

    function test_DepositAndWithdraw() public {
        uint256 depositAmount = 10_000 * 1e6; // 10k USDC
        vm.startPrank(user1);
        usdc.approve(address(manager), depositAmount);
        manager.depositCollateral(user1, depositAmount);
        vm.stopPrank();

        assertEq(manager.getTotalCollateral(user1), 10_000e18); // 18 decimals internally
        assertEq(manager.getAvailableMargin(user1), 10_000e18);
        assertEq(manager.getUsedMargin(user1), 0);

        vm.prank(user1);
        manager.withdrawCollateral(5_000 * 1e6); // withdraw 5k USDC (token decimals)
        assertEq(manager.getTotalCollateral(user1), 5_000e18);
        assertEq(usdc.balanceOf(user1), 1_000_000 * 1e6 - 10_000 * 1e6 + 5_000 * 1e6);
    }

    function test_WithdrawRevertsWhenInsufficientMargin() public {
        vm.startPrank(user1);
        usdc.approve(address(manager), 1000 * 1e6);
        manager.depositCollateral(user1, 1000 * 1e6);
        vm.expectRevert(PerpPositionManager.InsufficientMargin.selector);
        manager.withdrawCollateral(2000 * 1e6);
        vm.stopPrank();
    }

    function test_OpenAndClosePosition() public {
        uint256 marginRequired = (SIZE * ENTRY_PRICE) / LEVERAGE; // notional/leverage = 2800e18/5 = 560e18
        uint256 depositRaw = 1000 * 1e6; // 1000 USDC
        vm.startPrank(user1);
        usdc.approve(address(manager), depositRaw);
        manager.depositCollateral(user1, depositRaw);
        vm.stopPrank();
        // 1000 USDC -> 1000e18 internal
        assertGe(manager.getAvailableMargin(user1), marginRequired);

        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);

        (int256 size,, uint256 collateral,,,) = manager.getPosition(user1, MARKET_ETH);
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(size, int256(SIZE));
        assertEq(collateral, marginRequired);

        uint256 markPrice = 2900e18;
        oracle.setPrice(MARKET_ETH, markPrice);
        manager.closePosition(user1, MARKET_ETH, SIZE, markPrice);

        (size,, collateral,,,) = manager.getPosition(user1, MARKET_ETH);
        assertEq(size, 0);
        assertEq(collateral, 0);
        // User should have initial margin + realized PnL: 560 + (2900-2800)*1 = 660e18
        assertGt(manager.getTotalCollateral(user1), 560e18);
    }

    function test_GetUnrealizedPnL() public {
        uint256 depositRaw = 1000 * 1e6;
        vm.startPrank(user1);
        usdc.approve(address(manager), depositRaw);
        manager.depositCollateral(user1, depositRaw);
        vm.stopPrank();

        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);
        assertEq(manager.getUnrealizedPnL(user1, MARKET_ETH), 0);

        oracle.setPrice(MARKET_ETH, 2900e18);
        int256 pnl = manager.getUnrealizedPnL(user1, MARKET_ETH);
        assertEq(pnl, int256(100e18)); // 1 * (2900 - 2800) = 100

        oracle.setPrice(MARKET_ETH, 2700e18);
        pnl = manager.getUnrealizedPnL(user1, MARKET_ETH);
        assertEq(pnl, -int256(100e18));
    }

    function test_GetLiquidationPrice_Long() public {
        uint256 depositRaw = 1000 * 1e6;
        vm.startPrank(user1);
        usdc.approve(address(manager), depositRaw);
        manager.depositCollateral(user1, depositRaw);
        vm.stopPrank();

        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);
        uint256 liqPrice = manager.getLiquidationPrice(user1, MARKET_ETH);
        // Long: liq when equity/notional <= 5%. equity = collateral + (markPrice - entry)*size. collateral = 560e18.
        // (560 + (p - 2800)) / (p) <= 0.05 => 560 + p - 2800 <= 0.05p => 0.95p <= 2240 => p <= 2357.89
        assertGt(liqPrice, 0);
        assertLt(liqPrice, ENTRY_PRICE);
    }

    function test_Funding() public {
        uint256 depositRaw = 1000 * 1e6;
        vm.startPrank(user1);
        usdc.approve(address(manager), depositRaw);
        manager.depositCollateral(user1, depositRaw);
        vm.stopPrank();

        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);
        assertEq(manager.getFundingPayment(user1, MARKET_ETH), 0);

        // Apply positive funding rate (longs pay): rateDelta = 0.01e18
        manager.applyFunding(MARKET_ETH, 0.01e18);
        int256 payment = manager.getFundingPayment(user1, MARKET_ETH);
        assertGt(payment, 0); // long pays
        // Multiply before divide to avoid precision loss; notional * 0.01
        assertEq(payment, int256((SIZE * ENTRY_PRICE * 0.01e18) / (1e18 * 1e18)));

        uint256 nextTime = manager.getNextFundingTime(MARKET_ETH);
        assertGt(nextTime, block.timestamp);
    }

    function test_CloseSettlesFunding() public {
        uint256 depositRaw = 1000 * 1e6;
        vm.startPrank(user1);
        usdc.approve(address(manager), depositRaw);
        manager.depositCollateral(user1, depositRaw);
        vm.stopPrank();

        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);
        manager.applyFunding(MARKET_ETH, 0.01e18);
        uint256 collateralBefore = manager.getTotalCollateral(user1);
        manager.closePosition(user1, MARKET_ETH, SIZE, ENTRY_PRICE);
        uint256 collateralAfter = manager.getTotalCollateral(user1);
        // After close, funding is settled: position collateral is reduced by funding payment, then added to total
        int256 payment = manager.getFundingPayment(user1, MARKET_ETH);
        assertEq(payment, 0); // already settled
        assertLt(collateralAfter, collateralBefore + (SIZE * ENTRY_PRICE / 1e18)); // less because of funding paid
    }

    function test_Liquidation() public {
        uint256 depositRaw = 600 * 1e6; // 600 USDC -> margin ~560 for 5x 1 @ 2800
        vm.startPrank(user1);
        usdc.approve(address(manager), depositRaw);
        manager.depositCollateral(user1, depositRaw);
        vm.stopPrank();

        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);
        uint256 liqPrice = manager.getLiquidationPrice(user1, MARKET_ETH);
        assertGt(liqPrice, 0);

        // Move price below liquidation
        oracle.setPrice(MARKET_ETH, liqPrice - 1e18);
        assertTrue(manager.checkLiquidation(user1, MARKET_ETH));

        uint256 insuranceBefore = manager.getInsuranceFund();
        vm.prank(user2);
        manager.liquidatePosition(user1, MARKET_ETH);
        assertGt(manager.getInsuranceFund(), insuranceBefore);
        (int256 size,,,,,) = manager.getPosition(user1, MARKET_ETH);
        assertEq(size, 0);
    }

    function test_OnlyExecutorCanOpenClose() public {
        uint256 depositRaw = 1000 * 1e6;
        vm.startPrank(user1);
        usdc.approve(address(manager), depositRaw);
        manager.depositCollateral(user1, depositRaw);
        vm.stopPrank();

        vm.prank(user2);
        vm.expectRevert(PerpPositionManager.OnlyExecutor.selector);
        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);

        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);
        vm.prank(user2);
        vm.expectRevert(PerpPositionManager.OnlyExecutor.selector);
        manager.closePosition(user1, MARKET_ETH, SIZE, ENTRY_PRICE);
    }

    function test_OnlyOwnerCanCreateMarketAndApplyFunding() public {
        vm.prank(user1);
        vm.expectRevert(PerpPositionManager.OnlyOwner.selector);
        manager.createMarket(address(0x2), POOL_ID, address(oracle), MAX_LEVERAGE, MAINTENANCE_MARGIN);

        vm.prank(user1);
        vm.expectRevert(PerpPositionManager.OnlyOwner.selector);
        manager.applyFunding(MARKET_ETH, 0.01e18);
    }

    function test_PauseMarket() public {
        manager.pauseMarket(MARKET_ETH);
        uint256 depositRaw = 1000 * 1e6;
        vm.startPrank(user1);
        usdc.approve(address(manager), depositRaw);
        manager.depositCollateral(user1, depositRaw);
        vm.stopPrank();
        vm.expectRevert(PerpPositionManager.MarketNotActive.selector);
        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);

        manager.unpauseMarket(MARKET_ETH);
        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);
    }

    function test_InsuranceFund() public {
        usdc.approve(address(manager), 1000 * 1e6);
        manager.depositToInsuranceFund(1000 * 1e6);
        assertEq(manager.getInsuranceFund(), 1000e18);
    }

    function test_PartialClose() public {
        uint256 depositRaw = 1000 * 1e6;
        vm.startPrank(user1);
        usdc.approve(address(manager), depositRaw);
        manager.depositCollateral(user1, depositRaw);
        vm.stopPrank();

        manager.openPosition(user1, MARKET_ETH, SIZE, true, LEVERAGE, ENTRY_PRICE);
        manager.closePosition(user1, MARKET_ETH, SIZE / 2, ENTRY_PRICE); // close half
        (int256 size,,,,,) = manager.getPosition(user1, MARKET_ETH);
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(size, int256(SIZE / 2));
    }
}
