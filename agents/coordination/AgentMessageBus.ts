/**
 * AgentMessageBus — In-process message passing and shared state for agent collaboration
 *
 * Provides:
 * - Typed publish/subscribe messaging between agents
 * - Shared state store with per-key read/write
 * - Topic-based channels for targeted communication
 * - Message history for debugging / replay
 *
 * This is an in-process implementation suitable for a single-node deployment.
 * For multi-node deployments, this interface can be backed by Redis pub/sub or similar.
 */

import { PoolId } from '../types/interfaces';

// ─── Types ────────────────────────────────────────────────────

export enum MessageTopic {
  /** Agent discovered a trading signal */
  SIGNAL_DETECTED = 'signal_detected',
  /** Agent submitted a commitment */
  COMMITMENT_SUBMITTED = 'commitment_submitted',
  /** Agent's reveal was submitted */
  REVEAL_SUBMITTED = 'reveal_submitted',
  /** Batch was executed */
  BATCH_EXECUTED = 'batch_executed',
  /** Agent requests others to coordinate */
  COORDINATION_REQUEST = 'coordination_request',
  /** Agent shares market insight */
  MARKET_INSIGHT = 'market_insight',
  /** Agent shares its current position / state */
  STATE_UPDATE = 'state_update',
  /** Custom / user-defined topic */
  CUSTOM = 'custom',
}

export interface AgentMessage {
  /** Unique message ID */
  id: string;
  /** Sender agent ID */
  from: string;
  /** Topic / channel */
  topic: MessageTopic;
  /** Pool this message relates to (optional) */
  poolId?: PoolId;
  /** Message payload (typed per topic) */
  payload: Record<string, unknown>;
  /** Creation timestamp */
  timestamp: number;
}

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

interface Subscription {
  agentId: string;
  topic: MessageTopic;
  handler: MessageHandler;
  /** If set, only receive messages for this pool */
  poolFilter?: PoolId;
}

export interface SharedStateEntry {
  key: string;
  value: unknown;
  setBy: string;
  updatedAt: number;
}

export interface MessageBusConfig {
  /** Max messages to keep in history per topic (default: 200) */
  maxHistoryPerTopic?: number;
  /** Whether to log messages to console (default: false) */
  debug?: boolean;
}

// ─── MessageBus ───────────────────────────────────────────────

export class AgentMessageBus {
  private subscriptions: Subscription[] = [];
  private history: Map<MessageTopic, AgentMessage[]> = new Map();
  private sharedState: Map<string, SharedStateEntry> = new Map();
  private config: Required<MessageBusConfig>;
  private messageCounter = 0;

  constructor(config: MessageBusConfig = {}) {
    this.config = {
      maxHistoryPerTopic: config.maxHistoryPerTopic ?? 200,
      debug: config.debug ?? false,
    };
  }

  // ─── Publish ────────────────────────────────────────────────

  /**
   * Publish a message to a topic.
   * All matching subscribers will be notified asynchronously.
   */
  async publish(
    from: string,
    topic: MessageTopic,
    payload: Record<string, unknown>,
    poolId?: PoolId
  ): Promise<void> {
    const message: AgentMessage = {
      id: `msg-${++this.messageCounter}-${Date.now()}`,
      from,
      topic,
      poolId,
      payload,
      timestamp: Date.now(),
    };

    // Store in history
    this.addToHistory(topic, message);

    if (this.config.debug) {
      console.log(
        `[MessageBus] ${from} → ${topic}${poolId ? ` (pool: ${poolId.slice(0, 10)}...)` : ''}: ${JSON.stringify(payload).slice(0, 100)}`
      );
    }

    // Deliver to subscribers
    const matching = this.subscriptions.filter(
      (sub) =>
        sub.topic === topic &&
        sub.agentId !== from && // Don't deliver to self
        (!sub.poolFilter || sub.poolFilter === poolId)
    );

    await Promise.allSettled(
      matching.map((sub) =>
        Promise.resolve(sub.handler(message)).catch((err) => {
          console.error(
            `[MessageBus] Handler error (agent=${sub.agentId}, topic=${topic}):`,
            err
          );
        })
      )
    );
  }

  // ─── Subscribe ──────────────────────────────────────────────

