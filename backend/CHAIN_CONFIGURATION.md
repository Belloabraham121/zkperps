# Chain Configuration: Arbitrum Sepolia (421614)

All backend transactions are configured to use **Arbitrum Sepolia (Chain ID: 421614)**.

## Implementation

### 1. Configuration (`config.ts`)

- **HARDCODED**: `chainId` is hardcoded to `421614` (Arbitrum Sepolia)
- **Environment variable `CHAIN_ID` is IGNORED** - always uses Arbitrum Sepolia
- This ensures all transactions are always on Arbitrum Sepolia regardless of environment configuration

### 2. Transaction Sending (`send-transaction.ts`)

All transactions sent via `sendTransactionAsUser()`:

- **caip2**: Set to `eip155:421614` (Arbitrum Sepolia)
- **chain_id**: Explicitly set to `421614` in transaction parameters
- **Automatic Chain Switching**: Privy automatically switches embedded wallets to the chain specified in `caip2`

```typescript
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
const caip2 = `eip155:${ARBITRUM_SEPOLIA_CHAIN_ID}`;

// Transaction includes:
{
  caip2: "eip155:421614",
  params: {
    transaction: {
      chain_id: 421614,  // Explicitly set
      // ... other transaction fields
    }
  }
}
```

### 3. Perp Routes (`routes/perp.ts`)

- All perp transaction endpoints use `sendTransactionAsUser()` which handles chain switching
- Added `GET /api/perp/chain-info` endpoint to verify chain configuration
- Documentation updated to reflect chain usage

### 4. Contract Reader (`contract-reader.ts`)

- Uses viem's `createPublicClient` with Arbitrum Sepolia chain configuration
- All contract reads are performed on Arbitrum Sepolia

## How Chain Switching Works

### For Embedded Wallets (Our Use Case)

When you send a transaction with Privy's server-side SDK:

1. Transaction specifies `caip2: 'eip155:421614'`
2. Privy automatically switches the embedded wallet to Arbitrum Sepolia
3. Transaction is signed and broadcasted on Arbitrum Sepolia
4. **No user interaction required** - happens automatically

### For External Wallets (Not Used)

If using external wallets (MetaMask, etc.), users would be prompted to switch chains. However, we use embedded wallets exclusively, so this doesn't apply.

## Verification

### Check Chain Configuration

```bash
GET /api/perp/chain-info
```

**Response:**
```json
{
  "chainId": 421614,
  "chainName": "Arbitrum Sepolia",
  "caip2": "eip155:421614",
  "note": "All transactions are sent on this chain. Privy automatically switches embedded wallets to this chain."
}
```

### Verify Transaction Chain

All transactions sent via the backend will:
- Include `caip2: 'eip155:421614'` in the Privy API call
- Include `chain_id: 421614` in the transaction parameters
- Be broadcasted on Arbitrum Sepolia

## Environment Variables

```bash
# Chain configuration
# NOTE: CHAIN_ID environment variable is IGNORED - always uses Arbitrum Sepolia (421614)
RPC_URL=https://arb-sepolia.g.alchemy.com/v2/...  # Arbitrum Sepolia RPC (required)

# Contract addresses (Arbitrum Sepolia)
PRIV_BATCH_HOOK=0xe3ea87fb759c3206a9595048732eb6a6000700c4
PERP_POSITION_MANAGER=0xf3c9cdbaf6dc303fe302fbf81465de0a057ccf5e
MOCK_USDC=0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e
MOCK_USDT=0x3c604069c87256bbab9cc3ff678410275b156755
```

## References

- **Privy Chain Switching**: https://docs.privy.io/wallets/using-wallets/ethereum/switch-chain
- **Privy Transaction Types**: `PRIVY_TRANSACTION_TYPES.md` (Chain Management section)
- **Arbitrum Sepolia**: https://docs.arbitrum.io/for-devs/networks/arbitrum-sepolia

## Notes

- Chain switching happens automatically for embedded wallets
- No frontend code needed to switch chains
- All transactions are guaranteed to be on Arbitrum Sepolia (421614)
- If a user's wallet is on a different chain, Privy will automatically switch it when the transaction is sent
