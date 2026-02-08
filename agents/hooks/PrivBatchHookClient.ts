/**
 * PrivBatchHookClient - Client for interacting with the PrivBatchHook contract
 *
 * Provides typed wrappers around all hook contract functions:
 * - Commitment submission (standard and ZK-enhanced)
 * - Reveal submission (standard and ZK)
 * - Batch execution (standard and ZK-enhanced)
 * - State queries (pending count, batch readiness, verification status)
 *
 * Includes built-in nonce management, retry logic, and error decoding.
 */

import { ethers } from 'ethers';
import {
  PoolKey,
  PoolId,
  SwapIntent,
} from '../types/interfaces';

// ─── ABI ─────────────────────────────────────────────────────

export const PRIV_BATCH_HOOK_ABI = [
  // ── Commitment ──
  'function submitCommitment(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) calldata key, bytes32 commitmentHash) external',
  'function submitCommitmentWithProof(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) calldata key, bytes32 commitmentHash, uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c, uint[1] calldata publicSignals) external',

  // ── Reveal ──
  'function submitReveal(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) calldata key, tuple(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient, uint256 nonce, uint256 deadline) calldata intent) external',
  'function submitRevealForZK(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) calldata key, bytes32 commitmentHash, tuple(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient, uint256 nonce, uint256 deadline) calldata intent) external',

  // ── Batch execution ──
  'function revealAndBatchExecute(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) calldata key, bytes32[] calldata commitmentHashes) external',
  'function revealAndBatchExecuteWithProofs(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) calldata key, bytes32[] calldata commitmentHashes, uint[2][] calldata proofsA, uint[2][2][] calldata proofsB, uint[2][] calldata proofsC, uint[1][] calldata publicSignalsArray) external',

  // ── Queries ──
  'function checker(bytes32 poolId) external view returns (bool canExec, bytes execPayload)',
  'function getPendingCommitmentCount(bytes32 poolId) external view returns (uint256 count)',
  'function verifiedCommitments(bytes32 commitmentHash) external view returns (bool)',
  'function MIN_COMMITMENTS() external view returns (uint256)',
  'function BATCH_INTERVAL() external view returns (uint256)',

  // ── Events ──
  'event CommitmentSubmitted(bytes32 indexed poolId, bytes32 indexed commitmentHash)',
  'event CommitmentRevealed(bytes32 indexed poolId, bytes32 indexed commitmentHash)',
  'event CommitmentVerified(bytes32 indexed poolId, bytes32 indexed commitmentHash)',
  'event BatchExecuted(bytes32 indexed poolId, int256 netDelta0, int256 netDelta1, uint256 batchSize, uint256 timestamp)',
  'event TokensDistributed(bytes32 indexed poolId, bytes32 indexed recipientHash, address token, uint256 amount)',
];

// ─── Error selectors ──────────────────────────────────────────

const ERROR_SELECTORS: Record<string, string> = {
  '0xc06789fa': 'InvalidCommitment',
  '0x56a270ff': 'SlippageExceededForUser',
  '0x5212cba1': 'CurrencyNotSettled',
  '0x1ab7da6b': 'DeadlineExpired',
  '0x756688fe': 'InvalidNonce',
  '0xfc4f2304': 'InsufficientCommitments',
  '0x75c1bb14': 'BatchConditionsNotMet',
  '0xe1cd5509': 'SwapExecutionFailed',
};

// ─── Types ────────────────────────────────────────────────────

export interface ZKProof {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  publicSignals: [string];
}

export interface TransactionResult {
  hash: string;
  blockNumber: number;
  gasUsed: bigint;
  success: boolean;
}

export interface HookClientConfig {
  hookAddress: string;
  provider: ethers.JsonRpcProvider;
  signer: ethers.Wallet;
  /** Max retries for nonce/gas errors (default: 3) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 2000) */
  retryDelayMs?: number;
}

// ─── Client ───────────────────────────────────────────────────

export class PrivBatchHookClient {
  private contract: ethers.Contract;
  private signer: ethers.Wallet;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(config: HookClientConfig) {
    this.signer = config.signer;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 2000;
    this.contract = new ethers.Contract(
      config.hookAddress,
      PRIV_BATCH_HOOK_ABI,
      this.signer
    );
  }

  // ─── Commitment Submission ──────────────────────────────────

  /**
   * Submit a commitment hash (non-ZK, keccak256 path)
   */
  async submitCommitment(
    poolKey: PoolKey,
    commitmentHash: string
  ): Promise<TransactionResult> {
    return this.sendTx(
      () => this.contract.submitCommitment(this.poolKeyToTuple(poolKey), commitmentHash),
      'submitCommitment'
    );
  }

