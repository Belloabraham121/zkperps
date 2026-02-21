/**
 * Trade routes: server-signed transactions on behalf of the authenticated user.
 *
 * Server-side wallet access flow:
 * 1. User logs in via Privy (email OTP) on frontend
 * 2. Frontend calls POST /api/auth/link with walletAddress and walletId
 * 3. Frontend calls addSigners() with the signerId (key quorum ID) returned by backend
 * 4. Backend can now send transactions on behalf of the user without any popup
 *
 * @see https://docs.privy.io/wallets/wallets/server-side-access
 */
import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { verifyWalletSetup, getSignerIdForFrontend } from "../lib/privy.js";
import { sendTransactionAsUser } from "../lib/send-transaction.js";
export const tradeRouter = Router();
tradeRouter.use(authenticate);
/**
 * POST /api/trade/send
 * Body: { to: string, value?: string, data?: string, gas?: string, gasPrice?: string }
 *
 * Sends a transaction from the user's wallet. Backend signs via Privy (no user approval).
 *
 * Prerequisites:
 * - User must be authenticated (JWT token)
 * - Wallet must be linked via POST /api/auth/link
 * - Frontend must have called addSigners() with the signerId from /api/auth/link
 *
 * @returns { hash: string } Transaction hash
 */
tradeRouter.post("/send", async (req, res) => {
    try {
        if (!req.user?.sub) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }
        // Verify wallet is set up for server-side transactions
        const walletSetup = await verifyWalletSetup(req.user.sub);
        if (!walletSetup.isSetup) {
            res.status(400).json({
                error: walletSetup.error || "Wallet not properly set up",
                signerId: getSignerIdForFrontend(),
                instructions: walletSetup.walletAddress
                    ? "Wallet is linked but missing walletId. Ensure walletId is provided when linking."
                    : "Call POST /api/auth/link with walletAddress and walletId, then call addSigners() with the returned signerId.",
            });
            return;
        }
        // Parse request body
        const { to, value, data, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce } = req.body;
        if (!to || typeof to !== "string") {
            res.status(400).json({ error: "to (address) is required" });
            return;
        }
        // Validate address format
        if (!to.match(/^0x[a-fA-F0-9]{40}$/)) {
            res.status(400).json({ error: "Invalid address format" });
            return;
        }
        // Convert string values to bigint
        const valueBigInt = value != null ? BigInt(value) : undefined;
        const gasBigInt = gas != null ? BigInt(gas) : undefined;
        const gasPriceBigInt = gasPrice != null ? BigInt(gasPrice) : undefined;
        const maxFeePerGasBigInt = maxFeePerGas != null ? BigInt(maxFeePerGas) : undefined;
        const maxPriorityFeePerGasBigInt = maxPriorityFeePerGas != null ? BigInt(maxPriorityFeePerGas) : undefined;
        // Send transaction via Privy (server-side signing)
        const result = await sendTransactionAsUser(walletSetup.walletId, {
            to: to,
            value: valueBigInt,
            data: data ?? "0x",
            gas: gasBigInt,
            gasPrice: gasPriceBigInt,
            maxFeePerGas: maxFeePerGasBigInt,
            maxPriorityFeePerGas: maxPriorityFeePerGasBigInt,
            nonce,
        });
        res.json({ hash: result.hash });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Send failed";
        console.error("[Trade] Transaction send error:", message);
        res.status(500).json({ error: message });
    }
});
//# sourceMappingURL=trade.js.map