/**
 * BatchCoordinator — Multi-agent coordination for batch timing and execution
 *
 * In PrivBatch, multiple agents submit commitments independently, but batch
 * execution must be coordinated so that:
 * - The batch only fires when enough agents are ready
 * - Agents can signal their readiness with optional preferences
 * - Conflicting preferences (e.g. different slippage) are resolved via voting
 * - A countdown window gives stragglers time to join
 *
 * ## Flow
 * 1. Agents call `signalReady()` with their preferences
 * 2. Coordinator tracks readiness per pool
 * 3. When quorum is met, a countdown starts
 * 4. At countdown expiry (or all agents ready), `onBatchReady` fires
 * 5. The BatchExecutor / AgentManager hooks into `onBatchReady` to execute
 */

import { PoolId } from '../types/interfaces';

// ─── Types ────────────────────────────────────────────────────

export interface AgentReadinessSignal {
  agentId: string;
  poolId: PoolId;
  /** Agent is ready to participate in the next batch */
  ready: boolean;
  /** Number of commitments this agent has pending */
  pendingCommitments: number;
  /** Agent's preferred max slippage (bps) for this batch */
  preferredSlippageBps?: number;
  /** Agent's preferred deadline extension (seconds) */
  preferredDeadlineExtension?: number;
  /** Timestamp of the signal */
  timestamp: number;
}

export interface BatchParameters {
  /** Resolved slippage for the batch (bps) */
  slippageBps: number;
  /** Resolved deadline extension (seconds) */
  deadlineExtension: number;
  /** Agents participating */
  participatingAgents: string[];
  /** Total pending commitments across all agents */
  totalCommitments: number;
}

export interface ConflictResolution {
  /** How to resolve conflicting numeric preferences */
  strategy: 'median' | 'mean' | 'min' | 'max';
}

export type BatchReadyCallback = (
  poolId: PoolId,
  params: BatchParameters
) => void | Promise<void>;

export interface BatchCoordinatorConfig {
  /** Minimum agents required before a batch can proceed (default: 2) */
  quorum?: number;
  /** Minimum total commitments required (default: 2, matches on-chain MIN_COMMITMENTS) */
  minTotalCommitments?: number;
  /** Countdown window in ms after quorum is met (default: 30000 = 30s) */
  countdownMs?: number;
  /** How to resolve conflicting preferences (default: 'median') */
  conflictResolution?: ConflictResolution;
  /** Default slippage (bps) when no agent specifies one (default: 50) */
  defaultSlippageBps?: number;
  /** Default deadline extension in seconds (default: 300) */
  defaultDeadlineExtension?: number;
  /** Stale signal threshold in ms (default: 120000 = 2 min) */
  staleSignalMs?: number;
}

interface PoolCoordinationState {
  signals: Map<string, AgentReadinessSignal>; // agentId → signal
  countdownTimer?: ReturnType<typeof setTimeout>;
  countdownStartedAt?: number;
  lastBatchAt: number;
}

// ─── Coordinator ──────────────────────────────────────────────

export class BatchCoordinator {
  private pools: Map<PoolId, PoolCoordinationState> = new Map();
  private config: Required<BatchCoordinatorConfig>;
  private callbacks: BatchReadyCallback[] = [];
  private registeredAgents: Set<string> = new Set();

  constructor(config: BatchCoordinatorConfig = {}) {
    this.config = {
      quorum: config.quorum ?? 2,
      minTotalCommitments: config.minTotalCommitments ?? 2,
      countdownMs: config.countdownMs ?? 30000,
      conflictResolution: config.conflictResolution ?? { strategy: 'median' },
      defaultSlippageBps: config.defaultSlippageBps ?? 50,
      defaultDeadlineExtension: config.defaultDeadlineExtension ?? 300,
      staleSignalMs: config.staleSignalMs ?? 120000,
    };
  }

  // ─── Agent Registration ─────────────────────────────────────

  /**
   * Register an agent with the coordinator
   */
  registerAgent(agentId: string): void {
    this.registeredAgents.add(agentId);
  }

  /**
   * Unregister an agent and remove all its signals
   */
  unregisterAgent(agentId: string): void {
    this.registeredAgents.delete(agentId);
    for (const state of this.pools.values()) {
      state.signals.delete(agentId);
    }
  }

  // ─── Readiness Signaling ────────────────────────────────────

