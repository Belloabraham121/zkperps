/**
 * Privy integration: verify access token (from frontend after email login),
 * get or create embedded wallet for user. Backend will sign tx on behalf of user
 * via Privy API (app signer) so user never sees a signing popup.
 */
import { PrivyClient } from "@privy-io/node";
export declare function getPrivyClient(): PrivyClient;
export interface PrivyUserInfo {
    privyUserId: string;
    walletAddress: string;
    walletId?: string;
    email?: string;
}
export declare function verifyAccessToken(accessToken: string): Promise<{
    userId: string;
    email?: string;
    walletAddress?: string;
    walletId?: string;
}>;
/**
 * Link wallet to user after frontend has logged in with Privy and has an embedded wallet.
 * Frontend must also add our app as signer (addSigners) so we can send tx on their behalf.
 * If walletId is not provided, we'll try to fetch it from Privy's API.
 */
export declare function linkWallet(privyUserId: string, walletAddress: string, walletId?: string, email?: string): Promise<void>;
/**
 * Get wallet address for a Privy user (after link or verify).
 */
export declare function getWalletForUser(privyUserId: string): Promise<string | undefined>;
/**
 * Get wallet id for Privy API (send transaction). Required for Privy REST eth_sendTransaction.
 */
export declare function getWalletIdForUser(privyUserId: string): Promise<string | undefined>;
/**
 * Returns KEY_QUORUM_ID for frontend to call addSigners(walletAddress, signerId) once after login.
 * Then backend can sign transactions on behalf of the user without any popup.
 *
 * Returns empty string if not configured (server-side access not enabled).
 *
 * Frontend usage:
 * ```typescript
 * const { addSigners } = useSigners();
 * if (signerId) {
 *   await addSigners({
 *     address: walletAddress,
 *     signers: [{ signerId: signerId }]
 *   });
 * }
 * ```
 */
export declare function getSignerIdForFrontend(): string;
/**
 * Verify that a wallet is properly set up for server-side transactions.
 * Checks if wallet is linked and has the required wallet ID.
 *
 * Note: This doesn't verify if the signer was actually added (that requires Privy API call).
 * The frontend is responsible for calling addSigners() after linking the wallet.
 */
export declare function verifyWalletSetup(privyUserId: string): Promise<{
    isSetup: boolean;
    walletAddress?: string;
    walletId?: string;
    error?: string;
}>;
//# sourceMappingURL=privy.d.ts.map