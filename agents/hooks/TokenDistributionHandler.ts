/**
 * TokenDistributionHandler - Handles post-batch token distribution events
 *
 * After a batch is executed, the hook distributes output tokens to recipients.
 * This handler:
 * - Listens for TokensDistributed events
 * - Tracks agent balances across distributions
 * - Logs distribution results
 * - Provides performance metrics per agent
 */

import { ethers } from 'ethers';
import { PoolId } from '../types/interfaces';
import { PrivBatchHookClient } from './PrivBatchHookClient';

// ─── Types ────────────────────────────────────────────────────

export interface DistributionEvent {
  poolId: string;
  recipientHash: string;
  token: string;
  amount: bigint;
  txHash: string;
  blockNumber: number;
  timestamp: number;
}

export interface AgentBalance {
  agentId: string;
  walletAddress: string;
  /** token address → cumulative amount received */
  tokenBalances: Map<string, bigint>;
  totalDistributions: number;
  lastDistributionAt: number;
}

export interface DistributionStats {
  totalDistributions: number;
  uniqueTokens: Set<string>;
  totalAmountByToken: Map<string, bigint>;
  firstDistribution: number;
  lastDistribution: number;
}

export type DistributionCallback = (event: DistributionEvent) => void;

// ─── Handler ──────────────────────────────────────────────────

export class TokenDistributionHandler {
  private hookClient: PrivBatchHookClient;
  private provider: ethers.JsonRpcProvider;
  private agentBalances: Map<string, AgentBalance> = new Map(); // agentId → balance
  private distributions: DistributionEvent[] = [];
  private callbacks: DistributionCallback[] = [];
  private isListening = false;

  // Mapping: walletAddress → agentId (for resolving distributions to agents)
  private walletToAgent: Map<string, string> = new Map();

  constructor(
    hookClient: PrivBatchHookClient,
    provider: ethers.JsonRpcProvider
  ) {
    this.hookClient = hookClient;
    this.provider = provider;
  }

  // ─── Agent Registration ─────────────────────────────────────

  /**
   * Register an agent to track its distributions
   */
  registerAgent(agentId: string, walletAddress: string): void {
    const normalized = walletAddress.toLowerCase();
    this.walletToAgent.set(normalized, agentId);

    if (!this.agentBalances.has(agentId)) {
      this.agentBalances.set(agentId, {
        agentId,
        walletAddress: normalized,
        tokenBalances: new Map(),
        totalDistributions: 0,
        lastDistributionAt: 0,
      });
    }
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): void {
    const balance = this.agentBalances.get(agentId);
    if (balance) {
      this.walletToAgent.delete(balance.walletAddress);
      this.agentBalances.delete(agentId);
    }
  }

  // ─── Event Listening ────────────────────────────────────────

  /**
   * Start listening for TokensDistributed events
   */
  startListening(): void {
    if (this.isListening) {
      console.warn('[TokenDistribution] Already listening');
      return;
    }

    this.isListening = true;

    this.hookClient.onTokensDistributed(
      (poolId: string, recipientHash: string, token: string, amount: bigint) => {
        this.handleDistributionEvent(poolId, recipientHash, token, amount);
      }
    );

    // Also listen for BatchExecuted to know when distributions happen
    this.hookClient.onBatchExecuted(
      (poolId: string, netDelta0: bigint, netDelta1: bigint, batchSize: bigint, _timestamp: bigint) => {
        console.log(
          `[TokenDistribution] Batch executed on pool ${poolId.slice(0, 10)}...: ` +
          `${batchSize} swaps, deltas: [${netDelta0}, ${netDelta1}]`
        );
      }
    );

    console.log('[TokenDistribution] Started listening for distribution events');
  }

  /**
   * Stop listening for events
   */
  stopListening(): void {
    if (!this.isListening) return;
    this.isListening = false;
    this.hookClient.removeAllListeners();
    console.log('[TokenDistribution] Stopped listening');
  }

  /**
   * Register a callback for distribution events
   */
  onDistribution(callback: DistributionCallback): void {
    this.callbacks.push(callback);
  }

  // ─── Manual Querying (for historical data) ──────────────────

