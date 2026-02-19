# Oracle setup for PerpPositionManager

Your perp contracts need a **price oracle** (18-decimal price) per market for marking, funding, and liquidation. You have two practical options.

---

## Deploy full stack on Arbitrum (Chainlink + PerpPositionManager + PrivBatchHook)

Deploy everything in order. Contract names:

| Contract | What it is |
|----------|------------|
| **PerpPositionManager** | Holds perp markets, positions, margin; uses the oracle for mark price. |
| **PrivBatchHook** | Private batch contract (hook): commits/reveals and executes swaps + perp settlements. |
| **ChainlinkOracleAdapter** | Wraps Chainlink price feeds so PerpPositionManager can read ETH/USD, BTC/USD, etc. |

**Step 1 — Core stack (verifier, mock tokens, PerpPositionManager, PrivBatchHook)**  
This deploys the verifier, MockUSDC, MockUSDT, **PerpPositionManager**, and **PrivBatchHook**, and wires the hook as the perp executor. We skip oracle/market here so we can add the Chainlink oracle in step 2.

```bash
cd contracts
export PRIVATE_KEY=0x...   # your deployer key
export SKIP_ORACLE_MARKET=true

forge script script/Deploy.s.sol:Deploy \
  --rpc-url arbitrum_one --broadcast --verify
```

Save the printed **PerpPositionManager** and **PrivBatchHook** addresses for the next steps.

**Step 2 — Deploy Chainlink oracle and set feed(s)**  
Deploys **ChainlinkOracleAdapter** and registers the ETH/USD feed (use the Standard Proxy for your network from the table below).

```bash
export MARKET_ID=0x0000000000000000000000000000000000000001
export CHAINLINK_FEED_ADDRESS=0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612

forge script script/DeployChainlinkOracle.s.sol:DeployChainlinkOracle \
  --rpc-url arbitrum_one --broadcast --verify
```

Save the printed **ChainlinkOracleAdapter** address as `ORACLE_ADDRESS`.

**Step 3 — Create the pool and add liquidity**  
The perp path executes a swap on the PoolManager; the pool must exist and have liquidity. Run `SetupPoolLiquidity.s.sol` with your deployed token and hook addresses. It uses the same PoolManager as `Deploy.s.sol` by default.

```bash
export MOCK_USDC=0x...   # from Step 1 (Deploy.s.sol output)
export MOCK_USDT=0x...   # from Step 1
export HOOK=0x...        # PrivBatchHook from Step 1

forge script script/SetupPoolLiquidity.s.sol:SetupPoolLiquidity \
  --rpc-url arbitrum_sepolia --broadcast
```

At the end the script prints **POOL_ID** (as bytes32). Copy that value for Step 4.

**Step 4 — Add a market to PerpPositionManager**  
Registers one market (e.g. ETH) using the Chainlink adapter and the **pool ID from Step 3** (the market’s poolId must match the pool you created).

```bash
export PERP_MANAGER_ADDRESS=0x...   # from Step 1
export ORACLE_ADDRESS=0x...         # ChainlinkOracleAdapter from Step 2
export MARKET_ID=0x0000000000000000000000000000000000000001
export POOL_ID=0x...                # from Step 3 script output (console.logBytes32)
export MAX_LEVERAGE=10000000000000000000
export MAINTENANCE_MARGIN=50000000000000000

forge script script/AddMarket.s.sol:AddMarket \
  --rpc-url arbitrum_sepolia --broadcast
```

To add BTC later: call `ChainlinkOracleAdapter.setFeed(btcMarketId, btcUsdFeedAddress)` then run SetupPoolLiquidity for a new pool (or reuse), and run `AddMarket.s.sol` again with the new `MARKET_ID` and the pool’s `POOL_ID`.

---

## What to do after deployment (core + oracle + market)

You have the core stack, Chainlink oracle, and one market (e.g. ETH) on Arbitrum Sepolia. Next:

1. **Create the pool and add liquidity (if not already done)**  
   Run `script/SetupPoolLiquidity.s.sol` with env: `MOCK_USDC`, `MOCK_USDT`, `HOOK` (your PrivBatchHook). Optional: `POOL_MANAGER`, `POSITION_MANAGER` (defaults are for Arbitrum). The script initializes the pool and mints a liquidity position. **Use the printed POOL_ID** when adding a market (Step 4 above); the market’s `poolId` must match the pool created here.

2. **Deposit margin**  
   Users (or you for testing) call `PerpPositionManager.depositCollateral(amount)` after approving the collateral token (MockUSDC). That margin is used for opening perp positions.

3. **Submit perp commitments and reveals**  
   Users call `PrivBatchHook.submitPerpCommitment(poolKey, commitmentHash)` (or `submitPerpCommitmentWithProof` if using ZK), then before the batch window closes they call `submitPerpReveal(poolKey, intent)` with the same `poolKey` and the decoded `PerpIntent`. The `intent` encodes user, market, size, isLong, isOpen, collateral, leverage, nonce, deadline.

4. **Execute the batch**  
   After the batch interval has passed, anyone calls `PrivBatchHook.revealAndBatchExecutePerps(poolKey, commitmentHashes, baseIsCurrency0)`. That runs the net swap on the pool and opens/closes positions on `PerpPositionManager`.

