/**
 * Auth routes: email sign-in via Privy.
 * Frontend: user logs in with Privy (email OTP) -> gets access token + embedded wallet.
 * Frontend then calls POST /api/auth/link with accessToken + walletAddress so backend
 * can store the wallet and return a JWT. Frontend must also add our server as signer
 * (addSigners with signerId) so we can sign tx on behalf of user without popup.
 */
import { Router } from "express";
import { verifyAccessToken, linkWallet, getSignerIdForFrontend } from "../lib/privy.js";
import { createToken, authenticate } from "../middleware/auth.js";
export const authRouter = Router();
/** Shared handler: verify Privy access token, return JWT + wallet/signerId or link instructions */
async function handleVerifyToken(accessToken, res, endpoint) {
    try {
        if (!accessToken || typeof accessToken !== "string" || accessToken.trim() === "") {
            console.error(`[${endpoint}] Invalid access token provided:`, {
                hasToken: !!accessToken,
                type: typeof accessToken,
                length: accessToken?.length
            });
            res.status(400).json({ error: "Invalid access token" });
            return;
        }
        const info = await verifyAccessToken(accessToken);
        const signerId = getSignerIdForFrontend();
        if (info.walletAddress) {
            const token = createToken({
                sub: info.userId,
                email: info.email,
                walletAddress: info.walletAddress,
            });
            res.json({
                token,
                walletAddress: info.walletAddress,
                ...(signerId && { signerId }),
                email: info.email,
            });
            return;
        }
        res.json({
            token: null,
            walletAddress: null,
            ...(signerId && { signerId }),
            email: info.email,
            message: "Call POST /api/auth/link with walletAddress and walletId (and same accessToken) after frontend has embedded wallet",
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Check if it's an SSL/TLS error
        const isSSLError = errorMessage.includes("SSL") ||
            errorMessage.includes("TLS") ||
            errorMessage.includes("tlsv1") ||
            errorMessage.includes("ECONNRESET") ||
            errorMessage.includes("ETIMEDOUT");
        if (isSSLError) {
            throw new Error("Network connection error. Please try again.");
        }
        throw error;
    }
}
/**
 * POST /api/auth/signup
 * Body: { accessToken: string }
 * Sign up = first-time login. Email signup is done on the frontend via Privy (useLoginWithEmail: sendCode + loginWithCode).
 * After the user completes email OTP, send the Privy access token here. Same response as /login and /verify-token.
 */
authRouter.post("/signup", async (req, res) => {
    try {
        const { accessToken } = req.body;
        if (!accessToken || typeof accessToken !== "string") {
            res.status(400).json({ error: "accessToken required" });
            return;
        }
        await handleVerifyToken(accessToken, res, "signup");
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Signup failed";
        console.error("[signup] Error:", e);
        res.status(401).json({ error: message });
    }
});
/**
 * POST /api/auth/login
 * Body: { accessToken: string }
 * Log in with the Privy access token (obtained after email/social login on frontend). Returns JWT + wallet/signerId or link instructions.
 */
authRouter.post("/login", async (req, res) => {
    try {
        const { accessToken } = req.body;
        if (!accessToken || typeof accessToken !== "string") {
            res.status(400).json({ error: "accessToken required" });
            return;
        }
        await handleVerifyToken(accessToken, res, "login");
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Login failed";
        console.error("[login] Error:", e);
        res.status(401).json({ error: message });
    }
});
/**
 * POST /api/auth/verify-token
 * Body: { accessToken: string }
 * Same as /login. Verifies Privy access token; returns JWT + wallet info if already linked.
 */
authRouter.post("/verify-token", async (req, res) => {
    try {
        const { accessToken } = req.body;
        if (!accessToken || typeof accessToken !== "string") {
            res.status(400).json({ error: "accessToken required" });
            return;
        }
        await handleVerifyToken(accessToken, res, "verify-token");
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Verify failed";
        res.status(401).json({ error: message });
    }
});
/**
 * POST /api/auth/link
 * Body: { accessToken: string, walletAddress: string, walletId?: string }
 * Links the user's Privy embedded wallet to our backend so we can send tx on their behalf.
 * Frontend must call addSigners(walletAddress, signerId) with the signerId we return so we can sign.
 */
authRouter.post("/link", async (req, res) => {
    try {
        const { accessToken, walletAddress, walletId } = req.body;
        if (!accessToken || !walletAddress) {
            res.status(400).json({ error: "accessToken and walletAddress required" });
            return;
        }
        const info = await verifyAccessToken(accessToken);
        await linkWallet(info.userId, walletAddress, walletId, info.email);
        const token = createToken({
            sub: info.userId,
            email: info.email,
            walletAddress,
        });
        const signerId = getSignerIdForFrontend();
        res.json({
            token,
            walletAddress,
            ...(signerId && { signerId }),
            email: info.email,
        });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Link failed";
        res.status(400).json({ error: message });
    }
});
/**
 * GET /api/auth/me
 * Returns current user info from JWT (requires Authorization: Bearer <jwt>).
 */
authRouter.get("/me", authenticate, (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: "Not authenticated" });
        return;
    }
    res.json({
        userId: req.user.sub,
        email: req.user.email,
        walletAddress: req.user.walletAddress,
    });
});
//# sourceMappingURL=auth.js.map