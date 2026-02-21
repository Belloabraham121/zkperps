/**
 * Send a transaction from a user's wallet via Privy, signed by the app's authorization key.
 * No user approval popup: backend signs on behalf of the user (after they added our key quorum as signer).
 *
 * This implements Privy's server-side wallet access pattern:
 * 1. Frontend adds the backend as a signer using addSigners() with the key quorum ID
 * 2. Backend uses the authorization private key to sign transactions without user interaction
 * 3. Transactions are executed on behalf of the user via Privy's secure enclave
 *
 * Privy SDK expects authorization_private_keys to be base64-encoded PKCS8 (no PEM headers).
 * We read PEM from file and convert to that format.
 *
 * @see https://docs.privy.io/wallets/wallets/server-side-access
 */
import { readFileSync } from "fs";
import { createPrivateKey } from "crypto";
import { getPrivyClient } from "./privy.js";
import { config } from "../config.js";
const caip2 = `eip155:${config.chainId}`;
/**
 * Normalize PEM string from env (e.g. newlines stored as literal \n) and convert to
 * the format Privy expects: base64-encoded PKCS8 DER with no PEM headers/footers.
 */
function pemToPkcs8Base64(pem) {
    const trimmed = pem.trim();
    if (!trimmed) {
        throw new Error("Authorization private key is empty");
    }
    // If already base64-only (no PEM headers), assume it's already PKCS8 base64
    if (!trimmed.includes("-----BEGIN")) {
        return trimmed;
    }
    try {
        const key = createPrivateKey({ key: trimmed, format: "pem" });
        const pkcs8Der = key.export({ type: "pkcs8", format: "der" });
        if (!Buffer.isBuffer(pkcs8Der)) {
            throw new Error("Key export did not return a Buffer");
        }
        return pkcs8Der.toString("base64");
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to convert authorization private key to PKCS8: ${msg}. Ensure the key is a valid P-256 EC private key (PEM).`);
    }
}
/**
 * Read the authorization private key from env (AUTHORIZATION_PRIVATE_KEY) or file path
 * and convert to the format Privy expects: base64-encoded PKCS8 DER.
 * For Vercel/serverless, set AUTHORIZATION_PRIVATE_KEY to the PEM content (newlines as \n).
 */
function getAuthorizationPrivateKey() {
    const fromEnv = config.privy.authorizationPrivateKey;
    if (fromEnv) {
        // Allow newlines stored as literal \n in env (e.g. single-line paste)
        const pem = fromEnv.replace(/\\n/g, "\n").trim();
        return pemToPkcs8Base64(pem);
    }
    const path = config.privy.authorizationPrivateKeyPath;
    if (!path) {
        throw new Error("Set AUTHORIZATION_PRIVATE_KEY (PEM string) or AUTHORIZATION_PRIVATE_KEY_PATH to send transactions");
    }
    const pem = readFileSync(path, "utf8").trim();
    if (!pem) {
        throw new Error("Authorization private key file is empty");
    }
    return pemToPkcs8Base64(pem);
}
/**
 * Send transaction from the user's Privy wallet. Uses app authorization key to sign (key quorum).
 *
 * This function enables server-side transactions where:
 * - The user has added the backend's key quorum as a signer via addSigners()
 * - The backend uses its authorization private key to sign transactions
 * - No user approval popup is required
 * - Transactions are executed through Privy's secure infrastructure
 *
 * @param walletId - The Privy wallet ID (obtained from getWalletIdForUser or frontend link)
 * @param params - Transaction parameters
 * @returns Transaction hash
 * @throws Error if wallet is not linked, authorization key is missing, or transaction fails
 */
export async function sendTransactionAsUser(walletId, params) {
    if (!walletId) {
        throw new Error("Wallet ID is required");
    }
    const privy = getPrivyClient();
    const authKey = getAuthorizationPrivateKey();
    // Convert value to hex string (Privy expects hex)
    const valueHex = params.value != null ? `0x${params.value.toString(16)}` : "0x0";
    // Build transaction object
    const transaction = {
        to: params.to,
        value: valueHex,
        data: params.data ?? "0x",
    };
    // Add optional gas parameters
    if (params.gas != null) {
        transaction.gas_limit = `0x${params.gas.toString(16)}`;
    }
    if (params.gasPrice != null) {
        transaction.gas_price = `0x${params.gasPrice.toString(16)}`;
    }
    if (params.maxFeePerGas != null) {
        transaction.max_fee_per_gas = `0x${params.maxFeePerGas.toString(16)}`;
    }
    if (params.maxPriorityFeePerGas != null) {
        transaction.max_priority_fee_per_gas = `0x${params.maxPriorityFeePerGas.toString(16)}`;
    }
    if (params.nonce != null) {
        transaction.nonce = params.nonce.toString();
    }
    try {
        // Use Privy SDK's public API for sending transactions
        // The authorization_context with authorization_private_keys enables server-side signing
        const response = await privy
            .wallets()
            .ethereum()
            .sendTransaction(walletId, {
            caip2,
            params: {
                transaction,
            },
            authorization_context: {
                authorization_private_keys: [authKey],
            },
        });
        // Extract transaction hash from response
        const hash = response.hash ??
            response.transaction_hash;
        if (!hash) {
            throw new Error("Privy sendTransaction did not return a transaction hash");
        }
        console.log(`[Server-side TX] Sent transaction ${hash} from wallet ${walletId} to ${params.to}`);
        return { hash };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Server-side TX] Failed to send transaction:`, {
            walletId,
            to: params.to,
            error: errorMessage,
        });
        // Provide more helpful error messages
        if (errorMessage.includes("authorization") ||
            errorMessage.includes("signer")) {
            throw new Error(`Authorization failed. Ensure the user has added the backend as a signer using addSigners() with signerId: ${config.privy.keyQuorumId}`);
        }
        if (errorMessage.includes("wallet") || errorMessage.includes("not found")) {
            throw new Error(`Wallet ${walletId} not found or not linked. Call POST /api/auth/link first.`);
        }
        throw new Error(`Failed to send transaction: ${errorMessage}`);
    }
}
//# sourceMappingURL=send-transaction.js.map