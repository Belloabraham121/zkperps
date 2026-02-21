/**
 * MongoDB connection and database utilities
 */
import { MongoClient, Db, Collection } from "mongodb";
import { config } from "../config.js";

let client: MongoClient | null = null;
let db: Db | null = null;

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
export async function connectDB(): Promise<Db> {
  if (db) {
    return db;
  }

  if (!config.mongodb.uri) {
    throw new Error("MONGODB_URI must be set in environment variables");
  }

  try {
    // MongoDB Atlas uses SSL by default - configure connection options
    client = new MongoClient(config.mongodb.uri, {
      serverSelectionTimeoutMS: 30_000,
      connectTimeoutMS: 30_000,
      socketTimeoutMS: 60_000,
      maxPoolSize: 10,
    });
    await client.connect();
    db = client.db(config.mongodb.dbName);
    
    // Create indexes
    await db.collection<UserWallet>("userWallets").createIndex({ privyUserId: 1 }, { unique: true });
    await db.collection<UserWallet>("userWallets").createIndex({ walletAddress: 1 });
    await db.collection<PendingPerpReveal>("pendingPerpReveals").createIndex({ poolId: 1, createdAt: 1 });
    await db.collection<PerpOrder>("perpOrders").createIndex({ commitmentHash: 1 }, { unique: true });
    await db.collection<PerpOrder>("perpOrders").createIndex({ privyUserId: 1, status: 1, createdAt: -1 });
    await db.collection<PerpOrder>("perpOrders").createIndex({ walletAddress: 1, status: 1, createdAt: -1 });
    await db.collection<PerpTrade>("perpTrades").createIndex({ privyUserId: 1, executedAt: -1 });
    await db.collection<PerpTrade>("perpTrades").createIndex({ walletAddress: 1, executedAt: -1 });
    
    return db;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isSSLError = errorMessage.includes("SSL") || 
                      errorMessage.includes("TLS") || 
                      errorMessage.includes("tlsv1");
    
    if (isSSLError) {
      throw new Error("MongoDB SSL connection error. Please check your network connection.");
    }
    throw error;
  }
}

/**
 * Get MongoDB database instance
 */
export function getDB(): Db {
  if (!db) {
    throw new Error("Database not connected. Call connectDB() first.");
  }
  return db;
}

/**
 * Get user wallets collection
 */
export function getUserWalletsCollection(): Collection<UserWallet> {
  return getDB().collection<UserWallet>("userWallets");
}

/**
 * Pending perp reveal: commitment hash submitted via our API (commit + reveal).
 * Used to know which hashes can be passed to execute-batch.
 */
export interface PendingPerpReveal {
  poolId: string; // hex poolId
  commitmentHash: string;
  createdAt: Date;
}

/**
 * Get pending perp reveals collection
 */
export function getPendingPerpRevealsCollection(): Collection<PendingPerpReveal> {
  return getDB().collection<PendingPerpReveal>("pendingPerpReveals");
}

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
export function getPerpOrdersCollection(): Collection<PerpOrder> {
  return getDB().collection<PerpOrder>("perpOrders");
}

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
  entryPrice: string | null; // from chain after execute, or null
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
export function getPerpTradesCollection(): Collection<PerpTrade> {
  return getDB().collection<PerpTrade>("perpTrades");
}

/**
 * Close MongoDB connection
 */
export async function closeDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log("[MongoDB] Connection closed");
  }
}
