# Hook funding for perp batch execute

When `revealAndBatchExecutePerps` runs, the **Hook** contract executes a net swap on the pool and must **transfer quote (USDC/USDT) to the PoolManager** to settle. The Hook holds **no tokens by default**, so batch execute can fail (e.g. revert or Panic 18) if the hook has 0 quote balance.

The e2e script **funds the hook** before calling batch execute: see `scripts/zk/test-perp-e2e.js` step **5.6** (“Fund Hook with quote for batch”).

## How to fund the hook

1. **One-time (or top-up):** Send **quote token** to the Hook address (`PRIV_BATCH_HOOK` in your `.env`).
   - If `BASE_IS_CURRENCY0=true`, quote is **USDC** (currency1).
   - If `BASE_IS_CURRENCY0=false`, quote is **USDT** (currency0).
   - Use a wallet that holds Mock USDC/USDT on the same chain (e.g. Arbitrum Sepolia).

2. **Using the e2e script:** Run the full script; it computes an estimated quote amount (with a 10x buffer), checks the hook balance, and transfers the shortfall from the signer to the hook:
   ```bash
   cd scripts/zk
   PRIVATE_KEY=... RPC_URL=https://sepolia-rollup.arbitrum.io/rpc node test-perp-e2e.js
   ```
   (Omit `SKIP_WAIT` so it waits for the batch interval and then executes; the script funds the hook before step 6.)

3. **Manual transfer:** From any wallet that holds the quote token on the same chain, transfer a sufficient amount to `PRIV_BATCH_HOOK`. The exact amount depends on the net size and price; the e2e script uses `(totalBaseSize * priceEstimate * 10) / 1e18` in quote decimals as a buffer.

## Backend behavior

Before simulating the batch tx, the backend checks the hook’s quote balance. If it is **0**, it logs:

`[Perp] Batch (post-reveal): Hook has 0 quote balance — fund the hook (e.g. transfer USDC to PRIV_BATCH_HOOK) for batch execute to succeed. See scripts/zk/test-perp-e2e.js step 5.6.`

It does **not** auto-fund the hook (the backend has no designated funder wallet). You must fund the hook via the script or a manual transfer.

## Panic 18 (division by zero)

If the pool has **zero in-range liquidity**, the swap math can revert with **Panic 18**. Ensure the pool is initialized and has liquidity (see `POOL_SETUP.md`). If the hook has **0 quote balance**, the revert may be a different error (e.g. transfer failure). Funding the hook and ensuring pool liquidity both help batch execute succeed.

## Debugging: app fails but e2e script succeeds

When the **app** triggers batch execute you may see `simulate revert — Panic 18` while the **e2e script** (same chain) succeeds. Compare backend logs with the script:

- **Backend** logs: `[Perp] Batch (post-reveal): ... executing now (poolId: 0x...)` and `Hook quote balance: <number>`.
- **Script** prints: `PoolId: 0xa2f2ba1fe0f2cf08686544d42608e24526d01ccdb7f3f52ce74cb03c4aab09d2` and `Hook already has sufficient quote: 25009.999999` (or similar).

If **poolId** differs, the app/backend is using a different pool key (check `DEFAULT_POOL_KEY` and backend env). If **Hook quote balance** is 0 in the app run, fund the hook (script step 5.6 or manual transfer). If you get Panic 18 with correct intent (size/leverage positive) and the pool is **initialized** (slot0 sqrtPriceX96 ≠ 0), the revert is likely **zero in-range liquidity** for the swap. Add liquidity in the pool’s tick range by running `SetupPoolLiquidity.s.sol`; see `POOL_SETUP.md`.

**Stale batch (old bad reveals):** If the pending batch was created with an old app version (e.g. negative size for shorts), the on-chain reveals contain invalid intent data and the batch will keep reverting. Clear the backend’s pending list so it stops retrying, then open new positions with the fixed app: `POST /api/perp/clear-pending-batch` (auth required). After clearing, create 2 new commits/reveals; the next batch will use only the new (valid) reveals.
