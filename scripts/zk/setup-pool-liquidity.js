#!/usr/bin/env node

/**
 * Setup Pool and Add Liquidity Script
 * 
 * This script:
 * 1. Initializes a Uniswap v4 pool with the PrivBatchHook
 * 2. Adds initial liquidity to the pool
 * 3. Verifies the pool is ready for batch swaps
 * 
 * Usage:
 *   node setup-pool-liquidity.js
 * 
 * Environment Variables:
 *   - PRIVATE_KEY: Private key for signing transactions
 *   - RPC_URL: Base Sepolia RPC URL
 *   - HOOK_ADDRESS: Deployed PrivBatchHook address
 *   - USDC_ADDRESS: USDC token address (optional, has default)
 *   - USDT_ADDRESS: USDT token address (optional, has default)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '../.env'),
    path.join(__dirname, '../../.env')
];

for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
        break;
    }
}

try {
    require('dotenv').config();
} catch (e) {
    // dotenv not installed, continue without it
}

// Base Sepolia addresses
const POOL_MANAGER = '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408'; // Base Sepolia PoolManager
const POSITION_MANAGER = process.env.POSITION_MANAGER_ADDRESS || '0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80'; // Base Sepolia PositionManager
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
// MockUSDT address - will be set after deployment or from env
const USDT_ADDRESS = process.env.USDT_ADDRESS || process.env.MOCK_USDT_ADDRESS;

// Minimal ABI for PoolManager
const POOL_MANAGER_ABI = [
    "function initialize((address,address,uint24,int24,address) key, uint160 sqrtPriceX96) returns (int24)",
    "function settle(Currency currency) returns (uint256)",
    "function take(Currency currency, address to, uint256 amount) returns (uint256)"
];

// ABI for PositionManager
const POSITION_MANAGER_ABI = [
    "function modifyLiquidities(bytes encodedActions, uint256 deadline) payable returns (bytes memory)"
];

// Actions constants (from Actions.sol)
const Actions = {
    INCREASE_LIQUIDITY: 0x00,
    DECREASE_LIQUIDITY: 0x01,
    MINT_POSITION: 0x02,
    BURN_POSITION: 0x03,
    SETTLE_PAIR: 0x0d,
    CLOSE_CURRENCY: 0x12,
    CLEAR_OR_TAKE: 0x13,
    SWEEP: 0x14
};

// ERC20 ABI
const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function transfer(address, uint256) returns (bool)"
];

/**
 * Calculate sqrt price from price ratio
 * For 1:1 price, sqrtPriceX96 = 2^96
 */
