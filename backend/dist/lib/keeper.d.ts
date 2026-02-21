import { type PoolKey } from "./contracts.js";
export interface WalletSetupForBatch {
    walletId: string;
    /** Optional; used for Hook funding balance check. */
    walletAddress?: string;
}
/**
 * Detect if a pool has a batch ready (>= MIN_COMMITMENTS and interval passed).
 * If ready, execute using the provided wallet and return true; otherwise return false.
 * source: optional label for logs (e.g. "post-reveal" or "keeper").
 * poolKeyOverride: when provided (e.g. from reveal), use this pool so we read the same pool we wrote to.
 */
export declare function tryExecuteBatchIfReady(walletSetup: WalletSetupForBatch, source?: string, poolKeyOverride?: PoolKey): Promise<boolean>;
/**
 * Start the perp batch keeper. Runs every config.keeper.intervalMs when KEEPER_PRIVY_USER_ID is set.
 * Also, batch execution is triggered immediately after each reveal (see perp routes).
 */
export declare function startPerpBatchKeeper(): void;
//# sourceMappingURL=keeper.d.ts.map