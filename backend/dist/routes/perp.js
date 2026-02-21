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
import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { verifyWalletSetup } from "../lib/privy.js";
import { sendTransactionAsUser } from "../lib/send-transaction.js";
import { buildPoolKey, computePoolId, encodeSubmitPerpCommitment, encodeSubmitPerpReveal, encodeRevealAndBatchExecutePerps, getDepositCollateralCalldata, contractAddresses, } from "../lib/contracts.js";
import { computePerpCommitmentHash, getPosition, getTotalCollateral, getAvailableMargin, getBatchState, getBatchInterval, getTokenBalance, } from "../lib/contract-reader.js";
import { getPendingPerpRevealsCollection } from "../lib/db.js";
import { config } from "../config.js";
/** Normalize intent fields that may be string to bigint for contract calls */
function intentToBigint(intent) {
    const big = (v) => v === undefined ? 0n : typeof v === "bigint" ? v : BigInt(String(v));
    return {
        user: intent.user,
        market: intent.market,
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
perpRouter.get("/chain-info", async (_req, res) => {
    try {
        res.json({
            chainId: TARGET_CHAIN_ID,
            chainName: "Arbitrum Sepolia",
            caip2: `eip155:${TARGET_CHAIN_ID}`,
            note: "All transactions are sent on this chain. Privy automatically switches embedded wallets to this chain.",
        });
    }
    catch (e) {
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
perpRouter.post("/compute-commitment-hash", async (req, res) => {
    try {
        if (!req.user?.sub) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }
        const { intent } = req.body;
        if (!intent) {
            res.status(400).json({ error: "intent is required" });
            return;
        }
        // Validate intent structure
        if (!intent.user || !intent.market || intent.size === undefined || intent.leverage === undefined) {
            res.status(400).json({ error: "Invalid intent structure" });
            return;
        }
        // Compute commitment hash (read-only call); normalize string numbers to bigint
        const commitmentHash = await computePerpCommitmentHash(intentToBigint(intent));
        res.json({ commitmentHash });
    }
    catch (e) {
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
perpRouter.post("/deposit", async (req, res) => {
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
        const { amount } = req.body;
        const amountNum = amount !== undefined ? Number(amount) : NaN;
        if (Number.isNaN(amountNum) || amountNum <= 0) {
            res.status(400).json({ error: "amount is required and must be a positive number (USDC)" });
            return;
        }
        const amountRaw = BigInt(Math.floor(amountNum * 10 ** USDC_DECIMALS));
        const userAddress = walletSetup.walletAddress;
        const { approveData, depositData } = getDepositCollateralCalldata(userAddress, amountRaw);
        // 1. Approve USDC to PerpPositionManager
        const approveResult = await sendTransactionAsUser(walletSetup.walletId, {
            to: contractAddresses.mockUsdc,
            data: approveData,
        });
        // 2. Deposit collateral (PerpPositionManager pulls USDC from user)
        const depositResult = await sendTransactionAsUser(walletSetup.walletId, {
            to: contractAddresses.perpPositionManager,
            data: depositData,
        });
        res.json({ approveHash: approveResult.hash, depositHash: depositResult.hash });
    }
    catch (e) {
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
perpRouter.post("/commit", async (req, res) => {
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
        const { poolKey: providedPoolKey, commitmentHash } = req.body;
        if (!commitmentHash || typeof commitmentHash !== "string") {
            res.status(400).json({ error: "commitmentHash is required" });
            return;
        }
        // Build pool key if not provided (use default from config)
        const poolKey = providedPoolKey || buildPoolKey(contractAddresses.mockUsdc, contractAddresses.mockUsdt, contractAddresses.privBatchHook);
        // Encode transaction data
        const data = encodeSubmitPerpCommitment(poolKey, commitmentHash);
        // Send transaction via Privy (server-side signing)
        // Uses authorization_context with authorization_private_keys for server-side signing
        // No user approval popup required - transaction is signed by backend authorization key
        const result = await sendTransactionAsUser(walletSetup.walletId, {
            to: contractAddresses.privBatchHook,
            data,
        });
        res.json({ hash: result.hash });
    }
    catch (e) {
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
perpRouter.post("/reveal", async (req, res) => {
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
        const { poolKey: providedPoolKey, intent } = req.body;
        if (!intent) {
            res.status(400).json({ error: "intent is required" });
            return;
        }
        // Validate intent structure
        if (!intent.user || !intent.market || intent.size === undefined || intent.leverage === undefined) {
            res.status(400).json({ error: "Invalid intent structure" });
            return;
        }
        // Build pool key if not provided
        const poolKey = providedPoolKey || buildPoolKey(contractAddresses.mockUsdc, contractAddresses.mockUsdt, contractAddresses.privBatchHook);
        // Encode transaction data
        const data = encodeSubmitPerpReveal(poolKey, intent);
        // Send transaction via Privy (server-side signing)
        // Uses authorization_context with authorization_private_keys for server-side signing
        // No user approval popup required - transaction is signed by backend authorization key
        const result = await sendTransactionAsUser(walletSetup.walletId, {
            to: contractAddresses.privBatchHook,
            data,
        });
        // Track revealed commitment for pending-batch: so we know which hashes can be executed
        try {
            const normalizedIntent = intentToBigint(intent);
            const commitmentHash = await computePerpCommitmentHash(normalizedIntent);
            const poolId = computePoolId(poolKey);
            await getPendingPerpRevealsCollection().insertOne({
                poolId,
                commitmentHash,
                createdAt: new Date(),
            });
        }
        catch (dbErr) {
            // Reveal already succeeded on-chain; tracking is best-effort (e.g. no MongoDB)
            console.warn("[Perp] Could not store pending reveal for batch:", dbErr);
        }
        res.json({ hash: result.hash });
    }
    catch (e) {
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
perpRouter.post("/execute-batch", async (req, res) => {
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
        const { poolKey: providedPoolKey, commitmentHashes: bodyHashes, baseIsCurrency0 } = req.body;
        // Build pool key if not provided
        const poolKey = providedPoolKey || buildPoolKey(contractAddresses.mockUsdc, contractAddresses.mockUsdt, contractAddresses.privBatchHook);
        // Use body hashes or fetch pending from DB for this pool
        let commitmentHashes = bodyHashes ?? [];
        if (commitmentHashes.length === 0) {
            try {
                const poolId = computePoolId(poolKey);
                const docs = await getPendingPerpRevealsCollection()
                    .find({ poolId })
                    .sort({ createdAt: 1 })
                    .toArray();
                commitmentHashes = docs.map((d) => d.commitmentHash);
            }
            catch (dbErr) {
                console.warn("[Perp] Execute-batch: could not read pending reveals:", dbErr);
            }
        }
        if (commitmentHashes.length === 0) {
            res.status(400).json({ error: "commitmentHashes array is required or have pending reveals (call GET /api/perp/pending-batch)" });
            return;
        }
        // Use config default if not provided
        const baseIsCurrency0Value = baseIsCurrency0 ?? config.baseIsCurrency0;
        // Encode transaction data
        const data = encodeRevealAndBatchExecutePerps(poolKey, commitmentHashes, baseIsCurrency0Value);
        // Send transaction via Privy (server-side signing)
        // Uses authorization_context with authorization_private_keys for server-side signing
        // No user approval popup required - transaction is signed by backend authorization key
        // This enables offline batch execution, agentic trading, and automated operations
        const result = await sendTransactionAsUser(walletSetup.walletId, {
            to: contractAddresses.privBatchHook,
            data,
        });
        // Remove executed commitment hashes from pending so they are not suggested again
        try {
            const poolId = computePoolId(poolKey);
            const coll = getPendingPerpRevealsCollection();
            await coll.deleteMany({
                poolId,
                commitmentHash: { $in: commitmentHashes },
            });
        }
        catch (dbErr) {
            console.warn("[Perp] Could not clear pending reveals after execute-batch:", dbErr);
        }
        res.json({ hash: result.hash });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Failed to execute batch";
        console.error("[Perp] Execute batch error:", message);
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
perpRouter.get("/pending-batch", async (_req, res) => {
    try {
        const poolKey = buildPoolKey(contractAddresses.mockUsdc, contractAddresses.mockUsdt, contractAddresses.privBatchHook);
        const poolId = computePoolId(poolKey);
        let commitmentHashes = [];
        try {
            const docs = await getPendingPerpRevealsCollection()
                .find({ poolId })
                .sort({ createdAt: 1 })
                .toArray();
            commitmentHashes = docs.map((d) => d.commitmentHash);
        }
        catch (dbErr) {
            // MongoDB not connected or other error
            console.warn("[Perp] Pending-batch: could not read pending reveals:", dbErr);
        }
        const [batchState, batchInterval] = await Promise.all([
            getBatchState(poolId),
            getBatchInterval(),
        ]);
        const nowSec = Math.floor(Date.now() / 1000);
        const intervalSec = Number(batchInterval);
        const lastBatchSec = Number(batchState.lastBatchTimestamp);
        const nextExecutionSec = lastBatchSec === 0 ? nowSec : lastBatchSec + intervalSec;
        const canExecute = commitmentHashes.length >= MIN_COMMITMENTS && nowSec >= nextExecutionSec;
        const nextExecutionAt = commitmentHashes.length >= MIN_COMMITMENTS
            ? new Date(nextExecutionSec * 1000).toISOString()
            : null;
        res.json({
            poolId,
            commitmentHashes,
            count: commitmentHashes.length,
            canExecute,
            nextExecutionAt,
            lastBatchTimestamp: batchState.lastBatchTimestamp.toString(),
            batchIntervalSeconds: intervalSec,
            minCommitments: MIN_COMMITMENTS,
        });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Failed to get pending batch";
        console.error("[Perp] Pending-batch error:", message);
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
perpRouter.get("/position", async (req, res) => {
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
        const marketId = req.query.marketId || contractAddresses.marketId;
        // Get position from contract
        const position = await getPosition(walletSetup.walletAddress, marketId);
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
    }
    catch (e) {
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
perpRouter.get("/collateral", async (req, res) => {
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
            getTotalCollateral(walletSetup.walletAddress),
            getAvailableMargin(walletSetup.walletAddress),
        ]);
        res.json({
            totalCollateral: totalCollateral.toString(),
            availableMargin: availableMargin.toString(),
        });
    }
    catch (e) {
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
perpRouter.get("/balances", async (req, res) => {
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
        const userAddress = walletSetup.walletAddress;
        // Get token balances
        const [usdcBalance, usdtBalance] = await Promise.all([
            getTokenBalance(contractAddresses.mockUsdc, userAddress),
            getTokenBalance(contractAddresses.mockUsdt, userAddress),
        ]);
        // Debug: log address and balances so we can verify we're querying the right wallet/token
        console.log("[Perp] GET /balances", {
            userAddress,
            usdcContract: contractAddresses.mockUsdc,
            usdcBalanceRaw: usdcBalance.toString(),
            usdtBalanceRaw: usdtBalance.toString(),
        });
        res.json({
            usdc: usdcBalance.toString(),
            usdt: usdtBalance.toString(),
            usdcContract: contractAddresses.mockUsdc,
            usdtContract: contractAddresses.mockUsdt,
        });
    }
    catch (e) {
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
perpRouter.get("/batch-state", async (req, res) => {
    try {
        const poolId = req.query.poolId;
        if (!poolId) {
            res.status(400).json({ error: "poolId is required" });
            return;
        }
        // Get batch state from contract
        const batchState = await getBatchState(poolId);
        res.json({
            poolId,
            lastBatchTimestamp: batchState.lastBatchTimestamp.toString(),
            commitmentCount: batchState.commitmentCount.toString(),
        });
    }
    catch (e) {
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
perpRouter.get("/batch-interval", async (_req, res) => {
    try {
        const batchInterval = await getBatchInterval();
        res.json({ batchInterval: batchInterval.toString() });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Failed to get batch interval";
        console.error("[Perp] Get batch interval error:", message);
        res.status(500).json({ error: message });
    }
});
//# sourceMappingURL=perp.js.map