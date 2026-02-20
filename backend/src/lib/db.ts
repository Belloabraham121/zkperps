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
    client = new MongoClient(config.mongodb.uri);
    await client.connect();
    db = client.db(config.mongodb.dbName);
    
    // Create indexes
    await db.collection<UserWallet>("userWallets").createIndex({ privyUserId: 1 }, { unique: true });
    await db.collection<UserWallet>("userWallets").createIndex({ walletAddress: 1 });
    
    console.log(`[MongoDB] Connected to database: ${config.mongodb.dbName}`);
    return db;
  } catch (error) {
    console.error("[MongoDB] Connection error:", error);
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
