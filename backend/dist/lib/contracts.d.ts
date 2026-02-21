/**
 * Contract addresses and encoding helpers for Arbitrum Sepolia perps.
 * Matches scripts/zk/test-perp-e2e.js and PERPS_IMPLEMENTATION_PLAN.md.
 */
import { type Address } from "viem";
export declare const contractAddresses: {
    privBatchHook: `0x${string}`;
    perpPositionManager: `0x${string}`;
    mockUsdc: `0x${string}`;
    mockUsdt: `0x${string}`;
    marketId: `0x${string}`;
};
/**
 * Encode USDC approve(spender, amount) for use in sendTransaction.
 */
export declare function encodeUsdcApprove(spender: `0x${string}`, amount: bigint): `0x${string}`;
/**
 * Encode PerpPositionManager.depositCollateral(user, amount).
 */
export declare function encodeDepositCollateral(user: `0x${string}`, amount: bigint): `0x${string}`;
/**
 * Two-step deposit: 1) approve USDC to PerpPositionManager, 2) depositCollateral(user, amount).
 * Frontend can call POST /api/trade/send twice (approve then deposit) or we add a single deposit route that sends both.
 */
export declare function getDepositCollateralCalldata(user: `0x${string}`, amount: bigint): {
    approveData: `0x${string}`;
    depositData: `0x${string}`;
};
/**
 * Pool key structure for Uniswap V4 pools
 */
export interface PoolKey {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
}
/**
 * PerpIntent structure matching the contract
 */
export interface PerpIntent {
    user: Address;
    market: Address;
    size: bigint;
    isLong: boolean;
    isOpen: boolean;
    collateral: bigint;
    leverage: bigint;
    nonce: bigint;
    deadline: bigint;
}
/**
 * Compute PoolId from pool key (keccak256(abi.encode(poolKey))).
 * Matches Uniswap V4 PoolKey.toId().
 */
export declare function computePoolId(poolKey: PoolKey): `0x${string}`;
/**
 * Build pool key from currency addresses.
 * Ensures currency0 < currency1 (Uniswap V4 requirement).
 */
export declare function buildPoolKey(currency0: Address, currency1: Address, hookAddress: Address): PoolKey;
/**
 * Encode submitPerpCommitment(poolKey, commitmentHash) for use in sendTransaction.
 */
export declare function encodeSubmitPerpCommitment(poolKey: PoolKey, commitmentHash: `0x${string}`): `0x${string}`;
/**
 * Encode submitPerpReveal(poolKey, intent) for use in sendTransaction.
 */
export declare function encodeSubmitPerpReveal(poolKey: PoolKey, intent: PerpIntent): `0x${string}`;
/**
 * Encode revealAndBatchExecutePerps(poolKey, commitmentHashes, baseIsCurrency0) for use in sendTransaction.
 */
export declare function encodeRevealAndBatchExecutePerps(poolKey: PoolKey, commitmentHashes: `0x${string}`[], baseIsCurrency0: boolean): `0x${string}`;
/**
 * Encode computePerpCommitmentHash(intent) for use in eth_call (read-only).
 * Note: This is a view function, so it's typically called via RPC, not in a transaction.
 */
export declare function encodeComputePerpCommitmentHash(intent: PerpIntent): `0x${string}`;
//# sourceMappingURL=contracts.d.ts.map