#!/usr/bin/env node

/**
 * Perp flow end-to-end test
 *
 * 1. Deposit margin (approve USDC, PerpPositionManager.depositCollateral)
 * 2. Build PerpIntent and get commitment hash (hook.computePerpCommitmentHash)
 * 3. Submit perp commitment (hook.submitPerpCommitment)
 * 4. Submit perp reveal (hook.submitPerpReveal)
 * 5. Wait BATCH_INTERVAL (5 min) then revealAndBatchExecutePerps
 *     (Script funds the Hook with quote (USDC) so it can settle the perp swap; the Hook holds no tokens by default.)
 * 6. Verify position on PerpPositionManager
 *
 * Usage:
 *   node test-perp-e2e.js
 *
 * Env:
 *   PRIVATE_KEY, RPC_URL (or ARBITRUM_SEPOLIA_RPC_URL)
 *   HOOK_ADDRESS, PERP_MANAGER_ADDRESS, MOCK_USDC, MOCK_USDT (optional)
 *   On Arbitrum Sepolia (chainId 421614) the script uses DEPLOYED addresses and ignores env
 *   so RPC_URL must point to Arbitrum Sepolia when testing that deployment.
 *   MARKET_ID (e.g. 0x0000000000000000000000000000000000000001 for ETH)
 *   BASE_IS_CURRENCY0 (optional, default true) — base asset is currency0
 *   SKIP_WAIT (optional) — if set, skip 5 min wait and only do commit+reveal (run again later to execute)
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const envPaths = [
  path.join(__dirname, ".env"),
  path.join(__dirname, "../.env"),
  path.join(__dirname, "../../.env"),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    require("dotenv").config({ path: envPath });
    break;
  }
}
try {
  require("dotenv").config();
} catch (e) {}

// Arbitrum Sepolia (421614) — from broadcast run-* JSONs
const DEPLOYED = {
  GROTH16_VERIFIER: "0x7fe24e07a4017b953259a79a9ee635e8eb226c11",
  MOCK_USDC: "0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e",
  MOCK_USDT: "0x3c604069c87256bbab9cc3ff678410275b156755",
  PERP_POSITION_MANAGER: "0xf3c9cdbaf6dc303fe302fbf81465de0a057ccf5e",
  PRIV_BATCH_HOOK: "0xe3ea87fb759c3206a9595048732eb6a6000700c4",
  CHAINLINK_ORACLE_ADAPTER: "0x991eb2241b5f2875a5cb4dbba6450b343e8216be",
};

const RPC_URL =
  process.env.RPC_URL ||
  process.env.ARBITRUM_SEPOLIA_RPC_URL ||
  process.env.BASE_SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const HOOK_ADDRESS = process.env.HOOK_ADDRESS || DEPLOYED.PRIV_BATCH_HOOK;
const PERP_MANAGER_ADDRESS =
  process.env.PERP_MANAGER_ADDRESS || DEPLOYED.PERP_POSITION_MANAGER;
const MOCK_USDC =
  process.env.MOCK_USDC || process.env.MOCK_USDC_ADDRESS || DEPLOYED.MOCK_USDC;
const MOCK_USDT =
  process.env.MOCK_USDT || process.env.MOCK_USDT_ADDRESS || DEPLOYED.MOCK_USDT;
const MARKET_ID =
  process.env.MARKET_ID || "0x0000000000000000000000000000000000000001";
const BASE_IS_CURRENCY0 = process.env.BASE_IS_CURRENCY0 !== "false";
const SKIP_WAIT =
  process.env.SKIP_WAIT === "true" || process.env.SKIP_WAIT === "1";

const BATCH_INTERVAL_SEC = 5 * 60;

const HOOK_ABI = [
  "function submitPerpCommitment(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bytes32 commitmentHash)",
  "function submitPerpReveal(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, tuple(address user, address market, uint256 size, bool isLong, bool isOpen, uint256 collateral, uint256 leverage, uint256 nonce, uint256 deadline) intent)",
  "function revealAndBatchExecutePerps(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bytes32[] commitmentHashes, bool baseIsCurrency0)",
  "function computePerpCommitmentHash(tuple(address user, address market, uint256 size, bool isLong, bool isOpen, uint256 collateral, uint256 leverage, uint256 nonce, uint256 deadline) intent) view returns (bytes32)",
  "function BATCH_INTERVAL() view returns (uint256)",
  "function perpBatchStates(bytes32) view returns (uint256 lastBatchTimestamp, uint256 commitmentCount)",
  "function perpPositionManager() view returns (address)",
  "event PerpCommitmentSubmitted(bytes32 indexed poolId, bytes32 indexed commitmentHash)",
  "event PerpBatchExecuted(bytes32 indexed poolId, uint256 batchSize, uint256 executionPrice, uint256 timestamp)",
];

const PERP_MANAGER_ABI = [
  "function depositCollateral(address user, uint256 amount)",
  "function getTotalCollateral(address user) view returns (uint256)",
  "function getPosition(address user, address market) view returns (int256 size, uint256 entryPrice, uint256 collateral, uint256 leverage, uint256 lastFundingPaid, uint256 entryCumulativeFunding)",
  "function getAvailableMargin(address user) view returns (uint256)",
];

const ORACLE_ADAPTER_ABI = [
  "function getPriceWithFallback(address market) view returns (uint256)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

function buildPoolKey(currency0, currency1, hook) {
  return {
    currency0: ethers.getAddress(currency0),
    currency1: ethers.getAddress(currency1),
    fee: 3000,
    tickSpacing: 60,
    hooks: ethers.getAddress(hook),
  };
}

function buildPerpIntent(
  user,
  market,
  size,
  isLong,
  isOpen,
  collateral,
  leverage,
  nonce,
  deadline,
) {
  return {
    user: ethers.getAddress(user),
    market: ethers.getAddress(market),
    size: BigInt(size),
    isLong,
    isOpen,
    collateral: BigInt(collateral),
    leverage: BigInt(leverage),
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
  };
}

async function main() {
  console.log("Perp flow end-to-end test");
  console.log("=".repeat(60));

  if (!PRIVATE_KEY || !RPC_URL) {
    console.error("Missing env: PRIVATE_KEY, RPC_URL");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  // On Arbitrum Sepolia (421614) use DEPLOYED addresses so we don't mix with .env from another chain
  const hookAddr =
    chainId === 421614
      ? DEPLOYED.PRIV_BATCH_HOOK
      : process.env.HOOK_ADDRESS || DEPLOYED.PRIV_BATCH_HOOK;
  const perpAddr =
    chainId === 421614
      ? DEPLOYED.PERP_POSITION_MANAGER
      : process.env.PERP_MANAGER_ADDRESS || DEPLOYED.PERP_POSITION_MANAGER;
  const usdcAddr =
    chainId === 421614
      ? DEPLOYED.MOCK_USDC
      : process.env.MOCK_USDC ||
        process.env.MOCK_USDC_ADDRESS ||
        DEPLOYED.MOCK_USDC;
  const usdtAddr =
    chainId === 421614
      ? DEPLOYED.MOCK_USDT
      : process.env.MOCK_USDT ||
        process.env.MOCK_USDT_ADDRESS ||
        DEPLOYED.MOCK_USDT;

  // DEPLOYED addresses are for Arbitrum Sepolia only; calling them on another chain will revert
  const usingDeployed = [hookAddr, perpAddr, usdcAddr].every(
    (a, i) =>
      ethers.getAddress(a) ===
      ethers.getAddress(
        [
          DEPLOYED.PRIV_BATCH_HOOK,
          DEPLOYED.PERP_POSITION_MANAGER,
          DEPLOYED.MOCK_USDC,
        ][i],
      ),
  );
  if (usingDeployed && chainId !== 421614) {
    console.error(
      "\nError: DEPLOYED addresses are for Arbitrum Sepolia (chainId 421614).",
    );
    console.error(
      "Current RPC chainId:",
      chainId,
      "- your RPC_URL/ARBITRUM_SEPOLIA_RPC_URL may point to a different network (e.g. Base Sepolia).",
    );
    console.error("Use an Arbitrum Sepolia RPC, e.g.:");
    console.error("  RPC_URL=https://sepolia-rollup.arbitrum.io/rpc");
    console.error(
      "  # or ARBITRUM_SEPOLIA_RPC_URL=https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY",
    );
    process.exit(1);
  }

  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const hook = new ethers.Contract(hookAddr, HOOK_ABI, signer);
  const perpManager = new ethers.Contract(perpAddr, PERP_MANAGER_ABI, signer);
  const oracleAdapter = new ethers.Contract(
    DEPLOYED.CHAINLINK_ORACLE_ADAPTER,
    ORACLE_ADAPTER_ABI,
    signer,
  );
  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, signer);
  const usdt = new ethers.Contract(usdtAddr, ERC20_ABI, signer);

  const currency0 = usdcAddr < usdtAddr ? usdcAddr : usdtAddr;
  const currency1 = usdcAddr < usdtAddr ? usdtAddr : usdcAddr;
  const poolKey = buildPoolKey(currency0, currency1, hookAddr);

  const poolId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
      ],
      [poolKey],
    ),
  );

  console.log("\nConfig:");
  console.log(
    "  ChainId:",
    chainId,
    chainId === 421614 ? "(Arbitrum Sepolia, using DEPLOYED addresses)" : "",
  );
  console.log("  Signer:", signer.address);
  console.log("  Hook:", hookAddr);
  console.log("  PerpPositionManager:", perpAddr);
  console.log("  MockUSDC:", usdcAddr);
  console.log("  Market:", MARKET_ID);
  console.log("  PoolId:", poolId);
  console.log("  baseIsCurrency0:", BASE_IS_CURRENCY0);

  // #region agent log
  fetch("http://127.0.0.1:7250/ingest/45f38e27-30c3-4adc-91dc-b2d064327c1e", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "test-perp-e2e.js:179",
      message: "Hook address verification",
      data: {
        hookAddr: hookAddr,
        expectedNewHook: "0xf31d8e462185bd0a7eedece7f5cecc7048e700c4",
        expectedOldHook: "0x9c8e0d45b243381fb0da88c2171127d3c01940c4",
        isNewHook:
          hookAddr.toLowerCase() ===
          "0xf31d8e462185bd0a7eedece7f5cecc7048e700c4".toLowerCase(),
        isOldHook:
          hookAddr.toLowerCase() ===
          "0x9c8e0d45b243381fb0da88c2171127d3c01940c4".toLowerCase(),
        chainId: chainId,
      },
      timestamp: Date.now(),
      hypothesisId: "A",
    }),
  }).catch(() => {});
  // #endregion

  let usdcDec = 6;
  try {
    usdcDec = await usdc.decimals();
  } catch (e) {
    console.log("  Note: decimals() failed, using 6 for MockUSDC");
  }
  const collateralAmount = ethers.parseUnits("500", usdcDec);
  const size = ethers.parseEther("0.1");
  const leverage = ethers.parseEther("5");
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const baseNonce = Math.floor(Date.now() / 1000) % 1e9;

  // 1. Deposit margin
  console.log("\n--- 1. Deposit margin ---");
  let balance = 0n;
  try {
    balance = await usdc.balanceOf(signer.address);
  } catch (e) {
    console.log("  Note: balanceOf() failed (wrong token or chain?).");
  }
  if (balance < collateralAmount) {
    console.error(
      "  Error: signer USDC balance",
      balance ? ethers.formatUnits(balance, usdcDec) : "0",
      "<",
      ethers.formatUnits(collateralAmount, usdcDec),
      "required.",
    );
    console.error(
      "  Ensure you are on Arbitrum Sepolia and the signer holds MockUSDC at",
      usdcAddr,
    );
    process.exit(1);
  }
  let allowance = 0n;
  try {
    allowance = await usdc.allowance(signer.address, perpAddr);
  } catch (e) {
    console.log(
      "  Note: allowance() failed (wrong token address or chain?). Proceeding to approve.",
    );
  }
  if (allowance < collateralAmount) {
    const approveTx = await usdc.approve(perpAddr, ethers.MaxUint256);
    await approveTx.wait();
    console.log("  USDC approved to PerpPositionManager");
  }
  try {
    const depositTx = await perpManager.depositCollateral(
      signer.address,
      collateralAmount,
    );
    await depositTx.wait();
  } catch (e) {
    if (
      e.info?.error?.message === "execution reverted" ||
      e.code === "CALL_EXCEPTION"
    ) {
      console.error("  depositCollateral reverted. Typical causes:");
      console.error(
        "  - RPC points to wrong chain (e.g. Base Sepolia). Use Arbitrum Sepolia RPC.",
      );
      console.error(
        "  - Wrong token: PerpPositionManager expects MockUSDC at",
        usdcAddr,
      );
    }
    throw e;
  }
  const totalAfter = await perpManager.getTotalCollateral(signer.address);
  console.log(
    "  Deposited:",
    ethers.formatUnits(collateralAmount, usdcDec),
    "USDC",
  );
  console.log(
    "  Total collateral:",
    ethers.formatUnits(totalAfter, 18),
    "(18d)",
  );

  // 2. Build two intents (contract requires MIN_COMMITMENTS >= 2)
  console.log("\n--- 2. Build PerpIntents and commitment hashes ---");
  const collateralWei = (size * ethers.parseEther("2800")) / leverage;
  const intent1 = buildPerpIntent(
    signer.address,
    MARKET_ID,
    size.toString(),
    true,
    true,
    collateralWei.toString(),
    leverage.toString(),
    baseNonce,
    deadline,
  );
  const intent2 = buildPerpIntent(
    signer.address,
    MARKET_ID,
    size.toString(),
    true,
    true,
    collateralWei.toString(),
    leverage.toString(),
    baseNonce + 1,
    deadline,
  );
  const hash1 = await hook.computePerpCommitmentHash(intent1);
  const hash2 = await hook.computePerpCommitmentHash(intent2);
  const commitmentHashes = [hash1, hash2];
  console.log("  Hash1:", hash1);
  console.log("  Hash2:", hash2);

  // 3. Submit commitments
  console.log("\n--- 3. Submit perp commitments ---");
  const commit1Tx = await hook.submitPerpCommitment(poolKey, hash1);
  await commit1Tx.wait();
  console.log("  Commit 1:", commit1Tx.hash);
  const commit2Tx = await hook.submitPerpCommitment(poolKey, hash2);
  await commit2Tx.wait();
  console.log("  Commit 2:", commit2Tx.hash);

  // 4. Submit reveals
  console.log("\n--- 4. Submit perp reveals ---");
  const enc = (i) => [
    i.user,
    i.market,
    i.size,
    i.isLong,
    i.isOpen,
    i.collateral,
    i.leverage,
    i.nonce,
    i.deadline,
  ];
  const reveal1Tx = await hook.submitPerpReveal(poolKey, enc(intent1));
  await reveal1Tx.wait();
  console.log("  Reveal 1:", reveal1Tx.hash);
  const reveal2Tx = await hook.submitPerpReveal(poolKey, enc(intent2));
  await reveal2Tx.wait();
  console.log("  Reveal 2:", reveal2Tx.hash);

  if (SKIP_WAIT) {
    console.log("\n--- SKIP_WAIT set: skipping batch execution. ---");
    console.log(
      "  Wait",
      BATCH_INTERVAL_SEC,
      "seconds then run again without SKIP_WAIT to execute, or call:",
    );
    console.log(
      "  hook.revealAndBatchExecutePerps(poolKey, [hash1, hash2], " +
        BASE_IS_CURRENCY0 +
        ")",
    );
    return;
  }

  // 5. Wait for batch interval
  const batchInterval = await hook
    .BATCH_INTERVAL()
    .catch(() => BigInt(BATCH_INTERVAL_SEC));
  console.log("\n--- 5. Wait batch interval ---");
  console.log("  Waiting", Number(batchInterval), "seconds...");
  await new Promise((r) => setTimeout(r, Number(batchInterval) * 1000));

  // 5.5 Fetch and log Chainlink oracle price
  console.log("\n--- Fetch Chainlink Oracle Price ---");
  let oraclePrice18d;
  try {
    oraclePrice18d = await oracleAdapter.getPriceWithFallback(MARKET_ID);
    const oraclePriceUsd = ethers.formatEther(oraclePrice18d);
    console.log("  Chainlink oracle price:", oraclePriceUsd, "USD per base");
    console.log("  Market ID:", MARKET_ID);
    console.log("  Oracle adapter:", DEPLOYED.CHAINLINK_ORACLE_ADAPTER);
  } catch (e) {
    console.error(
      "  Error: Failed to fetch Chainlink oracle price:",
      e.message || e.shortMessage,
    );
    console.error("  Oracle adapter:", DEPLOYED.CHAINLINK_ORACLE_ADAPTER);
    console.error("  Market ID:", MARKET_ID);
    throw new Error(
      "Oracle price fetch failed - cannot proceed without oracle data",
    );
  }

  // 5.6 Fund Hook with quote so it can settle the perp swap
  // The Hook executes the net swap and must transfer quote to the pool; it holds no tokens by default.
  // Calculate required quote: sum of all intent sizes * fixed price estimate * slippage buffer
  // NOTE: Using a fixed price estimate for funding (not oracle price) to ensure consistent behavior
  const quoteCurrency = BASE_IS_CURRENCY0 ? currency1 : currency0;
  const quoteToken =
    quoteCurrency.toLowerCase() === usdcAddr.toLowerCase() ? usdc : usdt;
  const quoteDec =
    quoteCurrency.toLowerCase() === usdcAddr.toLowerCase() ? usdcDec : 6;

  // Calculate net base size from intents (sum all sizes, accounting for direction)
  // For now, we know both intents are long opens with same size
  const totalBaseSize = size * BigInt(commitmentHashes.length); // Both are long, so net = sum

  // Use a fixed price estimate for funding calculation (not oracle price)
  // This ensures funding is predictable regardless of oracle price fluctuations
  const fundingPriceEstimate18d = ethers.parseEther("2500"); // Fixed estimate for funding

  // Estimate quote needed: base size (in 18d) * price estimate (in 18d) * buffer / 1e36 * quote decimals
  // bufferMultiplier accounts for slippage, fees, and price movement
  // Formula: (totalBaseSize / 1e18) * (fundingPriceEstimate18d / 1e18) * buffer * 1e6
  // Simplified: (totalBaseSize * fundingPriceEstimate18d * buffer * 1e6) / 1e36
  // NOTE: Pool price may differ significantly from oracle price, especially with low liquidity
  // Using a large buffer (10x) to ensure sufficient funds for the swap
  const bufferMultiplier = 10n; // 10x buffer to account for pool price differences, slippage, fees, and low liquidity
  const quoteDecMultiplier = 10n ** BigInt(quoteDec);
  const oneEther = ethers.parseEther("1"); // 1e18

  // Fix: Divide by 1e36 (1e18 * 1e18) since both totalBaseSize and fundingPriceEstimate18d are in 18 decimals
  // Formula breakdown:
  // - totalBaseSize is in 18 decimals (wei): 0.2 ETH = 0.2e18
  // - fundingPriceEstimate18d is in 18 decimals: $2500 = 2500e18
  // - We want: (0.2 ETH * $2500 * 10 buffer) in USDC (6 decimals)
  // - = (0.2e18 / 1e18) * (2500e18 / 1e18) * 10 * 1e6
  // - = (0.2e18 * 2500e18 * 10 * 1e6) / (1e18 * 1e18)
  // - = (0.2 * 2500 * 10 * 1e6) = 5,000,000 (6 decimals) = 5000 USDC
  const numerator =
    totalBaseSize *
    fundingPriceEstimate18d *
    bufferMultiplier *
    quoteDecMultiplier;
  const denominator = oneEther * oneEther; // 1e36
  const hookQuoteNeeded = numerator / denominator;

  // #region agent log
  fetch("http://127.0.0.1:7250/ingest/45f38e27-30c3-4adc-91dc-b2d064327c1e", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "test-perp-e2e.js:352",
      message: "hookQuoteNeeded calculated",
      data: {
        hookQuoteNeeded: hookQuoteNeeded.toString(),
        hookQuoteNeededFormatted: ethers.formatUnits(hookQuoteNeeded, quoteDec),
        numerator: numerator.toString(),
        denominator: denominator.toString(),
        expectedUsdc: "1500",
        actualUsdc: ethers.formatUnits(hookQuoteNeeded, quoteDec),
      },
      timestamp: Date.now(),
      hypothesisId: "D",
    }),
  }).catch(() => {});
  // #endregion

  let hookQuoteBalanceBefore = 0n;
  try {
    hookQuoteBalanceBefore = await quoteToken.balanceOf(hookAddr);
  } catch (_) {}

  // #region agent log
  fetch("http://127.0.0.1:7250/ingest/45f38e27-30c3-4adc-91dc-b2d064327c1e", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "test-perp-e2e.js:363",
      message: "hook balance before funding",
      data: {
        hookQuoteBalanceBefore: hookQuoteBalanceBefore.toString(),
        hookQuoteBalanceBeforeFormatted: ethers.formatUnits(
          hookQuoteBalanceBefore,
          quoteDec,
        ),
        hookQuoteNeeded: hookQuoteNeeded.toString(),
        hookQuoteNeededFormatted: ethers.formatUnits(hookQuoteNeeded, quoteDec),
      },
      timestamp: Date.now(),
      hypothesisId: "E",
    }),
  }).catch(() => {});
  // #endregion

  if (hookQuoteBalanceBefore < hookQuoteNeeded) {
    const toTransfer = hookQuoteNeeded - hookQuoteBalanceBefore;
    const signerQuoteBalance = await quoteToken.balanceOf(signer.address);
    if (signerQuoteBalance < toTransfer) {
      console.error(
        "  Error: signer quote balance",
        ethers.formatUnits(signerQuoteBalance, quoteDec),
        "<",
        ethers.formatUnits(toTransfer, quoteDec),
        "needed to fund Hook for batch.",
      );
      console.error(
        "  Estimated from",
        commitmentHashes.length,
        "intents with total base size",
        ethers.formatEther(totalBaseSize),
        "ETH",
      );
      process.exit(1);
    }
    const fundTx = await quoteToken.transfer(hookAddr, toTransfer);
    await fundTx.wait();

    // #region agent log
    const hookQuoteBalanceAfter = await quoteToken.balanceOf(hookAddr);
    fetch("http://127.0.0.1:7250/ingest/45f38e27-30c3-4adc-91dc-b2d064327c1e", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "test-perp-e2e.js:375",
        message: "hook balance after funding",
        data: {
          hookQuoteBalanceAfter: hookQuoteBalanceAfter.toString(),
          hookQuoteBalanceAfterFormatted: ethers.formatUnits(
            hookQuoteBalanceAfter,
            quoteDec,
          ),
          toTransfer: toTransfer.toString(),
          toTransferFormatted: ethers.formatUnits(toTransfer, quoteDec),
        },
        timestamp: Date.now(),
        hypothesisId: "F",
      }),
    }).catch(() => {});
    // #endregion

    console.log("\n--- Fund Hook (quote for batch) ---");
    console.log(
      "  Total base size:",
      ethers.formatEther(totalBaseSize),
      "base units",
    );
    console.log(
      "  Funding price estimate:",
      ethers.formatEther(fundingPriceEstimate18d),
      "USD per base (fixed estimate, not oracle)",
    );
    console.log(
      "  Estimated quote needed:",
      ethers.formatUnits(hookQuoteNeeded, quoteDec),
      "(10x buffer for pool price differences, slippage, fees)",
    );
    console.log(
      "  Hook balance before:",
      ethers.formatUnits(hookQuoteBalanceBefore, quoteDec),
    );
    console.log(
      "  Transferred",
      ethers.formatUnits(toTransfer, quoteDec),
      "quote to Hook",
    );
    console.log(
      "  Hook balance after:",
      ethers.formatUnits(hookQuoteBalanceAfter, quoteDec),
    );
  } else {
    console.log("\n--- Fund Hook (quote for batch) ---");
    console.log(
      "  Hook already has sufficient quote:",
      ethers.formatUnits(hookQuoteBalanceBefore, quoteDec),
    );
  }

  // 6. Execute batch
  console.log("\n--- 6. revealAndBatchExecutePerps ---");
  // Check if perpPositionManager is set (declare outside try so it's accessible in catch)
  let perpManagerAddr;
  try {
    perpManagerAddr = await hook.perpPositionManager();
  } catch (e) {
    console.error("  Error: Failed to read perpPositionManager:", e.message);
    process.exit(1);
  }
  
  if (!perpManagerAddr || perpManagerAddr === ethers.ZeroAddress) {
    console.error("  Error: perpPositionManager is not set on Hook!");
    console.error("  Hook:", hookAddr);
    console.error("  Run: forge script script/SetPerpManager.s.sol:SetPerpManager --rpc-url arbitrum_sepolia --broadcast");
    process.exit(1);
  }
  
  console.log("  Verified perpPositionManager is set:", perpManagerAddr);
  
  try {
    
    // #region agent log
    fetch("http://127.0.0.1:7250/ingest/45f38e27-30c3-4adc-91dc-b2d064327c1e", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "test-perp-e2e.js:402",
        message: "Before batch execution",
        data: {
          hookAddr: hookAddr,
          poolId: poolId,
          commitmentHashesCount: commitmentHashes.length,
          baseIsCurrency0: BASE_IS_CURRENCY0,
          perpManagerAddr: perpManagerAddr,
          perpManagerIsSet: perpManagerAddr !== ethers.ZeroAddress,
        },
        timestamp: Date.now(),
        hypothesisId: "B",
      }),
    }).catch(() => {});
    // #endregion

    const execTx = await hook.revealAndBatchExecutePerps(
      poolKey,
      commitmentHashes,
      BASE_IS_CURRENCY0,
    );
    await execTx.wait();
    console.log("  Tx:", execTx.hash);

    // #region agent log
    fetch("http://127.0.0.1:7250/ingest/45f38e27-30c3-4adc-91dc-b2d064327c1e", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "test-perp-e2e.js:405",
        message: "Batch execution succeeded",
        data: { txHash: execTx.hash },
        timestamp: Date.now(),
        hypothesisId: "B",
      }),
    }).catch(() => {});
    // #endregion
  } catch (e) {
    // #region agent log
    const errorSelector = e.data && e.data.length >= 10 ? e.data.substring(0, 10) : "none";
    
    // Decode known error selectors
    const errorMap = {
      "0xbf611a9d": "PerpManagerNotSet",
      "0x7c9c6e8f": "PriceLimitAlreadyExceeded",
      "0xdf239ca8": "PerpCommitmentAlreadyRevealed",
      "0xfe3f0ca4": "InvalidPerpCommitment",
      "0x1f2a2005": "DeadlineExpired",
      "0x2d4e4f9d": "InvalidNonce",
      "0x8c2e2b3a": "InsufficientCommitments",
      "0x4e8e5c5c": "BatchConditionsNotMet",
      "0x7fb6be02": "OnlyExecutor",
    };
    
    const decodedError = errorMap[errorSelector] || "UnknownError";
    
    const errorData = {
      message: e.message || e.shortMessage || "unknown",
      reason: e.reason || "none",
      code: e.code || "none",
      data: e.data || "none",
      hookAddr: hookAddr,
      errorSelector: errorSelector,
      decodedError: decodedError,
      isPriceLimitError: e.data && e.data.startsWith("0x7c9c6e8f"),
      isPerpManagerNotSet: e.data && e.data.startsWith("0xbf611a9d"),
      isInvalidPerpCommitment: e.data && e.data.startsWith("0xfe3f0ca4"),
      isPerpCommitmentAlreadyRevealed: e.data && e.data.startsWith("0xdf239ca8"),
      isBatchConditionsNotMet: e.data && e.data.startsWith("0x4e8e5c5c"),
      isDeadlineExpired: e.data && e.data.startsWith("0x1f2a2005"),
      isInvalidNonce: e.data && e.data.startsWith("0x2d4e4f9d"),
      isInsufficientCommitments: e.data && e.data.startsWith("0x8c2e2b3a"),
      isOnlyExecutor: e.data && e.data.startsWith("0x7fb6be02"),
      poolId: poolId,
      commitmentHashesCount: commitmentHashes.length,
      baseIsCurrency0: BASE_IS_CURRENCY0,
      perpManagerAddr: perpManagerAddr,
    };
    
    fetch("http://127.0.0.1:7250/ingest/45f38e27-30c3-4adc-91dc-b2d064327c1e", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "test-perp-e2e.js:407",
        message: "Batch execution failed",
        data: errorData,
        timestamp: Date.now(),
        hypothesisId: "C",
      }),
    }).catch(() => {});
    // #endregion

    console.error("  Execute failed:", e.message || e.shortMessage);
    
    // Decode error selector (reuse errorSelector from above)
    if (errorSelector && errorSelector !== "none" && decodedError !== "UnknownError") {
      console.error("  Decoded error:", decodedError);
    }
    
    if ((e.reason || e.message || "").includes("insufficient balance")) {
      console.error(
        "  The Hook must hold enough quote to settle the swap; the script funds it in step 5.5. If you still see this, increase the signer's quote balance or the hookQuoteNeeded amount.",
      );
    }
    if (e.data) {
      console.error("  Data:", e.data);
      if (e.data.startsWith("0x7c9c6e8f")) {
        console.error(
          "  Error: PriceLimitAlreadyExceeded - This suggests the Hook contract may not have the price limit fix, or pool price is at an extreme.",
        );
        console.error(
          "  Expected Hook (with fix): 0xf31d8e462185bd0a7eedece7f5cecc7048e700c4",
        );
        console.error("  Current Hook:", hookAddr);
      } else if (e.data.startsWith("0xfe3f0ca4")) {
        console.error("  Error: InvalidPerpCommitment - Reveal not found or commitment invalid");
        console.error("  Check that reveals were submitted before batch execution");
      } else if (e.data.startsWith("0xdf239ca8")) {
        console.error("  Error: PerpCommitmentAlreadyRevealed - Commitment was already revealed");
      } else if (e.data.startsWith("0x4e8e5c5c")) {
        console.error("  Error: BatchConditionsNotMet - Batch interval not met");
        console.error("  Wait 5 minutes between batch executions");
      } else if (e.data.startsWith("0x1f2a2005")) {
        console.error("  Error: DeadlineExpired - Intent deadline has passed");
      } else if (e.data.startsWith("0x2d4e4f9d")) {
        console.error("  Error: InvalidNonce - Nonce already used");
      } else if (e.data.startsWith("0x8c2e2b3a")) {
        console.error("  Error: InsufficientCommitments - Need at least 2 commitments");
      } else if (e.data.startsWith("0x7fb6be02")) {
        console.error("  Error: OnlyExecutor - Hook is not set as executor on PerpPositionManager");
        console.error("  Run: cd contracts && source .env && export PERP_POSITION_MANAGER=0xf3c9cdbaf6dc303fe302fbf81465de0a057ccf5e && forge script script/SetExecutorOnPerpManager.s.sol:SetExecutorOnPerpManager --rpc-url arbitrum_sepolia --broadcast");
      }
    }
    process.exit(1);
  }

  // 7. Verify position
  console.log("\n--- 7. Verify position ---");
  const position = await perpManager.getPosition(signer.address, MARKET_ID);
  const available = await perpManager.getAvailableMargin(signer.address);
  console.log("  Position size:", position[0].toString());
  console.log("  Entry price:", position[1].toString());
  console.log("  Collateral in position:", position[2].toString());
  console.log("  Leverage:", position[3].toString());
  console.log("  Available margin:", available.toString());

  console.log("\n" + "=".repeat(60));
  console.log("Perp e2e test done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