  /**
   * Signal that an agent is ready (or not) for the next batch on a pool.
   * When quorum is reached, a countdown begins. At countdown expiry the
   * batch fires.
   */
  signalReady(signal: AgentReadinessSignal): void {
    if (!this.registeredAgents.has(signal.agentId)) {
      console.warn(`[Coordinator] Unknown agent "${signal.agentId}" — register first`);
      return;
    }

    const state = this.getOrCreatePool(signal.poolId);

    if (signal.ready) {
      state.signals.set(signal.agentId, signal);
    } else {
      state.signals.delete(signal.agentId);
    }

    // Prune stale signals
    this.pruneStaleSignals(state);

    // Check if quorum is now met
    this.evaluatePool(signal.poolId, state);
  }

  /**
   * Withdraw readiness for a pool
   */
  withdrawReady(agentId: string, poolId: PoolId): void {
    const state = this.pools.get(poolId);
    if (state) {
      state.signals.delete(agentId);
      // If countdown was running and we lost quorum, cancel it
      if (this.getReadyCount(state) < this.config.quorum && state.countdownTimer) {
        clearTimeout(state.countdownTimer);
        state.countdownTimer = undefined;
        state.countdownStartedAt = undefined;
        console.log(`[Coordinator] Pool ${poolId.slice(0, 10)}...: quorum lost, countdown cancelled`);
      }
    }
  }

  // ─── Voting / Conflict Resolution ──────────────────────────

  /**
   * Resolve batch parameters from all ready agents' preferences
   */
  resolveBatchParameters(poolId: PoolId): BatchParameters {
    const state = this.pools.get(poolId);
    if (!state) {
      return this.defaultBatchParams();
    }

    const readySignals = this.getReadySignals(state);
    if (readySignals.length === 0) {
      return this.defaultBatchParams();
    }

    // Collect preferences
    const slippageValues = readySignals
      .filter((s) => s.preferredSlippageBps !== undefined)
      .map((s) => s.preferredSlippageBps!);

    const deadlineValues = readySignals
      .filter((s) => s.preferredDeadlineExtension !== undefined)
      .map((s) => s.preferredDeadlineExtension!);

    // Resolve via configured strategy
    const resolvedSlippage =
      slippageValues.length > 0
        ? this.resolveConflict(slippageValues)
        : this.config.defaultSlippageBps;

    const resolvedDeadline =
      deadlineValues.length > 0
        ? this.resolveConflict(deadlineValues)
        : this.config.defaultDeadlineExtension;

    const totalCommitments = readySignals.reduce(
      (sum, s) => sum + s.pendingCommitments,
      0
    );

    return {
      slippageBps: Math.round(resolvedSlippage),
      deadlineExtension: Math.round(resolvedDeadline),
      participatingAgents: readySignals.map((s) => s.agentId),
      totalCommitments,
    };
  }

  // ─── Callbacks ──────────────────────────────────────────────

  /**
   * Register a callback that fires when a batch is ready to execute.
   */
  onBatchReady(callback: BatchReadyCallback): void {
    this.callbacks.push(callback);
  }

  // ─── Queries ────────────────────────────────────────────────

  /**
   * Get the current readiness state for a pool
   */
  getPoolState(poolId: PoolId): {
    readyAgents: string[];
    totalReady: number;
    quorumMet: boolean;
    countdownActive: boolean;
    countdownRemainingMs: number;
    totalPendingCommitments: number;
  } {
    const state = this.pools.get(poolId);
    if (!state) {
      return {
        readyAgents: [],
        totalReady: 0,
        quorumMet: false,
        countdownActive: false,
        countdownRemainingMs: 0,
        totalPendingCommitments: 0,
      };
    }

    const readySignals = this.getReadySignals(state);
    const totalReady = readySignals.length;
    const quorumMet = totalReady >= this.config.quorum;

    let countdownRemainingMs = 0;
    if (state.countdownStartedAt) {
      const elapsed = Date.now() - state.countdownStartedAt;
      countdownRemainingMs = Math.max(0, this.config.countdownMs - elapsed);
    }

    return {
      readyAgents: readySignals.map((s) => s.agentId),
      totalReady,
      quorumMet,
      countdownActive: !!state.countdownTimer,
      countdownRemainingMs,
      totalPendingCommitments: readySignals.reduce(
        (sum, s) => sum + s.pendingCommitments,
        0
      ),
    };
  }

  /**
   * Get the number of registered agents
   */
  getRegisteredAgentCount(): number {
    return this.registeredAgents.size;
  }

