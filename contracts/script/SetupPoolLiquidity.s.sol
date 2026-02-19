// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {Planner, Plan} from "v4-periphery/test/shared/Planner.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

/**
 * @title SetupPoolLiquidity
 * @notice Initialize a V4 pool (with your hook) and add liquidity. Use for perp execution.
 * @dev Reads addresses from env; defaults match Uniswap V4 deployment below.
 *
 * Uniswap V4 deployment (this script uses PoolManager, PositionManager, Permit2):
 *   PoolManager           0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317
 *   Universal Router     0xefd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47
 *   PositionManager      0xAc631556d3d4019C95769033B5E719dD77124BAc
 *   StateView            0x9d467fa9062b6e9b1a46e26007ad82db116c67cb
 *   Quoter               0x7de51022d70a725b508085468052e25e22b5c4c9
 *   PoolSwapTest         0xf3a39c86dbd13c45365e57fb90fe413371f65af8
 *   PoolModifyLiquidityTest  0x9a8ca723f5dccb7926d00b71dec55c2fea1f50f7
 *   Permit2              0x000000000022D473030F116dDEE9F6B43aC78BA3
 *
 * Env (required for your deployment):
 *   PRIVATE_KEY         - deployer
 *   MOCK_USDC           - MockUSDC address (from Deploy.s.sol)
 *   MOCK_USDT           - MockUSDT address (from Deploy.s.sol)
 *   HOOK                - PrivBatchHook address (from Deploy.s.sol)
 *
 * Env (optional; defaults = above):
 *   POOL_MANAGER        - default PoolManager above
 *   POSITION_MANAGER    - default PositionManager above
 *
 * After running, use the printed POOL_ID when adding a market (AddMarket with POOL_ID= that value).
 * Currency order: currency0 < currency1 by address (script uses USDT=0, USDC=1).
 */
