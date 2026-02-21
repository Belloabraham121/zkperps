/**
 * Contract state reader using viem for reading on-chain data.
 * Used for querying positions, collateral, and other view functions.
 */
import { type Address, type Hash, type PublicClient } from "viem";
export declare function getPublicClient(): PublicClient;
/**
 * Get user's total collateral from PerpPositionManager
 */
export declare function getTotalCollateral(userAddress: Address): Promise<bigint>;
/**
 * Get user's position for a specific market
 */
export declare function getPosition(userAddress: Address, marketId: Address): Promise<{
    size: bigint;
    entryPrice: bigint;
    collateral: bigint;
    leverage: bigint;
    lastFundingPaid: bigint;
    entryCumulativeFunding: bigint;
}>;
/**
 * Get user's available margin
 */
export declare function getAvailableMargin(userAddress: Address): Promise<bigint>;
/**
 * Get unrealized PnL for a user's position in a market (18 decimals, signed).
 */
export declare function getUnrealizedPnL(userAddress: Address, marketId: Address): Promise<bigint>;
export type PositionClosedEvent = {
    user: Address;
    market: Address;
    sizeClosed: bigint;
    markPrice: bigint;
    realizedPnL: bigint;
};
/**
 * Wait for tx receipt and parse PositionClosed events from PerpPositionManager.
 * Returns one entry per close in execution order (for matching to close trades).
 */
export declare function getPositionClosedFromReceipt(txHash: Hash): Promise<PositionClosedEvent[]>;
/**
 * Compute perp commitment hash from intent (read-only call)
 */
export declare function computePerpCommitmentHash(intent: {
    user: Address;
    market: Address;
    size: bigint;
    isLong: boolean;
    isOpen: boolean;
    collateral: bigint;
    leverage: bigint;
    nonce: bigint;
    deadline: bigint;
}): Promise<`0x${string}`>;
/**
 * Get batch interval from Hook
 */
export declare function getBatchInterval(): Promise<bigint>;
/**
 * Get the PoolManager address the Hook uses (set at deploy time).
 * Backend POOL_MANAGER and SetupPoolLiquidity POOL_MANAGER must match this.
 */
export declare function getHookPoolManager(): Promise<Address>;
/**
 * Get batch state for a pool
 */
export declare function getBatchState(poolId: `0x${string}`): Promise<{
    lastBatchTimestamp: bigint;
    commitmentCount: bigint;
}>;
/**
 * Get ERC-20 token balance
 */
export declare function getTokenBalance(tokenAddress: Address, userAddress: Address): Promise<bigint>;
/**
 * Get pool slot0 sqrtPriceX96 from PoolManager (Uniswap V4).
 * StateLibrary: pools[poolId] slot = keccak256(abi.encodePacked(poolId, POOLS_SLOT)); POOLS_SLOT = 6.
 * First word of Pool.State is slot0; bottom 160 bits = sqrtPriceX96. If 0, pool not initialized.
 */
export declare function getPoolSlot0SqrtPriceX96(poolId: `0x${string}`): Promise<bigint>;
/**
 * Get pool in-range liquidity (Pool.State.liquidity) from PoolManager.
 * StateLibrary: liquidity at stateSlot + LIQUIDITY_OFFSET (3); uint128.
 * If 0, swap can revert with Panic 18 (division by zero).
 */
export declare function getPoolLiquidity(poolId: `0x${string}`): Promise<bigint>;
/**
 * Get ERC-20 token allowance
 */
export declare function getTokenAllowance(tokenAddress: Address, ownerAddress: Address, spenderAddress: Address): Promise<bigint>;
/**
 * Get ERC-20 token decimals
 */
export declare function getTokenDecimals(tokenAddress: Address): Promise<number>;
//# sourceMappingURL=contract-reader.d.ts.map