/**
 * Perp routes: perpetual futures trading operations via Privy server-side signing.
 * 
 * All transactions are signed server-side using Privy's authorization keys.
 * No user approval popups required after initial wallet setup.
 * 
 * Chain: All transactions use Arbitrum Sepolia (chain ID: 421614)
 * Privy automatically switches embedded wallets to this chain when transactions are sent.
 * 
 * Server-side signing flow:
 * 1. Frontend adds the backend as a signer using addSigners() with the key quorum ID
 * 2. Backend uses the authorization private key to sign transactions without user interaction
 * 3. Transactions are executed on behalf of the user via Privy's secure enclave
 * 4. All transactions specify caip2: 'eip155:421614' to ensure correct chain
 * 
 * @see https://docs.privy.io/wallets/wallets/server-side-access
 * @see PRIVY_TRANSACTION_TYPES.md for all available transaction types and chain management
 */
import { Router, Response } from "express";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { verifyWalletSetup } from "../lib/privy.js";
import { sendTransactionAsUser } from "../lib/send-transaction.js";
import {
  buildPoolKey,
  computePoolId,
  encodeSubmitPerpCommitment,
  encodeSubmitPerpReveal,
  encodeRevealAndBatchExecutePerps,
  getDepositCollateralCalldata,
  encodeErc20Transfer,
  type PoolKey,
  type PerpIntent,
  contractAddresses,
} from "../lib/contracts.js";
import {
  computePerpCommitmentHash,
  getPosition,
  getTotalCollateral,
  getAvailableMargin,
  getBatchState,
  getBatchInterval,
  getTokenBalance,
  getTokenAllowance,
  getPublicClient,
  getPoolSlot0SqrtPriceX96,
  getPoolLiquidity,
} from "../lib/contract-reader.js";
import {
  getPendingPerpRevealsCollection,
  getPerpOrdersCollection,
  getPerpTradesCollection,
} from "../lib/db.js";
import { config } from "../config.js";
import { tryExecuteBatchIfReady } from "../lib/keeper.js";

/** Normalize intent fields that may be string to bigint for contract calls */
function intentToBigint(intent: PerpIntent): {
  user: `0x${string}`;
  market: `0x${string}`;
  size: bigint;
  isLong: boolean;
  isOpen: boolean;
  collateral: bigint;
  leverage: bigint;
  nonce: bigint;
  deadline: bigint;
} {
  const big = (v: string | number | bigint | undefined) =>
    v === undefined ? 0n : typeof v === "bigint" ? v : BigInt(String(v));
  return {
    user: intent.user as `0x${string}`,
    market: intent.market as `0x${string}`,
    size: big(intent.size),
    isLong: Boolean(intent.isLong),
    isOpen: Boolean(intent.isOpen),
    collateral: big(intent.collateral),
    leverage: big(intent.leverage),
    nonce: big(intent.nonce),
    deadline: big(intent.deadline),
  };
}

export const perpRouter = Router();
perpRouter.use(authenticate);

// Target chain: Arbitrum Sepolia (421614) - HARDCODED DEFAULT
// All transactions use this chain - cannot be changed
const TARGET_CHAIN_ID = 421614;

/**
 * GET /api/perp/chain-info
 * 
 * Gets the chain information for the backend.
 * All transactions are sent on Arbitrum Sepolia (421614).
 * 
 * @returns { chainId: number, chainName: string, caip2: string }
 */
