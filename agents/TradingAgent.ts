/**
 * TradingAgent - Base class for autonomous trading agents
 * 
 * This class provides the core functionality for agents that:
 * - Monitor Uniswap v4 pools
 * - Make trading decisions based on strategies
 * - Submit commitments to PrivBatchHook
 * - Coordinate batch execution
 */

import { ethers } from 'ethers';
import {
  AgentConfig,
  AgentStatus,
  AgentMetrics,
  MarketData,
  TradeDecision,
  SwapIntent,
  CommitmentData,
  PoolKey,
  PoolId,
  TradingStrategy,
  SwapDirection,
} from './types/interfaces';

export abstract class TradingAgent {
  protected config: AgentConfig;
  protected status: AgentStatus;
  protected strategy: TradingStrategy;
  protected provider: ethers.JsonRpcProvider;
  protected signer: ethers.Wallet;
  protected metrics: AgentMetrics;
  protected commitments: Map<string, CommitmentData>; // commitmentHash -> CommitmentData
  protected monitoringInterval?: ReturnType<typeof setInterval>;
  protected nonceCounter: Map<PoolId, number>; // poolId -> nonce counter

  constructor(config: AgentConfig, strategy: TradingStrategy) {
    this.config = config;
    this.strategy = strategy;
    this.status = AgentStatus.STOPPED;
    this.commitments = new Map();
    this.nonceCounter = new Map();
    
    // Initialize provider and signer
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    if (config.wallet.privateKey) {
      this.signer = new ethers.Wallet(config.wallet.privateKey, this.provider);
    } else {
      throw new Error('Wallet private key is required');
    }

    // Initialize metrics
    this.metrics = {
      agentId: config.agentId,
      status: AgentStatus.STOPPED,
      uptime: 0,
      totalCommitments: 0,
      totalReveals: 0,
      totalBatches: 0,
      totalTrades: 0,
      totalVolume: '0',
      lastActivity: Date.now(),
      errors: 0,
    };
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    if (this.status === AgentStatus.RUNNING) {
      throw new Error('Agent is already running');
    }

    this.status = AgentStatus.STARTING;
    this.metrics.status = AgentStatus.STARTING;

    try {
      // Verify wallet connection
      const address = await this.signer.getAddress();
      if (address.toLowerCase() !== this.config.wallet.address.toLowerCase()) {
        throw new Error('Wallet address mismatch');
      }

      // Initialize nonce counters for each pool
      for (const pool of this.config.pools) {
        const poolId = this.getPoolId(pool);
        this.nonceCounter.set(poolId, 0);
      }

      // Start monitoring loop
      this.startMonitoring();

      this.status = AgentStatus.RUNNING;
      this.metrics.status = AgentStatus.RUNNING;
      this.metrics.lastActivity = Date.now();

      console.log(`[${this.config.agentId}] Agent started successfully`);
    } catch (error) {
      this.status = AgentStatus.ERROR;
      this.metrics.status = AgentStatus.ERROR;
      this.metrics.errors++;
      throw error;
    }
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    if (this.status === AgentStatus.STOPPED) {
      return;
    }

    this.status = AgentStatus.STOPPED;
    this.metrics.status = AgentStatus.STOPPED;

    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    console.log(`[${this.config.agentId}] Agent stopped`);
  }

