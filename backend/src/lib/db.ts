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
