#!/usr/bin/env node

/**
 * Perp flow: commit + reveal only (no batch execution).
 *
 * 1. Deposit margin (approve USDC, PerpPositionManager.depositCollateral)
 * 2. Build PerpIntent and get commitment hash (hook.computePerpCommitmentHash)
 * 3. Submit perp commitment (hook.submitPerpCommitment)
 * 4. Submit perp reveal (hook.submitPerpReveal)
 *
 * When MONGODB_URI is set, each commitment hash is written to MongoDB (pendingPerpReveals)
 * as soon as it is submitted on-chain. Other scripts (e.g. execute-perp-batch-from-mongo.js)
 * or the backend can then trigger batch execution; this script does nothing else for that.
 *
 * Usage:
 *   node test-perp-e2e.js
 *
 * Env:
 *   PRIVATE_KEY, RPC_URL (or ARBITRUM_SEPOLIA_RPC_URL)
 *   MONGODB_URI (optional) — if set, commitment hashes are inserted into pendingPerpReveals
 *   MONGODB_DB_NAME (optional, default zkperps)
 *   HOOK_ADDRESS, PERP_MANAGER_ADDRESS, MOCK_USDC, MOCK_USDT (optional)
 *   On Arbitrum Sepolia (chainId 421614) the script uses DEPLOYED addresses.
 *   MARKET_ID (e.g. 0x0000000000000000000000000000000000000001 for ETH)
 *   BASE_IS_CURRENCY0 (optional, default true) — base asset is currency0
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const envPaths = [
  path.join(__dirname, ".env"),
  path.join(__dirname, "../.env"),
  path.join(__dirname, "../../.env"),
  path.join(__dirname, "../../backend/.env"),
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
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "zkperps";
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

  // 2. Build two intents (batch needs MIN_COMMITMENTS >= 2; both must be revealed on-chain)
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
  console.log("  Hash1:", hash1);
  console.log("  Hash2:", hash2);

  const enc = (i) => [ i.user, i.market, i.size, i.isLong, i.isOpen, i.collateral, i.leverage, i.nonce, i.deadline ];

  // 3. Submit commitment 1 + reveal 1 + MongoDB
  console.log("\n--- 3. Submit perp commitment 1 ---");
  const commit1Tx = await hook.submitPerpCommitment(poolKey, hash1);
  await commit1Tx.wait();
  console.log("  Commit 1:", commit1Tx.hash);
  const reveal1Tx = await hook.submitPerpReveal(poolKey, enc(intent1));
  await reveal1Tx.wait();
  console.log("  Reveal 1:", reveal1Tx.hash);
  if (MONGODB_URI) {
    try {
      const { MongoClient } = require("mongodb");
      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      await client.db(MONGODB_DB_NAME).collection("pendingPerpReveals").insertOne({
        poolId,
        commitmentHash: hash1,
        executed: false,
        createdAt: new Date(),
      });
      await client.close();
      console.log("  Inserted hash1 into MongoDB");
    } catch (e) {
      console.warn("  MongoDB insert hash1 failed (non-fatal):", e.message);
    }
  }

  // 4. Submit commitment 2 + reveal 2 + MongoDB
  console.log("\n--- 4. Submit perp commitment 2 ---");
  const commit2Tx = await hook.submitPerpCommitment(poolKey, hash2);
  await commit2Tx.wait();
  console.log("  Commit 2:", commit2Tx.hash);
  const reveal2Tx = await hook.submitPerpReveal(poolKey, enc(intent2));
  await reveal2Tx.wait();
  console.log("  Reveal 2:", reveal2Tx.hash);
  if (MONGODB_URI) {
    try {
      const { MongoClient } = require("mongodb");
      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      await client.db(MONGODB_DB_NAME).collection("pendingPerpReveals").insertOne({
        poolId,
        commitmentHash: hash2,
        executed: false,
        createdAt: new Date(),
      });
      await client.close();
      console.log("  Inserted hash2 into MongoDB");
    } catch (e) {
      console.warn("  MongoDB insert hash2 failed (non-fatal):", e.message);
    }
  }

  if (!MONGODB_URI) {
    console.log("\n  (Set MONGODB_URI to write commitment hashes to MongoDB when committing; other scripts can then trigger the batch.)");
  }

  console.log("\n" + "=".repeat(60));
  console.log("Commit + reveal done. If MONGODB_URI was set, hashes are already in MongoDB; run execute-perp-batch-from-mongo.js to trigger the batch.");
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