  /**
   * Pause the agent (temporarily stop monitoring)
   */
  pause(): void {
    if (this.status === AgentStatus.RUNNING) {
      this.status = AgentStatus.PAUSED;
      this.metrics.status = AgentStatus.PAUSED;
      
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = undefined;
      }

      console.log(`[${this.config.agentId}] Agent paused`);
    }
  }

  /**
   * Resume the agent
   */
  resume(): void {
    if (this.status === AgentStatus.PAUSED) {
      this.status = AgentStatus.RUNNING;
      this.metrics.status = AgentStatus.RUNNING;
      this.startMonitoring();
      console.log(`[${this.config.agentId}] Agent resumed`);
    }
  }

  /**
   * Start the monitoring loop
   */
  protected startMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Initial monitoring call
    this.monitorPools().catch((error) => {
      console.error(`[${this.config.agentId}] Error in initial monitoring:`, error);
      this.metrics.errors++;
    });

    // Set up periodic monitoring
    this.monitoringInterval = setInterval(() => {
      this.monitorPools().catch((error) => {
        console.error(`[${this.config.agentId}] Error in monitoring loop:`, error);
        this.metrics.errors++;
      });
    }, this.config.monitoringSettings.pollInterval);
  }

  /**
   * Monitor all configured pools
   */
  protected async monitorPools(): Promise<void> {
    if (this.status !== AgentStatus.RUNNING) {
      return;
    }

    for (const pool of this.config.pools) {
      try {
        await this.monitorPool(pool);
      } catch (error) {
        console.error(`[${this.config.agentId}] Error monitoring pool:`, error);
        this.metrics.errors++;
      }
    }
  }

  /**
   * Monitor a single pool and make trading decisions
   */
  protected async monitorPool(pool: PoolKey): Promise<void> {
    // Fetch market data
    const marketData = await this.fetchMarketData(pool);
    
    // Make trading decision using strategy
    const decision = await this.strategy.shouldTrade(marketData, this.config);
    
    // If decision is to trade, submit commitment
    if (decision.shouldTrade && decision.direction && decision.amountIn) {
      await this.submitCommitment(pool, decision);
    }
  }

  /**
   * Fetch market data for a pool
   * This is an abstract method that must be implemented by subclasses
   * or provided via dependency injection
   */
  protected abstract fetchMarketData(pool: PoolKey): Promise<MarketData>;

  /**
   * Submit a commitment to PrivBatchHook
   */
  protected async submitCommitment(
    pool: PoolKey,
    decision: TradeDecision
  ): Promise<void> {
    if (!decision.shouldTrade || !decision.direction || !decision.amountIn) {
      throw new Error('Invalid trade decision');
    }

    try {
      const poolId = this.getPoolId(pool);
      const nonce = this.getNextNonce(poolId);
      const deadline = this.calculateDeadline();

      // Calculate amount in and min amount out
      const amountIn = decision.amountIn;
      const minAmountOut = decision.minAmountOut || 
        await this.strategy.calculateMinAmountOut(
          amountIn,
          await this.fetchMarketData(pool),
          decision.direction,
          this.config.tradingSettings.defaultSlippageBps
        );

      // Determine token addresses based on direction
      const tokenIn = decision.direction === SwapDirection.ZERO_FOR_ONE
        ? pool.currency0
        : pool.currency1;
      const tokenOut = decision.direction === SwapDirection.ZERO_FOR_ONE
        ? pool.currency1
        : pool.currency0;

      // Create swap intent
      const swapIntent: SwapIntent = {
        user: this.config.wallet.address,
        tokenIn,
        tokenOut,
        amountIn,
        minAmountOut,
        recipient: this.config.wallet.address,
        nonce,
        deadline,
      };

      // Compute commitment hash
      const commitmentHash = this.computeCommitmentHash(swapIntent);

      // Submit commitment to hook
      const hookContract = new ethers.Contract(
        this.config.hookAddress,
        [
          'function submitCommitment(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) calldata key, bytes32 commitmentHash) external',
        ],
        this.signer
      );

      const poolKey = [
        pool.currency0,
        pool.currency1,
        pool.fee,
        pool.tickSpacing,
        pool.hooks,
      ];

      const tx = await hookContract.submitCommitment(poolKey, commitmentHash);
      await tx.wait();

      // Store commitment data off-chain
      const commitmentData: CommitmentData = {
        commitmentHash,
        swapIntent,
        poolId,
        submittedAt: Date.now(),
        revealed: false,
      };
      this.commitments.set(commitmentHash, commitmentData);

      // Update metrics
      this.metrics.totalCommitments++;
      this.metrics.lastActivity = Date.now();

      console.log(
        `[${this.config.agentId}] Commitment submitted: ${commitmentHash.slice(0, 10)}...`
      );
    } catch (error) {
      console.error(`[${this.config.agentId}] Error submitting commitment:`, error);
      this.metrics.errors++;
      throw error;
    }
  }

  /**
   * Compute commitment hash (matches on-chain computation)
   */
  protected computeCommitmentHash(swapIntent: SwapIntent): string {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        'address',
        'address',
        'address',
        'uint256',
        'uint256',
        'address',
        'uint256',
        'uint256',
      ],
      [
        swapIntent.user,
        swapIntent.tokenIn,
        swapIntent.tokenOut,
        swapIntent.amountIn,
        swapIntent.minAmountOut,
        swapIntent.recipient,
        swapIntent.nonce,
        swapIntent.deadline,
      ]
    );
    return ethers.keccak256(encoded);
  }

  /**
   * Get next nonce for a pool
   */
  protected getNextNonce(poolId: PoolId): number {
    const current = this.nonceCounter.get(poolId) || 0;
    const next = current + 1;
    this.nonceCounter.set(poolId, next);
    return next;
  }

  /**
   * Calculate deadline timestamp
   */
  protected calculateDeadline(): number {
    return Math.floor(Date.now() / 1000) + this.config.commitmentSettings.defaultDeadlineOffset;
  }

  /**
   * Get pool ID from pool key
   * This should match the on-chain computation
   */
  protected getPoolId(pool: PoolKey): PoolId {
    // This is a simplified version - actual implementation should match
    // Uniswap v4's PoolIdLibrary.toId() computation
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [pool.currency0, pool.currency1, pool.fee, pool.tickSpacing, pool.hooks]
    );
    return ethers.keccak256(encoded);
  }

  /**
   * Get agent metrics
   */
  getMetrics(): AgentMetrics {
    return { ...this.metrics };
  }

  /**
   * Get agent status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get pending commitments
   */
  getPendingCommitments(): CommitmentData[] {
    return Array.from(this.commitments.values()).filter((c) => !c.revealed);
  }

  /**
   * Get all commitments
   */
  getAllCommitments(): CommitmentData[] {
    return Array.from(this.commitments.values());
  }
}
