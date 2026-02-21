#!/usr/bin/env node

/**
 * Execute perp batch using pending commitment hashes from MongoDB.
 *
 * 1. Connect to MongoDB (MONGODB_URI, same DB as backend).
 * 2. Read pendingPerpReveals for the default pool (poolId from pool key).
 * 3. Optionally check batch interval on chain; fund Hook if needed.
 * 4. Call revealAndBatchExecutePerps(poolKey, commitmentHashes, baseIsCurrency0).
 * 5. Mark executed hashes as executed: true in pendingPerpReveals; optionally remove them (--clear).
 *
 * Usage:
 *   node execute-perp-batch-from-mongo.js [--clear] [--no-wait]
 *
 * Env:
 *   PRIVATE_KEY, RPC_URL (or ARBITRUM_SEPOLIA_RPC_URL)
 *   MONGODB_URI (required)
 *   MONGODB_DB_NAME (optional, default zkperps)
 *   HOOK_ADDRESS, MOCK_USDC, MOCK_USDT (optional; use DEPLOYED on Arbitrum Sepolia)
 *   BASE_IS_CURRENCY0 (optional, default true)
 *
 * --clear   After successful execute, delete the executed commitment hashes from pendingPerpReveals (otherwise only executed: true is set).
 * --no-wait Skip batch-interval check (call execute anyway; may revert if interval not met).
 */

const { ethers } = require("ethers");
const { MongoClient } = require("mongodb");
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
require("dotenv").config();

const DEPLOYED = {
  MOCK_USDC: "0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e",
  MOCK_USDT: "0x3c604069c87256bbab9cc3ff678410275b156755",
  PRIV_BATCH_HOOK: "0xe3ea87fb759c3206a9595048732eb6a6000700c4",
};

const RPC_URL =
  process.env.RPC_URL ||
  process.env.ARBITRUM_SEPOLIA_RPC_URL ||
  process.env.BASE_SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "zkperps";
const HOOK_ADDRESS = process.env.HOOK_ADDRESS || DEPLOYED.PRIV_BATCH_HOOK;
const MOCK_USDC = process.env.MOCK_USDC || process.env.MOCK_USDC_ADDRESS || DEPLOYED.MOCK_USDC;
const MOCK_USDT = process.env.MOCK_USDT || process.env.MOCK_USDT_ADDRESS || DEPLOYED.MOCK_USDT;
const BASE_IS_CURRENCY0 = process.env.BASE_IS_CURRENCY0 !== "false";

const MIN_COMMITMENTS = 2;
const BATCH_INTERVAL_SEC = 5 * 60;

