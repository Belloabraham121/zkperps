export interface SendTransactionParams {
    to: `0x${string}`;
    value?: bigint;
    data?: `0x${string}`;
    gas?: bigint;
    gasPrice?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    nonce?: number;
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
export declare function sendTransactionAsUser(walletId: string, params: SendTransactionParams): Promise<{
    hash: string;
}>;
//# sourceMappingURL=send-transaction.d.ts.map