#!/usr/bin/env node
/**
 * Verify that private.pem matches what Privy expects for your key quorum.
 * Prints the public key in base64 DER so you can compare with Privy Dashboard.
 *
 * Usage: node scripts/verify-auth-key.mjs
 * Requires: AUTHORIZATION_PRIVATE_KEY_PATH in .env (default ./private.pem)
 */
import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { createPrivateKey, createPublicKey } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = join(__dirname, "..");

const path = process.env.AUTHORIZATION_PRIVATE_KEY_PATH || "./private.pem";
const fullPath = path.startsWith("/") ? path : join(backendDir, path);

if (!existsSync(fullPath)) {
  console.error("Key file not found:", fullPath);
  process.exit(1);
}

const pem = readFileSync(fullPath, "utf8").trim();
if (!pem.includes("-----BEGIN")) {
  console.error("File does not look like PEM. Expected -----BEGIN ... PRIVATE KEY-----");
  process.exit(1);
}

const privateKey = createPrivateKey({ key: pem, format: "pem" });
const publicKey = createPublicKey(privateKey);
const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
const publicKeyBase64 = publicKeyDer.toString("base64");

console.log("Backend private.pem → public key (base64 DER SPKI):");
console.log(publicKeyBase64);
console.log("");
console.log("In Privy Dashboard → your key quorum → the registered public key MUST match the above.");
console.log("If it doesn't match, either:");
console.log("  1. Re-create the key quorum and paste the above as the public key, then set PRIVY_KEY_QUORUM_ID to the new quorum ID, or");
console.log("  2. Replace private.pem with the private key that matches the key currently in the quorum.");
console.log("");
console.log("Also ensure the frontend has called addSigners() with signerId = PRIVY_KEY_QUORUM_ID (log out and log back in to retry).");
