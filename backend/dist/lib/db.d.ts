/**
 * MongoDB connection and database utilities
 */
import { Db, Collection } from "mongodb";
export interface UserWallet {
    privyUserId: string;
    walletAddress: string;
    walletId?: string;
    email?: string;
    createdAt: Date;
    updatedAt: Date;
}
/**
 * Connect to MongoDB
 */
export declare function connectDB(): Promise<Db>;
/**
 * Get MongoDB database instance
 */
export declare function getDB(): Db;
/**
 * Get user wallets collection
 */
export declare function getUserWalletsCollection(): Collection<UserWallet>;
/**
 * Pending perp reveal: commitment hash submitted via our API (commit + reveal).
 * Used to know which hashes can be passed to execute-batch.
 * executed: false until batch has been executed (backend or script); then true before cleanup.
 */
export interface PendingPerpReveal {
    poolId: string;
    commitmentHash: string;
    /** false = not yet executed, true = executed (set by backend or execute-perp-batch script) */
    executed: boolean;
    createdAt: Date;
}
/**
 * Get pending perp reveals collection
 */
export declare function getPendingPerpRevealsCollection(): Collection<PendingPerpReveal>;
/** Order status */
export type OrderStatus = "pending" | "executed" | "cancelled";
/**
 * Perp order: user's intent (size, leverage, margin, long/short) saved when they reveal.
 * Used for open orders list and to create Trade when batch executes.
 */
export interface PerpOrder {
    privyUserId: string;
    walletAddress: string;
    poolId: string;
    commitmentHash: string;
    market: string;
    size: string;
    isLong: boolean;
    isOpen: boolean;
    collateral: string;
    leverage: string;
    nonce: string;
    deadline: string;
    status: OrderStatus;
    createdAt: Date;
    updatedAt: Date;
    executedAt?: Date;
    txHash?: string;
}
/**
 * Get perp orders collection
 */
export declare function getPerpOrdersCollection(): Collection<PerpOrder>;
/**
 * Executed perp trade: one record per intent when batch executes.
 * Used for trade history and position history.
 */
export interface PerpTrade {
    privyUserId: string;
    walletAddress: string;
    market: string;
    size: string;
    isLong: boolean;
    isOpen: boolean;
    collateral: string;
    leverage: string;
    entryPrice: string | null;
    /** Realised P&L in USD when this trade closed a position (null for opens or when not computed). */
    realisedPnl: number | null;
    /** Realised P&L as % of margin/collateral (null when realisedPnl not set). */
    realisedPnlPct: number | null;
    txHash: string;
    executedAt: Date;
    poolId: string;
    commitmentHash: string;
}
/**
 * Get perp trades collection
 */
export declare function getPerpTradesCollection(): Collection<PerpTrade>;
/**
 * Close MongoDB connection
 */
export declare function closeDB(): Promise<void>;
//# sourceMappingURL=db.d.ts.map