#!/usr/bin/env ts-node
/**
 * Agent Runner
 *
 * Boots one or more PrivBatchAgents and an AgentManager, wires up
 * lifecycle management, and runs until SIGINT / SIGTERM.
 *
 * Usage:
 *   npx ts-node run.ts                         # loads .env + defaults
 *   npx ts-node run.ts --config agent.json     # loads JSON config
 *   AGENT_STRATEGY_NAME=arbitrage npx ts-node run.ts  # env override
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrivBatchAgent } from './PrivBatchAgent';
import { AgentManager } from './AgentManager';
import {
  createAgentConfig,
  validateAgentConfig,
  printConfigSummary,
} from './config/agentConfig';
import { AgentLifecycleManager } from './config/AgentLifecycleManager';
import { TradingStrategy } from './types/interfaces';

// Strategies
import { MomentumAgent } from './strategies/MomentumAgent';
import { ArbitrageAgent } from './strategies/ArbitrageAgent';
import { LiquidityAgent } from './strategies/LiquidityAgent';
import { MeanReversionAgent } from './strategies/MeanReversionAgent';

// ──────────────────────────────────────────────────────────────
// Load .env from multiple possible locations
// ──────────────────────────────────────────────────────────────
const envPaths = [
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', 'scripts', 'zk', '.env'),
];
for (const p of envPaths) {
  dotenv.config({ path: p });
}

// ──────────────────────────────────────────────────────────────
// Strategy factory
// ──────────────────────────────────────────────────────────────
function createStrategy(name: string): TradingStrategy {
  switch (name) {
    case 'momentum':
      return new MomentumAgent();
    case 'arbitrage':
      return new ArbitrageAgent();
    case 'liquidity':
      return new LiquidityAgent();
    case 'mean-reversion':
      return new MeanReversionAgent();
    default:
      console.warn(`[Runner] Unknown strategy "${name}", defaulting to momentum`);
      return new MomentumAgent();
  }
}

// ──────────────────────────────────────────────────────────────
// Parse CLI args
// ──────────────────────────────────────────────────────────────
function parseArgs(): { configFile?: string } {
  const args = process.argv.slice(2);
  let configFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configFile = args[i + 1];
      i++;
    }
  }
  return { configFile };
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║      🤖 PrivBatch Trading Agent Runner       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // ── Build config ──
  const { configFile } = parseArgs();

  // Build pool key from env token addresses
  const hookAddress = process.env.AGENT_HOOK_ADDRESS || '';
  const usdtAddress = process.env.MOCK_USDT_ADDRESS || '';
  const usdcAddress = process.env.MOCK_USDC_ADDRESS || '';

  const poolKeys = [];
  if (usdtAddress && usdcAddress && hookAddress) {
    // currency0 must be the numerically lower address
    const [c0, c1] =
      usdtAddress.toLowerCase() < usdcAddress.toLowerCase()
        ? [usdtAddress, usdcAddress]
        : [usdcAddress, usdtAddress];
    poolKeys.push({
      currency0: c0,
      currency1: c1,
      fee: 3000,
      tickSpacing: 60,
      hooks: hookAddress,
    });
    console.log(`[Runner] Pool: ${c0} / ${c1} (fee=3000, tick=60)`);
  } else {
    console.warn('[Runner] Token addresses not set — agent will have no pools to monitor.');
    console.warn('         Set MOCK_USDT_ADDRESS, MOCK_USDC_ADDRESS, and AGENT_HOOK_ADDRESS in .env');
  }

  let config;
  try {
    config = createAgentConfig({
      configFilePath: configFile,
      loadFromEnv: true,
      overrides: {
        pools: poolKeys,
      },
      validate: true,
      throwOnError: false, // print warnings but don't crash — we'll validate after
    });
  } catch (err) {
    console.error('[Runner] Fatal config error:', (err as Error).message);
    process.exit(1);
  }

  // Show config summary
  printConfigSummary(config);

  // Validate strictly
  const validation = validateAgentConfig(config);
  if (!validation.isValid) {
    console.error('\n[Runner] Configuration errors:');
    for (const e of validation.errors) {
      console.error(`   ❌ ${e}`);
    }
    console.error('\nSet the required environment variables or pass --config <file>.');
    console.error('See agents/.env.example for a full list.\n');
    process.exit(1);
  }

  // ── Create strategy ──
  const strategy = createStrategy(config.strategy.name);
  console.log(`\n[Runner] Strategy: ${strategy.name}`);

  // ── Create agent ──
  const agent = new PrivBatchAgent(config, strategy);
  console.log(`[Runner] Agent created: ${config.agentId}`);

  // ── Create manager ──
  const manager = new AgentManager({
    hookAddress: config.hookAddress,
    rpcUrl: config.rpcUrl,
    privateKey: config.wallet.privateKey,
    monitoringIntervalMs: config.monitoringSettings.pollInterval,
    batchCheckIntervalMs: config.commitmentSettings.batchInterval * 1000,
    maxRetries: config.monitoringSettings.maxRetries,
    retryDelayMs: config.monitoringSettings.retryDelay,
  });

  // Register agent
  manager.registerAgent(agent, config);

  // ── Create lifecycle manager ──
  const lifecycle = new AgentLifecycleManager({
    healthCheckIntervalMs: config.monitoringSettings.pollInterval * 2,
    staleThresholdMs: config.monitoringSettings.pollInterval * 10,
    maxConsecutiveErrors: config.monitoringSettings.maxRetries,
    maxTotalRestarts: 10,
  });
  lifecycle.register(agent, config);

  // Log lifecycle events
  lifecycle.onLifecycleEvent((event) => {
    const ts = new Date(event.timestamp).toISOString();
    const msg = event.error ? ` — ${event.error}` : '';
    console.log(`[Lifecycle] ${ts} ${event.event} ${event.agentId}${msg}`);
  });

  // ── Graceful shutdown ──
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Runner] Received ${signal}. Shutting down gracefully...`);
    try {
      lifecycle.stopHealthMonitoring();
      await manager.stopAll();
    } catch (err) {
      console.error('[Runner] Error during shutdown:', err);
    }
    console.log('[Runner] Goodbye 👋');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // ── Start everything ──
  console.log('\n[Runner] Starting agent system...\n');

  try {
    lifecycle.startHealthMonitoring();
    await manager.startAll();
  } catch (err) {
    console.error('[Runner] Failed to start:', (err as Error).message);
    process.exit(1);
  }

  console.log('\n[Runner] ✅ Agent is live and monitoring pools.');
  console.log('[Runner] Press Ctrl+C to stop.\n');

  // Keep process alive
  await new Promise(() => {
    /* intentionally unresolved */
  });
}

main().catch((err) => {
  console.error('[Runner] Unhandled error:', err);
  process.exit(1);
});