const HOOK_ABI = [
  "function revealAndBatchExecutePerps(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bytes32[] commitmentHashes, bool baseIsCurrency0)",
  "function BATCH_INTERVAL() view returns (uint256)",
  "function perpBatchStates(bytes32) view returns (uint256 lastBatchTimestamp, uint256 commitmentCount)",
  "function perpPositionManager() view returns (address)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
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

function computePoolId(poolKey) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)"],
      [poolKey],
    ),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const clearAfter = args.includes("--clear");
  const noWait = args.includes("--no-wait");

  console.log("Execute perp batch from MongoDB");
  console.log("=".repeat(60));

  if (!PRIVATE_KEY || !RPC_URL) {
    console.error("Missing env: PRIVATE_KEY, RPC_URL");
    process.exit(1);
  }
  if (!MONGODB_URI) {
    console.error("Missing env: MONGODB_URI (use same as backend)");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  const usdcAddr = chainId === 421614 ? DEPLOYED.MOCK_USDC : MOCK_USDC;
  const usdtAddr = chainId === 421614 ? DEPLOYED.MOCK_USDT : MOCK_USDT;
  const hookAddr = chainId === 421614 ? DEPLOYED.PRIV_BATCH_HOOK : HOOK_ADDRESS;

  const currency0 = usdcAddr < usdtAddr ? usdcAddr : usdtAddr;
  const currency1 = usdcAddr < usdtAddr ? usdtAddr : usdcAddr;
  const poolKey = buildPoolKey(currency0, currency1, hookAddr);
  const poolId = computePoolId(poolKey);

  console.log("\nConfig:");
  console.log("  ChainId:", chainId);
  console.log("  Signer:", signer.address);
  console.log("  Hook:", hookAddr);
  console.log("  PoolId:", poolId.slice(0, 18) + "...");
  console.log("  baseIsCurrency0:", BASE_IS_CURRENCY0);
  console.log("  Clear pending after execute:", clearAfter);
  console.log("  Skip batch-interval check:", noWait);

  // 1. Read pending commits from MongoDB
  console.log("\n--- 1. Read pending reveals from MongoDB ---");
  const client = new MongoClient(MONGODB_URI);
  let commitmentHashes = [];

  try {
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);
    const coll = db.collection("pendingPerpReveals");
    // Only non-executed commitments (executed not true; missing field treated as pending)
    const docs = await coll.find({ poolId, executed: { $ne: true } }).sort({ createdAt: 1 }).toArray();
    commitmentHashes = docs.map((d) => d.commitmentHash);
    console.log("  Found", commitmentHashes.length, "pending commitment(s)");
  } catch (e) {
    console.error("  MongoDB error:", e.message);
    process.exit(1);
  } finally {
    await client.close();
  }

  if (commitmentHashes.length < MIN_COMMITMENTS) {
    console.error(
      "  Need at least",
      MIN_COMMITMENTS,
      "pending commitments. Have",
      commitmentHashes.length,
    );
    process.exit(1);
  }

  const hook = new ethers.Contract(hookAddr, HOOK_ABI, signer);

  // 2. Batch interval check
  if (!noWait) {
    const [batchState, batchInterval] = await Promise.all([
      hook.perpBatchStates(poolId),
      hook.BATCH_INTERVAL().catch(() => BigInt(BATCH_INTERVAL_SEC)),
    ]);
    const nowSec = Math.floor(Date.now() / 1000);
    const intervalSec = Number(batchInterval);
    const lastBatchSec = Number(batchState[0]);
    const nextSec = lastBatchSec === 0n ? nowSec : lastBatchSec + intervalSec;
    if (nowSec < nextSec) {
      console.error(
        "  Batch interval not met. Next execution at",
        new Date(nextSec * 1000).toISOString(),
        "(" + (nextSec - nowSec) + "s from now). Use --no-wait to try anyway.",
      );
      process.exit(1);
    }
    console.log("  Batch interval OK");
  }

  // 3. Optional: total base size from perpOrders for funding
  let totalBaseSize = 0n;
  try {
    const client2 = new MongoClient(MONGODB_URI);
    await client2.connect();
    const db = client2.db(MONGODB_DB_NAME);
    const ordersColl = db.collection("perpOrders");
    const orders = await ordersColl
      .find({ commitmentHash: { $in: commitmentHashes }, status: "pending" })
      .toArray();
    for (const o of orders) {
      totalBaseSize += BigInt(o.size);
    }
    await client2.close();
  } catch (_) {}

  // 4. Fund Hook if needed
  const quoteCurrency = BASE_IS_CURRENCY0 ? currency1 : currency0;
  const quoteToken = new ethers.Contract(
    quoteCurrency,
    ERC20_ABI,
    signer,
  );
  const quoteDec = 6;
  const oneEther = ethers.parseEther("1");
  const fundingPriceEstimate18d = ethers.parseEther("2500");
  const bufferMultiplier = 10n;
  const quoteDecMultiplier = 10n ** BigInt(quoteDec);

  const hookQuoteNeeded =
    totalBaseSize > 0n
      ? (totalBaseSize * fundingPriceEstimate18d * bufferMultiplier * quoteDecMultiplier) /
        (oneEther * oneEther)
      : 0n;

  let hookQuoteBalance = 0n;
  try {
    hookQuoteBalance = await quoteToken.balanceOf(hookAddr);
  } catch (_) {}

  if (hookQuoteNeeded > 0n && hookQuoteBalance < hookQuoteNeeded) {
    const toTransfer = hookQuoteNeeded - hookQuoteBalance;
    const signerBalance = await quoteToken.balanceOf(signer.address);
    if (signerBalance < toTransfer) {
      console.error(
        "  Signer quote balance",
        ethers.formatUnits(signerBalance, quoteDec),
        "<",
        ethers.formatUnits(toTransfer, quoteDec),
        "needed to fund Hook.",
      );
      process.exit(1);
    }
    const fundTx = await quoteToken.transfer(hookAddr, toTransfer);
    await fundTx.wait();
    console.log("  Funded Hook with", ethers.formatUnits(toTransfer, quoteDec), "quote");
  } else if (hookQuoteNeeded > 0n) {
    console.log("  Hook has sufficient quote:", ethers.formatUnits(hookQuoteBalance, quoteDec));
  }

  // 5. Simulate then execute batch
  console.log("\n--- 2. revealAndBatchExecutePerps ---");
  try {
    await hook.revealAndBatchExecutePerps.staticCall(
      poolKey,
      commitmentHashes,
      BASE_IS_CURRENCY0,
    );
  } catch (e) {
    const isDivByZero =
      (e.reason && e.reason.includes("DIVIDE_BY_ZERO")) ||
      (e.data && typeof e.data === "string" && e.data.includes("4e487b71"));
    if (isDivByZero) {
      console.error("  Simulate failed: pool has zero in-range liquidity (Panic 18).");
      console.error("  Initialize the pool and add liquidity on the same PoolManager the Hook uses.");
      console.error("  See: backend/POOL_SETUP.md");
    } else {
      console.error("  Simulate failed:", e.message || e.shortMessage);
      if (e.data) console.error("  Data:", e.data);
    }
    process.exit(1);
  }

  try {
    const execTx = await hook.revealAndBatchExecutePerps(
      poolKey,
      commitmentHashes,
      BASE_IS_CURRENCY0,
    );
    await execTx.wait();
    console.log("  Tx:", execTx.hash);
  } catch (e) {
    const isDivByZero =
      (e.reason && e.reason.includes("DIVIDE_BY_ZERO")) ||
      (e.data && typeof e.data === "string" && e.data.includes("4e487b71"));
    if (isDivByZero) {
      console.error("  Execute failed: pool has zero in-range liquidity (Panic 18).");
      console.error("  Initialize the pool and add liquidity on the same PoolManager the Hook uses.");
      console.error("  See: backend/POOL_SETUP.md");
    } else {
      console.error("  Execute failed:", e.message || e.shortMessage);
      if (e.data) console.error("  Data:", e.data);
    }
    process.exit(1);
  }

  // 6. Mark executed in MongoDB; optionally delete (--clear)
  console.log("\n--- 3. Mark executed in MongoDB ---");
  try {
    const client3 = new MongoClient(MONGODB_URI);
    await client3.connect();
    const coll = client3.db(MONGODB_DB_NAME).collection("pendingPerpReveals");
    const updateResult = await coll.updateMany(
      { poolId, commitmentHash: { $in: commitmentHashes } },
      { $set: { executed: true } },
    );
    console.log("  Marked", updateResult.modifiedCount, "commitment(s) as executed");
    if (clearAfter) {
      const deleteResult = await coll.deleteMany({ poolId, commitmentHash: { $in: commitmentHashes } });
      console.log("  Deleted", deleteResult.deletedCount, "pending reveal(s) (--clear)");
    }
    await client3.close();
  } catch (e) {
    console.warn("  Could not update/clear pending:", e.message);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Batch executed successfully.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
