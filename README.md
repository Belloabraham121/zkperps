# zkperps

> **Private perpetual futures + commit-reveal batch execution on Uniswap V4**

**zkperps** is a full-stack system for **perpetual futures trading** (e.g. ETH/USD) with **privacy-preserving batch execution**. Users trade via a web app; orders are committed and revealed through a **commit-reveal** flow backed by **zero-knowledge proofs (ZKPs)**. The same infrastructure supports **autonomous trading agents** that submit private batched swaps on Uniswap V4. Individual trade details are not visible in batch calldata — only aggregate net deltas hit the AMM.

### What’s in this repo

| Layer | What it does |
|-------|----------------|
| **Frontend** | Next.js trading UI: ETH/USD price (CoinGecko), chart, order panel (leverage/size/margin), positions, open orders, account summary. Privy email login; backend signs for the user. |
| **Backend** | Express API: auth (Privy JWT), perp intents (commit → reveal → execute batch), positions, collateral. Server-side signing so users don’t sign every tx. |
| **Contracts** | Uniswap V4 **PrivBatchHook** (commit-reveal + ZK), **PerpPositionManager** (positions, margin, funding, liquidation), mock USDC/USDT, pool setup. |
| **Agents** | TypeScript trading agents (momentum, arbitrage, etc.) that monitor pools and submit private batch swaps. |
| **ZK** | Circom circuits + Groth16 proofs for commitment validity; proofs verified on-chain. |

---

## Table of Contents

