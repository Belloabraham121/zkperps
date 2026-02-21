# Perp API Documentation

This document describes all the backend API endpoints for perpetual futures trading operations.

## Base URL

All endpoints are prefixed with `/api/perp`

## Chain Configuration

**All transactions are sent on Arbitrum Sepolia (Chain ID: 421614) - HARDCODED DEFAULT**

- **Chain is hardcoded** - Arbitrum Sepolia (421614) is the default and cannot be changed
- Privy automatically switches embedded wallets to this chain when transactions are sent
- The `caip2` parameter is set to `eip155:421614` for all transactions
- Chain ID is explicitly set in transaction parameters
- Use `GET /api/perp/chain-info` to verify the chain configuration
- Environment variable `CHAIN_ID` is ignored - always uses Arbitrum Sepolia

## Authentication

All endpoints require authentication via JWT token in the `Authorization` header:
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 0. Get Chain Info

**GET** `/api/perp/chain-info`

Gets the chain information for the backend. All transactions are sent on Arbitrum Sepolia (421614).

**Response:**
```json
{
  "chainId": 421614,
  "chainName": "Arbitrum Sepolia",
  "caip2": "eip155:421614",
  "note": "All transactions are sent on this chain. Privy automatically switches embedded wallets to this chain."
}
```

---

### 1. Compute Commitment Hash

**POST** `/api/perp/compute-commitment-hash`

Computes the commitment hash for a perp intent (read-only, no transaction).

**Request Body:**
```json
{
  "intent": {
    "user": "0x...",
    "market": "0x0000000000000000000000000000000000000001",
    "size": "100000000000000000",
    "isLong": true,
    "isOpen": true,
    "collateral": "500000000",
    "leverage": "5000000000000000000",
    "nonce": "123456789",
    "deadline": "1735689600"
  }
}
```

**Response:**
```json
{
  "commitmentHash": "0x..."
}
```

---

### 2. Submit Commitment

**POST** `/api/perp/commit`

Submits a perp commitment to the Hook contract.

**Request Body:**
```json
{
  "poolKey": {
    "currency0": "0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e",
    "currency1": "0x3c604069c87256bbab9cc3ff678410275b156755",
    "fee": 3000,
    "tickSpacing": 60,
    "hooks": "0xe3ea87fb759c3206a9595048732eb6a6000700c4"
  },
  "commitmentHash": "0x..."
}
```

**Note:** `poolKey` is optional. If not provided, defaults are used from config.

**Response:**
```json
{
  "hash": "0x..." // Transaction hash
}
```

---

### 3. Submit Reveal

**POST** `/api/perp/reveal`

Submits a perp reveal to the Hook contract.

**Request Body:**
```json
{
  "poolKey": { /* optional, same as commit */ },
  "intent": {
    "user": "0x...",
    "market": "0x0000000000000000000000000000000000000001",
    "size": "100000000000000000",
    "isLong": true,
    "isOpen": true,
    "collateral": "500000000",
    "leverage": "5000000000000000000",
    "nonce": "123456789",
    "deadline": "1735689600"
  }
}
```

**Response:**
```json
{
  "hash": "0x..." // Transaction hash
}
```

---

### 4. Get Pending Batch

**GET** `/api/perp/pending-batch`

Returns revealed commitments for the default pool that can be passed to execute-batch, plus contract batch state. Use this to know **when a batch can be executed**: the contract requires at least 2 commitments and enforces a batch interval (e.g. 5 minutes) since the last batch.

**Response:**
```json
{
  "poolId": "0x...",
  "commitmentHashes": ["0x...", "0x..."],
  "count": 2,
  "canExecute": true,
  "nextExecutionAt": "2025-02-20T12:35:00.000Z",
  "lastBatchTimestamp": "0",
  "batchIntervalSeconds": 300,
  "minCommitments": 2
}
```

- **canExecute**: `true` when `count >= minCommitments` and `now >= lastBatchTimestamp + batchIntervalSeconds`.
- **nextExecutionAt**: ISO timestamp when the batch will become executable (or `null` if not enough commitments).
- Revealed commitments are tracked when users call **POST /api/perp/reveal**; they are removed after a successful **POST /api/perp/execute-batch**.

---

### 5. Execute Batch

**POST** `/api/perp/execute-batch`

Executes a batch of perp reveals and settles positions.

**Request Body:**
```json
{
  "poolKey": { /* optional */ },
  "commitmentHashes": [
    "0x...",
    "0x..."
  ],
  "baseIsCurrency0": true
}
```

- **commitmentHashes** (optional): If omitted, the server uses the current pending revealed hashes from **GET /api/perp/pending-batch** (so you can call execute-batch with an empty body to execute the current pending batch).
- **baseIsCurrency0** defaults to config value if not provided.

**Response:**
```json
{
  "hash": "0x..." // Transaction hash
}
```

After success, the executed commitment hashes are removed from pending storage so they are not returned again by pending-batch.

---

### 6. Get Position

**GET** `/api/perp/position?marketId=0x...`

Gets the user's position for a specific market.

**Query Parameters:**
- `marketId` (optional): Market ID, defaults to config market ID

