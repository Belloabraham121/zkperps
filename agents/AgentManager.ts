/**
 * AgentManager - Orchestrates multiple trading agents
 * 
 * This class manages:
 * - Multiple agent registration and lifecycle
 * - Continuous pool monitoring coordination
 * - Batch execution coordination across agents
 * - Error handling and recovery
 */

import { ethers } from 'ethers';
import { TradingAgent } from './TradingAgent';
import {
  AgentConfig,
  AgentStatus,
  AgentMetrics,
  PoolKey,
  PoolId,
  SwapIntent,
  CommitmentData,
} from './types/interfaces';

export interface AgentRegistration {
  agent: TradingAgent;
  config: AgentConfig;
  registeredAt: number;
  lastError?: Error;
  errorCount: number;
  restartCount: number;
}

export interface BatchExecutionState {
  poolId: PoolId;
  poolKey: PoolKey;
  pendingCommitments: CommitmentData[];
  lastChecked: number;
  readyToExecute: boolean;
}

export class AgentManager {
  private agents: Map<string, AgentRegistration>; // agentId -> AgentRegistration
  private batchStates: Map<PoolId, BatchExecutionState>; // poolId -> BatchState
  private monitoringInterval?: ReturnType<typeof setInterval>;
  private batchCheckInterval?: ReturnType<typeof setInterval>;
  private isRunning: boolean;
  private hookContract?: ethers.Contract;
  private provider: ethers.JsonRpcProvider;
  private signer?: ethers.Wallet;

  // Configuration
  private readonly monitoringIntervalMs: number;
  private readonly batchCheckIntervalMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly hookAddress: string;

  constructor(config: {
    hookAddress: string;
    rpcUrl: string;
    privateKey?: string;
    monitoringIntervalMs?: number;
    batchCheckIntervalMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  }) {
    this.agents = new Map();
    this.batchStates = new Map();
    this.isRunning = false;
    this.hookAddress = config.hookAddress;
    this.monitoringIntervalMs = config.monitoringIntervalMs || 30000; // 30 seconds
    this.batchCheckIntervalMs = config.batchCheckIntervalMs || 60000; // 1 minute
    this.maxRetries = config.maxRetries || 3;
    this.retryDelayMs = config.retryDelayMs || 5000; // 5 seconds

    // Initialize provider
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Initialize signer if private key provided
    if (config.privateKey) {
      this.signer = new ethers.Wallet(config.privateKey, this.provider);
      this.initializeHookContract();
    }
  }

  /**
   * Initialize the PrivBatchHook contract interface
   */
  private initializeHookContract(): void {
    if (!this.signer) {
      throw new Error('Signer not initialized. Provide privateKey in constructor.');
    }

    this.hookContract = new ethers.Contract(
      this.hookAddress,
      [
        'function checker(bytes32 poolId) external view returns (bool canExec, bytes memory execPayload)',
        'function revealAndBatchExecute(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) calldata key, tuple(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient, uint256 nonce, uint256 deadline)[] calldata reveals) external',
        'function getPendingCommitmentCount(bytes32 poolId) external view returns (uint256 count)',
        'event CommitmentSubmitted(bytes32 indexed poolId, bytes32 indexed commitmentHash)',
        'event BatchExecuted(bytes32 indexed poolId, int256 netDelta0, int256 netDelta1, uint256 batchSize, uint256 timestamp)',
      ],
      this.signer
    );
  }

  /**
   * Register an agent with the manager
   */
  registerAgent(agent: TradingAgent, config: AgentConfig): void {
    if (this.agents.has(config.agentId)) {
      throw new Error(`Agent with ID ${config.agentId} is already registered`);
    }

    const registration: AgentRegistration = {
      agent,
      config,
      registeredAt: Date.now(),
      errorCount: 0,
      restartCount: 0,
    };

    this.agents.set(config.agentId, registration);

    // Initialize batch states for agent's pools
    for (const pool of config.pools) {
      const poolId = this.getPoolId(pool);
      if (!this.batchStates.has(poolId)) {
        this.batchStates.set(poolId, {
          poolId,
          poolKey: pool,
          pendingCommitments: [],
          lastChecked: 0,
          readyToExecute: false,
        });
      }
    }

    console.log(`[AgentManager] Registered agent: ${config.agentId}`);
  }

  /**
   * Unregister an agent
   */
  async unregisterAgent(agentId: string): Promise<void> {
    const registration = this.agents.get(agentId);
    if (!registration) {
      throw new Error(`Agent with ID ${agentId} is not registered`);
    }

    // Stop the agent if it's running
    if (registration.agent.getStatus() !== AgentStatus.STOPPED) {
      await registration.agent.stop();
    }

    this.agents.delete(agentId);
    console.log(`[AgentManager] Unregistered agent: ${agentId}`);
  }

