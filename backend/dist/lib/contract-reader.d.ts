/**
 * Contract state reader using viem for reading on-chain data.
 * Used for querying positions, collateral, and other view functions.
 */
import { type Address } from "viem";
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
 * Get ERC-20 token allowance
 */
export declare function getTokenAllowance(tokenAddress: Address, ownerAddress: Address, spenderAddress: Address): Promise<bigint>;
/**
 * Get ERC-20 token decimals
 */
export declare function getTokenDecimals(tokenAddress: Address): Promise<number>;
//# sourceMappingURL=contract-reader.d.ts.map