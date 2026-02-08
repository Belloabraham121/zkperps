/**
 * RevealManager - Manages reveal collection, validation, and submission
 *
 * The reveal flow is:
 *  1. Agents submit commitments and store the swap intent data off-chain.
 *  2. When it's time to execute, the RevealManager collects all pending reveals.
 *  3. It validates reveals against commitments (hash match, deadline, nonce).
 *  4. It submits reveals to the hook contract (via submitReveal or submitRevealForZK).
 *  5. The BatchExecutor then triggers batch execution.
 *
 * This class handles the off-chain reveal storage, validation, and on-chain submission.
 */

import { ethers } from 'ethers';
import {
  PoolKey,
  PoolId,
  SwapIntent,
  CommitmentData,
} from '../types/interfaces';
import { PrivBatchHookClient } from './PrivBatchHookClient';

// ─── Types ────────────────────────────────────────────────────

export interface RevealData {
  commitmentHash: string;
  intent: SwapIntent;
  poolKey: PoolKey;
  poolId: PoolId;
  isZKVerified: boolean;
  submittedOnChain: boolean;
  submittedAt?: number; // Timestamp of on-chain submission
}

export interface RevealValidation {
  isValid: boolean;
  errors: string[];
}

export interface RevealSubmissionResult {
  commitmentHash: string;
  success: boolean;
  txHash?: string;
  error?: string;
}

// ─── RevealManager ────────────────────────────────────────────

export class RevealManager {
  private hookClient: PrivBatchHookClient;
  private pendingReveals: Map<string, RevealData> = new Map(); // commitmentHash -> RevealData
  private submissionDelayMs: number;

  constructor(
    hookClient: PrivBatchHookClient,
    options: {
      /** Delay between reveal submissions to avoid nonce conflicts (default: 2000ms) */
      submissionDelayMs?: number;
    } = {}
  ) {
    this.hookClient = hookClient;
    this.submissionDelayMs = options.submissionDelayMs ?? 2000;
  }

  // ─── Reveal Collection ──────────────────────────────────────

  /**
   * Add a reveal from a commitment (agent stores this when committing)
   */
  addReveal(
    commitmentHash: string,
    intent: SwapIntent,
    poolKey: PoolKey,
    poolId: PoolId,
    isZKVerified: boolean
  ): void {
    if (this.pendingReveals.has(commitmentHash)) {
      console.warn(`[RevealManager] Reveal for ${commitmentHash.slice(0, 10)}... already exists`);
      return;
    }

    this.pendingReveals.set(commitmentHash, {
      commitmentHash,
      intent,
      poolKey,
      poolId,
      isZKVerified,
      submittedOnChain: false,
    });
  }

  /**
   * Collect reveals from an array of CommitmentData (from agents)
   */
  collectFromCommitments(
    commitments: CommitmentData[],
    poolKey: PoolKey,
    isZKVerified: boolean
  ): void {
    for (const commitment of commitments) {
      if (!commitment.revealed) {
        this.addReveal(
          commitment.commitmentHash,
          commitment.swapIntent,
          poolKey,
          commitment.poolId,
          isZKVerified
        );
      }
    }
  }

  // ─── Reveal Validation ──────────────────────────────────────

