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
    
    // Token addresses (set via env or use defaults)
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant USDT = 0x0Ea67A670a4182Db6eB18A6aAbC0f75195ef2EfC; // Will be set from env or deployment
    
    // Pool parameters
    uint24 constant FEE = 3000; // 0.3%
    int24 constant TICK_SPACING = 60;
    address constant HOOK = 0x4493E9d873c049f15ca4Fc1eB94044a5bE3440c4;
    
    // Liquidity amounts
    uint256 constant AMOUNT0_DESIRED = 10 * 10**6; // 10 USDC (6 decimals)
    uint256 constant AMOUNT1_DESIRED = 102 * 10**17; // 10.2 USDT (18 decimals)
    uint128 constant AMOUNT0_MIN = uint128(AMOUNT0_DESIRED * 95 / 100); // 5% slippage
    uint128 constant AMOUNT1_MIN = uint128(AMOUNT1_DESIRED * 95 / 100); // 5% slippage

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Get USDT address from env or use default
        address usdtAddress = vm.envOr("MOCK_USDT_ADDRESS", USDT);
        if (usdtAddress == address(0)) {
            usdtAddress = vm.envOr("USDT_ADDRESS", address(0));
        }
        require(usdtAddress != address(0), "USDT_ADDRESS or MOCK_USDT_ADDRESS must be set");

        console.log("Setting up pool and adding liquidity...");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOL_MANAGER);
        console.log("PositionManager:", POSITION_MANAGER);
        console.log("USDC:", USDC);
        console.log("USDT:", usdtAddress);
        console.log("Hook:", HOOK);

        vm.startBroadcast(deployerPrivateKey);

        IPoolManager poolManager = IPoolManager(POOL_MANAGER);
        IPositionManager positionManager = IPositionManager(POSITION_MANAGER);
        
        // Create pool key
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(usdtAddress),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });

        // Step 1: Initialize pool (if not already initialized)
        console.log("\n=== Step 1: Initializing Pool ===");
        uint160 sqrtPriceX96 = uint160(79228162514264337593543950336); // 2^96 (1:1 price)
        
        // Check if pool is already initialized by reading slot0 using extsload
        PoolId poolId = poolKey.toId();
        
        // Calculate slot0 storage slot: keccak256(abi.encode(poolId, uint256(0)))
        bytes32 slot0Slot = keccak256(abi.encode(poolId, uint256(0)));
        
        // Try to read slot0 using extsload (view call, won't be broadcast)
        bool poolInitialized = false;
        try poolManager.extsload(slot0Slot) returns (bytes32 slot0Value) {
            // Check if sqrtPriceX96 (lower 160 bits) is non-zero
            uint160 sqrtPrice = uint160(uint256(slot0Value));
            poolInitialized = sqrtPrice != 0;
        } catch {}
        
        if (!poolInitialized) {
            poolManager.initialize(poolKey, sqrtPriceX96);
            console.log("Pool initialized");
        } else {
            console.log("Pool already initialized, skipping...");
        }

        // Step 2: Approve tokens via Permit2
        console.log("\n=== Step 2: Approving Tokens via Permit2 ===");
        IERC20 usdc = IERC20(USDC);
        IERC20 usdt = IERC20(usdtAddress);
        IAllowanceTransfer permit2 = IAllowanceTransfer(PERMIT2);
        
        // Step 2a: Approve tokens to Permit2
        uint256 usdcPermit2Allowance = usdc.allowance(deployer, PERMIT2);
        uint256 usdtPermit2Allowance = usdt.allowance(deployer, PERMIT2);
        
        if (usdcPermit2Allowance < AMOUNT0_DESIRED) {
            usdc.approve(PERMIT2, type(uint256).max);
            console.log("USDC approved to Permit2");
        } else {
            console.log("USDC already approved to Permit2");
        }
        
        if (usdtPermit2Allowance < AMOUNT1_DESIRED) {
            usdt.approve(PERMIT2, type(uint256).max);
            console.log("USDT approved to Permit2");
        } else {
            console.log("USDT already approved to Permit2");
        }
        
        // Step 2b: Approve PositionManager as spender in Permit2
        // Check if already approved
        (uint160 amount, uint48 expiration, uint48 nonce) = permit2.allowance(deployer, USDC, POSITION_MANAGER);
        if (amount == 0 || expiration < block.timestamp) {
            permit2.approve(USDC, POSITION_MANAGER, type(uint160).max, type(uint48).max);
            console.log("PositionManager approved for USDC in Permit2");
        } else {
            console.log("PositionManager already approved for USDC in Permit2");
        }
        
        (amount, expiration, nonce) = permit2.allowance(deployer, usdtAddress, POSITION_MANAGER);
        if (amount == 0 || expiration < block.timestamp) {
            permit2.approve(usdtAddress, POSITION_MANAGER, type(uint160).max, type(uint48).max);
            console.log("PositionManager approved for USDT in Permit2");
        } else {
            console.log("PositionManager already approved for USDT in Permit2");
        }

        // Step 3: Calculate liquidity
        console.log("\n=== Step 3: Calculating Liquidity ===");
        int24 tickLower = -60;
        int24 tickUpper = 60;
        
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);
        
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
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
        console.log("  Currency0:", USDC);
        console.log("  Currency1:", usdtAddress);
        console.log("  Fee:", FEE);
        console.log("  Tick Spacing:", TICK_SPACING);
        console.log("  Hooks:", HOOK);
    }
}