  /**
   * Start all registered agents
   */
  async startAll(): Promise<void> {
    if (this.isRunning) {
      throw new Error('AgentManager is already running');
    }

    this.isRunning = true;
    console.log('[AgentManager] Starting all agents...');

    // Start all agents
    const startPromises = Array.from(this.agents.values()).map(async (registration) => {
      try {
        if (registration.agent.getStatus() === AgentStatus.STOPPED) {
          await registration.agent.start();
          console.log(`[AgentManager] Started agent: ${registration.config.agentId}`);
        }
      } catch (error) {
        console.error(
          `[AgentManager] Error starting agent ${registration.config.agentId}:`,
          error
        );
        registration.lastError = error as Error;
        registration.errorCount++;
        await this.handleAgentError(registration);
      }
    });

    await Promise.allSettled(startPromises);

    // Start monitoring and batch checking loops
    this.startMonitoringLoop();
    this.startBatchCheckLoop();

    console.log('[AgentManager] All agents started');
  }

  /**
   * Stop all registered agents
   */
  async stopAll(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    console.log('[AgentManager] Stopping all agents...');

    // Stop monitoring loops
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    if (this.batchCheckInterval) {
      clearInterval(this.batchCheckInterval);
      this.batchCheckInterval = undefined;
    }

    // Stop all agents
    const stopPromises = Array.from(this.agents.values()).map(async (registration) => {
      try {
        await registration.agent.stop();
        console.log(`[AgentManager] Stopped agent: ${registration.config.agentId}`);
      } catch (error) {
        console.error(
          `[AgentManager] Error stopping agent ${registration.config.agentId}:`,
          error
        );
      }
    });

    await Promise.allSettled(stopPromises);
    console.log('[AgentManager] All agents stopped');
  }

  /**
   * Start the monitoring loop for continuous pool monitoring
   */
  private startMonitoringLoop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Initial check
    this.monitorAgents().catch((error) => {
      console.error('[AgentManager] Error in initial monitoring:', error);
    });