  /**
   * Check if all registered agents are ready for a pool
   */
  allAgentsReady(poolId: PoolId): boolean {
    const state = this.pools.get(poolId);
    if (!state) return false;
    return this.getReadyCount(state) >= this.registeredAgents.size;
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  /**
   * Reset all coordination state for a pool (after batch execution)
   */
  resetPool(poolId: PoolId): void {
    const state = this.pools.get(poolId);
    if (state) {
      if (state.countdownTimer) clearTimeout(state.countdownTimer);
      state.signals.clear();
      state.countdownTimer = undefined;
      state.countdownStartedAt = undefined;
      state.lastBatchAt = Date.now();
    }
  }

  /**
   * Reset all pools
   */
  resetAll(): void {
    for (const poolId of this.pools.keys()) {
      this.resetPool(poolId);
    }
  }

  /**
   * Clean up timers
   */
  destroy(): void {
    for (const state of this.pools.values()) {
      if (state.countdownTimer) clearTimeout(state.countdownTimer);
    }
    this.pools.clear();
    this.callbacks.length = 0;
  }

  // ─── Internal ───────────────────────────────────────────────

  private getOrCreatePool(poolId: PoolId): PoolCoordinationState {
    let state = this.pools.get(poolId);
    if (!state) {
      state = {
        signals: new Map(),
        lastBatchAt: 0,
      };
      this.pools.set(poolId, state);
    }
    return state;
  }

  private getReadySignals(state: PoolCoordinationState): AgentReadinessSignal[] {
    return Array.from(state.signals.values()).filter((s) => s.ready);
  }

  private getReadyCount(state: PoolCoordinationState): number {
    return this.getReadySignals(state).length;
  }

  private pruneStaleSignals(state: PoolCoordinationState): void {
    const now = Date.now();
    for (const [agentId, signal] of state.signals) {
      if (now - signal.timestamp > this.config.staleSignalMs) {
        state.signals.delete(agentId);
        console.log(`[Coordinator] Pruned stale signal from "${agentId}"`);
      }
    }
  }

  /**
   * Evaluate whether a pool has reached quorum and start/fire countdown
   */
  private evaluatePool(poolId: PoolId, state: PoolCoordinationState): void {
    const readySignals = this.getReadySignals(state);
    const totalReady = readySignals.length;
    const totalCommitments = readySignals.reduce(
      (sum, s) => sum + s.pendingCommitments,
      0
    );

    const quorumMet = totalReady >= this.config.quorum;
    const commitmentsEnough = totalCommitments >= this.config.minTotalCommitments;

    if (!quorumMet || !commitmentsEnough) {
      return; // Not ready yet
    }

    // If all agents are ready, fire immediately (no need to wait)
    if (totalReady >= this.registeredAgents.size) {
      if (state.countdownTimer) {
        clearTimeout(state.countdownTimer);
        state.countdownTimer = undefined;
      }
      this.fireBatchReady(poolId, state);
      return;
    }

    // Otherwise start countdown if not already running
    if (!state.countdownTimer) {
      console.log(
        `[Coordinator] Pool ${poolId.slice(0, 10)}...: quorum met (${totalReady}/${this.config.quorum}), ` +
        `starting ${this.config.countdownMs}ms countdown`
      );
      state.countdownStartedAt = Date.now();
      state.countdownTimer = setTimeout(() => {
        state.countdownTimer = undefined;
        state.countdownStartedAt = undefined;
        this.fireBatchReady(poolId, state);
      }, this.config.countdownMs);
    }
  }

  /**
   * Fire the batchReady event
   */
  private async fireBatchReady(
    poolId: PoolId,
    _state: PoolCoordinationState
  ): Promise<void> {
    const params = this.resolveBatchParameters(poolId);

    console.log(
      `[Coordinator] Pool ${poolId.slice(0, 10)}...: BATCH READY — ` +
      `${params.participatingAgents.length} agents, ${params.totalCommitments} commitments, ` +
      `slippage=${params.slippageBps}bps`
    );

    for (const cb of this.callbacks) {
      try {
        await cb(poolId, params);
      } catch (err) {
        console.error('[Coordinator] Callback error:', err);
      }
    }

    // Reset pool state after firing
    this.resetPool(poolId);
  }

  /**
   * Resolve a list of numeric preference values using the configured strategy
   */
  private resolveConflict(values: number[]): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];

    const sorted = [...values].sort((a, b) => a - b);

    switch (this.config.conflictResolution.strategy) {
      case 'median': {
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
      }
      case 'mean':
        return values.reduce((sum, v) => sum + v, 0) / values.length;
      case 'min':
        return sorted[0];
      case 'max':
        return sorted[sorted.length - 1];
      default:
        return sorted[Math.floor(sorted.length / 2)]; // fallback: median
    }
  }

  private defaultBatchParams(): BatchParameters {
    return {
      slippageBps: this.config.defaultSlippageBps,
      deadlineExtension: this.config.defaultDeadlineExtension,
      participatingAgents: [],
      totalCommitments: 0,
    };
  }
}
