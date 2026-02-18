/**
 * Core interfaces and types for the Agentic Finance component
 */

import { BigNumberish } from "ethers";

/**
 * Uniswap v4 Pool Key structure
 */
export interface PoolKey {
  currency0: string; // Currency address
  currency1: string; // Currency address
  fee: number; // Fee tier (e.g., 3000 for 0.3%)
  tickSpacing: number;
  hooks: string; // Hook address
}

/**
 * Pool identifier (hash of PoolKey)
 */
export type PoolId = string;

/**
 * Swap direction
 */
export enum SwapDirection {
  ZERO_FOR_ONE = "ZERO_FOR_ONE", // currency0 -> currency1
  ONE_FOR_ZERO = "ONE_FOR_ZERO", // currency1 -> currency0
}

/**
 * Market data for a pool
 */
export interface MarketData {
  poolId: PoolId;
  poolKey: PoolKey;

  // Price data
  currentPrice: string; // Current price (token1/token0)
  priceChange1h: number; // Price change percentage over 1 hour
  priceChange24h: number; // Price change percentage over 24 hours

  // Liquidity data
  totalLiquidity: string; // Total liquidity in the pool
  liquidity0: string; // Liquidity in currency0
  liquidity1: string; // Liquidity in currency1

  // Volume data
  volume1h: string; // Volume over 1 hour
  volume24h: string; // Volume over 24 hours

  // Recent activity
  recentSwaps: SwapEvent[]; // Recent swap events

  // Timestamp
  timestamp: number; // When this data was collected
}

/**
 * Swap event from the pool
 */
export interface SwapEvent {
  poolId: PoolId;
  timestamp: number;
  amount0: string;
  amount1: string;
  zeroForOne: boolean;
  sqrtPriceX96: string;
}

/**
 * Trading decision made by an agent
 */
export interface TradeDecision {
  shouldTrade: boolean; // Whether to execute a trade
  direction?: SwapDirection; // Swap direction (if shouldTrade is true)
  amountIn?: string; // Amount to swap in (if shouldTrade is true)
  minAmountOut?: string; // Minimum amount out (slippage protection)
  confidence: number; // Confidence level (0-1)
  reasoning: string; // Human-readable explanation of the decision
  timestamp: number; // When the decision was made
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  agentId: string; // Unique identifier for the agent
  wallet: {
    address: string; // Agent wallet address
    privateKey?: string; // Private key (should be stored securely)
  };
  strategy: {
    name: string; // Strategy name (e.g., 'momentum', 'arbitrage')
    config: Record<string, any>; // Strategy-specific configuration
  };
  pools: PoolKey[]; // Pools this agent monitors
  hookAddress: string; // PrivBatchHook contract address
  poolManagerAddress: string; // Uniswap v4 PoolManager address
  rpcUrl: string; // RPC endpoint URL
  chainId: number; // Chain ID

  // Commitment settings
  commitmentSettings: {
    defaultDeadlineOffset: number; // Default deadline offset in seconds (e.g., 3600 for 1 hour)
    minCommitments: number; // Minimum commitments required for batch execution
    batchInterval: number; // Batch interval in seconds
  };

  // Monitoring settings
  monitoringSettings: {
    pollInterval: number; // Poll interval in milliseconds
    maxRetries: number; // Maximum retries for failed operations
    retryDelay: number; // Delay between retries in milliseconds
  };

  // Trading settings
  tradingSettings: {
    maxAmountIn: string; // Maximum amount to trade in a single commitment
    minAmountIn: string; // Minimum amount to trade in a single commitment
    defaultSlippageBps: number; // Default slippage in basis points (e.g., 50 for 0.5%)
  };
}

/**
 * Trading strategy interface
 * All trading strategies must implement this interface
 */
export interface TradingStrategy {
  /**
   * Strategy name
   */
  name: string;

  /**
   * Evaluate market data and decide whether to trade
   * @param marketData Current market data for the pool
   * @param config Agent configuration
   * @returns Trade decision
   */
  shouldTrade(
    marketData: MarketData,
    config: AgentConfig,
  ): Promise<TradeDecision>;

  /**
   * Calculate the amount to trade based on market conditions
   * @param marketData Current market data
   * @param decision Trade decision (shouldTrade must be true)
   * @param config Agent configuration
   * @returns Amount to trade in (in token units)
   */
  calculateAmount(
    marketData: MarketData,
    decision: TradeDecision,
    config: AgentConfig,
  ): Promise<string>;

  /**
   * Calculate minimum amount out for slippage protection
   * @param amountIn Amount to trade in
   * @param marketData Current market data
   * @param direction Swap direction
   * @param slippageBps Slippage in basis points
   * @returns Minimum amount out
   */
  calculateMinAmountOut(
    amountIn: string,
    marketData: MarketData,
    direction: SwapDirection,
    slippageBps: number,
  ): Promise<string>;

  /**
   * Get strategy-specific configuration schema
   * @returns Configuration schema/validation rules
   */
  getConfigSchema?(): Record<string, any>;
}

/**
 * Swap intent for commitment submission
 */
export interface SwapIntent {
  user: string; // User address
  tokenIn: string; // Input token address (Currency)
  tokenOut: string; // Output token address (Currency)
  amountIn: BigNumberish; // Amount to swap in
  minAmountOut: BigNumberish; // Minimum amount out (slippage protection)
  recipient: string; // Recipient address
  nonce: BigNumberish; // Nonce for uniqueness
  deadline: BigNumberish; // Deadline timestamp
}

/**
 * Commitment data (off-chain storage)
 */
export interface CommitmentData {
  commitmentHash: string; // Hash of the swap intent
  swapIntent: SwapIntent; // Original swap intent (stored off-chain)
  poolId: PoolId; // Pool ID
  submittedAt: number; // Timestamp when commitment was submitted
  revealed: boolean; // Whether this commitment has been revealed
}

/**
 * Agent status
 */
export enum AgentStatus {
  STOPPED = "STOPPED",
  STARTING = "STARTING",
  RUNNING = "RUNNING",
  PAUSED = "PAUSED",
  ERROR = "ERROR",
}

/**
 * Agent metrics
 */
export interface AgentMetrics {
  agentId: string;
  status: AgentStatus;
  uptime: number; // Uptime in seconds
  totalCommitments: number; // Total commitments submitted
  totalReveals: number; // Total reveals collected
  totalBatches: number; // Total batches executed
  totalTrades: number; // Total trades executed
  totalVolume: string; // Total trading volume
  lastActivity: number; // Timestamp of last activity
  errors: number; // Number of errors encountered
}
