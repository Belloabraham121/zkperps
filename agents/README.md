# Agents - Agentic Finance Component

This directory contains the implementation of autonomous trading agents that interact with PrivBatchHook.

## Overview

The agents component implements programmatic trading bots that:
- Monitor Uniswap v4 pools autonomously
- Make algorithmic trading decisions
- Commit trades privately via PrivBatchHook
- Coordinate batch execution with other agents
- Adapt strategies based on market conditions

## Project Structure

```
agents/
├── strategies/          # Trading strategy implementations
│   ├── MomentumAgent.ts
│   ├── ArbitrageAgent.ts
│   └── LiquidityAgent.ts
├── utils/               # Utility functions
│   ├── marketData.ts    # Market data fetching
│   └── poolMonitor.ts   # Pool monitoring
├── config/              # Configuration files
│   └── agentConfig.ts   # Agent configurations
├── TradingAgent.ts      # Core agent class
├── AgentManager.ts      # Agent orchestration
└── README.md            # This file
```

## Implementation Status

See [`../AGENTIC_TODO.md`](../AGENTIC_TODO.md) for detailed implementation checklist.

## Quick Start

1. Install dependencies:
```bash
npm install
# or
yarn install
```

2. Configure agents:
```bash
cp config/agentConfig.example.ts config/agentConfig.ts
# Edit agentConfig.ts with your settings
```

3. Start agents:
```bash
npm run start:agents
# or
yarn start:agents
```

## Agent Types

### Momentum Agent
Trades based on price momentum (trend following).

### Arbitrage Agent
Detects and executes arbitrage opportunities across pools.

### Liquidity Agent
Trades when liquidity conditions are favorable.

## Development

See [`../AGENTIC_TODO.md`](../AGENTIC_TODO.md) for implementation tasks.

## Documentation

- [Agent Architecture](../docs/AGENT_ARCHITECTURE.md) - Coming soon
- [Strategy Guide](../docs/STRATEGY_GUIDE.md) - Coming soon
- [Configuration Guide](../docs/CONFIG_GUIDE.md) - Coming soon