  /**
   * Submit a commitment with a ZK proof (Poseidon hash path)
   */
  async submitCommitmentWithProof(
    poolKey: PoolKey,
    commitmentHash: string,
    proof: ZKProof
  ): Promise<TransactionResult> {
    return this.sendTx(
      () =>
        this.contract.submitCommitmentWithProof(
          this.poolKeyToTuple(poolKey),
          commitmentHash,
          proof.a,
          proof.b,
          proof.c,
          proof.publicSignals
        ),
      'submitCommitmentWithProof'
    );
  }

  // ─── Reveal Submission ──────────────────────────────────────

  /**
   * Submit a reveal for a standard (non-ZK) commitment
   */
  async submitReveal(
    poolKey: PoolKey,
    intent: SwapIntent
  ): Promise<TransactionResult> {
    return this.sendTx(
      () =>
        this.contract.submitReveal(
          this.poolKeyToTuple(poolKey),
          this.intentToTuple(intent)
        ),
      'submitReveal'
    );
  }

  /**
   * Submit a reveal for a ZK-verified commitment
   * Must be called BEFORE revealAndBatchExecuteWithProofs
   */
  async submitRevealForZK(
    poolKey: PoolKey,
    commitmentHash: string,
    intent: SwapIntent
  ): Promise<TransactionResult> {
    return this.sendTx(
      () =>
        this.contract.submitRevealForZK(
          this.poolKeyToTuple(poolKey),
          commitmentHash,
          this.intentToTuple(intent)
        ),
      'submitRevealForZK'
    );
  }

  // ─── Batch Execution ───────────────────────────────────────

  /**
   * Execute batch (non-ZK path). Reveals must be submitted first.
   */
  async revealAndBatchExecute(
    poolKey: PoolKey,
    commitmentHashes: string[]
  ): Promise<TransactionResult> {
    return this.sendTx(
      () =>
        this.contract.revealAndBatchExecute(
          this.poolKeyToTuple(poolKey),
          commitmentHashes
        ),
      'revealAndBatchExecute'
    );
  }

  /**
   * Execute batch with ZK proofs. Reveals must be submitted via submitRevealForZK first.
   * Individual trade details are NOT in the calldata.
   */
  async revealAndBatchExecuteWithProofs(
    poolKey: PoolKey,
    commitmentHashes: string[],
    proofs: ZKProof[]
  ): Promise<TransactionResult> {
    if (commitmentHashes.length !== proofs.length) {
      throw new Error(
        `Mismatch: ${commitmentHashes.length} hashes but ${proofs.length} proofs`
      );
    }

    const proofsA = proofs.map((p) => p.a);
    const proofsB = proofs.map((p) => p.b);
    const proofsC = proofs.map((p) => p.c);
    const publicSignalsArray = proofs.map((p) => p.publicSignals);

    return this.sendTx(
      () =>
        this.contract.revealAndBatchExecuteWithProofs(
          this.poolKeyToTuple(poolKey),
          commitmentHashes,
          proofsA,
          proofsB,
          proofsC,
          publicSignalsArray
        ),
      'revealAndBatchExecuteWithProofs'
    );
  }

  // ─── Queries ────────────────────────────────────────────────

  /**
   * Check if batch execution conditions are met for a pool
   */
  async checker(poolId: string): Promise<{ canExec: boolean; execPayload: string }> {
    const [canExec, execPayload] = await this.contract.checker(poolId);
    return { canExec, execPayload };
  }

  /**
   * Get the number of pending (unrevealed) commitments
   */
  async getPendingCommitmentCount(poolId: string): Promise<number> {
    const count = await this.contract.getPendingCommitmentCount(poolId);
    return Number(count);
  }

  /**
   * Check if a commitment has been verified with a ZK proof
   */
  async isCommitmentVerified(commitmentHash: string): Promise<boolean> {
    return this.contract.verifiedCommitments(commitmentHash);
  }

  /**
   * Get the minimum number of commitments required for batch execution
   */
  async getMinCommitments(): Promise<number> {
    const min = await this.contract.MIN_COMMITMENTS();
    return Number(min);
  }

  /**
   * Get the batch interval in seconds
   */
  async getBatchInterval(): Promise<number> {
    const interval = await this.contract.BATCH_INTERVAL();
    return Number(interval);
  }

  // ─── Event Listeners ────────────────────────────────────────

