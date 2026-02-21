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

/** Default price for collateral computation (match e2e script: scripts/zk/test-perp-e2e.js). */
const DEFAULT_ENTRY_PRICE_18 = 2800;

/**
 * Create a PerpIntent from form inputs.
 * LOCK: size is always sent as positive magnitude (uint256); isLong gives direction.
 * Collateral is computed as (size × price) / leverage in 18 decimals (same as e2e script).
 * For closes, prefer sizeRaw (18-decimal string from chain) to avoid rounding to 0.
 */
export function createPerpIntent(params: {
  userAddress: string;
  marketId: string;
  /** Position size: number (e.g. 0.1 ETH) or raw 18-decimal string from chain (use for closes to avoid rounding). */
  size: number | string;
  isLong: boolean;
  isOpen: boolean;
  collateral?: number; // Ignored for opens; we use (size × price) / leverage to match contract/e2e
  leverage: number; // e.g., 5 for 5x
  nonce?: string;
  deadline?: string;
}): PerpIntent {
  const sizeBigInt =
    typeof params.size === "string"
      ? (params.size.startsWith("-") ? params.size.slice(1) : params.size).trim()
      : priceToBigInt(Math.abs(Number(params.size)));

  if (sizeBigInt === "0" || BigInt(sizeBigInt) === BigInt(0)) {
    throw new Error("Position size cannot be zero");
  }

  const leverageNum = Math.max(1, Number(params.leverage) || 1);
  const leverageBigInt = leverageToBigInt(leverageNum);

  // Match e2e: collateralWei = (size * ethers.parseEther("2800")) / leverage (18 decimals)
  const sizeWei = BigInt(sizeBigInt);
  const priceWei = BigInt(DEFAULT_ENTRY_PRICE_18) * 10n ** 18n;
  const leverageWei = BigInt(leverageBigInt);
  const collateralWei = leverageWei > 0n ? (sizeWei * priceWei) / leverageWei : 0n;
  const collateral = collateralWei.toString();

  return {
    user: params.userAddress,
    market: params.marketId,
    size: sizeBigInt,
    isLong: params.isLong,
    isOpen: params.isOpen,
    collateral,
    leverage: leverageBigInt,
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
 * Estimate liquidation price for a proposed position (matches PerpPositionManager.getLiquidationPrice).
 * Uses maintenance margin ratio (e.g. 0.05 = 5%). Returns price in USD or null if not liquidatable / invalid.
 */
export function estimateLiquidationPriceUSD(params: {
  sizeBaseAsset: number;
  collateralUSD: number;
  entryPriceUSD: number;
  isLong: boolean;
  maintenanceMarginRatio?: number; // default 0.05 (5%)
}): number | null {
  const { sizeBaseAsset, collateralUSD, entryPriceUSD, isLong } = params;
  const mm = params.maintenanceMarginRatio ?? 0.05;
  if (sizeBaseAsset <= 0 || entryPriceUSD <= 0) return null;

  const PRECISION = 10n ** 18n;
  const absSize = BigInt(Math.round(sizeBaseAsset * 1e18));
  const entryPrice = BigInt(Math.round(entryPriceUSD * 1e18));
  const collateral = BigInt(Math.round(collateralUSD * 1e18));
  const maintenanceMargin = BigInt(Math.round(mm * 1e18));

  if (absSize === 0n) return null;

  if (isLong) {
    const num = (absSize * entryPrice) / PRECISION;
    if (num <= collateral) return null;
    const denom = absSize * (PRECISION - maintenanceMargin);
    if (denom === 0n) return null;
    const ratio = (num - collateral) * PRECISION / denom;
    return Number(ratio);
  } else {
    const num = (absSize * entryPrice) / PRECISION + collateral;
    const denom = absSize * (PRECISION + maintenanceMargin);
    if (denom === 0n) return null;
    const ratio = (num * PRECISION) / denom;
    return Number(ratio);
  }
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