contract SetupPoolLiquidity is Script {
    using PoolIdLibrary for PoolKey;

    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint256 constant AMOUNT0_DESIRED = 102 * 10**17;
    uint256 constant AMOUNT1_DESIRED = 10 * 10**6;
    // forge-lint: disable-next-line(unsafe-typecast)
    uint128 constant AMOUNT0_MIN = uint128(AMOUNT0_DESIRED * 95 / 100);
    // forge-lint: disable-next-line(unsafe-typecast)
    uint128 constant AMOUNT1_MIN = uint128(AMOUNT1_DESIRED * 95 / 100);

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address poolManagerAddr = vm.envOr("POOL_MANAGER", address(0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317));
        address positionManagerAddr = vm.envOr("POSITION_MANAGER", address(0xAc631556d3d4019C95769033B5E719dD77124BAc));
        address mockUsdc = vm.envAddress("MOCK_USDC");
        address mockUsdt = vm.envAddress("MOCK_USDT");
        address hook = vm.envAddress("HOOK");

        // currency0 must be < currency1
        (address currency0, address currency1) = mockUsdt < mockUsdc ? (mockUsdt, mockUsdc) : (mockUsdc, mockUsdt);

        console.log("Setting up pool and adding liquidity...");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", poolManagerAddr);
        console.log("PositionManager:", positionManagerAddr);
        console.log("Currency0:", currency0);
        console.log("Currency1:", currency1);
        console.log("Hook:", hook);

        vm.startBroadcast(deployerPrivateKey);

        IPoolManager poolManager = IPoolManager(poolManagerAddr);
        IPositionManager positionManager = IPositionManager(positionManagerAddr);

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
        PoolId poolId = poolKey.toId();

        // Step 1: Initialize pool (if not already initialized)
        console.log("\n=== Step 1: Initializing Pool ===");
        uint160 sqrtPriceX96 = uint160(79228162514264337593543950336); // 2^96 (1:1 price)
        try poolManager.initialize(poolKey, sqrtPriceX96) returns (int24 tick) {
            console.log("Pool initialized, tick:", tick);
        } catch (bytes memory reason) {
            // Check if error is PoolAlreadyInitialized (0x7983c051)
            // forge-lint: disable-next-line(unsafe-typecast)
            if (reason.length >= 4 && bytes4(reason) == bytes4(0x7983c051)) {
                console.log("Pool already initialized, skipping...");
            } else {
                revert("Pool initialization failed");
            }
        }

        // Step 2: Approve tokens via Permit2
        console.log("\n=== Step 2: Approving Tokens via Permit2 ===");
        IERC20 token0 = IERC20(currency0);
        IERC20 token1 = IERC20(currency1);
        IAllowanceTransfer permit2 = IAllowanceTransfer(PERMIT2);

        uint256 bal0 = token0.balanceOf(deployer);
        uint256 bal1 = token1.balanceOf(deployer);
        console.log("Currency0 balance:", bal0);
        console.log("Currency1 balance:", bal1);
        require(bal0 >= AMOUNT0_DESIRED, "Insufficient currency0 balance");
        require(bal1 >= AMOUNT1_DESIRED, "Insufficient currency1 balance");

        token0.approve(PERMIT2, type(uint256).max);
        token1.approve(PERMIT2, type(uint256).max);
        permit2.approve(currency0, positionManagerAddr, type(uint160).max, type(uint48).max);
        permit2.approve(currency1, positionManagerAddr, type(uint160).max, type(uint48).max);
        console.log("Tokens approved to Permit2 and PositionManager");

        // Step 3: Calculate liquidity
        console.log("\n=== Step 3: Calculating Liquidity ===");
        int24 tickLower = -60;
        int24 tickUpper = 60;
        
        // Use initial price (2^96 = 1:1 price) - pool was initialized with this
        uint160 initialSqrtPriceX96 = uint160(79228162514264337593543950336);
        
        uint160 sqrtPriceAx96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBx96 = TickMath.getSqrtPriceAtTick(tickUpper);
        
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            initialSqrtPriceX96,
            sqrtPriceAx96,
            sqrtPriceBx96,
            AMOUNT0_DESIRED,
            AMOUNT1_DESIRED
        );
        
        console.log("Tick range:");
        console.log("  tickLower:", tickLower);
        console.log("  tickUpper:", tickUpper);
        console.log("Calculated liquidity:", uint256(liquidity));

        // Step 4: Mint liquidity position
        console.log("\n=== Step 4: Minting Liquidity Position ===");
        
        // Use Planner to encode actions properly
        Plan memory plan = Planner.init();
        plan.add(
            Actions.MINT_POSITION,
            abi.encode(
                poolKey,
                tickLower,
                tickUpper,
                liquidity,
                // forge-lint: disable-next-line(unsafe-typecast)
                uint128(AMOUNT0_DESIRED), // amount0Max
                // forge-lint: disable-next-line(unsafe-typecast)
                uint128(AMOUNT1_DESIRED), // amount1Max
                deployer, // recipient
                "" // hookData
            )
        );
        
        bytes memory encodedActions = plan.finalizeModifyLiquidityWithClose(poolKey);
        
        uint256 deadline = block.timestamp + 300; // 5 minutes
        
        console.log("Calling modifyLiquidities...");
        positionManager.modifyLiquidities(encodedActions, deadline);
        
        console.log("Liquidity position minted successfully!");

        vm.stopBroadcast();

        console.log("\n=== Setup Complete ===");
        console.log("Pool initialized and liquidity added");
        console.log("Use this POOL_ID when adding a market (AddMarket.s.sol):");
        console.logBytes32(PoolId.unwrap(poolId));
        console.log("Pool key: currency0=", currency0);
        console.log("         currency1=", currency1);
        console.log("         fee=", FEE);
        console.log("         tickSpacing=", TICK_SPACING);
        console.log("         hook=", hook);
    }
}
