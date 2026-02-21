/**
 * Utility functions for perp trading
 */

import type { PerpIntent } from "@/lib/api/perp";

/**
 * Convert leverage number (e.g., 5) to BigInt string format
 * Leverage is stored as 18-decimal fixed point: 5x = "5000000000000000000"
 */
export function leverageToBigInt(leverage: number): string {
  const factor = BigInt(10 ** 18);
  return (BigInt(Math.floor(leverage * 10 ** 18))).toString();
}

/**
 * Convert BigInt string leverage back to number
 */
export function leverageFromBigInt(leverageStr: string): number {
  const leverageBigInt = BigInt(leverageStr);
  const factor = BigInt(10 ** 18);
  return Number(leverageBigInt) / Number(factor);
}

/**
 * Convert token amount to BigInt string (assuming 6 decimals for USDC/USDT)
 */
export function amountToBigInt(amount: number, decimals: number = 6): string {
  return BigInt(Math.floor(amount * 10 ** decimals)).toString();
}

/**
 * Convert BigInt string amount back to number
 */
export function amountFromBigInt(amountStr: string, decimals: number = 6): number {
  const amountBigInt = BigInt(amountStr);
  return Number(amountBigInt) / 10 ** decimals;
}

/**
 * Convert price to BigInt string (assuming 18 decimals for price)
 */
export function priceToBigInt(price: number): string {
  return BigInt(Math.floor(price * 10 ** 18)).toString();
}

/**
 * Convert BigInt string price back to number
 */
export function priceFromBigInt(priceStr: string): number {
  const priceBigInt = BigInt(priceStr);
  return Number(priceBigInt) / 10 ** 18;
}

/**
 * Generate a unique nonce per order (timestamp + random so two orders in same second don't collide).
 */
export function generateNonce(): string {
  return `${Math.floor(Date.now() / 1000)}${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Generate deadline (current timestamp + hours)
 */
export function generateDeadline(hours: number = 24): string {
  return Math.floor(Date.now() / 1000 + hours * 3600).toString();
}

/**
 * Ensure size is a positive magnitude string (contract expects uint256).
 * Use this before any API call so we never send negative size; direction is isLong only.
 */
export function intentSizeAsMagnitude(size: string): string {
  const s = String(size).trim();
  if (s.startsWith("-")) return s.slice(1);
  return s;
}

/**
 * Create a PerpIntent from form inputs.
 * LOCK: size is always sent as positive magnitude (uint256); isLong gives direction.
 */
export function createPerpIntent(params: {
  userAddress: string;
  marketId: string;
  size: number; // Position size (e.g., 1 ETH) — must be positive; direction from isLong
  isLong: boolean;
  isOpen: boolean;
  collateral?: number; // Required for opens
  leverage: number; // e.g., 5 for 5x
  nonce?: string;
  deadline?: string;
}): PerpIntent {
  // Lock: use absolute value so size is always magnitude; contract uses isLong for direction
  const sizeMagnitude = Math.abs(params.size);
  const sizeBigInt = priceToBigInt(sizeMagnitude);

  // Contract expects collateral in 18 decimals (same as e2e script: collateralWei)
  const collateral =
    params.collateral !== undefined && params.collateral !== null
      ? amountToBigInt(params.collateral, 18)
      : "0";

  // Leverage: ensure at least 1x (contract rejects 0)
  const leverageNum = Math.max(1, Number(params.leverage) || 1);

  return {
    user: params.userAddress,
    market: params.marketId,
    size: sizeBigInt,
    isLong: params.isLong,
    isOpen: params.isOpen,
    collateral,
    leverage: leverageToBigInt(leverageNum),
    nonce: params.nonce || generateNonce(),
    deadline: params.deadline || generateDeadline(),
  };
}

/**
 * Format position size for display
 */
export function formatPositionSize(sizeStr: string, decimals: number = 18): string {
  // Handle zero or empty
  if (!sizeStr || sizeStr === "0") return "0";
  
  const size = amountFromBigInt(sizeStr.replace("-", ""), decimals);
  const sign = sizeStr.startsWith("-") ? "-" : "+";
  return `${sign}${size.toFixed(4)}`;
}

/**
 * Calculate unrealized PnL
 */
export function calculateUnrealizedPnL(
  entryPrice: string,
  currentPrice: string,
  size: string
): { pnl: number; pnlPercent: number } {
  const entry = priceFromBigInt(entryPrice);
  const current = priceFromBigInt(currentPrice);
  const sizeNum = amountFromBigInt(size.replace("-", ""), 18);
  const isLong = !size.startsWith("-");

  const priceDiff = isLong ? current - entry : entry - current;
  const pnl = priceDiff * sizeNum;
  const pnlPercent = (priceDiff / entry) * 100;

  return { pnl, pnlPercent };
}