  /**
   * Listen for CommitmentSubmitted events
   */
  onCommitmentSubmitted(
    callback: (poolId: string, commitmentHash: string) => void
  ): void {
    this.contract.on('CommitmentSubmitted', callback);
  }

  /**
   * Listen for CommitmentVerified events (ZK proofs)
   */
  onCommitmentVerified(
    callback: (poolId: string, commitmentHash: string) => void
  ): void {
    this.contract.on('CommitmentVerified', callback);
  }

  /**
   * Listen for CommitmentRevealed events
   */
  onCommitmentRevealed(
    callback: (poolId: string, commitmentHash: string) => void
  ): void {
    this.contract.on('CommitmentRevealed', callback);
  }

  /**
   * Listen for BatchExecuted events
   */
  onBatchExecuted(
    callback: (
      poolId: string,
      netDelta0: bigint,
      netDelta1: bigint,
      batchSize: bigint,
      timestamp: bigint
    ) => void
  ): void {
    this.contract.on('BatchExecuted', callback);
  }

  /**
   * Listen for TokensDistributed events
   */
  onTokensDistributed(
    callback: (
      poolId: string,
      recipientHash: string,
      token: string,
      amount: bigint
    ) => void
  ): void {
    this.contract.on('TokensDistributed', callback);
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners(): void {
    this.contract.removeAllListeners();
  }

  // ─── Utilities ──────────────────────────────────────────────

  /**
   * Compute keccak256 commitment hash (non-ZK path)
   */
  computeKeccakCommitmentHash(intent: SwapIntent): string {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'uint256', 'uint256', 'address', 'uint256', 'uint256'],
      [
        intent.user,
        intent.tokenIn,
        intent.tokenOut,
        intent.amountIn,
        intent.minAmountOut,
        intent.recipient,
        intent.nonce,
        intent.deadline,
      ]
    );
    return ethers.keccak256(encoded);
  }

  /**
   * Get PoolId from PoolKey (matches on-chain PoolIdLibrary.toId())
   */
  getPoolId(poolKey: PoolKey): PoolId {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
    );
    return ethers.keccak256(encoded);
  }

  /**
   * Decode a revert error selector into a human-readable name
   */
  decodeError(data: string): string {
    const selector = data.slice(0, 10);
    return ERROR_SELECTORS[selector] || `Unknown error: ${selector}`;
  }

  /**
   * Get the underlying ethers.Contract (for advanced use)
   */
  getContract(): ethers.Contract {
    return this.contract;
  }

  // ─── Internal ───────────────────────────────────────────────

  private poolKeyToTuple(poolKey: PoolKey): [string, string, number, number, string] {
    return [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ];
  }

  private intentToTuple(intent: SwapIntent): [string, string, string, string | bigint, string | bigint, string, string | bigint, string | bigint] {
    return [
      intent.user,
      intent.tokenIn,
      intent.tokenOut,
      intent.amountIn.toString(),
      intent.minAmountOut.toString(),
      intent.recipient,
      intent.nonce.toString(),
      intent.deadline.toString(),
    ];
  }

  /**
   * Send a transaction with retry logic for nonce conflicts and gas errors
   */
  private async sendTx(
    txFactory: () => Promise<ethers.ContractTransactionResponse>,
    label: string
  ): Promise<TransactionResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const tx = await txFactory();
        const receipt = await tx.wait();

        if (!receipt) {
          throw new Error(`${label}: Transaction receipt is null`);
        }

        return {
          hash: receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          success: receipt.status === 1,
        };
      } catch (err: unknown) {
        lastError = err as Error;
        const errorMsg = lastError.message || '';

        // Decode custom Solidity errors
        if (errorMsg.includes('execution reverted') && errorMsg.includes('data')) {
          const dataMatch = errorMsg.match(/data="(0x[a-fA-F0-9]+)"/);
          if (dataMatch) {
            const decoded = this.decodeError(dataMatch[1]);
            throw new Error(`${label}: Contract reverted with ${decoded} (${dataMatch[1]})`);
          }
        }

        // Retryable errors
        const isRetryable =
          errorMsg.includes('REPLACEMENT_UNDERPRICED') ||
          errorMsg.includes('replacement fee too low') ||
          errorMsg.includes('nonce has already been used') ||
          errorMsg.includes('NONCE_EXPIRED');

        if (isRetryable && attempt < this.maxRetries) {
          console.warn(
            `[HookClient] ${label}: Retryable error (attempt ${attempt + 1}/${this.maxRetries}): ${errorMsg.slice(0, 100)}`
          );
          await this.sleep(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error(`${label}: Failed after ${this.maxRetries} retries`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
