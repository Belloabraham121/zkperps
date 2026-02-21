/**
 * Keeper: automatically executes perp batch when conditions are met.
 * Runs on an interval when KEEPER_PRIVY_USER_ID is set.
 */
import { config } from "../config.js";
import { getPendingPerpRevealsCollection } from "./db.js";
import { buildPoolKey, computePoolId, encodeRevealAndBatchExecutePerps, contractAddresses } from "./contracts.js";
import { getBatchState, getBatchInterval } from "./contract-reader.js";
import { verifyWalletSetup } from "./privy.js";
import { sendTransactionAsUser } from "./send-transaction.js";
const MIN_COMMITMENTS = 2;
async function runOnce() {
    const keeperUserId = config.keeper.privyUserId;
    if (!keeperUserId)
        return;
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
            return; // no DB or error, skip this run
        }
        if (commitmentHashes.length < MIN_COMMITMENTS)
            return;
        const [batchState, batchInterval] = await Promise.all([
            getBatchState(poolId),
            getBatchInterval(),
        ]);
        const nowSec = Math.floor(Date.now() / 1000);
        const intervalSec = Number(batchInterval);
        const lastBatchSec = Number(batchState.lastBatchTimestamp);
        const nextExecutionSec = lastBatchSec === 0 ? nowSec : lastBatchSec + intervalSec;
        if (nowSec < nextExecutionSec)
            return;
        const walletSetup = await verifyWalletSetup(keeperUserId);
        if (!walletSetup.isSetup || !walletSetup.walletId) {
            console.warn("[Keeper] Keeper wallet not set up; skip execute-batch. Link wallet and addSigners for KEEPER_PRIVY_USER_ID.");
            return;
        }
        const data = encodeRevealAndBatchExecutePerps(poolKey, commitmentHashes, config.baseIsCurrency0);
        const result = await sendTransactionAsUser(walletSetup.walletId, {
            to: contractAddresses.privBatchHook,
            data,
        });
        await getPendingPerpRevealsCollection().deleteMany({
            poolId,
            commitmentHash: { $in: commitmentHashes },
        });
        console.log("[Keeper] Executed perp batch:", result.hash, "commitments:", commitmentHashes.length);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[Keeper] Run error:", msg);
    }
}
/**
 * Start the perp batch keeper. Runs every config.keeper.intervalMs when KEEPER_PRIVY_USER_ID is set.
 */
export function startPerpBatchKeeper() {
    if (!config.keeper.privyUserId)
        return;
    const ms = Math.max(10000, config.keeper.intervalMs);
    console.log("[Keeper] Perp batch keeper started (interval %ds). Keeper user: %s", ms / 1000, config.keeper.privyUserId);
    runOnce(); // run once on start after a short delay so DB is ready
    setInterval(runOnce, ms);
}
//# sourceMappingURL=keeper.js.map