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
 */
export interface PendingPerpReveal {
    poolId: string;
    commitmentHash: string;
    createdAt: Date;
}
/**
 * Get pending perp reveals collection
 */
export declare function getPendingPerpRevealsCollection(): Collection<PendingPerpReveal>;
/**
 * Close MongoDB connection
 */
export declare function closeDB(): Promise<void>;
//# sourceMappingURL=db.d.ts.map