**Response:**
```json
{
  "marketId": "0x0000000000000000000000000000000000000001",
  "position": {
    "size": "100000000000000000",
    "entryPrice": "2800000000000000000000",
    "collateral": "500000000",
    "leverage": "5000000000000000000",
    "lastFundingPaid": "0",
    "entryCumulativeFunding": "0"
  }
}
```

---

### 7. Get Collateral

**GET** `/api/perp/collateral`

Gets the user's total collateral and available margin.

**Response:**
```json
{
  "totalCollateral": "500000000",
  "availableMargin": "450000000"
}
```

---

### 8. Get Balances

**GET** `/api/perp/balances`

Gets the user's token balances (USDC, USDT).

**Response:**
```json
{
  "usdc": "1000000000",
  "usdt": "500000000"
}
```

---

### 9. Get Batch State

**GET** `/api/perp/batch-state?poolId=0x...`

Gets the batch state for a pool (last batch timestamp, commitment count).

**Query Parameters:**
- `poolId` (required): Pool ID

**Response:**
```json
{
  "poolId": "0x...",
  "lastBatchTimestamp": "1735689600",
  "commitmentCount": "5"
}
```

---

### 10. Get Batch Interval

**GET** `/api/perp/batch-interval`

Gets the batch interval from the Hook contract.

**Response:**
```json
{
  "batchInterval": "300" // seconds (5 minutes)
}
```

---

## Order status: Pending vs Executed

**Why orders are "pending"**

When a user submits a **reveal** (`POST /api/perp/reveal`), the backend stores the order in the database with `status: "pending"`. Orders stay pending because execution is **batched**: multiple reveals are executed on-chain in a single transaction. Until that batch runs, every order in it remains pending.

**What makes them "executed" (success)**

An order moves to `status: "executed"` only after:

1. **Batch execution runs** – Either:
   - **Manual:** Call **POST /api/perp/execute** (e.g. from the app’s Execute page). No body required; it uses the default pool and pending reveals from the DB.
   - **Manual (custom):** Call **POST /api/perp/execute-batch** with optional `commitmentHashes` and `poolKey`.
   - **Automatic:** The **keeper** (when `KEEPER_PRIVY_USER_ID` is set) runs on an interval and executes when conditions are met. The keeper now also updates order status and writes trade history.

2. **Conditions for execution to succeed:**
   - At least **2 pending commitments** for the pool (see `GET /api/perp/pending-batch` for `count` and `canExecute`).
   - **Batch interval** has passed since the last execution (e.g. 5 minutes). `pending-batch` returns `nextExecutionAt` and `canExecute`.
   - Executor wallet is set up (linked via `/api/auth/link` and addSigners).
   - **Hook has enough quote (USDC)** to settle the perp swap. The backend (or keeper) will transfer from the executor wallet to the Hook if needed; if the executor has insufficient USDC, execution returns an error.
   - **Pool is initialized** and has liquidity (otherwise simulation can revert with division by zero; see `POOL_SETUP.md`).

After a successful execution, the backend:

- Deletes those commitment hashes from `pendingPerpReveals`
- Updates each matching document in `perpOrders` to `status: "executed"` and sets `executedAt`, `txHash`
- Inserts one record per order into `perpTrades` (trade history)

So to get pending orders to success: ensure at least 2 pending reveals, wait until the batch interval has passed, then run **POST /api/perp/execute** (or rely on the keeper). Ensure the executor has enough USDC and the pool has liquidity.

---

## Error Responses

All endpoints may return the following error responses:

**401 Unauthorized:**
```json
{
  "error": "Not authenticated"
}
```

**400 Bad Request:**
```json
{
  "error": "Error message describing what went wrong"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Error message"
}
```

---

## Example Flow

### Complete Perp Trading Flow

1. **Compute commitment hash:**
```bash
POST /api/perp/compute-commitment-hash
Body: { "intent": {...} }
→ Returns: { "commitmentHash": "0x..." }
```

2. **Submit commitment:**
```bash
POST /api/perp/commit
Body: { "commitmentHash": "0x..." }
→ Returns: { "hash": "0x..." }
```

3. **Submit reveal:**
```bash
POST /api/perp/reveal
Body: { "intent": {...} }
→ Returns: { "hash": "0x..." }
```

4. **Wait for batch interval** (check with `/api/perp/batch-interval`)

5. **Execute batch:**
```bash
POST /api/perp/execute-batch
Body: { "commitmentHashes": ["0x...", "0x..."] }
→ Returns: { "hash": "0x..." }
```

6. **Check position:**
```bash
GET /api/perp/position
→ Returns: { "position": {...} }
```

---

## Integration Notes

- **Chain**: All transactions are sent on Arbitrum Sepolia (421614). Privy automatically switches embedded wallets to this chain.
- All transactions are signed server-side using Privy's authorization keys
- No user approval popups required after initial wallet setup
- The frontend must call `POST /api/auth/link` and `addSigners()` before using these endpoints
- All amounts are returned as strings to preserve precision (BigInt values)
- Pool keys are optional and will use defaults from config if not provided
- Chain switching is handled automatically by Privy when `caip2: 'eip155:421614'` is specified

---

## Related Endpoints

- `POST /api/trade/send` - Generic transaction sending (used for deposits, approvals, etc.)
- `GET /api/auth/me` - Get current user info
- `POST /api/auth/link` - Link wallet to user account
