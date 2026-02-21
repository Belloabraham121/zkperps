# PrivBatch Perpetuals Implementation Plan

> **5-Day Sprint: Perpetual Futures + Front-End + AI Trading Integration**

This document outlines the complete implementation plan for adding perpetual futures trading, a user-facing front-end, and AI-powered trading capabilities to PrivBatch.

---

## Table of Contents

- [Deployment Addresses (Arbitrum Sepolia)](#deployment-addresses-arbitrum-sepolia)
- [What Are Perpetual Futures?](#what-are-perpetual-futures)
- [How Perps Work With Your AMM & Private Batch](#how-perps-work-with-your-amm--private-batch)
- [What Needs to Be Built](#what-needs-to-be-built)
- [Executive Summary](#executive-summary)
- [Architecture Overview](#architecture-overview)
- [Phase 1: Perpetual Futures Layer](#phase-1-perpetual-futures-layer)
- [Phase 2: Front-End Trading Interface](#phase-2-front-end-trading-interface)
- [Phase 3: AI Trading Integration](#phase-3-ai-trading-integration)
- [Implementation Timeline](#implementation-timeline)
- [Technical Specifications](#technical-specifications)
- [Oracle Specifications](#oracle-specifications)
- [Risk Mitigation](#risk-mitigation)

---

## Deployment Addresses (Arbitrum Sepolia)

**Chain:** Arbitrum Sepolia (Chain ID: 421614)

These addresses are used by the perp e2e test (`scripts/zk/test-perp-e2e.js`), deployment scripts, and front-end. Update scripts/env when redeploying.

| Contract / Component | Address |
|----------------------|---------|
| **Uniswap V4 (protocol)** | |
| PoolManager | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` |
| Universal Router | `0xefd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47` |
| PositionManager | `0xAc631556d3d4019C95769033B5E719dD77124BAc` |
| StateView | `0x9d467fa9062b6e9b1a46e26007ad82db116c67cb` |
| Quoter | `0x7de51022d70a725b508085468052e25e22b5c4c9` |
| PoolSwapTest | `0xf3a39c86dbd13c45365e57fb90fe413371f65af8` |
| PoolModifyLiquidityTest | `0x9a8ca723f5dccb7926d00b71dec55c2fea1f50f7` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| **PrivBatch / Perps (deployed)** | |
| Groth16Verifier | `0x7fe24e07a4017b953259a79a9ee635e8eb226c11` |
| MockUSDC | `0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e` |
| MockUSDT | `0x3c604069c87256bbab9cc3ff678410275b156755` |
| PerpPositionManager | `0xf3c9cdbaf6dc303fe302fbf81465de0a057ccf5e` |
| PrivBatchHook | `0xe3ea87fb759c3206a9595048732eb6a6000700c4` |
| ChainlinkOracleAdapter | `0x991eb2241b5f2875a5cb4dbba6450b343e8216be` |
| **Pool / Market** | |
| PoolId (USDT/USDC + Hook) | `0xa2f2ba1fe0f2cf08686544d42608e24526d01ccdb7f3f52ce74cb03c4aab09d2` |
| Market ID (ETH) | `0x0000000000000000000000000000000000000001` |

**Setup notes:**
- Hook must be set as executor on PerpPositionManager: `SetExecutorOnPerpManager.s.sol`
- Hook must have `perpPositionManager` set: `SetPerpManager.s.sol`
- Pool liquidity: `SetupPoolLiquidity.s.sol` (uses HOOK, MOCK_USDC, MOCK_USDT from env)
- Add market: `AddMarket.s.sol` (uses PERP_MANAGER_ADDRESS, poolId, oracle)

**Current status (Arbitrum Sepolia):**
- ✅ Perp E2E flow working: deposit margin → submit perp commitments → submit reveals → wait batch interval → `revealAndBatchExecutePerps` → positions updated on PerpPositionManager.
- **Next:** Funding rate keeper, liquidation logic, front-end wiring to these contracts, AI trading agent.

---

## What Are Perpetual Futures?

### Simple Explanation

**Perpetual Futures (Perps)** are like betting on whether a cryptocurrency price will go up or down, but you never actually buy or sell the coin itself. Instead, you:

1. **Open a Position**: Choose to go "Long" (bet price goes up) or "Short" (bet price goes down)
2. **Use Leverage**: Control a larger position with less money (e.g., $100 controls $500 worth = 5x leverage)
3. **Profit/Loss**: If price moves in your favor, you profit. If it moves against you, you lose.
4. **No Expiry**: Unlike regular futures, perps never expire - you can hold them forever
5. **Funding Payments**: Longs and shorts pay each other periodically based on price differences

### Real-World Example

**Scenario**: ETH is currently $2,800

- **You go LONG 1 ETH** with 5x leverage:
  - You deposit $560 margin (20% of $2,800)
  - You control 1 ETH worth $2,800
  - If ETH goes to $3,000 → You profit $200 (minus fees)
  - If ETH goes to $2,600 → You lose $200

- **You go SHORT 1 ETH** with 5x leverage:
  - You deposit $560 margin
  - You bet ETH price will go DOWN
  - If ETH goes to $2,600 → You profit $200
  - If ETH goes to $3,000 → You lose $200

### Key Concepts

- **Long Position**: You profit when price goes UP
- **Short Position**: You profit when price goes DOWN
- **Leverage**: Multiply your buying power (1x = no leverage, 10x = 10x buying power)
- **Margin**: The money you deposit to open a position
- **Liquidation**: If your losses exceed your margin, your position gets automatically closed
- **Funding Rate**: Periodic payments between longs and shorts (usually every 8 hours)

---

## How Perps Work With Your AMM & Private Batch

### The Integration Flow

Your existing system already has:
1. ✅ **Uniswap V4 AMM pools** (ETH/USDC, BTC/USDC) - provides price discovery
2. ✅ **PrivBatchHook** - commit-reveal privacy + ZK proofs
3. ✅ **Batch execution** - aggregates trades, hides individual details

### How Perps Layer On Top

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: User Wants to Open Perp Position                  │
│  ────────────────────────────────────────────────────────── │
│  User: "I want to go LONG 1 ETH with 5x leverage"          │
│  System: Creates PerpIntent (hidden via commit-reveal)     │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Privacy Layer (Your Existing System)              │
│  ────────────────────────────────────────────────────────── │
│  • User commits PerpIntent hash (ZK proof)                 │
│  • User reveals PerpIntent in separate transaction         │
│  • Individual position sizes/directions HIDDEN            │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Batch Execution (Your Existing System)            │
│  ────────────────────────────────────────────────────────── │
│  • Multiple users' perp intents batched together           │
│  • Net swap executed through Uniswap V4 AMM               │
│  • AMM only sees aggregate trade, not individual positions │
│  • Positions updated in PerpPositionManager                  │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Position Tracking (NEW Perp Layer)                │
│  ────────────────────────────────────────────────────────── │
│  • PerpPositionManager stores:                             │
│    - Position size (1 ETH long)                            │
│    - Entry price ($2,800)                                  │
│    - Margin deposited ($560)                               │
│    - Leverage (5x)                                         │
│  • PnL calculated: (currentPrice - entryPrice) × size       │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: Ongoing Management (NEW Perp Layer)               │
│  ────────────────────────────────────────────────────────── │
│  • Funding rate applied every 8 hours                     │
│  • Liquidation checks (if price moves against position)    │
│  • User can close position anytime (via private batch)     │
└─────────────────────────────────────────────────────────────┘
```

### Key Integration Points

**1. Price Discovery Uses Your AMM:**
- Perp prices come from your existing Uniswap V4 pools
- No need for separate liquidity pools
- AMM provides real-time price feeds

**2. Privacy Preserved:**
- Perp opens/closes use same commit-reveal + ZK system
- Individual position sizes hidden in batch execution
- Only net aggregate visible to AMM

**3. Batch Execution Reused:**
- Same `PrivBatchHook` contract handles perp intents
- Extend `SwapIntent` to `PerpIntent`
- Same batching logic, just different intent type

**4. New Perp Layer Adds:**
- Position tracking (who has what position)
- Margin management (deposits/withdrawals)
- Funding rate calculations (oracle vs AMM price)
- Liquidation logic (auto-close if margin too low)

### Visual Example: How Privacy Works

**Without Privacy (Traditional Perps):**
```
User A opens LONG 1 ETH → Visible on-chain
User B opens SHORT 0.5 ETH → Visible on-chain
User C opens LONG 2 ETH → Visible on-chain
→ Everyone can see individual positions
```

**With Your Private Batch System:**
```
User A commits LONG 1 ETH → Hidden (only hash visible)
User B commits SHORT 0.5 ETH → Hidden (only hash visible)
User C commits LONG 2 ETH → Hidden (only hash visible)

Batch Execution:
→ Net position: +2.5 ETH (aggregate only)
→ Individual positions HIDDEN
→ AMM sees one aggregate swap
```

---

## What Needs to Be Built

### Complete Build Checklist

This section lists every component, file, and feature that needs to be implemented.

---

### 📜 **Smart Contracts (Solidity)**

#### **1. PerpPositionManager.sol** (NEW CONTRACT)
- [x] **File**: `contracts/PerpPositionManager.sol`
- [x] **Position Storage**
  - [x] `struct Position` (size, entryPrice, collateral, leverage, lastFundingPaid)
  - [x] `mapping(user => mapping(market => Position))` storage
  - [x] `mapping(market => Market)` market configuration
- [x] **Position Management Functions**
  - [x] `openPosition(user, market, size, isLong, leverage)` - Open new position
  - [x] `closePosition(user, market, size)` - Close partial/full position
  - [x] `getPosition(user, market)` - View position details
  - [x] `getUnrealizedPnL(user, market)` - Calculate profit/loss
  - [x] `getLiquidationPrice(user, market)` - Calculate liquidation threshold
- [x] **Margin Management Functions**
  - [x] `depositCollateral(user, amount)` - Add margin
  - [x] `withdrawCollateral(user, amount)` - Remove margin (with checks)
  - [x] `getAvailableMargin(user)` - Available margin for trading
  - [x] `getUsedMargin(user)` - Margin locked in positions
  - [x] `getTotalCollateral(user)` - Total deposited collateral
- [ ] **Funding Rate Functions** *(not required for current MVP or frontend UI; defer to post-MVP)*
  - [ ] `calculateFundingRate(market)` - Oracle price vs AMM price spread
  - [ ] `applyFunding(market)` - Transfer funding between longs/shorts
  - [ ] `getNextFundingTime(market)` - When next funding applies
  - [ ] `getFundingPayment(user, market)` - User's funding payment
- [ ] **Liquidation Functions** *(not required for current MVP or frontend UI; defer to post-MVP)*
  - [ ] `checkLiquidation(user, market)` - Is position liquidatable?
  - [ ] `liquidatePosition(user, market)` - Close position, take fee
  - [ ] `getInsuranceFund()` - Insurance fund balance
  - [ ] `depositToInsuranceFund(amount)` - Add to insurance fund
- [x] **Market Management**
  - [x] `createMarket(poolId, oracle, maxLeverage, maintenanceMargin)` - Add new market
  - [x] `setMaxLeverage(market, maxLeverage)` - Update max leverage
  - [x] `pauseMarket(market)` - Emergency pause
  - [x] `unpauseMarket(market)` - Resume trading

#### **2. PrivBatchHook.sol** (EXTEND EXISTING)
- [x] **File**: `contracts/PrivBatchHook.sol`
- [x] **New Data Structures**
  - [x] `struct PerpIntent` (user, market, size, isOpen, collateral, leverage, nonce, deadline)
  - [x] `mapping(bytes32 => PerpIntent)` perp reveal storage
- [x] **New Functions**
  - [x] `submitPerpCommitment(poolKey, commitmentHash)` - Commit perp intent
  - [x] `submitPerpCommitmentWithProof(...)` - Commit with ZK proof
  - [x] `submitPerpReveal(poolKey, intent)` - Reveal perp intent
  - [x] `submitPerpRevealForZK(poolKey, commitmentHash, intent)` - Reveal for ZK-verified
  - [x] `revealAndBatchExecutePerps(...)` - Batch execute perp intents
- [x] **Integration Functions**
  - [x] `_processPerpReveals(...)` - Process perp intents, update positions
  - [x] `_executePerpBatchSwap(...)` - Execute net swap through AMM
  - [x] Perp output handling (Hook settles with pool; positions updated via PerpPositionManager)

#### **3. OracleAdapter.sol** (ChainlinkOracleAdapter)
- [x] **File**: `contracts/ChainlinkOracleAdapter.sol`
- [x] **Chainlink Integration**
  - [x] `getPrice(market)` - Fetch Chainlink price (via feed per market)
  - [ ] `getPriceWithTimestamp(market)` - Price + timestamp
  - [ ] `isPriceStale(market, maxAge)` - Check if price too old
- [x] **Fallback Logic**
  - [ ] `getAMMTWAP(market, period)` - Calculate AMM TWAP if oracle fails
  - [x] `getPriceWithFallback(market)` - Try Chainlink, fallback configurable
- [ ] **Price Validation**
  - [ ] `validatePrice(price, minPrice, maxPrice)` - Sanity checks
  - [ ] `getPriceDeviation(market)` - Oracle vs AMM deviation

#### **4. Test Contracts**
- [x] **File**: `contracts/test/PerpPositionManager.t.sol`
  - [x] Test position opening/closing
  - [x] Test margin deposits/withdrawals
  - [ ] Test PnL calculations
  - [ ] Test funding rate application
  - [ ] Test liquidation logic
- [x] **File**: `contracts/test/PerpBatchExecution.t.sol`
  - [x] Test perp batch execution
  - [x] Test privacy (no position data in calldata)
  - [x] Test integration with PrivBatchHook

---

### 🤖 **Backend Agents (TypeScript)**

#### **5. Funding Rate Keeper**
- [ ] **File**: `agents/funding-keeper.ts`
- [ ] **Functions**
  - [ ] `calculateFundingRate(market)` - Fetch oracle vs AMM price
  - [ ] `applyFunding(market)` - Call contract to apply funding
  - [ ] `scheduleFunding()` - Schedule every 8 hours
  - [ ] `getFundingHistory(market)` - Historical funding rates

#### **6. Perp Trading Agent**
- [ ] **File**: `agents/perp-trading-agent.ts`
- [ ] **Functions**
  - [ ] `monitorPerpMarkets()` - Watch perp markets for opportunities
  - [ ] `evaluatePerpSignal(market)` - Decide to open/close positions
  - [ ] `submitPerpIntent(intent)` - Submit perp intent via PrivBatchHook
  - [ ] `managePositions()` - Check positions, close if needed
  - [ ] `checkLiquidationRisk()` - Monitor liquidation risk

#### **7. AI Trading Agent** (NEW)
- [ ] **File**: `agents/ai-trading-agent.ts`
- [ ] **AI SDK Integration**
  - [ ] Install Anthropic SDK or OpenAI SDK
  - [ ] Set up API keys and configuration
- [ ] **Market Data Gathering**
  - [ ] `gatherMarketContext()` - Collect all market data
  - [ ] `getHistoricalData(market, period)` - Price history
  - [ ] `getFundingRates()` - Current funding rates
  - [ ] `getPositions()` - User's current positions
- [ ] **AI Query Functions**
  - [ ] `buildTradingPrompt(context)` - Create AI prompt
  - [ ] `queryAI(prompt)` - Call AI API
  - [ ] `parseAIResponse(response)` - Parse AI decision
- [ ] **Trading Execution**
  - [ ] `executeAITrade(decision)` - Execute AI's trading decision
  - [ ] `validateAIDecision(decision)` - Safety checks
  - [ ] `logAITrade(trade)` - Record AI trades

#### **8. Market Data Aggregator**
- [ ] **File**: `agents/utils/market-data-aggregator.ts`
- [ ] **Functions**
  - [ ] `getAMMPrice(market)` - Fetch from Uniswap V4 pool
  - [ ] `getOraclePrice(market)` - Fetch from Chainlink
  - [ ] `getPriceSpread(market)` - Oracle vs AMM spread
  - [ ] `getOpenInterest(market)` - Total open interest
  - [ ] `getFundingRate(market)` - Current funding rate

#### **9. Perp History Indexer (Backend)**
Backend service that indexes on-chain perp events and stores position history, order history, and trade history so the frontend can show Order History, Position History, and Trade History tables (contracts do not expose these as view functions).

- [ ] **File**: `backend/indexer/perp-history-indexer.ts` (or equivalent in your backend)
- [ ] **Event subscription / polling**
  - [ ] Subscribe to or poll `PerpPositionManager` events: `PositionOpened`, `PositionClosed`, `PositionLiquidated`
  - [ ] Subscribe to or poll `PrivBatchHook` events: `PerpCommitmentSubmitted`, `PerpCommitmentRevealed`, `PerpBatchExecuted`
  - [ ] Associate batch executions with user positions where possible (e.g. by tx origin or indexed user in events)
- [ ] **Storage (DB)**
  - [ ] **Position history**: For each user + market, store timeline of position opens/partial closes/full closes (size, entry price, margin, leverage, timestamp, tx hash)
  - [ ] **Order history**: Store commit/reveal/batch-execute flow per user (commitment hash, reveal time, batch tx, outcome) so UI can show “orders” and their status
  - [ ] **Trade history**: Store resolved trades (user, market, size, direction, entry/exit price, realized PnL, timestamp, tx hash) derived from position changes and batch execution
- [ ] **API for frontend**
  - [ ] `GET /api/perp/position-history?user=&market=` - Position history for user (and optional market)
  - [ ] `GET /api/perp/order-history?user=` - Order history (commits, reveals, batch executions) for user
  - [ ] `GET /api/perp/trade-history?user=&market=` - Trade history (filled/closed trades) for user
- [ ] **Invariant**: On every successful perp-related transaction (position open/close, batch execute), persist the corresponding position history, order history, and trade history records so the UI always has up-to-date history.

---

### 🎨 **Front-End (Next.js + React)**

**Implementation notes:** The trading UI uses **Limit / Market / Conditional** order types and **Isolated / Cross** margin in the order panel (`OrderPanelBox.tsx`). Completed items below are checked; file names in the plan may map to current components (e.g. OrderForm → OrderPanelBox, Header → NavbarBox) as noted.

#### **9. Project Setup**
- [x] **Initialize Next.js Project**
  - [x] `npx create-next-app@latest frontend --typescript --tailwind`
  - [x] Install dependencies: `wagmi`, `viem`, `@tanstack/react-query` (TanStack Query installed)
  - [x] Install chart library: `lightweight-charts` or `recharts` (lightweight-charts)
  - [ ] Install UI components: `shadcn/ui` or `chakra-ui`
- [x] **Configuration Files**
  - [x] `frontend/next.config.js` - Next.js config (next.config.ts)
  - [x] `frontend/tailwind.config.js` - Tailwind config (Tailwind v4)
  - [x] `frontend/tsconfig.json` - TypeScript config
  - [ ] `frontend/.env.local` - Environment variables (RPC URLs, contract addresses)

#### **10. Core Layout Components**
- [x] **File**: `frontend/components/layout/Header.tsx` → **NavbarBox.tsx** (implemented)
  - [x] Logo (left)
  - [x] Trading account balance (top right)
  - [x] Profile icon with dropdown (Profile, Settings, Preferences, Sign out)
  - [ ] Wallet connection button
  - [ ] Network selector
- [ ] **File**: `frontend/components/layout/Sidebar.tsx`
  - [ ] Market selector
  - [ ] Navigation links
- [x] **File**: `frontend/components/layout/Layout.tsx` → **TradeLayout.tsx** (implemented)
  - [x] Main layout wrapper (navbar, market bar, chart area, order panel, positions)

#### **11. Trading Page Components**
- [x] **File**: `frontend/pages/trade/[market].tsx` → **app/trade/page.tsx** (single market for now)
  - [x] Main trading page
- [x] **File**: `frontend/components/trading/PriceChart.tsx** (implemented)
  - [x] Real-time candlestick chart (lightweight-charts)
  - [x] Volume bars
  - [ ] Technical indicators (optional)
  - [ ] Price updates via WebSocket or polling (mock data for now)
- [x] **File**: `frontend/components/trading/OrderForm.tsx` → **OrderPanelBox.tsx** (implemented)
  - [x] **Order type**: Limit / Market / Conditional (tabs)
  - [x] **Margin mode**: Isolated / Cross
  - [x] Long/Short (Open Long / Open Short buttons)
  - [x] Leverage slider (1x-10x)
  - [x] Size input field (+ 10%/25%/50%/75%/100% quick fill)
  - [x] Margin input field
  - [x] Take Profit / Stop Loss (optional expandable)
  - [x] "Open Long" / "Open Short" buttons
  - [x] Form validation
- [x] **File**: `frontend/components/trading/PositionCard.tsx` → **PositionsPanelBox.tsx** (table of positions)
  - [x] Display current positions (table: Symbol, Quantity, Entry, Mark, Liq, Margin, P&L, TP/SL, Close)
  - [x] Show entry price, current price (mark price)
  - [x] Show unrealized PnL (display; real-time TBD)
  - [x] Show liquidation price
  - [x] "Close Position" / "Close All" buttons
- [x] **File**: `frontend/components/trading/OrderBook.tsx` → **DepthChart.tsx** (implemented)
  - [x] Depth chart visualization (bids/asks, fill price, volume)
  - [x] Buy/sell order levels (Trade Book tab)
- [ ] **File**: `frontend/components/trading/RecentTrades.tsx`
  - [ ] Feed of recent trades
  - [ ] Real-time updates

#### **12. Portfolio Dashboard Components**
- [ ] **File**: `frontend/pages/portfolio.tsx`
  - [ ] Main portfolio page
- [x] **File**: `frontend/components/portfolio/CollateralOverview.tsx` → **AccountSummaryBox.tsx** (on trade page)
  - [x] Total collateral deposited (Equity / total collateral)
  - [x] Available margin (Available Balance)
  - [x] Used margin (Margin Health)
  - [x] Deposit/Withdraw buttons
  - [x] Trading account label, Maintenance Margin, Cross/Total leverage display
- [x] **File**: `frontend/components/portfolio/PositionsList.tsx** → **PositionsPanelBox.tsx** (Positions tab)
  - [x] Table/list of all open positions
  - [x] PnL summary (Unrealised/Realised P&L columns)
  - [x] Close position buttons
- [ ] **File**: `frontend/components/portfolio/TradeHistory.tsx`
  - [ ] History of all trades (Order History / Trade History tabs in PositionsPanelBox are placeholders)
  - [ ] Realized PnL
  - [ ] Filtering/sorting

#### **13. AI Trading Page Components**
- [ ] **File**: `frontend/pages/ai-trading.tsx`
  - [ ] Main AI trading page
- [ ] **File**: `frontend/components/ai/AIStatusPanel.tsx`
  - [ ] AI agent active/inactive status
  - [ ] Last trade time
  - [ ] Current strategy
  - [ ] Toggle on/off button
- [ ] **File**: `frontend/components/ai/AIInsights.tsx`
  - [ ] AI-generated market analysis
  - [ ] Trading signals
  - [ ] Risk warnings
- [ ] **File**: `frontend/components/ai/AITradeLog.tsx`
  - [ ] List of AI-executed trades
  - [ ] Performance metrics
  - [ ] Win rate
- [ ] **File**: `frontend/components/ai/AIConfig.tsx`
  - [ ] Strategy selection dropdown
  - [ ] Risk parameter sliders
  - [ ] Capital allocation inputs
  - [ ] Save configuration

#### **14. Web3 Integration**
- [ ] **File**: `frontend/lib/web3/config.ts`
  - [ ] Wagmi configuration
  - [ ] Chain configuration (Base Sepolia)
  - [ ] Contract addresses
- [ ] **File**: `frontend/lib/web3/hooks.ts`
  - [ ] `useWallet()` - Wallet connection hook
  - [ ] `usePerpPosition()` - Position data hook
  - [ ] `useMarketData()` - Market data hook
  - [ ] `useCollateral()` - Collateral balance hook
- [ ] **File**: `frontend/lib/web3/contracts.ts`
  - [ ] Contract ABIs
  - [ ] Contract instances
  - [ ] Contract interaction functions

#### **15. Real-Time Data Updates**
- [ ] **File**: `frontend/lib/websocket/price-feed.ts`
  - [ ] WebSocket connection to RPC
  - [ ] Subscribe to price updates
  - [ ] Update chart in real-time
- [ ] **File**: `frontend/lib/polling/position-updates.ts`
  - [ ] Poll contract for position changes
  - [ ] Update UI when batch executes
  - [ ] Refresh PnL calculations

---

### 🔗 **Integration & Configuration**

#### **16. Environment Configuration**
- [ ] **File**: `contracts/.env`
  - [ ] `PRIVATE_KEY` - Deployer private key
  - [ ] `BASE_SEPOLIA_RPC_URL` - RPC endpoint
  - [ ] `CHAINLINK_ETH_USD` - Chainlink ETH/USD address
  - [ ] `CHAINLINK_BTC_USD` - Chainlink BTC/USD address
- [ ] **File**: `agents/.env`
  - [ ] `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` - AI API key
  - [ ] `RPC_URL` - RPC endpoint
  - [ ] `PERP_POSITION_MANAGER_ADDRESS` - Deployed contract address
- [ ] **File**: `frontend/.env.local`
  - [ ] `NEXT_PUBLIC_RPC_URL` - Public RPC URL
  - [ ] `NEXT_PUBLIC_CHAIN_ID` - Chain ID (84532 for Base Sepolia)
  - [ ] `NEXT_PUBLIC_PERP_MANAGER_ADDRESS` - Contract address

#### **17. Deployment Scripts**
- [x] **File**: `contracts/script/Deploy.s.sol` (deploys PerpPositionManager, MockUSDC/USDT, Verifier, Hook; wires Hook ↔ PerpPositionManager)
- [x] **File**: `contracts/script/DeployPrivBatchHook.s.sol` (deploy Hook only, e.g. after contract changes)
- [x] **File**: `contracts/script/SetPerpManager.s.sol` (set PerpPositionManager on Hook)
- [x] **File**: `contracts/script/SetExecutorOnPerpManager.s.sol` (set Hook as executor on PerpPositionManager)
- [x] **File**: `contracts/script/SetupPoolLiquidity.s.sol` (init pool + add liquidity for USDT/USDC with Hook)
- [x] **File**: `contracts/script/AddMarket.s.sol` (create market on PerpPositionManager with poolId + oracle)
- [x] **File**: `scripts/zk/test-perp-e2e.js` (E2E: deposit → commit → reveal → wait → revealAndBatchExecutePerps → verify position)
- [ ] **File**: `contracts/script/SetupPerpMarkets.s.sol` (optional: Create BTC/USDC market, etc.)

#### **18. Documentation**
- [ ] **File**: `docs/PERPS_GUIDE.md`
  - [ ] How to use perps
  - [ ] How privacy works
  - [ ] Risk warnings
- [ ] **File**: `docs/FRONTEND_GUIDE.md`
  - [ ] How to run front-end
  - [ ] How to connect wallet
  - [ ] How to trade
- [ ] **File**: `docs/AI_TRADING_GUIDE.md`
  - [ ] How AI trading works
  - [ ] How to configure AI agent
  - [ ] Risk management

---

## Executive Summary

### Goal
Extend PrivBatch from private spot swaps to a **complete private perpetual futures trading platform** with:
1. **Perpetual futures contracts** (long/short positions with leverage)
2. **Web-based trading interface** (charts, order placement, portfolio view)
3. **AI-powered trading agents** (autonomous trading with full market access)

### Key Innovation
- **Privacy-preserving perps**: Position sizes, directions, and entry prices hidden via commit-reveal + ZK
- **AMM-based pricing**: Leverage existing Uniswap V4 pools (no new liquidity needed)
- **AI agents**: Autonomous trading with access to all market data and positions

### Timeline: 5 Days
- **Day 1-2**: Perp contracts (positions, margin, funding)
- **Day 3**: Front-end UI (trading interface, charts)
- **Day 4**: AI integration (agent access, trading logic)
- **Day 5**: Testing, demo prep, documentation

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRIVBATCH PERPS ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              FRONT-END (React/Next.js)                   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │ Trading UI  │  │ Price Charts │  │ Portfolio     │  │  │
│  │  │ (Long/Short)│  │ (TradingView)│  │ Dashboard     │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         AI TRADING LAYER (TypeScript + AI SDK)           │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │ AI Agent     │  │ Market Data  │  │ Strategy     │  │  │
│  │  │ (Claude/GPT) │  │ Aggregator  │  │ Executor     │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         ON-CHAIN (Solidity Contracts)                    │  │
│  │                                                           │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │  PerpPositionManager.sol                          │   │  │
│  │  │  ├── Position tracking (size, entry, PnL)        │   │  │
│  │  │  ├── Margin management (deposit/withdraw)        │   │  │
│  │  │  ├── Funding rate calculation                     │   │  │
│  │  │  └── Liquidation logic                            │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  │                          │                               │  │
│  │  ┌───────────────────────┴───────────────────────────┐ │  │
│  │  │  PrivBatchHook.sol (Extended for Perps)            │ │  │
│  │  │  ├── PerpIntent struct                            │ │  │
│  │  │  ├── Batch perp opens/closes                      │ │  │
│  │  │  └── Privacy via commit-reveal + ZK               │ │  │
│  │  └───────────────────────────────────────────────────┘ │  │
│  │                          │                               │  │
│  │  ┌───────────────────────┴───────────────────────────┐ │  │
│  │  │  Uniswap V4 PoolManager                            │ │  │
│  │  │  (ETH/USDC, BTC/USDC pools - REUSE EXISTING)      │ │  │
│  │  └───────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         ORACLE LAYER (Chainlink)                         │  │
│  │  ┌──────────────┐  ┌──────────────┐                    │  │
│  │  │ ETH/USD      │  │ BTC/USD      │  (Index prices)     │  │
│  │  └──────────────┘  └──────────────┘                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Perpetual Futures Layer

### 1.1 Core Perp Contract: `PerpPositionManager.sol`

**Purpose**: Track positions, manage margin, calculate funding, handle liquidations

#### Data Structures

```solidity
struct Position {
    int256 size;              // positive = long, negative = short
    uint256 entryPrice;        // AMM price when position opened
    uint256 collateral;        // margin deposited
    uint256 lastFundingPaid;   // timestamp of last funding payment
    uint256 leverage;          // 1x to 10x (configurable)
}

struct Market {
    address poolId;           // Uniswap V4 pool ID
    address indexOracle;      // Chainlink price feed
    uint256 maxLeverage;      // e.g., 10x
    uint256 maintenanceMargin; // e.g., 5% (0.05e18)
    uint256 fundingRate;      // current funding rate (8-hourly)
    bool isActive;            // market enabled/disabled
}
```

#### Key Functions

**Position Management:**
- `openPosition(user, market, size, isLong, leverage)` - Open long/short
- `closePosition(user, market, size)` - Close partial/full position
- `getPosition(user, market) returns (Position)` - View position
- `getUnrealizedPnL(user, market) returns (int256)` - Mark-to-market PnL

**Margin Management:**
- `depositCollateral(user, amount)` - Add margin
- `withdrawCollateral(user, amount)` - Remove margin (if allowed)
- `getAvailableMargin(user) returns (uint256)` - Available to trade/withdraw
- `getUsedMargin(user) returns (uint256)` - Margin locked in positions

**Funding Rate:**
- `calculateFundingRate(market) returns (int256)` - Oracle vs AMM price spread
- `applyFunding(market)` - Transfer funding between longs/shorts
- `getNextFundingTime(market) returns (uint256)` - When next funding applies

**Liquidation:**
- `checkLiquidation(user, market) returns (bool)` - Is position liquidatable?
- `liquidatePosition(user, market)` - Close position, take fee
- `getLiquidationPrice(user, market) returns (uint256)` - Price where liquidation occurs

### 1.2 Extend PrivBatchHook for Perps

**New Intent Type:**

```solidity
struct PerpIntent {
    address user;
    address market;        // ETH/USDC, BTC/USDC, etc.
    int256 size;          // positive = long, negative = short
    bool isOpen;          // true = open, false = close
    uint256 collateral;   // for opens only
    uint256 leverage;      // 1x to 10x
    uint256 nonce;
    uint256 deadline;
}
```

**Privacy Flow:**
1. User commits `PerpIntent` hash (via ZK proof)
2. User reveals `PerpIntent` in separate transaction
3. Batch execution:
   - Process all perp intents → update positions
   - Net swap through AMM (for price discovery)
   - Hide individual position sizes/directions

### 1.3 Oracle Integration

**Chainlink Price Feeds (Base Sepolia Testnet):**

| Market | Chainlink Address | Description |
|--------|------------------|-------------|
| **ETH/USD** | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` | Ethereum price feed |
| **BTC/USD** | `0x6ce185860a4963106506C203335A2910413708e9` | Bitcoin price feed |

**Note**: These are Base Sepolia testnet addresses. For mainnet, use different addresses.

**Fallback Strategy:**
- If Chainlink fails → use AMM TWAP (Time-Weighted Average Price)
- Circuit breaker: pause markets if oracle stale > 1 hour
- Maximum price deviation: 5% (if oracle deviates >5% from AMM, use AMM price)

### 1.4 Funding Rate Keeper

**Agent Script:** `agents/funding-keeper.ts`

- Runs every 8 hours (standard perp funding period)
- Fetches oracle price vs AMM price
- Calculates funding rate: `(oraclePrice - ammPrice) / ammPrice`
- Calls `applyFunding()` on contract
- Transfers funding payments between longs/shorts

---

## Phase 2: Front-End Trading Interface

### 2.1 Tech Stack

- **Framework**: Next.js 14 (React + TypeScript)
- **Styling**: Tailwind CSS + shadcn/ui components
- **Charts**: TradingView Lightweight Charts or Chart.js
- **Web3**: wagmi + viem (Ethereum interaction)
- **State Management**: Zustand or React Query

### 2.2 Core Pages/Components

#### **Trading Page** (`/trade/[market]`)

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  Header: ETH/USDC Perpetual | 24h Volume | OI      │
├─────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌────────────────────────┐ │
│  │                  │  │  Order Form            │ │
│  │  Price Chart     │  │  ┌────────────────────┐ │ │
│  │  (TradingView)   │  │  │ Long / Short Tabs  │ │ │
│  │                  │  │  ├────────────────────┤ │ │
│  │  - Candlesticks  │  │  │ Leverage: [1x-10x] │ │ │
│  │  - Volume        │  │  │ Size: [____]        │ │ │
│  │  - Indicators    │  │  │ Margin: [____]     │ │ │
│  │                  │  │  ├────────────────────┤ │ │
│  │                  │  │  │ [Open Long]        │ │ │
│  │                  │  │  │ [Open Short]       │ │ │
│  └──────────────────┘  └────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌────────────────────────┐ │
│  │ Order Book       │  │  Positions             │ │
│  │ (Depth Chart)    │  │  ┌────────────────────┐ │ │
│  └──────────────────┘  │  │ ETH/USDC Long      │ │ │
│                         │  │ Size: 1.5 ETH      │ │ │
│  ┌──────────────────┐  │  │ Entry: $2,850      │ │ │
│  │ Recent Trades    │  │  │ PnL: +$45.20       │ │ │
│  │ (Feed)           │  │  │ [Close]            │ │ │
│  └──────────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Features:**
- Real-time price chart (candlesticks, volume)
- Order form: Long/Short, Leverage slider (1x-10x), Size input, Margin input
- Position display: Current positions, Unrealized PnL, Liquidation price
- Order book visualization (depth chart)
- Recent trades feed

#### **Portfolio Dashboard** (`/portfolio`)

**Components:**
- **Collateral Overview**: Total deposited, Available margin, Used margin
- **Active Positions**: All open positions across markets, PnL summary
- **Trade History**: Past trades, Realized PnL
- **Funding Payments**: History of funding received/paid

#### **AI Trading Page** (`/ai-trading`)

**Components:**
- **AI Agent Status**: Active/Inactive, Current strategy
- **Agent Configuration**: Strategy selection, Risk parameters, Capital allocation
- **AI Trade History**: Trades executed by AI, Performance metrics
- **Market Analysis**: AI-generated insights, Signal explanations

### 2.3 Real-Time Price Charts & Data

#### **Chart Library: TradingView Lightweight Charts**

**Why TradingView Lightweight Charts:**
- ✅ Free and open-source
- ✅ High performance (handles 1M+ data points)
- ✅ Real-time updates support
- ✅ Multiple chart types (candlesticks, line, area)
- ✅ Built-in indicators (volume, moving averages)
- ✅ Mobile responsive

**Implementation:**

```typescript
// frontend/components/trading/PriceChart.tsx
import { createChart, ColorType, IChartApi } from 'lightweight-charts';

const PriceChart = ({ market }: { market: string }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    // Create chart
    const chartInstance = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a1a' },
        textColor: '#d1d5db',
      },
      width: chartContainerRef.current.clientWidth,
      height: 500,
      grid: {
        vertLines: { color: '#2a2a2a' },
        horzLines: { color: '#2a2a2a' },
      },
    });
    
    // Add candlestick series
    const candlestickSeries = chartInstance.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    
    // Add volume series
    const volumeSeries = chartInstance.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    
    setChart(chartInstance);
    
    // Subscribe to real-time price updates
    const ws = new WebSocket('wss://your-rpc-websocket');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'price_update') {
        candlestickSeries.update({
          time: data.timestamp,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
        });
        volumeSeries.update({
          time: data.timestamp,
          value: data.volume,
        });
      }
    };
    
    return () => {
      ws.close();
      chartInstance.remove();
    };
  }, [market]);
  
  return <div ref={chartContainerRef} className="w-full h-[500px]" />;
};
```

#### **Real-Time Data Sources**

**1. Price Updates (WebSocket):**
- [ ] Set up WebSocket connection to RPC provider (Alchemy, Infura)
- [ ] Subscribe to Uniswap V4 pool swap events
- [ ] Parse swap events → extract price data
- [ ] Update chart every time price changes
- [ ] Fallback to polling if WebSocket fails

**2. Position Updates (Polling):**
- [ ] Poll `PerpPositionManager.getPosition()` every 5 seconds
- [ ] Update position card when PnL changes
- [ ] Update liquidation price warnings
- [ ] Refresh after batch execution events

**3. Market Data (API Endpoints):**
- [ ] Create API route: `frontend/pages/api/markets/[market]/price.ts`
- [ ] Fetch from contract: `getAMMPrice(market)`
- [ ] Cache for 1 second to reduce RPC calls
- [ ] Return JSON: `{ price: "2850.50", timestamp: 1234567890 }`

**4. Funding Rate Updates:**
- [ ] Poll `PerpPositionManager.getFundingRate(market)` every hour
- [ ] Display current funding rate in UI
- [ ] Show next funding time countdown
- [ ] Alert user when funding rate changes significantly

#### **Chart Features to Implement**

- [ ] **Candlestick Chart**: OHLC (Open, High, Low, Close) bars
- [ ] **Volume Bars**: Trading volume below price chart
- [ ] **Time Range Selector**: 1h, 4h, 1d, 1w, 1m buttons
- [ ] **Price Crosshair**: Hover to see exact price at timestamp
- [ ] **Zoom/Pan**: Users can zoom into specific time periods
- [ ] **Indicators** (Optional):
  - [ ] Moving Average (MA) lines
  - [ ] RSI (Relative Strength Index)
  - [ ] MACD (Moving Average Convergence Divergence)

### 2.4 Key Features

**Real-Time Updates:**
- ✅ WebSocket connection to RPC for price updates
- ✅ Poll contract events for position changes
- ✅ Update UI when batch executes
- ✅ Live PnL calculations (updates every few seconds)

**Wallet Integration:**
- ✅ Connect wallet (MetaMask, WalletConnect)
- ✅ Approve token spending
- ✅ Deposit/withdraw collateral
- ✅ Sign transactions for perp intents
- ✅ Transaction status tracking

**Privacy Indicators:**
- ✅ Show "Private Trade" badge on orders
- ✅ Explain commit-reveal flow to users
- ✅ Display batch execution status
- ✅ Show "Position Hidden" indicator

---

## Phase 3: AI Trading Integration

### 3.1 AI Agent Architecture

**Core Concept**: AI agent (Claude/GPT-4) has access to:
- All market data (prices, volume, funding rates)
- User's portfolio (positions, PnL, margin)
- Historical data (price history, trade patterns)
- Can execute trades autonomously via the same privacy layer

### 3.2 AI Agent Implementation

#### **Agent Structure:** `agents/ai-trading-agent.ts`

```typescript
class AITradingAgent {
  // AI SDK (Anthropic Claude or OpenAI GPT-4)
  private aiClient: Anthropic | OpenAI;
  
  // Market data access
  private marketDataFetcher: MarketDataFetcher;
  
  // Portfolio access
  private portfolioManager: PortfolioManager;
  
  // Trading execution
  private privBatchClient: PrivBatchHookClient;
  
  async analyzeAndTrade() {
    // 1. Gather market context
    const context = await this.gatherMarketContext();
    
    // 2. Query AI for trading decision
    const decision = await this.queryAI(context);
    
    // 3. Execute trade if AI recommends
    if (decision.shouldTrade) {
      await this.executeTrade(decision);
    }
  }
  
  private async gatherMarketContext(): Promise<MarketContext> {
    return {
      currentPrices: await this.marketDataFetcher.getPrices(),
      fundingRates: await this.getFundingRates(),
      positions: await this.portfolioManager.getPositions(),
      historicalData: await this.getHistoricalData(),
      marketSentiment: await this.analyzeSentiment(),
    };
  }
  
  private async queryAI(context: MarketContext): Promise<TradeDecision> {
    const prompt = this.buildTradingPrompt(context);
    const response = await this.aiClient.messages.create({
      model: "claude-3-5-sonnet-20241022",
      messages: [{
        role: "user",
        content: prompt
      }]
    });
    
    return this.parseAIResponse(response);
  }
}
```

### 3.3 AI Prompt Engineering

**Trading Prompt Template:**

```
You are an expert cryptocurrency trader with access to a private perpetual futures 
trading platform. Analyze the following market data and make a trading decision.

MARKET DATA:
- Current ETH Price: $2,850 (AMM) vs $2,855 (Oracle)
- Funding Rate: 0.01% (8h) - longs pay shorts
- 24h Volume: $5.2M
- Open Interest: $12M
- Your Current Positions:
  * ETH/USDC Long: 1.5 ETH @ $2,800 (PnL: +$75)

HISTORICAL CONTEXT:
- Price moved +3% in last 24h
- Funding rate has been positive for 2 days (longs paying shorts)
- Volume is above average

RISK PARAMETERS:
- Max leverage: 5x
- Max position size: 2 ETH
- Stop loss: 5%
- Take profit: 10%

TASK:
1. Analyze the market conditions
2. Decide: Open Long, Open Short, Close Position, or Hold
3. If trading: specify size, leverage, and reasoning

Respond in JSON format:
{
  "action": "open_long" | "open_short" | "close_position" | "hold",
  "size": number,
  "leverage": number (1-5),
  "reasoning": "string explaining decision"
}
```

### 3.4 AI Agent Features

**Market Analysis:**
- Price trend analysis
- Funding rate arbitrage opportunities
- Volatility patterns
- Cross-market correlations

**Risk Management:**
- Position sizing based on volatility
- Stop-loss recommendations
- Leverage adjustments
- Portfolio rebalancing

**Strategy Execution:**
- Momentum trading
- Mean reversion
- Funding rate arbitrage
- News/sentiment trading (if API available)

### 3.5 AI Agent UI Integration

**Dashboard Components:**
- **AI Status Panel**: Agent active/inactive, Last trade time, Current strategy
- **AI Insights**: Market analysis, Trading signals, Risk warnings
- **AI Trade Log**: All AI-executed trades, Performance metrics, Win rate
- **Configuration**: Enable/disable AI, Set risk parameters, Allocate capital

**User Controls:**
- Toggle AI trading on/off
- Set max leverage for AI
- Set max position size
- Approve AI trades (optional: manual approval mode)

---

## Implementation Timeline

### **Day 1: Perp Contracts (Core)**

**Morning:**
- [ ] Create `PerpPositionManager.sol`
- [ ] Implement Position struct and storage
- [ ] Implement `openPosition()` and `closePosition()`
- [ ] Basic margin checks

**Afternoon:**
- [ ] Implement `depositCollateral()` and `withdrawCollateral()`
- [ ] Implement `getUnrealizedPnL()` (mark-to-market)
- [ ] Write Foundry tests for position management

**Deliverable**: Core perp contract with position tracking

---

### **Day 2: Perp Contracts (Funding & Liquidation)**

**Morning:**
- [ ] Integrate Chainlink oracle
- [ ] Implement `calculateFundingRate()`
- [ ] Implement `applyFunding()` (transfer between longs/shorts)
- [ ] Create funding keeper agent script

**Afternoon:**
- [ ] Implement liquidation checks (`checkLiquidation()`)
- [ ] Implement `liquidatePosition()` with fee mechanism
- [ ] Create insurance fund
- [ ] Write tests for funding and liquidation

**Deliverable**: Complete perp contract with funding and liquidation

---

### **Day 3: Front-End UI**

**Morning:**
- [ ] Set up Next.js project with TypeScript
- [ ] Install dependencies (wagmi, viem, TradingView charts)
- [ ] Create layout components (Header, Sidebar)
- [ ] Set up wallet connection

**Afternoon:**
- [ ] Build Trading Page:
  - [ ] Price chart component
  - [ ] Order form (Long/Short, Leverage, Size)
  - [ ] Position display
- [ ] Build Portfolio Dashboard:
  - [ ] Collateral overview
  - [ ] Active positions list
  - [ ] Trade history

**Deliverable**: Functional trading UI

---

### **Day 4: AI Integration**

**Morning:**
- [ ] Set up AI SDK (Anthropic Claude or OpenAI)
- [ ] Create `AITradingAgent` class
- [ ] Implement market data gathering
- [ ] Build AI prompt template

**Afternoon:**
- [ ] Implement AI query and response parsing
- [ ] Connect AI agent to PrivBatchHook client
- [ ] Add AI trading UI components
- [ ] Test AI agent end-to-end

**Deliverable**: AI agent trading autonomously

---

### **Day 5: Integration & Demo Prep**

**Morning:**
- [ ] Integrate perp contracts with PrivBatchHook
- [ ] Extend commit-reveal for PerpIntent
- [ ] Test full flow: Front-end → AI → Contract → Batch execution
- [ ] Fix bugs and edge cases

**Afternoon:**
- [ ] Create demo script
- [ ] Write documentation
- [ ] Prepare presentation slides
- [ ] Record demo video

**Deliverable**: Complete system ready for demo

---

## Technical Specifications

### Contract Interfaces

**PerpPositionManager.sol:**
```solidity
interface IPerpPositionManager {
    function openPosition(
        address user,
        address market,
        int256 size,
        bool isLong,
        uint256 leverage
    ) external;
    
    function closePosition(
        address user,
        address market,
        uint256 size
    ) external;
    
    function depositCollateral(address user, uint256 amount) external;
    function withdrawCollateral(address user, uint256 amount) external;
    
    function getPosition(address user, address market) 
        external view returns (Position memory);
    
    function getUnrealizedPnL(address user, address market) 
        external view returns (int256);
    
    function applyFunding(address market) external;
    function liquidatePosition(address user, address market) external;
}
```

### Front-End API Structure

**Trading API:**
```typescript
// Market data
GET /api/markets/:market/price
GET /api/markets/:market/funding-rate
GET /api/markets/:market/open-interest

// Positions
GET /api/positions
POST /api/positions/open
POST /api/positions/close

// Collateral
POST /api/collateral/deposit
POST /api/collateral/withdraw
GET /api/collateral/balance
```

### AI Agent Configuration

**Config File:** `agents/ai-config.json`
```json
{
  "enabled": true,
  "model": "claude-3-5-sonnet-20241022",
  "maxLeverage": 5,
  "maxPositionSize": "2.0",
  "riskTolerance": "moderate",
  "markets": ["ETH/USDC", "BTC/USDC"],
  "strategy": "momentum",
  "capitalAllocation": {
    "ETH/USDC": 0.6,
    "BTC/USDC": 0.4
  }
}
```

---

## Oracle Specifications

### Chainlink Oracle Integration

#### **Why Chainlink?**

- ✅ **Reliable**: Industry-standard oracle network
- ✅ **Decentralized**: Multiple data sources aggregated
- ✅ **Secure**: Cryptographically signed price feeds
- ✅ **Available on Base Sepolia**: Testnet support for development

#### **Oracle Contract: `OracleAdapter.sol`**

**Purpose**: Fetch prices from Chainlink with fallback to AMM TWAP

**Implementation:**

```solidity
// contracts/OracleAdapter.sol
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract OracleAdapter {
    // Chainlink price feed addresses (Base Sepolia)
    mapping(address => address) public priceFeeds; // market => Chainlink address
    
    // ETH/USD: 0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1
    // BTC/USD: 0x6ce185860a4963106506C203335A2910413708e9
    
    function getPrice(address market) external view returns (uint256) {
        address feedAddress = priceFeeds[market];
        require(feedAddress != address(0), "Market not configured");
        
        AggregatorV3Interface priceFeed = AggregatorV3Interface(feedAddress);
        
        (
            uint80 roundId,
            int256 price,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();
        
        // Validate price
        require(price > 0, "Invalid price");
        require(updatedAt > 0, "Price not updated");
        require(block.timestamp - updatedAt <= 3600, "Price stale"); // 1 hour max
        
        return uint256(price);
    }
    
    function getPriceWithFallback(address market) external view returns (uint256) {
        try this.getPrice(market) returns (uint256 price) {
            return price;
        } catch {
            // Fallback to AMM TWAP
            return getAMMTWAP(market, 3600); // 1 hour TWAP
        }
    }
    
    function getAMMTWAP(address market, uint256 period) internal view returns (uint256) {
        // Calculate Time-Weighted Average Price from Uniswap V4 pool
        // Implementation: Query pool observations, calculate TWAP
        // This is a simplified version - full implementation needed
    }
}
```

#### **Oracle Setup Steps**

1. **Install Chainlink Contracts:**
   ```bash
   cd contracts
   forge install smartcontractkit/chainlink-brownie-contracts --no-commit
   ```

2. **Configure Price Feeds:**
   ```solidity
   // In deployment script
   oracleAdapter.setPriceFeed(
       address(ethMarket),
       0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1 // ETH/USD
   );
   ```

3. **Test Oracle:**
   ```bash
   # Test fetching ETH price
   cast call $ORACLE_ADAPTER "getPrice(address)(uint256)" $ETH_MARKET
   ```

#### **Oracle Usage in Perp Contracts**

**Funding Rate Calculation:**
```solidity
function calculateFundingRate(address market) external view returns (int256) {
    uint256 oraclePrice = oracleAdapter.getPriceWithFallback(market);
    uint256 ammPrice = getAMMPrice(market);
    
    // Funding rate = (oraclePrice - ammPrice) / ammPrice
    // Positive = longs pay shorts
    // Negative = shorts pay longs
    int256 spread = int256(oraclePrice) - int256(ammPrice);
    return (spread * 1e18) / int256(ammPrice);
}
```

**Liquidation Checks:**
```solidity
function checkLiquidation(address user, address market) external view returns (bool) {
    Position memory pos = positions[user][market];
    uint256 currentPrice = oracleAdapter.getPriceWithFallback(market);
    
    // Calculate PnL
    int256 pnL = calculatePnL(pos, currentPrice);
    
    // Check if margin is below maintenance threshold
    uint256 marginRatio = (pos.collateral * 1e18) / (pos.size * currentPrice);
    return marginRatio < markets[market].maintenanceMargin;
}
```

#### **Oracle Monitoring**

**Agent Script:** `agents/oracle-monitor.ts`

- [ ] Monitor oracle staleness (check `updatedAt` timestamp)
- [ ] Alert if oracle price deviates >5% from AMM price
- [ ] Pause markets if oracle fails for >1 hour
- [ ] Log oracle price updates for debugging

---

## Risk Mitigation

### Smart Contract Risks

**Liquidation Risk:**
- ✅ Implement circuit breakers (pause if oracle fails)
- ✅ Set conservative maintenance margin (5-10%)
- ✅ Insurance fund for bad debt

**Oracle Risk:**
- ✅ Chainlink price feeds (reliable)
- ✅ Fallback to AMM TWAP
- ✅ Staleness checks (revert if > 1 hour old)

**Privacy Risk:**
- ✅ Reuse existing ZK proof system
- ✅ Batch execution hides individual trades
- ✅ No position data in calldata

### Front-End Risks

**UX Risk:**
- ✅ Clear warnings for leverage
- ✅ Show liquidation price prominently
- ✅ Confirmation dialogs for large trades

**Wallet Risk:**
- ✅ Support multiple wallets (MetaMask, WalletConnect)
- ✅ Clear transaction status
- ✅ Error handling for failed transactions

### AI Agent Risks

**Trading Risk:**
- ✅ Set max leverage limits
- ✅ Set max position size
- ✅ Require manual approval for large trades (optional)
- ✅ Monitor AI performance and pause if losses exceed threshold

**API Risk:**
- ✅ Handle AI API failures gracefully (fallback to rule-based)
- ✅ Rate limiting for AI queries
- ✅ Cache AI responses to reduce API calls

---

## Success Metrics

### Technical Metrics
- ✅ Perp contracts deployed and tested
- ✅ Front-end functional with charts
- ✅ AI agent executes trades autonomously
- ✅ Privacy preserved (no position data in calldata)

### Demo Metrics
- ✅ Can open/close perp positions via UI
- ✅ AI agent makes trading decisions
- ✅ Batch execution hides individual trades
- ✅ Smooth user experience

---

## Next Steps

1. **Review this plan** with team
2. **Set up development environment** (Foundry, Node.js, Next.js)
3. **Start Day 1**: Create `PerpPositionManager.sol`
4. **Daily standups**: Track progress, adjust timeline if needed
5. **Demo prep**: Prepare presentation and video

---

## Phase 4: Backend API & Authentication

### 4.1 Architecture Overview

**Flow:**
```
Front-End (React/Next.js)
    ↓ (API calls with auth token)
Backend API (Node.js/Express)
    ↓ (Server-side Privy SDK)
Privy Wallet Infrastructure
    ↓ (Signs transactions)
Smart Contracts (Base Sepolia)
```

**Why Backend?**
- ✅ Centralized authentication
- ✅ Secure Privy API key management (never exposed to front-end)
- ✅ Server-side wallet creation and management
- ✅ Rate limiting and security controls
- ✅ Transaction batching and optimization
- ✅ Analytics and monitoring

### 4.2 Backend Tech Stack

**Recommended:**
- **Framework**: Express.js (Node.js) or FastAPI (Python)
- **Database**: PostgreSQL or MongoDB (for user data, not wallet keys)
- **Authentication**: JWT tokens or session-based
- **Privy SDK**: `@privy-io/server-auth` (server-side)
- **API**: RESTful API or GraphQL

### 4.3 Authentication System

#### **User Authentication Flow:**

```
1. User signs up/logs in via front-end
   ↓
2. Front-end sends credentials to backend
   ↓
3. Backend validates credentials
   ↓
4. Backend creates/gets Privy user
   ↓
5. Backend creates/gets Privy wallet for user
   ↓
6. Backend returns JWT token + wallet address to front-end
   ↓
7. Front-end stores token, uses it for all API calls
```

#### **Implementation:**

**Backend Auth Endpoints:**
- [ ] `POST /api/auth/register` - Create new user account
- [ ] `POST /api/auth/login` - Login user
- [ ] `POST /api/auth/logout` - Logout user
- [ ] `GET /api/auth/me` - Get current user info
- [ ] `POST /api/auth/refresh` - Refresh JWT token

**Database Schema:**
```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  privy_user_id VARCHAR(255), -- Privy user ID
  privy_wallet_address VARCHAR(255), -- Privy wallet address
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Sessions table (for JWT)
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  token VARCHAR(255),
  expires_at TIMESTAMP,
  created_at TIMESTAMP
);
```

### 4.5 Implemented: Privy email login + server-side signing (no popup)

**Backend** (`backend/`) is implemented with:

- **Auth**: Email sign-in via Privy. Frontend gets a Privy access token; backend verifies it and returns a JWT (+ `signerId` for adding the server as signer).
- **Server signing**: Backend is added as an **app signer** (key quorum) on the user’s embedded wallet. All transactions are sent from the backend via Privy’s API using the app’s authorization key — **no approval popup** for the user.
- **Endpoints**: `POST /api/auth/verify-token`, `POST /api/auth/link`, `GET /api/auth/me`, `POST /api/trade/send`.

**Frontend flow:**

1. **Privy React**: Use `@privy-io/react-auth` with email login. Set `embeddedWallets.ethereum.createOnLogin: 'all-users'`.
2. **After login**: Call `POST /api/auth/verify-token` with `{ accessToken }` (from `getAccessToken()`). If the response has `token`, store it and you’re done. If it says to link, continue.
3. **Add server as signer**: Call `addSigners({ address: user.wallet.address, signers: [{ signerId: response.signerId, policyIds: [] }] })` (from `useSigners()`).
4. **Link wallet**: Call `POST /api/auth/link` with `{ accessToken, walletAddress: user.wallet.address, walletId }`. Store the returned JWT.
5. **Trading**: Use `Authorization: Bearer <jwt>` and call backend APIs (e.g. `POST /api/trade/send` with `{ to, value?, data? }`). No wallet popup; backend signs and submits.

See **`backend/README.md`** for env setup (Privy app ID/secret, authorization key, key quorum ID) and API details.

### 4.4 Privy Wallet Integration via Backend

#### **Backend Privy Setup:**

```typescript
// backend/lib/privy.ts
import { PrivyClient } from '@privy-io/node';

export const privyClient = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET,
});

/**
 * Create or get Privy wallet for user
 */
export async function getOrCreateUserWallet(userId: string) {
  // Check if user already has wallet in database
  const user = await db.users.findByPk(userId);
  
  if (user.privy_wallet_address) {
    return {
      walletAddress: user.privy_wallet_address,
      privyUserId: user.privy_user_id,
    };
  }
  
  // Create Privy user and wallet
  const privyUser = await privyClient.users.create({
    linkedAccounts: [], // Can link email, phone, etc.
  });
  
  const wallet = await privyClient.wallets.create({
    userId: privyUser.id,
    chainId: 84532, // Base Sepolia
  });
  
  // Save to database
  await db.users.update({
    privy_user_id: privyUser.id,
    privy_wallet_address: wallet.address,
  }, {
    where: { id: userId }
  });
  
  return {
    walletAddress: wallet.address,
    privyUserId: privyUser.id,
  };
}
```

### 4.5 Backend API Endpoints

#### **Wallet Management Endpoints:**

- [ ] `GET /api/wallet/address` - Get user's wallet address
- [ ] `GET /api/wallet/balance` - Get wallet balance (USDC, USDT)
- [ ] `POST /api/wallet/deposit` - Deposit collateral to perp contract
- [ ] `POST /api/wallet/withdraw` - Withdraw collateral from perp contract

#### **Trading Endpoints:**

- [ ] `POST /api/trade/commit` - Submit perp commitment (via Privy wallet)
- [ ] `POST /api/trade/reveal` - Submit perp reveal (via Privy wallet)
- [ ] `POST /api/trade/close-position` - Close perp position (via Privy wallet)
- [ ] `GET /api/trade/positions` - Get user's open positions (can read from contract)
- [ ] `GET /api/trade/history` - Get trade history (sourced from **Perp History Indexer**, §9)
- [ ] `GET /api/trade/order-history` - Get order history (sourced from **Perp History Indexer**, §9)
- [ ] `GET /api/trade/position-history` - Get position history (sourced from **Perp History Indexer**, §9)

#### **Market Data Endpoints:**

- [ ] `GET /api/markets` - List all available markets
- [ ] `GET /api/markets/:market/price` - Get current price
- [ ] `GET /api/markets/:market/funding-rate` - Get funding rate
- [ ] `GET /api/markets/:market/open-interest` - Get open interest

#### **AI Trading Endpoints:**

- [ ] `POST /api/ai/enable` - Enable AI trading for user
- [ ] `POST /api/ai/disable` - Disable AI trading
- [ ] `GET /api/ai/status` - Get AI agent status
- [ ] `GET /api/ai/trades` - Get AI trade history
- [ ] `POST /api/ai/config` - Update AI trading config

### 4.6 Backend Implementation Details

#### **Example: Submit Perp Commitment Endpoint**

```typescript
// backend/routes/trade.ts
import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { privyClient } from '../lib/privy';
import { getOrCreateUserWallet } from '../lib/privy';

const router = express.Router();

/**
 * POST /api/trade/commit
 * Submit perp commitment via Privy wallet
 */
router.post('/commit', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // From JWT token
    const { poolKey, commitmentHash, zkProof } = req.body;
    
    // Get user's Privy wallet
    const { walletAddress, privyUserId } = await getOrCreateUserWallet(userId);
    
    // Submit commitment via Privy wallet
    const tx = await privyClient.wallets.sendTransaction({
      walletId: privyUserId,
      to: HOOK_ADDRESS,
      data: encodeCommitmentCalldata(poolKey, commitmentHash, zkProof),
    });
    
    // Wait for transaction
    const receipt = await tx.wait();
    
    res.json({
      success: true,
      txHash: receipt.hash,
      walletAddress,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

#### **Example: Get Positions Endpoint**

```typescript
/**
 * GET /api/trade/positions
 * Get user's open positions
 */
router.get('/positions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { walletAddress } = await getOrCreateUserWallet(userId);
    
    // Query PerpPositionManager contract
    const positions = await perpContract.getUserPositions(walletAddress);
    
    res.json({
      success: true,
      positions: positions.map(pos => ({
        market: pos.market,
        size: pos.size.toString(),
        entryPrice: pos.entryPrice.toString(),
        unrealizedPnL: pos.unrealizedPnL.toString(),
        leverage: pos.leverage,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 4.7 Front-End Integration with Backend

#### **API Client:**

```typescript
// frontend/lib/api/client.ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

class APIClient {
  private token: string | null = null;
  
  setToken(token: string) {
    this.token = token;
  }
  
  private async request(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  // Auth endpoints
  async register(email: string, password: string) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }
  
  async login(email: string, password: string) {
    const result = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(result.token);
    return result;
  }
  
  // Trading endpoints
  async submitCommitment(poolKey: any, commitmentHash: string, zkProof: any) {
    return this.request('/api/trade/commit', {
      method: 'POST',
      body: JSON.stringify({ poolKey, commitmentHash, zkProof }),
    });
  }
  
  async getPositions() {
    return this.request('/api/trade/positions');
  }
}

export const apiClient = new APIClient();
```

#### **Front-End Usage:**

```typescript
// frontend/components/trading/OrderForm.tsx
import { apiClient } from '@/lib/api/client';

const OrderForm = () => {
  const handleOpenPosition = async () => {
    // Backend handles Privy wallet, no front-end Privy code needed!
    const result = await apiClient.submitCommitment(
      poolKey,
      commitmentHash,
      zkProof
    );
    
    console.log('Transaction submitted:', result.txHash);
  };
  
  return (
    <button onClick={handleOpenPosition}>
      Open Position
    </button>
  );
};
```

### 4.8 Backend Security & Best Practices

#### **Security Measures:**

- [ ] **JWT Token Validation**: Verify tokens on every request
- [ ] **Rate Limiting**: Limit API calls per user (e.g., 100 req/min)
- [ ] **Input Validation**: Validate all request data
- [ ] **CORS Configuration**: Allow only front-end domain
- [ ] **Environment Variables**: Store Privy secrets securely
- [ ] **Error Handling**: Don't expose sensitive errors
- [ ] **Logging**: Log all transactions for audit

#### **Privy API Key Security:**

```typescript
// backend/.env (NEVER commit this!)
PRIVY_APP_ID=your_app_id
PRIVY_APP_SECRET=your_app_secret  // Server-side only!

// backend/lib/privy.ts
// Only use Privy client on server-side
// Never expose secrets to front-end
```

### 4.9 Backend Implementation Checklist

#### **Project Setup:**

- [ ] Initialize Node.js/Express project
- [ ] Install dependencies:
  - [ ] `express`
  - [ ] `@privy-io/server-auth`
  - [ ] `jsonwebtoken`
  - [ ] `bcrypt` (for password hashing)
  - [ ] `pg` or `mongodb` (database)
  - [ ] `dotenv` (environment variables)
- [ ] Set up database (PostgreSQL or MongoDB)
- [ ] Configure environment variables

#### **Authentication:**

- [ ] Create user registration endpoint
- [ ] Create user login endpoint
- [ ] Implement JWT token generation
- [ ] Create authentication middleware
- [ ] Set up password hashing
- [ ] Create session management

#### **Privy Integration:**

- [ ] Set up Privy client (server-side)
- [ ] Create `getOrCreateUserWallet()` function
- [ ] Implement wallet creation on user registration
- [ ] Test Privy wallet creation on Base Sepolia

#### **API Endpoints:**

- [ ] **Auth Endpoints:**
  - [ ] `POST /api/auth/register`
  - [ ] `POST /api/auth/login`
  - [ ] `POST /api/auth/logout`
  - [ ] `GET /api/auth/me`

- [ ] **Wallet Endpoints:**
  - [ ] `GET /api/wallet/address`
  - [ ] `GET /api/wallet/balance`
  - [ ] `POST /api/wallet/deposit`
  - [ ] `POST /api/wallet/withdraw`

- [ ] **Trading Endpoints:**
  - [ ] `POST /api/trade/commit`
  - [ ] `POST /api/trade/reveal`
  - [ ] `POST /api/trade/close-position`
  - [ ] `GET /api/trade/positions`
  - [ ] `GET /api/trade/history`

- [ ] **Market Data Endpoints:**
  - [ ] `GET /api/markets`
  - [ ] `GET /api/markets/:market/price`
  - [ ] `GET /api/markets/:market/funding-rate`
  - [ ] `GET /api/markets/:market/open-interest`

- [ ] **AI Trading Endpoints:**
  - [ ] `POST /api/ai/enable`
  - [ ] `POST /api/ai/disable`
  - [ ] `GET /api/ai/status`
  - [ ] `GET /api/ai/trades`
  - [ ] `POST /api/ai/config`

#### **Testing:**

- [ ] Test user registration/login
- [ ] Test Privy wallet creation
- [ ] Test trading endpoints
- [ ] Test authentication middleware
- [ ] Test error handling
- [ ] Load testing (rate limits)

#### **Deployment:**

- [ ] Set up backend hosting (Railway, Render, AWS, etc.)
- [ ] Configure environment variables on server
- [ ] Set up database on server
- [ ] Configure CORS for front-end domain
- [ ] Set up monitoring and logging

### 4.10 Backend Project Structure

```
backend/
├── src/
│   ├── routes/
│   │   ├── auth.ts          # Authentication routes
│   │   ├── wallet.ts        # Wallet management routes
│   │   ├── trade.ts         # Trading routes
│   │   ├── markets.ts       # Market data routes
│   │   └── ai.ts            # AI trading routes
│   ├── middleware/
│   │   ├── auth.ts          # JWT authentication middleware
│   │   ├── rateLimit.ts     # Rate limiting middleware
│   │   └── errorHandler.ts  # Error handling middleware
│   ├── lib/
│   │   ├── privy.ts         # Privy client setup
│   │   ├── database.ts      # Database connection
│   │   └── contracts.ts     # Contract interaction helpers
│   ├── models/
│   │   ├── User.ts          # User model
│   │   └── Session.ts       # Session model
│   └── app.ts               # Express app setup
├── .env                     # Environment variables (not committed)
├── package.json
└── tsconfig.json
```

---

## Questions & Decisions Needed

- [ ] Which AI model? (Claude vs GPT-4)
- [ ] Max leverage? (Recommend: 5x for hackathon)
- [ ] Which markets? (Recommend: ETH/USDC, BTC/USDC)
- [ ] Front-end framework? (Recommend: Next.js)
- [ ] Chart library? (Recommend: TradingView Lightweight Charts)
- [ ] **Backend framework?** (Recommend: Express.js with TypeScript)
- [ ] **Database?** (Recommend: PostgreSQL)
- [ ] **Backend hosting?** (Railway, Render, AWS, etc.)

---

**Last Updated**: [Current Date]
**Status**: Planning Phase
**Owner**: Development Team