  /**
   * Subscribe to a topic. Returns an unsubscribe function.
   *
   * @param agentId   Subscriber agent ID (won't receive own messages)
   * @param topic     Topic to listen on
   * @param handler   Callback for incoming messages
   * @param poolId    Optional pool filter — only receive messages for this pool
   */
  subscribe(
    agentId: string,
    topic: MessageTopic,
    handler: MessageHandler,
    poolId?: PoolId
  ): () => void {
    const sub: Subscription = { agentId, topic, handler, poolFilter: poolId };
    this.subscriptions.push(sub);

    // Return unsubscribe function
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  /**
   * Remove all subscriptions for an agent
   */
  unsubscribeAll(agentId: string): void {
    this.subscriptions = this.subscriptions.filter(
      (sub) => sub.agentId !== agentId
    );
  }

  // ─── Shared State ──────────────────────────────────────────

  /**
   * Set a shared state value. Any agent can read/overwrite it.
   *
   * @param key     State key (e.g. "pool:<poolId>:lastPrice")
   * @param value   Any serializable value
   * @param setBy   Agent ID setting the value
   */
  setState(key: string, value: unknown, setBy: string): void {
    this.sharedState.set(key, {
      key,
      value,
      setBy,
      updatedAt: Date.now(),
    });

    if (this.config.debug) {
      console.log(`[MessageBus] State: ${key} = ${JSON.stringify(value).slice(0, 80)} (by ${setBy})`);
    }
  }

  /**
   * Get a shared state value
   */
  getState<T = unknown>(key: string): T | undefined {
    const entry = this.sharedState.get(key);
    return entry?.value as T | undefined;
  }

  /**
   * Get full state entry (includes metadata)
   */
  getStateEntry(key: string): SharedStateEntry | undefined {
    return this.sharedState.get(key);
  }

  /**
   * Check if a state key exists
   */
  hasState(key: string): boolean {
    return this.sharedState.has(key);
  }

  /**
   * Delete a shared state key
   */
  deleteState(key: string): void {
    this.sharedState.delete(key);
  }

  /**
   * Get all state keys matching a prefix
   *
   * @example
   * ```ts
   * bus.getStateByPrefix('pool:0xabc'); // all state for pool 0xabc...
   * ```
   */
  getStateByPrefix(prefix: string): SharedStateEntry[] {
    const results: SharedStateEntry[] = [];
    for (const [key, entry] of this.sharedState) {
      if (key.startsWith(prefix)) {
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * Get all shared state
   */
  getAllState(): Map<string, SharedStateEntry> {
    return new Map(this.sharedState);
  }

  // ─── History ────────────────────────────────────────────────

  /**
   * Get message history for a topic
   */
  getHistory(topic: MessageTopic, limit?: number): AgentMessage[] {
    const messages = this.history.get(topic) || [];
    return limit ? messages.slice(-limit) : [...messages];
  }

  /**
   * Get message history for a specific pool across all topics
   */
  getPoolHistory(poolId: PoolId, limit?: number): AgentMessage[] {
    const allMessages: AgentMessage[] = [];
    for (const messages of this.history.values()) {
      for (const msg of messages) {
        if (msg.poolId === poolId) {
          allMessages.push(msg);
        }
      }
    }
    allMessages.sort((a, b) => a.timestamp - b.timestamp);
    return limit ? allMessages.slice(-limit) : allMessages;
  }

  /**
   * Get messages from a specific agent
   */
  getAgentHistory(agentId: string, limit?: number): AgentMessage[] {
    const allMessages: AgentMessage[] = [];
    for (const messages of this.history.values()) {
      for (const msg of messages) {
        if (msg.from === agentId) {
          allMessages.push(msg);
        }
      }
    }
    allMessages.sort((a, b) => a.timestamp - b.timestamp);
    return limit ? allMessages.slice(-limit) : allMessages;
  }

  // ─── Convenience Publishers ─────────────────────────────────

  /**
   * Broadcast a market insight to all agents
   */
  async shareMarketInsight(
    from: string,
    poolId: PoolId,
    insight: {
      type: string;
      description: string;
      data?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.publish(from, MessageTopic.MARKET_INSIGHT, insight, poolId);
  }

  /**
   * Request coordination from other agents
   */
  async requestCoordination(
    from: string,
    poolId: PoolId,
    request: {
      action: string;
      reason: string;
      urgency: 'low' | 'medium' | 'high';
    }
  ): Promise<void> {
    await this.publish(from, MessageTopic.COORDINATION_REQUEST, request, poolId);
  }

  /**
   * Broadcast a state update about this agent
   */
  async broadcastStateUpdate(
    from: string,
    state: {
      status: string;
      pendingCommitments: number;
      confidence: number;
      [key: string]: unknown;
    }
  ): Promise<void> {
    await this.publish(from, MessageTopic.STATE_UPDATE, state);
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  /**
   * Get bus statistics
   */
  getStats(): {
    subscriptions: number;
    stateKeys: number;
    totalMessages: number;
    messagesByTopic: Record<string, number>;
  } {
    const messagesByTopic: Record<string, number> = {};
    let totalMessages = 0;

    for (const [topic, messages] of this.history) {
      messagesByTopic[topic] = messages.length;
      totalMessages += messages.length;
    }

    return {
      subscriptions: this.subscriptions.length,
      stateKeys: this.sharedState.size,
      totalMessages,
      messagesByTopic,
    };
  }

  /**
   * Clear all history, state, and subscriptions
   */
  clear(): void {
    this.subscriptions.length = 0;
    this.history.clear();
    this.sharedState.clear();
    this.messageCounter = 0;
  }

  // ─── Internal ───────────────────────────────────────────────

  private addToHistory(topic: MessageTopic, message: AgentMessage): void {
    let topicHistory = this.history.get(topic);
    if (!topicHistory) {
      topicHistory = [];
      this.history.set(topic, topicHistory);
    }
    topicHistory.push(message);

    // Trim to max
    if (topicHistory.length > this.config.maxHistoryPerTopic) {
      this.history.set(topic, topicHistory.slice(-this.config.maxHistoryPerTopic));
    }
  }
}