perpRouter.get("/chain-info", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json({
      chainId: TARGET_CHAIN_ID,
      chainName: "Arbitrum Sepolia",
      caip2: `eip155:${TARGET_CHAIN_ID}`,
      note: "All transactions are sent on this chain. Privy automatically switches embedded wallets to this chain.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get chain info";
    console.error("[Perp] Get chain info error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/perp/compute-commitment-hash
 * Body: { intent: PerpIntent }
 * 
 * Computes the commitment hash for a perp intent (read-only, no transaction).
 * 
 * @returns { commitmentHash: string }
 */
perpRouter.post("/compute-commitment-hash", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const { intent } = req.body as { intent?: PerpIntent };
    if (!intent) {
      res.status(400).json({ error: "intent is required" });
      return;
    }

    // Validate intent structure
    if (!intent.user || !intent.market || intent.size === undefined || intent.leverage === undefined) {
      res.status(400).json({ error: "Invalid intent structure" });
      return;
    }

    const normalized = intentToBigint(intent);
    if (normalized.size <= 0n) {
      res.status(400).json({ error: "intent.size must be positive (magnitude); use isLong for direction" });
      return;
    }
    if (normalized.leverage <= 0n) {
      res.status(400).json({ error: "intent.leverage must be positive (e.g. 5e18 for 5x)" });
      return;
    }

    // Compute commitment hash (read-only call)
    const commitmentHash = await computePerpCommitmentHash(normalized);

    res.json({ commitmentHash });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to compute commitment hash";
    console.error("[Perp] Compute commitment hash error:", message);
    res.status(500).json({ error: message });
  }
});

/** USDC decimals (collateral token) */
const USDC_DECIMALS = 6;

/**
 * POST /api/perp/deposit
 * Body: { amount: string | number } — amount in USDC (e.g. 100 for 100 USDC)
 *
 * Approves USDC to PerpPositionManager then deposits collateral (two transactions).
 *
 * @returns { approveHash: string, depositHash: string }
 */
perpRouter.post("/deposit", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const walletSetup = await verifyWalletSetup(req.user.sub);
    if (!walletSetup.isSetup || !walletSetup.walletAddress) {
      res.status(400).json({
        error: walletSetup.error || "Wallet not properly set up",
        instructions: "Call POST /api/auth/link with walletAddress and walletId, then call addSigners() with the returned signerId.",
      });
      return;
    }

    const { amount } = req.body as { amount?: string | number };
    const amountNum = amount !== undefined ? Number(amount) : NaN;
    if (Number.isNaN(amountNum) || amountNum <= 0) {
      res.status(400).json({ error: "amount is required and must be a positive number (USDC)" });
      return;
    }

    const amountRaw = BigInt(Math.floor(amountNum * 10 ** USDC_DECIMALS));
    const userAddress = walletSetup.walletAddress as `0x${string}`;
    console.log("[Perp] Deposit: wallet address", userAddress);

    const balance = await getTokenBalance(contractAddresses.mockUsdc, userAddress);
    if (balance < amountRaw) {
      const balanceFormatted = Number(balance) / 10 ** USDC_DECIMALS;
      const msg = `Wallet has ${balanceFormatted.toFixed(2)} USDC but deposit amount is ${amountNum.toFixed(2)} USDC. Add USDC to your wallet first.`;
      res.status(400).json({
        error: msg,
        balanceUsdc: balanceFormatted,
        requestedUsdc: amountNum,
      });
      return;
    }

    const { approveData, depositData } = getDepositCollateralCalldata(userAddress, amountRaw);

    // 1. Approve USDC to PerpPositionManager
    const approveResult = await sendTransactionAsUser(walletSetup.walletId!, {
      to: contractAddresses.mockUsdc,
      data: approveData,
    });

    // 2. Deposit collateral (PerpPositionManager pulls USDC from user)
    const depositResult = await sendTransactionAsUser(walletSetup.walletId!, {
      to: contractAddresses.perpPositionManager,
      data: depositData,
    });

    res.json({ approveHash: approveResult.hash, depositHash: depositResult.hash });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Deposit failed";
    console.error("[Perp] Deposit error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/perp/commit
 * Body: { poolKey?: PoolKey, commitmentHash: string }
 * 
 * Submits a perp commitment to the Hook contract.
 * 
 * @returns { hash: string } Transaction hash
 */
perpRouter.post("/commit", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    // Verify wallet is set up for server-side transactions
    const walletSetup = await verifyWalletSetup(req.user.sub);
    if (!walletSetup.isSetup) {
      res.status(400).json({
        error: walletSetup.error || "Wallet not properly set up",
        instructions: "Call POST /api/auth/link with walletAddress and walletId, then call addSigners() with the returned signerId.",
      });
      return;
    }

    const { poolKey: providedPoolKey, commitmentHash } = req.body as {
      poolKey?: PoolKey;
      commitmentHash?: string;
    };

    if (!commitmentHash || typeof commitmentHash !== "string") {
      res.status(400).json({ error: "commitmentHash is required" });
      return;
    }

    // Build pool key if not provided (use default from config)
    const poolKey = providedPoolKey || buildPoolKey(
      contractAddresses.mockUsdc,
      contractAddresses.mockUsdt,
      contractAddresses.privBatchHook,
    );

    // Encode transaction data
    const data = encodeSubmitPerpCommitment(poolKey, commitmentHash as `0x${string}`);

    // Send transaction via Privy (server-side signing)
    // Uses authorization_context with authorization_private_keys for server-side signing
    // No user approval popup required - transaction is signed by backend authorization key
    const result = await sendTransactionAsUser(walletSetup.walletId!, {
      to: contractAddresses.privBatchHook,
      data,
    });

    res.json({ hash: result.hash });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to submit commitment";
    console.error("[Perp] Commit error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/perp/reveal
 * Body: { poolKey?: PoolKey, intent: PerpIntent }
 * 
 * Submits a perp reveal to the Hook contract.
 * 
 * @returns { hash: string } Transaction hash
 */
perpRouter.post("/reveal", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    // Verify wallet is set up for server-side transactions
    const walletSetup = await verifyWalletSetup(req.user.sub);
    if (!walletSetup.isSetup) {
      res.status(400).json({
        error: walletSetup.error || "Wallet not properly set up",
        instructions: "Call POST /api/auth/link with walletAddress and walletId, then call addSigners() with the returned signerId.",
      });
      return;
    }

    const { poolKey: providedPoolKey, intent } = req.body as {
      poolKey?: PoolKey;
      intent?: PerpIntent;
    };

    if (!intent) {
      res.status(400).json({ error: "intent is required" });
      return;
    }

    // Validate intent structure
    if (!intent.user || !intent.market || intent.size === undefined || intent.leverage === undefined) {
      res.status(400).json({ error: "Invalid intent structure" });
      return;
    }

    // Normalize to bigint and validate (contract uses uint256 size = magnitude; zero causes division-by-zero / Panic 18)
    const normalized = intentToBigint(intent);
    if (normalized.size <= 0n) {
      res.status(400).json({
        error: "intent.size must be positive (magnitude); use isLong for direction",
      });
      return;
    }
    if (normalized.leverage <= 0n) {
      res.status(400).json({ error: "intent.leverage must be positive (e.g. 5e18 for 5x)" });
      return;
    }
    // Use normalized intent for encoding so contract always gets valid values (e.g. positive size)
    const intentForTx = normalized;

    // Build pool key if not provided
    const poolKey = providedPoolKey || buildPoolKey(
      contractAddresses.mockUsdc,
      contractAddresses.mockUsdt,
      contractAddresses.privBatchHook,
    );

    // Encode transaction data
    const data = encodeSubmitPerpReveal(poolKey, intentForTx);

    // Send transaction via Privy (server-side signing)
    // Uses authorization_context with authorization_private_keys for server-side signing
    // No user approval popup required - transaction is signed by backend authorization key
    const result = await sendTransactionAsUser(walletSetup.walletId!, {
      to: contractAddresses.privBatchHook,
      data,
    });

    // Track revealed commitment for pending-batch and save order for open orders / trade history
    const commitmentHash = await computePerpCommitmentHash(intentForTx);
    const poolId = computePoolId(poolKey);
    const now = new Date();
    try {
      await getPendingPerpRevealsCollection().insertOne({
        poolId,
        commitmentHash,
        createdAt: now,
      });
      // Save order so frontend can show open orders and we can create trade record when batch executes
      await getPerpOrdersCollection().insertOne({
        privyUserId: req.user!.sub!,
        walletAddress: walletSetup.walletAddress!,
        poolId,
        commitmentHash,
        market: intentForTx.market,
        size: String(intentForTx.size),
        isLong: intentForTx.isLong,
        isOpen: intentForTx.isOpen,
        collateral: String(intentForTx.collateral),
        leverage: String(intentForTx.leverage),
        nonce: String(intentForTx.nonce),
        deadline: String(intentForTx.deadline),
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      console.log("[Perp] Stored pending reveal and order (poolId: %s) intent size=%s collateral=%s leverage=%s", poolId.slice(0, 18) + "...", String(intentForTx.size), String(intentForTx.collateral), String(intentForTx.leverage));
    } catch (dbErr) {
      // Reveal already succeeded on-chain; tracking is best-effort (e.g. no MongoDB or duplicate commitmentHash)
      console.warn("[Perp] Could not store pending reveal/order for batch:", dbErr);
    }

    // Auto-execute batch when ready (2+ pending and batch interval passed). Fire-and-forget so response returns immediately.
    tryExecuteBatchIfReady(
      { walletId: walletSetup.walletId!, walletAddress: walletSetup.walletAddress },
      "post-reveal",
      poolKey,
    ).catch((err) => console.warn("[Perp] Post-reveal auto-execute check failed:", err));

    res.json({ hash: result.hash });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to submit reveal";
    console.error("[Perp] Reveal error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/perp/execute-batch
 * Body: { poolKey?: PoolKey, commitmentHashes: string[], baseIsCurrency0?: boolean }
 * 
 * Executes a batch of perp reveals and settles positions.
 * 
 * @returns { hash: string } Transaction hash
 */
perpRouter.post("/execute-batch", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    // Verify wallet is set up for server-side transactions
    const walletSetup = await verifyWalletSetup(req.user.sub);
    if (!walletSetup.isSetup) {
      res.status(400).json({
        error: walletSetup.error || "Wallet not properly set up",
        instructions: "Call POST /api/auth/link with walletAddress and walletId, then call addSigners() with the returned signerId.",
      });
      return;
    }

    const { poolKey: providedPoolKey, commitmentHashes: bodyHashes, baseIsCurrency0 } = req.body as {
      poolKey?: PoolKey;
      commitmentHashes?: string[];
      baseIsCurrency0?: boolean;
    };

    // Build pool key if not provided
    const poolKey = providedPoolKey || buildPoolKey(
      contractAddresses.mockUsdc,
      contractAddresses.mockUsdt,
      contractAddresses.privBatchHook,
    );

    // Use body hashes or fetch pending from DB for this pool
    let commitmentHashes: string[] = bodyHashes ?? [];
    if (commitmentHashes.length === 0) {
      try {
        const poolId = computePoolId(poolKey);
        const docs = await getPendingPerpRevealsCollection()
          .find({ poolId })
          .sort({ createdAt: 1 })
          .toArray();
        commitmentHashes = docs.map((d) => d.commitmentHash);
      } catch (dbErr) {
        console.warn("[Perp] Execute-batch: could not read pending reveals:", dbErr);
      }
    }

    if (commitmentHashes.length === 0) {
      res.status(400).json({ error: "commitmentHashes array is required or have pending reveals (call GET /api/perp/pending-batch)" });
      return;
    }

    const fromBody = (bodyHashes?.length ?? 0) > 0;
    console.log("[Perp] Execute-batch: executing batch", {
      commitmentCount: commitmentHashes.length,
      source: fromBody ? "body" : "pending DB",
    });

    // Use config default if not provided
    const baseIsCurrency0Value = baseIsCurrency0 ?? config.baseIsCurrency0;

    // Fund Hook with quote if needed (see scripts/zk/test-perp-e2e.js step 5.6)
    const quoteTokenBatch = baseIsCurrency0Value ? poolKey.currency1 : poolKey.currency0;
    const quoteDecBatch = 6;
    const oneEtherBatch = 10n ** 18n;
    const fundingPriceEstimate18dBatch = 2500n * oneEtherBatch;
    const bufferMultiplierBatch = 10n;
    const quoteDecMultiplierBatch = 10n ** BigInt(quoteDecBatch);

    let totalBaseSizeBatch = 0n;
    try {
      const pendingOrdersBatch = await getPerpOrdersCollection()
        .find({ commitmentHash: { $in: commitmentHashes }, status: "pending" })
        .toArray();
      for (const o of pendingOrdersBatch) {
        totalBaseSizeBatch += BigInt(o.size);
      }
    } catch (_) {}

    const hookQuoteNeededBatch =
      totalBaseSizeBatch > 0n
        ? (totalBaseSizeBatch * fundingPriceEstimate18dBatch * bufferMultiplierBatch * quoteDecMultiplierBatch) / (oneEtherBatch * oneEtherBatch)
        : 0n;

    let hookQuoteBalanceBatch = 0n;
    try {
      hookQuoteBalanceBatch = await getTokenBalance(quoteTokenBatch as `0x${string}`, contractAddresses.privBatchHook);
    } catch (_) {}

    if (hookQuoteNeededBatch > 0n && hookQuoteBalanceBatch < hookQuoteNeededBatch) {
      const toTransferBatch = hookQuoteNeededBatch - hookQuoteBalanceBatch;
      const userQuoteBalanceBatch = await getTokenBalance(quoteTokenBatch as `0x${string}`, walletSetup.walletAddress as `0x${string}`);
      if (userQuoteBalanceBatch < toTransferBatch) {
        res.status(400).json({
          error: "Insufficient USDC to fund Hook for batch execution.",
          needed: toTransferBatch.toString(),
          have: userQuoteBalanceBatch.toString(),
        });
        return;
      }
      const transferDataBatch = encodeErc20Transfer(contractAddresses.privBatchHook, toTransferBatch);
      await sendTransactionAsUser(walletSetup.walletId!, {
        to: quoteTokenBatch as `0x${string}`,
        data: transferDataBatch,
      });
      console.log("[Perp] Execute-batch: funded Hook with", toTransferBatch.toString(), "quote");
    }

    // Encode transaction data
    const data = encodeRevealAndBatchExecutePerps(
      poolKey,
      commitmentHashes as `0x${string}`[],
      baseIsCurrency0Value,
    );

    // Send transaction via Privy (server-side signing)
    // Uses authorization_context with authorization_private_keys for server-side signing
    // No user approval popup required - transaction is signed by backend authorization key
    // This enables offline batch execution, agentic trading, and automated operations
    const result = await sendTransactionAsUser(walletSetup.walletId!, {
      to: contractAddresses.privBatchHook,
      data,
    });

    console.log("[Perp] Execute-batch: executed successfully", {
      txHash: result.hash,
      batchSize: commitmentHashes.length,
    });

    const poolId = computePoolId(poolKey);
    const executedAt = new Date();

    // Remove executed commitment hashes from pending; mark orders executed; create trade history
    try {
      await getPendingPerpRevealsCollection().deleteMany({
        poolId,
        commitmentHash: { $in: commitmentHashes },
      });

      const ordersColl = getPerpOrdersCollection();
      const tradesColl = getPerpTradesCollection();
      const executedOrders = await ordersColl
        .find({ commitmentHash: { $in: commitmentHashes }, status: "pending" })
        .toArray();

      for (const order of executedOrders) {
        await ordersColl.updateOne(
          { commitmentHash: order.commitmentHash },
          {
            $set: {
              status: "executed",
              updatedAt: executedAt,
              executedAt,
              txHash: result.hash,
            },
          },
        );
        await tradesColl.insertOne({
          privyUserId: order.privyUserId,
          walletAddress: order.walletAddress,
          market: order.market,
          size: order.size,
          isLong: order.isLong,
          isOpen: order.isOpen,
          collateral: order.collateral,
          leverage: order.leverage,
          entryPrice: null,
          txHash: result.hash,
          executedAt,
          poolId: order.poolId,
          commitmentHash: order.commitmentHash,
        });
      }
    } catch (dbErr) {
      console.warn("[Perp] Could not update orders/trades after execute-batch:", dbErr);
    }

    res.json({ hash: result.hash });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to execute batch";
    console.error("[Perp] Execute batch error:", message);
    res.status(500).json({ error: message });
  }
});

const MIN_COMMITMENTS_FOR_EXECUTE = 2;

/**
 * POST /api/perp/execute
 * No body required. Fetches pending reveals from DB for the default pool and executes the batch.
 * Convenience endpoint for a one-click "Execute batch" button.
 *
 * @returns { hash: string, batchSize: number } Transaction hash and number of commitments executed
 */
perpRouter.post("/execute", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const walletSetup = await verifyWalletSetup(req.user.sub);
    if (!walletSetup.isSetup) {
      res.status(400).json({
        error: walletSetup.error || "Wallet not properly set up",
        instructions: "Call POST /api/auth/link with walletAddress and walletId, then call addSigners() with the returned signerId.",
      });
      return;
    }

    const poolKey = buildPoolKey(
      contractAddresses.mockUsdc,
      contractAddresses.mockUsdt,
      contractAddresses.privBatchHook,
    );
    const poolId = computePoolId(poolKey);

    let commitmentHashes: string[] = [];
    try {
      const docs = await getPendingPerpRevealsCollection()
        .find({ poolId })
        .sort({ createdAt: 1 })
        .toArray();
      commitmentHashes = docs.map((d) => d.commitmentHash);
    } catch (dbErr) {
      console.warn("[Perp] Execute: could not read pending reveals:", dbErr);
    }

    if (commitmentHashes.length < MIN_COMMITMENTS_FOR_EXECUTE) {
      res.status(400).json({
        error: `Need at least ${MIN_COMMITMENTS_FOR_EXECUTE} pending commitments to execute.`,
        count: commitmentHashes.length,
        minCommitments: MIN_COMMITMENTS_FOR_EXECUTE,
      });
      return;
    }

    // Execute as soon as we have 2+ commitments (no batch interval wait)
    const baseIsCurrency0Value = config.baseIsCurrency0;

    // Fund Hook with quote if needed (see scripts/zk/test-perp-e2e.js step 5.6).
    // Hook must hold quote to settle the perp swap; otherwise execution reverts with division by zero.
    const quoteToken = baseIsCurrency0Value ? poolKey.currency1 : poolKey.currency0;
    const quoteDec = 6;
    const oneEther = 10n ** 18n;
    const fundingPriceEstimate18d = 2500n * oneEther;
    const bufferMultiplier = 10n;
    const quoteDecMultiplier = 10n ** BigInt(quoteDec);

    let totalBaseSize = 0n;
    try {
      const pendingOrders = await getPerpOrdersCollection()
        .find({ commitmentHash: { $in: commitmentHashes }, status: "pending" })
        .toArray();
      for (const o of pendingOrders) {
        totalBaseSize += BigInt(o.size);
      }
    } catch (_) {}

    const hookQuoteNeeded =
      totalBaseSize > 0n
        ? (totalBaseSize * fundingPriceEstimate18d * bufferMultiplier * quoteDecMultiplier) / (oneEther * oneEther)
        : 0n;

    let hookQuoteBalance = 0n;
    try {
      hookQuoteBalance = await getTokenBalance(quoteToken as `0x${string}`, contractAddresses.privBatchHook);
    } catch (_) {}

    console.log("[Perp] Execute: funding check", {
      totalBaseSize: totalBaseSize.toString(),
      hookQuoteNeeded: hookQuoteNeeded.toString(),
      hookQuoteBalance: hookQuoteBalance.toString(),
      pendingOrdersCount: commitmentHashes.length,
    });

    if (hookQuoteNeeded > 0n && hookQuoteBalance < hookQuoteNeeded) {
      const toTransfer = hookQuoteNeeded - hookQuoteBalance;
      const userQuoteBalance = await getTokenBalance(quoteToken as `0x${string}`, walletSetup.walletAddress as `0x${string}`);
      if (userQuoteBalance < toTransfer) {
        res.status(400).json({
          error: "Insufficient USDC to fund Hook for batch execution.",
          needed: toTransfer.toString(),
          have: userQuoteBalance.toString(),
          hint: "Transfer quote (USDC) to the Hook so it can settle the perp swap. The executor wallet must hold enough USDC.",
        });
        return;
      }
      const transferData = encodeErc20Transfer(contractAddresses.privBatchHook, toTransfer);
      await sendTransactionAsUser(walletSetup.walletId!, {
        to: quoteToken as `0x${string}`,
        data: transferData,
      });
      console.log("[Perp] Execute: funded Hook with", toTransfer.toString(), "quote for batch");
    }

    const data = encodeRevealAndBatchExecutePerps(
      poolKey,
      commitmentHashes as `0x${string}`[],
      baseIsCurrency0Value,
    );

    // Simulate before sending; on division-by-zero, return clear error if pool has no liquidity
    try {
      const client = getPublicClient();
      await client.call({
        to: contractAddresses.privBatchHook,
        data,
      });
    } catch (simErr: unknown) {
      const msg = simErr instanceof Error ? simErr.message : String(simErr);
      const isDivisionByZero =
        msg.includes("division or modulo by zero") ||
        msg.includes("Panic 18") ||
        (typeof (simErr as { data?: string }).data === "string" &&
          (simErr as { data: string }).data?.includes("18"));
      if (isDivisionByZero) {
        let poolLiquidity: bigint | undefined;
        let slot0SqrtPriceX96: bigint | undefined;
        try {
          slot0SqrtPriceX96 = await getPoolSlot0SqrtPriceX96(poolId as `0x${string}`);
          poolLiquidity = await getPoolLiquidity(poolId as `0x${string}`);
        } catch (_) {}
        const zeroLiquidity = poolLiquidity === 0n || poolLiquidity === undefined;
        const notInitialized = slot0SqrtPriceX96 === 0n || slot0SqrtPriceX96 === undefined;
        res.status(400).json({
          error: "Execution would revert: division or modulo by zero.",
          cause: zeroLiquidity || notInitialized
            ? "Pool has zero in-range liquidity or is not initialized."
            : "Contract reverted during simulation.",
          poolLiquidity: poolLiquidity?.toString() ?? "unknown",
          slot0SqrtPriceX96: slot0SqrtPriceX96?.toString() ?? "unknown",
          hint: "Initialize the pool and add liquidity (e.g. run SetupPoolLiquidity.s.sol). See backend/POOL_SETUP.md.",
        });
        return;
      }
      // Other simulate error: still return 500 with message so client sees something
      console.error("[Perp] Execute: simulate failed", msg);
      res.status(500).json({
        error: "Batch execution simulation failed.",
        details: msg,
      });
      return;
    }

    const result = await sendTransactionAsUser(walletSetup.walletId!, {
      to: contractAddresses.privBatchHook,
      data,
    });

    console.log("[Perp] Execute: executed successfully", {
      txHash: result.hash,
      batchSize: commitmentHashes.length,
    });

    const executedAt = new Date();
    try {
      await getPendingPerpRevealsCollection().deleteMany({
        poolId,
        commitmentHash: { $in: commitmentHashes },
      });

      const ordersColl = getPerpOrdersCollection();
      const tradesColl = getPerpTradesCollection();
      const executedOrders = await ordersColl
        .find({ commitmentHash: { $in: commitmentHashes }, status: "pending" })
        .toArray();

      for (const order of executedOrders) {
        await ordersColl.updateOne(
          { commitmentHash: order.commitmentHash },
          {
            $set: {
              status: "executed",
              updatedAt: executedAt,
              executedAt,
              txHash: result.hash,
            },
          },
        );
        await tradesColl.insertOne({
          privyUserId: order.privyUserId,
          walletAddress: order.walletAddress,
          market: order.market,
          size: order.size,
          isLong: order.isLong,
          isOpen: order.isOpen,
          collateral: order.collateral,
          leverage: order.leverage,
          entryPrice: null,
          txHash: result.hash,
          executedAt,
          poolId: order.poolId,
          commitmentHash: order.commitmentHash,
        });
      }
    } catch (dbErr) {
      console.warn("[Perp] Could not update orders/trades after execute:", dbErr);
    }

    res.json({ hash: result.hash, batchSize: commitmentHashes.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to execute batch";
    console.error("[Perp] Execute error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/perp/pending-batch
 * Uses default pool (Arbitrum Sepolia perp pool).
 *
 * Returns revealed commitments for the pool that can be passed to execute-batch,
 * plus contract batch state and whether the batch can be executed now.
 *
 * @returns { commitmentHashes, count, canExecute, nextExecutionAt, lastBatchTimestamp, batchIntervalSeconds }
 */
const MIN_COMMITMENTS = 2;

perpRouter.get("/pending-batch", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const poolKey = buildPoolKey(
      contractAddresses.mockUsdc,
      contractAddresses.mockUsdt,
      contractAddresses.privBatchHook,
    );
    const poolId = computePoolId(poolKey);

    let commitmentHashes: string[] = [];
    try {
      const docs = await getPendingPerpRevealsCollection()
        .find({ poolId })
        .sort({ createdAt: 1 })
        .toArray();
      commitmentHashes = docs.map((d) => d.commitmentHash);
    } catch (dbErr) {
      // MongoDB not connected or other error
      console.warn("[Perp] Pending-batch: could not read pending reveals:", dbErr);
    }

    const canExecute = commitmentHashes.length >= MIN_COMMITMENTS;

    res.json({
      poolId,
      commitmentHashes,
      count: commitmentHashes.length,
      canExecute,
      nextExecutionAt: canExecute ? new Date().toISOString() : null,
      minCommitments: MIN_COMMITMENTS,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get pending batch";
    console.error("[Perp] Pending-batch error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/perp/clear-pending-batch
 * Body: { poolId?: string } (optional; default pool if omitted)
 *
 * Removes all pending perp reveals for the pool from the DB. Use this when the
 * current pending batch contains bad reveals (e.g. from the old negative-size
 * intent) and you want to stop retrying and start fresh with new commits/reveals.
 * Does not remove anything on-chain.
 */
perpRouter.post("/clear-pending-batch", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const poolId = (req.body as { poolId?: string }).poolId;
    const filter = poolId ? { poolId } : { poolId: computePoolId(buildPoolKey(
      contractAddresses.mockUsdc,
      contractAddresses.mockUsdt,
      contractAddresses.privBatchHook,
    )) };

    const result = await getPendingPerpRevealsCollection().deleteMany(filter);
    console.log("[Perp] Clear-pending-batch: deleted %d pending reveal(s)", result.deletedCount);
    res.json({ deletedCount: result.deletedCount, poolId: filter.poolId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to clear pending batch";
    console.error("[Perp] Clear-pending-batch error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/perp/position
 * Query: { marketId?: string }
 * 
 * Gets the user's position for a specific market (or default market).
 * 
 * @returns Position data (size, entryPrice, collateral, leverage, etc.)
 */
perpRouter.get("/position", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    // Verify wallet is set up
    const walletSetup = await verifyWalletSetup(req.user.sub);
    if (!walletSetup.walletAddress) {
      res.status(400).json({ error: "Wallet not linked" });
      return;
    }

    const marketId = (req.query.marketId as string) || contractAddresses.marketId;

    // Get position from contract
    const position = await getPosition(
      walletSetup.walletAddress as `0x${string}`,
      marketId as `0x${string}`,
    );

    res.json({
      marketId,
      position: {
        size: position.size.toString(),
        entryPrice: position.entryPrice.toString(),
        collateral: position.collateral.toString(),
        leverage: position.leverage.toString(),
        lastFundingPaid: position.lastFundingPaid.toString(),
        entryCumulativeFunding: position.entryCumulativeFunding.toString(),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get position";
    console.error("[Perp] Get position error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/perp/collateral
 * 
 * Gets the user's total collateral and available margin.
 * 
 * @returns { totalCollateral: string, availableMargin: string }
 */
perpRouter.get("/collateral", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    // Verify wallet is set up
    const walletSetup = await verifyWalletSetup(req.user.sub);
    if (!walletSetup.walletAddress) {
      res.status(400).json({ error: "Wallet not linked" });
      return;
    }

    // Get collateral data from contract
    const [totalCollateral, availableMargin] = await Promise.all([
      getTotalCollateral(walletSetup.walletAddress as `0x${string}`),
      getAvailableMargin(walletSetup.walletAddress as `0x${string}`),
    ]);

    res.json({
      totalCollateral: totalCollateral.toString(),
      availableMargin: availableMargin.toString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get collateral";
    console.error("[Perp] Get collateral error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/perp/balances
 * 
 * Gets the user's token balances (USDC, USDT).
 * 
 * @returns { usdc: string, usdt: string }
 */
perpRouter.get("/balances", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    // Verify wallet is set up
    const walletSetup = await verifyWalletSetup(req.user.sub);
    if (!walletSetup.walletAddress) {
      res.status(400).json({ error: "Wallet not linked" });
      return;
    }

    const userAddress = walletSetup.walletAddress as `0x${string}`;

    // Get token balances
    const [usdcBalance, usdtBalance] = await Promise.all([
      getTokenBalance(contractAddresses.mockUsdc, userAddress),
      getTokenBalance(contractAddresses.mockUsdt, userAddress),
    ]);

    res.json({
      usdc: usdcBalance.toString(),
      usdt: usdtBalance.toString(),
      usdcContract: contractAddresses.mockUsdc,
      usdtContract: contractAddresses.mockUsdt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get balances";
    console.error("[Perp] Get balances error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/perp/batch-state
 * Query: { poolId?: string }
 * 
 * Gets the batch state for a pool (last batch timestamp, commitment count).
 * 
 * @returns Batch state data
 */
perpRouter.get("/batch-state", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const poolId = req.query.poolId as string | undefined;
    
    if (!poolId) {
      res.status(400).json({ error: "poolId is required" });
      return;
    }

    // Get batch state from contract
    const batchState = await getBatchState(poolId as `0x${string}`);

    res.json({
      poolId,
      lastBatchTimestamp: batchState.lastBatchTimestamp.toString(),
      commitmentCount: batchState.commitmentCount.toString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get batch state";
    console.error("[Perp] Get batch state error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/perp/batch-interval
 * 
 * Gets the batch interval from the Hook contract.
 * 
 * @returns { batchInterval: string } Batch interval in seconds
 */
perpRouter.get("/batch-interval", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batchInterval = await getBatchInterval();
    res.json({ batchInterval: batchInterval.toString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get batch interval";
    console.error("[Perp] Get batch interval error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/perp/orders
 * Query: { status?: "pending" | "executed" | "cancelled" | "all" } — default "pending" (open orders)
 *
 * Returns orders for the authenticated user (open orders or full order history).
 *
 * @returns { orders: PerpOrder[] }
 */
perpRouter.get("/orders", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const status = (req.query.status as string) || "pending";
    const validStatuses = ["pending", "executed", "cancelled", "all"];
    const filter: { privyUserId: string; status?: string } = { privyUserId: req.user.sub };
    if (status !== "all" && validStatuses.includes(status)) {
      filter.status = status;
    }

    const orders = await getPerpOrdersCollection()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json({
      orders: orders.map((o) => ({
        ...o,
        id: (o as { _id?: unknown })._id?.toString?.(),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get orders";
    console.error("[Perp] Get orders error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/perp/trade-history
 * Query: { limit?: number } — default 50, max 200
 *
 * Returns executed trade history for the authenticated user.
 *
 * @returns { trades: PerpTrade[] }
 */
perpRouter.get("/trade-history", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const trades = await getPerpTradesCollection()
      .find({ privyUserId: req.user.sub })
      .sort({ executedAt: -1 })
      .limit(limit)
      .toArray();

    res.json({
      trades: trades.map((t) => ({
        ...t,
        id: (t as { _id?: unknown })._id?.toString?.(),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get trade history";
    console.error("[Perp] Get trade history error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/perp/position-history
 * Query: { marketId?: string, limit?: number } — default limit 50, max 200
 *
 * Returns position-relevant history: trades that opened or closed positions for the user.
 * Frontend can use this together with GET /api/perp/position for current position.
 *
 * @returns { trades: PerpTrade[] }
 */
perpRouter.get("/position-history", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.sub) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const marketId = req.query.marketId as string | undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const filter: { privyUserId: string; market?: string } = { privyUserId: req.user.sub };
    if (marketId) filter.market = marketId;

    const trades = await getPerpTradesCollection()
      .find(filter)
      .sort({ executedAt: -1 })
      .limit(limit)
      .toArray();

    res.json({
      trades: trades.map((t) => ({
        ...t,
        id: (t as { _id?: unknown })._id?.toString?.(),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get position history";
    console.error("[Perp] Get position history error:", message);
    res.status(500).json({ error: message });
  }
});
