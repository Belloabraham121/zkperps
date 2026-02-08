/**
 * Agent Configuration System
 *
 * Provides:
 * - Default configuration values for all agent settings
 * - Loading from environment variables (AGENT_* prefix)
 * - Loading from JSON config files
 * - Deep merging of partial configs over defaults
 * - Comprehensive validation with human-readable errors
 *
 * ## Configuration Precedence (highest → lowest)
 * 1. Explicit overrides passed to `createAgentConfig()`
 * 2. Environment variables (AGENT_*)
 * 3. JSON config file (if path is provided)
 * 4. Default values
 *
 * ## Environment Variables
 *
 * | Variable                        | Maps to                               |
 * |---------------------------------|---------------------------------------|
 * | AGENT_ID                        | agentId                               |
 * | AGENT_WALLET_ADDRESS            | wallet.address                        |
 * | AGENT_WALLET_PRIVATE_KEY        | wallet.privateKey                     |
 * | AGENT_STRATEGY_NAME             | strategy.name                         |
 * | AGENT_HOOK_ADDRESS              | hookAddress                           |
 * | AGENT_POOL_MANAGER_ADDRESS      | poolManagerAddress                    |
 * | AGENT_RPC_URL                   | rpcUrl                                |
 * | AGENT_CHAIN_ID                  | chainId                               |
 * | AGENT_DEADLINE_OFFSET           | commitmentSettings.defaultDeadlineOffset |
 * | AGENT_MIN_COMMITMENTS           | commitmentSettings.minCommitments     |
 * | AGENT_BATCH_INTERVAL            | commitmentSettings.batchInterval      |
 * | AGENT_POLL_INTERVAL             | monitoringSettings.pollInterval       |
 * | AGENT_MAX_RETRIES               | monitoringSettings.maxRetries         |
 * | AGENT_RETRY_DELAY               | monitoringSettings.retryDelay         |
 * | AGENT_MAX_AMOUNT_IN             | tradingSettings.maxAmountIn           |
 * | AGENT_MIN_AMOUNT_IN             | tradingSettings.minAmountIn           |
 * | AGENT_DEFAULT_SLIPPAGE_BPS      | tradingSettings.defaultSlippageBps    |
 */

import { AgentConfig, PoolKey } from '../types/interfaces';
import * as fs from 'fs';
import * as path from 'path';

// ─── Defaults ─────────────────────────────────────────────────

/**
 * Default agent configuration.
 * All values here can be overridden via env vars, JSON, or explicit overrides.
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  agentId: 'agent-default',
  wallet: {
    address: '',
    privateKey: undefined,
  },
  strategy: {
    name: 'momentum',
    config: {},
  },
  pools: [],
  hookAddress: '',
  poolManagerAddress: '',
  rpcUrl: 'http://localhost:8545',
  chainId: 84532, // Base Sepolia

  commitmentSettings: {
    defaultDeadlineOffset: 3600, // 1 hour
    minCommitments: 2,
    batchInterval: 300, // 5 minutes
  },

  monitoringSettings: {
    pollInterval: 30000, // 30 seconds
    maxRetries: 3,
    retryDelay: 5000, // 5 seconds
  },

  tradingSettings: {
    maxAmountIn: '1000000000000000000', // 1 token (18 decimals)
    minAmountIn: '100000000000000000',  // 0.1 token (18 decimals)
    defaultSlippageBps: 50, // 0.5%
  },
};

// ─── Validation ───────────────────────────────────────────────

export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate an AgentConfig for completeness and correctness.
 */
