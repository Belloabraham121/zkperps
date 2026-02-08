/**
 * BatchExecutor - Coordinates batch execution across agents
 *
 * Responsibilities:
 * - Poll batch readiness via checker()
 * - Collect reveals from RevealManager and prepare for execution
 * - Execute batches (ZK and non-ZK paths)
 * - Handle errors and retries for failed executions
 * - Track execution metrics
 */

import {
  PoolKey,
  PoolId,
} from '../types/interfaces';
import { PrivBatchHookClient, ZKProof, TransactionResult } from './PrivBatchHookClient';
import { RevealManager } from './RevealManager';

// ─── Types ────────────────────────────────────────────────────

export interface BatchReadiness {
  poolId: PoolId;
  canExec: boolean;
  pendingOnChain: number; // Pending commitments on-chain
  revealsReady: number; // Submitted reveals ready for execution
  meetsMinimum: boolean; // Meets MIN_COMMITMENTS
}

export interface BatchExecutionResult {
  poolId: PoolId;
  success: boolean;
  txHash?: string;
  batchSize: number;
  gasUsed?: bigint;
  error?: string;
  executedAt: number;
}

export interface BatchExecutorConfig {
  /** Poll interval for checking batch readiness (ms, default: 30000) */
  pollIntervalMs?: number;
  /** Delay after submitting reveals before executing batch (ms, default: 10000) */
  postRevealDelayMs?: number;
  /** Maximum retries for batch execution (default: 3) */
  maxRetries?: number;
  /** Retry delay base (ms, doubles each attempt, default: 5000) */
  retryBaseDelayMs?: number;
}

// ─── BatchExecutor ────────────────────────────────────────────

export class BatchExecutor {
  private hookClient: PrivBatchHookClient;
  private revealManager: RevealManager;
  private config: Required<BatchExecutorConfig>;
  private pollingInterval?: ReturnType<typeof setInterval>;
  private isRunning = false;
  private executionHistory: BatchExecutionResult[] = [];
  private zkProofs: Map<string, ZKProof> = new Map(); // commitmentHash -> proof
  private monitoredPools: Map<PoolId, PoolKey> = new Map();

