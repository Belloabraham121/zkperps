/**
 * Perp API client for perpetual futures trading operations
 * All endpoints require JWT authentication
 */

import { intentSizeAsMagnitude } from "@/lib/utils/perp";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000;

/**
 * Retry a fetch request up to MAX_RETRIES times
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    if (
      retries > 0 &&
      error instanceof TypeError &&
      error.message === "Failed to fetch"
    ) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  token: string
): Promise<T> {
  const res = await fetchWithRetry(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    let errorMessage = error.error || `Request failed with status ${res.status}`;

    if (error.cause && typeof error.cause === "string") {
      errorMessage += `\n\nCause: ${error.cause}`;
    }
    if (error.hint && typeof error.hint === "string") {
      errorMessage += `\n\n${error.hint}`;
    }

    if (errorMessage.includes("Authorization failed") || errorMessage.includes("addSigners")) {
      throw new Error(
        `${errorMessage}\n\nTo fix this:\n1. Refresh the page to retry signer setup\n2. Or ensure you're signed in with a Privy embedded wallet`
      );
    }

    throw new Error(errorMessage);
  }

  return res.json();
}

// Types matching backend
export interface PerpIntent {
  user: string;
  market: string;
  size: string; // BigInt as string
  isLong: boolean;
  isOpen: boolean;
  collateral?: string; // BigInt as string, required for opens
  leverage: string; // BigInt as string (e.g., "5000000000000000000" for 5x)
  nonce: string;
  deadline: string;
}

export interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

export interface Position {
  size: string;
  entryPrice: string;
  collateral: string;
  leverage: string;
  lastFundingPaid: string;
  entryCumulativeFunding?: string;
  /** Unrealized PnL from contract (18 decimals, signed). */
  unrealizedPnl?: string;
}

export interface CollateralInfo {
  totalCollateral: string;
  availableMargin: string;
}

export interface TokenBalances {
  usdc: string;
  usdt: string;
  /** USDC token contract address used for balanceOf (debug) */
  usdcContract?: string;
  /** USDT token contract address used for balanceOf (debug) */
  usdtContract?: string;
}

export interface BatchState {
  poolId: string;
  lastBatchTimestamp: string;
  commitmentCount: string;
}

/** Order status from backend */
export type OrderStatus = "pending" | "executed" | "cancelled";

/** Perp order (open order or order history entry) */
export interface PerpOrderRecord {
  _id?: string;
  id?: string;
  privyUserId: string;
  walletAddress: string;
  poolId: string;
  commitmentHash: string;
  market: string;
  size: string;
  isLong: boolean;
  isOpen: boolean;
  collateral: string;
  leverage: string;
  nonce: string;
  deadline: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  executedAt?: string;
  txHash?: string;
}

/** Executed perp trade (trade history entry) */
export interface PerpTradeRecord {
  _id?: string;
  id?: string;
  privyUserId: string;
  walletAddress: string;
  market: string;
  size: string;
  isLong: boolean;
  isOpen: boolean;
  collateral: string;
  leverage: string;
  entryPrice: string | null;
  /** Realised P&L in USD when this trade closed a position (null for opens). */
  realisedPnl: number | null;
  realisedPnlPct: number | null;
  txHash: string;
  executedAt: string;
  poolId: string;
  commitmentHash: string;
}

/** Lock: normalize intent so size is always positive magnitude (contract uint256); isLong gives direction. */
function normalizeIntentForContract(intent: PerpIntent): PerpIntent {
  return {
    ...intent,
    size: intentSizeAsMagnitude(intent.size),
  };
}

/**
 * Compute commitment hash for a perp intent
 */
export async function computeCommitmentHash(
  intent: PerpIntent,
  token: string
): Promise<{ commitmentHash: string }> {
  const normalized = normalizeIntentForContract(intent);
  return apiRequest<{ commitmentHash: string }>(
    "/api/perp/compute-commitment-hash",
    {
      method: "POST",
      body: JSON.stringify({ intent: normalized }),
    },
    token
  );
}

/**
 * Submit a perp commitment
 */
export async function submitCommitment(
  commitmentHash: string,
  poolKey?: PoolKey,
  token: string
): Promise<{ hash: string }> {
  return apiRequest<{ hash: string }>(
    "/api/perp/commit",
    {
      method: "POST",
      body: JSON.stringify({ commitmentHash, poolKey }),
    },
    token
  );
}

/**
 * Submit a perp reveal
 */
export async function submitReveal(
  intent: PerpIntent,
  poolKey?: PoolKey,
  token: string
): Promise<{ hash: string }> {
  const normalized = normalizeIntentForContract(intent);
  return apiRequest<{ hash: string }>(
    "/api/perp/reveal",
    {
      method: "POST",
      body: JSON.stringify({ intent: normalized, poolKey }),
    },
    token
  );
}

/**
 * Execute a batch of perp reveals (with optional commitment hashes in body).
 * If commitmentHashes omitted, backend uses pending reveals from DB.
 */
export async function executeBatch(
  commitmentHashes: string[],
  poolKey?: PoolKey,
  baseIsCurrency0?: boolean,
  token: string
): Promise<{ hash: string }> {
  return apiRequest<{ hash: string }>(
    "/api/perp/execute-batch",
    {
      method: "POST",
      body: JSON.stringify({
        commitmentHashes,
        poolKey,
        baseIsCurrency0,
      }),
    },
    token
  );
}

/**
 * Execute the current pending batch (no body).
 * Uses pending reveals from DB for the default pool. Fails if fewer than 2 pending or batch interval not met.
 */