  /**
   * Fetch past TokensDistributed events for a pool
   */
  async fetchPastDistributions(
    poolId: PoolId,
    fromBlock: number,
    toBlock: number | 'latest' = 'latest'
  ): Promise<DistributionEvent[]> {
    const contract = this.hookClient.getContract();
    const filter = contract.filters.TokensDistributed(poolId);
    const events = await contract.queryFilter(filter, fromBlock, toBlock);

    const distributions: DistributionEvent[] = [];

    for (const event of events) {
      if (!('args' in event) || !event.args) continue;

      const args = event.args as unknown as [string, string, string, bigint];
      const block = await this.provider.getBlock(event.blockNumber);

      const dist: DistributionEvent = {
        poolId: args[0],
        recipientHash: args[1],
        token: args[2],
        amount: args[3],
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
        timestamp: block?.timestamp || 0,
      };

      distributions.push(dist);
      this.distributions.push(dist);
    }

    return distributions;
  }

  // ─── Balance Tracking ───────────────────────────────────────

  /**
   * Get the tracked balance for an agent
   */
  getAgentBalance(agentId: string): AgentBalance | undefined {
    return this.agentBalances.get(agentId);
  }

  /**
   * Get all agent balances
   */
  getAllAgentBalances(): Map<string, AgentBalance> {
    return new Map(this.agentBalances);
  }

  /**
   * Get an agent's balance for a specific token
   */
  getAgentTokenBalance(agentId: string, tokenAddress: string): bigint {
    const balance = this.agentBalances.get(agentId);
    if (!balance) return BigInt(0);
    return balance.tokenBalances.get(tokenAddress.toLowerCase()) || BigInt(0);
  }

  // ─── Distribution History ───────────────────────────────────

  /**
   * Get all distribution events
   */
  getDistributionHistory(): DistributionEvent[] {
    return [...this.distributions];
  }

  /**
   * Get distribution stats
   */
  getDistributionStats(): DistributionStats {
    const tokens = new Set<string>();
    const totalByToken = new Map<string, bigint>();
    let first = Infinity;
    let last = 0;

    for (const dist of this.distributions) {
      tokens.add(dist.token);
      const current = totalByToken.get(dist.token) || BigInt(0);
      totalByToken.set(dist.token, current + dist.amount);
      if (dist.timestamp < first) first = dist.timestamp;
      if (dist.timestamp > last) last = dist.timestamp;
    }

    return {
      totalDistributions: this.distributions.length,
      uniqueTokens: tokens,
      totalAmountByToken: totalByToken,
      firstDistribution: first === Infinity ? 0 : first,
      lastDistribution: last,
    };
  }

  /**
   * Get distribution count per agent
   */
  getDistributionCountPerAgent(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [agentId, balance] of this.agentBalances) {
      counts.set(agentId, balance.totalDistributions);
    }
    return counts;
  }

  // ─── Internal ───────────────────────────────────────────────

  /**
   * Handle an incoming distribution event
   */
  private handleDistributionEvent(
    poolId: string,
    recipientHash: string,
    token: string,
    amount: bigint
  ): void {
    const event: DistributionEvent = {
      poolId,
      recipientHash,
      token,
      amount,
      txHash: '', // Not available from event listener directly
      blockNumber: 0,
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Store the event
    this.distributions.push(event);

    // Try to match to an agent via recipientHash
    // In the privacy-enhanced hook, TokensDistributed emits a hash of the recipient,
    // so we need to match by computing keccak256(abi.encode(address)) for each agent.
    this.matchDistributionToAgent(event, token, amount);

    // Fire callbacks
    for (const cb of this.callbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error('[TokenDistribution] Callback error:', err);
      }
    }

    console.log(
      `[TokenDistribution] Distribution: pool=${poolId.slice(0, 10)}..., ` +
      `token=${token.slice(0, 10)}..., amount=${amount}`
    );
  }

  /**
   * Try to match a distribution to a registered agent.
   * The hook emits recipientHash = keccak256(abi.encode(recipient)),
   * so we compute the same hash for each registered agent address.
   */
  private matchDistributionToAgent(
    event: DistributionEvent,
    token: string,
    amount: bigint
  ): void {
    for (const [agentId, balance] of this.agentBalances) {
      const expectedHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['address'],
          [balance.walletAddress]
        )
      );

      if (expectedHash === event.recipientHash) {
        // Match found — update balance
        const normalizedToken = token.toLowerCase();
        const current = balance.tokenBalances.get(normalizedToken) || BigInt(0);
        balance.tokenBalances.set(normalizedToken, current + amount);
        balance.totalDistributions++;
        balance.lastDistributionAt = event.timestamp;

        console.log(
          `[TokenDistribution] Agent ${agentId}: +${amount} of ${token.slice(0, 10)}...`
        );
        return;
      }
    }
  }
}
