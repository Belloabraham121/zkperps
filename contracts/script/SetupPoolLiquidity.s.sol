// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {Planner, Plan} from "v4-periphery/test/shared/Planner.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

contract SetupPoolLiquidity is Script {
    using PoolIdLibrary for PoolKey;
    
    // Base Sepolia addresses
    address constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address constant POSITION_MANAGER = 0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    
    // Mock token addresses
    // IMPORTANT: currency0 must be < currency1 in Uniswap V4
    // USDT (0x0Ea...) < USDC (0x983...) so: currency0 = USDT, currency1 = USDC
    address constant MOCK_USDT = 0x0Ea67A670a4182Db6eB18A6aAbC0f75195ef2EfC; // MockUSDT (18 decimals)
    address constant MOCK_USDC = 0x98346718c549Ed525201fC583796eCf2eaCC0aD5; // MockUSDC (6 decimals)
    
    // Pool parameters
    uint24 constant FEE = 3000; // 0.3%
    int24 constant TICK_SPACING = 60;
    address constant HOOK = 0x441aAB0C9BD5E1EF2924d1b6ca8a6495938500c4;
    
    // Liquidity amounts — currency0 = USDT (18 dec), currency1 = USDC (6 dec)
    uint256 constant AMOUNT0_DESIRED = 102 * 10**17; // 10.2 USDT (18 decimals) — currency0
    uint256 constant AMOUNT1_DESIRED = 10 * 10**6;   // 10 USDC (6 decimals) — currency1
    uint128 constant AMOUNT0_MIN = uint128(AMOUNT0_DESIRED * 95 / 100);
    uint128 constant AMOUNT1_MIN = uint128(AMOUNT1_DESIRED * 95 / 100);

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Setting up pool and adding liquidity...");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOL_MANAGER);
        console.log("PositionManager:", POSITION_MANAGER);
        console.log("Currency0 (USDT):", MOCK_USDT);
        console.log("Currency1 (USDC):", MOCK_USDC);
        console.log("Hook:", HOOK);

        vm.startBroadcast(deployerPrivateKey);

        IPoolManager poolManager = IPoolManager(POOL_MANAGER);
        IPositionManager positionManager = IPositionManager(POSITION_MANAGER);
        
        // Create pool key — currency0 must be < currency1
        // USDT (0x0Ea...) < USDC (0x983...) ✓
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(MOCK_USDT),
            currency1: Currency.wrap(MOCK_USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });

        // Step 1: Initialize pool (if not already initialized)
        console.log("\n=== Step 1: Initializing Pool ===");
        uint160 sqrtPriceX96 = uint160(79228162514264337593543950336); // 2^96 (1:1 price)
        try poolManager.initialize(poolKey, sqrtPriceX96) returns (int24 tick) {
            console.log("Pool initialized, tick:", tick);
        } catch (bytes memory reason) {
            // Check if error is PoolAlreadyInitialized (0x7983c051)
            if (reason.length >= 4 && bytes4(reason) == bytes4(0x7983c051)) {
                console.log("Pool already initialized, skipping...");
            } else {
                revert("Pool initialization failed");
            }
        }

        // Step 2: Approve tokens via Permit2
        console.log("\n=== Step 2: Approving Tokens via Permit2 ===");
        IERC20 usdt = IERC20(MOCK_USDT);
        IERC20 usdc = IERC20(MOCK_USDC);
        IAllowanceTransfer permit2 = IAllowanceTransfer(PERMIT2);
        
        // Check balances
        uint256 usdtBal = usdt.balanceOf(deployer);
        uint256 usdcBal = usdc.balanceOf(deployer);
        console.log("USDT balance (currency0):", usdtBal);
        console.log("USDC balance (currency1):", usdcBal);
        require(usdtBal >= AMOUNT0_DESIRED, "Insufficient USDT balance");
        require(usdcBal >= AMOUNT1_DESIRED, "Insufficient USDC balance");

        // Step 2a: Approve both tokens to Permit2
        usdt.approve(PERMIT2, type(uint256).max);
        console.log("USDT approved to Permit2");
        
        usdc.approve(PERMIT2, type(uint256).max);
        console.log("USDC approved to Permit2");
        
        // Step 2b: Approve PositionManager as spender in Permit2
        permit2.approve(MOCK_USDT, POSITION_MANAGER, type(uint160).max, type(uint48).max);
        console.log("PositionManager approved for USDT in Permit2");
        
        permit2.approve(MOCK_USDC, POSITION_MANAGER, type(uint160).max, type(uint48).max);
        console.log("PositionManager approved for USDC in Permit2");

        // Step 3: Calculate liquidity
        console.log("\n=== Step 3: Calculating Liquidity ===");
        int24 tickLower = -60;
        int24 tickUpper = 60;
        
        // Use initial price (2^96 = 1:1 price) - pool was initialized with this
        uint160 initialSqrtPriceX96 = uint160(79228162514264337593543950336);
        
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);
        
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            initialSqrtPriceX96,
            sqrtPriceAX96,
            sqrtPriceBX96,
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
                uint128(AMOUNT0_DESIRED), // amount0Max
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
        console.log("Pool Key:");
        console.log("  Currency0 (USDT):", MOCK_USDT);
        console.log("  Currency1 (USDC):", MOCK_USDC);
        console.log("  Fee:", FEE);
        console.log("  Tick Spacing:", TICK_SPACING);
        console.log("  Hooks:", HOOK);
    }
}