export async function executeBatchNow(token: string): Promise<{
  hash: string;
  batchSize: number;
}> {
  return apiRequest<{ hash: string; batchSize: number }>(
    "/api/perp/execute",
    { method: "POST" },
    token
  );
}

/**
 * Get user's position for a market
 */
export async function getPosition(
  marketId?: string,
  token: string
): Promise<{ marketId: string; position: Position | null }> {
  const query = marketId ? `?marketId=${marketId}` : "";
  return apiRequest<{ marketId: string; position: Position | null }>(
    `/api/perp/position${query}`,
    {
      method: "GET",
    },
    token
  );
}

/**
 * Get user's collateral info
 */
export async function getCollateral(
  token: string
): Promise<CollateralInfo> {
  return apiRequest<CollateralInfo>(
    "/api/perp/collateral",
    {
      method: "GET",
    },
    token
  );
}

/**
 * Deposit collateral (USDC) into perp account.
 * Sends approve then depositCollateral. Amount in USDC (e.g. 100 for 100 USDC).
 */
export async function depositCollateral(
  amount: number,
  token: string
): Promise<{ approveHash: string; depositHash: string }> {
  return apiRequest<{ approveHash: string; depositHash: string }>(
    "/api/perp/deposit",
    {
      method: "POST",
      body: JSON.stringify({ amount }),
    },
    token
  );
}

/**
 * Withdraw collateral (USDC) from perp account back to wallet.
 * Amount in USDC (e.g. 50 for 50 USDC). Cannot exceed available margin.
 */
export async function withdrawCollateral(
  amount: number,
  token: string
): Promise<{ hash: string }> {
  return apiRequest<{ hash: string }>(
    "/api/perp/withdraw",
    {
      method: "POST",
      body: JSON.stringify({ amount }),
    },
    token
  );
}

/**
 * Get user's token balances
 */
export async function getBalances(token: string): Promise<TokenBalances> {
  const endpoint = "/api/perp/balances";
  console.log("[Perp API] GET balance endpoint:", `${API_URL}${endpoint}`);
  const result = await apiRequest<TokenBalances>(
    endpoint,
    {
      method: "GET",
    },
    token
  );
  console.log("[Perp API] Balance checked for this USDC contract:", result.usdcContract ?? "(not returned by backend)");
  return result;
}

/**
 * Get batch state for a pool
 */
export async function getBatchState(
  poolId: string,
  token: string
): Promise<BatchState> {
  return apiRequest<BatchState>(
    `/api/perp/batch-state?poolId=${poolId}`,
    {
      method: "GET",
    },
    token
  );
}

/**
 * Get batch interval
 */
export async function getBatchInterval(
  token: string
): Promise<{ batchInterval: string }> {
  return apiRequest<{ batchInterval: string }>(
    "/api/perp/batch-interval",
    {
      method: "GET",
    },
    token
  );
}

/** Pending batch state (for execute page) */
export interface PendingBatchState {
  poolId: string;
  commitmentHashes: string[];
  count: number;
  canExecute: boolean;
  nextExecutionAt: string | null;
  lastBatchTimestamp: string;
  batchIntervalSeconds: number;
  minCommitments: number;
}

/**
 * Get pending batch (commitments waiting to be executed).
 */
export async function getPendingBatch(
  token: string
): Promise<PendingBatchState> {
  return apiRequest<PendingBatchState>(
    "/api/perp/pending-batch",
    { method: "GET" },
    token
  );
}

/**
 * Clear pending perp reveals for the (default) pool from the backend DB.
 * Use when the current pending batch has bad reveals and you want to stop retries and start fresh.
 */
export async function clearPendingBatch(
  token: string,
  poolId?: string
): Promise<{ deletedCount: number; poolId: string }> {
  return apiRequest<{ deletedCount: number; poolId: string }>(
    "/api/perp/clear-pending-batch",
    {
      method: "POST",
      body: JSON.stringify(poolId != null ? { poolId } : {}),
    },
    token
  );
}

/**
 * Get orders for the authenticated user.
 * @param status "pending" (open orders), "executed", "cancelled", or "all"
 */
export async function getOrders(
  token: string,
  status: "pending" | "executed" | "cancelled" | "all" = "pending"
): Promise<{ orders: PerpOrderRecord[] }> {
  const query = status ? `?status=${status}` : "";
  return apiRequest<{ orders: PerpOrderRecord[] }>(
    `/api/perp/orders${query}`,
    { method: "GET" },
    token
  );
}

/**
 * Get executed trade history for the authenticated user.
 */
export async function getTradeHistory(
  token: string,
  limit: number = 50
): Promise<{ trades: PerpTradeRecord[] }> {
  return apiRequest<{ trades: PerpTradeRecord[] }>(
    `/api/perp/trade-history?limit=${Math.min(Math.max(limit, 1), 200)}`,
    { method: "GET" },
    token
  );
}

/**
 * Get position history (trades that opened/closed positions), optionally filtered by market.
 */
export async function getPositionHistory(
  token: string,
  options?: { marketId?: string; limit?: number }
): Promise<{ trades: PerpTradeRecord[] }> {
  const params = new URLSearchParams();
  if (options?.marketId) params.set("marketId", options.marketId);
  if (options?.limit != null) params.set("limit", String(Math.min(Math.max(options.limit, 1), 200)));
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<{ trades: PerpTradeRecord[] }>(
    `/api/perp/position-history${query}`,
    { method: "GET" },
    token
  );
}