  constructor(
    hookClient: PrivBatchHookClient,
    revealManager: RevealManager,
    config: BatchExecutorConfig = {}
  ) {
    this.hookClient = hookClient;
    this.revealManager = revealManager;
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 30000,
      postRevealDelayMs: config.postRevealDelayMs ?? 10000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 5000,
    };
  }

  // ─── Pool Registration ──────────────────────────────────────

  /**
   * Register a pool for batch execution monitoring
   */
  addPool(poolKey: PoolKey, poolId: PoolId): void {
    this.monitoredPools.set(poolId, poolKey);
  }

  /**
   * Remove a pool from monitoring
   */
  removePool(poolId: PoolId): void {
    this.monitoredPools.delete(poolId);
  }

  // ─── ZK Proof Storage ──────────────────────────────────────

  /**
   * Store a ZK proof for a commitment (used during batch execution)
   */
  storeProof(commitmentHash: string, proof: ZKProof): void {
    this.zkProofs.set(commitmentHash, proof);
  }

  /**
   * Get a stored ZK proof
   */
  getProof(commitmentHash: string): ZKProof | undefined {
    return this.zkProofs.get(commitmentHash);
  }

  // ─── Batch Readiness ────────────────────────────────────────

  /**
   * Check if a pool is ready for batch execution
   */
  async checkBatchReadiness(poolId: PoolId): Promise<BatchReadiness> {
    const [{ canExec }, pendingOnChain] = await Promise.all([
      this.hookClient.checker(poolId),
      this.hookClient.getPendingCommitmentCount(poolId),
    ]);

    const revealsReady = this.revealManager
      .getRevealsForPool(poolId)
      .filter((r) => r.submittedOnChain).length;

    let minCommitments = 2;
    try {
      minCommitments = await this.hookClient.getMinCommitments();
    } catch {
      // Use default
    }

    return {
      poolId,
      canExec,
      pendingOnChain,
      revealsReady,
      meetsMinimum: revealsReady >= minCommitments,
    };
  }

  /**
   * Check all monitored pools for batch readiness
   */
  async checkAllPools(): Promise<BatchReadiness[]> {
    const results: BatchReadiness[] = [];
    for (const poolId of this.monitoredPools.keys()) {
      try {
        results.push(await this.checkBatchReadiness(poolId));
      } catch (err: unknown) {
        console.error(
          `[BatchExecutor] Error checking pool ${poolId.slice(0, 10)}...:`,
          (err as Error).message
        );
      }
    }
    return results;
  }

  // ─── Batch Execution ───────────────────────────────────────

  /**
   * Execute batch for a pool using the ZK path
   * 1. Submit pending reveals
   * 2. Wait for RPC sync
   * 3. Call revealAndBatchExecuteWithProofs
   */
  async executeBatchZK(
    poolId: PoolId,
    poolKey: PoolKey
  ): Promise<BatchExecutionResult> {
    try {
      // Step 1: Submit any unsubmitted reveals
      const revealResults = await this.revealManager.submitAllReveals();
      const failedReveals = revealResults.filter((r) => !r.success);
      if (failedReveals.length > 0) {
        console.warn(
          `[BatchExecutor] ${failedReveals.length} reveals failed to submit`
        );
      }

      // Step 2: Wait for RPC nodes to sync
      console.log(
        `[BatchExecutor] Waiting ${this.config.postRevealDelayMs}ms for RPC sync...`
      );
      await this.sleep(this.config.postRevealDelayMs);

      // Step 3: Gather commitment hashes and proofs
      const submittedHashes = this.revealManager.getSubmittedHashesForPool(poolId);
      if (submittedHashes.length === 0) {
        return this.failResult(poolId, 0, 'No submitted reveals for this pool');
      }

      const proofs: ZKProof[] = [];
      for (const hash of submittedHashes) {
        const proof = this.zkProofs.get(hash);
        if (!proof) {
          return this.failResult(
            poolId,
            submittedHashes.length,
            `Missing ZK proof for commitment ${hash.slice(0, 10)}...`
          );
        }
        proofs.push(proof);
      }

      // Step 4: Execute with retry
      const txResult = await this.executeWithRetry(
        () =>
          this.hookClient.revealAndBatchExecuteWithProofs(
            poolKey,
            submittedHashes,
            proofs
          ),
        'revealAndBatchExecuteWithProofs'
      );

      // Step 5: Clean up
      this.revealManager.clearExecutedReveals(submittedHashes);
      for (const hash of submittedHashes) {
        this.zkProofs.delete(hash);
      }

      const result: BatchExecutionResult = {
        poolId,
        success: true,
        txHash: txResult.hash,
        batchSize: submittedHashes.length,
        gasUsed: txResult.gasUsed,
        executedAt: Date.now(),
      };

      this.executionHistory.push(result);
      console.log(
        `[BatchExecutor] Batch executed: ${submittedHashes.length} swaps, tx=${txResult.hash}`
      );

      return result;
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || 'Unknown error';
      console.error(`[BatchExecutor] Batch execution failed:`, errorMsg);
      return this.failResult(poolId, 0, errorMsg);
    }
  }

  /**
   * Execute batch for a pool using the non-ZK path
   * Reveals must already be submitted via submitReveal()
   */
  async executeBatchStandard(
    poolId: PoolId,
    poolKey: PoolKey
  ): Promise<BatchExecutionResult> {
    try {
      // Submit any unsubmitted reveals
      await this.revealManager.submitAllReveals();
      await this.sleep(this.config.postRevealDelayMs);

      const submittedHashes = this.revealManager.getSubmittedHashesForPool(poolId);
      if (submittedHashes.length === 0) {
        return this.failResult(poolId, 0, 'No submitted reveals');
      }

      const txResult = await this.executeWithRetry(
        () => this.hookClient.revealAndBatchExecute(poolKey, submittedHashes),
        'revealAndBatchExecute'
      );

      this.revealManager.clearExecutedReveals(submittedHashes);

      const result: BatchExecutionResult = {
        poolId,
        success: true,
        txHash: txResult.hash,
        batchSize: submittedHashes.length,
        gasUsed: txResult.gasUsed,
        executedAt: Date.now(),
      };

      this.executionHistory.push(result);
      return result;
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || 'Unknown error';
      return this.failResult(poolId, 0, errorMsg);
    }
  }

  // ─── Automated Polling ──────────────────────────────────────

  /**
   * Start polling for batch readiness and auto-execute
   */
  startPolling(useZK: boolean = true): void {
    if (this.isRunning) {
      console.warn('[BatchExecutor] Already polling');
      return;
    }

    this.isRunning = true;
    console.log(
      `[BatchExecutor] Starting polling every ${this.config.pollIntervalMs}ms (ZK=${useZK})`
    );

    // Initial check
    this.pollAndExecute(useZK).catch((err) => {
      console.error('[BatchExecutor] Error in initial poll:', err);
    });

    this.pollingInterval = setInterval(() => {
      this.pollAndExecute(useZK).catch((err) => {
        console.error('[BatchExecutor] Error in polling loop:', err);
      });
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
    console.log('[BatchExecutor] Polling stopped');
  }

  /**
   * Single poll cycle: check all pools, execute if ready
   */
  private async pollAndExecute(useZK: boolean): Promise<void> {
    if (!this.isRunning) return;

    const readiness = await this.checkAllPools();

    for (const pool of readiness) {
      if (pool.canExec && pool.meetsMinimum) {
        const poolKey = this.monitoredPools.get(pool.poolId);
        if (!poolKey) continue;

        console.log(
          `[BatchExecutor] Pool ${pool.poolId.slice(0, 10)}... ready: ` +
          `${pool.revealsReady} reveals, executing...`
        );

        if (useZK) {
          await this.executeBatchZK(pool.poolId, poolKey);
        } else {
          await this.executeBatchStandard(pool.poolId, poolKey);
        }
      }
    }
  }

  // ─── Metrics ────────────────────────────────────────────────

  /**
   * Get execution history
   */
  getExecutionHistory(): BatchExecutionResult[] {
    return [...this.executionHistory];
  }

  /**
   * Get execution stats
   */
  getStats(): {
    totalBatches: number;
    successfulBatches: number;
    failedBatches: number;
    totalSwaps: number;
    totalGasUsed: bigint;
  } {
    const successful = this.executionHistory.filter((r) => r.success);
    const failed = this.executionHistory.filter((r) => !r.success);

    return {
      totalBatches: this.executionHistory.length,
      successfulBatches: successful.length,
      failedBatches: failed.length,
      totalSwaps: successful.reduce((sum, r) => sum + r.batchSize, 0),
      totalGasUsed: successful.reduce(
        (sum, r) => sum + (r.gasUsed || BigInt(0)),
        BigInt(0)
      ),
    };
  }

  /**
   * Whether the executor is currently polling
   */
  isExecutorRunning(): boolean {
    return this.isRunning;
  }

  // ─── Internal ───────────────────────────────────────────────

  private async executeWithRetry(
    txFactory: () => Promise<TransactionResult>,
    label: string
  ): Promise<TransactionResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await txFactory();
      } catch (err: unknown) {
        lastError = err as Error;
        const errorMsg = lastError.message || '';

        // Non-retryable contract errors
        if (
          errorMsg.includes('InvalidCommitment') ||
          errorMsg.includes('InsufficientCommitments') ||
          errorMsg.includes('BatchConditionsNotMet') ||
          errorMsg.includes('DeadlineExpired')
        ) {
          throw lastError;
        }

        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryBaseDelayMs * (attempt + 1);
          console.warn(
            `[BatchExecutor] ${label}: Retry ${attempt + 1}/${this.config.maxRetries} after ${delay}ms`
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error(`${label}: Failed after retries`);
  }

  private failResult(
    poolId: PoolId,
    batchSize: number,
    error: string
  ): BatchExecutionResult {
    const result: BatchExecutionResult = {
      poolId,
      success: false,
      batchSize,
      error,
      executedAt: Date.now(),
    };
    this.executionHistory.push(result);
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
