#!/usr/bin/env node
/**
 * Print the wallet address for a Privy user (the "signer" that needs gas).
 * Usage: node scripts/get-wallet-address.mjs [privyUserId]
 * If privyUserId is omitted, uses the one from your recent logs: did:privy:cmluwlb0800lm0cjgvgoy3giz
 */
import "dotenv/config";
import { MongoClient } from "mongodb";

const privyUserId = process.argv[2] || "did:privy:cmluwlb0800lm0cjgvgoy3giz";
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "zkperps";

if (!uri) {
  console.error("Set MONGODB_URI in .env");
  process.exit(1);
}

const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db(dbName);
  const doc = await db.collection("userWallets").findOne({ privyUserId });
  if (!doc) {
    console.error("No wallet found for user:", privyUserId);
    process.exit(1);
  }
  console.log("Privy user:", privyUserId);
  console.log("Wallet address (send gas here):", doc.walletAddress);
} finally {
  await client.close();
}
