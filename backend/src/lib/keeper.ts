/**
 * Keeper: detect when a perp batch is ready and execute immediately.
 * - Triggered after every reveal (detect then execute with current user or keeper wallet).
 * - When KEEPER_PRIVY_USER_ID is set, also runs on an interval as fallback.
 */
import { decodeErrorResult } from "viem";
import { config } from "../config.js";
import { getPendingPerpRevealsCollection } from "./db.js";
import { buildPoolKey, computePoolId, encodeRevealAndBatchExecutePerps, contractAddresses, type PoolKey } from "./contracts.js";
import { getBatchState, getBatchInterval, getPublicClient, getTokenBalance, getPoolSlot0SqrtPriceX96, getPoolLiquidity, getHookPoolManager } from "./contract-reader.js";
import { verifyWalletSetup } from "./privy.js";
import { sendTransactionAsUser } from "./send-transaction.js";

const MIN_COMMITMENTS = 2;

/** Minimal ABI of custom errors for decoding batch execute reverts (hook + perp manager + pool). */
const BATCH_REVERT_ERRORS_ABI = [
  { type: "error", name: "InsufficientCommitments", inputs: [] },
  { type: "error", name: "BatchConditionsNotMet", inputs: [] },
  { type: "error", name: "InvalidPerpCommitment", inputs: [] },
  { type: "error", name: "DeadlineExpired", inputs: [] },
  { type: "error", name: "InvalidNonce", inputs: [] },
  { type: "error", name: "PerpManagerNotSet", inputs: [] },
  { type: "error", name: "InsufficientMargin", inputs: [] },
  { type: "error", name: "MarketNotActive", inputs: [] },
  { type: "error", name: "InvalidSize", inputs: [] },
  { type: "error", name: "PositionNotFound", inputs: [] },
  { type: "error", name: "InvalidLeverage", inputs: [] },
  { type: "error", name: "MarketNotFound", inputs: [] },
  { type: "error", name: "PoolNotInitialized", inputs: [] },
  { type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256", internalType: "uint256" }] },
] as const;

export interface WalletSetupForBatch {
  walletId: string;
}

/**
 * Detect if a pool has a batch ready (>= MIN_COMMITMENTS and interval passed).
 * If ready, execute using the provided wallet and return true; otherwise return false.
 * source: optional label for logs (e.g. "post-reveal" or "keeper").
 * poolKeyOverride: when provided (e.g. from reveal), use this pool so we read the same pool we wrote to.
 */
export async function tryExecuteBatchIfReady(
  walletSetup: WalletSetupForBatch,
  source?: string,
  poolKeyOverride?: PoolKey
): Promise<boolean> {
  const label = source ? ` (${source})` : "";
  try {
    const poolKey = poolKeyOverride ?? buildPoolKey(
      contractAddresses.mockUsdc,
      contractAddresses.mockUsdt,
      contractAddresses.privBatchHook,
    );
    const poolId = computePoolId(poolKey);

    let commitmentHashes: string[] = [];
    let oldestRevealCreatedAt: Date | undefined;
    try {
      const docs = await getPendingPerpRevealsCollection()
        .find({ poolId })
        .sort({ createdAt: 1 })
        .toArray();
      commitmentHashes = docs.map((d) => d.commitmentHash);
      if (docs.length > 0) oldestRevealCreatedAt = docs[0].createdAt;
    } catch (dbErr) {
      return false;
    }

    if (commitmentHashes.length < MIN_COMMITMENTS) {
      console.log("[Perp] Batch%s: detected %d commitment(s) (need %d) — not executing yet", label, commitmentHashes.length, MIN_COMMITMENTS);
      return false;
    }

    const maxBatch = config.keeper.maxPerpBatchSize > 0 ? config.keeper.maxPerpBatchSize : commitmentHashes.length;
    if (commitmentHashes.length > maxBatch) {
      commitmentHashes = commitmentHashes.slice(0, maxBatch);
      console.log("[Perp] Batch%s: capped to %d commitment(s) (KEEPER_MAX_PERP_BATCH_SIZE)", label, commitmentHashes.length);
    }
    if (commitmentHashes.length < MIN_COMMITMENTS) {
      console.log("[Perp] Batch%s: after cap have %d commitment(s) (need %d) — skip (increase KEEPER_MAX_PERP_BATCH_SIZE or wait for more)", label, commitmentHashes.length, MIN_COMMITMENTS);
      return false;
    }

    const [batchState, batchInterval] = await Promise.all([
      getBatchState(poolId),
      getBatchInterval(),
    ]);
    const nowSec = Math.floor(Date.now() / 1000);
    const intervalSec = Number(batchInterval);
    const lastBatchSec = Number(batchState.lastBatchTimestamp);
    const nextExecutionSec = lastBatchSec === 0 ? nowSec : lastBatchSec + intervalSec;
    if (nowSec < nextExecutionSec) {
      const waitSec = nextExecutionSec - nowSec;
      console.log("[Perp] Batch%s: detected %d commitment(s) — batch interval not reached (wait %ds)", label, commitmentHashes.length, waitSec);
      return false;
    }

    // Match E2E: wait BATCH_INTERVAL after oldest reveal before executing (script waits 5 min then revealAndBatchExecutePerps)
    if (oldestRevealCreatedAt != null) {
      const oldestSec = Math.floor(new Date(oldestRevealCreatedAt).getTime() / 1000);
      const batchReadySec = oldestSec + intervalSec;
      if (nowSec < batchReadySec) {
        const waitSec = batchReadySec - nowSec;
        console.log("[Perp] Batch%s: detected %d commitment(s) — waiting %ds after oldest reveal (like E2E) before execute", label, commitmentHashes.length, waitSec);
        return false;
      }
    }

    console.log("[Perp] Batch%s: detected %d commitment(s), executing now (poolId: %s)", label, commitmentHashes.length, poolId);
    console.log("[Perp] Batch%s: commitment hashes: %s", label, commitmentHashes.map((h) => h.slice(0, 18) + "...").join(", "));

    // Hook must hold quote to settle the perp swap (see scripts/zk/test-perp-e2e.js step 5.6)
    const quoteToken = config.baseIsCurrency0 ? poolKey.currency1 : poolKey.currency0;
    let hookQuoteBalance: bigint | undefined;
    try {
      hookQuoteBalance = await getTokenBalance(quoteToken, contractAddresses.privBatchHook);
      console.log("[Perp] Batch%s: Hook quote balance: %s", label, hookQuoteBalance.toString());
      if (hookQuoteBalance === 0n) {
        console.warn("[Perp] Batch%s: Hook has 0 quote balance — fund the hook (e.g. transfer USDC to PRIV_BATCH_HOOK) for batch execute to succeed. See scripts/zk/test-perp-e2e.js step 5.6.", label);
      }
    } catch {
      // ignore balance check errors
    }

    // #region agent log
    let poolLiquidity: bigint | undefined;
    let slot0SqrtPriceX96: bigint | undefined;
    try {
      slot0SqrtPriceX96 = await getPoolSlot0SqrtPriceX96(poolId);
      poolLiquidity = await getPoolLiquidity(poolId);
      console.log("[Perp] Batch%s: pool slot0 sqrtPriceX96=%s liquidity=%s", label, String(slot0SqrtPriceX96), String(poolLiquidity));
      if (poolLiquidity === 0n) {
        const hookPoolManager = await getHookPoolManager();
        const backendPoolManager = config.contracts.poolManager;
        if (hookPoolManager.toLowerCase() !== backendPoolManager.toLowerCase()) {
          console.warn(
            "[Perp] Batch%s: POOL_MANAGER mismatch — Hook uses %s but backend POOL_MANAGER is %s. Liquidity was likely added to a different manager. Set backend POOL_MANAGER to the Hook's manager and run SetupPoolLiquidity.s.sol with the same POOL_MANAGER. See backend/POOL_SETUP.md.",
            label,
            hookPoolManager,
            backendPoolManager,
          );
        } else {
          console.warn(
            "[Perp] Batch%s: Pool has zero in-range liquidity. Run SetupPoolLiquidity.s.sol with POOL_MANAGER=%s and same MOCK_USDC/MOCK_USDT/HOOK as backend. See backend/POOL_SETUP.md.",
            label,
            backendPoolManager,
          );
        }
      }
      fetch("http://127.0.0.1:7250/ingest/45f38e27-30c3-4adc-91dc-b2d064327c1e", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "keeper.ts:batch-execute",
          message: "Pool state before simulate",
          data: { poolId: poolId.slice(0, 18) + "...", sqrtPriceX96: String(slot0SqrtPriceX96), liquidity: String(poolLiquidity) },
          timestamp: Date.now(),
          hypothesisId: "A",
        }),
      }).catch(() => {});
    } catch (e) {
      console.warn("[Perp] Batch%s: could not read pool state", label, e);
    }
    // #endregion

    const data = encodeRevealAndBatchExecutePerps(
      poolKey,
      commitmentHashes as `0x${string}`[],
      config.baseIsCurrency0,
    );

    // Simulate to get revert reason (eth_call)
    try {
      const client = getPublicClient();
      await client.call({
        to: contractAddresses.privBatchHook,
        data,
      });
    } catch (simErr: unknown) {
      // Revert data: walk cause chain (same as viem getRevertErrorData); RPC may put data on RpcRequestError.data or nested
      let revertData: string | undefined;
      let e: unknown = simErr;
      while (e != null) {
        const d = (e as { data?: unknown }).data;
        const hex = typeof d === "string" && d.startsWith("0x") ? d : (d && typeof d === "object" && "data" in d && typeof (d as { data?: string }).data === "string") ? (d as { data: string }).data : undefined;
        if (hex && hex.length >= 10) {
          revertData = hex;
          break;
        }
        e = (e as { cause?: unknown }).cause;
      }
      if (typeof revertData === "string") {
        try {
          const decoded = decodeErrorResult({
            abi: BATCH_REVERT_ERRORS_ABI,
            data: revertData as `0x${string}`,
          });
          const hint = decoded.errorName === "Panic" && Number(decoded.args?.[0]) === 18
            ? " (division by zero — often zero liquidity in pool or zero leverage)"
            : "";
          console.warn("[Perp] Batch%s: simulate revert — %s %s%s", label, decoded.errorName, decoded.args?.length ? String(decoded.args) : "", hint);
          if (decoded.errorName === "Panic" && Number(decoded.args?.[0]) === 18) {
            console.warn(
              "[Perp] Batch%s: Panic 18 (division by zero). Pool has zero in-range liquidity. Ensure backend POOL_MANAGER matches the Hook's PoolManager and run SetupPoolLiquidity.s.sol with that same POOL_MANAGER. See backend/POOL_SETUP.md.",
              label,
            );
            // #region agent log
            fetch("http://127.0.0.1:7250/ingest/45f38e27-30c3-4adc-91dc-b2d064327c1e", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                location: "keeper.ts:panic18",
                message: "Simulate reverted Panic 18",
                data: { poolLiquidity: poolLiquidity != null ? String(poolLiquidity) : "unknown", slot0SqrtPriceX96: slot0SqrtPriceX96 != null ? String(slot0SqrtPriceX96) : "unknown" },
                timestamp: Date.now(),
                hypothesisId: "B",
              }),
            }).catch(() => {});
            // #endregion
          }
        } catch {
          console.warn("[Perp] Batch%s: simulate revert (raw): %s", label, revertData.slice(0, 66));
        }
      } else {
        const msg = simErr instanceof Error ? simErr.message : String(simErr);
        console.warn("[Perp] Batch%s: simulate revert (no data): %s", label, msg);
      }
      console.warn("[Perp] Batch%s: skipping send after simulate revert", label);
      return false;
    }

    const result = await sendTransactionAsUser(walletSetup.walletId, {
      to: contractAddresses.privBatchHook,
      data,
    });

    await getPendingPerpRevealsCollection().deleteMany({
      poolId,
      commitmentHash: { $in: commitmentHashes },
    });

    console.log("[Perp] Batch%s: executed successfully", label, { txHash: result.hash, batchSize: commitmentHashes.length });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Perp] Batch%s: execute failed", label, msg);
    // Log full error for revert debugging (e.g. InsufficientMargin, InvalidNonce, DeadlineExpired)
    const err = e as Error & { cause?: unknown; response?: { data?: unknown }; error?: unknown };
    if (err.cause != null || err.response != null || err.error != null) {
      console.warn("[Perp] Batch%s: error details:", label, err.cause ?? err.response ?? err.error);
    }
    return false;
  }
}

async function runOnce(): Promise<void> {
  const keeperUserId = config.keeper.privyUserId;
  if (!keeperUserId) return;

  try {
    const walletSetup = await verifyWalletSetup(keeperUserId);
    if (!walletSetup.isSetup || !walletSetup.walletId) {
      return; // log only occasionally to avoid spam
    }
    await tryExecuteBatchIfReady({ walletId: walletSetup.walletId }, "keeper");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Keeper] Run error:", msg);
  }
}

/**
 * Start the perp batch keeper. Runs every config.keeper.intervalMs when KEEPER_PRIVY_USER_ID is set.
 * Also, batch execution is triggered immediately after each reveal (see perp routes).
 */
export function startPerpBatchKeeper(): void {
  if (!config.keeper.privyUserId) {
    console.log("[Perp] Batch: auto-execute on interval disabled (set KEEPER_PRIVY_USER_ID to enable). Batch still runs when a user reveals and conditions are met.");
    return;
  }

  const ms = Math.max(15000, config.keeper.intervalMs);
  console.log("[Keeper] Perp batch keeper started (check every %ds). Detects pending batch and executes when ready.", ms / 1000);

  runOnce();
  setInterval(runOnce, ms);
}
