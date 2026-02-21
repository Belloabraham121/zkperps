# Privy SDK: All Transaction Types & Signing Methods

This document outlines **all possible transactions and signing operations** you can perform with Privy wallets using their SDK.

## Table of Contents

1. [Transaction Operations](#transaction-operations)
2. [Chain Management](#chain-management)
3. [Message Signing](#message-signing)
4. [Typed Data Signing](#typed-data-signing)
5. [Advanced Signing](#advanced-signing)
6. [Account Abstraction](#account-abstraction)

---

## Transaction Operations

### 1. **eth_sendTransaction** ✅ (Currently Implemented)

**Purpose**: Sign and broadcast a transaction to the blockchain.

**What you can do**:
- Send native tokens (ETH, MATIC, etc.)
- Call smart contract functions
- Transfer ERC-20 tokens
- Execute any on-chain transaction

**Current Implementation** (`backend/src/lib/send-transaction.ts`):
```typescript
await privy.wallets().ethereum().sendTransaction(walletId, {
  caip2: `eip155:${chainId}`,
  params: {
    transaction: {
      to: "0x...",           // Contract or wallet address
      value: "0x0",          // Amount in wei (hex)
      data: "0x...",         // Contract call data
      gas_limit: "0x...",    // Optional gas limit
      gas_price: "0x...",    // Optional (legacy)
      max_fee_per_gas: "0x...",      // Optional (EIP-1559)
      max_priority_fee_per_gas: "0x...", // Optional (EIP-1559)
      nonce: "123",          // Optional nonce
      chain_id: 8453,        // Optional chain ID
    },
  },
  authorization_context: {
    authorization_private_keys: [authKey], // For server-side signing
  },
});
```

**Transaction Parameters**:
- `to`: Recipient address (required)
- `value`: Amount in wei (hex string, optional)
- `data`: Contract call data (hex string, optional)
- `gas_limit`: Gas limit (hex string, optional)
- `gas_price`: Legacy gas price (hex string, optional)
- `max_fee_per_gas`: Max fee per gas for EIP-1559 (hex string, optional)
- `max_priority_fee_per_gas`: Priority fee for EIP-1559 (hex string, optional)
- `nonce`: Transaction nonce (number/string, optional)
- `chain_id`: Chain ID (number, optional)

**Use Cases**:
- ✅ Approve ERC-20 tokens (`encodeUsdcApprove`)
- ✅ Deposit collateral (`encodeDepositCollateral`)
- ✅ Any smart contract interaction
- ✅ Native token transfers

**Documentation**: https://docs.privy.io/wallets/using-wallets/ethereum/send-a-transaction

---

### 2. **eth_signTransaction**

**Purpose**: Sign a transaction **without broadcasting** it to the network.

**What you can do**:
- Sign transactions for later submission
- Create signed transactions for batch processing
- Offline transaction signing

**Usage** (NodeJS):
```typescript
const signedTx = await privy.wallets().ethereum().signTransaction(walletId, {
  caip2: `eip155:${chainId}`,
  params: {
    transaction: {
      to: "0x...",
      value: "0x0",
      data: "0x...",
      // ... same parameters as sendTransaction
    },
  },
  authorization_context: {
    authorization_private_keys: [authKey],
  },
});

// Returns signed transaction that you can broadcast later
```

**Documentation**: https://docs.privy.io/api-reference/wallets/ethereum/eth-sign-transaction

---

## Chain Management

### 8. **wallet_switchEthereumChain** / **switchChain**

**Purpose**: Switch the connected wallet to a different Ethereum network/chain.

**What you can do**:
- Change the network of embedded wallets
- Prompt users to switch networks in external wallets (MetaMask, etc.)
- Get current chain ID
- Ensure wallet is on the correct network before transactions

**Usage** (React):
```typescript
import { useWallets } from '@privy-io/react-auth';

const { wallets } = useWallets();
const wallet = wallets[0]; // Get the wallet you want to switch

// Switch to a specific chain ID (number or hex string)
await wallet.switchChain(7777777); // Base Sepolia: 84532, Base: 8453, Arbitrum Sepolia: 421614

// For embedded wallets: updates network behind the scenes
// For external wallets: prompts user to switch in their wallet client
```

**Usage** (React Native):
```typescript
import { useEmbeddedEthereumWallet } from '@privy-io/expo';

const { wallets } = useEmbeddedEthereumWallet();
const wallet = wallets[0];

const provider = await wallet.getProvider();

// Switch chain using EIP-1193 provider
await provider.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x14a34' }] // Base Sepolia: 0x14a34 (84532 in hex)
});

// Get current chain ID
const currentChainId = await provider.request({
  method: 'eth_chainId'
});
```

**Usage** (Via EIP-1193 Provider):
```typescript
// For any SDK that provides an EIP-1193 provider
const provider = await wallet.getProvider();

// Switch chain
await provider.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x14a34' }] // Hex string
});

// Get current chain ID
const chainId = await provider.request({
  method: 'eth_chainId'
});
```

**Parameters**:
- `chainId`: Chain ID as a `number` (React `switchChain`) or hex `string` (EIP-1193 `wallet_switchEthereumChain`)

**Common Chain IDs**:
- Ethereum Mainnet: `1` (`0x1`)
- Base: `8453` (`0x2105`)
- Base Sepolia: `84532` (`0x14a34`)
- Arbitrum Sepolia: `421614` (`0x66eee`)
- Arbitrum One: `42161` (`0xa4b1`)

**Behavior**:
- **Embedded Wallets**: Automatically switches network behind the scenes (no user prompt)
- **External Wallets**: Prompts user to approve network switch in their wallet client (MetaMask, Coinbase Wallet, etc.)

**Error Handling**:
- Promise rejects if:
  - Target chain is not configured in `supportedChains`
  - User declines the network switch request (external wallets)
  - Invalid chain ID provided

**Use Cases**:
- Ensure wallet is on correct network before sending transactions
- Switch between testnet and mainnet
- Multi-chain dApp support
- Network validation before contract interactions

**Example: Switch Before Transaction**:
```typescript
import { useWallets, useSendTransaction } from '@privy-io/react-auth';

const { wallets } = useWallets();
const { sendTransaction } = useSendTransaction();
const wallet = wallets[0];

// Ensure wallet is on Base Sepolia before sending transaction
try {
  await wallet.switchChain(84532); // Base Sepolia
  
  // Now send transaction
  await sendTransaction({
    to: '0x...',
    value: 0n,
    data: '0x...',
  });
} catch (error) {
  console.error('Failed to switch chain:', error);
  // Handle error (e.g., chain not configured, user declined)
}
```

**Documentation**: https://docs.privy.io/wallets/using-wallets/ethereum/switch-chain

---

## Message Signing

### 3. **personal_sign**

**Purpose**: Sign a plain text message or raw bytes using Ethereum's `personal_sign` method.

**What you can do**:
- Sign authentication messages
- Sign off-chain data
- Prove wallet ownership
- Sign arbitrary messages for verification

**Usage** (NodeJS):
```typescript
const { signature, encoding } = await privy.wallets().ethereum().signMessage(walletId, {
  message: "Hello, Ethereum!",
  encoding: "utf-8", // or "hex" for raw bytes
  authorization_context: {
    authorization_private_keys: [authKey],
  },
});
```

**Usage** (React):
```typescript
import { useSignMessage } from '@privy-io/react-auth';

const { signMessage } = useSignMessage();

const { signature } = await signMessage(
  { message: 'I hereby vote for foobar' },
  {
    address: wallets[0].address, // Optional: specify wallet
    uiOptions: {
      title: 'Sign message to vote',
    },
  }
);
```

**Parameters**:
- `message`: String or hex-encoded bytes to sign
- `encoding`: `"utf-8"` for text, `"hex"` for raw bytes

**Use Cases**:
- User authentication
- Off-chain voting
- Message verification
- Wallet ownership proof

**Documentation**: 
- https://docs.privy.io/wallets/using-wallets/ethereum/sign-a-message
- https://docs.privy.io/api-reference/wallets/ethereum/personal-sign

---

## Typed Data Signing

### 4. **eth_signTypedData_v4** (EIP-712)

**Purpose**: Sign structured, typed data following the EIP-712 standard.

**What you can do**:
- Sign structured data with type information
- Sign permit requests (ERC-20 permits)
- Sign domain-separated messages
- Sign complex data structures

**Usage** (NodeJS):
```typescript
const { signature, encoding } = await privy.wallets().ethereum().signTypedData(walletId, {
  params: {
    typed_data: {
      domain: {
        name: "My DApp",
        version: "1",
        chainId: 8453,
        verifyingContract: "0x...",
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Person: [
          { name: "name", type: "string" },
          { name: "wallet", type: "address" },
        ],
        Mail: [
          { name: "from", type: "Person" },
          { name: "to", type: "Person" },
          { name: "contents", type: "string" },
        ],
      },
      primary_type: "Mail",
      message: {
        from: {
          name: "Alice",
          wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826",
        },
        to: {
          name: "Bob",
          wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
        },
        contents: "Hello, Bob!",
      },
    },
  },
  authorization_context: {
    authorization_private_keys: [authKey],
  },
});
```

**Usage** (React):
```typescript
import { useSignTypedData } from '@privy-io/react-auth';

const { signTypedData } = useSignTypedData();

const { signature } = await signTypedData({
  domain: { /* ... */ },
  types: { /* ... */ },
  primaryType: "Mail",
  message: { /* ... */ },
}, {
  address: wallets[0].address,
});
```

**Use Cases**:
- ERC-20 permit signatures (gasless approvals)
- Structured off-chain data signing
- Domain-separated signatures
- Complex authentication flows

**Documentation**: 
- https://docs.privy.io/wallets/using-wallets/ethereum/sign-typed-data
- https://docs.privy.io/api-reference/wallets/ethereum/eth-signtypeddata-v4

---

## Advanced Signing

### 5. **secp256k1_sign** (Raw Hash Signing)

**Purpose**: Sign a raw hash using the secp256k1 curve (low-level signing).

**What you can do**:
- Sign pre-computed hashes
- Custom signature schemes
- Low-level cryptographic operations

**Usage** (REST API):
```bash
curl --request POST \
  --url https://api.privy.io/v1/wallets/{wallet_id}/rpc \
  --header 'Authorization: Basic <encoded-value>' \
  --data '{
    "method": "secp256k1_sign",
    "params": {
      "hash": "0x..."
    }
  }'
```

**Documentation**: https://docs.privy.io/api-reference/wallets/ethereum/secp256k1-sign

---

### 6. **eth_sign7702Authorization** (EIP-7702)

**Purpose**: Sign an EIP-7702 authorization struct for account abstraction.

**What you can do**:
- Authorize account code changes
- Enable account abstraction features
- Delegate execution permissions

**Usage** (REST API):
```bash
curl --request POST \
  --url https://api.privy.io/v1/wallets/{wallet_id}/rpc \
  --data '{
    "method": "eth_sign7702Authorization",
    "params": {
      "authorization": {
        "chainId": "0x2105",
        "nonce": "0x0",
        "delegateContract": "0x...",
        "validityPeriod": "0x..."
      }
    }
  }'
```

**Documentation**: https://docs.privy.io/api-reference/wallets/ethereum/eth-sign-7702-authorization

---

## Account Abstraction

### 7. **eth_signUserOperation**

**Purpose**: Sign a user operation for ERC-4337 account abstraction.

**What you can do**:
- Sign user operations for smart contract wallets
- Enable gasless transactions
- Batch multiple operations
- Custom validation logic

**Usage** (REST API):
```bash
curl --request POST \
  --url https://api.privy.io/v1/wallets/{wallet_id}/rpc \
  --data '{
    "method": "eth_signUserOperation",
    "params": {
      "userOperation": {
        "sender": "0x...",
        "nonce": "0x0",
        "callData": "0x...",
        "callGasLimit": "0x...",
        "verificationGasLimit": "0x...",
        "preVerificationGas": "0x...",
        "maxFeePerGas": "0x...",
        "maxPriorityFeePerGas": "0x...",
        "paymasterAndData": "0x...",
        "signature": "0x..."
      }
    }
  }'
```

**Documentation**: https://docs.privy.io/api-reference/wallets/ethereum/eth-sign-user-operation

---

## Summary Table

| Method | Purpose | Use Case | Currently Used |
|--------|---------|----------|----------------|
| `eth_sendTransaction` | Sign & broadcast transaction | Smart contract calls, transfers | ✅ Yes |
| `eth_signTransaction` | Sign transaction (no broadcast) | Offline signing, batch processing | ❌ No |
| `wallet_switchEthereumChain` / `switchChain` | Switch wallet network | Multi-chain support, network validation | ❌ No |
| `personal_sign` | Sign plain message | Authentication, off-chain data | ❌ No |
| `eth_signTypedData_v4` | Sign EIP-712 typed data | Permits, structured data | ❌ No |
| `secp256k1_sign` | Sign raw hash | Low-level crypto operations | ❌ No |
| `eth_sign7702Authorization` | Sign EIP-7702 authorization | Account abstraction | ❌ No |
| `eth_signUserOperation` | Sign ERC-4337 user op | Smart contract wallets | ❌ No |

---

## Implementation Recommendations

### For Your Perps Project:

1. **Already Implemented** ✅:
   - `eth_sendTransaction` for:
     - USDC approvals
     - Collateral deposits
     - Contract interactions

2. **Consider Adding** 🔄:
   - `wallet_switchEthereumChain` / `switchChain` for:
     - Ensuring correct network before transactions
     - Multi-chain dApp support
     - Network validation
   
   - `personal_sign` for:
     - User authentication
     - Off-chain order signing
     - Wallet ownership verification
   
   - `eth_signTypedData_v4` for:
     - ERC-20 permit signatures (gasless approvals)
     - Structured order signing
     - Off-chain commitment signing

3. **Future Enhancements** 🚀:
   - `eth_signUserOperation` for account abstraction
   - `eth_signTransaction` for batch transaction preparation

---

## SDK Support Matrix

| Platform | sendTransaction | switchChain | signMessage | signTypedData | signTransaction | Others |
|----------|----------------|-------------|-------------|---------------|----------------|--------|
| **React** | ✅ | ✅ | ✅ | ✅ | ❌ | Via provider |
| **React Native** | ✅ | ✅ (via provider) | ✅ | ✅ | ❌ | Via provider |
| **NodeJS** | ✅ | ✅ (via provider) | ✅ | ✅ | ✅ | ✅ |
| **REST API** | ✅ | ✅ (via provider) | ✅ | ✅ | ✅ | ✅ |
| **Swift** | ✅ | ✅ (via provider) | ✅ | ✅ | ❌ | Via provider |
| **Android** | ✅ | ✅ (via provider) | ✅ | ✅ | ❌ | Via provider |
| **Flutter** | ✅ | ✅ (via provider) | ✅ | ✅ | ❌ | Via provider |
| **Unity** | ✅ | ✅ (via provider) | ✅ | ✅ | ❌ | Via provider |
| **Python** | ✅ | ✅ (via provider) | ✅ | ✅ | ✅ | ✅ |
| **Java** | ✅ | ✅ (via provider) | ✅ | ✅ | ✅ | ✅ |
| **Rust** | ✅ | ✅ (via provider) | ✅ | ✅ | ✅ | ✅ |
| **Go** | ✅ | ✅ (via provider) | ✅ | ✅ | ✅ | ✅ |

---

## References

- **Main Transaction Docs**: https://docs.privy.io/wallets/using-wallets/ethereum/send-a-transaction
- **Switch Chain**: https://docs.privy.io/wallets/using-wallets/ethereum/switch-chain
- **Message Signing**: https://docs.privy.io/wallets/using-wallets/ethereum/sign-a-message
- **Typed Data**: https://docs.privy.io/wallets/using-wallets/ethereum/sign-typed-data
- **API Reference**: https://docs.privy.io/api-reference/wallets/ethereum/
- **Complete Docs Index**: https://docs.privy.io/llms.txt

---

## Notes

- All methods support **server-side signing** using `authorization_context` with `authorization_private_keys`
- React SDK provides hooks (`useSendTransaction`, `useSignMessage`, `useSignTypedData`) for client-side signing
- NodeJS SDK provides direct methods for server-side signing
- REST API supports all methods via `/v1/wallets/{wallet_id}/rpc` endpoint
- For external wallets (MetaMask, etc.), always specify the `address` parameter