- [Overview](#overview)
- [Perpetuals Trading (zkperps)](#perpetuals-trading-zkperps)
- [Architecture](#architecture)
  - [System Diagram](#system-diagram)
  - [Agent Architecture](#agent-architecture)
  - [PrivBatchHook Contract](#privbatchhook-contract)
  - [Zero-Knowledge Proof Flow](#zero-knowledge-proof-flow)
  - [Privacy Model](#privacy-model)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup & Installation](#setup--installation)
- [Running the Project](#running-the-project)
  - [1. Deploy Contracts (Foundry)](#1-deploy-contracts-foundry)
  - [2. Set Up ZK Circuits](#2-set-up-zk-circuits)
  - [3. Configure & Run the Agent](#3-configure--run-the-agent)
  - [4. Run End-to-End ZK Flow Test](#4-run-end-to-end-zk-flow-test)
- [Trading Strategies](#trading-strategies)
- [Creating a Custom Strategy](#creating-a-custom-strategy)
- [Testing](#testing)
- [Deployed Contracts (Base Sepolia)](#deployed-contracts-base-sepolia)
- [License](#license)

---

## Overview

Traditional DEX swaps are fully transparent — anyone can see your trade size, direction, and slippage tolerance before or after execution. This exposes traders to:

- **MEV extraction** (frontrunning, sandwich attacks)
- **Information leakage** (competitors see your trading strategy)
- **Price impact** from publicly visible large orders

PrivBatch solves this by combining three innovations:

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Smart Contract** | `PrivBatchHook` (Uniswap V4 Hook) | Commit-reveal batch execution with on-chain ZK verification |
| **Zero-Knowledge Proofs** | Circom + Groth16 | Prove trade commitment validity without revealing parameters |
| **Autonomous Agents** | TypeScript trading agents | Monitor pools, decide trades, submit commitments, coordinate batches |

### How It Works (High Level)

1. **Agents monitor** Uniswap V4 pools for trading opportunities
2. **Agents commit** hashed trade intents to the hook contract (trade details hidden)
3. **ZK proofs** verify commitment validity without exposing parameters
4. **Reveals** are submitted in separate transactions (not in batch calldata)
5. **Batch execution** swaps only aggregate net deltas — individual trades are invisible
6. **Output tokens** are distributed proportionally to participants

---

## Perpetuals Trading (zkperps)

Users trade **ETH/USD perpetuals** in a web app. The flow is:

1. **Sign in** with email (Privy); the app gets a JWT and an embedded wallet.
2. **Order panel**: set leverage (1x–10x), size (e.g. 0.1 ETH), margin (USDC). **Value** (size × price) and **Est. Liq. Price** are computed live (price from CoinGecko; liq. formula matches `PerpPositionManager`).
3. **Open Long / Open Short**: the frontend sends a **perp intent** to the backend. The backend **commits** (hash) and **reveals** (intent) to the PrivBatchHook; when the batch is ready, it **executes** the batch. The Hook calls **PerpPositionManager** to open/close positions.
4. **Positions & account**: positions, open orders, collateral, and balances are read from the backend/contracts and shown in the UI. The **positions** panel is resizable (drag the bar above it).

### Tech stack (perps)

- **Frontend**: Next.js, React Query, Privy, Chart.js (price chart), CoinGecko (ETH price + 24h change for the market bar).
- **Backend**: Express, Privy (auth + server-side signing), perp API (commit, reveal, execute batch, positions, collateral). See `backend/PERP_API_DOCUMENTATION.md`.
- **Contracts**: `PerpPositionManager` (positions, margin, funding, liquidation), oracle adapter for mark price; Hook integrates with the same commit-reveal + ZK flow.

### Running the trading app

1. **Backend**: `cd backend && cp .env.example .env` (set Privy, JWT, RPC, contract addresses), then `npm run dev`.
2. **Frontend**: `cd frontend && cp .env.example .env.local` (set `NEXT_PUBLIC_API_URL`, Privy app ID, optional CoinGecko key), then `npm run dev`. Open [http://localhost:3000](http://localhost:3000), sign in, go to **Trade**.
3. **Chain**: Backend defaults to **Arbitrum Sepolia** (421614). Deploy contracts and set addresses in backend/frontend env (see backend README and `contracts/script/`).

---

## Architecture

### System Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    zkperps / PrivBatch System Architecture                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │                      OFF-CHAIN (TypeScript Agents)                  │     │
│  │                                                                     │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │     │
│  │  │ Momentum │  │Arbitrage │  │Liquidity │  │ Mean Reversion   │   │     │
│  │  │ Strategy │  │ Strategy │  │ Strategy │  │    Strategy      │   │     │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬──────────┘   │     │
│  │       │              │              │                │              │     │
│  │       └──────────────┼──────────────┼────────────────┘              │     │
│  │                      ▼                                              │     │
│  │            ┌──────────────────┐                                     │     │
│  │            │  PrivBatchAgent  │  Concrete agent class               │     │
│  │            │  ┌────────────┐  │                                     │     │
│  │            │  │MarketData  │  │  Reads pool state via extsload     │     │
│  │            │  │ Fetcher    │  │                                     │     │
│  │            │  └────────────┘  │                                     │     │
│  │            └────────┬─────────┘                                     │     │
│  │                     │                                               │     │
│  │  ┌──────────────────┼────────────────────────────────┐              │     │
│  │  │   AgentManager   │  Lifecycle  │  BatchCoordinator│              │     │
│  │  │   (orchestrator) │  Manager    │  (multi-agent)   │              │     │
│  │  └──────────────────┼────────────────────────────────┘              │     │
│  │                     │                                               │     │
│  │         ┌───────────┴───────────┐                                   │     │
│  │         │  ZK Proof Generation  │  Circom + snarkjs                │     │
│  │         │  (Poseidon hash)      │  Off-chain prover                │     │
│  │         └───────────┬───────────┘                                   │     │
│  └─────────────────────┼───────────────────────────────────────────────┘     │
│                        │                                                     │
│  ══════════════════════╪═══════════════════════════════════════════════════   │
│                        │         BLOCKCHAIN (Base Sepolia)                    │
│                        ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │                      ON-CHAIN (Solidity Contracts)                  │     │
│  │                                                                     │     │
│  │  ┌──────────────────────────────────────────────────┐               │     │
│  │  │              PrivBatchHook.sol                    │               │     │
│  │  │  (Uniswap V4 Hook — beforeSwap + afterSwap)      │               │     │
│  │  │                                                  │               │     │
│  │  │  ┌────────────────┐   ┌───────────────────────┐  │               │     │
│  │  │  │  Commit Phase  │──▶│    Reveal Phase        │  │               │     │
│  │  │  │  - Store hash  │   │  - submitReveal()      │  │               │     │
│  │  │  │  - ZK verify   │   │  - submitRevealForZK() │  │               │     │
│  │  │  └────────────────┘   └──────────┬────────────┘  │               │     │
│  │  │                                  ▼                │               │     │
│  │  │  ┌──────────────────────────────────────────┐     │               │     │
│  │  │  │          Batch Execution                  │     │               │     │
│  │  │  │  - Net delta computation                  │     │               │     │
│  │  │  │  - Single AMM swap (aggregate only)       │     │               │     │
│  │  │  │  - Proportional output distribution       │     │               │     │
│  │  │  │  - Slippage validation per user           │     │               │     │
│  │  │  └──────────────────────────────────────────┘     │               │     │
│  │  └──────────────────────────────────────────────────┘               │     │
│  │                            │                                        │     │
│  │         ┌──────────────────┼──────────────────┐                     │     │
│  │         ▼                  ▼                  ▼                     │     │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐          │     │
│  │  │Groth16       │  │PoolManager   │  │  Mock Tokens     │          │     │
│  │  │Verifier.sol  │  │(Uniswap V4)  │  │  USDT / USDC     │          │     │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘          │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Agent Architecture

```
                    ┌──────────────────────────────┐
                    │          run.ts               │
                    │    (Entry Point / Runner)     │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │       AgentManager            │
                    │  - Registers agents           │
                    │  - Starts/stops all agents    │
                    │  - Batch execution check loop │
                    │  - Error handling & recovery  │
                    └──────────────┬───────────────┘
                                   │
             ┌─────────────────────┼─────────────────────┐
             ▼                     ▼                     ▼
   ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────┐
   │ AgentLifecycle   │  │ BatchCoordinator│  │ AgentMessageBus    │
   │   Manager        │  │                 │  │                    │
   │ - Health checks  │  │ - Quorum detect │  │ - Pub/Sub channels │
   │ - Auto restart   │  │ - Readiness     │  │ - Shared state     │
   │ - Exp. backoff   │  │ - Voting        │  │ - Message history  │
   └─────────────────┘  └─────────────────┘  └────────────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │       PrivBatchAgent          │
                    │  (extends TradingAgent)       │
                    │                               │
                    │  ┌─────────────────────────┐  │
                    │  │   MarketDataFetcher      │  │
                    │  │   - extsload for price   │  │
                    │  │   - extsload for liq.    │  │
                    │  │   - Swap event query     │  │
                    │  │   - Caching layer        │  │
                    │  └─────────────────────────┘  │
                    │              │                 │
                    │  ┌───────────▼──────────────┐  │
                    │  │   TradingStrategy        │  │
                    │  │   (pluggable)            │  │
                    │  │                          │  │
                    │  │  shouldTrade(data,config) │  │
                    │  │    → TradeDecision        │  │
                    │  └──────────────────────────┘  │
                    │              │                 │
                    │  ┌───────────▼──────────────┐  │
                    │  │  Commitment Submission    │  │
                    │  │  → PrivBatchHook on-chain │  │
                    │  └──────────────────────────┘  │
                    └───────────────────────────────┘

                      Monitoring Loop (every N ms):
                      ┌──────────────────────────────┐
                      │ 1. Fetch market data (price,  │
                      │    liquidity, recent swaps)   │
                      │ 2. Evaluate strategy          │
                      │ 3. If signal → submit commit  │
                      │ 4. Coordinate batch when ready│
                      └──────────────────────────────┘
```

### PrivBatchHook Contract

The `PrivBatchHook` is a Uniswap V4 hook that intercepts swap operations and implements a **commit-reveal-batch** pattern:

```
                        PrivBatchHook Flow
                        ──────────────────

  User A ──┐                                          ┌── User A gets output
  User B ──┤  ① COMMIT                               │   proportional to input
  User C ──┘  (hashed intents — no trade details)     │
              │                                        │
              ▼                                        │
  ┌──────────────────────────┐                         │
  │   Commitment Storage     │                         │
  │   commitmentHash → {     │                         │
  │     hash, timestamp,     │                         │
  │     revealed: false      │                         │
  │   }                      │                         │
  └────────────┬─────────────┘                         │
               │                                       │
  User A ──┐   │  ② REVEAL (separate transactions)     │
  User B ──┤───┘  submitRevealForZK(hash, intent)      │
  User C ──┘      (stored in contract, NOT in batch    │
               │   execution calldata)                 │
               ▼                                       │
  ┌──────────────────────────┐                         │
  │   Reveal Storage         │                         │
  │   commitmentHash →       │                         │
  │     SwapIntent { user,   │                         │
  │     tokenIn, tokenOut,   │                         │
  │     amountIn, minOut,    │                         │
  │     recipient, nonce,    │                         │
  │     deadline }           │                         │
  └────────────┬─────────────┘                         │
               │                                       │
               │  ③ BATCH EXECUTE                      │
               │  revealAndBatchExecuteWithProofs(      │
               │    poolKey, hashes[], proofs[])        │
               │                                       │
               │  Calldata contains ONLY:              │
               │  • commitment hashes (opaque bytes32) │
               │  • ZK proofs (cryptographic data)     │
               │  • Pool key (public routing info)     │
               │                                       │
               │  NO individual trade details!          │
               ▼                                       │
  ┌──────────────────────────┐                         │
  │   Batch Processing       │                         │
  │                          │                         │
  │  1. Verify ZK proofs     │                         │
  │  2. Load intents from    │                         │
  │     revealStorage        │                         │
  │  3. Compute net deltas:  │                         │
  │     netΔ₀ = Σ(inputs₀)  │                         │
  │     netΔ₁ = Σ(inputs₁)  │                         │
  │  4. Validate privacy     │                         │
  │  5. Single AMM swap      │──── Uniswap V4 Pool ───┘
  │     (net amount only)    │     Only sees aggregate
  │  6. Validate slippage    │
  │  7. Distribute outputs   │
  │  8. Clean up storage     │
  └──────────────────────────┘
```

**Key privacy properties:**
- Individual trade sizes, directions, and recipients are never visible in batch execution calldata
- On-chain events use hashed recipient addresses
- The AMM only sees a single aggregate swap
- ZK proofs verify validity without revealing parameters

### Zero-Knowledge Proof Flow

```
            ZK Proof Flow (Groth16 + Poseidon)
            ──────────────────────────────────

  ┌─────────────────────────────────────────────────────────────┐
  │                    OFF-CHAIN (Agent / User)                  │
  │                                                              │
  │  Trade Parameters (PRIVATE):                                │
  │  ┌──────────────────────────────────────────────┐           │
  │  │  user        = 0xABC...                       │           │
  │  │  tokenIn     = 0xUSDC...                      │           │
  │  │  tokenOut    = 0xUSDT...                      │           │
  │  │  amountIn    = 1000000  (1 USDC)              │           │
  │  │  minAmountOut= 990000   (0.99 USDT)           │           │
  │  │  recipient   = 0xABC...                       │           │
  │  │  nonce       = 42                             │           │
  │  │  deadline    = 1700000000                     │           │
  │  └───────────────────┬──────────────────────────┘           │
  │                      │                                       │
  │                      ▼                                       │
  │  ┌───────────────────────────────────────┐                  │
  │  │      Poseidon Hash (ZK-friendly)      │                  │
  │  │                                       │                  │
  │  │  commitmentHash = Poseidon(           │                  │
  │  │    user, tokenIn, tokenOut, amountIn, │                  │
  │  │    minAmountOut, recipient, nonce,     │                  │
  │  │    deadline                            │                  │
  │  │  )                                    │                  │
  │  └───────────────────┬───────────────────┘                  │
  │                      │                                       │
  │                      ▼                                       │
  │  ┌───────────────────────────────────────┐                  │
  │  │       Circom Circuit (commitment-     │                  │
  │  │       proof.circom)                   │                  │
  │  │                                       │                  │
  │  │  Proves: Poseidon(private_inputs)     │                  │
  │  │          == commitmentHash (public)    │                  │
  │  │                                       │                  │
  │  │  Witness generation → Groth16 prover  │                  │
  │  └───────────────────┬───────────────────┘                  │
  │                      │                                       │
  │                      ▼                                       │
  │  ┌───────────────────────────────────────┐                  │
  │  │        ZK Proof Output                │                  │
  │  │                                       │                  │
  │  │  proof = { a, b, c }  (PUBLIC)        │  ◄── Sent to     │
  │  │  publicSignals = [commitmentHash]     │      blockchain  │
  │  │                                       │                  │
  │  │  Private inputs stay OFF-CHAIN ✓      │                  │
  │  └───────────────────┬───────────────────┘                  │
  └──────────────────────┼───────────────────────────────────────┘
                         │
   ═══════════════════════╪════════════════════════════════════
                         │        BLOCKCHAIN
                         ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                      ON-CHAIN                                │
  │                                                              │
  │  ┌───────────────────────────────────────┐                  │
  │  │     Groth16Verifier.sol               │                  │
  │  │     (auto-generated from snarkjs)     │                  │
  │  │                                       │                  │
  │  │  verifyProof(a, b, c, publicSignals)  │                  │
  │  │    → true / false                     │                  │
  │  └───────────────────┬───────────────────┘                  │
  │                      │                                       │
  │                      ▼                                       │
  │  ┌───────────────────────────────────────┐                  │
  │  │     PrivBatchHook.sol                 │                  │
  │  │                                       │                  │
  │  │  submitCommitmentWithProof(           │                  │
  │  │    poolKey, commitmentHash,           │                  │
  │  │    a, b, c, publicSignals             │                  │
  │  │  )                                    │                  │
  │  │    ✓ Verifies proof on-chain          │                  │
  │  │    ✓ Marks commitment as ZK-verified  │                  │
  │  │    ✓ No trade parameters revealed     │                  │
  │  └───────────────────────────────────────┘                  │
  └─────────────────────────────────────────────────────────────┘
```

### Privacy Model

```
  What's Visible on the Blockchain?
  ─────────────────────────────────

  ┌─────────────────────────────────────┐
  │         VISIBLE (Public)             │
  │                                     │
  │  • Commitment hashes (opaque)       │
  │  • ZK proofs (cryptographic data)   │
  │  • Pool key (which pool)            │
  │  • Net swap delta (aggregate)       │
  │  • Batch size (# of participants)   │
  │  • Hashed recipient addresses       │
  │  • Timestamps                       │
  └─────────────────────────────────────┘

  ┌─────────────────────────────────────┐
  │         HIDDEN (Private)             │
  │                                     │
  │  • Individual trade amounts      ✗  │
  │  • Individual trade directions   ✗  │
  │  • User addresses in batch tx    ✗  │
  │  • Recipient addresses (hashed)  ✗  │
  │  • Slippage tolerances           ✗  │
  │  • Trading strategy signals      ✗  │
  └─────────────────────────────────────┘
```

---

## Project Structure

```
zkperps/
├── frontend/                      # 🌐 Trading UI (Next.js)
│   ├── app/                       #    App router (/, /trade)
│   ├── components/                #    Layout, auth, trading (chart, order panel, positions)
│   ├── hooks/                     #    useMarketStats, useTrading, usePositions, useAccount
│   ├── lib/                       #    API client (perp), CoinGecko, config, utils
│   ├── PERP_INTEGRATION.md        #    Perp frontend integration notes
│   └── package.json
│
├── backend/                       # 🔧 API + server-side signing (Express)
│   ├── src/                       #    Routes (auth, perp), Privy, contract calls
│   ├── PERP_API_DOCUMENTATION.md  #    Perp API reference
│   └── package.json
│
├── agents/                        # 🤖 Autonomous Trading Agents (TypeScript)
│   ├── run.ts                     #    Entry point — boots and runs the agent
│   ├── PrivBatchAgent.ts          #    Concrete agent (MarketDataFetcher + Strategy)
│   ├── TradingAgent.ts            #    Abstract base agent class
│   ├── AgentManager.ts            #    Multi-agent orchestrator
│   ├── strategies/                #    Pluggable trading strategies
│   │   ├── BaseStrategy.ts        #      Abstract strategy template
│   │   ├── MomentumAgent.ts       #      Price momentum strategy
│   │   ├── ArbitrageAgent.ts      #      Cross-pool arbitrage strategy
│   │   ├── LiquidityAgent.ts      #      Liquidity-based strategy
│   │   └── MeanReversionAgent.ts  #      Mean reversion strategy
│   ├── config/
│   │   ├── agentConfig.ts         #    Config loading (env + JSON + defaults)
│   │   └── AgentLifecycleManager.ts # Health monitoring & auto-restart
│   ├── coordination/
│   │   ├── BatchCoordinator.ts    #    Multi-agent batch timing coordination
│   │   └── AgentMessageBus.ts     #    Inter-agent pub/sub messaging
│   ├── hooks/                     #    PrivBatchHook client wrappers
│   │   ├── PrivBatchHookClient.ts #      Contract interaction client
│   │   ├── RevealManager.ts       #      Reveal collection & validation
│   │   ├── BatchExecutor.ts       #      Batch execution logic
│   │   └── TokenDistributionHandler.ts # Token distribution event handling
│   ├── utils/
│   │   ├── marketData.ts          #    Pool data fetcher (extsload + events)
│   │   └── poolMonitor.ts         #    Continuous pool monitoring
│   ├── types/
│   │   └── interfaces.ts          #    TypeScript type definitions
│   ├── __tests__/                 #    Jest unit tests
│   ├── .env                       #    Agent configuration (not committed)
│   ├── .env.example               #    Example configuration template
│   ├── package.json
│   └── tsconfig.json
│
├── contracts/                     # 📜 Solidity Smart Contracts (Foundry)
│   ├── PrivBatchHook.sol          #    Main hook — commit-reveal-batch + perp batch execution
│   ├── PerpPositionManager.sol    #    Perp positions, margin, funding, liquidation
│   ├── ChainlinkOracleAdapter.sol #    Oracle adapter for perp mark price
│   ├── CommitmentVerifier.sol     #    Auto-generated Groth16 verifier
│   ├── MockUSDT.sol               #    Mock USDT token (18 decimals)
│   ├── MockUSDC.sol               #    Mock USDC token (6 decimals)
│   ├── lib/
│   │   └── SimpleERC20.sol        #    Minimal ERC20 base
│   ├── script/
│   │   ├── Deploy.s.sol           #    Deploy hook, verifier, tokens, pool, perp
│   │   ├── DeployMockUSDT.s.sol  #    Deploy mock USDT
│   │   ├── DeployMockUSDC.s.sol  #    Deploy mock USDC
│   │   ├── SetupPoolLiquidity.s.sol  # Initialize pool + add liquidity
│   │   ├── SetPerpManager.s.sol  #    Set PerpPositionManager on Hook
│   │   ├── AddMarket.s.sol       #    Add perp market (ETH/USD, etc.)
│   │   └── ...
│   ├── test/
│   │   ├── PrivBatchHookZK.t.sol #    ZK integration tests
│   │   ├── PerpPositionManager.t.sol  # Perp + liquidation tests
│   │   └── PerpBatchExecution.t.sol   # Perp batch execution tests
│   ├── foundry.toml               #    Foundry configuration
│   └── remappings.txt             #    Solidity import remappings
│
├── circuits/                      # 🔐 ZK Circuits (Circom)
│   ├── commitment-proof.circom    #    Poseidon commitment proof circuit
│   └── package.json               #    Circuit build scripts
│
├── scripts/zk/                    # 🛠️ ZK Proof Scripts (Node.js)
│   ├── generate-proof.js          #    Off-chain proof generation
│   ├── test-proof-generation.js   #    Proof generation tests
│   ├── test-end-to-end-zk-flow.js #    Full E2E ZK flow test
│   ├── execute-perp-batch-from-mongo.js  # Execute perp batch from stored reveals
│   └── package.json
│
├── build/zk/                      # 🏗️ Compiled ZK Artifacts
│   ├── commitment-proof.wasm      #    Circuit WASM
│   ├── final.zkey                #    Proving key
│   ├── vkey.json                  #    Verification key
│   └── ...
│
└── README.md                      # This file
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | ≥ 18 | Agent runtime, ZK scripts |
| **npm** | ≥ 9 | Package management |
| **Foundry** | Latest | Solidity compilation, testing, deployment |
| **Circom** | ≥ 2.1.6 | ZK circuit compilation |
| **snarkjs** | ≥ 0.7.0 | Trusted setup, proof generation |
| **Git** | Latest | Dependency management |

### Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Install Circom (optional — only needed to recompile circuits)

```bash
# Using cargo (Rust package manager)
cargo install --git https://github.com/iden3/circom.git
```

---

## Setup & Installation

### 1. Clone and install dependencies

```bash
git clone <your-repo-url> zkperps
cd zkperps
```

### 2. Install contract dependencies

```bash
cd contracts
forge install
cd ..
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 4. Install backend dependencies

```bash
cd backend
npm install
cd ..
```

### 5. Install agent dependencies

```bash
cd agents
npm install
cd ..
```

### 6. Install ZK script dependencies

```bash
cd scripts/zk
npm install
cd ../..
```

### 7. Install circuit dependencies (optional — only if recompiling circuits)

```bash
cd circuits
npm install
cd ..
```

---

## Running the Project

### Quick start: trading app (after contracts are deployed)

1. **Backend**: In `backend/`, copy `.env.example` to `.env`, set Privy credentials, JWT secret, RPC URL, and contract addresses. Run `npm run dev`.
2. **Frontend**: In `frontend/`, copy `.env.example` to `.env.local`, set `NEXT_PUBLIC_API_URL` (e.g. `http://localhost:4000`), Privy App ID, and optionally `NEXT_PUBLIC_COINGECKO_API_KEY`. Run `npm run dev` and open [http://localhost:3000](http://localhost:3000). Sign in with email and go to **Trade** to use the perp UI.

See [Perpetuals Trading (zkperps)](#perpetuals-trading-zkperps) and `backend/README.md` / `backend/PERP_API_DOCUMENTATION.md` for API and env details.

---

### 1. Deploy Contracts (Foundry)

First, set up your environment variables. Create a `.env` file in the `contracts/` directory:

```bash
# contracts/.env
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY
BASESCAN_API_KEY=YOUR_BASESCAN_API_KEY
```

#### Deploy Mock Tokens

```bash
cd contracts

# Deploy Mock USDT (18 decimals)
forge script script/DeployMockUSDT.s.sol:DeployMockUSDT \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify

# Deploy Mock USDC (6 decimals)
forge script script/DeployMockUSDC.s.sol:DeployMockUSDC \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

#### Deploy PrivBatchHook + Groth16 Verifier

```bash
forge script script/DeployPrivBatchHook.s.sol:DeployPrivBatchHook \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

#### Initialize Pool & Add Liquidity

```bash
# Set deployed addresses in .env first, then:
forge script script/SetupPoolLiquidity.s.sol:SetupPoolLiquidity \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast
```

### 2. Set Up ZK Circuits

If you need to recompile circuits and regenerate the verifier (pre-built artifacts are included in `build/zk/`):

```bash
cd circuits

# Compile the Circom circuit
npm run compile

# Trusted setup (Powers of Tau ceremony)
npm run setup
npm run contribute

# Finalize
snarkjs powersoftau prepare phase2 ../build/zk/pot12_0001.ptau ../build/zk/pot12_final.ptau -v

# Generate proving/verification keys
npm run setup-groth16
npm run contribute-zkey

# Export verification key and Solidity verifier
npm run export-vkey
npm run export-verifier

cd ..
```

#### Test ZK Proof Generation

```bash
cd scripts/zk
npm test
cd ../..
```

### 3. Configure & Run the Agent

#### Configure the agent

Create an `.env` file in the `agents/` directory. Use the example as a template:

```bash
cd agents
cp .env.example .env
```

Edit `agents/.env` with your deployed contract addresses and RPC credentials:

```bash
# ─── Agent Configuration ───────────────────────────────────────
AGENT_ID=agent-1

# Wallet (NEVER commit your private key to version control)
AGENT_WALLET_ADDRESS=0xYOUR_WALLET_ADDRESS
AGENT_WALLET_PRIVATE_KEY=0xYOUR_PRIVATE_KEY

# Strategy: momentum | arbitrage | liquidity | mean-reversion
AGENT_STRATEGY_NAME=momentum

# Contract addresses (Base Sepolia)
AGENT_HOOK_ADDRESS=0xYOUR_HOOK_ADDRESS
AGENT_POOL_MANAGER_ADDRESS=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408

# RPC
AGENT_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY
AGENT_CHAIN_ID=84532

# Token addresses
MOCK_USDT_ADDRESS=0xYOUR_USDT_ADDRESS
MOCK_USDC_ADDRESS=0xYOUR_USDC_ADDRESS

# Monitoring (ms)
AGENT_POLL_INTERVAL=3000

# Batch settings
AGENT_BATCH_INTERVAL=4
AGENT_MIN_COMMITMENTS=2

# Trading limits (wei)
AGENT_MAX_AMOUNT_IN=10000000000000000000
AGENT_MIN_AMOUNT_IN=1000000000000000000
AGENT_DEFAULT_SLIPPAGE_BPS=50
```

#### Run the agent

```bash
cd agents

# Start the agent (production)
npm start

# Or with auto-restart on file changes (development)
npm run dev
```

You should see output like:

```
╔══════════════════════════════════════════════╗
║      🤖 PrivBatch Trading Agent Runner       ║
╚══════════════════════════════════════════════╝

[Runner] Pool: 0x0Ea67A67 / 0x98346718 (fee=3000, tick=60)
╔══════════════════════════════════════╗
║      Agent Configuration Summary     ║
╠══════════════════════════════════════╣
║ Agent ID:    agent-1
║ Strategy:    momentum
║ Chain ID:    84532
║ Pools:       1
╚══════════════════════════════════════╝

[Runner] Strategy: momentum
[Runner] Agent created: agent-1
[Runner] Starting agent system...

[agent-1] Agent started successfully
[Runner] ✅ Agent is live and monitoring pools.
[Runner] Press Ctrl+C to stop.

[agent-1] ⏳ 0x0Ea67A../ 0x983467.. — price=1 liq=0 — No price movement detected (0.00% < 2.00% threshold)
```

Press **Ctrl+C** to gracefully shut down.

#### Run with a different strategy

```bash
# Via environment variable
AGENT_STRATEGY_NAME=arbitrage npm start

# Or edit .env and restart
```

#### Run with a JSON config file

```bash
npx ts-node run.ts --config ./my-config.json
```

### 4. Run End-to-End ZK Flow Test

This test exercises the full privacy flow: proof generation → commitment → reveal → batch execution.

```bash
cd scripts/zk

# Make sure .env is configured with contract addresses
npm run test-e2e
```

---

## Trading Strategies

| Strategy | File | Description | Signal |
|----------|------|-------------|--------|
| **Momentum** | `MomentumAgent.ts` | Trades in direction of price momentum | Price change exceeds threshold (default 2%) |
| **Arbitrage** | `ArbitrageAgent.ts` | Exploits cross-pool price discrepancies | Spread exceeds minimum profitable threshold |
| **Liquidity** | `LiquidityAgent.ts` | Trades based on liquidity imbalances | Liquidity ratio exceeds imbalance threshold |
| **Mean Reversion** | `MeanReversionAgent.ts` | Trades against deviations from moving average | Price deviates significantly from historical mean |

All strategies extend `BaseStrategy` which provides:
- **Cooldown management** — prevent over-trading on the same pool
- **Amount scaling** — scale trade size by confidence level
- **Slippage calculation** — automatically compute `minAmountOut` from price and BPS tolerance
- **Market data validation** — check data freshness, price sanity, liquidity
- **Standardized decisions** — consistent `TradeDecision` format

---

## Creating a Custom Strategy

```typescript
import { BaseStrategy } from './BaseStrategy';
import { MarketData, TradeDecision, AgentConfig, SwapDirection } from '../types/interfaces';

export class MyCustomAgent extends BaseStrategy {
  name = 'my-custom-strategy';

  async shouldTrade(marketData: MarketData, config: AgentConfig): Promise<TradeDecision> {
    // Validate market data
    const validation = this.validateMarketData(marketData);
    if (!validation.isValid) {
      return this.noTradeDecision(`Invalid data: ${validation.errors.join(', ')}`);
    }

    // Check cooldown
    if (this.isCooldownActive(marketData.poolId, 60000)) {
      return this.noTradeDecision('Cooldown active');
    }

    // Your custom logic
    const price = parseFloat(marketData.currentPrice);
    if (price > someThreshold) {
      this.recordTrade(marketData.poolId);
      return this.buildTradeDecision(
        SwapDirection.ZERO_FOR_ONE,
        this.scaleAmount(0.8, config),
        '0',
        0.8,
        'Custom signal triggered'
      );
    }

    return this.noTradeDecision('No signal');
  }
}
```

Register it in `run.ts`:

```typescript
case 'my-custom':
  return new MyCustomAgent();
```

---

## Testing

### Agent Unit Tests (Jest)

```bash
cd agents
npm test
```

Tests cover:
- All 4 trading strategies (signal detection, cooldown, edge cases)
- `MarketDataFetcher` (caching, pool ID computation)
- `PrivBatchHookClient` (commitment submission, reveal, batch execution)
- `RevealManager` (validation, deduplication)
- `BatchExecutor` (pool management, ZK/standard execution)
- `BatchCoordinator` (quorum, readiness, countdown)
- `BaseStrategy` (cooldown, scaling, market data validation)

### Contract Tests (Foundry)

```bash
cd contracts
forge test -vv
```

Tests cover:
- ZK proof verification on-chain
- Commitment submission and reveal
- Batch execution with privacy checks
- Slippage validation
- Token distribution

### ZK Proof Tests

```bash
cd scripts/zk
npm test              # Proof generation tests
npm run test-e2e      # Full end-to-end ZK flow
```

---

## Deployed Contracts (Base Sepolia)

| Contract | Address |
|----------|---------|
| **PrivBatchHook** | `0x2EEeC56B3037EC07cf2024a896C9708Bc94280C4` |
| **Groth16Verifier** | `0x09F3bCe3546C3b4348E31B6E86A271c42b39672e` |
| **MockUSDT** (18 dec) | `0x0Ea67A670a4182Db6eB18A6aAbC0f75195ef2EfC` |
| **MockUSDC** (6 dec) | `0x98346718c549Ed525201fC583796eCf2eaCC0aD5` |
| **PoolManager** (Uniswap V4) | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |

> **Network:** Base Sepolia (Chain ID: 84532)

---

## Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **Poseidon hash** (not Keccak256) in ZK circuits | ~150x fewer constraints than Keccak in ZK proofs |
| **Separate reveal transactions** | Individual intents are never in batch execution calldata |
| **Server-side signing (Privy)** | Users sign in with email; backend holds authorization key and signs perp/swap txs so users don’t sign every action |
| **PerpPositionManager + Hook** | Perp opens/closes run through the same Hook batch flow; positions, margin, and liquidation live in a separate manager contract |
| **`extsload`** for pool state reads | Uniswap V4 stores state in PoolManager slots; no public getter functions |
| **10-block `eth_getLogs` range** | Compatible with Alchemy free tier rate limits |
| **`via_ir = true`** in Foundry | Resolves "stack too deep" in complex hook contract |
| **Hashed recipient in events** | Prevents linking on-chain events to specific user addresses |
| **Net delta batching** | AMM sees one swap regardless of how many users participate |

---

## License

MIT
