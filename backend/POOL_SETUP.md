# Perp pool setup (fix PoolNotInitialized / Panic 18)

The app’s batch execute swaps on **one specific pool**. That pool must be **initialized** and have **in-range liquidity** on the **same PoolManager** the Hook uses.

**Critical:** The Hook’s PoolManager is set at deploy time (e.g. `POOLMANAGER_ADDRESS` in `Deploy.s.sol`). Your backend `POOL_MANAGER` and the `POOL_MANAGER` you use when running `SetupPoolLiquidity.s.sol` must **both** equal that address. If they differ, you’ll read/write the wrong pool and get zero liquidity → Panic 18 (division by zero) on batch execute.

## 1. Which pool the app uses

The backend builds the pool from your `.env` and hardcoded fee/tickSpacing:

| Item | Value |
|------|--------|
| **PoolManager** | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` (Arbitrum Sepolia; set in the hook at deploy time) |
| **Hook** | `PRIV_BATCH_HOOK` from `.env` (e.g. `0xe3ea87fb759c3206a9595048732eb6a6000700c4`) |
| **currency0** | Lower address of `MOCK_USDC` / `MOCK_USDT` → with your .env: **USDT** `0x3c604069c87256bbab9cc3ff678410275b156755` |
| **currency1** | Higher address → **USDC** `0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e` |
| **fee** | 3000 (0.3%) |
| **tickSpacing** | 60 |

So the pool key is:

- **PoolManager:** `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317`
- **Pool key:** currency0 = USDT, currency1 = USDC, fee = 3000, tickSpacing = 60, hooks = `PRIV_BATCH_HOOK`

If **this exact** (PoolManager + pool key) was never initialized, you get `PoolNotInitialized` even if you added USDC/USDT to some other pool.

**If the E2E script (`scripts/zk/test-perp-e2e.js`) works but the app fails with Panic 18:** The pool and Hook are fine (same poolId, same Hook). The app’s **pending batch** may contain **old reveals** with wrong intent data (e.g. negative size or 6‑decimal collateral from before frontend fixes). Use **Clear pending batch** in the app, then place **2 new orders** (commit + reveal). The new batch will use correct intents and execute like the E2E script.

## 2. How to ensure the right pool is initialized

Run the **same** setup the repo expects, on **Arbitrum Sepolia** (chain id 421614), with the **same** addresses.

### Option A: Use `SetupPoolLiquidity.s.sol` (recommended)

From the **contracts** directory, with a `.env` that matches your backend:

```bash
cd contracts
# Required: same as backend
export PRIVATE_KEY=...           # deployer wallet
export MOCK_USDC=0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e
export MOCK_USDT=0x3c604069c87256bbab9cc3ff678410275b156755
export HOOK=0xe3ea87fb759c3206a9595048732eb6a6000700c4

# Optional (defaults are correct for Arbitrum Sepolia)
export POOL_MANAGER=0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317
export POSITION_MANAGER=0xAc631556d3d4019C95769033B5E719dD77124BAc

forge script script/SetupPoolLiquidity.s.sol:SetupPoolLiquidity --rpc-url <YOUR_ARBITRUM_SEPOLIA_RPC> --broadcast
```

- **Same chain:** use an Arbitrum Sepolia RPC (e.g. `https://sepolia-rollup.arbitrum.io/rpc` or your current backend `RPC_URL`).
- **Same hook:** `HOOK` must be exactly your backend’s `PRIV_BATCH_HOOK` (e.g. `0xe3ea...`).
- **Same tokens:** `MOCK_USDC` / `MOCK_USDT` must match backend’s `MOCK_USDC` / `MOCK_USDT`.

The script uses fee=3000 and tickSpacing=60 and sorts currency0 &lt; currency1, so the resulting pool key matches what the backend uses.

### Option B: Already ran a similar setup

If you already ran something that initialized a pool and added USDC/USDT:

1. **PoolManager** must be `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` (the one the hook uses).
2. **Pool key** must be exactly:
   - currency0 = `0x3c604069c87256bbab9cc3ff678410275b156755` (USDT)
   - currency1 = `0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e` (USDC)
   - fee = 3000, tickSpacing = 60, hooks = `0xe3ea87fb759c3206a9595048732eb6a6000700c4`

If your setup used a different hook address, different fee/tickSpacing, or a different PoolManager, that’s a **different pool** — initialize (and add liquidity) for the pool key above on the PoolManager above.

## 3. Quick checklist

- [ ] Chain is **Arbitrum Sepolia (421614)**.
- [ ] **PoolManager** is `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317`.
- [ ] **Hook** in the pool key is your backend’s `PRIV_BATCH_HOOK` (e.g. `0xe3ea87fb759c3206a9595048732eb6a6000700c4`).
- [ ] **Currencies** are USDT (0x3c60...) and USDC (0x3cbe...), with currency0 &lt; currency1.
- [ ] **fee** = 3000, **tickSpacing** = 60.
- [ ] You called `poolManager.initialize(poolKey, sqrtPriceX96)` for that key (e.g. via `SetupPoolLiquidity.s.sol`).
- [ ] You added liquidity to that same pool so the batch swap has depth.

Once this one pool is initialized (and has liquidity), the perp batch execute should stop reverting with `PoolNotInitialized`.