5. **Optional: add more markets**  
   Call `ChainlinkOracleAdapter.setFeed(marketId, chainlinkFeedAddress)` for another pair (e.g. BTC), then run `AddMarket.s.sol` again with the new `MARKET_ID` and same `ORACLE_ADDRESS`.

6. **Optional: frontend / bots**  
   Build a UI or keeper that: deposits margin, builds and hashes perp intents, submits commitments/reveals, and calls `revealAndBatchExecutePerps` when the window is ready.

---

## How to get marketId

**marketId is not fetched from anywhere** — you choose it. It is an `address` used as a unique identifier for a market (e.g. ETH, BTC). The same value must be used in:

- `ChainlinkOracleAdapter.setFeed(marketId, feedAddress)`
- `PerpPositionManager.createMarket(marketId, ...)`
- Any frontend or contract that opens/closes positions on that market

**Convention:** use a short, human-readable address:

| Market | marketId (use this) |
|--------|---------------------|
| ETH | `0x0000000000000000000000000000000000000001` |
| BTC | `0x0000000000000000000000000000000000000002` |
| Another | `0x0000000000000000000000000000000000000003` … |

So for ETH you set `export MARKET_ID=0x0000000000000000000000000000000000000001`; for BTC use `...0002`, and so on. You can use any unused address if you prefer (e.g. `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` for ETH); just keep it consistent everywhere.

---

## Option 1: Chainlink (production)

**Where to get it:** [Chainlink Data Feeds](https://docs.chain.link/data-feeds/price-feeds/addresses) — choose your network and copy the **Standard Proxy** address for the pair (e.g. ETH/USD, BTC/USD). Use **Standard Proxy**, not SVR Proxy (SVR is a different product).

**Arbitrum One (mainnet):**
| Pair   | Standard Proxy |
|--------|-----------------|
| ETH/USD | `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` |
| BTC/USD | `0x6ce185860a4963106506C203335A291051365e6Ca` |

**Other networks (from Chainlink docs — use Standard Proxy):**  
If you see multiple addresses (Standard Proxy, SVR Proxy), use **Standard Proxy** only. Example addresses you might see:

| Pair   | Use this (Standard Proxy) |
|--------|----------------------------|
| BTC/USD | `0x56a43EB56Da12C0dc1D972ACb089c06a5dEF8e69` |
| ETH/USD | `0x1C352C8C42eF40F9951C5a251cb1cb0492Ec0e52` |

*(Confirm the network on the Chainlink page; these may be Arbitrum Sepolia or another chain.)*

**Steps:**

1. **Deploy the Chainlink adapter and set one feed (e.g. ETH):**
   ```bash
   cd contracts
   export PRIVATE_KEY=0x...
   export MARKET_ID=0x0000000000000000000000000000000000000001
   export CHAINLINK_FEED_ADDRESS=0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612

   forge script script/DeployChainlinkOracle.s.sol:DeployChainlinkOracle \
     --rpc-url arbitrum_one --broadcast --verify
   ```

2. **Add the market to PerpPositionManager** using the deployed adapter as `ORACLE_ADDRESS`:
   ```bash
   export PERP_MANAGER_ADDRESS=0x...   # from your main Deploy.s.sol output
   export ORACLE_ADDRESS=0x...         # ChainlinkOracleAdapter from step 1
   export MARKET_ID=0x0000000000000000000000000000000000000001
   export POOL_ID=$(cast keccak "ETH/USDC")
   export MAX_LEVERAGE=10000000000000000000
   export MAINTENANCE_MARGIN=50000000000000000

   forge script script/AddMarket.s.sol:AddMarket --rpc-url arbitrum_one --broadcast
   ```

To add more markets (e.g. BTC), call `adapter.setFeed(marketId, chainlinkBtcUsdAddress)` then run `AddMarket.s.sol` again with the new `MARKET_ID` and same `ORACLE_ADDRESS`.

---

## Option 2: Mock oracle (dev only)

For local or testnet testing without Chainlink:

- Deploy **without** skipping the oracle: do **not** set `SKIP_ORACLE_MARKET=true`. The main deploy script will deploy `MockOracleAdapter` and create one market (e.g. ETH) with a fixed price (e.g. 2800e18).
- Or deploy with `SKIP_ORACLE_MARKET=true`, then deploy `MockOracleAdapter` yourself, call `setPrice(marketId, price18dec)` and use that contract as `ORACLE_ADDRESS` in `AddMarket.s.sol`.

---

## Summary

| Goal              | What to use              | Where to get it |
|-------------------|--------------------------|------------------|
| Production prices | Chainlink                | [Chainlink Data Feeds](https://docs.chain.link/data-feeds/price-feeds/addresses) → pick network and pair |
| Dev / testing     | MockOracleAdapter        | Deploy with main script or from `test/MockOracleAdapter.sol` |

The contract you pass as **oracle** to `createMarket` must implement:

```solidity
function getPriceWithFallback(address market) external view returns (uint256);  // 18 decimals
```

`ChainlinkOracleAdapter` and `MockOracleAdapter` both satisfy this.
