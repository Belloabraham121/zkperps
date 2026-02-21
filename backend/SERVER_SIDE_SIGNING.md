# Server-Side Signing Implementation

This document confirms that all perp API endpoints correctly implement Privy's server-side signing pattern.

## ✅ Implementation Status

All perp endpoints (`/api/perp/*`) correctly use Privy's server-side signing via the `sendTransactionAsUser` function.

## Server-Side Signing Pattern

### How It Works

1. **Initial Setup** (one-time per user):
   - Frontend calls `POST /api/auth/link` with `walletAddress` and `walletId`
   - Backend returns a `signerId` (key quorum ID)
   - Frontend calls `addSigners()` with the `signerId` to add backend as a signer

2. **Transaction Execution** (all subsequent calls):
   - Frontend calls any `/api/perp/*` endpoint with JWT token
   - Backend uses `sendTransactionAsUser()` which:
     - Reads the authorization private key from file
     - Calls Privy SDK's `sendTransaction()` with `authorization_context`
     - Transaction is signed server-side using the authorization key
     - **No user approval popup required**

### Code Flow

```typescript
// 1. Perp route receives request
POST /api/perp/commit
  ↓
// 2. Verify wallet setup
verifyWalletSetup(userId)
  ↓
// 3. Encode transaction data
encodeSubmitPerpCommitment(poolKey, commitmentHash)
  ↓
// 4. Send via server-side signing
sendTransactionAsUser(walletId, { to, data })
  ↓
// 5. Privy SDK signs with authorization key
privy.wallets().ethereum().sendTransaction(walletId, {
  caip2: `eip155:${chainId}`,
  params: { transaction: {...} },
  authorization_context: {
    authorization_private_keys: [authKey]  // ← Server-side signing
  }
})
  ↓
// 6. Transaction broadcasted, hash returned
{ hash: "0x..." }
```

## Implementation Details

### ✅ `send-transaction.ts`

- Uses Privy SDK's `eth_sendTransaction` method
- Includes `authorization_context` with `authorization_private_keys`
- Reads authorization key from file (secure)
- Proper error handling for authorization failures
- Matches pattern from `PRIVY_TRANSACTION_TYPES.md`

### ✅ Perp Routes (`routes/perp.ts`)

All transaction endpoints use server-side signing:

1. **`POST /api/perp/commit`** - Submits perp commitment
2. **`POST /api/perp/reveal`** - Submits perp reveal
3. **`POST /api/perp/execute-batch`** - Executes batch of reveals

All call `sendTransactionAsUser()` which handles server-side signing.

### ✅ Read-Only Endpoints

These endpoints don't require signing (they read contract state):

- `POST /api/perp/compute-commitment-hash` - Computes hash (read-only call)
- `GET /api/perp/position` - Reads position from contract
- `GET /api/perp/collateral` - Reads collateral from contract
- `GET /api/perp/balances` - Reads token balances
- `GET /api/perp/batch-state` - Reads batch state
- `GET /api/perp/batch-interval` - Reads batch interval

## Benefits

✅ **No User Popups**: Transactions execute without user approval after initial setup  
✅ **Offline Execution**: Can execute transactions when user is offline  
✅ **Agentic Trading**: Enables AI agents to trade autonomously  
✅ **Batch Operations**: Can batch multiple operations efficiently  
✅ **Secure**: Uses Privy's secure enclave for key management  

## Security Considerations

1. **Authorization Key**: Stored securely in file, never exposed to frontend
2. **JWT Authentication**: All endpoints require valid JWT token
3. **Wallet Verification**: Verifies wallet is properly set up before transactions
4. **Error Handling**: Proper error messages without exposing sensitive info

## References

- **Privy Server-Side Access**: https://docs.privy.io/wallets/wallets/server-side-access
- **Transaction Types**: `PRIVY_TRANSACTION_TYPES.md`
- **Privy Transaction Docs**: https://docs.privy.io/wallets/using-wallets/ethereum/send-a-transaction

## Testing

To verify server-side signing works:

1. Ensure user has linked wallet and added backend as signer
2. Call any transaction endpoint (e.g., `POST /api/perp/commit`)
3. Verify transaction executes without user popup
4. Check transaction hash is returned successfully

## Troubleshooting

If transactions fail with authorization errors:

1. Verify `AUTHORIZATION_PRIVATE_KEY_PATH` is set in `.env`
2. Verify authorization key file exists and contains valid private key
3. Verify user has called `addSigners()` with the correct `signerId`
4. Verify `PRIVY_KEY_QUORUM_ID` matches the signerId used in frontend
5. Check Privy dashboard for key quorum configuration