function calculateSqrtPriceX96(priceRatio = 1.0) {
    // sqrt(price) * 2^96
    // For 1:1, sqrt(1) * 2^96 = 2^96
    const sqrtPrice = Math.sqrt(priceRatio);
    const Q96 = BigInt(2) ** BigInt(96);
    return BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

/**
 * Main setup function
 */
async function setupPoolAndLiquidity() {
    console.log('🏊 Setting up Pool and Adding Liquidity');
    console.log('='.repeat(60));

    // Load environment variables
    const privateKey = process.env.PRIVATE_KEY;
    const rpcUrl = process.env.RPC_URL || process.env.BASE_SEPOLIA_RPC_URL;
    const hookAddress = process.env.HOOK_ADDRESS || '0x4493E9d873c049f15ca4Fc1eB94044a5bE3440c4';

    if (!privateKey) {
        console.error('❌ Error: PRIVATE_KEY environment variable not set');
        process.exit(1);
    }
    if (!rpcUrl) {
        console.error('❌ Error: RPC_URL or BASE_SEPOLIA_RPC_URL environment variable not set');
        process.exit(1);
    }

    // Setup provider and signer
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const poolManager = new ethers.Contract(POOL_MANAGER, POOL_MANAGER_ABI, signer);

    console.log(`\n📋 Configuration:`);
    console.log(`   Network: Base Sepolia`);
    console.log(`   PoolManager: ${POOL_MANAGER}`);
    console.log(`   Hook: ${hookAddress}`);
    console.log(`   Signer: ${signer.address}`);
    console.log(`   USDC: ${USDC_ADDRESS}`);
    console.log(`   USDT: ${USDT_ADDRESS}`);

    // Setup token contracts
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
    const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer);

    // Get token decimals
    const usdcDecimals = await usdc.decimals();
    const usdtDecimals = await usdt.decimals();
    console.log(`\n📊 Token Info:`);
    console.log(`   USDC decimals: ${usdcDecimals}`);
    console.log(`   USDT decimals: ${usdtDecimals}`);

    // Check balances
    const usdcBalance = await usdc.balanceOf(signer.address);
    const usdtBalance = await usdt.balanceOf(signer.address);
    console.log(`\n💰 Current Balances:`);
    console.log(`   USDC: ${ethers.formatUnits(usdcBalance, usdcDecimals)}`);
    console.log(`   USDT: ${ethers.formatUnits(usdtBalance, usdtDecimals)}`);

    // Create pool key as array (matching ABI tuple order: currency0, currency1, fee, tickSpacing, hooks)
    const poolKey = [
        USDC_ADDRESS,  // currency0
        USDT_ADDRESS,  // currency1
        3000,          // fee (0.3%)
        60,            // tickSpacing
        hookAddress    // hooks
    ];

    console.log(`\n🏊 Step 1: Initializing Pool`);
    console.log('-'.repeat(60));
    console.log(`   Pool Key:`);
    console.log(`     Currency0: ${poolKey[0]}`);
    console.log(`     Currency1: ${poolKey[1]}`);
    console.log(`     Fee: ${poolKey[2]} (0.3%)`);
    console.log(`     Tick Spacing: ${poolKey[3]}`);
    console.log(`     Hooks: ${poolKey[4]}`);

    // Calculate initial price (1:1 ratio)
    const initialSqrtPriceX96 = calculateSqrtPriceX96(1.0);
    console.log(`   Initial sqrtPriceX96: ${initialSqrtPriceX96}`);

    try {
        // Initialize pool
        console.log(`\n📤 Initializing pool...`);
        const initTx = await poolManager.initialize(poolKey, initialSqrtPriceX96);
        console.log(`   Transaction: ${initTx.hash}`);
        const initReceipt = await initTx.wait();
        console.log(`   ✅ Pool initialized in block ${initReceipt.blockNumber}`);
    } catch (error) {
        // Check for PoolAlreadyInitialized error (selector: 0x7983c051)
        // This can appear as error.data === '0x7983c051' or in the error message
        const isAlreadyInitialized = 
            error.data === '0x7983c051' ||
            error.info?.error?.data === '0x7983c051' ||
            error.message?.includes('PoolAlreadyInitialized') || 
            error.message?.includes('already initialized') ||
            error.shortMessage?.includes('PoolAlreadyInitialized');
        
        if (isAlreadyInitialized) {
            console.log(`   ⚠️  Pool already initialized, continuing...`);
        } else {
            console.error(`   ❌ Error initializing pool:`, error.message || error.shortMessage);
            console.error(`   Error data:`, error.data || error.info?.error?.data);
            throw error;
        }
    }

    // Step 2: Approve tokens
    console.log(`\n🔐 Step 2: Approving Tokens`);
    console.log('-'.repeat(60));

    const approvalAmount = ethers.MaxUint256; // Approve max for convenience

    // Check current allowances
    const usdcAllowance = await usdc.allowance(signer.address, POOL_MANAGER);
    const usdtAllowance = await usdt.allowance(signer.address, POOL_MANAGER);

    if (usdcAllowance < ethers.parseUnits('1000', usdcDecimals)) {
        console.log(`\n📤 Approving USDC...`);
        const usdcApproveTx = await usdc.approve(POOL_MANAGER, approvalAmount);
        console.log(`   Transaction: ${usdcApproveTx.hash}`);
        await usdcApproveTx.wait();
        console.log(`   ✅ USDC approved`);
    } else {
        console.log(`   ✅ USDC already approved`);
    }

    if (usdtAllowance < ethers.parseUnits('1000', usdtDecimals)) {
        console.log(`\n📤 Approving USDT...`);
        const usdtApproveTx = await usdt.approve(POOL_MANAGER, approvalAmount);
        console.log(`   Transaction: ${usdtApproveTx.hash}`);
        await usdtApproveTx.wait();
        console.log(`   ✅ USDT approved`);
    } else {
        console.log(`   ✅ USDT already approved`);
    }

    // Step 3: Add liquidity using PositionManager
    console.log(`\n💧 Step 3: Adding Liquidity`);
    console.log('-'.repeat(60));
    console.log(`   Using PositionManager: ${POSITION_MANAGER}`);

    // Amount to add: 10 USDC and 10.2 USDT
    const amount0Desired = ethers.parseUnits('10', usdcDecimals); // 10 USDC (6 decimals)
    const amount1Desired = ethers.parseUnits('10.2', usdtDecimals); // 10.2 USDT (18 decimals)
    const amount0Min = amount0Desired * BigInt(95) / BigInt(100); // 5% slippage tolerance
    const amount1Min = amount1Desired * BigInt(95) / BigInt(100); // 5% slippage tolerance

        console.log(`   Adding liquidity:`);
        console.log(`     USDC: ${ethers.formatUnits(amount0Desired, usdcDecimals)} (min: ${ethers.formatUnits(amount0Min, usdcDecimals)})`);
        console.log(`     USDT: ${ethers.formatUnits(amount1Desired, usdtDecimals)} (min: ${ethers.formatUnits(amount1Min, usdtDecimals)})`);
        console.log(`     PositionManager: ${POSITION_MANAGER}`);

    // Check if we have enough balance
    if (usdcBalance < amount0Desired) {
        console.error(`\n❌ Insufficient USDC balance. Need ${ethers.formatUnits(amount0Desired, usdcDecimals)}, have ${ethers.formatUnits(usdcBalance, usdcDecimals)}`);
        process.exit(1);
    }
    if (usdtBalance < amount1Desired) {
        console.error(`\n❌ Insufficient USDT balance. Need ${ethers.formatUnits(amount1Desired, usdtDecimals)}, have ${ethers.formatUnits(usdtBalance, usdtDecimals)}`);
        process.exit(1);
    }

    // Approve tokens to PositionManager
    const positionManager = new ethers.Contract(POSITION_MANAGER, POSITION_MANAGER_ABI, signer);
    
    const usdcPosmAllowance = await usdc.allowance(signer.address, POSITION_MANAGER);
    const usdtPosmAllowance = await usdt.allowance(signer.address, POSITION_MANAGER);

    if (usdcPosmAllowance < amount0Desired) {
        console.log(`\n📤 Approving USDC to PositionManager...`);
        const approveTx = await usdc.approve(POSITION_MANAGER, approvalAmount);
        await approveTx.wait();
        console.log(`   ✅ USDC approved to PositionManager`);
    }

    if (usdtPosmAllowance < amount1Desired) {
        console.log(`\n📤 Approving USDT to PositionManager...`);
        const approveTx = await usdt.approve(POSITION_MANAGER, approvalAmount);
        await approveTx.wait();
        console.log(`   ✅ USDT approved to PositionManager`);
    }

    // Tick range for liquidity position
    // For full range: tickLower = -887272, tickUpper = 887272
    // But we'll use a smaller range around current price for simplicity
    const tickLower = -60; // One tick spacing below
    const tickUpper = 60;  // One tick spacing above

    // Calculate liquidity from amounts
    // We need the current pool price (sqrtPriceX96) to calculate liquidity properly
    // For a 1:1 price pool, sqrtPriceX96 = 2^96
    // Since the pool was initialized with sqrtPriceX96 = 2^96 (1:1), we can use that
    const Q96 = BigInt(2) ** BigInt(96);
    const currentSqrtPriceX96 = Q96; // 1:1 price (from initialization)
    
    // Calculate sqrt prices at tick boundaries
    // For tick = 0, sqrtPrice = 2^96
    // For tick = n, sqrtPrice = 1.0001^n * 2^96
    // We'll use a simplified calculation for small tick ranges
    function getSqrtPriceAtTick(tick) {
        // Simplified: for small ticks, we can approximate
        // sqrt(1.0001^tick) ≈ 1 + tick * 0.00005 (for small ticks)
        // But for accuracy, we need: sqrtPrice = sqrt(1.0001^tick) * 2^96
        // For now, use a rough approximation
        const tickRatio = 1.0001 ** Number(tick);
        const sqrtTickRatio = Math.sqrt(tickRatio);
        return BigInt(Math.floor(Number(Q96) * sqrtTickRatio));
    }
    
    const sqrtPriceAX96 = getSqrtPriceAtTick(tickLower);
    const sqrtPriceBX96 = getSqrtPriceAtTick(tickUpper);
    
    // Calculate liquidity using the formula from LiquidityAmounts
    // For price in range: liquidity = min(liquidity0, liquidity1)
    // liquidity0 = amount0 * sqrt(upper) * sqrt(lower) / (sqrt(upper) - sqrt(lower))
    // liquidity1 = amount1 * Q96 / (sqrt(upper) - sqrt(lower))
    function calculateLiquidity(priceX96, priceAX96, priceBX96, amount0, amount1) {
        // Ensure priceAX96 < priceBX96
        let sqrtA = priceAX96 < priceBX96 ? priceAX96 : priceBX96;
        let sqrtB = priceAX96 < priceBX96 ? priceBX96 : priceAX96;
        
        if (priceX96 <= sqrtA) {
            // Price below range - only token0
            const intermediate = (sqrtA * sqrtB) / Q96;
            return (amount0 * intermediate) / (sqrtB - sqrtA);
        } else if (priceX96 < sqrtB) {
            // Price in range - both tokens
            const liquidity0 = (amount0 * (priceX96 * sqrtB) / Q96) / (sqrtB - priceX96);
            const liquidity1 = (amount1 * Q96) / (priceX96 - sqrtA);
            return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        } else {
            // Price above range - only token1
            return (amount1 * Q96) / (sqrtB - sqrtA);
        }
    }
    
    const liquidity = calculateLiquidity(currentSqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, amount0Desired, amount1Desired);
    
    // Ensure liquidity fits in uint128
    const maxUint128 = BigInt(2) ** BigInt(128) - BigInt(1);
    const finalLiquidity = liquidity > maxUint128 ? maxUint128 : liquidity;

    try {
        console.log(`\n📤 Minting liquidity position via PositionManager...`);
        console.log(`   Tick range: [${tickLower}, ${tickUpper}]`);
        console.log(`   Calculated liquidity: ${finalLiquidity.toString()}`);
        
        // Encode actions: MINT_POSITION + SETTLE_PAIR (for ERC20 tokens)
        const actions = ethers.solidityPacked(
            ['uint8', 'uint8'],
            [Actions.MINT_POSITION, Actions.SETTLE_PAIR]
        );
        
        // MINT_POSITION parameters: (poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, recipient, hookData)
        const hookData = '0x';
        const mintParams = ethers.AbiCoder.defaultAbiCoder().encode(
            [
                'tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)',
                'int24',
                'int24',
                'uint256',
                'uint128',
                'uint128',
                'address',
                'bytes'
            ],
            [
                poolKey,
                tickLower,
                tickUpper,
                finalLiquidity,
                amount0Desired, // amount0Max
                amount1Desired, // amount1Max
                signer.address, // recipient
                hookData
            ]
        );

        // SETTLE_PAIR parameters: (currency0, currency1)
        const settleParams = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address'],
            [USDC_ADDRESS, USDT_ADDRESS]
        );

        // Encode actions and params for modifyLiquidities
        // Format: abi.encode(bytes actions, bytes[] params)
        const encodedActions = ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes', 'bytes[]'],
            [actions, [mintParams, settleParams]]
        );

        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
        
        console.log(`   Calling modifyLiquidities...`);
        console.log(`   Liquidity: ${finalLiquidity.toString()}`);
        console.log(`   Deadline: ${deadline}`);
        
        const mintTx = await positionManager.modifyLiquidities(encodedActions, deadline);
        
        console.log(`   Transaction: ${mintTx.hash}`);
        const mintReceipt = await mintTx.wait();
        console.log(`   ✅ Liquidity position minted in block ${mintReceipt.blockNumber}`);

    } catch (error) {
        console.error(`\n❌ Error adding liquidity:`, error.message);
        console.error(`\n   This might be due to:`);
        console.error(`   - Pool not initialized`);
        console.error(`   - Insufficient token balance`);
        console.error(`   - Invalid tick range`);
        console.error(`   - PositionManager not deployed or wrong address`);
        console.error(`   - Slippage too high`);
        console.error(`   - Action encoding incorrect`);
        console.error(`   - Liquidity calculation incorrect (needs proper Uniswap v4 math)`);
        throw error;
    }

    // Step 4: Verify pool is ready
    console.log(`\n✅ Step 4: Verifying Pool Setup`);
    console.log('-'.repeat(60));

    const finalUsdcBalance = await usdc.balanceOf(signer.address);
    const finalUsdtBalance = await usdt.balanceOf(signer.address);

    console.log(`\n💰 Final Balances:`);
    console.log(`   USDC: ${ethers.formatUnits(finalUsdcBalance, usdcDecimals)}`);
    console.log(`   USDT: ${ethers.formatUnits(finalUsdtBalance, usdtDecimals)}`);

    console.log(`\n✅ Pool setup complete!`);
    console.log(`\n📋 Pool Details:`);
    console.log(`   Pool Key:`);
    console.log(`     Currency0: ${poolKey[0]}`);
    console.log(`     Currency1: ${poolKey[1]}`);
    console.log(`     Fee: ${poolKey[2]}`);
    console.log(`     Tick Spacing: ${poolKey[3]}`);
    console.log(`     Hooks: ${poolKey[4]}`);
    console.log(`   PoolManager: ${POOL_MANAGER}`);
    console.log(`   Hook: ${hookAddress}`);
    console.log(`\n⚠️  Note: Pool is initialized but liquidity needs to be added separately`);
    console.log(`   Use Uniswap v4 periphery contracts or fix the modifyLiquidity ABI`);
    console.log('='.repeat(60));
}

// Run the setup
setupPoolAndLiquidity().catch(error => {
    console.error('\n❌ Setup failed:', error);
    process.exit(1);
});