export function validateAgentConfig(config: AgentConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Required fields ──
  if (!config.agentId || config.agentId.trim() === '') {
    errors.push('agentId is required');
  }

  if (!config.wallet.address || config.wallet.address.trim() === '') {
    errors.push('wallet.address is required');
  } else if (!/^0x[a-fA-F0-9]{40}$/.test(config.wallet.address)) {
    errors.push('wallet.address must be a valid Ethereum address (0x + 40 hex chars)');
  }

  if (!config.hookAddress || config.hookAddress.trim() === '') {
    errors.push('hookAddress is required');
  } else if (!/^0x[a-fA-F0-9]{40}$/.test(config.hookAddress)) {
    errors.push('hookAddress must be a valid Ethereum address');
  }

  if (!config.poolManagerAddress || config.poolManagerAddress.trim() === '') {
    errors.push('poolManagerAddress is required');
  } else if (!/^0x[a-fA-F0-9]{40}$/.test(config.poolManagerAddress)) {
    errors.push('poolManagerAddress must be a valid Ethereum address');
  }

  if (!config.rpcUrl || config.rpcUrl.trim() === '') {
    errors.push('rpcUrl is required');
  }

  // ── Wallet ──
  if (!config.wallet.privateKey) {
    warnings.push('wallet.privateKey is not set — agent will not be able to sign transactions');
  } else if (!/^0x[a-fA-F0-9]{64}$/.test(config.wallet.privateKey)) {
    errors.push('wallet.privateKey must be a valid 32-byte hex string (0x + 64 hex chars)');
  }

  // ── Strategy ──
  const validStrategies = ['momentum', 'arbitrage', 'liquidity', 'mean-reversion'];
  if (!config.strategy.name) {
    errors.push('strategy.name is required');
  } else if (!validStrategies.includes(config.strategy.name)) {
    warnings.push(
      `strategy.name "${config.strategy.name}" is not a built-in strategy (${validStrategies.join(', ')}). Make sure you provide a custom strategy instance.`
    );
  }

  // ── Pools ──
  if (!config.pools || config.pools.length === 0) {
    warnings.push('No pools configured — agent will have nothing to monitor');
  } else {
    for (let i = 0; i < config.pools.length; i++) {
      const pool = config.pools[i];
      if (!pool.currency0 || !/^0x[a-fA-F0-9]{40}$/.test(pool.currency0)) {
        errors.push(`pools[${i}].currency0 must be a valid address`);
      }
      if (!pool.currency1 || !/^0x[a-fA-F0-9]{40}$/.test(pool.currency1)) {
        errors.push(`pools[${i}].currency1 must be a valid address`);
      }
      if (!pool.hooks || !/^0x[a-fA-F0-9]{40}$/.test(pool.hooks)) {
        errors.push(`pools[${i}].hooks must be a valid address`);
      }
      if (pool.fee < 0 || pool.fee > 1000000) {
        errors.push(`pools[${i}].fee must be between 0 and 1000000`);
      }
      if (pool.tickSpacing <= 0) {
        errors.push(`pools[${i}].tickSpacing must be positive`);
      }
    }
  }

  // ── Commitment settings ──
  if (config.commitmentSettings.defaultDeadlineOffset <= 0) {
    errors.push('commitmentSettings.defaultDeadlineOffset must be positive');
  }
  if (config.commitmentSettings.minCommitments < 1) {
    errors.push('commitmentSettings.minCommitments must be at least 1');
  }
  if (config.commitmentSettings.batchInterval <= 0) {
    errors.push('commitmentSettings.batchInterval must be positive');
  }

  // ── Monitoring settings ──
  if (config.monitoringSettings.pollInterval < 1000) {
    warnings.push('monitoringSettings.pollInterval is under 1s — may cause excessive RPC calls');
  }
  if (config.monitoringSettings.maxRetries < 0) {
    errors.push('monitoringSettings.maxRetries cannot be negative');
  }
  if (config.monitoringSettings.retryDelay < 0) {
    errors.push('monitoringSettings.retryDelay cannot be negative');
  }

  // ── Trading settings ──
  try {
    const min = BigInt(config.tradingSettings.minAmountIn);
    const max = BigInt(config.tradingSettings.maxAmountIn);
    if (min <= BigInt(0)) {
      errors.push('tradingSettings.minAmountIn must be positive');
    }
    if (max <= BigInt(0)) {
      errors.push('tradingSettings.maxAmountIn must be positive');
    }
    if (min > max) {
      errors.push('tradingSettings.minAmountIn must be <= maxAmountIn');
    }
  } catch {
    errors.push('tradingSettings.minAmountIn and maxAmountIn must be valid integer strings');
  }

  if (config.tradingSettings.defaultSlippageBps < 0 || config.tradingSettings.defaultSlippageBps > 10000) {
    errors.push('tradingSettings.defaultSlippageBps must be between 0 and 10000');
  }

  // ── Chain ID ──
  if (config.chainId <= 0) {
    errors.push('chainId must be a positive integer');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Environment Variable Loading ─────────────────────────────

/**
 * Load agent configuration from environment variables.
 * Only non-empty env vars are used; missing vars are skipped.
 */
export function loadConfigFromEnv(): Partial<AgentConfig> {
  const config: Record<string, unknown> = {};
  const env = process.env;

  // ── Simple fields ──
  if (env.AGENT_ID) config.agentId = env.AGENT_ID;
  if (env.AGENT_HOOK_ADDRESS) config.hookAddress = env.AGENT_HOOK_ADDRESS;
  if (env.AGENT_POOL_MANAGER_ADDRESS) config.poolManagerAddress = env.AGENT_POOL_MANAGER_ADDRESS;
  if (env.AGENT_RPC_URL) config.rpcUrl = env.AGENT_RPC_URL;
  if (env.AGENT_CHAIN_ID) config.chainId = parseInt(env.AGENT_CHAIN_ID, 10);

  // ── Wallet ──
  const wallet: Record<string, string | undefined> = {};
  if (env.AGENT_WALLET_ADDRESS) wallet.address = env.AGENT_WALLET_ADDRESS;
  if (env.AGENT_WALLET_PRIVATE_KEY) wallet.privateKey = env.AGENT_WALLET_PRIVATE_KEY;
  if (Object.keys(wallet).length > 0) config.wallet = wallet;

  // ── Strategy ──
  const strategy: Record<string, unknown> = {};
  if (env.AGENT_STRATEGY_NAME) strategy.name = env.AGENT_STRATEGY_NAME;
  if (Object.keys(strategy).length > 0) config.strategy = { config: {}, ...strategy };

  // ── Commitment settings ──
  const commit: Record<string, unknown> = {};
  if (env.AGENT_DEADLINE_OFFSET) commit.defaultDeadlineOffset = parseInt(env.AGENT_DEADLINE_OFFSET, 10);
  if (env.AGENT_MIN_COMMITMENTS) commit.minCommitments = parseInt(env.AGENT_MIN_COMMITMENTS, 10);
  if (env.AGENT_BATCH_INTERVAL) commit.batchInterval = parseInt(env.AGENT_BATCH_INTERVAL, 10);
  if (Object.keys(commit).length > 0) config.commitmentSettings = commit;

  // ── Monitoring settings ──
  const monitor: Record<string, unknown> = {};
  if (env.AGENT_POLL_INTERVAL) monitor.pollInterval = parseInt(env.AGENT_POLL_INTERVAL, 10);
  if (env.AGENT_MAX_RETRIES) monitor.maxRetries = parseInt(env.AGENT_MAX_RETRIES, 10);
  if (env.AGENT_RETRY_DELAY) monitor.retryDelay = parseInt(env.AGENT_RETRY_DELAY, 10);
  if (Object.keys(monitor).length > 0) config.monitoringSettings = monitor;

  // ── Trading settings ──
  const trading: Record<string, unknown> = {};
  if (env.AGENT_MAX_AMOUNT_IN) trading.maxAmountIn = env.AGENT_MAX_AMOUNT_IN;
  if (env.AGENT_MIN_AMOUNT_IN) trading.minAmountIn = env.AGENT_MIN_AMOUNT_IN;
  if (env.AGENT_DEFAULT_SLIPPAGE_BPS) trading.defaultSlippageBps = parseInt(env.AGENT_DEFAULT_SLIPPAGE_BPS, 10);
  if (Object.keys(trading).length > 0) config.tradingSettings = trading;

  return config as Partial<AgentConfig>;
}

// ─── JSON File Loading ────────────────────────────────────────

/**
 * Load agent configuration from a JSON file.
 * Supports `.json` files with the AgentConfig structure.
 *
 * @param filePath Absolute or relative path to the JSON config file
 * @returns Partial config (only keys present in the file)
 * @throws If the file doesn't exist or contains invalid JSON
 */
export function loadConfigFromFile(filePath: string): Partial<AgentConfig> {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');

  try {
    const parsed = JSON.parse(raw);
    return parsed as Partial<AgentConfig>;
  } catch (err) {
    throw new Error(`Invalid JSON in config file ${resolved}: ${(err as Error).message}`);
  }
}

// ─── Deep Merge ───────────────────────────────────────────────

/**
 * Deep merge two objects. `source` values overwrite `target` values.
 * Only plain objects are recursively merged; arrays and primitives are replaced.
 */
function deepMerge(target: AgentConfig, source: Partial<AgentConfig>): AgentConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = { ...target };

  for (const key of Object.keys(source) as Array<keyof AgentConfig>) {
    const srcVal = source[key];
    const tgtVal = target[key];

    if (
      srcVal !== undefined &&
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== undefined &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      // Recursively merge plain objects
      result[key] = { ...tgtVal, ...srcVal };
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }

  return result as AgentConfig;
}

// ─── Config Builder ───────────────────────────────────────────

export interface CreateAgentConfigOptions {
  /** Path to a JSON config file (optional) */
  configFilePath?: string;
  /** Whether to load from environment variables (default: true) */
  loadFromEnv?: boolean;
  /** Explicit overrides (highest precedence) */
  overrides?: Partial<AgentConfig>;
  /** Whether to validate the final config (default: true) */
  validate?: boolean;
  /** Whether to throw on validation errors (default: true). If false, returns warnings only. */
  throwOnError?: boolean;
}

/**
 * Create a fully resolved AgentConfig by merging:
 *   defaults → JSON file → env vars → explicit overrides
 *
 * @example
 * ```ts
 * // Minimal: load from env + defaults
 * const config = createAgentConfig();
 *
 * // With JSON file and overrides
 * const config = createAgentConfig({
 *   configFilePath: './agent-config.json',
 *   overrides: { agentId: 'my-agent' },
 * });
 * ```
 */
export function createAgentConfig(options: CreateAgentConfigOptions = {}): AgentConfig {
  const {
    configFilePath,
    loadFromEnv = true,
    overrides = {},
    validate = true,
    throwOnError = true,
  } = options;

  // Start with defaults
  let config: AgentConfig = { ...DEFAULT_AGENT_CONFIG };

  // Layer 1: JSON file
  if (configFilePath) {
    const fileConfig = loadConfigFromFile(configFilePath);
    config = deepMerge(config, fileConfig);
  }

  // Layer 2: Environment variables
  if (loadFromEnv) {
    const envConfig = loadConfigFromEnv();
    config = deepMerge(config, envConfig);
  }

  // Layer 3: Explicit overrides
  if (Object.keys(overrides).length > 0) {
    config = deepMerge(config, overrides);
  }

  // Validate
  if (validate) {
    const result = validateAgentConfig(config);

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        console.warn(`[AgentConfig] Warning: ${w}`);
      }
    }

    if (!result.isValid && throwOnError) {
      throw new Error(
        `Invalid agent configuration:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`
      );
    }
  }

  return config;
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Create a PoolKey with proper defaults.
 */
export function createPoolKey(params: {
  currency0: string;
  currency1: string;
  fee?: number;
  tickSpacing?: number;
  hooks: string;
}): PoolKey {
  return {
    currency0: params.currency0,
    currency1: params.currency1,
    fee: params.fee ?? 3000,
    tickSpacing: params.tickSpacing ?? 60,
    hooks: params.hooks,
  };
}

/**
 * Print a summary of the agent configuration (sensitive fields masked).
 */
export function printConfigSummary(config: AgentConfig): void {
  const maskKey = (key?: string) =>
    key ? `${key.slice(0, 6)}...${key.slice(-4)}` : '(not set)';

  console.log('╔══════════════════════════════════════╗');
  console.log('║      Agent Configuration Summary     ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║ Agent ID:    ${config.agentId}`);
  console.log(`║ Strategy:    ${config.strategy.name}`);
  console.log(`║ Chain ID:    ${config.chainId}`);
  console.log(`║ RPC URL:     ${config.rpcUrl}`);
  console.log(`║ Wallet:      ${config.wallet.address || '(not set)'}`);
  console.log(`║ Private Key: ${maskKey(config.wallet.privateKey)}`);
  console.log(`║ Hook:        ${config.hookAddress || '(not set)'}`);
  console.log(`║ PoolManager: ${config.poolManagerAddress || '(not set)'}`);
  console.log(`║ Pools:       ${config.pools.length}`);
  console.log('╠──────────────────────────────────────╣');
  console.log(`║ Deadline:    ${config.commitmentSettings.defaultDeadlineOffset}s`);
  console.log(`║ Min commits: ${config.commitmentSettings.minCommitments}`);
  console.log(`║ Batch intv:  ${config.commitmentSettings.batchInterval}s`);
  console.log(`║ Poll intv:   ${config.monitoringSettings.pollInterval}ms`);
  console.log(`║ Max retries: ${config.monitoringSettings.maxRetries}`);
  console.log(`║ Slippage:    ${config.tradingSettings.defaultSlippageBps} bps`);
  console.log('╚══════════════════════════════════════╝');
}
