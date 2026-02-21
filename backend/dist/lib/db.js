/**
 * MongoDB connection and database utilities
 */
import { MongoClient } from "mongodb";
import { config } from "../config.js";
let client = null;
let db = null;
/**
 * Connect to MongoDB
 */
export async function connectDB() {
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
        await db.collection("userWallets").createIndex({ privyUserId: 1 }, { unique: true });
        await db.collection("userWallets").createIndex({ walletAddress: 1 });
        await db.collection("pendingPerpReveals").createIndex({ poolId: 1, createdAt: 1 });
        await db.collection("pendingPerpReveals").createIndex({ poolId: 1, executed: 1, createdAt: 1 });
        await db.collection("perpOrders").createIndex({ commitmentHash: 1 }, { unique: true });
        await db.collection("perpOrders").createIndex({ privyUserId: 1, status: 1, createdAt: -1 });
        await db.collection("perpOrders").createIndex({ walletAddress: 1, status: 1, createdAt: -1 });
        await db.collection("perpTrades").createIndex({ privyUserId: 1, executedAt: -1 });
        await db.collection("perpTrades").createIndex({ walletAddress: 1, executedAt: -1 });
        return db;
    }
    catch (error) {
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
export function getDB() {
    if (!db) {
        throw new Error("Database not connected. Call connectDB() first.");
    }
    return db;
}
/**
 * Get user wallets collection
 */
export function getUserWalletsCollection() {
    return getDB().collection("userWallets");
}
/**
 * Get pending perp reveals collection
 */
export function getPendingPerpRevealsCollection() {
    return getDB().collection("pendingPerpReveals");
}
/**
 * Get perp orders collection
 */
export function getPerpOrdersCollection() {
    return getDB().collection("perpOrders");
}
/**
 * Get perp trades collection
 */
export function getPerpTradesCollection() {
    return getDB().collection("perpTrades");
}
/**
 * Close MongoDB connection
 */
export async function closeDB() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log("[MongoDB] Connection closed");
    }
}
//# sourceMappingURL=db.js.map