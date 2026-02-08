/**
 * AgentLifecycleManager — Manages agent start/stop, health monitoring, and auto-restart
 *
 * Responsibilities:
 * - Start / stop / pause / resume individual agents
 * - Periodic health checks (status, error count, stale monitoring)
 * - Automatic restart on failure with exponential backoff
 * - Structured lifecycle event logging
 * - Aggregate health report for all managed agents
 */

import { TradingAgent } from '../TradingAgent';
import { AgentConfig, AgentStatus, AgentMetrics } from '../types/interfaces';

// ─── Types ────────────────────────────────────────────────────

export enum LifecycleEvent {
  STARTING = 'STARTING',
  STARTED = 'STARTED',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  PAUSED = 'PAUSED',
  RESUMED = 'RESUMED',
  HEALTH_CHECK = 'HEALTH_CHECK',
  UNHEALTHY = 'UNHEALTHY',
  RESTARTING = 'RESTARTING',
  RESTARTED = 'RESTARTED',
  RESTART_FAILED = 'RESTART_FAILED',
  MAX_RESTARTS_EXCEEDED = 'MAX_RESTARTS_EXCEEDED',
  ERROR = 'ERROR',
}

export interface LifecycleLogEntry {
  agentId: string;
  event: LifecycleEvent;
  timestamp: number;
  message: string;
  error?: string;
}

export interface AgentHealthReport {
  agentId: string;
  status: AgentStatus;
  isHealthy: boolean;
  uptime: number;
  restartCount: number;
  consecutiveErrors: number;
  lastActivity: number;
  lastHealthCheck: number;
  metrics: AgentMetrics;
}

export interface ManagedAgent {
  agent: TradingAgent;
  config: AgentConfig;
  startedAt: number;
  restartCount: number;
  consecutiveErrors: number;
  lastHealthCheck: number;
  lastError?: Error;
}

export interface LifecycleManagerConfig {
  /** Health check interval in ms (default: 60000 = 1 min) */
  healthCheckIntervalMs?: number;
  /** Max consecutive errors before giving up restarts (default: 5) */
  maxConsecutiveErrors?: number;
  /** Max total restarts per agent (default: 10) */
  maxTotalRestarts?: number;
  /** Base restart delay in ms; doubles each attempt (default: 5000) */
  restartBaseDelayMs?: number;
  /** Max restart delay in ms (cap for backoff, default: 120000 = 2 min) */
  maxRestartDelayMs?: number;
  /** If agent has no activity for this many ms, consider it stale (default: 300000 = 5 min) */
  staleThresholdMs?: number;
}

export type LifecycleCallback = (entry: LifecycleLogEntry) => void;

// ─── Manager ──────────────────────────────────────────────────

export class AgentLifecycleManager {
  private agents: Map<string, ManagedAgent> = new Map();
  private healthCheckInterval?: ReturnType<typeof setInterval>;
  private isRunning = false;
  private config: Required<LifecycleManagerConfig>;
  private logs: LifecycleLogEntry[] = [];
  private callbacks: LifecycleCallback[] = [];
  private maxLogEntries = 1000;

  constructor(config: LifecycleManagerConfig = {}) {
    this.config = {
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 60000,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 5,
      maxTotalRestarts: config.maxTotalRestarts ?? 10,
      restartBaseDelayMs: config.restartBaseDelayMs ?? 5000,
      maxRestartDelayMs: config.maxRestartDelayMs ?? 120000,
      staleThresholdMs: config.staleThresholdMs ?? 300000,
    };
  }

  // ─── Registration ──────────────────────────────────────────

  /**
   * Register an agent for lifecycle management
   */
  register(agent: TradingAgent, config: AgentConfig): void {
    if (this.agents.has(config.agentId)) {
      throw new Error(`Agent "${config.agentId}" is already registered`);
    }

    this.agents.set(config.agentId, {
      agent,
      config,
      startedAt: 0,
      restartCount: 0,
      consecutiveErrors: 0,
      lastHealthCheck: 0,
    });

    this.log(config.agentId, LifecycleEvent.STOPPED, 'Agent registered');
  }

  /**
   * Unregister an agent (stops it first if running)
   */
  async unregister(agentId: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    if (managed.agent.getStatus() !== AgentStatus.STOPPED) {
      await this.stopAgent(agentId);
    }

    this.agents.delete(agentId);
  }

  // ─── Start / Stop ──────────────────────────────────────────

  /**
   * Start a single agent
   */
  async startAgent(agentId: string): Promise<void> {
    const managed = this.getManaged(agentId);

    this.log(agentId, LifecycleEvent.STARTING, 'Starting agent...');

    try {
      await managed.agent.start();
      managed.startedAt = Date.now();
      managed.consecutiveErrors = 0;
      this.log(agentId, LifecycleEvent.STARTED, 'Agent started successfully');
    } catch (err) {
      managed.lastError = err as Error;
      managed.consecutiveErrors++;
      this.log(agentId, LifecycleEvent.ERROR, `Failed to start: ${(err as Error).message}`, err as Error);
      throw err;
    }
  }

