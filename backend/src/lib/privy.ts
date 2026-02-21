/**
 * Privy integration: verify access token (from frontend after email login),
 * get or create embedded wallet for user. Backend will sign tx on behalf of user
 * via Privy API (app signer) so user never sees a signing popup.
 */
import { PrivyClient } from "@privy-io/node";
import { config } from "../config.js";
import { getUserWalletsCollection, type UserWallet } from "./db.js";

let privyClient: PrivyClient | null = null;

export function getPrivyClient(): PrivyClient {
  if (!privyClient) {
    if (!config.privy.appId || !config.privy.appSecret) {
      throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET must be set");
    }
    privyClient = new PrivyClient({
      appId: config.privy.appId,
      appSecret: config.privy.appSecret,
    });
  }
  return privyClient;
}

export interface PrivyUserInfo {
  privyUserId: string;
  walletAddress: string;
  walletId?: string;
  email?: string;
}

/**
 * Verify the Privy access token (issued to the user after email login on frontend).
 * Returns Privy user id and, if available, email and wallet. Frontend must have called addSigners
 * with our KEY_QUORUM_ID so we can send tx on behalf of this user.
 */
/**
 * Retry helper for network operations that may fail due to transient SSL/network issues
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isSSLError = error instanceof Error && (
        error.message.includes("SSL") ||
        error.message.includes("TLS") ||
        error.message.includes("tlsv1") ||
        error.message.includes("ECONNRESET") ||
        error.message.includes("ETIMEDOUT")
      );
      
      if (isSSLError && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function verifyAccessToken(
  accessToken: string,
): Promise<{
  userId: string;
  email?: string;
  walletAddress?: string;
  walletId?: string;
}> {
  const privy = getPrivyClient();
  
  // Retry on SSL/network errors only (do not retry InvalidAuthTokenError)
  let verified;
  try {
    // SDK expects the token string only; it adds app_id and verification_key internally
    verified = await retryWithBackoff(
      () => privy.utils().auth().verifyAccessToken(accessToken),
      3,
      1000
    );
  } catch (verifyError) {
    // Don't retry auth failures - they won't succeed on retry
    const msg = verifyError instanceof Error ? verifyError.message : String(verifyError);
    if (msg.includes("Failed to verify authentication token") || msg.includes("InvalidAuthTokenError")) {
      throw new Error("Invalid or expired login. Please sign in again.");
    }
    throw new Error(`Failed to verify token with Privy: ${msg}`);
  }

  // Response uses user_id (snake_case) per VerifyAccessTokenResponse
  const userId = (verified as { user_id?: string }).user_id;
  if (!userId) {
    console.error("[verifyAccessToken] Token verification returned no userId:", verified);
    throw new Error("Invalid or expired Privy token - no userId found");
  }

  // Check database for existing wallet
  const stored = await getUserWalletsCollection().findOne({ privyUserId: userId });
  
  if (stored?.walletAddress) {
    return {
      userId,
      email: stored.email,
      walletAddress: stored.walletAddress,
      walletId: stored.walletId,
    };
  }

  // No wallet in database - frontend will create and link it
  return {
    userId,
    email: undefined,
    walletAddress: undefined,
    walletId: undefined,
  };
}

/**
 * Link wallet to user after frontend has logged in with Privy and has an embedded wallet.
 * Frontend must also add our app as signer (addSigners) so we can send tx on their behalf.
 * If walletId is not provided, we'll try to fetch it from Privy's API.
 */
export async function linkWallet(
  privyUserId: string,
  walletAddress: string,
  walletId?: string,
  email?: string,
): Promise<void> {
  // If walletId is not provided, try to fetch it from Privy API
  let finalWalletId = walletId;
  if (!finalWalletId) {
    try {
      const privy = getPrivyClient();
      const privyWithUsers = privy as {
        users?: () => {
          _get: (
            id: string,
          ) => Promise<{
            linked_accounts_v2?: Array<{
              type: string;
              address?: string;
              wallet_id?: string;
            }>;
          }>;
        };
      };
      
      const usersApi = privyWithUsers.users?.();
      if (usersApi) {
        const user = await retryWithBackoff(
          async () => {
            const result = await usersApi._get(privyUserId);
            return result;
          },
          5,
          1000
        );
        
        const walletAccount = user?.linked_accounts_v2?.find(
          (a) => a.address?.toLowerCase() === walletAddress.toLowerCase()
        );
        
        if (walletAccount?.wallet_id) {
          finalWalletId = walletAccount.wallet_id;
        }
      }
    } catch (error) {
      // Continue without walletId
    }
  }
  
  const now = new Date();
  await getUserWalletsCollection().updateOne(
    { privyUserId },
    {
      $set: {
        privyUserId,
        walletAddress,
        walletId: finalWalletId,
        email,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

/**
 * Get wallet address for a Privy user (after link or verify).
 */
export async function getWalletForUser(privyUserId: string): Promise<string | undefined> {
  const wallet = await getUserWalletsCollection().findOne({ privyUserId });
  return wallet?.walletAddress;
}

/**
 * Get wallet id for Privy API (send transaction). Required for Privy REST eth_sendTransaction.
 */
export async function getWalletIdForUser(privyUserId: string): Promise<string | undefined> {
  const wallet = await getUserWalletsCollection().findOne({ privyUserId });
  return wallet?.walletId;
}

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
export function getSignerIdForFrontend(): string {
  return config.privy.keyQuorumId || "";
}

/**
 * Verify that a wallet is properly set up for server-side transactions.
 * Checks if wallet is linked and has the required wallet ID.
 * 
 * Note: This doesn't verify if the signer was actually added (that requires Privy API call).
 * The frontend is responsible for calling addSigners() after linking the wallet.
 */
export async function verifyWalletSetup(privyUserId: string): Promise<{
  isSetup: boolean;
  walletAddress?: string;
  walletId?: string;
  error?: string;
}> {
  const walletInfo = await getUserWalletsCollection().findOne({ privyUserId });
  if (!walletInfo) {
    return {
      isSetup: false,
      error: "Wallet not linked. Call POST /api/auth/link with walletAddress and walletId.",
    };
  }
  if (!walletInfo.walletId) {
    return {
      isSetup: false,
      walletAddress: walletInfo.walletAddress,
      error: "Wallet ID missing. Ensure walletId is provided when linking the wallet.",
    };
  }
  return {
    isSetup: true,
    walletAddress: walletInfo.walletAddress,
    walletId: walletInfo.walletId,
  };
}