    // Set up periodic monitoring
    this.monitoringInterval = setInterval(() => {
      this.monitorAgents().catch((error) => {
        console.error('[AgentManager] Error in monitoring loop:', error);
      });
    }, this.monitoringIntervalMs);
  }

  /**
   * Monitor all agents and collect commitments
   */
  private async monitorAgents(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    for (const [agentId, registration] of this.agents.entries()) {
      try {
        // Check agent status
        const status = registration.agent.getStatus();
        if (status === AgentStatus.ERROR) {
          await this.handleAgentError(registration);
        } else if (status === AgentStatus.STOPPED && this.isRunning) {
          // Agent stopped unexpectedly, try to restart
          console.log(`[AgentManager] Agent ${agentId} stopped unexpectedly, attempting restart...`);
          await this.restartAgent(registration);
        }

        // Collect pending commitments from agent
        const pendingCommitments = registration.agent.getPendingCommitments();
        for (const commitment of pendingCommitments) {
          this.addCommitmentToBatchState(commitment);
        }
      } catch (error) {
        console.error(`[AgentManager] Error monitoring agent ${agentId}:`, error);
        registration.lastError = error as Error;
        registration.errorCount++;
        await this.handleAgentError(registration);
      }
    }
  }

  /**
   * Add commitment to batch state
   */
  private addCommitmentToBatchState(commitment: CommitmentData): void {
    const batchState = this.batchStates.get(commitment.poolId);
    if (!batchState) {
      console.warn(`[AgentManager] No batch state found for poolId: ${commitment.poolId}`);
      return;
    }

    // Check if commitment already exists
    const exists = batchState.pendingCommitments.some(
      (c) => c.commitmentHash === commitment.commitmentHash
    );

    if (!exists) {
      batchState.pendingCommitments.push(commitment);
    }
  }

  /**
   * Start the batch execution check loop
   */
  private startBatchCheckLoop(): void {
    if (this.batchCheckInterval) {
      clearInterval(this.batchCheckInterval);
    }

    // Initial check
    this.checkAndExecuteBatches().catch((error) => {
      console.error('[AgentManager] Error in initial batch check:', error);
    });

    // Set up periodic batch checking
    this.batchCheckInterval = setInterval(() => {
      this.checkAndExecuteBatches().catch((error) => {
        console.error('[AgentManager] Error in batch check loop:', error);
      });
    }, this.batchCheckIntervalMs);
  }

  /**
   * Check batch conditions and execute if ready
   */
  private async checkAndExecuteBatches(): Promise<void> {
    if (!this.isRunning || !this.hookContract) {
      return;
    }

    for (const [poolId, batchState] of this.batchStates.entries()) {
      try {
        // Check on-chain if batch is ready
        // poolId is a hex string, ethers will convert it to bytes32
        const [canExec] = await this.hookContract.checker(poolId);

        if (canExec && batchState.pendingCommitments.length > 0) {
          await this.executeBatch(batchState);
        } else {
          // Update batch state
          batchState.lastChecked = Date.now();
          batchState.readyToExecute = canExec;
        }
      } catch (error) {
        console.error(`[AgentManager] Error checking batch for pool ${poolId}:`, error);
      }
    }
  }

  /**
   * Execute a batch by collecting reveals and calling revealAndBatchExecute
   */
  private async executeBatch(batchState: BatchExecutionState): Promise<void> {
    if (!this.hookContract || !this.signer) {
      throw new Error('Hook contract or signer not initialized');
    }

    try {
      // Collect reveals from pending commitments
      const reveals: SwapIntent[] = batchState.pendingCommitments
        .filter((c) => !c.revealed)
        .map((c) => c.swapIntent);

      if (reveals.length === 0) {
        console.log(`[AgentManager] No reveals to execute for pool ${batchState.poolId}`);
        return;
      }

      // Prepare pool key for contract call
      const poolKey = [
        batchState.poolKey.currency0,
        batchState.poolKey.currency1,
        batchState.poolKey.fee,
        batchState.poolKey.tickSpacing,
        batchState.poolKey.hooks,
      ];

      // Execute batch
      console.log(
        `[AgentManager] Executing batch for pool ${batchState.poolId} with ${reveals.length} reveals`
      );
      const tx = await this.hookContract.revealAndBatchExecute(poolKey, reveals);
      const receipt = await tx.wait();

      // Mark commitments as revealed
      for (const commitment of batchState.pendingCommitments) {
        commitment.revealed = true;
      }

      // Clear pending commitments
      batchState.pendingCommitments = [];
      batchState.lastChecked = Date.now();
      batchState.readyToExecute = false;

      console.log(
        `[AgentManager] Batch executed successfully. Tx: ${receipt.hash}`
      );

      // Update agent metrics
      this.updateAgentMetricsAfterBatch(reveals.length);
    } catch (error) {
      console.error(`[AgentManager] Error executing batch:`, error);
      throw error;
    }
  }

  /**
   * Update agent metrics after batch execution
   * Note: Individual agent metrics are updated by the agent itself
   * This method is a placeholder for future manager-level metric tracking
   */
  private updateAgentMetricsAfterBatch(_batchSize: number): void {
    // Future: Implement manager-level batch execution metrics
    // For now, individual agents track their own metrics
  }

  /**
   * Handle agent errors with retry logic
   */
  private async handleAgentError(registration: AgentRegistration): Promise<void> {
    if (registration.errorCount >= this.maxRetries) {
      console.error(
        `[AgentManager] Agent ${registration.config.agentId} exceeded max retries. Stopping agent.`
      );
      try {
        await registration.agent.stop();
      } catch (error) {
        console.error(`[AgentManager] Error stopping failed agent:`, error);
      }
      return;
    }

    // Wait before retry
    await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));

    // Attempt to restart the agent
    await this.restartAgent(registration);
  }

  /**
   * Restart an agent
   */
  private async restartAgent(registration: AgentRegistration): Promise<void> {
    try {
      const currentStatus = registration.agent.getStatus();
      
      if (currentStatus !== AgentStatus.STOPPED) {
        await registration.agent.stop();
      }

      // Wait a bit before restarting
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await registration.agent.start();
      registration.restartCount++;
      registration.errorCount = 0; // Reset error count on successful restart
      console.log(`[AgentManager] Successfully restarted agent: ${registration.config.agentId}`);
    } catch (error) {
      console.error(
        `[AgentManager] Error restarting agent ${registration.config.agentId}:`,
        error
      );
      registration.lastError = error as Error;
      registration.errorCount++;
    }
  }

  /**
   * Get pool ID from pool key (matches TradingAgent implementation)
   */
  private getPoolId(pool: PoolKey): PoolId {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [pool.currency0, pool.currency1, pool.fee, pool.tickSpacing, pool.hooks]
    );
    return ethers.keccak256(encoded);
  }

  /**
   * Get all registered agents
   */
  getAgents(): Map<string, AgentRegistration> {
    return new Map(this.agents);
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all batch states
   */
  getBatchStates(): Map<PoolId, BatchExecutionState> {
    return new Map(this.batchStates);
  }

  /**
   * Get batch state for a pool
   */
  getBatchState(poolId: PoolId): BatchExecutionState | undefined {
    return this.batchStates.get(poolId);
  }

  /**
   * Get manager status
   */
  isManagerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get aggregated metrics from all agents
   */
  getAllMetrics(): Map<string, AgentMetrics> {
    const metrics = new Map<string, AgentMetrics>();
    for (const [agentId, registration] of this.agents.entries()) {
      metrics.set(agentId, registration.agent.getMetrics());
    }
    return metrics;
  }
}