  /**
   * Stop a single agent
   */
  async stopAgent(agentId: string): Promise<void> {
    const managed = this.getManaged(agentId);

    this.log(agentId, LifecycleEvent.STOPPING, 'Stopping agent...');

    try {
      await managed.agent.stop();
      this.log(agentId, LifecycleEvent.STOPPED, 'Agent stopped');
    } catch (err) {
      this.log(agentId, LifecycleEvent.ERROR, `Error stopping agent: ${(err as Error).message}`, err as Error);
    }
  }

  /**
   * Pause a single agent (temporarily stop monitoring, keep state)
   */
  pauseAgent(agentId: string): void {
    const managed = this.getManaged(agentId);
    managed.agent.pause();
    this.log(agentId, LifecycleEvent.PAUSED, 'Agent paused');
  }

  /**
   * Resume a paused agent
   */
  resumeAgent(agentId: string): void {
    const managed = this.getManaged(agentId);
    managed.agent.resume();
    this.log(agentId, LifecycleEvent.RESUMED, 'Agent resumed');
  }

  /**
   * Start all registered agents
   */
  async startAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.agents.keys()).map((id) => this.startAgent(id))
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(
        `[LifecycleManager] ${failed.length}/${results.length} agents failed to start`
      );
    }

    // Start health monitoring
    this.startHealthMonitoring();
  }

  /**
   * Stop all registered agents
   */
  async stopAll(): Promise<void> {
    this.stopHealthMonitoring();

    await Promise.allSettled(
      Array.from(this.agents.keys()).map((id) => this.stopAgent(id))
    );
  }

  // ─── Health Monitoring ─────────────────────────────────────

  /**
   * Start periodic health checking
   */
  startHealthMonitoring(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks().catch((err) => {
        console.error('[LifecycleManager] Health check error:', err);
      });
    }, this.config.healthCheckIntervalMs);

    console.log(
      `[LifecycleManager] Health monitoring started (interval: ${this.config.healthCheckIntervalMs}ms)`
    );
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    this.isRunning = false;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * Run a single health check cycle for all agents
   */
  async runHealthChecks(): Promise<AgentHealthReport[]> {
    const reports: AgentHealthReport[] = [];

    for (const [agentId, managed] of this.agents) {
      const report = this.checkAgentHealth(agentId, managed);
      reports.push(report);

      if (!report.isHealthy) {
        this.log(agentId, LifecycleEvent.UNHEALTHY, `Agent unhealthy: status=${report.status}`);
        await this.handleUnhealthyAgent(agentId, managed);
      } else {
        this.log(agentId, LifecycleEvent.HEALTH_CHECK, 'Agent healthy');
      }

      managed.lastHealthCheck = Date.now();
    }

    return reports;
  }

  /**
   * Get a health report for a single agent
   */
  getAgentHealth(agentId: string): AgentHealthReport {
    const managed = this.getManaged(agentId);
    return this.checkAgentHealth(agentId, managed);
  }

  /**
   * Get health reports for all agents
   */
  getAllHealth(): AgentHealthReport[] {
    return Array.from(this.agents.entries()).map(([id, managed]) =>
      this.checkAgentHealth(id, managed)
    );
  }

  // ─── Restart Logic ─────────────────────────────────────────

  /**
   * Restart an agent with backoff
   */
  async restartAgent(agentId: string): Promise<boolean> {
    const managed = this.getManaged(agentId);

    // Check restart limits
    if (managed.restartCount >= this.config.maxTotalRestarts) {
      this.log(
        agentId,
        LifecycleEvent.MAX_RESTARTS_EXCEEDED,
        `Max total restarts (${this.config.maxTotalRestarts}) exceeded — agent will not be restarted`
      );
      return false;
    }

    if (managed.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      this.log(
        agentId,
        LifecycleEvent.MAX_RESTARTS_EXCEEDED,
        `Max consecutive errors (${this.config.maxConsecutiveErrors}) exceeded — agent will not be restarted`
      );
      return false;
    }

    // Calculate backoff delay
    const delay = Math.min(
      this.config.restartBaseDelayMs * Math.pow(2, managed.consecutiveErrors),
      this.config.maxRestartDelayMs
    );

    this.log(agentId, LifecycleEvent.RESTARTING, `Restarting in ${delay}ms (attempt ${managed.restartCount + 1})`);
    await this.sleep(delay);

    try {
      // Stop if not already stopped
      if (managed.agent.getStatus() !== AgentStatus.STOPPED) {
        await managed.agent.stop();
      }

      await managed.agent.start();
      managed.restartCount++;
      managed.consecutiveErrors = 0;
      managed.startedAt = Date.now();

      this.log(agentId, LifecycleEvent.RESTARTED, `Agent restarted (total restarts: ${managed.restartCount})`);
      return true;
    } catch (err) {
      managed.consecutiveErrors++;
      managed.lastError = err as Error;

      this.log(
        agentId,
        LifecycleEvent.RESTART_FAILED,
        `Restart failed: ${(err as Error).message}`,
        err as Error
      );
      return false;
    }
  }

  // ─── Event Logging ─────────────────────────────────────────

  /**
   * Register a callback for lifecycle events
   */
  onLifecycleEvent(callback: LifecycleCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Get lifecycle log entries, optionally filtered by agent
   */
  getLogs(agentId?: string): LifecycleLogEntry[] {
    if (agentId) {
      return this.logs.filter((l) => l.agentId === agentId);
    }
    return [...this.logs];
  }

  /**
   * Get the last N log entries
   */
  getRecentLogs(count: number): LifecycleLogEntry[] {
    return this.logs.slice(-count);
  }

  // ─── Getters ────────────────────────────────────────────────

  /**
   * Check if health monitoring is active
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }

  /**
   * Get number of registered agents
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * Get IDs of all registered agents
   */
  getAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Get the status of a specific agent
   */
  getAgentStatus(agentId: string): AgentStatus {
    return this.getManaged(agentId).agent.getStatus();
  }

  /**
   * Get summary of all agent statuses
   */
  getStatusSummary(): Record<AgentStatus, string[]> {
    const summary: Record<string, string[]> = {};
    for (const status of Object.values(AgentStatus)) {
      summary[status] = [];
    }
    for (const [id, managed] of this.agents) {
      const status = managed.agent.getStatus();
      summary[status].push(id);
    }
    return summary as Record<AgentStatus, string[]>;
  }

  // ─── Internal ───────────────────────────────────────────────

  private getManaged(agentId: string): ManagedAgent {
    const managed = this.agents.get(agentId);
    if (!managed) {
      throw new Error(`Agent "${agentId}" is not registered`);
    }
    return managed;
  }

  private checkAgentHealth(agentId: string, managed: ManagedAgent): AgentHealthReport {
    const status = managed.agent.getStatus();
    const metrics = managed.agent.getMetrics();
    const now = Date.now();

    const uptime = managed.startedAt > 0 ? (now - managed.startedAt) / 1000 : 0;

    // Determine health
    let isHealthy = true;

    // Unhealthy if in ERROR state
    if (status === AgentStatus.ERROR) {
      isHealthy = false;
    }

    // Unhealthy if RUNNING but no activity for too long
    if (
      status === AgentStatus.RUNNING &&
      metrics.lastActivity > 0 &&
      now - metrics.lastActivity > this.config.staleThresholdMs
    ) {
      isHealthy = false;
    }

    // Unhealthy if stopped unexpectedly (was started but now stopped)
    if (status === AgentStatus.STOPPED && managed.startedAt > 0) {
      isHealthy = false;
    }

    return {
      agentId,
      status,
      isHealthy,
      uptime,
      restartCount: managed.restartCount,
      consecutiveErrors: managed.consecutiveErrors,
      lastActivity: metrics.lastActivity,
      lastHealthCheck: managed.lastHealthCheck,
      metrics,
    };
  }

  private async handleUnhealthyAgent(agentId: string, managed: ManagedAgent): Promise<void> {
    const status = managed.agent.getStatus();

    // If errored or stopped unexpectedly, try restart
    if (status === AgentStatus.ERROR || status === AgentStatus.STOPPED) {
      await this.restartAgent(agentId);
    }

    // If running but stale, pause and restart
    if (status === AgentStatus.RUNNING) {
      this.log(agentId, LifecycleEvent.UNHEALTHY, 'Agent is stale — restarting');
      await this.restartAgent(agentId);
    }
  }

  private log(
    agentId: string,
    event: LifecycleEvent,
    message: string,
    error?: Error
  ): void {
    const entry: LifecycleLogEntry = {
      agentId,
      event,
      timestamp: Date.now(),
      message,
      error: error?.message,
    };

    // Store log
    this.logs.push(entry);
    if (this.logs.length > this.maxLogEntries) {
      this.logs = this.logs.slice(-this.maxLogEntries);
    }

    // Console output
    const prefix = `[LifecycleManager][${agentId}]`;
    switch (event) {
      case LifecycleEvent.ERROR:
      case LifecycleEvent.RESTART_FAILED:
      case LifecycleEvent.MAX_RESTARTS_EXCEEDED:
        console.error(`${prefix} ${event}: ${message}`);
        break;
      case LifecycleEvent.UNHEALTHY:
        console.warn(`${prefix} ${event}: ${message}`);
        break;
      default:
        console.log(`${prefix} ${event}: ${message}`);
    }

    // Fire callbacks
    for (const cb of this.callbacks) {
      try {
        cb(entry);
      } catch {
        // Swallow callback errors
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