  /**
   * Validate a reveal against its commitment
   */
  validateReveal(revealData: RevealData): RevealValidation {
    const errors: string[] = [];
    const { intent, commitmentHash, isZKVerified } = revealData;

    // Check deadline
    const now = Math.floor(Date.now() / 1000);
    if (Number(intent.deadline) < now) {
      errors.push(`Deadline expired: ${intent.deadline} < ${now}`);
    }

    // Check amounts are positive
    if (BigInt(intent.amountIn) <= BigInt(0)) {
      errors.push('amountIn must be positive');
    }
    if (BigInt(intent.minAmountOut) < BigInt(0)) {
      errors.push('minAmountOut cannot be negative');
    }

    // Check addresses
    if (!intent.user || intent.user === ethers.ZeroAddress) {
      errors.push('Invalid user address');
    }
    if (!intent.tokenIn || intent.tokenIn === ethers.ZeroAddress) {
      errors.push('Invalid tokenIn address');
    }
    if (!intent.tokenOut || intent.tokenOut === ethers.ZeroAddress) {
      errors.push('Invalid tokenOut address');
    }
    if (!intent.recipient || intent.recipient === ethers.ZeroAddress) {
      errors.push('Invalid recipient address');
    }

    // For non-ZK path, verify keccak256 hash matches
    if (!isZKVerified) {
      const computedHash = this.hookClient.computeKeccakCommitmentHash(intent);
      if (computedHash !== commitmentHash) {
        errors.push(
          `Hash mismatch: computed=${computedHash.slice(0, 10)}... vs stored=${commitmentHash.slice(0, 10)}...`
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate all pending reveals
   */
  validateAll(): Map<string, RevealValidation> {
    const results = new Map<string, RevealValidation>();
    for (const [hash, reveal] of this.pendingReveals) {
      results.set(hash, this.validateReveal(reveal));
    }
    return results;
  }

  // ─── Reveal Submission ──────────────────────────────────────

  /**
   * Submit all pending reveals to the hook contract.
   * For ZK-verified reveals: uses submitRevealForZK()
   * For standard reveals: uses submitReveal()
   *
   * Submissions are sequential with delays to avoid nonce conflicts.
   */
  async submitAllReveals(): Promise<RevealSubmissionResult[]> {
    const results: RevealSubmissionResult[] = [];
    const reveals = this.getPendingUnsubmitted();

    if (reveals.length === 0) {
      console.log('[RevealManager] No pending reveals to submit');
      return results;
    }

    console.log(`[RevealManager] Submitting ${reveals.length} reveals...`);

    for (let i = 0; i < reveals.length; i++) {
      const reveal = reveals[i];
      const result = await this.submitSingleReveal(reveal);
      results.push(result);

      // Delay between submissions to avoid nonce conflicts
      if (i < reveals.length - 1) {
        await this.sleep(this.submissionDelayMs);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    console.log(
      `[RevealManager] Submitted ${successCount}/${reveals.length} reveals successfully`
    );

    return results;
  }

  /**
   * Submit a single reveal on-chain
   */
  private async submitSingleReveal(reveal: RevealData): Promise<RevealSubmissionResult> {
    try {
      // Validate first
      const validation = this.validateReveal(reveal);
      if (!validation.isValid) {
        return {
          commitmentHash: reveal.commitmentHash,
          success: false,
          error: `Validation failed: ${validation.errors.join(', ')}`,
        };
      }

      let txResult;
      if (reveal.isZKVerified) {
        txResult = await this.hookClient.submitRevealForZK(
          reveal.poolKey,
          reveal.commitmentHash,
          reveal.intent
        );
      } else {
        txResult = await this.hookClient.submitReveal(reveal.poolKey, reveal.intent);
      }

      // Mark as submitted
      reveal.submittedOnChain = true;
      reveal.submittedAt = Date.now();

      console.log(
        `[RevealManager] Reveal ${reveal.commitmentHash.slice(0, 10)}... submitted: ${txResult.hash}`
      );

      return {
        commitmentHash: reveal.commitmentHash,
        success: true,
        txHash: txResult.hash,
      };
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || 'Unknown error';
      console.error(
        `[RevealManager] Failed to submit reveal ${reveal.commitmentHash.slice(0, 10)}...: ${errorMsg}`
      );
      return {
        commitmentHash: reveal.commitmentHash,
        success: false,
        error: errorMsg,
      };
    }
  }

  // ─── Getters ────────────────────────────────────────────────

  /**
   * Get all pending reveals (not yet submitted on-chain)
   */
  getPendingUnsubmitted(): RevealData[] {
    return Array.from(this.pendingReveals.values()).filter(
      (r) => !r.submittedOnChain
    );
  }

  /**
   * Get reveals that have been submitted on-chain (ready for batch execution)
   */
  getSubmittedReveals(): RevealData[] {
    return Array.from(this.pendingReveals.values()).filter(
      (r) => r.submittedOnChain
    );
  }

  /**
   * Get all reveals for a specific pool
   */
  getRevealsForPool(poolId: PoolId): RevealData[] {
    return Array.from(this.pendingReveals.values()).filter(
      (r) => r.poolId === poolId
    );
  }

  /**
   * Get commitment hashes of all submitted reveals (for batch execution)
   */
  getSubmittedCommitmentHashes(): string[] {
    return this.getSubmittedReveals().map((r) => r.commitmentHash);
  }

  /**
   * Get commitment hashes for a specific pool (submitted only)
   */
  getSubmittedHashesForPool(poolId: PoolId): string[] {
    return this.getRevealsForPool(poolId)
      .filter((r) => r.submittedOnChain)
      .map((r) => r.commitmentHash);
  }

  /**
   * Get total pending reveal count
   */
  getPendingCount(): number {
    return this.getPendingUnsubmitted().length;
  }

  /**
   * Get total submitted reveal count
   */
  getSubmittedCount(): number {
    return this.getSubmittedReveals().length;
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  /**
   * Clear reveals that have been executed (after batch execution)
   */
  clearExecutedReveals(commitmentHashes: string[]): void {
    for (const hash of commitmentHashes) {
      this.pendingReveals.delete(hash);
    }
  }

  /**
   * Clear all reveals for a pool
   */
  clearPool(poolId: PoolId): void {
    for (const [hash, reveal] of this.pendingReveals) {
      if (reveal.poolId === poolId) {
        this.pendingReveals.delete(hash);
      }
    }
  }

  /**
   * Clear all reveals
   */
  clearAll(): void {
    this.pendingReveals.clear();
  }

  // ─── Internal ───────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
